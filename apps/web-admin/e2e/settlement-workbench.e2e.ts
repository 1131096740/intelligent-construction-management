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
    submissionBlockers: [],
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
  let savedDraftBody: Record<string, unknown> | null = null;
  let submittedDraftBody: Record<string, unknown> | null = null;

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
              taxExclusiveUnitPrice: "88.50",
              pricingFactStatus: "confirmed",
              calculationAvailable: true,
              submissionBlocker: null,
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
              unitPrice: "100.00",
              taxRatePercent: "13",
              taxExclusiveUnitPrice: "88.50",
              pricingFactStatus: "confirmed",
              calculationAvailable: true,
              submissionBlocker: null,
              amountRole: "provisional",
              pricingMode: "tax_inclusive",
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
              unitPrice: "100.00",
              taxRatePercent: "13",
              taxExclusiveUnitPrice: "88.50",
              pricingFactStatus: "confirmed",
              calculationAvailable: true,
              submissionBlocker: null,
              amountRole: "reference",
              pricingMode: "tax_inclusive",
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
    "**/api/settlement-workbench/contract-versions/version-1/participant-options",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        route: "material_mechanical",
        options: [{
          userId: "material-user-1",
          name: "王物资",
          roleKey: "material_staff",
          roleLabel: "物资员"
        }]
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
          lines,
          submissionBlockers: []
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
      body: JSON.stringify({
        id: uploadCalls === 1
          ? "file-error"
          : uploadCalls === 2
            ? "file-clean"
            : "file-counterparty"
      })
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
  await page.route("**/api/projects/project-1/settlement-drafts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    savedDraftBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "draft-e2e",
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1",
        paymentTermsVersionId: "payment-terms-version-1",
        settlementTemplateVersionId,
        code: String(savedDraftBody.code),
        periodLabel: String(savedDraftBody.periodLabel),
        isFinal: false,
        finalCumulativeAmountCents: null,
        lines: savedDraftBody.settlementLines,
        revision: 1,
        status: "draft",
        ownerUserId: "contract-staff-1",
        submittedSettlementId: null,
        submittedAt: null,
        createdAt: "2026-07-17T08:00:00.000Z",
        updatedAt: "2026-07-17T08:00:00.000Z"
      })
    });
  });
  await page.route(
    "**/api/projects/project-1/settlement-drafts/draft-e2e/approval-submission",
    async (route) => {
      submittedDraftBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "settlement-new", code: "JS-E2E-019" })
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/settlement-drafts/draft-e2e/frozen-document",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(settlementSignedDocument(
        "frozen-e2e",
        "file-frozen-e2e",
        "frozen_counterparty_copy",
        1
      ))
    })
  );
  await page.route(
    "**/api/projects/project-1/settlement-drafts/draft-e2e/counterparty-signed-documents",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(settlementSignedDocument(
        "counterparty-e2e",
        "file-counterparty",
        "counterparty_signed_original",
        1
      ))
    })
  );
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
  await page.getByPlaceholder("本期数量", { exact: true }).fill("9");
  await page.getByPlaceholder("本期数量", { exact: true }).press("Tab");
  await normalCheckbox.click({ force: true });
  await normalCheckbox.click({ force: true });
  await expect(page.getByPlaceholder("本期数量", { exact: true })).toHaveValue("");
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
  await expect(page.getByPlaceholder("金额（元）", { exact: true })).toHaveValue("400.00");
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

  await page.locator(".participant-select .t-select").click();
  await page.getByText("王物资 · 物资员", { exact: true }).last().click();
  await page.getByRole("button", { name: "保存当前结算事实", exact: true }).click();
  await expect(page.getByText("结算草稿已保存；尚未占用合同额度，也未发起审批。")).toBeVisible();
  await page.getByRole("button", { name: "生成当前修订版", exact: true }).click();
  await expect(page.getByText("R1 · 2 页", { exact: true })).toBeVisible();
  await page.locator(".signed-pdf-panel input[type=file]").setInputFiles({
    name: "乙方签章扫描件.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("stable-counterparty-pdf")
  });
  await expect(page.getByText("已上传：乙方签章扫描件.pdf", { exact: true })).toBeVisible();
  await page.getByText("扫描件页数、页序与当前冻结版一致", { exact: true }).click();
  await page.getByText("乙方已在所有要求位置签字并填写日期", { exact: true }).click();
  await page.getByText("乙方已逐页盖章", { exact: true }).click();
  await page.getByText("多页文件已加盖骑缝章", { exact: false }).click();
  await page.getByRole("button", { name: "核对通过并关联扫描件", exact: true }).click();
  await expect(page.getByText("当前修订版已关联", { exact: true })).toBeVisible();

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await settleResponsiveLayout(page);
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

  await page.getByRole("button", { name: "提交结算审批", exact: true }).click();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe("/结算管理/settlement-new");

  expect(uploadCalls).toBe(3);
  expect(importPreviewBodies).toEqual([
    { fileId: "file-error", settlementTemplateVersionId },
    { fileId: "file-clean", settlementTemplateVersionId }
  ]);
  expect(savedDraftBody).toEqual(expect.objectContaining({
    contractVersionId: "version-1",
    settlementTemplateVersionId,
    settlementLines: frozenImportedLines.map((line, index) => ({
      ...line,
      sortOrder: index + 1
    }))
  }));
  expect(savedDraftBody).not.toHaveProperty("amountCents");
  expect(submittedDraftBody).toEqual({ expectedRevision: 1 });
});

