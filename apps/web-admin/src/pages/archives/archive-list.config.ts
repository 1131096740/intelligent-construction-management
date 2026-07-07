import type { PrimaryTableCol } from "tdesign-vue-next";

export type ArchiveTone = "default" | "primary" | "warning" | "success";

export interface ArchiveFilterField {
  key: string;
  label: string;
  placeholder: string;
  type: "select" | "keyword";
}

export interface ArchiveSummaryItem {
  label: string;
  value: string;
  tone: ArchiveTone;
}

export interface ArchiveLedgerRow {
  id: string;
  documentNo: string;
  fileId: string;
  documentType: string;
  businessRef: string;
  project: string;
  fileSource: string;
  fileSizeBytes: number;
  canDownload: boolean;
  disabledReason: string | null;
  archiveStatus: string;
  statusTone: ArchiveTone;
  uploadDepartment: string;
  confirmedBy: string;
  lastAction: string;
}

export const archiveFilterFields: ArchiveFilterField[] = [
  {
    key: "project",
    label: "项目",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "documentType",
    label: "资料类型",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "archiveStatus",
    label: "归档状态",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "uploadDepartment",
    label: "上传部门",
    placeholder: "全部",
    type: "select"
  },
  {
    key: "keyword",
    label: "关键词",
    placeholder: "编号/合同/结算/付款",
    type: "keyword"
  }
];

export const archiveSummaryItems: ArchiveSummaryItem[] = [
  { label: "全部资料", value: "0", tone: "default" },
  { label: "合同归档件", value: "0", tone: "primary" },
  { label: "结算归档件", value: "0", tone: "primary" },
  { label: "付款凭证", value: "0", tone: "success" },
  { label: "待确认", value: "0", tone: "warning" }
];

export const archiveLedgerColumns: PrimaryTableCol<ArchiveLedgerRow>[] = [
  { colKey: "documentNo", title: "资料编号", width: 96 },
  { colKey: "documentType", title: "资料类型", width: 96 },
  { colKey: "businessRef", title: "关联业务", minWidth: 120 },
  { colKey: "project", title: "项目", minWidth: 100 },
  { colKey: "fileSource", title: "文件来源", width: 96 },
  { colKey: "archiveStatus", title: "归档状态", width: 96 },
  { colKey: "uploadDepartment", title: "上传部门", width: 88 },
  { colKey: "confirmedBy", title: "确认/入账人", width: 104 },
  { colKey: "lastAction", title: "最近操作", width: 96 },
  { colKey: "operation", title: "操作", width: 88, fixed: "right" }
];

export const archiveLedgerRows: ArchiveLedgerRow[] = [];

export const archiveRules = [
  "合同/结算归档件由合同部上传并由合同部主管确认",
  "付款凭证由出纳/财务上传并关联实际付款记录",
  "敏感文件必须经后台权限校验后生成短期下载链接",
  "归档上传、确认、下载、作废必须写入审计日志"
];
