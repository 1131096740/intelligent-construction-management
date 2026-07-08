import type { PrimaryTableCol } from "tdesign-vue-next";

export type AuditTone = "default" | "primary" | "warning" | "danger" | "success";

export interface AuditFilterField {
  key: string;
  label: string;
  placeholder: string;
  type: "select" | "dateRange" | "keyword";
}

export interface AuditSummaryItem {
  label: string;
  value: string;
  tone: AuditTone;
}

export interface AuditLogRow {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  actionTone: AuditTone;
  businessType: string;
  businessTarget: string;
  ipAddress: string;
  resultRisk: string;
  riskTone: AuditTone;
  trace: string;
}

export interface FileDownloadAuditRow {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  actionKey: "file.download.ticket" | "file.download";
  fileId: string;
  fileName: string;
  businessType: string;
  businessTarget: string;
  downloadReason: string;
  ipAddress: string;
  traceId: string;
  sensitive: string;
}

export interface FileDownloadAuditFilters {
  actor: string;
  fileName: string;
  downloadReason: string;
  keyword: string;
}

export const auditFilterFields: AuditFilterField[] = [
  {
    key: "actor",
    label: "操作人",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "action",
    label: "动作类型",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "businessType",
    label: "业务类型",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "dateRange",
    label: "时间范围",
    placeholder: "最近30天",
    type: "dateRange"
  },
  {
    key: "keyword",
    label: "关键词",
    placeholder: "业务编号/IP/操作说明",
    type: "keyword"
  }
];

export const auditSummaryItems: AuditSummaryItem[] = [
  { label: "全部日志", value: "0", tone: "default" },
  { label: "登录日志", value: "0", tone: "primary" },
  { label: "审批动作", value: "0", tone: "success" },
  { label: "文件操作", value: "0", tone: "warning" },
  { label: "权限/安全", value: "0", tone: "danger" }
];

export const auditLedgerColumns: PrimaryTableCol<AuditLogRow>[] = [
  { colKey: "occurredAt", title: "发生时间", width: 112 },
  { colKey: "actor", title: "操作人", width: 96 },
  { colKey: "action", title: "动作类型", width: 104 },
  { colKey: "businessType", title: "业务类型", width: 96 },
  { colKey: "businessTarget", title: "业务对象", minWidth: 130 },
  { colKey: "ipAddress", title: "IP地址", width: 104 },
  { colKey: "resultRisk", title: "结果/风险", width: 104 },
  { colKey: "trace", title: "追溯信息", minWidth: 120 },
  { colKey: "operation", title: "操作", width: 64, fixed: "right" }
];

export const fileDownloadAuditColumns: PrimaryTableCol<FileDownloadAuditRow>[] = [
  { colKey: "occurredAt", title: "发生时间", width: 150 },
  { colKey: "actor", title: "操作人", width: 100 },
  { colKey: "action", title: "动作", width: 108 },
  { colKey: "fileName", title: "文件名", minWidth: 180 },
  { colKey: "downloadReason", title: "下载原因", minWidth: 180 },
  { colKey: "businessTarget", title: "业务对象", minWidth: 128 },
  { colKey: "ipAddress", title: "IP地址", width: 112 },
  { colKey: "traceId", title: "追溯ID", minWidth: 128 },
  { colKey: "sensitive", title: "脱敏说明", minWidth: 150 }
];

export const auditLogRows: AuditLogRow[] = [];

export const auditRequiredActions = [
  "登录、审批动作必须写入审计日志",
  "合同/结算归档上传与确认必须写入审计日志",
  "付款执行、付款凭证上传必须写入审计日志",
  "敏感文件下载、权限变更、单据作废必须写入审计日志"
];

export function emptyFileDownloadAuditFilters(): FileDownloadAuditFilters {
  return {
    actor: "",
    fileName: "",
    downloadReason: "",
    keyword: ""
  };
}

export function filterFileDownloadAuditRows(
  rows: FileDownloadAuditRow[],
  filters: FileDownloadAuditFilters
): FileDownloadAuditRow[] {
  return rows.filter(
    (row) =>
      includesText(row.actor, filters.actor) &&
      includesText(row.fileName, filters.fileName) &&
      includesText(row.downloadReason, filters.downloadReason) &&
      includesAny(
        [
          row.action,
          row.actionKey,
          row.businessType,
          row.businessTarget,
          row.fileId,
          row.ipAddress,
          row.traceId
        ],
        filters.keyword
      )
  );
}

function includesText(value: string, keyword: string): boolean {
  const query = keyword.trim().toLowerCase();
  return !query || value.toLowerCase().includes(query);
}

function includesAny(values: string[], keyword: string): boolean {
  return values.some((value) => includesText(value, keyword));
}
