"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync, unlinkSync, existsSync, symlinkSync, chmodSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const cli = path.join(__dirname, "prepare-task16-registered-pg.cjs");
const source = path.resolve(__dirname, "..");
const fragments = ["registered-funding.sql", "registered-history-revision.sql", "registered-write-authority.sql", "registered-canonical-proof.sql", "registered-intercompany.sql", "registered-canonical-adapter.sql", "registered-voucher.sql"];
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

function fixture(t) {
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), "jg-task16-packet-test-")));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "source");
  mkdirSync(root);
  function put(file, contents) {
    const dest = path.join(root, file); mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(dest, contents);
  }
  put("services/api/prisma/schema.prisma", "// synthetic source, never applied\n");
  put("services/api/prisma/migrations/migration_lock.toml", 'provider = "postgresql"\n');
  for (let i = 0; i < 203; i++) put(`services/api/prisma/migrations/${String(i).padStart(3, "0")}_synthetic/migration.sql`, `-- synthetic migration ${i}, never executed\n`);
  for (const file of fragments) put(`services/api/prisma/prepared/task16/${file}`, `-- synthetic ${file}, never executed\n`);
  put("services/api/src/database/registered-payment-postgres.fixture.ts", "// Synthetic fixture source, never imported.\n");
  put("services/api/src/database/registered-payment-postgres.cases.ts", readFileSync(path.join(source, "services/api/src/database/registered-payment-postgres.cases.ts")));
  function git(...args) {
    return execFileSync("git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", ...args], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  git("init", "--quiet", "--template="); git("config", "user.name", "Task16 synthetic source"); git("config", "user.email", "task16@example.invalid");
  function commit() { git("add", "."); git("commit", "--quiet", "-m", "synthetic task16 source"); return git("rev-parse", "HEAD"); }
  const sha = commit();
  const output = path.join(temporary, "packet");
  function run(...args) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: temporary, env: environment, encoding: "utf8", timeout: 15_000 });
    return { ...result, body: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
  }
  const prepare = (extra = [], destination = output, candidate = sha) => run("--prepare", "--repo", root, "--candidate-sha", candidate, "--output", destination, ...extra);
  return { root, temporary, output, packet: path.join(output, "packet.json"), sha, put, git, commit, run, prepare };
}

test("prepares the exact source-only installation and single-case packet and verifies it offline", (t) => {
  const f = fixture(t);
  const prepared = f.prepare();
  assert.equal(prepared.status, 0, prepared.stderr || JSON.stringify(prepared.body));
  assert.equal(prepared.body.status, "SOURCE_ONLY_NOT_EXECUTED");
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  assert.equal(packet.candidateSha, f.sha);
  assert.equal(packet.executionAllowed, false); assert.equal(packet.resourceExecutorImplemented, false);
  assert.equal(packet.migrations.length, 203);
  assert.deepEqual(packet.installation.fragments.map(row => path.basename(row.path)), fragments);
  assert.deepEqual(packet.cases.map(row => [row.id, row.handlerExport]), [["registered.null-cross-company.commit", "runRegisteredNullCrossCompanyCommit"]]);
  assert.equal(packet.cases[0].executed, false); assert.equal(packet.cases[0].sqlExecuted, false);
  const verified = f.run("--verify", "--packet", f.packet, "--expected-sha256", prepared.body.packetSha256);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.body.status, "SOURCE_ONLY_VERIFIED_NOT_EXECUTED");
  assert.equal(verified.body.sealSha256, prepared.body.sealSha256);
});

test("same committed input produces identical packet bytes without overwriting existing output", (t) => {
  const f = fixture(t); assert.equal(f.prepare().status, 0);
  const first = readFileSync(f.packet);
  const second = path.join(f.temporary, "second"); assert.equal(f.prepare([], second).status, 0);
  assert.deepEqual(readFileSync(path.join(second, "packet.json")), first);
  assert.equal(f.prepare().body.code, "OUTPUT_EXISTS"); assert.deepEqual(readFileSync(f.packet), first);
});

for (const count of [202, 204]) {
  test(`rejects a committed ${count}-migration source instead of the exact 203 inventory`, t => {
    const f = fixture(t);
    if (count === 202) unlinkSync(path.join(f.root, "services/api/prisma/migrations/202_synthetic/migration.sql"));
    else f.put("services/api/prisma/migrations/203_synthetic/migration.sql", "-- extra synthetic source, never executed\n");
    const candidate = f.commit();
    const prepared = f.prepare([], f.output, candidate);
    assert.equal(prepared.status, 1);
    assert.equal(prepared.body.code, "MIGRATION_COUNT_MISMATCH");
    assert.equal(existsSync(f.output), false);
  });
}

