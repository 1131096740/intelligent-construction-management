# 业务简化：源码封包与受控验收准备

适用[任务01 #383](https://github.com/1131096740/intelligent-construction-management/issues/383)。本页区分**准备产物验收**与**独立授权后的运行验证**；任务状态以工单及 `PROGRESS.md` 为准，不由本文预填完成或全绿。跨会话输入映射见[任务01准备产物交接](../progress/2026-11-05-enterprise-simplification-task01-prepared.md)，历史及新增只读证据见[集成交接](../progress/2026-11-05-enterprise-simplification-integration-start.md)。

## 当前确认的测试边界

用户已确认 `--prepare` / `--verify` 与输出清单为任务01测试边界。任务01是验证前置片，按原票“以其可核验产物验收”“不启动未获准实验”核齐准备产物；不要求为了准备验收先运行未授权PostgreSQL、迁移或部署。真实HTTP/PG/Web、TLS、角色和清理的执行结果须另行取得，不能记成通过，也不能由源码封存推定。

迁移、受控资源/故障实验、部署和生产变更仍按各自具体范围授权。下列两个源码命令不启动这些操作，也不要求本次安装依赖或生成构建产物。

在准确候选的**干净、已提交工作树根目录**执行。选择 `/private/tmp` 下尚不存在的新普通文件；父目录须已存在，文件不得位于仓库内，不复用旧packet，不通过符号链接目录写入。

```bash
node scripts/prepare-enterprise-acceptance.cjs --prepare --output /private/tmp/jg-enterprise-source-packet-20261105-01.json
node scripts/prepare-enterprise-acceptance.cjs --verify /private/tmp/jg-enterprise-source-packet-20261105-01.json
```

首次成功输出 `source-sealed`，核验成功输出 `source-verified`；stdout包括 `candidateSha`、`fileCount`、`migrationCount`、`sealSha256`。保存实际stdout及packet文件SHA-256，不预写未来提交SHA。失败返回非零及 `rejected`、稳定错误代码、泛化中文说明；保留失败，查清漂移或路径问题，不能忽略退出码继续。

## 源码输出清单与后续输入的对应

实际生产者是[源码封包CLI](../../scripts/prepare-enterprise-acceptance.cjs)。它只产生一个source packet和stdout摘要，**不产生runtime inputs、构建见证、资源批准或运行通过收据**。

| packet/摘要字段 | 当前核验内容 | 后续运行材料如何对应 |
| --- | --- | --- |
| `schemaVersion=1`、`purpose=source-seal-only` | 固定公开格式与用途 | driver拒绝其他用途；仍不是执行凭证 |
| `candidateSha` | 准确HEAD，禁用Git replacement objects；采集前后干净且HEAD不变 | runtime inputs的 `sourceSha`、构建见证的 `sourceSha` 必须同值 |
| `files[]: path/sha256` | 当前HEAD独立导出的完整已跟踪集合，逐份比对Git blob及磁盘内容，含CLI、Schema和准备源码 | driver的 `readSealed` 取owner/权限/身份等准备源码，重新逐文件核对，不接收任意SQL或shell替换 |
| `lockfile` | `pnpm-lock.yaml`内容摘要 | 后续冻结安装的输入，不等于已安装依赖已证明 |
| `migrations[]: path/sha256` | 递归完整 `migration.sql` 成员及摘要，与实际目录核对；当前候选197项 | 授权后应用的范围及迁移登记逐项比对依据，不把旧244/245清单混入 |
| `scope` | `ignoredArtifacts=not-sealed`、`installedDependencies=not-verified`、`httpPostgresAcceptance=not-executed` | 明示五树/原生库/浏览器及运行结果没有被这个packet封存 |
| `sealSha256` | 固定payload的公开校验和，核验时从当前源码重新导出并比较 | driver绑定该source seal；不能替代批准、签名或原始构建证明 |
| stdout计数及packet文件SHA-256 | 来源与文件本身的可回读收据 | driver还核packet文件字节；内容校验和与packet文件哈希不是同一字段 |

`--verify`不信任packet自述的子集。源码/锁/候选变化、缺少或增加迁移、篡改清单、非法路径、符号链接、树内输出均拒绝。任何后续源码或配置提交都需新packet；旧包不能用作新SHA证据。该CLI没有数据库URL、执行、迁移、任意SQL或shell命令模式；不能追加不存在的 `--execute`，也不能将旧runner当成隐含授权。

## runtime inputs与构建见证：后续执行前的独立材料

[受控driver](../../services/api/prisma/run-enterprise-task01-local.cjs)已经存在准备源码，但不是当前两个源码命令的执行模式；尚未运行。本节说明它实际消费的格式和对应关系，不提供当前可执行资源命令、批准口令或未来SHA占位值。源清单验收本身不强制现在生成这些材料。

主控若之后准备一次具体运行，须在**新任务自有工作树**见证冻结安装及构建，按真实输出另封runtime inputs；目前没有由 `--prepare` 自动生成runtime inputs或ownership receipt的功能。临时外部preflight草稿不是正式生成器或批准路径，不据此补造见证。

| driver输入 | 真实来源与核验方式 | 证明限度 |
| --- | --- | --- |
| runtime inputs的 `schemaVersion=1`、`purpose=task01-runtime-inputs-not-approval`、`sourceSha/candidateRoot` | 来源于新任务实际工作树和已核source packet；driver核fresh worktree身份与Git双向指针 | 不能指向旧混合根、其他候选或仅改标签复用旧构建 |
| `nodeVersion/prismaClientVersion/prismaEngineVersion`、`tools` | 记录实际node/pnpm/python/docker/openssl绝对真实路径及文件SHA-256，driver逐份比对；Prisma当前固定5.22及引擎版本 | 不等于整个操作系统/动态加载器已证明 |
| `trees[]`五树 | `node_modules`、`services/api/node_modules`、`packages/shared-domain/node_modules`、`services/api/dist`、`packages/shared-domain/dist`；用既有[运行树清单工具](../../scripts/ops/runtime-manifest.py)的capture产物分别记录 `root/manifest/sha256` | driver核清单文件及实际树，依赖链接不得逃出本次工作树；Web/浏览器不在这五树内 |
| `preparationReceipt: path/sha256` | 主控对新目录实际见证：`purpose=witnessed-fresh-task01-build-ownership-not-approval`、同 `sourceSha/candidateRoot`、`worktreeGitDir/worktreeGitFileSha256` | 这是见证收据，不是签名/批准；不能事后把未知旧目录标为自建 |
| ownership receipt的 `buildSteps/outputs` | 固定步骤 `shared-domain:build`、`api:build`、`task01-owner:tsc`；两份输出 `services/api/dist`、`packages/shared-domain/dist` 记录原先不存在、准备后manifest哈希 | driver只在身份及完整树匹配后清掉这两个自建输出，再从封存源码重建并复核；无权清理其他目录 |
| `docker.endpoint/daemonId/imageId` | 后续固定本机daemon和已经缓存的PG16不可变image ID，driver及资源helper核对 | 不是拉取镜像/启动容器的授权 |
| 新artifacts目录 | 后续本次专有、尚不存在、真实 `/private/tmp` 路径；材料普通文件0600、无符号链接 | 生成运行/ACL/资源收据，凭据仅私有临时材料，不进入source packet |

这些材料缺失或不匹配时driver在资源前失败关闭。主控应在真实见证后提供具体材料及哈希；本交接不伪造runtime inputs已生成，也不将缺少当前运行材料等同于源码准备命令失败。

## 动态库存中的独立入口接线

接线候选 `7cb7412311c88989440d52e60f44ef04c6c337dc` 已提供可核对的[动态dispatcher](../../services/api/prisma/run-database-dynamic-gate-local.cjs)与[库存manifest](../../services/api/prisma/database-dynamic-gate-manifest.json)格式；它仅用于说明下面真实参数与映射，仍有后续审查修补，不是最终源码包或真实执行通过收据。

- 新组名 `enterprise_task01_entry`，`runner.invocation=task01_explicit_inputs`；manifest分别固定driver/helper路径与源码SHA-256、准确镜像ID，dispatcher只编译检查语法，不在库存校验时import或执行模块。
- 必须显式、单独选择该组，不能默认all、与旧组混跑或借用旧组确认。旧77文件/511测试的组保持原内容；新库存接线为78文件/512测试，**不是512项PG已通过**。新组只有1项，`executionStatus=NOT_EXECUTED`。
- 除既有候选SHA/全局确认合同外，新组还要求 `--task01-packet`、`--task01-inputs`、`--task01-inputs-sha256`、`--task01-artifacts`、`--task01-confirm` 全部显式提供。它们分别映射driver的source packet、runtime inputs、inputs文件哈希、新artifacts路径及独立确认；本文不给组合运行命令或确认值。
- dispatcher在新白名单环境向driver注入 `JG_TASK01_EXPECTED_SOURCE_SHA`，driver与packet候选SHA交叉比对；这是防止调度请求错候选的守卫，不授予执行权限。缺输入、混组或源码哈希不符在通用构建、Docker发现、临时资源和SQL之前拒绝。

该接线表示“存在准备好的受控调用路径”，不表示资源已创建、1项真实案例已运行或已经获得迁移/部署授权。准确最终dispatcher协议、源码包和实际收据由主控在修补集成后再次核验。

## 已有准备产物与后验分工

| 范围 | 已有产物/复用指针 | 独立授权后验及后续业务片 |
| --- | --- | --- |
| 资源身份、阶段截止与收尾 | [资源helper](../../services/api/prisma/enterprise-task01-resources.cjs)与driver；固定runId/daemon/container/实际Mounts/网络身份、15分钟总预算、阶段超时及按身份清理逻辑 | 实际启动、失败、中断、TLS载入与资源不存在确认仍NOT RUN；不接管旧资源，不prune |
| owner/runtime/observer权限 | [访问清单](../../services/api/prisma/enterprise-task01-access.json)、[授权SQL](../../services/api/prisma/enterprise-task01-access.sql)、[身份SQL](../../services/api/prisma/enterprise-task01-identity.sql) | 初始显式上界，不称最小/完整实测权限；实际PUBLIC/函数/RLS/成员关系与授权事务前后差异仍须真实PG验证 |
| owner夹具与实际连接 | [owner进程](../../services/api/prisma/enterprise-task01-owner-process.cjs)、[合成fixture](../../services/api/src/database/enterprise-task01-owner-fixture.test-support.ts)、[连接合同](../../services/api/src/database/enterprise-task01-entry.test-support.ts) | owner仅初始化合成主数据/可信观察；受限AppModule与observer独立、同实际池前后/重连身份须实测，不能用probe池代替 |
| TLS | [连接probe](../../services/api/prisma/enterprise-task01-client-probe.cjs)、资源helper及已存[传输诊断](../progress/2026-11-05-enterprise-simplification-tls-transport.json) | 合成adapter正确证书仅握手后P1010认证拒绝，非健康SQL正控；错CA/SAN同P1011不能靠文本分因。真实PG须组合证书单变量、载入身份、健康前后正控及明确拒绝；未知不通过 |
| 响应丢失 | [回环代理](../../services/api/prisma/enterprise-task01-response-loss-proxy.cjs)及[公开协议测试](../../services/api/prisma/enterprise-task01-response-loss-proxy.test.cjs) | 已有15项协议检查，完整上游后一次断下游；不自动重试。该driver仍记业务丢响应NOT RUN；真实提交/响应丢失/重放矩阵由任务16完成 |
| 首条HTTP/PG | [专属公开测试](../../services/api/src/fund-execution/enterprise-task01-entry.http.pg.spec.ts)及driver | 准备了一条真实接口/独立observer断言，当前1项未执行，不计通过；只是首条案件入口，不替代实际FundExecution全矩阵 |
| Web | 下节列出的真实路由、页面、域API、真实browser配置/测试 | 已有可复用入口，不新造页面；与本票受限PG/HTTP的实际运行绑定NOT RUN，不能记完整Web验收通过 |
| 真实数据与文件保留 | [集成交接](../progress/2026-11-05-enterprise-simplification-integration-start.md)、源码与旧根差异清单、只读迁移/代码/连接收据 | 保留原工作区、真实业务及附件，旧差异默认不纳入；完整数据/文件分布、备份恢复和无损迁移由任务42后验，不能猜0或删历史 |

## 真实Web入口的复用指针

前端入口已经存在，不是future页面占位：

- [路由及岗位控制](../../apps/web-admin/src/routes/route-records.ts)将 `/资金执行案件` 映射到 [FundExecutionWorkbenchPage.vue](../../apps/web-admin/src/pages/fund-executions/FundExecutionWorkbenchPage.vue)，使用Vue3/TypeScript/TDesign与既有业务组件。
- 页面通过[资金执行域API模块](../../apps/web-admin/src/api/fund-execution.api.ts)读取案件/详情/候选并调用办理接口，不直接访问数据库；[提交历史组件](../../apps/web-admin/src/pages/fund-executions/components/FundExecutionSubmissionHistory.vue)展示真实冻结记录。
- [真实browser配置](../../apps/web-admin/playwright.pol115-real.config.ts)要求本机 `POL115_API_URL` 与合成会话，代理到真实API；桌面1366×768、手机仿真390×844、retries=0、reuseExistingServer=false，现有Web端口4215。调用方须保证端口由本票占用，不能接管其他服务。
- [pol115-fund-real.e2e.ts](../../apps/web-admin/e2e/pol115-fund-real.e2e.ts)实际访问该路由、等待真实GET、打开冻结提交记录并检查金额/文本/窄屏局部宽度。其既有全链挂接位于 [fund-execution-entry.http.pg.spec.ts](../../services/api/src/fund-execution/fund-execution-entry.http.pg.spec.ts) 的browser分支；该旧测试还包含owner播种、审批/PDF，不原样当本票受限三角色证明。
- [fund-execution-workbench.e2e.ts](../../apps/web-admin/e2e/fund-execution-workbench.e2e.ts)则使用page.route模拟请求，仅是前端交互/幂等键基础，不能替代上述真实HTTP/PG路径。

本票新driver专注首条HTTP/PG，收据 `web:not-implemented` 表示它**没有自动调用Web阶段**，不是声明前端页面不存在。后续真实运行须单独交付本票API/合成会话，核对既有browser测试“一条案件/固定文本/125元”等fixture假设，按实际本票数据接线，不减弱断言。其端口、构建/浏览器依赖和运行结果另取证；当前没有把这种串接记为已实现或通过，也未运行微信/真实持机验收。

## 后续依赖票如何复用与失效

后续票复用这些工具源码、格式合同和真实入口指针，不继承旧候选的验证结论。每票产生新SHA，都须从其准确干净提交新建source packet并通过 `--verify`；不能只复制旧packet改SHA或沿用旧计数。

一旦源码、依赖、锁、工具、构建配置或产物改变，runtime inputs对应五树及fresh-build ownership receipt也须按实际新任务重新见证、核验并封存。driver要求同sourceSha/candidateRoot，不能只替换标签把旧树或旧见证冒充新材料；即使部分字节恰巧相同，也要核清来源、归属与本票范围。后续运行中的任何变化同样使受影响的旧输入证据失效。

source `--verify`通过只用于已确认的准备产物核验，不是运行授权，也不得解除任务16/A16真实资金提交、任务42/A36恢复迁移、任务44/A38最终候选/清理的实际验收。依赖图的准备前置与这些后续真实门分别登记，未执行项保持未执行。

真实数据“保留基线”在本票中明确为保留约束、旧根/候选来源分类与已采集迁移/代码/角色证据；没有逐行业务数据或附件全量核验，不把未知余额、精度、主体或文件当0/已齐。后续任何需读取真实行、制作副本、迁移或部署的动作按其具体授权处理，不能从source seal推导数据处置权限。

## 已记录基线与阶段门禁状态

- 精确主线197迁移与生产197项完成登记逐项一致；独立0893源码冻结构建重现已采集生产API四代码树及Web dist共2662文件、41,895,003字节。不是仅看三个入口样本或旧checkout；仍未证明生产node_modules全部内容、原构建签名或进程内存模块。
- 当时Node PID2502628所属5个数据库TCP连接分别匹配PG backend，角色均 `jiangkong_runtime`、ssl=true；只证明该时点实际连接，不证明全部未来池、CA/SAN或完整有效ACL。完整Schema、业务数据/附件分布及真实恢复未因此通过。
- 78a6f7b6里程碑有35项定向（CLI20、回环HTTP15）、冻结359项编排零跳过、复审0/0及3018文件/197迁移封包；这些是该SHA的准备构件证据，不能移给新SHA。
- 本交接基点b09c629c已取得source packet3031文件/197迁移，但新增准备测试的库存接线尚有3项既有编排失败（356通过/3失败），作者正在修复。不能据旧359通过或新source seal宣布当前全绿；准确最终收据由主控后续登记。

这里只说明准备物、复用入口及后验范围，不改变规格/验收规则。任务16资金安全、任务42恢复迁移、任务44最终候选全链仍按各自门禁交付，源码或案件冒烟不能替代它们。
