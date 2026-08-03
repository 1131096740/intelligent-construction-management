# 五包阶段 C：整站能力矩阵风险分级回执

## 1. 结论

阶段 C 已在阶段 B 最终候选 `97a372fae1df0853d5e4c31d8febe2b11a0383c2`
上完成。六份 machine-readable manifest 已重新生成且与仓库版本无差异：Nest
路由 399 条、未分类路由 0 条，整站严格矩阵仍为 `blocked / 310 blockers`。

310 是多个检查层级的原始计数，不是 310 个独立业务缺陷。按首次上线可达性、
写入风险和共享根因归并后：

- P0：212 个原始 blocker，去重为 194 条证据记录，收敛为 7 个按依赖排序的修复流；
- P1：55 个原始 blocker，归并为 4 个可只读隔离的低频管理写入组；
- P2：43 个原始 blocker，去重为 40 条治理记录，归并为 3 个退出/工具治理组；
- 未分类路由为 0；没有把上游汇总项、同一消费者关系和同一 wrapper 重复列为开发任务。

阶段 C 只完成风险分级和可执行处置，不表示 P0 已清零，也不表示 Task 11 或五包
完成。下一步只能进入阶段 D；不得合并 PR、部署生产、执行迁移或修改生产业务数据。

## 2. 精确基线与重生结果

| 项目 | 结果 |
| --- | --- |
| 分支 | `codex/five-package-go-live` |
| 阶段 B 精确 SHA | `97a372fae1df0853d5e4c31d8febe2b11a0383c2` |
| Nest 路由 | 399 |
| Web transport wrapper / binding | 388 / 408 |
| 页面动作 / binding | 59 / 84 |
| 页面路由 / 外部接管 / 退出候选 / 内部任务 | 294 / 59 / 43 / 3 |
| 未分类路由 | 0 |
| 生产 mutation consumer pair | 277；已覆盖 30，未覆盖 247 |
| 严格矩阵 | `blocked`，310 blockers |

执行并核对的清单：

1. `nest-business-routes.json`
2. `web-api-wrappers.json`
3. `web-page-actions.json`
4. `route-usage.json`
5. `whole-site-capability-matrix.json`
6. `contract-workbench-capability-matrix.md`

重生没有产生文件差异，说明本次分类针对的正是阶段 B 已验证的源码树，不是旧报告
或旧 SHA。

## 3. 310 原始计数如何归并

| 原始 blocker 类别 | 数量 | 风险归属 | 归并说明 |
| --- | ---: | --- | --- |
| `upstreamManifestIssues` | 2 | P2 | page-action 与 API-wrapper 的汇总状态，不是两个新缺陷 |
| `webRequestsWithoutNest` | 1 | P2 | `createSpotProcurementPaymentDraft`；同时已计入 orphan wrapper |
| `orphanWrappers` | 37 | P2 | 36 个 `test_only`、1 个 `unreferenced`，均无生产消费者 |
| `duplicateMutationRoutes` | 3 | P2 | 两组含 test-only 别名；`POST /files` 为复合 wrapper 共用上传传输 |
| `unresolvedActions` | 20 | P0 | 18 个动作 ID、20 个 binding，均位于首次上线业务路径 |
| `uncoveredMutationConsumers` | 247 | P0 192 / P1 55 | 全部来自可达生产模块；按首发业务路径与可隔离管理写入拆分 |
| **合计** | **310** | **P0 212 / P1 55 / P2 43** | 原始计数对账完整 |

重叠关系：20 个 unresolved binding 中有 18 个已经是 247 个 uncovered pair 的同一
`API wrapper × production consumer` 记录；另外 2 个是同一消费者上的额外触发器。
P0 因此是 194 条唯一证据记录，不是 212 个独立开发任务。P2 去除两个纯汇总项，
并把无 Nest 路由项与同一 orphan wrapper 合并后为 40 条唯一治理记录。

## 4. 唯一 P0 修复队列

以下顺序就是阶段 D 的唯一执行顺序。每个修复流都必须把相关动作登记为可追溯的
页面或后台动作，证明服务端 capability 支配触发器、因果链可解析、后端权限/状态/
并发/审计失败关闭，并补同一候选 SHA 的真实页面动态证据。

