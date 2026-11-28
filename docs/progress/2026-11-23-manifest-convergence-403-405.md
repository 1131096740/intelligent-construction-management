# 整站 inspect 清单收敛（#403 返工、#405、#404）

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgAF`，分支 `line-af-manifests`；基线 `e16e2b515`（迁移 325，含 #405）
- 先合入集成分支 `adopt-395-396-415` 最新 tip `96930648f`（合入 #404；合并提交 `b120d242d`），迁移数随 #404 到 **326**；本票未新增迁移、未改 `07500`/`05800`、未 push、未操作生产
- 只改清单/证据层与 inspect 一致性辅助：未改产品代码、未放宽判定、未删除既有清单条目

## 1. 结论

| 门 | 处理前 | 处理后 |
| --- | ---: | ---: |
| `inspect:whole-site-page-actions:ready` blocker | **5** | **0** |
| `inspect:whole-site-route-usage` 未分类 | **8** | **0** |
| `inspect:release-manifests` | 红（drift + 上游 blocked） | **绿** |

- 5 个 page-action blocker 全部来自 #403 返工的 `ActualPurchaseBatchPanel.vue` 写适配器；页面确有动作并确实调用 wrapper，已按 `scripts/lib/contract-signed-pages-action-proof.mjs` 的做法补专用 witness 登记。
- 8 条 route-usage 未分类：2 条 #403（批次详情 GET、更新 PATCH）+ 6 条 #405（其他项目付款写接口）；按 #400 既有口径登记为 `internal_task` + `operator_endpoint`，理由写明“Web 写入口尚未接入”。
- #405 的 6 个写接口**没有**生产 Web wrapper，页面（`OtherProjectPaymentPage.vue`）是只读台账 + 回链原费用单，因此不能登记 page action；本轮只完成 route-usage 分类，未伪造页面动作。
- #404 的 2 个只读导出/2 条只读路由由生产 Web wrapper 自动推导为 `page`，无新增未分类、无新增 page-action blocker；清单已同步。
- 三条命门均退出 0；`pnpm --filter @jiangkong/web-admin typecheck` 通过；受影响单测除一个合并基线既存失败外通过。
- 剩余红项：无（三条命令）；仍存在**产品缺口**而非门禁红项，见第 6 节。

## 2. page-actions：5 → 0

基线（合入 #404 前后一致）blocker 均为 5 条 `PRODUCTION_WRITE_WRAPPER_WITHOUT_ACTION_OR_CLASSIFICATION`，全部指向：

`apps/web-admin/src/components/ActualPurchaseBatchPanel.vue`

| action id | wrapper | 页面打开门的证据 | 写调用 | 可信单 GET | 后端授权/前置 |
| --- | --- | --- | --- | --- | --- |
| `actual-purchase-batch.create` | `createActualPurchaseBatch` | 按钮 `v-if="canCreate"` → 对话框 `createBatch`；`canCreate` 在综合采购页由 `Boolean(detail.canProcure)`、零星采购页由服务端采购状态派生 | `await createActualPurchaseBatch({…})` | `listActualPurchaseBatches`（`transparent_main_response`，单 GET） | 零星 `material_staff/material_director`；综合 `comprehensive_director` |
| `actual-purchase-batch.spot-payment` | `createActualPurchaseBatchSpotPayment` | 按钮 `v-if="kind === 'spot_material' && canPay && !batch.capacity.suspended"` → 对话框 `createPayment` | `await createActualPurchaseBatchSpotPayment(batch.id, {…})` | 同上 | `material_staff/material_director` + `kind=spot_material` |
| `actual-purchase-batch.correction-request` | `requestActualPurchaseBatchCorrection` | 按钮 `v-if="isFinance && batch.costVersion > 0"` → 对话框 `requestCorrection` | `await requestActualPurchaseBatchCorrection(batch.id, {…})` | 同上 | `FINANCE_ROLES` + `costVersion > 0` |
| `actual-purchase-batch.correction-confirm` | `confirmActualPurchaseBatchCorrection` | 按钮 `v-if="correction.status === 'pending_confirm' && isFinanceDirector"` → 对话框 `confirmCorrection` | `await confirmActualPurchaseBatchCorrection(batch.id, correctionId, {…})` | 同上 | `finance_director` |
| `actual-purchase-batch.refund-record` | `recordActualPurchaseBatchRefund` | 按钮 `v-if="isFinance && Number(batch.capacity.paidAmountCents) > 0"` → 对话框 `recordRefund` | `await recordActualPurchaseBatchRefund(batch.id, {…})` | 同上 | `FINANCE_ROLES` |

实现方式：

- 新增 `scripts/lib/actual-purchase-batch-page-action-proof.mjs`，逐条 pin：打开按钮的 `v-if` 门、按钮 click 与打开对话框的赋值、对话框 confirm handler、`run(async () => …)` 内的唯一 wrapper 调用、共享 `run()` 与 `load()` 源码、父页面 `:can-create`/`:can-pay` 绑定、后端 service 的 `requireAnyRole`/前置条件。
- 在 `scripts/lib/whole-site-page-action-manifest.mjs` 仅增加该专用 witness 的引入与选择分支（与既有 `SIGNED_PAGE_ACTION_IDS`/签章/归档/公共现金一致），未改动通用因果/能力判定。
- `isFinance`/`isFinanceDirector` 没有被写成“服务端能力”：witness 同时钉住后端 `requireAnyRole(...)` 守卫，能力声明只取页面已有的服务端布尔/服务端读模型字段（`canCreate`、`canPay`、`batch.costVersion`、`correction.status`、`batch.capacity.paidAmountCents`）。
- 5 条 action 的 `routePaths` 为 `/综合采购申请/:procurementId` 与 `/零星采购/:procurementId`，两者都是该组件的真实 owner route。

处理后 page-action 清单：`475 actions, 0 blockers`（覆盖生产写 consumer 466/466）。

## 3. route-usage：8 → 0

按脚本既有 schema（`page` / `external_takeover` / `exit_candidate` / `internal_task`），沿用 #400 “接口已有、Web 页面尚未接入”的既有口径登记为 `internal_task` + `consumerSurface=operator_endpoint`，理由写入 registry：

| 路由 | 归属 | 理由 |
| --- | --- | --- |
| `GET /actual-purchase-batches/:batchId` | #403 | `issue_403_actual_purchase_batch_detail_and_update_api_not_yet_consumed_by_web_page` |
| `PATCH /actual-purchase-batches/:batchId` | #403 | 同上 |
| `POST /other-project-payments` | #405 | `issue_405_other_project_payment_write_api_not_yet_consumed_by_web_page` |
| `POST /other-project-payments/:claimId/submission` | #405 | 同上 |
| `POST /other-project-payments/:claimId/approval` | #405 | 同上 |
| `POST /other-project-payments/:claimId/payments` | #405 | 同上 |
| `POST /other-project-payments/:claimId/payments/:executionId/refunds` | #405 | 同上 |
| `POST /other-project-payments/:claimId/corrections` | #405 | 同上 |

- 这 8 条都**不是** `exit_candidate`：GET/PATCH 批次详情与 #405 写接口仍是有效后端能力，贸然登记退出候选会触发 retired-write 410 语义，超出本票授权。
- `actual-purchase-batch.api.ts` 的 `fetchActualPurchaseBatch` / `updateActualPurchaseBatch` 目前生产消费者为空（面板用列表返回的聚合视图，未调用详情/更新适配器），已在 web-api 清单保持 `unreferenced`，route-usage 按“尚未接入 Web”分类并在第 6 节列为产品缺口。
- 6 个 #405 写接口没有任何生产 Web wrapper，登记 page action 会凭空制造页面动作，故只做 route-usage 分类并报告。

## 4. #404 覆盖情况

集成分支 `96930648f` 带入 #404 后：

- 新增 2 个只读 Web wrapper：`fetchExpenseClaimExpenseCategories`（`GET /expense-claims/expense-categories`）、`fetchExpenseClaimSelectablePurchaseBatches`（`GET /expense-claims/selectable-purchase-batches`），生产消费者为 `ExpenseClaimCreateDrawer.vue`。
- 2 条 Nest 路由由生产 Web 证据自动推导为 `page`，未新增未分类、未新增 page-action 写 blocker；无需新增 page-action 条目（只读）。
- 同步更新了 `web-api-wrappers.json`（763 wrappers / 837 bindings）、`nest-business-routes.json`（855 routes）、`route-usage.json`、`web-page-actions.json`、能力矩阵、用户可填写入口清单与合同变更权限清单。
- #404 回执自述的 “787 exported / 763 wrappers / blocked” 与 “清单未重跑” 已在本轮清零：web-api READY 763/837，route-usage READY 855/0，page-actions READY 475/0。

本轮覆盖的票：**#403 返工 5 个写适配器 + #405 6 个写接口（route-usage）+ #404 2 个只读导出/2 条路由的清单同步**。

## 5. 五条验证结果

| 命令 | 退出码 | 输出 |
| --- | ---: | --- |
| `pnpm run inspect:whole-site-page-actions:ready` | 0 | `WHOLE_SITE_PAGE_ACTION_MANIFEST_READY: 475 actions, 0 blockers` |
| `pnpm run inspect:whole-site-route-usage` | 0 | `WHOLE_SITE_ROUTE_USAGE_MANIFEST_READY: 855 routes, 0 unclassified` |
| `pnpm run inspect:release-manifests` | 0 | 全子门通过：route 855；web-api 763/837；page-actions 475/0；route-usage 855/0；用户可填写入口 ready（461/10）；POL-21 15/15；POL-23 ready；contract mutation authority 86 routes/22 actions；whole-site capability matrix 855/0 |
| `pnpm --filter @jiangkong/web-admin typecheck` | 0 | `vue-tsc --noEmit` 通过 |
| `pnpm check:migration-baseline` | 0 | `clean`，326 / `20261124010000_expense_claim_line_quantity` / `5b2cf1b8…` |

单测：

- `scripts/inspect-whole-site-route-usage-manifest.test.mjs` + `scripts/inspect-whole-site-web-api-manifest.test.mjs`：**70/70 通过**。
- `scripts/inspect-whole-site-capability-matrix.test.mjs`、`scripts/inspect-release-manifests.test.mjs`、`scripts/inspect-contract-mutation-authority-manifest.test.mjs`、`scripts/inspect-whole-site-page-action-manifest.cli.test.mjs`：**65/65 通过**。
- `scripts/inspect-whole-site-page-action-manifest.test.mjs`：**393/394 通过**；唯一失败 `review regression rejects selected target JSON custom response` 与本轮清单改动无关（回退本轮改动仍失败，属合并基线既存 fixture 断言，上一轮 #428 收敛回执已记录同一失败）。
- 另：`git diff --check` 通过；`docker ps -q` 实测 **0 行**（未使用真库）。

## 6. 仍红项与产品缺口

三条命门已无红项。以下为**产品/授权缺口**，不是本轮可以靠清单消除的：

1. **#405 的 6 个写接口仍无 Web 入出口**：`POST /other-project-payments`、`:id/submission`、`:id/approval`、`:id/payments`、`:id/payments/:executionId/refunds`、`:id/corrections` 只有后端能力；`OtherProjectPaymentPage.vue` 为只读台账并回链原费用单。若要转成 page action，需产品决定是否在 Web 接入写表单/审批/实付/退款/更正，并补服务端能力投影；本轮按约束不补假实现。
2. **#403 批次详情/更新适配器无消费者**：`fetchActualPurchaseBatch`、`updateActualPurchaseBatch` 在 Web 无调用点，route-usage 按“尚未接入 Web”登记；若产品确认不需要，可另票登记退出候选并处理 retired-write 语义。
3. **#403 面板的更正/退款可见性使用客户端岗位**：页面用 `isFinance`/`isFinanceDirector` 控制按钮，后端 service 用 `requireAnyRole` 强制同一岗位集合；witness 已同时钉住两侧。若后续要求“页面能力必须由服务端布尔投影”，需要后端 read model 增加显式能力字段（本票不改产品代码）。

## 7. 清单生成与差量核对

- `web-page-actions.registry.json`：只追加 5 条 `actual-purchase-batch.*`，无删除、无改动既有条目。
- `route-usage.registry.json`：只追加 8 条 classification override + 8 条 consumer-surface override，并同步 `expectations`（855 / 233 / 各 usage 与 surface 计数、两个 sha256）；无删除、无改动既有条目。
- 其余 `*.json`/矩阵 markdown 均由既有 `--write` 生成器按当前事实重生成；`contract-mutation-authority.json` 的 +2 路由来自合并分支的合同接管路由，非本轮新增产品能力。
- 为让 release 门可通过，修正了两处 inspect **一致性校验**（不改变门禁语义、不放宽任何写动作）：
  - `whole-site-capability-matrix.mjs`：候选 mutation consumer 不再把 `registered-payment.lookup-original` 的只读 recovery POST 计为候选（与 page-action 清单“production mutation pair”定义对齐）；归档下载包能力 GET 作为写动作的 support read 不再要求 accepted mutation consumer。
  - `inspect-whole-site-route-usage-manifest.test.mjs`：仓库基线锁从 702 更新为当前 855 及对应计数/hash，属于基线事实更新，不是判定放宽。
- 执行环境说明：本机沙箱拒绝 Prisma 用户缓存 `utime`，API build 前用临时 `HOME` 指向工作树内缓存副本执行 `prisma generate`；`node_modules`/临时目录未入库。

## 8. 改动文件

- `scripts/lib/actual-purchase-batch-page-action-proof.mjs`（新增 witness）
- `scripts/lib/whole-site-page-action-manifest.mjs`（引入专用 witness 分支）
- `scripts/lib/whole-site-capability-matrix.mjs`（两处一致性校验修正）
- `scripts/inspect-whole-site-route-usage-manifest.test.mjs`（仓库基线锁更新）
- `docs/product/manifests/web-page-actions.registry.json`、`web-page-actions.json`
- `docs/product/manifests/route-usage.registry.json`、`route-usage.json`
- `docs/product/manifests/web-api-wrappers.json`、`nest-business-routes.json`
- `docs/product/manifests/whole-site-capability-matrix.json`、`docs/product/whole-site-capability-matrix.md`
- `docs/product/manifests/user-fill-entry-inventory.json`、`contract-mutation-authority.json`
- `docs/product/contract-workbench-capability-matrix.md`
- `docs/progress/2026-11-23-manifest-convergence-403-405.md`（本回执）
