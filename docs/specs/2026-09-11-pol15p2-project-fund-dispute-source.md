# POL-15P2 / Issue #280 一般争议资金正式来源

> 状态：冻结规格的非生产候选实现依据。本文不授权生产 migration/apply、部署、回填、真实业务数据写入或生产权限变更；也不包含 Issue #108 的完整经营账投影。

## 1. 冻结依据与范围

- 前置来源规格 SHA-256：`aa6b3750715c997ebbd2d733acf6869265b9766fdf7b792d17363ba52d5cc58b`。
- 拆票方案 SHA-256：`1bee470fd19c7c4012dcd864fe9f6dfcb572105467a01b29ddf9f9d98d91eeba`。
- 本票只交付 #280：一般争议资金的正式来源、职责分离、Schema/migration、最小权限、经营账 adapter/replay、响应式工作台和真实 PostgreSQL 16 门禁。
- #279 必要费用准备和 #275 清分对账是本票防双扣的既有前置来源；#108 在本票完成前继续保持 OPEN。

## 2. 业务身份与经营语义

聚合根为 `ProjectFundDispute`，append-only 分录为 `ProjectFundDisputeEntry`。根身份由项目、冻结施工企业档案、资金持有主体、依据类型、依据业务编号或证据哈希及币种经 RFC 8785 JCS + SHA-256 形成；经济身份不含来源类型，来源身份包含来源类型。

正式确认后只产生：

- fact：`project_cash_restriction`；
- subject role：`fund_holder`；
- establish/increase：`project_disputed_funds_increase`；
- release：`project_disputed_funds_decrease` / decrease；
- technical_reversal：沿用被冲销分录的 impact kind、sourceImpactKey 与 impact snapshot，并使用反向 direction；对建立/增加分录即 `project_disputed_funds_increase` / decrease；
- fact 方向保持 `neutral`，币种仅 `CNY`。

该来源不得产生或改变确认成本、应付、实际资金总额、预计利润。资金持有主体只允许当前有效的施工企业版本或项目参与公司。争议类型限定为 `upstream`、`downstream`、`inter_subject`、`external_restriction`，金额证据只接受 A/B 级；尚未收取的应收款及 #275 已覆盖事项不得登记。

## 3. 生命周期与职责分离

公共业务接口固定为：

```text
getWorkbench(query, actor)
saveDraft(command, actor)
transition(command, actor)
```

分录类型为 `establish | increase | release | technical_reversal`，动作仅为 `submit | attest | confirm | return`。职责如下：

| 动作 | 岗位 | 约束 |
| --- | --- | --- |
| 准备/提交 | contract_staff、contract_director、finance_staff 或 finance_director | 草稿仅原准备人修改 |
| 独立见证 | 当前项目 project_manager 或 contract_director | 必须与准备人不同 |
| 确认/退回 | finance_director | 确认前重验全部权威事实 |

提交冻结经济 payload；submitted/attested 期间不能改写。returned 的唯一草稿可以修订说明后重新提交。根经济身份从建立起即不可变；根说明只允许唯一且处于 draft/returned 的分录修订。confirmed 分录不可覆盖、删除或回退。

release 和 technical_reversal 必须精确引用同一根下已确认的 establish/increase。release 必须记录解决依据；技术冲销必须等额全额冲销原分录。部分变化只能用 release/increase。并发确认以 Serializable、稳定 advisory lock、行锁和数据库容量 guard 共同保证净争议占用不小于零。

## 4. 重复防御与替代闭合

确认事务同时完成来源确认和经营账追加；对 establish/increase 执行三层重复检测。release/technical_reversal 通过 exact 调整目标、容量与替代闭合校验，不重复套用正向建账阻断，否则会阻断正式来源替代后的追加式释放：

1. 相同经济身份或相同依据/证据的既有正式影响直接 `duplicate_blocked`；
2. 同金额、同主体但缺少可比身份的正式扣减标记为 `duplicate_suspected` 并失败关闭；
3. `pol280_cross_source_identity_exists(text)` 对 #279 必要费用准备按净有效金额阻断相同经济身份；既有 OperatingFact/impact 查询同时覆盖 #275 待对账/暂扣及其他正式资金限制。

release 可声明被正式结果替代的金额。替代关系必须同项目、已确认，并匹配固定的 impact kind/direction 对：成本、应付、预计清算、必要准备、资金冻结/减少或主体间往来；不能引用本来源自身影响。应用服务和数据库 trigger 均校验来源资格、逐条金额及释放总额，关系 append-only。

## 5. 权限、文件与审计

- 运行角色 `jg_pol280_runtime` 固定为 `NOLOGIN NOINHERIT`，拒绝 superuser/createdb/createrole/replication/bypassrls 和任何既有成员关系碰撞。
- runtime 只获得根/分录所需 `SELECT, INSERT, UPDATE`，替代/命令回执只获得 `SELECT, INSERT`；没有 DELETE/TRUNCATE/TRIGGER/REFERENCES 或 schema CREATE。
- 私有证据文件读取先校验一般争议资金 read action，不能因原上传者身份绕过；下载继续使用后端短效票据并进入既有文件审计。
- 草稿、提交、独立见证、确认、退回、释放及技术冲销均写入审计，记录有效岗位、分录类型、状态、修订、指纹和结果，不记录文件 URL、密钥或敏感内容。

## 6. 验收与交付边界

实现验收包括定向 Jest/Vitest、shared/API/Web typecheck、lint、`check:ui`、Prisma validate、迁移基线/动态清单、完整 `release:local`，以及本机缓存 `postgres:16` 的 exact-SHA、干净工作树、127.0.0.1 一次性数据库门禁。动态门必须部署全部迁移两次、seed 一次性数据库，并通过公开业务缝验证职责分离、幂等、根/分录不可变、跨来源阻断、替代闭合、经营账中性投影和并发容量。

开发期对未提交工作树的任何定向验证都不是 fixed-head 交付证据。正式收口仍需要最终 candidate SHA 的 PG16、`release:local`、独立 Standards/Spec 复审、fixed-head CI 和 merge-head CI；这些动作须分别获得对应授权。

本票不执行生产迁移、角色变更、数据回填、部署、COS 或真实业务数据操作。
