import { expect, test } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

test("按项目调入和调出普通员工", async ({ page }, testInfo) => {
  const startedAt = Date.now();
  const diagnostics: object[] = [];
  const record = (event: object) => {
    if (diagnostics.length < 60) diagnostics.push({ elapsedMs: Date.now() - startedAt, ...event });
  };
  const endpoint = (url: string) => {
    const path = new URL(url).pathname;
    return ["/api/auth/login", "/api/organization/project-roster/preview", "/api/organization/project-roster/apply"].includes(path) ? path : null;
  };
  page.on("request", (request) => {
    const path = endpoint(request.url());
    if (path) record({ event: "request", path, method: request.method() });
  });
  page.on("response", (response) => {
    const path = endpoint(response.url());
    if (path) record({ event: "response", path, status: response.status() });
  });
  page.on("requestfailed", (request) => {
    const path = endpoint(request.url());
    if (path) record({ event: "requestfailed", path });
  });
  page.on("console", (message) => {
    if (message.text().startsWith("[roster-click]")) record({ event: "click", detail: message.text().slice(14, 700) });
  });
  await page.addInitScript(() => {
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      const label = button?.textContent?.trim();
      if (!button || !["预览调整", "确认调入项目", "确认调出项目"].includes(label ?? "")) return;
      const rect = button.getBoundingClientRect();
      const drawer = document.querySelector(".t-drawer__content-wrapper");
      const style = drawer ? getComputedStyle(drawer) : null;
      console.info("[roster-click]" + JSON.stringify({ label, disabled: button.disabled,
        width: rect.width, height: rect.height, x: event.clientX, y: event.clientY,
        drawerOpacity: style?.opacity, drawerTransform: style?.transform }));
    }, true);
  });
  try {
    const password = "Local-Roster-Only-01";
    await page.goto("/login");
    await page.getByPlaceholder("请输入手机号").fill(process.env.ROSTER_MANAGER_PHONE!);
    await page.getByPlaceholder("请输入密码").fill(password);
    record({ event: "phase", phase: "login-click-start" });
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).not.toHaveURL(/login/);
    record({ event: "phase", phase: "login-ready" });
    await page.goto("/项目花名册");
    await page.getByPlaceholder("全部可见项目").click();
    await page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: process.env.ROSTER_PROJECT_NAME! }).click();
    await expect(page.getByText("暂无可查看的项目人员", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "调入人员", exact: true }).click();
    const drawer = page.locator(".t-drawer__content-wrapper");
    await drawer.locator('[data-field="userId"]').click();
    await page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: process.env.ROSTER_EMPLOYEE_PHONE! }).click();
    await drawer.locator('[data-field="reason"] input').fill("安排至该项目工作");
    await drawer.getByRole("button", { name: "预览调整", exact: true }).click();
    await drawer.getByPlaceholder("请输入本人当前登录密码").fill(password);
    await expectNoDocumentHorizontalOverflow(page);
    record({ event: "phase", phase: "join-confirm-click-start" });
    await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
    record({ event: "phase", phase: "join-confirm-click-returned" });
    await expect(drawer).toHaveCount(0);
    record({ event: "phase", phase: "join-drawer-closed" });
    const row = page.getByRole("row").filter({ hasText: process.env.ROSTER_EMPLOYEE_PHONE! });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "调出项目", exact: true }).click();
    await drawer.locator('[data-field="reason"] input').fill("合成验收调出");
    await drawer.getByRole("button", { name: "预览调整", exact: true }).click();
    await drawer.getByPlaceholder("请输入本人当前登录密码").fill(password);
    record({ event: "phase", phase: "leave-confirm-click-start" });
    await drawer.getByRole("button", { name: "确认调出项目", exact: true }).click();
    record({ event: "phase", phase: "leave-confirm-click-returned" });
    await expect(drawer).toHaveCount(0);
    record({ event: "phase", phase: "leave-drawer-closed" });
    await expect(row).toHaveCount(0);
    await expectNoDocumentHorizontalOverflow(page);
  } finally {
    console.info("[roster-diagnostic]" + JSON.stringify({ project: testInfo.project.name,
      elapsedMs: Date.now() - startedAt, events: diagnostics }));
  }
});
