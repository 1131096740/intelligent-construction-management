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
type TakeoverReadClient = Pick<
  Prisma.TransactionClient,
  "contract" | "contractVersion"
>;

type ContractTakeoverRecord = {
  id: string;
  contractId: string;
  contractVersionId: string;
  takeoverLevel: string;
  takeoverStatus: string;
  lifecycleStatus: string;
  signedAt: Date;
  historicalSettledCents: bigint | number;
  historicalApprovalPendingPaymentCents: bigint | number;
  historicalApprovedPendingPaymentCents: bigint | number;
  historicalPaidCents: bigint | number;
  historicalProxyPaidCents: bigint | number;
  historicalAdvancePaidCents: bigint | number;
  historicalAdvanceDeductedCents: bigint | number;
  historicalRetentionWithheldCents: bigint | number;
  historicalRetentionReleasedCents: bigint | number;
  otherConfirmedOccupancyCents: bigint | number;
  balanceSourceSummary: string | null;
  evidenceSummary: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  historicalBalanceConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ContractTakeoverBusinessReadModel {
  id: string;
  contractNo: string;
  contractName: string;
  counterparty: string;
  amountCents: string;
  takeoverLevel: string;
  takeoverStatus: string;
  lifecycleStatus: string;
  signedAt: Date;
  historicalSettledCents: string;
  historicalApprovalPendingPaymentCents: string;
  historicalApprovedPendingPaymentCents: string;
  historicalPaidCents: string;
  historicalProxyPaidCents: string;
  historicalAdvancePaidCents: string;
  historicalAdvanceDeductedCents: string;
  historicalRetentionWithheldCents: string;
  historicalRetentionReleasedCents: string;
  otherConfirmedOccupancyCents: string;
  balanceSourceSummary: string | null;
  evidenceSummary: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  historicalBalanceConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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

      return this.toReadModel(takeover, {
        contractNo: data.code,
        contractName: data.name,
        counterparty: data.counterparty,
        amountCents: data.amountCents
      });
    });
  }

  async list(projectId: string) {
    const takeovers = await this.prisma.contractTakeover.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });

    return this.toReadModels(this.prisma, takeovers);
  }

  async detail(projectId: string, takeoverId: string) {
    const takeover = await this.getProjectTakeover(this.prisma, projectId, takeoverId);
    return this.toReadModelFromDatabase(this.prisma, takeover);
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

      return this.toReadModelFromDatabase(tx, updated);
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

      return this.toReadModelFromDatabase(tx, updated);
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

  private async toReadModels(
    client: TakeoverReadClient,
    takeovers: ContractTakeoverRecord[]
  ): Promise<ContractTakeoverBusinessReadModel[]> {
    if (!takeovers.length) {
      return [];
    }

    const contractIds = unique(takeovers.map((takeover) => takeover.contractId));
    const contractVersionIds = unique(takeovers.map((takeover) => takeover.contractVersionId));
    const [contracts, versions] = await Promise.all([
      client.contract.findMany({
        where: { id: { in: contractIds } },
        select: { id: true, code: true, temporaryCode: true, name: true, counterparty: true }
      }),
      client.contractVersion.findMany({
        where: { id: { in: contractVersionIds } },
        select: { id: true, amountCents: true }
      })
    ]);

    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const versionById = new Map(versions.map((version) => [version.id, version]));

    return takeovers.map((takeover) =>
      this.toReadModel(takeover, {
        contractNo:
          contractById.get(takeover.contractId)?.code ??
          contractById.get(takeover.contractId)?.temporaryCode ??
          takeover.id,
        contractName: contractById.get(takeover.contractId)?.name ?? "未读取合同名称",
        counterparty: contractById.get(takeover.contractId)?.counterparty ?? "未读取相对方",
        amountCents: versionById.get(takeover.contractVersionId)?.amountCents ?? 0
      })
    );
  }

  private async toReadModelFromDatabase(
    client: TakeoverReadClient,
    takeover: ContractTakeoverRecord
  ) {
    const [readModel] = await this.toReadModels(client, [takeover]);
    return readModel;
  }

  private toReadModel(
    takeover: ContractTakeoverRecord,
    contract: {
      contractNo: string;
      contractName: string;
      counterparty: string;
      amountCents: bigint | number;
    }
  ): ContractTakeoverBusinessReadModel {
    return {
      id: takeover.id,
      contractNo: contract.contractNo,
      contractName: contract.contractName,
      counterparty: contract.counterparty,
      amountCents: moneyString(contract.amountCents),
      takeoverLevel: takeover.takeoverLevel,
      takeoverStatus: takeover.takeoverStatus,
      lifecycleStatus: takeover.lifecycleStatus,
      signedAt: takeover.signedAt,
      historicalSettledCents: moneyString(takeover.historicalSettledCents),
      historicalApprovalPendingPaymentCents: moneyString(
        takeover.historicalApprovalPendingPaymentCents
      ),
      historicalApprovedPendingPaymentCents: moneyString(
        takeover.historicalApprovedPendingPaymentCents
      ),
      historicalPaidCents: moneyString(takeover.historicalPaidCents),
      historicalProxyPaidCents: moneyString(takeover.historicalProxyPaidCents),
      historicalAdvancePaidCents: moneyString(takeover.historicalAdvancePaidCents),
      historicalAdvanceDeductedCents: moneyString(takeover.historicalAdvanceDeductedCents),
      historicalRetentionWithheldCents: moneyString(takeover.historicalRetentionWithheldCents),
      historicalRetentionReleasedCents: moneyString(takeover.historicalRetentionReleasedCents),
      otherConfirmedOccupancyCents: moneyString(takeover.otherConfirmedOccupancyCents),
      balanceSourceSummary: takeover.balanceSourceSummary,
      evidenceSummary: takeover.evidenceSummary,
      submittedAt: takeover.submittedAt,
      confirmedAt: takeover.confirmedAt,
      historicalBalanceConfirmedAt: takeover.historicalBalanceConfirmedAt,
      createdAt: takeover.createdAt,
      updatedAt: takeover.updatedAt
    };
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

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function moneyString(value: bigint | number): string {
  return (typeof value === "bigint" ? value : BigInt(value)).toString();
}
