# Task16 B3 baseline migration stage: independent integration

Author commit `bbb6e6c15fb600d7ca5f2630eb781c142662ee5c` (11 reviewed paths) merged into original integration as `27d14904b137e8fb8023f539dd1bd6d047507ee0`, base `db273ffe34adc8373520e7fb463e2ccd5181665b`. No SQL migration/schema, CI, actual resource helper, Task10 source or unrelated work was changed. Author worktree and all historical evidence remain.

Both independent review follow-ups close their initial findings: Spec1 P2 (actual migration-directory inventory) and Standards2 P2 (owned group after leader close; asynchronous spawn errors without stdio). Reports: `/private/tmp/jg-382-task16-baseline-migrations-spec-review-20261108.md` and `/private/tmp/jg-382-task16-baseline-migrations-standards-review-20261108.md`. Final manifest SHA256 `ce0199b22d5060193607243c18857b637edb56ffb61666604fc0aa79a7dbc3ef`; six source hashes match before and after independent central checks. Earlier REDs and first manifest remain historical, not a clean-first-run claim.

| Reviewed source | SHA256 |
| --- | --- |
| services/api/prisma/run-task16-registered-pg-local.cjs | 3375d069a8714a372564a85ca07c44c4e8fac7bb69ce5093b1f876d89c023ff5 |
| services/api/prisma/run-task16-registered-pg-local.test.cjs | 41164fff96d82f1ebe2e5017079ecf151fecf74723c4dcd557dada04c810c992 |
| services/api/prisma/task16-runtime-inputs.cjs | 31e9054804e5c3a4498468a4d22f15ba3678326a5e8a58dba80e40976e2f3380 |
| services/api/prisma/task16-runtime-inputs.test.cjs | f66a293fab238d44358e4d86cfc3f04469321c3145309c0845b2773085adea1c |
| services/api/prisma/task16-baseline-migrations.cjs | 99719b3866655e93ebe3dc9a5d99f59e8d044ad37eb838e4a0b5ec35d5ad5533 |
| services/api/prisma/task16-baseline-migrations.test.cjs | d1a702d35fca2e80b96408630c349a9c2dcc0742b1eb5d9bd8fec11c8116e285 |

On the clean exact code-merge SHA, independent Node20.20.2 original43 plus B3 tests39 =82/82 and original source CLI25/25 passed once, zero fail/skip. Six CJS syntax checks, CJS-mode targeted ESLint (existing no-var-requires override), and Git diff check passed. Fresh environment used only HOME/PATH/NODE_ENV=test/TZ/LANG/LC_ALL. No API TypeScript files changed; author API type/full-src lint records are not represented as fresh central runs. Exact commands/logs and pre/post pins: `/private/tmp/jg-382-task16-B3-merger-20261108/integration-checks-receipt.json`.

Clean code-merge source-only prepare/verify returned3277 source files,202 migration files,7 SQL fragments,1 static case. Packet SHA256 `ad94e3f1da3dad8b5c691536f1e95fdac3820122b0c494d6fbb54dd6789fc48e`; seal `35a70b698ea579cb25a335a09890e3ffd7a598856005e6148b7e1788cc3519a1`. This document and ledger update produce a later documentation commit; the old packet does not cover that later head. Final clean exact-head prepare/verify and external expected digest are recorded separately in `/private/tmp/jg-382-task16-B3-merger-20261108/final-head-seal-receipt.json`. Final GitHub head/Draft/checks readback is likewise external; empty checks is not CI acceptance.

Tests read current202 SQL/schema source but only simulate process/owner/TLS/ledger protocols. New five-function process boundary uses EventEmitter/fake clocks; no actual pnpm/Prisma/spawn/TERM/KILL/SQL/PG/resource stage ran. Source CLI performs real Git/source sealing but does not prove full runtime dependency admission. Default remains missing7 native capabilities and refuses before source/resource acquisition. TLS, baseline/registered effective ACL, clients/App/fixture/case, real COMMIT/fault/response-loss/concurrency and cleanup remain unverified. No rollback or physical process-group cleanup is claimed.

User authorization permits scoped commit/integration/push to original integration/Draft428 (see `/private/tmp/jg-382-push-authorization-20261107.md`). It does not authorize main merge, actual SQL/resources, deployment or production. #398 stays OPEN,17/24 and16/42/44 gates remain,13/45 unchanged; Task10 and Task12 status are not advanced by B3. Historical uncommitted paragraphs below the ledger's new integration summary are retained as historical records.
