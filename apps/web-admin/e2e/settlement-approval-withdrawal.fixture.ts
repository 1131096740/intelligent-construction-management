import { expect, type Page, type Route } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const fixtureTimestamp = "2026-08-02T08:00:00.000Z";
const approvalTimestamp = "2026-08-02T08:05:00.000Z";

export const settlementWithdrawalCoordinates = Object.freeze({
  expectedSettlementUpdatedAt: fixtureTimestamp,
  expectedApprovalInstanceId: "approval-settlement-withdrawal-p0",
  expectedNodeIndex: 1,
  expectedApprovalUpdatedAt: approvalTimestamp
});

export type SettlementWithdrawalPostMode =
  | "success"
  | "known-409"
  | "network"
  | "parse"
  | "server-500";

export interface SettlementWithdrawalRecordInput {
  code: string;
  settlementId: string;
  title?: string;
  capability?: boolean;
  withdrawn?: boolean;
  holdPost?: boolean;
  postMode?: SettlementWithdrawalPostMode;
  completionReadFailures?: number;
}

interface SettlementWithdrawalRecordState {
  code: string;
  settlementId: string;
  title: string;
  capability: boolean;
  withdrawn: boolean;
  holdPost: boolean;
  postMode: SettlementWithdrawalPostMode;
  completionReadFailures: number;
  detailReadFailuresRemaining: number;
  postStarted: Deferred<void>;
  postRelease: Deferred<void>;
}

