import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

// HTTP persistence/file metadata boundary only. The workbench, editor, lease
// consumer and domain API modules are the real application. No backend/DB claim.
const versionId = "version-submit";
const fingerprint = "1".repeat(64);
const sourceSha = "2".repeat(64);
const generatedId = "33333333-3333-4333-8333-333333333333";
const plan = { protocolVersion: 1, layoutTemplateVersionId: "layout-submit", sourceSha256: sourceSha, edits: [] };

async function openWorkbench(page: Page, options: {
  code?: string | null;
  recoveryRevision?: number;
  relationship?: "outside" | "upward";
} = {}) {
  if (options.recoveryRevision !== undefined) {
    await page.addInitScript(({ revision, versionId, plan }) => {
      if (sessionStorage.getItem("task12-recovery-seeded")) return;
      sessionStorage.setItem("task12-recovery-seeded", "yes");
      const deviceId = "recovery-device-submit";
      localStorage.setItem("jg:contract-draft-device:v1", deviceId);
      const identity = { userId: "staff-submit", deviceId, projectId: "project-submit", contractVersionId: versionId, serverRevision: revision };
      const key = ["jg:contract-draft-local-recovery:v1", identity.userId, deviceId, identity.projectId, versionId, String(revision)].map(encodeURIComponent).join(":");
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, identity, savedAt: Date.now(), expiresAt: Date.now() + 86_400_000,
        snapshot: { draft: { contractName: "旧本机合同资料", companyEntityId: "", companyEntitySelection: null, layoutTemplateVersionId: "layout-submit",
          numericProtocolVersion: 2, pricingNature: "unit_price_framework", amountSource: "bill_sum", manualAmountCents: null, manualAmountYuan: null,
          estimatedAmountCents: null, amountAdjustmentReason: "", paymentTermsOriginalText: "按实际约定办理", paymentRatioBps: null, paymentDueDays: null,
          paymentRequiresInvoice: true, paymentAllowsEarlyPayment: false, paymentAllowsInstallments: true, invoiceType: "pending", taxMode: "single_rate",
          defaultTaxRatePercent: null, fieldValues: {}, partyValues: {}, clauses: [], extraDraftData: { contractBasics: { relationship: "inside", businessType: "material_purchase" },
            documentBody: { ...plan, edits: [{ positionId: "delivery", text: "交货地点：旧本机副本" }] } } },
          parties: [], bills: [], paymentTerms: { originalText: "按实际约定办理", stages: [] }, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } } }));
    }, { revision: options.recoveryRevision, versionId, plan });
  }
  const submissions: Record<string, unknown>[] = [];
  const outcome = { loseResponse: false, rejectNext: false, lookup: "unknown", reads: 0, lookupStatus: 200, lookupDrift: "", leaseWrites: 0 };
  const document = { id: generatedId, contractVersionId: versionId, status: "success", sourceRevision: 3,
    layoutTemplateVersionId: "layout-submit", documentContentRevision: 7, documentContentFingerprint: fingerprint,
    docxFileId: "word-submit", pdfFileId: "pdf-submit", inputSnapshot: { documentContentRevision: 7,
      documentContentFingerprint: fingerprint, layoutSourceMapping: { sourceSha256: sourceSha } } };
  const documents = [document];
  const workbench = {
    contract: { id: "contract-submit", code: options.code === undefined ? "HT-20261109-001" : options.code, temporaryCode: null, projectId: "project-submit",
      contractTypeKey: "material_purchase", ownerUserId: "staff-submit", name: "当前正文提交合同" },
    version: { id: versionId, versionNo: 1, status: "draft", numericProtocolVersion: 2, changeType: "original",
      draftRevision: 3, documentContentRevision: 7, documentContentFingerprint: fingerprint,
      layoutTemplateVersionId: "layout-submit", businessTemplateVersionId: "business-submit",
      amountCents: "0", amountYuan: null, amountLimitType: "unlimited", pricingNature: "unit_price_framework", amountSource: "bill_sum",
      taxFacts: { invoiceType: "pending", taxMode: "single_rate", defaultTaxRatePercent: null, status: "draft", source: "contract_document", revision: 0, frozenAt: null },
      draftData: { contractName: "当前正文提交合同", documentBody: plan, contractBasics: { relationship: options.relationship ?? "inside", businessType: "material_purchase" } },
      clauseSnapshot: [], templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] } },
    parties: [], bills: [], paymentTerms: { originalText: "按实际约定办理", stages: [] }, draft: {}, attachments: [], documents: [document],
    lease: { state: "available", holderDisplayName: null, expiresAt: null, canTakeOver: false },
    draftOperationAvailableActions: ["acquire_contract_draft_edit_lease", "heartbeat_contract_draft_edit_lease", "release_contract_draft_edit_lease", "save_contract_draft", "submit_contract_draft", "check_contract_submission_readiness", "queue_contract_document", "queue_contract_draft_preview"],
    settlementMode: { value: "settlement_required", source: "contract_director", confirmedAt: "2026-11-08T01:00:00.000Z", confirmedByUserId: "director", confirmationRequired: false, canConfirm: false },
    readiness: { ready: true, blockingMessages: [], warningMessages: [], blocking: [], warnings: [] }
  };
  await page.route(/^http:\/\/127\.0\.0\.1:54912\/api\//u, async route => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/login") return json({ user: { id: "staff-submit", name: "合同员", phone: "13900000000", mustChangePassword: false, roleKeys: ["contract_staff"], globalRoleKeys: ["contract_staff"] }, tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 900 } });
    if (path === "/me/work-items") return json({ visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } });
    if (path.endsWith("/edit-lease") || path.includes("/edit-lease/")) {
      if (req.method() !== "GET") outcome.leaseWrites++;
      return json(req.method() === "DELETE" ? { released: true } : { token: "synthetic-lease", leaseRevision: 1, expiresAt: new Date(Date.now() + 600_000).toISOString(), heartbeatIntervalMs: 60_000 });
    }
    if (path === `/contract-drafts/${versionId}/workbench`) return json(workbench);
    if (path === `/contract-drafts/${versionId}/document-body`) return json({ contractVersionId: versionId, draftRevision: 3, documentContentRevision: 7, layoutTemplateVersionId: "layout-submit", sourceSha256: sourceSha,
      blocks: [{ id: "delivery", kind: "paragraph", text: "交货地点：【待补充：交货地点】", editable: true, format: { align: "left" }, blankFields: ["交货地点"] }], flow: [{ kind: "paragraph", paragraphId: "delivery" }], paragraphGroups: [["delivery"]], savePoints: [] });
    if (path === `/contract-workbench/${versionId}/documents`) return json(documents);
    if (path === `/contracts/${versionId}/readiness`) return json(workbench.readiness);
    if (path === `/contract-drafts/${versionId}/submission`) {
      submissions.push(req.postDataJSON());
      if (outcome.rejectNext) { outcome.rejectNext = false; return json({ message: "本次明确未提交，请重新核对" }, 409); }
      return json(outcome.loseResponse ? { message: "模拟响应丢失" } : { contractVersionId: versionId, approvalInstanceId: "round-submit", formalCode: "HT-20261109-001", status: "in_approval" }, outcome.loseResponse ? 500 : 201);
    }
    if (path.includes(`/contract-drafts/${versionId}/submission-requests/`)) {
      outcome.reads++;
      if (outcome.lookupStatus !== 200) return json({ message: "模拟查询不可用或无权读取" }, outcome.lookupStatus);
      const saved = submissions[0];
      if (outcome.lookup === "unknown" || !saved || !path.endsWith(String(saved.idempotencyKey))) return json({ status: "unknown" });
      const intent = { expectedRevision: saved.expectedRevision, submissionProtocolVersion: 2, documentContentRevision: saved.documentContentRevision,
        documentContentFingerprint: saved.documentContentFingerprint, generatedDocumentId: saved.generatedDocumentId, sourceSha256: saved.sourceSha256, blanksReviewed: true };
      const requestSha256 = createHash("sha256").update(JSON.stringify({ contractVersionId: versionId, actorUserId: "staff-submit", ...intent })).digest("hex");
      return json({ status: "submitted", intent: outcome.lookupDrift === "intent" ? { ...intent, documentContentFingerprint: "7".repeat(64) } : intent,
        requestSha256: outcome.lookupDrift === "sha" ? "0".repeat(64) : requestSha256,
        result: { contractVersionId: versionId, approvalInstanceId: "round-submit", formalCode: outcome.lookupDrift === "code" ? "HT-OTHER" : "HT-20261109-001", status: "in_approval" } });
    }
    if (req.method() === "GET") return json([]);
    return json({ message: "本前端夹具没有该写入口" }, 404);
  });
  await page.goto("/login?redirect=" + encodeURIComponent(`/合同工作台/contract-submit?versionId=${versionId}`));
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Synthetic@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "当前正文提交合同" }).last()).toBeVisible();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  return { submissions, editor, workbench, document, documents, outcome };
}

