import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, expectMockHttpFailure, test } from "./helpers/task12-transport";

const project = { id: "project-direct", name: "原件测试项目", code: "XM-001" };

const contractId = "contract-direct";
const versionId = "version-direct";
const workbenchRoute = `/合同工作台/${contractId}?versionId=${versionId}`;
const otherContractId = "contract-direct-other";
const otherVersionId = "version-direct-other";
const otherWorkbenchRoute = `/合同工作台/${otherContractId}?versionId=${otherVersionId}`;

function partyOption(page: Page, label: string) {
  return page.locator(".t-select__dropdown:visible:not(.t-popup--animation-leave-active)")
    .getByText(label, { exact: true });
}

const marker = { protocolVersion: 1, source: "direct_signed", relationship: "outside", signedOn: null,
  enterpriseParty: null, counterpartyParty: null, fixedPaymentTermsVersionId: null };
const basics = { relationship: "outside", businessType: "material_purchase", amountBasis: "tax_inclusive", invoiceStatus: "pending", settlementText: "" };
const sourceResult = (sourceRevision: number, Q: Record<string, unknown> | null = null) => ({
  protocolVersion: 1, sourceKind: "direct_signed_pending", state: Q ? "complete" : "incomplete", sourceRevision, Q,
  inputSha256: Q ? "c".repeat(64) : null, reason: Q ? null : "请补充合同资料"
});

function directWorkbench(contractId: string, versionId: string, name = "已签材料合同") {
  const draft = { contractName: name, contractBasics: { ...basics }, directSigningInput: { ...marker } };
  return {
    contract: { id: contractId, code: null, temporaryCode: "临时编号不应显示", projectId: project.id,
      contractTypeKey: "material_purchase", ownerUserId: "direct-owner", name },
    version: { id: versionId, contractId, versionNo: 1, status: "draft", numericProtocolVersion: 2, changeType: "original",
      draftRevision: 1, documentContentRevision: null, documentContentFingerprint: null, originalSignedNumber: null as string | null,
      originalSignedNumberState: "available", layoutTemplateVersionId: null, amountCents: null,
      amountYuan: null as string | null, amountLimitType: "capped", pricingNature: "unit_price", amountSource: "manual",
      taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, status: "draft", source: "contract_document", revision: 0, frozenAt: null },
      draftData: draft, clauseSnapshot: [], templateSnapshot: { fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] } },
    parties: [] as unknown[], bills: [], paymentTerms: null as { originalText: string; stages: [] } | null, draft, attachments: [] as unknown[], documents: [], directPendingInput: sourceResult(1),
    directPendingCapabilities: { registrationEnabled: false, copyEnabled: false, purgeEnabled: false },
    lease: { state: "available", holderDisplayName: null, expiresAt: null, canTakeOver: false },
    draftOperationAvailableActions: ["acquire_contract_draft_edit_lease", "heartbeat_contract_draft_edit_lease", "release_contract_draft_edit_lease", "save_contract_draft", "upload_contract_workbench_private_file"],
    settlementMode: { value: null, source: null, confirmedAt: null, confirmedByUserId: null, confirmationRequired: true, canConfirm: false },
    readiness: { ready: false, blockingMessages: [], warningMessages: [], blocking: [], warnings: [] }
  };
}

