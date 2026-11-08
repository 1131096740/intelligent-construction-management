import type { Page } from "@playwright/test";
import { expect, test, expectMockHttpFailure } from "./helpers/task12-transport";
import type { fetchRelatedApprovals } from "../src/api/approval-progress.api";
import type { approvalDocumentCapability } from "../src/api/approval-forms.api";
import type { ArchiveListReadModel } from "../src/api/core-flow-read.api";
import { createHash } from "node:crypto";
import type { ContractDetailReadModel, ContractV2LifecycleReadModel } from "@jiangkong/shared-domain";
const V = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";
const F = "a".repeat(64);
const CODE = "HT-20261109-019";

async function openDetail(page: Page, options: { archive?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const actor = options.archive ? "staff-archive" : "director-seal";
  const archives: Record<string, unknown>[] = [];
  const uploads: string[] = [];
  const uploadNames: string[] = [];
  const uploadKeys = new Map<string, string>();
  const uploadedFiles = new Map<string, { name: string; bytes: Buffer }>();
  const outcome = { sealMode: "persist", archiveMode: "persist", lookupStatus: 200, lookupDrift: "", reads: 0, failUploadNameOnce: "", detailStatus: 200, detailFailureAfterReceipt: false, holdLookup: false, holdFirstUpload: false, approvalDocumentAvailable: false };
  let releaseLookup: (() => void) | undefined;
  let releaseUpload: (() => void) | undefined;
  let durable: Record<string, unknown> | null = null;
  const viewer = { id: actor, role: options.archive ? "contract_staff" : "comprehensive_director" };
  const tickets: Array<{ fileId: string; body: unknown }> = [];
  const downloadBodies = new Map<string, Buffer>();
  const fileIds = ["44444444-4444-4444-8444-444444444441", "44444444-4444-4444-8444-444444444442"];
  const archiveId = "55555555-5555-4555-8555-555555555555";
  const context: Extract<ContractV2LifecycleReadModel, { status: "ready" }> = {
    protocolVersion: 2, status: "ready", source: "generated_approval", scope: "inside_original",
    contractVersionId: V, actorUserId: actor, approvalInstanceId: R, sealTaskId: T,
    documentContentRevision: 7, documentContentFingerprint: F, webWriteReleased: true,
    state: options.archive ? "pending_archive" : "pending_seal", sealAction: { key: "confirm_seal_v2", eligible: true, enabled: true, reason: null },
    archiveAction: { key: "archive_signed_v2", eligible: false, enabled: false, reason: "当前不处于待归档阶段" },
    sealOutcome: { status: options.archive ? "completed" : "pending", completedAt: options.archive ? "2026-11-09T01:00:00.000Z" : null, completedByUserId: options.archive ? "director-seal" : null },
    approvalSource: { status: "references_ready" }, signedFilePolicy: { mimeType: "application/pdf", minCount: 1, maxCount: 20, ordered: true }
  };
  if (options.archive) { context.sealAction.eligible = false; context.sealAction.enabled = false; context.archiveAction.eligible = true; context.archiveAction.enabled = true; }
  const detail: ContractDetailReadModel = { id: CODE, contractVersionId: V, title: CODE + " · 当前签章合同", meta: [{ label: "当前状态", value: options.archive ? "待签章归档" : "待确认已盖章", tone: "warning" }],
    baseInfo: [], effectivenessSteps: [], paymentTermStages: [], settlementBlockMessage: "合同尚未生效",
    settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" }, archiveFiles: [], formalFiles: [],
    sealTask: { id: T, status: options.archive ? "completed" : "in_seal", handlerUserId: "staff-archive", approvedByUserId: "system", approvedAt: "2026-11-09T00:00:00.000Z", completedByUserId: options.archive ? "director-seal" : null, completedAt: options.archive ? "2026-11-09T01:00:00.000Z" : null },
    approvalTimeline: [], availableActions: [], availableActionKeys: [], primaryAction: null, disabledReasons: [], chainLinks: [], changeVersions: [], v2Lifecycle: context,
    documentContentRevision: 7, documentContentFingerprint: F, reviewApprovalContext: null, withdrawApprovalContext: null };
  await page.context().route(/^http:\/\/127\.0\.0\.1:54913\/api\//u, async route => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    const deliberateFault = (value: unknown, status: number) => {
      expectMockHttpFailure(page.context(), req.url(), status);
      return json(value, status);
    };
    if (path === "/auth/login") return json({ user: { id: actor, name: options.archive ? "合同员" : "综合主管", phone: "13900000000", mustChangePassword: false, roleKeys: [options.archive ? "contract_staff" : "comprehensive_director"], globalRoleKeys: [options.archive ? "contract_staff" : "comprehensive_director"] }, tokens: { accessToken: "synthetic", refreshToken: "synthetic", expiresIn: 900 } });
    if (path === "/me/work-items") return json({ visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } });
    if (path === `/contracts/${CODE}`) { context.actorUserId = viewer.id; return outcome.detailStatus === 200 ? json(detail) : deliberateFault({ message: "模拟详情暂不可读" }, outcome.detailStatus); }
    if (path === "/archives") return json({ summary: { total: detail.archiveFiles.length, contractArchives: detail.archiveFiles.length, settlementArchives: 0, paymentFiles: 0, pending: 0 }, rows: detail.archiveFiles.map((file, index) => ({
      id: file.evidenceId ?? file.archiveRecordId, documentNo: `${CODE} 原件${index + 1}`, fileId: file.fileId, documentType: "合同归档", businessRef: CODE,
      project: "模拟项目", fileSource: file.fileName, fileSizeBytes: file.sizeBytes, canDownload: true, disabledReason: null,
      archiveStatus: "已归档", statusTone: "success", uploadDepartment: "合同部", confirmedBy: "合同员", lastAction: "签章归档"
    })) } satisfies ArchiveListReadModel);
    if (path === `/contracts/${V}/seal-confirmation`) {
      writes.push(req.postDataJSON());
      if (outcome.sealMode === "no_persist") return deliberateFault({ message: "模拟盖章结果暂不明" }, 503);
      context.state = "pending_archive"; detail.meta = [{ label: "当前状态", value: "待签章归档", tone: "warning" }];
      context.sealOutcome = { status: "completed", completedAt: "2026-11-09T01:00:00.000Z", completedByUserId: actor };
      return json({ contractVersionId: V, approvalInstanceId: R, sealTaskId: T, status: "seal_approved_pending_archive" }, 201);
    }
    if (path === "/files") {
      const form = await new Request(req.url(), { method: "POST", headers: req.headers(), body: new Uint8Array(req.postDataBuffer() ?? []) }).formData();
      const file = form.get("file"); if (!file || typeof file === "string") return json({ message: "缺少模拟文件" }, 400);
      const key = String(form.get("idempotencyKey")); uploads.push(String(file.size)); uploadNames.push(file.name);
      if (outcome.failUploadNameOnce === file.name) { outcome.failUploadNameOnce = ""; return deliberateFault({ message: "模拟上传中断" }, 503); }
      if (outcome.holdFirstUpload && uploads.length === 1) await new Promise<void>(resolve => { releaseUpload = resolve; });
      let fileId = uploadKeys.get(key);
      if (!fileId) {
        const index = uploadedFiles.size;
        fileId = fileIds[index] ?? `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`;
        if (!fileIds[index]) fileIds.push(fileId);
        uploadKeys.set(key, fileId); uploadedFiles.set(fileId, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
      }
      return json({ id: fileId, originalName: file.name, mimeType: "application/pdf", sizeBytes: file.size }, 201);
    }
    if (path === `/contracts/${V}/signed-archive`) {
      const body = req.postDataJSON() as Record<string, unknown>; archives.push(body);
      if (outcome.archiveMode === "no_persist") return deliberateFault({ message: "模拟结果暂不明" }, 503);
      if (outcome.archiveMode === "busy") return deliberateFault({ message: "文件绑定正在办理", code: "CONTRACT_ARCHIVE_BINDING_BUSY", attemptOutcome: "not_applied" }, 409);
      durable = body; context.state = "archived"; detail.meta = [{ label: "当前状态", value: "已归档生效", tone: "success" }];
      context.archiveAction.eligible = false; context.archiveAction.enabled = false;
      detail.availableActions = [{ key: "download_archive", label: "下载归档原件", kind: "normal", enabled: true, disabledReason: null }];
      detail.availableActionKeys = ["download_archive"];
      detail.archiveFiles = (body.fileIds as string[]).map((fileId, index) => ({ archiveRecordId: archiveId, archiveProtocolVersion: 2, evidenceId: `evidence-${index}`, displayOrder: index,
        fileId, fileName: uploadedFiles.get(fileId)!.name, mimeType: "application/pdf", sizeBytes: uploadedFiles.get(fileId)!.bytes.length,
        status: "confirmed", statusLabel: "已归档", uploadedByName: "合同员", createdAt: "2026-11-09T02:00:00.000Z", confirmedByName: "合同员", confirmedAt: "2026-11-09T02:00:00.000Z", canDownload: true, disabledReason: null }));
      if (outcome.archiveMode === "persist_lost") return deliberateFault({ message: "模拟已提交但响应丢失" }, 500);
      return json({ archiveId, contractVersionId: V, status: "effective", fileIds: body.fileIds }, 201);
    }
    if (path.startsWith(`/contracts/${V}/archive-requests/`)) {
      outcome.reads++;
      if (outcome.holdLookup) await new Promise<void>(resolve => { releaseLookup = resolve; });
      if (outcome.lookupStatus !== 200) return deliberateFault({ message: "模拟查询暂不可用" }, outcome.lookupStatus);
      const body = durable;
      if (!body || !path.endsWith(String(body.idempotencyKey))) return json({ status: "unknown" });
      const requestSha256 = createHash("sha256").update(JSON.stringify({ versionId: V, actor,
        archiveProtocolVersion: body.archiveProtocolVersion, archiveSource: body.archiveSource, idempotencyKey: body.idempotencyKey,
        expectedApprovalInstanceId: body.expectedApprovalInstanceId, expectedSealTaskId: body.expectedSealTaskId,
        documentContentRevision: body.documentContentRevision, documentContentFingerprint: body.documentContentFingerprint,
        fileIds: body.fileIds, confirmedMatchingSignedDocument: body.confirmedMatchingSignedDocument })).digest("hex");
      const intent = { ...body }, result = { archiveId, contractVersionId: V, status: "effective", fileIds: body.fileIds };
      if (outcome.lookupDrift === "intent") intent.documentContentFingerprint = "b".repeat(64);
      if (outcome.lookupDrift === "key") intent.idempotencyKey = "66666666-6666-4666-8666-666666666666";
      if (outcome.lookupDrift === "order") { intent.fileIds = [...body.fileIds as string[]].reverse(); result.fileIds = intent.fileIds; }
      if (outcome.lookupDrift === "version") result.contractVersionId = "77777777-7777-4777-8777-777777777777";
      if (outcome.detailFailureAfterReceipt) outcome.detailStatus = 503;
      return json({ status: "archived", requestSha256: outcome.lookupDrift === "sha" ? "0".repeat(64) : requestSha256, intent, result });
    }
    const fileIndex = fileIds.findIndex(id => path.startsWith(`/files/${id}/`));
    if (fileIndex >= 0 && path.endsWith("/download-ticket-capability")) return json({ availableActions: ["create_private_file_download_ticket"], action: { key: "create_private_file_download_ticket", enabled: true } });
    if (fileIndex >= 0 && path.endsWith("/download-ticket")) {
      tickets.push({ fileId: fileIds[fileIndex], body: req.postDataJSON() });
      return json({ downloadUrl: `/files/${fileIds[fileIndex]}/download?ticket=synthetic`, fileName: fileIndex === 0 ? "双方签章正文.pdf" : "双方签章附件.pdf" });
    }
    if (fileIndex >= 0 && path.endsWith("/download")) {
      const bytes = uploadedFiles.get(fileIds[fileIndex])!.bytes; downloadBodies.set(fileIds[fileIndex], bytes);
      return route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": `attachment; filename="signed-${fileIndex}.pdf"` }, body: bytes });
    }
    if (req.method() === "GET" && path === "/approval-delegations/user-options") return json([]);
    if (req.method() === "GET" && path === "/approval-progress") return json({ items: [], nextCursor: null } satisfies Awaited<ReturnType<typeof fetchRelatedApprovals>>);
    if (req.method() === "GET" && path === `/approval-forms/contract_seal/${T}/capability`) return json({ available: outcome.approvalDocumentAvailable } satisfies Awaited<ReturnType<typeof approvalDocumentCapability>>);
    if (req.method() === "GET" && [`/contracts/${V}/change-eligibility`, "/contracts/99999999-9999-4999-8999-999999999999/change-eligibility"].includes(path)) return json({ eligible: false, reason: "模拟未开放变更", currentEffective: null, activeChange: null });
    return route.fallback();
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Synthetic@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作台", exact: true })).toBeVisible();
  await page.goto(`/contracts/${CODE}`);
  await expect(page.getByRole("heading", { name: /当前签章合同/u }).first()).toBeVisible();
  await expectHealthyProgress(page);
  return { writes, detail, context, archives, uploads, uploadNames, uploadedFiles, fileIds, outcome, viewer, tickets, downloadBodies, releaseLookup: () => releaseLookup?.(), releaseUpload: () => releaseUpload?.() };
}

async function expectHealthyProgress(page: Page) {
  const progress = page.getByRole("region", { name: "完整审批进度", exact: true });
  await expect(progress.getByText("暂无已提交且与你相关的审批流程。", { exact: true })).toBeVisible();
  await expect(progress.locator(".t-alert")).toHaveCount(0);
}

test("综合主管按当前真实轮次确认已盖章", async ({ page }, testInfo) => {
  const state = await openDetail(page);
  await expectHealthyProgress(page);
  await page.locator(".contract-v2-signing").scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("simulated-seal-section.png") });
  await page.getByRole("button", { name: "确认已盖章", exact: true }).click();
  await expect(page.getByText("请确认我方线下盖章已经完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认办理", exact: true })).toBeInViewport();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("simulated-seal-dialog.png") });
  await page.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect.poll(() => state.writes).toEqual([{ expectedApprovalInstanceId: R, expectedSealTaskId: T, documentContentRevision: 7, documentContentFingerprint: F, confirmed: true }]);
  await expect(page.getByText("已核对盖章完成结果", { exact: true })).toBeVisible();
});


