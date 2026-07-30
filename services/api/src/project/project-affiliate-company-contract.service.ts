import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import {
  acquireFileBusinessBindingTransactionLock,
  hasNonReceiptBusinessFileBinding
} from "../file/file-business-binding";
import type { ConfirmProjectAffiliateBusinessFactDto } from "./dto/confirm-project-affiliate-business-fact.dto";
import type { RecordProjectAffiliateCompanyContractDto } from "./dto/record-project-affiliate-company-contract.dto";
import { resolveCurrentProjectAffiliate } from "./project-affiliate-subject";

type AffiliateCompanyContractRow = {
  id: string;
  projectId: string;
  contractReference: string;
  contractName: string;
  signedAt: Date;
  rightsObligationsSummary: string;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  affiliateCreditCodeSnapshot: string | null;
  companyEntityId: string;
  companyEntityVersionId: string;
  companyEntityNameSnapshot: string;
  companyEntityCreditCodeSnapshot: string;
  companyEntityRegisteredAddressSnapshot: string | null;
  fileId: string;
  documentVersion: number;
  fileContentSha256Snapshot: string;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedByUserId: string;
  recordedByRoleKey: string;
  status: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  confirmationActionId: string | null;
  confirmationSignatureVersionId: string | null;
  confirmationSignatureFileId: string | null;
  confirmationSignatureSha256: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ProjectAffiliateCompanyContractService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService
  ) {}

  list(projectId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await requireActiveProject(tx, projectId);
      const roles = await loadActorRoleKeys(tx, actorUserId, projectId);
      const contracts = await tx.projectAffiliateCompanyContract.findMany({
        where: { projectId },
        orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }]
      });
      return {
        availableActions: roles.includes("contract_staff")
          ? (["record_affiliate_company_contract"] as const)
          : [],
        contracts: contracts.map((contract) => toReadModel(contract, roles))
      };
    });
  }

  async record(
    projectId: string,
    actorUserId: string,
    input: RecordProjectAffiliateCompanyContractDto
  ) {
    const contractReference = requiredTrimmed(
      input.contractReference,
      "请填写挂靠企业与我方线下合同编号"
    );
    const contractName = requiredTrimmed(
      input.contractName,
      "请填写挂靠企业与我方线下合同名称"
    );
    const signedAt = strictDateOnly(
      input.signedAt,
      "线下合同签订日期不正确，请重新选择"
    );
    const rightsObligationsSummary = requiredTrimmed(
      input.rightsObligationsSummary,
      "请填写挂靠企业与我方双方权利义务摘要"
    );
    const companyEntityId = requiredTrimmed(
      input.companyEntityId,
      "请选择我方签约主体"
    );
    const fileId = requiredTrimmed(input.fileId, "请上传已线下签署的正式合同文件");
    const idempotencyKey = requiredTrimmed(
      input.idempotencyKey,
      "请提供线下合同登记幂等键"
    );
    const requestFingerprint = fingerprint({
      projectId,
      actorUserId,
      contractReference,
      contractName,
      signedAt: signedAt.toISOString(),
      rightsObligationsSummary,
      companyEntityId,
      fileId
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.projectAffiliateCompanyContract.findUnique({
          where: { idempotencyKey }
        });
        if (replay) {
          assertReplay(replay, projectId, actorUserId, requestFingerprint);
          return toReadModel(
            replay,
            await loadActorRoleKeys(tx, actorUserId, projectId)
          );
        }

        await requireActiveProject(tx, projectId);
        const roles = await loadActorRoleKeys(tx, actorUserId, projectId);
        if (!roles.includes("contract_staff")) {
          throw new ForbiddenException(
            "只有合同人员可以登记挂靠企业与我方已签线下合同"
          );
        }
        const affiliate = await resolveCurrentProjectAffiliate(tx, projectId);
        const company = await lockAndLoadCompanyEntity(tx, companyEntityId);
        const file = await lockAndValidateSignedFile(tx, actorUserId, fileId);
        const created = await tx.projectAffiliateCompanyContract.create({
          data: {
            projectId,
            contractReference,
            contractName,
            signedAt,
            rightsObligationsSummary,
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
            affiliateNameSnapshot: affiliate.name,
            affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode,
            companyEntityId: company.companyEntityId,
            companyEntityVersionId: company.id,
            companyEntityNameSnapshot: company.name,
            companyEntityCreditCodeSnapshot: company.unifiedSocialCreditCode,
            companyEntityRegisteredAddressSnapshot: company.registeredAddress,
            fileId,
            documentVersion: 1,
            fileContentSha256Snapshot: file.contentSha256,
            idempotencyKey,
            requestFingerprint,
            recordedByUserId: actorUserId,
            recordedByRoleKey: "contract_staff",
            status: "pending_confirm"
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.affiliate_company_contract.record",
          businessType: "project_affiliate_company_contract",
          businessId: created.id,
          metadata: {
            projectId,
            contractReference,
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
            companyEntityId: company.companyEntityId,
            companyEntityVersionId: company.id,
            fileId,
            fileContentSha256Snapshot: file.contentSha256,
            companyApprovalCreated: false,
            companySealCreated: false,
            ownerReceiptCreated: false,
            paymentWorkflowCreated: false
          }
        });
        return toReadModel(created, roles);
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay = await this.prisma.projectAffiliateCompanyContract.findUnique({
        where: { idempotencyKey }
      });
      if (replay) {
        assertReplay(replay, projectId, actorUserId, requestFingerprint);
        return toReadModel(replay, []);
      }
      throw new ConflictException(
        "该线下合同编号或正式文件已登记，不能跨项目或跨业务重复绑定"
      );
    }
  }

  async confirm(
    projectId: string,
    contractId: string,
    actorUserId: string,
    input: ConfirmProjectAffiliateBusinessFactDto,
    now: Date = new Date()
  ) {
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    const confirmationActionId = requiredTrimmed(
      input.confirmationActionId,
      "请提供线下合同确认幂等键"
    );
    await this.prisma.$transaction(async (tx) => {
      await requireActiveProject(tx, projectId);
      const roles = await loadActorRoleKeys(tx, actorUserId, projectId);
      if (!roles.includes("contract_director")) {
        throw new ForbiddenException(
          "只有合同主管可以确认挂靠企业与我方已签线下合同"
        );
      }
    });
    if (!this.auth) {
      throw new Error("Auth service is required to confirm affiliate-company contract");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.projectAffiliateCompanyContract.findUnique({
          where: { confirmationActionId }
        });
        if (replay) {
          assertConfirmationReplay(
            replay,
            projectId,
            contractId,
            actorUserId
          );
          return toReadModel(
            replay,
            await loadActorRoleKeys(tx, actorUserId, projectId)
          );
        }

        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ProjectAffiliateCompanyContract"
          WHERE "id" = ${contractId} AND "projectId" = ${projectId}
          FOR UPDATE
        `);
        const replayAfterLock =
          await tx.projectAffiliateCompanyContract.findUnique({
            where: { confirmationActionId }
          });
        if (replayAfterLock) {
          assertConfirmationReplay(
            replayAfterLock,
            projectId,
            contractId,
            actorUserId
          );
          return toReadModel(
            replayAfterLock,
            await loadActorRoleKeys(tx, actorUserId, projectId)
          );
        }
        const contract = await tx.projectAffiliateCompanyContract.findFirst({
          where: { id: contractId, projectId }
        });
        if (!contract) {
          throw new NotFoundException("待确认的挂靠企业与我方线下合同不存在");
        }
        if (contract.status !== "pending_confirm") {
          throw new BadRequestException("当前线下合同状态不可确认");
        }
        const roles = await loadActorRoleKeys(tx, actorUserId, projectId);
        if (!roles.includes("contract_director")) {
          throw new ForbiddenException(
            "只有合同主管可以确认挂靠企业与我方已签线下合同"
          );
        }
        const signature = await snapshotApprovalSignature(tx, actorUserId, {
          required: true
        });
        const updated = await tx.projectAffiliateCompanyContract.updateMany({
          where: {
            id: contractId,
            projectId,
            status: "pending_confirm",
            confirmationActionId: null
          },
          data: {
            status: "confirmed",
            confirmedByUserId: actorUserId,
            confirmedAt: now,
            confirmationActionId,
            confirmationSignatureVersionId: signature.versionId,
            confirmationSignatureFileId: signature.fileId,
            confirmationSignatureSha256: signature.sha256
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException("线下合同已被其他操作确认，请刷新后核对");
        }
        const confirmed = await tx.projectAffiliateCompanyContract.findUnique({
          where: { id: contractId }
        });
        if (!confirmed) {
          throw new InternalServerErrorException("线下合同确认结果未正确保存");
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "project.affiliate_company_contract.confirm",
          businessType: "project_affiliate_company_contract",
          businessId: contractId,
          metadata: {
            projectId,
            contractReference: confirmed.contractReference,
            confirmationActionId,
            confirmationSignatureVersionId: signature.versionId,
            confirmedAt: now.toISOString(),
            companyApprovalCreated: false,
            companySealCreated: false,
            ownerReceiptCreated: false,
            paymentWorkflowCreated: false
          }
        });
        return toReadModel(confirmed, roles);
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay =
        await this.prisma.projectAffiliateCompanyContract.findUnique({
          where: { confirmationActionId }
        });
      if (replay) {
        assertConfirmationReplay(
          replay,
          projectId,
          contractId,
          actorUserId
        );
        return toReadModel(replay, []);
      }
      throw new ConflictException("线下合同确认幂等键已用于不同动作");
    }
  }
}

function assertConfirmationReplay(
  replay: AffiliateCompanyContractRow,
  projectId: string,
  contractId: string,
  actorUserId: string
) {
  if (
    replay.id !== contractId ||
    replay.projectId !== projectId ||
    replay.confirmedByUserId !== actorUserId
  ) {
    throw new ConflictException("线下合同确认幂等键已用于不同动作");
  }
}

async function requireActiveProject(
  tx: Prisma.TransactionClient,
  projectId: string
) {
  const project = await tx.project.findFirst({
    where: { id: projectId, isActive: true },
    select: { id: true }
  });
  if (!project) {
    throw new NotFoundException("项目不存在或已停用，请刷新后重试");
  }
}

async function lockAndLoadCompanyEntity(
  tx: Prisma.TransactionClient,
  companyEntityId: string
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "CompanyEntity"
    WHERE "id" = ${companyEntityId}
    FOR UPDATE
  `);
  const entity = await tx.companyEntity.findUnique({
    where: { id: companyEntityId },
    select: {
      id: true,
      currentVersionNo: true,
      isActive: true,
      dataStatus: true
    }
  });
  if (!entity?.isActive || entity.dataStatus !== "complete") {
    throw new BadRequestException(
      "所选我方签约主体不存在、已停用或资料不完整，请先完成主体治理"
    );
  }
  const version = await tx.companyEntityVersion.findUnique({
    where: {
      companyEntityId_versionNo: {
        companyEntityId: entity.id,
        versionNo: entity.currentVersionNo
      }
    },
    select: {
      id: true,
      companyEntityId: true,
      name: true,
      unifiedSocialCreditCode: true,
      registeredAddress: true
    }
  });
  if (!version?.unifiedSocialCreditCode?.trim()) {
    throw new BadRequestException(
      "所选我方签约主体当前版本缺少统一社会信用代码，不能冻结线下合同主体"
    );
  }
  return {
    ...version,
    unifiedSocialCreditCode: version.unifiedSocialCreditCode.trim()
  };
}

async function lockAndValidateSignedFile(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  fileId: string
) {
  await acquireFileBusinessBindingTransactionLock(tx);
  if (await hasNonReceiptBusinessFileBinding(tx, [fileId])) {
    throw new ConflictException(
      "已签线下合同文件已绑定其他项目或业务事实，不能重复使用"
    );
  }
  const file = await tx.fileObject.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      uploadedByUserId: true,
      storageStatus: true,
      contentSha256: true
    }
  });
  if (!file) throw new NotFoundException("已签线下合同文件不存在，请重新上传");
  if (file.uploadedByUserId !== actorUserId) {
    throw new BadRequestException("只能使用本人上传的已签线下合同文件");
  }
  if (
    file.storageStatus !== "active" ||
    typeof file.contentSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(file.contentSha256)
  ) {
    throw new BadRequestException("已签线下合同文件尚未完成有效性校验");
  }
  return { id: file.id, contentSha256: file.contentSha256 };
}

