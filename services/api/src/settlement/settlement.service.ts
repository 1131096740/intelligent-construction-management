import { Injectable } from "@nestjs/common";
import {
  canCreateSettlementFromContractStatus,
  ContractVersionStatus,
  SettlementStatus
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ConfirmSettlementArchiveDto } from "./dto/confirm-settlement-archive.dto";
import { CreateSettlementDto } from "./dto/create-settlement.dto";
import { ReviewSettlementApprovalDto } from "./dto/review-settlement-approval.dto";
import { UploadSettlementArchiveFileDto } from "./dto/upload-settlement-archive-file.dto";

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma?: PrismaService,
    private readonly audit: AuditService = new AuditService()
  ) {}

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

  async uploadArchiveFile(settlementId: string, input: UploadSettlementArchiveFileDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to upload settlement archive file");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approved_pending_archive") {
        throw new Error(`Cannot upload settlement archive from status ${settlement.status}`);
      }

      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId }
      });

      if (!file) {
        throw new Error("Settlement archive file not found");
      }

      const archiveFile = await tx.settlementArchiveFile.create({
        data: {
          settlementId: settlement.id,
          fileId: input.fileId,
          uploadedByUserId: input.uploadedByUserId,
          status: "pending_confirm"
        }
      });

      await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "pending_archive_confirm" satisfies SettlementStatus }
      });

      await this.audit.record(tx, {
        actorUserId: input.uploadedByUserId,
        action: "settlement.archive.upload",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fileId: input.fileId,
          archiveFileId: archiveFile.id
        }
      });

      return archiveFile;
    });
  }

  async reviewApproval(settlementId: string, input: ReviewSettlementApprovalDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to review settlement approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error(`Cannot review settlement approval from status ${settlement.status}`);
      }

      const nextStatus =
        input.decision === "approve" ? "approved_pending_archive" : "approval_rejected";
      const updated = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: nextStatus satisfies SettlementStatus }
      });

      await this.audit.record(tx, {
        actorUserId: input.reviewedByUserId,
        action:
          input.decision === "approve"
            ? "settlement.approval.approve"
            : "settlement.approval.reject",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fromStatus: settlement.status,
          toStatus: nextStatus
        }
      });

      return updated;
    });
  }

  async confirmArchiveFile(settlementId: string, input: ConfirmSettlementArchiveDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to confirm settlement archive file");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "pending_archive_confirm") {
        throw new Error(`Cannot confirm settlement archive from status ${settlement.status}`);
      }

      const archiveFile = await tx.settlementArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          settlementId: settlement.id
        }
      });

      if (!archiveFile) {
        throw new Error("Settlement archive file not found");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error(`Cannot confirm settlement archive file from status ${archiveFile.status}`);
      }

      const confirmedAt = new Date();
      await tx.settlementArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: input.confirmedByUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      const effectiveSettlement = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "effective" satisfies SettlementStatus }
      });

      await this.audit.record(tx, {
        actorUserId: input.confirmedByUserId,
        action: "settlement.archive.confirm",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          archiveFileId: archiveFile.id
        }
      });

      return effectiveSettlement;
    });
  }
}