test("税务事实缺失时保存草稿，确认后同一草稿可提交", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const settlementTemplateVersionId = "settlement-template-version-tax";
  let factsConfirmed = false;
  let draftRecord: Record<string, unknown> | null = null;
  let submittedDraftBody: Record<string, unknown> | null = null;

  await installSettlementWorkbenchBaseMocks(page, settlementTemplateVersionId);
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/source-lines",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractVersionId: "version-1",
          contractId: "contract-1",
          projectId: "project-1",
          contractAmountCents: "100000",
          summary: {
            rowCount: 1,
            exceptionCount: factsConfirmed ? 0 : 1,
            contractAmountCents: "100000",
            settledAmountCents: "0",
            remainingAmountCents: "100000"
          },
          rows: [
            {
              id: "row-tax-pending",
              billId: "bill-tax",
              billKey: "history",
              billName: "历史价格清单",
              rowKey: "history-001",
              sortOrder: 1,
              itemCode: "H-001",
              itemName: "历史单价待确认项",
              specification: "原合同扫描件待复核",
              unit: "项",
              quantity: "10",
              unitPrice: factsConfirmed ? "100.00" : null,
              taxRatePercent: factsConfirmed ? "13" : null,
              taxExclusiveUnitPrice: factsConfirmed ? "88.50" : null,
              pricingFactStatus: factsConfirmed ? "confirmed" : "unconfirmed",
              calculationAvailable: factsConfirmed,
              submissionBlocker: factsConfirmed
                ? null
                : {
                    code: "missing_unit_price",
                    message: "历史单价待确认项的含税单价尚未确认，请完成税务事实补录复核。"
                  },
              amountRole: "included",
              pricingMode: "tax_inclusive",
              calculationMode: "normal_auto",
              contractAmountCents: factsConfirmed ? "100000" : null,
              settledQuantity: "0",
              previousSettledQuantity: "0",
              remainingQuantity: "10",
              settledAmountCents: "0",
              remainingAmountCents: factsConfirmed ? "100000" : null,
              provisional: false,
              settlementBasis: "按实际发生量结算",
              exception: null,
              exceptions: []
            }
          ]
        })
      })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/preview",
    async (route) => {
      const body = route.request().postDataJSON() as { settlementLines: DraftLine[] };
      const quantity = body.settlementLines[0]?.quantity ?? "0";
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractVersionId: "version-1",
          amountCents: factsConfirmed ? String(BigInt(quantity) * 10000n) : null,
          submissionBlockers: factsConfirmed
            ? []
            : [
                {
                  code: "missing_unit_price",
                  contractBillRowId: "row-tax-pending",
                  message: "历史单价待确认项的含税单价尚未确认，请完成税务事实补录复核。"
                }
              ],
          lines: [
            {
              sourceType: "contract_bill_row",
              calculationMode: "normal_auto",
              contractBillRowId: "row-tax-pending",
              name: "历史单价待确认项",
              unit: "项",
              quantity,
              unitPrice: factsConfirmed ? "100.00" : null,
              amountCents: factsConfirmed ? String(BigInt(quantity) * 10000n) : null,
              reason: null,
              remark: null,
              sortOrder: 1
            }
          ]
        })
      });
    }
  );
  await page.route("**/api/projects/project-1/settlement-drafts**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isSubmission = url.pathname.endsWith("/approval-submission");
    const isItem = url.pathname.endsWith("/draft-tax");
    if (isSubmission) {
      submittedDraftBody = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "settlement-tax", code: "JS-TAX-001" })
      });
    }
    if (request.method() === "GET" && isItem) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(draftRecord)
      });
    }
    if (request.method() === "GET") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(draftRecord ? [draftRecord] : [])
      });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    const currentRevision =
      typeof draftRecord?.revision === "number" ? draftRecord.revision : 0;
    draftRecord = {
      id: "draft-tax",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      paymentTermsVersionId: "payment-terms-version-1",
      settlementTemplateVersionId,
      code: String(body.code),
      periodLabel: String(body.periodLabel),
      isFinal: false,
      finalCumulativeAmountCents: null,
      governanceVersion: 1,
      fieldReviewerUserId:
        typeof body.fieldReviewerUserId === "string" ? body.fieldReviewerUserId : null,
      fieldReviewerRoleKey:
        typeof body.fieldReviewerRoleKey === "string" ? body.fieldReviewerRoleKey : null,
      finalScopeCompleted: null,
      finalPriorSettlementsIncluded: null,
      finalNoOutstandingSettlements: null,
      finalWithinContractCap: null,
      finalNoFurtherOrdinarySettlements: null,
      lines: body.settlementLines,
      revision: currentRevision + 1,
      status: "draft",
      ownerUserId: "contract-staff-1",
      submittedSettlementId: null,
      submittedAt: null,
      createdAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:00:00.000Z",
      submissionBlockingReason: null,
      documents: {
        frozenDocument: null,
        counterpartySignedOriginal: null
      }
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(draftRecord)
    });
  });
  await page.route(
    "**/api/projects/project-1/settlement-drafts/draft-tax/frozen-document",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...settlementSignedDocument(
          "frozen-tax",
          "file-frozen-tax",
          "frozen_counterparty_copy",
          1
        ),
        settlementDraftId: "draft-tax"
      })
    })
  );
  await page.route(
    "**/api/projects/project-1/settlement-drafts/draft-tax/counterparty-signed-documents",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...settlementSignedDocument(
          "counterparty-tax",
          "file-counterparty-tax",
          "counterparty_signed_original",
          1
        ),
        settlementDraftId: "draft-tax"
      })
    })
  );
  await page.route("**/api/files", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "file-counterparty-tax", originalName: "乙方签章扫描件.pdf" })
  }));
  await page.route("**/api/settlements/settlement-tax", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "E2E 仅验证创建后路由" })
    })
  );

  await loginSettlementWorkbenchUser(page);
  await page.goto("/结算工作台");
  const selects = page.locator(".basic-fields .t-select");
  await selects.nth(0).click();
  await page.getByText("P001 · 科技园项目", { exact: true }).last().click();
  await selects.nth(1).click();
  await page
    .getByText("HT-2026-001 · 科技园钢材采购合同 · 城建物资公司", { exact: true })
    .last()
    .click();

  const pendingRow = page.locator(".t-table__body tr").filter({
    hasText: "历史单价待确认项"
  });
  await expect(pendingRow.getByText("待确认", { exact: true })).toBeVisible();
  await expect(pendingRow.getByText("含税单价待确认", { exact: true })).toBeVisible();
  await pendingRow.getByRole("checkbox", { name: "选择 历史单价待确认项" }).click({
    force: true
  });
  await pendingRow.getByPlaceholder("本期数量").fill("1");
  await pendingRow.getByPlaceholder("本期数量").press("Tab");
  await page.locator(".participant-select .t-select").click();
  await page.getByText("王物资 · 物资员", { exact: true }).last().click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("结算草稿已保存；尚未占用合同额度，也未发起审批。")).toBeVisible();
  await expect(page).toHaveURL(/draftId=draft-tax/u);
  expect(draftRecord).toEqual(
    expect.objectContaining({
      id: "draft-tax",
      lines: [
        expect.objectContaining({
          contractBillRowId: "row-tax-pending",
          quantity: "1"
        })
      ]
    })
  );

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await settleResponsiveLayout(page);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await expectHorizontalScrollOwner(page.locator(".table-shell .t-table__content"));
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `settlement-workbench-tax-blocked-${viewport.width}x${viewport.height}.png`
      ),
      fullPage: true
    });
  }

  factsConfirmed = true;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByText("已恢复结算草稿；保存草稿不会发起审批，提交前仍需通过后台核算。")).toBeVisible();
  const confirmedRow = page.locator(".t-table__body tr").filter({
    hasText: "历史单价待确认项"
  });
  await expect(confirmedRow.getByText("100.00 元（含税）", { exact: true })).toBeVisible();
  await expect(confirmedRow.getByPlaceholder("本期数量")).toHaveValue("1");
  await expect(page.getByText("¥100.00", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "生成当前修订版", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "生成当前修订版", exact: true }).click();
  await expect(page.getByText("R1 · 2 页", { exact: true })).toBeVisible();
  await page.locator(".signed-pdf-panel input[type=file]").setInputFiles({
    name: "乙方签章扫描件.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("stable-counterparty-tax-pdf")
  });
  await expect(page.getByText("已上传：乙方签章扫描件.pdf", { exact: true })).toBeVisible();
  await page.getByText("扫描件页数、页序与当前冻结版一致", { exact: true }).click();
  await page.getByText("乙方已在所有要求位置签字并填写日期", { exact: true }).click();
  await page.getByText("乙方已逐页盖章", { exact: true }).click();
  await page.getByText("多页文件已加盖骑缝章", { exact: false }).click();
  await page.getByRole("button", { name: "核对通过并关联扫描件", exact: true }).click();
  await expect(page.getByRole("button", { name: "提交结算审批", exact: true })).toBeEnabled();
  await page.screenshot({
    path: path.join(screenshotDir, "settlement-workbench-tax-confirmed-1440x900.png"),
    fullPage: true
  });

  await page.getByRole("button", { name: "提交结算审批", exact: true }).click();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe("/结算管理/settlement-tax");
  expect(draftRecord).toEqual(expect.objectContaining({ id: "draft-tax", revision: 1 }));
  expect(submittedDraftBody).toEqual({ expectedRevision: 1 });
});

