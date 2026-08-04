import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-payment-execution-concurrency-local.cjs"
);
const concurrencySpecPath = resolve(
  __dirname,
  "payment-execution-concurrency.spec.ts"
);

describe("payment execution PostgreSQL concurrency runner", () => {
  it("pins a dedicated local PostgreSQL database and the complete migration set", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      EXPECTED_MIGRATION_COUNT: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
      assertLocalDockerEndpoint: (endpoint: string) => void;
    };

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_payment_execution_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      readdirSync(resolve(prismaRoot, "migrations"), {
        withFileTypes: true
      }).filter((entry) => entry.isDirectory()).length
    );
    expect(() =>
      runner.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/jiangkong_payment_execution_concurrency"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_payment_execution_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_payment_execution_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
    expect(() => runner.assertLocalDockerEndpoint("unix:///var/run/docker.sock"))
      .not.toThrow();
    expect(() =>
      runner.assertLocalDockerEndpoint("tcp://prod.example.com:2376")
    ).toThrow();
  });

  it("defines all four real-service PostgreSQL invariants", () => {
    const concurrencySpec = readFileSync(concurrencySpecPath, "utf8");

    for (const required of [
      "PaymentRequestService",
      "PaymentAmountService",
      "AuditService",
      "FileService",
      "ProjectFundingAvailabilityService",
      "assertFullyMigrated",
      "assertPaymentExecutionSchema",
      "PaymentExecution_idempotencyKey_key",
      "PaymentExecution_voucherFileId_key",
      "PaymentExecution_request_fk",
      "PaymentExecution_settlement_fk",
      "PaymentExecution_voucher_file_fk",
      "PaymentExecution_amount_positive_check",
      "PaymentExecution_company_payer_snapshot_check",
      "PaymentExecution_idempotency_key_format_check",
      "PaymentRequest_payment_status_amount_check",
      "PaymentRequest_paid_nonnegative_check",
      "PaymentRequest_paid_lte_approved_check",
      "Settlement_payment_status_amount_check",
      "Settlement_paid_nonnegative_check",
      "Settlement_paid_lte_payable_check",
      "verifyRemainingCompetition",
      "verifyIdempotentReplay",
      "verifyCrossProjectVoucherUniqueness",
      "verifyFundingShortageZeroWrite",
      "assertPaymentExecutionImmutable",
      "pg_backend_pid()",
      "pg_blocking_pids",
      "getStatus() === 409",
      "paymentExecution.count",
      "projectFundingAllocation.count",
      "action: \"payment.execution.record\""
    ]) {
      expect(concurrencySpec).toContain(required);
    }
  });

  it("uses PostgreSQL 16, full migrations and guaranteed cleanup", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const concurrencySpec = readFileSync(concurrencySpecPath, "utf8");

    expect(runner).toContain('"postgres:16"');
    expect(runner).toMatch(/"migrate",\s*"deploy"/u);
    expect(runner).toMatch(/"migrate",\s*"status"/u);
    expect(runner).toMatch(/"db",\s*"seed"/u);
    expect(runner).toContain("assertSeedPaymentExecutionClosedLoop");
    expect(runner.match(/await runCoreSeed\(/gu)).toHaveLength(2);
    expect(runner.match(/await assertSeedPaymentExecutionClosedLoop\(/gu))
      .toHaveLength(2);
    expect(runner).toContain(
      'RUN_PAYMENT_EXECUTION_CONCURRENCY: "1"'
    );
    expect(runner).toContain(
      "src/database/payment-execution-concurrency.spec.ts"
    );
    expect(runner).toContain("assertLocalDockerEndpoint");
    expect(runner).toContain("removeContainer");
    expect(runner).toContain("removeTemporaryRoot");
    expect(runner).toContain("process.env.PNPM_BIN");
    expect(runner).not.toContain("/Users/leoyang/.local/bin/pnpm");
    expect(concurrencySpec).toContain("const releaseGates");
    expect(concurrencySpec).toContain(
      "for (const gate of releaseGates) gate.resolve(undefined)"
    );
    expect(concurrencySpec).toContain(
      "await Promise.allSettled(pendingOperations)"
    );
  });

  it("rehearses valid and rejected retained facts before applying migration 139000", () => {
    const runner = readFileSync(runnerPath, "utf8");

    for (const required of [
      "verifyRetainedMigration",
      "pre139MigrationRoot",
      "payment_execution_payment_paid_amount_mismatch",
      "payment_execution_settlement_paid_amount_mismatch",
      "payment_execution_incomplete_payer_snapshot",
      "payment_execution_payer_lineage_mismatch",
      "payment_execution_voucher_owner_or_status_mismatch",
      "legacy:payment_execution:",
      "uploadedByUserId",
      "executedByUserId",
      "voucherOwnerOrStatusMismatch",
      "settlementPaidMismatch",
      "payerLineageMismatch",
      "paymentApprovalPendingStatus",
      "settlementApprovalPendingStatus",
      "historicalTakeoverLinkedInvalidStatus",
      "fundingAllocationMissing",
      "fundingAllocationMismatch",
      "auditMissing",
      "auditMismatch",
      "payment_execution_funding_allocation_missing",
      "payment_execution_funding_allocation_mismatch",
      "payment_execution_audit_missing",
      "payment_execution_audit_mismatch",
      "payment_execution_payment_owner_status_mismatch",
      "payment_execution_settlement_owner_status_mismatch",
      'INSERT INTO "ProjectFundingAllocation"',
      'INSERT INTO "AuditLog"',
      "historical_takeover",
      "assertMigrationRolledBack"
    ]) {
      expect(runner).toContain(required);
    }
  });
});
