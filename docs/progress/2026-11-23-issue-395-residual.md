# Issue #395 残余缺口回执：登记时低于已结算/已付提示

日期：2026-11-23
工作树：`/tmp/jgT`
分支：`line-t-395`
候选代码提交：`aa5d12e32bedd71186c210af4535faefc22cb8ef`（基线 `2ef132450`，集成分支 `adopt-395-396-415` 当前 tip；分支已包含该 tip）
真库证据绑定：`aa5d12e32`（提交后干净工作树）
范围：仅 #395 残余 G1–G4；未 push、未改其它工作树或主仓库、未操作生产。

## 结论

- **G1 已补齐**：补充协议登记入口在提交前返回合同累计生效结算、累计实付及是否低于两者的后端计算；Web 在表单内显示“变更后金额低于累计生效结算/累计实付”的核对提示。提示**不阻断**：后端没有低额拒绝分支，前端也没有禁用提交按钮。
- **G1 留痕**：低额提交仍在同一事务内成功，并追加 `contract.signed_change.balance_check` 审计快照（变更后金额、累计结算、累计实付、两个布尔）；真实 PG 用例已回读该行。
- **G2 已补齐**：复用既有 line-a 真库 runner 与 `jg_contract_signed_change_submit_witness` provision，新增真实 PostgreSQL 16 + Nest HTTP 用例，覆盖登记时提示、低额如实登记、重复待复核 409、非主管复核 403、主管通过后列表/详情提示、审计快照，以及税务更正待复核保原值、通过后生效。
- **G3 已补齐**：新增 Web 提示纯函数行为测试（3 项）、API 包装器路由/载荷测试、页面结构断言；受影响包 typecheck、Web `check:ui`、`inspect:whole-site-web-api:ready`、`inspect:whole-site-page-actions:ready`、`inspect:release-manifests` 均通过，`docs/product/manifests/*` 已用 `--write` 重建并人工复核差量（仅计数、哈希、行号与本票相关 testConsumer；另修复 #420 合并后遗留的 `downloadApprovalForm` consumer 漂移）。
- **G4 已补齐**：本回执 + `PROGRESS.md` 登记。
- **未新增迁移**：未改 `20261119007500`/`20261119005800`；无新迁移目录，迁移账仍 323、终点仍 `20261119007500`。

## 逐条验收对照

| 验收点 | 本轮交付 | 证据 |
| --- | --- | --- |
| CON-20 变更后金额低于已结算/已付时提示核对但允许如实登记 | 列表接口返回 `totalEffectiveSettlementYuan`/`cumulativePaidYuan`/`belowSettled`/`belowPaid`；前端按“当前生效金额 + 本次增减”实时比较并显示提示；后端不因低额拒绝 | `services/api/src/contract/contract-balance-warning.ts`；`contract-signed-change.service.ts`；`SignedContractChanges.vue`；真库用例 7；单测 `contract-balance-warning.spec.ts`、`contract-signed-change.service.spec.ts` |
| 提示可核 | 低额提交同事务写 `contract.signed_change.balance_check` 审计元数据 | `contract-signed-change.service.ts:88-112`；真库用例 7 回读 `AuditLog`；单测断言 |
| 原金额/变更/当前金额并列、框架未定总价 | 原/变更/当前保持原有三元组；框架未定总价仍为 `null` 并跳过提示 | 既有实现；`contract-balance-warning.spec.ts` 断言 `null` 金额不产生提示 |
| 变更不改历史结算和付款 | 只读累计，不更新 `Settlement`/`PaymentRequest`/`ContractVersion`；低额仅审计 | 既有实现 + 单测断言无历史写入 |
| CON-21 付款约定随同一入口复核生效、已提交付款显示提交时/最新 | 本轮未改；复用既有实现 | 既有 `payment-read.service.ts` 与真库主流程用例 |
| HIS-09 原空直补、已填更正复核保原值 | 本轮补真库用例：更正待复核期间详情仍为原 9%/专票，通过后变 6%/普票，原值写入 `beforeSnapshot` | 真库用例 8；`contract-effective-tax.service.ts` 与本票 `05000` 迁移 |
| 金额、权限、状态、审计在后端事务内 | 低额比较与审计在提交事务内；复核/状态/权限仍由既有 SQL 函数与 `Serializable` 事务保证 | 真库用例 7 的 403/409/201/审计；服务单测 |
| Web 行为测试与机械清单 | 余额提示纯函数 3 项、页面结构 7 项、API 包装器 149 项；清单重建后 ready | `signed-change-balance.test.ts`、`contract-change.structure.test.ts`、`core-flow-read.api.test.ts`；五项门禁输出 |
| 真实 PG/HTTP 验证 | 9/9，一次性 PostgreSQL 16，真实 Nest HTTP | 下方命令与 `LINE_A_RECEIPT` |

## 改动

