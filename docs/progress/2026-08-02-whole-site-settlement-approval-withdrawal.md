# 实施包 5 Task 11：结算审批撤回静态候选

## 当前结论

本切片只处理治理动作 `settlement-approval.withdraw`。代码、单元/结构测试、
PostgreSQL 16 动态门脚本、浏览器 P0 门资产、权限与整站能力清单已经收口到一个
可提交的静态候选；真实 PostgreSQL 16 空库/并发/回滚和 Chromium/WebKit
production preview 尚未执行，必须在形成精确 SHA 后由用户重新授权。

本切片不是 Task 11、实施包 5 或五包发布候选完成。未启动 Docker、PostgreSQL、
preview 或浏览器，未连接生产，未 push、合并、部署、执行生产迁移或修改生产业务
数据；transition、retention、业务草稿 purge、正式记录、Audit、checkpoint、旧表旧字段
和其他物理删除继续关闭。

## RED 与根因

改造与本次停机终审的失败证据锁定了五类问题：

1. 后端撤回只看当前状态和第一条活动审批实例，没有锁顺序、四坐标 CAS 或重复活动实例
   失败关闭；撤回可能覆盖并发审批推进。
2. 非申请人与不存在/终态目标的错误顺序会形成身份和业务记录探测；额度释放、ActionLog、
   Audit 的事务回滚证据不足。
3. 详情按本地角色/状态发布撤回入口，未证明当前账号就是唯一活动审批实例申请人；页面直接
   使用旧详情发 POST，没有 fresh GET、结果未知分类或 route/detail/dialog/operation owner。
4. 既有审批处理读取第一条活动实例，重复活动实例时仍可能继续审批。
5. 暂存实现虽然给撤回 POST 补了 `LEDGER_READ_POSITION_KEYS`，PermissionGuard 却会先按
   `settlementId` 解析目标项目：外项目资源在 Guard 返回 403，不存在资源可能进入
   ValidationPipe/Service，形成 403/400 或不同 403 message 的资源存在性 oracle。

新增后端 RED 初始为 16 失败/1 通过；治理清单随后又明确给出
`AVAILABLE_ACTION_PROVENANCE_UNVERIFIED`，证明结算详情 GET 与撤回 POST 的岗位范围不一致。
停机交接后的路由级 RED 进一步用真实 Guard → ValidationPipe → Service 顺序复现：2/2
失败；外项目非法 DTO 为 Guard 403，而不存在资源为 ValidationPipe 400，合法 DTO 的两条
路径也返回不同 403 message。

## 后端最小实现

- 新增撤回 DTO，强制提交四项冻结坐标：
  - `expectedSettlementUpdatedAt`
  - `expectedApprovalInstanceId`
  - `expectedNodeIndex`
  - `expectedApprovalUpdatedAt`
- 事务外先按“审批实例 ID + 申请人 + settlement 业务类型/ID + settlement.approve flow”
  做身份绑定，故意不限制状态：无权账号对存在、不存在和终态目标统一 403；合法申请人的
  陈旧坐标进入事务内稳定 409。
- 事务内固定锁序为 Settlement → 预期或活动 ApprovalInstance；锁后再次绑定身份，并要求
  结算仍为 `approval_pending`、活动实例恰好一条、四坐标全部精确一致。
- 坐标或状态漂移、重复活动实例统一返回
  `SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT`，不产生任何业务写入。
- winner 在同一事务内完成 Settlement `withdrawn`、精确 ApprovalInstance `withdrawn`、
  一条 `withdraw` ActionLog、occupied 例外额度一次性释放、释放 Audit（仅 count > 0）和
  最终撤回 Audit；最终 Audit 记录原/新状态、申请人和全部四坐标。
- ActionLog、额度释放 Audit 或最终 Audit 任一点失败均由同一事务回滚，不写签名快照或任何
  下游结算/付款事实。
- 审批处理改为锁后读取最多两条活动实例并要求恰好一条；重复活动实例稳定返回
  `SETTLEMENT_APPROVAL_REVIEW_CONFLICT`，避免审批和撤回使用不同 fail-open 口径。
