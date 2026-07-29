import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const contractId = "contract-bill-focus";
const versionId = "version-bill-focus";
const billId = "bill-focus";
const screenshotDir = "/tmp/jgzg-contract-bill-focus-e2e";
const initialRow = {
  rowKey: "initial-row",
  itemCode: "CL-001",
  itemName: "钢筋",
  specification: "HRB400",
  unit: "吨",
  quantity: "2000",
  unitPrice: "375.00",
  taxRatePercent: "9",
  taxRateSource: "version_default",
  pricingFactStatus: "complete",
  precisionPolicy: "two_decimal",
  taxExclusiveUnitPrice: "344.036695",
  taxInclusiveAmountCents: "75000000",
  taxExclusiveAmountCents: "68807339",
  taxAmountCents: "6192661",
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
    await openBillSection(page);

    // 普通双栏只显示摘要，不把可编辑宽表塞进窄侧栏。
    await expect(page.locator(".bill-summary-card")).toBeVisible();
    await expect(page.getByText("已保存行数", { exact: true })).toBeVisible();
    await expect(page.locator("revo-grid")).toHaveCount(0);
    await page.getByRole("button", { name: "放大编辑", exact: true }).click();
    await expect(page.getByRole("heading", { name: "合同价格清单" })).toBeVisible();
    await expect(page.getByTestId("contract-bill-grid").locator("revo-grid")).toBeVisible();
    await expectWorkbenchRoute(page);
    await expect(page.locator(".focus-summary")).toContainText(
      "上次保存不含税合计 688,073.39 元"
    );
    await expect(netUnitPriceCell(page, 0)).toContainText("344.04");
    await expect(netUnitPriceCell(page, 0)).toHaveAttribute("title", "344.036695");

    // 连续新增至少 20 行，全部只存在于本地候选。
    for (let index = 0; index < 20; index += 1) {
      await page.getByTestId("bill-add-row").click();
    }
    await expect(page.locator(".focus-summary")).toContainText("候选行数 21");
    expect(mock.saveBodies).toHaveLength(0);

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
    expect(mock.saveBodies).toHaveLength(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载标准模板", exact: true }).click();
    await downloadPromise;
    expect(mock.templateDownloadCalls()).toBe(1);

    // 101 行新版清单预检：取消保留 21 行手工候选；确认只走服务端原子应用。
    await uploadPreviewFile(page);
    await expect(
      page.getByText(/预检得到\s*101\s*行，新增\s*101\s*行，\s*跳过\s*0\s*行。/u)
    ).toBeVisible();
    await page.getByTestId("bill-import-cancel").click();
    await expect(page.locator(".focus-summary")).toContainText("候选行数 21");
    await expect(page.getByTestId("contract-bill-grid")).toContainText("粘贴材料甲");
    expect(mock.saveBodies).toHaveLength(0);

    await uploadPreviewFile(page);
    await page.getByTestId("bill-import-confirm").click();
    await expect(page.locator(".focus-summary")).toContainText("候选行数 101");
    await expect(page.getByTestId("contract-bill-grid")).toContainText("Excel 材料 1");
    await expect(page.getByTestId("contract-bill-grid")).not.toContainText("粘贴材料甲");
    expect(mock.saveBodies).toHaveLength(0);

    // 不能只凭候选计数证明虚拟滚动：真实滚到第 101 行并完成一次单元格编辑。
    await page.locator("revo-grid").evaluate(async (grid: HTMLElement & {
      scrollToRow: (rowIndex: number) => Promise<void>;
      setCellEdit: (rowIndex: number, prop: string) => Promise<void>;
    }) => {
      await grid.scrollToRow(100);
      await grid.setCellEdit(100, "itemName");
    });
    const lastNameCell = itemNameCell(page, 100);
    await expect(lastNameCell).toBeVisible();
    const lastNameInput = page.locator("revo-grid revogr-edit input");
    await expect(lastNameInput).toBeFocused();
    await lastNameInput.fill("Excel 材料 101 已编辑");
    await lastNameInput.press("Enter");
    await expect(lastNameCell).toContainText("Excel 材料 101 已编辑");

    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect.poll(() => mock.saveBodies.length).toBe(1);
    await expect(page.getByTestId("contract-draft-manual-save-message")).toContainText(
      "文档预览生成中"
    );

    const body = mock.saveBodies[0]!.bills[0]!;
    expect(body.rows).toHaveLength(101);
    expect(new Set(body.rows.map((row) => row.clientRowKey)).size).toBe(101);
    expect(body.rows.every((row, index) => row.sortOrder === index)).toBe(true);
    expect(body.rows.every((row) =>
      !("taxExclusiveUnitPrice" in row) &&
      !("taxInclusiveAmountCents" in row) &&
      !("taxExclusiveAmountCents" in row) &&
      !("taxAmountCents" in row)
    )).toBe(true);
    expect(body.rows[100]?.itemName).toBe("Excel 材料 101 已编辑");
    await saveSuccessScreenshot(page, testInfo.project.name, "desktop");

    // 权威行键整体回读：切到卡片断言 clientRowKey 已由服务端 rowKey 重建。
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      page.locator('[data-client-row-key="import-row-1"]')
    ).not.toHaveCount(0);
    await expect(page.locator(".contract-bill-grid__card")).toHaveCount(101);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  for (const viewport of [
    { label: "960", width: 960, height: 900, mode: "grid" as const },
    { label: "640", width: 640, height: 900, mode: "cards" as const }
  ]) {
    test(`${viewport.width}px 专注布局无横向溢出且编辑操作可达`, async ({ page }, testInfo) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installContractBillRoutes(page);
      await loginAndOpenWorkbench(page);
      await expectWorkbenchRoute(page);
      await openBillSection(page);
      await page.getByRole("button", { name: "放大编辑", exact: true }).click();

      await expectWorkbenchRoute(page);
      await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
      await expect(page.locator(".focus-toolbar")).toBeVisible();
      await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeVisible();
      await expect(page.getByTestId("bill-add-row")).toBeVisible();
      await expect.poll(() => page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 0.5
      )).toBe(true);
      await expectElementReachable(page, ".focus-toolbar");
      await expectLocatorReachable(
        page.getByRole("button", { name: "保存草稿", exact: true }),
        page
      );

      if (viewport.mode === "grid") {
        await expect(page.getByTestId("contract-bill-grid").locator("revo-grid")).toBeVisible();
        await expect(page.locator(".contract-bill-grid__cards")).toHaveCount(0);
        await expect(itemNameCell(page, 0)).toContainText("钢筋");
        await expect(netUnitPriceCell(page, 0)).toContainText("344.04");
        await expect(netUnitPriceCell(page, 0)).toHaveAttribute("title", "344.036695");
      } else {
        await expect(page.locator("revo-grid")).toHaveCount(0);
        await expect(page.locator(".contract-bill-grid__cards")).toBeVisible();
        await expect(page.locator(".contract-bill-grid__card")).toHaveCount(1);
        await expect(page.locator(
          '.contract-bill-grid__card [data-field="itemName"][data-client-row-key="initial-row"] input'
        )).toHaveValue("钢筋");
        const netPrice = page.locator(
          '.contract-bill-grid__card [data-field="taxExclusiveUnitPrice"][data-client-row-key="initial-row"]'
        );
        await expect(netPrice).toHaveText("344.04");
        await expect(netPrice).toHaveAttribute("title", "344.036695");
      }

      await saveLayoutScreenshot(page, testInfo.project.name, viewport.label);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

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
    await openBillSection(page);

    await expect(page.locator(".bill-summary-card")).toBeVisible();
    await expect(page.locator("revo-grid")).toHaveCount(0);
    await page.getByRole("button", { name: "放大编辑", exact: true }).click();
    await expect(page.locator(".contract-bill-grid__cards")).toBeVisible();
    await expectWorkbenchRoute(page);
    await expect(page.locator("revo-grid")).toHaveCount(0);
    await expect(page.locator(".contract-bill-grid__card")).toHaveCount(1);
    await expect(page.locator(".focus-summary")).toContainText("候选行数 1");
    const netPrice = page.locator(
      '.contract-bill-grid__card [data-field="taxExclusiveUnitPrice"][data-client-row-key="initial-row"]'
    );
    await expect(netPrice).toHaveText("344.04");
    await expect(netPrice).toHaveAttribute("title", "344.036695");
    const statusMetrics = await mobileStatusMetrics(page);
    expect(statusMetrics.height).toBeLessThanOrEqual(96);
    expect(Number.isFinite(statusMetrics.designGap)).toBe(true);
    expect(statusMetrics.designGap).toBeGreaterThan(0);
    expect(statusMetrics.contentGap).toBeGreaterThanOrEqual(statusMetrics.designGap - 0.5);
    expect(statusMetrics.contentGap).toBeLessThanOrEqual(statusMetrics.designGap + 0.5);

    const itemNameInput = page.locator(
      '.contract-bill-grid__card [data-field="itemName"][data-client-row-key="initial-row"] input'
    );
    await itemNameInput.fill("");
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
    const saveButton = page.getByRole("button", { name: "保存草稿", exact: true });
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 0.5
    )).toBe(true);
    const saveButtonBox = await saveButton.boundingBox();
    expect(saveButtonBox).not.toBeNull();
    expect(saveButtonBox!.x).toBeGreaterThanOrEqual(-0.5);
    expect(saveButtonBox!.x + saveButtonBox!.width).toBeLessThanOrEqual(
      (page.viewportSize()?.width ?? 375) + 0.5
    );
    await expect(page.locator(".error-summary")).toContainText("1 处需要修正");
    await expect(page.locator(".contract-bill-grid__card")).toHaveCount(1);
    await expect(page.locator(".focus-summary")).toContainText("候选行数 1");
    expect(mock.saveBodies).toHaveLength(0);

    await itemNameInput.fill("移动端钢筋");
    await expect(itemNameInput).toHaveValue("移动端钢筋");
    await saveSuccessScreenshot(page, testInfo.project.name, "375");
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

