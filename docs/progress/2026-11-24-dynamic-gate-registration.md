# 动态门 PG 用例登记（11 条新 spec + 4 条 verify 脚本）

- 日期：2026-11-24（本地，Asia/Shanghai）
- 工作树 `/tmp/jgAF`，分支 `line-af-manifests`；合入集成分支 `adopt-395-396-415` 的 #423 合并（`7bc366ed8`）
- 迁移仍 **328**（末端 `20261126000000_operating_cost_attribution_confirmation`）；本票未新增迁移、未改产品代码、未 push、未操作生产

## 1. 结论

| 指标 | 旧值 | 新值 |
| --- | ---: | ---: |
| `coveredGroups` 组数 | 34 | **45** |
| `inventory.pendingFiles` / `coveredFiles` | 92 / 92 | **103 / 103** |
| `inventory.pendingTests` / `coveredTests` | 575 / 575 | **609 / 609** |
| `inventory.fullyPendingSuites` | 78 | **82** |
| `inventory.partiallyPendingSuites` | 14 | **21** |
| `executionInventory.ciEligible`（组/文件/用例） | 33 / 91 / 574 | **44 / 102 / 608** |
| `executionInventory.manualOnly`（组/文件/用例） | 1 / 1 / 1 | 1 / 1 / 1 |

11 条新 spec 合计 **34** 个 pending test：7 个 `partial_pending`（12 个用例）+ 4 个 `fully_pending`（22 个用例）。`assertRunGatedPgSpecsRegistered` 此前报出的 3 条 RUN_* spec（issue411、issue416-his-gap、issue416-takeover-handover）已随本轮全部登记。

## 2. 11 条登记明细

| group id | spec | pendingTests | suiteStatus | verify script | runner |
| --- | --- | ---: | --- | --- | --- |
| `issue400_financial_correction_refund` | `issue400-financial-correction-refund.pg.spec.ts` | 1 | partial_pending | `verify:issue400-financial-correction:local`（新增） | `run-issue400-financial-correction-local.cjs` |
| `issue403_actual_purchase_batch` | `issue403-actual-purchase-batch.pg.spec.ts` | 2 | partial_pending | `verify:issue403-actual-purchase:local` | `run-issue403-actual-purchase-local.cjs` |
| `issue404_reimbursement` | `issue404-reimbursement.pg.spec.ts` | 3 | partial_pending | `verify:issue404-reimbursement:local` | `run-issue404-reimbursement-local.cjs` |
| `issue405_other_project_payment` | `issue405-other-project-payment.pg.spec.ts` | 1 | partial_pending | `verify:issue405-other-project-payment:local` | `run-issue405-other-project-payment-local.cjs` |
| `issue411_third_company_repayment` | `issue411-third-company-repayment.pg.spec.ts` | 2 | fully_pending | `verify:issue411-third-company:local` | `run-issue411-third-company-local.cjs` |
| `issue416_his_gap` | `issue416-his-gap.pg.spec.ts` | 3 | partial_pending | `verify:issue416-his-gap:local`（新增） | `run-issue416-his-gap-local.cjs` |
| `issue416_takeover_handover` | `issue416-takeover-handover.pg.spec.ts` | 1 | partial_pending | `verify:issue416-handover:local` | `run-issue416-takeover-handover-local.cjs` |
| `issue417_history_expense` | `issue417-history-expense.pg.spec.ts` | 1 | partial_pending | `verify:issue417-history-expense:local` | `run-issue417-history-expense-local.cjs` |
| `issue418_operating_dedup` | `issue418-operating-dedup.pg.spec.ts` | 9 | fully_pending | `verify:issue418-operating-dedup:local`（新增） | `run-issue418-operating-dedup-local.cjs` |
| `issue421_signed_settlement_ledger` | `issue421-signed-settlement-ledger.http.pg.spec.ts` | 6 | fully_pending | `verify:issue421-ledger:local` | `run-issue421-ledger-local.cjs` |
| `issue421b_four_ledger` | `issue421b-four-ledger.http.pg.spec.ts` | 5 | fully_pending | `verify:issue421b-four-ledger:local`（新增） | `run-issue421b-four-ledger-local.cjs` |

