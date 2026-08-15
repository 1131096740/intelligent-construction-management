import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  __dirname,
  "../../prisma/migrations/20260815150000_pol06_expense_employee_subjects/migration.sql"
);

describe("POL-06 employee operating subject migration", () => {
  it("adds employee only to debtor, actual payer, and payee roles", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain('"debtorSubjectKind" IN (\'owner\', \'construction_enterprise\', \'participating_company\', \'employee\')');
    expect(sql).toContain('"actualPayerSubjectKind" IN (\'owner\', \'construction_enterprise\', \'participating_company\', \'employee\')');
    expect(sql).toContain('"payeeSubjectKind" IN (\'owner\', \'construction_enterprise\', \'participating_company\', \'downstream_counterparty\', \'employee\')');
    expect(sql).toContain("WHEN 'debtor' THEN \"subjectKind\" IN ('owner', 'construction_enterprise', 'participating_company', 'employee')");
    expect(sql).toContain("WHEN 'actual_payer' THEN \"subjectKind\" IN ('owner', 'construction_enterprise', 'participating_company', 'employee')");
    expect(sql).toContain("WHEN 'creditor' THEN \"subjectKind\" IN ('construction_enterprise', 'participating_company', 'downstream_counterparty')");
    expect(sql).toContain("WHEN 'cost_bearing_company' THEN \"subjectKind\" IN ('construction_enterprise', 'participating_company')");
    expect(sql).toContain("POL-06 未找到 POL-05 经营事实主体基线，拒绝漂移升级");
    expect(sql).toContain("POL-06 未找到 POL-05 经营影响主体基线，拒绝漂移升级");
  });
});
