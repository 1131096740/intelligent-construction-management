# 实施包 5 Task 11：合同草稿删除与放弃申请动作闭合

## 结论

本子任务只闭合 `contract-draft.delete-pristine` 和
`contract-draft.abandon-application`，不把 Task 11、实施包 5 或五包总门禁标记为
完成。

后端新增统一合同草稿写边界。边界在同一事务中固定执行三段式读取：先锁
`Contract`，再锁精确 `ContractVersion`，最后以独立的新语句查询不可逆正式事实。
`READ COMMITTED` 活体交错证明，第三条语句会在等待版本锁后看见并发提交的正式事实；
完整聚合保存继续使用生产一致的 `SERIALIZABLE`，与并发正式文件写入竞争时会整体回滚
并映射为稳定草稿冲突，不留下保存回执、审计或部分草稿写入。任一双方最终签署文件
（包括后来失效或被替代的文件）、有效用印任务、归档、精确版本结算或付款存在时，均
不能再通过草稿保存、租约、清单、谈判文件、正式文件、授权、主体、readiness、
checkpoint、类型迁移、提交、作废/恢复/转移等通用入口改写；历史接管继续只能走专用
关闭流程。

异步文档处理器的生成终写和离线修订终写也在落库前重新经过同一边界，避免任务排队后
合同已正式化却继续提交旧结果。放弃申请会在同一事务内关闭开放谈判轮次、把有效离线
修订及其对比标为失效、释放编辑租约并把生成文档标为 stale，只保留历史记录，不做
物理删除。工作台 GET 改为纯读取：旧生成文档的 stale 投影只在响应中计算，不再借
读取请求写库。

前端台账不再直接写删除接口，只把符合条件的行送入精确版本工作台；台账响应单独返回
内部 `contractId`，即使展示 ID 是合同编号，路由仍使用数据库主键，并兼容旧响应。
工作台从独立权威 GET 保留原始 `availableActions`，两个确认对话框分别以精确
`key + enabled` 支配显示，并由两个固定动作字面量的 handler 调用统一复合 API。复合
API 在 POST 前再次 GET，必须同时匹配 contract/version/revision 和唯一启用动作；
写回后再核对版本、终态、动作和 lifecycle kind。路由切换、卸载、旧响应、坐标漂移、
不同动作重叠及失败重试均失败关闭。只有精确当前经办人自动获取租约，合同主管和其他
非经办人保持只读；旧 DELETE 路由和工作台 GET 均要求 `contract.create` 项目动作权限。

本轮未改 Prisma Schema 或迁移。

## RED 与修复

首轮页面测试为 7 项 RED：

1. 旧页面仍通过 `BusinessDraftAction` 透传动作对象；
2. 两个固定 handler 不存在；
3. 权威动作数组被普通 `ref` 包装为响应式代理，不能证明保留原始 GET 集合；
4. 坐标不一致、stale 和卸载场景仍绑定旧通用 handler；
5. 第二次 capability GET 的 revision 更新时，页面会在旧工作台数据上暂时展示新动作。

页面动作分析器随后把两项均判为：

- `serverDerived=false`；
- `dominatesTrigger=false`；
- `causalVerified=false`。

根因是 `BusinessDraftAction` 会把服务端动作集合交给未知转换器，分析器按对象逃逸
失败关闭；通用 handler 还把 `request.action` 继续向下透传，无法分别证明两个动作。
修复后：

- 动作数组改为 `shallowRef`，只允许权威 GET 写入、`null` 失效和 `.some(...)` 精确
  只读门；
- 两个 `SensitiveActionDialog` 都由各自的 `key + enabled` 门直接支配；
- `confirmDeletePristineDraft` 固定
  `action: "delete_pristine_draft"`；
- `confirmAbandonApplication` 固定
  `action: "abandon_application"`；
