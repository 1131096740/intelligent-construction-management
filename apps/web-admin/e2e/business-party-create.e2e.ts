import { expect, test, type Page, type Route } from "@playwright/test";

const RECOVERY_STORAGE_KEY = "jgzg.business-party.create.recovery.v1";
const VALID_CODE = "91350211M000100Y46";

type Scenario = {
  createResult?: "success" | "duplicate" | "unknown";
  freezeFailure?: boolean;
  probeFailure?: "initial";
  submissionFailure?: boolean;
};

type RecordedRequest = { method: string; pathname: string };

function definition() {
  return {
    key: "business_party",
    entityType: "business_party",
    name: "合作单位",
    description: "合作单位的统一录入场景。",
    version: 1,
    fields: [],
    rules: []
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function installApiHarness(page: Page, scenario: Scenario = {}, roleKeys = ["contract_staff"]) {
  const requests: RecordedRequest[] = [];
  let probeCount = 0;

  await page.addInitScript(({ roleKeys: storedRoleKeys }) => {
    window.localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
      accessToken: "e2e-access-token",
      refreshToken: "e2e-refresh-token",
      user: {
        id: "e2e-user",
        name: "受控验收账号",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: storedRoleKeys,
        globalRoleKeys: storedRoleKeys
      }
    }));
    if (!window.localStorage.getItem("jgzg.e2e.business-party.initialized")) {
      window.localStorage.removeItem("jgzg.business-party.create.recovery.v1");
      window.localStorage.setItem("jgzg.e2e.business-party.initialized", "1");
    }
  }, { roleKeys });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/api/u, "");
    requests.push({ method: request.method(), pathname });

    if (pathname === "/me/work-items") {
      return json(route, {
        generatedAt: "2026-08-25T00:00:00.000Z",
        visibleProjectCount: 0,
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

    if (pathname === "/business-entry-definitions/business_party/create-target") {
      probeCount += 1;
      if (scenario.probeFailure === "initial" && probeCount === 1) {
        return json(route, { message: "当前账号无权使用该业务场景" }, 403);
      }
      return json(route, {
        createTarget: `probe-target-${probeCount}`,
        expiresAt: "2026-08-25T01:00:00.000Z",
        entityType: "business_party",
        scope: "global"
      });
    }

    if (pathname === "/business-entry-definitions/business_party") {
      return json(route, definition());
    }

    if (pathname === "/business-entry-definitions/business_party/submission-target") {
      if (scenario.submissionFailure) {
        return json(route, { message: "提交授权已失效" }, 503);
      }
      return json(route, {
        target: { entityType: "business_party", createTarget: "submission-target-e2e" },
        createTarget: "submission-target-e2e",
        expiresAt: "2026-08-25T01:00:00.000Z",
        entityType: "business_party",
        scope: "global",
        action: "business_party.create",
        definitionKey: "business_party",
        definitionVersion: 1
      });
    }

    if (pathname === "/business-entry-definitions/business_party/validate") {
      const body = request.postDataJSON() as { values?: Record<string, unknown> };
      return json(route, {
        valid: true,
        sceneKey: "business_party",
        definitionVersion: 1,
        values: body.values ?? {},
        errors: []
      });
    }

    if (pathname === "/business-entry-definitions/business_party/freeze") {
      if (scenario.freezeFailure) {
        return json(route, { message: "当前主数据写入已冻结" }, 423);
      }
      const body = request.postDataJSON() as {
        values?: Record<string, unknown>;
        target?: { entityType: string; createTarget: string };
      };
      return json(route, {
        sceneKey: "business_party",
        target: body.target ?? { entityType: "business_party", createTarget: "submission-target-e2e" },
        revision: 1,
        definitionVersion: 1,
        definition: definition(),
        values: body.values ?? {},
        frozenAt: "2026-08-25T00:00:00.000Z"
      });
    }

    if (pathname === "/business-parties" && request.method() === "POST") {
      if (scenario.createResult === "duplicate") {
        return json(route, { message: "名称或统一社会信用代码已存在" }, 409);
      }
      if (scenario.createResult === "unknown") {
        return route.abort("failed");
      }
      return json(route, {
        party: {
          id: "party-e2e",
          name: "验收合作单位",
          unifiedSocialCreditCode: VALID_CODE
        },
        version: { versionNo: 1 }
      });
    }

    if (pathname === "/business-parties/party-e2e") {
      return json(route, {
        id: "party-e2e",
        name: "验收合作单位",
        unifiedSocialCreditCode: VALID_CODE
      });
    }

    return route.continue();
  });

  return requests;
}

async function openCreatePage(page: Page) {
  await page.goto("/business-parties/new");
  await expect(page.getByRole("heading", { name: "新建合作单位" })).toBeVisible();
  await expect(page.locator("form").getByRole("button", { name: "确认创建", exact: true }))
    .toBeEnabled();
}

