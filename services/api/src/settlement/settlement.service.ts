import { Injectable } from "@nestjs/common";
import {
  canCreateSettlementFromContractStatus,
  ContractVersionStatus
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { CreateSettlementDto } from "./dto/create-settlement.dto";

@Injectable()
export class SettlementService {
  constructor(private readonly prisma?: PrismaService) {}

  assertContractVersionEffective(status: ContractVersionStatus): void {
    if (!canCreateSettlementFromContractStatus(status)) {
      throw new Error("Cannot create settlement from a non-effective contract version");
    }
  }

  async create(input: CreateSettlementDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create settlement");
    }

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: input.contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      this.assertContractVersionEffective(version.status as ContractVersionStatus);

      const [contract, terms] = await Promise.all([
        tx.contract.findUnique({ where: { id: version.contractId } }),
        tx.paymentTermsVersion.findFirst({
          where: {
            contractVersionId: version.id,
            status: "effective"
          },
          orderBy: { versionNo: "desc" }
        })
      ]);

      if (!contract) {
        throw new Error("Contract not found");
      }

      if (!terms) {
        throw new Error("Effective payment terms version not found");
      }

      const currentSettlementStage = await tx.paymentTermsStage.findFirst({
        where: {
          paymentTermsVersionId: terms.id,
          basis: "current_settlement"
        },
        orderBy: { createdAt: "asc" }
      });
      const payableAmountCents = this.calculatePayableAmount(
        input.amountCents,
        currentSettlementStage?.ratioBps ?? null
      );

      return tx.settlement.create({
        data: {
          projectId: contract.projectId,
          contractId: version.contractId,
          contractVersionId: version.id,
          paymentTermsVersionId: terms.id,
          code: input.code,
          periodLabel: input.periodLabel,
          status: "approval_pending",
          amountCents: input.amountCents,
          payableAmountCents,
          paidAmountCents: 0
        }
      });
    });
  }

  private calculatePayableAmount(amountCents: number, ratioBps: number | null): number {
    if (ratioBps === null) {
      return amountCents;
    }

    return Math.floor((amountCents * ratioBps) / 10000);
  }
}
