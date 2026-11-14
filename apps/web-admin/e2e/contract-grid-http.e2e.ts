import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const ExcelJS = createRequire(new URL("../../../services/api/package.json", import.meta.url))("exceljs") as typeof import("../../../services/api/node_modules/exceljs");

// Dedicated config supplies a real local Nest server with synthetic persistence.
// The regular browser suite must not mistake an absent fixture for acceptance.
test.skip(process.env.JG_GRID_ACCEPTANCE !== "1", "Run with playwright.contract-grid.config.ts and the synthetic HTTP server");

test.beforeEach(async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const reset = await request.post("/api/__grid_fixture/reset", { headers: { authorization: `Bearer ${session.accessToken}` } });
  expect(reset.status()).toBe(200);
  // Authentication fixture only: all business data comes from the Nest API.
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
});

async function swipeToBillColumn(page: Page, context: BrowserContext, headerName: string | RegExp) {
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  const identity = grid.getByRole("gridcell", { name: "选择第1行", exact: true });
  await identity.scrollIntoViewIfNeeded();
  const rowBox = (await identity.boundingBox())!;
  const gridBox = (await grid.boundingBox())!;
  const nameBox = (await grid.locator('revogr-data[col-type="colPinStart"] [data-rgrow="0"][data-rgcol="1"]').boundingBox())!;
  const view = page.viewportSize()!;
  const left = nameBox.x + nameBox.width + 4;
  const header = grid.getByRole("columnheader", { name: headerName, exact: true });
  const cdp = await context.newCDPSession(page);
  try {
    // Native touch navigation across the virtual columns; no business response
    // is replaced and a missing target remains a failure within this test budget.
    for (let gesture = 0; gesture < 12; gesture += 1) {
      const box = await header.count() ? await header.boundingBox() : null;
      if (box && box.x >= left - 6 && box.x <= view.width - 80) return;
      const distance = box ? Math.max(-160, Math.min(160, box.x - left)) : 160;
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.min(view.width - 25, gridBox.x + gridBox.width - 20),
        y: Math.max(120, Math.min(view.height - 80, rowBox.y + rowBox.height / 2)),
        xDistance: -distance, yDistance: 0, preventFling: true, gestureSourceType: "touch"
      });
    }
    await expect(header).toBeInViewport();
  } finally { await cdp.detach(); }
}

test("selects draft rows independently of editing focus and restores a batch deletion", async ({ page }) => {
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await expect(page.getByRole("heading", { name: "合成四位材料清单" })).toBeVisible();
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await expect(page.getByRole("checkbox", { name: "选择第1行" })).toBeChecked();
  await expect(page.getByText("已选择 1 行", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "复制所选", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "选择第3行" })).toBeVisible();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "选择第3行" })).toHaveCount(0);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "选择第3行" })).toBeVisible();
});