test("合同员按原轮次上传两份有序签章PDF直接归档", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles([
    { name: "双方签章正文.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 signed main") },
    { name: "双方签章附件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 signed annex") }
  ]);
  await expect(page.getByText("双方签章正文.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
  await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
  await page.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect.poll(() => state.archives.length).toBe(1);
  expect(state.archives[0]).toEqual({ archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    expectedApprovalInstanceId: R, expectedSealTaskId: T, documentContentRevision: 7, documentContentFingerprint: F, fileIds: state.fileIds, confirmedMatchingSignedDocument: true });
  expect(state.uploads).toHaveLength(2);
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
});


async function selectAndArchive(page: Page) {
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles([
    { name: "双方签章正文.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 signed main") },
    { name: "双方签章附件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 signed annex") }
  ]);
  await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
  await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
  await page.getByRole("button", { name: "确认归档", exact: true }).click();
}

test("归档UNKNOWN刷新只查原结果，人工继续仍用原key和文件顺序", async ({ page }, testInfo) => {
  const state = await openDetail(page, { archive: true });
  state.outcome.archiveMode = "no_persist";
  await selectAndArchive(page);
  await expect(page.getByText("归档结果待核对，请保留原请求；可查询或按原请求继续", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1);
  await expectHealthyProgress(page);
  await page.locator(".contract-v2-signing").scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("simulated-two-files-unknown.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const original = structuredClone(state.archives[0]);
  await expect(page.getByLabel("选择双方签章PDF", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("归档结果待核对，请保留本次原请求并查询结果", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1);
  await page.getByRole("button", { name: "查询本次归档结果", exact: true }).click();
  await expect.poll(() => state.outcome.reads).toBeGreaterThan(1);
  expect(state.archives).toHaveLength(1);
  state.outcome.archiveMode = "persist";
  await page.getByRole("button", { name: "按原请求继续", exact: true }).click();
  await page.getByRole("button", { name: "确认按原请求继续", exact: true }).click();
  await expect.poll(() => state.archives.length).toBe(2);
  expect(state.archives[1]).toEqual(original);
  expect(state.uploads).toHaveLength(2);
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
});


test("两份归档原件独立展示，财务按真实文件权限下载且无旧终审入口", async ({ page }, testInfo) => {
  const warnings: string[] = []; page.on("console", event => { if (event.type() === "warning") warnings.push(event.text()); });
  const state = await openDetail(page, { archive: true });
  await selectAndArchive(page);
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  state.viewer.id = "finance-read"; state.viewer.role = "finance_staff";
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("jiangkong-web-admin-auth")!);
    value.user.id = "finance-read"; value.user.roleKeys = ["finance_staff"]; value.user.globalRoleKeys = ["finance_staff"];
    localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value));
  });
  await page.reload();
  await expectHealthyProgress(page);
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByText("审批前乙方签章版", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认归档", exact: true })).toHaveCount(0);
  await expect(page.locator(".evidence-card")).toHaveCount(2);
  const downloads = page.locator(".action-group").filter({ hasText: "敏感文件下载" });
  for (let index = 0; index < 2; index++) {
    if (index === 1) {
      await downloads.getByPlaceholder("选择合同归档文件").click();
      await page.getByText("双方签章附件.pdf（已归档）", { exact: true }).last().click();
    }
    await downloads.getByRole("button", { name: "下载文件", exact: true }).click();
    await page.getByPlaceholder("说明本次操作原因").fill("核对签章原件");
    await page.getByPlaceholder("用于确认当前操作者身份").fill("Synthetic@2026");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "确认下载", exact: true }).click();
    const download = await pending;
    const stream = await download.createReadStream(); const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(index === 0 ? "%PDF-1.7 signed main" : "%PDF-1.7 signed annex"));
  }
  expect(state.tickets).toEqual(state.fileIds.map(fileId => ({ fileId, body: { confirmationPassword: "Synthetic@2026", downloadReason: "核对签章原件" } })));
  await page.goto("/archives");
  await expect(page.getByRole("heading", { name: "资料库", exact: true })).toBeVisible();
  await expect.soft(page.locator(".summary-item").filter({ hasText: "全部资料" }).locator("strong")).toHaveText("2", { timeout: 1500 });
  await expect.soft(page.locator(".summary-item").filter({ hasText: "合同归档件" }).locator("strong")).toHaveText("2", { timeout: 1500 });
  await expect.soft(page.locator(".rule-strip")).toContainText("各类归档资料按相应业务流程办理", { timeout: 1500 });
  await expect.soft(page.locator(".rule-strip")).not.toContainText("合同/结算归档件由合同部上传并由合同部主管确认", { timeout: 1500 });
  await page.screenshot({ animations: "disabled", fullPage: true, path: testInfo.outputPath("simulated-archive-summary.png") });
  for (let index = 0; index < 2; index++) {
    await page.getByText("授权下载", { exact: true }).nth(index).click();
    await page.getByPlaceholder("请输入当前登录密码").fill("Synthetic@2026");
    await page.getByPlaceholder("请填写本次下载用途").fill("资料库核对原件");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "生成下载链接", exact: true }).click();
    const download = await pending; const stream = await download.createReadStream(); const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(index === 0 ? "%PDF-1.7 signed main" : "%PDF-1.7 signed annex"));
  }
  expect(state.tickets.slice(2).map(item => item.fileId)).toEqual(state.fileIds);
  expect(state.archives).toHaveLength(1);
  expect(warnings.filter(value => value.includes("Duplicate keys"))).toEqual([]);
});

