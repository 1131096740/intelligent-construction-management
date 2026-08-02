# 实施包 5 Task 11：合同审批撤回治理闭环

## 当前结论

本切片只处理合同详情页动作 `contract-approval.withdraw`，对应
`POST /contracts/:contractVersionId/approval-withdrawal`。当前代码、单元测试、静态门禁与机器
清单已经形成可独立提交的本地候选；真实 PostgreSQL 双撤回、撤回与终审竞争、Audit 中段回滚
以及 Chromium/WebKit/移动响应式仍未执行，因此本切片不代表 Task 11、实施包 5 或五包精确
发布候选完成。

本轮没有 Schema 或迁移变化，没有启动 Docker、数据库、preview 或浏览器，没有连接生产，也
没有 push、合并、部署、生产迁移、生产业务写入、transition、retention 或物理删除。用户最近
一次本机 Docker 授权精确限定 `spot-procurement.review-approve` 的 114 迁移范围，不能外推到
合同审批撤回。

## RED 与根因

旧撤回入口直接调用无坐标 body 的普通 POST，后端也只顺序读取合同与一条审批实例，存在以下
失败窗口：

- 详情没有发布唯一进行中审批实例的四个撤回坐标；
- 合同版本、审批实例、节点或审批时间漂移不能在首笔写入前统一失败关闭；
- 撤回与终审并发时没有共同锁序，终审成功后仍可能被撤回写回草稿；
- 多条进行中审批实例时只会取其中一条；
- Web 没有 fresh GET、route/detail/dialog/operation owner 或双击单 Promise；
- POST 结果未知或页面切换后可能误报、重试或污染另一个合同；
- 页面动作没有进入机器可验证的 capability → handler → executor → POST 因果链。

后端与 Web 新增 RED 后，旧实现分别出现目标失败；独立复核又发现并关闭两项 P1：

1. 非申请人可通过“版本不存在 404 / 版本存在但非申请人 403”差异探测资源存在性；
2. POST 已发出后同路由手工刷新会让 detail epoch 变化，旧 executor 随后错误提示“本次没有
   提交”，可能诱导重复写入。

静态治理复核还发现 raw 服务端响应被同时写入两个 capability ref 时污染 provenance，以及从
API 文件直接导入 unknown-result Error class 被合同专项扫描器误认成页面 wrapper；两处都以
最小边界调整收口，没有放宽检查器。

## 最小实现

### 服务端权威读模型

`ContractDetailReadModel.withdrawApprovalContext` 只在以下条件同时成立时发布：

- 当前合同版本状态为 `in_approval`；
- 恰好存在一个 `contract_version / contract.approve / in_progress` 审批实例；
- 当前账号是该实例冻结的申请人；
- 服务端恰好发布一个 enabled `withdraw_approval` 动作。

上下文只含合同 `updatedAt`、审批实例 ID、节点序号和审批实例 `updatedAt` 四个 CAS 坐标。
多实例、无权账号、动作缺失或重复均不发布上下文。

### 后端撤回事务

`ContractService.withdrawApproval()` 现在先以 expected instance、申请人、业务类型、合同版本和
flow 做只读身份绑定。非申请人面对存在或不存在目标都统一 403，且不启动事务、不加锁、零写；
已证明身份的申请人仍能获得真实缺失版本的 404。

事务内保持固定锁序：

```text
ContractVersion
  → expected + all active contract.approve ApprovalInstance rows（按 ID）
```

锁后再次绑定申请人，并要求合同状态/时间、唯一 active 实例、实例 ID、节点和审批时间全部与
四坐标一致；终态 loser、重复 active 或任一漂移统一返回 409
`CONTRACT_APPROVAL_WITHDRAWAL_CONFLICT`。通过后只把同一 ContractVersion 退回 `draft`、
重置税事实冻结状态、把精确审批实例置为 `withdrawn`，并在同一事务写一条 ActionLog 与一条
Audit。合同编号、`firstSubmittedAt`、历史签名、冻结节点、合同版本身份及所有下游业务事实
保持不变，不新建版本、不删除历史。

### Web canonical executor

