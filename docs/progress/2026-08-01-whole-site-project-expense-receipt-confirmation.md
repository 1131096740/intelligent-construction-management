# 实施包 5 Task 11：历史项目支出收货确认闭合

## 结论

本子任务只闭合 `project-expense.receipt-confirm-local-status`，即既有
`ProjectExpenseRequest` 历史兼容域的收货确认。新建零星采购已经由后端返回 410，
正式新业务必须继续使用 `SpotProcurement`、`SpotProcurementReceipt` 及其现场照片、
服务端水印、委托和主管复核流程。

本切片不把 legacy 收货确认描述成正式零采收货，也不补造旧记录的历史照片。页面、
后端动作名称和确认文案均明确使用“历史项目支出收货确认”。实施包 5 Task 11
仍只完成一个能力矩阵 blocker；全站矩阵继续为 `blocked`，不得据此进入旧接口物理
删除或宣称五个实施包完成。

历史收货和付款允许任一先发生。详情 GET 只在以下条件同时成立时发布唯一启用的
`confirm_receipt`、`project_expense.receipt_confirm` 和
`receiptContext.expectedExpenseUpdatedAt`：

1. 项目支出类型为历史 `spot_purchase`；
2. 采购执行事实已经存在；
3. 当前账号启用；
4. 当前账号是该支出的原申请人；
5. 当前账号在本项目仍具有 `employee`、`material_staff` 或
   `project_manager` 之一；
6. 当前状态为 `approved_pending_payment`、`partially_paid`、`paid` 或
   `payment_blocked`；
7. 尚未确认收货，且支出有权威更新时间。

岗位只从当前项目的 `ProjectMember` 和项目级 `UserPosition` 派生。全局岗位、其他
项目岗位和停用账号均不扩权。收货已经确认后，详情不再发布普通作废动作，普通作废
写接口也明确拒绝，避免收货事实与父业务记录脱链。

## 后端不变量

`POST
/projects/:projectId/expense-requests/:expenseRequestId/receipt-confirmation`
强制接收：

- ISO 8601 `expectedExpenseUpdatedAt`；
- UUID v4 `idempotencyKey`；
- 当前登录密码 `confirmationPassword`；
- 可选收货备注 `note`。

服务先确认密码和精确项目/支出范围，再以 `SERIALIZABLE` 事务：

1. 按精确 `projectId + expenseRequestId` 锁定项目支出，不把 code alias 当作本动作
   的资源主键；
2. 事务内重验账号启用状态、当前项目岗位和原申请人身份；
3. 先处理同幂等键重放；只有项目、支出、确认人和备注完全相同才返回同一事实；
4. 新写入重验更新时间 CAS、历史零采类型、采购执行、允许状态和未确认收货；
5. 原子写入确认人、确认时间、UUID、备注和父级更新时间；
6. 同事务写入 `project_expense.receipt.confirm` 审计，冻结支出编号、项目、
   幂等键、确认人、确认时间、备注、确认时状态和付款是否完成。

密码、权限、CAS、类型、采购执行、状态、唯一键或审计任一失败时，父级和审计全部
回滚。Prisma `P2002`、`P2034` 及原生 `40001` 只在重新读到完全相同事实时返回并发
赢家；其他竞争稳定返回 409。

同键同事实重放不要求旧 CAS 仍等于当前更新时间，但仍重验当前账号、当前项目岗位
和原申请人身份。该顺序允许网络结果不明后安全重试，同时不让已撤权账号借历史幂等
键继续读取受保护结果。

本切片不新增付款、财务入账、资金分配、照片、收货委托、主管复核或正式零采状态。

## 前端确认链

页面不直接调用 `fetch`。`core-flow-read.api.ts` 提供唯一公开生产入口
`confirmProjectExpenseReceiptWithPreflight`；底层 POST transport 已收为模块私有，
没有制造新的孤儿 wrapper。

页面保存后端原始 capability，展示模型只使用 `structuredClone`。打开确认框时冻结：

- 组件 owner、route generation、detail epoch 和 dialog generation；
- capability generation 和 operation owner；
- 项目 ID、支出 ID 和支出更新时间 CAS；
- UUID v4、备注和同尝试状态。

实际请求顺序为：

