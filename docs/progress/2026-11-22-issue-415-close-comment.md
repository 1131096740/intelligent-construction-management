## #415 关单说明：其他合同履约金额三职责确认

- 验证代码 SHA：`a9d0890cc`（分支 `line-e-close-415`；基线 `d858d4215` = `adopt-395-396-415` 最新 tip，已核为祖先）
- 详细回执：`docs/progress/2026-11-22-issue-415-closure.md`
- 未执行：`gh issue close`、`git push`（待负责人操作）

### 验收逐条

- [x] **OPS-16：合同详情明显的登记已完成工作入口，填工作与金额**
  - 入口：`apps/web-admin/src/pages/contracts/ContractDetailPage.vue:129` → `ContractWorkCompletionSection.vue`；表单做四位小数与正数校验，保存草稿。
  - 后端唯一固定入口：`POST /contracts/:versionId/work-completion-drafts`（`contract.controller.ts:168-175`）→ `jg_create_contract_work_completion_draft_v1`（`20261119005100`）。
  - 证据：真库 HTTP 用例 4 实建草稿 `18000.0123`；页面测试见 `core-flow-read.api.test.ts`。

- [x] **合同主管、项目经理、财务并联确认，均完成后计成本**
  - 提交时冻结三职责（`contract-work-completion-approval.service.ts:21-25`、`:98-106`）；事实触发器要求 3 条 `approve`、nodeIndex 0/1/2、角色匹配且无 `reject`（`20261119005400:59-68`）。
  - 证据：真库用例 4 三职责确认后 `ContractWorkCompletionFact` 1 条、`OperatingFact` `18000.0123`、`confirmed_cost` 1 条、审批审计 3 条；单测覆盖乱序确认、第三次才写一次四位事实。

- [x] **财务同一人兼任两岗不卡死、不重复计成本（本轮补齐）**
  - OR 节点解析按冻结 `roleKeys` 顺序取唯一签署角色（`approval-review-identity.ts:171-176`），视图/确认调用点补 `mode`（`contract-work-completion-approval.service.ts:75`、`:137`）。
  - 证据：身份单测 + 审批服务单测（双岗只落一次 `finance_staff`、三项齐全只计一次成本）；真库用例 4 把 `finance` 同时配到 `finance_staff`/`finance_director`，断言该轮 `approve` 恰 3 条、nodeIndex 2 恰 1 条且 `approvedRoleKey='finance_staff'`。

- [x] **超合同金额提示不自动拦截，直接付款仍保留**
  - 草稿/视图只计算 `exceedsContractAmount` 并提示，不抛错、不禁用提交/确认（`20261119005100:109-112`、`06500:140-145`、`ContractWorkCompletionSection.vue:61-66`）；真库用例 4 超 1.8 倍仍完成确认并计成本。
  - 付款只写 `payable_decrease`/资金/往来，不写 `confirmed_cost`（`payment-operating-source.adapter.ts:120-160`）；投影单测 `operating-projection.reducer.spec.ts:123-146` 断言付款不改变成本或利润。

- [x] **三个职责都完成才确认；任一驳回回制单**
  - 第 3 个同意才置 `confirmed` 并插事实（`20261119005400:185-200`）；任一驳回 → `draft`、轮次 `rejected`、不写成本事实（`20261119005400:185-205`）。
  - 证据：真库用例 5 驳回后状态 `draft`；单测“任一职责驳回退回原草稿，项目外无法操作”。

- [x] **驳回后可修订、重提新轮、旧轮动作无效（本轮补齐）**
  - 新迁移 `20261119006500_contract_work_completion_revision`：仅 `draft→draft` 允许改 `work/amountYuan`，身份字段与已确认仍不可改；新增 `jg_revise_contract_work_completion_draft_v1`（原经办人、当前生效版本、四位正数、审计前后值）；新增 `PATCH /contracts/:versionId/work-completions/:completionId`；视图返回本轮驳回原因与 `canRevise`，页面提供修订弹窗与原因提示。
  - 证据：真库用例 5 驳回→可见原因→PATCH `2000.0000→2100.0000`→审计含 `previousWork/previousAmountYuan`→重提生成新 `ApprovalInstance`→旧轮迟到同意 409→新轮确认后仅 1 条事实（金额 2100.0000、`approvalInstanceId` 为新轮）。

