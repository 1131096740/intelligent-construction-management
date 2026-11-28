# Quality gates 与 project_expense_receipt 夹具收敛回执

- 日期：2026-11-23（Asia/Shanghai）
- 工作树 `/tmp/jgO`，分支 `line-o-quality`，基线 `1d1701018`（迁移 323）
- 修复提交 `c47250d2f`（本回执另起一个 docs-only 提交）
- 迁移仍 323 / 终态 `20261119007500_signed_change_and_settlement_attachment_file_binding` / `98e016b2…`；未改 `07500`/`05800`；未 push；未动 `/tmp/jgL`、`/tmp/jg382-adopt`、主仓库。

## 结论

| 项 | 首因 | 判定 | 修法 | 实跑 |
| --- | --- | --- | --- | --- |
| `Quality gates`（22 个子测试） | 竞争监视 SQL 的夹具前缀漏抄产品锁查询新增列 | 夹具过期，非产品错 | 前缀补 `payment."signedSettlementId"`（1 行，断言不变） | 本文件 58/58；全套 2378 tests / 0 fail |
| `project_expense_receipt` | receipt spec 暂存摘要 pin 停留在 322 时代 | 夹具 pin 过期，非产品错 | 重算 `profiles.json.patch` 的 `sha256` 为 323 补丁后实际值 | 三模式全部 PASSED（详见下） |

两项都不需要产品介入；未放宽断言、未删用例、未改产品迁移。

## 1. Quality gates（node --test 大套件）

CI 现场：run `45134131880`，job `137556217524`（head `930cde853`）。
CI 汇总 `# tests 2378 / pass 2355 / fail 22`；22 个失败全部落在
`services/api/prisma/task16-current259-payment-competition.test.cjs`
（子测试 1897、1900、1907–1913、1915–1924、1928、1929、1933；任务单列的 8 个是其中一部分，
`A17 rejects changedBytes`、`preserves the first safe stage …`、follow-up 组等同样红）。

本地复现（基线 `1d1701018`，未改任何文件）：

```
node --test services/api/prisma/task16-current259-payment-competition.test.cjs
# tests 58 / pass 36 / fail 22
not ok … CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED
```

模块在 `executeCurrent259PaymentCompetition` 的 `catch{}` 里把首因折叠成固定错误码，
先临时在本地 catch 打印原始错误（仅诊断，随后已还原）取到：

```
AssertionError: The expression evaluated to a falsy value:
  assert.ok(prefix&&observed.startsWith(prefix))
    at execOwnerSql (task16-current259-payment-competition.test.cjs:122)
    at withSamePaymentLock (task16-current259-payment-competition.cjs:95)
```

首因：`task16-current259-payment-competition.cjs` 里的 `paymentLockPrefix` 是
`payment-request.service.ts#lockPaymentRequestForUpdate` 锁查询投影的逐字镜像；
`55dbfbd42`（2026-11-22，#396 已签结算最近确认一期）在产品锁查询里新增了
`payment."signedSettlementId"`（service 现行行 2054），但夹具镜像没有跟着补，导致
`observed.startsWith(prefix)` 失败。

判定：**期望/夹具过期**。ACL（`general-procurement-runtime-grants.sql`、`07500` 绑定注册表）
与本失败无因果；失败在纯模型测试里，未连数据库、未走角色授权。

修法：在 `paymentLockPrefix` 的 `settlementId` 之后、`sourceType` 之前补
`payment."signedSettlementId"`。前缀更完整、`startsWith` 断言保持原样（更严不更松）。

实跑：
- 单文件：`58/58 pass`。
- 全套（`package.json` 的 `test:ci-orchestration` 109 个文件）：
  `# tests 2378 / pass 2377 / fail 0 / skipped 1`，与 CI 的 2378 个测试同量。
- 本地环境对齐说明：CI 在跑该套件前执行 `pnpm --filter @jiangkong/api exec prisma generate`；
  本地首次未生成时另有 8 个与本修复无关的 `.prisma/client/default` `MODULE_NOT_FOUND`
  （`go-live-ci-gates` 1 个、`operational-maintenance-write-boundary` 6 个、
  `run-database-dynamic-gate-local` 1 个）。按 CI 步骤补跑 `prisma generate`
  （`HOME`/`XDG_CACHE_HOME` 指向 /tmp 以避开本机沙箱）后重跑，这 8 个全绿，最终 0 fail。

## 2. PostgreSQL 16 dynamic gate (project_expense_receipt)

CI 现场：job `137556218025`（head `930cde853`）。日志里只有折叠后的 receipt：

```
"failure":{"stage":"EXACT_295_MULTI_WITNESS_CONSUMER","code":"ERR_ASSERTION"}
"forward320":{"count":323,"ledgerSha256":"0139b46a…","sameIdentity":true,"sameBaseB7":true}
```

