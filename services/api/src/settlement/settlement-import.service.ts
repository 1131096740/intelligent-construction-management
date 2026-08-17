import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import type { Cell, Row, Worksheet } from "exceljs";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  formatMoneyCentsAsYuan,
  signedYuanTextToCents,
  yuanTextToCents
} from "../money/decimal-money";
import type { CreateSettlementLineDto } from "./dto/create-settlement.dto";
import type { PreviewSettlementImportDto } from "./dto/preview-settlement-import.dto";
import { SettlementService } from "./settlement.service";
import { parseSettlementQuantity } from "./settlement-quantity";
import { SettlementWorkbenchService } from "./settlement-workbench.service";
import { SettlementTemplateService } from "./settlement-template.service";

export const SETTLEMENT_IMPORT_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DATA_SHEET = "本期结算明细";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_ROWS = 1_000;
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const VISIBLE_COLUMNS = [
  "清单编码/行号",
  "清单项名称",
  "是否本期结算",
  "本期数量",
  "本期金额（元）",
  "调整原因",
  "备注"
] as const;
const ALL_COLUMNS = VISIBLE_COLUMNS;

export interface SettlementImportError {
  row: number;
  column: string;
  message: string;
}

interface StoredPreview {
  selectedCount: number;
  settlementLines: CreateSettlementLineDto[];
  canonical: unknown | null;
  errors: SettlementImportError[];
  displayRows?: Array<{ contractBillRowId: string | null; sourceKey: string; name: string }>;
}

