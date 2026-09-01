import {
  assertCompleteFundExecutionSelectionSet,
  selectExactlyOneIssuedPlan,
  type FundExecutionIssuedAxisOption,
  type FundExecutionIssuedPlan
} from "./fund-execution-axis-plan";
import type { ExecutionAllocationAxis } from "./fund-execution.domain";

const axes = ["payable", "project_fund", "relationship", "operating"] as const;

function option(
  lineNo: number,
  axis: ExecutionAllocationAxis,
  selectionRef: string,
  status: "applied" | "not_applicable" = "applied"
): FundExecutionIssuedAxisOption {
  const amountCents = status === "applied" ? 100n : 0n;
  return {
    selectionRef,
    summary: `${axis}-${lineNo}`,
    lineNo,
    axis,
    status,
    amountCents,
    axisIdentity: `${axis}:${lineNo}`,
    optionSnapshot: {
      version: 1,
      axis,
      status,
      axisIdentity: `${axis}:${lineNo}`,
      line: {
        lineNo,
        allocationLineId: `line-${lineNo}`,
        direction: "outflow",
        amountCents: "100",
        currencyCode: "CNY",
        businessType: "wage_payable_ref",
        businessId: `payable-${lineNo}`,
        sourceIdentity: `payable-${lineNo}`,
        sliceIdentity: `slice-${lineNo}`,
        projectId: `project-${lineNo}`
      },
      canonical: {}
    },
    optionFingerprint: `option-${axis}-${lineNo}`,
    consequencePlanSnapshot:
      status === "applied"
        ? [
            {
              sequence: 1,
              consequenceType:
                axis === "payable"
                  ? "payable_settlement_allocation"
                  : axis === "project_fund"
                    ? "project_funding_allocation"
                    : axis === "relationship"
                      ? "inter_entity_relationship_entry"
                      : "operating_fact_impact",
              consequenceIdentity: `${axis}:${lineNo}`,
              sliceIdentity: `slice-${lineNo}`,
              amountCents: "100",
              originalConsequenceId: null
            }
          ]
        : [],
    consequencePlanFingerprint: `plan-${axis}-${lineNo}`,
    originalAxisEffectId: null
  };
}

function plan(key: string, lineCount = 1): FundExecutionIssuedPlan {
  return {
    planKey: key,
    summary: key,
    selections: Array.from({ length: lineCount }, (_, index) =>
      axes.map((axis) => option(index + 1, axis, `${key}-${index + 1}-${axis}`))
    ).flat()
  };
}

describe("fund execution issued axis plan", () => {
  it("accepts only one complete server-issued plan regardless of ref order", () => {
    const selected = plan("server-plan");
    const resolved = selectExactlyOneIssuedPlan(
      [selected, plan("other-plan")],
      selected.selections.map(({ selectionRef }) => selectionRef).reverse(),
      100n
    );
    expect(resolved).toHaveLength(4);
  });

  it("rejects mixing per-axis refs from different server plans", () => {
    const first = plan("first");
    const second = plan("second");
    expect(() =>
      selectExactlyOneIssuedPlan(
        [first, second],
        [first.selections[0]!.selectionRef, ...second.selections.slice(1).map(({ selectionRef }) => selectionRef)],
        100n
      )
    ).toThrow("逐轴业务选项已失效");
  });

  it("requires exact four axes and exact execution amount", () => {
    const selected = plan("two-lines", 2);
    expect(() =>
      assertCompleteFundExecutionSelectionSet(selected.selections, 100n)
    ).toThrow("完整覆盖资金执行金额");
    expect(() =>
      assertCompleteFundExecutionSelectionSet(selected.selections.slice(1), 200n)
    ).toThrow("完整四轴");
  });

  it("allows explicit zero not-applicable axes without shadow effects", () => {
    const selections = axes.map((axis) =>
      option(1, axis, axis, axis === "relationship" ? "not_applicable" : "applied")
    );
    expect(() => assertCompleteFundExecutionSelectionSet(selections, 100n)).not.toThrow();
  });
});
