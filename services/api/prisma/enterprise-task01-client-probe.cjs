"use strict";
// PREPARED / NOT EXECUTED. Fixed preflight connection probe, not an application-pool proof.
const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const file = process.env.JG_TASK01_PROBE_INPUT;
  if (process.env.NODE_ENV !== "test" || process.argv.length !== 2 || !file || !file.startsWith("/private/tmp/")) throw new Error("PROBE_INPUT_REJECTED");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 16_384 || realpathSync(file) !== path.resolve(file)) throw new Error("PROBE_INPUT_REJECTED");
  const input = JSON.parse(readFileSync(file, "utf8"));
  if (!["healthy", "certificate-negative", "plaintext-negative"].includes(input.mode)) throw new Error("PROBE_INPUT_REJECTED");
  const url = new URL(input.url);
  const keys = [...url.searchParams.keys()];
  const allowed = ["schema", "connection_limit", "sslmode", "sslaccept", "sslcert", "application_name", "connect_timeout", "pool_timeout", "options"];
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port
    || !/^\/jg_task01_[a-f0-9]{32}$/u.test(url.pathname)
    || !["jg_task01_owner", "jg_task01_runtime", "jg_task01_observer"].includes(url.username)
    || !url.password || url.searchParams.get("connection_limit") !== "1"
    || url.searchParams.get("sslmode") !== (input.mode === "plaintext-negative" ? "disable" : "require")
    || url.searchParams.get("sslaccept") !== "strict" || !url.searchParams.get("sslcert")
    || (url.searchParams.get("schema") ?? "public") !== "public" || url.hash
    || new Set(keys).size !== keys.length || keys.some(key => !allowed.includes(key))) throw new Error("PROBE_INPUT_REJECTED");
  const client = new PrismaClient({ datasources: { db: { url: input.url } }, log: [] });
  let output;
  let disconnected = false;
  try {
    await client.$connect();
    if (input.mode !== "healthy") output = { status: "unexpected-connection", role: url.username };
    else {
      const sql = url.username === "jg_task01_owner"
        ? `SELECT current_user::text AS "effectiveRole", session_user::text AS "loginRole", (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid", (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier", pg_backend_pid() AS "backendPid", coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS tls, current_setting('transaction_read_only') AS "readOnly", current_setting('server_version_num') AS "serverVersionNum"`
        : `SELECT current_user::text AS "effectiveRole", i.*, current_setting('transaction_read_only') AS "readOnly", current_setting('server_version_num') AS "serverVersionNum" FROM public.jg_task01_connection_identity() i`;
      const rows = await client.$queryRawUnsafe(sql);
      if (rows.length !== 1) throw new Error("PROBE_IDENTITY_NOT_UNIQUE");
      const row = rows[0];
      if (row.effectiveRole !== url.username || row.loginRole !== url.username || !row.tls
        || !/^\d+$/u.test(row.databaseOid) || !/^\d+$/u.test(row.systemIdentifier)
        || !/^16\d{4}$/u.test(row.serverVersionNum) || !Number.isInteger(row.backendPid)
        || (url.username === "jg_task01_observer" && row.readOnly !== "on")) throw new Error("PROBE_IDENTITY_REJECTED");
      output = { status: "healthy-sql", role: row.loginRole, databaseOid: row.databaseOid,
        systemIdentifier: row.systemIdentifier, backendPid: row.backendPid, tls: true, readOnly: row.readOnly, serverVersionNum: row.serverVersionNum };
    }
  } catch (error) {
    const code = error?.errorCode ?? error?.code;
    const prismaCode = typeof code === "string" && /^P\d{4}$/u.test(code) ? code : null;
    const text = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    const certificateMarker = text.includes("certificate was not trusted") && text.includes("tls connection");
    output = { status: prismaCode === "P1011" && certificateMarker ? "tls-certificate-verification-rejected" : "connection-or-query-rejected",
      prismaCode, certificateMarker };
  } finally {
    try { await client.$disconnect(); disconnected = true; } catch { /* fixed result below */ }
  }
  if (!disconnected) throw new Error("PROBE_DISCONNECT_FAILED");
  process.stdout.write(`${JSON.stringify({ ...output, disconnected: true })}\n`);
}
main().catch(() => {
  process.stdout.write(`${JSON.stringify({ status: "probe-failed-closed" })}\n`);
  process.exitCode = 1;
});
