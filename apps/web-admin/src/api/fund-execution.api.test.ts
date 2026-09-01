import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  confirmFundExecutionCase,
  createFundExecutionCase,
  createFundExecutionReversal,
  fetchFundExecutionCapabilities,
  fetchFundExecutionCaseActions,
  fetchFundExecutionCaseOptions,
  fetchFundExecutionCases,
  fetchFundExecutionObservationOptions,
  fetchFundExecutionReversalOptions,
  returnFundExecutionCase,
  reviewFundExecutionCase,
  submitFundExecutionCase,
  updateFundExecutionCase,
  updateFundExecutionReversalReason
} from "./fund-execution.api";

const mockApiFetch = vi.mocked(apiFetch);

describe("fund execution API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("reads only business-safe workbench, observation, classification and reversal option seams", async () => {
    await fetchFundExecutionCases();
    await fetchFundExecutionCapabilities();
    await fetchFundExecutionCaseActions("case / opaque");
    await fetchFundExecutionObservationOptions("fund_execution_case");
    await fetchFundExecutionCaseOptions("case / opaque");
    await fetchFundExecutionReversalOptions();

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/fund-executions/cases",
      "/fund-executions/capabilities",
      "/fund-executions/cases/case%20%2F%20opaque",
      "/fund-executions/observation-options?purpose=fund_execution_case",
      "/fund-executions/cases/case%20%2F%20opaque/classification-options",
      "/fund-executions/reversal-options"
    ]);
  });

  it("creates quarantine and reversal cases from short-lived refs without technical ids", async () => {
    const quarantine = {
      observationSelectionRef: "fobs1.quarantine.opaque",
      reason: "暂未找到正式归属，先进入待分类案件",
      idempotencyKey: "11111111-1111-4111-8111-111111111111"
    };
    const reversal = {
      targetSelectionRef: "frev1.original.opaque",
      observationSelectionRef: "fobs1.reversal.opaque",
      reason: "银行退款，按原执行完整反向",
      idempotencyKey: "22222222-2222-4222-8222-222222222222"
    };

    await createFundExecutionCase(quarantine);
    await createFundExecutionReversal(reversal);

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/fund-executions/cases",
      expect.objectContaining({ method: "POST", body: JSON.stringify(quarantine) })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/fund-executions/reversals",
      expect.objectContaining({ method: "POST", body: JSON.stringify(reversal) })
    );
    const submitted = JSON.stringify({ quarantine, reversal });
    expect(submitted).not.toMatch(/observationId|targetExecutionId|fundExecutionId/u);
  });

  it("updates a resolution with one selectionRef per frozen line axis and no client classification coordinates", async () => {
    const input = {
      expectedRevision: 2,
      reason: "按正式工资应付和项目资金来源完成归类",
      selections: [
        { selectionRef: "faxis1.line-1.payable" },
        { selectionRef: "faxis1.line-1.project-fund" },
        { selectionRef: "faxis1.line-1.relationship" },
        { selectionRef: "faxis1.line-1.operating" }
      ],
      idempotencyKey: "33333333-3333-4333-8333-333333333333"
    };

    await updateFundExecutionCase("case / opaque", input);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/fund-executions/cases/case%20%2F%20opaque",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(input) })
    );
    expect(JSON.stringify(input)).not.toMatch(
      /axisIdentity|allocationLineId|projectId|consequenceType/u
    );
  });

  it("updates a reversal draft reason through its dedicated endpoint without classification selections", async () => {
    const input = {
      expectedRevision: 4,
      reason: "补充银行退款原因，不改变原执行逐轴分类",
      idempotencyKey: "55555555-5555-4555-8555-555555555555"
    };

    await updateFundExecutionReversalReason("case / opaque", input);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/fund-executions/cases/case%20%2F%20opaque/reversal",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(input) })
    );
    expect(JSON.stringify(input)).not.toMatch(
      /selections|selectionRef|axis|allocation|targetExecutionId/u
    );
  });

  it("uses the fixed lifecycle and approval endpoints", async () => {
    const command = {
      expectedRevision: 3,
      idempotencyKey: "44444444-4444-4444-8444-444444444444"
    };
    await submitFundExecutionCase("case / opaque", command);
    await returnFundExecutionCase("case / opaque", {
      ...command,
      reason: "分类依据需要补充"
    });
    await confirmFundExecutionCase("case / opaque", command);
    await reviewFundExecutionCase("case / opaque", {
      action: "approve",
      comment: "复核通过"
    });
    await reviewFundExecutionCase("case / opaque", {
      action: "return_to_applicant",
      comment: "分类依据不完整"
    });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/fund-executions/cases/case%20%2F%20opaque/submit",
      "/fund-executions/cases/case%20%2F%20opaque/return",
      "/fund-executions/cases/case%20%2F%20opaque/confirm",
      "/fund-executions/cases/case%20%2F%20opaque/approval-actions",
      "/fund-executions/cases/case%20%2F%20opaque/approval-actions"
    ]);
  });
});
