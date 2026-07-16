import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import type { CellValue, Worksheet } from "exceljs";
import PizZip from "pizzip";
import { FileService } from "../file/file.service";
import { yuanTextToCents } from "../money/decimal-money";
import { ContractTakeoverService } from "./contract-takeover.service";
import type {
  ApplyContractTakeoverExcelDto,
  PreviewContractTakeoverExcelDto
} from "./dto/contract-takeover-excel.dto";

const MAIN_SHEET = "合同主表";
const PRICING_SHEET = "计价清单";
const INSTRUCTIONS_SHEET = "填写说明";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const MAIN_HEADERS = [
  "合同编号",
  "合同名称",
  "相对方",
  "合同类型",
  "签约主体编号",
  "签约主体名称",
  "合同金额(元)",
  "签订日期",
  "接管等级",
  "履约状态",
  "付款条款",
  "发票类型",
  "计税模式",
  "默认税率(%)",
  "税务事实来源",
  "确认说明"
] as const;

const PRICING_HEADERS = [
  "合同编号",
  "清单标识",
  "清单名称",
  "项目标识",
  "项目编号",
  "名称",
  "规格型号",
  "单位",
  "预计数量",
  "含税单价(元)",
  "例外税率(%)",
  "是否暂定",
  "结算依据"
] as const;

export interface ContractTakeoverExcelIssue {
  sheet: string;
  row: number;
  column: string;
  message: string;
}

type ParsedWorkbook = {
  rows: Record<string, unknown>[];
  errors: ContractTakeoverExcelIssue[];
};

@Injectable()
export class ContractTakeoverExcelService {
  constructor(
    private readonly files: FileService,
    private readonly takeovers: ContractTakeoverService
  ) {}

  async exportTemplate() {
    const workbook = new ExcelJS.Workbook();
    const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET);
    instructions.addRows([
      ["历史合同接管导入说明"],
      ["1. 合同主表每份合同一行，合同编号必须唯一。"],
      ["2. 计价清单可按合同编号填写多行；资料不明确的数量、含税单价或税率可以留空。"],
      ["3. 数量和含税单价最多保留 2 位小数；税率必须大于 0 且不超过 100。"],
      ["4. 税务事实缺失不会阻断接管，但会阻断相关结算提交，直至完成财务复核和合同部确认。"],
      ["5. 不要修改工作表名称或第一行中文表头，不要使用公式。"]
    ]);
    instructions.getColumn(1).width = 110;

    const main = workbook.addWorksheet(MAIN_SHEET);
    main.addRow([...MAIN_HEADERS]);
    main.views = [{ state: "frozen", ySplit: 1 }];
    this.styleHeader(main, MAIN_HEADERS.length);
    main.columns.forEach((column) => {
      column.width = 18;
    });

