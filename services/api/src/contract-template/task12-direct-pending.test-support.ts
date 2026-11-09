import { DIRECT_PENDING_DB_RECIPE } from "../contract/contract-direct-pending-recipe";
import type { createTemplateTestServer } from "./template-management.test-support";

type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;
type RecordValue = Record<string, unknown>;

// Derived from PG16 ruleutils.c trigger worker, OpExpr and constant output.
// These literal observations deliberately do not use the production recipe.
const signedAttachmentDefinitions = [
  `CREATE TRIGGER jg_direct_pending_attachment_exclusive BEFORE INSERT OR UPDATE OF "fileId", "slotKey" ON public."ContractDraftAttachment" FOR EACH ROW WHEN ((new."slotKey" = 'direct_signed_originals_v1'::text)) EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true')`,
  `CREATE TRIGGER jg_direct_pending_attachment_exclusive BEFORE INSERT OR UPDATE OF "fileId", "slotKey" ON public."ContractDraftAttachment" FOR EACH ROW WHEN ((new."slotKey" = 'direct_signed_originals_v1'::text)) EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId', 'true')`,
] as const;

/** Synthetic installed object facts only. No role/SQL/permission is created. */
function declaredCatalogObjects(definitionForm: 0 | 1, replaceDefinition: (definition: string) => string) {
  const tables: Record<string, readonly string[]> = {};
  for (const [name, fields] of Object.entries(DIRECT_PENDING_DB_RECIPE.sourceReads)) tables[name] = fields;
  for (const [name, fields] of Object.entries({...DIRECT_PENDING_DB_RECIPE.attachmentReads,...DIRECT_PENDING_DB_RECIPE.legacyRetentionReads})) tables[name] = [...new Set([...(tables[name] ?? []), ...fields])];
  tables.jg_contract_direct_pending_binding_v1 = ["protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid","bindings"];
  const relations: Record<string, RecordValue> = {};
  for (const [index, [name, fields]] of Object.entries(tables).entries()) {
    const numeric = new Set(["amountYuan","defaultTaxRatePercent"]), integer = new Set(["versionNo","numericProtocolVersion","draftRevision","displayOrder","sizeBytes","protocolVersion"]);
    relations[name] = { oid: String(10000+index), namespaceOid: "2200", ownerOid: "9001", columns: fields.map((field, ordinal) => ({ name: field, number: ordinal+1,
      typeOid: numeric.has(field) ? "1700" : integer.has(field) ? "23" : field === "draftData" || field === "snapshot" || field === "bindings" ? "3802" : field === "effectiveFrom" ? "1114" : "25",
      notNull: name === "jg_contract_direct_pending_binding_v1", generated: "", identity: "" })) };
  }
  const routines: Record<string, RecordValue> = {};
  for (const [index, descriptor] of DIRECT_PENDING_DB_RECIPE.routines.entries()) routines[descriptor.signature] = { oid: String(20000+index), namespaceOid: "2200", ownerOid: "9001",
    bodySha256: descriptor.bodySha256, securityDefiner: descriptor.securityDefiner, configuration: descriptor.searchPath === null ? null : [`search_path=${descriptor.searchPath.join(", ")}`], acl: ["synthetic-exact-acl"],
    language: descriptor.language, returnType: descriptor.returnType, volatility: descriptor.volatility, parallel: descriptor.parallel, strict: descriptor.strict, returnsSet: descriptor.returnsSet };
  const triggers: Record<string, RecordValue> = {};
  for (const [index, descriptor] of DIRECT_PENDING_DB_RECIPE.triggers.entries()) {
    const signedAttachment = descriptor.name === "jg_direct_pending_attachment_exclusive";
    triggers[descriptor.name] = { oid: String(30000+index), relationOid: relations[descriptor.table].oid,
      functionOid: routines[descriptor.function].oid, type: descriptor.type, enabled: "O", deferrable: false, initiallyDeferred: false,
      hasCondition: signedAttachment, definition: signedAttachment ? replaceDefinition(signedAttachmentDefinitions[definitionForm]) : null, internal: false,
      argumentCount: signedAttachment ? 2 : 0, arguments: signedAttachment ? "66696c654964007472756500" : "",
      // The synthetic CDA attributes are contractVersionId=1, slotKey=2,
      // fileId=3, displayOrder=4. The trigger lists fileId before slotKey.
      attributes: signedAttachment ? "3 2" : "" };
  }
  return { relations, routines, triggers };
}

