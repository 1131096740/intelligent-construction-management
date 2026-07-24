import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isContractBillCustomColumn } from "@jiangkong/shared-domain";
import * as ExcelJS from "exceljs";
import type { Cell, Row, Worksheet } from "exceljs";
import { AuditService } from "../audit/audit.service";
import { bumpContractRenderInputRevision } from "../contract-workbench/contract-render-input-revision";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { moneyCentsToApi } from "../money/decimal-money";
import { resolveContractBillRowFacts } from "./contract-bill-row-rules";
import { recalculateBillAndContractAmount } from "./contract-bill-totals";
import { loadOwnedEditableBill } from "./contract-bill-guards";

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
  readonly?: boolean;
}

// 固定核心字段（字段码与行 CRUD 字段一致），顺序即导出列顺序。
const CORE_FIELDS: CoreFieldDef[] = [
  { code: "itemCode", label: "项目编号", required: false },
  { code: "itemName", label: "项目名称", required: true },
  { code: "specification", label: "规格型号", required: false },
  { code: "unit", label: "单位", required: true },
  { code: "quantity", label: "数量", required: true },
  { code: "unitPrice", label: "含税单价(元)", required: true },
  {
    code: "taxExclusiveUnitPrice",
    label: "不含税单价(元)",
    required: false,
    readonly: true
  },
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

export interface BillImportCandidateRow {
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource: "version_default" | "row_override";
  isProvisional: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface BillImportPreview {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  beforeAmountCents: string;
  afterAmountCents: string;
  rows: PreviewRowChange[];
  errors: PreviewError[];
  candidateRows: BillImportCandidateRow[];
}

interface StoredBillImportPreview {
  billRevision: number;
  preview: BillImportPreview;
}

// 行计算后产生的可落库数据（金额为分，BigInt）。
interface ResolvedRow {
  rowKey: string;
  sortOrder: number;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  quantity: string | null;
  unitPrice: string | null;
  taxRatePercent: string | null;
  taxRateSource: "version_default" | "row_override";
  pricingFactStatus: "confirmed" | "unconfirmed";
  precisionPolicy: "legacy" | "two_decimal";
  isProvisional: boolean;
  settlementBasis: string | null;
  customData: Prisma.InputJsonValue;
  taxInclusiveAmountCents: bigint | null;
  taxExclusiveAmountCents: bigint | null;
  taxAmountCents: bigint | null;
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
      this.loadBillContext(tx, billId, actorUserId)
    );
    const columns = this.templateColumns(bill);
    const workbook = new ExcelJS.Workbook();

    const instructions = workbook.addWorksheet(INSTRUCTION_SHEET);
    instructions.addRow(["合同清单导入模板填写说明"]);
    instructions.addRow(["1. 仅在『清单数据』工作表中填写，第 1 行为中文表头，请勿修改。"]);
    instructions.addRow(["2. 系统识别用字段行和内部列已隐藏，请不要取消隐藏或改动。"]);
    instructions.addRow(["3. 数量、含税单价最多保留 2 位小数；税率必须大于 0。"]);
    instructions.addRow(["4. 不含税单价为系统只读计算列，导入时不读取该列。"]);
    instructions.addRow([
      bill.taxMode === "single_rate"
        ? `5. 本合同默认税率为 ${bill.defaultTaxRatePercent?.toString() ?? "未明确"}%，税率留空时自动继承。`
        : "5. 多税率合同可在税率列填写例外税率；留空时继承合同默认税率。"
    ]);
    instructions.getColumn(1).width = 80;

    const sheet = workbook.addWorksheet(DATA_SHEET);
    sheet.addRow(columns.map((column) => column.label));
    sheet.addRow(columns.map((column) => column.code));
    sheet.addRow(
      columns.map((column) =>
        column.code === "taxRatePercent"
          ? (bill.defaultTaxRatePercent?.toString() ?? null)
          : null
      )
    );
    sheet.getRow(HEADER_ROWS).hidden = true;
    sheet.views = [{ state: "frozen", ySplit: HEADER_ROWS }];

    const quantityFormat = this.numberFormat(2);
    const unitPriceFormat = this.numberFormat(2);
    columns.forEach((column, index) => {
      const sheetColumn = sheet.getColumn(index + 1);
      sheetColumn.width = 18;
      if (column.code === ROW_KEY_CODE) {
        sheetColumn.hidden = true;
      } else if (column.code === "quantity") {
        sheetColumn.numFmt = quantityFormat;
      } else if (column.code === "unitPrice") {
        sheetColumn.numFmt = unitPriceFormat;
      } else if (column.code === "taxExclusiveUnitPrice") {
        sheetColumn.numFmt = unitPriceFormat;
        sheetColumn.protection = { locked: true };
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
      const { bill } = await this.loadBillContext(tx, billId, actorUserId);
      const buffer = (await this.files.getFileBuffer(fileId)).buffer;
      const existingRows = await tx.contractBillRow.findMany({
        where: { contractBillId: bill.id },
        orderBy: { sortOrder: "asc" }
      });
      const importId = randomUUID();
      const preview = await this.buildPreview(bill, mode, buffer, existingRows, importId);

      const record = await tx.contractBillImport.create({
        data: {
          id: importId,
          contractBillId: bill.id,
          fileId,
          mode,
          status: "preview",
          preview: this.toJson({ billRevision: bill.revision, preview }),
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
      if (!record) throw new NotFoundException("合同清单导入记录不存在");
      if (record.status === "applied") {
        throw new BadRequestException("该合同清单导入已应用，不能重复操作");
      }
      if (record.status !== "preview") {
        throw new BadRequestException("当前合同清单导入状态不可应用");
      }
      // 应用仅以“清单 owner + 草稿可编辑状态”为准（见 loadBillContext），不要求 applier 是导入创建者，
      // 以兼容草稿转交（Task 9 transferDraft）后新 owner 应用旧 owner 创建的待应用导入。
      const storedPreview = this.parseStoredPreview(record.preview);
      if (storedPreview.preview.errors.length > 0) {
        throw new BadRequestException("合同清单导入预检存在错误，请先修正后重新预检");
      }

      const { bill, version } = await this.loadBillContext(
        tx,
        record.contractBillId,
        actorUserId
      );
      if (bill.revision !== storedPreview.billRevision) {
        throw new BadRequestException("合同清单已变化，请重新预检后再应用");
      }
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
        throw new BadRequestException("合同清单导入预检存在错误，请先修正后重新预检");
      }

      const newRevision = await this.lockBillRevision(
        tx,
        bill,
        version,
        actorUserId
      );

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
        throw new BadRequestException("该合同清单导入已应用，不能重复操作");
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
          removed: plan.removeKeys.length,
          newRevision
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
    existingRows: ExistingRow[],
    importId: string
  ): Promise<BillImportPreview> {
    const plan = await this.buildResolvedPlan(bill, mode, buffer, existingRows);
    const beforeAmountCents = existingRows.reduce(
      (sum, row) => sum + (row.taxInclusiveAmountCents ?? 0n),
      0n
    );
    const removeKeys = new Set(plan.removeKeys);
    const updateByKey = new Map(plan.updates.map((row) => [row.rowKey, row]));
    let afterAmountCents = 0n;
    for (const row of existingRows) {
      if (removeKeys.has(row.rowKey)) continue;
      const update = updateByKey.get(row.rowKey);
      afterAmountCents += update
        ? (update.taxInclusiveAmountCents ?? 0n)
        : (row.taxInclusiveAmountCents ?? 0n);
    }
    for (const row of plan.adds) {
      afterAmountCents += row.taxInclusiveAmountCents ?? 0n;
    }

    return {
      added: plan.adds.length,
      updated: plan.updates.length,
      removed: plan.removeKeys.length,
      skipped: plan.skipped,
      beforeAmountCents: moneyCentsToApi(beforeAmountCents),
      afterAmountCents: moneyCentsToApi(afterAmountCents),
      rows: plan.previewRows,
      errors: plan.errors,
      candidateRows:
        mode === "replace" && plan.errors.length === 0
          ? plan.adds.map((row, index) => this.toCandidateRow(row, importId, index))
          : []
    };
  }

  private async buildResolvedPlan(
    bill: BillContext,
    mode: ImportMode,
    buffer: Buffer,
    existingRows: ExistingRow[]
  ): Promise<ResolvedPlan> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException(
        "Excel 文件无法解析，请确认文件完整且格式正确"
      );
    }
    const sheet = workbook.getWorksheet(DATA_SHEET);
    if (!sheet) {
      throw new BadRequestException(`Excel 文件缺少“${DATA_SHEET}”工作表`);
    }

    const errors: PreviewError[] = [];
    const previewRows: PreviewRowChange[] = [];
    const adds: ResolvedRow[] = [];
    const updates: ResolvedRow[] = [];
    let skipped = 0;

    const columnDefs = this.templateColumns(bill);
    const codes = this.readFieldCodes(sheet);
    this.assertTemplateColumns(codes, columnDefs, errors);
    if (errors.length > 0) {
      return { adds, updates, removeKeys: [], skipped, errors, previewRows };
    }

    const codeIndex = new Map(codes.map((code, index) => [code, index + 1]));
    const customColumns = this.schemaColumns(bill.schemaSnapshot);

    const seenKeys = new Set<string>();
    const sheetKeys = new Set<string>();

    sheet.eachRow((excelRow: Row, rowNumber: number) => {
      if (rowNumber <= HEADER_ROWS) return;
      if (this.isBlankRow(excelRow, codes)) return;

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
        errors,
        mode === "update" && sheetRowKey
          ? existingRows.find((row) => row.rowKey === sheetRowKey)
          : undefined
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
            message: "更新模式要求每行都包含 __rowKey"
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
            message: `清单中不存在行标识：${sheetRowKey}`
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
            message: `行标识重复：${sheetRowKey}`
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
    errors: PreviewError[],
    existing?: ExistingRow
  ): ResolvedRow | null {
    const before = errors.length;
    const itemName = this.asString(raw.itemName);
    const unit = this.asString(raw.unit);
    if (!itemName) {
      errors.push(this.fieldError(rowNumber, "itemName", "项目名称不能为空"));
    }
    if (!unit) {
      errors.push(this.fieldError(rowNumber, "unit", "单位不能为空"));
    }

    const quantity = this.asString(raw.quantity);
    const unitPrice = this.asString(raw.unitPrice);
    const taxRatePercent = this.asString(raw.taxRatePercent);

    const isProvisional = this.parseBoolean(raw.isProvisional, rowNumber, errors);

    const customData: Record<string, unknown> = {};
    for (const column of customColumns) {
      const value = this.asString(raw[column.key]);
      if (value) customData[column.key] = value;
      if (column.required && !value) {
        errors.push(
          this.fieldError(rowNumber, column.key, `必填自定义字段未填写：${column.key}`)
        );
      }
    }

    let facts: ReturnType<typeof resolveContractBillRowFacts> | null = null;
    if (errors.length === before) {
      try {
        const defaultRate = bill.defaultTaxRatePercent?.toString() ?? null;
        facts = resolveContractBillRowFacts(
          {
            ...(quantity ? { quantity } : {}),
            unitPrice,
            ...(taxRatePercent ? { taxRatePercent } : {}),
            taxRateSource:
              bill.taxMode === "multiple_rate" &&
              this.isTaxRateOverride(taxRatePercent, defaultRate)
                ? "row_override"
                : "version_default"
          },
          bill,
          existing
        );
      } catch (error) {
        const message =
          error instanceof BadRequestException ? error.message : "合同清单行计价信息无效";
        const column = message.startsWith("数量")
          ? "quantity"
          : message.startsWith("含税单价")
            ? "unitPrice"
            : "taxRatePercent";
        errors.push(this.fieldError(rowNumber, column, message));
      }
    }
    if (errors.length !== before || !facts) return null;

    return {
      rowKey: randomUUID(),
      sortOrder: 0,
      itemCode: this.asString(raw.itemCode) || null,
      itemName,
      specification: this.asString(raw.specification) || null,
      unit,
      quantity: facts.quantity,
      unitPrice: facts.unitPrice,
      taxRatePercent: facts.taxRatePercent,
      taxRateSource: facts.taxRateSource,
      pricingFactStatus: facts.pricingFactStatus,
      precisionPolicy: facts.precisionPolicy,
      isProvisional,
      settlementBasis: this.asString(raw.settlementBasis) || null,
      customData: this.toJson(customData),
      taxInclusiveAmountCents: facts.taxInclusiveAmountCents,
      taxExclusiveAmountCents: facts.taxExclusiveAmountCents,
      taxAmountCents: facts.taxAmountCents
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
      taxRateSource: row.taxRateSource,
      pricingFactStatus: row.pricingFactStatus,
      precisionPolicy: row.precisionPolicy,
      taxInclusiveAmountCents: row.taxInclusiveAmountCents,
      taxExclusiveAmountCents: row.taxExclusiveAmountCents,
      taxAmountCents: row.taxAmountCents,
      isProvisional: row.isProvisional,
      settlementBasis: row.settlementBasis,
      customData: row.customData
    };
  }

  private toCandidateRow(
    row: ResolvedRow,
    importId: string,
    index: number
  ): BillImportCandidateRow {
    return {
      clientRowKey: `import-${importId}-${index + 1}`,
      rowKey: undefined,
      sortOrder: index,
      ...(row.itemCode ? { itemCode: row.itemCode } : {}),
      itemName: row.itemName,
      ...(row.specification ? { specification: row.specification } : {}),
      unit: row.unit,
      ...(row.quantity === null
        ? {}
        : { quantity: new Prisma.Decimal(row.quantity).toString() }),
      unitPrice: row.unitPrice === null ? "" : new Prisma.Decimal(row.unitPrice).toString(),
      ...(row.taxRatePercent === null
        ? {}
        : { taxRatePercent: new Prisma.Decimal(row.taxRatePercent).toString() }),
      taxRateSource: row.taxRateSource,
      isProvisional: row.isProvisional,
      ...(row.settlementBasis ? { settlementBasis: row.settlementBasis } : {}),
      customData: { ...(row.customData as Record<string, unknown>) }
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

  private isBlankRow(row: Row, codes: string[]): boolean {
    for (let column = 1; column <= codes.length; column += 1) {
      if (
        codes[column - 1] === "taxRatePercent" ||
        codes[column - 1] === "taxExclusiveUnitPrice" ||
        codes[column - 1] === ROW_KEY_CODE
      ) {
        continue;
      }
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
          message: "清单数据区域不允许合并单元格"
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
    while (codes.length > 0 && !codes[codes.length - 1]) {
      codes.pop();
    }
    return codes;
  }

  private assertTemplateColumns(
    actualCodes: string[],
    columns: CoreFieldDef[],
    errors: PreviewError[]
  ) {
    const expectedCodes = columns.map((column) => column.code);
    const seen = new Set<string>();

    actualCodes.forEach((code) => {
      if (!code) return;
      if (seen.has(code)) {
        errors.push({
          sheet: DATA_SHEET,
          row: HEADER_ROWS,
          column: code,
          message: `模板列结构与当前系统标准模板不一致：字段码重复：${code}`
        });
        return;
      }
      seen.add(code);
      if (!expectedCodes.includes(code)) {
        errors.push({
          sheet: DATA_SHEET,
          row: HEADER_ROWS,
          column: code,
          message: `模板列结构与当前系统标准模板不一致：存在非系统字段码：${code}`
        });
      }
    });

    expectedCodes.forEach((expectedCode, index) => {
      const actualCode = actualCodes[index] ?? "";
      if (actualCode === expectedCode) return;
      if (!actualCodes.includes(expectedCode)) {
        errors.push({
          sheet: DATA_SHEET,
          row: HEADER_ROWS,
          column: expectedCode,
          message: `模板列结构与当前系统标准模板不一致：缺少字段码：${expectedCode}`
        });
        return;
      }
      errors.push({
        sheet: DATA_SHEET,
        row: HEADER_ROWS,
        column: expectedCode,
        message: `模板列结构与当前系统标准模板不一致：字段码顺序错误，应为：${expectedCode}`
      });
    });
  }

  private parseBoolean(value: unknown, rowNumber: number, errors: PreviewError[]): boolean {
    const text = this.asString(value).toLowerCase();
    if (!text) return false;
    if (["true", "1", "是", "y", "yes"].includes(text)) return true;
    if (["false", "0", "否", "n", "no"].includes(text)) return false;
    errors.push(this.fieldError(rowNumber, "isProvisional", "是否暂定格式无效"));
    return false;
  }

  private fieldError(rowNumber: number, column: string, message: string): PreviewError {
    return { sheet: DATA_SHEET, row: rowNumber, column, message };
  }

  private asString(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  private isTaxRateOverride(value: string, defaultRate: string | null) {
    if (!value) return false;
    if (defaultRate === null) return true;
    try {
      return !new Prisma.Decimal(value).eq(defaultRate);
    } catch {
      return true;
    }
  }

  // ── Shared loaders ────────────────────────────────────────────────────

  // 复用共享的 owner + 可编辑状态校验，再投影成本服务使用的 BillContext。
  private async loadBillContext(
    tx: Prisma.TransactionClient,
    billId: string,
    actorUserId: string
  ) {
    const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
    return {
      bill: {
        id: bill.id,
        contractVersionId: bill.contractVersionId,
        revision: bill.revision,
        name: bill.name,
        pricingMode: bill.pricingMode as "tax_inclusive" | "tax_exclusive",
        quantityScale: bill.quantityScale,
        unitPriceScale: bill.unitPriceScale,
        schemaSnapshot: bill.schemaSnapshot,
        pricingNature: version.pricingNature,
        amountLimitType: version.amountLimitType,
        taxMode: version.taxMode,
        defaultTaxRatePercent: version.defaultTaxRatePercent
      },
      version: {
        id: version.id,
        contractId: version.contractId,
        amountSource: version.amountSource,
        pricingNature: version.pricingNature,
        amountLimitType: version.amountLimitType,
        draftRevision: version.draftRevision
      }
    };
  }

  private async lockBillRevision(
    tx: Prisma.TransactionClient,
    bill: { id: string; contractVersionId: string; revision: number },
    version: { id: string; contractId: string; draftRevision: number },
    actorUserId: string
  ) {
    const newRevision = await bumpContractRenderInputRevision(
      tx,
      version.id,
      version.draftRevision
    );
    const ownerGate = await tx.contract.updateMany({
      where: { id: version.contractId, ownerUserId: actorUserId, voidedAt: null },
      data: { ownerUserId: actorUserId }
    });
    if (ownerGate.count !== 1) {
      throw new BadRequestException("合同清单已变化或当前状态不可编辑，请刷新后重试");
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
      throw new BadRequestException("合同清单已变化或当前状态不可编辑，请刷新后重试");
    }
    return newRevision;
  }

  // ── Column / schema helpers ──────────────────────────────────────────

  private templateColumns(bill: BillContext): CoreFieldDef[] {
    const custom = this.schemaColumns(bill.schemaSnapshot).map((column) => ({
      code: column.key,
      label: column.label,
      required: column.required
    }));
    return [...CORE_FIELDS, ...custom, { code: ROW_KEY_CODE, label: ROW_KEY_CODE, required: false }];
  }

  private schemaColumns(value: Prisma.JsonValue) {
    if (!this.isPlainObject(value) || !Array.isArray(value.columns)) {
      throw new BadRequestException("合同清单字段结构无效");
    }
    return value.columns.map((column, index) => {
      if (
        !this.isPlainObject(column) ||
        typeof column.key !== "string" ||
        !column.key.trim() ||
        (column.label !== undefined && typeof column.label !== "string") ||
        (column.required !== undefined && typeof column.required !== "boolean")
      ) {
        throw new BadRequestException(`合同清单第 ${index + 1} 个字段定义无效`);
      }
      const label =
        typeof column.label === "string" && column.label.trim() ? column.label.trim() : column.key;
      return { key: column.key, label, required: column.required === true };
    }).filter((column) => isContractBillCustomColumn(column.key));
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
    return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "合同清单";
  }

  private parseImportInput(input: ContractBillExcelImportDto): ContractBillExcelImportDto {
    if (!this.isPlainObject(input)) {
      throw new BadRequestException("Excel 导入提交内容必须是对象");
    }
    if (typeof input.fileId !== "string" || !input.fileId.trim()) {
      throw new BadRequestException("文件标识不能为空");
    }
    if (input.mode !== "replace" && input.mode !== "update" && input.mode !== "append") {
      throw new BadRequestException("导入模式必须是替换、更新或追加");
    }
    return { fileId: input.fileId.trim(), mode: input.mode };
  }

  private parseStoredPreview(value: Prisma.JsonValue): StoredBillImportPreview {
    if (
      !this.isPlainObject(value) ||
      typeof value.billRevision !== "number" ||
      !Number.isInteger(value.billRevision) ||
      !this.isPlainObject(value.preview) ||
      !Array.isArray(value.preview.errors)
    ) {
      throw new BadRequestException("合同清单导入预检数据无效");
    }
    return value as unknown as StoredBillImportPreview;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    try {
      const serialized = JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? moneyCentsToApi(item) : item
      );
      if (serialized === undefined) throw new Error("not JSON");
      return JSON.parse(serialized) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException("Excel 导入结果包含无法保存的内容");
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

interface BillContext {
  id: string;
  contractVersionId: string;
  revision: number;
  name: string;
  pricingMode: "tax_inclusive" | "tax_exclusive";
  quantityScale: number;
  unitPriceScale: number;
  schemaSnapshot: Prisma.JsonValue;
  pricingNature: string;
  amountLimitType: string;
  taxMode: string;
  defaultTaxRatePercent: Prisma.Decimal | null;
}

interface ExistingRow {
  rowKey: string;
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

interface ResolvedPlan {
  adds: ResolvedRow[];
  updates: ResolvedRow[];
  removeKeys: string[];
  skipped: number;
  errors: PreviewError[];
  previewRows: PreviewRowChange[];
}
