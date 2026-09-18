import { ConflictException } from "@nestjs/common";
import type { OperatingImpactKind, ProjectStage } from "@jiangkong/shared-domain";

export type ProjectCloseImpactPolicy = Readonly<{
  affectedStages: readonly ProjectStage[];
  reason: string;
}>;

const POLICIES = {
  confirmed_income: policy(
    ["owner_settlement_completed", "final_profit_confirmed", "profit_distribution_completed", "project_funds_cleared"],
    "业主结算收入或应收事实发生变化"
  ),
  receivable_increase: policy(
    ["owner_settlement_completed", "final_profit_confirmed", "profit_distribution_completed", "project_funds_cleared"],
    "业主结算收入或应收事实发生变化"
  ),
  receivable_decrease: policy(
    ["owner_settlement_completed", "final_profit_confirmed", "profit_distribution_completed", "project_funds_cleared"],
    "业主结算收入或应收事实发生变化"
  ),
  confirmed_cost: downstreamPolicy(),
  payable_increase: downstreamPolicy(),
  payable_decrease: downstreamPolicy(),
  estimated_clearing_expense: downstreamPolicy(),
  contract_commitment_reference: downstreamPolicy(),
  company_advance_for_project_increase: clearingPolicy(),
  company_advance_for_project_decrease: clearingPolicy(),
  company_returnable_to_project_increase: clearingPolicy(),
  company_returnable_to_project_decrease: clearingPolicy(),
  inter_subject_balance_increase: clearingPolicy(),
  inter_subject_balance_decrease: clearingPolicy(),
  construction_enterprise_funds_increase: financialPolicy("项目实际资金发生变化"),
  construction_enterprise_funds_decrease: financialPolicy("项目实际资金发生变化"),
  construction_enterprise_funds_freeze: financialPolicy("项目资金限制发生变化"),
  construction_enterprise_funds_release: financialPolicy("项目资金限制发生变化"),
  company_project_funds_increase: financialPolicy("项目实际资金发生变化"),
  company_project_funds_decrease: financialPolicy("项目实际资金发生变化"),
  temporary_profit_distribution: financialPolicy("暂分利润授权发生变化"),
  final_profit_distribution: distributionPolicy("最终利润分配发生变化"),
  profit_distribution_adjustment: distributionPolicy("利润分配调整发生变化"),
  necessary_expense_reserve_increase: financialPolicy("必要费用准备发生变化"),
  necessary_expense_reserve_decrease: financialPolicy("必要费用准备发生变化"),
  project_disputed_funds_increase: financialPolicy("冻结或争议资金发生变化"),
  project_disputed_funds_decrease: financialPolicy("冻结或争议资金发生变化"),
  invoice_reference: policy([], "仅补充票据依据，不改变项目收口阶段"),
  evidence_gap_notice: policy([], "仅补充证据提示，不改变项目收口阶段")
} satisfies Readonly<Record<OperatingImpactKind, ProjectCloseImpactPolicy>>;

export function resolveProjectCloseImpactPolicy(
  impactKind: string
): ProjectCloseImpactPolicy {
  if (!Object.prototype.hasOwnProperty.call(POLICIES, impactKind)) {
    throw new ConflictException("发现未知经营影响类型，不能自动重开项目收口阶段");
  }
  return POLICIES[impactKind as OperatingImpactKind];
}

function policy(affectedStages: readonly ProjectStage[], reason: string) {
  return { affectedStages, reason } as const;
}

function downstreamPolicy() {
  return policy(
    ["downstream_cost_confirmed", "final_profit_confirmed", "profit_distribution_completed", "project_funds_cleared"],
    "下游成本、应付款或待清算费用发生变化"
  );
}

function clearingPolicy() {
  return policy(
    ["tax_and_enterprise_clearing_completed", "final_profit_confirmed", "profit_distribution_completed", "project_funds_cleared"],
    "施工企业清算、公司垫资或主体往来发生变化"
  );
}

function financialPolicy(reason: string) {
  return policy(
    ["final_profit_confirmed", "profit_distribution_completed", "project_funds_cleared"],
    reason
  );
}

function distributionPolicy(reason: string) {
  return policy(
    ["profit_distribution_completed", "project_funds_cleared"],
    reason
  );
}
