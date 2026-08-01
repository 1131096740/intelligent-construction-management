# 实施包 5 Task 11：项目垫资额度 F3 人工终止闭环

## 当前结论

本切片在 F0 权威只读工作台、F1 申请和 F2 审批闭环之上，完成 F3“人工终止已批准
项目垫资额度”的本地代码、Schema、迁移、单元测试、前端动作和治理清单收口。只有持久化
`finance_director` 可以终止仍具完整已批准审批生命周期的额度；额度过期不阻断终止，但终止
只关闭后续新占用，不删除、不释放、不重排既有付款、冲正和 `ProjectFundingAllocation` 历史。

F0→F1→F2→F3 是 Task 11 内部风险切片，不是锁定需求文档的原文编号。本文件只证明 F3
静态与单元层闭环；真实 PostgreSQL 16 迁移、trigger、并发和 Audit 中段回滚门尚未获得匹配
当前 116 个迁移的授权，因此 **F3 仍停在运行时发布门前**，不得外推为 Task 11、实施包 5、
五包精确发布候选或可部署版本完成。

本轮未启动 Docker、未连接生产，未 push、合并、部署、执行生产迁移或修改生产业务数据；
未执行 transition、retention、业务记录清理、AuditLog/checkpoint 清理、旧表旧字段删除或任何
物理删除。

## RED → GREEN

### RED：先锁定旧终止路径的失败面

新专测在旧实现上得到 **10 failed / 6 passed**，固定了下列缺口：

- 终止 POST 没有 UUIDv4 `actionId` 和生命周期令牌，网络结果未知时无法精确重放；
- 只看额度状态，没有证明唯一审批实例仍保持已批准冻结链及批准事实；
- 终止资格可能从当前身份猜测，不能证明操作者是数据库持久化财务主管；
- 当前密码没有与终止写入置于同一个 Serializable 事务；
- 旧令牌不包含当前额度净占用，付款或冲正抢先落账后仍可能用陈旧确认终止；
- 没有先验证完整资金账本，异常占用可能被静默带入终止事实；
- 终止写入缺少完整空事实 CAS、签名快照、小写 SHA-256 和稳定并发错误映射；
- actionId 没有额度自有耐久坐标；复用、载荷漂移和历史 terminal 行无法安全区分；
- Audit 异常、CAS 失败和签名漂移没有明确证明在业务写入前或同事务失败关闭；
- 前端仍调用旧 transport，没有专用五键 capability、四键回执、单尝试重试和权威回读；
- 终止 POST 没有生产页面消费者，route usage 保持未分类。

### GREEN：权威资格、审批生命周期与资金账本

新增只读端点
`GET /projects/:projectId/financing-quotas/:quotaId/termination-capability`，由
`project.financing_quota.terminate` 项目动作守卫保护。端点从权威额度工作台中精确选择一个
目标：零条 404，多条冲突；响应只含
`projectId/quotaId/status/lifecycleToken/terminateAction` 五个顶层键。

服务在同一事务内按固定顺序锁定活跃项目、目标 `ProjectFinancingQuota` 和精确
`project_financing_quota/project_financing_quota.approve` 审批实例，并再次证明：

1. 操作者在数据库持久岗位中包含 `finance_director`，不信任 JWT 自报角色；
2. 额度仍为 `approved`，唯一审批实例仍为 `approved`，申请人、冻结节点和终态批准事实一致；
3. 已过有效期但仍为 approved 的额度允许终止；非 approved、审批链缺失/重复/漂移均零写 409；
4. 完整项目资金账本可验证，目标额度净占用处于 `0..amountCents`；
5. 生命周期令牌绑定额度、审批实例和目标额度实时 `netUsedAmountCents`，付款或冲正抢先落账
   会使旧令牌失效。

终止不会调用旧的局部 `lockFundingContext`，而是验证全量持久资金账本。它不更新或删除任何
资金分配；终止后现存使用和冲正历史继续在只读台账展示，新付款分配只会忽略 terminated 额度。

### GREEN：原始密码、签名、CAS 与同事务 Audit

POST 现在强制：

