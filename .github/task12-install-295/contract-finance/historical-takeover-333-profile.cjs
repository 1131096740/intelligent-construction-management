'use strict';

const assert = require('node:assert/strict');
const predecessor332 = 'b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4';

const mode = 'historical-takeover-333';
const installerSha256 = '0af924527e7f6fdb70c51348ee0567f51f722da9035467341c43df53737aa420';
const ledgerSha256 = 'a00af648da634cce25c27c796171ca21cfa93d17679bfd8176f961b45ecf4fca';
const terminal = Object.freeze({
  name: '20261129002000_contract_takeover_no_grade_handover_checks',
  sha256: '4e41179d32a8e46eae83685eb8c071a112de5426e9ec5f6a6e6d320b4ef95f77'
});
const level = 'ContractTakeover_level_check';
const side = 'ContractTakeoverConfirmationEvent_side_check';
const action = 'ContractTakeoverConfirmationEvent_action_check';
const withdrawal = 'ContractTakeoverConfirmationEvent_withdraw_reason_check';

const catalogSql = `SELECT jsonb_object_agg(conname, jsonb_build_object(
  'definition', pg_get_expr(conbin, conrelid),
  'validated', convalidated
)) FROM pg_catalog.pg_constraint
WHERE contype = 'c' AND (
  (conrelid = 'public."ContractTakeover"'::regclass AND conname = '${level}')
  OR (conrelid = 'public."ContractTakeoverConfirmationEvent"'::regclass AND conname IN ('${side}', '${action}', '${withdrawal}'))
);`;

function assertCatalog(catalog, after) {
  assert.deepEqual(Object.keys(catalog).sort(), [action, level, side, withdrawal].sort(), 'A28_CONSTRAINT_CATALOG_SHAPE');
  const expression = name => {
    assert.equal(catalog[name].validated, true, 'A28_CONSTRAINT_VALIDATED');
    return catalog[name].definition.replaceAll('::text', '').replace(/[()\s"]/gu, '');
  };
  assert.equal(expression(level), "takeoverLevel=ANYARRAY['A','B','C'" + (after ? ",'NONE'" : '') + ']');
  assert.equal(expression(side), "side=ANYARRAY['contract','finance'" + (after ? ",'handover'" : '') + ']');
  const legacyAction = "action=ANYARRAY['confirm','withdraw']";
  assert.equal(expression(action), after
    ? "side=ANYARRAY['contract','finance']AND" + legacyAction + "ORside='handover'ANDaction=ANYARRAY['handover_register','handover_reassign']"
    : legacyAction);
  assert.equal(expression(withdrawal).toUpperCase(), "ACTION<>'WITHDRAW'ORNULLIFBTRIMREASON,''ISNOTNULL");
}

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u);
  assert.match(source.sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount, 333);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor332, { migrationCount: 332, ledgerSha256: predecessor332 });
  assert.equal(source.predecessor.migrationCount, 295);
  assert.equal(source.predecessor.ledgerSha256, predecessor295);
  assert.equal(source.tails.length, 38);
  assert.deepEqual(source.tails.at(-1), { ...terminal, finished: true, rolledBack: false });
}

module.exports = { mode, installerSha256, ledgerSha256, predecessor332, terminal, catalogSql, assertCatalog, assertSource };
