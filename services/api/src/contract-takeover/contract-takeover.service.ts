import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { ConfirmContractTakeoverDto } from "./dto/confirm-contract-takeover.dto";
import type {
  ContractLifecycleStatus,
  ContractTakeoverLevel,
  CreateContractTakeoverDto
} from "./dto/create-contract-takeover.dto";

const TAKEOVER_LEVELS = ["A", "B", "C"] as const;
const LIFECYCLE_STATUSES = [
  "signed_not_started",
  "in_progress",
  "suspended",
  "completed",
  "terminated",
  "disputed"
] as const;
const MONEY_FIELDS = [
  "historicalSettledCents",
  "historicalApprovalPendingPaymentCents",
  "historicalApprovedPendingPaymentCents",
  "historicalPaidCents",
  "historicalProxyPaidCents",
  "historicalAdvancePaidCents",
  "historicalAdvanceDeductedCents",
  "historicalRetentionWithheldCents",
  "historicalRetentionReleasedCents",
  "otherConfirmedOccupancyCents"
] as const satisfies readonly (keyof CreateContractTakeoverDto)[];

type TakeoverClient = Pick<Prisma.TransactionClient, "contractTakeover">;

@Injectable()
export class ContractTakeoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService
  ) {}

  async create(projectId: string, input: CreateContractTakeoverDto, actorUserId: string) {
    const data = this.normalizeCreateInput(input);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true, isActive: true }
      });
      if (!project?.isActive) {
        throw new Error("Project not found or inactive");
      }

      const contract = await tx.contract.create({
        data: {
          projectId,
          source: "historical_takeover",
          code: data.code,
          name: data.name,
          counterparty: data.counterparty,
          companyEntityId: data.companyEntityId ?? null,
          companyEntityName: data.companyEntityName ?? null,
          contractTypeKey: data.contractTypeKey ?? null,
          ownerUserId: actorUserId
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "historical_takeover",
          status: "draft",
          amountCents: BigInt(data.amountCents),
          draftData: { historicalTakeover: true } as Prisma.InputJsonValue,
          templateSnapshot: { historicalTakeover: true } as Prisma.InputJsonValue,
          clauseSnapshot: [] as Prisma.InputJsonValue
        }
      });

      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: data.paymentTermsOriginalText ?? ""
        }
      });

      const takeover = await tx.contractTakeover.create({
        data: {
          projectId,
          contractId: contract.id,
          contractVersionId: version.id,
          paymentTermsVersionId: terms.id,
          takeoverLevel: data.takeoverLevel,
          takeoverStatus: "draft",
          lifecycleStatus: data.lifecycleStatus,
          signedAt: data.signedAt,
          historicalSettledCents: BigInt(data.historicalSettledCents),
          historicalApprovalPendingPaymentCents: BigInt(data.historicalApprovalPendingPaymentCents),
          historicalApprovedPendingPaymentCents: BigInt(data.historicalApprovedPendingPaymentCents),
          historicalPaidCents: BigInt(data.historicalPaidCents),
          historicalProxyPaidCents: BigInt(data.historicalProxyPaidCents),
          historicalAdvancePaidCents: BigInt(data.historicalAdvancePaidCents),
          historicalAdvanceDeductedCents: BigInt(data.historicalAdvanceDeductedCents),
          historicalRetentionWithheldCents: BigInt(data.historicalRetentionWithheldCents),
          historicalRetentionReleasedCents: BigInt(data.historicalRetentionReleasedCents),
          otherConfirmedOccupancyCents: BigInt(data.otherConfirmedOccupancyCents),
          balanceSourceSummary: data.balanceSourceSummary ?? null,
          evidenceSummary: data.evidenceSummary ?? null,
          createdByUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.create",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: contract.id,
          contractVersionId: version.id,
          takeoverLevel: data.takeoverLevel
        }
      });

      return takeover;
    });
  }

  list(projectId: string) {
    return this.prisma.contractTakeover.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });
  }

  async detail(projectId: string, takeoverId: string) {
    return this.getProjectTakeover(this.prisma, projectId, takeoverId);
  }

  async submitReview(projectId: string, takeoverId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (!["draft", "needs_supplement"].includes(takeover.takeoverStatus)) {
        throw new Error(`Cannot submit takeover review from status ${takeover.takeoverStatus}`);
      }

      const submittedAt = new Date();
      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: {
          takeoverStatus: "pending_review",
          submittedByUserId: actorUserId,
          submittedAt
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.submit_review",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: takeover.contractId,
          contractVersionId: takeover.contractVersionId,
          fromStatus: takeover.takeoverStatus,
          toStatus: "pending_review"
        }
      });

      return updated;
    });
  }

  async confirm(
    projectId: string,
    takeoverId: string,
    actorUserId: string,
    input: ConfirmContractTakeoverDto
  ) {
    if (!input.confirmationPassword?.trim()) {
      throw new Error("Contract takeover confirmation password is required");
    }
    if (!this.auth) {
      throw new Error("Auth service is required to confirm contract takeover");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const takeover = await this.getProjectTakeover(tx, projectId, takeoverId);
      if (takeover.takeoverStatus !== "pending_review") {
        throw new Error(`Cannot confirm takeover from status ${takeover.takeoverStatus}`);
      }

      const confirmedAt = new Date();
      await tx.contractVersion.update({
        where: { id: takeover.contractVersionId },
        data: { status: "effective", effectiveAt: confirmedAt }
      });
      await tx.paymentTermsVersion.update({
        where: { id: takeover.paymentTermsVersionId },
        data: { status: "effective" }
      });
      const updated = await tx.contractTakeover.update({
        where: { id: takeover.id },
        data: {
          takeoverStatus: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt,
          historicalBalanceConfirmedByUserId: actorUserId,
          historicalBalanceConfirmedAt: confirmedAt
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract_takeover.confirm",
        businessType: "contract_takeover",
        businessId: takeover.id,
        metadata: {
          projectId,
          contractId: takeover.contractId,
          contractVersionId: takeover.contractVersionId,
          fromStatus: takeover.takeoverStatus,
          toStatus: "confirmed"
        }
      });

      return updated;
    });
  }

  private async getProjectTakeover(
    client: TakeoverClient,
    projectId: string,
    takeoverId: string
  ) {
    const takeover = await client.contractTakeover.findUnique({
      where: { id: takeoverId }
    });
    if (!takeover || takeover.projectId !== projectId) {
      throw new Error("Contract takeover not found");
    }

    return takeover;
  }

  private normalizeCreateInput(input: CreateContractTakeoverDto) {
    if (!input.code?.trim()) throw new Error("Contract code is required");
    if (!input.name?.trim()) throw new Error("Contract name is required");
    if (!input.counterparty?.trim()) throw new Error("Contract counterparty is required");
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("amountCents must be a positive integer");
    }
    if (!TAKEOVER_LEVELS.includes(input.takeoverLevel as ContractTakeoverLevel)) {
      throw new Error("Invalid takeover level");
    }
    if (!LIFECYCLE_STATUSES.includes(input.lifecycleStatus as ContractLifecycleStatus)) {
      throw new Error("Invalid lifecycle status");
    }

    if (typeof input.signedAt !== "string" || !input.signedAt.trim()) {
      throw new Error("signedAt must be a valid date string");
    }

    const signedAt = new Date(input.signedAt);
    if (Number.isNaN(signedAt.getTime())) {
      throw new Error("signedAt must be a valid date string");
    }

    const money = Object.fromEntries(
      MONEY_FIELDS.map((field) => {
        const value = input[field] ?? 0;
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`${field} must be a non-negative integer`);
        }
        return [field, value];
      })
    ) as Record<(typeof MONEY_FIELDS)[number], number>;

    return {
      ...input,
      ...money,
      code: input.code.trim(),
      name: input.name.trim(),
      counterparty: input.counterparty.trim(),
      signedAt
    };
  }
}
