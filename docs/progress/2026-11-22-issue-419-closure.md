# Issue #419 关单证据回执（自动及非审批待办通知与 60 秒短信催办）

- 日期：2026-11-22
- 分支：`line-f-close-419`
- 基线：`d858d4215`（`adopt-395-396-415` 当前 tip）
- 代码/测试提交：`f6d10357008b3b3d2b3f2849fb3aef9b8c61a404`
- 范围：只补关单所需证据与边界登记，未改业务代码、Schema、迁移；未 push、未 `gh issue close`、未使用真实短信供应商。

## 0. 结论

`NTF-01`～`NTF-09`、outbox 与 60 秒三项均有代码 + 可复核回执：`NTF-04` 的合同/付款最终驳回、退回修改生产者本轮补齐并新增**真实 PostgreSQL 16** 用例；`NTF-05` 已按 2026-11-19 决定统一为纯文字通用模板。**真实手机送达仍无成功记录**（唯一一次授权非生产发送为供应商受理后送达失败），不能按“受理=送达”结案；历史补填（归 #416）与其他审批类型自动短信已登记为本票边界，不在本票扩围。

**关单建议：可关，但关单评论必须同时登记第 5 节边界与第 6 节未证部分**；若验收人按 NTF-04 字面“所有可办环节”要求报销/项目支出/额度/资金执行审批也必须有短信，则应先由范围负责人确认，或另开后续票后再关。

## 1. 本轮新增（提交 `f6d10357`）

1. `services/api/src/contract/contract-duty-notification.service.spec.ts`
   新增合同 `reviewIfV2` 的 `reject` / `return_to_applicant` 两条定向接线用例：断言 `queueCorrection` 在业务事务内调用、提交后才 `afterCommit` 派发，且入队对象为 `draft` + `rejected`。
2. `services/api/src/approval/duty-correction-notification.pg.diagnostic.spec.ts`
   真实 PostgreSQL 16 用例：合同/付款退回修改短信的事务回滚不留痕、同事务重复调用只入队一次、失败可重试、未知结果不自动重发、合同重提后旧轮取消、仅原申请人可见。
3. `services/api/prisma/run-issue419-notification-local.cjs` + 根脚本 `verify:issue419-notification:local`
   一次性 `postgres:16` 容器、本机回环、随机口令；跑完即删除容器。Schema 由 `prisma db push` 依 `schema.prisma` 建立（**不是迁移重放**）。

## 2. 逐项验收表

证据分级：**R** = 本提交在 `f6d10357` 上新跑；**T** = 既有真实回执按祖先树/差量传递（未在本提交重跑）；**U** = 未证或无成功记录。

