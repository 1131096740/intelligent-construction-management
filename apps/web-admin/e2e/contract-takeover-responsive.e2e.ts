import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const governanceViewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

const takeover = {
  id: "takeover-responsive",
  batchNo: "手工补录",
  importRowNo: null,
  contractNo: "XYLH-2026-劳务-001",
  contractName: "劳务分包合同",
  counterparty: "云南富誉建筑劳务有限公司",
  companyEntityName: "建工智管公司",
  amountCents: "3000000",
  paymentTermsOriginalText: "按月结算，归档后付款",
  takeoverLevel: "A",
  suggestedTakeoverLevel: "A",
  takeoverLevelAdjustmentReason: null,
  levelRiskText: "A级资料较完整，可作为首批活跃合同接管。",
  paymentBlockingHint: "尚未完成主管确认，后续付款申请会被系统阻断。",
  evidenceGapSummary: "缺少：历史合同扫描件。补齐前会影响主管确认和后续付款核验。",
  takeoverStatus: "draft",
  lifecycleStatus: "in_progress",
  signedAt: "2026-07-13T00:00:00.000Z",
  historicalSettledCents: "0",
  historicalApprovalPendingPaymentCents: "0",
  historicalApprovedPendingPaymentCents: "0",
  historicalPaidCents: "0",
  historicalProxyPaidCents: "0",
  historicalAdvancePaidCents: "0",
  historicalAdvanceDeductedCents: "0",
  historicalRetentionWithheldCents: "0",
  historicalRetentionReleasedCents: "0",
  otherConfirmedOccupancyCents: "0",
  balanceSourceSummary: "项目台账",
  evidenceSummary: "已归档合同",
  takeoverCutoffDate: null,
  responsibleUserId: "contract-director",
  responsibleUserName: "合同负责人",
  reviewComment: null,
  acceptanceConclusion: null,
  submittedAt: null,
  confirmedAt: null,
  historicalBalanceConfirmedAt: null,
  evidenceChecklist: [
    {
      purpose: "historical_contract_scan",
      purposeLabel: "历史合同扫描件",
      required: true,
      uploaded: false,
      statusLabel: "待补齐",
      riskText: "缺少历史合同扫描件，接管事实无法完整核验。"
    }
  ],
  evidenceFiles: [],
  corrections: [],
  postConfirmationVerification: {
    statusLabel: "未到核验",
    summaryText: "主管确认后再核验接管后的业务闭环。",
    newSettlementCount: 0,
    paymentRequestCount: 0,
    paymentExecutionCount: 0,
    financeRecordCount: 0
  },
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z"
};

const takeoverWithDownloadableEvidence = {
  ...takeover,
  evidenceGapSummary: "历史合同扫描件已补齐。",
  evidenceChecklist: [
    {
      ...takeover.evidenceChecklist[0],
      uploaded: true,
      statusLabel: "已补齐",
      riskText: "历史合同扫描件已归档。"
    }
  ],
  evidenceFiles: [
    {
      recordId: "archive-file-1",
      fileId: "file-downloadable-1",
      fileName: "建工智管-中文上传验收-20260713.pdf",
      purpose: "historical_contract_scan",
      purposeLabel: "历史合同扫描件",
      mimeType: "application/pdf",
      sizeBytes: 58_314,
      uploadedByName: "合同负责人",
      uploadedAt: "2026-07-13T08:16:34.000Z",
      canDownload: true,
      disabledReason: null
    }
  ]
};

