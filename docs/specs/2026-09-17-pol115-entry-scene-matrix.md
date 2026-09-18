# POL-19C / #115 填写入口边界矩阵

## 2026-09-17 Owner 批准后的实施状态

Owner 已批准精简方案，登记评论 `5707792263`：仅新增 `ExpenseClaimEntrySnapshot`、`FundExecutionEntrySnapshot` 两表及不可变约束，在原领域事务中冻结和回读；本地实现、真实本地 PostgreSQL 16 验证和非生产交付已授权。以下“仅设计/待批准”描述保留为决策来源，现由本段批准覆盖。本人资料不新增表，生产迁移、部署和真实数据操作未授权。

首片公共接口为 `POST /expense-claims` → `POST /expense-claims/:claimId/submission` → `GET /expense-claims/:claimId`，使用真实 `AppModule` 和原认证/权限守卫。详情在原 `getMine` 可见性检查后返回 `entrySnapshots`；提交原事务冻结定义和值，版本绑定真实审批实例，不另造草稿实体。重复提交继续服从原领域状态机（已有提交返回拒绝且不得重复审批/快照）。非项目报销复用同表；不得允许新非项目借款。

本执行者持有费用申请与明细、领域 definition/policy/adapter、两表与唯一 migration、资金案件 submit 专属 adapter 及专属测试。共享注册、shared-domain 核心、付款/归档结果、混合页实付/finance_record、manifest 和 migration baseline 由总控与 #114 串行集成。本段不表示任何测试或整票验收已通过。

本轮仅形成实现前清单。候选 `codex/pol115-experience-20260917-embcaz`，基线 `b7b1a69a7ebb435e9b247642f951c33324a70eff`；2026-09-17 live #115 OPEN，#99/#100/#106/#110/#111 CLOSED。权威为正式规格 §20（并保留 §9 的费用/付款分层）及 #115 body/OWNER_CLAIM。以下路径均相对仓库；未迁移、未测试，不能作为上线覆盖收据。

## 入口、身份与原事务

