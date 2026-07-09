import { describe, expect, it } from "vitest";
import {
  archiveFilterFields,
  archiveLedgerColumns,
  archiveRules,
  archiveSummaryItems,
  archiveDownloadActionDisabledReason,
  archiveDownloadDisabledReason,
  emptyArchiveLedgerFilters,
  filterArchiveLedgerRows,
  type ArchiveLedgerRow
} from "./archive-list.config";

describe("archive ledger page configuration", () => {
  it("uses compact enterprise archive filter fields", () => {
    expect(archiveFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "资料类型",
      "归档状态",
      "上传部门",
      "治理筛选",
      "关键词"
    ]);
  });

  it("separates contract archives, settlement archives, and payment vouchers", () => {
    expect(archiveSummaryItems.map((item) => item.label)).toEqual([
      "全部资料",
      "合同归档件",
      "结算归档件",
      "付款凭证",
      "待确认"
    ]);
  });

  it("shows business relation, source, permission, and audit columns", () => {
    expect(archiveLedgerColumns.map((column) => column.title)).toEqual([
      "资料编号",
      "资料类型",
      "关联业务",
      "项目",
      "文件来源",
      "归档状态",
      "上传部门",
      "确认/入账人",
      "最近操作",
      "操作"
    ]);
  });

  it("states file privacy, responsibility, and audit rules", () => {
    expect(archiveRules).toEqual([
      "合同/结算归档件由合同部上传并由合同部主管确认",
      "付款凭证由出纳/财务上传并关联实际付款记录",
      "敏感文件必须经后台权限校验后生成短期下载链接",
      "归档上传、确认、下载、作废必须写入审计日志"
    ]);
  });

  it("requires current password before generating download links", () => {
    expect(archiveDownloadDisabledReason("")).toBe("请填写当前登录密码后再生成下载链接");
    expect(archiveDownloadDisabledReason("   ")).toBe("请填写当前登录密码后再生成下载链接");
    expect(archiveDownloadDisabledReason("current-password")).toBe("");
  });

  it("explains why archive files cannot be downloaded", () => {
    expect(archiveDownloadActionDisabledReason(archiveRow({ canDownload: true }))).toBe("");
    expect(
      archiveDownloadActionDisabledReason(
        archiveRow({ canDownload: false, disabledReason: "归档确认后开放下载" })
      )
    ).toBe("归档确认后开放下载");
    expect(archiveDownloadActionDisabledReason(archiveRow({ canDownload: false }))).toBe(
      "当前资料暂不可下载"
    );
  });

  it("filters archive rows by business fields and governance status", () => {
    const rows: ArchiveLedgerRow[] = [
      archiveRow({
        id: "pending-contract",
        project: "一号项目",
        documentType: "合同归档件",
        archiveStatus: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载",
        businessRef: "HT-001 / v1"
      }),
      archiveRow({
        id: "voucher",
        project: "二号项目",
        documentType: "付款凭证",
        archiveStatus: "已上传",
        canDownload: true,
        disabledReason: null,
        businessRef: "FK-001"
      })
    ];

    expect(
      filterArchiveLedgerRows(rows, {
        ...emptyArchiveLedgerFilters(),
        project: "一号",
        accessStatus: "pending_confirmation",
        keyword: "HT"
      }).map((row) => row.id)
    ).toEqual(["pending-contract"]);

    expect(
      filterArchiveLedgerRows(rows, {
        ...emptyArchiveLedgerFilters(),
        accessStatus: "downloadable"
      }).map((row) => row.id)
    ).toEqual(["voucher"]);
  });
});

function archiveRow(overrides: Partial<ArchiveLedgerRow>): ArchiveLedgerRow {
  return {
    id: "archive",
    documentNo: "ZL-001",
    fileId: "file-1",
    documentType: "合同归档件",
    businessRef: "HT-001",
    project: "项目",
    fileSource: "归档.pdf",
    fileSizeBytes: 1024,
    canDownload: true,
    disabledReason: null,
    archiveStatus: "已确认",
    statusTone: "success",
    uploadDepartment: "合同部",
    confirmedBy: "合同主管",
    lastAction: "2026-07-08",
    ...overrides
  };
}
