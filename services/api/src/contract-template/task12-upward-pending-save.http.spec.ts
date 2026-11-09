import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

describe("任务12 对上直签保存资格", () => {
  it("按现有租约、保存和工作台入口保存对上两方、四位金额和有序原件", async () => {
    jest.useFakeTimers({ doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate",
      "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    jest.setSystemTime(new Date("2026-11-09T16:00:00.000Z"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const id = randomUUID;
      const projectId = id(), contractId = id(), versionId = id(), businessPartyId = id(), enterpriseVersionId = id();
      const assignmentId = id(), companyId = id(), companyVersionId = id(), joinedVersionId = id(), participationId = id();
      const firstFile = id(), secondFile = id(), secondProject = id();
      const versionMarker = { protocolVersion: 2, source: "direct_signed", relationship: "upward", signedOn: null,
        enterpriseParty: null, companyParty: null, companyParticipationId: null, fixedPaymentTermsVersionId: null };
      await server.store.prisma.project.create({ data: { id: projectId, code: "T12-UPWARD-SAVE", name: "合成对上项目", isActive: true } });
      await server.store.prisma.projectMember.create({ data: { projectId, userId: "staff", positionKey: "contract_staff" } });
      await server.store.prisma.contract.create({ data: { id: contractId, projectId, ownerUserId: "staff", name: "", code: null, contractTypeKey: "material_purchase" } });
      await server.store.prisma.contractVersion.create({ data: { id: versionId, contractId, versionNo: 1, changeType: "original", numericProtocolVersion: 2,
        signingSubjectType: "draft_unconfirmed", status: "draft", amountLimitType: "capped", originalSignedNumber: null, draftData: { contractBasics: { relationship: "upward" }, directSigningInput: versionMarker } } });
      await server.store.prisma.businessParty.create({ data: { id: businessPartyId, name: "施工企业", status: "active" } });
      const enterpriseSnapshot = { name: "施工企业", unifiedSocialCreditCode: "ENTERPRISE-ONE" };
      await server.store.prisma.businessPartyVersion.create({ data: { id: enterpriseVersionId, businessPartyId, versionNo: 1, snapshot: enterpriseSnapshot } });
      await server.store.prisma.projectAffiliateAssignment.create({ data: { id: assignmentId, projectId, businessPartyId, businessPartyVersionId: enterpriseVersionId,
        affiliateNameSnapshot: "施工企业", affiliateCreditCodeSnapshot: "ENTERPRISE-ONE", effectiveFrom: new Date("2026-11-08T16:00:00.000Z"), endedAt: null } });
      await server.store.prisma.companyEntity.create({ data: { id: companyId, isActive: true, dataStatus: "complete", currentVersionNo: 2 } });
      await server.store.prisma.companyEntityVersion.create({ data: { id: companyVersionId, companyEntityId: companyId, versionNo: 2, isActive: true,
        name: "我方签约公司", unifiedSocialCreditCode: "COMPANY-TWO", registeredAddress: "实际地址" } });
      await server.store.prisma.companyEntityVersion.create({ data: { id: joinedVersionId, companyEntityId: companyId, versionNo: 1, isActive: true } });
      await server.store.prisma.projectParticipatingCompany.create({ data: { id: participationId, projectId, companyEntityId: companyId, companyEntityVersionId: joinedVersionId,
        effectiveFrom: new Date("2026-11-10T00:00:00.000Z"), endedAt: null } });
      for (const [fileId, mimeType, sha] of [[firstFile, "application/pdf", "a"], [secondFile, "image/png", "b"]]) {
        await server.store.prisma.fileObject.create({ data: { id: fileId, mimeType, sizeBytes: 20, contentSha256: sha.repeat(64),
          storageStatus: "active", uploadedByUserId: "staff", purgeReceiptId: null, supersedesFileObjectId: null } });
      }
      const profile = {
        databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001", currentRoleOid: "7001", sessionRoleOid: "7001",
        bindingOid: "42001", createBindingOid: "42002", versionRoutineOid: "42003",
        attachmentRoutineOid: "42004", slotRoutineOid: "42005", createBindingSha256: "1".repeat(64), backendPid: 71201, transactionId: "500003",
        dualIdentityCheck: true, restrictedRole: true, privateTechnicalAcl: true,
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
      let observedProfile: typeof profile | null = profile;
      const createProfile = {
        databaseOid: "13000", namespaceOid: "2200", ownerOid: "9001", applicationRoleOid: "7001", sessionRoleOid: "7001",
        bindingOid: "10024", createBindingOid: "42002", helperOid: "42006", backendPid: 71201,
        directDispatchSha256: "f".repeat(64), createBindingSha256: "1".repeat(64), transactionId: "500003",
        triggerCount: 3, createBindingTriggerCount: 2, dispatchBindingOid: "41998", versionTriggerOid: "30001",
        versionRoutineOid: "42003", attachmentTriggerOid: "30002",
        createBindingBody: "1596a00b04dd2907b229d7ae1a4c53645d0c3f9d6837fef5c6396cda0707bd26",
        versionBody: profile.routineBodies.version, attachmentBody: profile.routineBodies.attachment,
        bindingBody: "5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d",
        helperBody: "367527eea9629755f1ef287c36a52a76f9b768ac86bbaa475aa0422a564944be",
        safeRole: true, privateExecute: true, privateRegistryRead: true, bindingShape: true
      };
      let observedCreate = createProfile;
      let draftRevisionRace: "source" | "subjects" | null = null;
      let preparedInputRead = false;
      const companyRead = server.store.prisma.companyEntity.findMany;
      server.store.prisma.companyEntity.findMany = async options => {
        const rows = await companyRead(options);
        if (draftRevisionRace === "subjects" && preparedInputRead) {
          await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: { draftRevision: 3 } });
        }
        return rows;
      };
      let changedPaperFact: "file" | "date" | "terms" | "participation" | null = null;
      let enterpriseLockMissing = false;
      const identityLocks: string[] = [];
      const native = server.store.prisma.$queryRaw;
      server.store.prisma.$queryRaw = async (input, ...values) => {
        const query = "strings" in input ? input : Prisma.sql(input, ...values);
        const text = query.strings.join("?").replace(/\s+/gu, " ").trim();
        if (text === 'SELECT "id", "status" FROM "BusinessParty" WHERE "id" IN (?) ORDER BY "id" FOR UPDATE') {
          expect(query.values).toEqual([businessPartyId]);
          identityLocks.push("enterprise");
          if (enterpriseLockMissing) return [];
        }
        if (text === 'SELECT "id" FROM "CompanyEntity" WHERE "id" = ? FOR UPDATE') {
          expect(query.values).toEqual([companyId]);
          identityLocks.push("company");
        }
        if (text.startsWith("/* contract_upward_pending_save_probe_v1 */")) return [{ readable: true }];
        if (text.startsWith("/* contract_upward_pending_save_catalog_v1 */")) return observedProfile ? [observedProfile] : [];
        if (text.startsWith("/* contract_upward_pending_create_catalog_v1 */")) return [observedCreate];
        if (text.startsWith("/* contract_upward_pending_catalog_v1 */")) {
          return [{ oid: "31100", namespaceOid: "2200", ownerOid: "9001",
            bodySha256: "5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4",
            definer: false, settings: ["search_path=pg_catalog, public"], volatility: "s", parallel: "u", strict: false,
            returnsSet: false, language: "plpgsql", returnsJsonb: true, plainRoutine: true, currentRoleOid: "7001",
            sessionRoleOid: "7001", backendPid: 71201, transactionId: "500003", sameDatabase: true, privateExecute: true, sourceTables: true }];
        }
        if (text.startsWith("/* contract_upward_pending_save_update_v1 */")) {
          const [draft, originalSignedNumber, companyEntityIdSnapshot, companyEntityVersionId, companyEntityNameSnapshot,
            companyEntityCreditCodeSnapshot, companyEntityRegisteredAddressSnapshot, affiliateAssignmentId,
            affiliateBusinessPartyVersionId, affiliateNameSnapshot, affiliateCreditCodeSnapshot, amountYuan, pricingNature,
            amountSource, invoiceType, taxMode, defaultTaxRatePercent, updatedAt, v, c, expectedRevision] = query.values;
          expect([v, c]).toEqual([versionId, contractId]);
          const version = await server.store.prisma.contractVersion.findUnique({ where: { id: v } });
          if (!version || version.draftRevision !== expectedRevision) return [];
          const revision = Number(expectedRevision) + 1;
          await server.store.prisma.contractVersion.update({ where: { id: v }, data: {
            draftData: JSON.parse(String(draft)), originalSignedNumber, signingSubjectType: "upward", companyEntityIdSnapshot,
            companyEntityVersionId, companyEntityNameSnapshot, companyEntityCreditCodeSnapshot, companyEntityRegisteredAddressSnapshot,
            affiliateAssignmentId, affiliateBusinessPartyVersionId, affiliateNameSnapshot, affiliateCreditCodeSnapshot,
            amountYuan, pricingNature, amountSource, invoiceType, taxMode, defaultTaxRatePercent, updatedAt, draftRevision: revision
          } });
          return [{ id: v, draftRevision: revision }];
        }
        if (text.startsWith("SELECT public.jg_contract_upward_pending_read_v1(")) {
          expect(query.values).toEqual([versionId, "staff"]);
          const version = await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } });
          const draft = version?.draftData as { directSigningInput: { enterpriseParty: unknown; companyParty: unknown; signedOn: string | null };
            contractBasics: { amountBasis: string; settlementText: string } };
          const contract = await server.store.prisma.contract.findUnique({ where: { id: contractId } });
          const terms = await server.store.prisma.paymentTermsVersion.findFirst({ where: { contractVersionId: versionId } });
          const party = await server.store.prisma.contractPartySnapshot.findFirst({ where: { contractVersionId: versionId } });
          const attachments = await server.store.prisma.contractDraftAttachment.findMany({ where: { contractVersionId: versionId }, orderBy: { displayOrder: "asc" } });
          if (!version || !party || attachments.length !== 2) return [{ input: null }];
          const signedFiles = await Promise.all(attachments.map(async row => {
            const file = await server.store.prisma.fileObject.findUnique({ where: { id: row.fileId } });
            return { fileId: row.fileId, displayOrder: row.displayOrder, mimeType: file?.mimeType, sizeBytes: file?.sizeBytes,
              contentSha256: changedPaperFact === "file" && row.displayOrder === 0 ? "e".repeat(64) : file?.contentSha256 };
          }));
          const Q = {
            inputProtocolVersion: 2, source: { kind: "direct_signed", relationship: "upward" },
            locator: { projectId, contractId, contractVersionId: versionId, draftRevision: version.draftRevision, versionNo: 1, changeType: "original" },
            contract: { businessType: contract?.contractTypeKey, name: contract?.name, originalSignedNumber: version.originalSignedNumber,
              signedOn: changedPaperFact === "date" ? "2026-11-07" : draft.directSigningInput.signedOn },
            money: { numericProtocolVersion: 2, amountYuan: version.amountYuan == null ? null : new Prisma.Decimal(String(version.amountYuan)).toFixed(4),
              amountLimitType: version.amountLimitType, pricingNature: version.pricingNature, amountSource: version.amountSource },
            tax: { amountBasis: draft.contractBasics.amountBasis, invoiceType: version.invoiceType, taxMode: version.taxMode,
              defaultTaxRatePercent: version.defaultTaxRatePercent == null ? null : new Prisma.Decimal(String(version.defaultTaxRatePercent)).toFixed(6) },
            terms: { settlementText: draft.contractBasics.settlementText, paymentTerms: terms ? { id: terms.id, versionNo: terms.versionNo,
              originalText: changedPaperFact === "terms" ? "不是原文" : terms.originalText } : null },
            subjects: {
              enterprise: { projectId, position: draft.directSigningInput.enterpriseParty, cpsId: party.id, assignmentId,
                businessPartyId, businessPartyVersionId: enterpriseVersionId, effectiveFrom: "2026-11-08T16:00:00.000Z", endedAt: null },
              company: { projectId, position: draft.directSigningInput.companyParty, participationId, companyEntityId: companyId,
                companyEntityVersionId: companyVersionId, joinedCompanyEntityVersionId: changedPaperFact === "participation" ? "different-join-version" : joinedVersionId, effectiveFrom: "2026-11-10", endedAt: null }
            }, signedFiles
          };
          const qText = JSON.stringify(Q);
          preparedInputRead = true;
          if (draftRevisionRace === "source") {
            await server.store.prisma.contractVersion.update({
              where: { id: versionId }, data: { draftRevision: Number(version.draftRevision) + 1 }
            });
          }
          return [{ input: { Q, qText, inputSha256: createHash("sha256").update(qText).digest("hex") } }];
        }
        return native(input, ...values);
      };
      const path = (await server.app.getUrl()) + "/contract-drafts/" + versionId;
      const headers = { authorization: "Bearer " + await loginTemplateActor(server, "staff"),
        "content-type": "application/json", "x-contract-numeric-protocol": "2" };
      const capabilityPath = (await server.app.getUrl()) + "/contracts/create-capability?projectId=" + projectId;
      const getCapability = async (relationship = "upward") => {
        const capability = await fetch(capabilityPath + "&relationship=" + relationship, { headers });
        expect(capability.status).toBe(200);
        return capability.json();
      };
      expect(await getCapability("outside")).toEqual({ projectId, availableActions: ["create_contract_draft"] });
      expect(await getCapability()).toEqual({ projectId, availableActions: ["create_contract_draft", "create_upward_direct_draft"] });
      observedCreate = { ...createProfile, createBindingSha256: "2".repeat(64) };
      expect(await getCapability()).toEqual({ projectId, availableActions: ["create_contract_draft"] });
      observedCreate = createProfile;
      observedProfile = { ...profile, dualIdentityCheck: false };
      expect(await getCapability()).toEqual({ projectId, availableActions: ["create_contract_draft"] });
      expect((await fetch(path + "/edit-lease", { method: "POST", headers })).status).toBe(503);
      observedProfile = profile;
      const loadSubjects = async () => {
        const workbench = await fetch(path + "/workbench", { headers });
        expect(workbench.status).toBe(200);
        return (await workbench.json()).upwardDraftSubjects;
      };
      expect(await loadSubjects()).toEqual({ projectId, contractVersionId: versionId, draftRevision: 1,
        enterprise: { businessPartyVersionId: enterpriseVersionId, name: "施工企业" },
        companies: [{ companyEntityId: companyId, companyEntityVersionId: companyVersionId, name: "我方签约公司" }] });
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participationId }, data: { projectId: secondProject } });
      expect((await loadSubjects()).companies).toEqual([]);
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participationId }, data: { projectId,
        endedAt: new Date("2026-11-10T00:00:00.000Z") } });
      expect((await loadSubjects()).companies).toEqual([]);
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participationId }, data: { endedAt: null } });
      const lease = await fetch(path + "/edit-lease", { method: "POST", headers });
      expect(lease.status).toBe(201);
      const { token } = await lease.json();
      const companyParty = { roleKey: "party_b", displayOrder: 0 }, enterpriseParty = { roleKey: "party_a", displayOrder: 0 };
      const input = { idempotencyKey: id(), expectedRevision: 1, saveKind: "manual", changedSections: ["draft", "parties", "attachments"],
        draft: { companyEntityId: companyId, numericProtocolVersion: 2, manualAmountYuan: "100.0054", originalSignedNumber: " 原号  ",
          draftData: { contractName: "对上签章合同", contractBasics: { relationship: "upward", businessType: "material_purchase",
            amountBasis: "tax_inclusive", invoiceStatus: "pending", settlementText: "  按纸面结算  " },
            directSigningInput: { ...versionMarker, companyParty, enterpriseParty, signedOn: "2026-11-08" } },
          clauses: [], pricingNature: "unit_price", amountSource: "manual",
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "13.25", source: "contract_document" } },
        parties: [{ ...enterpriseParty, businessPartyVersionId: enterpriseVersionId, snapshot: {} }], bills: [],
        paymentTerms: { originalText: "  以纸面原文为准\n不自动拆分  ", stages: [] },
        attachments: [firstFile, secondFile].map((fileId, displayOrder) => ({ slotKey: "direct_signed_originals_v1", fileId, displayOrder })),
        negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
      const send = (value: unknown = input) => fetch(path, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": token }, body: JSON.stringify(value) });
      const attachmentInput = input.attachments;
      expect((await send({ ...input, attachments: [attachmentInput[1], attachmentInput[0]] })).status).toBe(400);
      await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignmentId }, data: {
        endedAt: new Date("2026-11-09T16:00:00.000Z")
      } });
      expect((await send()).status).toBe(409);
      await server.store.prisma.projectAffiliateAssignment.update({ where: { id: assignmentId }, data: { endedAt: null } });
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participationId }, data: { projectId: id() } });
      expect((await send()).status).toBe(409);
      await server.store.prisma.projectParticipatingCompany.update({ where: { id: participationId }, data: { projectId } });
      expect(await server.store.prisma.contractDraftAttachment.count()).toBe(0);
      expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(0);
      identityLocks.length = 0;
      enterpriseLockMissing = true;
      expect((await send()).status).toBe(400);
      expect(identityLocks).toEqual(["enterprise"]);
      expect(await server.store.prisma.paymentTermsVersion.count({ where: { contractVersionId: versionId } })).toBe(0);
      expect(await server.store.prisma.contractPartySnapshot.count({ where: { contractVersionId: versionId } })).toBe(0);
      expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(0);
      enterpriseLockMissing = false;
      for (const fact of ["file", "date", "terms", "participation"] as const) {
        changedPaperFact = fact;
        const rejected = await send();
        expect({ fact, status: rejected.status }).toEqual({ fact, status: 503 });
        const receipt = await fetch(path + "/save-requests/" + input.idempotencyKey, { headers });
        expect({ status: receipt.status, body: await receipt.json() }).toEqual({ status: 200, body: { status: "unknown" } });
        const unchanged = await fetch(path + "/workbench", { headers });
        expect({ status: unchanged.status, body: await unchanged.json() }).toMatchObject({ status: 200, body: {
          version: { draftRevision: 1 }, attachments: [], paymentTerms: null,
          directPendingInput: { state: "incomplete" }, directPendingCapabilities: { registrationEnabled: false }
        } });
      }
      changedPaperFact = null;
      identityLocks.length = 0;
      const response = await send();
      expect(identityLocks.slice(0, 2)).toEqual(["enterprise", "company"]);
      const saved = await response.json();
      expect({ status: response.status, body: saved }).toMatchObject({ status: 200, body: {
        draftRevision: 2, originalSignedNumber: " 原号  ", versionAmount: { amountYuan: "100.0054" },
        documentsOutdated: false, documentContentRevision: null, documentContentFingerprint: null, invalidation: { status: "unchanged" },
        directSigningInput: { state: "complete", inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          Q: { contract: { name: "对上签章合同", signedOn: "2026-11-08", originalSignedNumber: " 原号  " },
            tax: { defaultTaxRatePercent: "13.250000" },
            terms: { settlementText: "  按纸面结算  ", paymentTerms: { originalText: "  以纸面原文为准\n不自动拆分  " } },
            subjects: { company: { position: companyParty, companyEntityVersionId: companyVersionId, joinedCompanyEntityVersionId: joinedVersionId },
            enterprise: { position: enterpriseParty, assignmentId, businessPartyVersionId: enterpriseVersionId } },
            signedFiles: [{ fileId: firstFile, displayOrder: 0 }, { fileId: secondFile, displayOrder: 1 }] } }
      } });
      const read = await fetch(path + "/workbench", { headers });
      expect({ status: read.status, body: await read.json() }).toMatchObject({ status: 200, body: {
        directPendingInput: saved.directSigningInput, directPendingCapabilities: { registrationEnabled: false }
      } });
      for (const race of ["source", "subjects"] as const) {
        preparedInputRead = false;
        draftRevisionRace = race;
        const stalePreparation = await fetch(path + "/workbench", { headers });
        draftRevisionRace = null;
        const body = await stalePreparation.json();
        expect({ race, status: stalePreparation.status, body }).toMatchObject({
          race, status: 200, body: {
            directPendingInput: { state: "unavailable", Q: null, inputSha256: null },
            directPendingCapabilities: { registrationEnabled: false }, draftOperationAvailableActions: []
          }
        });
        expect(body).not.toHaveProperty("upwardDraftSubjects");
        await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: { draftRevision: 2 } });
      }

      const replay = await send();
      expect({ status: replay.status, body: await replay.json() }).toEqual({ status: 200, body: saved });
      const receipt = await fetch(path + "/save-requests/" + input.idempotencyKey, { headers });
      expect({ status: receipt.status, body: await receipt.json() }).toEqual({ status: 200, body: { status: "saved", result: saved, latestRevision: 2 } });
      expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(1);

      // A scoped position preserves the generic route role but not original-file access.
      await server.store.prisma.userPosition.deleteMany({ where: { userId: "staff", projectId: null } });
      await server.store.prisma.userPosition.create({ data: { userId: "staff", positionId: "contract_staff", projectId } });
      await server.store.prisma.projectMember.deleteMany({ where: { projectId, userId: "staff", positionKey: "contract_staff" } });
      const revokedWorkbench = await fetch(path + "/workbench", { headers });
      expect({ status: revokedWorkbench.status, body: await revokedWorkbench.json() }).toMatchObject({
        status: 200, body: { directPendingInput: { state: "unavailable", Q: null } }
      });
      const auditBeforeRevokedReplay = await server.store.prisma.auditLog.count();
      const receiptPath = path + "/save-requests/" + input.idempotencyKey;
      const [deniedRead, deniedReplay] = await Promise.all([fetch(receiptPath, { headers }), send()]);
      expect({ read: deniedRead.status, replay: deniedReplay.status }).toEqual({ read: 403, replay: 403 });
      expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(1);
      expect(await server.store.prisma.auditLog.count()).toBe(auditBeforeRevokedReplay);
      expect(await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } })).toMatchObject({ draftRevision: 2 });

      await server.store.prisma.projectMember.create({ data: { projectId, userId: "staff", positionKey: "contract_staff" } });
      const restoredRead = await fetch(receiptPath, { headers });
      expect({ status: restoredRead.status, body: await restoredRead.json() }).toEqual({
        status: 200, body: { status: "saved", result: saved, latestRevision: 2 }
      });
      const restoredReplay = await send();
      expect({ status: restoredReplay.status, body: await restoredReplay.json() }).toEqual({ status: 200, body: saved });
      expect(await server.store.prisma.contractDraftSaveRequest.count()).toBe(1);
      expect(await server.store.prisma.auditLog.count()).toBe(auditBeforeRevokedReplay);
      const terms = await server.store.prisma.paymentTermsVersion.findFirst({ where: { contractVersionId: versionId } });
      identityLocks.length = 0;
      const retained = await send({ ...input, idempotencyKey: id(), expectedRevision: 2,
        draft: { ...input.draft, draftData: { ...input.draft.draftData,
          directSigningInput: { ...input.draft.draftData.directSigningInput, companyParticipationId: participationId,
            fixedPaymentTermsVersionId: terms?.id } } } });
      expect({ status: retained.status, body: await retained.json() }).toMatchObject({ status: 200, body: { draftRevision: 3 } });
      expect(identityLocks).toEqual(["company"]);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally {
      await server.app.close();
      jest.useRealTimers();
    }
  });
});
