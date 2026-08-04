# 实施包 5 Task 11：零星采购审批通过与驳回动作闭合

## 结论

本子任务只闭合：

- `spot-procurement.review-approve`
- `spot-procurement.review-reject`

不把 Task 11、实施包 5 或五个实施包总门禁标记为完成。能力矩阵仍为
`blocked`，下一最小切片是 `payment-approval.approve` /
`payment-approval.reject`。

零星采购详情 GET 现在只在满足以下条件时发布 `review_approval` 能力和审批坐标：

1. 当前采购版本处于申请审批中；
2. 精确匹配
   `businessType=spot_procurement_version`、
   当前版本、`flowType=spot_procurement.application` 和
   `status=in_progress`；
3. 匹配中的审批实例恰好一条；
4. 当前账号是冻结节点的直接审批人、有效转审接收人或有效委托人；
5. 普通申请人不得审批本人申请。

不满足任一条件时，GET 不泄露审批实例 ID；重复进行中实例会让
`review_approval` 失败关闭，并返回稳定禁用原因。

审批 POST 强制提交：

- `expectedVersionId`
- `expectedApprovalInstanceId`
- `expectedNodeIndex`

事务先锁采购和当前版本，再按稳定顺序锁住全部精确进行中的审批实例。锁后基数不是
一条时返回 409；先完成当前节点身份、自审规则与权限判断，再核对客户端冻结坐标。
无权或普通申请人自审返回 403，不能利用 409 探测内部坐标。陈旧版本、实例或节点、
重复实例及并发 loser 均为 409 且零业务写。合法 winner 的审批动作日志、业务审计与
状态迁移在同一事务中提交。

前端页面不直接 `fetch`。点击通过或驳回时冻结 route generation、detail epoch、
dialog generation、组件 owner、采购、版本、审批实例、节点、decision 和驳回原因。
写入前由独立 GET wrapper 做 fresh preflight；只有最新页面、最新对话框和当前 owner
仍与原能力及坐标完全一致时，才调用唯一 POST wrapper。旧路由响应、重挂载、重复
点击、交叠请求、迟到 resolve/reject/finally 均不能关闭新对话框、刷新新页面或提前
解除新操作的 busy。

本轮未修改 Prisma Schema 或迁移。

## RED 与最小实现

### 后端 RED

改造前的失败证据覆盖：

1. GET/POST 会从多个进行中实例中任取一条，重复实例未失败关闭；
2. DTO 没有版本、审批实例和节点坐标，旧确认可跨版本或跨节点提交；
3. 无权账号与坐标冲突的错误优先级不稳定，可能泄露内部并发事实；
4. 同一账号兼任多个岗位时，重放旧请求可能串行跨过两个审批节点；
5. 并发请求缺少真实数据库直接阻塞和 loser 零写证据；
6. GET 对普通读者的实例 ID 隔离、转审/委托、自审与重复实例均缺专属回归。

最小实现只增加审批坐标、精确锁后基数检查和现有事务内的 CAS；没有新增审批引擎、
工作流抽象、数据库约束或迁移。

### 前端 RED

改造前两个动作均为：

- `serverDerived=false`
- `dominatesTrigger=false`
- `causalVerified=false`

页面通过共享的可变 action kind 和通用执行器办理审批，没有 fresh GET、审批坐标、
operation owner 或重挂载隔离。新增确定性测试先锁定：

1. 通过与驳回必须由各自固定 handler 直接进入复合执行 wrapper；
2. prepare wrapper 只能 GET，execute wrapper 的 transport graph 只能有一个 POST；
3. 旧 route、旧详情、旧对话框、旧组件和非 owner 不能继续写或清 busy；
4. fresh GET 改变能力、版本、实例或节点时必须停止在 POST 之前；
5. 驳回必须冻结非空原因，通过不得混入驳回原因；
6. generic dialog 不得重新承接这两个动作。

GREEN 后两项均为 `serverDerived=true`、
`dominatesTrigger=true`、`causalVerified=true`，动作级 blocker 为空。

## 真实 PostgreSQL 16 并发门

