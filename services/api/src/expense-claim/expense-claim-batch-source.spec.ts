import {
  assertEmployeeAdvanceBatchSource,
  employeeAdvanceSourceCategory,
  type ActualPurchaseBatchSourceFacts
} from "./expense-claim-batch-source";

const spotBatch: ActualPurchaseBatchSourceFacts = {
  id: "batch-1",
  kind: "spot_material",
  procurementId: "spot-1",
  projectId: "project-1",
  companyEntityId: "company-1",
  status: "recorded",
  supplierName: "合成五金供应商"
};

const generalBatch: ActualPurchaseBatchSourceFacts = {
  ...spotBatch,
  id: "batch-2",
  kind: "general",
  procurementId: "general-1",
  projectId: null,
  companyEntityId: "company-1"
};

const baseRequest = {
  claimType: "reimbursement" as const,
  actualPurchaseBatchId: "batch-1",
  projectId: "project-1",
  companyEntityId: "company-1",
  applicantUserId: "employee-1",
  actorUserId: "employee-1"
};

/**
 * #404 PUR-12 / EXP-06：员工从原采购单垫付报销。
 * 公司直付 600 + 员工垫 400 的 1000 采购，员工只报 400；成本仍只由采购批次
 * 确认一次，所以本决定只负责来源身份与类别沿用，不产生第二笔成本。
 */
describe("employee advance batch source", () => {
  it("accepts a spot material batch and carries the 零星材料 category", () => {
    expect(assertEmployeeAdvanceBatchSource(baseRequest, spotBatch)).toBe("零星材料");
  });

  it("accepts a company-daily general batch without a project and uses the procurement category", () => {
    const result = assertEmployeeAdvanceBatchSource(
      { ...baseRequest, projectId: undefined },
      generalBatch,
      "办公用品"
    );
    expect(result).toBe("办公用品");
  });

  it("rejects a non-reimbursement claim type", () => {
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, claimType: "incidental_expense" }, spotBatch)
    ).toThrow("垫付报销只办理费用报销");
  });

  it("rejects credentials that would duplicate the comprehensive procurement payment path", () => {
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, generalProcurementId: "general-1" }, generalBatch, "办公用品")
    ).toThrow("不再填写综合采购申请");
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, generalProcurementRequestKey: "request-key" }, spotBatch)
    ).toThrow("不再填写综合采购申请");
  });

  it("only lets the advancing employee claim for themselves", () => {
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, applicantUserId: "employee-2" }, spotBatch)
    ).toThrow("垫付人本人");
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, applicantUserId: undefined }, spotBatch)
    ).toThrow("垫付人本人");
  });

  it("keeps one project and one cost source", () => {
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, projectId: "project-2" }, spotBatch)
    ).toThrow("项目必须与实际采购批次一致");
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, companyEntityId: "company-2" }, spotBatch)
    ).toThrow("费用承担公司必须与实际采购批次一致");
  });

  it("rejects voided or unknown batch kinds", () => {
    expect(() =>
      assertEmployeeAdvanceBatchSource(baseRequest, { ...spotBatch, status: "voided" })
    ).toThrow("已作废");
    expect(() =>
      assertEmployeeAdvanceBatchSource(baseRequest, { ...spotBatch, kind: "unknown" })
    ).toThrow("不支持从该采购批次垫付报销");
    expect(() =>
      assertEmployeeAdvanceBatchSource({ ...baseRequest, projectId: undefined }, generalBatch, null)
    ).toThrow("原综合采购类别");
  });

  it("derives only the two documented source categories", () => {
    expect(employeeAdvanceSourceCategory(spotBatch, "办公用品")).toBe("零星材料");
    expect(employeeAdvanceSourceCategory(generalBatch, "办公用品")).toBe("办公用品");
  });
});
