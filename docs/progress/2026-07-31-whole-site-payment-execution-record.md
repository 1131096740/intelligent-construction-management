# 实施包 5 Task 11：实际付款登记动作闭合

## 结论

本子任务只闭合 `payment-execution.record`，不把付款审批通过等同于实际付款，也不把
Task 11、实施包 5 或五个实施包总门禁标记为完成。全站能力矩阵仍为 `blocked`。

付款详情 GET 现在只在以下事实同时成立时发布 `record_execution` 和
`executionContext.expectedPaymentUpdatedAt`：

1. 付款申请处于 `approved_pending_payment` 或 `partially_paid`；
2. 已批准/申请金额尚有剩余额度；
3. 当前账号是该项目仍在职、可用的财务人员；
4. 付款申请和冻结合同主体均为我方付款主体；
5. 当前详情、执行记录、资金分配、财务入账和付款凭证的聚合读取一致。

页面只消费同一 GET 返回的原始 capability；展示模型接收独立
`structuredClone`。实付确认会冻结组件 owner、路由、付款 ID、详情 generation、
对话框 generation、付款更新时间、金额、日期、当前密码、凭证文件、上传 UUID 和
幂等 UUID。确认链统一由 `recordPaymentExecutionWithUpload` 执行：

```text
fresh GET 核对 capability 与付款版本
  -> POST /files 上传唯一凭证
  -> POST /payments/:paymentId/executions
  -> GET 权威详情刷新
```

同一次模糊失败重试复用已经冻结的业务载荷、上传结果与幂等键；双击确认只进入一条
链。跨路由、组件卸载、重挂载、迟到 fresh GET、迟到上传、迟到实付成功/失败及非
owner 的 `finally` 都不能写入新页面、刷新新详情或提前解除新 owner 的 busy。
页面没有直接调用 `fetch`。

后端 `recordExecution` 仍以 `SERIALIZABLE` 事务为唯一权威，并按稳定顺序锁定项目
资金范围、付款申请、合同/结算容量事实，最后锁付款凭证文件。事务内同时保证：

- 当前账号仍是项目财务人员并通过当前密码二次确认；
- 付款和合同冻结主体均为我方主体，且付款主体 ID、名称、统一社会信用代码快照
  完整；
- `expectedPaymentUpdatedAt`、付款状态、付款剩余额度和结算剩余额度仍有效；
- 付款凭证由当前登记人上传、尚未绑定其他业务且只能对应一条实际付款；
- UUID v4 幂等键只能对应完全相同的付款、结算、金额、日期、经办人、凭证和付款
  主体快照；
- 项目自有资金与融资额度分配、到期应付款来源分摊、PaymentExecution、
  PaymentRequest/Settlement 已付聚合、状态迁移和
  `payment.execution.record` AuditLog 同事务提交；
- 部分支付进入 `partially_paid`，完整支付才进入 `paid`；审批通过本身不产生
  PaymentExecution，也不把付款或结算标记为已支付。

## RED 与最小实现

### 后端 RED

改造前的失败证据覆盖：

1. PaymentExecution 没有稳定幂等键、付款主体快照或凭证唯一约束，同一事实可能被
   不同请求或凭证重放；
2. 旧写入没有前端付款版本 CAS，同一页面旧确认可能跨越新审批、部分付款或其他
   状态变化；
3. PaymentRequest、Settlement 的 `paidAmountCents`/状态、项目资金分配、
   PaymentExecution 和 AuditLog 缺少可迁移前验证的闭环；
4. PaymentExecution 可被更新或删除，已登记实付不是不可变事实；
5. 历史接管结算一度被错误豁免 owner-status 门；独立复核以非法
   `historical_takeover + effective + PaymentExecution` 夹具先证明漏放，再收紧为
   只要存在执行记录，付款和结算 owner 都必须处于 `partially_paid|paid`；
6. 普通付款申请或结算曾允许“非零已付金额 + 非付款状态”；现在只有无执行记录的
   明确历史期初余额保留兼容，其他状态只能保持零已付金额；
7. 全量回归暴露旧
   `project-affiliate-company-contract-schema.spec.ts` 把某个迁移错误地断言为永远
   最后一个迁移；最小改为断言迁移存在，没有放宽其 Schema 事实检查。

最小实现新增前向迁移
`20260728139000_payment_execution_idempotency`、Prisma 字段、服务事务、GET
capability、DTO 和种子事实。迁移在安装约束前先扫描存量并以精确 marker
失败关闭，随后增加：

- `PaymentExecution.idempotencyKey` 唯一且格式受约束；
- `voucherFileId` 唯一、独占业务绑定；
- 我方付款主体完整快照与来源一致性；
- PaymentExecution 禁止 UPDATE/DELETE；
- PaymentRequest/Settlement 金额、状态和执行 owner 闭环；
- ProjectFundingAllocation 与 AuditLog 的存量闭环；
- 相关外键、正金额和 CHECK 的最终 `VALIDATE CONSTRAINT`。

没有修改或删除历史付款事实；合法的无执行记录历史期初余额继续保持原状态和金额。

