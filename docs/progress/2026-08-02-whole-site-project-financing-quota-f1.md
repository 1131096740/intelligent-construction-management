# 实施包 5 Task 11：项目垫资额度 F1 申请闭环

## 当前结论

本切片在 F0 权威只读工作台之上闭合 F1“申请项目垫资额度”：财务人员或财务主管可按
服务端实时能力发起，提交金额、原因、选填有效期和一份必需附件；后端冻结申请岗位、附件
SHA、幂等键与请求指纹，并在同一事务创建额度申请、精确审批生命周期和 AuditLog。F0→F1→
F2→F3 是本任务为控制风险采用的实施切片，不是锁定需求文档中的原文编号。

F1 已形成可独立提交的本地实现，但不代表“申请、审批、实际占用、终止”完整能力、Task 11、
实施包 5 或五包发布候选完成。F2 仍须改造既有审批 POST 的行锁、生命周期 CAS、动作幂等、
冻结申请岗位下的本人审批规则与双终审单赢家；F3 仍须闭合人工终止。F2/F3 完成前不得把
本切片单独部署为完整垫资额度办理能力。

本轮未连接生产，未推送、合并、部署、执行生产迁移或修改生产业务数据；未执行 retention、
业务草稿 purge、正式业务记录删除、AuditLog/checkpoint 清理、旧表旧字段删除或其他物理删除。

## RED 与最小实现

### RED

本切片先用失败测试锁定以下缺口：

- 申请 DTO 没有 UUIDv4 幂等键，同一未知结果请求无法安全重放；
- 申请岗位、附件 SHA、请求指纹没有持久快照，重放时无法证明与原请求完全相同；
- 双岗位用户、申请后升岗、项目/申请人/金额/原因/有效期/附件漂移没有稳定重放规则；
- 新申请可使用过期有效期、无效或非本人上传文件、已绑定业务文件及零采收货照片；
- 任意 Prisma `P2002` 都可能被误判为幂等竞争，掩盖文件唯一约束等真实冲突；
- 额度附件只在业务服务前查重，创建后仍可能被其他业务反向复用；
- 申请与审批实例可能出现错误 flow namespace、缺失或重复生命周期；
- Audit 写入异常缺少申请链路失败证据；
- 前端没有申请对话框、稳定上传/业务幂等键、双击单请求、结果未知重试和权威刷新；
- A→B→A 切项目、卸载或能力变化时，迟到请求可能继续提交或污染新页面；
- 页面动作未被全站治理工具识别为服务端能力支配；
- 重放回执硬编码 `approval_pending`，审批已推进后会返回陈旧生命周期状态；
- 可选有效期到期后，完全相同的历史请求曾在重放判断前被误拒。
- 日期选择器提交的 `YYYY-MM-DD` 曾按 UTC 零点解释，导致上海自然日当天 08:00 提前失效；
- 申请事由 500 字只由页面限制，直接 API 可写超长正文；申请事实可被原始 SQL 物理删除。
- 无时区的 ISO 时间戳曾可能随 Node 进程时区改变语义，造成跨环境有效期漂移。

新增 RED 分别覆盖请求坐标、金额和日期、持久岗位、附件所有权/状态/SHA/全业务独占、严格
幂等重放、审批生命周期漂移、精确 P2002 识别、Audit 异常、前端并发/切项目/权威刷新和
治理动作来源；最后三项语义缺口也先稳定得到失败结果，再做最小修正。

### GREEN：后端申请不变量

`POST /projects/:projectId/financing-quotas` 现在只接受：

1. 活跃项目；
2. 活跃用户的持久 `finance_staff` 或 `finance_director` 岗位；双岗位按锁定规则优先冻结
   `finance_director`，不信任客户端角色；
3. 大于 0 的整数分金额、trim 后非空且不超过 500 个 Unicode 字符的原因、选填且新申请时
   仍在未来的有效期；只接受 `YYYY-MM-DD` 或带 `Z`/明确偏移量的时间戳，无时区时间戳由
   DTO 和服务层双重拒绝；页面日期按上海自然日归一到所选日 `23:59:59.999`，包含当日；
4. 本人上传、仍为 active、具备小写 64 位 SHA-256 且尚未绑定任何业务的附件；
5. 小写 UUIDv4 `idempotencyKey`。