async function openCreate(page: Page, baseURL: string, ready = false, upward: "held" | "ready" | null = null) {
  const workbench = directWorkbench(contractId, versionId);
  const otherWorkbench = directWorkbench(otherContractId, otherVersionId, "另一份同号合同");
  const enterpriseVersionId = "upward-enterprise-version", companyEntityId = "upward-company", companyEntityVersionId = "upward-company-version";
  const subjectOptions = { projectId: project.id, contractVersionId: versionId, draftRevision: 1,
    enterprise: { businessPartyVersionId: enterpriseVersionId, name: "对上施工企业" },
    companies: [{ companyEntityId, companyEntityVersionId, name: "项目参与公司" }] };
  const upwardSource = (revision: number, Q: Record<string, unknown> | null) => ({
    ...sourceResult(revision, Q), protocolVersion: 2, sourceKind: "upward_direct_signed_pending"
  });
  if (upward) {
    Object.assign(workbench.draft, { contractBasics: { ...basics, relationship: "upward" },
      directSigningInput: { protocolVersion: 2, source: "direct_signed", relationship: "upward", signedOn: null,
        enterpriseParty: null, companyParty: null, companyParticipationId: null, fixedPaymentTermsVersionId: null } });
    workbench.version.originalSignedNumberState = "unavailable";
    workbench.directPendingInput = upwardSource(1, null);
    Object.assign(workbench, { upwardDraftSubjects: subjectOptions });
  }
  const versionReads: string[] = [];
  const creationRequests: unknown[] = [];
  const saves: Array<Record<string, unknown>> = [];
  const uploads: Array<{ name: string; key: string }> = [];
  const options = { failNextUpload: false, loseNextSave: false, lookupUnknown: false, lookupWrongFingerprint: false,
    saveResponseHold: null as Promise<void> | null, lookupResponseHold: null as Promise<void> | null, includeOtherDraft: false,
    qualifySavedInputs: false,
    upwardRegistration: false,
    outsideRegistration: false,
    savedMimeOverride: null as string | null,
    upwardCompanyVersionChanged: false,
    upwardWrongReceiptOrder: false,
    invalidateSavedInputs: false, abortCreatedResponse: false, acquireCapabilityHold: null as Promise<void> | null,
    delayedCapabilityStatus: 200,
    grantHold: null as Promise<void> | null,
    holdCreateFailure: null as { method: "GET" | "POST"; status: 401 | 403; response: Promise<void> } | null,
    holdReadFailure: null as { path: string; response: Promise<void> } | null,
    holdRefresh: null as { status: 201 | 401; response: Promise<void> } | null,
    releaseCapabilityHold: null as Promise<void> | null,
    latestRevisionOverride: null as number | null, advanceAfterSave: false, advanceBeforeFreshRead: false,
    initialOriginalNumber: null as string | null,
    readState: null as "invalid" | "unavailable" | "wrong-pair" | "lease-held" | null };
  const uploadedMimes = new Map<string, string>();
  const lookups: string[] = [];
  const leaseAcquisitions: string[] = [];
  const leaseReleases: Array<{ path: string; actor: string; token: string }> = [];
  const contractDetailReads: string[] = [];
  const approvalOptionReads: string[] = [];
  const createCapabilityActors: string[] = [];
  const delayedReadActors: string[] = [];
  const refreshActors: string[] = [];
  const otherWorkbenchActors: string[] = [];
  let freshAdvancePending = false;
  let savedReceipt: Record<string, unknown> | null = null;
  let actor = "direct-owner";
  let directCreationCommitted = false;
  await page.context().route(new URL("/api/**", baseURL).href, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    async function delayedCreateFailure() {
      const held = options.holdCreateFailure;
      if (!held || held.method !== method || request.headers().authorization !== "Bearer direct-owner") return null;
      await held.response;
      expectMockHttpFailure(page.context(), request.url(), held.status);
      return json({ message: held.status === 403 ? "Password change required" : "旧会话已过期" }, held.status);
    }
    if (method === "POST" && path === "/api/auth/login") {
      const { phone } = request.postDataJSON();
      actor = phone === "13900000001" ? "direct-other" : "direct-owner";
      return json({ user: { id: actor, name: actor === "direct-owner" ? "合同经办人" : "另一位经办人", phone, mustChangePassword: false,
        roleKeys: ["contract_staff"], globalRoleKeys: ["contract_staff"] }, tokens: { accessToken: actor, refreshToken: actor, expiresIn: 900 } }, 201);
    }
    if (method === "POST" && path === "/api/auth/logout") return json({ ok: true }, 201);
    if (method === "POST" && path === "/api/auth/refresh" && options.holdRefresh) {
      const held = options.holdRefresh;
      refreshActors.push(request.postDataJSON().refreshToken);
      await held.response;
      if (held.status === 401) expectMockHttpFailure(page.context(), request.url(), 401);
      return held.status === 401 ? json({ message: "旧会话已过期" }, 401)
        : json({ tokens: { accessToken: "direct-owner-rotated", refreshToken: "direct-owner-rotated", expiresIn: 900 } }, 201);
    }
    if (method === "GET" && path === options.holdReadFailure?.path) {
      delayedReadActors.push(request.headers().authorization);
      if (request.headers().authorization === "Bearer direct-owner") {
        await options.holdReadFailure.response;
        expectMockHttpFailure(page.context(), request.url(), 401);
        return json({ message: "旧会话已过期" }, 401);
      }
    }
    if (method === "GET" && path === "/api/me/signature/ticket") return json(null);
    if (method === "GET" && path === "/api/me/signature/canvas-capabilities") return json({ availableActions: [] });
    if (method === "GET" && path === "/api/account-security/options") return json({ smsEnabled: false });
    if (method === "GET" && path === "/api/business-entry-definitions/user_self_profile") return json({ key: "unavailable" });
    if (method === "GET" && path === "/api/approval-rule-assignments") return json({ projects: [], projectId: null, roles: [] });
    if (method === "GET" && path === "/api/me/work-items") {
      otherWorkbench.version.originalSignedNumber = workbench.version.originalSignedNumber;
      const visibleDrafts = actor === "direct-other" ? [otherWorkbench] : [
        ...(!options.abortCreatedResponse || directCreationCommitted ? [workbench] : []),
        ...(options.includeOtherDraft ? [otherWorkbench] : [])
      ];
      const drafts = visibleDrafts.map(draft => ({
        id: `contract-draft:${draft.version.id}`, type: "draft", title: draft.contract.name, projectName: project.name, projectId: project.id,
        businessCode: draft.version.originalSignedNumber ?? "未注明编号", businessType: "contract", businessId: draft.contract.id,
        amountText: draft.version.amountYuan ?? "—", currentNode: "合同草稿", stayedText: "刚刚", nextAction: "继续填写合同",
        targetPath: `/合同工作台/${draft.contract.id}?versionId=${draft.version.id}`, tone: "default"
      }));
      return json({ visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [], drafts },
        approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } });
    }
    if (method === "GET" && path === "/api/projects/contract-create-options") return json([project]);
    if (method === "GET" && path === "/api/approval-delegations/user-options") {
      approvalOptionReads.push(path);
      if (!decodeURIComponent(new URL(page.url()).pathname).startsWith("/合同管理/")) return route.fallback();
      return json([]);
    }
    if (method === "GET" && path === "/api/contracts") {
      const row = { project: project.name, amount: "金额待确定", counterparty: "相对方待补充", currentNode: "合同草稿",
        updatedAt: "2026-11-09T02:00:00.000Z", pendingOwner: "合同经办人", nextAction: "查看资料" };
      return json({ rows: [{ ...row, id: "same-number-display", contractId: "visible-contract-other", contractVersionId: "visible-version-other",
        name: "可见同号直签合同", contractNo: "  同号  ", originalSignedNumber: "  同号  ", originalSignedNumberState: "available" },
      ...(options.includeOtherDraft ? [{ ...row, id: "same-number-display", contractId, contractVersionId: versionId,
        name: "另一份同号直签合同", contractNo: "  同号  ", originalSignedNumber: "  同号  ", originalSignedNumberState: "available" }] : []),
      { id: "generated-display", contractId: "generated-contract", contractVersionId: "generated-version", contractNo: "未注明编号" },
      { id: "unnumbered-display", contractId: "unlabelled-contract", contractVersionId: "unlabelled-version",
        contractNo: "未注明编号", originalSignedNumber: null, originalSignedNumberState: "available" }] });
    }
    if (method === "GET" && ["/api/settlements", "/api/payments", "/api/archives", "/api/contract-relationship-ledger"].includes(path)) {
      return json({ rows: [] });
    }
    if (method === "GET" && ["/api/contracts/visible-contract-other", `/api/contracts/${contractId}`].includes(path)) {
      contractDetailReads.push(path + new URL(request.url()).search);
      expectMockHttpFailure(page.context(), request.url(), 403);
      return json({ message: "该版本详情已不可见" }, 403);
    }
    if (method === "GET" && path === "/api/business-parties") {
      return json([{ id: "controlled-a", status: "active", name: "真实施工企业" }, { id: "controlled-b", status: "active", name: "真实相对方" }]);
    }
    if (method === "GET" && ["/api/business-parties/controlled-a", "/api/business-parties/controlled-b"].includes(path)) {
      const id = path.split("/").at(-1)!;
      const name = id === "controlled-a" ? "真实施工企业" : "真实相对方";
      return json({ party: { id, status: "active", name },
        versions: [{ id: id + "-v2", businessPartyId: id, versionNo: 2, snapshot: { name } },
          { id: id + "-v1", businessPartyId: id, versionNo: 1, snapshot: { name } }] });
    }
    if (method === "POST" && path === `/api/contract-drafts/${versionId}/files`) {
      const form = await new Request(request.url(), { method: "POST", headers: request.headers(),
        body: new Uint8Array(request.postDataBuffer() ?? []) }).formData();
      const file = form.get("file");
      if (!file || typeof file === "string") throw new Error("浏览器未发出文件");
      const key = String(form.get("idempotencyKey"));
      uploads.push({ name: file.name, key });
      if (options.failNextUpload) {
        options.failNextUpload = false;
        expectMockHttpFailure(page.context(), request.url(), 503);
        return json({ message: "原件上传暂不可用" }, 503);
      }
      const fileId = file.type === "application/pdf"
        ? (options.upwardRegistration || options.outsideRegistration ? "11111111-1111-4111-8111-111111111111" : "uploaded-pdf")
        : (options.upwardRegistration || options.outsideRegistration ? "22222222-2222-4222-8222-222222222222" : "uploaded-photo");
      uploadedMimes.set(fileId, file.type);
      return json({ id: fileId, mimeType: file.type,
        // WebKit's intercepted multipart snapshot omits file bytes. These exact
        // fixture filenames carry fixed synthetic bytes; API tests independently verify storage bytes.
        sizeBytes: file.size === 0 && ["对上原件.pdf", "对上照片.png", "签章.pdf", "签章照片.png"].includes(file.name)
          ? Buffer.byteLength(file.type === "application/pdf" ? "%PDF-1.4 synthetic" : "synthetic photo") : file.size,
        originalName: file.name }, 201);
    }
    if (method === "GET" && path === "/api/contracts/create-capability" && new URL(request.url()).searchParams.get("projectId") === project.id) {
      createCapabilityActors.push(request.headers().authorization);
      if (options.holdCreateFailure?.method === "GET" && request.headers().authorization === "Bearer direct-owner") return delayedCreateFailure();
      const relationship = new URL(request.url()).searchParams.get("relationship");
      return json({ projectId: project.id, availableActions: ["create_contract_draft",
        ...(upward === "ready" && relationship === "upward" ? ["create_upward_direct_draft"] : [])] });
    }
    if (method === "POST" && path === "/api/contracts") {
      creationRequests.push(request.postDataJSON());
      if (options.holdCreateFailure?.method === "POST" && request.headers().authorization === "Bearer direct-owner") return delayedCreateFailure();
      if (options.abortCreatedResponse) {
        directCreationCommitted = true;
        return route.abort("aborted");
      }
      if (ready) return json({ contract: workbench.contract, version: workbench.version, terms: null }, 201);
      expectMockHttpFailure(page.context(), request.url(), 503);
      return json({ message: "当前暂不能办理已签合同，请稍后再试" }, 503);
    }
    if (method === "GET" && path === `/api/contract-drafts/${versionId}/workbench`) {
      versionReads.push(path);
      const reads = versionReads.filter(item => item === path).length;
      if (reads === 1 && options.initialOriginalNumber !== null) workbench.version.originalSignedNumber = options.initialOriginalNumber;
      if (reads === 3 && options.releaseCapabilityHold) await options.releaseCapabilityHold;
      if (freshAdvancePending) {
        freshAdvancePending = false;
        workbench.version.draftRevision += 1;
        workbench.version.originalSignedNumber = "精确回读的最新原编号";
        workbench.directPendingInput = sourceResult(workbench.version.draftRevision);
      }
      if (reads === 2 && options.acquireCapabilityHold) {
        await options.acquireCapabilityHold;
        if (options.delayedCapabilityStatus === 401) {
          expectMockHttpFailure(page.context(), request.url(), 401);
          return json({ message: "旧会话已过期" }, 401);
        }
      }
      if (options.readState === "wrong-pair") return json({ ...workbench, contract: otherWorkbench.contract });
      if (options.readState === "invalid") return json({ ...workbench, directPendingInput: { ...sourceResult(workbench.version.draftRevision), state: "invalid" } });
      if (options.readState === "unavailable") return json({ ...workbench,
        version: { ...workbench.version, originalSignedNumber: null, originalSignedNumberState: "unavailable" },
        directPendingInput: { ...sourceResult(workbench.version.draftRevision), sourceRevision: null, state: "unavailable" } });
      if (options.readState === "lease-held") return json({ ...workbench,
        lease: { state: "held_by_other", holderDisplayName: "另一位经办人", expiresAt: new Date(Date.now() + 60_000).toISOString(), canTakeOver: false } });
      if (upward && options.upwardCompanyVersionChanged) return json({ ...workbench,
        upwardDraftSubjects: { ...subjectOptions, companies: [{ ...subjectOptions.companies[0], companyEntityVersionId: "different-current-company-version" }] } });
      return json(workbench);
    }
    if (method === "GET" && path === `/api/contract-drafts/${otherVersionId}/workbench`) {
      versionReads.push(path);
      otherWorkbenchActors.push(request.headers().authorization);
      if (actor === "direct-other") otherWorkbench.contract.ownerUserId = actor;
      otherWorkbench.version.originalSignedNumber = workbench.version.originalSignedNumber;
      return json(otherWorkbench);
    }
    if (method === "PUT" && path === `/api/contract-drafts/${versionId}`) {
      const input = request.postDataJSON();
      saves.push(input);
      workbench.version.draftRevision += 1;
      workbench.version.originalSignedNumber = upward && !("originalSignedNumber" in input.draft) ? "已存原编号" : input.draft.originalSignedNumber;
      if (upward) workbench.version.originalSignedNumberState = "available";
      workbench.version.amountYuan = input.draft.manualAmountYuan;
      workbench.paymentTerms = input.paymentTerms;
      workbench.parties = input.parties;
      workbench.attachments = input.attachments;
      const persisted = structuredClone(input.draft.draftData);
      if (input.paymentTerms) persisted.directSigningInput.fixedPaymentTermsVersionId = "fixed-payment-terms";
      workbench.version.draftData = persisted;
      workbench.draft = persisted;
      const qualifiedInput = options.qualifySavedInputs ? {
        inputProtocolVersion: 1, source: { kind: "direct_signed", relationship: "outside" },
        locator: { projectId: project.id, contractId, contractVersionId: versionId, versionNo: 1, changeType: "original", draftRevision: workbench.version.draftRevision },
        contract: { businessType: "material_purchase", name: persisted.contractName,
          originalSignedNumber: workbench.version.originalSignedNumber, signedOn: persisted.directSigningInput.signedOn },
        money: { numericProtocolVersion: 2, amountYuan: workbench.version.amountYuan, amountLimitType: "capped", pricingNature: "unit_price", amountSource: "manual" },
        tax: { amountBasis: persisted.contractBasics.amountBasis, invoiceType: input.draft.taxFacts.invoiceType,
          taxMode: input.draft.taxFacts.taxMode, defaultTaxRatePercent: input.draft.taxFacts.defaultTaxRatePercent },
        subjects: { enterprise: { assignmentId: "synthetic-affiliation", businessPartyId: "controlled-a", businessPartyVersionId: "controlled-a-v1",
          name: "真实施工企业", creditCode: null, effectiveFrom: "2026-11-08T00:00:00.000Z" },
          roles: { enterpriseCpsId: "synthetic-party-a", counterpartyCpsId: "synthetic-party-b" },
          parties: input.parties.map((item: { roleKey: string; displayOrder: number; businessPartyVersionId: string; snapshot: { name: string } }) => ({
            cpsId: item.roleKey === "party_a" ? "synthetic-party-a" : "synthetic-party-b", roleKey: item.roleKey,
            displayOrder: item.displayOrder, businessPartyVersionId: item.businessPartyVersionId,
            identity: { name: item.snapshot.name, unifiedSocialCreditCode: null, legalRepresentative: null,
              address: null, contactName: null, contactPhone: null }
          })) },
        terms: { settlementText: persisted.contractBasics.settlementText,
          paymentTerms: { id: "fixed-payment-terms", versionNo: 1, ...input.paymentTerms } },
        signedFiles: input.attachments.map((item: { fileId: string; displayOrder: number }) => ({
          fileId: item.fileId, displayOrder: item.displayOrder,
          mimeType: options.savedMimeOverride ?? uploadedMimes.get(item.fileId) ?? "application/pdf", sizeBytes: 10, contentSha256: "a".repeat(64)
        }))
      } : null;
      if (upward) {
        workbench.directPendingCapabilities.registrationEnabled = options.upwardRegistration;
        persisted.directSigningInput.companyParticipationId = "upward-participation";
        subjectOptions.draftRevision = workbench.version.draftRevision;
        workbench.directPendingInput = upwardSource(workbench.version.draftRevision, {
          inputProtocolVersion: 2, source: { kind: "direct_signed", relationship: "upward" },
          locator: { projectId: project.id, contractId, contractVersionId: versionId, versionNo: 1, changeType: "original", draftRevision: workbench.version.draftRevision },
          contract: { originalSignedNumber: workbench.version.originalSignedNumber },
          subjects: { enterprise: { projectId: project.id, position: persisted.directSigningInput.enterpriseParty,
            cpsId: "upward-cps", assignmentId: "upward-assignment", businessPartyId: "upward-enterprise", businessPartyVersionId: enterpriseVersionId },
            company: { projectId: project.id, position: persisted.directSigningInput.companyParty, companyEntityId, companyEntityVersionId,
              joinedCompanyEntityVersionId: "upward-company-joined", participationId: "upward-participation" } },
          signedFiles: input.attachments.map((item: { fileId: string; displayOrder: number }) => ({
            ...item, mimeType: options.savedMimeOverride ?? uploadedMimes.get(item.fileId) ?? "application/pdf", sizeBytes: 10, contentSha256: "a".repeat(64) }))
        });
      } else {
        workbench.directPendingInput = sourceResult(workbench.version.draftRevision, qualifiedInput);
        workbench.directPendingCapabilities.registrationEnabled = options.outsideRegistration;
      }
      if (options.invalidateSavedInputs) workbench.directPendingInput.state = "invalid";
      savedReceipt = { contractVersionId: versionId, draftRevision: workbench.version.draftRevision, serverRevision: workbench.version.draftRevision,
        originalSignedNumber: workbench.version.originalSignedNumber, directSigningInput: workbench.directPendingInput,
        documentContentRevision: null, documentContentFingerprint: null, documentsOutdated: false,
        requestFingerprint: createHash("sha256").update(request.postData()!).digest("hex"), savedAt: "2026-11-09T02:00:00.000Z",
        effectiveChangedSections: ["draft"], availableActions: [] };
      if (upward && options.upwardWrongReceiptOrder) {
        const directSigningInput = structuredClone(workbench.directPendingInput);
        const files = directSigningInput.Q?.signedFiles;
        if (Array.isArray(files)) directSigningInput.Q!.signedFiles = files.reverse().map((file, displayOrder) => ({ ...file, displayOrder }));
        savedReceipt = { ...savedReceipt, directSigningInput };
      }
      if (options.saveResponseHold) await options.saveResponseHold;
      if (options.loseNextSave) {
        options.loseNextSave = false;
        expectMockHttpFailure(page.context(), request.url(), 503);
        return json({ message: "模拟保存后响应中断" }, 503);
      }
      return json(savedReceipt);
    }
    if (method === "GET" && path.startsWith(`/api/contract-drafts/${versionId}/save-requests/`)) {
      const key = path.split("/").at(-1)!;
      lookups.push(key);
      if (!savedReceipt || options.lookupUnknown || key !== saves.at(-1)?.idempotencyKey) return json({ status: "unknown" });
      if (options.lookupResponseHold) await options.lookupResponseHold;
      if (options.advanceAfterSave) {
        options.advanceAfterSave = false;
        workbench.version.draftRevision += 1;
        workbench.version.originalSignedNumber = "后续修订的原编号";
        workbench.directPendingInput = sourceResult(workbench.version.draftRevision);
        freshAdvancePending = options.advanceBeforeFreshRead;
      }
      return json({ status: "saved", latestRevision: options.latestRevisionOverride ?? workbench.version.draftRevision,
        result: options.lookupWrongFingerprint ? { ...savedReceipt, requestFingerprint: "0".repeat(64) } : savedReceipt });
    }
    if ([`/api/contract-drafts/${versionId}/edit-lease`, `/api/contract-drafts/${otherVersionId}/edit-lease`].includes(path)) {
      if (method === "POST") {
        leaseAcquisitions.push(path);
        if (path.includes(`/${versionId}/`) && options.grantHold) await options.grantHold;
        return json({ token: `synthetic-lease:${path}`, leaseRevision: 1, expiresAt: new Date(Date.now() + 600_000).toISOString(), heartbeatIntervalMs: 60_000 }, 201);
      }
      if (method === "DELETE") {
        const headers = request.headers();
        leaseReleases.push({ path, actor: headers.authorization, token: headers["x-contract-draft-lease"] });
        return json({ released: true });
      }
    }
    return route.fallback();
  });
  await page.goto("/login?redirect=" + encodeURIComponent("/合同工作台/新建"));
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Synthetic@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新建合同", exact: true })).toBeVisible();
  return { creationRequests, versionReads, saves, uploads, options, lookups, leaseAcquisitions, leaseReleases,
    contractDetailReads, approvalOptionReads, createCapabilityActors, delayedReadActors, refreshActors, otherWorkbenchActors };
}

