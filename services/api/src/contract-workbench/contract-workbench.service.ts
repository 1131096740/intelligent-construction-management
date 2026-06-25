import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  ContractBillDefinition,
  ContractClauseDefinition,
  ContractFieldDefinition
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
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
    private readonly audit: AuditService
  ) {}

  async listDrafts(actorUserId: string, scope: "my" | "voided") {
    if (scope !== "my" && scope !== "voided") {
      throw new BadRequestException("Invalid contract workbench scope");
    }
    const isDirector = await this.hasGlobalContractDirector(this.prisma, actorUserId);
    const versions = await this.prisma.contractVersion.findMany({
      where: { status: { in: [...EDITABLE_STATUSES] } },
      select: { contractId: true }
    });
    return this.prisma.contract.findMany({
      where: {
        id: { in: [...new Set(versions.map((version) => version.contractId))] },
        voidedAt: scope === "voided" ? { not: null } : null,
        ...(isDirector ? {} : { ownerUserId: actorUserId })
      },
      orderBy: { updatedAt: "desc" }
    });
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
        orderBy: { sequenceNo: "desc" }
      }),
      this.prisma.contractPartySnapshot.findMany({
        where: { contractVersionId: version.id },
        orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
      }),
      this.prisma.contractGeneratedDocument.findMany({
        where: { contractVersionId: version.id },
        orderBy: { createdAt: "desc" }
      })
    ]);
    return { contract, version, bills, checkpoints, parties, documents };
  }

  async saveDraft(
    contractVersionId: string,
    actorUserId: string,
    input: SaveContractDraftDto
  ) {
    this.validateSaveInput(input);
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
        where: { id: contractVersionId, draftRevision: input.expectedRevision },
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
      return tx.contractVersion.findUnique({ where: { id: contractVersionId } });
    });
  }

  async createCheckpoint(
    contractVersionId: string,
    actorUserId: string,
    input: CreateDraftCheckpointDto
  ) {
    if (input.name !== undefined && typeof input.name !== "string") {
      throw new BadRequestException("Checkpoint name must be a string");
    }
    return this.prisma.$transaction(async (tx) => {
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
      return checkpoint;
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
        where: { id: contractVersionId, draftRevision: version.draftRevision },
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
      return tx.contractVersion.findUnique({ where: { id: contractVersionId } });
    });
  }

  async voidDraft(contractId: string, actorUserId: string, input: VoidDraftDto) {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) throw new BadRequestException("Void reason is required");
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.loadOwnedContract(tx, contractId, actorUserId);
      if (contract.voidedAt) throw new BadRequestException("Contract draft is already voided");
      const updated = await tx.contract.update({
        where: { id: contractId },
        data: { voidedAt: new Date(), voidedReason: reason }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.void",
        businessType: "contract",
        businessId: contractId,
        metadata: { reason }
      });
      return updated;
    });
  }

  async restoreDraft(contractId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.loadOwnedContract(tx, contractId, actorUserId);
      if (!contract.voidedAt) throw new BadRequestException("Contract draft is not voided");
      const updated = await tx.contract.update({
        where: { id: contractId },
        data: { voidedAt: null, voidedReason: null }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.restore",
        businessType: "contract",
        businessId: contractId
      });
      return updated;
    });
  }

  async transferDraft(
    contractId: string,
    actorUserId: string,
    input: TransferContractDraftDto
  ) {
    if (typeof input.toUserId !== "string" || !input.toUserId.trim()) {
      throw new BadRequestException("toUserId is required");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalContractDirector(tx, actorUserId);
      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract) throw new NotFoundException("Contract draft not found");
      const updated = await tx.contract.update({
        where: { id: contractId },
        data: { ownerUserId: input.toUserId }
      });
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
      return updated;
    });
  }

  async previewTypeChange(
    contractVersionId: string,
    actorUserId: string,
    input: PreviewContractTypeChangeDto
  ) {
    this.validateTypeChangeInput(input);
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
    input: ApplyContractTypeChangeDto
  ) {
    this.validateTypeChangeInput(input);
    if (input.confirmed !== true) {
      throw new BadRequestException("Contract type change confirmation is required");
    }
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
            unitPrice: row.unitPrice.toString(),
            taxRate: row.taxRate.toString(),
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
        where: { id: contractVersionId, draftRevision: input.expectedRevision },
        data: {
          businessTemplateVersionId: target.id,
          templateSnapshot: this.toJson(targetTemplate),
          draftData: this.toJson(nextData),
          clauseSnapshot: this.toJson(nextClauses),
          draftRevision: { increment: 1 }
        }
      });
      this.assertCas(updated.count);

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
      return tx.contractVersion.findUnique({ where: { id: contractVersionId } });
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

  private validateSaveInput(input: SaveContractDraftDto) {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new BadRequestException("expectedRevision must be a positive integer");
    }
    if (!input.draftData || typeof input.draftData !== "object" || Array.isArray(input.draftData)) {
      throw new BadRequestException("draftData must be an object");
    }
    if (!Array.isArray(input.clauses)) {
      throw new BadRequestException("clauses must be an array");
    }
    if (!PRICING_NATURES.has(input.pricingNature)) {
      throw new BadRequestException("Invalid pricingNature");
    }
    if (!AMOUNT_SOURCES.has(input.amountSource)) {
      throw new BadRequestException("Invalid amountSource");
    }
    if (input.amountSource === "manual") {
      this.toCents(input.manualAmountCents, "manualAmountCents");
    }
  }

  private validateTypeChangeInput(input: PreviewContractTypeChangeDto) {
    if (
      typeof input.targetBusinessTemplateVersionId !== "string" ||
      !input.targetBusinessTemplateVersionId.trim()
    ) {
      throw new BadRequestException("targetBusinessTemplateVersionId is required");
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new BadRequestException("expectedRevision must be a positive integer");
    }
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
          unitPrice: row.unitPrice.toString(),
          taxRate: row.taxRate.toString(),
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

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) throw new BadRequestException("Contract draft revision conflict");
  }

  private assertCas(count: number) {
    if (count !== 1) throw new BadRequestException("Contract draft revision conflict");
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
}