```text
初始 GET 原始 confirm_receipt
  -> fresh GET 复核动作和 CAS
  -> POST receipt-confirmation
  -> GET 校验权威完成事实
```

双击确认共用同一 Promise，只发送一个 POST。POST 200 必须逐项匹配项目、支出、
幂等键、确认人、确认时间、备注和单调更新时间；完成 GET 还必须证明：

- 生命周期更新时间不回退；
- 收货确认人、时间、UUID 和备注与 POST 事实一致；
- `confirm_receipt` 和 `receiptContext` 已撤下；
- 页面仍位于同一 route、detail、dialog 和 operation owner。

网络结果不明或 5xx 使用同一事实和 UUID 重试；密码错误只替换密码；确定性 4xx
清空本次尝试、刷新权威详情并要求重新确认。路由切换、组件重挂载、对话框重开及
迟到 preflight、POST、completion、catch、finally 均不能污染新页面或提前解除新
操作。提交期间刷新、取消、右上角关闭、Esc 和遮罩关闭均不可用。

清单分析期间发现并闭合三项 capability provenance 回退和一项出口面 blocker：

1. 传给聚合 wrapper 的 `isCurrent` 闭包读取了原始 capability；
2. 将随后写回 capability 的 `serverDetail` 原对象交给外部完成校验 helper；
3. wrapper 参数对象使用动态 conditional spread 传递可选备注。
4. 底层收货 transport 仍对外导出，但生产页面只消费同模块聚合 wrapper，因而形成
   新 orphan。

最终实现把 wrapper 回调收窄为纯 route/generation/dialog/owner 标量检查，完整
capability/detail 一致性仍由页面提交和完成链校验；完成 helper 只接收
`structuredClone(serverDetail)`；selection 始终冻结字符串备注，空串仍由 API 层
规范化后省略；底层 transport 收为模块私有。没有放宽 capability 分析器或用
registry 豁免 orphan。

## 160000 前向迁移

新增 `20260728160000_project_expense_receipt_confirmation`。迁移不修复、删除、
合并或回填历史业务行；合法 legacy 收货事实继续允许
`NULL receiptConfirmationIdempotencyKey`。

迁移在任何存量扫描前取得：

- 专用事务 advisory lock；
- `AuditLog`、`ProjectExpenseRequest` 和 `User` 三表
  `ACCESS EXCLUSIVE NOWAIT`。

真实在途写夹具持有 `ROW EXCLUSIVE`，并通过 `pg_stat_activity`、`pg_locks` 和
精确 `RowExclusiveLock` 等待就绪。迁移必须以
`project_expense_receipt_migration_requires_quiescence` 立即失败，不能以固定睡眠
猜测锁已经建立。

存量 fail-closed 扫描覆盖：

- 收货字段 tuple 形状；
- 历史零采、采购执行和允许状态业务事实；
- 确认 actor 对真实 `User` 的完整性；
- 收货到审计的正向精确匹配；
- 审计到收货的反向精确匹配；
- 重复收货审计。

迁移安装：

- 可空唯一 `receiptConfirmationIdempotencyKey` 和新写 UUID v4 门；
- 确认 actor 到 `User` 的 `RESTRICT` 外键；
- 收货 tuple、业务事实和 actor 约束；
- 新确认只能从尚未收货的合法历史零采行产生；
- 收货后确认字段、项目、编号、类型、申请人、采购执行及主键不可变；
- 付款和状态可以在四个允许状态内继续前移，但普通作废被数据库拒绝；
- 收货与精确审计双向 `DEFERRABLE INITIALLY DEFERRED` 闭合；
- 收货审计 update/delete 不可变。

主键在首次确认分支和确认后分支同时冻结，避免父行改 ID 后留下永久孤立审计。
约束在存量扫描后以 `NOT VALID` 安装并在同一事务末尾验证；失败不留下部分索引、
函数、触发器或约束。

## RED、独立复核与修复

改造前先以失败测试锁定：

- GET 没有服务端派生收货 capability、CAS 和确认事实；
- 全局岗位、其他项目岗位、停用账号或非申请人可能被误认为有权；
- POST 缺少 UUID、CAS、精确赢家重放和事务内撤权复核；
- 页面缺少 fresh GET、固定事实、重试分类、响应事实校验和迟到隔离；
- 数据库旁路可以制造孤立确认、孤立审计、重复审计或可变收货事实；
- 并发测试可能顺序执行却伪装成两个事务真实竞争。

