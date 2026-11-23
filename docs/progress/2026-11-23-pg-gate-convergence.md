# PostgreSQL 动态门收敛回执（PR #428 / `line-l-pg-gates`）

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgL`，分支 `line-l-pg-gates`
- 基线：`5d07c92c0`（迁移 323，终态 `20261119007500`，校验和 `98e016b2…`）
- 本轮提交：`fbb6a76de`（pol115 输入重钉 + 采购 manifest 增量）、`b9f0a0e8d`（pol113/114 named purpose 与版本锚点统一）；本回执随后单独提交。
- 未 push；未改 `07500`、未改资格门、未放宽守卫、未动 `database-dynamic-gate-manifest.json`；未触碰 `/tmp/jgK`、`/tmp/jg382-adopt`、主仓库。
- 本地闸门镜像按 CI 同源构建：`prepare.sh … --current-320` + `build.sh <sha> browser|mobile`，镜像标签 `source-sha=5d07c92c0…`、`context-sha=8f3aa158…`。

## 1. 逐门首因与判定

| 门 | 首因（实测） | 分类 | 本轮处理 | 本地结果 |
| --- | --- | --- | --- | --- |
| `pol115_workbench` | `browser-preflight.cjs` 的 `verifyInputs()` 断言：挂载的 `settlement-template-workbench.owned290.http.pg.spec.ts` 实际 `223cf564…`≠pin `308a0b67…`；修后下一条 `task12-pol115-workbench-ci.cjs` 实际 `c29463df…`≠pin `99765a27…`。两者在 `7587165fa`/`7612a5ab1` 已按 323 字节更新，输入 pin 未同步，preflight 输出被重定向故 CI 只看到静默 `exit 1`。 | pin 过期（可更新） | 按实际挂载字节重钉 `workbench/workbench-inputs.cjs` 两处 | **绿**：`POL115_WORKBENCH_ORIGINAL_323_PASSED`，9 用例、desktop+mobile，2m53s |
| `pol113_pol114` | 本地复现（`ci.sh pol113 --current-320`，`exit 1`，镜像导出后 0.2s）：隐藏 receipt 为 `NAMED_POL113_POL114_EXACT_320` + `failure.code=POL113_POL114_NAMED_292_PURPOSE`。根因是 purpose 后缀与 wrapper 版本不一致：`prepare-named295.py` 把 receipt purpose 改成 `…_EXACT_320`，而 `installer-named320.patch` 的 `withNamedPol113Pol114320` 传 `version=323`，且 installer 用 `purpose===…_EXACT_320` 判定 named320。 | pin/锚点过期（可更新） | 统一到 323（purpose、installer 判定、stage 名），见提交 `b9f0a0e8d` | **仍红（前移一层）**：purpose 已修，本地进入原套件后 30 例 29 过、1 例失败（`SIGTERM`/`P0001`，spec 行 323）；x64 上需重跑确认是否超时 |
| `task398_shared_standard` | 首个业务失败 `POST /me/signature/canvas` → 500，PG 日志 `ERROR: permission denied for function jg_file_business_binding_columns_before_signed_settlement`。07500 把 registry 改名为 `_before_signed_settlement` 并由新 current 以 SECURITY INVOKER 委托；迁移后创建的受限夹具角色只被授予旧别名集合（`local-staged-migration-qualification.json` 的 `collision_routines` 止于 `_before_company_transfer`）。补 EXECUTE 后进入 owned-280 角色检查：`business` 子项为 false —— `task398-owned-280-business-read-baseline.json`（324 表）未含 `ContractSignedChange` / `SignedContractSettlementAttachment`，而 07500 把两表登记为独占绑定列，中心守卫会逐表 `SELECT`。 | 夹具授权/冻结材料缺口（不是 07500 内容缺陷） | 见第 2 节：需对 295 冻结材料做协调重钉；本轮未提交半套 pin | **仍红**：已在本地复现并定位到上述两步 |
| `task398_browser`、`task398_browser_completion` | 同一 `EXACT_295_MULTI_WITNESS_CONSUMER` 阶段、同一 07500 别名/两新表授权链（browser 夹具同一 `contract-bank-runtime-fixture.cjs` 补丁） | 同上 | 同上 | 仍红（同因，未单独复跑） |
| `task409_principal_return`、`task410_company_proxy_repayment`、`project_expense_receipt` | 均走 `.github/task12-install-290/standard/fixtures` 同一夹具补丁与 owned-280 读基线，失败点同为 `EXACT_295_MULTI_WITNESS_CONSUMER`（expense-receipt 为 `ERR_ASSERTION`，409/410 为通用 `BEHAVIOR_FAILED`） | 同上 | 同上 | 仍红（同因，未单独复跑） |
| `general_procurement` | 输入阶段 `PROCUREMENT_295_INPUTS`：`migration baseline drift: expectedDirectoryCount manifest=272 vs source=323`。323 的 `database-dynamic-gate-manifest.json` 不在 `candidate-delta320.json`，输入阶段回落到 272 旧 overlay。补增量后输入阶段通过；业务阶段新首因：`PROCUREMENT_ARCHIVE_JEST`，`pgPermission: jg_company_transfer_loan_repayment_scope_v1` —— 323 尾部迁移 `20261119000600` 建的 owner-only 限制表，采购运行时角色无 `SELECT`。 | 先 pin/材料过期（已修）→ 后为夹具授权缺口 | 提交 manifest 增量；限制表授权未动（涉及该 lane 角色策略，需决定） | **仍红**：输入阶段绿；业务阶段 500/42501 |
| `employee_onboarding` | `ONBOARDING_ALIAS_REVOKE` 阶段前的 `ONBOARDING_CANVAS_ORIGINAL_JEST`（下游 canvas Jest 失败）。onboarding 使用自身 sealed 材料里的 `contract-bank-runtime-fixture.cjs` 副本（`f8a52c…`）与自身 `collision_routines` 快照，同样不含 07500 新别名/新表授权。 | 冻结材料缺口（推断，未本地复跑） | 未改（sealed tar + pins 需协调重钉） | 仍红 |
| `clearing_reconciliation_pol275` | 前置 `ORIGINAL_POL275_COLLISION_EXACT_295` 在 `POL275_ORIGINAL_ROLE_COLLISION` 抛 `EACCES`（前置树 `a187dc73` 上 165→166 碰撞观察）。属文件系统权限错误而非 SQLSTATE，需单独定位（`pol275-original-evidence.cjs` 运行期写/读临时目录）。 | 待定（非 42501 类） | 未改 | 仍红 |
| `remaining_dynamic_postgresql16` | `REMAINING_RETAINED_ORIGINAL_JEST` 退出 1：21 个 pg 用例通过 16、model 10/10，失败/缺失 5 例——`contract-draft-retention-script.spec.ts` #10、`contract-lifecycle-route.spec.ts` #1、`contract-ended-application-purge.spec.ts` #1/#2/#4。 | 待定（业务/清理行为，需逐例看断言） | 未改 | 仍红 |

## 2. 已定位但未提交的修复（需协调重钉，避免半套 pin 反而变红）

对 `task398/409/410/expense-receipt` 与 onboarding/procurement 这一类，最小修复是“夹具授权 + owned-280 读基线”两处，且必须整组重钉：

1. `contract-bank-runtime-fixture.cjs`（及其各 lane 的冻结补丁结果）在 owner-settlement 块后追加，仅当 07500 世代存在时执行：
   - `GRANT EXECUTE ON FUNCTION public.jg_file_business_binding_columns_before_signed_settlement() TO <fixture_role>`；
   - `GRANT SELECT ON TABLE public."ContractSignedChange","SignedContractSettlementAttachment" TO <fixture_role>`。
2. `task398-owned-280-business-read-baseline.json`（3 份副本：`task12-install-290/standard/fixtures`、`task12-install-290/browser-partial/fixtures`、`task12-install-289/procurement/fixtures`）把上述两表加入 `tables`，否则 owned-280 的 `businessReadCheckSql` 会判定“受限角色不该读”。

本地实测链（证据）：
- 未改夹具：`EXACT_295_MULTI_WITNESS_CONSUMER` → `/me/signature/canvas` 500；容器 `postgres.log`：`ERROR: permission denied for function jg_file_business_binding_columns_before_signed_settlement`。
- 仅给别名 EXECUTE + 两表 SELECT（临时挂载验证，未提交）：失败前移为 `TASK398_ROLE_CHECK`，探针输出 `{"technical":"t","signature":"t","approval":"t","spot":"t","business":"f","observer":"t","me":"t"}` → 与 `businessReadCheckSql(advanceExcludedReads,current280)` 的 baseline 缺口一致。
- 因此“只补别名”不够，必须同时重钉读基线；该重钉牵动 `fixed-overlay-pins.json`、`assembly-pins.json`、`plan.sha256`、`staging-manifest.json`、`common/checkout.cjs` 的 `f8a52c20…`/`d9406ad3…`、procurement/onboarding 各自的 checkout 与 drift 文件。属于与 295→323 重基线同级的冻结材料重钉，建议单开一条线执行并整组复跑。

## 3. `pol113_pol114` 复跑与修复

- 命令：`CI_SOURCE_SHA=fbb6a76de bash .github/task12-install-295/named-pol113-pol114/ci.sh pol113 --current-320`，9m10s，`exit 1`。
- 证据：`/tmp/jg-named-poly-295.KxKuc49l/evidence/receipt.json` →
  `{"purpose":"NAMED_POL113_POL114_EXACT_320",...,"failure":{"stage":"INPUTS","code":"POL113_POL114_NAMED_292_PURPOSE"}}`；
  `preflight.json` 已是 `NAMED_292_READONLY_LOADER_PREFLIGHT_PASSED (--materials)`，说明构建与材料检查均通过。
- 根因：`prepare-named295.py` 把 receipt purpose 写成 `NAMED_POL113_POL114_EXACT_320`；`installer-named320.patch` 里 `withNamedPol113Pol114320(...,323)` 按 `NAMED_POL113_POL114_EXACT_'+version`（即 `…_323`）断言，且 named320 分支按 `…_EXACT_320` 判定。三者不一致时 input 即拒绝。
- 修复：purpose 统一为 `…_EXACT_323`，installer 的 named320 判定与 stage 名同步为 323；`entry` 的 status 仍是 `…_EXACT_323_PASSED`，与 `run-named295.sh` 的校验一致。
- 修复后本地（用镜像内已构建材料 + 挂载修补后的 `installer.cjs`/`install-only.cjs`）：purpose 通过，进入 `ORIGINAL_POL113_HTTP_AND_BROWSER_JEST`，30 例中 29 过、1 例失败，`exit:null/signal:SIGTERM`、`prismaCodes:["P0001"]`，失败帧 `spec 323`。本地为 arm64 模拟 x64，`SIGTERM` 更像超时；是否真实回归需在 x64 CI 重跑该 lane 后看 `jestDiagnostic`。

