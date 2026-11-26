"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const takeover = require("../../../.github/task12-install-295/contract-finance/historical-takeover-333-profile.cjs");
const settlement = require("../../../.github/task12-install-295/contract-finance/historical-settlement-334-profile.cjs");

const prefixDigests = Object.freeze({
  330: "12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f",
  331: "0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014",
  332: takeover.predecessor332,
  333: takeover.ledgerSha256,
  334: settlement.ledgerSha256,
  335: "c30dae0765e1ec3fab7df47cdc87fbe81e79caf044f400ac2742af13f1935e69",
  336: "191146be35ded4403611011595e49cdc9fae0368eba2c9c3383d36187147267b",
  337: "bf605f3797f13bdf4b0b2b10f650d2274d948fe3851067e151a07052cd9da486",
  338: "7bc5a865850aad7699646704b3dfc0112244af05912bc117d83540132b1ef155",
  339: "5d1613031f4e89f5effadf215cc2003fa22864aa3f5e24ce0fda9627a49c9e4f",
  340: "926f3247bb8404665c50706296ee12b0abb809ab70c7d7ce203701ce1bc354a1",
  341: "30da81d2089c941e912b0149969a508d6df8ccab1d501b78b1aedc6ff8f2832f"
});
const prefixes = [332, 333, 334, 335, 336, 337, 338, 339, 340, 341];
const digest = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

function verifyA24Prefix(size, ledger) {
  assert.ok(prefixes.includes(size));
  assert.equal(ledger.length, size);
  assert.equal(digest(ledger), prefixDigests[size], "NATIVE_A24_340_PINNED_LEDGER");
  return { count: size, ledgerSha256: prefixDigests[size], sameIdentity: true };
}

function qualifyA24Source(candidate, sourceTree, ledger, terminal = 340) {
  assert.ok(terminal === 340 || terminal === 341);
  assert.match(candidate, /^[a-f0-9]{40}$/u);
  assert.match(sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(ledger.length, terminal, "NATIVE_A24_" + terminal + "_COUNT");
  for (const size of [330, 331]) {
    assert.equal(digest(ledger.slice(0, size)), prefixDigests[size], "NATIVE_A24_340_PINNED_LEDGER");
  }
  const a24Prefixes = prefixes.filter(size => size <= terminal);
  for (const size of a24Prefixes) verifyA24Prefix(size, ledger.slice(0, size));
  return {
    candidate, sourceTree, ledger, ledgerDigest: prefixDigests[terminal],
    predecessor330: { migrationCount: 330, ledgerSha256: prefixDigests[330] },
    a24Prefixes
  };
}

function createHistoricalCatalogCheck(read) {
  const snapshots = {};
  const observe = () => ({ takeover: read(takeover.catalogSql), settlement: read(settlement.catalogSql) });
  function atPrefix(size) {
    if (size === 332) {
      const before = read(takeover.catalogSql);
      takeover.assertCatalog(before, false);
      snapshots.predecessor332 = before;
    }
    if (size === 333) {
      const result = observe();
      takeover.assertCatalog(result.takeover, true);
      settlement.assertCatalog(result.settlement);
      snapshots.predecessor333 = result;
    }
    if (size === 334) {
      const result = observe();
      assert.deepEqual(result.takeover, snapshots.predecessor333.takeover, "NATIVE_A24_334_TAKEOVER_CATALOG");
      settlement.assertCatalog(result.settlement, snapshots.predecessor333.settlement);
      snapshots.predecessor334 = result;
    }
    if (size === 340 || size === 341) {
      const result = observe();
      assert.deepEqual(result, snapshots.predecessor334, "NATIVE_A24_340_HISTORICAL_CATALOG");
      snapshots["beforeBusiness" + size] = result;
    }
  }
  function verifyAfterBusiness() {
    const beforeBusiness = snapshots.beforeBusiness341 ?? snapshots.beforeBusiness340;
    assert.ok(beforeBusiness, "NATIVE_A24_340_HISTORICAL_CATALOG_MISSING");
    const result = observe();
    assert.deepEqual(result, beforeBusiness, "NATIVE_A24_340_HISTORICAL_CATALOG_AFTER_BUSINESS");
    return result;
  }
  return { snapshots, atPrefix, verifyAfterBusiness };
}

module.exports = { qualifyA24Source, verifyA24Prefix, createHistoricalCatalogCheck };
