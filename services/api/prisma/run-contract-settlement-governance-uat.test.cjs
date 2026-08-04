const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runnerPath = path.join(__dirname, "run-contract-settlement-governance-uat.cjs");
const runnerSource = fs.readFileSync(runnerPath, "utf8");
const start = runnerSource.indexOf("async function uploadCanvasSignature");
const end = runnerSource.indexOf("\nasync function prepareSharedFixtures", start);
const signaturePreparationSource = runnerSource.slice(start, end);
const fixtureStart = runnerSource.indexOf("async function createContractFixture");
const fixtureEnd = runnerSource.indexOf("\nasync function prepareAndSubmitContract", fixtureStart);
const fixtureSource = runnerSource.slice(fixtureStart, fixtureEnd);

test("governance UAT prepares each personal signature through the domain route", () => {
  assert.match(signaturePreparationSource, /\/me\/signature\/canvas/u);
  assert.match(signaturePreparationSource, /uploadCanvasSignature\(\s*tokens\[role\]/u);
  assert.doesNotMatch(signaturePreparationSource, /uploadBuffer\(\s*tokens\[role\]/u);
});

test("director-skip governance fixture uploads its template through contract staff", () => {
  assert.match(fixtureSource, /uploadPdf\(tokens\.contractStaff,/u);
  assert.doesNotMatch(fixtureSource, /uploadPdf\(tokens\[applicantRole\],/u);
});
