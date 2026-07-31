# 实施包 5 Task 11：付款审批通过与驳回动作闭合

## 结论

本子任务只闭合：

- `payment-approval.approve`
- `payment-approval.reject`

不把 Task 11、实施包 5 或五个实施包总门禁标记为完成。全站能力矩阵仍为
`blocked`；下一最小切片是 `payment-execution.record`，且必须继续区分“审批通过”
与“实际付款”。

付款详情 GET 现在只在满足以下条件时发布 `review_approval` 及其权威审批上下文：

1. 付款申请精确处于 `approval_pending`；
2. 精确匹配
   `businessType=payment_request`、当前付款申请、
   `flowType=payment.approve` 和 `status=in_progress`；
3. 匹配中的审批实例恰好一条；
4. 当前账号是冻结节点直接审批人、冻结转审接收人或当前有效常驻委托接收人；
5. 普通申请人不得审批本人申请；董事长或总经理 OR 签自审仍必须走既有二次确认；
6. 普通项目台账读者只能读取其可见项目；没有台账岗位但属于上述合法冻结审批链的
   账号，只能读取这笔仍待审批的付款。

重复或缺失进行中实例、已支付或其他非待审状态、无项目可见性且不属于当前审批链的
账号均失败关闭。无权账号收到统一的“未找到”结果，不泄露付款或审批实例坐标。

审批 POST 强制提交四项坐标：

- `expectedPaymentUpdatedAt`
- `expectedApprovalInstanceId`
- `expectedNodeIndex`
- `expectedApprovalUpdatedAt`

事务先锁付款申请和合同版本，再按稳定顺序锁住全部精确进行中的付款审批实例。
锁后基数不是一条时返回 409。当前节点身份、自审规则和项目动作权限先于坐标 CAS
判断，因此无权账号不能利用 409 探测内部并发事实。旧付款时间、旧实例、旧节点、
旧审批时间、重复实例和并发 loser 均稳定 409 且零业务写。

合法 winner 继续复用既有付款审批领域事务：

- approve 只进入 `approved_pending_payment`，不生成实际付款；
- reject 进入 `approval_rejected`；
- approve 冻结实际办理人的手写签名版本；
- OR 签、转审、委托和自审二次确认语义保持不变；
- 批准金额、融资额度缩减或释放、审批动作日志和 AuditLog 保持同事务；
- `reject_previous`、`return_to_applicant` 等既有决策未被删除或改写。

前端页面不直接 `fetch`。原始 GET capability 单独保存在
`paymentApprovalCapability`，展示模型只接收 `structuredClone`；确认前再做一次
独立 fresh GET，并冻结组件 owner、route/detail/dialog generation、付款、实例、
节点、两项更新时间、decision、意见、批准金额和自审字段。旧路由、重挂载、重复
点击、交叠请求和迟到 resolve/reject/finally 均不能写入、刷新或解除新 owner 的
busy。驳回明确丢弃页面中可能残留的批准金额。

本轮未修改 Prisma Schema 或迁移。

## RED 与最小实现

### 后端 RED

改造前的失败证据覆盖：

1. DTO 没有付款更新时间、审批实例、节点和审批更新时间四坐标，旧确认可能跨节点
   或跨审批版本重放；
2. GET/POST 会从多个进行中实例中取一条，重复实例未失败关闭；
3. controller 的静态台账岗位门会错误阻断合法冻结转审或常驻委托接收人；
4. 详情服务只按审批人事实放行时，付款已变为 `paid` 后仍可能保留陈旧审批入口；
5. 无权账号与坐标冲突的错误优先级可能泄露内部实例事实；
6. approve/reject 并发只证明“状态已经变化”不能证明四坐标 CAS；最初实库证据因此
   被判定为不足，随后补双节点、付款仍为 `approval_pending` 的独立竞争场景；
7. 新增三个必填 DTO 字段后，静态字段锁定计数从 42 漂移到 45，测试先失败再精确
   更新，未放宽字段检查。

最小实现只增加精确实例基数、四坐标 CAS、详情读权限的“项目台账或当前审批链”
二选一边界和现有事务内锁后复核；没有新增审批引擎、数据库约束或迁移。

### 前端 RED

改造前两个动作缺少独立 fresh GET、完整审批坐标、固定 decision handler、
operation owner 和重挂载隔离。新增确定性测试先锁定：

