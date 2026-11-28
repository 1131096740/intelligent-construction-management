# 2026-11-23 pin 收敛回执（line-q-pin-convergence）

- 工作树：`/tmp/jgQ`，分支 `line-q-pin-convergence`
- 基线：`e3ac3374b`（迁移 323，终态 `20261119007500`，校验和 `98e016b2…`）；收尾前按集成要求合入 `adopt-395-396-415`（tip `2ef132450`，本线 merge `2bc1f23f4`），账本摘要前移至 `5623f6ae…`，见第 9 节
- CI 首轮：run `45140020937`（head `e3ac3374b`），五个红门
- 本轮未 push；未改产品代码（`services/api/src`、`apps`、`packages`）、未改 `07500`/`05800`、未加迁移、未放宽任何断言。
- pin 图：`docs/progress/2026-11-23-pin-graph.md`

## 1. 提交内容

| 文件 | 变更 | 性质 |
| --- | --- | --- |
| `.github/task12-install-295/contract-finance/procurement/candidate-delta320.json` | 新增 `services/api/prisma/task16-current259-payment-competition.cjs`：`034e447e…` → `2194879b…` | 采购输入增量（跟随 A17 `c47250d2f` 的锁投影） |
| `.github/task12-install-295/contract-finance/bank/staging-320.json` | `bank/execution-files.json` 后像 `59f97c98…` → `47a13512…` | 银行 lane 生成物摘要 |
| `.github/task12-install-295/contract-finance/bank/named-bank-ci.cjs` | 容器内同一常量 `59f97c98…` → `47a13512…` | 消费端摘要断言 |
| `.github/task12-install-295/contract-finance/onboarding/onboarding-323-source-drift.json` | 102 条 → 112 条（4 更新 + 10 新增） | onboarding 源漂移 pin |
| `docs/progress/2026-11-23-pin-graph.md` | 新建 | 图与重算说明 |
| `docs/progress/2026-11-23-pin-convergence.md` | 本回执 | 证据 |

未改 `staging-manifest.json`：`restore/app-inputs.json`、`restore/loan-relocated-manifest.json` 由 **predecessor（a187dc）** workspace 生成，原值经实测正确（详见 pin 图 N4/N5）。

## 2. 重算清单（旧值 → 新值 → 派生源）

| 产物 | 旧值 | 新值 | 派生源 |
| --- | --- | --- | --- |
| `candidate-delta320.json`（task16 竞争脚本） | 无条目 | `candidate=2194879b…`，`expected=034e447e…` | `services/api/prisma/task16-current259-payment-competition.cjs` 当前字节；锁前缀对齐 `payment-request.service.ts` 的 `payment."signedSettlementId"` |
| `bank/staging-320.json` | `59f97c98f8984eb40dc60e22f9cdaa52866940d948999719a03ed2140520d2f1` | `47a135121225f90671fd63cd2c58a81b84021adf1a7a362d13f5277438fa0282` | `stage-overlays.py` 在 `prepare.sh --current-320` 的 workspace 上对 1833 条路径逐条 sha256 |
| `bank/named-bank-ci.cjs` | 同上旧值 | 同上新值 | 同上（容器内 `/qualification/execution-files.json` 复算） |
| `onboarding-323-source-drift.json` | 102 条 | 112 条 | 290 onboarding 基线 3506 路径 × 当前 323 workspace 实际字节 |

`restore/app-inputs.json`、`restore/loan-relocated-manifest.json` 保持 `b4ea82a9…` / `a7809822…`；在 predecessor workspace 上 `stage-overlays.py restore` 实测 `exit 0`。

## 3. 五个目标门结果

### 3.1 `general_procurement` — 绿（本地两 lane 全跑）

- 输入阶段：`stage-procurement295.py general16/project11 … --current-320`，两 lane 均 `exit 0`（`candidateDriftPaths 110`）。
- 业务阶段（mobile 镜像，`e3ac3374b`，`contract-finance` 512m/4g 容器）：
  - general16：`GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1_323_PASSED`（16 用例、2 浏览器项目、7 归档见证）
  - project11：`PROJECT_SCOPE_ORIGINAL_11_323_PASSED`（11 用例、projectScopeBrowser desktop+mobile 全 PASSED）
