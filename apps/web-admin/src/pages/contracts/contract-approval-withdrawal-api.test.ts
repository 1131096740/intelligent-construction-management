import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../api/api-fetch";
import {
  CoreFlowApiError,
  executeContractApprovalWithdrawalAction,
  prepareContractApprovalWithdrawalAction,
  type ContractApprovalWithdrawalActionContext,
  type PrepareContractApprovalWithdrawalActionInput
} from "../../api/core-flow-read.api";
import { ContractApprovalWithdrawalResultUnknownError } from "../../lib/contract-approval-result";

vi.mock("../../api/api-fetch", () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

describe("contract approval withdrawal API action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it("performs one fresh detail GET before one encoded coordinate-bound POST", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockResolvedValueOnce(jsonResponse({ status: "draft" }));
    const complete = vi.fn();

    const result = await executeContractApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareContractApprovalWithdrawalAction({
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
      "/contracts/contract%2Fa",
      "/contracts/version%2Fa/approval-withdrawal"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/contracts/version%2Fa/approval-withdrawal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(withdrawalCoordinates())
      })
    );
    expect(complete).toHaveBeenCalledTimes(1);
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
    ["contract identity drift", withdrawalDetail({ contractId: "contract-b" })],
    ["version drift", withdrawalDetail({ contractVersionId: "version-b" })],
    [
      "contract timestamp drift",
      withdrawalDetail({ expectedContractUpdatedAt: "2026-08-02T00:01:00.000Z" })
    ],
    ["approval drift", withdrawalDetail({ expectedApprovalInstanceId: "approval-b" })],
    ["node drift", withdrawalDetail({ expectedNodeIndex: 2 })],
    [
      "approval timestamp drift",
      withdrawalDetail({ expectedApprovalUpdatedAt: "2026-08-02T00:06:00.000Z" })
    ]
  ])("refuses %s before POST", async (_label, detail) => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(detail));

    await expect(
      prepareContractApprovalWithdrawalAction(withdrawalInput())
    ).rejects.toThrow("撤回资格或审批坐标已变化");
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not POST after the owning route becomes stale during fresh GET", async () => {
    const pending = deferred<Response>();
    mockApiFetch.mockReturnValueOnce(pending.promise);
    let current = true;
    const request = prepareContractApprovalWithdrawalAction(
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

    const request = executeContractApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareContractApprovalWithdrawalAction({
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
    pendingPost.resolve(jsonResponse({ status: "draft" }));
    await request;

    expect(stale).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(ContractApprovalWithdrawalResultUnknownError)
    );
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("socket closed"))],
    ["server failure", () => Promise.resolve(jsonResponse({ message: "failed" }, 500))],
    ["success parse failure", () => Promise.resolve(new Response("not-json", { status: 200 }))]
  ])("classifies %s after POST as an unknown result", async (_label, responseFactory) => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockImplementationOnce(responseFactory);
    const fail = vi.fn();

    await executeContractApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareContractApprovalWithdrawalAction({
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
      expect.any(ContractApprovalWithdrawalResultUnknownError)
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a 4xx withdrawal rejection as a known business failure", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockResolvedValueOnce(
        jsonResponse({ code: "CONTRACT_APPROVAL_WITHDRAWAL_CONFLICT", message: "坐标已变化" }, 409)
      );
    const fail = vi.fn();

    await executeContractApprovalWithdrawalAction({
      action: "withdraw",
      capture: () => withdrawalContext(),
      preflight: (context) =>
        prepareContractApprovalWithdrawalAction({
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
      ContractApprovalWithdrawalResultUnknownError
    );
  });
});

function withdrawalCoordinates() {
  return {
    expectedContractUpdatedAt: "2026-08-02T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-a",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-08-02T00:05:00.000Z"
  };
}

function withdrawalContext(): ContractApprovalWithdrawalActionContext {
  return Object.freeze({
    action: "withdraw",
    ownerScope: "contract/a\u0000version/a\u0000approval-a",
    routeGeneration: 2,
    detailEpoch: 2,
    dialogGeneration: 3,
    operationId: 4,
    routeContractId: "contract/a",
    contractId: "contract/a",
    contractVersionId: "version/a",
    ...withdrawalCoordinates()
  });
}

function withdrawalInput(
  overrides: Partial<PrepareContractApprovalWithdrawalActionInput> = {}
): PrepareContractApprovalWithdrawalActionInput {
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
    contractId?: string;
    contractVersionId?: string;
    expectedContractUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    withdrawApprovalContext?: null;
    availableActions?: ReturnType<typeof withdrawAction>[];
  } = {}
) {
  const coordinates = {
    expectedContractUpdatedAt:
      overrides.expectedContractUpdatedAt ?? "2026-08-02T00:00:00.000Z",
    expectedApprovalInstanceId:
      overrides.expectedApprovalInstanceId ?? "approval-a",
    expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
    expectedApprovalUpdatedAt:
      overrides.expectedApprovalUpdatedAt ?? "2026-08-02T00:05:00.000Z"
  };
  return {
    id: overrides.contractId ?? "contract/a",
    contractVersionId: overrides.contractVersionId ?? "version/a",
    lifecycleUpdatedAt: coordinates.expectedContractUpdatedAt,
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
