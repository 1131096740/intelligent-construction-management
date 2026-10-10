import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./db-backup.sh", import.meta.url));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jiangkong-backup-read-role-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const commands = {
    flock: "#!/bin/sh\nexit 0\n",
    pg_restore: "#!/bin/sh\nexit 0\n",
    psql: `#!/bin/bash
set -euo pipefail
for arg in "$@"; do case "$arg" in --dbname=*) url="\${arg#--dbname=}";; esac; done
role="\${url#*://}"; role="\${role%%:*}"
printf 'psql %s\\n' "$role" >> "$CALLS_FILE"
cat > "$SQL_FILE"
exit "\${FAKE_PSQL_EXIT:-0}"
`,
    pg_dump: `#!/bin/bash
set -euo pipefail
for ((i=1;i<=$#;i++)); do if [[ "\${!i}" == --file ]]; then j=$((i+1)); output="\${!j}"; fi; done
url="\${!#}"; role="\${url#*://}"; role="\${role%%:*}"
printf 'pg_dump %s\\n' "$role" >> "$CALLS_FILE"
printf 'fixture-only-custom-dump' > "$output"
`
  };
  for (const [name, content] of Object.entries(commands)) {
    await writeFile(join(bin, name), content);
    await chmod(join(bin, name), 0o700);
  }
  const database = join(root, "backup-database.env");
  const business = join(root, "api.env");
  await writeFile(database, "DATABASE_URL=postgresql://fixture_backup:fixture-only@localhost/database\n", { mode: 0o600 });
  await writeFile(business, "DATABASE_URL=postgresql://fixture_runtime:fixture-only@localhost/database\nCOS_BUCKET=business-files-1234567890\n", { mode: 0o600 });
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(PG|DB_BACKUP|DATABASE|COS_BUCKET|BUSINESS_ENV_FILE)/u.test(key)) delete env[key];
  }
  Object.assign(env, {
    PATH: `${bin}:${process.env.PATH}`,
    CALLS_FILE: join(root, "calls"), SQL_FILE: join(root, "sql"),
    DATABASE_ENV_FILE: database, BUSINESS_ENV_FILE: business,
    DB_BACKUP_READ_ONLY_ROLE_REQUIRED: "true", BACKUP_DIR: join(root, "backups")
  });
  return { root, database, business, env };
}
async function calls(f) {
  return readFile(f.env.CALLS_FILE, "utf8").catch(() => "");
}
async function runCase(action) {
  const f = await fixture();
  try { await action(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}

test("checks the independent backup identity before dumping and never adopts the API identity", async () => runCase(async f => {
  const result = spawnSync("bash", [script], { env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await calls(f), "psql fixture_backup\npg_dump fixture_backup\n");
}));

test("rejects a failed read-role preflight before creating or publishing a backup", async () => runCase(async f => {
  const result = spawnSync("bash", [script], { env: { ...f.env, FAKE_PSQL_EXIT: "11" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(await calls(f), "psql fixture_backup\n");
  await assert.rejects(readFile(join(f.env.BACKUP_DIR, ".db-backup.lock")));
}));

test("cannot substitute an inherited libpq URL for the independent read-role connection", async () => runCase(async f => {
  const result = spawnSync("bash", [script], { env: { ...f.env, PG_DATABASE_URL: "postgresql://fixture_owner:fixture-only@localhost/database" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await calls(f), "psql fixture_backup\npg_dump fixture_backup\n");
}));

test("fails closed on an invalid read-role requirement", async () => runCase(async f => {
  const result = spawnSync("bash", [script], { env: { ...f.env, DB_BACKUP_READ_ONLY_ROLE_REQUIRED: "invalid" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(await calls(f), "");
}));

test("does not fall back to inherited credentials if the dedicated database file is missing", async () => runCase(async f => {
  await rm(f.database);
  const result = spawnSync("bash", [script], { env: { ...f.env, DATABASE_URL: "postgresql://fixture_runtime:fixture-only@localhost/database" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(await calls(f), "");
}));

test("requires known business-bucket metadata without using its database credentials", async () => runCase(async f => {
  await writeFile(f.business, "DATABASE_URL=postgresql://fixture_runtime:fixture-only@localhost/database\n", { mode: 0o600 });
  const result = spawnSync("bash", [script], { env: f.env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(await calls(f), "");
}));

test("still refuses a business bucket after database credentials have been separated", async () => runCase(async f => {
  const transfer = join(f.root, "transfer.mjs");
  await writeFile(transfer, "throw new Error('must not transfer');\n");
  const result = spawnSync("bash", [script], { env: {
    ...f.env, DB_BACKUP_OFFSITE_REQUIRED: "true", DB_BACKUP_TRANSFER_SCRIPT: transfer,
    DB_BACKUP_COS_SECRET_ID: "fixture-only-secret-id", DB_BACKUP_COS_SECRET_KEY: "fixture-only-secret-key",
    DB_BACKUP_COS_BUCKET: "business-files-1234567890", DB_BACKUP_COS_REGION: "ap-chengdu"
  }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not use the business file bucket/u);
  assert.equal(await calls(f), "");
}));
