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
          taxFacts: {
            invoiceType: "vat_special",
            taxMode: "single_rate",
            defaultTaxRatePercent: "13",
            status: "draft",
            source: "contract_document",
            revision: 0,
            frozenAt: null
          },
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
          taxFacts: {
            invoiceType: "vat_special",
            taxMode: "single_rate",
            defaultTaxRatePercent: "3",
            status: "draft",
            source: "contract_document",
            revision: 0,
            frozenAt: null
          },
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
            amountRole: "included",
            pricingMode: "tax_inclusive",
            pricingNature: "fixed_total",
            amountLimitType: "capped",
            taxMode: "single_rate",
            defaultTaxRatePercent: "3",
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

  const manualAmount = page.getByPlaceholder("请输入含税合同总价");
  await manualAmount.fill("123456.78");
  await expect(manualAmount).toHaveValue("123456.78");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect.poll(() => savedDraftBody?.manualAmountCents).toBe("12345678");
  expect(savedDraftBody).toMatchObject({
    pricingNature: "fixed_total",
    amountSource: "manual",
    manualAmountCents: "12345678"
  });
  const screenshotDir =
    process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByPlaceholder("选择增值税发票类型")).toHaveValue("增值税专用发票");
    await expect(page.getByPlaceholder("选择常用税率")).toHaveValue("3%");
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `contract-workbench-tax-pricing-${viewport.width}x${viewport.height}.png`
      ),
      fullPage: true
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
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
  await expect(inputs.nth(5)).toBeDisabled();
  await expect(inputs.nth(5)).toHaveValue("继承合同税率（3%）");
  await inputs.nth(6).fill("现场制作安装");
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
    taxRateSource: "version_default",
    customData: { workContent: "现场制作安装" }
  });
  await expect(page.locator(".bill-table tbody tr").last().locator("input").nth(0)).toHaveValue("临建围挡");
  await expect.poll(() => workbenchReadCount).toBeGreaterThanOrEqual(2);
  await page.locator(".table-wrap").evaluate((element) => {
    element.scrollLeft = 0;
  });
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `contract-workbench-bill-row-${viewport.width}x${viewport.height}.png`
      ),
      fullPage: true
    });
  }
});