test("确认当前正文后，剩余普通空位仍可按真实V2坐标提交", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  const review = page.getByRole("dialog", { name: "检查正文空位", exact: true });
  await expect(review).toContainText("交货地点");
  await review.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect.poll(() => fixture.submissions.length).toBe(1);
  expect(fixture.submissions[0]).toEqual({ expectedRevision: 3, submissionProtocolVersion: 2,
    idempotencyKey: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u), documentContentRevision: 7,
    documentContentFingerprint: fingerprint, generatedDocumentId: generatedId, sourceSha256: sourceSha, blanksReviewed: true });
});

test("提交响应不明时保留原请求，仅原key读回执后恢复", async ({ page }) => {
  const fixture = await openWorkbench(page);
  fixture.outcome.loseResponse = true;
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect.poll(() => fixture.submissions.length).toBe(1);
  await expect(page.getByText("提交结果待核对，请保留当前内容，暂不重复提交。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => fixture.outcome.reads).toBe(1);
  expect(fixture.submissions).toHaveLength(1);
  fixture.outcome.lookup = "submitted";
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.outcome.reads).toBe(2);
});

test("同版重复生成时由合同员明确选择本次Word和PDF记录", async ({ page }) => {
  const fixture = await openWorkbench(page);
  const chosenId = "44444444-4444-4444-8444-444444444444";
  fixture.documents.push({ ...fixture.document, id: chosenId, docxFileId: "word-chosen", pdfFileId: "pdf-chosen" });
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByPlaceholder("选择已核对的Word和PDF").click();
  await page.locator(".t-select__dropdown:visible").getByText("第2份当前Word/PDF", { exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect.poll(() => fixture.submissions.length).toBe(1);
  expect(fixture.submissions[0]).toMatchObject({ generatedDocumentId: chosenId, documentContentRevision: 7, documentContentFingerprint: fingerprint });
});

test("确认弹窗打开后F变化不能沿旧正文检查提交", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认提交审批", exact: true })).toBeVisible();
  fixture.workbench.version.documentContentFingerprint = "9".repeat(64);
  fixture.document.documentContentFingerprint = "9".repeat(64);
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByText("请在合同正文检查当前保存版本的空位；确认后可继续，未填写空位不必强行补齐。", { exact: true })).toBeVisible();
  expect(fixture.submissions).toEqual([]);
});

test("确认后再改普通条款会撤销旧检查并就近提示而不提交", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await fixture.editor.getByRole("textbox", { name: "编辑普通条款1", exact: true }).fill("交货地点：新约定");
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.getByText("请先检查当前保存版本的正文空位；确认后可继续，未填写空位不必强行补齐。", { exact: true })).toBeVisible();
  expect(fixture.submissions).toEqual([]);
});

