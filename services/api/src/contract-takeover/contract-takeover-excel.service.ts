import { createHash } from "node:crypto";
import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import {
  contractInvoiceTypeLabel,
  contractTaxFactSourceLabel,
  contractTaxModeLabel
} from "@jiangkong/shared-domain";
import * as ExcelJS from "exceljs";
import type { CellValue, Worksheet } from "exceljs";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { ContractTaxFactsService } from "../contract-tax-facts/contract-tax-facts.service";
import {
  buildLedgerWorkbook,
  shanghaiDateStamp,
  XLSX_MIME
} from "../core-flow/ledger-excel";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  formatMoneyCentsAsYuan,
  yuanTextToCents
} from "../money/decimal-money";
import { ContractTakeoverService } from "./contract-takeover.service";
import type {
  ApplyContractTakeoverExcelDto,
  PreviewContractTakeoverExcelDto
} from "./dto/contract-takeover-excel.dto";

const MAIN_SHEET = "合同主表";
const PRICING_SHEET = "计价清单";
const INSTRUCTIONS_SHEET = "填写说明";
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
    private readonly takeovers: ContractTakeoverService,
    @Optional()
    private readonly taxFacts?: ContractTaxFactsService,
    @Optional()
    private readonly audit?: AuditService,
    @Optional()
    private readonly prisma?: PrismaService
  ) {}

  async exportTemplate() {
    const workbook = new ExcelJS.Workbook();
    const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET);
    instructions.addRows([
      ["历史合同接管导入说明"],
      ["1. 合同主表每份合同一行，合同编号必须唯一。"],
      ["2. 计价清单可按合同编号填写多行；资料不明确的数量、含税单价或税率可以留空。"],
      ["3. 数量和含税单价最多保留 2 位小数；税率必须在 0 到 100 之间。"],
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

  async exportLedger(projectId: string, actorUserId: string) {
    const takeovers = await this.takeovers.list(projectId);
    const rows = takeovers.map((takeover) => ({
      contractNo: takeover.contractNo,
      contractName: takeover.contractName,
      counterparty: takeover.counterparty,
      companyEntityName: takeover.companyEntityName ?? "—",
      amount: this.money(takeover.amountCents),
      signedAt: this.date(takeover.signedAt),
      takeoverLevel: takeover.takeoverLevel,
      lifecycleStatus: lifecycleStatusLabel(takeover.lifecycleStatus),
      takeoverStatus: takeoverStatusLabel(takeover.takeoverStatus),
      invoiceType: takeover.invoiceType
        ? safeContractInvoiceTypeLabel(takeover.invoiceType)
        : "原合同未明确",
      taxMode: safeContractTaxModeLabel(takeover.taxMode),
      defaultTaxRate: takeover.defaultTaxRatePercent
        ? `${takeover.defaultTaxRatePercent}%`
        : "原合同未明确",
      taxFactStatus: taxFactStatusLabel(takeover.taxFactStatus),
      historicalSettled: this.money(takeover.historicalSettledCents),
      historicalPaid: this.money(takeover.historicalPaidCents),
      historicalApprovedPendingPayment: this.money(
        takeover.historicalApprovedPendingPaymentCents
      ),
      responsibleUserName: takeover.responsibleUserName ?? "—",
      cutoffDate: this.date(takeover.takeoverCutoffDate),
      evidenceGap: takeover.evidenceGapSummary,
      updatedAt: this.date(takeover.updatedAt)
    }));
    const buffer = await buildLedgerWorkbook({
      sheetName: "接管台账",
      columns: [
        { header: "合同编号", key: "contractNo", width: 20 },
        { header: "合同名称", key: "contractName", width: 28 },
        { header: "相对方", key: "counterparty", width: 24 },
        { header: "我方签约主体", key: "companyEntityName", width: 22 },
        { header: "合同金额", key: "amount", width: 18 },
        { header: "签订日期", key: "signedAt", width: 14 },
        { header: "接管等级", key: "takeoverLevel", width: 12 },
        { header: "履约状态", key: "lifecycleStatus", width: 14 },
        { header: "接管状态", key: "takeoverStatus", width: 14 },
        { header: "发票类型", key: "invoiceType", width: 20 },
        { header: "计税模式", key: "taxMode", width: 16 },
        { header: "默认税率", key: "defaultTaxRate", width: 14 },
        { header: "税务事实状态", key: "taxFactStatus", width: 16 },
        { header: "历史累计结算", key: "historicalSettled", width: 18 },
        { header: "历史累计已付", key: "historicalPaid", width: 18 },
        {
          header: "历史已批待付",
          key: "historicalApprovedPendingPayment",
          width: 18
        },
        { header: "接管责任人", key: "responsibleUserName", width: 16 },
        { header: "接管截止日", key: "cutoffDate", width: 14 },
        { header: "资料缺口", key: "evidenceGap", width: 28 },
        { header: "更新时间", key: "updatedAt", width: 22 }
      ],
      rows
    });

    await this.recordExportAudit({
      actorUserId,
      action: "contract.takeover.ledger.export",
      businessType: "contract_takeover_ledger",
      businessId: projectId,
      metadata: { exportedRows: rows.length }
    });

    return {
      buffer,
      fileName: `历史合同接管台账-${shanghaiDateStamp()}.xlsx`
    };
  }

  async exportDetail(
    projectId: string,
    takeoverId: string,
    actorUserId: string
  ) {
    const [takeover, taxFacts] = await Promise.all([
      this.takeovers.detail(projectId, takeoverId),
      this.requireTaxFacts().list(projectId, takeoverId)
    ]);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "建工智管";
    workbook.created = new Date();

    const detail = workbook.addWorksheet("接管详情");
    detail.columns = [
      { header: "字段", key: "label", width: 24 },
      { header: "内容", key: "value", width: 68 }
    ];
    detail.addRows([
      { label: "合同编号", value: takeover.contractNo },
      { label: "合同名称", value: takeover.contractName },
      { label: "相对方", value: takeover.counterparty },
      { label: "我方签约主体", value: takeover.companyEntityName ?? "—" },
      { label: "合同金额", value: this.money(takeover.amountCents) },
      { label: "签订日期", value: this.date(takeover.signedAt) },
      { label: "接管等级", value: takeover.takeoverLevel },
      { label: "履约状态", value: lifecycleStatusLabel(takeover.lifecycleStatus) },
      { label: "接管状态", value: takeoverStatusLabel(takeover.takeoverStatus) },
      {
        label: "发票类型",
        value: takeover.invoiceType
          ? safeContractInvoiceTypeLabel(takeover.invoiceType)
          : "原合同未明确"
      },
      { label: "计税模式", value: safeContractTaxModeLabel(takeover.taxMode) },
      {
        label: "默认税率",
        value: takeover.defaultTaxRatePercent
          ? `${takeover.defaultTaxRatePercent}%`
          : "原合同未明确"
      },
      {
        label: "税务事实来源",
        value: takeover.taxFactSource
          ? safeContractTaxFactSourceLabel(takeover.taxFactSource)
          : "—"
      },
      { label: "税务确认说明", value: takeover.taxFactExplanation ?? "—" },
      {
        label: "税务事实缺口",
        value: takeover.taxFactMissingFields.length
          ? takeover.taxFactMissingFields.join("、")
          : "无"
      },
      { label: "付款条款摘要", value: takeover.paymentTermsOriginalText || "—" },
      {
        label: "历史累计结算",
        value: this.money(takeover.historicalSettledCents)
      },
      {
        label: "历史审批中付款",
        value: this.money(takeover.historicalApprovalPendingPaymentCents)
      },
      {
        label: "历史已批待付",
        value: this.money(takeover.historicalApprovedPendingPaymentCents)
      },
      { label: "历史累计已付", value: this.money(takeover.historicalPaidCents) },
      { label: "历史总包代付", value: this.money(takeover.historicalProxyPaidCents) },
      {
        label: "历史预付款已付",
        value: this.money(takeover.historicalAdvancePaidCents)
      },
      {
        label: "历史预付款已扣回",
        value: this.money(takeover.historicalAdvanceDeductedCents)
      },
      {
        label: "历史质保金扣留",
        value: this.money(takeover.historicalRetentionWithheldCents)
      },
      {
        label: "历史质保金释放",
        value: this.money(takeover.historicalRetentionReleasedCents)
      },
      {
        label: "其他确认占用",
        value: this.money(takeover.otherConfirmedOccupancyCents)
      },
      { label: "余额来源", value: takeover.balanceSourceSummary ?? "—" },
      { label: "证据说明", value: takeover.evidenceSummary ?? "—" },
      { label: "接管责任人", value: takeover.responsibleUserName ?? "—" },
      { label: "复核意见", value: takeover.reviewComment ?? "—" },
      { label: "验收结论", value: takeover.acceptanceConclusion ?? "—" },
      { label: "接管截止日", value: this.date(takeover.takeoverCutoffDate) },
      { label: "提交时间", value: this.date(takeover.submittedAt) },
      { label: "确认时间", value: this.date(takeover.confirmedAt) }
    ]);
    this.styleExportSheet(detail);

    const pricing = workbook.addWorksheet("历史计价");
    pricing.columns = [
      { header: "清单", key: "billName", width: 22 },
      { header: "项目编号", key: "itemCode", width: 16 },
      { header: "名称", key: "itemName", width: 24 },
      { header: "规格型号", key: "specification", width: 18 },
      { header: "单位", key: "unit", width: 10 },
      { header: "预计数量", key: "estimatedQuantity", width: 14 },
      { header: "含税单价（元）", key: "taxInclusiveUnitPrice", width: 18 },
      { header: "税率", key: "taxRatePercent", width: 12 },
      { header: "价格状态", key: "pricingFactStatus", width: 16 },
      { header: "暂定项目", key: "isProvisional", width: 12 },
      { header: "结算依据", key: "settlementBasis", width: 30 }
    ];
    pricing.addRows(
      takeover.pricingItems.map((item) => ({
        billName: item.billName,
        itemCode: item.itemCode ?? "—",
        itemName: item.itemName,
        specification: item.specification ?? "—",
        unit: item.unit,
        estimatedQuantity: item.estimatedQuantity ?? "—",
        taxInclusiveUnitPrice: item.taxInclusiveUnitPrice ?? "—",
        taxRatePercent: item.taxRatePercent ? `${item.taxRatePercent}%` : "—",
        pricingFactStatus: pricingFactStatusLabel(item.pricingFactStatus),
        isProvisional: item.isProvisional ? "是" : "否",
        settlementBasis: item.settlementBasis ?? "—"
      }))
    );
    this.styleExportSheet(pricing);

    const revisions = workbook.addWorksheet("税务修订");
    revisions.columns = [
      { header: "记录类型", key: "recordType", width: 14 },
      { header: "修订号", key: "revisionNo", width: 10 },
      { header: "修订性质", key: "kind", width: 12 },
      { header: "状态", key: "status", width: 18 },
      { header: "发票类型", key: "invoiceType", width: 20 },
      { header: "计税模式", key: "taxMode", width: 16 },
      { header: "默认税率", key: "defaultTaxRate", width: 14 },
      { header: "事实来源", key: "source", width: 20 },
      { header: "确认说明", key: "explanation", width: 34 },
      { header: "清单价格事实", key: "rowFactCount", width: 14 },
      { header: "提交时间", key: "submittedAt", width: 22 },
      { header: "财务复核时间", key: "financeReviewedAt", width: 22 },
      { header: "财务意见", key: "financeComment", width: 28 },
      { header: "合同部确认时间", key: "confirmedAt", width: 22 },
      { header: "合同部意见", key: "contractComment", width: 28 }
    ];
    revisions.addRow({
      recordType: "当前事实",
      revisionNo: taxFacts.current.revision,
      kind: "—",
      status: taxFactStatusLabel(taxFacts.current.status),
      invoiceType: taxFacts.current.invoiceType
        ? safeContractInvoiceTypeLabel(taxFacts.current.invoiceType)
        : "原合同未明确",
      taxMode: safeContractTaxModeLabel(taxFacts.current.taxMode),
      defaultTaxRate: taxFacts.current.defaultTaxRatePercent
        ? `${taxFacts.current.defaultTaxRatePercent}%`
        : "—",
      source: taxFacts.current.source
        ? safeContractTaxFactSourceLabel(taxFacts.current.source)
        : "—",
      explanation: taxFacts.current.confirmationExplanation ?? "—",
      rowFactCount: taxFacts.rows.length,
      submittedAt: "—",
      financeReviewedAt: "—",
      financeComment: "—",
      confirmedAt: "—",
      contractComment: "—"
    });
    revisions.addRows(
      taxFacts.revisions.map((revision) => ({
        recordType: "修订记录",
        revisionNo: revision.revisionNo,
        kind: revision.kind === "correction" ? "更正" : "补录",
        status: revisionStatusLabel(revision.status),
        invoiceType: revision.invoiceType
          ? safeContractInvoiceTypeLabel(revision.invoiceType)
          : "—",
        taxMode: revision.taxMode ? safeContractTaxModeLabel(revision.taxMode) : "—",
        defaultTaxRate: revision.defaultTaxRatePercent
          ? `${revision.defaultTaxRatePercent}%`
          : "—",
        source: revision.source ? safeContractTaxFactSourceLabel(revision.source) : "—",
        explanation: revision.confirmationExplanation ?? "—",
        rowFactCount: revision.rowFacts.length,
        submittedAt: this.date(revision.submittedAt),
        financeReviewedAt: this.date(revision.financeReviewedAt),
        financeComment: revision.financeReviewComment ?? "—",
        confirmedAt: this.date(revision.confirmedAt),
        contractComment: revision.contractReviewComment ?? "—"
      }))
    );
    this.styleExportSheet(revisions);

    const currentTaxRowById = new Map(
      taxFacts.rows.map((row) => [row.contractBillRowId, row])
    );
    const taxRevisionDetailRows = taxFacts.revisions.flatMap((revision) => {
      const beforeRows = taxFactBeforeRows(revision.beforeSnapshot);
      const beforeRowById = new Map(
        beforeRows.map((row) => [row.contractBillRowId, row])
      );
      return revision.rowFacts.map((rowFact) => {
        const currentRow = currentTaxRowById.get(rowFact.contractBillRowId);
        const beforeRow = beforeRowById.get(rowFact.contractBillRowId);
        return {
          revisionNo: revision.revisionNo,
          revisionKind: revision.kind === "correction" ? "更正" : "补录",
          revisionStatus: revisionStatusLabel(revision.status),
          billName: currentRow?.billName ?? "合同清单",
          itemName: currentRow?.itemName ?? "清单项目未读取",
          specification: currentRow?.specification ?? "—",
          unit: currentRow?.unit ?? "—",
          beforeUnitPrice: beforeRow?.taxInclusiveUnitPrice ?? "—",
          afterUnitPrice: rowFact.taxInclusiveUnitPrice ?? "—",
          beforeTaxRate: beforeRow?.taxRatePercent
            ? `${beforeRow.taxRatePercent}%`
            : "—",
          afterTaxRate: rowFact.taxRatePercentOverride
            ? `${rowFact.taxRatePercentOverride}%`
            : "继承默认税率"
        };
      });
    });
    const revisionDetails = workbook.addWorksheet("税务修订明细");
    revisionDetails.columns = [
      { header: "修订号", key: "revisionNo", width: 10 },
      { header: "修订性质", key: "revisionKind", width: 12 },
      { header: "状态", key: "revisionStatus", width: 18 },
      { header: "清单", key: "billName", width: 22 },
      { header: "项目名称", key: "itemName", width: 24 },
      { header: "规格型号", key: "specification", width: 18 },
      { header: "单位", key: "unit", width: 10 },
      { header: "修订前含税单价（元）", key: "beforeUnitPrice", width: 20 },
      { header: "修订后含税单价（元）", key: "afterUnitPrice", width: 20 },
      { header: "修订前税率", key: "beforeTaxRate", width: 16 },
      { header: "修订后税率", key: "afterTaxRate", width: 16 }
    ];
    revisionDetails.addRows(taxRevisionDetailRows);
    this.styleExportSheet(revisionDetails);

    const evidence = workbook.addWorksheet("资料与更正");
    evidence.columns = [
      { header: "记录类型", key: "recordType", width: 16 },
      { header: "名称/事项", key: "name", width: 28 },
      { header: "状态/类型", key: "status", width: 18 },
      { header: "责任人/上传人", key: "operator", width: 18 },
      { header: "时间", key: "occurredAt", width: 22 },
      { header: "说明", key: "description", width: 58 }
    ];
    evidence.addRows([
      ...takeover.evidenceFiles.map((file) => ({
        recordType: "接管资料",
        name: file.fileName,
        status: file.purposeLabel,
        operator: file.uploadedByName,
        occurredAt: this.date(file.uploadedAt),
        description: `文件类型：${file.mimeType}；大小：${file.sizeBytes} 字节`
      })),
      ...takeover.corrections.map((correction) => ({
        recordType: "更正记录",
        name: correction.correctionTypeLabel,
        status: correction.reason,
        operator: correction.createdByName,
        occurredAt: this.date(correction.createdAt),
        description: `更正前：${correction.beforeSummary}；更正后：${correction.afterSummary}；责任人：${correction.responsibleUserName}；依据附件：${correction.attachmentFileName}`
      }))
    ]);
    this.styleExportSheet(evidence);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.recordExportAudit({
      actorUserId,
      action: "contract.takeover.detail.export",
      businessType: "contract_takeover",
      businessId: takeoverId,
      metadata: {
        pricingRows: takeover.pricingItems.length,
        taxRevisionRows: taxFacts.revisions.length,
        taxRevisionDetailRows: taxRevisionDetailRows.length,
        evidenceRows: takeover.evidenceFiles.length,
        correctionRows: takeover.corrections.length
      }
    });

    return {
      buffer,
      fileName: `${safeFileName(takeover.contractNo)}-历史接管详情-${shanghaiDateStamp()}.xlsx`
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

  private requireTaxFacts() {
    if (!this.taxFacts) {
      throw new Error("税务事实修订服务暂不可用，请稍后重试");
    }
    return this.taxFacts;
  }

  private async recordExportAudit(input: {
    actorUserId: string;
    action: string;
    businessType: string;
    businessId: string;
    metadata: Record<string, string | number>;
  }) {
    if (!this.audit || !this.prisma) {
      throw new Error("导出审计服务暂不可用，请稍后重试");
    }
    await this.audit.record(this.prisma, input);
  }

  private styleExportSheet(sheet: Worksheet) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (sheet.columnCount > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columnCount }
      };
    }
    const header = sheet.getRow(1);
    header.height = 24;
    header.font = { bold: true, color: { argb: "FF1F2329" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF2F3F5" }
    };
    header.alignment = { vertical: "middle", horizontal: "center" };
    sheet.eachRow((row) => {
      row.alignment = { vertical: "middle", wrapText: true };
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFDCDCDC" } },
          left: { style: "thin", color: { argb: "FFDCDCDC" } },
          bottom: { style: "thin", color: { argb: "FFDCDCDC" } },
          right: { style: "thin", color: { argb: "FFDCDCDC" } }
        };
      });
    });
  }

  private money(value: string | bigint) {
    try {
      return `¥${formatMoneyCentsAsYuan(BigInt(value))}`;
    } catch {
      return "—";
    }
  }

  private date(value: string | Date | null | undefined) {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", {
      hour12: false,
      timeZone: "Asia/Shanghai"
    });
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

