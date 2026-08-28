import { expect, test, type Page, type Route } from "@playwright/test";

type CapturedRequest = {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
};

type WorkbenchStatus = "empty" | "draft" | "submitted" | "confirmed";

const expiresAt = "2026-08-27T17:55:00.000Z";
const selectionRef = "pes1.opaque-selection-reference";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function workbenchRow(status: Exclude<WorkbenchStatus, "empty">) {
  const revision = status === "draft" ? 1 : status === "submitted" ? 2 : 3;
  const statusLabel = status === "draft" ? "草稿" : status === "submitted" ? "已提交" : "已确认";
  return {
    settlementCaseId: "settlement-case-e2e",
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

async function installHarness(page: Page) {
  const requests: CapturedRequest[] = [];
  let status: WorkbenchStatus = "empty";

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

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(/^\/api/u, "");
    const captured: CapturedRequest = { method: request.method(), pathname };
    if (request.postData()) captured.body = request.postDataJSON() as Record<string, unknown>;
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
      return json(route, { read: true, allocate: true, submit: true, confirm: true, return: true });
    }
    if (pathname === "/payable-settlements/wage-payable-cases") {
      return json(route, [{
        payableRef: "payable-safe-1",
        caseRevision: 3,
        displayLabel: "XM-01 · 工资代发机构",
        debtorCompanyLabel: "甲公司",
        creditorLabel: "工资代发机构",
        status: "allocatable",
        statusLabel: "可核销",
        remainingAmountCents: "10000",
        overSettledAmountCents: "0"
      }]);
    }
    if (pathname === "/payable-settlements/wage-payable-cases/payable-safe-1/payment-execution-candidates") {
      return json(route, {
        caseRevision: 3,
        expiresAt,
        candidates: [{
          selectionRef,
          expiresAt,
          displayLabel: "2026-08-27 · 甲公司 · 候选01",
          executedAt: "2026-08-27T16:00:00.000Z",
          payerLabel: "甲公司",
          statusLabel: "已执行",
          availableAmountCents: "10000"
        }]
      });
    }
    if (pathname === "/payable-settlements/workbench") {
      return json(route, status === "empty" ? [] : [workbenchRow(status)]);
    }
    if (
      pathname === "/payable-settlements/wage-payable-cases/payable-safe-1/allocations" &&
      request.method() === "POST"
    ) {
      status = "draft";
      return json(route, workbenchRow(status));
    }
    if (pathname === "/payable-settlements/settlement-case-e2e/submit" && request.method() === "POST") {
      status = "submitted";
      return json(route, workbenchRow(status));
    }
    if (pathname === "/payable-settlements/settlement-case-e2e/confirm" && request.method() === "POST") {
      status = "confirmed";
      return json(route, workbenchRow(status));
    }

    return json(route, { message: `未登记的动态验收接口：${request.method()} ${pathname}` }, 501);
  });

  return requests;
}

function mutationRequest(requests: CapturedRequest[], suffix: string) {
  const request = requests.find((item) => item.method === "POST" && item.pathname.endsWith(suffix));
  expect(request, `应调用 ${suffix}`).toBeDefined();
  return request!;
}

function expectFreshCapabilityBefore(requests: CapturedRequest[], mutation: CapturedRequest) {
  const mutationIndex = requests.indexOf(mutation);
  expect(mutationIndex).toBeGreaterThan(0);
  expect(requests[mutationIndex - 1]).toMatchObject({
    method: "GET",
    pathname: "/payable-settlements/capabilities"
  });
}

async function clickTableAction(page: Page, name: "提交" | "确认") {
  const action = page.getByRole("table").getByText(name, { exact: true });
  await action.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  await action.click();
}

test.describe("#220 工资应付核销非生产动态验收", () => {
  test.setTimeout(60_000);

  test("使用 opaque selectionRef 完成真实候选选择、提交和确认闭环", async ({ page }) => {
    const requests = await installHarness(page);

    await page.goto("/工资应付核销工作台");
    await expect(page.getByRole("heading", { name: "工资应付核销工作台" })).toBeVisible();
    await expect(page.getByRole("textbox", {
      name: "选择已确认且仍有余额的工资应付案件"
    })).toHaveValue("XM-01 · 工资代发机构 · 可核销 100.00 元");

    const candidateSelect = page.getByRole("textbox", {
      name: "选择服务端当前允许核销的付款"
    });
    await candidateSelect.click();
    await page.getByText("2026-08-27 · 甲公司 · 候选01 · 可用 100.00 元", { exact: true }).click();
    await page.getByPlaceholder("例如 4000.00").fill("100.00");
    await page.getByRole("button", { name: "保存核销草稿" }).click();

    await expect(page.getByText("草稿", { exact: true })).toBeVisible();
    const allocation = mutationRequest(requests, "/allocations");
    expectFreshCapabilityBefore(requests, allocation);
    expect(allocation.body).toMatchObject({
      selectionRef,
      selectionExpiresAt: expiresAt,
      amountCents: "10000",
      expectedCaseRevision: 3
    });
    expect(allocation.body).toHaveProperty("idempotencyKey");
    expect(allocation.body).not.toHaveProperty("paymentExecutionId");

    await clickTableAction(page, "提交");
    await expect(page.getByText("提交核销案件", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("已提交", { exact: true })).toBeVisible();
    const submit = mutationRequest(requests, "/submit");
    expectFreshCapabilityBefore(requests, submit);

    await clickTableAction(page, "确认");
    await expect(page.getByText("确认核销案件", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("已确认", { exact: true })).toBeVisible();
    const confirm = mutationRequest(requests, "/confirm");
    expectFreshCapabilityBefore(requests, confirm);

    const browserVisibleText = await page.locator("body").innerText();
    expect(browserVisibleText).not.toContain("paymentExecutionId");
    expect(browserVisibleText).not.toContain("PaymentExecution");
    expect(JSON.stringify(requests)).not.toContain("paymentExecutionId");
  });
});
