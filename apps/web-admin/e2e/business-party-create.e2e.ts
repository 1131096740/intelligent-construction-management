import { expect, test, type Page, type Route } from "@playwright/test";

const RECOVERY_STORAGE_KEY = "jgzg.business-party.create.recovery.v1";
const VALID_CODE = "91350211M000100Y46";

type Scenario = {
  createResult?: "success" | "duplicate" | "definition-stale-once" | "unknown" | "unknown-once";
  creationResult?: "missing" | "completed";
  definitionChangesAfterUnknown?: boolean;
  confirmDefinitionStale?: boolean;
  confirmDefinitionFailure?: boolean;
  confirmDefinitionInvalidJson?: boolean;
  freezeFailure?: boolean;
  probeFailure?: "initial";
  submissionFailure?: "always-expired" | "once-expired" | "forbidden";
};

type RecordedRequest = { method: string; pathname: string; body?: unknown };

function definition(version = 1) {
  return {
    key: "business_party",
    entityType: "business_party",
    name: "合作单位",
    description: "合作单位的统一录入场景。",
    version,
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
  let createCount = 0;
  let unknownWasSent = false;
  let submissionIssued = false;
  let submissionCount = 0;

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
      window.sessionStorage.removeItem("jgzg.business-party.create.recovery.v1");
      window.localStorage.setItem("jgzg.e2e.business-party.initialized", "1");
    }
  }, { roleKeys });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/api/u, "");
    requests.push({
      method: request.method(),
      pathname,
      ...(request.postData() ? { body: request.postDataJSON() } : {})
    });

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

    if (pathname === "/business-entry-definitions/business-party/create/probe") {
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

    if (pathname === "/business-parties/create-capability") {
      return roleKeys.some((role) => role === "contract_staff" || role === "contract_director")
        ? json(route, { availableActions: ["business_party.create"] })
        : json(route, { message: "当前账号无权创建合作单位" }, 403);
    }

    if (pathname === "/business-parties/creation-result") {
      return scenario.creationResult === "completed"
        ? json(route, { status: "completed", partyId: "party-e2e" })
        : json(route, { status: "missing" });
    }

    if (pathname === "/business-parties" && request.method() === "GET") {
      return json(route, []);
    }

    if (pathname === "/business-entry-definitions/business_party") {
      if (scenario.confirmDefinitionInvalidJson && submissionIssued) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{"
        });
      }
      if (scenario.confirmDefinitionFailure && submissionIssued) {
        return json(route, { message: "最新字段定义读取失败" }, 503);
      }
      if (scenario.confirmDefinitionStale && submissionIssued) {
        return json(route, definition(2));
      }
      return json(route, definition(
        scenario.definitionChangesAfterUnknown && unknownWasSent ? 2 : 1
      ));
    }

    if (pathname === "/business-entry-definitions/business-party/create/submission-target") {
      submissionCount += 1;
      if (scenario.submissionFailure === "forbidden") {
        return json(route, { message: "当前账号无权创建合作单位" }, 403);
      }
      if (
        scenario.submissionFailure === "always-expired" ||
        (scenario.submissionFailure === "once-expired" && submissionCount === 1)
      ) {
        return json(route, { message: "提交授权已失效" }, 503);
      }
      submissionIssued = true;
      return json(route, {
        target: { entityType: "business_party", createTarget: "submission-target-e2e" },
        createTarget: "submission-target-e2e",
        expiresAt: "2026-08-25T01:00:00.000Z",
        entityType: "business_party",
        scope: "global",
        action: "business_party.create",
        definitionKey: "business_party",
        definitionVersion: scenario.definitionChangesAfterUnknown && unknownWasSent ? 2 : 1
      });
    }

    if (pathname === "/business-entry-definitions/business-party/create/validate") {
      const body = request.postDataJSON() as { values?: Record<string, unknown> };
      return json(route, {
        valid: true,
        sceneKey: "business_party",
        definitionVersion: scenario.definitionChangesAfterUnknown && unknownWasSent ? 2 : 1,
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
        definitionVersion: scenario.definitionChangesAfterUnknown && unknownWasSent ? 2 : 1,
        definition: definition(scenario.definitionChangesAfterUnknown && unknownWasSent ? 2 : 1),
        values: body.values ?? {},
        frozenAt: "2026-08-25T00:00:00.000Z"
      });
    }

    if (pathname === "/business-parties" && request.method() === "POST") {
      createCount += 1;
      if (scenario.createResult === "definition-stale-once" && createCount === 1) {
        return json(route, {
          message: "合作单位字段定义版本已变化，请重新确认"
        }, 409);
      }
      if (scenario.createResult === "duplicate") {
        return json(route, {
          message: "名称或统一社会信用代码已存在",
          partyId: "party-existing"
        }, 409);
      }
      if (
        scenario.createResult === "unknown" ||
        (scenario.createResult === "unknown-once" && createCount === 1)
      ) {
        unknownWasSent = true;
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
        party: {
          id: "party-e2e",
          name: "验收合作单位",
          unifiedSocialCreditCode: VALID_CODE,
          createdByName: "合同经办人"
        },
        versions: []
      });
    }


    if (pathname === "/business-parties/party-existing") {
      return json(route, {
        party: {
          id: "party-existing",
          name: "既有合作单位",
          createdByName: "合同经办人"
        },
        versions: []
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
    expect(names.filter((name) => name === "POST /business-entry-definitions/business-party/create/probe"))
      .toHaveLength(3);
    expect(names).toContain("POST /business-entry-definitions/business-party/create/submission-target");
    expect(names).toContain("POST /business-entry-definitions/business-party/create/validate");
    expect(names).toContain("POST /business-entry-definitions/business_party/freeze");
    expect(names).toContain("POST /business-parties");
    expect(names.indexOf("POST /business-entry-definitions/business_party/freeze"))
      .toBeLessThan(names.indexOf("POST /business-parties"));
    const probeKeys = requests
      .filter(({ pathname }) => pathname.endsWith("/create/probe"))
      .map(({ body }) => (body as { idempotencyKey?: string } | undefined)?.idempotencyKey);
    expect(probeKeys[1]).not.toBe(probeKeys[0]);
    expect(probeKeys[2]).toBe(probeKeys[1]);
  });

  test("拒绝角色由服务端 capability 拒绝并返回列表提示", async ({ page }) => {
    const requests = await installApiHarness(page, {}, ["finance_staff"]);
    await page.goto("/business-parties/new");
    await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/business-parties");
    await expect(page.getByText("当前账号没有创建合作单位的服务端授权。", { exact: true }))
      .toBeVisible();
    const names = requestNames(requests);
    expect(names).toContain("GET /business-parties/create-capability");
    expect(names.some((name) => name.includes("/business-entry-definitions/") || name === "POST /business-parties"))
      .toBe(false);
  });

  test("列表创建按钮只由服务端 capability 投影", async ({ page }) => {
    const requests = await installApiHarness(page, {}, ["finance_staff"]);
    await page.goto("/business-parties");
    await expect(page.getByRole("heading", { name: "合作单位档案" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建合作单位" })).toHaveCount(0);
    expect(requestNames(requests)).toContain("GET /business-parties/create-capability");
  });

  test("无效资料零写入", async ({ page }) => {
    const requests = await installApiHarness(page);
    await openCreatePage(page);
    await page.getByPlaceholder("请填写合作单位名称").fill("验收合作单位");
    await page.getByPlaceholder("可选，填写 18 位统一社会信用代码").fill("INVALID");
    await page.locator("form").getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(page.getByText("统一社会信用代码格式或校验位不正确", { exact: true }).first()).toBeVisible();
    expect(requestNames(requests).some((name) => name.includes("submission-target") || name === "POST /business-parties"))
      .toBe(false);
  });

  test("重复结果保留冲突提示且只产生一次最终写请求", async ({ page }) => {
    const requests = await installApiHarness(page, { createResult: "duplicate" });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("名称或统一社会信用代码已存在", { exact: true })).toBeVisible();
    await expect(page.getByText("查看既有合作单位档案", { exact: true }))
      .toHaveAttribute("href", "/business-parties/party-existing");
    expect(requestNames(requests).filter((name) => name === "POST /business-parties")).toHaveLength(1);
    await expect(page.locator("form").getByRole("button", { name: "确认创建", exact: true })).toBeEnabled();
  });

  test("最终结果未知时保存待恢复资料并在刷新后恢复", async ({ page }) => {
    const requests = await installApiHarness(page, { createResult: "unknown" });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText(/网络请求失败|网络连接失败|合作单位创建暂时失败/u)).toBeVisible();
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), RECOVERY_STORAGE_KEY)).not.toBeNull();
    await page.reload();
    await expect(page.getByText("存在结果待确认的创建请求", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("请填写合作单位名称")).toHaveValue("");
    await expect(page.getByPlaceholder("请填写合作单位名称")).toBeDisabled();
    expect(requestNames(requests).filter((name) => name === "POST /business-parties")).toHaveLength(1);
  });

  test("未知结果已完成时只读查询后直接进入既有档案", async ({ page }) => {
    const requests = await installApiHarness(page, {
      createResult: "unknown-once",
      creationResult: "completed"
    });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText(/网络请求失败|网络连接失败|合作单位创建暂时失败/u)).toBeVisible();
    await page.reload();
    await page.waitForURL("**/business-parties/party-e2e");
    expect(requestNames(requests)).toContain("GET /business-parties/creation-result");
    expect(requestNames(requests).filter((name) => name === "POST /business-parties"))
      .toHaveLength(1);
  });

  test("未知结果缺失且定义未变时复用原 key 并重新确认", async ({ page }) => {
    const requests = await installApiHarness(page, {
      createResult: "unknown-once",
      creationResult: "missing"
    });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText(/网络请求失败|网络连接失败|合作单位创建暂时失败/u)).toBeVisible();
    const recovery = await page.evaluate((key) => JSON.parse(
      window.sessionStorage.getItem(key) ?? "null"
    ) as { idempotencyKey: string } | null, RECOVERY_STORAGE_KEY);
    expect(recovery).not.toBeNull();
    await page.reload();
    await page.getByRole("button", { name: "核验创建结果并继续" }).click();
    const visibleConfirmButtons = page.locator("button:visible").filter({ hasText: "确认创建" });
    await expect(visibleConfirmButtons).toHaveCount(2);
    const probeKeys = requests
      .filter(({ pathname }) => pathname.endsWith("/create/probe"))
      .map(({ body }) => (body as { idempotencyKey?: string } | undefined)?.idempotencyKey);
    expect(probeKeys.at(-1)).toBe(recovery?.idempotencyKey);
    await visibleConfirmButtons.last().click();
    await page.waitForURL("**/business-parties/party-e2e");
  });

  test("定义变化时先查旧 key，再换新 key 重新确认", async ({ page }) => {
    const requests = await installApiHarness(page, {
      createResult: "unknown-once",
      creationResult: "missing",
      definitionChangesAfterUnknown: true
    });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText(/网络请求失败|网络连接失败|合作单位创建暂时失败/u)).toBeVisible();
    const recovery = await page.evaluate((key) => JSON.parse(
      window.sessionStorage.getItem(key) ?? "null"
    ) as { idempotencyKey: string } | null, RECOVERY_STORAGE_KEY);
    await page.reload();
    await page.getByRole("button", { name: "核验创建结果并继续" }).click();
    const visibleConfirmButtons = page.locator("button:visible").filter({ hasText: "确认创建" });
    await expect(visibleConfirmButtons).toHaveCount(2);
    const recoveryProbeKeys = requests
      .filter(({ pathname }) => pathname.endsWith("/create/probe"))
      .map(({ body }) => (body as { idempotencyKey?: string } | undefined)?.idempotencyKey)
      .slice(-2);
    expect(recoveryProbeKeys[0]).toBe(recovery?.idempotencyKey);
    expect(recoveryProbeKeys[1]).not.toBe(recovery?.idempotencyKey);
  });

  test("create-target 探针失败时 fail-closed", async ({ page }) => {
    const requests = await installApiHarness(page, { probeFailure: "initial" });
    await page.goto("/business-parties/new");
    await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/business-parties");
    await expect(page.getByText("当前账号没有创建合作单位的服务端授权。", { exact: true }))
      .toBeVisible();
    expect(requestNames(requests).some((name) => name.includes("submission-target") || name === "POST /business-parties"))
      .toBe(false);
  });

  test("submission-target 失败时不进入确认、冻结或最终写入", async ({ page }) => {
    const requests = await installApiHarness(page, { submissionFailure: "always-expired" });
    await openCreatePage(page);
    await fillValidForm(page);
    await page.locator("form").getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(page.getByText("提交授权已失效，请重新确认后重试。", { exact: true })).toBeVisible();
    const names = requestNames(requests);
    expect(names.some((name) => name.includes("/validate") || name.includes("/freeze") || name.endsWith("/business-parties")))
      .toBe(false);
  });

  test("submission-target 过期时先查询原 key，再重签并重新确认", async ({ page }) => {
    const requests = await installApiHarness(page, { submissionFailure: "once-expired" });
    await openCreatePage(page);
    await fillValidForm(page);
    await page.locator("form").getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(page.getByText("提交授权已失效，请重新确认后重试。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "核验创建结果并继续" }).click();
    const visibleConfirmButtons = page.locator("button:visible").filter({ hasText: "确认创建" });
    await expect(visibleConfirmButtons).toHaveCount(2);
    const names = requestNames(requests);
    const resultIndex = names.indexOf("GET /business-parties/creation-result");
    const secondSubmissionIndex = names.lastIndexOf(
      "POST /business-entry-definitions/business-party/create/submission-target"
    );
    expect(resultIndex).toBeGreaterThan(-1);
    expect(resultIndex).toBeLessThan(secondSubmissionIndex);
    const submissionKeys = requests
      .filter(({ pathname }) => pathname.endsWith("/submission-target"))
      .map(({ body }) => (body as { idempotencyKey?: string } | undefined)?.idempotencyKey);
    expect(submissionKeys).toHaveLength(2);
    expect(submissionKeys[1]).toBe(submissionKeys[0]);
    expect(names).not.toContain("POST /business-parties");
  });

  test("链中途 403 直接返回列表且不重试写链", async ({ page }) => {
    const requests = await installApiHarness(page, { submissionFailure: "forbidden" });
    await openCreatePage(page);
    await fillValidForm(page);
    await page.locator("form").getByRole("button", { name: "确认创建", exact: true }).click();
    await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/business-parties");
    await expect(page.getByText("当前账号没有创建合作单位的服务端授权。", { exact: true }))
      .toBeVisible();
    const names = requestNames(requests);
    expect(names.filter((name) => name.endsWith("/submission-target"))).toHaveLength(1);
    expect(names.some((name) => name.includes("/validate") || name.includes("/freeze") || name === "POST /business-parties"))
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

  test("恢复存储不可用时复位并禁止冻结与最终写入", async ({ page }) => {
    const requests = await installApiHarness(page);
    await openCreatePage(page);
    await fillValidForm(page);
    await page.evaluate((recoveryKey) => {
      const nativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (this === window.sessionStorage && key === recoveryKey) {
          throw new Error("恢复存储不可用");
        }
        return nativeSetItem.call(this, key, value);
      };
    }, RECOVERY_STORAGE_KEY);
    await confirmCreate(page);
    await expect(page.getByText("恢复存储不可用", { exact: true })).toBeVisible();
    await expect(page.locator("form").getByRole("button", { name: "取消", exact: true }))
      .toBeEnabled();
    const names = requestNames(requests);
    expect(names).not.toContain("POST /business-entry-definitions/business_party/freeze");
    expect(names).not.toContain("POST /business-parties");
  });

  test("确认阶段 fresh definition 失败时复位且零写入", async ({ page }) => {
    const requests = await installApiHarness(page, { confirmDefinitionFailure: true });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("业务字段定义已变化，请刷新页面后重试。", { exact: true }))
      .toBeVisible();
    await expect(page.locator("form").getByRole("button", { name: "取消", exact: true }))
      .toBeEnabled();
    const names = requestNames(requests);
    expect(names).not.toContain("POST /business-entry-definitions/business_party/freeze");
    expect(names).not.toContain("POST /business-parties");
  });

  test("确认阶段 fresh definition 非法 JSON 时复位且零写入", async ({ page }) => {
    const requests = await installApiHarness(page, { confirmDefinitionInvalidJson: true });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("业务字段定义已变化，请刷新页面后重试。", { exact: true }))
      .toBeVisible();
    await expect(page.locator("form").getByRole("button", { name: "取消", exact: true }))
      .toBeEnabled();
    const names = requestNames(requests);
    expect(names).not.toContain("POST /business-entry-definitions/business_party/freeze");
    expect(names).not.toContain("POST /business-parties");
  });

  test("确认阶段 fresh definition 返回新 revision 时保存恢复信封并重新准备", async ({ page }) => {
    const requests = await installApiHarness(page, {
      confirmDefinitionStale: true,
      creationResult: "missing"
    });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("业务字段定义已变化，请刷新页面后重试。", { exact: true }))
      .toBeVisible();
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), RECOVERY_STORAGE_KEY))
      .not.toBeNull();
    await expect(page.getByRole("button", { name: "核验创建结果并继续" })).toBeVisible();
    await page.getByRole("button", { name: "核验创建结果并继续" }).click();
    const visibleConfirmButtons = page.locator("button:visible").filter({ hasText: "确认创建" });
    await expect(visibleConfirmButtons).toHaveCount(2);
    const names = requestNames(requests);
    expect(names.indexOf("GET /business-parties/creation-result"))
      .toBeLessThan(names.lastIndexOf("POST /business-entry-definitions/business-party/create/submission-target"));
    expect(names).not.toContain("POST /business-entry-definitions/business_party/freeze");
    expect(names).not.toContain("POST /business-parties");
  });

  test("最终写入发现 definition stale 时先查原 key 再重新确认", async ({ page }) => {
    const requests = await installApiHarness(page, {
      createResult: "definition-stale-once",
      creationResult: "missing"
    });
    await openCreatePage(page);
    await fillValidForm(page);
    await confirmCreate(page);
    await expect(page.getByText("业务字段定义已变化，请刷新页面后重试。", { exact: true }))
      .toBeVisible();
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), RECOVERY_STORAGE_KEY))
      .not.toBeNull();
    await page.getByRole("button", { name: "核验创建结果并继续" }).click();
    const visibleConfirmButtons = page.locator("button:visible").filter({ hasText: "确认创建" });
    await expect(visibleConfirmButtons).toHaveCount(2);
    const names = requestNames(requests);
    expect(names.lastIndexOf("GET /business-parties/creation-result"))
      .toBeLessThan(names.lastIndexOf("POST /business-entry-definitions/business-party/create/submission-target"));
    await visibleConfirmButtons.last().click();
    await page.waitForURL("**/business-parties/party-e2e");
    expect(requestNames(requests).filter((name) => name === "POST /business-parties"))
      .toHaveLength(2);
  });
});