function lifecycleStatusLabel(value: string) {
  const labels: Record<string, string> = {
    signed_not_started: "已签未开工",
    in_progress: "履约中",
    suspended: "暂停履约",
    completed: "已完工",
    terminated: "已终止",
    disputed: "存在争议"
  };
  return labels[value] ?? "状态未读取";
}

function takeoverStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    pending_review: "待复核",
    confirmed: "已接管",
    needs_supplement: "待补充",
    voided: "已作废"
  };
  return labels[value] ?? "状态未读取";
}

function taxFactStatusLabel(value: string) {
  const labels: Record<string, string> = {
    unconfirmed: "未明确",
    draft: "草稿",
    frozen: "随审批冻结",
    pending_finance_review: "待财务复核",
    pending_contract_confirmation: "待合同部确认",
    confirmed: "已确认"
  };
  return labels[value] ?? "状态未读取";
}

function safeContractInvoiceTypeLabel(value: string) {
  if (value === "vat_general" || value === "vat_special") {
    return contractInvoiceTypeLabel(value);
  }
  return "发票类型未读取";
}

function safeContractTaxModeLabel(value: string) {
  if (value === "single_rate" || value === "multiple_rate") {
    return contractTaxModeLabel(value);
  }
  return "计税模式未读取";
}

