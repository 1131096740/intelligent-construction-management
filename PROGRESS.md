# 建工智管当前状态

## 2026-11-17 隔离签名错误分类

准确 `b5f7ce10` 的真实隔离运行三次登录通过，签名返回 500，Prisma 分类为 unknown，未取得 code 或 SQLSTATE；审批及付款未进入，容器已删除。[私有日志](/private/tmp/jg398-standard-run-37myl1vh/run.log) SHA `3bd798f20fa933ccf4f56afdf6b86f56a8d1216d73f496579f4d27ac4d152cb9`。签名可能已有写入，根因未确定。

测试侧固定错误分类 `a685cfc6` 经独审合入本地 `1c392209`，准确补丁 SHA `ac181b4891d3f408101367b53509f819bf8ecd0695b34c8ff582778ec9cce3a3`；Node20 定向分类 3/3、API typecheck/lint 通过，真实 PG 测试按约跳过。新候选尚未真实运行，不代表 #398 验收；本次未启动资源、重复文书资格或推送。

## 2026-11-17 标准隔离签名诊断

准确 `d41585cd` 真实隔离运行三次登录通过，签名返回 500，可能已有写入；审批和付款未进入，本轮容器已清理。[私有日志](/private/tmp/jg398-standard-run-l_4dc71u/run.log) SHA `92272d4b6fc49f8c5667ef7a3f6d5a852066f5d9a0408b3a2f28f09c0603505b`。不能将签名 500 等同无写入或认定根因。

测试侧签名错误捕获 `3248fa7d` 经独审合入本地 `b3466947`，准确补丁 SHA `1e02b9ed40c3dfab761b04e2971f3ae5bbce3f5a9d9abc8bc4271e10b273c80a`；本地 Nest 过滤测试 2/2、API typecheck/lint 通过，真实 PG 测试按约跳过。新候选尚未真实运行，不代表 #398 验收；本次未启动资源、重跑文书资格或推送。

## 2026-11-17 标准隔离登录权限修订

准确 `642207a8` 的真实隔离运行登录返回 500，签名、审批和付款均未进入；本轮容器已删除。[原日志](/private/tmp/jg398-standard-run-4oz7bj4g/run.log) SHA `404dffdf936fc4de7e1294645b8ba4ed87d4d495c749a5d7728e8f0c12657351`。已确认隔离角色缺少 AuthRateLimit DELETE，但日志不能证明它是登录失败的唯一根因。

隔离权限修订 `e15f4d11` 经独审合入本地 `47329ff6`，准确补丁 SHA `ac5e2ed736a11200eb47414f8587b3d2f18ca916784bf1d37f85634c8e4c2623`；两个 CJS 语法和差异检查、Node20 定向 3/3 通过。新候选尚未执行真实隔离运行，不代表 #398 验收；本次未启动资源、重跑无关资格或推送。

## 2026-11-17 标准隔离 runner 名称修订

准确 `3723a237` 的标准隔离运行在 `LOCAL_MIGRATION_INPUT` 停止，尚未进入迁移或业务；[原私有日志](/private/tmp/jg398-standard-run-57osdjxi/run.log) SHA `ff5f116d219f02c36ac1ea7f6dff2df9b001b38407818a7efcfe2ebe55477858`。独立按本轮唯一容器名称和标签分别查询均为零，未发现该轮容器残留。

runner 名称修复 `5311511c` 经独审合入本地 `e475a76d`，准确补丁 SHA `96d21ffc6d71cce11fa39d0c0c299006e6ac38cd0b0703efd9296494dd0621c8`；Node20 模型 3/3、API typecheck/lint 通过。新候选未执行真实隔离运行，不代表 #398 业务验收；本次未启动容器、未重跑无关文书资格，未推送。

## 2026-11-17 标准隔离付款组合链候选

#398 标准隔离组合链候选 `978f795f` 经独审合入本地 `b124f471`，封存补丁 SHA `54835c6e22742f4608f718c519701046baac4648156566d7d6270a699d30ed52`，逐文件补丁字节一致。相关合成测试 86/86、角色及清理模型 2/2，API typecheck/lint 通过；真实 PostgreSQL 测试按约跳过。

本轮只有模型和权限计划检查，未执行真实 PG 或容器，不能据此认定组合业务或 #398 验收通过；原现金 b047 仍 UNKNOWN。本次未重跑无关文书资格，未推送或操作资源。

## 2026-11-17 A16 提交断连虚构隔离运行

准确候选 `b88b94a6b59ba8e1778d1a19ca0968713de650b6` 的单次虚构 COMMIT_DISCONNECT 运行返回 `NATIVE_DIRECT_CASE_RETURNED_NOT_FULL_ACCEPTANCE` 与 `DISCONNECTED_ROLLBACK_CONFIRMED`，`financialAcceptance=false`。[原回执](/private/tmp/jg-a16-d-b88-6aaOxI/receipt.json) SHA `a6c2942e4b69999eaf40b325e40052a6f83a4251c3b72ed857b760ec97b7fc79`；[核账证据](/private/tmp/jg-a16-d-b88-6aaOxI/accounting-evidence.json) SHA `a38eb9665e4741eeba5123ad00e32f0316c5bfb326f980070e51864332589f60`。

