#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  DEFAULT_MANIFEST_PATH,
  DEFAULT_MIGRATIONS_ROOT,
  REPOSITORY_ROOT,
  inspectManifest,
  syncManifest
} = require("./migration-baseline.cjs");

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    mode: "check",
    repositoryRoot: REPOSITORY_ROOT,
    migrationsRoot: DEFAULT_MIGRATIONS_ROOT,
    manifestPath: DEFAULT_MANIFEST_PATH
  };
  let selectedMode;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--check", "--preview", "--sync", "--validate"].includes(argument)) {
      if (selectedMode && selectedMode !== argument) {
        fail("--check、--preview、--sync 与 --validate 只能选择一个");
      }
      selectedMode = argument;
      options.mode = argument.slice(2);
      continue;
    }
    if (["--root", "--migrations-root", "--manifest"].includes(argument)) {
      const value = argv[++index];
      if (!value) fail(`${argument} 缺少路径`);
      if (argument === "--root") options.repositoryRoot = path.resolve(value);
      if (argument === "--migrations-root") options.migrationsRoot = path.resolve(value);
      if (argument === "--manifest") options.manifestPath = path.resolve(value);
      continue;
    }
    fail(`未知参数：${argument}`);
  }
  return options;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.mode === "sync") {
    const synced = await syncManifest(options);
    printResult({
      mode: options.mode,
      status: "synced",
      changed: synced.changed,
      sourceBaseline: synced.sourceBaseline
    });
    return;
  }
  const inspected = inspectManifest(options);
  const status = inspected.drift.length === 0 ? "clean" : "drift";
  printResult({
    mode: options.mode,
    status,
    changed: false,
    sourceBaseline: inspected.sourceBaseline,
    manifestBaseline: inspected.manifest.migrationBaseline,
    drift: inspected.drift
  });
  if (options.mode === "check" || options.mode === "validate") {
    if (inspected.drift.length > 0) {
      fail(`migration baseline drift: ${JSON.stringify(inspected.drift)}`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { main, parseArguments };
