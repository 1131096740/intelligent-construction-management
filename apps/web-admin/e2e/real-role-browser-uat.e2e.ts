import { expect, test, type Page } from "@playwright/test";

type RoleCase = {
  key: string;
  phone: string;
  name: string;
  routes: string[];
};

const initialPassword = process.env.REAL_ROLE_PASSWORD;
const evidencePath = process.env.REAL_BROWSER_EVIDENCE_PATH;

const roleCases: RoleCase[] = [
  {
    key: "contract_staff",
    phone: "13800000001",
    name: "合同经办",
    routes: ["/合同工作台", "/历史合同接管", "/结算工作台", "/付款工作台"]
  },
  {
    key: "contract_director",
    phone: "13800001004",
    name: "合同主管",
    routes: ["/合同工作台", "/历史合同接管", "/结算工作台", "/审计日志"]
  },
  {
    key: "project_manager",
    phone: "13800001003",
    name: "项目经理",
    routes: ["/首页", "/项目经营", "/合同工作台", "/结算工作台"]
  },
  {
    key: "finance_staff",
    phone: "13800000002",
    name: "财务经办",
    routes: ["/首页", "/结算工作台", "/付款工作台", "/统一资金办理工作台", "/审计日志"]
  },
  {
    key: "chairman",
    phone: "13800001001",
    name: "董事长",
    routes: ["/首页", "/审批中心", "/付款工作台", "/审计日志"]
  }
];

type RequestLedgerEntry = {
  role: string;
  method: string;
  path: string;
  status: number;
};

const ledger: RequestLedgerEntry[] = [];
const browserErrors: string[] = [];
const failedRequests: string[] = [];
const testFailures: string[] = [];

function assertRuntimeConfiguration() {
  expect(initialPassword, "REAL_ROLE_PASSWORD 必须由隔离 UAT runner 注入").toBeTruthy();
  expect(evidencePath, "REAL_BROWSER_EVIDENCE_PATH 必须由隔离 UAT runner 注入").toBeTruthy();
}

function normalizedPath(url: string) {
  return decodeURI(new URL(url).pathname);
}

async function captureApiResponses(page: Page, role: string) {
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    ledger.push({ role, method: response.request().method(), path: url.pathname, status: response.status() });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 403 \(Forbidden\)/u.test(message.text())) {
      browserErrors.push(`${role}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserErrors.push(`${role}: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "failed";
    if (request.url().includes("/api/") && !/ERR_ABORTED|cancelled/u.test(errorText)) {
      failedRequests.push(`${role}: ${request.method()} ${request.url()} ${errorText}`);
    }
  });
}

async function login(page: Page, account: RoleCase) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(account.phone);
  await page.getByPlaceholder("请输入密码").fill(initialPassword!);
  await page.getByRole("button", { name: "登录" }).click();
  await expect.poll(() => normalizedPath(page.url())).toMatch(/^\/(?:首页|change-password)$/u);
  if (normalizedPath(page.url()) === "/change-password") {
    throw new Error(`${account.key} 仍要求首次改密；核心 UAT 应先完成岗位改密`);
  }
  await expect(page.getByText("建工智管").first()).toBeVisible();
}

async function rawRequest(page: Page, role: string, method: string, path: string, body?: unknown) {
  const auth = await page.evaluate(() => {
    const raw = window.localStorage.getItem("jiangkong-web-admin-auth");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { accessToken?: string };
    } catch {
      return null;
    }
  });
  const response = await page.request.fetch(`/api${path}`, {
    method,
    headers: {
      ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    data: body
  });
  ledger.push({ role, method, path: `/api${path}`, status: response.status() });
  return response;
}

