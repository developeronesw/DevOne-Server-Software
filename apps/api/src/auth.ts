import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type DevOneUser = { id: string; email: string; role: "owner" | "admin" | "operator" | "viewer" };

const dbPath = process.env.DEVONE_DB_PATH ?? "/var/lib/devone/devone.sqlite";
const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','operator','viewer')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const id = () => randomBytes(16).toString("hex");

function passwordHash(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

function passwordVerify(password: string, stored: string) {
  const [, saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashSession(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hasOwner() {
  return Number((db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get() as { count: number }).count) > 0;
}

export function createOwner(email: string, password: string) {
  if (hasOwner()) throw new Error("owner_exists");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");
  if (password.length < 12) throw new Error("password_too_short");
  const userId = id();
  db.prepare("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)")
    .run(userId, email.trim().toLowerCase(), passwordHash(password), "owner", now());
  audit(userId, "auth.owner_created");
  return getUser(userId)!;
}

export function login(email: string, password: string) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as any;
  if (!row || !passwordVerify(password, row.password_hash)) return null;
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(hashSession(token), row.id, Date.now() + 1000 * 60 * 60 * 12, now());
  audit(row.id, "auth.login");
  return { token, user: getUser(row.id)! };
}

export function userFromToken(token?: string) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.expires_at>?
  `).get(hashSession(token), Date.now()) as DevOneUser | undefined;
  return row ?? null;
}

export function logout(token?: string) {
  if (!token) return;
  const user = userFromToken(token);
  db.prepare("DELETE FROM sessions WHERE id_hash=?").run(hashSession(token));
  if (user) audit(user.id, "auth.logout");
}

export function audit(userId: string | null, action: string, details?: unknown) {
  db.prepare("INSERT INTO audit_log (user_id,action,details,created_at) VALUES (?,?,?,?)")
    .run(userId, action, details ? JSON.stringify(details) : null, now());
}

function getUser(userId: string) {
  return db.prepare("SELECT id,email,role FROM users WHERE id=?").get(userId) as DevOneUser | undefined;
}

export function closeDb() {
  db.close();
}
