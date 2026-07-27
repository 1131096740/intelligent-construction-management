import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abandonSettlementDraftRecord,
  attachSettlementDraftLineFile,
  createSettlementDraftRecord,
  fetchSettlementDraftRecord,
  generateSettlementFrozenDocument,
  linkSettlementCounterpartySignedDocument,
  listSettlementDraftLineAttachments,
  invalidateSettlementDraftLineAttachment,
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
  fieldReviewerUserId: "material-user-1",
  fieldReviewerRoleKey: "material_staff" as const,
  isFinal: true,
  finalCumulativeAmountCents: "200000",
  finalScopeCompleted: true,
  finalPriorSettlementsIncluded: true,
  finalNoOutstandingSettlements: true,
  finalWithinContractCap: true,
  finalNoFurtherOrdinarySettlements: true,
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

  it("abandons an encoded settlement draft with the exact CAS body", async () => {
    await abandonSettlementDraftRecord("project/1", "draft/1", {
      expectedRevision: 5,
      action: "abandon_application",
      reason: "乙方签章资料需要重做"
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/projects/project%2F1/settlement-drafts/draft%2F1/abandonment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 5,
          action: "abandon_application",
          reason: "乙方签章资料需要重做"
        })
      }
    );
  });

  it("uses scoped, revision-protected endpoints for settlement line attachments", async () => {
    await listSettlementDraftLineAttachments("project/1", "draft/1");
    await attachSettlementDraftLineFile("project/1", "draft/1", "visa:line/1", {
      fileId: "file-1", purpose: "现场签证单", expectedRevision: 5
    });
    await invalidateSettlementDraftLineAttachment("project/1", "draft/1", "attachment/1", 6);

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project%2F1/settlement-drafts/draft%2F1/line-attachments",
      "/projects/project%2F1/settlement-drafts/draft%2F1/lines/visa%3Aline%2F1/attachments",
      "/projects/project%2F1/settlement-drafts/draft%2F1/line-attachments/attachment%2F1/invalidation"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      method: "POST", body: JSON.stringify({ fileId: "file-1", purpose: "现场签证单", expectedRevision: 5 })
    }));
  });

  it("preserves the Chinese settlement abandonment failure", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "结算草稿已被更新，请刷新后重试" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(abandonSettlementDraftRecord("project-1", "draft-1", {
      expectedRevision: 4,
      action: "delete_pristine_draft"
    })).rejects.toThrow("结算草稿已被更新，请刷新后重试");
  });

  it("generates the exact draft revision and links the declared counterparty-signed original", async () => {
    await generateSettlementFrozenDocument("project/1", "draft/1", 5);
    await linkSettlementCounterpartySignedDocument("project/1", "draft/1", {
      expectedRevision: 5,
      frozenDocumentId: "frozen-document-1",
      uploadedFileId: "file-1",
      declaration: {
        pageOrderMatchesFrozenDocument: true,
        counterpartySignedAndDated: true,
        everyPageStamped: true,
        crossPageSealCompleted: true
      }
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/projects/project%2F1/settlement-drafts/draft%2F1/frozen-document",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedRevision: 5 })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/projects/project%2F1/settlement-drafts/draft%2F1/counterparty-signed-documents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedRevision: 5,
          frozenDocumentId: "frozen-document-1",
          uploadedFileId: "file-1",
          declaration: {
            pageOrderMatchesFrozenDocument: true,
            counterpartySignedAndDated: true,
            everyPageStamped: true,
            crossPageSealCompleted: true
          }
        })
      })
    );
  });

  it("keeps governance and document linkage errors business-readable", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "冻结版结算单已过期，请按当前草稿重新生成" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      generateSettlementFrozenDocument("project-1", "draft-1", 3)
    ).rejects.toThrow("冻结版结算单已过期");
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

  it("preserves active frozen and counterparty evidence returned by draft detail", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "draft-1",
          revision: 4,
          documents: {
            frozenDocument: {
              id: "frozen-1",
              fileId: "file-frozen-1",
              fileName: "结算冻结版.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              pageCount: 2,
              sourceRevision: 4,
              status: "active",
              generationStatus: "completed",
              declaration: null,
              createdAt: "2026-07-18T01:00:00.000Z"
            },
            counterpartySignedOriginal: null
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const draft = await fetchSettlementDraftRecord("project-1", "draft-1");

    expect(draft.documents?.frozenDocument).toMatchObject({
      id: "frozen-1",
      sourceRevision: 4,
      pageCount: 2
    });
    expect(draft.documents?.counterpartySignedOriginal).toBeNull();
  });
});