function safeContractTaxFactSourceLabel(value: string) {
  if (
    value === "contract_document" ||
    value === "supplement_evidence" ||
    value === "business_finance_confirmation"
  ) {
    return contractTaxFactSourceLabel(value);
  }
  return "事实来源未读取";
}

function pricingFactStatusLabel(value: string) {
  const labels: Record<string, string> = {
    unconfirmed: "未明确",
    confirmed: "已确认",
    provisional: "暂定"
  };
  return labels[value] ?? value;
}

function revisionStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    pending_finance_review: "待财务复核",
    pending_contract_confirmation: "待合同部确认",
    confirmed: "已确认",
    rejected: "已退回"
  };
  return labels[value] ?? "状态未读取";
}

interface TaxFactBeforeRow {
  contractBillRowId: string;
  taxInclusiveUnitPrice: string | null;
  taxRatePercent: string | null;
}

function taxFactBeforeRows(snapshot: Record<string, unknown>): TaxFactBeforeRow[] {
  const rows = snapshot["rows"];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    if (typeof value["contractBillRowId"] !== "string") return [];
    return [
      {
        contractBillRowId: value["contractBillRowId"],
        taxInclusiveUnitPrice:
          typeof value["taxInclusiveUnitPrice"] === "string"
            ? value["taxInclusiveUnitPrice"]
            : null,
        taxRatePercent:
          typeof value["taxRatePercent"] === "string"
            ? value["taxRatePercent"]
            : null
      }
    ];
  });
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/gu, "_").trim() || "历史合同";
}

function fingerprint(rows: Record<string, unknown>[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
