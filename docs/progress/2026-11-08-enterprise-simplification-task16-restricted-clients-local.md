# Task16 B7 受限客户端源码与模拟本地收据

准确基线 `62a7d113d121e284ee818afbaad05ebe9d3185d2`；独立树 `/private/tmp/jg-382-task16-restricted-clients-20261108`，分支 `codex/enterprise-task16-restricted-clients-20261108`。未提交、推送、合中央/main；旧B6作者树/中央/Task10未改。原d0b4冻结保留于 `/private/tmp/jg-382-task16-restricted-clients-evidence-20261108/freeze-manifest.json`；v2冻结保留于同目录 `freeze-manifest-v2.json`；本次dotenv残留修复新冻结为 `freeze-manifest-v3.json`，明确supersedes v2/1325（d0b4亦留历史）；后续修改使受影响证据失效。future所有提交和最终push HEAD须 `[skip ci]`。

## 授权和边界

用户原“确认全部，仅源码与模拟测试”包含身份/角色/TLS/首败/清理，主控明确映射本片原 `runTask16RegisteredPg` + `{command,createClient}` 显式两函数对象及B2自有sealed fake CJS包加载。严格键集合/缺一拒绝，任何注入保持SIMULATED/nativeExecution=false，零native回填。没有新CLI旗标、OS/进程测试边界、私有helper测试或通用VM/CJS解释器。

新客户端测试只加载/构造本测试新建私有合成候选内的无副作用FakeClient（不包含Prisma engine）；真实Node/Git/source-only CLI/Python运行仅保既有受影响离线协议回归，不创建PG/SQL/TLS/端口/证书/容器/资源。没有实际导入/构造共享Prisma来测试loader。旧fixture19的合法namespace/身份模拟历史证据保留，本片未改fixture TS，也不调用需要App.origin的整fixture，因此不重复19或伪造App proof；不否定旧证据。本机API类型/lint依赖使用ignored服务目录的自建链接，不作native依赖闭包证明。

## 实现

- B2 qualified input admission只最小追加canonical client entry的path/hash/FD身份，在metadata流程后重核；fresh metadata仍只作版本/路径证据，不称父进程Class已验。
- Driver最早记录专用CLI/main、空execArgv、无NODE_OPTIONS/NODE_PATH/preload、初始cache只含main、Node loader函数引用及自身源码digest，native只允许一次；外部宿主/重入拒绝。Class descriptor在source返回后即复制冻结，资源九字段第一份witness仍不替换。
- 原生B7 stage绑定source/input/packet/build witness、五tree manifest、Node/Python工具、CA/正确server presentation、B4/B5/B6角色names+OID/DB-cluster、202ledger、B5/B6 manifest/matrix hashes和首份resource witness。每await后复核已持有FD/资源/已加载模块及signal；阶段前后重新走唯一source CLI和五tree比较，不接受现取的新receipt冒最初。
- `task16-client-loader.cjs`只require已qualified的canonical absolute entry，拒相关cache/path cache预加载，不delete cache。实际Class来自该次真实module.exports；检查实际新增Module children闭包各file/member/hash/FD、版本/engine、Class引用及cache身份，每await后重核。Node hook不能因为“最早看到且保持引用”就被信任：另与运行中钉点Node内建CJS loader固定赋值的原文函数比较；这是有限文本比较，不是解释/执行另一套CJS。native fresh入口仍是源合同，非对已遭全面篡改宿主的远程密码学证明；真实Node/engine行为留未来实际门。
- 三role固定URL只含隔离loopback库、对应内存随机credential、strict CA+require、1连接池、固定timeout和run/role application_name。不继承数据库URL或Prisma engine override。owner→runtime→observer同步构造，返回即登记，先捕获disconnect再读其它public方法，await connect前已登记；句柄失败/字段getter失败仍尽量关所有已知拥有者。
- 查询每个实际会话current/session names和OID、DB/cluster、PG16/origin、TLS、default/actual readonly与nonce，必须一行、三个不同client/PID且owner/runtime off、observer on。末尾再次查询相同PID，不拿声明冒实际session。
- B6固定checker内部机械抽取为唯一 `task16-registered-access-check.{cjs,sql}`，B6安装和B7复核共用，既有44完整body/接口、14表目录、combined矩阵、POL owner例外与四组无条件ALWAYS guard保留。B6新增规范化其它grantee ACL witness及14表见证输出；B7必须与旧值等，不以当前snapshot替过去值。
- B7通过现有owner resource通道先定义仅技术TEMP view/table/checker，后 `BEGIN READ ONLY` 中只有验证SELECT/ROLLBACK；不重跑七片、GRANT、CREATE ROLE或业务DML。TEMP checker不能跨psql进程复用，故每次在同批owner会话建立后验证，未声称旧pg_temp仍存在。
- 成功返回owner/runtime/observer和一个幂等close供driver持有；所有close按逆序逐一尝试并保留首败，单个disconnect失败不跳过其它client，UNKNOWN进入driver收据。连接promise必须实际返回后才继续；没有Promise.race、强杀engine或把未settled报closed。凭据只在内存URL，不写artifact/receipt，错误仅固定code，SQL/URL/password不透传。

