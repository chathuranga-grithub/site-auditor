// Server-only: app users in Postgres (Neon). Passwords are stored as scrypt hashes, never as typed.
// Users are added with `npm run user:create -- <username> <password> [admin|user]` (scripts/create-user.mjs),
// which uses the same hash format as below.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";
import { isToolId, type ToolId } from "./permissions";
import type { Role } from "./session";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export interface User {
  id: number;
  username: string;
  role: Role;
  /** Tools a "user" may use; null for admins (all tools). */
  tools: ToolId[] | null;
  active: boolean;
}

export const USERS_SCHEMA = `CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
)`;
/** Added after the first version of the table. */
export const USERS_MIGRATIONS = [`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS tools TEXT[]`];

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let testQuery: Query | null = null;
/** Tests only. */
export function useUsersQueryForTests(q: Query | null) {
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
  ready ??= (async () => {
    await run(USERS_SCHEMA);
    for (const m of USERS_MIGRATIONS) await run(m);
  })().then(
    () => undefined,
    (err) => {
      ready = null;
      throw err;
    },
  );
  await ready;
  return run;
}

/** Usernames are case-insensitive: stored lowercased. */
export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The user if the username and password match an active account; null otherwise. */
export async function checkLogin(username: string, password: string): Promise<User | null> {
  const q = await db();
  const rows = await q(`SELECT id, username, role, tools, active, password_hash FROM app_users WHERE username = $1`, [normalizeUsername(username)]);
  const row = rows[0];
  // Hash anyway when the user doesn't exist, so response time doesn't reveal which usernames exist.
  const ok = await verifyPassword(password, (row?.password_hash as string) ?? DUMMY_HASH);
  if (!row || !ok || !row.active) return null;
  await q(`UPDATE app_users SET last_login_at = now() WHERE id = $1`, [row.id]);
  return { id: Number(row.id), username: String(row.username), role: row.role as Role, tools: toolsOf(row.role as Role, row.tools), active: true };
}

export async function upsertUser(username: string, password: string, role: Role, tools: ToolId[] | null = null): Promise<User> {
  const q = await db();
  const rows = await q(
    `INSERT INTO app_users (username, password_hash, role, tools) VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, tools = EXCLUDED.tools, active = true
     RETURNING id, username, role, tools, active`,
    [normalizeUsername(username), await hashPassword(password), role, role === "admin" ? null : (tools ?? [])],
  );
  const r = rows[0];
  return { id: Number(r.id), username: String(r.username), role: r.role as Role, tools: toolsOf(r.role as Role, r.tools), active: Boolean(r.active) };
}

function toolsOf(role: Role, raw: unknown): ToolId[] | null {
  if (role === "admin") return null;
  return Array.isArray(raw) ? raw.filter(isToolId) : [];
}

// A fixed hash of a random password, used only to spend the same time on unknown usernames.
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";
