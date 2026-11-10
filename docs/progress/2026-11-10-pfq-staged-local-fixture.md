# #382 垫资组分阶段迁移夹具：准确候选与单次方案

代码候选 `54e8b60d1186cf6191f7704bcfa0cceef9889b9b`，tree `9bf8016d1f299472b9c9d0f762379e1462e02b1f`，父提交 `97b11e80eb3c003cdbeebe3bc7941a43833383bb`。已由 merger 子代理快进到本地集成分支，9 个路径；没有 GitHub 写入、部署或生产操作。

本轮只补本机临时 PostgreSQL 的安装夹具：精确 203 条前缀独立读回后，创建独立受限应用 ACL 身份，保留实际旧文件调用闭包；在原 204/205 事务四个准确 DDL 锚点授最小权限，提交后独立读回，再拆除控制对象并继续原完整迁移。原 256 份迁移 SQL、Prisma Schema 及锁不改；原七库的历史冲突、显式修复与 resolve 路径保留，不以错误子串自动重试。数据库业务测试仍使用原 jiangkong actor，因此不能宣称受限应用身份的真实业务授权验收。

独立验证副本为 `/private/tmp/jg-382-staged-independent.gytDHH/repo`，从空依赖冻结安装、生成当前 Prisma 客户端并构建共享包。准确候选最终 CI 编排 413/413、两套 CLI 回归 42/42、API 类型/lint/构建及动态清单校验通过；全部源码检查均不执行数据库迁移。前两次验证环境不完整（缺依赖、PATH 缺 sha256sum）的失败日志原样保留，后继仅修正验证副本环境，源码未改。

独立生成五份控制 SQL，经 PostgreSQL 16.1 grammar 的 SQL/PLpgSQL 静态解析通过；最大生成语句 108333 bytes。解析不证明目录、权限、COMMIT 或实际安装成功。独立结果见 `/private/tmp/jg-382-fixture-independent.RqBnYb/parser-result.json`；作者原始 TDD 与交接见 `/private/tmp/jg-382-staged-local-fixture.0ESDbuUo/HANDOFF.md`。

已封存 `/private/tmp/jg-382-staged-independent.gytDHH/verify-once.sh`，只读 preflight 通过；命令与输入摘要见 `/private/tmp/jg-382-staged-independent.gytDHH/RUN-PLAN.json`。源 Git 对象已自包含、移除 remote，准确 main 基线为 `2f474055bd018b3e454b458038d91080203ad5dc`。Node 20.20.2、pnpm 9.15.9、本地 Docker context/socket 与缓存 postgres:16 镜像 ID 已核。正式命令只允许执行一次，意外首错即停，仍保留原测试内明确预期的历史冲突/恢复；先为七个专用库完成其原迁移旅程，再运行原 13 项垫资并发测试。

用户随后授权准确 `54e8b60d` 单次验证，原封存命令已执行一次并退出 1。首库完成 203 条前缀迁移、精确 ledger 独立读回及受限应用/控制资格准备；M204 开始后捕获首条 SQLSTATE `42702`，reason=`POSTGRES_ERROR`。其余六库和原 13 项并发测试未开始，M204/205 没有通过。临时容器已独立确认不存在，原始脱敏 JSON 为 0600；停止回执及校验文件见 `/private/tmp/jg-382-staged-independent.gytDHH/STOP-RECEIPT.md` 和 `STOP-SHA256SUMS`。

本次授权已消耗，没有重试或后继动态组。源码定位 observer 的局部 `pid` 与 `pg_stat_activity.pid` 未限定右值重名，另发现 ACL 检查的局部 `sig` 与 SQL unnest 别名同名；本次脱敏首错没有列名，这些属于源码原因推断。后继仅继续窄源码修复，实际修复仍须准确新候选另获授权。此前 `33e9320a` 仅诊断授权也已消耗；本方案没有重启旧 17 步或旧诊断包。其它 21 个自动组、POL-22、真实归档/资金/恢复门及 #382 全部验收尚未取得本候选的通过证据。本次只读回查 main 未变、#428 仍 OPEN/DRAFT 且远端 head `4ca0965bd752e086a9229eebd2891d9a99c2e8ad`。

## 后继 c65277ea：源码检查通过，实际M204停止

