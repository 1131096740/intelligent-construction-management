import path from "node:path";
import { expect, test } from "@playwright/test";
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

interface DraftLine {
  sourceType: "contract_bill_row" | "manual_adjustment";
  contractBillRowId?: string;
  name?: string;
  quantity?: string;
  amountCents?: string;
  reason?: string;
  remark?: string;
  sortOrder?: number;
}

test("结算工作台只提交本期选中明细并以后端核算为准", async ({ page }, testInfo) => {
  const settlementTemplateVersionId = "settlement-template-version-1";
  const previewBodies: Array<{ settlementLines: DraftLine[] }> = [];
  const importPreviewBodies: Array<{
    fileId: string;
    settlementTemplateVersionId: string;
  }> = [];
  const frozenImportedLines: DraftLine[] = [
    {
      sourceType: "contract_bill_row",
      contractBillRowId: "row-normal",
      quantity: "3",
      remark: "Excel 自动计价"
    },
    {
      sourceType: "contract_bill_row",
      contractBillRowId: "row-manual",
      amountCents: "40000",
      reason: "Excel 签认计价"
    },
    {
      sourceType: "manual_adjustment",
      name: "Excel 质量扣款",
      amountCents: "-5000",
      reason: "现场复核"
    }
  ];
  const importedCanonical = {
    contractVersionId: "version-1",
    amountCents: "65000",
    lines: [
      {
        sourceType: "contract_bill_row",
        calculationMode: "normal_auto",
        contractBillRowId: "row-normal",
        name: "螺纹钢",
        unit: "t",
        quantity: "3",
        unitPrice: "100.000000",
        amountCents: "30000",
        reason: null,
        remark: "Excel 自动计价",
        sortOrder: 1
      },
      {
        sourceType: "contract_bill_row",
        calculationMode: "manual_amount",
        contractBillRowId: "row-manual",
        name: "暂定价安装项",
        unit: "项",
        quantity: null,
        unitPrice: null,
        amountCents: "40000",
        reason: "Excel 签认计价",
        remark: null,
        sortOrder: 2
      },
      {
        sourceType: "manual_adjustment",
        calculationMode: "manual_adjustment",
        contractBillRowId: null,
        name: "Excel 质量扣款",
        unit: null,
        quantity: null,
        unitPrice: null,
        amountCents: "-5000",
        reason: "现场复核",
        remark: null,
        sortOrder: 3
      }
    ]
  };
  let uploadCalls = 0;
  let templateDownloadCalls = 0;
  let errorDownloadCalls = 0;
  let resultDownloadCalls = 0;
  let importApplyCalls = 0;
  let createdBody: Record<string, unknown> | null = null;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "budget-staff-1",
          name: "预算经办人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["budget_staff"],
          globalRoleKeys: ["budget_staff"]
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
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "P001", name: "科技园项目" }])
    })
  );
  await page.route("**/api/contracts/settlement-create-options?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          contractId: "contract-1",
          contractVersionId: "version-1",
          contractNo: "HT-2026-001",
          contractName: "科技园钢材采购合同",
          counterparty: "城建物资公司",
          amountCents: "12500000",
          versionLabel: "v1",
          contractStatus: "effective",
          contractStatusLabel: "已生效",
          source: "system",
          sourceLabel: "系统合同",
          takeoverLevel: null,
          takeoverStatus: null,
          takeoverStatusLabel: null,
          historicalBalanceConfirmedAt: null,
          canCreateSettlement: true,
          settlementUnavailableReason: null,
          canCreatePayment: false,
          paymentUnavailableReason: "尚无生效结算",
          settlements: []
        }
      ])
    })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/source-lines",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractVersionId: "version-1",
          contractId: "contract-1",
          projectId: "project-1",
          contractAmountCents: "12500000",
          summary: {
            rowCount: 3,
            exceptionCount: 1,
            contractAmountCents: "12500000",
            settledAmountCents: "2000000",
            remainingAmountCents: "10500000"
          },
          rows: [
            {
              id: "row-normal",
              billId: "bill-1",
              billKey: "steel",
              billName: "钢材清单",
              rowKey: "steel-001",
              sortOrder: 1,
              itemCode: "A-001",
              itemName: "螺纹钢",
              specification: "HRB400",
              unit: "t",
              quantity: "10",
              unitPrice: "100.000000",
              taxRatePercent: "13",
              amountRole: "included",
              pricingMode: "tax_inclusive",
              calculationMode: "normal_auto",
              contractAmountCents: "100000",
              settledQuantity: "2",
              previousSettledQuantity: "2",
              remainingQuantity: "8",
              settledAmountCents: "20000",
              remainingAmountCents: "80000",
              provisional: false,
              settlementBasis: null,
              exception: null,
              exceptions: []
            },
            {
              id: "row-manual",
              billId: "bill-2",
              billKey: "provisional",
              billName: "暂定价清单",
              rowKey: "provisional-001",
              sortOrder: 2,
              itemCode: "B-001",
              itemName: "暂定价安装项",
              specification: null,
              unit: "项",
              quantity: "5",
              unitPrice: "0",
              taxRatePercent: "0",
              amountRole: "provisional",
              pricingMode: "tax_exclusive",
              calculationMode: "manual_amount",
              contractAmountCents: "5000000",
              settledQuantity: "1",
              previousSettledQuantity: "1",
              remainingQuantity: "4",
              settledAmountCents: "1000000",
              remainingAmountCents: "4000000",
              provisional: true,
              settlementBasis: "现场签认",
              exception: {
                code: "negative_remaining_amount",
                message: "历史结算金额超出该行合同金额，请复核。"
              },
              exceptions: [
                {
                  code: "negative_remaining_amount",
                  message: "历史结算金额超出该行合同金额，请复核。"
                }
              ]
            },
            {
              id: "row-unselected",
              billId: "bill-3",
              billKey: "reference",
              billName: "参考价清单",
              rowKey: "reference-001",
              sortOrder: 3,
              itemCode: "C-001",
              itemName: "参考价设备",
              specification: null,
              unit: "台",
              quantity: "2",
              unitPrice: "0",
              taxRatePercent: "0",
              amountRole: "reference",
              pricingMode: "tax_exclusive",
              calculationMode: "manual_amount",
              contractAmountCents: "7400000",
              settledQuantity: "0",
              previousSettledQuantity: "0",
              remainingQuantity: "2",
              settledAmountCents: "0",
              remainingAmountCents: "7400000",
              provisional: false,
              settlementBasis: null,
              exception: null,
              exceptions: []
            }
          ]
        })
      })
  );
  await page.route(
    "**/api/settlement-workbench/projects/project-1/contract-versions/version-1/template-recommendations",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          selectionMode: "automatic",
          selected: {
            templateVersionId: settlementTemplateVersionId,
            templateName: "材料采购月度结算模板",
            templateCode: "SETTLEMENT-MATERIAL",
            versionNo: 2,
            reasons: ["合同类型匹配", "计价方式匹配"]
          },
          choices: [
            {
              templateVersionId: settlementTemplateVersionId,
              templateName: "材料采购月度结算模板",
              templateCode: "SETTLEMENT-MATERIAL",
              versionNo: 2,
              reasons: ["合同类型匹配", "计价方式匹配"]
            }
          ]
        })
      })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/preview",
    async (route) => {
      const body = route.request().postDataJSON() as { settlementLines: DraftLine[] };
      previewBodies.push(body);
      const lines = body.settlementLines.map((line, index) => {
        const calculationMode =
          line.sourceType === "manual_adjustment"
            ? "manual_adjustment"
            : line.contractBillRowId === "row-normal"
              ? "normal_auto"
              : "manual_amount";
        const amountCents =
          calculationMode === "normal_auto"
            ? String(BigInt(line.quantity ?? "0") * 10000n)
            : (line.amountCents ?? "0");
        return {
          sourceType: line.sourceType,
          calculationMode,
          contractBillRowId: line.contractBillRowId ?? null,
          name:
            line.name ??
            (line.contractBillRowId === "row-normal" ? "螺纹钢" : "暂定价安装项"),
          unit: line.sourceType === "contract_bill_row" ? "项" : null,
          quantity: line.quantity ?? null,
          unitPrice: calculationMode === "normal_auto" ? "100.000000" : null,
          amountCents,
          reason: line.reason ?? null,
          remark: line.remark ?? null,
          sortOrder: line.sortOrder ?? index + 1
        };
      });
      const amountCents = lines.reduce((sum, line) => sum + BigInt(line.amountCents), 0n);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractVersionId: "version-1",
          amountCents: String(amountCents),
          lines
        })
      });
    }
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/import-template",
    (route) => {
      templateDownloadCalls += 1;
      return route.fulfill({
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: {
          "Content-Disposition":
            "attachment; filename*=UTF-8''%E6%9C%AC%E6%9C%9F%E7%BB%93%E7%AE%97%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx"
        },
        body: "template-xlsx"
      });
    }
  );
  await page.route("**/api/files", (route) => {
    uploadCalls += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: uploadCalls === 1 ? "file-error" : "file-clean" })
    });
  });
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/imports/preview",
    async (route) => {
      const body = route.request().postDataJSON() as {
        fileId: string;
        settlementTemplateVersionId: string;
      };
      importPreviewBodies.push(body);
      if (body.fileId === "file-error") {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            importId: "import-error",
            sourceRevision: "revision-error",
            selectedCount: 1,
            settlementLines: [],
            canonical: null,
            errors: [{ row: 3, column: "本期数量", message: "正常计价行必须填写本期数量" }]
          })
        });
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          importId: "import-clean",
          sourceRevision: "revision-clean",
          selectedCount: frozenImportedLines.length,
          settlementLines: frozenImportedLines,
          canonical: importedCanonical,
          errors: []
        })
      });
    }
  );
  await page.route(
    "**/api/settlement-workbench/projects/project-1/imports/import-clean/apply",
    (route) => {
      importApplyCalls += 1;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          importId: "import-clean",
          status: "applied",
          result: {
            contractVersionId: "version-1",
            settlementTemplateVersionId,
            sourceRevision: "revision-clean",
            settlementLines: frozenImportedLines,
            canonical: importedCanonical
          }
        })
      });
    }
  );
  await page.route(
    "**/api/settlement-workbench/projects/project-1/imports/import-error/errors.xlsx",
    (route) => {
      errorDownloadCalls += 1;
      return route.fulfill({
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: {
          "Content-Disposition":
            "attachment; filename*=UTF-8''%E7%BB%93%E7%AE%97%E5%AF%BC%E5%85%A5%E9%94%99%E8%AF%AF.xlsx"
        },
        body: "error-xlsx"
      });
    }
  );
  await page.route(
    "**/api/settlement-workbench/projects/project-1/imports/import-clean/result.xlsx",
    (route) => {
      resultDownloadCalls += 1;
      return route.fulfill({
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: {
          "Content-Disposition":
            "attachment; filename*=UTF-8''%E7%BB%93%E7%AE%97%E5%AF%BC%E5%85%A5%E7%BB%93%E6%9E%9C.xlsx"
        },
        body: "result-xlsx"
      });
    }
  );
  await page.route("**/api/settlements", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createdBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "settlement-new", code: "JS-E2E-019" })
    });
  });
  await page.route("**/api/settlements/settlement-new", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "E2E 仅验证创建后路由" })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/结算工作台");
  await expect(page.getByRole("heading", { name: "结算工作台" })).toBeVisible();

  const selects = page.locator(".basic-fields .t-select");
  await selects.nth(0).click();
  await page.getByText("P001 · 科技园项目", { exact: true }).last().click();
  await selects.nth(1).click();
  await page
    .getByText("HT-2026-001 · 科技园钢材采购合同 · 城建物资公司", { exact: true })
    .last()
    .click();
  await expect(page.getByText("已自动匹配", { exact: true })).toBeVisible();
  await expect(page.getByText("材料采购月度结算模板 · V2", { exact: true })).toBeVisible();

  const templateDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载中文模板" }).click();
  await expect((await templateDownloadPromise).suggestedFilename()).toBe("本期结算导入模板.xlsx");
  expect(templateDownloadCalls).toBe(1);

  const normalCheckbox = page.getByRole("checkbox", { name: "选择 螺纹钢" });
  const manualCheckbox = page.getByRole("checkbox", { name: "选择 暂定价安装项" });
  const unselectedCheckbox = page.getByRole("checkbox", { name: "选择 参考价设备" });
  await expect(normalCheckbox).not.toBeChecked();
  await expect(manualCheckbox).not.toBeChecked();
  await expect(unselectedCheckbox).not.toBeChecked();

  await normalCheckbox.click({ force: true });
  await page.getByPlaceholder("本期数量").fill("9");
  await page.getByPlaceholder("本期数量").press("Tab");
  await normalCheckbox.click({ force: true });
  await normalCheckbox.click({ force: true });
  await expect(page.getByPlaceholder("本期数量")).toHaveValue("");
  await normalCheckbox.click({ force: true });

  await page.getByRole("button", { name: "粘贴多行" }).click();
  await page
    .getByPlaceholder("普通行：本期数量<Tab>备注；人工计价行：本期数量<Tab>本期金额（元）<Tab>备注。每行对应一条合同清单。")
    .fill("2\t钢筋备注\n\t500\t暂定价备注");
  await page.getByRole("button", { name: "应用粘贴" }).click();
  await expect(normalCheckbox).toBeChecked();
  await expect(manualCheckbox).toBeChecked();
  await expect(unselectedCheckbox).not.toBeChecked();

  await page.getByPlaceholder("输入要应用到已选行的备注").fill("本期现场确认");
  await page.getByRole("button", { name: "批量备注" }).click();
  await expect(page.getByPlaceholder("本期备注")).toHaveCount(2);
  await expect(page.getByPlaceholder("本期备注").first()).toHaveValue("本期现场确认");

  await page.getByRole("button", { name: "新增人工调整" }).click();
  await page.getByPlaceholder("调整名称").fill("质量扣款");
  await page.getByPlaceholder("可正可负（元）").fill("-10");
  await page.getByPlaceholder("必填原因").fill("现场检查扣款");
  await page.getByPlaceholder("必填原因").press("Tab");

  await expect(page.getByText("¥690.00", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "异常 1" }).click();
  await expect(page.getByText("结算异常与待处理项", { exact: true })).toBeVisible();
  await expect(page.getByText("历史结算金额超出该行合同金额，请复核。")).toBeVisible();
  await page.keyboard.press("Escape");

  const manualPreview = previewBodies.at(-1)!;
  expect(manualPreview.settlementLines).toHaveLength(3);
  expect(manualPreview.settlementLines.map((line) => line.contractBillRowId)).not.toContain(
    "row-unselected"
  );
  expect(manualPreview.settlementLines[0]).not.toHaveProperty("amountCents");

  const importFileInput = page.locator(".import-panel input[type=file]");
  await importFileInput.setInputFiles({
    name: "有错误的本期结算.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("error-xlsx")
  });
  await expect(page.getByText("正常计价行必须填写本期数量", { exact: true })).toBeVisible();
  await expect(page.getByText("预检未通过", { exact: true })).toBeVisible();
  await expect(
    page.locator(".import-panel").getByRole("button", { name: "确认应用导入" })
  ).toBeDisabled();

  const errorDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载错误表" }).click();
  await expect((await errorDownloadPromise).suggestedFilename()).toBe("结算导入错误.xlsx");
  expect(errorDownloadCalls).toBe(1);

  await importFileInput.setInputFiles({
    name: "通过预检的本期结算.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("clean-xlsx")
  });
  await expect(page.getByText("预检通过，待应用", { exact: true })).toBeVisible();
  await expect(page.getByText("¥650.00", { exact: true }).first()).toBeVisible();
  await page.locator(".import-panel").getByRole("button", { name: "确认应用导入" }).click();
  await expect(page.getByText("已应用冻结结果", { exact: true })).toBeVisible();
  await expect(normalCheckbox).toBeChecked();
  await expect(manualCheckbox).toBeChecked();
  await expect(unselectedCheckbox).not.toBeChecked();
  await expect(page.getByPlaceholder("本期数量").first()).toHaveValue("3");
  await expect(page.getByPlaceholder("金额（元）")).toHaveValue("400.00");
  await expect(page.getByPlaceholder("调整名称")).toHaveValue("Excel 质量扣款");
  await expect(page.getByPlaceholder("可正可负（元）")).toHaveValue("-50.00");
  await page
    .locator(".import-panel")
    .getByRole("button", { name: "重新应用已冻结结果" })
    .click();
  expect(importApplyCalls).toBe(2);
  await expect(page.getByPlaceholder("本期数量").first()).toHaveValue("3");

  const resultDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载预检结果" }).click();
  await expect((await resultDownloadPromise).suggestedFilename()).toBe("结算导入结果.xlsx");
  expect(resultDownloadCalls).toBe(1);
  await expect(page.getByText("import-clean", { exact: true })).toHaveCount(0);
  await expect(page.getByText("version-1", { exact: true })).toHaveCount(0);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await expectHorizontalScrollOwner(page.locator(".table-shell .t-table__content"));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const adjustmentBox = await page.locator(".adjustment-section").boundingBox();
    const footerBox = await page.locator(".workbench-footer").boundingBox();
    expect(adjustmentBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(adjustmentBox!.y + adjustmentBox!.height).toBeLessThanOrEqual(footerBox!.y);
    await page.screenshot({
      path: path.join(screenshotDir, `settlement-workbench-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  await page.locator(".workbench-footer").getByRole("button", { name: "提交结算" }).click();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe("/结算管理/settlement-new");

  expect(uploadCalls).toBe(2);
  expect(importPreviewBodies).toEqual([
    { fileId: "file-error", settlementTemplateVersionId },
    { fileId: "file-clean", settlementTemplateVersionId }
  ]);
  expect(createdBody).toEqual(expect.objectContaining({
    contractVersionId: "version-1",
    settlementTemplateVersionId,
    settlementLines: frozenImportedLines
  }));
  expect(createdBody).not.toHaveProperty("amountCents");
});
