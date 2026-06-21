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

export const auditLogRows: AuditLogRow[] = [];

export const auditRequiredActions = [
  "登录、审批动作必须写入审计日志",
  "合同/结算归档上传与确认必须写入审计日志",
  "付款执行、付款凭证上传必须写入审计日志",
  "敏感文件下载、权限变更、单据作废必须写入审计日志"
];