test.describe("RC-06 real API-backed four-role browser acceptance", () => {
  test.beforeAll(() => assertRuntimeConfiguration());
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      testFailures.push(`${testInfo.project.name}:${testInfo.title}:${testInfo.status}`);
    }
  });

  test("all required roles can authenticate and use their core read workbenches", async ({ browser }, testInfo) => {
    const viewport = testInfo.project.name.includes("webkit")
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 };
    for (const account of roleCases) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await captureApiResponses(page, account.key);
      await login(page, account);

      for (const route of account.routes) {
        const ledgerStart = ledger.length;
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(800);
        expect(normalizedPath(page.url()), `${account.key} 被错误重定向：${route}`).toBe(route);
        const routeResponses = ledger.slice(ledgerStart).filter((entry) => entry.role === account.key);
        expect(
          routeResponses.some((entry) => entry.status >= 200 && entry.status < 300),
          `${account.key} ${route} 未产生成功 API 响应`
        ).toBeTruthy();
        expect(
          routeResponses.some((entry) => entry.status >= 500 || entry.status === 404),
          `${account.key} ${route} 产生 404/5xx API 响应`
        ).toBeFalsy();
      }

      await context.close();
    }
  });

  test("records stable 400, 403 and 409 negative API paths without leaking server errors", async ({ browser }, testInfo) => {
    const viewport = testInfo.project.name.includes("webkit")
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 };
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await captureApiResponses(page, "negative");
    await login(page, roleCases[0]);

    const invalidContract = await rawRequest(page, "contract_staff", "POST", "/auth/change-password", {});
    expect(invalidContract.status()).toBe(400);

    await page.goto("/首页", { waitUntil: "domcontentloaded" });
    const forbiddenOrganizationWrite = await rawRequest(page, "contract_staff", "POST", "/organization/users", {});
    expect(forbiddenOrganizationWrite.status()).toBe(403);

    const contractLedgerResponse = await rawRequest(page, "contract_staff", "GET", "/contracts");
    expect(contractLedgerResponse.ok()).toBeTruthy();
    const contractLedger = (await contractLedgerResponse.json()) as { rows?: Array<Record<string, unknown>> };
    let versionId: string | undefined;
    let projectId: string | undefined;
    let settlementTemplateVersionId: string | undefined;
    for (const row of contractLedger.rows ?? []) {
      const contractId = row.contractId ?? row.id;
      if (typeof contractId !== "string") continue;
      const contractDetailResponse = await rawRequest(
        page,
        "contract_staff",
        "GET",
        `/contracts/${encodeURIComponent(contractId)}`
      );
      if (!contractDetailResponse.ok()) continue;
      const contractDetail = (await contractDetailResponse.json()) as {
        contractVersionId?: unknown;
        settlementBlockMessage?: unknown;
      };
      if (
        typeof contractDetail.contractVersionId === "string" &&
        typeof contractDetail.settlementBlockMessage === "string" &&
        contractDetail.settlementBlockMessage.includes("可基于当前合同版本创建结算")
      ) {
        const sourceLinesResponse = await rawRequest(
          page,
          "contract_staff",
          "GET",
          `/settlement-workbench/contract-versions/${encodeURIComponent(contractDetail.contractVersionId)}/source-lines`
        );
        if (!sourceLinesResponse.ok()) continue;
        const sourceLines = (await sourceLinesResponse.json()) as { projectId?: unknown };
        if (typeof sourceLines.projectId !== "string") continue;
        const recommendationsResponse = await rawRequest(
          page,
          "contract_staff",
          "GET",
          `/settlement-workbench/projects/${encodeURIComponent(sourceLines.projectId)}/contract-versions/${encodeURIComponent(contractDetail.contractVersionId)}/template-recommendations`
        );
        if (!recommendationsResponse.ok()) continue;
        const recommendations = (await recommendationsResponse.json()) as {
          selected?: { templateVersionId?: unknown } | null;
          choices?: Array<{ templateVersionId?: unknown }>;
        };
        const selectedTemplate = recommendations.selected?.templateVersionId ?? recommendations.choices?.[0]?.templateVersionId;
        if (typeof selectedTemplate !== "string") continue;
        versionId = contractDetail.contractVersionId;
        projectId = sourceLines.projectId;
        settlementTemplateVersionId = selectedTemplate;
        break;
      }
    }
    expect(typeof versionId).toBe("string");
    expect(typeof projectId).toBe("string");
    expect(typeof settlementTemplateVersionId).toBe("string");

    const createdSettlement = await rawRequest(page, "contract_staff", "POST", "/settlements", {
      contractVersionId: String(versionId),
      settlementTemplateVersionId: String(settlementTemplateVersionId),
      code: `RC06-${Date.now()}`,
      periodLabel: "2026-08",
      amountCents: "1",
      settlementLines: [{
        sourceType: "manual_adjustment",
        name: "RC06 并发幂等探针",
        amountCents: "1",
        reason: "隔离浏览器门禁测试"
      }]
    });
    const settlementBodyText = await createdSettlement.text();
    expect(
      createdSettlement.ok(),
      `创建隔离结算失败：HTTP ${createdSettlement.status()} ${settlementBodyText.slice(0, 300)}`
    ).toBeTruthy();
    const settlementData = JSON.parse(settlementBodyText) as { id?: string; settlementId?: string; settlement?: { id?: string } };
    const settlementId = settlementData.id ?? settlementData.settlementId ?? settlementData.settlement?.id;
    expect(typeof settlementId).toBe("string");

    const directorContext = await browser.newContext({ viewport });
    const directorPage = await directorContext.newPage();
    await captureApiResponses(directorPage, "contract_director");
    await login(directorPage, roleCases[1]);
    const [firstApproval, duplicateApproval] = await Promise.all([
      rawRequest(directorPage, "contract_director", "POST", `/settlements/${encodeURIComponent(String(settlementId))}/approval`, { decision: "approve" }),
      rawRequest(directorPage, "contract_director", "POST", `/settlements/${encodeURIComponent(String(settlementId))}/approval`, { decision: "approve" })
    ]);
    const approvalStatuses = [firstApproval.status(), duplicateApproval.status()];
    expect(approvalStatuses).toContain(409);
    expect(approvalStatuses.filter((status) => status === 200 || status === 201)).toHaveLength(1);

    await directorContext.close();
    await context.close();
  });

  test.afterAll(async ({}, testInfo) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const configuredOutput = path.resolve(evidencePath!);
    const output = configuredOutput.endsWith(".json")
      ? configuredOutput.replace(/\.json$/u, `-${testInfo.project.name}.json`)
      : path.join(configuredOutput, `${testInfo.project.name}.json`);
    const statusCounts = ledger.reduce<Record<string, number>>((counts, entry) => {
      counts[String(entry.status)] = (counts[String(entry.status)] ?? 0) + 1;
      return counts;
    }, {});
    const badStatuses = ledger.filter((entry) => entry.status >= 500 || entry.status === 404);
    const evidence = {
      schemaVersion: 1,
      gate: "rc06-real-api-backed-browser",
      status: badStatuses.length === 0 && browserErrors.length === 0 && failedRequests.length === 0 && testFailures.length === 0 ? "passed" : "failed",
      candidateSha: process.env.REAL_BROWSER_CANDIDATE_SHA ?? null,
      browsers: [testInfo.project.name],
      roles: roleCases.map(({ key, routes }) => ({ key, routes })),
      requestStatusCounts: statusCounts,
      requestLedger: ledger,
      browserErrors,
      failedRequests,
      testFailures
    };
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await fs.chmod(output, 0o600);
  });
});
