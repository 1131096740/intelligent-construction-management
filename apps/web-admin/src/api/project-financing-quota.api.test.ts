import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectFinancingQuotaRequestAttemptState,
  createProjectOverviewRequestOwner,
  fetchProjectFinancingQuotaWorkbench,
  requestProjectFinancingQuotaWithUpload,
  type ProjectFinancingQuotaWorkbenchReadModel
} from "./project-financing-quota.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);
const requestIdempotencyKey = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestAction(enabled = true, requiresFile = true) {
  return {
    key: "request_financing_quota",
    label: "申请垫资额度",
    kind: "primary",
    enabled,
    disabledReason: enabled ? null : "当前不可申请",
    requiredAction: "project.financing_quota.request",
    requiresFile
  };
}

function quotaRow(
  id: string,
  status: "approval_pending" | "approved" | "rejected" | "terminated" =
    "approval_pending"
): ProjectFinancingQuotaWorkbenchReadModel["rows"][number] {
  return {
    id,
    amountCents: "5000000",
    reason: "阶段性垫资保障项目付款",
    validUntil: null,
    status,
    statusLabel: status === "approval_pending" ? "审批中" : "已批准",
    requestedByName: "项目经理甲",
    approvedByName: status === "approved" ? "董事长甲" : null,
    approvedAt: status === "approved" ? "2026-08-02T01:01:00.000Z" : null,
    terminatedAt: null,
    terminatedByName: null,
    terminationReason: null,
    createdAt: "2026-08-02T01:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z",
    isExpired: false,
    netUsedAmountCents: "0",
    availableAmountCents: "0",
    currentApproval: {
      status,
      currentNodeIndex: status === "approval_pending" ? 0 : 2,
      currentNodeName: status === "approval_pending" ? "财务主管" : null
    },
    lifecycleToken: "lifecycle-token",
    reviewAction: {
      key: "review_financing_quota",
      label: "审批垫资额度",
      kind: "primary",
      enabled: false,
      disabledReason: "当前不可审批",
      requiredAction: "project.financing_quota.approve",
      requiresPassword: true
    },
    terminateAction: {
      key: "terminate_financing_quota",
      label: "终止垫资额度",
      kind: "danger",
      enabled: false,
      disabledReason: "当前不可终止",
      requiredAction: "project.financing_quota.terminate",
      requiresPassword: true
    },
    usageGroups: []
  };
}

function workbench(
  projectId: string,
  options: {
    actionEnabled?: boolean;
    requiresFile?: boolean;
    rows?: ReturnType<typeof quotaRow>[];
  } = {}
): ProjectFinancingQuotaWorkbenchReadModel {
  return {
    project: { id: projectId, code: "JGXM-001", name: "项目一" },
    policy: {
      allocationOrder: ["project_cash", "financing_quota"],
      userSelectable: false
    },
    summary: {
      quotaAmountCents: "0",
      netUsedAmountCents: "0",
      currentlyAvailableAmountCents: "0"
    },
    requestAction: requestAction(
      options.actionEnabled ?? true,
      options.requiresFile ?? true
    ),
    rows: options.rows ?? []
  };
}

function uploadedFile(id = requestIdempotencyKey) {
  return {
    id,
    bucket: "private",
    objectKey: `uploads/${id}`,
    originalName: "financing.pdf",
    mimeType: "application/pdf",
    sizeBytes: 7,
    uploadedByUserId: "user-1",
    createdAt: "2026-08-02T00:00:00.000Z"
  };
}

