"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const prefixDigests = Object.freeze({
  330: "12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f",
  331: "0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014",
  332: "b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4",
  333: "5d976993327b69a431b0c991ed31d739e3992651d600bae4626512d67aa4378a",
  334: "bb6dda55ed63c94806f1224574adb8cd1e3c0c131b779be8f7aabcd1b6ad00b4",
  335: "31db0c16115aabfab517a8628f09081706b10527aab5b2d099690a72420eec59",
  336: "e81141ccb489a09747eea7062105bda686b5a464bc0f13b29b887f6d7e9892a9"
});
const suffix = [333, 334, 335, 336];
const digest = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

function qualifyA24Source(candidate, sourceTree, ledger) {
  assert.match(candidate, /^[a-f0-9]{40}$/u);
  assert.match(sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(ledger.length, 336);
  for (const [size, hash] of Object.entries(prefixDigests)) {
    assert.equal(digest(ledger.slice(0, Number(size))), hash, "NATIVE_A24_PINNED_LEDGER");
  }
  return {
    candidate, sourceTree, ledger, ledgerDigest: prefixDigests[336],
    predecessor330: { migrationCount: 330, ledgerSha256: prefixDigests[330] },
    a24Prefixes: [332, ...suffix]
  };
}

function verifyA24Prefix(size, ledger) {
  assert.ok([332, ...suffix].includes(size));
  assert.equal(ledger.length, size);
  assert.equal(digest(ledger), prefixDigests[size]);
  return { count: size, ledgerSha256: prefixDigests[size], sameIdentity: true };
}

module.exports = { qualifyA24Source, verifyA24Prefix };