| 顺序 | 修复流 | uncovered pair | unresolved binding | 去重证据记录 | 上线失败关闭与退出条件 |
| --- | --- | ---: | ---: | ---: | --- |
| C-P0-01 | 私有文件、下载票据、手写签名与审计入口 | 4 | 0 | 4 | 任一文件越权、签名漂移或审计缺失均 No-Go；入口隐藏不能替代核心文件链 |
| C-P0-02 | 合同草稿、工作台、合同生命周期与历史接管 | 85 | 11 | 87 | 合同主链失败即 No-Go；单个接管动作不能通过时停写接管模块并提交 Go/No-Go 范围变更 |
| C-P0-03 | 结算草稿、导入/预览、审批、归档与回收事实 | 29 | 6 | 29 | 结算主链失败即 No-Go；未通过动作隐藏且服务端停写 |
| C-P0-04 | 付款申请、审批、实付、凭证、财务与 PDF | 12 | 1 | 12 | 金额、幂等、凭证或财务事实任一失败即 No-Go |
| C-P0-05 | 项目费用、项目资金/垫资、上游资金与挂靠事实 | 18 | 1 | 18 | 未通过子模块整体只读；不得留下部分可写入口 |
| C-P0-06 | 员工费用/借款/报销、放款、还款与付款 | 15 | 1 | 15 | 未通过子模块整体只读；资金类动作不得依赖员工反馈发现问题 |
| C-P0-07 | 零星采购申请、付款、收货、发票、退款与异常终止 | 29 | 0 | 29 | 未通过子模块整体只读；申请、付款、收货不能只关闭其中一段 |
| **合计** |  | **192** | **20** | **194** | P0 清零后方可进入冻结 SHA 总门 |

合同流的 11 个 unresolved binding 涉及：聚合自动保存、租约获取/心跳/释放、手动
保存、预览排队、合同移交、接管创建/更新/提交复核、合同提交。结算流的 6 个
binding 涉及草稿新增/更新、Excel 上传与导入预览、后台与手工预览。另有付款申请、
项目费用创建、费用申请提交各 1 个 binding。

### P0 的临时关闭原则

- P0 默认失败关闭；按钮隐藏、页面只读和服务端停写必须同时有可验证证据，不能只改菜单。
- 合同、结算、付款、私有文件、签名和审计属于承诺的核心链，任何关键动作未通过即
  No-Go，不能用“员工先反馈”替代上线门。
- 项目费用、费用申请、挂靠/资金和零采若整组未通过，可使用整模块停写作为技术兜底；
  但这会缩减第 6.1 节已冻结的首发范围，必须在 Go/No-Go 前由产品负责人明确签认，
  不得由开发侧静默降级。

## 5. P1 处置表

55 个 P1 均是当前路由图中可达的生产 mutation consumer，不得因为“低频”继续裸露。
阶段 D 要先实现下表的只读隔离；最终在阶段 H 的 Task 11 严格清零前补齐动作证明。

| 处置组 | pair / wrapper / consumer / route | 当前上线可见性 | 风险 | 首次上线临时关闭方式 | 负责人 | 最终收口阶段 |
| --- | --- | --- | --- | --- | --- | --- |
| C-P1-01 主体与相对方主数据 | 6 / 6 / 4 / 6 | 页面路由可达，写控件按页面状态/岗位显示 | 错主体或错相对方会污染后续合同事实 | 保留查询与选择；隐藏新增、版本新增、编辑和停用；直接 URL 仍由后端鉴权 | 合同域负责人 | D 实施只读；H/Task 11 补齐并清零 |
| C-P1-02 合同/版式/条款/编号/结算模板治理 | 37 / 36 / 7 / 37 | 管理页面可达，部分已有全局岗位限制 | 错误发布会影响新合同或结算文档 | 冻结为只读，只允许使用已发布版本；隐藏创建、克隆、编辑、提交、发布、停用和预览生成 | 合同与结算模板负责人 | D 实施只读；H/Task 11 补齐并清零 |
| C-P1-03 组织、岗位与审批委托 | 11 / 11 / 6 / 11 | 组织页有全局角色门；委托页为已登录入口 | 直接改变权限或审批代理关系 | 保留组织/委托查询；隐藏新增用户、部门/岗位调整、批量移除和委托创建/撤销 | 系统管理员/权限域负责人 | D 实施只读；H/Task 11 补齐并清零 |
| C-P1-04 复制已放弃合同草稿 | 1 / 1 / 1 / 1 | 合同列表中可达的便利动作 | 可能复制陈旧业务事实，但不阻断新建主链 | 隐藏“复制已放弃草稿”，保留正常新建合同 | 合同域负责人 | D 隐藏；H/Task 11 补齐或退出 |

P1 只读成立有一个前置条件：阶段 E 的初始化预检必须证明首发所需公司主体、相对方、
已发布模板、编号规则和 11 名员工岗位已经齐备。若缺少任一数据且必须依赖对应管理写入
才能上线，该 P1 立即升级为 P0，不能在上线当天临时开放未验证写入口。

