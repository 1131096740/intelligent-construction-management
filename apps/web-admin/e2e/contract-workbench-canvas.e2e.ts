import path from "node:path";
import { expect, test } from "@playwright/test";
import {
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

test("合同工作台以正文为中央画布并在侧栏保留业务与就绪检查", async ({ page }, testInfo) => {
  let privateFileCalls = 0;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "contract-staff-1",
          name: "合同经办人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["contract_staff"],
          globalRoleKeys: ["contract_staff"]
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
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-1/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/files/**", (route) => {
    privateFileCalls += 1;
    return route.abort();
  });
  await page.route("**/api/contract-workbench/contract-1", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract: {
          id: "contract-1",
          temporaryCode: "草稿-20260712-0001",
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          ownerUserId: "contract-staff-1",
          name: "科技园钢材采购合同"
        },
        version: {
          id: "version-1",
          versionNo: 1,
          status: "draft",
          draftRevision: 3,
          amountCents: "120000000",
          pricingNature: "fixed_total",
          amountSource: "bill_sum",
          draftData: {},
          clauseSnapshot: [],
          templateSnapshot: {
            fieldSchema: [],
            billSchema: [],
            clauseSchema: [],
            attachmentSchema: [],
            validationSchema: []
          }
        },
        parties: [],
        bills: [],
        paymentTerms: { originalText: "", stages: [] },
        checkpoints: [],
        documents: [
          {
            id: "document-current",
            purpose: "draft",
            status: "success",
            sourceRevision: 3,
            docxFileId: "docx-current",
            pdfFileId: "pdf-current",
            createdAt: "2026-07-12T06:00:00.000Z",
            completedAt: "2026-07-12T06:01:00.000Z"
          }
        ],
        readiness: {
          ready: false,
          blockingMessages: ["请补齐合同主体"],
          warningMessages: []
        }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/contracts/contract-1/workbench");
  await expect(page.getByRole("heading", { name: "合同正文画布" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "科技园钢材采购合同" }).last()).toBeVisible();
  await expect(page.getByText("正文可预览", { exact: true })).toBeVisible();
  await expect(page.getByText("就绪检查", { exact: true })).toBeVisible();
  await expect(
    page.locator(".readiness-panel").getByText("请补齐合同主体", { exact: true })
  ).toBeVisible();

  const desktopCanvas = await page.locator(".document-canvas-slot").boundingBox();
  const desktopSidebar = await page.locator(".business-sidebar").boundingBox();
  expect(desktopCanvas).not.toBeNull();
  expect(desktopSidebar).not.toBeNull();
  expect(desktopCanvas!.x).toBeLessThan(desktopSidebar!.x);
  await page.getByRole("button", { name: "安全打开正文" }).click();
  await expect(page.getByRole("heading", { name: "合同文档" })).toBeVisible();
  expect(privateFileCalls).toBe(0);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    const canvas = await page.locator(".document-canvas-slot").boundingBox();
    const sidebar = await page.locator(".business-sidebar").boundingBox();
    expect(canvas).not.toBeNull();
    expect(sidebar).not.toBeNull();
    if (viewport.width >= 1440) {
      expect(canvas!.x).toBeLessThan(sidebar!.x);
    } else {
      expect(sidebar!.y).toBeGreaterThan(canvas!.y);
    }
    await expect(page.getByText("就绪检查", { exact: true })).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(screenshotDir, `contract-workbench-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }
});

test("手工金额可编辑且小型清单可直接新增行", async ({ page }, testInfo) => {
  let savedDraftBody: Record<string, unknown> | null = null;
  let addedRowBody: Record<string, unknown> | null = null;
  let billRevision = 1;
  let billRows: Array<Record<string, unknown>> = [];
  let workbenchReadCount = 0;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "contract-staff-1",
          name: "合同经办人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["contract_staff"],
          globalRoleKeys: ["contract_staff"]
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
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-edit/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-edit", async (route) => {
    savedDraftBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: { id: "version-edit", draftRevision: 4 } })
    });
  });
  await page.route("**/api/contract-bills/bill-1/rows", async (route) => {
    addedRowBody = route.request().postDataJSON() as Record<string, unknown>;
    billRevision += 1;
    billRows = [
      {
        rowKey: "row-1",
        itemName: addedRowBody.itemName,
        specification: addedRowBody.specification,
        unit: addedRowBody.unit,
        quantity: addedRowBody.quantity,
        unitPrice: addedRowBody.unitPrice,
        taxRatePercent: addedRowBody.taxRatePercent,
        customData: addedRowBody.customData
      }
    ];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ row: billRows[0], billRevision })
    });
  });
  await page.route("**/api/contract-workbench/contract-edit", (route) => {
    workbenchReadCount += 1;
    const manualAmountCents =
      typeof savedDraftBody?.manualAmountCents === "string"
        ? savedDraftBody.manualAmountCents
        : "0";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract: {
          id: "contract-edit",
          temporaryCode: "草稿-20260714-0001",
          code: null,
          projectId: "project-1",
          contractTypeKey: "labor_subcontract",
          ownerUserId: "contract-staff-1",
          name: "云谷项目劳务分包合同"
        },
        version: {
          id: "version-edit",
          versionNo: 1,
          status: "draft",
          changeType: "original",
          draftRevision: 4,
          amountCents: manualAmountCents,
          pricingNature: "fixed_total",
          amountSource: "manual",
          manualAmountCents,
          draftData: {},
          clauseSnapshot: [],
          templateSnapshot: {
            fieldSchema: [],
            billSchema: [],
            clauseSchema: [],
            attachmentSchema: [],
            validationSchema: []
          }
        },
        parties: [],
        bills: [
          {
            id: "bill-1",
            billKey: "labor",
            name: "劳务分包价格清单",
            revision: billRevision,
            taxInclusiveAmountCents: "0",
            schemaSnapshot: {
              columns: [{ key: "workContent", label: "工作内容", required: true }]
            },
            rows: billRows
          }
        ],
        paymentTerms: { originalText: "", stages: [] },
        checkpoints: [],
        documents: [],
        readiness: { ready: false, blockingMessages: [], warningMessages: [] }
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/contracts/contract-edit/workbench");
  await page.locator(".business-tabs").getByText("计价", { exact: true }).click();

  const manualAmount = page.getByPlaceholder("如 100000.00");
  await manualAmount.fill("123456.78");
  await expect(manualAmount).toHaveValue("123456.78");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect.poll(() => savedDraftBody?.manualAmountCents).toBe("12345678");
  expect(savedDraftBody).toMatchObject({
    pricingNature: "fixed_total",
    amountSource: "manual",
    manualAmountCents: "12345678"
  });
  await page.screenshot({
    path: process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR
      ? `${process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR}/contract-workbench-pricing-fixed.png`
      : testInfo.outputPath("contract-workbench-pricing-fixed.png"),
    fullPage: true
  });

  await page.locator(".business-tabs").getByText("清单", { exact: true }).click();
  await page.getByRole("button", { name: "新增行", exact: true }).click();
  expect(addedRowBody).toBeNull();
  await expect(page.getByText("已新增空白行，请填写后保存", { exact: true })).toBeVisible();

  const newRow = page.locator(".bill-table tbody tr").last();
  const inputs = newRow.locator("input");
  await inputs.nth(0).fill("临建围挡");
  await inputs.nth(1).fill("高2.5米");
  await inputs.nth(2).fill("米");
  await inputs.nth(3).fill("120");
  await inputs.nth(4).fill("85.50");
  await inputs.nth(5).fill("现场制作安装");
  await newRow.locator("select").selectOption("3");
  await newRow.getByRole("button", { name: "保存", exact: true }).click();

  await expect.poll(() => addedRowBody).not.toBeNull();
  expect(addedRowBody).toMatchObject({
    expectedBillRevision: 1,
    itemName: "临建围挡",
    specification: "高2.5米",
    unit: "米",
    quantity: "120",
    unitPrice: "85.50",
    taxRatePercent: "3",
    customData: { workContent: "现场制作安装" }
  });
  await expect(page.locator(".bill-table tbody tr").last().locator("input").nth(0)).toHaveValue("临建围挡");
  await expect.poll(() => workbenchReadCount).toBeGreaterThanOrEqual(2);
  await page.locator(".table-wrap").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR
      ? `${process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR}/contract-workbench-bill-row-fixed.png`
      : testInfo.outputPath("contract-workbench-bill-row-fixed.png"),
    fullPage: true
  });
});
