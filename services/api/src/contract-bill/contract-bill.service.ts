import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { bumpContractRenderInputRevision } from "../contract-workbench/contract-render-input-revision";
import { PrismaService } from "../database/prisma.service";
import { calculateBillRow, moneyCentsToApi } from "../money/decimal-money";
import { recalculateBillAndContractAmount } from "./contract-bill-totals";
import { loadOwnedEditableBill } from "./contract-bill-guards";
import type {
  ReorderBillRowsDto,
  SaveBillRowDto
} from "./dto/contract-bill.dto";

const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const COMPANY_UNIT_PRICE_SCALE = 2;

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
      const newRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        input.expectedBillRevision
      );
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
      const input = this.parseRowInput(rawInput, bill);
      const row = await this.findRow(tx, billId, rowKey);
      const newRevision = await this.lockMutation(
        tx,
        bill,
        version,
        actorUserId,
        input.expectedBillRevision
      );
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
      await this.findRow(tx, billId, rowKey);
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
    version: { id: string; amountSource: string },
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

  private parseRowInput(
    rawInput: unknown,
    bill: {
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot: Prisma.JsonValue;
    }
  ): SaveBillRowDto {
    const input = this.requireObject(rawInput, "合同清单行提交内容");
    this.assertExpectedRevision(input.expectedBillRevision);
    this.assertRequiredString(input.itemName, "项目名称");
    this.assertRequiredString(input.unit, "单位");
    this.assertOptionalString(input.itemCode, "项目编号");
    this.assertOptionalString(input.specification, "规格型号");
    this.assertOptionalString(input.settlementBasis, "结算依据");
    this.assertDecimal(input.quantity, "数量", bill.quantityScale, 18);
    this.assertDecimal(
      input.unitPrice,
      "单价",
      Math.min(bill.unitPriceScale, COMPANY_UNIT_PRICE_SCALE),
      18
    );
    this.assertDecimal(input.taxRatePercent, "税率", 6, 3);
    if (new Prisma.Decimal(input.taxRatePercent as string).gt(100)) {
      throw new BadRequestException("税率必须在 0 到 100 之间");
    }
    if (input.isProvisional !== undefined && typeof input.isProvisional !== "boolean") {
      throw new BadRequestException("是否暂定必须为布尔值");
    }
    if (!this.isPlainObject(input.customData)) {
      throw new BadRequestException("自定义字段数据必须是普通对象");
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
        throw new BadRequestException(`必填自定义字段未填写：${column.key}`);
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
        (value.required !== undefined && typeof value.required !== "boolean")
      ) {
        throw new BadRequestException(`合同清单第 ${index + 1} 个字段定义无效`);
      }
      return { key: value.key, required: value.required === true };
    });
  }

  private assertExpectedRevision(value: unknown) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException("清单版本号必须为正整数");
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
        `${field}必须是规范的非负数字`
      );
    }
    const [integer, fraction = ""] = value.split(".");
    if (integer.length > integerDigits) {
      throw new BadRequestException(`${field}整数位数不能超过 ${integerDigits} 位`);
    }
    if (fraction.length > scale) {
      throw new BadRequestException(`${field}小数位数不能超过 ${scale} 位`);
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
