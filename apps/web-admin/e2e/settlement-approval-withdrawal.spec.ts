import { expect, test } from "@playwright/test";
import { expectApprovalProgressLoaded, mockApprovalProgress } from "./helpers/approval-progress-mocks";
import {
  expectSettlementWithdrawalPageHealthy,
  installSettlementWithdrawalApi,
  installSettlementWithdrawalSession,
  loginSettlementWithdrawalUser,
  observePageHealth,
  openSettlementWithdrawalProcess
} from "./settlement-approval-withdrawal.fixture";

test.use({ baseURL: process.env.SETTLEMENT_WITHDRAWAL_BASE_URL ?? "http://127.0.0.1:4180" });

test("旧结算仍可查看，来自缓存的撤回能力也不能发起办理", async ({ browserName, page }) => {
  await page.setViewportSize(browserName === "webkit" ? { width: 390, height: 844 } : { width: 1366, height: 768 });
  const code = "JS-HISTORICAL-APPROVAL";
  const session = await installSettlementWithdrawalSession(page);
  const api = await installSettlementWithdrawalApi(page, [{
    code, settlementId: "historical-settlement", capability: true
  }]);
  await mockApprovalProgress(page, [{ businessType: "settlement", businessId: code, pending: true }]);
  await page.route(`**/api/approval-forms/settlement/${code}/capability`, (route) => route.fulfill({ json: { available: false } }));
  const health = observePageHealth(page);

  await loginSettlementWithdrawalUser(page);
  await openSettlementWithdrawalProcess(page, code);
  await expect(page.getByRole("heading", { name: /结算/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "通过", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "转审", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "委托", exact: true })).toHaveCount(0);
  await expectApprovalProgressLoaded(page);
  expect(api.postBodies(code)).toEqual([]);
  await expectSettlementWithdrawalPageHealthy(page, browserName, health, session.unexpectedApiRequests);
});
