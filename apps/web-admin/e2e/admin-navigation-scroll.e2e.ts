import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

const legacyRecentKey =
  "jiangkong:recent-business-routes:navigation-scroll-user";
const columnSettingsKey =
  "jiangkong:column-settings:navigation-scroll-user";
const columnSettingsValue = JSON.stringify({
  contracts: ["code", "name", "status"]
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ recentKey, settingsKey, settingsValue }) => {
      window.localStorage.setItem(recentKey, JSON.stringify(["/合同工作台"]));
      window.localStorage.setItem(settingsKey, settingsValue);
    },
    {
      recentKey: legacyRecentKey,
      settingsKey: columnSettingsKey,
      settingsValue: columnSettingsValue
    }
  );
  await installRoutes(page);
});

test("removes only the legacy recent-route state after the real layout mounts", async ({
  page
}) => {
  const diagnostics = monitorPage(page);
  await loginAndOpenHome(page);

  await expect(page.locator(".recent-strip")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), legacyRecentKey))
    .toBeNull();
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), columnSettingsKey)
    )
    .toBe(columnSettingsValue);

  await assertHealthyPage(page, diagnostics);
});

test("resets a menu navigation to the top, focuses main, and keeps the header natural", async ({
  page
}) => {
  const diagnostics = monitorPage(page);
  await loginAndOpenHome(page);
  await ensureTallLayout(page);

  await scrollTo(page, 600);
  await clickVisibleSettingsMenuItem(page);

  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/系统配置"
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  await expect(page.locator("#main-content")).toBeFocused();

  await ensureTallLayout(page);
  await scrollTo(page, 600);
  await expect
    .poll(() =>
      page.locator(".header").evaluate((header) => {
        const box = header.getBoundingClientRect();
        return box.bottom <= 0 && getComputedStyle(header).position !== "sticky";
      })
    )
    .toBe(true);

  await assertHealthyPage(page, diagnostics);
});

test("restores independent scroll positions across browser history", async ({
  page
}) => {
  const diagnostics = monitorPage(page);
  await loginAndOpenHome(page);
  await ensureTallLayout(page);

  await scrollTo(page, 700);
  await clickVisibleSettingsMenuItem(page);
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/系统配置"
  );

  await ensureTallLayout(page);
  await scrollTo(page, 350);
  await page.goBack();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/首页"
  );
  await expect
    .poll(() => page.evaluate(() => Math.abs(window.scrollY - 700)))
    .toBeLessThan(50);

  await page.goForward();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/系统配置"
  );
  await expect
    .poll(() => page.evaluate(() => Math.abs(window.scrollY - 350)))
    .toBeLessThan(50);

  await assertHealthyPage(page, diagnostics);
});

test("honors a router hash target without main-content focus moving the viewport", async ({
  page
}) => {
  const diagnostics = monitorPage(page);
  await loginAndOpenHome(page);
  await installAnchorAndFocusProbe(page);

  await pushRouterHash(page, "/首页", "#target-anchor");

  await expect.poll(() => new URL(page.url()).hash).toBe("#target-anchor");
  await expect
    .poll(() =>
      page.locator("#target-anchor").evaluate((target) => {
        const box = target.getBoundingClientRect();
        return box.top >= -1 && box.top < window.innerHeight;
      })
    )
    .toBe(true);
  await expect(page.locator("#main-content")).toBeFocused();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = (
          window as typeof window & {
            __navigationFocusProbe?: { before: number; after: number };
          }
        ).__navigationFocusProbe;
        return probe ?? null;
      })
    )
    .not.toBeNull();
  const recordedFocus = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __navigationFocusProbe: { before: number; after: number };
        }
      ).__navigationFocusProbe
  );
  expect(Math.abs(recordedFocus.after - recordedFocus.before)).toBeLessThan(2);

  await assertHealthyPage(page, diagnostics);
});