- 新增 `services/api/src/contract/contract-balance-warning.ts`：按合同读取累计生效结算（`effective/partially_paid/paid` + 已确认历史接管结算）、累计实付（付款执行 + 工抵/代付 + 历史已付/代付），与合同详情现有口径一致；提供四位小数格式化与金额比较。
- `services/api/src/contract/contract-signed-change.service.ts`：`list()` 返回累计结算/实付/低于标志；`submit()` 在 SQL 成功后的同一事务内计算比较，低额时写审计快照，不改变提交结果。
- `apps/web-admin/src/pages/contracts/signed-change-balance.ts`：登记表单的纯函数比较；`SignedContractChanges.vue` 用 `t-alert` 显示提示，不禁用提交。
- `apps/web-admin/src/api/core-flow-read.api.ts`：补充列表类型字段。
- 测试：新增 `contract-balance-warning.spec.ts`、`signed-change-balance.test.ts`；扩展 `contract-signed-change.service.spec.ts`、`core-flow-read.api.test.ts`、`contract-change.structure.test.ts`、`line-a-real-db.http.pg.spec.ts`。
- 生成物：`docs/product/manifests/{web-api-wrappers,web-page-actions,route-usage,user-fill-entry-inventory,whole-site-capability-matrix}.json`、`docs/product/whole-site-capability-matrix.md`（`--write` 重建，未手改判定）。

## 验证

### 静态与单测

- `pnpm --filter @jiangkong/api typecheck`：通过。
- `pnpm --filter @jiangkong/web-admin typecheck`：通过。
- 受影响 API：`contract-signed-change.service.spec.ts`、`contract-effective-tax.service.spec.ts`、`contract-read.service.spec.ts`、`contract.controller.spec.ts`、`contract-balance-warning.spec.ts` → **306 passed**。
- 定向 API 复核（含真库 spec 默认跳过）：**18 passed / 9 skipped**。
- Web 全量：**259 文件 / 2422 项通过**。
- Web `check:ui`：通过。
- 真库 spec 因 `RUN_LINE_A_REAL_DB` 默认跳过，不计入上面的 18 项。

### 真实 PostgreSQL 16 + Nest HTTP

```bash
LINE_A_SKIP_CANDIDATE=20261119004200,20261119007500 \
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine \
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
node services/api/prisma/run-line-a-real-db-local.cjs
```

结果：**9/9 通过**，18.0s，`candidateSha=aa5d12e32`、`worktreeClean=true`、`postgres:16`（image `sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`），一次性容器与临时私有存储已清理。新增用例：
- 第 7 条：登记前返回 `1000.0000/500.0000` 且不低于；低额 `-10300.0000` 提交返回 201（不阻断）、重复待复核 409、员工复核 403、主管通过后列表变为 `200.0000` 且 `belowSettled/belowPaid=true`，审计 `contract.signed_change.balance_check` 可回读，合同详情出现“累计生效结算、累计实付”提示；
- 第 8 条：税务更正待复核时详情仍为原 9% 专票，主管通过后变 6% 普票，`beforeSnapshot` 保留原值，审计 `contract.tax_correction.confirm` 1 条。

回执状态 `candidate_http_passed_full_320_blocked`：完整 320/323 迁移重放仍被既有归档安装器前置 `20261118221000` 阻断（`requireActiveProjectParticipatingCompany` 前态，仓库内无迁移写入），因此以 `PREFIX_275_PLUS_CANDIDATE` 应用 28 条候选迁移。跳过了 `20261119004200`（已签结算归档清单）与 `20261119007500`（已签变更/结算附件文件绑定触发器）：二者同受该归档安装器闭包门限制，与本轮提示/真库用例无关；**未伪造 320/323 通过**。

### 机械门禁

- `pnpm run inspect:whole-site-web-api:ready`：`WHOLE_SITE_WEB_API_MANIFEST_READY: 737 wrappers, 811 bindings`；818 routes。
- `pnpm run inspect:whole-site-page-actions:ready`：`458 actions, 0 blockers`。
- `pnpm run inspect:release-manifests`：通过（route/web-api/page-action/route-usage/user-fill/POL-21/POL-23/contract-mutation/capability matrix 全段 ready）。
- 以上命令在本沙箱需显式 `PRISMA_SCHEMA_ENGINE_BINARY`/`PRISMA_QUERY_ENGINE_LIBRARY`，属既有环境差异。

### 资源清理

- runner 结束时已删除其一次性容器；最终 `docker ps -q` 实测为空（0 个运行中容器）。

## 未覆盖 / 边界

1. **“已结算”口径未纳入 #396 的已签结算确认单**：本轮与合同详情现有 `settlementPayment` 口径一致，只计旧 `Settlement` 有效状态 + 已确认历史接管余额。已签结算确认单若也要参与低额提示，需要同时调整合同详情读模型（超出本票 G1 最小改动），当前会低估“已结算”。本轮真实用例用旧 `Settlement` 验证该口径。
2. **完整迁移账仍未跑通**：`20261118221000` 归档安装器前态缺失属既有问题；跳过 `04200`/`07500` 的边界见上。不能据本回执宣称 320/323 全量重放通过。
3. **无真实浏览器交互**：Web 侧为纯函数行为测试、API 包装器测试、页面结构断言 + `check:ui`，未启动 Chromium 点击完整入口；计划中的隔离浏览器验收仍应执行。
4. **全 `src/contract` 目录有 2 个既有失败**：`contract-template/task12-submission.http.spec.ts:1035` 期望 capability `{available:true}`，而 #420 后实际为 `{available:true,incomplete:true}`；与本票改动无关（本票未触碰该文件/能力），未修复以免扩大范围。定向受影响套件全绿。
5. **任务书/Issue 状态未改**：`docs/plans/.../13-contract-changes.md` 仍写 `not-started`，GitHub #395 复选框未勾；等待隔离验收/授权后按流程更新。
6. **生产只读/部署未做**：无授权；本回执不构成生产验收结论。
