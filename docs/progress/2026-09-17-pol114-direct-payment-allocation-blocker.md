# #114 直接合同付款实付阻塞：只读决策包

状态：未修复，整票交付阻塞。当前基于 `14680879275777eb44511c9e1fc12b8512e606d6` 的未提交工作树；不代表生产核查或新 Schema 授权。

## 真实接缝与失败

本机一次性 PG16 `pol114-finance-4clxww-20260917`，仅绑定 `127.0.0.1:55881`。`contract-business-entry-http.spec.ts` 的 `RUN_POL114_PAYMENT_HTTP_PG16=1` 扩展链经真实 HTTP 完成：受控合作单位创建、施工企业/参与公司配置、已发布模板/版式、合同草稿/direct_payment/真实提交、逐节点审批、签章/最终版归档、合同冻结阶段付款申请/逐节点审批、项目垫资额度两级审批。仅合成账号/岗位配置使用 Prisma create；未手工 effective/confirmed 或关闭触发器。

随后 `POST /payments/:id/executions` 500，底层 SQLSTATE `23514`，约束 `PaymentExecutionAllocation_settlement_required_check`。财务快照断言尚未到达，不得将此失败宣称为新增冻结功能的 RED。

最新失败付款 ID `bd1110bc-147f-420a-b0c7-84569ddf0cfc`。只读核验：仍 `approved_pending_payment`、paidAmountCents=0；PaymentExecution、PaymentExecutionAllocation、ProjectFundingAllocation、FinanceRecord 和 payment.execution.record 审计分别为 0。之前经 HTTP 已完成的合同、审批和额度事实是测试前置，不是失败实付事务的残留。

## 完整迁移与既有覆盖

- 本地 migration.sql 169 个；专库已完成且未回滚 169 个、未完成 0 个；逐文件 SHA-256 对比 `_prisma_migrations.checksum`，mismatches=[]。
- 实库 `pg_get_constraintdef` 为 `CHECK (("settlementId" IS NOT NULL))`。
- 初始迁移 `20260703143000_payment_execution_allocations/migration.sql:41` 添加该约束，后续迁移未移除。它保护基于结算的付款分摊不得脱离结算事实；金额为正、不得超过来源、sourceType、allocationType、stageType、唯一性、不可变触发器及外键分别还有独立约束。
- 原单测 `payment-request.service.spec.ts:7176` 明确验证冻结 generic contract 阶段，预期 allocation 的 settlementId 为 null；但 `createMany` 是数据库 stub（约 7224），不能检测实库约束。
- `payment-execution-concurrency.spec.ts` 的真实 PG fixture 是 sourceType=settlement、真实 settlementId；直接付款 capacity/facts/estimated 测试未覆盖本次 createMany 的非空约束。

## 为什么请求合法、为什么不能伪造结算

原 `PaymentRequestService` 在 generic_contract + 已确认 direct_payment、有效合同/冻结条款阶段、付款额度和审批通过后允许直接合同付款；create 分支明确写 settlementId=null（约 908）。`allocateContractDuePaymentExecution` 的冻结阶段分支（约 2625–2691）同样明确写 null，并绑定真实 paymentTermsVersionId/stageId 及 `contract:<terms>:<stage>` 来源行。此路径和上述单测均早于本轮财务字段修改。

同表 allocationType 包含 `contract_due_payment` 与 `advance_deduction`。前者既用于累计结算分摊，也用于直接合同冻结阶段；后者的预付款抵扣仍须绑定结算。不能简单删除全表约束，也不能把直接付款伪造成结算或手工插入实付。

## 最小修复选择（仅供 Owner 决策，未执行）

建议：保留所有原金额、唯一性、不可变和 FK 保护，只对“真实付款申请绑定冻结合同阶段”的 direct_payment 分摊建立窄例外；其他累计结算付款和 advance_deduction 继续要求 settlementId。精确例外需同时核对付款申请/合同版本/冻结条款与阶段身份，不能仅按 nullable 字段或字符串前缀放行；如跨表校验必须新增约束触发器/迁移，应明确授权后另做 RED→GREEN 与所有旧分摊回归。

替代决策：若业务要求所有实付都必须关联结算，则需改变既有直接付款产品语义、接口和单测，不属于本次统一录入授权。

主控允许继续真实结算付款链验证财务切片，但其通过不能替代或消除此阻塞。本轮未更改 Schema、migration、付款分摊代码或生产状态。
