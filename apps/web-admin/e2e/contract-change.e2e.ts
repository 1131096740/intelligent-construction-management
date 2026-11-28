import { expect, test } from "@playwright/test";

test("从生效合同详情上传已签补充协议并提交主管复核", async ({ page }) => {
  const agreement = "验收后三十日付款";
  const summary = "补充已签付款约定";
  let submitted = false;
  await page.route("**/api/auth/login", route => route.fulfill({ json: {
    user: {
      id: "contract-staff-1", name: "合同经办人", phone: "13900000000", mustChangePassword: false,
      roleKeys: ["contract_staff"], globalRoleKeys: ["contract_staff"]
    },
    tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
  } }));
  await page.route("**/api/me/work-items", route => route.fulfill({ json: {
    generatedAt: new Date().toISOString(), visibleProjectCount: 1,
    queues: { pending: [], blocked: [], started: [] },
    approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
  } }));
  await page.route("**/api/projects", route => route.fulfill({ json: [] }));
  await page.route("**/api/approval-delegations/user-options", route => route.fulfill({ json: [] }));
  await page.route("**/api/approval-progress?*", route => route.fulfill({ json: [] }));
  await page.route("**/api/contracts/v1/work-completions", route => route.fulfill({ json: { entries: [] } }));
  await page.route("**/api/contracts/v1/duty-sms", route => route.fulfill({ json: { available: false } }));
  await page.route("**/api/contracts/contract-1", route => route.fulfill({ json: {
    id: "HT-001", contractVersionId: "v1", title: "HT-001 · 材料采购合同",
    meta: [{ label: "当前状态", value: "已生效", tone: "success" }],
    baseInfo: [{ label: "合同金额", value: "¥10,000.00" }],
    effectivenessSteps: [], paymentTermStages: [], settlementBlockMessage: "",
    settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" },
    archiveFiles: [], approvalTimeline: [], availableActions: [], primaryAction: null, disabledReasons: [], chainLinks: [],
    changeVersions: [{
      versionNo: 1, status: "effective", changeType: "original", changeReason: null,
      changeDirection: null, changeAmountCents: null, amountCents: "1000000",
      approvalRoute: ["chairman_or_general_manager"], archiveEffect: null
    }]
  } }));
  await page.route("**/api/files", route => route.fulfill({ status: 201, json: { id: "signed-file-1" } }));
  const pending = {
    id: "signed-change-1", baseVersionId: "v1", sequenceNo: 1, status: "pending_review",
    appendixFileId: "signed-file-1", summary, amountDeltaYuan: "100.1250", effectiveAmountYuan: "10100.1250",
    paymentAgreementText: agreement
  };
  await page.route("**/api/contracts/v1/signed-changes", async route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        fileId: "signed-file-1", summary, amountDeltaYuan: "100.1250", paymentAgreementText: agreement
      });
      submitted = true;
      await route.fulfill({ status: 201, json: pending });
      return;
    }
    await route.fulfill({ json: {
      contractId: "contract-1", baseVersionId: "v1", originalAmountYuan: "10000.0000", effectiveAmountYuan: "10000.0000",
      currentPaymentAgreementText: null, totalEffectiveSettlementYuan: "0.0000", cumulativePaidYuan: "0.0000",
      belowSettled: false, belowPaid: false, canSubmit: true, canReview: false, canDownloadOriginals: true,
      changes: submitted ? [pending] : []
    } });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/u);
  await page.goto("/contracts/contract-1");
  await page.getByRole("button", { name: "补充/变更", exact: true }).click();
  const dialog = page.locator(".t-dialog").filter({ hasText: "合同补充/变更" });
  await expect(dialog.getByText("原合同金额 10000.0000 元 · 当前合同金额 10000.0000 元")).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "双方已签补充协议.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4")
  });
  await dialog.getByRole("textbox", { name: /变更说明/u }).fill(summary);
  await dialog.getByPlaceholder("增项填正数，减项填负数，无变更填 0").fill("100.1250");
  await dialog.getByPlaceholder("仅约定变化时填写，合同部主管复核通过后生效").fill(agreement);
  await dialog.getByRole("button", { name: "提交合同部主管复核" }).click();
  await expect(dialog.getByText(`第 1 次 · 待复核 · ${summary}`)).toBeVisible();
  await expect(dialog.getByText("原合同金额 10000.0000 元 · 当前合同金额 10000.0000 元")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "复核", exact: true })).toHaveCount(0);
});