- 小写 UUIDv4 `actionId`；
- 小写 64 位 SHA-256 `expectedLifecycleToken`；
- 1–500 个 Unicode code point 的终止原因；
- 1–256 个 Unicode code point 的当前密码。

密码只用 `trim()` 判断空白，交给 `AuthService.confirmPassword` 的仍是调用方原始字符串，并
显式传入同一 transaction client；密码不进入指纹、终止事实或 Audit metadata。之后锁定当前
有效手写签名版本和文件，文件/版本 SHA 必须一致且为小写 SHA-256；缺签、失效文件、SHA
漂移和非小写 digest 均在额度写入前失败关闭。

额度更新使用 `updateMany` CAS，除 `id/projectId/status/updatedAt` 外还要求九项既有终止事实
全部为空。单赢家写入 `status=terminated`、时间、操作者、原因、签名 file/SHA/version、
`terminationActionId` 和请求指纹；CAS 不是 1 时不写 Audit。随后普通 `AuditLog` 在同一
Serializable 事务中记录 actionId、原令牌、请求指纹、审批实例、已用/剩余额度和签名快照；
Audit 异常向外传播，要求数据库回滚整条事务。终止链不创建 `ApprovalActionLog`，因此不会
污染审批时间线或审批 PDF。

`P2034`、直接 `40001/40P01`，以及 Prisma raw SQL `P2010` 的对应 `meta.code` 都映射为稳定
409。只有 `meta.target` 精确为单列 `terminationActionId` 或该字段唯一索引名时才映射 actionId
冲突，其他 P2002 原样抛出。

### GREEN：额度自有幂等事实与历史兼容

`ProjectFinancingQuota` 新增 nullable unique `terminationActionId` 和 nullable
`terminationRequestFingerprint`。新终止请求指纹绑定 actionId、项目、额度、操作者、原生命
周期令牌和规范化原因，不包含密码。

同一 actionId 只有在额度已经 terminal 且项目、额度、操作者、原因、请求指纹、终止时间、
签名 file/SHA/version 全部一致时返回只含
`kind/actionId/projectId/quotaId` 的 `replayed` 四键回执，资金账本、额度和 Audit 零新增写。
载荷或事实任一漂移均 409。历史已终止但 actionId/指纹为 NULL 的行保持原样，不猜测、不回填，
也不允许自动重放。

第 **116** 个迁移
`20260802020000_project_financing_quota_termination_idempotency`：

- 使用独立 advisory xact lock，并对额度表执行 `ACCESS EXCLUSIVE NOWAIT`；
- 只新增两个 nullable 字段、唯一索引、成对/格式 CHECK 和终止事实 trigger；
- 历史双 NULL 行合法，不执行 UPDATE、DELETE、回填或任何业务 DML；
- INSERT 或从非终止态迁到 terminal 时必须同时具有 actionId/指纹；
- 已 terminal 行的状态、时间、操作者、原因、签名三元组、actionId 和指纹全部不可变；
- 迁移脚本和所有共享并发 runner 的硬编码迁移总数、终点迁移同步更新为 116。

## 前端终止闭环

项目经营页只在权威台账行的终止动作可用时显示“终止垫资额度”。开窗前执行专用 capability
GET；API 运行时解析器要求顶层精确五键，嵌套动作精确七键，并固定
`key=terminate_financing_quota`、`kind=danger`、`requiredAction=project.financing_quota.terminate`、
`requiresPassword=true` 及 enabled/disabledReason 一致。任何额外 file/self-review 要求、动作
类型或状态漂移都以 502 失败关闭。

页面将服务端 fresh action 的原始字段内联复核后才写入 readonly shallow ref；不把受保护 action
对象传入 helper，治理器因此可证明服务端来源与按钮支配关系。TDesign danger 对话框明确展示
当前已占用、当前剩余额度和“只停止新占用，不删除、不释放、不重排既有资金使用和冲正历史”，
要求原因与当前密码。

一次尝试冻结项目、额度、UUIDv4 actionId、旧生命周期令牌、原因、原始密码和 owner；标准链为：

1. 专用 capability GET；
2. 精确一次终止 POST；
3. 权威额度工作台 GET，确认目标唯一、已变为 terminated 且生命周期令牌已经变化。

