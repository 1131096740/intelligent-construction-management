import { expect, test } from "@playwright/test";

test("合同变更从详情进入新版本工作台并在两档宽度保持规则可见", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    })
  }));
  await page.route("**/api/contracts/v1/change-eligibility", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      eligible: true,
      reason: null,
      currentEffective: {
        id: "v1",
        contractId: "contract-1",
        versionNo: 1,
        changeType: "original",
        status: "effective",
        amountCents: "1000000",
        baseVersionId: null,
        supersedesVersionId: null,
        changeReason: null,
        changeDirection: null,
        changeAmountCents: null,
        originalBaseAmountCents: null,
        cumulativeIncreaseCents: "0",
        cumulativeDecreaseCents: "0",
        amountLimitType: "capped",
        enhancedApproval: false,
        enhancedApprovalReasons: [],
        approvalRoute: [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }]
      },
      activeChange: null
    })
  }));
  await page.route("**/api/contracts/v1/change-drafts", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "v2",
      contractId: "contract-1",
      versionNo: 2,
      changeType: "supplement",
      status: "draft",
      amountCents: "1100000",
      baseVersionId: "v1",
      supersedesVersionId: null,
      changeReason: "增加现场签证工程量",
      changeDirection: "increase",
      changeAmountCents: "100000",
      originalBaseAmountCents: "1000000",
      cumulativeIncreaseCents: "100000",
      cumulativeDecreaseCents: "0",
      amountLimitType: "capped",
      enhancedApproval: false,
      enhancedApprovalReasons: [],
      approvalRoute: [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }]
    })
  }));
  await page.route("**/api/contracts/contract-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "HT-001",
      contractVersionId: "v1",
      title: "HT-001 · 材料采购合同",
      meta: [{ label: "当前状态", value: "已生效", tone: "success" }],
      baseInfo: [{ label: "合同金额", value: "¥10,000.00" }],
      effectivenessSteps: [],
      paymentTermStages: [],
      settlementBlockMessage: "可发起结算",
      settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" },
      archiveFiles: [],
      approvalTimeline: [],
      availableActions: [],
      primaryAction: null,
      disabledReasons: [],
      chainLinks: [],
      changeVersions: [{
        versionNo: 1,
        status: "effective",
        changeType: "original",
        changeReason: null,
        changeDirection: null,
        changeAmountCents: null,
        amountCents: "1000000",
        approvalRoute: ["chairman_or_general_manager"],
        archiveEffect: null
      }]
    })
  }));
  await page.route("**/api/contract-workbench/contract-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      contract: { id: "contract-1", projectId: "project-1", contractTypeKey: "material_purchase", ownerUserId: "contract-staff-1", name: "材料采购合同", temporaryCode: "草稿-002", code: "HT-001" },
      version: {
        id: "v2",
        contractId: "contract-1",
        baseVersionId: "v1",
        versionNo: 2,
        status: "draft",
        changeType: "supplement",
        draftRevision: 1,
        amountCents: "1100000",
        pricingNature: "fixed_total",
        amountSource: "manual",
        draftData: {},
        clauseSnapshot: [],
        templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] }
      },
      readiness: { ready: false, blockingMessages: [], warningMessages: [] },
      bills: [], checkpoints: [], parties: [], documents: [],
      paymentTerms: { originalText: "原付款条款", stages: [] },
      change: {
        isChange: true,
        baseVersion: { id: "v1", versionNo: 1, status: "effective", amountCents: "1000000" },
        changeType: "supplement",
        changeReason: "增加现场签证工程量",
        changeDirection: "increase",
        changeAmountCents: "100000",
        originalBaseAmountCents: "1000000",
        cumulativeIncreaseCents: "100000",
        cumulativeDecreaseCents: "0",
        amountLimitType: "capped",
        enhancedApproval: false,
        enhancedApprovalReasons: [],
        approvalRoute: ["chairman_or_general_manager"],
        changePolicy: { version: 1, editableFieldKeys: [], editableClauseKeys: [], coreClauseKeys: [] }
      }
    })
  }));
  await page.route("**/api/contract-templates*", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/projects/contract-create-options", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/contract-number-rules", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/contract-business-scenarios/available*", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/contracts/contract-1");
  await page.getByRole("button", { name: "发起变更/补充协议" }).click();
  await expect(page.getByText("只有新版本归档确认后才会替代旧版本生效")).toBeVisible();
  await page.getByText("金额方向").locator("..").locator(".t-select").click();
  await page.locator(".t-select__dropdown:visible").getByText("增加金额", { exact: true }).click();
  await page.getByText("变更金额（分）").locator("..").getByRole("textbox").fill("100000");
  await page.getByText("变更原因").locator("..").getByRole("textbox").fill("增加现场签证工程量");
  await page.getByRole("button", { name: "创建变更草稿" }).click();
  await expect(page).toHaveURL(/versionId=v2/u);
  await expect(page.getByText("补充协议草稿", { exact: true })).toBeVisible();
  await expect(page.getByText(/旧文件、审批和归档记录不会复制/u)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("contract-change-workbench-1440x900.png"),
    fullPage: true
  });

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.getByText("审批路线：董事长/总经理或签")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("contract-change-workbench-1100x800.png"),
    fullPage: true
  });
});

