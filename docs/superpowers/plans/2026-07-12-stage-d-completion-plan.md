# Stage D Settlement Workbench Completion Plan

**Goal:** 让经办人只选择本期真实发生的合同清单项，网页与 Excel 都由同一后端规则重算，并完成结算模板版本治理；未选清单行不形成任何本期结算事实。

## D1 Canonical 明细与数量不变量

- `normal_auto`：仅 `ContractBill.amountRole=included` 且行非暂定价；请求只信任清单行 ID、本期数量、备注，复用 `calculateBillRow` 按合同 Decimal 单价、税率和 pricingMode 计算含税金额。
- `manual_amount`：暂定价、reference、non_priced、provisional；不自动计算，允许非负数量与人工非负金额。
- `manual_adjustment`：独立有符号金额，原因必填，不占合同清单数量。
- 未选行不进入请求、预览、数据库；合同来源数量/金额不得为负。
- 源行返回 amountRole、pricingMode、taxRate、calculationMode、前期/剩余数量。
- SettlementLine 冻结 Decimal 合同单价、税率、pricingMode、calculationMode；保留旧 `unitPriceCents` 兼容读取。
- 新增零业务写 preview；create 不再信任顶层总额或行金额。锁前快速校验与 Project `FOR UPDATE` 后二次校验都执行累计数量和金额检查。

## D2 全宽网页工作台

- 新建独立稳定路由，列表页只负责进入工作台。
- 表格只在勾选后启用本期字段；取消选择即删除本期行状态。
- 列展示合同数量/单价、前期、本期、累计、剩余数量、本期金额、备注与异常。
- 支持 TSV 粘贴、多行编辑、批量备注、独立调整行、sticky 合计和异常抽屉；合计只展示后端 preview。
- API 全部在 `settlement-workbench.api.ts`，只使用 TDesign 与 `--jg-*` token。

## D3 Excel 预检与幂等应用

- 独立 SettlementImport 记录上传文件、源快照、preview、错误、应用结果与操作者。
- 模板预填合同清单；“是否选中”为空/否的行完全忽略。
- 预检可以写导入记录/错误，但零 Settlement/SettlementLine 写入；逐行中文定位。
- apply 只固化 canonical 工作台结果，同一 import ID 重复 apply 返回同一结果；正式创建仍在锁内重算。
- 提供模板下载、预检、确认应用和结果导出。

## D4 结算模板版本治理

- 新建 SettlementTemplate/Version，不混入合同 DOCX 版式模型。
- 草稿上传 XLSX、列/元数据/打印区域/签字区检查、脱敏测试数据 XLSX/PDF 预览、提交、发布、停用、克隆。
- published 不可覆盖；检查和预览绑定 draftRevision，换源文件后旧结果失效。
- 兼容条件使用 amountRole/pricingMode；0 个 fail closed，1 个自动选择，多个由用户选择。
- Settlement 与导入记录冻结 templateVersionId。

## Verification

- API：税前/税后计算、Decimal 舍入、未选行省略、非自动行、调整原因、负数、累计数量/金额、锁后二检、preview 零写。
- Web：选中/取消、粘贴、批量备注、旧 preview 失效、只提交选中行、sticky 合计来自后端。
- Excel/模板：损坏文件、缺表、重复列、逐行错误、preview 零正式写、apply 幂等、版本状态与陈旧结果阻断。
- 每刀 targeted tests、typecheck、lint、check:ui/build、独立规格/质量复审；最终全量回归与 Chromium E2E。