独立后端/迁移复核发现并闭合三项 P1：

1. 确认时和确认后不可变门遗漏父级主键，可能使收货与审计脱链；
2. 收货先于付款时仍能发布或直调普通作废，数据库最终以 500 暴露；
3. 两个并发确认没有 barrier 或直接阻塞证据，顺序执行也可能通过。

最终迁移冻结主键，详情和写接口都拒绝收货后的普通作废；真实并发测试使用双 PID、
暂停首事务、`pg_blocking_pids` 直接观察阻塞，再释放赢家并核对最终父行、审计和
UUID 精确一致。最终独立复核未发现剩余 P0/P1。

提交前总 diff 审查又发现并闭合三项 P2：

1. 列表读模型虽然知道 `isReceiptConfirmed=true`，仍可能发布普通 `void`；
2. 重复收货审计虽然有迁移扫描和唯一索引，但缺少独立真实坏存量数据库；
3. Nest 层 `P2002`、`P2034`、`P2010/40001` 并发翻译缺少精确赢家、异事实赢家
   和无赢家的定向单测。

最终列表、详情、写接口和数据库四层都拒绝收货后的普通作废；runner 新增重复审计
存量库并证明迁移精确失败且完整回滚；服务单测锁定三类并发错误只返回完全相同的
赢家，否则按唯一冲突或序列化冲突稳定返回 409。

完整 API 门还捕获并修正三类静态契约漂移：required text 字段计数、legacy
`ProjectExpenseRequest` 字段白名单，以及两个依赖 Prisma 对齐空格的脆弱 Schema
断言。Schema 断言改为规范化空格后检查字段语义，没有降低字段覆盖。

## 真实 PostgreSQL 16

最终收货 runner：

- 合法 legacy `NULL idempotencyKey` 原样保留；
- 六类非法存量分别以精确 marker 失败并完整回滚，其中独立覆盖重复收货审计；
- 真实 `ROW EXCLUSIVE` 在途写使迁移立即失败；
- 空库完整部署 113 个迁移，第二次 deploy 为零写；
- 双连接并发只产生一个赢家，loser 无部分父行或审计；
- 主键、确认 tuple、actor、UUID、业务事实、正反向审计及不可变门均由真实数据库
  验证；
- 成功、失败和中断路径都清理一次性容器和临时目录。

160000 改变共享父行和审计边界后，既有 payment execution、project-expense
execution、project-expense finance 和 settlement draft lifecycle 四个 PostgreSQL
16 runner 也在完整 113 个迁移上重跑通过。所有 runner 只连接 `127.0.0.1` 的
一次性数据库，未连接生产数据库。

## 浏览器 P0

最终 production bundle：

- Chromium 1366×768；
- 实际 WebKit viewport 390×844；
- 两端均严格执行
  `GET -> GET -> POST receipt-confirmation -> GET`；
- 双击确认只有一个 POST；
- 非空备注、CAS、UUID v4 和密码载荷均被断言；
- 完成后权威详情撤下收货 capability；
- 提交期间刷新、取消、关闭和 Esc 均被阻断；
- 页面无 console error/warn、pageerror、框架错误层、整页横向溢出或嵌套横向
  滚动；
- 桌面和移动截图均显示“历史项目支出收货确认”和“确认历史项目支出已收货？”。

Playwright 为 2/2。浏览器使用真实 production bundle、Vue/TDesign 页面和 API
client，但登录与 API 在浏览器网络边界模拟，不等于生产真实账号和真实业务数据
验收。

## 机器事实

相对上一个 Task 11 切片：

- Nest route：保持 395；
- Web API transport wrapper：保持 386；
- Web API main binding：395 → 396；
- orphan wrapper：保持 48；
- registered action：保持 42；
- accepted action binding：26 → 27；
- unresolved action binding：保持 28；
- covered production mutation consumer pair：18 → 19；
- uncovered production mutation consumer pair：256 → 255；
- page blocker：304 → 301；
- matrix blocker：367 → 366；
- unclassified route：保持 26。

