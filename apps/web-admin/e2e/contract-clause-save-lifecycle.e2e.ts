import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const contractId = "contract-clause-input";
const versionId = "version-clause-input";
const screenshotDir = "/tmp/jgzg-contract-clause-save-e2e";

test.describe("合同条款即时受控输入", () => {
  test("未失焦输入进入父模型并在分区往返后保留", async ({ page }, testInfo) => {
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const patchCalls = await installRoutes(page);
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
    await expect(page.locator(".autosave-status")).toHaveText("有未保存修改");
    await expect(page.getByText("已偏离标准条款", { exact: true })).toBeVisible();

    const paragraphInput = page
      .getByTestId("clause-paragraph-payment-0")
      .locator("textarea");
    await paragraphInput.click();
    await paragraphInput.press("ControlOrMeta+A");
    await paragraphInput.pressSequentially("未失焦的新付款正文");
    await expect(paragraphInput).toBeFocused();
    await expect(page.locator(".autosave-status")).toHaveText("有未保存修改");

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
    expect(patchCalls()).toBe(0);

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
});

async function installRoutes(page: Page) {
  let patches = 0;
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
  await page.route("**/api/standard-clauses*", (route) => fulfillJson(route, []));
  await page.route(
    `**/api/contract-workbench/${versionId}/negotiation-rounds`,
    (route) => fulfillJson(route, [])
  );
  await page.route(`**/api/contract-workbench/${versionId}`, (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    patches += 1;
    return fulfillJson(route, {
      version: { id: versionId, draftRevision: 4 }
    });
  });
  await page.route(`**/api/contract-workbench/${contractId}`, (route) =>
    fulfillJson(route, workbench())
  );
  return () => patches;
}

function workbench() {
  const standardContent = {
    text: "标准付款正文\n提交结算资料\n甲 | 乙",
    blocks: [
      { type: "paragraph", text: "标准付款正文" },
      { type: "list", items: ["提交结算资料"] },
      { type: "table", rows: [["甲", "乙"]] }
    ]
  };
  return {
    contract: {
      id: contractId,
      temporaryCode: "草稿-20260725-0001",
      code: null,
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
      draftRevision: 3,
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
      clauseSnapshot: [
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
        }
      ],
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
  await page.goto(`/contracts/${contractId}/workbench`);
  await expect(page.getByRole("heading", { name: "条款即时入模回归合同" })).toBeVisible();
}

async function openSection(page: Page, label: "条款" | "清单") {
  await page
    .locator(".business-tabs")
    .getByText(label, { exact: true })
    .click();
}

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
