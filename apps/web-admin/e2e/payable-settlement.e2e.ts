import { expect, test, type Page, type Route } from "@playwright/test";

type CapturedRequest = {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
};

type WorkbenchStatus = "draft" | "submitted" | "confirmed";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function workbenchRow(status: WorkbenchStatus) {
  const revision = status === "draft" ? 1 : status === "submitted" ? 2 : 3;
  const statusLabel = status === "draft" ? "草稿" : status === "submitted" ? "已提交" : "已确认";
  return {
    settlementCaseId: `settlement-case-${status}`,
    status,
    statusLabel,
    revision,
    allocatedAmountCents: "10000",
    createdAt: "2026-08-27T17:00:00.000Z",
    submittedAt: status === "draft" ? null : "2026-08-27T17:10:00.000Z",
    confirmedAt: status === "confirmed" ? "2026-08-27T17:20:00.000Z" : null,
    updatedAt: `2026-08-27T17:${revision}0:00.000Z`
  };
}

async function installHarness(page: Page, staleWageCapabilities = false) {
  const requests: CapturedRequest[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
      accessToken: "payable-settlement-e2e-access-token",
      refreshToken: "payable-settlement-e2e-refresh-token",
      user: {
        id: "finance-director-e2e",
        name: "工资核销验收财务主管",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["finance_director"],
        globalRoleKeys: ["finance_director"]
      }
    }));
  });

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(/^\/api/u, "");
    const captured: CapturedRequest = { method: request.method(), pathname };
    if (request.postData()) {
      try {
        captured.body = request.postDataJSON() as Record<string, unknown>;
      } catch {
        // Multipart evidence upload is intentionally captured without decoding
        // the private file payload in this non-production browser harness.
      }
    }
    requests.push(captured);

    if (pathname === "/me/work-items") {
      return json(route, {
        generatedAt: "2026-08-27T17:00:00.000Z",
        visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      });
    }
    if (pathname === "/approval-delegations/user-options") return json(route, []);
    if (pathname === "/payable-settlements/capabilities") {
      return json(route, {
        read: true,
        allocate: staleWageCapabilities,
        submit: staleWageCapabilities,
        confirm: staleWageCapabilities,
        return: staleWageCapabilities,
        returnRelationship: true
      });
    }
    if (pathname === "/payable-settlements/wage-payable-cases") {
      return json(route, [{
        payableRef: "payable-safe-1",
        caseRevision: 3,
        displayLabel: "XM-01 · 工资代发机构",
        debtorCompanyLabel: "甲公司",
        creditorLabel: "工资代发机构",
        status: "allocatable",
        statusLabel: "历史余额",
        remainingAmountCents: "10000",
        overSettledAmountCents: "0"
      }]);
    }
    if (pathname === "/payable-settlements/workbench") {
      return json(route, [workbenchRow("draft"), workbenchRow("submitted"), workbenchRow("confirmed")]);
    }
    if (pathname === "/payable-settlements/inter-entity-relationships") {
      return json(route, [{
        relationshipEntryId: "relationship-e2e",
        debtorLabel: "原债务公司",
        creditorLabel: "实际付款公司",
        approvedPayerLabel: "批准付款公司",
        amountCents: "10000",
        remainingAmountCents: "10000",
        status: "open",
        statusLabel: "未结"
      }]);
    }
    if (pathname.startsWith("/company-transfers/") || pathname === "/company-transfers") {
      return json(route, []);
    }
    return json(route, { message: `未登记的动态验收接口：${request.method()} ${pathname}` }, 501);
  });

  return requests;
}

test.describe("工资应付历史与跨主体往来", () => {
  test.setTimeout(60_000);

  test("显示历史工资应付和核销记录，忽略过期的可写能力", async ({ page }) => {
    const requests = await installHarness(page, true);

    await page.goto("/工资应付核销工作台");
    await expect(page.getByRole("heading", { name: "历史工资应付核销" })).toBeVisible();
    await expect(page.getByText("XM-01 · 工资代发机构", { exact: true })).toBeVisible();
    await expect(page.getByText("草稿", { exact: true })).toBeVisible();
    await expect(page.getByText("已提交", { exact: true })).toBeVisible();
    await expect(page.getByText("已确认", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存核销草稿" })).toHaveCount(0);
    for (const name of ["提交", "确认", "退回"]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    expect(requests.filter((request) => request.pathname.startsWith("/payable-settlements/"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "GET", pathname: "/payable-settlements/workbench" })])
    );
    expect(requests.some((request) =>
      request.pathname.startsWith("/payable-settlements/") &&
      (request.method !== "GET" || request.pathname.endsWith("/payment-execution-candidates"))
    )).toBe(false);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("paymentExecutionId");
    expect(visibleText).not.toContain("PaymentExecution");
  });

  test("工资核销停止后仍可从历史代付往来进入归还台账", async ({ page }) => {
    await installHarness(page);

    await page.goto("/工资应付核销工作台");
    await expect(page.getByText("实际付款公司", { exact: true })).toBeVisible();
    await page.getByText("追加归还", { exact: true }).click();
    await expect(page).toHaveURL((url) =>
      decodeURIComponent(url.pathname) === "/公司互转台账" &&
      url.searchParams.get("originalInterEntityRelationshipId") === "relationship-e2e"
    );
  });
});
