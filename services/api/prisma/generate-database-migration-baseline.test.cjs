#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const scriptPath = path.join(
  __dirname,
  "generate-database-migration-baseline.cjs"
);
const manifestPath = path.join(
  __dirname,
  "database-dynamic-gate-manifest.json"
);
const migrationsPath = path.join(__dirname, "migrations");
const TERMINAL_MIGRATION_CHECKSUM =
  "ac4396cdee0295db27f816dc31134189999d0071663e618f4957bc23edb584d7";

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "migration-baseline-"));
  const fixtureMigrations = path.join(fixtureRoot, "migrations");
  await mkdir(path.join(fixtureMigrations, "002_beta"), { recursive: true });
  await mkdir(path.join(fixtureMigrations, "001_alpha"), { recursive: true });
  await writeFile(
    path.join(fixtureMigrations, "002_beta", "migration.sql"),
    "select 2;\n"
  );
  await writeFile(
    path.join(fixtureMigrations, "001_alpha", "migration.sql"),
    "select 1;\n"
  );
  await writeFile(
    path.join(fixtureRoot, "database-dynamic-gate-manifest.json"),
    JSON.stringify({ schemaVersion: 1, migrationBaseline: {} }, null, 2) + "\n"
  );
  return fixtureRoot;
}

function runGenerator(fixtureRoot, ...args) {
  return spawnSync(process.execPath, [
    scriptPath,
    "--root",
    fixtureRoot,
    "--migrations-root",
    path.join(fixtureRoot, "migrations"),
    "--manifest",
    path.join(fixtureRoot, "database-dynamic-gate-manifest.json"),
    ...args
  ], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: "", NODE_ENV: "test" }
  });
}

async function readFixtureManifest(fixtureRoot) {
  return JSON.parse(
    await readFile(
      path.join(fixtureRoot, "database-dynamic-gate-manifest.json"),
      "utf8"
    )
  );
}

test("derives sorted migration directories and the terminal checksum", async () => {
  const fixtureRoot = await createFixture();
  try {
    const { deriveMigrationBaseline } = require("./migration-baseline.cjs");
    assert.deepEqual(
      deriveMigrationBaseline(path.join(fixtureRoot, "migrations")),
      {
        expectedDirectoryCount: 2,
        terminalMigration: "002_beta",
        terminalMigrationChecksum: TERMINAL_MIGRATION_CHECKSUM
      }
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("explicit sync is atomic and idempotent", async () => {
  const fixtureRoot = await createFixture();
  try {
    const first = runGenerator(fixtureRoot, "--sync");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /"changed":true/u);
    const firstManifest = await readFile(
      path.join(fixtureRoot, "database-dynamic-gate-manifest.json"),
      "utf8"
    );
    const second = runGenerator(fixtureRoot, "--sync");
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /"changed":false/u);
    assert.equal(
      await readFile(
        path.join(fixtureRoot, "database-dynamic-gate-manifest.json"),
        "utf8"
      ),
      firstManifest
    );
    assert.deepEqual((await readFixtureManifest(fixtureRoot)).migrationBaseline, {
      expectedDirectoryCount: 2,
      terminalMigration: "002_beta",
      terminalMigrationChecksum: TERMINAL_MIGRATION_CHECKSUM
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("preview reports drift without writing the canonical manifest", async () => {
  const fixtureRoot = await createFixture();
  try {
    assert.equal(runGenerator(fixtureRoot, "--sync").status, 0);
    const manifestFile = path.join(
      fixtureRoot,
      "database-dynamic-gate-manifest.json"
    );
    const before = await readFile(manifestFile, "utf8");
    await mkdir(path.join(fixtureRoot, "migrations", "003_gamma"));
    await writeFile(
      path.join(fixtureRoot, "migrations", "003_gamma", "migration.sql"),
      "select 3;\n"
    );
    const preview = runGenerator(fixtureRoot, "--preview");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /"status":"drift"/u);
    assert.match(preview.stdout, /expectedDirectoryCount/u);
    assert.equal(await readFile(manifestFile, "utf8"), before);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("official check proves actual added and removed migration-directory drift", async () => {
  const fixtureRoot = await createFixture();
  try {
    assert.equal(runGenerator(fixtureRoot, "--sync").status, 0);
    const migrations = path.join(fixtureRoot, "migrations");
    await mkdir(path.join(migrations, "003_gamma"));
    await writeFile(
      path.join(migrations, "003_gamma", "migration.sql"),
      "select 3;\n"
    );
    const added = runGenerator(fixtureRoot, "--check");
    assert.equal(added.status, 1);
    assert.match(added.stderr, /migration baseline drift/u);
    assert.match(added.stderr, /expectedDirectoryCount/u);

    await rm(path.join(migrations, "003_gamma"), {
      recursive: true,
      force: true
    });
    await rm(path.join(migrations, "002_beta"), {
      recursive: true,
      force: true
    });
    const removed = runGenerator(fixtureRoot, "--check");
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /migration baseline drift/u);
    assert.match(removed.stderr, /terminalMigration/u);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("sync rejects an invalid non-canonical write target", async () => {
  const fixtureRoot = await createFixture();
  try {
    const result = runGenerator(
      fixtureRoot,
      "--sync",
      "--manifest",
      path.join(fixtureRoot, "not-canonical.json")
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical manifest/u);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("sync rejects a symlinked migration source", async () => {
  const fixtureRoot = await createFixture();
  try {
    const linkedMigrations = path.join(fixtureRoot, "linked-migrations");
    await symlink(path.join(fixtureRoot, "migrations"), linkedMigrations);
    const result = runGenerator(
      fixtureRoot,
      "--sync",
      "--migrations-root",
      linkedMigrations
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /migrations root.*符号链接/u);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("dynamic gate validation uses the same live migration baseline", () => {
  const { deriveMigrationBaseline } = require("./migration-baseline.cjs");
  const { loadManifest, validateManifest } = require(
    "./run-database-dynamic-gate-local.cjs"
  );
  const baseline = deriveMigrationBaseline(migrationsPath);
  const validation = validateManifest(loadManifest(manifestPath));
  assert.equal(validation.migrationCount, baseline.expectedDirectoryCount);
  assert.equal(validation.terminalMigration, baseline.terminalMigration);
  assert.equal(
    validation.terminalMigrationChecksum,
    baseline.terminalMigrationChecksum
  );
});
