import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abandonSettlementDraftRecord,
  attachSettlementDraftLineFile,
  createSettlementDraftRecord,
  executeSettlementDraftLifecycleAction,
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

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function lifecycleDraft(
  overrides: {
    projectId?: string;
    draftId?: string;
    revision?: number;
    status?: "draft" | "abandoned";
    action?: "delete_pristine_draft" | "abandon_application";
    requiresComment?: boolean;
  } = {}
) {
  const action = overrides.action ?? "delete_pristine_draft";
  return {
    id: overrides.draftId ?? "draft-1",
    projectId: overrides.projectId ?? "project-1",
    revision: overrides.revision ?? 5,
    status: overrides.status ?? "draft",
    availableActions: [{
      key: action,
      label: action,
      kind: "danger",
      enabled: true,
      disabledReason: null,
      requiresComment:
        overrides.requiresComment ?? action === "abandon_application"
    }]
  };
}

function lifecycleInput(
  overrides: Partial<
    Parameters<typeof executeSettlementDraftLifecycleAction>[0]
  > = {}
) {
  return {
    ownerScope: "workbench-instance-a",
    generation: 3,
    projectId: "project-1",
    draftId: "draft-1",
    expectedRevision: 5,
    action: "delete_pristine_draft",
    reason: "用户确认结束",
    expectedRequiresComment: false,
    isCurrent: vi.fn(() => true),
    beforeWrite: vi.fn(() => true),
    onResult: vi.fn(),
    onCapabilityFailure: vi.fn(),
    onOperationFailure: vi.fn(),
    onOperationSettled: vi.fn(),
    ...overrides
  };
}

