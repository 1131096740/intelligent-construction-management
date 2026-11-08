"use strict";
// Connected baseline installation stage only. No code runs on import and no
// resource is created here. The native driver still rejects missing adapters.
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { readQualifiedTask16File: readFile } = require("./task16-runtime-inputs.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const OWNER = "jg_task01_owner";
const OUTPUT_LIMIT = 1024 * 1024;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fault = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fault(code); };

// Actual spawn implementation: bounded output, isolated process group, no shell,
// cancellation and a termination deadline. It never includes output/env in errors.
const { runTask16BoundedCommand: nativeCommand } = require("./task16-bounded-command.cjs");

function qualified(file, maxBytes, executable = false, expectedIdentity) {
  return readFile(file, { maxBytes, executable, expectedIdentity, code: executable ? "TASK16_MIGRATE_TOOL_IDENTITY" : "TASK16_MIGRATE_INPUT_FILE" });
}

function resourceProof(context, expected) {
  const { resource, source, runId } = context;
  need(source?.candidateRoot === ROOT && source.runtimeAdmission?.status === "INPUTS_AND_CODE_TREES_MATCHED" && /^[a-f0-9]{40}$/u.test(source.candidateSha), "TASK16_MIGRATE_SOURCE_IDENTITY");
  need(resource && typeof resource.getReceipt === "function" && typeof resource.execOwnerSql === "function", "TASK16_MIGRATE_RESOURCE_ADAPTER");
  const receipt = resource.getReceipt(), docker = source.inputs.docker;
  need(receipt.runId === runId && receipt.sourceSha === source.candidateSha && receipt.status === "started-awaiting-driver-verification" && receipt.cleanup?.status === "pending" && receipt.databaseName === `jg_task01_${runId.replaceAll("-", "")}`, "TASK16_MIGRATE_RESOURCE_IDENTITY");
  need(["endpoint", "daemonId", "imageId"].every(key => receipt[key] === docker[key]) && ["containerId", "networkId"].every(key => /^[a-f0-9]{64}$/u.test(receipt[key]) && resource[key] === receipt[key]) && resource.databaseName === receipt.databaseName && resource.port === receipt.port && Number.isInteger(receipt.port) && receipt.port > 1024 && receipt.port <= 65535, "TASK16_MIGRATE_RESOURCE_IDENTITY");
  if (expected) need(["runId", "sourceSha", "containerId", "networkId", "databaseName", "port", "endpoint", "daemonId", "imageId"].every(key => receipt[key] === expected.receipt[key]), "TASK16_MIGRATE_RESOURCE_IDENTITY");
  const transport = context.ownerTransport;
  need(transport?.status === "OWNER_TLS_CONTROLS_VERIFIED" && transport.ownerRole === OWNER && /^[1-9][0-9]*$/u.test(transport.databaseOid) && /^[1-9][0-9]*$/u.test(transport.systemIdentifier), "TASK16_MIGRATE_OWNER_TRANSPORT");
  const ca = readFile(resource.caPath, { maxBytes: 1024 * 1024, privateFile: true, code: "TASK16_MIGRATE_CA_FILE" });
  need(ca.sha256 === transport.caSha256 && ca.sha256 === receipt.tls?.caSha256 && ca.sha256 === resource.serverCertHashes?.caSha256, "TASK16_MIGRATE_CA_IDENTITY");
  if (expected) need(["ownerRole", "databaseOid", "systemIdentifier", "caSha256"].every(key => transport[key] === expected.transport[key]), "TASK16_MIGRATE_OWNER_TRANSPORT");
  return { receipt: structuredClone(receipt), transport: { ...transport }, caSha256: ca.sha256 };
}

