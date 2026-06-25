import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { calculateBillRow, centsToSafeNumber } from "../money/decimal-money";
import { recalculateBillAndContractAmount } from "./contract-bill-totals";
import { EDITABLE_STATUSES, loadOwnedEditableBill } from "./contract-bill-guards";
import type {
  ReorderBillRowsDto,
  SaveBillRowDto
} from "./dto/contract-bill.dto";

const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

@Injectable()
export class ContractBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  addRow(billId: string, actorUserId: string, rawInput: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
      const input = this.parseRowInput(rawInput, bill);
      await this.lockMutation(tx, bill, version, actorUserId, input.expectedBillRevision);
      const amounts = calculateBillRow({
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        taxRatePercent: input.taxRatePercent,
        pricingMode: bill.pricingMode as "tax_inclusive" | "tax_exclusive"
      });
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
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          taxRate: input.taxRatePercent,
          ...amounts,
          isProvisional: input.isProvisional ?? false,
          settlementBasis: input.settlementBasis?.trim() || null,
          customData: this.toJson(input.customData)
        }
      });
      return this.finishMutation(tx, bill, version, actorUserId, "create", row.rowKey);
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
      const input = this.parseRowInput(rawInput, bill);
      const row = await this.findRow(tx, billId, rowKey);
      await this.lockMutation(tx, bill, version, actorUserId, input.expectedBillRevision);
      const amounts = calculateBillRow({
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        taxRatePercent: input.taxRatePercent,
        pricingMode: bill.pricingMode as "tax_inclusive" | "tax_exclusive"
      });
      const updated = await tx.contractBillRow.updateMany({
        where: { id: row.id, contractBillId: billId, rowKey },
        data: {
          itemCode: input.itemCode?.trim() || null,
          itemName: input.itemName.trim(),
          specification: input.specification?.trim() || null,
          unit: input.unit.trim(),
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          taxRate: input.taxRatePercent,
          ...amounts,
          isProvisional: input.isProvisional ?? false,
          settlementBasis: input.settlementBasis?.trim() || null,
          customData: this.toJson(input.customData)
        }
      });
      if (updated.count !== 1) throw new NotFoundException("Contract bill row not found");
      return this.finishMutation(tx, bill, version, actorUserId, "update", rowKey);
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
      await this.findRow(tx, billId, rowKey);
      await this.lockMutation(tx, bill, version, actorUserId, expectedBillRevision);
      const deleted = await tx.contractBillRow.deleteMany({
        where: { contractBillId: billId, rowKey }
      });
      if (deleted.count !== 1) throw new NotFoundException("Contract bill row not found");
      return this.finishMutation(tx, bill, version, actorUserId, "delete", rowKey);
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
          "rowKeys must exactly match the current bill row set"
        );
      }
      await this.lockMutation(
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
      return this.finishMutation(tx, bill, version, actorUserId, "reorder", null);
    });
  }

  private async lockMutation(
    tx: Prisma.TransactionClient,
    bill: { id: string; contractVersionId: string },
    version: { id: string; contractId: string },
    actorUserId: string,
    expectedBillRevision: number
  ) {
    this.assertExpectedRevision(expectedBillRevision);
    const versionGate = await tx.contractVersion.updateMany({
      where: { id: version.id, status: { in: EDITABLE_STATUSES } },
      data: { draftRevision: { increment: 0 } }
    });
    const ownerGate = await tx.contract.updateMany({
      where: {
        id: version.contractId,
        ownerUserId: actorUserId,
        voidedAt: null
      },
      data: { ownerUserId: actorUserId }
    });
    if (versionGate.count !== 1 || ownerGate.count !== 1) {
      throw new BadRequestException("Contract bill revision/status conflict");
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
      throw new BadRequestException("Contract bill revision/status conflict");
    }
  }

  private async finishMutation(
    tx: Prisma.TransactionClient,
    bill: { id: string; contractVersionId: string },
    version: { id: string; amountSource: string },
    actorUserId: string,
    action: "create" | "update" | "delete" | "reorder",
    rowKey: string | null
  ) {
    const rows = await recalculateBillAndContractAmount(tx, bill, version);
    await this.audit.record(tx, {
      actorUserId,
      action: `contract.bill.row.${action}`,
      businessType: "contract_bill",
      businessId: bill.id,
      metadata: { rowKey }
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
    if (!row) throw new NotFoundException("Contract bill row not found");
    return row;
  }

  private parseRowInput(
    rawInput: unknown,
    bill: {
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot: Prisma.JsonValue;
    }
  ): SaveBillRowDto {
    const input = this.requireObject(rawInput, "Contract bill row body");
    this.assertExpectedRevision(input.expectedBillRevision);
    this.assertRequiredString(input.itemName, "itemName");
    this.assertRequiredString(input.unit, "unit");
    this.assertOptionalString(input.itemCode, "itemCode");
    this.assertOptionalString(input.specification, "specification");
    this.assertOptionalString(input.settlementBasis, "settlementBasis");
    this.assertDecimal(input.quantity, "quantity", bill.quantityScale, 18);
    this.assertDecimal(input.unitPrice, "unitPrice", bill.unitPriceScale, 18);
    this.assertDecimal(input.taxRatePercent, "taxRatePercent", 6, 3);
    if (new Prisma.Decimal(input.taxRatePercent as string).gt(100)) {
      throw new BadRequestException("taxRatePercent must be between 0 and 100");
    }
    if (input.isProvisional !== undefined && typeof input.isProvisional !== "boolean") {
      throw new BadRequestException("isProvisional must be a boolean");
    }
    if (!this.isPlainObject(input.customData)) {
      throw new BadRequestException("customData must be a plain object");
    }
    const customData = this.toJson(input.customData) as Record<string, unknown>;
    const columns = this.schemaColumns(bill.schemaSnapshot);
    for (const column of columns) {
      const value = customData[column.key];
      if (
        column.required &&
        (value === undefined ||
          value === null ||
          value === "" ||
          (typeof value === "string" && !value.trim()))
      ) {
        throw new BadRequestException(`Required custom column is missing: ${column.key}`);
      }
    }
    return {
      expectedBillRevision: input.expectedBillRevision as number,
      itemName: input.itemName as string,
      unit: input.unit as string,
      quantity: input.quantity as string,
      unitPrice: input.unitPrice as string,
      taxRatePercent: input.taxRatePercent as string,
      customData,
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
    const input = this.requireObject(rawInput, "Reorder bill rows body");
    this.assertExpectedRevision(input.expectedBillRevision);
    if (
      !Array.isArray(input.rowKeys) ||
      input.rowKeys.some((key) => typeof key !== "string" || !key)
    ) {
      throw new BadRequestException("rowKeys must be an array of non-empty strings");
    }
    return {
      expectedBillRevision: input.expectedBillRevision as number,
      rowKeys: input.rowKeys as string[]
    };
  }

  private schemaColumns(value: Prisma.JsonValue) {
    if (!this.isPlainObject(value) || !Array.isArray(value.columns)) {
      throw new BadRequestException("Contract bill schema snapshot is invalid");
    }
    return value.columns.map((value, index) => {
      if (
        !this.isPlainObject(value) ||
        typeof value.key !== "string" ||
        !value.key.trim() ||
        (value.required !== undefined && typeof value.required !== "boolean")
      ) {
        throw new BadRequestException(`Contract bill schema column ${index} is invalid`);
      }
      return { key: value.key, required: value.required === true };
    });
  }

  private assertExpectedRevision(value: unknown) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException("expectedBillRevision must be a positive integer");
    }
  }

  private assertDecimal(
    value: unknown,
    field: string,
    scale: number,
    integerDigits: number
  ) {
    if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
      throw new BadRequestException(
        `${field} must be a canonical non-negative decimal string`
      );
    }
    const [integer, fraction = ""] = value.split(".");
    if (integer.length > integerDigits) {
      throw new BadRequestException(`${field} exceeds database precision`);
    }
    if (fraction.length > scale) {
      throw new BadRequestException(`${field} exceeds scale ${scale}`);
    }
  }

  private assertRequiredString(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
  }

  private assertOptionalString(value: unknown, field: string) {
    if (value !== undefined && typeof value !== "string") {
      throw new BadRequestException(`${field} must be a string`);
    }
  }

  private requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!this.isPlainObject(value)) {
      throw new BadRequestException(`${label} must be an object`);
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
      throw new BadRequestException("customData must contain JSON-safe values");
    }
  }

  private toReadModel<T>(value: T): T {
    return this.convertReadValue(value) as T;
  }

  private convertReadValue(value: unknown): unknown {
    if (typeof value === "bigint") return centsToSafeNumber(value);
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
