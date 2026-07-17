import { mkdirSync } from "node:fs";
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
  id: "template-standard",
  code: "TPL-MAT-STANDARD",
  businessCode: "合同模板-材料采购-V2",
  name: "材料采购标准模板",
  contractTypeKey: "material_purchase",
  status: "published",
  versionId: "version-standard-2",
  versionNo: 2,
  usagePreview
};

async function mockSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-template-responsive-director",
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
      generatedAt: "2026-07-14T08:00:00.000Z",
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
  await page.route("**/api/contract-number-rules", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      id: "rule-responsive",
      name: "材料采购合同编号",
      pattern: "HT-{YYYY}-{TYPE}-{SEQ}",
      companyEntityId: null,
      projectId: null,
      contractTypeKey: "material_purchase",
      nextSequence: 28,
      sequenceWidth: 4,
      isActive: true
    }])
  }));
  await page.route("**/api/standard-clauses*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      standardClauseVersionId: "clause-version-responsive",
      versionId: "clause-version-responsive",
      versionNo: 3,
      title: "材料验收与付款",
      content: { text: "材料到场验收合格并取得有效票据后，按合同约定办理付款。" },
      clauseId: "clause-responsive",
      code: "MAT-PAY-001",
      name: "材料付款标准条款",
      category: "付款"
    }])
  }));
  await page.route("**/api/contract-business-scenarios", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      id: "scenario-material",
      code: "materials",
      name: "材料采购",
      description: "主材采购签约",
      active: true,
      revision: 2,
      createdAt: "2026-07-12T08:00:00.000Z",
      updatedAt: "2026-07-12T09:00:00.000Z",
      mappings: [{
        id: "mapping-standard",
        businessScenarioId: "scenario-material",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "version-standard-2",
        reason: "常规主材采购",
        priority: 10,
        active: true,
        revision: 3,
        createdAt: "2026-07-12T08:00:00.000Z",
        updatedAt: "2026-07-12T09:00:00.000Z"
      }]
    }])
  }));
  await page.route("**/api/contract-templates", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([publishedTemplate])
  }));
  await page.route("**/api/contract-layout-templates/layout-responsive", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      template: {
        id: "layout-responsive",
        name: "材料采购标准版式",
        contractTypeKey: "material_purchase"
      },
      versions: [{
        id: "layout-version-responsive",
        layoutTemplateId: "layout-responsive",
        versionNo: 1,
        status: "draft",
        docxFileId: "file-responsive",
        placeholderSchema: { bills: [] },
        draftRevision: 1,
        inspectionReport: {
          sourceRevision: 1,
          placeholders: ["contract.name"],
          hasBillLoop: false,
          missingRequiredPlaceholders: [],
          unknownPlaceholders: [],
          blockingErrors: [],
          warnings: []
        },
        inspectionRevision: 1,
        previewPdfFileId: null,
        latestPreview: null
      }]
    })
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

async function assertPageFrame(page: Page) {
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
}

test("合同模板治理子页面在六档桌面窗口中保持局部横向滚动", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await mockSession(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  mkdirSync(screenshotDir, { recursive: true });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    await page.goto("/合同模板库/编号规则");
    await expect(page.getByRole("heading", { name: "合同编号规则" })).toBeVisible();
    await expect(page.getByText("材料采购合同编号")).toBeVisible();
    await assertPageFrame(page);
    if (viewport.width <= 1280) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `contract-number-rules-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/合同模板库/标准条款");
    await expect(page.getByRole("heading", { name: "标准条款库" })).toBeVisible();
    await expect(page.getByText("材料付款标准条款")).toBeVisible();
    await assertPageFrame(page);
    if (viewport.width <= 1280) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `standard-clause-library-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/合同业务场景");
    await expect(page.getByRole("heading", { name: "合同业务场景" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "材料采购·模板映射" })).toBeVisible();
    await assertPageFrame(page);
    if (viewport.width <= 1180) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content").first());
    }
    await page.screenshot({
      path: path.join(screenshotDir, `contract-scenario-governance-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/合同模板库/版式/layout-responsive");
    await expect(page.getByRole("heading", { name: "版式模板治理" })).toBeVisible();
    await expect(page.getByPlaceholder("请输入版式名称")).toHaveValue("材料采购标准版式");
    await assertPageFrame(page);
    if (viewport.width <= 1024) {
      await expectHorizontalScrollOwner(page.locator(".inspection-workspace"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `layout-template-editor-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  expect(pageErrors).toEqual([]);
});