同一窗口双击共享一个 promise。POST 网络未知、5xx 或响应损坏时保留同一 actionId、令牌和
完整 body 重试；已取得耐久回执但权威 GET 失败时只续读 GET；确定性 4xx 清空尝试并重新
preflight，允许修正原始密码。切项目、关闭窗口、组件卸载和迟到回调由 project generation、
窗口序号、操作序号及 context owner 隔离。审批窗与终止窗互斥，页面不直接 `fetch`；旧
`core-flow-read.api.ts` 终止 transport 已移除。

## 测试与静态门禁

最终本机证据：

- F3 后端 RED：旧实现 10 failed / 6 passed；
- API 聚焦复跑：核心终止、工作台、Controller、迁移 4 套 168/168；关联 schema/runner/
  static validation 30 通过、3 条需 PostgreSQL 的测试条件跳过；
- API 全量：277 套通过、19 套条件跳过；5502 项通过、51 项跳过、0 失败；
- Web F3/API/core-flow 聚焦：4 文件 195/195；
- Web 全量：157 文件，1644/1644；
- API/Web typecheck、lint、production build：通过；Web `check:ui`：通过；
- API 业务英文错误检查：扫描 401 个生产 TypeScript 文件，精确允许 54 处内部英文哨兵；
- Prisma validate/generate：使用不建立连接的本机占位 URL 通过，Client 已重新生成；
- 六个治理测试文件 203/203；五份治理清单普通 `--check` 与 `git diff --check` 通过。

前端独立复核最初发现 capability 嵌套动作解析过宽 1 项 P1，补精确七键解析和 kind/file/
disabledReason 漂移负测后复核 P0=0、P1=0。后端独立终审复核持久权限、锁/CAS、审批生命周期、
资金令牌、重放、签名、Audit、错误映射、迁移 trigger 和时间线污染边界，结论 P0=0、P1=0。

## 治理清单

按依赖顺序重生成并通过普通一致性检查：

- Nest 路由：398，ready；
- Web API：385 wrappers、405 request bindings；
- 页面动作：55，存量 blockers 296；新增 `project-financing-quota.terminate`；
- 终止动作 `serverDerived=true/dominatesTrigger=true`，权威工作台 GET、专用 capability GET、
  终止 POST 三段 binding 均为 accepted/causalVerified，本动作相关 blocker 为 0；
- route usage：398 条路由、0 unclassified，状态 ready；终止 GET/POST 均为 page/web wrapper；
- capability matrix 仍以 313 个全站存量 blocker 保持 blocked。

全站 Web API、页面动作和 capability matrix 的 blocked 是历史债务真实状态；本切片没有改写
规则或伪造 ready，也没有把 F3 局部完成外推为整站发布门通过。

## 未执行的运行时证据与真实阻塞

用户最新授权精确限定为 `spot-procurement.review-approve` 的“空库 **114** 迁移、签名并发、
缺签/SHA 漂移零写及 Audit 中段回滚”，不得连接生产。开始前核验已发现 F2 HEAD 当时已有
115 个迁移；F3 现在新增第 116 个迁移。该授权既不能从零采审批外推到项目垫资额度终止，
也不能把 114 静默改成 116，因此本轮没有启动 Docker。

F3 仍缺以下真实 PostgreSQL 16 门禁：

1. 空库完整应用 116 个迁移、第二次 deploy 零待办、终点迁移和 trigger 实际行为；
2. 终止与付款/资金占用两个真实 backend 的行锁竞争，只允许合法单赢家；
3. 同 actionId 并发、精确重放，以及 P2034/40001/40P01 的真实路径；
4. 缺签、签名文件/SHA 漂移时额度和 Audit 零写；
5. 在额度 CAS 后、Audit 写入中段注入故障，证明额度与 Audit 全事务回滚；
6. Chromium/WebKit 桌面和移动端的终止开窗、双击、未知结果、权威续读、能力漂移和跨项目隔离。

这些运行时证据未完成前，F3 只能作为本地候选切片提交，不得发布。下一合法步骤是由用户针对
当前精确 HEAD/候选、**116 个迁移**、项目垫资额度 F1/F2/F3 runner 与浏览器 preview 另行
明确授权；不得复用或扩张 114 迁移的零采授权。
