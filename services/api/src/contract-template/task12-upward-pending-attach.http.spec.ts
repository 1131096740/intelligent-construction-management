import { Prisma } from "@prisma/client";
import { seedDirectArchiveDispatchCatalog } from "./task12-direct-archive-dispatch.oracle";
import { seedDirectArchiveRetentionCatalog } from "./task12-direct-archive-retention.oracle";
import { seedDirectReviewDatabaseBinding } from "./task12-direct-review-persistence.oracle";
import { openDirectPendingDraft, seedPreparedDirectArchiveTransition } from "./task12-direct-pending.test-support";
import { createTemplateTestServer } from "./template-management.test-support";

describe("任务12 对上创建接线保留旧表外读取", () => {
  it("只有真实后态版本体和同事务接线见证吻合时才保留原表外读取", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await openDirectPendingDraft(server);
      await seedDirectReviewDatabaseBinding(server);
      await seedPreparedDirectArchiveTransition(server);
      await seedDirectArchiveRetentionCatalog(server);
      const direct = await seedDirectArchiveDispatchCatalog(server);
      const lookup = () => fetch(draft.base + draft.path + "/workbench", { headers: draft.headers });
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ protocolVersion: 1, state: "incomplete" });

      const row = await server.store.table("directPendingActualCatalog").findFirst();
      if (!row) throw new Error("合成表外现态缺失");
      const actual = row.snapshot as { routines: Record<string, { oid: string; bodySha256: string }> };
      const versionGuard = "public.jg_contract_direct_pending_version_guard_v1()";
      const newBody = "522410b9ebe38ea3e7e59861aa74dd39616cd3231615c40f02ab2d6ab1b36e93";
      await server.store.table("directPendingActualCatalog").update({ where: { id: row.id }, data: {
        snapshot: { ...actual, routines: { ...actual.routines, [versionGuard]: { ...actual.routines[versionGuard], bodySha256: newBody } } }
      } });

      const predecessor = "f".repeat(64);
      const witness = {
        databaseOid: "13000", namespaceOid: "2200", ownerOid: "9001", applicationRoleOid: "7001", sessionRoleOid: "7001",
        bindingOid: String(direct.actual.links.pendingOid), createBindingOid: "41999", helperOid: "42001",
        backendPid: 71201, transactionId: "500001", triggerCount: 3, createBindingTriggerCount: 2,
        directDispatchSha256: predecessor, versionBody: newBody, dispatchBindingOid: "29801",
        versionRoutineOid: actual.routines[versionGuard].oid,
        versionTriggerOid: direct.actual.triggers.jg_direct_pending_version_shape.oid,
        attachmentTriggerOid: (row.snapshot as { triggers: Record<string, { oid: string }> }).triggers.jg_direct_pending_attachment_source.oid,
        attachmentBody: "75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1",
        bindingBody: "5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d",
        helperBody: "367527eea9629755f1ef287c36a52a76f9b768ac86bbaa475aa0422a564944be",
        createBindingBody: "1596a00b04dd2907b229d7ae1a4c53645d0c3f9d6837fef5c6396cda0707bd26",
        createBindingSha256: "c".repeat(64), safeRole: true, privateExecute: true, privateRegistryRead: true, bindingShape: true
      };
      let current: typeof witness | null = null;
      let saveWitness: Record<string, unknown> | null = null;
      let slotBody: string | null = null;
      const queryRaw = server.store.prisma.$queryRaw;
      server.store.prisma.$queryRaw = async (input, ...bindings) => {
        const query = "strings" in input ? input : Prisma.sql(input, ...bindings);
        const sql = query.strings.join("?").trimStart();
        if (sql.startsWith("/* contract_upward_pending_create_catalog_v1 */")) return current ? [current] : [];
        if (sql.startsWith("/* contract_upward_pending_save_catalog_v1 */")) return saveWitness ? [saveWitness] : [];
        if (sql.startsWith("/* contract_direct_archive_dispatch_catalog_v1 */")) {
          const rows = await queryRaw(input, ...bindings);
          return rows.map(row => {
            const previous = row.actual as { helpers: Record<string, Record<string, unknown>> };
            const slot = "public.jg_guard_contract_direct_archive_slot_v1()";
            return { ...row, actual: { ...previous, dispatchRowSha256: predecessor,
              helpers: slotBody ? { ...previous.helpers, [slot]: { ...previous.helpers[slot], bodySha256: slotBody } } : previous.helpers } };
          });
        }
        return queryRaw(input, ...bindings);
      };
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      current = witness;
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ protocolVersion: 1, state: "incomplete", Q: null });
      for (const bad of [
        { ...witness, directDispatchSha256: "a".repeat(64) },
        { ...witness, versionRoutineOid: "40001" },
        { ...witness, versionTriggerOid: "40002" },
        { ...witness, attachmentTriggerOid: "40003" },
        { ...witness, transactionId: "500002" },
        { ...witness, privateRegistryRead: false },
        { ...witness, bindingShape: false }
      ]) {
        current = bad;
        expect((await (await lookup()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      }
      const saveVersionBody = "bbf5b477e867355798c5b99f4c7919baccfbfe7888811eaefccb9ab88a737e9f";
      const saveAttachmentBody = "0a0b17642f39c96064f1184fcd03e4151569136c385b2ea0d94ff67dbc5963cf";
      slotBody = "86dddd478fb66809deaae6875e46e2ed29436824497114d7c7a66e46403fe999";
      const attachment = "public.jg_contract_direct_pending_attachment_guard_v1()";
      const oldTriggers = (row.snapshot as { triggers: Record<string, { oid: string }> }).triggers;
      const createBindingSha256 = "c".repeat(64);
      current = { ...witness, versionBody: saveVersionBody, attachmentBody: saveAttachmentBody, createBindingSha256 };
      await server.store.table("directPendingActualCatalog").update({ where: { id: row.id }, data: {
        snapshot: { ...actual, routines: { ...actual.routines,
          [versionGuard]: { ...actual.routines[versionGuard], bodySha256: saveVersionBody },
          [attachment]: { ...actual.routines[attachment], bodySha256: saveAttachmentBody } } }
      } });
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      saveWitness = {
        databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001", currentRoleOid: "7001", sessionRoleOid: "7001",
        bindingOid: "42001", createBindingOid: witness.createBindingOid, createBindingSha256,
        backendPid: 71201, transactionId: "500001", dualIdentityCheck: true, restrictedRole: true, privateTechnicalAcl: true,
        versionRoutineOid: actual.routines[versionGuard].oid, attachmentRoutineOid: actual.routines[attachment].oid,
        slotRoutineOid: direct.actual.helpers["public.jg_guard_contract_direct_archive_slot_v1()"].oid,
        routineBodies: { version: saveVersionBody, attachment: saveAttachmentBody, slot: slotBody,
          save: "ee7b3ccc522fa5b18f5212a54718729dd33e9a1713b3768747368a7b331efa50",
          binding: "637c42531d6e58ba08d3d5ec497ccd82874cbe0d713d0e249d794a3694755028",
          after: "1541911b049f700fbba33ee1d973fa43aab1577fa8490a7eea1c10e57cde6059",
          file: "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1",
          exclusive: "e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999" },
        triggerOids: { jg_direct_pending_version_shape: witness.versionTriggerOid,
          jg_direct_pending_attachment_source: witness.attachmentTriggerOid,
          ContractDraftAttachment_direct_archive_transfer_v1: direct.actual.triggers.ContractDraftAttachment_direct_archive_transfer_v1.oid,
          jg_upward_pending_save_binding_immutable: "42010", jg_upward_pending_save_binding_no_truncate: "42011",
          jg_upward_pending_save_persistent_proof: "42012",
          jg_direct_pending_file_retained: oldTriggers.jg_direct_pending_file_retained.oid,
          jg_direct_pending_attachment_exclusive: oldTriggers.jg_direct_pending_attachment_exclusive.oid }
      };
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ protocolVersion: 1, state: "incomplete" });
      const created = await fetch(draft.base + "/contracts", {
        method: "POST", headers: draft.headers, body: JSON.stringify({
          projectId: draft.projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase",
          relationship: "upward", handlingMode: "direct_signed"
        })
      });
      expect({ status: created.status, body: await created.json() }).toMatchObject({
        status: 201, body: { version: { status: "draft", signingSubjectType: "draft_unconfirmed", draftRevision: 1 } }
      });
      const savedSlotBody = slotBody;
      slotBody = null;
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      slotBody = savedSlotBody;
      saveWitness = { ...saveWitness, createBindingSha256: "d".repeat(64) };
      expect((await (await lookup()).json()).directPendingInput).toMatchObject({ state: "unavailable", Q: null });
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally {
      await server.app.close();
    }
  });
});
