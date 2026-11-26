"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const path = require("node:path");

const prisma = path.resolve(__dirname, "../prisma");
const read = relative => readFileSync(path.join(prisma, relative), "utf8");
const migration = read("migrations/20261129013000_expense_public_cash_voucher/migration.sql");
const grants = read("general-procurement-runtime-grants.sql");

test("preserves the existing collision trigger and checks the application-only reference shapes before writing", () => {
  const checker = read("migrations/20260907130000_pol260_invoice_ledger_repair/migration.sql");
  const exclusions = [...checker.matchAll(/"tableName" = '([^']+)'\s+AND "columnName" = '([^']+)'/gu)].map(
    ([, relation, column]) => [relation, column]
  );
  assert.deepEqual(exclusions, [
    ["SpotProcurementPaymentArchiveFile", "fileId"],
    ["InvoiceEvidenceRepairResolution", "replacementFileId"]
  ]);
  for (const [relation, column] of exclusions) {
    assert.match(migration, new RegExp(`FROM public\\."${relation}" [a-z]+ WHERE [a-z]+\\."${column}" = p_file`, "u"));
  }
  assert.match(migration, /"ContractSignedChange" change\s+JOIN public\."ContractFormalFile" formal ON formal\.id = change\."appendixFormalFileId"\s+WHERE formal\."fileId" = p_file/u);
  assert.match(migration, /pg_advisory_xact_lock\(190731, 13\)[\s\S]+FOR UPDATE OF file[\s\S]+INSERT INTO public\."ExpenseClaimPaymentExecution"/u);
  assert.match(migration, /binding.tgname = 'jg_efb_expense_claim_payment_execution_voucher'[\s\S]+guard.oid = to_regprocedure\('public.jg_legacy_procurement_expense_voucher_guard_v1\(\)'\)/u);
  assert.doesNotMatch(migration, /(?:ALTER|DROP|REPLACE) TRIGGER|EXCEPTION WHEN/u);
});

test("binds the protected command and private witness to the same transaction and exact cash debit", () => {
  assert.match(migration, /public\.crypt\(p_secret, secret_hash\) IS DISTINCT FROM secret_hash/u);
  assert.match(migration, /custody\."currentCustodianId"[\s\S]+position.key = 'comprehensive_director'[\s\S]+keeper.id = p_actor/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/u);
  assert.match(migration, /payment\."expenseExecutionId" = execution.id/u);
  assert.match(migration, /payment\."previousRegistrationId" = NEW.previous_registration_id/u);
  assert.match(migration, /payment\."actorUserId" = execution\."recordedByUserId"/u);
  assert.match(migration, /payment\."actualPayerCompanyId" IS NULL/u);
  assert.match(migration, /DELETE FROM public\.jg_expense_public_cash_voucher_witness WHERE execution_id = NEW.execution_id/u);
  assert.match(migration, /REVOKE ALL ON TABLE public\.jg_expense_public_cash_voucher_witness FROM PUBLIC/u);
  assert.match(grants, /REVOKE ALL ON TABLE public\.jg_expense_public_cash_voucher_witness FROM %I/u);
  assert.match(grants, /has_function_privilege\(runtime_role, 'public.jg_finish_expense_public_cash_voucher\(\)', 'EXECUTE'\)/u);
  assert.doesNotMatch(grants, /GRANT EXECUTE ON FUNCTION public\.jg_project_owner_settlement_voucher_bound/u);
});
