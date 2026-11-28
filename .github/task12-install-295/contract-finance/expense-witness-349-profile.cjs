'use strict';

const assert = require('node:assert/strict');
const previous = require('./expense-witness-346-profile.cjs');

const mode = 'expense-witness-349';
const count = 349;
const installerSha256 = 'a38d1424c1f096d1ed43cffbdd70f99521281a30d09bf5792261a4bbd3ff540a';
const tails = [
  ['20261129016000_reimbursement_business_amount_precision',
    'd5a34145bce2ed278c214df066190106d455032939112eefe2ea5fb8a4d157a4',
    '300638368de3fd984c0bc46aab17e43d6ffb3fb684ccc43f25406fb035f7f4ef'],
  ['20261129017000_reimbursement_exact_operating_cost',
    '8fc8227575264f2b262cc023636700e2a8b9479b144aa788c94a691de7d497de',
    '9aac647672dfeb859e18bf637a3940bd3fdfa6743cecb69d8c1046af16a9e20d'],
  ['20261129018000_reimbursement_exact_cash_cost_links',
    '58b3cc0404a85a97dbb484654245d4bd042e5fb2014f32997244b2597cb5110b',
    '8bfe19831eeb7da7c38c8a4f8c4cda98b9b1a165bf4013f0e39816c0fd340679']
].map(([name, sha256, ledgerSha256]) => ({
  terminal: { name, sha256, finished: true, rolledBack: false }, ledgerSha256
}));
const { terminal, ledgerSha256 } = tails.at(-1);

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u);
  assert.match(source.sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount, count);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor346, { migrationCount: previous.count, ledgerSha256: previous.ledgerSha256 });
  assert.equal(source.tails.length, count - 295);
  assert.deepEqual(source.tails.slice(-tails.length), tails.map(row => row.terminal));
  previous.assertSource({
    ...source, mode: previous.mode, migrationCount: previous.count,
    ledgerSha256: previous.ledgerSha256, tails: source.tails.slice(0, -tails.length)
  }, predecessor295);
}

function assertRuntimeBaseline({ loadManifest, deriveMigrationBaseline, DEFAULT_MANIFEST_PATH }) {
  const expected = [count, terminal.name, terminal.sha256];
  const tuple = row => [row.expectedDirectoryCount, row.terminalMigration, row.terminalMigrationChecksum];
  assert.deepEqual(tuple(loadManifest(DEFAULT_MANIFEST_PATH).migrationBaseline), expected, 'EXPENSE_PRECISION_349_RELEASE_SCOPE');
  assert.deepEqual(tuple(deriveMigrationBaseline()), expected, 'EXPENSE_PRECISION_349_RUNTIME_SCOPE');
}

function assertPrefix(size, digest) {
  assert.ok(Number.isInteger(size) && size >= 334 && size <= count, 'EXPENSE_PRECISION_PREFIX_SIZE');
  if (size <= previous.count) previous.assertPrefix(size, digest);
  else assert.equal(digest, tails[size - previous.count - 1]?.ledgerSha256, 'EXPENSE_PRECISION_LEDGER_' + size);
}

const oldScope = 'AND NEW."historicalTakeoverBatchId" IS NULL AND NEW."numericProtocolVersion" = 1';
const newScope = 'AND NEW."historicalTakeoverBatchId" IS NULL AND NEW."numericProtocolVersion" IN (1,2)';
const oldAmount = 'AND expense."requestedAmountCents" = NEW."amountCents"';
const newAmount = `AND ((NEW."numericProtocolVersion" = 1 AND expense."requestedAmountCents" = NEW."amountCents")
      OR (NEW."numericProtocolVersion" = 2 AND expense."claimType" = 'reimbursement'
        AND expense."requestedAmountYuan" = NEW."amountYuan"))`;
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const digestSql = expression => `encode(sha256(convert_to(${expression}, 'UTF8')), 'hex')`;

