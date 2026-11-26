"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { qualifyA24Source, verifyA24Prefix } = require("./task426-a24-native-profile.cjs");
const combined = require("./task426-a24-native340-profile.cjs");
const cashVoucher = require("./task426-a24-native344-voucher.cjs");

const root = path.resolve(__dirname, "../prisma/migrations");
const rows = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  .map(name => ({
    name, sha256: createHash("sha256").update(readFileSync(path.join(root, name, "migration.sql"))).digest("hex"),
    finished: true, rolledBack: false
  }));
const isolatedRows = [...rows.slice(0, 332), ...[334, 335, 337, 338].map(index => rows[index])];

test("qualifies the isolated 332 predecessor and all four ordered A24 prefixes by their complete ledger digests", () => {
  const profile = qualifyA24Source("a".repeat(40), "b".repeat(40), isolatedRows);
  assert.deepEqual(profile.a24Prefixes, [332, 333, 334, 335, 336]);
  assert.deepEqual(profile.a24Prefixes.map(count => verifyA24Prefix(count, isolatedRows.slice(0, count)).count), [332, 333, 334, 335, 336]);
});

test("refuses any changed historical row, reordering, or imported combined migration", () => {
  const changed = isolatedRows.map((row, index) => index === 331 ? { ...row, rolledBack: true } : row);
  assert.throws(() => qualifyA24Source("a".repeat(40), "b".repeat(40), changed), /NATIVE_A24_PINNED_LEDGER/u);
  assert.throws(() => qualifyA24Source("a".repeat(40), "b".repeat(40), [...isolatedRows.slice(0, 332), isolatedRows[333], isolatedRows[332],
    ...isolatedRows.slice(334)]), /NATIVE_A24_PINNED_LEDGER/u);
  assert.throws(() => qualifyA24Source("a".repeat(40), "b".repeat(40), rows));
});

test("requires the combined 334 predecessor and individual exact rows through 340", () => {
  const qualify = ledger => combined.qualifyA24Source("a".repeat(40), "b".repeat(40), ledger);
  const combined340 = rows.slice(0, 340);
  const profile = qualify(combined340);
  assert.deepEqual(profile.a24Prefixes, [332, 333, 334, 335, 336, 337, 338, 339, 340]);
  assert.deepEqual(combined.verifyA24Prefix(334, rows.slice(0, 334)), {
    count: 334, sameIdentity: true, ledgerSha256: "27f3af946003d07582efb288b443362fcf61bed0281feb548f9978b739fb5411"
  });
  assert.equal(combined.verifyA24Prefix(340, combined340).ledgerSha256, profile.ledgerDigest);
  assert.throws(() => qualify(isolatedRows), /NATIVE_A24_340_COUNT/u);
  assert.throws(() => qualify(rows.slice(0, 334)), /NATIVE_A24_340_COUNT/u);
  assert.throws(() => qualify([...rows.slice(0, 332), rows[333], rows[332], ...combined340.slice(334)]), /NATIVE_A24_340_PINNED_LEDGER/u);
  assert.throws(() => qualify([...rows.slice(0, 339), { ...rows[339], finished: false }]), /NATIVE_A24_340_PINNED_LEDGER/u);
});

test("requires the exact 341 successor and refuses cross-profile admission", () => {
  const qualify = (ledger, terminal) => combined.qualifyA24Source("a".repeat(40), "b".repeat(40), ledger, terminal);
  const combined341 = rows.slice(0, 341);
  const source = qualify(combined341, 341);
  assert.equal(source.a24Prefixes.at(-1), 341);
  assert.equal(combined.verifyA24Prefix(341, combined341).ledgerSha256, source.ledgerDigest);
  assert.throws(() => qualify(combined341, 340), /NATIVE_A24_340_COUNT/u);
  assert.throws(() => qualify(rows.slice(0, 340), 341), /NATIVE_A24_341_COUNT/u);
  assert.throws(() => qualify([...rows.slice(0, 340), { ...rows[340], rolledBack: true }], 341), /NATIVE_A24_340_PINNED_LEDGER/u);
});

test("qualifies the 342 fact successor only after the exact 341 prefix", () => {
  const qualify = (ledger, terminal) => combined.qualifyA24Source("a".repeat(40), "b".repeat(40), ledger, terminal);
  const combined342 = rows.slice(0, 342);
  const source = qualify(combined342, 342);
  assert.equal(source.a24Prefixes.at(-1), 342);
  assert.equal(combined.verifyA24Prefix(342, combined342).ledgerSha256, source.ledgerDigest);
  assert.throws(() => qualify(combined342, 341), /NATIVE_A24_341_COUNT/u);
  assert.throws(() => qualify([...combined342, rows[342]], 342), /NATIVE_A24_342_COUNT/u);
  assert.throws(() => qualify(rows.slice(0, 341), 342), /NATIVE_A24_342_COUNT/u);
  assert.throws(() => qualify([...rows.slice(0, 340), rows[341], rows[340]], 342), /NATIVE_A24_340_PINNED_LEDGER/u);
});

