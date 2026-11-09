import { assertNotDirectPendingVersion } from "./contract-direct-pending-policy";
import { assertDirectPendingSourceQualification, hasDirectSigningInput } from "./contract-direct-pending-source";
import { readDirectPendingInput } from "./contract-direct-pending-save";
import { assertDirectArchivePersistentProof } from "./contract-direct-archive-persistent-proof";
import { readDirectArchivePreflightProfile, rejectUnqualifiedDirectArchiveWriter } from "./contract-direct-archive-writer-profile";
import { readDirectArchiveNativeAdmission } from "./contract-direct-archive-native-admission";
import { DIRECT_ARCHIVE_EXECUTOR, type DirectArchiveExecution, type DirectArchiveExecutor } from "./contract-direct-archive-executor";
import { assertDirectArchiveSourceScope } from "./contract-direct-archive-scope";
import { assertDirectArchiveIntentSourceClosed } from "./contract-direct-archive-intent-source";
import { directArchiveRequestSha } from "./contract-direct-archive-request";
import { requiresGeneratedArchiveOriginals } from "./contract-generated-archive-original-read";
import { assertContractV2ArchivePersistentProof } from "./contract-v2-archive-persistent-proof";
import { archiveRequestSha } from "./contract-archive-request-digest";
import { tryAcquireFileBusinessBindingTransactionLock } from "../file/file-business-binding";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PDFDocument } from "pdf-lib";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { AuditService } from "../audit/audit.service";
import { ArchiveSignedContractV2Dto, type ContractArchiveBindingBusyResponse, type RegisterDirectSignedContractV2Dto } from "./dto/contract-lifecycle-v2.dto";
import { contractRoundSubmissionSnapshot } from "./contract-parallel-duty-access";
import { latestEconomicReviews, excludedAmountYuan, reviewAppliesToVersion } from "../contract-ledger/contract-economic-coverage";
import { assertDirectReviewQualification } from "../contract-ledger/contract-direct-review-qualification";
import { readStoredDirectReviewPins } from "../contract-ledger/contract-direct-review-source";
import { ContractVersionActivationService } from "./contract-version-activation.service";
import { assertGeneratedArchiveSealSources, generatedArchiveSealScope } from "./contract-generated-archive-seal-authority";
import { assertGeneratedArchiveRequestBinding, GENERATED_ARCHIVE_PREPARATION_READER, prepareGeneratedArchive, type GeneratedArchivePreparationReader } from "./contract-generated-archive-preparation";
import { assertGeneratedArchiveSealContinuity, qualifyGeneratedArchiveSealAuthority, readGeneratedArchiveWriterAuthority, type GeneratedArchiveRequestBinding } from "./contract-generated-archive-installation";
import { writeGeneratedArchive } from "./contract-generated-archive-writer";

const sha = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v, (_k, value) => typeof value === "bigint" ? value.toString() : value));
function object(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }

function conflict(text: string): never { throw new ConflictException(text); }
class ArchiveBindingBusyBeforeWrite extends Error {}

/** ArchiveProtocol2 is persisted authority. No legacy seal/terminal approval is synthesized. */
@Injectable()
export class ContractV2ArchiveService {
  constructor(private readonly prisma: PrismaService, private readonly files: FileService,
    private readonly audit: AuditService, private readonly activation: ContractVersionActivationService,
    @Optional() @Inject(GENERATED_ARCHIVE_PREPARATION_READER) private readonly preparationReader?: GeneratedArchivePreparationReader,
    @Optional() @Inject(DIRECT_ARCHIVE_EXECUTOR) private readonly directArchiveExecutor?: DirectArchiveExecutor) {}