/** Existing fake DB edge returns expected and actual from separate stored rows. */
export async function seedDirectPendingDatabaseBinding(server: Server, definitionForm: 0 | 1 = 0, replaceDefinition = (definition: string) => definition, actualDefinitionForm = definitionForm) {
  const deparseEnvironment = { searchSchemas: ["pg_catalog","public"], temporarySchemaName: "-", textTypeOid: "25", catalogTextTypeOid: "25", quoteAllIdentifiers: "off" };
  await server.store.table("directPendingDeparseEnvironment").create({ data: { snapshot: deparseEnvironment } });
  const installationObjects = declaredCatalogObjects(definitionForm, replaceDefinition);
  await server.store.table("directPendingInstalledBinding").create({ data: { snapshot: { protocolVersion: 1, recipeVersion: "contract-direct-pending-input-v1/1", applicationRoleOid: "7001",
    fileCallerOids: ["7001","9001"], databaseOid: "13000", anchorNamespaceOid: "2200", anchorOwnerOid: "9001", bindings: installationObjects } } });
  // Separate current catalog facts; tests may alter these without touching the
  // immutable installation fixture. Never derive expected APP from this role.
  const currentObjects = declaredCatalogObjects(actualDefinitionForm, replaceDefinition);
  await server.store.table("directPendingActualCatalog").create({ data: { observationOrder: 0, snapshot: { ...currentObjects,
    deparseEnvironment, triggerDefinitionReadable: true, schemaUsage: true, catalogReadable: true, allColumnsReadable: true, rlsAbsent: true, routineExecutable: true, digestExecutable: true, builtinsExecutable: true, attachmentFileLockable: true, originalNumberWritable: true, originalNumberNonunique: true,
    noCallerObjectOwnership: true, noBindingWrite: true, noBindingGrantOption: true, accessibleDefiners: [], sessionRoleOid: "7001", currentRoleOid: "7001", backendPid: 71201, transactionId: "500001" } } });
  const anchor = DIRECT_PENDING_DB_RECIPE.routines.find(entry => entry.signature === 'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",pg_catalog.text,pg_catalog.text)')!;
  const names = ["protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid","bindings"], types = ["int4","text","oid","_oid","oid","oid","oid","jsonb"];
  await server.store.table("directPendingBindingCatalog").create({ data: { snapshot: { bindingRelationOid: installationObjects.relations.jg_contract_direct_pending_binding_v1.oid,
    bindingNamespaceOid: "2200", bindingOwnerOid: "9001", bindingKind: "r", bindingRls: false, bindingForceRls: false, anchorOwnerOid: "9001", anchorSourceSha256: anchor.bodySha256, anchorDefiner: true,
    namespaceOid: "2200", databaseOid: "13000", sessionRoleOid: "7001", currentRoleOid: "7001", backendPid: 71201, transactionId: "500001", unsafeRuntimeRole: false,
    bindingColumns: names.map((name,index) => ({ name, type: types[index], number: index+1, notNull: true, generated: "", identity: "" })) } } });
}

export async function openDirectPendingDraft(server: Server) {
  await seedDirectPendingDatabaseBinding(server);
  const { randomUUID } = await import("node:crypto");
  const { loginTemplateActor } = await import("./template-selection.test-support");
  const projectId = randomUUID();
  await server.store.prisma.project.create({ data: { id: projectId, code: "T12-SOURCE-INPUT", name: "原件来源聚合合成项目", isActive: true } });
  const token = await loginTemplateActor(server, "staff");
  const base = await server.app.getUrl();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" };
  const createdResponse = await fetch(base+"/contracts", { method: "POST", headers, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "outside", handlingMode: "direct_signed" }) });
  if (createdResponse.status !== 201) throw new Error(`真实已签草稿前置失败：${createdResponse.status}`);
  const created = await createdResponse.json();
  const path = `/contract-drafts/${created.version.id}`;
  const leaseResponse = await fetch(base+path+"/edit-lease", { method: "POST", headers });
  if (leaseResponse.status !== 201) throw new Error(`真实租约前置失败：${leaseResponse.status}`);
  const lease = await leaseResponse.json();
  const input = { idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: 1, changedSections: ["draft"],
    draft: { numericProtocolVersion: 2, originalSignedNumber: null, manualAmountYuan: null, draftData: { ...created.version.draftData, contractName: "签章原件合同" }, clauses: [], pricingNature: "unit_price", amountSource: "manual", taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
    parties: [], bills: [], paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
  return { projectId, created, base, path, headers, leaseToken: lease.token, input,
    save: (payload: unknown) => fetch(base+path, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify(payload) }) };
}

/** Distinct installed and observed registry rows. Values model catalog observations only. */
export async function seedPreparedDirectArchiveTransition(server: Server, probeId?: string) {
  const identity = { applicationRoleOid: "7001", fileCallerOids: ["7001", "9001"], databaseOid: "13000",
    anchorNamespaceOid: "2200", anchorOwnerOid: "9001", pendingRelationOid: declaredCatalogObjects(0, definition => definition).relations.jg_contract_direct_pending_binding_v1.oid, reviewRelationOid: "21003",
    pendingSha256: "8".repeat(64), reviewSha256: "9".repeat(64) };
  const probe = { relationOid: "29501", guardRoutineCount: 1 };
  if (!probeId) await server.store.table("directArchiveTransitionProbe").create({ data: { snapshot: probe } });
  await server.store.table("directArchiveTransitionBinding").create({ data: { snapshot: {
    ...identity, protocolVersion: 1, recipeVersion: "contract-direct-archive-preparation-v1/1"
  } } });
  const observation = {
    ...identity, relationOid: "29501", guardRoutineOid: "29502", guardBodySha256: "88713aea758f69f6a42d6bd1329cdeeab386f1e535ac1dc69a59e3eac24f93a3",
    catalogCompatible: true, callerReadOnly: true, currentRoleOid: "7001", sessionRoleOid: "7001",
    backendPid: 71201, transactionId: "500001"
  };
  const row = await server.store.table("directArchiveTransitionActual").create({ data: { snapshot: observation } });
  return { observation, observationId: row.id };
}
