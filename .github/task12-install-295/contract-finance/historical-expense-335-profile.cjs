'use strict';

const assert = require('node:assert/strict');
const predecessor = require('./historical-settlement-334-profile.cjs');

const mode = 'historical-expense-335';
const count = 335;
const installerSha256 = 'f9c32bfec9aae7ba4f85dd8c907f88dce99237151b909877a62daed2ad9c51c4';
const raceSha256 = '2f525efede00dee1249c0a93dac186c8f6d18797cf1f9bb7b5f2126fd6bd548a';
const ledgerSha256 = 'd88146269c6cd32c12facd8561b6b629bf591b3637e307370d2123f030bb92f8';
const terminal = Object.freeze({
  name: '20261129012000_issue417_historical_expense_states',
  sha256: '924effc588fe48f9f4e63bd5187c2eb6a1a48b35d1749d699fccc4135ddaaecd'
});
const constraintNames = [
  'OperatingTakeoverRow_status_check', 'OperatingTakeoverBatch_status_check', 'OperatingTakeoverActivation_status_check'
];
const triggerNames = [
  'OperatingTakeoverActivation_partial_history_expense_check', 'OperatingTakeoverBatch_partial_history_expense_scene_check'
];
const triggerBodies = {
  OperatingTakeoverActivation_partial_history_expense_check: '756f8871172efc4c8a9c50179f291b833fa0910c7a37775530fd0bcc093abc65',
  OperatingTakeoverBatch_partial_history_expense_scene_check: '7fa4b88fdb60996032cf86daf0c9e14e87902e4c76233a8a8b4e3ad25e157be3'
};
const quoted = names => names.map(name => "'" + name + "'").join(',');
const catalogSql = `SELECT jsonb_build_object(
  'constraints', (SELECT jsonb_object_agg(c.conname, pg_get_constraintdef(c.oid))
    FROM pg_constraint c WHERE c.conname IN (${quoted(constraintNames)}) AND c.convalidated
      AND c.conrelid IN ('public."OperatingTakeoverRow"'::regclass, 'public."OperatingTakeoverBatch"'::regclass,
        'public."OperatingTakeoverActivation"'::regclass)),
  'triggers', (SELECT coalesce(jsonb_object_agg(t.tgname, jsonb_build_object(
    'active', t.tgenabled = 'O', 'definer', p.prosecdef, 'config', p.proconfig,
    'definition', pg_get_triggerdef(t.oid), 'bodyHash', encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
  )), '{}'::jsonb)
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgname IN (${quoted(triggerNames)}) AND NOT t.tgisinternal
      AND t.tgrelid IN ('public."OperatingTakeoverBatch"'::regclass, 'public."OperatingTakeoverActivation"'::regclass))
);`;

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.equal(source.migrationCount, count);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor334, { migrationCount: 334, ledgerSha256: predecessor.ledgerSha256 });
  assert.deepEqual(source.tails.at(-1), { ...terminal, finished: true, rolledBack: false });
  predecessor.assertSource({
    ...source, mode: predecessor.mode, migrationCount: 334, ledgerSha256: predecessor.ledgerSha256,
    tails: source.tails.slice(0, -1)
  }, predecessor295);
}

function assertCatalog(catalog, after) {
  const originalStates = [
    ['pending', 'accepted', 'blocked', 'activated'],
    ['draft', 'under_review', 'activated'],
    ['activated']
  ];
  const addedStates = [['verified', 'not_occurred', 'historical_expense'], ['partially_activated'], ['partially_activated']];
  assert.deepEqual(Object.keys(catalog.constraints).sort(), [...constraintNames].sort());
  for (const [index, name] of constraintNames.entries()) {
    const definition = catalog.constraints[name];
    const values = [...definition.matchAll(/'([a-z_]+)'::text/gu)].map(match => match[1]);
    const expected = after ? [...originalStates[index], ...addedStates[index]] : originalStates[index];
    assert.deepEqual(values.sort(), expected.sort(), name);
    if (after && index === 1) assert.ok(definition.includes('["historical_expense"]'), name);
  }
  assert.deepEqual(Object.keys(catalog.triggers).sort(), after ? [...triggerNames].sort() : []);
  for (const [name, trigger] of Object.entries(catalog.triggers)) {
    assert.equal(trigger.active, true);
    assert.equal(trigger.definer, false);
    assert.deepEqual(trigger.config, ['search_path=pg_catalog, public']);
    assert.equal(trigger.bodyHash, triggerBodies[name], name);
  }
}

module.exports = { mode, count, installerSha256, raceSha256, terminal, ledgerSha256, catalogSql, assertSource, assertCatalog };
