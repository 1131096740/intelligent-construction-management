"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const sourceCli = path.join(__dirname, "prepare-enterprise-acceptance.cjs");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

function fixture(t) {
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), "jg-source-seal-test-")));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "source");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  const cli = path.join(root, "scripts/prepare-enterprise-acceptance.cjs");
  if (existsSync(sourceCli)) copyFileSync(sourceCli, cli);
  function put(file, contents) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  put("services/api/prisma/schema.prisma", "// synthetic schema\n");
  put("services/api/prisma/migrations/migration_lock.toml", 'provider = "postgresql"\n');
  put("services/api/prisma/migrations/001_initial/migration.sql", "SELECT 1;\n");
  put("services/api/prisma/migrations/002_terminal/migration.sql", "SELECT 2;\n");
  function git(...args) {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", ...args], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  git("init", "--quiet", "--template=");
  git("config", "user.name", "Synthetic seal test");
  git("config", "user.email", "seal-test@example.invalid");
  function commit() { git("add", "."); git("commit", "--quiet", "-m", "synthetic source"); }
  commit();
  const packet = path.join(temporary, "packet.json");
  function run(...args) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: environment, encoding: "utf8", timeout: 15_000 });
    return { ...result, body: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
  }
  return { root, temporary, cli, packet, put, git, commit, run };
}

test("seals a clean committed source and verifies the same exact candidate offline", (t) => {
  const f = fixture(t);
  const prepared = f.run("--prepare", "--output", f.packet);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(prepared.body.status, "source-sealed");
  assert.equal(prepared.body.candidateSha, f.git("rev-parse", "HEAD"));
  assert.equal(prepared.body.migrationCount, 2);
  const verified = f.run("--verify", f.packet);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.body.status, "source-verified");
  assert.equal(verified.body.sealSha256, prepared.body.sealSha256);
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  assert.equal(packet.purpose, "source-seal-only");
  assert.equal(packet.scope.installedDependencies, "not-verified");
  assert.equal(packet.scope.httpPostgresAcceptance, "not-executed");
});

test("rejects execution and unknown options before preparing any artifact", (t) => {
  const f = fixture(t);
  const result = f.run("--prepare", "--output", f.packet, "--execute");
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "INVALID_ARGUMENTS");
  assert.equal(existsSync(f.packet), false);
});

test("rejects preparing an artifact inside the sealed source tree", (t) => {
  const f = fixture(t);
  const output = path.join(f.root, "packet.json");
  const result = f.run("--prepare", "--output", output);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "OUTPUT_IN_SOURCE");
  assert.equal(existsSync(output), false);
});

test("rejects committed symbolic links instead of following their contents", (t) => {
  const f = fixture(t);
  symlinkSync("pnpm-lock.yaml", path.join(f.root, "linked-source"));
  f.commit();
  const result = f.run("--prepare", "--output", f.packet);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "SOURCE_SYMLINK");
  assert.equal(existsSync(f.packet), false);
});

test("rejects a changed middle migration even when Git status hides its changes", (t) => {
  const f = fixture(t);
  const migration = "services/api/prisma/migrations/001_initial/migration.sql";
  f.git("update-index", "--assume-unchanged", migration);
  f.put(migration, "SELECT 999;\n");
  assert.equal(f.git("status", "--porcelain"), "");
  const result = f.run("--prepare", "--output", f.packet);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "SOURCE_CONTENT_MISMATCH");
  assert.equal(existsSync(f.packet), false);
});

test("writes the deterministic public checksum into the source-only artifact", (t) => {
  const f = fixture(t);
  const prepared = f.run("--prepare", "--output", f.packet);
  assert.equal(prepared.status, 0);
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  assert.equal(packet.sealSha256, prepared.body.sealSha256);
  const second = path.join(f.temporary, "second.json");
  assert.equal(f.run("--prepare", "--output", second).status, 0);
  assert.equal(readFileSync(second, "utf8"), readFileSync(f.packet, "utf8"));
});

test("rejects a linked packet rather than following an external file", (t) => {
  const f = fixture(t);
  assert.equal(f.run("--prepare", "--output", f.packet).status, 0);
  const linked = path.join(f.temporary, "linked.json");
  symlinkSync(f.packet, linked);
  const result = f.run("--verify", linked);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "ARTIFACT_SYMLINK");
});

