import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { Prisma } from "@prisma/client";
import { ContractEconomicReviewService } from "../contract-ledger/contract-economic-review.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

describe("任务12 当前正文正式提交（真实HTTP，合成持久层及私有文件）", () => {
  it.each([
    ["北京凌晨开始当日可提交", "2026-11-09T00:30:00+08:00", "2026-11-09", null, 201],
    ["北京凌晨停止当日不可提交", "2026-11-09T00:30:00+08:00", "2026-11-08", "2026-11-09", 400],
    ["北京普通时段开始当日可提交", "2026-11-09T13:30:00+08:00", "2026-11-09", null, 201],
    ["北京普通时段停止当日不可提交", "2026-11-09T13:30:00+08:00", "2026-11-08", "2026-11-09", 400]
  ] as const)("表内初稿 %s，当前公司v2与参与加入v1分别留存", async (_label, instant, startDay, endDay, expectedStatus) => {
    jest.useFakeTimers({ doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    jest.setSystemTime(new Date(instant));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const layout = await confirmedBodyLayout(server);
      const draft = await createTask09Draft(server);
      const companyId = randomUUID(), companyVersionId = randomUUID(), joiningVersionId = randomUUID();
      await server.store.prisma.companyEntity.create({ data: { id: companyId, isActive: true, dataStatus: "complete", currentVersionNo: 2 } });
      await server.store.prisma.companyEntityVersion.create({ data: { id: companyVersionId, companyEntityId: companyId, versionNo: 2, name: "当前选择我方公司", unifiedSocialCreditCode: "91310000123456789X", registeredAddress: "合成地址" } });
      await server.store.prisma.companyEntityVersion.create({ data: { id: joiningVersionId, companyEntityId: companyId, versionNo: 1, name: "加入项目时公司名", unifiedSocialCreditCode: "91310000123456789X", registeredAddress: "加入时地址" } });
      await server.store.prisma.projectParticipatingCompany.create({ data: { projectId: draft.projectId, companyEntityId: companyId, companyEntityVersionId: joiningVersionId, effectiveFrom: new Date(`${startDay}T00:00:00.000Z`), endedAt: endDay ? new Date(`${endDay}T00:00:00.000Z`) : null } });
      const original = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: original.version.draftRevision, changedSections: ["draft", "parties"],
        draft: { numericProtocolVersion: 2, companyEntityId: companyId, draftData: { contractName: "表内正式主体合成合同", contractBasics: { businessType: "material_purchase", relationship: "inside", amountBasis: "tax_inclusive", invoiceStatus: "pending" } }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
        parties: [{ roleKey: "party_b", displayOrder: 0, snapshot: { name: "当单相对方" } }], bills: original.bills.map((b: { billKey: string; revision: number }) => ({ billKey: b.billKey, expectedRevision: b.revision, numericProtocolVersion: 2, rows: [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      const saveResult = await saved.json();
      expect({ status: saved.status, body: saved.status === 200 ? null : saveResult }).toEqual({ status: 200, body: null });
      const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(r => r.json()) as Body;
      expect(body.sourceSha256).toBe(layout.sha256);
      expect(body.blocks.map(block => block.text)).toContain("甲方：当前选择我方公司");
      expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] })).status).toBe(200);
      const workbench = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
      const version = workbench.version;
      // Synthetic persisted ready output from the separately tested Task10 producer.
      // This test does not claim native Word/PDF rendering or real database commits.
      const docx = await server.files.uploadPrivateFile({ originalName: "当前合成正文.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("synthetic current Word"), sizeBytes: 22, uploadedByUserId: "staff" });
      const pdf = await server.files.uploadPrivateFile({ originalName: "当前合成正文.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic current PDF"), sizeBytes: 21, uploadedByUserId: "staff" });
      const document = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id, layoutTemplateVersionId: layout.id, purpose: "draft", status: "success", sourceRevision: version.draftRevision, inputSnapshot: { documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, templateFileId: (await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } }))!.docxFileId, layoutSourceMapping: { sourceSha256: layout.sha256 } }, idempotencyKey: randomUUID(), docxFileId: docx.id, pdfFileId: pdf.id, engineVersion: "synthetic-task10-output", createdByUserId: "staff" } });
      const input = { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, generatedDocumentId: document.id, sourceSha256: layout.sha256, blanksReviewed: true };
      const submitCurrent = () => fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      await server.store.prisma.companyEntity.update({ where: { id: companyId }, data: { currentVersionNo: 3 } });
      expect((await submitCurrent()).status).toBe(409);
      await server.store.prisma.companyEntity.update({ where: { id: companyId }, data: { currentVersionNo: 2, isActive: false } });
      expect((await submitCurrent()).status).toBe(409);
      await server.store.prisma.companyEntity.update({ where: { id: companyId }, data: { isActive: true } });
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
      const response = await fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      const result = await response.json();
      expect({ status: response.status, body: expectedStatus === 400 ? null : result }).toMatchObject({ status: expectedStatus, body: expectedStatus === 400 ? null : { status: "in_approval" } });
      if (expectedStatus === 400) {
        expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
        return;
      }
      const submitted = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      expect(submitted).toMatchObject({ signingSubjectType: "our_company", companyEntityIdSnapshot: companyId, companyEntityVersionId: companyVersionId, companyEntityNameSnapshot: "当前选择我方公司", amountYuan: null, documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint });
      expect((await server.store.prisma.projectParticipatingCompany.findFirst({ where: { projectId: draft.projectId } }))!.companyEntityVersionId).toBe(joiningVersionId);
      expect(submitted!.readinessSnapshot).toMatchObject({ signingIdentity: { occurredAt: new Date(instant).toISOString(), roleSource: "document_company_selection_party_a", company: { id: companyVersionId, roleKey: "party_a" } }, versionFacts: { signingSubjectType: "our_company", companyEntityVersionId: companyVersionId } });
    } finally { try { await server.app.close(); } finally { jest.useRealTimers(); } }
  });
  it("改选真实公司即使名称相同也更新正文修订及指纹，旧提交坐标不能冻结新主体", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const layout = await confirmedBodyLayout(server), draft = await createTask09Draft(server);
      expect((await saveInsideTask12Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const before = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
      expect((await saveInsideTask12Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
      expect(after.version.draftData.companyEntitySelection.name).toBe(before.version.draftData.companyEntitySelection.name);
      expect(after.version.draftData.companyEntitySelection.versionId).not.toBe(before.version.draftData.companyEntitySelection.versionId);
      expect(after.version.documentContentRevision).toBeGreaterThan(before.version.documentContentRevision);
      expect(after.version.documentContentFingerprint).not.toBe(before.version.documentContentFingerprint);
      const stale = await fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({ expectedRevision: before.version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: before.version.documentContentRevision, documentContentFingerprint: before.version.documentContentFingerprint, generatedDocumentId: randomUUID(), sourceSha256: layout.sha256, blanksReviewed: true }) });
      expect(stale.status).toBe(409);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
    } finally { await server.app.close(); }
  });
  it.each([
    ["material_purchase", "material_director", false, null, "project_staff", null],
    ["material_purchase", "material_director", false, null, "handler_director", null],
    ["material_purchase", "material_director", true, null, "project_staff", null],
    ["material_purchase", "material_director", true, null, "project_staff", "100.0054"],
    ["material_purchase", "material_director", true, null, "project_staff", "0.0000"],
    ["material_purchase", "material_director", true, "2026-11-09T00:30:00+08:00", "project_staff", null],
    ["material_purchase", "material_director", true, "2026-11-08T23:30:00+08:00", "project_staff", null],
    ["other", "comprehensive_director", false, null, "project_staff", null]
  ] as const)("%s %s 经营启用=%s，时刻=%s，原经办=%s，原金额=%s 空位已确认后冻结当前资料并创建五职责并联轮次，重放原结果", async (contractType, firstDutyRole, operatingEnabled, archiveInstant, handlerRole, sourceAmount) => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const previousWriteSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (operatingEnabled) process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "synthetic-source-only-writer-token";
    try {
      const layout = await confirmedBodyLayout(server, undefined, undefined, contractType);
      const draft = await createTask09Draft(server, "capped", contractType);
      const staffMembership = await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const initialSave = await saveInsideTask12Draft(server, draft, contractType, layout.id, contractType === "material_purchase");
      expect({ status: initialSave.status, error: initialSave.status === 200 ? null : await initialSave.json() }).toEqual({ status: 200, error: null });
      const selectedParty = await server.store.prisma.contractPartySnapshot.findFirst({ where: { contractVersionId: draft.version.id, roleKey: "party_b" } });
      const selectedPartyVersionId = typeof selectedParty?.businessPartyVersionId === "string" ? selectedParty.businessPartyVersionId : undefined;
      const billRows: Array<Record<string, unknown>> = sourceAmount === null ? [] : [{ clientRowKey: "task12-known-four-decimal", sortOrder: 0, itemName: "真实保存的四位元材料", unit: "吨", quantity: "1", unitPrice: sourceAmount, customData: {} }];
      const saveTask12Body = (value: unknown) => saveBody(draft, value, undefined, billRows, undefined, undefined, selectedPartyVersionId, null);
      const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(r => r.json()) as Body;
      expect(body.sourceSha256).toBe(layout.sha256);
      expect((await saveTask12Body( { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] })).status).toBe(200);
      const workbench = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
      const version = workbench.version;
      expect(version.amountYuan).toBe(sourceAmount);
      expect(version.defaultTaxRatePercent).toBeNull();
      // Synthetic persisted ready output from the separately tested Task10 producer.
      // This test does not claim native Word/PDF rendering or real database commits.
      const docx = await server.files.uploadPrivateFile({ originalName: "当前合成正文.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("synthetic current Word"), sizeBytes: 22, uploadedByUserId: "staff" });
      const pdf = await server.files.uploadPrivateFile({ originalName: "当前合成正文.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic current PDF"), sizeBytes: 21, uploadedByUserId: "staff" });
      const document = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id, layoutTemplateVersionId: layout.id, purpose: "draft", status: "success", sourceRevision: version.draftRevision, inputSnapshot: { documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, templateFileId: (await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } }))!.docxFileId, layoutSourceMapping: { sourceSha256: layout.sha256 } }, idempotencyKey: randomUUID(), docxFileId: docx.id, pdfFileId: pdf.id, engineVersion: "synthetic-task10-output", createdByUserId: "staff" } });
      const input = { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, generatedDocumentId: document.id, sourceSha256: layout.sha256, blanksReviewed: true };
      const rawSubmit = (body: unknown, headers = draft.headers) => fetch(`${draft.base}/submission`, { method: "POST", headers: { ...headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(body) });
      expect((await rawSubmit({ expectedRevision: input.expectedRevision, idempotencyKey: randomUUID() })).status).toBe(409);
      expect((await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval-submission`, { method: "POST", headers: draft.headers, body: "{}" })).status).toBe(410);
      for (const changed of [{ blanksReviewed: false }, { expectedRevision: input.expectedRevision - 1 }, { documentContentRevision: input.documentContentRevision + 1 }, { documentContentFingerprint: "f".repeat(64) }, { sourceSha256: "f".repeat(64) }, { generatedDocumentId: randomUUID() }]) {
        expect((await rawSubmit({ ...input, ...changed })).status).toBe(409);
        expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
      }
      const director = await loginTemplateActor(server, "director");
      expect((await rawSubmit(input, { ...draft.headers, authorization: `Bearer ${director}` })).status).toBe(403);
      await server.store.prisma.fileObject.update({ where: { id: pdf.id }, data: { contentSha256: "f".repeat(64) } });
      expect((await rawSubmit(input)).status).toBe(409);
      const { createHash } = await import("node:crypto");
      await server.store.prisma.fileObject.update({ where: { id: pdf.id }, data: { contentSha256: createHash("sha256").update("synthetic current PDF").digest("hex") } });
      const submit = () => fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      const response = await submit();
      const result = await response.json();
      expect({ status: response.status, result }).toMatchObject({ status: 201, result: { contractVersionId: draft.version.id, status: "in_approval" } });
      const submissionReceipt = await fetch(`${draft.base}/submission-requests/${input.idempotencyKey}`, { headers: draft.headers });
      expect({ status: submissionReceipt.status, body: await submissionReceipt.json() }).toMatchObject({ status: 200, body: { status: "submitted", result, requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u), intent: { expectedRevision: input.expectedRevision, submissionProtocolVersion: 2, documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint, generatedDocumentId: input.generatedDocumentId, sourceSha256: input.sourceSha256, blanksReviewed: true } } });
      const getReceipt = (key = input.idempotencyKey, headers = draft.headers) => fetch(`${draft.base}/submission-requests/${key}`, { headers });
      const auditBeforeReceiptChecks = await server.store.prisma.auditLog.count();
      expect(await (await getReceipt(randomUUID())).json()).toEqual({ status: "unknown" });
      expect((await getReceipt(input.idempotencyKey, { ...draft.headers, authorization: `Bearer ${director}` })).status).toBe(403);
      const originalReceipt = await server.store.prisma.contractDraftSubmissionRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      await server.store.prisma.contractDraftSubmissionRequest.update({ where: { idempotencyKey: input.idempotencyKey }, data: { requestSha256: "f".repeat(64) } });
      expect(await (await getReceipt()).json()).toEqual({ status: "unknown" });
      await server.store.prisma.contractDraftSubmissionRequest.update({ where: { idempotencyKey: input.idempotencyKey }, data: { requestSha256: originalReceipt!.requestSha256 } });
      for (const badResult of [{ ...result, formalCode: "另一正式编号" }, { contractVersionId: result.contractVersionId, approvalInstanceId: result.approvalInstanceId, status: result.status }]) {
        await server.store.prisma.contractDraftSubmissionRequest.update({ where: { idempotencyKey: input.idempotencyKey }, data: { responseSnapshot: badResult } });
        expect(await (await getReceipt()).json()).toEqual({ status: "unknown" });
      }
      await server.store.prisma.contractDraftSubmissionRequest.update({ where: { idempotencyKey: input.idempotencyKey }, data: { responseSnapshot: originalReceipt!.responseSnapshot } });
      expect(await server.store.prisma.auditLog.count()).toBe(auditBeforeReceiptChecks);
      const rounds = await server.store.prisma.approvalInstance.findMany({ where: { businessId: draft.version.id } });
      expect(rounds).toHaveLength(1);
      expect((await server.store.prisma.contract.findUnique({ where: { id: draft.contract.id } }))!.contractTypeKey).toBe(contractType);
      expect(rounds[0].frozenNodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ protocolVersion: 1, executionMode: "parallel", roleKeys: [firstDutyRole] }),
        expect.objectContaining({ roleKeys: ["contract_director"] }), expect.objectContaining({ roleKeys: ["project_manager"] }),
        expect.objectContaining({ roleKeys: ["finance_director"] }), expect.objectContaining({ roleKeys: ["chairman", "general_manager"] })
      ]));
      expect((rounds[0].frozenNodes as unknown[])).toHaveLength(5);
      const frozen = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      expect(frozen!.readinessSnapshot).toMatchObject({ submissionProtocolVersion: 2, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, amountYuan: sourceAmount, paymentTerms: { originalText: "", stages: [] } });
      expect(await (await submit()).json()).toEqual(result);
      expect((await rawSubmit({ ...input, sourceSha256: "e".repeat(64) })).status).toBe(409);
      expect((await rawSubmit(input, { ...draft.headers, authorization: `Bearer ${director}` })).status).toBe(409);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(1);
      const signatureBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
      const signature = await server.files.uploadPrivateFile({ originalName: "合成签字.png", mimeType: "image/png", sizeBytes: signatureBytes.length, buffer: signatureBytes, uploadedByUserId: "director" });
      await server.store.prisma.handwrittenSignatureVersion.create({ data: { userId: "director", source: "canvas", fileId: signature.id, contentSha256: createHash("sha256").update(signatureBytes).digest("hex") } });
      const coordinates = { decision: "approve", expectedContractUpdatedAt: frozen!.updatedAt, expectedApprovalInstanceId: rounds[0].id, expectedNodeIndex: 1, expectedApprovalUpdatedAt: rounds[0].updatedAt };
      const reviewRequest = async (patch: object = {}, token = director) => fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${token}` }, body: JSON.stringify({ ...coordinates, ...patch }) });
      for (const patch of [{ expectedNodeIndex: "1" }, { expectedNodeIndex: -1 }, { expectedNodeIndex: 99 }, { expectedNodeIndex: 0 }, { expectedApprovalInstanceId: randomUUID() }]) expect((await reviewRequest(patch)).status).toBe(403);
      expect((await reviewRequest({ expectedApprovalUpdatedAt: "2000-01-01T00:00:00.000Z" })).status).toBe(409);
      const technical = await loginTemplateActor(server, "technical");
      expect((await reviewRequest({}, technical)).status).toBe(403);
      expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: rounds[0].id } })).toBe(0);
      const review = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${director}` }, body: JSON.stringify({ decision: "approve", expectedContractUpdatedAt: frozen!.updatedAt, expectedApprovalInstanceId: rounds[0].id, expectedNodeIndex: 1, expectedApprovalUpdatedAt: rounds[0].updatedAt }) });
      expect({ status: review.status, body: await review.json() }).toMatchObject({ status: 201, body: { status: "in_approval" } });
      const afterReview = await server.store.prisma.approvalInstance.findUnique({ where: { id: rounds[0].id } });
      expect((afterReview!.frozenNodes as Array<Record<string, unknown>>)[1]).toMatchObject({ approvedRoleKeys: ["contract_director"] });
      expect((afterReview!.frozenNodes as Array<Record<string, unknown>>)[0]).toMatchObject({ approvedRoleKeys: [] });
      expect(await server.store.prisma.approvalActionLog.findMany({ where: { approvalInstanceId: rounds[0].id } })).toEqual([expect.objectContaining({ actorUserId: "director", approvedRoleKey: "contract_director", signatureFileIdSnapshot: signature.id, signatureSha256Snapshot: createHash("sha256").update(signatureBytes).digest("hex") })]);
      expect((await reviewRequest()).status).toBe(403);
      const currentVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      const withdrawal = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval-withdrawal`, { method: "POST", headers: draft.headers, body: JSON.stringify({ expectedContractUpdatedAt: currentVersion!.updatedAt, expectedApprovalInstanceId: rounds[0].id, expectedNodeIndex: 0, expectedApprovalUpdatedAt: afterReview!.updatedAt }) });
      expect({ status: withdrawal.status, body: await withdrawal.json() }).toMatchObject({ status: 201, body: { status: "draft" } });
      expect((await server.store.prisma.approvalInstance.findUnique({ where: { id: rounds[0].id } }))!.status).toBe("withdrawn");
      expect(await (await getReceipt()).json()).toMatchObject({ status: "submitted", result, intent: { documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint } });
      expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: rounds[0].id, action: "approve" } })).toBe(1);
      expect((await reviewRequest()).status).toBe(409);
      const editable = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(r => r.json()) as Body;
      const ordinary = editable.blocks.find(block => block.text.startsWith("手工条款："))!;
      const changed = await saveTask12Body( { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: "手工条款：撤回后修改，所有职责须重新签字。" }], additions: [] });
      expect(changed.status === 200 ? "OK" : await changed.text()).toBe("OK");
      expect((await rawSubmit({ ...input, idempotencyKey: randomUUID() })).status).toBe(409);
      const revised = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
      expect(revised.version.documentContentFingerprint).not.toBe(input.documentContentFingerprint);
      expect(await (await getReceipt()).json()).toMatchObject({ status: "submitted", result, intent: { expectedRevision: input.expectedRevision, documentContentFingerprint: input.documentContentFingerprint } });
      const revisedWordBytes = Buffer.from(`合成修订Word事实:${revised.version.documentContentFingerprint}`);
      const revisedPdfBytes = Buffer.from(`合成修订PDF事实:${revised.version.documentContentFingerprint}`);
      const revisedWord = await server.files.uploadPrivateFile({ originalName: "修订合成.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: revisedWordBytes, sizeBytes: revisedWordBytes.length, uploadedByUserId: "staff" });
      const revisedPdf = await server.files.uploadPrivateFile({ originalName: "修订合成.pdf", mimeType: "application/pdf", buffer: revisedPdfBytes, sizeBytes: revisedPdfBytes.length, uploadedByUserId: "staff" });
      const secondDocument = await server.store.prisma.contractGeneratedDocument.create({ data: { ...document, id: randomUUID(), docxFileId: revisedWord.id, pdfFileId: revisedPdf.id, sourceRevision: revised.version.draftRevision, idempotencyKey: randomUUID(), inputSnapshot: { ...((document as unknown as Record<string, unknown>).inputSnapshot as object), documentContentRevision: revised.version.documentContentRevision, documentContentFingerprint: revised.version.documentContentFingerprint } } });
      const second = await rawSubmit({ ...input, idempotencyKey: randomUUID(), expectedRevision: revised.version.draftRevision, documentContentRevision: revised.version.documentContentRevision, documentContentFingerprint: revised.version.documentContentFingerprint, generatedDocumentId: secondDocument.id });
      const secondResult = await second.json();
      expect({ status: second.status, body: secondResult }).toMatchObject({ status: 201, body: { status: "in_approval" } });
      expect(secondResult.approvalInstanceId).not.toBe(rounds[0].id);
      const originalRound = await server.store.prisma.approvalInstance.findUnique({ where: { id: rounds[0].id } });
      expect((originalRound!.frozenNodes as Array<Record<string, unknown>>)[0].submissionSnapshot).toMatchObject({ documentContentFingerprint: input.documentContentFingerprint, generatedDocumentId: document.id });
      const secondRound = await server.store.prisma.approvalInstance.findUnique({ where: { id: secondResult.approvalInstanceId } });
      expect((secondRound!.frozenNodes as Array<Record<string, unknown>>).every(node => Array.isArray(node.approvedRoleKeys) && node.approvedRoleKeys.length === 0)).toBe(true);
      expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: rounds[0].id, action: "approve" } })).toBe(1);
      expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: secondRound!.id } })).toBe(0);
      const employee = await loginTemplateActor(server, "employee");
      const secondVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      const delegatedReview = async (token = employee) => fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${token}` }, body: JSON.stringify({ ...coordinates, expectedContractUpdatedAt: secondVersion!.updatedAt, expectedApprovalInstanceId: secondRound!.id, expectedApprovalUpdatedAt: secondRound!.updatedAt }) });
      const mandate = await server.store.prisma.approvalDelegation.create({ data: { fromUserId: "director", toUserId: "employee", actionKey: "contract.approve", resourceType: "contract_approval_duty", resourceId: `${secondRound!.id}:1`, enabled: true, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 600_000) } });
      for (const patch of [{ actionKey: "settlement.approve" }, { resourceType: "spot_procurement_approval_duty" }, { resourceId: `${rounds[0].id}:1` }, { enabled: false }, { endsAt: new Date(Date.now() - 1) }]) {
        await server.store.prisma.approvalDelegation.update({ where: { id: mandate.id }, data: patch });
        expect((await delegatedReview()).status).toBe(403);
        await server.store.prisma.approvalDelegation.update({ where: { id: mandate.id }, data: { actionKey: "contract.approve", resourceType: "contract_approval_duty", resourceId: `${secondRound!.id}:1`, enabled: true, endsAt: new Date(Date.now() + 600_000) } });
      }
      await server.store.prisma.approvalDelegation.create({ data: { ...mandate, id: randomUUID(), toUserId: "technical" } });
      expect((await delegatedReview(technical)).status).toBe(403);
      const currentDirectorPosition = await server.store.prisma.userPosition.findFirst({ where: { userId: "director", positionId: "contract_director", projectId: null } });
      await server.store.prisma.userPosition.deleteMany({ where: { id: currentDirectorPosition!.id } });
      expect((await delegatedReview()).status).toBe(403);
      await server.store.prisma.userPosition.create({ data: currentDirectorPosition! });
      expect((await delegatedReview()).status).toBe(400); // Own actual signature is required.
      const employeeSignature = await server.files.uploadPrivateFile({ originalName: "合成受托人签字.png", mimeType: "image/png", buffer: signatureBytes, sizeBytes: signatureBytes.length, uploadedByUserId: "employee" });
      await server.store.prisma.handwrittenSignatureVersion.create({ data: { userId: "employee", source: "canvas", fileId: employeeSignature.id, contentSha256: createHash("sha256").update(signatureBytes).digest("hex") } });
      const delegated = await delegatedReview();
      expect({ status: delegated.status, body: await delegated.json() }).toMatchObject({ status: 201, body: { status: "in_approval" } });
      expect(await server.store.prisma.approvalActionLog.findMany({ where: { approvalInstanceId: secondRound!.id } })).toEqual([expect.objectContaining({ actorUserId: "employee", representedUserId: "director", approvedRoleKey: "contract_director", signatureFileIdSnapshot: employeeSignature.id, metadata: expect.objectContaining({ delegationId: mandate.id }) })]);
      const remainingDuties = [
        { index: 3, actor: "finance", role: "finance_director", projectId: null },
        { index: 0, actor: "employee", role: firstDutyRole, projectId: null },
        { index: 2, actor: "manager", role: "project_manager", projectId: draft.projectId },
        { index: 4, actor: "staff", role: "general_manager", projectId: null }
      ];
      for (const duty of remainingDuties) {
        await server.store.prisma.position.upsert({ where: { id: duty.role }, create: { id: duty.role, key: duty.role }, update: {} });
        await server.store.prisma.userPosition.create({ data: { userId: duty.actor, positionId: duty.role, projectId: duty.projectId } });
        const signingFile = await server.files.uploadPrivateFile({ originalName: "合成审批签字.png", mimeType: "image/png", buffer: signatureBytes, sizeBytes: signatureBytes.length, uploadedByUserId: duty.actor });
        await server.store.prisma.handwrittenSignatureVersion.create({ data: { userId: duty.actor, source: "canvas", fileId: signingFile.id, contentSha256: createHash("sha256").update(signatureBytes).digest("hex") } });
        const actorToken = await loginTemplateActor(server, duty.actor);
        const current = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
        const round = await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRound!.id } });
        if (duty.actor === "staff") {
          const selfReviewBase = { decision: "approve", expectedContractUpdatedAt: current!.updatedAt, expectedApprovalInstanceId: round!.id, expectedNodeIndex: duty.index, expectedApprovalUpdatedAt: round!.updatedAt };
          for (const confirmation of [{}, { selfReviewReason: "本人自审" }, { selfReviewReason: "本人自审", confirmationPassword: "wrong-synthetic-password" }]) {
            const denied = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${actorToken}` }, body: JSON.stringify({ ...selfReviewBase, ...confirmation }) });
            expect(denied.status).toBe(400);
            expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          }
        }
        const approval = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${actorToken}` }, body: JSON.stringify({ decision: "approve", expectedContractUpdatedAt: current!.updatedAt, expectedApprovalInstanceId: round!.id, expectedNodeIndex: duty.index, expectedApprovalUpdatedAt: round!.updatedAt, ...(duty.actor === "staff" ? { selfReviewReason: "本人承担总经理职责并确认当前全部正文", confirmationPassword: server.password } : {}) }) });
        expect({ status: approval.status, body: await approval.json() }).toMatchObject({ status: 201, body: { status: duty.index === 4 ? "approved_pending_seal" : "in_approval" } });
        if (duty.index !== 4) expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      }
      expect(await server.store.prisma.contractSealTask.findMany({ where: { contractVersionId: draft.version.id } })).toEqual([expect.objectContaining({ approvalInstanceId: secondRound!.id, handlerUserId: "staff", status: "in_seal", approvedByUserId: "staff", approvedAt: expect.any(Date) })]);
      expect(await server.store.prisma.auditLog.count({ where: { businessType: "contract_version", businessId: draft.version.id, action: "contract.seal_task.create" } })).toBe(1);
      const lastApproval = await server.store.prisma.approvalActionLog.findFirst({ where: { approvalInstanceId: secondRound!.id, approvedRoleKey: "general_manager", action: "approve" } });
      const handoffTask = await server.store.prisma.contractSealTask.findFirst({ where: { approvalInstanceId: secondRound!.id } });
      expect(handoffTask!.approvedAt).toEqual(lastApproval!.createdAt);
      expect((await server.store.prisma.auditLog.findFirst({ where: { businessId: draft.version.id, action: "contract.seal_task.create" } }))!.metadata).toMatchObject({ handoffKind: "parallel_approval_released_for_offline_seal", internalApprovalActionId: lastApproval!.id, internalApproverUserId: "staff" });
      const fullyApproved = await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRound!.id } });
      const fullyApprovedVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      const tooLateWithdrawal = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/approval-withdrawal`, { method: "POST", headers: draft.headers, body: JSON.stringify({ expectedContractUpdatedAt: fullyApprovedVersion!.updatedAt, expectedApprovalInstanceId: fullyApproved!.id, expectedNodeIndex: 5, expectedApprovalUpdatedAt: fullyApproved!.updatedAt }) });
      expect(tooLateWithdrawal.status).toBe(409);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal_task.create" } })).toBe(1);
      await server.store.prisma.position.upsert({ where: { id: "comprehensive_director" }, create: { id: "comprehensive_director", key: "comprehensive_director" }, update: {} });
      await server.store.prisma.userPosition.create({ data: { userId: "director", positionId: "comprehensive_director", projectId: null } });
      const sealTask = await server.store.prisma.contractSealTask.findFirst({ where: { contractVersionId: draft.version.id } });
      const sealConfirmation = { expectedApprovalInstanceId: secondRound!.id, expectedSealTaskId: sealTask!.id, documentContentRevision: revised.version.documentContentRevision, documentContentFingerprint: revised.version.documentContentFingerprint, confirmed: true };
      const confirmSeal = async (patch: object = {}, token = director) => fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/seal-confirmation`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${token}` }, body: JSON.stringify({ ...sealConfirmation, ...patch }) });
      for (const patch of [{ expectedApprovalInstanceId: rounds[0].id }, { expectedSealTaskId: randomUUID() }, { documentContentRevision: sealConfirmation.documentContentRevision + 1 }, { documentContentFingerprint: "f".repeat(64) }]) expect((await confirmSeal(patch)).status).toBe(409);
      expect((await confirmSeal({ confirmed: false })).status).toBe(400);
      const staff = await loginTemplateActor(server, "staff");
      expect((await confirmSeal({}, staff)).status).toBe(403);
      await server.store.prisma.userPosition.create({ data: { userId: "technical", positionId: "comprehensive_director", projectId: null } });
      expect((await confirmSeal({}, technical)).status).toBe(403);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal.complete" } })).toBe(0);
      for (const [path, body] of [["seal-approval", {}], ["seal/approve", { confirmationPassword: server.password }], ["seal/complete", { firstPartySignedOrStamped: true, companySealCompleted: true, crossPageSealCompleted: true, signingDateCompleted: true }]] as const) {
        const legacy = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/${path}`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${director}` }, body: JSON.stringify(body) });
        expect({ status: legacy.status, body: await legacy.json() }).toMatchObject({ status: 409, body: { message: "新版合同请使用当前轮次的盖章确认入口" } });
      }
      const beforeSealTodo = await fetch(`${await server.app.getUrl()}/me/work-items`, { headers: { ...draft.headers, authorization: `Bearer ${director}` } });
      const sealTodo = await beforeSealTodo.json();
      expect({ status: beforeSealTodo.status, pending: sealTodo.queues?.pending }).toMatchObject({ status: 200, pending: expect.arrayContaining([expect.objectContaining({ businessId: draft.version.id, currentNode: "确认已盖章", nextAction: "核对线下盖章完成后确认" })]) });
      const sealed = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/seal-confirmation`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${director}` }, body: JSON.stringify(sealConfirmation) });
      const sealResult = await sealed.json();
      expect({ status: sealed.status, body: sealResult }).toMatchObject({ status: 201, body: { status: "seal_approved_pending_archive" } });
      expect(await (await confirmSeal()).json()).toEqual(sealResult);
      expect((await confirmSeal({ expectedSealTaskId: randomUUID() })).status).toBe(409);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal.complete" } })).toBe(1);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive_task.create" } })).toBe(1);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessType: "contract_seal" } })).toBe(0);
      const archiveTodoResponse = await fetch(`${await server.app.getUrl()}/me/work-items`, { headers: draft.headers });
      const archiveTodo = await archiveTodoResponse.json();
      expect(archiveTodoResponse.status).toBe(200);
      expect(archiveTodo.queues.pending.filter((item: { businessId: string; type: string }) => item.businessId === draft.version.id && item.type === "archive")).toEqual([expect.objectContaining({ currentNode: "归档双方签章原件", nextAction: "上传双方签章PDF后直接归档生效", amountText: sourceAmount === null ? "金额待确定" : `${sourceAmount} 元` })]);

      if (contractType === "material_purchase") {
        await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "finance", positionKey: "finance_staff" } });
        if (archiveInstant) {
          jest.useFakeTimers({ doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
          jest.setSystemTime(new Date(archiveInstant));
          draft.headers.authorization = `Bearer ${await loginTemplateActor(server, "staff")}`;
        }
        if (operatingEnabled) {
          await server.store.prisma.project.update({ where: { id: draft.projectId }, data: { operatingLedgerEffectiveDate: new Date(archiveInstant ? "2026-11-09T00:00:00.000Z" : "2026-11-01T00:00:00.000Z") } });
          const controlledParties = await server.store.prisma.contractPartySnapshot.findMany({ where: { contractVersionId: draft.version.id, roleKey: "party_b" } });
          expect(controlledParties).toEqual([expect.objectContaining({ businessPartyVersionId: expect.any(String) })]);
          const affiliateId = randomUUID(), affiliateVersionId = randomUUID();
          await server.store.prisma.projectAffiliateAssignment.create({ data: { projectId: draft.projectId, businessPartyId: affiliateId, businessPartyVersionId: affiliateVersionId, affiliateNameSnapshot: "合成施工企业", affiliateCreditCodeSnapshot: "91310000123456789A", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null } });
        }
        if (handlerRole === "handler_director") {
          await server.store.prisma.projectMember.delete({ where: { id: staffMembership.id } });
          await server.store.prisma.userPosition.deleteMany({ where: { userId: "staff", positionId: "contract_staff", projectId: null } });
          await server.store.prisma.userPosition.create({ data: { userId: "staff", positionId: "contract_director", projectId: null } });
        }
        if (sourceAmount !== null && sourceAmount !== "0.0000") {
          // Adjacent source is a synthetic persisted draft, not a fabricated
          // commitment result. The real professional-review public service
          // calculates and freezes the coverage before archive reads it.
          const otherContract = await server.store.prisma.contract.create({ data: { projectId: draft.projectId, ownerUserId: "staff", name: "另一份合成材料文书", counterparty: "另一合作单位", temporaryCode: "REVIEW-OTHER", code: null } });
          await server.store.prisma.contractVersion.create({ data: { contractId: otherContract.id, numericProtocolVersion: 1, versionNo: 1, changeType: "original", signingSubjectType: "our_company", amountCents: 20000n, amountYuan: null, amountLimitType: "capped", documentContentRevision: 1 } });
          const economic = server.app.get(ContractEconomicReviewService);
          const prepared = await economic.prepare("staff", { projectId: draft.projectId, leftSourceRef: `contract:${draft.contract.id}`, rightSourceRef: `contract:${otherContract.id}`, relation: "shared_evidence", coverage: [{ scope: "已核对同一批次材料", leftAmountYuan: "6.0000", rightAmountYuan: "8.0000", owner: "right" }], reason: "按真实覆盖部分确认归属", idempotencyKey: randomUUID(), confirmationPassword: server.password });
          const confirmedReview = await economic.decide("director", prepared.id, { revision: prepared.revision, decision: "confirm", confirmationPassword: server.password });
          expect(confirmedReview.status).toBe("confirmed");
        }
        const signedPdf = await PDFDocument.create();
        signedPdf.addPage().drawText("SYNTHETIC BOTH-SIGNED CONTRACT - fake storage boundary");
        const signedBytes = Buffer.from(await signedPdf.save());
        const signedFile = await server.files.uploadPrivateFile({ originalName: "合成双方签章原件.pdf", mimeType: "application/pdf", buffer: signedBytes, sizeBytes: signedBytes.length, uploadedByUserId: "staff" });
        const signedAppendix = await PDFDocument.create(); signedAppendix.addPage().drawText("SYNTHETIC SIGNED APPENDIX");
        const appendixBytes = Buffer.from(await signedAppendix.save());
        const appendixFile = await server.files.uploadPrivateFile({ originalName: "合成双方签章附件.pdf", mimeType: "application/pdf", buffer: appendixBytes, sizeBytes: appendixBytes.length, uploadedByUserId: "staff" });
        const serverUrl = await server.app.getUrl();
        const archiveInput = { archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: randomUUID(), expectedApprovalInstanceId: secondRound!.id, expectedSealTaskId: sealTask!.id, documentContentRevision: sealConfirmation.documentContentRevision, documentContentFingerprint: sealConfirmation.documentContentFingerprint, fileIds: [signedFile.id, appendixFile.id], confirmedMatchingSignedDocument: true };
        const sendArchive = (body: unknown = archiveInput, headers = draft.headers) => fetch(`${serverUrl}/contracts/${draft.version.id}/signed-archive`, { method: "POST", headers, body: JSON.stringify(body) });
        if (!operatingEnabled && handlerRole === "project_staff") {
          await server.store.prisma.projectMember.delete({ where: { id: staffMembership.id } });
          expect((await sendArchive()).status).toBe(403);
          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          await server.store.prisma.projectMember.create({ data: staffMembership });
        }
        const archiveDocumentId = String(((secondRound!.frozenNodes as Array<Record<string, unknown>>)[0].submissionSnapshot as Record<string, unknown>).generatedDocumentId);
        const archiveDocument = await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: archiveDocumentId } });
        const originalTrace = archiveDocument!.inputSnapshot as Prisma.JsonObject;
        await server.store.prisma.contractGeneratedDocument.update({ where: { id: archiveDocumentId }, data: { inputSnapshot: { ...originalTrace, documentContentFingerprint: "f".repeat(64) } } });
        expect((await sendArchive()).status).toBe(409);
        expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
        await server.store.prisma.contractGeneratedDocument.update({ where: { id: archiveDocumentId }, data: { inputSnapshot: originalTrace } });
        const readArchiveResult = (key = archiveInput.idempotencyKey) => fetch(`${serverUrl}/contracts/${draft.version.id}/archive-requests/${key}`, { headers: draft.headers });
        const beforeArchiveResult = await readArchiveResult();
        expect({ status: beforeArchiveResult.status, body: await beforeArchiveResult.json() }).toEqual({ status: 200, body: { status: "unknown" } });
        for (const unavailable of ["busy", "missing"] as const) {
          server.store.archiveBindingLockResult = unavailable;
          const locked = await sendArchive();
          expect({ status: locked.status, body: await locked.json() }).toMatchObject({ status: unavailable === "busy" ? 409 : 503, body: { message: expect.stringContaining(unavailable === "busy" ? "文件绑定正在办理" : "文件绑定锁结果尚未确认") } });
          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect(await server.store.prisma.contractArchiveEvidenceFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.status).toBe("seal_approved_pending_archive");
          expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive.complete" } })).toBe(0);
          expect(await (await readArchiveResult()).json()).toEqual({ status: "unknown" });
        }
        server.store.archiveBindingLockResult = "available";
        if (!operatingEnabled) {
          server.store.archiveCommitOutcome = "return_without_persisting";
          const uncertain = await sendArchive();
          expect({ status: uncertain.status, body: await uncertain.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("归档结果尚未确认") } });
          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive.complete" } })).toBe(0);
          expect(await (await readArchiveResult()).json()).toEqual({ status: "unknown" });
          server.store.archiveCommitOutcome = "persist";
          // This explicit next POST models the operator's new deliberate action;
          // neither the archive service nor its GET re-sends automatically.
        }
        const archive = await sendArchive();
        const archiveResult = await archive.json();
        expect({ status: archive.status, body: archiveResult }).toMatchObject({ status: 201, body: { contractVersionId: draft.version.id, status: "effective" } });
        const archiveReceipt = await readArchiveResult();
        expect({ status: archiveReceipt.status, body: await archiveReceipt.json() }).toMatchObject({ status: 200, body: { status: "archived", result: archiveResult, requestSha256: expect.any(String), intent: archiveInput } });
        expect((await (await readArchiveResult(randomUUID())).json())).toEqual({ status: "unknown" });
        expect((await sendArchive({ ...archiveInput, fileIds: [...archiveInput.fileIds].reverse() })).status).toBe(409);
        server.store.archiveBindingLockResult = "busy";
        const replayArchive = await sendArchive();
        expect({ status: replayArchive.status, body: await replayArchive.json() }).toEqual({ status: 201, body: archiveResult });
        expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive.complete" } })).toBe(1);
        server.store.archiveBindingLockResult = "available";
        const doneTodo = await fetch(`${serverUrl}/me/work-items`, { headers: draft.headers }).then(response => response.json());
        expect(doneTodo.queues.pending.filter((item: { businessId: string; type: string }) => item.businessId === draft.version.id && item.type === "archive")).toEqual([]);
        const detailResponse = await fetch(`${serverUrl}/contracts/${draft.contract.id}`, { headers: draft.headers });
        const detail = await detailResponse.json();
        expect({ status: detailResponse.status, files: detail.archiveFiles }).toMatchObject({ status: 200, files: [
          { archiveRecordId: archiveResult.archiveId, archiveProtocolVersion: 2, displayOrder: 0, fileId: signedFile.id },
          { archiveRecordId: archiveResult.archiveId, archiveProtocolVersion: 2, displayOrder: 1, fileId: appendixFile.id }
        ] });
        const archiveListResponse = await fetch(`${serverUrl}/archives?limit=50`, { headers: draft.headers });
        const archiveList = await archiveListResponse.json();
        expect({ status: archiveListResponse.status, body: archiveList }).toMatchObject({ status: 200, body: { rows: [
          { archiveRecordId: archiveResult.archiveId, archiveProtocolVersion: 2, displayOrder: 0, fileId: signedFile.id, fileSource: "合成双方签章原件.pdf", documentNo: result.formalCode },
          { archiveRecordId: archiveResult.archiveId, archiveProtocolVersion: 2, displayOrder: 1, fileId: appendixFile.id, fileSource: "合成双方签章附件.pdf", documentNo: result.formalCode }
        ], summary: { total: 2, contractArchives: 2 } } });
        const financeToken = await loginTemplateActor(server, "finance");
        for (const [file, bytes] of [[signedFile, signedBytes], [appendixFile, appendixBytes]] as const) {
          const ticketResponse = await fetch(`${serverUrl}/files/${file.id}/download-ticket`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${financeToken}` }, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对合同归档原件" }) });
          const ticket = await ticketResponse.json();
          expect({ status: ticketResponse.status, body: ticket }).toMatchObject({ status: 201, body: { fileId: file.id, downloadUrl: expect.any(String) } });
          const download = await fetch(`${serverUrl}${ticket.downloadUrl}`);
          expect(download.status).toBe(200);
          expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
        }
        if (!operatingEnabled && handlerRole === "project_staff") {
          await server.store.prisma.project.update({ where: { id: draft.projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-11-01T00:00:00.000Z") } });
          const lateResult = await readArchiveResult();
          expect({ status: lateResult.status, body: await lateResult.json() }).toMatchObject({ status: 200, body: { status: "archived", result: archiveResult } });
          expect(await server.store.prisma.operatingFact.count({ where: { projectId: draft.projectId } })).toBe(0);
          const frozenNotApplicable = await server.store.prisma.contractArchiveFile.findUnique({ where: { id: archiveResult.archiveId } });
          expect(frozenNotApplicable!.authoritySnapshot).toMatchObject({ operatingConsequence: { mode: "not_applicable", operatingLedgerEffectiveDateSnapshot: null, expectedSource: null } });
          await server.store.prisma.projectAffiliateAssignment.create({ data: { projectId: draft.projectId, businessPartyId: randomUUID(), businessPartyVersionId: randomUUID(), affiliateNameSnapshot: "合成施工企业", affiliateCreditCodeSnapshot: "91310000123456789A", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null } });
          process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "synthetic-source-only-writer-token";
          // Separate, explicit formal replay uses the existing public service.
          // The result GET above did not create or queue this fact.
          await server.app.get(OperatingSourceReplayService).replaySource({ projectId: draft.projectId, sourceType: "contract_version", sourceBusinessId: draft.version.id }, "finance");
          expect(await server.store.prisma.operatingFact.count({ where: { projectId: draft.projectId } })).toBe(1);
          expect(await (await readArchiveResult()).json()).toMatchObject({ status: "archived", result: archiveResult });
          expect((await server.store.prisma.contractArchiveFile.findUnique({ where: { id: archiveResult.archiveId } }))!.authoritySnapshot).toEqual(frozenNotApplicable!.authoritySnapshot);
        }
        if (operatingEnabled) {
          const view = await server.app.get(OperatingProjectionService).getProjectView("finance", { projectId: draft.projectId, numericProtocolVersion: 2 });
          expect(view).toMatchObject({ schema: "operating_projection/V2", commitments: { contractCommitmentYuan: sourceAmount === null ? null : sourceAmount === "0.0000" ? "0.0000" : "94.0054", knownContractCommitmentYuan: sourceAmount === null || sourceAmount === "0.0000" ? "0.0000" : "94.0054", unknownContractCommitmentCount: sourceAmount === null ? 1 : 0 } });
          const fact = await server.store.prisma.operatingFact.findFirst({ where: { projectId: draft.projectId, sourceType: "contract_version", sourceBusinessId: draft.version.id } });
          const impact = await server.store.prisma.operatingImpactEntry.findFirst({ where: { factId: fact!.id } });
          const current = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
          const participant = await server.store.prisma.projectParticipatingCompany.findFirst({ where: { projectId: draft.projectId } });
          expect(current!.companyEntityVersionId).not.toBe(participant!.companyEntityVersionId);
          expect(fact).toMatchObject({ numericProtocolVersion: 2, amountCents: null, direction: "neutral", sourceVersion: 1, debtorSubjectKind: "participating_company", debtorSubjectId: current!.companyEntityIdSnapshot,
            sourceSnapshot: { archiveAuthoritySha256: "a".repeat(64), sourceBasisSha256: "b".repeat(64), sourceBasis: { sourceLocator: { sourceVersion: 1 }, versionEvidence: { documentContentRevision: revised.version.documentContentRevision }, subjects: { participation: { companyEntityVersionId: participant!.companyEntityVersionId }, signingIdentity: { company: { id: current!.companyEntityVersionId } } } } } });
          expect(revised.version.documentContentRevision).toBeGreaterThan(1);
          expect(impact).toMatchObject({ numericProtocolVersion: 2, amountCents: null, subjectId: current!.companyEntityIdSnapshot, direction: sourceAmount === null ? "notice" : "increase" });
          expect(fact!.amountYuan === null ? null : new Prisma.Decimal(String(fact!.amountYuan)).toFixed(4)).toBe(sourceAmount === null ? null : sourceAmount === "0.0000" ? "0.0000" : "94.0054");
          expect(await server.store.prisma.operatingFact.count({ where: { projectId: draft.projectId } })).toBe(1);
          expect(await server.store.prisma.operatingImpactEntry.count({ where: { projectId: draft.projectId } })).toBe(1);
          await server.store.prisma.operatingFact.delete({ where: { id: fact!.id } });
          expect((await readArchiveResult()).status).toBe(503);
          await server.store.prisma.operatingFact.create({ data: fact! });
          await server.store.prisma.operatingImpactEntry.update({ where: { id: impact!.id }, data: { amountYuan: new Prisma.Decimal("0.0001") } });
          const inconsistent = await readArchiveResult();
          expect({ status: inconsistent.status, body: await inconsistent.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("经营事实") } });
          await server.store.prisma.operatingImpactEntry.update({ where: { id: impact!.id }, data: { amountYuan: impact!.amountYuan } });
          expect((await readArchiveResult()).status).toBe(200);
          if (archiveInstant === "2026-11-08T23:30:00+08:00") {
            jest.setSystemTime(new Date("2026-11-09T00:30:00+08:00"));
            draft.headers.authorization = `Bearer ${await loginTemplateActor(server, "staff")}`;
            const reviewOther = await server.store.prisma.contract.create({ data: { projectId: draft.projectId, ownerUserId: "staff", name: "后继实际范围核对材料合同", counterparty: "另一合作单位", temporaryCode: "AFTER-ARCHIVE-REVIEW", code: null } });
            await server.store.prisma.contractVersion.create({ data: { contractId: reviewOther.id, numericProtocolVersion: 1, versionNo: 1, changeType: "original", signingSubjectType: "our_company", amountCents: 20000n, amountYuan: null, amountLimitType: "capped", documentContentRevision: 1, status: "draft" } });
            // Original archive occurred on Beijing day 8; this review is day 9.
            // The original ownership is still valid even if participation ends day 9.
            await server.store.prisma.projectParticipatingCompany.update({ where: { id: participant!.id }, data: { endedAt: new Date("2026-11-09T00:00:00.000Z") } });
            const economic = server.app.get(ContractEconomicReviewService);
            const prepared = await economic.prepare("staff", { projectId: draft.projectId, leftSourceRef: `contract:${draft.contract.id}`, rightSourceRef: `contract:${reviewOther.id}`, relation: "shared_evidence", coverage: [{ scope: "归档后已知重叠材料部分", leftAmountYuan: "0.0010", rightAmountYuan: "0.0010", owner: "right" }], reason: "原合同未知总额保留，仅核对已知重叠部分", idempotencyKey: randomUUID(), confirmationPassword: server.password });
            const contractChecked = await economic.decide("director", prepared.id, { revision: prepared.revision, decision: "confirm", confirmationPassword: server.password });
            expect(contractChecked.status).toBe("pending_finance");
            const confirmed = await economic.decide("finance", prepared.id, { revision: contractChecked.revision, decision: "confirm", confirmationPassword: server.password });
            expect(confirmed.status).toBe("confirmed");
            const reviewFact = await server.store.prisma.operatingFact.findFirst({ where: { sourceType: "contract_economic_review", projectId: draft.projectId } });
            expect(reviewFact).toMatchObject({ occurredAt: new Date("2026-11-08T16:30:00.000Z"), isBeforeOperatingLedgerEffectiveDate: false, debtorSubjectId: current!.companyEntityIdSnapshot, numericProtocolVersion: 2 });
            expect(new Prisma.Decimal(String(reviewFact!.amountYuan)).toFixed(4)).toBe("0.0010");
            const adjusted = await server.app.get(OperatingProjectionService).getProjectView("finance", { projectId: draft.projectId, numericProtocolVersion: 2 });
            expect(adjusted).toMatchObject({ commitments: { contractCommitmentYuan: null, knownContractCommitmentYuan: "-0.0010", unknownContractCommitmentCount: 1 } });
            const reviewFrozen = confirmed.frozenSources as Prisma.JsonArray;
            const tamperedFrozen = reviewFrozen.map(raw => {
              const document = raw as Prisma.JsonObject;
              if (document.ref !== `contract:${draft.contract.id}`) return raw;
              const baseline = document.operatingBaseline as Prisma.JsonObject;
              return { ...document, operatingBaseline: { ...baseline, sourceSnapshot: { ...(baseline.sourceSnapshot as Prisma.JsonObject), archiveAuthoritySha256: "f".repeat(64) } } };
            });
            await server.store.prisma.contractEconomicReview.update({ where: { id: confirmed.id }, data: { frozenSources: tamperedFrozen } });
            await expect(server.app.get(OperatingSourceReplayService).replaySource({ projectId: draft.projectId, sourceType: "contract_economic_review", sourceBusinessId: `${confirmed.id}:contract:${draft.contract.id}` }, "finance")).rejects.toThrow("原经营事实与冻结来源不一致");
            expect(await server.store.prisma.operatingFact.count({ where: { projectId: draft.projectId } })).toBe(2);
            await server.store.prisma.contractEconomicReview.update({ where: { id: confirmed.id }, data: { frozenSources: reviewFrozen } });
            expect((await readArchiveResult()).status).toBe(200);
          }



        }
      }
    } finally {
      if (previousWriteSecret === undefined) delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      else process.env.OPERATING_LEDGER_DB_WRITE_SECRET = previousWriteSecret;
      try { await server.app.close(); } finally { if (archiveInstant) jest.useRealTimers(); }
    }
  });
});

/** Existing lifecycle cases now use valid inside subject facts, not unfinished upward provenance. */
async function saveInsideTask12Draft(server: Awaited<ReturnType<typeof createTemplateTestServer>>, draft: Awaited<ReturnType<typeof createTask09Draft>>, contractType: string, layoutId: string, controlledCounterparty = false) {
  const companyId = randomUUID(), companyVersionId = randomUUID(), joiningVersionId = controlledCounterparty ? randomUUID() : companyVersionId;
  const partyId = randomUUID(), partyVersionId = randomUUID();
  if (controlledCounterparty) {
    await server.store.prisma.businessParty.create({ data: { id: partyId, status: "active" } });
    await server.store.prisma.businessPartyVersion.create({ data: { id: partyVersionId, businessPartyId: partyId, versionNo: 1, snapshot: { name: "当单相对方" } } });
  }
  await server.store.prisma.companyEntity.create({ data: { id: companyId, isActive: true, dataStatus: "complete", currentVersionNo: controlledCounterparty ? 2 : 1 } });
  await server.store.prisma.companyEntityVersion.create({ data: { id: companyVersionId, companyEntityId: companyId, versionNo: controlledCounterparty ? 2 : 1, name: "当前选择我方公司", unifiedSocialCreditCode: "91310000123456789X", registeredAddress: "合成地址" } });
  if (controlledCounterparty) await server.store.prisma.companyEntityVersion.create({ data: { id: joiningVersionId, companyEntityId: companyId, versionNo: 1, name: "加入项目时公司名", unifiedSocialCreditCode: "91310000123456789X", registeredAddress: "加入时地址" } });
  await server.store.prisma.projectParticipatingCompany.create({ data: { projectId: draft.projectId, companyEntityId: companyId, companyEntityVersionId: joiningVersionId, companyNameSnapshot: "加入项目时公司名", companyCreditCodeSnapshot: "91310000123456789X", effectiveFrom: new Date("2026-01-01"), endedAt: null } });
  const original = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(r => r.json());
  const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
    idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: original.version.draftRevision, changedSections: ["draft", "parties"],
    draft: { numericProtocolVersion: 2, companyEntityId: companyId, draftData: { contractName: "表内正式主体合成合同", contractBasics: { businessType: contractType, relationship: "inside", amountBasis: "tax_inclusive", invoiceStatus: "pending" } }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layoutId, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
    parties: [{ roleKey: "party_b", displayOrder: 0, ...(controlledCounterparty ? { businessPartyVersionId: partyVersionId, snapshot: {} } : { snapshot: { name: "当单相对方" } }) }], bills: original.bills.map((b: { billKey: string; revision: number }) => ({ billKey: b.billKey, expectedRevision: b.revision, numericProtocolVersion: 2, rows: [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  }) });
  return saved;
}
