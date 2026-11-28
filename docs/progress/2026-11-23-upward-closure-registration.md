# 已签附件绑定迁移的 upward 闭包登记回执

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgH`，分支 `line-h-file-binding`
- 基线：`f28d3ebac`；合入 `adopt-395-396-415@85948a8b9`（merge `8d43e403f`）
- 产品提交：`35fb956e2`（07500 初始登记）、`3db66b80`、`6b7897df2`（闭包登记修正）
- 未新增迁移：仍为 **323** 条，终态 `20261119007500_signed_change_and_settlement_attachment_file_binding`（校验和 `98e016b2…`）

## 1. 问题与首因

`07500` 按 ACL 保留范式把 `jg_file_business_binding_columns()` 换成后继（`6d15e2b7…` → `2a2b9416…`），并新增 `jg_efb_contract_signed_change_appendix` 触发器，但没有同步 **upward 闭包登记**。Docker settlement lane 在 `INSTALL_320_CONTRACT_DETAIL_READERS` 的收尾见证处失败，`jg_require_contract_direct_upward_source_v2()` 抛 `55000 对上登记原守卫接线或源码已变化`。

定位过程：

1. 第一次按常规跑 lane，Prisma 只报 `current transaction is aborted, commands ignored until end of transaction block`，`_prisma_migrations.logs` 为 `null`；这是同一 07500 事务里后续语句的次生错误，掩盖了首个错误。
2. 用一次性 held 295 数据库（容器内 postgres 停止后重启、`SET SESSION AUTHORIZATION jg_task01_owner`）手动执行 07500，得到首个错误：`jg_require_contract_direct_upward_source_v2()` 的触发器登记循环在 `对上登记原守卫接线或源码已变化` 处抛 55000。
3. 查询该 295 库发现实际 enforcer 后继是 **`30d0ba55…`**（outside-evidence 代），而不是先前假设的 `c70ff547…`（registered-voucher 代）；因此“新触发器把 enforcer 体钉死为单一 successor”的写法在真实链上失败。

## 2. 闭包登记结构

`jg_contract_direct_upward_closure_v2` 单行（`protocolVersion=2`）记录：

- `splices`：有限守卫函数的后继体（before/after 与 metadata）；
- `triggers`：292 安装时固定表上的全部触发器元数据 + routine 元数据 + `routineBodySha256`；
- `routines`：27 个固定源码摘要；
- `constraint`：`ContractVersion_upward_draft_source_check` 的前后定义；
- `jg_require_contract_direct_upward_source_v2()` 重新计算这些摘要并逐项比较；其中 enforcer 触发器走一个多代 coherence 分支（migration `20261118185000` 校验和 + `jg_project_owner_settlement_voucher_bound` / registry / `jg_guard_project_owner_settlement_voucher` 三个函数的精确摘要）。

07500 改变了 registry 后继（coherence 内嵌的 `6d15e2b7…`），并新增一个 enforcer 调用方（`ContractSignedChange` 不在闭包固定 trigger 表集合内，无法进入 292 的 `triggers` 数组），所以必须用登记 splice 表达新状态。

## 3. 在 07500 内补齐的登记

保持同一迁移、同一 323 计数：

1. **registry 后继体**：在闭包门校验前，把 `jg_require…` 内嵌的 registry 摘要 `6d15e2b7…` 精确替换为 `2a2b9416…`（断言旧 `prosrc` 为 `607cc42d…`，替换后为 `c86b37cc…`）。
2. **新触发器接线**：在 `jg_require…` 的 `RETURN result` 前追加一条独立登记，校验：
   - `tgname='jg_efb_contract_signed_change_appendix'`、`tgtype=23`、`tgnargs=2`、`tgargs` 十六进制、`tgattr` 等于 `appendixFormalFileId` 的 attnum、无 deferrable/constraint/qual；
   - 函数 OID = `public.jg_enforce_exclusive_file_business_binding()`，owner/namespace 与闭包 anchor 一致，返回 trigger、volatile、parallel、非 security definer/strict/leakproof/set-returning；
   - enforcer 必须已出现在闭包 `triggers` 数组的已验证 routine 中（`EXISTS (... (entry->'routineMetadata'->>'oid')::oid=p.oid)`）。**不**硬编码单一 enforcer 体，避免把 295 实际后继 `30d0ba55…` 误判为漂移；enforcer 体本身仍由既有 coherence 分支逐代校验。
3. 迁移内执行 `jg_require…()` 自检；闭包门校验逻辑本身未放宽、未改门函数以外的容忍条件。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| held 295 库手动执行 07500 | **通过**：registry ACL 换代、触发器、闭包 splice 全部成功，`jg_require…()` 返回非空 |
| `pnpm exec jest file-business-binding unified-file-business-binding-guard` | 通过：2 套件 / 18 用例 |
| `pnpm --filter @jiangkong/api typecheck` | 通过（exit 0） |
| `node services/api/prisma/generate-database-migration-baseline.cjs --check` | `status: clean`，323 / `20261119007500…` / `98e016b2…` |
| Docker `settlement` lane（`--current-320`） | **`ORIGINAL_CONTRACT_ADJACENT_323_PASSED`**：`INSTALL_320_CONTRACT_DETAIL_READERS` → `EXACT_295_MULTI_WITNESS_CONSUMER` → `ORIGINAL_CONTRACT_ADJACENT_SETTLEMENT` 全过；settlement 2/2 用例；`forwardOutsideWitness.exactPostimage=true`；`forward320.ledgerSha256=0139b46a…` |

> lane 验证是在 `/tmp/jgH-verify` 临时 clone 上、仅本地临时重钉后运行的；`/tmp/jgH` 未包含任何 295 链重钉（见 §5）。

## 5. 需要 line-g 重钉的范围（本次未提交）

07500 字节变化导致当前 323 账本变化、closing 门内的 require 体后继变化，**必须由 line-g 在 295 链重钉**：

| 位置 | 旧值（322/323 重基线） | 新值（本修复） |
| --- | --- | --- |
| `.github/task12-install-295/contract-finance/check-ledger.cjs` 的 323 `ledgerSha256` | `749a60a89f234a4650dcb6c9b1d52c1f025ed90ac9e2b70670c62347edc640bc` | `0139b46a66b97c33adf15ca3ae6897b24410c5dbe726b2ce884e73fc910b1c20` |
| `.github/task12-install-295/contract-finance/common/installer.cjs` 的 `signedSettlementOutsidePostimages['jg_require_contract_direct_upward_source_v2()']` | `607cc42deccbb17f6de375976b5ed0ef0cbb30805c24ab6d3fb7cf6be74fc5fe` | `c86b37cc155cb5cf424dd682f9767363da264eed8630a0dee9f02acde0dc3f49` |

其它 `749a60a8…` 钉点（`bank/named-bank-ci.cjs`、`run-bank-restore.sh`、`contract-finance-owned.test-support.ts`、`restore/forward-320-inventory.json`、`task398-standard-320.patch`）若在这些 lane 上使用当前 323 树，也需要同批更新；本次 settlement lane 只需前两项即可全绿。终态迁移 checksum 由 `27683ee9…` 改为 `98e016b2…`，迁移目录数仍为 323。

## 6. 清理实测

- 手动验证的 held 容器、临时 PostgreSQL 容器均已停止；`docker ps -q` 实测输出为空（0 行）。
- `/tmp/jgH-verify` 为仅本地验证 clone（含临时重钉），收尾后删除；`/tmp/jgH` 工作树干净、未 push。

## 7. 未覆盖项

1. `contract_finance_acceptance`、`pol275`、`task410` 未跑；它们共享同一 `INSTALL_320`/闭包路径，预期随本修复前进，但未实测。
2. `task410` 在 322 时代遗留的 harness 角色模型问题（受限角色业务通过后收尾 55000）仍独立存在，不属于本修复。
3. 其他 295 lane 的 `749a60a8…` 派生材料需 line-g 统一重钉后才能全绿；本次未改这些文件。
