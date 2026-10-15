import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MfaService } from "./mfa.js";

export type DevOneUser = { id: string; email: string; role: "owner" | "admin" | "operator" | "viewer" };

const dbPath = process.env.DEVONE_DB_PATH ?? "/var/lib/devone/devone.sqlite";
export const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
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

export const mfa = new MfaService(db,process.env.DEVONE_MASTER_KEY_FILE ?? "/etc/devone/secrets.key");

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
  if (typeof email !== "string" || typeof password !== "string") throw new Error("invalid_credentials");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");
  if (password.length > 1024) throw new Error("password_too_long");
  if (password.length < 12) throw new Error("password_too_short");
  const userId = id();
  db.prepare("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)")
    .run(userId, email.trim().toLowerCase(), passwordHash(password), "owner", now());
  audit(userId, "auth.owner_created");
  return getUser(userId)!;
}

export function createSession(userId:string){
 const user=getUser(userId);
 if(!user)throw Error("user_not_found");
 const token=randomBytes(32).toString("base64url");
 db.prepare("INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(hashSession(token),user.id,Date.now()+1000*60*60*12,now());
 return {token,user};
}
export function invalidateSessions(userId:string){
 db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}
export function login(email:string,password:string,code?:unknown){
 if(typeof email!=="string"||email.length>254||typeof password!=="string"||password.length>1024)return null;
 db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
 const row=db.prepare("SELECT * FROM users WHERE email=?").get(email.trim().toLowerCase()) as any;
 if(!row||!passwordVerify(password,row.password_hash))return null;
 if(mfa.status(row.id).enabled){
   if(typeof code!=="string"||!code.trim())return {mfaRequired:true as const};
   if(!mfa.verifyLogin(row.id,code.trim()))return null;
 }
 const session=createSession(row.id);
 audit(row.id,"auth.login",{mfa:mfa.status(row.id).enabled});
 return session;
}

export function userFromToken(token?: string) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.expires_at>?
  `).get(hashSession(token), Date.now()) as DevOneUser | undefined;
  return row ?? null;
}

export function verifyOwnerPassword(userId: string, password: unknown) {
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return false;
  const row = db.prepare("SELECT password_hash FROM users WHERE id=? AND role='owner'").get(userId) as {password_hash:string}|undefined;
  return row ? passwordVerify(password, row.password_hash) : false;
}

// A privileged operation must re-check the password AND a fresh MFA code if
// the Owner has opted in to authenticator MFA. Replays are rejected by MfaService.
export function verifyOwnerStepUp(userId:string,password:unknown,mfaCode:unknown):"ok"|"password_invalid"|"mfa_required"|"mfa_invalid"{
 if(!verifyOwnerPassword(userId,password))return "password_invalid";
 if(!mfa.status(userId).enabled)return "ok";
 if(typeof mfaCode!=="string"||!mfaCode)return "mfa_required";
 return mfa.verifyLogin(userId,mfaCode)?"ok":"mfa_invalid";
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
