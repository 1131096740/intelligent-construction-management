import type { PrimaryTableCol } from "tdesign-vue-next";

export type ArchiveTone = "default" | "primary" | "warning" | "success";

export interface ArchiveFilterField {
  key: keyof ArchiveLedgerFilters;
  label: string;
  placeholder: string;
  type: "select" | "keyword" | "date";
}

export interface ArchiveSummaryItem {
  label: string;
  value: string;
  tone: ArchiveTone;
}

export interface ArchiveLedgerRow {
  contractRelationshipLabel?: string;
  id: string;
  documentNo: string;
  fileId: string;
  mimeType?: string;
  documentType: string;
  businessRef: string;
  project: string;
  contractNo?: string;
  contractName?: string;
  counterpartyName?: string;
  fileSource: string;
  fileSizeBytes: number;
  canDownload: boolean;
  disabledReason: string | null;
  archiveStatus: string;
  statusTone: ArchiveTone;
  uploadDepartment: string;
  confirmedBy: string;
  lastAction: string;
  createdAt?: string;
}

export interface ArchiveLedgerFilters {
  project: string;
  contract: string;
  counterparty: string;
  documentType: string;
  archiveStatus: string;
  dateFrom: string;
  dateTo: string;
  keyword: string;
}

export const archiveFilterFields: ArchiveFilterField[] = [
  { key: "project", label: "项目", placeholder: "全部项目", type: "select" },
  { key: "contract", label: "合同", placeholder: "合同编号或名称", type: "keyword" },
  { key: "counterparty", label: "单位名称", placeholder: "相对方名称", type: "keyword" },
  { key: "documentType", label: "资料类型", placeholder: "全部类型", type: "select" },
  { key: "archiveStatus", label: "归档状态", placeholder: "全部状态", type: "select" },
  { key: "dateFrom", label: "开始日期", placeholder: "2026-01-01", type: "date" },
  { key: "dateTo", label: "结束日期", placeholder: "2026-12-31", type: "date" },
  { key: "keyword", label: "关键词", placeholder: "业务编号/文件名称", type: "keyword" }
];

export const archiveSummaryItems: ArchiveSummaryItem[] = [
  { label: "全部资料", value: "0", tone: "default" },
  { label: "合同归档件", value: "0", tone: "primary" },
  { label: "结算归档件", value: "0", tone: "primary" },
  { label: "付款凭证", value: "0", tone: "success" },
  { label: "待确认", value: "0", tone: "warning" }
];

export const archiveLedgerColumns: PrimaryTableCol<ArchiveLedgerRow>[] = [
  { colKey: "row-select", type: "multiple", width: 48, fixed: "left" },
  { colKey: "documentNo", title: "资料编号", width: 96 },
  { colKey: "contractRelationshipLabel", title: "合同分类", width: 160 },
  { colKey: "contractName", title: "合同", minWidth: 160 },
  { colKey: "counterpartyName", title: "单位名称", minWidth: 150 },
  { colKey: "documentType", title: "资料类型", width: 110 },
  { colKey: "businessRef", title: "关联业务", minWidth: 130 },
  { colKey: "project", title: "项目", minWidth: 110 },
  { colKey: "fileSource", title: "文件来源", width: 140 },
  { colKey: "archiveStatus", title: "归档状态", width: 100 },
  { colKey: "uploadDepartment", title: "上传部门", width: 88 },
  { colKey: "confirmedBy", title: "确认/入账人", width: 104 },
  { colKey: "lastAction", title: "最近操作", width: 140 },
  { colKey: "operation", title: "操作", width: 120, fixed: "right" }
];

export const archiveRules = [
  "各类归档资料按相应业务流程办理，关联原单不重复上传",
  "付款凭证由出纳/财务上传并关联实际付款记录",
  "敏感文件必须经后台权限校验后生成短时效下载链接",
  "打包下载逐份校验权限，并写入审计日志"
];

export const archivePackageMaxFiles = 50;
export const archivePackageMaxBytes = 200 * 1024 * 1024;

