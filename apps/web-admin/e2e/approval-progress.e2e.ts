import { expect, test, type Page, type Route } from "@playwright/test";
import type { ApprovalProgress } from "../src/api/approval-progress.api";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

type ReminderRequest = { requestId: string; reminderToken: string };
type Outcome = { status: string; message: string };
type FixtureState = { flow: ApprovalProgress; requests: ReminderRequest[]; dispatchedRequests: string[]; errors: string[]; unexpected: string[] };
const accepted: Outcome = { status: "accepted", message: "短信已提交发送，送达以运营商结果为准" };

function recordDispatch(state: FixtureState, body: ReminderRequest, outcome = accepted) {
  if (state.flow.reminders.some(reminder => reminder.id === body.requestId)) return;
  state.dispatchedRequests.push(body.requestId);
  state.flow = {
    ...state.flow, canRemind: false, reminderUnavailableReason: "刚刚已催办，请稍后再试",
    reminders: [...state.flow.reminders, {
      id: body.requestId, actor: { id: "later", name: "项目经理" }, createdAt: "2026-10-27T02:00:00Z",
      recipients: state.flow.pendingRecipients, pending: false,
      results: state.flow.pendingRecipients.map(person => ({ userId: person.id, status: outcome.status, message: outcome.message }))
    }]
  };
}

async function setup(page: Page, onRemind: (route: Route, body: ReminderRequest, state: FixtureState) => Promise<void>, options: {
  configure?: (state: FixtureState) => void;
  list?: (route: Route, url: URL, state: FixtureState) => Promise<void>;
  openPanel?: boolean;
} = {}) {
  const person = { id: "first", name: "综合部主管" };
  const state: FixtureState = {
    requests: [], dispatchedRequests: [], errors: [], unexpected: [],
    flow: {
      id: "flow-1", businessType: "expense_claim", businessId: "claim-1", title: "费用审批", businessCode: "BX-LOCAL-001",
      projectName: "前卫街道本地虚构项目", applicant: { id: "owner", name: "张志娟" }, status: "in_progress", createdAt: "2026-10-27T01:00:00Z", currentNodeIndex: 0, currentNodeName: "综合部主管",
      nodes: [
        { name: "综合部主管", mode: "或签", status: "处理中", participants: [person], pending: [person], legacyRoster: false },
        { name: "项目经理", mode: "或签", status: "未开始", participants: [{ id: "later", name: "项目经理" }], pending: [], legacyRoster: false },
        { name: "财务主管", mode: "会签", status: "未开始", participants: [{ id: "finance", name: "财务主管" }], pending: [], legacyRoster: false }
      ],
      pendingRecipients: [person], reminderToken: "a".repeat(64), canRemind: true, reminderUnavailableReason: null, nextRemindAt: null, history: [], reminders: []
    }
  };
  options.configure?.(state);
  page.on("pageerror", error => state.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "local-test", refreshToken: "local-test", user: { id: "later", name: "项目经理", phone: "13800000003", mustChangePassword: false, roleKeys: ["project_manager"], globalRoleKeys: [] }
  })));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === `/api/approval-progress/${state.flow.id}/remind`) {
      const body = route.request().postDataJSON() as ReminderRequest;
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.reminderToken).toMatch(/^[a-f0-9]{64}$/);
      state.requests.push(body);
      return onRemind(route, body, state);
    }
    if (url.pathname === "/api/approval-progress") return options.list ? options.list(route, url, state) : route.fulfill({ json: { items: [state.flow], nextCursor: null } });
    if (pathname === `/api/approval-progress/${state.flow.id}`) return route.fulfill({ json: state.flow });
    if (url.pathname === "/api/me/work-items") return route.fulfill({ json: { generatedAt: "2026-10-27T01:00:00Z", visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [], drafts: [] }, queueMeta: {}, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } } });
    if (url.pathname === "/api/projects") return route.fulfill({ json: [{ id: "project", code: "LOCAL", name: "虚构项目" }] });
    state.unexpected.push(url.pathname);
    return route.fulfill({ status: 404, json: { message: "未配置的本地测试请求" } });
  });
  await page.goto("/审批中心");
  await expect(page.getByRole("heading", { name: "审批中心", exact: true })).toBeVisible();
  if (options.openPanel !== false) await page.getByRole("button", { name: "查看完整进度与短信催办" }).click();
  return state;
}

