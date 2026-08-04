# 实施包 5 Task 11：正式零星采购审批撤回

## 当前结论

本子任务只处理：

- `spot-procurement.withdraw`

本子任务已完成代码、前向迁移、失败测试与最小实现、真实 PostgreSQL 16
空库/并发/回滚门禁、Chromium/WebKit production bundle 关键路径、类型/静态/UI
门禁和能力清单收口。可作为一个独立可验证切片提交；Task 11 其余动作、Task 12、
实施包 5 和五包发布候选仍未完成，不会因本切片闭合而提前宣称整体完成。

生产未连接、未推送、未合并、未部署、未执行迁移、未修改业务数据。已经完成的
temporary-only 首次生产清理不会重复；业务草稿 purge、正式业务记录、AuditLog、
checkpoint、旧表旧字段及其他物理删除继续关闭。

## RED 与最小实现

### RED

改造前的失败证据锁定：

- 撤回接口不接收版本、审批实例和节点三项 CAS 坐标；
- 详情读模型不发布服务端撤回上下文；
- 页面通过通用动作路径调用底层 POST，没有 fresh GET、固定 owner 或迟到回调隔离；
- 迁移约束不接受 `returned` 和 `withdrawn`，真实状态迁移会被数据库拒绝；
- 既有实现没有真实 PostgreSQL 双撤回、撤回与审批推进竞争、Audit 中段失败全事务回滚
  的专用 verifier；
- POST 已发出后切换路由时，旧请求 resolve/reject 的隔离证据不足。

新增失败测试后，API、Web 和迁移结构测试均在对应缺口上失败，再实施最小修复。

### GREEN

后端最小实现：

1. 新增撤回 DTO，强制提交：
   - `expectedVersionId`
   - `expectedApprovalInstanceId`
   - `expectedNodeIndex`
2. 详情只在下列条件全部成立时发布 `withdrawApprovalContext`：
   - 零采 pilot 写入已开放；
   - 根单和当前版本均为 `approval_pending`；
   - 精确进行中审批实例恰好一条；
   - 当前账号同时是根单申请人和审批实例申请人；
   - 服务端 `withdraw_approval` 动作仍可用。
3. 撤回事务按根单、当前版本和审批实例加锁，权限先于三坐标 CAS；重复实例、
   申请人不一致、状态变化或坐标陈旧均失败关闭。
4. winner 在同一事务内：
   - 将审批实例改为 `withdrawn`；
   - 将源版本改为 `withdrawn`；
   - 复制冻结明细和附件生成下一版 `draft`；
   - 将采购根指向新草稿；
   - 写一条审批 ActionLog 和一条业务 Audit；
   - 不创建付款、实付、财务、收货或其他下游事实。
5. 旧版/混合表单统一失败关闭：根单、版本或明细仍含供应商、金额、票税、单价、
   使用地点等旧字段时，编辑、提交、审批、退回、撤回和建新版本均在第一笔写入前 409；
   旧事实仍可读，不会被静默清空或改造为新表单。
6. 新表单修订源额外要求至少一条明细、根单与版本经办人一致，待审流程不得已有付款或
   收货事实；审批快照申请人与根单申请人不一致同样失败关闭。

前端最小实现：

- raw POST transport 保持 API 文件私有；
- `prepareSpotProcurementWithdrawalAction()` 先 fresh GET 并冻结三项坐标；
- fresh GET 必须明确返回 `procurement.form=real_application`，`legacy`、缺失 form 或混合部署均在 POST 前失败；
- `executeSpotProcurementWithdrawalAction()` 只提交冻结坐标；
- 页面使用独立对话框、route/detail/dialog/component/operation owner；
- 双击只允许一个 POST；
- POST pending 期间禁止 Escape、取消和关闭；
- 路由 A 切到 B 后，A 的迟到 resolve/reject 均不得提示、刷新、写错误、关闭 B 对话框
  或释放 B 的 busy owner；
- 页面没有直接 `fetch`。

## 数据库前向迁移

新增：

`services/api/prisma/migrations/20260728161000_spot_procurement_application_revision_status/migration.sql`

SQL SHA-256：

`01c1163e5c7519c2f2884343ca742b1373fc48b8cd0574994bddaad3b6552784`

迁移只更换 `SpotProcurementVersion.status` CHECK，不包含业务 DML、回填或
删除：