| 业务与用户入口（`apps/web-admin/src/pages/`） | 现有目标及 ID 来源 | 原动作、字段权威与原事务冻结位置 |
| --- | --- | --- |
| 报销、借款、零星费用：`expense-claims/ExpenseClaimWorkbenchPage.vue` → `components/ExpenseClaimCreateDrawer.vue`；报销明细 `components/ExpenseClaimLineEditor.vue`；详情 `ExpenseClaimDetailPage.vue` | `ExpenseClaim`，`ExpenseClaimService.create` 返回 `claim.id`；项目取领域记录，不能信任表单项目替代归属；非项目报销允许 `projectId=null` | `expense_claim.create` / `expense_claim.submit`；`services/api/src/expense-claim/dto/create-expense-claim.dto.ts`、`createOptions` 和 `create` 为现有字段/候选/业务规则来源。主单含类型、使用单位、申请人/代办、项目/证明人、事由、金额、收款资料、借款清账日、零星费用分类；报销行含类别、日期、用途、票据张数、金额、证据/无凭证原因、备注。`create` 同 tx 创建草稿/明细及主体快照；`submit` 同 tx 锁主单、预留借款冲销、冻结审批节点和附件、转审批中。提交快照须挂接该原 tx，不能在自动保存时启动审批。 |
| 报销付款、借款放款/归还、付款主体调整：`expense-claims/ExpenseClaimDetailPage.vue` 的专属弹窗 | `ExpenseClaim` → `ExpenseClaimPaymentExecution` / `EmployeeProjectLoanEntry` / `EmployeeLoanRepayment`；归还确认/冲销用原返回 `repaymentId` | `expense_claim.payment.execute`、`expense_claim.disburse`、`expense_claim.repayment.record/confirm/reverse`；付款主体调整原控制器使用 `RequirePositions`，不虚构新 BusinessAction。字段来自各现有 DTO；`recordPayment`、`recordLoanDisbursement`、`recordEmployeeLoanRepayment`、`confirmEmployeeLoanRepayment`、`reverseEmployeeLoanRepayment` 各自原 tx 保留余额、往来与投影。付款只清偿，借款发放不记成本。此行暂缓代码，先与 #114 核对付款结果边界。 |
| 旧项目费用：`projects/ProjectOperatingOverviewPage.vue` 的创建、采购执行、实付/财务登记和收货区；`ProjectExpenseApprovalDetailPage.vue` | `ProjectExpenseRequest`，`ProjectExpenseService.create` 返回 ID，项目路由与数据库归属一致；执行/财务记录/收货为各领域生成 ID | `project_expense.create/purchase_execute/execution/finance_record/receipt_confirm`；`services/api/src/project-expense/dto/` 与 `project-expense.config.ts`。`create` 原 tx 冻结审批节点及融资占用；`recordPurchaseExecution`、`recordExecution`、`recordFinance`、`confirmPurchaseReceipt` 分别原 tx。整页不能宣称 #115 独占：实付及 `finance_record` glue 按总控约定由 #114 持有，先只读。 |
| 零采申请/修订：`spot-procurement/SpotProcurementWorkbenchPage.vue`、`SpotProcurementDetailPage.vue`、`components/ProcurementLineEditor.vue` | `SpotProcurement` / 当前 `SpotProcurementVersion`；由 `SpotProcurementApplicationService.createDraft` 创建，后续用已有主单/currentVersion，不以表格行伪造单据 | `spot_procurement.create`；`services/api/src/spot-procurement/dto/` 和原 application service 为主单/明细权威；创建/草稿更新/提交复用 `spot-procurement-application.service.ts` 原 tx 与锁定当前版本。审批意见/撤回确认保留专用交互。 |
| 零采收货、差异、退款、发票：`SpotProcurementReceiptWorkbenchPage.vue`、`SpotProcurementReceiptPage.vue`、`SpotProcurementDetailPage.vue`；`components/ReceiptLineEditor.vue` / `ReceiptPhotoUploader.vue` | 原 procurementId 与冻结版本/明细关联；收货、退款、发票各自领域实体，禁止合并为任意行集合 | `spot_procurement.receipt.confirm/receipt.review`、`spot_procurement.discrepancy.create/refund.record/invoice.append`；原 DTO、`spot-procurement-receipt.service.ts`（`updateDraft` / `submit` 的 Serializable tx）、closure/invoice service 保持各自校验与正式后果。照片上传/预览保留专用能力。 |
| 零采付款申请/付款主体/实付：`SpotProcurementPaymentWorkbenchPage.vue`、`SpotProcurementPaymentDetailPage.vue`；`PaymentApplicationStepper.vue`、`PaymentExecutionDrawer.vue` | 原 `paymentId` 与对应采购/版本；来自领域建付款草稿结果或路由回读 | `spot_procurement.payment.submit/facts.manage/execute`、`spot_procurement.balance.execute`；`spot-procurement-payment.service.ts` / balance service 原 tx。此行列入完整覆盖，但付款结果范围先与 #114 串行核对。 |
| 资金办理：`fund-executions/FundExecutionWorkbenchPage.vue` 的创建、分类、反向原因；`fund-movements/FundMovementPage.vue` 当前仅查询列表，无填写表单 | `FundExecutionCase` / 原执行反向引用；候选来自服务端签发 `selectionRef`，不要求填写银行观察/分配技术 ID。`FundMovement` 由现有来源链和领域命令产生 | `fund-execution.api.ts`、`fund-execution.state.ts`、`fund-execution.controller.ts` / service 是现有命令与能力权威；不能杜撰统一 BusinessAction 映射。`FundMovementService.create/submit/confirm` 原 Serializable tx 保留分腿、归属、往来、双人职责与余额；不为只读页添加新的调拨产品。 |

## 所有权与可启动切片

#115 可独立持有费用申请 drawer/明细、`expense-claim.api.ts` 与 `expense-claim` 内的申请 create/submit 适配文件，以及后续明确分配的零采申请/收货专属文件。共享的 `business-entry-definition.scene-registry.ts`、`business-entry-transaction-scene-registry.ts`、统一字段类型/模板版本由总控与 #114 串行协调；本轮只读。`services/api/src/fund-execution/payment-execution-shared-allocation.service.ts`、`fund-execution-canonical-adapter.service.ts`、付款/归档服务及混合页面的实付、finance_record 区均不并行改写。#107 proof 引擎和所有 manifest 不在本候选写范围。

