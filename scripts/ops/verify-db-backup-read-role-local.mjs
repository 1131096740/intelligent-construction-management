import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const receiptIndex = process.argv.indexOf("--receipt");
assert(receiptIndex > 0 && process.argv[receiptIndex + 1], "--receipt requires a new absolute output path");
const receipt = process.argv[receiptIndex + 1];
assert(receipt.startsWith("/") && !existsSync(receipt), "receipt must be a new absolute path");
for (const key of ["DATABASE_URL", "DATABASE_OWNER_URL", "PG_DATABASE_URL", "PGSERVICE", "PGHOST"]) {
  assert(!process.env[key], "local verification refuses inherited database targets");
}
assert(!process.env.DOCKER_HOST || /^(unix:|npipe:)/u.test(process.env.DOCKER_HOST), "local Docker endpoint required");
const passwords = [randomBytes(24).toString("hex"), randomBytes(24).toString("hex"), randomBytes(24).toString("hex")];
function redact(value) {
  return passwords.reduce((text, password) => text.replaceAll(password, "<REDACTED>"), String(value));
}
function command(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw new Error(redact(result.error.message));
  if (!options.allowFailure && result.status !== 0) throw new Error(redact(result.stderr).slice(-1800));
  return result;
}
const context = JSON.parse(command(["docker", "context", "inspect"]).stdout)[0];
assert(/^(unix:|npipe:)/u.test(context.Endpoints.docker.Host), "local Docker context required");
const runId = `backup-read-role-${Date.now()}-${process.pid}`;
const startedAt = new Date().toISOString();
const container = command(["docker", "run", "--detach", "--rm", "--pull=never", "--name", `jiangkong-${runId}`,
  "--label", `jiangkong.backup-read-role-run=${runId}`, "--network=none", "--tmpfs", "/var/lib/postgresql/data",
  "--env", "POSTGRES_USER=fixture_owner", "--env", "POSTGRES_DB=backup_fixture", "--env", "POSTGRES_PASSWORD",
  "postgres:16"], { env: { ...process.env, POSTGRES_PASSWORD: passwords[0] } }).stdout.trim();
