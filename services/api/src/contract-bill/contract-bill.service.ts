import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  isContractBillCustomColumn,
  normalizeContractBillBoolean
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { bumpContractRenderInputRevision } from "../contract-workbench/contract-render-input-revision";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi } from "../money/decimal-money";
import {
  ContractBillRowFactsValidationException,
  resolveContractBillRowFacts
} from "./contract-bill-row-rules";
import { recalculateBillAndContractAmount } from "./contract-bill-totals";
import { loadOwnedEditableBill } from "./contract-bill-guards";
import { ContractBillLineageService } from "./contract-bill-lineage.service";
import type {
  ReorderBillRowsDto,
  ReplaceBillRowDto,
  SaveBillRowDto
} from "./dto/contract-bill.dto";

type BatchRowError = {
  clientRowKey: string;
  field: string;
  message: string;
};

type BatchRowField = string;

class ContractBillRowInputValidationException extends BadRequestException {
  constructor(readonly field: BatchRowField, message: string) {
    super(message);
  }
}

type ParsedBatchRow = ReplaceBillRowDto & {
  facts: ReturnType<typeof resolveContractBillRowFacts>;
  rowKey?: string;
  sortOrder: number;
};

type ReplaceRowsEnvelope = {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: Array<Record<string, unknown>>;
};