准确代码 `c65277ea16cd0c18c4e213ca81fb112f9b2a215f` / tree `0a8a77e2a8e0f8f419f04fe82ed48d730567c20a` 已通过 merger 快进到本地集成分支。相对 3ceb 停止文档提交仅五个源码/测试路径：窄 SQL 名称修复、历史恢复核心、两类公开模拟回归及专用假进程端口。没有更改旧迁移 SQL、Schema、权限矩阵或真实业务 actor。

额外修正原恢复兼容性：Prisma 可能只返回事务中止，原 CLI 会从失败 ledger/server 日志识别业务原因。新夹具只暂存原错误，不自动重试；待原校验、业务回滚核对、修复及显式 resolve 完成后，必须由相同完整目标以准确114前缀、新增一条已回滚M115及未变其它ledger继续。换库/前缀/URL/环境/新场景均先拒绝。公开 CLI 的旧核心在独立假端口沙箱 RED，新核心正控及未知原因停止负控 GREEN；都不是真实PG。

独立副本 `/private/tmp/jg-382-c652-independent.Dyc1Q4/repo` 从空依赖冻结安装，最终421/421 CI、44/44 CLI、API类型/lint/构建、动态清单及5份PG16 SQL/PLpgSQL解析通过，源状态干净。源Git对象自包含，移除remote，main只读刷新仍为2f474055。只读preflight通过；汇总/日志摘要见该目录上级 `PRECHECK-RESULT.json`、`PRECHECK-SHA256SUMS`，新唯一命令见 `RUN-PLAN.json`。

用户随后授权此准确候选单次验证，已按原命令执行一次并退出1。首库203前缀、独立ledger及资格准备完成，M204首条 `42883`，reason=`POSTGRES_ERROR`；原件没有函数名。其余六库和原13项并发未开始，容器已独立确认不存在。实际状态 `FAILED`，授权已消耗；未复用54授权、重跑旧包、执行其它组/GitHub/部署/生产。停止回执与校验见 `/private/tmp/jg-382-c652-independent.Dyc1Q4/STOP-RECEIPT.md`、`STOP-SHA256SUMS`。

两名独立源码复核确认生命周期顺序缺陷：observer在匹配四个DDL锚点之前调用完整verify_control/file_callers，而M204$registry$在ALTERFUNCTION重命名与替代CREATE之间暂时缺canonical函数名。历史受控方案先返回非匹配DDL，再对准确锚点做完整校验。此缺陷与42883相符，实际错误目标函数仍未捕获，不冒充真实因果/修复通过。后继仅调整此时序，完整锚点/身份/源码/ACL/读回检查保留；实际新迁移须准确新候选另获授权。

## 后继068ecef8：仅生命周期顺序，实际读回停止

准确 `068ecef8a36e687641161e5bccc74efdc1a5722b` / tree `77933894f56d2e4d7832eb0f578411bb4fb35bef` 已通过merger快进集成。相对2e995411停止文档仅一份SQL模板16增/2删；四个锚点、完整查询哈希、身份/启动参数、对象/函数源码、ACL、提交后读回和拆除检查保留，只在非匹配DDL事件上先返回，匹配锚点仍在trace/grants之前完整verify_control。没有捕获并吞掉函数不存在错误，也没有新拼写镜像测试。

独立空依赖副本 `/private/tmp/jg-382-068e-independent.FGpJCi/repo` 完成421/421CI、44/44CLI、API类型/lint/构建、清单和5份PG16 SQL/PLpgSQL解析；只读preflight通过，Git对象自包含、source clean、无remote，main只读刷新仍为2f474055。结果及日志摘要位于上级 `PRECHECK-RESULT.json`、`PRECHECK-SHA256SUMS`；准确新唯一命令见 `RUN-PLAN.json`。

用户随后授权准确068ecef8单次验证，原命令已执行一次并退出1。首库迁移命令走到205，随后独立stage205-readback SQL失败，固定外层错误LOCAL_MIGRATION_SQL_STAGE205_READBACK；原psql会话未带迁移应用窗口标签，回执明确primary-not-retained，没有原SQLSTATE/具体谓词。组duration18982ms，未见超时/输出界限标识。独立提交/ACL读回未通过，不宣称204/205资格通过。