本地验证器创建一次性 `postgres:16`，仅绑定本机，使用空库顺序应用仓库全部
109 个迁移，并通过真实 Nest service 与三个独立 Prisma 连接证明：

1. 第一条 approve 事务完成动作日志和审计写入后，在提交前受控暂停；
2. 第二条相同旧坐标 approve 请求进入后，独立连接以两个 backend PID 和
   `pg_blocking_pids` 证明它直接等待第一事务持有的业务行锁；
3. 第一事务提交后，winner 将审批节点从 0 推进到 1；
4. loser 稳定返回 409；
5. 最终 `ApprovalActionLog` 和 `AuditLog` 各一条；
6. 没有形成付款、实付、凭证或收货记录；
7. runner 继续通过既有付款、余额、预留、实付、凭证、文件独占、项目串行、
   现金不足、收货、PDF、文件竞争、发票台账和 P2034 回归，并清理临时容器与目录。

本次活体实库严格证明的是 approve/approve 同旧坐标竞争，不宣称已经实库枚举
reject-winner 的全部排列。reject 复用同一锁/CAS 路径并由 Jest 覆盖；对称的
approve/reject 或 reject/reject 实库交错列为 P2 证据增强。

## 浏览器关键路径

目标流：

```text
零星采购详情
  -> 审批与动作
  -> 审批通过或驳回
  -> fresh GET 复核
  -> POST 冻结 decision 与三项审批坐标
  -> 成功提示和权威详情刷新
```

应用内浏览器首先打开本地 production preview，确认：

- URL 按预期被真实鉴权重定向至登录；
- 标题为 `login - 建工智管`；
- 登录页有非空主内容；
- console warning/error 为空。

该浏览器控制面不提供测试网络拦截，因此不能在不启动真实后端和写库的情况下模拟
审批账号与坐标。后续按仓库既有门禁使用 Playwright，在真实 production bundle、
Vue/TDesign 页面和真实 API client 上，仅在浏览器网络边界模拟 API。

新增场景在 Chromium 与 WebKit 中均验证：

- 1366×768：审批通过；
- 390×844：填写原因并驳回；
- 两条路径的请求顺序均为
  `GET 初读 -> GET fresh preflight -> POST -> GET 刷新`；
- POST 精确包含对应 decision 和三项冻结坐标；
- 通过不发送 comment，驳回只发送 trim 后原因；
- 页面 URL 正确、`#main-content` 非空、无 Vite/Webpack error overlay；
- 无 console error 或 pageerror；
- 移动端无 document 或嵌套横向滚动；
- 桌面与移动确认框截图均完整落在视口内。

目标场景 2/2 通过；随后同一持久套件全量 Chromium/WebKit 38/38 通过，覆盖既有
采购详情、七岗位可见性、付款、收货、草稿终止和路由竞态。截图与 HTML 报告保存在
本轮本地临时证据目录：

`/tmp/jgzg-spot-review-evidence.5vwXSu`

该新场景尚未接入生产 workflow 的默认 P0 测试集合；当前切片已有本地双浏览器证据，
是否扩展 CI 浏览器安装和运行范围留到最终发布门统一决策。

## 机器事实

相对上一个 Task 11 切片：

- accepted action binding：14 → 16；
- page accepted / covered production consumer：11 → 12；
- page blocker：331 → 327；
- matrix covered production mutation pair：11 → 12；
- matrix uncovered production mutation pair：保持 262；
- matrix blocker：377 → 375；
- orphan wrapper：保持 45；
- registered action：42；
- route：395；
- unclassified route：26。

当前 Web API 清单为 380 个 transport wrapper、384 个 main binding。两项动作都由
`SpotProcurementDetailPage.vue` 的独立 confirm handler 消费，动作级 blocker 为空。
整条 `POST /spot-procurements/:procurementId/approval` 仍显示 route-level
`MUTATION_CONSUMER_UNCOVERED`，因为范围外的 `return_to_applicant` 仍直接消费底层
wrapper，尚未登记为独立 action；这不回退本次 approve/reject 的动作级闭合。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `77494c39bf8081c3d1f68cfc611842095672689acdc402238f7a600fd7cfd30f`
- `web-api-wrappers.json`：
  `c6ca732376930184dff22b0a568562220149b14c2c9758a9930976fec3c07aac`
