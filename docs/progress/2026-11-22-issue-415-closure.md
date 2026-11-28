# Issue #415 关单回执：其他合同履约金额三职责确认

- 日期：2026-11-22
- 分支：`line-e-close-415`
- 验证对象代码 SHA：`a9d0890cc`（本轮代码/测试/迁移提交）
- 基线：`d858d4215`（`adopt-395-396-415` 最新 tip，已核为当前分支祖先，无待合入差异）
- 工作树：真库 runner 记录 `worktreeClean:true`
- 环境：macOS arm64、Docker 29.x、`postgres:16`
  （image id `sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`），
  一次性容器、数据库 `jiangkong_line_a_real_db`，仅监听 `127.0.0.1` 临时端口；未连接生产、
  备份或真实数据。
- 引擎变量（本机沙箱绕行，非产品缺陷）：
  `PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine`、
  `PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine`
- 结论：**本轮验收项均有代码/测试/真库证据；可关单，但附第 3 节显式边界。**

## 1. 逐项验收

| # | 验收点（Issue #415 原文） | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | 合同详情明显的登记已完成工作入口，填工作与金额 | 入口：`apps/web-admin/src/pages/contracts/ContractDetailPage.vue:129` → `ContractWorkCompletionSection.vue`（`登记已完成工作` 表单、四位小数校验、保存草稿）；后端唯一入口 `services/api/src/contract/contract.controller.ts:168-175` + `jg_create_contract_work_completion_draft_v1`（迁移 `20261119005100`）；真库 `line-a-real-db.http.pg.spec.ts` 用例 4 实测 HTTP 建草稿 `18000.0123`、返回 `exceedsContractAmount:true` | **通过** |
| 2 | 合同主管、项目经理、财务并联确认，均完成后计成本 | 职责与冻结：`services/api/src/contract/contract-work-completion-approval.service.ts:21-25`、`:98-106`；DB 事实触发器要求 3 条 `approve`、nodeIndex 0/1/2 且角色匹配、无 `reject`（迁移 `20261119005400:59-68`）；真库用例 4 三职责乱序/依次确认后 `ContractWorkCompletionFact` 1 条、`OperatingFact` `18000.0123`、`confirmed_cost` 1 条、审批审计 3 条；单测 `contract-work-completion-approval.service.spec.ts`（任意顺序、第三次才写一次四位事实） | **通过** |
| 2a | 财务同一人兼任 `finance_staff` + `finance_director` 不卡死、不重复计成本（本轮补齐） | 修复：`services/api/src/approval/approval-review-identity.ts:171-176`（OR 节点按冻结 `roleKeys` 顺序取唯一签署角色）；调用点补 `mode`：`contract-work-completion-approval.service.ts:75`、`:137`。单测 `approval-review-identity.spec.ts`（OR 双岗解析、all 节点仍关闭）、`contract-work-completion-approval.service.spec.ts`（双岗：视图出现财务待办、只落一次 `finance_staff` 签字、三项齐全只计一次成本）；真库用例 4 把 `finance` 同时配到两岗，断言该轮 `approve` 恰 3 条、nodeIndex 2 恰 1 条且 `approvedRoleKey='finance_staff'` | **通过（本轮新增）** |
| 3 | 超合同金额提示不自动拦截 | `jg_create_contract_work_completion_draft_v1` 仅计算 `coalesce(amount > contract_amount, false)`，不抛错（`20261119005100:109-112`）；视图同口径（`20261119006500:140-145`）；页面仅展示 warning、不禁用提交/确认（`ContractWorkCompletionSection.vue:61-66`、`:92-98`、`:210`）；真库用例 4 超 1.8 倍仍完成确认并计成本 | **通过** |
| 4 | 直接付款仍保留（付款不替代全部成本） | 付款来源只写 `payable_decrease`/资金/往来，不写 `confirmed_cost`：`services/api/src/payment/payment-operating-source.adapter.ts:120-160`；经营投影单测 `src/operating-projection/operating-projection.reducer.spec.ts:123-146` 断言“履约成本 100.0123 + 付款 25.00”仍为 100.0123、利润只受成本影响；本票未改付款入口 | **通过**（其他合同直接付款工作台提示 `unsupported` 属 PAY-09/其他票，见边界） |
| 5 | 三个职责都完成才确认 | 任一同意仅置该职责 `approvedRoleKeys`，只有第 3 个同意才 `next_status='confirmed'` 并插事实（`20261119005400:185-200`）；单测“任意顺序确认，三项齐全才写入一次四位履约事实” | **通过** |
| 6 | 任一驳回回制单 | 驳回 → 完成单 `draft`、轮次 `rejected`、不写成本事实（`20261119005400:185-205`）；真库用例 5 实测主管驳回后状态 `draft`；单测“任一职责驳回退回原草稿，项目外无法操作” | **通过** |
| 6a | 驳回后可修订、重提新轮、旧轮迟到动作无效（本轮补齐） | 新迁移 `20261119006500_contract_work_completion_revision`：放宽 origin guard 仅允许 `draft→draft` 改 `work/amountYuan`（身份字段与已确认仍不可改），新增 `jg_revise_contract_work_completion_draft_v1`（原经办人、当前生效版本、正数四位、审计前后值）；服务 `contract-work-completion.service.ts:71-108`；控制器 `PATCH :contractVersionId/work-completions/:completionId`（`contract.controller.ts:168-175`）；视图返回本轮驳回原因与 `canRevise`（`contract-work-completion-approval.service.ts:80-86`、迁移 `06500:160-162`）；页面修订弹窗与驳回原因（`ContractWorkCompletionSection.vue:57-60`、`:78-86`、`:146-179`）。真库用例 5：驳回→视图可见原因与 `canRevise`→PATCH 修订 2000.0000→2100.0000→审计留 `previousWork/previousAmountYuan`→重提生成新 `ApprovalInstance`→旧轮迟到同意 409→新轮三职责确认后仅 1 条事实（金额 2100.0000、`approvalInstanceId` 为新轮） | **通过（本轮新增）** |
| 7 | 自审/委托按全局规则 | 自审：`confirmApprovalSelfReview` + 原因/本人密码/审计元数据（`contract-work-completion-approval.service.ts:136-151`；单测 `contract-work-completion-approval.service.spec.ts`“发起人须二次确认”）；委托：服务解析 `representedUserId`（同单测）、待办与流程详情已接线（`src/me/me.service.spec.ts:15-60` 直接/被委托人/办结后消失；`src/approval/approval-progress.service.spec.ts:54-75` 流程详情与待办人），通知 outbox 同事务（`contract-work-completion-notification.service.spec.ts`） | **通过**（真库端到端委托未覆盖，见第 4 节） |
| 8 | 后续付款不重复成本 | 同第 4 行；履约成本只由本票确认写入 `OperatingFact`，付款不产生 `confirmed_cost`；`20261119006000` 限定成本来源写入口 | **通过** |
| 9 | 变更/更正可追溯；每批次只取最新已确认版本、旧版本不可改、审计可追 | 事实保存 `contractVersionId/approvalInstanceId/finalActionId` 与 `costSnapshot`，确认事实 INSERT-only 触发器拒绝覆盖（`20261119005400:41-45`、`:73-74`）；修订写 `AuditLog 'contract.work_completion.draft.revise'`（迁移 `06500:107-111`）；重提建新轮、旧轮签字不计入新事实（真库用例 5 断言旧轮 `approve`=0、新事实 `approvalInstanceId`=新轮）；确认后再 PATCH 修订 409、直接改事实被触发器拒绝（真库用例 5） | **通过（范围见边界 3）** |
| 10 | 框架未定总价不阻止真实履约确认 | `amountLimitType='unlimited'` → 合同上限为 `NULL`，只比较出 false、不阻断（`20261119005100:109-110`）；真库用例 6 用 `other + unlimited + framework` 合同（无总价）完成三职责确认，事实与成本均为 `300.0123` | **通过（本轮新增真库路径）** |

