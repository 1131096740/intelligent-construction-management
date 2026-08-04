import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { PrismaService } from "../database/prisma.service";

export const CONTRACT_DRAFT_LEASE_TTL_MS = 120_000;
export const CONTRACT_DRAFT_LEASE_HEARTBEAT_MS = 30_000;

const EDITABLE_CONTRACT_DRAFT_STATUSES = new Set(["draft", "approval_rejected"]);

interface TakeOverContractDraftEditLeaseInput {
  currentPassword: string;
}

@Injectable()
export class ContractDraftEditLeaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Optional() private readonly currentTime: () => Date = () => new Date()
  ) {}

  async acquire(contractVersionId: string, actorUserId: string) {
    const issued = this.issueToken();
    return this.prisma.$transaction(async (tx) => {
      const { contract } = await this.lockEditableDraft(tx, contractVersionId);
      if (contract.ownerUserId !== actorUserId) {
        throw new ForbiddenException("只有当前合同经办人可以取得编辑权");
      }
      const now = this.currentTime();
      const existing = await tx.contractDraftEditLease.findUnique({
        where: { contractVersionId }
      });
      if (existing && existing.expiresAt.getTime() > now.getTime()) {
        throw new ConflictException({
          statusCode: 409,
          code: "EDIT_LEASE_HELD",
          message: "该合同草稿已在其他页面编辑，请等待编辑权释放或联系合同部主管"
        });
      }
      const expiresAt = new Date(now.getTime() + CONTRACT_DRAFT_LEASE_TTL_MS);
      const leaseRevision = (existing?.leaseRevision ?? 0) + 1;
      await tx.contractDraftEditLease.upsert({
        where: { contractVersionId },
        create: {
          contractVersionId,
          holderUserId: actorUserId,
          tokenHash: issued.tokenHash,
          leaseRevision,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt
        },
        update: {
          holderUserId: actorUserId,
          tokenHash: issued.tokenHash,
          leaseRevision,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt
        }
      });
      return {
        token: issued.rawToken,
        leaseRevision,
        expiresAt: expiresAt.toISOString(),
        heartbeatIntervalMs: CONTRACT_DRAFT_LEASE_HEARTBEAT_MS
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async heartbeat(contractVersionId: string, rawToken: string) {
    const now = this.currentTime();
    const expiresAt = new Date(now.getTime() + CONTRACT_DRAFT_LEASE_TTL_MS);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockEditableDraft(tx, contractVersionId);
        const result = await tx.contractDraftEditLease.updateMany({
          where: {
            contractVersionId,
            tokenHash: this.hashToken(rawToken),
            expiresAt: { gt: now }
          },
          data: { heartbeatAt: now, expiresAt }
        });
        if (result.count !== 1) {
          throw this.leaseLost();
        }
        const lease = await tx.contractDraftEditLease.findUnique({
          where: { contractVersionId }
        });
        return {
          leaseRevision: lease?.leaseRevision ?? null,
          expiresAt: expiresAt.toISOString()
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw this.leaseLost();
      }
      throw error;
    }
  }

  async takeOver(
    contractVersionId: string,
    actorUserId: string,
    input: TakeOverContractDraftEditLeaseInput
  ) {
    await this.auth.confirmPassword(actorUserId, input.currentPassword);
    const issued = this.issueToken();
    return this.prisma.$transaction(async (tx) => {
      await this.lockEditableDraft(tx, contractVersionId);
      await this.assertContractDirector(tx, actorUserId);
      const existing = await tx.contractDraftEditLease.findUnique({
        where: { contractVersionId }
      });
      const now = this.currentTime();
      const expiresAt = new Date(now.getTime() + CONTRACT_DRAFT_LEASE_TTL_MS);
      const leaseRevision = (existing?.leaseRevision ?? 0) + 1;
      await tx.contractDraftEditLease.upsert({
        where: { contractVersionId },
        create: {
          contractVersionId,
          holderUserId: actorUserId,
          tokenHash: issued.tokenHash,
          leaseRevision,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt
        },
        update: {
          holderUserId: actorUserId,
          tokenHash: issued.tokenHash,
          leaseRevision,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.edit_lease.takeover",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          previousHolderUserId: existing?.holderUserId ?? null,
          leaseRevision
        }
      });
      return {
        token: issued.rawToken,
        leaseRevision,
        expiresAt: expiresAt.toISOString(),
        heartbeatIntervalMs: CONTRACT_DRAFT_LEASE_HEARTBEAT_MS
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async release(contractVersionId: string, rawToken: string) {
    const result = await this.prisma.contractDraftEditLease.deleteMany({
      where: {
        contractVersionId,
        tokenHash: this.hashToken(rawToken)
      }
    });
    return { released: result.count === 1 };
  }

  private async lockEditableDraft(
    tx: Prisma.TransactionClient,
    contractVersionId: string
  ) {
    const mutationBoundary = await lockContractDraftMutationBoundary(
      tx,
      contractVersionId
    );
    if (!mutationBoundary) {
      throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
    }
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) {
      throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
    }
    if (!EDITABLE_CONTRACT_DRAFT_STATUSES.has(version.status)) {
      throw new BadRequestException("合同版本当前不可按草稿办理，请刷新后重试");
    }
    if (version.changeType === "historical_takeover") {
      throw new BadRequestException("历史接管草稿必须在历史接管工作台办理");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException(
        "合同已存在正式业务事实，不能继续办理草稿"
      );
    }
    const contract = await tx.contract.findUnique({
      where: { id: mutationBoundary.contractId }
    });
    if (!contract) {
      throw new NotFoundException("未找到合同草稿，请刷新后重试");
    }
    if (contract.voidedAt) {
      throw new BadRequestException("合同草稿已作废，不能继续办理");
    }
    return { contract, version };
  }

  private async assertContractDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (!positions.some((position) => position.key === "contract_director")) {
      throw new ForbiddenException("只有合同部主管可以接管合同草稿编辑权");
    }
  }

  private issueToken() {
    const rawToken = randomBytes(32).toString("base64url");
    return { rawToken, tokenHash: this.hashToken(rawToken) };
  }

  private hashToken(rawToken: string) {
    if (!rawToken) throw this.leaseLost();
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private leaseLost() {
    return new ConflictException({
      statusCode: 409,
      code: "EDIT_LEASE_LOST",
      message: "合同草稿编辑权已失效，请保留当前内容并重新取得编辑权"
    });
  }
}
