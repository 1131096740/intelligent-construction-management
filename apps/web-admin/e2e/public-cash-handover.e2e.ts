import { expect, test } from "@playwright/test";

test("cash handover uses the original confirmation after a lost response", async ({ page }) => {
  let count = 0;
  const commands: unknown[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//u, route => route.fulfill({ json: {} }));
  await page.route("**/api/fund-accounts", route => route.fulfill({ json: { accounts: [], projects: [], notice: "" } }));
  await page.route("**/api/public-cash-handovers", route => route.fulfill({ json: {
    revision: count > 0 ? 6 : 5,
    currentCustodian: { id: count > 0 ? "new" : "old", name: count > 0 ? "新保管人" : "原保管人", isActive: true },
    candidates: [], canStart: false, canClaimInitial: false, canRecoverInitial: false,
    handovers: [{
      id: "cash-handover", fromName: "原保管人", toName: "新保管人", startedByName: "合成财务",
      deliveredYuan: "20.0001", expectedBalanceYuan: "21.0001", evidenceReference: "虚构盘点表",
      createdAt: "2026-11-18T10:00:00Z", status: count > 0 ? "awaiting_reconciliation" : "pending",
      confirmation: count > 0 ? { id: "cash-handover", amountReceivedYuan: "19.9001", discrepancyYuan: "-1.1000",
        handoverDifferenceYuan: "-0.1000" } : null, canConfirm: count === 0, canRecoverStart: false, canRecoverConfirmation: true
    }]
  } }));
  await page.route("**/api/public-cash-handovers/cash-handover/confirmation", async route => {
    commands.push(route.request().postDataJSON());
    count++;
    if (count === 1) await route.abort("failed");
    else await route.fulfill({ status: 201, json: { id: "cash-handover", amountReceivedYuan: "19.9001" } });
  });
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "mock-handover", refreshToken: "mock-handover-refresh",
    user: { id: "new", name: "新保管人", phone: null, mustChangePassword: false,
      roleKeys: ["comprehensive_director"], globalRoleKeys: ["comprehensive_director"] }
  })));
  await page.goto("/资金账户");
  const tab = page.getByText("现金保管交接", { exact: true });
  await tab.click();
  await page.getByRole("button", { name: "核对并接收" }).click();
  await page.getByLabel("实点接收金额（元）").fill("19.9001");
  await page.getByRole("button", { name: "确认实际接收" }).click();
  await expect(page.getByRole("button", { name: "按原凭据重试" })).toBeVisible();
  await expect(page.getByText("结果尚未确认。请保留原凭据，按原内容重试。", { exact: true })).toBeVisible();
  const pendingKey = "jg:public-cash-handover:new";
  const original = await page.evaluate(key => localStorage.getItem(key), pendingKey);
  expect(original).toBeTruthy();
  await page.reload();
  await tab.click();
  const retry = page.getByRole("button", { name: "按原凭据重试" });
  await expect(retry).toBeVisible();
  await page.evaluate(key => {
    const current = JSON.parse(localStorage.getItem(key)!);
    current.input.idempotencyKey = crypto.randomUUID();
    localStorage.setItem(key, JSON.stringify(current));
  }, pendingKey);
  await retry.click();
  await page.evaluate(key => navigator.locks.request(key, () => undefined), pendingKey);
  expect(commands).toHaveLength(1);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: pendingKey, value: original! });
  await page.reload();
  await tab.click();
  await retry.click();
  await expect(page.getByText("已记录实点并完成交接，请核对结果。", { exact: true })).toBeVisible();
  await expect(page.getByText("交接完成，差额待核对", { exact: false })).toBeVisible();
  await expect(page.getByText("账实差额 ¥-1.1000", { exact: false })).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
