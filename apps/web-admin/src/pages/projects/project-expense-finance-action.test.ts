import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../api/api-fetch";
import {
  createProjectExpenseFinanceRecordAttemptState,
  projectExpenseFinanceCompletionIsAuthoritative,
  recordProjectExpenseFinanceWithPreflight,
  type ProjectExpenseApprovalLifecycleDetailReadModel
} from "../../api/core-flow-read.api";

vi.mock("../../api/api-fetch", () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

function financeDetail(
  expectedExpenseUpdatedAt =
    "2026-07-31T03:00:00.000Z"
): ProjectExpenseApprovalLifecycleDetailReadModel {
  return {
    id: "expense-1",
    projectId: "project-1",
    code: "BX-2026-001",
    title: "BX-2026-001 · 项目报销",
    status: "paid",
    statusLabel: "已付款",
    expenseTypeLabel: "报销",
    expenseSubtypeLabel: "报销",
    paymentSubject: "建工智管",
    reason: "项目费用",
    requestedAmountCents: "50000",
    approvedAmountCents: "50000",
    paidAmountCents: "50000",
    remainingAmountCents: "0",
    financeRecordedAmountCents: "20000",
    financeRemainingAmountCents: "30000",
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
    financeContext: { expectedExpenseUpdatedAt },
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    hasPersistentDraft: false,
    availableActions: [
      {
        key: "record_finance",
        label: "财务入账",
        kind: "primary",
        enabled: true,
        disabledReason: null,
        requiredAction: "project_expense.finance_record",
        requiresPassword: true
      }
    ],
    blockedReasons: [],
    reviewApprovalContext: null,
    withdrawalContext: null
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function financeRecord(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "finance-record-1",
    idempotencyKey:
      "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
    projectId: "project-1",
    projectExpenseRequestId: "expense-1",
    paymentRequestId: null,
    settlementId: null,
    direction: "outflow",
    amountCents: "30000",
    occurredAt: "2026-07-31T03:00:01.000Z",
    createdByUserId: "finance-user-1",
    ...overrides
  };
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("project expense finance action", () => {
  it("uses a fresh server capability and sends one frozen CAS/idempotency fact", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(financeDetail()))
      .mockResolvedValueOnce(
        jsonResponse(financeRecord())
      );
    const state =
      createProjectExpenseFinanceRecordAttemptState();
    const context = { active: true };

    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        {
          amountCents: "30000",
          occurredAt: "2026-07-31T03:00:01.000Z",
          confirmationPassword: "current-password",
          expectedExpenseUpdatedAt:
            "2026-07-31T03:00:00.000Z",
          idempotencyKey:
            "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
          context,
          isCurrent: (candidate) => candidate.active
        },
        state
      )
    ).resolves.toEqual(
      expect.objectContaining({ id: "finance-record-1" })
    );

    expect(
      fetchMock.mock.calls.map(([url]) => String(url))
    ).toEqual([
      "/projects/project-1/expense-requests/expense-1/approval-detail",
      "/projects/project-1/expense-requests/expense-1/finance-records"
    ]);
    expect(
      JSON.parse(
        String(fetchMock.mock.calls[1]?.[1]?.body)
      )
    ).toEqual({
      amountCents: "30000",
      occurredAt: "2026-07-31T03:00:01.000Z",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:00.000Z",
      idempotencyKey:
        "6e8fab4b-9e90-4fba-a59d-320cd24cc427"
    });
  });

  it("coalesces a double confirm into one POST", async () => {
    let releasePost:
      | ((response: Response) => void)
      | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(financeDetail()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releasePost = resolve;
          })
      );
    const state =
      createProjectExpenseFinanceRecordAttemptState();
    const input = {
      amountCents: "30000",
      occurredAt: "2026-07-31T03:00:01.000Z",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:00.000Z",
      idempotencyKey:
        "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
      context: { active: true },
      isCurrent: (candidate: { active: boolean }) =>
        candidate.active
    };

    const first = recordProjectExpenseFinanceWithPreflight(
      "project-1",
      "expense-1",
      input,
      state
    );
    const duplicate =
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        input,
        state
      );
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(2)
    );
    const persistedRecord = financeRecord();
    releasePost?.(jsonResponse(persistedRecord));

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      persistedRecord,
      persistedRecord
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/finance-records")
      )
    ).toHaveLength(1);
  });

  it("retries an observable archive failure with the same frozen idempotency key", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(financeDetail()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            message:
              "财务入账已保存，但财务归档生成未完成；请使用同一操作直接重试"
          },
          503
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(financeRecord())
      );
    const state =
      createProjectExpenseFinanceRecordAttemptState();
    const input = {
      amountCents: "30000",
      occurredAt: "2026-07-31T03:00:01.000Z",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:00.000Z",
      idempotencyKey:
        "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
      context: { active: true },
      isCurrent: (candidate: { active: boolean }) =>
        candidate.active
    };

    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        input,
        state
      )
    ).rejects.toThrow("财务入账已保存");
    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        {
          ...input,
          amountCents: "99999",
          occurredAt: "2026-07-31T03:59:59.000Z",
          idempotencyKey:
            "31849847-627f-40b5-bc8c-6293f766afce"
        },
        state
      )
    ).resolves.toEqual(financeRecord());

    const postBodies = fetchMock.mock.calls
      .filter(([url]) =>
        String(url).endsWith("/finance-records")
      )
      .map(([, options]) =>
        JSON.parse(String(options?.body))
      );
    expect(postBodies).toHaveLength(2);
    expect(postBodies[1]).toEqual(postBodies[0]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/approval-detail")
      )
    ).toHaveLength(1);
  });

  it("replaces only the rejected password while reusing the frozen finance fact", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(financeDetail()))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "当前密码不正确" },
          400
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(financeRecord())
      );
    const state =
      createProjectExpenseFinanceRecordAttemptState();
    const input = {
      amountCents: "30000",
      occurredAt: "2026-07-31T03:00:01.000Z",
      confirmationPassword: "wrong-password",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:00.000Z",
      idempotencyKey:
        "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
      context: { active: true },
      isCurrent: (candidate: { active: boolean }) =>
        candidate.active
    };

    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        input,
        state
      )
    ).rejects.toThrow("当前密码不正确");
    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        {
          ...input,
          amountCents: "99999",
          occurredAt: "2026-07-31T03:59:59.000Z",
          confirmationPassword: "correct-password",
          idempotencyKey:
            "31849847-627f-40b5-bc8c-6293f766afce"
        },
        state
      )
    ).resolves.toEqual(financeRecord());

    const postBodies = fetchMock.mock.calls
      .filter(([url]) =>
        String(url).endsWith("/finance-records")
      )
      .map(([, options]) =>
        JSON.parse(String(options?.body))
      );
    expect(postBodies).toHaveLength(2);
    expect(postBodies[1]).toEqual({
      ...postBodies[0],
      confirmationPassword: "correct-password"
    });
  });

  it("rejects a successful response that does not prove the frozen persisted fact", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(financeDetail()))
      .mockResolvedValueOnce(
        jsonResponse(
          financeRecord({ amountCents: "29999" })
        )
      );

    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        {
          amountCents: "30000",
          occurredAt: "2026-07-31T03:00:01.000Z",
          confirmationPassword: "current-password",
          expectedExpenseUpdatedAt:
            "2026-07-31T03:00:00.000Z",
          idempotencyKey:
            "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
          context: { active: true },
          isCurrent: (candidate) => candidate.active
        },
        createProjectExpenseFinanceRecordAttemptState()
      )
    ).rejects.toThrow(
      "项目支出财务入账响应与本次持久事实不一致"
    );
  });

  it("invalidates a deterministic conflict and performs a fresh preflight for a new confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(financeDetail()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            statusCode: 409,
            code: "PROJECT_EXPENSE_STALE",
            message: "项目支出版本已变化，请刷新后重试"
          },
          409
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          financeDetail("2026-07-31T03:00:02.000Z")
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          financeRecord({
            id: "finance-record-2",
            idempotencyKey:
              "31849847-627f-40b5-bc8c-6293f766afce",
            amountCents: "25000",
            occurredAt: "2026-07-31T03:00:03.000Z"
          })
        )
      );
    const state =
      createProjectExpenseFinanceRecordAttemptState();
    const firstInput = {
      amountCents: "30000",
      occurredAt: "2026-07-31T03:00:01.000Z",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:00.000Z",
      idempotencyKey:
        "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
      context: { active: true },
      isCurrent: (candidate: { active: boolean }) =>
        candidate.active
    };

    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        firstInput,
        state
      )
    ).rejects.toMatchObject({
      name: "CoreFlowApiError",
      status: 409,
      code: "PROJECT_EXPENSE_STALE",
      message: "项目支出版本已变化，请刷新后重试"
    });
    await expect(
      recordProjectExpenseFinanceWithPreflight(
        "project-1",
        "expense-1",
        {
          ...firstInput,
          amountCents: "25000",
          occurredAt: "2026-07-31T03:00:03.000Z",
          expectedExpenseUpdatedAt:
            "2026-07-31T03:00:02.000Z",
          idempotencyKey:
            "31849847-627f-40b5-bc8c-6293f766afce"
        },
        state
      )
    ).resolves.toEqual(
      financeRecord({
        id: "finance-record-2",
        idempotencyKey:
          "31849847-627f-40b5-bc8c-6293f766afce",
        amountCents: "25000",
        occurredAt: "2026-07-31T03:00:03.000Z"
      })
    );

    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/approval-detail")
      )
    ).toHaveLength(2);
    const postBodies = fetchMock.mock.calls
      .filter(([url]) =>
        String(url).endsWith("/finance-records")
      )
      .map(([, options]) =>
        JSON.parse(String(options?.body))
      );
    expect(postBodies[1]).toEqual({
      amountCents: "25000",
      occurredAt: "2026-07-31T03:00:03.000Z",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:02.000Z",
      idempotencyKey:
        "31849847-627f-40b5-bc8c-6293f766afce"
    });
  });

  it("accepts a monotonic authoritative superset and rejects inconsistent finance totals", () => {
    const baseline = {
      projectId: "project-1",
      expenseRequestId: "expense-1",
      expectedExpenseUpdatedAt:
        "2026-07-31T03:00:00.000Z",
      expectedPaidAmountCents: "50000",
      expectedFinanceRecordedAmountCents: "20000",
      expectedFinanceRemainingAmountCents: "30000",
      amountCents: "10000"
    };
    const concurrentSuperset = {
      ...financeDetail("2026-07-31T03:00:04.000Z"),
      paidAmountCents: "70000",
      financeRecordedAmountCents: "45000",
      financeRemainingAmountCents: "25000"
    };

    expect(
      projectExpenseFinanceCompletionIsAuthoritative(
        concurrentSuperset,
        baseline
      )
    ).toBe(true);
    expect(
      projectExpenseFinanceCompletionIsAuthoritative(
        {
          ...concurrentSuperset,
          financeRemainingAmountCents: "24000"
        },
        baseline
      )
    ).toBe(false);
    expect(
      projectExpenseFinanceCompletionIsAuthoritative(
        {
          ...concurrentSuperset,
          financeRecordedAmountCents: "25000",
          financeRemainingAmountCents: "45000"
        },
        baseline
      )
    ).toBe(false);
  });

  it("keeps the detail page server-derived and removes the overview local finance gate", () => {
    const detailSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "ProjectExpenseApprovalDetailPage.vue"
      ),
      "utf8"
    );
    const overviewSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "ProjectOperatingOverviewPage.vue"
      ),
      "utf8"
    );

    expect(detailSource).toContain(
      'action.key === "record_finance"'
    );
    expect(detailSource).toContain(
      "recordProjectExpenseFinanceWithPreflight"
    );
    expect(detailSource).toContain(
      "confirmProjectExpenseFinance"
    );
    expect(detailSource).toContain(
      "projectExpenseFinanceCompletionIsAuthoritative("
    );
    expect(detailSource).toContain(
      "projectExpenseFinanceFailureDisposition(error)"
    );
    expect(detailSource).toContain(
      "权威状态可能已变化，已刷新，请重新确认"
    );
    expect(detailSource).toContain(
      "支出全额实付且入账完整覆盖后会生成财务归档"
    );
    expect(detailSource).not.toMatch(/\bfetch\s*\(/u);
    expect(overviewSource).not.toContain(
      "canRecordExpenseFinance"
    );
    expect(overviewSource).not.toContain(
      "submitExpenseFinance"
    );
    expect(overviewSource).toContain(
      "['approval_pending', 'approved_pending_payment', 'partially_paid', 'paid', 'payment_blocked'].includes"
    );
  });
});
