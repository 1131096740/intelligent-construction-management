import { ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { Prisma, type ContractVersion } from "@prisma/client";
import { assertDirectPendingSourceContinuity, assertDirectPendingSourceQualification } from "./contract-direct-pending-source";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import { assertUpwardPendingSaveContinuity, qualifyUpwardPendingSave } from "./contract-upward-pending-save-profile";

const BODY_SHA256 = "5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4";
const unavailableReason = "对上已签合同来源暂时无法核对，请保留资料稍后办理";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Classify by reserved relationship even if the rest of the marker is corrupt. */
export function isUpwardDirectPendingDraft(draft: unknown): boolean {
  return object(object(draft)?.directSigningInput)?.relationship === "upward";
}

export function assertUpwardDirectPendingWriteClosed(draft: unknown) {
  if (isUpwardDirectPendingDraft(draft)) throw new ServiceUnavailableException(unavailableReason);
}

type Coordinates = Pick<ContractVersion, "id" | "contractId" | "draftRevision" | "draftData" | "signingSubjectType"
  | "affiliateAssignmentId" | "affiliateBusinessPartyVersionId" | "companyEntityIdSnapshot" | "companyEntityVersionId"> & { projectId: string };
type Identity = Awaited<ReturnType<typeof assertDirectPendingSourceQualification>>["bootstrap"];

function emptyRead(state: "unavailable" | "incomplete", sourceRevision: number | null = null) {
  return {
    originalSignedNumber: null,
    originalSignedNumberState: "unavailable",
    source: {
      protocolVersion: 2, sourceKind: "upward_direct_signed_pending", state, sourceRevision,
      Q: null, inputSha256: null, reason: unavailableReason
    }
  };
}

async function readCatalog(tx: Prisma.TransactionClient, identity: Identity) {
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    /* contract_upward_pending_catalog_v1 */
    SELECT p.oid::text AS "oid", p.pronamespace::text AS "namespaceOid", p.proowner::text AS "ownerOid",
      encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS "bodySha256",
      p.prosecdef AS "definer", p.proconfig AS "settings", p.provolatile AS "volatility",
      p.proparallel AS "parallel", p.proisstrict AS "strict", p.proretset AS "returnsSet",
      l.lanname AS "language", p.prorettype='pg_catalog.jsonb'::regtype AS "returnsJsonb",
      p.prokind='f' AND p.pronargdefaults=0 AND p.provariadic=0 AS "plainRoutine",
      (current_user::regrole::oid)::text AS "currentRoleOid",
      (session_user::regrole::oid)::text AS "sessionRoleOid",
      pg_catalog.pg_backend_pid() AS "backendPid", pg_catalog.txid_current()::text AS "transactionId",
      current_database()=(SELECT datname FROM pg_catalog.pg_database WHERE oid=${identity.databaseOid}::oid) AS "sameDatabase",
      pg_catalog.has_function_privilege(current_user::regrole::oid,p.oid,'EXECUTE')
        AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantee=current_user::regrole::oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.privilege_type='EXECUTE' AND
            (a.grantee NOT IN (p.proowner,current_user::regrole::oid) OR a.grantee<>p.proowner AND a.is_grantable))
        AS "privateExecute",
      (SELECT count(*)=12 AND bool_and(c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
        AND c.relowner=p.proowner)
        FROM pg_catalog.pg_class c WHERE c.relnamespace=p.pronamespace AND c.relname IN (
          'Contract','ContractVersion','Project','ProjectAffiliateAssignment','BusinessParty','BusinessPartyVersion','ContractPartySnapshot',
          'CompanyEntity','CompanyEntityVersion','ProjectParticipatingCompany','PaymentTermsVersion','PaymentTermsStage'
        )) AND
      (SELECT count(*)=2 AND bool_and(c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relowner=p.proowner)
        FROM pg_catalog.pg_class c WHERE c.relnamespace=p.pronamespace AND c.relname IN ('ContractDraftAttachment','FileObject')) AS "sourceTables"
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid=pg_catalog.to_regprocedure('public.jg_contract_upward_pending_read_v1(pg_catalog.text,pg_catalog.text)')
  `);
  const row = rows.length === 1 ? object(rows[0]) : null;
  if (!row || typeof row.oid !== "string" || !/^[1-9][0-9]*$/u.test(row.oid)
    || row.namespaceOid !== identity.namespaceOid || row.ownerOid !== identity.anchorOwnerOid
    || row.bodySha256 !== BODY_SHA256 || row.definer !== false || row.language !== "plpgsql"
    || row.volatility !== "s" || row.parallel !== "u" || row.strict !== false || row.returnsSet !== false
    || !isDeepStrictEqual(row.settings, ["search_path=pg_catalog, public"]) || row.returnsJsonb !== true || row.plainRoutine !== true
    || row.currentRoleOid !== identity.currentRoleOid || row.sessionRoleOid !== identity.sessionRoleOid
    || row.backendPid !== identity.backendPid || row.transactionId !== identity.transactionId
    || row.sameDatabase !== true || row.privateExecute !== true || row.sourceTables !== true) return null;
  return row;
}

function effectiveAt(subject: Record<string, unknown>, point: string, format: RegExp) {
  const { effectiveFrom, endedAt } = subject;
  return typeof effectiveFrom === "string" && format.test(effectiveFrom) && effectiveFrom <= point
    && (endedAt === null || typeof endedAt === "string" && format.test(endedAt) && point < endedAt);
}

function validateInput(value: unknown, version: Coordinates, now: Date) {
  const input = object(value);
  const q = object(input?.Q);
  if (!input || !q || typeof input.qText !== "string" || typeof input.inputSha256 !== "string"
    || createHash("sha256").update(input.qText, "utf8").digest("hex") !== input.inputSha256
    || !isDeepStrictEqual(JSON.parse(input.qText), q)) return null;

  const marker = object(object(version.draftData)?.directSigningInput);
  const subjects = object(q.subjects);
  const enterprise = object(subjects?.enterprise);
  const company = object(subjects?.company);
  const enterprisePosition = object(enterprise?.position);
  const companyPosition = object(company?.position);
  const contract = object(q.contract);
  if (q.inputProtocolVersion !== 2 || !isDeepStrictEqual(q.source, { kind: "direct_signed", relationship: "upward" })
    || !isDeepStrictEqual(q.locator, { projectId: version.projectId, contractId: version.contractId, contractVersionId: version.id,
      draftRevision: version.draftRevision, versionNo: 1, changeType: "original" })
    || marker?.protocolVersion !== 2 || marker.source !== "direct_signed" || version.signingSubjectType !== "upward"
    || !enterprise || enterprise.projectId !== version.projectId || !enterprise.cpsId || !enterprise.businessPartyId
    || !version.affiliateAssignmentId || enterprise.assignmentId !== version.affiliateAssignmentId
    || !version.affiliateBusinessPartyVersionId || enterprise.businessPartyVersionId !== version.affiliateBusinessPartyVersionId
    || !effectiveAt(enterprise, now.toISOString(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
    || !company || company.projectId !== version.projectId || !company.joinedCompanyEntityVersionId
    || !version.companyEntityIdSnapshot || company.companyEntityId !== version.companyEntityIdSnapshot
    || !version.companyEntityVersionId || company.companyEntityVersionId !== version.companyEntityVersionId
    || !effectiveAt(company, chinaDateOnly(now), /^\d{4}-\d{2}-\d{2}$/u)
    || enterprisePosition?.displayOrder !== 0 || companyPosition?.displayOrder !== 0
    || !["party_a", "party_b"].includes(String(enterprisePosition.roleKey))
    || !["party_a", "party_b"].includes(String(companyPosition.roleKey)) || enterprisePosition.roleKey === companyPosition.roleKey
    || !isDeepStrictEqual(enterprisePosition, marker.enterpriseParty) || !isDeepStrictEqual(companyPosition, marker.companyParty)
    || company?.participationId !== marker.companyParticipationId || !contract
    || (contract.originalSignedNumber !== null && (typeof contract.originalSignedNumber !== "string" || !contract.originalSignedNumber))
    || !Array.isArray(q.signedFiles) || !q.signedFiles.length || q.signedFiles.length > 20) return null;

  const seen = new Set<string>();
  for (const [index, file] of q.signedFiles.entries()) {
    const item = object(file);
    if (!item || typeof item.fileId !== "string" || !item.fileId || seen.has(item.fileId) || item.displayOrder !== index
      || !["application/pdf", "image/jpeg", "image/png"].includes(String(item.mimeType))
      || typeof item.sizeBytes !== "number" || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0
      || typeof item.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.contentSha256)) return null;
    seen.add(item.fileId);
  }
  return { Q: q, inputSha256: input.inputSha256, originalSignedNumber: contract.originalSignedNumber };
}

export async function readUpwardDirectPending(
  tx: Prisma.TransactionClient, version: Coordinates, actorUserId: string, isOwner: boolean,
  saveQualification?: Awaited<ReturnType<typeof qualifyUpwardPendingSave>>
) {
  if (!isOwner) return emptyRead("unavailable");
  try {
    const access = await resolveGovernedFinalArchiveAccess(tx, {
      actorUserId, handlerUserId: actorUserId, projectId: version.projectId
    });
    if (!access.canUpload) return emptyRead("unavailable");
    // The old profile pins the existing role, file protections and transaction.
    // It is only a prerequisite. The independently pinned upward read routine
    // must also be executable before it is called.
    const base = saveQualification ? null : await assertDirectPendingSourceQualification(tx);
    const identity = base?.bootstrap ?? saveQualification!;
    const before = await readCatalog(tx, identity);
    if (!before) return emptyRead("unavailable");
    const observedAt = new Date();
    const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
      SELECT public.jg_contract_upward_pending_read_v1(${version.id}::pg_catalog.text,${actorUserId}::pg_catalog.text) AS input
    `);
    const observed = rows.length === 1 ? object(rows[0]) : null;
    if (!observed || !("input" in observed)) return emptyRead("unavailable");
    if (saveQualification) await assertUpwardPendingSaveContinuity(tx, saveQualification);
    if (base) await assertDirectPendingSourceContinuity(tx, base);
    if (!isDeepStrictEqual(before, await readCatalog(tx, identity))) return emptyRead("unavailable");
    if (observed.input === null) return emptyRead("incomplete", version.draftRevision);
    const input = validateInput(observed.input, version, observedAt);
    if (!input) return emptyRead("unavailable");
    return {
      originalSignedNumber: input.originalSignedNumber, originalSignedNumberState: "available",
      source: { protocolVersion: 2, sourceKind: "upward_direct_signed_pending", state: "complete",
        sourceRevision: version.draftRevision, Q: input.Q, inputSha256: input.inputSha256, reason: null }
    };
  } catch {
    return emptyRead("unavailable");
  }
}