当前矩阵：

- 395 routes；
- 386 wrappers / 396 bindings；
- 42 registered actions / 55 action bindings；
- 27 accepted / 28 unresolved action bindings；
- 274 production mutation consumer pairs；
- 19 covered / 255 uncovered；
- 26 unclassified routes；
- 366 blockers。

`project-expense.receipt-confirm-local-status` 为
`serverDerived=true`、`dominatesTrigger=true`；fresh GET 和收货 POST 均为
`causalVerified=true`。POST mutation binding 已 accepted；GET 因
`binding_not_mutation` 不计入 matrix accepted，符合既有规则。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `af305574215b5cbc59f631c02d04e1900e5b03772409b017bbd644036047a0eb`
- `web-page-actions.registry.json`：
  `f0d4dfd00779761f996c0e3a3ed416a54e9bc223b62006365f20d5bd13f944a4`
- `web-page-actions.json`：
  `2fb2b2ffae1e81837fa21a80a47d3cfdb45a569a9c0b026df390b56d03062278`
- `route-usage.json`：
  `51627284a66652574b8268633f10a87c3721c2df39172725617d0232acff9cb1`
- `whole-site-capability-matrix.json`：
  `a3dc3f9430a7b29c204c9668744dabf93326c79b55da5fdf157a8db41de4fa35`
- `whole-site-capability-matrix.md`：
  `4180ba4ddb9b23d17d574be790c8e73acfce3d7cad957751aa375765d217ea34`

## 最终验证

- 目标 API：4 套、249/249；
- API 全量：269 套通过、19 套条件跳过；5180 通过、51 跳过；
- 收货真实 PostgreSQL 16：1/1，完整 113 迁移；
- 下游四个真实 PostgreSQL 16 runner：全部通过；
- 目标 Web：4 文件、126/126；
- Web 全量：150 文件、1481/1481；
- 共享领域：15 文件、149/149；
- 五份机器清单普通 check：全部通过，并按未完成事实保持 `blocked`；
- 四个适用的 `--require-ready`：按预期失败，证明未伪报整站 ready；
- production bundle Playwright：Chromium/WebKit 2/2；
- workspace typecheck、API/Web lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API 业务错误检查器自测通过；生产源码扫描 399 个 TypeScript 文件、54 个精确
  内部英文哨兵，通过；
- API/Web build：通过；Web 只有既有大 chunk 提示；
- Prisma format、validate、generate：通过，Client v5.22.0；
- `git diff --check`：通过。

API 全量测试里的 Fontconfig 默认配置提示及负向用例模拟错误日志为测试环境噪声；
所有断言通过，没有被表述成零日志验收。

## 剩余风险

非阻断 P2：

1. legacy 收货没有现场照片、水印、委托和主管复核；这是明确的历史兼容例外，
   不能作为正式 `SpotProcurementReceipt` 的替代；
2. 收货确认后没有 legacy 收货反向更正流程，因此普通作废同时在服务和数据库关闭；
   若生产出现错误确认，需要另行设计追加式更正，不能直改或删除原事实；
3. 当前项目岗位和账号启用支撑行没有全部显式锁到事务结束；`SERIALIZABLE` 提供
   并发排序，但不承诺撤权和确认的墙钟优先级；
4. 合法 legacy `NULL idempotencyKey` 和旧审计沿用较弱闭合，新规则只对新写事实
   强制 UUID 和精确双向审计；
5. 生产存量尚未读取，160000 尚未在生产执行；三表
   `ACCESS EXCLUSIVE NOWAIT` 要求受控 maintenance 静默窗口；
6. 浏览器证据使用网络边界模拟，真实岗位、真实历史支出和生产权限仍留给获批发布
   阶段验收；
7. 全站仍有 366 个矩阵 blocker，Task 11、Task 12、实施包 5 和五包总门禁均未
   完成。

## 授权边界

本切片没有 push、合并、更新生产 checkout、生产部署、生产数据库迁移或生产业务
写入。temporary-only retention 已按既有独立授权执行过，本切片没有重复清理。
业务草稿 purge、正式业务记录、AuditLog、checkpoint、旧表旧字段和其他物理删除
继续关闭。
