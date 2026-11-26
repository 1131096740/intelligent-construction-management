"use strict";

const mode = "--historical-settlement-334";
const runner = ".github/task12-install-295/contract-finance/run-contract-adjacent-ci.sh";
const remainingRunner = ".github/task12-install-295/contract-finance/run-remaining.sh";
const financeRunner = ".github/task12-install-295/contract-finance/run.sh";
const restorePredecessor = "a187dc73a133114e1cfbbc891a4aec923abe2545";
const historicalTakeoverGroup = "historical_takeover_a28";
const lanes = Object.freeze({
  line_a_real_db: "line-a",
  contract_finance_acceptance: "contract-finance",
  remaining_dynamic_postgresql16: "remaining",
  [historicalTakeoverGroup]: "historical-takeover-a28"
});

function laneFor334(groupId) {
  return Object.hasOwn(lanes, groupId) ? lanes[groupId] : undefined;
}

function unadmittedGroups334(groups) {
  return groups.filter(group => group.ciExecution !== "manual-only" && !laneFor334(group.id))
    .map(group => group.id);
}

function commandFor334(groupId, candidateSha) {
  const lane = laneFor334(groupId);
  if (!lane) return undefined;
  if (lane === "contract-finance") return [financeRunner, candidateSha, mode, restorePredecessor];
  if (lane === "remaining") return [remainingRunner, candidateSha, mode];
  return [runner, candidateSha, lane, mode];
}

module.exports = { runner, historicalTakeoverGroup, commandFor334, unadmittedGroups334 };