其余六库和原13项并发未开始，容器宿主精确名称只读查询为空。停止/校验见 `/private/tmp/jg-382-068e-independent.FGpJCi/STOP-RECEIPT.md`、STOP-SHA256SUMS，原件0600；授权已消耗且不重试。后继先为控制psql补齐已拥有的应用/数据库/PID窗口及固定原因，不在缺少实际原因时猜测修改ACL/调用闭包。259归档候选586b未混入本包，不包括其它动态组/GitHub/部署/生产；其源码/模拟通过也不是实际资源通过。

## 后继9d05bdfb：实际捕获文件调用者集合变化

准确 `9d05bdfb8ec29da540f68f647e05b8ff5576134e` / tree `d558d7f07a8344a82feeb9fe5fd5d69fa00f8888` 仅补控制psql的首库唯一应用标签和五组固定脱敏原因。原14拒绝谓词、ACL、迁移、期限及恢复规则保持。独立冷副本421项编排、50项CLI、API类型/lint/构建、五份PG16.1语法解析及只读preflight通过；这些不是实际PG通过。单次准确方案为 `/private/tmp/jg-382-9d05-diagnostic.bJwyy0/RUN-PLAN.json`。

用户明确回复“授权9d05bdfb单次诊断验证”后，原封存命令执行一次并退出1。迁移命令走到205，stage205独立SQL读回失败；清理前0600脱敏JSON成功留存第一条实际 PostgreSQL `P0001 / FIXTURE_FILE_CALLERS_CHANGED`。这确认文件调用者集合与冻结前像不同，尚不能断言具体新增/移除OID、哪个主体或合法阶段原因；后继先核源码集合转换与历史四锚点方案，不直接放宽检查。

203前缀及资格准备完成，205提交/ACL独立读回未通过。其余六库及原13项并发未开始；准确容器 `jiangkong-pfq-concurrency-1794329822435-11777-bb3c44a9` 的宿主 `docker ps -a` 精确名称查询为空。停止回执、脱敏原件路径及校验见包内 `STOP-RECEIPT.md` / `STOP-SHA256SUMS`。授权已消耗，不重试本次或旧包，没有其它组、259候选、GitHub、部署或生产操作。本地集成后续已有259源码，独立诊断包仍固定原256，二者证据分开。

## 后继749cadf9：严格DML阶段变换，259单次待授权

源码提交c6e4ab41及其测试隔离后继 `749cadf9caae840f062144a0a22d52ca415ab35d` / tree `00c4ef982d0c5d4be48e3538f1d130ae821cc6ca` 已经merger集成。冻结全角色×旧触发器的DML可达向量，所有旧root/schema/registry/DELETE/UPDATE及表级权限保持；仅205完整提交、四事件和原CV新列三项actor授予/无grantoption的ACL均证实后，预测原app旧CV的INSERT可达变化。实际向量须精确相等，live调用者须恰为C0∪app；C0、启动参数、原四锚点及原迁移SQL保持。具体实际OID差量和修复通过尚未观察。

独立源审提前发现并修正PG16 oid[] JSON为字符串的问题，SQL显式转bigint[]而JS维持严格数字；完整读回JSON硬限520192bytes，为原512KiB命令包络预留4KiB。实际setup115759bytes，未放大原120000预算。最后测试仅改变事件3对象OID而不改proof/向量，移除关联门RED、恢复39模型GREEN，避免被另一门提前拒绝而误称新门有效。

独立副本 `/private/tmp/jg-382-c6e4-independent.3wsyndgn/repo` 在准确749上通过460项编排、CLI/runtime54及单独准确provider1（共三套55）、API类型/lint/构建、五份PG16.1语法解析和只读preflight。依赖独立冻结安装/生成，test-only successor与安装时的lock/Schema一致；日志及完整范围见上级PRECHECK-RESULT.json和RUN-HANDOFF.md，不把语法/mock当实际PG。

新准确方案RUN-PLAN.json明确应用当前259条迁移，包含对上直签新增三条。完整账d3538d5a…、原256前缀85d1a225…及259逐条SHA已封；保留原七库、明确历史115冲突恢复和原13项并发，仅一个新本机PG16容器，非预期首错停止清理。当前未创建attempt或run.log，未执行实际SQL/资源；须准确新单次授权，不借旧许可。不包括其它组、#394实际归档/COS、native259应用issuer/loader、GitHub写入、部署或生产。
