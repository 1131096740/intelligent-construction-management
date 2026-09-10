# POL-15P1 / Issue #279 必要费用准备正式来源

> 状态：冻结规格的非生产候选实现依据。本文不授权生产 migration/apply、部署、回填、真实业务数据写入或权限变更；也不包含 Issue #280 的一般争议资金来源或 Issue #108 的完整经营账投影。

## 1. 冻结依据与范围

- 前置来源规格 SHA-256：`aa6b3750715c997ebbd2d733acf6869265b9766fdf7b792d17363ba52d5cc58b`。
- 拆票方案 SHA-256：`1bee470fd19c7c4012dcd864fe9f6dfcb572105467a01b29ddf9f9d98d91eeba`。
- 本票只交付 #279：必要费用准备的正式来源、职责分离、Schema/migration、最小权限、经营账 adapter/replay、响应式工作台和真实 PostgreSQL 16 门禁。
- #280 继续依赖 #279；#108 继续依赖 #279 与 #280。本实现只预留跨来源重复检测，不创建或推断 #280 的业务模型。

## 2. 业务身份与经营语义

聚合根为 `ProjectNecessaryExpenseReserve`，append-only 分录为 `ProjectNecessaryExpenseReserveEntry`。根身份由项目、冻结施工企业档案、资金持有主体、依据类型、依据业务编号或证据哈希及币种经 RFC 8785 JCS + SHA-256 形成；经济身份不含来源类型，来源身份包含来源类型。

正式确认后只产生：

- fact：`project_cash_restriction`；
- subject role：`fund_holder`；
- establish/increase：`necessary_expense_reserve_increase`；
- release：`necessary_expense_reserve_decrease` / decrease；
- technical_reversal：沿用被冲销分录的 impact kind、sourceImpactKey 与 impact snapshot，并使用反向 direction；对建立/增加分录即 `necessary_expense_reserve_increase` / decrease；
- fact 方向保持 `neutral`，币种仅 `CNY`。

该来源不得产生或改变确认成本、应付、实际资金总额、预计利润。资金持有主体只允许当前有效的施工企业版本或项目参与公司。原因限定为质保/整改、法律/合规、法定收尾和其他已批准必要事项，金额证据只接受 A/B 级。

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
| 准备/提交 | finance_staff 或 finance_director | 草稿仅原准备人修改 |
| 项目证明 | 当前项目 project_manager | 必须与准备人不同 |
| 确认/退回 | finance_director | 确认前重验全部权威事实 |

提交冻结经济 payload；submitted/attested 期间不能改写。returned 的唯一草稿可以修订说明后重新提交。根经济身份从建立起即不可变；根说明只允许唯一且处于 draft/returned 的分录修订。confirmed 分录不可覆盖、删除或回退。

release 和 technical_reversal 必须精确引用同一根下已确认的 establish/increase。技术冲销必须等额全额冲销原分录；部分变化只能用 release/increase。并发确认以 Serializable、稳定 advisory lock、行锁和数据库容量 guard 共同保证净准备余额不小于零。

## 4. 重复防御与替代闭合

确认事务同时完成来源确认和经营账追加；对 establish/increase 执行三层重复检测。release/technical_reversal 通过 exact 调整目标、容量与替代闭合校验，不重复套用正向建账阻断，否则会阻断正式来源替代后的追加式释放：

1. 相同经济身份或相同依据/证据的既有正式影响直接 `duplicate_blocked`；
2. 同金额、同主体但缺少可比身份的正式扣减标记为 `duplicate_suspected` 并失败关闭；
3. `pol279_cross_source_identity_exists(text)` 对未来 #280 表执行固定形状动态检查：两张表均不存在时返回 false，仅存在一张时失败关闭，存在时按净有效金额阻断相同经济身份。

release 可声明被正式扣减替代的金额。替代关系必须同项目、已确认、方向为 increase，且只能引用确认成本、应付增加、预计清算费用、施工企业资金冻结或项目争议资金增加；不能引用本来源自身影响。应用服务和数据库 trigger 均校验来源资格、逐条金额及释放总额，关系 append-only。

## 5. 权限、文件与审计

- 运行角色 `jg_pol279_runtime` 固定为 `NOLOGIN NOINHERIT`，拒绝 superuser/createdb/createrole/replication/bypassrls 和任何既有成员关系碰撞。
- runtime 只获得根/分录所需 `SELECT, INSERT, UPDATE`，替代/命令回执只获得 `SELECT, INSERT`；没有 DELETE/TRUNCATE/TRIGGER/REFERENCES 或 schema CREATE。
- 私有证据文件读取先校验必要费用准备 read action，不能因原上传者身份绕过；下载继续使用后端短效票据并进入既有文件审计。
- 草稿、提交、项目证明、确认、退回、释放及技术冲销均写入审计，记录有效岗位、分录类型、状态、修订、指纹和结果，不记录文件 URL、密钥或敏感内容。

## 6. 验收与交付边界

实现验收包括定向 Jest/Vitest、shared/API/Web typecheck、lint、`check:ui`、Prisma validate、迁移基线/动态清单、完整 `release:local`，以及本机缓存 `postgres:16` 的 exact-SHA、干净工作树、127.0.0.1 一次性数据库门禁。动态门必须部署全部迁移两次、seed 一次性数据库，并通过公开业务缝验证职责分离、幂等、根/分录不可变、跨来源阻断、替代闭合、经营账中性投影和并发容量。

开发期对未提交工作树的任何定向验证都不是 fixed-head 交付证据。正式收口仍需要最终 candidate SHA 的 PG16、`release:local`、独立 Standards/Spec 复审、fixed-head CI 和 merge-head CI；这些动作须分别获得对应授权。

本票不执行生产迁移、角色变更、数据回填、部署、COS 或真实业务数据操作。