test("rejects artifact paths whose parent is a symbolic link", (t) => {
  const f = fixture(t);
  const actual = path.join(f.temporary, "actual");
  const linked = path.join(f.temporary, "linked");
  mkdirSync(actual);
  symlinkSync(actual, linked, "dir");
  const result = f.run("--prepare", "--output", path.join(linked, "packet.json"));
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "ARTIFACT_SYMLINK");
  assert.equal(existsSync(path.join(actual, "packet.json")), false);
});

test("rejects a committed source without the Prisma schema", (t) => {
  const f = fixture(t);
  f.git("rm", "services/api/prisma/schema.prisma");
  f.commit();
  const result = f.run("--prepare", "--output", f.packet);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "REQUIRED_INPUT_MISSING");
});

test("seals every recursive migration.sql member rather than only terminal directories", (t) => {
  const f = fixture(t);
  const nested = "services/api/prisma/migrations/nested/additional/migration.sql";
  f.put(nested, "SELECT 3;\n");
  f.commit();
  const prepared = f.run("--prepare", "--output", f.packet);
  assert.equal(prepared.status, 0);
  assert.equal(prepared.body.migrationCount, 3);
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  assert.ok(packet.migrations.some((entry) => entry.path === nested));
});

test("rejects an artifact that deletes migration members and recomputes its public checksum", (t) => {
  const f = fixture(t);
  assert.equal(f.run("--prepare", "--output", f.packet).status, 0);
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  packet.migrations.shift();
  delete packet.sealSha256;
  packet.sealSha256 = require("node:crypto").createHash("sha256").update(JSON.stringify(packet)).digest("hex");
  writeFileSync(f.packet, JSON.stringify(packet));
  const result = f.run("--verify", f.packet);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "SOURCE_SEAL_MISMATCH");
});

test("rejects traversal supplied in an artifact without reading that path", (t) => {
  const f = fixture(t);
  assert.equal(f.run("--prepare", "--output", f.packet).status, 0);
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  packet.files[0].path = "../outside-source-DO-NOT-READ";
  writeFileSync(f.packet, JSON.stringify(packet));
  const result = f.run("--verify", f.packet);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "SOURCE_SEAL_MISMATCH");
  assert.ok(!result.stdout.includes("DO-NOT-READ"));
});

for (const change of ["missing migration", "extra migration", "changed lockfile", "staged source"]) {
  test(`rejects verifying a candidate with ${change}`, (t) => {
    const f = fixture(t);
    assert.equal(f.run("--prepare", "--output", f.packet).status, 0);
    if (change === "missing migration") rmSync(path.join(f.root, "services/api/prisma/migrations/001_initial/migration.sql"));
    if (change === "extra migration") f.put("services/api/prisma/migrations/003_extra/migration.sql", "SELECT 3;\n");
    if (change === "changed lockfile") f.put("pnpm-lock.yaml", "changed-lockfile\n");
    if (change === "staged source") { f.put("new-source.txt", "synthetic\n"); f.git("add", "new-source.txt"); }
    const result = f.run("--verify", f.packet);
    assert.equal(result.status, 1);
    assert.equal(result.body.code, "SOURCE_NOT_CLEAN");
  });
}

test("ignores inherited Git scope overrides and seals the script's own source", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [f.cli, "--prepare", "--output", f.packet], {
    cwd: f.root, env: { ...environment, GIT_DIR: "/untrusted/nonexistent", GIT_WORK_TREE: "/untrusted", GIT_INDEX_FILE: "/untrusted/index", GIT_CONFIG_PARAMETERS: "invalid override" }, encoding: "utf8", timeout: 15_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).candidateSha, f.git("rev-parse", "HEAD"));
});

test("does not overwrite an existing external artifact", (t) => {
  const f = fixture(t);
  writeFileSync(f.packet, "owned external record\n");
  const result = f.run("--prepare", "--output", f.packet);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(f.packet, "utf8"), "owned external record\n");
});

test("rejects extra migration SQL even when an ignore rule hides it from Git status", (t) => {
  const f = fixture(t);
  f.put(".gitignore", "services/api/prisma/migrations/ignored/\n");
  f.commit();
  f.put("services/api/prisma/migrations/ignored/migration.sql", "SELECT 999;\n");
  assert.equal(f.git("status", "--porcelain"), "");
  const result = f.run("--prepare", "--output", f.packet);
  assert.equal(result.status, 1);
  assert.equal(result.body.code, "MIGRATION_MEMBERSHIP_MISMATCH");
  assert.equal(existsSync(f.packet), false);
});
