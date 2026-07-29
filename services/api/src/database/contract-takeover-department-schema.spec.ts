import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("contract takeover department confirmation schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728130000_contract_takeover_department_confirmation/migration.sql"
  );
  const migration = existsSync(migrationPath)
    ? readFileSync(migrationPath, "utf8")
    : "";
  const model = (name: string) =>
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";

  it("stores independently revised and confirmed contract and finance facts", () => {
    const contractFacts = model("ContractTakeoverContractFacts");
    expect(contractFacts).toMatch(/takeoverId\s+String\s+@id/u);
    expect(contractFacts).toMatch(/revision\s+Int\s+@default\(1\)/u);
    expect(contractFacts).toMatch(/financeBasisRevision\s+Int\s+@default\(1\)/u);
    expect(contractFacts).toMatch(/performanceStatus\s+String/u);
    expect(contractFacts).toMatch(/confirmedRevision\s+Int\?/u);

    const financeFacts = model("ContractTakeoverFinanceFacts");
    expect(financeFacts).toMatch(/takeoverId\s+String\s+@id/u);
    expect(financeFacts).toMatch(/basedOnContractRevision\s+Int/u);
    expect(financeFacts).toMatch(/basedOnFinanceBasisRevision\s+Int/u);
    expect(financeFacts).toMatch(/zeroPaymentDeclared\s+Boolean\s+@default\(false\)/u);
    expect(financeFacts).toMatch(/confirmedFinanceBasisRevision\s+Int\?/u);
  });

  it("stores itemized historical payments, allocations, and exclusive vouchers", () => {
    expect(model("ContractTakeoverHistoricalPayment")).toContain(
      "@@unique([takeoverId, rowKey])"
    );
    expect(model("ContractTakeoverHistoricalPayment")).toContain(
      "@@unique([takeoverId, sequenceNo])"
    );
    expect(model("ContractTakeoverHistoricalPaymentAllocation")).toContain(
      "@@unique([historicalPaymentId, allocationOrder])"
    );
    expect(model("ContractTakeoverHistoricalPaymentVoucher")).toMatch(
      /fileId\s+String\s+@unique/u
    );
    expect(model("ContractTakeoverHistoricalPaymentVoucher")).toContain(
      "@@unique([historicalPaymentId, displayOrder])"
    );
  });

  it("stores evidence as exclusive file bindings instead of json-only identifiers", () => {
    expect(model("ContractTakeoverSettlementEvidence")).toMatch(
      /fileId\s+String\s+@unique/u
    );
    expect(model("ContractTakeoverExcessEvidence")).toMatch(
      /fileId\s+String\s+@unique/u
    );
    expect(migration).toContain(
      "('ContractTakeoverSettlementEvidence','fileId',TRUE)"
    );
    expect(migration).toContain(
      "('ContractTakeoverExcessEvidence','fileId',TRUE)"
    );
    expect(migration).toContain(
      "('ContractTakeoverHistoricalPaymentVoucher','fileId',TRUE)"
    );
  });

  it("keeps expiring save receipts separate from permanent confirmation and balance ledgers", () => {
    const saveRequest = model("ContractTakeoverSideSaveRequest");
    expect(saveRequest).toMatch(/idempotencyKey\s+String\s+@id/u);
    expect(saveRequest).toMatch(/expiresAt\s+DateTime/u);
    expect(saveRequest).toContain("@@index([expiresAt])");

    expect(model("ContractTakeoverConfirmationEvent")).not.toContain("expiresAt");
    expect(model("ContractTakeoverBalanceEntry")).not.toContain("expiresAt");
    expect(model("ContractTakeoverBalanceEntry")).toMatch(
      /reversesEntryId\s+String\?\s+@unique/u
    );
  });

  it("adds activation witnesses and database invariants without rewriting historical data", () => {
    const takeover = model("ContractTakeover");
    expect(takeover).toMatch(/activationIdempotencyKey\s+String\?\s+@unique/u);
    expect(takeover).toMatch(/activatedAt\s+DateTime\?/u);
    expect(takeover).toMatch(/activatedByUserId\s+String\?/u);
    expect(takeover).toMatch(/historicalInitialSettlementId\s+String\?\s+@unique/u);

    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain(
      '"performanceStatus" IN (\'not_started\', \'performing\', \'suspended\', \'completed\', \'terminated\')'
    );
    expect(migration).toContain(
      '"balanceType" IN (\'historical_advance\', \'abnormal_overpay\')'
    );
    expect(migration).toContain(
      '"entryKind" IN (\'opening\', \'deduction\', \'correction\', \'reversal\', \'reclassification\')'
    );
    expect(migration).toMatch(
      /"excessTreatment"\s+IS NULL\s+OR "excessTreatment" IN \('historical_advance', 'abnormal_overpay'\)/u
    );
    expect(migration).toContain("jg_check_contract_takeover_payment_allocation_total");
    expect(migration).toContain("jg_guard_contract_takeover_balance_entry");
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/imu
    );
  });
});