async function switchDraftAccount(page: Page, mobile: boolean, beforeLogout?: () => Promise<void>, phone = "13900000001") {
  if (mobile) await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "系统配置", exact: true }).click();
  await beforeLogout?.();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByPlaceholder("请输入手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill("Synthetic@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("工作项台账").getByText("我的草稿", { exact: true }).click();
}

async function selectUpwardRelationship(page: Page) {
  await page.getByPlaceholder("选择业务类型", { exact: true }).click();
  await page.getByText("材料采购", { exact: true }).last().click();
  await page.getByPlaceholder("可先留空，生成前选择", { exact: true }).click();
  await page.getByText("对上合同（我方公司与施工企业）", { exact: true }).last().click();
}

test("对上能力关闭时不能提交直签创建", async ({ page, baseURL }) => {
  const { creationRequests } = await openCreate(page, baseURL!, false, "held");
  await selectUpwardRelationship(page);
  await expect(page.getByText("当前项目暂不能办理对上已签资料", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "已签合同资料" })).toBeDisabled();
  expect(creationRequests).toEqual([]);
});

async function fillUpwardDraft(page: Page, baseURL: string, registration = false) {
  const fixture = await openCreate(page, baseURL, true, "ready");
  fixture.options.upwardRegistration = registration;
  await selectUpwardRelationship(page);
  const direct = page.getByRole("radio", { name: "已签合同资料" });
  await expect(direct).toBeEnabled();
  await page.getByText("已签合同资料", { exact: true }).click();
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page).toHaveURL(new URL(workbenchRoute, baseURL).href);
  await expect(page.getByText("原合同编号待核对", { exact: true })).toBeVisible();
  await expect(page.getByText("对上施工企业", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "合同名称", exact: true }).fill("对上已签材料采购");
  await page.getByPlaceholder("选择项目参与公司", { exact: true }).click();
  await partyOption(page, "项目参与公司").click();
  await page.getByPlaceholder("选择施工企业签署位置", { exact: true }).click();
  await partyOption(page, "乙方").click();
  await page.getByLabel("上传签章原件").setInputFiles([
    { name: "对上原件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") },
    { name: "对上照片.png", mimeType: "image/png", buffer: Buffer.from("synthetic photo") }
  ]);
  await expect(page.getByText("对上照片.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上移原件 2", exact: true }).click();
  return fixture;
}

