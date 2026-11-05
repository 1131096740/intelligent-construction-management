# 业务简化：任务01集成起步（2026-11-05）

## 状态与授权

用户本轮明确确认：“是，执行这套规格并按技能发布、推进关联工单”。父工单 [#382](https://github.com/1131096740/intelligent-construction-management/issues/382) 与45份子工单 #383～#427 已发布；任务01 [#383](https://github.com/1131096740/intelligent-construction-management/issues/383) 已领取、仍进行中，其余保持阻塞。当前交付限任务01的部分基线与受控入口准备，不关闭任务01、不宣称整个规格或可信集成基线完成。

实现、GitHub工单推进按本轮授权执行；迁移、受控TLS/权限/提交故障实验、部署及生产变更仍需具体范围与对应授权。文档起步与生产只读核查阶段未执行上述操作，也未启动或清理容器、数据库、监听或旧任务资源；后续合成网络协议测试仅启动并关闭自有loopback监听及socket，见下文构件记录。

## 精确集成基线

- 主控本轮只读刷新并核实主线为 `2f474055bd018b3e454b458038d91080203ad5dc`；新集成分支 `codex/enterprise-simplification-integration-20261105-r2`，工作树 `/private/tmp/jg-enterprise-integration-20261105-r2`。
- 主控只读核验准确主线CI [40508407988](https://github.com/1131096740/intelligent-construction-management/actions/runs/40508407988) 为 success。它只证明上述继承主线的CI，不是本文档提交的候选CI，也不替代任务01或业务验收。
- 本文档实施分支 `codex/enterprise-task01-doc-bootstrap-20261105` 从该集成分支同一提交创建；独立工作树 `/private/tmp/jg-enterprise-task01-doc-bootstrap-20261105`。后续提交与合并SHA记录在工单/PR，本文中的基线不冒充最终候选或生产运行SHA。
- 原根 `/Users/leoyang/Projects/建工智管` 及旧集成 `/private/tmp/jg-enterprise-integration-20261105` 保留。本次未复用旧548项混合审查快照，未从根覆盖主线业务代码、Schema、模板、迁移、治理清单、CI或依赖文件。

## 文档纳入范围与来源

仅纳入已确认的193条规格、技术方案、差距审计、验收边界、45票据及任务README共50份源文档；另新增本交接和[工单映射](../plans/2026-11-05-enterprise-simplification-issue-map.json)，对主线 `PROGRESS.md` 与 `docs/README.md` 仅追加本轮入口和当前状态。50份原始源文档逐文件SHA-256保存在工单映射的 `source_sha256`，它们是发布时原始内容指纹，不是本提交更新状态后文件的指纹。

状态更新只反映已发生的整套实施授权、工单发布、任务01未完成和新精确主线；原193条需求、逐票验收条件、技术决定及完整阻塞边保持。规格 CUT-05 等原文仍记录“规格文档本身不授权Git写”，本轮用户另行明确授权执行，不因此修改业务规则或放宽迁移/生产边界。

GitHub发布执行器保留 `/private/tmp/jg-enterprise-publication-20261105/source/`、`source-sha256.json`、`verified-remote-issues.json` 和 `receipt.md`；发布回执报告全部正文回读、依赖核对、45项均OPEN，仅任务01标 `ready-for-agent`。仓库映射保留真实Issue号及完整阻塞号，01～45只是稳定的本地计划编号。

## 主线与旧根差异

本轮只读比较结果：

| 对象 | 结果 | 含义 |
| --- | --- | --- |
| 主线/旧根迁移 | 主线197、旧根146；共同124项SHA-256相同，旧根独有22项，主线独有73项 | 旧根不能代表当前主线；不能叠加目录或按数量猜生产待部署差额 |
| 应用承接候选457份 | 相对主线24相同、263不同、170新文件 | 旧差异默认不纳入主线；按范围逐域核实决定承接或排除，选定承接后才按原根HEAD `a6a9b08a94c0ac9747b9741bb5563e8522ce435c` 及实际共同祖先三方重放，保护主线后来实现 |
| 模板承接候选8份 | 相对主线7不同、1新文件 | 已确认版式/字体意图与实际字节来源仍需逐项核对，不修改模板使旧测试变绿 |
| 旧资金实验迁移清单 | 声明 `baselineCount=244`，实际 `migration.sql` 条目245；当前主线197项全部包含且SHA-256相同，清单另有48项；声明来源提交 `84ef7afbe6b22fc8b94e542660213349e47929f7` 尚不可解析 | 声明数与实际条目不一致，来源未证明；本次未装配或运行，不把它作为197主线的替代来源 |

上述457项是候选来源分类，不代表逐文件归属、依赖闭包、正确性或新规格完成。本次没有把既有实现承接计作本轮新实现。

证据附件位于本机任务目录，以下SHA-256绑定本次只读报告；它们不包含生产运行证据，暂存路径不能替代后续工单中的最终可回读收据：

| 文件 | SHA-256 |
| --- | --- |
| `/private/tmp/jg-enterprise-baseline-vs-main-20261105.json` | `b8297011bf90af281ac9546ea39ae06e050771a387c9f9a3a981b40fb7949ba5` |
| `/private/tmp/jg-enterprise-baseline-audit-20261105.md` | `b1c616587639a6d744e3ea7c3d9b9fa67ee7915d80fdeaa5d0f75425b8249796` |
| `/private/tmp/jg-enterprise-acceptance-audit-20261105.md` | `564e17e00572c91bd32b24ea6d1f49732ab06dfb38bda35c241c0de745d019f9` |

## 生产迁移登记只读核对（第二次有界尝试）

首次限定迁移字段的SSH+sudo查询连接关闭，未得到JSON收据，无法证明当次查询执行；失败证据和随后的有界健康复核 active/ok 保留，未修复或重启生产。主控随后第二次有界只读尝试成功；使用固定脚本 `/private/tmp/jg-prod-baseline-readonly-20261105.py`，只在服务器内部读取 `DATABASE_URL`，限定本机数据库目标，显式只读事务及迁移元数据字段，不输出连接URL、配置或凭据。

新收据显示 `transactionReadOnly=on`、PostgreSQL `serverVersionNum=160014`，迁移登记197行全部已完成且无回滚。文档实施代理独立读取准确主线 `2f474055bd018b3e454b458038d91080203ad5dc` 的197份 `migration.sql` Git对象计算SHA-256，与这197行逐项对比：主线独有0、生产独有0、名称/校验不一致0。由此只证明该主线与本次生产迁移登记的差额为0，没有执行迁移或生产写入。

脱敏[逐项比较收据](2026-11-05-enterprise-simplification-production-migrations-readonly.json)仅包含版本、计数、差集和来源哈希；该文件SHA-256为 `4baebd93cb8a8b4abed298fdfee7992adb59d3ea1da0da8d557c8f0b36042ff7`。原始字段白名单收据 `/private/tmp/jg-prod-migrations-readonly-20261105-second.json` 的SHA-256为 `7d1bde7c486b19931f46140045466748a12b3e005d2e584b5ef319b72ea0cb8b`，只含 `transactionReadOnly`、`serverVersionNum` 及每项 `migration_name/checksum/finished_at/rolled_back_at`；本次未提交连接配置、原始环境或凭据。

迁移登记校验一致不证明运行构建来源、完整Schema无漂移、角色/ACL、真实数据质量或资金提交安全；任务01仍进行中，其他票据不因此解除阻塞。

## 后续生产运行元数据与目录投影（只读）

新增[运行元数据收据](2026-11-05-enterprise-simplification-runtime-metadata-readonly.json)的SHA-256为 `efd7e7b09912ee8762a41d3795c977d19eac5ca6c2828f950da78b7d250122bc`：API PID `2502628` 前后稳定，cwd `/srv/jiangkong/apps/api`、exe `/usr/bin/node`；实际dist不是链接，node_modules指向0893保留release。只核对两份API编译文件 `dist/main.js/app.module.js` 和Web `dist/index.html`，它们与0893保留release同相对文件的字节SHA-256相同。没有核完整运行树、实际HTTP bundle或可信source→build→installed→PID链，不把依赖路径或样本相同认作运行源码SHA。

新增[配置连接角色与public目录摘要](2026-11-05-enterprise-simplification-role-catalog-readonly.json)的SHA-256为 `09ceea3a3f94b0b143bc888542ddd8db65a797620c1587c2f3d146235636cd1b`：只读事务，PG160014；当前api.env内部解析连接角色 `jiangkong_runtime` 可登录，superuser/createDatabase/createRole/inherit/replication/bypassRls均false、直接成员关系空。未读进程环境，故不独立证明实际PID池连接使用同配置。

public目录限定投影计数为6656列、2137约束、324函数、1394索引、1697关系、1schema、495非内部触发器；关系包含索引，不能称1697业务表。只输出服务器内聚合MD5，不输出定义/潜在字面值或业务行。摘要含OID/owner等本库标识，不是跨恢复库无条件可比的完整Schema指纹，也未比对候选恢复结构。零行policy组未出现在结果中；其他schema、类型/扩展/default ACL和完整有效权限仍未证明。

两次补核均使用可信 `jgzg-prod`、StrictHostKeyChecking/BatchMode、有界命令和 `python3 -B`，未写生产文件、改权限、运行迁移、重启或调用业务接口。脚本/完整边界记录在 `/private/tmp/jg-enterprise-task01-current-baseline-followup-20261105.md`；本次只提交脱敏投影，不提交连接配置或凭据。

## 尚未通过的基线与验收门

1. 旧应用、模板和迁移候选默认排除；按当前任务范围逐域核实归属与依赖后决定承接或排除，选定承接才做三方重放。保留候选不要求把全部457份都重放为基线门槛；新干净分支也不等于可信集成基线。
2. 主控经可信本机 SSH 别名 `jgzg-prod`、BatchMode 和 StrictHostKeyChecking 取得只读元数据：`/opt/jiangkong` checkout 为 `6bf7820c0d925e5804ad7d03ae8b983a9220b5e3`，API/Nginx active，API PID `2502628` 的 cwd/WorkingDirectory 为 `/srv/jiangkong/apps/api`，回环 health 返回 `status=ok, service=jiangkong-api`。checkout 不独立证明运行二进制SHA。生产迁移登记已由前述第二次只读查询核实；运行二进制SHA、完整Schema、数据/文件分布及角色有效权限仍 `UNVERIFIED`，不能把迁移登记一致扩展为这些事实已证明。
3. 旧模板资产4失败和动作清单漂移只保留原候选历史诊断，不能算新主线失败或已修复；禁止通过放宽断言或重生成ready清单遮盖。
4. 当前只准备源码封包CLI，公开HTTP/真实PG/Web验收入口、一次性资源身份、owner/runtime/observer有效权限、所有连接池绑定、TLS正负控与故障分类、超时及按身份清理尚未闭合。旧固定入口所需隔离依赖副本已清理；不能直接重启旧入口或删除关闭门。
5. 资金延迟提交误报、断连、响应丢失及重试防重等真实链仍未证明；离线mock不替代A16。真实副本恢复/迁移A36及最终固定候选A38仍待对应阶段具体授权和证据。

只读审查确认现有 `fund-execution-entry.http.pg.spec.ts` 只覆盖资金案件创建、分类、提交和冻结快照，并继续下游审批/PDF；它不证明最终 `FundExecution` 实付提交，也不能原样作为本票owner/runtime分离的最小入口。独立新入口仍需owner夹具、受限AppModule/observer、真实HTTP案件回读、Web展示、资源身份与TLS/故障/清理支持；只有这些准备成实际可运行候选后才申请具体资源执行授权。

任务01验收要求形成可运行受控入口与停止条件；完整资金业务提交安全、恢复演练、最终全链验收还分别由任务16、42、44交付。既不能以文档准备替代入口完成，也不能把本票误写为全部业务通过。

## 受控入口准备代码与公开边界

用户已确认源码封包CLI的 `--prepare` / `--verify` 和输出manifest边界；公开用法及证明限度见[受控验收准备说明](../runbooks/enterprise-simplification-acceptance.md)。CLI固定准确、干净、已提交HEAD及全部已跟踪文件/锁/Schema/迁移/自身源码；输出 `source-sealed` / `source-verified`只表示源码封存与核对，不表示依赖安装、运行就绪或HTTP/PG验收。公开校验和不是批准或签名。

CLI实现提交 `792d55370a82a0b76c71e55a7447bcbfbba8cab7`：19项专用公开CLI测试、两个文件Node语法检查及差异检查通过；该准确提交真实 `--prepare/--verify` 成功，封存3013份Git已跟踪文件、197份迁移，sealSha256为 `24f6da5b4f26785e9954238896b28c9b94f785fa4d588c12b10cb27c668ee927`，外部包 `/private/tmp/jg-enterprise-task01-source-792d5537.json`。这些是该工具提交的源码输入收据，后续文档/代理集成SHA不同，必须重新封包，不能沿用此哈希当最终候选。专用测试还验证忽略规则隐藏的额外 `migration.sql` 被实际目录集合核对拒绝；其他忽略产物仍不封存。

一次既有 `pnpm test:ci-orchestration` 在同一CLI提交工作树共274项，264通过、10失败；失败报告缺少 `@prisma/client`、`typescript` 或 `prisma/build/index.js`，该树没有安装node_modules。新19项CLI在此列表通过，但不能把整套CI编排记为全绿。该CLI独立树未安装依赖追绿，日志 `/private/tmp/jg-enterprise-task01-ci-orchestration-792d5537.log` 保留，运行后工作树干净且原源码包再次校验通过。主控随后在独立集成环境按冻结锁安装851包（ignoreScripts），并经正式缓存权限通道生成Prisma5.22客户端，无数据库连接；这只证明安装/生成步骤完成，不证明完整运行依赖闭包、构建或资金业务。准确集成SHA上的既有CI编排复验及最终源码重封包由主控取得新收据，本文不预填其结果。

响应丢失代理实现提交 `9cfb5d44dd8f38a3cee90e7948802dab09668199`，同步CLI后实施分支tip `d486fdd2292704b4f925d2ce734afa7e41a3920e`：`services/api/prisma/enterprise-task01-response-loss-proxy.cjs` 及其 `.test.cjs` 共12项真实loopback合成HTTP测试通过（9项逐片红绿，另3项范围/并发/截断覆盖），两文件Node语法及差异检查通过。完整接收一次精确method/path/合成requestId匹配上游响应后断下游，错误不重新武装、不自动重试，后续由调用者显式发起请求；支持有界字节/截止/连接数和幂等close终止自有监听/socket。收据 `/private/tmp/jg-enterprise-response-loss-proxy-20261105.json` 与 `.tap` 保留。

这31项定向检查（19项CLI、12项网络协议）没有启动AppModule或PostgreSQL，不包含真实资金提交、回执防重或延迟COMMIT/P2034矩阵；实际资金提交安全仍未通过，不从协议、旧mock或案件测试推定。代理与文档集成后源码SHA变化，工具提交的旧packet不作为最终候选，须在最终干净SHA重封包。

## 本次验证与下一步

文档起步阶段仅做文档验证：检查50份来源指纹匹配；规格193条ID唯一、逐条需求内容与原始源一致；45票据验收条件及需求归属未变；README依赖表、Mermaid边和工单映射一致且无环；新增范围内Markdown相对文件链接存在；补入状态不改变主线历史正文。独立校验脚本 `/private/tmp/jg-enterprise-doc-bootstrap-verify.py` 退出0：50份源指纹一致、193条逐项内容与唯一ID及主票归属一致、45票业务正文保持、99条依赖边与工单一致且无环，仅01无前置，相关Markdown文件链接存在。提交前 `git diff --check` 退出0；同名 `.json` 收据保留机器结果。未运行或引用本轮API/Web产品测试、typecheck、lint或真实浏览器/PG结果作为通过。

下一步审查并集成本票准备构件，在最终干净提交上重新封包/校验，再完成独立运行入口、fixture、角色/TLS/故障及清理闭环；按当前任务范围逐域决定旧实现承接或排除。生产只读残余和具体实验执行材料可独立准备。全部任务01验收条件有新鲜证据后才解除02、03、04、08的阻塞。任何必要实验执行前先形成可审阅的具体候选与范围，再通过正式授权通道执行。