async function installRoutes(page: Page) {
  await page.route("**/api/auth/login", (route) =>
    fulfillJson(route, {
      user: {
        id: "navigation-scroll-user",
        name: "导航滚动验收用户",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["chairman", "super_admin", "contract_staff", "finance_staff"],
        globalRoleKeys: ["chairman", "super_admin"]
      },
      tokens: {
        accessToken: "navigation-scroll-access-token",
        refreshToken: "navigation-scroll-refresh-token",
        expiresIn: 900
      }
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    fulfillJson(route, {
      generatedAt: "2026-07-25T00:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [], drafts: [] },
      queueMeta: {
        pending: { total: 0, returned: 0, truncated: false },
        blocked: { total: 0, returned: 0, truncated: false },
        started: { total: 0, returned: 0, truncated: false },
        drafts: { total: 0, returned: 0, truncated: false }
      },
      approvalCenter: {
        pendingApproval: [],
        startedByMe: [],
        handledByMe: [],
        delegatedToMe: [],
        overdueReminder: []
      }
    })
  );
  await page.route("**/api/me/signature/ticket", (route) =>
    fulfillJson(route, null)
  );
  await page.route("**/api/me/signature/canvas-handoffs**", (route) => {
    const isCollection = new URL(route.request().url()).pathname.endsWith(
      "/canvas-handoffs"
    );
    return fulfillJson(
      route,
      isCollection
        ? {
            token: "navigation-scroll-signature-token",
            expiresAt: "2026-07-25T00:05:00.000Z"
          }
        : {
            expiresAt: "2026-07-25T00:05:00.000Z",
            completedAt: null,
            signatureVersionId: null
          }
    );
  });
  await page.route("**/api/draft-retention/preview", (route) =>
    fulfillJson(route, {
      generatedAt: "2026-07-25T00:00:00.000Z",
      mode: "preview_only",
      executionAllowed: false,
      policyVersion: "navigation-e2e",
      totalCandidateCount: 0,
      categories: [],
      fileScanTruncated: false,
      notice: "仅用于导航滚动验收。"
    })
  );
}

async function loginAndOpenHome(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Navigation@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/首页"
  );
}

async function ensureTallLayout(page: Page) {
  await page.locator("#main-content").evaluate(() => {
    let spacer = document.querySelector<HTMLElement>(
      "[data-testid='navigation-scroll-spacer']"
    );
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.dataset.testid = "navigation-scroll-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.height = "1800px";
      spacer.style.width = "1px";
      document.body.append(spacer);
    }
  });
}

async function scrollTo(page: Page, top: number) {
  await page.evaluate((targetTop) => window.scrollTo({ top: targetTop }), top);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(
    top - 2
  );
}

async function clickVisibleSettingsMenuItem(page: Page) {
  const settingsItem = page
    .locator(".t-menu__item")
    .filter({ hasText: "系统配置" })
    .last();
  await expect(settingsItem).toBeVisible();
  const box = await settingsItem.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(await page.evaluate(() => innerHeight));
  await settingsItem.click();
}

async function installAnchorAndFocusProbe(page: Page) {
  await page.locator("#main-content").evaluate(() => {
    const target = document.createElement("section");
    target.id = "target-anchor";
    target.textContent = "合法锚点";
    target.style.marginTop = "1400px";
    target.style.height = "48px";
    document.body.append(target);

    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patchedFocus(options?: FocusOptions) {
      if (this.id === "main-content") {
        const before = window.scrollY;
        focus.call(this, options);
        (
          window as typeof window & {
            __navigationFocusProbe?: { before: number; after: number };
          }
        ).__navigationFocusProbe = { before, after: window.scrollY };
        return;
      }
      focus.call(this, options);
    };
  });
}

async function pushRouterHash(page: Page, path: string, hash: string) {
  await page.evaluate(
    async ({ targetPath, targetHash }) => {
      const app = document.querySelector("#app") as
        | (HTMLElement & {
            __vue_app__?: {
              config: {
                globalProperties: {
                  $router?: {
                    push: (to: { path: string; hash: string }) => Promise<void>;
                  };
                };
              };
            };
          })
        | null;
      const router = app?.__vue_app__?.config.globalProperties.$router;
      if (!router) throw new Error("Vue Router instance is unavailable");
      await router.push({ path: targetPath, hash: targetHash });
    },
    { targetPath: path, targetHash: hash }
  );
}

function monitorPage(page: Page) {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleIssues, pageErrors };
}

async function assertHealthyPage(
  page: Page,
  diagnostics: ReturnType<typeof monitorPage>
) {
  const mainContent = page.locator("#main-content");
  await expect(mainContent).toHaveCount(1);
  await expect(mainContent).toBeVisible();
  await expect
    .poll(async () => (await mainContent.innerText()).trim().length)
    .toBeGreaterThan(0);
  await expect(
    page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  expect(diagnostics.consoleIssues).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
}

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