独审确认 lockout NOLOGIN 和唯一原会话、fault XID 与时间，三次 survivor 观察原会话消失且 runtime 零连接、owner/observer 身份稳定；RR 核账前后 A/B 各 100 元、已付为零，付款、资金、审计和项目记录为零，owner 前后相同。逐刻锁和信号、HTTP 次数及原键 SQL 依准确源码成功路径推论，非独立原始抓包；HMAC 不留密钥，不能事后独立重算。

运行器自报 cleanup 完成；[独立检查](/private/tmp/jg-a16-d-b88-receipt-JRlRqe/cleanup-independent.json) SHA `05835fc51f6f08506e5236adde5f33e4b858f361459e354063c85d7de2eea740` 确认 PG/runner 进程、PG 监听及 pidfile 缺席，应用端口未独核。本次仅虚构 null-scope 服务端终止单会话，不覆盖网络分区、PG 进程崩溃或整票验收；b047 仍 UNKNOWN。

## 2026-11-17 A16 断连隔离候选

新虚构 terminate-only 断连候选 `6ae3138d` 经独审合入本地 `c72f7593`，准确补丁 SHA `fc8ba7663a2056684b6a18f11f95b8905ecea7160fb2a145109f4de9174d1664`。付款 fixture 145/145、Node20 断连及旧场景回归 110/110，API build/typecheck/lint 通过。首次联合测试使用链式命令时 Node20 PATH 未传给后续 node，98/110；明确 Node20 后 110/110，非真实资源结果。

NOLOGIN、真实隔离 PostgreSQL、应用关闭及时序尚未验证；5 秒 HTTP 与 12 秒锁等待可能使结果 UNKNOWN。角色变更仅限新隔离集群，失败处理依赖清理。原现金 b047 仍 UNKNOWN，不触碰或重放；本候选不代表 #398 验收完成，未推送或操作生产。

## 2026-11-17 A16 提交取消虚构隔离运行

准确候选 `f6d57640d8991f41ba3c9572f559797ee0215306` 单次虚构运行返回 `NATIVE_DIRECT_CASE_RETURNED_NOT_FULL_ACCEPTANCE` 与 `CANCELLED_ROLLBACK_CONFIRMED`，`financialAcceptance=false`。[原回执](/private/tmp/jg-a16-can-f6-XIqGOM/receipt.json) SHA `c213d57567a883da39d2594f99df09bdd9aa4cfaf0948b780300049542d2ced2`；[核账证据](/private/tmp/jg-a16-can-f6-XIqGOM/accounting-evidence.json) SHA `ec9f1efb32dcdb0a5ae152de9d180630c500e8932232e30d1289f1711a86a4b6`。独审确认前后两个账户各 100 元、申请及结算已付为零，execution/root/funding/allocation/event/audit/fact/impact 均为零，owner 前后相同。

fault 记录 cancel-commit/commit-cancelled、XID、owner/runtime/commit 时间及数据库身份；唯一 blocker、逐刻锁状态、实际信号、单次 POST 和原键查询依封存源码成功路径推论，非独立原始轨迹。HMAC 无密钥，不能事后重算。原 cleanup 自报完成；[独立检查](/private/tmp/jg-a16-can-f6-receipt-AFJ3ZI/cleanup-independent.json) SHA `957316a8355589362e695f3acaddaeeb7e7f0fac8f77eb87b7a35249caf44870` 记录当时 PG/runner 进程、PG 监听及 pidfile 缺席，应用端口未独核。本次仅虚构跨公司 null scope 取消，断连及整票仍未验收；b047 仍 UNKNOWN。

## 2026-11-17 A16 提交取消隔离候选

新虚构付款提交取消候选 `7a36711a` 经独审合入本地 `79c814af`，准确补丁 SHA `25d6605dca1b32ec2cbd4afe60472f5d7f1924852e822fb83a4eb8e24e910e43`。付款 fixture 140/140、取消及原协议/响应丢失回归 26/26，API build/typecheck/lint 通过；这些是本地模型和组件检查。

真实隔离 PostgreSQL 锁、权限和时序尚未验证；5 秒 HTTP 时限与 12 秒锁等待可能使场景安全关闭，不能据模型认定业务通过或 #398 验收完成。原现金 b047 仍 UNKNOWN，不触碰或重放；未推送或操作生产。

## 2026-11-17 A16 响应丢失虚构隔离运行

准确候选 `513b4088d57ae4fd5adafdf6e94d05539eb79297` 与计划 SHA `5e5df5cf2feef612be3c2ab50428df7989f3b1128ce9dcf63e3d31fd1a8114d5` 的单次虚构运行返回 `NATIVE_DIRECT_CASE_RETURNED_NOT_FULL_ACCEPTANCE`，`financialAcceptance=false`。[原回执](/private/tmp/jg-a16-513-BCmQlq/receipt.json) SHA `45cb1bba61483428358b62ffdf737348590f9ec1a011d5ad762b9012f7deeeaa`；[核账证据](/private/tmp/jg-a16-513-BCmQlq/accounting-evidence.json) SHA `219f71721e0f201f3195d928969325b12ad35162a7d85fec0e0ff8292e44ab43`。独审确认首次到重放的计数与余额一致；代理丢弃完整上游 201 响应及先核后重放的顺序依封存源码成功路径推论，并非独立 HTTP 事件记录。HMAC 密钥未保存，不能事后独立重算。

