import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CreateContractDto } from "./dto/create-contract.dto";

@Injectable()
export class ContractService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(input: CreateContractDto) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          projectId: input.projectId,
          code: input.code,
          name: input.name,
          counterparty: input.counterparty
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          amountCents: input.amountCents
        }
      });

      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: input.paymentTermsOriginalText
        }
      });

      await tx.paymentTermsStage.createMany({
        data: input.paymentStages.map((stage) => ({
          paymentTermsVersionId: terms.id,
          name: stage.name,
          basis: stage.basis,
          ratioBps: stage.ratioBps,
          fixedAmountCents: stage.fixedAmountCents,
          triggerEvent: stage.triggerEvent,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice,
          allowsEarlyPayment: stage.allowsEarlyPayment,
          allowsInstallments: stage.allowsInstallments,
          retentionBps: stage.retentionBps,
          originalText: stage.originalText
        }))
      });

      return { contract, version, terms };
    });
  }
}
