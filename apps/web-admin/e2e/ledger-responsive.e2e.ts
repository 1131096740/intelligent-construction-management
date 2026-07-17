import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

const workItem = {
  id: "approval-responsive",
  type: "approval",
  title: "科技园项目付款审批",
  projectName: "科技园项目",
  businessCode: "FK-2026-018",
  amountText: "¥120,000.00",
  currentNode: "财务主管审批",
  stayedText: "停留 2 天",
  nextAction: "前往审批",
  targetPath: "/付款管理/payment-responsive",
  tone: "warning"
};

async function mockSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "super-admin-responsive",
        name: "系统管理员",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["super_admin"],
        globalRoleKeys: ["super_admin"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-14T08:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [workItem],
        startedByMe: [workItem],
        handledByMe: [],
        delegatedToMe: [],
        overdueReminder: []
      }
    })
  }));
  await page.route("**/api/archives", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [{
        id: "archive-responsive",
        documentNo: "GD-2026-018",
        fileId: "file-responsive",
        documentType: "合同归档件",
        businessRef: "HT-2026-018",
        project: "科技园项目",
        fileSource: "签署扫描件.pdf",
        fileSizeBytes: 1024,
        canDownload: true,
        disabledReason: null,
        archiveStatus: "已确认",
        statusTone: "success",
        uploadDepartment: "合同部",
        confirmedBy: "合同主管",
        lastAction: "2026-07-14 16:00"
      }],
      summary: { total: 1, contractArchives: 1, settlementArchives: 0, paymentFiles: 0, pending: 0 }
    })
  }));
  await page.route("**/api/audit-logs", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [{
        id: "audit-responsive",
        occurredAt: "2026-07-14 16:00",
        actor: "合同主管",
        action: "归档确认",
        actionTone: "success",
        businessType: "合同",
        businessTarget: "HT-2026-018",
        ipAddress: "10.0.0.18",
        resultRisk: "成功",
        riskTone: "success",
        trace: "TRACE-RESPONSIVE"
      }],
      summary: { total: 1, login: 0, approval: 0, file: 1, security: 0 }
    })
  }));
  await page.route("**/api/audit-logs/file-downloads", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [{
        id: "download-responsive",
        occurredAt: "2026-07-14 16:10",
        actor: "合同主管",
        action: "文件下载",
        actionKey: "file.download",
        fileId: "file-responsive",
        fileName: "签署扫描件.pdf",
        businessType: "合同",
        businessTarget: "HT-2026-018",
        downloadReason: "归档复核",
        ipAddress: "10.0.0.18",
        traceId: "TRACE-DOWNLOAD",
        sensitive: "下载地址已脱敏"
      }],
      summary: { total: 1, ticket: 0, downloaded: 1, missingReason: 0 }
    })
  }));
  await page.route("**/api/approval-delegations", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      id: "delegation-responsive",
      fromUserId: "super-admin-responsive",
      fromUserName: "系统管理员",
      toUserId: "finance-responsive",
      toUserName: "财务主管",
      startsAt: "2026-07-14T00:00:00.000Z",
      endsAt: "2026-07-21T00:00:00.000Z",
      enabled: true
    }])
  }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "finance-responsive", name: "财务主管" }])
  }));
  await page.route("**/api/contracts", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [{
      id: "contract-responsive",
      contractNo: "HT-2026-018",
      name: "科技园材料采购合同",
      project: "科技园项目",
      counterparty: "城建物资公司",
      amount: "¥1,200,000.00",
      version: "V1",
      currentNode: "履约中",
      nodeTone: "success",
      ownerDepartment: "合同部",
      pendingOwner: "合同主管",
      stalledFor: "1 天",
      returnReason: "—",
      nextAction: "查看详情",
      updatedAt: "2026-07-14 16:00"
    }], summary: { total: 1, inApproval: 0, pendingSeal: 0, pendingArchive: 0, effective: 1 } })
  }));
  await page.route("**/api/settlements", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [], summary: { total: 0, inApproval: 0, pendingArchive: 0, effective: 0, payable: 0 } })
  }));
  await page.route("**/api/payments", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [], summary: { total: 0, pendingApproval: 0, orSign: 0, pendingPayment: 0, paid: 0 } })
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

test("五类业务台账在六档桌面窗口中只由数据区横向滚动", async ({ page }, testInfo) => {
  await mockSession(page);
  await login(page);
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  const ledgers = [
    { path: "/审批中心", heading: "审批中心", slug: "approval-center", table: false },
    { path: "/资料库", heading: "资料库", slug: "archives", table: true },
    { path: "/审计日志", heading: "审计日志", slug: "audit", table: true },
    { path: "/委托台账", heading: "审批委托台账", slug: "delegations", table: true },
    { path: "/全局搜索", heading: "全局搜索", slug: "global-search", table: true }
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const ledger of ledgers) {
      await page.goto(ledger.path);
      await expect(page.getByRole("heading", { name: ledger.heading })).toBeVisible();
      await expectNoDocumentHorizontalOverflow(page);
      await expectNoNestedHorizontalScrollers(page);
      if (ledger.table && viewport.width <= 1280) {
        await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content").first());
      }
      await page.screenshot({
        path: path.join(screenshotDir, `${ledger.slug}-${viewport.width}x${viewport.height}.png`),
        fullPage: true
      });
    }
  }
});