test("结算工作台丢弃未保存修改后直接删除服务端草稿", async ({ page }) => {
  const settlementTemplateVersionId = "settlement-template-version-delete";
  await installSettlementWorkbenchBaseMocks(page, settlementTemplateVersionId);
  let saveCalls = 0;
  let abandonmentBody: Record<string, unknown> | null = null;
  const draftRecord = {
    id: "draft-delete",
    projectId: "project-1",
    contractId: "contract-1",
    contractVersionId: "version-1",
    paymentTermsVersionId: "payment-terms-version-1",
    settlementTemplateVersionId,
    code: "JS-DELETE-001",
    periodLabel: "2026-07",
    isFinal: false,
    finalCumulativeAmountCents: null,
    governanceVersion: 1,
    fieldReviewerUserId: null,
    fieldReviewerRoleKey: null,
    finalScopeCompleted: null,
    finalPriorSettlementsIncluded: null,
    finalNoOutstandingSettlements: null,
    finalWithinContractCap: null,
    finalNoFurtherOrdinarySettlements: null,
    lines: [],
    revision: 7,
    status: "draft",
    ownerUserId: "contract-staff-1",
    submittedSettlementId: null,
    submittedAt: null,
    lifecycleKind: "pristine_draft",
    lifecycleBlockers: [],
    availableActions: [{
      key: "delete_pristine_draft",
      label: "删除草稿",
      kind: "danger",
      enabled: true,
      disabledReason: null,
      requiresComment: false
    }],
    blockedReasons: [],
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T08:30:00.000Z",
    submissionBlockingReason: null,
    documents: { frozenDocument: null, counterpartySignedOriginal: null }
  };

  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/source-lines",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-1",
        contractId: "contract-1",
        projectId: "project-1",
        contractAmountCents: "100000",
        summary: {
          rowCount: 0,
          exceptionCount: 0,
          contractAmountCents: "100000",
          settledAmountCents: "0",
          remainingAmountCents: "100000"
        },
        rows: []
      })
    })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/preview",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-1",
        amountCents: "0",
        lines: [],
        submissionBlockers: []
      })
    })
  );
  await page.route("**/api/projects/project-1/settlement-drafts**", (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/draft-delete/abandonment")) {
      abandonmentBody = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          draftId: "draft-delete",
          status: "abandoned",
          action: "delete_pristine_draft",
          idempotent: false
        })
      });
    }
    if (request.method() === "PATCH") {
      saveCalls += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(draftRecord) });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(pathname.endsWith("/draft-delete") ? draftRecord : [draftRecord])
    });
  });
  await page.route("**/api/settlements?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })
  }));

  await loginSettlementWorkbenchUser(page);
  await page.goto("/结算工作台?project=project-1&draftId=draft-delete");
  await expect(page.getByText("已恢复结算草稿；保存草稿不会发起审批，提交前仍需通过后台核算。")).toBeVisible();
  await page.getByPlaceholder("JS-2026-019").fill("不会保存的本地修改");
  await page.getByRole("button", { name: "删除草稿" }).click();
  await page.getByRole("button", { name: "确认删除草稿" }).click();

  await expect.poll(() => abandonmentBody).toEqual({
    expectedRevision: 7,
    action: "delete_pristine_draft"
  });
  expect(saveCalls).toBe(0);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search))
    .toBe("/结算管理?view=ended");
});

