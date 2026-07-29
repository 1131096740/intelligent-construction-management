import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const contractId = "contract-clause-input";
const versionId = "version-clause-input";
const formalContractCode = "HT-2026-CL-001";
const screenshotDir = "/tmp/jgzg-contract-clause-save-e2e";

type ClauseSnapshot = ReturnType<typeof initialClauses>[number];
type DraftPatchBody = {
  expectedRevision?: number;
  saveKind?: "auto" | "manual";
  draft?: {
    clauses?: ClauseSnapshot[];
  };
};

test.describe("合同条款保存生命周期", () => {
  test("首存前只做本地备份，未失焦立即保存包含最后字符并回读正式编号", async ({ page }, testInfo) => {
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const mock = await installRoutes(page);
    await loginAndOpenWorkbench(page);

    await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
      `/合同工作台/${contractId}`
    );
    await expect(page).toHaveTitle(/建工智管/u);
    await expect(page.locator("#main-content")).not.toBeEmpty();
    await expect(
      page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "条款即时入模回归合同" })).toBeVisible();

    await openSection(page, "条款");
    const titleInput = page
      .getByTestId("clause-title-payment")
      .locator("input");
    await expect(titleInput).toBeVisible();
    await titleInput.click();
    await titleInput.press("ControlOrMeta+A");
    await titleInput.pressSequentially("未失焦的新付款标题");
    await expect(titleInput).toBeFocused();
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText(
      "本地已备份，尚未正式保存"
    );
    await expect(page.getByText("已偏离标准条款", { exact: true })).toBeVisible();

    const paragraphInput = page
      .getByTestId("clause-paragraph-payment-0")
      .locator("textarea");
    await paragraphInput.click();
    await paragraphInput.press("ControlOrMeta+A");
    await paragraphInput.pressSequentially("未失焦的新付款正文");
    await expect(paragraphInput).toBeFocused();
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText(
      "本地已备份，尚未正式保存"
    );
    await page.waitForTimeout(1_600);
    expect(mock.patchBodies).toHaveLength(0);

    await openSection(page, "清单");
    await expect(page.getByText("当前合同模板未定义清单。", { exact: true })).toBeVisible();
    await openSection(page, "条款");

    await expect(
      page.getByTestId("clause-title-payment").locator("input")
    ).toHaveValue("未失焦的新付款标题");
    await expect(
      page.getByTestId("clause-paragraph-payment-0").locator("textarea")
    ).toHaveValue("未失焦的新付款正文");

    const numbering = page.getByTestId("clause-numbering-payment");
    await numbering.click();
    await page
      .locator(".t-select__dropdown:visible")
      .getByText("固定编号", { exact: true })
      .click();
    await expect(numbering.locator("input")).toHaveValue("固定编号");

    await openSection(page, "清单");
    await openSection(page, "条款");
    await expect(
      page.getByTestId("clause-numbering-payment").locator("input")
    ).toHaveValue("固定编号");
    expect(mock.patchBodies).toHaveLength(0);

    const saveRequestPromise = page.waitForRequest((request) =>
      request.method() === "PUT" &&
      request.url().endsWith(`/api/contract-drafts/${versionId}`)
    );
    const finalParagraphInput = page
      .getByTestId("clause-paragraph-payment-0")
      .locator("textarea");
    await finalParagraphInput.click();
    await finalParagraphInput.pressSequentially("终");
    await expect(finalParagraphInput).toBeFocused();
    const workbenchReadsBeforeSave = mock.workbenchReadCalls();
    await page
      .locator(".status-right")
      .getByRole("button", { name: "保存草稿", exact: true })
      .click();
    const saveRequest = await saveRequestPromise;
    const saveBody = saveRequest.postDataJSON() as DraftPatchBody;
    const savedPaymentClause = saveBody.draft?.clauses?.find(
      (clause) => clause.key === "payment"
    );
    expect(savedPaymentClause?.title).toBe("未失焦的新付款标题");
    expect(
      clauseText(savedPaymentClause)
    ).toContain("终");
    expect(saveBody.expectedRevision).toBe(3);
    await expect.poll(() => mock.patchBodies.length).toBe(1);
    await expect.poll(() => mock.workbenchReadCalls()).toBe(workbenchReadsBeforeSave + 1);
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText(
      "当前内容已保存"
    );
    await expect(page.getByTestId("contract-draft-manual-save-message")).toHaveText(
      "文档预览生成中"
    );
    expect(mock.previewGenerationCalls()).toBe(1);
    await expect(page.getByTestId("contract-draft-save-receipt")).toContainText("修订 4");
    await expect(page.getByText(formalContractCode, { exact: true }).first()).toBeVisible();

    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `${testInfo.project.name}-controlled-clause-inputs.png`
      ),
      fullPage: true
    });

    expect(consoleIssues).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("选择标准条款时空内容直接填充，非空内容确认后才覆盖", async ({ page }, testInfo) => {
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await installRoutes(page);
    await loginAndOpenWorkbench(page);
    await expectHealthyWorkbench(page);
    await openSection(page, "条款");

    const qualitySelect = page.getByTestId("clause-standard-quality");
    await selectStandardClause(page, qualitySelect, "公司质量验收条款 v3");
    await expect(
      page.getByTestId("clause-title-quality").locator("input")
    ).toHaveValue("质量验收条款");
    await expect(
      page.getByTestId("clause-paragraph-quality-0").locator("textarea")
    ).toHaveValue("质量验收标准正文");
    await expect(page.getByText("已填充标准条款，可继续调整。")).toBeVisible();
    await expect(page.getByRole("button", { name: "插入标准条款" })).toHaveCount(0);

    const paymentSelect = page.getByTestId("clause-standard-payment");
    await selectStandardClause(page, paymentSelect, "公司付款条款 v4");
    const replacementDialog = page
      .locator(".t-dialog:visible")
      .filter({ hasText: "确认替换标准条款" });
    await expect(replacementDialog).toBeVisible();
    await expect(replacementDialog).toContainText("当前标题和正文将被覆盖");
    await expect(
      page.getByTestId("clause-title-payment").locator("input")
    ).toHaveValue("标准付款条款");
    await expect(paymentSelect.locator("input")).toHaveValue("公司付款条款 v2");

    await replacementDialog.getByRole("button", { name: "取消" }).click();
    await expect(replacementDialog).toBeHidden();
    await expect(
      page.getByTestId("clause-title-payment").locator("input")
    ).toHaveValue("标准付款条款");
    await expect(
      page.getByTestId("clause-paragraph-payment-0").locator("textarea")
    ).toHaveValue("标准付款正文");
    await expect(
      page.getByTestId("clause-list-payment-1").locator("textarea")
    ).toHaveValue("提交结算资料");
    await expect(
      page.getByTestId("clause-table-payment-2-0-0").locator("input")
    ).toHaveValue("甲");
    await expect(
      page.getByTestId("clause-table-payment-2-0-1").locator("input")
    ).toHaveValue("乙");
    await expect(paymentSelect.locator("input")).toHaveValue("公司付款条款 v2");

    await selectStandardClause(page, paymentSelect, "公司付款条款 v4");
    await replacementDialog
      .getByRole("button", { name: "确认替换" })
      .click();
    await expect(replacementDialog).toBeHidden();
    await expect(
      page.getByTestId("clause-title-payment").locator("input")
    ).toHaveValue("付款条款（新版）");
    await expect(
      page.getByTestId("clause-paragraph-payment-0").locator("textarea")
    ).toHaveValue("新版付款正文");
    await expect(page.getByTestId("clause-list-payment-1")).toHaveCount(0);
    await expect(page.getByTestId("clause-table-payment-2-0-0")).toHaveCount(0);
    await expect(paymentSelect.locator("input")).toHaveValue("公司付款条款 v4");
    const replacedParagraph = page
      .getByTestId("clause-paragraph-payment-0")
      .locator("textarea");
    await replacedParagraph.click();
    await replacedParagraph.press("End");
    await replacedParagraph.pressSequentially("（现场调整）");
    await expect(replacedParagraph).toBeFocused();
    await expect(page.getByText("已偏离标准条款", { exact: true })).toBeVisible();
    await paymentSelect.click();
    const latestOptions = page.locator(".t-select__dropdown:visible");
    await expect(
      latestOptions.getByText("公司付款条款 v2", { exact: true })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `${testInfo.project.name}-standard-clause-replacement.png`
      ),
      fullPage: true
    });

    expect(consoleIssues).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("首次正式保存后约一秒自动保存，失败保留内容且 clean 保存只重排预览", async ({ page }, testInfo) => {
    const consoleIssues: string[] = [];
    const expectedFailureConsoleIssues: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        const text = `${message.type()}: ${message.text()}`;
        if (message.text().includes("Failed to load resource") && message.text().includes("500")) {
          expectedFailureConsoleIssues.push(text);
        } else {
          consoleIssues.push(text);
        }
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const mock = await installRoutes(page);
    await loginAndOpenWorkbench(page);
    await expectHealthyWorkbench(page);
    await openSection(page, "条款");

    const paragraph = page
      .getByTestId("clause-paragraph-payment-0")
      .locator("textarea");
    await paragraph.click();
    await paragraph.press("End");
    await paragraph.pressSequentially("首");
    await page
      .locator(".status-right")
      .getByRole("button", { name: "保存草稿", exact: true })
      .click();
    await expect.poll(() => mock.patchBodies.length).toBe(1);
    await expect.poll(() => mock.workbenchReadCalls()).toBe(2);
    await expect(page.getByText(formalContractCode, { exact: true }).first()).toBeVisible();
    expect(mock.patchBodies[0]?.expectedRevision).toBe(3);
    expect(mock.previewGenerationCalls()).toBe(1);

    const readsAfterFirstSave = mock.workbenchReadCalls();
    const patchCountBeforeAutosave = mock.patchBodies.length;
    const formalParagraph = page
      .getByTestId("clause-paragraph-payment-0")
      .locator("textarea");
    await formalParagraph.click();
    await formalParagraph.press("End");
    const autosaveEditStartedAt = Date.now();
    await formalParagraph.pressSequentially("自");
    await expect(formalParagraph).toBeFocused();
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText(
      "有待保存修改"
    );
    await page.waitForTimeout(900);
    expect(mock.patchBodies).toHaveLength(patchCountBeforeAutosave);
    await expect.poll(() => mock.patchBodies.length, { timeout: 3_000 }).toBe(
      patchCountBeforeAutosave + 1
    );
    const autosaveDelay = mock.patchTimes[1]! - autosaveEditStartedAt;
    expect(autosaveDelay).toBeGreaterThanOrEqual(850);
    expect(autosaveDelay).toBeLessThan(2_500);
    expect(mock.patchBodies[1]?.expectedRevision).toBe(4);
    expect(
      clauseText(
        mock.patchBodies[1]?.draft?.clauses?.find((clause) => clause.key === "payment")
      )
    ).toContain("首自");
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText("已保存");
    expect(mock.previewGenerationCalls()).toBe(1);
    expect(mock.workbenchReadCalls()).toBe(readsAfterFirstSave);

    mock.failNextSave();
    await formalParagraph.click();
    await formalParagraph.press("End");
    await formalParagraph.pressSequentially("败");
    await expect.poll(() => mock.patchBodies.length, { timeout: 3_000 }).toBe(3);
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText("保存失败");
    await expect(formalParagraph).toHaveValue(/首自败$/u);
    expect(mock.patchBodies[2]?.expectedRevision).toBe(5);
    await page.waitForTimeout(1_200);
    expect(mock.patchBodies).toHaveLength(3);
    expect(mock.workbenchReadCalls()).toBe(readsAfterFirstSave);

    const saveButton = page
      .locator(".status-right")
      .getByRole("button", { name: "保存草稿", exact: true });
    await saveButton.click();
    await expect.poll(() => mock.patchBodies.length).toBe(4);
    await expect(page.getByTestId("contract-draft-save-status")).toHaveText("已保存");
    await expect(formalParagraph).toHaveValue(/首自败$/u);
    expect(mock.workbenchReadCalls()).toBe(readsAfterFirstSave);

    const patchesBeforeCleanSave = mock.patchBodies.length;
    const readsBeforeCleanSave = mock.workbenchReadCalls();
    const previewsBeforeCleanSave = mock.previewGenerationCalls();
    await saveButton.click();
    await expect(page.getByTestId("contract-draft-manual-save-message")).toHaveText(
      "文档预览生成中"
    );
    await page.waitForTimeout(200);
    expect(mock.patchBodies).toHaveLength(patchesBeforeCleanSave);
    expect(mock.workbenchReadCalls()).toBe(readsBeforeCleanSave);
    expect(mock.previewGenerationCalls()).toBe(previewsBeforeCleanSave + 1);

    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `${testInfo.project.name}-clause-autosave-lifecycle.png`
      ),
      fullPage: true
    });

    expect(consoleIssues).toEqual([]);
    expect(expectedFailureConsoleIssues.length).toBeLessThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  });
});