export interface SettlementWithdrawalRequestRecord {
  code: string;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

export interface SettlementWithdrawalApiFixture {
  requests: SettlementWithdrawalRequestRecord[];
  methods(code: string): Array<"GET" | "POST">;
  postBodies(code: string): Record<string, unknown>[];
  postStarted(code: string): Promise<void>;
  releasePost(code: string): void;
  setCapability(code: string, capability: boolean): void;
  setDetailReadFailures(code: string, count: number): void;
  state(code: string): Readonly<Pick<SettlementWithdrawalRecordState, "capability" | "withdrawn">>;
}

export interface SettlementWithdrawalSessionFixture {
  unexpectedApiRequests: string[];
}

export interface PageHealthFixture {
  consoleErrors: string[];
  pageErrors: string[];
}

type PlaywrightBrowserName = "chromium" | "firefox" | "webkit";

export async function installSettlementWithdrawalSession(
  page: Page
): Promise<SettlementWithdrawalSessionFixture> {
  const unexpectedApiRequests: string[] = [];

  await page.route("**/api/**", (route) => {
    unexpectedApiRequests.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}`
    );
    return fulfillJson(route, {
      code: "UNEXPECTED_E2E_API_REQUEST",
      message: "P0 fixture did not register this API request"
    }, 501);
  });
  await page.route("**/api/auth/login", (route) => fulfillJson(route, {
    user: {
      id: "settlement-withdrawal-applicant",
      name: "结算发起人",
      phone: "13900000000",
      mustChangePassword: false,
      roleKeys: ["contract_staff", "project_manager"],
      globalRoleKeys: ["contract_staff"]
    },
    tokens: {
      accessToken: "settlement-withdrawal-access",
      refreshToken: "settlement-withdrawal-refresh",
      expiresIn: 900
    }
  }));
  await page.route("**/api/me/work-items", (route) => fulfillJson(route, {
    generatedAt: fixtureTimestamp,
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
  await page.route("**/api/approval-delegations/user-options", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/projects", (route) => fulfillJson(route, [
    { id: "project-settlement-p0", code: "P0", name: "结算撤回 P0 项目" }
  ]));

  return { unexpectedApiRequests };
}

export async function installSettlementWithdrawalApi(
  page: Page,
  records: SettlementWithdrawalRecordInput[]
): Promise<SettlementWithdrawalApiFixture> {
  const states = new Map<string, SettlementWithdrawalRecordState>();
  const statesBySettlementId = new Map<string, SettlementWithdrawalRecordState>();
  const requests: SettlementWithdrawalRequestRecord[] = [];

  for (const record of records) {
    const state: SettlementWithdrawalRecordState = {
      code: record.code,
      settlementId: record.settlementId,
      title: record.title ?? `${record.code} · 结算撤回 P0`,
      capability: record.capability ?? true,
      withdrawn: record.withdrawn ?? false,
      holdPost: record.holdPost ?? false,
      postMode: record.postMode ?? "success",
      completionReadFailures: record.completionReadFailures ?? 0,
      detailReadFailuresRemaining: 0,
      postStarted: deferred<void>(),
      postRelease: deferred<void>()
    };
    states.set(state.code, state);
    statesBySettlementId.set(state.settlementId, state);
  }

  await page.route("**/api/settlements/**", async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    const segments = pathName.split("/").filter(Boolean).map(decodeURIComponent);
    const isWithdrawalPost =
      request.method() === "POST" &&
      segments.at(-1) === "approval-withdrawal";
    const key = isWithdrawalPost ? segments.at(-2) ?? "" : segments.at(-1) ?? "";
    const state = isWithdrawalPost
      ? statesBySettlementId.get(key)
      : states.get(key);

    if (!state) {
      return fulfillJson(route, {
        code: "UNKNOWN_SETTLEMENT_FIXTURE",
        message: `Unknown settlement fixture: ${key}`
      }, 404);
    }

    if (isWithdrawalPost) {
      const body = request.postDataJSON() as Record<string, unknown>;
      requests.push({
        code: state.code,
        method: "POST",
        path: pathName,
        body
      });
      state.postStarted.resolve();
      if (state.holdPost) await state.postRelease.promise;

      if (state.postMode === "known-409") {
        return fulfillJson(route, {
          code: "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT",
          message: "结算审批坐标已变化"
        }, 409);
      }
      if (state.postMode === "network") {
        await route.abort("failed");
        return;
      }
      if (state.postMode === "parse") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{\"id\":"
        });
        return;
      }
      if (state.postMode === "server-500") {
        return fulfillJson(route, {
          code: "SETTLEMENT_WITHDRAWAL_TEMPORARILY_UNAVAILABLE",
          message: "结算审批撤回服务暂时不可用"
        }, 503);
      }

      state.withdrawn = true;
      state.detailReadFailuresRemaining += state.completionReadFailures;
      return fulfillJson(route, {
        id: state.settlementId,
        status: "withdrawn"
      });
    }

    if (request.method() !== "GET") {
      return fulfillJson(route, {
        code: "UNEXPECTED_SETTLEMENT_METHOD",
        message: `Unexpected settlement method: ${request.method()}`
      }, 405);
    }

    requests.push({ code: state.code, method: "GET", path: pathName });
    if (state.detailReadFailuresRemaining > 0) {
      state.detailReadFailuresRemaining -= 1;
      return fulfillJson(route, {
        code: "SETTLEMENT_DETAIL_TEMPORARILY_UNAVAILABLE",
        message: "结算权威详情暂时不可用"
      }, 503);
    }
    return fulfillJson(route, settlementWithdrawalDetail(state));
  });

  function requiredState(code: string) {
    const state = states.get(code);
    if (!state) throw new Error(`Unknown settlement fixture: ${code}`);
    return state;
  }

  return {
    requests,
    methods: (code) => requests
      .filter((request) => request.code === code)
      .map((request) => request.method),
    postBodies: (code) => requests
      .filter((request) => request.code === code && request.method === "POST")
      .map((request) => request.body ?? {}),
    postStarted: (code) => requiredState(code).postStarted.promise,
    releasePost: (code) => requiredState(code).postRelease.resolve(),
    setCapability: (code, capability) => {
      requiredState(code).capability = capability;
    },
    setDetailReadFailures: (code, count) => {
      requiredState(code).detailReadFailuresRemaining = count;
    },
    state: (code) => {
      const state = requiredState(code);
      return { capability: state.capability, withdrawn: state.withdrawn };
    }
  };
}

export function settlementWithdrawalDetail(
  state: Pick<SettlementWithdrawalRecordState, "capability" | "code" | "settlementId" | "title" | "withdrawn">
) {
  const terminal = state.withdrawn;
  const capability = state.capability && !terminal;
  const lifecycleUpdatedAt = terminal
    ? "2026-08-02T08:10:00.000Z"
    : fixtureTimestamp;

  return {
    id: state.code,
    settlementId: state.settlementId,
    title: state.title,
    lifecycleUpdatedAt,
    meta: [
      {
        label: "当前状态",
        value: terminal ? "已撤回" : "审批中",
        tone: terminal ? "default" : "primary"
      },
      { label: "关联合同版本", value: "HT-P0 v1" },
      { label: "付款条款版本", value: "v1" },
      { label: "结算期间", value: "2026年8月" },
      { label: "责任部门", value: "合同部" },
      { label: "下一步动作", value: terminal ? "流程已结束" : "等待审批" }
    ],
    baseInfo: [
      { label: "结算编号", value: state.code },
      { label: "关联合同", value: "HT-P0 · 撤回门测试合同" },
      { label: "结算性质", value: "过程结算" },
      { label: "是否最终结算", value: "否" },
      { label: "结算金额", value: "¥120,000.00" },
      { label: "创建人", value: "结算发起人" }
    ],
    taxFactSummary: [],
    effectivenessSteps: [
      {
        label: "结算审批",
        status: terminal ? "已撤回" : "处理中",
        tone: terminal ? "default" : "primary"
      }
    ],
    archiveResponsibilities: [],
    paymentRules: [],
    settlementLines: [],
    payableCalculation: {
      items: [{ label: "本期结算金额", value: "¥120,000.00" }],
      note: "以后端权威结算事实为准。"
    },
    paymentBlockMessage: terminal
      ? "结算已撤回，不可创建付款申请。"
      : "结算尚未生效，不可创建付款申请。",
    archiveFiles: [],
    approvalTimeline: [],
    availableActions: capability
      ? [{
          key: "withdraw_approval",
          label: "撤回结算审批",
          kind: "danger",
          enabled: true,
          disabledReason: null
        }]
      : [],
    withdrawApprovalContext: capability
      ? { ...settlementWithdrawalCoordinates }
      : null,
    primaryAction: null,
    disabledReasons: [],
    chainLinks: []
  };
}

export async function loginSettlementWithdrawalUser(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Settlement@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

export function observePageHealth(page: Page): PageHealthFixture {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

export async function expectSettlementWithdrawalPageHealthy(
  page: Page,
  browserName: PlaywrightBrowserName,
  health: PageHealthFixture,
  unexpectedApiRequests: string[]
) {
  await expect(
    page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  expect(page.viewportSize()).toEqual(
    browserName === "webkit"
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 }
  );
  const userAgent = await page.evaluate(() => navigator.userAgent);
  if (browserName === "webkit") {
    expect(userAgent).not.toContain("Chrome/");
  } else {
    expect(userAgent).toContain("Chrome/");
  }
  expect(health.consoleErrors).toEqual([]);
  expect(health.pageErrors).toEqual([]);
  expect(unexpectedApiRequests).toEqual([]);
}

export async function openSettlementWithdrawalProcess(
  page: Page,
  code: string
) {
  await page.goto(`/结算管理/${encodeURIComponent(code)}`);
  await expect(page.getByText(code, { exact: false }).first()).toBeVisible();
  await page.getByText("流程办理", { exact: true }).click();
}

export function expectedSettlementWithdrawalBody() {
  return { ...settlementWithdrawalCoordinates };
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

type Deferred<T> = ReturnType<typeof deferred<T>>;
