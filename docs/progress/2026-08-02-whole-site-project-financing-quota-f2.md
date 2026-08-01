# 实施包 5 Task 11：项目垫资额度 F2 审批闭环

## 当前结论

本切片在 F0 权威只读工作台和 F1 申请闭环之上，闭合 F2“审批项目垫资额度”的纯本机
实现：页面只按服务端实时审批能力展示通过/驳回入口，写入前使用专用
`GET /projects/:projectId/financing-quotas/:quotaId/review-capability` 复核单一额度；审批 POST
以 `actionId` 和权威生命周期令牌冻结本次尝试，在 Serializable 事务内按固定顺序锁定项目、
额度和审批实例，完成当前密码确认、持久岗位与冻结节点复核、签名快照、双实体 CAS、
ActionLog 和 AuditLog。

F0→F1→F2→F3 是本任务为控制风险采用的实施切片，不是锁定需求文档中的原文编号。
本文件只记录 F2 本地闭环，**不代表 F3 人工终止、Task 11、实施包 5 或五包发布候选完成**。
F3 闭合以及本文件列出的运行时门禁完成前，不得把 F2 单独部署或表述为项目垫资额度完整
办理能力。

本轮未连接生产，未推送、合并、部署、执行生产迁移或修改生产业务数据；未执行 retention、
业务记录清理、AuditLog/checkpoint 清理、旧表旧字段删除或其他物理删除。

## RED → GREEN

### RED：先锁定既有审批 POST 的失败面

F2 先用失败测试固定下列缺口，再做最小实现：

- 既有审批 POST 没有 `actionId`，网络结果未知时无法证明是同一动作重放；
- 客户端没有提交生命周期令牌，额度事实、冻结审批链或当前节点漂移后仍可能继续写入；
- 当前密码确认发生在业务事务之外，且审批链没有证明原始密码字符串被原样交给密码校验；
- 额度和审批实例只做普通读取/更新，没有固定锁序、Serializable 冲突映射和双实体 CAS；
- 申请后升为财务主管的本人，或历史 `requestedByRoleKey=null` 的本人，可能借当前岗位绕过
  F1 冻结的申请岗位；
- 重复/缺失审批生命周期、申请人漂移、冻结节点/角色漂移和终态事实不一致没有统一失败关闭；
- 财务主管节点与董事长/总经理 OR 签节点缺少双请求单赢家约束；
- approve/reject 虽有既有签名路径，但没有与 `actionId`、生命周期令牌、CAS 和 Audit 的同事务
  原子性一起锁定；
- 前端仍缺专用单对象审批能力端点、通过/驳回确认窗、同一尝试单 promise、未知结果重试和
  权威刷新；
- 旧 `core-flow-read.api.ts` 审批 transport 没有真实页面消费者，审批 POST 仍是孤儿/未分类
  路由。
- 首轮前端 GREEN 后，底层 preflight 仍以 test-only export 形成孤儿 wrapper，审批意见的
  `maxlength` 按 UTF-16 码元而非后端 Unicode code point 计数，成功回执也未拒绝额外字段。

### GREEN：专用审批能力与失败关闭

新增只读专用端点
`GET /projects/:projectId/financing-quotas/:quotaId/review-capability`，并继续由
`project.financing_quota.approve` 项目动作守卫保护。服务端从权威项目额度工作台中只取一个
目标，零条返回 404，多条或生命周期异常返回冲突；最小响应只包含
`projectId/quotaId/status/lifecycleToken/reviewAction`。前端对这五项和完整动作 namespace 做
严格运行时解析，错项目、错额度、损坏 JSON、异常 200 或多余/缺失字段均不能打开审批窗。

权威工作台不从当前登录信息猜审批资格，而是同时复核：

1. 额度仍为 `approval_pending`，且唯一审批实例仍为 `in_progress`；
2. 申请人与审批实例申请人一致，冻结链严格保持“财务主管→董事长/总经理”；
3. 第一节点仅允许冻结的 `finance_director`，第二节点是 `chairman` 与 `general_manager` 的
   `mode=any` OR 签，任一合格终审人单独通过即可结束流程；
4. 当前操作者具备持久项目/全局岗位授权并命中当前冻结节点；
5. 本人审批仅在 F1 已把 `requestedByRoleKey` 冻结为 `finance_director`、本人仍处于第 0 个
   财务主管节点且实际以 `finance_director` 命中该节点时开放，并要求独立自审说明。

因此，申请后才升任财务主管不能审批自己的申请；历史 `requestedByRoleKey=null`、冻结为
`finance_staff`、终审节点本人审批、申请人/节点/角色漂移均失败关闭。生命周期令牌绑定额度
状态、金额、原因、有效期、附件及 SHA、冻结申请人/申请岗位、更新时间，以及审批实例 ID、
申请人、状态、节点下标、冻结节点与更新时间；任一事实变化都会使旧令牌失效。

### GREEN：事务密码、签名、锁与 CAS

`POST /projects/:projectId/financing-quotas/:quotaId/approval` 现在要求：

