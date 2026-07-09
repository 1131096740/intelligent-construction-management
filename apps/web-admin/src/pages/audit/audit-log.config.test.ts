import { describe, expect, it } from "vitest";
import {
  auditFilterFields,
  auditLedgerColumns,
  auditRequiredActions,
  auditSummaryItems,
  emptyFileDownloadAuditFilters,
  fileDownloadAuditColumns,
  filterFileDownloadAuditRows,
  type FileDownloadAuditRow
} from "./audit-log.config";

describe("audit log page configuration", () => {
  it("uses actor, action, business type, date range, and keyword filters", () => {
    expect(auditFilterFields.map((field) => field.label)).toEqual([
      "操作人",
      "动作类型",
      "业务类型",
      "时间范围",
      "关键词"
    ]);
  });

  it("summarizes the major security and business audit groups", () => {
    expect(auditSummaryItems.map((item) => item.label)).toEqual([
      "全部日志",
      "登录日志",
      "审批动作",
      "文件操作",
      "权限/安全"
    ]);
  });

  it("shows actor, action, business relation, network, and trace columns", () => {
    expect(auditLedgerColumns.map((column) => column.title)).toEqual([
      "发生时间",
      "操作人",
      "动作类型",
      "业务类型",
      "业务对象",
      "IP地址",
      "结果/风险",
      "追溯信息",
      "操作"
    ]);
  });

  it("states the required audit coverage for phase 1 sensitive actions", () => {
    expect(auditRequiredActions).toEqual([
      "登录、审批动作必须写入审计日志",
      "合同/结算归档上传与确认必须写入审计日志",
      "付款执行、付款凭证上传必须写入审计日志",
      "敏感文件下载、权限变更、单据作废必须写入审计日志"
    ]);
  });

  it("shows file download audit columns with reason and sanitized trace fields", () => {
    expect(fileDownloadAuditColumns.map((column) => column.title)).toEqual([
      "发生时间",
      "操作人",
      "动作",
      "文件名",
      "下载原因",
      "业务对象",
      "IP地址",
      "追溯编号",
      "脱敏说明"
    ]);
  });

  it("filters file download audits by actor, file, reason, and keyword", () => {
    const rows: FileDownloadAuditRow[] = [
      downloadRow({
        id: "audit-1",
        actor: "张三",
        fileName: "合同归档.pdf",
        downloadReason: "合同归档复核",
        businessTarget: "file-1"
      }),
      downloadRow({
        id: "audit-2",
        actor: "李四",
        fileName: "付款凭证.png",
        downloadReason: "付款入账",
        businessTarget: "file-2"
      })
    ];

    expect(
      filterFileDownloadAuditRows(rows, {
        ...emptyFileDownloadAuditFilters(),
        actor: "张",
        fileName: "合同",
        downloadReason: "复核",
        keyword: "file-1"
      }).map((row) => row.id)
    ).toEqual(["audit-1"]);
  });
});

function downloadRow(overrides: Partial<FileDownloadAuditRow>): FileDownloadAuditRow {
  return {
    id: "audit-row",
    occurredAt: "2026-07-08T08:00:00.000Z",
    actor: "操作人",
    action: "实际下载",
    actionKey: "file.download",
    fileId: "file-row",
    fileName: "文件.pdf",
    businessType: "file_object",
    businessTarget: "file-row",
    downloadReason: "业务复核",
    ipAddress: "127.0.0.1",
    traceId: "audit-row",
    sensitive: "未返回短链/token/COS地址",
    ...overrides
  };
}