- 证据：`/tmp/jg-procurement-general16.S06lFUu9/receipt.json`、`/tmp/jg-procurement-project11.pDcmnc9s/receipt.json`

### 3.2 `contract_finance_acceptance` — 绿（本地四阶段全跑）

- bank：`BANK_323_ORIGINAL_FULL_12_PASSED`，preflight `BANK_323_DIAGNOSTIC_NO_DATABASE_PREFLIGHT_PASSED`
- restore：`BACKUP323_RESTORED_AND_VERIFIED`，preflight `BACKUP323_NO_DB_PREFLIGHT_PASSED`
- core：`CONTRACT_FINANCE_CORE_323_PASSED`（含 aggregate/company-transfer HTTP 与浏览器 desktop+mobile）
- payment：`CONTRACT_FINANCE_PAYMENT_323_PASSED`（`payment-execution-concurrency` 2/2）
- 证据：`/tmp/jg-contract-finance-bank.ngAA1rhm/{preflight,once}.json`、`/tmp/jg-contract-finance-restore.n20T5acC/{preflight,once}.json`、core/payment 容器回执

### 3.3 `clearing_reconciliation_pol275` — cold 绿 / collision 本地绿 / CI 侧环境性 EACCES

- CI 首红：collision lane（predecessor `a187dc73a`）`failure.stage=POL275_ORIGINAL_ROLE_COLLISION`、`code=EACCES`、无 SQLSTATE。`business=NOT_ENTERED` 是该 lane 通过时的正常结果（`a187dc73a` 绿跑同样为 `NOT_ENTERED`），不是失败原因。
- 本地：同一 predecessor 树、同一 `common/installer.cjs`（`59ecd7e0…`→`9c60b16c…`）、同一冻结证据（`aada0a6d…`）重跑 → `ORIGINAL_POL275_COLLISION_EXACT_295_PASSED`，`membershipGuardSqlstate=42501`，`pol275CollisionEvidence` 全真。
- 证据：`/tmp/jg-finance-pol275-collision.DJvZ8IR3/receipt.json`
- 结论：不是 pin 差异；CI 的 `EACCES` 在本地不能复现，属 CI 运行环境问题（需要 CI 侧重跑/环境诊断）。

### 3.4 `employee_onboarding` — 红（pin 已修，前移到结构性授权缺口）

- 首红 `ONBOARDING_295_SOURCE_INPUT_DELTA` 已修：staging `exit 0`，`lifecycle-rest` lane 通过（`ONBOARDING_ORIGINAL_NONBROWSER_LIFECYCLE_323_PASSED`，19 passed）。
- 下一层红：`downstream` lane `ONBOARDING_ORIGINAL_INDEPENDENT_27`，HTTP 500 × 16（`employee-onboarding-http-postgres.owned282.spec.ts` 8 例、`employee-role-consistency-http-postgres.owned282.spec.ts` 8 例），`failure.stage=ONBOARDING_ALIAS_REVOKE`、`code=ONBOARDING_CANVAS_ORIGINAL_JEST`；回执 `denied` 明确列出 `ContractLayoutPreviewJob` 表与 `jg_file_business_binding_columns_before_signed_settlement` 函数。
- 性质：**结构（sealed 夹具授权缺口）**。onboarding 用自身 sealed 材料里的 `contract-bank-runtime-fixture.cjs` 副本与 `collision_routines` 快照；`07500` 把 registry 函数改名为 `_before_signed_settlement`，该副本未授新别名/新表权限。修复需要重封 onboarding 的 `lanes.tar.gz` + `lanes.json` fixturePins + `pins.json` 资源摘要，属冻结材料整组重钉，不在本轮 pin 图内，未硬凑。
- 证据：`/tmp/jg-finance-onboarding.QWarUBbC/downstream/receipt.json`

### 3.5 `remaining_dynamic_postgresql16` — 红（行为，非 pin）