async function confirmReminder(page: Page, recipient = "综合部主管") {
  await page.getByRole("region", { name: "完整审批进度" }).getByRole("button", { name: "短信催办", exact: true }).click();
  await expect(page.getByText(`向${recipient}发送审批催办短信？`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发送短信", exact: true }).click();
  await expect(page.getByText(`向${recipient}发送审批催办短信？`, { exact: true })).not.toBeVisible();
}

for (const outcome of [accepted, { status: "failed", message: "短信发送失败" }, { status: "unknown", message: "短信发送结果待确认，请勿重复发送" }]) {
  test(`后续审批人查看完整进度并核对短信催办结果：${outcome.status}`, async ({ page }, testInfo) => {
    const state = await setup(page, async (route, body, current) => {
      expect(body.reminderToken).toBe(current.flow.reminderToken);
      recordDispatch(current, body, outcome);
      await route.fulfill({ json: current.flow });
    });
    const panel = page.getByRole("region", { name: "完整审批进度" });
    await expect(panel.getByText("2. 项目经理 · 未开始", { exact: true })).toBeVisible();
    await expect(panel.getByText("3. 财务主管 · 未开始", { exact: true })).toBeVisible();
    await confirmReminder(page);
    await expect(panel.getByText(`综合部主管：${outcome.message}`)).toBeVisible();
    await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeDisabled();
    await panel.getByRole("button", { name: "刷新进度" }).click();
    await expect(panel.getByText(`综合部主管：${outcome.message}`)).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("approval-progress.png"), fullPage: true });
    expect(state.dispatchedRequests).toHaveLength(1);
    expect(state.errors).toEqual([]);
    expect(state.unexpected).toEqual([]);
  });
}

