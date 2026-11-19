import { ConflictException } from "@nestjs/common";
import type { ApprovalInstance, Contract, ContractSealTask, ContractVersion, Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import type { GeneratedArchiveSealFile, GeneratedArchiveSealScope } from "./contract-generated-archive-installation";

const wordMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const pdfMime = "application/pdf";
const isId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function frozenFile(value: unknown, mimeType: string): GeneratedArchiveSealFile {
  const file = object(value);
  if (!isId(file.fileId) || file.mimeType !== mimeType || !isSha256(file.contentSha256)
    || typeof file.sizeBytes !== "number" || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) {
    throw new ConflictException("本轮Word及PDF生成来源不完整，请核对当前合同");
  }
  return { fileId: file.fileId, mimeType, sizeBytes: file.sizeBytes, contentSha256: file.contentSha256 };
}

export function generatedArchiveSealScope(
  contract: Contract, version: ContractVersion, round: ApprovalInstance, task: ContractSealTask,
  snapshot: Record<string, unknown>, actorUserId: string, documentContentFingerprint: string
): GeneratedArchiveSealScope | null {
  const identity = object(snapshot.signingIdentity);
  const relationship = identity.relationship;
  if (relationship !== "outside" && relationship !== "upward"
    && version.signingSubjectType !== "affiliate" && version.signingSubjectType !== "upward") return null;
  const facts = object(snapshot.versionFacts);
  const enterprise = object(identity.enterprise);
  const company = object(identity.company);
  const downstream = object(identity.downstream);
  const subjectChanged = () => new ConflictException("本轮签约主体或原经办人已变化，请核对当前合同");
  if ((relationship !== "outside" && relationship !== "upward")
    || version.signingSubjectType !== (relationship === "upward" ? "upward" : "affiliate")
    || version.changeType !== "original" || version.versionNo !== 1 || version.supersedesVersionId
    || contract.ownerUserId !== round.applicantUserId || snapshot.applicantUserId !== round.applicantUserId
    || facts.id !== version.id || facts.contractId !== contract.id || facts.signingSubjectType !== version.signingSubjectType
    || !isId(contract.code) || contract.code !== snapshot.formalCode
    || identity.protocolVersion !== 1
    || enterprise.domain !== "project_affiliate_assignment" || !isId(enterprise.assignmentId)
    || !isId(enterprise.businessPartyId) || !isId(enterprise.businessPartyVersionId) || !isId(enterprise.partySnapshotId)
    || enterprise.displayOrder !== 0 || enterprise.assignmentId !== version.affiliateAssignmentId
    || enterprise.businessPartyVersionId !== version.affiliateBusinessPartyVersionId
    || facts.affiliateNameSnapshot !== version.affiliateNameSnapshot
    || facts.affiliateCreditCodeSnapshot !== version.affiliateCreditCodeSnapshot) throw subjectChanged();
  if (relationship === "upward") {
    if (identity.roleSource !== "document_company_selection_party_a_and_assignment_party_b"
      || enterprise.roleKey !== "party_b" || company.domain !== "company_entity_version" || company.roleKey !== "party_a"
      || company.displayOrder !== 0 || !isId(company.id) || !isId(company.companyEntityId)
      || !isId(company.projectParticipatingCompanyId) || !isId(company.joinedCompanyEntityVersionId)
      || company.id !== version.companyEntityVersionId || company.companyEntityId !== version.companyEntityIdSnapshot
      || company.companyEntityId !== contract.companyEntityId || facts.companyEntityNameSnapshot !== version.companyEntityNameSnapshot
      || facts.companyEntityCreditCodeSnapshot !== version.companyEntityCreditCodeSnapshot
      || facts.companyEntityRegisteredAddressSnapshot !== version.companyEntityRegisteredAddressSnapshot) throw subjectChanged();
  } else if (identity.roleSource !== "document_party_snapshots" || contract.companyEntityId || version.companyEntityIdSnapshot || version.companyEntityVersionId
    || (enterprise.roleKey !== "party_a" && enterprise.roleKey !== "party_b")
    || downstream.roleKey !== (enterprise.roleKey === "party_a" ? "party_b" : "party_a") || downstream.displayOrder !== 0
    || !isId(downstream.partySnapshotId) || downstream.partySnapshotId === enterprise.partySnapshotId
    || (downstream.domain === "business_party_version"
      ? !isId(downstream.businessPartyId) || !isId(downstream.businessPartyVersionId) || downstream.businessPartyId === enterprise.businessPartyId
      : downstream.domain !== "contract_party_snapshot" || downstream.businessPartyId !== null || downstream.businessPartyVersionId !== null)) {
    throw subjectChanged();
  }

  if (!isId(snapshot.generatedDocumentId) || !isId(snapshot.layoutTemplateVersionId) || !isSha256(snapshot.sourceSha256)
    || snapshot.layoutTemplateVersionId !== version.layoutTemplateVersionId || snapshot.draftRevision !== version.draftRevision
    || !Array.isArray(snapshot.files) || snapshot.files.length !== 2) {
    throw new ConflictException("本轮Word及PDF生成来源不完整，请核对当前合同");
  }
  const word = frozenFile(snapshot.files[0], wordMime), pdf = frozenFile(snapshot.files[1], pdfMime);
  if (word.fileId === pdf.fileId) throw new ConflictException("本轮Word及PDF生成来源不完整，请核对当前合同");
  return {
    relationship, projectId: contract.projectId, contractId: contract.id, contractVersionId: version.id,
    approvalInstanceId: round.id, sealTaskId: task.id, handlerUserId: task.handlerUserId, actorUserId,
    documentContentRevision: version.documentContentRevision, documentContentFingerprint, sourceRevision: version.draftRevision,
    layoutTemplateVersionId: snapshot.layoutTemplateVersionId, sourceSha256: snapshot.sourceSha256,
    signingIdentity: copyJson(identity), generatedDocumentId: snapshot.generatedDocumentId, files: [word, pdf]
  };
}

export async function assertGeneratedArchiveSealSources(tx: Prisma.TransactionClient, scope: GeneratedArchiveSealScope,
  snapshot: Record<string, unknown>) {
  const contract = await tx.contract.findUnique({ where: { id: scope.contractId } });
  const companyId = object(scope.signingIdentity.company).companyEntityId;
  if (!contract || contract.voidedAt || contract.projectId !== scope.projectId || contract.ownerUserId !== scope.handlerUserId
    || contract.code !== snapshot.formalCode || (scope.relationship === "upward" ? contract.companyEntityId !== companyId : Boolean(contract.companyEntityId))) {
    throw new ConflictException("本轮签约主体或原经办人已变化，请核对当前合同");
  }
  const project = await tx.project.findUnique({ where: { id: scope.projectId }, select: { id: true, isActive: true } });
  if (!project || project.id !== scope.projectId || !project.isActive) {
    throw new ConflictException("当前项目不可办理归档，请核对项目状态");
  }
  const tasks = await tx.contractSealTask.findMany({ where: { contractVersionId: scope.contractVersionId, status: { not: "cancelled" } } });
  if (tasks.length !== 1 || tasks[0].id !== scope.sealTaskId) throw new ConflictException("当前合同盖章任务已变化，请刷新后核对");
  const access = await resolveGovernedFinalArchiveAccess(tx, { actorUserId: scope.handlerUserId, projectId: scope.projectId, handlerUserId: scope.handlerUserId });
  if (!access.canUpload) throw new ConflictException("原合同经办人当前无归档权限，请先核对项目职责");

  const signedParties = scope.relationship === "outside"
    ? [object(scope.signingIdentity.enterprise), object(scope.signingIdentity.downstream)]
    : [object(scope.signingIdentity.enterprise)];
  const liveParties = await tx.contractPartySnapshot.findMany({ where: { contractVersionId: scope.contractVersionId, roleKey: { in: ["party_a", "party_b"] } } });
  const frozenParties = Array.isArray(snapshot.parties) ? snapshot.parties.map(object) : [];
  if (liveParties.length !== signedParties.length || !signedParties.every(identity => {
    const live = liveParties.find(party => party.id === identity.partySnapshotId);
    const frozen = frozenParties.find(party => party.id === identity.partySnapshotId);
    return live && frozen && live.roleKey === identity.roleKey && frozen.roleKey === live.roleKey
      && live.displayOrder === identity.displayOrder && frozen.displayOrder === live.displayOrder
      && (live.businessPartyVersionId ?? null) === identity.businessPartyVersionId
      && (frozen.businessPartyVersionId ?? null) === identity.businessPartyVersionId && isDeepStrictEqual(live.snapshot, frozen.snapshot);
  })) throw new ConflictException("本轮甲乙方资料已变化，请核对当前合同");

  const generated = await tx.contractGeneratedDocument.findUnique({ where: { id: scope.generatedDocumentId } });
  const trace = object(generated?.inputSnapshot), layout = object(snapshot.layoutSnapshot);
  const [word, pdf] = scope.files;
  const files = await tx.fileObject.findMany({ where: { id: { in: [word.fileId, pdf.fileId] } } });
  if (!generated || generated.status !== "success" || generated.contractVersionId !== scope.contractVersionId
    || generated.sourceRevision !== scope.sourceRevision || generated.layoutTemplateVersionId !== scope.layoutTemplateVersionId
    || trace.documentContentRevision !== scope.documentContentRevision || trace.documentContentFingerprint !== scope.documentContentFingerprint
    || !isId(layout.docxFileId) || trace.templateFileId !== layout.docxFileId
    || object(trace.layoutSourceMapping).sourceSha256 !== scope.sourceSha256
    || generated.docxFileId !== word.fileId || generated.pdfFileId !== pdf.fileId || files.length !== 2
    || !scope.files.every(ref => files.some(file => file.id === ref.fileId && file.storageStatus === "active"
      && file.mimeType === ref.mimeType && file.sizeBytes === ref.sizeBytes && file.contentSha256 === ref.contentSha256))) {
    throw new ConflictException("本轮Word及PDF生成来源已变化，请核对当前合同");
  }
}
