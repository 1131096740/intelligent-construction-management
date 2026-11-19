export interface ApprovalDutySmsIntent {
  businessLabel: string;
  dutyName: string;
  businessCode: string;
  scopeName: string;
  initiatorName: string;
  subject: string;
  participants: string[];
  amountText: string;
  totalText?: string;
  details?: string[];
  targetPath: string;
}

const dutyRoutes = {
  contract: "/合同管理/",
  settlement: "/结算管理/",
  expense: "/费用与报销/",
  spotReceipt: "/零星采购收货/",
  generalProcurement: "/综合采购申请/",
  spotProcurement: "/零星采购/",
  spotPayment: "/零星材料付款/",
  payment: "/付款管理/",
  fundBalanceReview: "/资金余额复核/",
  principalReturn: "/垫资本金归还/"
} as const;

export function approvalDutyTarget(domain: keyof typeof dutyRoutes, code: string) {
  return dutyRoutes[domain] + encodeURIComponent(code);
}

const approvalCenterReview = "/审批中心?review=";
const independentReviewKinds = ["loan_repayment","contract_proxy_execution","contract_bank_verification","upward_contract_amount_revision","upward_receipt_match","contract_economic_review"] as const;
type IndependentReviewKind = typeof independentReviewKinds[number];
export function approvalIndependentDutyTarget(kind: IndependentReviewKind, businessId: string) {
  return approvalCenterReview + encodeURIComponent(`independent:${kind}:${businessId}`);
}

const transferDetail = "/公司互转台账?transferId=";
export function companyTransferDutyTarget(id: string) {
  return transferDetail + encodeURIComponent(id);
}

export function approvalDutyAbsoluteTarget(origin: string, targetPath: string) {
  const review = targetPath.startsWith(approvalCenterReview);
  const transfer = targetPath.startsWith(transferDetail);
  const workbench = ["/资金账户", "/公司互转台账"].includes(targetPath);
  const root = workbench ? targetPath : review ? approvalCenterReview : transfer ? transferDetail : Object.values(dutyRoutes).find(prefix=>targetPath.startsWith(prefix));
  if (!root) return null;
  const segment = targetPath.slice(root.length);
  try {
    const decoded = decodeURIComponent(segment);
    if ((!decoded && !workbench) || [".",".."].includes(decoded) || /[/%?#\\]/u.test(decoded) ||
        [...decoded].some(character=>character < " " || character === "\x7f") || encodeURIComponent(decoded) !== segment) return null;
    if (review) {
      const [prefix,kind,id,extra] = decoded.split(":");
      if (prefix !== "independent" || !independentReviewKinds.includes(kind as IndependentReviewKind) || !/^[A-Za-z0-9_-]+$/u.test(id ?? "") || extra !== undefined) return null;
    }
    if (transfer && !/^[A-Za-z0-9_-]+$/u.test(decoded)) return null;
    const base = new URL(origin);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) return null;
    return new URL(targetPath,base).href;
  } catch {
    return null;
  }
}

export function approvalDutySummary(intent: ApprovalDutySmsIntent) {
  const clean = (value: string) => value.trim().replace(/\s+/gu," ");
  const group = (values: string[]) => values.map(clean).filter(Boolean).join("、");
  const participants = group(intent.participants);
  const details = group(intent.details ?? []);
  return [
    clean(intent.scopeName),`发起人：${clean(intent.initiatorName)}`,`事项：${clean(intent.subject)}`,
    ...(participants ? [`对象：${participants}`] : []),
    `金额：${clean(intent.amountText) || "待确定"}`,
    ...(intent.totalText?.trim() ? [`合计：${clean(intent.totalText)}`] : []),
    ...(details ? [`明细：${details}`] : []),
  ].join("；");
}