function sourceFiles(context) {
  const list = context.source.migrations;
  need(Array.isArray(list) && list.length === 203 && new Set(list.map(row => row.path)).size === 203, "TASK16_MIGRATE_SOURCE_INVENTORY");
  const ledger = list.map((row, index) => {
    const match = /^services\/api\/prisma\/migrations\/([0-9]{14}_[a-z0-9_]+)\/migration\.sql$/u.exec(row.path);
    need(match && /^[a-f0-9]{64}$/u.test(row.sha256) && (index === 0 || list[index - 1].path < row.path), "TASK16_MIGRATE_SOURCE_INVENTORY");
    const actual = qualified(path.join(ROOT, row.path), 64 * 1024 * 1024);
    need(actual.sha256 === row.sha256 && actual.identity.size === row.bytes, "TASK16_MIGRATE_SOURCE_CHANGED");
    return { name: match[1], sha256: row.sha256, finished: true, rolledBack: false };
  });
  const directory = path.join(ROOT, "services/api/prisma/migrations");
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const expected = ledger.map(row => row.name).sort();
  const actualNames = [];
  for (const entry of entries) {
    if (entry.name === "migration_lock.toml") { need(entry.isFile(), "TASK16_MIGRATE_SOURCE_INVENTORY"); qualified(path.join(directory, entry.name), 1024 * 1024); continue; }
    need(entry.isDirectory(), "TASK16_MIGRATE_SOURCE_INVENTORY");
    const children = fs.readdirSync(path.join(directory, entry.name), { withFileTypes: true });
    need(children.length === 1 && children[0].name === "migration.sql" && children[0].isFile(), "TASK16_MIGRATE_SOURCE_INVENTORY");
    actualNames.push(entry.name);
  }
  need(JSON.stringify(actualNames.sort()) === JSON.stringify(expected), "TASK16_MIGRATE_SOURCE_INVENTORY");
  const schema = context.source.schema;
  need(schema?.path === "services/api/prisma/schema.prisma", "TASK16_MIGRATE_SCHEMA");
  const actual = qualified(path.join(ROOT, schema.path), 64 * 1024 * 1024);
  need(actual.sha256 === schema.sha256 && actual.identity.size === schema.bytes, "TASK16_MIGRATE_SCHEMA");
  // A fresh controlled tree must not let Prisma load an unsealed dotenv file.
  for (const relative of [".env", "services/api/.env", "services/api/prisma/.env"]) need(!fs.existsSync(path.join(ROOT, relative)), "TASK16_MIGRATE_DOTENV_PRESENT");
  return ledger;
}

function identitySql(nonce, withLedger) {
  const ledger = withLedger ? `,'ledger',(SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM public._prisma_migrations)` : `,'ledgerExists',pg_catalog.to_regclass('public._prisma_migrations') IS NOT NULL,'publicRelations',(SELECT count(*)::integer FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f'))`;
  return `BEGIN READ ONLY;\nSELECT pg_catalog.json_build_object('database',pg_catalog.current_database(),'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'ownerRole',current_user::text,'loginRole',session_user::text,'ownerIsDatabaseOwner',EXISTS(SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname=pg_catalog.current_database() AND r.rolname=current_user),'tls',coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false),'version',pg_catalog.current_setting('server_version_num')::integer,'replication',pg_catalog.current_setting('session_replication_role'),'readOnly',pg_catalog.current_setting('default_transaction_read_only'),'nonce',n.nonce${ledger}) FROM (SELECT '${nonce}' AS nonce) n;\nROLLBACK;`;
}

async function ownerRead(context, proof, label, withLedger) {
  const nonce = randomBytes(32).toString("hex");
  const result = await context.resource.execOwnerSql(identitySql(nonce, withLedger), label);
  need(typeof result?.stdout === "string" && Buffer.byteLength(result.stdout) <= OUTPUT_LIMIT, "TASK16_MIGRATE_OWNER_RESULT");
  const row = JSON.parse(result.stdout.trim());
  need(row.nonce === nonce && row.database === proof.receipt.databaseName && row.databaseOid === proof.transport.databaseOid && row.systemIdentifier === proof.transport.systemIdentifier && row.ownerRole === OWNER && row.loginRole === OWNER && row.ownerIsDatabaseOwner === true && row.tls === true && row.version >= 160000 && row.version < 170000 && row.replication === "origin" && row.readOnly === "off", "TASK16_MIGRATE_OWNER_IDENTITY");
  return row;
}