async function loadActorRoleKeys(
  tx: Pick<Prisma.TransactionClient, "userPosition" | "projectMember" | "position">,
  actorUserId: string,
  projectId: string
): Promise<RoleKey[]> {
  const [globalPositions, projectPositions, projectMembers] = await Promise.all([
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
    tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
  ]);
  const positionIds = [
    ...new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    )
  ];
  const positions = positionIds.length
    ? await tx.position.findMany({ where: { id: { in: positionIds } } })
    : [];
  return [
    ...new Set([
      ...positions.map((position) => position.key as RoleKey),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ])
  ];
}

function toReadModel(
  contract: AffiliateCompanyContractRow,
  roles: readonly RoleKey[]
) {
  return {
    ...contract,
    agreementScope: "affiliate_to_our_company" as const,
    ownerContractReplacementAllowed: false,
    ownerReceiptCreated: false,
    companyApprovalCreated: false,
    companySealCreated: false,
    companyPaymentWorkflowCreated: false,
    affiliateRemittanceRequiresContractSettlement: false,
    availableActions:
      contract.status === "pending_confirm" &&
      roles.includes("contract_director")
        ? (["confirm"] as const)
        : []
  };
}

function assertReplay(
  existing: {
    projectId: string;
    recordedByUserId: string;
    requestFingerprint: string;
  },
  projectId: string,
  actorUserId: string,
  requestFingerprint: string
) {
  if (
    existing.projectId !== projectId ||
    existing.recordedByUserId !== actorUserId ||
    existing.requestFingerprint !== requestFingerprint
  ) {
    throw new ConflictException("线下合同登记幂等键已用于不同请求");
  }
}

function requiredTrimmed(value: unknown, message: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(message);
  return text;
}

function strictDateOnly(value: unknown, message: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new BadRequestException(message);
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(message);
  }
  return date;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002") ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002")
  );
}
