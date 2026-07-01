import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ContractBillDefinition,
  ContractClauseDefinition,
  ContractFieldDefinition,
  ContractValidationRule
} from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export interface ContractReadinessResult {
  blocking: Array<{ key: string; section: string; message: string }>;
  warnings: Array<{ key: string; section: string; message: string }>;
  checkedRevision: number;
}

type ReadinessVersion = {
  id: string;
  contractId: string;
  draftRevision: number;
  amountCents: bigint;
  amountSource: string;
  amountAdjustmentReason: string | null;
  layoutTemplateVersionId: string | null;
  draftData: Prisma.JsonValue;
  templateSnapshot: Prisma.JsonValue;
  clauseSnapshot: Prisma.JsonValue;
};

type ReadinessContract = {
  contractTypeKey: string | null;
};

type ReadinessClient = {
  contractBill: {
    findMany(input: unknown): Promise<
      Array<{
        id: string;
        billKey: string;
        taxInclusiveAmountCents: bigint;
        schemaSnapshot?: Prisma.JsonValue;
      }>
    >;
  };
  contractBillRow: {
    findMany(input: unknown): Promise<
      Array<{
        contractBillId: string;
        itemName: string;
        unit?: string;
        customData: Prisma.JsonValue;
      }>
    >;
  };
  contractPartySnapshot: {
    findMany(input: unknown): Promise<Array<{ id: string; roleKey: string }>>;
  };
  contractLayoutTemplateVersion: {
    findUnique(input: unknown): Promise<{
      id: string;
      layoutTemplateId: string;
      status: string;
    } | null>;
  };
  contractLayoutTemplate: {
    findUnique(input: unknown): Promise<{
      id: string;
      contractTypeKey: string;
    } | null>;
  };
  contractGeneratedDocument: {
    findMany(input: unknown): Promise<
      Array<{
        id: string;
        purpose: string;
        status: string;
        sourceRevision: number;
        layoutTemplateVersionId: string;
        docxFileId?: string | null;
        pdfFileId?: string | null;
      }>
    >;
  };
};

interface TemplateSnapshot {
  fieldSchema: ContractFieldDefinition[];
  billSchema: Array<ContractBillDefinition & { required?: boolean }>;
  clauseSchema: ContractClauseDefinition[];
  attachmentSchema: unknown[];
  validationSchema: ContractValidationRule[];
}

@Injectable()
export class ContractReadinessService {
  constructor(private readonly prisma?: PrismaService) {}

