// Adds a user to the app_users table in Neon, or updates an existing one (password, role, tools).
//   npm run user:create -- <username> <password> admin
//   npm run user:create -- <username> <password> user <tools>     tools: audit,rankings,visit,ctr
// Admins can use every tool; a "user" only the tools listed. Reads DATABASE_URL from the
// environment or .env.local. The password is stored as a scrypt hash (same format as
// src/lib/auth/users.ts), never as typed.

import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const TOOL_IDS = ["audit", "rankings", "visit", "ctr"];
const scrypt = promisify(scryptCb);
const [username, password, role = "admin", toolArg = ""] = process.argv.slice(2);
const usage = "Usage:\n  npm run user:create -- <username> <password> admin\n  npm run user:create -- <username> <password> user audit,rankings,visit,ctr";

if (!username || !password || !["admin", "user"].includes(role)) {
  console.error(usage);
  process.exit(1);
}
if (password.length < 8) {
  console.error("Use a password of at least 8 characters.");
  process.exit(1);
}
const tools = toolArg
  .split(",")
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);
if (role === "user" && (!tools.length || tools.some((t) => !TOOL_IDS.includes(t)))) {
  console.error(`A "user" needs the tools it may use: ${TOOL_IDS.join(", ")} (comma-separated).\n${usage}`);
  process.exit(1);
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    return line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL not found (environment or .env.local).");
  process.exit(1);
}

const sql = neon(url);
await sql.query(`CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
)`);
await sql.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS tools TEXT[]`);

const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
const name = username.trim().toLowerCase();
const rows = await sql.query(
  `INSERT INTO app_users (username, password_hash, role, tools) VALUES ($1, $2, $3, $4)
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, tools = EXCLUDED.tools, active = true
   RETURNING id, (xmax = 0) AS created`,
  [name, passwordHash, role, role === "admin" ? null : tools],
);
console.log(`${rows[0].created ? "Created" : "Updated"} ${role} "${name}" (id ${rows[0].id}) · tools: ${role === "admin" ? "all" : tools.join(", ")}.`);