test("对上真实两方位置和有序原件随草稿保存，正式登记保持关闭", async ({ page, baseURL }) => {
  const { creationRequests, saves, uploads, leaseAcquisitions } = await fillUpwardDraft(page, baseURL!);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("已存原编号", { exact: true })).toBeVisible();
  expect(creationRequests).toEqual([{ projectId: project.id, contractTypeKey: "material_purchase", numericProtocolVersion: 2,
    amountLimitType: "capped", relationship: "upward", handlingMode: "direct_signed" }]);
  expect(leaseAcquisitions).toHaveLength(1);
  expect(uploads.map(upload => upload.name)).toEqual(["对上原件.pdf", "对上照片.png"]);
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ expectedRevision: 1, saveKind: "manual", draft: {
    companyEntityId: "upward-company", draftData: { directSigningInput: { protocolVersion: 2, relationship: "upward",
      companyParty: { roleKey: "party_a", displayOrder: 0 }, enterpriseParty: { roleKey: "party_b", displayOrder: 0 } } } },
    parties: [{ roleKey: "party_b", displayOrder: 0, businessPartyVersionId: "upward-enterprise-version" }],
    attachments: [{ fileId: "uploaded-photo", displayOrder: 0 }, { fileId: "uploaded-pdf", displayOrder: 1 }] });
  expect(saves[0]?.draft).not.toHaveProperty("originalSignedNumber");
  await expect(page.getByText("资料仅保存为草稿，当前尚不能正式登记。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /提交|用印|归档|入账/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "正式登记", exact: true })).toHaveCount(0);
});

test("对上公司版本失效时保存前拦截并保留本机资料", async ({ page, baseURL }) => {
  const { options, saves } = await fillUpwardDraft(page, baseURL!);
  options.upwardCompanyVersionChanged = true;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("本项目签约主体已变化，请保留资料并刷新后再保存", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "合同名称", exact: true })).toHaveValue("对上已签材料采购");
  expect(saves).toHaveLength(0);
});

test("对上保存回执原件顺序不一致时不确认或重发", async ({ page, baseURL }) => {
  const { options, saves } = await fillUpwardDraft(page, baseURL!);
  options.upwardWrongReceiptOrder = true;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("暂时无法核对本次对上草稿保存，请保留输入并继续核对原结果", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "核对保存结果", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(saves).toHaveLength(1);
});

test("表外材料采购可选择已签资料，暂不可办时保留选择", async ({ page, baseURL }) => {
  const { creationRequests: requests } = await openCreate(page, baseURL!);
  await page.getByPlaceholder("选择业务类型", { exact: true }).click();
  await page.getByText("材料采购", { exact: true }).last().click();
  await page.getByPlaceholder("可先留空，生成前选择", { exact: true }).click();
  await page.getByText("表外合同（施工企业与下游）", { exact: true }).last().click();
  await page.getByText("已签合同资料", { exact: true }).click();
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page.getByText("当前暂不能办理已签合同，请稍后再试", { exact: true })).toBeVisible();
  expect(requests).toEqual([{ projectId: project.id, contractTypeKey: "material_purchase", numericProtocolVersion: 2,
    amountLimitType: "capped", relationship: "outside", handlingMode: "direct_signed" }]);
  await expect(page.getByRole("heading", { name: "新建合同", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "已签合同资料" })).toBeChecked();
});


