import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSettlementDraftRecord,
  fetchSettlementDraftRecord,
  listSettlementDraftRecords,
  submitSettlementDraftRecord,
  updateSettlementDraftRecord
} from "./settlement-drafts.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);
const body = {
  contractVersionId: "version-1",
  settlementTemplateVersionId: "template-1",
  code: "JS-001",
  periodLabel: "2026-07",
  settlementLines: [
    {
      sourceType: "contract_bill_row" as const,
      contractBillRowId: "row-1",
      quantity: "2"
    }
  ]
};

describe("settlement drafts API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "draft-1", revision: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
  });

  it("creates and updates drafts within the project resource", async () => {
    await createSettlementDraftRecord("project/1", body);
    await updateSettlementDraftRecord("project/1", "draft/1", {
      ...body,
      expectedRevision: 3
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/projects/project%2F1/settlement-drafts",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/projects/project%2F1/settlement-drafts/draft%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ ...body, expectedRevision: 3 })
      })
    );
  });

  it("lists, loads and submits the saved draft without using the formal settlement endpoint", async () => {
    await listSettlementDraftRecords("project-1");
    await fetchSettlementDraftRecord("project-1", "draft-1");
    await submitSettlementDraftRecord("project-1", "draft-1", 4);

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project-1/settlement-drafts",
      "/projects/project-1/settlement-drafts/draft-1",
      "/projects/project-1/settlement-drafts/draft-1/approval-submission"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedRevision: 4 })
      })
    );
    expect(mockApiFetch.mock.calls.some(([path]) => path === "/settlements")).toBe(false);
  });

  it("returns a business-readable error and leaves page state ownership to the caller", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "合同税务事实尚未确认，暂不能提交结算审批"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      submitSettlementDraftRecord("project-1", "draft-1", 2)
    ).rejects.toThrow("合同税务事实尚未确认");
  });

  it("preserves the backend submission blocker on a readable historical draft", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "draft-legacy",
          revision: 2,
          submissionBlockingReason: "通用合同直接按冻结付款条款申请付款，不办理结算"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const draft = await fetchSettlementDraftRecord("project-1", "draft-legacy");

    expect(draft.submissionBlockingReason).toBe(
      "通用合同直接按冻结付款条款申请付款，不办理结算"
    );
  });
});