首个建议公开切片：**项目内借款申请 create → 明确 submit**，用既有 `expense_claim.create/submit` 与原审批冻结 tx；覆盖统一表单/窄屏、保存失败留值、明确提交、重复提交与回读快照。先单类型可避免报销行、归还和付款结果交叉，但不得借机取消其他既有类型或将局部迁移宣称整票完成。

拟新增且由 #115 独占（尚未创建）：`services/api/src/expense-claim/expense-claim-entry.definition.ts`（仅映射现有 DTO）、`expense-claim-entry.policy.ts`（原主单归属和经办人授权）、`expense-claim-entry.adapter.ts`（原 submit tx 接线）及对应公开入口测试。共享集成面只有现有注册汇总：#114 owner 将 definition/access 导出接入 `business-entry-definition.scene-registry.ts`，transaction policy 导出接入 `business-entry-transaction-scene-registry.ts`；#115 不改汇总文件、shared 核心或注册规则。实现前由总控确认文件归属和场景键，不能由本清单自行生效。

真实待决边界：当前事务场景策略只接受 `project_owned_entity`，生产策略数组为空且注释明确 #114 持有具体矩阵；本票场景尚未注册，需总控确定共享注册集成点后才启动代码 TDD。非项目报销是既有合法业务，不能塞入虚构项目来通过事务归属检查；其适配需要既有全局目标与原申请人授权契约的明确方案。资金办理跨多个项目，也不能强行压成唯一项目；先保留原多 scope 权威。上述是覆盖/接口适配阻塞，不是许可扩大 Schema 或权限。

已核对 global 契约：`BusinessEntrySceneAccessPolicy` 支持 global resolver，但 global policy 必须 `roleScope=global`；当前 `authenticated_self` 仅绑定 `user_self_profile`。它不等同费用的经办人/代办/证明人/审批可见范围，不能直接借用。且 `BusinessEntryTransactionService.freezeSubmissionSnapshotInTransaction` 明确拒绝非项目 target，所以现有 global 读取/字段校验不足以唯一确定非项目报销的同事务冻结接线。**非项目报销仍在 #115 完整交付范围，待精确接线；不是删范围。** `payment_execution` 资金办理共用链保留 integration 待办，不另写付款执行规则。

## 验收清单（均待执行）

- 同字段：表单、行表格、手机卡片、只读和 Excel 对同一草稿验证一致；批量粘贴逐格中文错误、200 条报销上限沿用 DTO；不新建客户端第二份权威字段。
- 附件：上传/预览/签名、审批意见、二次身份确认、敏感确认按 §20.8 保留专用交互；冻结已有附件关系与追加依据，不能当普通文本字段。
- 退款：零采退款绑定原采购/付款与剩余额度；未用借款归还仅恢复资金和冲减往来；不得重复记成本。覆盖失败事务不留下字段快照或部分正式事实。
- 窄屏及批量：逐项填写无巨型横向必填表格；桌面复制粘贴、草稿增删/撤销、金额元转换、并发版本与失败留值均需公开入口证据；当前只读资金列表不伪报填写入口。
- 交付按最窄公开业务测试 → 类型/lint/UI → 适用真实 PG16 与精确 SHA 门；本轮未安装、运行测试、启动数据库或执行任何远端写入/生产动作。

## Owner 决策补充：整票持久化边界（2026-09-17，仅设计，最多一页）

**结论：费用和多项目资金办理各需要明确的领域提交快照存储；不能只补 global resolver。推荐领域原事务保存，不放宽项目共享 store，不先实施。**

