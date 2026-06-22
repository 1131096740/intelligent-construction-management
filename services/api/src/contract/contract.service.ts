import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { CreateContractDto } from "./dto/create-contract.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";

@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService()
  ) {}

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

  async uploadArchiveFile(contractVersionId: string, input: UploadContractArchiveFileDto) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "seal_approved_pending_archive") {
        throw new Error(`Cannot upload contract archive from status ${version.status}`);
      }

      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId }
      });

      if (!file) {
        throw new Error("Contract archive file not found");
      }

      const archiveFile = await tx.contractArchiveFile.create({
        data: {
          contractVersionId: version.id,
          fileId: input.fileId,
          uploadedByUserId: input.uploadedByUserId,
          status: "pending_confirm"
        }
      });

      await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: "pending_archive_confirm" }
      });

      await this.audit.record(tx, {
        actorUserId: input.uploadedByUserId,
        action: "contract.archive.upload",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fileId: input.fileId,
          archiveFileId: archiveFile.id
        }
      });

      return archiveFile;
    });
  }

  async confirmArchiveFile(contractVersionId: string, input: ConfirmContractArchiveDto) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "pending_archive_confirm") {
        throw new Error(`Cannot confirm contract archive from status ${version.status}`);
      }

      const archiveFile = await tx.contractArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          contractVersionId: version.id
        }
      });

      if (!archiveFile) {
        throw new Error("Contract archive file not found");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error(`Cannot confirm contract archive file from status ${archiveFile.status}`);
      }

      const confirmedAt = new Date();
      await tx.contractArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: input.confirmedByUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      const effectiveVersion = await tx.contractVersion.update({
        where: { id: version.id },
        data: {
          status: "effective",
          effectiveAt: confirmedAt
        }
      });

      await tx.paymentTermsVersion.updateMany({
        where: { contractVersionId: version.id },
        data: { status: "effective" }
      });

      await this.audit.record(tx, {
        actorUserId: input.confirmedByUserId,
        action: "contract.archive.confirm",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          archiveFileId: archiveFile.id
        }
      });

      return effectiveVersion;
    });
  }
}
