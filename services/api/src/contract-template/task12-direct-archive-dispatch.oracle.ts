import type { createTemplateTestServer } from "./template-management.test-support";

type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;
type Row = Record<string, unknown>;

function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("合成214目录前置缺失");
  return value as Row;
}

/** Independent before/after catalog snapshots. No database operation is simulated. */
export async function seedDirectArchiveDispatchCatalog(server: Server) {
  const pendingCatalog = await server.store.table("directPendingActualCatalog").findFirst();
  const pendingBootstrap = await server.store.table("directPendingBindingCatalog").findFirst();
  if (!pendingCatalog || !pendingBootstrap) throw new Error("合成205目录前置缺失");
  const legacy = row(pendingCatalog.snapshot);
  const legacyRoutines = row(legacy.routines), legacyRelations = row(legacy.relations), legacyTriggers = row(legacy.triggers);
  const versionSignature = "public.jg_contract_direct_pending_version_guard_v1()";
  const parentSignature = "public.jg_contract_archive_v2_parent_guard()";
  const postRoutines = {
    [parentSignature]: { ...row(legacyRoutines[parentSignature]), bodySha256: "f9de843279039250da6f56cc481d8d1f80e247431c7060aa637821a7bae7eff8" },
    [versionSignature]: { ...row(legacyRoutines[versionSignature]), bodySha256: "82b74ba31f58fbec7e9365966e5551f67169ec8a8a70b26f6c96f7f3a01e550e" }
  };
  const relations = {
    bindingOid: "29801", archiveOid: "29702", archiveTypeOid: "29820", versionTypeOid: "29821",
    versionOid: row(legacyRelations.ContractVersion).oid, slotOid: row(legacyRelations.ContractDraftAttachment).oid
  };
  const common = { proowner: "9001", pronamespace: "2200", prokind: "f", prosecdef: false, proretset: false,
    provolatile: "v", proparallel: "u", proconfig: ["search_path=pg_catalog, pg_temp"], proacl: ["sealed-acl"], language: "plpgsql" };
  const helpers = {
    "public.jg_assert_contract_direct_archive_write_profile_v1()": { ...common, oid: "29803", prorettype: "3802", proisstrict: false,
      bodySha256: "aefd46b1516b7905971112abbbbf795ad4560f74e975be3ee99f076f2ee93616" },
    'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")': { ...common, oid: "29804", prorettype: "29820", proisstrict: true,
      bodySha256: "8fa9e8b88c4a9334658b05f8f0bf0e9b370df1ed0eceb3887d72c35dd95c802d" },
    "public.jg_require_contract_direct_archive_transition_profile_v1()": { ...common, oid: "29805", prorettype: "3802", proisstrict: false,
      bodySha256: "45ea86eac1ba402cfe41b007f164bb876fa3749a0c10d164abfa436b1cba1b0b" },
    'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")': {
      ...common, oid: "29806", prorettype: "29821", proisstrict: true, bodySha256: "c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157" },
    "public.jg_guard_contract_direct_archive_slot_v1()": { ...common, oid: "29807", prorettype: "2279", proisstrict: false,
      bodySha256: "cc7b0b876f7f396ed11d3b6f583af25c106b2ef967244648a93c730233efdf8b" },
    "public.jg_guard_contract_direct_archive_dispatch_binding_v1()": { ...common, oid: "29808", prorettype: "2279", proisstrict: false,
      bodySha256: "40831a77884f198d09985af3317cf396c706e21161e45e5fb2e042ebe776e8e8" }
  };
  const trigger = (id: number, table: unknown, routine: unknown, type: number) => ({
    oid: String(id), tgrelid: String(table), tgfoid: String(routine), tgtype: type, tgenabled: "O",
    tgisinternal: false, tgdeferrable: false, tginitdeferred: false, tgnargs: 0, tgattr: "", tgargs: "", tgqual: null
  });
  const triggers = {
    ContractArchiveFile_v2_immutable: trigger(29810, relations.archiveOid, row(postRoutines[parentSignature]).oid, 31),
    jg_direct_pending_version_shape: trigger(Number(row(legacyTriggers.jg_direct_pending_version_shape).oid),
      relations.versionOid, row(postRoutines[versionSignature]).oid, 23),
    ContractDraftAttachment_direct_archive_transfer_v1: trigger(29811, relations.slotOid, 29807, 31),
    jg_direct_archive_dispatch_binding_immutable: trigger(29812, relations.bindingOid, 29808, 31),
    jg_direct_archive_dispatch_binding_no_truncate: trigger(29813, relations.bindingOid, 29808, 34)
  };
  const identity = { applicationRoleOid: "7001", databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001" };
  const links = { pendingOid: row(pendingBootstrap.snapshot).bindingRelationOid, pendingSha: "8".repeat(64),
    prepareOid: "29501", prepareSha: "6".repeat(64), retentionOid: "29701", retentionSha: "2".repeat(64) };
  const installed = { ...identity, protocolVersion: 1, recipeVersion: "contract-direct-archive-dispatch-v1/1",
    links, bindings: { routines: postRoutines, helpers, triggers } };
  const actual = { ...identity, links, helpers, triggers, relations, triggerCount: 5, registryQualified: true,
    legacySlotReads: true, applicationSlotReads: true, helpersPrivate: true, currentRoleOid: "7001", sessionRoleOid: "7001",
    backendPid: 71201, transactionId: "500001" };
  await server.store.table("directArchiveDispatchProbe").create({ data: {
    snapshot: { relationOid: "29801", slotTriggerCount: 1, bindingRoutineCount: 1 }
  } });
  await server.store.table("directArchiveDispatchBinding").create({ data: { snapshot: installed } });
  const observation = await server.store.table("directArchiveDispatchActual").create({ data: { snapshot: actual } });
  await server.store.table("directPendingActualCatalog").update({ where: { id: pendingCatalog.id }, data: {
    snapshot: { ...legacy, routines: { ...legacyRoutines, ...postRoutines } }
  } });
  return { actual, observation, oldCatalogId: pendingCatalog.id, oldCatalogSnapshot: legacy };
}
