import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { Prisma } from "@prisma/client";
import { ContractEconomicReviewService } from "../contract-ledger/contract-economic-review.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { PDFDocument } from "pdf-lib";
import { createHash, randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { loginTemplateActor } from "./template-selection.test-support";
import { openDirectPendingDraft } from "./task12-direct-pending.test-support";
import * as generatedArchiveInstallation from "../contract/contract-generated-archive-installation";
import { PrivateFileStorage } from "../file/file.service";

describe("任务12 当前正文正式提交（真实HTTP，合成持久层及私有文件）", () => {
  it("对上生成审批核对真实纸面双方和安装资格，撤回重提后仅当前轮次单次交接", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true, generatedArchivePreparation: true });
    try {
      const layout = await confirmedBodyLayout(server);
      const draft = await createTask09Draft(server, "capped", "material_purchase", "upward");
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const duties = [
        { index: 0, actor: "employee", role: "material_director", projectId: null },
        { index: 1, actor: "director", role: "contract_director", projectId: null },
        { index: 2, actor: "manager", role: "project_manager", projectId: draft.projectId },
        { index: 3, actor: "finance", role: "finance_director", projectId: null },
        { index: 4, actor: "employee", role: "general_manager", projectId: null }
      ];
      const signatureBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
      const tokens = new Map<string, string>();
      for (const duty of duties) {
        await server.store.prisma.position.upsert({ where: { id: duty.role }, create: { id: duty.role, key: duty.role }, update: {} });
        if (duty.role !== "contract_director") {
          await server.store.prisma.userPosition.create({ data: { userId: duty.actor, positionId: duty.role, projectId: duty.projectId } });
        }
        if (!tokens.has(duty.actor)) {
          const signature = await server.files.uploadPrivateFile({ originalName: "合成审批签字.png", mimeType: "image/png", sizeBytes: signatureBytes.length, buffer: signatureBytes, uploadedByUserId: duty.actor });
          await server.store.prisma.handwrittenSignatureVersion.create({ data: { userId: duty.actor, source: "canvas", fileId: signature.id, contentSha256: createHash("sha256").update(signatureBytes).digest("hex") } });
          tokens.set(duty.actor, await loginTemplateActor(server, duty.actor));
        }
      }
      const companyId = randomUUID(), companyVersionId = randomUUID(), joinedVersionId = randomUUID();
      const companyName = "本项目我方参与公司", companyCreditCode = "91310000123456789X", companyAddress = "当前注册地址";
      await server.store.prisma.companyEntity.create({ data: { id: companyId, isActive: true, dataStatus: "complete", currentVersionNo: 2 } });
      for (const [id, versionNo, name] of [[companyVersionId, 2, companyName], [joinedVersionId, 1, "加入时我方公司"]] as const) {
        await server.store.prisma.companyEntityVersion.create({ data: { id, companyEntityId: companyId, versionNo, name, unifiedSocialCreditCode: companyCreditCode, registeredAddress: companyAddress, isActive: true } });
      }
      const participation = await server.store.prisma.projectParticipatingCompany.create({ data: { projectId: draft.projectId, companyEntityId: companyId, companyEntityVersionId: joinedVersionId, companyNameSnapshot: "加入时我方公司", companyCreditCodeSnapshot: companyCreditCode, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null } });
      const enterpriseId = randomUUID(), enterpriseVersionId = randomUUID();
      const enterpriseName = "本项目实际施工企业", enterpriseCreditCode = "91310000123456789A";
      await server.store.prisma.businessParty.create({ data: { id: enterpriseId, name: enterpriseName, status: "active" } });
      await server.store.prisma.businessPartyVersion.create({ data: { id: enterpriseVersionId, businessPartyId: enterpriseId, versionNo: 1, snapshot: { name: enterpriseName, unifiedSocialCreditCode: enterpriseCreditCode } } });
      const assignment = await server.store.prisma.projectAffiliateAssignment.create({ data: { projectId: draft.projectId, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId, affiliateNameSnapshot: enterpriseName, affiliateCreditCodeSnapshot: enterpriseCreditCode, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null } });

      const workbench = () => fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
      const save = async (documentBody?: object) => {
        const { version, bills } = await workbench();
        const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
          idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: version.draftRevision, changedSections: ["draft", "parties"],
          draft: { numericProtocolVersion: 2, companyEntityId: companyId, draftData: { contractName: "对上生成合成材料合同", contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" }, ...(documentBody ? { documentBody } : {}) }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
          parties: [{ roleKey: "party_b", displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: {} }],
          bills: bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })),
          paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
        }) });
        expect({ status: response.status, body: response.status === 200 ? null : await response.json() }).toEqual({ status: 200, body: null });
      };
      await save();
      const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
      expect(body.blocks.map(block => block.text)).toEqual(expect.arrayContaining([`甲方：${companyName}`, `乙方：${enterpriseName}`]));
      await save({ protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] });
      const { version } = await workbench();
      expect(version.draftData.directSigningInput).toBeUndefined();
      expect(version.draftData.companyEntitySelection).toMatchObject({ id: companyId, versionId: companyVersionId });
      const queuePreview = () => fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: version.draftRevision }) });
      await server.store.prisma.companyEntity.update({ where: { id: companyId }, data: { currentVersionNo: 3 } });
      const stalePreview = await queuePreview();
      expect({ status: stalePreview.status, body: await stalePreview.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("我方公司主体资料已更新或不再可用") } });
      expect(await server.store.prisma.contractGeneratedDocument.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      await server.store.prisma.companyEntity.update({ where: { id: companyId }, data: { currentVersionNo: 2 } });
      const queue = await queuePreview();
      const queued = await queue.json();
      expect({ status: queue.status, queued }).toMatchObject({ status: 201, queued: { generationId: expect.any(String) } });
      const doc = await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: queued.generationId } });
      expect(doc?.inputSnapshot).toMatchObject({ renderInput: { values: {
        "party.party_a": [expect.objectContaining({ id: companyId, versionId: companyVersionId, name: companyName })],
        "party.party_b": [expect.objectContaining({ name: enterpriseName, unifiedSocialCreditCode: enterpriseCreditCode })]
      } } });
      // Use the real queued input snapshot. The generated bytes are mock-only.
      const docxBytes = Buffer.from("synthetic upward current Word"), pdfBytes = Buffer.from("synthetic upward current PDF");
      const docx = await server.files.uploadPrivateFile({ originalName: "合成正文.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docxBytes, sizeBytes: docxBytes.length, uploadedByUserId: "staff" });
      const pdf = await server.files.uploadPrivateFile({ originalName: "合成正文.pdf", mimeType: "application/pdf", buffer: pdfBytes, sizeBytes: pdfBytes.length, uploadedByUserId: "staff" });
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: doc!.id }, data: { status: "success", docxFileId: docx.id, pdfFileId: pdf.id } });
      const input = { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, generatedDocumentId: doc!.id, sourceSha256: layout.sha256, blanksReviewed: true };
      const submit = (body = input) => fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(body) });
      const readReceipt = (key = input.idempotencyKey) => fetch(`${draft.base}/submission-requests/${key}`, { headers: draft.headers });
      const assertNoSubmission = async () => {
        expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
        expect(await server.store.prisma.contractDraftSubmissionRequest.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
        expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.approval.submit" } })).toBe(0);
        expect(await (await readReceipt()).json()).toEqual({ status: "unknown" });
        const current = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
        expect(current).toMatchObject({ status: "draft", signingSubjectType: "draft_unconfirmed", documentContentFingerprint: version.documentContentFingerprint });
        expect((current?.draftData as Prisma.JsonObject).directSigningInput).toBeUndefined();
      };

      const oldProfile = {
        databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001", currentRoleOid: "7001", sessionRoleOid: "7001",
        bindingOid: "42001", createBindingOid: "42002", versionRoutineOid: "42003", attachmentRoutineOid: "42004",
        slotRoutineOid: "42005", createBindingSha256: "1".repeat(64), backendPid: 71201, transactionId: "500003",
        restrictedRole: true, privateTechnicalAcl: true,
        routineBodies: {
          version: "bbf5b477e867355798c5b99f4c7919baccfbfe7888811eaefccb9ab88a737e9f",
          attachment: "0a0b17642f39c96064f1184fcd03e4151569136c385b2ea0d94ff67dbc5963cf",
          slot: "86dddd478fb66809deaae6875e46e2ed29436824497114d7c7a66e46403fe999",
          save: "ee7b3ccc522fa5b18f5212a54718729dd33e9a1713b3768747368a7b331efa50",
          binding: "637c42531d6e58ba08d3d5ec497ccd82874cbe0d713d0e249d794a3694755028",
          after: "1541911b049f700fbba33ee1d973fa43aab1577fa8490a7eea1c10e57cde6059",
          file: "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1",
          exclusive: "e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999"
        },
        triggerOids: { jg_direct_pending_version_shape: "30001", jg_direct_pending_attachment_source: "30002",
          ContractDraftAttachment_direct_archive_transfer_v1: "30003", jg_upward_pending_save_binding_immutable: "30004",
          jg_upward_pending_save_binding_no_truncate: "30005", jg_upward_pending_save_persistent_proof: "30006",
          jg_direct_pending_file_retained: "30007", jg_direct_pending_attachment_exclusive: "30008" }
      };
      let installed = false;
      let sealHandoffEnabled: boolean | undefined = undefined;
      let sealHandoffDrifts = false;
      let driftOnContinuity = false;
      let successorReads = 0;
      const native = server.store.prisma.$queryRaw;
      server.store.prisma.$queryRaw = async (raw, ...parameters) => {
        const query = "strings" in raw ? raw : Prisma.sql(raw, ...parameters);
        const sql = query.strings.join("?").replace(/\s+/gu, " ").trim();
        if (sql.startsWith("/* contract_upward_pending_save_catalog_v1 */")) {
          return [{ ...oldProfile, dualIdentityCheck: !installed, successorOid: installed ? "42007" : null, successorReadable: installed }];
        }
        if (sql.startsWith("/* contract_generated_upward_submission_catalog_v1 */")) {
          successorReads++;
          const { databaseOid, namespaceOid, anchorOwnerOid, currentRoleOid, sessionRoleOid, bindingOid, backendPid, transactionId } = oldProfile;
          return installed ? [{ databaseOid, namespaceOid, anchorOwnerOid, currentRoleOid, sessionRoleOid, bindingOid, backendPid, transactionId,
            successorOid: "42007", constraintOid: "42008", predecessorSha256: "2".repeat(64),
            constraintSha256: (driftOnContinuity && successorReads === 2 ? "4" : "3").repeat(64), exactSuccessor: true,
            sealHandoffEnabled: sealHandoffDrifts && successorReads === 2 ? false : sealHandoffEnabled }] : [];
        }
        return native(raw, ...parameters);
      };

      const unavailable = await submit();
      expect({ status: unavailable.status, body: await unavailable.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("对上生成提交资格尚未核对") } });
      await assertNoSubmission();

      installed = true;
      await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignment.id }, data: { endedAt: new Date("2026-01-02T00:00:00.000Z") } });
      expect((await submit()).status).toBe(409);
      await assertNoSubmission();
      await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignment.id }, data: { endedAt: null } });

      const trace = doc!.inputSnapshot as Prisma.JsonObject;
      const renderInput = trace.renderInput as Prisma.JsonObject;
      const values = renderInput.values as Prisma.JsonObject;
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: doc!.id },
        data: { inputSnapshot: { ...trace, renderInput: { ...renderInput, values: { ...values, "party.party_b": values["party.party_a"] } } } } });
      expect((await submit()).status).toBe(409);
      await assertNoSubmission();
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: doc!.id }, data: { inputSnapshot: trace } });

      successorReads = 0;
      driftOnContinuity = true;
      expect((await submit()).status).toBe(503);
      expect(successorReads).toBe(2);
      await assertNoSubmission();

      successorReads = 0;
      driftOnContinuity = false;
      const versionWrites = jest.spyOn(server.store.prisma.contractVersion, "update");
      const response = await submit();
      const result = await response.json();
      expect({ status: response.status, result }).toMatchObject({ status: 201, result: { contractVersionId: draft.version.id, status: "in_approval" } });
      const matchingWrites = versionWrites.mock.calls.filter(([args]) => args.where.id === draft.version.id);
      expect(matchingWrites).toEqual([[expect.objectContaining({ data: expect.objectContaining({
        status: "in_approval", signingSubjectType: "upward", firstSubmittedAt: expect.any(Date),
        companyEntityVersionId: companyVersionId, affiliateBusinessPartyVersionId: enterpriseVersionId,
        readinessSnapshot: expect.any(Object)
      }) })]]);
      versionWrites.mockRestore();
      const submitted = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      expect(submitted).toMatchObject({ status: "in_approval", signingSubjectType: "upward", firstSubmittedAt: expect.any(Date),
        companyEntityIdSnapshot: companyId, companyEntityVersionId: companyVersionId, affiliateAssignmentId: assignment.id,
        affiliateBusinessPartyVersionId: enterpriseVersionId, readinessSnapshot: { signingIdentity: {
          relationship: "upward",
          company: { roleKey: "party_a", id: companyVersionId, projectParticipatingCompanyId: participation.id, joinedCompanyEntityVersionId: joinedVersionId },
          enterprise: { roleKey: "party_b", assignmentId: assignment.id, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId }
        }, versionFacts: { signingSubjectType: "upward" }, generatedDocumentId: doc!.id, documentContentFingerprint: input.documentContentFingerprint } });
      const round = await server.store.prisma.approvalInstance.findMany({ where: { businessId: draft.version.id } });
      expect(round).toHaveLength(1);
      expect(round[0].frozenNodes).toEqual([
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["material_director"], submissionSnapshot: submitted?.readinessSnapshot }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["contract_director"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["project_manager"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["finance_director"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["chairman", "general_manager"] })
      ]);
      installed = false;
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participation.id }, data: { endedAt: new Date("2026-01-02T00:00:00.000Z") } });
      expect(await (await readReceipt()).json()).toMatchObject({ status: "submitted", result });
      expect(await (await submit()).json()).toEqual(result);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(1);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.approval.submit" } })).toBe(1);
      expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      installed = true;
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participation.id }, data: { endedAt: null } });
      const contractUrl = `${await server.app.getUrl()}/contracts/${draft.version.id}`;
      const coordinate = async (roundId: string, index: number) => {
        const current = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
        const approval = await server.store.prisma.approvalInstance.findUnique({ where: { id: roundId } });
        return { expectedContractUpdatedAt: current!.updatedAt, expectedApprovalInstanceId: roundId, expectedNodeIndex: index, expectedApprovalUpdatedAt: approval!.updatedAt };
      };
      const review = (coordinates: Awaited<ReturnType<typeof coordinate>>, actor: string) => fetch(`${contractUrl}/approval`, {
        method: "POST", headers: { ...draft.headers, authorization: `Bearer ${tokens.get(actor)}` },
        body: JSON.stringify({ decision: "approve", ...coordinates })
      });
      const withdraw = (coordinates: Awaited<ReturnType<typeof coordinate>>) => fetch(`${contractUrl}/approval-withdrawal`, {
        method: "POST", headers: draft.headers, body: JSON.stringify(coordinates)
      });
      const firstReviewed = await review(await coordinate(result.approvalInstanceId, 1), "director");
      expect({ status: firstReviewed.status, body: await firstReviewed.json() }).toMatchObject({ status: 201, body: { status: "in_approval" } });
      const firstReviewAfter = await coordinate(result.approvalInstanceId, 1);
      const withdrawal = await withdraw(await coordinate(result.approvalInstanceId, 0));
      expect({ status: withdrawal.status, body: await withdrawal.json() }).toMatchObject({ status: 201, body: { status: "draft" } });
      const withdrawnVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      expect(withdrawnVersion).toMatchObject({
        status: "draft", firstSubmittedAt: submitted!.firstSubmittedAt, signingSubjectType: "upward",
        companyEntityVersionId: companyVersionId, affiliateBusinessPartyVersionId: enterpriseVersionId
      });
      const withdrawnRound = await server.store.prisma.approvalInstance.findUnique({ where: { id: result.approvalInstanceId } });
      expect(withdrawnRound).toMatchObject({ status: "withdrawn", frozenNodes: [
        expect.objectContaining({ submissionSnapshot: submitted!.readinessSnapshot, approvedRoleKeys: [] }),
        expect.objectContaining({ approvedRoleKeys: ["contract_director"] }),
        expect.objectContaining({ approvedRoleKeys: [] }), expect.objectContaining({ approvedRoleKeys: [] }), expect.objectContaining({ approvedRoleKeys: [] })
      ] });
      expect([403, 409]).toContain((await review(firstReviewAfter, "director")).status);
      expect(await (await readReceipt()).json()).toMatchObject({ status: "submitted", result });

      const editable = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
      const clause = editable.blocks.find(block => block.text.startsWith("手工条款："))!;
      await save({ protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
        edits: [{ positionId: clause.id, text: "手工条款：对上合同撤回后修改，原轮签字不转移。" }], additions: [] });
      const revised = (await workbench()).version;
      expect(revised.documentContentFingerprint).not.toBe(input.documentContentFingerprint);
      expect((await submit({ ...input, idempotencyKey: randomUUID() })).status).toBe(409);
      const revisedQueue = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: revised.draftRevision }) });
      const revisedQueued = await revisedQueue.json();
      expect({ status: revisedQueue.status, revisedQueued }).toMatchObject({ status: 201, revisedQueued: { generationId: expect.any(String) } });
      const revisedWord = Buffer.from("synthetic revised upward Word"), revisedPdf = Buffer.from("synthetic revised upward PDF");
      const revisedWordFile = await server.files.uploadPrivateFile({ originalName: "合成修订正文.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: revisedWord, sizeBytes: revisedWord.length, uploadedByUserId: "staff" });
      const revisedPdfFile = await server.files.uploadPrivateFile({ originalName: "合成修订正文.pdf", mimeType: "application/pdf", buffer: revisedPdf, sizeBytes: revisedPdf.length, uploadedByUserId: "staff" });
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: revisedQueued.generationId }, data: { status: "success", docxFileId: revisedWordFile.id, pdfFileId: revisedPdfFile.id } });
      const secondInput = { ...input, idempotencyKey: randomUUID(), expectedRevision: revised.draftRevision, documentContentRevision: revised.documentContentRevision,
        documentContentFingerprint: revised.documentContentFingerprint, generatedDocumentId: revisedQueued.generationId };
      const second = await submit(secondInput);
      const secondResult = await second.json();
      expect({ status: second.status, body: secondResult }).toMatchObject({ status: 201, body: { status: "in_approval", formalCode: result.formalCode } });
      const secondRoundId = secondResult.approvalInstanceId as string;
      expect(secondRoundId).not.toBe(result.approvalInstanceId);
      expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.firstSubmittedAt).toEqual(submitted!.firstSubmittedAt);
      const secondRound = await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRoundId } });
      expect(secondRound).toMatchObject({ status: "in_progress" });
      expect((secondRound!.frozenNodes as Array<Prisma.JsonObject>).map(node => node.approvedRoleKeys)).toEqual([[], [], [], [], []]);
      expect([403, 409]).toContain((await review(firstReviewAfter, "director")).status);
      expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: secondRoundId, action: "approve" } })).toBe(0);

      for (const duty of duties.slice(0, 4)) {
        const reviewed = await review(await coordinate(secondRoundId, duty.index), duty.actor);
        expect({ status: reviewed.status, body: await reviewed.json() }).toMatchObject({ status: 201, body: { status: "in_approval" } });
        expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      }
      const fifth = duties[4];
      const fifthCoordinates = await coordinate(secondRoundId, fifth.index);
      const assertNoHandoff = async () => {
        expect(await coordinate(secondRoundId, fifth.index)).toEqual(fifthCoordinates);
        expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.status).toBe("in_approval");
        expect((await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRoundId } }))!.status).toBe("in_progress");
        expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: secondRoundId, action: "approve" } })).toBe(4);
        expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
        expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal_task.create" } })).toBe(0);
      };

      successorReads = 0;
      expect((await review(fifthCoordinates, fifth.actor)).status).toBe(503);
      expect(successorReads).toBe(1);
      await assertNoHandoff();

      sealHandoffEnabled = true;
      sealHandoffDrifts = true;
      successorReads = 0;
      expect((await review(fifthCoordinates, fifth.actor)).status).toBe(503);
      expect(successorReads).toBe(2);
      await assertNoHandoff();

      sealHandoffDrifts = false;
      const completed = await review(fifthCoordinates, fifth.actor);
      expect({ status: completed.status, body: await completed.json() }).toMatchObject({ status: 201, body: { status: "approved_pending_seal", approvalInstanceId: secondRoundId } });
      expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.status).toBe("approved_pending_seal");
      expect((await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRoundId } }))!.status).toBe("approved");
      const [handoff] = await server.store.prisma.contractSealTask.findMany({ where: { contractVersionId: draft.version.id } });
      const lastApproval = await server.store.prisma.approvalActionLog.findFirst({ where: { approvalInstanceId: secondRoundId, action: "approve", approvedRoleKey: "general_manager" } });
      expect(lastApproval).toMatchObject({ actorUserId: fifth.actor, createdAt: expect.any(Date) });
      expect(handoff).toMatchObject({ approvalInstanceId: secondRoundId, handlerUserId: "staff", status: "in_seal",
        approvedByUserId: fifth.actor, approvedAt: lastApproval!.createdAt });
      expect((await server.store.prisma.auditLog.findFirst({ where: { businessId: draft.version.id, action: "contract.seal_task.create" } }))!.metadata)
        .toMatchObject({ approvalInstanceId: secondRoundId, sealTaskId: handoff.id, handlerUserId: "staff",
          internalApprovalActionId: lastApproval!.id, internalApproverUserId: fifth.actor });

      expect([403, 409]).toContain((await review(fifthCoordinates, fifth.actor)).status);
      expect([403, 409]).toContain((await review(firstReviewAfter, "director")).status);
      expect((await withdraw(await coordinate(secondRoundId, 5))).status).toBe(409);
      expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(1);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal_task.create" } })).toBe(1);
      expect(await server.store.prisma.approvalActionLog.count({ where: { approvalInstanceId: secondRoundId, action: "approve" } })).toBe(5);
      expect(await (await readReceipt()).json()).toMatchObject({ status: "submitted", result, intent: { documentContentFingerprint: input.documentContentFingerprint } });
      expect(await (await readReceipt(secondInput.idempotencyKey)).json()).toMatchObject({ status: "submitted", result: secondResult, intent: { documentContentFingerprint: secondInput.documentContentFingerprint } });
      expect(await (await submit()).json()).toEqual(result);
      expect(await (await submit(secondInput)).json()).toEqual(secondResult);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(2);

      await server.store.prisma.position.upsert({ where: { id: "comprehensive_director" }, create: { id: "comprehensive_director", key: "comprehensive_director" }, update: {} });
      await server.store.prisma.userPosition.create({ data: { userId: "director", positionId: "comprehensive_director", projectId: null } });
      const director = await loginTemplateActor(server, "director");
      const technical = await loginTemplateActor(server, "technical");
      const sealInput = { expectedApprovalInstanceId: secondRoundId, expectedSealTaskId: String(handoff.id),
        documentContentRevision: revised.documentContentRevision, documentContentFingerprint: revised.documentContentFingerprint, confirmed: true };
      const confirmSeal = (token: string, patch: object = {}) => fetch(`${contractUrl}/seal-confirmation`, {
        method: "POST", headers: { ...draft.headers, authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...sealInput, ...patch })
      });
      await assertGeneratedSealWorkItemBlocked(server, draft, director, "seal");
      await assertGeneratedSealWorkItemHidden(server, draft, tokens.get("finance")!);
      expect((await confirmSeal(director, { expectedApprovalInstanceId: result.approvalInstanceId })).status).toBe(409);
      expect((await confirmSeal(tokens.get("finance")!)).status).toBe(403);
      expect((await confirmSeal(technical)).status).toBe(403);
      const sealDenied = await confirmSeal(director);
      expect({ status: sealDenied.status, body: await sealDenied.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("盖章交接资格尚未就绪") } });
      expect((await server.store.prisma.contractSealTask.findUnique({ where: { id: handoff.id } }))!.status).toBe("in_seal");
      expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.status).toBe("approved_pending_seal");
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal.complete" } })).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      expect(await server.store.prisma.operatingFact.count({ where: { projectId: draft.projectId } })).toBe(0);
      expect(await server.store.prisma.operatingImpactEntry.count({ where: { projectId: draft.projectId } })).toBe(0);
      const detail = await fetch(`${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, {
        headers: { ...draft.headers, authorization: `Bearer ${director}` }
      });
      expect({ status: detail.status, body: await detail.json() }).toMatchObject({ status: 200, body: { v2Lifecycle: {
        status: "unavailable", webWriteReleased: false, sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: false, enabled: false }
      } } });
      await exerciseGeneratedSealConfirmation({ server, draft, director, confirmSeal, sealInput,
        archiveSource: { relationship: "upward", generatedDocumentId: secondInput.generatedDocumentId, signingIdentity: {
          relationship: "upward", company: { id: companyVersionId, roleKey: "party_a" },
          enterprise: { assignmentId: assignment.id, businessPartyVersionId: enterpriseVersionId, roleKey: "party_b" }
        } }, expectedRoundCount: 2, preparationEnabled: true });
    } finally { await server.app.close(); }
  });

  it.each([
    ["party_a", "party_b", false],
    ["party_b", "party_a", true]
  ] as const)("表外生成审批冻结当前项目施工企业 %s 和下游 %s，当单录入=%s", async (enterpriseRole, downstreamRole, inlineDownstream) => {
    const server = await createTemplateTestServer({ draftWorkbench: true, generatedArchivePreparation: !inlineDownstream });
    try {
      const layout = await confirmedBodyLayout(server);
      const draft = await createTask09Draft(server, "capped", "material_purchase", "outside");
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const enterpriseId = randomUUID(), enterpriseVersionId = randomUUID(), replacementVersionId = randomUUID(), assignmentId = randomUUID();
      const downstreamId = randomUUID(), downstreamVersionId = randomUUID();
      for (const [id, versionId, name] of [[enterpriseId, enterpriseVersionId, "本项目施工企业"], [downstreamId, downstreamVersionId, "本合同下游单位"]]) {
        await server.store.prisma.businessParty.create({ data: { id, name, status: "active" } });
        await server.store.prisma.businessPartyVersion.create({ data: { id: versionId, businessPartyId: id, versionNo: 1, snapshot: { name } } });
      }
      await server.store.prisma.businessPartyVersion.create({ data: { id: replacementVersionId, businessPartyId: enterpriseId, versionNo: 2, snapshot: { name: "本项目施工企业" } } });
      const otherProjectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: otherProjectId, code: "T12-OTHER", name: "不同项目", isActive: true } });
      await server.store.prisma.projectAffiliateAssignment.create({ data: {
        id: assignmentId, projectId: draft.projectId, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId,
        affiliateNameSnapshot: "本项目施工企业", affiliateCreditCodeSnapshot: null, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null
      } });
      const parties = [
        { roleKey: enterpriseRole, displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: {} },
        { roleKey: downstreamRole, displayOrder: 0, ...(inlineDownstream ? { snapshot: { name: "本合同下游单位" } } : { businessPartyVersionId: downstreamVersionId, snapshot: {} }) }
      ];
      const workbench = () => fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
      const save = async (documentBody?: object) => {
        const current = await workbench();
        const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
          idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties"],
          draft: { numericProtocolVersion: 2, draftData: { contractName: "表外生成合成材料合同", contractBasics: { businessType: "material_purchase", relationship: "outside", amountBasis: "tax_inclusive", invoiceStatus: "pending" }, ...(documentBody ? { documentBody } : {}) }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
          parties, bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })),
          paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
        }) });
        expect({ status: response.status, body: response.status === 200 ? null : await response.json() }).toEqual({ status: 200, body: null });
      };
      await save();
      const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
      const shownSlots = enterpriseRole === "party_a"
        ? ["甲方：本项目施工企业", "乙方：本合同下游单位"]
        : ["甲方：本合同下游单位", "乙方：本项目施工企业"];
      expect(body.blocks.map(block => block.text)).toEqual(expect.arrayContaining(shownSlots));
      await save({ protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] });
      const { version } = await workbench();
      // Synthetic persisted ready output, just as in the inside generated submission cases.
      const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const docxBytes = Buffer.from("synthetic outside current Word"), pdfBytes = Buffer.from("synthetic outside current PDF");
      const docx = await server.files.uploadPrivateFile({ originalName: "合成正文.docx", mimeType: docxMime, buffer: docxBytes, sizeBytes: docxBytes.length, uploadedByUserId: "staff" });
      const pdf = await server.files.uploadPrivateFile({ originalName: "合成正文.pdf", mimeType: "application/pdf", buffer: pdfBytes, sizeBytes: pdfBytes.length, uploadedByUserId: "staff" });
      const template = await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } });
      const document = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id, layoutTemplateVersionId: layout.id, purpose: "draft", status: "success", sourceRevision: version.draftRevision, inputSnapshot: { documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, templateFileId: template!.docxFileId, layoutSourceMapping: { sourceSha256: layout.sha256 } }, idempotencyKey: randomUUID(), docxFileId: docx.id, pdfFileId: pdf.id, engineVersion: "synthetic-task10-output", createdByUserId: "staff" } });
      const input = { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, generatedDocumentId: document.id, sourceSha256: layout.sha256, blanksReviewed: true };
      const submit = () => fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      const readReceipt = () => fetch(`${draft.base}/submission-requests/${input.idempotencyKey}`, { headers: draft.headers });
      for (const patch of [
        { projectId: otherProjectId }, { endedAt: new Date() }, { effectiveFrom: new Date("2030-01-01T00:00:00.000Z") },
        { businessPartyVersionId: replacementVersionId }, { affiliateNameSnapshot: "派驻快照已变化" }
      ]) {
        await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignmentId }, data: patch });
        expect((await submit()).status).toBe(409);
        expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
        expect(await (await readReceipt()).json()).toEqual({ status: "unknown" });
        await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignmentId }, data: {
          projectId: draft.projectId, endedAt: null, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), businessPartyVersionId: enterpriseVersionId, affiliateNameSnapshot: "本项目施工企业"
        } });
      }
      const response = await submit();
      const result = await response.json();
      expect({ status: response.status, result }).toMatchObject({ status: 201, result: { contractVersionId: draft.version.id, status: "in_approval" } });
      const frozen = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
      expect(frozen).toMatchObject({
        signingSubjectType: "affiliate", affiliateAssignmentId: assignmentId, affiliateBusinessPartyVersionId: enterpriseVersionId,
        affiliateNameSnapshot: "本项目施工企业", companyEntityVersionId: null,
        readinessSnapshot: { signingIdentity: { relationship: "outside",
          enterprise: { assignmentId, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId, roleKey: enterpriseRole, displayOrder: 0 },
          downstream: { businessPartyId: inlineDownstream ? null : downstreamId, businessPartyVersionId: inlineDownstream ? null : downstreamVersionId, roleKey: downstreamRole, displayOrder: 0 }
        }, generatedDocumentId: document.id, documentContentFingerprint: input.documentContentFingerprint }
      });
      const rounds = await server.store.prisma.approvalInstance.findMany({ where: { businessId: draft.version.id } });
      expect(rounds).toHaveLength(1);
      expect(rounds[0].frozenNodes).toEqual([
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["material_director"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["contract_director"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["project_manager"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["finance_director"] }),
        expect.objectContaining({ executionMode: "parallel", roleKeys: ["chairman", "general_manager"] })
      ]);
      const receipt = await readReceipt();
      expect({ status: receipt.status, body: await receipt.json() }).toMatchObject({ status: 200, body: { status: "submitted", result } });
      expect(await (await submit()).json()).toEqual(result);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(1);
      expect(await server.store.prisma.contractSealTask.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);

      const contractUrl = `${await server.app.getUrl()}/contracts/${draft.version.id}`;
      const duties = [
        { actor: "employee", role: "material_director", projectId: null },
        { actor: "director", role: "contract_director", projectId: null },
        { actor: "manager", role: "project_manager", projectId: draft.projectId },
        { actor: "finance", role: "finance_director", projectId: null },
        { actor: "employee", role: "general_manager", projectId: null }
      ];
      const signatureBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
      const tokens = new Map<string, string>();
      for (const [index, duty] of duties.entries()) {
        await server.store.prisma.position.upsert({ where: { id: duty.role }, create: { id: duty.role, key: duty.role }, update: {} });
        if (duty.role !== "contract_director") {
          await server.store.prisma.userPosition.create({ data: { userId: duty.actor, positionId: duty.role, projectId: duty.projectId } });
        }
        if (!tokens.has(duty.actor)) {
          const signature = await server.files.uploadPrivateFile({ originalName: "合成审批签字.png", mimeType: "image/png", sizeBytes: signatureBytes.length, buffer: signatureBytes, uploadedByUserId: duty.actor });
          await server.store.prisma.handwrittenSignatureVersion.create({ data: { userId: duty.actor, source: "canvas", fileId: signature.id, contentSha256: createHash("sha256").update(signatureBytes).digest("hex") } });
          tokens.set(duty.actor, await loginTemplateActor(server, duty.actor));
        }
        const current = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
        const round = await server.store.prisma.approvalInstance.findUnique({ where: { id: result.approvalInstanceId } });
        const approval = await fetch(`${contractUrl}/approval`, {
          method: "POST", headers: { ...draft.headers, authorization: `Bearer ${tokens.get(duty.actor)}` },
          body: JSON.stringify({ decision: "approve", expectedContractUpdatedAt: current!.updatedAt,
            expectedApprovalInstanceId: round!.id, expectedApprovalUpdatedAt: round!.updatedAt, expectedNodeIndex: index })
        });
        expect({ status: approval.status, body: await approval.json() }).toMatchObject({ status: 201, body: { status: index === 4 ? "approved_pending_seal" : "in_approval" } });
      }
      const tasks = await server.store.prisma.contractSealTask.findMany({ where: { contractVersionId: draft.version.id } });
      expect(tasks).toEqual([expect.objectContaining({ status: "in_seal", handlerUserId: "staff", approvalInstanceId: result.approvalInstanceId })]);
      await server.store.prisma.position.upsert({ where: { id: "comprehensive_director" }, create: { id: "comprehensive_director", key: "comprehensive_director" }, update: {} });
      await server.store.prisma.userPosition.create({ data: { userId: "director", positionId: "comprehensive_director", projectId: null } });
      const director = await loginTemplateActor(server, "director");
      const sealInput = { expectedApprovalInstanceId: result.approvalInstanceId, expectedSealTaskId: String(tasks[0].id),
        documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint, confirmed: true };
      const confirmSeal = (token: string, patch: object = {}) => fetch(`${contractUrl}/seal-confirmation`, {
        method: "POST", headers: { ...draft.headers, authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...sealInput, ...patch })
      });
      await assertGeneratedSealWorkItemBlocked(server, draft, director, "seal");
      await assertGeneratedSealWorkItemHidden(server, draft, tokens.get("finance")!);
      if (!inlineDownstream) {
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { signingSubjectType: "our_company" } });
        await assertGeneratedSealWorkItemBlocked(server, draft, director, "seal");
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { signingSubjectType: "affiliate" } });
      }
      const sealDenied = await confirmSeal(director);
      expect({ status: sealDenied.status, body: await sealDenied.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("盖章交接资格尚未就绪") } });
      expect((await server.store.prisma.contractSealTask.findUnique({ where: { id: tasks[0].id } }))!.status).toBe("in_seal");
      expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.status).toBe("approved_pending_seal");
      expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal.complete" } })).toBe(0);
      await exerciseGeneratedSealConfirmation({ server, draft, director, confirmSeal, sealInput,
        archiveSource: { relationship: "outside", generatedDocumentId: document.id, signingIdentity: {
          relationship: "outside", enterprise: { assignmentId, businessPartyVersionId: enterpriseVersionId, roleKey: enterpriseRole },
          downstream: { roleKey: downstreamRole, businessPartyVersionId: inlineDownstream ? null : downstreamVersionId }
        } }, expectedRoundCount: 1, preparationEnabled: !inlineDownstream });
    } finally { await server.app.close(); }
  });

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
      await server.store.prisma.fileObject.update({ where: { id: pdf.id }, data: { contentSha256: createHash("sha256").update("synthetic current PDF").digest("hex") } });
      const submit = () => fetch(`${draft.base}/submission`, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      let response: Response;
      if (contractType === "other") {
        const store = server.store.prisma;
        const receipts = store.contractDraftSubmissionRequest;
        const auditCount = await store.auditLog.count();
        const submitAfterCollision = async (
          key: string,
          target: string[],
          prepareWinner?: (receipt: Record<string, unknown>) => Promise<() => Promise<void>>
        ) => {
          const collision = new Prisma.PrismaClientKnownRequestError("合成唯一约束冲突", {
            code: "P2002", clientVersion: "synthetic", meta: { modelName: "ContractDraftSubmissionRequest", target }
          });
          const transaction = store.$transaction;
          let commitWinner: (() => Promise<void>) | undefined;
          const receiptWrite = jest.spyOn(receipts, "create").mockImplementationOnce(async ({ data }) => {
            commitWinner = await prepareWinner?.(data);
            throw collision;
          });
          // The synthetic store serializes transactions. The winning row becomes
          // visible only after the losing transaction has rolled back.
          const transactions = jest.spyOn(store, "$transaction").mockImplementation(async work => {
            try { return await transaction(work); }
            catch (error) {
              const commit = commitWinner;
              commitWinner = undefined;
              await commit?.();
              throw error;
            }
          });
          try {
            return await rawSubmit({ ...input, idempotencyKey: key });
          } finally {
            transactions.mockRestore();
            receiptWrite.mockRestore();
          }
        };
        const foreignKey = randomUUID();
        const foreign = await submitAfterCollision(foreignKey, ["idempotencyKey"], async data => async () => {
          await receipts.create({ data: { ...data, contractVersionId: randomUUID(), applicantUserId: "other-originator",
            requestSha256: "0".repeat(64), approvalInstanceId: randomUUID(), formalCode: "他人原合同编号",
            responseSnapshot: { status: "in_approval" } } });
        });
        expect({ status: foreign.status, body: await foreign.json() }).toMatchObject({ status: 409, body: { message: "本次提交标识已用于其他内容，请刷新后重新提交" } });
        expect(await (await fetch(`${draft.base}/submission-requests/${foreignKey}`, { headers: draft.headers })).json()).toEqual({ status: "unknown" });

        const unknown = await submitAfterCollision(randomUUID(), ["idempotencyKey"]);
        expect({ status: unknown.status, body: await unknown.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("保留本次标识") } });
        expect((await submitAfterCollision(randomUUID(), ["approvalInstanceId"])).status).toBe(500);
        expect(await store.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(0);
        expect(await store.auditLog.count()).toBe(auditCount);
        expect(await store.contractVersion.findUnique({ where: { id: draft.version.id } })).toMatchObject({ status: "draft" });

        let winningResult: unknown;
        response = await submitAfterCollision(input.idempotencyKey, ["idempotencyKey"], async data => {
          const round = await store.approvalInstance.findUniqueOrThrow({ where: { id: data.approvalInstanceId } });
          const committedVersion = await store.contractVersion.findUniqueOrThrow({ where: { id: draft.version.id } });
          winningResult = data.responseSnapshot;
          return async () => {
            await store.approvalInstance.create({ data: round });
            await store.contractVersion.update({ where: { id: draft.version.id }, data: committedVersion });
            await store.contract.update({ where: { id: draft.contract.id }, data: { code: data.formalCode } });
            await receipts.create({ data });
          };
        });
        expect(await response.clone().json()).toEqual(winningResult);
        expect(await store.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(1);
        expect(await store.auditLog.count()).toBe(auditCount);
      } else {
        response = await submit();
      }
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
      // An old writer or import can attach non-public facts to the stored JSON.
      const contaminatedResult = { ...result, partyEntrySnapshots: [{ projectId: randomUUID(), privateNote: "合成异项目内部资料" }] };
      await server.store.prisma.contractDraftSubmissionRequest.update({
        where: { idempotencyKey: input.idempotencyKey },
        data: { responseSnapshot: contaminatedResult }
      });
      const [projectedRead, projectedReplay] = await Promise.all([getReceipt(), submit()]);
      expect({
        readStatus: projectedRead.status,
        readResult: (await projectedRead.json()).result,
        replayStatus: projectedReplay.status,
        replayResult: await projectedReplay.json()
      }).toEqual({ readStatus: 200, readResult: result, replayStatus: 201, replayResult: result });
      expect(await server.store.prisma.contractDraftSubmissionRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } }))
        .toMatchObject({ responseSnapshot: contaminatedResult });
      for (const badResult of [{ ...result, formalCode: "另一正式编号" }, { contractVersionId: result.contractVersionId, approvalInstanceId: result.approvalInstanceId, status: result.status }]) {
        await server.store.prisma.contractDraftSubmissionRequest.update({ where: { idempotencyKey: input.idempotencyKey }, data: { responseSnapshot: badResult } });
        expect(await (await getReceipt()).json()).toEqual({ status: "unknown" });
        expect((await submit()).status).toBe(503);
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
      expect(await (await submit()).json()).toEqual(result);
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
      expect(await (await submit()).json()).toEqual(result);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: draft.version.id } })).toBe(2);
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
      const lifecycleBeforeSealResponse = await fetch(`${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: { ...draft.headers, authorization: `Bearer ${director}` } });
      const lifecycleBeforeSeal = await lifecycleBeforeSealResponse.json();
      if (contractType === "other") {
        // Keep the pre-existing legal inline submission/approval positive. Its
        // not-yet-supported archive source must not advertise a ready context.
        expect({ status: lifecycleBeforeSealResponse.status, context: lifecycleBeforeSeal.v2Lifecycle }).toMatchObject({ status: 200, context: { status: "unavailable", sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: false, enabled: false }, webWriteReleased: false } });
      } else expect({ status: lifecycleBeforeSealResponse.status, context: lifecycleBeforeSeal.v2Lifecycle }).toMatchObject({ status: 200, context: {
        status: "ready", protocolVersion: 2, source: "generated_approval", scope: "inside_original", webWriteReleased: false,
        contractVersionId: draft.version.id, approvalInstanceId: secondRound!.id, sealTaskId: sealTask!.id,
        documentContentRevision: sealConfirmation.documentContentRevision, documentContentFingerprint: sealConfirmation.documentContentFingerprint,
        state: "pending_seal", sealAction: { eligible: true, enabled: false }, archiveAction: { eligible: false, enabled: false },
        sealOutcome: { status: "pending", completedAt: null, completedByUserId: null }, approvalSource: { status: "references_ready" }
      } });
      expect(lifecycleBeforeSeal.availableActionKeys).not.toEqual(expect.arrayContaining(["approve_seal"]));
      if (contractType === "material_purchase" && !operatingEnabled && handlerRole === "project_staff") {
        const freshRound = await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRound!.id } });
        const originalNodes = freshRound!.frozenNodes as Prisma.JsonArray;
        const firstNode = originalNodes[0] as Prisma.JsonObject;
        const originalSnapshot = firstNode.submissionSnapshot as Prisma.JsonObject;
        const selectedDocument = await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: String(originalSnapshot.generatedDocumentId) } });
        const originalTrace = selectedDocument!.inputSnapshot as Prisma.JsonObject;
        const snapshotWithoutSHA = { ...originalSnapshot }; delete snapshotWithoutSHA.sourceSha256;
        const traceMappingWithoutSHA = { ...(originalTrace.layoutSourceMapping as Prisma.JsonObject) }; delete traceMappingWithoutSHA.sourceSha256;
        await server.store.prisma.approvalInstance.update({ where: { id: freshRound!.id }, data: { frozenNodes: originalNodes.map((node, index) => index === 0 ? { ...firstNode, submissionSnapshot: snapshotWithoutSHA } : node) } });
        await server.store.prisma.contractGeneratedDocument.update({ where: { id: selectedDocument!.id }, data: { inputSnapshot: { ...originalTrace, layoutSourceMapping: traceMappingWithoutSHA } } });
        const absentSource = await fetch(`${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: { ...draft.headers, authorization: `Bearer ${director}` } }).then(response => response.json());
        expect(absentSource.v2Lifecycle).toMatchObject({ status: "unavailable", sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: false, enabled: false } });
        expect(absentSource.v2Lifecycle).not.toHaveProperty("approvalInstanceId");
        await server.store.prisma.approvalInstance.update({ where: { id: freshRound!.id }, data: { frozenNodes: originalNodes } });
        await server.store.prisma.contractGeneratedDocument.update({ where: { id: selectedDocument!.id }, data: { inputSnapshot: originalTrace } });
        const readContextDetail = (token = director) => fetch(`${awaitUrl}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: { ...draft.headers, authorization: `Bearer ${token}` } }).then(response => response.json());
        const awaitUrl = await server.app.getUrl();
        const originalFileRefs = originalSnapshot.files as Prisma.JsonArray;
        const wordFileRef = originalFileRefs.map(raw => raw as Prisma.JsonObject).find(ref => ref.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")!;
        const missingHashRefs = originalFileRefs.map(raw => { const ref = raw as Prisma.JsonObject; return ref.fileId === wordFileRef.fileId ? { ...ref, contentSha256: null } : ref; });
        await server.store.prisma.approvalInstance.update({ where: { id: freshRound!.id }, data: { frozenNodes: originalNodes.map((node, index) => index === 0 ? { ...firstNode, submissionSnapshot: { ...originalSnapshot, files: missingHashRefs } } : node) } });
        await server.store.prisma.fileObject.update({ where: { id: String(wordFileRef.fileId) }, data: { contentSha256: null } });
        expect((await readContextDetail()).v2Lifecycle).toMatchObject({ status: "unavailable", sealAction: { eligible: false, enabled: false } });
        await server.store.prisma.approvalInstance.update({ where: { id: freshRound!.id }, data: { frozenNodes: originalNodes } });
        await server.store.prisma.fileObject.update({ where: { id: String(wordFileRef.fileId) }, data: { contentSha256: wordFileRef.contentSha256 } });
        const originalTask = await server.store.prisma.contractSealTask.findUnique({ where: { id: sealTask!.id } });
        await server.store.prisma.contractSealTask.update({ where: { id: sealTask!.id }, data: { approvalInstanceId: rounds[0].id } });
        const staleRoundContext = await readContextDetail();
        expect(staleRoundContext.v2Lifecycle).toMatchObject({ status: "unavailable", webWriteReleased: false });
        expect(staleRoundContext.availableActions.some((action: { key: string }) => ["approve_seal", "complete_seal", "upload_archive", "confirm_archive", "upload_final_contract", "confirm_final_contract"].includes(action.key))).toBe(false);
        await server.store.prisma.contractSealTask.update({ where: { id: sealTask!.id }, data: { approvalInstanceId: originalTask!.approvalInstanceId } });
        await server.store.prisma.contractGeneratedDocument.update({ where: { id: selectedDocument!.id }, data: { pdfFileId: selectedDocument!.docxFileId } });
        expect((await readContextDetail()).v2Lifecycle.status).toBe("unavailable");
        await server.store.prisma.contractGeneratedDocument.update({ where: { id: selectedDocument!.id }, data: { pdfFileId: selectedDocument!.pdfFileId } });
        const controlledCurrentParty = await server.store.prisma.contractPartySnapshot.findFirst({ where: { contractVersionId: draft.version.id, roleKey: "party_b" }, orderBy: { displayOrder: "asc" } });
        await server.store.prisma.contractPartySnapshot.update({ where: { id: controlledCurrentParty!.id }, data: { businessPartyVersionId: randomUUID() } });
        expect((await readContextDetail()).v2Lifecycle.status).toBe("unavailable");
        await server.store.prisma.contractPartySnapshot.update({ where: { id: controlledCurrentParty!.id }, data: { businessPartyVersionId: controlledCurrentParty!.businessPartyVersionId } });
        const originalVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } });
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { documentContentFingerprint: "e".repeat(64) } });
        expect((await readContextDetail()).v2Lifecycle.status).toBe("unavailable");
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { documentContentFingerprint: originalVersion!.documentContentFingerprint } });
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { signingSubjectType: "affiliate" } });
        expect((await readContextDetail()).v2Lifecycle.status).toBe("unavailable");
        await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { signingSubjectType: originalVersion!.signingSubjectType } });
        const technicalContext = await readContextDetail(technical);
        expect(technicalContext.v2Lifecycle).toMatchObject({ status: "ready", sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: false, enabled: false } });
        const newDraftVersion = await server.store.prisma.contractVersion.create({ data: { contractId: draft.contract.id, numericProtocolVersion: 2, versionNo: 2, changeType: "change", status: "draft", signingSubjectType: "draft_unconfirmed", amountCents: 0n, amountYuan: null } });
        const historyContext = await readContextDetail();
        expect(historyContext.v2Lifecycle).toMatchObject({ status: "unavailable", reason: expect.stringContaining("历史版本"), webWriteReleased: false });
        await server.store.prisma.contractVersion.delete({ where: { id: newDraftVersion.id } });
        const legacyContract = await server.store.prisma.contract.create({ data: { projectId: draft.projectId, ownerUserId: "staff", name: "原V1流程只读控制", contractTypeKey: "material_purchase", counterparty: "原供应单位", code: "HT-LEGACY-READ", temporaryCode: "LEGACY-READ" } });
        const legacyVersion = await server.store.prisma.contractVersion.create({ data: { contractId: legacyContract.id, numericProtocolVersion: 1, amountCents: 10000n, amountYuan: null, versionNo: 1, changeType: "original", status: "approved_pending_seal", contractGovernanceVersion: null, signingSubjectType: "our_company", companyEntityVersionId: originalVersion!.companyEntityVersionId, companyEntityIdSnapshot: originalVersion!.companyEntityIdSnapshot, firstSubmittedAt: new Date() } });
        await server.store.prisma.paymentTermsVersion.create({ data: { contractId: legacyContract.id, contractVersionId: legacyVersion.id, versionNo: 1, status: "active" } });
        const legacyDetail = await fetch(`${awaitUrl}/contracts/${legacyContract.id}?versionId=${legacyVersion.id}`, { headers: { ...draft.headers, authorization: `Bearer ${director}` } });
        const legacyBody = await legacyDetail.json();
        expect({ status: legacyDetail.status, actions: legacyBody.availableActionKeys }).toMatchObject({ status: 200, actions: expect.arrayContaining(["approve_seal"]) });
        expect(legacyBody).not.toHaveProperty("v2Lifecycle");

      }

      const beforeSealTodo = await fetch(`${await server.app.getUrl()}/me/work-items`, { headers: { ...draft.headers, authorization: `Bearer ${director}` } });
      const sealTodo = await beforeSealTodo.json();
      expect({ status: beforeSealTodo.status, pending: sealTodo.queues?.pending }).toMatchObject({ status: 200, pending: expect.arrayContaining([expect.objectContaining({ businessId: draft.version.id, currentNode: "确认已盖章", nextAction: "核对线下盖章完成后确认" })]) });
      if (contractType === "material_purchase" && !operatingEnabled && handlerRole === "project_staff") {
        server.store.sealCommitOutcome = "return_without_persisting";
        const resolvedButNotPersistedSeal = await confirmSeal();
        expect(resolvedButNotPersistedSeal.status).toBe(201);
        const persistedSealRead = await fetch(`${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: { ...draft.headers, authorization: `Bearer ${director}` } }).then(response => response.json());
        expect(persistedSealRead.v2Lifecycle).toMatchObject({ status: "ready", state: "pending_seal", sealOutcome: { status: "pending", completedAt: null, completedByUserId: null } });
        expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.seal.complete" } })).toBe(0);
        server.store.sealCommitOutcome = "persist";
        // The next POST is an explicit operator continuation of the same tuple,
        // not an automatic retry inferred from the unknown persistent outcome.
      }
      const sealed = await fetch(`${await server.app.getUrl()}/contracts/${draft.version.id}/seal-confirmation`, { method: "POST", headers: { ...draft.headers, authorization: `Bearer ${director}` }, body: JSON.stringify(sealConfirmation) });
      const sealResult = await sealed.json();
      expect({ status: sealed.status, body: sealResult }).toMatchObject({ status: 201, body: { status: "seal_approved_pending_archive" } });
      const completedSealDetail = await fetch(`${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: draft.headers }).then(response => response.json());
      if (contractType === "other") expect(completedSealDetail.v2Lifecycle.status).toBe("unavailable");
      else expect(completedSealDetail.v2Lifecycle).toMatchObject({ status: "ready", state: "pending_archive", contractVersionId: draft.version.id, approvalInstanceId: secondRound!.id, sealTaskId: sealTask!.id, webWriteReleased: false,
        sealOutcome: { status: "completed", completedByUserId: "director", completedAt: expect.any(String) }, sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: true, enabled: false } });

      if (contractType === "material_purchase" && !operatingEnabled && handlerRole === "project_staff") {
        const detailUrl = `${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`;
        const readCurrent = () => fetch(detailUrl, { headers: draft.headers }).then(response => response.json());
        await server.store.prisma.project.update({ where: { id: draft.projectId }, data: { isActive: false } });
        expect((await readCurrent()).v2Lifecycle).toMatchObject({ status: "ready", state: "pending_archive", archiveAction: { eligible: false, enabled: false, reason: "项目当前不可办理归档" } });
        await server.store.prisma.project.update({ where: { id: draft.projectId }, data: { isActive: true } });
        const originalParticipant = await server.store.prisma.projectParticipatingCompany.findFirst({ where: { projectId: draft.projectId } });
        const originalEnd = originalParticipant!.endedAt;
        await server.store.prisma.projectParticipatingCompany.update({ where: { id: originalParticipant!.id }, data: { endedAt: new Date("2000-01-01T00:00:00.000Z") } });
        expect((await readCurrent()).v2Lifecycle).toMatchObject({ status: "ready", state: "pending_archive", archiveAction: { eligible: false, enabled: false, reason: "签约公司在当前归档日期的项目参与资格已变化" } });
        await server.store.prisma.projectParticipatingCompany.update({ where: { id: originalParticipant!.id }, data: { endedAt: originalEnd } });
        expect((await readCurrent()).v2Lifecycle.archiveAction).toMatchObject({ eligible: true, enabled: false });
      }

      expect(await (await confirmSeal()).json()).toEqual(sealResult);
      if (contractType === "material_purchase" && !operatingEnabled && handlerRole === "project_staff") {
        await server.store.prisma.userPosition.create({ data: { userId: "employee", positionId: "comprehensive_director", projectId: null } });
        expect((await confirmSeal({}, employee)).status).toBe(409);
        const anotherActorDetail = await fetch(`${await server.app.getUrl()}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: { ...draft.headers, authorization: `Bearer ${employee}` } }).then(response => response.json());
        expect(anotherActorDetail.v2Lifecycle).toMatchObject({ actorUserId: "employee", sealOutcome: { status: "completed", completedByUserId: "director" }, sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: false, enabled: false } });
      }

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
        if (!operatingEnabled && handlerRole === "project_staff") {
          const currentRound = await server.store.prisma.approvalInstance.findUnique({ where: { id: secondRound!.id } });
          const nodes = currentRound!.frozenNodes as Prisma.JsonArray;
          const first = nodes[0] as Prisma.JsonObject;
          const source = first.submissionSnapshot as Prisma.JsonObject;
          await server.store.prisma.approvalInstance.update({ where: { id: secondRound!.id }, data: { frozenNodes: nodes.map((node, index) => index === 0 ? { ...first, submissionSnapshot: { ...source, files: [...source.files as Prisma.JsonArray].reverse() } } : node) } });
          const reversedDetail = await fetch(`${serverUrl}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: draft.headers }).then(response => response.json());
          expect(reversedDetail.v2Lifecycle).toMatchObject({ status: "unavailable", archiveAction: { eligible: false, enabled: false } });
          expect((await sendArchive()).status).toBe(409);
          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive.complete" } })).toBe(0);
          await server.store.prisma.approvalInstance.update({ where: { id: secondRound!.id }, data: { frozenNodes: nodes } });
          expect((await fetch(`${serverUrl}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: draft.headers }).then(response => response.json())).v2Lifecycle).toMatchObject({ status: "ready", state: "pending_archive", archiveAction: { eligible: true, enabled: false } });
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
          const lockedBody = await locked.json();
          expect({ status: locked.status, body: lockedBody }).toMatchObject({ status: unavailable === "busy" ? 409 : 503, body: { message: expect.stringContaining(unavailable === "busy" ? "文件绑定正在办理" : "文件绑定锁结果尚未确认") } });
          if (unavailable === "busy") expect(lockedBody).toMatchObject({ code: "CONTRACT_ARCHIVE_BINDING_BUSY", attemptOutcome: "not_applied" });
          else { expect(lockedBody).not.toHaveProperty("attemptOutcome"); expect(lockedBody).not.toHaveProperty("code"); }

          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect(await server.store.prisma.contractArchiveEvidenceFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect((await server.store.prisma.contractVersion.findUnique({ where: { id: draft.version.id } }))!.status).toBe("seal_approved_pending_archive");
          expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive.complete" } })).toBe(0);
          expect(await (await readArchiveResult()).json()).toEqual({ status: "unknown" });
          const freshRecoveryContext = await fetch(`${serverUrl}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: draft.headers }).then(response => response.json());
          expect(freshRecoveryContext.v2Lifecycle).toMatchObject({ status: "ready", state: "pending_archive", actorUserId: "staff", contractVersionId: draft.version.id,
            approvalInstanceId: archiveInput.expectedApprovalInstanceId, sealTaskId: archiveInput.expectedSealTaskId, documentContentRevision: archiveInput.documentContentRevision, documentContentFingerprint: archiveInput.documentContentFingerprint,
            archiveAction: { eligible: true, enabled: false }, webWriteReleased: false });

        }
        server.store.archiveBindingLockResult = "available";
        if (!operatingEnabled) {
          server.store.archiveCommitOutcome = "return_without_persisting";
          const uncertain = await sendArchive();
          expect({ status: uncertain.status, body: await uncertain.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("归档结果尚未确认") } });
          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } })).toBe(0);
          expect(await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id, action: "contract.archive.complete" } })).toBe(0);
          expect(await (await readArchiveResult()).json()).toEqual({ status: "unknown" });
          const freshRecoveryContext = await fetch(`${serverUrl}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: draft.headers }).then(response => response.json());
          expect(freshRecoveryContext.v2Lifecycle).toMatchObject({ status: "ready", state: "pending_archive", actorUserId: "staff", contractVersionId: draft.version.id,
            approvalInstanceId: archiveInput.expectedApprovalInstanceId, sealTaskId: archiveInput.expectedSealTaskId, documentContentRevision: archiveInput.documentContentRevision, documentContentFingerprint: archiveInput.documentContentFingerprint,
            archiveAction: { eligible: true, enabled: false }, webWriteReleased: false });

          server.store.archiveCommitOutcome = "persist";
          // This explicit next POST models the operator's new deliberate action;
          // neither the archive service nor its GET re-sends automatically.
        }
        const originalIntentBytes = JSON.stringify(archiveInput);
        const archive = await sendArchive();
        let archiveResult;
        if (operatingEnabled && sourceAmount === "100.0054") {
          // The successful HTTP response body is deliberately discarded, like
          // a response lost at the transport boundary. Only the original-key
          // durable GET supplies the outcome used by the consumer.
          const recoveredResponse = await readArchiveResult();
          const recovered = await recoveredResponse.json();
          expect({ status: recoveredResponse.status, body: recovered }).toMatchObject({ status: 200, body: { status: "archived", intent: archiveInput } });
          archiveResult = recovered.result;
        } else archiveResult = await archive.json();
        expect(JSON.stringify(archiveInput)).toBe(originalIntentBytes);
        expect({ status: archive.status, body: archiveResult }).toMatchObject({ status: 201, body: { contractVersionId: draft.version.id, status: "effective" } });
        if (!operatingEnabled) {
          const durable = (await server.store.prisma.contractArchiveFile.findUnique({ where: { id: archiveResult.archiveId } }))!;
          const response = durable.responseSnapshot as Prisma.JsonObject;
          const corrupted = { ...response, internalProjectReference: "synthetic-other-project-reference" };
          const counts = async () => ({
            archives: await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } }),
            files: await server.store.prisma.contractArchiveEvidenceFile.count({ where: { contractVersionId: draft.version.id } }),
            audits: await server.store.prisma.auditLog.count({ where: { businessId: draft.version.id } })
          });
          const beforeRead = await counts();
          try {
            await server.store.prisma.contractArchiveFile.update({ where: { id: durable.id }, data: { responseSnapshot: corrupted } });
            const lookup = await readArchiveResult();
            const replay = await sendArchive();
            expect({ lookup: await lookup.json(), replay: await replay.json() }).toEqual({
              lookup: { status: "archived", result: archiveResult, requestSha256: durable.requestSha256, intent: archiveInput },
              replay: archiveResult
            });
            expect([lookup.status, replay.status]).toEqual([200, 201]);
            expect((await server.store.prisma.contractArchiveFile.findUnique({ where: { id: durable.id } }))!.responseSnapshot).toEqual(corrupted);
            await server.store.prisma.contractArchiveFile.update({ where: { id: durable.id }, data: {
              responseSnapshot: { ...corrupted, fileIds: [...archiveInput.fileIds].reverse() }
            } });
            expect((await readArchiveResult()).status).toBe(503);
            expect((await sendArchive()).status).toBe(503);
            expect(await counts()).toEqual(beforeRead);
          } finally {
            await server.store.prisma.contractArchiveFile.update({ where: { id: durable.id }, data: { responseSnapshot: response } });
          }
        }
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
        expect(detail.v2Lifecycle).toMatchObject({ status: "ready", state: "archived", webWriteReleased: false, sealAction: { eligible: false, enabled: false }, archiveAction: { eligible: false, enabled: false } });
        expect(detail.availableActions.some((action: { key: string }) => ["approve_seal", "complete_seal", "upload_archive", "confirm_archive", "upload_final_contract", "confirm_final_contract"].includes(action.key))).toBe(false);
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
        const readDetailContext = async (tokenHeaders = draft.headers) => {
          const response = await fetch(`${serverUrl}/contracts/${draft.contract.id}?versionId=${draft.version.id}`, { headers: tokenHeaders });
          const body = await response.json();
          return { status: response.status, context: body.v2Lifecycle, message: body.message };
        };
        const financeHeaders = { ...draft.headers, authorization: `Bearer ${financeToken}` };
        expect(await readDetailContext(financeHeaders)).toMatchObject({ status: 200, context: { status: "ready", state: "archived", actorUserId: "finance" } });
        expect((await fetch(`${serverUrl}/contracts/${draft.version.id}/archive-requests/${archiveInput.idempotencyKey}`, { headers: financeHeaders })).status).toBe(403);
        const assertIncompleteDetail = async (detailStatus: 200 | 400 = 200) => {
          const auditsBefore = await server.store.prisma.auditLog.count();
          expect((await readArchiveResult()).status).toBe(503);
          const expected = detailStatus === 400 ? { status: 400, context: undefined, message: "归档原件清单不完整，请核对原归档记录" } : { status: 200, context: { status: "unavailable", archiveAction: { eligible: false, enabled: false } } };
          expect(await readDetailContext()).toMatchObject(expected);
          expect(await readDetailContext(financeHeaders)).toMatchObject(expected);
          expect(await server.store.prisma.auditLog.count()).toBe(auditsBefore);
        };
        if (!operatingEnabled && handlerRole === "project_staff") {
          const authority = await server.store.prisma.contractArchiveFile.findUnique({ where: { id: archiveResult.archiveId } });
          const frozen = authority!.authoritySnapshot as Prisma.JsonObject;
          const direct = await openDirectPendingDraft(server);
          await server.store.prisma.projectMember.create({ data: { projectId: direct.projectId, userId: "staff", positionKey: "contract_staff" } });
          const reservedKey = archiveInput.idempotencyKey;
          const directUrl = `${direct.base}/contracts/${direct.created.version.id}`;
          const collision = await fetch(`${directUrl}/signed-archive`, { method: "POST", headers: direct.headers, body: JSON.stringify({
            archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: reservedKey,
            expectedDraftRevision: 1, expectedInputSha256: "d".repeat(64), fileIds: [randomUUID()],
            confirmedMatchingSignedDocument: true
          }) });
          expect({ status: collision.status, body: await collision.json() })
            .toMatchObject({ status: 409, body: { message: expect.stringContaining("归档标识已用于不同内容") } });
          expect((await fetch(`${directUrl}/archive-requests/${reservedKey}`, { headers: direct.headers })).status).toBe(403);
          expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: direct.created.version.id } })).toBe(0);
          expect(await server.store.prisma.contractVersion.findUnique({ where: { id: direct.created.version.id } }))
            .toMatchObject({ status: "draft" });
          // A durable source discriminator cannot borrow the other source's proof.
          await server.store.prisma.contractArchiveFile.update({ where: { id: authority!.id }, data: { archiveSource: "direct_signed" } });
          expect((await readArchiveResult()).status).toBe(503);
          await server.store.prisma.contractArchiveFile.update({ where: { id: authority!.id }, data: { archiveSource: "generated_approval" } });
          expect((await readArchiveResult()).status).toBe(200);
          const originalEvidence = await server.store.prisma.contractArchiveEvidenceFile.findFirst({ where: { archiveFileId: authority!.id }, orderBy: { displayOrder: "asc" } });
          await server.store.prisma.contractArchiveEvidenceFile.delete({ where: { id: originalEvidence!.id } });
          await assertIncompleteDetail(400);
          await server.store.prisma.contractArchiveEvidenceFile.create({ data: originalEvidence! });
          await server.store.prisma.contractArchiveFile.update({ where: { id: authority!.id }, data: { authoritySnapshot: { ...frozen, operatingConsequence: { ...(frozen.operatingConsequence as Prisma.JsonObject), mode: "missing_mode" } } } });
          await assertIncompleteDetail();
          await server.store.prisma.contractArchiveFile.update({ where: { id: authority!.id }, data: { authoritySnapshot: frozen } });
          expect(await readDetailContext()).toMatchObject({ status: 200, context: { status: "ready", state: "archived" } });
        }
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
          expect(await readDetailContext()).toMatchObject({ status: 200, context: { status: "ready", state: "archived" } });
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
          await assertIncompleteDetail();
          await server.store.prisma.operatingFact.create({ data: fact! });
          await server.store.prisma.operatingImpactEntry.delete({ where: { id: impact!.id } });
          await assertIncompleteDetail();
          await server.store.prisma.operatingImpactEntry.create({ data: impact! });
          await server.store.prisma.operatingImpactEntry.update({ where: { id: impact!.id }, data: { amountYuan: new Prisma.Decimal("0.0001") } });
          const inconsistent = await readArchiveResult();
          expect({ status: inconsistent.status, body: await inconsistent.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("经营事实") } });
          expect(await readDetailContext()).toMatchObject({ status: 200, context: { status: "unavailable" } });
          await server.store.prisma.operatingImpactEntry.update({ where: { id: impact!.id }, data: { amountYuan: impact!.amountYuan } });
          expect((await readArchiveResult()).status).toBe(200);
          expect(await readDetailContext(financeHeaders)).toMatchObject({ status: 200, context: { status: "ready", state: "archived" } });
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

type GeneratedSealInput = {
  expectedApprovalInstanceId: string;
  expectedSealTaskId: string;
  documentContentRevision: number;
  documentContentFingerprint: string;
  confirmed: boolean;
};

async function generatedSealWorkItems(
  server: Awaited<ReturnType<typeof createTemplateTestServer>>,
  draft: Awaited<ReturnType<typeof createTask09Draft>>,
  token: string
) {
  const response = await fetch(`${await server.app.getUrl()}/me/work-items`, { headers: { ...draft.headers, authorization: `Bearer ${token}` } });
  const { queues } = await response.json() as { queues: Record<"pending" | "blocked", Array<{ businessId: string }>> };
  const forVersion = (item: { businessId: string }) => item.businessId === draft.version.id;
  return { status: response.status, pending: queues?.pending?.filter(forVersion), blocked: queues?.blocked?.filter(forVersion) };
}

async function assertGeneratedSealWorkItemHidden(
  server: Awaited<ReturnType<typeof createTemplateTestServer>>,
  draft: Awaited<ReturnType<typeof createTask09Draft>>,
  token: string
) {
  expect(await generatedSealWorkItems(server, draft, token)).toEqual({ status: 200, pending: [], blocked: [] });
}

async function assertGeneratedSealWorkItemBlocked(
  server: Awaited<ReturnType<typeof createTemplateTestServer>>,
  draft: Awaited<ReturnType<typeof createTask09Draft>>,
  token: string,
  phase: "seal" | "archive"
) {
  const headers = { ...draft.headers, authorization: `Bearer ${token}` };
  const base = await server.app.getUrl();
  const store = server.store.prisma;
  const contract = await store.contract.findUnique({ where: { id: draft.contract.id } });
  const versionWhere = { contractVersionId: draft.version.id };
  const auditsWhere = { businessId: draft.version.id };
  const taskBefore = await store.contractSealTask.findMany({ where: versionWhere });
  const auditsBefore = await store.auditLog.findMany({ where: auditsWhere });
  expect(await generatedSealWorkItems(server, draft, token)).toEqual({
    status: 200, pending: [], blocked: [expect.objectContaining({
      id: `contract-v2-${phase}:${draft.version.id}`, type: "blocker", targetPath: `/合同管理/${contract!.code}`,
      currentNode: phase === "seal" ? "盖章办理暂不可用" : "归档办理暂不可用", nextAction: "查看合同详情并保留当前资料"
    })]
  });
  const stage = phase === "seal" ? "pending_seal" : "pending_archive";
  for (const [view, expectedVersions] of [["pending_action", []], [stage, [draft.version.id]], ["all", [draft.version.id]]] as const) {
    const response = await fetch(`${base}/contracts/workbench?view=${view}`, { headers });
    const body = await response.json() as { rows?: Array<{ contractVersionId: string }> };
    expect({ view, status: response.status, versions: body.rows?.map(row => row.contractVersionId) }).toEqual({ view, status: 200, versions: expectedVersions });
  }
  const detail = await fetch(`${base}/contracts/${encodeURIComponent(String(contract!.code))}?versionId=${draft.version.id}`, { headers });
  const body = await detail.json();
  expect({ status: detail.status, body }).toMatchObject({ status: 200, body: { contractVersionId: draft.version.id,
    v2Lifecycle: { status: "unavailable", webWriteReleased: false,
      sealAction: { enabled: false }, archiveAction: { enabled: false } } } });
  expect(body.availableActionKeys.filter((key: string) => ["approve_seal", "complete_seal", "confirm_seal_v2", "archive_signed_v2", "upload_archive", "upload_final_contract"].includes(key))).toEqual([]);
  expect(await store.contractSealTask.findMany({ where: versionWhere })).toEqual(taskBefore);
  expect(await store.auditLog.findMany({ where: auditsWhere })).toEqual(auditsBefore);
}

async function exerciseGeneratedSealConfirmation({ server, draft, director, confirmSeal, sealInput, archiveSource, expectedRoundCount, preparationEnabled }: {
  server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  draft: Awaited<ReturnType<typeof createTask09Draft>>;
  director: string;
  confirmSeal: (token: string, patch?: object) => Promise<Response>;
  sealInput: GeneratedSealInput;
  archiveSource: { relationship: "outside" | "upward"; generatedDocumentId: string; signingIdentity: object };
  expectedRoundCount: number;
  preparationEnabled: boolean;
}) {
  const store = server.store.prisma;
  const contractVersionId = draft.version.id;
  const { expectedApprovalInstanceId: approvalInstanceId, expectedSealTaskId: sealTaskId } = sealInput;
  const generated = await store.contractGeneratedDocument.findUnique({ where: { id: archiveSource.generatedDocumentId } });
  const fileIds = [generated!.docxFileId, generated!.pdfFileId];
  const auditCount = (action: string) => store.auditLog.count({ where: { businessId: contractVersionId, action } });
  const installation = { databaseOid: "13000", namespaceOid: "2200", currentRoleOid: "7001", sessionRoleOid: "7001",
    archiveWriterOid: "43001", signedFileAuthorityOid: "43002", archiveReceiptReaderOid: "43003", operatingAuthorityOid: "43004",
    backendPid: 71301, transactionId: "500004" };
  const assertPending = async () => {
    expect(await store.contractSealTask.findUnique({ where: { id: sealTaskId } })).toMatchObject({ status: "in_seal", completedAt: null, completedByUserId: null });
    expect(await store.contractVersion.findUnique({ where: { id: contractVersionId } })).toMatchObject({ status: "approved_pending_seal" });
    expect(await auditCount("contract.seal.complete")).toBe(0);
    expect(await auditCount("contract.archive_task.create")).toBe(0);
  };
  const prove = async (transaction: Prisma.TransactionClient, scope: generatedArchiveInstallation.GeneratedArchiveSealScope) =>
    ({ transaction, scope, installation });
  const witness = jest.spyOn(generatedArchiveInstallation, "readGeneratedArchiveSealAuthority").mockImplementation(prove);
  try {
    const technicalAssignment = await store.userPosition.create({ data: { userId: "technical", positionId: "comprehensive_director", projectId: null } });
    const technical = await loginTemplateActor(server, "technical");
    expect((await confirmSeal(technical)).status).toBe(403);
    await store.userPosition.delete({ where: { id: technicalAssignment.id } });
    expect((await confirmSeal(director, { expectedSealTaskId: randomUUID() })).status).toBe(409);
    expect((await confirmSeal(director, { documentContentRevision: sealInput.documentContentRevision + 1 })).status).toBe(409);
    expect((await confirmSeal(director, { documentContentFingerprint: "a".repeat(64) })).status).toBe(409);
    expect(witness).not.toHaveBeenCalled();

    const version = await store.contractVersion.findUnique({ where: { id: contractVersionId } });
    await store.contractVersion.update({ where: { id: contractVersionId }, data: { signingSubjectType: "our_company" } });
    expect((await confirmSeal(director)).status).toBe(409);
    await store.contractVersion.update({ where: { id: contractVersionId }, data: { signingSubjectType: version!.signingSubjectType } });
    await store.contract.update({ where: { id: draft.contract.id }, data: { ownerUserId: "employee" } });
    expect((await confirmSeal(director)).status).toBe(409);
    await store.contract.update({ where: { id: draft.contract.id }, data: { ownerUserId: "staff" } });
    expect(witness).not.toHaveBeenCalled();

    const expectProjectConflict = async () => {
      const denied = await confirmSeal(director);
      expect({ status: denied.status, body: await denied.json() }).toMatchObject({
        status: 409, body: { message: expect.stringContaining("当前项目不可办理归档") }
      });
      await assertPending();
    };
    const projectWhere = { id: draft.projectId };
    await store.project.update({ where: projectWhere, data: { isActive: false } });
    try { await expectProjectConflict(); }
    finally { await store.project.update({ where: projectWhere, data: { isActive: true } }); }

    const readProject = store.project.findUnique;
    const wrongProjectId = randomUUID();
    const wrongProject = jest.spyOn(store.project, "findUnique").mockImplementation(async args => {
      const project = await readProject(args);
      const select = (args as typeof args & Pick<Prisma.ProjectFindUniqueArgs, "select">).select;
      return project && args?.where?.id === draft.projectId && select?.id && select?.isActive
        ? { ...project, id: wrongProjectId } : project;
    });
    try { await expectProjectConflict(); }
    finally { wrongProject.mockRestore(); }

    witness.mockImplementationOnce(async (transaction, scope) => ({ transaction, scope: { ...scope, sealTaskId: randomUUID() }, installation }));
    expect((await confirmSeal(director)).status).toBe(503);
    await assertPending();

    witness.mockClear().mockImplementationOnce(prove).mockImplementationOnce(async (transaction, scope) => {
      expect(await transaction.contractSealTask.findUnique({ where: { id: sealTaskId } })).toMatchObject({ status: "completed" });
      expect(await auditCount("contract.seal.complete")).toBe(1);
      expect(await auditCount("contract.archive_task.create")).toBe(1);
      return { transaction, scope, installation: { ...installation, transactionId: "500005" } };
    });
    expect((await confirmSeal(director)).status).toBe(503);
    expect(witness).toHaveBeenCalledTimes(2);
    await assertPending();

    let sourceReads = 0;
    const readFiles = store.fileObject.findMany;
    const fileDrift = jest.spyOn(store.fileObject, "findMany").mockImplementation(async (args) => {
      const files = await readFiles(args);
      if (++sourceReads !== 2) return files;
      return files.map(file => file.id === fileIds[1] ? { ...file, contentSha256: "b".repeat(64) } : file);
    });
    try {
      const denied = await confirmSeal(director);
      expect(sourceReads).toBe(2);
      expect({ status: denied.status, body: await denied.json() }).toMatchObject({ status: 409, body: { message: expect.stringContaining("Word及PDF生成来源已变化") } });
      await assertPending();
    } finally { fileDrift.mockRestore(); }

    let grantReads = 0;
    const readMembership = store.projectMember.findFirst;
    const grantDrift = jest.spyOn(store.projectMember, "findFirst").mockImplementation(async (args) => {
      if (args?.where?.positionKey === "contract_staff" && args.where.userId === "staff" && ++grantReads === 2) {
        await store.projectMember.deleteMany({ where: args.where });
      }
      return readMembership(args);
    });
    try {
      expect((await confirmSeal(director)).status).toBe(409);
      expect(grantReads).toBe(2);
      await assertPending();
    } finally { grantDrift.mockRestore(); }

    const recordAudit = store.auditLog.create;
    const projectDrift = jest.spyOn(store.auditLog, "create").mockImplementation(async args => {
      const record = await recordAudit(args);
      if (args.data.action === "contract.archive_task.create") {
        expect(await store.contractSealTask.findUnique({ where: { id: sealTaskId } })).toMatchObject({ status: "completed" });
        expect(await auditCount("contract.seal.complete")).toBe(1);
        expect(await auditCount("contract.archive_task.create")).toBe(1);
        await store.project.update({ where: projectWhere, data: { isActive: false } });
      }
      return record;
    });
    try {
      await expectProjectConflict();
      expect(await store.project.findUnique({ where: projectWhere })).toMatchObject({ isActive: true });
    } finally { projectDrift.mockRestore(); }

    const failure = jest.spyOn(store.auditLog, "create").mockImplementation(async args => {
      if (args.data.action === "contract.archive_task.create") throw new Error("合成归档待办审计写入失败");
      return recordAudit(args);
    });
    try {
      expect((await confirmSeal(director)).status).toBe(500);
      await assertPending();
    } finally { failure.mockRestore(); }

    const actorDrift = jest.spyOn(store.auditLog, "create").mockImplementation(async args => {
      const record = await recordAudit(args);
      if (args.data.action === "contract.archive_task.create") {
        await store.userPosition.deleteMany({ where: { userId: "director", positionId: "comprehensive_director", projectId: null } });
      }
      return record;
    });
    try {
      expect((await confirmSeal(director)).status).toBe(403);
      await assertPending();
    } finally { actorDrift.mockRestore(); }

    witness.mockClear();
    const result = { contractVersionId, approvalInstanceId, sealTaskId, status: "seal_approved_pending_archive" };
    const sealed = await confirmSeal(director);
    expect({ status: sealed.status, body: await sealed.json() }).toEqual({ status: 201, body: result });
    expect(witness).toHaveBeenCalledTimes(2);
    for (const [transaction, scope] of witness.mock.calls) {
      expect(transaction).toBe(store);
      expect(scope).toMatchObject({ ...archiveSource, projectId: draft.projectId, contractId: draft.contract.id,
        contractVersionId, approvalInstanceId, sealTaskId, handlerUserId: "staff", actorUserId: "director",
        documentContentRevision: sealInput.documentContentRevision, documentContentFingerprint: sealInput.documentContentFingerprint,
        files: [expect.objectContaining({ fileId: fileIds[0] }), expect.objectContaining({ fileId: fileIds[1] })] });
    }
    const completedTask = await store.contractSealTask.findUnique({ where: { id: sealTaskId } });
    expect(completedTask).toMatchObject({ status: "completed", completedAt: expect.any(Date), completedByUserId: "director" });
    expect(await store.contractVersion.findUnique({ where: { id: contractVersionId } })).toMatchObject({ status: result.status });
    const transfer = await store.auditLog.findFirst({ where: { businessId: contractVersionId, action: "contract.archive_task.create" } });
    expect(transfer).toMatchObject({ metadata: { approvalInstanceId, sealTaskId, handlerUserId: "staff" } });

    witness.mockClear().mockResolvedValue(null);
    await store.project.update({ where: projectWhere, data: { isActive: false } });
    try {
      const repeated = await confirmSeal(director);
      expect({ status: repeated.status, body: await repeated.json() }).toEqual({ status: 201, body: result });
    } finally { await store.project.update({ where: projectWhere, data: { isActive: true } }); }
    expect(witness).not.toHaveBeenCalled();
    expect(await store.contractSealTask.findUnique({ where: { id: sealTaskId } })).toEqual(completedTask);
    expect(await auditCount("contract.seal.complete")).toBe(1);
    expect(await auditCount("contract.archive_task.create")).toBe(1);
    expect(await store.approvalInstance.count({ where: { businessId: contractVersionId } })).toBe(expectedRoundCount);
    expect(await store.contractSealTask.count({ where: { contractVersionId } })).toBe(1);
    expect(await store.contractArchiveFile.count({ where: { contractVersionId } })).toBe(0);
    witness.mockImplementation(prove);
    await exerciseGeneratedArchivePreparation(server, draft, sealInput, fileIds[1], preparationEnabled, installation);

    if (archiveSource.relationship === "outside") {
      const handler = await loginTemplateActor(server, "staff");
      await assertGeneratedSealWorkItemBlocked(server, draft, handler, "archive");
      await assertGeneratedSealWorkItemHidden(server, draft, director);
      const round = await store.approvalInstance.findUnique({ where: { id: approvalInstanceId } });
      const nodes = round!.frozenNodes as Prisma.JsonArray;
      const first = { ...nodes[0] as Prisma.JsonObject };
      delete first.submissionSnapshot;
      await store.approvalInstance.update({ where: { id: approvalInstanceId }, data: { frozenNodes: [first, ...nodes.slice(1)] } });
      await assertGeneratedSealWorkItemHidden(server, draft, handler);
      await store.approvalInstance.update({ where: { id: approvalInstanceId }, data: { frozenNodes: nodes } });
    }

    const assignment = await store.userPosition.create({ data: { userId: "employee", positionId: "comprehensive_director", projectId: null } });
    const other = await loginTemplateActor(server, "employee");
    expect((await confirmSeal(other)).status).toBe(409);
    await store.userPosition.delete({ where: { id: assignment.id } });
    await store.userPosition.deleteMany({ where: { userId: "director", positionId: "comprehensive_director", projectId: null } });
    expect((await confirmSeal(director)).status).toBe(403);
    expect(await auditCount("contract.seal.complete")).toBe(1);
    expect(await auditCount("contract.archive_task.create")).toBe(1);
  } finally { witness.mockRestore(); }
}

async function exerciseGeneratedArchivePreparation(server: Awaited<ReturnType<typeof createTemplateTestServer>>,
  draft: Awaited<ReturnType<typeof createTask09Draft>>, seal: GeneratedSealInput, generatedPdfId: unknown, preparationEnabled: boolean,
  installation: generatedArchiveInstallation.GeneratedArchiveSealAuthority["installation"]) {
  const store = server.store.prisma;
  const storage = server.app.get(PrivateFileStorage);
  const bucket = storage.bucketName();
  const seedOriginal = async (label: string) => {
    const fileId = randomUUID(), objectKey = `uploads/${fileId}.pdf`;
    const signedPdf = await PDFDocument.create();
    signedPdf.addPage().drawText(label);
    const buffer = Buffer.from(await signedPdf.save());
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const coordinates = { bucket, objectKey, sizeBytes: buffer.length, contentSha256 };
    await store.fileObject.create({ data: { id: fileId, ...coordinates, mimeType: "application/pdf",
      originalName: "双方签章原件.pdf", uploadedByUserId: "staff", storageStatus: "active" } });
    return { fileId, buffer, coordinates };
  };
  const first = await seedOriginal("SYNTHETIC SIGNED ORIGINAL ONE");
  const second = await seedOriginal("SYNTHETIC SIGNED ORIGINAL TWO");
  const url = `${await server.app.getUrl()}/contracts/${draft.version.id}`;
  const body = { archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: randomUUID(),
    expectedApprovalInstanceId: seal.expectedApprovalInstanceId, expectedSealTaskId: seal.expectedSealTaskId,
    documentContentRevision: seal.documentContentRevision, documentContentFingerprint: seal.documentContentFingerprint,
    fileIds: [second.fileId, first.fileId], confirmedMatchingSignedDocument: true };
  const archive = (patch: object = {}) => fetch(url + "/signed-archive", { method: "POST", headers: draft.headers,
    body: JSON.stringify({ ...body, ...patch }) });
  const readArchiveState = () => Promise.all([
    store.contractVersion.findUnique({ where: { id: draft.version.id } }),
    store.contractSealTask.findUnique({ where: { id: seal.expectedSealTaskId } }),
    store.contractArchiveFile.count({ where: { contractVersionId: draft.version.id } }),
    store.contractArchiveEvidenceFile.count({ where: { contractVersionId: draft.version.id } }),
    store.auditLog.count({ where: { businessId: draft.version.id } }),
    store.operatingFact.count({ where: { projectId: draft.projectId } }),
    store.operatingImpactEntry.count({ where: { projectId: draft.projectId } })
  ]);
  const before = await readArchiveState();
  const ordinaryReads = server.store.privateStorageReads;
  const writes = server.store.privateStorageWrites;
  const deletes = server.store.privateStorageDeletes;
  const readVersion = jest.spyOn(storage, "readVerifiedVersion");
  const binder = jest.spyOn(generatedArchiveInstallation, "readGeneratedArchiveRequestBinding").mockResolvedValue(null);
  try {
    if (!preparationEnabled) {
      const denied = await archive();
      expect({ status: denied.status, body: await denied.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("归档资格尚未就绪") }
      });
      expect(readVersion).not.toHaveBeenCalled();
    } else {
      expect((await archive({ expectedSealTaskId: randomUUID() })).status).toBe(409);
      expect((await archive({ fileIds: [generatedPdfId] })).status).toBe(409);
      expect((await archive({ fileIds: [second.fileId, second.fileId] })).status).toBe(400);
      const generated = await store.fileObject.findUnique({ where: { id: String(generatedPdfId) } });
      const where = { id: second.fileId };
      await store.fileObject.update({ where, data: { contentSha256: generated!.contentSha256 } });
      expect((await archive()).status).toBe(409);
      await store.fileObject.update({ where, data: { contentSha256: second.coordinates.contentSha256, uploadedByUserId: "employee" } });
      expect((await archive()).status).toBe(403);
      await store.fileObject.update({ where, data: { uploadedByUserId: "staff" } });
      const assignment = await store.projectAffiliateAssignment.findFirst({ where: { projectId: draft.projectId } });
      await store.projectAffiliateAssignment.update({ where: { id: assignment!.id }, data: { projectId: randomUUID() } });
      expect((await archive()).status).toBe(409);
      await store.projectAffiliateAssignment.update({ where: { id: assignment!.id }, data: { projectId: draft.projectId } });
      expect(readVersion).not.toHaveBeenCalled();

      const missing = await archive();
      expect({ status: missing.status, body: await missing.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("资料文件版本或完整性") }
      });
      const versioned = server.store.table("syntheticPrivateFileVersion");
      const seedVersion = (original: typeof first, objectGeneration: string, buffer = original.buffer) => versioned.create({ data: {
        bucket, objectKey: original.coordinates.objectKey, objectGeneration, base64: buffer.toString("base64")
      } });
      const broken = await seedVersion(second, "signed-original-v2", first.buffer);
      expect((await archive()).status).toBe(503);
      await versioned.delete({ where: { id: broken.id } });
      const unversioned = await seedVersion(second, "null");
      expect((await archive()).status).toBe(503);
      await versioned.delete({ where: { id: unversioned.id } });
      await seedVersion(first, "signed-original-v1");
      const secondVersion = await seedVersion(second, "signed-original-v2");
      await versioned.update({ where: { id: secondVersion.id }, data: { unavailableByVersion: true } });
      const missingPinned = await archive();
      expect({ status: missingPinned.status, body: await missingPinned.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("资料文件版本或完整性") }
      });
      await versioned.update({ where: { id: secondVersion.id }, data: { unavailableByVersion: false } });
      const unbound = await archive();
      expect({ status: unbound.status, body: await unbound.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("归档请求与签章原件的绑定尚未核对") }
      });
      const requestSha256 = createHash("sha256").update(JSON.stringify({
        versionId: draft.version.id, actor: "staff", ...body
      })).digest("hex");
      const originals = [
        { fileId: second.fileId, displayOrder: 0, ...second.coordinates, mimeType: "application/pdf", objectGeneration: "signed-original-v2" },
        { fileId: first.fileId, displayOrder: 1, ...first.coordinates, mimeType: "application/pdf", objectGeneration: "signed-original-v1" }
      ] as const;
      type Binder = typeof generatedArchiveInstallation.readGeneratedArchiveRequestBinding;
      type Witness = NonNullable<Awaited<ReturnType<Binder>>>;
      const prove = (transaction: Prisma.TransactionClient, binding: generatedArchiveInstallation.GeneratedArchiveRequestBinding): Witness => ({
        transaction, installation,
        binding: { ...binding, uploaderUserId: "staff", idempotencyKey: body.idempotencyKey, requestSha256, originals,
          scope: { ...binding.scope, handlerUserId: "staff", actorUserId: "director", projectId: draft.projectId,
            contractId: draft.contract.id, contractVersionId: draft.version.id,
            approvalInstanceId: seal.expectedApprovalInstanceId, sealTaskId: seal.expectedSealTaskId } }
      });
      const rejectsBinding = async () => {
        const denied = await archive();
        expect({ status: denied.status, body: await denied.json() }).toMatchObject({
          status: 503, body: { message: expect.stringContaining("归档请求与签章原件的绑定尚未核对") }
        });
      };
      const mismatches: Array<(value: Witness) => Witness> = [
        proof => ({ ...proof, transaction: { ...proof.transaction } }),
        proof => ({ ...proof, installation: { ...installation, transactionId: "500005" } }),
        proof => ({ ...proof, binding: { ...proof.binding, uploaderUserId: "director" } }),
        proof => ({ ...proof, binding: { ...proof.binding, requestSha256: "0".repeat(64) } }),
        proof => ({ ...proof, binding: { ...proof.binding, idempotencyKey: randomUUID() } }),
        proof => ({ ...proof, binding: { ...proof.binding, scope: { ...proof.binding.scope, projectId: randomUUID() } } }),
        proof => ({ ...proof, binding: { ...proof.binding, scope: { ...proof.binding.scope, approvalInstanceId: randomUUID() } } }),
        proof => ({ ...proof, binding: { ...proof.binding, originals: [originals[1], originals[0]] } }),
        proof => ({ ...proof, binding: { ...proof.binding, originals: [{ ...originals[0], objectGeneration: "stale" }, originals[1]] } })
      ];
      for (const mismatch of mismatches) {
        binder.mockImplementationOnce(async (tx, binding) => mismatch(prove(tx, binding)));
        await rejectsBinding();
      }
      binder.mockImplementation(async (tx, binding) => prove(tx, binding));
      const qualification = jest.mocked(generatedArchiveInstallation.readGeneratedArchiveSealAuthority);
      qualification.mockResolvedValueOnce(null);
      readVersion.mockClear();
      const unqualified = await archive();
      expect({ status: unqualified.status, body: await unqualified.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("盖章交接资格尚未就绪") }
      });
      expect(readVersion).not.toHaveBeenCalled();
      qualification
        .mockImplementationOnce(async (transaction, scope) => ({ transaction, scope, installation }))
        .mockImplementationOnce(async (transaction, scope) => ({
          transaction, scope, installation: { ...installation, signedFileAuthorityOid: "43999" }
        }));
      const drifted = await archive();
      expect({ status: drifted.status, body: await drifted.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("盖章交接资格尚未就绪") }
      });
      readVersion.mockClear();
      const prepared = await archive();
      expect({ status: prepared.status, body: await prepared.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("签章原件已核对") }
      });
      const expectedReads = [
        [second.coordinates], [first.coordinates],
        [{ ...second.coordinates, expectedGeneration: "signed-original-v2" }],
        [{ ...first.coordinates, expectedGeneration: "signed-original-v1" }]
      ];
      expect(readVersion.mock.calls).toEqual(expectedReads);
      readVersion.mockClear();
      expect((await archive()).status).toBe(503);
      expect(readVersion.mock.calls).toEqual(expectedReads);
    }
    const receipt = await fetch(url + "/archive-requests/" + body.idempotencyKey, { headers: draft.headers });
    expect({ status: receipt.status, body: await receipt.json() }).toEqual({ status: 200, body: { status: "unknown" } });
    expect(await readArchiveState()).toEqual(before);
    expect(server.store.privateStorageReads).toBe(ordinaryReads);
    expect(server.store.privateStorageWrites).toBe(writes);
    expect(server.store.privateStorageDeletes).toBe(deletes);
  } finally {
    binder.mockRestore();
    readVersion.mockRestore();
  }
}

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