test("取消正文检查保持原空位且零提交", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "返回检查", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.getByText("请先检查当前保存版本的正文空位；确认后可继续，未填写空位不必强行补齐。", { exact: true })).toBeVisible();
  await expect(fixture.editor.getByRole("textbox", { name: "编辑普通条款1", exact: true })).toHaveValue("交货地点：【待补充：交货地点】");
  expect(fixture.submissions).toEqual([]);
});

test("明确拒绝后的同一提交意图保留相同key与完整payload", async ({ page }) => {
  const fixture = await openWorkbench(page);
  fixture.outcome.rejectNext = true;
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByText("本次明确未提交，请重新核对", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect.poll(() => fixture.submissions.length).toBe(2);
  expect(fixture.submissions[1]).toEqual(fixture.submissions[0]);
});

test("确认后服务端模板变化拒绝旧正文和旧文件选择", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认提交审批", exact: true })).toBeVisible();
  fixture.workbench.version.layoutTemplateVersionId = "layout-replaced";
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByText("请在合同正文检查当前保存版本的空位；确认后可继续，未填写空位不必强行补齐。", { exact: true })).toBeVisible();
  expect(fixture.submissions).toEqual([]);
});

test("结果不明刷新后沿原key核旧轮，不拿当前修订重算提交", async ({ page }) => {
  const fixture = await openWorkbench(page);
  fixture.outcome.loseResponse = true;
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  fixture.workbench.version.draftRevision = 4;
  fixture.workbench.version.documentContentRevision = 8;
  fixture.workbench.version.documentContentFingerprint = "8".repeat(64);
  fixture.outcome.lookup = "submitted";
  await page.reload();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.submissions[0]).toMatchObject({ expectedRevision: 3, documentContentRevision: 7, documentContentFingerprint: fingerprint });
  expect(fixture.outcome.reads).toBe(1);
});