| 验收点 | 证据 | 结论 |
| --- | --- | --- |
| NTF-01 首次弹出、列表保留、点击直达、不反复弹、重开可查 | `apps/web-admin/src/app/AdminLayout.vue:85,155`；`WorkItemNotifications.vue`；`work-item-notifications.ts:28-34`（已见集合持久化）；回执 E2（真实 PG16 + 浏览器）；上述 Web 文件相对 `8d3e50a0` **无 diff** | 覆盖（T） |
| NTF-02 只在打开本系统时顶部条幅、与电脑一致 | 同一 `WorkItemNotifications.vue`；`:119-124` 移动端改为页内顶部；无 OS 推送代码；回执 E2；文件无 diff | 覆盖（T） |
| NTF-03 数字=当前本人待办、点开不减、完成/撤回减、共责一人完成他人消失、部分付款仍待办 | `me.service.ts:682-705` 由当前 pending 生成，非已读数；回执 E3（真实 PG16：部分归还仍待办、重复读不减、非受领人无待办、结清消失）；`me.service.ts` 相对 `8d3e50a0` 仅新增履约确认/委托分支，未改付款待办计数路径 | 覆盖（T；全部业务类型铃铛 UI 计数未重跑） |
| NTF-04 并联同时通知；非审批采购/填写/复核/付款/盖章/归档覆盖；逐人独立短信；草稿不发；驳回需修改发短信 | 生产者：`contract-duty-notification.service.ts:78-93,105-117`（审批/盖章/归档/退回修改）、`payment-approval-notification.service.ts:47-81,85-100`、零采 `spot-procurement-application.service.ts:679`、综合采购、结算归档、报销资金待办、资金账户、合同台账等 19 个领域通知服务（另有通用投递器 `audit-duty-notification-delivery.ts`）；接线：`contract-v2-submission.service.ts:88-96`、`payment-request.service.ts:2710,2761`；**新增**合同 reject/return 接线用例 2 条、真实 PG 纠正用例 1 条（R）；合同 279 回执 E5（两轮各 5 条审批 + 1 盖章、零派发） | 覆盖本票已交付生产者（R+T）；**“其他审批类型”见边界 B2** |
| NTF-05 纯文字模板、无链接/参数、站内链接鉴权 | `approval-sms.service.ts:13-46`（仅通用模板、`TemplateParamSet: []`）；`docs/specs/...spec.md:246`、`37-notifications.md:17,23`、`docs/runbooks/approval-progress-sms.md`、`technical-plan.md:106`、`acceptance.md:56` 已统一；`docs/progress/2026-11-22-ntf-05-sms-template-decision.md` | 覆盖（文档+代码）；Issue 正文仍是旧文案，见 B5 |
| NTF-06 默认全体/可选人、短信同时站内提示、同流程职责 60 秒共享、自动新任务不被冷却挡 | `approval-progress.service.ts:19,385-404`；`independent-approval-progress.service.ts`；`me.service.ts:2397-2464`（催办产生 `reminderId`）；回执 E1（真实 PG16+Nest HTTP：`cooldownMs=60000`、第二点击者 409、另一职责可催、自动 3 名收件人各一条、供应商禁用）；60 秒相关行相对 `8d3e50a0` 无增删 | 覆盖（T） |
| NTF-07 失败可重试、未知待确认不自动重发、受理≠送达、站内照常 | `approval-sms.service.ts:66-74`、`audit-duty-notification-delivery.ts:100-102,134`（仅 failed 可重试）；`DutySmsStatusPanel.vue`/`MultiDutySmsStatusPanel.vue` 在 18 个页面接线；回执 E4（真实 PG16：失败重试 201、同键重放不重复、`queued=1/sent=0`、`simulatedProviderCalls=2`、`externalSends=0`）；上述文件相对 `8d3e50a0` 无 diff | 覆盖（行为/T）；真实供应商重试与送达 U |
| NTF-08 办结后链接显示由谁完成、无重复办理、撤权后不得凭链接办理 | `approval-progress.service.ts:323-330,399-407`（冻结 `approverName`）；回执 E6（真实 PG16：办结同链接 200 含办理人、重复 409、撤权后 404/403、0 外发）；合同 279 回执（撤回前后同链接、项目外 404、旧审批失效）；E8 离线闭包 | 覆盖（T；`approval-progress.service.ts` 本轮新增 represented 参与者，未重跑 E6） |
| NTF-09 用户名即手机号、创建必填、换号/异常按实显示 | `organization.service.ts:266-269`（必填+格式校验）；`auth.service.ts:50`（手机号登录）、`:301-320`（改号短信验证）；`schema.prisma` `User.phone` 唯一；相关单测 | 覆盖（代码/测试）；完整换号真库链 U |
| outbox 与业务事务关联、并联收件人与非审批环节逐人一次 | 事务内写 intent：`contract-duty-notification.service.ts:78-93,105-117`、`payment-approval-notification.service.ts:47-100`、`spot-procurement-application.service.ts:663-680`、`audit-duty-notification-delivery.ts:13-75`；真实 PG：新用例（回滚后 0 条、提交后 1 条、重复调用 1 条）、E4、E5 | 覆盖（R+T） |
| 60 秒按流程/职责跨点击者共享、自动新任务不受手动冷却 | 同 NTF-06；E1 真实 PG16 证明 60000ms、第二点击者 409、另一职责可催、自动 3 人 | 覆盖（T） |
| 模拟/真实分界：模拟供应商验意图；受理与送达分别举证 | 新用例与 E1/E4 均为内存模拟发送器（`realProviderEnabled=false`/`externalSends=0`）；E7：唯一授权非生产短信供应商**受理后送达失败**，无成功送达 | 模拟覆盖；真实送达 U |