describe("settlement drafts API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
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

  it("rejects a missing workbench owner scope before reading the draft", async () => {
    const onCapabilityFailure = vi.fn();
    const onOperationSettled = vi.fn();

    await expect(executeSettlementDraftLifecycleAction(lifecycleInput({
      ownerScope: " ",
      onCapabilityFailure,
      onOperationSettled
    }))).rejects.toMatchObject({
      code: "SETTLEMENT_DRAFT_LIFECYCLE_INVALID_CONTEXT"
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
    expect(onOperationSettled).toHaveBeenCalledTimes(1);
  });

  it("coalesces one governed lifecycle operation, keeps result owner-only and settles every caller", async () => {
    const pendingRead = deferred<Response>();
    mockApiFetch
      .mockReturnValueOnce(pendingRead.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          draftId: "draft-1",
          status: "abandoned",
          action: "delete_pristine_draft",
          idempotent: false
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    );
    const ownerResult = vi.fn();
    const duplicateResult = vi.fn();
    const ownerSettled = vi.fn();
    const duplicateSettled = vi.fn();

    const first = executeSettlementDraftLifecycleAction(
      lifecycleInput({
        onResult: ownerResult,
        onOperationSettled: ownerSettled
      })
    );
    const duplicate = executeSettlementDraftLifecycleAction(
      lifecycleInput({
        onResult: duplicateResult,
        onOperationSettled: duplicateSettled
      })
    );

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    pendingRead.resolve(
      new Response(JSON.stringify(lifecycleDraft()), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      undefined,
      undefined
    ]);
    expect(ownerResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
    expect(duplicateResult).not.toHaveBeenCalled();
    expect(ownerSettled).toHaveBeenCalledTimes(1);
    expect(duplicateSettled).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce the same coordinates across remounted workbench instances", async () => {
    const pendingRead = deferred<Response>();
    mockApiFetch
      .mockReturnValueOnce(pendingRead.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          draftId: "draft-1",
          status: "abandoned",
          action: "delete_pristine_draft",
          idempotent: false
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const first = executeSettlementDraftLifecycleAction(lifecycleInput({
      ownerScope: "workbench-instance-old"
    }));
    const remountedOutcome = executeSettlementDraftLifecycleAction(
      lifecycleInput({
        ownerScope: "workbench-instance-new"
      })
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    pendingRead.resolve(
      new Response(JSON.stringify(lifecycleDraft()), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await first;
    await expect(remountedOutcome).resolves.toMatchObject({
      ok: false,
      error: { code: "SETTLEMENT_DRAFT_LIFECYCLE_BUSY" }
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("settles a rejected caller without settling the active owner", async () => {
    const pendingRead = deferred<Response>();
    mockApiFetch
      .mockReturnValueOnce(pendingRead.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          draftId: "draft-1",
          status: "abandoned",
          action: "delete_pristine_draft",
          idempotent: false
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const ownerSettled = vi.fn();
    const rejectedSettled = vi.fn();
    const first = executeSettlementDraftLifecycleAction(lifecycleInput({
      onOperationSettled: ownerSettled
    }));

    await expect(executeSettlementDraftLifecycleAction(lifecycleInput({
      reason: "另一项结束原因",
      onOperationSettled: rejectedSettled
    }))).rejects.toMatchObject({
      code: "SETTLEMENT_DRAFT_LIFECYCLE_BUSY"
    });
    expect(ownerSettled).not.toHaveBeenCalled();
    expect(rejectedSettled).toHaveBeenCalledTimes(1);

    pendingRead.resolve(
      new Response(JSON.stringify(lifecycleDraft()), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await first;
    expect(ownerSettled).toHaveBeenCalledTimes(1);
    expect(rejectedSettled).toHaveBeenCalledTimes(1);
  });

  it("fails closed before POST when the fresh draft coordinates or action change", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(lifecycleDraft({
        revision: 6,
        action: "abandon_application"
      })), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const beforeWrite = vi.fn(() => true);
    const onCapabilityFailure = vi.fn();

    await expect(executeSettlementDraftLifecycleAction(lifecycleInput({
      beforeWrite,
      onCapabilityFailure
    }))).rejects.toMatchObject({
      code: "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(beforeWrite).not.toHaveBeenCalled();
    expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
  });

  it("fails closed before POST when the fresh draft is no longer active", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(lifecycleDraft({
        status: "abandoned"
      })), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const beforeWrite = vi.fn(() => true);
    const onCapabilityFailure = vi.fn();

    await expect(executeSettlementDraftLifecycleAction(lifecycleInput({
      beforeWrite,
      onCapabilityFailure
    }))).rejects.toMatchObject({
      code: "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(beforeWrite).not.toHaveBeenCalled();
    expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
  });

  it("fails closed before POST when the fresh action comment requirement changes", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(lifecycleDraft({
        requiresComment: true
      })), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const beforeWrite = vi.fn(() => true);
    const onCapabilityFailure = vi.fn();

    await expect(executeSettlementDraftLifecycleAction(lifecycleInput({
      beforeWrite,
      onCapabilityFailure
    }))).rejects.toMatchObject({
      code: "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(beforeWrite).not.toHaveBeenCalled();
    expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
  });

  it("returns stale without POST after the page generation changes", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(lifecycleDraft()), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const onResult = vi.fn();

    await executeSettlementDraftLifecycleAction(lifecycleInput({
      isCurrent: vi.fn(() => false),
      onResult
    }));

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "stale" })
    );
  });

  it("returns stale without success effects when the page changes during POST", async () => {
    const pendingWrite = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(lifecycleDraft()), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockReturnValueOnce(pendingWrite.promise);
    const isCurrent = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const onResult = vi.fn();

    const operation = executeSettlementDraftLifecycleAction(lifecycleInput({
      isCurrent,
      onResult
    }));
    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
    });
    pendingWrite.resolve(
      new Response(JSON.stringify({
        draftId: "draft-1",
        status: "abandoned",
        action: "delete_pristine_draft",
        idempotent: false
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(operation).resolves.toBeUndefined();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "stale" })
    );
    expect(onResult).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("suppresses a stale POST failure after the page coordinates change", async () => {
    const pendingWrite = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(lifecycleDraft()), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockReturnValueOnce(pendingWrite.promise);
    const isCurrent = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const onResult = vi.fn();
    const onOperationFailure = vi.fn();

    const operation = executeSettlementDraftLifecycleAction(lifecycleInput({
      isCurrent,
      onResult,
      onOperationFailure
    }));
    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
    });
    pendingWrite.resolve(
      new Response(JSON.stringify({ message: "旧草稿写入失败" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(operation).resolves.toBeUndefined();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "stale" })
    );
    expect(onOperationFailure).not.toHaveBeenCalled();
  });

  it("fails closed after a mismatched abandonment response", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(lifecycleDraft()), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          draftId: "draft-other",
          status: "abandoned",
          action: "delete_pristine_draft",
          idempotent: false
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const onCapabilityFailure = vi.fn();

    await expect(executeSettlementDraftLifecycleAction(lifecycleInput({
      onCapabilityFailure
    }))).rejects.toMatchObject({
      code: "SETTLEMENT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH"
    });
    expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
  });

  it("releases the owner after a POST failure so the action can be retried", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(lifecycleDraft()), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "结束接口暂时不可用" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(lifecycleDraft()), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          draftId: "draft-1",
          status: "abandoned",
          action: "delete_pristine_draft",
          idempotent: false
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );

    await expect(
      executeSettlementDraftLifecycleAction(lifecycleInput())
    ).rejects.toThrow("结束接口暂时不可用");
    await expect(
      executeSettlementDraftLifecycleAction(lifecycleInput())
    ).resolves.toBeUndefined();
    expect(mockApiFetch).toHaveBeenCalledTimes(4);
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
