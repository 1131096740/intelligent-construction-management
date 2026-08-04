# 实施包 5 Task 11：项目支出审批通过/驳回动作闭合

## 结论

本子任务只闭合 `project-expense.review-approve` 和
`project-expense.review-reject`。项目支出审批详情现在只依据后端发布的原始
`review_approval` capability 和四个权威坐标办理当前审批节点；审批人权限、冻结
候选人、自审、金额、签名、状态迁移、融资额度、动作日志和审计均由后端事务重验。
全站能力矩阵仍为 `blocked`，本记录不把 Task 11、实施包 5 或五个实施包总门禁
标记为完成。

项目支出审批详情 GET 只在以下条件同时成立时发布唯一启用的
`review_approval` 和 `reviewApprovalContext`：

1. 项目支出仍为 `approval_pending`；
2. 精确
   `project_expense_request + project_expense.approve + in_progress`
   审批实例恰好一条；
3. 当前节点存在；
4. 当前账号是冻结节点的合法直接候选人；岗位变化不取消已冻结的直接资格，但
   项目支出按锁定专项计划不支持 assignment 或 standing delegation；
5. 普通申请人不能审批自己发起的业务；董事长或总经理自审必须经过原因和密码
   二次确认；
6. 支出申请和审批实例均有可发布的更新时间。

`reviewApprovalContext` 冻结：

- `expectedExpenseUpdatedAt`
- `expectedApprovalInstanceId`
- `expectedNodeIndex`
- `expectedApprovalUpdatedAt`

缺失或重复活动审批实例、无权账号、普通申请人自审、已结束状态及无效坐标都不会
发布可执行动作。终审节点才发布 `canSetApprovedAmount=true`。

## 后端不变量

现有
`POST /projects/:projectId/expense-requests/:expenseRequestId/approval`
改为强制接收四坐标。服务在一个事务中：

1. 只按精确 `projectId + id` 锁定项目支出，不再接受编号模糊匹配；
2. 锁定全部精确活动审批实例并要求恰好一条；
3. 只以冻结直接候选人解析 governed 审批身份；历史 role-only 实例只认当前
   直接岗位，忽略 assignment 和 standing delegation，不能借通用审批委托扩权；
4. 权限和领导自审校验先于 CAS，避免旧坐标成为权限探针；
5. 核对支出更新时间、审批实例 ID、节点下标和审批实例更新时间；
6. 驳回必须有非空意见，释放已占用融资额度并结束审批；
7. 通过时只在终审计算批准金额；批准金额不得超过申请金额或低于已实付金额，
   融资额度按批准金额精确缩减或释放；
8. governed 冻结节点的通过动作必须冻结审批人当前签名文件、SHA-256 和版本；
   驳回不伪造签名，legacy role-only 节点继续兼容无签名历史；
9. `ApprovalActionLog` 保存 `approvedRoleKey` 和 `representedUserId`；
10. 主审计保存规范化四坐标、原/目标状态、原/目标节点和审批身份，不记录密码；
11. 审批实例、支出状态/金额、融资额度、动作日志、签名和审计同事务提交。

通过只在终审后进入 `approved_pending_payment`，不会产生
`ProjectExpenseExecution`、`FinanceRecord` 或
`ProjectFundingAllocation`。最终主审计故障时全部前置写入回滚。

本切片没有修改 Prisma Schema，也没有新增迁移。

## 前端与清单因果链

页面把后端原始详情保存在单一 `shallowRef`；展示详情只接收
`structuredClone`。审批通过、审批驳回和既有撤回共同读取这份不可变权限源，但
各自使用独立对话框、operation owner 和提交状态。页面没有直接调用 `fetch`。

审批按钮只在唯一启用的 `review_approval`、完整四坐标、当前路由和展示详情全部
一致时出现。打开确认框时冻结：

- 组件 owner、路由 generation、详情 epoch、对话框 generation 和 operation ID；
- 项目 ID、支出 ID 和四个审批坐标；
- 固定 `approve` 或 `reject` 决定；
- 批准金额、审批意见、自审原因和当次确认密码。

