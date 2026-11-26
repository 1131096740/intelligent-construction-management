"use strict";

const base = require("./dynamic-gate-334.cjs");
const { count, terminal } = require("../../../.github/task12-install-295/contract-finance/expense-witness-346-profile.cjs");
const mode = "--expense-witness-346";
const namedRunner = ".github/task12-install-295/named-pol113-pol114/run-matrix346.sh";
const issueLanes = Object.freeze({
  issue400_financial_correction_refund: "issue400_346",
  issue403_actual_purchase_batch: "issue403",
  issue404_reimbursement: "issue404",
  issue405_other_project_payment: "issue405_346",
  issue411_third_company_repayment: "issue411_346",
  issue413_construction_paid: "issue413_346",
  issue414_construction_deduction: "issue414_346",
  issue416_takeover_handover: "issue416_handover_346",
  issue416_his_gap: "issue416_his_346",
  issue417_history_expense: "issue417",
  issue418_operating_dedup: "issue418-operating",
  issue420_approval_center: "issue420_346",
  issue421_signed_settlement_ledger: "issue421_346",
  issue421b_four_ledger: "issue421b_346",
  issue422_archives: "issue422_346"
});

function commandFor346(groupId, candidateSha, shard) {
  if (groupId === "pol113_pol115_business_entries") {
    if (shard === undefined || shard === "" || shard === "pol113_pol114" || shard === "pol115_workbench") {
      return [namedRunner, candidateSha, shard || "all"];
    }
    return undefined;
  }
  if (shard) return undefined;
  if (Object.hasOwn(issueLanes, groupId)) return [base.runner, candidateSha, issueLanes[groupId], mode];
  const command = base.commandFor334(groupId, candidateSha);
  return command?.map(value => value === "--historical-settlement-334" ? mode : value);
}

function unadmittedGroups346(groups) {
  return groups.filter(group => group.ciExecution !== "manual-only" &&
    !commandFor346(group.id, undefined, group.pol113Pol115Shard)).map(group => group.id);
}

function matchesBaseline346(baseline) {
  return baseline?.expectedDirectoryCount === count && baseline.terminalMigration === terminal.name &&
    baseline.terminalMigrationChecksum === terminal.sha256;
}

module.exports = { commandFor346, unadmittedGroups346, matchesBaseline346 };
