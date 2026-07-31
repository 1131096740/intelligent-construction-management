import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../api/api-fetch";
import {
  createProjectExpenseReceiptConfirmationAttemptState,
  confirmProjectExpenseReceiptWithPreflight,
  projectExpenseReceiptCompletionIsAuthoritative,
  type ProjectExpenseApprovalLifecycleDetailReadModel
} from "../../api/core-flow-read.api";

vi.mock("../../api/api-fetch", () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const initialUpdatedAt = "2026-08-01T03:00:00.000Z";
const completedUpdatedAt = "2026-08-01T03:00:02.000Z";
const idempotencyKey = "6e8fab4b-9e90-4fba-a59d-320cd24cc427";

function receiptDetail(
  confirmed = false,
  overrides: Partial<ProjectExpenseApprovalLifecycleDetailReadModel> = {}
): ProjectExpenseApprovalLifecycleDetailReadModel {
  const lifecycleUpdatedAt = confirmed ? completedUpdatedAt : initialUpdatedAt;
  return {
    id: "expense-1",
    projectId: "project-1",
    code: "CG-2026-001",
    title: "CG-2026-001 · 项目零星采购",
    status: "paid",
    statusLabel: "已付款",
    expenseTypeLabel: "零星采购",
    expenseSubtypeLabel: "零星材料采购",
    paymentSubject: "现场零星材料",
    reason: "现场急用",
    requestedAmountCents: "50000",
    approvedAmountCents: "50000",
    paidAmountCents: "50000",
    remainingAmountCents: "0",
    financeRecordedAmountCents: "50000",
    financeRemainingAmountCents: "0",
    receiptConfirmedAt: confirmed ? "2026-08-01T03:00:01.000Z" : null,
    receiptConfirmedByUserId: confirmed ? "material-user-1" : null,
    receiptConfirmationIdempotencyKey: confirmed ? idempotencyKey : null,
    receiptConfirmationNote: confirmed ? "数量与质量无误" : null,
    currentNodeName: null,
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批项目支出",
      kind: "primary",
      enabled: false,
      disabledReason: "当前项目支出状态不可审批"
    },
    approvalTimeline: [],
    executionContext: null,
    financeContext: null,
    receiptContext: confirmed ? null : { expectedExpenseUpdatedAt: initialUpdatedAt },
    lifecycleUpdatedAt,
    hasPersistentDraft: false,
    availableActions: confirmed
      ? []
      : [
          {
            key: "confirm_receipt",
            label: "确认收货",
            kind: "primary",
            enabled: true,
            disabledReason: null,
            requiredAction: "project_expense.receipt_confirm",
            requiresPassword: true
          }
        ],
    blockedReasons: confirmed ? ["零星采购已确认收货"] : [],
    reviewApprovalContext: null,
    withdrawalContext: null,
    ...overrides
  };
}