async function installSettlementWorkbenchBaseMocks(
  page: Page,
  settlementTemplateVersionId: string
) {
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
          amountCents: "100000",
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
    "**/api/settlement-workbench/projects/project-1/contract-versions/version-1/template-recommendations",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          selectionMode: "automatic",
          selected: {
            templateVersionId: settlementTemplateVersionId,
            templateName: "历史合同月度结算模板",
            templateCode: "SETTLEMENT-HISTORY",
            versionNo: 1,
            reasons: ["合同类型匹配"]
          },
          choices: [
            {
              templateVersionId: settlementTemplateVersionId,
              templateName: "历史合同月度结算模板",
              templateCode: "SETTLEMENT-HISTORY",
              versionNo: 1,
              reasons: ["合同类型匹配"]
            }
          ]
        })
      })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/participant-options",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        route: "material_mechanical",
        options: [{
          userId: "material-user-1",
          name: "王物资",
          roleKey: "material_staff",
          roleLabel: "物资员"
        }]
      })
    })
  );
}

async function loginSettlementWorkbenchUser(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

async function settleResponsiveLayout(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

function settlementSignedDocument(
  id: string,
  fileId: string,
  purpose: "frozen_counterparty_copy" | "counterparty_signed_original",
  revision: number
) {
  return {
    id,
    settlementDraftId: "draft-e2e",
    settlementId: null,
    purpose,
    fileId,
    contentSha256: "a".repeat(64),
    pageCount: 2,
    sourceRevision: revision,
    businessSnapshotToken: "b".repeat(64),
    status: "active",
    generationStatus: purpose === "frozen_counterparty_copy" ? "completed" : "not_applicable",
    createdAt: "2026-07-18T03:00:00.000Z",
    updatedAt: "2026-07-18T03:00:00.000Z"
  };
}
