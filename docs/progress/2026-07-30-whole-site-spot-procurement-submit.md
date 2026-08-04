# 实施包 5 Task 11：零星采购提交审批动作闭合

## 结论

本子任务只闭合 `spot-procurement.submit`，不捆绑审批通过、驳回、撤回或其他
零星采购动作，也不把 Task 11、实施包 5 或五包总门禁标记为完成。

提交按钮和写调用均改为只信任同一 GET 详情响应保留的
`spotProcurementCapability.availableActions` 中精确
`submit_approval` 动作；普通 `detail` 只是独立的 UI 深拷贝，不能建立提交权限。
调用时冻结采购 ID、路由 generation 和 operation ID，preflight 以 throw-only
helper 直接向 `submitSpotProcurement` 提供精确采购 ID。旧路由请求、同采购重叠
请求、伪造 UI gate、同步请求创建异常均不能写消息、触发刷新或错误清除新操作
的 busy。

后端既有 `POST /spot-procurements/:procurementId/submission`、controller guard、
事务状态门、申请人/岗位校验和审计保持不变；本子任务未改 API、controller、
service、Schema 或迁移。

## RED 与 GREEN

首轮 66 项页面目标中新增 3 项精确失败：

1. registry 仍引用可编辑 UI clone `detail.availableActions`；
2. 伪造 clone gate 仍会调用 submit wrapper 并设置 busy；
3. 采购 A 请求完成后会在采购 B 页面再次读取详情并覆盖 B 的 UI 状态。

最小实现后扩为 68/68，并进一步锁定：

- wrapper 同步抛错前不设置 busy/operation owner；
- 同一采购两个请求逆序完成时，旧请求不覆盖最新失败结果、不刷新详情；
- wrapper 对精确采购只调用一次；
- route/entity/operation 任一失配时结果回调全部无副作用。

## 机器事实

- `spot-procurement.submit`：
  - `serverDerived=true`
  - `dominatesTrigger=true`
  - `causalVerified=true`
  - `localCallChain=runSubmit -> submitSpotProcurement`
  - action blocker 为空
- accepted / covered：6 → 7
- unresolved action bindings：39 → 38
- uncovered production mutation pairs：269 → 268
- page-action blocker：352 → 349
- capability-matrix blocker：384 → 382，状态仍为 `blocked`

生成文件 SHA-256：

- `web-page-actions.registry.json`：
  `dcefa897bef6107abe77dce7afe3ed6c30b161b9c2c7a45778ab2e129917433a`
- `web-page-actions.json`：
  `f25e4ae27670eaff786bdb0542480bdc969de0e1d83316c9cb99a3860f296785`
- `whole-site-capability-matrix.json`：
  `3fffc5d12d0fec771b66bcc40cca6b6c0ceb79847d315c27f0ac84c2ef4b1db8`
- `whole-site-capability-matrix.md`：
  `df7c46469be64ab0665399a7c96393dd9ea2c4489508bfce2a37be01f4506510`

## 验证

- 零星采购页面目标：68/68；
- page-action analyzer：56/56；
- Web typecheck、全量 lint、`check:ui`：通过；
- Web production build：通过，保留既有大 chunk warning；
- page-action 与 capability matrix `--write` 后 `--check`：一致；
- `git diff --check`：通过；
- 独立只读复核：READY，无 P0/P1/P2。

## 未授权与下一步

本地未 push、合并、部署、执行迁移或修改生产业务数据。业务草稿 purge、正式业务
记录、审计、checkpoint、旧表旧字段和物理删除继续关闭。Task 11 下一切片必须从
剩余真实 blocker 重新选择，不得把本动作的局部通过扩张为其他审批动作已获授权或
已闭合。
