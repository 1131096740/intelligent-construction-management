import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const responsiveViewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 }
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/contract-number-rules", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
});

test("合同工作台以纵向正文画布展示并可定位资料检查问题", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  let privateFileCalls = 0;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
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
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/standard-clauses*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-versions/version-1/bill-transitions/options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-versions/version-1/bill-transitions", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/company-entities*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-1/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-drafts/version-1/edit-lease**", (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ released: true })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "lease-token",
        leaseRevision: 1,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        heartbeatIntervalMs: 60_000
      })
    });
  });
  await page.route("**/api/files/**", (route) => {
    privateFileCalls += 1;
    return route.abort();
  });
  await page.route("**/api/contract-drafts/version-1/workbench", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract: {
          id: "contract-1",
          temporaryCode: "草稿-20260712-0001",
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          ownerUserId: "contract-staff-1",
          name: "科技园钢材采购合同"
        },
        version: {
          id: "version-1",
          versionNo: 1,
          status: "draft",
          draftRevision: 3,
          changeType: "original",
          amountCents: "120000000",
          estimatedAmountCents: null,
          amountLimitType: "capped",
          pricingNature: "fixed_total",
          amountSource: "bill_sum",
          taxFacts: {
            invoiceType: "vat_special",
            taxMode: "single_rate",
            defaultTaxRatePercent: null,
            status: "draft",
            source: "contract_document",
            revision: 0,
            frozenAt: null
          },
          draftData: {},
          clauseSnapshot: [],
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
          confirmedAt: "2026-07-12T05:00:00.000Z",
          confirmedByUserId: "contract-director-1",
          confirmationRequired: false,
          canConfirm: false
        },
        documents: [
          {
            id: "document-current",
            purpose: "draft",
            status: "success",
            sourceRevision: 3,
            docxFileId: "docx-current",
            pdfFileId: "pdf-current",
            createdAt: "2026-07-12T06:00:00.000Z",
            completedAt: "2026-07-12T06:01:00.000Z"
          }
        ],
        readiness: {
          ready: false,
          blockingMessages: ["请填写合同默认税率"],
          warningMessages: [],
          blocking: [
            {
              key: "tax.default_rate.missing",
              section: "tax",
              message: "请填写合同默认税率",
              location: {
                sectionId: "bill_tax",
                fieldKey: "defaultTaxRatePercent"
              }
            }
          ],
          warnings: []
        }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/contracts/contract-1/workbench?versionId=version-1");
  await expect(page.getByRole("heading", { name: "合同正文画布" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "科技园钢材采购合同" }).last()).toBeVisible();
  await expect(page.getByText("正文可预览", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "资料检查" })).toBeVisible();
  await expect(page.locator("[data-section-id]")).toHaveCount(10);
  await page.getByRole("button", { name: "请填写合同默认税率" }).click();
  await expect(
    page.locator('[data-field-key="defaultTaxRatePercent"] input:focus')
  ).toHaveCount(1);
  await expect(page.getByText("已定位到具体问题", { exact: true })).toBeVisible();

  const desktopCanvas = await page.locator(".document-canvas-slot").boundingBox();
  const desktopSidebar = await page.locator(".business-sidebar").boundingBox();
  expect(desktopCanvas).not.toBeNull();
  expect(desktopSidebar).not.toBeNull();
  expect(desktopCanvas!.x).toBeLessThan(desktopSidebar!.x);
  await expect(page.locator(".mobile-pane-switch")).toBeHidden();
  expect(
    await page.locator(".status-bar").evaluate((element) =>
      getComputedStyle(element).position
    )
  ).toBe("sticky");
  for (const selector of [".document-canvas-slot", ".business-sidebar"]) {
    expect(
      await page.locator(selector).evaluate((element) =>
        getComputedStyle(element).overflowY
      )
    ).toBe("auto");
  }
  await page.locator('[data-section-nav-id="negotiation_documents"]').click();
  await expect(page.getByRole("heading", { name: "合同文档" })).toBeVisible();
  expect(privateFileCalls).toBe(0);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  let mobileInputPreservationVerified = false;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    const paneSwitch = page.locator(".mobile-pane-switch");
    if (await paneSwitch.isVisible()) {
      await expect(page.locator(".business-sidebar")).toBeVisible();
      await expect(page.locator(".document-canvas-slot")).toBeHidden();

      if (!mobileInputPreservationVerified) {
        const contractName = page.getByPlaceholder("请输入合同名称");
        await contractName.fill("移动端切换保留输入");
        await paneSwitch.getByText("文档", { exact: true }).click();
        await expect(page.locator(".document-canvas-slot")).toBeVisible();
        await expect(page.locator(".business-sidebar")).toBeHidden();
        await expect(
          page.getByRole("heading", { name: /合同(?:正文画布|文档)/u })
        ).toBeVisible();
        await paneSwitch.getByText("资料", { exact: true }).click();
        await expect(page.locator(".business-sidebar")).toBeVisible();
        await expect(contractName).toHaveValue("移动端切换保留输入");
        mobileInputPreservationVerified = true;
      }
    } else {
      const canvas = await page.locator(".document-canvas-slot").boundingBox();
      const sidebar = await page.locator(".business-sidebar").boundingBox();
      expect(canvas).not.toBeNull();
      expect(sidebar).not.toBeNull();
      if (viewport.width >= 1440) {
        expect(canvas!.x).toBeLessThan(sidebar!.x);
      } else {
        expect(sidebar!.y).toBeGreaterThan(canvas!.y);
      }
    }
    await expect(page.getByRole("heading", { name: "资料检查" })).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(screenshotDir, `contract-workbench-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }
  expect(mobileInputPreservationVerified).toBe(true);
});

test("合同签前文件工作台保留授权组合、关联重试与唯一提交", async ({ page }) => {
  test.setTimeout(60_000);
  let revision = 3;
  let privateFileCalls = 0;
  let authorizationCalls = 0;
  let failFirstAuthorizationAssociation = true;
  let failNextFormalAssociation = true;
  let formalFile: Record<string, unknown> | null = null;
  let approvalSubmissions = 0;
  let releaseFirstSave!: () => void;
  let markFirstSaveStarted!: () => void;
  const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve; });
  let holdFirstSave = true;
  const requestOrder: string[] = [];
  const links = new Map<string, Record<string, unknown>>();
  const authorizations = new Map<string, Record<string, unknown>>();

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
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/company-entities*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/standard-clauses*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-number-rules", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "rule-1", name: "项目合同编号", pattern: "XM-{SEQ}" }])
  }));
  await page.route("**/api/contract-workbench/version-governed/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-drafts/version-governed/edit-lease**", (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ released: true })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "lease-token-governed",
        leaseRevision: 1,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        heartbeatIntervalMs: 60_000
      })
    });
  });
  await page.route("**/api/contract-drafts/version-governed", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    requestOrder.push("save");
    if (holdFirstSave) {
      holdFirstSave = false;
      markFirstSaveStarted();
      await new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    }
    revision += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-governed",
        draftRevision: revision,
        savedAt: new Date().toISOString(),
        effectiveChangedSections: ["draft"],
        amounts: {
          taxInclusiveAmountCents: "1000000",
          taxExclusiveAmountCents: "884956",
          taxAmountCents: "115044"
        },
        billRevisions: {},
        issueCounts: {},
        readiness: { ready: Boolean(formalFile), blockingMessages: [], warningMessages: [] },
        documentsOutdated: true,
        availableActions: []
      })
    });
  });
  await page.route("**/api/contract-drafts/version-governed/preview-generation", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ queued: true })
    })
  );
  await page.route("**/api/contract-drafts/version-governed/workbench", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      contract: {
        id: "contract-governed",
        temporaryCode: "草稿-20260717-0001",
        code: revision > 3 ? "HT-2026-GOV-001" : null,
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        ownerUserId: "contract-staff-1",
        name: "建材采购合同"
      },
      version: {
        id: "version-governed",
        versionNo: 1,
        status: "draft",
        changeType: "original",
        contractGovernanceVersion: 1,
        draftRevision: revision,
        amountCents: "1000000",
        pricingNature: "fixed_total",
        amountSource: "manual",
        taxFacts: {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          status: "draft",
          source: "contract_document",
          revision: 1,
          frozenAt: null
        },
        draftData: { contractName: "建材采购合同" },
        clauseSnapshot: [],
        templateSnapshot: {
          fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: []
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
        confirmedAt: "2026-07-17T05:00:00.000Z",
        confirmedByUserId: "contract-director-1",
        confirmationRequired: false,
        canConfirm: false
      },
      documents: [{
        id: "document-current",
        purpose: "draft",
        status: "success",
        sourceRevision: revision,
        docxFileId: "docx-current",
        pdfFileId: "pdf-current",
        createdAt: "2026-07-17T06:00:00.000Z",
        completedAt: "2026-07-17T06:01:00.000Z"
      }],
      governance: {
        version: 1,
        authorizationLinks: [...links.values()],
        authorizations: [...authorizations.values()],
        authorizationReuseCandidates: [{
          authorizationId: "authorization-history-first-party",
          sourceContractVersionId: "version-history-1",
          sourceVersionNo: 1,
          sourceVersionStatus: "effective",
          side: "first_party",
          grantorName: "我方公司",
          agentName: "历史代理人",
          scopeSummary: "签署、履行、变更及补充协议",
          contentSha256: "c".repeat(64),
          pageCount: 1,
          fileStatus: "active"
        }],
        formalFiles: formalFile ? [formalFile] : []
      },
      readiness: { ready: Boolean(formalFile), blockingMessages: [], warningMessages: [] }
    })
  }));
  await page.route("**/api/files", async (route) => {
    privateFileCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: `file-${privateFileCalls}`,
        bucket: "private",
        objectKey: `uploads/file-${privateFileCalls}.pdf`,
        originalName: "evidence.pdf",
        mimeType: "application/pdf",
        sizeBytes: 32,
        uploadedByUserId: "contract-staff-1",
        createdAt: new Date().toISOString()
      })
    });
  });
  await page.route("**/api/contracts/version-governed/authorizations", async (route) => {
    authorizationCalls += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const side = String(body.side);
    if (body.required === true && failFirstAuthorizationAssociation) {
      failFirstAuthorizationAssociation = false;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "授权文件已上传，但业务关联暂未完成" })
      });
    }
    revision += 1;
    if (body.required === false) {
      links.set(side, {
        id: `link-${side}`,
        side,
        required: false,
        authorizationId: null,
        reusedFromContractVersionId: null
      });
      authorizations.delete(side);
    } else {
      const upload = body.upload as Record<string, unknown> | undefined;
      const reuse = body.reuse as Record<string, unknown> | undefined;
      const authorizationId = reuse
        ? String(reuse.authorizationId)
        : `authorization-${side}-${authorizationCalls}`;
      links.set(side, {
        id: `link-${side}`,
        side,
        required: true,
        authorizationId,
        reusedFromContractVersionId: null
      });
      authorizations.set(side, {
        id: authorizationId,
        originContractVersionId: reuse ? reuse.sourceContractVersionId : "version-governed",
        side,
        grantorName: upload?.grantorName ?? "我方公司",
        agentName: upload?.agentName ?? reuse?.agentName,
        scopeSummary: upload?.scopeSummary ?? "签署、履行、变更及补充协议",
        fileId: upload?.fileId ?? "file-history",
        contentSha256: reuse ? "c".repeat(64) : "a".repeat(64),
        pageCount: 1,
        status: "active"
      });
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ draftRevision: revision }) });
  });
  await page.route("**/api/contracts/version-governed/formal-files/approval", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (failNextFormalAssociation) {
      failNextFormalAssociation = false;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "审批 PDF 已上传，但业务关联暂未完成" })
      });
    }
    formalFile = {
      id: "formal-1",
      purpose: "approval",
      fileId: body.fileId,
      contentSha256: "b".repeat(64),
      pageCount: 4,
      sourceRevision: body.sourceRevision,
      status: "active",
      declarationSnapshot: body
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(formalFile) });
  });
  await page.route("**/api/contracts/version-governed/readiness", async (route) => {
    requestOrder.push("readiness");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ready: true, blocking: [], warnings: [] })
    });
  });
  await page.route("**/api/contract-drafts/version-governed/submission", async (route) => {
    requestOrder.push("submit");
    approvalSubmissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-governed",
        approvalInstanceId: "approval-governed-1",
        status: "in_approval",
        formalCode: "HT-2026-GOV-001",
        draftRevision: revision,
        firstSubmittedAt: new Date().toISOString()
      })
    });
  });
  await page.route("**/api/contracts/contract-governed", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "contract-governed", title: "建材采购合同", availableActions: [] })
  }));

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/contracts/contract-governed/workbench?versionId=version-governed");
  await page.locator('[data-section-nav-id="basic"]').click();
  await page.getByPlaceholder("请输入合同名称").fill("建材采购合同（送审稿）");
  await page.locator('[data-section-nav-id="attachments"]').click();

  await expect(page.getByText("尚未选择", { exact: true })).toHaveCount(2);
  const units = page.locator(".authorization-unit");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await firstSaveStarted;
  await units.nth(0).getByText("不需要授权委托书", { exact: true }).click();
  expect(requestOrder.filter((item) => item === "save")).toHaveLength(1);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  releaseFirstSave();
  await expect(units.nth(0).getByText("已确认不需要", { exact: true })).toBeVisible();
  await units.nth(1).getByText("不需要授权委托书", { exact: true }).click();
  await expect(page.getByText("已确认不需要", { exact: true })).toHaveCount(2);

  await units.nth(0).getByText("需要授权委托书", { exact: true }).click();
  await units.nth(0).getByPlaceholder("授权人/单位名称").fill("我方公司");
  await units.nth(0).getByPlaceholder("代理人姓名").fill("张三");
  await units.nth(0).locator('input[type="file"]').setInputFiles({
    name: "first-party.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 governed authorization")
  });
  await expect(units.nth(0).getByRole("button", { name: "重试关联" })).toBeVisible();
  expect(privateFileCalls).toBe(1);
  await units.nth(0).getByRole("button", { name: "重试关联" }).click();
  await expect(units.nth(0).getByText("已关联", { exact: true })).toBeVisible();
  expect(privateFileCalls).toBe(1);
  await expect(units.nth(1).getByText("已确认不需要", { exact: true })).toBeVisible();

  await units.nth(0).getByText("不需要授权委托书", { exact: true }).click();
  await units.nth(1).getByText("需要授权委托书", { exact: true }).click();
  await units.nth(1).getByPlaceholder("授权人/单位名称").fill("乙方公司");
  await units.nth(1).getByPlaceholder("代理人姓名").fill("李四");
  await units.nth(1).locator('input[type="file"]').setInputFiles({
    name: "counterparty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 counterparty authorization")
  });
  await expect(units.nth(1).getByText("已关联", { exact: true })).toBeVisible();
  await expect(units.nth(0).getByText("已确认不需要", { exact: true })).toBeVisible();

  const firstPartyRequired = units.nth(0).getByRole("radio", { name: "需要授权委托书", exact: true });
  await expect(firstPartyRequired).toBeEnabled();
  await firstPartyRequired.locator("..").click({ force: true });
  await expect(firstPartyRequired).toBeChecked();
  const reuseHistorical = units.nth(0).getByRole("radio", { name: "复用本合同历史授权", exact: true });
  await expect(reuseHistorical).toBeVisible({ timeout: 5_000 });
  await reuseHistorical.locator("..").click({ force: true });
  await expect(reuseHistorical).toBeChecked();
  await units.nth(0).getByPlaceholder("选择同一合同的历史授权").click();
  await page.getByText("合同 v1 · 历史代理人 · 1 页", { exact: true }).click();
  await units.nth(0).getByRole("button", { name: "确认复用授权" }).click();
  await expect(page.getByText("已关联", { exact: true })).toHaveCount(2);

  const formalSection = page.locator(".formal-section");
  for (const label of [
    "乙方已在合同签署页完成签字",
    "乙方已加盖合同印章",
    "多页文件已按规则加盖骑缝章（单页亦确认）",
    "已确认正文、附件、清单和签署页顺序完整",
    "所需授权委托书已放在最终签署页之前"
  ]) await formalSection.getByText(label, { exact: true }).click();
  const privateFilesBeforeFormal = privateFileCalls;
  await formalSection.locator('input[type="file"]').setInputFiles({
    name: "approval-complete.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 complete approval")
  });
  await expect(formalSection.getByRole("button", { name: "重试关联" })).toBeVisible();
  expect(privateFileCalls).toBe(privateFilesBeforeFormal + 1);
  await formalSection.getByRole("button", { name: "重试关联" }).click();
  expect(privateFileCalls).toBe(privateFilesBeforeFormal + 1);
  await expect(formalSection.getByText("当前有效", { exact: true })).toBeVisible();

  failNextFormalAssociation = true;
  await formalSection.locator('input[type="file"]').setInputFiles({
    name: "approval-retry-drift.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 stale retry")
  });
  await expect(formalSection.getByRole("button", { name: "重试关联" })).toBeVisible();
  await units.nth(0).getByText("不需要授权委托书", { exact: true }).click();
  await expect(formalSection.getByText(/不能将旧 PDF 提升为新修订/u)).toBeVisible();
  await expect(formalSection.getByRole("button", { name: "重试关联" })).toBeDisabled();

  await units.nth(0).getByText("需要授权委托书", { exact: true }).click();
  await units.nth(0).getByText("复用本合同历史授权", { exact: true }).click();
  await units.nth(0).getByPlaceholder("选择同一合同的历史授权").click();
  await page.getByText("合同 v1 · 历史代理人 · 1 页", { exact: true }).click();
  await units.nth(0).getByRole("button", { name: "确认复用授权" }).click();
  await formalSection.locator('input[type="file"]').setInputFiles({
    name: "approval-current.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 current revision")
  });
  await expect(formalSection.getByText("当前有效", { exact: true })).toBeVisible();
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  requestOrder.length = 0;
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click({ force: true }).catch(() => undefined);
  await expect.poll(() => approvalSubmissions).toBe(1);
  expect(requestOrder).toEqual(["readiness", "submit"]);
});

test("手工金额可编辑且小型清单可直接新增行", async ({ page }, testInfo) => {
  const savedDraftBodies: Array<Record<string, unknown>> = [];
  let draftRevision = 4;
  let billRevision = 1;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
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
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/standard-clauses*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/company-entities*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-edit/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-drafts/version-edit/edit-lease**", (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ released: true })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "lease-token-edit",
        leaseRevision: 1,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        heartbeatIntervalMs: 60_000
      })
    });
  });
  await page.route("**/api/contract-drafts/version-edit/preview-generation", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ queued: true })
    })
  );
  await page.route("**/api/contract-drafts/version-edit", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    savedDraftBodies.push(body);
    draftRevision += 1;
    const billRevisions =
      Array.isArray(body.bills) && body.bills.length > 0
        ? { labor: ++billRevision }
        : {};
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-edit",
        draftRevision,
        savedAt: new Date().toISOString(),
        effectiveChangedSections: body.changedSections,
        amounts: {
          taxInclusiveAmountCents: "12345678",
          taxExclusiveAmountCents: "11986000",
          taxAmountCents: "359678"
        },
        billRevisions,
        issueCounts: {},
        readiness: { ready: false, blockingMessages: [], warningMessages: [] },
        documentsOutdated: true,
        availableActions: []
      })
    });
  });
  await page.route("**/api/contract-drafts/version-edit/workbench", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract: {
          id: "contract-edit",
          temporaryCode: "草稿-20260714-0001",
          code: "HT-2026-EDIT-001",
          projectId: "project-1",
          contractTypeKey: "labor_subcontract",
          ownerUserId: "contract-staff-1",
          name: "云谷项目劳务分包合同"
        },
        version: {
          id: "version-edit",
          versionNo: 1,
          status: "draft",
          changeType: "original",
          draftRevision,
          amountCents: "0",
          pricingNature: "fixed_total",
          amountSource: "manual",
          manualAmountCents: "0",
          taxFacts: {
            invoiceType: "vat_special",
            taxMode: "single_rate",
            defaultTaxRatePercent: "3",
            status: "draft",
            source: "contract_document",
            revision: 0,
            frozenAt: null
          },
          draftData: {},
          clauseSnapshot: [],
          templateSnapshot: {
            fieldSchema: [],
            billSchema: [],
            clauseSchema: [],
            attachmentSchema: [],
            validationSchema: []
          }
        },
        parties: [],
        bills: [
          {
            id: "bill-1",
            billKey: "labor",
            name: "劳务分包价格清单",
            revision: billRevision,
            taxInclusiveAmountCents: "0",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            pricingNature: "fixed_total",
            amountLimitType: "capped",
            taxMode: "single_rate",
            defaultTaxRatePercent: "3",
            schemaSnapshot: {
              columns: [{ key: "workContent", label: "工作内容", required: true }]
            },
            rows: []
          }
        ],
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
          confirmedAt: "2026-07-28T00:00:00.000Z",
          confirmedByUserId: "contract-director-1",
          confirmationRequired: false,
          canConfirm: false
        },
        documents: [],
        readiness: { ready: false, blockingMessages: [], warningMessages: [] }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/contracts/contract-edit/workbench?versionId=version-edit");
  await page.locator('[data-section-nav-id="bill_tax"]').click();

  const manualAmount = page.getByPlaceholder("请输入含税合同总价");
  await manualAmount.fill("123456.78");
  await expect(manualAmount).toHaveValue("123456.78");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => savedDraftBodies.length).toBe(1);
  expect(savedDraftBodies[0]?.draft).toMatchObject({
    pricingNature: "fixed_total",
    amountSource: "manual",
    manualAmountCents: "12345678"
  });
  const screenshotDir =
    process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByPlaceholder("选择增值税发票类型")).toHaveValue("增值税专用发票");
    await expect(page.getByPlaceholder("选择常用税率")).toHaveValue("3%");
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `contract-workbench-tax-pricing-${viewport.width}x${viewport.height}.png`
      ),
      fullPage: true
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "放大编辑", exact: true }).click();
  await page.setViewportSize({ width: 430, height: 932 });
  await page.getByTestId("bill-add-row").click();

  const newRow = page.locator(".contract-bill-grid__card").last();
  await newRow.locator('[data-field="itemName"] input').fill("临建围挡");
  await newRow.locator('[data-field="specification"] input').fill("高2.5米");
  await newRow.locator('[data-field="unit"] input').fill("米");
  await newRow.locator('[data-field="quantity"] input').fill("120");
  await newRow.locator('[data-field="unitPrice"] input').fill("85.50");
  await expect(newRow.locator('[data-field="taxRatePercent"] input')).toBeDisabled();
  await expect(newRow.locator('[data-field="taxRatePercent"] input')).toHaveValue(
    "继承合同税率（3%）"
  );
  await newRow.locator('[data-field="workContent"] input').fill("现场制作安装");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();

  await expect.poll(() => savedDraftBodies.length).toBe(2);
  expect(savedDraftBodies[1]?.bills).toMatchObject([
    {
      billKey: "labor",
      expectedRevision: 2,
      rows: [
        {
          itemName: "临建围挡",
          specification: "高2.5米",
          unit: "米",
          quantity: "120",
          unitPrice: "85.50",
          taxRateSource: "version_default",
          customData: { workContent: "现场制作安装" }
        }
      ]
    }
  ]);
  await expect(newRow.locator('[data-field="itemName"] input')).toHaveValue("临建围挡");
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `contract-workbench-bill-row-${viewport.width}x${viewport.height}.png`
      ),
      fullPage: true
    });
  }
});

test("稳定展示固定总价、多税率和无限额框架计价场景", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const loadedVersionIds: string[] = [];
  const workbenches: Record<string, Record<string, unknown>> = {
    "contract-fixed": scenarioWorkbench({
      id: "contract-fixed",
      name: "固定总价咨询合同",
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountCents: "50000000",
      manualAmountCents: "50000000",
      taxMode: "single_rate",
      defaultTaxRatePercent: "6",
      amountLimitType: "capped",
      bills: []
    }),
    "contract-multi": scenarioWorkbench({
      id: "contract-multi",
      name: "多税率材料采购合同",
      pricingNature: "unit_price",
      amountSource: "bill_sum",
      amountCents: "1090000",
      manualAmountCents: null,
      taxMode: "multiple_rate",
      defaultTaxRatePercent: "13",
      amountLimitType: "capped",
      bills: [
        scenarioBill({
          id: "bill-multi",
          taxMode: "multiple_rate",
          defaultTaxRatePercent: "13",
          rows: [
            {
              rowKey: "row-multi",
              sortOrder: 1,
              itemName: "安装服务",
              specification: "现场安装",
              unit: "项",
              quantity: "1",
              unitPrice: "10000.00",
              taxRatePercent: "9",
              taxRateSource: "row_override",
              customData: {}
            }
          ]
        })
      ]
    }),
    "contract-framework": scenarioWorkbench({
      id: "contract-framework",
      name: "机械租赁框架合同",
      pricingNature: "framework",
      amountSource: "bill_sum",
      amountCents: "0",
      manualAmountCents: null,
      taxMode: "single_rate",
      defaultTaxRatePercent: "13",
      amountLimitType: "unlimited",
      bills: [
        scenarioBill({
          id: "bill-framework",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          rows: [
            {
              rowKey: "row-framework",
              sortOrder: 1,
              itemName: "挖掘机租赁",
              specification: "200 型",
              unit: "台班",
              quantity: null,
              unitPrice: "1200.00",
              taxRatePercent: "13",
              taxRateSource: "version_default",
              customData: {}
            }
          ]
        })
      ]
    })
  };

  await page.context().route("**/api/contract-number-rules", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/auth/login", (route) =>
    route.fulfill({
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
    })
  );
  await page.context().route("**/api/me/work-items", (route) =>
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
  await page.context().route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/standard-clauses*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/company-entities*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/contract-workbench/**/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.context().route("**/api/contract-drafts/*/edit-lease**", (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ released: true })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "lease-token-scenario",
        leaseRevision: 1,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        heartbeatIntervalMs: 60_000
      })
    });
  });
  await page.context().route("**/api/contract-drafts/*/workbench", (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const versionId = parts.at(-2) ?? "";
    loadedVersionIds.push(versionId);
    const key = versionId.replace(/^version-/u, "");
    const body = workbenches[key];
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(body ?? { message: "未找到场景" })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  const screenshotDir = process.env.CONTRACT_WORKBENCH_FIX_SCREENSHOT_DIR ?? testInfo.outputDir;

  await page.goto("/contracts/contract-fixed/workbench?versionId=version-contract-fixed");
  await page.locator('[data-section-nav-id="bill_tax"]').click();
  await expect(page.getByPlaceholder("请输入含税合同总价")).toHaveValue("500000.00");
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "contract-workbench-fixed-total-no-bill-1440x900.png"),
    fullPage: true
  });

  const multiPage = await page.context().newPage();
  await multiPage.goto("/login");
  await multiPage.evaluate(() => localStorage.removeItem("jiangkong-web-admin-auth"));
  await multiPage.goto("/login");
  await multiPage.getByPlaceholder("请输入手机号").fill("13900000000");
  await multiPage.getByPlaceholder("请输入密码").fill("E2e@2026");
  await multiPage.getByRole("button", { name: "登录" }).click();
  await multiPage.goto("/contracts/contract-multi/workbench?versionId=version-contract-multi");
  await expect.poll(() => loadedVersionIds.at(-1)).toBe("version-contract-multi");
  await expect(multiPage.getByRole("heading", { name: "多税率材料采购合同" })).toBeVisible();
  await multiPage.locator('[data-section-nav-id="bill_tax"]').click();
  await expect(multiPage.getByPlaceholder("选择计税模式")).toHaveValue("特殊多税率");
  await multiPage.getByRole("button", { name: "放大编辑", exact: true }).click();
  await multiPage.setViewportSize({ width: 430, height: 932 });
  await expect(
    multiPage
      .locator(".contract-bill-grid__card")
      .first()
      .locator('[data-field="taxRatePercent"] input')
  ).toHaveValue("9");
  await expectNoDocumentHorizontalOverflow(multiPage);
  await multiPage.screenshot({
    path: path.join(screenshotDir, "contract-workbench-multiple-rate-430x932.png"),
    fullPage: true
  });

  const frameworkPage = await page.context().newPage();
  await frameworkPage.goto("/login");
  await frameworkPage.evaluate(() => localStorage.removeItem("jiangkong-web-admin-auth"));
  await frameworkPage.goto("/login");
  await frameworkPage.getByPlaceholder("请输入手机号").fill("13900000000");
  await frameworkPage.getByPlaceholder("请输入密码").fill("E2e@2026");
  await frameworkPage.getByRole("button", { name: "登录" }).click();
  await frameworkPage.setViewportSize({ width: 1440, height: 900 });
  await frameworkPage.goto(
    "/contracts/contract-framework/workbench?versionId=version-contract-framework"
  );
  await frameworkPage.locator('[data-section-nav-id="bill_tax"]').click();
  await expect(
    frameworkPage.getByText("不设合同总价；按实际发生量结算", { exact: true })
  ).toBeVisible();
  await frameworkPage.getByRole("button", { name: "放大编辑", exact: true }).click();
  await frameworkPage.setViewportSize({ width: 430, height: 932 });
  await expect(frameworkPage.getByText("上次保存含税合计", { exact: false })).toBeVisible();
  await expect(
    frameworkPage
      .locator(".contract-bill-grid__card")
      .first()
      .locator('[data-field="quantity"] input')
  ).toHaveValue("");
  await expectNoDocumentHorizontalOverflow(frameworkPage);
  await frameworkPage.screenshot({
    path: path.join(screenshotDir, "contract-workbench-unlimited-framework-430x932.png"),
    fullPage: true
  });
});

function scenarioWorkbench(input: {
  id: string;
  name: string;
  pricingNature: string;
  amountSource: string;
  amountCents: string;
  manualAmountCents: string | null;
  taxMode: "single_rate" | "multiple_rate";
  defaultTaxRatePercent: string;
  amountLimitType: "capped" | "unlimited";
  bills: Array<Record<string, unknown>>;
}) {
  return {
    contract: {
      id: input.id,
      temporaryCode: `草稿-${input.id}`,
      code: `HT-${input.id}`,
      projectId: "project-1",
      contractTypeKey: "general_contract",
      ownerUserId: "contract-staff-1",
      name: input.name
    },
    version: {
      id: `version-${input.id}`,
      versionNo: 1,
      status: "draft",
      changeType: "original",
      draftRevision: 1,
      amountCents: input.amountCents,
      pricingNature: input.pricingNature,
      amountSource: input.amountSource,
      manualAmountCents: input.manualAmountCents,
      amountLimitType: input.amountLimitType,
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: input.taxMode,
        defaultTaxRatePercent: input.defaultTaxRatePercent,
        status: "draft",
        source: "contract_document",
        revision: 0,
        frozenAt: null
      },
      draftData: {},
      clauseSnapshot: [],
      templateSnapshot: {
        fieldSchema: [],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: []
      }
    },
    parties: [],
    bills: input.bills,
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
      confirmedAt: "2026-07-28T00:00:00.000Z",
      confirmedByUserId: "contract-director-1",
      confirmationRequired: false,
      canConfirm: false
    },
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] }
  };
}

function scenarioBill(input: {
  id: string;
  taxMode: "single_rate" | "multiple_rate";
  defaultTaxRatePercent: string;
  rows: Array<Record<string, unknown>>;
}) {
  return {
    id: input.id,
    billKey: input.id,
    name: "合同价格清单",
    revision: 1,
    taxInclusiveAmountCents: "0",
    amountRole: "included",
    pricingMode: "tax_inclusive",
    pricingNature: "unit_price",
    amountLimitType: "capped",
    taxMode: input.taxMode,
    defaultTaxRatePercent: input.defaultTaxRatePercent,
    schemaSnapshot: { columns: [] },
    rows: input.rows
  };
}