for (const kind of ["fragment order", "duplicate fragment", "SQL hash", "schema hash", "migration membership", "case binding"]) {
  test(`rejects ${kind} tampering even after the public checksum is recomputed`, (t) => {
    const f = fixture(t); const prepared = f.prepare(); assert.equal(prepared.status, 0);
    const packet = JSON.parse(readFileSync(f.packet, "utf8"));
    if (kind === "fragment order") packet.installation.fragments.reverse();
    if (kind === "duplicate fragment") packet.installation.fragments[1] = packet.installation.fragments[0];
    if (kind === "SQL hash") packet.installation.fragments[0].sha256 = "0".repeat(64);
    if (kind === "schema hash") packet.schema.sha256 = "0".repeat(64);
    if (kind === "migration membership") packet.migrations.pop();
    if (kind === "case binding") packet.cases[0].handlerExport = "notAnApprovedHandler";
    delete packet.sealSha256; packet.sealSha256 = createHash("sha256").update(JSON.stringify(packet)).digest("hex");
    writeFileSync(f.packet, JSON.stringify(packet));
    const result = f.run("--verify", "--packet", f.packet, "--expected-sha256", prepared.body.packetSha256); assert.equal(result.status, 1); assert.equal(result.body.code, "PACKET_DIGEST_MISMATCH");
    // Even an explicitly new caller pin cannot turn changed metadata into the current source-derived packet.
    const newDigest = createHash("sha256").update(readFileSync(f.packet)).digest("hex");
    assert.equal(f.run("--verify", "--packet", f.packet, "--expected-sha256", newDigest).body.code, "PACKET_MISMATCH");
  });
}

test("rejects missing or extra prepared SQL sources without creating output", (t) => {
  const f = fixture(t); unlinkSync(path.join(f.root, `services/api/prisma/prepared/task16/${fragments[0]}`));
  const missing = f.commit(); assert.equal(f.prepare([], f.output, missing).body.code, "REQUIRED_INPUT_MISSING"); assert.equal(existsSync(f.output), false);
  f.put(`services/api/prisma/prepared/task16/${fragments[0]}`, "-- restored synthetic source\n");
  f.put("services/api/prisma/prepared/task16/unlisted.sql", "-- never executed\n");
  const extra = f.commit(); assert.equal(f.prepare([], f.output, extra).body.code, "FRAGMENT_MEMBERSHIP_MISMATCH"); assert.equal(existsSync(f.output), false);
});

test("rejects missing migration and changed schema bytes hidden from normal Git status", (t) => {
  const f = fixture(t); unlinkSync(path.join(f.root, "services/api/prisma/migrations/001_synthetic/migration.sql"));
  const missing = f.commit(); assert.equal(f.prepare([], f.output, missing).body.code, "MIGRATION_COUNT_MISMATCH");
  f.put("services/api/prisma/migrations/001_synthetic/migration.sql", "-- restored\n"); const restored = f.commit();
  f.git("update-index", "--assume-unchanged", "services/api/prisma/schema.prisma"); f.put("services/api/prisma/schema.prisma", "// hidden changed schema\n");
  assert.equal(f.prepare([], f.output, restored).body.code, "SOURCE_CONTENT_MISMATCH"); assert.equal(existsSync(f.output), false);
});

test("rejects mismatched candidate, untracked source and staged source", (t) => {
  const f = fixture(t); assert.equal(f.prepare([], f.output, "0".repeat(40)).body.code, "CANDIDATE_SHA_MISMATCH");
  f.put("unexpected.txt", "synthetic only\n"); assert.equal(f.prepare().body.code, "SOURCE_NOT_CLEAN");
  f.git("add", "unexpected.txt"); assert.equal(f.prepare().body.code, "SOURCE_INDEX_NOT_CLEAN"); assert.equal(existsSync(f.output), false);
});

