"use strict";

const mode = "--historical-settlement-334";
const runner = ".github/task12-install-295/contract-finance/run-contract-adjacent-ci.sh";
const historicalTakeoverGroup = "historical_takeover_a28";
const lanes = Object.freeze({
  line_a_real_db: "line-a",
  [historicalTakeoverGroup]: "historical-takeover-a28"
});

function laneFor334(groupId) {
  return Object.hasOwn(lanes, groupId) ? lanes[groupId] : undefined;
}

function unadmittedGroups334(groups) {
  return groups.filter(group => group.ciExecution !== "manual-only" && !laneFor334(group.id))
    .map(group => group.id);
}

module.exports = { mode, runner, historicalTakeoverGroup, laneFor334, unadmittedGroups334 };