### 外部回执索引（只读引用，不复制内容）

| ID | 路径 | 绑定树/说明 |
| --- | --- | --- |
| E1 | `/private/tmp/jg419-ntf06-no-send-proof.7TiJYx/receipt.json` | `8d3e50a0`；真实 PG16+Nest HTTP；60 秒/自动与手动分离 |
| E2 | `/private/tmp/jg419-ntf0102-live.uwmJFN/receipt.json` | `8d3e50a0`；真实 PG16+浏览器；NTF-01/02 |
| E3 | `/private/tmp/jg419-principal-me-proof.4WKYU8/receipt.json` | `8d3e50a0`；真实 PG16；NTF-03 部分归还/结清/非受领人 |
| E4 | `/private/tmp/jg419-notice294-receipt.VIENpfyu/receipt.json` | `a10221c9`；真实 PG16；outbox/失败重试/零外发（余额更正 lane） |
| E5 | `/private/tmp/jg-native-contract-workbench279-WHTpry58/receipt.json`、`/private/tmp/jg-native-contract-ntf08link279-tgIO8Wmx/receipt.json` | 真实 CON-18 合同链；并联审批/盖章入队、链接鉴权 |
| E6 | `/private/tmp/jg419-a31-final-link-proof.lmjmi4/receipt.json` | `8d3e50a0`；真实 PG16；A31 办结/重复/撤权 |
| E7 | `/private/tmp/jg419-sms-proof-scope.AC5kzOhK/EXACT-295-ADDENDUM.md` | 2026-11-19 纯文字模板决定；真实发送受理后送达失败 |
| E8 | `/private/tmp/jg419-ntf08-a187dc73.rnUkcx3c/closure.json` | `a187dc73a` 离线字节闭包 |
| R | 本回执第 3 节 `ISSUE419_RECEIPT` | `f6d10357` 干净树；真实 PG16 |

## 3. 真实 PG 覆盖（新增）

命令（本机沙箱需显式引擎路径）：

```bash
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine \
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
pnpm verify:issue419-notification:local
```

`f6d10357` 干净树回执（已脱敏）：

用例自身输出：

```json
{"phase":"issue419_correction_outbox","contractQueuedAfterRollback":0,"contractQueued":1,"contractRetried":"accepted","contractUnknownResends":0,"contractResubmitCancelled":1,"paymentQueuedAfterRollback":0,"paymentQueued":1,"paymentRetried":"accepted","paymentUnknownResends":0,"externalSends":0}
```

runner 回执：

```json
{"schemaVersion":1,"purpose":"ISSUE419_NTF04_CORRECTION_OUTBOX","status":"PASSED","candidateSha":"f6d10357008b3b3d2b3f2849fb3aef9b8c61a404","worktreeClean":true,"containerImage":"postgres:16","imageId":"sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d","database":"jiangkong_issue419_correction","schemaMode":"PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA","migrationLedgerReplayed":false,"publicTables":330,"provider":"SIMULATED_IN_MEMORY","realProviderEnabled":false,"phases":[{"name":"postgres-ready","durationMs":715},{"name":"prisma-generate","durationMs":1943},{"name":"schema-db-push","durationMs":1588},{"name":"pg-correction-spec","durationMs":937}],"durationMs":5383}
```

证明范围：

- 合同 `queueCorrection` 在真实事务中写入 `AuditLog` outbox；回滚后 0 条；重复调用仍 1 条；派发后 `dispatch_claimed` + 终态可查；失败可重试至 `accepted`；未知只发 1 次且不可重试；重提后旧提醒 `cancelled`。
- 付款 `queueCorrection` 在真实事务中写入 `ApprovalActionLog` outbox；同上回滚/幂等/失败重试/未知不重发；非受领人 `status` 为 `null`。
- 全程 `externalSends=0`、发送器为内存模拟，未调用真实供应商。

边界：Schema 由 `prisma db push` 建立，**不证明迁移账/生产安装链**；无 HTTP、无 Web UI、无真实短信送达。

定向回归：

