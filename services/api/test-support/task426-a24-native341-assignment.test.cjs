"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { readExpenseAssignmentLock, verifyExpenseAssignmentLock, routineSha256 } = require("./task426-a24-native341-assignment.cjs");

const migration = readFileSync(path.join(__dirname,
  "../prisma/migrations/20261129010000_expense_standalone_assignment_lock/migration.sql"), "utf8");

test("keeps the elevated trigger on the exact standalone scope and the original trigger on its complement", () => {
  const scope = 'NEW."projectId" IS NOT NULL AND NEW."claimType" IN (\'reimbursement\', \'incidental_expense\') ' +
    'AND NEW."actualPurchaseBatchId" IS NULL AND NEW."generalProcurementId" IS NULL ' +
    'AND NEW."voidedAt" IS NULL AND ( NEW."status" IN (\'approved_pending_payment\', \'partially_paid\', \'paid\') ' +
    'OR (NEW."claimType" = \'reimbursement\' AND NEW."status" = \'offset_completed\') )';
  const normalized = migration.replace(/\s+/gu, " ");
  assert.ok(normalized.includes('WHEN ( ' + scope + ' ) EXECUTE FUNCTION public.jg_lock_standalone_expense_assignment_v1()'));
  assert.ok(normalized.includes('WHEN (NOT ( ' + scope + ' )) EXECUTE FUNCTION public."lockProjectConstructionEnterpriseFromFormalFact"()'));
  const body = migration.split("$lock$")[1];
  assert.equal(createHash("sha256").update(body).digest("hex"), routineSha256);
  assert.match(body, /TG_RELID <> 'public\."ExpenseClaim"'::regclass/u);
  assert.doesNotMatch(body, /approved_pending_disbursement|partially_disbursed|\bdisbursed\b/u);
  assert.match(body, /NEW\."claimType" = 'reimbursement' AND NEW\."status" = 'offset_completed'/u);
  assert.match(body, /COALESCE\(NEW\."approvedAt", NEW\."createdAt"\)::date/u);
  assert.ok(body.indexOf('FROM public."Project"') < body.indexOf('FROM public."ProjectAffiliateAssignment"'));
  assert.ok(body.indexOf('FROM public."ProjectAffiliateAssignment"') < body.indexOf('UPDATE public."Project"'));
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.jg_lock_standalone_expense_assignment_v1\(\) FROM PUBLIC/u);
  assert.doesNotMatch(migration, /\bGRANT\b|CREATE OR REPLACE FUNCTION/u);
});

test("retains Normal archive role denials and rejects altered trigger metadata", () => {
  const sql = readExpenseAssignmentLock("jg_fixture_app_" + "a".repeat(24));
  assert.match(sql, /NOT has_function_privilege.+p\.oid, 'EXECUTE'/u);
  assert.match(sql, /NOT has_any_column_privilege.+"ProjectAffiliateAssignment".+'UPDATE'/u);
  assert.match(sql, /NOT has_column_privilege.+'constructionEnterpriseLockedAt', 'UPDATE'/u);
  assert.throws(() => readExpenseAssignmentLock("unqualified"), /jg_fixture_app/u);
  const row = { safe: true, routineOid: "42", triggers: [
    { name: "ExpenseClaim_lock_construction_enterprise", routine: "lockProjectConstructionEnterpriseFromFormalFact", oid: "43",
      safe: true, predicateSha256: "a".repeat(64) },
    { name: "ExpenseClaim_lock_standalone_assignment", routine: "jg_lock_standalone_expense_assignment_v1", oid: "44",
      safe: true, predicateSha256: "b".repeat(64) }
  ] };
  assert.equal(verifyExpenseAssignmentLock(row), row);
  assert.throws(() => verifyExpenseAssignmentLock({ ...row, safe: false }), /NATIVE_A24_341_ASSIGNMENT_ACL/u);
  assert.throws(() => verifyExpenseAssignmentLock({ ...row, triggers: row.triggers.slice(0, 1) }), /NATIVE_A24_341_ASSIGNMENT_WIRING/u);
  assert.throws(() => verifyExpenseAssignmentLock({ ...row, triggers: row.triggers.map(trigger => ({
    ...trigger, predicateSha256: "a".repeat(64)
  })) }));
});