- 本地 `run-remaining-cleanup.sh` 精确复现 CI：`retainedOriginal.exact=false`、pg 16/21、model 10/10、`unexpected=false`；`failedOrMissing` 与 CI 完全一致（`contract-draft-retention-script` #10、`contract-lifecycle-route` #1、`contract-ended-application-purge` #1/#2/#4）。
- `original-jest-inventory.json` 摘要 `654ec22b…` 匹配、31 个登记用例全部执行（`unexpected:false`），说明不是清单/摘要 pin 失配，而是 5 个 pg 断言在 323 终态下未通过。
- 性质：**结构（业务/清理行为）**，需要按用例逐条定位；本轮不动产品代码/迁移，未硬凑。
- 证据：`/tmp/jg-finance-cleanup.X2nyeuHY/receipt.json`

### 3.6 本地实跑方法与限制

- 镜像按 CI 同源命令构建：`prepare.sh --current-320` + `build.sh e3ac3374b… <profile>`；镜像标签 `source-sha=e3ac3374b…`、`context-sha=0db401e5…`（browser/mobile 同 context）。predecessor lane 用 `prepare.sh a187dc73a` + `build.sh a187dc73a api|restore`。
- 本会话的 DSH 文件沙箱不允许写 `~/.docker/buildx/activity`；构建时使用 `DOCKER_CONFIG=/tmp/dsh-docker-config`（仅承载 buildx 状态，镜像内容与 CI 相同），未改任何 gate 脚本。
- 未绕过任何 gate 断言。共享 Docker 上其它 line 的临时容器曾使 `[[ -z $(docker ps -q) ]]` 守卫让 core lane 一次 `exit 65`；按原命令重试后通过，未删改守卫。
- Quality gates 的本地初跑因工作树缺少 Prisma client 假红（`Cannot find module '.prisma/client/default'`）；执行 `prisma generate`（`node_modules` 级，未进仓库）后 2378 项全绿。

## 4. 回归门（`e3ac3374b` 基线；合并后复验见第 9 节）

| 门 | 结果 | 说明 |
| --- | --- | --- |
| `Quality gates`（`test:ci-orchestration`） | **绿** | `# tests 2378` / `pass 2377` / `fail 0` / `skipped 1`（`/tmp/quality2.log`）。首次本地跑因工作树 `@prisma/client` 未生成导致 `POL-275 CI prefetch` 假红；执行 `prisma generate`（仅本地 `node_modules`，不产生仓库改动）后全绿。 |
| `check:migration-baseline` | **clean** | 323 / `20261119007500…` / `98e016b2…`，`drift:[]` |
| `task398_shared_standard` | **绿** | `TASK398_STANDARD_EXACT_323_PASSED` |
| `task398_browser` | **绿** | `TASK398_BROWSER_PARTIAL_EXACT_323_PASSED`（receipts verified） |
| `task398_browser_completion` | **绿** | `TASK398_BROWSER_COMPLETION_EXACT_323_PASSED`（receipts verified） |
| `task409_principal_return` | **绿** | `TASK398_CASH_PRINCIPAL_EXACT_323_PASSED` |
| `pol115_workbench` | **绿** | `POL115_WORKBENCH_ORIGINAL_323_PASSED` |
| `project_expense_receipt` | **绿** | `ORIGINAL_EXPENSE_323_RETAINED_VALID_PASSED` + `ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_PASSED` |

## 5. 回归门实跑记录

由 `/tmp/run-regressions.sh` 顺序执行，脚本与 CI 同源，全部 `rc=0`；完整 stdout：

| gate | rc | 回执状态 | 日志 |
| --- | --- | --- | --- |
| task398_shared_standard | 0 | `TASK398_STANDARD_EXACT_323_PASSED` | `/tmp/reg-task398_shared_standard.log` |
| task398_browser | 0 | `TASK398_BROWSER_PARTIAL_EXACT_323_PASSED` + `…_323_RECEIPTS_VERIFIED` | `/tmp/reg-task398_browser.log` |
| task398_browser_completion | 0 | `TASK398_BROWSER_COMPLETION_EXACT_323_PASSED` + `…_323_RECEIPTS_VERIFIED` | `/tmp/reg-task398_browser_completion.log` |
| task409_principal_return | 0 | `TASK398_CASH_PRINCIPAL_EXACT_323_PASSED` | `/tmp/reg-task409_principal_return.log` |
| pol115_workbench | 0 | `POL115_WORKBENCH_ORIGINAL_323_PASSED` | `/tmp/reg-pol115_workbench.log` |
| project_expense_receipt | 0 | `ORIGINAL_EXPENSE_323_RETAINED_VALID_PASSED`、`ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_PASSED` | `/tmp/reg-project_expense_receipt.log` |

