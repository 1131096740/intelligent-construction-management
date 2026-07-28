import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260728121000_project_funding_allocation_backfill/migration.sql"
);

describe("project funding allocation historical backfill", () => {
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";

  it("covers all five historical execution sources without mutating them", () => {
    expect(migration).toContain('FROM "PaymentExecution"');
    expect(migration).toContain('FROM "ProjectExpenseExecution"');
    expect(migration).toContain('FROM "SpotProcurementPaymentExecution"');
    expect(migration).toContain('FROM "ExpenseClaimPaymentExecution"');
    expect(migration).toContain('FROM "EmployeeProjectLoanEntry"');
    expect(migration).not.toMatch(
      /\b(?:UPDATE|DELETE\s+FROM)\s+"(?:PaymentExecution|ProjectExpenseExecution|SpotProcurementPaymentExecution|ExpenseClaimPaymentExecution|EmployeeProjectLoanEntry)"/u
    );
  });

  it("maps only used legacy quota facts and preserves cash-first ordering", () => {
    expect(migration).toContain(
      'FROM "ProjectFinancingQuotaUsage"'
    );
    expect(migration).toContain(
      'FROM "ProjectExpenseFinancingQuotaUsage"'
    );
    expect(migration).toMatch(
      /WHERE\s+"status"\s*=\s*'used'/u
    );
    expect(migration).toMatch(
      /totals\."executionTotalCents"\s*-\s*ranked\."usedTotalCents"/u
    );
    expect(migration).toContain(
      'LEAST(e."endCents", u."endCents")'
    );
    expect(migration).toMatch(
      /WITH usage_totals AS \([\s\S]*?GROUP BY "businessType", "businessId"[\s\S]*?execution_totals AS \(/u
    );
    expect(migration).toMatch(
      /allocation_totals AS \([\s\S]*?GROUP BY "businessType", "businessId", "sourceId"/u
    );
    expect(migration).toMatch(
      /raw_funding_overlaps AS \([\s\S]*?funding_overlaps AS \([\s\S]*?SUM\("amountCents"\) AS "amountCents"[\s\S]*?GROUP BY[\s\S]*?"quotaId"/u
    );
  });

  it("fails closed on unmappable facts and is safe to re-run", () => {
    expect(migration).toContain(
      "历史报销补付缺少项目，无法建立统一资金分配"
    );
    expect(migration).toContain(
      "历史垫资已用金额超过对应实际付款金额"
    );
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1\s*FROM "ProjectFundingAllocation"/u
    );
  });

  it("represents historical spot-payment voids as append-only credits", () => {
    expect(migration).toContain(
      "'historical-void:' || e.\"executionId\""
    );
    expect(migration).toContain("'credit'");
    expect(migration).toContain('"reversalOfAllocationId"');
  });
});