async function installContractBillRoutes(page: Page) {
  const saveBodies: AggregateSaveBody[] = [];
  let templateDownloads = 0;
  let draftRevision = 3;
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
  await page.route("**/api/company-entities*", (route) => fulfillJson(route, []));
  await page.route("**/api/standard-clauses*", (route) => fulfillJson(route, []));
  await page.route(`**/api/contract-workbench/${versionId}/negotiation-rounds`, (route) =>
    fulfillJson(route, [])
  );
  await page.route(`**/api/contract-drafts/${versionId}/edit-lease**`, (route) => {
    if (route.request().method() === "DELETE") {
      return fulfillJson(route, { released: true });
    }
    return fulfillJson(route, {
      token: "lease-token",
      leaseRevision: 1,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      heartbeatIntervalMs: 60_000
    });
  });
  await page.route(`**/api/contract-drafts/${versionId}/preview-generation`, (route) =>
    fulfillJson(route, { queued: true })
  );
  await page.route(
    `**/api/contract-drafts/${versionId}/bills/materials/template`,
    async (route) => {
    templateDownloads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: {
        "Content-Disposition": "attachment; filename*=UTF-8''contract-bill-focus.xlsx"
      },
      body: "xlsx-template"
    });
    }
  );
  await page.route("**/api/files", (route) =>
    fulfillJson(route, { id: "uploaded-bill-xlsx" })
  );
  await page.route(
    `**/api/contract-drafts/${versionId}/bills/materials/import-preview`,
    (route) =>
    fulfillJson(route, {
      billKey: "materials",
      targetBillRevision: revision,
      rows: previewRows(101),
      added: 101,
      skipped: 0,
      beforeAmountCents: "10000",
      afterAmountCents: "10100",
      errors: []
    })
  );
  await page.route(`**/api/contract-drafts/${versionId}`, async (route) => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON() as AggregateSaveBody;
    const savedRows = body.bills[0]?.rows ?? [];
    if (savedRows.some((row) => !row.itemName.trim())) {
      return fulfillJson(route, { message: "清单项目名称不能为空" }, 400);
    }
    saveBodies.push(body);
    draftRevision += 1;
    revision += 1;
    rows = savedRows.map((row) => ({
      ...row,
      rowKey: row.rowKey ?? `saved-${row.clientRowKey}`,
      precisionPolicy: "two_decimal",
      taxExclusiveUnitPrice: "0.884956",
      taxInclusiveAmountCents: "100",
      taxExclusiveAmountCents: "88",
      taxAmountCents: "12"
    }));
    return fulfillJson(route, {
      contractVersionId: versionId,
      draftRevision,
      savedAt: new Date().toISOString(),
      effectiveChangedSections: body.changedSections,
      amounts: {
        taxInclusiveAmountCents: "10100",
        taxExclusiveAmountCents: "8938",
        taxAmountCents: "1162"
      },
      billRevisions: { materials: revision },
      issueCounts: {},
      readiness: { ready: false, blockingMessages: [], warningMessages: [] },
      documentsOutdated: true,
      availableActions: []
    });
  });
  await page.route(`**/api/contract-drafts/${versionId}/workbench`, (route) => {
    return fulfillJson(route, workbenchReadModel(rows, revision, draftRevision));
  });

  return {
    saveBodies,
    templateDownloadCalls: () => templateDownloads
  };
}