没有 SQLSTATE，也没有断言消息：`run-expense.sh` 在失败时只打印
`EXPENSE_323_STOPPED receipt app <work>`，docker 的 stderr 未落日志（这正是任务单说的
"具体断言未取到"）。注意 `stage` 停在 `EXACT_295_MULTI_WITNESS_CONSUMER`，说明失败发生在
installer 进入 consume 之后、`expense-app.cjs` 推送自己的 stage 之前，即 app 入口的头部断言。

本地取首因（不需要数据库）：用 lane 同款暂存
`stage-expense.py .github/task12-install-290/expense …/common /tmp/stage-test`，
把三个 lane 暂存 spec 的 sha256 与 `profiles.json` 的 pin 对比：

| lane | pin | 暂存后实际 | 结果 |
| --- | --- | --- | --- |
| execution | `ae0417f6…` | `ae0417f6…` | OK |
| finance | `94305a12…` | `94305a12…` | OK |
| receipt | `3a4097ca…` | `0df01184…` | **MISMATCH** |

`expense-app.cjs` 在推 `EXPENSE_295_MIGRATION_NOOP` 之前先执行
`assert.equal(digest(readFileSync(spec)), config.sha256, 'EXPENSE_295_TEST_SOURCE')`，
它抛 `ERR_ASSERTION` 时 `receipt.stages` 的最后一格仍是 installer 的
`EXACT_295_MULTI_WITNESS_CONSUMER`，与 CI 现场完全吻合。

首因链：`7587165fa`（2026-11-23「295 冻结链当前终态重基线 322→323」）把
`receipt.spec.ts.patch` 里的 322 改成 323，但没有重算
`profiles.json.patch` 中的派生摘要 `3a4097ca…`（该值来自 `e717ba4c6` 的 322 时代补丁结果）。
仓库内 `3a4097ca…` 只出现在 `profiles.json.patch` 一处，无第二消费者。

判定：**期望/夹具 pin 过期**。`receipt.spec.ts.patch` 是内容真源（323 分支改为
`JG_CONTRACT_FINANCE_LEDGER === "323" ? 323 : 295`），摘要必须由它重算；
不是产品账本错，也不是 ACL 错（该断言在业务/角色之前）。

修法：将 `profiles.json.patch` 的 receipt `sha256` 改为补丁后实际摘要
`0df01184a2d93eb724c709fd3c54cc85139f232d6e6340444809a8062a209762`；
重跑暂存后 execution / finance / receipt 三个 pin 全部 OK。

实跑（现有 CI 入口，exact SHA）：

```
BUILDX_CONFIG=/tmp/jg-buildx \
  bash .github/task12-install-295/contract-finance/run-contract-adjacent-ci.sh \
  c47250d2fb4bf964cad203e74c2f18ad34e2a4fb expense-receipt --current-320
# exit 0
```

同一入口在随后的 `afbd0f47a`（仅新增本回执的 docs-only 提交，代码树与
`c47250d2f` 相同）复跑，同样 `exit 0`、三模式 PASSED，作为最终 HEAD 的复验。

三个模式回执：

| 模式 | status | 关键数 |
| --- | --- | --- |
| app | `ORIGINAL_EXPENSE_323_APPLICATION_PASSED` | `expenseApp: passed=1 failed=0 skipped=0 total=1 exit=0`；`forward320.count=323`、`combinedAfterBusiness.count=323`、两者 `ledgerSha256=0139b46a…` |
| valid | `ORIGINAL_EXPENSE_323_RETAINED_VALID_PASSED` | `business=CALLBACK_COMPLETED`、323 / `0139b46a…` |
| negative | `ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_PASSED` | `business=NOT_ENTERED`（负例按预期不进入业务） |

说明：首跑在本机沙箱下被 `~/.docker/buildx/activity` 写权限挡住（
`failed to update builder last activity time … operation not permitted`），用
`BUILDX_CONFIG=/tmp/jg-buildx` 重定向 buildx 配置后通过；这是本机执行环境差异，
不涉及仓库改动。

## 3. 验证汇总

| 检查 | 结果 |
| --- | --- |
| `pnpm check:migration-baseline` | `status=clean`，323 / `20261119007500…` / `98e016b2…`，drift 空 |
| `node --test <test:ci-orchestration 109 文件>` | 2378 tests / 2377 pass / 0 fail / 1 skip |
| `task16-current259-payment-competition.test.cjs` | 58/58 pass |
| expense-receipt lane（app/valid/negative） | 全 PASSED，exit 0 |
| `docker ps -q` | 实测为空（0 行） |
| `07500` / `05800` 产品迁移 | 未改 |
| push / 其它工作树 | 未 push；未动 `/tmp/jgL`、`/tmp/jg382-adopt`、主仓库 |

## 4. 仍红项（不在本任务两项范围内，未推进）

同一 CI run（`45134131880`）里另有与本修复无关的红项，本轮未触碰：
`remaining_dynamic_postgresql16`、`clearing_reconciliation_pol275`、
`contract_finance_acceptance`、`task410_company_proxy_repayment`。

本任务两项无产品介入需求，也无残留红项。
