import { describe, expect, it } from "vitest";
import {
  archiveFilterFields,
  archiveLedgerColumns,
  archiveRules,
  archiveSummaryItems
} from "./archive-list.config";

describe("archive ledger page configuration", () => {
  it("uses compact enterprise archive filter fields", () => {
    expect(archiveFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "资料类型",
      "归档状态",
      "上传部门",
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
});
