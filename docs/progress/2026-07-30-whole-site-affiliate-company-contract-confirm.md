# 实施包 5 Task 11：挂靠企业线下合同确认动作闭合

## 结论

本子任务只闭合 `affiliate-company-contract.confirm`，不把同页的
`affiliate-company-contract.record`、Task 11、实施包 5 或五包总门禁标记为完成。

确认入口、对话框和写调用只信任同一 GET 响应保留的精确
`availableActions.includes("confirm")`。普通表格数据是 `structuredClone` 后的展示
副本，伪造行对象不能建立确认权限。打开确认时冻结项目、合同、项目 generation 和
`confirmationActionId`；同一对话框失败重试复用该 ID，取消后重新打开才生成新 ID。
项目切换、旧 GET、旧成功、旧失败、重复提交或 wrapper 同步抛错均不能污染当前页面
或错误改写 busy。

服务端继续以合同主管、当前密码、冻结手写签名、`pending_confirm` 状态、行锁、CAS
和同事务审计为硬门。新增行锁后的二次幂等查询，覆盖首请求提交前已经进入的同 key
重试；若唯一索引竞争在不同合同间发生，事务外只按同一
`confirmationActionId` 重查已提交胜方，project/contract/actor 三坐标完全一致才
replay，否则稳定返回 409，不泄漏 Prisma `P2002`，也不重复签名、更新或审计。

本轮未改 Prisma Schema 或迁移。

## RED 与修复

初始页面 RED 证明了以下问题：

1. registry 绑定的是表格行和打开链接，而不是真正提交确认的对话框；
2. 项目 A 的旧 GET 可以覆盖项目 B；
3. 伪造展示 clone 可以绕过确认门；
4. 失败重试会生成新的 `confirmationActionId`；
5. 重复请求和 stale completion 缺少统一 operation owner。

独立复核随后继续建立并修复：

- 企业主体下拉请求失败会连带隐藏已成功读取的确认 capability；
- 项目 A 已打开的登记表单可在切到项目 B 后使用实时 `props.projectId` 写错项目；
- 登记预校验异常会逃出 Vue 事件而不写抽屉错误；
- 同 key 重试在等待行锁后看不到 replay；
- 不同合同并发竞争同 key 时数据库唯一冲突会冒成 500；
- `available_action_string` 分析器最初既不接受精确 `includes`，又存在 ref alias、
  上游 exact projection、参数逃逸、first-write-wins alias 和含点静态 key 的旁路。

最终实现把合同 GET 与企业选项请求解耦；登记上下文也冻结 project/generation，
项目切换后即使旧上传 resolve/reject 都不能产生业务写或旧页面副作用。分析器只接受
正确 key 的 exact `includes`，并以逐段编码的路径敏感 projection carrier 和受保护性
单调 alias join，允许保留完整响应及读取 sibling 标量，同时拒绝 local array、错误
key、直接写、alias 写、上游原路径写、参数逃逸和后赋受保护路径。

## 机器事实

- `affiliate-company-contract.confirm`
  - `serverDerived=true`
  - `dominatesTrigger=true`
  - `causalVerified=true`
  - `localCallChain=submitConfirm -> confirmProjectAffiliateCompanyContract`
  - accepted production consumer：
    `AffiliateCompanyContractPanel.vue`
- `affiliate-company-contract.record`
  - 服务端 provenance 已恢复为
    `serverDerived=true`、`dominatesTrigger=true`
  - 因 registry 仍停在打开登记抽屉的 `openRecord`，`causalVerified=false`，继续保持
    unresolved，不在本子任务冒充闭合
- accepted / covered：7 → 8
- unresolved action bindings：38 → 37
- uncovered production mutation pairs：268 → 267
- page-action blocker：349 → 345
- capability-matrix blocker：382 → 380，整体状态仍为 `blocked`

生成文件 SHA-256：

- `web-page-actions.registry.json`：
  `1a2569f61da528af659a2dd8eb7f1070ecacfc29acd9f55b4f3d2a7e941cc89c`
- `web-page-actions.json`：
  `386dbae71d145b4577d62f6104f45267a720e6f6ea14fa26f489c43f5275493b`
- `whole-site-capability-matrix.json`：
  `75cf781c58e8d1429f0a3fefa2228d4d4e8621c540e362d6e7f9aeb3c5575d30`
- `whole-site-capability-matrix.md`：
  `54298d23e28c29f973cfc481fde3143247ab37023225e08a27c8273e5e271b27`

## 验证

- Web 页面与 API wrapper：72/72；
- API service 与 controller：124/124；
- page-action analyzer：57/57；
- Web/API typecheck：通过；
- Web/API lint：通过；
- Web `check:ui`：通过；
- API `check:business-errors`：通过；
- Web/API production build：通过，Web 仅保留既有大 chunk warning；
- Prisma validate/generate：通过；
- Web API、route usage、page action、capability matrix 四清单 `--check`：按真实
  blocked 基线一致；
- `git diff --check`：通过；
- 最终独立安全复核：READY，无剩余 P0/P1/P2；
- 最终独立静态分析复核：READY，无剩余 P0/P1/P2。

## 未授权与下一步

本地未 push、合并、部署、执行迁移或修改生产业务数据。业务草稿 purge、正式业务
记录、审计、checkpoint、旧表旧字段和物理删除继续关闭。生产 temporary-only
retention 的既有单独授权与本地 Task 11 改造保持隔离。

下一切片必须从剩余 37 个 unresolved action binding 和 267 个 uncovered production
mutation pair 中重新选择；不得把本动作局部通过扩张为 `record`、Task 11 或整站发布
门已完成。浏览器 P0、全量测试和最终发布候选证据继续在后续 Task 11–15 总收口执行。
