// Server-only: app settings that are secrets (e.g. the proxy API link with its token), stored in
// Postgres (Neon) ENCRYPTED, so the database never holds them in readable form.
// AES-256-GCM; the key is derived from AUTH_SECRET (kept in .env.local / Vercel, never in the
// database). The setting's name is bound to its ciphertext, so values can't be swapped between rows.
// If AUTH_SECRET changes, old values can't be decrypted: they read as "unreadable" and must be saved again.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const SCHEMA = `CREATE TABLE IF NOT EXISTS app_secret_settings (
  name TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let testQuery: Query | null = null;
/** Tests only. */
export function useSecretSettingsQueryForTests(q: Query | null) {
  testQuery = q;
  ready = null;
}

let ready: Promise<void> | null = null;
async function db(): Promise<Query> {
  let q = testQuery;
  if (!q) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("The database isn't connected (DATABASE_URL).");
    const sql = neon(url);
    q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  }
  const run = q;
  ready ??= run(SCHEMA).then(
    () => undefined,
    (err) => {
      ready = null;
      throw err;
    },
  );
  await ready;
  return run;
}

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  return Buffer.from(hkdfSync("sha256", secret, "seo-auditor", "secret-settings-v1", 32));
}

export function encryptSetting(name: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(name));
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

/** The value, or null if it can't be decrypted (wrong key, edited, or another setting's value). */
export function decryptSetting(name: string, stored: string): string | null {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type SecretRead = { state: "missing" } | { state: "unreadable" } | { state: "ok"; value: string; updatedBy: string | null; updatedAt: string };

export async function readSecretSetting(name: string): Promise<SecretRead> {
  const q = await db();
  const row = (await q(`SELECT value_encrypted, updated_by, updated_at FROM app_secret_settings WHERE name = $1`, [name]))[0];
  if (!row) return { state: "missing" };
  const value = decryptSetting(name, String(row.value_encrypted));
  if (value === null) return { state: "unreadable" };
  const at = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
  return { state: "ok", value, updatedBy: (row.updated_by as string | null) ?? null, updatedAt: at };
}

export async function writeSecretSetting(name: string, value: string, updatedBy: string | null): Promise<void> {
  const q = await db();
  await q(
    `INSERT INTO app_secret_settings (name, value_encrypted, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (name) DO UPDATE SET value_encrypted = EXCLUDED.value_encrypted, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [name, encryptSetting(name, value), updatedBy],
  );
}

export async function deleteSecretSetting(name: string): Promise<void> {
  const q = await db();
  await q(`DELETE FROM app_secret_settings WHERE name = $1`, [name]);
}
