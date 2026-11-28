import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

const { Workbook } = createRequire(new URL("../../../services/api/package.json", import.meta.url))(
  "exceljs"
) as typeof import("../../../services/api/node_modules/exceljs");

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fileName = "历史费用导入模板.xlsx";
const projectId = "sample-history-project";
const batchId = "sample-history-batch";
const batchNo = "LSFY-BROWSER-001";
const rowId = "sample-history-row";
const projectBase = `/api/projects/${projectId}/history-expenses`;
const companyId = "sample-history-company";
const companyName = "合成实际承担公司";
const companyBase = `/api/company-entities/${companyId}/history-expenses`;
const values = {
  businessRef: "EXCEL-031",
  occurredAt: "2025-01-02",
  purpose: "历史道路维护",
  costCategoryCode: "material",
  amountYuan: "10.34",
  paymentStatus: "partially_paid",
  paidAmountYuan: "2.35",
  sourceDescription: "原始收据"
};
const summary = {
  totalRows: 1, pendingRows: 1, verifiedRows: 0, notOccurredRows: 0, activatedRows: 0,
  unknownPaymentRows: 0, unpaidRows: 0, zeroAmountRows: 0, pendingSourceRows: 1,
  totalAmountCents: "1034", verifiedAmountCents: "0", postedAmountCents: "0",
  pendingAmountCents: "1034", paidAmountCents: "235", categories: []
};
const preview = {
  zeroWrites: true,
  blockingRows: 0,
  warningRows: 1,
  summary,
  importFingerprint: "sample-import-fingerprint",
  rows: [{
    rowNo: 1, businessRef: values.businessRef, occurredAt: values.occurredAt,
    paymentStatus: values.paymentStatus, costCategoryCode: values.costCategoryCode,
    amountCents: "1034", paidCents: "235", values, issues: [{ code: "payer_source_pending", severity: "warning", message: "来源待核对" }]
  }]
};

async function makeWorkbook(withExpense = false) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("历史费用");
  sheet.addRow(["业务编号", "发生日期", "用途", "类别", "金额（元）", "付款情况", "已付金额（元）",
    "付款公司", "收款方", "承担公司", "已有依据", "付款日期"]);
  if (withExpense) {
    sheet.getRow(3).values = [values.businessRef, values.occurredAt, values.purpose, "材料成本",
      values.amountYuan, "部分付款", values.paidAmountYuan, null, null, null, values.sourceDescription];
  }
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

