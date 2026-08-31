import type {
  FundExecutionAxis,
  FundExecutionCaseListItem,
  FundExecutionClassificationPlan
} from "../../api/fund-execution.api";

export type { FundExecutionClassificationPlan } from "../../api/fund-execution.api";

export const FUND_EXECUTION_AXES = [
  "payable",
  "project_fund",
  "relationship",
  "operating"
] as const satisfies readonly FundExecutionAxis[];

export const FUND_EXECUTION_AXIS_LABELS: Record<FundExecutionAxis, string> = {
  payable: "应付",
  project_fund: "项目资金",
  relationship: "主体往来",
  operating: "经营"
};

export function caseAllowsClassification(
  item: Pick<FundExecutionCaseListItem, "executionKind" | "actions">
) {
  return item.executionKind !== "reversal" && item.actions.some(
    (action) => action.key === "update_case" && action.enabled
  );
}

export function flattenClassificationPlan(
  plan: FundExecutionClassificationPlan
): Array<{ selectionRef: string }> {
  if (!plan.lines.length) {
    throw new Error("逐轴分类方案必须至少包含一条待分类资金");
  }
  const selectionRefs = new Set<string>();
  const result: Array<{ selectionRef: string }> = [];
  for (const line of plan.lines) {
    const byAxis = new Map(line.axes.map((option) => [option.axis, option]));
    if (
      line.axes.length !== FUND_EXECUTION_AXES.length ||
      byAxis.size !== FUND_EXECUTION_AXES.length ||
      FUND_EXECUTION_AXES.some((axis) => !byAxis.has(axis))
    ) {
      throw new Error(`第 ${line.lineNo} 条待分类资金缺少完整四轴选项`);
    }
    for (const axis of FUND_EXECUTION_AXES) {
      const selectionRef = byAxis.get(axis)?.selectionRef.trim() ?? "";
      if (!selectionRef || selectionRefs.has(selectionRef)) {
        throw new Error(`第 ${line.lineNo} 条待分类资金的四轴选项已失效`);
      }
      selectionRefs.add(selectionRef);
      result.push({ selectionRef });
    }
  }
  return result;
}

export function selectionIsExpired(expiresAt: string, now = Date.now()) {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}