- 撤回 POST 与详情 GET 均保留 `LEDGER_READ_POSITION_KEYS` 岗位 metadata；仅撤回 POST
  增加 `UseAnyProjectPositionScope`，禁止 PermissionGuard 按目标结算解析项目。任一项目的
  合法 ledger 岗位只能进入 service，最终仍由 expected approval、当前申请人及
  settlement 业务/`settlement.approve` flow 绑定授权。详情 GET 与其他路由的项目权限未放宽。
- 路由级 GREEN 对外项目/不存在目标分别覆盖非法 DTO 同形 400、合法 DTO 同形 403，且
  证明 Guard 不查询目标结算项目、非法 DTO 不进入 service、合法 DTO 均进入同一身份绑定。

## 读模型与前端最小实现

- `SettlementDetailReadModel` 新增 `lifecycleUpdatedAt` 和四坐标
  `withdrawApprovalContext`。
- 详情只在结算待审、精确一条 `settlement.approve/in_progress` 实例且当前账号就是申请人时
  发布撤回上下文和 `withdraw_approval`；重复实例、非申请人或终态均不发布。
- 页面保留一份不可由展示副本回写的原始服务端 capability；入口、对话框和执行函数都直接
  受该 capability 与四坐标支配。
- canonical 执行链为：fresh GET → 冻结四坐标 → 单次私有 POST → 权威 GET；页面无直接
  `fetch`，旧裸 POST 不再导出。
- 双击共享同一 Promise；4xx 为确定失败，网络、解析、5xx、畸形 2xx、POST 后失主和成功后
  权威重读失败均归类为结果未知。
- 结果未知时只能继续权威 GET 判断，不得盲目重 POST；路由切换、同路由刷新、组件卸载和
  迟到 resolve/reject 通过 route/detail/dialog/component/operation owner 隔离。
- 成功只接受响应 ID 等于权威 DB settlement ID 且最终详情状态为 `withdrawn`；提示明确说明
  审计不会因撤回而删除。

## PostgreSQL 16 动态门资产

新增精确 opt-in runner：

`pnpm verify:settlement-approval-withdrawal-concurrency:local`

脚本默认失败关闭；缺失或错误
`SETTLEMENT_APPROVAL_WITHDRAWAL_CONCURRENCY_SCOPE=settlement-approval-withdrawal`
时，在申请端口、创建临时目录、Docker 或数据库动作之前退出。当前迁移门锁定：

- 迁移总数：116；
- 终点：`20260802020000_project_financing_quota_termination_idempotency`；
- 终点 SQL SHA-256：
  `a713473b527c5ba6201f35e11f27a54f62a15e72db5bc65a1f84094a0a276b03`。

授权后 runner 将只使用本机 unix/npipe Docker endpoint、回环随机端口、固定一次性专库、
随机密码和本地已存在的 `postgres:16` 镜像。镜像 tag 只用于解析精确 image SHA；容器按
immutable image ID 创建并再次核对 `.Image`，数据库就绪后查询 `server_version_num`，只
接受 `[160000, 170000)`。不 pull、不挂 volume、不接受远程 Docker context/host。

动态 verifier 已登记但尚未执行：

1. 116 个迁移空库首次 deploy、第二次零待办、status 与 `_prisma_migrations` 精确证明；
2. 最小合法 Project/User/Contract/ContractVersion/PaymentTermsVersion 外键链；
3. 相同四坐标双撤回单赢家；
4. withdraw 与 approve/reject/return 双胜序固定锁序单赢家；
5. 两节点中段 approve 推进后 Settlement 仍待审、旧撤回坐标稳定 409；
6. 非申请人 403 且 `$transaction` 调用次数为 0；
7. 重复活动实例 409、四坐标漂移 409，occupied quota、ActionLog、Audit 全部零写；
8. occupied quota 恰好释放一次；
9. ActionLog、额度释放 Audit、最终 Audit 三个中段故障全事务回滚；
10. 中断时等待 in-flight create 结果，并在最长 60 秒观察/30 秒稳定缺失窗口内清理唯一
    临时容器和目录。

两轮独立静态复核先发现并关闭了外键链缺失、期间唯一冲突、空额度自证、主流程未调用、
可变镜像 tag、清理观察过短、非申请人事务前证据缺失、两节点与重复实例缺口；最终复审
P0=0、P1=0。该结论只证明 runner 资产可执行，不替代真实 PostgreSQL 16 结果。

