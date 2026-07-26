# 全站填写型明细差距清单

## 口径

本清单盘点需要在同一业务动作中填写多条明细的界面，并单独登记容易与业务明细混淆的配置型重复行。列表、台账、审批时间线、归档目录和汇总表没有多行行内编辑时不属于迁移对象，即使它们提供筛选、查看或复制新草稿等业务入口。“建议底座”只是网格体验改造方向，P1/P2 也是该体验改造的建议优先级，不是项目业务优先级，不代表已排期或承诺迁移。

| 领域 | 页面/组件 | 当前编辑方式 | 是否多行填写 | 是否需要计算/粘贴 | 建议底座 | 本次处理 |
| --- | --- | --- | --- | --- | --- | --- |
| 合同 | [合同清单](../../apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue) / [领域网格](../../apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.vue) | 全宽专注模式；桌面 `JgBusinessGrid`、手机卡片；整表候选与一次保存 | 是 | 是：精确金额计算、批量粘贴、标准 Excel 预检替换 | `JgBusinessGrid` 领域适配 | 已完成 |
| 合同 | [付款条款](../../apps/web-admin/src/pages/contracts/workbench/ContractPaymentTermsSection.vue) | 一组原文摘要、比例、期限和布尔条件组成的扁平结构化表单 | 否 | 是：原文可粘贴，比例/期限需校验；当前不是行式明细 | 按整站总规格另开独立 `JgBusinessGrid` 切片评估 | 不处理（当前条款保存计划不含付款条款） |
| 合同 | [合同条款内容块](../../apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue) | 文本、列表和小型表格块的结构化编辑器 | 是 | 是：列表可按换行粘贴；表格为逐单元格输入 | 保持结构化块编辑器，后续独立评估批量能力 | 不处理（P1；当前条款计划只修本组件的保存生命周期） |
| 合同接管 | [历史计价项目](../../apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue) | 逐合同结构化向导中的重复卡片，逐项新增/删除 | 是 | 是：数量、单价和税率需要校验与金额事实核对；无批量粘贴 | 后续评估 `JgBusinessGrid` 领域适配 | 不处理（P2；真实试运行高使用，但当前逐合同向导的网格收益有限且需独立验收） |
| 合同接管 | [直接付款阶段](../../apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue) | 重复结构化阶段表单 | 是 | 是：比例或固定金额需校验；通常无需批量粘贴 | 保持结构化表单 | 不处理（P2；不是典型二维清单） |
| 合同税务复核 | [清单行计价事实](../../apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue) | 由既有清单派生的固定行卡片，只补含税单价和例外税率 | 是 | 是：影响税额核算；当前无批量粘贴 | 后续评估轻量网格或批量填充 | 不处理（P1；需先守住税务复核审计语义） |
| 结算 | [本期结算来源行](../../apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue) | `t-table` 内选择后逐行填写数量、人工金额和备注，另有多行粘贴弹窗 | 是 | 是：合同单价自动计价、人工金额、批量备注和多行数量粘贴 | `JgBusinessGrid` 领域适配 | 实施中（P1；先完成跨版本清单账本、单一进行中结算与后台重算，再迁移工作台） |
| 结算 | [独立人工调整](../../apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue) | `t-table` 内逐行新增/删除并填写名称、金额、原因、备注 | 是 | 是：正负金额参与结算合计；无批量粘贴 | 与结算来源行共用同一结算工作台切片 | 实施中（P1；与签证/变更项目、结算预览和提交原子性一起实施） |
| 零星采购 | [采购材料明细](../../apps/web-admin/src/pages/spot-procurement/components/ProcurementLineEditor.vue) | `JgBusinessGrid` 编辑，表外逐行删除 | 是 | 是：数量校验；网格原生支持多单元格录入 | 继续使用 `JgBusinessGrid`，后续补领域操作 | 不处理（已有统一底座；P2 仅评估行操作体验） |
| 零星付款 | [付款材料明细](../../apps/web-admin/src/pages/spot-procurement/components/PaymentApplicationStepper.vue) | 分步卡片表单；从已批准采购材料中逐行选择并填写数量、单价和票据事实 | 是 | 是：数量 × 单价预览；当前无批量粘贴 | 按整站总规格评估 `JgBusinessGrid` 领域适配 | 不处理（P1；另开切片守住来源和金额校验） |
| 零星付款 | [收款渠道](../../apps/web-admin/src/pages/spot-procurement/components/PaymentApplicationStepper.vue) | 可新增/删除的受控结构化卡片，登记方式、账户、开户行和唯一主渠道 | 是 | 否：不做行金额计算，也不应任意粘贴敏感账户 | 保持受控结构化表单 | 不处理（敏感账户与主渠道约束不纳入通用网格） |
| 零星采购 | [收货数量明细](../../apps/web-admin/src/pages/spot-procurement/components/ReceiptLineEditor.vue) | 按已批准材料生成的响应式卡片，逐行填写到货、破损、附赠和说明 | 是 | 是：数量差异参与收货/退款判断；当前无批量粘贴 | 保持移动优先卡片，后续评估桌面批量填充 | 不处理（P1；现场手机录入优先） |
| 报销 | [费用明细](../../apps/web-admin/src/pages/expense-claims/components/ExpenseClaimLineEditor.vue) | `JgBusinessGrid` 编辑，表外逐行删除 | 是 | 是：逐行金额合计必须等于申请金额；网格原生支持多单元格录入 | 继续使用 `JgBusinessGrid`，后续补领域操作 | 不处理（已有统一底座；P2 仅评估行操作和错误定位） |
| 配置治理 | [合同模板字段、清单、条款、附件、校验五组配置](../../apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue) | 五组重复配置行可新增、上下移动并随模板草稿整版保存；当前源码未提供逐行删除按钮 | 是 | 否：是 Schema 配置，不做业务金额计算或 Excel 粘贴 | 保持专用 Schema 编辑器，另评估配置行操作完整性 | 排除业务明细迁移（配置型重复行，已登记避免漏项） |
| 相对方 | [业务方多附件](../../apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue) | 多条附件卡片逐项选择类别、名称、有效期和文件，随业务方版本一起保存 | 是 | 否：不计算且不适合表格式粘贴文件 | 保持附件结构化表单 | 排除网格迁移（文件上传型重复行） |