for (const [relationship, label] of [["outside", "表外"], ["upward", "对上"]] as const) {
  test(`${label}生成合同提交响应不明时只按原键核对并进入合同详情`, async ({ page }) => {
    const fixture = await openWorkbench(page, { relationship });
    fixture.outcome.loseResponse = true;
    fixture.outcome.lookup = "submitted";
    await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
    await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
    await page.getByRole("button", { name: "提交审批", exact: true }).click();
    await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
    const check = page.getByRole("button", { name: "核对提交结果", exact: true });
    await expect(check).toBeVisible();
    expect(fixture.submissions).toEqual([{
      expectedRevision: 3, submissionProtocolVersion: 2,
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u), documentContentRevision: 7,
      documentContentFingerprint: fingerprint, generatedDocumentId: generatedId, sourceSha256: sourceSha, blanksReviewed: true
    }]);
    await check.click();
    await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
    expect(fixture.outcome.reads).toBe(1);
    expect(fixture.submissions).toHaveLength(1);
  });
}

test("错intent摘要编号及失权查询均不能清除原提交意图", async ({ page }) => {
  const fixture = await openWorkbench(page);
  fixture.outcome.loseResponse = true;
  fixture.outcome.lookup = "submitted";
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  const check = page.getByRole("button", { name: "核对提交结果", exact: true });
  for (const [index, drift] of ["intent", "sha", "403", "500", "code"].entries()) {
    fixture.outcome.lookupDrift = drift;
    fixture.outcome.lookupStatus = drift === "403" ? 403 : drift === "500" ? 500 : 200;
    await check.click();
    await expect.poll(() => fixture.outcome.reads).toBe(index + 1);
    await expect(check).toBeVisible();
    expect(fixture.submissions).toHaveLength(1);
  }
  fixture.outcome.lookupDrift = ""; fixture.outcome.lookupStatus = 200;
  await check.click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  expect(fixture.submissions).toHaveLength(1);
});

test("fresh能力收回后不发送已打开弹窗的提交", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认提交审批", exact: true })).toBeVisible();
  fixture.workbench.draftOperationAvailableActions = fixture.workbench.draftOperationAvailableActions.filter(action => action !== "submit_contract_draft");
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByText("当前用户不能提交合同草稿", { exact: true })).toBeVisible();
  expect(fixture.submissions).toEqual([]);
});

test("生成列表中的旧修订异F和缺WordPDF配对都不是本次提交来源", async ({ page }) => {
  const fixture = await openWorkbench(page);
  fixture.documents.unshift(
    { ...fixture.document, id: "55555555-5555-4555-8555-555555555555", sourceRevision: 2 },
    { ...fixture.document, id: "66666666-6666-4666-8666-666666666666", documentContentFingerprint: "6".repeat(64) },
    { ...fixture.document, id: "77777777-7777-4777-8777-777777777777", pdfFileId: "word-submit" }
  );
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect.poll(() => fixture.submissions.length).toBe(1);
  expect(fixture.submissions[0]).toMatchObject({ generatedDocumentId: generatedId, expectedRevision: 3, documentContentFingerprint: fingerprint });
});

test("确认后正文修订变化必须重新检查当前版本", async ({ page }) => {
  const fixture = await openWorkbench(page);
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认提交审批", exact: true })).toBeVisible();
  fixture.workbench.version.documentContentRevision = 8;
  fixture.document.documentContentRevision = 8;
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByText("请在合同正文检查当前保存版本的空位；确认后可继续，未填写空位不必强行补齐。", { exact: true })).toBeVisible();
  expect(fixture.submissions).toEqual([]);
});

test("提交结果不明时也暂停结束草稿等其它写动作", async ({ page }) => {
  const fixture = await openWorkbench(page);
  fixture.outcome.loseResponse = true;
  Object.assign(fixture.workbench, { availableActions: [{ key: "abandon_application", label: "结束申请", enabled: true,
    kind: "danger", disabledReason: null }] });
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  await expect(page.locator(".contract-draft-lifecycle-buttons")).toBeHidden();
  expect(fixture.submissions).toHaveLength(1);
});

