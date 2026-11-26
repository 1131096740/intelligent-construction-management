"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { verifyA24Prefix } = require("./task426-a24-native340-profile.cjs");
const verified346 = new WeakSet();
const { assertSource: assert331Source } = require("../../../.github/task12-install-295/contract-finance/payment-remainder-331-profile.cjs");
const { final: base295 } = require("../../../.github/task12-install-295/contract-finance/common/multi-witness.cjs");

const mode = "a08-upward-pin-332";
const ledgerSha256 = "b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4";
const predecessor330 = Object.freeze({ migrationCount: 330, ledgerSha256: "12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f" });
const predecessor331 = Object.freeze({ migrationCount: 331, ledgerSha256: "0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014" });
const terminal = Object.freeze({ name: "20261129001000_contract_upward_archive_verifier_pin_forward",
  sha256: "4e8e6e23267f525ca2bff68719e2989126fff82e5bd0d0ba344abc2c4c8d4da3", finished: true, rolledBack: false });
const digest = ledger => createHash("sha256").update(JSON.stringify(ledger)).digest("hex");

function captureA08SuccessorSource(sourceSha, sourceTree, ledger) {
  assert.equal(ledger.length, 332);
  for (const predecessor of [predecessor330, predecessor331]) {
    assert.equal(digest(ledger.slice(0, predecessor.migrationCount)), predecessor.ledgerSha256);
  }
  const source = { mode, sourceSha, sourceTree, migrationCount: ledger.length, ledgerSha256: digest(ledger),
    predecessor330, predecessor331, terminal: ledger.at(-1) };
  assertA08Source(source, sourceSha);
  return source;
}

function captureA08Direct346Source(sourceSha, sourceTree, ledger) {
  captureA08SuccessorSource(sourceSha, sourceTree, ledger.slice(0, 332));
  assert.equal(ledger.length, 346);
  const { ledgerSha256: digest346 } = verifyA24Prefix(346, ledger);
  const profile = Object.freeze({ mode: "a08-direct-346", sourceSha, sourceTree,
    migrationCount: ledger.length, ledgerSha256: digest346 });
  verified346.add(profile);
  return profile;
}

function assertA08Source(source, sourceSha) {
  if (source.mode === "a08-direct-346") {
    assert.ok(verified346.has(source) && source.sourceSha === sourceSha, "A08_DIRECT_346_SOURCE_PROVENANCE");
    return;
  }
  if (source.mode !== mode) {
    assert331Source(source, sourceSha, base295);
    return;
  }
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(source.sourceSha, sourceSha);
  assert.match(source.sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount, 332);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor330, predecessor330);
  assert.deepEqual(source.predecessor331, predecessor331);
  assert.deepEqual(source.terminal, terminal);
}

module.exports = { mode, captureA08SuccessorSource, captureA08Direct346Source, assertA08Source };
