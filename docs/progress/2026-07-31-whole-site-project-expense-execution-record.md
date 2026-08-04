# 实施包 5 Task 11：项目支出实际付款登记闭合

## 结论

本子任务只闭合 `project-expense.execution-local-status`，即既有
`ProjectExpenseRequest` 历史兼容域的实际付款登记。审批通过仍只代表
`approved_pending_payment`，本次才产生不可变实付、唯一凭证、项目资金分配、
父级累计和审计事实。

全站能力矩阵仍为 `blocked`。本记录不把项目支出财务入账、收货确认、Task 11、
实施包 5 或五个实施包总门禁标记为完成。下一最小切片只能进入
`project-expense.finance-local-status`，不能先进入 Task 12 或删除旧接口。

项目支出审批详情 GET 只在以下条件同时成立时发布唯一启用的
`record_execution` 和 `executionContext.expectedExpenseUpdatedAt`：

1. 当前项目支出为 `approved_pending_payment` 或 `partially_paid`；
2. 存在批准金额，且批准金额大于累计已付金额；
3. 零星采购已经完成采购执行；
4. 当前账号仍启用；
5. 当前账号在本项目具有 `finance_staff` 项目岗位；
6. 项目支出有可发布的权威更新时间。

全局财务岗位、财务主管岗位、其他项目的财务岗位和已停用账号均不能获得该动作。
申请人或审批人只有在同时满足本项目财务人员条件时才能登记实付。

## 后端不变量

`POST
/projects/:projectId/expense-requests/:expenseRequestId/executions`
强制接收：

- `expectedExpenseUpdatedAt`
- UUID v4 `idempotencyKey`
- 整数分字符串 `amountCents`
- 合法且不晚于当前时间的 `paidAt`
- `voucherFileId`
- 当前登录密码 `confirmationPassword`

服务先完成密码确认，再以 `SERIALIZABLE` 事务按固定顺序：

1. 锁定项目和本项目可用融资额度；
2. 按精确 `projectId + expenseRequestId` 锁定项目支出；
3. 重验账号启用状态及本项目 `finance_staff` 岗位；
4. 先按幂等键读取已有实付；只有项目、支出、金额、时间、经办人和凭证全部相同
   才返回同一持久事实；
5. 新写入必须核对项目支出 CAS、付款状态、批准金额、剩余金额和零星采购执行；
6. 以统一文件 advisory lock 和行锁证明凭证仍为 active、当前经办人本人上传且未
   绑定任何其他业务；
7. 创建 `ProjectExpenseExecution`；
8. 按“项目现金优先、融资额度补足”创建一条或多条
   `ProjectFundingAllocation`；
9. 原子累计 `paidAmountCents`，并迁移为 `partially_paid` 或 `paid`；
10. 写入 `project_expense.execution.record` 审计，记录金额、时间、凭证、幂等键、
    状态变化及资金来源明细。

资金不足、剩余金额竞争、凭证竞争、CAS 变化、权限变化、审计失败或任一数据库约束
失败时，实付、资金分配、父级累计和审计全部回滚。序列化冲突或唯一约束竞争后只会
读取相同幂等事实；不同事实稳定返回 409。

本切片不创建 `FinanceRecord`，不办理收货确认，不写 Task 12 业务事实。

## 前端确认链

页面不直接调用 `fetch`。`core-flow-read.api.ts` 新增：

- 单独实付 POST wrapper；
- `GET -> 文件上传 -> 实付 POST` 聚合 wrapper；
- 上传和实付共用同一个 UUID v4 逻辑幂等键。

页面保存后端原始 capability，展示模型只使用 clone。实付表单采集金额、日期和
PDF 凭证；打开敏感确认框时冻结：

- 组件 owner；
- route generation、详情 epoch、对话框 generation；
- 项目 ID、支出 ID 和 `expectedExpenseUpdatedAt`；
- 金额、日期、文件内容及当次 UUID；
- 当前密码和 operation ID。

确认链为：

```text
初始 GET 原始 record_execution
  -> 打开 SensitiveActionDialog
  -> fresh GET 复核同一动作和 CAS
  -> 用同一 UUID 上传唯一凭证
  -> POST execution
  -> GET 权威详情刷新
```