async function loginAndOpenWorkbench(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/首页");
  await page.waitForLoadState("networkidle");
  await page.goto(`/contracts/${contractId}/workbench?versionId=${versionId}`);
  await expect(page.getByRole("heading", { name: "合同清单专注编辑回归合同" })).toBeVisible();
}

async function expectWorkbenchRoute(page: Page) {
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    `/合同工作台/${contractId}`
  );
}

async function openBillSection(page: Page) {
  await page.locator('[data-section-nav-id="bill_tax"]').click();
  await expect(page.locator('[data-section-id="bill_tax"]')).toBeVisible();
}

function itemNameCell(page: Page, rowIndex: number) {
  return page.locator(
    `revo-grid revogr-data[type="rgRow"] [data-rgrow="${rowIndex}"][data-rgcol="1"]`
  );
}

function netUnitPriceCell(page: Page, rowIndex: number) {
  return page.locator(
    `revo-grid revogr-data[type="rgRow"] [data-rgrow="${rowIndex}"][data-rgcol="6"]`
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

async function expectElementReachable(page: Page, selector: string) {
  await expectLocatorReachable(page.locator(selector), page);
}

async function expectLocatorReachable(target: Locator, page: Page) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? 0) + 0.5
  );
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    (page.viewportSize()?.height ?? 0) + 0.5
  );
}