test("归档确认前权限已变化时零上传零归档并保留所选原件", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles({ name: "当前签章件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 current signed") });
  await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
  await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
  state.context.archiveAction.enabled = false;
  await page.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect(page.getByText(/当前合同或权限已变化/u)).toBeVisible();
  expect(state.uploads).toHaveLength(0);
  expect(state.archives).toHaveLength(0);
  await expect(page.getByText("当前签章件.pdf", { exact: true })).toBeVisible();
});

test("第二份上传中断只重试该件，并保留人工调整后的原件顺序", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  state.outcome.failUploadNameOnce = "双方签章附件.pdf";
  await selectAndArchive(page);
  await expect(page.getByText("上传未完成，重试将保留已成功的原件", { exact: true }).first()).toBeVisible();
  expect(state.uploadNames).toEqual(["双方签章正文.pdf", "双方签章附件.pdf"]);
  expect(state.archives).toHaveLength(0);
  await page.getByRole("button", { name: "上移：双方签章附件.pdf", exact: true }).click();
  await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
  await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
  await page.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  expect(state.uploadNames).toEqual(["双方签章正文.pdf", "双方签章附件.pdf", "双方签章附件.pdf"]);
  expect(state.archives[0].fileIds).toEqual([state.fileIds[1], state.fileIds[0]]);
});