运行器自报 cleanup 完成；[独立检查](/private/tmp/jg-a16-513-receipt-t1rlFh/cleanup-independent.json) SHA `fc3142ce97eb7c239b4e9bb4a384806dd3f15795657dda0de0296f32700d01a2` 确认 runner/PG 进程、PG 监听及 pidfile 缺席，未独立检查代理端口。本次只覆盖虚构 null-project 跨公司 40 元；提交中断、断连和真实审批仍未验，#398 尚未验收，原现金 b047 仍 UNKNOWN。

## 2026-11-17 A16 身份与正文保护

A16 新虚构场景身份及正文保护候选 `c364bfcc` 经独审合入本地 `00eb6e9d`，准确补丁 SHA `02bbda2566c4998c35f817f6827cf1aa2ffaa2f33802e31f796fbcc33b59c8fd`。Node20 相关 87/87（含真实本地 HTTP 装配）、现金及旧代理 21/21、API build/typecheck/lint 通过。真实隔离业务尚未运行，不代表 #398 验收通过。

两个证据文件依次 fsync，整体不是原子操作：后一个文件失败可能留下前一个文件，但付款 POST 不会发送。正文 HMAC 密钥不落盘，因此不能事后独立重算或恢复请求；原现金 b047 仍为 UNKNOWN，不可重放或换键重发。未推送或操作生产。

## 2026-11-17 付款响应丢失隔离候选

新虚构 A16 响应丢失候选 `6088b512` 已独审并合入本地 `bcbd2ac5`，准确补丁 SHA `0afb1960d594bfc600b7ea3efde4ada83061a91d4ee462d63f853d3241eb15f1`。付款 fixture 模型 138/138、构建后代理与 runner 3/3，API build/typecheck/lint 通过；runner 首次在 dist 尚未构建时失败，构建后通过。此候选尚未真实隔离闭环，不代表 #398 完成。

原现金 b047 仍为 UNKNOWN，不可重放或换键重发；此新场景不改变其结果。合同文书支线另存于独立工作树，未纳入本次集成；未推送、未操作生产。

## 2026-11-17 撤权状态证据准备

本地集成 `9befdf6a` 增加凭证撤权逐次 HTTP 阶段及状态的脱敏记录，仅适用于未来新运行的回执；模型回归、API build/typecheck/lint 通过，未启动新的隔离资源。旧 `d4befe41` 回执不含逐次状态，不能补写或倒推；原现金 `b047` 付款结果仍为 UNKNOWN。此前通过的撤权业务片与该后继本地代码的实际运行证据分别记录。

## 2026-11-17 凭证撤权隔离结果

准确作者候选 `d4befe41`（与本地集成 `ef4752ff` 同 tree）新独占 native once 自然成功：合成公司付款与凭证前置通过，撤权前两个项目可见、凭证可签票及下载；移除目标项目唯一成员关系后，能力、新票和未过期旧票访问均被拒，另一个项目仍在项目列表可见，所观察资金及文件事实未变。独立只读源码复核确认这些布尔与成功路径断言对应；另一项目的凭证下载未验证，回执未保存逐次 HTTP 状态及可供独立重算的快照。该前置通过真实服务创建虚构付款，不发送付款登记 HTTP POST；`financialAcceptance=false`，不等 #398 整票或生产验收。

ACL/B7 三阶段、受限连接及清理在本轮通过；独核 PG 进程、监听及 pidfile 缺席。[原回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-revoke-d4be/receipt.json) SHA `227f9e273e5a9eb68c8784e67e28274d8d473e35f63ee0c2222aeaa4de714a16`。旧 `acdf2ffa` 的项目列表失败保留，不能倒填其 HTTP 状态。原现金 b047 仍 UNKNOWN，不因本独立场景成功改变。

## 2026-11-17 接续进展

#382 前沿仍为 #394 和 #398；本地集成 `ae764c82`，未推送，PR #428 已发布头仍为 `2907d95d`、Draft。原现金 b047 付款结果仍为 UNKNOWN，未换键重发。[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-b047/receipt.json)。

现金证据保全候选 `4713bd65` 已独审合入：仅未来独占 cash 用途在付款前持久化同轮身份及随机请求键摘要，文件写入、同步或中止失败时不调用付款；不提供键恢复或自动重发。Node 目标测试 61/61 通过；未进行真实 PG、付款或断电验证，sidecar 自身不能认证来源，更不能恢复 b047 原键。

合同模板按用户要求仅在封面及模板末页保留甲乙公司、银行信息；机械与材料已有局部修改，长编辑跨页、劳务/通用、真实 PDF 和签章仍未完成。版式映射保护修订 `8d071162` 已独审合入 `9159112e`：保留角色行的非主体映射与角色标签，机械开票区已有映射时保留内容并在生成前提示联系合同管理员，不自动切版；API 85 项、Web 75 项和两包类型/lint、check:ui 通过。这是冲突保护，不等完整无损迁移。

凭证撤权专用入口 `acdf2ffa` 已独审合入 `ae764c82`，限定新独占用途、无付款登记 HTTP POST；其合成 fixture 会直接通过服务创建虚构付款事实，签票、下载和撤权也会写隔离资源。专用 observer 权限进入同轮 ACL/B7，票据超期不能误判撤权，首因使用固定脱敏码。独立合成树模型 222/222、API build/typecheck/lint 通过；真实隔离运行结果见下，不构成撤权验收。

