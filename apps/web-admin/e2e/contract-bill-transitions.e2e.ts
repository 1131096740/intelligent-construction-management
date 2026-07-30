import { expect, test, type Page, type Route } from "@playwright/test";

const contractId = "contract-transition-e2e";
const versionId = "version-transition-e2e";

test("合同变更清单在页面保存映射后由主任确认", async ({ page }) => {
  const mock = await installRoutes(page);
  await loginAndOpenWorkbench(page);

  await page.locator('[data-section-nav-id="bill_tax"]').click();
  await expect(page.getByText("旧版结算承接映射", { exact: true })).toBeVisible();

  await page.getByPlaceholder("旧版已结算行").click();
  await page.getByText(/旧版钢筋.*已结 30 t/u).click();
  await page.getByPlaceholder("新版目标行").click();
  await page.getByText(/承接钢筋.*t/u).click();
  await expect(page.getByPlaceholder("来源已结数量")).toHaveValue("30");
  await expect(page.getByPlaceholder("目标期初数量")).toHaveValue("30");
  await expect(page.getByPlaceholder("历史金额（分）")).toHaveValue("3000");

  await page.getByRole("button", { name: "保存映射", exact: true }).click();
  await expect.poll(() => mock.saveBodies).toHaveLength(1);
  expect(mock.saveBodies[0]).toMatchObject({
    fromContractVersionId: "version-source-e2e",
    expectedTargetVersionRevision: 4,
    mappings: [{
      sourceContractBillRowId: "source-row-e2e",
      targetContractBillRowId: "target-row-e2e",
      sourceSettledQuantityAllocated: "30",
      targetOpeningQuantity: "30",
      settledAmountAllocatedCents: "3000"
    }]
  });

  const confirm = page.getByRole("button", { name: "合同部主任确认", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect.poll(() => mock.confirmBodies).toHaveLength(1);
  expect(mock.confirmBodies[0]).toEqual({ expectedTargetVersionRevision: 5 });
  await expect(confirm).toHaveCount(0);
  expect(mock.workbenchRevisions).toContain(5);
  expect(mock.workbenchRevisions).toContain(6);
});

async function installRoutes(page: Page) {
  let revision = 4;
  let mappings: Array<Record<string, unknown>> = [];
  const saveBodies: unknown[] = [];
  const confirmBodies: unknown[] = [];
  const workbenchRevisions: number[] = [];

  await page.route("**/api/**", (route) => fulfillJson(route, {}));
  await page.route("**/api/auth/login", (route) => fulfillJson(route, {
    user: {
      id: "seed-user-contract-director",
      name: "合同部主任",
      phone: "13900000000",
      mustChangePassword: false,
      roleKeys: ["contract_director"],
      globalRoleKeys: ["contract_director"]
    },
    tokens: { accessToken: "transition-e2e-token", refreshToken: "transition-e2e-refresh", expiresIn: 900 }
  }));
  await page.route("**/api/me/work-items", (route) => fulfillJson(route, {
    generatedAt: "2026-07-27T00:00:00.000Z",
    visibleProjectCount: 1,
    queues: { pending: [], blocked: [], started: [] },
    approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
  }));
  await page.route("**/api/projects/contract-create-options", (route) => fulfillJson(route, []));
  await page.route("**/api/approval-delegations/user-options", (route) => fulfillJson(route, []));
  await page.route("**/api/contract-number-rules", (route) => fulfillJson(route, []));
  await page.route("**/api/contract-templates*", (route) => fulfillJson(route, []));
  await page.route("**/api/contract-layout-templates*", (route) => fulfillJson(route, []));
  await page.route(`**/api/contract-workbench/${versionId}/negotiation-rounds`, (route) => fulfillJson(route, []));
  await page.route(`**/api/contract-drafts/${versionId}/edit-lease**`, (route) => {
    if (route.request().method() === "DELETE") {
      return fulfillJson(route, { released: true });
    }
    return fulfillJson(route, {
      token: "transition-e2e-lease",
      leaseRevision: 1,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      heartbeatIntervalMs: 60_000
    });
  });
  await page.route(`**/api/contract-versions/${versionId}/bill-transitions/options`, (route) => fulfillJson(route, {
    fromContractVersionId: "version-source-e2e",
    canConfirm: true,
    sources: [{ id: "source-row-e2e", itemName: "旧版钢筋", specification: null, unit: "t", historicalQuantity: "30", historicalAmountCents: "3000" }],
    targets: [{ id: "target-row-e2e", itemName: "承接钢筋", specification: null, unit: "t" }]
  }));
  await page.route(`**/api/contract-versions/${versionId}/bill-transitions/confirm`, (route) => {
    expect(route.request().method()).toBe("POST");
    confirmBodies.push(route.request().postDataJSON());
    revision = 6;
    mappings = mappings.map((mapping) => ({ ...mapping, status: "confirmed", confirmedByUserId: "seed-user-contract-director" }));
    return fulfillJson(route, mappings);
  });
  await page.route(`**/api/contract-versions/${versionId}/bill-transitions`, (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, mappings);
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON() as { mappings: Array<Record<string, unknown>> };
    saveBodies.push(body);
    revision = 5;
    mappings = body.mappings.map((mapping, index) => ({
      id: `mapping-${index + 1}`,
      ...mapping,
      relationType: "one_to_one",
      matchBasis: "manual",
      status: "draft"
    }));
    return fulfillJson(route, mappings);
  });
  await page.route(`**/api/contract-drafts/${versionId}/workbench`, (route) => {
    workbenchRevisions.push(revision);
    return fulfillJson(route, workbench(revision));
  });

  return { saveBodies, confirmBodies, workbenchRevisions };
}

function workbench(revision: number) {
  return {
    contract: {
      id: contractId,
      temporaryCode: "草稿-跨版本-E2E",
      code: null,
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      ownerUserId: "seed-user-contract-staff",
      name: "跨版本清单映射回归合同"
    },
    version: {
      id: versionId,
      versionNo: 2,
      changeType: "change",
      status: "draft",
      draftRevision: revision,
      amountCents: "10000",
      pricingNature: "unit_price",
      amountSource: "bill_sum",
      manualAmountCents: null,
      amountLimitType: "capped",
      taxFacts: { invoiceType: "vat_special", taxMode: "single_rate", defaultTaxRatePercent: "13", status: "draft", source: "contract_document", revision: 0, frozenAt: null },
      draftData: {},
      clauseSnapshot: [],
      templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] }
    },
    change: { baseVersion: { id: "version-source-e2e", versionNo: 1, amountCents: "10000" }, editableFieldKeys: [], editableClauseKeys: [] },
    parties: [],
    bills: [],
    paymentTerms: { originalText: "", stages: [] },
    draft: {},
    attachments: [],
    lease: {
      state: "available",
      holderDisplayName: null,
      expiresAt: null,
      canTakeOver: false
    },
    settlementMode: {
      value: "settlement_required",
      source: "contract_director",
      confirmedAt: "2026-07-25T00:00:00.000Z",
      confirmedByUserId: "seed-user-contract-director",
      confirmationRequired: false,
      canConfirm: false
    },
    checkpoints: [],
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] }
  };
}

async function loginAndOpenWorkbench(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/首页");
  await page.goto(`/contracts/${contractId}/workbench?versionId=${versionId}`);
  await expect(page.getByRole("heading", { name: "跨版本清单映射回归合同" })).toBeVisible();
}

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}