function receiptResponse(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    expenseRequestId: "expense-1",
    idempotencyKey,
    confirmedByUserId: "material-user-1",
    confirmedAt: "2026-08-01T03:00:01.000Z",
    note: "数量与质量无误",
    updatedAt: completedUpdatedAt,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function receiptInput(password = "current-password") {
  return {
    confirmationPassword: password,
    note: "数量与质量无误",
    expectedExpenseUpdatedAt: initialUpdatedAt,
    idempotencyKey,
    context: { active: true },
    isCurrent: (candidate: { active: boolean }) => candidate.active
  };
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("project expense receipt confirmation action", () => {
  it("preflights one raw server capability and posts one frozen CAS/idempotency fact", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(receiptDetail()))
      .mockResolvedValueOnce(jsonResponse(receiptResponse()));
    const state = createProjectExpenseReceiptConfirmationAttemptState();

    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        receiptInput(),
        state
      )
    ).resolves.toEqual(receiptResponse());

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/projects/project-1/expense-requests/expense-1/approval-detail",
      "/projects/project-1/expense-requests/expense-1/receipt-confirmation"
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      confirmationPassword: "current-password",
      note: "数量与质量无误",
      expectedExpenseUpdatedAt: initialUpdatedAt,
      idempotencyKey
    });
  });

  it("coalesces rapid confirms into one fresh GET and one POST", async () => {
    let releasePost: ((response: Response) => void) | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(receiptDetail()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releasePost = resolve;
          })
      );
    const state = createProjectExpenseReceiptConfirmationAttemptState();
    const input = receiptInput();

    const first = confirmProjectExpenseReceiptWithPreflight(
      "project-1",
      "expense-1",
      input,
      state
    );
    const duplicate = confirmProjectExpenseReceiptWithPreflight(
      "project-1",
      "expense-1",
      input,
      state
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    releasePost?.(jsonResponse(receiptResponse()));

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      receiptResponse(),
      receiptResponse()
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/receipt-confirmation")
      )
    ).toHaveLength(1);
  });

  it("replays an ambiguous failure with the original fact and UUID", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(receiptDetail()))
      .mockResolvedValueOnce(jsonResponse({ message: "服务暂不可用" }, 503))
      .mockResolvedValueOnce(jsonResponse(receiptResponse()));
    const state = createProjectExpenseReceiptConfirmationAttemptState();
    const input = receiptInput();

    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        input,
        state
      )
    ).rejects.toThrow("服务暂不可用");
    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        {
          ...input,
          note: "不得替换的备注",
          expectedExpenseUpdatedAt: completedUpdatedAt,
          idempotencyKey: "31849847-627f-40b5-bc8c-6293f766afce"
        },
        state
      )
    ).resolves.toEqual(receiptResponse());

    const bodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/receipt-confirmation"))
      .map(([, options]) => JSON.parse(String(options?.body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/approval-detail"))
    ).toHaveLength(1);
  });

  it("replaces only a rejected password while preserving the receipt fact", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(receiptDetail()))
      .mockResolvedValueOnce(jsonResponse({ message: "当前密码不正确" }, 400))
      .mockResolvedValueOnce(jsonResponse(receiptResponse()));
    const state = createProjectExpenseReceiptConfirmationAttemptState();
    const input = receiptInput("wrong-password");

    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        input,
        state
      )
    ).rejects.toThrow("当前密码不正确");
    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        {
          ...input,
          confirmationPassword: "correct-password",
          note: "不得替换的备注",
          idempotencyKey: "31849847-627f-40b5-bc8c-6293f766afce"
        },
        state
      )
    ).resolves.toEqual(receiptResponse());

    const bodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/receipt-confirmation"))
      .map(([, options]) => JSON.parse(String(options?.body)));
    expect(bodies[1]).toEqual({
      ...bodies[0],
      confirmationPassword: "correct-password"
    });
  });

  it("rejects a 200 response that does not prove the persisted receipt fact", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(receiptDetail()))
      .mockResolvedValueOnce(
        jsonResponse(receiptResponse({ idempotencyKey: "wrong-key" }))
      );

    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        receiptInput(),
        createProjectExpenseReceiptConfirmationAttemptState()
      )
    ).rejects.toThrow("项目支出收货确认响应与本次持久事实不一致");
  });

  it("restarts after a deterministic conflict and requires a new fresh capability", async () => {
    const nextUpdatedAt = "2026-08-01T03:00:03.000Z";
    const nextKey = "31849847-627f-40b5-bc8c-6293f766afce";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(receiptDetail()))
      .mockResolvedValueOnce(
        jsonResponse({ code: "PROJECT_EXPENSE_STALE", message: "项目支出版本已变化" }, 409)
      )
      .mockResolvedValueOnce(
        jsonResponse(
          receiptDetail(false, {
            lifecycleUpdatedAt: nextUpdatedAt,
            receiptContext: { expectedExpenseUpdatedAt: nextUpdatedAt }
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          receiptResponse({
            idempotencyKey: nextKey,
            note: "重新确认",
            updatedAt: "2026-08-01T03:00:04.000Z"
          })
        )
      );
    const state = createProjectExpenseReceiptConfirmationAttemptState();

    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        receiptInput(),
        state
      )
    ).rejects.toMatchObject({ status: 409, code: "PROJECT_EXPENSE_STALE" });
    await expect(
      confirmProjectExpenseReceiptWithPreflight(
        "project-1",
        "expense-1",
        {
          ...receiptInput(),
          note: "重新确认",
          expectedExpenseUpdatedAt: nextUpdatedAt,
          idempotencyKey: nextKey
        },
        state
      )
    ).resolves.toMatchObject({ idempotencyKey: nextKey, note: "重新确认" });

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/approval-detail"))
    ).toHaveLength(2);
  });

  it("accepts only the authoritative completion for the submitted UUID", () => {
    const baseline = {
      projectId: "project-1",
      expenseRequestId: "expense-1",
      expectedExpenseUpdatedAt: initialUpdatedAt,
      idempotencyKey
    };

    expect(
      projectExpenseReceiptCompletionIsAuthoritative(
        receiptDetail(true),
        baseline,
        receiptResponse()
      )
    ).toBe(true);
    expect(
      projectExpenseReceiptCompletionIsAuthoritative(
        receiptDetail(true, { receiptConfirmationIdempotencyKey: "wrong-key" }),
        baseline,
        receiptResponse()
      )
    ).toBe(false);
    expect(
      projectExpenseReceiptCompletionIsAuthoritative(
        receiptDetail(true, {
          receiptContext: { expectedExpenseUpdatedAt: completedUpdatedAt },
          availableActions: [
            {
              key: "confirm_receipt",
              label: "确认收货",
              kind: "primary",
              enabled: true,
              disabledReason: null
            }
          ]
        }),
        baseline,
        receiptResponse()
      )
    ).toBe(false);
    expect(
      projectExpenseReceiptCompletionIsAuthoritative(
        receiptDetail(true, {
          receiptConfirmedAt: "2026-08-01T03:00:01.500Z"
        }),
        baseline,
        receiptResponse()
      )
    ).toBe(false);
    expect(
      projectExpenseReceiptCompletionIsAuthoritative(
        receiptDetail(true, {
          receiptConfirmedByUserId: "other-user",
          receiptConfirmationNote: "其他备注"
        }),
        baseline,
        receiptResponse()
      )
    ).toBe(false);
    expect(
      projectExpenseReceiptCompletionIsAuthoritative(
        receiptDetail(true, {
          lifecycleUpdatedAt: "2026-08-01T03:00:01.999Z"
        }),
        baseline,
        receiptResponse()
      )
    ).toBe(false);
  });

  it("moves the trigger to the server-derived detail page and removes the overview local gate", () => {
    const detailSource = fs.readFileSync(
      path.resolve(__dirname, "ProjectExpenseApprovalDetailPage.vue"),
      "utf8"
    );
    const overviewSource = fs.readFileSync(
      path.resolve(__dirname, "ProjectOperatingOverviewPage.vue"),
      "utf8"
    );

    expect(detailSource).toContain('action.key === "confirm_receipt"');
    expect(detailSource).toContain("receiptContext");
    expect(detailSource).toContain("confirmProjectExpenseReceiptWithPreflight");
    expect(detailSource).toContain('@confirm="confirmProjectExpenseReceipt"');
    expect(detailSource).toContain("projectExpenseReceiptCompletionIsAuthoritative(");
    expect(detailSource).toContain("projectExpenseReceiptFailureDisposition(error)");
    expect(detailSource).not.toMatch(/\bfetch\s*\(/u);
    expect(overviewSource).not.toContain("canConfirmExpenseReceipt");
    expect(overviewSource).not.toContain("submitExpenseReceiptConfirmation");
    expect(overviewSource).not.toContain("receiptConfirmationPassword");
    expect(overviewSource).toContain("row.isReceiptConfirmed");
  });
});
