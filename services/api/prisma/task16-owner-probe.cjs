"use strict";
// Dedicated fixed owner-only child probe. Not run by source/mock verification.
const path = require("node:path");
const fs = require("node:fs");
const { readQualifiedTask16File: read } = require("./task16-runtime-inputs.cjs");
async function main() {
  if (process.env.NODE_ENV !== "test" || process.argv.length !== 2) throw new Error("PROBE_INPUT_REJECTED");
  const file = process.env.JG_TASK16_OWNER_PROBE_INPUT;
  const { bytes } = read(file, { maxBytes: 16384, privateFile: true, collect: true, code: "PROBE_INPUT_REJECTED" });
  const input = JSON.parse(bytes.toString("utf8"));
  if (!["healthy", "certificate-negative", "plaintext-negative"].includes(input.mode) || !/^[a-f0-9]{64}$/u.test(input.nonce) || !/^[a-f0-9]{64}$/u.test(input.caSha256)) throw new Error("PROBE_INPUT_REJECTED");
  const url = new URL(input.url), keys = [...url.searchParams.keys()];
  const allowed = ["schema", "connection_limit", "sslmode", "sslaccept", "sslcert", "application_name", "connect_timeout", "pool_timeout"];
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !/^\d{1,5}$/u.test(url.port) || Number(url.port) <= 1024 || Number(url.port) > 65535
    || !/^\/jg_task01_[a-f0-9]{32}$/u.test(url.pathname) || url.username !== "jg_task01_owner" || !/^[a-f0-9]{96}$/u.test(url.password)
    || url.searchParams.get("schema") !== "public" || url.searchParams.get("connection_limit") !== "1" || url.searchParams.get("sslaccept") !== "strict"
    || url.searchParams.get("sslmode") !== (input.mode === "plaintext-negative" ? "disable" : "require") || url.hash
    || url.searchParams.get("connect_timeout") !== "5" || url.searchParams.get("pool_timeout") !== "5"
    || url.searchParams.get("application_name") !== `task16_owner_${url.pathname.slice("/jg_task01_".length)}`
    || new Set(keys).size !== keys.length || keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) throw new Error("PROBE_INPUT_REJECTED");
  const ca = url.searchParams.get("sslcert");
  if (read(ca, { maxBytes: 1048576, privateFile: true, code: "PROBE_CA_REJECTED" }).sha256 !== input.caSha256) throw new Error("PROBE_CA_REJECTED");
  for (const relative of ["../../../.env", "../.env", ".env"]) if (fs.existsSync(path.resolve(__dirname, relative))) throw new Error("PROBE_DOTENV_REJECTED");
  const { PrismaClient, Prisma } = require("@prisma/client");
  if (Prisma.prismaVersion.client !== "5.22.0" || Prisma.prismaVersion.engine !== "605197351a3c8bdd595af2d2a9bc3025bca48ea2") throw new Error("PROBE_VERSION_REJECTED");
  const client = new PrismaClient({ datasources: { db: { url: input.url } }, log: [] });
  let output, disconnected = false;
  try {
    await client.$connect();
    if (input.mode !== "healthy") output = { status: "unexpected-connection" };
    else {
      const rows = await client.$queryRawUnsafe(`SELECT current_database()::text AS "database", current_user::text AS "ownerRole", session_user::text AS "loginRole", EXISTS(SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database() AND r.rolname=current_user) AS "ownerIsDatabaseOwner", (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid", (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier", pg_backend_pid() AS "backendPid", coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS tls, current_setting('default_transaction_read_only') AS "readOnly", current_setting('server_version_num')::integer AS version, current_setting('session_replication_role') AS replication, '${input.nonce}'::text AS nonce`);
      if (rows.length !== 1 || rows[0].ownerRole !== url.username || rows[0].loginRole !== url.username || rows[0].database !== url.pathname.slice(1) || rows[0].nonce !== input.nonce) throw new Error("PROBE_IDENTITY_REJECTED");
      output = { status: "healthy-sql", ...rows[0], role: url.username };
    }
  } catch (error) {
    const code = error?.errorCode ?? error?.code;
    const prismaCode = typeof code === "string" && /^P\d{4}$/u.test(code) ? code : null;
    const text = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    const certificateMarker = text.includes("certificate was not trusted") && text.includes("tls connection");
    output = { status: prismaCode === "P1011" && certificateMarker ? "tls-certificate-verification-rejected" : "connection-or-query-rejected", prismaCode, certificateMarker };
  } finally { try { await client.$disconnect(); disconnected = true; } catch { /* fixed fail-closed result */ } }
  if (!disconnected) throw new Error("PROBE_DISCONNECT_FAILED");
  process.stdout.write(`${JSON.stringify({ ...output, nonce: input.nonce, disconnected: true })}\n`);
}
if (require.main === module) main().catch(() => { process.stdout.write(`${JSON.stringify({ status: "probe-failed-closed" })}\n`); process.exitCode = 1; });