确认链为：

```text
初始 GET 原始 capability
  -> 打开对应 SensitiveActionDialog
  -> fresh GET 复核同一动作和四坐标
  -> POST approval
  -> GET 权威详情刷新
```

POST 前后都重验 owner。路由 A→B、组件卸载/重挂载、对话框取消/重开、迟到初始
GET、迟到 fresh GET、迟到 POST 和非 owner 的 `finally` 都不能污染新详情或提前
解除新的操作 owner。快速双击只产生一次 POST；提交期间确认、取消、右上角关闭、
Esc 和遮罩关闭均不可用。

驳回在页面捕获和 API payload 两层剥离 `approvedAmountCents`，且必须发送非空
意见。领导自审的原因保留在页面，密码只在敏感确认框中输入和随本次内存上下文
提交。

最终三项项目支出动作：

- `project-expense.review-approve`：
  `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`
- `project-expense.review-reject`：
  `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`
- `project-expense.withdraw` 回归保持：
  `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`

三项 accepted consumer 均包含
`ProjectExpenseApprovalDetailPage.vue`，动作和 wrapper 专属 blocker 为空。

## RED、回归与真实 PostgreSQL 16

改造前先以失败测试锁定：

- GET 没有发布审批实例四坐标；
- 仅凭岗位而非冻结候选人即可审批；
- 普通申请人自审、陈旧坐标和重复活动实例没有失败关闭；
- 驳回空意见仍可提交，驳回可能携带批准金额；
- governed 通过没有冻结签名，legacy/reject 兼容边界不明确；
- 金额、融资额度、动作日志和审计失败没有证明原子回滚；
- 前端缺少 raw capability、fresh GET、固定决定、对话框 owner 和迟到隔离；
- 新 required DTO 字段和新增禁用动作会使既有静态字段/撤回测试夹具漂移。

RED 时后端目标两套新增行为测试为 18 项失败，前端 API 新增测试为 12 项失败，
页面 owner 测试为 5/5 失败。首轮 GREEN 后的独立后端复核又发现两项 P1：
真实 `create` 仍冻结 role-only 节点，以及 Guard/详情读模型会在冻结候选人岗位
变化后提前拒绝合法直接审批；同时发现 `used` 融资额度缩减守恒证据不足。该切片没有
带着这些问题提交，而是重新建立 4 failed / 73 passed 的 service RED 和
4 failed / 47 passed 的 Guard RED，补齐真实候选冻结、former-role direct
candidate 的 GET/POST/Guard 共用身份解析、空候选失败关闭、同节点多角色身份
歧义剔除与
`used + occupied` 守恒。最终权限复核又依据项目支出专项锁定计划确认该域不得
支持 assignment/standing delegation，现有脏 assignment 与常驻委托均有负向测试，
未把通用审批引擎能力扩张到项目支出。最终金额复核另发现历史/异常待审记录可能
已经存在实付；先以 RED 证明终审批金额低于既有实付会错误成功，再在任何状态、
实例、动作、审计或融资写入前稳定返回 400，并补齐单测与真实 PostgreSQL 零变化
证据。

最终目标 API 七套 269/269、目标 Web 四文件
122/122、PostgreSQL runner 静态测试 8/8 通过。

一次性本地 PostgreSQL 16 runner 从空库部署仓库全部 110 个迁移并确认迁移状态
最新，然后以真实 `ProjectExpenseService` 和独立 backend 连接验证十五组审批场景：

1. 真实 `service.create -> getApprovalDetail -> signed reviewApproval` 生成四个
   非空 governed 冻结节点，排除普通申请人，首节点签名推进且零下游写；
2. 中间节点双通过，第二事务被第一事务真实阻塞，winner 推进节点、loser 旧坐标
   409；