const cases = [];
function sql(text, database = "backup_fixture") {
  return command(["docker", "exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "fixture_owner", "-d", database, "-At"], { input: text }).stdout.trim();
}
function put(path, text) {
  command(["docker", "exec", "-i", container, "bash", "-c", `umask 077; cat > ${path}; chmod 600 ${path}`], { input: text });
}
function backup(role, destination, allowFailure = false) {
  return command(["docker", "exec", "--env", `DATABASE_ENV_FILE=/tmp/${role}.env`, "--env", "DB_BACKUP_READ_ONLY_ROLE_REQUIRED=true",
    "--env", `BACKUP_DIR=/tmp/${destination}`, container, "bash", "/tmp/db-backup.sh"], { allowFailure });
}
function rejects(id, role, expected) {
  const result = backup(role, id, true);
  assert.notEqual(result.status, 0, `${id} should be refused`);
  assert.match(result.stderr, expected);
  assert.equal(sql("SELECT has_table_privilege('fixture_runtime','\"OperatingLedgerWriteSecret\"','SELECT');"), "f");
  const count = command(["docker", "exec", container, "bash", "-c", `if test -d /tmp/${id}; then find /tmp/${id} -maxdepth 1 -type f ! -name '.db-backup.lock' | wc -l; else echo 0; fi`]).stdout.trim();
  assert.equal(count, "0", "failure must not publish a dump/checksum/receipt");
  cases.push({ id, passed: true, exitCode: result.status, publishedArtifacts: 0 });
}
let containerRemoved = false;
let imageId;
try {
  for (let attempt = 0; ; attempt += 1) {
    const result = command(["docker", "exec", "--env", "PGPASSWORD", container, "psql", "-h", "127.0.0.1", "-U", "fixture_owner", "-d", "backup_fixture", "-Atc", "SELECT 1"], { allowFailure: true, env: { ...process.env, PGPASSWORD: passwords[0] } });
    if (result.status === 0 && result.stdout.trim() === "1") break;
    assert(attempt < 60, "local PG16 did not become ready");
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  const details = JSON.parse(command(["docker", "inspect", container]).stdout)[0];
  assert.equal(details.Config.Labels["jiangkong.backup-read-role-run"], runId);
  assert.equal(details.HostConfig.NetworkMode, "none");
  assert.deepEqual(details.HostConfig.Binds ?? [], []);
  imageId = details.Image;
  assert.equal(sql("SELECT current_setting('server_version_num')::integer / 10000;"), "16");
  sql(`CREATE ROLE fixture_runtime LOGIN PASSWORD '${passwords[1]}';
CREATE ROLE fixture_backup LOGIN PASSWORD '${passwords[2]}';
CREATE TABLE "OperatingLedgerWriteSecret"(id integer PRIMARY KEY, "secretHash" text NOT NULL);
CREATE TABLE "OperatingLedgerWriteContext"(id integer PRIMARY KEY, marker text NOT NULL);
CREATE TABLE "BackupBusinessFixture"(id serial PRIMARY KEY, amount bigint NOT NULL);
INSERT INTO "OperatingLedgerWriteSecret" VALUES(1,'fixture-only-hash');
INSERT INTO "OperatingLedgerWriteContext" VALUES(1,'fixture-context');
INSERT INTO "BackupBusinessFixture"(amount) VALUES(9007199254740993);
GRANT USAGE ON SCHEMA public TO fixture_runtime, fixture_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_runtime, fixture_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_backup;
REVOKE ALL ON "OperatingLedgerWriteSecret", "OperatingLedgerWriteContext" FROM fixture_runtime;
GRANT INSERT, UPDATE, DELETE ON "BackupBusinessFixture" TO fixture_runtime;`);
  for (const name of ["db-backup.sh", "db-backup-read-role.sql", "run-production-db-backup.sh"]) {
    put(`/tmp/${name}`, readFileSync(resolve(root, "scripts/ops", name), "utf8"));
  }
  for (const [name, user, password] of [["fixture_backup", "fixture_backup", passwords[2]], ["fixture_runtime", "fixture_runtime", passwords[1]], ["fixture_owner", "fixture_owner", passwords[0]]]) {
    put(`/tmp/${name}.env`, `DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:5432/backup_fixture\n`);
  }
  sql('CREATE ROLE fixture_read_group; GRANT SELECT ON "BackupBusinessFixture" TO fixture_read_group; GRANT fixture_read_group TO fixture_backup WITH INHERIT FALSE, SET TRUE;');
  const dump = backup("fixture_backup", "complete-backup").stdout.trim();
  assert(dump.startsWith("/tmp/complete-backup/jiangkong-"));
  command(["docker", "exec", container, "createdb", "-U", "fixture_owner", "backup_restored"]);
  command(["docker", "exec", container, "pg_restore", "--exit-on-error", "--no-owner", "-U", "fixture_owner", "-d", "backup_restored", dump]);
  assert.equal(sql('SELECT count(*) FROM "OperatingLedgerWriteSecret"; SELECT count(*) FROM "OperatingLedgerWriteContext"; SELECT amount FROM "BackupBusinessFixture";', "backup_restored"), "1\n1\n9007199254740993");
  assert.equal(sql("SELECT has_table_privilege('fixture_runtime','\"OperatingLedgerWriteSecret\"','SELECT');"), "f");
  cases.push({ id: "full-dump-and-real-restore", readOnlySetMembershipAllowed: true, passed: true, protectedControlTablesIncluded: true, moneyPrecisionPreserved: true, runtimeSecretReadDenied: true });
  rejects("runtime-role-rejected", "fixture_runtime", /application write|complete read/u);
  rejects("owner-role-rejected", "fixture_owner", /non-owner read-only role/u);
  sql('GRANT INSERT ON "BackupBusinessFixture" TO fixture_backup;');
  rejects("direct-write-role-rejected", "fixture_backup", /application write/u);
  sql('REVOKE INSERT ON "BackupBusinessFixture" FROM fixture_backup;');
  sql('GRANT UPDATE(amount) ON "BackupBusinessFixture" TO fixture_backup;');
  rejects("column-write-role-rejected", "fixture_backup", /application write/u);
  sql('REVOKE UPDATE(amount) ON "BackupBusinessFixture" FROM fixture_backup;');
  sql('CREATE ROLE fixture_writer; GRANT UPDATE ON "BackupBusinessFixture" TO fixture_writer; GRANT fixture_writer TO fixture_backup;');
  rejects("inherited-write-role-rejected", "fixture_backup", /application write/u);
  sql('REVOKE fixture_writer FROM fixture_backup; REVOKE UPDATE ON "BackupBusinessFixture" FROM fixture_writer; DROP ROLE fixture_writer;');
  sql('CREATE ROLE fixture_switch_writer; GRANT UPDATE ON "BackupBusinessFixture" TO fixture_switch_writer; GRANT fixture_switch_writer TO fixture_backup WITH INHERIT FALSE, SET TRUE;');
  assert.equal(sql("SELECT has_table_privilege('fixture_backup','\"BackupBusinessFixture\"','UPDATE'); SELECT pg_has_role('fixture_backup','fixture_switch_writer','SET');"), "f\nt");
  rejects("set-only-writer-role-rejected", "fixture_backup", /application write/u);
  sql('REVOKE fixture_switch_writer FROM fixture_backup; REVOKE UPDATE ON "BackupBusinessFixture" FROM fixture_switch_writer; DROP ROLE fixture_switch_writer;');
  sql('GRANT fixture_owner TO fixture_backup WITH INHERIT FALSE, SET TRUE;');
  rejects("set-only-owner-role-rejected", "fixture_backup", /non-owner read-only role/u);
  sql('REVOKE fixture_owner FROM fixture_backup;');
  sql(`CREATE FUNCTION public.fixture_controlled_write() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ UPDATE public."BackupBusinessFixture" SET amount = amount + 1 $$;
REVOKE ALL ON FUNCTION public.fixture_controlled_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fixture_controlled_write() TO fixture_backup;`);
  rejects("security-definer-write-rejected", "fixture_backup", /executable security-definer/u);
  sql('REVOKE EXECUTE ON FUNCTION public.fixture_controlled_write() FROM fixture_backup; CREATE ROLE fixture_function_executor; GRANT EXECUTE ON FUNCTION public.fixture_controlled_write() TO fixture_function_executor; GRANT fixture_function_executor TO fixture_backup WITH INHERIT FALSE, SET TRUE;');
  rejects("set-only-security-definer-write-rejected", "fixture_backup", /executable security-definer/u);
  sql('REVOKE fixture_function_executor FROM fixture_backup; REVOKE EXECUTE ON FUNCTION public.fixture_controlled_write() FROM fixture_function_executor; DROP ROLE fixture_function_executor; GRANT EXECUTE ON FUNCTION public.fixture_controlled_write() TO PUBLIC;');
  rejects("public-security-definer-write-rejected", "fixture_backup", /executable security-definer/u);
  sql('REVOKE EXECUTE ON FUNCTION public.fixture_controlled_write() FROM PUBLIC; DROP FUNCTION public.fixture_controlled_write();');
  sql('CREATE SCHEMA backup_aux; CREATE TABLE backup_aux.auxiliary(id integer); GRANT USAGE ON SCHEMA backup_aux TO fixture_backup; GRANT SELECT, INSERT ON backup_aux.auxiliary TO fixture_backup;');
  rejects("other-schema-write-role-rejected", "fixture_backup", /application write/u);
  sql('REVOKE INSERT ON backup_aux.auxiliary FROM fixture_backup;');
  sql('GRANT USAGE ON "BackupBusinessFixture_id_seq" TO fixture_backup;');
  rejects("sequence-write-role-rejected", "fixture_backup", /application write/u);
  sql('REVOKE USAGE ON "BackupBusinessFixture_id_seq" FROM fixture_backup;');
  sql('REVOKE SELECT ON "OperatingLedgerWriteSecret" FROM fixture_backup;');
  rejects("missing-protected-table-read-rejected", "fixture_backup", /complete read/u);
  sql('GRANT SELECT ON "OperatingLedgerWriteSecret" TO fixture_backup;');
  sql('ALTER TABLE "BackupBusinessFixture" ENABLE ROW LEVEL SECURITY;');
  rejects("rls-does-not-produce-partial-backup", "fixture_backup", /row-level security/u);
  sql('ALTER TABLE "BackupBusinessFixture" DISABLE ROW LEVEL SECURITY;');
  put("/tmp/capture-backup-env.sh", '#!/bin/bash\nprintf "%s|%s|%s|%s" "$DATABASE_ENV_FILE" "$BUSINESS_ENV_FILE" "$DB_BACKUP_READ_ONLY_ROLE_REQUIRED" "${PG_DATABASE_URL:-empty}"\n');
  command(["docker", "exec", container, "chmod", "700", "/tmp/capture-backup-env.sh"]);
  const routing = command(["docker", "exec", "--env", "BACKUP_SCRIPT=/tmp/capture-backup-env.sh", "--env", "PG_DATABASE_URL=must-not-survive", "--env", "DATABASE_ENV_FILE=/etc/jiangkong/api.env",
    container, "bash", "/tmp/run-production-db-backup.sh"]).stdout;
  assert.equal(routing, "/etc/jiangkong/db-backup-database.env|/etc/jiangkong/api.env|true|empty");
  cases.push({ id: "production-entry-uses-separated-private-files", passed: true, routingOnly: true });
} finally {
  const details = JSON.parse(command(["docker", "inspect", container]).stdout)[0];
  assert.equal(details.Config.Labels["jiangkong.backup-read-role-run"], runId);
  command(["docker", "rm", "--force", "--volumes", container]);
  containerRemoved = true;
}
const sources = ["scripts/ops/db-backup.sh", "scripts/ops/db-backup-read-role.sql", "scripts/ops/run-production-db-backup.sh", "scripts/ops/deploy-production-server.sh", "scripts/ops/verify-db-backup-read-role-local.mjs"];
const evidence = {
  schemaVersion: 1, executionScope: "isolated-local", productionAccessed: false, status: "passed", postgresMajorVersion: 16,
  candidateSha: command(["git", "-C", root, "rev-parse", "HEAD"]).stdout.trim(),
  sourceChanged: Boolean(command(["git", "-C", root, "status", "--porcelain"]).stdout.trim()),
  sourceSha256: Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")])),
  startedAt, completedAt: new Date().toISOString(), imageId, containerRemoved, cases,
  offsiteTransferTested: false, originalFullRelease: false, productionIdentityAndRoleValidated: false
};
writeFileSync(receipt, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ status: evidence.status, passedCases: cases.length, containerRemoved, receipt }));
