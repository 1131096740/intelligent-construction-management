import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const contractId = "contract-bill-focus";
const versionId = "version-bill-focus";
const billId = "bill-focus";
const serverReloadSentinel = "仅工作台重载返回的服务端哨兵材料";
const screenshotDir = "/tmp/jgzg-contract-bill-focus-e2e";
const initialRow = {
  rowKey: "initial-row",
  itemCode: "CL-001",
  itemName: "钢筋",
  specification: "HRB400",
  unit: "吨",
  quantity: "1",
  unitPrice: "100.00",
  taxRatePercent: "13",
  taxRateSource: "version_default",
  pricingFactStatus: "complete",
  precisionPolicy: "two_decimal",
  taxInclusiveAmountCents: "10000",
  taxExclusiveAmountCents: "8849",
  taxAmountCents: "1151",
  isProvisional: false,
  settlementBasis: "",
  customData: {}
};

test.describe("合同清单全宽专注编辑", () => {
  test("桌面完成多行、Excel 候选与唯一整表保存", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const mock = await installContractBillRoutes(page);
    await loginAndOpenWorkbench(page);
    await expectWorkbenchRoute(page);

    await expect(page).toHaveTitle(/建工智管/u);
    await expect(page.locator("#main-content")).not.toBeEmpty();
    await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
    await expect(page.locator(".business-tabs").getByText("清单", { exact: true })).toBeVisible();
    await page.locator(".business-tabs").getByText("清单", { exact: true }).click();

    // 普通双栏只显示摘要，不把可编辑宽表塞进窄侧栏。
    await expect(page.locator(".bill-summary-card")).toBeVisible();
    await expect(page.getByText("已保存行数", { exact: true })).toBeVisible();
    await expect(page.locator("revo-grid")).toHaveCount(0);
    await page.getByRole("button", { name: "放大编辑", exact: true }).click();
    await expect(page.getByRole("heading", { name: "合同价格清单" })).toBeVisible();
    await expect(page.getByTestId("contract-bill-grid").locator("revo-grid")).toBeVisible();
    await expectWorkbenchRoute(page);

    // 连续新增至少 20 行，全部只存在于本地候选。
    for (let index = 0; index < 20; index += 1) {
      await page.getByTestId("bill-add-row").click();
    }
    await expect(page.locator(".focus-summary")).toContainText("候选行数 21");
    expect(mock.putBodies).toHaveLength(0);

    // RevoGrid 已开启 useClipboard：真实聚焦首个单元格并一次粘贴两行 TSV。
    const firstNameCell = page.locator(
      'revo-grid revogr-data[type="rgRow"] [data-rgrow="0"][data-rgcol="1"]'
    );
    await expect(firstNameCell).toBeVisible();
    await firstNameCell.click();
    await expect(
      page.locator('revo-grid [role="columnheader"][data-rgcol="1"].focused-cell')
    ).toBeVisible();
    await page.evaluate((text) => new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("RevoGrid 未完成 afterpasteapply")),
        5_000
      );
      document.addEventListener("afterpasteapply", () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", text);
      document.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard
      }));
    }), "粘贴材料甲\t型号甲\n粘贴材料乙\t型号乙");
    await expect(page.getByTestId("contract-bill-grid")).toContainText("粘贴材料甲");
    await expect(page.getByTestId("contract-bill-grid")).toContainText("粘贴材料乙");

    // 下移/上移必须经浏览器中的真实行顺序证明事件链已经生效。
    await firstNameCell.click();
    await page.getByTestId("bill-move-down").click();
    await expect(itemNameCell(page, 0)).toContainText("粘贴材料乙");
    await expect(itemNameCell(page, 1)).toContainText("粘贴材料甲");
    await page.getByTestId("bill-move-up").click();
    await expect(itemNameCell(page, 0)).toContainText("粘贴材料甲");
    await expect(itemNameCell(page, 1)).toContainText("粘贴材料乙");

    // 焦点行操作均修改同一候选集，不触发 PUT。
    await page.getByTestId("bill-copy-row").click();
    await expect(page.locator(".focus-summary")).toContainText("候选行数 22");
    await page.getByTestId("bill-delete-row").click();
    await expect(page.locator(".focus-summary")).toContainText("候选行数 21");
    expect(mock.putBodies).toHaveLength(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载标准模板", exact: true }).click();
    await downloadPromise;
    expect(mock.templateDownloadCalls()).toBe(1);

    // 101 行预检：取消保留 21 行手工候选；确认仅替换本地候选。
    await uploadPreviewFile(page);
    await expect(page.getByText("预检：新增 101 行，移除 21 行。", { exact: true })).toBeVisible();
    await page.getByTestId("bill-import-cancel").click();
    await expect(page.locator(".focus-summary")).toContainText("候选行数 21");
    await expect(page.getByTestId("contract-bill-grid")).toContainText("粘贴材料甲");
    expect(mock.putBodies).toHaveLength(0);

    await uploadPreviewFile(page);
    await page.getByTestId("bill-import-confirm").click();
    await expect(page.locator(".focus-summary")).toContainText("候选行数 101");
    await expect(page.getByTestId("contract-bill-grid")).toContainText("Excel 材料 1");
    await expect(page.getByTestId("contract-bill-grid")).not.toContainText("粘贴材料甲");
    expect(mock.putBodies).toHaveLength(0);

    const workbenchReadsBeforeSave = mock.workbenchReadCalls();
    await page.getByTestId("bill-save-all").click();
    await expect.poll(() => mock.putBodies.length).toBe(1);
    await expect.poll(() => mock.workbenchReadCalls()).toBe(workbenchReadsBeforeSave + 1);
    await expect(page.getByText("清单已全部保存", { exact: true })).toBeVisible();

    const body = mock.putBodies[0]!;
    expect(body.rows).toHaveLength(101);
    expect(new Set(body.rows.map((row) => row.clientRowKey)).size).toBe(101);
    expect(body.rows.every((row, index) => row.sortOrder === index)).toBe(true);
    expect(mock.putResponseItemNames()).not.toContain(serverReloadSentinel);
    await expect(page.getByTestId("contract-bill-grid")).toContainText(serverReloadSentinel);
    expect(mock.workbenchReadCalls()).toBe(workbenchReadsBeforeSave + 1);
    await saveSuccessScreenshot(page, testInfo.project.name, "desktop");

    // 权威行键整体回读：切到卡片断言 clientRowKey 已由服务端 rowKey 重建。
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      page.locator('[data-client-row-key="server-authoritative-row-1"]')
    ).not.toHaveCount(0);
    await expect(page.locator(".contract-bill-grid__card")).toHaveCount(101);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("375px 使用卡片编辑并保持候选与错误计数一致", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 375, height: 812 });
    const mock = await installContractBillRoutes(page);
    await loginAndOpenWorkbench(page);
    await expectWorkbenchRoute(page);
    await page.locator(".business-tabs").getByText("清单", { exact: true }).click();

    await expect(page.locator(".bill-summary-card")).toBeVisible();
    await expect(page.locator("revo-grid")).toHaveCount(0);
    await page.getByRole("button", { name: "放大编辑", exact: true }).click();
    await expect(page.locator(".contract-bill-grid__cards")).toBeVisible();
    await expectWorkbenchRoute(page);
    await expect(page.locator("revo-grid")).toHaveCount(0);
    await expect(page.locator(".contract-bill-grid__card")).toHaveCount(1);
    await expect(page.locator(".focus-summary")).toContainText("候选行数 1");
    const statusMetrics = await mobileStatusMetrics(page);
    expect(statusMetrics.height).toBeLessThanOrEqual(96);
    expect(statusMetrics.contentGap).toBeGreaterThanOrEqual(-0.5);
    expect(statusMetrics.contentGap).toBeLessThanOrEqual(statusMetrics.designGap + 0.5);

    const itemNameInput = page.locator(
      '.contract-bill-grid__card [data-field="itemName"][data-client-row-key="server-initial-row"] input'
    );
    await itemNameInput.fill("");
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
    const saveButton = page.getByTestId("bill-save-all");
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 0.5
    )).toBe(true);
    const saveButtonBox = await saveButton.boundingBox();
    expect(saveButtonBox).not.toBeNull();
    expect(saveButtonBox!.x).toBeGreaterThanOrEqual(-0.5);
    expect(saveButtonBox!.x + saveButtonBox!.width).toBeLessThanOrEqual(
      (page.viewportSize()?.width ?? 375) + 0.5
    );
    await saveButton.click();
    await expect(page.locator(".error-summary")).toContainText("1 处需要修正");
    await expect(page.locator(".contract-bill-grid__error-list li")).toHaveCount(1);
    await expect(page.locator(".contract-bill-grid__card")).toHaveCount(1);
    await expect(page.locator(".focus-summary")).toContainText("候选行数 1");
    expect(mock.putBodies).toHaveLength(0);

    await itemNameInput.fill("移动端钢筋");
    await expect(itemNameInput).toHaveValue("移动端钢筋");
    await saveSuccessScreenshot(page, testInfo.project.name, "375");
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