  async checkAndStore(
    contractVersionId: string,
    actorUserId: string
  ): Promise<ContractReadinessResult> {
    if (!this.prisma) throw new Error("Prisma service is required");
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });
      if (!version) throw new NotFoundException("Contract version not found");
      const contract = await tx.contract.findUnique({
        where: { id: version.contractId }
      });
      if (!contract) throw new NotFoundException("Contract not found");
      if (contract.ownerUserId !== actorUserId) {
        throw new BadRequestException("Only the contract owner can check readiness");
      }
      if (contract.voidedAt) {
        throw new BadRequestException("Contract draft is voided");
      }
      const result = await this.check(tx, version, contract, false);
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: version.id,
          draftRevision: version.draftRevision,
          status: { in: ["draft", "approval_rejected"] }
        },
        data: { readinessSnapshot: result as unknown as Prisma.InputJsonValue }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("Contract readiness revision/status conflict");
      }
      return result;
    });
  }

  async check(
    tx: ReadinessClient,
    version: ReadinessVersion,
    contract: ReadinessContract,
    requireInternalReviewDocument: boolean
  ): Promise<ContractReadinessResult> {
    const blocking: ContractReadinessResult["blocking"] = [];
    const warnings: ContractReadinessResult["warnings"] = [];
    const template = this.template(version.templateSnapshot);
    const draftData = this.object(version.draftData);
    const fieldData = this.fieldData(draftData);
    const clauses = this.clauses(version.clauseSnapshot);

    for (const field of template.fieldSchema) {
      if (
        field.required &&
        this.isVisible(field, fieldData) &&
        this.isEmpty(fieldData[field.key])
      ) {
        blocking.push({
          key: `field.${field.key}`,
          section: "fields",
          message: `${field.label}不能为空`
        });
      }
    }

    const clauseByKey = new Map(clauses.map((clause) => [clause.key, clause]));
    for (const definition of template.clauseSchema) {
      if (definition.required && this.isEmpty(clauseByKey.get(definition.key)?.content)) {
        blocking.push({
          key: `clause.${definition.key}`,
          section: "clauses",
          message: `${definition.title}不能为空`
        });
      }
    }
    for (const rule of template.validationSchema) {
      const content = this.text(clauseByKey.get(rule.targetClauseKey)?.content);
      if (rule.requiredPhrases.some((phrase) => !content.includes(phrase))) {
        (rule.level === "block" ? blocking : warnings).push({
          key: rule.key,
          section: "clauses",
          message: rule.message
        });
      }
    }

    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id },
      orderBy: { billKey: "asc" }
    });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }]
        })
      : [];
    const billByKey = new Map(bills.map((bill) => [bill.billKey, bill]));
    for (const definition of template.billSchema) {
      const bill = billByKey.get(definition.key);
      const billRows = bill
        ? rows.filter((row) => row.contractBillId === bill.id)
        : [];
      if (definition.required && billRows.length === 0) {
        blocking.push({
          key: `bill.${definition.key}.empty`,
          section: "bills",
          message: `${definition.name}不能为空`
        });
      }
      for (const [index, row] of billRows.entries()) {
        const customData = this.object(row.customData);
        for (const column of definition.columns.filter((item) => item.required)) {
          const value =
            column.key === "itemName" || column.key === "item_name"
              ? row.itemName
              : column.key === "unit"
                ? row.unit
                : customData[column.key];
          if (this.isEmpty(value)) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.${column.key}`,
              section: "bills",
              message: `${definition.name}第${index + 1}行${column.label}不能为空`
            });
          }
        }
      }
    }

    const includedBillSum = bills
      .filter(
        (bill) =>
          template.billSchema.find((definition) => definition.key === bill.billKey)
            ?.amountRole === "included"
      )
      .reduce((sum, bill) => sum + bill.taxInclusiveAmountCents, 0n);
    if (version.amountSource === "bill_sum" && version.amountCents !== includedBillSum) {
      blocking.push({
        key: "amount.bill_sum",
        section: "amount",
        message: "合同金额与计入合同价的清单合计不一致"
      });
    }
    if (
      version.amountSource === "manual" &&
      version.amountCents !== includedBillSum &&
      !version.amountAdjustmentReason?.trim()
    ) {
      blocking.push({
        key: "amount.adjustment_reason",
        section: "amount",
        message: "手工合同金额与清单合计不一致时必须填写调整原因"
      });
    }

    if (!version.layoutTemplateVersionId) {
      blocking.push({
        key: "layout.selected",
        section: "layout",
        message: "请选择已发布的合同版式"
      });
    } else {
      const layout = await tx.contractLayoutTemplateVersion.findUnique({
        where: { id: version.layoutTemplateVersionId }
      });
      const layoutTemplate = layout
        ? await tx.contractLayoutTemplate.findUnique({
            where: { id: layout.layoutTemplateId }
          })
        : null;
      if (
        !layout ||
        layout.status !== "published" ||
        !layoutTemplate ||
        layoutTemplate.contractTypeKey !== contract.contractTypeKey
      ) {
        blocking.push({
          key: "layout.published",
          section: "layout",
          message: "所选合同版式未发布或与合同类型不匹配"
        });
      }
    }

    const parties = await tx.contractPartySnapshot.findMany({
      where: { contractVersionId: version.id }
    });
    for (const roleKey of ["party_a", "party_b"]) {
      if (!parties.some((party) => party.roleKey === roleKey)) {
        blocking.push({
          key: `party.${roleKey}`,
          section: "parties",
          message: `缺少合同主体角色：${roleKey}`
        });
      }
    }

    if (requireInternalReviewDocument) {
      const documents = await tx.contractGeneratedDocument.findMany({
        where: {
          contractVersionId: version.id,
          purpose: "internal_review"
        },
        orderBy: { createdAt: "desc" }
      });
      const currentFailure = documents.some(
        (document) =>
          document.sourceRevision === version.draftRevision &&
          document.layoutTemplateVersionId === version.layoutTemplateVersionId &&
          document.status === "failed"
      );
      if (currentFailure) {
        blocking.push({
          key: "document.failure",
          section: "documents",
          message: "当前修订存在未解决的合同文档生成失败"
        });
      }
      const latestSuccess = documents.find((document) => document.status === "success");
      if (
        !latestSuccess ||
        latestSuccess.sourceRevision !== version.draftRevision ||
        latestSuccess.layoutTemplateVersionId !== version.layoutTemplateVersionId
      ) {
        blocking.push({
          key: "document.internal_review",
          section: "documents",
          message: "最新内部审核文档与当前修订或版式不一致"
        });
      }
    }

    return { blocking, warnings, checkedRevision: version.draftRevision };
  }

  async freeze(tx: ReadinessClient, version: ReadinessVersion) {
    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id },
      orderBy: { billKey: "asc" }
    });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }]
        })
      : [];
    const parties = await tx.contractPartySnapshot.findMany({
      where: { contractVersionId: version.id }
    });
    const documents = await tx.contractGeneratedDocument.findMany({
      where: {
        contractVersionId: version.id,
        purpose: "internal_review",
        status: "success"
      },
      orderBy: { createdAt: "desc" }
    });
    return this.toJsonSafe({
      draftRevision: version.draftRevision,
      draftData: version.draftData,
      clauses: version.clauseSnapshot,
      amountCents: version.amountCents.toString(),
      amountSource: version.amountSource,
      amountAdjustmentReason: version.amountAdjustmentReason,
      layoutTemplateVersionId: version.layoutTemplateVersionId,
      parties,
      bills: bills.map((bill) => ({
        ...bill,
        taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
        rows: rows.filter((row) => row.contractBillId === bill.id)
      })),
      internalReviewDocument: documents[0] ?? null
    });
  }

  private template(value: Prisma.JsonValue): TemplateSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Contract template snapshot is invalid");
    }
    const snapshot = value as unknown as Partial<TemplateSnapshot>;
    if (
      !Array.isArray(snapshot.fieldSchema) ||
      !Array.isArray(snapshot.billSchema) ||
      !Array.isArray(snapshot.clauseSchema) ||
      !Array.isArray(snapshot.attachmentSchema) ||
      !Array.isArray(snapshot.validationSchema)
    ) {
      throw new BadRequestException("Contract template snapshot is invalid");
    }
    return snapshot as TemplateSnapshot;
  }

  private clauses(value: Prisma.JsonValue): ContractClauseDefinition[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("Contract clause snapshot is invalid");
    }
    return value as unknown as ContractClauseDefinition[];
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private fieldData(draftData: Record<string, unknown>) {
    return { ...draftData, ...this.object(draftData["fieldValues"]) };
  }

  private isVisible(
    field: ContractFieldDefinition,
    draftData: Record<string, unknown>
  ) {
    if (!field.visibleWhen) return true;
    const matches = draftData[field.visibleWhen.fieldKey] === field.visibleWhen.value;
    return field.visibleWhen.operator === "eq" ? matches : !matches;
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return this.text(value).trim().length === 0;
    return false;
  }

  private text(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.map((item) => this.text(item)).join(" ");
    if (typeof value === "object") {
      return Object.values(value as Record<string, unknown>)
        .map((item) => this.text(item))
        .join(" ");
    }
    return String(value);
  }

  private toJsonSafe<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? item.toString() : item
      )
    ) as T;
  }
}
