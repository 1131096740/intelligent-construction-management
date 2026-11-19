import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractArchiveFile, type ContractVersion } from "@prisma/client";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import { directArchiveRequestSha } from "./contract-direct-archive-request";
import type { RegisterDirectSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";
import type { DirectArchiveExecution } from "./contract-direct-archive-executor";

export const UPWARD_DIRECT_ARCHIVE_AUTHORITY = Symbol("UPWARD_DIRECT_ARCHIVE_AUTHORITY");
type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;
export type UpwardDirectPreparation = Readonly<{ Q: Row; qText: string; inputSha256: string; nativeNonce: string }>;
export type UpwardDirectExecution = DirectArchiveExecution & Readonly<{ requestSha256: string; Q: Row; qText: string }>;
/** Installed authority owns its SQL/source qualification. Preparation is never a persisted receipt. */
export interface UpwardDirectArchiveAuthority {
  prepare(tx: Tx, owner: Contract, version: ContractVersion, actor: string): Promise<UpwardDirectPreparation>;
  execute(command: UpwardDirectExecution): Promise<void>;
}
export function upwardArchiveUnavailable(): never {
  throw new ServiceUnavailableException("对上已签合同登记资格尚未完整核对，请保留原件和本次标识");
}
export function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function changed(): never { throw new ConflictException("对上待登记资料或当前签约资格已变化，请刷新后核对"); }

/** Revalidate both independent subjects under the project lock; signer history is not entitlement. */
export async function assertUpwardRegistrationSubjects(tx: Tx, owner: Contract, version: ContractVersion, q: Row, now: Date) {
  const enterprise = record(record(q.subjects).enterprise), company = record(record(q.subjects).company);
  const marker = record(record(version.draftData).directSigningInput);
  const enterprisePosition = record(enterprise.position), companyPosition = record(company.position);
  if (!isDeepStrictEqual(enterprise.position, marker.enterpriseParty) || !isDeepStrictEqual(company.position, marker.companyParty)
    || enterprisePosition.displayOrder !== 0 || companyPosition.displayOrder !== 0
    || !["party_a", "party_b"].includes(String(enterprisePosition.roleKey))
    || !["party_a", "party_b"].includes(String(companyPosition.roleKey)) || enterprisePosition.roleKey === companyPosition.roleKey) changed();
  const assignments = await tx.projectAffiliateAssignment.findMany({ where: { projectId: owner.projectId,
    effectiveFrom: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] } });
  const assignment = assignments.length === 1 ? assignments[0] : null;
  if (!assignment || assignment.id !== enterprise.assignmentId || assignment.id !== version.affiliateAssignmentId
    || assignment.businessPartyVersionId !== enterprise.businessPartyVersionId || assignment.businessPartyVersionId !== version.affiliateBusinessPartyVersionId
    || assignment.businessPartyId !== enterprise.businessPartyId || enterprise.projectId !== owner.projectId) changed();
  await tx.$queryRaw(Prisma.sql`SELECT "id", "status" FROM "BusinessParty" WHERE "id" IN (${assignment.businessPartyId}) ORDER BY "id" FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CompanyEntity" WHERE "id" = ${version.companyEntityIdSnapshot} FOR UPDATE`);
  const day = new Date(chinaDateOnly(now) + "T00:00:00.000Z");
  const participation = await tx.projectParticipatingCompany.findFirst({ where: { id: marker.companyParticipationId as string,
    projectId: owner.projectId, companyEntityId: version.companyEntityIdSnapshot!, effectiveFrom: { lte: day },
    OR: [{ endedAt: null }, { endedAt: { gt: day } }] } });
  const entity = await tx.companyEntity.findUnique({ where: { id: version.companyEntityIdSnapshot! } });
  const current = entity && await tx.companyEntityVersion.findFirst({ where: { companyEntityId: entity.id, versionNo: entity.currentVersionNo } });
  const enterpriseEntity = await tx.businessParty.findUnique({ where: { id: assignment.businessPartyId } });
  const enterpriseVersion = await tx.businessPartyVersion.findUnique({ where: { id: assignment.businessPartyVersionId } });
  if (!participation || participation.id !== company.participationId || participation.companyEntityVersionId !== company.joinedCompanyEntityVersionId
    || company.projectId !== owner.projectId || !entity?.isActive || entity.dataStatus !== "complete" || !current?.isActive
    || current.id !== company.companyEntityVersionId || current.id !== version.companyEntityVersionId || entity.id !== company.companyEntityId
    || enterpriseEntity?.status !== "active" || enterpriseVersion?.businessPartyId !== enterpriseEntity.id
    || current.unifiedSocialCreditCode?.trim().toUpperCase() === record(enterpriseVersion.snapshot).unifiedSocialCreditCode?.toString().trim().toUpperCase()) changed();
}

