import { ServiceUnavailableException } from "@nestjs/common";
import { assertContractV2ArchivePersistentProof } from "./contract-v2-archive-persistent-proof";
import { isDeepStrictEqual } from "node:util";
import type { Contract, ContractVersion, Prisma } from "@prisma/client";
import { chinaDateOnly, type ContractV2LifecycleReadModel, type ContractV2LifecycleActionReadModel } from "@jiangkong/shared-domain";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { contractRoundSubmissionSnapshot, hasActiveContractGlobalRole } from "./contract-parallel-duty-access";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";

const WEB_WRITE_CLOSED = "新版合同办理入口尚未开放";
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function action(key: ContractV2LifecycleActionReadModel["key"], eligible: boolean, reason: string): ContractV2LifecycleActionReadModel {
  return { key, eligible, enabled: false, reason: eligible ? WEB_WRITE_CLOSED : reason };
}

/** Read hint only. Commands independently recheck current authority in their TX. */
export async function readContractV2LifecycleContext(
  tx: Prisma.TransactionClient, contract: Contract, version: ContractVersion,
  actorUserId: string | undefined, historyReadOnly: boolean
): Promise<ContractV2LifecycleReadModel | undefined> {
  if (version.numericProtocolVersion !== 2) return undefined;
  const unavailable = (reason: string): ContractV2LifecycleReadModel => ({
    protocolVersion: 2, contractVersionId: version.id, webWriteReleased: false,
    status: "unavailable", state: "unavailable", reason,
    sealAction: action("confirm_seal_v2", false, reason), archiveAction: action("archive_signed_v2", false, reason)
  });
  if (historyReadOnly) return unavailable("历史版本仅供查阅，不能办理当前盖章或归档");
  if (contract.voidedAt || version.changeType !== "original" || version.supersedesVersionId || version.signingSubjectType !== "our_company") return unavailable("当前签约来源尚未支持此办理入口");
  if (!actorUserId || !(await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } }))?.isActive) return unavailable("当前登录身份不可办理合同");
  const tasks = await tx.contractSealTask.findMany({ where: { contractVersionId: version.id, status: { not: "cancelled" } } });
  if (tasks.length !== 1) return unavailable("当前盖章任务来源尚未完整确认");
  const task = tasks[0];
  const round = await tx.approvalInstance.findUnique({ where: { id: task.approvalInstanceId } });
  const snapshot = contractRoundSubmissionSnapshot(round?.frozenNodes);
  if (!round || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || round.businessId !== version.id || round.status !== "approved" || activeApprovalNodeIndexes(round.frozenNodes, 0).length || !snapshot || snapshot.contractVersionId !== version.id || snapshot.documentContentRevision !== version.documentContentRevision || snapshot.documentContentFingerprint !== version.documentContentFingerprint || !version.documentContentFingerprint || round.applicantUserId !== contract.ownerUserId || task.handlerUserId !== contract.ownerUserId) return unavailable("当前审批轮次或正文已变化，请核对当前合同");
  const identity = object(snapshot.signingIdentity), company = object(identity?.company);
  if (identity?.relationship !== "inside" || company?.id !== version.companyEntityVersionId || company?.companyEntityId !== version.companyEntityIdSnapshot) return unavailable("当前签约主体与审批冻结来源不一致");
  if (typeof snapshot.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(snapshot.sourceSha256)) return unavailable("当前审批文书原文校验来源不完整");
  const counterparty = await tx.contractPartySnapshot.findFirst({ where: { contractVersionId: version.id, roleKey: "party_b" }, orderBy: { displayOrder: "asc" } });
  if (!counterparty?.businessPartyVersionId) return unavailable("当单相对方的后续归档尚未开放，请保留原合同资料");
  const frozenParties = Array.isArray(snapshot.parties) ? snapshot.parties.map(object) : [];
  if (counterparty.contractVersionId !== version.id || !frozenParties.some(party => party?.id === counterparty.id && party?.roleKey === "party_b" && party?.displayOrder === counterparty.displayOrder && party?.businessPartyVersionId === counterparty.businessPartyVersionId)) return unavailable("当前相对方身份与本轮冻结来源不一致");
  const partyVersion = await tx.businessPartyVersion.findUnique({ where: { id: counterparty.businessPartyVersionId }, select: { id: true } });
  if (!partyVersion || partyVersion.id !== counterparty.businessPartyVersionId) return unavailable("受控相对方版本来源尚未完整确认");
  const generatedId = snapshot.generatedDocumentId;
  if (typeof generatedId !== "string" || !generatedId) return unavailable("当前审批文书来源未完整确认");
  const generated = await tx.contractGeneratedDocument.findUnique({ where: { id: generatedId } });
  const trace = object(generated?.inputSnapshot), layout = object(snapshot.layoutSnapshot), mapping = object(trace?.layoutSourceMapping);
  const refs = Array.isArray(snapshot.files) ? snapshot.files.map(object) : [];
  if (!generated || generated.contractVersionId !== version.id || generated.status !== "success" || generated.sourceRevision !== snapshot.draftRevision || generated.layoutTemplateVersionId !== snapshot.layoutTemplateVersionId || trace?.documentContentRevision !== snapshot.documentContentRevision || trace?.documentContentFingerprint !== snapshot.documentContentFingerprint || trace?.templateFileId !== layout?.docxFileId || mapping?.sourceSha256 !== snapshot.sourceSha256 || refs.length !== 2 || refs.some(ref => !ref) || !generated.docxFileId || !generated.pdfFileId || generated.docxFileId === generated.pdfFileId) return unavailable("当前Word及PDF审批文书来源尚未就绪");
  if (refs.some(ref => !ref || typeof ref.fileId !== "string" || !ref.fileId.trim() || typeof ref.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(ref.contentSha256) || typeof ref.sizeBytes !== "number" || !Number.isInteger(ref.sizeBytes) || ref.sizeBytes <= 0)) return unavailable("当前审批文书的文件校验元数据不完整");
  const word = refs.filter(ref => ref?.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const pdf = refs.filter(ref => ref?.mimeType === "application/pdf");
  if (word.length !== 1 || pdf.length !== 1 || word[0]?.fileId !== generated.docxFileId || pdf[0]?.fileId !== generated.pdfFileId || refs[0]?.fileId !== generated.docxFileId || refs[1]?.fileId !== generated.pdfFileId) return unavailable("当前Word及PDF双格式引用不完整");
  const files = await tx.fileObject.findMany({ where: { id: { in: [generated.docxFileId, generated.pdfFileId] } }, select: { id: true, storageStatus: true, mimeType: true, sizeBytes: true, contentSha256: true } });
  if (files.length !== 2 || refs.some(ref => !files.some(file => file.id === ref?.fileId && file.storageStatus === "active" && file.mimeType === ref.mimeType && file.sizeBytes === ref.sizeBytes && file.contentSha256 === ref.contentSha256))) return unavailable("当前审批文书的文件元数据已变化");
  let state: "pending_seal" | "pending_archive" | "archived";
  if (version.status === "approved_pending_seal" && task.status === "in_seal" && task.approvedAt && task.approvedByUserId && !task.completedAt && !task.completedByUserId) state = "pending_seal";
  else if (version.status === "seal_approved_pending_archive" && task.status === "completed" && task.completedAt && task.completedByUserId) state = "pending_archive";
  else if (version.status === "effective" && task.status === "completed" && task.completedAt && task.completedByUserId) {
    const archive = await tx.contractArchiveFile.findFirst({ where: { contractVersionId: version.id, archiveProtocolVersion: 2, status: "confirmed" } });
    const authority = object(archive?.authoritySnapshot), basis = object(authority?.sourceBasis), evidence = object(basis?.versionEvidence);
    if (!archive || archive.archiveProtocolVersion !== 2 || archive.archiveSource !== "generated_approval" || archive.approvalInstanceId !== round.id || archive.sealTaskId !== task.id || archive.documentContentRevision !== version.documentContentRevision || archive.documentContentFingerprint !== version.documentContentFingerprint || !archive.confirmedAt || archive.confirmedAt.getTime() !== version.effectiveAt?.getTime() || !archive.authoritySha256 || !archive.fileManifestSha256 || authority?.projectId !== contract.projectId || authority?.contractVersionId !== version.id || evidence?.generatedDocumentId !== generated.id || !isDeepStrictEqual(evidence.generatedDocumentFiles, { word: word[0], pdf: pdf[0] })) return unavailable("当前归档权威尚未完整确认，请查询原归档标识");
    try { await assertContractV2ArchivePersistentProof(tx, contract, version, archive); }
    catch (error) {
      if (error instanceof ServiceUnavailableException) return unavailable("当前归档持久证据尚未完整确认，请查询原归档标识");
      throw error;
    }
    state = "archived";
  } else return unavailable("当前合同或盖章任务状态不可办理");
  const canSeal = state === "pending_seal" && await hasActiveContractGlobalRole(tx, actorUserId, "comprehensive_director");
  let archiveReason = state === "pending_archive" ? "仅当前原经办人且具备项目合同上传权限可归档" : "当前不处于待归档阶段";
  let canArchive = state === "pending_archive" && actorUserId === contract.ownerUserId && (await resolveGovernedFinalArchiveAccess(tx, { actorUserId, projectId: contract.projectId, handlerUserId: task.handlerUserId })).canUpload;
  if (state === "pending_archive") {
    const project = await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true } });
    const participant = typeof company.projectParticipatingCompanyId === "string" ? await tx.projectParticipatingCompany.findUnique({ where: { id: company.projectParticipatingCompanyId } }) : null;
    const day = new Date(`${chinaDateOnly(new Date())}T00:00:00.000Z`);
    if (!project?.isActive) { canArchive = false; archiveReason = "项目当前不可办理归档"; }
    else if (!participant || participant.projectId !== contract.projectId || participant.companyEntityId !== version.companyEntityIdSnapshot || participant.effectiveFrom > day || participant.endedAt && participant.endedAt <= day) {
      canArchive = false; archiveReason = "签约公司在当前归档日期的项目参与资格已变化";
    }
  }
  return { protocolVersion: 2, contractVersionId: version.id, status: "ready", source: "generated_approval", scope: "inside_original", webWriteReleased: false, actorUserId,
    approvalInstanceId: round.id, sealTaskId: task.id, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
    state, sealAction: action("confirm_seal_v2", canSeal, state === "pending_seal" ? "仅当前有效综合主管可确认已盖章" : "当前不处于待盖章确认阶段"),
    archiveAction: action("archive_signed_v2", canArchive, archiveReason),
    sealOutcome: { status: task.status === "completed" ? "completed" : "pending", completedAt: task.completedAt?.toISOString() ?? null, completedByUserId: task.completedByUserId },
    approvalSource: { status: "references_ready" }, signedFilePolicy: { mimeType: "application/pdf", minCount: 1, maxCount: 20, ordered: true } };
}
