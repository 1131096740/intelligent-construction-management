import {
  expect,
  test,
  type Locator,
  type Page,
  type Route
} from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const PROJECT_A = {
  id: "project-financing-a",
  code: "P-A",
  name: "第一项目"
};
const PROJECT_B = {
  id: "project-financing-b",
  code: "P-B",
  name: "第二项目"
};
const PROJECTS = [PROJECT_A, PROJECT_B] as const;
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TERMINATED_TOKEN = "c".repeat(64);
const TERMINATION_REASON_INPUT = "  项目已不再需要新增垫资占用  ";
const TERMINATION_REASON = "项目已不再需要新增垫资占用";
const TERMINATION_PASSWORD_INPUT = "  LocalOnly@2026  ";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TERMINATION_BODY_KEYS = [
  "actionId",
  "confirmationPassword",
  "expectedLifecycleToken",
  "reason"
] as const;

interface MockReply {
  status?: number;
  body: unknown;
}

interface MockRequestContext {
  projectId: string;
  quotaId: string;
  ordinal: number;
  rawBody: string;
  body: Record<string, unknown>;
  probe: MockApiProbe;
}

interface MockApiOptions {
  capability?: (
    context: MockRequestContext
  ) => MockReply | Promise<MockReply>;
  termination?: (
    context: MockRequestContext
  ) => MockReply | Promise<MockReply>;
  workbench?: (
    context: MockRequestContext
  ) => MockReply | Promise<MockReply>;
}

interface MockApiProbe {
  criticalOrder: string[];
  capabilityGets: number;
  terminationPosts: number;
  terminationRawBodies: string[];
  terminationBodies: Array<Record<string, unknown>>;
  workbenchGets: Map<string, number>;
  terminatedProjects: Set<string>;
  unhandled: string[];
}

test("fresh capability 后开窗，双击只发送一次终止 POST，成功后读取权威台账且桌面/移动无横溢", async ({
  page
}, testInfo) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const probe = await installProjectFinancingQuotaMock(page);

  await loginAndOpenOperations(page);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);

  const dialog = await openTerminationDialog(page);
  await fillTermination(dialog);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  const confirm = dialog.getByRole("button", {
    name: "确认终止",
    exact: true
  });
  await confirm.dblclick();

  await expect(
    page.getByText("垫资额度已终止新占用", { exact: false })
  ).toBeVisible();
  await expect(page.getByText("已终止", { exact: true }).first()).toBeVisible();

  const terminationPosts = probe.terminationPosts;
  const authoritativeWorkbenchGets =
    (probe.workbenchGets.get(PROJECT_A.id) ?? 0) - 1;
  expect(terminationPosts).toBe(1);
  expect(probe.capabilityGets).toBe(2);
  expect(authoritativeWorkbenchGets).toBe(1);
  const terminationBody = probe.terminationBodies[0]!;
  expect(Object.keys(terminationBody).sort()).toEqual([
    ...TERMINATION_BODY_KEYS
  ]);
  expect(terminationBody).toEqual({
    actionId: expect.stringMatching(UUID_V4_PATTERN),
    confirmationPassword: TERMINATION_PASSWORD_INPUT,
    expectedLifecycleToken: TOKEN_A,
    reason: TERMINATION_REASON
  });
  expect(probe.terminationRawBodies[0]).toBe(
    JSON.stringify({
      reason: TERMINATION_REASON,
      confirmationPassword: TERMINATION_PASSWORD_INPUT,
      actionId: terminationBody.actionId,
      expectedLifecycleToken: TOKEN_A
    })
  );
  expect(probe.criticalOrder).toEqual([
    `workbench:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `termination:${PROJECT_A.id}`,
    `workbench:${PROJECT_A.id}`
  ]);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: testInfo.outputPath(
      "project-financing-quota-termination-success.png"
    ),
    fullPage: false
  });
  await expectCleanRuntime(page, runtimeErrors, probe);
});

test("网络结果未知时使用完全相同的 actionId 和 body 重试", async ({
  page
}) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const probe = await installProjectFinancingQuotaMock(page, {
    termination: ({ projectId, quotaId, ordinal, body }) =>
      ordinal === 1
        ? jsonReply(
            {
              code: "PROJECT_FINANCING_QUOTA_TERMINATION_OUTCOME_UNKNOWN",
              message: "终止结果未知，请使用原操作键重试"
            },
            503
          )
        : jsonReply({
            kind: "applied",
            actionId: body.actionId,
            projectId,
            quotaId
          })
  });

  await loginAndOpenOperations(page);
  const dialog = await openTerminationDialog(page);
  await fillTermination(dialog);
  const confirm = dialog.getByRole("button", {
    name: "确认终止",
    exact: true
  });

  await confirm.click();
  await expect(page.getByText("终止结果未知", { exact: false })).toBeVisible();
  expect(probe.capabilityGets).toBe(2);
  expect(probe.terminationPosts).toBe(1);

  await confirm.click();
  await expect(
    page.getByText("垫资额度已终止新占用", { exact: false })
  ).toBeVisible();

  const retryBodies = probe.terminationBodies;
  expect(retryBodies).toHaveLength(2);
  expect(retryBodies[1]).toEqual(retryBodies[0]);
  expect(retryBodies[1]?.actionId).toBe(retryBodies[0]?.actionId);
  expect(retryBodies[1]?.expectedLifecycleToken).toBe(
    retryBodies[0]?.expectedLifecycleToken
  );
  expect(probe.terminationRawBodies[1]).toBe(probe.terminationRawBodies[0]);
  expect(probe.capabilityGets).toBe(2);
  expect(probe.criticalOrder).toEqual([
    `workbench:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `termination:${PROJECT_A.id}`,
    `termination:${PROJECT_A.id}`,
    `workbench:${PROJECT_A.id}`
  ]);
  await expectCleanRuntime(page, runtimeErrors, probe);
});