- `contract-duty-notification.service.spec.ts`：9/9（含新增 2 条接线用例）。
- `payment-approval-notification.service.spec.ts`：既有纠正用例通过（与合同 spec 合计 15/15）。
- `pnpm --filter @jiangkong/api typecheck`、`lint`：通过。

## 4. NTF-05 口径收口

2026-11-19 用户确认的纯文字通用模板已落到规格正本、任务书、技术方案、短信手册与 A30：正文无链接、无参数，只提示登录后查看待办；可点击入口只存在于登录后的站内待办并按身份鉴权。Issue #419 正文仍是发布时旧文案，关单评论需显式写明“2026-11-19 决定覆盖旧快照”。本项只有文档/代码证据，不构成送达证据。

## 5. 显式边界（不在本票实现，关单必须登记）

- **B1 历史补填短信归 #416**：`contract-takeover` 无通知 provider，`confirmContractSide`/`confirmFinanceSide` 未写 outbox；HIS-03 正式交接由 #416 承接，本票不重复实现。
- **B2 其他审批类型自动短信未覆盖**：费用报销审批（`expense-claim.service.ts:872-905` 建 `expense_claim.approve` 实例，无审批通知 hook；现有 `expense-claim-funding-notification` 只覆盖通过后的资金待办）、项目支出审批、垫资额度/结算例外额度审批、资金执行审批，均未见审批职责自动短信生产者。NTF-04 字面“所有可办环节”若包含这些流程，需另开后续票；本票不擅自扩围，也不把其静默遗漏计为已覆盖。
- **B3 真实短信送达**：无成功送达记录；唯一一次授权非生产发送为供应商受理后送达失败，且无第二次发送授权。不得把“供应商受理”写成“手机送达”。
- **B4 继承回执的绑定树**：E1/E2/E3/E4/E5/E6/E8 绑定祖先树；本轮以“文件无 diff”或“差量未触及关键路径”传递，未在 `f6d10357` 重跑。接受此传递方式的前提是关单评论明确该口径。
- **B5 Issue 正文旧口径**：NTF-05 的 Issue 正文仍是“链接末尾直达”；以 2026-11-19 决定、规格正本与任务书为准。
- **B6 不执行项**：未 push、未 `gh issue close`、未部署、未操作生产或真实数据、未使用真实短信供应商。

## 6. 未证部分

1. 真实手机送达（含重试后的送达）——U。
2. E1/E3/E5/E6 在 `f6d10357` 的原地重跑——U（仅差量/文件比对传递）。
3. 完整 320 迁移重放在本机仍被归档安装器门阻断（与 #419 无关，沿用线 A 回执）——U。
4. Web `check:ui` 未跑（本轮未改 Web 代码）——U。
5. B2 所列审批类型的自动短信——U，边界待范围确认/后续票。

## 7. 关单评论

见 `docs/progress/2026-11-22-issue-419-close-comment.md`，可直接贴到 Issue #419。该评论逐条对应 NTF 项、给出证据、登记边界与未覆盖项；**不代替人工勾选验收框，也不执行关单**。


## 2026-11-25 非生产手动催办送达补验

精确候选 `a923db0d332a2c64ca0e95e18eeb4d58d24ad511` 用回环 Nest HTTP、独占 PostgreSQL 16 和虚构审批调用手动催办。进度读取、催办、回读分别为 200、201、200，并核对一条催办记录及一次真实腾讯云调用。北京时间 23:05:41 发送，23:05:49 腾讯云回执 `DELIVRD`，收件人确认手机收到。测试角色、策略与临时数据库已清理。原始回执 `issue-419-system-sms-receipt.md` 的 SHA-256 为 `1c63bed5cfb3dbd380e635245e111d6029bc5d946e258bec10e66dea008e78a0`。

证据覆盖非生产手动催办接口至真实手机。浏览器完整操作、自动短信及正式站部署和启用仍待验收。报销、项目支出、额度和资金执行的审批自动通知由 [#430](https://github.com/1131096740/intelligent-construction-management/issues/430) 跟踪。后续上线切换包按此范围引用回执。[#426 验收记录](2026-11-25-issue-426.md)
