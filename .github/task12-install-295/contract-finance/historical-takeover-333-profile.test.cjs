'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertCatalog, assertSource, ledgerSha256, terminal, mode } = require('./historical-takeover-333-profile.cjs');

const catalog = (after) => ({
  ContractTakeover_level_check: {
    definition: `("takeoverLevel" = ANY (ARRAY['A'::text, 'B'::text, 'C'::text${after ? ", 'NONE'::text" : ''}]))`,
    validated: true
  },
  ContractTakeoverConfirmationEvent_side_check: {
    definition: `(side = ANY (ARRAY['contract'::text, 'finance'::text${after ? ", 'handover'::text" : ''}]))`,
    validated: true
  },
  ContractTakeoverConfirmationEvent_action_check: {
    definition: after
      ? "(((side = ANY (ARRAY['contract'::text, 'finance'::text])) AND (action = ANY (ARRAY['confirm'::text, 'withdraw'::text]))) OR ((side = 'handover'::text) AND (action = ANY (ARRAY['handover_register'::text, 'handover_reassign'::text]))))"
      : "(action = ANY (ARRAY['confirm'::text, 'withdraw'::text]))",
    validated: true
  },
  ContractTakeoverConfirmationEvent_withdraw_reason_check: {
    definition: "((action <> 'withdraw'::text) OR (NULLIF(btrim(reason), ''::text) IS NOT NULL))",
    validated: true
  }
});

test('binds 333 to the old 332 ledger and rejects another terminal migration', () => {
  const source = { mode, sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), migrationCount: 333, ledgerSha256,
    predecessor332: { migrationCount: 332, ledgerSha256: "b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4" }, predecessor: { migrationCount: 295, ledgerSha256: 'fixture' },
    tails: [...Array(37), { ...terminal, finished: true, rolledBack: false }] };
  assertSource(source, 'fixture');
  assert.throws(() => assertSource({ ...source, predecessor332: { ...source.predecessor332, ledgerSha256: 'wrong' } }, 'fixture'));
  assert.throws(() => assertSource({ ...source, tails: [...Array(37), { ...source.tails.at(-1), sha256: 'wrong' }] }, 'fixture'));
});

test('requires the legacy checks before migration and the new validated checks after', () => {
  assertCatalog(catalog(false), false);
  assertCatalog(catalog(true), true);
  assert.throws(() => assertCatalog(catalog(false), true));
  const unexpected = catalog(true);
  unexpected.ContractTakeoverConfirmationEvent_action_check.definition = catalog(false).ContractTakeoverConfirmationEvent_action_check.definition;
  assert.throws(() => assertCatalog(unexpected, true));
  unexpected.ContractTakeoverConfirmationEvent_action_check = { ...catalog(true).ContractTakeoverConfirmationEvent_action_check, validated: false };
  assert.throws(() => assertCatalog(unexpected, true));
});
