import { describe, expect, it } from "vitest";
import {
  auditFilterFields,
  auditLedgerColumns,
  auditRequiredActions,
  auditSummaryItems
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
});
