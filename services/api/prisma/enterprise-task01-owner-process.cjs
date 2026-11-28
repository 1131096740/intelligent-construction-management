"use strict";
// Owner-only synthetic fixture process. No resource creation, migrations or CLI arguments.
const { lstatSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const path = require("node:path");

async function main() {
  const inputFile = process.env.JG_TASK01_OWNER_INPUT_FILE;
  const outputFile = process.env.JG_TASK01_ENTRY_CONTEXT_FILE;
  if (process.env.NODE_ENV !== "test" || process.argv.length !== 2 || !inputFile || !outputFile
    || !inputFile.startsWith("/private/tmp/") || path.dirname(inputFile) !== path.dirname(outputFile)
    || process.env.DATABASE_URL || process.env.JG_TASK01_OBSERVER_DATABASE_URL) throw new Error("OWNER_PROCESS_INPUT_REJECTED");
  const stat = lstatSync(inputFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 16_384
    || realpathSync(inputFile) !== path.resolve(inputFile)) throw new Error("OWNER_PROCESS_INPUT_REJECTED");
  const input = JSON.parse(readFileSync(inputFile, "utf8"));
  const { prepareTask01OwnerFixture } = require("../dist/task01-owner/database/enterprise-task01-owner-fixture.test-support.js");
  const result = await prepareTask01OwnerFixture(input);
  writeFileSync(outputFile, `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: "synthetic-owner-fixture-prepared", ownerDisconnected: true })}\n`);
}
main().catch(() => {
  process.stdout.write(`${JSON.stringify({ status: "owner-fixture-failed-closed" })}\n`);
  process.exitCode = 1;
});
