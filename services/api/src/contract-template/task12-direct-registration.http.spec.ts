import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { nativeDirectArchiveExecutor } from "../contract/contract-direct-archive-executor";
import { createTemplateTestServer, type TemplateSyntheticStore } from "./template-management.test-support";
import { openDirectPendingDraft, seedPreparedDirectArchiveTransition } from "./task12-direct-pending.test-support";
import { seedDirectArchiveDispatchCatalog } from "./task12-direct-archive-dispatch.oracle";
import { observeDirectArchiveCompletionBody, seedDirectArchiveCompletionCatalog, seedDirectArchiveRetentionCatalog } from "./task12-direct-archive-retention.oracle";
import { seedDirectReviewDatabaseBinding } from "./task12-direct-review-persistence.oracle";

describe("表外已签合同的正式登记", () => {
  it("登记两份有序原件后可按原标识查回，且重放没有重复生效或审批", async () => {
    const invocations = { issued: 0, executed: 0 };
    const nonce = randomUUID();
    const server = await createTemplateTestServer({ draftWorkbench: true, directArchiveExecutor: (store, storage) => {
      const intentId = randomUUID();
      let issuedCoordinates: readonly unknown[] | undefined;
      return nativeDirectArchiveExecutor(storage, client(async query => {
        expect(query.sql).toContain("jg_issue_contract_direct_archive_intent_v1");
        invocations.issued++;
        expect(query.values[0]).toBe(nonce);
        issuedCoordinates = query.values.slice(1);
        return [{ intentId }];
      }), client(async query => {
        expect(query.sql).toContain("jg_execute_contract_direct_archive_outside_v1");
        expect(query.values).toEqual([nonce, intentId, ...issuedCoordinates!]);
        invocations.executed++;
        await store.prisma.$transaction(async () => persistSyntheticRegistration(store, query.values.slice(2)));
        // The separate database session committed but its first response was lost.
        throw new Error("合成执行连接在提交后丢失响应");
      }));
    } });
    try {
      const draft = await openDirectPendingDraft(server);
      const { projectId, created: { contract, version }, base, path, headers } = draft;
      const businessParties = [];
      for (const name of ["施工企业", "下游单位"]) {
        const id = randomUUID(), versionId = randomUUID();
        const snapshot = { name, unifiedSocialCreditCode: randomUUID() };
        await server.store.prisma.businessParty.create({ data: { id, name, status: "active" } });
        await server.store.prisma.businessPartyVersion.create({ data: { id: versionId, businessPartyId: id, versionNo: 1, snapshot } });
        businessParties.push({ id, versionId, snapshot });
      }
      const [enterprise, downstream] = businessParties;
      await server.store.prisma.projectAffiliateAssignment.create({ data: {
        id: randomUUID(), projectId, businessPartyId: enterprise.id, businessPartyVersionId: enterprise.versionId,
        affiliateNameSnapshot: enterprise.snapshot.name, affiliateCreditCodeSnapshot: enterprise.snapshot.unifiedSocialCreditCode,
        effectiveFrom: new Date("2026-01-01T10:45:12.345Z"), endedAt: null
      } });
      const originals: string[] = [];
      const originalBytes: Buffer[] = [];
      for (const height of [200, 240]) {
        const document = await PDFDocument.create();
        document.addPage([120, height]);
        const form = new FormData();
        const bytes = Buffer.from(await document.save());
        originalBytes.push(bytes);
        form.append("file", new Blob([bytes], { type: "application/pdf" }), `签章原件-${height}.pdf`);
        const upload = await fetch(base + path + "/files", { method: "POST", headers: { authorization: headers.authorization }, body: form });
        expect(upload.status).toBe(201);
        const { id } = await upload.json();
        originals.push(id);
        const file = await server.store.prisma.fileObject.findUniqueOrThrow({ where: { id } });
        await server.store.table("syntheticPrivateFileVersion").create({ data: {
          bucket: file.bucket, objectKey: file.objectKey, objectGeneration: `sealed-${height}`, base64: bytes.toString("base64")
        } });
      }
      const saved = await draft.save({ ...draft.input, draft: {
        ...draft.input.draft, originalSignedNumber: "合同原号-01", manualAmountYuan: "100.0054",
        draftData: { ...draft.input.draft.draftData, directSigningInput: {
          ...version.draftData.directSigningInput, signedOn: "2026-01-02",
          enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 }
        } }
      }, parties: [
        { roleKey: "party_a", displayOrder: 0, businessPartyVersionId: enterprise.versionId, snapshot: {} },
        { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: downstream.versionId, snapshot: {} }
      ], attachments: originals.map((fileId, displayOrder) => ({ slotKey: "direct_signed_originals_v1", fileId, displayOrder })) });
      const input = (await saved.json()).directSigningInput;
      expect({ status: saved.status, input }).toMatchObject({ status: 200, input: { state: "complete", sourceRevision: 2 } });
      await server.store.prisma.projectMember.create({ data: { projectId, userId: "staff", positionKey: "contract_staff" } });
      await seedDirectReviewDatabaseBinding(server);
      await seedPreparedDirectArchiveTransition(server);
      const retention = await seedDirectArchiveRetentionCatalog(server);
      const dispatch = await seedDirectArchiveDispatchCatalog(server);
      const completion = await seedDirectArchiveCompletionCatalog(server);
      await observeDirectArchiveCompletionBody(server, retention);
      await server.store.table("directArchiveWriterProbe").create({ data: { snapshot: {
        routineCount: 2, parentGuardCount: 1, transitionGuardCount: 3
      } } });
      const key = randomUUID();
      const request = {
        archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: key,
        expectedDraftRevision: input.sourceRevision, expectedInputSha256: input.inputSha256, fileIds: originals,
        confirmedMatchingSignedDocument: true
      };
      const send = (overrides = {}) => fetch(`${base}/contracts/${version.id}/signed-archive`, {
        method: "POST", headers, body: JSON.stringify({ ...request, ...overrides })
      });
      const lookup = () => fetch(`${base}/contracts/${version.id}/archive-requests/${key}`, { headers });
      const before = await lookup();
      expect({ status: before.status, body: await before.json() }).toEqual({ status: 200, body: { status: "unknown" } });
      expect((await send()).status).toBe(503);
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      await server.store.table("directArchiveNativeAdmission").create({ data: { snapshot: {
        completionOid: "29901", executorOwnerOid: "9912", ownerOid: "9001", namespaceOid: "2200", databaseOid: "13000",
        currentRoleOid: "7001", sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001", intentBindingSha256: "a".repeat(64), nonce
      } } });
      const liveHelpers: Record<string, string> = {
        "public.jg_assert_contract_direct_archive_write_profile_v1()": "b418f8e2de1ae5b4607a898d8de4ca96c1e3b987c2ffbd8a8701018e76c56349",
        'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")': "1e9d6404ecd618617aa74dc85fc656be334f1b0d8219d7e814361866f6e4b903",
        "public.jg_require_contract_direct_archive_transition_profile_v1()": "c34dead07d5837558a41e68350b21b8b2d5818f60e21eef23c43c59f68bbb23a",
        'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")':
          "c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157"
      };
      const helpers = Object.fromEntries(Object.entries(dispatch.actual.helpers).map(([signature, raw]) =>
        [signature, liveHelpers[signature] ? { ...raw as object, bodySha256: liveHelpers[signature],
          proacl: ["owner-X", "executor-X"] } : raw]));
      await server.store.table("directArchiveDispatchActual").update({ where: { id: dispatch.observation.id },
        data: { snapshot: { ...dispatch.actual, helpers, helpersPrivate: false } } });
      await server.store.table("directArchiveCompletionActual").update({ where: { id: completion.observed.id },
        data: { snapshot: { ...completion.actual, guardsClosed: false } } });
      const lastVersion = await server.store.table("syntheticPrivateFileVersion").findFirst({ where: { objectGeneration: "sealed-240" } });
      if (!lastVersion) throw new Error("合成存储固定版本缺失");
      await server.store.table("syntheticPrivateFileVersion").delete({ where: { id: lastVersion.id } });
      expect((await send()).status).toBe(503);
      expect(await (await lookup()).json()).toEqual({ status: "unknown" });
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      await server.store.table("syntheticPrivateFileVersion").create({ data: lastVersion });
      const registered = await send();
      const result = await registered.json();
      expect({ status: registered.status, result }).toMatchObject({
        status: 201, result: { archiveId: expect.any(String), contractVersionId: version.id, status: "effective", fileIds: originals }
      });
      expect(await (await lookup()).json()).toMatchObject({ status: "archived", result });
      const generations = await server.store.table("directArchiveGenerationProof").findFirst();
      if (!generations) throw new Error("合成固定原件证明缺失");
      await server.store.table("directArchiveGenerationProof").delete({ where: { id: generations.id } });
      expect((await lookup()).status).toBe(503);
      await server.store.table("directArchiveGenerationProof").create({ data: generations });
      expect(await (await send()).json()).toEqual(result);
      expect((await send({ fileIds: [...originals].reverse() })).status).toBe(409);
      const ticket = await fetch(`${base}/files/${originals[1]}/download-ticket`, {
        method: "POST", headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对直签原件" })
      });
      expect(ticket.status).toBe(201);
      const { downloadUrl } = await ticket.json();
      const download = await fetch(base + downloadUrl);
      expect({ status: download.status, bytes: Buffer.from(await download.arrayBuffer()) })
        .toEqual({ status: 200, bytes: originalBytes[1] });
      expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: version.id } })).toBe(1);
      expect(await server.store.prisma.approvalInstance.count({ where: { businessId: version.id } })).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { businessId: version.id, action: "contract.archive.complete" } })).toBe(1);
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { contractVersionId: version.id } })).toBe(0);
      expect(await server.store.prisma.operatingFact.count({ where: { projectId } })).toBe(0);
      expect(invocations).toEqual({ issued: 1, executed: 1 });
      expect(await server.store.prisma.contract.findUnique({ where: { id: contract.id } })).toBeTruthy();
    } finally { await server.app.close(); }
  });
});