事务先锁项目，校验持久岗位，再用统一文件绑定 advisory lock 和 `FileObject FOR UPDATE`
串行化附件占用。请求指纹包含项目、申请人、冻结岗位、规范化金额/原因/有效期、附件 ID 与
SHA。首个请求在同一事务创建：

- `ProjectFinancingQuota(status=approval_pending)`；
- 唯一 `ApprovalInstance`，精确 `businessType=project_financing_quota`、
  `flowType=project_financing_quota.approve` 和“财务主管→董事长/总经理 OR-sign”冻结链；
- 一条包含金额、有效期、附件 SHA、冻结岗位、幂等键和指纹的 AuditLog。

完全相同的重放返回原 quota 坐标且零新增写；申请后升岗仍使用原 `requestedByRoleKey` 计算
指纹，不改写历史事实。项目、申请人或任一规范化载荷变化、附件 SHA 漂移、审批实例缺失/
重复/申请人/冻结节点漂移均 409 失败关闭。只有 Prisma 唯一冲突目标精确为申请幂等键时才
进入竞争赢家重读，其他 P2002 原样传播。

回执只保留 `kind/idempotencyKey/projectId/quotaId` 四项稳定申请坐标，不携带会随审批推进而
变化的 status；当前生命周期必须由随后权威 GET 读取。有效期仅限制新申请，完全相同的历史
请求即使之后过期，仍可按幂等键安全重放。

### GREEN：迁移与文件独占

新增第 115 个迁移
`20260802010000_project_financing_quota_request_idempotency`：

- 以 advisory transaction lock 和固定表锁顺序进入，相关额度/审批表使用
  `ACCESS EXCLUSIVE NOWAIT`；
- 为申请岗位、附件 SHA、幂等键和请求指纹增加 nullable 历史兼容列；
- 历史行只允许四列全 NULL，新申请必须四列全非 NULL、格式和岗位精确合法；
- 新申请触发器强制完整快照，更新触发器冻结申请事实；没有历史回填、业务 DML 或删除；
- `BEFORE DELETE` 触发器拒绝任何额度申请物理删除，终止只能追加状态和审计事实；
- 存量附件重复、跨业务绑定或 FileObject 替换链冲突先以 23514 失败关闭，不静默清洗；
- `attachmentFileId` 增加唯一索引，并在统一文件绑定注册表中由非独占提升为独占；
- 重建额度附件与终止签名两条绑定触发器，附件独占、终止签名非独占的既有语义保持清晰；
- 新增审批 namespace CHECK 和每个额度唯一生命周期部分索引。

由于物理删除没有授权，历史普通 `attachmentFileId` 索引仍保留，没有借本迁移删除冗余索引。
六个本地并发 runner 及其静态测试同步迁移总数、终点迁移和受新约束影响的兼容夹具；未在
本轮启动数据库执行它们。

### GREEN：前端申请闭环

项目经营页在 F0 面板内新增 TDesign 申请对话框，只消费服务端 `requestAction`，不从登录用户
猜角色。页面通过 `apps/web-admin/src/api/project-financing-quota.api.ts`，不直接 `fetch`：

1. fresh GET 复核项目与申请能力；
2. 用同一稳定 UUIDv4 作为文件和业务幂等键上传一份附件；
3. 再次 fresh GET，确保上传期间能力没有漂移；
4. POST 额度申请；
5. 权威 GET，并按 quotaId 确认申请已进入台账。

同一尝试双击共享一个 promise；网络结果未知时复用原幂等键和已上传 fileId，不重复上传；
切项目、卸载、取消和迟到 resolve/reject 均由请求 owner 失效机制隔离。权威台账允许目标额度
已推进到 approved/rejected/terminated，不能把“提交后审批很快推进”误判为申请失败。
两次 fresh 检查均精确要求动作 key、enabled、requiresFile 和
`requiredAction=project.financing_quota.request`，namespace 漂移时在 POST 前失败关闭。

capability-only GET 保持治理工具需要的透明主响应来源；面板在进入写链前内联校验项目、动作
键、enabled、requiresFile 和 requiredAction，并把损坏 JSON/异常结构转为受控中文错误。

## 权限、审计与独立复核

- Controller 仍使用 `@RequireProjectAction("project.financing_quota.request")`；PermissionGuard
  以 path 项目坐标和数据库岗位授权，服务层再次校验项目、用户和持久岗位；
