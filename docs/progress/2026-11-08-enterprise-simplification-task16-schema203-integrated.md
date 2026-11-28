# 经营精度与 Task16 Schema203 源码整合收据

## 准确候选与整树承接

本片仅整合已审经营精度 A3 `c4d1a1fbf947ebc60fa5be19fa424d394d365011`、六历史归属锚点更正 A4 `fe8ff2fdb684ea36fc1209e62f5e3d4f3a3dc413` 和 Task16 `07b0f85f7798e3a25bb9bc8459d72eadb2e920a7`。原 integration `d78b49905337599fa850b5693c6335f2c9ed80ea` 一次 no-ff 到 `5f646a4a58d9420592206b5be5b5969719c5f9c2`，完整 tree `3eb65c6a82e20b5e93d4a90edd8a5c0eaa07572f` 与已验证作者提交严格相同；随后仅本收据与 PROGRESS 两份文档变更。所有新祖先和整合提交含 `[skip ci]`，未重写历史。

Task16 修后27路径冻结 SHA256 `bfc4445d10f6109d9690ed60658085527c0faa7b2993aa25c6841d8c5f6de33e`，sourceSet `5e718b6b3e43de08a05e41828d1b6d00732e6d73c695bac268a1147809d74b74`。逐路径 blob、mode、前像及47条上游文件、ledger 原后缀均核对相符；未把在制 Task12 或其它树带入。经营四位小数与显式未知值、Schema203和对应源码均属本片已审范围，未执行迁移。

## 审查发现与边界

经营 A3 两轴复核0；A4纠正 Fact validator 历史归属锚点从4到实际6，保留首个严格4拒绝实际6的文本协议证据，新6文本匹配，非真实 PG 执行。Task16 首审两轴各1项 P2：SDK runtimeDataModel 未知嵌套写/别名逃逸漏拒，以及 Impact 单 OUT TABLE 的 catalog returnType 应为 text。均沿原公开 fake 接口实际 RED→最小 GREEN 修复，v2双轴0；Fact 仍为 record/set 与完整 OUT 校验。旧 freeze、原失败、前像与审查报告保留。

203库存严格准入，48 routine、两 composite 与两 validator/helper owner-callability 仅由完整已审源码和假 catalog 协议验证。runtime/observer 未新增 V2 EXEC/TYPE 授权。固定 driver SHA256 `384cc5b8e8a5eb8bce4d95f729a8dfc97c7815ed7ce17ba0fed382000faf33ce` 与 SOURCE_ONLY 前置拒绝未开放；默认入口、冷 CLI 或选项不能据源码齐备获得执行许可。

## 独立准确提交验证

以下全部新运行绑定作者提交 `07b0f85f7798e3a25bb9bc8459d72eadb2e920a7`，以 merge 完整 tree 相等承接，不宣称在中央旧 SDK 上重新通过类型门：

| 门 | 实际结果 |
| --- | --- |
| Task16完整13文件一次模拟 | 367/367，0 fail/skip/cancel/todo，437.746秒 |
| 原 prepare CLI | 27/27，0 fail/skip/cancel/todo |
| 原 registered-payment fixture | 20/20 |
| 经营34个受影响业务套件 | 34 suites、1148 tests，全过 |
| 私有203 API全量类型与 src lint | 均 exit0 |
| 19 CJS语法和 direct lint | 全部 exit0 |
| 两 profile 源码固定值与 baseline 级联 | 24+45 pins逐个匹配 |

完整模拟是单次367实跑，未拼接作者旧302+60。长测一次只读进程观察确认99.6% CPU后自然完成，未 kill、重启或改预算。Task16仅完整自有 fake commands/clients/process/clock，无真实 SDK/Nest/App 构造、HTTP/fetch、SQL解析执行、PG或资源；业务1148允许原已批准真实业务类+fake DB/本地 loopback公开 HTTP，fixture20仅真实 Prisma namespace/sql/Decimal纯值，不构造或连接 PrismaClient。未走 pnpm test prehook、生成或安装。

独立执行收据 `stage1-final-receipt.json` SHA256 `5ccdcd7a8ba00f81a9b9370df344b7ee9125158a8984139896ae953d28503067`；完整模拟日志 SHA256 `d9bd9c9c816b74bee09aa07cbe692146a215454da0b4f781ffec727991e7360d`。外部证据目录 `/private/tmp/jg-task16-schema203-merger-20261108/` 保存 argv/env/exit/log hash、逐项依赖守恒与首个 merger 状态目录折叠断言原件；后者经显式 untracked=all 修正，非产品失败。

## SDK 来源与源码封包

私有 SDK 四条绑定均在作者树内，目标依赖65481项与中央依赖65414项的全清单 hash/mode/link 前后精确相同；私有 SDK 287成员及 Shared产物沿批准来源不变。中央 node_modules/旧202 SDK 未写。私有 no-engine 客户端仅供类型和静态源码证明，`nativeRuntimeQualification=false`。

source Schema SHA256 `630401ecd59c4df458fa0c08bc302e7f2a9ff5c9fd1cd1002965f7976a2868bf`，generated/inline Schema `5dba68a98fddc0a0036a491198c12abde31afc880d9a0d8c73844cc4ded53c4c`，raw字节不等。接受的精确桥为35390有序 tokens、字符串与注释原文一致，仅 ExpenseClaim 唯一相同8-token index 在同一模型内从 token25211/行4907 移到 token25362/行4955；不任意排序模型或丢字段，不冒生成物逐字等同或原生资格。

准确干净作者 S 实际 source-only prepare/verify 成功：3496源码、203迁移源码、7安装片、1静态案例；packet SHA256 `b388e96e65f7434e92df916c847bdfde0d6d4a93e9e1806710ad7bc78a3768b9`，seal `abadb854c4f98e1a38fca4b98f24e8916e44b200c7c89cbef472a136c0acfee0`。本次两文档最终干净 HEAD 必须再实际 prepare/verify，最终 SHA、源码计数、packet/seal 与远端回读保存在同外部目录的 stage2 最终收据；不得拿 S 包代替。源码包不包含 SDK，`executionAllowed=false`、`resourceExecutorImplemented=false`，不是 SQL 或真实资源验收。

## 尚未完成

14/45仅各票准备/本地/技术阶段数，不等于193条规格或生产通过。#398仍OPEN，真实 DI/SDK/HTTP/PG/TLS/ACL/锁/COMMIT/故障/并发/资金/物理清理与16/42/44门未验；本片不关闭该票。#392仅用户接受 local-stage 后关闭；#394仍进行，CON10正式提交 consumer 与 CON15～18仍由Task12实现，旧410/409保留到完整新提交流程可用。

原 Draft PR428继续保留 Draft；最终准确 SHA Actions0/空 checks 不是 CI通过。[B3误触 CI 事故及远端不确定性](2026-11-08-enterprise-simplification-b3-auto-ci-boundary.md)与所有历史失败保留。未 main merge、ready、关闭其它票、部署或生产写入。
