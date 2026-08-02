# 实施包 5 Task 11：合同审批通过与驳回治理闭环

## 当前结论

本切片只处理合同详情页的两个页面动作：

- `contract-approval.review-approve`
- `contract-approval.review-reject`

两者共用 `POST /contracts/:contractVersionId/approval`，但分别保留明确的 approve/reject
payload variant。当前代码、单元测试、静态门禁与机器清单已经形成可独立提交的本地候选；
真实 PostgreSQL 并发、Audit 中段回滚及 Chromium/WebKit/移动响应式仍未执行，因此本切片
不代表 Task 11、实施包 5 或五包精确发布候选完成。

本轮没有 Schema 或迁移变化，没有启动 Docker、数据库、preview 或浏览器，没有连接生产，
也没有 push、合并、部署、生产迁移、生产业务写入、transition、retention 或物理删除。

## RED 与根因

改造前，合同详情页直接调用普通审批 POST，缺少付款审批等关键动作已经采用的治理不变量：

- 服务端详情没有发布唯一进行中审批实例的四坐标；
- Web 没有冻结 route/detail/dialog/operation owner，也没有 fresh GET 后的单次 POST；
- 合同版本、审批实例、节点或审批时间漂移不能在签名和首笔业务写入前统一失败；
- 多个进行中审批实例没有失败关闭；
- 显式业主主合同风险确认只是一枚布尔值，未绑定用户看到的精确风险快照；
- 网络、解析或 5xx 导致结果未知时，页面可能允许再次发起写入；
- approve/reject 没有分别进入机器可验证的 handler → executor → POST 因果链。

新增 RED 后，后端坐标/重复实例场景、Web canonical executor、页面 owner 与治理结构测试均先
证明旧实现不能满足约束，再做最小实现。独立终审随后又发现并关闭五项测试盲区：

1. 有业主主合同风险时，页面错误把“驳回”也绑定到“继续通过”的风险确认；
2. 终态并发 loser 会在坐标检查前以普通 Error 返回 500；
3. 项目风险可能在 fresh GET 与 POST 之间变化，而旧确认没有随请求携带精确快照；
4. 同路由刷新或跨合同切换可能把风险 A 的勾选复用到风险 B；
5. 坐标冲突先于冻结节点身份检查，会让非当前节点账号通过 409/403 差异探测审批状态。

## 最小实现

### 服务端权威读模型

`ContractDetailReadModel.reviewApprovalContext` 只在以下条件同时成立时发布：

- 当前合同版本恰好存在一个 `contract.approve / in_progress` 审批实例；
- 当前账号是冻结节点直接处理人、受让人或有效受托人；
- 服务端恰好发布一个 enabled `review_approval` 动作。

上下文只含四个 CAS 坐标：合同 `updatedAt`、审批实例 ID、节点序号和审批实例
`updatedAt`。多个进行中实例、无权账号、动作缺失或重复均不发布该上下文。

### 后端审批事务

`ContractService.reviewApproval()` 现在：

1. 锁定合同版本；
2. 按确定顺序同时锁定严格绑定当前合同业务/flow 的 expected 审批实例（包含终态）和全部
   in-progress 实例；
3. 先以 expected 实例的冻结节点验证直接/转办/委托身份与自审，非节点账号统一 403；
4. 再统一复核合同状态/时间、唯一 active 实例、实例 ID、节点和审批时间，漂移统一返回
   409 `CONTRACT_APPROVAL_REVIEW_CONFLICT`；
5. 坐标通过后才冻结受治理节点的当前有效签名，并进入既有审批状态迁移、ActionLog、Audit、
   用章任务与审批单生成路径。

因此，合法终态 loser 和双 active 异常保持稳定 409，非节点账号面对 stale、terminal、
duplicate 或跨 business/flow 实例均优先 403；所有异常都在签名与业务写入前结束。驳回/退回
空意见改为 400，未知身份改为 403，不再产生防御层 500。