test("成功回执后权威 workbench GET 失败时重试只能 GET", async ({ page }) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const probe = await installProjectFinancingQuotaMock(page, {
    workbench: ({ projectId, ordinal, probe: currentProbe }) => {
      if (projectId === PROJECT_A.id && ordinal === 2) {
        return jsonReply(
          {
            code: "PROJECT_FINANCING_QUOTA_WORKBENCH_TEMPORARY_FAILURE",
            message: "权威台账暂不可用，请重试"
          },
          503
        );
      }
      return jsonReply(
        financingQuotaWorkbench(
          projectId,
          currentProbe.terminatedProjects.has(projectId)
        )
      );
    }
  });

  await loginAndOpenOperations(page);
  const dialog = await openTerminationDialog(page);
  await fillTermination(dialog);
  const confirm = dialog.getByRole("button", {
    name: "确认终止",
    exact: true
  });

  await confirm.click();
  await expect(page.getByText("权威台账暂不可用", { exact: false })).toBeVisible();
  expect(probe.terminationPosts).toBe(1);
  expect(probe.capabilityGets).toBe(2);
  expect(probe.workbenchGets.get(PROJECT_A.id)).toBe(2);

  await confirm.click();
  await expect(
    page.getByText("垫资额度已终止新占用", { exact: false })
  ).toBeVisible();
  expect(probe.terminationPosts).toBe(1);
  expect(probe.capabilityGets).toBe(2);
  expect(probe.workbenchGets.get(PROJECT_A.id)).toBe(3);
  expect(probe.criticalOrder.slice(-2)).toEqual([
    `workbench:${PROJECT_A.id}`,
    `workbench:${PROJECT_A.id}`
  ]);
  await expectCleanRuntime(page, runtimeErrors, probe);
});

test("能力或生命周期令牌漂移时关闭失败且不发送终止 POST", async ({
  page
}) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const probe = await installProjectFinancingQuotaMock(page, {
    capability: ({ projectId, quotaId, ordinal }) =>
      jsonReply(
        terminationCapability(projectId, quotaId, {
          lifecycleToken: ordinal === 1 ? TOKEN_A : TOKEN_B,
          enabled: ordinal === 1
        })
      )
  });

  await loginAndOpenOperations(page);
  const dialog = await openTerminationDialog(page);
  await fillTermination(dialog);
  await dialog
    .getByRole("button", { name: "确认终止", exact: true })
    .click();

  await expect(
    page.getByText("项目垫资额度终止资格已变化", { exact: false })
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(probe.capabilityGets).toBe(2);
  expect(probe.terminationPosts).toBe(0);
  await expectCleanRuntime(page, runtimeErrors, probe);
});