同一次尝试遇到网络结果不明时继续复用 UUID，不上传第二份逻辑凭证。双击、路由
A→B、组件卸载/重挂载、对话框取消/重开、迟到 GET、迟到上传、迟到 POST 和非
owner `finally` 都不能污染新页面或提前解除新操作。提交期间刷新、取消、右上角
关闭、Esc 和遮罩关闭均不可用。

## 140000 前向迁移

新增
`20260728140000_project_expense_execution_idempotency`。迁移只允许给合法历史
`ProjectExpenseExecution` 生成确定性
`legacy:project_expense_execution:<executionId>` 幂等键；不会选择、删除或自动
修复任何历史业务行。

迁移安装：

- `ProjectExpenseExecution.idempotencyKey` 非空、格式和唯一约束；
- `voucherFileId` 全局唯一；
- `ProjectExpenseRequest(id, projectId)` 和
  `ProjectFinancingQuota(id, projectId)` 组合唯一；
- execution 到 request/project/file/user 的外键；
- financing allocation 到同项目 quota 的组合外键；
- 金额、状态、累计已付和 project-expense allocation 方向约束；
- execution 不可更新、不可删除触发器；
- project-expense allocation 精确 owner、不可更新/删除和提交时总额守恒触发器；
- execution 提交时父级累计、凭证、资金分配和精确审计闭合触发器；
- `voucherFileId` 纳入统一独占文件业务绑定注册表。

迁移前只读扫描并精确拒绝：

- 重复凭证；
- 凭证非 active、上传人与经办人不一致或跨业务复用；
- execution 与 request/project 不一致；
- 父级累计、付款状态或金额不一致；
- 资金分配缺失、金额/owner 不一致；
- orphan 或 reversal 项目支出资金分配；
- 跨项目融资额度；
- 审计缺失或审计金额、execution、凭证不一致。

迁移要求受控静默窗口。它先尝试专用事务 advisory lock，再对四张资金事实表使用
`ACCESS EXCLUSIVE NOWAIT`，对统一文件注册表涉及的其他表使用
`SHARE ROW EXCLUSIVE NOWAIT`。任何在途写入都会以
`project_expense_execution_migration_requires_quiescence` 立即失败，不等待锁升级，
不产生死锁或部分安装。

旧的 `ProjectExpenseExecution_voucherFileId_idx` 虽因新唯一索引而冗余，本批仍
明确保留。删除该索引属于当前未授权的物理 schema 清理，不随普通迁移夹带执行。

## 失败迁移恢复门

真实 PG16 runner 已演练：

1. 审计缺失存量使 140000 精确失败；
2. 事务内新增列、索引、约束、函数和触发器全部回滚，旧索引仍保留；
3. 使用 `prisma migrate resolve --rolled-back
   20260728140000_project_expense_execution_idempotency` 标记失败批次；
4. 在隔离夹具中补齐经批准的缺失审计；
5. 重新执行迁移成功；
6. `_prisma_migrations` 精确得到一条 rolled-back 和一条 finished 记录，legacy
   幂等键正确生成。

生产若预检或迁移失败，必须保持 maintenance，先读取本次 PostgreSQL 日志中的精确
marker，并单独取得业务数据修复授权。不得因本地演练自动修改生产数据。修复后再
执行 `resolve --rolled-back`、只读复核和迁移重试。

## RED 与修复证据

改造前先以失败测试锁定：

- GET 不发布后端实付 capability 和 CAS；
- 全局财务岗位或其他项目财务岗位可能越权；
- 实付缺少 UUID 幂等、唯一凭证、剩余金额竞争和稳定 replay；
- 资金不足可能留下 execution、父级累计或审计孤儿；
- 页面缺少 raw capability、fresh GET、同尝试 UUID、route/detail/dialog owner
  和迟到隔离；
- 现有历史存量缺少 fail-closed 迁移和真实 PostgreSQL 证据。

全量 API 首轮暴露 13 项旧测试夹具漂移，逐项补齐新后端不变量，没有放宽实现。
独立迁移复核随后发现并以 RED 闭环：