3. 终审通过与驳回两种 winner 顺序，loser 409；
4. governed 直接候选人签名冻结成功；
5. 缺失或无效签名时 governed 通过失败并完整回滚；
6. legacy role-only 通过保持无签名兼容；
7. 驳回不写签名；
8. 普通申请人自审失败；
9. 领导自审原因和密码门通过；
10. 批准金额上限、终审金额和融资额度缩减/释放正确；
11. 已 `used` 融资额度无法满足终审降额时失败并回滚全部写入；
12. 历史/异常待审记录已有实付时，终审批金额低于既有实付稳定返回 400，支出、
    实例、动作、审计、融资及下游完整快照零变化；
13. 重复活动审批实例严格失败关闭；
14. 通过主审计故障时业务、实例、ActionLog、签名和额度全部回滚；
15. 驳回主审计故障时状态、实例、动作和额度全部回滚。

三组交错都以不同 backend PID 和 `pg_blocking_pids` 观察到真实直阻塞。除专门
验证既有实付下限的历史夹具外，每条成功或失败路径都确认零项目支出实付；全部
路径均确认零新增实付、零财务记录和零项目资金分配。作为组合回归，既有撤回
runner 也从空库 110/110 迁移后重跑七类场景并全部通过。runner 成功、失败或中断
均清理精确一次性容器；未连接生产数据库。

## 浏览器 P0

在最终 production bundle 上只模拟浏览器网络边界：

- Chromium 1366×768：审批通过，终审批准金额 `800.00` 转为 `80000` 分；
- 实际 WebKit 390×844：审批驳回，body 不含批准金额；
- 两端均严格执行 `GET -> GET -> POST -> GET`；
- 双击确认只有一条 POST；
- 延迟 POST 期间确认和取消禁用、右上角关闭不存在、Esc 无效且对话框保持打开；
- Chromium A→B 迟到 fresh GET 不在 B 路由发出任何 POST；
- 既有 Chromium/WebKit 撤回路径和 Chromium 初始 GET A→B 隔离继续通过；
- 页面无 console error、pageerror、框架错误层、横向溢出或嵌套横向滚动；
- 桌面和移动确认框、风险说明及按钮均位于视口内，截图已人工检查。

Playwright 结果为 6 passed / 2 browser-specific skipped。两项跳过是明确只在
Chromium 运行的 A→B 迟到隔离在 WebKit 项目中的对应实例；Chromium 和实际
WebKit 的审批与撤回主路径均执行并通过。

截图：

- `apps/web-admin/test-results/draft-lifecycle-governance-1f739-romium-桌面通过并在-WebKit-390-驳回-chromium/project-expense-review-approve-chromium-1366x768.png`
- `apps/web-admin/test-results/draft-lifecycle-governance-1f739-romium-桌面通过并在-WebKit-390-驳回-webkit/project-expense-review-reject-webkit-390x844.png`

截图目录由 Playwright 管理并被 Git 忽略，不作为源码提交。

## 机器事实

相对上一个 Task 11 切片：

- Web API transport wrapper：383 → 384；
- Web API main binding：389 → 390；
- accepted action binding：21 → 23；
- unresolved action binding：30 → 28；
- covered production mutation consumer pair：15 → 16；
- uncovered production mutation consumer pair：259 → 258；
- page blocker：315 → 310；
- matrix blocker：370 → 367；
- orphan wrapper：保持 46；
- duplicate mutation route：保持 5；
- registered action：保持 42；
- route：保持 395；
- unclassified route：保持 26。

当前矩阵：

- 395 routes；
- 384 wrappers / 390 bindings；
- 42 registered actions / 51 action bindings；
- 23 accepted / 28 unresolved action bindings；
- 274 production mutation consumer pairs；
- 16 covered / 258 uncovered；
- 26 unclassified routes；
- 367 blockers。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `ea2d84320985b772b6be097672405821f635f20c979c894c41e41b111b08b102`
- `web-page-actions.registry.json`：
  `8ea146e5922d64fcb2123bf8b9cac5f9ed3c002d495b1a716c37fd79b11446b4`