说明：

- `partial_pending` 用于 `describe` 常驻、测试内按 `RUN_*`/`ISSUE*_RUN` 条件 `it.skip` 的 spec；`fully_pending` 用于整组 `describe.skip` 的 spec。
- `pendingTests` 按实际 `it(`/`test(`（含 `integrationTest(` 辅助函数）数量填写；未把 `describe`、`beforeAll` 等计入。
- 4 条新增根脚本：`verify:issue400-financial-correction:local`、`verify:issue416-his-gap:local`、`verify:issue418-operating-dedup:local`、`verify:issue421b-four-ledger:local`。
- `run-issue421-ledger-local.cjs` 与 `run-issue421b-four-ledger-local.cjs` 的镜像常量由 `docker.io/library/postgres:16` 改为清单校验要求的字面 `"postgres:16"`；本机已缓存该镜像，`--pull=never` 未变，属于清单 runner 绑定修正，不改执行语义。

## 3. CI 动态门矩阵

`.github/workflows/ci.yml` 的 `postgresql16-dynamic-gates.matrix.group` 新增 11 个新 group id，顺序与 manifest 一致；另补上 manifest 早已声明但 CI 矩阵遗漏的 `issue414_construction_deduction`（预存欠账，`go-live-ci-gates.test.mjs` 的 configuredGroups 对比需要它），本轮矩阵共 **44** 个自动组 + 1 个手动 task01。

新增行：

```text
issue400_financial_correction_refund
issue403_actual_purchase_batch
issue404_reimbursement
issue405_other_project_payment
issue411_third_company_repayment
issue416_his_gap
issue416_takeover_handover
issue417_history_expense
issue418_operating_dedup
issue421_signed_settlement_ledger
issue421b_four_ledger
```

## 4. 契约测试同步

- `scripts/go-live-ci-gates.test.mjs`：`ciGroups` 32→44、文件 90→102、用例 573→608；configuredGroups 与 manifest 自动组（除 POL113-POL115 shard 组）逐项一致。
- `services/api/prisma/run-database-dynamic-gate-local.test.cjs`：
  - `executionInventory.ciEligible` 30/88/568→44/102/608；
  - `report.coveredTests` 569→609；
  - automatic-only receipt `coveredFiles` 88→102、`coveredTests` 568→608；
  - `validateManifest` 深比较 inventory 89/77/12/569→103/82/21/609；
  - 自动组排除 task01 的 pendingTests 568→608；
  - inventory 漂移 fail-closed 正则 `派生值=569`→`609`。

## 5. 验证结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest` | 0 | `manifestValid: true`；45 组 / 103 文件 / 609 用例；ciEligible 44/102/608；manualOnly 1/1/1；迁移 328 |
| `node --test scripts/go-live-ci-gates.test.mjs` | 0 | 12/12 通过 |
| `node --test services/api/prisma/run-database-dynamic-gate-local.test.cjs` | 0 | 83/83 通过 |

补充：`git diff --check` 通过；未改产品代码、未改迁移、未 push。

## 6. 仍红项

- 无。
- 说明：本轮未执行任何真实 PG 容器（只做 manifest 静态校验与契约测试）；11 个组仍按 `local_disposable_only` 在本地一次性 PostgreSQL 16 执行，CI 由动态门矩阵调度。

## 7. 改动文件

- `services/api/prisma/database-dynamic-gate-manifest.json`（11 组 + inventory/executionInventory）
- `package.json`（4 条 verify 脚本）
- `.github/workflows/ci.yml`（11 个新 group + 补 issue414）
- `scripts/go-live-ci-gates.test.mjs`
- `services/api/prisma/run-database-dynamic-gate-local.test.cjs`
- `services/api/prisma/run-issue421-ledger-local.cjs`、`run-issue421b-four-ledger-local.cjs`（镜像字面量）
- `docs/progress/2026-11-24-dynamic-gate-registration.md`（本回执）