终审 approve 若需要显式确认，还必须提交完整 `expectedOwnerContractRisk`：status、业主合同
金额、对下合同累计金额、超额金额、message 和 requiresExplicitConfirmation。服务在项目锁后
重算风险并逐字段匹配；缺失或任一字段漂移均返回 409
`CONTRACT_OWNER_RISK_SNAPSHOT_CONFLICT`，合同版本、审批实例、ActionLog、Audit 和用章任务
全部零写。reject 不发送也不要求风险确认或风险快照。

### Web canonical executor

页面保留服务端原始 capability，展示模型使用独立 clone。动作执行固定为：

```text
server capability
  → 冻结 route/detail/dialog/operation + 四坐标 + 完整风险快照
  → fresh GET 精确复核唯一动作、身份要求、四坐标和风险
  → 单次 POST
  → 权威 GET
```

approve/reject 分别直接调用 `executeContractApprovalReviewAction`；双击共享同一 Promise，
route/unmount/迟到回调由 owner token 隔离。网络、响应解析或 5xx 被包装为结果未知，页面只做
权威续读并阻断重复提交。对话框冻结用户确认时看到的完整风险；任何详情刷新或跨合同清理均
清空风险 checkbox，capture 还会逐字段比较对话框风险与当前服务端风险，不能把风险 A 的确认
转移给风险 B。

页面没有直接 `fetch`，旧的裸 `reviewContractApproval` wrapper 已移除。

## 机器治理结果

两个动作均满足：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- accepted production consumer 为 `ContractDetailPage.vue`
- 本地因果链分别为
  `confirmContractReviewApprove/Reject → executeContractApprovalReviewAction`
- Nest 路由为 `ContractController.reviewApproval`
- 权限为 `contract.approve`

当前普通检查结果：

- Nest route manifest：398 routes；
- Web API manifest：386 wrappers / 406 bindings，按存量 blocker 正确保持 blocked；
- 页面动作：57 actions / 295 blockers；
- route usage：398 routes / 0 unclassified，ready；
- 综合矩阵：398 routes / 312 blockers；
- `POST /contracts/:contractVersionId/approval` 为 `covered`，本动作 blocker 为空。

相对本切片前基线，综合矩阵 blocker `313 → 312`、uncovered mutation pair `250 → 249`；
approve/reject 共用一个 POST consumer pair，因此净减少一项符合预期。整站仍未 ready，
`--require-ready` 必须继续失败，不能把本动作外推为 Task 11 完成。

## 验证证据

最终精确工作树验证：

- API 目标 6 套 Jest：6/6，391/391；
- Web 目标 4 个 Vitest 文件：147/147；
- 治理生成器单测：203/203；
- shared-domain typecheck 与 scoped lint：通过；
- API typecheck、scoped lint、production build：通过；
- Web typecheck、scoped lint、`check:ui`、production build：通过；
- Web build 仅保留既有大 chunk warning，不是本切片新增失败；
- API 英文业务错误检查：401 个生产 TypeScript 文件、54 个允许内部哨兵，通过；
- Prisma validate：使用不可连接的专用回环占位 URL 通过，未建立数据库连接；
- 五份普通 manifest/matrix check：全部按 ready/blocked 预期通过；
- `git diff --check`：通过。

本轮没有重跑全仓全量测试；此前其他 SHA 的全量证据不能复用到本候选。全量 test、完整 lint、
最终 typecheck/build、Prisma generate、空库迁移、浏览器 P0 等仍须在五包精确发布候选上统一
重跑。

## 剩余发布证据与下一步

本切片仍缺：

- 真实 PostgreSQL 双审批锁等待与终态 loser 单赢家；
- 缺签、签名文件/SHA 漂移零写；
- 项目风险并发漂移零写；
- Audit 中段故障后合同、审批实例、ActionLog、Audit、用章任务全事务回滚；
- Chromium/WebKit 桌面与移动响应式关键路径、双击单 POST、风险刷新及结果未知续读。

用户最近一次本机 Docker 授权精确限定 `spot-procurement.review-approve` 的 114 迁移范围，
不能外推到本合同审批切片，因此本轮没有执行上述动态门。它们是最终发布门，不阻断当前聚焦
提交。提交后严格继续 Task 11 的
`POST /contracts/:contractVersionId/approval-withdrawal`，不得提前进入 Task 12；合同动态门需
另获精确授权后执行。
