import { describe, expect, it } from "vitest";

import {
  caseAllowsClassification,
  flattenClassificationPlan,
  selectedClassificationPlan,
  type FundExecutionClassificationPlan
} from "./fund-execution.state";

describe("fund execution web state", () => {
  it("submits every line through exactly four server-issued axis refs", () => {
    const plan = classificationPlan();

    expect(flattenClassificationPlan(plan)).toEqual([
      { selectionRef: "line-1-payable" },
      { selectionRef: "line-1-project-fund" },
      { selectionRef: "line-1-relationship" },
      { selectionRef: "line-1-operating" },
      { selectionRef: "line-2-payable" },
      { selectionRef: "line-2-project-fund" },
      { selectionRef: "line-2-relationship" },
      { selectionRef: "line-2-operating" }
    ]);
  });

  it("does not treat an empty radio selection as the first classification plan", () => {
    const plans = [classificationPlan()];

    expect(selectedClassificationPlan(plans, "")).toBeNull();
    expect(selectedClassificationPlan(plans, "0")).toBe(plans[0]);
  });

  it("fails closed when a server plan omits, duplicates or invents an axis", () => {
    const missing = classificationPlan();
    missing.lines[0]!.axes.pop();
    expect(() => flattenClassificationPlan(missing)).toThrow("完整四轴");

    const duplicate = classificationPlan();
    duplicate.lines[0]!.axes[3] = {
      ...duplicate.lines[0]!.axes[0]!,
      selectionRef: "duplicate-payable"
    };
    expect(() => flattenClassificationPlan(duplicate)).toThrow("完整四轴");
  });

  it("keeps returned successor drafts classifiable but never classifies a reversal fact", () => {
    expect(
      caseAllowsClassification({
        executionKind: "reversal",
        actions: [caseAction("update_case", true)]
      })
    ).toBe(false);
    expect(
      caseAllowsClassification({
        executionKind: "quarantine",
        actions: [caseAction("update_case", true)]
      })
    ).toBe(true);
    expect(
      caseAllowsClassification({
        executionKind: "quarantine",
        actions: [caseAction("update_case", false)]
      })
    ).toBe(false);
  });
});

function caseAction(key: "update_case", enabled: boolean) {
  return {
    key,
    label: "修改分类",
    enabled,
    disabledReason: enabled ? null : "当前不可修改"
  };
}

function classificationPlan(): FundExecutionClassificationPlan {
  const axes = ["payable", "project_fund", "relationship", "operating"] as const;
  return {
    summary: "两条应付按正式资金来源完整归类",
    expiresAt: "2026-08-31T12:05:00.000Z",
    lines: [1, 2].map((lineNo) => ({
      lineNo,
      amountCents: lineNo === 1 ? "6000" : "4000",
      summary: `第 ${lineNo} 条待分类资金`,
      axes: axes.map((axis) => ({
        axis,
        status: axis === "relationship" ? "not_applicable" as const : "applied" as const,
        selectionRef: `line-${lineNo}-${axis.replace("_", "-")}`,
        summary: `${axis} 中文业务摘要`
      }))
    }))
  };
}