async function openHistoryExpense(page: Page, options: { startsWithDraft?: boolean; checkMultipartBytes?: boolean; companyScope?: boolean } = {}) {
  const base = options.companyScope ? companyBase : projectBase;
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  const unknownRequests: string[] = [];
  const template = await makeWorkbook();
  const sample = await makeWorkbook(true);
  let previewRequests = 0;
  let pasteRequests = 0;
  let stage = options.startsWithDraft ? "draft" : "empty";
  let corrected = false;

  function detail() {
    const revision = stage === "draft" ? 1 : stage === "verified" ? 2 : stage === "confirmed" ? 3 : corrected ? 5 : 4;
    const reviewStatus = stage === "activated" ? "activated" : stage === "draft" ? "pending" : "verified";
    const row = {
      id: rowId, rowNo: 1, revision: stage === "draft" ? 1 : 2,
      businessRef: values.businessRef, occurredAt: values.occurredAt, amountCents: "1034", paidAmountCents: "235",
      costCategoryCode: values.costCategoryCode, paymentStatus: values.paymentStatus, paymentStatusLabel: "部分付款",
      generatedFactId: stage === "activated" ? "sample-history-fact" : null,
      reviewStatus, reviewStatusLabel: reviewStatus === "verified" ? "已核实待入账" : reviewStatus === "pending" ? "待核实" : "已入账",
      issues: [], values
    };
    const rows = corrected
      ? [row, { ...row, id: "sample-correction-row", rowNo: 2, amountCents: "1100", values: { ...values, amountYuan: "11.00" } }]
      : [row];
    return {
      id: batchId, batchNo, revision, projectId, status: stage,
      statusLabel: stage === "activated" ? "已入账" : "待核实",
      totalRows: rows.length, activatedRows: stage === "activated" ? rows.length : 0, pendingRows: Number(stage === "draft"),
      verifiedRows: Number(reviewStatus === "verified"), createdAt: "2025-01-03T00:00:00Z",
      summary,
      canVerify: stage === "draft", canConfirm: stage === "verified", canActivate: stage === "confirmed", canCorrect: stage === "activated" && !corrected,
      rows
    };
  }

  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === "/api/auth/login" && method === "POST") {
      const roles = ["comprehensive_director", "finance_staff", "finance_director"];
      return route.fulfill({ json: {
        user: { id: "sample-operator", name: "验收人员", phone: "13900000002", mustChangePassword: false, roleKeys: roles, globalRoleKeys: roles },
        tokens: { accessToken: "browser-test-token", refreshToken: "browser-test-refresh", expiresIn: 900 }
      } });
    }
    if (pathname === "/api/me/work-items" && method === "GET") {
      return route.fulfill({ json: {
        generatedAt: "2025-01-03T00:00:00Z", visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
      } });
    }
    if (pathname === "/api/projects" && method === "GET") {
      return route.fulfill({ json: [{ id: projectId, code: "TEST-01", name: "合成项目" }] });
    }
    if (pathname === "/api/company-entities/management" && method === "GET" && options.companyScope) {
      return route.fulfill({ json: [{ id: companyId, name: companyName, dataStatus: "complete", isActive: true }] });
    }
    if (options.companyScope && method === "GET") {
      if (pathname === `${projectBase}/capability`) {
        return route.fulfill({ json: { projectId, actions: { manage: true, verify: false, confirm: false, activate: false, correct: false } } });
      }
      if (pathname === `${projectBase}/batches`) return route.fulfill({ json: [] });
      if (pathname === `${companyBase}/ledger`) return route.fulfill({ json: {
        projectId: null, companyEntityId: companyId, companyName,
        costCents: stage === "activated" ? corrected ? "1720" : "1034" : "0",
        paidCents: stage === "activated" ? "235" : "0",
        outstandingCents: stage === "activated" ? "799" : "0", unknownPaymentCostCents: "0"
      } });
    }
    if (pathname === `${base}/capability` && method === "GET") {
      return route.fulfill({ json: {
        ...(options.companyScope ? { projectId: null, companyEntityId: companyId, companyName } : { projectId }),
        actions: { manage: true, verify: true, confirm: true, activate: true, correct: true }
      } });
    }
    if (pathname === `${base}/excel-template` && method === "GET") {
      return route.fulfill({ contentType: xlsxMime, body: template });
    }
    if (pathname === `${base}/excel-precheck` && method === "POST") {
      previewRequests += 1;
      const content = request.postDataBuffer();
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      expect(content?.includes(Buffer.from('name="file"'))).toBe(true);
      expect(content?.includes(Buffer.from(xlsxMime))).toBe(true);
      // WebKit's intercepted request exposes upload metadata separately from file contents.
      if (options.checkMultipartBytes) expect(content?.includes(sample)).toBe(true);
      return route.fulfill({ status: 201, json: { worksheetRows: [3], rows: [{ values }], precheck: preview } });
    }
    if (pathname === `${base}/precheck` && method === "POST") {
      pasteRequests += 1;
      expect(request.postDataJSON()).toMatchObject({ rows: [{ values: { businessRef: "PASTE-001", amountYuan: "10.34", paymentStatus: "partially_paid" } }] });
      return route.fulfill({ status: 201, json: preview });
    }
    if (pathname === `${base}/batches` && method === "GET") {
      return route.fulfill({ json: stage === "empty" ? [] : [detail()] });
    }
    if (pathname === `${base}/batches/${batchId}` && method === "GET") {
      return route.fulfill({ json: detail() });
    }
    if (pathname === `${base}/batches` && method === "POST") {
      writes.push({ method, path: pathname, body: request.postDataJSON() });
      stage = "draft";
      return route.fulfill({ status: 201, json: { ...detail(), idempotent: false } });
    }
    if (pathname === `${base}/batches/${batchId}/rows/${rowId}` && method === "PATCH") {
      writes.push({ method, path: pathname, body: request.postDataJSON() });
      stage = "verified";
      return route.fulfill({ json: detail() });
    }
    if (pathname === `${base}/batches/${batchId}/confirmations` && method === "POST") {
      writes.push({ method, path: pathname, body: request.postDataJSON() });
      stage = "confirmed";
      return route.fulfill({ status: 201, json: { batchId, revision: 3, confirmedAt: "2025-01-03T02:00:00Z" } });
    }
    if (pathname === `${base}/batches/${batchId}/activation` && method === "POST") {
      writes.push({ method, path: pathname, body: request.postDataJSON() });
      stage = "activated";
      return route.fulfill({ status: 201, json: detail() });
    }
    if (pathname === `${base}/batches/${batchId}/rows/${rowId}/corrections` && method === "POST") {
      writes.push({ method, path: pathname, body: request.postDataJSON() });
      corrected = true;
      return route.fulfill({ status: 201, json: detail() });
    }
    unknownRequests.push(`${method} ${pathname}`);
    return route.fulfill({ status: 404, json: { message: "未匹配合成 API" } });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000002");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.goto("/历史费用核实入账");
  await expect(page.getByRole("heading", { name: "历史费用核实入账" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载 Excel 模板" })).toBeVisible();
  return { writes, template, sample, unknownRequests, previewRequests: () => previewRequests, pasteRequests: () => pasteRequests };
}

test("历史费用 Excel 下载模板并按原行预检，明确提交后才创建草稿", async ({ page, browserName }) => {
  const fixture = await openHistoryExpense(page, { checkMultipartBytes: browserName === "chromium" });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Excel 模板" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(fileName);
  expect(await readFile((await download.path())!)).toEqual(fixture.template);

  const sourceFile = "历史费用-合成输入.xlsx";
  await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles({
    name: sourceFile, mimeType: xlsxMime, buffer: fixture.sample
  });
  await expect(page.getByText(sourceFile, { exact: true })).toBeVisible();
  const create = page.getByRole("button", { name: "创建批次", exact: true });
  await expect(create).toBeDisabled();
  expect(fixture.previewRequests()).toBe(0);
  expect(fixture.writes).toEqual([]);

  await page.getByRole("button", { name: "预检所选 Excel" }).click();
  await expect(page.getByText(/预检 1 行，阻断 0 行/)).toBeVisible();
  const row = page.locator(".precheck").getByRole("row").filter({ hasText: values.purpose });
  await expect(row.getByRole("cell").first()).toHaveText("3");
  await expect(row.getByRole("cell", { name: "¥10.34", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "¥2.35", exact: true })).toBeVisible();
  expect(fixture.previewRequests()).toBe(1);
  expect(fixture.writes).toEqual([]);
  await expect(create).toBeEnabled();

  await create.click();
  await expect(page.getByText(`批次 ${batchNo}`, { exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([{ method: "POST", path: `${projectBase}/batches`, body: { rows: [{ values }] } }]);
  await expect(page.getByText(sourceFile, { exact: true })).toHaveCount(0);
  expect(fixture.unknownRequests).toEqual([]);
});

test("历史费用原粘贴预检、逐行核实、主管复核、入账和更正保持可用", async ({ page }) => {
  const fixture = await openHistoryExpense(page, { startsWithDraft: true });
  await page.getByPlaceholder(/^历史费用-001/).fill(
    "PASTE-001\t2025-01-02\t原粘贴历史费用\t材料成本\t10.34\t部分付款\t2.35\t\t\t\t原凭据"
  );
  await page.getByRole("button", { name: "预检", exact: true }).click();
  await expect(page.getByText(/预检 1 行，阻断 0 行/)).toBeVisible();
  expect(fixture.pasteRequests()).toBe(1);
  expect(fixture.writes).toEqual([]);

  await page.getByRole("cell", { name: batchNo, exact: true }).click();
  await expect(page.getByText(`批次 ${batchNo}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核实", exact: true }).click();
  const dialog = page.locator(".t-dialog:visible");
  await expect(dialog.getByText("核实历史费用行", { exact: true })).toBeVisible();
  await dialog.getByPlaceholder("待核对原因、未发生说明或补充资料").fill("合成凭据已核实");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => fixture.writes).toHaveLength(1);
  await expect(page.getByText("保存核实结果失败")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "主管复核", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "主管复核", exact: true }).click();
  await page.getByRole("button", { name: "入账已核实行", exact: true }).click();
  await expect(page.getByText("已核实行已入账，待核对行保留", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "更正", exact: true }).click();
  await expect(dialog.getByText("更正已入账历史费用", { exact: true })).toBeVisible();
  await dialog.getByPlaceholder("请说明依据和更正原因").fill("按合成原据更正");
  await dialog.getByPlaceholder("例如 700.00").fill("11.00");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => fixture.writes).toHaveLength(4);
  await expect(page.getByText(`批次 ${batchNo}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "¥10.34", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "¥11.00", exact: true })).toBeVisible();
  await expect(page.getByText("更正已入账历史费用失败")).toHaveCount(0);
  expect(fixture.writes).toEqual([
    { method: "PATCH", path: `${projectBase}/batches/${batchId}/rows/${rowId}`, body: { expectedRevision: 1, reviewOutcome: "verified", note: "合成凭据已核实" } },
    { method: "POST", path: `${projectBase}/batches/${batchId}/confirmations`, body: { expectedRevision: 2, idempotencyKey: expect.any(String), note: "主管复核历史费用行" } },
    { method: "POST", path: `${projectBase}/batches/${batchId}/activation`, body: { expectedRevision: 3 } },
    { method: "POST", path: `${projectBase}/batches/${batchId}/rows/${rowId}/corrections`, body: {
      expectedRevision: 2, reason: "按合成原据更正",
      values: { amountYuan: "11.00", paymentStatus: "partially_paid", paidAmountYuan: "2.35",
        payerCompanyName: null, costBearingCompanyName: null, payeeName: null, sourceDescription: "原始收据" }
    } }
  ]);
  expect(fixture.unknownRequests).toEqual([]);
});


test("公司日常历史费用按实际承担公司登记，正常入口可查净成本和付款情况", async ({ page }) => {
  const fixture = await openHistoryExpense(page, { companyScope: true });
  await page.getByText("公司日常费用", { exact: true }).click();
  await expect(page.getByText("公司日常历史费用台账", { exact: true })).toBeVisible();
  await expect(page.getByText("实际承担公司", { exact: true })).toBeVisible();
  await expect(page.getByText("公司日常费用不关联项目。", { exact: false })).toBeVisible();
  await expect(page.locator(".t-select input").first()).toHaveValue(companyName);
  await page.getByPlaceholder(/^历史费用-001/).fill("PASTE-001|2025-01-02|历史道路维护|材料|10.34|部分付款|2.35|另一个付款公司|||原始收据");
  await page.getByRole("button", { name: "预检", exact: true }).click();
  await expect(page.getByText(/预检 1 行，阻断 0 行/)).toBeVisible();
  expect(fixture.writes).toHaveLength(0);
  await page.getByRole("button", { name: "创建批次", exact: true }).click();
  await expect(page.getByText(`批次 ${batchNo}`, { exact: true })).toBeVisible();
  expect(fixture.writes).toMatchObject([{ path: `${companyBase}/batches`, body: { rows: [
    { values: { payerCompanyName: "另一个付款公司", costBearingCompanyName: null } }
  ] } }]);
  await page.getByRole("button", { name: "核实", exact: true }).click();
  const dialog = page.locator(".t-dialog:visible");
  await expect(dialog.getByText("核实历史费用行", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "主管复核", exact: true }).click();
  await page.getByRole("button", { name: "入账已核实行", exact: true }).click();
  const ledger = page.locator(".t-card").filter({ hasText: "公司日常历史费用台账" });
  await expect(ledger.getByText("¥10.34", { exact: true })).toBeVisible();
  await expect(ledger.getByText("¥2.35", { exact: true })).toBeVisible();
  await expect(ledger.getByText("¥7.99", { exact: true })).toBeVisible();
  expect(fixture.writes.map(write => write.path)).toEqual([
    `${companyBase}/batches`, `${companyBase}/batches/${batchId}/rows/${rowId}`,
    `${companyBase}/batches/${batchId}/confirmations`, `${companyBase}/batches/${batchId}/activation`
  ]);
  expect(fixture.unknownRequests).toEqual([]);
});
