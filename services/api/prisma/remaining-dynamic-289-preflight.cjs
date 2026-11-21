'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const inventory = require('./remaining-dynamic-289-inventory.json');

const groupIds = Object.freeze([
  'contract_draft_aggregate', 'project_funding_availability', 'takeover_task1',
  'affiliate_company_contract', 'spot_material_classification', 'direct_payment_capacity',
  'takeover_correction', 'file_binding_manifest', 'project_operating_profile_upgrade',
  'generic_database_constraints', 'participant_history_integrity', 'payable_settlement',
  'wage_statement', 'historical_wage_takeover', 'historical_financial_takeover', 'fund_movement',
]);

const wired = new Set(['direct_payment_capacity','project_funding_availability','generic_database_constraints',
  'fund_movement','takeover_correction','participant_history_integrity','payable_settlement',
  'takeover_task1','file_binding_manifest','spot_material_classification','contract_draft_aggregate',
  'project_operating_profile_upgrade','wage_statement']);

const distinctScopes = Object.freeze({
  contract_draft_aggregate: 'dual_database',
  affiliate_company_contract: 'fresh_with_named_bank_runtime',
  project_operating_profile_upgrade: 'retained_prefix_then_seed_and_forward',
  wage_statement: 'exact_current_terminal_predecessor_then_one_forward',
  historical_wage_takeover: 'fresh_with_actual_candidate_git_baseline',
  historical_financial_takeover: 'fresh_with_actual_candidate_git_baseline',
});

function requireExact(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(filename, root) {
  const stat = fs.lstatSync(filename);
  requireExact(stat.isFile() && fs.realpathSync(filename) === filename &&
    filename.startsWith(root + path.sep), 'REMAINING_289_UNSAFE_SOURCE_PATH');
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function verifyInventory(repository) {
  const root = fs.realpathSync(repository);
  const api = path.join(root, 'services/api');
  requireExact(inventory.format === 1 &&
    inventory.candidateTree === 'a1be083076018686dd8afba68c44ff9c75502014' &&
    inventory.groups.map(group => group.id).join(',') === groupIds.join(','),
  'REMAINING_289_INVENTORY');
  for (const group of inventory.groups) {
    const { requirements, localEvidence } = group;
    requireExact(requirements.kind === (distinctScopes[group.id] ?? 'fresh_owned_original_suite'),
      'REMAINING_289_FIXTURE_SCOPE');
    requireExact(group.flags && Object.entries(group.flags).every(([key, value]) =>
      /^[A-Z][A-Z0-9_]+$/u.test(key) && (value === '1' || value === 'databaseUrl')),
    'REMAINING_289_FLAGS');
    requireExact(group.files.length === group.sourceFiles.length && group.files.length > 0,
      'REMAINING_289_ORIGINAL_PATHS');
    for (const [index, source] of group.sourceFiles.entries()) {
      requireExact(source.file === group.files[index] && /^src\/(?:[a-z0-9-]+\/)+[a-z0-9.-]+\.spec\.ts$/u.test(source.file) &&
        sha256(path.join(api, source.file), root) === source.sha256, 'REMAINING_289_ORIGINAL_SOURCE');
    }
    for (const input of [requirements.legacy, requirements.firstExcluded, requirements.previous, requirements.next]) {
      if (!input) continue;
      requireExact(/^\d{14}_[a-z0-9_]+$/u.test(input.name) &&
        sha256(path.join(api, 'prisma/migrations', input.name, 'migration.sql'), root) === input.sha256,
      'REMAINING_289_HISTORICAL_SOURCE');
    }
    requireExact(['verified', 'pending', 'blocked'].includes(localEvidence.status) &&
      localEvidence.receiptSha256.every(hash => /^[0-9a-f]{64}$/u.test(hash)) &&
      (localEvidence.status !== 'verified' || localEvidence.receiptSha256.length > 0),
    'REMAINING_289_LOCAL_EVIDENCE');
  }
  return {
    releaseTree: inventory.candidateTree,
    mode: 'preflight',
    executed: false,
    groups: inventory.groups.map(group => ({
      id: group.id, files: group.files, originalFlags: group.flags, requirements: group.requirements,
      localEvidence: group.localEvidence,
      execution: wired.has(group.id) ? 'wired_offline' : 'blocked',
      reason: wired.has(group.id) ? 'explicit_private_dispatch_only' :
        group.id === 'affiliate_company_contract' ? 'named_bank_authority_unresolved' :
        group.requiresCandidateBaselineSha ? 'exact_candidate_commit_required' : 'no_repo_owned_runtime_handoff',
    })),
  };
}

if (require.main === module) {
  try {
    requireExact(process.argv.length === 4 && process.argv[2] === '--preflight', 'REMAINING_289_PREFLIGHT_ONLY');
    console.log(JSON.stringify(verifyInventory(process.argv[3])));
  } catch (error) {
    const code = error.message;
    console.error(/^[A-Z0-9_]+$/u.test(code) ? code : 'REMAINING_289_INVALID_INPUT');
    process.exitCode = 1;
  }
}
module.exports = { verifyInventory };
