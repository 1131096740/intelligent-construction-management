# #382 / #398 normal261 列权限源级审计与恢复范围

2026-11-13，北京时间。该记录区分原实验、只读审计与后继授权，不把静态源码推导写成真实 PostgreSQL 已通过。

## 原始证据与因果边界

准确 ac721 的单次正常实付停在 SEED_LOGIN，原 stderr 为 AuditLog 权限 42501；完整停止与独立清理证据见 [停止回执](2026-11-13-382-ac721-normal261-stop.md)。原实际 SQL 写列和失败会话的逐列 ACL 没有保留，不能从通用 42501 单独确定缺 INSERT、RETURNING SELECT 或其他权限。

后继只读审查先确认登录使用专用 runtime，并非 owner、#394 普通应用或文件 writer。现有 AuditLog 的 SELECT 已覆盖 SDK 的全部9个标量返回列，User、RefreshToken、限流、岗位等读取及已用 UPDATE 也逐一核对，不能以宽泛增加 SELECT 或整表权限处理。

固定引擎 commit `605197351a3c8bdd595af2d2a9bc3025bca48ea2` 的官方源码表明：缺省输入中的默认值会在输入解析阶段加入写参数，SQL builder 将存在的参数列写入 INSERT。其 `@default(now())` 不只是依赖 PostgreSQL 默认；字面量默认、UUID和数组也需按具体输入核对。证据来自相同 commit 的 [输入解析](https://github.com/prisma/prisma-engines/blob/605197351a3c8bdd595af2d2a9bc3025bca48ea2/query-engine/core/src/query_document/parser.rs)、[创建输入映射](https://github.com/prisma/prisma-engines/blob/605197351a3c8bdd595af2d2a9bc3025bca48ea2/query-engine/schema/src/build/input_types/fields/data_input_mapper/create.rs)及 [SQL 构建](https://github.com/prisma/prisma-engines/blob/605197351a3c8bdd595af2d2a9bc3025bca48ea2/query-engine/connectors/sql-query-connector/src/query_builder/write.rs)。七份原文仅下载至外部审计目录，未运行引擎或查询数据库；两位审查者分别核对链与摘要。`add_datetimes` 处理 @updatedAt，不是 createdAt 的注入点。

## 正常路径的完整最小并集

仅作用于原 normal `registered.null-cross-company.commit`：登录、两次期初、一次跨公司实付、原键重放与 GET、独立观察。

| 表 | 必需新增 runtime INSERT 列 | 源级理由 |
| --- | --- | --- |
| AuditLog | createdAt | 默认 now 进入 Prisma 写参数。 |
| RefreshToken | createdAt | 登录后的令牌创建同样注入默认 now。 |
| RegisteredFundAccount | createdAt | 两次新账户创建的默认 now。 |
| FundAccountBalanceRegistration | createdAt、coveredExecutionIds | 默认 now；服务还显式传入空数组。 |
| PaymentExecution | createdAt | 正常实付 create 默认 now。 |
| RegisteredPaymentEvent | createdAt、eventType | 默认 now 与 payment_execution.registered 字面量。 |
| InterEntityRelationshipEntry | createdAt | 跨公司代付的往来根 create 默认 now。 |

合计9项，仅 INSERT、无 grant option。并集没有增加 SELECT、UPDATE(createdAt)、ipAddress/userAgent、revokedAt、整表授权或新的业务 writer。审计覆盖此正常路径已到达的全部默认值与返回列；不声称已覆盖其他竞办、凭证、归属差额或故障模式。

本例由 runtime 执行业务 Prisma 写，owner 只准备固定虚构主数据与已批准付款，不替 HTTP 创建账户或付款。现有直接/触发器/固定 SECURITY DEFINER 读取与 normal 分支已核；不能借该权限修复取消事务、改成 owner 写或增加投影 fallback。

## 恢复授权与必须保持的边界

用户对明确问题回复“确认授权”，允许源码修复、无资源本地验证、原 Draft #428 集成与常规 CI（含 GitHub 临时数据库测试）。没有授权新的手动受控迁移或实付，旧单次许可不复用；不合并 main、不部署或操作生产。

修复须以明确非 undefined 的 `TASK16_PAYMENT261_RUNTIME_V1` 与准确 261 来源、账本、Schema 同时约束。不能只检查来源为261，也不能依赖会把 undefined 当旧模式接受的通用判断。旧259、archive-only及其他未经本次审查的模式、observer、普通原应用与其他writer均不变；历史 baseline/registered 两份冻结 JSON、摘要及七片 SQL 不改。

同一有效计划、模式、摘要和权限数必须贯通 prepare/verify、installer、独立 staged/committed 目录、B7、live、应用与业务 permit，缺项、额外项、换模式/计划或调用者自报标志均应拒绝。已发现 business 准备器给多个261模式先创建 normal sidecar 再覆盖模式，因此允许在原同计划绑定范围内一并修该准备器；不扩大权限集合或业务场景。

实现工作树须从准确集成头独立建立；原 ac721 源、构建、方案与消耗/停止材料保持。本段为实施前边界，后继源码集成见下文；原 CI 32/32 只属于 ac721，新候选的模型、CI及真实行为必须分别记录。

## 源码实现与独立集成

准确提交 `ce46c8f1af37fe1d0701e34a3d72a927f43ce719`，树 `c00a10e7dbcc492eda00870b79c8f5963613a47d`，父提交为文档基线 `03411aa03b140afbe93ed248102857ad1d876d15`。独立实现工作树为 `/private/tmp/jg-398-normal261-plan-repair-20261113`；完成前已合入集成最新文档头，工作树干净。改动仅18路径（10控制源、8既有测试），275增/58删；无 Schema、迁移、业务服务或 SQL 正文变更。

固定增量仅当显式 normal261 付款模式与准确261来源、账本及Schema同时合格时派生。绑定为冻结的 `{paymentProfile, insertAdditionCount, accessPlanSha256}`，摘要基于实际 runtime/observer有效向量；原 registeredManifestSha256 保持冻结源文件摘要含义。准备/验证、安装、七片向量、B7、live、应用、issuer/permit/case使用同一计划。特殊场景准备器传入其实际模式、模式缓存隔离，不能先取得 normal 九列再覆盖模式。

作者先运行独立 literal 九元组公开反例，再最小实现；首轮5项、耦合40项及完整编排20项失败均保留，并逐组记录正常契约修正、模型适配及实际实现错误。原259来源的失败分类曾被提前校验改变，已恢复原断言；没有把旧权限期望改宽、删除反例或增加skip。最终结果：

- 完整 `test:ci-orchestration`：1713总项，1712通过、0失败、1既有条件skip，退出0。
- API generate/build/typecheck/lint退出0；最终 live 模型73/73。
- 独立审查者在准确ce46的私有依赖副本运行15套既有边界，492/492，0skip；规范与规格两轴均0可操作发现，之后才将集成分支从034快进至ce46。
- 历史baseline/registered、Schema、七片SQL与固定reader共11文件，独立逐字与034比较相同；迁移与其他权限矩阵未变。

作者/独立证据：`/private/tmp/jg-398-normal261-repair-receipt-20261113.md`、`/private/tmp/jg-398-normal261-frozen-check-20261113.json`、`/private/tmp/jg-398-normal261-standards-review-ce46c8f1-20261113.md`、`/private/tmp/jg-398-normal261-spec-review-ce46c8f1-20261113.md`、`/private/tmp/jg-398-normal261-merger-ce46c8f1-20261113.md`。它们仅证明已标明的源码/模型/构建范围，未运行新的手动 PG、SQL、once 或实际业务。

原 ac721 另做一次纯文件观察计时（不是新候选验收）：完整校验约2732ms、轻量校验约47ms，整体14.36秒；五树68,064项/703,296,404字节，未加载SDK或原生引擎、未连接资源。原始计数元数据的light次数误填5，外部INTERPRETATION更正为4，原记录保持，无重跑。该单次组件测量不能解释原57分钟整体原因，本修复没有为提速改动守卫或预算。证据 `/private/tmp/jg-398-fs-check-timing-20261113/READONLY-RECEIPT.md`。

新文档头将推送原 Draft #428 并运行其常规CI，必须另记准确新SHA与结果。旧 ac721 的失败和清理结论不改，新手动 normal261 需要在新准确候选上重新封存并取得独立授权；#398与#394仍未验收完成，14/45阶段关闭不变，无main合并、部署或生产操作。

后继状态（本段优先于上一段推送前的计划描述）：原 Draft #428 的准确候选 `88a83fd8f6a796567f156a6c52ac72d82cddd7f1` 已推送；fresh 回读 [CI43274524003](https://github.com/1131096740/intelligent-construction-management/actions/runs/43274524003) 为 completed/success，32 jobs全部成功、0失败/取消/跳过，含常规GitHub临时数据库门。这是准确88a的CI证据，不能替代新的手动普通实付验收。公开状态已由主控更新 [#398评论](https://github.com/1131096740/intelligent-construction-management/issues/398#issuecomment-6832447496) 与 [#382评论](https://github.com/1131096740/intelligent-construction-management/issues/382#issuecomment-6832448089)，PR仍Draft、14/45阶段关闭不变。

新88a普通场景计划已仅运行SOURCE_ONLY prepare/helper verify，主计划摘要 `3e747bce13be8d97fdd1fa4f92cdd80bf9889de8423599a840ad77e184782114`，显式normal261/count9/effective access摘要与侧车、来源及请求绑定，run为空且未消耗attempt或启动资源。源码、依赖、构建、计划与run原身份封存不动。上次“确认授权”只允许源码修复、本地无资源验证和常规CI；新的手动隔离迁移/普通实付仍须新明确授权，旧ac721停止与已消耗许可不复用。任何后继候选都须重新绑定准确SHA与证据。外部CI完成收据 `/private/tmp/jg-398-ci88a-completed-receipt-20261113.md`，提议范围/精确命令 `/private/tmp/jg-398-normal261-plan-88a83fd8-20261113/NORMAL-261-88a83fd8-ONLY-PROPOSED.md`；无新手动once、部署或生产操作。

## 外部详细上下文

- `/private/tmp/jg-398-normal261-repair-scope-readonly-20261113.md`：已独审的完整实施范围与负控。
- `/private/tmp/jg-398-prisma-now-readonly-20261113/FINDINGS.md`、SOURCES.json：固定引擎的七份原文摘要和链。
- `/private/tmp/jg-398-login-closure-readonly-20261113.md`、`/private/tmp/jg-398-opening-closure-readonly-20261113.md`、`/private/tmp/jg-398-registration-closure-readonly-20261113.md`：分段闭包。
- `/private/tmp/jg-398-timestamp-security-readonly-20261113.md`：独立安全边界审查。
- `/private/tmp/jg-398-performance-readonly-20261113.md`：原57分钟分段事实；瓶颈原因尚未实测闭合，不借修权限放宽预算或校验。
