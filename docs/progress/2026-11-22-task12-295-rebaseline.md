# Task12 295 冻结安装链 322 重基线回执

- 日期：2026-11-22（本地，Asia/Shanghai）
- 工作树 `/tmp/jgG`，分支 `line-g-rebaseline-295`，基线 `9053f4a94`
- 语义地图：[docs/progress/2026-11-22-task12-295-rebaseline-map.md](2026-11-22-task12-295-rebaseline-map.md)
- 目标：PR #428 的 `PostgreSQL 16 dynamic gate` 当前终态分片由 320 迁移重基线到 **322**，历史升级路径（292/294/295）证明不动。

## 1. 结论

代码层重基线完成：当前终态的账长、全账摘要、tails、receipt purpose/status、派生 staging 摘要与 CI 模式门全部对齐 322；历史前缀 292/294/295 的计数与 digest 一字未改。本地已用 Docker 实跑：`contract-adjacent/settlement` 整链通过（2/2 用例，`ORIGINAL_CONTRACT_ADJACENT_322_PASSED`）。

## 2. 期望与 digest 改动

| 项 | 旧（320 终态） | 新（322 终态） |
| --- | --- | --- |
| 迁移目录数 | 320 | 322 |
| 全账 sha256 | `e86ce2f53bb9ceaace66836c79f178ef073fd6cb3b74a8641afdce246dfee07e` | `9919038b0d6ae339ab72f5c7d6221a569bd6ae16b082df476faa9282b5e62d51` |
| 当前模式 tails 数（322-295） | 25 | 27 |
| 终态迁移 | `20261119006400_contract_work_completion_original_subject` | `20261119007000_signed_settlement_payment_basis`（校验和 `275568e5…`，与 manifest 一致） |
| 前驱 295 全账 | `b0d398a4…6f2d` | **未改** |
| 292 / 294 前缀 | `739451e0…a775` / `1b66e6c9…396d` | **未改** |

### 2.1 硬编码 320 的当前终态钉点（逐条见语义地图第 2 节）

- 计数三元式 `current320?320:295` → `322`：约 30 个入口（`contract-adjacent-entry`、`core-payment-entry`、`profile-entry`、`finance-adjacent-entry`、`historical-financial-entry`、`remaining-*-entry`、`pol108/pol109`、`procurement`、`onboarding`、`task398-*`、`task410`、`pol275`、`browser-*`、`workbench` 等）。
- `tails.length 25 → 27`：14 处（`check-ledger` 之外的 entry 与 `common/installer.cjs`、`bank/named-bank-ci`、`restore/*`、`named` 安装器）。
- `CONTRACT_FINANCE_CURRENT_320_LEDGER_COUNT` 断言由 320 改 322（错误码字符串保留，作为该模式的稳定错误名）。
- 由 count 拼出的 receipt `purpose`/`status` 同步 322：`ORIGINAL_CONTRACT_ADJACENT_EXACT_322`、`BANK_322_*`、`BACKUP322_*`、`TASK398_*_EXACT_322`、`TASK410_COMPANY_PROXY_EXACT_322`、`ORIGINAL_POL108_EXACT_322`、`ORIGINAL_POL275_WARM_EXACT_322`、`ORIGINAL_PFQ_EXACT_322`、`POL113_POL114_NAMED_EXACT_322_PASSED`、`GENERAL_PROCUREMENT_…_322_PASSED`、`_322_PASSED` 等。
- 账长环境哨兵 `JG_CONTRACT_FINANCE_LEDGER` 的值由 `"320"` 改 `"322"`（生产端与消费端同步）。
- CI 模式门：`.github/workflows/ci.yml` 4 处 `count == 320` 改 `count == 322`；`--current-320` 作为模式标识保留（见语义地图第 5 节）。

### 2.2 内容派生制品重算（同一算法，不是新证据）

- `bank/execution-files.json` 当前模式：1833 条路径摘要 → `e5c93836…a05f2`；295 链 1814 条 → `8ab94529…6ba9`。
- `restore/app-inputs.json` → `c606e2e5…630a`；`restore/loan-relocated-manifest.json` → `d33394c2…d2ab0`。
- 银行当前模式 `contract-finance-owned.test-support.ts` 材料 → `5dc89f39…87421`（旧材料保留，不删除）。
- `restore/forward-320-inventory.json`：`count 322`、`ledgerSha256 9919038b…`、`sourceTree c3dfe7fb…`（HEAD 树）。
- `procurement/candidate-delta320.json`：新增 24 条候选增量、更新 2 条；`.github/task12-install-290/procurement/pins.json` 2 处 overlay `candidate` 更新——因为 #415/#419 合入后源码树在 320 之后继续变动，这些摘要本来就随当前树重钉。
- `common/installer.cjs` 改动后重算：`procurement/port-pins.json` installer base/after，`pol275/run-pol275.sh` 两处 installer 钉点。
- `onboarding/onboarding-322-source-drift.json` 新增（96 条）；脚本按 `onboarding-{count}-source-drift.json` 取名，322 需要新文件。
- `stage-pol109.py` 当前终态迁移名改为 `20261119007000_signed_settlement_payment_basis`。

