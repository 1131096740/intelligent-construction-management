import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { SignedSettlementLedgerPage, SignedSettlementLedgerRow } from "../src/api/core-flow-read.api";
import { signedSettlementFixture } from "./helpers/signed-settlement-fixture";

const keyword = "高精度幕墙";
const sort = "confirmedAt:asc";
const filename = "已签结算台账.xlsx";
const workbookResponse = Buffer.from("synthetic signed-settlement export");

const columns: SignedSettlementLedgerPage["columns"] = [
  { key: "settlementNo", header: "结算编号", required: true },
  { key: "project", header: "项目", required: true },
  { key: "signingParty", header: "签约方（甲方）", required: true },
  { key: "counterparty", header: "相对方（乙方）", required: true },
  { key: "amountYuan", header: "结算金额（元）", required: true },
  { key: "statusLabel", header: "复核状态", required: false }
];

function confirmedRow(confirmationNo: string, settlementNo: string, amountYuan: string, confirmedAt: string): SignedSettlementLedgerRow {
  return {
    id: settlementNo, settlementId: settlementNo, settlementNo, confirmationNo,
    contractKind: "downstream", contractKindLabel: "下游合同", relationship: "inside", relationshipLabel: "表内",
    contractName: "高精度幕墙分包合同", projectId: "project-1", project: "一号项目",
    signingParty: "四川建工智管建筑工程有限公司", counterparty: "高精度结算测试单位",
    amountYuan, amount: `¥${amountYuan}`, amountKnown: true,
    confirmedAt, confirmedDate: "2026-11-20", confirmedAtText: "2026-11-20", reviewerName: "合同主管",
    status: "confirmed", statusLabel: "已复核", updatedAt: confirmedAt
  };
}

const rows = [
  confirmedRow("1", "JS-421-PRECISION", "1234567890123456.7890", "2026-11-20T01:30:00.000Z"),
  confirmedRow("2", "JS-421-PRECISION-OFFSET", "-25.5001", "2026-11-20T02:30:00.000Z")
];

for (const [label, viewport] of [
  ["电脑", { width: 1440, height: 900 }],
  ["手机", { width: 390, height: 844 }]
] as const) {
  test(`${label}结算台账显示已复核负数四位金额并按查询条件下载`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await signedSettlementFixture(page, "confirmed");
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route(url => url.pathname === "/api/settlements/signed-ledger", route => {
      const query = new URL(route.request().url()).searchParams;
      const filtered = query.get("keyword") === keyword && query.get("sort") === sort;
      const total = filtered ? rows.length : 0;
      const ledger: SignedSettlementLedgerPage = {
        rows: filtered ? rows : [],
        meta: { page: 1, pageSize: 20, total, totalPages: filtered ? 1 : 0 },
        summary: {
          total, knownAmountRows: total, unknownAmountRows: 0, projectCount: filtered ? 1 : 0,
          totalAmountYuan: filtered ? "1234567890123431.2889" : null,
          latestConfirmedAt: filtered ? rows[1]!.confirmedAt : null
        },
        filters: { projectId: null, dateFrom: null, dateTo: null, status: null, keyword: query.get("keyword") },
        columns
      };
      return route.fulfill({ json: ledger });
    });
    await page.route(url => url.pathname === "/api/settlements/signed-ledger-export", route => route.fulfill({
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` },
      body: workbookResponse
    }));

    await page.goto("/结算台账");
    await expect(page.getByRole("heading", { name: "结算台账" })).toBeVisible();
    const search = page.getByPlaceholder("结算编号、合同或业务双方");
    await search.fill(keyword);
    await page.locator("label").filter({ hasText: "排序" }).locator(".t-select").click();
    await page.getByText("复核日期从早到晚", { exact: true }).click();
    const listRequest = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname === "/api/settlements/signed-ledger" && url.searchParams.has("keyword");
    });
    await page.getByRole("button", { name: "查询", exact: true }).click();
    const listQuery = new URL((await listRequest).url()).searchParams;
    expect(Object.fromEntries(listQuery)).toEqual({ keyword, sort, page: "1", pageSize: "20" });

    const offsetRow = page.getByRole("row").filter({ hasText: "JS-421-PRECISION-OFFSET" });
    await expect(offsetRow.getByText("已复核", { exact: true })).toBeVisible();
    const amount = offsetRow.getByText("¥-25.5001", { exact: true });
    await expect(amount).toBeVisible();
    await amount.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("confirmed-offset.png") });

    // An unsubmitted edit must not replace the filter whose rows are on screen.
    await search.fill("未提交的筛选");
    await page.getByRole("button", { name: "导出当前筛选" }).click();
    const preview = page.getByRole("region", { name: "导出预览" });
    await expect(preview.getByText(keyword, { exact: true })).toBeVisible();
    const [exportRequest, download] = await Promise.all([
      page.waitForRequest(request => new URL(request.url()).pathname === "/api/settlements/signed-ledger-export"),
      page.waitForEvent("download"),
      page.getByRole("button", { name: "按当前筛选与显示列导出", exact: true }).click()
    ]);
    const exportQuery = new URL(exportRequest.url()).searchParams;
    listQuery.delete("page");
    listQuery.delete("pageSize");
    expect(exportQuery.get("columns")?.split(",")).toContain("amountYuan");
    exportQuery.delete("columns");
    expect(Object.fromEntries(exportQuery)).toEqual(Object.fromEntries(listQuery));
    expect(download.suggestedFilename()).toBe(filename);
    expect(await download.failure()).toBeNull();
    const savedPath = testInfo.outputPath(filename);
    await download.saveAs(savedPath);
    expect(await readFile(savedPath)).toEqual(workbookResponse);
    expect(pageErrors).toEqual([]);
  });
}
