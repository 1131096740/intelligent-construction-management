# 实施包 5 Task 11：项目支出审批撤回动作闭合

## 结论

本子任务只闭合 `project-expense.withdraw`。项目支出申请人可以在审批仍进行中、审批
实例唯一、四个版本坐标仍一致且没有已使用融资额度时撤回申请；撤回只改变申请与
审批实例状态，保留审批动作、融资额度释放和审计事实。全站能力矩阵仍为
`blocked`，本记录不把 Task 11、实施包 5 或五个实施包总门禁标记为完成。

项目支出审批详情 GET 仅在以下条件同时成立时发布服务端 `withdraw` 和
`withdrawalContext`：

1. 当前账号已经通过该项目支出详情的申请人或审批岗位读取授权；
2. 支出申请仍为 `approval_pending`；
3. 当前账号既是支出申请人，也是唯一精确
   `project_expense_request + project_expense.approve + in_progress` 审批实例的
   申请人；
4. 不存在 `used` 融资额度事实；
5. 支出申请与审批实例均有可发布的更新时间。

`withdrawalContext` 冻结：

- `expectedExpenseUpdatedAt`
- `expectedApprovalInstanceId`
- `expectedNodeIndex`
- `expectedApprovalUpdatedAt`

重复或缺失活动审批实例、申请人与审批实例不一致、非申请人、已实付、已使用融资
额度或已结束状态均不会发布撤回动作。融资额度使用查询只在详情读取授权和申请人
身份确认后发生，不向无权账号暴露融资事实。

## 后端不变量

新 `POST
/projects/:projectId/expense-requests/:expenseRequestId/approval-withdrawal`
接收四坐标 DTO。服务在一个事务中：

1. 只按精确 `projectId + id` 锁定项目支出申请，不接受编号模糊匹配；
2. 先检查申请人、`approval_pending` 和零实付；
3. 按 ID 稳定排序并锁定全部精确进行中审批实例，必须恰好一条；
4. 再核对审批实例申请人和四个 CAS 坐标；
5. 读取融资额度合计，任何 `used` 金额都阻断撤回；
6. 将支出申请和审批实例改为 `withdrawn`；
7. 新增 `ApprovalActionLog(action=withdraw)`；
8. 将所有 `occupied` 融资额度逐条转为 `released`，金额守恒，并在实际释放时写
   `project_expense.cash_pool.release.withdraw` 审计；
9. 写 `project_expense.approval.withdraw` 主审计并保存四坐标。

支出、审批实例、动作日志、融资额度、释放审计和主审计同事务提交；最后主审计失败
时全部回滚。没有修改 Prisma Schema，也没有新增迁移。

## 前端与清单因果链

页面把服务端原始详情保存在独立 `shallowRef`，展示模型只接收
`structuredClone`。撤回按钮只读取原始 capability 的唯一启用 `withdraw` 和完整
四坐标；按钮使用 TDesign 与现有 `SensitiveActionDialog`，没有新增第二套 UI，也
没有在页面直接调用 `fetch`。

用户打开确认框时冻结组件 owner、路由、详情 epoch、对话框 generation、操作 ID、
项目/申请 ID 和四坐标。确认文案明确说明申请会进入“已撤回”历史记录，不再误称
“回到可修改状态”。确认链为：

```text
初始 GET 原始 capability
  -> 打开独立敏感操作确认框
  -> fresh GET 复核同一动作和四坐标
  -> POST approval-withdrawal
  -> GET 权威详情刷新
```

路由 A→B、组件卸载、重新挂载、对话框取消/重开、迟到初始 GET、迟到 fresh GET、
迟到 POST 成功/失败和非 owner 的 `finally` 均不能污染新页面或提前解除新 owner。
确认期间取消按钮、Esc、遮罩和右上角关闭按钮均不可用；快速双击只产生一条 POST。
共享 `SensitiveActionDialog` 在 loading 时隐藏右上角关闭按钮，避免 POST 已成功但
对话框先关闭造成完成回调被 owner 校验丢弃。