### 前端与清单分析器 RED

前端改造前缺少复合上传/登记 owner、稳定幂等尝试、fresh GET 付款版本核对和迟到
回调隔离。新增确定性测试锁定：

1. 只有服务端 `record_execution` 可打开实付对话框；
2. fresh GET 必须仍指向当前付款、当前版本和可用 capability；
3. 上传 UUID、`voucherFileId` 与 `idempotencyKey` 必须一致；
4. 金额、日期、密码、文件和 CAS 在一次尝试中不可漂移；
5. 双确认合并为一条上传/登记链，模糊失败重试不能生成第二个业务事实；
6. A→B 路由切换、卸载、重挂载和迟到 resolve/reject/finally 全部失败关闭；
7. 原始 capability 不能逃逸到展示状态，confirm 的提前退出只依赖页面拥有的原始
   primitive owner/generation，不回读可被改写的展示对象。

页面真实 owner 链使分析器必须识别写调用前的 fail-closed early return。首轮最小
实现后，多轮独立对抗复核继续构造会执行 getter、Proxy trap、隐式转换、默认参数
或解构参数的伪“纯”前置条件。最终 strict 模式只接受：

- `LogicalExpression`；
- `===` / `!==`；
- `!` / `typeof` / `void`；
- 无插值模板；
- 不含 member read、computed object key、spread 或副作用的值；
- 参数全为普通 Identifier 的本地纯 helper；
- 未被 shadow 的安全 `Boolean`；不接受 `Number`/`String` 对未知对象的转换。

直接 wrapper 参数中的 throw-only preflight helper 同样禁止默认参数和解构参数。
自定义 `.some`、getter、`delete`、宽松比较、关系/算术/位运算、模板插值和对象
隐式转换均失败关闭。分析器保留全站重复 `/files` 写封装和旧直接实付 wrapper 的
blocker，没有为了让本动作通过而掩盖全局问题。