- `web-page-actions.registry.json`：
  `4874b9b690fe452efd0b2c3b3311b2c0d7ad48ab3b5d0bd86cf1b06455734f13`
- `web-page-actions.json`：
  `ce7035fbf646ecc7ca50086adf47d8ad86711e79ff2a70e2562869918d034075`
- `route-usage.json`：
  `d840fcd6464c826f8d715780ac90ecb04d28133e6963d712d7169ec24ebafb9d`
- `whole-site-capability-matrix.json`：
  `b0c1f3cf1c243ab42e8af987c055e3188c65b96c40acf4c711a9cc297259be23`
- `whole-site-capability-matrix.md`：
  `2da7b701d76d7417c8ae2d5627ca3e91fc18e75bc68339bbf30faf14437ee1aa`

## 验证

- 零采审批目标 API：4 套、89/89；
- 零采 API 模块回归：23 套、539/539；
- API 全量 Jest：256 套通过、15 套条件跳过；4968 通过、47 跳过；
- 零采目标 Web Vitest：3 文件、105/105；
- Web 全量 Vitest：142 文件、1382/1382；
- page-action + capability-matrix analyzer：197/197；
- 真实 PostgreSQL 16 空库：109 个迁移，完整零采并发 runner 通过；
- 目标 Playwright Chromium/WebKit：2/2；
- 零采持久 Playwright Chromium/WebKit 全量：38/38；
- Web E2E typecheck：通过；
- E2E 单文件 ESLint：通过；
- API/Web typecheck：通过；
- API/Web lint：通过；
- Web `check:ui`：通过；
- API `check:business-errors`：通过；
- API/Web production build：通过，Web 仅保留既有大 chunk warning；
- Prisma validate/generate：通过；
- Nest、Web API、page action、route usage、capability matrix 按顺序重生成并
  `--check` 通过；
- `git diff --check`：提交前再次执行。

全量 API 首轮曾暴露四个仅测试夹具漂移：合同清单、合同和合同版本 mock 没有实现
已进入生产代码的真实 `$queryRaw` 锁边界，以及静态保留门误把技术租约清理当成业务
删除。它们以独立聚焦提交
`1636a0871a995ea58c15365b0db7ba9377aa7029`
修复；生产源码未因测试夹具而放宽。修复后全量 API 取得上述绿色结果。

独立只读代码审查结论：P0 无、P1 无，可进入聚焦提交。

## 剩余风险、未授权与下一步

非阻断 P2：

1. `ApprovalInstance` 尚无
   `(businessType, businessId, flowType, status)` 业务坐标复合索引或唯一约束；
   当前正确性由“锁全部 + 精确基数为一”保证。索引或唯一约束必须在重复数据预检后
   以独立迁移决策，不能在本切片静默加入。
2. `return_to_applicant` 尚未登记为独立页面动作，导致整条 mutation route 仍未完全
   覆盖。
3. 真实 PostgreSQL 尚未补 reject-winner 的对称交错。
4. 按钮显示只检查服务端 action；打开对话框时才同时检查完整坐标。在同 SHA 完整部署
   下服务端保证二者一致，但异常混合部署时可能短暂出现按钮可见、点击失败关闭。
5. 新浏览器场景尚未加入生产 workflow 默认 P0。

下一最小切片是付款审批通过/驳回。必须保留支付领域既有的 OR 签、自审二次确认、
签名快照、转审/委托、批准金额与融资额度语义，并补精确审批坐标、重复实例失败关闭、
fresh GET、前端 owner 及真实 PostgreSQL winner/loser 证据；付款审批通过只进入
`approved_pending_payment`，不得等同实际付款。

本地未 push、合并、部署、执行生产迁移或修改生产业务数据。生产 temporary-only
retention 的单独授权与本地 Task 11 改造保持隔离；业务草稿 purge、正式业务记录、
AuditLog、checkpoint、旧表旧字段及任何物理删除继续关闭。
