import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { openSync, closeSync, fstatSync, readFileSync, constants } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

type Envelope = { version: 1; iv: string; tag: string; ciphertext: string };
export function readMasterKey(path: string): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o007) !== 0) throw new Error("vault_key_permissions");
    if (stat.size !== 32) throw new Error("vault_key_invalid");
    const key = readFileSync(descriptor);
    if (key.length !== 32) throw new Error("vault_key_invalid");
    return key;
  } finally { closeSync(descriptor); }
}
export function seal(key: Buffer, name: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`devone-secret:v1:${name}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") } satisfies Envelope);
}
export function open(key: Buffer, name: string, envelope: string): string {
  const data = JSON.parse(envelope) as Envelope;
  if (data.version !== 1) throw new Error("vault_version_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "base64"));
  decipher.setAAD(Buffer.from(`devone-secret:v1:${name}`));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
export function validSecretName(name: unknown): name is string {
  return typeof name === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(name);
}
export class Vault {
  constructor(private db: DatabaseSync, private keyFile: string) {
    db.exec(`CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, envelope TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL);`);
  }
  list() { return this.db.prepare("SELECT name,updated_at FROM secrets ORDER BY name").all(); }
  put(name: string, value: string, actor: string) {
    if (!validSecretName(name) || typeof value !== "string" || !value || Buffer.byteLength(value) > 8192) throw new Error("invalid_secret");
    const encrypted = seal(readMasterKey(this.keyFile), name, value);
    this.db.prepare(`INSERT INTO secrets(name,envelope,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET envelope=excluded.envelope,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(name, encrypted, actor, new Date().toISOString());
  }
  // Internal provider adapters may use this. No HTTP route returns plaintext.
  get(name: string) {
    const row = this.db.prepare("SELECT envelope FROM secrets WHERE name=?").get(name) as { envelope: string } | undefined;
    return row ? open(readMasterKey(this.keyFile), name, row.envelope) : undefined;
  }
  remove(name: string) {
    if (!validSecretName(name)) throw new Error("invalid_secret");
    return this.db.prepare("DELETE FROM secrets WHERE name=?").run(name).changes !== 0;
  }
}