test("已签草稿按真实版本打开独立资料表，页面不展示生成流程", async ({ page, baseURL }) => {
  const { versionReads } = await openCreate(page, baseURL!, true);
  await page.getByPlaceholder("选择业务类型", { exact: true }).click();
  await page.getByText("材料采购", { exact: true }).last().click();
  await page.getByPlaceholder("可先留空，生成前选择", { exact: true }).click();
  await page.getByText("表外合同（施工企业与下游）", { exact: true }).last().click();
  await page.getByText("已签合同资料", { exact: true }).click();
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page).toHaveURL(new URL(workbenchRoute, baseURL).href);
  await expect(page.getByRole("heading", { name: "已签合同资料" })).toBeVisible();
  await expect(page.getByText("未注明编号", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeVisible();
  await expect(page.getByText("临时编号不应显示")).toHaveCount(0);
  await expect(page.getByText("合同正文", { exact: true })).toHaveCount(0);
  await expect.poll(() => versionReads.length).toBeGreaterThanOrEqual(1);
});


test("手动保存原合同编号原文、四位金额和未填写付款约定", async ({ page, baseURL }) => {
  const { saves, versionReads } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  const originalNumber = page.getByRole("textbox", { name: "原合同编号", exact: true });
  await originalNumber.fill("  原号-甲  ");
  await page.getByRole("textbox", { name: "合同金额（元）", exact: true }).fill("100.0054");
  expect(saves).toHaveLength(0);
  const previousReads = versionReads.length;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({
    expectedRevision: 1, saveKind: "manual", changedSections: ["draft"], draft: {
      originalSignedNumber: "  原号-甲  ", manualAmountYuan: "100.0054", numericProtocolVersion: 2,
      draftData: { directSigningInput: marker }, clauses: []
    }, bills: [], paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  });
  expect(saves[0]?.draft).not.toHaveProperty("manualAmountCents");
  expect(saves[0]?.draft).not.toHaveProperty("companyEntityId");
  expect(versionReads.length).toBeGreaterThanOrEqual(previousReads + 2);
  await expect(originalNumber).toHaveValue("  原号-甲  ");
});


test("原件上传失败可用原尝试续办，并保存实际主体版本和固定付款原文", async ({ page, baseURL }) => {
  const { saves, uploads, options } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  const number = page.getByRole("textbox", { name: "原合同编号", exact: true });
  const checkNumber = page.getByRole("button", { name: "核对同号", exact: true });
  const duplicate = page.getByText("可见近期台账中有相同原编号，仍可保存。");
  await number.fill("  同号  ");
  await checkNumber.click();
  await expect(duplicate).toBeVisible();
  await number.fill("未注明编号");
  const checked = page.waitForResponse(response => new URL(response.url()).pathname === "/api/contracts" && response.request().method() === "GET");
  await checkNumber.click();
  await checked;
  await expect(duplicate).toHaveCount(0);
  await page.getByRole("textbox", { name: "签订日期（选填）", exact: true }).pressSequentially("2026-11-08");
  await page.getByRole("textbox", { name: "结算约定原文", exact: true }).fill("  结算约定原文\n按纸面记录  ");
  await page.getByRole("button", { name: "查找单位", exact: true }).click();
  await page.getByPlaceholder("选择施工企业").click();
  await partyOption(page, "真实施工企业").click();
  await page.getByPlaceholder("选择施工企业资料版本").click();
  await partyOption(page, "真实施工企业 · 版本 1").click();
  await page.getByPlaceholder("选择相对方").click();
  await partyOption(page, "真实相对方").click();
  await page.getByPlaceholder("选择相对方资料版本").click();
  await partyOption(page, "真实相对方 · 版本 2").click();
  await page.getByText("记录付款约定原文", { exact: true }).click();
  await page.getByRole("textbox", { name: "付款约定原文", exact: true }).fill("  原付款约定\n逐字保留  ");
  options.failNextUpload = true;
  await page.getByLabel("上传签章原件").setInputFiles([
    { name: "签章.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") },
    { name: "签章照片.png", mimeType: "image/png", buffer: Buffer.from("synthetic photo") }
  ]);
  await expect(page.getByText("原件暂未上传成功，请重试。")).toBeVisible();
  await page.getByRole("button", { name: "重试剩余原件", exact: true }).click();
  await expect(page.getByText("签章照片.png", { exact: true })).toBeVisible();
  expect(uploads.map(item => item.name)).toEqual(["签章.pdf", "签章.pdf", "签章照片.png"]);
  expect(uploads[0]?.key).toBe(uploads[1]?.key);
  await page.getByRole("button", { name: "上移原件 2", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
  expect(saves[0]).toMatchObject({ draft: { draftData: { contractBasics: { settlementText: "  结算约定原文\n按纸面记录  " }, directSigningInput: {
    signedOn: "2026-11-08", enterpriseParty: { roleKey: "party_a", displayOrder: 0 },
    counterpartyParty: { roleKey: "party_b", displayOrder: 0 }, fixedPaymentTermsVersionId: null
  } } }, parties: [{ businessPartyVersionId: "controlled-a-v1" }, { businessPartyVersionId: "controlled-b-v2" }],
    paymentTerms: { originalText: "  原付款约定\n逐字保留  ", stages: [] },
    attachments: [{ slotKey: "direct_signed_originals_v1", fileId: "uploaded-photo", displayOrder: 0 },
      { slotKey: "direct_signed_originals_v1", fileId: "uploaded-pdf", displayOrder: 1 }] });
  await page.getByRole("textbox", { name: "付款约定原文", exact: true }).fill("");
  await page.getByRole("textbox", { name: "合同金额（元）", exact: true }).fill("0.0000");
  await number.fill("");
  options.qualifySavedInputs = true;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存，资料齐备", { exact: true })).toBeVisible();
  await expect(page.getByText("未注明编号", { exact: true })).toBeVisible();
  await expect(page.getByText("资料仅保存为草稿，当前尚不能正式登记。", { exact: true })).toBeVisible();
  for (const action of ["登记合同", "复制", "生成合同", "提交审批", "清理", "归档"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  expect(saves).toHaveLength(2);
  expect(saves[1]).toMatchObject({ expectedRevision: 2, draft: { originalSignedNumber: null, manualAmountYuan: "0.0000", draftData: { directSigningInput: {
    fixedPaymentTermsVersionId: "fixed-payment-terms"
  } } }, paymentTerms: { originalText: "", stages: [] } });
});

test("本机空间不足时在派发前保留输入且不发送保存", async ({ page, baseURL }) => {
  const { saves } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  const number = page.getByRole("textbox", { name: "原合同编号", exact: true });
  await number.fill("本机保留测试");
  await page.evaluate(() => {
    let low = 0;
    let high = 16 * 1024 * 1024;
    while (high - low > 1) {
      const count = Math.floor((low + high) / 2);
      try {
        localStorage.setItem("direct-pending-browser-quota-fixture", "x".repeat(count));
        low = count;
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
        high = count;
      }
    }
    if (low === 0 || high === 16 * 1024 * 1024) throw new Error("未观察到浏览器本机存储容量限制");
  });
  try {
    const save = page.getByRole("button", { name: "保存草稿", exact: true });
    await save.click();
    await expect(page.getByText("暂时无法在本机保留原保存请求，请恢复本机存储后再保存")).toBeVisible();
    expect(saves).toHaveLength(0);
    await expect(number).toHaveValue("本机保留测试");
    await expect(page.getByRole("button", { name: "核对保存结果", exact: true })).toHaveCount(0);
  } finally {
    await page.evaluate(() => localStorage.removeItem("direct-pending-browser-quota-fixture"));
  }
});


test("保存回包中断后从我的草稿用原键核对，结果未知和错误指纹都不重发", async ({ page, baseURL }) => {
  const { saves, lookups, versionReads, options, leaseAcquisitions } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  const number = page.getByRole("textbox", { name: "原合同编号", exact: true });
  await number.fill("  回读原编号  ");
  options.loseNextSave = true;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const checkResult = page.getByRole("button", { name: "核对保存结果", exact: true });
  await expect(checkResult).toBeVisible();
  expect(saves).toHaveLength(1);
  const originalKey = saves[0]?.idempotencyKey;
  expect(typeof originalKey).toBe("string");
  const leasesBeforeRecovery = leaseAcquisitions.length;

  await page.goto("/首页");
  await page.getByLabel("工作项台账").getByText("我的草稿", { exact: true }).click();
  await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(new URL(workbenchRoute, baseURL).href);
  await expect(number).toHaveValue("  回读原编号  ");
  await expect(number).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();

  options.lookupUnknown = true;
  await checkResult.click();
  await expect(page.getByText("尚未核对到本次保存，请保留输入并继续核对原结果")).toBeVisible();
  options.lookupUnknown = false;
  options.lookupWrongFingerprint = true;
  await checkResult.click();
  await expect(page.getByText("暂时无法核对本次保存，请保留输入并继续核对原结果")).toBeVisible();
  options.lookupWrongFingerprint = false;
  const previousReads = versionReads.length;
  await checkResult.click();
  await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
  expect(versionReads.length).toBeGreaterThan(previousReads);
  expect(lookups).toEqual([originalKey, originalKey, originalKey]);
  expect(saves).toHaveLength(1);
  expect(leaseAcquisitions).toHaveLength(leasesBeforeRecovery);
  await expect(number).toHaveValue("  回读原编号  ");
});

test("原键证明保存后又有更新时只采用最新精确回读且不重发", async ({ page, baseURL }) => {
  const { saves, lookups, options, leaseAcquisitions } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  const number = page.getByRole("textbox", { name: "原合同编号", exact: true });
  await number.fill("首次保存的原编号");
  options.loseNextSave = true;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const check = page.getByRole("button", { name: "核对保存结果", exact: true });
  options.latestRevisionOverride = 3;
  await check.click();
  await expect(page.getByText("保存已确认，暂无法刷新当前资料；请继续核对，暂不重复保存")).toBeVisible();
  await expect(number).toHaveValue("首次保存的原编号");
  options.latestRevisionOverride = null;
  options.advanceAfterSave = true;
  options.advanceBeforeFreshRead = true;
  await check.click();
  await expect(page.getByText("原草稿已保存，随后有更新，当前显示最新资料。")).toBeVisible();
  await expect(number).toHaveValue("精确回读的最新原编号");
  await expect(number).toBeDisabled();
  await expect(check).toHaveCount(0);
  expect(saves).toHaveLength(1);
  expect(leaseAcquisitions).toHaveLength(1);
  expect(lookups).toEqual([saves[0]?.idempotencyKey, saves[0]?.idempotencyKey]);
});

test("保存期间留页，同号草稿切换回来时拒绝晚到的旧核对响应", async ({ page, baseURL }, testInfo) => {
  const { saves, lookups, versionReads, options } = await openCreate(page, baseURL!, true);
  options.includeOtherDraft = true;
  await page.goto(workbenchRoute);
  const number = page.getByRole("textbox", { name: "原合同编号", exact: true });
  await number.fill("同一原编号");
  let releaseSaveResponse = () => {};
  let releaseLookupResponse = () => {};
  options.loseNextSave = true;
  options.saveResponseHold = new Promise<void>(resolve => { releaseSaveResponse = resolve; });
  options.lookupResponseHold = new Promise<void>(resolve => { releaseLookupResponse = resolve; });
  try {
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect.poll(() => saves.length).toBe(1);
    const home = testInfo.project.name === "mobile"
      ? page.getByRole("navigation", { name: "常用工作导航" }).getByRole("button", { name: "首页", exact: true })
      : page.getByRole("link", { name: "首页", exact: true });
    const keepPending = page.getByRole("button", { name: "保留本机输入并离开", exact: true });
    await home.click();
    await expect(page.getByRole("button", { name: "等待保存并离开", exact: true })).toBeVisible();
    await expect(keepPending).toHaveCount(0);
    await expect(page).toHaveURL(new URL(workbenchRoute, baseURL).href);
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    releaseSaveResponse();
    const check = page.getByRole("button", { name: "核对保存结果", exact: true });
    await check.click();
    await expect.poll(() => lookups.length).toBe(1);
    const openDraft = async (name: string) => {
      await home.click();
      if (name === "另一份同号合同") await keepPending.click();
      await page.getByLabel("工作项台账").getByText("我的草稿", { exact: true }).click();
      const row = testInfo.project.name === "mobile"
        ? page.getByRole("article").filter({ hasText: name })
        : page.getByRole("row").filter({ hasText: name });
      await row.getByText("继续填写合同", { exact: true }).click();
    };
    await openDraft("另一份同号合同");
    await expect(page).toHaveURL(new URL(otherWorkbenchRoute, baseURL).href);
    await expect(page.getByRole("textbox", { name: "合同名称", exact: true })).toHaveValue("另一份同号合同");
    await expect(number).toHaveValue("同一原编号");
    await openDraft("已签材料合同");
    await expect(page).toHaveURL(new URL(workbenchRoute, baseURL).href);
    await expect(page.getByRole("textbox", { name: "合同名称", exact: true })).toHaveValue("已签材料合同");
    await expect(check).toBeVisible();
    const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/contract-drafts/${versionId}/save-requests/${String(saves[0]?.idempotencyKey)}`);
    releaseLookupResponse();
    await lateResponse;
    await expect(check).toBeVisible();
    await check.click();
    await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
    expect(lookups).toEqual([saves[0]?.idempotencyKey, saves[0]?.idempotencyKey]);
    expect(versionReads).toContain(`/api/contract-drafts/${otherVersionId}/workbench`);
    expect(saves).toHaveLength(1);
  } finally { releaseSaveResponse(); releaseLookupResponse(); }
});

test("来源无效、暂不可核对、错配合同和租约占用均保留只读", async ({ page, baseURL }) => {
  const { saves, leaseAcquisitions, options } = await openCreate(page, baseURL!, true);
  const save = page.getByRole("button", { name: "保存草稿", exact: true });
  for (const state of ["invalid", "unavailable", "lease-held"] as const) {
    options.readState = state;
    await page.goto(workbenchRoute);
    await expect(page.getByRole("heading", { name: "已签合同资料", exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    if (state === "lease-held") await expect(page.getByText("当前为只读", { exact: false })).toBeVisible();
    else await expect(page.getByText("已签合同资料暂时无法核对，请稍后再试。", { exact: true })).toBeVisible();
  }
  options.readState = "wrong-pair";
  await page.goto(workbenchRoute);
  await expect(page.getByText("工作台返回的合同版本", { exact: false })).toBeVisible();
  await expect(save).toHaveCount(0);
  expect(leaseAcquisitions).toHaveLength(0);
  expect(saves).toHaveLength(0);
});

test("全局搜索为同号结果保留各自的合同和版本，详情拒绝时无其他版本回退", async ({ page, baseURL }) => {
  const { contractDetailReads, options } = await openCreate(page, baseURL!, true);
  options.includeOtherDraft = true;
  const matches = [
    { name: "可见同号直签合同", contractId: "visible-contract-other", versionId: "visible-version-other" },
    { name: "另一份同号直签合同", contractId, versionId }
  ];
  for (const match of matches) {
    await page.goto("/全局搜索");
    await page.getByRole("row").filter({ hasText: match.name }).getByText("打开", { exact: true }).click();
    await expect(page).toHaveURL(new URL(`/合同管理/${match.contractId}?versionId=${match.versionId}`, baseURL).href);
    await expect.poll(() => contractDetailReads.at(-1)).toBe(`/api/contracts/${match.contractId}?versionId=${match.versionId}`);
  }
  expect(contractDetailReads).toEqual(matches.map(match => `/api/contracts/${match.contractId}?versionId=${match.versionId}`));
});

test("已签资料接受公历早年且不读取转交人员", async ({ page, baseURL }) => {
  const { saves, approvalOptionReads } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  const day = page.getByRole("textbox", { name: "签订日期（选填）", exact: true });
  const save = page.getByRole("button", { name: "保存草稿", exact: true });
  for (const invalid of ["1900-02-29", " 2000-02-29", "0000-01-01", "2026-04-31"]) {
    await day.fill(invalid);
    await save.click();
    await expect(page.getByText("签订日期应为有效的年月日")).toBeVisible();
  }
  expect(saves).toHaveLength(0);
  await day.fill("0001-01-01");
  await save.click();
  await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
  expect(saves[0]).toMatchObject({ draft: { draftData: { directSigningInput: { signedOn: "0001-01-01" } } } });
  await day.fill("2000-02-29");
  await save.click();
  await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
  expect(saves[1]).toMatchObject({ draft: { draftData: { directSigningInput: { signedOn: "2000-02-29" } } } });
  await day.fill("");
  await save.click();
  await expect(page.getByText("草稿已保存，资料待补充", { exact: true })).toBeVisible();
  expect(saves[2]).toMatchObject({ draft: { draftData: { directSigningInput: { signedOn: null } } } });
  expect(approvalOptionReads).toHaveLength(0);
});

test("同一真实单位不得选择为双方，已持久化的无效资料可确认保存后只读", async ({ page, baseURL }) => {
  const { saves, options, lookups } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  await page.getByRole("button", { name: "查找单位", exact: true }).click();
  await page.getByPlaceholder("选择施工企业").click();
  await partyOption(page, "真实施工企业").click();
  await page.getByPlaceholder("选择施工企业资料版本").click();
  await partyOption(page, "真实施工企业 · 版本 1").click();
  await page.getByPlaceholder("选择相对方").click();
  await partyOption(page, "真实施工企业").click();
  await expect(page.getByText("签约双方请选择不同的合作单位。")).toBeVisible();
  await expect(page.getByPlaceholder("选择相对方资料版本")).toHaveCount(0);
  expect(saves).toHaveLength(0);

  options.invalidateSavedInputs = true;
  options.loseNextSave = true;
  const save = page.getByRole("button", { name: "保存草稿", exact: true });
  await save.click();
  const check = page.getByRole("button", { name: "核对保存结果", exact: true });
  await check.click();
  await expect(page.getByText("草稿已保存，资料待核对", { exact: true })).toBeVisible();
  await expect(check).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(saves).toHaveLength(1);
  expect(saves[0]?.parties).toEqual([{ roleKey: "party_a", displayOrder: 0, businessPartyVersionId: "controlled-a-v1", snapshot: { name: "真实施工企业" } }]);
  expect(lookups).toEqual([saves[0]?.idempotencyKey]);
});

test("已签创建提交后回包中断，保留选择且同页不得重复发出", async ({ page, baseURL }) => {
  const { options, creationRequests } = await openCreate(page, baseURL!, true);
  options.abortCreatedResponse = true;
  await page.getByPlaceholder("选择业务类型", { exact: true }).click();
  await page.getByText("材料采购", { exact: true }).last().click();
  await page.getByPlaceholder("可先留空，生成前选择", { exact: true }).click();
  await page.getByText("表外合同（施工企业与下游）", { exact: true }).last().click();
  await page.getByText("已签合同资料", { exact: true }).click();
  const create = page.getByRole("button", { name: "创建草稿", exact: true });
  await create.click();
  await expect(page.getByText("创建结果待核对，请先在我的草稿确认是否已创建。")).toBeVisible();
  await expect(create).toBeDisabled();
  await expect(page.getByRole("radio", { name: "已签合同资料" })).toBeChecked();
  await page.getByRole("button", { name: "前往首页核对我的草稿", exact: true }).click();
  await page.getByLabel("工作项台账").getByText("我的草稿", { exact: true }).click();
  await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(new URL(workbenchRoute, baseURL).href);
  expect(creationRequests).toHaveLength(1);
});

for (const delayedCapabilityStatus of [200, 401]) test(`等待旧租约预检时经公开设置切换账号，旧响应 ${delayedCapabilityStatus} 不污染新账号`, async ({ page, baseURL }, testInfo) => {
  const { options, versionReads, leaseAcquisitions, leaseReleases } = await openCreate(page, baseURL!, true);
  let release = () => {};
  options.delayedCapabilityStatus = delayedCapabilityStatus;
  options.acquireCapabilityHold = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.goto(workbenchRoute);
    await expect.poll(() => versionReads.length).toBe(2);
    await switchDraftAccount(page, testInfo.project.name === "mobile");
    await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new URL(otherWorkbenchRoute, baseURL).href);
    const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/contract-drafts/${versionId}/workbench`);
    release();
    expect((await staleResponse).status()).toBe(delayedCapabilityStatus);
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
    await expect(page).toHaveURL(new URL(otherWorkbenchRoute, baseURL).href);
    expect(leaseAcquisitions).toEqual([`/api/contract-drafts/${otherVersionId}/edit-lease`]);
    expect(leaseReleases).toEqual([]);
  } finally { release(); }
});

for (const [method, status, sameAccount] of [["GET", 401, false], ["POST", 401, false], ["POST", 403, false], ["POST", 401, true]] as const) {
  test(`直签新建旧 ${method} ${status} 回包不重试也不影响${sameAccount ? "同账号重新登录" : "新账号"}`, async ({ page, baseURL }, testInfo) => {
    const { options, createCapabilityActors, creationRequests } = await openCreate(page, baseURL!, true);
    let release = () => {};
    options.holdCreateFailure = { method, status, response: new Promise<void>(resolve => { release = resolve; }) };
    try {
      await page.getByPlaceholder("选择业务类型", { exact: true }).click();
      await page.getByText("材料采购", { exact: true }).last().click();
      await page.getByPlaceholder("可先留空，生成前选择", { exact: true }).click();
      await page.getByText("表外合同（施工企业与下游）", { exact: true }).last().click();
      await page.getByText("已签合同资料", { exact: true }).click();
      await page.getByRole("button", { name: "创建草稿", exact: true }).click();
      await expect.poll(() => method === "GET" ? createCapabilityActors.length : creationRequests.length).toBe(1);
      await switchDraftAccount(page, testInfo.project.name === "mobile", undefined, sameAccount ? "13900000000" : undefined);
      const path = method === "GET" ? "/api/contracts/create-capability" : "/api/contracts";
      const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
      release();
      const response = await staleResponse;
      expect(response.status()).toBe(status);
      expect(await response.finished()).toBeNull();
      await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
      await expect(page).toHaveURL(new URL(sameAccount ? workbenchRoute : otherWorkbenchRoute, baseURL).href);
      await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
      expect(createCapabilityActors).toEqual(["Bearer direct-owner"]);
      expect(creationRequests).toHaveLength(method === "POST" ? 1 : 0);
    } finally { release(); }
  });
}

test("已派发租约的迟到回包只能由原账号释放原令牌", async ({ page, baseURL }, testInfo) => {
  const { options, leaseAcquisitions, leaseReleases } = await openCreate(page, baseURL!, true);
  let release = () => {};
  options.grantHold = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.goto(workbenchRoute);
    await expect.poll(() => leaseAcquisitions.length).toBe(1);
    const home = testInfo.project.name === "mobile"
      ? page.getByRole("navigation", { name: "常用工作导航" }).getByRole("button", { name: "首页", exact: true })
      : page.getByRole("link", { name: "首页", exact: true });
    await home.click();
    await expect(page).toHaveURL(new URL("/首页", baseURL).href);
    release();
    const path = `/api/contract-drafts/${versionId}/edit-lease`;
    await expect.poll(() => leaseReleases).toEqual([{ path, actor: "Bearer direct-owner", token: `synthetic-lease:${path}` }]);
  } finally { release(); }
});

test("正常离开已持有的直签租约只释放原版本和令牌", async ({ page, baseURL }, testInfo) => {
  const { leaseReleases } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
  const home = testInfo.project.name === "mobile"
    ? page.getByRole("navigation", { name: "常用工作导航" }).getByRole("button", { name: "首页", exact: true })
    : page.getByRole("link", { name: "首页", exact: true });
  await home.click();
  await expect(page).toHaveURL(new URL("/首页", baseURL).href);
  const path = `/api/contract-drafts/${versionId}/edit-lease`;
  await expect.poll(() => leaseReleases).toEqual([{ path, actor: "Bearer direct-owner", token: `synthetic-lease:${path}` }]);
});

test("释放旧租约的预检在切换账号后到达时不派发删除", async ({ page, baseURL }, testInfo) => {
  const { options, versionReads, leaseReleases } = await openCreate(page, baseURL!, true);
  await page.goto(workbenchRoute);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
  let release = () => {};
  options.releaseCapabilityHold = new Promise<void>(resolve => { release = resolve; });
  try {
    const oldPath = `/api/contract-drafts/${versionId}/workbench`;
    await switchDraftAccount(page, testInfo.project.name === "mobile",
      async () => expect.poll(() => versionReads.filter(path => path === oldPath).length).toBe(3));
    const stale = page.waitForResponse(response => new URL(response.url()).pathname === oldPath);
    release();
    expect(await (await stale).finished()).toBeNull();
    await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
    expect(leaseReleases).toEqual([]);
  } finally { release(); }
});

for (const path of [`/api/contract-drafts/${versionId}/workbench`, "/api/contracts", "/api/business-parties", "/api/business-parties/controlled-a"]) {
  test(`旧直签读取 ${path} 的 401 不复用新会话`, async ({ page, baseURL }, testInfo) => {
    const { options, delayedReadActors, otherWorkbenchActors } = await openCreate(page, baseURL!, true);
    let release = () => {};
    const delayed = { path, response: new Promise<void>(resolve => { release = resolve; }) };
    try {
      if (path.endsWith("/workbench")) options.holdReadFailure = delayed;
      if (path === "/api/contracts") options.initialOriginalNumber = "受控编号";
      await page.goto(workbenchRoute);
      if (!path.endsWith("/workbench")) {
        await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
        if (path.endsWith("/controlled-a")) await page.getByRole("button", { name: "查找单位", exact: true }).click();
        options.holdReadFailure = delayed;
        if (path === "/api/contracts") await page.getByRole("button", { name: "核对同号", exact: true }).click();
        if (path === "/api/business-parties") await page.getByRole("button", { name: "查找单位", exact: true }).click();
        if (path.endsWith("/controlled-a")) {
          await page.getByPlaceholder("选择施工企业").click();
          await partyOption(page, "真实施工企业").click();
        }
      }
      await expect.poll(() => delayedReadActors.length).toBe(1);
      await switchDraftAccount(page, testInfo.project.name === "mobile");
      const stale = page.waitForResponse(response => new URL(response.url()).pathname === path && response.status() === 401);
      release();
      expect(await (await stale).finished()).toBeNull();
      await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
      await expect(page).toHaveURL(new URL(otherWorkbenchRoute, baseURL).href);
      await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
      expect(delayedReadActors).toEqual(["Bearer direct-owner"]);
      expect(otherWorkbenchActors).toEqual(["Bearer direct-other", "Bearer direct-other"]);
    } finally { release(); }
  });
}

for (const status of [201, 401] as const) {
  test(`普通初读触发旧账号刷新，迟到 ${status} 不覆盖或清理新账号`, async ({ page, baseURL }, testInfo) => {
    const { options, refreshActors, otherWorkbenchActors } = await openCreate(page, baseURL!, true);
    let release = () => {};
    options.holdReadFailure = { path: `/api/contract-drafts/${versionId}/workbench`, response: Promise.resolve() };
    options.holdRefresh = { status, response: new Promise<void>(resolve => { release = resolve; }) };
    try {
      await page.goto(workbenchRoute);
      await expect.poll(() => refreshActors).toEqual(["direct-owner"]);
      await switchDraftAccount(page, testInfo.project.name === "mobile");
      const stale = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/refresh" && response.status() === status);
      release();
      expect(await (await stale).finished()).toBeNull();
      await page.getByText("继续填写合同", { exact: true }).filter({ visible: true }).click();
      await expect(page).toHaveURL(new URL(otherWorkbenchRoute, baseURL).href);
      await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
      expect(otherWorkbenchActors).toEqual(["Bearer direct-other", "Bearer direct-other"]);
    } finally { release(); }
  });
}

test("当前会话初读和刷新均返回401时跳登录并保留回跳版本", async ({ page, baseURL }) => {
  const { options, delayedReadActors, refreshActors } = await openCreate(page, baseURL!, true);
  options.holdReadFailure = { path: `/api/contract-drafts/${versionId}/workbench`, response: Promise.resolve() };
  options.holdRefresh = { status: 401, response: Promise.resolve() };
  await page.goto(workbenchRoute);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("redirect") ?? "")).toBe(workbenchRoute);
  expect(delayedReadActors).toEqual(["Bearer direct-owner"]);
  expect(refreshActors).toEqual(["direct-owner"]);
});

