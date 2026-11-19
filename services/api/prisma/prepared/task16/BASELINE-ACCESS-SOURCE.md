# B5 基础角色/ACL源码合同（未执行数据库）

本片基线8e80a1ab，沿用户已确认身份/角色隔离、TLS/集群变化、顺序/首败/清理“确认全部，仅源码与模拟测试”。测试只在原`runTask16RegisteredPg(options, adapters)`的installBaselineAccess函数项引用同一生产stage，resource.getReceipt/execOwnerSql/close全显式mock；没有新CLI、mock旗标、私有函数测试或物理边界。

顺序保持202迁移→B5基础角色/既存对象逐列ACL→原七片单事务installer→B6精确registered增量/最终有效矩阵→clients/App/fixture/case。B5不是把角色建好便成功：核固定owner/TLS/DB OID/cluster、完整202 ledger、角色与技术对象初次不存在/四DB新scope，再同事务DDL前重复核对；COMMIT前与后均由临时catalog validator核有效权限/角色/技术函数和nonce。owner资源入口仍固定verify-full/ON_ERROR_STOP=1，未知/丢提交回执不重试、不称回滚；finally由原driver清理exact resource。

`task16-baseline-access.json`是新Task16清单，不复制旧Task01上限。runtime27个既有表条目、observer8个既有表条目；各条列select/insert/update及源码证据。无select的Prisma find/create/update需要返回现有scalar字段，列表显式展开；显式select还计WHERE列。INSERT按源码data及client UUID、UPDATE计@updatedAt；真实引擎生成SQL与实际列ACL兼容仍未跑。observer另三张新表和coveredExecutionIds留B6。B5不授序列/表级权限、DELETE/TRUNCATE/REFERENCES/TRIGGER、grant option、membership、ownership、CREATE/TEMP或runtime直接Project DML。

源码追踪包含真实HTTP login(User UPDATE/RefreshToken/Audit INSERT)、两次opening(账户/登记/来源 INSERT)、付款options/record/replay/result及observer投影。普通helper只单授runtime `public.assert_inter_entity_relationship_lineage(text,text)`：202最终InterEntity deferred必调用它，NULL case仍读PayableSettlementCase(id/status/paymentExecutionId)；v7入口另读BankTransactionClaim.paymentExecutionId。只读独审笔记`/private/tmp/jg-382-task16-B5-existing-function-closure-notes-20261108.md`，不据trigger入口自动授EXECUTE。helper原body/owner/INVOKER/plpgsql亦入catalog检查。source_insert读取父登记xmin，因此仅额外SELECT(xmin)，ACL快照/矩阵含系统列；不升整表SELECT。

PG16 [SELECT文档](https://www.postgresql.org/docs/16/sql-select.html)说明FOR UPDATE还需某列UPDATE权限；当前付款原SQL锁payment与version。仅给ContractVersion.UPDATE(updatedAt)，同时安装owner持有/固定body/search_path=pg_catalog的ALWAYS BEFORE UPDATE guard，对runtime session_user任何实际版本行UPDATE拒绝，owner种子保留。catalog核签名/body/owner/语言/trigger时机/启用及无直接EXECUTE；restricted不能改函数/trigger/replication。没有改业务query/Schema/迁移，也没有授id/status/业务列UPDATE。SELECT不触发此DML guard是[PG16触发器合同](https://www.postgresql.org/docs/16/sql-createtrigger.html)，模拟不证明实际行锁成功或UPDATE被拒。

未作Project SD桥：正常付款同时将Settlement.status改为paid/partially_paid，旧lockProjectConstructionEnterpriseFromFormalFact入口76–79立刻RETURN。owner fixture创建effective版本/结算仍缺合法ProjectAffiliateAssignment前提，须后续seed片补齐，不能删guard或用授权掩盖。非空文件动态helper/非normal canonical路径未审完整，不通过全schema/table/function授权兜底。

B6仍须补五新表、RegisteredFundAccount.writeRevision、FundAccountBalanceRegistration.coveredExecutionIds及七片实际helper闭包，核combined最终矩阵，保marker无直接DML、observer只identity EXECUTE及B5版本锁guard。禁止在历史片之后blanket grant/reset覆盖边界。

stage输出BASELINE_ROLE_ACL_COMMIT_OBSERVED/角色OID/manifest与SQL/期望矩阵摘要；financialAcceptance/aclAcceptance/tlsAcceptance均false。driver保baselineAccessOutcome并向七片传连续context。默认仍缺五原生stage，资源前拒绝。实际PG语法/ACL/catalog/物理DML/COMMIT/TLS/竞争/清理未执行；#398、17/24与16/42/44门及13/45不变。所有未来commit/push HEAD须[skip ci]，本作者freeze前后无提交推送。


既有owner终态另外按封存POL275迁移明确七表→jg_pol275_owner及十七函数逐签名→同owner，其他业务关系/函数预期迁移actor主owner，public schema限主owner/pg_database_owner。关系枚举仅r/p/S/v/m/f，不把index/TOAST/rowtype纳未知宽松特赦；七表无声明序列。appendOperatingImpactThroughService的动态ALTER保原owner，沿本次全部迁移固定actor及之前创建链预期主owner，仍无DB实证。只读ownership清单见外部20261108 JSON；保留旧技术grantee，不给新runtime membership/EXEC上限。

最终原108＋新19＝127模拟/CLI25及六受影响CJS语法/lint、API类型/src lint通过；独立双轴待主控。所有SQL仍未实际解析/执行。