@Injectable()
export class SettlementImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly workbench: SettlementWorkbenchService,
    private readonly settlements: SettlementService,
    @Optional()
    private readonly settlementTemplates?: SettlementTemplateService
  ) {}

  async exportTemplate(contractVersionId: string, actorUserId: string) {
    const source = await this.workbench.sourceLines(contractVersionId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(DATA_SHEET);
    sheet.addRow([...ALL_COLUMNS]);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns = [
      { width: 38 },
      { width: 28 },
      { width: 16 },
      { width: 16 },
      { width: 22 },
      { width: 28 },
      { width: 28 }
    ];
    const displayKeyById = this.displaySourceKeys(source.rows);
    for (const row of source.rows) {
      sheet.addRow([displayKeyById.get(row.id), row.itemName, "否", "", "", "", ""]);
    }
    for (let rowNumber = 2; rowNumber <= Math.max(2, source.rows.length + 1); rowNumber += 1) {
      sheet.getCell(`C${rowNumber}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"是,否"']
      };
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId,
        action: "settlement.import.template.download",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { projectId: source.projectId, sourceRowCount: source.rows.length }
      })
    );
    return { buffer, fileName: "本期结算导入模板.xlsx" };
  }

  async previewImport(
    contractVersionId: string,
    actorUserId: string,
    input: PreviewSettlementImportDto
  ) {
    const fileId = input.fileId?.trim();
    if (!fileId) throw new BadRequestException("请选择要导入的结算 Excel 文件");
    const settlementTemplateVersionId = input.settlementTemplateVersionId?.trim() || null;
    if (this.settlementTemplates && !settlementTemplateVersionId) {
      throw new BadRequestException("请选择结算模板版本");
    }
    if (!this.settlementTemplates && settlementTemplateVersionId) {
      throw new Error("结算模板兼容校验服务暂不可用，请稍后重试");
    }
    const source = await this.workbench.sourceLines(contractVersionId);
    const { file, buffer } = await this.files.getFileBuffer(fileId);
    this.assertImportFile(file, buffer, actorUserId);
    this.assertSafeXlsxArchive(buffer);
    const sourceRevision = this.sourceRevision(source);
    const parsed = await this.parseWorkbook(buffer, source.rows);
    let canonical: unknown | null = null;
    if (parsed.errors.length === 0 && parsed.settlementLines.length > 0) {
      try {
        canonical = await this.settlements.previewLines(contractVersionId, {
          settlementLines: parsed.settlementLines
        });
      } catch (error) {
        parsed.errors.push({
          row: 2,
          column: "业务校验",
          message: settlementPreviewErrorMessage()
        });
      }
    }
    if (parsed.settlementLines.length === 0 && parsed.errors.length === 0) {
      parsed.errors.push({
        row: 2,
        column: "是否本期结算",
        message: "请至少明确选择一条本期结算明细"
      });
    }
    const preview: StoredPreview = {
      selectedCount: parsed.settlementLines.length,
      settlementLines: parsed.settlementLines,
      canonical,
      errors: parsed.errors,
      displayRows: parsed.displayRows
    };
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");
    const record = await this.prisma.$transaction(async (tx) => {
      if (this.settlementTemplates && settlementTemplateVersionId) {
        await this.settlementTemplates.assertPublishedCompatible(
          settlementTemplateVersionId,
          contractVersionId,
          source.projectId,
          tx
        );
      }
      const created = await tx.settlementImport.create({
        data: {
          projectId: source.projectId,
          contractVersionId,
          ...(settlementTemplateVersionId ? { settlementTemplateVersionId } : {}),
          fileId,
          fileSha256,
          sourceRevision,
          status: "preview",
          preview: preview as unknown as Prisma.InputJsonValue,
          createdByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.import.preview",
        businessType: "settlement_import",
        businessId: created.id,
        metadata: {
          projectId: source.projectId,
          contractVersionId,
          selectedCount: preview.selectedCount,
          errorCount: preview.errors.length,
          fileSha256,
          sourceRevision
        }
      });
      return created;
    });
    return { importId: record.id, sourceRevision, ...preview };
  }

  async applyImport(projectId: string, importId: string, actorUserId: string) {
    const record = await this.prisma.settlementImport.findUnique({ where: { id: importId } });
    if (!record) throw new NotFoundException("结算导入记录不存在");
    this.assertProject(record.projectId, projectId);
    if (record.status === "applied") {
      return { importId: record.id, status: "applied", result: record.result };
    }
    if (record.status !== "preview") {
      throw new BadRequestException("当前结算导入状态不可应用");
    }
    const preview = this.storedPreview(record.preview);
    if (preview.errors.length > 0 || !preview.canonical) {
      throw new BadRequestException("结算导入预检存在错误，请修正后重新预检");
    }
    const source = await this.workbench.sourceLines(record.contractVersionId);
    if (this.sourceRevision(source) !== record.sourceRevision) {
      throw new BadRequestException("合同清单或前期结算占用已变化，请重新预检后再应用");
    }
    const result = {
      contractVersionId: record.contractVersionId,
      sourceRevision: record.sourceRevision,
      ...(record.settlementTemplateVersionId
        ? { settlementTemplateVersionId: record.settlementTemplateVersionId }
        : {}),
      settlementLines: preview.settlementLines,
      canonical: preview.canonical
    };

    return this.prisma.$transaction(async (tx) => {
      const applied = await tx.settlementImport.updateMany({
        where: { id: importId, projectId, status: "preview" },
        data: {
          status: "applied",
          result: result as unknown as Prisma.InputJsonValue,
          appliedByUserId: actorUserId,
          appliedAt: new Date()
        }
      });
      if (applied.count !== 1) {
        const current = await tx.settlementImport.findUnique({ where: { id: importId } });
        if (current?.status === "applied") {
          return { importId, status: "applied", result: current.result };
        }
        throw new BadRequestException("结算导入状态已变化，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.import.apply",
        businessType: "settlement_import",
        businessId: importId,
        metadata: {
          projectId,
          contractVersionId: record.contractVersionId,
          sourceRevision: record.sourceRevision,
          selectedCount: preview.selectedCount
        }
      });
      return { importId, status: "applied", result };
    });
  }

  async exportErrors(projectId: string, importId: string, actorUserId: string) {
    const record = await this.prisma.settlementImport.findUnique({ where: { id: importId } });
    if (!record) throw new NotFoundException("结算导入记录不存在");
    this.assertProject(record.projectId, projectId);
    const preview = this.storedPreview(record.preview);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("导入错误");
    sheet.addRow(["Excel 行号", "字段", "错误原因"]);
    preview.errors.forEach((error) => sheet.addRow([error.row, error.column, error.message]));
    sheet.columns = [{ width: 14 }, { width: 24 }, { width: 64 }];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId,
        action: "settlement.import.errors.download",
        businessType: "settlement_import",
        businessId: importId,
        metadata: { projectId, errorCount: preview.errors.length }
      })
    );
    return { buffer, fileName: "结算导入错误.xlsx" };
  }

  async exportResult(projectId: string, importId: string, actorUserId: string) {
    const record = await this.prisma.settlementImport.findUnique({ where: { id: importId } });
    if (!record) throw new NotFoundException("结算导入记录不存在");
    this.assertProject(record.projectId, projectId);
    const preview = this.storedPreview(record.preview);
    const canonicalSource =
      record.status === "applied" && record.result && typeof record.result === "object"
        ? (record.result as Record<string, unknown>).canonical
        : preview.canonical;
    const canonicalRows = this.canonicalRows(canonicalSource);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("本期结算结果");
    sheet.addRow([
      "清单编码/行号",
      "明细名称",
      "计算模式",
      "本期数量",
      "合同单价",
      "本期金额（元）",
      "调整原因",
      "备注"
    ]);
    const displayById = new Map(
      (preview.displayRows ?? [])
        .filter((row) => row.contractBillRowId)
        .map((row) => [row.contractBillRowId as string, row])
    );
    for (const row of canonicalRows) {
      const display = row.contractBillRowId ? displayById.get(row.contractBillRowId) : undefined;
      sheet.addRow([
        display?.sourceKey ?? "",
        row.name ?? "",
        this.calculationModeLabel(row.calculationMode),
        row.quantity ?? "",
        row.unitPrice ?? "",
        this.moneyYuan(row.amountCents),
        row.reason ?? "",
        row.remark ?? ""
      ]);
    }
    sheet.columns = [
      { width: 38 },
      { width: 28 },
      { width: 20 },
      { width: 18 },
      { width: 18 },
      { width: 24 },
      { width: 28 },
      { width: 28 }
    ];
    const errorSheet = workbook.addWorksheet("导入错误");
    errorSheet.addRow(["Excel 行号", "字段", "错误原因"]);
    preview.errors.forEach((error) =>
      errorSheet.addRow([error.row, error.column, error.message])
    );
    errorSheet.columns = [{ width: 14 }, { width: 24 }, { width: 64 }];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId,
        action: "settlement.import.result.download",
        businessType: "settlement_import",
        businessId: importId,
        metadata: {
          projectId,
          status: record.status,
          selectedCount: canonicalRows.length,
          errorCount: preview.errors.length
        }
      })
    );
    return { buffer, fileName: "结算导入结果.xlsx" };
  }

  private async parseWorkbook(
    buffer: Buffer,
    sourceRows: Array<{
      id: string;
      itemName: string;
      itemCode: string | null;
      billKey: string;
      billName: string;
      rowKey: string;
      calculationMode: "normal_auto" | "manual_amount";
    }>
  ): Promise<{
    settlementLines: CreateSettlementLineDto[];
    errors: SettlementImportError[];
    displayRows: Array<{ contractBillRowId: string | null; sourceKey: string; name: string }>;
  }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("Excel 文件无法解析，请确认文件完整且格式正确");
    }
    const sheet = workbook.getWorksheet(DATA_SHEET);
    if (!sheet) throw new BadRequestException(`Excel 文件缺少“${DATA_SHEET}”工作表`);
    if (((sheet.model as unknown as { merges?: string[] }).merges ?? []).length > 0) {
      throw new BadRequestException("结算导入 Excel 不允许合并单元格");
    }
    this.assertNoExtraColumns(sheet, ALL_COLUMNS.length);
    const headers = ALL_COLUMNS.map((_column, index) => this.cellText(sheet.getRow(1).getCell(index + 1)));
    if (headers.some((header, index) => header !== ALL_COLUMNS[index])) {
      throw new BadRequestException("Excel 表头不正确，请重新下载结算导入模板");
    }
    const dataRowCount = Math.max(0, sheet.actualRowCount - 1);
    if (dataRowCount > MAX_DATA_ROWS) {
      throw new BadRequestException(`结算导入一次最多支持 ${MAX_DATA_ROWS} 行`);
    }
    this.assertNoFormulas(sheet);

    const displayKeyById = this.displaySourceKeys(sourceRows);
    const sourceByKey = new Map<string, typeof sourceRows>();
    for (const row of sourceRows) {
      const key = displayKeyById.get(row.id) as string;
      sourceByKey.set(key, [...(sourceByKey.get(key) ?? []), row]);
    }
    const seen = new Set<string>();
    const errors: SettlementImportError[] = [];
    const settlementLines: CreateSettlementLineDto[] = [];
    const displayRows: Array<{ contractBillRowId: string | null; sourceKey: string; name: string }> = [];
    sheet.eachRow((row: Row, rowNumber: number) => {
      if (rowNumber === 1 || this.blankRow(row)) return;
      const selectedText = this.cellText(row.getCell(3));
      const selected = this.selection(selectedText, rowNumber, errors);
      if (!selected) return;
      const visibleSourceKey = this.cellText(row.getCell(1));
      const name = this.cellText(row.getCell(2));
      const quantity = this.cellText(row.getCell(4));
      const amount = this.moneyCellText(row.getCell(5), rowNumber, errors);
      const reason = this.cellText(row.getCell(6));
      const remark = this.cellText(row.getCell(7));
      if (visibleSourceKey) {
        const matchedByKey = sourceByKey.get(visibleSourceKey) ?? [];
        const source = matchedByKey.length === 1 ? matchedByKey[0] : undefined;
        if (!source) {
          errors.push({
            row: rowNumber,
            column: "清单编码/行号",
            message: matchedByKey.length > 1 ? "清单编码存在歧义，请重新下载模板" : "清单项不属于当前有效合同版本"
          });
          return;
        }
        const expectedKey = displayKeyById.get(source.id) as string;
        if (visibleSourceKey !== expectedKey) {
          errors.push({ row: rowNumber, column: "清单编码/行号", message: "清单编码与合同清单不一致，请重新下载模板" });
          return;
        }
        if (seen.has(source.id)) {
          errors.push({ row: rowNumber, column: "清单编码/行号", message: "同一合同清单项不能重复选择" });
          return;
        }
        seen.add(source.id);
        if (source.calculationMode === "normal_auto" && !quantity) {
          errors.push({ row: rowNumber, column: "本期数量", message: "正常计价行必须填写本期数量" });
          return;
        }
        if (quantity && !this.validQuantity(quantity, rowNumber, errors)) return;
        if (source.calculationMode === "manual_amount" && !amount) {
          errors.push({ row: rowNumber, column: "本期金额（元）", message: "非自动计价行必须填写本期金额" });
          return;
        }
        if (
          source.calculationMode === "manual_amount" &&
          amount &&
          !this.validMoney(amount, rowNumber, false, errors)
        ) return;
        settlementLines.push({
          sourceType: "contract_bill_row",
          contractBillRowId: source.id,
          ...(quantity ? { quantity } : {}),
          ...(source.calculationMode === "manual_amount" && amount ? { amountCents: amount } : {}),
          ...(reason ? { reason } : {}),
          ...(remark ? { remark } : {})
        });
        displayRows.push({ contractBillRowId: source.id, sourceKey: expectedKey, name: source.itemName });
        return;
      }
      if (!name) errors.push({ row: rowNumber, column: "清单项名称", message: "手工调整必须填写名称" });
      if (!amount) errors.push({ row: rowNumber, column: "本期金额（元）", message: "手工调整必须填写金额" });
      if (!reason) errors.push({ row: rowNumber, column: "调整原因", message: "手工调整必须填写原因" });
      if (!name || !amount || !reason) return;
      if (!this.validMoney(amount, rowNumber, true, errors)) return;
      settlementLines.push({
        sourceType: "manual_adjustment",
        name,
        amountCents: amount,
        reason,
        ...(remark ? { remark } : {})
      });
      displayRows.push({ contractBillRowId: null, sourceKey: "", name });
    });
    return { settlementLines, errors, displayRows };
  }

  private assertImportFile(
    file: {
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedByUserId: string;
      storageStatus: string;
    },
    buffer: Buffer,
    actorUserId: string
  ) {
    if (file.storageStatus !== "active") throw new BadRequestException("结算导入文件已失效，请重新上传");
    if (file.uploadedByUserId !== actorUserId) {
      throw new BadRequestException("只能预检当前账号上传的结算文件");
    }
    if (file.sizeBytes !== buffer.length || buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException("结算导入文件大小不正确或超过 10 MB");
    }
    if (file.mimeType !== SETTLEMENT_IMPORT_XLSX_MIME || !file.originalName.toLowerCase().endsWith(".xlsx")) {
      throw new BadRequestException("结算导入只支持 XLSX 文件");
    }
  }

  private assertNoFormulas(sheet: Worksheet) {
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const value = cell.value;
        if (
          value &&
          typeof value === "object" &&
          ("formula" in value || "sharedFormula" in value)
        ) {
          throw new BadRequestException("Excel 不允许使用公式，请将公式结果粘贴为数值后重新导入");
        }
      })
    );
  }

  private assertNoExtraColumns(sheet: Worksheet, expectedColumnCount: number) {
    let hasExtraValue = false;
    sheet.eachRow((row) =>
      row.eachCell((cell, columnNumber) => {
        if (columnNumber > expectedColumnCount && this.cellText(cell)) hasExtraValue = true;
      })
    );
    if (hasExtraValue) {
      throw new BadRequestException("结算导入模板不得新增系统字段或隐藏列，请重新下载模板");
    }
  }

  private assertSafeXlsxArchive(buffer: Buffer) {
    let zip: InstanceType<typeof PizZip>;
    try {
      zip = new PizZip(buffer);
    } catch {
      throw new BadRequestException("Excel 压缩包结构异常或解压后内容过大，无法导入");
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
      throw new BadRequestException("Excel 压缩包结构异常或解压后内容过大，无法导入");
    }
    let totalUncompressedBytes = 0;
    for (const entry of entries) {
      const uncompressedBytes = (
        entry as unknown as { _data?: { uncompressedSize?: number } }
      )._data?.uncompressedSize;
      if (
        !Number.isSafeInteger(uncompressedBytes) ||
        (uncompressedBytes ?? -1) < 0 ||
        (uncompressedBytes ?? 0) > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES
      ) {
        throw new BadRequestException("Excel 压缩包结构异常或解压后内容过大，无法导入");
      }
      totalUncompressedBytes += uncompressedBytes ?? 0;
      if (totalUncompressedBytes > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw new BadRequestException("Excel 压缩包结构异常或解压后内容过大，无法导入");
      }
    }
  }

  private blankRow(row: Row): boolean {
    return ALL_COLUMNS.every((_column, index) => !this.cellText(row.getCell(index + 1)));
  }

  private selection(value: string, row: number, errors: SettlementImportError[]): boolean {
    if (value === "是") return true;
    if (value === "" || value === "否") return false;
    errors.push({ row, column: "是否本期结算", message: "只能填写是或否" });
    return false;
  }

  private moneyCellText(cell: Cell, row: number, errors: SettlementImportError[]): string {
    if (typeof cell.value === "number" && !Number.isFinite(cell.value)) {
      errors.push({ row, column: "本期金额（元）", message: "金额必须填写有效数字" });
      return "";
    }
    const value = this.cellText(cell);
    if (!value) return "";
    try {
      return signedYuanTextToCents(value, "本期金额").toString();
    } catch {
      errors.push({ row, column: "本期金额（元）", message: "金额必须填写有效数字，最多两位小数" });
      return "";
    }
  }

  private validQuantity(value: string, row: number, errors: SettlementImportError[]): boolean {
    try {
      const quantity = parseSettlementQuantity(value);
      if (!quantity || quantity.isNegative()) throw new Error();
      return true;
    } catch {
      errors.push({ row, column: "本期数量", message: "本期数量必须是非负数，最多 6 位小数" });
      return false;
    }
  }

  private validMoney(
    value: string,
    row: number,
    signed: boolean,
    errors: SettlementImportError[]
  ): boolean {
    try {
      if (signed) {
        signedYuanTextToCents(formatMoneyCentsAsYuan(BigInt(value)), "本期金额");
      } else {
        yuanTextToCents(formatMoneyCentsAsYuan(BigInt(value)), "本期金额");
      }
      return true;
    } catch {
      errors.push({
        row,
        column: "本期金额（元）",
        message: signed
          ? "手工调整金额必须填写有效金额"
          : "非自动计价行必须填写有效金额"
      });
      return false;
    }
  }

  private cellText(cell: Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part.text ?? "")).join("").trim();
    }
    return "";
  }

  private sourceRevision(source: unknown): string {
    return createHash("sha256").update(JSON.stringify(source)).digest("hex");
  }

  private storedPreview(value: Prisma.JsonValue): StoredPreview {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("结算导入预检结果损坏，请重新预检");
    }
    const preview = value as unknown as StoredPreview;
    if (!Array.isArray(preview.errors) || !Array.isArray(preview.settlementLines)) {
      throw new BadRequestException("结算导入预检结果损坏，请重新预检");
    }
    return preview;
  }

  private canonicalRows(value: unknown): Array<Record<string, string | null>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const lines = (value as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) return [];
    return lines.filter(
      (line): line is Record<string, string | null> =>
        !!line && typeof line === "object" && !Array.isArray(line)
    );
  }

  private displaySourceKeys(rows: Array<{
    id: string;
    itemCode: string | null;
    itemName: string;
    billName: string;
  }>): Map<string, string> {
    const occurrenceByBase = new Map<string, number>();
    const usedKeys = new Set<string>();
    return new Map(rows.map((row) => {
      const base = row.itemCode?.trim() || `${row.billName}/${row.itemName}`;
      let occurrence = (occurrenceByBase.get(base) ?? 0) + 1;
      let key = occurrence === 1 ? base : `${base}（第${occurrence}项）`;
      while (usedKeys.has(key)) {
        occurrence += 1;
        key = `${base}（第${occurrence}项）`;
      }
      occurrenceByBase.set(base, occurrence);
      usedKeys.add(key);
      return [row.id, key];
    }));
  }

  private moneyYuan(value: unknown): string {
    try {
      return formatMoneyCentsAsYuan(BigInt(String(value)));
    } catch {
      return "—";
    }
  }

  private calculationModeLabel(value: string | null | undefined): string {
    return {
      normal_auto: "自动计价",
      manual_amount: "人工金额",
      manual_adjustment: "人工调整"
    }[value ?? ""] ?? "历史明细";
  }

  private assertProject(actualProjectId: string, requestedProjectId: string) {
    if (actualProjectId !== requestedProjectId) {
      throw new BadRequestException("结算导入记录不属于当前项目");
    }
  }
}

function settlementPreviewErrorMessage(): string {
  return "结算明细校验失败";
}
