import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../api/api-fetch";
import {
  CoreFlowApiError,
  executeSettlementApprovalWithdrawalAction,
  prepareSettlementApprovalWithdrawalAction,
  type PrepareSettlementApprovalWithdrawalActionInput,
  type SettlementApprovalWithdrawalActionContext
} from "../../api/core-flow-read.api";
import { SettlementApprovalWithdrawalResultUnknownError } from "../../lib/settlement-approval-result";

vi.mock("../../api/api-fetch", () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

describe("settlement approval withdrawal API action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it("performs one fresh detail GET before one encoded coordinate-bound POST", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockResolvedValueOnce(
        jsonResponse({ id: "settlement-record/a", status: "withdrawn" })
      );
    const complete = vi.fn();

    const result = await executeSettlementApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareSettlementApprovalWithdrawalAction({
          ...context,
          isCurrent: () => true
        }),
      current: (_context, prepared) => prepared.status === "ready",
      stale: vi.fn(),
      complete,
      fail: vi.fn(),
      finish: vi.fn()
    });

    expect(result.status).toBe("completed");
    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/settlements/settlement%2Fa",
      "/settlements/settlement-record%2Fa/approval-withdrawal"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/settlements/settlement-record%2Fa/approval-withdrawal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(withdrawalCoordinates())
      })
    );
    expect(complete).toHaveBeenCalledWith(
      expect.anything(),
      Object.freeze({ id: "settlement-record/a", status: "withdrawn" })
    );
  });

  it.each([
    ["missing action", withdrawalDetail({ availableActions: [] })],
    [
      "disabled action",
      withdrawalDetail({
        availableActions: [{ ...withdrawAction(), enabled: false }]
      })
    ],
    [
      "duplicate action",
      withdrawalDetail({ availableActions: [withdrawAction(), withdrawAction()] })
    ],
    ["missing coordinates", withdrawalDetail({ withdrawApprovalContext: null })],
    ["settlement code drift", withdrawalDetail({ settlementCode: "JS-B" })],
    [
      "settlement identity drift",
      withdrawalDetail({ settlementId: "settlement-record-b" })
    ],
    [
      "settlement timestamp drift",
      withdrawalDetail({ expectedSettlementUpdatedAt: "2026-08-02T00:01:00.000Z" })
    ],
    [
      "top-level lifecycle timestamp drift",
      withdrawalDetail({ lifecycleUpdatedAt: "2026-08-02T00:01:00.000Z" })
    ],
    [
      "approval drift",
      withdrawalDetail({ expectedApprovalInstanceId: "approval-b" })
    ],
    ["node drift", withdrawalDetail({ expectedNodeIndex: 2 })],
    [
      "approval timestamp drift",
      withdrawalDetail({ expectedApprovalUpdatedAt: "2026-08-02T00:06:00.000Z" })
    ]
  ])("refuses %s before POST", async (_label, detail) => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(detail));

    await expect(
      prepareSettlementApprovalWithdrawalAction(withdrawalInput())
    ).rejects.toThrow("撤回资格或审批坐标已变化");
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-object detail", null],
    ["invalid actions", { ...withdrawalDetail(), availableActions: {} }],
    [
      "invalid settlement timestamp",
      withdrawalDetail({ expectedSettlementUpdatedAt: "not-a-date" })
    ],
    [
      "invalid approval timestamp",
      withdrawalDetail({ expectedApprovalUpdatedAt: "not-a-date" })
    ],
    ["fractional node", withdrawalDetail({ expectedNodeIndex: 1.5 })]
  ])("strictly rejects %s before POST", async (_label, detail) => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(detail));

    await expect(
      prepareSettlementApprovalWithdrawalAction(withdrawalInput())
    ).rejects.toThrow(/结算审批撤回.*无效|撤回资格或审批坐标已变化/u);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not POST after the owning route becomes stale during fresh GET", async () => {
    const pending = deferred<Response>();
    mockApiFetch.mockReturnValueOnce(pending.promise);
    let current = true;
    const request = prepareSettlementApprovalWithdrawalAction(
      withdrawalInput({ isCurrent: () => current })
    );

    current = false;
    pending.resolve(jsonResponse(withdrawalDetail()));

    await expect(request).resolves.toMatchObject({ status: "stale" });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("treats ownership loss after POST dispatch as unknown instead of claiming no submission", async () => {
    const pendingPost = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockReturnValueOnce(pendingPost.promise);
    let current = true;
    const stale = vi.fn();
    const fail = vi.fn();

    const request = executeSettlementApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareSettlementApprovalWithdrawalAction({
          ...context,
          isCurrent: () => current
        }),
      current: () => current,
      stale,
      complete: vi.fn(),
      fail,
      finish: vi.fn()
    });
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));

    current = false;
    pendingPost.resolve(
      jsonResponse({ id: "settlement-record/a", status: "withdrawn" })
    );
    await request;

    expect(stale).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(SettlementApprovalWithdrawalResultUnknownError)
    );
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("socket closed"))],
    [
      "server failure",
      () => Promise.resolve(jsonResponse({ message: "failed" }, 500))
    ],
    [
      "success parse failure",
      () => Promise.resolve(new Response("not-json", { status: 200 }))
    ],
    [
      "malformed success",
      () => Promise.resolve(jsonResponse({ id: "settlement-record/a" }))
    ],
    [
      "wrong response identity",
      () => Promise.resolve(jsonResponse({ id: "settlement-record/b", status: "withdrawn" }))
    ],
    [
      "wrong response terminal state",
      () => Promise.resolve(jsonResponse({ id: "settlement-record/a", status: "draft" }))
    ]
  ])("classifies %s after POST as an unknown result", async (_label, responseFactory) => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockImplementationOnce(responseFactory);
    const fail = vi.fn();

    await executeSettlementApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareSettlementApprovalWithdrawalAction({
          ...context,
          isCurrent: () => true
        }),
      current: (_context, prepared) => prepared.status === "ready",
      stale: vi.fn(),
      complete: vi.fn(),
      fail,
      finish: vi.fn()
    });

    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(SettlementApprovalWithdrawalResultUnknownError)
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a 4xx withdrawal rejection as a known business failure", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT",
            message: "坐标已变化"
          },
          409
        )
      );
    const fail = vi.fn();

    await executeSettlementApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareSettlementApprovalWithdrawalAction({
          ...context,
          isCurrent: () => true
        }),
      current: (_context, prepared) => prepared.status === "ready",
      stale: vi.fn(),
      complete: vi.fn(),
      fail,
      finish: vi.fn()
    });

    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(CoreFlowApiError)
    );
    expect(fail.mock.calls[0]?.[1]).not.toBeInstanceOf(
      SettlementApprovalWithdrawalResultUnknownError
    );
  });

  it("classifies a post-success completion failure as unknown", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockResolvedValueOnce(
        jsonResponse({ id: "settlement-record/a", status: "withdrawn" })
      );
    const fail = vi.fn();

    await executeSettlementApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareSettlementApprovalWithdrawalAction({
          ...context,
          isCurrent: () => true
        }),
      current: () => true,
      stale: vi.fn(),
      complete: () => {
        throw new Error("authoritative reread failed");
      },
      fail,
      finish: vi.fn()
    });

    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(SettlementApprovalWithdrawalResultUnknownError)
    );
  });
});