准确 `acdf2ffa` 的新独占 native 运行通过 ACL/B7、虚构付款和凭证前置（`FIXTURE_RETURNED`），经理登录后在撤权前项目列表检查 `PROJECTS_BEFORE/HTTP_STATUS` 停止；撤权尚未执行，真实撤权链未通过。cleanup 完成，独核进程、监听及 pidfile 缺席；[原回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-revoke-acdf/receipt.json) SHA `3f7abdc04d23164205312733e3993fd2476cc036846de2b862fc46b89635b8f5`，当前定位 GET 状态。

## 2026-11-16 后续接续

已发布 PR #428 指向 `2907d95d` 且仍为 Draft；本地代码集成为 `3c327120`，尚未推送。#394、#398 仍开放，本轮未新增整票关闭。下面旧检查点中“正在运行”以本条终态为准。

任务12的 `7c4b0c7b` 原合同 once 已停止，业务进入提交审批阶段，心跳请求 HTTP 500，原日志显示事务提交超过 5000ms 限额；cleanup 报告完成。完整合同链仍未通过，正在准备限定的耗时诊断，不延长原预算。

任务16的 `20d43d34` 新独占凭证诊断 prepare、verify 和材料核对通过，原 once 在授权票据阶段失败，cleanup 完成；独立检查确认该次 PostgreSQL 进程、监听与 pidfile 缺席。实际受限查询已观察到 ContractArchiveEvidenceFile 的九列，正核对本轮 ACL 差量；票据、下载和核账尚未通过。原回执 SHA `d946dbc2a137c373f696ca0c7c6533404b61790d5712228963d3230f664404d4`，详见[本轮隔离回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-voucher-20d/receipt.json)。

本轮使用虚构隔离资源；未进行生产、真实数据或真实云写入。旧运行和失败回执保留，不以诊断结果代替业务验收。

两项本地候选已独审并在独立工作树合成为 `d41a5e9b`，尚未推送：`9d87fcb9` 按实际查询为凭证专用角色补充六个读取列，119 项相关检查与 API 类型、lint 通过，新资源结果见下；`7c5f8309` 修正心跳等待行锁跨越租约到期后仍可续期的问题，模拟回归先红后绿、12 项定向及 API 类型、lint 通过。准确 `7c5f8309` 在独占 PG16.15 空库、真实 Prisma 服务和 owner 身份下观察到行锁等待，过期后返回 `EDIT_LEASE_LOST` 且租约字段未变；进程正常退出，监听和 pidfile 缺席。详见[并发回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/394-lease-pg/receipt.json)。这是 schema-only 窄验证，不证明完整迁移、受限角色、合成 SHA 或整票验收；该缺陷尚未证明是原合同超时的原因。

后续准确 `9d87fcb9` 新独占凭证运行的 prepare、verify、材料核对通过，原 once 已进入 `VOUCHER_HTTP_DOWNLOAD`，在 `WageApprovedSourceVersion` 读取权限拒绝后停止；此前归档关联表查询已通过票据签发阶段。cleanup 完成，独核进程、监听及 pidfile 缺席。下载与核账未通过，正在追查实际查询；[原回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-voucher-9d87/receipt.json) SHA `fa6b6234fdd6ac54685d68827e75a459628610b6da522737b13e1fe8a65ef725`。

准确 `5fe5a890` 新独占凭证原 once 自然成功：30元付款后，两次上传和关联收敛为一份文件和凭证，授权票据与 HTTP 下载成功，上传、关联、票据、下载审计各一条，凭证操作前后财务状态不变。独立 Repeatable Read 核账为 A 100 元不变、B 100→70 元，付款及结算已付 3000 分，execution/root/funding/allocation/event/audit 各一笔，项目事实及影响均为零；原 cleanup 完成，独核进程、监听及 pidfile 缺席。[业务回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-voucher-5fe5/receipt.json) SHA `a1870bf1006fb5ad6b750c6c71dc3d1868366c216919e830eaf45a7403d81053`，核账 SHA `ad88f1040dcc1d75c69c563d7014d8e75a479031ef3b9c1b6e614b3f760c8348`。这是准确候选的虚构隔离业务片，`financialAcceptance=false`；真实审批、Web、公共现金及 #398 全部矩阵仍待，不能外推至合成 SHA。`5fc7e976` 诊断确认工资依据查询两列后，`5fe5a890` 只为凭证运行角色补 `id` 读取，相关 119 项及包检查通过；中间失败回执保留。

合同心跳 `aec4406b` 复用已锁定的合同和版本行，省去两次重复读取，保留锁顺序及业务检查；定向测试 14 项、API 类型和 lint 通过。准确候选在独占 PG16.15 空库 owner 身份下实际验证正常租约取得、心跳以及锁等待跨到期后的拒绝和数据不变；清理通过，[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/394-heartbeat-perf/receipt.json)。不证明完整迁移或受限角色，不认定原超时已解决；真实合同全链待重新验证。

付款页面 `31b76c6e` 防止旧凭证许可请求晚失败时覆盖新请求成功结果；作者以 Chromium 和本地虚构 HTTP 完成失败先红后绿，Web 类型、lint、check:ui 通过，合成前独立源码审查通过。真实撤权后的 403 和写入拒绝、公共现金隔离业务链仍待，不以此关闭 #398。

公共现金期初准备 `a947117b` 仅增加虚构场景的原 HTTP 期初种子，尚未接入 native 入口或付款。`9566d52f` 补响应丢失和后置检查失败时只提交一次、结果未知的反例，fixture 130 项及 API 类型、lint 通过；独审后合入。现金付款、经营账和独立核账均未实证。

