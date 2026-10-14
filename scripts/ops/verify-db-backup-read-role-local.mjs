import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const receiptIndex = process.argv.indexOf("--receipt");
assert(receiptIndex > 0 && process.argv[receiptIndex + 1], "--receipt requires a new absolute output path");
const receipt = process.argv[receiptIndex + 1];
assert(receipt.startsWith("/") && !existsSync(receipt), "receipt must be a new absolute path");
for (const key of ["DATABASE_URL", "DATABASE_OWNER_URL", "PG_DATABASE_URL", "PGSERVICE", "PGHOST"]) {
  assert(!process.env[key], "local verification refuses inherited database targets");
}
assert(!process.env.DOCKER_HOST || /^(unix:|npipe:)/u.test(process.env.DOCKER_HOST), "local Docker endpoint required");
const passwords = [randomBytes(24).toString("hex"), randomBytes(24).toString("hex"), randomBytes(24).toString("hex") + ":\\+ #"];
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
  "--env", "POSTGRES_HOST_AUTH_METHOD=scram-sha-256", "--env", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=trust", "--env", "POSTGRES_USER=fixture_owner", "--env", "POSTGRES_DB=backup_fixture", "--env", "POSTGRES_PASSWORD",
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
  // Copy the cached official Linux Node20 executable; never install packages or mount host paths.
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "jgzg-backup-node-"));
  let runtimeContainer;
  try {
    runtimeContainer = command(["docker", "create", "--pull=never", "--network=none", "--label", `jiangkong.backup-read-role-run=${runId}`,
      "node:20.20.2-bookworm-slim", "node", "--version"]).stdout.trim();
    command(["docker", "cp", `${runtimeContainer}:/usr/local/bin/node`, join(runtimeDirectory, "node")]);
    command(["docker", "cp", join(runtimeDirectory, "node"), `${container}:/usr/local/bin/node`]);
    assert.match(command(["docker", "exec", container, "node", "--version"]).stdout, /^v20\./u);
  } finally {
    if (runtimeContainer) command(["docker", "rm", "--force", runtimeContainer]);
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
  imageId = details.Image;
  assert.equal(sql("SELECT current_setting('server_version_num')::integer / 10000;"), "16");
  sql(`CREATE ROLE fixture_runtime LOGIN PASSWORD '${passwords[1]}';
CREATE ROLE fixture_backup LOGIN PASSWORD '${passwords[2]}';
CREATE TABLE "OperatingLedgerWriteSecret"(id integer PRIMARY KEY, "secretHash" text NOT NULL);
CREATE TABLE "OperatingLedgerWriteContext"(id integer PRIMARY KEY, marker text NOT NULL);
CREATE TABLE "BackupBusinessFixture"(id serial PRIMARY KEY, amount bigint NOT NULL);
CREATE TABLE "FileObject"(id text PRIMARY KEY,bucket text,"objectKey" text,"sizeBytes" integer,"contentSha256" text,"storageStatus" text);
INSERT INTO "FileObject" VALUES ('a','fixture-bucket','fixture/a',3,repeat('a',64),'active'),('b','fixture-bucket','fixture/b',4,repeat('b',64),'superseded');
INSERT INTO "OperatingLedgerWriteSecret" VALUES(1,'fixture-only-hash');
INSERT INTO "OperatingLedgerWriteContext" VALUES(1,'fixture-context');
INSERT INTO "BackupBusinessFixture"(amount) VALUES(9007199254740993);
GRANT USAGE ON SCHEMA public TO fixture_runtime, fixture_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_runtime, fixture_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_backup;
REVOKE ALL ON "OperatingLedgerWriteSecret", "OperatingLedgerWriteContext" FROM fixture_runtime;
GRANT INSERT, UPDATE, DELETE ON "BackupBusinessFixture" TO fixture_runtime;`);
  for (const name of ["db-backup.sh", "db-backup-read-role.sql", "run-production-db-backup.sh", "private-libpq-service.mjs", "export-private-object-inventory.mjs", "private-object-backup.mjs", "restricted-cos-xml.mjs"]) {
    put(`/tmp/${name}`, readFileSync(resolve(root, "scripts/ops", name), "utf8"));
  }
  for (const [name, user, password] of [["fixture_backup", "fixture_backup", passwords[2]], ["fixture_runtime", "fixture_runtime", passwords[1]], ["fixture_owner", "fixture_owner", passwords[0]]]) {
    put(`/tmp/${name}.env`, `DATABASE_URL=postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:5432/backup_fixture\n`);
  }
  sql('CREATE ROLE fixture_read_group; GRANT SELECT ON "BackupBusinessFixture" TO fixture_read_group; GRANT fixture_read_group TO fixture_backup WITH INHERIT FALSE, SET TRUE;');
  put("/tmp/fixture_wrong_password.env", "DATABASE_URL=postgresql://fixture_backup:deliberately-wrong@127.0.0.1:5432/backup_fixture\n");
  const authenticationFailure = backup("fixture_wrong_password", "wrong-password", true);
  assert.notEqual(authenticationFailure.status, 0);
  assert.match(authenticationFailure.stderr, /password authentication failed/u);
  cases.push({ id: "wrong-private-password-rejected", passed: true });
  const dump = backup("fixture_backup", "complete-backup").stdout.trim();
  assert(dump.startsWith("/tmp/complete-backup/jiangkong-"));
  command(["docker", "exec", container, "createdb", "-U", "fixture_owner", "backup_restored"]);
  command(["docker", "exec", container, "pg_restore", "--exit-on-error", "--no-owner", "-U", "fixture_owner", "-d", "backup_restored", dump]);
  assert.equal(sql('SELECT count(*) FROM "OperatingLedgerWriteSecret"; SELECT count(*) FROM "OperatingLedgerWriteContext"; SELECT amount FROM "BackupBusinessFixture";', "backup_restored"), "1\n1\n9007199254740993");
  assert.equal(sql("SELECT has_table_privilege('fixture_runtime','\"OperatingLedgerWriteSecret\"','SELECT');"), "f");
  cases.push({ id: "full-dump-and-real-restore", readOnlySetMembershipAllowed: true, passed: true, protectedControlTablesIncluded: true, moneyPrecisionPreserved: true, runtimeSecretReadDenied: true });
  put('/tmp/inventory-export-probe.mjs', `import {readFile} from 'node:fs/promises';
import {exportInventory} from './export-private-object-inventory.mjs';
const url=(await readFile('/tmp/fixture_backup.env','utf8')).trim().slice('DATABASE_URL='.length);
const result=await exportInventory({databaseUrl:url,expectedUser:'fixture_backup',bucket:'fixture-bucket'});
const rows=JSON.parse(result.bytes);
if(result.recordCount!==2||rows.map(r=>r.storageStatus).join(',')!=='active,superseded')process.exit(91);
console.log(JSON.stringify({recordCount:result.recordCount,inventorySha256:result.sha256}));
`);
  const inventory=JSON.parse(command(['docker','exec',container,'node','/tmp/inventory-export-probe.mjs']).stdout);
  assert.equal(inventory.recordCount,2);assert.match(inventory.inventorySha256,/^[a-f0-9]{64}$/u);
  cases.push({id:'actual-readonly-all-status-FileObject-inventory',passed:true});
  sql('CREATE DATABASE "backup_fixture#archive" TEMPLATE backup_fixture;');
  sql('UPDATE "BackupBusinessFixture" SET amount=109;', "backup_fixture#archive");
  const originalHashTarget = command(["docker", "exec", "--env", "PGPASSWORD", container, "psql", "-X", "-At",
    "--dbname=postgresql://fixture_backup@127.0.0.1:5432/backup_fixture#archive", "-c", "SELECT current_database();"],
    { env: { ...process.env, PGPASSWORD: passwords[2] } }).stdout.trim();
  assert.equal(originalHashTarget, "backup_fixture#archive");
  cases.push({ id: "native-libpq-raw-hash-selects-original-database", passed: true });
  for (const [name, path] of [["raw_hash", "backup_fixture#archive"], ["dot_path", "db/../backup_fixture"], ["encoded_dot", "db/%2e%2e/backup_fixture"]]) {
    put(`/tmp/${name}.env`, `DATABASE_URL=postgresql://fixture_backup:${encodeURIComponent(passwords[2])}@127.0.0.1:5432/${path}\n`);
    const refusal = backup(name, `refuse-${name}`, true);
    assert.notEqual(refusal.status, 0, "URI normalization must not select another database");
    assert.match(refusal.stderr, /Private libpq connection preparation failed/u);
    assert.equal(command(["docker", "exec", container, "bash", "-c", `test ! -e /tmp/refuse-${name}; printf clean`]).stdout, "clean");
    cases.push({ id: `public-backup-${name}-refused-before-target-access`, passed: true });
  }
  put("/tmp/encoded_hash.env", `DATABASE_URL=postgresql://fixture_backup:${encodeURIComponent(passwords[2])}@127.0.0.1:5432/backup_fixture%23archive\n`);
  const archiveDump = backup("encoded_hash", "archive-backup").stdout.trim();
  command(["docker", "exec", container, "createdb", "-U", "fixture_owner", "archive_restored"]);
  command(["docker", "exec", container, "pg_restore", "--exit-on-error", "--no-owner", "-U", "fixture_owner", "-d", "archive_restored", archiveDump]);
  assert.equal(sql('SELECT amount FROM "BackupBusinessFixture"; SELECT count(*) FROM "OperatingLedgerWriteSecret";', "archive_restored"), "109\n1");
  assert.equal(sql('SELECT amount FROM "BackupBusinessFixture";'), "9007199254740993");
  cases.push({ id: "encoded-hash-backup-restores-original-target-only", passed: true });
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
  sql('CREATE ROLE fixture_admin_writer; GRANT UPDATE ON "BackupBusinessFixture" TO fixture_admin_writer; GRANT fixture_admin_writer TO fixture_backup WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;');
  assert.equal(sql("SELECT pg_has_role('fixture_backup','fixture_admin_writer','SET'); SELECT has_table_privilege('fixture_backup','\"BackupBusinessFixture\"','UPDATE');"), "f\nf");
  rejects("admin-only-writer-role-rejected", "fixture_backup", /role administration/u);
  sql('REVOKE fixture_admin_writer FROM fixture_backup; REVOKE UPDATE ON "BackupBusinessFixture" FROM fixture_admin_writer; DROP ROLE fixture_admin_writer;');
  sql('ALTER DATABASE backup_fixture OWNER TO fixture_backup; REVOKE CREATE ON DATABASE backup_fixture FROM fixture_backup; REVOKE CREATE ON SCHEMA public FROM pg_database_owner;');
  assert.equal(sql("SELECT has_database_privilege('fixture_backup','backup_fixture','CREATE');"), "f");
  rejects("database-owner-with-revoked-create-rejected", "fixture_backup", /non-owner read-only role/u);
  sql('ALTER DATABASE backup_fixture OWNER TO fixture_owner; GRANT CREATE ON SCHEMA public TO pg_database_owner;');
  sql('CREATE SCHEMA backup_owned AUTHORIZATION fixture_backup; REVOKE CREATE ON SCHEMA backup_owned FROM fixture_backup;');
  assert.equal(sql("SELECT has_schema_privilege('fixture_backup','backup_owned','CREATE');"), "f");
  rejects("schema-owner-with-revoked-create-rejected", "fixture_backup", /application write/u);
  sql('DROP SCHEMA backup_owned;');
  for (const serverRole of ["pg_execute_server_program", "pg_write_server_files", "pg_signal_backend", "pg_checkpoint"]) {
    sql(`GRANT ${serverRole} TO fixture_backup WITH INHERIT FALSE, SET TRUE;`);
    rejects(`server-capability-${serverRole}-rejected`, "fixture_backup", /server mutation/u);
    sql(`REVOKE ${serverRole} FROM fixture_backup;`);
  }
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
  assert.equal(command(["docker", "exec", container, "find", "/tmp", "-maxdepth", "1", "-name", "jgzg-private-libpq-*"]).stdout.trim(), "");
  cases.push({ id: "private-service-and-password-files-cleaned-after-success-and-failure", passed: true });
  const {buildBackupPermissionSql}=await import('./controlled-backup-permission-sql.mjs');
  sql('CREATE ROLE jiangkong; CREATE ROLE jg_pol275_owner; CREATE ROLE jiangkong_runtime; CREATE ROLE postgres; CREATE DATABASE permission_fixture OWNER jiangkong;');
  sql(`SET ROLE jiangkong;
CREATE TABLE public."OperatingLedgerWriteSecret"(value text); INSERT INTO public."OperatingLedgerWriteSecret" VALUES('fixture-only-private');
CREATE TABLE public."PermissionBusinessFixture"(id serial,amount bigint); INSERT INTO public."PermissionBusinessFixture"(amount) VALUES(9007199254740993);
CREATE FUNCTION public.assert_fund_movement_write_context() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN IF current_setting('fixture.context_valid',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Invalid fixture context'; END IF; RETURN 42; END $$;
RESET ROLE;`,'permission_fixture');
  const databaseIdentitySha256=sql("SELECT encode(sha256(convert_to(system_identifier::text||'|'||current_database()||'|public','UTF8')),'hex') FROM pg_control_system()",'permission_fixture');
  const helperDefinitionSha256=sql("SELECT encode(sha256(convert_to(pg_get_functiondef('public.assert_fund_movement_write_context()'::regprocedure),'UTF8')),'hex')",'permission_fixture');
  const permissionPacket=buildBackupPermissionSql({database:'permission_fixture',databaseIdentitySha256,helperDefinitionSha256,creators:['jiangkong','jg_pol275_owner','postgres']});
  sql(permissionPacket.applySql,'permission_fixture');
  const permissionQuery=text=>command(['docker','exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','fixture_owner','-d','permission_fixture','-At'],{input:text}).stdout.trim();
  const installed=JSON.parse(permissionQuery(permissionPacket.inspectSql));
  assert.equal(installed.loginEnabled,false);assert.equal(installed.superuser,false);assert.equal(installed.createsRoles,false);assert.equal(installed.bypassRls,false);
  cases.push({id:'actual-no-login-read-identity-permission-transaction',passed:true});
  assert.equal(sql("SELECT has_function_privilege('jiangkong_backup_reader','public.assert_fund_movement_write_context()','EXECUTE'); SELECT has_function_privilege('jiangkong_runtime','public.assert_fund_movement_write_context()','EXECUTE'); SELECT has_table_privilege('jiangkong_runtime','public.\"OperatingLedgerWriteSecret\"','SELECT');",'permission_fixture'),'f\nt\nf');
  cases.push({id:'helper-public-revoked-runtime-retained-secret-read-still-denied',passed:true});
  assert.equal(permissionQuery("BEGIN; SET LOCAL ROLE jiangkong_runtime; SET LOCAL fixture.context_valid='yes'; SELECT public.assert_fund_movement_write_context(); ROLLBACK;"),'42');
  const invalidContext=command(['docker','exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','fixture_owner','-d','permission_fixture','-At'],{input:"BEGIN; SET LOCAL ROLE jiangkong_runtime; SELECT public.assert_fund_movement_write_context(); ROLLBACK;",allowFailure:true});
  assert.notEqual(invalidContext.status,0);assert.match(invalidContext.stderr,/Invalid fixture context/);
  cases.push({id:'minimal-real-helper-context-legal-and-illegal-still-enforced',passed:true,fullFundsDomainTest:false});
  const wrongOid=command(['docker','exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','fixture_owner','-d','permission_fixture','-At'],{input:permissionPacket.rollbackSql(installed.roleOid+1),allowFailure:true});
  assert.notEqual(wrongOid.status,0);assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='jiangkong_backup_reader'",'permission_fixture'),'1');
  cases.push({id:'wrong-recorded-role-oid-refuses-rollback-without-mutation',passed:true});
  put('/tmp/controlled-backup-connection.mjs',readFileSync(resolve(root,'scripts/ops/controlled-backup-connection.mjs'),'utf8'));
  put('/tmp/credential-lifecycle-probe.mjs',`import {mkdir,readFile,lstat,writeFile,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {installConnection,withdrawConnection} from './controlled-backup-connection.mjs';
import {prepareService} from './private-libpq-service.mjs';
const directory='/tmp/controlled-reader-private';await mkdir(directory,{mode:0o700});
const file=directory+'/connection.env';
const query=async input=>{try{execFileSync('psql',['-X','-q','-U','fixture_owner','-d','permission_fixture','--set=ON_ERROR_STOP=1'],{input,stdio:['pipe','pipe','pipe']});}catch{throw Error('fixture query refused');}};
const pin=await installConnection({file,database:'permission_fixture',roleOid:${installed.roleOid},databaseIdentitySha256:'${databaseIdentitySha256}',query});
const url=(await readFile(file,'utf8')).trim().slice(13),service=await prepareService(url);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')));env.PGSERVICEFILE=service+'/service.conf';
const amount=execFileSync('psql',['-X','-q','-t','-A','--no-password','--dbname=service=jgzg_backup','-c','SELECT amount FROM public."PermissionBusinessFixture"'],{env,stdio:['ignore','pipe','pipe']}).toString().trim();
if(amount!=='9007199254740993')throw Error('real SCRAM authentication did not preserve amount');
await withdrawConnection({file,pin,query});
try{execFileSync('psql',['-X','-q','--no-password','--dbname=service=jgzg_backup','-c','SELECT 1'],{env,stdio:['ignore','pipe','pipe']});throw Error('withdrawal still authenticates');}catch(e){if(e.message==='withdrawal still authenticates')throw e;}
try{await lstat(file);throw Error('owned connection not removed');}catch(e){if(e.code!=='ENOENT')throw e;}
console.log(JSON.stringify({scramLoginVerified:true,withdrawalRefusesLogin:true,fileRemoved:true}));`);
  const lifecycle=JSON.parse(command(['docker','exec',container,'node','/tmp/credential-lifecycle-probe.mjs']).stdout);
  assert.equal(lifecycle.scramLoginVerified,true);assert.equal(lifecycle.withdrawalRefusesLogin,true);assert.equal(lifecycle.fileRemoved,true);
  cases.push({id:'actual-private-reader-credential-SCRAM-install-and-precise-withdrawal',passed:true});
  sql(permissionPacket.rollbackSql(installed.roleOid),'permission_fixture');
  assert.equal(permissionQuery("SELECT count(*) FROM pg_roles WHERE rolname='jiangkong_backup_reader'; SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('public.assert_fund_movement_write_context()') AND a.grantee=0 AND a.privilege_type='EXECUTE';"),'0\n1');
  assert.equal(sql('SELECT amount FROM public."PermissionBusinessFixture"','permission_fixture'),'9007199254740993');
  cases.push({id:'exact-owned-role-and-effective-helper-acl-rollback-preserves-business',passed:true,rawNullAclRestored:false});
} finally {
  const details = JSON.parse(command(["docker", "inspect", container]).stdout)[0];
  assert.equal(details.Config.Labels["jiangkong.backup-read-role-run"], runId);
  command(["docker", "rm", "--force", "--volumes", container]);
  containerRemoved = true;
}
const sources = ["scripts/ops/private-libpq-service.mjs", "scripts/ops/db-backup.sh", "scripts/ops/db-backup-read-role.sql", "scripts/ops/run-production-db-backup.sh", "scripts/ops/deploy-production-server.sh", "scripts/ops/verify-db-backup-read-role-local.mjs", "scripts/ops/export-private-object-inventory.mjs", "scripts/ops/private-object-backup.mjs", "scripts/ops/controlled-backup-permission-sql.mjs", "scripts/ops/controlled-backup-connection.mjs"];
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