const REPLACE_ROW_INPUT_FIELDS = [
  "itemCode",
  "itemName",
  "specification",
  "unit",
  "quantity",
  "unitPrice",
  "taxRatePercent",
  "taxRateSource",
  "isProvisional",
  "settlementBasis",
  "customData"
] as const;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class ContractBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lineage: ContractBillLineageService = new ContractBillLineageService()
  ) {}

  replaceRows(billId: string, actorUserId: string, rawInput: unknown) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ContractBill"
        WHERE "id" = ${billId}
        FOR UPDATE
      `);
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      const envelope = this.parseReplaceEnvelope(rawInput);
      const idempotencyKeyDigest = sha256(envelope.idempotencyKey);
      const requestDigest = sha256(stableJson({
        expectedBillRevision: envelope.expectedBillRevision,
        rows: envelope.rows.map((row, index) => ({
          ...row,
          ...(typeof row.clientRowKey === "string"
            ? { clientRowKey: row.clientRowKey.trim() }
            : {}),
          ...(typeof row.rowKey === "string" && row.rowKey.trim()
            ? { rowKey: row.rowKey.trim() }
            : {}),
          sortOrder: index,
          expectedBillRevision: envelope.expectedBillRevision
        }))
      }));
      const receipt = await tx.auditLog.findFirst({
        where: {
          actorUserId,
          action: "contract.bill.rows.replace",
          businessType: "contract_bill",
          businessId: bill.id,
          metadata: {
            path: ["idempotencyKeyDigest"],
            equals: idempotencyKeyDigest
          }
        },
        orderBy: { createdAt: "desc" }
      });
      if (receipt) {
        const metadata = this.isPlainObject(receipt.metadata) ? receipt.metadata : {};
        if (metadata.requestDigest !== requestDigest) {
          throw new BadRequestException("幂等键已被另一份清单使用，请重新保存");
        }
        return this.readBill(tx, bill.id);
      }

      const existingRows = await tx.contractBillRow.findMany({
        where: { contractBillId: bill.id },
        orderBy: { sortOrder: "asc" }
      });
      const existingByKey = new Map(existingRows.map((row) => [row.rowKey, row]));
      const input = this.parseReplaceInput(envelope, bill, version, existingByKey);

      const requestedKeys = new Set(
        input.rows.flatMap((row) => (row.rowKey ? [row.rowKey] : []))
      );
      if ([...requestedKeys].some((rowKey) => !existingByKey.has(rowKey))) {
        throw new BadRequestException("清单已有行已变化，请刷新后重试");
      }
      const renderRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        input.expectedBillRevision
      );
      const deletedKeys = existingRows
        .map((row) => row.rowKey)
        .filter((rowKey) => !requestedKeys.has(rowKey));
      if (deletedKeys.length) {
        await this.lineage.assertRowsDeletable(
          tx,
          existingRows.filter((row) => deletedKeys.includes(row.rowKey)).map((row) => row.id)
        );
        await tx.contractBillRow.deleteMany({
          where: { contractBillId: bill.id, rowKey: { in: deletedKeys } }
        });
      }

      let createdCount = 0;
      let updatedCount = 0;
      for (const row of input.rows) {
        const data = this.batchRowData(row);
        if (row.rowKey) {
          const existing = existingByKey.get(row.rowKey)!;
          if (this.batchRowChanged(existing, data)) {
            await tx.contractBillRow.update({ where: { id: existing.id }, data });
            updatedCount += 1;
          }
        } else {
          const created = await tx.contractBillRow.create({
            data: { contractBillId: bill.id, rowKey: randomUUID(), ...data }
          });
          await this.lineage.bindNewRow(tx, {
            contractId: version.contractId,
            contractVersionId: version.id,
            contractBillRowId: created.id,
            actorUserId
          });
          createdCount += 1;
        }
      }
      const rows = await recalculateBillAndContractAmount(tx, bill, version);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.bill.rows.replace",
        businessType: "contract_bill",
        businessId: bill.id,
        metadata: {
          idempotencyKeyDigest,
          requestDigest,
          createdCount,
          updatedCount,
          deletedCount: deletedKeys.length,
          previousBillRevision: input.expectedBillRevision,
          nextBillRevision: input.expectedBillRevision + 1,
          renderRevision
        }
      });
      const updatedBill = await tx.contractBill.findUnique({ where: { id: bill.id } });
      return this.toReadModel({ bill: updatedBill, rows });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  addRow(billId: string, actorUserId: string, rawInput: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      const input = this.parseRowInput(rawInput, bill, version);
      const newRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        input.expectedBillRevision
      );
      const sortOrder = await tx.contractBillRow.count({ where: { contractBillId: billId } });
      const row = await tx.contractBillRow.create({
        data: {
          contractBillId: billId,
          rowKey: randomUUID(),
          sortOrder,
          itemCode: input.itemCode?.trim() || null,
          itemName: input.itemName.trim(),
          specification: input.specification?.trim() || null,
          unit: input.unit.trim(),
          quantity: input.facts.quantity,
          unitPrice: input.facts.unitPrice,
          taxRate: input.facts.taxRatePercent,
          taxRateSource: input.facts.taxRateSource,
          pricingFactStatus: input.facts.pricingFactStatus,
          precisionPolicy: input.facts.precisionPolicy,
          taxInclusiveAmountCents: input.facts.taxInclusiveAmountCents,
          taxExclusiveAmountCents: input.facts.taxExclusiveAmountCents,
          taxAmountCents: input.facts.taxAmountCents,
          isProvisional: input.isProvisional ?? false,
          settlementBasis: input.settlementBasis?.trim() || null,
          customData: this.toJson(input.customData)
        }
      });
      await this.lineage.bindNewRow(tx, {
        contractId: version.contractId,
        contractVersionId: version.id,
        contractBillRowId: row.id,
        actorUserId
      });
      return this.finishMutation(
        tx,
        bill,
        version,
        actorUserId,
        "create",
        row.rowKey,
        newRevision
      );
    });
  }

  updateRow(
    billId: string,
    rowKey: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      const row = await this.findRow(tx, billId, rowKey);
      const input = this.parseRowInput(rawInput, bill, version, row);
      const newRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        input.expectedBillRevision
      );
      const updated = await tx.contractBillRow.updateMany({
        where: { id: row.id, contractBillId: billId, rowKey },
        data: {
          itemCode: input.itemCode?.trim() || null,
          itemName: input.itemName.trim(),
          specification: input.specification?.trim() || null,
          unit: input.unit.trim(),
          quantity: input.facts.quantity,
          unitPrice: input.facts.unitPrice,
          taxRate: input.facts.taxRatePercent,
          taxRateSource: input.facts.taxRateSource,
          pricingFactStatus: input.facts.pricingFactStatus,
          precisionPolicy: input.facts.precisionPolicy,
          taxInclusiveAmountCents: input.facts.taxInclusiveAmountCents,
          taxExclusiveAmountCents: input.facts.taxExclusiveAmountCents,
          taxAmountCents: input.facts.taxAmountCents,
          isProvisional: input.isProvisional ?? false,
          settlementBasis: input.settlementBasis?.trim() || null,
          customData: this.toJson(input.customData)
        }
      });
      if (updated.count !== 1) throw new NotFoundException("合同清单行不存在");
      return this.finishMutation(
        tx,
        bill,
        version,
        actorUserId,
        "update",
        rowKey,
        newRevision
      );
    });
  }

  deleteRow(
    billId: string,
    rowKey: string,
    actorUserId: string,
    expectedBillRevision: number
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      this.assertExpectedRevision(expectedBillRevision);
      const row = await this.findRow(tx, billId, rowKey);
      await this.lineage.assertRowsDeletable(tx, [row.id]);
      const newRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        expectedBillRevision
      );
      const deleted = await tx.contractBillRow.deleteMany({
        where: { contractBillId: billId, rowKey }
      });
      if (deleted.count !== 1) throw new NotFoundException("合同清单行不存在");
      return this.finishMutation(
        tx,
        bill,
        version,
        actorUserId,
        "delete",
        rowKey,
        newRevision
      );
    });
  }

  cancelRemainder(
    billId: string,
    rowKey: string,
    actorUserId: string,
    input: { expectedBillRevision: number; reason: string }
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("取消未实施余量必须填写原因");
    return this.prisma.$transaction(async (tx) => {
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      this.assertExpectedRevision(input.expectedBillRevision);
      const row = await this.findRow(tx, billId, rowKey);
      if (!await this.lineage.hasHistoricalOccupancy(tx, [row.id])) {
        throw new BadRequestException("清单行尚无历史结算占用，应直接删除而不是取消未实施余量");
      }
      const newRevision = await this.lockMutation(
        tx, bill, version, actorUserId, input.expectedBillRevision
      );
      const updated = await tx.contractBillRow.updateMany({
        where: { id: row.id, contractBillId: billId, rowKey },
        data: {
          remainderDisposition: "cancelled",
          remainderDispositionReason: reason,
          remainderDispositionByUserId: actorUserId,
          remainderDispositionAt: new Date()
        }
      });
      if (updated.count !== 1) throw new NotFoundException("合同清单行不存在");
      return this.finishMutation(tx, bill, version, actorUserId, "update", rowKey, newRevision);
    });
  }

  reorderRows(billId: string, actorUserId: string, rawInput: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      const input = this.parseReorderInput(rawInput);
      const rows = await tx.contractBillRow.findMany({
        where: { contractBillId: billId },
        orderBy: { sortOrder: "asc" }
      });
      const currentKeys = new Set(rows.map((row) => row.rowKey));
      if (
        input.rowKeys.length !== rows.length ||
        new Set(input.rowKeys).size !== input.rowKeys.length ||
        input.rowKeys.some((key) => !currentKeys.has(key))
      ) {
        throw new BadRequestException(
          "排序行必须与当前清单行完全一致"
        );
      }
      const newRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        input.expectedBillRevision
      );
      const byKey = new Map(rows.map((row) => [row.rowKey, row]));
      for (const [sortOrder, rowKey] of input.rowKeys.entries()) {
        await tx.contractBillRow.update({
          where: { id: byKey.get(rowKey)!.id },
          data: { sortOrder }
        });
      }
      return this.finishMutation(
        tx,
        bill,
        version,
        actorUserId,
        "reorder",
        null,
        newRevision
      );
    });
  }

  private async lockMutation(
    tx: Prisma.TransactionClient,
    bill: { id: string; contractVersionId: string },
    version: { id: string; contractId: string; draftRevision: number },
    actorUserId: string,
    expectedBillRevision: number
  ) {
    this.assertExpectedRevision(expectedBillRevision);
    const newRevision = await bumpContractRenderInputRevision(
      tx,
      version.id,
      version.draftRevision
    );
    const ownerGate = await tx.contract.updateMany({
      where: {
        id: version.contractId,
        ownerUserId: actorUserId,
        voidedAt: null
      },
      data: { ownerUserId: actorUserId }
    });
    if (ownerGate.count !== 1) {
      throw new BadRequestException("合同清单已变化或当前状态不可编辑，请刷新后重试");
    }
    const billGate = await tx.contractBill.updateMany({
      where: {
        id: bill.id,
        contractVersionId: bill.contractVersionId,
        revision: expectedBillRevision
      },
      data: { revision: { increment: 1 } }
    });
    if (billGate.count !== 1) {
      throw new BadRequestException("合同清单已变化或当前状态不可编辑，请刷新后重试");
    }
    return newRevision;
  }

  private async finishMutation(
    tx: Prisma.TransactionClient,
    bill: { id: string; contractVersionId: string },
    version: {
      id: string;
      amountSource: string;
      pricingNature: string;
      amountLimitType: string;
    },
    actorUserId: string,
    action: "create" | "update" | "delete" | "reorder",
    rowKey: string | null,
    newRevision?: number
  ) {
    const rows = await recalculateBillAndContractAmount(tx, bill, version);
    await this.audit.record(tx, {
      actorUserId,
      action: `contract.bill.row.${action}`,
      businessType: "contract_bill",
      businessId: bill.id,
      metadata: { rowKey, ...(newRevision === undefined ? {} : { newRevision }) }
    });
    const updatedBill = await tx.contractBill.findUnique({ where: { id: bill.id } });
    return this.toReadModel({ bill: updatedBill, rows });
  }

  private async findRow(
    tx: Prisma.TransactionClient,
    billId: string,
    rowKey: string
  ) {
    const row = await tx.contractBillRow.findFirst({
      where: { contractBillId: billId, rowKey }
    });
    if (!row) throw new NotFoundException("合同清单行不存在");
    return row;
  }

  private parseReplaceInput(
    rawInput: unknown,
    bill: Parameters<ContractBillService["parseRowInput"]>[1],
    version: Parameters<ContractBillService["parseRowInput"]>[2],
    existingByKey: Map<string, Parameters<ContractBillService["parseRowInput"]>[3]>
  ) {
    const input = this.requireObject(rawInput, "合同清单整表提交内容");
    this.assertExpectedRevision(input.expectedBillRevision);
    if (
      typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey)
    ) {
      throw new BadRequestException("清单保存标识格式无效");
    }
    if (!Array.isArray(input.rows) || input.rows.length > 5000) {
      throw new BadRequestException("合同清单行数必须在 0 到 5000 行之间");
    }

    const clientKeys = new Set<string>();
    const serverKeys = new Set<string>();
    const rowErrors: BatchRowError[] = [];
    const rows: ParsedBatchRow[] = [];
    input.rows.forEach((rawRow, index) => {
      const fallbackClientRowKey = `row-${index + 1}`;
      let clientRowKey = fallbackClientRowKey;
      try {
        const row = this.requireObject(rawRow, `合同清单第 ${index + 1} 行`);
        clientRowKey = typeof row.clientRowKey === "string" ? row.clientRowKey.trim() : "";
        if (!clientRowKey || clientKeys.has(clientRowKey)) {
          rowErrors.push({
            clientRowKey: clientRowKey || fallbackClientRowKey,
            field: "clientRowKey",
            message: clientRowKey ? "客户端行标识重复" : "客户端行标识不能为空"
          });
          return;
        }
        clientKeys.add(clientRowKey);
        if (typeof row.sortOrder !== "number" || !Number.isInteger(row.sortOrder)) {
          rowErrors.push({ clientRowKey, field: "sortOrder", message: "排序值必须是整数" });
          return;
        }
        if (row.rowKey !== undefined && (typeof row.rowKey !== "string" || !row.rowKey.trim())) {
          rowErrors.push({ clientRowKey, field: "rowKey", message: "服务端行标识必须是非空文本" });
          return;
        }
        const rowKey = typeof row.rowKey === "string" ? row.rowKey.trim() : undefined;
        if (rowKey && serverKeys.has(rowKey)) {
          rowErrors.push({ clientRowKey, field: "rowKey", message: "服务端行标识重复" });
          return;
        }
        if (rowKey) serverKeys.add(rowKey);
        this.validateReplaceRowFields(row);
        rows.push({
          ...this.parseRowInput(
            { ...row, expectedBillRevision: input.expectedBillRevision },
            bill,
            version,
            rowKey ? existingByKey.get(rowKey) : undefined
          ),
          clientRowKey,
          ...(rowKey ? { rowKey } : {}),
          sortOrder: index
        });
      } catch (error) {
        rowErrors.push(this.batchRowError(clientRowKey || fallbackClientRowKey, error));
      }
    });
    if (rowErrors.length) {
      throw new BadRequestException({
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        message: `清单有 ${rowErrors.length} 处需要修改`,
        rowErrors
      });
    }
    return {
      expectedBillRevision: input.expectedBillRevision as number,
      idempotencyKey: input.idempotencyKey,
      rows
    };
  }

  private parseReplaceEnvelope(rawInput: unknown): ReplaceRowsEnvelope {
    const input = this.requireObject(rawInput, "合同清单整表提交内容");
    this.assertExpectedRevision(input.expectedBillRevision);
    if (
      typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey)
    ) {
      throw new BadRequestException("清单保存标识格式无效");
    }
    if (!Array.isArray(input.rows) || input.rows.length > 5000) {
      throw new BadRequestException("合同清单行数必须在 0 到 5000 行之间");
    }
    const rowErrors: BatchRowError[] = [];
    const rows = input.rows.flatMap((rawRow, index) => {
      const fallbackClientRowKey = `row-${index + 1}`;
      let clientRowKey = fallbackClientRowKey;
      try {
        const row = this.requireObject(rawRow, `合同清单第 ${index + 1} 行`);
        if (typeof row.clientRowKey === "string" && row.clientRowKey.trim()) {
          clientRowKey = row.clientRowKey.trim();
        }
        const normalized: Record<string, unknown> = {
          clientRowKey: row.clientRowKey,
          sortOrder: row.sortOrder
        };
        if (row.rowKey !== undefined) normalized.rowKey = row.rowKey;
        for (const field of REPLACE_ROW_INPUT_FIELDS) {
          if (row[field] !== undefined) normalized[field] = row[field];
        }
        for (const [field, value] of Object.entries(normalized)) {
          this.assertReplaceEnvelopeField(field, value);
        }
        return [normalized];
      } catch (error) {
        rowErrors.push(this.batchRowError(clientRowKey, error));
        return [];
      }
    });
    if (rowErrors.length) {
      throw new BadRequestException({
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        message: `清单有 ${rowErrors.length} 处需要修改`,
        rowErrors
      });
    }
    return {
      expectedBillRevision: input.expectedBillRevision as number,
      idempotencyKey: input.idempotencyKey,
      rows
    };
  }

  private assertReplaceEnvelopeField(field: string, value: unknown): void {
    try {
      this.assertJsonEnvelopeValue(value, new WeakSet<object>());
    } catch {
      throw new ContractBillRowInputValidationException(
        field,
        field === "customData"
          ? "自定义字段数据包含无法保存的内容"
          : "清单保存内容必须是 JSON 数据"
      );
    }
  }

  private assertJsonEnvelopeValue(value: unknown, seen: WeakSet<object>): void {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new BadRequestException("清单保存内容必须是 JSON 数据");
      seen.add(value);
      value.forEach((item) => this.assertJsonEnvelopeValue(item, seen));
      seen.delete(value);
      return;
    }
    if (this.isPlainObject(value)) {
      if (seen.has(value)) throw new BadRequestException("清单保存内容必须是 JSON 数据");
      seen.add(value);
      Object.values(value).forEach((item) => this.assertJsonEnvelopeValue(item, seen));
      seen.delete(value);
      return;
    }
    throw new BadRequestException("清单保存内容必须是 JSON 数据");
  }

  private batchRowError(clientRowKey: string, error: unknown): BatchRowError {
    if (error instanceof ContractBillRowInputValidationException) {
      return { clientRowKey, field: error.field, message: error.message };
    }
    if (error instanceof ContractBillRowFactsValidationException) {
      return { clientRowKey, field: error.field, message: error.message };
    }
    const response = error instanceof BadRequestException ? error.getResponse() : undefined;
    const fallbackMessage = error instanceof Error ? error.message : "该行内容无法保存";
    const message = this.isPlainObject(response)
      ? String(response.message ?? fallbackMessage)
      : String(response ?? fallbackMessage);
    return { clientRowKey, field: "row", message };
  }

  private validateReplaceRowFields(row: Record<string, unknown>) {
    this.assertBatchRequiredText(row.itemName, "itemName", "项目名称");
    this.assertBatchRequiredText(row.unit, "unit", "单位");
    this.assertBatchOptionalText(row.itemCode, "itemCode", "项目编号");
    this.assertBatchOptionalText(row.specification, "specification", "规格型号");
    this.assertBatchOptionalText(row.settlementBasis, "settlementBasis", "结算依据");
    if (row.quantity !== undefined && typeof row.quantity !== "string") {
      throw new ContractBillRowInputValidationException("quantity", "数量必须是文本数字");
    }
    if (typeof row.unitPrice !== "string") {
      throw new ContractBillRowInputValidationException("unitPrice", "含税单价不能为空");
    }
    if (row.taxRatePercent !== undefined && typeof row.taxRatePercent !== "string") {
      throw new ContractBillRowInputValidationException("taxRatePercent", "税率必须是文本数字");
    }
    if (
      row.taxRateSource !== undefined &&
      row.taxRateSource !== "version_default" &&
      row.taxRateSource !== "row_override"
    ) {
      throw new ContractBillRowInputValidationException("taxRateSource", "税率来源无效");
    }
    if (row.isProvisional !== undefined && typeof row.isProvisional !== "boolean") {
      throw new ContractBillRowInputValidationException("isProvisional", "是否暂定必须为布尔值");
    }
    if (!this.isPlainObject(row.customData)) {
      throw new ContractBillRowInputValidationException("customData", "自定义字段数据必须是普通对象");
    }
  }

  private assertBatchRequiredText(value: unknown, field: BatchRowField, label: string) {
    if (typeof value !== "string" || !value.trim()) {
      throw new ContractBillRowInputValidationException(field, `${label}不能为空`);
    }
  }

  private assertBatchOptionalText(value: unknown, field: BatchRowField, label: string) {
    if (value !== undefined && typeof value !== "string") {
      throw new ContractBillRowInputValidationException(field, `${label}必须是文本`);
    }
  }

  private batchRowData(row: ParsedBatchRow) {
    return {
      sortOrder: row.sortOrder,
      itemCode: row.itemCode?.trim() || null,
      itemName: row.itemName.trim(),
      specification: row.specification?.trim() || null,
      unit: row.unit.trim(),
      quantity: row.facts.quantity,
      unitPrice: row.facts.unitPrice,
      taxRate: row.facts.taxRatePercent,
      taxRateSource: row.facts.taxRateSource,
      pricingFactStatus: row.facts.pricingFactStatus,
      precisionPolicy: row.facts.precisionPolicy,
      taxInclusiveAmountCents: row.facts.taxInclusiveAmountCents,
      taxExclusiveAmountCents: row.facts.taxExclusiveAmountCents,
      taxAmountCents: row.facts.taxAmountCents,
      isProvisional: row.isProvisional ?? false,
      settlementBasis: row.settlementBasis?.trim() || null,
      customData: this.toJson(row.customData)
    };
  }

  private async readBill(tx: Prisma.TransactionClient, billId: string) {
    const [bill, rows] = await Promise.all([
      tx.contractBill.findUnique({ where: { id: billId } }),
      tx.contractBillRow.findMany({
        where: { contractBillId: billId },
        orderBy: { sortOrder: "asc" }
      })
    ]);
    return this.toReadModel({ bill, rows });
  }

  private batchRowChanged(
    existing: {
      sortOrder: number;
      itemCode: string | null;
      itemName: string;
      specification: string | null;
      unit: string;
      quantity: Prisma.Decimal | null;
      unitPrice: Prisma.Decimal | null;
      taxRate: Prisma.Decimal | null;
      taxRateSource: string;
      pricingFactStatus: string;
      precisionPolicy: string;
      taxInclusiveAmountCents: bigint | null;
      taxExclusiveAmountCents: bigint | null;
      taxAmountCents: bigint | null;
      isProvisional: boolean;
      settlementBasis: string | null;
      customData: Prisma.JsonValue;
    },
    data: ReturnType<ContractBillService["batchRowData"]>
  ) {
    const decimalEquals = (left: Prisma.Decimal | null, right: string | null) =>
      left === null ? right === null : right !== null && left.eq(new Prisma.Decimal(right));
    return (
      existing.sortOrder !== data.sortOrder ||
      existing.itemCode !== data.itemCode ||
      existing.itemName !== data.itemName ||
      existing.specification !== data.specification ||
      existing.unit !== data.unit ||
      !decimalEquals(existing.quantity, data.quantity) ||
      !decimalEquals(existing.unitPrice, data.unitPrice) ||
      !decimalEquals(existing.taxRate, data.taxRate) ||
      existing.taxRateSource !== data.taxRateSource ||
      existing.pricingFactStatus !== data.pricingFactStatus ||
      existing.precisionPolicy !== data.precisionPolicy ||
      existing.taxInclusiveAmountCents !== data.taxInclusiveAmountCents ||
      existing.taxExclusiveAmountCents !== data.taxExclusiveAmountCents ||
      existing.taxAmountCents !== data.taxAmountCents ||
      existing.isProvisional !== data.isProvisional ||
      existing.settlementBasis !== data.settlementBasis ||
      stableJson(existing.customData) !== stableJson(data.customData)
    );
  }

  private parseRowInput(
    rawInput: unknown,
    bill: {
      pricingMode: string;
      schemaSnapshot: Prisma.JsonValue;
    },
    version: {
      pricingNature: string;
      amountLimitType: string;
      taxMode: string;
      defaultTaxRatePercent: Prisma.Decimal | null;
    },
    existing?: {
      quantity: Prisma.Decimal | null;
      unitPrice: Prisma.Decimal | null;
      taxRate: Prisma.Decimal | null;
      taxRateSource: string;
      pricingFactStatus: string;
      precisionPolicy: string;
      taxInclusiveAmountCents: bigint | null;
      taxExclusiveAmountCents: bigint | null;
      taxAmountCents: bigint | null;
    }
  ): SaveBillRowDto & {
    facts: ReturnType<typeof resolveContractBillRowFacts>;
  } {
    const input = this.requireObject(rawInput, "合同清单行提交内容");
    this.assertExpectedRevision(input.expectedBillRevision);
    this.assertRequiredString(input.itemName, "项目名称");
    this.assertRequiredString(input.unit, "单位");
    this.assertOptionalString(input.itemCode, "项目编号");
    this.assertOptionalString(input.specification, "规格型号");
    this.assertOptionalString(input.settlementBasis, "结算依据");
    if (input.quantity !== undefined && typeof input.quantity !== "string") {
      throw new BadRequestException("数量必须是文本数字");
    }
    if (typeof input.unitPrice !== "string") {
      throw new BadRequestException("含税单价不能为空");
    }
    if (input.taxRatePercent !== undefined && typeof input.taxRatePercent !== "string") {
      throw new BadRequestException("税率必须是文本数字");
    }
    if (
      input.taxRateSource !== undefined &&
      input.taxRateSource !== "version_default" &&
      input.taxRateSource !== "row_override"
    ) {
      throw new BadRequestException("税率来源无效");
    }
    if (input.isProvisional !== undefined && typeof input.isProvisional !== "boolean") {
      throw new BadRequestException("是否暂定必须为布尔值");
    }
    if (!this.isPlainObject(input.customData)) {
      throw new BadRequestException("自定义字段数据必须是普通对象");
    }
    const customData = this.toJson(input.customData) as Record<string, unknown>;
    const facts = resolveContractBillRowFacts(
      {
        ...(input.quantity === undefined ? {} : { quantity: input.quantity as string }),
        unitPrice: input.unitPrice,
        ...(input.taxRatePercent === undefined
          ? {}
          : { taxRatePercent: input.taxRatePercent as string }),
        ...(input.taxRateSource === undefined
          ? {}
          : {
              taxRateSource: input.taxRateSource as
                | "version_default"
                | "row_override"
            })
      },
      {
        pricingMode: bill.pricingMode,
        pricingNature: version.pricingNature,
        amountLimitType: version.amountLimitType,
        taxMode: version.taxMode,
        defaultTaxRatePercent: version.defaultTaxRatePercent
      },
      existing
    );
    const columns = this.schemaColumns(bill.schemaSnapshot);
    for (const column of columns) {
      const value = customData[column.key];
      const blank =
        value === undefined ||
        value === null ||
        value === "" ||
        (typeof value === "string" && !value.trim());
      if (column.required && blank) {
        throw new ContractBillRowInputValidationException(
          column.key,
          `必填自定义字段未填写：${column.key}`
        );
      }
      if (column.type === "boolean") {
        if (blank) {
          delete customData[column.key];
          continue;
        }
        const normalized = normalizeContractBillBoolean(value);
        if (normalized === null) {
          throw new ContractBillRowInputValidationException(
            column.key,
            `自定义字段“${column.label}”必须选择“是”或“否”`
          );
        }
        customData[column.key] = normalized;
      }
    }
    return {
      expectedBillRevision: input.expectedBillRevision as number,
      itemName: input.itemName as string,
      unit: input.unit as string,
      ...(input.quantity === undefined ? {} : { quantity: input.quantity as string }),
      unitPrice: input.unitPrice as string,
      ...(input.taxRatePercent === undefined
        ? {}
        : { taxRatePercent: input.taxRatePercent as string }),
      ...(input.taxRateSource === undefined
        ? {}
        : {
            taxRateSource: input.taxRateSource as
              | "version_default"
              | "row_override"
          }),
      customData,
      facts,
      ...(input.itemCode === undefined ? {} : { itemCode: input.itemCode as string }),
      ...(input.specification === undefined
        ? {}
        : { specification: input.specification as string }),
      ...(input.isProvisional === undefined
        ? {}
        : { isProvisional: input.isProvisional as boolean }),
      ...(input.settlementBasis === undefined
        ? {}
        : { settlementBasis: input.settlementBasis as string })
    };
  }

  private parseReorderInput(rawInput: unknown): ReorderBillRowsDto {
    const input = this.requireObject(rawInput, "合同清单排序提交内容");
    this.assertExpectedRevision(input.expectedBillRevision);
    if (
      !Array.isArray(input.rowKeys) ||
      input.rowKeys.some((key) => typeof key !== "string" || !key)
    ) {
      throw new BadRequestException("排序行标识必须是非空字符串数组");
    }
    return {
      expectedBillRevision: input.expectedBillRevision as number,
      rowKeys: input.rowKeys as string[]
    };
  }

  private schemaColumns(value: Prisma.JsonValue) {
    if (!this.isPlainObject(value) || !Array.isArray(value.columns)) {
      throw new BadRequestException("合同清单字段结构无效");
    }
    return value.columns.map((value, index) => {
      if (
        !this.isPlainObject(value) ||
        typeof value.key !== "string" ||
        !value.key.trim() ||
        (value.label !== undefined && typeof value.label !== "string") ||
        (value.type !== undefined && typeof value.type !== "string") ||
        (value.required !== undefined && typeof value.required !== "boolean")
      ) {
        throw new BadRequestException(`合同清单第 ${index + 1} 个字段定义无效`);
      }
      return {
        key: value.key,
        label: typeof value.label === "string" && value.label.trim()
          ? value.label.trim()
          : value.key,
        type: typeof value.type === "string" ? value.type : "text",
        required: value.required === true
      };
    }).filter((column) => isContractBillCustomColumn(column.key));
  }

  private assertExpectedRevision(value: unknown) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException("清单版本号必须为正整数");
    }
  }

  private assertRequiredString(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(`${field}不能为空`);
    }
  }

  private assertOptionalString(value: unknown, field: string) {
    if (value !== undefined && typeof value !== "string") {
      throw new BadRequestException(`${field}必须是文本`);
    }
  }

  private requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!this.isPlainObject(value)) {
      throw new BadRequestException(`${label}必须是对象`);
    }
    return value;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error("not JSON");
      return JSON.parse(serialized) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException("自定义字段数据包含无法保存的内容");
    }
  }

  private toReadModel<T>(value: T): T {
    return this.convertReadValue(value) as T;
  }

  private convertReadValue(value: unknown): unknown {
    if (typeof value === "bigint") return moneyCentsToApi(value);
    if (value instanceof Prisma.Decimal) return value.toString();
    if (Array.isArray(value)) return value.map((item) => this.convertReadValue(item));
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.convertReadValue(item)])
      );
    }
    return value;
  }
}