合同文书资格准确 `2da76841` 的新 build、prepare、verify 和 once 均自然成功，机器回执状态为待物理审阅。独立审阅员已逐页检查 60 张本轮 PNG，15/15/30 页，Office 末页及合并末页仅页眉页脚；Office 另有标点独行和字距拉伸，不代表最终业务排版通过。[物理审阅回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/394-qualification-2da-v2/PHYSICAL-REVIEW-2DA.json)。样张含类似公司和银行信息，来源正在只读核实；registry、合同 native 计划和业务运行尚未执行。

只读溯源确认上述样张的相关公司、联系方式和银行字段沿用仓库原模板，不能证明为虚构；该资格不用于注册或后续业务实跑。正在独立修订资格样张为明确虚构数据，完成后须基于新候选重新生成资格并审阅，原回执保留。

用户新增合同模板要求：甲乙双方公司及银行信息从正文删除，仅在封面及最后一页保留。材料、机械、劳务模板已发现正文重复位置，通用模板及输出分页仍待核实；正文业务称谓保留。正式编辑计划、版式校验及历史冻结文书受影响，当前正在独立实现和验证，尚未完成。

机械模板局部候选 `048eface` 已合入 `9e9d7816`：新任务按版本化规则移除正文重复名称及开票资料，保留角色称谓；旧冻结快照沿用旧行为。旧草稿冲突须用户复制内容并显式恢复，生成前拒绝未处理冲突。作者侧后端模型 130 项、前端算法及类型/lint/check:ui 通过；真实 Chromium 在虚构 HTTP 下验证恢复、保存和刷新，[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/394-party-browser/receipt.json)。这不是实际后端持久化或 PDF/签章验收；材料、劳务及通用模板仍待。模板后追加附件可能使签章页不在整个文件最后，验收时须单独说明。

材料模板局部候选 `247aaf83` 已经独审并合入 `4d9c492c`，固定来源下的新任务移除正文重复名称并保留角色称谓，旧快照保留旧行为；准确补丁和独立合成树相关测试均为 85/85，API 类型、lint 通过。机械及材料资格样张另在生成边界去除隐藏文档变量并替换文档属性；已审四个样张的包结构，不证明所有可见文字虚构，也未验 PDF 或实际签章。劳务仍在处理模板签章位置，通用模板分页仍待验证。

劳务第一版局部候选未合入：准确代码合成 PDF 检查发现模板实际包含主合同签署表及两个附件各自的签署区，原方案仅移动其中一个附件的乙方签署，不能代表完整签章；已封存并重新设计。后续须保留主合同和附件各自签署语义，仅调整主体和银行信息位置，实际分页仍待验收。

劳务 v2 在独立树 `/private/tmp/jg-394-labor-placement-v2-1117` 保留未提交：六个已知主体/银行值投影至末页表格，预览使用原字段 ID，保留三个原签署区域；浏览器虚构 HTTP 下编辑、保存与刷新通过。合成 Office 超长资料反例会跨页，尚不能保证只在末页。现有后端依赖与锁定转换器未发现受支持的逐页文本/绘制校验能力；本地诊断工具不能直接用于生产。该 WIP 不合入、不称验收通过，继续研究现有能力并核查其他模板。

通用模板源封面和签署区存在硬编码主体，未擅自改变生产主体语义。去标识合成副本在锁定字体 Office 探针中，正常内容姓名位于首末页；签署表内超长编辑时姓名位于第 1、3 页而文件共 15 页，不满足仅首末页。该反例不代表 Java 或真实模板验证；通用模板仍未完成。

机械与材料的锁定字体 Office 合成探针也发现末页附近超长编辑时双方名称停留在非末页；因此已合入的机械、材料局部切片不代表满足全部分页要求。合成结果不外推为 Java 或真实模板证据，仍需可靠分页约束及实际复验。

通用固定源的 Java 合成导入发现字体表缺少 OPC 类型声明；候选 `50dc2846` 仅对新任务且准确源摘要匹配时补声明，旧冻结任务保持原路径，已独审并合入 `593539fb`。合成树 120 项相关测试通过，作者候选 API 类型/lint 通过；Java 合成导入红绿不代表正式业务链或 PDF 排版验收，也不解决上述末页反例。

末页分页研究中，私有合成文档的可见链接可在 Java/Office 记录两端页码，但不可见标记无法同时可靠保留身份，且现有 DOCX 与转换输入同字节，临时链接会改变交付文档交互。研究探针不得作为生产门禁；[研究回执](/private/tmp/jg-394-pdf-bookmark-probe-1117/research-receipt.json)。

公共现金专用文件、来源重放、随机密钥及付款观察在制工作位于独立工作树，模拟检查不能代替真实 PG；专用 native purpose、ACL 及完整生命周期尚未闭合，未合入。不得复用原付款用途或将现有模型视为现金业务通过。

现金专用入口 v3 代码候选 `584e1542` 经独审后合入 `8fde2600`，固定独立用途和 ACL/B7，串联合成文件、同轮随机密钥、来源重放、付款、重放及独立观察；源码层修复秘密清理次因和超时回执。独立合成树 API 模型 154/154、Node 联合 194/194 与 build 通过，作者候选 typecheck/lint 通过；尚无真实隔离 PG、物理权限、业务核账或资源清理证据。上段为此前检查点，不代表 v3 尚未接线。