## 浏览器 P0 门资产

浏览器门已新增独立 settlement fixture 与 spec：

- `apps/web-admin/e2e/settlement-approval-withdrawal.fixture.ts`
- `apps/web-admin/e2e/settlement-approval-withdrawal.spec.ts`

该门计划使用 production bundle，在 Chromium 1366×768 与 WebKit 390×844 覆盖：

- 服务端 capability 才显示撤回入口；
- fresh GET → 精确单 POST → 权威 GET → `withdrawn`；
- 双击只产生一个 POST，pending 时取消/Escape/关闭无效；
- 409 为确定失败；network/parse/5xx/成功后重读失败进入 unknown，只做权威重读，不盲重投；
- 同路由刷新和跨路由迟到回调不污染新 owner；
- 无 console error、pageerror、文档横溢或嵌套横向滚动。

本轮只写入并静态列举/类型检查该门：E2E TypeScript 检查通过，Chromium 与 WebKit 分别静态
列举 8/8 个用例；preview、Chromium 与 WebKit 均未启动，截图和动态请求序列证据为空，必须
留到精确 SHA 获得新授权后补齐。

## 当前静态验证

本次 PermissionGuard P1 收口后重新通过：

- 新增路由级 Guard → ValidationPipe → Service 防回归：2/2；
- PermissionGuard、结算 controller/read/service、撤回服务与路由：6 套、375/375；其中结算
  撤回目标为 5 套、319/319；
- API typecheck、API lint、API production build；
- 六份能力事实清单重新生成并普通 `--check`。

源暂存切片在发现该 P1 前已通过、但本次严格范围内未全量重跑的既有证据：

- 结算域全量：30 套、589/589；
- API 全量：284 套通过、19 套按环境门跳过，5615 通过/64 跳过；
- Web 全量：166 文件、1749/1749；
- 前端撤回目标：4 文件、175/175；
- shared-domain 目标：2/2；
- runner Jest：8/8，三个 CJS `node --check` 与 scoped ESLint；
- workspace typecheck、workspace lint；
- API/Web production build（Web 仅既有 chunk-size warning）；
- Web `check:ui`；
- API 业务错误检查：403 个生产 TypeScript 文件，54 处内部英文哨兵精确允许；
- Prisma validate/generate 5.22.0；
- Web E2E TypeScript 检查，Chromium/WebKit 专用 spec 静态列举分别 8/8；
- 七个治理检查器测试：223/223；
- `git diff --check`。

能力清单当前事实：

- Nest routes：398；
- Web wrappers：388；main bindings：408；
- registered actions：59；page blockers：293；
- route usage unclassified：0；
- whole-site matrix blockers：310。

`settlement-approval.withdraw` 当前精确状态：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- `accepted=true`
- accepted production consumer 仅
  `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- local call chain：
  `confirmSettlementWithdrawal -> executeSettlementApprovalWithdrawalAction`
- `POST /settlements/:settlementId/approval-withdrawal`：
  `mutationCoverage=covered`，route blocker 为空。

整站清单仍因既有 blocker 保持 `blocked`；普通 check 成功不等于整站
`--require-ready` 已通过。

停机交接发现的 PermissionGuard 资源存在性 P1 已以路由 RED/GREEN 关闭；当前本切片静态
复核 P0=0、P1=0。该结论不替代尚未授权的 PostgreSQL 16 并发/回滚或 Chromium/WebKit
动态门，也不代表 Task 11、实施包 5 或五包完成。

## 下一授权门

完成聚焦提交并形成精确 SHA 后，只申请：

1. 在该 SHA 的隔离/干净 worktree 中以提升权限启动一次性本机 Docker/PostgreSQL 16，执行
   上述 116 迁移与 settlement-approval.withdraw 专用并发/零写/回滚 verifier；
2. 在 `127.0.0.1:4180` 启动该 SHA 的 production preview，只运行 settlement 撤回专用
   Chromium/WebKit 桌面与移动门；
3. 完成后删除本轮临时容器、监听、目录和浏览器报告。

该授权不得外推到生产、push、合并、部署、生产迁移、业务写入、retention、transition 或
任何物理删除。
