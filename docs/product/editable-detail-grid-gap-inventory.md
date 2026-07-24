# 全站填写型明细差距清单

## 口径

本清单只盘点需要在同一业务动作中填写多条明细的界面。列表、台账、审批时间线、归档目录和汇总表等只读展示不属于迁移对象；“建议底座”也只是后续评估方向，不代表已排期或承诺迁移。

| 领域 | 页面/组件 | 当前编辑方式 | 是否多行填写 | 是否需要计算/粘贴 | 建议底座 | 本次处理 |
| --- | --- | --- | --- | --- | --- | --- |
| 合同 | [合同清单](../../apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue) / [领域网格](../../apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.vue) | 全宽专注模式；桌面 `JgBusinessGrid`、手机卡片；整表候选与一次保存 | 是 | 是：精确金额计算、批量粘贴、标准 Excel 预检替换 | `JgBusinessGrid` 领域适配 | 已完成 |
| 合同 | [付款条款](../../apps/web-admin/src/pages/contracts/workbench/ContractPaymentTermsSection.vue) | 原文摘要、比例、期限和布尔条件组成的结构化表单 | 是 | 是：原文可粘贴，比例/期限需校验；不是行式清单计算 | 后续独立切片评估 | 不处理（已另立条款保存生命周期切片） |
| 合同 | [合同条款内容块](../../apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue) | 文本、列表和小型表格块的结构化编辑器 | 是 | 是：列表可按换行粘贴；表格为逐单元格输入 | 保持结构化块编辑器，后续独立评估批量能力 | 不处理（P1；先解决保存生命周期） |
| 合同接管 | [历史计价项目](../../apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue) | 重复卡片表单，逐项新增/删除 | 是 | 是：数量、单价和税率需要校验与金额事实核对；无批量粘贴 | 后续评估 `JgBusinessGrid` 领域适配 | 不处理（P2；接管低频且改造风险高） |
| 合同接管 | [直接付款阶段](../../apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue) | 重复结构化阶段表单 | 是 | 是：比例或固定金额需校验；通常无需批量粘贴 | 保持结构化表单 | 不处理（P2；不是典型二维清单） |
| 合同税务复核 | [清单行计价事实](../../apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue) | 由既有清单派生的固定行卡片，只补含税单价和例外税率 | 是 | 是：影响税额核算；当前无批量粘贴 | 后续评估轻量网格或批量填充 | 不处理（P1；需先守住税务复核审计语义） |
| 结算 | [本期结算来源行](../../apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue) | `t-table` 内选择后逐行填写数量、人工金额和备注，另有多行粘贴弹窗 | 是 | 是：合同单价自动计价、人工金额、批量备注和多行数量粘贴 | 后续评估 `JgBusinessGrid` 领域适配 | 不处理（P1；高价值候选，需独立保证后台重算与异常链路） |
| 结算 | [独立人工调整](../../apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue) | `t-table` 内逐行新增/删除并填写名称、金额、原因、备注 | 是 | 是：正负金额参与结算合计；无批量粘贴 | 可与结算来源行在同一后续切片评估 | 不处理（P1；必须与结算预览和提交原子性一起设计） |
| 零星采购 | [采购材料明细](../../apps/web-admin/src/pages/spot-procurement/components/ProcurementLineEditor.vue) | `JgBusinessGrid` 编辑，表外逐行删除 | 是 | 是：数量校验；网格原生支持多单元格录入 | 继续使用 `JgBusinessGrid`，后续补领域操作 | 不处理（已有统一底座；P2 仅评估行操作体验） |
| 零星采购 | [付款材料与收款渠道](../../apps/web-admin/src/pages/spot-procurement/components/PaymentApplicationStepper.vue) | 分步卡片表单；付款材料来源固定，渠道可新增/删除 | 是 | 是：数量 × 单价预览；收款渠道不适合任意粘贴 | 保持分步结构化表单 | 不处理（含敏感账户与强业务约束，不建议通用网格化） |
| 零星采购 | [收货数量明细](../../apps/web-admin/src/pages/spot-procurement/components/ReceiptLineEditor.vue) | 按已批准材料生成的响应式卡片，逐行填写到货、破损、附赠和说明 | 是 | 是：数量差异参与收货/退款判断；当前无批量粘贴 | 保持移动优先卡片，后续评估桌面批量填充 | 不处理（P1；现场手机录入优先） |
| 报销 | [费用明细](../../apps/web-admin/src/pages/expense-claims/components/ExpenseClaimLineEditor.vue) | `JgBusinessGrid` 编辑，表外逐行删除 | 是 | 是：逐行金额合计必须等于申请金额；网格原生支持多单元格录入 | 继续使用 `JgBusinessGrid`，后续补领域操作 | 不处理（已有统一底座；P2 仅评估行操作和错误定位） |

## 只读页面排除说明

以下页面虽然呈现表格或多条记录，但当前职责是查询、汇总或审计，因此没有列入填写型明细迁移范围：

- [合同列表](../../apps/web-admin/src/pages/contracts/ContractListPage.vue)、[付款列表](../../apps/web-admin/src/pages/payments/PaymentListPage.vue)、[结算列表](../../apps/web-admin/src/pages/settlements/SettlementListPage.vue)；
- [资金工作台](../../apps/web-admin/src/pages/funds/FundsWorkbenchPage.vue)、[档案列表](../../apps/web-admin/src/pages/archives/ArchiveListPage.vue)、[审计日志](../../apps/web-admin/src/pages/audit/AuditLogPage.vue)；
- [项目经营总览](../../apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue) 等汇总和台账页面。

## 建议顺序

1. P1 先处理结算来源行/人工调整：行数、计算、粘贴和异常定位需求最接近合同清单，但必须独立设计后台核算与提交原子性。
2. P1 分别处理合同条款保存生命周期、税务复核批量填充和现场收货桌面效率，不把它们强行统一为二维网格。
3. P2 再评估合同接管、采购材料和报销明细的操作一致性；已有 `JgBusinessGrid` 的页面优先补领域能力，不重复更换底座。