test("keeps Chinese composition and native editing intact while Tab, Enter and Escape move or restore cells", async ({ page }) => {
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  const firstName = grid.getByRole("gridcell", { name: "级配碎石", exact: true });
  await firstName.dblclick();
  const input = grid.locator("revogr-edit input");
  await expect(input).toBeFocused();
  await input.fill("尚未确认的中文");
  await input.press("Escape");
  await expect(firstName).toHaveText("级配碎石");
  await firstName.dblclick();
  await input.dispatchEvent("compositionstart");
  await input.fill("中文组字材料");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("中文组字材料");
  await input.dispatchEvent("compositionend", { data: "中文组字材料" });
  await input.press("Tab");
  await expect(grid.getByRole("gridcell", { name: "中文组字材料", exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("合成规格");
  await input.fill("键盘规格");
  await input.press("Enter");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("合成规格");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("键盘规格");
});

test("automatically persists a first-save draft without submitting and reads the same text back over HTTP", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("contract-bill-grid").locator("revo-grid").getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await page.locator("revogr-edit input").fill("自动保存的中文材料");
  await page.locator("revogr-edit input").press("Enter");
  await expect.poll(async () => {
    const response = await request.get("/api/contract-drafts/grid-version/workbench", { headers: { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" } });
    expect(response.status()).toBe(200);
    const draft = await response.json();
    expect(draft.version.status).toBe("draft");
    expect(draft.contract.code).toBeNull();
    return draft.bills[0].rows[0].itemName;
  }).toBe("自动保存的中文材料");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  await page.reload();
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid").getByRole("gridcell", { name: "自动保存的中文材料", exact: true })).toBeVisible();
});

test("keeps later input dirty across a delayed acknowledgement and retains a new row identity on the next save", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/delay-next-save-response", { headers })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("bill-copy-row").click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await expect(grid.locator("revogr-edit input")).toBeFocused();
  await expect(grid.locator("revogr-edit input")).toHaveValue("级配碎石");
  await grid.locator("revogr-edit input").fill("在途首稿");
  await grid.locator("revogr-edit input").press("Enter");
  let firstRowKey = "";
  await expect.poll(async () => {
    const body = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
    const row = body.bills[0].rows.find((candidate: { itemName: string }) => candidate.itemName === "在途首稿");
    firstRowKey = row?.rowKey ?? "";
    return Boolean(firstRowKey);
  }).toBe(true);
  await grid.getByRole("gridcell", { name: "在途首稿", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("在途之后继续输入");
  await grid.locator("revogr-edit input").press("Enter");
  expect((await request.post("/api/__grid_fixture/release-save-response", { headers })).status()).toBe(200);
  await expect(grid.getByRole("gridcell", { name: "在途之后继续输入", exact: true })).toBeVisible();
  await expect.poll(async () => {
    const body = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
    const row = body.bills[0].rows.find((candidate: { itemName: string }) => candidate.itemName === "在途之后继续输入");
    return row?.rowKey ?? "";
  }).toBe(firstRowKey);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
});

for (const failure of ["connection", "5xx"] as const) {
  test(`retries after a ${failure} capability preflight failure without inventing an unknown write`, async ({ page, context, request }) => {
    const session = await (await request.get("/api/__grid_fixture/session")).json();
    const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
    const writes: string[] = [];
    const lookups: string[] = [];
    page.on("request", outgoing => {
      if (outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version")) writes.push(outgoing.postDataJSON().idempotencyKey);
      if (outgoing.url().includes("/save-requests/")) lookups.push(outgoing.url());
    });
    await page.goto("/合同工作台/grid-contract?versionId=grid-version");
    const save = page.getByRole("button", { name: "保存草稿", exact: true });
    await expect(save).toBeEnabled();
    expect((await request.post("/api/__grid_fixture/fail-next-workbench-response", { headers, data: { mode: failure } })).status()).toBe(200);
    const name = page.getByPlaceholder("请填写合同名称", { exact: true });
    const input = `能力读取${failure}断线后保留的输入`;
    await name.fill(input);
    await expect(page.getByTestId("contract-draft-save-error")).toBeVisible();
    expect(writes).toHaveLength(0);
    await expect(save).toBeEnabled();
    await expect(page.getByRole("button", { name: "核对保存结果", exact: true })).toHaveCount(0);
    await expect(name).toHaveValue(input);
    await context.setOffline(true);
    await context.setOffline(false);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId("contract-draft-save-receipt")).toContainText("修订 2");
    const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
    expect(saved.version.draftRevision).toBe(2);
    expect(saved.draft.contractName).toBe(input);
    expect(writes).toHaveLength(1);
    expect(lookups).toHaveLength(0);
  });
}

test("checks a committed save with a lost response before permitting another write", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/drop-next-save-response", { headers })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("已保存但回包丢失");
  await grid.locator("revogr-edit input").press("Enter");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("待核对");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await expect(grid.getByRole("gridcell", { name: "已保存但回包丢失", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.version.draftRevision).toBe(2);
  expect(saved.version.status).toBe("draft");
  expect(saved.bills[0].rows[0].itemName).toBe("已保存但回包丢失");
});

test("retains the same pending save intent across reload instead of generating another write", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  expect((await request.post("/api/__grid_fixture/drop-next-save-response", { headers })).status()).toBe(200);
  const writes: string[] = [];
  const lookups: string[] = [];
  page.on("request", outgoing => {
    if (outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version")) writes.push(outgoing.postDataJSON().idempotencyKey);
    if (outgoing.method() === "GET" && outgoing.url().includes("/save-requests/")) lookups.push(outgoing.url().split("/save-requests/")[1]!);
  });
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("重载仍须核对的保存");
  await grid.locator("revogr-edit input").press("Enter");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("待核对");
  page.once("dialog", dialog => void dialog.accept());
  await page.reload();
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("待核对");
  await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  expect(writes).toHaveLength(1);
  expect(lookups).toEqual([writes[0]]);
});

test("keeps an absent receipt unknown while the original HTTP request is still in flight", async ({ page, context, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/hold-next-save-request", { headers })).status()).toBe(200);
  const writes: string[] = [];
  page.on("request", outgoing => { if (outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version")) writes.push(outgoing.postDataJSON().idempotencyKey); });
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("在途未登记回执的原请求");
  await grid.locator("revogr-edit input").press("Enter");
  await expect.poll(async () => (await (await request.get("/api/__grid_fixture/held-request", { headers })).json()).held).toBe(true);
  await context.setOffline(true);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("待核对");
  await context.setOffline(false);
  await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-error")).toContainText("原请求可能仍在处理");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect((await request.post("/api/__grid_fixture/release-save-request", { headers })).status()).toBe(200);
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).version.draftRevision).toBe(2);
  await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  expect(writes).toHaveLength(1);
});

test("keeps offline editing local and saves only after reconnecting and verifying the current revision", async ({ page, context, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const writes: string[] = [];
  page.on("request", outgoing => { if (outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version")) writes.push(outgoing.postDataJSON().idempotencyKey); });
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await expect(grid.getByRole("gridcell", { name: "级配碎石", exact: true })).toBeVisible();
  await context.setOffline(true);
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("离线输入连接后保存");
  await grid.locator("revogr-edit input").press("Enter");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("离线");
  await page.clock.fastForward(2_100);
  await expect(grid.getByRole("gridcell", { name: "离线输入连接后保存", exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  expect((await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe("级配碎石");
  await context.setOffline(false);
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe("离线输入连接后保存");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  expect(writes).toHaveLength(1);
});

test("does not clear dirty state or replace Chinese composition when an older save acknowledges", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/delay-next-save-response", { headers })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("组字开始前的已发草稿");
  await grid.locator("revogr-edit input").press("Enter");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).version.draftRevision).toBe(2);
  await grid.getByRole("gridcell", { name: "组字开始前的已发草稿", exact: true }).dblclick();
  const input = grid.locator("revogr-edit input");
  await input.dispatchEvent("compositionstart");
  await input.fill("旧回执不能盖掉的中文组字");
  await expect(input).toHaveValue("旧回执不能盖掉的中文组字");
  expect((await request.post("/api/__grid_fixture/release-save-response", { headers })).status()).toBe(200);
  await expect(page.getByTestId("contract-draft-save-status")).not.toContainText("保存中");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("旧回执不能盖掉的中文组字");
  await expect(page.getByTestId("contract-draft-save-status")).not.toContainText("已保存");
  await input.dispatchEvent("compositionend", { data: "旧回执不能盖掉的中文组字" });
  await input.press("Enter");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe("旧回执不能盖掉的中文组字");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
});


test("downloads a Chinese four-decimal workbook with no hidden identities or technical rows", async ({ page }) => {
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载标准模板", exact: true }).click()
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path!);
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["填写说明", "清单数据"]);
  for (const sheet of workbook.worksheets) {
    expect(sheet.state).toBe("visible");
    sheet.eachRow(row => { expect(row.hidden).not.toBe(true); });
    for (const column of sheet.columns) expect(column.hidden).not.toBe(true);
  }
  const sheet = workbook.getWorksheet("清单数据")!;
  expect(sheet.getRow(1).values).not.toContain("__rowKey");
  expect(sheet.getCell("A2").value).not.toBe("itemCode");
  expect(sheet.getColumn(5).numFmt).toBe("@");
  expect(sheet.getColumn(6).numFmt).toBe("@");
});


test("previews an actual Chinese workbook with cell errors and does not write draft rows before confirmation", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  expect(template.status()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await template.body()).buffer);
  const sheet = workbook.getWorksheet("清单数据")!;
  const labels = sheet.getRow(1).values as string[];
  const column = (label: string) => { const index = labels.indexOf(label); expect(index).toBeGreaterThan(0); return index; };
  sheet.getRow(2).getCell(column("项目名称")).value = "Excel待核对四位材料";
  sheet.getRow(2).getCell(column("单位")).value = "吨";
  sheet.getRow(2).getCell(column("数量")).value = "0";
  sheet.getRow(2).getCell(column("含税单价(元)")).value = "1.00001";
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const previewPromise = page.waitForResponse(response => response.url().endsWith("/bills/main/import-preview") && response.request().method() === "POST");
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({ name: "中文四位预检.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  const previewResponse = await previewPromise;
  expect(previewResponse.status()).toBe(201);
  const preview = await previewResponse.json();
  expect(preview.errors).toEqual(expect.arrayContaining([expect.objectContaining({ sheet: "清单数据", row: 2, column: "F", message: expect.stringContaining("4") })]));
  await expect(page.locator(".t-alert").getByText(/第 2 行.*F/)).toBeVisible();
  expect(preview.sourceRows).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, values: expect.objectContaining({ unitPrice: "1.00001" }) })]));
  await page.getByRole("button", { name: "定位 清单数据 F2", exact: true }).click();
  const sourceGrid = page.getByTestId("bill-import-source-grid");
  await expect(sourceGrid.getByRole("gridcell", { name: "1.00001", exact: true })).toHaveClass(/import-source--target/u);
  await expect(sourceGrid.locator("revogr-edit input")).toHaveCount(0);
  const draft = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(draft.version.draftRevision).toBe(1);
  expect(draft.bills[0].rows).toHaveLength(2);
});


test("appends imported four-decimal and unknown rows only after confirmation without losing long quantities", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  expect(template.status()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await template.body()).buffer);
  const sheet = workbook.getWorksheet("清单数据")!;
  sheet.getCell("B2").value = "Excel精确追加";
  sheet.getCell("D2").value = "吨";
  sheet.getCell("E2").value = "123456789012345678.1234";
  sheet.getCell("F2").value = "0.0001";
  sheet.getCell("B3").value = "Excel未知单价";
  sheet.getCell("D3").value = "项";
  sheet.getCell("E3").value = "1";
  sheet.getCell("B4").value = "Excel明确零单价";
  sheet.getCell("D4").value = "项";
  sheet.getCell("E4").value = "1";
  sheet.getCell("F4").value = "0";
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({ name: "追加及未知.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await expect(page.getByRole("dialog", { name: "确认载入 Excel 清单" })).toBeVisible();
  const before = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(before.bills[0].rows).toHaveLength(2);
  expect(before.version.draftRevision).toBe(1);
  await expect(page.getByRole("radio", { name: "追加到现有清单" })).toBeChecked();
  await page.getByTestId("bill-import-confirm").click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(5);
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.version.status).toBe("draft");
  expect(saved.bills[0].rows.find((row: { itemName: string }) => row.itemName === "Excel精确追加")).toMatchObject({ quantity: "123456789012345678.1234", unitPrice: "0.0001" });
  expect(saved.bills[0].rows.find((row: { itemName: string }) => row.itemName === "Excel未知单价")).toMatchObject({ quantity: "1", unitPrice: null });
  expect(saved.bills[0].rows.find((row: { itemName: string }) => row.itemName === "Excel明确零单价")).toMatchObject({ quantity: "1", unitPrice: expect.stringMatching(/^0(?:\.0+)?$/u) });
});


test("undoes an unsaved batch deletion without replacing edits made to the remaining row", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "长名称材料用于核验表格与局部滚动", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("删除以后仍保留的修改");
  await grid.locator("revogr-edit input").press("Enter");
  await expect(grid.getByRole("gridcell", { name: "删除以后仍保留的修改", exact: true })).toBeVisible();
  expect((await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).version.draftRevision).toBe(1);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(grid.getByRole("gridcell", { name: "级配碎石", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "删除以后仍保留的修改", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.map((row: { itemName: string }) => row.itemName)).toEqual(["级配碎石", "删除以后仍保留的修改"]);
});


test("restores an automatically saved deletion without treating arbitrary missing row keys as new rows", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(1);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid").getByRole("gridcell", { name: "级配碎石", exact: true })).toBeVisible();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.map((row: { itemName: string }) => row.itemName)).toEqual(["级配碎石", "长名称材料用于核验表格与局部滚动"]);
});


test("requires explicit replacement confirmation and reverses the imported candidate before saving", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await template.body()).buffer);
  const sheet = workbook.getWorksheet("清单数据")!;
  sheet.getCell("B2").value = "明确替换的Excel材料";
  sheet.getCell("D2").value = "项";
  sheet.getCell("E2").value = "1";
  sheet.getCell("F2").value = "1.2345";
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({ name: "明确替换.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await expect(page.getByRole("radio", { name: "追加到现有清单" })).toBeChecked();
  await page.getByRole("radio", { name: "替换现有清单" }).locator("..").click();
  await expect(page.getByText(/将替换当前 2 行清单/)).toBeVisible();
  expect((await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).version.draftRevision).toBe(1);
  await page.getByTestId("bill-import-confirm").click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await expect(grid.getByRole("gridcell", { name: "明确替换的Excel材料", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "级配碎石", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "撤销本次导入", exact: true }).click();
  await expect(grid.getByRole("gridcell", { name: "级配碎石", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "长名称材料用于核验表格与局部滚动", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "明确替换的Excel材料", exact: true })).toHaveCount(0);
});


test("saves a header-only draft edit through the production DTO pipe while leaving grid facts unchanged", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByPlaceholder("请填写合同名称", { exact: true }).fill("仅修改基本信息的合同草稿");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).draft.contractName).toBe("仅修改基本信息的合同草稿");
  const draft = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(draft.bills[0].rows.map((row: { unitPrice: string }) => row.unitPrice)).toEqual(["1.534", "1.534"]);
});


test("keeps edits made immediately after undoing a saved deletion across the exact restore acknowledgement", async ({ page, request, context, isMobile }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(1);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  expect((await request.post("/api/__grid_fixture/delay-next-save-response", { headers })).status()).toBe(200);
  const restoringRequest = page.waitForRequest(outgoing => outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version") && outgoing.postDataJSON().bills[0].rows.some((row: { restoreRef?: unknown }) => row.restoreRef));
  try {
    await page.getByRole("button", { name: "撤销删除", exact: true }).click();
    const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
    if (isMobile) await swipeToBillColumn(page, context, "含税单价 *");
    await grid.getByRole("gridcell", { name: "1.534", exact: true }).first().dblclick();
    await grid.locator("revogr-edit input").fill("2.3456");
    await grid.locator("revogr-edit input").press("Enter");
    const sent = (await restoringRequest).postDataJSON();
    expect(sent.bills[0].rows.find((row: { restoreRef?: unknown }) => row.restoreRef).unitPrice).toBe("1.534");
    await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).version.draftRevision).toBe(3);
  } finally {
    await request.post("/api/__grid_fixture/release-save-response", { headers });
  }
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].unitPrice).toBe("2.3456");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
});


test("restores legacy six-place facts and their recorded cents together with unknown and zero facts unchanged", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "legacy-null-zero" } })).status()).toBe(200);
  const read = async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json());
  const projectFacts = (row: Record<string, unknown>) => Object.fromEntries(["itemName", "quantity", "unitPrice", "taxRate", "taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents", "taxInclusiveAmountYuan", "taxExclusiveAmountYuan", "taxAmountYuan", "numericProtocolVersion", "numericSource", "numericReviewStatus", "precisionPolicy"].map(key => [key, row[key]]));
  const before = (await read()).bills[0].rows.map(projectFacts);
  expect(before[0]).toMatchObject({ quantity: "1.234567", unitPrice: "2.345678", taxInclusiveAmountCents: "991", numericSource: "legacy_cents", numericReviewStatus: "not_assessed" });
  expect(before[1]).toMatchObject({ unitPrice: null, taxInclusiveAmountYuan: null });
  expect(before[2]).toMatchObject({ unitPrice: expect.stringMatching(/^0(?:\.0+)?$/u), taxInclusiveAmountYuan: "0.0000" });
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  for (const index of [1, 2, 3]) await page.getByRole("gridcell", { name: `选择第${index}行`, exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect.poll(async () => (await read()).bills[0].rows.length).toBe(0);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect.poll(async () => (await read()).bills[0].rows.map(projectFacts)).toEqual(before);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  await expect(page.locator("[data-cell-error]")).toHaveCount(0);
});