首轮实现复用了 `BusinessDraftAction`，但该组件内部会把动作集合转换为展示项，现有
分析器不能证明转换后的 prop 仍是不可篡改的原始服务端 capability。最终使用与付款
审批相同的独立按钮和敏感操作对话框，让可见 gate 和确认 handler 都直接受原始
capability 支配。复合 API wrapper 内联唯一 POST，删除了本切片临时引入但无生产
消费者的重复 raw wrapper。

最终 `project-expense.withdraw`：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- `acceptedProductionConsumers` 包含项目支出审批详情页
- 动作和 wrapper 专属 blocker 均为空

## RED、回归与真实 PostgreSQL 16

改造前先以失败测试锁定：

- GET 未发布唯一审批实例的四坐标；
- 非申请人或申请人不一致仍可能看到撤回事实；
- 无权账号在权限判断前触发融资事实查询；
- 旧坐标、重复审批实例或已使用融资额度没有稳定失败关闭；
- 多条 occupied 额度没有证明全部释放；
- 最终审计失败没有证明前置写入全部回滚；
- 前端缺少 fresh GET、对话框 owner、路由/重挂载隔离和双击合并。

目标 API 三套 176/176、Web 四文件 107/107、PostgreSQL runner 静态测试 4/4
通过。

一次性本地 PostgreSQL 16 runner 从空库部署仓库全部 110 个迁移并确认
`migrate status` 为最新，然后使用真实 `ProjectExpenseService` 和独立 backend
连接验证七类场景：

1. 同四坐标双撤回：第二事务被第一事务真实阻塞，最终一成一败；
2. 审批节点推进先胜：旧四坐标撤回返回 409 且零部分写；
3. 撤回先胜：节点推进 loser 失败，撤回事实唯一；
4. 重复进行中审批实例：严格 409，支出、审批、动作、额度和审计均不变；
5. 三条 occupied 额度全部释放且金额守恒；
6. used 额度阻断撤回，所有事实保持不变；
7. 最终主审计故障注入前确认支出、审批、动作、额度和释放审计都已执行，事务异常
   后逐项恢复原值。

前三类竞争均以独立连接和 `pg_blocking_pids` 观察到真实直阻塞。runner 成功、失败
或中断都按精确容器名清理；独立复核曾发现 Docker 子进程晚创建竞态，修复后增加
“首次不存在、随后晚创建、再次删除、连续确认不存在”的回归，最终复核为 READY。
未连接生产数据库。

## 浏览器 P0

在最终 production bundle 上只模拟浏览器网络边界：

- Chromium 1366×768：项目支出撤回完整路径；
- 实际 WebKit 390×844：移动响应式撤回完整路径；
- 两端均严格执行 `GET -> GET -> POST -> GET`；
- POST body 精确等于四坐标，双击确认仍只有一条 POST；
- 延迟 POST 期间右上角关闭按钮消失、Esc 无效且对话框保持打开，响应后仍执行最终
  GET；
- 成功后状态显示“已撤回”，撤回按钮消失；
- 另有 Chromium A→B 迟到详情响应隔离；
- 页面无 console error、pageerror、框架错误层、横向溢出或嵌套滚动异常；
- 桌面和移动对话框、风险说明及操作按钮均位于视口内，截图已人工检查。

Playwright 结果为 3 passed / 1 skipped；唯一跳过项是明确只在 Chromium 运行的
A→B 迟到响应用例，Chromium 与 WebKit 的撤回主路径均通过。

截图：

- `apps/web-admin/test-results/draft-lifecycle-governance-43936-resh-GET-四坐标提交且双击只产生一次-POST-chromium/project-expense-withdraw-chromium-1366x768.png`
- `apps/web-admin/test-results/draft-lifecycle-governance-43936-resh-GET-四坐标提交且双击只产生一次-POST-webkit/project-expense-withdraw-webkit-390x844.png`

截图目录由 Playwright 管理并被 Git 忽略，不作为源码提交。

## 机器事实

相对上一个 Task 11 切片：