async function installRoutes(page: Page) {
  const patchBodies: DraftPatchBody[] = [];
  const patchTimes: number[] = [];
  let workbenchReads = 0;
  let currentRevision = 3;
  let currentCode: string | null = null;
  let serverClauses = cloneJson(initialClauses());
  let failNextPatch = false;
  let previewGenerationCalls = 0;

  await page.route("**/api/auth/login", (route) => fulfillJson(route, {
    user: {
      id: "contract-staff-1",
      name: "合同经办人",
      phone: "13900000000",
      mustChangePassword: false,
      roleKeys: ["contract_staff"],
      globalRoleKeys: ["contract_staff"]
    },
    tokens: {
      accessToken: "clause-input-access-token",
      refreshToken: "clause-input-refresh-token",
      expiresIn: 900
    }
  }));
  await page.route("**/api/me/work-items", (route) => fulfillJson(route, {
    generatedAt: "2026-07-25T00:00:00.000Z",
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
  await page.route("**/api/projects/contract-create-options", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/contract-templates*", (route) => fulfillJson(route, []));
  await page.route("**/api/contract-layout-templates*", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/contract-number-rules", (route) => fulfillJson(route, []));
  await page.route("**/api/company-entities*", (route) => fulfillJson(route, []));
  await page.route("**/api/standard-clauses*", (route) =>
    fulfillJson(route, publishedStandardClauses())
  );
  await page.route(
    `**/api/contract-workbench/${versionId}/negotiation-rounds`,
    (route) => fulfillJson(route, [])
  );
  await page.route(`**/api/contract-drafts/${versionId}/edit-lease**`, (route) => {
    if (route.request().method() === "DELETE") {
      return fulfillJson(route, { released: true });
    }
    return fulfillJson(route, {
      token: "lease-token",
      leaseRevision: 1,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      heartbeatIntervalMs: 60_000
    });
  });
  await page.route(`**/api/contract-drafts/${versionId}/preview-generation`, (route) => {
    previewGenerationCalls += 1;
    return fulfillJson(route, { queued: true });
  });
  await page.route(`**/api/contract-drafts/${versionId}`, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as DraftPatchBody;
    patchBodies.push(cloneJson(body));
    patchTimes.push(Date.now());
    if (failNextPatch) {
      failNextPatch = false;
      return fulfillJson(route, { message: "模拟自动保存失败" }, 500);
    }
    currentRevision += 1;
    currentCode ??= formalContractCode;
    if (Array.isArray(body.draft?.clauses)) {
      serverClauses = cloneJson(body.draft.clauses);
    }
    return fulfillJson(route, {
      contractVersionId: versionId,
      draftRevision: currentRevision,
      savedAt: new Date().toISOString(),
      effectiveChangedSections: ["draft"],
      amounts: {
        taxInclusiveAmountCents: "0",
        taxExclusiveAmountCents: "0",
        taxAmountCents: "0"
      },
      billRevisions: {},
      issueCounts: {},
      readiness: { ready: false, blockingMessages: [], warningMessages: [] },
      documentsOutdated: true,
      availableActions: []
    });
  });
  await page.route(`**/api/contract-drafts/${versionId}/workbench`, (route) => {
    workbenchReads += 1;
    return fulfillJson(route, workbench({
      code: currentCode,
      draftRevision: currentRevision,
      clauses: serverClauses
    }));
  });

  return {
    patchBodies,
    patchTimes,
    workbenchReadCalls: () => workbenchReads,
    previewGenerationCalls: () => previewGenerationCalls,
    failNextSave: () => {
      failNextPatch = true;
    }
  };
}

function workbench(input: {
  code?: string | null;
  draftRevision?: number;
  clauses?: ClauseSnapshot[];
} = {}) {
  return {
    contract: {
      id: contractId,
      temporaryCode: "草稿-20260725-0001",
      code: input.code ?? null,
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      ownerUserId: "contract-staff-1",
      name: "条款即时入模回归合同"
    },
    version: {
      id: versionId,
      versionNo: 1,
      status: "draft",
      changeType: "original",
      draftRevision: input.draftRevision ?? 3,
      amountCents: "0",
      pricingNature: "fixed_total",
      amountSource: "manual",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        status: "draft",
        source: "contract_document",
        revision: 0,
        frozenAt: null
      },
      draftData: {},
      clauseSnapshot: cloneJson(input.clauses ?? initialClauses()),
      templateSnapshot: {
        fieldSchema: [],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: []
      }
    },
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
      confirmedByUserId: "contract-director-1",
      confirmationRequired: false,
      canConfirm: false
    },
    checkpoints: [],
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] }
  };
}

