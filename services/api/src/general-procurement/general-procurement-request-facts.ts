import type { GeneralProcurement } from "@prisma/client";
import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import { calculateBusinessLineAmount, normalizeBusinessAmount, sumBusinessAmounts, type GeneralProcurementRequestLine } from "@jiangkong/shared-domain";
export function generalRequestEstimateText(value: { toString(): string } | null | undefined) {
  return value == null ? null : normalizeBusinessAmount(value.toString());
}
/** Advisory estimate only. Unknown rows stay unknown and never become payment capacity. */
export function generalRequestLineSummary(lines: readonly GeneralProcurementRequestLine[]) {
  const amounts = lines.map(line => line.estimatedAmount ?? calculateBusinessLineAmount(line.quantity, line.unitPrice));
  const known = amounts.filter((amount): amount is string => amount !== null);
  return { knownLineEstimatedSubtotal: known.length ? sumBusinessAmounts(known) : null, unknownLineCount: amounts.length - known.length };
}

export function generalProcurementDutySmsIntent(row: GeneralProcurement, projectName: string | undefined,
    businessLabel: string, dutyName: string): ApprovalDutySmsIntent {
  const estimate = generalRequestEstimateText(row.estimatedAmount);
  return {
    businessLabel,dutyName,businessCode:row.code,
    scopeName:row.projectId ? projectName ?? "项目名称待核对" : "公司日常",
    initiatorName:row.applicantNameSnapshot,subject:row.reason || "综合采购需求",
    participants:row.companyNameSnapshot ? [row.companyNameSnapshot] : [],
    amountText:estimate === null ? "待确定" : `预计 ${estimate} 元`,targetPath:approvalDutyTarget("generalProcurement",row.id),
  };
}
