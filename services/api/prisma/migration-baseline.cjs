#!/usr/bin/env node
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync
} = require("node:fs");
const { rename, writeFile } = require("node:fs/promises");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_MIGRATIONS_ROOT = path.join(__dirname, "migrations");
const DEFAULT_MANIFEST_PATH = path.join(
  __dirname,
  "database-dynamic-gate-manifest.json"
);
const CANONICAL_MANIFEST_FILENAME = "database-dynamic-gate-manifest.json";
const BASELINE_FIELDS = [
  "expectedDirectoryCount",
  "terminalMigration",
  "terminalMigrationChecksum"
];

function fail(message) {
  throw new Error(message);
}

function assertInside(parent, child, label) {
  const relative = path.relative(parent, child);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} 必须位于仓库范围内`);
  }
}

function assertRepositoryTargets({
  repositoryRoot = REPOSITORY_ROOT,
  migrationsRoot = DEFAULT_MIGRATIONS_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH
} = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedMigrationsRoot = path.resolve(migrationsRoot);
  const resolvedManifestPath = path.resolve(manifestPath);
  if (!existsSync(resolvedRepositoryRoot) || !statSync(resolvedRepositoryRoot).isDirectory()) {
    fail("repository root 必须是已存在目录");
  }
  assertInside(resolvedRepositoryRoot, resolvedMigrationsRoot, "migrations root");
  assertInside(resolvedRepositoryRoot, resolvedManifestPath, "manifest target");
  if (path.basename(resolvedManifestPath) !== CANONICAL_MANIFEST_FILENAME) {
    fail("sync target 必须是 canonical manifest");
  }
  if (
    existsSync(resolvedManifestPath) &&
    lstatSync(resolvedManifestPath).isSymbolicLink()
  ) {
    fail("canonical manifest 不得是符号链接");
  }
  if (
    existsSync(resolvedMigrationsRoot) &&
    lstatSync(resolvedMigrationsRoot).isSymbolicLink()
  ) {
    fail("migrations root 不得是符号链接");
  }
  if (!existsSync(resolvedMigrationsRoot) || !statSync(resolvedMigrationsRoot).isDirectory()) {
    fail("migrations root 必须是已存在目录");
  }
  return {
    repositoryRoot: resolvedRepositoryRoot,
    migrationsRoot: resolvedMigrationsRoot,
    manifestPath: resolvedManifestPath
  };
}

function listMigrationDirectories(migrationsRoot = DEFAULT_MIGRATIONS_ROOT) {
  const resolvedRoot = path.resolve(migrationsRoot);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    fail("migrations root 必须是已存在目录");
  }
  return readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationChecksum(migrationsRoot, migrationName) {
  const migrationPath = path.join(migrationsRoot, migrationName, "migration.sql");
  if (
    !existsSync(migrationPath) ||
    lstatSync(migrationPath).isSymbolicLink() ||
    !statSync(migrationPath).isFile()
  ) {
    fail(`迁移目录 ${migrationName} 缺少 migration.sql`);
  }
  return createHash("sha256")
    .update(readFileSync(migrationPath))
    .digest("hex");
}

function deriveMigrationBaseline(migrationsRoot = DEFAULT_MIGRATIONS_ROOT) {
  const migrations = listMigrationDirectories(migrationsRoot);
  if (migrations.length === 0) {
    fail("migrations root 不得为空");
  }
  const terminalMigration = migrations.at(-1);
  return {
    expectedDirectoryCount: migrations.length,
    terminalMigration,
    terminalMigrationChecksum: migrationChecksum(
      path.resolve(migrationsRoot),
      terminalMigration
    )
  };
}

function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`canonical manifest 无法读取：${error.message}`);
  }
}

function baselineDrift(manifestBaseline, sourceBaseline) {
  return BASELINE_FIELDS.flatMap((field) => {
    if (manifestBaseline?.[field] === sourceBaseline[field]) return [];
    return [{
      field,
      manifest: manifestBaseline?.[field],
      source: sourceBaseline[field]
    }];
  });
}

function assertManifestBaseline(manifest, sourceBaseline) {
  const drift = baselineDrift(manifest?.migrationBaseline, sourceBaseline);
  if (drift.length > 0) {
    fail(`migration baseline drift: ${JSON.stringify(drift)}`);
  }
  return sourceBaseline;
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function syncManifest({
  repositoryRoot = REPOSITORY_ROOT,
  migrationsRoot = DEFAULT_MIGRATIONS_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH
} = {}) {
  const targets = assertRepositoryTargets({
    repositoryRoot,
    migrationsRoot,
    manifestPath
  });
  const manifest = loadManifest(targets.manifestPath);
  const sourceBaseline = deriveMigrationBaseline(targets.migrationsRoot);
  const nextManifest = {
    ...manifest,
    migrationBaseline: {
      ...(manifest.migrationBaseline ?? {}),
      ...sourceBaseline
    }
  };
  const before = serializeManifest(manifest);
  const after = serializeManifest(nextManifest);
  if (before !== after) {
    const temporaryPath = path.join(
      path.dirname(targets.manifestPath),
      `.${CANONICAL_MANIFEST_FILENAME}.${process.pid}.${randomUUID()}.tmp`
    );
    await writeFile(temporaryPath, after, { encoding: "utf8", mode: 0o644 });
    await rename(temporaryPath, targets.manifestPath);
  }
  return { changed: before !== after, sourceBaseline, manifest: nextManifest };
}

function inspectManifest({
  repositoryRoot = REPOSITORY_ROOT,
  migrationsRoot = DEFAULT_MIGRATIONS_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH
} = {}) {
  const targets = assertRepositoryTargets({
    repositoryRoot,
    migrationsRoot,
    manifestPath
  });
  const manifest = loadManifest(targets.manifestPath);
  const sourceBaseline = deriveMigrationBaseline(targets.migrationsRoot);
  return {
    drift: baselineDrift(manifest.migrationBaseline, sourceBaseline),
    manifest,
    sourceBaseline,
    ...targets
  };
}

function loadCanonicalMigrationBaseline({
  migrationsRoot = DEFAULT_MIGRATIONS_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH
} = {}) {
  const sourceBaseline = deriveMigrationBaseline(migrationsRoot);
  return assertManifestBaseline(loadManifest(manifestPath), sourceBaseline);
}

module.exports = {
  BASELINE_FIELDS,
  CANONICAL_MANIFEST_FILENAME,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_MIGRATIONS_ROOT,
  REPOSITORY_ROOT,
  assertInside,
  assertManifestBaseline,
  assertRepositoryTargets,
  baselineDrift,
  deriveMigrationBaseline,
  listMigrationDirectories,
  loadCanonicalMigrationBaseline,
  loadManifest,
  migrationChecksum,
  inspectManifest,
  syncManifest
};
