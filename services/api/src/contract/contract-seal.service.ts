import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { ContractVersionActivationService } from "./contract-version-activation.service";
import type {
  ApproveContractSealDto,
  CompleteContractSealDto,
  ConfirmMutuallySignedContractDto,
  InvalidateContractSigningDto,
  ReturnContractFormalFileDto,
  UploadMutuallySignedContractDto
} from "./dto/contract-seal.dto";

type GovernedVersion = {
  id: string;
  contractId: string;
  status: string;
  contractGovernanceVersion: number | null;
  draftRevision?: number;
  changeType?: string;
  baseVersionId?: string | null;
};

type SealTask = {
  id: string;
  contractVersionId: string;
  approvalInstanceId?: string;
  handlerUserId: string;
  status: string;
};

const SETTLEMENT_CONTRACT_TYPES = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);

function isSerializationConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (["P2034", "40001", "40P01"].includes(String(candidate.code))) {
    return true;
  }
  if (
    candidate.code === "P2010" &&
    candidate.meta &&
    typeof candidate.meta === "object" &&
    "code" in candidate.meta
  ) {
    return ["40001", "40P01"].includes(
      String((candidate.meta as { code?: unknown }).code)
    );
  }
  return false;
}

@Injectable()
export class ContractSealService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly formalFiles?: ContractFormalFileService,
    @Optional() private readonly auth?: AuthService,
    private readonly activation: ContractVersionActivationService = new ContractVersionActivationService()
  ) {}

  async ensurePendingTask(
    tx: Prisma.TransactionClient,
    version: GovernedVersion,
    approvalInstanceId: string,
    applicantUserId: string,
    actorUserId: string
  ) {
    if (version.contractGovernanceVersion !== 1) return null;
    const existing = await tx.contractSealTask.findUnique({
      where: { approvalInstanceId }
    });
    if (existing) {
      if (existing.contractVersionId !== version.id || existing.handlerUserId !== applicantUserId) {
        throw new BadRequestException("用章经办人冻结事实不一致，请联系管理员核对审批实例");
      }
      return existing;
    }
    const active = await tx.contractSealTask.findFirst({
      where: { contractVersionId: version.id, status: { not: "cancelled" } }
    });
    if (active) {
      throw new BadRequestException("该合同版本已有进行中的用章任务，请刷新后核对审批实例");
    }
    const created = await tx.contractSealTask.create({
      data: {
        contractVersionId: version.id,
        approvalInstanceId,
        handlerUserId: applicantUserId,
        status: "pending_approval"
      }
    });
    await this.audit?.record(tx, {
      actorUserId,
      action: "contract.seal_task.create",
      businessType: "contract_version",
      businessId: version.id,
      metadata: { sealTaskId: created.id, approvalInstanceId, handlerUserId: applicantUserId }
    });
    return created;
  }

  async approve(contractVersionId: string, actorUserId: string, input: ApproveContractSealDto) {
    await this.assertGlobalRole(this.prisma as unknown as Prisma.TransactionClient, actorUserId, "comprehensive_director");
    if (!this.auth) throw new BadRequestException("当前密码校验服务暂不可用，请稍后重试");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "comprehensive_director");
      const { version, task } = await this.lockVersionAndTask(tx, contractVersionId);
      this.assertGoverned(version);
      if (version.status !== "approved_pending_seal" || task.status !== "pending_approval") {
        throw new BadRequestException("用章任务已处理，请刷新合同详情查看当前状态");
      }
      const approvedAt = new Date();
      const taskResult = await tx.contractSealTask.updateMany({
        where: { id: task.id, status: "pending_approval" },
        data: {
          status: "in_seal",
          approvedByUserId: actorUserId,
          approvedAt
        }
      });
      const versionResult = await tx.contractVersion.updateMany({
        where: { id: version.id, status: "approved_pending_seal" },
        data: { status: "in_seal" }
      });
      if (taskResult.count !== 1 || versionResult.count !== 1) {
        throw new BadRequestException("用章任务已被其他人处理，请刷新后重试");
      }
      await this.audit?.record(tx, {
        actorUserId,
        action: "contract.seal.approve",
        businessType: "contract_version",
        businessId: version.id,
        metadata: { sealTaskId: task.id, fromStatus: version.status, toStatus: "in_seal" }
      });
      return { ...version, status: "in_seal", sealTask: { ...task, status: "in_seal" } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async complete(
    contractVersionId: string,
    actorUserId: string,
    input: CompleteContractSealDto
  ) {
    this.assertCompletion(input);
    return this.prisma.$transaction(async (tx) => {
      const { version, task } = await this.lockVersionAndTask(tx, contractVersionId);
      this.assertGoverned(version);
      if (task.handlerUserId !== actorUserId) {
        throw new ForbiddenException("只有合同冻结经办人可以确认我方签署与盖章完成");
      }
      if (version.status !== "in_seal" || task.status !== "in_seal") {
        throw new BadRequestException("当前合同不在签署盖章中，请刷新后查看当前状态");
      }
      const completedAt = new Date();
      const taskResult = await tx.contractSealTask.updateMany({
        where: { id: task.id, status: "in_seal", handlerUserId: actorUserId },
        data: {
          status: "completed",
          completedByUserId: actorUserId,
          completedAt
        }
      });
      const versionResult = await tx.contractVersion.updateMany({
        where: { id: version.id, status: "in_seal" },
        data: { status: "seal_approved_pending_archive" }
      });
      if (taskResult.count !== 1 || versionResult.count !== 1) {
        throw new BadRequestException("签署盖章状态已变化，请刷新后重试");
      }
      await this.audit?.record(tx, {
        actorUserId,
        action: "contract.seal.complete",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          sealTaskId: task.id,
          fromStatus: version.status,
          toStatus: "seal_approved_pending_archive",
          completionSnapshot: {
            firstPartySignedOrStamped: input.firstPartySignedOrStamped,
            companySealCompleted: input.companySealCompleted,
            crossPageSealCompleted: input.crossPageSealCompleted,
            signingDateCompleted: input.signingDateCompleted
          }
        }
      });
      return {
        ...version,
        status: "seal_approved_pending_archive",
        sealTask: { ...task, status: "completed" }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async uploadFinal(
    contractVersionId: string,
    actorUserId: string,
    input: UploadMutuallySignedContractDto
  ) {
    this.assertFinalDeclaration(input);
    if (!this.formalFiles) {
      throw new BadRequestException("合同正式文件校验服务暂不可用，请稍后重试");
    }
    const preflightVersion = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: {
        id: true,
        contractId: true,
        status: true,
        contractGovernanceVersion: true,
        draftRevision: true
      }
    });
    this.assertGoverned(preflightVersion ?? {
      id: contractVersionId,
      contractId: "",
      status: "missing",
      contractGovernanceVersion: null
    });
    const preflightTask = await this.prisma.contractSealTask.findFirst({
      where: { contractVersionId, status: { not: "cancelled" } },
      orderBy: { createdAt: "desc" }
    });
    const preflightContract = preflightVersion ? await this.prisma.contract.findUnique({
      where: { id: preflightVersion.contractId },
      select: { projectId: true }
    }) : null;
    if (!preflightTask || !["seal_approved_pending_archive", "pending_archive_confirm"].includes(preflightVersion?.status ?? "") ||
      preflightTask.status !== "completed") {
      throw new BadRequestException("请先完成我方签署与盖章，再上传双方最终版合同");
    }
    if (!preflightContract || !(await this.canUploadFinal(
      this.prisma as unknown as Prisma.TransactionClient,
      preflightContract.projectId,
      preflightTask,
      actorUserId
    ))) {
      throw new ForbiddenException("当前账号不是冻结经办人，也不符合唯一合同主管的替代上传条件");
    }
    const formalFiles = this.formalFiles;
    const inspected = await formalFiles.inspectOwnedStoredFinalArchive(input.fileId, actorUserId);
    return this.prisma.$transaction(async (tx) => {
      const { version, task } = await this.lockVersionAndTask(tx, contractVersionId, true);
      this.assertGoverned(version);
      if (!["seal_approved_pending_archive", "pending_archive_confirm"].includes(version.status) || task.status !== "completed") {
        throw new BadRequestException("请先完成我方签署与盖章，再上传双方最终版合同");
      }
      if (input.sourceRevision !== version.draftRevision) {
        throw new BadRequestException("合同内容已更新，请重新完成审批和签署后上传最终版");
      }
      const contract = await tx.contract.findUnique({
        where: { id: version.contractId },
        select: { projectId: true }
      });
      if (!contract || !(await this.canUploadFinal(tx, contract.projectId, task, actorUserId))) {
        throw new ForbiddenException("当前账号不是冻结经办人，也不符合唯一合同主管的替代上传条件");
      }
      const approvalOriginal = await tx.contractFormalFile.findFirst({
        where: {
          contractVersionId: version.id,
          purpose: "approval_original",
          status: "active",
          sourceRevision: version.draftRevision
        },
        orderBy: { createdAt: "desc" }
      });
      if (!approvalOriginal) {
        throw new BadRequestException("未找到本次审批冻结的合同原件，不能关联双方最终版");
      }
      const [lockedFile] = await tx.$queryRaw<Array<{
        id: string;
        uploadedByUserId: string;
        storageStatus: string;
        mimeType: string;
        sizeBytes: number;
        contentSha256: string | null;
      }>>(Prisma.sql`
        SELECT "id", "uploadedByUserId", "storageStatus", "mimeType", "sizeBytes", "contentSha256"
        FROM "FileObject" WHERE "id" = ${input.fileId} FOR UPDATE
      `);
      if (!lockedFile || lockedFile.storageStatus !== "active" ||
        lockedFile.uploadedByUserId !== actorUserId ||
        lockedFile.mimeType !== inspected.fileSnapshot.mimeType ||
        lockedFile.sizeBytes !== inspected.fileSnapshot.sizeBytes ||
        lockedFile.contentSha256 !== inspected.sha256 ||
        lockedFile.contentSha256 !== inspected.fileSnapshot.contentSha256) {
        throw new BadRequestException("合同最终归档文件在校验后发生变化，请重新上传");
      }
      const bound = await tx.contractFormalFile.findFirst({ where: { fileId: input.fileId } });
      const authorization = await tx.contractAuthorization.findFirst({ where: { fileId: input.fileId } });
      if (bound || authorization) {
        throw new BadRequestException("该文件已关联其他合同签署事实，请重新上传最终版");
      }
      const previous = await tx.contractFormalFile.findFirst({
        where: {
          contractVersionId: version.id,
          purpose: "mutually_signed_final",
          status: "active"
        },
        orderBy: { createdAt: "desc" }
      });
      if (previous) {
        await tx.contractFormalFile.updateMany({
          where: { id: previous.id, status: "active" },
          data: {
            status: "superseded",
            invalidatedAt: new Date(),
            invalidationReason: "归档确认前已替换双方最终版合同"
          }
        });
      }
      const declaration = this.finalDeclaration(input);
      const created = await tx.contractFormalFile.create({
        data: {
          contractVersionId: version.id,
          purpose: "mutually_signed_final",
          fileId: input.fileId,
          contentSha256: inspected.sha256,
          pageCount: inspected.pageCount,
          sourceRevision: input.sourceRevision,
          status: "active",
          uploadedByUserId: actorUserId,
          supersedesId: previous?.id ?? null,
          declarationSnapshot: declaration as Prisma.InputJsonValue,
          declaredByUserId: actorUserId,
          declaredAt: new Date()
        }
      });
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: version.id,
          status: { in: ["seal_approved_pending_archive", "pending_archive_confirm"] }
        },
        data: { status: "pending_archive_confirm" }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("合同归档状态已变化，请刷新后重试");
      }
      await this.audit?.record(tx, {
        actorUserId,
        action: "contract.formal_file.final_upload",
        businessType: "contract_version",
        businessId: version.id,
        metadata: { formalFileId: created.id, fileId: created.fileId, declaration }
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async returnForCorrection(
    contractVersionId: string,
    actorUserId: string,
    input: ReturnContractFormalFileDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_director");
      const { version, task } = await this.lockVersionAndTask(tx, contractVersionId, true);
      this.assertGoverned(version);
      if (version.status !== "pending_archive_confirm" || task.status !== "completed") {
        throw new BadRequestException("当前合同没有待确认的双方最终版");
      }
      const formal = await tx.contractFormalFile.findFirst({
        where: {
          id: input.formalFileId,
          contractVersionId: version.id,
          purpose: "mutually_signed_final",
          status: "active"
        }
      });
      if (!formal) throw new BadRequestException("待补正的合同最终版不存在或已处理");
      const now = new Date();
      await tx.contractFormalFile.update({
        where: { id: formal.id },
        data: { status: "invalidated", invalidatedAt: now, invalidationReason: input.reason.trim() }
      });
      await tx.contractVersion.updateMany({
        where: { id: version.id, status: "pending_archive_confirm" },
        data: { status: "seal_approved_pending_archive" }
      });
      await this.audit?.record(tx, {
        actorUserId,
        action: "contract.formal_file.return_correction",
        businessType: "contract_version",
        businessId: version.id,
        metadata: { formalFileId: formal.id, reason: input.reason.trim() }
      });
      return { status: "seal_approved_pending_archive", formalFileId: formal.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmArchive(
    contractVersionId: string,
    actorUserId: string,
    input: ConfirmMutuallySignedContractDto
  ) {
    this.assertFinalDeclaration(input);
    if (!this.formalFiles) {
      throw new BadRequestException("合同正式文件校验服务暂不可用，请稍后重试");
    }
    await this.assertGlobalRole(
      this.prisma as unknown as Prisma.TransactionClient,
      actorUserId,
      "contract_director"
    );
    const preflightVersion = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: {
        id: true,
        contractId: true,
        status: true,
        contractGovernanceVersion: true,
        draftRevision: true
      }
    });
    this.assertGoverned(preflightVersion ?? {
      id: contractVersionId,
      contractId: "",
      status: "missing",
      contractGovernanceVersion: null
    });
    const preflightTask = await this.prisma.contractSealTask.findFirst({
      where: { contractVersionId, status: { not: "cancelled" } },
      orderBy: { createdAt: "desc" }
    });
    if (preflightVersion?.status !== "pending_archive_confirm" || preflightTask?.status !== "completed") {
      throw new BadRequestException("当前合同最终版尚不能确认归档");
    }
    const preflightFormal = await this.prisma.contractFormalFile.findFirst({
      where: {
        id: input.formalFileId,
        contractVersionId,
        purpose: "mutually_signed_final",
        status: "active"
      }
    });
    if (!preflightFormal) throw new BadRequestException("未找到待确认的双方最终版合同");
    if (preflightFormal.uploadedByUserId === actorUserId) {
      throw new ForbiddenException("上传人与归档确认人不能是同一人");
    }
    const preflightOriginal = await this.prisma.contractFormalFile.findFirst({
      where: {
        contractVersionId,
        purpose: "approval_original",
        status: "active",
        sourceRevision: preflightVersion.draftRevision
      },
      orderBy: { createdAt: "desc" }
    });
    if (!preflightOriginal) {
      throw new BadRequestException("未找到本次审批冻结的合同原件，不能确认归档");
    }
    const inspectedFinal = await this.formalFiles.inspectLinkedStoredFinalArchive(
      preflightFormal.fileId,
      preflightFormal.contentSha256,
      preflightFormal.pageCount
    );
    const inspectedOriginal = await this.formalFiles.inspectLinkedStoredPdf(
      preflightOriginal.fileId,
      preflightOriginal.contentSha256,
      preflightOriginal.pageCount
    );
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_director");
      const { version, task } = await this.lockVersionAndTask(tx, contractVersionId, true);
      this.assertGoverned(version);
      if (version.status !== "pending_archive_confirm" || task.status !== "completed") {
        throw new BadRequestException("当前合同最终版尚不能确认归档");
      }
      const formal = await tx.contractFormalFile.findFirst({
        where: {
          id: input.formalFileId,
          contractVersionId: version.id,
          purpose: "mutually_signed_final",
          status: "active"
        }
      });
      if (!formal) throw new BadRequestException("未找到待确认的双方最终版合同");
      if (formal.fileId !== preflightFormal.fileId ||
        formal.contentSha256 !== preflightFormal.contentSha256 ||
        formal.pageCount !== preflightFormal.pageCount ||
        formal.sourceRevision !== version.draftRevision) {
        throw new BadRequestException("合同最终归档文件或合同修订已变化，请重新核对后确认");
      }
      if (formal.uploadedByUserId === actorUserId) {
        throw new ForbiddenException("上传人与归档确认人不能是同一人");
      }
      const approvalOriginal = await tx.contractFormalFile.findFirst({
        where: {
          id: preflightOriginal.id,
          contractVersionId: version.id,
          purpose: "approval_original",
          status: "active",
          sourceRevision: version.draftRevision
        }
      });
      if (!approvalOriginal || approvalOriginal.fileId !== preflightOriginal.fileId ||
        approvalOriginal.contentSha256 !== preflightOriginal.contentSha256 ||
        approvalOriginal.pageCount !== preflightOriginal.pageCount) {
        throw new BadRequestException("本次审批冻结的合同原件已变化，请重新核对");
      }
      const fileIds = [formal.fileId, approvalOriginal.fileId].sort();
      const lockedFiles = await tx.$queryRaw<Array<{
        id: string;
        storageStatus: string;
        mimeType: string;
        sizeBytes: number;
        contentSha256: string | null;
      }>>(Prisma.sql`
        SELECT "id", "storageStatus", "mimeType", "sizeBytes", "contentSha256"
        FROM "FileObject" WHERE "id" IN (${Prisma.join(fileIds)}) ORDER BY "id" FOR UPDATE
      `);
      const fileById = new Map(lockedFiles.map((file) => [file.id, file]));
      const finalFile = fileById.get(formal.fileId);
      const originalFile = fileById.get(approvalOriginal.fileId);
      if (!this.matchesInspectedFile(finalFile, inspectedFinal) ||
        !this.matchesInspectedFile(originalFile, inspectedOriginal)) {
        throw new BadRequestException("合同正式文件在校验后发生变化，请重新核对后确认");
      }
      await this.assertStructuredPaymentStage(tx, version.id);
      const confirmedAt = new Date();
      const confirmationSnapshot = this.finalDeclaration(input);
      await tx.contractFormalFile.update({
        where: { id: formal.id },
        data: {
          confirmedByUserId: actorUserId,
          confirmedAt,
          confirmationSnapshot: confirmationSnapshot as Prisma.InputJsonValue
        }
      });
      const { effectiveVersion: result, supersededVersionId } = await this.activation.activate(tx, {
        contractVersionId: version.id,
        actorUserId,
        effectiveAt: confirmedAt
      });
      await this.audit?.record(tx, {
        actorUserId,
        action: "contract.archive.confirm",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          formalFileId: formal.id,
          confirmationSnapshot,
          supersedesVersionId: supersededVersionId
        }
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async invalidateForMaterialChange(
    contractVersionId: string,
    actorUserId: string,
    input: InvalidateContractSigningDto
  ) {
    const audit = this.audit;
    try {
      return await this.prisma.$transaction(async (tx) => {
      const { version, task } = await this.lockVersionAndTask(tx, contractVersionId, true);
      this.assertGoverned(version);
      const isDirector = await this.hasGlobalRole(tx, actorUserId, "contract_director");
      if (task.handlerUserId !== actorUserId && !isDirector) {
        throw new ForbiddenException("只有冻结经办人或合同部主管可以申报签署文件实质变化");
      }
      if (
        input.expectedRevision !== version.draftRevision ||
        input.expectedSealTaskId !== task.id ||
        input.expectedStatus !== version.status
      ) {
        throw new BadRequestException("合同签署状态已变化，请刷新后重新申报");
      }
      const expectedTaskStatusByVersionStatus: Record<string, string> = {
        approved_pending_seal: "pending_approval",
        in_seal: "in_seal",
        seal_approved_pending_archive: "completed",
        pending_archive_confirm: "completed"
      };
      const expectedTaskStatus = expectedTaskStatusByVersionStatus[version.status];
      if (!expectedTaskStatus || task.status !== expectedTaskStatus) {
        throw new BadRequestException("合同签署任务状态与合同阶段不一致，请联系管理员核对");
      }
      if (!audit) {
        throw new BadRequestException("合同签署变更审计服务暂不可用，请稍后重试");
      }
      const now = new Date();
      const invalidatedFiles = await tx.contractFormalFile.findMany({
        where: { contractVersionId: version.id, status: "active" },
        select: { id: true },
        orderBy: { id: "asc" }
      });
      const invalidated = await tx.contractFormalFile.updateMany({
        where: { contractVersionId: version.id, status: "active" },
        data: { status: "invalidated", invalidatedAt: now, invalidationReason: input.reason.trim() }
      });
      const cancelled = await tx.contractSealTask.updateMany({
        where: { id: task.id, status: expectedTaskStatus },
        data: {
          status: "cancelled",
          cancelledByUserId: actorUserId,
          cancelledAt: now,
          cancellationReason: input.reason.trim()
        }
      });
      const reverted = await tx.contractVersion.updateMany({
        where: {
          id: version.id,
          status: input.expectedStatus,
          draftRevision: input.expectedRevision
        },
        data: {
          status: "draft",
          draftRevision: { increment: 1 },
          readinessSnapshot: Prisma.DbNull,
          taxFactStatus: "draft",
          taxFactsFrozenAt: null
        }
      });
      if (
        invalidated.count !== invalidatedFiles.length ||
        cancelled.count !== 1 ||
        reverted.count !== 1
      ) {
        throw new BadRequestException("合同签署状态已变化，请刷新后重新申报");
      }
      await audit.record(tx, {
        actorUserId,
        action: "contract.signing.material_change",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          reason: input.reason.trim(),
          sealTaskId: task.id,
          fromStatus: version.status,
          toStatus: "draft",
          fromRevision: version.draftRevision,
          toRevision: version.draftRevision + 1,
          invalidatedFormalFileIds: invalidatedFiles.map((file) => file.id),
          invalidatedFormalFileCount: invalidatedFiles.length
        }
      });
      return {
        status: "draft",
        draftRevision: version.draftRevision + 1,
        requiresReapproval: true
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializationConflict(error)) {
        throw new ConflictException(
          "合同签署状态已并发变化，请刷新后重新申报"
        );
      }
      throw error;
    }
  }

  private assertCompletion(input: CompleteContractSealDto) {
    if (!input.firstPartySignedOrStamped || !input.companySealCompleted ||
      !input.crossPageSealCompleted || !input.signingDateCompleted) {
      throw new BadRequestException("请确认我方签署、公章、骑缝章和签署日期均已完成");
    }
  }

  private assertFinalDeclaration(input: CompleteContractSealDto & {
    onlyPermittedSignatureChanges: boolean;
    documentOrderConfirmed: boolean;
  }) {
    this.assertCompletion(input);
    if (!input.onlyPermittedSignatureChanges || !input.documentOrderConfirmed) {
      throw new BadRequestException("请确认最终版仅新增签字、盖章、骑缝章和签署日期，且页序完整");
    }
  }

  private finalDeclaration(input: CompleteContractSealDto & {
    onlyPermittedSignatureChanges: boolean;
    documentOrderConfirmed: boolean;
  }) {
    return {
      version: 1,
      firstPartySignedOrStamped: input.firstPartySignedOrStamped,
      companySealCompleted: input.companySealCompleted,
      crossPageSealCompleted: input.crossPageSealCompleted,
      signingDateCompleted: input.signingDateCompleted,
      onlyPermittedSignatureChanges: input.onlyPermittedSignatureChanges,
      documentOrderConfirmed: input.documentOrderConfirmed
    };
  }

  private assertGoverned(version: GovernedVersion) {
    if (version.contractGovernanceVersion !== 1) {
      throw new BadRequestException("该存量合同沿用原用章与归档流程");
    }
  }

  private async lockVersionAndTask(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    includeSigningFields = false
  ) {
    const seed = await tx.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: { contractId: true }
    });
    if (!seed) throw new BadRequestException("未找到合同版本，请刷新合同台账后重试");
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Contract" WHERE "id" = ${seed.contractId} FOR UPDATE
    `);
    const [version] = await tx.$queryRaw<GovernedVersion[]>(Prisma.sql`
      SELECT "id", "contractId", "status", "contractGovernanceVersion"
        ${includeSigningFields ? Prisma.sql`, "draftRevision", "changeType", "baseVersionId"` : Prisma.empty}
      FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE
    `);
    if (!version) throw new BadRequestException("未找到合同版本，请刷新合同台账后重试");
    const [task] = await tx.$queryRaw<SealTask[]>(Prisma.sql`
      SELECT "id", "contractVersionId", "approvalInstanceId", "handlerUserId", "status"
      FROM "ContractSealTask"
      WHERE "contractVersionId" = ${contractVersionId} AND "status" <> 'cancelled'
      ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE
    `);
    if (!task) throw new BadRequestException("未找到冻结的用章任务，请联系管理员核对审批结果");
    return { version, task };
  }

  private async canUploadFinal(
    tx: Prisma.TransactionClient,
    projectId: string,
    task: SealTask,
    actorUserId: string
  ) {
    if (task.handlerUserId === actorUserId) return true;
    if (!(await this.hasGlobalRole(tx, task.handlerUserId, "contract_director"))) return false;
    const directorCount = await this.countActiveGlobalRole(tx, "contract_director");
    if (directorCount !== 1) return false;
    const [member, user] = await Promise.all([
      tx.projectMember.findFirst({
        where: { projectId, userId: actorUserId, positionKey: "contract_staff" },
        select: { id: true }
      }),
      tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } })
    ]);
    return Boolean(member && user?.isActive);
  }

  private async assertStructuredPaymentStage(tx: Prisma.TransactionClient, contractVersionId: string) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: { contractId: true }
    });
    const contract = version ? await tx.contract.findUnique({
      where: { id: version.contractId },
      select: { contractTypeKey: true }
    }) : null;
    const contractTypeKey = contract?.contractTypeKey?.trim() ?? "";
    const isGenericContract = contractTypeKey === "generic_contract";
    if (!isGenericContract && !SETTLEMENT_CONTRACT_TYPES.has(contractTypeKey)) {
      throw new BadRequestException("合同类型不在支持范围内，不能确认归档生效");
    }
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId },
      select: { id: true }
    });
    const stages = terms ? await tx.paymentTermsStage.findMany({
      where: { paymentTermsVersionId: terms.id },
      select: {
        id: true,
        stageType: true,
        basis: true,
        ratioBps: true,
        fixedAmountCents: true,
        triggerAnchor: true,
        dueDays: true
      }
    }) : [];
    const directStages = stages.filter((stage) => stage.stageType !== "advance");
    const hasValidStage = isGenericContract
      ? directStages.length > 0 && directStages.every((stage) => {
          const hasValidRatio =
            stage.ratioBps !== null &&
            Number.isInteger(stage.ratioBps) &&
            stage.ratioBps > 0 &&
            stage.ratioBps <= 10000;
          const hasValidFixedAmount =
            stage.fixedAmountCents !== null && stage.fixedAmountCents > 0n;
          return (
            stage.basis === "contract_amount" &&
            stage.triggerAnchor === "contract_effective" &&
            hasValidRatio !== hasValidFixedAmount &&
            Number.isSafeInteger(stage.dueDays) &&
            stage.dueDays >= 0
          );
        })
      : stages.some(
          (stage) =>
            stage.basis === "current_settlement" &&
            stage.ratioBps !== null &&
            stage.ratioBps > 0
        );
    if (!terms || !hasValidStage) {
      throw new BadRequestException(
        isGenericContract
          ? "通用合同缺少可执行的直接付款阶段，不能确认归档生效"
          : "合同付款条款缺少有效结算款阶段，不能确认归档生效"
      );
    }
  }

  private matchesInspectedFile(
    current: {
      storageStatus: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
    } | undefined,
    inspected: {
      sha256: string;
      fileSnapshot: {
        storageStatus: string;
        mimeType: string;
        sizeBytes: number;
        contentSha256: string | null;
      };
    }
  ) {
    return Boolean(current && current.storageStatus === "active" &&
      current.storageStatus === inspected.fileSnapshot.storageStatus &&
      current.mimeType === inspected.fileSnapshot.mimeType &&
      current.sizeBytes === inspected.fileSnapshot.sizeBytes &&
      current.contentSha256 === inspected.sha256 &&
      current.contentSha256 === inspected.fileSnapshot.contentSha256);
  }

  private async hasGlobalRole(tx: Prisma.TransactionClient, userId: string, roleKey: string) {
    const [position, user] = await Promise.all([
      tx.position.findUnique({ where: { key: roleKey }, select: { id: true } }),
      tx.user.findUnique({ where: { id: userId }, select: { isActive: true } })
    ]);
    if (!position || !user?.isActive) return false;
    return Boolean(await tx.userPosition.findFirst({
      where: { userId, projectId: null, positionId: position.id },
      select: { id: true }
    }));
  }

  private async countActiveGlobalRole(tx: Prisma.TransactionClient, roleKey: string) {
    const position = await tx.position.findUnique({ where: { key: roleKey }, select: { id: true } });
    if (!position) return 0;
    const assignments = await tx.userPosition.findMany({
      where: { projectId: null, positionId: position.id },
      select: { userId: true }
    });
    const users = assignments.length ? await tx.user.findMany({
      where: { id: { in: assignments.map((item) => item.userId) }, isActive: true },
      select: { id: true }
    }) : [];
    return new Set(users.map((user) => user.id)).size;
  }

  private async assertGlobalRole(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    roleKey: string
  ) {
    if (!(await this.hasGlobalRole(tx, actorUserId, roleKey))) {
      throw new ForbiddenException("当前账号无权处理该合同用章任务");
    }
  }
}
