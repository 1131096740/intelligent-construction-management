"use strict";

const prior = require("./dynamic-gate-346.cjs");
const { count, terminal } = require("../../../.github/task12-install-295/contract-finance/expense-witness-349-profile.cjs");
const mode = "--expense-witness-349";
const scopeOverrides = Object.freeze({
  issue400_346: "issue400_349",
  issue403: "issue403_349",
  issue404: "issue404_349",
  issue405_346: "issue405_349",
  issue411_346: "issue411_349",
  issue413_346: "issue413_349",
  issue414_346: "issue414_349",
  issue416_handover_346: "issue416_handover_349",
  issue416_his_346: "issue416_his_349",
  issue420_346: "issue420_349",
  issue421_346: "issue421_349",
  issue421b_346: "issue421b_349",
  issue422_346: "issue422_349"
});

function commandFor349(groupId, candidateSha, shard) {
  const command = prior.commandFor346(groupId, candidateSha, shard);
  if (!command) return undefined;
  if (groupId === "pol113_pol115_business_entries") return [...command, mode];
  return command.map(value => value === "--expense-witness-346" ? mode : scopeOverrides[value] ?? value);
}

function unadmittedGroups349(groups) {
  return groups.filter(group => group.ciExecution !== "manual-only" &&
    !commandFor349(group.id, undefined, group.pol113Pol115Shard)).map(group => group.id);
}

function matchesBaseline349(baseline) {
  return baseline?.expectedDirectoryCount === count && baseline.terminalMigration === terminal.name &&
    baseline.terminalMigrationChecksum === terminal.sha256;
}

module.exports = { commandFor349, unadmittedGroups349, matchesBaseline349 };