test("qualifies exact 343 historical expense and 344 cash voucher in order", () => {
  const qualify = ledger => combined.qualifyA24Source("a".repeat(40), "b".repeat(40), ledger, 344);
  const profile = qualify(rows);
  assert.deepEqual(profile.a24Prefixes.slice(-3), [342, 343, 344]);
  assert.equal(combined.verifyA24Prefix(343, rows.slice(0, 343)).ledgerSha256,
    "17c4d2d98cf19b6f3e7fd2581165940b0f803c5e306bc68adfe018ac52048307");
  assert.equal(combined.verifyA24Prefix(344, rows).ledgerSha256, profile.ledgerDigest);
  assert.throws(() => qualify(rows.slice(0, 343)), /NATIVE_A24_344_COUNT/u);
  assert.throws(() => qualify([...rows.slice(0, 342), rows[343], rows[342]]), /NATIVE_A24_340_PINNED_LEDGER/u);
});

test("refuses missing historical catalog evidence at the 340 boundary", () => {
  const check = combined.createHistoricalCatalogCheck(() => ({}));
  assert.throws(() => check.atPrefix(332), /A28_CONSTRAINT_CATALOG_SHAPE/u);
  assert.throws(() => check.atPrefix(340), /NATIVE_A24_340_HISTORICAL_CATALOG/u);
  assert.throws(() => check.verifyAfterBusiness(), /NATIVE_A24_340_HISTORICAL_CATALOG_MISSING/u);
});

test("reads the 343 mixed OLD and NEW trigger condition through the trigger deparser", () => {
  const preimage = cashVoucher.readCatalog(342);
  const installed = cashVoucher.readCatalog(343);
  assert.doesNotMatch(preimage, /OperatingTakeoverBatch_partial_history_expense_scene_check/u);
  assert.match(installed, /OperatingTakeoverBatch_partial_history_expense_scene_check/u);
  assert.match(installed, /CASE WHEN t\.tgqual IS NULL THEN '' ELSE pg_get_triggerdef\(t\.oid\) END/u);
  assert.doesNotMatch(installed, /pg_get_expr\(t\.tgqual/u);
});

test("pins the 343 batch scene as JSON and its row scene as text", () => {
  const sql = readFileSync(path.join(root, rows[342].name, "migration.sql"), "utf8");
  const routines = {};
  for (const [, name, body] of sql.matchAll(/CREATE FUNCTION public\.(\w+)\(\)[\s\S]*? AS \$\$([\s\S]*?)\$\$;/gu)) {
    routines[name] = { oid: 1, body: createHash("sha256").update(body).digest("hex"), owner: true, definer: false };
  }
  const trigger = (relation, routine, type, condition) =>
    ({ oid: 1, relation, routine, type, enabled: true, deferred: false, condition });
  const good = {
    oldBinding: {}, ownerLookup: {}, debitConservation: {}, routines,
    triggers: {
      OperatingTakeoverActivation_partial_history_expense_check: trigger("OperatingTakeoverActivation",
        "jg_issue417_check_partial_activation", 23, "WHEN (new.status = 'partially_activated')"),
      OperatingTakeoverBatch_partial_history_expense_scene_check: trigger("OperatingTakeoverBatch",
        "jg_issue417_preserve_partial_activation_scene", 19, `WHEN (old."sceneKeys" = '["historical_expense"]'::jsonb)`)
    },
    constraints: {}
  };
  for (const [, relation, name, definition] of sql.matchAll(
    /ALTER TABLE public\."(\w+)"[\s\S]*?ADD CONSTRAINT "(\w+)" (CHECK \([\s\S]*?\));/gu
  )) good.constraints[name] = { oid: 1, relation, validated: true, definition };
  assert.deepEqual(cashVoucher.verifyCatalog(343, good, good), good);
  good.constraints.OperatingTakeoverBatch_status_check.definition = "CHECK ('historical_expense' <> 'partially_activated')";
  assert.throws(() => cashVoucher.verifyCatalog(343, good, good), /NATIVE_A24_343_CONSTRAINT/u);
});

test("adds only the three cash witness system-column reads and the cash command grant", () => {
  const previous = {
    read: { RegisteredFundAccount: ["id", "writeRevision"], RegisteredOperationalPayment: ["id"],
      ExpenseClaimPaymentExecution: ["id"], Unrelated: ["id"] },
    insert: { RegisteredOperationalPayment: ["id"], ExpenseClaimPaymentExecution: ["id"] },
    update: { RegisteredFundAccount: ["writeRevision"] }, observer: {}, functions: ["test-command"]
  };
  const expected = {
    ...previous,
    read: { RegisteredFundAccount: ["id", "writeRevision", "xmin"], RegisteredOperationalPayment: ["id", "xmin"],
      ExpenseClaimPaymentExecution: ["id", "xmin"], Unrelated: ["id"] },
    functions: ["test-command", cashVoucher.command]
  };
  assert.deepEqual(cashVoucher.addCashVoucherAcl(previous), expected);
  assert.deepEqual(previous.read.RegisteredFundAccount, ["id", "writeRevision"]);
  const acl = cashVoucher.readAcl("jg_a24_app", "jg_a24_observer");
  for (const table of ["RegisteredFundAccount", "RegisteredOperationalPayment", "ExpenseClaimPaymentExecution"]) {
    assert.ok(acl.includes(`('public."${table}"'::regclass)`));
  }
  assert.match(acl, /NOT has_column_privilege\('jg_a24_app',target.relation,'xmin','SELECT'\)/u);
  assert.match(acl, /'SELECT WITH GRANT OPTION,INSERT,UPDATE,REFERENCES'/u);
  assert.match(acl, /has_column_privilege\('jg_a24_observer',target.relation,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'\)/u);
  assert.match(acl, /a.attnum<0[\s\S]+a.attname<>'xmin'/u);
});
