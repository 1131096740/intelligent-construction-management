import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { seedDirectPendingDatabaseBinding } from "./task12-direct-pending.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

describe("任务12 对上直签待登记持久读取", () => {
  it("通过现有工作台读取单独的对上来源，缺资格时保留草稿并关闭写动作", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const projectId = randomUUID();
      const contractId = randomUUID();
      const versionId = randomUUID();
      await server.store.prisma.project.create({
        data: { id: projectId, code: "T12-UPWARD-READ", name: "对上来源合成项目", isActive: true }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId, userId: "staff", positionKey: "contract_staff" }
      });
      await server.store.prisma.contract.create({
        data: { id: contractId, projectId, ownerUserId: "staff", contractTypeKey: "material_purchase" }
      });
      // A deliberately staged persisted mock row. The 205 trigger still rejects inserting it.
      await server.store.prisma.contractVersion.create({
        data: { id: versionId, contractId, versionNo: 1, changeType: "original", status: "draft",
          numericProtocolVersion: 2, draftRevision: 3, signingSubjectType: "draft_unconfirmed",
          draftData: { contractBasics: { relationship: "upward" }, directSigningInput: {
            protocolVersion: 2, source: "direct_signed", relationship: "upward", signedOn: null,
            enterpriseParty: null, companyParty: null, companyParticipationId: null, fixedPaymentTermsVersionId: null
          } }
        }
      });
      const response = await fetch((await server.app.getUrl()) + "/contract-drafts/" + versionId + "/workbench", {
        headers: {
          authorization: "Bearer " + await loginTemplateActor(server, "staff"),
          "x-contract-numeric-protocol": "2"
        }
      });
      expect({ status: response.status, body: await response.json() }).toMatchObject({
        status: 200,
        body: {
          directPendingInput: { protocolVersion: 2, sourceKind: "upward_direct_signed_pending",
            state: "unavailable", Q: null, inputSha256: null },
          directPendingCapabilities: { registrationEnabled: false, copyEnabled: false, purgeEnabled: false },
          draftOperationAvailableActions: []
        }
      });
    } finally {
      await server.app.close();
    }
  });

  it("只有同项目、在期的签署双方与有序原件可以得到精确摘要", async () => {
    jest.useFakeTimers({
      doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate",
        "setTimeout", "clearTimeout", "setInterval", "clearInterval"]
    });
    jest.setSystemTime(new Date("2026-11-08T16:00:00.000Z"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const projectId = randomUUID(), contractId = randomUUID(), versionId = randomUUID();
      const companyId = randomUUID(), companyVersionId = randomUUID(), joinedVersionId = randomUUID(), participationId = randomUUID();
      const enterpriseId = randomUUID(), enterpriseVersionId = randomUUID(), assignmentId = randomUUID(), cpsId = randomUUID();
      const firstFileId = randomUUID(), secondFileId = randomUUID();
      const enterpriseParty = { roleKey: "party_b", displayOrder: 0 };
      const companyParty = { roleKey: "party_a", displayOrder: 0 };

      await server.store.prisma.project.create({
        data: { id: projectId, code: "T12-UPWARD-SOURCE", name: "真实位置合成项目", isActive: true }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId, userId: "staff", positionKey: "contract_staff" }
      });
      await server.store.prisma.contract.create({
        data: { id: contractId, projectId, ownerUserId: "staff", companyEntityId: companyId,
          name: "合成对上合同", contractTypeKey: "material_purchase" }
      });
      await server.store.prisma.contractVersion.create({
        data: { id: versionId, contractId, versionNo: 1, changeType: "original", status: "draft",
          numericProtocolVersion: 2, draftRevision: 3, signingSubjectType: "upward",
          companyEntityIdSnapshot: companyId, companyEntityVersionId: companyVersionId,
          affiliateAssignmentId: assignmentId, affiliateBusinessPartyVersionId: enterpriseVersionId,
          draftData: { contractBasics: { relationship: "upward" }, directSigningInput: {
            protocolVersion: 2, source: "direct_signed", relationship: "upward", signedOn: null,
            enterpriseParty, companyParty, companyParticipationId: participationId, fixedPaymentTermsVersionId: null
          } }
        }
      });

      // Fixed simulated catalog/proof observations, independent from the runtime recipe.
      const catalog = { oid: "31100", namespaceOid: "2200", ownerOid: "9001",
        bodySha256: "5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4",
        definer: false, settings: ["search_path=pg_catalog, public"], volatility: "s", parallel: "u", strict: false,
        returnsSet: false, language: "plpgsql", returnsJsonb: true, plainRoutine: true, currentRoleOid: "7001",
        sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001", sameDatabase: true,
        privateExecute: true, sourceTables: true };
      const q = {
        inputProtocolVersion: 2, source: { kind: "direct_signed", relationship: "upward" },
        locator: { projectId, contractId, contractVersionId: versionId, draftRevision: 3, versionNo: 1, changeType: "original" },
        contract: { businessType: "material_purchase", name: "合成对上合同", originalSignedNumber: " 原号  ", signedOn: null },
        money: { numericProtocolVersion: 2, amountYuan: "100.0054", amountLimitType: "capped",
          pricingNature: "fixed_total", amountSource: "manual" },
        tax: { amountBasis: "tax_inclusive", invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null },
        terms: { settlementText: "", paymentTerms: null },
        subjects: {
          enterprise: { projectId, position: enterpriseParty, cpsId, assignmentId, businessPartyId: enterpriseId,
            businessPartyVersionId: enterpriseVersionId, name: "施工企业", creditCode: null,
            effectiveFrom: "2026-11-08T16:00:00.000Z", endedAt: "2026-11-09T16:00:00.000Z" },
          company: { projectId, position: companyParty, participationId, companyEntityId: companyId,
            companyEntityVersionId: companyVersionId, joinedCompanyEntityVersionId: joinedVersionId,
            name: "实际我方", creditCode: "91590000123456789X", address: null, effectiveFrom: "2026-11-09", endedAt: "2026-11-10" }
        },
        signedFiles: [
          { fileId: firstFileId, displayOrder: 0, mimeType: "application/pdf", sizeBytes: 100, contentSha256: "a".repeat(64) },
          { fileId: secondFileId, displayOrder: 1, mimeType: "image/jpeg", sizeBytes: 101, contentSha256: "b".repeat(64) }
        ]
      };
      const qText = JSON.stringify(q);
      const independentDigest = createHash("sha256").update(qText).digest("hex");
      let catalogObserved = catalog;
      let observation: unknown;
      let probeReads = 0;
      const makeObservation = (value: unknown) => {
        const text = JSON.stringify(value);
        return { Q: value, qText: text, inputSha256: createHash("sha256").update(text).digest("hex") };
      };
      observation = { Q: q, qText, inputSha256: independentDigest };
      const existing = server.store.prisma.$queryRaw;
      server.store.prisma.$queryRaw = async (input, ...bindings) => {
        const query = "strings" in input ? input : Prisma.sql(input, ...bindings);
        const sql = query.strings.join("?").replace(/\s+/gu, " ").trim();
        if (sql.startsWith("/* contract_upward_pending_catalog_v1 */")) {
          expect(query.values).toEqual(["13000"]);
          return [catalogObserved];
        }
        if (sql === "SELECT public.jg_contract_upward_pending_read_v1(?::pg_catalog.text,?::pg_catalog.text) AS input") {
          expect(query.values).toEqual([versionId, "staff"]);
          probeReads += 1;
          return [{ input: observation }];
        }
        return existing(input, ...bindings);
      };
      const read = async () => fetch((await server.app.getUrl()) + "/contract-drafts/" + versionId + "/workbench", {
        headers: { authorization: "Bearer " + await loginTemplateActor(server, "staff"), "x-contract-numeric-protocol": "2" }
      });

      const exact = await read();
      expect({ status: exact.status, body: await exact.json() }).toMatchObject({
        status: 200, body: {
          directPendingInput: { protocolVersion: 2, state: "complete", Q: q, inputSha256: independentDigest, sourceRevision: 3 },
          directPendingCapabilities: { registrationEnabled: false }, draftOperationAvailableActions: []
        }
      });
      expect(probeReads).toBe(1);
      const lease = await fetch((await server.app.getUrl()) + "/contract-drafts/" + versionId + "/edit-lease", {
        method: "POST", headers: { authorization: "Bearer " + await loginTemplateActor(server, "staff") }
      });
      expect(lease.status).toBe(503);
      expect(await server.store.prisma.contractDraftEditLease.count()).toBe(0);

      const cases = [
        { ...q, subjects: { ...q.subjects, enterprise: { ...q.subjects.enterprise, projectId: randomUUID() } } },
        { ...q, subjects: { ...q.subjects, enterprise: { ...q.subjects.enterprise, endedAt: "2026-11-08T16:00:00.000Z" } } },
        { ...q, subjects: { ...q.subjects, company: { ...q.subjects.company, endedAt: "2026-11-09" } } },
        { ...q, subjects: { ...q.subjects, company: { ...q.subjects.company, companyEntityVersionId: joinedVersionId } } },
        { ...q, subjects: { ...q.subjects, company: { ...q.subjects.company, position: enterpriseParty } } },
        { ...q, signedFiles: [...q.signedFiles].reverse() }
      ];
      for (const candidate of cases) {
        observation = makeObservation(candidate);
        const response = await read();
        expect({ status: response.status, body: await response.json() }).toMatchObject({
          status: 200, body: { directPendingInput: { state: "unavailable", Q: null, inputSha256: null } }
        });
      }
      observation = { Q: q, qText, inputSha256: "0".repeat(64) };
      expect((await (await read()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      observation = null;
      expect((await (await read()).json()).directPendingInput).toMatchObject({ state: "incomplete", Q: null });
      const beforeRejectedCatalog = probeReads;
      catalogObserved = { ...catalog, privateExecute: false };
      expect((await (await read()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      expect(probeReads).toBe(beforeRejectedCatalog);

      const version = await server.store.prisma.contractVersion.findUnique({ where: { id: versionId } });
      const draftData = version!.draftData as Prisma.JsonObject;
      const directSigningInput = draftData.directSigningInput as Prisma.JsonObject;
      await server.store.prisma.contractVersion.update({
        where: { id: versionId },
        data: { draftRevision: 4, draftData: {
          ...draftData, directSigningInput: { ...directSigningInput, enterpriseParty: companyParty, companyParty: enterpriseParty }
        } }
      });
      const reversedSides = { ...q, locator: { ...q.locator, draftRevision: 4 },
        contract: { ...q.contract, originalSignedNumber: null },
        money: { ...q.money, amountYuan: null },
        subjects: {
          enterprise: { ...q.subjects.enterprise, position: companyParty },
          company: { ...q.subjects.company, position: enterpriseParty }
        }
      };
      catalogObserved = catalog;
      const reversedObservation = makeObservation(reversedSides);
      observation = reversedObservation;
      expect((await (await read()).json()).directPendingInput).toMatchObject({
        state: "complete", sourceRevision: 4, Q: reversedSides, inputSha256: reversedObservation.inputSha256
      });
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally {
      await server.app.close();
      jest.useRealTimers();
    }
  });

});