test("跨项目迟到结果不会污染当前项目", async ({ page }) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const lateCapability = deferred<MockReply>();
  const probe = await installProjectFinancingQuotaMock(page, {
    capability: ({ projectId, quotaId }) =>
      projectId === PROJECT_A.id
        ? lateCapability.promise
        : jsonReply(terminationCapability(projectId, quotaId))
  });

  await loginAndOpenOperations(page);
  await page
    .getByRole("button", { name: "终止额度", exact: true })
    .click();
  await expect.poll(() => probe.capabilityGets).toBe(1);
  await expect(
    page
      .locator(".t-dialog:visible")
      .filter({ hasText: "确认终止垫资额度？" })
  ).toHaveCount(0);

  await selectProject(page, PROJECT_B);
  await expect(page.getByText("第二项目额度", { exact: true })).toBeVisible();

  const lateResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(
      `/projects/${PROJECT_A.id}/financing-quotas/quota-${PROJECT_A.id}/termination-capability`
    )
  );
  lateCapability.resolve(
    jsonReply(
      terminationCapability(PROJECT_A.id, `quota-${PROJECT_A.id}`)
    )
  );
  await lateResponse;
  await settleUi(page);

  await expect(page.getByText("第二项目额度", { exact: true })).toBeVisible();
  await expect(
    page.getByText("垫资额度已终止新占用", { exact: false })
  ).toHaveCount(0);
  await expect(
    page.getByText("项目垫资额度终止资格校验失败", { exact: true })
  ).toHaveCount(0);
  expect(probe.terminationPosts).toBe(0);
  expect(probe.workbenchGets.get(PROJECT_A.id)).toBe(1);
  expect(probe.workbenchGets.get(PROJECT_B.id)).toBe(1);
  await expectCleanRuntime(page, runtimeErrors, probe);
});