async function saveLayoutScreenshot(page: Page, projectName: string, viewportLabel: string) {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: `${screenshotDir}/${projectName}-${viewportLabel}-layout.png`
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
    : page.getByRole("button", { name: "保存草稿", exact: true });
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
  revision: number,
  draftRevision = 3
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
      draftRevision,
      amountCents: "75000000",
      pricingNature: "unit_price",
      amountSource: "bill_sum",
      manualAmountCents: null,
      amountLimitType: "capped",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "9",
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
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: "68807339",
      taxAmountCents: "6192661",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      pricingNature: "unit_price",
      amountLimitType: "capped",
      taxMode: "single_rate",
      defaultTaxRatePercent: "9",
      schemaSnapshot: { columns: [] },
      rows: rows.map((row, index) => ({ ...row, sortOrder: index }))
    }],
    paymentTerms: { originalText: "", stages: [] },
    draft: {},
    attachments: [],
    lease: {
      state: "available",
      holderDisplayName: null,
      expiresAt: null,
      canTakeOver: false
    },
    settlementMode: {
      value: "settlement_required",
      source: "contract_director",
      confirmedAt: "2026-07-25T00:00:00.000Z",
      confirmedByUserId: "contract-director-1",
      confirmationRequired: false,
      canConfirm: false
    },
    checkpoints: [],
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] }
  };
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

interface AggregateSaveBody {
  idempotencyKey: string;
  saveKind: "auto" | "manual";
  expectedRevision: number;
  changedSections: string[];
  bills: Array<{
    billKey: string;
    expectedRevision: number;
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
  }>;
}