test("确认前待审批人变化时拒绝旧接收人快照，刷新后重新确认", async ({ page }) => {
  const state = await setup(page, async (route, body, current) => {
    if (body.reminderToken !== current.flow.reminderToken) {
      await route.fulfill({ status: 409, json: { message: "审批节点或待审批人已变化，请刷新后重新确认催办" } });
      return;
    }
    recordDispatch(current, body);
    await route.fulfill({ json: current.flow });
  });
  const panel = page.getByRole("region", { name: "完整审批进度" });
  await expect(panel.getByText("当前：综合部主管", { exact: true })).toBeVisible();
  const later = { id: "later", name: "项目经理" };
  state.flow = { ...state.flow, reminderToken: "b".repeat(64), currentNodeIndex: 1, currentNodeName: "项目经理", pendingRecipients: [later], nodes: state.flow.nodes.map((node, index) => ({ ...node, status: index === 0 ? "已通过" : index === 1 ? "处理中" : "未开始", pending: index === 1 ? [later] : [] })) };
  await confirmReminder(page);
  await expect(panel.getByText("审批节点或待审批人已变化，请刷新后重新确认催办")).toBeVisible();
  expect(state.dispatchedRequests).toHaveLength(0);
  expect(state.requests[0].reminderToken).toBe("a".repeat(64));
  await panel.getByRole("button", { name: "刷新进度" }).click();
  await expect(panel.getByText("当前：项目经理", { exact: true })).toBeVisible();
  await confirmReminder(page, "项目经理");
  await expect(panel.getByText(`项目经理：${accepted.message}`)).toBeVisible();
  expect(state.requests[1].reminderToken).toBe("b".repeat(64));
  expect(state.dispatchedRequests).toHaveLength(1);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("发送响应丢失后刷新确认记录，冷却结束的新催办生成新请求", async ({ page }) => {
  const state = await setup(page, async (route, body, current) => {
    recordDispatch(current, body);
    if (current.requests.length === 1) await route.abort("failed");
    else await route.fulfill({ json: current.flow });
  });
  const panel = page.getByRole("region", { name: "完整审批进度" });
  await confirmReminder(page);
  await expect(panel.locator(".t-alert")).toBeVisible();
  expect(state.dispatchedRequests).toHaveLength(1);
  await panel.getByRole("button", { name: "刷新进度" }).click();
  await expect(panel.getByText(`综合部主管：${accepted.message}`)).toBeVisible();
  await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeDisabled();
  // The mocked server advances past its shared cooldown; no browser wall-clock wait or real SMS.
  state.flow = { ...state.flow, canRemind: true, reminderUnavailableReason: null, nextRemindAt: null };
  await panel.getByRole("button", { name: "刷新进度" }).click();
  await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeEnabled();
  await confirmReminder(page);
  await expect(panel.getByText(`综合部主管：${accepted.message}`)).toHaveCount(2);
  expect(state.requests[1].requestId).not.toBe(state.requests[0].requestId);
  expect(state.dispatchedRequests).toHaveLength(2);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("网络失败且刷新未发现记录时，重试保留原请求和接收人版本", async ({ page }) => {
  const state = await setup(page, async (route, body, current) => {
    if (current.requests.length === 1) { await route.abort("failed"); return; }
    recordDispatch(current, body);
    await route.fulfill({ json: current.flow });
  });
  const panel = page.getByRole("region", { name: "完整审批进度" });
  await confirmReminder(page);
  await expect(panel.locator(".t-alert")).toBeVisible();
  await panel.getByRole("button", { name: "刷新进度" }).click();
  await expect(panel.getByText("当前：综合部主管", { exact: true })).toBeVisible();
  await confirmReminder(page);
  await expect(panel.getByText(`综合部主管：${accepted.message}`)).toBeVisible();
  expect(state.requests[1]).toEqual(state.requests[0]);
  expect(state.dispatchedRequests).toHaveLength(1);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("跨越空授权页找到独立审核，加载更多和列表刷新保持完整进度", async ({ page }) => {
  const cursors: Array<string | null> = [];
  const state = await setup(page, async (route, body, current) => {
    expect(body.reminderToken).toBe(current.flow.reminderToken);
    recordDispatch(current, body);
    await route.fulfill({ json: current.flow });
  }, {
    configure(current) {
      const reviewer = { id: "seal-reviewer", name: "综合部主管" };
      current.flow = {
        ...current.flow, id: "independent:contract_seal:seal-one", businessType: "contract_seal", businessId: "seal-one", title: "用章审批", businessCode: "HT-LOCAL-001",
        currentNodeName: "用章审批", pendingRecipients: [reviewer], nodes: [{ name: "用章审批", mode: "或签", status: "处理中", participants: [reviewer], pending: [reviewer], legacyRoster: false }]
      };
    },
    async list(route, url, current) {
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      if (cursor === null) { await route.fulfill({ json: { items: [], nextCursor: "scan-one" } }); return; }
      if (cursor === "scan-one") { await route.fulfill({ json: { items: [], nextCursor: "scan-two" } }); return; }
      if (cursor === "scan-two") { await route.fulfill({ json: { items: [current.flow], nextCursor: "scan-three" } }); return; }
      if (cursor === "scan-three") { await route.fulfill({ json: { items: [], nextCursor: "scan-four" } }); return; }
      expect(cursor).toBe("scan-four");
      await route.fulfill({ json: { items: [{ ...current.flow, id: "independent:receipt_review:receipt-two", businessType: "receipt_review", businessId: "receipt-two", title: "收货复核", businessCode: "SH-LOCAL-002", currentNodeName: "收货复核" }], nextCursor: null } });
    },
    openPanel: false
  });
  await expect(page.getByRole("button", { name: "查看完整进度与短信催办" })).toBeVisible();
  expect(cursors).toEqual([null, "scan-one", "scan-two"]);
  await expect(page.getByText("暂无与你相关的审批流程。", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看完整进度与短信催办" }).click();
  const panel = page.getByRole("region", { name: "完整审批进度" });
  await expect(panel.getByText("1. 用章审批 · 处理中", { exact: true })).toBeVisible();
  await confirmReminder(page);
  await expect(panel.getByText(`综合部主管：${accepted.message}`)).toBeVisible();
  expect(state.dispatchedRequests).toHaveLength(1);
  state.flow = { ...state.flow, status: "approved", reminderToken: "b".repeat(64), currentNodeName: "流程已结束", pendingRecipients: [], reminderUnavailableReason: "流程已结束", nodes: state.flow.nodes.map(node => ({ ...node, status: "已通过", pending: [] })) };
  await page.getByRole("button", { name: "刷新相关流程" }).click();
  await expect(panel.getByText("当前：流程已结束", { exact: true })).toBeVisible();
  await expect(panel.getByText("1. 用章审批 · 已通过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "加载更多流程" }).click();
  await expect(page.getByText("收货复核 · SH-LOCAL-002", { exact: true })).toBeVisible();
  expect(cursors).toEqual([null, "scan-one", "scan-two", null, "scan-one", "scan-two", "scan-three", "scan-four"]);
  await expect(page.getByRole("button", { name: "加载更多流程" })).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/independent:|contract_seal|receipt_review/);
  await expectNoDocumentHorizontalOverflow(page);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("离开相关流程页后中止未完成的分页请求", async ({ page }) => {
  const cursors: Array<string | null> = [];
  let release!: () => void;
  let arrived!: () => void;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  const requestArrived = new Promise<void>(resolve => { arrived = resolve; });
  await setup(page, async route => { await route.fulfill({ status: 500 }); }, {
    openPanel: false,
    async list(route, url) {
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      if (cursor === null) { await route.fulfill({ json: { items: [], nextCursor: "waiting-page" } }); return; }
      arrived();
      await responseGate;
      try { await route.fulfill({ json: { items: [], nextCursor: "must-not-request" } }); }
      catch { /* The browser deliberately aborted this request when the component unmounted. */ }
    }
  });
  try {
    await requestArrived;
    const aborted = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).searchParams.get("cursor") === "waiting-page" });
    await page.getByText("待我审批 0", { exact: true }).click();
    release();
    await aborted;
    await expect(page.getByText("当前没有需要你处理的审批节点。", { exact: true })).toBeVisible();
    expect(cursors).toEqual([null, "waiting-page"]);
  } finally { release(); }
});

test("不确定发送直接重试时先回读已记录请求，不重复发送", async ({ page }) => {
  const state = await setup(page, async (route, body, current) => {
    recordDispatch(current, body);
    await route.abort("failed");
  });
  const panel = page.getByRole("region", { name: "完整审批进度" });
  await confirmReminder(page);
  await expect(panel.locator(".t-alert")).toBeVisible();
  await confirmReminder(page);
  await expect(panel.getByText(`综合部主管：${accepted.message}`)).toBeVisible();
  await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeDisabled();
  expect(state.requests).toHaveLength(1);
  expect(state.dispatchedRequests).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("能力预检处于冷却但找不到原请求时仍保留旧键和接收人版本", async ({ page }) => {
  const state = await setup(page, async (route, body, current) => {
    if (current.requests.length === 1) {
      current.flow = { ...current.flow, canRemind: false, reminderUnavailableReason: "刚刚已催办，请稍后再试" };
      await route.abort("failed");
      return;
    }
    recordDispatch(current, body);
    await route.fulfill({ json: current.flow });
  });
  const panel = page.getByRole("region", { name: "完整审批进度" });
  await confirmReminder(page);
  await expect(panel.locator(".t-alert")).toBeVisible();
  await confirmReminder(page);
  await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeDisabled();
  expect(state.requests).toHaveLength(1);
  state.flow = { ...state.flow, canRemind: true, reminderUnavailableReason: null };
  await panel.getByRole("button", { name: "刷新进度" }).click();
  await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeEnabled();
  await confirmReminder(page);
  await expect(panel.getByText(`综合部主管：${accepted.message}`)).toBeVisible();
  expect(state.requests[1]).toEqual(state.requests[0]);
  expect(state.dispatchedRequests).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