本动作最终三条 binding 均为：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- `acceptedProductionConsumers` 包含
  `apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- 动作级 blocker 为空。

## 真实 PostgreSQL 16 迁移与并发门

本地 runner 创建一次性 `postgres:16`，只绑定回环地址，从空库顺序部署仓库全部
110 个迁移，再运行真实 Prisma Client、Nest service、并发 backend 和独立查询：

1. 合法存量和双 seed 均通过；
2. 14 类非法存量分别命中精确
   `payment_execution_*` marker，迁移整体回滚；
3. 重复幂等请求只形成 1 条 PaymentExecution、1 份凭证绑定、精确资金分配和
   1 条匹配审计；
4. 同幂等键但任一业务事实不同、同凭证不同实付、旧付款版本或超额支付均稳定
   失败且无部分写；
5. PaymentExecution 的 UPDATE 和 DELETE 都由数据库触发器拒绝；
6. PaymentRequest/Settlement 的金额、状态、执行合计、资金分配和审计逐项守恒；
7. `historical_takeover + linked execution + effective` 精确命中
   `payment_execution_settlement_owner_status_mismatch`；
8. 无执行记录的合法历史期初余额保持 `effective|400`，证明兼容边界没有被误删；
9. runner 无论成功、失败或中断都清理临时容器和目录。

独立后端复核再次完整运行 110 个迁移、14 类非法事实、双 seed 和四类真实并发
不变量，结论为 Ready；未访问生产数据库。

## 浏览器关键路径

在当前 production bundle 上仅于浏览器网络边界模拟 API：

- 1366×768 Chromium：完整登记实际付款；
- 390×844 实际 WebKit：移动端完整登记实际付款；
- 两条路径均严格为
  `GET 初读 -> GET fresh preflight -> POST /files -> POST /executions -> GET 刷新`；
- 双击确认后每端仍只有 1 次上传和 1 次实付 POST；
- 上传 UUID 与 `voucherFileId`、`idempotencyKey` 一致；
- 实付金额为 `5000000` 分，付款版本 CAS 与页面初读一致；
- 页面非空，无 console error、pageerror、框架错误层或横向溢出；
- 操作按钮和确认按钮均位于视口内且没有被其他元素遮挡；
- 桌面与移动截图均已人工检查。

证据截图：

- `apps/web-admin/test-results/payment-workbench.e2e.ts-P-8a0a3-e-fresh-GET-upload-and-POST-chromium/payment-execution-chromium-1366x768.png`
- `apps/web-admin/test-results/payment-workbench.e2e.ts-P-87c17-ut-duplicate-upload-or-POST-chromium/payment-execution-webkit-390x844.png`

截图目录由 Playwright 管理并已被 Git 忽略，不作为源码提交。

## 机器事实

相对上一个 Task 11 切片：

- Web API transport wrapper：381 → 382；
- Web API main binding：385 → 388；
- accepted action binding：18 → 20；
- unresolved action binding：32 → 31；
- covered production mutation consumer pair：13 → 14；
- page blocker：322 → 318；
- matrix blocker：保持 372；
- orphan wrapper：45 → 46；
- duplicate mutation route：4 → 5；
- registered action：保持 42；
- route：保持 395；
- unclassified route：保持 26。

当前矩阵精确为：

- 395 routes；
- 382 wrappers / 388 bindings；
- 42 registered actions / 51 action bindings；
- 20 accepted / 31 unresolved action bindings；
- 274 production mutation consumer pairs；
- 14 covered / 260 uncovered；
- 26 unclassified routes；
- 372 blockers。

`payment-execution.record` 的三条 accepted binding 为：

1. `GET /payments/:param`
2. `POST /files`
3. `POST /payments/:param/executions`

全站仍因 260 个未覆盖 mutation consumer、46 个 orphan wrapper、5 组重复写封装、
1 条 Web 请求无 Nest 目标、26 条未分类路由及其余未闭合动作保持 `blocked`。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `87cea9929c2147382a747525c6742c7bd5dc1ae2aa7676420ab4296ad65f403d`
- `web-page-actions.registry.json`：
  `a6186cc81bb91e7bb1d32608da50ae90a4b9edba798bc22060ab5779c02136ee`
- `web-page-actions.json`：
  `baf7cf41e4fcb38100f8805c5c5f3f5008aab2f519915b11e946225ebd59e203`
- `route-usage.json`：
  `5f586a7770a0f6b86648339b65893ef1c296f2bddc7067903e0f9aea003e4e7d`
- `whole-site-capability-matrix.json`：
  `205d39bd8006995d0c7410d0966150abf099a8fc074ae6f21f99350ae9831dd1`
- `whole-site-capability-matrix.md`：
  `c78d79ab2ed1909448e50aaeaacaab78e1d7438b276d17cc197b3b9b1acbca63`

## 验证

- 付款实付目标 API：9 套、377/377；
- API 全量 Jest：259 套通过、16 套条件跳过；5017 通过、48 跳过；
- 付款实付目标 Web Vitest：3 文件、95/95；
- Web 全量 Vitest：144 文件、1413/1413；
- page-action analyzer：71/71；
- manifest 共享目标：15 文件、149/149；
- 真实 PostgreSQL 16 空库：110 个迁移、14 类非法存量和四类并发不变量通过；
- 目标 Playwright production bundle：Chromium/WebKit 2/2；
- Web E2E typecheck：通过；
- API/Web typecheck：通过；
- 全 workspace lint：通过；
- Web `check:ui`：通过；
- API `check:business-errors`：扫描 398 个生产 TypeScript 文件，55 个精确内部
  sentinel，通过；
- Prisma validate/generate：通过；
- API/Web production build：通过，Web 仅保留既有大 chunk warning；
- Nest、Web API、page action、route usage、capability matrix 的 `--check`：
  内容确定；后三份继续按真实 blocker 报 `blocked`；
- API 全量首次高并发运行中，receipt watermark 测试因不可写 font cache/并发争用
  超时；使用可写 `XDG_CACHE_HOME` 隔离复跑 25/25，通过，随后同环境
  `--runInBand` 全量 259 套通过；
- 独立后端复核：Ready，无 P0/P1；
- 独立浏览器复核：无 P0/P1；
- 独立前端/分析器对抗复核：Ready，无 P0/P1；
- `git diff --check`：提交前再次执行。

## 剩余风险、未授权与下一步

非阻断 P2：

1. PaymentExecution 与父级金额/状态的未来跨表一致性仍主要依赖受控
   `SERIALIZABLE` 服务事务；数据库迁移会验证既有闭环并把执行本身设为不可变，但
   PostgreSQL CHECK 不能直接维护跨表总和。
2. 合法存量 runner 已覆盖历史期初余额；以后可再增加一笔实付由多个项目资金来源
   共同分摊的合法夹具，迁移和服务当前已支持该组合。
3. 旧直接 `recordPaymentExecution` wrapper 现在明确成为 orphan，`POST /files`
   仍有重复写封装；它们属于 Task 12 候选，必须等 Task 11 完成、静态零调用、
   生产批准窗口零调用和用户单独物理删除授权，不能在本切片删除。
4. 浏览器故障注入没有在 WebKit 再单独模拟迟到失败；同切片 Vitest 已覆盖迟到
   resolve/reject、路由切换、卸载和模糊失败重试。
5. 全站矩阵仍有上述 372 个范围外 blocker，不能把本动作绿色表述成 Task 11 或
   发布候选完成。

下一步只闭合 Task 11 的 `project-expense.withdraw`。它是剩余未接受页面业务写中
唯一已经使用详情 GET 的 `detail.availableActions` 精确 `withdraw` key 的动作，
当前只缺服务端 provenance 和 trigger→wrapper 因果证明；先不捆绑同页风险更高的
审批通过/驳回。该动作只撤回申请、审批实例、额度和审计事实，不包含物理 DELETE，
也不得借此提前进入 Task 12。

本切片未 push、合并、部署、执行生产迁移或修改生产业务数据。生产
temporary-only retention 的既有授权与本地 Task 11 改造保持隔离；业务草稿
purge、正式业务记录、AuditLog、checkpoint、旧表旧字段和其他物理删除继续关闭。