- 财务人员和财务主管可发起，项目经理不进入申请或审批链；
- F1 只创建冻结审批生命周期，不执行审批、签名或终止，不提前混入 F2/F3；
- 额度只在实际付款与唯一有效凭证同事务落库时占用；申请和审批通过都不预占额度；
- 申请、审批实例和 Audit 同事务，单元测试证明 Audit 异常向外传播；真实 PostgreSQL 全事务
  回滚证据仍列在下方未执行门禁中；
- 三轮只读复核发现的反向文件复用、零采照片漏查、P2002 误分类、高级状态重放、过期重放和
  页面能力逃逸均已修正；冻结后的源码终审 P0=0、P1=0。

## 测试与静态门禁

当前精确 diff 已通过：

- F1 申请服务：35/35；
- F1 服务/Schema/统一文件绑定聚焦：4 套，49/49；
- 既有项目服务回归：74/74；
- F1 Web 聚焦：5 文件，156/156；
- API 全量：293 套中 274 套通过、19 套条件跳过，5438 项通过、51 项跳过，0 失败；
- Web 全量：157 文件，1594/1594；
- API/Web typecheck、lint、production build：通过；
- Web `check:ui`：通过；
- API 业务英文错误检查：401 个生产 TypeScript 文件通过，54 处允许的内部英文哨兵；
- Prisma format/validate/generate：使用不建立连接的本机占位 URL 通过；
- 六个受迁移总数影响的 CJS runner `node --check`：通过；
- `git diff --check`：通过。

API 全量运行中的 fontconfig cache 告警来自本机没有可写字体缓存；Jest 最终回执明确 0 失败，
不把该环境告警当作业务测试失败。

## 治理清单

五份清单按依赖顺序重生成：

- Nest 路由：396，ready；
- Web API wrappers：383，main request bindings：399；
- 页面动作：52，既有 blockers：296；
- `project-financing-quota.request` 为
  `serverDerived=true/dominatesTrigger=true`；其 fresh GET、`POST /files` 和申请 POST 三条
  binding 均 `accepted/causalVerified=true`，本动作相关 blocker 为空；
- request POST 已由 `unclassified/none` 变为 `page/web_api_wrapper`；route usage 只余 2 条
  未分类路由，精确为后续 F2 审批和 F3 终止；
- capability matrix 仍为 blocked，396 条路由、318 个存量 blocker，没有把 F1 外推为完整
  审批或终止覆盖。

`route-usage.registry.json` 只吸收 F1 request POST 带来的 page/wrapper 各 +1、unclassified/none
各 -1；F0 已保留的两项历史期望差异继续保留，没有通过修改期望值掩盖既有全站债务。

## 未执行的运行时证据

本轮没有获得“项目垫资额度 F1”专用 Docker/PostgreSQL 或 preview 授权，因此没有启动本地
容器、没有连接任何数据库，也没有执行 Chromium/WebKit。用户此前对
`spot-procurement.review-approve` 的一次性 PostgreSQL 16 授权只适用于零采动作，已完成并
清理，不能外推到本切片。

F1 在发布门前仍缺：

1. PostgreSQL 16 空库完整应用 115 个迁移、第二次 deploy 零待办和终点迁移核对；
2. 历史全 NULL 兼容、重复/跨业务文件冲突、替换链冲突及无冲突升级迁移；
3. 两个真实 backend 同 key 并发的单赢家、反向文件复用硬阻断；
4. Audit 中段注入故障后的 quota、ApprovalInstance、Audit 全部零写；
5. Chromium/WebKit 桌面与移动端的申请、双击、能力漂移、未知结果重试和权威刷新。

这些缺失证据必须明确披露；不能用 mock/static 测试替代，也不能据此宣称 F1 已达到可部署
发布门。

## 下一步

下一切片严格进入 F2 审批：先为冻结申请岗位下的本人审批规则、历史
`requestedByRoleKey=null` 兼容策略、额度/审批行锁、lifecycle token CAS、actionId 幂等、
财务主管节点与董事长/总经理 OR-sign 单赢家、签名快照和失败零 ActionLog/Audit 建立 RED，
再补服务与页面。F2 独立提交后才进入 F3 人工终止；F2/F3 和上述运行时门禁闭合前，不得把
本 F1 视为 Task 11、实施包 5 或五包完成。