test("取消人工确认及超过20件或重复文件均不发起上传和归档", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles(Array.from({ length: 21 }, (_, index) => ({ name: `原件${index}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF signed ${index}`) })));
  await expect(page.getByText("一次最多归档20份PDF，请减少文件后核对", { exact: true })).toBeVisible();
  await expect(page.locator(".signed-file-list li")).toHaveCount(0);
  const one = { name: "同一原件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF signed same") };
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles([one, one]);
  await expect(page.getByText("请勿重复选择同一份签章PDF", { exact: true })).toBeVisible();
  await expect(page.locator(".signed-file-list li")).toHaveCount(0);
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles(one);
  await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认归档", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).last().click();
  expect(state.uploads).toHaveLength(0); expect(state.archives).toHaveLength(0);
  await expect(page.getByText("同一原件.pdf", { exact: true })).toBeVisible();
});

for (const drift of ["sha", "intent", "order", "version", "key"] as const) {
  test(`原归档回执${drift}错配时不报成功且保留原请求`, async ({ page }) => {
    const state = await openDetail(page, { archive: true }); state.outcome.lookupDrift = drift;
    await selectAndArchive(page);
    await expect(page.getByText("返回结果与原归档请求尚未核对一致，请保留原请求并查询", { exact: true })).toBeVisible();
    await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("归档结果待核对，请保留本次原请求并查询结果", { exact: true })).toBeVisible();
    expect(state.archives).toHaveLength(1);
    state.outcome.lookupDrift = "";
    await page.getByRole("button", { name: "查询本次归档结果", exact: true }).click();
    await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
    expect(state.archives).toHaveLength(1); expect(state.uploads).toHaveLength(2);
  });
}