function initialClauses() {
  const standardContent = {
    text: "标准付款正文\n提交结算资料\n甲 | 乙",
    blocks: [
      { type: "paragraph", text: "标准付款正文" },
      { type: "list", items: ["提交结算资料"] },
      { type: "table", rows: [["甲", "乙"]] }
    ]
  };
  return [
    {
      key: "payment",
      title: "标准付款条款",
      numberingMode: "automatic",
      required: true,
      standardClauseVersionId: "standard-clause-payment-v2",
      content: {
        ...standardContent,
        standardTitle: "标准付款条款",
        standardContent,
        standardClauseSourceName: "公司付款条款",
        standardClauseVersionNo: 2,
        deviatedFromStandard: false
      }
    },
    {
      key: "quality",
      title: "",
      numberingMode: "automatic",
      required: false,
      standardClauseVersionId: null,
      content: {
        text: "",
        blocks: [{ type: "paragraph", text: "" }]
      }
    }
  ];
}

function clauseText(clause: ClauseSnapshot | undefined): string {
  if (!clause || !clause.content || typeof clause.content !== "object") {
    return "";
  }
  const text = (clause.content as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loginAndOpenWorkbench(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/首页");
  await page.goto(`/contracts/${contractId}/workbench?versionId=${versionId}`);
  await expect(page.getByRole("heading", { name: "条款即时入模回归合同" })).toBeVisible();
}

async function expectHealthyWorkbench(page: Page) {
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    `/合同工作台/${contractId}`
  );
  await expect(page).toHaveTitle(/建工智管/u);
  await expect(page.locator("#main-content")).not.toBeEmpty();
  await expect(
    page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "条款即时入模回归合同" })).toBeVisible();
}

