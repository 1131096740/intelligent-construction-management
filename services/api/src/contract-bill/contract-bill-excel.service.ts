import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import type { Cell, Row, Worksheet } from "exceljs";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { calculateBillRow, centsToSafeNumber } from "../money/decimal-money";
import { recalculateBillAndContractAmount } from "./contract-bill-totals";

const EDITABLE_STATUSES = ["draft", "approval_rejected"];
const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const DATA_SHEET = "清单数据";
const INSTRUCTION_SHEET = "填写说明";
const ROW_KEY_CODE = "__rowKey";
const HEADER_ROWS = 2;

export type ImportMode = "replace" | "update" | "append";

export interface ContractBillExcelImportDto {
  fileId: string;
  mode: ImportMode;
}

interface CoreFieldDef {
  code: string;
  label: string;
  required: boolean;
}

// 固定核心字段（字段码与行 CRUD 字段一致），顺序即导出列顺序。
const CORE_FIELDS: CoreFieldDef[] = [
  { code: "itemCode", label: "项目编号", required: false },
  { code: "itemName", label: "项目名称", required: true },
  { code: "specification", label: "规格型号", required: false },
  { code: "unit", label: "单位", required: true },
  { code: "quantity", label: "数量", required: true },
  { code: "unitPrice", label: "单价(元)", required: true },
  { code: "taxRatePercent", label: "税率(%)", required: true },
  { code: "isProvisional", label: "是否暂定", required: false },
  { code: "settlementBasis", label: "结算依据", required: false }
];

export interface PreviewError {
  sheet: string;
  row: number;
  column: string;
  message: string;
}

export interface PreviewRowChange {
  action: "add" | "update" | "remove" | "skip";
  rowKey?: string;
  values: unknown;
}

export interface BillImportPreview {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  beforeAmountCents: number;
  afterAmountCents: number;
  rows: PreviewRowChange[];
  errors: PreviewError[];
}

// 行计算后产生的可落库数据（金额为分，BigInt）。
interface ResolvedRow {
  rowKey: string;
  sortOrder: number;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  isProvisional: boolean;
  settlementBasis: string | null;
  customData: Prisma.InputJsonValue;
  taxInclusiveAmountCents: bigint;
  taxExclusiveAmountCents: bigint;
  taxAmountCents: bigint;
}