- 合法 `payment_blocked` 部分实付历史被错误拒绝；
- 反向扫描漏掉 orphan/reversal 资金分配；
- 融资额度只按 ID 外键，可能跨项目；
- 服务写入锁序与迁移锁升级可能形成等待环；
- 原 runner 累计 Docker 日志会污染后续相同 marker 案例；
- 失败迁移缺少 resolve/retry 证据；
- 真实成功路径只覆盖单条项目现金分配。

真实 PG runner 的夹具调试还先后暴露跨项目 quota 缺少 `updatedAt`、静默窗口夹具
使用非法支出子类型，以及 Prisma 只保留事务后续 `25P02`、未保留最初 `55P03`
marker。最终 runner 改为轮询真实 relation lock，并按每次迁移前后 PostgreSQL 日志
增量取证；这些失败均在一次性本地库发生，容器自动清理。

## 真实 PostgreSQL 16

最终项目支出 runner：

- 从 110 个历史迁移创建 pre-140 模板；
- 合法存量保留，包括 `payment_blocked` 的部分实付；
- 13 类非法存量在各自数据库以精确 marker 失败并完整回滚；
- 在途资金写入持有四张事实表真实 relation lock 时，140000 立即失败，无死锁，
  写入在迁移回滚后自然完成；
- 失败迁移 resolve、补齐事实并 retry 成功；
- 空库完整部署 111 个迁移，第二次 deploy 为零写；
- Prisma generate、API build 成功；
- 真实服务竞争覆盖剩余金额、同 UUID replay、跨项目同凭证、资金不足零写、
  直接绕过服务的闭合触发器拒绝和 execution update/delete 拒绝；
- 现金 300 分加本项目融资额度 700 分生成两条 allocation，延迟总额/闭合触发器
  在提交时通过；
- 并发测试 1/1 通过；
- 成功、失败和中断路径都清理精确一次性容器和临时目录。

140000 增加全局资金组合外键后，既有两个 runner 也重新在完整 111 迁移上通过：

- payment execution：合法存量、14 类非法存量失败回滚、双 seed 和四类真实并发；
- settlement draft lifecycle：submit/abandon 双赢家顺序。

所有 runner 只连接 `127.0.0.1` 固定命名的一次性 PostgreSQL 16 数据库，未连接
生产数据库。

## 浏览器 P0

最终 production bundle：

- Chromium 1366×768：项目支出实付主路径；
- 实际 WebKit 390×844：相同主路径和移动响应式；
- 两端均严格执行
  `GET -> GET -> POST /files -> POST /executions -> GET`；
- 双击确认只有一个上传和一个 execution POST；
- 上传 UUID 与 execution UUID 相同且符合 UUID v4；
- 提交期间刷新、取消、关闭和 Esc 均被阻断；
- 提交成功后权威详情从部分付款刷新为已付清；
- 页面无 console error、pageerror、框架错误层、横向溢出或嵌套横向滚动；
- 两张确认框截图已人工检查，内容、按钮和风险说明均在视口内。

Playwright 结果为 2/2 通过。

## 机器事实

相对上一个 Task 11 切片：

- Web API transport wrapper：384 → 385；
- Web API main binding：390 → 393；
- accepted action binding：23 → 25；
- unresolved action binding：保持 28；
- covered production mutation consumer pair：16 → 17；
- uncovered production mutation consumer pair：258 → 257；
- page blocker：310 → 307；
- matrix blocker：保持 367；
- orphan wrapper：46 → 47；
- duplicate mutation route：保持 5；
- registered action：保持 42；
- route：保持 395；
- unclassified route：保持 26。

当前矩阵：

- 395 routes；
- 385 wrappers / 393 bindings；
- 42 registered actions / 53 action bindings；
- 25 accepted / 28 unresolved action bindings；
- 274 production mutation consumer pairs；
- 17 covered / 257 uncovered；
- 26 unclassified routes；
- 367 blockers。

