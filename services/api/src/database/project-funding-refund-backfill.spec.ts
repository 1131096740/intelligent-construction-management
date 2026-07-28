import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260728122000_project_funding_refund_backfill/migration.sql"
);

describe("project funding supplier refund backfill", () => {
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("maps historical refunds only to active spot-payment executions", () => {
    expect(migration).toContain('FROM "SpotProcurementRefund"');
    expect(migration).toContain('JOIN "SpotProcurementDiscrepancy"');
    expect(migration).toContain('JOIN "SpotProcurementPaymentExecution"');
    expect(migration).toContain('execution."voidedAt" IS NULL');
    expect(migration).toMatch(
      /execution\."paidAt" DESC,\s*execution\."id" DESC/u
    );
  });

  it("restores original sources through append-only partial credits", () => {
    expect(migration).toContain(
      'JOIN "ProjectFundingAllocation" debit'
    );
    expect(migration).toContain(
      "debit.\"direction\" = 'debit'"
    );
    expect(migration).toContain(
      "debit.\"reversalKey\" = 'original'"
    );
    expect(migration).toContain(
      "'spot-refund:' || refund_row.\"refundId\""
    );
    expect(migration).toContain('"reversalOfAllocationId"');
    expect(migration).toContain("'credit'");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).not.toMatch(
      /\b(?:UPDATE|DELETE\s+FROM)\s+"(?:SpotProcurementRefund|SpotProcurementPaymentExecution|ProjectFundingAllocation)"/u
    );
  });

  it("fails closed when a refund cannot be fully reconciled", () => {
    expect(migration).toContain(
      "历史供应商退款超过可反向的实际付款资金"
    );
    expect(migration).toContain(
      "历史供应商退款资金反向分配总额不一致"
    );
  });
});
