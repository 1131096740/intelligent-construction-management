import { BadRequestException, ConflictException } from "@nestjs/common";

import {
  EXECUTION_ALLOCATION_AXES,
  type ExecutionAllocationAxis,
  type ExecutionAllocationAxisStatus
} from "./fund-execution.domain";

export type FundExecutionConsequenceType =
  | "payable_settlement_allocation"
  | "project_funding_allocation"
  | "inter_entity_relationship_entry"
  | "operating_fact_impact";

export type FundExecutionConsequencePlanItem = Readonly<{
  sequence: number;
  consequenceType: FundExecutionConsequenceType;
  consequenceIdentity: string;
  sliceIdentity: string | null;
  amountCents: string;
  originalConsequenceId: string | null;
}>;

export type FundExecutionLineSnapshot = Readonly<{
  lineNo: number;
  allocationLineId: string;
  direction: "inflow" | "outflow";
  amountCents: string;
  currencyCode: "CNY";
  businessType: string;
  businessId: string;
  sourceIdentity: string;
  sliceIdentity: string;
  projectId: string;
}>;

export type FundExecutionAxisOptionSnapshot = Readonly<{
  version: 1;
  axis: ExecutionAllocationAxis;
  status: ExecutionAllocationAxisStatus;
  axisIdentity: string;
  line: FundExecutionLineSnapshot;
  canonical: Record<string, unknown>;
}>;

export type FundExecutionResolvedAxisSelection = Readonly<{
  selectionRef: string;
  lineNo: number;
  axis: ExecutionAllocationAxis;
  status: ExecutionAllocationAxisStatus;
  amountCents: bigint;
  axisIdentity: string;
  optionSnapshot: FundExecutionAxisOptionSnapshot;
  optionFingerprint: string;
  consequencePlanSnapshot: readonly FundExecutionConsequencePlanItem[];
  consequencePlanFingerprint: string;
  originalAxisEffectId: string | null;
}>;

export type FundExecutionIssuedAxisOption = FundExecutionResolvedAxisSelection &
  Readonly<{ summary: string }>;

export type FundExecutionIssuedPlan = Readonly<{
  planKey: string;
  summary: string;
  selections: readonly FundExecutionIssuedAxisOption[];
}>;

export function assertCompleteFundExecutionSelectionSet(
  selections: readonly FundExecutionResolvedAxisSelection[],
  executionAmountCents: bigint
) {
  if (executionAmountCents <= 0n) {
    throw new ConflictException("资金执行金额无效");
  }
  if (selections.length === 0 || selections.length % 4 !== 0) {
    throw new BadRequestException("逐轴业务选择必须按每行完整四轴提交");
  }
  const byLine = new Map<number, FundExecutionResolvedAxisSelection[]>();
  for (const selection of selections) {
    const group = byLine.get(selection.lineNo) ?? [];
    group.push(selection);
    byLine.set(selection.lineNo, group);
  }
  let total = 0n;
  for (const [lineNo, group] of [...byLine].sort(([left], [right]) => left - right)) {
    const axes = group.map(({ axis }) => axis);
    if (
      group.length !== 4 ||
      new Set(axes).size !== 4 ||
      EXECUTION_ALLOCATION_AXES.some((axis) => !axes.includes(axis))
    ) {
      throw new BadRequestException(`第 ${lineNo} 行必须完整覆盖应付、项目资金、往来和经营四轴`);
    }
    const applied = group.filter(({ status }) => status === "applied");
    if (!applied.length) {
      throw new BadRequestException(`第 ${lineNo} 行至少需要一个正式业务后果`);
    }
    const lineAmount = applied[0]!.amountCents;
    if (
      lineAmount <= 0n ||
      applied.some(({ amountCents }) => amountCents !== lineAmount) ||
      group.some(
        ({ status, amountCents, consequencePlanSnapshot }) =>
          status === "not_applicable" &&
          (amountCents !== 0n || consequencePlanSnapshot.length !== 0)
      )
    ) {
      throw new BadRequestException(`第 ${lineNo} 行的逐轴金额不一致`);
    }
    total += lineAmount;
  }
  if (total !== executionAmountCents) {
    throw new BadRequestException("分类明细金额必须完整覆盖资金执行金额");
  }
}

export function selectExactlyOneIssuedPlan(
  plans: readonly FundExecutionIssuedPlan[],
  selectionRefs: readonly string[],
  executionAmountCents: bigint
) {
  const submitted = [...new Set(selectionRefs)].sort();
  if (submitted.length !== selectionRefs.length) {
    throw new BadRequestException("逐轴业务选项不能重复提交");
  }
  const matches = plans.filter((plan) => {
    const refs = plan.selections.map(({ selectionRef }) => selectionRef).sort();
    return (
      refs.length === submitted.length &&
      refs.every((selectionRef, index) => selectionRef === submitted[index])
    );
  });
  if (matches.length !== 1) {
    throw new ConflictException("逐轴业务选项已失效，请刷新后重新选择");
  }
  const selections = matches[0]!.selections;
  assertCompleteFundExecutionSelectionSet(selections, executionAmountCents);
  return selections;
}
