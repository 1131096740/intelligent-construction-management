# Task05 Spec independent re-review

Candidate `c37e0a7dac213e27420f32ee24f4edaf1fc35512`; fixed point `4bda312d23a1200510b96d39674fe4ded7d65638`. Reviewed `git diff <fixed>...<candidate>` (79 files), task05/IAM01/02/03/05/13, APR04/12, D03 and the original b87 findings. This is the Spec axis only.

## Findings

**No confirmed unresolved Spec findings in the agreed local boundary.**

- Original privacy P1 closed: `auth/sensitive-business-read.ts:2-9` now explicitly distinguishes settlement/payment duties; `ContractReadService` independently limits contract full views and nested financial rows, suppresses incomplete aggregate balances, preserves v2 draft not-applicable balances and technical-admin read/approve separation. Independently replayed public SettlementReadService/PaymentReadService calls with unrelated actors: employee/material_staff/budget_staff/engineering_tech/material_director each0/0 rows; contract_director1/0; finance_staff/finance_director/comprehensive_director each1/1. No participation facts were supplied. Existing public tests also cover details and private attachments.
- Original unbounded-new-delegation P1 closed: `ApprovalDelegationService.create` rejects absent scope before persistence. Public-service diagnostic produced the Chinese refusal and writes=0. Exact spot duty creation/revocation still checks the live duty/current identities and uses the transaction lock; new capability GETs only gate UI affordances. Existing legacy records/consumers are retained rather than silently rewritten.
- Original IAM01 P2 closed: new `ApprovalRuleAssignmentsService.read` obtains visible active projects and current effective role assignments, returns only names/IDs and missing flags, rejects an unrelated project; `ApprovalFlowReadonlyPanel.vue` renders these actual results. Static rule text now explicitly distinguishes current parallel spot responsibilities from each other domain's existing frozen mechanism. No node editor was introduced.
- Self-review creator/submission provenance, own-password confirmation, per-duty handling, actual/represented signer audit, expiry/disable/revocation checks and prepared competition assertions remain present. Existing creator provenance ambiguity is explicitly left to42 reconciliation, without fabricating historical identity.

## Independent checks

Read-only memory diagnostics above; API public seams:4 suites/41 tests passed (`approval-rule-assignments.http`, `approval-delegation-duty.service`, `sensitive-ledger-read.service`, `personnel-private-file-access.service`). Web actual rendering checks:2 files/4 tests passed (`approval-flow-readonly.component`, `delegation-list.component`). No new test files or source edits.

Real PG/locking competition, actual migration/history reconciliation, SMS/storage and deployment were not run and are not certified. New parallel duty protocol remains the spot first chain; future domain adoption and16/42/44 hard gates remain. These local results do not establish production completion or release readiness.

**Spec unresolved:0.**
