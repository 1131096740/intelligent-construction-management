"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const profiles = Object.freeze({
  "lifecycle-rest": ["ONBOARDING_ORIGINAL_NONBROWSER_LIFECYCLE_289_PASSED", "ONBOARDING_ORIGINAL_PERSONNEL_LIFECYCLE", 19, 1],
  "lifecycle-desktop": ["ONBOARDING_ORIGINAL_DESKTOP_LIFECYCLE_289_PASSED", "ONBOARDING_ORIGINAL_PERSONNEL_LIFECYCLE", 1, 19],
  "lifecycle-mobile": ["ONBOARDING_ORIGINAL_MOBILE_LIFECYCLE_289_PASSED", "ONBOARDING_ORIGINAL_PERSONNEL_LIFECYCLE", 1, 19],
  downstream: ["ONBOARDING_ORIGINAL_INDEPENDENT_29_289_PASSED", "ONBOARDING_ORIGINAL_INDEPENDENT_29", 29, 0],
  roster: ["ONBOARDING_FIXED_ORIGINAL_ROSTER10_289_PASSED", "ONBOARDING_ORIGINAL_ROSTER10", 10, 0],
});

function verify(mode, receipt) {
  assert(Object.hasOwn(profiles, mode), "UNKNOWN_ONBOARDING_282_MODE");
  const [status, phase, passed, skipped] = profiles[mode];
  assert.equal(receipt.status, status);
  assert.equal(receipt.business, "CALLBACK_COMPLETED");
  assert.equal(receipt.sameInstancePostConsume, true);
  assert.equal(receipt.releaseTree, "a1be083076018686dd8afba68c44ff9c75502014");
  assert.match(receipt.runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  assert.equal(receipt.databaseIdentity?.database, "jg_task01_" + receipt.runId.replaceAll("-", ""));
  assert.equal(receipt.databaseIdentity?.tls, true);
  assert.equal(receipt.cleanup, "POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT");
  assert.equal(receipt.onboardingAliasRevoked, true);
  assert.equal(receipt.onboardingVoucherColumnRevoked, true);
  assert.equal(receipt.cgroupPids?.before, receipt.cgroupPids?.after);
  assert.deepEqual(receipt.orderedTails?.at(-1),
    { size: 289, ledgerSha256: "5c5e77dc94502b706c6e52c5761f52573e27cca46efb812f9b8b22216ec52f67" });
  for (const key of ["tls", "upward", "a08VoucherOwnerOnly", "registeredVoucherScopeClosed", "registeredVoucherReadScopeClosed"]) {
    assert.equal(receipt.finalWitness?.[key], true);
  }
  assert.deepEqual(receipt.onboardingOriginalAcl,
    { idempotent: true, denied: 9, unreachablePositive: 2, nonOwnerAndBackupRollback: true });
  assert.equal(receipt.onboardingSuites?.length, 1);
  const suite = receipt.onboardingSuites[0];
  assert.deepEqual([suite.phase, suite.exit, suite.passed, suite.failed, suite.skipped], [phase, 0, passed, 0, skipped]);
  if (mode === "roster") assert.deepEqual(receipt.rosterPeer,
    { coordinates: [true, true, true, true], denials: 2 });
  return { runId: receipt.runId, mode, passed };
}

if (require.main === module) {
  const paths = process.argv.slice(2);
  assert.equal(paths.length, Object.keys(profiles).length);
  const receipts = Object.keys(profiles).map((mode, index) => verify(mode, JSON.parse(fs.readFileSync(paths[index], "utf8"))));
  assert.equal(new Set(receipts.map(entry => entry.runId)).size, receipts.length);
  process.stdout.write(JSON.stringify({ status: "ONBOARDING_ORIGINAL_59_289_PASSED", originalJestCases: 59,
    browserProjects: ["desktop", "mobile"], receipts }) + "\n");
}

module.exports = { verify, profiles };
