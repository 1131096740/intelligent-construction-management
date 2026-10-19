import type { AdminNavigationGroup } from "../routes/route-records";

const tasks = [
  { path: "/零星采购工作台", label: "零星材料采购", description: "申请材料、数量和到位日期" },
  { path: "/零星材料付款工作台", label: "零星材料付款", description: "填付款申请、看实付进度" },
  { path: "/收货确认工作台", label: "材料收货", description: "登记收货、补照片、交复核" },
  { path: "/费用与报销工作台", label: "费用与报销", description: "报销、借款和员工垫资" },
  { path: "/综合采购申请", label: "综合采购", description: "办公、设备等采购申请" },
  { path: "/合同工作台", label: "合同与用章", description: "起草、审批、签署与归档" },
  { path: "/结算工作台", label: "办理结算", description: "核对工程量、金额和依据" },
  { path: "/统一资金办理工作台", label: "办理付款", description: "登记实付、凭证与核对" },
  { path: "/公司互转台账", label: "公司资金互转", description: "申请调剂、领导审批、到账核对与往来归还" },
  { path: "/项目经营", label: "项目经营", description: "查看项目账、资金和接管状态" },
  { path: "/工资承担工作台", label: "工资承担", description: "人员工资、承担与支付情况" },
  { path: "/清分工作台", label: "清分与对账", description: "核对资金、分配与差异" }
] as const;

// Reuse the formal route visibility contract; shortcuts never grant capabilities.
export function visibleBusinessTasks(groups: readonly AdminNavigationGroup[]) {
  const paths = new Set(groups.flatMap((group) => group.items.map((item) => item.path)));
  return tasks.filter((task) => paths.has(task.path));
}
