# 实施包 5 Task 11：项目支出财务入账闭合

## 结论

本子任务只闭合 `project-expense.finance-local-status`，即既有
`ProjectExpenseRequest` 历史兼容域的财务入账。审批通过、实际付款和财务入账继续
保持为三个不同事实；本次只在已有实付范围内追加不可变 `FinanceRecord`、精确审计，
并在支出已经全额实付且财务入账完整覆盖实付后生成财务归档。

全站能力矩阵仍为 `blocked`。本记录不把收货确认、Task 11、实施包 5 或五个实施包
总门禁标记为完成。下一最小切片只能进入
`project-expense.receipt-confirm-local-status`，不能先进入 Task 12 或删除旧接口。

项目支出审批详情 GET 只在以下条件同时成立时发布唯一启用的 `record_finance` 和
`financeContext.expectedExpenseUpdatedAt`：

1. 当前账号仍启用；
2. 当前账号在本项目具有 `finance_staff` 或 `finance_director` 项目岗位；
3. 项目支出状态为 `partially_paid`、`paid` 或 `payment_blocked`；
4. 累计实付金额大于零；
5. 累计财务入账金额没有超过累计实付金额，且仍有待入账实付；
6. 项目支出有可发布的权威更新时间。

岗位只从当前项目的 `ProjectMember` 和项目级 `UserPosition` 派生。全局财务岗位、
其他项目岗位和已停用账号均不扩权。

## 后端不变量

`POST
/projects/:projectId/expense-requests/:expenseRequestId/finance-records`
强制接收：

- `expectedExpenseUpdatedAt`
- UUID v4 `idempotencyKey`
- 正整数分字符串 `amountCents`
- 合法且不晚于当前时间的 `occurredAt`
- 当前登录密码 `confirmationPassword`

服务先确认密码和精确项目/支出范围，再以 `SERIALIZABLE` 事务：

1. 按精确 `projectId + expenseRequestId` 锁定项目支出；
2. 重验账号启用状态以及本项目 `finance_staff|finance_director` 岗位；
3. 先按幂等键读取既有事实；只有项目、支出、空付款/结算来源、支出方向、金额、
   时间和经办人全部相同才返回同一持久事实；
4. 新写入重验项目支出更新时间 CAS、付款后状态、实付金额和剩余待入账金额；
5. 创建正向支出的 `FinanceRecord`，并更新父支出更新时间；
6. 写入 `project_expense.finance.record` 审计，冻结记录 ID、幂等键、金额、时间、
   入账前后累计和实付金额。

CAS、权限、状态、金额、审计、唯一键或序列化竞争任一失败时，财务记录、父级更新和
审计全部回滚。`P2002`、Prisma `P2034` 及原生 `40001` 只在重新读到完全相同事实时
返回赢家；其他竞争稳定返回 409。

只有支出状态已经为 `paid` 且财务累计完整覆盖实付，才尝试生成唯一
`project_expense_finance_archive` PDF 和财务归档记录。部分实付即使本期入账已覆盖
当前实付也不生成最终财务归档。财务事实已经提交但归档生成失败时返回可观测 503，
同一幂等请求重放既有事实并再次尝试归档，不制造第二条财务事实。

本切片不新增实付，不确认收货，不改变支出批准金额、实付金额或业务状态。

## 前端确认链

页面不直接调用 `fetch`。`core-flow-read.api.ts` 新增独立财务入账 wrapper 和
`recordProjectExpenseFinanceWithPreflight` 聚合确认链。页面保存后端原始 capability，
展示模型只使用 clone；确认时冻结：

- 组件 owner、route generation、详情 epoch 和对话框 generation；
- 项目 ID、支出 ID 和项目支出更新时间 CAS；
- 实付、已入账、待入账三个基线金额；
- 本次金额、时间、UUID v4 和当前密码；
- operation owner 和同尝试状态。

实际请求顺序为：

```text
初始 GET 原始 record_finance
  -> fresh GET 复核动作和 CAS
  -> POST finance-records
  -> GET 校验单调权威完成事实
  -> 最终 GET 重新装载页面详情
```