1. 通过与驳回只能由各自固定 handler 进入复合执行 wrapper；
2. fresh GET 必须与当前页面的付款、实例、节点和两项更新时间完全一致；
3. POST 必须精确发送四坐标，驳回不得发送 `approvedAmountCents`；
4. capability 原始对象或其后代不得逃逸到展示模型；展示附件 ID 也必须从 clone
   派生，不能回读原始对象；
5. 旧 route、旧详情、旧对话框、旧组件和非 owner 不得继续写或清除 busy；
6. 重复确认、A→B 路由切换、卸载、迟到成功与迟到失败在 POST 前后都失败关闭。

GREEN 后，两项均为：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- `accepted=true`
- `blockerCodes=[]`

## 真实 PostgreSQL 16 并发门

本地 runner 创建一次性 `postgres:16`，仅绑定 `127.0.0.1`，从空库顺序部署仓库
全部 109 个迁移，再使用真实 Nest service、两个竞争 backend 和独立观察连接验证：

1. approve winner 与 approve loser 的状态门竞争：观察连接以 backend PID 和
   `pg_blocking_pids` 证明 loser 直接等待业务行锁；winner 只进入
   `approved_pending_payment`，冻结签名与批准金额，按批准金额缩减融资额度，
   loser 409，零实际付款；
2. reject winner 与 approve loser 的状态门竞争：winner 只进入
   `approval_rejected`，完整释放融资额度，不伪造签名，loser 409，零实际付款；
3. 双审批节点的四坐标竞争：winner 只把节点 0 推进到节点 1，付款仍保持
   `approval_pending`；使用旧四坐标的 loser 在等锁后精确命中“付款审批坐标已变化”
   409，最终只有一条 ActionLog 和一条审批 AuditLog，节点 1 未被改写，融资额度
   未移动；
4. 两条精确进行中审批实例时严格 409，付款、两个实例、额度、动作日志、审计、
   实付、分配、执行与财务记录均零变化；
5. approve/reject winner 的额度审计、签名快照、批准金额和状态均逐项守恒；
6. runner 无论成功、失败或中断都会清理临时容器和目录。

前两项明确登记为“状态门竞争”；只有第三项宣称证明四坐标 CAS，避免把不同失败
原因混成一份并发证据。

## 浏览器关键路径

目标流：

```text
付款详情
  -> 流程
  -> 办理付款审批
  -> 填写批准金额/意见或驳回原因
  -> fresh GET 复核四坐标
  -> POST 固定 decision
  -> 权威详情刷新
```

在当前 production bundle 上重跑 Playwright，仅在浏览器网络边界模拟 API：

- 1366×768 Chromium：审批通过；
- 390×844 WebKit：填写驳回原因并驳回；
- 两条路径均为
  `GET 初读 -> GET fresh preflight -> POST -> GET 刷新`；
- 双击/重复激活仍只有一个 POST；
- POST 精确包含四坐标；
- approve 保留批准金额和意见，reject 明确不发送批准金额；
- 无 console error、pageerror、Vite/Webpack overlay 或 document 横向滚动；
- 确认按钮位于视口内且未被遮挡；
- 桌面与移动截图均已人工检查，确认框完整可用。

本地沙箱首次因不允许监听 `127.0.0.1:4173` 返回 `EPERM`；获准只在本机回环地址
启动预览后，文件内 3/3 通过，其中本切片目标场景 2/2。既有台账场景会尝试代理
未启动的本地 API 并产生一条预期 `ECONNREFUSED 127.0.0.1:3000` 服务端日志，
但用例本身通过；两个新审批场景无浏览器错误。

本地临时截图：

- `apps/web-admin/test-results/payment-workbench.e2e.ts-P-c6d68-nate-preflight-and-one-POST-chromium/payment-review-approve-chromium-1366x768.png`
- `apps/web-admin/test-results/payment-workbench.e2e.ts-P-2ba1f-pproved-amount-and-one-POST-chromium/payment-review-reject-webkit-390x844.png`

截图目录由 Playwright 管理并已被 Git 忽略，不作为源码提交。

## 机器事实

相对上一个 Task 11 切片：

- Web API transport wrapper：380 → 381；
- Web API main binding：384 → 385；
- accepted action binding：16 → 18；
- covered production mutation consumer pair：12 → 13；
- page blocker：327 → 322；
- matrix blocker：375 → 372；
- orphan wrapper：保持 45；
- duplicate mutation route：保持 4；
- registered action：保持 42；
- route：保持 395；
- unclassified route：保持 26。