- `web-page-actions.json`：
  `f039e3517a1148b3b767d98039993dc99aef5d7d49ac818fcc4912fb83b60693`
- `route-usage.json`：
  `a5936ee225663b4f6f6af6d04e3322fef7ad694a939226af51a8e2fca8c7a1b0`
- `whole-site-capability-matrix.json`：
  `a837fc33b89289f6bf9d1363d426e994a8844c7ba7e7c4349bb9dcaecaee2cf7`
- `whole-site-capability-matrix.md`：
  `357c8c5cbbcf17723a41e44865f4037aee51fad809bd6d3a56dc10278e5f3981`

## 最终验证

- 目标 API：7 套、269/269；
- PostgreSQL runner 静态测试：8/8；
- 目标 Web：4 文件、122/122；
- 共享领域：15 文件、149/149；
- Web 全量：146 文件、1449/1449；
- API 全量：263 套通过、16 套条件跳过；5081 通过、48 跳过；
- 六套 whole-site analyzer：202/202；
- 五份机器清单 write/check：通过，整体按未完成事实保持 `blocked`；
- 真实 PostgreSQL 16 空库：110/110 迁移、审批十五组场景、撤回七类回归及三组
  真实阻塞通过；
- production bundle Playwright：6 passed / 2 browser-specific skipped；
- 全 workspace typecheck 和 lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API `check:business-errors`：扫描 399 个生产 TypeScript 文件，55 个精确内部
  英文哨兵，通过；
- API/Web build：通过；Web 4454 modules，只有既有大 chunk 提示；
- Prisma validate/generate：通过；
- `git diff --check`：通过。

API 全量测试里的 Fontconfig 无可写缓存提示及负向用例模拟错误日志为既有测试环境
噪声；所有测试断言通过，没有被表述为零日志验收。

## 独立复核与剩余风险

后端、真实 PostgreSQL runner、前端因果链、manifest 和浏览器路径均经过独立只读
复核。首轮独立复核发现的真实创建冻结和冻结身份可达性 P1 已以新的 RED、实现和
真实 PostgreSQL 路径闭环；最终金额复核发现的既有实付下限 P1 也已用单测 RED、
写前校验和真实 PostgreSQL 完整快照零变化闭环。最终复核未发现剩余 P0/P1。

非阻断 P2：

1. `ApprovalInstance` 尚无
   `(businessType,businessId,flowType,status)` 活动实例唯一约束；当前 review 和
   withdraw 路径锁全部实例并对重复实例失败关闭，未来旁路插入仍需数据库约束；
2. 既有 `voidRequest` 仍只锁一条活动审批实例，异常重复实例时不会像本次
   review/withdraw 一样严格失败关闭；
3. 项目支出专用 PDF 当前尚未渲染本次冻结的审批签名；签名事实已可靠进入
   `ApprovalActionLog`，PDF 可观测性需在后续项目支出文档切片补齐；
4. 兼容字段 `reviewAction.enabled` 仍沿用旧布尔结果；生产按钮已经只信任原始
   `availableActions` 和四坐标，后续可统一只读兼容字段，避免未来新消费者误用；
5. 历史 role-only 审批实例继续按兼容策略不强制签名；新建项目支出已全部冻结
   governed 候选并强制签名，旧实例退出需另行治理，不能在本切片静默改写。

项目支出 assignment/standing delegation 继续按专项计划保持关闭，不列为本切片
缺陷；如未来要开放，必须另行设计受审计入口、迁移和权限回归，不能仅复用通用
Guard。

下一最小切片为 `project-expense.execution-local-status`（登记实付），必须先补
服务端 capability、父记录 CAS、稳定幂等、凭证独占、项目资金事务和前向
Schema/迁移，再做 Chromium/WebKit 主路径；不能先进入财务入账、收货确认或
Task 12。

未经另行授权不执行 Task 12 旧接口退出，不执行业务草稿 purge、正式业务记录、
AuditLog、checkpoint、旧表旧字段或其他物理删除。本切片未 push、合并、部署、
连接或写入生产。