function client(handle: (query: Prisma.Sql) => Promise<unknown[]>): Pick<Prisma.TransactionClient, "$queryRaw"> {
  return { $queryRaw: handle as Prisma.TransactionClient["$queryRaw"] };
}

/** Models only effects of the separate confined PostgreSQL connection. */
async function persistSyntheticRegistration(store: TemplateSyntheticStore, values: unknown[]) {
  const [actor, projectId, contractId, versionId, revision, inputSha256, key] = values;
  const originals = JSON.parse(String(values[7]));
  const fileIds = originals.map(({ fileId }: { fileId: string }) => fileId);
  expect(originals.map(({ displayOrder, objectGeneration }: { displayOrder: number; objectGeneration: string }) =>
    [displayOrder, objectGeneration])).toEqual([[0, "sealed-200"], [1, "sealed-240"]]);
  const requestFields = ["contract-direct-archive-request-v1", 2, "direct_signed", contractId, versionId, actor,
    key, revision, inputSha256, fileIds.length, ...fileIds, true].map(String);
  const digest = createHash("sha256");
  for (const field of requestFields) digest.update(`${Buffer.byteLength(field)}:`).update(field);
  const requestSha256 = digest.digest("hex");
  const archiveId = randomUUID(), authoritySha256 = "a".repeat(64);
  const result = { archiveId, contractVersionId: versionId, status: "effective", fileIds };
  const identity = { databaseOid: "13000", currentRoleOid: "7001", sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001" };
  const routine = { ownerOid: "9001", namespaceOid: "2200", configuration: ["search_path=pg_catalog, pg_temp"],
    securityDefiner: false, strict: true, returnsSet: false, kind: "f", executable: true, noPublicExecute: true,
    noGrantOption: true, ...identity };
  await store.table("directArchiveRecoveryRoutine").createMany({ data: [
    { snapshot: { ...routine, name: "jg_contract_direct_archive_proof_v1", oid: "29708",
      sha256: "4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f",
      language: "plpgsql", volatility: "s", parallel: "u", returnTypeOid: "3802" } },
    { snapshot: { ...routine, name: "jg_contract_direct_archive_request_sha_v1", oid: "29709",
      sha256: "f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf",
      language: "sql", volatility: "i", parallel: "s", returnTypeOid: "25" } }
  ] });
  await store.table("directArchiveGenerationCatalog").create({ data: {
    snapshot: { ...identity, relationOid: "29908", completionOid: "29901", qualified: true }
  } });
  await store.table("contractArchiveFile").createMany({ data: [{
    id: archiveId, contractVersionId: versionId, archiveProtocolVersion: 2, archiveSource: "direct_signed", status: "confirmed",
    uploadedByUserId: actor, idempotencyKey: key, sourceRevision: revision, authoritySha256, requestSha256, responseSnapshot: result
  }] });
  await store.table("contractArchiveEvidenceFile").createMany({ data: originals.map((original: Record<string, unknown>) => ({
    id: randomUUID(), archiveFileId: archiveId, contractVersionId: versionId, fileId: original.fileId, displayOrder: original.displayOrder,
    mimeType: original.mimeType, sizeBytes: original.sizeBytes, contentSha256: original.contentSha256
  })) });
  await store.table("contractVersion").update({ where: { id: versionId }, data: { status: "effective", effectiveAt: new Date() } });
  await store.table("contractDraftAttachment").deleteMany({ where: { contractVersionId: versionId } });
  await store.table("auditLog").create({ data: { actorUserId: actor, businessType: "contract_version", businessId: versionId,
    action: "contract.archive.complete", metadata: { archiveId } } });
  await store.table("directArchiveRecoveryObservation").create({ data: { archiveId, proof: {
    proofProtocolVersion: 1, contractId, projectId, contractVersionId: versionId, archiveId, handlerUserId: actor,
    idempotencyKey: key, requestSha256, authoritySha256, sourceRevision: revision, inputSha256, fileIds, result
  } } });
  await store.table("directArchiveGenerationProof").create({ data: { archiveId, snapshot: {
    protocolVersion: 1, archiveId, contractVersionId: versionId, authoritySha256, originals
  } } });
}
