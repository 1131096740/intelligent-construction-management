# 整站 inspect 清单收敛（#411 / #417 / #421a）

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgAF`，分支 `line-af-manifests`；上一轮 tip `fa5ea00db`
- 先合入集成分支 `adopt-395-396-415` 最新 tip `2bbf3270b`（含 #411、#417、#421a），合并提交 `768f37447`
- 迁移数随合并为 **327**（末端 `20261125000000_company_transfer_third_party_repayment`，由 #411 带入）；本票未新增迁移、未改 `07500`/`05800`、未 push、未操作生产

## 1. 结论

| 门 | 处理前 | 处理后 |
| --- | ---: | ---: |
| `inspect:whole-site-page-actions:ready` | 475 actions / **6 blockers** | 481 actions / **0 blockers** |
| `inspect:whole-site-route-usage` | 866 routes / 0 unclassified / **4 计数漂移 BLOCKED** | 866 routes / 0 unclassified / **READY** |
| `inspect:release-manifests` | 红（contract matrix drift + 上游 blocked） | **绿** |
| `inspect:whole-site-web-api` | READY 774 / 848 | READY 774 / 848（本轮未改口径） |

- 6 个 page-action blocker **全部来自 #417 `HistoryExpensePage.vue`**（预检、建批、逐行核实、主管复核、入账、已入库更正）；页面确有动作并确实调用 wrapper，已补专用 AST witness 登记。
- #411（第三家公司代还与往来更正）本快照没有新增 page-action blocker；#421a 的 `/settlements/signed-ledger`、`/settlements/signed-ledger-export` 是只读路由/包装器，由生产 Web 证据自动归为 `page`，无新增 page-action 或 route-usage 未分类。
- merge 后没有留下未解决冲突标记；三份生成物按顺序 `--write` 重生成，未手改生成清单。

## 2. 6 个 page-action blocker 的逐条处理

新增 `scripts/lib/history-expense-page-action-proof.mjs`，逐条 pin：页面触发元素/打开按钮的 `v-if` 门、handler 内的 capability 守卫、唯一 wrapper 调用、`fetchHistoryExpenseCapability` 可信单 GET、后端 `@RequireProjectRole`/读权限守卫。接入 `scripts/lib/whole-site-page-action-manifest.mjs` 的专用 witness 选择，未改通用因果/能力判定。

| action id | wrapper | 页面门 | 写调用 | 服务端 capability |
| --- | --- | --- | --- | --- |
| `history-expense.precheck` | `precheckHistoryExpenses` | 卡片 `v-if="selectedProjectId && capability?.actions.manage"`；handler 守卫 `actions.manage` | `precheck.value = await precheckHistoryExpenses(...)` | `GET .../history-expenses/capability` |
| `history-expense.create-batch` | `createHistoryExpenseBatch` | 同上 | `const created = await createHistoryExpenseBatch(...)` | 同上 |
| `history-expense.verify-row` | `verifyHistoryExpenseRow` | “核实”按钮 `v-if="detail.canVerify && !row.generatedFactId"` → 核实对话框；handler 守卫 `actions.verify` | `detail.value = await verifyHistoryExpenseRow(...)` | 同上 |
| `history-expense.correct-row` | `correctHistoryExpenseRow` | “更正”按钮 `v-if="detail.canCorrect && row.generatedFactId"` → 更正对话框；handler 守卫 `actions.correct` | `detail.value = await correctHistoryExpenseRow(...)` | 同上 |
| `history-expense.confirm-batch` | `confirmHistoryExpenseBatch` | “主管复核”按钮 `v-if="detail.canConfirm"`；handler 守卫 `actions.confirm` | `await confirmHistoryExpenseBatch(...)` | 同上 |
| `history-expense.activate-batch` | `activateHistoryExpenseBatch` | “入账已核实行”按钮 `v-if="detail.canActivate"`；handler 守卫 `actions.activate` | `detail.value = await activateHistoryExpenseBatch(...)` | 同上 |

### 2.1 为登记 4 个财务动作补的最小产品授权修复

登记 witness 时发现 #417 的读接口授权与页面角色不一致：`capability`、批次列表、批次详情三个 GET 都只挂 `@RequireProjectRole("history_expense.manage")`（仅综合部主管），而页面路由对综合部主管/财务人员/财务主管可见，核实、复核、入账、更正的写路由分别要求 `history_expense.verify`/`confirm`/`activate`/`correct` 财务岗位。财务用户打开页面时连 capability/批次详情都读不到，页面动作实际不可达；page-action 检查给出 `capability_get_authorization_incompatible`。

因此只改**读接口**的守卫：

```ts
// services/api/src/history-expense/history-expense.controller.ts
@RequirePositions("comprehensive_director", "finance_staff", "finance_director")
// capability / batches / batches/:batchId 三个 GET
```

- 写路由的 `@RequireProjectRole("history_expense.manage"/verify/confirm/activate/correct)` **未改**，建批仍仅综合部主管、核实/复核/入账/更正仍按原岗位收紧。
- 读接口改为与页面路由相同的三类岗位并集，使财务用户能读取 capability 与批次详情；这是让页面动作真实可达的最小授权修复，不是放宽 page-action 判定，也没有改检查器。
- 修复后 re-generate route manifest，读路由在清单中呈现 `requiredPositions` 并集，四个财务动作的 capability 读授权覆盖写岗位，witness 通过 `capability_get_authorization_compatible`。

## 3. route-usage 计数漂移

本轮未新增未分类路由；BLOCKED 仅因合并后实际渲染值变化。按实际渲染值同步 `docs/product/manifests/route-usage.registry.json` 的 `expectations`：

| 字段 | 旧值 | 新值 |
| --- | ---: | ---: |
| `routeCount` | 855 | **866** |
| `usageCounts.page` | 641 | **652** |
| `derivedProductionPageCount` | 622 | **633** |
| `consumerSurfaceCounts.web_api_wrapper` | 693 | **704** |
| `usageCounts.external_takeover` | 70 | 70 |
| `usageCounts.exit_candidate` | 91 | 91 |
| `usageCounts.internal_task` | 53 | 53 |
| `usageCounts.unclassified` | 0 | 0 |
| `consumerSurfaceCounts.auth_store` | 5 | 5 |
| `consumerSurfaceCounts.signed_ticket_delivery` | 2 | 2 |
| `consumerSurfaceCounts.machine_probe` | 3 | 3 |
| `consumerSurfaceCounts.operator_endpoint` | 50 | 50 |
| `consumerSurfaceCounts.none` | 102 | 102 |

分类 override / consumer-surface override 数量与 sha256 均未变（233 / 55，`cc4f12a8…` / `2aff8df4…`）。同步更新 `scripts/inspect-whole-site-route-usage-manifest.test.mjs` 的仓库基线锁 855→866 及对应计数。

866 = 上一轮 855 + #417 的 9 条历史费用路由 + #421a 的 2 条已签结算台账路由；#411 本快照未新增路由。

## 4. #421a 新增项处理

- `/settlements/signed-ledger`、`/settlements/signed-ledger-export` 两个 GET 路由与 Web 包装器已进入 `nest-business-routes.json` / `web-api-wrappers.json`（774 wrappers / 848 bindings）。
- 两者均被 `SettlementListPage.vue` 生产消费，route-usage 自动推导为 `page`；无新 page-action 写 blocker、无未分类。
- 合同工作台能力矩阵、整站能力矩阵、用户可填写入口清单、合同变更权限清单均按新 route/action 事实重生成。

## 5. 冲突与生成物处理

- 先 stash 本轮未完成的 witness/registry 改动，`git merge --no-ff adopt-395-396-415` 合入 `2bbf3270b`；合并本身无冲突。
- 恢复 WIP 后，按要求顺序重生成：`inspect-whole-site-web-api-manifest.mjs --write` → `inspect-whole-site-page-action-manifest.mjs --write` → `inspect-whole-site-route-usage-manifest.mjs --write`；另用 `inspect-whole-site-capabilities.mjs --write` 同步构建后的 Nest 路由（读守卫变更影响 `requiredPositions`）。
- 若未来冲突：对三份生成物 `git checkout --theirs` 清标记后按上述顺序 `--write`，不手改 JSON；本轮的生成物均为重生成结果。
- route-usage 同步 expectations 后 `--check` 与 `--write` 一致。

## 6. 验证结果

| 命令 | 退出码 | 输出 |
| --- | ---: | --- |
| `pnpm run inspect:whole-site-page-actions:ready` | 0 | `WHOLE_SITE_PAGE_ACTION_MANIFEST_READY: 481 actions, 0 blockers` |
| `pnpm run inspect:whole-site-route-usage` | 0 | `WHOLE_SITE_ROUTE_USAGE_MANIFEST_READY: 866 routes, 0 unclassified` |
| `pnpm run inspect:release-manifests` | 0 | route 866；web-api 774/848；page-actions 481/0；route-usage 866/0；用户可填写入口 ready（467/10）；POL-21 15/15；POL-23 ready；contract mutation authority 86/22；capability matrix 866/0 |
| `pnpm --filter @jiangkong/web-admin typecheck` | 0 | `vue-tsc --noEmit` 通过 |
| `pnpm --filter @jiangkong/api build` | 0 | `nest build` 通过（先按临时 HOME 重生成 Prisma client，规避沙箱对用户缓存 `utime` 的限制） |
| `pnpm check:migration-baseline` | 0 | `clean`，327 / `20261125000000_company_transfer_third_party_repayment` / `cb9fa70f…` |

单测：

- `scripts/inspect-whole-site-route-usage-manifest.test.mjs` + `scripts/inspect-whole-site-web-api-manifest.test.mjs` + `scripts/inspect-whole-site-capability-matrix.test.mjs` + `scripts/inspect-release-manifests.test.mjs`：**125/125 通过**。
- `pnpm --filter @jiangkong/api exec jest src/history-expense --runInBand`：**2 suites / 13 tests 通过**（含控制器读写分离用例）。
- `scripts/inspect-whole-site-page-action-manifest.test.mjs`：**393/394 通过**；唯一失败 `review regression rejects selected target JSON custom response` 为合并基线既存 fixture 断言（上一轮回执已记录），与本轮清单/授权改动无关。
- `git diff --check` 通过；`docker ps -q` 实测 **0 行**。

## 7. 仍红项

- 三条命门无红项。
- 已知非本轮问题：page-action 单测 1 条基线既存失败（同上）。
- 产品边界：#421a 的独立台账页签/筛选 UI、421b 的付款/采购/报销导出不在本轮；#417 只修了读接口授权，未改其历史费用业务口径。

## 8. 改动文件

- `scripts/lib/history-expense-page-action-proof.mjs`（新增专用 witness）
- `scripts/lib/whole-site-page-action-manifest.mjs`（接入专用 witness 分支）
- `services/api/src/history-expense/history-expense.controller.ts`（三个读 GET 改为页面岗位并集守卫；写路由不变）
- `scripts/inspect-whole-site-route-usage-manifest.test.mjs`（866 路由基线锁）
- `docs/product/manifests/web-page-actions.registry.json`、`web-page-actions.json`
- `docs/product/manifests/route-usage.registry.json`、`route-usage.json`
- `docs/product/manifests/nest-business-routes.json`
- `docs/product/manifests/whole-site-capability-matrix.json`、`docs/product/whole-site-capability-matrix.md`
- `docs/product/manifests/user-fill-entry-inventory.json`
- `docs/product/contract-workbench-capability-matrix.md`
- `docs/progress/2026-11-23-manifest-convergence-411-417.md`（本回执）
