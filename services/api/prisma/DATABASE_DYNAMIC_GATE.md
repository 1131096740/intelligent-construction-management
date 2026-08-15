# 本机 PostgreSQL 16 动态门

本入口把当前 80 条受 `RUN_*` 控制的数据库测试纳入一次性本机 PostgreSQL 16 runner。清单以
`database-dynamic-gate-manifest.json` 为机器真相；可编排不等于已经通过，必须以执行收据为准。

当前迁移基线是 126 个目录，终点为
`20260814010000_project_operating_profile`。

## 只读检查

以下命令不会调用 Git、Docker、PostgreSQL 或子测试 runner：

```bash
node services/api/prisma/run-database-dynamic-gate-local.cjs
node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest
node services/api/prisma/run-database-dynamic-gate-local.cjs --list
node services/api/prisma/run-database-dynamic-gate-local.cjs --list --group payment_execution
node --test services/api/prisma/run-database-dynamic-gate-local.test.cjs
```

## 动态执行

只有同时满足以下条件才会执行：

- 提供当前工作树精确的 40 位候选 SHA；
- 提供确认串 `LOCAL_PG16_DYNAMIC_GATE`；
- 工作树完全干净，候选 SHA 与 `HEAD` 一致；
- `NODE_ENV` 不是 `production`；
- 进程没有继承 `DATABASE_URL` 或任何 `*_DATABASE_URL`；
- Docker context 解析为本机 Unix socket 或 Windows named pipe；
- 本机已经缓存 `postgres:16`，入口不会拉取镜像；
- 源码仍精确包含 126 个迁移目录及当前终点迁移。

执行格式如下，`<CURRENT_40_CHAR_SHA>` 必须手工替换为已核验候选：

```bash
node services/api/prisma/run-database-dynamic-gate-local.cjs \
  --execute \
  --candidate-sha <CURRENT_40_CHAR_SHA> \
  --confirm LOCAL_PG16_DYNAMIC_GATE
```

不提供 `--group` 时仍按清单执行全部 9 组。CI 可以重复提供 `--group <清单组名称>`，只执行选中的组：

```bash
node services/api/prisma/run-database-dynamic-gate-local.cjs \
  --execute \
  --group payment_execution \
  --candidate-sha <CURRENT_40_CHAR_SHA> \
  --confirm LOCAL_PG16_DYNAMIC_GATE
```

组名必须来自 `database-dynamic-gate-manifest.json`；未知组和重复组均失败关闭。多组始终按清单顺序执行，
收据中的测试数、文件数和组结果只覆盖本次选中范围。`--list --group <组名>` 可在不调用 Git、Docker、
PostgreSQL 或子测试 runner 的情况下预览同一选择。

不提供 `--group` 的全量入口先生成 Prisma Client 并构建 API，然后按清单串行调用 9 组 runner。已有 8 组保持独立收据；第 9 组由
`run-database-dynamic-remaining-local.cjs` 再按专库和环境开关拆成 9 个子组，覆盖原先缺少编排的 56 条。
每个 runner 自建仅绑定 `127.0.0.1` 的一次性 PostgreSQL 16 容器/数据库并自行清理；任一组失败即停止。
最终标准输出是一行机器可读 JSON 收据，固定登记候选 SHA、迁移基线、镜像 ID、实际执行组及其测试覆盖。

严禁把生产库、自然生产库、生产备份恢复库或远程 Docker endpoint 用作本入口目标。本入口也不会触发生产自然备份。

## 已接入的 24 条

| runner 组 | pending tests | 文件数 |
| --- | ---: | ---: |
| project financing quota | 13 | 1 |
| contract template scenario | 4 | 1 |
| contract settlement V2 | 2 | 2 |
| payment execution | 1 | 1 |
| project expense execution | 1 | 1 |
| project expense finance | 1 | 1 |
| project expense receipt | 1 | 1 |
| settlement draft lifecycle | 1 | 1 |
| 合计 | 24 | 9 |

## 新增编排的 56 条

| 测试文件 | pending tests | RUN 开关 |
| --- | ---: | --- |
| contract-draft-aggregate-concurrency.spec.ts | 6 | `RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE` |
| project-funding-availability-concurrency.spec.ts | 1 | `RUN_PROJECT_FUNDING_DATABASE` |
| contract-draft-retention-script.spec.ts | 1 | `RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE` |
| contract-lifecycle-route.spec.ts | 1 | `RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE` |
| contract-ended-application-retention.spec.ts | 1 | `RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE` |
| contract-ended-application-purge.spec.ts | 6 | `RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE` |
| legacy-contract-cleanup-preflight-postgres.spec.ts | 2 | `RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE` |
| contract-takeover-confirmation-concurrency.spec.ts | 2 | `RUN_CONTRACT_TAKEOVER_CONFIRMATION_CONCURRENCY` |
| project-affiliate-company-contract-db.spec.ts | 4 | `RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS` |
| contract-takeover-balance-concurrency.spec.ts | 1 | `RUN_CONTRACT_TAKEOVER_BALANCE_CONCURRENCY` |
| settlement-contract-cap-concurrency.spec.ts | 1 | `RUN_SETTLEMENT_CONTRACT_CAP_CONCURRENCY` |
| contract-takeover-correction-concurrency.spec.ts | 1 | `RUN_CONTRACT_TAKEOVER_CORRECTION_CONCURRENCY` |
| file-binding-manifest.spec.ts | 1 | `RUN_FILE_BINDING_MANIFEST_DATABASE` |
| contract-change-limit-transaction.spec.ts | 1 | `RUN_CONTRACT_CHANGE_LIMIT_DATABASE` |
| direct-payment-capacity-concurrency.spec.ts | 1 | `RUN_DIRECT_PAYMENT_CAPACITY_CONCURRENCY` |
| project-affiliate-business-fact-db.spec.ts | 3 | `RUN_PROJECT_AFFILIATE_BUSINESS_DB_TESTS` |
| approval-review-concurrency.spec.ts | 1 | `RUN_APPROVAL_REVIEW_CONCURRENCY` |
| spot-material-classification-concurrency.spec.ts | 1 | `RUN_SPOT_MATERIAL_CLASSIFICATION_DATABASE` |
| contract-change-baseline-concurrency.spec.ts | 1 | `RUN_CONTRACT_CHANGE_BASELINE_CONCURRENCY` |
| project-upstream-fund-fact-db.spec.ts | 2 | `RUN_PROJECT_UPSTREAM_FUND_DB_TESTS` |
| project-operating-profile-db.spec.ts | 13 | `RUN_PROJECT_OPERATING_PROFILE_DB_TESTS` |
| contract-governance-file-concurrency.spec.ts | 1 | `RUN_CONTRACT_GOVERNANCE_CONCURRENCY` |
| project-external-upstream-db.spec.ts | 2 | `RUN_PROJECT_EXTERNAL_UPSTREAM_DB_TESTS` |
| project-affiliate-subject-db.spec.ts | 2 | `RUN_PROJECT_AFFILIATE_DB_TESTS` |
| 合计 | 56 | 24 个文件 |

这 56 条已通过统一 runner 补齐一次性数据库命名、127.0.0.1 绑定、完整迁移、固定环境开关、失败清理与候选收据；执行失败仍会使动态数据库总门保持阻塞。