- Web API transport wrapper：382 → 383；
- Web API main binding：388 → 389；
- accepted action binding：20 → 21；
- unresolved action binding：31 → 30；
- covered production mutation consumer pair：14 → 15；
- uncovered production mutation consumer pair：260 → 259；
- page blocker：318 → 315；
- matrix blocker：372 → 370；
- orphan wrapper：保持 46；
- duplicate mutation route：保持 5；
- registered action：保持 42；
- route：保持 395；
- unclassified route：保持 26。

当前矩阵：

- 395 routes；
- 383 wrappers / 389 bindings；
- 42 registered actions / 51 action bindings；
- 21 accepted / 30 unresolved action bindings；
- 274 production mutation consumer pairs；
- 15 covered / 259 uncovered；
- 26 unclassified routes；
- 370 blockers。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `875d4652672b565ca9f77be604f2670e1778611a7d32026086adcd380ea2fb53`
- `web-page-actions.registry.json`：
  `362f4a46d5c05d467a7eece9a79b18a86bca4630812725b2456a150cda2a2c14`
- `web-page-actions.json`：
  `da3adfbe27935c6dbd0bd9b830677a75b3d96a8fce10e07eac1c33ab7d1fb0b5`
- `route-usage.json`：
  `ca8538a7306c8892b589200e541e4ee935ecab1a636389775477f5365cb49125`
- `whole-site-capability-matrix.json`：
  `d3be85b63267735ba2e25197c94a2005d724017197ccc2f1e200f2596c4e7bfc`
- `whole-site-capability-matrix.md`：
  `32c8531157ccb06bd4dbd17468ecac8300020905ff2031462b7be666c5585936`

## 最终验证

- 目标 API：3 套、176/176；
- PostgreSQL runner 静态测试：4/4；
- 目标 Web：4 文件、107/107；
- 共享领域：15 文件、149/149；
- Web 全量：145 文件、1431/1431；
- API 全量：261 套通过、16 套条件跳过；5040 通过、48 跳过；
- page-action / capability-matrix analyzer：117/117；
- 五份机器清单 write/check：通过，整体按未完成事实保持 `blocked`；
- 真实 PostgreSQL 16 空库：110/110 迁移、七类场景、三组真实阻塞通过；
- production bundle Playwright：3 passed / 1 intentional skip；
- API/Web/共享领域 typecheck：通过；
- Web E2E typecheck：通过；
- 全 workspace lint：通过；
- Web `check:ui`：通过；
- API `check:business-errors`：扫描 399 个生产 TypeScript 文件，55 个精确内部
  英文哨兵，通过；
- API/Web build：通过；Web 4454 modules，只有既有大 chunk 提示；
- Prisma validate/generate：通过；
- `git diff --check`：通过。

全量 API 的 Fontconfig 无可写缓存提示和 Jest worker 强制退出提示为既有测试环境
噪声；所有测试断言通过，没有被表述为零日志验收。

## 独立复核与剩余风险

后端、真实 PostgreSQL runner、前端因果链和浏览器路径均经独立只读复核。前端
复核曾发现提交中右上角关闭按钮会导致已成功 POST 不刷新页面的 P1；共享对话框和
延迟 POST 浏览器回归修复后再次复核，最终未发现剩余 P0/P1。

非阻断 P2：

1. `ApprovalInstance` 尚无
   `(businessType,businessId,flowType,status)` 活动实例唯一约束，当前路径由支出
   申请行锁串行并对重复实例失败关闭，未来旁路插入仍需数据库约束；
2. 融资额度行本身没有独立 `FOR UPDATE` 或唯一约束，现有服务写路径依赖先锁同一
   支出申请；未来新写入口必须保持相同锁序；
3. 非申请人 POST 的 400 与不存在记录的 404 可形成低价值存在性差异，后续可统一
   为不泄露语义；
4. 项目支出审批通过/驳回仍是独立未闭合动作，不能从本次撤回证据推导为完成。

下一最小切片为 `project-expense.review-approve` /
`project-expense.review-reject`。未经另行授权不进入 Task 12 旧接口退出，不执行
业务草稿 purge、正式业务记录/AuditLog/checkpoint/旧表旧字段物理删除。本切片未
push、合并、部署、连接或写入生产。
