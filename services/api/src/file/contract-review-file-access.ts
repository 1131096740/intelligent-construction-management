import { ForbiddenException } from "@nestjs/common";
import { type FileObject, Prisma } from "@prisma/client";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { assertDirectReviewQualification } from "../contract-ledger/contract-direct-review-qualification";
import { CONTRACT_ECONOMIC_REVIEW_READER_ROLES } from "../contract-ledger/contract-economic-review-access";
import { reviewReferenceCatalog } from "./contract-review-file-retention";

export interface ContractReviewFileAccess {
  businessType: "contract_economic_review";
  fileName: string;
}

type ReferenceRow = {
  reviewId: string;
  sourceRef: string;
  projectId: string;
  status: string;
  confirmedAt: Date | null;
  frozenSources: unknown;
  displayOrder: number;
  sourceContractVersionId: string;
  directInputProtocolVersion: number;
  sourceRevision: number;
  inputSha256: string;
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  bucket: string;
  objectKey: string;
};

function deny(): never {
  throw new ForbiddenException("当前账号无权下载该履约复核原件");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const extensions = new Map([
  ["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"]
]);
const hash = /^[0-9a-f]{64}$/u;

async function mayUseOrdinaryFilePolicy(tx: Prisma.TransactionClient, file: FileObject): Promise<boolean> {
  // Only a negative witness is returned. A matching historical file at another
  // ID or with a missing reference cannot supply download authority.
  const rows = await tx.$queryRaw<Array<{ retainedAlias: boolean; confirmedWithoutReference: boolean }>>(Prisma.sql`
    /* contract_economic_review_ticket_orphaned_proof */
    WITH candidates AS (
      SELECT ${file.id}::text AS id
      UNION
      SELECT f."id" FROM public."FileObject" f WHERE f."objectKey"=${file.objectKey}
    )
    SELECT EXISTS (
      SELECT 1 FROM public."ContractEconomicReviewFileReference" r
      WHERE r."objectKey"=${file.objectKey} OR r."fileId" IN (SELECT id FROM candidates)
    ) AS "retainedAlias", EXISTS (
      SELECT 1 FROM public."ContractEconomicReview" review
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(CASE
        WHEN pg_catalog.jsonb_typeof(review."frozenSources")='array' THEN review."frozenSources"
        ELSE '[]'::jsonb END) side(value)
      WHERE review."status"='confirmed' AND review."confirmedAt" IS NOT NULL
        AND side.value#>'{directInput,Q,inputProtocolVersion}'='1'::jsonb
        AND side.value#>>'{directInput,Q,source,kind}'='direct_signed'
        AND side.value#>>'{directInput,Q,source,relationship}'='outside'
        AND side.value#>>'{directInput,Q,locator,projectId}'=review."projectId"
        AND side.value#>>'{directInput,Q,locator,changeType}'='original'
        AND side.value#>'{directInput,Q,locator,versionNo}'='1'::jsonb
        AND side.value->>'ref'='contract:' || (side.value#>>'{directInput,Q,locator,contractId}')
        AND side.value#>>'{directInput,Q,locator,contractVersionId}'<>''
        AND side.value#>>'{directInput,Q,locator,draftRevision}' ~ '^[1-9][0-9]*$'
        AND side.value#>>'{directInput,inputSha256}' ~ '^[a-f0-9]{64}$'
        AND side.value->>'version'=(side.value#>>'{directInput,Q,locator,contractVersionId}') || ':direct:' ||
          (side.value#>>'{directInput,Q,locator,draftRevision}') || ':' || (side.value#>>'{directInput,inputSha256}')
        AND EXISTS (SELECT 1 FROM candidates c WHERE (side.value#>'{directInput,Q,signedFiles}')
          @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('fileId',c.id)))
    ) AS "confirmedWithoutReference"
  `);
  return rows.length === 1 && rows[0]?.retainedAlias === false && rows[0]?.confirmedWithoutReference === false;
}

function exactHistory(rows: ReferenceRow[], file: FileObject): boolean {
  const [first] = rows;
  if (!first || !first.reviewId || !first.projectId || first.status !== "confirmed" ||
    !(first.confirmedAt instanceof Date) || !Number.isFinite(first.confirmedAt.getTime()) ||
    !Array.isArray(first.frozenSources) || !first.sourceContractVersionId ||
    !Number.isSafeInteger(first.sourceRevision) || first.sourceRevision < 1 ||
    typeof first.inputSha256 !== "string" || !hash.test(first.inputSha256)) return false;
  const matching = first.frozenSources.map(record).filter(side => side?.ref === first.sourceRef);
  if (matching.length !== 1) return false;
  const side = matching[0];
  const input = record(side?.directInput);
  const q = record(input?.Q);
  const locator = record(q?.locator);
  const source = record(q?.source);
  if (!side || !q || !locator || !source ||
    side.formal !== false || side.numericProtocolVersion !== 2 || side.projectId !== first.projectId ||
    side.version !== `${first.sourceContractVersionId}:direct:${first.sourceRevision}:${first.inputSha256}` ||
    input?.inputSha256 !== first.inputSha256 || q.inputProtocolVersion !== 1 ||
    source.kind !== "direct_signed" || source.relationship !== "outside" ||
    locator.projectId !== first.projectId || typeof locator.contractId !== "string" || !locator.contractId ||
    first.sourceRef !== `contract:${locator.contractId}` ||
    locator.contractVersionId !== first.sourceContractVersionId || locator.draftRevision !== first.sourceRevision ||
    locator.changeType !== "original" || locator.versionNo !== 1 ||
    !Array.isArray(q.signedFiles) || q.signedFiles.length !== rows.length || rows.length < 1 || rows.length > 20 ||
    new Set(rows.map(row => row.fileId)).size !== rows.length) return false;
  const signedFiles = q.signedFiles;
  const consistent = rows.every((row, index) => {
    const signed = record(signedFiles[index]);
    return row.reviewId === first.reviewId && row.sourceRef === first.sourceRef &&
      row.projectId === first.projectId && row.status === "confirmed" &&
      row.sourceContractVersionId === first.sourceContractVersionId && row.directInputProtocolVersion === 1 &&
      row.sourceRevision === first.sourceRevision && row.inputSha256 === first.inputSha256 &&
      row.displayOrder === index && signed?.displayOrder === index && signed.fileId === row.fileId &&
      signed.mimeType === row.mimeType && extensions.has(row.mimeType) &&
      signed.sizeBytes === row.sizeBytes && Number.isSafeInteger(row.sizeBytes) && row.sizeBytes > 0 &&
      signed.contentSha256 === row.contentSha256 && hash.test(row.contentSha256) && row.bucket && row.objectKey;
  });
  return consistent && rows.some(row => row.fileId === file.id && row.bucket === file.bucket &&
    row.objectKey === file.objectKey && row.mimeType === file.mimeType && row.sizeBytes === file.sizeBytes &&
    row.contentSha256 === file.contentSha256);
}

export async function contractReviewTicketAccess(
  tx: Prisma.TransactionClient,
  file: FileObject,
  actorUserId: string,
  visibility: ProjectVisibilityService,
  storageBucket: () => string,
  delegatorUserId?: string
): Promise<ContractReviewFileAccess | undefined> {
  if (await reviewReferenceCatalog(tx, "ticket") === "legacy") return undefined;
  const rows = await tx.$queryRaw<ReferenceRow[]>(Prisma.sql`
    /* contract_economic_review_ticket_references */
    SELECT r."reviewId",r."sourceRef",r."displayOrder",r."sourceContractVersionId",r."directInputProtocolVersion",
      r."sourceRevision",r."inputSha256",r."fileId",r."mimeType",r."sizeBytes",r."contentSha256",r."bucket",r."objectKey",
      review."projectId",review."status",review."confirmedAt",review."frozenSources"
    FROM public."ContractEconomicReviewFileReference" r
    LEFT JOIN public."ContractEconomicReview" review ON review."id"=r."reviewId"
    WHERE EXISTS (SELECT 1 FROM public."ContractEconomicReviewFileReference" target
      WHERE target."fileId"=${file.id} AND target."reviewId"=r."reviewId" AND target."sourceRef"=r."sourceRef")
    ORDER BY r."reviewId",r."sourceRef",r."displayOrder"
  `);
  if (!rows.length) {
    if (!(await mayUseOrdinaryFilePolicy(tx, file))) return deny();
    return undefined;
  }
  const extension = extensions.get(file.mimeType);
  if (delegatorUserId || !extension || file.storageStatus !== "active" || file.purgeReceiptId !== null ||
    file.supersedesFileObjectId !== null || file.bucket !== storageBucket() ||
    (await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } }))?.isActive !== true) return deny();
  const visible = await visibility.visibleProjectIdsInTransaction(tx, actorUserId);
  const projects = [...new Set(rows.map(row => row.projectId).filter(project => typeof project === "string" && visible.includes(project)))];
  if (!projects.length) return deny();
  const roles = await visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, projects);
  const bySource = new Map<string, ReferenceRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.reviewId, row.sourceRef]);
    const group = bySource.get(key) ?? [];
    group.push(row);
    bySource.set(key, group);
  }
  if (![...bySource.values()].some(group =>
    projects.includes(group[0]!.projectId) &&
    (roles.get(group[0]!.projectId) ?? []).some(role => CONTRACT_ECONOMIC_REVIEW_READER_ROLES.includes(role)) &&
    exactHistory(group, file))) return deny();
  await assertDirectReviewQualification(tx, "read");
  return { businessType: "contract_economic_review", fileName: `签章原件.${extension}` };
}
