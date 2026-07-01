import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ContractBillDefinition,
  ContractClauseDefinition,
  ContractFieldDefinition
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ContractReadinessService } from "./contract-readiness.service";
import { centsToSafeNumber } from "../money/decimal-money";
import type {
  ApplyContractTypeChangeDto,
  CreateDraftCheckpointDto,
  PreviewContractTypeChangeDto,
  SaveContractDraftDto,
  TransferContractDraftDto,
  VoidDraftDto
} from "./dto/contract-workbench.dto";

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);
const PRICING_NATURES = new Set([
  "fixed_total",
  "provisional_total",
  "unit_price",
  "framework"
]);
const AMOUNT_SOURCES = new Set(["bill_sum", "manual"]);
const CHECKPOINT_RETRY_LIMIT = 3;

interface TemplateSnapshot {
  fieldSchema: ContractFieldDefinition[];
  billSchema: ContractBillDefinition[];
  clauseSchema: ContractClauseDefinition[];
  attachmentSchema: unknown[];
  validationSchema: unknown[];
}

interface BillSnapshot {
  billKey: string;
  name: string;
  amountRole: string;
  pricingMode: string;
  quantityScale: number;
  unitPriceScale: number;
  schemaSnapshot: unknown;
  sourceExcelFileId: string | null;
  revision: number;
  taxInclusiveAmountCents: string;
  taxExclusiveAmountCents: string;
  taxAmountCents: string;
  rows: Array<{
    rowKey: string;
    sortOrder: number;
    itemCode: string | null;
    itemName: string;
    specification: string | null;
    unit: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    taxRatePercent?: string;
    taxInclusiveAmountCents: string;
    taxExclusiveAmountCents: string;
    taxAmountCents: string;
    isProvisional: boolean;
    settlementBasis: string | null;
    customData: unknown;
  }>;
}

interface CheckpointSnapshot {
  draftData: Record<string, unknown>;
  clauseSnapshot: ContractClauseDefinition[];
  pricingNature: string;
  amountSource: string;
  amountCents: string;
  amountAdjustmentReason: string | null;
  layoutTemplateVersionId: string | null;
  bills: BillSnapshot[];
}