test("对上Q2有序照片和PDF正式登记，响应未知后查询同一原键", async ({ page, baseURL }) => {
  await fillUpwardDraft(page, baseURL!, true);
  const requests: Array<Record<string, unknown>> = [], queries: string[] = [];
  let committed: Record<string, unknown> | null = null;
  await page.route(`**/api/contracts/${versionId}/signed-archive`, async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const fields = ["contract-direct-archive-request-v1", "2", "direct_signed", contractId, versionId, "direct-owner",
      body.idempotencyKey, String(body.expectedDraftRevision), body.expectedInputSha256, "2", ...(body.fileIds as string[]), "true"].map(String);
    const hash = createHash("sha256");
    for (const value of fields) hash.update(`${Buffer.byteLength(value)}:`).update(value);
    committed = { status: "archived", requestSha256: hash.digest("hex"), intent: body,
      result: { archiveId: "33333333-3333-4333-8333-333333333333", contractVersionId: versionId, status: "effective", fileIds: body.fileIds } };
    expectMockHttpFailure(page.context(), route.request().url(), 503);
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "登记响应暂未确认，请查询原请求" }) });
  });
  await page.route(`**/api/contracts/${versionId}/archive-requests/*`, async route => {
    queries.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(queries.length === 1 ? { status: "unknown" } : committed ?? { status: "unknown" }) });
  });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const register = page.getByRole("button", { name: "正式登记", exact: true });
  await expect(register).toBeEnabled();
  await register.click();
  await expect(page.getByText("请确认已保存的签章原件与纸面合同一致。正式登记完成后合同即生效。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect(page.getByRole("button", { name: "查询原登记结果", exact: true })).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ archiveProtocolVersion: 2, archiveSource: "direct_signed", expectedDraftRevision: 2,
    fileIds: ["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"], confirmedMatchingSignedDocument: true });
  await page.getByRole("button", { name: "查询原登记结果", exact: true }).click();
  await expect(page).toHaveURL(new URL(`/合同管理/${contractId}?versionId=${versionId}`, baseURL).href);
  expect(queries).toEqual([requests[0]!.idempotencyKey, requests[0]!.idempotencyKey]);
  expect(requests).toHaveLength(1);
});