test("retains an unsaved value changed before deletion while restoring the server original first", async ({ page, request, context, isMobile }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const read = async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json());
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  if (isMobile) await swipeToBillColumn(page, context, "含税单价 *");
  await grid.getByRole("gridcell", { name: "1.534", exact: true }).first().dblclick();
  await grid.locator("revogr-edit input").fill("2.3456");
  await grid.locator("revogr-edit input").press("Enter");
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await page.clock.fastForward(2100);
  await expect.poll(async () => (await read()).bills[0].rows.length).toBe(1);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await page.clock.fastForward(2100);
  await expect.poll(async () => (await read()).version.draftRevision).toBe(3);
  const restored = await read();
  expect(restored.bills[0].rows[0].unitPrice).toBe("1.534");
  await expect(page.getByTestId("contract-draft-save-status")).not.toContainText("保存中");
  await expect(page.getByTestId("contract-draft-save-status")).not.toContainText("已保存");
  await page.clock.fastForward(2100);
  await expect.poll(async () => (await read()).bills[0].rows[0].unitPrice).toBe("2.3456");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
});


function gridApiRow(row: Record<string, unknown>, index: number) {
  const rate = row.taxRatePercent ?? row.taxRate;
  return {
    clientRowKey: String(row.clientRowKey ?? row.rowKey), ...(row.rowKey ? { rowKey: row.rowKey } : {}), sortOrder: index,
    itemCode: row.itemCode ?? "", itemName: row.itemName, specification: row.specification ?? "", unit: row.unit,
    quantity: row.quantity ?? null, unitPrice: row.unitPrice ?? null,
    ...(rate == null ? {} : { taxRatePercent: rate }), taxRateSource: row.taxRateSource ?? "version_default",
    isProvisional: row.isProvisional ?? false, settlementBasis: row.settlementBasis ?? "", customData: row.customData ?? {}
  };
}
function gridApiSave(expectedRevision: number, billRevision: number, rows: Record<string, unknown>[]) {
  return { idempotencyKey: randomUUID(), saveKind: "auto", expectedRevision, changedSections: ["bills"],
    draft: { draftData: { contractName: "本地合成合同", fieldValues: {}, partyValues: {} }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", taxFacts: { invoiceType: "vat_special", taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
    parties: [], bills: [{ billKey: "main", numericProtocolVersion: 2, expectedRevision: billRevision, rows }], paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
}

test("rejects forged, cross-draft, cross-actor and repeated restore references without writes and keeps public receipts frozen", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "two-drafts" } })).status()).toBe(200);
  const path = "/api/contract-drafts/grid-version";
  const read = async (version = "grid-version") => { const response = await request.get(`/api/contract-drafts/${version}/workbench`, { headers }); expect(response.status()).toBe(200); return response.json(); };
  const initial = await read();
  const grant = await (await request.post(`${path}/edit-lease`, { headers })).json();
  const writeHeaders = { ...headers, "x-contract-draft-lease": grant.token };
  const deletion = gridApiSave(1, 1, initial.bills[0].rows.slice(1).map(gridApiRow));
  const savedDeletionResponse = await request.put(path, { headers: writeHeaders, data: deletion });
  expect(savedDeletionResponse.status()).toBe(200);
  const savedDeletion = await savedDeletionResponse.json();
  expect(JSON.stringify(savedDeletion)).not.toContain("_rowUndo");
  const ref = savedDeletion.deletedRowRestoreRefs.main[0];
  expect(Object.keys(ref.originalValues).sort()).toEqual(["customData", "isProvisional", "itemCode", "itemName", "quantity", "settlementBasis", "specification", "taxRatePercent", "taxRateSource", "unit", "unitPrice"].sort());
  const current = await read();
  const restoreRow = { ...ref.originalValues, clientRowKey: "restore-original", sortOrder: 0, restoreRef: { saveIntentKey: ref.saveIntentKey, oldRowKey: ref.oldRowKey } };
  const attempt = (override: Record<string, unknown>) => gridApiSave(2, 2, [{ ...restoreRow, ...override }, ...current.bills[0].rows.map(gridApiRow)]);
  const fake = await request.put(path, { headers: writeHeaders, data: attempt({ restoreRef: { saveIntentKey: randomUUID(), oldRowKey: ref.oldRowKey } }) });
  expect(fake.status()).toBe(400);
  const wrongKey = await request.put(path, { headers: writeHeaders, data: attempt({ restoreRef: { saveIntentKey: ref.saveIntentKey, oldRowKey: "not-a-deleted-row" } }) });
  expect(wrongKey.status()).toBe(400);
  const tampered = await request.put(path, { headers: writeHeaders, data: attempt({ unitPrice: "9.999999" }) });
  expect(tampered.status()).toBe(400);
  const priorOwner = await (await request.get("/api/__grid_fixture/session?actor=prior-owner")).json();
  const forbidden = await request.put(path, { headers: { ...writeHeaders, authorization: `Bearer ${priorOwner.accessToken}` }, data: attempt({}) });
  expect(forbidden.status()).toBe(403);
  const other = await read("grid-other-version");
  const otherGrant = await (await request.post("/api/contract-drafts/grid-other-version/edit-lease", { headers })).json();
  const crossDraft = await request.put("/api/contract-drafts/grid-other-version", { headers: { ...headers, "x-contract-draft-lease": otherGrant.token }, data: gridApiSave(1, 1, [restoreRow, ...other.bills[0].rows.map(gridApiRow)]) });
  expect(crossDraft.status()).toBe(400);
  expect((await crossDraft.json()).message).toContain("不属于当前经办人的合同草稿");
  expect((await read()).version.draftRevision).toBe(2);
  expect((await read("grid-other-version")).version.draftRevision).toBe(1);
  const restoredResponse = await request.put(path, { headers: writeHeaders, data: attempt({}) });
  expect(restoredResponse.status()).toBe(200);
  const restored = await read();
  expect(restored.version.draftRevision).toBe(3);
  expect(restored.bills[0].rows).toHaveLength(2);
  expect(restored.bills[0].rows[0].rowKey).not.toBe(ref.oldRowKey);
  const lookup = await (await request.get(`${path}/save-requests/${deletion.idempotencyKey}`, { headers })).json();
  expect(lookup.result).toEqual(savedDeletion);
  const replay = await request.put(path, { headers: writeHeaders, data: deletion });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(savedDeletion);
  const duplicate = await request.put(path, { headers: writeHeaders, data: gridApiSave(3, 3, [restoreRow, ...restored.bills[0].rows.map(gridApiRow)]) });
  expect(duplicate.status()).toBe(400);
  expect((await duplicate.json()).message).toContain("已经恢复");
  const arbitrary = await request.put(path, { headers: writeHeaders, data: gridApiSave(3, 3, [...restored.bills[0].rows.map(gridApiRow), { ...gridApiRow(initial.bills[0].rows[0], 2), clientRowKey: "arbitrary-new-key", rowKey: "arbitrary-missing-key" }]) });
  expect(arbitrary.status()).toBe(400);
  expect((await read()).version.draftRevision).toBe(3);
});