function withdrawalCoordinates() {
  return {
    expectedSettlementUpdatedAt: "2026-08-02T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-a",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-08-02T00:05:00.000Z"
  };
}

function withdrawalContext(): SettlementApprovalWithdrawalActionContext {
  return Object.freeze({
    action: "withdraw",
    ownerScope:
      "settlement/a\u0000JS-A\u0000settlement-record/a\u0000approval-a",
    routeGeneration: 2,
    detailEpoch: 2,
    dialogGeneration: 3,
    operationId: 4,
    routeSettlementId: "settlement/a",
    settlementCode: "JS-A",
    settlementId: "settlement-record/a",
    ...withdrawalCoordinates()
  });
}

function withdrawalInput(
  overrides: Partial<PrepareSettlementApprovalWithdrawalActionInput> = {}
): PrepareSettlementApprovalWithdrawalActionInput {
  return {
    ...withdrawalContext(),
    isCurrent: () => true,
    ...overrides
  };
}

function withdrawAction() {
  return {
    key: "withdraw_approval",
    label: "撤回审批",
    kind: "normal",
    enabled: true,
    disabledReason: null,
    requiredRoles: []
  };
}

function withdrawalDetail(
  overrides: {
    settlementCode?: string;
    settlementId?: string;
    lifecycleUpdatedAt?: string;
    expectedSettlementUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    withdrawApprovalContext?: null;
    availableActions?: ReturnType<typeof withdrawAction>[];
  } = {}
) {
  const coordinates = {
    expectedSettlementUpdatedAt:
      overrides.expectedSettlementUpdatedAt ?? "2026-08-02T00:00:00.000Z",
    expectedApprovalInstanceId:
      overrides.expectedApprovalInstanceId ?? "approval-a",
    expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
    expectedApprovalUpdatedAt:
      overrides.expectedApprovalUpdatedAt ?? "2026-08-02T00:05:00.000Z"
  };
  return {
    id: overrides.settlementCode ?? "JS-A",
    settlementId: overrides.settlementId ?? "settlement-record/a",
    lifecycleUpdatedAt:
      overrides.lifecycleUpdatedAt ?? coordinates.expectedSettlementUpdatedAt,
    withdrawApprovalContext:
      overrides.withdrawApprovalContext === null ? null : coordinates,
    availableActions: overrides.availableActions ?? [withdrawAction()]
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}