test("稳定展示固定总价、多税率和无限额框架计价场景", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const workbenches: Record<string, Record<string, unknown>> = {
    "contract-fixed": scenarioWorkbench({
      id: "contract-fixed",
      name: "固定总价咨询合同",
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountCents: "50000000",
      manualAmountCents: "50000000",
      taxMode: "single_rate",
      defaultTaxRatePercent: "6",
      amountLimitType: "capped",
      bills: []
    }),
    "contract-multi": scenarioWorkbench({
      id: "contract-multi",
      name: "多税率材料采购合同",
      pricingNature: "unit_price",
      amountSource: "bill_sum",
      amountCents: "1090000",
      manualAmountCents: null,
      taxMode: "multiple_rate",
      defaultTaxRatePercent: "13",
      amountLimitType: "capped",
      bills: [
        scenarioBill({
          id: "bill-multi",
          taxMode: "multiple_rate",
          defaultTaxRatePercent: "13",
          rows: [
            {
              rowKey: "row-multi",
              itemName: "安装服务",
              specification: "现场安装",
              unit: "项",
              quantity: "1",
              unitPrice: "10000.00",
              taxRatePercent: "9",
              taxRateSource: "row_override",
              customData: {}
            }
          ]
        })
      ]
    }),
    "contract-framework": scenarioWorkbench({
      id: "contract-framework",
      name: "机械租赁框架合同",
      pricingNature: "framework",
      amountSource: "bill_sum",
      amountCents: "0",
      manualAmountCents: null,
      taxMode: "single_rate",
      defaultTaxRatePercent: "13",
      amountLimitType: "unlimited",
      bills: [
        scenarioBill({
          id: "bill-framework",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          rows: [
            {
              rowKey: "row-framework",
              itemName: "挖掘机租赁",
              specification: "200 型",
              unit: "台班",
              quantity: null,
              unitPrice: "1200.00",
              taxRatePercent: "13",
              taxRateSource: "version_default",
              customData: {}
            }
          ]
        })
      ]
    })
  };

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
  await page.route("**/api/contract-workbench/**", (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const key = parts.at(-1) ?? "";
    if (key === "negotiation-rounds") {
      return route.fulfill({ contentType: "application/json", body: "[]" });
    }
    const body = workbenches[key];
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(body ?? { message: "未找到场景" })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  const screenshotDir = process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR ?? testInfo.outputDir;

  await page.goto("/contracts/contract-fixed/workbench");
  await page.locator(".business-tabs").getByText("计价", { exact: true }).click();
  await expect(page.getByPlaceholder("请输入含税合同总价")).toHaveValue("500000.00");
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "contract-workbench-fixed-total-no-bill-1440x900.png"),
    fullPage: true
  });

  await page.goto("/contracts/contract-multi/workbench");
  await page.locator(".business-tabs").getByText("计价", { exact: true }).click();
  await expect(page.getByPlaceholder("选择计税模式")).toHaveValue("特殊多税率");
  await page.locator(".business-tabs").getByText("清单", { exact: true }).click();
  await expect(page.getByPlaceholder("例外税率%")).toHaveValue("9");
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "contract-workbench-multiple-rate-1440x900.png"),
    fullPage: true
  });

  await page.goto("/contracts/contract-framework/workbench");
  await page.locator(".business-tabs").getByText("计价", { exact: true }).click();
  await expect(
    page.getByText("不设合同总价；按实际发生量结算", { exact: true })
  ).toBeVisible();
  await page.locator(".business-tabs").getByText("清单", { exact: true }).click();
  await expect(page.getByText("预计含税合计", { exact: true })).toBeVisible();
  await expect(page.locator(".bill-table tbody tr").first().locator("input").nth(3)).toHaveValue("");
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "contract-workbench-unlimited-framework-1440x900.png"),
    fullPage: true
  });
});

function scenarioWorkbench(input: {
  id: string;
  name: string;
  pricingNature: string;
  amountSource: string;
  amountCents: string;
  manualAmountCents: string | null;
  taxMode: "single_rate" | "multiple_rate";
  defaultTaxRatePercent: string;
  amountLimitType: "capped" | "unlimited";
  bills: Array<Record<string, unknown>>;
}) {
  return {
    contract: {
      id: input.id,
      temporaryCode: `草稿-${input.id}`,
      code: null,
      projectId: "project-1",
      contractTypeKey: "general_contract",
      ownerUserId: "contract-staff-1",
      name: input.name
    },
    version: {
      id: `version-${input.id}`,
      versionNo: 1,
      status: "draft",
      changeType: "original",
      draftRevision: 1,
      amountCents: input.amountCents,
      pricingNature: input.pricingNature,
      amountSource: input.amountSource,
      manualAmountCents: input.manualAmountCents,
      amountLimitType: input.amountLimitType,
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: input.taxMode,
        defaultTaxRatePercent: input.defaultTaxRatePercent,
        status: "draft",
        source: "contract_document",
        revision: 0,
        frozenAt: null
      },
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
    bills: input.bills,
    paymentTerms: { originalText: "", stages: [] },
    checkpoints: [],
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] }
  };
}

function scenarioBill(input: {
  id: string;
  taxMode: "single_rate" | "multiple_rate";
  defaultTaxRatePercent: string;
  rows: Array<Record<string, unknown>>;
}) {
  return {
    id: input.id,
    billKey: input.id,
    name: "合同价格清单",
    revision: 1,
    taxInclusiveAmountCents: "0",
    amountRole: "included",
    pricingMode: "tax_inclusive",
    pricingNature: "unit_price",
    amountLimitType: "capped",
    taxMode: input.taxMode,
    defaultTaxRatePercent: input.defaultTaxRatePercent,
    schemaSnapshot: { columns: [] },
    rows: input.rows
  };
}
