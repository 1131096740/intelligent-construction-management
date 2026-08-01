import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import {
  executeSpotProcurementWithdrawalAction,
  prepareSpotProcurementWithdrawalAction,
  type PrepareSpotProcurementWithdrawalActionInput,
  type SpotProcurementDetailReadModel,
  type SpotProcurementWithdrawalActionContext
} from "./spot-procurement.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

describe("spot procurement withdrawal action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it("performs a fresh detail read before one coordinate-bound withdrawal POST", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(withdrawalDetail()))
      .mockResolvedValueOnce(jsonResponse({ status: "draft" }));
    const context = withdrawalContext();
    const complete = vi.fn();

    const result = await executeSpotProcurementWithdrawalAction({
      action: "withdraw",
      capture: () => context,
      preflight: (captured) =>
        prepareSpotProcurementWithdrawalAction({
          ...captured,
          isCurrent: () => true
        }),
      current: (_captured, prepared) => prepared.status === "ready",
      complete,
      fail: vi.fn(),
      finish: vi.fn()
    });

    expect(result.status).toBe("completed");
    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2Fa",
      "/spot-procurements/procurement%2Fa/approval-withdrawal"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/spot-procurements/procurement%2Fa/approval-withdrawal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        })
      })
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["legacy form", withdrawalDetail({ form: "legacy" })],
    ["missing form", withdrawalDetail({ omitForm: true })],
    ["missing action", withdrawalDetail({ availableActions: [] })],
    [
      "duplicate action",
      withdrawalDetail({
        availableActions: [withdrawAction(), withdrawAction()]
      })
    ],
    [
      "missing coordinates",
      withdrawalDetail({ withdrawApprovalContext: null })
    ],
    [
      "version drift",
      withdrawalDetail({ expectedVersionId: "version-b" })
    ],
    [
      "approval drift",
      withdrawalDetail({ expectedApprovalInstanceId: "approval-b" })
    ],
    ["node drift", withdrawalDetail({ expectedNodeIndex: 2 })]
  ])("refuses %s before the withdrawal POST", async (_label, detail) => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(detail));

    await expect(
      prepareSpotProcurementWithdrawalAction(withdrawalInput())
    ).rejects.toThrow("撤回资格或审批坐标已变化");
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurements/procurement%2Fa"
    );
  });

  it("does not post after the owning route becomes stale during preflight", async () => {
    const pending = deferred<Response>();
    mockApiFetch.mockReturnValueOnce(pending.promise);
    let current = true;
    const input = withdrawalInput({
      isCurrent: () => current
    });

    const request = prepareSpotProcurementWithdrawalAction(input);
    current = false;
    pending.resolve(jsonResponse(withdrawalDetail()));

    await expect(request).resolves.toMatchObject({ status: "stale" });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)(
    "settles a stale withdrawal POST %s without refreshing or releasing a newer owner",
    async (settlement) => {
      const pending = deferred<Response>();
      mockApiFetch.mockReturnValueOnce(pending.promise);
      const context = withdrawalContext();
      const prepared = {
        status: "ready" as const,
        context,
        preflight:
          withdrawalDetail() as unknown as SpotProcurementDetailReadModel
      };
      let current = true;
      let busyOwnerId = context.operationId;
      const refresh = vi.fn();
      const success = vi.fn();
      const error = vi.fn();
      const complete = vi.fn(async () => {
        if (!current) return;
        success();
        await refresh();
      });
      const fail = vi.fn(() => {
        if (current) error();
      });
      const finish = vi.fn(
        (settledContext: SpotProcurementWithdrawalActionContext) => {
          if (busyOwnerId === settledContext.operationId) {
            busyOwnerId = 0;
          }
        }
      );

      const request = executeSpotProcurementWithdrawalAction({
        action: "withdraw",
        capture: () => context,
        preflight: async () => prepared,
        current: () => current,
        complete,
        fail,
        finish
      });
      await vi.waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledTimes(1);
      });

      current = false;
      busyOwnerId = context.operationId + 1;
      if (settlement === "resolve") {
        pending.resolve(jsonResponse({ status: "draft" }));
      } else {
        pending.reject(new Error("旧撤回网络失败"));
      }

      await expect(request).resolves.toMatchObject({
        status: settlement === "resolve" ? "stale" : "failed",
        context
      });
      expect(complete).not.toHaveBeenCalled();
      expect(fail).toHaveBeenCalledTimes(settlement === "reject" ? 1 : 0);
      expect(success).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledTimes(1);
      expect(finish).toHaveBeenCalledWith(context);
      expect(busyOwnerId).toBe(context.operationId + 1);
    }
  );
});

function withdrawalContext(): SpotProcurementWithdrawalActionContext {
  return Object.freeze({
    action: "withdraw",
    ownerScope: "page-a",
    routeGeneration: 2,
    detailEpoch: 3,
    dialogGeneration: 4,
    operationId: 5,
    procurementId: "procurement/a",
    expectedVersionId: "version-a",
    expectedApprovalInstanceId: "approval-a",
    expectedNodeIndex: 1
  });
}

function withdrawalInput(
  overrides: Partial<PrepareSpotProcurementWithdrawalActionInput> = {}
): PrepareSpotProcurementWithdrawalActionInput {
  return {
    ...withdrawalContext(),
    isCurrent: () => true,
    ...overrides
  };
}

function withdrawAction() {
  return {
    key: "withdraw_approval",
    label: "撤回采购审批",
    kind: "normal",
    enabled: true,
    disabledReason: null,
    requiredRoles: []
  };
}

function withdrawalDetail(
  overrides: {
    form?: "real_application" | "legacy";
    omitForm?: boolean;
    expectedVersionId?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    withdrawApprovalContext?: null;
    availableActions?: ReturnType<typeof withdrawAction>[];
  } = {}
) {
  return {
    procurement: {
      id: "procurement/a",
      ...(!overrides.omitForm
        ? { form: overrides.form ?? "real_application" }
        : {})
    },
    currentVersion: {
      id: overrides.expectedVersionId ?? "version-a"
    },
    withdrawApprovalContext:
      overrides.withdrawApprovalContext === null
        ? null
        : {
            expectedVersionId:
              overrides.expectedVersionId ?? "version-a",
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1
          },
    availableActions:
      overrides.availableActions ?? [withdrawAction()]
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
