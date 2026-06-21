import type { PrimaryTableCol } from "tdesign-vue-next";

export type SettlementDetailTone = "default" | "primary" | "warning" | "danger" | "success";

export interface SettlementDetailMetaItem {
  label: string;
  value: string;
  tone?: SettlementDetailTone;
}

export interface SettlementEffectivenessStep {
  label: string;
  status: string;
  tone: SettlementDetailTone;
}

export interface SettlementPaymentRule {
  id: string;
  stage: string;
  ratio: string;
  accountPeriod: string;
  triggerCondition: string;
  paymentRequestStatus: string;
}

export const settlementDetailTitle = "JS-2026-018 · 5月材料结算单";

export const settlementDetailMeta: SettlementDetailMetaItem[] = [
  { label: "当前状态", value: "待归档确认", tone: "primary" },
  { label: "关联合同版本", value: "合同 v1" },
  { label: "付款条款版本", value: "v1 随合同生效" },
  { label: "结算期间", value: "2026-05" },
  { label: "责任部门", value: "合同部" },
  { label: "下一步动作", value: "主管确认归档", tone: "primary" }
];

export const settlementBaseInfo: SettlementDetailMetaItem[] = [
  { label: "结算编号", value: "JS-2026-018" },
  { label: "关联合同", value: "HT-2026-001 · 钢材采购合同" },
  { label: "结算性质", value: "月度结算" },
  { label: "是否最终结算", value: "否" },
  { label: "结算金额", value: "¥320,000.00" },
  { label: "创建人", value: "项目经理 张工" }
];

export const settlementEffectivenessSteps: SettlementEffectivenessStep[] = [
  { label: "结算审批", status: "已通过", tone: "success" },
  { label: "签字盖章归档上传", status: "已上传", tone: "success" },
  { label: "合同部主管确认", status: "待处理", tone: "primary" },
  { label: "结算生效", status: "阻塞", tone: "danger" }
];

export const settlementArchiveResponsibilities = [
  "结算审批不经过董事长/总经理",
  "结算归档件由合同部成员上传",
  "归档由合同部主管确认",
  "财务只读取业务归档件"
];

export const settlementPaymentRuleColumns: PrimaryTableCol<SettlementPaymentRule>[] = [
  { colKey: "stage", title: "规则阶段", minWidth: 160 },
  { colKey: "ratio", title: "付款比例", width: 110 },
  { colKey: "accountPeriod", title: "付款账期", width: 110 },
  { colKey: "triggerCondition", title: "触发条件", minWidth: 180 },
  { colKey: "paymentRequestStatus", title: "付款申请状态", width: 132 }
];

export const settlementPaymentRules: SettlementPaymentRule[] = [
  {
    id: "current-settlement-payment",
    stage: "当期结算款",
    ratio: "80%",
    accountPeriod: "30天",
    triggerCondition: "结算归档确认生效",
    paymentRequestStatus: "未开放"
  },
  {
    id: "retention-payment",
    stage: "质保金",
    ratio: "20%",
    accountPeriod: "365天",
    triggerCondition: "质保期满",
    paymentRequestStatus: "未开放"
  }
];

export const settlementPaymentBlockMessage =
  "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。";