test("新版入口关闭或来源不可办时不退回旧签章归档动作", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  state.context.webWriteReleased = false;
  state.detail.availableActions = [
    { key: "upload_archive", label: "旧上传归档", kind: "primary", enabled: true, disabledReason: null },
    { key: "generate_pdf_archive", label: "旧生成归档PDF", kind: "normal", enabled: true, disabledReason: null },
    { key: "report_signing_material_change", label: "旧签署材料申报", kind: "normal", enabled: true, disabledReason: null }
  ];
  state.detail.availableActionKeys = state.detail.availableActions.map(value => value.key); state.detail.primaryAction = "upload_archive";
  await page.reload();
  await expect(page.getByText("新版合同办理入口尚未开放，当前资料仅供核对。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "旧上传归档", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("选择双方签章PDF", { exact: true })).toHaveCount(0);
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await expect(page.getByText("旧生成归档PDF", { exact: true })).toHaveCount(0);
  await expect(page.getByText("旧签署材料申报", { exact: true })).toHaveCount(0);
  state.detail.v2Lifecycle = { protocolVersion: 2, contractVersionId: V, webWriteReleased: false, status: "unavailable", state: "unavailable", reason: "当前签约来源尚未开放",
    sealAction: { key: "confirm_seal_v2", eligible: false, enabled: false, reason: "当前签约来源尚未开放" }, archiveAction: { key: "archive_signed_v2", eligible: false, enabled: false, reason: "当前签约来源尚未开放" } };
  await page.reload();
  await expect(page.getByText("当前签约来源尚未开放", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "旧上传归档", exact: true })).toHaveCount(0);
  expect(state.uploads).toHaveLength(0); expect(state.archives).toHaveLength(0); expect(state.writes).toHaveLength(0);
});

