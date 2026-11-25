import { A08_DRAFT_VOUCHER_CHECK_SHA256, UPWARD_A08_DRAFT_VOUCHER_PROJECTION_SHA256, UPWARD_REGISTERED_VOUCHER_PROJECTION_SHA256, UPWARD_INITIAL_DRAFT_GUARD_PROJECTION_SHA256, UPWARD_OUTSIDE_PAIR_PROJECTION_SHA256, UPWARD_OUTSIDE_EVIDENCE_PROJECTION_SHA256, UPWARD_SIGNED_SETTLEMENT_FILE_PROJECTION_SHA256, UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256 } from "./contract-upward-direct-source-pins";
import { markTask12DirectSourceDiagnostic as mark, recordTask12DirectSourceDiagnostic as recordDiagnostic } from "./task12-direct-source-diagnostic";
import { assertDirectPendingCatalogInputs, factAppendSignature, readActualCatalog, readBindingCatalog, readDeparseEnvironment, readExpectedBinding } from "./contract-direct-pending-catalog";
import { discoverUpwardLegacyProjection, isQualifiedUpwardDefiner } from "./contract-upward-archive-catalog";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { readDirectArchiveTransitionOid, readPreparedDirectArchiveTransition } from "./contract-direct-archive-transition";
import { readDirectArchiveRetentionOid, readDirectArchiveRetentionQualification } from "./contract-direct-archive-retention-qualification";
import { readDirectArchiveDispatchOid, readDirectArchiveDispatchQualification } from "./contract-direct-archive-dispatch-qualification";
import { outsideFactAppendBody } from "./contract-generated-upward-operating-installation";
import {
  directOutsideOperatingReaderBody, directOutsideOperatingReaderCatalog, directOutsideOperatingReaderMismatch
} from "./contract-direct-outside-operating-reader-catalog";
import { directInputSignature } from "./contract-direct-archive-native-admission";
import { DIRECT_PENDING_DB_RECIPE } from "./contract-direct-pending-recipe";
import { qualifyDirectPendingFileBinding } from "./contract-direct-pending-registered-binding";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null; }
function unavailable(): never { throw new ServiceUnavailableException("已签合同来源资格尚未完整供应或已变化，请保留原件稍后办理"); }
function configuredSearchPath(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string" || !value[0].startsWith("search_path=")) unavailable();
  return value[0].slice("search_path=".length).split(",").map(part => part.trim());
}

/** Presence fails closed even when the persisted marker has malformed fields. */
export function hasDirectSigningInput(draftData: unknown): boolean {
  return !!draftData && typeof draftData === "object" && !Array.isArray(draftData) && Object.prototype.hasOwnProperty.call(draftData, "directSigningInput");
}

const OUTSIDE_PAIR_HELPER = "public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)";
const OUTSIDE_PAIR_HELPER_BODY = "1e2a2c2eb9191178796cac4c10dad4f9c5a09403584fbe47d8e7be00a9b7f802";

export type OutsideOriginalPairSourceScope = Readonly<{
  projectId: string;
  versionId: string;
  applicantId: string;
  fileIds: readonly [string, string];
}>;

interface DirectPendingSourceQualification {
  environment: ObjectValue; bootstrap: ObjectValue; expected: ObjectValue; actual: ObjectValue;
  transition: Awaited<ReturnType<typeof readPreparedDirectArchiveTransition>> | null;
  retention: Awaited<ReturnType<typeof readDirectArchiveRetentionQualification>> | null;
  dispatch: Awaited<ReturnType<typeof readDirectArchiveDispatchQualification>> | null;
}