- [x] **自审/委托按全局规则**
  - 自审：原因 + 本人密码 + 审计元数据（`contract-work-completion-approval.service.ts:136-151`，单测覆盖）。
  - 委托：服务解析 `representedUserId`；待办/流程详情/通知已接线（`me.service.spec.ts:15-60`、`approval-progress.service.spec.ts:54-75`、`contract-work-completion-notification.service.spec.ts`）。

- [x] **后续付款不重复成本**
  - 履约成本只由本票确认写入；付款不产生 `confirmed_cost`；成本来源写入口受限（`20261119006000`）。真库用例 4/5/6 均只产生 1 条成本事实。

- [x] **变更/更正可追溯：每批次只取最新已确认版本、旧版本不可改、审计可追**
  - 事实保存 `contractVersionId/approvalInstanceId/finalActionId` 与 `costSnapshot`；确认事实 INSERT-only（`20261119005400:41-45`、`:73-74`）；修订写 `AuditLog 'contract.work_completion.draft.revise'`。
  - 证据：真库用例 5 断言旧轮 `approve`=0、新事实引用新轮；确认后再 PATCH 409；直接改已确认事实被触发器拒绝。

- [x] **框架未定总价不阻止真实履约确认**
  - `unlimited` → 合同上限 `NULL`，只提示不阻断（`20261119005100:109-110`）。
  - 证据：真库用例 6 用 `other + unlimited + framework` 合同完成三职责确认，事实与成本均为 `300.0123`。

### 验证命令与结果

```bash
pnpm --filter @jiangkong/api typecheck                       # 0
pnpm --filter @jiangkong/web-admin typecheck                 # 0
pnpm --filter @jiangkong/web-admin check:ui                  # 通过
cd services/api && npx jest <三个定向 spec>                   # 44/44
cd services/api && npx jest src/contract src/approval --runInBand
# 213 suites / 3331 tests 通过；2 suites/12 tests 既有跳过
cd apps/web-admin && npx vitest run src/api/core-flow-read.api.test.ts   # 148/148
LINE_A_REQUIRE_CLEAN=1 ... pnpm verify:line-a-real-db:local # 退出 0，6/6 真实 PG/HTTP 用例
```

真库 runner 回执：`status=candidate_http_passed_full_320_blocked`、`worktreeClean=true`、
候选迁移 `applied=28`（含 `20261119006500`）、`PREFIX_275_PLUS_CANDIDATE`。
runner 末尾 `LINE_A_SCOPE_WARNING` 的“4 条业务链”是新增用例前的旧文案，实际 `6 passed`。

### 明确边界（不在本票，未越界实现）

1. 历史合同补填/接管 → #416。
2. 旧协议/旧入口退役 → #425。
3. 确认后金额更正的反向/冲减贡献（D07 通用更正机制）未在本票新增；本票保证确认事实不可覆盖、修订审计可追。
4. 合同变更后的跨版本履约汇总展示未改；事实仍按版本/轮次/动作追溯，旧版本履约不在新版本重复计数。
5. 缺岗语义（D03“已配置职责先办”）：三职责任一完全未配置时提交明确 409 要求配置；#415 公开验收为 A03/A27，未含缺岗情景。
6. 其他合同直接付款工作台对 `other` 仍提示 `unsupported`，属 PAY-09/其他付款票。

### 未覆盖

1. 完整 320 迁移重放（既有归档安装器前置阻断，未冒充通过）。
2. 委托真库端到端（单测覆盖待办/流程详情；真库覆盖直接办理人）。
3. 浏览器页面级 E2E（仅 `vue-tsc`、`check:ui` 与 Web API 单测）。
4. 三职责并发注入（状态机/唯一动作约束已覆盖，真库用例为顺序调用）。

### 结论

**可关单，附上述边界。** 本轮补齐了财务双岗同人与驳回后修订，并补了单元/Web/真库回归；
确认后的反向更正、缺岗语义与跨版本展示不属于本票已实现范围，已在上方列明。
