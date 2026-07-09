import type {
  ContractVersionStatus,
  PaymentRequestStatus,
  RoleKey,
  SettlementStatus
} from "@jiangkong/shared-domain";
import {
  comprehensiveExpenseSubtypeOptions,
  expensePaymentMethodOptions,
  expenseTypeOptions,
  loanReserveSubtypeOptions,
  reimbursementSubtypeOptions,
  sporadicSubtypeOptions,
  spotPurchaseSubtypeOptions
} from "../projects/project-expense.config";
import { roleLabels } from "./approval-flow-readonly.config";

export interface ReadonlyDictionaryEntry {
  key: string;
  label: string;
  description: string;
}

export interface ReadonlyDictionaryGroup {
  id: string;
  title: string;
  description: string;
  entries: ReadonlyDictionaryEntry[];
}

export interface ReadonlyConfigItem {
  name: string;
  value: string;
  description: string;
}

export interface ReadonlyConfigGroup {
  id: string;
  title: string;
  summary: string;
  items: ReadonlyConfigItem[];
}

const contractStatusLabels = {
  draft: "草稿",
  in_approval: "审批中",
  approval_rejected: "审批驳回",
  approved_pending_seal: "已批待用章",
  in_seal: "用章中",
  seal_approved_pending_archive: "已用章待归档",
  pending_archive_confirm: "待归档确认",
  effective: "已生效",
  voided: "已作废"
} satisfies Record<ContractVersionStatus, string>;

const settlementStatusLabels = {
  draft: "草稿",
  in_approval: "审批中",
  approval_pending: "待审批",
  approval_rejected: "审批驳回",
  withdrawn: "已撤回",
  approved_pending_archive: "已批待归档",
  pending_archive_confirm: "待归档确认",
  effective: "已生效",
  partially_paid: "部分付款",
  paid: "已付款",
  voided: "已作废"
} satisfies Record<SettlementStatus, string>;

const paymentStatusLabels = {
  draft: "草稿",
  approval_pending: "待审批",
  in_approval: "审批中",
  approval_rejected: "审批驳回",
  withdrawn: "已撤回",
  approved_pending_payment: "已批待付",
  partially_paid: "部分实付",
  paid: "已付清",
  voided: "已作废"
} satisfies Record<PaymentRequestStatus, string>;

const contractVersionStatuses = Object.keys(contractStatusLabels) as ContractVersionStatus[];
const settlementStatuses = Object.keys(settlementStatusLabels) as SettlementStatus[];
const paymentRequestStatuses = Object.keys(paymentStatusLabels) as PaymentRequestStatus[];

const filePurposeEntries: ReadonlyDictionaryEntry[] = [
  {
    key: "contract_archive",
    label: "合同归档件",
    description: "盖章合同和合同归档文件，归档确认后作为合同版本生效证据。"
  },
  {
    key: "draft",
    label: "合同草稿",
    description: "合同工作台生成或上传的草稿文档，用于内部起草和版本比对。"
  },
  {
    key: "negotiation",
    label: "对外磋商稿",
    description: "合同工作台对外沟通版本，下载仍需按敏感文件规则授权。"
  },
  {
    key: "internal_review",
    label: "内部送审稿",
    description: "合同进入内部审核前的送审文档，保留在合同工作台证据链。"
  },
  {
    key: "settlement_archive",
    label: "结算归档件",
    description: "签字结算单和结算归档文件，归档确认后作为付款依据。"
  },
  {
    key: "payment_voucher",
    label: "付款凭证",
    description: "出纳实付后上传的银行回单、截图或其他付款证明。"
  },
  {
    key: "approval_form",
    label: "审批单文件",
    description: "审批通过后生成的内部审批记录，可下载但必须记录原因。"
  },
  {
    key: "historical_contract_scan",
    label: "历史合同扫描件",
    description: "历史合同接管时上传的已签合同扫描资料。"
  },
  {
    key: "historical_settlement_ledger",
    label: "历史结算台账",
    description: "历史合同接管时上传的既有结算明细或台账。"
  },
  {
    key: "historical_payment_voucher",
    label: "历史付款凭证",
    description: "历史合同接管时上传的既有付款凭证或付款记录。"
  },
  {
    key: "other",
    label: "其他接管资料",
    description: "历史合同接管阶段补充上传的其他证明文件。"
  },
  {
    key: "signature",
    label: "个人签名图片",
    description: "用于审批单和签批页的内部签名图像，不作为业务状态入口。"
  }
];

function entriesFromLabels<T extends string>(
  keys: readonly T[],
  labels: Record<T, string>,
  description: (key: T) => string
): ReadonlyDictionaryEntry[] {
  return keys.map((key) => ({
    key,
    label: labels[key],
    description: description(key)
  }));
}

const roleKeys = Object.keys(roleLabels) as RoleKey[];

