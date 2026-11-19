# Task16 write authority and permanent provenance: source composition, not executed

SOURCE_ONLY_NOT_EXECUTED. Server Event and unique-latest-round application sources approval6a9a/funding14ca have now passed current58 related API534 plus API types/full lint. These application results do NOT prove prepared SQL syntax, JSON bytes/hashes, predicate locking, trigger order, COMMIT or concurrency; this is not a migration.

## 写时：只许可本次新实付

在同一登记事务内，由服务器读取并复验现有公共领域判据与当前正规批准轮；客户端不能提供用于豁免的标志。需要冻结到同一Execution唯一Event的最小坐标：请求ID、合同ID/版本ID、请求来源和主体、明确我方签约主体；批准轮ID及businessType/businessId/flowType/status。记录所见正式坐标而不新增一份付款/成本事实，也不制造旧请求的工资/历史成员。

写入/延迟守恒守卫须实际JOIN Execution→Request→ContractVersion，以及冻结的正规ApprovalInstance。版本存在且属于该合同，明确我方主体，来源在本票范围；实际工资Binding/历史工资summary关联不得伪装普通登记。以与应用相同的“本请求当前最新payment.approve轮”校验新写，不能在SQL查询中先筛approved从而复活旧轮。请求可能已由本事务更新成paid，不能用更新后的paid状态否认合法付清事实；金额/剩余/分摊/资金守恒仍由原同事务后果约束验证。

还须保留当前岗位与07主体资格的原权威：project-only财务不能变成全公司财务，super_admin不是业务办理人；停用原冻结责任公司可按已确认07例外延续，不能全局用isActive拒绝旧单，也不能让新停用代付公司穿透。具体SQL权限/冻结链表达尚待与现有函数精确组合，当前不声称已有实现。

时序和锁必须在实际PG组合验证：应用登记为Serializable且先锁正式请求/账户；仅锁住一个旧批准轮不能自行证明没有并发更新轮。相同createdAt造成的“最新轮”歧义也不能靠未经确认的UUID排序伪造业务顺序，应作为明确待验反例；此计划不预先改公共谓词或新增业务顺序字段。

## 永久：已正式事实可重放

永久canonical来源匹配只验证已被写时守卫校验并冻结的Execution/Funding/Event/合同版本身份、金额、账户、核对版本、守恒分摊和正式往来后果。不能依赖日后可变的latest轮、当前目录名称、当前手机号或当前办理岗位来否认原付款事实。现有源码version/snapshot不可变规则保留；后补凭证仍仅child证据叠加，不改原付款/Operating冻结sourceVersion或原正文。

一旦Execution已属registered来源，之后不能借旧工资Binding/summary写入口把同一事实重分类后让旧canonical证明失效。应针对精确registered Execution设置互斥约束，并保留非registered旧工资历史/共用能力的既有规则；工资专属新写退役归CUT-04/43，不在本票新增首次工资分类功能。

## Prepared真实PG反例清单（均未执行）

1. 正常当前批准+明确我方版本+足额来源，新登记一次成功；原合法旧银行分支及07存量主体规则不变。
2. 孤立版本、draft_unconfirmed、另一合同版本、非我方来源、真实工资Binding或summary：登记失败，Execution/Funding/Event/分摊/业务累计/审计零新增。
3. 请求旧status仍approved但最新returned/missing/非正规flow轮：拒绝新写；不得回查更老approved轮。相同createdAt多轮及并发新退回轮单独验证，不冒顺序确定。
4. Event缺批准坐标、自报旧轮ID、换请求/版本/主体、伪造status：即使JSON声称合格也必须被真实JOIN/守卫拒绝。
5. 原合法登记后新增/退回后继轮，原Execution/Operating fact/sourceVersion和已生成的A欠B仍可只读/重放为同一事实；不能二计或重扣。
6. registered事实随后插入工资Binding/summary应拒绝；合法旧工资事实的既有操作/历史读取不被本票例外放松。
7. project-only财务、技术管理员、撤岗与新停用代付主体的写前资格保持拒绝，原合法停用责任主体正控保留。
8. 与现有原key防重、commit拒绝、响应丢失和并发金额竞争组合：成功响应必须对应真实commit；失败/未知不自动换key，不产生第二付款/往来/扣款。

以上需要补成真实sourcecase和专用driver，并在准确源码/Schema/最终组合SQL经独立审阅后取得具体资源与执行授权。当前没有可冒充已执行的driver argv、数据库实例、迁移记录或PG通过收据。

## Source implementation review: still not executed

Event server coordinates now include original request paid/capacity and the actual domain/version/approval round. The new Event BEFORE guard checks original awaiting state and paid capacity; its deferred guard requires exactly the original paid amount plus this one Execution, within approval capacity, with the matching request status. The existing canonical audit guard additionally checks responsible payer versus actual payer, date, original/final status, and funding basis.

History SQL explicitly reconstructs d0a6 JSON.stringify field order with to_json strings, UTC-stored millisecond dates, NULL, and the same row ordering. It does not hash JSONB display text. The entire records/basis is also compared with the real complete set. This is a source design, not proof that PostgreSQL produces identical bytes or hashes.

The original identity-only writeRevision +1 exception and all task15 terminal zero-append guards remain. New Funding requires the account and Execution to have been written in this transaction. Same-createdAt latest rounds are explicitly rejected in this prepared guard, without invented UUID business ordering; the current application predicate has not gained that branch. This compatibility difference remains an independent review/PG counterexample, not migration approval.

Permanent canonical provenance binds the frozen Event, not future roles/latest rounds/history basis. No historical source members or amounts are invented. Actual driver/source-derived inventory and independently authorized PG execution are still outstanding.