镜像与目标门同源：`browser` / `mobile` 均由 `prepare.sh --current-320` + `build.sh e3ac3374b…` 生成（`source-sha=e3ac3374b…`，`context-sha=0db401e5…`），未使用其它工作树的镜像。

## 6. 仍红项与性质

| 门 | 仍红原因 | 性质 | 是否需再一轮 |
| --- | --- | --- | --- |
| `employee_onboarding` | sealed 夹具缺 `07500` 新别名/新表授权 | 结构（冻结材料整组重钉） | 是（另开线） |
| `remaining_dynamic_postgresql16` | 5 个保留原用例 pg 断言失败 | 结构（业务/清理行为） | 是（另开线） |
| `clearing_reconciliation_pol275` | CI `EACCES`；本地同路径绿 | CI 环境 | 建议 CI 重跑 |

## 7. 容器清理实测

- 本轮所有 gate 容器均为 `--rm`，收尾 `docker ps` 见第 8 节实测。
- 注意：共享 Docker 守护进程上有其它 line 的临时容器（如 `jiangkong-line-a-real-db-*`、`jiangkong-issue420-line-r-*`）短暂出现；它们不属于本轮，未做任何清理。

## 8. `docker ps -q` 实测

最终提交前实测：`docker ps -q | wc -l` = **0**（无容器，含本轮与其它 line）。

## 9. 基线前移：合入 `adopt-395-396-415`（`2ef132450`）后的重基线

按集成负责人要求，`line-q-pin-convergence` 已 `git merge --no-ff adopt-395-396-415`（本线 merge commit `2bc1f23f4`）。line-s 的 #396 残余提交修改了未发布迁移 `20261119007000_signed_settlement_payment_basis`（补 `PaymentRequest` 来源约束），迁移计数仍 323、终点仍 `07500`，但 **323 账本摘要变化**：

- `0139b46a66b97c33adf15ca3ae6897b24410c5dbe726b2ce884e73fc910b1c20` → `5623f6ae565471f54b3d1dfd965c4beafc560b8f2bfb97765c4a8699ee9f99ec`
- 仅 `20261119007000` 的 sha 从 `275568e5…` 变为 `1bcb776a…`；292/294/295 前缀与 `07500` 摘要未变。

### 9.1 失效 pin 与重算

| 产物 | 旧值 → 新值 | 派生 |
| --- | --- | --- |
| `check-ledger.cjs` | `0139b46a…` → `5623f6ae…` | 迁移源码实际字节 |
| `run-bank-restore.sh` 容器校验 | 同上 | 同上 |
| `bank/named-bank-ci.cjs` `candidateDigest320` | 同上 | 同上 |
| `restore/forward-320-inventory.json` `ledgerSha256` | 同上 | 同上 |
| `contract-finance-owned.test-support.ts`（plan 副本） | 同上 | 同上 |
| `task398-standard-320.patch` | 同上 | 同上（标准门补丁） |
| bank `contract-finance-owned.test-support.ts` 材料 | `b3b4760c…gz` → `9fdb54d7…gz` | 覆盖物内含账本常量；材料名=解压后 sha |
| `bank/execution-files.json` | `47a13512…` → `227ef26a…` | 1833 条输入在合并树重算 |
| `candidate-delta320.json` | 110 条 → 130 条 | 合并树新增变更；两 lane 期望不同且各有 overlay 的 `project-business-scope-http-postgres.spec.ts` 保留 overlay、不入 delta |
| `onboarding-323-source-drift.json` | 112 条 → 129 条 | 合并树实际字节 |
| predecessor/restore 后像 | `b4ea82a9…` / `a7809822…` 不变 | predecessor（a187dc）树固定，staging `exit 0` |

### 9.2 新基线复验结果

（见下节；只列在 `2bc1f23f4` 树上重跑过的门。）

### 9.3 在 `2bc1f23f4`（含 `2ef132450`）树上的复验