## 2. 覆盖范围

### 2.1 后端单元/接口测试

```bash
cd /tmp/jgE/services/api
npx jest \
  src/approval/approval-review-identity.spec.ts \
  src/contract/contract-work-completion.service.spec.ts \
  src/contract/contract-work-completion-approval.service.spec.ts
# 3 suites / 44 tests passed

npx jest src/contract src/approval --runInBand
# 213 suites passed / 2 skipped；3331 tests passed / 12 skipped
```

- 新增定向用例：
  - `approval-review-identity.spec.ts`：OR 节点同一人持双职责时按冻结顺序返回唯一角色；`all` 节点仍关闭、非候选人仍拒绝。
  - `contract-work-completion-approval.service.spec.ts`：财务双岗同人视图/确认/只记一次/只计一次成本；驳回后视图给原因且 `canRevise`。
  - `contract-work-completion.service.spec.ts`：修订只更新草稿内容、凭证字段与唯一固定入口一致；数据库拒绝码映射 403/404/409。
- 关联回归：`src/operating-projection/operating-projection.reducer.spec.ts`（付款不重复成本）、`src/contract/contract-work-completion-notification.service.spec.ts`（待办/驳回短信）均通过。

### 2.2 Web

```bash
cd /tmp/jgE/apps/web-admin
npx vitest run src/api/core-flow-read.api.test.ts   # 148 passed
pnpm typecheck                                      # vue-tsc --noEmit，退出 0
pnpm check:ui                                       # UI/业务语言自检通过
```

`core-flow-read.api.test.ts` 新增 `reviseWorkCompletionDraft` 的 PATCH 路径与四位金额断言。

### 2.3 真库 + 真实 HTTP

```bash
LINE_A_REQUIRE_CLEAN=1 \
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine \
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
pnpm verify:line-a-real-db:local
# 退出码 0；6/6 HTTP 用例通过；耗时 18.0s
```

运行回执（脱敏）：

