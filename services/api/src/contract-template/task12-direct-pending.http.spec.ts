import PizZip from "pizzip";
import { ContractEndedApplicationPurgeService } from "../contract-ended-purge/contract-ended-application-purge.service";
import { FileService } from "../file/file.service";
import { createHash, randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";
import { seedSelectionDraft } from "./template-selection.test-support";
import { seedDirectPendingDatabaseBinding, openDirectPendingDraft, seedPreparedDirectArchiveTransition } from "./task12-direct-pending.test-support";
import { seedDirectArchiveDispatchCatalog } from "./task12-direct-archive-dispatch.oracle";
import { addDirectArchiveRetentionToReviewCatalog, observeDirectArchiveCompletionBody, seedDirectArchiveRetentionCatalog, seedDirectArchiveCompletionCatalog } from "./task12-direct-archive-retention.oracle";
import { seedDirectReviewDatabaseBinding } from "./task12-direct-review-persistence.oracle";

describe("任务12 表外已签合同待登记基础（真实HTTP，合成持久与文件边界）", () => {
  it("直签正式登记缺少数据库权威时保留原请求，原结果未知且没有归档写入", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const versionId = draft.created.version.id;
      const membership = await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      await server.store.table("directPendingInstalledBinding").deleteMany();
      const key = randomUUID();
      const auditCount = await server.store.prisma.auditLog.count();
      const payload = {
        archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: key,
        expectedDraftRevision: 1, expectedInputSha256: "d".repeat(64), fileIds: [randomUUID()],
        confirmedMatchingSignedDocument: true
      };
      const send = (patch = {}) => fetch(`${draft.base}/contracts/${versionId}/signed-archive`, {
        method: "POST", headers: draft.headers, body: JSON.stringify({ ...payload, ...patch })
      });
      const lookup = () => fetch(`${draft.base}/contracts/${versionId}/archive-requests/${key}`, { headers: draft.headers });
      for (const malformed of [
        { expectedApprovalInstanceId: randomUUID() },
        { fileIds: [payload.fileIds[0], payload.fileIds[0]] },
        { expectedDraftRevision: "1" },
        { confirmedMatchingSignedDocument: false }
      ]) {
        expect((await send(malformed)).status).toBe(400);
      }
      const request = await send();
      const result = await lookup();
      expect({ status: request.status, lookup: result.status, outcome: await result.json() }).toEqual({
        status: 503, lookup: 200, outcome: { status: "unknown" }
      });
      await server.store.prisma.projectMember.delete({ where: { id: membership.id } });
      expect((await send()).status).toBe(403);
      expect((await lookup()).status).toBe(403);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.contractArchiveEvidenceFile.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count()).toBe(auditCount);
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } })).toMatchObject({ status: "draft" });
    } finally { await server.app.close(); }
  });

  it("已归档的直签原件只使用持久存储版本，缺少版本时拒绝普通读取", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const base = await server.app.getUrl();
      const token = await loginTemplateActor(server, "staff");
      const headers = { authorization: `Bearer ${token}` };
      const projectId = randomUUID(), contractId = randomUUID(), versionId = randomUUID(), archiveId = randomUUID();
      const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64");
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "image/png" }), "签章.png");
      const upload = await fetch(base + "/files", { method: "POST", headers, body: form });
      expect(upload.status).toBe(201);
      const { id: fileId } = await upload.json() as { id: string };
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-PINNED-DOWNLOAD", name: "合成版本下载项目", isActive: true } });
      await server.store.prisma.projectMember.create({ data: { projectId, userId: "staff", positionKey: "contract_staff" } });
      await server.store.prisma.contract.create({ data: { id: contractId, projectId, name: "合成归档合同", ownerUserId: "staff" } });
      await server.store.prisma.contractVersion.create({ data: {
        id: versionId, contractId, numericProtocolVersion: 2, versionNo: 1, changeType: "original", status: "effective"
      } });
      // A recovered direct archive fixture models a committed row, not a write route.
      await server.store.table("contractArchiveFile").createMany({ data: [{
        id: archiveId, contractVersionId: versionId, archiveProtocolVersion: 2, archiveSource: "direct_signed", status: "confirmed",
        uploadedByUserId: "staff", authoritySha256: "a".repeat(64)
      }] });
      await server.store.table("contractArchiveEvidenceFile").create({ data: {
        id: randomUUID(), archiveFileId: archiveId, contractVersionId: versionId, fileId,
        displayOrder: 0, mimeType: "image/png", sizeBytes: bytes.length, contentSha256: createHash("sha256").update(bytes).digest("hex")
      } });
      const ticket = await fetch(base + "/files/" + fileId + "/download-ticket", {
        method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对已归档原件" })
      });
      expect(ticket.status).toBe(201);
      const { downloadUrl } = await ticket.json() as { downloadUrl: string };
      const before = server.store.privateStorageReads;
      const refused = await fetch(base + downloadUrl);
      expect({ status: refused.status, body: await refused.text() }).toMatchObject({
        status: 503, body: expect.stringContaining("直签归档原件存储版本")
      });
      expect(server.store.privateStorageReads).toBe(before);
      expect(server.store.pinnedPrivateStorageReads).toBe(0);
      await seedDirectPendingDatabaseBinding(server);
      await seedDirectReviewDatabaseBinding(server);
      await seedPreparedDirectArchiveTransition(server);
      const retention = await seedDirectArchiveRetentionCatalog(server);
      await seedDirectArchiveDispatchCatalog(server);
      await observeDirectArchiveCompletionBody(server, retention);
      const dispatch = await seedDirectArchiveCompletionCatalog(server);

      const catalog = { relationOid: "29908", completionOid: "29901", qualified: true, databaseOid: "13000",
        sessionRoleOid: "7001", currentRoleOid: "7001", backendPid: 71201, transactionId: "500001" };
      const witness = await server.store.table("directArchiveGenerationCatalog").create({ data: { snapshot: catalog } });
      const file = await server.store.prisma.fileObject.findUnique({ where: { id: fileId } });
      if (!file) throw new Error("合成原件缺失");
      const original = { fileId, displayOrder: 0, bucket: file.bucket, objectKey: file.objectKey, mimeType: file.mimeType,
        sizeBytes: file.sizeBytes, contentSha256: file.contentSha256, objectGeneration: "archived+generation/1=" };
      const proof = { protocolVersion: 1, archiveId, contractVersionId: versionId, authoritySha256: "a".repeat(64), originals: [original] };
      const durable = await server.store.table("directArchiveGenerationProof").create({ data: { archiveId, snapshot: proof } });
      const provider = await server.store.table("syntheticPrivateFileVersion").create({ data: {
        bucket: file.bucket, objectKey: file.objectKey, objectGeneration: original.objectGeneration, base64: bytes.toString("base64")
      } });

      // The installed legacy binding stays unchanged when generated completion gets its own branch.
      const successorBody = "6b8253f544d4940ee068513d0a6c32cbad3d82b7144b664c98032c47a1f64c87";
      const completion = "jg_contract_archive_v2_complete_guard";
      const successorActual = { ...dispatch.actual, bindings: { ...dispatch.actual.bindings,
        procedures: { ...dispatch.actual.bindings.procedures,
          completion: { ...dispatch.actual.bindings.procedures.completion, sha256: successorBody } }
      } };
      await server.store.table("directArchiveRetentionActual").update({ where: { id: retention.observed.id }, data: {
        snapshot: { ...retention.actual, bindings: { ...retention.actual.bindings, routines: {
          ...retention.actual.bindings.routines, [completion]: { ...retention.binding.bindings.routines[completion], sha: successorBody }
        } } }
      } });
      await server.store.table("directArchiveCompletionActual").update({ where: { id: dispatch.observed.id }, data: {
        snapshot: { ...successorActual, generatedDispatchQualified: false }
      } });
      expect((await fetch(base + downloadUrl)).status).toBe(503);
      expect(server.store.pinnedPrivateStorageReads).toBe(0);
      await server.store.table("directArchiveCompletionActual").update({ where: { id: dispatch.observed.id }, data: {
        snapshot: { ...successorActual, generatedDispatchQualified: true }
      } });
      const read = await fetch(base + downloadUrl);
      expect({ status: read.status, bytes: Buffer.from(await read.arrayBuffer()) }).toEqual({ status: 200, bytes });
      expect(read.headers.get("x-cos-version-id")).toBeNull();
      expect(server.store.privateStorageReads).toBe(before);
      expect(server.store.pinnedPrivateStorageReads).toBe(1);
      const audit = await server.store.prisma.auditLog.count({ where: { action: "file.download", businessId: fileId } });
      expect(audit).toBe(1);

      await server.store.table("directArchiveGenerationProof").update({ where: { id: durable.id }, data: {
        snapshot: { ...proof, originals: [{ ...original, sizeBytes: bytes.length + 1 }] }
      } });
      expect((await fetch(base + downloadUrl)).status).toBe(503);
      expect(server.store.pinnedPrivateStorageReads).toBe(1);
      await server.store.table("directArchiveGenerationProof").update({ where: { id: durable.id }, data: { snapshot: proof } });
      await server.store.table("directArchiveGenerationCatalog").update({ where: { id: witness.id }, data: {
        snapshot: { ...catalog, transactionId: "500002" }
      } });
      expect((await fetch(base + downloadUrl)).status).toBe(503);
      expect(server.store.pinnedPrivateStorageReads).toBe(1);
      await server.store.table("directArchiveGenerationCatalog").update({ where: { id: witness.id }, data: { snapshot: catalog } });

      await server.store.table("syntheticPrivateFileVersion").delete({ where: { id: provider.id } });
      expect((await fetch(base + downloadUrl)).status).toBe(503);
      expect(server.store.pinnedPrivateStorageReads).toBe(2);
      expect(server.store.privateStorageReads).toBe(before);
      expect(await server.store.prisma.auditLog.count({ where: { action: "file.download", businessId: fileId } })).toBe(audit);

      await server.store.prisma.projectMember.deleteMany({ where: { projectId, userId: "staff" } });
      await server.store.prisma.userPosition.deleteMany({ where: { userId: "staff" } });
      expect((await fetch(base + downloadUrl)).status).toBe(403);
      expect(server.store.pinnedPrivateStorageReads).toBe(2);
      expect(server.store.privateStorageReads).toBe(before);
    } finally {
      await server.app.close();
    }
  });

  it("直签原请求只对同一意图查持久证据，证据缺失时保留原件和原标识", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const contractId = "12345678-1234-4abc-8def-1234567890a1";
      const versionId = "12345678-1234-4abc-8def-1234567890a2";
      const key = "12345678-1234-4abc-8def-1234567890a3";
      const fileIds = ["12345678-1234-4abc-8def-1234567890a4", "12345678-1234-4abc-8def-1234567890a5"];
      const projectId = randomUUID();
      const archiveId = "12345678-1234-4abc-8def-1234567890a6";
      const authoritySha256 = "a".repeat(64);
      const requestSha256 = "6c72b5c128d97b6673e05ae7162e20822d2c7b8419697d23a3bac0fc9d63e3d3";
      const result = { archiveId, contractVersionId: versionId, status: "effective", fileIds };
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-DIRECT-RECOVER", name: "合成原请求项目", isActive: true } });
      await server.store.prisma.projectMember.create({ data: { projectId, userId: "staff", positionKey: "contract_staff" } });
      await server.store.prisma.contract.create({ data: { id: contractId, projectId, name: "合成原请求合同", ownerUserId: "staff" } });
      await server.store.prisma.contractVersion.create({ data: {
        id: versionId, contractId, numericProtocolVersion: 2, versionNo: 1, changeType: "original",
        status: "effective", effectiveAt: new Date("2026-11-09T04:00:00Z"),
        draftData: { directSigningInput: { protocolVersion: 1, source: "direct_signed", relationship: "outside" } }
      } });
      // Deliberately incomplete persisted fixture. No real current migration can mint it.
      await server.store.prisma.contractArchiveFile.createMany({ data: [{
        id: archiveId, contractVersionId: versionId, archiveProtocolVersion: 2, archiveSource: "direct_signed",
        uploadedByUserId: "staff", idempotencyKey: key, sourceRevision: 3,
        requestSha256, authoritySha256, responseSnapshot: result
      }] });
      const url = `${await server.app.getUrl()}/contracts/${versionId}`;
      const token = await loginTemplateActor(server, "staff");
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const input = { archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: key,
        expectedDraftRevision: 3, expectedInputSha256: "d".repeat(64), fileIds, confirmedMatchingSignedDocument: true };
      const send = (patch = {}) => fetch(`${url}/signed-archive`, {
        method: "POST", headers, body: JSON.stringify({ ...input, ...patch })
      });
      const beforeAudit = await server.store.prisma.auditLog.count();
      const exact = await send();
      expect({ status: exact.status, body: await exact.json() }).toMatchObject({
        status: 503, body: { message: expect.stringContaining("持久结果") }
      });
      for (const patch of [{ expectedDraftRevision: 4 }, { expectedInputSha256: "e".repeat(64) }, { fileIds: [...fileIds].reverse() }]) {
        const changed = await send(patch);
        expect({ status: changed.status, body: await changed.json() }).toMatchObject({
          status: 409, body: { message: expect.stringContaining("归档标识已用于不同内容") }
        });
      }
      const newKey = await send({ idempotencyKey: randomUUID() });
      expect({ status: newKey.status, body: await newKey.json() }).toMatchObject({
        status: 409, body: { message: expect.stringContaining("已有归档记录") }
      });
      const original = await fetch(`${url}/archive-requests/${key}`, { headers });
      expect({ status: original.status, body: await original.json() }).toMatchObject({
        status: 503, body: { message: "直签归档持久结果尚未完整核对，请保留原标识" }
      });
      await seedDirectPendingDatabaseBinding(server);
      await seedDirectReviewDatabaseBinding(server);
      await seedPreparedDirectArchiveTransition(server);
      const lookup = () => fetch(`${url}/archive-requests/${key}`, { headers });
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(0);
      const routineCommon = {
        ownerOid: "9001", namespaceOid: "2200", configuration: ["search_path=pg_catalog, pg_temp"],
        securityDefiner: false, strict: true, returnsSet: false, kind: "f", executable: true, noPublicExecute: true, noGrantOption: true,
        currentRoleOid: "7001", sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001"
      };
      await server.store.table("directArchiveRecoveryRoutine").createMany({ data: [
        { snapshot: { ...routineCommon, name: "jg_contract_direct_archive_proof_v1", oid: "29708",
          sha256: "4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f",
          language: "plpgsql", volatility: "s", parallel: "u", returnTypeOid: "3802" } },
        { snapshot: { ...routineCommon, name: "jg_contract_direct_archive_request_sha_v1", oid: "29709",
          sha256: "f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf",
          language: "sql", volatility: "i", parallel: "s", returnTypeOid: "25" } }
      ] });
      await server.store.table("directArchiveRecoveryObservation").create({ data: { archiveId, proof: {
        proofProtocolVersion: 1, contractId, projectId, contractVersionId: versionId, archiveId, handlerUserId: "staff",
        idempotencyKey: key, requestSha256, authoritySha256, sourceRevision: 3, inputSha256: input.expectedInputSha256,
        fileIds: [...fileIds].reverse(), result
      } } });
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(0);
      const retention = await seedDirectArchiveRetentionCatalog(server);
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(1);
      await seedDirectArchiveDispatchCatalog(server);
      await observeDirectArchiveCompletionBody(server, retention);
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(1);
      const dispatch = await seedDirectArchiveCompletionCatalog(server);
      // The exact postimage can reach recovery, whose original file-order
      // check still rejects the reversed persisted proof.
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(2);
      await server.store.table("directArchiveCompletionActual").update({ where: { id: dispatch.observed.id }, data: {
        snapshot: { ...dispatch.actual, guardsClosed: false }
      } });
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(2);
      await server.store.table("directArchiveCompletionActual").update({ where: { id: dispatch.observed.id }, data: {
        snapshot: { ...dispatch.actual, transactionId: "500002" }
      } });
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(2);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(1);
      expect(await server.store.prisma.contractArchiveEvidenceFile.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count()).toBe(beforeAudit);
    } finally { await server.app.close(); }
  });

  it.each([[0, 0], [1, 1], [0, 1]] as const)("安装表示%s、当前表示%s时均接受同一精确触发器并创建固定direct来源", async (installedForm, actualForm) => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server, installedForm, undefined, actualForm);
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-DIRECT-QUALIFIED", name: "独立metadata协议合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 201, body: { terms: null, version: { originalSignedNumber: null, numericProtocolVersion: 2, signingSubjectType: "draft_unconfirmed", documentContentFingerprint: null, draftData: { directSigningInput: { protocolVersion: 1, source: "direct_signed", relationship: "outside", signedOn: null, enterpriseParty: null, counterpartyParty: null, fixedPaymentTermsVersionId: null } } } } });
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.contractGeneratedDocument.count()).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it.each([
    ["OLD行", (definition: string) => definition.replace('new."slotKey"', 'old."slotKey"')],
    ["错误槽", (definition: string) => definition.replace("direct_signed_originals_v1", "other_slot")],
  ] as const)("安装与实际目录一致但WHEN使用%s时仍拒绝创建", async (_label, replaceDefinition) => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server, 0, replaceDefinition);
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-DIRECT-QUALIFIED", name: "独立metadata协议合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect(response.status).toBe(503);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.contractGeneratedDocument.count()).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it.each(["shadow", "-"])("实际目录解析路径被schema %s抢在内置目录前时拒绝", async shadowSchema => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const observed = await server.store.table("directPendingDeparseEnvironment").findFirst();
      if (!observed || !observed.snapshot || typeof observed.snapshot !== "object" || Array.isArray(observed.snapshot)) throw new Error("独立解析环境fixture缺失");
      const environment = { ...observed.snapshot, searchSchemas: [shadowSchema, "pg_catalog", "public"] };
      await server.store.table("directPendingDeparseEnvironment").update({ where: { id: observed.id }, data: { snapshot: environment } });
      const current = await server.store.table("directPendingActualCatalog").findFirst();
      if (!current || !current.snapshot || typeof current.snapshot !== "object" || Array.isArray(current.snapshot)) throw new Error("当前目录fixture缺失");
      await server.store.table("directPendingActualCatalog").update({ where: { id: current.id }, data: { snapshot: { ...current.snapshot, deparseEnvironment: environment } } });
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-DIRECT-QUALIFIED", name: "独立metadata协议合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect(response.status).toBe(503);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.contractGeneratedDocument.count()).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("租约保存保留真实原号和日期，未完成资料无Q/D且不生成正文F，同key与no-op不增R", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-SAVE", name: "待登记保存合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const base = await server.app.getUrl();
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" };
      const createdResponse = await fetch(base+"/contracts", { method: "POST", headers, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect(createdResponse.status).toBe(201); const created = await createdResponse.json();
      const path = `/contract-drafts/${created.version.id}`;
      const leaseResponse = await fetch(base+path+"/edit-lease", { method: "POST", headers });
      expect(leaseResponse.status).toBe(201); const lease = await leaseResponse.json();
      const input = { idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: 1, changedSections: ["draft"],
        draft: { numericProtocolVersion: 2, originalSignedNumber: "  原 号-重复  ", manualAmountYuan: null, draftData: { ...created.version.draftData, contractName: "原件登记合同", directSigningInput: { ...created.version.draftData.directSigningInput, signedOn: "2026-11-08" } }, clauses: [], pricingNature: "unit_price", amountSource: "manual", taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
        parties: [], bills: [], paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
      const save = async (payload: unknown) => fetch(base+path, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(payload) });
      const response = await save(input); const saved = await response.json();
      expect({ status: response.status, saved }).toMatchObject({ status: 200, saved: { draftRevision: 2, documentContentFingerprint: null, directSigningInput: { state: "incomplete", Q: null, inputSha256: null } } });
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"); expect(saved.requestFingerprint).toBe(fingerprint);
      const replay = await save(input); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ draftRevision: 2, requestFingerprint: fingerprint });
      const noop = await save({ ...input, idempotencyKey: randomUUID(), expectedRevision: 2 }); expect(noop.status).toBe(200); expect((await noop.json()).draftRevision).toBe(2);
      const next = await save({ ...input, idempotencyKey: randomUUID(), expectedRevision: 2, draft: { ...input.draft, originalSignedNumber: "后次原号" } });
      expect(next.status).toBe(200);
      const result = await fetch(base+path+"/save-requests/"+input.idempotencyKey, { headers }); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ status: "saved", result: { draftRevision: 2, requestFingerprint: fingerprint, originalSignedNumber: "  原 号-重复  ", directSigningInput: { state: "incomplete", Q: null } } });
      const workbench = await fetch(base+path+"/workbench", { headers }); expect(workbench.status).toBe(200);
      expect(await workbench.json()).toMatchObject({ version: { originalSignedNumber: "后次原号", draftRevision: 3 } });
      const row = await server.store.prisma.contractVersion.findUnique({ where: { id: created.version.id } });
      expect(row).toMatchObject({ originalSignedNumber: "后次原号", draftRevision: 3, documentContentRevision: 1, documentContentFingerprint: null, draftData: { directSigningInput: { signedOn: "2026-11-08" } } });
      expect(await server.store.prisma.contractGeneratedDocument.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("受控双方与实际assignment及有序上传原件保存后，Q只取持久行且消费DB opaque摘要", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const enterpriseId = randomUUID(), counterpartyId = randomUUID(), enterpriseVersionId = randomUUID(), counterpartyVersionId = randomUUID(), assignmentId = randomUUID();
      for (const [id, versionId, name] of [[enterpriseId, enterpriseVersionId, "受控施工企业"], [counterpartyId, counterpartyVersionId, "受控供货单位"]]) {
        await server.store.prisma.businessParty.create({ data: { id, name, status: "active" } });
        await server.store.prisma.businessPartyVersion.create({ data: { id: versionId, businessPartyId: id, versionNo: 1, snapshot: { name, unifiedSocialCreditCode: "合成信用码" } } });
      }
      await server.store.prisma.projectAffiliateAssignment.create({ data: { id: assignmentId, projectId: draft.projectId, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId, affiliateNameSnapshot: "受控施工企业", affiliateCreditCodeSnapshot: "合成信用码", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null } });
      const form = new FormData(); form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "双方签章原件.png");
      const upload = await fetch(draft.base+draft.path+"/files", { method: "POST", headers: { authorization: draft.headers.authorization }, body: form }); expect(upload.status).toBe(201); const file = await upload.json();
      const secondForm = new FormData(); secondForm.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "第二张原件.png");
      const secondUpload = await fetch(draft.base+draft.path+"/files", { method: "POST", headers: { authorization: draft.headers.authorization }, body: secondForm }); expect(secondUpload.status).toBe(201); const secondFile = await secondUpload.json();
      const intent = { ...draft.input, draft: { ...draft.input.draft, originalSignedNumber: "重复原号", manualAmountYuan: "100.0054", draftData: { ...draft.input.draft.draftData, directSigningInput: { ...draft.created.version.draftData.directSigningInput, enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 } } } },
        parties: [{ roleKey: "party_a", displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: { name: "客户端不能替换受控名称" } }, { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: counterpartyVersionId, snapshot: {} }],
        attachments: [{ slotKey: "direct_signed_originals_v1", fileId: file.id, displayOrder: 0 }, { slotKey: "direct_signed_originals_v1", fileId: secondFile.id, displayOrder: 1 }] };
      const response = await draft.save(intent);
      const saved = await response.json(); expect({ status: response.status, saved }).toMatchObject({ status: 200, saved: { draftRevision: 2, documentContentFingerprint: null, directSigningInput: { state: "complete", sourceRevision: 2, inputSha256: "d".repeat(64), Q: { money: { amountYuan: "100.0054" }, contract: { originalSignedNumber: "重复原号" }, subjects: { enterprise: { assignmentId } }, signedFiles: [{ fileId: file.id, displayOrder: 0 }, { fileId: secondFile.id, displayOrder: 1 }] } } } });
      const reordered = { ...intent, idempotencyKey: randomUUID(), expectedRevision: 2, attachments: [{ slotKey: "direct_signed_originals_v1", fileId: secondFile.id, displayOrder: 0 }, { slotKey: "direct_signed_originals_v1", fileId: file.id, displayOrder: 1 }] };
      const reorderResponse = await draft.save(reordered); expect(reorderResponse.status).toBe(200); expect(await reorderResponse.json()).toMatchObject({ draftRevision: 3, directSigningInput: { Q: { signedFiles: [{ fileId: secondFile.id, displayOrder: 0 }, { fileId: file.id, displayOrder: 1 }] } } });
      const noChange = await draft.save({ ...reordered, idempotencyKey: randomUUID(), expectedRevision: 3 }); expect(noChange.status).toBe(200); expect((await noChange.json()).draftRevision).toBe(3);
      const version = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } }); expect(version).toMatchObject({ signingSubjectType: "affiliate", affiliateAssignmentId: assignmentId, affiliateBusinessPartyVersionId: enterpriseVersionId, companyEntityId: null });
      const options = await fetch(draft.base+"/contracts/settlement-create-options?projectId="+draft.projectId, { headers: draft.headers }); expect(options.status).toBe(200); expect(await options.json()).toEqual([]);
      const workbench = await fetch(draft.base+draft.path+"/workbench", { headers: draft.headers }); expect(workbench.status).toBe(200);
      expect(await workbench.json()).toMatchObject({ version: { originalSignedNumber: "重复原号", documentContentRevision: null, documentContentFingerprint: null }, directPendingInput: { state: "complete", inputSha256: "d".repeat(64) }, directPendingCapabilities: { registrationEnabled: false, copyEnabled: false, purgeEnabled: false } });
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const archiveRequest = { archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: randomUUID(),
        expectedDraftRevision: 3, expectedInputSha256: "d".repeat(64), fileIds: [secondFile.id, file.id],
        confirmedMatchingSignedDocument: true };
      const archivedBefore = await server.store.prisma.contractArchiveFile.count();
      const archivedAuditBefore = await server.store.prisma.auditLog.count();
      for (const [override, status] of [
        [{ expectedDraftRevision: 2 }, 409],
        [{ expectedInputSha256: "c".repeat(64) }, 409],
        [{ fileIds: [file.id, secondFile.id] }, 409],
        [{}, 503]
      ] as const) {
        const registration = await fetch(`${draft.base}/contracts/${version!.id}/signed-archive`, {
          method: "POST", headers: draft.headers, body: JSON.stringify({ ...archiveRequest, ...override })
        });
        expect({ override, status: registration.status, body: await registration.json() }).toMatchObject({ override, status });
      }
      const sendCurrentRegistration = async (patch = {}) => {
        const request = await fetch(`${draft.base}/contracts/${version!.id}/signed-archive`, {
          method: "POST", headers: draft.headers, body: JSON.stringify({ ...archiveRequest, ...patch })
        });
        return { status: request.status, body: await request.json() };
      };
      await server.store.prisma.project.update({ where: { id: draft.projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-11-01T00:00:00Z") } });
      expect(await sendCurrentRegistration()).toMatchObject({ status: 409, body: { message: expect.stringContaining("经营") } });
      await server.store.prisma.project.update({ where: { id: draft.projectId }, data: { operatingLedgerEffectiveDate: null } });
      await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignmentId }, data: { endedAt: new Date("2026-10-01T00:00:00Z") } });
      expect(await sendCurrentRegistration()).toMatchObject({ status: 409, body: { message: expect.stringContaining("施工企业") } });
      await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignmentId }, data: { endedAt: null } });
      const incompleteSuccessor = await server.store.table("directArchiveTransitionProbe").create({
        data: { snapshot: { relationOid: "29501", guardRoutineCount: 1 } }
      });
      await server.store.table("directArchiveTransitionProbe").update({ where: { id: incompleteSuccessor.id }, data: {
        snapshot: { relationOid: "29501", guardRoutineCount: 0 }
      } });
      const deparse = await server.store.table("directPendingDeparseEnvironment").findFirst();
      if (!deparse?.snapshot || typeof deparse.snapshot !== "object") throw new Error("合成解析环境缺失");
      await server.store.table("directPendingDeparseEnvironment").update({ where: { id: deparse.id }, data: {
        snapshot: { ...deparse.snapshot, searchSchemas: ["shadow", "pg_catalog", "public"] }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("已签合同来源资格") }
      });
      await server.store.table("directPendingDeparseEnvironment").update({ where: { id: deparse.id }, data: { snapshot: deparse.snapshot } });
      await server.store.table("directArchiveTransitionProbe").update({ where: { id: incompleteSuccessor.id }, data: {
        snapshot: { relationOid: "29501", guardRoutineCount: 1 }
      } });
      const mixed = await fetch(`${draft.base}/contracts/${version!.id}/signed-archive`, {
        method: "POST", headers: draft.headers, body: JSON.stringify({ ...archiveRequest, expectedInputSha256: "c".repeat(64) })
      });
      expect({ status: mixed.status, body: await mixed.json() })
        .toMatchObject({ status: 503, body: { message: expect.stringContaining("登记资格") } });
      await seedDirectReviewDatabaseBinding(server);
      const prepared = await seedPreparedDirectArchiveTransition(server, incompleteSuccessor.id);
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) }))
        .toMatchObject({ status: 409, body: { message: expect.stringContaining("原件顺序") } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: "正式登记暂不可办理，请保留原件和本次标识" }
      });
      const halfRetention = await server.store.table("directArchiveRetentionProbe").create({ data: {
        snapshot: { relationOid: "29701", routineCount: 3, triggerCount: 4 }
      } });
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("原件交接资格") }
      });
      await server.store.table("directArchiveRetentionProbe").delete({ where: { id: halfRetention.id } });
      const retention = await seedDirectArchiveRetentionCatalog(server);
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 409, body: { message: expect.stringContaining("原件顺序") }
      });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: "正式登记暂不可办理，请保留原件和本次标识" }
      });
      const halfDispatch = await server.store.table("directArchiveDispatchProbe").create({ data: {
        snapshot: { relationOid: "29801", slotTriggerCount: 1 }
      } });
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签归档接线资格") }
      });
      await server.store.table("directArchiveDispatchProbe").delete({ where: { id: halfDispatch.id } });
      const dispatch = await seedDirectArchiveDispatchCatalog(server);
      const preparedWriter = await server.store.table("directArchiveWriterProbe").create({ data: {
        snapshot: { routineCount: 2, parentGuardCount: 1, transitionGuardCount: 3 }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      const completion = await seedDirectArchiveCompletionCatalog(server);
      await observeDirectArchiveCompletionBody(server, retention);
      const beforeCompletionProbe = server.store.privateStorageReads;
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      expect(server.store.privateStorageReads).toBe(beforeCompletionProbe);
      const nativeIntent = await server.store.table("directArchiveNativeIntentCatalog").create({ data: {
        snapshot: { relationCount: 3, routineCount: 5, triggerCount: 6, privateSource: false }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记执行隔离") }
      });
      expect(server.store.privateStorageReads).toBe(beforeCompletionProbe);
      await server.store.table("directArchiveNativeIntentCatalog").update({ where: { id: nativeIntent.id }, data: {
        snapshot: { relationCount: 3, routineCount: 5, triggerCount: 5, privateSource: true }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记执行隔离") }
      });
      await server.store.table("directArchiveNativeIntentCatalog").update({ where: { id: nativeIntent.id }, data: {
        snapshot: { relationCount: 3, routineCount: 5, triggerCount: 6, privateSource: true }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      expect(server.store.privateStorageReads).toBe(beforeCompletionProbe);
      await server.store.table("directArchiveNativeIntentCatalog").delete({ where: { id: nativeIntent.id } });
      const otherContractId = randomUUID();
      await server.store.prisma.contract.create({ data: {
        id: otherContractId, projectId: draft.projectId, ownerUserId: "staff", name: "同一项目另一合同"
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 409, body: { message: expect.stringContaining("本项目另有合同或履约来源") }
      });
      expect(server.store.privateStorageReads).toBe(beforeCompletionProbe);
      await server.store.prisma.contract.update({ where: { id: otherContractId }, data: { voidedAt: new Date() } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      const affiliate = await server.store.table("projectAffiliateContractFact").create({ data: { projectId: draft.projectId } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 409, body: { message: expect.stringContaining("本项目另有合同或履约来源") }
      });
      await server.store.table("projectAffiliateContractFact").delete({ where: { id: affiliate.id } });
      const history = await server.store.table("contractEconomicReview").create({ data: {
        projectId: draft.projectId, status: "superseded", leftSourceRef: `contract:${draft.created.contract.id}`, rightSourceRef: "affiliate:historical"
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 409, body: { message: expect.stringContaining("本项目另有合同或履约来源") }
      });
      await server.store.table("contractEconomicReview").update({ where: { id: history.id }, data: {
        leftSourceRef: `contract:${otherContractId}`
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      const scope = await server.store.table("directArchiveSourceScopeObservation").create({ data: {
        snapshot: { completeReads: false }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记范围暂无法完整核对") }
      });
      await server.store.table("directArchiveSourceScopeObservation").update({ where: { id: scope.id }, data: {
        snapshot: { transactionId: "500002" }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记范围暂无法完整核对") }
      });
      await server.store.table("directArchiveSourceScopeObservation").delete({ where: { id: scope.id } });
      await server.store.table("contractEconomicReview").delete({ where: { id: history.id } });
      expect(server.store.privateStorageReads).toBe(beforeCompletionProbe);
      await server.store.table("directArchiveCompletionProbe").update({ where: { id: completion.probe.id }, data: {
        snapshot: { relationOid: "29901", routineCount: 1, triggerCount: 1 }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签归档完成接线资格") }
      });
      await server.store.table("directArchiveCompletionProbe").deleteMany();
      await server.store.table("directArchiveCompletionBinding").deleteMany();
      await server.store.table("directArchiveCompletionActual").deleteMany();
      await server.store.table("directArchiveRetentionActual").update({ where: { id: retention.observed.id }, data: {
        snapshot: retention.actual
      } });
      await server.store.table("directArchiveDispatchActual").update({ where: { id: dispatch.observation.id }, data: {
        snapshot: { ...dispatch.actual, legacySlotReads: false }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签归档接线资格") }
      });
      await server.store.table("directArchiveDispatchActual").update({ where: { id: dispatch.observation.id }, data: {
        snapshot: { ...dispatch.actual, helpersPrivate: false }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签归档接线资格") }
      });
      await server.store.table("directArchiveDispatchActual").update({ where: { id: dispatch.observation.id }, data: {
        snapshot: dispatch.actual
      } });
      const pendingWithDispatch = await server.store.table("directPendingActualCatalog").findFirst();
      if (!pendingWithDispatch) throw new Error("合成205现态缺失");
      const currentCatalog = pendingWithDispatch.snapshot as { routines: Record<string, Record<string, unknown>> };
      const directVersionGuard = "public.jg_contract_direct_pending_version_guard_v1()";
      await server.store.table("directPendingActualCatalog").update({ where: { id: dispatch.oldCatalogId }, data: {
        snapshot: { ...currentCatalog, routines: { ...currentCatalog.routines,
          [directVersionGuard]: { ...currentCatalog.routines[directVersionGuard], acl: ["unexpected-grant"] }
        } }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签归档接线资格") }
      });
      await server.store.table("directArchiveDispatchActual").deleteMany();
      await server.store.table("directArchiveDispatchBinding").deleteMany();
      await server.store.table("directArchiveDispatchProbe").deleteMany();
      await server.store.table("directPendingActualCatalog").update({ where: { id: dispatch.oldCatalogId }, data: {
        snapshot: dispatch.oldCatalogSnapshot
      } });
      await server.store.table("directArchiveWriterProbe").delete({ where: { id: preparedWriter.id } });
      const orphanWriter = await server.store.table("directArchiveWriterProbe").create({ data: {
        snapshot: { routineCount: 1 }
      } });
      const privateReadsBeforeWriter = server.store.privateStorageReads;
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      await server.store.table("directArchiveWriterProbe").update({ where: { id: orphanWriter.id }, data: {
        snapshot: { routineCount: 2 }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      await server.store.table("directArchiveWriterProbe").update({ where: { id: orphanWriter.id }, data: {
        snapshot: { routineCount: 0, parentGuardCount: 1 }
      } });
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      await server.store.table("directArchiveWriterProbe").update({ where: { id: orphanWriter.id }, data: {
        snapshot: { routineCount: 0, parentGuardCount: 0, transitionGuardCount: 1 }
      } });
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      await server.store.table("directArchiveWriterProbe").update({ where: { id: orphanWriter.id }, data: {
        snapshot: { routineCount: 2, parentGuardCount: 1, transitionGuardCount: 3 }
      } });
      expect(await sendCurrentRegistration()).toMatchObject({
        status: 503, body: { message: expect.stringContaining("直签登记写入资格") }
      });
      const unavailableWriterResult = await fetch(
        `${draft.base}/contracts/${version!.id}/archive-requests/${archiveRequest.idempotencyKey}`, { headers: draft.headers }
      );
      expect({ status: unavailableWriterResult.status, body: await unavailableWriterResult.json() })
        .toEqual({ status: 200, body: { status: "unknown" } });
      expect(server.store.privateStorageReads).toBe(privateReadsBeforeWriter);
      expect(await server.store.prisma.contractArchiveEvidenceFile.count()).toBe(0);
      await server.store.table("directArchiveWriterProbe").delete({ where: { id: orphanWriter.id } });
      const withoutFileRead = retention.actual.fileCallers.map(caller =>
        caller.roleOid === "9001" ? { ...caller, exactReads: false } : caller
      );
      await server.store.table("directArchiveRetentionActual").update({ where: { id: retention.observed.id }, data: {
        snapshot: { ...retention.actual, fileCallers: withoutFileRead }
      } });
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("原件交接资格") }
      });
      const wrongTriggers = { ...retention.actual.bindings.triggers,
        ContractArchiveEvidenceFile_direct_complete_v1: {
          ...retention.actual.bindings.triggers.ContractArchiveEvidenceFile_direct_complete_v1, initiallyDeferred: false
        } };
      const wrongBindings = { ...retention.binding.bindings, triggers: wrongTriggers };
      await server.store.table("directArchiveRetentionActual").update({ where: { id: retention.observed.id }, data: {
        snapshot: { ...retention.actual, bindings: wrongBindings }
      } });
      await server.store.table("directArchiveRetentionBinding").update({ where: { id: retention.installed.id }, data: {
        snapshot: { ...retention.binding, bindings: wrongBindings }
      } });
      expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) })).toMatchObject({
        status: 503, body: { message: expect.stringContaining("原件交接资格") }
      });
      await server.store.table("directArchiveRetentionActual").deleteMany();
      await server.store.table("directArchiveRetentionBinding").deleteMany();
      await server.store.table("directArchiveRetentionProbe").deleteMany();
      for (const change of [
        { pendingSha256: "e".repeat(64) },
        { reviewRelationOid: "29503" },
        { currentRoleOid: "7002" },
        { callerReadOnly: false },
        { guardBodySha256: "a".repeat(64) }
      ]) {
        await server.store.table("directArchiveTransitionActual").update({
          where: { id: prepared.observationId }, data: { snapshot: { ...prepared.observation, ...change } }
        });
        expect(await sendCurrentRegistration({ expectedInputSha256: "c".repeat(64) }))
          .toMatchObject({ status: 503, body: { message: expect.stringContaining("登记资格") } });
      }
      await server.store.table("directArchiveTransitionActual").deleteMany();
      await server.store.table("directArchiveTransitionBinding").deleteMany();
      await server.store.table("directArchiveTransitionProbe").delete({ where: { id: incompleteSuccessor.id } });
      const originalResult = await fetch(`${draft.base}/contracts/${version!.id}/archive-requests/${archiveRequest.idempotencyKey}`, { headers: draft.headers });
      expect(await originalResult.json()).toEqual({ status: "unknown" });
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(archivedBefore);
      expect(await server.store.prisma.auditLog.count()).toBe(archivedAuditBefore);
      expect(await server.store.prisma.contractDraftAttachment.findMany({ where: { contractVersionId: version!.id }, orderBy: { displayOrder: "asc" } }))
        .toMatchObject([{ fileId: secondFile.id, displayOrder: 0 }, { fileId: file.id, displayOrder: 1 }]);
      await server.app.get(FileService).discardUnlinkedGeneratedFile(file.id, "staff");
      expect(await server.store.prisma.fileObject.findUnique({ where: { id: file.id } })).toMatchObject({ storageStatus: "active" });
      expect(server.store.privateStorageDeletes).toBe(0);
      const abandon = await fetch(draft.base+"/contracts/"+draft.created.version.id+"/abandonment", { method: "POST", headers: draft.headers, body: JSON.stringify({ expectedRevision: 3, action: "abandon_application", reason: "暂存签章原件" }) }); expect(abandon.status).toBe(201); expect(await abandon.json()).toMatchObject({ status: "abandoned" });
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { contractVersionId: draft.created.version.id } })).toBe(2);
      const ended = await fetch(draft.base + "/contracts/" + draft.created.contract.id + "?versionId=" + draft.created.version.id, { headers: draft.headers });
      expect({ status: ended.status, body: await ended.json() }).toMatchObject({ status: 200, body: {
        id: draft.created.contract.id, contractVersionId: draft.created.version.id, historyReadOnly: true,
        baseInfo: expect.arrayContaining([{ label: "合同编号", value: "重复原号" }]),
        meta: expect.arrayContaining([
          { label: "当前状态", value: "已结束，保留资料", tone: "default" },
          { label: "下一步动作", value: "查看保留资料", tone: "default" }
        ]),
        effectivenessSteps: [{ label: "已签合同资料", status: "已结束，保留资料", tone: "default" }],
        lifecycleKind: "pristine_draft",
        contractLifecycleCapabilities: { canSubmit: false, canPhysicallyDelete: false, canAbandon: false, canDownload: false, historyRetention: "permanent" },
        settlementPayment: { summary: [], settlementRows: [], paymentRows: [] },
        availableActionKeys: [], primaryAction: null
      } });
      const endedLedger = await fetch(draft.base + "/contracts/lifecycle-ledger?view=ended", { headers: draft.headers });
      expect(endedLedger.status).toBe(200);
      expect((await endedLedger.json()).rows).toEqual(expect.arrayContaining([expect.objectContaining({
        contractId: draft.created.contract.id, contractVersionId: draft.created.version.id, contractNo: "重复原号", copyAvailable: false,
        currentNode: "已结束，保留资料", nextAction: "查看保留资料"
      })]));
      const current = await fetch(draft.base + "/contracts", { headers: draft.headers });
      expect(current.status).toBe(200);
      expect((await current.json()).rows).toEqual([]);
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "employee", positionKey: "employee" } });
      const employee = await loginTemplateActor(server, "employee");
      const historyPath = draft.base + "/contracts/" + draft.created.contract.id + "?versionId=" + draft.created.version.id;
      const summaryReader = await fetch(historyPath, { headers: { ...draft.headers, authorization: `Bearer ${employee}` } });
      expect(summaryReader.status).toBe(404);
      const terminal = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } });
      expect(terminal?.endedAt).toBeInstanceOf(Date);
      await server.store.prisma.contractVersion.update({ where: { id: draft.created.version.id }, data: { endedAt: null } });
      const conflictingTerminal = await fetch(historyPath, { headers: draft.headers });
      expect({ status: conflictingTerminal.status, body: await conflictingTerminal.json() }).toMatchObject({
        status: 409, body: { code: "CONTRACT_LIFECYCLE_INVARIANT_VIOLATION" }
      });
      const malformedEmployee = await fetch(historyPath, { headers: { ...draft.headers, authorization: `Bearer ${employee}` } });
      const defaultInvalid = await fetch(draft.base + "/contracts/" + draft.created.contract.id, { headers: draft.headers });
      expect(defaultInvalid.status).toBe(404);
      const other = await seedSelectionDraft(server);
      await server.store.prisma.contract.update({ where: { id: other.contractId }, data: { projectId: draft.projectId } });
      await server.store.prisma.contractVersion.update({ where: { id: other.versionId }, data: {
        status: "effective", effectiveAt: new Date("2026-11-08T00:00:00Z")
      } });
      const checks = [];
      for (const [path, headers] of [
        ["/contracts", draft.headers],
        ["/contracts/lifecycle-ledger?view=formal_ledger", draft.headers],
        ["/contracts/workbench?view=all", draft.headers],
        ["/contracts", { ...draft.headers, authorization: `Bearer ${employee}` }]
      ] as const) {
        const listed = await fetch(draft.base + path, { headers });
        const body = await listed.json() as { rows?: Array<{ contractId: string }> };
        checks.push({ status: listed.status, contractIds: body.rows?.map(row => row.contractId) });
      }
      expect({ employee: malformedEmployee.status, lists: checks }).toEqual({
        employee: 404, lists: Array.from({ length: 4 }, () => ({ status: 200, contractIds: [other.contractId] }))
      });
      await server.store.prisma.contractVersion.update({ where: { id: draft.created.version.id }, data: { endedAt: terminal?.endedAt } });
      const copied = await fetch(draft.base+"/contracts/"+draft.created.version.id+"/copies", { method: "POST", headers: draft.headers, body: JSON.stringify({ expectedUpdatedAt: new Date().toISOString() }) }); expect([409,410]).toContain(copied.status);
      const purge = await server.app.get(ContractEndedApplicationPurgeService).purgeEligibleApplications(new Date("2028-01-01T00:00:00.000Z"));
      expect(purge).toMatchObject({ scannedCount: 1, completedCount: 0, skippedCount: 1 });
      expect(await server.store.table("contractEndedApplicationPurgeReceipt").count()).toBe(0); expect(server.store.versionedStorageCalls).toBe(0);
      expect(await server.store.prisma.contractVersion.count({ where: { contractId: draft.created.contract.id } })).toBe(1);
      expect(await server.store.prisma.operatingFact.count()).toBe(0); expect(await server.store.prisma.approvalInstance.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("不同签约位置的两个受控版本属于同一单位时拒绝保存并回滚", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const contractId = draft.created.contract.id, contractVersionId = draft.created.version.id;
      const businessPartyId = randomUUID(), enterpriseVersionId = randomUUID(), counterpartyVersionId = randomUUID();
      await server.store.prisma.businessParty.create({ data: { id: businessPartyId, name: "同一实际单位", status: "active" } });
      for (const [versionId, versionNo, name] of [
        [enterpriseVersionId, 1, "单位档案原名"], [counterpartyVersionId, 2, "单位档案更新名"]
      ] as const) {
        await server.store.prisma.businessPartyVersion.create({ data: {
          id: versionId, businessPartyId, versionNo, snapshot: { name, unifiedSocialCreditCode: "合成单位标识" }
        } });
      }
      await server.store.prisma.projectAffiliateAssignment.create({ data: {
        projectId: draft.projectId, businessPartyId, businessPartyVersionId: enterpriseVersionId,
        affiliateNameSnapshot: "单位档案原名", affiliateCreditCodeSnapshot: "合成单位标识", effectiveFrom: new Date("2026-01-01T00:00:00Z"), endedAt: null
      } });
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "待绑定签章.png");
      const upload = await fetch(draft.base + draft.path + "/files", { method: "POST", headers: { authorization: draft.headers.authorization }, body: form });
      expect(upload.status).toBe(201);
      const file = await upload.json();
      const originalContract = await server.store.prisma.contract.findUnique({ where: { id: contractId } });
      const originalVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: contractVersionId } });
      const auditCount = await server.store.prisma.auditLog.count();
      const bindWrites = jest.spyOn(server.store.prisma.contractDraftAttachment, "createMany");

      const response = await draft.save({
        ...draft.input,
        draft: { ...draft.input.draft, originalSignedNumber: "本次不应保存的原号", draftData: {
          ...draft.input.draft.draftData,
          directSigningInput: { ...draft.created.version.draftData.directSigningInput,
            enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 } }
        } },
        parties: [
          { roleKey: "party_a", displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: { name: "客户端甲方" } },
          { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: counterpartyVersionId, snapshot: { name: "客户端乙方" } }
        ],
        paymentTerms: { originalText: "本次不应保存的付款原文", stages: [] },
        attachments: [{ slotKey: "direct_signed_originals_v1", fileId: file.id, displayOrder: 0 }]
      });
      expect({ status: response.status, body: await response.json() }).toMatchObject({
        status: 400, body: { message: "签约双方不能是同一单位，请重新选择" }
      });
      expect(await server.store.prisma.contract.findUnique({ where: { id: contractId } })).toEqual(originalContract);
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: contractVersionId } })).toEqual(originalVersion);
      expect(await server.store.prisma.contractPartySnapshot.count({ where: { contractVersionId } })).toBe(0);
      expect(await server.store.prisma.paymentTermsVersion.count({ where: { contractVersionId } })).toBe(0);
      expect(bindWrites).not.toHaveBeenCalled();
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { contractVersionId } })).toBe(0);
      expect(await server.store.prisma.contractDraftSaveRequest.count({ where: { contractVersionId } })).toBe(0);
      expect(await server.store.prisma.auditLog.count()).toBe(auditCount);
    } finally { await server.app.close(); }
  });
  it("已签direct纯净删除必须在首清理回执和状态写前拒绝", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const response = await fetch(draft.base+"/contracts/"+draft.created.version.id+"/abandonment", { method: "POST", headers: draft.headers, body: JSON.stringify({ expectedRevision: 1, action: "delete_pristine_draft" }) });
      expect(response.status).toBe(409);
      expect(server.store.versionedStorageCalls).toBe(0);
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } })).toMatchObject({ status: "draft" });
      expect(await server.store.table("contractPristineDraftDeletionReceipt").count()).toBe(0);
      expect(server.store.pristineReceiptWriteAttempts).toBe(0);
    } finally { await server.app.close(); }
  });
  it("未建条款的direct详情与列表用真实原号，内部身份仍C/V不使用重复原号", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const saved = await draft.save({ ...draft.input, draft: { ...draft.input.draft, originalSignedNumber: "纸面原号  " } }); expect(saved.status).toBe(200);
      const response = await fetch(draft.base+"/contracts/"+draft.created.contract.id+"?versionId="+draft.created.version.id, { headers: draft.headers });
      expect(response.status).toBe(200); const detail = await response.json();
      expect(detail).toMatchObject({
        id: draft.created.contract.id, contractVersionId: draft.created.version.id, title: "纸面原号   · 签章原件合同",
        baseInfo: expect.arrayContaining([{ label: "合同编号", value: "纸面原号  " }]),
        meta: expect.arrayContaining([
          { label: "当前状态", value: "已签合同资料待登记", tone: "default" },
          { label: "下一步动作", value: "登记功能尚未开放", tone: "default" }
        ]),
        effectivenessSteps: [
          { label: "已签合同资料", status: "待登记", tone: "default" },
          { label: "登记", status: "尚未开放", tone: "default" }
        ],
        contractLifecycleCapabilities: { canSubmit: false, canPhysicallyDelete: false },
        availableActionKeys: [], primaryAction: null
      });
      const list = await fetch(draft.base+"/contracts", { headers: draft.headers }); expect(list.status).toBe(200);
      expect((await list.json()).rows).toEqual(expect.arrayContaining([expect.objectContaining({
        contractId: draft.created.contract.id, contractVersionId: draft.created.version.id, contractNo: "纸面原号  ", copyAvailable: false,
        currentNode: "已签合同资料待登记", nextAction: "登记功能尚未开放"
      })]));
      const exported = await fetch(draft.base+"/contracts/ledger-export", { headers: draft.headers }); expect(exported.status).toBe(200);
      const workbook = new PizZip(Buffer.from(await exported.arrayBuffer()));
      const values = workbook.file("xl/sharedStrings.xml")?.asText();
      expect(values).toContain("纸面原号  ");
      expect(values).toContain("登记功能尚未开放");
      expect(values).not.toContain("提交合同审批");
    } finally { await server.app.close(); }
  });
  it.each([1, 2] as const)("生成型协议%s的详情和合同列表保留审批与用章进度", async protocol => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await seedSelectionDraft(server);
      if (protocol === 1) await server.store.prisma.contractVersion.update({ where: { id: draft.versionId }, data: { numericProtocolVersion: 1 } });
      await server.store.prisma.paymentTermsVersion.create({ data: { contractId: draft.contractId, contractVersionId: draft.versionId, versionNo: 1, originalText: "" } });
      const base = await server.app.getUrl(), token = await loginTemplateActor(server, "staff");
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (protocol === 2) headers["x-contract-numeric-protocol"] = "2";
      const response = await fetch(base + "/contracts/" + draft.contractId + "?versionId=" + draft.versionId, { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        contractVersionId: draft.versionId,
        meta: expect.arrayContaining([{ label: "下一步动作", value: "提交合同审批", tone: "default" }]),
        effectivenessSteps: expect.arrayContaining([
          expect.objectContaining({ label: "合同审批" }), expect.objectContaining({ label: "用章" }), expect.objectContaining({ label: "主管确认" })
        ])
      });
      const list = await fetch(base + "/contracts", { headers });
      expect(list.status).toBe(200);
      expect((await list.json()).rows).toEqual(expect.arrayContaining([expect.objectContaining({
        contractId: draft.contractId, contractVersionId: draft.versionId, currentNode: "提交合同审批", nextAction: "提交合同审批"
      })]));
    } finally { await server.app.close(); }
  });
  it("合同列表仅向有完整读取权的待登记行返回真实原号状态", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const sameAsEmptyLabel = "未注明编号";
      const saved = await draft.save({ ...draft.input, draft: { ...draft.input.draft, originalSignedNumber: sameAsEmptyLabel } });
      expect(saved.status).toBe(200);
      const created = await fetch(draft.base + "/contracts", { method: "POST", headers: draft.headers, body: JSON.stringify({
        projectId: draft.projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed"
      }) });
      expect(created.status).toBe(201);
      const empty = await created.json();
      const generated = await seedSelectionDraft(server);
      await server.store.prisma.contract.update({ where: { id: generated.contractId }, data: { projectId: draft.projectId, code: sameAsEmptyLabel } });
      await server.store.prisma.contractVersion.update({ where: { id: generated.versionId }, data: { status: "effective", effectiveAt: new Date("2026-11-08T00:00:00Z") } });
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "employee", positionKey: "employee" } });
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "director", positionKey: "contract_director" } });

      const list = async (headers: Record<string, string>) => {
        const response = await fetch(draft.base + "/contracts", { headers });
        expect(response.status).toBe(200);
        return (await response.json() as { rows: Array<Record<string, unknown>> }).rows;
      };
      const rowFor = (rows: Array<Record<string, unknown>>, contractId: string) => {
        const row = rows.find(value => value.contractId === contractId);
        expect(row).toBeDefined();
        return row;
      };
      const ownerRows = await list(draft.headers);
      expect(rowFor(ownerRows, draft.created.contract.id)).toMatchObject({
        contractVersionId: draft.created.version.id, contractNo: sameAsEmptyLabel,
        originalSignedNumber: sameAsEmptyLabel, originalSignedNumberState: "available"
      });
      expect(rowFor(ownerRows, empty.contract.id)).toMatchObject({
        contractVersionId: empty.version.id, contractNo: sameAsEmptyLabel,
        originalSignedNumber: null, originalSignedNumberState: "available"
      });
      const generatedRow = rowFor(ownerRows, generated.contractId);
      expect(generatedRow).toMatchObject({ contractVersionId: generated.versionId, contractNo: sameAsEmptyLabel });
      expect(generatedRow).not.toHaveProperty("originalSignedNumber");
      expect(generatedRow).not.toHaveProperty("originalSignedNumberState");

      const directorRows = await list({ ...draft.headers, authorization: `Bearer ${await loginTemplateActor(server, "director")}` });
      expect(rowFor(directorRows, draft.created.contract.id)).toMatchObject({
        contractVersionId: draft.created.version.id, originalSignedNumber: sameAsEmptyLabel, originalSignedNumberState: "available"
      });
      const summary = await list({ ...draft.headers, authorization: `Bearer ${await loginTemplateActor(server, "employee")}` });
      expect(summary.map(row => row.contractId)).toEqual([generated.contractId]);
      const summaryRow = rowFor(summary, generated.contractId);
      expect(summaryRow).toMatchObject({ visibility: "summary", contractNo: sameAsEmptyLabel });
      for (const key of ["contractVersionId", "originalSignedNumber", "originalSignedNumberState"]) expect(summaryRow).not.toHaveProperty(key);

      // Synthetic persistence returns an invalid stored value at the existing raw-read boundary.
      await server.store.prisma.contractVersion.update({ where: { id: empty.version.id }, data: { originalSignedNumber: "" } });
      expect(rowFor(await list(draft.headers), empty.contract.id)).toMatchObject({
        contractVersionId: empty.version.id, contractNo: "原合同编号待核对",
        originalSignedNumber: null, originalSignedNumberState: "unavailable"
      });
    } finally { await server.app.close(); }
  });
  it.each(["lifecycle-ledger", "workbench"] as const)("旧%s列表保留直签展示编号，不返回原号状态", async endpoint => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const saved = await draft.save({ ...draft.input, draft: { ...draft.input.draft, originalSignedNumber: "纸面原号  " } });
      expect(saved.status).toBe(200);
      const response = await fetch(draft.base + `/contracts/${endpoint}?view=my_drafts`, { headers: draft.headers });
      expect(response.status).toBe(200);
      const { rows } = await response.json() as { rows: Array<Record<string, unknown>> };
      const row = rows.find(value => value.contractId === draft.created.contract.id);
      expect(row).toMatchObject({ contractVersionId: draft.created.version.id, contractNo: "纸面原号  ", copyAvailable: false });
      expect(row).not.toHaveProperty("originalSignedNumber");
      expect(row).not.toHaveProperty("originalSignedNumberState");
    } finally { await server.app.close(); }
  });
  it.each(["2026-02-30", "0000-01-01", "2026-11-08T00:00:00.000Z"])("无效签订日%s写前拒绝且不冒默认今天", async signedOn => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const response = await draft.save({ ...draft.input, draft: { ...draft.input.draft, draftData: { ...draft.input.draft.draftData, directSigningInput: { ...draft.created.version.draftData.directSigningInput, signedOn } } } });
      expect(response.status).toBe(400); expect(await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } })).toMatchObject({ draftRevision: 1 }); expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("保存最终await资格漂移回滚原号、修订、条款与回执，GET只能报告unknown", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const base = await server.store.table("directPendingActualCatalog").findFirst();
      if (!base || !base.snapshot || typeof base.snapshot !== "object" || Array.isArray(base.snapshot)) throw new Error("目录fixture缺失");
      for (let order=1;order<=7;order++) await server.store.table("directPendingActualCatalog").create({ data: { observationOrder: order, snapshot: { ...base.snapshot, ...(order===7 ? { noBindingWrite: false } : {}) } } });
      const response = await draft.save({ ...draft.input, draft: { ...draft.input.draft, originalSignedNumber: "不应落盘" }, paymentTerms: { originalText: "不应落盘的原文", stages: [] } }); expect(response.status).toBe(503);
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } })).toMatchObject({ draftRevision: 1 });
      expect(await server.store.prisma.paymentTermsVersion.count()).toBe(0); expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.save" } })).toBe(0);
      const receipt = await fetch(draft.base+draft.path+"/save-requests/"+draft.input.idempotencyKey, { headers: draft.headers }); expect(await receipt.json()).toEqual({ status: "unknown" });
    } finally { await server.app.close(); }
  });
  it.each(["other_slot", "queued", "replacement"])("原件%s占用或不可用状态不落槽、不增R", async mode => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server), fileId = randomUUID();
      await server.store.prisma.fileObject.create({ data: { id: fileId, mimeType: "image/png", sizeBytes: 20, contentSha256: "a".repeat(64), storageStatus: mode === "queued" ? "queued" : "active", uploadedByUserId: "staff", purgeReceiptId: null, supersedesFileObjectId: mode === "replacement" ? randomUUID() : null } });
      if (mode === "other_slot") await server.store.prisma.contractDraftAttachment.create({ data: { contractVersionId: draft.created.version.id, slotKey: "other_original_position", fileId, displayOrder: 0, createdByUserId: "staff" } });
      const response = await draft.save({ ...draft.input, attachments: [{ slotKey: "direct_signed_originals_v1", fileId, displayOrder: 0 }] }); expect([400,409]).toContain(response.status);
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { contractVersionId: draft.created.version.id, slotKey: "direct_signed_originals_v1" } })).toBe(0); expect(await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } })).toMatchObject({ draftRevision: 1 }); expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("直接草稿切换五类内业务类型只增一次R，税率等值重存与真实0金额不误判变化", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const payload = { ...draft.input, draft: { ...draft.input.draft, manualAmountYuan: "0", draftData: { ...draft.input.draft.draftData, contractBasics: { ...draft.created.version.draftData.contractBasics, businessType: "other" } }, taxFacts: { invoiceType: "vat_general", taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" } } };
      const first = await draft.save(payload); expect(first.status).toBe(200); expect((await first.json()).draftRevision).toBe(2);
      const noop = await draft.save({ ...payload, idempotencyKey: randomUUID(), expectedRevision: 2 }); expect(noop.status).toBe(200); expect((await noop.json()).draftRevision).toBe(2);
      expect(await server.store.prisma.contract.findUnique({ where: { id: draft.created.contract.id } })).toMatchObject({ contractTypeKey: "other" });
      const version = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } }); expect(String(version?.amountYuan)).toBe("0"); expect(String(version?.defaultTaxRatePercent)).toBe("13");
    } finally { await server.app.close(); }
  });
  it.each(["readiness", "authorizations", "counterparty", "confirmation"])("真实旧签前%s入口拒绝direct且不写检查/授权/预览与denial审计", async operation => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      let path = `/contracts/${draft.created.version.id}/${operation}`, payload: unknown = {};
      if (operation === "authorizations") payload = { side: "counterparty", expectedRevision: 1, required: false };
      if (operation === "confirmation") { path = `/contracts/${draft.created.version.id}/formal-files/counterparty/confirmation`; payload = { formalFileId: randomUUID(), expectedDraftRevision: 1 }; }
      if (operation === "counterparty") {
        const form = new FormData(); form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "原始签章.png");
        const upload = await fetch(draft.base+draft.path+"/files", { method: "POST", headers: { authorization: draft.headers.authorization }, body: form }); expect(upload.status).toBe(201);
        payload = { sourceRevision: 1, fileIds: [(await upload.json()).id] }; path = `/contracts/${draft.created.version.id}/formal-files/counterparty`;
      }
      const beforeFiles = await server.store.prisma.fileObject.count(), beforeStorage = server.store.privateStorageWrites, beforeReads = server.store.privateStorageReads, beforeAudit = await server.store.prisma.auditLog.count();
      const response = await fetch(draft.base+path, { method: "POST", headers: draft.headers, body: JSON.stringify(payload) });
      expect({ status: response.status, files: await server.store.prisma.fileObject.count(), writes: server.store.privateStorageWrites, reads: server.store.privateStorageReads, audits: await server.store.prisma.auditLog.count() }).toEqual({ status: 409, files: beforeFiles, writes: beforeStorage, reads: beforeReads, audits: beforeAudit });
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } })).toMatchObject({ draftRevision: 1, readinessSnapshot: null });
      expect(await server.store.prisma.contractVersionAuthorizationLink.count()).toBe(0); expect(await server.store.prisma.contractFormalFile.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("历史保存回执不冒当前资格；失去binding后工作台无Q/D，原键GET仍只读原回执", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const saved = await draft.save(draft.input); expect(saved.status).toBe(200);
      await server.store.table("directPendingInstalledBinding").deleteMany();
      const before = await server.store.prisma.auditLog.count();
      const workbench = await fetch(draft.base+draft.path+"/workbench", { headers: draft.headers }); expect(workbench.status).toBe(200); expect(await workbench.json()).toMatchObject({ directPendingInput: { state: "unavailable", Q: null, inputSha256: null }, directPendingCapabilities: { registrationEnabled: false, copyEnabled: false, purgeEnabled: false } });
      const receipt = await fetch(draft.base+draft.path+"/save-requests/"+draft.input.idempotencyKey, { headers: draft.headers }); expect(receipt.status).toBe(200); expect(await receipt.json()).toMatchObject({ status: "saved", result: { draftRevision: 2, requestFingerprint: createHash("sha256").update(JSON.stringify(draft.input)).digest("hex") } });
      const repeat = await draft.save(draft.input); expect(repeat.status).toBe(503); expect(await server.store.prisma.auditLog.count()).toBe(before); expect(await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } })).toMatchObject({ draftRevision: 2 });
    } finally { await server.app.close(); }
  });
  it("numeric1新建与已有generated通过旧PUT注入direct来源均零写拒绝", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const legacyCreate = await fetch(draft.base+"/contracts", { method: "POST", headers: draft.headers, body: JSON.stringify({ projectId: draft.projectId, numericProtocolVersion: 1, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) }); expect(legacyCreate.status).toBe(400); expect(await server.store.prisma.contract.count()).toBe(1);
      const generated = await seedSelectionDraft(server);
      const lease = await fetch(`${draft.base}/contract-drafts/${generated.versionId}/edit-lease`, { method: "POST", headers: draft.headers }); expect(lease.status).toBe(201); const token = (await lease.json()).token;
      const response = await fetch(`${draft.base}/contract-drafts/${generated.versionId}`, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": token }, body: JSON.stringify(draft.input) }); expect(response.status).toBe(400);
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: generated.versionId } })).toMatchObject({ draftRevision: 1, documentContentFingerprint: "a".repeat(64), draftData: {} }); expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it.each(["delete", "submit"] as const)("同项目有办理权的非经办人%s先获授权拒绝，经办人后获来源拒绝", async operation => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server), versionId = draft.created.version.id;
      for (const userId of ["staff", "employee"]) await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId, positionKey: "contract_staff" } });
      const otherToken = await loginTemplateActor(server, "employee");
      const path = operation === "delete" ? draft.path : draft.path + "/submission";
      const body = operation === "delete" ? { expectedRevision: 1 } : {
        expectedRevision: 1, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: 1,
        documentContentFingerprint: "a".repeat(64), generatedDocumentId: randomUUID(), sourceSha256: "b".repeat(64), blanksReviewed: true
      };
      const send = (authorization: string) => fetch(draft.base + path, {
        method: operation === "delete" ? "DELETE" : "POST",
        headers: { ...draft.headers, authorization, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(body)
      });
      const beforeAudit = await server.store.prisma.auditLog.count();
      const denied = await send(`Bearer ${otherToken}`);
      expect({ status: denied.status, body: await denied.json() }).toMatchObject({ status: 403, body: { message: operation === "delete"
        ? "只有当前合同经办人或合同部主管可以删除纯净草稿" : "只有当前合同经办人可以提交审批" } });
      const owner = await send(draft.headers.authorization);
      expect({ status: owner.status, body: await owner.json() }).toMatchObject({ status: 409, body: { message: expect.stringContaining("已签") } });
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } })).toMatchObject({ status: "draft", draftRevision: 1 });
      expect(await server.store.prisma.contractDraftSubmissionRequest.count()).toBe(0);
      expect(await server.store.table("contractPristineDraftDeletionReceipt").count()).toBe(0);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count()).toBe(beforeAudit);
      expect(server.store.pristineReceiptWriteAttempts).toBe(0);
      expect(server.store.versionedStorageCalls).toBe(0);
    } finally { await server.app.close(); }
  });
  it.each(["settlement-mode/confirm", "type-change"] as const)("旧%s拒绝待登记草稿且不尝试事务写入", async operation => {
    const server = await createTemplateTestServer({ draftWorkbench: true, legacyWorkbenchReads: true });
    try {
      const draft = await openDirectPendingDraft(server), versionId = draft.created.version.id;
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "director", positionKey: "contract_director" } });
      const template = await server.store.prisma.contractBusinessTemplate.create({ data: { contractTypeKey: "other", name: "旧模板切换验证" } });
      const target = await server.store.prisma.contractBusinessTemplateVersion.create({ data: {
        templateId: template.id, status: "published", fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: []
      } });
      const authorization = operation === "type-change" ? draft.headers.authorization : `Bearer ${await loginTemplateActor(server, "director")}`;
      const versionWrites = jest.spyOn(server.store.prisma.contractVersion, "updateMany");
      const snapshotWrites = jest.spyOn(server.store.prisma.businessEntrySubmissionSnapshot, "create");
      const beforeAudit = await server.store.prisma.auditLog.count();
      const response = await fetch(draft.base + `/contract-workbench/${versionId}/${operation}`, {
        method: "POST", headers: { ...draft.headers, authorization }, body: JSON.stringify(operation === "type-change"
          ? { targetBusinessTemplateVersionId: target.id, confirmed: true, expectedRevision: 1 }
          : { settlementMode: "settlement_required", expectedRevision: 1 })
      });
      expect({ status: response.status, body: await response.json(), versionWrites: versionWrites.mock.calls.length, snapshotWrites: snapshotWrites.mock.calls.length })
        .toMatchObject({ status: 409, body: { message: expect.stringContaining("已签") }, versionWrites: 0, snapshotWrites: 0 });
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } })).toMatchObject({ status: "draft", draftRevision: 1, settlementMode: "none" });
      expect(await server.store.prisma.businessEntrySubmissionSnapshot.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count()).toBe(beforeAudit);
    } finally { await server.app.close(); }
  });
  it("主管经办人的工作台只为非直签草稿保留旧结算确认能力", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const generated = await seedSelectionDraft(server), legacy = await seedSelectionDraft(server);
      for (const draft of [generated, legacy]) {
        await server.store.prisma.contract.update({ where: { id: draft.contractId }, data: { ownerUserId: "director" } });
        await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "director", positionKey: "contract_director" } });
      }
      await server.store.prisma.contractVersion.update({ where: { id: legacy.versionId }, data: { numericProtocolVersion: 1 } });
      const base = await server.app.getUrl(), token = await loginTemplateActor(server, "director");
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const v2Headers = { ...headers, "x-contract-numeric-protocol": "2" };
      const creation = await fetch(base + "/contracts", { method: "POST", headers: v2Headers, body: JSON.stringify({
        projectId: generated.projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed"
      }) });
      const direct = await creation.json();
      expect({ status: creation.status, direct }).toMatchObject({ status: 201, direct: { contract: { ownerUserId: "director" } } });
      for (const [id, requestHeaders, canConfirm] of [
        [generated.versionId, v2Headers, true], [legacy.versionId, headers, true], [direct.version.id, v2Headers, false]
      ] as const) {
        const response = await fetch(base + `/contract-drafts/${id}/workbench`, { headers: requestHeaders });
        expect({ status: response.status, body: await response.json() }).toMatchObject({
          status: 200, body: { settlementMode: { canConfirm, confirmationRequired: true, confirmedAt: null } }
        });
      }
    } finally { await server.app.close(); }
  });
  it("旧履约发现按实际所选版本排除待登记稿，保留生成型、V1与挂靠文书", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true, economicReviewReads: true });
    try {
      const draft = await openDirectPendingDraft(server);
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const generated = await seedSelectionDraft(server), legacy = await seedSelectionDraft(server);
      for (const [index, id] of [generated.contractId, legacy.contractId, draft.created.contract.id].entries()) {
        await server.store.prisma.contract.update({ where: { id }, data: { projectId: draft.projectId, counterparty: `相对方${index}` } });
      }
      await server.store.prisma.contractVersion.update({ where: { id: legacy.versionId }, data: { numericProtocolVersion: 1, amountLimitType: "capped", amountCents: 125n } });
      const ledgerId = randomUUID();
      await server.store.prisma.projectAffiliateContractFact.create({ data: { projectId: draft.projectId, ledgerId, entryKind: "original", status: "confirmed", externalContractReference: "挂靠原合同", counterpartyName: "外部相对方", amountCents: 120n, documentVersion: 1 } });
      const response = await fetch(draft.base + "/contract-economic-reviews?projectId=" + draft.projectId, { headers: draft.headers });
      const result = await response.json();
      expect({ status: response.status, refs: result.documents?.map((row: { ref: string }) => row.ref).sort(), body: response.ok ? undefined : result }).toEqual({
        status: 200, refs: [`contract:${generated.contractId}`, `contract:${legacy.contractId}`, `affiliate:${ledgerId}`].sort(), body: undefined
      });
      expect(JSON.stringify(result)).not.toContain(draft.created.version.id);
      expect(await server.store.prisma.contractEconomicReview.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("完整直签待登记资料用实际来源坐标发起履约复核", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true, economicReviewReads: true });
    try {
      const draft = await openDirectPendingDraft(server);
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const enterpriseId = randomUUID(), enterpriseVersionId = randomUUID();
      const counterpartyId = randomUUID(), counterpartyVersionId = randomUUID();
      for (const [id, versionId, name] of [
        [enterpriseId, enterpriseVersionId, "实际施工企业"],
        [counterpartyId, counterpartyVersionId, "实际签约相对方"]
      ]) {
        await server.store.prisma.businessParty.create({ data: { id, name, status: "active" } });
        await server.store.prisma.businessPartyVersion.create({ data: { id: versionId, businessPartyId: id, versionNo: 1, snapshot: { name, unifiedSocialCreditCode: "合成信用码" } } });
      }
      await server.store.prisma.projectAffiliateAssignment.create({ data: {
        id: randomUUID(), projectId: draft.projectId, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId,
        affiliateNameSnapshot: "实际施工企业", affiliateCreditCodeSnapshot: "合成信用码", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null
      } });
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "已签原件.png");
      const upload = await fetch(draft.base + draft.path + "/files", { method: "POST", headers: { authorization: draft.headers.authorization }, body: form });
      expect(upload.status).toBe(201);
      const { id: fileId } = await upload.json() as { id: string };
      const saved = await draft.save({ ...draft.input, draft: {
        ...draft.input.draft, originalSignedNumber: "实际直签号", manualAmountYuan: "100.0054",
        draftData: { ...draft.input.draft.draftData, directSigningInput: { ...draft.created.version.draftData.directSigningInput,
          enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 }
        } }
      }, parties: [
        { roleKey: "party_a", displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: {} },
        { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: counterpartyVersionId, snapshot: {} }
      ], attachments: [{ slotKey: "direct_signed_originals_v1", fileId, displayOrder: 0 }] });
      const source = (await saved.json()).directSigningInput;
      expect({ status: saved.status, source }).toMatchObject({ status: 200, source: {
        state: "complete", sourceRevision: 2, inputSha256: "d".repeat(64), Q: { signedFiles: [{ fileId, displayOrder: 0 }] }
      } });
      const generated = await seedSelectionDraft(server);
      await server.store.prisma.contract.update({ where: { id: generated.contractId }, data: { projectId: draft.projectId, counterparty: "系统生成文书相对方" } });
      await server.store.prisma.contractVersion.update({where:{id:generated.versionId},data:{amountYuan:"80.0000"}});
      const leftSourceRef = `contract:${draft.created.contract.id}`, rightSourceRef = `contract:${generated.contractId}`;
      const legacyReads = await fetch(draft.base + "/contract-economic-reviews?projectId=" + draft.projectId, { headers: draft.headers });
      expect({ status: legacyReads.status, body: await legacyReads.json() }).toMatchObject({ status: 200, body: { documents: expect.arrayContaining([expect.objectContaining({ ref: rightSourceRef, version: `${generated.versionId}:1` })]) } });
      const prepareInput={projectId:draft.projectId,leftSourceRef,rightSourceRef,relation:"independent",coverage:[],
        reason:"核对相近范围后确认分别履约",idempotencyKey:randomUUID(),confirmationPassword:server.password,
        expectedDirectSources:[{sourceRef:leftSourceRef,contractVersionId:draft.created.version.id,sourceRevision:source.sourceRevision,inputSha256:source.inputSha256}]};
      const prepare=(input:object=prepareInput) => fetch(draft.base+"/contract-economic-reviews",{method:"POST",headers:draft.headers,body:JSON.stringify(input)});
      expect((await prepare()).status).toBe(503);
      expect(await server.store.prisma.contractEconomicReview.count()).toBe(0);
      await seedDirectReviewDatabaseBinding(server);
      const catalog=await server.store.table("directReviewActualCatalog").findFirst();
      if (!catalog?.snapshot||typeof catalog.snapshot!=="object") throw new Error("合成206目录前置缺失");
      for (const changed of [{triggerCount:13},{noPublicRoutineExecute:false},{currentRoleOid:"7002"},{writes:false}]) {
        await server.store.table("directReviewActualCatalog").update({where:{id:catalog.id},data:{snapshot:{...catalog.snapshot,...changed}}});
        expect((await prepare()).status).toBe(503);
      }
      await server.store.table("directReviewActualCatalog").update({where:{id:catalog.id},data:{snapshot:catalog.snapshot}});
      const mixed=await prepare({...prepareInput,relation:"shared_evidence",coverage:[{
        scope:"混合分项",leftAmountYuan:"1.0001",rightAmountYuan:"1.0001",owner:"right"
      }]});
      expect({status:mixed.status,body:await mixed.json()}).toMatchObject({status:409,body:{message:expect.stringContaining("混合来源")}});
      for (const patch of [{inputSha256:"e".repeat(64)},{sourceRevision:1},{contractVersionId:generated.versionId}]) {
        expect((await prepare({...prepareInput,expectedDirectSources:[{...prepareInput.expectedDirectSources[0],...patch}]})).status).toBe(409);
      }
      expect(await server.store.prisma.contractEconomicReview.count()).toBe(0);
      const response = await prepare();
      const pending = await response.json();
      expect({ status: response.status, body: pending }).toMatchObject({
        status: 201, body: { status: "pending_review", revision: 1, preparedByUserId: "staff", financeRequired: false }
      });
      const decisionPath = draft.base + "/contract-economic-reviews/" + pending.id + "/decision";
      const decisionBody = { revision: 1, decision: "confirm", confirmationPassword: server.password };
      const self = await fetch(decisionPath, { method: "POST", headers: draft.headers, body: JSON.stringify(decisionBody) });
      expect(self.status).toBe(403);
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "director", positionKey: "contract_director" } });
      const director = await loginTemplateActor(server, "director");
      const directorHeaders = { ...draft.headers, authorization: `Bearer ${director}` };
      const decide = () => fetch(decisionPath, { method: "POST", headers: directorHeaders, body: JSON.stringify(decisionBody) });
      const noSignature = await decide();
      expect({ status: noSignature.status, body: await noSignature.json() }).toMatchObject({status:400,body:{message:expect.stringContaining("手写签名")}});
      expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(0);
      expect(await server.store.prisma.contractEconomicReview.findUnique({where:{id:pending.id}})).toMatchObject({status:"pending_review",revision:1});
      const signatureBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
      const signature = await server.files.uploadPrivateFile({originalName:"合成主管签字.png",mimeType:"image/png",sizeBytes:signatureBytes.length,buffer:signatureBytes,uploadedByUserId:"director"});
      await server.store.prisma.handwrittenSignatureVersion.create({data:{userId:"director",source:"canvas",fileId:signature.id,contentSha256:createHash("sha256").update(signatureBytes).digest("hex")}});
      await server.store.table("directReviewInputDigestObservation").create({data:{
        versionId:draft.created.version.id,sourceRevision:2,originalSignedNumber:"同修订持久事实漂移",inputSha256:"c".repeat(64)
      }});
      await server.store.table("contractVersion").update({where:{id:draft.created.version.id},data:{originalSignedNumber:"同修订持久事实漂移"}});
      expect((await decide()).status).toBe(409);
      expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(0);
      expect(await server.store.prisma.contractEconomicReview.findUnique({where:{id:pending.id}})).toMatchObject({status:"pending_review",revision:1});
      await server.store.table("contractVersion").update({where:{id:draft.created.version.id},data:{originalSignedNumber:"实际直签号"}});
      for (const changes of [
        {formal:true,excludedDeltaYuan:"0.0100",operatingBaseline:{originalOperatingFactId:"合成正式依据"}},
        {excludedDeltaCents:"1"},
        {operatingBaseline:{originalOperatingFactId:"合成正式依据"}},
        {coverageNumericProtocolVersion:1}
      ]) {
        await server.store.table("directReviewSyntheticTerminalDrift").create({data:{reviewId:pending.id,changes}});
        expect((await decide()).status).toBe(500);
        expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(0);
        expect(await server.store.prisma.contractEconomicReview.findUnique({where:{id:pending.id}})).toMatchObject({status:"pending_review",revision:1});
        await server.store.table("directReviewSyntheticTerminalDrift").deleteMany({where:{reviewId:pending.id}});
      }
      for (const stage of ["file_row", "terminal_key"] as const) {
        await server.store.table("directReviewSyntheticLockFailure").create({data:{stage,sqlState:"55P03"}});
        const locked=await decide();
        expect({status:locked.status,body:await locked.json()}).toMatchObject({status:409,body:{message:expect.stringContaining("稍后重试")}});
        expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(0);
        expect(await server.store.prisma.contractEconomicReview.findUnique({where:{id:pending.id}})).toMatchObject({status:"pending_review",revision:1});
        await server.store.table("directReviewSyntheticLockFailure").deleteMany({where:{stage}});
      }
      await server.store.table("directReviewSyntheticLockFailure").create({data:{stage:"terminal_key",sqlState:"23514"}});
      expect((await decide()).status).toBe(500);
      expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(0);
      await server.store.table("directReviewSyntheticLockFailure").deleteMany();
      server.store.directReviewCommitOutcome="return_without_persisting";
      const unknown=await decide();
      expect({status:unknown.status,body:await unknown.json()}).toMatchObject({status:503,body:{message:expect.stringContaining("办理结果")}});
      expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(0);
      expect(await server.store.prisma.contractEconomicReview.findUnique({where:{id:pending.id}})).toMatchObject({status:"pending_review",revision:1});
      server.store.directReviewCommitOutcome="persist";
      const confirmed = await decide();
      expect({ status: confirmed.status, body: await confirmed.json() }).toMatchObject({
        status: 201, body: { status: "confirmed", revision: 2, contractReviewedById: "director" }
      });
      expect(await server.store.table("contractEconomicReviewFileReference").findMany()).toMatchObject([
        { reviewId: pending.id, sourceRef: leftSourceRef, fileId, sourceRevision: 2, inputSha256: "d".repeat(64), displayOrder: 0 }
      ]);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
      const repeat = await decide();
      expect(repeat.status).toBe(409);
      expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(1);

      const secondCreate=await fetch(draft.base+"/contracts",{method:"POST",headers:draft.headers,
        body:JSON.stringify({projectId:draft.projectId,numericProtocolVersion:2,contractTypeKey:"material_purchase",relationship:"outside",handlingMode:"direct_signed"})});
      expect(secondCreate.status).toBe(201);
      const second=await secondCreate.json();
      const secondPath=draft.base+"/contract-drafts/"+second.version.id;
      const secondLease=await fetch(secondPath+"/edit-lease",{method:"POST",headers:draft.headers});
      expect(secondLease.status).toBe(201);
      const secondForm=new FormData();
      secondForm.append("file",form.get("file") as File,"另一份签章原件.png");
      const secondUpload=await fetch(secondPath+"/files",{method:"POST",headers:{authorization:draft.headers.authorization},body:secondForm});
      expect(secondUpload.status).toBe(201);
      const {id:secondFileId}=await secondUpload.json() as {id:string};
      const secondSaved=await fetch(secondPath,{method:"PUT",headers:{...draft.headers,"x-contract-draft-lease":(await secondLease.json()).token},
        body:JSON.stringify({...draft.input,idempotencyKey:randomUUID(),draft:{...draft.input.draft,originalSignedNumber:null,manualAmountYuan:null,
          draftData:{...draft.input.draft.draftData,contractName:"另一份待登记文书",
            directSigningInput:{...second.version.draftData.directSigningInput,enterpriseParty:{roleKey:"party_a",displayOrder:0},counterpartyParty:{roleKey:"party_b",displayOrder:0}}}},
          parties:[{roleKey:"party_a",displayOrder:0,businessPartyVersionId:enterpriseVersionId,snapshot:{}},
            {roleKey:"party_b",displayOrder:0,businessPartyVersionId:counterpartyVersionId,snapshot:{}}],
          attachments:[{slotKey:"direct_signed_originals_v1",fileId:secondFileId,displayOrder:0}]})});
      const secondSource=(await secondSaved.json()).directSigningInput;
      expect({status:secondSaved.status,body:secondSource}).toMatchObject({status:200,body:{state:"complete",sourceRevision:2,Q:{money:{amountYuan:null}}}});
      const secondRef=`contract:${second.contract.id}`;
      const paired=await prepare({...prepareInput,rightSourceRef:secondRef,idempotencyKey:randomUUID(),relation:"shared_evidence",
        coverage:[{scope:"直签重叠分项",leftAmountYuan:"1.0001",rightAmountYuan:"0.0001",owner:"right"}],
        expectedDirectSources:[...prepareInput.expectedDirectSources,{sourceRef:secondRef,contractVersionId:second.version.id,
          sourceRevision:secondSource.sourceRevision,inputSha256:secondSource.inputSha256}]});
      const pairedBody=await paired.json();
      expect({status:paired.status,body:pairedBody}).toMatchObject({status:201,body:{status:"pending_review",financeRequired:false,
        coverage:[expect.objectContaining({numericProtocolVersion:2})]}});
      const composite = await seedPreparedDirectArchiveTransition(server);
      const retention = await seedDirectArchiveRetentionCatalog(server);
      await addDirectArchiveRetentionToReviewCatalog(server, retention.fileTrigger);
      const requestKey = randomUUID();
      const register = () => fetch(`${draft.base}/contracts/${draft.created.version.id}/signed-archive`, {
        method: "POST", headers: draft.headers, body: JSON.stringify({
          archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: requestKey,
          expectedDraftRevision: source.sourceRevision, expectedInputSha256: source.inputSha256,
          fileIds: [fileId], confirmedMatchingSignedDocument: true
        })
      });
      const waitingForReview = await register();
      expect({ status: waitingForReview.status, body: await waitingForReview.json() })
        .toMatchObject({ status: 409, body: { message: expect.stringContaining("先完成履约复核") } });
      const pairedDecision=await fetch(draft.base+"/contract-economic-reviews/"+pairedBody.id+"/decision",
        {method:"POST",headers:directorHeaders,body:JSON.stringify(decisionBody)});
      expect({status:pairedDecision.status,body:await pairedDecision.json()}).toMatchObject({status:201,body:{status:"confirmed"}});
      const pairedRefs=await server.store.table("contractEconomicReviewFileReference").findMany({where:{reviewId:pairedBody.id}});
      expect(pairedRefs).toEqual(expect.arrayContaining([expect.objectContaining({fileId,sourceRef:leftSourceRef}),
        expect.objectContaining({fileId:secondFileId,sourceRef:secondRef})]));
      expect(await server.store.table("contractEconomicReviewFileReference").count()).toBe(3);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);

      const installedTransition = await server.store.table("directArchiveTransitionBinding").findFirst();
      if (!installedTransition?.snapshot || typeof installedTransition.snapshot !== "object") throw new Error("合成207绑定缺失");
      const wrongReviewRelation = "29504";
      await server.store.table("directArchiveTransitionBinding").update({ where: { id: installedTransition.id }, data: {
        snapshot: { ...installedTransition.snapshot, reviewRelationOid: wrongReviewRelation }
      } });
      await server.store.table("directArchiveTransitionActual").update({ where: { id: composite.observationId }, data: {
        snapshot: { ...composite.observation, reviewRelationOid: wrongReviewRelation }
      } });
      const mismatchedReview = await register();
      expect({ status: mismatchedReview.status, body: await mismatchedReview.json() })
        .toMatchObject({ status: 503, body: { message: expect.stringContaining("复核") } });
      await server.store.table("directArchiveTransitionBinding").update({ where: { id: installedTransition.id }, data: { snapshot: installedTransition.snapshot } });
      await server.store.table("directArchiveTransitionActual").update({ where: { id: composite.observationId }, data: { snapshot: composite.observation } });
      await addDirectArchiveRetentionToReviewCatalog(server, { ...retention.fileTrigger, oid: "29799" });
      const alteredRetention = await register();
      expect({ status: alteredRetention.status, body: await alteredRetention.json() })
        .toMatchObject({ status: 503, body: { message: expect.stringContaining("复核") } });
      await addDirectArchiveRetentionToReviewCatalog(server, retention.fileTrigger);
      const nonzeroReview = await register();
      expect({ status: nonzeroReview.status, body: await nonzeroReview.json() })
        .toMatchObject({ status: 409, body: { message: expect.stringContaining("非零") } });
      const archiveResult = await fetch(`${draft.base}/contracts/${draft.created.version.id}/archive-requests/${requestKey}`, { headers: draft.headers });
      expect({ status: archiveResult.status, body: await archiveResult.json() }).toEqual({ status: 200, body: { status: "unknown" } });
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { fileId } })).toBe(1);

      await seedDirectArchiveDispatchCatalog(server);
      await server.store.table("directArchiveWriterProbe").create({ data: {
        snapshot: { routineCount: 2, parentGuardCount: 1, transitionGuardCount: 3 }
      } });
      const newer = await draft.save({ ...draft.input, idempotencyKey: randomUUID(), expectedRevision: 2, draft: {
        ...draft.input.draft, originalSignedNumber: "随后修改原号", manualAmountYuan: "100.0054",
        draftData: { ...draft.input.draft.draftData, directSigningInput: { ...draft.created.version.draftData.directSigningInput,
          enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 }
        } }
      }, parties: [
        { roleKey: "party_a", displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: {} },
        { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: counterpartyVersionId, snapshot: {} }
      ], attachments: [] });
      expect(newer.status).toBe(200);
      expect(await server.store.prisma.contractDraftAttachment.count({where:{fileId}})).toBe(0);
      const abandonment=await fetch(draft.base+"/contracts/"+draft.created.version.id+"/abandonment",{method:"POST",headers:draft.headers,
        body:JSON.stringify({expectedRevision:3,action:"abandon_application",reason:"已结束待登记草稿，保留复核依据"})});
      expect(abandonment.status).toBe(201);
      const history = await fetch(draft.base + "/contract-economic-reviews?projectId=" + draft.projectId, { headers: directorHeaders });
      const historyBody=await history.json();
      expect({status:history.status,body:historyBody}).toMatchObject({status:200,body:{reviews:expect.arrayContaining([expect.objectContaining({
        id:pending.id,status:"confirmed",directEvidence:[expect.objectContaining({sourceRef:leftSourceRef,contractVersionId:draft.created.version.id,
          sourceRevision:2,originalSignedNumber:"实际直签号",
          files:[expect.objectContaining({fileId,displayOrder:0,mimeType:"image/png"})]})]
      })])}});
      expect(JSON.stringify(historyBody)).not.toMatch(/contactPhone|directInput|directSourcePins|objectKey|随后修改原号/);
      const capability=await fetch(draft.base+"/files/"+fileId+"/download-ticket-capability",{headers:directorHeaders});
      expect({status:capability.status,body:await capability.json()}).toMatchObject({status:200,body:{action:{enabled:true}}});
      const ticket=await fetch(draft.base+"/files/"+fileId+"/download-ticket",{method:"POST",headers:directorHeaders,
        body:JSON.stringify({confirmationPassword:server.password,downloadReason:"查阅复核时签章原件"})});
      const ticketBody=await ticket.json();
      expect({status:ticket.status,body:ticketBody}).toMatchObject({status:201,body:{fileId,fileName:"签章原件.png"}});
      const bytes=await fetch(draft.base+ticketBody.downloadUrl);
      expect(bytes.status).toBe(200);
      expect(Buffer.from(await bytes.arrayBuffer()).toString("base64")).toBe("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=");
      const expired=new URL(draft.base+ticketBody.downloadUrl);
      expired.searchParams.set("expiresAt","2000-01-01T00:00:00.000Z");
      expect((await fetch(expired)).status).toBe(400);
      const employee=await loginTemplateActor(server,"employee");
      expect((await fetch(draft.base+"/files/"+fileId+"/download-ticket-capability",{headers:{...draft.headers,authorization:`Bearer ${employee}`}})).status).toBe(403);
      expect((await fetch(draft.base+"/contract-economic-reviews?projectId="+draft.projectId,{headers:{...draft.headers,authorization:`Bearer ${employee}`}})).status).toBe(403);
      await server.store.prisma.projectMember.deleteMany({where:{projectId:draft.projectId,userId:"staff"}});
      await server.store.prisma.userPosition.deleteMany({where:{userId:"staff"}});
      expect((await fetch(draft.base+"/files/"+fileId+"/download-ticket-capability",{headers:draft.headers})).status).toBe(403);
      const writesBefore=server.store.privateStorageDeletes;
      await server.app.get(FileService).discardUnlinkedGeneratedFile(fileId,"staff");
      expect(server.store.privateStorageDeletes).toBe(writesBefore);
      expect(await server.store.prisma.fileObject.findUnique({where:{id:fileId}})).toMatchObject({storageStatus:"active"});
    } finally { await server.app.close(); }
  });
  it.each(["none", "fixed", "other_version"] as const)("工作台付款按持久固定ID区分 %s，不读取其他条款", async mode => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server), { id: versionId, contractId } = draft.created.version;
      if (mode !== "none") {
        await server.store.prisma.paymentTermsVersion.create({ data: { contractId, contractVersionId: versionId, originalText: "同版本其他条款" } });
        const term = await server.store.prisma.paymentTermsVersion.create({ data: {
          contractId, contractVersionId: mode === "fixed" ? versionId : randomUUID(), originalText: ""
        } });
        await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: { draftData: {
          ...draft.created.version.draftData,
          directSigningInput: { ...draft.created.version.draftData.directSigningInput, fixedPaymentTermsVersionId: term.id }
        } } });
      }
      const response = await fetch(draft.base + draft.path + "/workbench", { headers: draft.headers });
      const body = await response.json();
      if (mode === "other_version") expect({ status: response.status, body }).toMatchObject({ status: 409, body: { message: expect.stringContaining("付款约定") } });
      else expect({ status: response.status, body }).toMatchObject({ status: 200, body: { paymentTerms: mode === "none" ? null : { originalText: "", stages: [] } } });
    } finally { await server.app.close(); }
  });
  it("direct不能进入审批文书生成、正式提交或生成型归档，旧退役入口仍410", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server), v = draft.created.version.id;
      await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
      const posts: Array<[string,unknown,number]> = [
        [draft.path+"/preview-generation", { sourceRevision: 1 },409],
        [`/contract-workbench/${v}/documents`, { layoutTemplateVersionId: randomUUID(), purpose: "draft" },409],
        [draft.path+"/submission", { expectedRevision: 1, idempotencyKey: randomUUID(), submissionProtocolVersion: 2, documentContentRevision: 1, documentContentFingerprint: "a".repeat(64), generatedDocumentId: randomUUID(), sourceSha256: "b".repeat(64), blanksReviewed: true },409],
        [`/contracts/${v}/signed-archive`, { expectedApprovalInstanceId: randomUUID(), expectedSealTaskId: randomUUID(), documentContentRevision: 1, documentContentFingerprint: "a".repeat(64), archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: randomUUID(), fileIds: [randomUUID()], confirmedMatchingSignedDocument: true },409],
        [`/contracts/${v}/copies`, { expectedUpdatedAt: new Date().toISOString() },410]
      ];
      const beforeAudit = await server.store.prisma.auditLog.count(), beforeFiles = await server.store.prisma.fileObject.count();
      for (const [path,payload,status] of posts) { const response = await fetch(draft.base+path, { method: "POST", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(payload) }); expect({path,status:response.status,body:await response.json()}).toMatchObject({path,status}); }
      expect(await server.store.prisma.auditLog.count()).toBe(beforeAudit); expect(await server.store.prisma.fileObject.count()).toBe(beforeFiles);
      expect(await server.store.prisma.contractGeneratedDocument.count()).toBe(0); expect(await server.store.prisma.contractArchiveFile.count()).toBe(0); expect(await server.store.prisma.contractDraftSubmissionRequest.count()).toBe(0); expect(await server.store.prisma.approvalInstance.count()).toBe(0); expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally { await server.app.close(); }
  });
  it("保存空付款文本创建真实固定条款，null后续清原文但保同一条款身份", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      const response = await draft.save({ ...draft.input, paymentTerms: { originalText: "", stages: [] } });
      const saved = await response.json(); expect({ status: response.status, saved }).toMatchObject({ status: 200, saved: { draftRevision: 2 } });
      const terms = await server.store.prisma.paymentTermsVersion.findMany({ where: { contractVersionId: draft.created.version.id } });
      expect(terms).toHaveLength(1); expect(terms[0].originalText).toBe("");
      const version = await server.store.prisma.contractVersion.findUnique({ where: { id: draft.created.version.id } });
      expect(version?.draftData).toMatchObject({ directSigningInput: { fixedPaymentTermsVersionId: terms[0].id } });
      const after = await draft.save({ ...draft.input, expectedRevision: 2, idempotencyKey: randomUUID(), draft: { ...draft.input.draft, draftData: version?.draftData }, paymentTerms: { originalText: "  实际约定  ", stages: [] } }); expect(after.status).toBe(200);
      const third = await draft.save({ ...draft.input, expectedRevision: 3, idempotencyKey: randomUUID(), draft: { ...draft.input.draft, draftData: version?.draftData }, paymentTerms: null }); expect(third.status).toBe(200);
      const final = await server.store.prisma.paymentTermsVersion.findMany({ where: { contractVersionId: draft.created.version.id } }); expect(final).toHaveLength(1); expect(final[0]).toMatchObject({ id: terms[0].id, originalText: "" });
    } finally { await server.app.close(); }
  });
  it("付款原文空白不trim且固定真实同版本条款ID，不把空白当未填写", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-TEXT", name: "付款原文合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "other", relationship: "outside", handlingMode: "direct_signed", paymentTermsOriginalText: "  " }) });
      const body = await response.json();
      expect(response.status).toBe(201);
      expect(body.terms.originalText).toBe("  ");
      expect(body.version.draftData.directSigningInput.fixedPaymentTermsVersionId).toBe(body.terms.id);
      const persisted = await server.store.prisma.contractVersion.findUnique({ where: { id: body.version.id } });
      expect(persisted?.draftData).toMatchObject({ directSigningInput: { fixedPaymentTermsVersionId: body.terms.id } });
    } finally { await server.app.close(); }
  });
  it.each(["routineExecutable", "triggerDefinitionReadable"] as const)("最后业务await后%s资格漂移回滚整次创建", async flag => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const base = await server.store.table("directPendingActualCatalog").findFirst();
      if (!base || !base.snapshot || typeof base.snapshot !== "object" || Array.isArray(base.snapshot)) throw new Error("独立目录fixture缺失");
      for (let order = 1; order <= 3; order++) await server.store.table("directPendingActualCatalog").create({ data: { observationOrder: order, snapshot: { ...base.snapshot, ...(order === 3 ? { [flag]: false } : {}) } } });
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-LAST-AWAIT", name: "提交前目录漂移合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect(response.status).toBe(503);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);
    } finally { await server.app.close(); }
  });
  it.each(["triggerDefinitionReadable", "schemaUsage", "rlsAbsent", "attachmentFileLockable", "routineExecutable", "noBindingWrite"])("完整binding存在但当前%s资格撤销时零业务写入", async field => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const current = await server.store.table("directPendingActualCatalog").findFirst();
      if (!current || !current.snapshot || typeof current.snapshot !== "object" || Array.isArray(current.snapshot)) throw new Error("独立目录fixture缺失");
      await server.store.table("directPendingActualCatalog").update({ where: { id: current.id }, data: { snapshot: { ...current.snapshot, [field]: false } } });
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-DENIED", name: "当前资格撤销合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect(response.status).toBe(503);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.paymentTermsVersion.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);
    } finally { await server.app.close(); }
  });
  it("已存在的direct稿缺binding时在私有存储和文件登记前拒绝上传", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await seedSelectionDraft(server);
      await server.store.prisma.contractVersion.update({ where: { id: draft.versionId }, data: { signingSubjectType: "draft_unconfirmed", draftData: { contractName: "已签材料合同", contractBasics: { relationship: "outside", businessType: "material_purchase" }, directSigningInput: { protocolVersion: 1, source: "direct_signed", relationship: "outside", signedOn: null, enterpriseParty: null, counterpartyParty: null, fixedPaymentTermsVersionId: null } } } });
      const token = await loginTemplateActor(server, "staff");
      const beforeFiles = await server.store.prisma.fileObject.count();
      const beforeStorage = server.store.privateStorageWrites;
      const form = new FormData();
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64");
      form.append("file", new Blob([png], { type: "image/png" }), "合成双方签章照片.png");
      const response = await fetch(`${await server.app.getUrl()}/contract-drafts/${draft.versionId}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("来源资格") } });
      expect(server.store.privateStorageWrites).toBe(beforeStorage);
      expect(await server.store.prisma.fileObject.count()).toBe(beforeFiles);
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { contractVersionId: draft.versionId } })).toBe(0);
    } finally { await server.app.close(); }
  });
  it("未安装独立可信binding时写前拒绝，不创建合同、版本、条款或后继事实", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const projectId = randomUUID();
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-DIRECT", name: "表外已签合同合成项目", isActive: true } });
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" }, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 503, body: { message: expect.stringContaining("来源资格") } });
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.paymentTermsVersion.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally { await server.app.close(); }
  });
});
