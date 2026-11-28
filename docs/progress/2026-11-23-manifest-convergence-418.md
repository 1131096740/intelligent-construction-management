# 整站 inspect 清单收敛（#418 经营总览与成本主体归属）

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgAF`，分支 `line-af-manifests`；上一轮 tip `f795e6c90`
- 合入集成分支 `adopt-395-396-415` 的 #418 合并（当前 merge 状态），迁移数随 #418 到 **328**（末端 `20261126000000_operating_cost_attribution_confirmation`）；本票未新增迁移、未改 `07500`/`05800`、未 push、未操作生产

## 1. 结论

| 门 | 处理前 | 处理后 |
| --- | ---: | ---: |
| `inspect:whole-site-page-actions:ready` | 481 actions / **2 blockers** | 483 actions / **0 blockers** |
| `inspect:whole-site-route-usage` | 871 routes / 0 unclassified / **4 计数漂移 BLOCKED** | 871 routes / 0 unclassified / **READY** |
| `inspect:whole-site-release-manifests` | 红（contract matrix drift + 上游 blocked） | **绿** |
| `inspect:whole-site-web-api` | READY 779 / 853 | READY 779 / 853（本轮保持） |

- 2 个 blocker 均为 #418 公共现金成本归属写适配器：`requestCostAttribution`、`reviewCostAttribution`（同一 `ProjectOperatingOverviewPage.vue`）。
- 页面确有动作且确实调用 wrapper，已新增 `scripts/lib/cost-attribution-page-action-proof.mjs` 专用 witness 登记；未改通用判定、未扩白名单、未删条目。
- route-usage 未新增未分类路由，仅按实际渲染值同步 `expectations`；三份生成清单在 merge 后用 `--write` 重生成，未手改 JSON。

## 2. 两个 page-action blocker 的逐条处理

| action id | wrapper | 页面门/动作 | 写调用 | 可信单 GET | 后端岗位 |
| --- | --- | --- | --- | --- | --- |
| `cost-attribution.request` | `requestCostAttribution` | “发起归属”按钮 `v-if="!candidate.activeConfirmationId && canRequestCostAttribution"` → `openCostAttributionDialog` → 对话框确认 | `await requestCostAttribution(projectId, candidate.factId, {…})` | `fetchCostAttributions`（`GET /projects/:param/cost-attributions`） | 控制器 `@RequirePositions(comprehensive_director, finance_staff, finance_director)` + service `canPerform(ROLE_KEYS.request, roles)` + `operating_cost_attribution.request` 岗位表 |
| `cost-attribution.review` | `reviewCostAttribution` | “确认归属/退回”按钮 `v-else-if="candidate.activeStatus === 'pending_review' && canReviewCostAttribution"` → `openCostAttributionReview` → 对话框确认 | `await reviewCostAttribution(projectId, row.id, {…})` | 同上 | 控制器 `@RequirePositions(…)` + service `canPerform(ROLE_KEYS.review, roles)` + `operating_cost_attribution.review: [finance_director]` |

实现要点：

- 页面成本归属对话框的 `@confirm` 是条件表达式 `costAttributionReview ? submitCostAttributionReview() : submitCostAttribution()`，通用模板触发根提取不会把条件表达式拆成两个 page_action。因此两条按 `usage: "background"` 登记为模块 handler，由专用 witness pin 完整链：打开按钮的 `v-if`/`v-else-if` 门 → `openCostAttribution*` 置对话框可见 → 对话框条件 confirm 路由到 handler → handler 内唯一 wrapper 调用 → `costAttribution.value = await fetchCostAttributions(projectId)` 可信单 GET → 后端岗位与服务层权限守卫。
- `canRequestCostAttribution`/`canReviewCostAttribution` 的客户端 computed 仅用于可见性；witness 同时 pin 其角色数组与后端 `@RequirePositions`、`canPerform`、共享域 `ACTION_REQUIRED_ROLES`，能力声明不把客户端角色当成独立服务端能力。

### 2.1 为可信单 GET 做的 API 错误体兼容调整

`cost-attribution.api.ts` 的 `readJson` 原先用 `await response.text()` 读取错误体，导致 web-api 清单把 `fetchCostAttributions` 判为 `unverified`，无法作为 witness 的可信单 GET。已改为与既有 API 模块一致的 JSON 错误体读取：

```ts
const body = await response.json().catch(() => ({})) as { message?: unknown };
throw new Error(formatApiErrorMessage(
  typeof body.message === "string" ? body.message : "读取成本归属失败",
  response.status,
  "读取成本归属失败"
));
```

成功路径、状态码与中文兜底不变；仅错误体解析从 text 改为 JSON（非 JSON 错误体仍回落中文兜底）。重生成后 `fetchCostAttributions` 为 `transparent_main_response`，`requestCostAttribution`/`reviewCostAttribution` 保持 `unverified`（写 wrapper 不需要作为读取源）。

## 3. route-usage 计数同步

本轮未新增未分类；仅同步 `route-usage.registry.json` 的 `expectations`：

| 字段 | 旧值 | 新值 |
| --- | ---: | ---: |
| `routeCount` | 866 | **871** |
| `usageCounts.page` | 652 | **657** |
| `derivedProductionPageCount` | 633 | **638** |
| `consumerSurfaceCounts.web_api_wrapper` | 704 | **709** |
| `usageCounts.external_takeover` | 70 | 70 |
| `usageCounts.exit_candidate` | 91 | 91 |
| `usageCounts.internal_task` | 53 | 53 |
| `usageCounts.unclassified` | 0 | 0 |
| `consumerSurfaceCounts.auth_store` | 5 | 5 |
| `consumerSurfaceCounts.signed_ticket_delivery` | 2 | 2 |
| `consumerSurfaceCounts.machine_probe` | 3 | 3 |
| `consumerSurfaceCounts.operator_endpoint` | 50 | 50 |
| `consumerSurfaceCounts.none` | 102 | 102 |

分类/consumer-surface override 数量与 sha256 未变（233 / 55，`cc4f12a8…` / `2aff8df4…`）。871 = 上一轮 866 + #418 的 5 条路由；`scripts/inspect-whole-site-route-usage-manifest.test.mjs` 的仓库基线锁同步 866→871。

## 4. #418 清单覆盖

- #418 新增 5 条 Nest 路由（成本归属列表/发起/复核、资金流水列表/导出），web-api READY 779 wrappers / 853 bindings。
- 成本归属 2 个写 wrapper 由本轮 witness 覆盖；资金流水/经营总览只读路由由生产 Web 证据自动归 `page`，无未分类。
- 合同工作台能力矩阵、整站能力矩阵、用户可填写入口清单、合同变更权限清单均按 871 路由与新 action 重生成。

## 5. 验证结果

| 命令 | 退出码 | 输出 |
| --- | ---: | --- |
| `pnpm run inspect:whole-site-page-actions:ready` | 0 | `WHOLE_SITE_PAGE_ACTION_MANIFEST_READY: 483 actions, 0 blockers` |
| `pnpm run inspect:whole-site-route-usage` | 0 | `WHOLE_SITE_ROUTE_USAGE_MANIFEST_READY: 871 routes, 0 unclassified` |
| `pnpm run inspect:release-manifests` | 0 | route 871；web-api 779/853；page-actions 483/0；route-usage 871/0；用户可填写入口 ready（469/10）；POL-21 15/15；POL-23 ready；contract mutation authority 86/22；capability matrix 871/0 |
| `pnpm --filter @jiangkong/web-admin typecheck` | 0 | `vue-tsc --noEmit` 通过 |
| `pnpm --filter @jiangkong/api build` | 0 | `nest build` 通过（按临时 HOME 重生成 Prisma client，规避沙箱缓存 `utime` 限制） |
| `pnpm check:migration-baseline` | 0 | `clean`，328 / `20261126000000_operating_cost_attribution_confirmation` / `362340da…` |

单测：

- 清单四件套（route-usage / web-api / capability-matrix / release-manifests）：**125/125 通过**。
- `scripts/inspect-whole-site-page-action-manifest.test.mjs`：**393/394 通过**；唯一失败 `review regression rejects selected target JSON custom response` 为合并基线既存 fixture 断言（历轮回执已记录），与本轮改动无关。
- `git diff --check` 通过；`docker ps -q` 实测 **0 行**。

## 6. 仍红项

- 三条命门无红项。
- 已知非本轮问题：page-action 单测 1 条合并基线既存失败（同上）。
- #418 的经营总览/成本归属业务口径与真库证据以 #418 回执为准；本轮只补清单与页面动作证据，未改其业务逻辑。

## 7. 改动文件

- `scripts/lib/cost-attribution-page-action-proof.mjs`（新增专用 witness）
- `scripts/lib/whole-site-page-action-manifest.mjs`（接入专用 witness 分支）
- `apps/web-admin/src/api/cost-attribution.api.ts`（错误体 JSON 读取，使 GET provenance 可信；成功路径不变）
- `docs/product/manifests/web-page-actions.registry.json`、`web-page-actions.json`
- `docs/product/manifests/route-usage.registry.json`、`route-usage.json`
- `docs/product/manifests/web-api-wrappers.json`、`nest-business-routes.json`
- `docs/product/manifests/whole-site-capability-matrix.json`、`docs/product/whole-site-capability-matrix.md`
- `docs/product/manifests/user-fill-entry-inventory.json`、`contract-mutation-authority.json`
- `docs/product/contract-workbench-capability-matrix.md`
- `scripts/inspect-whole-site-route-usage-manifest.test.mjs`
- `docs/progress/2026-11-23-manifest-convergence-418.md`（本回执）