1. 使用 advisory lock；
2. 对目标表申请 `ACCESS EXCLUSIVE NOWAIT`；
3. 通过 `pg_get_constraintdef` 读取现有同名约束；
4. 按 PostgreSQL 16 输出做归一化精确比对；
5. 校验旧六个状态字面量各出现一次，并拒绝额外状态字面量；
6. 扫描所有保留行，发现不可接受状态立即失败；
7. 新约束先 `NOT VALID`、再 `VALIDATE`，最后原子替换旧约束。

新约束同时保留既有状态并加入 `returned`、`withdrawn`。迁移目录总数从 113 增至
114，所有固定迁移计数 runner/spec 已同步到 114。

真实 PostgreSQL 16 一次性空库已连续执行两次 `prisma migrate deploy`：首次完整应用
114 个迁移，第二次明确返回无待应用迁移，`migrate status` 为 current；`_prisma_migrations`
校验应用数为 114，终点迁移恰好一条已完成记录。运行时数据库仅绑定随机本地端口和固定一次性库名，
成功后已删除临时容器和目录。

## 真实 PostgreSQL verifier 设计

`verify-spot-procurement-concurrency.cjs` 已新增以下真实连接场景：

1. 相同三坐标双撤回：直接以 backend PID 形成阻塞，只允许一个 winner，loser 必须
   严格 409；最终仅一份 V2 草稿、一条 ActionLog、一条 Audit，零付款和收货事实。
2. 撤回与审批节点推进竞争：只允许一个 winner，loser 严格 409，终态必须一致。
3. `return_to_applicant` 数据库回归：源 V1 `returned`、唯一 V2 `draft`、根指向
   V2、审批实例 `returned_to_applicant`，且零下游事实。
4. Audit 中段故障：在审批实例、ActionLog、新草稿和根指针写入后注入异常；事务结束后
   根、V1、审批实例必须全部回到 pending，无 V2、ActionLog、Audit、付款或收货事实。
5. 门闩失败和超时均有显式保护，避免 verifier 静默挂起。
6. 完整 legacy 撤回与混合行退回均必须严格 409，根单、V1、全部旧票税/单价/金额/地点、
   两条明细、两份附件、审批节点、ActionLog 和 Audit 的前后快照完全一致，且没有 V2。
7. 正常 real-form 撤回/退回同时枚举证明根单、版本和明细的全部退役商业字段始终为 `null`。

结构测试最终 11/11、状态迁移结构测试 2/2。首次真库执行在新完整性门禁上暴露原并发 fixture
缺少 A4 明细，因此在任何并发胜者产生前严格 409；临时库已自动清理。补入显式无价冻结明细后，
以全新 PostgreSQL 16 容器完整重跑，上述场景以及付款/余额/实付/收货/票据既有联合并发门禁均通过，
并证明 Prisma 保留真实 PostgreSQL 16 `P2034` Serializable 冲突语义。

## 浏览器关键路径设计

production bundle 场景已加入正式零采双浏览器配置，并在 Chromium 与 WebKit 中同时覆盖
1366×768 桌面与 390×844 移动端路径：

```text
GET 初读
  -> 打开“撤回审批”
  -> 冻结 route/detail/dialog/operation owner
  -> GET fresh preflight
  -> POST approval-withdrawal + 三项坐标
  -> GET 权威刷新
  -> 新 V2 草稿
```

静态场景要求：

- 双击只产生一个 POST；
- POST pending 时 Escape/取消/关闭无效；
- 请求序列严格为 `GET→GET→POST→GET`；
- A 路由的迟到 resolve/reject 不污染 B 路由的新 owner；
- 桌面和移动端均无 console error、pageerror 或横向滚动。

Playwright 由自身在 `127.0.0.1:4180` 启停最新 production bundle preview，Chromium/WebKit 2/2
通过。mock 使用服务端真实可发布的 canonical real-form：至少一条无价明细、无付款和收货数据库事实、
付款待确定/收货未创建摘要且 `primaryAction=null`，从“审批与动作”的实际入口触发，不伪造服务端
不会发布的主动作。两个引擎均证明请求序列为 `GET→GET→POST→GET`，双击只产生一个 POST，
提交中取消与 Escape 均失效，最终返回新草稿；无 console error、pageerror 或横向滚动。四张桌面/
移动截图已人工查看：pending 对话框正确锁定；移动端沿用现有纵向导航并提供“跳到主内容”入口。

## 测试与静态门禁

