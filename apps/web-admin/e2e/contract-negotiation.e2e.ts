import { expect, test } from "@playwright/test";

test("合同磋商在中央画布逐差异处置并安全打开修订 PDF", async ({ page }, testInfo) => {
  let disposition: "pending" | "rejected" = "pending";
  let roundStatus: "open" | "closed" = "open";
  let ticketBody: Record<string, unknown> | null = null;
  let closeCalls = 0;

  const rounds = () => [
    {
      id: "round-1",
      roundNo: 1,
      status: roundStatus,
      sourceRevision: 3,
      note: "与业主核对商务条款",
      openedAt: "2026-07-12T08:00:00.000Z",
      closedAt: null,
      revisions: [
        {
          id: "revision-1",
          label: "业主第一轮修订稿",
          note: "线下沟通后回传",
          status: "succeeded",
          hasPreviewPdf: true,
          errorMessage: null,
          createdAt: "2026-07-12T09:00:00.000Z",
          completedAt: "2026-07-12T09:01:00.000Z",
          comparison: {
            id: "comparison-1",
            status: "succeeded",
            algorithmVersion: "contract-docx-patience-v1",
            errorMessage: null,
            completedAt: "2026-07-12T09:01:00.000Z",
            differences: [
              {
                id: "difference-1",
                sortOrder: 1,
                changeType: "replace",
                kind: "paragraph",
                locationPath: "正文/合同金额",
                basePath: "p3",
                revisedPath: "p3",
                beforeText: "合同金额：1,000,000.00元",
                afterText: "合同金额：1,200,000.00元",
                candidate: { kind: "amount", label: "合同金额", cents: "120000000" },
                disposition,
                dispositionReason: disposition === "rejected" ? "双方未达成金额变更共识" : null,
                disposedAt: disposition === "rejected" ? "2026-07-12T10:00:00.000Z" : null
              }
            ]
          }
        }
      ]
    }
  ];

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
          pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
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
  await page.route("**/api/contract-workbench/version-1/negotiation-rounds", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(rounds()) });
  });
  await page.route("**/api/contract-document-differences/difference-1/disposition", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      disposition: "rejected",
      reason: "双方未达成金额变更共识"
    });
    disposition = "rejected";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "difference-1", disposition, dispositionReason: "双方未达成金额变更共识" })
    });
  });
  await page.route("**/api/contract-offline-revisions/revision-1/preview-download-ticket", async (route) => {
    ticketBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        fileName: "业主第一轮修订稿.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        expiresAt: "2026-07-12T10:05:00.000Z",
        downloadUrl: "/files/download-tickets/revision-preview-ticket"
      })
    });
  });
  await page.route("**/api/files/download-tickets/revision-preview-ticket", (route) =>
    route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4" })
  );
  await page.route("**/api/contract-negotiation-rounds/round-1/close", (route) => {
    closeCalls += 1;
    roundStatus = "closed";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "round-1", status: "closed" }) });
  });
  await page.route("**/api/contract-workbench/contract-1", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract: {
          id: "contract-1", temporaryCode: "草稿-20260712-0001", code: null,
          projectId: "project-1", contractTypeKey: "material_purchase",
          ownerUserId: "contract-staff-1", name: "科技园钢材采购合同"
        },
        version: {
          id: "version-1", versionNo: 1, status: "draft", draftRevision: 3,
          amountCents: "100000000", pricingNature: "fixed_total", amountSource: "bill_sum",
          draftData: {}, clauseSnapshot: [],
          templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] }
        },
        parties: [], bills: [], paymentTerms: { originalText: "", stages: [] }, checkpoints: [],
        documents: [{
          id: "document-current", purpose: "draft", status: "success", sourceRevision: 3,
          docxFileId: "docx-current", pdfFileId: "pdf-current",
          createdAt: "2026-07-12T06:00:00.000Z", completedAt: "2026-07-12T06:01:00.000Z"
        }],
        readiness:
          roundStatus === "closed"
            ? { ready: true, blocking: [], blockingMessages: [], warningMessages: [] }
            : {
                ready: false,
                blocking: [
                  disposition === "pending"
                    ? { key: "negotiation.pending_difference", section: "documents", message: "仍有待处理的合同文档差异" }
                    : { key: "negotiation.open_round", section: "documents", message: "仍有开放的合同磋商轮次" }
                ],
                blockingMessages: [
                  disposition === "pending" ? "仍有待处理的合同文档差异" : "仍有开放的合同磋商轮次"
                ],
                warningMessages: []
              }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/contracts/contract-1/workbench");
  await page.getByRole("button", { name: "安全打开正文" }).click();

  await expect(page.getByRole("heading", { name: "合同磋商差异画布" })).toBeVisible();
  await expect(page.getByText("第 1 轮", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("仍有待处理的合同文档差异", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("只读结构候选：合同金额：¥1,200,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("应用到合同", { exact: true })).toHaveCount(0);
  await expect(page.getByText("difference-1", { exact: true })).toHaveCount(0);

  const desktopCanvas = await page.locator(".document-canvas-slot").boundingBox();
  const desktopSidebar = await page.locator(".business-sidebar").boundingBox();
  expect(desktopCanvas!.x).toBeLessThan(desktopSidebar!.x);
  await page.screenshot({ path: testInfo.outputPath("contract-negotiation-1440.png"), fullPage: true });

  await page.getByRole("button", { name: "安全打开修订 PDF" }).click();
  await page.getByPlaceholder("请输入当前登录密码").fill("current-password");
  await page.getByPlaceholder("请填写查看修订 PDF 的业务原因").fill("复核本轮磋商差异");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "创建审计下载票据" }).click();
  const popup = await popupPromise;
  expect(popup).toBeTruthy();
  expect(ticketBody).toEqual({
    confirmationPassword: "current-password",
    downloadReason: "复核本轮磋商差异"
  });
  await popup.close();

  await page.getByRole("button", { name: "安全打开修订 PDF" }).click();
  await expect(page.getByPlaceholder("请输入当前登录密码")).toHaveValue("");
  await expect(page.getByPlaceholder("请填写查看修订 PDF 的业务原因")).toHaveValue("");
  await page.getByRole("button", { name: "取消" }).click();

  await page.getByText("不采纳", { exact: true }).click();
  await page.getByPlaceholder("不采纳或无实质变化时必须填写原因").fill("双方未达成金额变更共识");
  await page.getByRole("button", { name: "提交本条处置" }).click();
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("不采纳", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "关闭本轮" }).click();
  await page.getByRole("button", { name: "确定" }).click();
  expect(closeCalls).toBe(1);
  await expect(page.getByText("已关闭", { exact: true }).last()).toBeVisible();

  await page.setViewportSize({ width: 1100, height: 800 });
  const compactCanvas = await page.locator(".document-canvas-slot").boundingBox();
  const compactSidebar = await page.locator(".business-sidebar").boundingBox();
  expect(compactSidebar!.y).toBeGreaterThan(compactCanvas!.y);
  await page.screenshot({ path: testInfo.outputPath("contract-negotiation-1100.png"), fullPage: true });
});