async function migrateTask16Baseline(context, injectedCommand, injectedProcess) {
  let attempted = false;
  try {
    context = { ...context, source: structuredClone(context.source), ownerTransport: { ...context.ownerTransport }, credentials: { owner: context.credentials.owner } };
    const proof = resourceProof(context);
    const ledger = sourceFiles(context);
    const tools = { pnpm: { ...context.source.inputs.tools.pnpm }, node: { ...context.source.inputs.tools.node } };
    const pnpm = qualified(tools.pnpm.path, 512 * 1024 * 1024, true), node = qualified(tools.node.path, 512 * 1024 * 1024, true);
    need(pnpm.sha256 === tools.pnpm.sha256 && node.sha256 === tools.node.sha256 && tools.node.path === fs.realpathSync(process.execPath), "TASK16_MIGRATE_TOOL_IDENTITY");
    const before = await ownerRead(context, proof, "task16-migration-preflight", false);
    need(before.ledgerExists === false && before.publicRelations === 0, "TASK16_MIGRATE_FRESH_DATABASE_REQUIRED");
    need(/^[a-f0-9]{96}$/u.test(context.credentials.owner), "TASK16_MIGRATE_CREDENTIAL");
    const url = new URL(`postgresql://${OWNER}:${context.credentials.owner}@127.0.0.1:${proof.receipt.port}/${proof.receipt.databaseName}`);
    for (const [key, value] of Object.entries({ schema: "public", connection_limit: "1", sslmode: "require", sslaccept: "strict", sslcert: context.resource.caPath, connect_timeout: "5", pool_timeout: "5", application_name: "jg-task16-baseline-migrate" })) url.searchParams.set(key, value);
    const env = { PATH: [...new Set([path.dirname(tools.node.path), path.dirname(tools.pnpm.path), "/usr/bin", "/bin"])].join(":"), LANG: "C", LC_ALL: "C", TZ: "Asia/Shanghai", CI: "true", NODE_ENV: "test", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: url.toString() };
    sourceFiles(context);
    need(qualified(tools.pnpm.path, 512 * 1024 * 1024, true, pnpm.identity).sha256 === tools.pnpm.sha256 && qualified(tools.node.path, 512 * 1024 * 1024, true, node.identity).sha256 === tools.node.sha256, "TASK16_MIGRATE_TOOL_IDENTITY");
    resourceProof(context, proof); need(!context.signal.aborted, "TASK16_MIGRATE_ABORTED");
    const command = injectedCommand ?? ((...args) => nativeCommand(...args, injectedProcess));
    attempted = true;
    const result = await command(tools.pnpm.path, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy", "--schema", path.join(ROOT, "services/api/prisma/schema.prisma")], { cwd: ROOT, env, signal: context.signal, timeoutMs: 180000, maxOutputBytes: OUTPUT_LIMIT });
    need(!context.signal.aborted, "TASK16_MIGRATE_ABORTED");
    need(result?.actualSettled === true && result.code === 0 && !result.timedOut, "TASK16_MIGRATE_COMMAND_FAILED");
    need((typeof result.stdout === "string" || Buffer.isBuffer(result.stdout)) && (typeof result.stderr === "string" || Buffer.isBuffer(result.stderr)), "TASK16_MIGRATE_COMMAND_RESULT");
    const stdout = Buffer.from(result.stdout), stderr = Buffer.from(result.stderr);
    need(stdout.length + stderr.length <= OUTPUT_LIMIT, "TASK16_MIGRATE_OUTPUT_LIMIT");
    sourceFiles(context); resourceProof(context, proof);
    need(qualified(tools.pnpm.path, 512 * 1024 * 1024, true, pnpm.identity).sha256 === tools.pnpm.sha256 && qualified(tools.node.path, 512 * 1024 * 1024, true, node.identity).sha256 === tools.node.sha256, "TASK16_MIGRATE_TOOL_IDENTITY");
    const after = await ownerRead(context, proof, "task16-migration-ledger", true);
    need(JSON.stringify(after.ledger) === JSON.stringify(ledger), "TASK16_MIGRATE_LEDGER_MISMATCH");
    resourceProof(context, proof);
    return { status: "BASELINE_MIGRATIONS_LEDGER_VERIFIED", sourceSha: context.source.candidateSha, migrationCount: 203, ledgerSha256: hash(JSON.stringify(ledger)), command: { exitCode: 0, stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) }, financialAcceptance: false, tlsAcceptance: false };
  } catch (error) {
    const code = typeof error?.code === "string" && /^(?:TASK16_MIGRATE|TASK01_RESOURCE)_[A-Z0-9_]+$/u.test(error.code) ? error.code : "TASK16_MIGRATE_FAILED_CLOSED";
    throw Object.assign(new Error(code), { code, migrationOutcome: attempted ? "UNKNOWN_DO_NOT_RETRY" : "NOT_ATTEMPTED" });
  }
}
module.exports = { migrateTask16Baseline };