@Injectable()
export class ContractWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly readiness?: ContractReadinessService
  ) {}

  checkReadiness(contractVersionId: string, actorUserId: string) {
    if (!this.readiness) throw new Error("Contract readiness service is required");
    return this.readiness.checkAndStore(contractVersionId, actorUserId);
  }

  async listDrafts(actorUserId: string, scope: "my" | "voided") {
    if (scope !== "my" && scope !== "voided") {
      throw new BadRequestException("Invalid contract workbench scope");
    }
    const isDirector = await this.hasGlobalContractDirector(this.prisma, actorUserId);
    const versions = await this.prisma.contractVersion.findMany({
      where: { status: { in: [...EDITABLE_STATUSES] } },
      select: { contractId: true }
    });
    return this.toReadModel(await this.prisma.contract.findMany({
      where: {
        id: { in: [...new Set(versions.map((version) => version.contractId))] },
        voidedAt: scope === "voided" ? { not: null } : null,
        ...(isDirector ? {} : { ownerUserId: actorUserId })
      },
      orderBy: { updatedAt: "desc" }
    }));
  }

  async getDraft(contractId: string, actorUserId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException("Contract draft not found");
    await this.assertCanView(this.prisma, contract.ownerUserId, actorUserId);

    const version = await this.prisma.contractVersion.findFirst({
      where: { contractId, status: { in: [...EDITABLE_STATUSES] } },
      orderBy: { versionNo: "desc" }
    });
    if (!version) throw new NotFoundException("Contract draft version not found");

    const [bills, checkpoints, parties, documents] = await Promise.all([
      this.prisma.contractBill.findMany({ where: { contractVersionId: version.id } }),
      this.prisma.contractDraftCheckpoint.findMany({
        where: { contractVersionId: version.id },
        orderBy: { sequenceNo: "desc" },
        select: {
          id: true,
          sequenceNo: true,
          name: true,
          snapshot: true,
          createdAt: true
        }
      }),
      this.prisma.contractPartySnapshot.findMany({
        where: { contractVersionId: version.id },
        orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
      }),
      this.prisma.contractGeneratedDocument.findMany({
        where: { contractVersionId: version.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          purpose: true,
          status: true,
          sourceRevision: true,
          docxFileId: true,
          pdfFileId: true,
          createdAt: true,
          completedAt: true
        }
      })
    ]);
    const rows = bills.length
      ? await this.prisma.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
        })
      : [];
    return this.toReadModel({
      contract,
      version,
      readiness: this.readinessFromSnapshot(version.readinessSnapshot),
      bills: bills.map((bill) => ({
        ...bill,
        rows: rows
          .filter((row) => row.contractBillId === bill.id)
          .map((row) => ({
            ...row,
            unitPrice: this.formatUnitPrice(row.unitPrice),
            taxRatePercent: row.taxRate.toString()
          }))
      })),
      checkpoints,
      parties,
      documents
    });
  }

  async saveDraft(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseSaveInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertRevision(version.draftRevision, input.expectedRevision);

      const template = this.parseTemplateSnapshot(version.templateSnapshot);
      this.validateDraftAgainstTemplate(input.draftData, input.clauses, template);
      const bills = await tx.contractBill.findMany({
        where: { contractVersionId }
      });
      const billAmount = this.sumIncludedBills(bills);
      const amountCents =
        input.amountSource === "bill_sum"
          ? billAmount
          : this.toCents(input.manualAmountCents, "manualAmountCents");
      if (
        input.amountSource === "manual" &&
        amountCents !== billAmount &&
        !input.amountAdjustmentReason?.trim()
      ) {
        throw new BadRequestException(
          "amountAdjustmentReason is required when manual amount differs from bill sum"
        );
      }

      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          draftRevision: input.expectedRevision,
          status: { in: [...EDITABLE_STATUSES] }
        },
        data: {
          draftData: this.toJson(input.draftData),
          clauseSnapshot: this.toJson(input.clauses),
          pricingNature: input.pricingNature,
          amountSource: input.amountSource,
          amountCents,
          amountAdjustmentReason: input.amountAdjustmentReason?.trim() || null,
          layoutTemplateVersionId: input.layoutTemplateVersionId ?? null,
          draftRevision: { increment: 1 }
        }
      });
      this.assertCas(updated.count);
      await this.markOlderSuccessfulDocumentsStale(
        tx,
        contractVersionId,
        input.expectedRevision + 1
      );
      await this.assertEditableParentCas(tx, version.contractId, actorUserId);

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.save",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          changedKeys: this.changedKeys(
            version.draftData as Record<string, unknown>,
            input.draftData
          ),
          amountBeforeCents: version.amountCents.toString(),
          amountAfterCents: amountCents.toString(),
          revisionBefore: input.expectedRevision,
          revisionAfter: input.expectedRevision + 1
        }
      });
      return this.toReadModel(
        await tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      );
    });
  }

  async createCheckpoint(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseCheckpointInput(rawInput);
    return this.runSerializableWithRetry(async (tx) => {
      const { version } = await this.loadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      const existing = await tx.contractDraftCheckpoint.findMany({
        where: { contractVersionId },
        orderBy: { sequenceNo: "desc" }
      });
      const bills = await this.loadBillSnapshots(tx, contractVersionId);
      const sequenceNo = Math.max(0, ...existing.map((row) => row.sequenceNo)) + 1;
      const checkpoint = await tx.contractDraftCheckpoint.create({
        data: {
          contractVersionId,
          sequenceNo,
          name: input.name?.trim() || null,
          snapshot: this.toJson({
            draftData: version.draftData,
            clauseSnapshot: version.clauseSnapshot,
            pricingNature: version.pricingNature,
            amountSource: version.amountSource,
            amountCents: version.amountCents.toString(),
            amountAdjustmentReason: version.amountAdjustmentReason,
            layoutTemplateVersionId: version.layoutTemplateVersionId,
            bills
          }),
          createdByUserId: actorUserId
        }
      });
      const obsolete = existing
        .map((row) => row.sequenceNo)
        .sort((a, b) => b - a)
        .slice(4);
      if (obsolete.length) {
        await tx.contractDraftCheckpoint.deleteMany({
          where: { contractVersionId, sequenceNo: { in: obsolete } }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.checkpoint.create",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { checkpointId: checkpoint.id, sequenceNo }
      });
      return this.toReadModel(checkpoint);
    });
  }

  async restoreCheckpoint(
    contractVersionId: string,
    checkpointId: string,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      const checkpoint = await tx.contractDraftCheckpoint.findUnique({
        where: { id: checkpointId }
      });
      if (!checkpoint || checkpoint.contractVersionId !== contractVersionId) {
        throw new NotFoundException("Contract draft checkpoint not found");
      }
      const snapshot = this.parseCheckpoint(checkpoint.snapshot);
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          draftRevision: version.draftRevision,
          status: { in: [...EDITABLE_STATUSES] }
        },
        data: {
          draftData: this.toJson(snapshot.draftData),
          clauseSnapshot: this.toJson(snapshot.clauseSnapshot),
          pricingNature: snapshot.pricingNature,
          amountSource: snapshot.amountSource,
          amountCents: BigInt(snapshot.amountCents),
          amountAdjustmentReason: snapshot.amountAdjustmentReason,
          layoutTemplateVersionId: snapshot.layoutTemplateVersionId,
          draftRevision: { increment: 1 }
        }
      });
      this.assertCas(updated.count);
      await this.markOlderSuccessfulDocumentsStale(
        tx,
        contractVersionId,
        version.draftRevision + 1
      );
      await this.assertEditableParentCas(tx, version.contractId, actorUserId);
      await this.replaceBillsFromSnapshot(tx, contractVersionId, snapshot.bills);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.checkpoint.restore",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          checkpointId,
          revisionBefore: version.draftRevision,
          revisionAfter: version.draftRevision + 1
        }
      });
      return this.toReadModel(
        await tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      );
    });
  }

  async voidDraft(contractId: string, actorUserId: string, rawInput: unknown) {
    const { reason } = this.parseVoidInput(rawInput);
    return this.runSerializableWithRetry(async (tx) => {
      await this.loadOwnedContract(tx, contractId, actorUserId);
      await this.assertEditableVersionGate(tx, contractId);
      const updated = await tx.contract.updateMany({
        where: { id: contractId, ownerUserId: actorUserId, voidedAt: null },
        data: { voidedAt: new Date(), voidedReason: reason }
      });
      this.assertLifecycleCas(updated.count);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.void",
        businessType: "contract",
        businessId: contractId,
        metadata: { reason }
      });
      return this.toReadModel(await tx.contract.findUnique({ where: { id: contractId } }));
    });
  }

  async restoreDraft(contractId: string, actorUserId: string) {
    return this.runSerializableWithRetry(async (tx) => {
      await this.loadOwnedContract(tx, contractId, actorUserId);
      await this.assertEditableVersionGate(tx, contractId);
      const updated = await tx.contract.updateMany({
        where: { id: contractId, ownerUserId: actorUserId, voidedAt: { not: null } },
        data: { voidedAt: null, voidedReason: null }
      });
      this.assertLifecycleCas(updated.count);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.restore",
        businessType: "contract",
        businessId: contractId
      });
      return this.toReadModel(await tx.contract.findUnique({ where: { id: contractId } }));
    });
  }

  async transferDraft(
    contractId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseTransferInput(rawInput);
    return this.runSerializableWithRetry(async (tx) => {
      await this.assertGlobalContractDirector(tx, actorUserId);
      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract) throw new NotFoundException("Contract draft not found");
      await this.assertEditableVersionGate(tx, contractId);
      const targetUser = await tx.user.findUnique({ where: { id: input.toUserId } });
      if (!targetUser?.isActive) {
        throw new BadRequestException("Transfer target user must exist and be active");
      }
      const updated = await tx.contract.updateMany({
        where: {
          id: contractId,
          ownerUserId: contract.ownerUserId,
          voidedAt: null
        },
        data: { ownerUserId: input.toUserId }
      });
      this.assertLifecycleCas(updated.count);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.transfer",
        businessType: "contract",
        businessId: contractId,
        metadata: {
          fromOwnerUserId: contract.ownerUserId,
          toUserId: input.toUserId
        }
      });
      return this.toReadModel(await tx.contract.findUnique({ where: { id: contractId } }));
    });
  }

  async previewTypeChange(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseTypeChangeInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertRevision(version.draftRevision, input.expectedRevision);
      const target = await this.loadPublishedTemplate(
        tx,
        input.targetBusinessTemplateVersionId
      );
      return this.buildTypeChangePreview(
        this.parseTemplateSnapshot(version.templateSnapshot),
        this.versionToTemplate(target)
      );
    });
  }

  async applyTypeChange(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseApplyTypeChangeInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.loadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertRevision(version.draftRevision, input.expectedRevision);
      const target = await this.loadPublishedTemplate(
        tx,
        input.targetBusinessTemplateVersionId
      );
      const targetTemplate = this.versionToTemplate(target);
      const currentTemplate = this.parseTemplateSnapshot(version.templateSnapshot);
      const currentData = version.draftData as Record<string, unknown>;
      const oldFields = new Map(currentTemplate.fieldSchema.map((field) => [field.key, field]));
      const targetFields = new Map(
        targetTemplate.fieldSchema.map((field) => [field.key, field])
      );
      const nextData = Object.fromEntries(
        targetTemplate.fieldSchema.map((field) => {
          const old = oldFields.get(field.key);
          return [
            field.key,
            old?.type === field.type && Object.hasOwn(currentData, field.key)
              ? currentData[field.key]
              : field.defaultValue ?? null
          ];
        })
      );
      const removedFields = Object.fromEntries(
        Object.entries(currentData).filter(([key]) => {
          const oldField = oldFields.get(key);
          const targetField = targetFields.get(key);
          return !targetField || !oldField || oldField.type !== targetField.type;
        })
      );
      const currentClauses = version.clauseSnapshot as unknown as ContractClauseDefinition[];
      const currentClauseMap = new Map(currentClauses.map((clause) => [clause.key, clause]));
      const targetClauseMap = new Map(
        targetTemplate.clauseSchema.map((clause) => [clause.key, clause])
      );
      const nextClauses = targetTemplate.clauseSchema.map((targetClause) => {
        const currentClause = currentClauseMap.get(targetClause.key);
        return currentClause && this.clauseIsCompatible(currentClause, targetClause)
          ? { ...targetClause, content: currentClause.content }
          : targetClause;
      });
      const removedClauses = currentClauses.filter((currentClause) => {
        const targetClause = targetClauseMap.get(currentClause.key);
        return !targetClause || !this.clauseIsCompatible(currentClause, targetClause);
      });
      const currentBills = await tx.contractBill.findMany({
        where: { contractVersionId }
      });
      const targetBills = new Map(targetTemplate.billSchema.map((bill) => [bill.key, bill]));
      const replacedBills = currentBills.filter((bill) => {
          const targetBill = targetBills.get(bill.billKey);
          return !targetBill || !this.billIsCompatible(bill, targetBill);
        });
      const replacedBillIds = replacedBills.map((bill) => bill.id);
      const replacedBillRows = replacedBillIds.length
        ? await tx.contractBillRow.findMany({
            where: { contractBillId: { in: replacedBillIds } },
            orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
          })
        : [];
      const removedBills = replacedBills.map((bill) => ({
        ...bill,
        taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
        taxExclusiveAmountCents: bill.taxExclusiveAmountCents.toString(),
        taxAmountCents: bill.taxAmountCents.toString(),
        rows: replacedBillRows
          .filter((row) => row.contractBillId === bill.id)
          .map((row) => ({
            ...row,
            quantity: row.quantity.toString(),
            unitPrice: this.formatUnitPrice(row.unitPrice),
            taxRate: row.taxRate.toString(),
            taxRatePercent: row.taxRate.toString(),
            taxInclusiveAmountCents: row.taxInclusiveAmountCents.toString(),
            taxExclusiveAmountCents: row.taxExclusiveAmountCents.toString(),
            taxAmountCents: row.taxAmountCents.toString()
          }))
      }));
      const retainedKeys = new Set(
        currentBills
          .filter((bill) => {
            const targetBill = targetBills.get(bill.billKey);
            return targetBill && this.billIsCompatible(bill, targetBill);
          })
          .map((bill) => bill.billKey)
      );
      const addedBills = targetTemplate.billSchema.filter(
        (bill) => !retainedKeys.has(bill.key)
      );

      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          draftRevision: input.expectedRevision,
          status: { in: [...EDITABLE_STATUSES] }
        },
        data: {
          businessTemplateVersionId: target.id,
          templateSnapshot: this.toJson(targetTemplate),
          draftData: this.toJson(nextData),
          clauseSnapshot: this.toJson(nextClauses),
          draftRevision: { increment: 1 }
        }
      });
      this.assertCas(updated.count);
      await this.markOlderSuccessfulDocumentsStale(
        tx,
        contractVersionId,
        input.expectedRevision + 1
      );
      await this.assertEditableParentCas(tx, contract.id, actorUserId);

      const template = await tx.contractBusinessTemplate.findUnique({
        where: { id: target.templateId }
      });
      if (!template) throw new NotFoundException("Business template not found");
      await tx.contract.update({
        where: { id: contract.id },
        data: { contractTypeKey: template.contractTypeKey }
      });
      if (replacedBillIds.length) {
        await tx.contractBillRow.deleteMany({
          where: { contractBillId: { in: replacedBillIds } }
        });
        await tx.contractBill.deleteMany({ where: { id: { in: replacedBillIds } } });
      }
      for (const bill of targetTemplate.billSchema.filter((row) =>
        retainedKeys.has(row.key)
      )) {
        await tx.contractBill.updateMany({
          where: { contractVersionId, billKey: bill.key },
          data: this.billDefinitionData(bill)
        });
      }
      if (addedBills.length) {
        await tx.contractBill.createMany({
          data: addedBills.map((bill) => ({
            contractVersionId,
            billKey: bill.key,
            ...this.billDefinitionData(bill)
          }))
        });
      }
      if (version.amountSource === "bill_sum") {
        const finalBills = await tx.contractBill.findMany({
          where: { contractVersionId }
        });
        await tx.contractVersion.update({
          where: { id: contractVersionId },
          data: { amountCents: this.sumIncludedBills(finalBills) }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.type_change",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          fromBusinessTemplateVersionId: version.businessTemplateVersionId,
          toBusinessTemplateVersionId: target.id,
          fromContractTypeKey: contract.contractTypeKey,
          toContractTypeKey: template.contractTypeKey,
          removedSnapshot: this.toJson({
            fields: removedFields,
            clauses: removedClauses,
            bills: removedBills
          }),
          revisionBefore: input.expectedRevision,
          revisionAfter: input.expectedRevision + 1
        }
      });
      return this.toReadModel(
        await tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      );
    });
  }

  private async loadOwnedEditableVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) throw new NotFoundException("Contract draft version not found");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("Contract draft not found");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Only the contract draft owner may edit");
    }
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new BadRequestException("Contract draft is not editable");
    }
    if (contract.voidedAt) throw new BadRequestException("Contract draft is voided");
    return { version, contract };
  }

  private async loadOwnedContract(
    tx: Prisma.TransactionClient,
    contractId: string,
    actorUserId: string
  ) {
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException("Contract draft not found");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Only the contract draft owner may edit");
    }
    return contract;
  }

  private async assertEditableVersionGate(
    tx: Prisma.TransactionClient,
    contractId: string
  ) {
    const editableVersions = await tx.contractVersion.updateMany({
      where: { contractId, status: { in: [...EDITABLE_STATUSES] } },
      data: { draftRevision: { increment: 0 } }
    });
    if (editableVersions.count === 0) {
      throw new BadRequestException("Contract has no editable draft version");
    }
  }

  private async assertEditableParentCas(
    tx: Prisma.TransactionClient,
    contractId: string,
    actorUserId: string
  ) {
    const parent = await tx.contract.updateMany({
      where: {
        id: contractId,
        ownerUserId: actorUserId,
        voidedAt: null
      },
      data: { ownerUserId: actorUserId }
    });
    if (parent.count !== 1) {
      throw new BadRequestException("Contract draft revision/status conflict");
    }
  }

  private markOlderSuccessfulDocumentsStale(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    currentRevision: number
  ) {
    return tx.contractGeneratedDocument.updateMany({
      where: {
        contractVersionId,
        status: "success",
        sourceRevision: { lt: currentRevision }
      },
      data: { status: "stale" }
    });
  }

  private async assertCanView(
    client: PrismaService,
    ownerUserId: string | null,
    actorUserId: string
  ) {
    if (
      ownerUserId !== actorUserId &&
      !(await this.hasGlobalContractDirector(client, actorUserId))
    ) {
      throw new ForbiddenException("Contract draft is not visible to this user");
    }
  }

  private async hasGlobalContractDirector(
    client: Pick<PrismaService, "userPosition" | "position">,
    actorUserId: string
  ) {
    const userPositions = await client.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    if (!userPositions.length) return false;
    const positions = await client.position.findMany({
      where: { id: { in: userPositions.map((row) => row.positionId) } }
    });
    return positions.some((position) => position.key === "contract_director");
  }

  private async assertGlobalContractDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    if (!(await this.hasGlobalContractDirector(tx, actorUserId))) {
      throw new ForbiddenException("Requires global role: contract_director");
    }
  }

  private parseSaveInput(rawInput: unknown): SaveContractDraftDto {
    const input = this.requireObject(rawInput, "Save contract draft body");
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new BadRequestException("expectedRevision must be a positive integer");
    }
    if (!this.isPlainObject(input.draftData)) {
      throw new BadRequestException("draftData must be an object");
    }
    if (!Array.isArray(input.clauses)) {
      throw new BadRequestException("clauses must be an array");
    }
    const clauses = input.clauses.map((clause, index) =>
      this.parseClause(clause, index)
    );
    if (
      typeof input.pricingNature !== "string" ||
      !PRICING_NATURES.has(input.pricingNature)
    ) {
      throw new BadRequestException("Invalid pricingNature");
    }
    if (
      typeof input.amountSource !== "string" ||
      !AMOUNT_SOURCES.has(input.amountSource)
    ) {
      throw new BadRequestException("Invalid amountSource");
    }
    if (input.amountSource === "manual" || input.manualAmountCents !== undefined) {
      this.toCents(input.manualAmountCents as number | undefined, "manualAmountCents");
    }
    if (
      input.amountAdjustmentReason !== undefined &&
      typeof input.amountAdjustmentReason !== "string"
    ) {
      throw new BadRequestException("amountAdjustmentReason must be a string");
    }
    if (
      input.layoutTemplateVersionId !== undefined &&
      (typeof input.layoutTemplateVersionId !== "string" ||
        !input.layoutTemplateVersionId.trim())
    ) {
      throw new BadRequestException("layoutTemplateVersionId must be a non-empty string");
    }
    return {
      expectedRevision: input.expectedRevision as number,
      draftData: { ...(input.draftData as Record<string, unknown>) },
      clauses,
      pricingNature: input.pricingNature as SaveContractDraftDto["pricingNature"],
      amountSource: input.amountSource as SaveContractDraftDto["amountSource"],
      ...(input.manualAmountCents === undefined
        ? {}
        : { manualAmountCents: input.manualAmountCents as number }),
      ...(input.amountAdjustmentReason === undefined
        ? {}
        : { amountAdjustmentReason: input.amountAdjustmentReason }),
      ...(input.layoutTemplateVersionId === undefined
        ? {}
        : { layoutTemplateVersionId: input.layoutTemplateVersionId })
    };
  }

  private parseTypeChangeInput(rawInput: unknown): PreviewContractTypeChangeDto {
    const input = this.requireObject(rawInput, "Contract type change body");
    if (
      typeof input.targetBusinessTemplateVersionId !== "string" ||
      !input.targetBusinessTemplateVersionId.trim()
    ) {
      throw new BadRequestException("targetBusinessTemplateVersionId is required");
    }
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new BadRequestException("expectedRevision must be a positive integer");
    }
    return {
      targetBusinessTemplateVersionId: input.targetBusinessTemplateVersionId,
      expectedRevision: input.expectedRevision as number
    };
  }

  private parseApplyTypeChangeInput(rawInput: unknown): ApplyContractTypeChangeDto {
    const input = this.requireObject(rawInput, "Apply contract type change body");
    const parsed = this.parseTypeChangeInput(input);
    if (input.confirmed !== true) {
      throw new BadRequestException("Contract type change confirmation is required");
    }
    return { ...parsed, confirmed: true };
  }

  private parseCheckpointInput(rawInput: unknown): CreateDraftCheckpointDto {
    const input = this.requireObject(rawInput, "Checkpoint body");
    if (input.name !== undefined && typeof input.name !== "string") {
      throw new BadRequestException("Checkpoint name must be a string");
    }
    return input.name === undefined ? {} : { name: input.name };
  }

  private parseVoidInput(rawInput: unknown): VoidDraftDto {
    const input = this.requireObject(rawInput, "Void draft body");
    if (typeof input.reason !== "string" || !input.reason.trim()) {
      throw new BadRequestException("Void reason is required");
    }
    return { reason: input.reason.trim() };
  }

  private parseTransferInput(rawInput: unknown): TransferContractDraftDto {
    const input = this.requireObject(rawInput, "Transfer draft body");
    if (typeof input.toUserId !== "string" || !input.toUserId.trim()) {
      throw new BadRequestException("toUserId is required");
    }
    return { toUserId: input.toUserId.trim() };
  }

  private parseClause(value: unknown, index: number): ContractClauseDefinition {
    const clause = this.requireObject(value, `clauses[${index}]`);
    if (
      typeof clause.key !== "string" ||
      !clause.key ||
      typeof clause.title !== "string" ||
      !clause.title ||
      (clause.numberingMode !== "automatic" && clause.numberingMode !== "fixed") ||
      !Object.hasOwn(clause, "content")
    ) {
      throw new BadRequestException(`Invalid clauses[${index}]`);
    }
    if (clause.required !== undefined && typeof clause.required !== "boolean") {
      throw new BadRequestException(`Invalid clauses[${index}].required`);
    }
    if (
      clause.standardClauseVersionId !== undefined &&
      typeof clause.standardClauseVersionId !== "string"
    ) {
      throw new BadRequestException(
        `Invalid clauses[${index}].standardClauseVersionId`
      );
    }
    return {
      key: clause.key,
      title: clause.title,
      numberingMode: clause.numberingMode,
      content: clause.content,
      ...(clause.required === undefined ? {} : { required: clause.required }),
      ...(clause.standardClauseVersionId === undefined
        ? {}
        : { standardClauseVersionId: clause.standardClauseVersionId })
    };
  }

  private requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!this.isPlainObject(value)) {
      throw new BadRequestException(`${label} must be an object`);
    }
    return value;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private validateDraftAgainstTemplate(
    draftData: Record<string, unknown>,
    clauses: ContractClauseDefinition[],
    template: TemplateSnapshot
  ) {
    const fieldKeys = new Set(template.fieldSchema.map((field) => field.key));
    const invalidField = Object.keys(draftData).find((key) => !fieldKeys.has(key));
    if (invalidField) throw new BadRequestException(`Unknown contract field: ${invalidField}`);
    const clauseKeys = new Set(template.clauseSchema.map((clause) => clause.key));
    const seen = new Set<string>();
    for (const clause of clauses) {
      if (!clause || typeof clause.key !== "string" || !clauseKeys.has(clause.key)) {
        throw new BadRequestException(`Unknown contract clause: ${clause?.key ?? ""}`);
      }
      if (seen.has(clause.key)) {
        throw new BadRequestException(`Duplicate contract clause: ${clause.key}`);
      }
      seen.add(clause.key);
    }
  }

  private parseTemplateSnapshot(value: Prisma.JsonValue): TemplateSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Invalid contract template snapshot");
    }
    const snapshot = value as Record<string, unknown>;
    if (
      !Array.isArray(snapshot.fieldSchema) ||
      !Array.isArray(snapshot.billSchema) ||
      !Array.isArray(snapshot.clauseSchema)
    ) {
      throw new BadRequestException("Invalid contract template snapshot");
    }
    return snapshot as unknown as TemplateSnapshot;
  }

  private versionToTemplate(version: {
    fieldSchema: Prisma.JsonValue;
    billSchema: Prisma.JsonValue;
    clauseSchema: Prisma.JsonValue;
    attachmentSchema: Prisma.JsonValue;
    validationSchema: Prisma.JsonValue;
  }): TemplateSnapshot {
    return {
      fieldSchema: version.fieldSchema as unknown as ContractFieldDefinition[],
      billSchema: version.billSchema as unknown as ContractBillDefinition[],
      clauseSchema: version.clauseSchema as unknown as ContractClauseDefinition[],
      attachmentSchema: version.attachmentSchema as unknown[],
      validationSchema: version.validationSchema as unknown[]
    };
  }

  private async loadPublishedTemplate(
    tx: Prisma.TransactionClient,
    versionId: string
  ) {
    const target = await tx.contractBusinessTemplateVersion.findUnique({
      where: { id: versionId }
    });
    if (!target) throw new NotFoundException("Business template version not found");
    if (target.status !== "published") {
      throw new BadRequestException("Target business template version is not published");
    }
    return target;
  }

  private buildTypeChangePreview(current: TemplateSnapshot, target: TemplateSnapshot) {
    const currentFields = new Map(current.fieldSchema.map((field) => [field.key, field]));
    const targetFields = new Map(target.fieldSchema.map((field) => [field.key, field]));
    const currentBills = new Map(current.billSchema.map((bill) => [bill.key, bill]));
    const targetBills = new Map(target.billSchema.map((bill) => [bill.key, bill]));
    return {
      retainedFields: target.fieldSchema
        .filter((field) => currentFields.get(field.key)?.type === field.type)
        .map((field) => field.key),
      removedFields: current.fieldSchema
        .filter((field) => targetFields.get(field.key)?.type !== field.type)
        .map((field) => field.key),
      addedFields: target.fieldSchema
        .filter((field) => currentFields.get(field.key)?.type !== field.type)
        .map((field) => field.key),
      addedDefaults: Object.fromEntries(
        target.fieldSchema
          .filter((field) => currentFields.get(field.key)?.type !== field.type)
          .map((field) => [field.key, field.defaultValue ?? null])
      ),
      removedBills: current.billSchema
        .filter((bill) => {
          const targetBill = targetBills.get(bill.key);
          return !targetBill || !this.billIsCompatible(bill, targetBill);
        })
        .map((bill) => bill.key),
      addedBills: target.billSchema
        .filter((bill) => {
          const currentBill = currentBills.get(bill.key);
          return !currentBill || !this.billIsCompatible(currentBill, bill);
        })
        .map((bill) => bill.key)
    };
  }

  private billIsCompatible(
    current: {
      pricingMode: string;
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot?: Prisma.JsonValue;
      columns?: unknown[];
    },
    target: ContractBillDefinition
  ) {
    const currentColumns =
      current.columns ??
      ((current.schemaSnapshot &&
      typeof current.schemaSnapshot === "object" &&
      !Array.isArray(current.schemaSnapshot)
        ? (current.schemaSnapshot as { columns?: unknown[] }).columns
        : []) ??
        []);
    return (
      current.pricingMode === target.pricingMode &&
      current.quantityScale === target.quantityScale &&
      current.unitPriceScale === target.unitPriceScale &&
      JSON.stringify(currentColumns) === JSON.stringify(target.columns)
    );
  }

  private clauseIsCompatible(
    current: ContractClauseDefinition,
    target: ContractClauseDefinition
  ) {
    return (
      current.key === target.key &&
      current.numberingMode === target.numberingMode &&
      current.standardClauseVersionId === target.standardClauseVersionId
    );
  }

  private billDefinitionData(bill: ContractBillDefinition) {
    return {
      name: bill.name,
      amountRole: bill.amountRole,
      pricingMode: bill.pricingMode,
      quantityScale: bill.quantityScale,
      unitPriceScale: bill.unitPriceScale,
      schemaSnapshot: this.toJson({ columns: bill.columns })
    };
  }

  private sumIncludedBills(
    bills: Array<{ amountRole: string; taxInclusiveAmountCents: bigint }>
  ) {
    return bills
      .filter((bill) => bill.amountRole === "included" || bill.amountRole === "provisional")
      .reduce((sum, bill) => sum + bill.taxInclusiveAmountCents, 0n);
  }

  private async loadBillSnapshots(
    tx: Prisma.TransactionClient,
    contractVersionId: string
  ): Promise<BillSnapshot[]> {
    const bills = await tx.contractBill.findMany({ where: { contractVersionId } });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
        })
      : [];
    return bills.map((bill) => ({
      billKey: bill.billKey,
      name: bill.name,
      amountRole: bill.amountRole,
      pricingMode: bill.pricingMode,
      quantityScale: bill.quantityScale,
      unitPriceScale: bill.unitPriceScale,
      schemaSnapshot: bill.schemaSnapshot,
      sourceExcelFileId: bill.sourceExcelFileId,
      revision: bill.revision,
      taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
      taxExclusiveAmountCents: bill.taxExclusiveAmountCents.toString(),
      taxAmountCents: bill.taxAmountCents.toString(),
      rows: rows
        .filter((row) => row.contractBillId === bill.id)
        .map((row) => ({
          rowKey: row.rowKey,
          sortOrder: row.sortOrder,
          itemCode: row.itemCode,
          itemName: row.itemName,
          specification: row.specification,
          unit: row.unit,
          quantity: row.quantity.toString(),
          unitPrice: this.formatUnitPrice(row.unitPrice),
          taxRate: row.taxRate.toString(),
          taxRatePercent: row.taxRate.toString(),
          taxInclusiveAmountCents: row.taxInclusiveAmountCents.toString(),
          taxExclusiveAmountCents: row.taxExclusiveAmountCents.toString(),
          taxAmountCents: row.taxAmountCents.toString(),
          isProvisional: row.isProvisional,
          settlementBasis: row.settlementBasis,
          customData: row.customData
        }))
    }));
  }

  private parseCheckpoint(value: Prisma.JsonValue): CheckpointSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Invalid contract draft checkpoint");
    }
    const snapshot = value as unknown as CheckpointSnapshot;
    if (
      !snapshot.draftData ||
      typeof snapshot.draftData !== "object" ||
      !Array.isArray(snapshot.clauseSnapshot) ||
      !Array.isArray(snapshot.bills) ||
      typeof snapshot.amountCents !== "string"
    ) {
      throw new BadRequestException("Invalid contract draft checkpoint");
    }
    return snapshot;
  }

  private async replaceBillsFromSnapshot(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    snapshots: BillSnapshot[]
  ) {
    const current = await tx.contractBill.findMany({ where: { contractVersionId } });
    if (current.length) {
      await tx.contractBillRow.deleteMany({
        where: { contractBillId: { in: current.map((bill) => bill.id) } }
      });
      await tx.contractBill.deleteMany({ where: { contractVersionId } });
    }
    for (const snapshot of snapshots) {
      const bill = await tx.contractBill.create({
        data: {
          contractVersionId,
          billKey: snapshot.billKey,
          name: snapshot.name,
          amountRole: snapshot.amountRole,
          pricingMode: snapshot.pricingMode,
          quantityScale: snapshot.quantityScale,
          unitPriceScale: snapshot.unitPriceScale,
          schemaSnapshot: this.toJson(snapshot.schemaSnapshot),
          sourceExcelFileId: snapshot.sourceExcelFileId,
          revision: snapshot.revision,
          taxInclusiveAmountCents: BigInt(snapshot.taxInclusiveAmountCents),
          taxExclusiveAmountCents: BigInt(snapshot.taxExclusiveAmountCents),
          taxAmountCents: BigInt(snapshot.taxAmountCents)
        }
      });
      if (snapshot.rows.length) {
        await tx.contractBillRow.createMany({
          data: snapshot.rows.map((row) => ({
            contractBillId: bill.id,
            ...row,
            taxInclusiveAmountCents: BigInt(row.taxInclusiveAmountCents),
            taxExclusiveAmountCents: BigInt(row.taxExclusiveAmountCents),
            taxAmountCents: BigInt(row.taxAmountCents),
            customData: this.toJson(row.customData)
          }))
        });
      }
    }
  }

  private async runSerializableWithRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; attempt <= CHECKPOINT_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: "Serializable"
        });
      } catch (error) {
        if (attempt === CHECKPOINT_RETRY_LIMIT || !this.isRetryableTransactionError(error)) {
          throw error;
        }
      }
    }
    throw new Error("Unreachable checkpoint transaction retry state");
  }

  private isRetryableTransactionError(error: unknown) {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "P2034" || error.code === "P2002")
    );
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) throw new BadRequestException("Contract draft revision conflict");
  }

  private assertCas(count: number) {
    if (count !== 1) {
      throw new BadRequestException("Contract draft revision/status conflict");
    }
  }

  private assertLifecycleCas(count: number) {
    if (count !== 1) throw new BadRequestException("Contract draft state conflict");
  }

  private toCents(value: number | undefined, field: string) {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }

  private changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
    );
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item
      )
    ) as Prisma.InputJsonValue;
  }

  private formatUnitPrice(value: { toFixed?: (scale: number) => string; toString: () => string }) {
    if (typeof value.toFixed === "function") {
      return value.toFixed(2);
    }
    return new Prisma.Decimal(value.toString()).toFixed(2);
  }

  private toReadModel<T>(value: T): T {
    return this.convertReadValue(value) as T;
  }

  private readinessFromSnapshot(snapshot: unknown) {
    const record = this.objectValue(snapshot);
    const blocking = this.readinessEntries(record["blocking"]);
    const warnings = this.readinessEntries(record["warnings"]);
    const blockingMessages =
      blocking.length > 0 ? blocking.map((item) => item.message) : this.readinessMessages(record["blockingMessages"]);
    const warningMessages =
      warnings.length > 0 ? warnings.map((item) => item.message) : this.readinessMessages(record["warningMessages"]);
    const hasSnapshot = Object.keys(record).length > 0;

    return {
      ready: hasSnapshot && blockingMessages.length === 0,
      blockingMessages,
      warningMessages,
      blocking,
      warnings,
      checkedRevision: typeof record["checkedRevision"] === "number" ? record["checkedRevision"] : null
    };
  }

  private readinessEntries(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item) => {
      const record = this.objectValue(item);
      return typeof record["message"] === "string"
        ? [{
            key: typeof record["key"] === "string" ? record["key"] : "",
            section: typeof record["section"] === "string" ? record["section"] : "",
            message: record["message"]
          }]
        : [];
    });
  }

  private readinessMessages(value: unknown) {
    return Array.isArray(value)
      ? value.filter((message): message is string => typeof message === "string")
      : [];
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private convertReadValue(value: unknown): unknown {
    if (typeof value === "bigint") {
      return centsToSafeNumber(value);
    }
    if (value instanceof Prisma.Decimal) {
      return value.toString();
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.convertReadValue(item));
    }
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.convertReadValue(item)])
      );
    }
    return value;
  }
}