本次对 247 个 pair 使用以下有序规则，可由同一 manifest 重算：消费者路径属于
`business-parties` 或 `company-entities` 的归 C-P1-01；属于 `contract-templates` 或
`settlement-templates` 的归 C-P1-02；属于 `organization` 或 `delegations` 的归
C-P1-03；精确等于 `contracts/ContractListPage.vue` 的归 C-P1-04；其余 33 个消费者
均属于第 6.1 节首发业务域，按合同、结算、付款、费用、项目资金、零采和文件/签名归入
7 个 P0 修复流。该规则得到 P0 192、P1 55，合计精确等于 247。

## 6. P2 处置表

| 处置组 | 原始/唯一记录 | 当前上线可见性 | 风险 | 临时关闭方式 | 负责人 | 最终收口阶段 |
| --- | ---: | --- | --- | --- | --- | --- |
| C-P2-01 orphan 与前端无后端 wrapper | 38 原始 / 37 唯一 | 36 个仅测试引用、1 个完全未引用；无生产消费者 | 测试可能依赖旧封装，长期造成误判 | 不加入页面、不导出新消费者；保持现有生产零可达 | Web 治理负责人 | H/Task 12 按组删除或迁移 |
| C-P2-02 重复 mutation route 拓扑 | 3 / 3 | 每组已有唯一生产路径；别名或复合 wrapper 不单独暴露按钮 | 清单归因含糊，可能在未来产生双入口 | 禁止新增第二生产消费者；保留服务端鉴权和现有唯一页面入口 | Web/API 治理负责人 | H/Task 11 规范建模，Task 12 删除 test-only 别名 |
| C-P2-03 上游 blocked 汇总 | 2 原始 / 0 独立 | 不对应用户入口 | 仅会让严格总门保持 blocked | 不需要运行时开关；由子项清零自动消失 | 能力矩阵工具负责人 | H/Task 11 严格门清零 |

三组重复路由分别为：

- `POST /contracts`：生产 `createWorkbenchDraft` 与 test-only `createContractDraft`；
- `POST /files`：多个业务复合 wrapper 共用 `uploadPrivateFile` 传输；
- `POST /projects/:param/contract-takeovers/:param/corrections`：生产
  `submitContractTakeoverCorrection` 与 test-only `recordContractTakeoverCorrection`。

阶段 B 另有一个不在 310 内的 P2：GitHub `checkout/setup-node v4` action runtime 的
Node 20 弃用 annotation。它不影响当前应用 Node 20 的成功验证，由 DevOps 负责人在阶段 D
或 H 升级 action major 后重新跑 CI。

## 7. 阶段 D 验收口径

1. 严格按 C-P0-01 → C-P0-07 推进；一个修复流内按“后端不变量与测试 → 服务端
   capability → 页面触发/并发隔离 → manifest → 浏览器证据”执行。
2. 每完成一个流就重生六份清单，记录原始 blocker 和 P0 唯一证据记录的下降量；不得
   用总数下降替代该流验收。
3. P1 若暂不补齐，必须先提交可自动验证的只读/隐藏门；P2 不进入 P0 开发队列。
4. 阶段 D 退出时：P0 为 0、P1 全部已隔离、未分类路由仍为 0；随后才能冻结 SHA
   并进入阶段 E 四线总验证。
5. Task 11 的最终完成条件仍是严格矩阵 0 blocker。首次上线只允许在 P0 清零且 P1
   已隔离后推进，不能把阶段 C 分级写成 Task 11 完成。

### 7.1 20 个 P0 unresolved binding 的精确动作 ID

- 合同（11 bindings）：`contract-draft.aggregate-autosave`、
  `contract-draft.lease-acquire`、`contract-draft.lease-heartbeat`、
  `contract-draft.lease-release`、`contract-draft.manual-save`、
  `contract-draft.preview-queue`、`contract-draft.transfer-local-gate`、
  `contract-takeover.create-local-role`、
  `contract-takeover.submit-review-local-role-status`、
  `contract-takeover.update-local-role-status`、
  `contract-workbench.submit-local-status`。
- 结算（6 bindings、4 action IDs）：`settlement-draft.save-local-gate`（新增/更新）、
  `settlement-import.preview-local-gate`（上传/预检）、
  `settlement-preview.background-local-gate`、`settlement-preview.manual-local-gate`。
- 付款（1）：`payment-request.create-local-form`。
- 项目资金（1）：`project-expense.create-local-role`。
- 费用申请（1）：`expense-claim.submit-local-status`。

## 8. 操作边界

本阶段只读取源码和清单、重生确定性 manifest、形成分类文档并更新 PRD/进度。未连接
生产环境，未启动数据库或浏览器运行门，未执行迁移、业务写入、物理删除、PR 合并或
生产部署。受保护的五包源工作树保持原样。