- 小写 UUIDv4 `actionId`；
- 小写 64 位 SHA-256 `expectedLifecycleToken`；
- 精确 `approve|reject` 决定；
- 非空当前登录密码；
- 选填且不超过 500 个 Unicode 字符的审批意见；
- 仅冻结财务主管本人自审时必填、不超过 500 个 Unicode 字符的独立自审说明。

密码只用 `trim()` 判断是否为空，实际交给 `AuthService.confirmPassword` 的仍是调用方提交的
**原始字符串**，不裁剪、不改写；密码查询使用同一个 Prisma transaction client。原始密码
不会进入动作指纹、ActionLog metadata 或 AuditLog。完全相同的 actionId 重放也必须再次通过
当前密码确认。

写链使用 Serializable 事务，并以固定顺序 `FOR UPDATE` 锁定活跃项目、目标
`ProjectFinancingQuota` 和该额度的全部精确
`project_financing_quota/project_financing_quota.approve` 审批实例。事务内再次复核持久岗位、
唯一生命周期、冻结节点与生命周期令牌；之后 approve 和 reject **都必须**冻结当前有效手写
签名版本、文件 ID 与小写 SHA-256，缺签、签名文件失效或 SHA 漂移均在状态写入前失败。

额度 CAS 同时约束 `id/projectId/status/updatedAt`，审批实例 CAS 同时约束
`id/status/currentNodeIndex/updatedAt`。通过财务主管节点只推进到 OR 签终审节点；董事长或
总经理任一人终审通过后额度才进入 `approved`，驳回则额度与审批实例一起进入 `rejected`。
两个终审请求在行锁、生命周期令牌和双 CAS 下只能有一个赢家。

批准或驳回都不会写 `ProjectFundingAllocation`，也不会预占额度；额度只有在后续真实付款与
唯一有效凭证同事务落账时才发生占用。F2 不修改 F0 的自有资金优先、额度补足规则，也不
提前实现 F3 终止。

### GREEN：actionId 精确重放与同事务审计

`ApprovalActionLog.id` 直接使用本次 UUIDv4 `actionId`。非敏感请求指纹绑定 actionId、项目、
额度、操作者、原生命周期令牌、决定、规范化审批意见和自审说明；既有动作还必须匹配审批
实例、操作者、决定、三项签名快照及完整 metadata。完全相同的已落库动作返回只含
`kind/actionId/projectId/quotaId` 的稳定回执，额度和审批生命周期即使已经继续推进也零新增写；
复用 actionId 但项目、额度、操作者、决定、令牌、意见、自审说明、审批实例或签名事实任一
不一致均 409 失败关闭。

额度 CAS、审批实例 CAS、签名 ActionLog 与 AuditLog 位于同一事务；CAS 失败时不写日志，
Audit 异常向外传播并要求整条事务回滚。Prisma Serializable `P2034`、直接 SQLSTATE
`40001/40P01`，以及 raw SQL 经 Prisma 包装为 `P2010` 且 `meta.code` 为 `40001` 或 `40P01`
时，都稳定映射为可重试的 409 并发冲突；只有精确 ActionLog 主键冲突才映射为 actionId 冲突，
其他唯一约束错误不被吞掉。

## 前端审批闭环

项目经营页只在 `reviewAction` 精确满足
`key=review_financing_quota`、`enabled=true`、
`requiredAction=project.financing_quota.approve`、`requiresPassword=true` 时展示“通过/驳回”。
若服务端要求本人独立复核，页面同时显示必填说明；两种决定都使用 TDesign 二次确认窗并要求
当前登录密码，界面明确提示审批通过不会占用额度。

一次写尝试冻结项目、额度、决定、UUIDv4 actionId、生命周期令牌、自审要求和原始密码；
标准顺序为：

1. 专用 capability GET，精确复核当前动作、对象、自审要求与生命周期令牌；
2. POST 审批，提交冻结的 actionId 和 `expectedLifecycleToken`；
3. 权威 GET 完整额度工作台，确认目标仍唯一且生命周期令牌已经变化，随后才向父页面发布。

同一窗口双击共享一个 promise。网络断开、5xx 或响应损坏造成 POST 结果未知时，保留原提交
事实并以**同一个 actionId 和生命周期令牌**重试，不另造动作；若已收到持久回执但权威 GET
失败，下一次只重试权威 GET。确定性 4xx 会清空尝试并重新 preflight，允许用户更正密码；
令牌漂移后不会用旧尝试再次 POST。切项目、关闭窗口、组件卸载及迟到 resolve/reject 均由
项目 generation、窗口序号、操作序号和 context owner 隔离，不能污染新页面。

旧 `core-flow-read.api.ts` 中无消费者的审批 transport 已移除，页面只通过
`apps/web-admin/src/api/project-financing-quota.api.ts` 的专用 wrapper 写入，不直接 `fetch`。
底层 preflight 保持模块私有，测试也改由真实 canonical executor 进入；前端 API 与页面提交
捕获均按 `Array.from(text).length` 执行 500 个 Unicode 字符边界，允许 500 个补充平面字符并
拒绝第 501 个，审批 textarea 不再用 UTF-16 `maxlength` 提前误拒。成功回执严格只接受
`kind/actionId/projectId/quotaId` 四个键，额外字段同样失败关闭。