后继 `b746414f` 修正现金 impact writer 为后续迁移的实际函数体及返回签名，不扩大权限；独审与 138 项模型通过。新独占 native 运行已通过 ACL 物理读回及 B7 before/staged/committed，进入 `CASH_SEED_AND_SETTLEMENT_REPLAY` 后被数据库的“经营账生效日必须在项目创建后通过项目设置启用”约束拒绝，尚未付款或核账；secret 清理报告 CLEARED，资源 cleanup 完成，独核进程、监听及 pidfile 缺席。[原回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-b746/receipt.json) SHA `fb68c0c7c7af1cc6b1bc73729130b59264b80a83af9ca769cf4f25906ba84235`。正在修正虚构种子建账顺序，保留数据库约束。

后继 `f1c45d85` 修正项目启用顺序，新独占 native 已通过 ACL/B7 并越过原项目启用失败；随后 `CASH_SEED_AND_SETTLEMENT_REPLAY` 在 `ContractVersion_signing_subject_check` 停止，尚未付款或核账。secret CLEARED，cleanup 完成，独核进程、监听及 pidfile 缺席。[原回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-f1c4/receipt.json) SHA `5d6d0134736a6d82802d7985bfc5e6bd29cae195eeae7126a97dddc918793720`；正在按实际数据库约束修正种子。

后继 `01b9b28b` 修正我方签约版本及种子回读，新独占运行通过 ACL/B7 并越过前述约束，在 `CASH_SEED_AND_SETTLEMENT_REPLAY` 遇 `ContractPartySnapshot` 权限拒绝；付款和核账未到达。secret CLEARED、cleanup 完成，独核进程、监听及 pidfile 缺席。[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-01b9/receipt.json) SHA `c4b20ce6f2ee3b1afc7291c343769167d14810a61c7559cd08d3a7e604bd418d`；实际查询列仍待定位，不猜测扩权。

后续独立运行逐步观察并核对实际查询，隔离现金角色增加主体快照、关闭汇总及行锁所需权限，均不构成生产授权；期间各轮停在准备阶段，secret CLEARED、cleanup 完成并独核进程/监听/pidfile 缺席。最新 `5f81cc38` 实际捕获 `ProjectCloseImpact` 的五列读取并在该表权限拒绝；[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-5f81/receipt.json) SHA `802a704571858f4786641ff82b4273ee502e5896a7e3fa87fd3b60e472732ce1`。现金隔离专用五列读取修订 `eb4e2b0c` 已独审并合入 `12331c4b`，141 项模型通过；真实新权限、付款和核账仍待验证，权限无项目行过滤。

准确 `eb4e2b0c` 新独占运行已越过 `ProjectCloseImpact` 读取，随后同阶段在 `ProjectCloseStageVersion` 权限处停止；secret CLEARED、cleanup 完成，独核进程、监听及 pidfile 缺席。[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-eb4e/receipt.json) SHA `94d86fc50321a90ec7e75ca3a599e9fcfc26b64e43221e02a67db21ddd0f04d2`。尚未到付款，实际查询形状待诊断。

后续 `8033c8d5` 观测阶段版本查询 18 列；共享 invalidator 已按实际消费缩为九列，现金角色含条件列共十列，不增加写权，模型检查 54/54 和 142/142，合入 `3c327120`。准确作者候选 `b047623f` 新独占运行越过种子及来源重放，进入 `CASH_PAYMENT_AND_OBSERVER` 后以 `PG_CASH_REGISTRATION` 停止，PG 报 `PaymentExecutionPayerAttestation` 权限拒绝；付款结果按未知处理，不重发旧计划。secret CLEARED、cleanup 完成，独核进程/监听/pidfile 缺席。[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-b047/receipt.json) SHA `8de9b1537809a1944b2acce1349f74c43372c42feba7464e3ec0e90daa999fee`；同键或核账能否确认未写正在核查。

`b047` 原随机付款键未存于回执，实例已停止。副本恢复与只读核账草案经两轮独审，仍缺独立绑定原运行的 cluster system ID、完整账务与副作用覆盖及可验证的冷停副本流程；同轮连接可证数据库 OID，但不能单独证明实例身份。[草案](/private/tmp/jg-b047-readonly-review/RECOVERY-PLAN.md)未执行，不能据此声称未写或换键重发，原轮结果继续 UNKNOWN。

诊断 `904a6a51` 在新资源实际捕获该表查询六列，现金角色缺 `id`；`78c5f0bc` 只补该只读列并经独审。新独占运行越过该表，随后同阶段因 `ProjectCloseAggregate` 权限拒绝停止，付款和核账仍未到达。secret CLEARED、cleanup 完成，独核进程、监听及 pidfile 缺席。[回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-78c5/receipt.json) SHA `a7f4b7b255caf69c325398e52cfd3a4877404c1e2c80e37017ec076047a57865`；新表实际查询列待诊断。

准确 `8fde2600` 新独占 cash 原生运行 prepare、verify 和材料核对通过；原 once 在 `ACL_APPLY` 停止，PG 日志首因 `WRITER_FUNCTION_PROOF_14`，业务未进入，secret 未开始。原 cleanup 完成，独核进程、监听及 pidfile 缺席。[原回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e4a4-81d8-7f90-89b8-d4cd08560326/task16-cash-8fde/receipt.json) SHA `9870b623492d1005cc371a5fb78ac191b78d59fbb46ab824013a0056b19f0ac5`；正在诊断函数定义证明差异，不以模型替代物理通过。

