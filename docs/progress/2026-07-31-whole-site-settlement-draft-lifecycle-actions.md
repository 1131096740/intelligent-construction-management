# 实施包 5 Task 11：结算草稿删除与放弃申请动作闭合

## 结论

本子任务只闭合 `settlement-draft.delete-pristine` 和
`settlement-draft.abandon-application`，不把 Task 11、实施包 5 或五包总门禁标记为
完成。

后端新增统一结算草稿生命周期分类和写边界。正式结算身份只接受草稿持久化的
`submittedSettlementId` 或 `ContractSettlementProcess` 的精确关联，不以可能重复的
项目、合同、版本或结算编号坐标猜测。历史冻结件、乙方签章件和草稿审批事实保持单调：
文件后来失效或被替代仍属于申请历史，只能填写原因“放弃申请”；真正没有历史事实的
本人草稿才提供“删除草稿”。已提交、状态异常或已形成正式结算的 shadow 草稿不再出现在
本人活动草稿台账，按 ID 读取也不返回可执行动作。

保存、提交、冻结文档、乙方签章关联、明细附件增删和放弃动作统一先锁
`SettlementDraft`。放弃与提交使用 CAS，序列化或死锁冲突统一返回 409；同一终止动作
重放幂等，不同终止动作重放拒绝。放弃只把活动签章和明细附件绑定标为
`invalidated`，保留 `FileObject`、流程、审批和审计历史；草稿状态、流程作废、文件及
附件失效和审计在同一事务内提交。创建、更新和提交分别检查正式结算编号占用，但其他
正式结算复用同一非唯一业务坐标不会冒充当前草稿的正式身份。

前端只消费独立 GET 返回的原始 `availableActions`。两个确认对话框分别由精确
`key + enabled` 支配，handler 固定发送 `delete_pristine_draft` 或
`abandon_application`，页面不直接 `fetch`。复合 API 在 POST 前再次 GET，并核对
project、draft、revision、唯一可执行动作和 `requiresComment`；POST 后再核对
draft、终态和动作。每个页面实例使用独立 `ownerScope`，同实例同指纹重复请求复用
owner，不同动作或跨重挂载请求返回 BUSY。路由 A 的合同选项、最终结算准备、能力请求及
其 resolve/reject/finally 均不能覆盖路由 B，也不能提前解除 B 的 loading 或 busy。

本轮未改 Prisma Schema 或迁移。

## RED 与修复证据

前端确定性 RED 覆盖：

1. 跨组件重挂载时，相同业务坐标会错误合并旧实例与新实例；
2. 两个页面调用缺失实例作用域；
3. 路由 A 的合同选项迟到会提前解除 B 的 loading；
4. 路由 A 的最终结算准备迟到会覆盖 B；
5. 路由 A 的 capability reject 会清空 B 的动作；
6. 重叠请求可由非 owner 提前解除 busy。

修复后使用冻结 route owner、独立 request id、组件级 `ownerScope`、operation token 和
stale 坐标检查；所有用例不依赖定时猜测。

后端 RED 覆盖：

1. 仅按草稿状态和当前活动签章判断会遗漏历史申请证据；
2. 用非唯一编号坐标判定正式身份会把无关正式结算误挂到草稿；
3. marker 漂移时可继续保存、提交或放弃；
4. 提交与放弃并发可能都基于旧状态继续；
5. 放弃只失效签章而遗留活动明细附件；
6. 正式编号占用只依赖数据库唯一错误，缺少明确业务冲突；
7. 伪造项目或非经办人调用终止接口缺少专属零副作用回归。

最终权限负向用例明确证明：伪造项目和非经办人均在业务副作用前失败，草稿、流程、
签章、附件和审计写入次数全部为零。

## 真实 PostgreSQL 并发门

一次性本机 `postgres:16` 只绑定 `127.0.0.1`，使用固定专用数据库
`jiangkong_settlement_draft_lifecycle_concurrency`：

1. 从空库顺序应用仓库全部 109 个迁移；
2. `prisma migrate status` 确认 Schema 最新；
3. 使用三个独立 Prisma 连接；
4. 第三个连接通过 `pg_blocking_pids` 证明 loser 已实际等待草稿行锁；
5. submit 先取得锁时，submit 成功、abandon 409；
6. abandon 先取得锁时，abandon 成功、submit 409；
7. 放弃后流程、签章和明细附件失效，`FileObject` 仍为 active；
8. `finally` 释放所有 pause gate、等待事务收口并删除临时容器和目录。