当前实际通过：

- API 目标：5 套、129/129；
- Web 目标：3 文件、46/46；
- shared-domain：15 文件、149/149；
- API 全量：270 套通过、19 套跳过，5250 通过、51 跳过、5301 总数；
- Web 全量：152 文件、1515/1515；
- workspace typecheck：通过；
- Web E2E typecheck：通过；
- workspace lint：通过；
- API/Web production build：通过，Web 仅有既有大 chunk warning；
- Web `check:ui`：通过；
- API 业务错误检查：通过；
- Prisma validate/generate 5.22.0：通过；
- `git diff --check`：通过；
- contract workbench、Nest route、Web API、page action、route usage、whole-site
  capability matrix 普通 `--check`：均与已生成清单一致。

一次 shared-domain 全量命令误传 Jest 专用 `--runInBand`，被 Vitest CLI 在执行测试前
拒绝；改用项目正确命令后 15 文件、149/149 通过，不是代码失败。

普通清单当前状态：

- Nest route：395；
- Web transport wrapper：386；
- main request binding：396；
- registered action：44；
- accepted action binding：29；
- covered production mutation pair：20；
- page action blocker：299；
- route unclassified：26；
- whole-site matrix blocker：364；
- orphan wrapper：48。

`spot-procurement.withdraw` 当前为：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- `accepted=true`
- `POST /spot-procurements/:procurementId/approval-withdrawal`：
  `mutationCoverage=covered`

整体能力矩阵仍为 `blocked`；普通 check 成功不等于 `--require-ready` 发布门通过。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `90a4efc1af630b4c3d071307b6faca44f792b40412ab50293e993ddcd9051661`
- `web-api-wrappers.json`：
  `bcce22ff93b433272b1b2ed4d8d06249958cbfee96f31a0f94aaf69531ade971`
- `web-page-actions.registry.json`：
  `8b0a2f6b8373e3ad963634d2b679fbe9f0b33c1f7f2b9714de0a3cfb33b00b2f`
- `web-page-actions.json`：
  `167eb805197ef58c654dfa133904387ff10622f09850b646116b902e60ce1358`
- `route-usage.json`：
  `f7d401bc648d3dceb343867be280f712353f17882e440595486fd6c456aba429`
- `whole-site-capability-matrix.json`：
  `819b96be6ec9f01e3a75fe9d7f04573e402bfbe472961ae9664df33be5c9d207`
- `whole-site-capability-matrix.md`：
  `0a1da6b77ae931d4b1b933927f84ece400ca8601421c384b96c3539d1ba99cce`

## 独立复核

三轮问题均先形成证据再闭合：

1. P1：数据库旧约束遗漏 `returned`，导致既有退回路径真实写入会失败；
2. P2：迁移未精确防御 catalog drift；
3. P2：POST pending 后的迟到 resolve/reject 隔离证据不足；
4. P2：缺少 Audit 中段失败后的真实事务回滚场景。
5. P1：读侧只检查退休字段为空，零明细、根/版本经办人漂移及已有付款/收货事实仍会发布
   撤回坐标；新增四组 RED 后同步失败关闭详情、列表和动作能力。
6. P1：浏览器 mock 继承付款/收货事实并伪造 `withdraw_approval` 主动作，属于服务端不可能发布且
   写侧必定 409 的状态；改为 canonical 无下游事实并从真实动作区触发后双引擎重跑通过。

最终极窄复核结果：

- P0：0
- P1：0
- P2：0

复核同时纳入真实 PostgreSQL 16 双 deploy、并发/回滚 verifier 和 Chromium/WebKit
production bundle 门禁；这些证据只闭合当前撤回切片，不外推为 Task 11 或实施包 5 完成。
终审同时登记当前切片之外的 Task 11 阻断：既有 `spot-procurement.review-approve` 尚未冻结
审批人的签名版本；它必须作为下一独立 RED/实现/验证切片处理，不能因撤回闭合而被视为完成。

## 本切片闭合与下一步

空库迁移、真实并发/回滚、双浏览器桌面/移动路径和四张截图人工检查均已完成；
本切片可提交聚焦 conventional commit。提交后只继续实施包 5 Task 11 的下一动作，
不把单动作闭合误报为 Task 11、实施包 5 或五包发布候选完成。Task 12 的历史接口退出、
生产连接、生产迁移、业务写入和任何物理删除仍不得提前。
