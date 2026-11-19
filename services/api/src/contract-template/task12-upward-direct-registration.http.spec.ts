import { Prisma } from "@prisma/client";
import { directArchiveRequestSha } from "../contract/contract-direct-archive-request";
import { createHash, randomUUID } from "node:crypto";
import type { DirectArchiveSqlClient } from "../contract/contract-direct-archive-executor";
import { nativeUpwardDirectArchiveAuthority } from "../contract/contract-upward-direct-archive-native";
import { openUpwardRegistrationDraft } from "./task12-upward-registration.test-support";

const types = ["material_purchase", "equipment_rental", "labor_subcontract", "professional_subcontract", "other"];

describe("对上已签合同正式登记公开入口", () => {
  it.each(types.flatMap(businessType => [false, true].map(operating => ({ businessType, operating }))))("$businessType（经营账$operating）：完整Q2与有序PDF/照片登记生效，响应丢失后按原键读回", async ({ businessType, operating }) => {
    jest.useFakeTimers({ doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate",
      "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    jest.setSystemTime(new Date("2026-11-09T16:00:00.000Z"));
    let proof: Record<string, unknown> | null = null;
    let issues = 0, executions = 0;
    let transportFailure: unknown;
    const fixture = await openUpwardRegistrationDraft(businessType, (store, storage) => nativeUpwardDirectArchiveAuthority(storage, {
      $queryRaw: async <T>(input: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
        const query = "strings" in input ? input : Prisma.sql(input, ...values);
        expect(query.strings.join("?")).toContain("jg_issue_contract_direct_upward_intent_v2");
        issues++;
        return [{ intentId: "22222222-2222-4222-8222-222222222222" }] as T;
      }
    } as unknown as DirectArchiveSqlClient, {
      $transaction: async operation => operation({
        $queryRaw: async (input: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
          const query = "strings" in input ? input : Prisma.sql(input, ...values);
          expect(query.strings.join("?")).toContain("jg_execute_contract_direct_upward_v2");
          executions++;
          const [, , actor, projectId, contractId, versionId, revision, inputSha256, key, encoded] = query.values;
          const originals = JSON.parse(String(encoded));
          const source = fixture.getInput();
          const archiveId = randomUUID();
          const result = { archiveId, contractVersionId: versionId, status: "effective", fileIds: originals.map((row: { fileId: string }) => row.fileId) };
          const requestSha256 = directArchiveRequestSha(String(contractId), String(versionId), String(actor), {
            archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: String(key), expectedDraftRevision: Number(revision),
            expectedInputSha256: String(inputSha256), fileIds: result.fileIds, confirmedMatchingSignedDocument: true });
          const project = await store.prisma.project.findUnique({ where: { id: projectId } });
          const consequence = { protocolVersion: 1, mode: project?.operatingLedgerEffectiveDate ? "internal_reference_only" : "not_applicable",
            operatingLedgerEffectiveDateSnapshot: project?.operatingLedgerEffectiveDate ? "2026-01-01" : null, expectedSource: null };
          const authoritySnapshot = { recipeVersion: "contract-upward-direct-archive-v1/1", operatingConsequence: consequence,
            sourceBasis: { directInput: { Q: source.Q, inputSha256 } }, originals };
          const authorityText = JSON.stringify(authoritySnapshot), authoritySha256 = createHash("sha256").update(authorityText).digest("hex");
          const now = new Date();
          await store.table("contractArchiveFile").createMany({ data: [{ id: archiveId, contractVersionId: versionId,
            archiveProtocolVersion: 2, archiveSource: "direct_signed", status: "confirmed", uploadedByUserId: actor, confirmedByUserId: actor,
            confirmedAt: now, idempotencyKey: key, sourceRevision: revision, requestSha256, authoritySha256,
            approvalInstanceId: null, sealTaskId: null, authoritySnapshot,
            responseSnapshot: result }] });
          for (const original of originals) await store.prisma.contractArchiveEvidenceFile.create({ data: {
            archiveFileId: archiveId, contractVersionId: versionId, fileId: original.fileId, displayOrder: original.displayOrder,
            mimeType: original.mimeType, sizeBytes: original.sizeBytes, contentSha256: original.contentSha256 } });
          await store.prisma.contractDraftAttachment.deleteMany({ where: { contractVersionId: versionId } });
          await store.prisma.contractVersion.update({ where: { id: versionId }, data: { status: "effective", effectiveAt: now, taxFactsFrozenAt: now, updatedAt: now } });
          proof = { archiveId, contractVersionId: versionId, requestSha256, authoritySha256, sourceRevision: revision,
            idempotencyKey: key, handlerUserId: actor, originals, ...source, result, authorityText, operatingConsequence: consequence };
          throw new Error("合成已提交响应丢失");
        }
      } as unknown as DirectArchiveSqlClient).catch(error => { transportFailure = error; throw error; })
    }));
    const { server, versionId, headers, saved, firstFile, secondFile } = fixture;
    try {
      if (operating) await server.store.prisma.project.update({ where: { id: fixture.projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-01-01Z") } });
      const native = server.store.prisma.$queryRaw;
      server.store.prisma.$queryRaw = async (input, ...values) => {
        const query = "strings" in input ? input : Prisma.sql(input, ...values);
        if (query.strings.join("?").includes("jg_read_upward_direct_archive_v1(")) return [{ proof }];
        return native(input, ...values);
      };
      const base = await server.app.getUrl(), path = base + "/contracts/" + versionId + "/signed-archive";
      const body = { archiveProtocolVersion: 2, archiveSource: "direct_signed", idempotencyKey: randomUUID(), expectedDraftRevision: 2,
        expectedInputSha256: saved.directSigningInput.inputSha256, fileIds: [firstFile, secondFile], confirmedMatchingSignedDocument: true };
      const send = (value: unknown = body) => fetch(path, { method: "POST", headers, body: JSON.stringify(value) });
      expect((await send({ ...body, expectedDraftRevision: 1 })).status).toBe(409);
      expect((await send({ ...body, fileIds: [secondFile, firstFile] })).status).toBe(409);
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: fixture.participationId }, data: { endedAt: new Date("2026-11-10T00:00:00Z") } });
      expect((await send()).status).toBe(409);
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: fixture.participationId }, data: { endedAt: null } });
      expect({ issues, executions }).toEqual({ issues: 0, executions: 0 });
      const response = await send(), result = await response.json();
      expect({ issues, executions }).toEqual({ issues: 1, executions: 1 });
      expect(transportFailure).toEqual(new Error("合成已提交响应丢失"));
      expect({ status: response.status, result }).toMatchObject({ status: 201, result: {
        contractVersionId: versionId, status: "effective", fileIds: [firstFile, secondFile] } });
      expect({ issues, executions }).toEqual({ issues: 1, executions: 1 });
      const replay = await send();
      expect({ status: replay.status, result: await replay.json() }).toEqual({ status: 201, result });
      expect((await send({ ...body, expectedInputSha256: "f".repeat(64) })).status).toBe(409);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.contractSealTask.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
      expect(await server.store.prisma.operatingImpactEntry.count()).toBe(0);
      expect(await server.store.prisma.contractDraftAttachment.count({ where: { contractVersionId: versionId } })).toBe(0);
      const lookup = () => fetch(`${base}/contracts/${versionId}/archive-requests/${body.idempotencyKey}`, { headers });
      const priorLookup = await lookup();
      expect({ status: priorLookup.status, body: await priorLookup.json() }).toMatchObject({ status: 200, body: { status: "archived", result } });
      const originalProof = JSON.parse(JSON.stringify(proof)) as Record<string, unknown>;
      for (const mutation of [
        { qText: "{" }, { authorityText: "{" },
        { operatingConsequence: { protocolVersion: 1, mode: "internal_reference_only", operatingLedgerEffectiveDateSnapshot: "not-a-date", expectedSource: null } }
      ]) {
        proof = { ...originalProof, ...mutation };
        expect((await lookup()).status).toBe(503);
      }
      proof = originalProof;
      expect((await lookup()).status).toBe(200);
      const validVersion = await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } });
      for (const mutation of [{ versionNo: 2 }, { changeType: "supplement" }, { taxFactsFrozenAt: null },
        { taxFactsFrozenAt: new Date("2026-11-08T00:00:00Z") }, { amountYuan: "100.0055" }]) {
        await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: mutation });
        expect((await lookup()).status).toBe(503);
        await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: validVersion! });
      }
      const ticket = await fetch(`${base}/files/${secondFile}/download-ticket`, { method: "POST", headers,
        body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对对上签章照片" }) });
      expect(ticket.status).toBe(201);
      const download = await fetch(base + (await ticket.json()).downloadUrl);
      expect({ status: download.status, bytes: Buffer.from(await download.arrayBuffer()) }).toEqual({ status: 200, bytes: Buffer.from("synthetic PNG original bytes") });
      await server.store.prisma.userPosition.deleteMany({ where: { userId: "staff" } });
      await server.store.prisma.projectMember.deleteMany({ where: { userId: "staff" } });
      expect((await send()).status).toBe(403);
      expect((await fetch(`${base}/files/${secondFile}/download-ticket`, { method: "POST", headers,
        body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "已撤销权限" }) })).status).toBe(403);
      expect({ issues, executions }).toEqual({ issues: 1, executions: 1 });
    } finally { await server.app.close(); jest.useRealTimers(); }
  });
});