真实数据库用例 1/1 通过。当前活体交错集中证明 submit↔abandon 双向竞争；update、
文档和附件入口复用同一锁函数并由单元回归覆盖，后续可再增加
update↔abandon 或 document-finalize↔abandon 的活体交错作为 P2 证据增强。

## 机器事实

两项动作最终均为：

- `serverDerived=true`；
- `dominatesTrigger=true`；
- `causalVerified=true`；
- accepted production consumer 为
  `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`；
- action-specific blocker 为空；
- 复合 wrapper 顺序绑定：
  - `GET /projects/:projectId/settlement-drafts/:draftId`；
  - `POST /projects/:projectId/settlement-drafts/:draftId/abandonment`。

清单相对实现基线 `ce66833b0a0d44264b585edc4026cd4edc18a6d1` 的变化：

- Web transport wrapper：377 → 378；
- Web main binding：380 → 382；
- Web orphan wrapper：44 → 45；
- page accepted / covered production consumer：10 → 11；
- page blocker：336 → 331；
- Matrix accepted action binding：12 → 14；
- Matrix covered production mutation pair：10 → 11；
- Matrix uncovered production mutation pair：263 → 262；
- Matrix blocker仍为 377，整体继续为 `blocked`。

旧低层 `abandonSettlementDraftRecord` 仅由复合 wrapper 和单测消费，因此仍作为 orphan
明示；本轮没有借机执行后续旧 wrapper 退出或物理删除。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `77494c39bf8081c3d1f68cfc611842095672689acdc402238f7a600fd7cfd30f`
- `web-api-wrappers.json`：
  `5117a90cd380dd25feb5d0b826b58157bb3b6f488f8fe530d2a7d5711204b7e3`
- `web-page-actions.registry.json`：
  `0a5e32a7550d0132636577ee27457b119f9aa7e1350fe529298f75b80b6d822a`
- `web-page-actions.json`：
  `0ad5fd19020aefa23f667b9cc76dccc1043ce91b4a3822e250bf96e8cbcc8b29`
- `route-usage.json`：
  `2cfcb5308241e6da2e2be89591f77c46d6374c7ce86ca74e310e3661824935d3`
- `whole-site-capability-matrix.json`：
  `726632780ff9d40ef504c2d54e044931f5d81b9dc4a1ca3600b1c8c418ecfb26`
- `whole-site-capability-matrix.md`：
  `eb872b4f00ef9cedf7131a93a04dcc9ca39913fcac5812e18bbbcfaf9b71a2e6`

## 验证

- 结算模块回归：29 套、564/564；
- 数据库 runner 静态门：2 项通过，活体数据库用例默认条件跳过 1 项；
- 真实 PostgreSQL 16 空库：109 个迁移、submit↔abandon 双赢家顺序 1/1；
- Web 全量 Vitest：141 文件、1360/1360；
- Web 生命周期目标 Vitest：3 文件、44/44；
- page-action + capability-matrix analyzer：109/109；
- API/Web typecheck：通过；
- API/Web lint：通过；
- API/Web production build：通过，Web 仅保留既有大 chunk warning；
- Web `check:ui`：通过；
- API `check:business-errors`：通过；
- Prisma validate/generate：通过；
- Nest、Web API、page action、route usage、capability matrix 按顺序重生成并
  `--check` 通过；
- `git diff --check`：通过。

## 剩余风险、未授权与下一步

`PaymentRequest(settlementId)` 和
`ApprovalInstance(businessType, businessId)` 当前没有匹配索引。读取台账可能扫描正式
下游表；写锁内已跳过付款和正式审批的补充文案扫描，但仍会查询草稿审批历史。它不改变
本次正确性，作为 P2 独立索引迁移进入后续 Schema 门，不能在本切片静默新增迁移。

当前全站仍有 36 个 unresolved action binding、262 个 uncovered production mutation
pair、45 个 orphan wrapper、4 组重复 mutation route、1 条 Web 请求无 Nest route 和
26 条未分类路由；能力矩阵必须继续保持 `blocked`。

下一最小切片是 `spot-procurement.review-approve` /
`spot-procurement.review-reject`。该切片必须增加预期审批实例/节点 CAS，避免同一账号
兼任两个岗位时，重复 approve 串行跨过两个审批节点；不能只做前端清单消红。

本地未 push、合并、部署、执行生产迁移或修改生产业务数据。生产 temporary-only
retention 的单独授权与本地 Task 11 改造保持隔离；业务草稿 purge、正式业务记录、
AuditLog、checkpoint、旧表旧字段和物理删除继续关闭。
