# B3 准确202迁移与登记核对源码（未连接执行）

本轮沿用用户“确认全部，仅源码与模拟测试”。`migrateBaseline`现在有真实原生实现，但默认还缺7个其他stage，仍在任何source/资源读取前失败；不运行Prisma、SQL、PG、Docker、端口或真实证书。

公共测试仍仅 `runTask16RegisteredPg(options, adapters)`。模拟map必须显式给 `migrateBaseline: {command: async(exe,args,control)=>...}` 才接入真实stage逻辑；owner资源由显式注入startResource提供。缺command对象不回填native，注入永远SIMULATED/nativeExecution=false。复审新增经用户“确认，仅模拟进程与假时钟”授权的另一显式形式 `migrateBaseline:{process:{spawn,groupSignal,groupExists,setTimer,clearTimer}}`；必须五函数全给且无额外key，不填充真实函数，仍仅原public run测试。CLI无新模拟或跳过旗标。

## 前提与顺序

- 复用B2只读准入结果的candidateRoot、精确schema和202份迁移元数据；再逐文件通过既有qualified FD reader核实际bytes/sha、数量、唯一名、固定顺序及当前ROOT。实际目录及migration.sql正规成员与封存202列表双向一致；owner预检await后再核源码/工具/资源，入口source/凭证/工具描述符固定快照。该reader只为生产内部复用导出，测试不直接调用它。
- 资源必须绑定本次UUID、source SHA、daemon/endpoint/image、container/network、数据库与published port。CA为自有私有正规文件，hash与resource回执、证书摘要和ownerTransport前阶段一致；所有标识冻结为本stage最初见证，双方同时改public属性和回执也不接受。
- `verifyOwnerTransport`应先返回 `OWNER_TLS_CONTROLS_VERIFIED`、ownerRole、databaseOid、systemIdentifier、caSha256；该前阶段尚未实现，B3不制造它的成功证明。owner SQL独立核当前/登录角色、DB owner、数据库OID/cluster、PG16、SSL、origin和default read-only=off；必须没有旧migration ledger/public关系，已有库不恢复/重试。
- 固定调用：已封存pnpm执行 `--filter @jiangkong/api exec prisma migrate deploy --schema <当前ROOT/services/api/prisma/schema.prisma>`。只设白名单env，DATABASE_URL仅env含随机owner凭证、127.0.0.1自有端口/数据库、schema=public、pool=1、sslmode=require+sslaccept=strict+固定CA。无继承NODE_OPTIONS/PG变量；实际Node/pnpm字节和初始FD身份都前后核验，拒绝三处会被Prisma读取的未封存.env。
- 进程完成后重新核source/tools/CA/资源，owner独立只读查询完整ledger，202条名称/checksum/finished/rolledBack必须逐项等于源码集合；exit0不是通过证据。后验群集/角色/资源漂移均拒绝。

进程监听在访问stdio前安装，兼容无PID/管道的异步启动error；leader close不证明owned group消失，close和组不存在都观察到才settled，exit0残组仍失败且继续KILL/deadline。原生command源码使用无shell spawn、独立进程组、180秒命令预算、stdout+stderr共1MiB上限、取消→TERM→1秒KILL→5秒仍未settle失败。异常/未知回执不重启或重试；可能已有部分DDL提交时标UNKNOWN_DO_NOT_RETRY，不称回滚。App/client/resource收尾仍由原driver finally执行，原生进程未收尾会失败，不称完整清理通过。

成功只返回BASELINE_MIGRATIONS_LEDGER_VERIFIED、源码/ledger/输出摘要与字节计数，不返回输出文本/URL/密码；金融、TLS与上线验收均false。命令启动前拒绝为NOT_ATTEMPTED，启动后任何失败为UNKNOWN_DO_NOT_RETRY，driver保留该状态。

## 本片验证限制

新用例真实读取现有202源码和schema；owner读/ledger、TLS前阶段和Prisma进程全为协议适配器。CA文件仅合成文本，不是真实证书。超时/unsettled/超输出等进程结果由command边界模拟；没有启动pnpm/prisma或实际验证TERM/KILL/180秒物理时序。native wrapper只是已实现源码，不据模拟声称真实进程/PG/迁移已通过。

剩余7原生stage为ownerTLS、baseline角色/权限、registered精确权限/有效矩阵、三角色客户端、App、fixture、正常case。SQL七片也未运行；真实资源授权、完整PG/COMMIT/故障/丢响应/竞争与清理、#398和16/42/44门保持，17/24不解锁。

复审冻结检查为原72+新增10=82模拟/原CLI25及语法/类型/lint全通过，增量双轴审查待主控。EventEmitter与假时钟只证明控制器协议，不证明物理OS清理或实际迁移。详细红绿与hash见本地收据。
