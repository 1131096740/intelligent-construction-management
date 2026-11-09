import type { createTemplateTestServer } from "./template-management.test-support";

type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;

/** Independent declarations of the expected catalog fields, not a SQL or trigger simulator. */
export async function seedDirectArchiveRetentionCatalog(server: Server) {
  const relations = {
    jg_contract_direct_archive_retention_binding_v1: "29701", FileObject: "21001",
    ContractArchiveFile: "29702", ContractArchiveEvidenceFile: "29703"
  };
  const triggerRoutine = { owner: "9001", namespace: "2200", securityDefiner: false,
    language: "plpgsql", returnType: "2279", volatility: "v", parallel: "u", strict: false, returnsSet: false,
    configuration: ["search_path=pg_catalog, pg_temp"], noPublicExecute: true, acl: ["sealed-acl"] };
  const routines = {
    jg_guard_contract_direct_archive_retention_binding_v1: { ...triggerRoutine, oid: "29704", sha: "167157e946edc0539ce6136797ac9a1787bb02239bf06997f8b65a85ed161391" },
    jg_protect_contract_direct_archive_file_v1: { ...triggerRoutine, oid: "29705", sha: "8c6801d789cdf60419d6e5d2239110197f164dabab444ef96f2e50c8ec88e40b" },
    jg_require_contract_direct_archive_complete_v1: { ...triggerRoutine, oid: "29706", sha: "326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5" },
    jg_protect_contract_direct_review_file_v1: { ...triggerRoutine, oid: "22005", sha: "6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20" },
    jg_contract_archive_v2_complete_guard: { ...triggerRoutine, oid: "29707", sha: "e5160f237f28b182b58fdeec44da8b06e3c77150b7a6bb4fdbd101c6f3c41e29", configuration: ["search_path=pg_catalog, public"] },
    jg_contract_direct_archive_proof_v1: { ...triggerRoutine, oid: "29708", sha: "4c24e5aa811a8b9c98897377987dd59e4baf3d4d6cf323f049eac77c68a8b00f", returnType: "3802", volatility: "s", strict: true },
    jg_contract_direct_archive_request_sha_v1: { ...triggerRoutine, oid: "29709", sha: "f3e329de50e81169c974f55e6c0a965237372f47c2af950c12c8e1d406294cbf", language: "sql", returnType: "25", volatility: "i", parallel: "s", strict: true }
  };
  const trigger = (oid: string, relation: string, routine: string, type: number, deferred = false) => ({
    oid, relation, routine, type, deferred, initiallyDeferred: deferred, enabled: "O", condition: false, internal: false, columns: [], args: ""
  });
  const fileTrigger = trigger("29712", "21001", "29705", 31);
  const triggers = {
    jg_direct_archive_retention_binding_immutable: trigger("29710", "29701", "29704", 31),
    jg_direct_archive_retention_binding_no_truncate: trigger("29711", "29701", "29704", 34),
    FileObject_contract_direct_archive_retention_v1: fileTrigger,
    FileObject_contract_direct_review_retention_v1: trigger("23005", "21001", "22005", 31),
    ContractArchiveFile_direct_complete_v1: trigger("29713", "29702", "29706", 5, true),
    ContractArchiveEvidenceFile_direct_complete_v1: trigger("29714", "29703", "29706", 5, true),
    ContractArchiveFile_v2_complete: trigger("29715", "29702", "29707", 5, true),
    ContractArchiveEvidenceFile_v2_complete: trigger("29716", "29703", "29707", 5, true)
  };
  const coordinates = { applicationRoleOid: "7001", databaseOid: "13000", anchorOwnerOid: "9001",
    preparationRelationOid: "29501", preparationSha256: "6".repeat(64) };
  const bindings = { relations, routines, triggers };
  const binding = { protocolVersion: 1, recipeVersion: "contract-direct-archive-retention-v1/1", ...coordinates, bindings };
  const actual = { ...coordinates, bindings, triggerCount: 8, registryQualified: true, applicationCompletionReads: true,
    fileCallers: [{ roleOid: "7001", exactReads: true, executable: true }, { roleOid: "9001", exactReads: true, executable: true }],
    currentRoleOid: "7001", sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001" };
  const probe = await server.store.table("directArchiveRetentionProbe").create({ data: { snapshot: {
    relationOid: "29701", routineCount: 3, triggerCount: 5
  } } });
  const installed = await server.store.table("directArchiveRetentionBinding").create({ data: { snapshot: binding } });
  const observed = await server.store.table("directArchiveRetentionActual").create({ data: { snapshot: actual } });
  return { probe, installed, observed, binding, actual, fileTrigger };
}

export async function addDirectArchiveRetentionToReviewCatalog(server: Server, fileTrigger: object) {
  const old = await server.store.table("directReviewActualCatalog").findFirst();
  if (!old?.snapshot || typeof old.snapshot !== "object" || !("triggers" in old.snapshot)
    || !old.snapshot.triggers || typeof old.snapshot.triggers !== "object") throw new Error("合成206目录缺失");
  await server.store.table("directReviewActualCatalog").update({ where: { id: old.id }, data: {
    snapshot: { ...old.snapshot, triggerCount: 12,
      triggers: { ...old.snapshot.triggers, FileObject_contract_direct_archive_retention_v1: fileTrigger } }
  } });
}


export async function observeDirectArchiveCompletionBody(server: Server, retention: Awaited<ReturnType<typeof seedDirectArchiveRetentionCatalog>>) {
  const completion = "jg_contract_archive_v2_complete_guard";
  const attached = { ...retention.binding.bindings.routines[completion],
    sha: "5e408b07516786874983ebdaea2d9c526d7056290df422ccc0861176445305ca" };
  await server.store.table("directArchiveRetentionActual").update({ where: { id: retention.observed.id }, data: {
    snapshot: { ...retention.actual, bindings: { ...retention.actual.bindings,
      routines: { ...retention.actual.bindings.routines, [completion]: attached }
    } }
  } });
}

/** Separate fixture rows supply the installed and current deferred completion catalog. */
export async function seedDirectArchiveCompletionCatalog(server: Server) {
  const identity = { applicationRoleOid: "7001", databaseOid: "13000", namespaceOid: "2200", anchorOwnerOid: "9001" };
  const links = { retentionOid: "29701", retentionSha: "2".repeat(64), dispatchOid: "29801", dispatchSha: "3".repeat(64) };
  const original = { prosecdef: false, proconfig: ["search_path=pg_catalog, public"] };
  const bindings = {
    procedures: {
      completion: { ...original, oid: "29707", sha256: "5e408b07516786874983ebdaea2d9c526d7056290df422ccc0861176445305ca" },
      manifest: { ...original, oid: "29904", sha256: "ba4b6cc4fe752c03bc742760f7cb2c818ace1c4c95184504206ee1c8c00d0309" },
      registry: { prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"],
        oid: "29905", sha256: "d4be6bb841d6459e13537724ac423592f8db8ebd53df51a62a0e51a9fcfdd1a5" }
    },
    registryTriggers: { jg_direct_archive_completion_binding_immutable: "29906", jg_direct_archive_completion_binding_no_truncate: "29907" }
  };
  const binding = { ...identity, protocolVersion: 1, recipeVersion: "contract-direct-archive-completion-dispatch-v1/1", links, bindings };
  const actual = { ...identity, relationOid: "29901", links, bindings, registryQualified: true, guardsClosed: true,
    currentRoleOid: "7001", sessionRoleOid: "7001", backendPid: 71201, transactionId: "500001" };
  const probe = await server.store.table("directArchiveCompletionProbe").create({ data: {
    snapshot: { relationOid: "29901", routineCount: 1, triggerCount: 2 }
  } });
  await server.store.table("directArchiveCompletionBinding").create({ data: { snapshot: binding } });
  const observed = await server.store.table("directArchiveCompletionActual").create({ data: { snapshot: actual } });
  return { probe, observed, actual };
}
