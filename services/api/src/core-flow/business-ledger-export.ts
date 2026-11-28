import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import {
  buildLedgerWorkbook,
  shanghaiDateStamp,
  type LedgerExcelColumn,
  type LedgerExcelPrintOptions,
  type LedgerExcelTotalsOptions
} from "./ledger-excel";
import {
  resolveLedgerExportColumns,
  type NormalizedLedgerExportQuery
} from "./ledger-export-query";

/**
 * 业务台账导出的统一收口：按当前显示列生成工作簿、写入筛选条件与
 * 实际导出行数审计。
 *
 * 调用方必须先完成行级可见性过滤；本函数不读取数据、不扩大范围，
 * 只负责把「已经可见且已筛选」的行写成业务 Excel。
 */
export interface BusinessLedgerExportInput<Row extends Record<string, unknown>> {
  prisma: PrismaService;
  audit: AuditService | undefined;
  actorUserId: string;
  action: string;
  businessType: string;
  scope: string;
  sheetName: string;
  fileNamePrefix: string;
  columns: readonly LedgerExcelColumn<Row>[];
  rows: readonly Row[];
  columnKeys?: readonly string[];
  filters: NormalizedLedgerExportQuery;
  visibleProjectCount: number;
  totals?: LedgerExcelTotalsOptions | false;
  print?: LedgerExcelPrintOptions;
}

export async function exportBusinessLedger<Row extends Record<string, unknown>>(
  input: BusinessLedgerExportInput<Row>
): Promise<{ buffer: Buffer; fileName: string }> {
  const selectedColumns = resolveLedgerExportColumns(input.columns, input.columnKeys);
  const buffer = await buildLedgerWorkbook({
    sheetName: input.sheetName,
    columns: selectedColumns,
    rows: input.rows,
    totals: input.totals ?? { label: "合计", note: "不含待确定金额" },
    print: input.print ?? { landscape: true }
  });

  if (!input.audit) {
    throw new Error(`${input.fileNamePrefix}导出审计服务暂不可用，请稍后重试`);
  }
  await input.audit.record(input.prisma, {
    actorUserId: input.actorUserId,
    action: input.action,
    businessType: input.businessType,
    metadata: {
      exportedRows: input.rows.length,
      visibleProjectCount: input.visibleProjectCount,
      scope: input.scope,
      filters: {
        projectId: input.filters.projectId ?? null,
        dateFrom: input.filters.dateFrom ?? null,
        dateTo: input.filters.dateTo ?? null,
        status: input.filters.status ?? null,
        keyword: input.filters.keyword ?? null
      },
      exportedColumns: selectedColumns.map((column) => String(column.key))
    }
  });

  return {
    buffer,
    fileName: `${input.fileNamePrefix}-${shanghaiDateStamp()}.xlsx`
  };
}

/** 导出响应头，避免每个控制器重复拼接。 */
export function ledgerExportHeaders(result: { buffer: Buffer; fileName: string }) {
  return {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    "Content-Length": String(result.buffer.length)
  };
}
