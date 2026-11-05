#!/usr/bin/env node
"use strict";

// Offline source sealing only. This entry has no database, Docker or network mode.
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, realpathSync, lstatSync, existsSync, readdirSync } = require("node:fs");
const path = require("node:path");

const root = realpathSync(path.resolve(__dirname, ".."));
function fail(code) { throw Object.assign(new Error(code), { sealCode: code }); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function git(...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["--no-replace-objects", "--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 15_000, maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}
function sourceHash(file, expectedObjectId, objectFormat) {
  let current = root;
  for (const segment of file.split("/")) {
    current = path.join(current, segment);
    if (lstatSync(current).isSymbolicLink()) fail("SOURCE_SYMLINK");
  }
  if (!lstatSync(current).isFile()) fail("SOURCE_FILE_INVALID");
  const contents = readFileSync(current);
  const objectId = createHash(objectFormat).update(`blob ${contents.length}\0`).update(contents).digest("hex");
  if (objectId !== expectedObjectId) fail("SOURCE_CONTENT_MISMATCH");
  return sha256(contents);
}
function migrationMembers(directory = "services/api/prisma/migrations") {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) fail("SOURCE_SYMLINK");
    if (entry.isDirectory()) return migrationMembers(relative);
    return entry.name === "migration.sql" ? [relative] : [];
  }).sort();
}
function sourceSeal() {
  if (realpathSync(git("rev-parse", "--show-toplevel").trim()) !== root) fail("SOURCE_ROOT_MISMATCH");
  if (git("status", "--porcelain=v1", "--untracked-files=all").trim()) fail("SOURCE_NOT_CLEAN");
  const candidateSha = git("rev-parse", "HEAD").trim();
  const objectFormat = git("rev-parse", "--show-object-format").trim();
  if (!["sha1", "sha256"].includes(objectFormat)) fail("GIT_OBJECT_FORMAT_INVALID");
  const files = git("ls-tree", "-r", "-z", candidateSha).split("\0").filter(Boolean).map((entry) => {
    const split = entry.indexOf("\t");
    const [mode, kind, objectId] = entry.slice(0, split).split(" ");
    const file = entry.slice(split + 1);
    if (mode === "120000") fail("SOURCE_SYMLINK");
    if (kind !== "blob" || !["100644", "100755"].includes(mode)) fail("SOURCE_FILE_INVALID");
    return { path: file, sha256: sourceHash(file, objectId, objectFormat) };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const required = ["scripts/prepare-enterprise-acceptance.cjs", "pnpm-lock.yaml", "services/api/prisma/schema.prisma", "services/api/prisma/migrations/migration_lock.toml"];
  if (required.some((file) => !files.some((entry) => entry.path === file))) fail("REQUIRED_INPUT_MISSING");
  const lockfile = files.find((file) => file.path === "pnpm-lock.yaml");
  const migrations = files.filter((file) => /^services\/api\/prisma\/migrations\/(?:.+\/)?migration\.sql$/u.test(file.path));
  if (!migrations.length) fail("MIGRATIONS_MISSING");
  if (JSON.stringify(migrationMembers()) !== JSON.stringify(migrations.map((file) => file.path))) fail("MIGRATION_MEMBERSHIP_MISMATCH");
  if (git("rev-parse", "HEAD").trim() !== candidateSha || git("status", "--porcelain=v1", "--untracked-files=all").trim()) fail("SOURCE_CHANGED_DURING_CAPTURE");
  return {
    schemaVersion: 1,
    purpose: "source-seal-only",
    candidateSha,
    scope: { ignoredArtifacts: "not-sealed", installedDependencies: "not-verified", httpPostgresAcceptance: "not-executed" },
    files, lockfile, migrations
  };
}
function summary(status, payload) {
  return { status, candidateSha: payload.candidateSha, fileCount: payload.files.length,
    migrationCount: payload.migrations.length, sealSha256: sha256(JSON.stringify(payload)) };
}
function main() {
  const args = process.argv.slice(2);
  const prepare = args.length === 3 && args[0] === "--prepare" && args[1] === "--output";
  const verify = args.length === 2 && args[0] === "--verify";
  if ((!prepare && !verify) || !args.at(-1) || args.at(-1).startsWith("--")) fail("INVALID_ARGUMENTS");
  const requested = path.resolve(args.at(-1));
  let ancestor = path.dirname(requested);
  while (ancestor !== path.dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) fail("ARTIFACT_SYMLINK");
    ancestor = path.dirname(ancestor);
  }
  const destination = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(root, destination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) fail("OUTPUT_IN_SOURCE");
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) fail("ARTIFACT_SYMLINK");
  const payload = sourceSeal();
  if (args[0] === "--prepare") {
    writeFileSync(destination, `${JSON.stringify({ ...payload, sealSha256: sha256(JSON.stringify(payload)) }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return summary("source-sealed", payload);
  }
  const packet = JSON.parse(readFileSync(destination, "utf8"));
  // The checksum detects corruption; committed Git membership remains the authority.
  const expected = { ...payload, sealSha256: sha256(JSON.stringify(payload)) };
  if (JSON.stringify(packet) !== JSON.stringify(expected)) fail("SOURCE_SEAL_MISMATCH");
  return summary("source-verified", payload);
}
try { process.stdout.write(`${JSON.stringify(main())}\n`); }
catch (error) {
  process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.sealCode ?? "SOURCE_SEAL_FAILED", message: "源码封存未通过；未执行运行验收。" })}\n`);
  process.exitCode = 1;
}
