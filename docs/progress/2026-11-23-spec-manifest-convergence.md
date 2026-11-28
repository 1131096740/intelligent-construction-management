# PR #428 spec/manifest 门禁收敛回执

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgK`，分支 `line-k-spec-convergence`
- 基线 `5d07c92c0`（迁移 323，终点 `20261119007500_signed_change_and_settlement_attachment_file_binding`）
- 代码提交：`c25ceb8e`（本回执随后单独提交）
- 约束：未 push，未改动 `/tmp/jgL`、`/tmp/jg382-adopt`、主仓库；未提交 `.buildx/`、`.docker-test/`。

## 1. 失败用例逐项差异与判定

### 1.1 `task12-*` 五套（api-1/api-2/api-4）

实际差异：保存合同草稿时合成持久层报 `合成持久层拒绝未登记的锁投影：/* receipt_non_receipt_file_binding */ ...` 或
`合成投影参数未登记 sha=a3c344f8... count=2`，HTTP 500。

根因：`f28d3ebac` 已把 `ContractSignedChange.appendixFormalFileId` 与
`SignedContractSettlementAttachment.fileId` 加入 TypeScript 注册表
`NON_RECEIPT_FILE_BINDINGS`，文件绑定 SQL 因此新增两个 `UNION ALL` 分支；
`template-management.test-support.ts` 仍钉着旧 SQL 的规范化摘要
`e7790890…`。不是产品逻辑错误，合成持久层的精确 SQL 期望过期。

判定：**测试夹具期望过期**。只把摘要更新为当前精确 SQL 的规范化 sha256
`2dd5df32…`，保留精确哈希与参数个数断言，未改成包含判断，未删用例。

### 1.2 `src/payment/registered-payment-execution.http.spec.ts`（api-1，11 条）

实际差异：`PaymentReadService.getDetail` 依次查询
`jg_read_payment_detail_activity_v1`、`jg_read_payment_contract_agreement_detail_v1`、
`jg_read_payment_detail_allocations_v1`、`jg_read_payment_detail_pdf_v1`、
`jg_read_payment_detail_snapshots_v1`，合成库统一抛
`Synthetic database received an unexpected SQL boundary query`，响应 500。

根因：`e717ba4c6`（#395/#396/#415 候选）新增了真实读取函数，产品代码按
SECURITY DEFINER 读取；合成库未同步这些边界。非产品逻辑错误。

判定：**测试夹具期望过期**。在合成库按真实函数语义补投影：
- activity 从 `paymentExecution`/`financeRecord` 持久行生成并排序；
- agreement 返回已确认付款申请对应的 `{submittedText:null,currentText:null}`（本夹具未建模快照/已批补充协议，产品回退到条款原文）；
- pdf/allocations/snapshots 在未建模时返回空集。

断言未放宽；该套件 84/84 通过。

### 1.3 `src/project/project-completion-public.spec.ts`

实际差异：提交新结算时合成库报
`Unexpected synthetic DB query: SELECT * FROM public.jg_read_ordinary_contract_tax_fact_v1(...)`。

根因：`e717ba4c6` 让新结算冻结普通合同税务事实；夹具未建模
`ContractTaxFactRevision`，因此真实函数应返回空集并回退版本字段。

判定：**测试夹具期望过期**。补空集边界，未改业务断言。

### 1.4 `src/validation/task3-static-field-validation.spec.ts`

实际差异：`staticOptionalNonBlankText` 组数 13 → 14，新增
`CreatePaymentRequestDto.signedSettlementId`（#396 已签结算付款依据）。

判定：**覆盖清单过期**。计数改为 14，并新增对
`CreatePaymentRequestDto.signedSettlementId` 的显式断言；未删减任何断言。

### 1.5 Web `contract-lifecycle-capability-gates.structure.test.ts`

实际差异：用例要求 `ContractDetailPage.vue` 含
`"create_contract_change_draft"`，实际不含。

根因：`e717ba4c6` 用 `SignedContractChanges.vue`（已签补充协议）替代了旧的
“发起合同变更”入口；同轮 `contract-change.structure.test.ts` 已显式断言
`detail` 不再含旧 helper。旧生命周期用例钉的是已退役入口。

判定：**产品能力入口已变更，用例期望过期**。改为断言
`SignedContractChanges` 已接入详情页，并保留提交/复核的 server capability
门（`details?.canSubmit`、`detail.value?.canReview`）；未删除用例。

### 1.6 Quality gates

CI 日志首因是 `pnpm test:ci-orchestration` 中动态门 manifest 校验失败
（与 unregistered spec 同因）；另有 `go-live-ci-gates.test.mjs` 仍把 323 基线
写成 320：

```
if [[ "$count" == 320 ]]; then ...
```

判定：**门禁测试期望过期**。改为 323，并同步 `ciGroups`/文件/用例计数。

另在本机复跑发现并修复 `pnpm test:business-zeroing-tools` 的首个真实失败：
#396 新增 6 张 Prisma 表未登记中文归类。已在
`business-zeroing-policy.cjs` 补齐唯一中文归类，74/74 通过。

## 2. manifest 登记方式

`services/api/prisma/database-dynamic-gate-manifest.json`：

1. `services/api/src/database/file-binding-catalog.pg.spec.ts`（6 条）并入
   `remaining_dynamic_postgresql16` 的 `file_binding_manifest` 子组；
   `run-database-dynamic-remaining-local.cjs` 同步文件、`pendingTests: 7` 与
   `RUN_FILE_BINDING_CATALOG_DATABASE=1`。
2. `services/api/src/database/line-a-real-db.http.pg.spec.ts`（6 条）新建自动组
   `line_a_real_db`，runner 复用现有 `verify:line-a-real-db:local`
   （`run-line-a-real-db-local.cjs`，已固定 `postgres:16` 与 `--pull=never`），
   并加入 `.github/workflows/ci.yml` 动态门矩阵。
3. `inventory` 同步为 88 文件 / 566 用例；`executionInventory` 为
   CI 可执行 29 组 / 87 文件 / 565 用例 + 手工任务 1 组 / 1 文件 / 1 用例。
4. `run-database-dynamic-gate-local.test.cjs` 与 `go-live-ci-gates.test.mjs`
   同步计数与 320→323 基线。

`node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest`
通过（88/566，323，`remaining=0`）。

## 3. 验证命令与结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 受影响 API 用例 | `pnpm exec jest task12-* project-completion-public task3-static-field-validation registered-payment-execution.http --runInBand` | 8 套件 / 166 用例通过 |
| Web 全量单测 | `pnpm --filter @jiangkong/web-admin test` | 257 文件 / 2415 用例通过 |
| 业务清零工具 | `pnpm test:business-zeroing-tools` | 74/74 通过 |
| Web UI 治理 | `pnpm --filter @jiangkong/web-admin check:ui` | 通过 |
| 动态门与 CI 编排 | `node --test run-database-dynamic-gate-local.test.cjs run-database-dynamic-remaining-local.test.cjs scripts/go-live-ci-gates.test.mjs` | 97/97 通过 |
| 迁移基线 | `pnpm run check:migration-baseline` | clean：323 / `20261119007500…` |
| 动态门 manifest | `node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest` | 通过 |
| 文件绑定目录真库用例 | 一次性 PG16 + `RUN_FILE_BINDING_CATALOG_DATABASE=1` + `jest file-binding-catalog.pg.spec` | 6/6 通过 |
| API typecheck | `pnpm --filter @jiangkong/api typecheck` | 通过 |
| Web typecheck | `pnpm --filter @jiangkong/web-admin typecheck` | 通过 |
| 发布清单 | `pnpm run inspect:release-manifests` | 部分通过，仍红（见 §4） |

说明：`run-database-dynamic-remaining-local.cjs --group file_binding_manifest`
在本机准备阶段强制重建 `preparationEnvironment`（只保留 PATH/NODE_ENV/CI），
沙箱下 `prisma generate` 因 `~/.cache/prisma` EPERM 失败；因此改用一次性 PG16
直接执行同一 spec 验证 6/6 通过，登记关系由 manifest validator 覆盖。

## 4. 仍红项与产品侧介入

1. **`inspect:release-manifests` 仍红（首因：Web page-action 能力登记）**：
   `contract-workbench-capability-matrix`、818 条 Nest route manifest、
   `web-api-wrappers`（737 wrappers / 811 bindings）已 matched/ready；随后
   `Page action manifest inspection failed`。生成结果当前有 37 个 blocker：
   21 个新生产写 wrapper 未登记 action（已签结算、履约完工、税务事实、已签补充协议等），
   7 个 `WRITE_WITHOUT_SERVER_CAPABILITY`（已签归档/用章、duty-sms 上游关联），
   旧 `contract-change.create-draft` 仍在 registry、8 条 wrapper 因果链未验证；
   `route-usage` 另有 3 条未分类路由与计数期望漂移，`user-fill-entry-inventory`
   因上游 blocked 连带阻塞。已把已签结算 Web API 的 request method 以字面
   init 暴露并登记旧合同变更 wrapper 退役，使 web-api 清单转 ready；但
   page-action 能力登记属于**产品侧能力清单/页面门禁**，本轮不改写页面能力
   或伪造 registry，需对应 lane 处理。
2. **`line_a_real_db` 动态组仍红（PG 执行，不是 spec/manifest 登记）**：
   本机 `pnpm verify:line-a-real-db:local` 在候选迁移
   `20261119007500` 以 `SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE`
   失败：冻结 295 链仍停在 `20261118221000`，缺
   `jg_require_contract_direct_upward_source_v2()` 前态。需要 295/323 链
   重基线，本轮仅完成 manifest 登记与 CI 矩阵接线。
3. 其他 PG 动态组（task398、remaining、contract_finance 等）在基线 CI 中仍红，
   属各自 lane 的迁移/夹具收敛，本轮未触碰。