## 4. 验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 迁移基线 | `pnpm check:migration-baseline` | `status=clean`，323 / `20261119007500…` / `98e016b2…`，`drift:[]` |
| pol115 工作台 | `run-workbench295.sh /tmp/jgL /tmp/lnl/source 5d07c92c0 /tmp/lnl/mobile --current-320` | `POL115_WORKBENCH_ORIGINAL_323_PASSED`（9/9，desktop+mobile，`cleanup=POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT`） |
| 采购输入 | `procurement/run-procurement295.sh … general16 --current-320` | 输入阶段通过（`candidateDriftPaths:102`），业务阶段止于 `PROCUREMENT_ARCHIVE_JEST` / `jg_company_transfer_loan_repayment_scope_v1` |
| 容器清理 | `docker ps -q` | 输出为空（0 行） |

## 5. 仍红项与建议

1. **07500 授权链（5+ 门）**：按第 2 节整组重钉冻结材料；不建议只补别名或只补读基线。
2. **采购限制表**：`jg_company_transfer_loan_repayment_scope_v1` 是 owner-only 的密钥表，采购 HTTP 用例以运行时角色直接读它。需产品/夹具决策：是给采购运行时补列级/表级 SELECT（并同步角色检查），还是修产品读路径改走 SECURITY DEFINER 函数。
3. **onboarding**：sealed 材料内的夹具副本与 313 表快照需与第 1 项一起重钉。
4. **pol275**：`EACCES` 需在 165/166 碰撞观察路径上单测定位（非 SQLSTATE）。
5. **remaining**：5 个失败用例需按清理/保留语义逐例复跑（当前只知编号）。

## 6. 本轮结论

- 修绿：`pol115_workbench`（提交 `fbb6a76de`）。
- 修到下一层：`general_procurement` 输入阶段（`fbb6a76de`），业务阶段仍有 42501；`pol113_pol114` 静默 `INPUTS` 已修，业务套件剩 1 例待 x64 复核。
- 其余门首因已按上表定位；`task398` 族与 onboarding 的修复方案已给出且经最小实验验证，但整组 pin 重钉未在本轮提交，避免出现“改一半、别的门反红”。
