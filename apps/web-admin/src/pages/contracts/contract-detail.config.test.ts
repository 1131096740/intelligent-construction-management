import { describe, expect, it } from "vitest";
import {
  contractDetailMeta,
  contractEffectivenessSteps,
  contractPaymentTermColumns,
  contractSettlementBlockMessage
} from "./contract-detail.config";

describe("contract detail page configuration", () => {
  it("shows the approved contract detail metadata fields", () => {
    expect(contractDetailMeta.map((item) => item.label)).toEqual([
      "当前状态",
      "当前版本",
      "付款条款",
      "责任部门",
      "当前处理人",
      "下一步动作"
    ]);
  });

  it("keeps the strict effectiveness sequence visible", () => {
    expect(contractEffectivenessSteps.map((step) => step.label)).toEqual([
      "合同审批",
      "用章",
      "归档上传",
      "主管确认",
      "合同生效"
    ]);
  });

  it("shows multi-stage payment term traceability columns", () => {
    expect(contractPaymentTermColumns.map((column) => column.title)).toEqual([
      "版本",
      "状态",
      "适用合同版本",
      "计算依据",
      "比例",
      "账期",
      "触发事件",
      "操作"
    ]);
  });

  it("states that non-effective contracts block settlement creation", () => {
    expect(contractSettlementBlockMessage).toBe(
      "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。"
    );
  });
});
