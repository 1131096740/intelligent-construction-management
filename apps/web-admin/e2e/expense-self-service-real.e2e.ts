import { test, expect, type Page } from "@playwright/test";

async function openForm(page: Page, variable: "POL115_FINANCE_SESSION" | "POL115_PROXY_SESSION") {
  const session = JSON.parse(process.env[variable]!);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/费用与报销工作台");
  const options = page.waitForResponse((response) => response.url().endsWith("/expense-claims/create-options"));
  await page.getByRole("button", { name: "新建费用报销 / 借款", exact: true }).click();
  expect((await options).status()).toBe(200);
  return session;
}

function field(page: Page, label: string) {
  return page.locator(".t-drawer .t-form__item").filter({ has: page.getByText(label, { exact: true }) }).locator("input");
}

test("公司财务可选各项目，为本人借款时必须明确选择业务项目", async ({ page }, testInfo) => {
  const session = await openForm(page, "POL115_FINANCE_SESSION");
  const drawer = page.locator(".t-drawer");
  await expect(field(page, "选择人员")).toHaveValue(session.user.name);
  await expect(drawer.getByText("代办系统账号", { exact: true })).toHaveCount(0);
  await drawer.getByText("借款申请", { exact: true }).click();
  await expect(field(page, "项目")).toHaveValue("");
  await field(page, "项目").click();
  await expect(page.locator(".t-select-option")).toHaveCount(3);
  await page.locator(".t-select-option").filter({ hasText: "入口合成项目" }).click();
  await expect(field(page, "项目")).toHaveValue(/入口合成项目/);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const form = page.getByRole("region", { name: "费用申请单条业务表单" });
  await form.locator('[data-field="reason"] textarea').fill("财务本人合成借款");
  await form.locator('[data-field="requestedAmountYuan"] input').fill("0.01");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const payee = page.getByRole("region", { name: "费用收款单条业务表单" });
  await payee.locator('[data-field="loanExpectedClearanceOn"] input').click();
  await page.locator(".t-date-picker__cell--now").click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(201);
  expect(response.request().postDataJSON().applicantUserId).toBe(session.user.id);
  const claim = await response.json();
  await page.waitForURL((url) => decodeURIComponent(url.pathname) === `/费用与报销/${claim.id}`);
  const submitted = page.waitForResponse((response) => response.url().endsWith(`/expense-claims/${claim.id}/submission`));
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await submitted).status()).toBe(201);
  await expect(page.locator(".expense-claim-detail")).toContainText("审批中");
  await page.reload();
  await expect(page.locator(".expense-claim-detail")).toContainText("审批中");
  const layout = await page.locator(".expense-claim-detail").evaluate((root) => ({
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    overflowingCells: Array.from(root.querySelectorAll(".t-descriptions td")).filter((el) => el.scrollWidth > el.clientWidth).map((el) => ({ text: el.textContent, width: el.clientWidth, scrollWidth: el.scrollWidth })),
    overflowing: Array.from(root.querySelectorAll("*")).filter((el) =>
      !el.closest(".t-drawer, .t-dialog__ctx, .t-popup") &&
      el.getBoundingClientRect().right > root.getBoundingClientRect().right + 1
    ).map((el) => ({ tag: el.tagName, className: String(el.className), width: el.clientWidth, scrollWidth: el.scrollWidth })).slice(0, 30)
  }));
  expect(layout.overflowingCells).toEqual([]);
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.clientWidth);
  await page.screenshot({ path: testInfo.outputPath("finance-self-submitted.png"), fullPage: true });
});

test("公司综合部本人和代办均可选各项目，切换模式保留有效项目", async ({ page }) => {
  const session = await openForm(page, "POL115_PROXY_SESSION");
  const drawer = page.locator(".t-drawer");
  await expect(field(page, "选择人员")).toHaveValue(session.user.name);
  await drawer.getByText("借款申请", { exact: true }).click();
  await expect(field(page, "项目")).toHaveValue("");
  await drawer.getByText("代办系统账号", { exact: true }).click();
  await field(page, "选择人员").click();
  await page.locator(".t-select-option").filter({ hasText: "入口申请人" }).click();
  await field(page, "项目").click();
  await page.locator(".t-select-option").filter({ hasText: "入口合成项目" }).click();
  await expect(field(page, "项目")).toHaveValue(/入口合成项目/);
  await drawer.getByText("本人", { exact: true }).click();
  await expect(field(page, "选择人员")).toHaveValue(session.user.name);
  await expect(field(page, "项目")).toHaveValue(/入口合成项目/);
});