export const readonlyDictionaryGroups: ReadonlyDictionaryGroup[] = [
  {
    id: "roles",
    title: "岗位字典",
    description: "系统岗位用于项目授权、审批候选人和审计展示；super_admin 仅用于技术管理。",
    entries: roleKeys.map((key) => ({
      key,
      label: roleLabels[key],
      description: key === "super_admin" ? "技术管理角色，不参与业务审批。" : "可按项目授权参与业务查看或处理。"
    }))
  },
  {
    id: "contract_status",
    title: "合同状态",
    description: "合同版本必须归档确认后才可生效，生效后才能创建结算。",
    entries: entriesFromLabels(
      contractVersionStatuses,
      contractStatusLabels,
      (key) => (key === "effective" ? "允许作为结算来源。" : "不可作为新结算的有效合同版本。")
    )
  },
  {
    id: "settlement_status",
    title: "结算状态",
    description: "结算必须审批并归档确认后才可成为付款申请依据。",
    entries: entriesFromLabels(settlementStatuses, settlementStatusLabels, (key) =>
      ["effective", "partially_paid"].includes(key) ? "允许作为付款申请来源。" : "不可作为新付款申请依据。"
    )
  },
  {
    id: "payment_status",
    title: "付款状态",
    description: "付款审批通过只进入已批待付，实际付款由出纳实付和财务入账分别记录。",
    entries: entriesFromLabels(paymentRequestStatuses, paymentStatusLabels, (key) =>
      key === "approved_pending_payment" ? "等待出纳执行实付。" : "按付款链路继续流转或终止。"
    )
  },
  {
    id: "project_expense",
    title: "项目支出类型",
    description: "非合同类付款申请字典，包含报销和零星采购完整闭环。",
    entries: expenseTypeOptions.map((option) => ({
      key: option.value,
      label: option.label,
      description: option.value === "spot_purchase" ? "物资员发起，审批通过后进入采购执行和付款链路。" : "审批通过后自动进入已批待付。"
    }))
  },
  {
    id: "project_expense_subtype",
    title: "项目支出明细",
    description: "项目支出的二级分类，用于申请说明、审批单和后续统计。",
    entries: [
      ...sporadicSubtypeOptions,
      ...loanReserveSubtypeOptions,
      ...comprehensiveExpenseSubtypeOptions,
      ...reimbursementSubtypeOptions,
      ...spotPurchaseSubtypeOptions
    ].map((option) => ({
      key: option.value,
      label: option.label,
      description: "随项目支出申请冻结到业务记录。"
    }))
  },
  {
    id: "payment_method",
    title: "付款方式",
    description: "出纳实付和项目支出申请使用的付款方式字典。",
    entries: expensePaymentMethodOptions.map((option) => ({
      key: option.value,
      label: option.label,
      description: "仅作为业务记录方式，不代表系统直接付款。"
    }))
  },
  {
    id: "file_purpose",
    title: "文件用途",
    description: "资料库和业务详情页展示的核心文件用途，下载必须经后端权限校验。",
    entries: filePurposeEntries
  }
];

export const readonlyConfigGroups: ReadonlyConfigGroup[] = [
  {
    id: "login",
    title: "安全登录配置",
    summary: "生产登录以手机号 + 当前密码为准，临时密码用户必须先完成改密。",
    items: [
      {
        name: "Web 登录",
        value: "手机号 + 当前密码",
        description: "登录失败展示业务化错误，不暴露认证内部细节。"
      },
      {
        name: "小程序登录",
        value: "手机号 + 当前密码",
        description: "移动端使用同一后端 API 和同一权限模型。"
      },
      {
        name: "临时密码",
        value: "强制改密",
        description: "临时密码用户只能进入改密流程，完成后再访问业务页。"
      }
    ]
  },
  {
    id: "file_download",
    title: "文件下载配置",
    summary: "敏感文件通过后端生成短时效下载票据，下载原因进入签名和审计。",
    items: [
      {
        name: "下载授权",
        value: "当前密码 + 下载原因",
        description: "空原因不发票据，下载动作可追溯到人、业务和原因。"
      },
      {
        name: "下载地址",
        value: "短时效后端 URL",
        description: "前端不直接访问 COS 原始地址，不展示完整短链。"
      },
      {
        name: "审计动作",
        value: "file.download.ticket / file.download",
        description: "票据创建和实际下载分别记录审计日志。"
      }
    ]
  },
  {
    id: "upload_limit",
    title: "上传限制配置",
    summary: "文件上传必须落在业务上下文内，普通资料库不提供裸上传入口。",
    items: [
      {
        name: "合同资料",
        value: "合同详情或合同工作台上传",
        description: "用于归档确认、合同版本生效和资料库留档。"
      },
      {
        name: "结算资料",
        value: "结算详情上传",
        description: "用于结算归档确认和后续付款容量校验。"
      },
      {
        name: "付款凭证",
        value: "付款详情或项目支出付款动作上传",
        description: "用于出纳实付、财务入账和最终归档文件。"
      }
    ]
  },
  {
    id: "notification",
    title: "通知开关",
    summary: "当前只展示已启用和可扩展的通知能力，不提供业务人员在线改开关。",
    items: [
      {
        name: "运行健康告警",
        value: "QQ 邮箱 SMTP",
        description: "服务器健康检查异常可通过 SMTP 邮件触达。"
      },
      {
        name: "审批催办",
        value: "站内待办优先",
        description: "首页和审批中心展示超时/阻塞，外部机器人暂不启用。"
      },
      {
        name: "外部机器人",
        value: "未启用",
        description: "企业微信和飞书机器人当前不作为生产告警通道。"
      }
    ]
  }
];

export function dictionaryGroupById(id: string) {
  return readonlyDictionaryGroups.find((group) => group.id === id);
}

export function configGroupById(id: string) {
  return readonlyConfigGroups.find((group) => group.id === id);
}