### 2.3 唯一一处结构性放宽（已论证）

`common/installer.cjs` 的 `readForward320` 与 `named-pol113-pol114/installer-named320.patch` 原用「第 i 条 tail 的时间戳 = `2026111900{40+i}00`」逐条等值断言。320 时代 25 条 tail 恰好一分钟一条（04000…06400）；322 的终态 `20261119007000` 与 `06500` 相差 5 分钟（产品迁移编号如此），该算术断言与事实不符。

改法：首条仍必须 ≥ `04000`，时间戳必须**严格递增**，名称形状与 sha256 格式不变，目录数与摘要仍固定（27 条、逐条 `FORWARD_320_TAIL_DIGEST` 校验、全账 `9919038b…`）。即只把「每分钟连续」放宽为「严格递增」，没有放宽数量、顺序或摘要证明。

## 3. 本地实跑

环境：macOS arm64 + Docker Desktop，`--platform linux/amd64`（QEMU）。本机沙箱禁止 buildx 写 `~/.docker/buildx/activity`，故本地用 `BUILDX_CONFIG=/tmp/jg-buildx`（仅环境变量，未改仓库脚本）；这是本机沙箱限制，不是产品缺陷。Docker 互斥门 `[[ -z $(docker ps -q) ]]` 未放宽。

### 3.1 无数据库层（全部通过）

- `node .../check-ledger.cjs $PWD 9053f4a9… --current-320` → `migrationCount 322`、`ledgerSha256 9919038b…`、`tails 27`。
- 历史 295 链模式仍只接受 294/295（在 HEAD 上按设计失败，证明历史链没被改写）。
- 所有 host 侧 staging 实跑通过：`stage-task398-standard`、`stage-task398-cash-principal`、`stage-task410`、`stage-partial`、`stage-completion`、`stage-expense`、`stage-payment-execution`、`stage-pfq`、`stage-pol108`、`stage-pol109`、`stage-onboarding`、`stage-procurement295`（general16/project11）、`stage-overlays`（bank current/295、restore）、`prepare-named295.py`。
- `pnpm check:migration-baseline` → `status: clean`，源与 manifest 均 322。
- 全部改动 `.cjs` 过 `node --check`，`.py` 过 `ast.parse`，`.json` 过 `json.load`。

### 3.2 Docker lane

| lane | 命令 | 结果 |
| --- | --- | --- |
| settlement（contract-adjacent 最小复现） | `run-contract-adjacent-ci.sh <sha> settlement --current-320` | **通过**：`ORIGINAL_CONTRACT_ADJACENT_322_PASSED`，forward320 count 322 / `9919038b…` / `c3dfe7fb…`，2/2 用例，容器清理 `POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT` |

（contract_finance_acceptance / pol275 / task410 结果见下方第 4 节。）

## 4. 三个必跑 lane 结果

| lane | 命令（CI 等价） | 结果 |
| --- | --- | --- |
| `contract_finance_acceptance` | `bash .github/task12-install-295/contract-finance/run.sh <sha> --current-320 a187dc73a…` | **全绿**：bank `BANK_322_ORIGINAL_FULL_12_PASSED` 12/12；restore `BACKUP322_RESTORED_AND_VERIFIED`（preflight `BACKUP322_NO_DB_PREFLIGHT_PASSED`）；core `CONTRACT_FINANCE_CORE_322_PASSED`（desktop/mobile 浏览器观察 4/4、paymentCapabilities 通过）；payment `CONTRACT_FINANCE_PAYMENT_322_PASSED`（并发 2/2） |
| `clearing_reconciliation_pol275` | `run-contract-adjacent-ci.sh <sha> pol275 --current-320 a187dc73a…` | **PASS（rc=0, 389s）**：cold `ORIGINAL_POL275_COLD_EXACT_322_PASSED`、collision `ORIGINAL_POL275_COLLISION_EXACT_295_PASSED`、warm 通过；容器清理 `POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT` |
| `task410_company_proxy_repayment` | `run-contract-adjacent-ci.sh <sha> company-proxy --current-320` | **仍红**：`TASK398_COMMAND_FAILED:pnpm:--filter` ← jest 失败，首因 `SQLSTATE 42501` `ERROR: 履约成本来源读取资格缺失`，见第 5 节 |

