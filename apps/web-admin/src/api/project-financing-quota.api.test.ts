import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectOverviewRequestOwner,
  fetchProjectFinancingQuotaWorkbench,
  type ProjectFinancingQuotaWorkbenchReadModel
} from "./project-financing-quota.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

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
});