export async function assertDirectPendingSourceQualification(tx: Prisma.TransactionClient, outsidePair?: OutsideOriginalPairSourceScope): Promise<DirectPendingSourceQualification> {
  mark("UPWARD_PROJECTION");
  let upwardProjection;
  try { upwardProjection = await discoverUpwardLegacyProjection(tx); }
  catch (error) { recordDiagnostic(error); throw error; }
  try {
    mark("DEPARSE_ENVIRONMENT");
    const environment = await readDeparseEnvironment(tx);
    mark("TRANSITION_DISCOVERY");
    const transitionOid = await readDirectArchiveTransitionOid(tx);
    mark("RETENTION_DISCOVERY");
    const retentionOid = await readDirectArchiveRetentionOid(tx);
    mark("DISPATCH_DISCOVERY");
    const dispatchOid = await readDirectArchiveDispatchOid(tx);
    mark("BINDING_CATALOG");
    const bootstrap = await readBindingCatalog(tx);
    mark("BINDING_ROW");
    const expected = await readExpectedBinding(tx);
    if (expected.applicationRoleOid !== bootstrap.currentRoleOid || expected.applicationRoleOid !== bootstrap.sessionRoleOid
      || expected.databaseOid !== bootstrap.databaseOid || expected.anchorNamespaceOid !== bootstrap.namespaceOid || expected.anchorOwnerOid !== bootstrap.anchorOwnerOid) unavailable();
    mark("SOURCE_CATALOG");
    const actual = await readActualCatalog(tx, expected);
    mark("SOURCE_POLICY");
    const { bound, relations, routines, expectedRoutines } = assertDirectPendingCatalogInputs(environment, bootstrap, expected, actual);
    mark("DISPATCH_CATALOG");
    const dispatch = dispatchOid === null ? null
      : await readDirectArchiveDispatchQualification(tx, dispatchOid, bootstrap, bound, actual, expected, transitionOid, retentionOid);
    const qualifiedFileBinding = dispatch
      ? dispatch.qualifiedFileBinding : await qualifyDirectPendingFileBinding(tx, actual, bound, expected, bootstrap, null);
    if (!qualifiedFileBinding) unavailable();
    const { collisionAcls, fileBinding } = qualifiedFileBinding;
    mark("ROUTINES");
    for (const descriptor of DIRECT_PENDING_DB_RECIPE.routines) {
      const current = object(fileBinding[descriptor.signature] ?? dispatch?.legacyProjection[descriptor.signature] ?? routines[descriptor.signature]);
      const observedOutside = descriptor.signature === factAppendSignature && bootstrap.anchorSourceSha256 === outsideFactAppendBody;
      if (observedOutside && current?.bodySha256 !== outsideFactAppendBody) unavailable();
      const identity = object(expectedRoutines[descriptor.signature]);
      let observation = current && observedOutside ? { ...current, bodySha256: descriptor.bodySha256 } : current;
      if (observation && Object.hasOwn(collisionAcls, descriptor.signature)) {
        observation = { ...observation, acl: collisionAcls[descriptor.signature] };
      }
      if (dispatch?.native && observation && descriptor.signature === directInputSignature) {
        observation = { ...observation, acl: identity?.acl };
      }
      if (!observation || !identity || !isDeepStrictEqual(identity, observation) || observation.bodySha256 !== descriptor.bodySha256
        || observation.securityDefiner !== descriptor.securityDefiner || observation.language !== descriptor.language || observation.returnType !== descriptor.returnType
        || observation.volatility !== descriptor.volatility || observation.parallel !== descriptor.parallel || observation.strict !== descriptor.strict || observation.returnsSet !== descriptor.returnsSet
        || !isDeepStrictEqual(configuredSearchPath(observation.configuration), descriptor.searchPath)) unavailable();
    }
    mark("TRIGGERS");
    const triggers = object(actual.triggers), installedTriggers = object(bound.triggers);
    if (!triggers || !installedTriggers || Object.keys(triggers).length !== DIRECT_PENDING_DB_RECIPE.triggers.length
      || Object.keys(installedTriggers).length !== DIRECT_PENDING_DB_RECIPE.triggers.length) unavailable();
    for (const descriptor of DIRECT_PENDING_DB_RECIPE.triggers) {
      const trigger = object(triggers[descriptor.name]), installed = object(installedTriggers[descriptor.name]), relation = object(relations[descriptor.table]);
      if (!trigger || !installed || !relation || trigger.relationOid !== relation.oid || trigger.type !== descriptor.type || trigger.enabled !== "O" || trigger.deferrable !== false || trigger.initiallyDeferred !== false || trigger.internal !== false || trigger.argumentCount !== descriptor.argumentCount || trigger.arguments !== descriptor.arguments) unavailable();
      const expectedAttributes = descriptor.columns.map(name => {
        const column = Array.isArray(relation.columns) ? relation.columns.map(object).find(value => value?.name === name) : null;
        if (!column || !Number.isSafeInteger(column.number)) unavailable();
        return String(column.number);
      }).join(" ");
      if (trigger.attributes !== expectedAttributes) unavailable();
      if (descriptor.definitions === null) {
        if (trigger.hasCondition !== false || trigger.definition !== null || !isDeepStrictEqual(installed, trigger)) unavailable();
      } else {
        if (trigger.hasCondition !== true || !descriptor.definitions.some(definition => definition === trigger.definition)
          || !descriptor.definitions.some(definition => definition === installed.definition)) unavailable();
        // Only the two separately validated whole definitions may differ. Keep
        // the raw current and installed observations for transaction continuity.
        if (!isDeepStrictEqual({ ...installed, definition: null }, { ...trigger, definition: null })) unavailable();
      }
      const routine = object(routines[descriptor.function]);
      // The existing exclusive trigger routine is pinned by the preserved old
      // chain's installation qualification; its OID is recorded in the binding.
      if (!routine || trigger.functionOid !== routine.oid) unavailable();
    }
    mark("DEFINERS");
    if (!Array.isArray(actual.accessibleDefiners)) unavailable();
    for (const value of actual.accessibleDefiners) {
      const definer = object(value);
      mark("DEFINER_UNKNOWN");
      if (!definer) unavailable();
      if (isQualifiedUpwardDefiner(upwardProjection, definer) || DIRECT_PENDING_DB_RECIPE.allowedSecurityDefiners.some(descriptor => {
        const known = object(routines[descriptor.signature]);
        const allowedBody = descriptor.signature === factAppendSignature ? bootstrap.anchorSourceSha256 : descriptor.bodySha256;
        return known && known.oid === definer.oid && definer.bodySha256 === allowedBody;
      })) continue;
      if (definer.bodySha256 === A08_DRAFT_VOUCHER_CHECK_SHA256 && upwardProjection?.definers.some(item =>
        item.signature === "public.jg_upward_archive_catalog_projection_v2()" &&
        (item.bodySha256 === UPWARD_A08_DRAFT_VOUCHER_PROJECTION_SHA256 || item.bodySha256 === UPWARD_REGISTERED_VOUCHER_PROJECTION_SHA256 || item.bodySha256 === UPWARD_INITIAL_DRAFT_GUARD_PROJECTION_SHA256 || item.bodySha256 === UPWARD_OUTSIDE_PAIR_PROJECTION_SHA256 || item.bodySha256 === UPWARD_OUTSIDE_EVIDENCE_PROJECTION_SHA256 || item.bodySha256 === UPWARD_SIGNED_SETTLEMENT_FILE_PROJECTION_SHA256 || item.bodySha256 === UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256))) {
        const [scope] = await tx.$queryRaw<Array<{ oid: string | null }>>(Prisma.sql`
          SELECT pg_catalog.to_regprocedure('public.jg_check_a08_direct_original_voucher_v1(text,text)')::oid::text AS oid
        `);
        if (scope?.oid === definer.oid) continue;
        unavailable();
      }
      if (outsidePair && definer.bodySha256 === OUTSIDE_PAIR_HELPER_BODY && upwardProjection?.definers.some(item =>
        item.signature === "public.jg_upward_archive_catalog_projection_v2()" &&
        (item.bodySha256 === UPWARD_OUTSIDE_PAIR_PROJECTION_SHA256 || item.bodySha256 === UPWARD_OUTSIDE_EVIDENCE_PROJECTION_SHA256 || item.bodySha256 === UPWARD_SIGNED_SETTLEMENT_FILE_PROJECTION_SHA256 || item.bodySha256 === UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256))) {
        const [scope, ...extra] = await tx.$queryRaw<Array<{ oid: string }>>(Prisma.sql`
          /* contract_direct_outside_original_pair_source */
          SELECT helper.oid::text AS oid
          FROM pg_catalog.pg_proc helper
          JOIN pg_catalog.pg_database d ON d.datname=current_database() AND d.datdba=helper.proowner
          JOIN public."ContractVersion" v ON v.id=${outsidePair.versionId}
          JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=${outsidePair.projectId}
            AND c."ownerUserId"=${outsidePair.applicantId} AND c."contractTypeKey"='material_purchase'
          WHERE current_user=session_user AND current_user::text ~ '^jg_fixture_app_[a-f0-9]{24}$'
            AND current_user::regrole::oid::text=${expected.applicationRoleOid}
            AND v.status='draft' AND v."versionNo"=1 AND v."changeType"='original'
            AND v."numericProtocolVersion"=2 AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
            AND v."draftData"#>>'{directSigningInput,relationship}'='outside'
            AND v."draftData"#>>'{directSigningInput,protocolVersion}'='1'
            AND ${outsidePair.fileIds[0]}::text<>${outsidePair.fileIds[1]}::text
            AND helper.oid=pg_catalog.to_regprocedure(${OUTSIDE_PAIR_HELPER})
            AND helper.pronamespace=pg_catalog.to_regnamespace('public') AND helper.prosecdef
            AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(helper.prosrc,'UTF8')),'hex')=${OUTSIDE_PAIR_HELPER_BODY}
            AND pg_catalog.has_function_privilege(current_user,helper.oid,'EXECUTE')
            AND NOT pg_catalog.has_function_privilege(current_user,helper.oid,'EXECUTE WITH GRANT OPTION')
            AND NOT pg_catalog.has_function_privilege(current_user,
              'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
        `);
        if (!extra.length && scope?.oid === definer.oid) continue;
        unavailable();
      }
      const completionOid = dispatch?.native?.completionOid;
      if (definer.bodySha256 !== directOutsideOperatingReaderBody) unavailable();
      mark("DEFINER_READER_BINDING_ABSENT");
      if (!completionOid) unavailable();
      mark("DEFINER_READER_CATALOG");
      const reader = await tx.$queryRaw<ObjectValue[]>(Prisma.sql`
        /* contract_direct_outside_operating_reader_catalog_v2 */
        ${directOutsideOperatingReaderCatalog}
        SELECT q.* FROM qualified q
      `);
      if (reader.length !== 1) {
        mark(reader.length === 0 ? "DEFINER_READER_NO_ROW" : "DEFINER_READER_MULTIPLE_ROWS");
        unavailable();
      }
      const mismatch = directOutsideOperatingReaderMismatch(reader[0], bootstrap, completionOid, definer);
      if (Object.values(mismatch).some(Boolean)) {
        mark("DEFINER_READER_MISMATCH");
        recordDiagnostic(undefined, mismatch);
        unavailable();
      }
    }
    mark("TRANSITION");
    const transition = transitionOid === null ? null : await readPreparedDirectArchiveTransition(tx, transitionOid, expected, bootstrap);
    mark("RETENTION");
    const retention = retentionOid === null ? null : await readDirectArchiveRetentionQualification(tx, retentionOid, transition, bootstrap);
    mark("CONTINUITY");
    if (dispatch && (!transition || !retention || dispatch.links.pendingSha !== transition.binding.pendingSha256
      || dispatch.links.prepareSha !== retention.binding.preparationSha256
      || dispatch.archiveRelationOid !== object(object(retention.actual.bindings)?.relations)?.ContractArchiveFile)) unavailable();
    return { environment, bootstrap, expected, actual, transition, retention, dispatch, ...(upwardProjection ? { upwardProjection } : {}) };
  } catch (error) {
    recordDiagnostic(error);
    if (error instanceof ServiceUnavailableException) throw error;
    // Missing object/rights and observation errors are never proof of absence or
    // permission. No underlying DB diagnostics or credentials reach the user.
    unavailable();
  }
}

export async function assertDirectPendingSourceContinuity(tx: Prisma.TransactionClient, before: DirectPendingSourceQualification, outsidePair?: OutsideOriginalPairSourceScope): Promise<void> {
  const after = await assertDirectPendingSourceQualification(tx, outsidePair);
  if (!isDeepStrictEqual(after, before)) unavailable();
}