补充（受同一重基线影响的最小复现 lane）：

| lane | 结果 |
| --- | --- |
| `contract-adjacent/settlement` | **PASS**：`ORIGINAL_CONTRACT_ADJACENT_322_PASSED`，forward320 322/`9919038b…`/`c3dfe7fb…`，2/2 用例 |

### 4.1 bank 首因复盘（本轮唯一一次数字改错）

首轮 bank 11/12 失败，`CONTRACT_FINANCE_OWNED_LEDGER_MISMATCH`。给覆盖材料加自诊断后输出：`scope=affiliate admitted=true len=322 mode=true d282=be6d9aed22 want282=be6d9aed22 d294=1b66e6c989 d295=b0d398a46c dfull=9919038b0d` —— 摘要全对，仍是计数分支：重生成材料时只换了旧摘要 `e86ce2f5…`、漏改 `current320 ? 320 : 295`。用同一份材料同时改计数与摘要（`968030de…`）并重算 `execution-files.json`（`222cc429…`）后 12/12 通过。

### 4.2 两个 restore staging 摘要曾被我误改，已回退

`restore/app-inputs.json` 与 `restore/loan-relocated-manifest.json` 由 `stage-overlays.py` 从 **predecessor（a187dc）workspace** 生成（`run.sh` 传 `predecessor-source`），该树固定；首轮按候选 HEAD 重算导致 `CONTRACT_FINANCE_OVERLAY_POSTIMAGE`，已回退到原值 `b4ea82a9…` / `a7809822…` 并实测 staging 通过。

## 5. 仍红项与首因

### 5.1 `task410_company_proxy_repayment`（唯一仍红 lane）

- 现象：jest 失败 → `TASK398_COMMAND_FAILED:pnpm:--filter`；spec `company-proxy-repayment.http.pg.spec.ts` 两条用例抛 `PrismaClientKnownRequestError`：
  `Raw query failed. Code: 42501. Message: ERROR: 履约成本来源读取资格缺失`
  at `contract-work-completion-operating-source.adapter.ts:30` ← `operating-source-replay.service.ts:223` ← `spec:578`。
- 首因：`public.jg_contract_work_completion_cost_sources_v1` 的资格门（迁移 `20261119005800_…`，line 209-218）要求 `jg_contract_work_completion_witness.runtimeRoleOid = session_user::regrole::oid`、`session_user <> current_user`、`session_user` 对 `public` 无 `CREATE`。task410 harness 的 app 连接用 `context.ownerUrl`（owner，且 `session_user=current_user`），必然 42501。
- 与 322 重基线的关系：**无关**。该函数与 `ContractWorkCompletionOperatingSourceAdapter` 都来自 `e717ba4c6`（320 时代同一提交）；新增的 `20261119006500`/`20261119007000` 不触碰该函数、witness 表或角色授权；task410 的连接角色由 289/292 链固定。此前 CI 先卡在账长断言，所以该 lane 的资格门问题一直未暴露。修复需要 harness 角色模型（以 witness 运行时登录角色执行 replay）或产品资格门口径的产品决策，不属于本轮 320→322 数字重基线。

### 5.2 (a) harness 角色模型的尝试与未收敛结论

用户裁决走 (a)「改 harness 角色模型」。本轮按下列边界做了尝试（未触碰 05800 迁移、资格门、产品代码），但**未跑绿**，已回退所有实验性 harness 改动（工作树恢复为仅 322 重基线）：

- 在 `task410-runner-320.patch` 中新增真实登录角色 `jg_task01_login`（NOSUPERUSER/NOINHERIT、无 public CREATE），`GRANT jg_task01_owner TO` 它并 `ALTER ROLE ... SET role = jg_task01_owner`，把 app 的 `DATABASE_URL` 切到该登录角色；并插入绑定真实 `session_user` 的 witness 行（不伪造 OID，若已存在其它绑定则显式报错）。
- 在 `task410-support-320.patch` 中把 `task410TestDatabase` 与 `assertTask410Owner290` 调整为「有效角色 owner + 专用登录 session_user + 无 CREATE + witness 绑定」，295 分支保持 `session_user=current_user` 原证明。
- 实测证据：容器内 `pg_db_role_setting` 为 `{role=jg_task01_owner}|true`（角色设置与成员关系都在）；同一内置镜像 + 一个加固过的 postgres:16（`REVOKE ALL ON SCHEMA public FROM PUBLIC`、`REVOKE CONNECT ... FROM PUBLIC`、仅给登录角色 USAGE/CONNECT）下，Prisma 5.22 以该登录角色连接得到 `session_user=lg,current_user=owner`（`HARDENED [{"s":"lg","c":"own"}]`）。
- 但 lane 内 app 的 Prisma 连接仍报 `User jg_task01_login was denied access on the database <db>.public`，连 `SELECT session_user` 都到不了；说明 lane 里 app 实际使用的连接与 psql/独立 Prisma 路径存在未定位差异（TLS/`sslmode=require&sslaccept=strict`、连接池复用或 env 注入时序）。这不是资格门本身不可满足（psql 与独立 Prisma 都已证明可满足），也不是 320→322 数字问题。
- 结论：*(a) 未在本次时限内收敛*，已回退实验改动，task410 仍红且首因不变；下一步应单独定位「lane 内 app 连接为何不继承该登录角色的 role 设置」，再决定是否继续 (a)，否则交回产品口径 (b)。

