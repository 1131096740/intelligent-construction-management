// Real Me HTTP and actual approval/account UI; only identity/persistence facts are synthetic.
import { chromium, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
if (process.cwd() !== root) throw new Error("Requires the isolated task15 worktree");
const fixture = JSON.parse(readFileSync(process.env.FUND_ACCOUNT_SYNTHETIC_RECEIPT ?? "/private/tmp/jg-task15-synthetic-server.json", "utf8"));
const output = resolve(process.env.FUND_ACCOUNT_BROWSER_OUTPUT ?? "apps/web-admin/test-results/task15-fund-work-items");
const base = process.env.FUND_ACCOUNT_BROWSER_BASE_URL ?? "http://127.0.0.1:61815";
if ([base, fixture.url].some(value => new URL(value).hostname !== "127.0.0.1") || !fixture.controlFile) throw new Error("Requires loopback synthetic role boundary");
mkdirSync(output, { recursive: true });
const results = [];
async function http(actor, path, body) {
  const response = await fetch(`${fixture.url}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${fixture.sessions[actor].accessToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Synthetic public HTTP ${path}: ${response.status}`);
  return response.json();
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  async function pageFor(actor, width) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    contexts.push(context);
    await context.addInitScript(session => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(session)), fixture.sessions[actor]);
    return context.newPage();
  }
  async function pendingView(page, count) {
    await page.goto(`${base}/${encodeURIComponent("审批中心")}`);
    await page.locator(".tab-bar").getByText(`待我审批 ${count}`, { exact: true }).click();
    await expect(page.locator(".approval-item")).toHaveCount(count);
  }
  try {
    writeFileSync(fixture.controlFile, "{}");
    const basis = { scopeKey: "company:company-b", balanceYuan: "100", asOfDate: "2026-11-06", evidenceReference: "真实Me合成核对依据", reconciliationNote: "只登记已核余额", reason: "Me独立基础", idempotencyKey: "me-ui-opening", sources: [{ amountYuan: "100", sourceStatus: "pending", projectStatus: "pending" }] };
    const opening = await http("finance", "/fund-accounts/openings", basis);
    const pending = await http("finance", "/fund-accounts/corrections", { ...basis, balanceYuan: "101", idempotencyKey: "me-ui-pending", previousRegistrationId: opening.id, sources: [{ amountYuan: "101", sourceStatus: "pending", projectStatus: "pending", previousSourceBatchId: opening.sources[0].id }] });
    await http("director", "/approval-delegations", { toUserId: "delegate", startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(), actionKey: "fund_account.balance.review", resourceType: "fund_account_balance_review_duty", resourceId: `${pending.approvalInstanceId}:0` });
    const pages = [];
    for (const [actor, width] of [["director", 1366], ["delegate", 390]]) {
      const page = await pageFor(actor, width); pages.push(page);
      await pendingView(page, 1);
      await expect(page.locator(".approval-item")).toContainText("乙公司余额核对更正");
      const summary = await http(actor, "/me/workbench-summary");
      expect(summary.cards.find(card => card.id === "approval_todo").count).toBe(1);
      await page.screenshot({ path: resolve(output, `me-pending-${actor}.png`), fullPage: true });
      await page.locator(".approval-item").click();
      await expect(page.getByText("本次余额核对复核", { exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toContain(encodeURIComponent("资金余额复核"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await http("finance", `/fund-accounts/registrations/${pending.id}/withdraw`, { expectedApprovalInstanceId: pending.approvalInstanceId, idempotencyKey: "me-ui-withdraw", reviewNote: "补正原核对依据", confirmationPassword: "Synthetic15Password!" });
    for (const page of pages) await pendingView(page, 0);
    expect((await http("finance", "/fund-accounts")).accounts.find(row => row.scopeKey === basis.scopeKey).balanceYuan).toBe("100.0000");
    results.push({ case: "director-and-exact-delegate-real-Me-UI-count-detail-and-withdraw-removal", passed: true, widths: [1366, 390] });

    writeFileSync(fixture.controlFile, JSON.stringify({ director: "employee", other_director: "employee" }));
    const waiting = await http("finance", "/fund-accounts/corrections", { ...basis, balanceYuan: "102", idempotencyKey: "me-ui-waiting", previousRegistrationId: opening.id, sources: [{ amountYuan: "102", sourceStatus: "pending", projectStatus: "pending", previousSourceBatchId: opening.sources[0].id }] });
    const finance = await pageFor("finance", 390);
    await finance.goto(`${base}/${encodeURIComponent("资金账户")}`);
    await finance.locator(".fund-accounts__tabs").getByText("流水与核对记录", { exact: true }).click();
    await expect(finance.getByText("财务主管待配置，保留原登记等待补岗复核", { exact: false })).toBeVisible();
    await finance.screenshot({ path: resolve(output, "missing-holder-pending-configuration.png"), fullPage: true });
    expect((await http("finance", "/fund-accounts")).accounts.find(row => row.scopeKey === basis.scopeKey).balanceYuan).toBe("100.0000");
    writeFileSync(fixture.controlFile, JSON.stringify({ director: "employee", other_director: "finance_director" }));
    const successor = await pageFor("other_director", 1366);
    await pendingView(successor, 1);
    const items = await http("other_director", "/me/work-items");
    expect(items.queues.pending[0].businessId).toBe(waiting.id);
    await successor.locator(".approval-item").click();
    await expect(successor.getByText("本次余额核对复核", { exact: true })).toBeVisible();
    await successor.getByRole("button", { name: "复核余额更正", exact: true }).click();
    const dialog = successor.locator(".t-dialog:visible");
    await dialog.locator('[aria-label="复核结论"] textarea').fill("补岗后本人核实原单与依据");
    await dialog.getByRole("button", { name: "确认复核", exact: true }).click();
    await expect(successor.getByText("本次已办理", { exact: false }).first()).toBeVisible();
    await pendingView(successor, 0);
    const final = await http("finance", "/fund-accounts");
    expect(final.accounts.find(row => row.scopeKey === basis.scopeKey).balanceYuan).toBe("102.0000");
    results.push({ case: "missing-holder-original-round-configured-successor-Me-real-UI-review", passed: true });
    writeFileSync(resolve(output, "browser-result.json"), JSON.stringify({ passed: true, results }, null, 2));
  } catch (error) {
    writeFileSync(resolve(output, "browser-result.json"), JSON.stringify({ passed: false, results, error: String(error) }, null, 2));
    throw error;
  } finally { for (const context of contexts) await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
