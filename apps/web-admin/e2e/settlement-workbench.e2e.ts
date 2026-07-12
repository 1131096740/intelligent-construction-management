import { expect, test } from "@playwright/test";

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
  const previewBodies: Array<{ settlementLines: DraftLine[] }> = [];
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
  await page.goto("/settlements/new");
  await expect(page.getByRole("heading", { name: "新建结算" })).toBeVisible();

  const selects = page.locator(".basic-fields .t-select");
  await selects.nth(0).click();
  await page.getByText("P001 · 科技园项目", { exact: true }).last().click();
  await selects.nth(1).click();
  await page
    .getByText("HT-2026-001 · 科技园钢材采购合同 · 城建物资公司", { exact: true })
    .last()
    .click();

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

  const tableShell = page.locator(".table-shell");
  const horizontalScroll = await tableShell.evaluate((element) => {
    const shell = element as HTMLElement;
    const reachable = shell.scrollWidth > shell.clientWidth;
    shell.scrollLeft = shell.scrollWidth;
    return { reachable, scrollLeft: shell.scrollLeft };
  });
  expect(horizontalScroll.reachable).toBe(true);
  expect(horizontalScroll.scrollLeft).toBeGreaterThan(0);
  await tableShell.evaluate((element) => {
    (element as HTMLElement).scrollLeft = 0;
  });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const adjustmentBox = await page.locator(".adjustment-section").boundingBox();
  const footerBox = await page.locator(".workbench-footer").boundingBox();
  expect(adjustmentBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(1100);
  expect(adjustmentBox!.y + adjustmentBox!.height).toBeLessThanOrEqual(footerBox!.y);
  await page.screenshot({
    path: testInfo.outputPath("settlement-workbench-1440x1100.png"),
    fullPage: true
  });

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const compactAdjustmentBox = await page.locator(".adjustment-section").boundingBox();
  const compactFooterBox = await page.locator(".workbench-footer").boundingBox();
  expect(compactAdjustmentBox).not.toBeNull();
  expect(compactFooterBox).not.toBeNull();
  expect(compactFooterBox!.y + compactFooterBox!.height).toBeLessThanOrEqual(800);
  expect(compactAdjustmentBox!.y + compactAdjustmentBox!.height).toBeLessThanOrEqual(
    compactFooterBox!.y
  );
  await page.screenshot({
    path: testInfo.outputPath("settlement-workbench-1100.png"),
    fullPage: true
  });

  await page.locator(".workbench-footer").getByRole("button", { name: "提交结算" }).click();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe("/结算管理/settlement-new");

  expect(previewBodies.length).toBeGreaterThan(0);
  const finalPreview = previewBodies.at(-1)!;
  expect(finalPreview.settlementLines).toHaveLength(3);
  expect(finalPreview.settlementLines.map((line) => line.contractBillRowId)).not.toContain(
    "row-unselected"
  );
  expect(finalPreview.settlementLines[0]).not.toHaveProperty("amountCents");
  expect(createdBody).toMatchObject({
    contractVersionId: "version-1",
    settlementLines: finalPreview.settlementLines
  });
  expect(createdBody).not.toHaveProperty("amountCents");
});