export async function prepareUpwardDirectRegistration(tx: Tx, versionId: string, actor: string,
  input: RegisterDirectSignedContractV2Dto, authority: UpwardDirectArchiveAuthority | undefined) {
  const located = await tx.contractVersion.findUnique({ where: { id: versionId } });
  if (!located) throw new ForbiddenException("当前账号无权登记本合同");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."Contract" WHERE "id" = ${located.contractId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."ContractVersion" WHERE "id" = ${versionId} FOR UPDATE`);
  const version = await tx.contractVersion.findUnique({ where: { id: versionId } });
  const owner = await tx.contract.findUnique({ where: { id: located.contractId } });
  if (!owner || !version || version.contractId !== owner.id || owner.ownerUserId !== actor || owner.voidedAt
    || !(await resolveGovernedFinalArchiveAccess(tx, { actorUserId: actor, projectId: owner.projectId, handlerUserId: actor })).canUpload) {
    throw new ForbiddenException("只有当前有项目权限的合同经办人可以登记本合同");
  }
  const requestSha256 = directArchiveRequestSha(owner.id, versionId, actor, input);
  const existing = await tx.contractArchiveFile.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.contractVersionId !== versionId || existing.requestSha256 !== requestSha256 || existing.uploadedByUserId !== actor) changed();
    return { requestSha256 };
  }
  const marker = record(record(version.draftData).directSigningInput);
  if (version.numericProtocolVersion !== 2 || version.signingSubjectType !== "upward" || version.versionNo !== 1
    || version.changeType !== "original" || version.status !== "draft" || version.baseVersionId || version.supersedesVersionId
    || version.copiedFromContractVersionId || version.firstSubmittedAt || version.effectiveAt || version.endedAt || version.taxFactsFrozenAt
    || marker.protocolVersion !== 2 || marker.source !== "direct_signed" || marker.relationship !== "upward"
    || version.draftRevision !== input.expectedDraftRevision || await tx.contractArchiveFile.count({ where: { contractVersionId: versionId } })) changed();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."Project" WHERE "id" = ${owner.projectId} FOR UPDATE`);
  if (!(await tx.project.findUnique({ where: { id: owner.projectId } }))?.isActive) changed();
  if (!authority) upwardArchiveUnavailable();
  const prepared = await authority.prepare(tx, owner, version, actor);
  const q = prepared.Q;
  let decoded: unknown;
  try { decoded = JSON.parse(prepared.qText); } catch { upwardArchiveUnavailable(); }
  if (createHash("sha256").update(prepared.qText).digest("hex") !== prepared.inputSha256
    || !isDeepStrictEqual(decoded, q) || prepared.inputSha256 !== input.expectedInputSha256
    || q.inputProtocolVersion !== 2 || !isDeepStrictEqual(q.source, { kind: "direct_signed", relationship: "upward" })
    || !isDeepStrictEqual(q.locator, { projectId: owner.projectId, contractId: owner.id, contractVersionId: versionId,
      draftRevision: version.draftRevision, versionNo: 1, changeType: "original" })) changed();
  await assertUpwardRegistrationSubjects(tx, owner, version, q, new Date());
  const files = q.signedFiles;
  if (!Array.isArray(files) || files.length !== input.fileIds.length || files.length < 1 || files.length > 20
    || new Set(input.fileIds).size !== files.length) changed();
  const attachments = await tx.contractDraftAttachment.findMany({ where: { contractVersionId: versionId }, orderBy: { displayOrder: "asc" } });
  const originals: DirectArchiveExecution["originals"][number][] = [];
  for (const [displayOrder, fileId] of input.fileIds.entries()) {
    const frozen = record(files[displayOrder]), attachment = attachments[displayOrder];
    const row = await tx.fileObject.findUnique({ where: { id: fileId } });
    if (frozen.fileId !== fileId || frozen.displayOrder !== displayOrder || attachments.length !== files.length
      || attachment?.fileId !== fileId || attachment.slotKey !== "direct_signed_originals_v1" || attachment.displayOrder !== displayOrder
      || !row || row.uploadedByUserId !== actor || row.storageStatus !== "active" || row.purgeReceiptId !== null || row.supersedesFileObjectId !== null
      || !row.bucket || !row.objectKey || row.mimeType !== frozen.mimeType || row.sizeBytes !== frozen.sizeBytes || row.contentSha256 !== frozen.contentSha256
      || !["application/pdf", "image/jpeg", "image/png"].includes(row.mimeType) || !row.contentSha256 || !/^[a-f0-9]{64}$/u.test(row.contentSha256)
      || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) changed();
    originals.push({ fileId, displayOrder, bucket: row.bucket, objectKey: row.objectKey, mimeType: row.mimeType,
      sizeBytes: row.sizeBytes, contentSha256: row.contentSha256 });
  }
  const command: UpwardDirectExecution = { actor, projectId: owner.projectId, contractId: owner.id, versionId,
    revision: input.expectedDraftRevision, inputSha256: prepared.inputSha256, key: input.idempotencyKey,
    nativeNonce: prepared.nativeNonce, originals, requestSha256, Q: q, qText: prepared.qText };
  return { requestSha256, execute: () => authority.execute(command) };
}

export function usesUpwardDirectArchive(parent: ContractArchiveFile) {
  return parent.archiveSource === "direct_signed" && record(parent.authoritySnapshot).recipeVersion === "contract-upward-direct-archive-v1/1";
}
