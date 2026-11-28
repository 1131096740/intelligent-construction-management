import { BadRequestException, ConflictException } from "@nestjs/common";

/**
 * #404 PUR-12：员工从原采购单垫付报销。
 *
 * 两类实际采购批次都可作为来源：零星材料批次沿用「零星材料」，综合采购批次
 * 沿用原采购类别。这里只做来源身份与类别沿用的纯校验；金额容量、成本只确认
 * 一次和退款恢复容量由批次服务与事务保证。
 */
export interface ActualPurchaseBatchSourceFacts {
  id: string;
  kind: string;
  procurementId: string;
  projectId: string | null;
  companyEntityId: string | null;
  status: string;
  supplierName: string;
}

export interface EmployeeAdvanceBatchRequest {
  claimType: string;
  generalProcurementId?: string;
  generalProcurementRequestKey?: string;
  actualPurchaseBatchId?: string;
  projectId?: string;
  companyEntityId: string;
  applicantUserId?: string;
  actorUserId: string;
}

const CLAIMABLE_BATCH_STATUSES = new Set(["recorded", "cost_confirmed"]);

export function employeeAdvanceSourceCategory(
  batch: Pick<ActualPurchaseBatchSourceFacts, "kind">,
  generalProcurementCategoryLabel?: string | null
): string {
  if (batch.kind === "spot_material") return "零星材料";
  if (batch.kind === "general") {
    const label = (generalProcurementCategoryLabel ?? "").trim();
    if (!label) throw new BadRequestException("请先核对原综合采购类别，再发起垫付报销");
    return label;
  }
  throw new BadRequestException("不支持从该采购批次垫付报销");
}

/** 校验并返回本次垫付报销沿用的原采购类别。 */
export function assertEmployeeAdvanceBatchSource(
  input: EmployeeAdvanceBatchRequest,
  batch: ActualPurchaseBatchSourceFacts,
  generalProcurementCategoryLabel?: string | null
): string {
  if (!input.actualPurchaseBatchId) {
    throw new BadRequestException("请选择实际采购批次");
  }
  if (input.claimType !== "reimbursement") {
    throw new BadRequestException("原采购批次垫付报销只办理费用报销");
  }
  if (input.generalProcurementId || input.generalProcurementRequestKey) {
    throw new BadRequestException("原采购批次垫付报销请直接关联实际采购批次，不再填写综合采购申请");
  }
  if (!input.applicantUserId || input.applicantUserId !== input.actorUserId) {
    throw new BadRequestException("原采购批次垫付报销只能由垫付人本人发起");
  }
  if (batch.status === "voided") {
    throw new ConflictException("实际采购批次已作废，不能发起垫付报销");
  }
  if (!CLAIMABLE_BATCH_STATUSES.has(batch.status)) {
    throw new ConflictException("实际采购批次当前状态不能发起垫付报销，请刷新后核对");
  }
  if ((input.projectId ?? null) !== (batch.projectId ?? null)) {
    throw new BadRequestException("垫付报销项目必须与实际采购批次一致");
  }
  if (batch.companyEntityId && input.companyEntityId !== batch.companyEntityId) {
    throw new BadRequestException("垫付报销费用承担公司必须与实际采购批次一致");
  }
  return employeeAdvanceSourceCategory(batch, generalProcurementCategoryLabel);
}
