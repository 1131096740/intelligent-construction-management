# Fixture连接与独立观察者源码（未连接执行）

用户本轮对计划A+B明确确认：“确认全部，仅源码与模拟测试”。本片只实现A：现有公开fixture身份检查和原唯一case的observer投影协议；不启动完整driver，不新建CLI。

`RegisteredPgResourceProof` 现在区分完整 `resourceRunId`（UUID）与12位fixture `runId`。复用既有受控资源helper的真实技术命名 `jg_task01_<uuid32>`，fixture key严格取uuid32前12位；不伪造尚不存在的task16资源helper。数据库OID与集群systemIdentifier必须由受控owner入口先读出、再由driver冻结提供；自报proof和authorizationReference不是实际批准或资源证明。

`assertRegisteredPgConnectedRoles` 每次调用都查询三个客户端当前真实会话，核session/effective role、PG16、数据库/OID/cluster、TLS、replication、三个不同正PID；observer独立于runtime且必须read-only。owner读pg_control_system；非owner仅通过既有窄identity函数读取systemIdentifier，同时把其login/dbOid/backendPid/TLS输出与当前会话catalog相互核对。该identity函数仍须driver按固定源码安装并核owner/search_path/ACL/body来源；本片不安装任何函数或授权。

restricted角色查询检查无危险role标志/继承/成员关系/对象ownership、无public schema CREATE及单连接上限；observer还要求没有public表/列写权限和除窄identity函数外public函数执行权。查询是准备源码，未由真实PG解析/执行；不扩展为所有schema和传递副作用的完整权限验收。

transport声明现为 `isolated-loopback-tls-verify-full`。当前查询仅证明服务端会话ssl=true与固定身份；不能从PG查询证明客户端CA/SAN验证。未来driver必须对实际构造URL/连接池执行strict CA/SAN配置、负控和重连核验，不能仅填这个字符串。当前helper一次查询也不声称已核全部池连接；未来入口必须冻结单连接配置并对换连接重复公开检查。

原 `runRegisteredNullCrossCompanyCommit` 的案例ID、独立期望、金额、限制及handler导出未扩大。仅observer的snapshot查询新增明确select，去掉Prisma默认全scalar读取。离线CLI将自动绑定新case源码hash，无需弱化AST或改源码包状态。

## Observer所需读列（未来ACL输入，尚未授予）

| 表 | 明确投影列 | 额外WHERE列 |
| --- | --- | --- |
| PaymentRequest | approvedAmountCents, paidAmountCents, status | id |
| Settlement | payableAmountCents, paidAmountCents | id |
| PaymentExecution | id, idempotencyKey, amountCents, paymentRequestId, voucherFileId | paymentRequestId |
| RegisteredPaymentFunding | executionId, operatingLedgerEffectiveDateAtRegistration, actualPayerId, actualPayerKind | executionId |
| RegisteredFundPaymentAllocation | executionId, accountId, sourceBatchId, amountCents | executionId, accountId |
| RegisteredPaymentEvent | executionId | executionId |
| InterEntityRelationshipEntry | id, paymentExecutionId, sourceType, entryKind, direction, status, originalDebtorCompanyId, creditorCompanyId, amountCents, projectId | paymentExecutionId |
| OperatingFact | id | sourceType, sourceBusinessId |
| OperatingImpactEntry | id | sourceType, sourceBusinessId |
| AuditLog | actorUserId, metadata | businessType, businessId, action |
| FundAccountBalanceRegistration | accountId, balanceYuan, coveredExecutionIds | id |

这是原正常case当前查询所需列，权限还须包含predicate列；并非实际有效ACL证明。observer权限不足时停止，不改用runtime角色。owner种子和HTTP运行时所需权限另行按真实调用审定。

新增模拟用例只观察公开函数、客户端SQL协议和原case的公开fetch/查询协议，所有客户端/HTTP均替代，没有真实连接/端口。模拟通过不证明SQL语法、安装、实际TLS/ACL、真实COMMIT/响应丢失/并发或清理。总driver、资源授权和16/42/44硬门继续未完成；#398不关闭，17/24不解锁。