## 台账与入口排除说明

以下页面虽然呈现表格或多条记录，部分也能进入详情或复制新草稿，但当前没有多行行内编辑，因此没有列入填写型明细迁移范围：

- [合同列表](../../apps/web-admin/src/pages/contracts/ContractListPage.vue)和[结算列表](../../apps/web-admin/src/pages/settlements/SettlementListPage.vue)是台账与业务入口，可进入详情或复制新草稿，但不直接行内编辑多条业务明细；[付款列表](../../apps/web-admin/src/pages/payments/PaymentListPage.vue)同样没有多行行内编辑；
- [资金工作台](../../apps/web-admin/src/pages/funds/FundsWorkbenchPage.vue)、[档案列表](../../apps/web-admin/src/pages/archives/ArchiveListPage.vue)、[审计日志](../../apps/web-admin/src/pages/audit/AuditLogPage.vue)；
- [项目经营总览](../../apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue) 等汇总和台账页面。

## 建议顺序

1. P1 先处理结算来源行/人工调整：行数、计算、粘贴和异常定位需求最接近合同清单，但必须独立设计后台核算与提交原子性。
2. P1 分别处理合同条款保存生命周期、零星付款材料领域网格、税务复核批量填充和现场收货桌面效率，不把敏感收款渠道或文件上传强行统一为二维网格。
3. P2 再评估合同接管、采购材料和报销明细的操作一致性；已有 `JgBusinessGrid` 的页面优先补领域能力，不重复更换底座。