```json
{"status":"candidate_http_passed_full_320_blocked","candidateSha":"a9d0890ccab858c2e89c51f2ce81e761045cac84",
 "worktreeClean":true,"migrationCount":275,"ledgerMode":"PREFIX_275_PLUS_CANDIDATE",
 "candidateApply":{"applied":28,"skipped":["20261119004200_signed_settlement_file_archive_manifest"],
 "firstApplied":"20261119003500_fund_balance_correction_controlled_round","lastApplied":"20261119007000_signed_settlement_payment_basis"},
 "fullLedgerReplay":{"status":"blocked","gate":"20261118221000_contract_legacy_guard_relation_namespace",
 "productionInstaller":".github/task12-install-295/contract-finance"}}
```

- 6 条真实路径：合同详情读取/税率补充、已签补充协议、已签结算驳回重提、
  **其他合同三职责确认（含财务双岗同人）**、**驳回→修订→重提→新轮确认（含旧轮迟到拒绝/旧版本不可改）**、
  **框架未定总价确认**。
- 本次新增迁移 `20261119006500_contract_work_completion_revision` 随候选 28 个迁移真实执行；
  首次失败为函数内 `id` 与 `RETURNS TABLE` 输出变量歧义（PostgreSQL `42702`），已限定表别名后复跑通过。
- runner 末尾 `LINE_A_SCOPE_WARNING` 仍写“4 条业务链”，是本轮新增用例前的旧文案；
  实际执行与统计为 6 条（`Tests: 6 passed, 6 total`），未跳过用例。

## 3. 显式边界（不属本票，未越界实现）

1. **历史合同补填/接管**：归 #416，本票只做当前生效其他合同的新履约登记。
2. **旧入口/旧协议退役**：归 #425；本票未删除或改写旧读取路径。
3. **确认后金额更正/反向贡献**：本票保证“确认事实不可覆盖、草稿修订与重提审计可追、每批次只取最新确认轮”；
   D07 的“退款/更正用反向贡献”通用冲减入口未在本票新增，已确认金额错误需按后续更正流程处理（新增票或并入更正机制）。
4. **合同变更后的跨版本履约列表**：事实仍按 `contractVersionId/approvalInstanceId/finalActionId` 追溯，
   但合同详情默认只展示最新生效版本的履约登记；旧版本履约不在新版本列表重复展示（避免重复计成本）。
   跨版本汇总展示属读模型增强，不改变已确认事实。
5. **缺岗语义**：三职责任一完全未配置时，提交返回 409 明确要求配置（`contract-work-completion-approval.service.ts:103`），
   未实现 D03“已配置职责先办、缺岗单独待配置”的 A06 语义；#415 公开验收为 A03/A27，未含缺岗情景。
6. **其他合同直接付款工作台**：`PaymentWorkbenchPage.vue` 对 `contractTypeKey="other"` 仍提示 `unsupported`，
   属 PAY-09/其他付款票；本票未改直接付款入口，也未用付款替代成本。

## 4. 未证部分

1. **完整 320 迁移重放**：仍被既有归档安装器前置 `20261118221000_contract_legacy_guard_relation_namespace`
   阻断（仓库内无迁移写入归档闭包/意图绑定行）；本次为 `PREFIX_275_PLUS_CANDIDATE`，
   不冒充 320 通过。
2. **委托真库端到端**：待办/流程详情/通知有单测，真库 HTTP 用例覆盖直接办理人，
   未在真库中构造“委托人凭委托办理本票职责”的完整链路。
3. **浏览器交互 E2E**：仅做 `vue-tsc`、`check:ui` 与 Web API 单测，未跑 Playwright 页面级本票流程。
4. **并发极端时序**：三职责同秒并发/最后一同意与驳回并发由 D03 状态机与数据库轮次/唯一动作约束覆盖，
   本票真库用例为顺序调用，未做并发注入。

## 5. 本轮改动清单

- 迁移：`services/api/prisma/migrations/20261119006500_contract_work_completion_revision/migration.sql`
- 审批身份：`services/api/src/approval/approval-review-identity.ts`（OR 节点双岗）
- 服务/控制器/DTO：`contract-work-completion.service.ts`、`contract-work-completion-approval.service.ts`、
  `contract.controller.ts`、`dto/contract-work-completion.dto.ts`
- 页面/API：`ContractWorkCompletionSection.vue`、`apps/web-admin/src/api/core-flow-read.api.ts`
- 测试：上述三个 API spec、`core-flow-read.api.test.ts`、`line-a-real-db.http.pg.spec.ts`

## 6. 检查命令汇总

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @jiangkong/api typecheck` | 退出 0 |
| `pnpm --filter @jiangkong/web-admin typecheck` | 退出 0 |
| `pnpm --filter @jiangkong/web-admin check:ui` | 通过 |
| 定向 API jest（3 套） | 44/44 通过 |
| `jest src/contract src/approval --runInBand` | 213 suites / 3331 tests 通过，2 suites/12 tests 既有跳过 |
| `vitest core-flow-read.api.test.ts` | 148/148 通过 |
| `verify:line-a-real-db:local` | 退出 0；6/6 真实 PG/HTTP 用例通过 |

未执行：`gh issue close`、`git push`（按任务约束保留给负责人）。