本地合成 `21dec58d` 补足机械资格样张五项虚构输入，目标测试 19/19；新文书转换和逐页审阅仍待。`4e5ed568` 单独修正既有 voucher 权限测试的陈旧期望，仅纳入此前实际观测并已合入的七列读取差量，其余非 INSERT 权限继续严格比较，目标测试 14/14；没有新增生产权限。

## 2026-11-16 接续进展

#382本轮未新增整票关闭，可执行前沿仍为#394/任务12与#398/任务16。11月15日完整盘点14关闭/31开放；11月16日已只读确认父票与两前沿仍OPEN、PR428 Draft。持续授权仅推进独占隔离开发与虚构资源；未main合并、部署、生产、真实数据、真实云写或新增费用。旧网络故障/SDK-close/idle停止边界保持。

任务16准确e08f7de8的真实双身份30+10元实付、重放/GET、共享付款待办至清空及独立RepeatableRead核账已过；准确6db0310e的账户8元/项目来源5元/差额3元拒绝和完整前后无写核账已过。两片原cleanup完成且Root独核进程/监听/pidfile缺席。批准仍来自fixture、financialAcceptance=false，不能关闭完整#398或冒真实审批/首页/Web通过。

凭证链连续收敛：原两列Roster权限失败，经真实受限SDK事件确认SQL实际引用id/projectId/userId，只补voucher runtime已观测id；另修客户端票据期限比较时刻的确定误拒，保原5分钟与HTTP5秒。合成941a0de9在新资源原once自然exit1/17.976秒，Roster拒绝消失，下一拒绝是ContractArchiveEvidenceFile；ticket/下载/最终核账仍未通过，原失败封存，cleanup与Root独核缺席完成。该关系用于既有归档generation/旧票据保护，findFirst读取完整model，下游确消费8字段，故未跳过/改顺序或猜授6个预计缺列。20d43d34仅扩固定关系的脱敏列名诊断，38窄CJS及generate/typecheck/lint、双审通过，未改service/Schema/权限，尚无该关系实际known SQL事件。

任务12原cd3366心跳HTTP500确认5000ms事务在14156ms过期；后继a7a98虽缩减完整guard扫描模型10→5，真实once仍通用HTTP失败且无具体观察，不能倒填旧首因。6d37dc27已补无HTTP观察/并发上下文/应用HTTP装配阶段诊断，并修“诊断自身抛错跳过清理”的P2；98相关、已有native witness21、typecheck/lint及修订双审通过，不改原错误、保护、预算或业务请求。

Root准确941a0de9正式build自然0/22.252秒，随后两项真实material loader串行2/2。复用该构建的新文书资格prepare8.369/verify9.393秒0，原once自然0/121.540秒；Root实际逐页审本轮60PNG，15/15/30页、三个report无failure，477文件镜像逐项字节一致。签框Java15、Office14、合并15/29，Office15及合并30仅页眉页脚尾页保留；Office仅transport，不冒15类型/岗位矩阵或最终全业务排版。机器SHA5e94a0b32020d96fff2c9c808378234abc8c901fbb218a1e210b3d734b95f3d5；物理SHAce826b3da7624cdec521c35c60e528bab3512c6e6399f6b7b2933b7b0971b2ff。

Registry-only本地子7c4b0c7b除registry外3970条mode/blob同941；新helper9.736秒0、新native prepare14.448/verify17.062秒0，Root3971source/4220FD/93PG材料核对。run283a59b2、planf1740ca5的原合同once正在独占运行，暂无终态，其他重编译已结束。完整提交→审批→盖章→签署归档/下载与矩阵仍未通过。

当前本地代码合成839db9723e2962aae3caaf6df1929be1fb574b3b，tree371fa045526a55a92e1885678040364fd8615548，与20d43完整tree相同；各片窄门、真实资源和本合成SHA分开记录。最新已发布15c43c195c7ab00ff7f1d15e2a7a750a1ff7c323的CI43867960753自然成功32/32且Root逐job head匹配，不能外推后继SHA。此文档提交的新发布/CI以GitHub和主回执为准。公共现金与页面等仍待；合同容量/更正退款按#399/#400后续依赖边承接，不越界开工。193规格/45任务全量复审与交付仍待。

准确source/plan/核账/清理及未通过项见[持续主回执](/Users/leoyang/.codex/visualizations/2026/11/16/01a1e38a-2308-7fb0-b98a-c672003f7522/382-continuation/CURRENT.md)。根混合变更、旧候选和已消费计划保留；下方为11月15日历史快照，不据旧SHA推断后继通过。

更新：2026-11-15 23:50（北京时间）。#382共193条规格、45项依赖任务；23:29:48完整读取GitHub仍14关闭、31开放，前沿#394/任务12、#398/任务16。本轮无新增整票关闭，完整关单时间仍未知。

## 当前最高优先：真实业务纵切与集成

最新已实际候选f25b515fe8dd69506a634117e89eb9fc97f68410/tree9cbda8d675fbd2a5f08dae8e1acf0604c55a7797。23:22:12新V2包启动，23:22:33原wait exit0/20.573960秒。真实Nest/六guards、登录与公开期初、B代A40元付款、同键重放及GET已返回；原observer实际repeatable-read三快照产物1355bytes/SHA220e9d0e0bca52e9cd58ad11ac9bc9fd45de1e7b34cd6548bb47c5fd6d090f55已由root及独立Standards用Decimal重算：A100不变、B100→60元，paid/settlement/debt各4000分，execution/root/funding/allocation/event/audit各1，项目fact/impact0，after/replay除phase全相同。独立Spec沿真实HTTP/observer SQL/快照投影来源链复核0；不是只信origin字符串。

