# B2 运行时输入与代码树准入源码（无真实资源执行）

本轮用户对A+B授权仍为“确认全部，仅源码与模拟测试”。B2把B1的runtime准入占位替换为真实只读实现；不新增plan-only CLI，也不开放实际资源。

`runTask16RegisteredPg` 的默认verifySource现调用 `task16-runtime-inputs.cjs`。完整native入口仍缺owner TLS、迁移、baseline权限、registered精确权限/有效矩阵、clients、App、fixture、case共8阶段，在资源前拒绝。注入map仅可省略verifySource而使用真实只读实现；任何startResource/SQL/App阶段缺失都拒绝，绝不从native补齐。任何注入仍强制SIMULATED/nativeExecution=false。readonlyCommand只能由公开函数的模拟注入提供，CLI没有对应旗标。

## 输入合同

`--inputs` 指向自有、私有、无符号别名的文件，其完整SHA256由 `--inputs-sha256` 外部固定；源码包也保持独立外部SHA。输入不是批准。主要字段如下：

| 字段 | 约束 |
| --- | --- |
| schemaVersion/purpose | 1 / task16-runtime-inputs-not-approval |
| candidateRoot/sourceSha | 必须是当前执行driver的规范根与同一已验证源码候选 |
| nodeVersion/prismaClientVersion/prismaEngineVersion | 当前Node实际版本、5.22.0、固定605197…engine元数据 |
| authorizationReference | 有界审计引用，不构成实际授权或批准校验 |
| tools | 严格docker/git/node/openssl/pnpm/python六项，每项绝对规范可执行路径和SHA；node须当前process.execPath，git须实际/usr/bin/git；dockertools同原helper名字 |
| trees | 下述5根各一份私有manifest文件及独立SHA，无缺失/重复 |
| preparationReceipt | 私有fresh-build见证文件及SHA；绑定候选根/SHA、worktree gitfile+反向指针、shared/API构建步骤及两个原本不存在的dist输出归属与manifest SHA |
| docker | 固定原helper endpoint/image及有界daemonId，仅描述输入，不访问Docker或证明daemon身份 |

5根为node_modules、services/api/node_modules、packages/shared-domain/node_modules、services/api/dist、packages/shared-domain/dist。全部helper内容读取统一走O_NOFOLLOW|O_NONBLOCK描述符打开后fstat正规/身份/大小校验，固定size+1上限读取并核fd前后/命名inode稳定；不留raw readFileSync/hash后验。私有输入/packet/见证/收据16MiB、manifest64MiB，来源文件64MiB/git指针16KiB，工具512MiB上限以64KiB流式摘要且后验绑定初始身份。manifest和见证的初读以同份有界bytes核外部SHA与JSON。manifest沿既有 `scripts/ops/runtime-manifest.py` 格式，逐文件字节/权限/uid/gid及链接都实际比较。每个依赖链接不能越候选根；根内的目标还必须属于被捕获的树或逐文件匹配已验证tracked source，避免只检查“在根内”却加载未封存代码。workspace包目录链接允许其内容分别由source与captured根完整覆盖。

## 实际顺序和证据限制

先核输入/工具，调用唯一source CLI验证完整Git/AST/迁移源码包，再要求source repo就是当前driver根，核driver、准入模块、resourcehelper、installer、source CLI和manifest脚本均属于候选。worktree双向指针与外部见证绑定后，在自有新建私有证据目录实际比较5树。只有匹配后才在独立新鲜Node进程解析当前Prisma入口；父核规范路径及source/captured覆盖后，另新鲜Node进程仅加载版本元数据，不构造PrismaClient，同时避开父path cache与module cache。随后再比较5树、再次source CLI核验，并后验输入/见证/工具摘要不变。

只读命令使用固定argv、无shell、PATH/LANG/LC_ALL/TZ白名单及300秒总准入预算、单命令不超过120秒。只会写本次新建本地比较收据，不执行SQL、构建、授权或资源命令。没有删旧dist、改共享依赖或容器。

fresh-build文件是外部controller的绑定见证，**不是本函数独立证明实际构建发生的密码学证明**。5树文件/链接与工具字节核验也不等于完整OS/dynamic-loader、进程内存、实际PG引擎运行或TLS/ACL验收。真实受控执行仍须冻结完整依赖、可信执行来源、正式资源批准并补全其余原生adapter。

## 模拟验证范围

新增用例只经原公开run函数及进程/资源边界：自有合成候选根加载同字节driver/准入模块，source CLI返回由测试替代的协议回执；真实Python捕获/比较合成5树，真实新鲜Node读取合成Prisma版本元数据；Git worktree与fresh-build见证为合成协议数据。它们不冒实际Git source seal或真实fresh build已通过。原25个source CLI测试独立用真实Git验证其唯一核验行为。

反例覆盖外部摘要、工具漂移、错执行根、自身非候选、worktree反向指针、旧输出归属、缺树/重复树、实际字节漂移、越根/根内未封存链接、package.main绕链接、metadata加载中的树漂移、错误engine以及不完整注入绝不落到真实资源。没有真实PG/SQL/Docker/端口/证书或交易，#398和16/42/44门保持，17/24不解锁。