  async archive(versionId: string, actor: string, input: ArchiveSignedContractV2Dto) {
    const requestSha256 = archiveRequestSha(versionId, actor, input);
    let transactionError: unknown;
    try {
      const prepared = await this.prisma.$transaction(async tx => {
        const locate = await tx.contractVersion.findUnique({ where: { id: versionId } });
        if (!locate) conflict("合同不存在，请刷新后重试");
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Contract" WHERE "id" = ${locate.contractId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${versionId} FOR UPDATE`);
        const version = await tx.contractVersion.findUniqueOrThrow({ where: { id: versionId } });
        const contract = await tx.contract.findUniqueOrThrow({ where: { id: version.contractId } });
        if (version.contractId !== locate.contractId || contract.voidedAt || contract.ownerUserId !== actor) throw new ForbiddenException("只有当前合同员经办人可以归档本合同");
        assertNotDirectPendingVersion(version);
        const previous = await tx.contractArchiveFile.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        const actorAccess = await resolveGovernedFinalArchiveAccess(tx, { actorUserId: actor, projectId: contract.projectId, handlerUserId: previous?.uploadedByUserId ?? actor });
        if (!actorAccess.canUpload) throw new ForbiddenException("当前账号已无本项目合同经办上传权限");
        if (previous) {
          if (previous.contractVersionId !== versionId || previous.uploadedByUserId !== actor || previous.requestSha256 !== requestSha256 || previous.archiveProtocolVersion !== 2) conflict("该归档标识已用于不同内容，请核对原归档结果");
          return;
        }
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${input.expectedApprovalInstanceId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractSealTask" WHERE "id" = ${input.expectedSealTaskId} FOR UPDATE`);
        const round = await tx.approvalInstance.findUnique({ where: { id: input.expectedApprovalInstanceId } });
        const task = await tx.contractSealTask.findUnique({ where: { id: input.expectedSealTaskId } });
        const snapshot = contractRoundSubmissionSnapshot(round?.frozenNodes);
        if (version.numericProtocolVersion !== 2 || version.changeType !== "original" || version.supersedesVersionId || version.status !== "seal_approved_pending_archive" || !snapshot || !round || round.status !== "approved" || round.businessId !== versionId || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || round.applicantUserId !== actor || !task || task.contractVersionId !== versionId || task.approvalInstanceId !== round.id || task.handlerUserId !== actor || task.status !== "completed" || !task.completedAt || !task.completedByUserId) conflict("合同审批或盖章资料已变化，请刷新后核对当前轮次");
        if (input.documentContentRevision !== version.documentContentRevision || input.documentContentFingerprint !== version.documentContentFingerprint || snapshot.documentContentRevision !== input.documentContentRevision || snapshot.documentContentFingerprint !== input.documentContentFingerprint || snapshot.contractVersionId !== versionId) conflict("正文已变化，请核对本轮签章原件");
        if (await tx.contractArchiveFile.count({ where: { contractVersionId: versionId } })) conflict("合同已有归档记录，不能替换原件");
        const archivedAt = new Date();
        await tx.$queryRaw(Prisma.sql`SELECT "id", "isActive" FROM "Project" WHERE "id" = ${contract.projectId} FOR UPDATE`);
        const project = await tx.project.findUniqueOrThrow({ where: { id: contract.projectId } });
        if (!project.isActive) conflict("项目当前不可办理归档");
        const preparationScope = generatedArchiveSealScope(contract, version, round, task, snapshot, task.completedByUserId, input.documentContentFingerprint);
        if (preparationScope) {
          if (!this.preparationReader) throw new ServiceUnavailableException("生成合同归档资格尚未就绪，请保留原件和本次标识");
          const generatedFileIds = preparationScope.files.map(file => file.fileId);
          if (input.fileIds.some(fileId => generatedFileIds.includes(fileId))) conflict("双方签章原件须与本轮生成文书分开上传");
          await this.lockArchiveFiles(tx, input.fileIds, generatedFileIds);
          await assertGeneratedArchiveSealSources(tx, preparationScope, snapshot);
          const installation = await qualifyGeneratedArchiveSealAuthority(tx, preparationScope);
          const { binding, verifiedVersions } = await prepareGeneratedArchive(tx, this.files, this.preparationReader, preparationScope, {
            uploaderUserId: actor, idempotencyKey: input.idempotencyKey, requestSha256, fileIds: input.fileIds
          });
          await assertGeneratedArchiveRequestBinding(tx, installation, binding, verifiedVersions);
          await assertGeneratedArchiveSealSources(tx, preparationScope, snapshot);
          await assertGeneratedArchiveSealContinuity(tx, preparationScope, installation);
          const writer = await readGeneratedArchiveWriterAuthority(tx, JSON.parse(JSON.stringify(binding)) as GeneratedArchiveRequestBinding);
          if (!writer) return true;
          if (!isDeepStrictEqual(writer.installation, installation)) {
            throw new ServiceUnavailableException("生成合同归档写入资格已变化，请保留原件和本次标识");
          }
          await writeGeneratedArchive(tx, {
            binding, writer, owner: contract, version, snapshot, archivedAt, actingRoleKey: actorAccess.actingRoleKey,
            activation: this.activation, audit: this.audit
          });
          await assertGeneratedArchiveSealSources(tx, preparationScope, snapshot);
          await assertGeneratedArchiveSealContinuity(tx, preparationScope, installation);
          return;
        }
        if (version.signingSubjectType !== "our_company") conflict("合同签约主体与本轮归档资料不一致");
        const identity = object(snapshot.signingIdentity), company = object(identity.company);
        if (identity.relationship !== "inside" || company.id !== version.companyEntityVersionId || company.companyEntityId !== version.companyEntityIdSnapshot) conflict("本轮正式签约主体与当前版本不一致");
        const participant = await tx.projectParticipatingCompany.findUnique({ where: { id: String(company.projectParticipatingCompanyId) } });
        const day = new Date(`${chinaDateOnly(archivedAt)}T00:00:00.000Z`);
        if (!participant || participant.projectId !== contract.projectId || participant.companyEntityId !== version.companyEntityIdSnapshot || participant.effectiveFrom > day || participant.endedAt && participant.endedAt <= day) conflict("签约公司在归档日期的项目参与资格已变化");
        const generated = await tx.contractGeneratedDocument.findUnique({ where: { id: String(snapshot.generatedDocumentId) } });
        const refs = Array.isArray(snapshot.files) ? snapshot.files.map(object) : [];
        const trace = object(generated?.inputSnapshot), layout = object(snapshot.layoutSnapshot), mapping = object(trace.layoutSourceMapping);
        if (!generated || generated.contractVersionId !== versionId || generated.status !== "success" || generated.sourceRevision !== snapshot.draftRevision || generated.layoutTemplateVersionId !== snapshot.layoutTemplateVersionId || trace.documentContentRevision !== snapshot.documentContentRevision || trace.documentContentFingerprint !== snapshot.documentContentFingerprint || trace.templateFileId !== layout.docxFileId || mapping.sourceSha256 !== snapshot.sourceSha256 || refs.length !== 2 || !generated.docxFileId || !generated.pdfFileId || generated.docxFileId === generated.pdfFileId || refs[0].fileId !== generated.docxFileId || refs[1].fileId !== generated.pdfFileId) conflict("本轮Word及PDF生成来源不完整");
        await this.lockArchiveFiles(tx, input.fileIds, refs.map(ref => String(ref.fileId)));

        for (const ref of refs) {
          const file = await tx.fileObject.findUnique({ where: { id: String(ref.fileId) } });
          const data = await this.files.getFileBuffer(String(ref.fileId));
          if (!file || file.storageStatus !== "active" || file.sizeBytes !== ref.sizeBytes || file.mimeType !== ref.mimeType || file.contentSha256 !== ref.contentSha256 || sha(data.buffer) !== ref.contentSha256 || data.buffer.length !== ref.sizeBytes) conflict("本轮生成文书校验失败，请核对原文件");
        }
        const manifest = [];
        for (const [displayOrder, fileId] of input.fileIds.entries()) {
          await this.files.assertCanAttachUnlinkedFile(tx, fileId, actor);
          const file = await tx.fileObject.findUniqueOrThrow({ where: { id: fileId } });
          const data = await this.files.getFileBuffer(fileId);
          if (file.mimeType !== "application/pdf" || file.sizeBytes <= 0 || file.sizeBytes !== data.buffer.length || file.contentSha256 !== sha(data.buffer)) throw new BadRequestException("双方签章原件必须是可校验的PDF文件");
          const pdf = await PDFDocument.load(data.buffer).catch(() => { throw new BadRequestException("归档PDF无法解析，请重新核对原件"); });
          if (!pdf.getPageCount()) throw new BadRequestException("归档PDF不能为空");
          manifest.push({ fileId, displayOrder, mimeType: file.mimeType, sizeBytes: file.sizeBytes, contentSha256: file.contentSha256 });
        }
        const ref = `contract:${contract.id}`, revision = `${version.id}:${version.documentContentRevision}`;
        const applicable = (await tx.contractEconomicReview.findMany({ where: { projectId: contract.projectId, status: "confirmed", confirmedAt: { lte: archivedAt }, OR: [{ leftSourceRef: ref }, { rightSourceRef: ref }] } })).filter(review => reviewAppliesToVersion(review, ref, revision));
        const latest = latestEconomicReviews(applicable);
        if (latest.some(review => applicable.filter(other => other.leftSourceRef === review.leftSourceRef && other.rightSourceRef === review.rightSourceRef && other.confirmedAt?.getTime() === review.confirmedAt?.getTime()).length !== 1)) conflict("同时确认的履约范围存在歧义，请先核对复核来源");
        const Decimal = Prisma.Decimal.clone({ precision: 60 });
        const excluded = latest.reduce((sum, review) => sum.plus(excludedAmountYuan(review, ref)), new Decimal(0));
        const amount = version.amountYuan?.toFixed(4) ?? null;
        if (amount !== null && excluded.gt(amount)) conflict("已确认排除范围超过合同金额，请先核对");
        const delta = amount === null ? null : new Decimal(amount).minus(excluded);
        const direction = delta === null ? "notice" : delta.lt(0) ? "decrease" : "increase";
        const reviewSources = latest.sort((a, b) => a.id.localeCompare(b.id)).map(review => ({ reviewId: review.id, revision: review.revision, confirmedAt: review.confirmedAt!.toISOString(), leftSourceRef: review.leftSourceRef, rightSourceRef: review.rightSourceRef, coverage: review.coverage, frozenDocument: (review.frozenSources as Prisma.JsonArray).find(d => object(d).ref === ref) }));
        const sourceBasis = { basisProtocolVersion: 1, sourceLocator: { projectId: contract.projectId, contractId: contract.id, contractVersionId: versionId, sourceType: "contract_version", sourceBusinessId: versionId, entryKind: "original", sourceVersion: version.versionNo, versionNo: version.versionNo, changeType: "original", formalCode: contract.code },
          versionEvidence: { draftRevision: snapshot.draftRevision, documentContentRevision: snapshot.documentContentRevision, documentContentFingerprint: snapshot.documentContentFingerprint, businessTemplateVersionId: snapshot.businessTemplateVersionId, layoutTemplateVersionId: snapshot.layoutTemplateVersionId, sourceSha256: snapshot.sourceSha256, generatedDocumentId: generated.id, generatedDocumentFiles: { word: refs[0], pdf: refs[1] }, approvalInstanceId: round.id, sealTaskId: task.id },
          businessTime: { archivedAt: archivedAt.toISOString(), businessDay: chinaDateOnly(archivedAt), handlerUserId: actor }, fileManifest: manifest,
          money: { numericProtocolVersion: 2, amountCents: null, amountYuan: amount, amountState: amount === null ? "unknown" : "known", amountLimitType: version.amountLimitType, pricingNature: version.pricingNature, amountSource: version.amountSource, commitmentDeltaYuan: delta?.toFixed(4) ?? null, direction, economicExcludedYuan: excluded.toFixed(4), economicReviewSources: reviewSources, predecessor: null },
          subjects: { signingIdentity: snapshot.signingIdentity, parties: snapshot.parties, participation: { id: participant.id, companyEntityId: participant.companyEntityId, companyEntityVersionId: participant.companyEntityVersionId, effectiveFrom: participant.effectiveFrom.toISOString().slice(0, 10) } }, termsAndTax: { paymentTerms: snapshot.paymentTerms, taxFacts: snapshot.taxFacts } };
        const expectedSource = project.operatingLedgerEffectiveDate ? { sourceType: "contract_version", sourceBusinessId: versionId, sourceVersion: version.versionNo, entryKind: "original", factIdempotencyKey: `contract_version:${versionId}`, impactIdempotencyKey: `contract_version:${versionId}:commitment`, sourceImpactKey: "contract_commitment_reference", impactKind: "contract_commitment_reference", numericProtocolVersion: 2, amountState: delta === null ? "unknown" : "known", amountYuan: delta?.abs().toFixed(4) ?? null, direction } : null;
        const id = randomUUID();
        const response = { archiveId: id, contractVersionId: versionId, status: "effective", fileIds: input.fileIds };
        // PostgreSQL BEFORE INSERT derives B/M/A from its JSONB canonical bytes.
        // Consume returned opaque values; never substitute JS hashes for them.
        const archive = await tx.contractArchiveFile.create({ data: { id, contractVersionId: versionId, fileId: null, archiveProtocolVersion: 2, archiveSource: "generated_approval", uploadedByUserId: actor, confirmedByUserId: actor, confirmedAt: archivedAt, status: "confirmed", approvalInstanceId: round.id, sealTaskId: task.id, idempotencyKey: input.idempotencyKey, requestSha256, sourceRevision: Number(snapshot.draftRevision), documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
          authoritySnapshot: json({ authorityProtocolVersion: 1, projectId: contract.projectId, contractId: contract.id, contractVersionId: versionId, archiveSource: "generated_approval", handlerUserId: actor, archivedAt: archivedAt.toISOString(), requestSha256, sourceRevision: snapshot.draftRevision, documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint, approvalInstanceId: round.id, sealTaskId: task.id, sourceBasis, fileManifest: manifest, operatingConsequence: { protocolVersion: 1, mode: expectedSource ? "projection_required" : "not_applicable", operatingLedgerEffectiveDateSnapshot: project.operatingLedgerEffectiveDate?.toISOString().slice(0, 10) ?? null, expectedSource } }), responseSnapshot: json(response) } });
        const authority = object(archive.authoritySnapshot);
        if (!archive.authoritySha256 || !archive.fileManifestSha256 || typeof authority.sourceBasisSha256 !== "string") conflict("归档权威摘要未完整返回，尚不能确认成功");
        for (const file of manifest) await tx.contractArchiveEvidenceFile.create({ data: { archiveFileId: id, contractVersionId: versionId, ...file } });
        await this.activation.activateArchivedV2(tx, versionId, actor, archivedAt, archive.id);
        await this.audit.record(tx, { actorUserId: actor, action: "contract.archive.complete", businessType: "contract_version", businessId: versionId, metadata: json({ archiveId: archive.id, approvalInstanceId: round.id, sealTaskId: task.id, fileIds: input.fileIds, authoritySha256: archive.authoritySha256, actingRoleKey: actorAccess.actingRoleKey }) });
      });
      if (prepared) throw new ServiceUnavailableException("签章原件已核对，正式归档暂不可办理，请保留原件和本次标识");
    } catch (error) { transactionError = error; }
    // A resolved transaction result alone is insufficient: deferred COMMIT can
    // fail. Read the durable original key; never resend from catch or finally.
    const result = await this.getArchiveResult(versionId, actor, input.idempotencyKey);
    if (result.status === "unknown") {
      // This exact branch wrote nothing. Claim only this attempt's outcome,
      // after leaving the failed TX and finishing the fresh original-key read.
      if (transactionError instanceof ArchiveBindingBusyBeforeWrite) {
        const response: ContractArchiveBindingBusyResponse = { statusCode: 409, error: "Conflict", code: "CONTRACT_ARCHIVE_BINDING_BUSY", attemptOutcome: "not_applied", message: transactionError.message };
        throw new ConflictException(response);
      }
      if (transactionError) throw transactionError;
      throw new ServiceUnavailableException("归档结果尚未确认，请保留本次标识并查询结果，不要重复发起归档");
    }
    if (result.requestSha256 !== requestSha256) conflict("该归档标识已用于不同内容，请核对原归档结果");
    return result.result;
  }

  private async lockArchiveFiles(tx: Prisma.TransactionClient, signedFileIds: readonly string[], generatedFileIds: readonly string[]) {
    // Keep C/V/R/T/P and complete sorted file-lock order.
    for (const fileId of [...new Set([...signedFileIds, ...generatedFileIds])].sort()) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE`);
    }
    // Old callers use both G→F and F→G. Never wait for G while holding F/P.
    if (!await tryAcquireFileBusinessBindingTransactionLock(tx)) throw new ArchiveBindingBusyBeforeWrite("文件绑定正在办理，请先查询本次归档结果，再手动继续原请求");
  }

  async registerDirect(versionId: string, actor: string, input: RegisterDirectSignedContractV2Dto) {
    const prepared = await this.prisma.$transaction(async tx => {
      const located = await tx.contractVersion.findUnique({ where: { id: versionId }, select: { contractId: true } });
      if (!located) throw new ForbiddenException("只有当前合同员经办人可以登记本合同");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."Contract" WHERE "id" = ${located.contractId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."ContractVersion" WHERE "id" = ${versionId} FOR UPDATE`);
      const version = await tx.contractVersion.findUnique({ where: { id: versionId } });
      const owner = version && version.contractId === located.contractId
        ? await tx.contract.findUnique({ where: { id: located.contractId } }) : null;
      if (!version || !owner || owner.ownerUserId !== actor || owner.voidedAt) throw new ForbiddenException("只有当前合同员经办人可以登记本合同");
      const access = await resolveGovernedFinalArchiveAccess(tx, { actorUserId: actor, projectId: owner.projectId, handlerUserId: actor });
      if (!access.canUpload) throw new ForbiddenException("当前账号已无本项目合同经办上传权限");
      const existing = await tx.contractArchiveFile.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        const request = directArchiveRequestSha(owner.id, versionId, actor, input);
        if (existing.contractVersionId !== versionId || existing.uploadedByUserId !== actor || existing.archiveProtocolVersion !== 2
          || existing.archiveSource !== "direct_signed" || existing.requestSha256 !== request) {
          conflict("该归档标识已用于不同内容，请核对原归档结果");
        }
        return { requestSha256: request };
      }
      if (version.numericProtocolVersion !== 2 || version.versionNo !== 1 || version.changeType !== "original"
        || version.supersedesVersionId || !hasDirectSigningInput(version.draftData)) {
        conflict("当前合同不属于可登记的已签合同来源");
      }
      if (await tx.contractArchiveFile.count({ where: { contractVersionId: versionId } })) {
        conflict("合同已有归档记录，请查询原归档标识");
      }
      if (version.status !== "draft" || version.firstSubmittedAt || version.effectiveAt || version.endedAt) {
        conflict("当前合同状态不能登记，请刷新后核对");
      }
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."Project" WHERE "id" = ${owner.projectId} FOR UPDATE`);
      const project = await tx.project.findUnique({ where: { id: owner.projectId } });
      if (!project?.isActive) conflict("项目当前不可办理登记");
      if (project.operatingLedgerEffectiveDate) conflict("项目已启用经营账，当前暂不能直接登记");
      const qualification = await assertDirectPendingSourceQualification(tx);
      const completion = qualification.retention?.completion;
      const profile = await readDirectArchivePreflightProfile(tx, !!(qualification.dispatch && completion));
      const executor = object(object(version.draftData).directSigningInput).relationship === "outside" ? this.directArchiveExecutor : undefined;
      if (profile === "attached_closed" && !executor) await assertDirectArchiveIntentSourceClosed(tx, qualification.bootstrap);
      const source = await readDirectPendingInput(tx, version.id);
      const pending = object(source.Q), locator = object(pending.locator);
      const files: unknown[] = Array.isArray(pending.signedFiles) ? pending.signedFiles : [];
      if (source.state !== "complete" || version.draftRevision !== input.expectedDraftRevision || source.sourceRevision !== input.expectedDraftRevision
        || source.inputSha256 !== input.expectedInputSha256 || locator.contractId !== owner.id || locator.projectId !== owner.projectId
        || locator.versionNo !== version.versionNo || files.length !== input.fileIds.length || files.some((value, index) => {
          const file = object(value);
          return file.fileId !== input.fileIds[index] || file.displayOrder !== index;
        })) {
        conflict("待登记资料或签章原件顺序已变化，请刷新后核对");
      }
      const enterprise = object(object(pending.subjects).enterprise);
      const now = new Date();
      const assignments = await tx.projectAffiliateAssignment.findMany({ where: {
        projectId: owner.projectId, effectiveFrom: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }]
      } });
      const assignment = assignments.length === 1 ? assignments[0] : null;
      if (!assignment || assignment.id !== enterprise.assignmentId || assignment.id !== version.affiliateAssignmentId
        || assignment.businessPartyVersionId !== enterprise.businessPartyVersionId || assignment.businessPartyVersionId !== version.affiliateBusinessPartyVersionId
        || assignment.businessPartyId !== enterprise.businessPartyId) conflict("施工企业的当前项目签约资格已变化，请刷新后核对");
      await this.assertDirectRegistrationReviewScope(tx, owner.projectId, owner.id, version.id, input, now);
      if (profile === "attached_closed") {
        await assertDirectArchiveSourceScope(tx, {
          contractId: owner.id, versionId: version.id, projectId: project.id, actor,
          sourceRevision: input.expectedDraftRevision, inputSha256: input.expectedInputSha256
        }, completion?.actual.relationOid, qualification.bootstrap);
        if (!executor) rejectUnqualifiedDirectArchiveWriter();
        const admission = await readDirectArchiveNativeAdmission(tx, qualification.bootstrap);
        if (!admission || admission.completionOid !== completion?.actual.relationOid) rejectUnqualifiedDirectArchiveWriter();
        const originals: DirectArchiveExecution["originals"][number][] = [];
        for (const [displayOrder, fileId] of input.fileIds.entries()) {
          const row = await tx.fileObject.findUnique({ where: { id: fileId } });
          const frozen = object(files[displayOrder]);
          if (!row || row.uploadedByUserId !== actor || row.storageStatus !== "active"
            || row.purgeReceiptId !== null || row.supersedesFileObjectId !== null
            || !row.bucket || !row.objectKey || !row.contentSha256 || !/^[a-f0-9]{64}$/u.test(row.contentSha256)
            || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1
            || !["application/pdf", "image/jpeg", "image/png"].includes(row.mimeType)
            || row.mimeType !== frozen.mimeType || row.sizeBytes !== frozen.sizeBytes || row.contentSha256 !== frozen.contentSha256) {
            throw new ServiceUnavailableException("直签原件身份尚未完整核对，请保留原件和本次标识");
          }
          originals.push({ fileId, displayOrder, bucket: row.bucket, objectKey: row.objectKey,
            mimeType: row.mimeType, sizeBytes: row.sizeBytes, contentSha256: row.contentSha256 });
        }
        const command: DirectArchiveExecution = { actor, projectId: project.id, contractId: owner.id, versionId,
          revision: input.expectedDraftRevision, inputSha256: input.expectedInputSha256, key: input.idempotencyKey, nativeNonce: admission.nonce, originals };
        return { requestSha256: directArchiveRequestSha(owner.id, versionId, actor, input), execute: () => executor.execute(command) };
      }
      throw new ServiceUnavailableException("正式登记暂不可办理，请保留原件和本次标识");
    });
    // End the ordinary preflight transaction before the confined writer acquires its own locks.
    // A failed or lost execution response is resolved once from the original durable key.
    const executionError: unknown = await prepared.execute?.().catch((error: unknown) => error);
    // An exact key can only recover a committed result, even after the draft slot is gone.
    const recovered = await this.getArchiveResult(versionId, actor, input.idempotencyKey);
    if (recovered.status === "unknown") {
      if (executionError instanceof BadRequestException) throw executionError;
      throw new ServiceUnavailableException("直签归档持久结果尚未确认，请保留原标识");
    }
    if (recovered.requestSha256 !== prepared.requestSha256) conflict("该归档标识已用于不同内容，请核对原归档结果");
    return recovered.result;
  }

  private async assertDirectRegistrationReviewScope(tx: Prisma.TransactionClient, projectId: string, contractId: string,
    versionId: string, input: RegisterDirectSignedContractV2Dto, now: Date) {
    const ref = `contract:${contractId}`;
    const related = await tx.contractEconomicReview.findMany({ where: { projectId,
      OR: [{ leftSourceRef: ref }, { rightSourceRef: ref }],
      status: { in: ["pending_review", "pending_finance", "confirmed"] }
    } });
    if (!related.length) return;
    await assertDirectReviewQualification(tx, "read");
    const coordinate = `${versionId}:direct:${input.expectedDraftRevision}:${input.expectedInputSha256}`;
    const applicable: typeof related = [];
    for (const review of related) {
      const pins = await readStoredDirectReviewPins(tx, review.id, [review.leftSourceRef, review.rightSourceRef]);
      if (!pins.some(pin => pin.sourceRef === ref && pin.contractVersionId === versionId
        && pin.sourceRevision === input.expectedDraftRevision && pin.inputSha256 === input.expectedInputSha256)) continue;
      if (review.status !== "confirmed") conflict("请先完成履约复核，再办理登记");
      if (!review.confirmedAt || review.confirmedAt > now || !reviewAppliesToVersion(review, ref, coordinate) || !Array.isArray(review.coverage)) {
        throw new ServiceUnavailableException("本次履约复核依据尚未核对，请保留登记资料");
      }
      applicable.push(review);
    }
    const latest = latestEconomicReviews(applicable);
    if (latest.some(review => applicable.some(other => other.id !== review.id && other.leftSourceRef === review.leftSourceRef
      && other.rightSourceRef === review.rightSourceRef && other.confirmedAt?.getTime() === review.confirmedAt?.getTime()))) {
      conflict("同时确认的履约范围存在歧义，请先核对复核来源");
    }
    if (latest.some(review => excludedAmountYuan(review, ref) !== "0.0000")) conflict("本合同履约复核存在非零排除额，当前暂不能直接登记");
  }

  /** Reads the original durable outcome only; never activates or replays. */
  async getArchiveResult(versionId: string, actor: string, key: string) {
    const locatedVersion = await this.prisma.contractVersion.findUnique({ where: { id: versionId } });
    const locatedContract = locatedVersion ? await this.prisma.contract.findUnique({ where: { id: locatedVersion.contractId } }) : null;
    if (!locatedContract || locatedContract.voidedAt || locatedContract.ownerUserId !== actor) throw new ForbiddenException("当前账号无权查询该归档结果");
    const access = await resolveGovernedFinalArchiveAccess(this.prisma, { actorUserId: actor, projectId: locatedContract.projectId, handlerUserId: actor });
    if (!access.canUpload) throw new ForbiddenException("当前账号已无本项目合同经办上传权限，不能读取归档结果");
    const durable = await this.prisma.contractArchiveFile.findUnique({ where: { idempotencyKey: key } });
    if (!durable) return { status: "unknown" as const };
    if (durable.contractVersionId !== versionId || durable.uploadedByUserId !== actor || durable.archiveProtocolVersion !== 2) throw new ForbiddenException("当前账号或合同与原归档结果不一致");
    // Version is the persisted link; avoid accepting a stale caller's contract.
    const version = await this.prisma.contractVersion.findUnique({ where: { id: versionId } });
    const owner = version ? await this.prisma.contract.findUnique({ where: { id: version.contractId } }) : null;
    if (!version || !owner || owner.ownerUserId !== actor || owner.voidedAt) throw new ForbiddenException("当前经办权限已变化，不能读取归档结果");
    const currentAccess = await resolveGovernedFinalArchiveAccess(this.prisma, { actorUserId: actor, projectId: owner.projectId, handlerUserId: durable.uploadedByUserId });
    if (!currentAccess.canUpload) throw new ForbiddenException("当前账号已无本项目合同经办上传权限，不能读取归档结果");
    if (durable.archiveSource === "direct_signed" || requiresGeneratedArchiveOriginals(version, durable)) {
      return this.prisma.$transaction(async tx => {
        const currentVersion = await tx.contractVersion.findUnique({ where: { id: versionId } });
        const currentOwner = currentVersion ? await tx.contract.findUnique({ where: { id: currentVersion.contractId } }) : null;
        if (!currentVersion || !currentOwner || currentOwner.ownerUserId !== actor || currentOwner.voidedAt) {
          throw new ForbiddenException("当前经办权限已变化，不能读取归档结果");
        }
        const scopedAccess = await resolveGovernedFinalArchiveAccess(tx, {
          actorUserId: actor, projectId: currentOwner.projectId, handlerUserId: actor
        });
        if (!scopedAccess.canUpload) throw new ForbiddenException("当前账号已无本项目合同经办上传权限，不能读取归档结果");
        const current = await tx.contractArchiveFile.findUnique({ where: { idempotencyKey: key } });
        if (!current || current.id !== durable.id || current.uploadedByUserId !== actor || current.contractVersionId !== versionId
          || current.archiveSource !== durable.archiveSource) {
          throw new ServiceUnavailableException(durable.archiveSource === "direct_signed"
            ? "直签归档持久结果尚未完整核对，请保留原标识"
            : "归档持久结果尚未完整核对，请保留原标识");
        }
        if (current.archiveSource === "direct_signed") return assertDirectArchivePersistentProof(tx, currentOwner, currentVersion, current);
        if (!requiresGeneratedArchiveOriginals(currentVersion, current)) {
          throw new ServiceUnavailableException("归档原件固定版本尚未完整核对，请保留本次标识");
        }
        return assertContractV2ArchivePersistentProof(tx, currentOwner, currentVersion, current);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }
    return assertContractV2ArchivePersistentProof(this.prisma, owner, version, durable);
  }
}
