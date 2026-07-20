import { expect, test, type Page } from "@playwright/test";

const usagePreview = {
  fields: [],
  bills: [],
  clauses: [],
  attachments: [],
  validations: []
};

const templates = [
  {
    id: "template-standard",
    code: "TPL-MAT-STANDARD",
    name: "材料采购标准模板",
    contractTypeKey: "material_purchase",
    status: "published",
    versionId: "version-standard-2",
    versionNo: 2,
    usagePreview
  },
  {
    id: "template-simple",
    code: "TPL-MAT-SIMPLE",
    name: "材料采购简版模板",
    contractTypeKey: "material_purchase",
    status: "published",
    versionId: "version-simple-1",
    versionNo: 1,
    usagePreview
  }
];

async function mockLogin(page: Page, role: "contract_staff" | "contract_director") {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: `${role}-1`,
          name: role === "contract_director" ? "合同主管" : "合同经办人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: [role],
          globalRoleKeys: [role]
        },
        tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      })
    })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

test("合同经办人按项目和场景明确选择推荐模板且不请求治理 API", async ({ page }, testInfo) => {
  await mockLogin(page, "contract_staff");
  let governanceCalls = 0;
  let createBody: Record<string, unknown> | null = null;
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "XM-001", name: "科技园项目" }])
    })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(templates) })
  );
  await page.route("**/api/contract-business-scenarios/available*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "scenario-material", code: "materials", name: "材料采购", description: "主材采购签约" }
      ])
    })
  );
  await page.route("**/api/contract-business-scenarios/recommendations*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        scenario: { id: "scenario-material", code: "materials", name: "材料采购" },
        selectionMode: "choice_required",
        recommendations: [
          { mappingId: "mapping-standard", reason: "常规主材采购且需要完整清单", template: templates[0] },
          { mappingId: "mapping-simple", reason: "小额临时采购且无复杂条款", template: templates[1] }
        ]
      })
    })
  );
  await page.route("**/api/contract-business-scenarios", (route) => {
    governanceCalls += 1;
    return route.abort();
  });
  await page.route("**/api/contracts", async (route) => {
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ contract: { id: "contract-created" }, version: { id: "version-created" }, terms: { id: "terms-created" } })
    });
  });
  await page.route("**/api/contract-workbench/contract-created", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stop after create assertion" }) })
  );

  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await page.getByText("合同工作台", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "新建合同" })).toBeVisible();
  await expect(page.getByText("合同业务场景", { exact: true })).toHaveCount(0);

  const scenarioSelect = page.locator("label.field").filter({ hasText: "业务场景" }).locator(".t-select");
  await scenarioSelect.click();
  await page.locator(".t-select__dropdown:visible").getByText("材料采购", { exact: true }).click();
  const typeSelect = page.locator("label.field").filter({ hasText: "合同类型" }).locator(".t-select");
  await typeSelect.click();
  await page.locator(".t-select__dropdown:visible").getByText("材料采购合同", { exact: true }).click();

  await expect(page.getByText("请明确选择一个推荐模板", { exact: true })).toBeVisible();
  await expect(page.getByText("常规主材采购且需要完整清单", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "创建草稿" })).toBeDisabled();
  await page.getByText("材料采购标准模板", { exact: true }).click();
  await expect(page.getByRole("button", { name: "创建草稿" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("contract-scenario-create-1440x1100.png"), fullPage: true });

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.getByText("小额临时采购且无复杂条款", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("contract-scenario-create-1100x800.png"), fullPage: true });
  await page.getByRole("button", { name: "创建草稿" }).click();
  await expect.poll(() => createBody).not.toBeNull();
  expect(createBody).toEqual({
    projectId: "project-1",
    contractTypeKey: "material_purchase",
    businessTemplateVersionId: "version-standard-2",
    amountLimitType: "capped",
    businessScenarioId: "scenario-material",
    scenarioTemplateMappingId: "mapping-standard"
  });
  expect(governanceCalls).toBe(0);
});

test("全局合同主管可管理场景和 exact 模板映射", async ({ page }, testInfo) => {
  await mockLogin(page, "contract_director");
  let mappingPatch: Record<string, unknown> | null = null;
  const governance = [{
    id: "scenario-material",
    code: "materials",
    name: "材料采购",
    description: "主材采购签约",
    active: true,
    revision: 2,
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
    mappings: [{
      id: "mapping-standard",
      businessScenarioId: "scenario-material",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "version-standard-2",
      reason: "常规主材采购",
      priority: 10,
      active: true,
      revision: 3,
      createdAt: "2026-07-12T08:00:00.000Z",
      updatedAt: "2026-07-12T09:00:00.000Z"
    }]
  }];
  await page.route("**/api/contract-business-scenarios", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(governance) })
  );
  await page.route("**/api/contract-templates", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(templates) })
  );
  await page.route("**/api/contract-scenario-template-mappings/mapping-standard", (route) => {
    mappingPatch = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await page.getByText("合同业务场景", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "合同业务场景" })).toBeVisible();
  await expect(page.getByText("材料采购标准模板·V2", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("contract-scenario-governance-1440x1100.png"), fullPage: true });

  await page.getByText("编辑", { exact: true }).last().click();
  await page.getByPlaceholder("填写给经办人看的推荐理由").fill("常规主材采购且需要完整清单");
  await page.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => mappingPatch).not.toBeNull();
  expect(mappingPatch).toEqual({
    expectedRevision: 3,
    reason: "常规主材采购且需要完整清单",
    priority: 10
  });
  await expect(page.locator(".t-dialog:visible")).toHaveCount(0);

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.getByRole("heading", { name: "材料采购·模板映射" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("contract-scenario-governance-1100x800.png"), fullPage: true });
});