test("原key查询403明确提示权限变化并保留原请求，恢复查询不再POST", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.lookupStatus = 403;
  await selectAndArchive(page);
  await expect(page.getByText("当前账号权限已变化，已保留原请求和原件，请核对权限后查询", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")));
  expect(before).toHaveLength(1); expect(before[0][1]).not.toContain("confirmationPassword"); expect(before[0][1]).not.toContain("downloadUrl");
  await page.getByRole("button", { name: "查询本次归档结果", exact: true }).click();
  await expect(page.getByText("当前账号权限已变化，已保留原请求和原件，请核对权限后查询", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")))).toEqual(before);
  state.outcome.lookupStatus = 200;
  await page.getByRole("button", { name: "查询本次归档结果", exact: true }).click();
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1); expect(state.uploads).toHaveLength(2);
});


test("盖章UNKNOWN只读核对，人工同轮继续沿原确认而不新建用印审批", async ({ page }) => {
  const state = await openDetail(page); state.outcome.sealMode = "no_persist";
  await page.getByRole("button", { name: "确认已盖章", exact: true }).click();
  await page.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect(page.getByText("盖章结果待核对，请保留本次办理记录后再次查询", { exact: true })).toBeVisible();
  const original = structuredClone(state.writes[0]);
  await page.reload();
  await page.getByRole("button", { name: "查询本次盖章结果", exact: true }).click();
  expect(state.writes).toHaveLength(1);
  state.outcome.sealMode = "persist";
  await page.getByRole("button", { name: "按原盖章信息继续", exact: true }).click();
  await page.getByRole("button", { name: "确认按原盖章信息继续", exact: true }).click();
  await expect(page.getByText("已核对盖章完成结果", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2); expect(state.writes[1]).toEqual(original); expect(state.archives).toHaveLength(0);
});

for (const count of [1, 20]) {
  test(`中文原件选择入口可归档${count}份PDF边界`, async ({ page }) => {
    const state = await openDetail(page, { archive: true });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "选择双方签章PDF", exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(Array.from({ length: count }, (_, index) => ({ name: `签章原件${index + 1}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF boundary ${index + 1}`) })));
    await expect(page.locator(".signed-file-list li")).toHaveCount(count);
    await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
    await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
    await page.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
    expect(state.archives[0].fileIds).toHaveLength(count); expect(state.uploads).toHaveLength(count);
  });
}


test("原归档结果已核对但详情刷新失败时分别显示，不重新发起归档", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.detailFailureAfterReceipt = true;
  await selectAndArchive(page);
  await expect(page.getByText("归档结果已核对成功，合同详情暂未刷新，请重试读取。", { exact: true })).toBeVisible();
  await expect(page.getByText("合同详情读取失败", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1); expect(state.outcome.reads).toBeGreaterThan(0);
  state.outcome.detailStatus = 200;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("heading", { name: /当前签章合同/u }).first()).toBeVisible();
  expect(state.archives).toHaveLength(1);
});

for (const status of [404, 503]) {
  test(`原key查询${status}保留完整原意图且不重发`, async ({ page }) => {
    const state = await openDetail(page, { archive: true }); state.outcome.lookupStatus = status;
    await selectAndArchive(page);
    await expect(page.getByText("归档结果待核对，请保留原请求后再次查询", { exact: true })).toBeVisible();
    const before = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")));
    await page.reload();
    await page.getByRole("button", { name: "查询本次归档结果", exact: true }).click();
    await expect(page.getByText("暂时无法查询归档结果，已保留原请求和原件", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")))).toEqual(before);
    expect(state.archives).toHaveLength(1); expect(state.uploads).toHaveLength(2);
  });
}

test("账号切换不接管另一经办人的原归档意图", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.archiveMode = "no_persist";
  await selectAndArchive(page);
  await expect(page.getByText("归档结果待核对，请保留原请求；可查询或按原请求继续", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")));
  state.viewer.id = "finance-read"; state.context.archiveAction.eligible = false; state.context.archiveAction.enabled = false;
  await page.evaluate(() => { const value = JSON.parse(localStorage.getItem("jiangkong-web-admin-auth")!); value.user.id = "finance-read"; value.user.roleKeys = ["finance_staff"]; value.user.globalRoleKeys = ["finance_staff"]; localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)); });
  await page.reload();
  await expect(page.getByRole("button", { name: "按原请求继续", exact: true })).toHaveCount(0);
  await expect(page.getByText("双方签章正文.pdf", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")))).toEqual(before);
  expect(state.archives).toHaveLength(1); expect(state.uploads).toHaveLength(2);
});

for (const field of ["approvalInstanceId", "sealTaskId", "documentContentFingerprint"] as const) {
  test(`归档前${field}漂移拒绝写入`, async ({ page }) => {
    const state = await openDetail(page, { archive: true });
    await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles({ name: "签章原件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF signed") });
    await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
    await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
    state.context[field] = field === "documentContentFingerprint" ? "b".repeat(64) : "88888888-8888-4888-8888-888888888888";
    await page.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(page.getByText(/当前合同或权限已变化/u)).toBeVisible();
    expect(state.uploads).toHaveLength(0); expect(state.archives).toHaveLength(0);
  });
}

test("归档POST响应丢失仍按原key证明成功，不补发POST", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.archiveMode = "persist_lost";
  await selectAndArchive(page);
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1); expect(state.uploads).toHaveLength(2);
});

test("版本切换保留原版本意图且不把旧文件带入新版本", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.archiveMode = "no_persist";
  await selectAndArchive(page);
  await expect(page.getByText("归档结果待核对，请保留原请求；可查询或按原请求继续", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")));
  const other = "99999999-9999-4999-8999-999999999999";
  state.detail.contractVersionId = other; state.context.contractVersionId = other;
  await page.reload();
  await expect(page.getByRole("button", { name: "查询本次归档结果", exact: true })).toHaveCount(0);
  await expect(page.getByText("双方签章正文.pdf", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")))).toEqual(before);
  expect(state.archives).toHaveLength(1);
});

test("损坏本机原意图停止新操作且不静默清理", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  const key = `jg:contract-archive-intent:v1:staff-archive:${V}`;
  await page.evaluate(key => localStorage.setItem(key, "{broken"), key);
  await page.reload();
  await expect(page.getByText("本机办理记录无法核对，已停止发起新操作", { exact: true })).toBeVisible();
  await expect(page.getByLabel("选择双方签章PDF", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("{broken");
  expect(state.archives).toHaveLength(0); expect(state.uploads).toHaveLength(0);
});

test("其他经办人完成盖章时只呈现真实完成者结论", async ({ page }) => {
  const state = await openDetail(page); state.outcome.sealMode = "no_persist";
  await page.getByRole("button", { name: "确认已盖章", exact: true }).click();
  await page.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect(page.getByText("盖章结果待核对，请保留本次办理记录后再次查询", { exact: true })).toBeVisible();
  state.context.state = "pending_archive";
  state.context.sealOutcome = { status: "completed", completedAt: "2026-11-09T01:00:00.000Z", completedByUserId: "another-director" };
  await page.getByRole("button", { name: "查询本次盖章结果", exact: true }).click();
  await expect(page.getByText("已由其他经办人确认盖章，请核对当前合同", { exact: true })).toBeVisible();
  await expect(page.getByText("已核对盖章完成结果", { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test("双击人工归档确认只产生一次归档写入", async ({ page }) => {
  const state = await openDetail(page, { archive: true });
  await page.getByLabel("选择双方签章PDF", { exact: true }).setInputFiles({ name: "签章原件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF signed") });
  await page.getByRole("button", { name: "归档双方签章原件", exact: true }).click();
  await page.getByText("我已人工核对原件与本轮合同内容一致", { exact: true }).click();
  await page.getByRole("button", { name: "确认归档", exact: true }).dblclick();
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1); expect(state.uploads).toHaveLength(1);
});

test("绑定繁忙仍保留原请求，人工继续只用相同key与正文", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.archiveMode = "busy";
  await selectAndArchive(page);
  await expect(page.getByText("归档结果待核对，请保留原请求；可查询或按原请求继续", { exact: true })).toBeVisible();
  const original = structuredClone(state.archives[0]); state.outcome.archiveMode = "persist";
  await page.getByRole("button", { name: "按原请求继续", exact: true }).click();
  await page.getByRole("button", { name: "确认按原请求继续", exact: true }).click();
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  expect(state.archives).toEqual([original, original]); expect(state.uploads).toHaveLength(2);
});

test("离开页面后的晚到回执不清理原意图或污染新页面", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.holdLookup = true;
  await selectAndArchive(page);
  await expect.poll(() => state.outcome.reads).toBe(1);
  const before = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")));
  await page.goto("/archives");
  await expect(page.getByRole("heading", { name: "资料库", exact: true })).toBeVisible();
  state.outcome.holdLookup = false; state.releaseLookup();
  await expect(page.getByRole("heading", { name: "资料库", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("jg:contract-archive-intent:v1:")))).toEqual(before);
  await page.goto(`/contracts/${CODE}`);
  await page.getByRole("button", { name: "查询本次归档结果", exact: true }).click();
  await expect(page.getByText("双方签章原件已归档，合同已生效", { exact: true })).toBeVisible();
  expect(state.archives).toHaveLength(1);
});

test("刷新同页A到B再回A时旧上传不能复活或锁住新作用域", async ({ page }) => {
  const state = await openDetail(page, { archive: true }); state.outcome.holdFirstUpload = true;
  await selectAndArchive(page);
  await expect.poll(() => state.uploads.length).toBe(1);
  const other = "99999999-9999-4999-8999-999999999999";
  state.detail.contractVersionId = other; state.context.contractVersionId = other; state.detail.title = CODE + " · 第二版本合同";
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("heading", { name: /第二版本合同/u }).first()).toBeVisible();
  state.detail.contractVersionId = V; state.context.contractVersionId = V; state.detail.title = CODE + " · 当前签章合同";
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("heading", { name: /当前签章合同/u }).first()).toBeVisible();
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/files");
  state.outcome.holdFirstUpload = false; state.releaseUpload(); await response;
  await expect(page.getByLabel("选择双方签章PDF", { exact: true })).toBeVisible();
  await expect(page.locator(".signed-file-list li")).toHaveCount(0);
  expect(state.uploads).toHaveLength(1); expect(state.archives).toHaveLength(0);
});

test("V1无新版上下文时保留原签署流程且不展示新版区", async ({ page }, testInfo) => {
  const state = await openDetail(page); delete state.detail.v2Lifecycle;
  state.detail.archiveFiles = [{ archiveProtocolVersion: 1, archiveRecordId: "55555555-5555-4555-8555-555555555555", fileId: state.fileIds[0], fileName: "旧版签章原件.pdf", mimeType: "application/pdf", sizeBytes: 20,
    status: "confirmed", statusLabel: "已归档", uploadedByName: "原合同员", createdAt: "2026-11-08T02:00:00.000Z", confirmedByName: "主管", confirmedAt: "2026-11-08T03:00:00.000Z", canDownload: false, disabledReason: "模拟旧原件不开放下载" }];
  state.detail.availableActions = [{ key: "complete_seal", label: "旧版盖章完成", kind: "primary", enabled: true, disabledReason: null }];
  state.detail.availableActionKeys = ["complete_seal"]; state.detail.primaryAction = "complete_seal";
  state.outcome.approvalDocumentAvailable = true;
  await page.reload();
  await expect(page.getByRole("button", { name: "下载审批单 PDF", exact: true })).toBeVisible();
  await expectHealthyProgress(page);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("simulated-v1-available.png") });
  await expect(page.getByRole("region", { name: "盖章与签章归档", exact: true })).toHaveCount(0);
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByRole("strong").filter({ hasText: /^审批前乙方签章版$/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "旧版盖章完成", exact: true })).toBeVisible();
  await expectHealthyProgress(page);
  state.outcome.approvalDocumentAvailable = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "下载审批单 PDF", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "旧版盖章完成", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0); expect(state.archives).toHaveLength(0);
});
