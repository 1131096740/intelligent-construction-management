import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { nativeDirectArchiveExecutor } from "../contract/contract-direct-archive-executor";
import { createTemplateTestServer, type TemplateSyntheticStore } from "./template-management.test-support";
import { openDirectPendingDraft, seedPreparedDirectArchiveTransition } from "./task12-direct-pending.test-support";
import { seedDirectArchiveDispatchCatalog } from "./task12-direct-archive-dispatch.oracle";
import { observeDirectArchiveCompletionBody, seedDirectArchiveCompletionCatalog, seedDirectArchiveRetentionCatalog } from "./task12-direct-archive-retention.oracle";
import { seedDirectReviewDatabaseBinding } from "./task12-direct-review-persistence.oracle";
import { loginTemplateActor } from "./template-selection.test-support";

describe("表外已签合同的正式登记", () => {
  it.each([false, true])("登记两份有序原件后可按原标识查回（经营账启用：%s）", async operating => {
    let useOperatingTransport = false;
    let rollBackOperating = false;
    const invocations = { issued: 0, executed: 0 };
    const nonce = randomUUID();
    const server = await createTemplateTestServer({ draftWorkbench: true, directArchiveExecutor: (store, storage) => {
      let intentId = randomUUID();
      let issuedCoordinates: readonly unknown[] | undefined;
      return nativeDirectArchiveExecutor(storage, client(async query => {
        expect(query.sql).toContain(useOperatingTransport ? "jg_issue_direct_outside_operating_v2" : "jg_issue_contract_direct_archive_intent_v1");
        invocations.issued++;
        expect(query.values[0]).toBe(nonce);
        if (useOperatingTransport) expect(query.values[1]).toBe(nonce);
        issuedCoordinates = query.values.slice(useOperatingTransport ? 2 : 1);
        intentId = randomUUID();
        return [{ intentId }];
      }), { $transaction: async operation => {
        await store.prisma.$transaction(async () => operation(client(async query => {
          expect(query.sql).toContain(useOperatingTransport ? "jg_execute_direct_outside_operating_v2" : "jg_execute_contract_direct_archive_outside_v1");
          const prefix = useOperatingTransport ? [nonce, nonce, intentId] : [nonce, intentId];
          expect(query.values).toEqual([...prefix, ...issuedCoordinates!]);
          invocations.executed++;
          const archiveId = await persistSyntheticRegistration(store, query.values.slice(prefix.length), useOperatingTransport);
          if (rollBackOperating) throw new Error("合成经营账延期约束失败");
          return [{ archiveId }];
        })));
        // The separate database session committed but its first response was lost.
        throw new Error("合成执行连接在提交后丢失响应");
      } });
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
      const readiness = async () => {
        const response = await fetch(base + path + "/workbench", { headers });
        expect(response.status).toBe(200);
        return (await response.json()).directPendingCapabilities;
      };
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      const before = await lookup();
      expect({ status: before.status, body: await before.json() }).toEqual({ status: 200, body: { status: "unknown" } });
      expect((await send()).status).toBe(503);
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      const nativeSnapshot = {
        completionOid: "29901", executorOwnerOid: "9912", ownerOid: "9001", namespaceOid: "2200", databaseOid: "13000",
        currentRoleOid: "7001", sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001", intentBindingSha256: "a".repeat(64), nonce,
        parentGuardBodySha256: "1e9d6404ecd618617aa74dc85fc656be334f1b0d8219d7e814361866f6e4b903",
        versionGuardBodySha256: "c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157"
      };
      const native = await server.store.table("directArchiveNativeAdmission").create({ data: { snapshot: nativeSnapshot } });
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
        data: { snapshot: { ...completion.actual, guardsClosed: false, registryAclQualified: false } } });
      expect(await readiness()).toMatchObject({ registrationEnabled: true, copyEnabled: false, purgeEnabled: false });
      const parentSignature = 'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")';
      const installedParent = "b211330ea1a8e4bad49fb29fa05543c3a4a7028cc6424c48975cdfe010e0ca4b";
      const setParentBody = async (bodySha256: string, parentGuardBodySha256: string) => {
        await server.store.table("directArchiveNativeAdmission").update({ where: { id: native.id },
          data: { snapshot: { ...nativeSnapshot, parentGuardBodySha256 } } });
        await server.store.table("directArchiveDispatchActual").update({ where: { id: dispatch.observation.id },
          data: { snapshot: { ...dispatch.actual, helpersPrivate: false,
            helpers: { ...helpers, [parentSignature]: { ...helpers[parentSignature] as object, bodySha256 } } } } });
      };
      await setParentBody(installedParent, installedParent);
      expect(await readiness()).toMatchObject({ registrationEnabled: true });
      await setParentBody(installedParent, liveHelpers[parentSignature]);
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await setParentBody("f".repeat(64), "f".repeat(64));
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await setParentBody(liveHelpers[parentSignature], liveHelpers[parentSignature]);
      const versionSignature = 'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")';
      const enabledVersion = "b448ae524c9d9b1961b02a6a995f92df1295eae3f9d015e282660bc3bdef9b30";
      const setVersionBody = async (bodySha256: string, versionGuardBodySha256: string, outsideSlotQualified: boolean,
        outsideOperatingExecutorQualified = false) => {
        const parentGuardBodySha256 = bodySha256 === enabledVersion ? installedParent : liveHelpers[parentSignature];
        await server.store.table("directArchiveNativeAdmission").update({ where: { id: native.id },
          data: { snapshot: { ...nativeSnapshot, parentGuardBodySha256, versionGuardBodySha256, outsideSlotQualified,
            outsideOperatingExecutorQualified } } });
        await server.store.table("directArchiveDispatchActual").update({ where: { id: dispatch.observation.id },
          data: { snapshot: { ...dispatch.actual, helpersPrivate: false, helpers: { ...helpers,
            [versionSignature]: { ...helpers[versionSignature] as object, bodySha256 },
            [parentSignature]: { ...helpers[parentSignature] as object, bodySha256: parentGuardBodySha256 } } } } });
      };
      await setVersionBody(enabledVersion, enabledVersion, false);
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await setVersionBody(enabledVersion, enabledVersion, true);
      expect(await readiness()).toMatchObject({ registrationEnabled: true });
      await setVersionBody(enabledVersion, liveHelpers[versionSignature], true);
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await setVersionBody(liveHelpers[versionSignature], liveHelpers[versionSignature], false);
      const globalGuard = "jg_contract_archive_v2_complete_guard";
      const directGuard = "jg_require_contract_direct_archive_complete_v1";
      const globalPost = "2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd";
      const directPost = "aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a";
      const setCompletion = async (qualified: boolean, directSha: string) => {
        await server.store.table("directArchiveCompletionActual").update({ where: { id: completion.observed.id }, data: {
          snapshot: { ...completion.actual, guardsClosed: false, registryAclQualified: false, generatedDispatchQualified: true,
            enabledDirectCompletionQualified: qualified, bindings: { ...completion.actual.bindings, procedures: {
              ...completion.actual.bindings.procedures,
              completion: { ...completion.actual.bindings.procedures.completion, sha256: globalPost }
            } } }
        } });
        await server.store.table("directArchiveRetentionActual").update({ where: { id: retention.observed.id }, data: {
          snapshot: { ...retention.actual, bindings: { ...retention.actual.bindings, routines: {
            ...retention.actual.bindings.routines,
            [globalGuard]: { ...retention.actual.bindings.routines[globalGuard], sha: globalPost },
            [directGuard]: { ...retention.actual.bindings.routines[directGuard], sha: directSha }
          } } }
        } });
      };
      await setCompletion(false, directPost);
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await setCompletion(true, directPost);
      expect(await readiness()).toMatchObject({ registrationEnabled: true });
      await setCompletion(true, retention.actual.bindings.routines[directGuard].sha);
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await observeDirectArchiveCompletionBody(server, retention);
      await server.store.table("directArchiveCompletionActual").update({ where: { id: completion.observed.id },
        data: { snapshot: { ...completion.actual, guardsClosed: false, registryAclQualified: false } } });
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      await server.store.prisma.project.update({ where: { id: projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-01-01Z") } });
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      await server.store.prisma.project.update({ where: { id: projectId }, data: { operatingLedgerEffectiveDate: null } });
      const membership = await server.store.table("directArchiveUntrustedFileRoleInheritance").create({ data: {
        fileCallerOid: "9921", reachableExecutorOwnerOid: "9912"
      } });
      expect(await readiness()).toMatchObject({ registrationEnabled: false });
      const withInheritedWriteRole = await send();
      expect({ status: withInheritedWriteRole.status, body: await withInheritedWriteRole.json() })
        .toMatchObject({ status: 503 });
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      expect(await (await lookup()).json()).toEqual({ status: "unknown" });
      await server.store.table("directArchiveUntrustedFileRoleInheritance").delete({ where: { id: membership.id } });
      const unexpected = await server.store.table("directArchiveUnexpectedRoleInheritance").create({ data: {
        loginRoleOid: "9922", reachableExecutorOwnerOid: "9912"
      } });
      const withUnexpectedWriteRole = await send();
      expect({ status: withUnexpectedWriteRole.status, body: await withUnexpectedWriteRole.json() })
        .toMatchObject({ status: 503 });
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      expect(await (await lookup()).json()).toEqual({ status: "unknown" });
      await server.store.table("directArchiveUnexpectedRoleInheritance").delete({ where: { id: unexpected.id } });
      const lastVersion = await server.store.table("syntheticPrivateFileVersion").findFirst({ where: { objectGeneration: "sealed-240" } });
      if (!lastVersion) throw new Error("合成存储固定版本缺失");
      await server.store.table("syntheticPrivateFileVersion").delete({ where: { id: lastVersion.id } });
      expect((await send()).status).toBe(503);
      expect(await (await lookup()).json()).toEqual({ status: "unknown" });
      expect(invocations).toEqual({ issued: 0, executed: 0 });
      await server.store.table("syntheticPrivateFileVersion").create({ data: lastVersion });
      if (operating) {
        await server.store.prisma.project.update({ where: { id: projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-01-01Z") } });
        expect(await readiness()).toMatchObject({ registrationEnabled: false });
        expect((await send()).status).toBe(409);
        expect(invocations).toEqual({ issued: 0, executed: 0 });
        await setVersionBody(liveHelpers[versionSignature], liveHelpers[versionSignature], false, true);
        expect(await readiness()).toMatchObject({ registrationEnabled: false });
        await setVersionBody(enabledVersion, enabledVersion, true, true);
        await setCompletion(true, directPost);
        const expectClosed = async () => {
          expect(await readiness()).toMatchObject({ registrationEnabled: false });
          expect((await send()).status).toBe(409);
          expect(await (await lookup()).json()).toEqual({ status: "unknown" });
          expect(invocations).toEqual({ issued: 0, executed: 0 });
        };
        // The eight predecessor observations cover both dedicated role paths.
        await expectClosed();
        const catalog = server.store.table("directOutsideOperatingPrivateRoutine");
        const bothOwners = ["issuerOwner", "executorOwner"];
        const issueOwners = ["issuerOwner"];
        const executorOwners = ["executorOwner"];
        const privateRoutines = [
          ["public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid)", "0d58a2b5c5b3be145cfede1e672e3c981afccc5f2f88cc422c60c0c53a76d450", bothOwners],
          ["public.jg_direct_outside_operating_channel_v2(boolean,uuid)", "33e0fab573b31ef36a8b080300d56e20963740ab2e8d3e305c1dfcaa83e0a569", bothOwners],
          ["public.jg_read_direct_outside_operating_basis_v2(boolean,uuid,text,text,text,text,integer,text,text,jsonb)", "f5a182f71b74730300db10eb75ca9bec98fd9279c51eb267a637748b0158c09a", bothOwners],
          ["public.jg_issue_contract_direct_outside_operating_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)", "5a8b200ab7dd46ab186421f00c36f064c53cddb45fadad892cca26840a964ba2", issueOwners],
          ["public.jg_claim_contract_direct_outside_operating_intent_v2(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb)", "a901e768b48f9b8def24c9d4fd99139fcc27f2074fa2caa17472695589a64075", executorOwners],
          ["public.jg_contract_direct_archive_outside_operating_basis_v2(text,text,text,text,integer,text,text,jsonb)", "11e79bd551fea5d39db59a739d92cc1db26a7eca0a1653178c362e9b433ee348", []],
          ["public.jg_read_contract_direct_outside_review_scope_v2(text,text,text,integer,text,jsonb,timestamp)", "d26a8ac83fd5d378ae790a8104ae34828271e81a5d8814df82cadb032ed21ba4", []],
          ["public.jg_direct_outside_operating_basis_catalog_v2()", "70cf96e31452748e7e01e8f4d4ec4dad8683e992072f3041bbde522cc8866f18", []]
        ] as const;
        const observedRoutines = await Promise.all(privateRoutines.map(([signature, bodySha256, executeRoles]) =>
          catalog.create({ data: { signature, bodySha256, executeRoles } })));
        const [verifier, , bridge, , claim, basis] = observedRoutines;
        for (const [row, drift] of [
          [verifier, { bodySha256: null }], [claim, { bodySha256: "f".repeat(64) }],
          [bridge, { executeRoles: ["issuerOwner"] }], [bridge, { executeRoles: [...bothOwners, "runtimeLogin"] }],
          [basis, { executeRoles: ["issuerOwner"] }], [verifier, { readFailed: true }]
        ] as const) {
          await catalog.update({ where: { id: row.id }, data: drift });
          await expectClosed();
          await catalog.update({ where: { id: row.id }, data: { ...row, readFailed: false } });
        }
        expect(await readiness()).toMatchObject({ registrationEnabled: true });
        useOperatingTransport = true;
        rollBackOperating = true;
        expect((await send()).status).toBe(503);
        expect(await (await lookup()).json()).toEqual({ status: "unknown" });
        expect(await server.store.prisma.contractArchiveFile.count({ where: { contractVersionId: version.id } })).toBe(0);
        expect(await server.store.prisma.operatingFact.count({ where: { projectId } })).toBe(0);
        expect(await server.store.table("operatingImpactEntry").count({ where: { projectId } })).toBe(0);
        rollBackOperating = false;
      }
      const outsider = await loginTemplateActor(server, "employee");
      const outsiderHeaders = { ...headers, authorization: `Bearer ${outsider}` };
      const attemptsBeforeOutsider = { ...invocations };
      const rejected = await fetch(`${base}/contracts/${version.id}/signed-archive`, {
        method: "POST", headers: outsiderHeaders, body: JSON.stringify(request)
      });
      expect(rejected.status).toBe(403);
      expect(invocations).toEqual(attemptsBeforeOutsider);
      const registered = await send();
      const result = await registered.json();
      expect({ status: registered.status, result }).toMatchObject({
        status: 201, result: { archiveId: expect.any(String), contractVersionId: version.id, status: "effective", fileIds: originals }
      });
      expect(await (await lookup()).json()).toMatchObject({ status: "archived", result });
      expect((await fetch(`${base}/contracts/${version.id}/archive-requests/${key}`, { headers: outsiderHeaders })).status).toBe(403);
      expect((await fetch(`${base}/files/${originals[1]}/download-ticket`, {
        method: "POST", headers: outsiderHeaders,
        body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对直签原件" })
      })).status).toBe(403);
      const generations = await server.store.table("directArchiveGenerationProof").findFirst();
      if (!generations) throw new Error("合成固定原件证明缺失");
      if (!operating) {
        await server.store.table("directArchiveGenerationProof").delete({ where: { id: generations.id } });
        expect((await lookup()).status).toBe(503);
        await server.store.table("directArchiveGenerationProof").create({ data: generations });
      }
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
      expect(await server.store.prisma.operatingFact.count({ where: { projectId } })).toBe(operating ? 1 : 0);
      expect(await server.store.table("operatingImpactEntry").count({ where: { projectId } })).toBe(operating ? 1 : 0);
      expect(invocations).toEqual(operating ? { issued: 2, executed: 2 } : { issued: 1, executed: 1 });
      expect(await server.store.prisma.contract.findUnique({ where: { id: contract.id } })).toBeTruthy();

      if (operating) return;

      // Independently installed enabled-ledger proof for an already committed
      // archive. The old V1 oracle remains present to detect an unsafe fallback.
      await server.store.prisma.project.update({ where: { id: projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-01-01Z") } });
      const archiveRows = server.store.table("contractArchiveFile");
      const archived = await archiveRows.findFirst({ where: { id: result.archiveId } });
      if (!archived) throw new Error("合成归档记录缺失");
      await archiveRows.deleteMany({ where: { id: result.archiveId } });
      await archiveRows.createMany({ data: [{ ...archived, authoritySnapshot: { operatingConsequence: { mode: "projection_required" } } }] });
      const legacyReads = server.store.directArchiveProofReads;
      expect((await lookup()).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(legacyReads);
      const recovery = await server.store.table("directArchiveRecoveryObservation").findFirst();
      if (!recovery) throw new Error("合成原键归档凭据缺失");
      const enabled = await server.store.table("directOutsideOperatingArchiveProof").create({ data: { archiveId: result.archiveId,
        proof: recovery.proof, originals: (generations.snapshot as { originals: unknown }).originals, qualified: true
      } });
      expect(await (await lookup()).json()).toMatchObject({ status: "archived", result });
      expect(await (await send()).json()).toEqual(result);
      const enabledTicket = await fetch(`${base}/files/${originals[1]}/download-ticket`, {
        method: "POST", headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对已启用经营账直签原件" })
      });
      expect(enabledTicket.status).toBe(201);
      const enabledUrl = (await enabledTicket.json()).downloadUrl;
      const enabledDownload = await fetch(base + enabledUrl);
      expect({ status: enabledDownload.status, bytes: Buffer.from(await enabledDownload.arrayBuffer()) })
        .toEqual({ status: 200, bytes: originalBytes[1] });
      await server.store.table("syntheticPrivateFileVersion").delete({ where: { id: lastVersion.id } });
      expect((await fetch(base + enabledUrl)).status).toBe(503);
      await server.store.table("syntheticPrivateFileVersion").create({ data: lastVersion });
      await server.store.table("directOutsideOperatingArchiveProof").update({ where: { id: enabled.id }, data: { qualified: false } });
      expect((await lookup()).status).toBe(503);
      expect((await fetch(base + enabledUrl)).status).toBe(503);
      expect(server.store.directArchiveProofReads).toBe(legacyReads);
      expect(invocations).toEqual({ issued: 1, executed: 1 });
    } finally { await server.app.close(); }
  });
});

function client(handle: (query: Prisma.Sql) => Promise<unknown[]>): Pick<Prisma.TransactionClient, "$queryRaw"> {
  return { $queryRaw: handle as Prisma.TransactionClient["$queryRaw"] };
}

/** Models only effects of the separate confined PostgreSQL connection. */
async function persistSyntheticRegistration(store: TemplateSyntheticStore, values: unknown[], operating: boolean) {
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
    uploadedByUserId: actor, idempotencyKey: key, sourceRevision: revision, authoritySha256, requestSha256, responseSnapshot: result,
    ...(operating ? { authoritySnapshot: { operatingConsequence: { mode: "projection_required" } } } : {})
  }] });
  await store.table("contractArchiveEvidenceFile").createMany({ data: originals.map((original: Record<string, unknown>) => ({
    id: randomUUID(), archiveFileId: archiveId, contractVersionId: versionId, fileId: original.fileId, displayOrder: original.displayOrder,
    mimeType: original.mimeType, sizeBytes: original.sizeBytes, contentSha256: original.contentSha256
  })) });
  await store.table("contractVersion").update({ where: { id: versionId }, data: { status: "effective", effectiveAt: new Date() } });
  await store.table("contractDraftAttachment").deleteMany({ where: { contractVersionId: versionId } });
  await store.table("auditLog").create({ data: { actorUserId: actor, businessType: "contract_version", businessId: versionId,
    action: "contract.archive.complete", metadata: { archiveId } } });
  const proof = { proofProtocolVersion: 1, contractId, projectId, contractVersionId: versionId, archiveId, handlerUserId: actor,
    idempotencyKey: key, requestSha256, authoritySha256, sourceRevision: revision, inputSha256, fileIds, result };
  await store.table("directArchiveRecoveryObservation").create({ data: { archiveId, proof } });
  if (operating) {
    const factId = randomUUID();
    await store.table("operatingFact").create({ data: { id: factId, projectId, sourceType: "contract_version", sourceBusinessId: versionId } });
    await store.table("operatingImpactEntry").create({ data: { id: randomUUID(), factId, projectId } });
    await store.table("directOutsideOperatingArchiveProof").create({ data: { archiveId, proof, originals, qualified: true } });
  }
  await store.table("directArchiveGenerationProof").create({ data: { archiveId, snapshot: {
    protocolVersion: 1, archiveId, contractVersionId: versionId, authoritySha256, originals
  } } });
  return archiveId;
}