async function installContractBillRoutes(page: Page) {
  const putBodies: ReplaceRowsBody[] = [];
  let putResponseItemNames: string[] = [];
  let templateDownloads = 0;
  let workbenchReads = 0;
  let revision = 1;
  let rows: Array<Record<string, unknown>> = [{ ...initialRow }];

  await page.route("**/api/auth/login", (route) => route.fulfill({
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
      tokens: {
        accessToken: "bill-focus-access-token",
        refreshToken: "bill-focus-refresh-token",
        expiresIn: 900
      }
    })
  }));
  await page.route("**/api/me/work-items", (route) => fulfillJson(route, {
    generatedAt: "2026-07-25T00:00:00.000Z",
    visibleProjectCount: 1,
    queues: { pending: [], blocked: [], started: [] },
    approvalCenter: {
      pendingApproval: [],
      startedByMe: [],
      handledByMe: [],
      delegatedToMe: [],
      overdueReminder: []
    }
  }));
  await page.route("**/api/projects/contract-create-options", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/contract-number-rules", (route) => fulfillJson(route, []));
  await page.route("**/api/contract-templates*", (route) => fulfillJson(route, []));
  await page.route("**/api/contract-layout-templates*", (route) => fulfillJson(route, []));
  await page.route(`**/api/contract-workbench/${versionId}/negotiation-rounds`, (route) =>
    fulfillJson(route, [])
  );
  await page.route(`**/api/contract-bills/${billId}/excel-template`, async (route) => {
    templateDownloads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: {
        "Content-Disposition": "attachment; filename*=UTF-8''contract-bill-focus.xlsx"
      },
      body: "xlsx-template"
    });
  });
  await page.route("**/api/files", (route) =>
    fulfillJson(route, { id: "uploaded-bill-xlsx" })
  );
  await page.route(`**/api/contract-bills/${billId}/excel-imports`, (route) =>
    fulfillJson(route, {
      importId: "import-bill-focus",
      mode: "replace",
      added: 101,
      updated: 0,
      removed: 21,
      skipped: 0,
      errors: [],
      candidateRows: previewRows(101)
    })
  );
  await page.route(`**/api/contract-bills/${billId}/rows`, async (route) => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON() as ReplaceRowsBody;
    putBodies.push(body);
    revision += 1;
    rows = body.rows.map((row, index) => ({
      rowKey: `authoritative-row-${index + 1}`,
      itemCode: row.itemCode ?? null,
      itemName: row.itemName,
      specification: row.specification ?? null,
      unit: row.unit,
      quantity: row.quantity ?? null,
      unitPrice: row.unitPrice,
      taxRatePercent: row.taxRatePercent ?? "13",
      taxRateSource: row.taxRateSource ?? "version_default",
      pricingFactStatus: "complete",
      precisionPolicy: "two_decimal",
      taxInclusiveAmountCents: "100",
      taxExclusiveAmountCents: "88",
      taxAmountCents: "12",
      isProvisional: row.isProvisional ?? false,
      settlementBasis: row.settlementBasis ?? null,
      customData: row.customData
    }));
    const response = batchSaveReadModel(rows, revision);
    putResponseItemNames = response.rows.map((row) => String(row.itemName));
    await fulfillJson(route, response);
  });
  await page.route(`**/api/contract-workbench/${contractId}`, (route) => {
    workbenchReads += 1;
    const workbenchRows = putBodies.length === 0
      ? rows
      : rows.map((row, index) => index === 0
        ? { ...row, itemName: serverReloadSentinel }
        : row);
    return fulfillJson(route, workbenchReadModel(workbenchRows, revision));
  });

  return {
    putBodies,
    templateDownloadCalls: () => templateDownloads,
    workbenchReadCalls: () => workbenchReads,
    putResponseItemNames: () => putResponseItemNames
  };
}

