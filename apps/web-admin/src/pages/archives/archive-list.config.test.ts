import { describe, expect, it } from "vitest";
import {
  archiveFileCanPreview,
  archiveFilterFields,
  archiveLedgerColumns,
  archivePackageConfirmMessage,
  archivePackageMaxBytes,
  archivePackageMaxFiles,
  archivePackageSelectionMessage,
  archivePackageSuccessMessage,
  archiveRules,
  archiveSummaryItems,
  archiveDownloadActionDisabledReason,
  emptyArchiveLedgerFilters,
  filterArchiveLedgerRows,
  type ArchiveLedgerRow
} from "./archive-list.config";

describe("archive ledger page configuration", () => {
  it("searches by project, contract, counterparty, type, status, date, and keyword", () => {
    expect(archiveFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "合同",
      "单位名称",
      "资料类型",
      "归档状态",
      "开始日期",
      "结束日期",
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

  it("supports multi-select and shows business relation, contract, counterparty, and permission columns", () => {
    expect(archiveLedgerColumns[0]).toMatchObject({ colKey: "row-select", type: "multiple" });
    expect(archiveLedgerColumns.map((column) => column.title).filter(Boolean)).toEqual([
      "资料编号",
      "合同分类",
      "合同",
      "单位名称",
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

  it("states file privacy, per-file package authorization, and audit rules", () => {
    expect(archiveRules).toEqual([
      "各类归档资料按相应业务流程办理，关联原单不重复上传",
      "付款凭证由出纳/财务上传并关联实际付款记录",
      "敏感文件必须经后台权限校验后生成短时效下载链接",
      "打包下载逐份校验权限，并写入审计日志"
    ]);
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

  it("offers preview only for PDF files", () => {
    expect(archiveFileCanPreview(archiveRow({ mimeType: "application/pdf" }))).toBe(true);
    expect(archiveFileCanPreview(archiveRow({ mimeType: "image/png", fileSource: "照片.pdf" }))).toBe(true);
    expect(archiveFileCanPreview(archiveRow({ mimeType: "image/png", fileSource: "照片.png" }))).toBe(false);
  });

  it("applies the package count and total size limits per selection", () => {
    expect(archivePackageSelectionMessage([])).toBe("请选择要打包下载的资料");
    expect(
      archivePackageSelectionMessage([
        archiveRow({ id: "pending", canDownload: false, fileSizeBytes: 1 })
      ])
    ).toBe("所选资料中有暂不可下载项，请取消选择后重试");
    expect(
      archivePackageSelectionMessage(
        Array.from({ length: archivePackageMaxFiles + 1 }, () =>
          archiveRow({ canDownload: true, fileSizeBytes: 1 })
        )
      )
    ).toBe(`单次最多打包 ${archivePackageMaxFiles} 份资料，请减少选择后重试`);
    expect(
      archivePackageSelectionMessage([
        archiveRow({ canDownload: true, fileSizeBytes: archivePackageMaxBytes }),
        archiveRow({ id: "extra", canDownload: true, fileSizeBytes: 1 })
      ])
    ).toBe("打包资料总量超过 200MB，请分批下载");
    expect(
      archivePackageSelectionMessage([
        archiveRow({ canDownload: true, fileSizeBytes: archivePackageMaxBytes })
      ])
    ).toBe("");
  });

  it("explains package authorization and audit without a password or reason form", () => {
    expect(archivePackageConfirmMessage(3)).toBe(
      "确认打包下载所选 3 份资料？系统将逐份校验当前单据可见权限、生成短时效下载包，并记录打包审计。"
    );
    expect(archivePackageSuccessMessage(3)).toBe("已打包下载 3 份资料，后台已记录打包审计。");
  });

  it("filters archive rows by project, contract, counterparty, type, date, and governance status", () => {
    const rows: ArchiveLedgerRow[] = [
      archiveRow({
        id: "pending-contract",
        project: "一号项目",
        documentType: "合同归档件",
        archiveStatus: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载",
        businessRef: "HT-001 / v1",
        contractNo: "HT-001",
        contractName: "钢材采购合同",
        counterpartyName: "四川钢材供应商",
        createdAt: "2026-07-01T01:00:00.000Z"
      }),
      archiveRow({
        id: "voucher",
        project: "二号项目",
        documentType: "付款凭证",
        archiveStatus: "已上传",
        canDownload: true,
        disabledReason: null,
        businessRef: "FK-001",
        contractNo: "HT-002",
        contractName: "幕墙分包合同",
        counterpartyName: "幕墙分包单位",
        createdAt: "2026-08-01T01:00:00.000Z"
      })
    ];

    expect(
      filterArchiveLedgerRows(rows, {
        ...emptyArchiveLedgerFilters(),
        project: "一号",
        contract: "HT-001",
        counterparty: "钢材",
        documentType: "合同",
        archiveStatus: "待",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-31",
        keyword: "HT-001"
      }).map((row) => row.id)
    ).toEqual(["pending-contract"]);

    expect(
      filterArchiveLedgerRows(rows, {
        ...emptyArchiveLedgerFilters(),
        keyword: "幕墙"
      }).map((row) => row.id)
    ).toEqual(["voucher"]);

    expect(
      filterArchiveLedgerRows(rows, {
        ...emptyArchiveLedgerFilters(),
        dateFrom: "2026-07-15"
      }).map((row) => row.id)
    ).toEqual(["voucher"]);
  });
});

function archiveRow(overrides: Partial<ArchiveLedgerRow>): ArchiveLedgerRow {
  return {
    id: "archive",
    documentNo: "ZL-001",
    fileId: "file-1",
    mimeType: "application/pdf",
    documentType: "合同归档件",
    businessRef: "HT-001",
    project: "项目",
    contractNo: "HT-001",
    contractName: "合同",
    counterpartyName: "单位",
    fileSource: "归档.pdf",
    fileSizeBytes: 1024,
    canDownload: true,
    disabledReason: null,
    archiveStatus: "已确认",
    statusTone: "success",
    uploadDepartment: "合同部",
    confirmedBy: "合同主管",
    lastAction: "2026-07-08",
    createdAt: "2026-07-08T01:00:00.000Z",
    ...overrides
  };
}
