import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const responsiveViewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

const templateId = "settlement-template-1";
const inspectionReport = {
  sheetName: "本期结算明细",
  columns: ["本期选择", "清单名称", "本期数量", "证据说明"],
  missingColumns: [],
  duplicateColumns: [],
  hasPrintArea: true,
  handlerSignatureRow: 20,
  reviewerSignatureRow: 21,
  blockingErrors: [],
  warnings: []
};

function templateVersion(
  id: string,
  versionNo: number,
  status: "draft" | "submitted" | "published",
  ready: boolean
) {
  return {
    id,
    settlementTemplateId: templateId,
    versionNo,
    status,
    draftRevision: versionNo,
    compatibleContractTypeKeys: ["material_purchase"],
    compatibleAmountRoles: ["included"],
    compatiblePricingModes: ["tax_inclusive"],
    columnSchema: { sheetName: "本期结算明细" },
    printRules: { requirePrintArea: true },
    evidenceRules: { requiredColumns: ["证据说明"] },
    anomalyRules: { rejectNegativeOrdinaryRows: true },
    inspectionReport: ready ? inspectionReport : null,
    inspectionRevision: ready ? versionNo : null,
    hasSourceXlsx: true,
    hasPreviewXlsx: ready,
    hasPreviewPdf: ready,
    changeSummary: null,
    publishedAt: status === "published" ? "2026-07-12T08:00:00.000Z" : null,
    stoppedAt: null,
    latestPreview: ready
      ? {
          id: `preview-${versionNo}`,
          status: "succeeded",
          sourceRevision: versionNo,
          errorMessage: null,
          hasPreviewXlsx: true,
          hasPreviewPdf: true
        }
      : null
  };
}

async function mockGovernanceSession(page: Page) {
  const versions = [
    templateVersion("template-version-draft", 3, "draft", false),
    templateVersion("template-version-submitted", 2, "submitted", true),
    templateVersion("template-version-published", 1, "published", true)
  ];
  const template = {
    id: templateId,
    name: "材料采购月度结算模板",
    code: "SETTLEMENT-MATERIAL",
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-12T08:00:00.000Z"
  };

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "contract-director-1",
          name: "合同主管",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["contract_director"],
          globalRoleKeys: ["contract_director"]
        },
        tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 0,
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
  await page.route(`**/api/settlement-templates/${templateId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ template, versions })
    })
  );
  await page.route("**/api/settlement-templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ ...template, versions }])
    })
  );
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

test("全局合同主管可治理结算模板且敏感标识、动作门禁和响应式约束符合要求", async ({ page }, testInfo) => {
  await mockGovernanceSession(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);

  await page.getByText("结算模板库", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "结算模板库" })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe("/结算模板库");

  await page.getByRole("button", { name: "新建结算模板" }).click();
  await expect(page.getByRole("heading", { name: "新建结算模板" })).toBeVisible();
  await expect(page.getByText(/fileId|downloadUrl|previewXlsxFileId|previewPdfFileId/u)).toHaveCount(0);
  await expect(page.locator('a[href*="/files/"]')).toHaveCount(0);
  await expect(page.getByText("选择 XLSX 模板源文件", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "返回模板库" }).click();
  await expect(page.getByRole("heading", { name: "结算模板库" })).toBeVisible();
  await page.getByText("治理版本", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "结算模板治理" })).toBeVisible();
  await expect(page.getByText("草稿修订 R3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存新修订" })).toBeVisible();
  await expect(page.getByRole("button", { name: "执行检查" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "生成 XLSX/PDF" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "提交发布" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布版本" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停用版本" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复制为新草稿" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("settlement-template-governance-1440x1100.png"),
    fullPage: true
  });

  const versionSelect = page.locator(".form-grid .t-select");
  await versionSelect.click();
  await page.locator(".t-select__dropdown:visible").getByText("V2 · 待发布", { exact: true }).click();
  await expect(page.getByRole("button", { name: "发布版本" })).toBeDisabled();
  await page.getByPlaceholder("发布时必须说明本版本变化").fill("发布前检查与样张已复核");
  await expect(page.getByRole("button", { name: "发布版本" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "停用版本" })).toHaveCount(0);

  await versionSelect.click();
  await page.locator(".t-select__dropdown:visible").getByText("V1 · 已发布", { exact: true }).click();
  await expect(page.getByRole("button", { name: "停用版本" })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制为新草稿" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存新修订" })).toHaveCount(0);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "结算模板治理" })).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    if (viewport.width <= 1024) {
      await expectHorizontalScrollOwner(page.locator(".inspection-workspace"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `settlement-template-editor-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/结算模板库");
    await expect(page.getByRole("heading", { name: "结算模板库" })).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    if (viewport.width <= 1180) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `settlement-template-list-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.getByText("治理版本", { exact: true }).click();
  }
});
