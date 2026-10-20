import type { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";
import { approvalEvidenceMetadata } from "./approval-evidence";

export const ADDITIONAL_APPROVAL_TITLES: Record<string, string> = {
  general_procurement: "综合采购申请单",
  project_expense_request: "项目费用审批单",
  project_settlement_exception_quota: "结算例外额度审批单",
  project_financing_quota: "融资额度审批单",
  fund_execution_case: "资金执行审批单",
  contract_seal: "用章审批单",
  employee_registration: "员工入职审批单",
  contract_takeover_correction: "历史承接更正审批单",
  contract_company_correction: "历史我方主体更正审批单",
  contract_tax_fact_revision: "历史税务事实审批单",
  contract_takeover_batch: "历史合同导入批次验收单",
  no_invoice_confirmation: "无票确认审批单",
  invoice_exception_confirmation: "发票例外审批单",
  spot_procurement_receipt: "零星材料到货审批单"
};

export interface ApprovalBusinessFacts {
  title: string;
  code: string;
  projectId: string | null;
  companyName: string;
  applicantName?: string;
  summary: Array<{ label: string; value: string }>;
}

export async function additionalApprovalFacts(
  tx: Prisma.TransactionClient,
  businessType: string,
  businessId: string,
  logs: readonly { metadata?: unknown }[],
  approvalInstanceId?: string
): Promise<ApprovalBusinessFacts | null> {
  if (!ADDITIONAL_APPROVAL_TITLES[businessType]) return null;
  const stored = logs.map(log => approvalEvidenceMetadata(log.metadata).form).filter(Boolean).at(-1);
  if (stored) {
    if (businessType === "contract_seal") {
      const source = await tx.contractSealTask.findUnique({ where: { id: businessId } });
      if (!source || !["in_seal", "completed"].includes(source.status)) {
        throw new BadRequestException("用章审批已失效，不能下载正式审批单");
      }
    } else if (businessType === "spot_procurement_receipt") {
      const source = await tx.spotProcurementReceiptReview.findUnique({ where: { id: businessId } });
      const reversal = await tx.spotProcurementReceiptReview.findFirst({ where: { targetReviewId: businessId, decision: "revoked" } });
      if (!source || source.decision !== "approved" || reversal) throw new BadRequestException("收货审核已失效，不能下载正式审批单");
    } else if (businessType === "no_invoice_confirmation" || businessType === "invoice_exception_confirmation") {
      const source = businessType === "no_invoice_confirmation"
        ? await tx.noInvoiceConfirmation.findUnique({ where: { id: businessId } })
        : await tx.invoiceExceptionConfirmation.findUnique({ where: { id: businessId } });
      if (!source || source.status !== "confirmed") throw new BadRequestException("票据确认已失效，不能下载正式审批单");
    }
    const form = approvalEvidenceMetadata(stored);
    if (typeof form.title !== "string" || typeof form.code !== "string" || typeof form.companyName !== "string" ||
        !(form.projectId === null || typeof form.projectId === "string") || !Array.isArray(form.summary) ||
        form.summary.some(row => !row || typeof row.label !== "string" || typeof row.value !== "string")) {
      throw new BadRequestException("审批单业务快照不完整，不能生成正式文件");
    }
    return form as unknown as ApprovalBusinessFacts;
  }
  const title = ADDITIONAL_APPROVAL_TITLES[businessType];
  let projectId: string | null = null;
  let companyName = "";
  let code = title;
  let applicantName: string | undefined;
  const summary: ApprovalBusinessFacts["summary"] = [];
  const money = (amount: bigint) => `${formatMoneyCentsAsYuan(amount)} 元`;
  if (businessType === "general_procurement") {
    const row = await tx.generalProcurement.findUniqueOrThrow({ where: { id: businessId } });
    projectId = row.projectId; code = row.code; companyName = row.companyNameSnapshot; applicantName = row.applicantNameSnapshot;
    summary.push({ label: "采购内容及原因", value: row.reason }, { label: "申请金额", value: money(row.requestedAmountCents) });
  } else if (businessType === "project_expense_request") {
    const row = await tx.projectExpenseRequest.findUniqueOrThrow({ where: { id: businessId } });
    projectId = row.projectId; code = row.code;
    summary.push({ label: "申请事由", value: row.reason }, { label: "申请金额", value: money(row.requestedAmountCents) },
      { label: "批准金额", value: money(row.approvedAmountCents ?? row.requestedAmountCents) });
  } else if (businessType === "project_financing_quota" || businessType === "project_settlement_exception_quota") {
    const row = businessType === "project_financing_quota"
      ? await tx.projectFinancingQuota.findUniqueOrThrow({ where: { id: businessId } })
      : await tx.projectSettlementExceptionQuota.findUniqueOrThrow({ where: { id: businessId } });
    projectId = row.projectId;
    summary.push({ label: "申请事由", value: row.reason }, { label: "批准额度", value: money(row.amountCents) },
      { label: "有效期至", value: row.validUntil?.toISOString().slice(0, 10) ?? "未设置" });
  } else if (businessType === "fund_execution_case") {
    if (!approvalInstanceId) throw new BadRequestException("资金执行审批实例证据缺失");
    const row = await tx.fundExecutionCase.findFirstOrThrow({ where: { caseKey: businessId, approvalInstanceId }, orderBy: { revision: "desc" } });
    const execution = await tx.fundExecution.findUniqueOrThrow({ where: { id: row.fundExecutionId } });
    summary.push({ label: "执行事由", value: row.reason }, { label: "金额", value: money(execution.amountCents) },
      { label: "资金方向", value: execution.direction === "inflow" ? "收入" : "支出" },
      { label: "发生时间", value: execution.occurredAt.toISOString().slice(0, 10) });
  } else {
    throw new BadRequestException("该历史审批缺少业务与签名快照，不能补造正式审批单");
  }
  if (projectId) {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } });
    summary.unshift({ label: "所属项目", value: project.name });
  }
  return { title, code, companyName, projectId, applicantName, summary };
}
