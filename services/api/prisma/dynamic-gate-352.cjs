"use strict";

const prior = require("./dynamic-gate-349.cjs");
const gate346 = require("./dynamic-gate-346.cjs");
const { count, terminal } = require("../../../.github/task12-install-295/contract-finance/company-history-352-profile.cjs");
const { issueOrderedScopes352 } = require("../../../.github/task12-install-295/contract-finance/issue-ordered/profiles.cjs");
const mode = "--company-history-352";

function commandFor352(groupId, candidateSha, shard) {
  const command = prior.commandFor349(groupId, candidateSha, shard);
  if (!command) return undefined;
  return command.map(value => value === "--expense-witness-349" ? mode
    : typeof value === "string" && /_349$/u.test(value) ? value.replace(/_349$/u, "_352") : value);
}

function unadmittedGroups352(groups) {
  return groups.filter(group => group.ciExecution !== "manual-only" &&
    !commandFor352(group.id, undefined, group.pol113Pol115Shard)).map(group => group.id);
}

function matchesBaseline352(baseline) {
  return baseline?.expectedDirectoryCount === count && baseline.terminalMigration === terminal.name &&
    baseline.terminalMigrationChecksum === terminal.sha256;
}

function issue418Tests352() {
  return gate346.issue418Tests346(issueOrderedScopes352.filter(scope => scope.startsWith("issue418_")));
}

module.exports = { commandFor352, unadmittedGroups352, matchesBaseline352, issue418Tests352 };