## 初版d0b4红绿和历史结果（已被P2拒绝，非当前冻结）

外部目录 `/private/tmp/jg-382-task16-restricted-clients-evidence-20261108` 保留原日志不覆盖：

- `b6-other-acl-red.tap` → `b6-other-acl-green.tap`：原公开run确认B6旧输出缺少其它ACL witness；最小扩输出/唯一checker抽取后，B6 `b6-extraction28.tap` 全28过。
- `clients-stage-red.tap` → `clients-stage-green.tap`：完整两函数对象原入口缺cap，接真实stage/owned fake包后正常3会话/逆序关闭。`clients-stage-first-green.tap` 是捕获的nonenumerable nativeLoaderFacts未复制进stage导致拒绝的中间失败，已明确修正，不能当期望RED。
- `clients-partial-handle-red/green.tap`：malformed刚拥有client不能在shape检查前漏登记。
- `clients-witness-alias-red/green.tap`：输入另设witness别名不能替第一份immutable resourceWitness。
- `clients-captured-close-red/green.tap`：connect首败时不能改用被替换的disconnect。
- `clients-getter-red/green.tap`：public query getter抛错仍保存已知disconnect。
- `clients-initial-hook-red/green.tap`：loader在driver启动前被包裹时，不能采信该wrapper为可信baseline；原样Node builtin和已改hook两路经public run实际观察。后续完整结果不把这些窄选测试的skip计通过数。

原189保留 + B6新witness1 + 新客户端26 = **216**；`first-full214.tap`与`full215-final.tap`为先前版本通过历史，原d0b4版本 `full216-final.tap` 216/216零失败/零跳过/零取消。原CLI `cli25-final216.tap` 25/25；API `types.log`/`src-lint.log`退出0，十一CJS `syntax11.json`与`cjs-lint-final.log`退出0，两JSON decode、39原来源pins逐项核以及diff check过。该段只保原d0b4历史hash/结果，不覆盖下方P2新源码。

新26项含公开真实stage正控、三种不完整边界零资源、错误角色OID/login/TLS/readonly/cluster、同PID、observer default readonly、其它ACL漂移、preload/重入/初始与后改Node hook、已加载依赖改字节、二号连接首败/abort、cleanup unknown及敏感错误、固定URL、TEMP/readonly协议与三项句柄/first witness保护。所有class/module加载只发生在自有fake包；mock session/metadata返回不是实际PG catalog/权限/transport/DML证明。

## 两项P2集中修复（v2历史：then已闭，环境有dotenv残留）

原Standards2P2、Spec1P2（then项独立重复，不双算）报告分别为外部 `...restricted-clients-{standards,spec}-review-20261108.md`。原d0b4 manifest及15文件前像另保 `freeze-manifest-d0b4-original.json` / `d0b4-before-images`，旧文件/全部失败日志不覆盖。

