# 任务16共享付款待办首片检查点

本地进行中，不是任务16完成或待关闭候选。基于准确中央 `94cb10946effa5f3fc3e17b1e652c467980c6a6d`，已实现已批准合同付款的共享只读队列、Me待办/首页计数及原幂等键结果查询；执行、余额扣减、凭证后补及真实UI均尚未实施。真实PG、SQL执行、资源、迁移、银行/COS/通知、交易、部署和生产写均未执行。

## 首个公共反例与当前验证

- 真实Nest/JWT、当前岗位、权限与退役守卫，合成持久层种入既有已批准100元付款；公开 `GET /payment-executions/work-items` 原404而独立期望200，唯一Jest反例失败。最小只读入口后同例通过，财务和综合主管读取同一付款及10000分剩余，不新增付款事实或银行动作。
- 同一公开只读边界4项现已通过：共享待办；既有部分付款夹具对两人保持待办且付清夹具消失；撤岗/停用/技术管理员不能办理；最新审批轮已退回时不返回旧批准任务。这些是读取夹具验证，不冒称已实际登记过一次付款。
- 借用的资金合成适配器原先把日期转星期字符串排序，造成最新轮夹具假失败；只将Date按ISO时间排序后，业务源不改，同4例及任务15原52项公共HTTP全部通过，共2套56项，0失败/0skip，6.727秒。原假失败与两次类型接线错误日志保留，不计业务RED或数据库通过。
- 依赖按离线冻结锁、ignore-scripts安装；同hash5.22自有本机引擎仅pure generate，固定unused loopback1 URL，不连接数据库；Shared build通过。影响包typecheck/lint、治理、真实浏览器、原369尚未运行，不能称本票门禁通过。

证据目录 `/private/tmp/jg-task16-evidence-20261106`；准确Git检查点、源码封包、日志argv/退出码/哈希由该目录的 `shared-work-items-checkpoint.json` 登记。

## 后续权威与未决前提

已确认D06的资金容器、来源批次、业务使用归属、余额核对登记词义就近补入API领域词汇。后续仍以一份正式付款事实及稳定源身份关联容器/来源守恒分录，不能另造付款、影子余额或成本；不把旧FundMovement的公司/项目约束直接放空来硬套公共现金。

技术方案明确历史承接截止前已付只计累计、不可再扣期初。当前余额登记只有核对日期和依据，并没有逐笔付款是否已含的源事实成员关系。例：11月5日已核余额10000元，11月6日补录一张付款日为11月4日的300元支出；仅凭登记时间或付款日期不能自证它是否已由历史累计/期初承接包含。下一执行片必须明确使用已冻结的承接依据和源事实身份，不在此检查点擅自选择再次扣减、自动建垫资或新增用户硬门。具体模型缺口先向主控报告，真实资源演练仍另需授权。

任务16须实际PG正常提交、提交异常/断连、响应丢失、幂等与并发证明；合成56项不代替这些门，本票保持开放，17/24等依赖不因此解除。

## 第二只读片：Me接入与未知结果查询

- 公共 `GET /me/work-items` 在综合主管身份原本200但pending为空，预期应有同一批准付款；最小接入后通过。Me普通待办、资金待办和首页卡片的合同实付项复用当前公司财务/综合主管及最新批准轮的单一读取规则，部分付款夹具仍待办，付清夹具消失，撤岗后不再显示。其他采购/审批业务不变。
- 公共 `GET /payment-executions/results/:idempotencyKey` 原404，最小入口后通过。查询唯一正式 `PaymentExecution`，不存在时返回“尚未查到付款登记结果，请保留原请求并继续查询”，不将尚未观察到事实等同失败重发。已存在事实返回同一登记、金额、北京日期及凭证状态；撤岗拒绝。此处用合成存储种入既有事实，不证明真实提交、响应丢失或实际新增付款。
- 当前新公开HTTP7项、原资金HTTP52项、原Me39项共3套98项通过，0失败/0跳过。原Me夹具13处缺事务回调与1处私有签名旧断言产生的83通过/14失败保留；仅补回调执行、将原部分付款夹具改为当前公司财务并保留原30000元剩余断言、更新actor参数。没有以生产能力探测分支或skip绕过。最初缺AuditService的测试装配失败也保留，不计业务RED。
- API `tsc --noEmit` 及完整API lint已通过；无Nest build、路由清单同步、真实浏览器或全仓369证据，新只读路由清单仍待同步。本票尚不是完整候选，旧资金快照受预算控制的另一路聚合仍需统一审查。
- 历史权威只读调查：`Project.operatingLedgerEffectiveDate` 是项目经营启用日；`ContractTakeover.takeoverCutoffDate/historicalPaidCents`、`ContractTakeoverHistoricalPayment`及其唯一源匹配，`OperatingTakeoverLegacySourceBridge`源坐标，`HistoricalFinancialTakeoverBatch/RowMapping/Activation`冻结源集与回执均可复用明确源身份。历史A层payment_execution映射链接既有PaymentExecution，B层opening_balance不得伪造付款。但现资金容器期初与这些已激活源成员尚无关联，不能由日期推断已含/未含。主控已收到具体反例及候选方向，未加新硬门。

第二片日志仍在同一证据目录：`me-shared-work-items-fixture-audit.log`（有效Me RED）、`me-shared-work-items-green.log`、`payment-result-query-red.log`、`payment-result-query-green.log`、`me-shared-and-fund-regression.log`（旧夹具失败）、`me-shared-and-fund-adapted-fixtures.log`（98通过）、`api-typecheck-me-query.log`、`api-lint-me-query.log`。全部真实PG案例尚未执行，源码封包不能计资金事务安全通过。
