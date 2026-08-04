import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/20260728139000_payment_execution_idempotency/migration.sql"
);
const schemaPath = join(process.cwd(), "prisma/schema.prisma");

describe("payment execution idempotency schema", () => {
  it("stores a unique business command key, exclusive voucher, and payer snapshots", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const paymentExecution = schema.match(
      /model PaymentExecution \{([\s\S]*?)^\}/mu
    )?.[1];

    expect(paymentExecution).toBeDefined();
    expect(paymentExecution).toMatch(/idempotencyKey\s+String\s+@unique/u);
    expect(paymentExecution).toMatch(/voucherFileId\s+String\s+@unique/u);
    expect(paymentExecution).toMatch(/companyEntityIdSnapshot\s+String\s/u);
    expect(paymentExecution).toMatch(/companyEntityNameSnapshot\s+String\s/u);
    expect(paymentExecution).toMatch(
      /companyEntityCreditCodeSnapshot\s+String\s/u
    );
  });

  it("fails closed on historical voucher conflicts before adding unique indexes", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("UNION\n      SELECT 'FileObject'");
    expect(migration).toContain("payment_execution_duplicate_voucher");
    expect(migration).toContain("payment_execution_cross_business_voucher");
    expect(migration).toContain(
      "payment_execution_voucher_owner_or_status_mismatch"
    );
    expect(migration).toMatch(
      /"storageStatus"[\s\S]*'active'[\s\S]*"uploadedByUserId"[\s\S]*"executedByUserId"/u
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "PaymentExecution_idempotencyKey_key"'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "PaymentExecution_voucherFileId_key"'
    );
    expect(migration).not.toMatch(
      /DELETE\s+FROM\s+"PaymentExecution"|DROP\s+TABLE/iu
    );
    expect(migration).toContain(
      "payment_execution_incomplete_payer_snapshot"
    );
    expect(migration).toContain(
      "payment_execution_payer_lineage_mismatch"
    );
    expect(migration).toContain(
      "payment_execution_active_request_payer_snapshot_incomplete"
    );
    expect(migration).toContain(
      "payment_execution_payment_paid_amount_mismatch"
    );
    expect(migration).toContain(
      "payment_execution_settlement_paid_amount_mismatch"
    );
    expect(migration).toContain(
      "payment_execution_settlement_owner_mismatch"
    );
    expect(migration).toContain(
      "payment_execution_payment_status_amount_mismatch"
    );
    expect(migration).toContain(
      "payment_execution_settlement_status_amount_mismatch"
    );
    expect(migration).toMatch(
      /SUM\("amountCents"\)[\s\S]*"paidAmountCents"/u
    );
    expect(migration).toMatch(
      /FROM "Settlement" settlement[\s\S]*"sourceType" IS DISTINCT FROM 'historical_takeover'[\s\S]*execution_total\."executedAmountCents"/u
    );
    for (const column of [
      "companyEntityIdSnapshot",
      "companyEntityNameSnapshot",
      "companyEntityCreditCodeSnapshot"
    ]) {
      expect(migration).toContain(
        `ALTER COLUMN "${column}" SET NOT NULL`
      );
    }
    expect(migration).toContain(
      `ADD CONSTRAINT "PaymentExecution_company_payer_snapshot_check"`
    );
    expect(migration).toContain(
      `ADD CONSTRAINT "PaymentExecution_idempotency_key_format_check"`
    );
    expect(migration).toContain(
      `CREATE FUNCTION guard_payment_execution_immutable()`
    );
    expect(migration).toContain(
      `CREATE TRIGGER "PaymentExecution_immutable"`
    );
    expect(migration).toContain(
      "payment_execution_immutable_update"
    );
    expect(migration).toContain(
      "payment_execution_immutable_delete"
    );
  });

  it("upgrades PaymentExecution voucher binding to globally exclusive", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "jg_file_business_binding_columns_before_payment_execution"
    );
    expect(migration).toContain(
      `WHEN "tableName" = 'PaymentExecution' AND "columnName" = 'voucherFileId' THEN TRUE`
    );
    expect(migration).toContain(
      `jg_enforce_exclusive_file_business_binding('voucherFileId', 'true')`
    );
  });

  it("fails closed unless retained executions have exact funding and legacy-compatible audit evidence", () => {
    const migration = readFileSync(migrationPath, "utf8");

    for (const marker of [
      "payment_execution_funding_allocation_missing",
      "payment_execution_funding_allocation_mismatch",
      "payment_execution_audit_missing",
      "payment_execution_audit_mismatch"
    ]) {
      expect(migration).toContain(marker);
    }
    expect(migration).toMatch(
      /FROM "PaymentExecution" execution[\s\S]*FROM "ProjectFundingAllocation" allocation[\s\S]*"executionType" = 'payment_execution'[\s\S]*"direction" = 'debit'[\s\S]*"reversalKey" = 'original'/u
    );
    for (const fact of [
      'SUM(allocation."amountCents")',
      'allocation."projectId"',
      'payment."projectId"',
      'allocation."businessType"',
      'allocation."businessId"',
      'allocation."occurredAt"',
      'execution."paidAt"',
      'allocation."createdByUserId"',
      'execution."executedByUserId"'
    ]) {
      expect(migration).toContain(fact);
    }
    expect(migration).toMatch(
      /FROM "AuditLog" audit[\s\S]*audit\."action" = 'payment\.execution\.record'[\s\S]*audit\."businessType" = 'payment_request'[\s\S]*audit\."metadata"->>'executionId'[\s\S]*audit\."metadata"->>'amountCents'[\s\S]*audit\."metadata"->>'voucherFileId'/u
    );
    expect(migration).not.toMatch(
      /audit\."metadata"->>'(?:paidAt|idempotencyKey|funding)'/u
    );
  });

  it("rejects retained executions owned by non-payable request or settlement statuses", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "payment_execution_payment_owner_status_mismatch"
    );
    expect(migration).toContain(
      "payment_execution_settlement_owner_status_mismatch"
    );
    expect(migration).toMatch(
      /FROM "PaymentExecution" execution[\s\S]*JOIN "PaymentRequest" payment[\s\S]*payment\."status" NOT IN \('partially_paid', 'paid'\)/u
    );
    expect(migration).toMatch(
      /JOIN "Settlement" settlement[\s\S]*settlement\."status" NOT IN \('partially_paid', 'paid'\)/u
    );
    expect(migration).toMatch(
      /"status" NOT IN \([\s\S]*'approved_pending_payment',[\s\S]*'partially_paid',[\s\S]*'paid'[\s\S]*\)[\s\S]*AND "paidAmountCents" = 0/u
    );
    expect(migration).toMatch(
      /"status" NOT IN \('effective', 'partially_paid', 'paid'\)[\s\S]*AND "paidAmountCents" = 0/u
    );
  });

  it("does not exempt a historical takeover settlement once an execution owns it", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const ownerStatusGuard = migration.match(
      /IF EXISTS \(\s*SELECT 1\s*FROM "PaymentExecution" execution\s*JOIN "Settlement" settlement[\s\S]*?RAISE EXCEPTION 'payment_execution_settlement_owner_status_mismatch'/u
    )?.[0];

    expect(ownerStatusGuard).toBeDefined();
    expect(ownerStatusGuard).not.toContain("sourceType");
    expect(migration).toMatch(
      /ADD CONSTRAINT "Settlement_payment_status_amount_check"[\s\S]*"sourceType" = 'historical_takeover'/u
    );
  });

  it("validates existing payment execution and touched amount constraints", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const constraints = [
      "PaymentExecution_request_fk",
      "PaymentExecution_settlement_fk",
      "PaymentExecution_voucher_file_fk",
      "PaymentExecution_amount_positive_check",
      "PaymentRequest_payment_status_amount_check",
      "PaymentRequest_paid_nonnegative_check",
      "PaymentRequest_paid_lte_approved_check",
      "Settlement_payment_status_amount_check",
      "Settlement_paid_nonnegative_check",
      "Settlement_paid_lte_payable_check"
    ];

    for (const constraint of constraints) {
      expect(migration).toContain(`VALIDATE CONSTRAINT "${constraint}"`);
    }
  });
});
