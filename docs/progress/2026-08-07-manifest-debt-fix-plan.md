# 修复方案：全站 manifest 既有债务（#9 台账迁移后未重生成）

日期：2026-08-07 · 状态：方案（仅记录，未实施）· 范围：跨 #9/#23/#24 既有 CI blocker

## 1. 症状

CI 作业 `release-gates` 的「Verify capability and usage manifests」步骤失败。该步骤依次执行：

```bash
pnpm inspect:contract-workbench-capabilities   # 第一步即失败
pnpm inspect:whole-site-capabilities
pnpm inspect:whole-site-web-api:ready
pnpm inspect:whole-site-page-actions:ready
pnpm inspect:whole-site-route-usage:ready
pnpm inspect:whole-site-capability-matrix:ready
```

第一步抛：`CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT`（"Exit candidate regained a production consumer"）。
后续四个 `:ready` 检查即使跳过第一步，也因同源 drift 全部失败（#23/#24 已知放行模式）。

## 2. 根因

**#9「生命周期化合同可见性与台账视图」把 `ContractListPage.vue` 从 `/contracts/workbench` 迁移到 `/contracts/lifecycle-ledger` 之后，三份提交在仓库的 manifest 均未重新生成，仍描述迁移前的旧状态。** 代码是 source of truth，manifest 与代码不一致导致多个门禁互相矛盾。

### 2.1 关键事实（已核验）

| 对象 | 提交的旧 manifest 状态 | 真实代码（#9 之后） |
|---|---|---|
| `GET /contracts/lifecycle-ledger`（后端路由） | `route-usage.registry.json` override 标为 `exit_candidate` | `ContractListPage.vue` 真实消费 |
| `fetchContractLifecycleLedger`（wrapper） | `web-api-wrappers.json`：`productionConsumers: []`；`retired-web-api-wrappers.json` 登记为 `test_only` 孤儿 | 生产消费者 = `ContractListPage.vue`（import L300 / call L447） |
| `fetchContractWorkbenchLedger`（wrapper，deprecated） | `web-api-wrappers.json`：`productionConsumers: ["ContractListPage.vue"]`（记反了）；退役 registry **未登记** | 生产消费者 = **0**（已无任何页面调用，仅测试引用） |

### 2.2 失败链路

1. `route-usage.registry.json` 第 76–81 行把 `GET /contracts/lifecycle-ledger` override 为 `exit_candidate`（reason `legacy_lifecycle_ledger_candidate_only_no_deletion_authorization`）。该 override 写于 #9 迁移**前**，当时 lifecycle wrapper 确为孤儿、lifecycle 路由确无消费者，是合理的候选退出。
2. #9 迁移后 lifecycle wrapper 有了生产消费者，但 override 未更新 → `inspect:contract-workbench-capabilities` 交叉核对「exit_candidate 路由必须零生产消费者」，发现 `ContractListPage.vue` 消费它 → 抛 `CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT`。
3. `retired-web-api-wrappers.json` 仍把 lifecycle wrapper 登记为 `test_only` 孤儿 → 与实际（有消费者）不符 → `registry_invalid`；而真正变为孤儿的 deprecated `fetchContractWorkbenchLedger` 未登记 → `inspect:whole-site-web-api:ready` 报 drift + 未注册 orphan。
4. page-actions / capability-matrix 从 web-api manifest 派生，连锁失败。

### 2.3 责任归属

- 本债务与 Issue #11 无关：`git diff main...HEAD` 对 `ContractListPage.vue`、`core-flow-read.api.ts`、`route-usage*.json`、`retired-web-api-wrappers.json` 均为零改动。
- 已在干净 main（`706c6e41`）临时 worktree 上运行 `inspect:contract-workbench-capabilities`，**复现同一 blocker**，确认是既有失败而非本票引入。
- #23、#24 均在 "Release gates FAILURE" 状态下合并，属于被放行的既有债务。

## 3. 修复方案

思路：**代码是 source of truth**。把 `exit_candidate` / 孤儿登记的判断从「迁移前」的两条链路上挪到「迁移后」的正确对象上，再重生成派生 manifest。

### 第 1 步：校正 `route-usage.registry.json`

文件：`docs/product/manifests/route-usage.registry.json`

- **移除** 第 76–81 行 `GET /contracts/lifecycle-ledger` 的 `exit_candidate` override。
  - 移除后该路由由 wrapper consumer 自动推导为 `page`，无需手动加 `matched` 条目。
- **新增** `GET /contracts/workbench` 的 `exit_candidate` override（reason 沿用语义，如 `legacy_workbench_ledger_candidate_only_no_deletion_authorization`），因为它现在是真正「无生产消费者、仅 deprecated wrapper 兼容保留」的候选路由。

> 注意：`GET /contracts/workbench` 后端端点仍存在（#9 曾为其补可见性拦截），故 route 本体不删，只标记候选退出。

### 第 2 步：校正 `retired-web-api-wrappers.json`

文件：`docs/product/manifests/retired-web-api-wrappers.json`（core-flow-read 的 `test_only` 条目）

- 从 `test_only` 条目移除 `fetchContractLifecycleLedger`（它已不是孤儿）。
- 向该条目加入 `fetchContractWorkbenchLedger`（它现在是真正的退役兼容 wrapper：无生产消费者、仅 API 测试引用、`@deprecated` 注释保留向后兼容）。

### 第 3 步：重生成派生 manifest

按序执行（`--write` 会以 live 源码为准重写目标文件）：

```bash
pnpm inspect:whole-site-web-api --write            # 更新 web-api-wrappers.json（消费者归属自动修正）
pnpm inspect:whole-site-page-actions --write       # 更新 page-action manifest
pnpm inspect:whole-site-capability-matrix --write  # 更新 capability matrix
pnpm inspect:whole-site-route-usage --write        # 更新 route-usage.json（基于 registry override + live 推导）
pnpm inspect:contract-workbench-capabilities --write docs/product/contract-workbench-capability-matrix.md
```

### 第 4 步：验证全部门禁

```bash
pnpm inspect:contract-workbench-capabilities
pnpm inspect:whole-site-web-api:ready
pnpm inspect:whole-site-page-actions:ready
pnpm inspect:whole-site-route-usage:ready
pnpm inspect:whole-site-capability-matrix:ready
```

预期：6 个检查全部通过（446 routes、0 unclassified 等既有 READY 结论保持）。

### 第 5 步：提交与门禁

- 走独立分支（如 `codex/manifest-debt-fix`）提交；涉及全部为 manifest/registry 文件，无业务代码与 Schema 改动。
- 全量 API jest、typecheck/lint/build 应不受影响（manifest 不进运行时）。
- PR 后远端 CI 应首次在 manifests 步骤全绿。

## 4. 风险与边界

- **不删除 deprecated wrapper**：`fetchContractWorkbenchLedger` 保留（`@deprecated`），仅登记为退役孤儿，避免破坏历史会话/兼容面；彻底删除属后续清理票。
- **route-usage 必须手动挪 override**：纯 `--write` 不会改写 registry 的人工 override；第 1 步是必要前提。
- **consumerSurfaceOverrides** 不含该路由（仅 download/health/probe），无需改动。
- 生产数据、COS、Schema、权限模型均不受影响；本方案只校正「描述层」manifest。

## 5. 关联记录

- #9（引入迁移未同步 manifest）→ #23/#24（在 FAILURE 状态下放行合并）→ 本方案（专门修复该既有债务）。
- 修复落地后可新建一张 issue 跟踪（如「清理全站 manifest 债务」），并在 `PROGRESS.md` 登记。