    const pricing = workbook.addWorksheet(PRICING_SHEET);
    pricing.addRow([...PRICING_HEADERS]);
    pricing.views = [{ state: "frozen", ySplit: 1 }];
    this.styleHeader(pricing, PRICING_HEADERS.length);
    pricing.columns.forEach((column) => {
      column.width = 18;
    });

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: "历史合同接管导入模板.xlsx"
    };
  }

  async preview(
    projectId: string,
    actorUserId: string,
    input: PreviewContractTakeoverExcelDto
  ) {
    const { buffer } = await this.loadOwnedWorkbook(input.fileId, actorUserId);
    const parsed = await this.parseWorkbook(buffer);
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");
    const importFingerprint = fingerprint(parsed.rows);
    const precheck = parsed.rows.length
      ? await this.takeovers.precheckImport(projectId, { rows: parsed.rows })
      : {
          projectId,
          totalRows: 0,
          readyRows: 0,
          blockedRows: 0,
          warningRows: 0,
          existingCodes: [],
          duplicatedCodes: [],
          rows: []
        };
    return {
      fileId: input.fileId.trim(),
      fileSha256,
      importFingerprint,
      errors: parsed.errors,
      ...precheck,
      blockedRows: precheck.blockedRows + (parsed.errors.length ? 1 : 0)
    };
  }

  async apply(
    projectId: string,
    actorUserId: string,
    input: ApplyContractTakeoverExcelDto
  ) {
    const { buffer } = await this.loadOwnedWorkbook(input.fileId, actorUserId);
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");
    if (fileSha256 !== input.fileSha256.trim()) {
      throw new BadRequestException("导入文件已发生变化，请重新预检后再生成接管草稿");
    }
    const parsed = await this.parseWorkbook(buffer);
    if (parsed.errors.length) {
      throw new BadRequestException("导入文件仍有格式错误，请修正后重新预检");
    }
    if (fingerprint(parsed.rows) !== input.importFingerprint.trim()) {
      throw new BadRequestException("导入内容与预检结果不一致，请重新预检");
    }
    return this.takeovers.createDraftsFromImport(
      projectId,
      {
        rows: parsed.rows,
        takeoverCutoffDate: input.takeoverCutoffDate,
        responsibleUserId: input.responsibleUserId,
        reviewComment: input.reviewComment,
        acceptanceConclusion: input.acceptanceConclusion
      },
      actorUserId
    );
  }

  private async loadOwnedWorkbook(fileIdInput: string, actorUserId: string) {
    const fileId = fileIdInput?.trim();
    if (!fileId) throw new BadRequestException("请选择历史合同导入文件");
    const result = await this.files.getFileBuffer(fileId);
    const { file, buffer } = result;
    if (file.storageStatus !== "active") {
      throw new BadRequestException("历史合同导入文件已失效，请重新上传");
    }
    if (file.uploadedByUserId !== actorUserId) {
      throw new BadRequestException("只能使用当前账号上传的历史合同导入文件");
    }
    if (
      file.sizeBytes !== buffer.length ||
      buffer.length > MAX_FILE_BYTES ||
      file.mimeType !== XLSX_MIME ||
      !file.originalName.toLowerCase().endsWith(".xlsx")
    ) {
      throw new BadRequestException("历史合同导入只支持不超过 10 MB 的 XLSX 文件");
    }
    return result;
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
    this.assertSafeXlsxArchive(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("Excel 文件无法读取，请重新下载模板填写");
    }
    const main = workbook.getWorksheet(MAIN_SHEET);
    const pricing = workbook.getWorksheet(PRICING_SHEET);
    if (!main || !pricing) {
      throw new BadRequestException("Excel 必须保留“合同主表”和“计价清单”两个工作表");
    }
    this.assertNoFormulas(main);
    this.assertNoFormulas(pricing);
    this.assertHeaders(main, MAIN_HEADERS);
    this.assertHeaders(pricing, PRICING_HEADERS);

    const errors: ContractTakeoverExcelIssue[] = [];
    const pricingByCode = this.parsePricingRows(pricing, errors);
    const rows: Record<string, unknown>[] = [];
    main.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || isEmptyRow(row.values as CellValue[])) return;
      const values = rowValues(row.values as CellValue[], MAIN_HEADERS.length);
      const code = text(values[0]);
      const amountText = text(values[6]);
      let amountCents = amountText;
      try {
        amountCents = yuanTextToCents(amountText, "合同金额").toString();
      } catch (error) {
        errors.push({
          sheet: MAIN_SHEET,
          row: rowNumber,
          column: "合同金额(元)",
          message: error instanceof Error ? error.message : "合同金额格式不正确"
        });
      }
      rows.push({
        code,
        name: text(values[1]),
        counterparty: text(values[2]),
        contractTypeKey: text(values[3]),
        companyEntityId: text(values[4]),
        companyEntityName: text(values[5]),
        amountCents,
        signedAt: dateText(values[7]),
        takeoverLevel: text(values[8]),
        lifecycleStatus: text(values[9]),
        paymentTermsOriginalText: text(values[10]),
        invoiceType: invoiceTypeValue(values[11]),
        taxMode: taxModeValue(values[12]),
        defaultTaxRatePercent: text(values[13]),
        taxFactSource: taxFactSourceValue(values[14]),
        taxFactExplanation: text(values[15]),
        pricingItems: pricingByCode.get(code) ?? []
      });
    });
    if (!rows.length) {
      errors.push({
        sheet: MAIN_SHEET,
        row: 2,
        column: "合同编号",
        message: "请至少填写一份历史合同"
      });
    }
    return { rows, errors };
  }

  private parsePricingRows(
    sheet: Worksheet,
    errors: ContractTakeoverExcelIssue[]
  ): Map<string, Record<string, unknown>[]> {
    const result = new Map<string, Record<string, unknown>[]>();
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || isEmptyRow(row.values as CellValue[])) return;
      const values = rowValues(row.values as CellValue[], PRICING_HEADERS.length);
      const code = text(values[0]);
      const quantity = text(values[8]);
      const unitPrice = text(values[9]);
      for (const [value, column] of [
        [quantity, "预计数量"],
        [unitPrice, "含税单价(元)"]
      ] as const) {
        if (value && !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) {
          errors.push({
            sheet: PRICING_SHEET,
            row: rowNumber,
            column,
            message: `${column}必须是非负数字且最多保留 2 位小数`
          });
        }
      }
      const item = {
        billKey: text(values[1]),
        billName: text(values[2]),
        rowKey: text(values[3]),
        itemCode: text(values[4]),
        itemName: text(values[5]),
        specification: text(values[6]),
        unit: text(values[7]),
        estimatedQuantity: quantity || undefined,
        taxInclusiveUnitPrice: unitPrice || undefined,
        taxRatePercentOverride: text(values[10]) || undefined,
        isProvisional: booleanValue(values[11]),
        settlementBasis: text(values[12])
      };
      result.set(code, [...(result.get(code) ?? []), item]);
    });
    return result;
  }

  private assertHeaders(sheet: Worksheet, expected: readonly string[]) {
    const actual = rowValues(sheet.getRow(1).values as CellValue[], expected.length).map(text);
    if (actual.some((value, index) => value !== expected[index])) {
      throw new BadRequestException(`“${sheet.name}”第一行表头已被修改，请重新下载模板`);
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
          throw new BadRequestException("Excel 不允许使用公式，请粘贴为数值后重新导入");
        }
      })
    );
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

  private styleHeader(sheet: Worksheet, count: number) {
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center" };
    for (let index = 1; index <= count; index += 1) {
      header.getCell(index).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF8" }
      };
    }
  }
}