`project-expense.execution-local-status` 为
`serverDerived=true`、`dominatesTrigger=true`，三个 GET/upload/execution
binding 均有同一页面 accepted consumer 和 `causalVerified=true`。矩阵仍把聚合
wrapper 的 GET preflight 单独登记为 `binding_not_mutation`，因此整体 blocker 不降；
真正的 execution POST 已为 covered。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `434c337c181607e00feba9bfa5e9057e7807a395e7e3682c4dcb393026226923`
- `web-page-actions.registry.json`：
  `6cfcd174ebab7c9299dcd03369cb47d54f8f6cfda1c1beef491e82f14a7432c4`
- `web-page-actions.json`：
  `7d341d70529526c115e985521f60e212b433856d7c10133ebb2ee2c98246e587`
- `route-usage.json`：
  `c8e8d1109da9990ad4230bc55cf8123c08a2cdadbf4b39a578db4906e922a1eb`
- `whole-site-capability-matrix.json`：
  `1b0b414a8a52484b5ff20c3846da46f91eb585e609da44a5159f6feabc3da94d`
- `whole-site-capability-matrix.md`：
  `16f6eb41dcc72ee190cdd3bdf53476a601283a5ee913406d172aa6c5baac1ac1`

## 最终验证

- 目标 API：9 套、264/264；
- PostgreSQL schema/runner 静态测试：9/9；
- API 全量：265 套通过、17 套条件跳过；5116 通过、49 跳过；
- 目标 Web：4 文件、135/135；
- Web 全量：147 文件、1462/1462；
- 共享领域：15 文件、149/149；
- 五份机器清单 check：通过，整体按未完成事实保持 `blocked`；
- 项目支出、付款执行和结算草稿三个真实 PG16 runner：完整 111 迁移通过；
- production bundle Playwright：Chromium/WebKit 2/2；
- workspace typecheck 和 lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API `check:business-errors`：扫描 399 个生产 TypeScript 文件，55 个精确内部
  英文哨兵，通过；
- API/Web build：通过；Web 4454 modules，只有既有大 chunk 提示；
- Prisma validate/generate：通过；
- `git diff --check`：通过。

API 全量测试里的 Fontconfig 无可写缓存提示及负向用例模拟错误日志为既有测试环境
噪声；所有断言通过，没有被表述为零日志验收。

## 独立复核与剩余风险

后端权限/金额/幂等、迁移 SQL、真实 PG runner、前端因果链、manifest 和浏览器路径
均经过独立只读复核。首轮发现的 `payment_blocked`、反向资金扫描、跨项目 quota、
锁升级和日志串案 P1 均以 RED、最小实现和真实 PG16 证据闭环。最终复核未发现
剩余 P0/P1。

非阻断 P2：

1. 闭合事实触发器在 `ProjectExpenseExecution AFTER INSERT` 校验；具备数据库直连
   权限者后续直接修改父申请、凭证状态/上传人或匹配审计，仍可能让闭合事实漂移。
   应用写路径、文件绑定守卫和当前删除门禁止这些旁路，后续可增加支撑表更新/删除
   触发器作为数据库防御纵深；
2. legacy 幂等键约束只要求
   `legacy:project_expense_execution:` 后缀为非空可见字符，没有数据库级绑定当前
   execution ID。新 API DTO 和服务只接受 UUID v4，风险仅限数据库直连旁路；
3. 旧 `voucherFileId` 普通索引与新唯一索引并存。当前删除门关闭，明确接受该冗余；
4. `recordProjectExpenseExecution` 直接 wrapper 只有测试消费者，聚合 wrapper 才是
   生产消费者，因此 orphan wrapper 46 → 47。未经 Task 12 零调用证据和独立删除
   授权不得删除；
5. 生产存量尚未读取，140000 尚未在生产执行。生产发布必须在 maintenance 下先做
   只读预检，并单独取得迁移和任何存量修复授权。

## 授权边界

本切片没有 push、合并、更新生产 checkout、生产部署、生产数据库迁移或生产业务
写入。temporary-only retention 已按既有独立授权执行过，本切片没有重复清理。
业务草稿 purge、正式业务记录、AuditLog、checkpoint、旧表旧字段和其他物理删除
继续关闭。