async function fillValidForm(page: Page) {
  await page.getByPlaceholder("请填写合作单位名称").fill("验收合作单位");
  await page.getByPlaceholder("可选，填写 18 位统一社会信用代码").fill(VALID_CODE);
}

async function confirmCreate(page: Page) {
  await page.locator("form").getByRole("button", { name: "确认创建", exact: true }).click();
  const visibleConfirmButtons = page.locator("button:visible").filter({ hasText: "确认创建" });
  await expect(visibleConfirmButtons).toHaveCount(2);
  await visibleConfirmButtons.last().click();
}

function requestNames(requests: RecordedRequest[]) {
  return requests.map(({ method, pathname }) => `${method} ${pathname}`);
}

test.describe("#210 合作单位创建非生产动态验收", () => {
  test.setTimeout(60_000);

  test("允许角色按 probe、submission、validate、freeze、create 顺序提交", async ({ page }) => {
    const requests = await installApiHarness(page, { createResult: "success" });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await page.waitForURL("**/business-parties/party-e2e");

    const names = requestNames(requests);
    expect(names.filter((name) => name === "POST /business-entry-definitions/business_party/create-target"))
      .toHaveLength(2);
    expect(names).toContain("POST /business-entry-definitions/business_party/submission-target");
    expect(names).toContain("POST /business-entry-definitions/business_party/validate");
    expect(names).toContain("POST /business-entry-definitions/business_party/freeze");
    expect(names).toContain("POST /business-parties");
    expect(names.indexOf("POST /business-entry-definitions/business_party/freeze"))
      .toBeLessThan(names.indexOf("POST /business-parties"));
  });

  test("拒绝角色在路由守卫处拒绝且不触发任何业务入口请求", async ({ page }) => {
    const requests = await installApiHarness(page, {}, ["finance_staff"]);
    await page.goto("/business-parties/new");
    await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/首页");
    expect(requests.some(({ pathname }) => pathname.startsWith("/business-entry-definitions/") || pathname === "/business-parties"))
      .toBe(false);
  });

  test("无效资料零写入", async ({ page }) => {
    const requests = await installApiHarness(page);
    await openCreatePage(page);
    await page.getByPlaceholder("请填写合作单位名称").fill("验收合作单位");
    await page.getByPlaceholder("可选，填写 18 位统一社会信用代码").fill("INVALID");
    await page.locator("form").getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(page.getByText("统一社会信用代码格式或校验位不正确", { exact: true }).first()).toBeVisible();
    expect(requestNames(requests).some((name) => name.includes("submission-target") || name.endsWith("/business-parties")))
      .toBe(false);
  });

  test("重复结果保留冲突提示且只产生一次最终写请求", async ({ page }) => {
    const requests = await installApiHarness(page, { createResult: "duplicate" });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("名称或统一社会信用代码已存在", { exact: true })).toBeVisible();
    expect(requestNames(requests).filter((name) => name === "POST /business-parties")).toHaveLength(1);
    await expect(page.locator("form").getByRole("button", { name: "确认创建", exact: true })).toBeEnabled();
  });

  test("最终结果未知时保存待恢复资料并在刷新后恢复", async ({ page }) => {
    const requests = await installApiHarness(page, { createResult: "unknown" });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText(/网络请求失败|网络连接失败|合作单位创建暂时失败/u)).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), RECOVERY_STORAGE_KEY)).not.toBeNull();
    await page.reload();
    await expect(page.getByText("发现待恢复资料", { exact: true })).toBeVisible();
    expect(requestNames(requests).filter((name) => name === "POST /business-parties")).toHaveLength(1);
  });

  test("create-target 探针失败时 fail-closed", async ({ page }) => {
    const requests = await installApiHarness(page, { probeFailure: "initial" });
    await page.goto("/business-parties/new");
    await expect(page.getByText("当前账号无权创建合作单位，请使用合同部岗位账号。", { exact: true })).toBeVisible();
    expect(requestNames(requests).some((name) => name.includes("submission-target") || name.endsWith("/business-parties")))
      .toBe(false);
  });

  test("submission-target 失败时不进入校验、冻结或最终写入", async ({ page }) => {
    const requests = await installApiHarness(page, { submissionFailure: true });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("提交授权已失效，请重新确认后重试。", { exact: true })).toBeVisible();
    const names = requestNames(requests);
    expect(names.some((name) => name.includes("/validate") || name.includes("/freeze") || name.endsWith("/business-parties")))
      .toBe(false);
  });

  test("freeze 失败时不进入最终写入", async ({ page }) => {
    const requests = await installApiHarness(page, { freezeFailure: true });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("当前主数据写入已冻结，请稍后刷新重试。", { exact: true })).toBeVisible();
    expect(requestNames(requests).some((name) => name.endsWith("/business-parties"))).toBe(false);
  });
});
