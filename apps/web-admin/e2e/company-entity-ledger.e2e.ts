import { expect, test, type Page, type Route } from "@playwright/test";

interface CompanyEntityFixture {
  id: string;
  name: string;
  unifiedSocialCreditCode: string;
  registeredAddress: string;
  dataStatus: "complete";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const entityA: CompanyEntityFixture = {
  id: "entity-a",
  name: "甲方建设有限公司",
  unifiedSocialCreditCode: "91350211M000100Y46",
  registeredAddress: "昆明市",
  dataStatus: "complete",
  isActive: true,
  createdAt: "2026-07-17T01:00:00.000Z",
  updatedAt: "2026-07-17T02:00:00.000Z"
};

const entityB: CompanyEntityFixture = {
  ...entityA,
  id: "entity-b",
  name: "乙方建设有限公司",
  unifiedSocialCreditCode: "91350211M000100X40",
  updatedAt: "2026-07-17T03:00:00.000Z"
};

async function mockSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-staff",
        name: "合同部成员",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_staff"],
        globalRoleKeys: ["contract_staff"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-17T08:00:00.000Z",
      visibleProjectCount: 0,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}

async function openLedger(page: Page) {
  await login(page);
  await page.goto("/我方公司主体");
  await expect(page.getByRole("heading", { name: "我方公司主体" })).toBeVisible();
}

function historyPayload(entity: CompanyEntityFixture, actorName: string) {
  return {
    entity,
    versions: [{
      id: `${entity.id}-version-1`,
      companyEntityId: entity.id,
      versionNo: 1,
      name: entity.name,
      unifiedSocialCreditCode: entity.unifiedSocialCreditCode,
      registeredAddress: entity.registeredAddress,
      isActive: entity.isActive,
      action: "create",
      actorName,
      actorRoleKey: "contract_staff",
      createdAt: entity.createdAt
    }]
  };
}

test("清空关键词后保留最新查询结果", async ({ page }) => {
  await mockSession(page);
  let requestCount = 0;
  await page.route("**/api/company-entities/management*", async (route) => {
    requestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(requestCount === 1 ? [entityA] : [entityB])
    });
  });

  await openLedger(page);
  await expect(page.getByText(entityA.name, { exact: true })).toBeVisible();
  const keywordInput = page.getByPlaceholder("公司全称 / 统一社会信用代码");
  await keywordInput.fill("待清空关键词");
  await keywordInput.locator("..").hover();
  await page.locator(".t-input__suffix-clear").first().click();

  await expect.poll(() => requestCount).toBe(2);
  await expect(page.getByText(entityB.name, { exact: true })).toBeVisible();
  await expect(page.getByText(entityA.name, { exact: true })).toBeHidden();
});

test("快速切换主体时丢弃较早的历史响应", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/company-entities/management*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([entityA, entityB])
  }));

  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstFulfilled!: () => void;
  const firstFulfilled = new Promise<void>((resolve) => {
    markFirstFulfilled = resolve;
  });
  await page.route("**/api/company-entities/*/history", async (route: Route) => {
    const isFirst = new URL(route.request().url()).pathname.includes("entity-a");
    if (isFirst) await firstMayFinish;
    const entity = isFirst ? entityA : entityB;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(historyPayload(entity, isFirst ? "甲操作人" : "乙操作人"))
    });
    if (isFirst) markFirstFulfilled();
  });

  await openLedger(page);
  await page.getByRole("row").filter({ hasText: entityA.name }).getByRole("button", { name: "查看历史" }).click();
  await expect(page.getByText("正在加载历史")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("正在加载历史")).toBeHidden();
  await page.getByRole("row").filter({ hasText: entityB.name }).getByRole("button", { name: "查看历史" }).click();
  await expect(page.getByText("乙操作人 · 合同部成员")).toBeVisible();

  releaseFirst();
  await firstFulfilled;
  await expect(page.getByText("乙操作人 · 合同部成员")).toBeVisible();
  await expect(page.getByText("甲操作人 · 合同部成员")).toBeHidden();
});

test("连续触发保存只创建一次主体", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/company-entities/management*", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  let createCount = 0;
  await page.route("**/api/company-entities", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ entity: entityA, warning: null })
    });
  });

  await openLedger(page);
  await page.getByRole("button", { name: "新增主体" }).click();
  await page.getByPlaceholder("请填写营业执照上的公司全称").fill(entityA.name);
  await page.getByPlaceholder("18 位统一社会信用代码").fill(entityA.unifiedSocialCreditCode);
  const save = page.locator(".t-drawer__footer").getByRole("button", { name: "保存" });
  await save.evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });

  await expect.poll(() => createCount).toBe(1);
  await expect(page.getByText("我方公司主体已保存。")).toBeVisible();
  expect(createCount).toBe(1);
});
