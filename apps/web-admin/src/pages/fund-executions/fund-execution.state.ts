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

type IdempotencyKeyLease = {
  fingerprint: string;
  idempotencyKey: string;
};

export function createFundExecutionIdempotencyLease(
  issueIdempotencyKey: () => string = () => crypto.randomUUID()
) {
  const leases = new Map<string, IdempotencyKeyLease>();

  return {
    acquire(command: string, payload: unknown) {
      const fingerprint = payloadFingerprint(payload);
      const current = leases.get(command);
      if (current?.fingerprint === fingerprint) return current.idempotencyKey;

      const idempotencyKey = issueIdempotencyKey();
      leases.set(command, { fingerprint, idempotencyKey });
      return idempotencyKey;
    },
    complete(command: string, payload: unknown) {
      const current = leases.get(command);
      if (current?.fingerprint === payloadFingerprint(payload)) {
        leases.delete(command);
      }
    }
  };
}

function payloadFingerprint(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(payloadFingerprint).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${payloadFingerprint(item)}`)
      .join(",")}}`;
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

export function caseAllowsClassification(
  item: Pick<FundExecutionCaseListItem, "executionKind" | "actions">
) {
  return item.executionKind !== "reversal" && item.actions.some(
    (action) => action.key === "update_case" && action.enabled
  );
}

export function selectedClassificationPlan(
  plans: readonly FundExecutionClassificationPlan[],
  selectedPlanIndex: string
) {
  if (!/^(?:0|[1-9]\d*)$/u.test(selectedPlanIndex)) return null;
  return plans[Number(selectedPlanIndex)] ?? null;
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