async function loginAndOpenWorkbench(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/首页");
  await page.waitForLoadState("networkidle");
  await page.goto(`/contracts/${contractId}/workbench`);
  await expect(page.getByRole("heading", { name: "合同清单专注编辑回归合同" })).toBeVisible();
}

async function expectWorkbenchRoute(page: Page) {
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    `/合同工作台/${contractId}`
  );
}

function itemNameCell(page: Page, rowIndex: number) {
  return page.locator(
    `revo-grid revogr-data[type="rgRow"] [data-rgrow="${rowIndex}"][data-rgcol="1"]`
  );
}

async function mobileStatusMetrics(page: Page) {
  return page.evaluate(() => {
    const statusBar = document.querySelector<HTMLElement>(".status-bar");
    const statusLeft = document.querySelector<HTMLElement>(".status-left");
    const statusRight = document.querySelector<HTMLElement>(".status-right");
    if (!statusBar || !statusLeft || !statusRight) {
      throw new Error("合同工作台状态栏结构缺失");
    }
    const barBox = statusBar.getBoundingClientRect();
    const leftBox = statusLeft.getBoundingClientRect();
    const rightBox = statusRight.getBoundingClientRect();
    return {
      height: barBox.height,
      contentGap: rightBox.top - leftBox.bottom,
      designGap: Number.parseFloat(getComputedStyle(statusBar).rowGap)
    };
  });
}