async function openSection(page: Page, label: "条款" | "清单") {
  const sectionId = label === "条款" ? "clauses" : "bill_tax";
  await page.locator(`[data-section-nav-id="${sectionId}"]`).click();
  await expect(page.locator(`[data-section-id="${sectionId}"]`)).toBeVisible();
}

async function selectStandardClause(
  page: Page,
  select: Locator,
  label: string
) {
  await select.click();
  await page
    .locator(".t-select__dropdown:visible")
    .getByText(label, { exact: true })
    .click();
}

function publishedStandardClauses() {
  return [
    {
      standardClauseVersionId: "standard-clause-quality-v3",
      versionId: "standard-clause-quality-v3",
      versionNo: 3,
      title: "质量验收条款",
      content: {
        text: "质量验收标准正文",
        blocks: [{ type: "paragraph", text: "质量验收标准正文" }]
      },
      clauseId: "standard-clause-quality",
      code: "QUALITY",
      name: "公司质量验收条款",
      category: "质量"
    },
    {
      standardClauseVersionId: "standard-clause-payment-v4",
      versionId: "standard-clause-payment-v4",
      versionNo: 4,
      title: "付款条款（新版）",
      content: {
        text: "新版付款正文",
        blocks: [{ type: "paragraph", text: "新版付款正文" }]
      },
      clauseId: "standard-clause-payment",
      code: "PAYMENT",
      name: "公司付款条款",
      category: "付款"
    }
  ];
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