双击确认共用同一 Promise，只发送一个 POST。POST 200 必须逐项匹配幂等键、项目、
支出、空付款/结算来源、支出方向、金额、时间和非空经办人；完成 GET 还必须证明：

- 生命周期版本已经前移；
- 实付金额不回退；
- 已入账金额至少增加本次金额且不超过实付；
- 待入账金额精确等于实付减已入账；
- `record_finance` 与 `financeContext` 保持唯一且一致。

网络结果不明或 5xx/503 使用同一事实和 UUID 直接重试；密码错误只替换密码；确定性
4xx 清空本次尝试、刷新权威详情并要求重新确认。路由切换、组件重挂载、对话框重开、
迟到 preflight/POST/completion/finally 均不能污染新页面或提前解除新操作。提交期间
刷新、取消、右上角关闭、Esc 和遮罩关闭均不可用。

完成校验后的第五次 GET 是有意保留的安全取舍：completion helper 只证明服务端单调
事实，不把其结果直接注入页面共享展示状态；页面仍通过统一 `loadDetail()` 重新建立
权限、capability 和展示来源。

## 150000 前向迁移

新增 `20260728150000_project_expense_finance_idempotency`。迁移不选择、修复、合并、
删除或回填历史业务行；合法 legacy 项目支出财务记录保留 `NULL idempotencyKey`。

迁移在所有扫描前取得：

- 专用事务 advisory lock；
- `AuditLog`、`FinanceRecord`、`PdfDocument`、`Project`、
  `ProjectExpenseRequest`、`User` 六表 `ACCESS EXCLUSIVE NOWAIT`。

任何在途相关写入都会以
`project_expense_finance_migration_requires_quiescence` 立即失败，不等待锁升级。

存量 fail-closed 扫描覆盖：

- 财务记录到项目支出的 owner、项目和来源方向；
- 正金额、付款后状态及累计入账不超过实付；
- 所有 `FinanceRecord.createdByUserId` 对真实 `User` 的全局完整性；
- 财务记录到审计的正向精确匹配；
- 所有目标审计到财务记录的反向精确匹配；
- 审计重复；
- 项目支出财务归档 PDF 重复。

迁移安装：

- `FinanceRecord.idempotencyKey` 可空唯一索引和新写 UUID v4 格式门；
- 财务记录到同项目支出的组合外键；
- `FinanceRecord.createdByUserId -> User.id` 全局 `RESTRICT` 外键；
- 项目支出财务来源和正金额约束；
- 项目支出财务归档 PDF 的部分唯一索引；
- 每支出 advisory `NOWAIT`、actor `FOR KEY SHARE`、父支出 `FOR UPDATE` 及累计金额
  门；
- 项目支出 `FinanceRecord` update/delete 不可变；
- 财务记录和审计双向 deferred 闭合触发器；
- 目标财务审计 update/delete 不可变；
- 父支出项目、状态和实付投影不能使既有财务累计失真。

迁移最后才验证全部 `NOT VALID` 约束，整个过程处于单一事务；失败不会留下部分索引、
约束、函数或触发器。

## RED、独立复核与修复

改造前先以失败测试锁定：

- GET 没有按项目派生财务入账 capability、CAS 和剩余金额；
- 全局财务、其他项目财务或停用账号可能被误认为有权；
- POST 缺少 UUID 幂等、CAS、精确赢家重放和累计金额竞争保护；
- 财务记录、审计、父支出和最终归档之间缺少数据库闭合；
- 页面缺少 fresh GET、固定事实、响应事实校验、重试分类和迟到隔离；
- 历史存量缺少 fail-closed 迁移和真实 PostgreSQL 证据。

三轮独立迁移复核先后发现并以 RED 闭环：

1. 两个并发 `700 + 700` 可能各自基于旧累计提交；
2. 财务经办人缺少数据库外键，可能写入伪造或已物理删除用户；
3. 财务审计可更新/删除、重复或只单向校验；
4. orphan、空 ID 或错绑的历史财务审计可能在不可变门安装后被永久锁入。