| 检查对象与本候选证据 | 现有持久化能否直接承载完整字段定义/值/版本 | 推荐最小方案与授权边界 |
| --- | --- | --- |
| `schema.prisma:5853` 的 `BusinessEntrySubmissionSnapshot` 必填 projectId/FK；`business-entry-definition.service.ts:434,486` 拒绝 global；transaction service 仅项目对象 | 只能满足唯一项目归属；不能把无项目/多项目压成一个项目，也不能通过 standalone 冻结绕过原业务事务 | 保留原 Schema/权限和 shared store。项目单据（旧项目费用、零采申请/收货/退款及项目付款）仅需各 owner 的领域 definition/policy/adapter 接线，仍按具体正式对象及原事务写快照。 |
| `ExpenseClaim`（Schema 4398）、明细 4449、附件 4470；实付 4489、借款分录 4524、归还 4573 都是业务字段，没有完整定义 JSON。`ExpenseClaimService.submit:748` 冻结审批/附件并改主单状态 | 现有公司/申请人名称快照、审批节点、PDF、audit 均不是统一字段版本仓库。不能挪用。新建 loan 在 service 159 明确要求项目；非项目报销合法。loan account 可空项目不代表允许新增非项目借款 | **须新增 Schema：建议一个费用领域专用 `ExpenseClaimEntrySnapshot`**，同一存储覆盖项目/非项目三种既有 claimType，避免同一费用分两套快照。用真实 claim FK、明确场景/业务动作、原操作对象引用、提交修订唯一键、definitionVersion/definitionSnapshot/valuesSnapshot、冻结人/时间与不可更新删除约束；申请在原 submit tx 写，后续付款/归还场景仅在各领域原事务由相应 owner 接入。原附件引用随领域事实冻结，不存文件正文。字段/约束需用户明确批准后设计 migration；本补充不授权 Schema。 |
| `FundExecutionCase`（3037）为追加修订链；axis selection（3077）含 optionSnapshot/consequencePlanSnapshot；`appendCase` 在 service 1680 后复制领域选择 | 合法业务快照已存在，但含分类后果而非完整字段定义；往里面加任意字段会改变现有指纹/后果契约。审批 JSON 也不能充当字段仓库 | **须新增 Schema：建议 `FundExecutionEntrySnapshot` 一对一绑定真实 submitted case revision**，保存完整定义/值、版本、冻结人/时间，追加式且 FK 绑定原 case。在 `submit_case` 原 Serializable tx 创建 successor 后保存；退回重提产生新 case revision/新快照，原快照不改。原多 scope 授权、选择凭据复验、金额与分类后果全部沿用；不新增多项目引擎。需用户明确批准该表/约束和 migration。 |
| `FundExecutionCommandReceipt`（3102）、`FundMovementCommandReceipt`（3351）；`receiptFirst:1793` 重放直接返回 responseSnapshot；movement create 只写 movementId/status/revision 响应 | 回执服务于幂等响应，不是输入定义仓库；直接扩入完整快照会改变 API 回放及历史合同。FundMovement/sourceSnapshot 是分腿来源事实，也无字段定义槽位 | 不挪用回执，不改其响应/指纹规则。资金申请快照绑定 case，重复命令用既有回执返回同一 case，不能再生成一份快照。只读 FundMovement 不新增表单/专用快照表。付款 execution 入口留 #114 integration，沿用其唯一付款结果接线。 |

**可纯 glue 的部分：**费用表单/行/手机/Excel 到同一定义的映射；原 DTO 校验、当前候选查询、申请人/经办人/代办与审批可见范围复用；项目单据到原项目共享 store 接线；领域详情读取已授权对象的冻结快照。非项目读取不得借用个人资料的 `authenticated_self`，须由原 `getMine`/领域可见规则包住，提交继续只有原经办人；不新增业务权限或放宽 global policy。

**一次批准包应覆盖：**上述两类领域快照新增 Schema/migration 和不可变约束、领域内同事务保存/读取、各正式动作唯一引用与重放测试；批准后先确定费用全部场景的同一存储设计再启动项目借款首片。原批量草稿、自动保存和提交幂等缺口需同实现验证，但不据此另造通用草稿引擎。费用后续实付/归还引用细项与 #114 付款结果集成由原领域事实决定，不允许一票多存。非项目借款新建、只读调拨新表单、泛化非项目/多项目引擎、共享 store nullable projectId 均不在推荐方案。未运行数据库、测试或修改业务/Schema。
