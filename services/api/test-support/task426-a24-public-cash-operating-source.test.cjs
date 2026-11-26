"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const source = relative => readFileSync(path.resolve(__dirname, "../", relative), "utf8");
const sql = source("prisma/migrations/20261129015000_expense_public_cash_operating_source/migration.sql");
const pin = source("src/contract/contract-generated-upward-operating-installation.ts");
const digest = body => createHash("sha256").update(body).digest("hex");
const clause = name => sql.split("$" + name + "$")[1];

test("uses the registered cash receipt and original paid expense as the only cash ledger source", () => {
  assert.match(sql, /payment\."expenseExecutionId" = execution.id[\s\S]+WHERE execution.id = NEW\."sourceBusinessId"/u);
  assert.match(sql, /payment\."actorUserId" = execution\."recordedByUserId"/u);
  assert.match(sql, /payment\."amountCents" = execution\."amountCents" AND payment\."paidAt" = execution\."paidAt"/u);
  assert.match(sql, /account.kind = 'public_cash' AND account\."scopeKey" = 'public_cash'\s+AND account\."companyEntityId" IS NULL/u);
  assert.match(sql, /NEW\."confirmedAt" = source\."createdAt"/u);
  assert.match(sql, /NEW\."payeeSubjectId" = source.payee_id/u);
  assert.match(sql, /THEN claim\."applicantUserId"[\s\S]+ELSE 'employee:'/u);
  assert.match(sql, /'downstream_counterparty:' \|\| nullif\(btrim\(claim\."payeeNameSnapshot", subject_whitespace\)/u);
  assert.match(sql, /TG_RELID <> 'public\."OperatingFact"'::regclass OR TG_OP <> 'INSERT'/u);
  assert.match(sql, /TG_RELID <> 'public\."OperatingImpactEntry"'::regclass OR TG_OP <> 'INSERT'/u);
  assert.match(sql, /acl.grantee <> owner_oid[\s\S]+REVOKE ALL ON FUNCTION %s FROM %s/u);
  assert.match(sql, /NEW\."sourceSnapshot"->'registeredFunding' = jsonb_build_object/u);
  assert.match(sql, /NEW\."factKind" = 'downstream_payment' AND NEW\."operatingLevel" = 'project'/u);
  assert.match(sql, /NEW\."impactKind" = 'public_cash_funds_decrease'[\s\S]+NEW\."impactKind" = 'payable_decrease'/u);
  assert.doesNotMatch(sql, /confirmed_cost|GRANT EXECUTE|DROP TRIGGER/u);
});

test("derives scope-limited Task16 successors from the authoritative existing exact guard bodies", () => {
  const { functionProofs } = JSON.parse(source("prisma/task16-registered-access.json"));
  const signatures = {
    fact: "public.jg_registered_payment_fact_guard()",
    impact: "public.jg_registered_payment_cash_impact_guard()"
  };
  for (const [kind, signature] of Object.entries(signatures)) {
    const old = functionProofs.find(value => value.signature === signature);
    const from = clause("adapter_" + kind + "_old");
    const to = clause("adapter_" + kind + "_new");
    assert.equal(old.body.split(from).length, 2);
    assert.equal(old.bodySha256, digest(old.body));
    assert.ok(sql.includes(old.bodySha256));
    assert.ok(sql.includes(digest(old.body.replace(from, () => to))));
    assert.match(to, /NEW\."sourceType" <> 'expense_claim_payment_execution'/u);
  }
  assert.match(sql, /\(to_jsonb\(p\)-'prosrc'\) = current_metadata AND to_jsonb\(t\) = trigger_before/u);
});

test("recognizes ordinary and direct-clock successors without dropping historical pins", () => {
  for (const [locale, fact, impact] of [
    ["FALSE", "1235c355fa2777269b1920f9922401a357a725039f14e3321e00b5a3d338c973", "f9cc8b1db6c0fe72b0ee7d38e2193fb2a446e88f6da133e726b47424663f4250"],
    ["TRUE", "92f6f3e2e3e0f58bca1d00b5c631c0dd652b5552992dda991da3564429dc4644", "2db9ce648393690e5b1cf1e008b1a2df86b776d47240bca28fd04fe50f93ccc7"]
  ]) {
    assert.ok(pin.includes(`(${locale},'${fact}',\n          '${impact}')`));
    assert.ok(sql.includes(fact) && sql.includes(impact));
  }
  assert.match(pin, /26a0fe0d[\s\S]+a9f2052a[\s\S]+bcc05db1[\s\S]+61ea7834/u);
  assert.match(clause("fact_new"), /candidate_subject->>'role' = 'actualPayer'/u);
  assert.match(clause("impact_new"), /NEW\."subjectRole" = 'actual_payer'/u);
});