function requestInput(context: { current: boolean }) {
  return {
    form: {
      amountYuan: "50000",
      reason: " 阶段性垫资保障项目付款 ",
      validUntil: ""
    },
    files: [{
      raw: new File(["voucher"], "financing.pdf", {
        type: "application/pdf"
      })
    }],
    idempotencyKey: requestIdempotencyKey,
    context,
    isCurrent: (candidate: { current: boolean }) => candidate.current
  };
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

describe("project financing quota API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("reads the project-scoped authoritative workbench", async () => {
    const workbench: ProjectFinancingQuotaWorkbenchReadModel = {
      project: { id: "project/1", code: "JGXM-001", name: "项目一" },
      policy: {
        allocationOrder: ["project_cash", "financing_quota"],
        userSelectable: false
      },
      summary: {
        quotaAmountCents: "0",
        netUsedAmountCents: "0",
        currentlyAvailableAmountCents: "0"
      },
      requestAction: {
        key: "request_financing_quota",
        label: "申请垫资额度",
        kind: "primary",
        enabled: false,
        disabledReason: "当前账号无项目垫资额度申请权限",
        requiredAction: "project.financing_quota.request"
      },
      rows: [{
        id: "quota-1",
        amountCents: "5000",
        reason: "保障现场付款",
        validUntil: null,
        status: "approved",
        statusLabel: "已批准",
        requestedByName: "财务员甲",
        approvedByName: "董事长甲",
        approvedAt: "2026-08-01T02:00:00.000Z",
        terminatedAt: null,
        terminatedByName: null,
        terminationReason: null,
        createdAt: "2026-08-01T01:00:00.000Z",
        updatedAt: "2026-08-01T02:00:00.000Z",
        isExpired: false,
        netUsedAmountCents: "1000",
        availableAmountCents: "4000",
        currentApproval: {
          status: "approved",
          currentNodeIndex: 2,
          currentNodeName: null
        },
        lifecycleToken: "lifecycle-token",
        reviewAction: {
          key: "review_financing_quota",
          label: "审批垫资额度",
          kind: "primary",
          enabled: false,
          disabledReason: "当前状态不可审批",
          requiredAction: "project.financing_quota.approve",
          requiresPassword: true
        },
        terminateAction: {
          key: "terminate_financing_quota",
          label: "终止垫资额度",
          kind: "danger",
          enabled: true,
          disabledReason: null,
          requiredAction: "project.financing_quota.terminate",
          requiresPassword: true,
          requiresSelfReviewConfirmation: false
        },
        usageGroups: [{
          executionType: "payment_execution",
          executionId: "execution-1",
          businessType: "payment_request",
          businessId: "payment-1",
          occurredAt: "2026-08-01T03:00:00.000Z",
          projectCashNetAmountCents: "6000",
          financingQuotaNetAmountCents: "1000",
          currentQuotaDebitAmountCents: "1000",
          currentQuotaCreditAmountCents: "0",
          currentQuotaNetAmountCents: "1000"
        }]
      }]
    };
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...workbench,
        readAt: "2026-08-01T03:00:00.000Z",
        summary: {
          ...workbench.summary,
          projectCashNetUsedAmountCents: "6000"
        },
        rows: workbench.rows.map((row) => ({
          ...row,
          currentApproval: row.currentApproval
            ? {
                ...row.currentApproval,
                updatedAt: "2026-08-01T02:00:00.000Z"
              }
            : null
        }))
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project/1"))
      .resolves.toMatchObject({ rows: [{ id: "quota-1" }] });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/projects/project%2F1/financing-quotas"
    );
  });

  it("keeps a forbidden project read fail-closed with structured status and code", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "PROJECT_SCOPE_FORBIDDEN",
          message: "无权读取该项目"
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1")).rejects.toMatchObject({
      status: 403,
      code: "PROJECT_SCOPE_FORBIDDEN"
    });
  });

  it("rejects a malformed successful payload before the page can render it", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "project-1", code: "JGXM-001", name: "项目一" },
          policy: {
            allocationOrder: ["project_cash", "financing_quota"],
            userSelectable: false
          },
          summary: {
            quotaAmountCents: 0,
            netUsedAmountCents: "0",
            currentlyAvailableAmountCents: "0"
          },
          requestAction: null,
          rows: "not-an-array"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1"))
      .rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
      });
  });

  it("rejects a valid-shaped payload belonging to another project", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "project-2", code: "JGXM-002", name: "项目二" },
          policy: {
            allocationOrder: ["project_cash", "financing_quota"],
            userSelectable: false
          },
          summary: {
            quotaAmountCents: "0",
            netUsedAmountCents: "0",
            currentlyAvailableAmountCents: "0"
          },
          requestAction: {
            key: "request_financing_quota",
            label: "申请垫资额度",
            kind: "primary",
            enabled: false,
            disabledReason: "无权申请",
            requiredAction: "project.financing_quota.request"
          },
          rows: []
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1"))
      .rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
      });
  });

  it("normalizes invalid JSON from a successful response to the controlled 502", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1"))
      .rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
      });
  });

  it("lets only the latest overview request commit after project switches or refreshes", () => {
    const owner = createProjectOverviewRequestOwner();
    const firstProjectA = owner.begin();
    const projectB = owner.begin();
    const secondProjectA = owner.begin();

    expect(owner.isCurrent(firstProjectA)).toBe(false);
    expect(owner.isCurrent(projectB)).toBe(false);
    expect(owner.isCurrent(secondProjectA)).toBe(true);

    owner.invalidate();
    expect(owner.isCurrent(secondProjectA)).toBe(false);
  });

  it("preflights before upload and POST, then accepts the authoritative created row", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project/1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project/1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project/1",
        quotaId: "quota-1"
      }, 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project/1", {
        rows: [quotaRow("quota-1")]
      })));

    const result = await requestProjectFinancingQuotaWithUpload(
      "project/1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    );

    expect(result.receipt.kind).toBe("created");
    expect(result.workbench.rows.map((row) => row.id)).toEqual(["quota-1"]);
    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/projects/project%2F1/financing-quotas",
      "/files",
      "/projects/project%2F1/financing-quotas",
      "/projects/project%2F1/financing-quotas",
      "/projects/project%2F1/financing-quotas"
    ]);
    const uploadBody = mockApiFetch.mock.calls[1]?.[1]?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect((uploadBody as FormData).get("idempotencyKey")).toBe(
      requestIdempotencyKey
    );
    expect((uploadBody as FormData).get("file")).toBeInstanceOf(File);
    expect(mockApiFetch.mock.calls[3]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        amountCents: "5000000",
        reason: "阶段性垫资保障项目付款",
        attachmentFileId: requestIdempotencyKey,
        idempotencyKey: requestIdempotencyKey
      })
    });
  });

  it("shares one in-flight promise across double submit", async () => {
    const context = { current: true };
    const upload = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockReturnValueOnce(upload.promise)
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-1"
      }, 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1")]
      })));
    const state = createProjectFinancingQuotaRequestAttemptState();
    const input = requestInput(context);

    const first = requestProjectFinancingQuotaWithUpload("project-1", input, state);
    const second = requestProjectFinancingQuotaWithUpload("project-1", input, state);

    expect(second).toBe(first);
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) => call[0] === "/files"))
        .toHaveLength(1);
    });
    upload.resolve(jsonResponse(uploadedFile(), 201));
    await expect(first).resolves.toMatchObject({ receipt: { quotaId: "quota-1" } });
    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(1);
  });

  it("retries an unknown POST with the same key and uploaded file", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockRejectedValueOnce(new TypeError("network result unknown"))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "replayed",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1")]
      })));
    const state = createProjectFinancingQuotaRequestAttemptState();
    const input = requestInput(context);

    await expect(
      requestProjectFinancingQuotaWithUpload("project-1", input, state)
    ).rejects.toThrow("network result unknown");
    await expect(
      requestProjectFinancingQuotaWithUpload("project-1", input, state)
    ).resolves.toMatchObject({ receipt: { kind: "replayed" } });

    expect(mockApiFetch.mock.calls.filter((call) => call[0] === "/files"))
      .toHaveLength(1);
    const postBodies = mockApiFetch.mock.calls
      .filter(
        (call) => call[0] === "/projects/project-1/financing-quotas" &&
          call[1]?.method === "POST"
      )
      .map((call) => call[1]?.body);
    expect(postBodies).toEqual([
      expect.stringContaining(requestIdempotencyKey),
      expect.stringContaining(requestIdempotencyKey)
    ]);
  });

  it("accepts the authoritative row when approval advances before replay refresh", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "replayed",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approved")]
      })));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).resolves.toMatchObject({
      receipt: { kind: "replayed", quotaId: "quota-1" },
      workbench: { rows: [{ id: "quota-1", status: "approved" }] }
    });
  });

  it("does not POST after the frozen project context is invalidated during upload", async () => {
    const context = { current: true };
    const upload = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockReturnValueOnce(upload.promise);

    const request = requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    );
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) => call[0] === "/files"))
        .toHaveLength(1);
    });
    context.current = false;
    upload.resolve(jsonResponse(uploadedFile(), 201));

    await expect(request).rejects.toThrow("上下文已失效");
    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(0);
  });

  it("stops before POST when the fresh server action drifts after upload", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        actionEnabled: false
      })));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toThrow("申请资格已变化");

    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(0);
  });

  it("stops before POST when the fresh server action namespace drifts after upload", async () => {
    const context = { current: true };
    const drifted = workbench("project-1");
    drifted.requestAction.requiredAction = "project.financing_quota.approve";
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(drifted));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toThrow("申请资格已变化");

    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(0);
  });

  it("fails closed on a mismatched receipt or an authoritative refresh without the quota", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        projectId: "project-1",
        quotaId: "quota-1"
      }, 201));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toMatchObject({
      status: 502,
      code: "PROJECT_FINANCING_QUOTA_INVALID_REQUEST_RESPONSE"
    });

    mockApiFetch.mockReset();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-missing"
      }, 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toThrow("权威台账未包含本次申请");
  });
});