test("rejects an unlisted case and missing handler without importing the source", (t) => {
  const f = fixture(t); const file = "services/api/src/database/registered-payment-postgres.cases.ts";
  const original = readFileSync(path.join(f.root, file), "utf8");
  f.put(file, original.replace('id: "registered.null-cross-company.commit"', 'id: "unlisted.case"'));
  const unlisted = f.commit(); assert.equal(f.prepare([], f.output, unlisted).body.code, "CASE_INVENTORY_MISMATCH");
  f.put(file, original.replace("export async function runRegisteredNullCrossCompanyCommit", "async function runRegisteredNullCrossCompanyCommit") + '\n// export async function runRegisteredNullCrossCompanyCommit() {}\nconst quoted = "export async function runRegisteredNullCrossCompanyCommit() {}";\n');
  const missing = f.commit(); assert.equal(f.prepare([], f.output, missing).body.code, "CASE_EXPORTS_MISMATCH");
  f.put(file, original + '\nthrow new Error("SOURCE_MUST_NOT_BE_IMPORTED");\n'); const noImport = f.commit();
  assert.equal(f.prepare([], f.output, noImport).status, 0);
});

test("rejects duplicate inventory entries and additional exported handlers", (t) => {
  const f = fixture(t); const file = "services/api/src/database/registered-payment-postgres.cases.ts"; const original = readFileSync(path.join(f.root, file), "utf8");
  f.put(file, original.replace('  }];', '  }, { id: "registered.null-cross-company.commit", handlerExport: "runRegisteredNullCrossCompanyCommit" }];'));
  const duplicate = f.commit(); assert.equal(f.prepare([], f.output, duplicate).body.code, "CASE_INVENTORY_MISMATCH");
  f.put(file, original + '\nexport async function runUnlistedCase() {}\n'); const extra = f.commit();
  assert.equal(f.prepare([], f.output, extra).body.code, "CASE_EXPORTS_MISMATCH");
});

test("rejects execution options, arbitrary SQL paths and output inside the source", (t) => {
  const f = fixture(t);
  for (const extra of [["--execute"], ["--sql", "/tmp/not-allowed.sql"], ["--command", "anything"]]) assert.equal(f.prepare(extra).body.code, "INVALID_ARGUMENTS");
  assert.equal(f.prepare([], path.join(f.root, "packet")).body.code, "OUTPUT_IN_SOURCE");
  assert.equal(existsSync(f.output), false);
});

test("rejects source and packet symlinks and parent-directory aliases", (t) => {
  const f = fixture(t); const linked = path.join(f.temporary, "linked-root"); symlinkSync(f.root, linked, "dir");
  assert.equal(f.run("--prepare", "--repo", linked, "--candidate-sha", f.sha, "--output", f.output).body.code, "PATH_SYMLINK");
  const prepared = f.prepare(); assert.equal(prepared.status, 0); const link = path.join(f.temporary, "linked-packet.json"); symlinkSync(f.packet, link);
  assert.equal(f.run("--verify", "--packet", link, "--expected-sha256", prepared.body.packetSha256).body.code, "PATH_SYMLINK");
  const alias = path.join(f.temporary, "linked-parent"); symlinkSync(f.temporary, alias, "dir");
  assert.equal(f.prepare([], path.join(alias, "other")).body.code, "PATH_SYMLINK");
});

test("requires a caller-fixed packet digest and rejects a self-consistently rewritten packet", (t) => {
  const f = fixture(t); const prepared = f.prepare(); assert.equal(prepared.status, 0);
  assert.match(prepared.body.packetSha256, /^[a-f0-9]{64}$/u);
  const trusted = prepared.body.packetSha256;
  assert.equal(f.run("--verify", "--packet", f.packet, "--expected-sha256", trusted).status, 0);
  const packet = JSON.parse(readFileSync(f.packet, "utf8")); packet.unresolved.acl = "APPROVED";
  delete packet.sealSha256; packet.sealSha256 = createHash("sha256").update(JSON.stringify(packet)).digest("hex");
  writeFileSync(f.packet, JSON.stringify(packet));
  const rejected = f.run("--verify", "--packet", f.packet, "--expected-sha256", trusted);
  assert.equal(rejected.status, 1); assert.equal(rejected.body.code, "PACKET_DIGEST_MISMATCH");
  assert.equal(f.run("--verify", "--packet", f.packet).body.code, "INVALID_ARGUMENTS");
});

test("a nested template literal cannot forge the declared handler export", (t) => {
  const f = fixture(t); const file = "services/api/src/database/registered-payment-postgres.cases.ts";
  const original = readFileSync(path.join(f.root, file), "utf8");
  f.put(file, original.replace("export async function runRegisteredNullCrossCompanyCommit", "async function runRegisteredNullCrossCompanyCommit") + '\nconst nested = `${`not code\nexport async function runRegisteredNullCrossCompanyCommit() {}\n`}`;\n');
  const candidate = f.commit();
  assert.equal(f.prepare([], f.output, candidate).status, 1);
  assert.equal(existsSync(f.output), false);
});

