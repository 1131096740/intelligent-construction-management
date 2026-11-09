import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

describe("任务12 对上直签创建资格", () => {
  it("只在当前事务具有已安装的对上资格时创建待登记草稿", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const projectId = randomUUID();
      await server.store.prisma.project.create({
        data: { id: projectId, code: "T12-UPWARD-CREATE", name: "对上创建合成项目", isActive: true }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId, userId: "staff", positionKey: "contract_staff" }
      });
      const observed = {
        databaseOid: "13000", namespaceOid: "2200", ownerOid: "9001", applicationRoleOid: "7001", sessionRoleOid: "7001",
        bindingOid: "10024", createBindingOid: "41999", helperOid: "42001", backendPid: 71201,
        directDispatchSha256: "f".repeat(64), transactionId: "500002", triggerCount: 3, createBindingTriggerCount: 2,
        dispatchBindingOid: "41998", versionTriggerOid: "30002", versionRoutineOid: "20002", attachmentTriggerOid: "30003",
        createBindingBody: "1596a00b04dd2907b229d7ae1a4c53645d0c3f9d6837fef5c6396cda0707bd26",
        versionBody: "522410b9ebe38ea3e7e59861aa74dd39616cd3231615c40f02ab2d6ab1b36e93",
        attachmentBody: "75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1",
        bindingBody: "5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d",
        helperBody: "367527eea9629755f1ef287c36a52a76f9b768ac86bbaa475aa0422a564944be",
        safeRole: true, privateExecute: true, privateRegistryRead: true, bindingShape: true
      };
      const marker = { protocolVersion: 2, source: "direct_signed", relationship: "upward", signedOn: null,
        enterpriseParty: null, companyParty: null, companyParticipationId: null, fixedPaymentTermsVersionId: null };
      let observations = [observed];
      let reads = 0;
      const current = server.store.prisma.$queryRaw;
      server.store.prisma.$queryRaw = async (input, ...bindings) => {
        const query = "strings" in input ? input : Prisma.sql(input, ...bindings);
        if (query.strings.join("?").trimStart().startsWith("/* contract_upward_pending_create_catalog_v1 */")) {
          expect(query.values).toEqual([]);
          return [observations[Math.min(reads++, observations.length - 1)]];
        }
        return current(input, ...bindings);
      };
      const createVersion = server.store.prisma.contractVersion.create;
      let writeAttempts = 0;
      server.store.prisma.contractVersion.create = async ({ data }) => {
        // Synthetic persistence independently models the detached row guard's first-insert shape.
        writeAttempts += 1;
        expect(data).toMatchObject({
          versionNo: 1, changeType: "original", status: "draft", signingSubjectType: "draft_unconfirmed",
          numericProtocolVersion: 2, amountCents: 0n, amountYuan: null, taxFactStatus: "draft",
          businessTemplateVersionId: null, layoutTemplateVersionId: null,
          draftData: { directSigningInput: marker, contractBasics: { relationship: "upward", businessType: "material_purchase" } }
        });
        const parent = await server.store.prisma.contract.findUnique({ where: { id: data.contractId } });
        expect(parent).toMatchObject({ projectId, ownerUserId: "staff", code: null, name: "", counterparty: "" });
        expect(await server.store.prisma.contractVersion.count({ where: { contractId: data.contractId } })).toBe(0);
        return createVersion({ data });
      };
      const send = async (extra = {}) => fetch((await server.app.getUrl()) + "/contracts", {
        method: "POST",
        headers: { authorization: "Bearer " + await loginTemplateActor(server, "staff"), "content-type": "application/json" },
        body: JSON.stringify({ projectId, numericProtocolVersion: 2, relationship: "upward",
          handlingMode: "direct_signed", contractTypeKey: "material_purchase", ...extra })
      });

      for (const bad of [
        { ...observed, versionBody: "82b74ba31f58fbec7e9365966e5551f67169ec8a8a70b26f6c96f7f3a01e550e" },
        { ...observed, attachmentBody: "0".repeat(64) },
        { ...observed, triggerCount: 2 },
        { ...observed, createBindingTriggerCount: 1 },
        { ...observed, createBindingBody: "0".repeat(64) },
        { ...observed, directDispatchSha256: "" },
        { ...observed, sessionRoleOid: "7002" },
        { ...observed, privateExecute: false }
      ]) {
        observations = [bad];
        reads = 0;
        expect((await send()).status).toBe(503);
      }
      expect(writeAttempts).toBe(0);
      observations = [observed, observed, { ...observed, transactionId: "500003" }];
      reads = 0;
      expect((await send()).status).toBe(503);
      expect(writeAttempts).toBe(1);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.contractBill.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);

      observations = [observed];
      reads = 0;
      expect((await send({ paymentTermsOriginalText: "不能创建时混写" })).status).toBe(400);
      expect(reads).toBe(0);
      const response = await send();
      const created = await response.json();
      expect({ status: response.status, body: created }).toMatchObject({
        status: 201,
        body: { terms: null, version: { status: "draft", signingSubjectType: "draft_unconfirmed",
          numericProtocolVersion: 2, amountYuan: null, originalSignedNumber: null,
          draftData: { directSigningInput: { protocolVersion: 2, source: "direct_signed", relationship: "upward",
            signedOn: null, enterpriseParty: null, companyParty: null, companyParticipationId: null, fixedPaymentTermsVersionId: null
          } }
        } }
      });
      expect(reads).toBe(3);
      expect(writeAttempts).toBe(2);
      const versionPath = (await server.app.getUrl()) + "/contract-drafts/" + created.version.id;
      const headers = { authorization: "Bearer " + await loginTemplateActor(server, "staff"), "x-contract-numeric-protocol": "2" };
      const workbench = await fetch(versionPath + "/workbench", { headers });
      expect({ status: workbench.status, body: await workbench.json() }).toMatchObject({
        status: 200,
        body: { directPendingInput: { protocolVersion: 2, Q: null, inputSha256: null },
          directPendingCapabilities: { registrationEnabled: false }, draftOperationAvailableActions: [] }
      });
      expect((await fetch(versionPath + "/edit-lease", { method: "POST", headers })).status).toBe(503);
      expect(await server.store.prisma.contractDraftEditLease.count()).toBe(0);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(1);
      expect(await server.store.prisma.contractVersion.count()).toBe(1);
      expect(await server.store.prisma.contractBill.count()).toBe(1);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(1);
      expect(await server.store.prisma.paymentTermsVersion.count()).toBe(0);
      expect(await server.store.prisma.contractDraftAttachment.count()).toBe(0);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally {
      await server.app.close();
    }
  });
});