test("不明结果期间及原key恢复只读，不自动续租或释放租约", async ({ page }) => {
  await page.clock.install();
  const fixture = await openWorkbench(page);
  fixture.outcome.loseResponse = true; fixture.outcome.lookup = "submitted";
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  const originalLeaseWrites = fixture.outcome.leaseWrites;
  await page.clock.fastForward(65_000);
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(fixture.outcome.leaseWrites).toBe(originalLeaseWrites);
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(fixture.outcome.leaseWrites).toBe(originalLeaseWrites);
  expect(fixture.submissions).toHaveLength(1);
});

test("初始无正式编号时允许原提交回执返回真实新编号", async ({ page }) => {
  const fixture = await openWorkbench(page, { code: null });
  fixture.outcome.loseResponse = true; fixture.outcome.lookup = "submitted";
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  expect(Object.hasOwn(fixture.submissions[0], "formalCode")).toBe(false);
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.outcome.reads).toBe(1);
});


test("UNKNOWN保留旧本机副本但禁止恢复改输入", async ({ page }) => {
  const fixture = await openWorkbench(page, { recoveryRevision: 2 });
  const restore = page.getByRole("button", { name: "恢复本机副本", exact: true });
  await expect(restore).toBeEnabled();
  const backupBefore = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg%3Acontract-draft-local-recovery")));
  fixture.outcome.loseResponse = true;
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  const requestBefore = await page.evaluate(() => localStorage.getItem("jg:contract-submission:staff-submit:version-submit"));
  const leaseWrites = fixture.outcome.leaseWrites;
  if (await restore.isEnabled()) await restore.click();
  else if (test.info().project.name === "mobile") await restore.tap({ force: true });
  else await restore.click({ force: true });
  await expect(fixture.editor.getByRole("textbox", { name: "编辑普通条款1", exact: true })).toHaveValue("交货地点：【待补充：交货地点】");
  await expect(restore).toBeDisabled();
  await expect(page.getByRole("button", { name: "放弃本机副本", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg%3Acontract-draft-local-recovery")))).toEqual(backupBefore);
  expect(await page.evaluate(() => localStorage.getItem("jg:contract-submission:staff-submit:version-submit"))).toBe(requestBefore);
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.outcome.leaseWrites).toBe(leaseWrites);
  fixture.outcome.lookup = "submitted";
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  expect(fixture.submissions).toHaveLength(1);
});


test("UNKNOWN刷新不自动应用同修订本机副本", async ({ page }) => {
  const fixture = await openWorkbench(page, { recoveryRevision: 2 });
  fixture.outcome.loseResponse = true;
  await fixture.editor.getByRole("button", { name: "检查正文空位", exact: true }).click();
  await page.getByRole("button", { name: "已检查，继续", exact: true }).click();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  // Existing client-persistence boundary: a legitimate same-revision copy would
  // ordinarily auto-apply on load, but must remain unapplied while UNKNOWN.
  const backupBefore = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith("jg%3Acontract-draft-local-recovery"));
    if (!entry) throw new Error("Expected retained old local copy");
    const [oldKey, raw] = entry;
    const record = JSON.parse(raw); record.identity.serverRevision = 3;
    const key = oldKey.replace(/:2$/u, ":3");
    localStorage.removeItem(oldKey); localStorage.setItem(key, JSON.stringify(record));
    return [[key, JSON.stringify(record)]];
  });
  const requestBefore = await page.evaluate(() => localStorage.getItem("jg:contract-submission:staff-submit:version-submit"));
  const leaseWrites = fixture.outcome.leaseWrites;
  await page.reload();
  await expect(page.getByRole("button", { name: "核对提交结果", exact: true })).toBeVisible();
  await page.getByText("合同正文", { exact: true }).click();
  await expect(fixture.editor.getByRole("textbox", { name: "编辑普通条款1", exact: true })).toHaveValue("交货地点：【待补充：交货地点】");
  await expect(page.getByRole("button", { name: "恢复本机副本", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg%3Acontract-draft-local-recovery")))).toEqual(backupBefore);
  expect(await page.evaluate(() => localStorage.getItem("jg:contract-submission:staff-submit:version-submit"))).toBe(requestBefore);
  expect(fixture.submissions).toHaveLength(1);
  expect(fixture.outcome.leaseWrites).toBe(leaseWrites);
  fixture.outcome.lookup = "submitted";
  await page.getByRole("button", { name: "核对提交结果", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/合同管理/contract-submit");
  expect(fixture.submissions).toHaveLength(1);
});
