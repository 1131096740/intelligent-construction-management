import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectedSettlementWithdrawalBody,
  expectSettlementWithdrawalPageHealthy,
  installSettlementWithdrawalApi,
  installSettlementWithdrawalSession,
  loginSettlementWithdrawalUser,
  observePageHealth,
  openSettlementWithdrawalProcess,
  type SettlementWithdrawalPostMode
} from "./settlement-approval-withdrawal.fixture";

test.use({
  baseURL:
    process.env.SETTLEMENT_WITHDRAWAL_BASE_URL ??
    "http://127.0.0.1:4180",
  trace: "retain-on-failure"
});

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ browserName, page }) => {
  test.skip(
    browserName !== "chromium" && browserName !== "webkit",
    "Settlement withdrawal P0 is scoped to Chromium and WebKit."
  );
  await page.setViewportSize(
    browserName === "webkit"
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 }
  );
});

test("P0 服务端 capability 授权后以 fresh GET 四坐标单 POST 撤回，双击与 pending 只共享一次提交", async ({
  browserName,
  page
}, testInfo) => {
  const code = "JS-WITHDRAW-SUCCESS";
  const settlementId = "settlement-withdraw-success";
  const session = await installSettlementWithdrawalSession(page);
  const api = await installSettlementWithdrawalApi(page, [{
    code,
    settlementId,
    capability: false,
    holdPost: true
  }]);
  const health = observePageHealth(page);

  await loginSettlementWithdrawalUser(page);
  await openSettlementWithdrawalProcess(page, code);
  const withdrawalButton = page.getByRole("button", {
    name: "撤回",
    exact: true
  });
  await expect(withdrawalButton).toHaveCount(0);

  api.setCapability(code, true);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(withdrawalButton).toBeVisible();
  const actionStart = api.methods(code).length;

  await withdrawalButton.click();
  const dialog = withdrawalDialog(page);
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: "确认撤回",
    exact: true
  });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await api.postStarted(code);

  await expect(
    dialog.getByRole("button", { name: "取消", exact: true })
  ).toBeDisabled();
  await expect(dialog.locator(".t-dialog__close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(api.postBodies(code)).toHaveLength(1);
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      `settlement-approval-withdrawal-pending-${browserName}-${
        browserName === "webkit" ? "390x844" : "1366x768"
      }.png`
    ),
    animations: "disabled",
    fullPage: false
  });

  api.releasePost(code);
  await expect(
    page.getByText("结算审批已撤回，权威结算详情已刷新。", {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByText("已撤回", { exact: true }).first()).toBeVisible();
  await expect(withdrawalButton).toHaveCount(0);
  await expect.poll(() => api.methods(code).slice(actionStart)).toEqual([
    "GET",
    "POST",
    "GET"
  ]);
  expect(api.postBodies(code)).toEqual([
    expectedSettlementWithdrawalBody()
  ]);
  expect(api.state(code).withdrawn).toBe(true);
  await expectSettlementWithdrawalPageHealthy(
    page,
    browserName,
    health,
    session.unexpectedApiRequests
  );
});

test("P0 409 坐标冲突是已知失败，保留对话框且不伪报 unknown", async ({
  browserName,
  page
}) => {
  const code = "JS-WITHDRAW-CONFLICT";
  const session = await installSettlementWithdrawalSession(page);
  const api = await installSettlementWithdrawalApi(page, [{
    code,
    settlementId: "settlement-withdraw-conflict",
    postMode: "known-409"
  }]);
  const health = observePageHealth(page);

  await loginSettlementWithdrawalUser(page);
  await openSettlementWithdrawalProcess(page, code);
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  const dialog = withdrawalDialog(page);
  await dialog.getByRole("button", {
    name: "确认撤回",
    exact: true
  }).click();

  await expect(
    dialog.getByText("结算审批撤回未完成：结算审批坐标已变化", {
      exact: true
    })
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true })
  ).toBeEnabled();
  await expect(page.getByText(/不要重复提交/u)).toHaveCount(0);
  await expect.poll(() => api.methods(code)).toEqual([
    "GET",
    "GET",
    "POST"
  ]);
  expect(api.postBodies(code)).toEqual([
    expectedSettlementWithdrawalBody()
  ]);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectSettlementWithdrawalPageHealthy(
    page,
    browserName,
    health,
    session.unexpectedApiRequests
  );
});

const unknownVariants: Array<{
  label: string;
  mode: SettlementWithdrawalPostMode;
  completionReadFailures?: number;
  terminal: boolean;
}> = [
  { label: "网络中断", mode: "network", terminal: false },
  { label: "2xx 响应解析失败", mode: "parse", terminal: false },
  { label: "5xx", mode: "server-500", terminal: false },
  {
    label: "POST 成功后第一次权威重读失败",
    mode: "success",
    completionReadFailures: 1,
    terminal: true
  }
];