const catalogSql = `
WITH columns AS (
  SELECT jsonb_object_agg(q.column_name, jsonb_build_object(
    'type', format_type(a.atttypid,a.atttypmod), 'nullable', NOT a.attnotnull,
    'plain', a.attidentity='' AND a.attgenerated='' AND NOT a.atthasdef
  )) AS value
  FROM (VALUES ('ExpenseClaim','requestedAmountYuan'),('ExpenseClaimLine','amountYuan')) q(relation,column_name)
  JOIN pg_attribute a ON a.attrelid=to_regclass(format('public.%I',q.relation))
    AND a.attname=q.column_name AND a.attnum>0 AND NOT a.attisdropped
), constraints AS (
  SELECT jsonb_object_agg(c.conname, jsonb_build_object('oid',c.oid, 'digest',${digestSql('pg_get_constraintdef(c.oid)')})) AS value
  FROM (VALUES ('ExpenseClaim','ExpenseClaim_amounts_nonnegative_check'),
    ('ExpenseClaimLine','ExpenseClaimLine_amount_positive_check'),
    ('OperatingFact','OperatingFact_numeric_protocol_check'),
    ('OperatingImpactEntry','OperatingImpactEntry_numeric_protocol_check')) q(relation,name)
  JOIN pg_constraint c ON c.conrelid=to_regclass(format('public.%I',q.relation)) AND c.conname=q.name
    AND c.contype='c' AND c.convalidated AND NOT c.condeferrable AND NOT c.connoinherit
), guards AS (
  SELECT jsonb_object_agg(q.trigger, jsonb_build_object('body',${digestSql('p.prosrc')},
    'procedure',to_jsonb(p)-'prosrc','wiring',to_jsonb(t),'definition',pg_get_triggerdef(t.oid))) AS value
  FROM (VALUES
    ('OperatingFact','OperatingFact_reimbursement_exact_source','jg_validate_reimbursement_exact_cost_source',7,false),
    ('OperatingFact','OperatingFact_reimbursement_exact_impacts','jg_require_reimbursement_exact_cost_impacts',5,true),
    ('OperatingImpactEntry','OperatingImpactEntry_money_protocol_parent','requireOperatingImpactMoneyProtocol',7,false),
    ('ExpensePublicCashCostLink','ExpensePublicCashCostLink_conservation','jg_expense_public_cash_cost_link_conservation',5,true),
    ('OperatingCostAttributionConfirmation','ExpenseCashCostAttribution_check','jg_expense_cash_cost_attribution_check',31,false)
  ) q(relation,trigger,routine,event, deferred)
  JOIN pg_trigger t ON t.tgrelid=to_regclass(format('public.%I',q.relation)) AND t.tgname=q.trigger
    AND t.tgtype=q.event AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgnargs=0
    AND t.tgdeferrable=q.deferred AND t.tginitdeferred=q.deferred
    AND (t.tgconstraint<>0)=q.deferred
  JOIN pg_proc p ON p.oid=t.tgfoid AND p.oid=to_regprocedure(format('public.%I()',q.routine))
    AND p.proowner=current_user::regrole::oid AND p.prorettype='pg_catalog.trigger'::regtype
), cost AS (
  SELECT CASE WHEN cardinality(string_to_array(p.prosrc,${literal(oldScope)}))=2
    AND cardinality(string_to_array(p.prosrc,${literal(oldAmount)}))=2
    THEN ${digestSql(`replace(replace(p.prosrc,${literal(oldScope)},${literal(newScope)}),
      ${literal(oldAmount)},${literal(newAmount)})`)} END AS expected
  FROM pg_proc p WHERE p.oid=to_regprocedure('public."validateOperatingFactReferences"()')
)
SELECT jsonb_build_object('columns',columns.value,'constraints',constraints.value,'guards',guards.value,
  'expectedCostValidatorAfter348',(SELECT expected FROM cost))
FROM columns CROSS JOIN constraints CROSS JOIN guards;`;

const baseGuards = {
  ExpensePublicCashCostLink_conservation: '0621d11363cb4ff868db3430993acc9c751046c86e76464ab979086b6945948f',
  ExpenseCashCostAttribution_check: '3a95d150516adcfcdea01185fd2c76b2f00ba00759775bc5bcf9922f07c0876e'
};
const cashGuards349 = {
  ExpensePublicCashCostLink_conservation: 'b4402a46778d25cbe61a873a3b2e5446d00179e9e41488ac61cc5127c7bea823',
  ExpenseCashCostAttribution_check: '4c71f780ed41e8dfde0bdbb44585805f1c5f5b526a09fc4ffef5e52a1a5f21ec'
};
const costGuards348 = {
  OperatingFact_reimbursement_exact_source: '9e1887bb6ba7b7fc3651bf5db57cbb6325b6a7d6643b8a2ddf9a369d0133d01b',
  OperatingFact_reimbursement_exact_impacts: '037877124bc8061400d97351bdb9aaa3482c7d5380cb55335046bd62d61d3026'
};
const moneyProtocol348 = 'ee6c957720c75515173c5858194c6589c3b7cc20a479a02be53863243b0e04fa';
const impactProtocol = 'OperatingImpactEntry_money_protocol_parent';
const precisionConstraints = ['ExpenseClaim_amounts_nonnegative_check','ExpenseClaimLine_amount_positive_check'];
const operatingConstraints = ['OperatingFact_numeric_protocol_check','OperatingImpactEntry_numeric_protocol_check'];
const expectedColumns = {
  requestedAmountYuan: { type: 'numeric(24,4)', nullable: true, plain: true },
  amountYuan: { type: 'numeric(24,4)', nullable: true, plain: true }
};

