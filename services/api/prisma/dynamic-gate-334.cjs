"use strict";

const mode = "--historical-settlement-334";
const runner = ".github/task12-install-295/contract-finance/run-contract-adjacent-ci.sh";
const remainingRunner = ".github/task12-install-295/contract-finance/run-remaining.sh";
const namedRunner = ".github/task12-install-295/named-pol113-pol114/run-matrix334.sh";
const financeRunner = ".github/task12-install-295/contract-finance/run.sh";
const restorePredecessor = "a187dc73a133114e1cfbbc891a4aec923abe2545";
const historicalTakeoverGroup = "historical_takeover_a28";
const lanes = Object.freeze({
  line_a_real_db: "line-a",
  contract_settlement_v2: "settlement",
  contract_template_scenario: "template",
  settlement_draft_lifecycle: "draft",
  task398_shared_standard: "task398-standard",
  task407_public_cash_handover: "cash-handover",
  task409_principal_return: "principal-return",
  task410_company_proxy_repayment: "company-proxy",
  payment_execution: "payment-execution",
  fund_execution_v7: "v7",
  invoice_ledger_pol260: "invoice",
  necessary_expense_reserve_pol279: "pol279",
  project_fund_dispute_pol280: "pol280",
  operating_projection_pol108: "pol108-core",
  operating_projection_pol108_facts: "pol108-facts",
  operating_projection_pol108_impacts: "pol108-impacts",
  project_close_profit_pol109: "pol109",
  task398_browser: "browser-partial",
  task398_browser_completion: "browser-completion",
  project_expense_execution: "expense-execution",
  project_expense_finance: "expense-finance",
  project_expense_receipt: "expense-receipt",
  employee_onboarding: "onboarding",
  general_procurement: "procurement",
  pol113_pol115_business_entries: "named",
  contract_finance_acceptance: "contract-finance",
  remaining_dynamic_postgresql16: "remaining",
  [historicalTakeoverGroup]: "historical-takeover-a28"
});

function laneFor334(groupId) {
  return Object.hasOwn(lanes, groupId) ? lanes[groupId] : undefined;
}

function unadmittedGroups334(groups) {
  return groups.filter(group => group.ciExecution !== "manual-only" && !commandFor334(group.id, undefined, group.pol113Pol115Shard))
    .map(group => group.id);
}

function commandFor334(groupId, candidateSha, shard) {
  const lane = laneFor334(groupId);
  if (!lane) return undefined;
  if (lane === "named") {
    if (shard === "pol113_pol114") return [namedRunner, candidateSha, shard];
    // The original POL115 shard also owns spot and public entry suites.
    // The 334 workbench's 9 cases and five separate SMS cases do not cover them.
    return undefined;
  }
  if (shard) return undefined;
  if (lane === "contract-finance") return [financeRunner, candidateSha, mode, restorePredecessor];
  if (lane === "remaining") return [remainingRunner, candidateSha, mode];
  return [runner, candidateSha, lane, mode];
}

module.exports = { runner, historicalTakeoverGroup, commandFor334, unadmittedGroups334 };