function rowValues(values: CellValue[], length: number): CellValue[] {
  return Array.from({ length }, (_, index) => values[index + 1] ?? null);
}

function isEmptyRow(values: CellValue[]): boolean {
  return rowValues(values, Math.max(0, values.length - 1)).every((value) => !text(value));
}

function text(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return dateText(value);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return text(value.result as CellValue);
    return "";
  }
  return String(value).trim();
}

function dateText(value: CellValue): string {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return text(value);
}

function booleanValue(value: CellValue): boolean {
  return ["是", "true", "1", "yes"].includes(text(value).toLowerCase());
}

function invoiceTypeValue(value: CellValue): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (["增值税普通发票", "普通发票", "vat_general"].includes(raw)) return "vat_general";
  if (["增值税专用发票", "专用发票", "vat_special"].includes(raw)) return "vat_special";
  return raw;
}

function taxModeValue(value: CellValue): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (["单一税率", "single_rate"].includes(raw)) return "single_rate";
  if (["特殊多税率", "multiple_rate"].includes(raw)) return "multiple_rate";
  return raw;
}

function taxFactSourceValue(value: CellValue): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (["合同文件明确", "contract_document"].includes(raw)) return "contract_document";
  if (["依据补充资料确认", "supplement_evidence"].includes(raw)) return "supplement_evidence";
  if (["经业务与财务复核确认", "business_finance_confirmation"].includes(raw)) {
    return "business_finance_confirmation";
  }
  return raw;
}

function fingerprint(rows: Record<string, unknown>[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
