import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  __dirname,
  "../../prisma/migrations/20260814010000_project_operating_profile/migration.sql"
);

describe("project operating profile migration", () => {
  it("locks the construction enterprise from every existing formal contract, settlement, and fund seam", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of [
      "ContractVersion",
      "Settlement",
      "ProjectUpstreamFundFact",
      "ProjectAffiliateContractFact",
      "ProjectAffiliateSettlementFact",
      "ProjectAffiliatePaymentFact",
      "ProjectAffiliateCompanyContract",
      "ProjectUpstreamSettlement",
      "ProjectOwnerContract",
      "ProjectProxyPayment",
      "ProjectReceipt",
      "ProjectExpenseExecution",
      "PaymentExecutionAllocation",
      "ExpenseClaim",
      "SpotProcurementPayment"
    ]) {
      expect(sql).toContain(`ON "${table}"`);
    }
    expect(sql).toContain('"constructionEnterpriseLockedAt"');
    expect(sql).toContain("ProjectParticipatingCompany_one_active_per_project_company");
    expect(sql).toContain("Project_takeover_status_check");
    expect(sql).toContain("正式经营事实发生前必须先设置唯一施工企业");
    expect(sql).toContain("requireActiveProjectParticipatingCompany");
    expect(sql).toContain("该公司未在本项目参与公司名单中，或已停止新增业务");
    expect(sql).toContain("activateProjectOperatingLedger");
    expect(sql).toContain("approved_pending_payment");
    expect(sql).not.toContain("status\" NOT IN ('draft', 'rejected')");
    expect(sql).toContain('"effectiveFrom" <= candidate_fact_date');
    expect(sql).toContain("施工企业生效日不得晚于项目已有正式经营事实日期");
    expect(sql).toContain("项目已有正式经营事实引用的公司未覆盖对应参与期间");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "protectProjectParticipatingCompanyEndDate"');
    expect(sql).toContain("停止日期当日或之后已有正式经营事实，不能截断参与期间");
    expect(sql).toContain('IS DISTINCT FROM OLD."operatingLedgerEffectiveDate"');

    const activation = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "activateProjectOperatingLedger"'),
      sql.indexOf('CREATE TRIGGER "Project_activate_operating_ledger"')
    );
    for (const table of [
      "ProjectUpstreamFundFact",
      "ProjectAffiliateContractFact",
      "ProjectAffiliateSettlementFact",
      "ProjectAffiliatePaymentFact",
      "ProjectAffiliateCompanyContract",
      "ProjectUpstreamSettlement",
      "ProjectOwnerContract",
      "ProjectProxyPayment"
    ]) {
      expect(activation).toContain(`"${table}"`);
    }
    expect(activation).toContain('receipt."receivedAt"');
    expect(activation).not.toContain('receipt."createdAt"');
  });
});
