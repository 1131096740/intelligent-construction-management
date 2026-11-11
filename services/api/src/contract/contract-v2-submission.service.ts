import { assertNotDirectPendingVersion } from "./contract-direct-pending-policy";
import { freezeGeneratedContractSigningIdentity } from "./contract-v2-signing-identity";
import { assertGeneratedArchiveSealSources, generatedArchiveSealScope } from "./contract-generated-archive-seal-authority";
import { assertGeneratedArchiveSealContinuity, qualifyGeneratedArchiveSealAuthority } from "./contract-generated-archive-installation";
import { assertGeneratedUpwardSealCompletionContinuity, assertGeneratedUpwardSealHandoffContinuity,
  assertGeneratedUpwardSubmissionContinuity, qualifyGeneratedUpwardSealCompletion, qualifyGeneratedUpwardSealHandoff } from "./contract-upward-pending-save-profile";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractDraftSubmissionRequest, type ContractVersion } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { AuditService } from "../audit/audit.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { assertSelectableLayoutVersion } from "../contract-template/layout-selection-policy";
import { confirmedLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { SubmitContractDraftDto } from "../contract-workbench/dto/contract-workbench.dto";
import { assertFormalContractCodeNotTombstoned } from "../contract-workbench/contract-formal-code-tombstone";
import { lockContractDraftMutationBoundary } from "./contract-draft-lifecycle";
import { ContractApprovalRouteService } from "./contract-approval-route.service";
import { resolveContractOriginators } from "./contract-originators";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { contractParallelApprovalEpoch, contractParallelDutyIdentity, contractRoundSubmissionSnapshot, hasActiveContractGlobalRole } from "./contract-parallel-duty-access";
import { ConfirmContractSealV2Dto } from "./dto/contract-lifecycle-v2.dto";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { clearApprovalRoundSignatureSnapshots, snapshotApprovalSignature, withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { AuthService } from "../auth/auth.service";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
function conflict(message: string): never { throw new ConflictException(message); }

class SubmissionKeyCollision extends Error {}

function submissionReceiptUnavailable() {
  return new ServiceUnavailableException("提交回执尚未完整核对，请保留本次标识并查询结果，不要重复发起提交");
}

type SubmissionIdentity = { contractVersionId: string; actorUserId: string; requestSha256: string };

/** Explicit v2 consumer of saved Task10 outputs. Legacy serial submissions stay separate. */
@Injectable()
export class ContractV2SubmissionService {
  constructor(private readonly prisma: PrismaService, private readonly files: FileService,
    private readonly routes: ContractApprovalRouteService, private readonly numbers: BusinessNumberingService,
    private readonly audit: AuditService, private readonly auth: AuthService) {}

  async reviewIfV2(contractVersionId: string, actorUserId: string, input: ReviewContractApprovalDto) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE`);
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      if (version?.numericProtocolVersion !== 2) return null;
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${input.expectedApprovalInstanceId} FOR UPDATE`);
      const round = await tx.approvalInstance.findUnique({ where: { id: input.expectedApprovalInstanceId } });
      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
      const activeRounds = await tx.approvalInstance.findMany({ where: { businessType: "contract_version", businessId: version.id, flowType: "contract.approve", status: "in_progress" } });
      const snapshot = contractRoundSubmissionSnapshot(round?.frozenNodes);
      if (!contract || contract.voidedAt || version.status !== "in_approval" || !round || activeRounds.length !== 1 || activeRounds[0].id !== round.id || round.businessId !== version.id || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || !isParallelApprovalRound(round.frozenNodes) || !snapshot || snapshot.contractVersionId !== version.id || snapshot.documentContentRevision !== version.documentContentRevision || snapshot.documentContentFingerprint !== version.documentContentFingerprint) conflict("当前合同审批轮次已变化，请刷新后重试");
      const matchesReviewContext = input.expectedParallelApprovalEpoch === undefined
        ? version.updatedAt.getTime() === Date.parse(input.expectedContractUpdatedAt) &&
          round.updatedAt.getTime() === Date.parse(input.expectedApprovalUpdatedAt)
        : contractParallelApprovalEpoch(version, round) === input.expectedParallelApprovalEpoch;
      if (!matchesReviewContext) conflict("当前合同或审批资料已变化，请刷新后重试");
      if (input.decision === "reject_previous") throw new BadRequestException("并联审批没有上一节点，请填写意见并退回经办人");
      const identity = await contractParallelDutyIdentity(tx, round, contract.projectId, actorUserId, input.expectedNodeIndex);
      if (!identity) throw new ForbiddenException("当前账号无权处理这项合同审批职责");
      if (input.decision !== "approve" && !input.comment?.trim()) throw new BadRequestException("退回合同时请填写审批意见");
      const nodes = round.frozenNodes.map((node, index) => index === input.expectedNodeIndex && input.decision === "approve" ? { ...node, approvedRoleKeys: [...(node.approvedRoleKeys as string[]), identity.approvedRoleKey] } : node);
      const pending = activeApprovalNodeIndexes(nodes, 0);
      const status = input.decision !== "approve" ? "draft" : pending.length ? "in_approval" : "approved_pending_seal";
      const upwardSealHandoff = version.signingSubjectType === "upward" && status === "approved_pending_seal"
        ? await qualifyGeneratedUpwardSealHandoff(tx) : null;
      const selfReview = await confirmApprovalSelfReview({ applicantUserId: round.applicantUserId,
        originatorUserIds: await resolveContractOriginators(tx, version.id, round.frozenNodes), actorUserId,
        actorRoleKeys: identity.representedUserId === actorUserId ? [identity.approvedRoleKey] : [], ...identity,
        allowContractDirectorSelfReview: true, selfReviewReason: input.selfReviewReason, confirmationPassword: input.confirmationPassword,
        confirmPassword: password => this.auth.confirmPassword(actorUserId, password, tx) });
      const signature = input.decision === "approve" ? await snapshotApprovalSignature(tx, actorUserId, { required: true }) : null;
      const approvalAction = await tx.approvalActionLog.create({ data: await withApprovalIdentity(tx, {
        approvalInstanceId: round.id, action: input.decision, actorUserId, approvedRoleKey: identity.approvedRoleKey,
        representedUserId: identity.representedUserId, comment: input.comment?.trim() ?? null,
        signatureFileIdSnapshot: signature?.fileId, signatureSha256Snapshot: signature?.sha256, signatureVersionIdSnapshot: signature?.versionId,
        metadata: json({ nodeIndex: input.expectedNodeIndex, delegationId: identity.delegationId, ...selfReview.metadata })
      }, signature) });
      await tx.approvalInstance.update({ where: { id: round.id }, data: { frozenNodes: json(nodes), currentNodeIndex: pending[0] ?? nodes.length, status: input.decision !== "approve" ? "rejected" : pending.length ? "in_progress" : "approved" } });
      await tx.contractVersion.update({ where: { id: version.id }, data: { status } });
      if (status === "draft") await clearApprovalRoundSignatureSnapshots(tx, round.id);
      if (status === "approved_pending_seal") {
        // This is a confirmation handoff, never another seal-approval round.
        const existing = await tx.contractSealTask.findUnique({ where: { approvalInstanceId: round.id } });
        const active = await tx.contractSealTask.findFirst({ where: { contractVersionId: version.id, status: { not: "cancelled" } } });
        if (existing || active) conflict("当前合同已有盖章办理任务，请刷新后核对");
        const task = await tx.contractSealTask.create({ data: { contractVersionId: version.id, approvalInstanceId: round.id, handlerUserId: round.applicantUserId, status: "in_seal", approvedByUserId: approvalAction.actorUserId, approvedAt: approvalAction.createdAt } });
        await this.audit.record(tx, { actorUserId, action: "contract.seal_task.create", businessType: "contract_version", businessId: version.id,
          metadata: json({ submissionProtocolVersion: 2, sealTaskId: task.id, approvalInstanceId: round.id, handlerUserId: round.applicantUserId, pendingRoleKey: "comprehensive_director", handoffKind: "parallel_approval_released_for_offline_seal", internalApprovalActionId: approvalAction.id, internalApproverUserId: approvalAction.actorUserId }) });
      }
      await this.audit.record(tx, { actorUserId, action: `contract.approval.${input.decision}`, businessType: "contract_version", businessId: version.id, metadata: json({ approvalInstanceId: round.id, nodeIndex: input.expectedNodeIndex, approvedRoleKey: identity.approvedRoleKey, representedUserId: identity.representedUserId }) });
      if (upwardSealHandoff) await assertGeneratedUpwardSealHandoffContinuity(tx, upwardSealHandoff);
      return { contractVersionId, approvalInstanceId: round.id, status };
    });
  }

  async confirmSeal(contractVersionId: string, actorUserId: string, input: ConfirmContractSealV2Dto) {
    if (!input.confirmed) throw new BadRequestException("请核对线下盖章已完成后再确认");
    return this.prisma.$transaction(async tx => {
      const located = await tx.contractVersion.findUnique({ where: { id: contractVersionId },
        select: { contractId: true, signingSubjectType: true, numericProtocolVersion: true } });
      const locksExternalContract = located?.numericProtocolVersion === 2 && ["affiliate", "upward"].includes(located.signingSubjectType);
      if (locksExternalContract) {
        // Seal and archive both lock contract, version, round, task, then project.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Contract" WHERE "id" = ${located.contractId} FOR UPDATE`);
      }
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE`);
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      if (version?.numericProtocolVersion === 2 && ["affiliate", "upward"].includes(version.signingSubjectType)
        && (!locksExternalContract || version.contractId !== located?.contractId || version.signingSubjectType !== located.signingSubjectType)) {
        conflict("当前合同盖章来源已变化，请刷新后核对");
      }
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${input.expectedApprovalInstanceId} FOR UPDATE`);
      const round = await tx.approvalInstance.findUnique({ where: { id: input.expectedApprovalInstanceId } });
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractSealTask" WHERE "id" = ${input.expectedSealTaskId} FOR UPDATE`);
      const task = await tx.contractSealTask.findUnique({ where: { id: input.expectedSealTaskId } });
      const snapshot = contractRoundSubmissionSnapshot(round?.frozenNodes);
      if (!version || version.numericProtocolVersion !== 2 || !round || round.businessType !== "contract_version" || round.businessId !== version.id || round.flowType !== "contract.approve" || round.status !== "approved" || activeApprovalNodeIndexes(round.frozenNodes, 0).length || !task || task.contractVersionId !== version.id || task.approvalInstanceId !== round.id || task.handlerUserId !== round.applicantUserId || !snapshot || snapshot.contractVersionId !== version.id || snapshot.documentContentRevision !== input.documentContentRevision || snapshot.documentContentFingerprint !== input.documentContentFingerprint || version.documentContentRevision !== input.documentContentRevision || version.documentContentFingerprint !== input.documentContentFingerprint) conflict("盖章任务或正文已变化，请刷新后核对当前合同");
      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
      if (!contract || contract.voidedAt) conflict("当前合同不能确认盖章");
      if (!(await hasActiveContractGlobalRole(tx, actorUserId, "comprehensive_director"))) throw new ForbiddenException("只有当前综合部主管可以确认线下盖章完成");
      const result = { contractVersionId, approvalInstanceId: round.id, sealTaskId: task.id, status: "seal_approved_pending_archive" };
      if (task.status === "completed" && task.completedByUserId === actorUserId && ["seal_approved_pending_archive", "effective"].includes(version.status)) return result;
      if (version.status !== "approved_pending_seal" || task.status !== "in_seal" || !task.approvedByUserId || !task.approvedAt) conflict("当前盖章任务已处理，请刷新后重试");
      const scope = generatedArchiveSealScope(contract, version, round, task, snapshot, actorUserId, input.documentContentFingerprint);
      if (scope && (task.completedAt || task.completedByUserId)) conflict("当前盖章任务已有完成记录，请刷新后核对");
      const upwardCompletion = scope?.relationship === "upward" ? await qualifyGeneratedUpwardSealCompletion(tx) : null;
      if (scope) await tx.$queryRaw(Prisma.sql`SELECT "id", "isActive" FROM "Project" WHERE "id" = ${contract.projectId} FOR UPDATE`);
      const archiveAuthority = scope && await qualifyGeneratedArchiveSealAuthority(tx, scope);
      if (scope) await assertGeneratedArchiveSealSources(tx, scope, snapshot);
      const completedAt = new Date();
      await tx.contractSealTask.update({ where: { id: task.id }, data: { status: "completed", completedByUserId: actorUserId, completedAt } });
      await tx.contractVersion.update({ where: { id: version.id }, data: { status: "seal_approved_pending_archive" } });
      await this.audit.record(tx, { actorUserId, action: "contract.seal.complete", businessType: "contract_version", businessId: version.id,
        metadata: json({ ...result, documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint, confirmed: true, confirmationRoleKey: "comprehensive_director", handlerUserId: task.handlerUserId }) });
      await this.audit.record(tx, { actorUserId, action: "contract.archive_task.create", businessType: "contract_version", businessId: version.id,
        metadata: json({ approvalInstanceId: round.id, sealTaskId: task.id, handlerUserId: task.handlerUserId }) });
      if (scope) {
        await assertGeneratedArchiveSealSources(tx, scope, snapshot);
        if (!(await hasActiveContractGlobalRole(tx, actorUserId, "comprehensive_director"))) throw new ForbiddenException("当前账号已无权确认线下盖章完成");
        if (upwardCompletion) await assertGeneratedUpwardSealCompletionContinuity(tx, upwardCompletion);
        if (archiveAuthority) await assertGeneratedArchiveSealContinuity(tx, scope, archiveAuthority);
      }
      return result;
    });
  }

  /** Receipt lookup is a read of the original submission, not today's status. */
  async getSubmissionResult(contractVersionId: string, actorUserId: string, idempotencyKey: string) {
    return this.prisma.$transaction(async tx => {
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      const contract = version ? await tx.contract.findUnique({ where: { id: version.contractId } }) : null;
      if (!contract || contract.voidedAt || contract.ownerUserId !== actorUserId) throw new ForbiddenException("只有当前合同经办人可以核对本次提交结果");
      const receipt = await tx.contractDraftSubmissionRequest.findUnique({ where: { idempotencyKey } });
      if (!receipt || receipt.contractVersionId !== contractVersionId || receipt.applicantUserId !== actorUserId || version?.numericProtocolVersion !== 2) return { status: "unknown" as const };
      return (await this.proveSubmissionReceipt(tx, receipt)) ?? { status: "unknown" as const };
    });
  }

  private async proveSubmissionReceipt(tx: Prisma.TransactionClient, receipt: ContractDraftSubmissionRequest) {
    const { contractVersionId, applicantUserId: actorUserId } = receipt;
    const round = await tx.approvalInstance.findUnique({ where: { id: receipt.approvalInstanceId } });
    const snapshot = contractRoundSubmissionSnapshot(round?.frozenNodes);
    if (!round || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || round.businessId !== contractVersionId || round.applicantUserId !== actorUserId || !snapshot || snapshot.contractVersionId !== contractVersionId || snapshot.applicantUserId !== actorUserId || snapshot.draftRevision !== receipt.expectedRevision || snapshot.blanksReviewed !== true) return null;
    const intent = { expectedRevision: receipt.expectedRevision, submissionProtocolVersion: 2 as const,
      documentContentRevision: snapshot.documentContentRevision, documentContentFingerprint: snapshot.documentContentFingerprint,
      generatedDocumentId: snapshot.generatedDocumentId, sourceSha256: snapshot.sourceSha256, blanksReviewed: true };
    if (!Number.isInteger(intent.expectedRevision) || intent.expectedRevision < 1 || intent.expectedRevision > 2_147_483_647
      || !Number.isInteger(intent.documentContentRevision) || typeof intent.documentContentRevision !== "number" || intent.documentContentRevision < 1 || intent.documentContentRevision > 2_147_483_647
      || typeof intent.documentContentFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(intent.documentContentFingerprint)
      || typeof intent.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(intent.sourceSha256)
      || typeof intent.generatedDocumentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(intent.generatedDocumentId)
      || typeof snapshot.formalCode !== "string" || !snapshot.formalCode.trim() || receipt.formalCode !== snapshot.formalCode) return null;
    const requestSha256 = hash(JSON.stringify({ contractVersionId, actorUserId, ...intent }));
    const storedResult = receipt.responseSnapshot;
    if (requestSha256 !== receipt.requestSha256 || !storedResult || typeof storedResult !== "object" || Array.isArray(storedResult)
      || storedResult.contractVersionId !== contractVersionId || storedResult.approvalInstanceId !== round.id
      || storedResult.status !== "in_approval" || typeof storedResult.formalCode !== "string"
      || !storedResult.formalCode.trim() || storedResult.formalCode !== receipt.formalCode) return null;
    const result = { contractVersionId, approvalInstanceId: round.id, formalCode: receipt.formalCode, status: "in_approval" as const };
    return { status: "submitted" as const, result, requestSha256: receipt.requestSha256, intent };
  }

  private async replaySubmission(
    tx: Prisma.TransactionClient,
    receipt: ContractDraftSubmissionRequest,
    { contractVersionId, actorUserId, requestSha256 }: SubmissionIdentity,
    contract: Contract | null,
    version: ContractVersion | null
  ) {
    if (receipt.contractVersionId !== contractVersionId || receipt.applicantUserId !== actorUserId || receipt.requestSha256 !== requestSha256) conflict("本次提交标识已用于其他内容，请刷新后重新提交");
    if (!contract || contract.voidedAt || contract.ownerUserId !== actorUserId) throw new ForbiddenException("只有当前合同经办人可以核对本次提交结果");
    const proven = version?.numericProtocolVersion === 2 ? await this.proveSubmissionReceipt(tx, receipt) : null;
    if (!proven) throw submissionReceiptUnavailable();
    return proven.result;
  }

  async submit(contractVersionId: string, actorUserId: string, input: SubmitContractDraftDto, leaseToken?: string) {
    const requestSha256 = hash(JSON.stringify({ contractVersionId, actorUserId,
      expectedRevision: input.expectedRevision, submissionProtocolVersion: input.submissionProtocolVersion,
      documentContentRevision: input.documentContentRevision, documentContentFingerprint: input.documentContentFingerprint,
      generatedDocumentId: input.generatedDocumentId, sourceSha256: input.sourceSha256, blanksReviewed: input.blanksReviewed }));
    const expected = { contractVersionId, actorUserId, requestSha256 };
    return this.prisma.$transaction(async tx => {
      const boundary = await lockContractDraftMutationBoundary<NonNullable<Awaited<ReturnType<typeof tx.contractVersion.findUnique>>>>(tx, contractVersionId);
      if (!boundary) conflict("未找到当前合同，请刷新后重试");
      const version = boundary.version;
      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
      const receipt = await tx.contractDraftSubmissionRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (receipt) return this.replaySubmission(tx, receipt, expected, contract, version);
      if (!contract || contract.voidedAt || version.numericProtocolVersion !== 2 || version.changeType !== "original" || version.status !== "draft" || boundary.formalBlockers.length) conflict("当前合同不能从新版草稿入口提交");
      if (contract.ownerUserId !== actorUserId) throw new ForbiddenException("只有当前合同经办人可以提交审批");
      assertNotDirectPendingVersion(version);
      await tx.$queryRaw(Prisma.sql`SELECT "contractVersionId" FROM "ContractDraftEditLease" WHERE "contractVersionId" = ${contractVersionId} FOR UPDATE`);
      const lease = await tx.contractDraftEditLease.findUnique({ where: { contractVersionId } });
      if (!leaseToken || !lease || lease.holderUserId !== actorUserId || lease.expiresAt.getTime() <= Date.now() || lease.tokenHash !== hash(leaseToken)) conflict("编辑权已变化，请重新取得编辑权后提交");
      if (version.draftRevision !== input.expectedRevision || version.documentContentRevision !== input.documentContentRevision || version.documentContentFingerprint !== input.documentContentFingerprint) conflict("合同正文或资料已变化，请保存并重新检查当前正文");
      if (!input.blanksReviewed || !version.layoutTemplateVersionId) conflict("请先检查当前正文的空位，再确认继续提交");
      const layout = await assertSelectableLayoutVersion(tx, this.files, version.layoutTemplateVersionId, contract.contractTypeKey);
      const mapping = confirmedLayoutSourceMapping(layout);
      if (!mapping || mapping.sourceSha256 !== input.sourceSha256) conflict("合同模板原文已变化，请重新检查当前正文");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractGeneratedDocument" WHERE "id" = ${input.generatedDocumentId} FOR UPDATE`);
      const document = await tx.contractGeneratedDocument.findUnique({ where: { id: input.generatedDocumentId } });
      const trace = document?.inputSnapshot as Prisma.JsonObject | undefined;
      const sourceMapping = trace?.layoutSourceMapping as Prisma.JsonObject | undefined;
      if (!document || document.contractVersionId !== contractVersionId || document.status !== "success" || document.layoutTemplateVersionId !== layout.id || document.sourceRevision !== version.draftRevision || trace?.documentContentRevision !== version.documentContentRevision || trace?.documentContentFingerprint !== version.documentContentFingerprint || trace?.templateFileId !== layout.docxFileId || sourceMapping?.sourceSha256 !== mapping.sourceSha256 || !document.docxFileId || !document.pdfFileId || document.docxFileId === document.pdfFileId) conflict("当前正文的Word和PDF尚未就绪，请生成当前版本后再提交");
      const frozenFiles = [];
      for (const [id, mime] of [[document.docxFileId, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], [document.pdfFileId, "application/pdf"]]) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FileObject" WHERE "id" = ${id} FOR SHARE`);
        const file = await tx.fileObject.findUnique({ where: { id } });
        const stored = await this.files.getFileBuffer(id).catch(() => conflict("当前正文文件不可读取或校验失败，请重新生成后提交"));
        if (!file || file.storageStatus !== "active" || file.mimeType !== mime || file.contentSha256 !== hash(stored.buffer) || file.sizeBytes !== stored.buffer.length) conflict("当前正文文件校验失败，请重新生成后提交");
        frozenFiles.push({ fileId: id, contentSha256: file.contentSha256, sizeBytes: file.sizeBytes, mimeType: file.mimeType });
      }
      const [parties, bills, paymentTerms, attachments] = await Promise.all([
        tx.contractPartySnapshot.findMany({ where: { contractVersionId } }), tx.contractBill.findMany({ where: { contractVersionId } }),
        tx.paymentTermsVersion.findFirst({ where: { contractVersionId }, orderBy: { createdAt: "desc" } }), tx.contractDraftAttachment.findMany({ where: { contractVersionId } })
      ]);
      // Freeze the route's project lock before taking either signing-party lock.
      const route = await this.routes.freezeNewContractRoute(tx, contract, actorUserId, true);
      const submissionTime = new Date();
      const signing = await freezeGeneratedContractSigningIdentity(tx, version, contract, parties, document.inputSnapshot, submissionTime);
      const { formalVersion, identity, upward: upwardSigning } = signing;
      const rows = await tx.contractBillRow.findMany({ where: { contractBillId: { in: bills.map(bill => bill.id) } } });
      const stages = paymentTerms ? await tx.paymentTermsStage.findMany({ where: { paymentTermsVersionId: paymentTerms.id } }) : [];
      const originatorUserIds = [...new Set([...(await resolveContractOriginators(tx, version.id)), actorUserId])].sort();
      const frozenNodes = route.map(node => ({ ...node, originatorUserIds }));
      const formalCode = contract.code ?? await this.numbers.allocateDaily(tx, "HT");
      await assertFormalContractCodeNotTombstoned(tx, formalCode);
      // A mutable current-version projection must never be the only copy of a
      // submitted round. Omit its prior projection to avoid recursive snapshots.
      const { readinessSnapshot: _previousSubmission, ...versionFacts } = formalVersion;
      void _previousSubmission;
      const snapshot = json({ submissionProtocolVersion: 2, contractVersionId, applicantUserId: actorUserId, draftRevision: version.draftRevision,
        documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
        layoutTemplateVersionId: layout.id, businessTemplateVersionId: version.businessTemplateVersionId, sourceSha256: mapping.sourceSha256,
        formalCode, versionFacts, signingIdentity: identity, templateSnapshot: version.templateSnapshot, layoutSnapshot: layout, draftData: version.draftData, clauseSnapshot: version.clauseSnapshot,
        amountYuan: version.amountYuan?.toFixed(4) ?? null,
        taxFacts: { invoiceType: version.invoiceType, taxMode: version.taxMode, defaultTaxRatePercent: version.defaultTaxRatePercent }, parties, bills, rows, paymentTerms: paymentTerms ? { ...paymentTerms, stages } : null,
        attachments, generatedDocumentId: document.id, files: frozenFiles, blanksReviewed: true });
      const round = await tx.approvalInstance.create({ data: { businessType: "contract_version", businessId: contractVersionId, flowType: "contract.approve", applicantUserId: actorUserId, status: "in_progress", currentNodeIndex: 0, frozenNodes: json(frozenNodes.map((node, index) => index === 0 ? { ...node, submissionSnapshot: snapshot } : node)) } });
      await tx.contractVersion.update({ where: { id: contractVersionId }, data: { ...upwardSigning?.subjectUpdate, status: "in_approval", firstSubmittedAt: version.firstSubmittedAt ?? submissionTime, readinessSnapshot: snapshot } });
      await tx.contract.update({ where: { id: contract.id }, data: { code: formalCode } });
      const response = { contractVersionId, approvalInstanceId: round.id, formalCode, status: "in_approval" };
      try {
        await tx.contractDraftSubmissionRequest.create({ data: { idempotencyKey: input.idempotencyKey, contractVersionId, expectedRevision: input.expectedRevision, applicantUserId: actorUserId, requestSha256, approvalInstanceId: round.id, formalCode, responseSnapshot: response } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const { modelName, target } = error.meta ?? {};
          if ((modelName === undefined || modelName === "ContractDraftSubmissionRequest")
            && (target === "ContractDraftSubmissionRequest_pkey" || (Array.isArray(target) && target.length === 1 && target[0] === "idempotencyKey"))) {
            throw new SubmissionKeyCollision();
          }
        }
        throw error;
      }
      await this.audit.record(tx, { actorUserId, action: "contract.approval.submit", businessType: "contract_version", businessId: contractVersionId, metadata: json(response) });
      if (upwardSigning) await assertGeneratedUpwardSubmissionContinuity(tx, upwardSigning.qualification);
      return response;
    }).catch(error => {
      if (!(error instanceof SubmissionKeyCollision)) throw error;
      // The failed write has rolled back. Only read and verify the committed winner.
      return this.prisma.$transaction(async tx => {
        const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
        const contract = version ? await tx.contract.findUnique({ where: { id: version.contractId } }) : null;
        const receipt = await tx.contractDraftSubmissionRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (!receipt) throw submissionReceiptUnavailable();
        return this.replaySubmission(tx, receipt, expected, contract, version);
      }).catch(readError => {
        if (readError instanceof HttpException) throw readError;
        throw submissionReceiptUnavailable();
      });
    });
  }
}