当前矩阵精确为：

- 395 routes；
- 381 wrappers / 385 bindings；
- 42 registered actions / 50 action bindings；
- 18 accepted / 32 unresolved action bindings；
- 274 production mutation consumer pairs；
- 13 covered / 261 uncovered；
- 26 unclassified routes；
- 372 blockers。

两项动作都由 `PaymentDetailPage.vue` 的独立 confirm handler 消费，动作级 blocker
为空；全站矩阵仍因范围外的 261 个未覆盖 mutation consumer、45 个 orphan wrapper、
4 组重复写封装、1 条 Web 请求无 Nest 目标和 26 条未分类路由保持 `blocked`。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `548c28d8f61331eaf717227d710484532aecdc42dc66a069eec2ac2d20d4dd35`
- `web-page-actions.registry.json`：
  `14f2decb5e73f2cc6b1d8674d2c9a1d99757a56617997ac25d44a336dbae53e9`
- `web-page-actions.json`：
  `dbab3d2cdc72afc0df7a4185b236c8b8efb9b42ccdae6fae36312eea26478f28`
- `route-usage.json`：
  `9f503a5d0d5ad7c051585b73586161fddacc2947416cfc334533a3a0e7c28f36`
- `whole-site-capability-matrix.json`：
  `dbbda6bb340429ef859a5e5c5eca9b21f5139069f3202ef5d5b2c756b3677506`
- `whole-site-capability-matrix.md`：
  `39410408df024015e91901e50f29127b2001fffc2d366eb5e66391243fe7cecc`

## 验证

- 付款审批目标 API：5 套、335/335；
- API 全量 Jest：257 套通过、15 套条件跳过；4988 通过、47 跳过、5035 总计；
- 付款审批目标 Web Vitest：2 文件、73/73；
- Web 全量 Vitest：143 文件、1396/1396；
- Web API、route usage、page action 和 capability matrix analyzer：181/181；
- 真实 PostgreSQL 16 空库：109 个迁移，四组付款审批并发/重复实例场景通过；
- 目标 Playwright production bundle：文件内 3/3，本切片 Chromium/WebKit 2/2；
- Web E2E typecheck：通过；
- API/Web typecheck：通过；
- API/Web lint：通过；
- Web `check:ui`：通过；
- API `check:business-errors`：扫描 398 个生产 TypeScript 文件，通过；
- API/Web production build：通过，Web 仅保留既有大 chunk warning；
- Prisma validate/generate：通过；
- Nest、Web API、route usage、page action、capability matrix 按顺序重生成并
  `--check` 通过；
- 独立只读代码审查：P0 无、P1 无；
- `git diff --check`：提交前再次执行。

## 剩余风险、未授权与下一步

非阻断 P2：

1. `ApprovalInstance` 尚无
   `(businessType, businessId, flowType, status)` 业务坐标复合唯一约束；当前正确性
   由锁全部精确实例并要求基数为一保证。索引或约束须先做存量重复数据预检，再以
   独立迁移决策处理。
2. 部分旧付款申请创建路径尚未冻结明确的候选审批人身份；当前审批读取严格依赖
   已冻结节点、assignment 和有效委托，提交侧补强留到对应付款创建动作切片。
3. 转审、常驻委托创建/撤销和提醒等独立页面动作仍需继续进入能力矩阵闭合。
4. 审批后 PDF 生成仍沿用既有 best-effort 路径；生成失败不回滚审批，但当前可观测
   回执不足，需在最终发布门前单独核对。
5. 新浏览器场景尚未加入默认 CI P0 集合。
6. 全站矩阵仍有上述 372 个范围外 blocker，不能把本切片绿色表述成 Task 11 或
   发布候选完成。

下一最小切片为 `payment-execution.record`。它必须以后端实际付款事务为唯一权威，
重新核对 `approved_pending_payment`、余额、项目资金、融资额度、付款主体、凭证、
幂等、审计和并发；不得因为付款审批已通过就在前端直接标记为已支付。

本切片未 push、合并、部署、执行生产迁移或修改生产业务数据。生产
temporary-only retention 的已授权执行与本地 Task 11 改造保持隔离；业务草稿
purge、正式业务记录、AuditLog、checkpoint、旧表旧字段及任何其他物理删除继续关闭。
