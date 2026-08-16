import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("POL-08 construction enterprise operating source migration", () => {
  it("stores the concrete company and approved payment request links", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../prisma/migrations/20260815180000_pol08_construction_enterprise_operating_sources/migration.sql"
      ),
      "utf8"
    );

    expect(sql).toContain('ADD COLUMN "companyEntityId" TEXT');
    expect(sql).toContain('ADD COLUMN "paymentRequestId" TEXT');
    expect(sql).toContain('"ProjectUpstreamFundFact_companyEntityId_idx"');
    expect(sql).toContain('"ProjectAffiliatePaymentFact_paymentRequestId_idx"');
  });

  it("stores the remittance contract, settlement, and invoice lineage", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../prisma/migrations/20260815190000_pol08_remittance_lineage/migration.sql"
      ),
      "utf8"
    );

    expect(sql).toContain('ADD COLUMN "affiliateCompanyContractId" TEXT');
    expect(sql).toContain('ADD COLUMN "affiliateSettlementFactId" TEXT');
    expect(sql).toContain('ADD COLUMN "invoiceRecordId" TEXT');
    expect(sql).toContain('"ProjectUpstreamFundFact_affiliateCompanyContractId_idx"');
    expect(sql).toContain('"ProjectUpstreamFundFact_affiliateSettlementFactId_idx"');
    expect(sql).toContain('"ProjectUpstreamFundFact_invoiceRecordId_idx"');
  });
});