@Injectable()
export class ContractBillExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService
  ) {}

  async exportTemplate(billId: string, actorUserId: string) {
    const { bill } = await this.prisma.$transaction((tx) =>
      this.loadOwnedEditableBill(tx, billId, actorUserId)
    );
    const columns = this.templateColumns(bill);
    const workbook = new ExcelJS.Workbook();

    const instructions = workbook.addWorksheet(INSTRUCTION_SHEET);
    instructions.addRow(["合同清单导入模板填写说明"]);
    instructions.addRow(["1. 仅在『清单数据』工作表中填写，第 1、2 行为表头，请勿修改。"]);
    instructions.addRow(["2. 第 2 行为字段代码，导入时以字段代码为准。"]);
    instructions.addRow(["3. 数量、单价、税率请填写数字；含公式时以原始填写值为准。"]);
    instructions.addRow([`4. __rowKey 列为系统内部列（已隐藏），更新模式下请勿改动。`]);
    instructions.getColumn(1).width = 80;

    const sheet = workbook.addWorksheet(DATA_SHEET);
    sheet.addRow(columns.map((column) => column.label));
    sheet.addRow(columns.map((column) => column.code));
    sheet.views = [{ state: "frozen", ySplit: HEADER_ROWS }];

    const quantityFormat = this.numberFormat(bill.quantityScale);
    const unitPriceFormat = this.numberFormat(bill.unitPriceScale);
    columns.forEach((column, index) => {
      const sheetColumn = sheet.getColumn(index + 1);
      sheetColumn.width = 18;
      if (column.code === ROW_KEY_CODE) {
        sheetColumn.hidden = true;
      } else if (column.code === "quantity") {
        sheetColumn.numFmt = quantityFormat;
      } else if (column.code === "unitPrice") {
        sheetColumn.numFmt = unitPriceFormat;
      } else if (column.code === "taxRatePercent") {
        sheetColumn.numFmt = "0.######";
      }
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `${this.safeBillName(bill.name)}-清单导入模板.xlsx`
    };
  }

  async previewImport(
    billId: string,
    actorUserId: string,
    input: ContractBillExcelImportDto
  ): Promise<BillImportPreview & { importId: string }> {
    const { fileId, mode } = this.parseImportInput(input);

    return this.prisma.$transaction(async (tx) => {
      // loadOwnedEditableBill 同时完成 owner + 可编辑状态校验；preview 不改动任何金额或行。
      const { bill } = await this.loadOwnedEditableBill(tx, billId, actorUserId);
      const buffer = (await this.files.getFileBuffer(fileId)).buffer;
      const existingRows = await tx.contractBillRow.findMany({
        where: { contractBillId: bill.id },
        orderBy: { sortOrder: "asc" }
      });
      const preview = await this.buildPreview(bill, mode, buffer, existingRows);

      const record = await tx.contractBillImport.create({
        data: {
          contractBillId: bill.id,
          fileId,
          mode,
          status: "preview",
          preview: this.toJson(preview),
          createdByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.bill.import.preview",
        businessType: "contract_bill_import",
        businessId: record.id,
        metadata: {
          contractBillId: bill.id,
          mode,
          added: preview.added,
          updated: preview.updated,
          removed: preview.removed,
          errors: preview.errors.length
        }
      });

      return { importId: record.id, ...preview };
    });
  }

  async applyImport(importId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.contractBillImport.findUnique({ where: { id: importId } });
      if (!record) throw new NotFoundException("Contract bill import not found");
      if (record.status === "applied") {
        throw new BadRequestException("Contract bill import already applied");
      }
      if (record.status !== "preview") {
        throw new BadRequestException("Contract bill import is not in a previewable state");
      }
      if (record.createdByUserId !== actorUserId) {
        throw new ForbiddenException("Only the import creator may apply it");
      }

      const preview = this.parseStoredPreview(record.preview);
      if (preview.errors.length > 0) {
        throw new BadRequestException("Contract bill import preview contains errors");
      }

      const { bill, version } = await this.loadOwnedEditableBill(
        tx,
        record.contractBillId,
        actorUserId
      );
      const buffer = (await this.files.getFileBuffer(record.fileId)).buffer;
      const existingRows = await tx.contractBillRow.findMany({
        where: { contractBillId: bill.id },
        orderBy: { sortOrder: "asc" }
      });
      // 重新解析以拿到可落库的精确金额；同时再次校验，拒绝中途被改动的文件。
      const plan = await this.buildResolvedPlan(
        bill,
        record.mode as ImportMode,
        buffer,
        existingRows
      );
      if (plan.errors.length > 0) {
        throw new BadRequestException("Contract bill import preview contains errors");
      }

      await this.lockBillRevision(tx, bill, version, actorUserId);

      for (const rowKey of plan.removeKeys) {
        await tx.contractBillRow.deleteMany({
          where: { contractBillId: bill.id, rowKey }
        });
      }
      for (const row of plan.updates) {
        await tx.contractBillRow.updateMany({
          where: { contractBillId: bill.id, rowKey: row.rowKey },
          data: this.toRowData(row)
        });
      }
      let sortOrder = await tx.contractBillRow.count({ where: { contractBillId: bill.id } });
      for (const row of plan.adds) {
        await tx.contractBillRow.create({
          data: {
            contractBillId: bill.id,
            rowKey: row.rowKey,
            sortOrder: sortOrder++,
            ...this.toRowData(row)
          }
        });
      }

      await recalculateBillAndContractAmount(tx, bill, version);

      const applied = await tx.contractBillImport.updateMany({
        where: { id: record.id, status: "preview" },
        data: {
          status: "applied",
          appliedByUserId: actorUserId,
          appliedAt: new Date()
        }
      });
      if (applied.count !== 1) {
        throw new BadRequestException("Contract bill import already applied");
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.bill.import.apply",
        businessType: "contract_bill_import",
        businessId: record.id,
        metadata: {
          contractBillId: bill.id,
          mode: record.mode,
          added: plan.adds.length,
          updated: plan.updates.length,
          removed: plan.removeKeys.length
        }
      });

      const updatedBill = await tx.contractBill.findUnique({ where: { id: bill.id } });
      const rows = await tx.contractBillRow.findMany({
        where: { contractBillId: bill.id },
        orderBy: { sortOrder: "asc" }
      });
      return this.toReadModel({ importId: record.id, bill: updatedBill, rows });
    });
  }

  // ── Parsing & validation ──────────────────────────────────────────────

  private async buildPreview(
    bill: BillContext,
    mode: ImportMode,
    buffer: Buffer,
    existingRows: ExistingRow[]
  ): Promise<BillImportPreview> {
    const plan = await this.buildResolvedPlan(bill, mode, buffer, existingRows);
    const beforeAmountCents = existingRows.reduce(
      (sum, row) => sum + row.taxInclusiveAmountCents,
      0n
    );
    const removeKeys = new Set(plan.removeKeys);
    const updateByKey = new Map(plan.updates.map((row) => [row.rowKey, row]));
    let afterAmountCents = 0n;
    for (const row of existingRows) {
      if (removeKeys.has(row.rowKey)) continue;
      const update = updateByKey.get(row.rowKey);
      afterAmountCents += update
        ? update.taxInclusiveAmountCents
        : row.taxInclusiveAmountCents;
    }
    for (const row of plan.adds) afterAmountCents += row.taxInclusiveAmountCents;

    return {
      added: plan.adds.length,
      updated: plan.updates.length,
      removed: plan.removeKeys.length,
      skipped: plan.skipped,
      beforeAmountCents: centsToSafeNumber(beforeAmountCents),
      afterAmountCents: centsToSafeNumber(afterAmountCents),
      rows: plan.previewRows,
      errors: plan.errors
    };
  }

  private async buildResolvedPlan(
    bill: BillContext,
    mode: ImportMode,
    buffer: Buffer,
    existingRows: ExistingRow[]
  ): Promise<ResolvedPlan> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(DATA_SHEET);
    if (!sheet) {
      throw new BadRequestException(`Missing worksheet: ${DATA_SHEET}`);
    }

    const errors: PreviewError[] = [];
    const previewRows: PreviewRowChange[] = [];
    const adds: ResolvedRow[] = [];
    const updates: ResolvedRow[] = [];
    let skipped = 0;

    const codes = this.readFieldCodes(sheet);
    const codeIndex = new Map(codes.map((code, index) => [code, index + 1]));
    const columnDefs = this.templateColumns(bill);
    const customColumns = this.schemaColumns(bill.schemaSnapshot);

    const seenKeys = new Set<string>();
    const sheetKeys = new Set<string>();

    sheet.eachRow((excelRow: Row, rowNumber: number) => {
      if (rowNumber <= HEADER_ROWS) return;
      if (this.isBlankRow(excelRow, codes.length)) return;

      const rowErrorsBefore = errors.length;
      this.assertNoMergedCells(sheet, rowNumber, codes.length, errors);

      const raw: Record<string, unknown> = {};
      for (const def of columnDefs) {
        if (def.code === ROW_KEY_CODE) continue;
        const column = codeIndex.get(def.code);
        raw[def.code] = column ? this.rawCellText(excelRow.getCell(column)) : "";
      }
      const rowKeyColumn = codeIndex.get(ROW_KEY_CODE);
      const sheetRowKey = rowKeyColumn
        ? this.rawCellText(excelRow.getCell(rowKeyColumn))
        : "";

      const resolved = this.resolveRow(
        bill,
        raw,
        customColumns,
        rowNumber,
        errors
      );

      if (errors.length !== rowErrorsBefore || !resolved) {
        const values = { ...raw, ...(sheetRowKey ? { __rowKey: sheetRowKey } : {}) };
        previewRows.push({ action: "skip", rowKey: sheetRowKey || undefined, values });
        skipped += 1;
        return;
      }

      if (mode === "update") {
        if (!sheetRowKey) {
          errors.push({
            sheet: DATA_SHEET,
            row: rowNumber,
            column: ROW_KEY_CODE,
            message: "update mode requires __rowKey"
          });
          previewRows.push({ action: "skip", values: raw });
          skipped += 1;
          return;
        }
        const existing = existingRows.find((row) => row.rowKey === sheetRowKey);
        if (!existing) {
          errors.push({
            sheet: DATA_SHEET,
            row: rowNumber,
            column: ROW_KEY_CODE,
            message: `__rowKey not found in bill: ${sheetRowKey}`
          });
          previewRows.push({ action: "skip", rowKey: sheetRowKey, values: raw });
          skipped += 1;
          return;
        }
        if (seenKeys.has(sheetRowKey)) {
          errors.push({
            sheet: DATA_SHEET,
            row: rowNumber,
            column: ROW_KEY_CODE,
            message: `duplicate __rowKey: ${sheetRowKey}`
          });
          previewRows.push({ action: "skip", rowKey: sheetRowKey, values: raw });
          skipped += 1;
          return;
        }
        seenKeys.add(sheetRowKey);
        sheetKeys.add(sheetRowKey);
        resolved.rowKey = sheetRowKey;
        updates.push(resolved);
        previewRows.push({ action: "update", rowKey: sheetRowKey, values: raw });
        return;
      }

      // append / replace：忽略表内 __rowKey，始终新建行。
      resolved.rowKey = randomUUID();
      adds.push(resolved);
      previewRows.push({ action: "add", values: raw });
    });

    const removeKeys: string[] = [];
    if (mode === "replace") {
      for (const row of existingRows) {
        removeKeys.push(row.rowKey);
        previewRows.push({ action: "remove", rowKey: row.rowKey, values: null });
      }
    }

    return { adds, updates, removeKeys, skipped, errors, previewRows };
  }

  private resolveRow(
    bill: BillContext,
    raw: Record<string, unknown>,
    customColumns: Array<{ key: string; required: boolean }>,
    rowNumber: number,
    errors: PreviewError[]
  ): ResolvedRow | null {
    const before = errors.length;
    const itemName = this.asString(raw.itemName);
    const unit = this.asString(raw.unit);
    if (!itemName) {
      errors.push(this.fieldError(rowNumber, "itemName", "itemName is required"));
    }
    if (!unit) {
      errors.push(this.fieldError(rowNumber, "unit", "unit is required"));
    }

    const quantity = this.asString(raw.quantity);
    const unitPrice = this.asString(raw.unitPrice);
    const taxRatePercent = this.asString(raw.taxRatePercent);
    this.validateDecimal(quantity, "quantity", bill.quantityScale, 18, rowNumber, errors);
    this.validateDecimal(unitPrice, "unitPrice", bill.unitPriceScale, 18, rowNumber, errors);
    this.validateDecimal(taxRatePercent, "taxRatePercent", 6, 3, rowNumber, errors);
    if (CANONICAL_DECIMAL.test(taxRatePercent) && new Prisma.Decimal(taxRatePercent).gt(100)) {
      errors.push(
        this.fieldError(rowNumber, "taxRatePercent", "taxRatePercent must be between 0 and 100")
      );
    }

    const isProvisional = this.parseBoolean(raw.isProvisional, rowNumber, errors);

    const customData: Record<string, unknown> = {};
    for (const column of customColumns) {
      const value = this.asString(raw[column.key]);
      if (value) customData[column.key] = value;
      if (column.required && !value) {
        errors.push(
          this.fieldError(rowNumber, column.key, `Required custom column is missing: ${column.key}`)
        );
      }
    }

    if (errors.length !== before) return null;

    const amounts = calculateBillRow({
      quantity,
      unitPrice,
      taxRatePercent,
      pricingMode: bill.pricingMode
    });

    return {
      rowKey: randomUUID(),
      sortOrder: 0,
      itemCode: this.asString(raw.itemCode) || null,
      itemName,
      specification: this.asString(raw.specification) || null,
      unit,
      quantity,
      unitPrice,
      taxRatePercent,
      isProvisional,
      settlementBasis: this.asString(raw.settlementBasis) || null,
      customData: this.toJson(customData),
      ...amounts
    };
  }

  private toRowData(row: ResolvedRow) {
    return {
      itemCode: row.itemCode,
      itemName: row.itemName,
      specification: row.specification,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      taxRate: row.taxRatePercent,
      taxInclusiveAmountCents: row.taxInclusiveAmountCents,
      taxExclusiveAmountCents: row.taxExclusiveAmountCents,
      taxAmountCents: row.taxAmountCents,
      isProvisional: row.isProvisional,
      settlementBasis: row.settlementBasis,
      customData: row.customData
    };
  }

  // ── Excel cell helpers ────────────────────────────────────────────────

  // 读取单元格原始文本：忽略公式缓存结果，对货币字段只取用户填写的原始值。
  private rawCellText(cell: Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return this.numberToPlainString(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
      const record = value as unknown as Record<string, unknown>;
      // 公式单元格：以原始公式文本判断，绝不采用 result 缓存。
      if ("formula" in record || "sharedFormula" in record) {
        const formula = record.formula ?? record.sharedFormula;
        return this.formulaToValue(typeof formula === "string" ? formula : "");
      }
      if ("richText" in record && Array.isArray(record.richText)) {
        return record.richText
          .map((part) => String((part as { text?: unknown }).text ?? ""))
          .join("")
          .trim();
      }
      if ("text" in record) return String(record.text).trim();
      if ("result" in record) {
        // 仅 hyperlink 等非公式对象，安全回退到 text/result 之外不取值。
        return "";
      }
    }
    return String(value).trim();
  }

  // 公式只接受由数字常量 + 四则运算（+ - * /）与括号组成的常量表达式，使用 Decimal 精确求值，
  // 缓存的 result 一律忽略。引用其它单元格（字母）的公式视为非法货币输入，返回原文触发校验失败。
  private formulaToValue(formula: string): string {
    const expression = formula.trim();
    if (!expression) return "";
    if (!/^[0-9.+\-*/()\s]+$/.test(expression)) return expression;
    try {
      const value = this.evaluateDecimalExpression(expression);
      if (value.isNeg() || !value.isFinite()) return expression;
      return value.toFixed();
    } catch {
      return expression;
    }
  }

  // 极小的递归下降解析器：仅识别非负十进制常量与 + - * / 及括号，全程 Decimal 精确运算。
  private evaluateDecimalExpression(expression: string): Prisma.Decimal {
    const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/()]/g) ?? [];
    if (tokens.join("") !== expression.replace(/\s+/g, "")) {
      throw new Error("invalid expression");
    }
    let position = 0;
    const peek = () => tokens[position];
    const next = () => tokens[position++];

    const parseExpression = (): Prisma.Decimal => {
      let value = parseTerm();
      while (peek() === "+" || peek() === "-") {
        const operator = next();
        const right = parseTerm();
        value = operator === "+" ? value.add(right) : value.sub(right);
      }
      return value;
    };
    const parseTerm = (): Prisma.Decimal => {
      let value = parseFactor();
      while (peek() === "*" || peek() === "/") {
        const operator = next();
        const right = parseFactor();
        value = operator === "*" ? value.mul(right) : value.div(right);
      }
      return value;
    };
    const parseFactor = (): Prisma.Decimal => {
      const token = next();
      if (token === "(") {
        const value = parseExpression();
        if (next() !== ")") throw new Error("unbalanced parentheses");
        return value;
      }
      if (token === undefined || !/^\d+(?:\.\d+)?$/.test(token)) {
        throw new Error("unexpected token");
      }
      return new Prisma.Decimal(token);
    };

    const result = parseExpression();
    if (position !== tokens.length) throw new Error("trailing tokens");
    return result;
  }

  private numberToPlainString(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    // 避免科学计数法；ExcelJS 数字单元格本身保留十进制。
    const text = value.toString();
    return text.includes("e") || text.includes("E") ? this.expand(value) : text;
  }

  private expand(value: number): string {
    return value.toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: 20
    });
  }

  private isBlankRow(row: Row, columnCount: number): boolean {
    for (let column = 1; column <= columnCount; column += 1) {
      if (this.rawCellText(row.getCell(column))) return false;
    }
    return true;
  }

  private assertNoMergedCells(
    sheet: Worksheet,
    rowNumber: number,
    columnCount: number,
    errors: PreviewError[]
  ) {
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      if (cell.isMerged) {
        errors.push({
          sheet: DATA_SHEET,
          row: rowNumber,
          column: this.columnLetter(column),
          message: "merged cells are not allowed in the data area"
        });
        return;
      }
    }
  }

  private readFieldCodes(sheet: Worksheet): string[] {
    const codeRow = sheet.getRow(HEADER_ROWS);
    const codes: string[] = [];
    codeRow.eachCell({ includeEmpty: true }, (cell: Cell, column: number) => {
      codes[column - 1] = String(cell.value ?? "").trim();
    });
    return codes;
  }

  // ── Validation primitives ─────────────────────────────────────────────

  private validateDecimal(
    value: string,
    field: string,
    scale: number,
    integerDigits: number,
    rowNumber: number,
    errors: PreviewError[]
  ) {
    if (!CANONICAL_DECIMAL.test(value)) {
      errors.push(
        this.fieldError(rowNumber, field, `${field} must be a canonical non-negative decimal string`)
      );
      return;
    }
    const [integer, fraction = ""] = value.split(".");
    if (integer.length > integerDigits) {
      errors.push(this.fieldError(rowNumber, field, `${field} exceeds database precision`));
      return;
    }
    if (fraction.length > scale) {
      errors.push(this.fieldError(rowNumber, field, `${field} exceeds scale ${scale}`));
    }
  }

  private parseBoolean(value: unknown, rowNumber: number, errors: PreviewError[]): boolean {
    const text = this.asString(value).toLowerCase();
    if (!text) return false;
    if (["true", "1", "是", "y", "yes"].includes(text)) return true;
    if (["false", "0", "否", "n", "no"].includes(text)) return false;
    errors.push(this.fieldError(rowNumber, "isProvisional", "isProvisional must be a boolean"));
    return false;
  }

  private fieldError(rowNumber: number, column: string, message: string): PreviewError {
    return { sheet: DATA_SHEET, row: rowNumber, column, message };
  }

  private asString(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  // ── Shared loaders ────────────────────────────────────────────────────

  private async loadOwnedEditableBill(
    tx: Prisma.TransactionClient,
    billId: string,
    actorUserId: string
  ) {
    const bill = await tx.contractBill.findUnique({ where: { id: billId } });
    if (!bill) throw new NotFoundException("Contract bill not found");
    if (bill.pricingMode !== "tax_inclusive" && bill.pricingMode !== "tax_exclusive") {
      throw new BadRequestException("Contract bill pricing mode is invalid");
    }
    const version = await tx.contractVersion.findUnique({
      where: { id: bill.contractVersionId }
    });
    if (!version) throw new NotFoundException("Contract draft version not found");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("Contract draft not found");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Only the contract draft owner may edit");
    }
    if (!EDITABLE_STATUSES.includes(version.status)) {
      throw new BadRequestException("Contract draft is not editable");
    }
    if (contract.voidedAt) throw new BadRequestException("Contract draft is voided");
    return {
      bill: {
        id: bill.id,
        contractVersionId: bill.contractVersionId,
        revision: bill.revision,
        name: bill.name,
        pricingMode: bill.pricingMode as "tax_inclusive" | "tax_exclusive",
        quantityScale: bill.quantityScale,
        unitPriceScale: bill.unitPriceScale,
        schemaSnapshot: bill.schemaSnapshot
      },
      version: { id: version.id, contractId: version.contractId, amountSource: version.amountSource }
    };
  }

  private async lockBillRevision(
    tx: Prisma.TransactionClient,
    bill: { id: string; contractVersionId: string; revision: number },
    version: { id: string; contractId: string },
    actorUserId: string
  ) {
    const versionGate = await tx.contractVersion.updateMany({
      where: { id: version.id, status: { in: EDITABLE_STATUSES } },
      data: { draftRevision: { increment: 0 } }
    });
    const ownerGate = await tx.contract.updateMany({
      where: { id: version.contractId, ownerUserId: actorUserId, voidedAt: null },
      data: { ownerUserId: actorUserId }
    });
    if (versionGate.count !== 1 || ownerGate.count !== 1) {
      throw new BadRequestException("Contract bill revision/status conflict");
    }
    const billGate = await tx.contractBill.updateMany({
      where: {
        id: bill.id,
        contractVersionId: bill.contractVersionId,
        revision: bill.revision
      },
      data: { revision: { increment: 1 } }
    });
    if (billGate.count !== 1) {
      throw new BadRequestException("Contract bill revision/status conflict");
    }
  }

  // ── Column / schema helpers ──────────────────────────────────────────

  private templateColumns(bill: BillContext): CoreFieldDef[] {
    const custom = this.schemaColumns(bill.schemaSnapshot).map((column) => ({
      code: column.key,
      label: column.key,
      required: column.required
    }));
    return [...CORE_FIELDS, ...custom, { code: ROW_KEY_CODE, label: ROW_KEY_CODE, required: false }];
  }

  private schemaColumns(value: Prisma.JsonValue) {
    if (!this.isPlainObject(value) || !Array.isArray(value.columns)) {
      throw new BadRequestException("Contract bill schema snapshot is invalid");
    }
    return value.columns.map((column, index) => {
      if (
        !this.isPlainObject(column) ||
        typeof column.key !== "string" ||
        !column.key.trim() ||
        (column.required !== undefined && typeof column.required !== "boolean")
      ) {
        throw new BadRequestException(`Contract bill schema column ${index} is invalid`);
      }
      return { key: column.key, required: column.required === true };
    });
  }

  private numberFormat(scale: number): string {
    return scale > 0 ? `0.${"0".repeat(scale)}` : "0";
  }

  private columnLetter(column: number): string {
    let result = "";
    let value = column;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  private safeBillName(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "contract-bill";
  }

  private parseImportInput(input: ContractBillExcelImportDto): ContractBillExcelImportDto {
    if (!this.isPlainObject(input)) {
      throw new BadRequestException("Excel import body must be an object");
    }
    if (typeof input.fileId !== "string" || !input.fileId.trim()) {
      throw new BadRequestException("fileId must be a non-empty string");
    }
    if (input.mode !== "replace" && input.mode !== "update" && input.mode !== "append") {
      throw new BadRequestException("mode must be replace, update, or append");
    }
    return { fileId: input.fileId.trim(), mode: input.mode };
  }

  private parseStoredPreview(value: Prisma.JsonValue): BillImportPreview {
    if (!this.isPlainObject(value) || !Array.isArray(value.errors)) {
      throw new BadRequestException("Contract bill import preview is invalid");
    }
    return value as unknown as BillImportPreview;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    try {
      const serialized = JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? centsToSafeNumber(item) : item
      );
      if (serialized === undefined) throw new Error("not JSON");
      return JSON.parse(serialized) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException("Excel import produced non-JSON-safe values");
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

interface BillContext {
  id: string;
  contractVersionId: string;
  revision: number;
  name: string;
  pricingMode: "tax_inclusive" | "tax_exclusive";
  quantityScale: number;
  unitPriceScale: number;
  schemaSnapshot: Prisma.JsonValue;
}

interface ExistingRow {
  rowKey: string;
  taxInclusiveAmountCents: bigint;
}

interface ResolvedPlan {
  adds: ResolvedRow[];
  updates: ResolvedRow[];
  removeKeys: string[];
  skipped: number;
  errors: PreviewError[];
  previewRows: PreviewRowChange[];
}
