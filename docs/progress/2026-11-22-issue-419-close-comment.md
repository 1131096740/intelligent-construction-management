## #419 验收结论：可关闭（附边界与未覆盖项）

- 复核基线：`d858d4215`（`adopt-395-396-415` tip）；本票证据提交：`f6d10357008b3b3d2b3f2849fb3aef9b8c61a404`
- 完整回执：[docs/progress/2026-11-22-issue-419-closure.md](docs/progress/2026-11-22-issue-419-closure.md)
- 口径说明：本评论按 2026-11-19 用户确认的“纯文字通用模板、正文无链接/无参数、站内链接鉴权”判定 NTF-05；Issue 发布时的旧文案已被该决定覆盖。

### 逐项对应

- [x] **NTF-01** 首次弹出、列表保留未办、点击直达、不反复弹、重开可查：`AdminLayout.vue` + `WorkItemNotifications.vue` + `work-item-notifications.ts`（已见集合持久化）；真实 PG16+浏览器回执 `/private/tmp/jg419-ntf0102-live.uwmJFN/receipt.json`；相关 Web 文件相对回执树无 diff。
- [x] **NTF-02** 只在打开本系统时顶部条幅、与电脑一致：同一组件 `@media (max-width:720px)` 页内顶部；无关闭网页后的 OS 推送；同一回执。
- [x] **NTF-03** 铃铛数为当前本人待办、点开不减、完成/撤回/不再属于本人时减、共责一人完成他人消失、部分付款仍待办：`me.service.ts` 由当前 pending 生成；真实 PG16 回执 `/private/tmp/jg419-principal-me-proof.4WKYU8/receipt.json`（部分归还仍待办、重复读不减、非受领人无待办、结清消失）。
- [x] **NTF-04** 并联同时通知、非审批环节覆盖、逐人独立短信、草稿不发、驳回需修改发短信：合同/付款最终驳回与退回修改的生产者已在本分支补齐（`contract-duty-notification.service.ts`、`payment-approval-notification.service.ts` 的 `queueCorrection`，分别由 `contract-v2-submission.service.ts:88-96`、`payment-request.service.ts:2710,2761` 在业务事务内调用）；本轮新增合同 reject/return 接线用例 2 条 + 合同/付款退回修改的真实 PG16 用例 1 条（回滚不留痕、逐次幂等、失败可重试、未知不重发、重提后取消）。既有并联/盖章/归档回执：合同 279 两轮各 5 条审批 + 1 条盖章、零派发；综合采购、零采、结算归档、报销资金待办、资金账户、合同台账等均有对应通知服务。**其他审批类型见边界 B2。**
- [x] **NTF-05** 纯文字模板、正文无链接/参数、登录后按权限看详情：`approval-sms.service.ts` 仅用通用模板且 `TemplateParamSet: []`；规格正本 `docs/specs/2026-11-05-enterprise-simplification-spec.md:246`、任务书、技术方案 D09、短信手册、A30 已统一；口径收口回执 `docs/progress/2026-11-22-ntf-05-sms-template-decision.md`。
- [x] **NTF-06** 默认全体/可选人、短信同时站内提示、同流程职责 60 秒共享、自动新任务不被手动冷却挡：`approval-progress.service.ts` 的 `COOLDOWN_MS=60_000` 与职责级 `dutyIndexes` 共享；真实 PG16+Nest HTTP 回执 `/private/tmp/jg419-ntf06-no-send-proof.7TiJYx/receipt.json`（`cooldownMs=60000`、第二点击者 409、另一职责可催、自动 3 名收件人各一条、供应商禁用）；相关代码行相对回执树无增删。
- [x] **NTF-07** 失败可重试、未知待确认不自动重发、受理≠送达、站内照常：`approval-sms.service.ts` 区分 failed/unknown；`audit-duty-notification-delivery.ts` 仅 failed 可重试；`DutySmsStatusPanel`/`MultiDutySmsStatusPanel` 已在 18 个页面接线；真实 PG16 回执 `/private/tmp/jg419-notice294-receipt.VIENpfyu/receipt.json`（失败重试 201、同键重放不重复、`queued=1/sent=0`、`simulatedProviderCalls=2`、`externalSends=0`）。
- [x] **NTF-08** 办结后链接显示由谁完成、无重复办理、撤权后不得凭链接办理：`approval-progress.service.ts` 输出办结职责的冻结办理人；真实 PG16 回执 `/private/tmp/jg419-a31-final-link-proof.lmjmi4/receipt.json`（办结同链接 200 含办理人、重复 409、撤权后 404/403、0 外发）＋合同 279 链接回执（撤回前后同链接、项目外 404、旧审批失效）。
- [x] **NTF-09** 用户名即手机号、创建必填、换号/异常按实显示：`organization.service.ts` 创建必填并校验格式，`auth.service.ts` 手机号登录与改号短信验证，`User.phone` 唯一；相关单测覆盖。完整换号真库链未重跑。
- [x] **outbox 与业务事务关联、全部并联收件人与非审批环节逐人一次**：事务内写 intent 的生产者见上；本轮真实 PG16 用例证明退回修改场景回滚 0 条、提交 1 条、重复调用仍 1 条；既有余额更正回执（同事务、回滚、`queued=1/sent=0`）与合同 279 回执。
- [x] **60 秒按流程/职责跨点击者共享、自动新任务不受手动冷却**：同 NTF-06 回执。
- [x] **先以模拟供应商验收发送意图，受理与送达分别举证**：本轮与既有回执均为内存模拟发送器、`externalSends=0`；真实侧唯一一次授权非生产发送为**供应商受理后送达失败**，无成功送达记录。

### 显式边界（不在本票实现）

- **B1 历史补填（HIS-03）短信归 #416**：`contract-takeover` 当前无通知 provider，交接确认不写 outbox；由 #416 实现并以其实机回执为关闭条件。
- **B2 其他审批类型自动短信未覆盖**：费用报销审批、项目支出审批、垫资额度/结算例外额度审批、资金执行审批目前没有审批职责自动短信生产者。按字面“所有可办环节”验收时这些仍需后续票；本票不擅自扩围，也不把它们计为已覆盖。
- **B3 真实手机送达**：无成功送达，不把“供应商受理”写成“手机送达”；真实发送需另行授权。

### 未覆盖/未重跑

- 真实手机送达（含重试后的送达）未证。
- E1/E3/E5/E6 等既有真实回执绑定祖先树，本票按“文件无 diff / 差量未触及关键路径”传递，未在 `f6d10357` 原地重跑。
- 完整 320 迁移重放仍被既有归档安装器门阻断（与 #419 无关，沿用线 A 回执）。
- Web `check:ui` 未跑（本票未改 Web 代码）。

### 复核命令

```bash
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine \
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
pnpm verify:issue419-notification:local
```

真实 PG16 的一次性容器运行结果：`PASSED`，`externalSends=0`，合同/付款退回修改均“回滚 0 条、提交 1 条、失败可重试、未知不重发、重提后取消”。

> 本评论由收尾代理起草，未执行 `gh issue close`；验收框由验收人按实际确认后勾选。