## Schema、迁移与数据边界

F2 **没有 Prisma Schema、迁移或数据库结构变更**，复用 F1 已建立的额度申请快照、唯一审批
生命周期和现有 `ApprovalActionLog` 主键。仓库迁移数仍为 **115**，终点仍是
`20260802010000_project_financing_quota_request_idempotency`；本切片没有创建第 116 个迁移，
也没有执行现有迁移、历史回填、业务 DML 或删除。

## 测试与静态门禁

RED 用例已覆盖并驱动上述 GREEN 行为；冻结 diff 的本机精确回执为：

- F2 审批服务聚焦：16/16；
- 额度工作台、专用 capability、Controller、Auth 与既有项目服务回归：5 套，255/255；
- F2 Web API、面板与结构治理聚焦：3 文件，59/59；
- API 全量：275 套通过、19 套条件跳过，5463 项通过、51 项跳过、0 失败；
- Web 全量：157 文件，1625/1625；
- API/Web typecheck、lint、production build：通过；
- Web `check:ui`：通过；API 业务英文错误检查：扫描 401 个生产 TypeScript 文件，精确允许
  54 处内部英文哨兵；
- Prisma validate/generate：使用不建立连接的本机占位 URL 通过，Client 已重新生成；F2 没有
  Schema diff，未借格式化命令改写 Schema；
- 五份治理清单普通 `--check` 通过；六个治理测试文件共 203/203；`git diff --check` 通过。

后端冻结源码复核为 P0=0、P1=0；前端终审先发现并推动关闭孤儿 wrapper、Unicode 边界和回执
exact-key 三项，修复后复核为 P0=0、P1=0、P2=0。

上述“通过”只证明单元、静态和构建门禁，不替代下文仍未获得授权的真实 PostgreSQL 与浏览器
运行时门禁。

## 治理清单

五份清单按依赖顺序重生成并通过普通一致性检查：

- Nest 路由：397，ready；
- Web API wrappers：384，main request bindings：402；
- 页面动作：54，既有 blockers：296；新增
  `project-financing-quota.review-approve` 与 `project-financing-quota.review-reject`；
- 两个动作都由服务端 `reviewAction` 支配，均为
  `serverDerived=true/dominatesTrigger=true`；专用 capability GET、审批 POST 与权威工作台 GET
  三段 binding 均为 `accepted/causalVerified=true`，本动作相关 blocker 为 0；
- 审批 POST 已由 `unclassified/none` 收口为 `page/web_api_wrapper`；route usage 现在只余 1 条
  未分类路由，精确为后续 F3
  `POST /projects/:projectId/financing-quotas/:quotaId/termination`；
- capability matrix 保持 blocked：397 条路由、316 个存量 blocker，没有用 F2 局部覆盖掩盖
  全站历史债务。

`--require-ready` 仍应因全站存量债务和 F3 未分类路由失败关闭；本切片只把 F2 两个写动作及其
真实页面消费者收口，不把普通 `--check` 外推为整站 ready。

## 未执行的运行时证据

本切片没有获得项目垫资额度 F2 专用 PostgreSQL/Docker 或浏览器 preview 授权，因此没有启动
本地数据库容器、没有执行真实双 backend 并发，也没有运行 Chromium/WebKit/移动端。本轮
未连接生产，更没有用生产环境补测试证据。F1 或零采动作曾获得的其他限定授权不能外推到 F2。

F2 在发布门前仍缺：

1. PostgreSQL 16 空库完整应用现有 115 个迁移、第二次 deploy 零待办和终点迁移核对；
2. 两个真实 backend 对同一财务主管节点、OR 签终审节点和同一 actionId 的并发单赢家；
3. raw SQL `P2010/40001`、`P2010/40P01` 的真实冲突路径，以及 actionId 精确重放；
4. Audit 中段注入故障后额度、审批实例、ActionLog 与 AuditLog 全事务回滚；
5. Chromium/WebKit 桌面与移动端的能力漂移、通过/驳回、本人自审、双击、未知结果同
   actionId 重试、权威 GET 失败续读和切项目/卸载隔离。

这些缺失证据必须明确披露；mock、单元测试和静态检查不能替代真实 PostgreSQL/浏览器门禁，
也不能据此宣称 F2 已达到可部署发布门。

## 下一步

下一切片严格进入 **F3 人工终止**：为已批准额度的终止资格、剩余额度/历史占用保护、密码与
签名、生命周期令牌、actionId 幂等、锁/CAS、同事务 Audit、前端专用 capability 与未知结果
重试建立 RED，再做最小 GREEN。F3 独立闭合及上述运行时门禁完成前，不得把 F2 外推为
Task 11、实施包 5 或五包完成。