前端独立复核发现“部分实付已全部入账”可能过早生成最终财务归档；修复后最终归档
必须同时满足支出状态 `paid` 和完整财务覆盖。最终后端、迁移、前端和浏览器复核均未
发现剩余 P0/P1。

最终门禁还发现旧英文内部错误允许项已经随财务认证错误中文化而失效。先由
`check:business-errors` 精确 RED，再删除这一条 stale allowlist；检查器自测和生产
源码扫描恢复通过，没有扩大英文业务错误豁免。

## 真实 PostgreSQL 16

最终项目支出财务 runner：

- 合法 legacy `NULL idempotencyKey` 存量原样保留；
- 14 类非法存量在各自数据库以精确 marker 失败并完整回滚；
- 在途 writer 使迁移立即失败，无死锁；
- 失败批次 `resolve --rolled-back` 后在隔离夹具修复并 retry 成功；
- 空库完整部署 112 个迁移，第二次 deploy 为零写，`migrate status` 通过；
- Prisma generate 和目标服务集成通过；
- 真实约束覆盖 actor 缺失/物理删除、审计孤儿/重复/update/delete、累计金额并发、
  相同幂等赢家重放和 PDF 唯一；
- 成功、失败和中断路径都清理一次性容器和临时目录。

150000 改变全局财务 actor 外键和共享事实约束后，既有 payment execution、
project-expense execution 和 settlement draft lifecycle 三个 runner 均在完整
112 迁移上重跑通过。所有 runner 只连接 `127.0.0.1` 的一次性 PostgreSQL 16
数据库，未连接生产数据库。

## 浏览器 P0

最终 production bundle：

- Chromium 1366×768；
- 实际 WebKit 390×844；
- 两端均严格执行
  `GET -> GET -> POST finance-records -> GET -> GET`；
- 双击确认只有一个 POST；
- POST 载荷使用冻结 UUID v4、CAS、金额和时间；
- 权威详情从已入账 200 元加本次 300 元单调更新为 500 元，待入账归零；
- 提交期间刷新、取消、关闭和 Esc 均被阻断；
- 页面无 console error、pageerror、框架错误层、横向溢出或嵌套横向滚动；
- 两张确认框截图已人工检查，桌面和移动端内容、按钮及风险说明均在视口内。

Playwright 结果为 2/2 通过。浏览器使用真实 production bundle、Vue/TDesign 页面和
API client，但登录与 API 在浏览器网络边界模拟，不等于真实账号或生产数据验收。

## 机器事实

相对上一个 Task 11 切片：

- Web API transport wrapper：385 → 386；
- Web API main binding：393 → 395；
- accepted action binding：25 → 26；
- unresolved action binding：保持 28；
- covered production mutation consumer pair：17 → 18；
- uncovered production mutation consumer pair：257 → 256；
- page blocker：307 → 304；
- matrix blocker：保持 367；
- orphan wrapper：47 → 48；
- duplicate mutation route：保持 5；
- registered action：保持 42；
- route：保持 395；
- unclassified route：保持 26。

当前矩阵：

- 395 routes；
- 386 wrappers / 395 bindings；
- 42 registered actions / 54 action bindings；
- 26 accepted / 28 unresolved action bindings；
- 274 production mutation consumer pairs；
- 18 covered / 256 uncovered；
- 26 unclassified routes；
- 367 blockers。

`project-expense.finance-local-status` 为
`serverDerived=true`、`dominatesTrigger=true`；GET preflight 和财务 POST 均有
同一页面 accepted consumer，POST 为 `causalVerified=true`。直接
`recordProjectExpenseFinance` wrapper 只有测试消费者，页面使用聚合 wrapper，
因此 orphan wrapper 47 → 48。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `25e516a928ff193dfd4d443660088e1691e142f7e9c3e0ee37494183a4be5f2e`
- `web-page-actions.registry.json`：
  `9010b5914d54bddbdba956ef9cf0e7c9a96cb3df358f9acf191bd3f475031321`
