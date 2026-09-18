import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

const roles = ["finance_staff", "finance_director"] as const;
const field = (key: string, label: string, type: BusinessEntryFieldDefinition["type"], options: Partial<BusinessEntryFieldDefinition> = {}): BusinessEntryFieldDefinition => ({
  key, label, type, description: `${label}沿用原资金办理规则。`, example: "按真实银行资料填写", scope: "header", unit: type === "money" ? "分" : "", precision: 0, required: true,
  permissions: { view: roles, edit: roles }, display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: `提交时的${label}` },
  excel: { column: label, paste: "single", errorLocation: "cell" }, bulk: { enabled: false, strategy: "append" }, ...options
});

export const FUND_EXECUTION_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "fund_execution.case", entityType: "fund_execution_case", name: "资金办理", description: "银行资金办理及逐轴分类", version: 1,
  fields: [
    field("reason", "办理说明", "long_text"),
    field("amountCents", "资金金额", "money", { readOnly: true }),
    field("direction", "资金方向", "single_select", { readOnly: true, options: [{ value: "inflow", label: "入账" }, { value: "outflow", label: "出账" }] }),
    field("currencyCode", "币种", "text", { readOnly: true }), field("occurredAt", "发生时间", "text", { readOnly: true }),
    field("lineNo", "分类行号", "number", { scope: "line", readOnly: true }),
    field("classificationAmountCents", "分类金额", "money", { scope: "line", readOnly: true }),
    field("axis", "分类方向", "single_select", { scope: "line", options: [{ value: "payable", label: "应付核销" }, { value: "project_fund", label: "项目资金" }, { value: "relationship", label: "主体往来" }, { value: "operating", label: "经营事实" }] }),
    field("axisStatus", "分类结果", "single_select", { scope: "line", options: [{ value: "applied", label: "已应用" }, { value: "not_applicable", label: "不适用" }] }),
    field("summary", "业务分类说明", "text", { scope: "line", readOnly: true })
  ], rules: []
};

export async function freezeFundExecutionEntryInTransaction(tx: Prisma.TransactionClient, fundExecutionCaseId: string, actorUserId: string, classificationLines: Prisma.InputJsonValue) {
  const revision = await tx.fundExecutionCase.findUnique({ where: { id: fundExecutionCaseId } });
  if (!revision || revision.status !== "submitted" || revision.submittedByUserId !== actorUserId || revision.auditAction !== "submit_case") throw new ConflictException("资金办理提交修订不一致，请刷新后重试");
  const execution = await tx.fundExecution.findUnique({ where: { id: revision.fundExecutionId } });
  if (!execution) throw new ConflictException("资金执行事实不存在");
  return tx.fundExecutionEntrySnapshot.create({ data: {
    fundExecutionCaseId, sceneKey: FUND_EXECUTION_ENTRY_DEFINITION.key, businessAction: "submit_case", definitionVersion: FUND_EXECUTION_ENTRY_DEFINITION.version,
    definitionSnapshot: FUND_EXECUTION_ENTRY_DEFINITION as unknown as Prisma.InputJsonValue, frozenByUserId: actorUserId,
    // The case FK retains the existing immutable canonical choices. This public
    // field snapshot deliberately contains no signing tokens or private plans.
    valuesSnapshot: { reason: revision.reason, amountCents: execution.amountCents.toString(), direction: execution.direction, currencyCode: execution.currencyCode, occurredAt: execution.occurredAt.toISOString(), classificationLines }
  } });
}
