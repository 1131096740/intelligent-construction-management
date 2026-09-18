# #114 旧合同提交兼容：安全审核待确认边界

候选基线：`b7b1a69a7ebb435e9b247642f951c33324a70eff`。本文只记录设计与测试现象，不表示整票通过，不改变生产状态。

## 当前证据

- `ContractController.submitApproval` 仍受 `@RequireProjectRole("contract.submit")` 控制；旧路由没有 tombstone 装饰器。
- `route-usage.registry.json` 将旧路由登记为 `exit_candidate`；当前生成清单记录无 Web 消费者，但 `deletionAuthorized=false`。这不是已关闭或生产零调用证明。
- `ContractService.submitApproval` 的旧 body 分支只在 owner 有值且不匹配时拒绝；新工作台分支要求 owner 精确匹配及租约。原 readiness 仅对 owner 有值的合同执行。
- `BusinessEntryTransactionService.freezeSubmissionSnapshotInTransaction` 在同一事务解析归属、岗位后，仍执行 `canPerform(scene.action, effectiveRoleKeys)`；合同场景 action 是 `contract.submit`。活跃账号本身不构成授权。
- 真实本机 PostgreSQL 16 + AppModule HTTP：现代合同旧提交成功，但详情缺少提交回执快照；经批准仅把刚由 HTTP 创建的合成草稿 owner 置空后，旧提交被新增场景 owner 条件拒绝。后者是明确的历史草稿 fixture 变换，不称为全程 HTTP 建档，不制造 confirmed 事实。

## 既有回执真实约束

`20260728100000_contract_draft_aggregate_foundation/migration.sql`：

- `idempotencyKey` 主键；`approvalInstanceId` 唯一。
- `expectedRevision > 0`；`requestSha256` 为 64 位小写十六进制；`formalCode` 非空。
- 合同版本、申请人、审批实例均有真实外键，删除策略为 RESTRICT。
- 旧成功提交中的真实对象可满足这些约束；不得用审计 metadata 代替回执业务快照。

## 拟补丁（尚未应用）

1. 仅将新增合同场景的 owner 检查恢复为原领域条件：`contract.ownerUserId && contract.ownerUserId !== actorUserId`；保留活跃账号、项目、草稿状态、原路由 `contract.submit` 及事务 `canPerform` 全部检查。新工作台提交仍先执行其原严格 owner/租约检查。
2. 旧成功提交同事务创建既有 `ContractDraftSubmissionRequest`，使用服务器生成的内部 UUID、当前正整数 draftRevision、服务器 SHA256、真实 approvalInstanceId 及正式编号。旧 body 不查询客户端幂等回执、不增加 lease；原重复提交仍由原 status 规则拒绝。旧响应形状不改。
3. 无 owner 历史形态的基础字段不得新增必填要求；合同名称可读原合同事实，主体名称只使用既有留存名称，缺失不得伪造。现代精确模板/清单定义继续沿当前同事务解析和冻结。

## 自动安全审核原文

> This action was rejected due to unacceptable risk.
> 补丁将旧提交权限放宽为任意活跃账号可操作无经办人合同，并为旧路径新增随机提交回执，超出用户批准的保留原权限、状态和字段规则的有限兼容范围。

该次补丁未应用。已向总控提供现有双重权限检查与批准范围证据，等待明确确认后重新提交同范围工具审核；未使用其他工具或执行方式绕过。其他已批准切片继续，旧链 RED 与整票未完成状态保留。
