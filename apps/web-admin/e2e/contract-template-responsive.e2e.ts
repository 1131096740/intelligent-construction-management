import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

const usagePreview = {
  fields: [],
  bills: [],
  clauses: [],
  attachments: [],
  validations: []
};

const publishedTemplate = {
  id: "template-responsive",
  code: "TPL-RESPONSIVE",
  businessCode: "合同模板-材料采购-V1",
  name: "材料采购标准模板",
  status: "published",
  contractTypeKey: "material_purchase",
  versionId: "version-responsive",
  versionNo: 1,
  usagePreview
};

const publishedTemplates = [
  publishedTemplate,
  {
    ...publishedTemplate,
    id: "template-responsive-equipment",
    code: "TPL-RESPONSIVE-EQUIPMENT",
    businessCode: "合同模板-机械设备租赁-V1",
    name: "工程机械设备租赁合同模板",
    contractTypeKey: "equipment_lease",
    versionId: "version-responsive-equipment"
  },
  {
    ...publishedTemplate,
    id: "template-responsive-labor",
    code: "TPL-RESPONSIVE-LABOR",
    businessCode: "合同模板-劳务分包-V1",
    name: "劳务分包合同模板",
    contractTypeKey: "labor_subcontract",
    versionId: "version-responsive-labor"
  },
  {
    ...publishedTemplate,
    id: "template-responsive-general",
    code: "TPL-RESPONSIVE-GENERAL",
    businessCode: "合同模板-通用-V1",
    name: "通用合同模板",
    contractTypeKey: "general",
    versionId: "version-responsive-general"
  }
];

const templateDetail = {
  template: {
    id: "template-responsive",
    code: "TPL-RESPONSIVE",
    businessCode: "合同模板-材料采购-V1",
    name: "材料采购标准模板",
    contractTypeKey: "material_purchase",
    status: "draft"
  },
  versions: [{
    id: "version-responsive",
    templateId: "template-responsive",
    versionNo: 1,
    status: "draft",
    changeSummary: "响应式隔离验收数据",
    schema: {
      fields: [
        { key: "supplier", label: "供应商名称", type: "text", required: true },
        { key: "delivery", label: "交货地点", type: "text", required: false }
      ],
      bills: [{
        key: "materials",
        name: "材料清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        columns: [{ key: "name", label: "材料名称", type: "text", required: true }]
      }],
      clauses: [],
      attachments: [],
      validations: []
    }
  }]
};

async function mockSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-director-responsive",
        name: "合同主管",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_director"],
        globalRoleKeys: ["contract_director"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
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
  }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/api/contract-templates/**", (route) => {
    if (route.request().method() !== "GET") return route.abort();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(templateDetail) });
  });
  await page.route("**/api/contract-templates*", (route) => {
    if (route.request().method() !== "GET") return route.abort();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(publishedTemplates)
    });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

test("合同模板台账与十列编辑区在六档桌面窗口中保持单一横向滚动所有者", async ({ page }, testInfo) => {
  await mockSession(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/合同模板库");
    await expect(page.getByRole("heading", { name: "合同模板库" })).toBeVisible();
    await expect(page.locator(".template-card")).toHaveCount(4);
    await expect(page.locator(".template-card .t-card__actions")).toHaveCount(0);
    await expect(page.locator(".template-card-actions")).toHaveCount(4);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(screenshotDir, `contract-template-use-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
    await page.getByRole("button", { name: "配置模式" }).click();
    await expect(page.locator(".jg-table-region .t-table__content")).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    if (viewport.width <= 1180) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `contract-template-list-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/合同模板库/template-responsive");
    await expect(page.getByRole("heading", { name: "合同模板-材料采购-V1" })).toBeVisible();
    await expect(page.locator(".row-editor-list")).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    if (viewport.width <= 1280) {
      await expectHorizontalScrollOwner(page.locator(".row-editor-list").first());
    }
    await page.screenshot({
      path: path.join(screenshotDir, `contract-template-editor-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  expect(pageErrors).toEqual([]);
});
