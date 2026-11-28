"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { after } = require("node:test");

// The 259/261/262 qualification models share this exact pre-transfer schema.
const blob = "f19b0fa4cf99e0871b642f845c267c7850958041";
const sha256 = "60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4";
const historicalMigrationCount = 262;
let schema;

function historicalQualificationSchema() {
  if (schema === undefined) {
    schema = execFileSync("git", ["cat-file", "blob", blob], { cwd: path.resolve(__dirname, "../../../..") });
    assert.equal(createHash("sha256").update(schema).digest("hex"), sha256, "the historical qualification schema blob changed");
  }
  return Buffer.from(schema);
}

function historicalQualificationSchemaHash() {
  historicalQualificationSchema();
  return sha256;
}

let restoreSchema;
function useHistoricalQualificationSchemaFile(registerCleanup = after) {
  if (restoreSchema) return;
  const current = path.resolve(__dirname, "../schema.prisma");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-qualified-schema-"));
  const fixture = path.join(directory, "schema.prisma");
  fs.writeFileSync(fixture, historicalQualificationSchema(), { mode: 0o600, flag: "wx" });
  const originals = { openSync: fs.openSync, lstatSync: fs.lstatSync, realpathSync: fs.realpathSync, readFileSync: fs.readFileSync };
  const source = file => file === current ? fixture : file;
  for (const key of ["openSync", "lstatSync", "readFileSync"]) {
    fs[key] = (file, ...args) => originals[key](source(file), ...args);
  }
  // The candidate path remains the historical model's logical schema path;
  // all actual FD/lstat checks above inspect the same sealed temporary file.
  fs.realpathSync = Object.assign((file, ...args) => {
    const result = originals.realpathSync(source(file), ...args);
    return file === current ? current : result;
  }, { native: originals.realpathSync.native });
  restoreSchema = () => {
    Object.assign(fs, originals);
    fs.rmSync(directory, { recursive: true, force: true });
    restoreSchema = undefined;
  };
  registerCleanup(() => restoreSchema?.());
}

module.exports = { historicalQualificationSchema, historicalQualificationSchemaHash, historicalMigrationCount, useHistoricalQualificationSchemaFile };