镜像：`prepare.sh --current-320` + `build.sh 2bc1f23f4 browser|mobile`（`source-sha=2bc1f23f4…`，`context-sha=6fee0a13…`）；predecessor/restore 仍用 `a187dc73a` 树镜像（未变）。

| 门/检查 | 结果 | 证据 |
| --- | --- | --- |
| `contract_finance` bank | 绿 `BANK_323_ORIGINAL_FULL_12_PASSED` | `/tmp/jg-contract-finance-bank.kHnpLmsx` |
| `contract_finance` restore | 绿 `BACKUP323_RESTORED_AND_VERIFIED`（ledger `5623f6ae`） | `/tmp/jg-contract-finance-restore.9LTXsKsk` |
| `contract_finance` core | 绿 `CONTRACT_FINANCE_CORE_323_PASSED` | `/tmp/m-cf-core.log` |
| `contract_finance` payment | 绿 `CONTRACT_FINANCE_PAYMENT_323_PASSED` | `/tmp/m-cf-payment.log` |
| `general_procurement` general16 | 绿 `GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1_323_PASSED`（`forward320.ledgerSha256=5623f6ae`） | `/tmp/jg-procurement-general16.PQPICp5u` |
| `general_procurement` project11 | 绿 `PROJECT_SCOPE_ORIGINAL_11_323_PASSED`（同上） | `/tmp/jg-procurement-project11.0Vg6d7ra` |
| `task398_shared_standard` | 绿 `TASK398_STANDARD_EXACT_323_PASSED`（补丁内摘要已前移） | `/tmp/m-m_standard.log` |
| `task398_browser` | 绿 `TASK398_BROWSER_PARTIAL_EXACT_323_PASSED` | `/tmp/m-m_browser.log` |
| `task398_browser_completion` | 绿 `TASK398_BROWSER_COMPLETION_EXACT_323_PASSED` | `/tmp/m-m_browser_completion.log` |
| `task409_principal_return` | 绿 `TASK398_CASH_PRINCIPAL_EXACT_323_PASSED` | `/tmp/m-m_409.log` |
| `pol115_workbench` | 绿 `POL115_WORKBENCH_ORIGINAL_323_PASSED` | `/tmp/m-m_pol115.log` |
| `project_expense_receipt` | 绿 `ORIGINAL_EXPENSE_323_RETAINED_VALID_PASSED` + `ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_PASSED` | `/tmp/m-m_expense.log` |
| `clearing_reconciliation_pol275` | 沿用本地 collision 绿（predecessor/295 摘要未变，镜像与脚本未变） | 3.3 节 |
| `employee_onboarding` | staging 在合并树 `exit 0`（129 条 drift）；downstream 结构缺口未变，未重跑 | 3.4 节 |
| `remaining_dynamic_postgresql16` cleanup | 仍红：pg 16/21、model 10/10，同一 5 例 | `/tmp/m-m_remaining.log` |
| `check:migration-baseline` | clean（323 / `07500` / `98e016b2…`） | 最终测量 |
| `Quality gates` | **红 17 项**：全部为 `RUN_* gated PG spec 未登记：services/api/src/database/issue420-approval-center.http.pg.spec.ts`（另有 fund-execution 组合消息）。该 spec 在 `2ef132450` 已存在，而 `database-dynamic-gate-manifest.json` 无任何登记（`git show` 实测 0 命中）→ 合入分支既有缺口，不是本线 pin 改动；需由 #420/#396 集成方登记到动态门清单，本线不改产品/门清单硬凑。 | `/tmp/quality-merged.log` |

### 9.4 结论

- 账本摘要前移后，`0139b46a…` 派生的 7 处常量、1 份材料、bank 后像、procurement delta、onboarding drift 全部按 `2bc1f23f4` 实际字节重算；`contract_finance` 四段与 `general_procurement` 两 lane 已在新摘要上复验通过。
- 292/294/295 前缀与 `07500` 摘要未动。
- 仍红：`employee_onboarding`（sealed 夹具授权，结构）、`remaining`（5 个 pg 断言，行为）、`Quality gates`（issue420 未登记，集成缺口）；`clearing` 仍需 CI 侧重跑确认 EACCES 是否环境性。