- **then getter早于owned**：原公开run/createClient返回自有有效disconnect、但then getter抛错的FakeClient，原实现不尝试disconnect。`p2-then-getter-red.tap` 实际RED：预期owner disconnect但实际空列表；最小修复只用无执行getter的非null对象/函数身份和去重检查，立即owned登记/保存cleanup，然后读取then及其它public方法。`p2-then-getter-green.tap` 正式GREEN，保首败/UNKNOWN及resource finally；如cleanup getter本身不可读仍保未知，不伪closed。
- **live环境覆写未复核**：原一次入口check不足，command await期间可新设PRISMA_QUERY_ENGINE_LIBRARY而仍构造/连接。`p2-live-env-red.tap` 原公开command反例实际RED；把同一既定拒绝环境前提放入统一check，每await后及load/construct/connect边界重复检查，永不以新环境作为baseline。`p2-live-env-green.tap` 正式GREEN；另 `p2-live-env-boundaries-green.tap` 包括构造和connect期间PRISMA_QUERY_ENGINE_BINARY变化：已拥有client仍关闭，不创建下一角色。所有环境仅本测试合成值，t.after恢复原值；没有创建或加载所指引擎文件。

本次新增4（then1＋source await env1＋construct/connect env2），原216保留，当前 **220**（旧189＋B6 witness1＋B7客户端30）。`p2-full220.tap`完整零fail/skip/cancel，原CLI `p2-cli25.tap`25/25；API `p2-types.log`/`p2-src-lint.log`、十一CJS `p2-cjs-lint.log`/`p2-syntax11.json`，两JSON decode/39原source pins/diff check通过。该轮版本与准确hash见 `freeze-manifest-v2.json`，不挪旧216通过覆盖新源码。

只修这两项：不扩后继App/Auth/seed/ACL profile，不改B6/Task10/中央，不加物理/进程/force-kill或通用loader接口；仍没有真实SDK/PG/SQL/资源。本次单元模拟仅观察原public run和command/createClient边界，不能当真实engine重定向拒绝或物理断连的证明。

## v3：dotenv同类残留最小修复（当前冻结，待两轴增量）

v2 Spec0/Standards仍1的完整报告为外部 `...restricted-clients-{spec,standards}-review-v2-20261108.md`；该残留归原环境P2，不增加distinct计数。v2 `1325cff5a994c66090944a637f131bce06efa20b7ca419860a8f2ff9239227c7` 原位保留及15文件前像 `1325-before-images`，不覆盖原220或失败日志。

`p2-dotenv-red.tap` 经原public run/command，在首次await写入本测试自有fake ROOT/services/api/prisma/.env（仅合成engine字符串，process.env不变），原实现仍完成模拟协议，实际RED。最小GREEN只把既定`.env`、`services/api/.env`、`services/api/prisma/.env`三个缺失条件移入现有统一checkEnvironment，每await后以及load/construct/connect既有check点重复执行；没有新增loader或不同接口。`p2-dotenv-green.tap` 证明在Class构造前拒绝，`p2-dotenv-boundaries-green.tap` 再覆盖factory构造后写ROOT/.env：新拥有owner handle仍disconnect，零connect、不创建下一client，resource finally保持。

本次新增2，原220保留，当前 **222**（旧189+B6 witness1+B7 fake客户端32）。`v3-full222.tap`完整零fail/skip/cancel，原CLI `v3-cli25.tap`25/25；API `v3-types.log`/`v3-src-lint.log`、十一CJS `v3-cjs-lint.log`/`v3-syntax11.json`、两JSON/39来源pins/diff检查通过。准确新hash以 `freeze-manifest-v3.json` 为准，旧pass不挪用。

未加载或执行dotenv/真实SDK/engine/PG/SQL/资源，合成.env由原自有fixture整体收尾移除；不扩B8/AuthRateLimit或修改ACL profile，不引入新物理/OS/命令接缝。不把文件拒绝模拟称为实际Prisma传输或引擎验收。

## 未满足的门

默认native仍缺 `startApplication/seedFixture/runNormalCase` 三stage，在source和资源前拒绝；不是完整driver、实际连接/TLS/ACL或资金验收。App后续必须复用同一个runtime实例/provider，不能另开第四池或提高connlimit；B7没有伪造App origin。fixture合法ProjectAffiliateAssignment仍后续loadFixture前提，不在本片seed、放宽guard或加Project DML/SD。

SQL_NOT_EXECUTED_NOT_PARSED；真实SDK父进程加载/engine、PG/TLS/有效ACL/锁/negativeDML、COMMIT/响应丢失/竞争、未settled promise与物理断连/清理均未实证。模块/构造器代码准入与内存callback闭包不是对真实引擎外部效果的验收。#398 OPEN及17/24、16/42/44门和13/45保持；无main、部署、生产、实际业务或通知。