async function saveSuccessScreenshot(
  page: Page,
  projectName: string,
  viewportLabel: "desktop" | "375"
) {
  await mkdir(screenshotDir, { recursive: true });
  const evidenceTarget = viewportLabel === "desktop"
    ? page.getByTestId("contract-bill-grid")
    : page.getByTestId("bill-save-all");
  await evidenceTarget.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${screenshotDir}/${projectName}-${viewportLabel}-success.png`
  });
}

async function uploadPreviewFile(page: Page) {
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({
    name: "contract-bill-focus.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("xlsx-e2e-fixture")
  });
  await expect(page.getByTestId("bill-import-confirm")).toBeVisible();
}

function previewRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    clientRowKey: `import-row-${index + 1}`,
    sortOrder: index,
    itemCode: `EX-${index + 1}`,
    itemName: `Excel 材料 ${index + 1}`,
    specification: `规格 ${index + 1}`,
    unit: "件",
    quantity: "1",
    unitPrice: "1.00",
    taxRatePercent: "13",
    taxRateSource: "version_default",
    isProvisional: false,
    settlementBasis: "",
    customData: {}
  }));
}

function workbenchReadModel(
  rows: Array<Record<string, unknown>>,
  revision: number
) {
  return {
    contract: {
      id: contractId,
      temporaryCode: "草稿-清单-E2E",
      code: null,
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      ownerUserId: "contract-staff-1",
      name: "合同清单专注编辑回归合同"
    },
    version: {
      id: versionId,
      versionNo: 1,
      status: "draft",
      changeType: "original",
      draftRevision: 3,
      amountCents: "10000",
      pricingNature: "unit_price",
      amountSource: "bill_sum",
      manualAmountCents: null,
      amountLimitType: "capped",
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
    bills: [{
      id: billId,
      billKey: "materials",
      name: "合同价格清单",
      revision,
      taxInclusiveAmountCents: "10000",
      taxExclusiveAmountCents: "8849",
      taxAmountCents: "1151",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      pricingNature: "unit_price",
      amountLimitType: "capped",
      taxMode: "single_rate",
      defaultTaxRatePercent: "13",
      schemaSnapshot: { columns: [] },
      rows
    }],
    paymentTerms: { originalText: "", stages: [] },
    checkpoints: [],
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] }
  };
}

function batchSaveReadModel(
  rows: Array<Record<string, unknown>>,
  revision: number
) {
  const now = "2026-07-25T00:00:00.000Z";
  return {
    bill: {
      id: billId,
      contractVersionId: versionId,
      billKey: "materials",
      name: "合同价格清单",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      quantityScale: 2,
      unitPriceScale: 2,
      schemaSnapshot: { columns: [] },
      sourceExcelFileId: null,
      revision,
      taxInclusiveAmountCents: "10100",
      taxExclusiveAmountCents: "8938",
      taxAmountCents: "1162",
      createdAt: now,
      updatedAt: now
    },
    rows: rows.map((row, index) => ({
      id: `saved-row-${index + 1}`,
      contractBillId: billId,
      rowKey: row.rowKey,
      sortOrder: index,
      itemCode: row.itemCode,
      itemName: row.itemName,
      specification: row.specification,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      taxRate: row.taxRatePercent,
      taxRateSource: row.taxRateSource,
      pricingFactStatus: row.pricingFactStatus,
      precisionPolicy: row.precisionPolicy,
      taxInclusiveAmountCents: row.taxInclusiveAmountCents,
      taxExclusiveAmountCents: row.taxExclusiveAmountCents,
      taxAmountCents: row.taxAmountCents,
      isProvisional: row.isProvisional,
      settlementBasis: row.settlementBasis,
      customData: row.customData,
      createdAt: now,
      updatedAt: now
    }))
  };
}

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

interface ReplaceRowsBody {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: Array<{
    clientRowKey: string;
    rowKey?: string;
    sortOrder: number;
    itemCode?: string;
    itemName: string;
    specification?: string;
    unit: string;
    quantity?: string;
    unitPrice: string;
    taxRatePercent?: string;
    taxRateSource?: string;
    isProvisional?: boolean;
    settlementBasis?: string;
    customData: Record<string, unknown>;
  }>;
}