- `web-page-actions.json`：
  `d12555f0a830b84b0c132f64169a1dd13b0f257b86e994a3809968eba9612634`
- `route-usage.json`：
  `b9feaeb11a9b9408528df82962da419b993adffd147fc4408e4f3a81e9b4030d`
- `whole-site-capability-matrix.json`：
  `d28c1126a8c79c5b081e3c6c12e7b861799d1d6c549c79eb4d3938d6a3aa7ba3`
- `whole-site-capability-matrix.md`：
  `b1659dd8a352d8ac5575cbee9952227dfbdbd59fae1abcf6d539210541017362`

## 最终验证

- 目标 API：5 套、230/230；真实 PG 条件套件 1 套按环境跳过；
- PostgreSQL schema/runner 静态测试：10/10；
- API 全量：267 套通过、18 套条件跳过；5146 通过、50 跳过；
- 目标 Web：3 文件、126/126；
- Web 全量：148 文件、1470/1470；
- 共享领域：15 文件、149/149；
- 五份机器清单普通 check：通过，并按未完成事实保持 `blocked`；
- `--require-ready`：按预期失败，证明本切片没有伪报整站 ready；
- 项目支出财务、项目支出实付、付款实付和结算草稿四个真实 PG16 runner：
  完整 112 迁移通过；
- production bundle Playwright：Chromium/WebKit 2/2；
- workspace typecheck 和 lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API 业务错误检查器自测通过；生产源码扫描 399 个 TypeScript 文件、54 个精确
  内部英文哨兵，通过；
- API/Web build：通过；Web 4454 modules，只有既有大 chunk 提示；
- Prisma validate/generate：通过；
- `git diff --check`：通过。

API 全量测试里的 Fontconfig 无可写缓存提示及负向用例模拟错误日志为既有测试环境
噪声；所有断言通过，没有被表述为零日志验收。

## 剩余风险

非阻断 P2：

1. completion 校验后再执行一次统一 `loadDetail()`，比最短链多一次 GET；这是为隔离
   证明结果与页面共享展示来源而保留的安全取舍；
2. 直接财务 POST wrapper 只有测试消费者，聚合 wrapper 才是生产消费者。未经
   Task 12 零调用证据和独立删除授权不得删除；
3. `FinanceRecord.createdByUserId -> User.id` 是全局外键，生产若存在任何历史 actor
   orphan 会按设计阻断 150000。必须在 maintenance 下先只读预检，并对任何修复单独
   取得业务数据写入授权；
4. 生产存量尚未读取，150000 尚未在生产执行；六表 `ACCESS EXCLUSIVE NOWAIT`
   要求受控静默窗口；
5. 当前项目岗位、账号启用状态和密码确认没有把全部支撑行显式锁到事务结束；
   `SERIALIZABLE` 能给并发变更排序，但不提供“撤权操作在墙钟上先完成就必然优先”
   的额外承诺；
6. legacy `NULL idempotencyKey` 和历史审计沿用较弱闭合；新事实的数据库闭合也不
   校验审计中的 `projectId`、入账前后累计和实付投影，这些字段仍由应用事务保证；
7. 私有 PDF 文件上传发生在 `PdfDocument + ArchiveRecord + AuditLog` 事务之前。
   数据库竞争 loser 或第二事务失败可能留下未绑定私有文件；当前唯一索引只保证最终
   `PdfDocument` 唯一，没有把归档记录和 PDF 审计做成一组 deferred 数据库闭合；
8. production bundle 浏览器证据使用网络边界模拟，真实岗位、真实数据和真实私有
   文件归档仍留给发布阶段验收。

## 授权边界

本切片没有 push、合并、更新生产 checkout、生产部署、生产数据库迁移或生产业务
写入。temporary-only retention 已按既有独立授权执行过，本切片没有重复清理。
业务草稿 purge、正式业务记录、AuditLog、checkpoint、旧表旧字段和其他物理删除
继续关闭。
