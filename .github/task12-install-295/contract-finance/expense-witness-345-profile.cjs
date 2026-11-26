'use strict';
const assert = require('node:assert/strict');
const history = require('./historical-settlement-334-profile.cjs');
const prefixes = require('./expense-witness-prefixes.json');
const mode = 'expense-witness-345';
const { ledgerSha256, terminal } = prefixes.at(-1);
const witness = 'ExpenseClaim_fact_witness_tuple_check';

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.equal(source.migrationCount, 345);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor334, { migrationCount: 334, ledgerSha256: history.ledgerSha256 });
  assert.deepEqual(source.tails.slice(-11), prefixes.slice(1).map(row => row.terminal));
  history.assertSource({ ...source, mode: history.mode, migrationCount: 334,
    ledgerSha256: history.ledgerSha256, tails: source.tails.slice(0, 39) }, predecessor295);
}

function assertPrefix(count, digest) {
  assert.equal(digest, prefixes[count - 334]?.ledgerSha256, 'EXPENSE_WITNESS_LEDGER_' + count);
}

const catalogSql = `
SELECT jsonb_build_object(
  'witness', (SELECT jsonb_build_object('oid', oid, 'validated', convalidated, 'def', pg_get_constraintdef(oid))
    FROM pg_constraint WHERE conrelid='public."ExpenseClaim"'::regclass AND conname='${witness}'),
  'foreignKey', (SELECT jsonb_build_object('oid', oid, 'validated', convalidated, 'def', pg_get_constraintdef(oid))
    FROM pg_constraint WHERE conrelid='public."ExpenseClaim"'::regclass AND conname='ExpenseClaim_factWitnessUserId_fkey'),
  'witnessIndex', (SELECT pg_get_indexdef(to_regclass('public."ExpenseClaim_factWitnessUserId_idx"'))),
  'costValidator', (SELECT jsonb_build_object('procedure', to_jsonb(p)-'prosrc', 'wiring', to_jsonb(t),
    'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."OperatingFact"'::regclass AND t.tgname='OperatingFact_validate_references'),
  'voucherBinding', (SELECT jsonb_build_object('wiring',to_jsonb(t),'procedure',to_jsonb(p)-'prosrc',
    'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."ExpenseClaimPaymentExecution"'::regclass AND t.tgname='jg_efb_expense_claim_payment_execution_voucher')
);`;
const cashSql = `
SELECT jsonb_build_object(
  'writer', (SELECT jsonb_build_object('body',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),
    'owner',proowner=current_user::regrole::oid,'definer',prosecdef,'config',proconfig,'acl',proacl)
    FROM pg_proc WHERE oid=to_regprocedure('public.jg_record_expense_public_cash_voucher(text,text,bigint,timestamp,text,text,text,text,text)')),
  'finish', (SELECT jsonb_build_object('body',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),
    'owner',proowner=current_user::regrole::oid,'definer',prosecdef,'config',proconfig,'acl',proacl)
    FROM pg_proc WHERE oid=to_regprocedure('public.jg_finish_expense_public_cash_voucher()')),
  'deferredGuard', (SELECT jsonb_build_object('type',tgtype,'enabled',tgenabled,'deferred',tgdeferrable AND tginitdeferred)
    FROM pg_trigger WHERE tgrelid='public.jg_expense_public_cash_voucher_witness'::regclass
    AND tgname='jg_expense_public_cash_voucher_debit_required'),
  'witnessRows', (SELECT count(*) FROM public.jg_expense_public_cash_voucher_witness)
);`;

const validatorBodies = new Map([
  ['26a0fe0d77faa0cb21df9098d339f6350e45e9468504d1cc9d66afee4171a975', 'bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6'],
  ['a9f2052a70675effdd906929c1b3490c4f4f81867b65b29ea13c9e3a935f7434', '61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb'],
  ['a59d505c02c2e0ff453ed0ccf29b25909449aa9cf1149f4a414844abc0541e1b', 'f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987']
]);

function assertCatalog(count, snapshot, previous) {
  assert.ok(snapshot.witness?.validated && snapshot.foreignKey?.validated && snapshot.witnessIndex, 'EXPENSE_WITNESS_CONSTRAINTS');
  assert.ok(snapshot.costValidator && snapshot.voucherBinding, 'EXPENSE_WITNESS_PRIOR_GUARDS');
  assert.match(snapshot.witness.def, /btrim\("factWitnessNameSnapshot"\)/u);
  for (const key of ['foreignKey', 'witnessIndex', 'voucherBinding']) {
    if (previous) assert.deepEqual(snapshot[key], previous[key], 'EXPENSE_WITNESS_PRIOR_GUARD_DRIFT');
  }
  if (count === 342) {
    assert.equal(snapshot.costValidator.body, validatorBodies.get(previous.costValidator.body), 'EXPENSE_WITNESS_342_VALIDATOR_BODY');
    assert.deepEqual(snapshot.costValidator.procedure, previous.costValidator.procedure);
    assert.deepEqual(snapshot.costValidator.wiring, previous.costValidator.wiring);
  } else if (previous) assert.deepEqual(snapshot.costValidator, previous.costValidator);
  if (count === 345) {
    assert.notEqual(snapshot.witness.oid, previous.witness.oid);
    for (const word of ['reimbursement','generalProcurementId','actualPurchaseBatchId']) assert.ok(snapshot.witness.def.includes(word));
  } else {
    assert.ok(!snapshot.witness.def.includes('reimbursement'));
    if (previous) assert.deepEqual(snapshot.witness, previous.witness);
  }
}

function assertCash(cash) {
  assert.equal(cash.witnessRows, 0, 'EXPENSE_WITNESS_344_ACTIVE_WITNESS');
  const { writer, finish } = cash;
  assert.equal(writer?.body, 'c76816304e9e558c6f225985164cacad2776acb63f7b883495c43caff986caec');
  assert.equal(finish?.body, 'fb5efb4c0cc96502c9e33cb5e70fbf517d9dc4e049a6f5100530b1b74151c6ee');
  assert.ok(writer.owner && finish.owner && writer.definer && finish.definer);
  assert.deepEqual(cash.deferredGuard, { type: 5, enabled: 'O', deferred: true });
}

module.exports = { mode, terminal, ledgerSha256, assertSource, assertPrefix, catalogSql, assertCatalog, cashSql, assertCash };