- 服务端返回的 `requiresComment`、`requiresPassword` 仍按同一精确动作读取；
- Promise 链在页面恢复 loading、保留错误并关闭成功对话框，同时保持分析器可证明的
  直接 wrapper 因果链。
- 台账展示 ID 与内部 ID 分离，带正式编号的 pristine draft 仍精确进入内部合同路由；
- 相同确认只复用 canonical API owner 的同一 Promise，成功清理、跳转、错误和 settled
  回调都只由 owner 执行一次；不同指纹的 BUSY 失败不会提前解除当前 owner 的 busy；
- wrapper declaration 分别冻结 `delete_pristine_draft` 与
  `abandon_application` payload variant；分析器把该 variant 纳入符号调用证明，交换
  handler 字面量时两条删除 binding 都会失败，空 variant 也不能通过 registry 校验。

后端 RED 另覆盖：

1. 普通草稿 mutation 只看 `status=draft`，无法阻断已经形成签署、用印、归档或下游
   结算/付款事实的异常数据；
2. 多个服务各自锁版本，缺少统一父合同优先的锁序；
3. 提交和放弃并发时可能各自基于旧状态继续；
4. 历史接管仍可能从通用工作台 mutation 绕过专用关闭流程；
5. 工作台 GET 与放弃 POST 的项目动作权限不一致，合法写入人可能读不到权威
   capability；
6. 异步文档 processor 可能在任务入队后合同已正式化的情况下继续做 terminal write；
7. 放弃申请若只改合同状态，会遗留开放谈判、有效离线修订、租约和可被误认有效的生成
   文档；
8. 工作台 GET 为投影 stale 文档执行写库，破坏只读请求语义。

统一边界和并发测试最终证明：提交/放弃双向竞争都只有一个赢家、唯一终态，失败方返回
稳定冲突；两方业务写入和审计不会同时落地；锁序固定为
`Contract → ContractVersion`。工作台 GET 与 POST 现在同为
`contract.create` 项目动作门。

真实 PostgreSQL 16 空库从 0 部署 109 个迁移后，四项数据库用例全部通过：

1. 并发聚合保存只有一个 revision winner，失败事务完整回滚；
2. 100/500/1000 行 changed 与 no-op 路径分别为
   `220.57/23.30ms`、`1237.48/41.49ms`、`1700.42/57.08ms`；
3. `READ COMMITTED` 原始边界等待精确版本锁后，第三条 fresh query 看见正式 blocker；
4. `SERIALIZABLE` 完整保存等待并发正式文件提交后以
   `serialization_failure` 映射为 `DRAFT_REVISION_CONFLICT`，无回执、审计或草稿写入。

临时数据库容器在验证后已移除。

## 前端复合操作

`executeContractDraftLifecycleAction(...)` 以
generation/contract/version/revision/action/reason 形成单一 operation owner：

- 相同指纹重复确认返回 owner 的同一 Promise，反馈、成功清理、失败和 settled 回调
  仅执行一次；
- 不同指纹并发稳定拒绝且不提前触发 settled；
- 密码不进入指纹或持久状态，只在本次 POST body 中使用；
- fresh GET 失败、POST 失败、返回坐标不一致和页面失效分别保留正确恢复语义；
- capability 坐标或响应不一致时立即隐藏旧动作；
- 成功后丢弃本地副本并进入已结束视图；
- stale 结果不丢本地状态、不跳转。

`useContractDraft` 加载时仍把业务工作台克隆进可编辑模型，但把原始 GET snapshot 返回给
页面；保存响应不再用局部 `availableActions` 覆盖权威读取能力。页面只设置
`swallowOperationFailure` 以承接已展示的业务错误；API 单测和其他调用方默认仍得到
rejected Promise。

## 机器事实

两项动作最终均为：

- `serverDerived=true`；
- `dominatesTrigger=true`；
- `causalVerified=true`；
- action-specific blocker 为空；
- 复合 wrapper 顺序绑定：
  - `GET /contract-drafts/:param/workbench`；
  - `POST /contracts/:param/abandonment`。