function assertBodies(actual, expected) {
  for (const [name, body] of Object.entries(expected)) {
    assert.equal(actual[name]?.body, body, 'EXPENSE_PRECISION_GUARD_BODY ' + name);
  }
}

function assertCheckpoint(size, observed, initial, after347, after348) {
  assert.deepEqual(observed.columns, size === 346 ? null : expectedColumns, 'EXPENSE_PRECISION_COLUMNS');
  assert.deepEqual(Object.keys(observed.constraints).sort(), [...precisionConstraints, ...operatingConstraints].sort(),
    'EXPENSE_PRECISION_CONSTRAINTS');
  assert.deepEqual(Object.keys(observed.guards).sort(),
    [...Object.keys(baseGuards), impactProtocol, ...(size < 348 ? [] : Object.keys(costGuards348))].sort(),
    'EXPENSE_PRECISION_GUARD_SET');
  assertBodies(observed.guards, size === 349 ? cashGuards349 : baseGuards);
  if (size === 346) {
    assert.match(observed.expectedCostValidatorAfter348, /^[a-f0-9]{64}$/u, 'EXPENSE_PRECISION_348_EXACT_PREIMAGE');
    return;
  }
  const prior = size === 347 ? initial : size === 348 ? after347 : after348;
  const changedConstraints = size === 347 ? precisionConstraints : size === 348 ? operatingConstraints : [];
  for (const [name, constraint] of Object.entries(observed.constraints)) {
    if (changedConstraints.includes(name)) {
      assert.notEqual(constraint.oid, prior.constraints[name].oid, 'EXPENSE_PRECISION_CONSTRAINT_REPLACEMENT ' + name);
      assert.notEqual(constraint.digest, prior.constraints[name].digest, 'EXPENSE_PRECISION_CONSTRAINT_IMAGE ' + name);
    } else {
      assert.deepEqual(constraint, prior.constraints[name], 'EXPENSE_PRECISION_CONSTRAINT_CONTINUITY ' + name);
    }
  }
  if (size < 348) {
    assert.deepEqual(observed.guards, initial.guards, 'EXPENSE_PRECISION_347_GUARD_CONTINUITY');
    assert.equal(observed.expectedCostValidatorAfter348, initial.expectedCostValidatorAfter348, 'EXPENSE_PRECISION_347_PREIMAGE');
    return;
  }
  assert.equal(observed.expectedCostValidatorAfter348, null, 'EXPENSE_PRECISION_348_PREIMAGE_ABSENT');
  assertBodies(observed.guards, { ...costGuards348, [impactProtocol]: moneyProtocol348 });
  if (size === 348) {
    for (const name of Object.keys(baseGuards)) {
      assert.deepEqual(observed.guards[name], prior.guards[name], 'EXPENSE_PRECISION_348_CASH_GUARD_CONTINUITY');
    }
    assert.deepEqual(observed.guards[impactProtocol], { ...prior.guards[impactProtocol], body: moneyProtocol348 },
      'EXPENSE_PRECISION_348_IMPACT_PROTOCOL_METADATA');
    const expectedCondition = `WHEN (((new."sourceType" = 'expense_claim_approval'::text) AND (new."numericProtocolVersion" = 2)))`;
    for (const name of Object.keys(costGuards348)) {
      assert.ok(observed.guards[name].definition.includes(expectedCondition), 'EXPENSE_PRECISION_348_COST_TRIGGER_SCOPE');
    }
    return;
  }
  assert.equal(size, count);
  for (const [name, guard] of Object.entries(observed.guards)) {
    assert.deepEqual(guard, { ...prior.guards[name], body: cashGuards349[name] ?? prior.guards[name].body },
      'EXPENSE_PRECISION_349_GUARD_CONTINUITY ' + name);
  }
}

function assertExpenseCatalog(observed, baseline, validatorBody) {
  assert.deepEqual(observed, {
    ...baseline, costValidator: { ...baseline.costValidator, body: validatorBody }
  }, 'EXPENSE_PRECISION_349_EXPENSE_CATALOG_CONTINUITY');
}

module.exports = { mode, count, installerSha256, terminal, ledgerSha256, assertPrefix, assertSource,
  assertRuntimeBaseline, catalogSql, assertCheckpoint, assertExpenseCatalog };