for (const variant of unknownVariants) {
  test(`P0 ${variant.label} 进入 unknown 后只权威重读且不盲目重 POST`, async ({
    browserName,
    page
  }) => {
    const suffix = variant.mode === "success" ? "reread" : variant.mode;
    const code = `JS-WITHDRAW-UNKNOWN-${suffix.toUpperCase()}`;
    const session = await installSettlementWithdrawalSession(page);
    const api = await installSettlementWithdrawalApi(page, [{
      code,
      settlementId: `settlement-withdraw-unknown-${suffix}`,
      postMode: variant.mode,
      completionReadFailures: variant.completionReadFailures
    }]);
    const health = observePageHealth(page);

    await loginSettlementWithdrawalUser(page);
    await openSettlementWithdrawalProcess(page, code);
    const withdrawalButton = page.getByRole("button", {
      name: "撤回",
      exact: true
    });
    await withdrawalButton.click();
    await withdrawalDialog(page).getByRole("button", {
      name: "确认撤回",
      exact: true
    }).click();

    await expect(page.getByText(/不要重复提交/u)).toBeVisible();
    await expect(withdrawalButton).toHaveCount(0);
    const expectedMethods = variant.terminal
      ? ["GET", "GET", "POST", "GET", "GET"]
      : ["GET", "GET", "POST", "GET"];
    await expect.poll(() => api.methods(code)).toEqual(expectedMethods);
    expect(api.postBodies(code)).toEqual([
      expectedSettlementWithdrawalBody()
    ]);
    expect(api.state(code).withdrawn).toBe(variant.terminal);

    await page.getByRole("button", { name: "刷新", exact: true }).click();
    if (variant.terminal) {
      await expect(page.getByText("已撤回", { exact: true }).first()).toBeVisible();
      await expect(withdrawalButton).toHaveCount(0);
    } else {
      await expect(withdrawalButton).toBeVisible();
    }
    expect(api.postBodies(code)).toHaveLength(1);
    await expectSettlementWithdrawalPageHealthy(
      page,
      browserName,
      health,
      session.unexpectedApiRequests
    );
  });
}

test("P0 同路由刷新不得把已派发 POST 误报为零提交或重复提交", async ({
  browserName,
  page
}) => {
  const code = "JS-WITHDRAW-SAME-ROUTE";
  const session = await installSettlementWithdrawalSession(page);
  const api = await installSettlementWithdrawalApi(page, [{
    code,
    settlementId: "settlement-withdraw-same-route",
    holdPost: true
  }]);
  const health = observePageHealth(page);

  await loginSettlementWithdrawalUser(page);
  await openSettlementWithdrawalProcess(page, code);
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await withdrawalDialog(page).getByRole("button", {
    name: "确认撤回",
    exact: true
  }).click();
  await api.postStarted(code);

  await page.getByRole("button", {
    name: "刷新",
    exact: true
  }).evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(() => api.methods(code)).toEqual([
    "GET",
    "GET",
    "POST",
    "GET"
  ]);
  api.releasePost(code);

  await expect(page.getByText(/不要重复提交/u)).toBeVisible();
  await expect(page.getByText("已撤回", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/本次没有提交/u)).toHaveCount(0);
  await expect.poll(() => api.methods(code)).toEqual([
    "GET",
    "GET",
    "POST",
    "GET",
    "GET"
  ]);
  expect(api.postBodies(code)).toEqual([
    expectedSettlementWithdrawalBody()
  ]);
  await expectSettlementWithdrawalPageHealthy(
    page,
    browserName,
    health,
    session.unexpectedApiRequests
  );
});

test("P0 跨路由后 route A 迟到回调不污染 route B", async ({
  browserName,
  page
}) => {
  const codeA = "JS-WITHDRAW-ROUTE-A";
  const codeB = "JS-WITHDRAW-ROUTE-B";
  const titleB = `${codeB} · 结算 B`;
  const session = await installSettlementWithdrawalSession(page);
  const api = await installSettlementWithdrawalApi(page, [
    {
      code: codeA,
      settlementId: "settlement-withdraw-route-a",
      holdPost: true
    },
    {
      code: codeB,
      settlementId: "settlement-withdraw-route-b",
      title: titleB,
      capability: false
    }
  ]);
  const health = observePageHealth(page);

  await loginSettlementWithdrawalUser(page);
  await openSettlementWithdrawalProcess(page, codeA);
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await withdrawalDialog(page).getByRole("button", {
    name: "确认撤回",
    exact: true
  }).click();
  await api.postStarted(codeA);

  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/结算管理/${encodeURIComponent(codeB)}`);
  await expect(page.getByText(titleB, { exact: true })).toBeVisible();
  await expect(withdrawalDialog(page)).toHaveCount(0);
  const latePostResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith(
      "/settlement-withdraw-route-a/approval-withdrawal"
    )
  );
  api.releasePost(codeA);
  await latePostResponse;
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await expect.poll(() => api.state(codeA).withdrawn).toBe(true);
  await expect(page.getByText(titleB, { exact: true })).toBeVisible();
  await expect(page.getByText("审批中", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/不要重复提交/u)).toHaveCount(0);
  await expect(page.getByText(/权威结算详情已刷新/u)).toHaveCount(0);
  await expect.poll(() => api.methods(codeA)).toEqual([
    "GET",
    "GET",
    "POST"
  ]);
  await expect.poll(() => api.methods(codeB)).toEqual(["GET"]);
  expect(api.postBodies(codeA)).toEqual([
    expectedSettlementWithdrawalBody()
  ]);
  await expectSettlementWithdrawalPageHealthy(
    page,
    browserName,
    health,
    session.unexpectedApiRequests
  );
});

function withdrawalDialog(page: Page) {
  return page
    .locator(".t-dialog")
    .filter({ hasText: "确认撤回结算审批？" });
}
