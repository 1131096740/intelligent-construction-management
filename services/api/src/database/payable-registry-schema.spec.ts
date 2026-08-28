import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(__dirname, "../../prisma/migrations/20260827300000_pol13a_payable_registry_settlement/migration.sql"),
  "utf8"
);
const bindingMigration = readFileSync(
  resolve(__dirname, "../../prisma/migrations/20260828010000_pol13a_payment_execution_wage_binding/migration.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");

describe("POL-13A payable registry schema", () => {
  it("reuses PaymentExecution and does not introduce a second payment fact", () => {
    expect(schema).toContain("model PayableSettlementCase");
    expect(schema).toContain("paymentExecution PaymentExecution");
    expect(migration).toContain('FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")');
    expect(migration).not.toMatch(/CREATE TABLE "(?:BankPaymentFact|PayablePaymentExecution)"/u);
  });

  it("persists revisioned cases, immutable source snapshots, and idempotency receipts", () => {
    for (const marker of [
      'CREATE TABLE "PayableSettlementCase"',
      'CREATE TABLE "PayableSettlementAllocation"',
      'CREATE TABLE "PayableSettlementCommandReceipt"',
      "PayableSettlementCase_execution_revision_key",
      "PayableSettlementAllocation_case_payable_ref_key",
      "PayableSettlementCommandReceipt_idempotencyKey_key",
      "PayableSettlementCase_status_check",
      "PayableSettlementCase_revision_check",
      '"sourceSnapshot" JSONB NOT NULL'
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it("keeps confirmed amount and allocation amount strictly positive in CNY", () => {
    expect(migration).toContain("PayableSettlementAllocation_amount_check");
    expect(migration).toContain("PayableSettlementAllocation_confirmed_amount_check");
    expect(migration).toContain("PayableSettlementAllocation_currency_check");
  });

  it("makes confirmed cases and their frozen allocations append-only at the database boundary", () => {
    expect(migration).toContain('CREATE FUNCTION guard_confirmed_payable_settlement_case()');
    expect(migration).toContain('CREATE FUNCTION guard_confirmed_payable_settlement_allocation()');
    expect(migration).toContain('CREATE TRIGGER "PayableSettlementCase_confirmed_immutable"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "PayableSettlementCase"');
    expect(migration).toContain('CREATE TRIGGER "PayableSettlementAllocation_confirmed_immutable"');
    expect(migration).toContain("IF case_status <> 'draft' THEN");
    expect(migration).toContain("IF OLD.\"status\" IN ('confirmed', 'review_returned') THEN");
    expect(migration).toContain("IF TG_OP = 'INSERT' THEN");
    expect(migration).toContain('NEW."status" := \'draft\';');
    expect(migration).toContain("payable_settlement_submitted_audit_immutable");
    expect(migration).toContain("payable_settlement_state_audit_invalid");
  });

  it("keeps every generic allocation bound to the existing execution owned by its case", () => {
    expect(schema).toMatch(/payableSettlementAllocations\s+PayableSettlementAllocation\[\]/u);
    expect(schema).toMatch(/paymentExecution\s+PaymentExecution\s+@relation/u);
    expect(migration).toContain("PayableSettlementAllocation_payment_execution_fkey");
    expect(migration).toContain('case_payment_execution_id <> NEW."paymentExecutionId"');
  });

  it("freezes the wage creditor subject and payment bridge without creating a second payment fact", () => {
    for (const marker of [
      'CREATE TABLE "PaymentExecutionWagePayableBinding"',
      'PaymentExecutionWagePayableBinding_execution_ref_key',
      'PaymentExecutionWagePayableBinding_subject_union_check',
      'PaymentExecutionWagePayableBinding_version_fingerprint_check',
      "'employee_user'",
      "'business_party'",
      'FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")',
      'FOREIGN KEY ("wagePayableRefId") REFERENCES "WagePayableRef"("id")',
      'CREATE FUNCTION guard_payment_execution_wage_payable_binding_immutable()',
      'BEFORE INSERT OR UPDATE OR DELETE ON "PaymentExecutionWagePayableBinding"'
    ]) {
      expect(bindingMigration).toContain(marker);
    }
    expect(bindingMigration).not.toContain('NEW.status');
  });
});