test("终止 POST 返回 4xx 后重置尝试并重新执行提交 preflight", async ({
  page
}) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const probe = await installProjectFinancingQuotaMock(page, {
    termination: ({ projectId, quotaId, ordinal, body }) =>
      ordinal === 1
        ? jsonReply(
            {
              code: "PROJECT_FINANCING_QUOTA_TERMINATION_CONFLICT",
              message: "额度状态已变化，请重新核验"
            },
            409
          )
        : jsonReply({
            kind: "applied",
            actionId: body.actionId,
            projectId,
            quotaId
          })
  });

  await loginAndOpenOperations(page);
  const dialog = await openTerminationDialog(page);
  await fillTermination(dialog);
  const reason = dialog.getByPlaceholder("说明终止额度的业务原因");
  const password = dialog.getByPlaceholder("用于确认当前操作者身份");
  const confirm = dialog.getByRole("button", {
    name: "确认终止",
    exact: true
  });

  await confirm.click();
  await expect(page.getByText("额度状态已变化", { exact: false })).toBeVisible();
  await expect(reason).toBeEnabled();
  await expect(password).toBeEnabled();

  await confirm.click();
  await expect(
    page.getByText("垫资额度已终止新占用", { exact: false })
  ).toBeVisible();
  expect(probe.terminationPosts).toBe(2);
  expect(probe.capabilityGets).toBe(3);
  expect(probe.criticalOrder).toEqual([
    `workbench:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `termination:${PROJECT_A.id}`,
    `capability:${PROJECT_A.id}`,
    `termination:${PROJECT_A.id}`,
    `workbench:${PROJECT_A.id}`
  ]);
  await expectCleanRuntime(page, runtimeErrors, probe);
});

async function installProjectFinancingQuotaMock(
  page: Page,
  options: MockApiOptions = {}
): Promise<MockApiProbe> {
  const probe: MockApiProbe = {
    criticalOrder: [],
    capabilityGets: 0,
    terminationPosts: 0,
    terminationRawBodies: [],
    terminationBodies: [],
    workbenchGets: new Map(),
    terminatedProjects: new Set(),
    unhandled: []
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;

    if (method === "POST" && pathname === "/api/auth/login") {
      await fulfillJson(route, {
        user: {
          id: "finance-director-f3",
          name: "财务部主管",
          phone: "13900000494",
          mustChangePassword: false,
          roleKeys: ["finance_director"],
          globalRoleKeys: ["finance_director"]
        },
        tokens: {
          accessToken: "f3-access-token",
          refreshToken: "f3-refresh-token",
          expiresIn: 900
        }
      });
      return;
    }
    if (method === "GET" && pathname === "/api/me/work-items") {
      await fulfillJson(route, emptyWorkItems());
      return;
    }
    if (method === "GET" && pathname === "/api/projects") {
      await fulfillJson(route, PROJECTS.map((project) => ({
        ...project,
        isActive: true
      })));
      return;
    }

    const workbenchMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/financing-quotas$/u
    );
    if (method === "GET" && workbenchMatch) {
      const projectId = decodeURIComponent(workbenchMatch[1]!);
      const ordinal = (probe.workbenchGets.get(projectId) ?? 0) + 1;
      probe.workbenchGets.set(projectId, ordinal);
      probe.criticalOrder.push(`workbench:${projectId}`);
      const context = mockContext(
        projectId,
        `quota-${projectId}`,
        ordinal,
        "",
        {},
        probe
      );
      const reply = options.workbench
        ? await options.workbench(context)
        : jsonReply(
            financingQuotaWorkbench(
              projectId,
              probe.terminatedProjects.has(projectId)
            )
          );
      await fulfillReply(route, reply);
      return;
    }

    const capabilityMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/financing-quotas\/([^/]+)\/termination-capability$/u
    );
    if (method === "GET" && capabilityMatch) {
      const projectId = decodeURIComponent(capabilityMatch[1]!);
      const quotaId = decodeURIComponent(capabilityMatch[2]!);
      probe.capabilityGets += 1;
      probe.criticalOrder.push(`capability:${projectId}`);
      const context = mockContext(
        projectId,
        quotaId,
        probe.capabilityGets,
        "",
        {},
        probe
      );
      const reply = options.capability
        ? await options.capability(context)
        : jsonReply(terminationCapability(projectId, quotaId));
      await fulfillReply(route, reply);
      return;
    }

    const terminationMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/financing-quotas\/([^/]+)\/termination$/u
    );
    if (method === "POST" && terminationMatch) {
      const projectId = decodeURIComponent(terminationMatch[1]!);
      const quotaId = decodeURIComponent(terminationMatch[2]!);
      const rawBody = request.postData() ?? "";
      const body = parseBody(rawBody);
      probe.terminationPosts += 1;
      probe.terminationRawBodies.push(rawBody);
      probe.terminationBodies.push(body);
      probe.criticalOrder.push(`termination:${projectId}`);
      const context = mockContext(
        projectId,
        quotaId,
        probe.terminationPosts,
        rawBody,
        body,
        probe
      );
      const reply = options.termination
        ? await options.termination(context)
        : jsonReply({
            kind: "applied",
            actionId: body.actionId,
            projectId,
            quotaId
          });
      if ((reply.status ?? 200) >= 200 && (reply.status ?? 200) < 300) {
        probe.terminatedProjects.add(projectId);
      }
      await fulfillReply(route, reply);
      return;
    }

    const overviewMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/operating-funds-overview$/u
    );
    if (method === "GET" && overviewMatch) {
      const projectId = decodeURIComponent(overviewMatch[1]!);
      await fulfillJson(route, projectOperatingOverview(projectId));
      return;
    }

    const expenseMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/expense-requests$/u
    );
    if (method === "GET" && expenseMatch) {
      await fulfillJson(route, emptyExpenseLedger());
      return;
    }

    if (
      method === "GET" &&
      /^\/api\/projects\/[^/]+\/affiliate-company-contracts$/u.test(pathname)
    ) {
      await fulfillJson(route, { availableActions: [], contracts: [] });
      return;
    }
    if (
      method === "GET" &&
      /^\/api\/projects\/[^/]+\/affiliate-business-facts$/u.test(pathname)
    ) {
      await fulfillJson(route, {
        availableActions: [],
        contracts: [],
        settlements: [],
        payments: []
      });
      return;
    }

    probe.unhandled.push(`${method} ${pathname}${url.search}`);
    await fulfillJson(
      route,
      { message: `unhandled mock request: ${method} ${pathname}` },
      404
    );
  });
  return probe;
}

async function loginAndOpenOperations(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000494");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/项目经营");
  await expect(page.getByRole("heading", { name: "项目经营", exact: true })).toBeVisible();
  await page.getByText("资金办理", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目垫资额度", exact: true })
  ).toBeVisible();
  await expect(page.getByText("第一项目额度", { exact: true })).toBeVisible();
}

async function openTerminationDialog(page: Page) {
  await page
    .getByRole("button", { name: "终止额度", exact: true })
    .click();
  const dialog = page
    .locator(".t-dialog:visible")
    .filter({ hasText: "确认终止垫资额度？" });
  await expect(dialog).toBeVisible();
  await expectViewportControl(dialog);
  const confirm = dialog.getByRole("button", {
    name: "确认终止",
    exact: true
  });
  await expectViewportControl(confirm);
  return dialog;
}

async function fillTermination(dialog: Locator) {
  await dialog
    .getByPlaceholder("说明终止额度的业务原因")
    .fill(TERMINATION_REASON_INPUT);
  await dialog
    .getByPlaceholder("用于确认当前操作者身份")
    .fill(TERMINATION_PASSWORD_INPUT);
}

async function selectProject(
  page: Page,
  project: (typeof PROJECTS)[number]
) {
  await page.locator(".project-picker .t-select").click();
  await page
    .locator(".t-select__dropdown:visible")
    .getByText(`${project.code} · ${project.name}`, { exact: true })
    .click();
  await expect(page.locator(".project-picker .t-select")).toContainText(
    project.name
  );
}

function terminationCapability(
  projectId: string,
  quotaId: string,
  options: { lifecycleToken?: string; enabled?: boolean } = {}
) {
  const enabled = options.enabled ?? true;
  return {
    projectId,
    quotaId,
    status: "approved",
    lifecycleToken: options.lifecycleToken ?? lifecycleTokenFor(projectId),
    terminateAction: {
      key: "terminate_financing_quota",
      label: "终止额度",
      kind: "danger",
      enabled,
      disabledReason: enabled ? null : "额度终止资格已变化",
      requiredAction: "project.financing_quota.terminate",
      requiresPassword: true
    }
  };
}

function financingQuotaWorkbench(projectId: string, terminated: boolean) {
  const project = projectById(projectId);
  const quotaId = `quota-${projectId}`;
  return {
    project: { id: project.id, code: project.code, name: project.name },
    policy: {
      allocationOrder: ["project_cash", "financing_quota"],
      userSelectable: false
    },
    summary: {
      quotaAmountCents: "5000000",
      netUsedAmountCents: "1200000",
      currentlyAvailableAmountCents: terminated ? "0" : "3800000"
    },
    requestAction: disabledAction("request_financing_quota"),
    rows: [
      {
        id: quotaId,
        amountCents: "5000000",
        reason: `${project.name}额度`,
        validUntil: null,
        status: terminated ? "terminated" : "approved",
        statusLabel: terminated ? "已终止" : "已批准",
        requestedByName: "财务专员",
        approvedByName: "董事长",
        approvedAt: "2026-08-02T01:00:00.000Z",
        terminatedAt: terminated ? "2026-08-02T02:00:00.000Z" : null,
        terminatedByName: terminated ? "财务部主管" : null,
        terminationReason: terminated ? "项目已不再需要新增垫资占用" : null,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: terminated
          ? "2026-08-02T02:00:00.000Z"
          : "2026-08-02T01:00:00.000Z",
        isExpired: false,
        netUsedAmountCents: "1200000",
        availableAmountCents: terminated ? "0" : "3800000",
        currentApproval: null,
        lifecycleToken: terminated
          ? TERMINATED_TOKEN
          : lifecycleTokenFor(projectId),
        reviewAction: disabledAction("review_financing_quota"),
        terminateAction: terminated
          ? disabledAction("terminate_financing_quota", true)
          : terminationCapability(projectId, quotaId).terminateAction,
        usageGroups: [
          {
            executionType: "payment_execution",
            executionId: `execution-${projectId}`,
            businessType: "payment_request",
            businessId: `payment-${projectId}`,
            occurredAt: "2026-08-02T01:30:00.000Z",
            projectCashNetAmountCents: "300000",
            financingQuotaNetAmountCents: "1200000",
            currentQuotaDebitAmountCents: "1200000",
            currentQuotaCreditAmountCents: "0",
            currentQuotaNetAmountCents: "1200000"
          }
        ]
      }
    ]
  };
}

function disabledAction(key: string, requiresPassword = false) {
  return {
    key,
    label: "当前不可办理",
    kind: key === "terminate_financing_quota" ? "danger" : "default",
    enabled: false,
    disabledReason: "当前状态不可办理",
    requiredAction:
      key === "terminate_financing_quota"
        ? "project.financing_quota.terminate"
        : `project.financing_quota.${key}`,
    ...(requiresPassword ? { requiresPassword: true } : {})
  };
}

function projectOperatingOverview(projectId: string) {
  const project = projectById(projectId);
  return {
    project: { ...project, isActive: true },
    cash: {
      actualReceiptsCents: "8000000",
      legacyReceiptsCents: "0",
      affiliateRemittanceCents: "0",
      supplierRefundsCents: "0",
      availableFundsCents: "6800000",
      actualPaidCents: "1200000",
      approvalPendingOccupancyCents: "0",
      approvedPendingPaymentCents: "0",
      financeRecordedOutflowCents: "1200000"
    },
    business: {
      effectiveContractAmountCents: "10000000",
      effectiveSettlementAmountCents: "6000000",
      payableSettlementAmountCents: "5000000",
      operatingIncomeCents: "8000000",
      affiliateDownstreamPaymentCents: "0",
      operatingCostCents: "1200000",
      grossProfitCents: "6800000"
    },
    upstreamFunds: {
      ownerPaymentCents: "0",
      affiliateRemittanceCents: "0",
      affiliateDeductionCents: "0",
      unreconciledReceiptDifferenceCents: "0",
      writtenCount: 0,
      oralCount: 0,
      rows: []
    },
    counts: { contracts: 1, settlements: 1, payments: 1 },
    dataGaps: []
  };
}

function emptyExpenseLedger() {
  return {
    rows: [],
    summary: {
      total: 0,
      approvalPending: 0,
      approvedPendingPayment: 0,
      paid: 0,
      paymentBlocked: 0,
      totalRequestedCents: "0",
      totalPaidCents: "0"
    },
    view: "formal_ledger",
    hasPersistentDraft: false,
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    viewCounts: {
      formal_ledger: 0,
      my_drafts: 0,
      returned_for_revision: 0,
      ended: 0
    },
    statistics: {
      formalTotal: 0,
      pendingApproval: 0,
      pendingPayment: 0,
      paid: 0,
      formalRequestedAmountCents: "0",
      formalPaidAmountCents: "0"
    }
  };
}

function emptyWorkItems() {
  return {
    generatedAt: "2026-08-02T00:00:00.000Z",
    visibleProjectCount: PROJECTS.length,
    queues: { pending: [], blocked: [], started: [], drafts: [] },
    approvalCenter: {
      pendingApproval: [],
      startedByMe: [],
      handledByMe: [],
      delegatedToMe: [],
      overdueReminder: []
    }
  };
}

function lifecycleTokenFor(projectId: string) {
  return projectId === PROJECT_A.id ? TOKEN_A : TOKEN_B;
}

function projectById(projectId: string) {
  const project = PROJECTS.find((item) => item.id === projectId);
  if (!project) throw new Error(`unknown mock project: ${projectId}`);
  return project;
}

function parseBody(rawBody: string): Record<string, unknown> {
  const value = JSON.parse(rawBody) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("termination mock requires a JSON object body");
  }
  return value as Record<string, unknown>;
}

function mockContext(
  projectId: string,
  quotaId: string,
  ordinal: number,
  rawBody: string,
  body: Record<string, unknown>,
  probe: MockApiProbe
): MockRequestContext {
  return { projectId, quotaId, ordinal, rawBody, body, probe };
}

function jsonReply(body: unknown, status = 200): MockReply {
  return { status, body };
}

async function fulfillReply(route: Route, reply: MockReply) {
  await fulfillJson(route, reply.body, reply.status ?? 200);
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function observeRuntimeErrors(page: Page) {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    runtimeErrors.push(`pageerror: ${error.message}`);
  });
  return runtimeErrors;
}

async function expectCleanRuntime(
  page: Page,
  runtimeErrors: string[],
  probe: MockApiProbe
) {
  await expect(
    page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")
  ).toHaveCount(0);
  expect(probe.unhandled).toEqual([]);
  expect(runtimeErrors).toEqual([]);
}

async function expectViewportControl(control: Locator) {
  const position = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    return {
      inViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth,
      unobscured:
        topElement === element ||
        (topElement !== null && element.contains(topElement)),
      rect: {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      },
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth
      }
    };
  });
  expect(
    { inViewport: position.inViewport, unobscured: position.unobscured },
    JSON.stringify(position)
  ).toEqual({ inViewport: true, unobscured: true });
}

async function settleUi(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