async function loginWithMocks(
  page: Page,
  takeoverFixture: typeof takeover | typeof takeoverWithDownloadableEvidence = takeover
) {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "contract-director",
          name: "合同负责人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["contract_director"],
          globalRoleKeys: ["contract_director"]
        },
        tokens: {
          accessToken: "e2e-access-token",
          refreshToken: "e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "JGXM-001", name: "响应式验收项目" }])
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      })
    })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/projects/project-1/contract-takeovers**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("/import-batches")
      ? []
      : url.pathname.endsWith("/takeover-responsive")
        ? takeoverFixture
        : [takeoverFixture];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("keeps takeover details and upload controls inside a 1224px desktop viewport", async ({
  page
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1224, height: 900 });
  await loginWithMocks(page);
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

  const ledger = page.locator(".ledger-panel");
  const detail = page.locator(".detail-panel");
  await expect(detail.getByText("资料核验", { exact: true })).toBeVisible();

  const [ledgerBox, detailBox] = await Promise.all([ledger.boundingBox(), detail.boundingBox()]);
  expect(ledgerBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(Math.abs(detailBox!.x - ledgerBox!.x)).toBeLessThanOrEqual(1);
  expect(detailBox!.y).toBeGreaterThan(ledgerBox!.y + ledgerBox!.height);

  await detail.locator('input[type="file"]').first().setInputFiles({
    name: "建工智管-中文上传验收-20260713.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("responsive-uploader-check")
  });

  const uploadButton = detail.getByRole("button", { name: "上传接管资料" });
  await expect(uploadButton).toBeVisible();
  const uploadButtonBox = await uploadButton.boundingBox();
  expect(uploadButtonBox).not.toBeNull();
  expect(uploadButtonBox!.x + uploadButtonBox!.width).toBeLessThanOrEqual(1224);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test("keeps the takeover ledger as the only horizontal scroller across six desktop viewports", async ({
  page
}, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginWithMocks(page);
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;

  for (const viewport of governanceViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/历史合同接管");
    await expect(page.getByRole("heading", { name: "历史合同接管" })).toBeVisible();
    await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

    const ledger = page.locator(".ledger-panel");
    const detail = page.locator(".detail-panel");
    const [ledgerBox, detailBox] = await Promise.all([ledger.boundingBox(), detail.boundingBox()]);
    expect(ledgerBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    if (viewport.width >= 1440) {
      expect(ledgerBox!.x).toBeLessThan(detailBox!.x);
    } else {
      expect(Math.abs(detailBox!.x - ledgerBox!.x)).toBeLessThanOrEqual(1);
      expect(detailBox!.y).toBeGreaterThan(ledgerBox!.y + ledgerBox!.height);
    }

    await expectHorizontalScrollOwner(ledger.locator(".t-table__content"));
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(screenshotDir, `contract-takeover-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  expect(runtimeErrors).toEqual([]);
});

test("keeps takeover evidence controls reachable through the final 390px page fallback", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginWithMocks(page);
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

  const detail = page.locator(".detail-panel");
  await detail.locator('input[type="file"]').first().setInputFiles({
    name: "建工智管-中文上传验收-20260713.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("mobile-responsive-uploader-check")
  });

  const uploadButton = detail.getByRole("button", { name: "上传接管资料" });
  await expect(uploadButton).toBeVisible();
  await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY }));
  await uploadButton.scrollIntoViewIfNeeded();
  const uploadButtonBox = await uploadButton.boundingBox();
  expect(uploadButtonBox).not.toBeNull();
  expect(uploadButtonBox!.x).toBeGreaterThanOrEqual(-1);
  expect(uploadButtonBox!.x + uploadButtonBox!.width).toBeLessThanOrEqual(720);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  ).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test("keeps the signed-in session when a sensitive download password is incorrect", async ({
  page
}) => {
  let downloadTicketRequests = 0;
  let refreshRequests = 0;
  await page.route("**/api/files/file-downloadable-1/download-ticket", (route) => {
    downloadTicketRequests += 1;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "当前密码不正确，请重新输入" })
    });
  });
  await page.route("**/api/auth/refresh", (route) => {
    refreshRequests += 1;
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  page.once("dialog", (dialog) => dialog.accept());

  await loginWithMocks(page, takeoverWithDownloadableEvidence);
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  const detail = page.locator(".detail-panel");
  await detail.getByPlaceholder("下载前需校验当前登录密码").fill("wrong-password");
  await detail
    .getByPlaceholder("例如：复核历史付款凭证")
    .fill("生产验收：错误密码不应退出登录");
  await detail.getByRole("button", { name: "安全下载资料" }).click();

  await expect(page.getByText("当前密码不正确，请重新输入", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/%E5%8E%86%E5%8F%B2%E5%90%88%E5%90%8C%E6%8E%A5%E7%AE%A1$/u);
  await expect(page.getByText("合同负责人 · 合同部主管", { exact: true })).toBeVisible();
  expect(downloadTicketRequests).toBe(1);
  expect(refreshRequests).toBe(0);
});