export function emptyArchiveLedgerFilters(): ArchiveLedgerFilters {
  return {
    project: "",
    contract: "",
    counterparty: "",
    documentType: "",
    archiveStatus: "",
    dateFrom: "",
    dateTo: "",
    keyword: ""
  };
}

export function filterArchiveLedgerRows(
  rows: ArchiveLedgerRow[],
  filters: ArchiveLedgerFilters
): ArchiveLedgerRow[] {
  const keyword = normalize(filters.keyword);
  const contract = normalize(filters.contract);
  const counterparty = normalize(filters.counterparty);
  return rows.filter((row) => {
    const contractText = normalize(`${row.contractNo ?? ""} ${row.contractName ?? ""}`);
    const matchesKeyword =
      !keyword ||
      [
        row.documentNo,
        row.documentType,
        row.businessRef,
        row.project,
        row.fileSource,
        row.archiveStatus,
        row.uploadDepartment,
        contractText,
        normalize(row.counterpartyName ?? "")
      ].some((value) => normalize(value).includes(keyword));
    const createdAt = row.createdAt ? Date.parse(row.createdAt) : Number.NaN;

    return (
      includesText(row.project, filters.project) &&
      (!contract || contractText.includes(contract)) &&
      (!counterparty || normalize(row.counterpartyName ?? "").includes(counterparty)) &&
      includesText(row.documentType, filters.documentType) &&
      includesText(row.archiveStatus, filters.archiveStatus) &&
      matchesDateFrom(createdAt, filters.dateFrom) &&
      matchesDateTo(createdAt, filters.dateTo) &&
      matchesKeyword
    );
  });
}

export function archiveDownloadActionDisabledReason(row: Pick<ArchiveLedgerRow, "canDownload" | "disabledReason">): string {
  if (row.canDownload) return "";
  return row.disabledReason ?? "当前资料暂不可下载";
}

export function archiveFileCanPreview(row: Pick<ArchiveLedgerRow, "mimeType" | "fileSource">): boolean {
  return row.mimeType === "application/pdf" || /\.pdf$/iu.test(row.fileSource);
}

export function archivePackageSelectionMessage(
  rows: Array<Pick<ArchiveLedgerRow, "canDownload" | "fileSizeBytes">>
): string {
  if (rows.length === 0) return "请选择要打包下载的资料";
  if (rows.some((row) => !row.canDownload)) {
    return "所选资料中有暂不可下载项，请取消选择后重试";
  }
  if (rows.length > archivePackageMaxFiles) {
    return `单次最多打包 ${archivePackageMaxFiles} 份资料，请减少选择后重试`;
  }
  const totalBytes = rows.reduce((total, row) => total + Math.max(0, row.fileSizeBytes), 0);
  if (totalBytes > archivePackageMaxBytes) {
    return "打包资料总量超过 200MB，请分批下载";
  }
  return "";
}

export function archivePackageConfirmMessage(count: number): string {
  return `确认打包下载所选 ${count} 份资料？系统将逐份校验当前单据可见权限、生成短时效下载包，并记录打包审计。`;
}

export function archivePackageSuccessMessage(count: number): string {
  return `已打包下载 ${count} 份资料，后台已记录打包审计。`;
}

function includesText(value: string, query: string) {
  const normalizedQuery = normalize(query);
  return !normalizedQuery || normalize(value).includes(normalizedQuery);
}

function matchesDateFrom(createdAt: number, dateFrom: string) {
  if (!dateFrom.trim()) return true;
  const boundary = Date.parse(`${dateFrom.trim()}T00:00:00+08:00`);
  return Number.isNaN(boundary) || Number.isNaN(createdAt) || createdAt >= boundary;
}

function matchesDateTo(createdAt: number, dateTo: string) {
  if (!dateTo.trim()) return true;
  const boundary = Date.parse(`${dateTo.trim()}T23:59:59.999+08:00`);
  return Number.isNaN(boundary) || Number.isNaN(createdAt) || createdAt <= boundary;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
