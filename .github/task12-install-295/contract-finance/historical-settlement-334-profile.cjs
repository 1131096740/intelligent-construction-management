'use strict';

const assert = require('node:assert/strict');
const previous = require('./historical-takeover-333-profile.cjs');

const mode = 'historical-settlement-334';
const installerSha256 = '89b088447358ac8cd9e49ae43492c26a33e24aa4fead4b2ddc11a78a46a364da';
const restoreInstallerSha256 = 'db5fef9a160b3db101b0075138b93cb4c0187b541a1ec3643dbb7e324a7072a9';
const ledgerSha256 = '27f3af946003d07582efb288b443362fcf61bed0281feb548f9978b739fb5411';
const terminal = Object.freeze({
  name: '20261129003000_historical_signed_settlement_continuation',
  sha256: '9df6dc654b8b0ea21713cc1c1dbcc73a8a74fd49f0df84da3b1556e85215ad5f'
});
const routines = {
  jg_save_signed_settlement_draft_v1: ['2ced90852bd8ef797438b5f71028c2f1141112163c8ecec02c2beada36dfc697', 'abda6a5843cc80510e8b662a88a6f45dd4057d05221e6efb2c23ffc7b5bae0b7'],
  jg_submit_signed_settlement_draft_v1: ['115b0f72038c40b6a115bd95dde88ef77ee2e7579dbbed9e1c07769d9b9d357c', '97b25a1c285f8fa1cfc0438017ba97e28b447a3236578e900ae29d187a2151ed'],
  jg_review_signed_settlement_draft_v1: ['33d529e9ff343b1e791b1ab507b39a0110f37fd82e26e895a5a98994a0ef8fb0', 'bb255527d0454028caf034bae9f279aac799d5e1a4026423f3b6106ebcf11cf0'],
  jg_signed_settlement_confirmed_projection_v1: ['2a168f6afed9d1319254b3ab7b593abfc83eedfd4ea733037b6c6b83fe55e489', 'a3a5d5d7404b184118ca0c033bca23a5f941897c548f985443720b57a03402c6'],
  jg_signed_settlement_contract_read_v1: ['4d88a0ad2713a468c5ff1d1f3433ef700d358ef2742df03e715642d812816a8b', '4cbf43821003080cfc35b9674753483951c3db3b6dc40057fc5edcbfe5c9619e']
};
const resolver = {
  name: 'jg_historical_signed_settlement_source_v1',
  sha256: '7d1883d6e32cff5792be0f9bcf9850b7b1135db040a1c86ef3bffc82d26638b6'
};
const catalogSql = `SELECT jsonb_object_agg(p.proname,jsonb_build_object(
  'sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'oid',p.oid::text,
  'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'configuration',p.proconfig,
  'publicExecute',(SELECT coalesce(bool_or(a.grantee=0 AND a.privilege_type='EXECUTE'),false)
    FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),
  'acl',p.proacl::text,'volatility',p.provolatile,'strict',p.proisstrict,'language',l.lanname
)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.proname IN (${[...Object.keys(routines), resolver.name].map(name => "'" + name + "'").join(',')});`;

function assertCatalog(catalog, before) {
  const names = Object.keys(routines);
  assert.deepEqual(Object.keys(catalog).sort(), (before ? [...names, resolver.name] : names).sort());
  for (const name of names) {
    const { sha256, ...metadata } = catalog[name];
    assert.equal(sha256, routines[name][before ? 1 : 0], name);
    assert.equal(metadata.definer, true);
    assert.equal(metadata.publicExecute, false);
    if (before) {
      const { sha256: oldHash, ...preimage } = before[name];
      assert.equal(oldHash, routines[name][0]);
      assert.deepEqual(metadata, preimage, name);
    }
  }
  if (before) {
    assert.equal(catalog[resolver.name].sha256, resolver.sha256);
    assert.equal(catalog[resolver.name].definer, false);
    assert.equal(catalog[resolver.name].publicExecute, false);
    assert.equal(catalog[resolver.name].language, 'sql');
  }
}

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.equal(source.migrationCount, 334);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor333, { migrationCount: 333, ledgerSha256: previous.ledgerSha256 });
  assert.deepEqual(source.tails.at(-1), { ...terminal, finished: true, rolledBack: false });
  previous.assertSource({
    ...source, mode: previous.mode, migrationCount: 333, ledgerSha256: previous.ledgerSha256,
    tails: source.tails.slice(0, -1)
  }, predecessor295);
}

function assertFinanceInstallation(receipt, source) {
  const upward = require('./upward-archive-332-profile.cjs');
  const anchor = receipt.historicalTakeoverPredecessor;
  previous.assertCatalog(anchor.catalog, false);
  upward.assertInstallation({
    ...receipt,
    forward320: {
      count: anchor.count, ledgerSha256: anchor.ledgerSha256,
      sourceTree: receipt.forward320.sourceTree,
      sameIdentity: anchor.sameIdentity, sameBaseB7: anchor.sameBaseB7,
      tails: receipt.forward320.tails.slice(0, 37)
    }
  }, { ...source, tails: source.tails.slice(0, 37) });
  previous.assertCatalog(receipt.historicalTakeover333Catalog, true);
  assert.equal(receipt.historicalSettlementPredecessor.count, 333);
  assert.equal(receipt.historicalSettlementPredecessor.ledgerSha256, previous.ledgerSha256);
  assertCatalog(receipt.historicalSettlementPredecessor.routineCatalog);
  assertCatalog(receipt.historicalSettlement334Catalog, receipt.historicalSettlementPredecessor.routineCatalog);
  assert.equal(receipt.forward320.count, 334);
  assert.equal(receipt.forward320.ledgerSha256, ledgerSha256);
  assert.equal(receipt.forward320.sameIdentity, true);
  assert.equal(receipt.forward320.sameBaseB7, true);
  assert.deepEqual(receipt.forward320.tails, source.tails.map(({name, sha256}) => ({name, sha256})));
}

module.exports = { mode, installerSha256, restoreInstallerSha256, ledgerSha256, terminal, catalogSql, assertCatalog, assertSource, assertFinanceInstallation,
  predecessor332: previous.predecessor332 };
