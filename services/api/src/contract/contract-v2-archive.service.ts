import { archiveRequestSha, assertContractV2ArchivePersistentProof } from "./contract-v2-archive-persistent-proof";
import { tryAcquireFileBusinessBindingTransactionLock } from "../file/file-business-binding";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { AuditService } from "../audit/audit.service";
import { ArchiveSignedContractV2Dto, type ContractArchiveBindingBusyResponse } from "./dto/contract-lifecycle-v2.dto";
import { contractRoundSubmissionSnapshot } from "./contract-parallel-duty-access";
import { latestEconomicReviews, excludedAmountYuan, reviewAppliesToVersion } from "../contract-ledger/contract-economic-coverage";
import { ContractVersionActivationService } from "./contract-version-activation.service";

const sha = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v, (_k, value) => typeof value === "bigint" ? value.toString() : value));
function object(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }

function conflict(text: string): never { throw new ConflictException(text); }
class ArchiveBindingBusyBeforeWrite extends Error {}

/** ArchiveProtocol2 is persisted authority. No legacy seal/terminal approval is synthesized. */
@Injectable()
export class ContractV2ArchiveService {
  constructor(private readonly prisma: PrismaService, private readonly files: FileService,
    private readonly audit: AuditService, private readonly activation: ContractVersionActivationService) {}

  async archive(versionId: string, actor: string, input: ArchiveSignedContractV2Dto) {
    const requestSha256 = archiveRequestSha(versionId, actor, input);
    let transactionError: unknown;
    try {
      await this.prisma.$transaction(async tx => {
        const locate = await tx.contractVersion.findUnique({ where: { id: versionId } });
        if (!locate) conflict("合同不存在，请刷新后重试");
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Contract" WHERE "id" = ${locate.contractId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${versionId} FOR UPDATE`);
        const version = await tx.contractVersion.findUniqueOrThrow({ where: { id: versionId } });
        const contract = await tx.contract.findUniqueOrThrow({ where: { id: version.contractId } });
        if (version.contractId !== locate.contractId || contract.voidedAt || contract.ownerUserId !== actor) throw new ForbiddenException("只有当前合同员经办人可以归档本合同");
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
        if (version.numericProtocolVersion !== 2 || version.changeType !== "original" || version.supersedesVersionId || version.signingSubjectType !== "our_company" || version.status !== "seal_approved_pending_archive" || !snapshot || !round || round.status !== "approved" || round.businessId !== versionId || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || round.applicantUserId !== actor || !task || task.contractVersionId !== versionId || task.approvalInstanceId !== round.id || task.handlerUserId !== actor || task.status !== "completed" || !task.completedAt || !task.completedByUserId) conflict("合同审批或盖章资料已变化，请刷新后核对当前轮次");
        if (input.documentContentRevision !== version.documentContentRevision || input.documentContentFingerprint !== version.documentContentFingerprint || snapshot.documentContentRevision !== input.documentContentRevision || snapshot.documentContentFingerprint !== input.documentContentFingerprint || snapshot.contractVersionId !== versionId) conflict("正文已变化，请核对本轮签章原件");
        if (await tx.contractArchiveFile.count({ where: { contractVersionId: versionId } })) conflict("合同已有归档记录，不能替换原件");
        const archivedAt = new Date();
        await tx.$queryRaw(Prisma.sql`SELECT "id", "isActive" FROM "Project" WHERE "id" = ${contract.projectId} FOR UPDATE`);
        const project = await tx.project.findUniqueOrThrow({ where: { id: contract.projectId } });
        if (!project.isActive) conflict("项目当前不可办理归档");
        const identity = object(snapshot.signingIdentity), company = object(identity.company);
        if (identity.relationship !== "inside" || company.id !== version.companyEntityVersionId || company.companyEntityId !== version.companyEntityIdSnapshot) conflict("本轮正式签约主体与当前版本不一致");
        const participant = await tx.projectParticipatingCompany.findUnique({ where: { id: String(company.projectParticipatingCompanyId) } });
        const day = new Date(`${chinaDateOnly(archivedAt)}T00:00:00.000Z`);
        if (!participant || participant.projectId !== contract.projectId || participant.companyEntityId !== version.companyEntityIdSnapshot || participant.effectiveFrom > day || participant.endedAt && participant.endedAt <= day) conflict("签约公司在归档日期的项目参与资格已变化");
        const generated = await tx.contractGeneratedDocument.findUnique({ where: { id: String(snapshot.generatedDocumentId) } });
        const refs = Array.isArray(snapshot.files) ? snapshot.files.map(object) : [];
        const trace = object(generated?.inputSnapshot), layout = object(snapshot.layoutSnapshot), mapping = object(trace.layoutSourceMapping);
        if (!generated || generated.contractVersionId !== versionId || generated.status !== "success" || generated.sourceRevision !== snapshot.draftRevision || generated.layoutTemplateVersionId !== snapshot.layoutTemplateVersionId || trace.documentContentRevision !== snapshot.documentContentRevision || trace.documentContentFingerprint !== snapshot.documentContentFingerprint || trace.templateFileId !== layout.docxFileId || mapping.sourceSha256 !== snapshot.sourceSha256 || refs.length !== 2 || !generated.docxFileId || !generated.pdfFileId || generated.docxFileId === generated.pdfFileId || refs[0].fileId !== generated.docxFileId || refs[1].fileId !== generated.pdfFileId) conflict("本轮Word及PDF生成来源不完整");
        // Keep the original C/V/R/T/P and complete sorted file-lock order.
        for (const fileId of [...new Set([...input.fileIds, ...refs.map(ref => String(ref.fileId))])].sort()) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE`);
        // Old callers use both G→F and F→G. Never wait for G while holding F/P;
        // after acquiring all F, a failed try must leave this transaction.
        if (!await tryAcquireFileBusinessBindingTransactionLock(tx)) throw new ArchiveBindingBusyBeforeWrite("文件绑定正在办理，请先查询本次归档结果，再手动继续原请求");

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
    if (!owner || owner.ownerUserId !== actor || owner.voidedAt) throw new ForbiddenException("当前经办权限已变化，不能读取归档结果");
    const currentAccess = await resolveGovernedFinalArchiveAccess(this.prisma, { actorUserId: actor, projectId: owner.projectId, handlerUserId: durable.uploadedByUserId });
    if (!currentAccess.canUpload) throw new ForbiddenException("当前账号已无本项目合同经办上传权限，不能读取归档结果");
    return assertContractV2ArchivePersistentProof(this.prisma, owner, version, durable);
  }
}