页面只保留一个原始服务端 `contractReviewCapability`，展示模型使用独立 clone；撤回与终审按
不同 action key 读取同一权威详情，不把 raw 对象写入多个 mutable ref。执行链固定为：

```text
server capability
  → 冻结 route/detail/dialog/operation + 四坐标
  → fresh GET 精确复核唯一动作、身份和四坐标
  → 单次 POST
  → 权威 GET
```

双击共享同一 Promise；route/unmount/迟到回调由 owner token 隔离。网络、解析或 5xx 统一视为
结果未知，只做权威续读并提示不要重复提交。POST 一旦发出，即使同路由刷新导致页面 epoch
变化，也不再走“本次没有提交”的 stale 分支，而是进入结果未知续读；路由 A 的迟到结果不能
覆盖路由 B。页面没有直接 `fetch`，旧裸 `withdrawContractApproval` wrapper 已移除。

unknown-result Error class 移入 `src/lib/contract-approval-result.ts`，API executor 与页面共用；
合同专项矩阵的“不存在的页面 API wrapper”重新归零。

## 机器治理结果

`contract-approval.withdraw` 当前满足：

- `serverDerived=true`；
- `dominatesTrigger=true`；
- `causalVerified=true`；
- accepted production consumer 为 `ContractDetailPage.vue`；
- 本地因果链为
  `confirmContractWithdrawal → executeContractApprovalWithdrawalAction`；
- Nest 路由为 `ContractController.withdrawApproval`；
- 目标 POST `mutationCoverage=covered`，本动作 blocker 为空。

当前普通检查结果：

- Nest route manifest：398 routes；
- Web API manifest：387 wrappers / 407 bindings，按存量 blocker 正确保持 blocked；
- 页面动作：58 actions / 294 blockers；
- route usage：398 routes / 0 unclassified，ready；
- 综合矩阵：398 routes / 311 blockers；
- 合同专项矩阵：184 个静态 controller routes、139 个 API requests，缺失页面 wrapper 为 0。

相对上一合同终审切片，页面动作 `57 → 58`，page blocker `295 → 294`，综合矩阵 blocker
`312 → 311`；整站仍未 ready，`--require-ready` 继续按预期失败，不能把本动作外推为 Task 11
完成。

## 验证证据

最终精确工作树验证：

- API 目标 4 套 Jest：4/4，353/353；
- Web 目标 6 个 Vitest 文件：6/6，173/173；
- shared-domain：15/15 文件，150/150；
- 七套治理/合同专项生成器：223/223；
- shared-domain、API、Web typecheck：通过；
- API 与 Web 目标 scoped lint：通过；
- API 与 Web production build：通过；
- Web `check:ui`：通过；
- API 英文业务错误检查：402 个生产 TypeScript 文件、54 个允许内部哨兵，通过；
- Prisma validate：使用不可连接的专用回环占位 URL 通过，未建立数据库连接；
- 六份普通 manifest/matrix check：全部按 ready/blocked 预期通过；
- 综合矩阵 `--require-ready`：按 311 个整站存量 blocker 预期非零退出；
- `git diff --check`：通过。

本轮没有重跑全仓全量测试；此前其他 SHA 的全量证据不能复用到本候选。全量 test、完整 lint、
最终 typecheck/build、Prisma generate、空库迁移和浏览器 P0 仍须在五包精确发布候选上统一重跑。

## 剩余发布证据与下一步

本切片仍缺：

- 真实 PostgreSQL 双撤回的单赢家与 loser 409；
- 撤回与合同终审竞争的固定锁序单赢家；
- AuditLog 中段注入故障后合同、审批实例、ActionLog、Audit 全事务回滚；
- Chromium/WebKit 桌面与移动端 `GET → GET → 单 POST → GET`、双击单 POST、同路由刷新、
  结果未知续读及跨合同迟到隔离。

这些是最终发布门，但当前没有合同撤回专用 Docker/preview 授权，不能执行或伪造。完成聚焦
提交后，继续按最新综合矩阵选择 Task 11 的下一个最小真实 blocker，不得提前进入 Task 12；
合同终审与撤回的动态门待获得精确授权后统一执行。
