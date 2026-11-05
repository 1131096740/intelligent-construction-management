# 任务01准备产物与执行输入交接（2026-11-05）

本文是[任务01 #383](https://github.com/1131096740/intelligent-construction-management/issues/383)的跨会话输入交接：把已确认的源码输出清单、已有运行准备源码、真实Web复用入口和保留基线逐项对应，不作为普通测试进度日志、执行批准或真实业务验收收据。详尽历史见[集成交接](2026-11-05-enterprise-simplification-integration-start.md)，字段合同及实际源码链接见[准备runbook](../runbooks/enterprise-simplification-acceptance.md)。本文不修改规格、票据验收规则或 `PROGRESS.md` 状态。

## 本次准备边界与阶段收据

用户最新确认任务01以 `--prepare` / `--verify` 及输出清单为测试边界。原票作为验证前置片，以可核验准备产物验收，并保持未授权实验不启动；准备产物完成不等于HTTP/PG/Web、迁移、TLS/权限或清理运行已通过。状态及最终准确SHA由主控核齐后登记，本文不自行关闭任务或解除后续门禁。

已知阶段 `b09c629cee3466f9d3bc4fc4555617378b14c055` 的source packet：3031份文件、197份迁移，`sealSha256=97c0f5f96bc0697e0b7247b9c9e9275a979852bf76a09111be7ac733e8c60c5a`；packet文件SHA-256为 `0624aea376c2987da7ed1ab134f449e04b6683f8a1a1f484216a1bf254152056`。这是已存在的阶段收据，不是本交接提交后的最终包；任何新提交须重封。

同一b09阶段新增准备测试的库存接线尚有既有编排356通过/3失败，作者正在修复，不能宣称全绿。较早78a6f7b6冻结359通过、35项组件、复审0/0只按其准确SHA使用；没有把它们拼接成b09或未来候选通过。首条真实HTTP/PG案例1项未执行，资源/迁移/角色SQL、真实TLS正负控、实际清理及Web串接全部NOT RUN。

## 从source packet到运行材料

| 层次 | 已有准备产物与对应 | 交给下一会话时的边界 |
| --- | --- | --- |
| source packet与stdout | [CLI](../../scripts/prepare-enterprise-acceptance.cjs)的 `candidateSha/files/lockfile/migrations/sealSha256/scope`；`--verify`独立从当前HEAD核对完整集合 | 当前确认边界，只读源码并写新packet；不安装依赖、不构建、不创建PG、没有execute模式 |
| runtime inputs | [driver](../../services/api/prisma/run-enterprise-task01-local.cjs)消费 `purpose=task01-runtime-inputs-not-approval`、`sourceSha/candidateRoot`、node/Prisma版本、五个工具真实路径/哈希、五树清单、docker身份及构建见证路径/哈希 | 它是后续运行材料，不是source packet的隐藏输出；当前没有把未审临时preflight草稿当正式生成器或执行路径 |
| 五树 | 根node_modules、API node_modules、shared-domain node_modules、API dist、shared-domain dist；由[既有清单工具](../../scripts/ops/runtime-manifest.py)对本次真实目录capture，index记录相对root、manifest路径和文件哈希 | 独立生成并核验，依赖链接不得逃出本次候选；source-only seal不覆盖这些忽略产物，Web/浏览器也不在五树内 |
| fresh-build ownership receipt | 同一sourceSha/candidateRoot、Git工作树真实指针及哈希；见证shared-domain/API/owner-fixture三个固定构建步骤；两份输出原先不存在且准备后manifest对应 | 只能由实际新工作树操作见证，不能补造“原先不存在”；driver仅在核准身份后清理/重建这两份自建输出，不能接管未知旧目录 |
| driver调用材料 | source packet文件、runtime inputs文件及其文件哈希、本次尚不存在的私有artifacts目录 | 本文只映射字段与守卫，不给资源命令、批准字符串或未来SHA占位。具体材料由主控完成集成、真实见证、单独核验后交付 |

生成五树或运行输入不升级为当前任务01准备测试的强制build条件。后续真要运行时，依赖、构建、工具、浏览器等输入才按具体场景另核；不能以“清单格式有字段”推定文件已经生成或有效。

## 独立动态组的输入接线

依据接线候选 `7cb7412311c88989440d52e60f44ef04c6c337dc` 的实际源码，新组 `enterprise_task01_entry` 通过 [dispatcher](../../services/api/prisma/run-database-dynamic-gate-local.cjs) 映射到固定driver/helper及源码哈希，manifest的 `invocation` 为 `task01_explicit_inputs`。须单独显式选择；默认all或与旧组混跑在资源前拒绝，原覆盖77个文件/511项测试的各组内容不变。库存78文件/512测试只表示接线覆盖，新1项仍 `NOT_EXECUTED`，不等于512项PG已通过。

新增五个参数是 `--task01-packet`、`--task01-inputs`、`--task01-inputs-sha256`、`--task01-artifacts`、`--task01-confirm`，对应source packet、runtime inputs及其文件哈希、新私有artifacts与独立确认；另保留原候选/全局确认合同。dispatcher把请求候选注入 `JG_TASK01_EXPECTED_SOURCE_SHA`，driver再比packet SHA，缺项/错候选/错源码先拒绝。没有把参数本身当批准，也未在本文给可执行资源命令或确认值。

7cb候选仍有后续审查修补，本节只核对其真实输入合同，不引用为最终通过证据。b09失败历史不删除；准确新源码和清单由主控最终重封。

## 准备覆盖、复用入口与后验归属

| 范围 | 已有准备产物 / 复用指针 | 独立授权后验 / 后续业务片验 |
| --- | --- | --- |
| Vue3/TypeScript/TDesign与真实Web入口 | [路由](../../apps/web-admin/src/routes/route-records.ts)的 `/资金执行案件` → [真实页面](../../apps/web-admin/src/pages/fund-executions/FundExecutionWorkbenchPage.vue) → [域API](../../apps/web-admin/src/api/fund-execution.api.ts)；[冻结记录组件](../../apps/web-admin/src/pages/fund-executions/components/FundExecutionSubmissionHistory.vue) | 这是现有可复用的真实前端基础，不是新页面占位；本票受限HTTP/PG串接及设备实际效果仍NOT RUN |
| 真实browser入口 | [POL115真实配置](../../apps/web-admin/playwright.pol115-real.config.ts)、[真实资金browser测试](../../apps/web-admin/e2e/pol115-fund-real.e2e.ts)及[既有HTTP测试browser分支](../../services/api/src/fund-execution/fund-execution-entry.http.pg.spec.ts) | 配置有loopback API/会话守卫、桌面1366与手机390、零重试、不复用服务；当前4215端口及旧“一案件/文本/金额”fixture假设需按本票实际上下文接线。driver没有自动Web阶段不等于Web不存在；不把模拟page.route用例或真机未运行算通过 |
| HTTP/PG首条受限入口 | [专属公开测试](../../services/api/src/fund-execution/enterprise-task01-entry.http.pg.spec.ts)、[连接合同](../../services/api/src/database/enterprise-task01-entry.test-support.ts)、driver | 输入/测试源码已有；1项真实案例未执行。需要实际认证、PG约束、同键回读、独立observer及同一受限池/重连证明；它不替代任务16资金完整故障/实付矩阵 |
| owner合成主数据 | [独立owner进程](../../services/api/prisma/enterprise-task01-owner-process.cjs)、[fixture](../../services/api/src/database/enterprise-task01-owner-fixture.test-support.ts) | 只在本票新合成集群初始化；runtime进程不得持有owner连接，不能通过预造案件/回执/实付掩盖公开业务链 |
| 资源身份、TLS与清理 | [资源helper](../../services/api/prisma/enterprise-task01-resources.cjs)、[client probe](../../services/api/prisma/enterprise-task01-client-probe.cjs)、driver；固定本机daemon、PG16 image、runId/CID/实际Mounts、截止与收尾源码 | 实际启动、server证书载入、健康正控/证书单变量/明文拒绝、实际角色连接、成功/失败/中断清理和不存在确认均待授权后验证；未知失败不通过，不接管旧资源 |
| 受限ACL与身份辅助 | [访问清单](../../services/api/prisma/enterprise-task01-access.json)、[授权SQL](../../services/api/prisma/enterprise-task01-access.sql)、[身份SQL](../../services/api/prisma/enterprise-task01-identity.sql) | 初始显式上界而非最小或实测完整ACL；真实PG解析、PUBLIC/继承/函数传递/RLS/角色矩阵及提交前差异必须后验，不只看直接GRANT |
| HTTP响应丢失故障入口 | [代理](../../services/api/prisma/enterprise-task01-response-loss-proxy.cjs)及[协议检查](../../services/api/prisma/enterprise-task01-response-loss-proxy.test.cjs)，已有15项合成协议证据 | 真实业务响应丢失、查询与显式同键重放仍待任务16；仅网络构件不能证明数据库成功/失败/回滚 |
| 迁移与Schema基线 | source packet的Schema/197迁移；[生产登记比较](2026-11-05-enterprise-simplification-production-migrations-readonly.json) | 登记197逐项一致已证；不合并旧根22迁移或来源未证244/245清单。完整Schema漂移、历史数值/关系无损映射和真实副本演练由任务42核齐 |
| 当前部署代码与角色基线 | [独立0893重建](2026-11-05-enterprise-simplification-independent-build-repro.json)、[实际5连接](2026-11-05-enterprise-simplification-runtime-db-session-binding.json)、[配置角色/catalog摘要](2026-11-05-enterprise-simplification-role-catalog-readonly.json) | 2662文件/41,895,003字节对应已采集运行目录；5条真实连接role/ssl已观察。依赖闭包/内存、全部未来连接、CA/SAN与完整有效ACL没有因此通过 |
| 真实数据、附件及原工作区保留 | [集成交接的原根指纹/归属差异与停止线](2026-11-05-enterprise-simplification-integration-start.md)；原根/旧候选保留、457项旧差异默认不纳入当前main，无真实业务写入 | 此处交付保留约束及已取得只读基线，不宣称备份/全量数据文件清点或恢复完成；真实数据/附件不归零、不猜0、不删历史，不从“旧功能未用”推定可删；任务42另行备份/恢复/迁移 |

## TLS诊断与必须保留的区别

[合成传输收据](2026-11-05-enterprise-simplification-tls-transport.json)里正确CA/SAN只完成TLS握手与PG startup，适配器按设计P1010认证拒绝，不能当健康SQL正控。错误CA与错误SAN均P1011且消息哈希相同，文本不能可靠分因。该对照没有新增“可区分原因”的probe实现，也不降低真实实验未知拒绝原因的停止线。

准备产物验收、后续授权运行及最终业务放行应分别登记。任务01不强搬任务16全部资金矩阵、任务42真实副本恢复或任务44全链，但也不能用文档把不存在的源码/入口说成已实现、把实际未跑写成通过。最终候选source packet、runtime index、fresh-build见证和具体执行授权材料由主控在后续准确阶段另封；本交接不创建它们。

## 后续票复用的失效规则

每个依赖票的新SHA必须新source packet及 `--verify`，不继承本交接b09或78阶段收据。源码、依赖、锁、工具、配置或构建变化，运行输入五树和ownership receipt须随实际新任务重新见证、核验及封存，不能只改sourceSha或candidateRoot标签；旧产物即使字节相同也不自动成为本票自建输出。

准备核验不会解除任务16/A16、任务42/A36、任务44/A38真实验收，也不产生迁移或部署授权。真实数据保留在此仅为明确约束、已采集migration/code/role证据及旧候选分类，没有逐行核验或全量文件/恢复证明；后续资料不足如实保留未知，不把它写成数据全核或用删除完成准备。