test("提交资格复核未返回时从合同 A 切到 B 不创建草稿也不跳回 A", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-staff-1", name: "合同经办人", phone: "13900000000",
        mustChangePassword: false, roleKeys: ["contract_staff"], globalRoleKeys: ["contract_staff"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: new Date().toISOString(), visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    })
  }));

  const projection = (contractId: string, versionId: string) => ({
    id: versionId, contractId, versionNo: 1, changeType: "original", status: "effective",
    amountCents: "1000000", baseVersionId: null, supersedesVersionId: null,
    changeReason: null, changeDirection: null, changeAmountCents: null, originalBaseAmountCents: null,
    cumulativeIncreaseCents: "0", cumulativeDecreaseCents: "0", amountLimitType: "capped",
    enhancedApproval: false, enhancedApprovalReasons: [],
    approvalRoute: [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }]
  });
  const history = [{
    versionNo: 1, status: "effective", changeType: "original", changeReason: null,
    changeDirection: null, changeAmountCents: null, amountCents: "1000000",
    approvalRoute: ["chairman_or_general_manager"], archiveEffect: null
  }];
  const detail = (contractId: string, versionId: string, title: string, chainLinks: unknown[]) => ({
    id: contractId, contractVersionId: versionId, title,
    meta: [], baseInfo: [], effectivenessSteps: [], paymentTermStages: [],
    settlementBlockMessage: "可发起结算",
    settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" },
    archiveFiles: [], approvalTimeline: [], availableActions: [], primaryAction: null,
    disabledReasons: [], chainLinks, changeVersions: history
  });
  await page.route("**/api/contracts/contract-a", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail("contract-a", "version-a", "合同 A", [{ label: "切换到合同 B", to: "/合同管理/contract-b" }]))
  }));
  await page.route("**/api/contracts/contract-b", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail("contract-b", "version-b", "合同 B", [{ label: "切换到合同 A", to: "/合同管理/contract-a" }]))
  }));

  let releaseSecondEligibility!: () => void;
  let signalSecondEligibility!: () => void;
  const secondEligibilityReleased = new Promise<void>((resolve) => { releaseSecondEligibility = resolve; });
  const secondEligibilityStarted = new Promise<void>((resolve) => { signalSecondEligibility = resolve; });
  let contractAEligibilityRequests = 0;
  await page.route("**/api/contracts/*/change-eligibility", async (route) => {
    const isContractA = route.request().url().includes("/version-a/");
    if (isContractA) {
      contractAEligibilityRequests += 1;
      if (contractAEligibilityRequests === 2) {
        signalSecondEligibility();
        await secondEligibilityReleased;
      }
    }
    const contractId = isContractA ? "contract-a" : "contract-b";
    const versionId = isContractA ? "version-a" : "version-b";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ eligible: true, reason: null, currentEffective: projection(contractId, versionId), activeChange: null })
    });
  });
  let createDraftRequests = 0;
  await page.route("**/api/contracts/version-a/change-drafts", (route) => {
    createDraftRequests += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(projection("contract-a", "version-a-change")) });
  });
  await page.route("**/api/contract-number-rules", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/contracts/contract-a");
  await page.getByRole("button", { name: "发起变更/补充协议" }).click();
  await page.getByText("变更原因").locator("..").getByRole("textbox").fill("等待资格复核时切换合同");
  await page.getByRole("button", { name: "创建变更草稿" }).click();
  await secondEligibilityStarted;

  await page.evaluate(() => {
    const app = document.querySelector("#app") as Element & {
      __vue_app__?: { config: { globalProperties: { $router?: { push: (to: string) => Promise<void> } } } };
    };
    void app.__vue_app__?.config.globalProperties.$router?.push("/合同管理/contract-b");
  });
  await expect(page).toHaveURL(/\/contract-b$/u);
  await expect(page.getByText("合同 B", { exact: true })).toBeVisible();
  releaseSecondEligibility();
  await expect.poll(() => createDraftRequests).toBe(0);
  await expect(page).toHaveURL(/\/contract-b$/u);
});