test("rejects a valid current writer restoring a prior owner's deletion receipt after transfer", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "prior-owner-deletion" } })).status()).toBe(200);
  const path = "/api/contract-drafts/grid-version";
  const before = await (await request.get(`${path}/workbench`, { headers })).json();
  expect(before.contract.ownerUserId).toBe(session.user.id);
  const grantResponse = await request.post(`${path}/edit-lease`, { headers });
  expect(grantResponse.status()).toBe(201);
  const grant = await grantResponse.json();
  const input = gridApiSave(2, 2, [{ clientRowKey: "prior-owner-original", sortOrder: 0, itemName: "级配碎石", unit: "吨", quantity: "1", unitPrice: "1.534", taxRatePercent: "0", taxRateSource: "version_default", customData: {}, restoreRef: { saveIntentKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", oldRowKey: "grid-row-key-0" } }, ...before.bills[0].rows.map(gridApiRow)]);
  const response = await request.put(path, { headers: { ...headers, "x-contract-draft-lease": grant.token }, data: input });
  expect(response.status()).toBe(400);
  expect((await response.json()).message).toContain("不属于当前经办人的合同草稿");
  const after = await (await request.get(`${path}/workbench`, { headers })).json();
  expect(after.version.draftRevision).toBe(2);
  expect(after.bills[0].rows).toEqual(before.bills[0].rows);
  const lookup = await (await request.get(`${path}/save-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { headers })).json();
  expect(lookup).toEqual({ status: "unknown" });
});


test("does not grant legacy precision through changed text, scientific notation or malformed restored input", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "legacy-null-zero" } })).status()).toBe(200);
  const path = "/api/contract-drafts/grid-version";
  const read = async () => { const result = await request.get(`${path}/workbench`, { headers }); expect(result.status()).toBe(200); return result.json(); };
  const initial = await read();
  const grantResponse = await request.post(`${path}/edit-lease`, { headers });
  expect(grantResponse.status()).toBe(201);
  const writeHeaders = { ...headers, "x-contract-draft-lease": (await grantResponse.json()).token };
  const deletedResponse = await request.put(path, { headers: writeHeaders, data: gridApiSave(1, 1, initial.bills[0].rows.slice(1).map(gridApiRow)) });
  expect(deletedResponse.status()).toBe(200);
  const ref = (await deletedResponse.json()).deletedRowRestoreRefs.main[0];
  expect(ref.originalValues.unitPrice).toBe("2.345678");
  const current = await read();
  for (const unitPrice of ["2.345679", "2.3456780", "2.345678e0", "无效数值"]) {
    const input = gridApiSave(2, 2, [{ ...ref.originalValues, unitPrice, clientRowKey: "legacy-restore-attempt", sortOrder: 0, restoreRef: { saveIntentKey: ref.saveIntentKey, oldRowKey: ref.oldRowKey } }, ...current.bills[0].rows.map(gridApiRow)]);
    const result = await request.put(path, { headers: writeHeaders, data: input });
    expect(result.status(), unitPrice).toBe(400);
    expect((await read()).version.draftRevision).toBe(2);
    expect((await read()).bills[0].rows).toEqual(current.bills[0].rows);
  }
});


test("highlights checked rows and shows selected and whole-draft four-place totals", async ({ page }) => {
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await expect(grid.getByRole("gridcell", { name: "级配碎石", exact: true })).toHaveClass(/cell--selected/u);
  await expect(page.getByTestId("bill-selected-total")).toContainText("1.5340 元");
  await expect(page.getByTestId("bill-current-total")).toContainText("3.0680 元");
  await page.getByRole("gridcell", { name: "选择第2行", exact: true }).locator(".t-checkbox").click({ modifiers: ["Shift"] });
  await expect(page.getByText("已选择 2 行", { exact: true })).toBeVisible();
  await expect(page.getByTestId("bill-selected-total")).toContainText("3.0680 元");
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await expect(page.getByTestId("bill-selected-total")).toContainText("0.0000 元");
});

test("provides row-side copy and bottom addition with a focused editor on the new row", async ({ page, context, isMobile }) => {
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  if (isMobile) await swipeToBillColumn(page, context, "行操作");
  const copy = page.getByRole("button", { name: "复制第1行", exact: true });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid revogr-edit input")).toBeFocused();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid revogr-edit input")).toHaveValue("级配碎石");
  await page.getByTestId("contract-bill-grid").locator("revo-grid revogr-edit input").press("Escape");
  await page.getByTestId("bill-add-bottom").click();
  await expect(page.getByRole("checkbox", { name: "选择第4行" })).toBeVisible();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid revogr-edit input")).toBeFocused();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid revogr-edit input")).toHaveValue("");
});

test("locates a rejected decimal cell and saves corrected input as a fresh confirmed intent", async ({ page, request, context, isMobile }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const writes: string[] = [];
  page.on("request", outgoing => { if (outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version")) writes.push(outgoing.postDataJSON().idempotencyKey); });
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  if (isMobile) await swipeToBillColumn(page, context, "含税单价 *");
  await grid.getByRole("gridcell", { name: "1.534", exact: true }).first().dblclick();
  await grid.locator("revogr-edit input").fill("1.00001");
  await grid.locator("revogr-edit input").press("Enter");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("保存失败");
  const invalid = grid.getByRole("gridcell", { name: "1.00001", exact: true });
  await expect(invalid).toBeVisible();
  await page.getByRole("button", { name: /第 1 行 · 含税单价：/ }).click();
  await expect(grid.locator("revogr-edit input")).toBeFocused();
  await expect(grid.locator("revogr-edit input")).toHaveValue("1.00001");
  await grid.locator("revogr-edit input").fill("1.2345");
  await grid.locator("revogr-edit input").press("Enter");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].unitPrice).toBe("1.2345");
  expect(writes).toHaveLength(2);
  expect(writes[1]).not.toBe(writes[0]);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
});


test("requires actual private-file read authority before Excel preview reads bytes", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "file-permissions" } })).status()).toBe(200);
  const preview = (fileId: string) => request.post("/api/contract-drafts/grid-version/bills/main/import-preview", { headers, data: { fileId, mode: "append", numericProtocolVersion: 2 } });
  const denied = await preview("grid-foreign-file");
  expect(denied.status()).toBe(403);
  expect((await (await request.get("/api/__grid_fixture/storage-reads", { headers })).json()).reads).toBe(0);
  for (const id of ["grid-own-file", "grid-bound-file"]) {
    const response = await preview(id);
    expect(response.status()).toBe(201);
    expect((await response.json()).errors).toEqual([]);
  }
  expect((await (await request.get("/api/__grid_fixture/storage-reads", { headers })).json()).reads).toBe(2);
  const draft = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(draft.version.draftRevision).toBe(1);
  expect(draft.bills[0].rows).toHaveLength(2);
});


test("preserves the exact existing layout version when another draft field is saved", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "existing-layout" } })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByPlaceholder("请填写合同名称", { exact: true }).fill("保留现有版式的草稿");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).draft.contractName).toBe("保留现有版式的草稿");
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.version.layoutTemplateVersionId).toBe("grid-existing-retired-layout-version");
});


test("selects the intervening row when Shift-click extends a three-row selection", async ({ page, context, isMobile }) => {
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  if (isMobile) await swipeToBillColumn(page, context, "行操作");
  await page.getByRole("button", { name: "复制第1行", exact: true }).click();
  await page.getByTestId("contract-bill-grid").locator("revo-grid revogr-edit input").press("Escape");
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("gridcell", { name: "选择第3行", exact: true }).locator(".t-checkbox").click({ modifiers: ["Shift"] });
  await expect(page.getByRole("checkbox", { name: "选择第2行", exact: true })).toBeChecked();
  await expect(page.getByText("已选择 3 行", { exact: true })).toBeVisible();
});


test("rejects a numeric Excel cell beyond fifteen digits instead of treating its rounded value as exact input", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await template.body()).buffer);
  const sheet = workbook.getWorksheet("清单数据")!;
  sheet.getCell("B2").value = "Excel数值单元格不可静默降精度";
  sheet.getCell("D2").value = "吨";
  sheet.getCell("E2").value = 123456789012345680;
  sheet.getCell("F2").value = "0.0001";
  const upload = await request.post("/api/contract-drafts/grid-version/files", { headers, multipart: { file: { name: "大数数值.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } } });
  expect(upload.status()).toBe(201);
  const fileId = (await upload.json()).id;
  const response = await request.post("/api/contract-drafts/grid-version/bills/main/import-preview", { headers, data: { fileId, numericProtocolVersion: 2 } });
  expect(response.status()).toBe(201);
  const preview = await response.json();
  expect(preview.errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, column: "E", message: expect.stringContaining("文本") })]));
  expect(preview.rows).toEqual([]);
  const draft = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(draft.version.draftRevision).toBe(1);
  expect(draft.bills[0].rows).toHaveLength(2);
});


test("keeps unknown totals distinct from an explicitly zero selected row", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "legacy-null-zero" } })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await expect(page.getByTestId("bill-current-total")).toContainText("待确定");
  await page.getByRole("gridcell", { name: "选择第2行", exact: true }).locator(".t-checkbox").click();
  await expect(page.getByTestId("bill-selected-total")).toContainText("待确定");
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await page.getByRole("gridcell", { name: "选择第3行", exact: true }).locator(".t-checkbox").click();
  await expect(page.getByTestId("bill-selected-total")).toContainText("0.0000 元");
});

test("uses select-all and Escape only inside the row checkbox while native text selection stays native", async ({ page }) => {
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "选择第1行", exact: true });
  await checkbox.focus();
  await checkbox.press("ControlOrMeta+a");
  await expect(page.getByText("已选择 2 行", { exact: true })).toBeVisible();
  await checkbox.press("ControlOrMeta+a");
  await expect(page.getByText("已选择 2 行", { exact: true })).toBeVisible();
  await checkbox.press("Escape");
  await expect(checkbox).not.toBeChecked();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  const input = grid.locator("revogr-edit input");
  await input.press("ControlOrMeta+a");
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(4);
  await expect(checkbox).not.toBeChecked();
});


test("pastes a real multi-column clipboard past the last row and saves new row identities", async ({ page, request, context }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "长名称材料用于核验表格与局部滚动", exact: true }).dblclick();
  const text = "粘贴第一行\t规格甲\t吨\t1.2345\t2.0000\n粘贴新增第二行\t规格乙\t吨\t1\t0\n粘贴新增第三行\t规格丙\t项\t2\t1.0001";
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await grid.locator("revogr-edit input").press("ControlOrMeta+v");
  await expect(page.getByRole("checkbox", { name: "选择第4行", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "粘贴新增第三行", exact: true })).toBeVisible();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(4);
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.bills[0].rows.map((row: { itemName: string }) => row.itemName)).toEqual(["级配碎石", "粘贴第一行", "粘贴新增第二行", "粘贴新增第三行"]);
  expect(saved.bills[0].rows[1]).toMatchObject({ specification: "规格甲", unit: "吨", quantity: "1.2345", unitPrice: "2.00" });
  expect(new Set(saved.bills[0].rows.map((row: { rowKey: string }) => row.rowKey)).size).toBe(4);
  expect(saved.version.amountYuan).toBe("6.0032");
});


test("keeps clipboard columns aligned across computed cells and retains rejected decimal text", async ({ page, request, context, isMobile }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  if (isMobile) await swipeToBillColumn(page, context, "含税单价 *");
  await grid.getByRole("gridcell", { name: "1.534", exact: true }).first().dblclick();
  await page.evaluate(value => navigator.clipboard.writeText(value), "2.0000\t999.9999\trow_override\t99.9999\ttrue\t粘贴列保持原位");
  await grid.locator("revogr-edit input").press("ControlOrMeta+v");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].settlementBasis).toBe("粘贴列保持原位");
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.bills[0].rows[0]).toMatchObject({ unitPrice: "2.00", taxRateSource: "version_default", taxRatePercent: "0", isProvisional: true, taxInclusiveAmountYuan: "2.0000" });
  expect(Number(saved.bills[0].rows[0].taxExclusiveUnitPrice)).toBe(2);
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await page.evaluate(value => navigator.clipboard.writeText(value), "无效粘贴原文\t规格保留\t吨\t1.23456\t2.0000");
  await grid.locator("revogr-edit input").press("ControlOrMeta+v");
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("保存失败");
  await expect(grid.getByRole("gridcell", { name: "1.23456", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /第 1 行 · 数量：/ }).click();
  await expect(grid.locator("revogr-edit input")).toBeFocused();
  await expect(grid.locator("revogr-edit input")).toHaveValue("1.23456");
  const rejected = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(rejected.version.draftRevision).toBe(saved.version.draftRevision);
  expect(rejected.bills[0].rows[0].itemName).toBe("级配碎石");
});


test("undoes a saved Excel replacement using original six-place, unknown and zero server facts", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "legacy-null-zero" } })).status()).toBe(200);
  const read = async () => (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  const project = (row: Record<string, unknown>) => Object.fromEntries(["itemName", "quantity", "unitPrice", "taxRate", "taxExclusiveUnitPrice", "taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents", "taxInclusiveAmountYuan", "taxExclusiveAmountYuan", "taxAmountYuan", "numericProtocolVersion", "numericSource", "numericReviewStatus", "precisionPolicy"].map(key => [key, row[key]]));
  const before = (await read()).bills[0].rows.map(project);
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await template.body()).buffer);
  const sheet = workbook.getWorksheet("清单数据")!;
  sheet.getCell("B2").value = "已保存替换的新材料";
  sheet.getCell("D2").value = "项";
  sheet.getCell("E2").value = "1";
  sheet.getCell("F2").value = "1.2345";
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({ name: "保存后撤销.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await page.getByRole("radio", { name: "替换现有清单" }).locator("..").click();
  await page.getByTestId("bill-import-confirm").click();
  await expect.poll(async () => (await read()).bills[0].rows.map((row: { itemName: string }) => row.itemName)).toEqual(["已保存替换的新材料"]);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  await page.getByRole("button", { name: "撤销本次导入", exact: true }).click();
  await expect.poll(async () => (await read()).bills[0].rows.length).toBe(3);
  expect((await read()).bills[0].rows.map(project)).toEqual(before);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
});


test("keeps a deletion undo local while its save is unknown and restores only after same-intent confirmation", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const writes: Array<{ idempotencyKey: string; bills: Array<{ rows: Array<{ restoreRef?: unknown }> }> }> = [];
  page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith("/contract-drafts/grid-version")) writes.push(request.postDataJSON()); });
  expect((await request.post("/api/__grid_fixture/drop-next-save-response", { headers })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("待核对");
  expect((await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows).toHaveLength(1);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await expect(grid.getByRole("gridcell", { name: "级配碎石", exact: true })).toBeVisible();
  await page.waitForTimeout(2_100);
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(2);
  await expect(page.getByTestId("contract-draft-save-status")).toContainText("已保存");
  expect(writes).toHaveLength(2);
  expect(writes[1]!.idempotencyKey).not.toBe(writes[0]!.idempotencyKey);
  expect(writes[1]!.bills[0]!.rows.some(row => row.restoreRef)).toBe(true);
});


test("detects an actual concurrent HTTP draft update without silently overwriting either input", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.clock.install();
  const leaseResponse = page.waitForResponse(response => response.url().endsWith("/contract-drafts/grid-version/edit-lease") && response.request().method() === "POST");
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const grant = await (await leaseResponse).json();
  expect(grant.token).toBeTruthy();
  const original = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await grid.getByRole("gridcell", { name: "级配碎石", exact: true }).dblclick();
  await grid.locator("revogr-edit input").fill("本机尚未保存的材料名称");
  await grid.locator("revogr-edit input").press("Enter");
  const concurrent = gridApiSave(1, 1, original.bills[0].rows.map(gridApiRow));
  concurrent.bills[0]!.rows[0]!.itemName = "另一次公开HTTP已保存的材料";
  const external = await request.put("/api/contract-drafts/grid-version", { headers: { ...headers, "x-contract-draft-lease": grant.token }, data: concurrent });
  expect(external.status()).toBe(200);
  await page.clock.runFor(2_100);
  await expect(page.getByText("检测到版本冲突", { exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "本机尚未保存的材料名称", exact: true })).toBeVisible();
  expect((await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe("另一次公开HTTP已保存的材料");
  await page.getByRole("button", { name: "放弃本地，载入服务器版本", exact: true }).click();
  await expect(grid.getByRole("gridcell", { name: "另一次公开HTTP已保存的材料", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "本机尚未保存的材料名称", exact: true })).toHaveCount(0);
});


test("recovers an older local snapshot without clearing the server layout when that old field is absent", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "existing-layout" } })).status()).toBe(200);
  await page.clock.install();
  const leaseResponse = page.waitForResponse(response => response.url().endsWith("/contract-drafts/grid-version/edit-lease") && response.request().method() === "POST");
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const grant = await (await leaseResponse).json();
  await page.getByPlaceholder("请填写合同名称", { exact: true }).fill("旧缓存仍保留服务器版式");
  // Only the historical representation loses its newly introduced field;
  // every business value in the cache was produced by the actual UI above.
  page.once("dialog", dialog => void dialog.accept());
  await page.goto("/api/__grid_fixture/health");
  const cacheCount = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(`${encodeURIComponent("jg:contract-draft-local-recovery:v1")}:`));
    for (const key of keys) {
      const cached = JSON.parse(localStorage.getItem(key)!);
      delete cached.snapshot.draft.layoutTemplateVersionId;
      localStorage.setItem(key, JSON.stringify(cached));
    }
    return keys.length;
  });
  expect(cacheCount).toBe(1);
  // Releasing the previous view is an actual public operation; the restored
  // view must acquire its own fresh lease rather than reuse a cached secret.
  expect((await request.delete("/api/contract-drafts/grid-version/edit-lease", { headers: { ...headers, "x-contract-draft-lease": grant.token }, data: {} })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await expect(page.getByPlaceholder("请填写合同名称", { exact: true })).toHaveValue("旧缓存仍保留服务器版式");
  await page.clock.runFor(2_100);
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).draft.contractName).toBe("旧缓存仍保留服务器版式");
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.version.layoutTemplateVersionId).toBe("grid-existing-retired-layout-version");
});


test("keeps the native grid editor usable after touch entry and a keyboard-sized viewport", async ({ page, request, isMobile }, testInfo) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  const cell = grid.getByRole("gridcell", { name: "级配碎石", exact: true });
  if (isMobile) { await cell.tap(); await cell.tap(); } else await cell.dblclick();
  const input = grid.locator("revogr-edit input");
  await expect(input).toBeFocused();
  await input.fill("触摸与软键盘视口保留的材料");
  const originalSize = page.viewportSize()!;
  await page.setViewportSize({ width: originalSize.width, height: 420 });
  await page.screenshot({ path: testInfo.outputPath("keyboard-viewport.png") });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("触摸与软键盘视口保留的材料");
  await expect.poll(async () => { const box = await input.boundingBox(); return Boolean(box && box.y >= 0 && box.y + box.height <= 420); }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("keyboard-editor-visible.png") });
  const gridBox = await grid.boundingBox();
  const summaryBox = await page.locator(".bill-focus-editor > .focus-summary").boundingBox();
  expect(Boolean(gridBox && summaryBox && (summaryBox.y >= gridBox.y + gridBox.height || summaryBox.y + summaryBox.height <= gridBox.y))).toBe(true);
  await input.press("Enter");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe("触摸与软键盘视口保留的材料");
  await page.setViewportSize(originalSize);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


test("scrolls the wide grid locally by touch while keeping row identity visible", async ({ page, request, isMobile, context }, testInfo) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  const identity = grid.getByRole("gridcell", { name: "级配碎石", exact: true });
  await identity.scrollIntoViewIfNeeded();
  const rowBox = (await identity.boundingBox())!;
  const gridBox = (await grid.boundingBox())!;
  const viewport = page.viewportSize()!;
  const y = Math.max(160, Math.min(viewport.height - 100, rowBox.y + rowBox.height / 2));
  if (isMobile) {
    const cdp = await context.newCDPSession(page);
    for (let gesture = 0; gesture < 3; gesture += 1) {
      const start = Math.min(viewport.width - 25, gridBox.x + gridBox.width - 20);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y }] });
      for (let step = 1; step <= 8; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start - step * 22, y }] });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await cdp.detach();
  } else {
    await page.mouse.move(gridBox.x + gridBox.width - 100, y);
    await page.mouse.wheel(550, 0);
  }
  await page.screenshot({ path: testInfo.outputPath("local-horizontal-grid.png") });
  const horizontal = await grid.evaluate(element => Math.max(0, ...Array.from(element.querySelectorAll<HTMLElement>("*")).map(item => item.scrollLeft)));
  expect(horizontal).toBeGreaterThan(0);
  await expect(identity).toBeInViewport();
  await expect(grid.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox")).toBeInViewport();
  if (isMobile) { await identity.tap(); await identity.tap(); } else await identity.dblclick();
  const input = grid.locator("revogr-edit input");
  await expect(input).toBeFocused();
  await input.fill("横滑后仍能识别并保存的材料");
  await input.press("Enter");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe("横滑后仍能识别并保存的材料");
  const afterSaveHorizontal = await grid.evaluate(element => Math.max(0, ...Array.from(element.querySelectorAll<HTMLElement>("*")).map(item => item.scrollLeft)));
  expect(afterSaveHorizontal).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


test("keeps four-place, unknown and zero input consistent when a narrow user chooses row cards", async ({ page, request, isMobile }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const read = async () => (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await expect(page.getByTestId("contract-bill-grid").locator("revo-grid")).toHaveCount(1);
  const cards = page.getByRole("button", { name: "切换逐行填写", exact: true });
  if (isMobile) await cards.tap(); else await cards.click();
  const area = page.getByTestId("contract-bill-grid");
  await expect(area.locator("revo-grid")).toHaveCount(0);
  for (const field of ["itemCode", "itemName", "specification", "unit", "quantity", "unitPrice", "settlementBasis"]) {
    await expect(area.locator(`[data-field="${field}"]`).first()).toBeVisible();
  }
  const price = area.locator('input[data-field="unitPrice"], [data-field="unitPrice"] input').first();
  await price.fill("1.2345");
  await price.press("Tab");
  await expect.poll(async () => (await read()).bills[0].rows[0].unitPrice).toBe("1.2345");
  await price.fill("");
  await price.press("Tab");
  await expect.poll(async () => (await read()).bills[0].rows[0].unitPrice).toBeNull();
  await expect(page.getByTestId("bill-current-total")).toContainText("待确定");
  await price.fill("0");
  await price.press("Tab");
  await expect.poll(async () => (await read()).bills[0].rows[0].unitPrice).toMatch(/^0(?:\.0+)?$/u);
  expect((await read()).version.amountYuan).toBe("1.5340");
  await page.screenshot({ path: testInfo.outputPath("row-cards-320.png") });
  const table = page.getByRole("button", { name: "切换表格填写", exact: true });
  if (isMobile) await table.tap(); else await table.click();
  await expect(area.locator("revo-grid")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


for (const [width, height] of [[320, 700], [360, 740], [390, 844], [768, 700], [1366, 768], [1920, 1080]] as const) {
  test(`keeps grid editing and wrapped controls usable at ${width}px`, async ({ page, request, isMobile }, testInfo) => {
    await page.setViewportSize({ width, height });
    const session = await (await request.get("/api/__grid_fixture/session")).json();
    const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
    await page.goto("/合同工作台/grid-contract?versionId=grid-version");
    await page.getByRole("button", { name: "放大编辑", exact: true }).click();
    const area = page.locator(".bill-focus-editor");
    const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
    const choose = grid.getByRole("gridcell", { name: "选择第1行", exact: true }).locator(".t-checkbox");
    if (isMobile) await choose.tap(); else await choose.click();
    await expect(page.getByText("已选择 1 行", { exact: true })).toBeVisible();
    const failures = await area.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const failures: string[] = [];
      for (const bar of element.querySelectorAll<HTMLElement>(".focus-toolbar")) {
        const box = bar.getBoundingClientRect();
        const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button")).map(button => ({ text: button.textContent?.trim(), box: button.getBoundingClientRect() })).filter(item => item.box.width > 0 && item.box.height > 0);
        for (const item of buttons) if (item.box.left < box.left - 1 || item.box.right > box.right + 1) failures.push(`clipped:${item.text}`);
        for (let i = 0; i < buttons.length; i += 1) for (let j = i + 1; j < buttons.length; j += 1) {
          const a = buttons[i]!.box, b = buttons[j]!.box;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) failures.push("overlapping-buttons");
        }
      }
      if (bounds.left < -1 || bounds.right > innerWidth + 1) failures.push("outer-panel-overflow");
      return failures;
    });
    expect(failures).toEqual([]);
    const title = await page.getByRole("heading", { name: "合成四位材料清单", exact: true }).boundingBox();
    const titleFont = await page.getByRole("heading", { name: "合成四位材料清单", exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    expect(title!.width).toBeGreaterThan(titleFont * 3);
    expect(title!.height).toBeLessThan(70);
    const name = grid.getByRole("gridcell", { name: "级配碎石", exact: true });
    if (isMobile) { await name.tap({ position: { x: 20, y: 12 } }); await name.tap({ position: { x: 20, y: 12 } }); } else await name.dblclick();
    const input = grid.locator("revogr-edit input");
    await input.fill(`尺寸${width}仍可编辑并保存`);
    await input.press("Enter");
    await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].itemName).toBe(`尺寸${width}仍可编辑并保存`);
    await page.screenshot({ path: testInfo.outputPath(`grid-${width}.png`) });
    if (width === 768) {
      const rowBox = await grid.getByRole("gridcell", { name: `尺寸${width}仍可编辑并保存`, exact: true }).boundingBox();
      const summaryBox = await page.locator(".bill-focus-editor > .focus-summary").boundingBox();
      expect(Boolean(rowBox && summaryBox && (summaryBox.y >= rowBox.y + rowBox.height || summaryBox.y + summaryBox.height <= rowBox.y))).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}


test("aligns business text left and numeric input right in the actual grid", async ({ page, context, isMobile }) => {
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  if (isMobile) await swipeToBillColumn(page, context, /^规格(?:型号)?$/u);
  await expect(grid.getByRole("gridcell", { name: "合成规格", exact: true }).first()).toHaveCSS("text-align", "left");
  if (isMobile) await swipeToBillColumn(page, context, "含税单价 *");
  await expect(grid.getByRole("gridcell", { name: "1.534", exact: true }).first()).toHaveCSS("text-align", "right");
});


test("keeps a manual draft save committed when the separate document adapter rejects preview generation", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.clock.install();
  expect((await request.post("/api/__grid_fixture/delay-next-preview-response", { headers })).status()).toBe(200);
  const writes: Array<{ saveKind: string; idempotencyKey: string }> = [];
  const submissions: string[] = [];
  page.on("request", request => {
    if (request.method() === "PUT" && request.url().endsWith("/contract-drafts/grid-version")) writes.push(request.postDataJSON());
    if (request.url().endsWith("/submission")) submissions.push(request.url());
  });
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByPlaceholder("请填写合同名称", { exact: true }).fill("手动保存与文书结果分别显示");
  const previewRequest = page.waitForRequest(request => request.url().endsWith("/preview-generation") && request.method() === "POST");
  const reloadAfterSave = page.waitForResponse(async response => {
    if (!response.url().endsWith("/contract-drafts/grid-version/workbench") || response.request().method() !== "GET") return false;
    const queuedPreview = await previewRequest;
    await queuedPreview.response(); // Request timing is populated when its response arrives.
    return response.request().timing().startTime > queuedPreview.timing().startTime;
  });
  const firstPreview = page.waitForResponse(response => response.url().endsWith("/preview-generation") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-receipt")).toContainText("修订 2");
  const originalReceipt = await page.getByTestId("contract-draft-save-receipt").textContent();
  await page.clock.runFor(3_000);
  expect((await request.post("/api/__grid_fixture/release-preview-response", { headers })).status()).toBe(200);
  expect((await firstPreview).status()).toBe(400);
  expect((await (await reloadAfterSave).json()).version.draftRevision).toBe(2);
  await expect(page.getByTestId("contract-draft-save-receipt")).toHaveText(originalReceipt!);
  await expect(page.getByTestId("contract-draft-manual-save-message")).toContainText("资料已保存，修订号 2；文档预览生成失败");
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.draft.contractName).toBe("手动保存与文书结果分别显示");
  expect(saved.version.draftRevision).toBe(2);
  expect(saved.version.status).toBe("draft");
  expect(saved.contract.code).toBeNull();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.saveKind).toBe("manual");
  const retryPreview = page.waitForResponse(response => response.url().endsWith("/preview-generation") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await retryPreview).status()).toBe(400);
  expect(await page.getByTestId("contract-draft-save-receipt").textContent()).toBe(originalReceipt);
  expect(writes).toHaveLength(1);
  expect(submissions).toEqual([]);
  expect((await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).version.draftRevision).toBe(2);
});


test("does not carry the old save ACK into a newer server revision loaded after preview finishes", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/delay-next-preview-response", { headers })).status()).toBe(200);
  await page.clock.install();
  const lease = page.waitForResponse(response => response.url().endsWith("/edit-lease") && response.request().method() === "POST");
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const grant = await (await lease).json();
  await page.getByPlaceholder("请填写合同名称", { exact: true }).fill("本次已确认的修订二");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByTestId("contract-draft-save-receipt")).toContainText("修订 2");
  const current = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  const other = gridApiSave(2, current.bills[0].revision, current.bills[0].rows.map(gridApiRow));
  other.changedSections = ["draft"];
  other.draft.draftData.contractName = "随后由另一次HTTP保存的修订三";
  expect((await request.put("/api/contract-drafts/grid-version", { headers: { ...headers, "x-contract-draft-lease": grant.token }, data: other })).status()).toBe(200);
  expect((await request.post("/api/__grid_fixture/release-preview-response", { headers })).status()).toBe(200);
  await expect(page.getByPlaceholder("请填写合同名称", { exact: true })).toHaveValue("随后由另一次HTTP保存的修订三");
  await expect(page.getByTestId("contract-draft-save-receipt")).toHaveCount(0);
});

test("does not carry a confirmed save ACK into a different draft through client-side browser history", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "two-drafts" } })).status()).toBe(200);
  await page.clock.install();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByPlaceholder("请填写合同名称", { exact: true }).fill("只属于第一个草稿的保存回执");
  const previewRequest = page.waitForRequest(request => request.url().endsWith("/preview-generation") && request.method() === "POST");
  const reload = page.waitForResponse(async response => {
    if (!response.url().endsWith("/contract-drafts/grid-version/workbench") || response.request().method() !== "GET") return false;
    const queuedPreview = await previewRequest;
    await queuedPreview.response(); // Request timing is populated when its response arrives.
    return response.request().timing().startTime > queuedPreview.timing().startTime;
  });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await (await reload).json()).version.draftRevision).toBe(2);
  await expect(page.getByTestId("contract-draft-save-receipt")).toContainText("修订 2");
  await page.evaluate(() => history.pushState(history.state, "", "/合同工作台/grid-other-contract?versionId=grid-other-version"));
  await page.goBack();
  const targetRead = page.waitForResponse(response => response.url().endsWith("/contract-drafts/grid-other-version/workbench"));
  expect(await page.goForward()).toBeNull();
  expect((await (await targetRead).json()).version.id).toBe("grid-other-version");
  await expect(page.getByTestId("contract-draft-save-receipt")).toHaveCount(0);
  await expect(page.getByTestId("contract-draft-manual-save-message")).toHaveCount(0);
});


test("retains an uploaded workbook after a lost response and retries without duplicate files or draft rows", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await template.body()).buffer);
  const sheet = workbook.getWorksheet("清单数据")!;
  sheet.getCell("B2").value = "网络恢复后只追加一次";
  sheet.getCell("D2").value = "吨";
  sheet.getCell("E2").value = "1";
  sheet.getCell("F2").value = "1.2345";
  expect((await request.post("/api/__grid_fixture/drop-next-file-response", { headers })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({ name: "网络失败仍保留.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await expect(page.locator(".bill-focus-editor .t-alert")).toContainText(/网络|连接/u);
  await expect(page.getByTestId("bill-import-input")).toContainText("网络失败仍保留.xlsx");
  expect((await (await request.get("/api/__grid_fixture/file-count", { headers })).json()).count).toBe(1);
  const preview = page.waitForResponse(response => response.url().endsWith("/bills/main/import-preview") && response.request().method() === "POST");
  await page.getByTestId("bill-import-retry").click();
  expect((await preview).status()).toBe(201);
  expect((await (await request.get("/api/__grid_fixture/file-count", { headers })).json()).count).toBe(1);
  const beforeConfirm = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(beforeConfirm.version.draftRevision).toBe(1);
  expect(beforeConfirm.bills[0].rows).toHaveLength(2);
  await page.getByTestId("bill-import-confirm").click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(3);
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.bills[0].rows.filter((row: { itemName: string }) => row.itemName === "网络恢复后只追加一次")).toHaveLength(1);
  await expect(page.getByTestId("bill-import-retry")).toHaveCount(0);
});


test("lets the user cancel a retained workbook without merging or uploading again", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const template = await request.get("/api/contract-drafts/grid-version/bills/main/template?numericProtocolVersion=2", { headers });
  expect((await request.post("/api/__grid_fixture/drop-next-file-response", { headers })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.getByTestId("bill-import-input").locator('input[type="file"]').setInputFiles({ name: "取消后不合并.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await template.body() });
  await expect(page.getByTestId("bill-import-retry")).toBeVisible();
  await page.getByTestId("bill-import-file-cancel").click();
  await expect(page.getByTestId("bill-import-retry")).toHaveCount(0);
  await expect(page.getByTestId("bill-import-input")).not.toContainText("取消后不合并.xlsx");
  await expect(page.getByTestId("bill-import-confirm")).toHaveCount(0);
  expect((await (await request.get("/api/__grid_fixture/file-count", { headers })).json()).count).toBe(1);
  const draft = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(draft.version.draftRevision).toBe(1);
  expect(draft.bills[0].rows).toHaveLength(2);
});

test("shows Chinese tax and provisional labels while keeping their saved business values", async ({ page, request, context, isMobile }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  if (isMobile) await swipeToBillColumn(page, context, "税率来源");
  const taxHeader = grid.getByRole("columnheader", { name: "税率来源", exact: true });
  await taxHeader.scrollIntoViewIfNeeded();
  await expect(grid.getByRole("gridcell", { name: "使用合同税率", exact: true }).first()).toBeVisible();
  if (isMobile) await swipeToBillColumn(page, context, "暂定项");
  const provisional = grid.getByRole("columnheader", { name: "暂定项", exact: true });
  await provisional.scrollIntoViewIfNeeded();
  const noCell = grid.getByRole("gridcell", { name: "否", exact: true }).first();
  await expect(noCell).toBeVisible();
  await noCell.dblclick();
  await grid.locator(".jg-business-grid-select-editor input").click();
  await page.getByRole("listitem", { name: "是", exact: true }).click();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].isProvisional).toBe(true);
  await grid.getByRole("gridcell", { name: "是", exact: true }).first().dblclick();
  await grid.locator(".jg-business-grid-select-editor input").click();
  await page.getByRole("listitem", { name: "否", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows[0].isProvisional).toBe(false);
  const draft = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(draft.bills[0].rows[0].taxRateSource).toBe("version_default");
});


test("toggles the focused row with Shift Space without intercepting a native text editor", async ({ page }) => {
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  const name = grid.getByRole("gridcell", { name: "级配碎石", exact: true });
  await name.click();
  await page.keyboard.press("Shift+Space");
  await expect(page.getByRole("checkbox", { name: "选择第1行", exact: true })).toBeChecked();
  await page.keyboard.press("Shift+Space");
  await expect(page.getByRole("checkbox", { name: "选择第1行", exact: true })).not.toBeChecked();
  await name.dblclick();
  const input = grid.locator("revogr-edit input");
  await input.fill("原生文本");
  await input.press("Shift+Space");
  await expect(input).toHaveValue("原生文本 ");
  await expect(page.getByRole("checkbox", { name: "选择第1行", exact: true })).not.toBeChecked();
});


test("does not reuse a confirmed ACK after adopting a newer revision from conflict comparison", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.clock.install();
  const leaseResponse = page.waitForResponse(response => response.url().endsWith("/contract-drafts/grid-version/edit-lease") && response.request().method() === "POST");
  const writes: string[] = [];
  page.on("request", outgoing => { if (outgoing.method() === "PUT" && outgoing.url().endsWith("/contract-drafts/grid-version")) writes.push(outgoing.postDataJSON().idempotencyKey); });
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const grant = await (await leaseResponse).json();
  const name = page.getByPlaceholder("请填写合同名称", { exact: true });
  await name.fill("本机已经确认保存的名称");
  await page.clock.runFor(2100);
  await expect(page.getByTestId("contract-draft-save-receipt")).toContainText("修订 2");
  const read = async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json());
  const current = await read();
  expect(current.version.draftRevision).toBe(2);
  await name.fill("随后未保存的本机名称");
  const other = gridApiSave(2, current.bills[0].revision, current.bills[0].rows.map(gridApiRow));
  other.draft.draftData.contractName = current.draft.contractName;
  other.bills[0]!.rows[0]!.itemName = "另一公开HTTP保存的新修订事实";
  expect((await request.put("/api/contract-drafts/grid-version", { headers: { ...headers, "x-contract-draft-lease": grant.token }, data: other })).status()).toBe(200);
  await page.clock.runFor(2100);
  await expect(page.getByText("检测到版本冲突", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃本地，载入服务器版本", exact: true }).click();
  await expect(name).toHaveValue("本机已经确认保存的名称");
  expect((await read()).version.draftRevision).toBe(3);
  await expect(page.getByTestId("contract-draft-save-receipt")).toHaveCount(0);
  await page.clock.runFor(2100);
  expect(writes).toHaveLength(1);
  expect((await read()).version.draftRevision).toBe(3);
});


test("focuses the new independent row from the section and batch copy controls", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  const grid = page.getByTestId("contract-bill-grid").locator("revo-grid");
  await page.getByTestId("bill-copy-row").click();
  const input = grid.locator("revogr-edit input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("级配碎石");
  await input.fill("顶部复制的独立新行");
  await input.press("Enter");
  await page.getByRole("gridcell", { name: "选择第3行", exact: true }).locator(".t-checkbox").click();
  await page.getByRole("button", { name: "复制所选", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("顶部复制的独立新行");
  await input.fill("批量复制的独立新行");
  await input.press("Enter");
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).bills[0].rows.length).toBe(4);
  const saved = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(saved.bills[0].rows.map((row: { itemName: string }) => row.itemName)).toEqual(["级配碎石", "长名称材料用于核验表格与局部滚动", "顶部复制的独立新行", "批量复制的独立新行"]);
  expect(new Set(saved.bills[0].rows.map((row: { rowKey: string }) => row.rowKey)).size).toBe(4);
});


test("fills independent contract relationship, business type and pending tax facts on the full page", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const basic = page.locator('[data-section-id="basic"]');
  await expect(basic.locator(".business-entry-field__label").filter({ hasText: "合同关系" }).first()).toBeVisible();
  async function select(label: string, option: string) {
    await basic.locator(".business-entry-field").filter({ hasText: label }).locator(".t-select").click();
    await page.getByText(option, { exact: true }).last().click();
  }
  await select("合同关系", "对上合同（我方公司与施工企业）");
  await select("业务类型", "其他");
  await select("发票约定", "无发票");
  const settlement = basic.locator('textarea');
  await settlement.fill("以双方真实确认的结算资料为准");
  await settlement.blur();
  await expect.poll(async () => {
    const response = await request.get("/api/contract-drafts/grid-version/workbench", { headers: { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" } });
    expect(response.status()).toBe(200);
    return (await response.json()).version.draftData.contractBasics;
  }).toMatchObject({ relationship: "upward", businessType: "other", invoiceStatus: "none", settlementText: "以双方真实确认的结算资料为准" });
  await page.reload();
  await expect(basic.getByPlaceholder("请填写合同关系", { exact: true })).toHaveValue("对上合同（我方公司与施工企业）");
  await expect(basic.locator('textarea')).toHaveValue("以双方真实确认的结算资料为准");
});


test("saves declared net draft amounts over guarded HTTP and keeps unknown tax and partial facts distinct", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const grant = await (await request.post("/api/contract-drafts/grid-version/edit-lease", { headers })).json();
  const input = gridApiSave(1, 1, [{ clientRowKey: "net-line", sortOrder: 0, itemName: "不含税材料", unit: "吨", quantity: "1.2345", unitPrice: "1.2345", customData: {} }]);
  input.draft.draftData = { ...input.draft.draftData, contractBasics: { amountBasis: "tax_exclusive" } } as never;
  input.draft.taxFacts.defaultTaxRatePercent = null as never;
  const response = await request.put("/api/contract-drafts/grid-version", { headers: { ...headers, "x-contract-draft-lease": grant.token }, data: input });
  expect({ status: response.status(), body: await response.json() }).toMatchObject({ status: 200, body: { versionAmount: { amountYuan: "1.5240" } } });
  const read = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(read.bills[0]).toMatchObject({ pricingMode: "tax_exclusive", taxExclusiveAmountYuan: "1.5240", taxInclusiveAmountYuan: null, taxAmountYuan: null });
  expect(read.bills[0].rows[0]).toMatchObject({ unitPrice: "1.2345", taxExclusiveAmountYuan: "1.5240", taxInclusiveAmountYuan: null, taxAmountYuan: null });
  expect(read.draftOperationAvailableActions).not.toContain("submit_contract_draft");
});


test("saves a four-place lump sum and both current-contract party names without creating shared units", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const unitsBefore = await (await request.get("/api/business-parties", { headers })).json();
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const pricing = page.locator('[data-section-id="bill_tax"]');
  await pricing.getByText("计价性质", { exact: true }).locator("..").locator(".t-select").click();
  await page.getByText("固定总价", { exact: true }).last().click();
  const amount = pricing.getByPlaceholder("请输入含税合同金额，未知可留空", { exact: true });
  await amount.fill("1.5340");
  await amount.blur();
  const parties = page.locator('[data-section-id="parties"] .party-form');
  await parties.getByText("合同角色", { exact: true }).locator("..").locator(".t-select").click();
  await page.getByText("甲方", { exact: true }).last().click();
  await parties.getByPlaceholder("请输入公司名称", { exact: true }).fill("当前单甲方名称");
  await parties.getByRole("button", { name: "加入合同草稿", exact: true }).click();
  await parties.getByPlaceholder("请输入公司名称", { exact: true }).fill("当前单乙方名称");
  await parties.getByRole("button", { name: "加入合同草稿", exact: true }).click();
  const payment = page.getByPlaceholder("按实际约定填写付款时间、比例和条件，可留空待补充");
  await payment.fill("设备调试并由双方确认后支付，比例另行约定");
  await payment.blur();
  await expect.poll(async () => {
    const response = await request.get("/api/contract-drafts/grid-version/workbench", { headers });
    expect(response.status()).toBe(200);
    const draft = await response.json();
    return { amount: draft.version.amountYuan, names: draft.parties.map((party: { roleKey: string; snapshot: { name: string } }) => [party.roleKey, party.snapshot.name]), payment: draft.paymentTerms.originalText };
  }).toEqual({ amount: "1.5340", names: [["party_a", "当前单甲方名称"], ["party_b", "当前单乙方名称"]], payment: "设备调试并由双方确认后支付，比例另行约定" });
  const unitsAfter = await request.get("/api/business-parties", { headers });
  expect(unitsAfter.status()).toBe(200);
  expect(await unitsAfter.json()).toEqual(unitsBefore);
});


test("rejects cross-basis deletion restores before any row or revision write", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  const grant = await (await request.post("/api/contract-drafts/grid-version/edit-lease", { headers })).json();
  const writeHeaders = { ...headers, "x-contract-draft-lease": grant.token };
  const deleted = await request.put("/api/contract-drafts/grid-version", { headers: writeHeaders, data: gridApiSave(1, 1, []) });
  expect(deleted.status()).toBe(200);
  const ref = (await deleted.json()).deletedRowRestoreRefs.main[0];
  const change = gridApiSave(2, 2, []);
  change.draft.draftData = { ...change.draft.draftData, contractBasics: { amountBasis: "tax_exclusive" } } as never;
  expect((await request.put("/api/contract-drafts/grid-version", { headers: writeHeaders, data: change })).status()).toBe(200);
  const restore = gridApiSave(3, 3, [{ ...ref.originalValues, clientRowKey: "cross-basis-restore", sortOrder: 0, restoreRef: { saveIntentKey: ref.saveIntentKey, oldRowKey: ref.oldRowKey } }]);
  restore.draft.draftData = change.draft.draftData;
  const response = await request.put("/api/contract-drafts/grid-version", { headers: writeHeaders, data: restore });
  expect(response.status()).toBe(400);
  expect((await response.json()).message).toContain("原删除记录的金额口径");
  const after = await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json();
  expect(after.version.draftRevision).toBe(3);
  expect(after.bills[0].revision).toBe(3);
  expect(after.bills[0].rows).toEqual([]);
});


test("searches an existing unit name and only adds its snapshot to the current draft", async ({ page, request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  expect((await request.post("/api/__grid_fixture/reset", { headers, data: { preset: "unit-search" } })).status()).toBe(200);
  await page.goto("/合同工作台/grid-contract?versionId=grid-version");
  const parties = page.locator('[data-section-id="parties"] .party-form');
  await parties.getByPlaceholder("输入单位名称或信用代码").fill("已有材料");
  await parties.getByRole("button", { name: "搜索已有单位", exact: true }).click();
  await parties.getByPlaceholder("选择后带入当前合同名称").click();
  await page.getByText("已有材料单位", { exact: true }).last().click();
  await expect(parties.getByPlaceholder("请输入公司名称", { exact: true })).toHaveValue("已有材料单位");
  await parties.getByRole("button", { name: "加入合同草稿", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/contract-drafts/grid-version/workbench", { headers })).json()).parties.map((party: { snapshot: { name: string } }) => party.snapshot.name)).toEqual(["已有材料单位"]);
  const units = await request.get("/api/business-parties?query=已有材料", { headers });
  expect(units.status()).toBe(200);
  expect((await units.json()).map((unit: { name: string }) => unit.name)).toEqual(["已有材料单位"]);
});


test("creates new v2 contracts for all independent relations and five types with real empty bill and payment initialization", async ({ request }) => {
  const session = await (await request.get("/api/__grid_fixture/session")).json();
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
  for (const relationship of ["inside", "outside", "upward"]) for (const contractTypeKey of ["material_purchase", "equipment_rental", "labor_subcontract", "professional_subcontract", "other"]) {
    const response = await request.post("/api/contracts", { headers, data: { numericProtocolVersion: 2, projectId: "grid-project", contractTypeKey, relationship } });
    const body = await response.json();
    expect({ status: response.status(), body }).toMatchObject({ status: 201, body: { version: { numericProtocolVersion: 2, signingSubjectType: "draft_unconfirmed", amountYuan: null, amountCents: null } } });
    const readResponse = await request.get(`/api/contract-drafts/${body.version.id}/workbench`, { headers });
    expect(readResponse.status()).toBe(200);
    const read = await readResponse.json();
    expect(read.version.draftData.contractBasics).toMatchObject({ relationship, businessType: contractTypeKey });
    expect(read.version).toMatchObject({ businessTemplateVersionId: null, layoutTemplateVersionId: null, amountYuan: null, amountCents: null });
    expect(read.bills).toHaveLength(1);
    expect(read.bills[0]).toMatchObject({ numericProtocolVersion: 2, quantityScale: 4, unitPriceScale: 4, rows: [] });
    expect(read.paymentTerms).toMatchObject({ originalText: "", stages: [] });
    expect(read.draftOperationAvailableActions).not.toContain("submit_contract_draft");
    const refused = await request.post(`/api/contract-drafts/${body.version.id}/submission`, { headers, data: { expectedRevision: 1, idempotencyKey: randomUUID() } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toContain("四位金额草稿尚不能提交审批");
    const after = await (await request.get(`/api/contract-drafts/${body.version.id}/workbench`, { headers })).json();
    expect(after.version.status).toBe("draft");
    expect(after.contract.code).toBeNull();
  }
});


for (const [relationship, label] of [["inside", "表内合同（我方公司与下游）"], ["outside", "表外合同（施工企业与下游）"], ["upward", "对上合同（我方公司与施工企业）"]]) {
  test(`starts a real new ${relationship} draft from the full UI and persists partial basic information`, async ({ page, request, isMobile }) => {
    const session = await (await request.get("/api/__grid_fixture/session")).json();
    const headers = { authorization: `Bearer ${session.accessToken}`, "x-contract-numeric-protocol": "2" };
    await page.goto("/合同工作台/新建");
    await expect(page.getByRole("heading", { name: "新建合同", exact: true })).toBeVisible();
    await page.getByPlaceholder("选择业务类型", { exact: true }).click();
    await page.getByText("其他", { exact: true }).last().click();
    await page.getByPlaceholder("可先留空，生成前选择", { exact: true }).click();
    await page.getByText(label, { exact: true }).last().click();
    const createResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/contracts"));
    await page.getByRole("button", { name: "创建草稿", exact: true }).click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    const body = await created.json();
    await expect(page.getByText("待补充（未提交草稿）", { exact: true })).toBeVisible();
    const name = page.getByPlaceholder("请填写合同名称", { exact: true });
    await page.getByRole("link", { name: "基础信息", exact: true }).click();
    await name.scrollIntoViewIfNeeded();
    await expect(name).toBeInViewport();
    if (isMobile) await name.tap(); else await name.click();
    await expect(name).toBeFocused();
    await name.fill(`新建${relationship}当前草稿`);
    await name.blur();
    await expect.poll(async () => {
      const read = await request.get(`/api/contract-drafts/${body.version.id}/workbench`, { headers });
      expect(read.status()).toBe(200);
      return (await read.json()).version.draftData.contractName;
    }).toBe(`新建${relationship}当前草稿`);
    const persisted = await (await request.get(`/api/contract-drafts/${body.version.id}/workbench`, { headers })).json();
    expect(persisted.version.draftData.contractBasics).toMatchObject({ relationship, businessType: "other" });
    expect(persisted.parties).toEqual([]);
    expect(persisted.version.amountYuan).toBeNull();
    expect(persisted.version.status).toBe("draft");
    expect(persisted.contract.code).toBeNull();
  });
}