- `causalProof.variant` 分别为 `delete_pristine_draft` 与
  `abandon_application`。

清单相对提交基线 `5c9ecb0ce1fce89c56c8ac9af2695186136e5241` 的变化：

- page accepted / covered production consumer：9 → 10；
- page blocker：342 → 336；
- Matrix accepted action binding：10 → 12；
- Matrix unresolved action binding：36 → 36；
- Matrix production mutation pair：274 → 273；
- Matrix covered pair：9 → 10；
- Matrix uncovered pair：265 → 263；
- Matrix blocker：378 → 377，整体仍为 `blocked`；
- Web transport wrapper：376 → 377；
- Web main binding：378 → 380；
- orphan wrapper：43 → 44。

台账直接写入口退出后，旧导出 `abandonContractDraft` 只剩测试/内部复合使用，分析器继续
把它作为 orphan 明示；本轮没有借机执行 Task 12 的旧 wrapper 代码退出。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `77494c39bf8081c3d1f68cfc611842095672689acdc402238f7a600fd7cfd30f`
- `web-api-wrappers.json`：
  `0d048f05112ae97aa086ad8764642b21d30437521eed6b3ab75d6e07319a72c7`
- `web-page-actions.registry.json`：
  `ac5fd50d70d98e75758c0fc0edd1c0309e9dd5eec6762e7d430099fa4499ce0a`
- `web-page-actions.json`：
  `5b9c1161a63845edeeb198878abe909d9d1cfe30c1bc6990e601016f0dd460ab`
- `route-usage.json`：
  `52306ff8730d52bd2c984516e52c7fc4215897beeb709d19c7715c284387a268`
- `whole-site-capability-matrix.json`：
  `6a231cbcd104b5e6651665abc96213ae9f0057b5e63a9dc8468dd4338a4fde9e`
- `whole-site-capability-matrix.md`：
  `58129137c524b9a8f5e9c9ab9eccd7e9a26ca91995e18b43640972c8ec626894`

## 验证

- API 目标 Jest：18 套中 17 套通过、1 套数据库条件门跳过，689 项通过、4 项跳过；
- 真实 PostgreSQL 16 空库：109 个迁移、数据库并发/隔离用例 4/4；
- Web API/composable/page 目标 Vitest：4/4 文件、160/160；
- page-action analyzer：69/69；
- capability-matrix analyzer：43/43；
- API/Web typecheck：通过；
- API/Web lint：通过；
- API/Web production build：通过，Web 仅保留既有大 chunk warning；
- Web `check:ui`：通过；
- API `check:business-errors`：通过；
- Prisma validate/generate：通过；
- Nest、Web API、page action、route usage、capability matrix 按顺序重生成；
- `git diff --check`：通过。

## 剩余风险、未授权与下一步

当前全站仍有 36 个 unresolved action binding、263 个 uncovered production
mutation pair、44 个 orphan wrapper、4 组重复 mutation route、1 条 Web 请求无
Nest route 和 26 条未分类路由；能力矩阵必须继续保持 `blocked`。

统一边界的核心保存路径已把 `40001` 规范化为稳定业务冲突；另有
`replaceRows`、3 个 transition 和 3 个 lease 入口共 7 条既有事务路径会安全回滚，
但极端串行化冲突仍可能向调用方暴露通用错误，而不是统一业务错误码。这是已知 P2
反馈一致性风险，不影响数据库原子性，留待 Task 11 后续切片统一处理。

浏览器 P0、WebKit/移动响应式、全量测试、空库迁移和最终发布门证据继续在后续
Task 11–15 总收口执行。本地未 push、合并、部署、执行生产迁移或修改生产业务数据。
业务草稿 purge、正式业务记录、审计、checkpoint、旧表旧字段和物理删除继续关闭；
生产 temporary-only retention 的既有单独授权与本地 Task 11 改造保持隔离。