仅支持这一normal case，批准状态来自原fixture，未覆盖实际审批。financialAcceptance=false，不关闭#398/#394或全部45项。producer cleanup完成；root23:23:06独核准确PG30062/Node29974/supervisor29970、62134监听及pidfile缺席，无额外清理；secret擦除未独核。

V2同run公开证书/CA/config FD及ownedPG绑定、原三个SDKpositive、原生IP0/localhost明确错名-67602、仅hostname变化的实际SDK负例及精确Darwin泛句全部满足，另记CONTROLLED_NAME_REJECTION_WITH_NATIVE_POLICY。原strict SDK SAN分类UNKNOWN保留，sdkDirectCause=false，不倒填SDK内部原因或旧relay reset因果。错误CA/明文负例仍按原门。旧V1与旧once保持封存。精确源码已证macOS错误细节有损，本组合不是任意P1011通过。

独立merger已完成新integration worktree的17路径no-ff合入；源W及root/I旧改动不动、未push。当前恢复第一条完整合同纵切的只读准备，待新integration准确SHA后从其新建实现树。

[本次原wait](/Users/leoyang/.codex/visualizations/2026/11/14/01a1d87f-8978-77a1-b05a-6ad815fa6829/method-review-20261115-151349/actual-native-f25b-v2-controlled-name-1115/ORIGINAL-WAIT.json)；[root独立核账](/Users/leoyang/.codex/visualizations/2026/11/14/01a1d87f-8978-77a1-b05a-6ad815fa6829/method-review-20261115-151349/actual-native-f25b-v2-controlled-name-1115/ROOT-INDEPENDENT-ACCOUNTING-RECOMPUTATION.json)；[独立Spec终态](/Users/leoyang/.codex/visualizations/2026/11/14/01a1d87f-8978-77a1-b05a-6ad815fa6829/method-review-20261115-151349/actual-native-f25b-v2-controlled-name-1115/INDEPENDENT-TERMINAL-SPEC-REVIEW.md)；[独立Standards核账](/Users/leoyang/.codex/visualizations/2026/11/14/01a1d87f-8978-77a1-b05a-6ad815fa6829/method-review-20261115-151349/actual-native-f25b-v2-controlled-name-1115/INDEPENDENT-ACCOUNTING-TERMINAL-STANDARDS.md)。

## 业务验收仍待

任务12/#394：旧Auth370曾独立观察HTTP201；完整合同提交→并联批准→盖章→签署归档→授权下载仍未通过。机械合同aa9b9330本地候选及签约身份独立读回/getter安全WIP保留暂停，待直连正常路径实证后恢复。15类型/岗位/竞态/直签/Web/PDF矩阵未完成；完整通知由#419承接，不能以audit代待办。

任务16/#398：第一条真实normal付款、同键重放/GET和独立核账已于23:22通过；批准状态为fixture，不能称真实审批已验。竞争、分次、撤销、断连/丢响应、凭证、公共现金、Web等剩余矩阵仍待。旧F CASE返回但后置资格失败，仍缺旧原金额snapshot，不由本次新结果覆盖。

路径有实证后先完成上述一条完整合同与一条付款独立核账，再按依赖图补齐其余45任务/193规格，不缩验收范围。

## 比较边界与工程状态

本地代码no-ff集成点f341bd239df552654e3c7d67f9a42a520bded575，parents为F与F25B，tree9cbda8d675fbd2a5f08dae8e1acf0604c55a7797、3958条完整mode/blob与作者完全一致。集成树CJS527/527、fixture Jest121/121及API build/typecheck/lint均通过。首次CJS先于构建、首次pnpm参数错误均保留，纠正执行方式后通过，未改业务源。新SHA的CI和native实际资格待，不借作者/旧F证据。

使用同16.15私有PG/libxml、真实Nest/六guards、原业务source/build/Schema/角色SQL、fixture、生产reader与Serializable事务/幂等/审计。macOS/C locale/noICU/OpenSSL3.6.3、无Docker CPU/memory/pids/tmpfs同等限制、未用旧F对象reader每操作lease明确分列。原runtime/public两pureSQL同事务顺序恢复，不称完整旧writeScript事务catalog/xid/xmin/link proof等价。旧relay reset来源UNKNOWN；旧B/SDK-close/idle及变体、原样长链和网络故障实验仍停。

已推集成head ff0d5ea23291cb6024cfac57c33e7a858e9b4e62/tree270c88c43eba15a77f5bb68fa324689567408d18；22:52 PR428回读仍该head/Draft。CI43672571544自然attempt1成功32/32，18:33最后独核，仅证明F，不能借作新native证据。新native已本地集成，尚未push/新CI；本账本提交仅改MD，准确新HEAD看集成回执，不冒作者实际资格。

根工作区和未知改动保留，独立工作树开发。按[持续隔离开发授权](docs/agents/development-loop.md)自主继续；未main合并、部署、生产、真实数据、真实云写或新增费用。旧失败/消费材料不覆盖不复用。历史详见[22:30检查点](/Users/leoyang/.codex/visualizations/2026/11/14/01a1d87f-8978-77a1-b05a-6ad815fa6829/RESULT-CHECKPOINT-2230.md)及各原实际目录。