for (const mimeType of ["image/jpeg", "image/png", "image/gif"]) {
  test(`表外照片原件登记坐标 ${mimeType}`, async ({ page, baseURL }) => {
    const { options } = await openCreate(page, baseURL!, true);
    options.outsideRegistration = true;
    options.qualifySavedInputs = true;
    // An untrusted source MIME must suppress registration even when capability is true.
    if (mimeType === "image/gif") options.savedMimeOverride = mimeType;
    await page.goto(workbenchRoute);
    await page.getByRole("textbox", { name: "签订日期（选填）", exact: true }).pressSequentially("2026-11-08");
    await page.getByRole("button", { name: "查找单位", exact: true }).click();
    await page.getByPlaceholder("选择施工企业").click();
    await partyOption(page, "真实施工企业").click();
    await page.getByPlaceholder("选择施工企业资料版本").click();
    await partyOption(page, "真实施工企业 · 版本 1").click();
    await page.getByPlaceholder("选择相对方").click();
    await partyOption(page, "真实相对方").click();
    await page.getByPlaceholder("选择相对方资料版本").click();
    await partyOption(page, "真实相对方 · 版本 2").click();
    await page.getByLabel("上传签章原件").setInputFiles({ name: "签章照片.png",
      mimeType: mimeType === "image/gif" ? "image/png" : mimeType, buffer: Buffer.from("synthetic photo") });
    await expect(page.getByText("签章照片.png", { exact: true })).toBeVisible();
    const requests: Array<Record<string, unknown>> = [];
    let receipt: Record<string, unknown> | null = null;
    await page.route(`**/api/contracts/${versionId}/signed-archive`, async route => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(body);
      const parts = ["contract-direct-archive-request-v1", "2", "direct_signed", contractId, versionId, "direct-owner",
        body.idempotencyKey, String(body.expectedDraftRevision), body.expectedInputSha256, "1", ...(body.fileIds as string[]), "true"].map(String);
      const hash = createHash("sha256");
      for (const value of parts) hash.update(`${Buffer.byteLength(value)}:`).update(value);
      const result = { archiveId: "33333333-3333-4333-8333-333333333333", contractVersionId: versionId, status: "effective",
        fileIds: ["22222222-2222-4222-8222-222222222222"] };
      receipt = { status: "archived", requestSha256: hash.digest("hex"), intent: body, result };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.route(`**/api/contracts/${versionId}/archive-requests/*`, async route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(receipt ?? { status: "unknown" }) }));
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByText("草稿已保存，资料齐备", { exact: true })).toBeVisible();
    const register = page.getByRole("button", { name: "正式登记", exact: true });
    if (mimeType === "image/gif") {
      await expect(register).toHaveCount(0);
      expect(requests).toHaveLength(0);
      return;
    }
    await expect(register).toBeEnabled();
    await register.click();
    await page.getByRole("button", { name: "确认登记", exact: true }).click();
    await expect(page).toHaveURL(new URL(`/合同管理/${contractId}?versionId=${versionId}`, baseURL).href);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ archiveProtocolVersion: 2, archiveSource: "direct_signed",
      expectedDraftRevision: 2, fileIds: ["22222222-2222-4222-8222-222222222222"], confirmedMatchingSignedDocument: true });
  });
}
