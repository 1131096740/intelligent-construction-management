const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runnerPath = path.join(__dirname, "run-contract-settlement-governance-uat.cjs");
const runnerSource = fs.readFileSync(runnerPath, "utf8");
const start = runnerSource.indexOf("async function uploadCanvasSignature");
const end = runnerSource.indexOf("\nasync function prepareSharedFixtures", start);
const signaturePreparationSource = runnerSource.slice(start, end);

test("governance UAT prepares each personal signature through the domain route", () => {
  assert.match(signaturePreparationSource, /\/me\/signature\/canvas/u);
  assert.match(signaturePreparationSource, /uploadCanvasSignature\(\s*tokens\[role\]/u);
  assert.doesNotMatch(signaturePreparationSource, /uploadBuffer\(\s*tokens\[role\]/u);
});