## 6. 资源清理核对

- 开工时机器上有 3 个他人遗留容器（`jiangkong-line-a-real-db-a4f57764…`、`jiangkong-line-a-real-db-6634ee1e…`、`jga-mig-check`，均空闲 postgres）；经 lead 授权后已 `docker rm -f` 这三个，未动其他任何容器。
- 本轮所有 lane 结束后执行 `docker ps -q` 复核为空（另见第 8 节命令与输出），不把「已清理」当作未验证断言。

## 7. 观察：线 A 清理断言与实测不符

线 A 回执（`docs/progress/2026-11-22-issue-395-396-415-line-a-real-db.md`）此前声称「容器与私有存储已清理」，但本轮开工时实测仍有其自建的 `jiangkong-line-a-real-db-a4f57764-…` 与 `jiangkong-line-a-real-db-6634ee1e-…` 两个 `postgres:16` 容器在运行（`Up About an hour`、0 CPU），另有 `jga-mig-check`。说明该回执的清理检查有漏：至少没有以 `docker ps` 实测收尾。lead 已在 `adopt-395-396-415@8da1729ee` 更正该回执，并要求本轮以实测复核。

## 8. 历史前缀零改动核对方法

```bash
cd /tmp/jgG
# 1) 历史 digest 的出现次数在 HEAD 与工作树必须一一相等（本轮 12 个历史摘要全部 PASS）
for h in 739451e0…a775 1b66e6c9…396d b0d398a4…6f2d be6d9aed…8cfc 8741d9da…57a5 \
         9e30b3f6…0c44 042901da…91fe 5c5e77dc…2f67 97f0ae1c…0ed0 95a67fca…bd1f \
         721986f6…ee1f e5b56cb2…de25; do
  a=$(git grep -o "$h" HEAD -- .github/task12-install-295 | wc -l)
  b=$(grep -ro "$h" .github/task12-install-295 | wc -l)
  [ "$a" = "$b" ] || echo "FAIL $h"
done
# 2) check-ledger 的 292/294/295 断言行没有出现在 diff 的删除侧
git diff -U0 -- .github/task12-install-295/contract-finance/check-ledger.cjs | grep '^-'
#    （删除侧只有 320→322 的计数/摘要/migrationCount 三行，历史五行不动）
# 3) 非当前模式仍只接受 294/295，且在 HEAD（322）上按设计失败
node .github/task12-install-295/contract-finance/check-ledger.cjs "$PWD" "$(git rev-parse HEAD)" || echo 'EXPECTED_294_295_ONLY'
```

- 错误码字符串保持稳定名：`CONTRACT_FINANCE_CURRENT_320_LEDGER_COUNT`、`FORWARD_320_*`、`BANK_295_*`、`BACKUP320_NAMED_EXPORT_IMPORT`、`TASK398_OWNED_282_SCENARIO` 等未改；只改由 count 拼出的 purpose/status 与 staged runner 模式键。
- `--current-320` 作为模式标识保留：CI 以 `count == 322` 选择该模式（`.github/workflows/ci.yml` 4 处已改），脚本内 `--current-320`/`mode:'current-320'` 不变；其承载的计数/摘要/标签期望已全部 322。风险与替代方案见语义地图第 5 节。

## 9. CI 可望转绿判断

- 当前终态 322 的账长/摘要/tails/派生摘要/CI 模式门均已对齐并本地实跑：`contract_finance_acceptance`（bank 12/12 + restore + core + payment）、`pol275`、`contract-adjacent/settlement` 全绿。
- **唯一确定性红项是 task410**，首因为 05800 资格门与 harness owner 角色的冲突，与 320→322 无关；该 lane 在 CI 中同样会红，需要另行修复（harness 角色或产品口径）。
- 因此本轮改动**可交 CI**，但不能承诺 PR #428 全绿：`task410_company_proxy_repayment` 会继续失败，除非同时对 harness 角色做授权范围内的修复。