for (const disguise of ["regex", "escaped name", "nested function"]) {
  test(`${disguise} does not qualify as the exact top-level handler export`, (t) => {
    const f = fixture(t); const file = "services/api/src/database/registered-payment-postgres.cases.ts";
    const original = readFileSync(path.join(f.root, file), "utf8");
    let altered = original.replace("export async function runRegisteredNullCrossCompanyCommit", "async function runRegisteredNullCrossCompanyCommit");
    if (disguise === "regex") altered += '\nconst fake = /export async function runRegisteredNullCrossCompanyCommit() {}/;\n';
    if (disguise === "escaped name") altered = original.replace("export async function runRegisteredNullCrossCompanyCommit", "export async function r\\u0075nRegisteredNullCrossCompanyCommit");
    if (disguise === "nested function") altered += '\nfunction outer() { async function runRegisteredNullCrossCompanyCommit() {} }\n';
    f.put(file, altered); const candidate = f.commit(); assert.equal(f.prepare([], f.output, candidate).status, 1); assert.equal(existsSync(f.output), false);
  });
}

test("Git replacement objects cannot substitute the captured committed bytes", (t) => {
  const f = fixture(t); const file = "services/api/prisma/schema.prisma";
  const originalOid = f.git("rev-parse", `${f.sha}:${file}`);
  const synthetic = path.join(f.temporary, "replacement.txt"); writeFileSync(synthetic, "// replacement that must not become the source\n");
  const replacementOid = f.git("hash-object", "-w", synthetic);
  f.git("update-index", "--cacheinfo", "100644", replacementOid, file); const tree = f.git("write-tree");
  const fakeCommit = f.git("commit-tree", tree, "-p", f.sha, "-m", "synthetic replacement");
  f.git("update-index", "--cacheinfo", "100644", originalOid, file); f.git("replace", f.sha, fakeCommit);
  const prepared = f.prepare(); assert.equal(prepared.status, 0, prepared.stderr || JSON.stringify(prepared.body));
  const packet = JSON.parse(readFileSync(f.packet, "utf8"));
  assert.equal(packet.schema.sha256, createHash("sha256").update(readFileSync(path.join(f.root, file))).digest("hex"));
  assert.equal(f.run("--verify", "--packet", f.packet, "--expected-sha256", prepared.body.packetSha256).status, 0);
});

test("read-only Git inspection does not run configured source clean filters", (t) => {
  const f = fixture(t); f.put(".gitattributes", "*.prisma filter=source-packet\n"); const candidate = f.commit();
  const marker = path.join(f.temporary, "filter-was-executed");
  f.git("config", "filter.source-packet.clean", `"${process.execPath}" -e "require('node:fs').writeFileSync('${marker}','unexpected')"`);
  assert.equal(f.prepare([], f.output, candidate).status, 0);
  assert.equal(existsSync(marker), false);
});

test("a default-only function does not qualify as the named handler export", (t) => {
  const f = fixture(t); const file = "services/api/src/database/registered-payment-postgres.cases.ts";
  const original = readFileSync(path.join(f.root, file), "utf8");
  f.put(file, original.replace("export async function runRegisteredNullCrossCompanyCommit", "export default async function runRegisteredNullCrossCompanyCommit"));
  const candidate = f.commit(); assert.equal(f.prepare([], f.output, candidate).status, 1); assert.equal(existsSync(f.output), false);
});

test("rejects removal of the Git owner executable bit even when another executable bit remains", (t) => {
  const f = fixture(t); const file = "owner-mode-source.sh"; f.put(file, "# synthetic source, never executed\n");
  chmodSync(path.join(f.root, file), 0o755); const candidate = f.commit();
  assert.equal(f.git("ls-files", "--stage", file).split(" ")[0], "100755");
  chmodSync(path.join(f.root, file), 0o641);
  assert.match(f.git("diff", "--summary", "--", file), /mode change 100755 => 100644/u);
  assert.equal(f.prepare([], f.output, candidate).status, 1);
  assert.equal(existsSync(f.output), false);
});

test("accepts a Git-clean nonexecutable source with only the other executable bit set", (t) => {
  const f = fixture(t); const file = "nonexecutable-mode-source.sh"; f.put(file, "# synthetic source, never executed\n");
  chmodSync(path.join(f.root, file), 0o644); const candidate = f.commit();
  assert.equal(f.git("ls-files", "--stage", file).split(" ")[0], "100644");
  chmodSync(path.join(f.root, file), 0o641);
  assert.equal(f.git("diff", "--summary", "--", file), "");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.prepare([], f.output, candidate).status, 0);
});
