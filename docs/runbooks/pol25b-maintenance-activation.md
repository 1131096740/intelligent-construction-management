# POL-25B：零迁移、维护态应用激活

本路径对应 #123，不对应常规兼容发布，也不解除 #124 的开放门。
本次非生产交付只明确激活契约并阻止通用部署器误入冻结状态；没有执行生产操作。

## 当前入口状态

`deploy:local`、`deploy:mac-direct` 和 `deploy-production-server.sh` 都包含迁移及
旧 API 恢复行为，不是 POL-25B 执行器。服务器入口会在构建、备份、迁移、运行时
替换前拒绝冻结配置或已停止的 API。不得先关闭冻结、启动旧 API 或伪造配置以通过此门。

本地维护态激活引擎为 `scripts/ops/maintenance-activation.mjs`，隔离验证入口为
`pnpm verify:pol25b:local`。它不包含生产传输、systemd/SSH/COS/数据库连接实现；
直接执行模块会拒绝，不能作为生产激活命令。#123 的正式控制面适配器、固定信任锚及
现场只读验证仍需在独立范围内实现、审查和授权；在此之前，生产激活保持阻断。不得增加一个跳过迁移的
环境变量来绕过收据、维护态、权限或恢复要求。GitHub deploy workflow 仍只允许手动触发，
PR/main push 只执行非生产 CI。

## 受控激活前置证据

1. 用户明确批准本窗口、目标环境、精确 main SHA、API/Web 激活和失败恢复范围；
   不包含数据归零、迁移、解除冻结、对象写或权限变更。
2. 干净 main checkout 与 origin/main、17 项正式本机收据、merge-head CI 一致。
3. 独立核验 POL-25A 原始 `schema_compatibility_receipt` 的内容及 SHA-256。
   #296 已关闭的旧 SHA 历史回执不能自动成为新候选回执；若需连续绑定，只读兼容核验
   必须显式证明迁移集合、checksum、Schema digest、角色及停写证据未漂移。
4. #122 已完成正式归零并具有可信 terminal marker 与 `zeroing_receipt`，连续绑定
   上游回执、同一冻结候选、数据库身份、逐主键决定及对象版本。隔离 POL-22 ready 不替代它。
5. 当前数据库和私有对象有本窗口有效备份及隔离恢复证据；失败协调恢复方案已批准。
6. 数据库/私有对象写来源继续冻结，API 停止，worker/timer/cron/手工写来源停止。
   维护入口限制与实际运行配置中的 `OPERATIONAL_WRITE_FREEZE_MODE=all`、空 modules
   均可验证；仅有配置文件字面值不足以证明全部写入来源已冻结。

任一证据缺失、过期或漂移均停止，不生成成功激活收据。

## #123 受控入口必须实现的顺序

1. 验证上述授权、上游收据和现场坐标；对迁移集合、Schema digest 和写冻结留存只读快照。
2. 从精确 SHA 构建 API/Web 并校验产物，记录运行时与环境文件摘要；不运行
   `prisma migrate deploy`、Schema/backfill、角色 grant 或任何归零命令。
3. 创建旧 API/Web 运行时快照，维护入口和所有写冻结保持不变；替换同 SHA 产物。
4. 仅按本次激活授权启动新 API，保持冻结 all；不启用 timer/worker，不打开业务流量。
5. 在受控只读连接下核验运行 SHA、liveness/readiness、角色/权限、受控私有文件读取、
   关键只读页面、拒写和失败暂停。再次核验 Schema、迁移 checksum 与写冻结未漂移。
6. 只有全部通过才生成 `runtime_activation_receipt`，绑定两张上游收据 SHA-256、
   精确候选、产物/环境摘要、前后 Schema 坐标、`migrationExecutionCount=0`、
   维护态/写冻结/定时任务状态及脱敏只读核验结果；不得生成 `opening_receipt`。

上述为受控执行契约，不是可直接运行的生产命令或已完成验收声明。

## 本地引擎与隔离验证接口

公开接口为 `activateMaintenanceRuntime(request, trustedAdapter)`。适配器是受信代码，
请求不能传入 shell 命令、URL、运行时路径、公钥或可动态加载的适配器。
当前适配器必须明确声明 `executionScope=isolated-local`；生产 scope 拒绝。
测试生成的收据固定包含 `executionScope=isolated-local`、`productionAccessed=false`，
不得作为 #123 正式收据或 #124 开放证据。

请求绑定环境、部署实例、窗口和精确候选 SHA，并包含以下原始字节及签名证据：

- 原始 POL25A 收据、原生 POL22 执行收据、原始 17 项本机发布收据。
  各自字节 SHA-256 同时绑定在授权与独立证据 envelope 中；不改写或冒充旧收据。
- 独立 Ed25519 授权：仅允许 API/Web 激活和运行时文件恢复，绑定本窗口及
  事先批准的数据库/对象协调恢复方案摘要；拒绝附加迁移、归零和开放授权。
- 另一独立 Ed25519 证据：其签发者必须完整验证原生上游签名、身份、恢复证据与
  权威数据库终态。证据绑定同候选兼容性、POL25A→归零原始收据链、归零执行摘要、
  逐主键候选摘要、对象删除清单摘要、本窗口双类隔离恢复以及 main push CI。
  证据不能由调用者自行给出公钥或用 JSON 内的 `passed` 字样替代独立签发。

两个 envelope 均只含 `payload` 与标准 Base64 编码的64字节 `signature`，对
`JSON.stringify(payload)` 的原始 UTF-8 字节签名。payload 固定 `schemaVersion=1`，
授权 purpose 为 `pol25b_activation_authorization`，证据 purpose 为 `pol25b_upstream_validation`。
原生归零执行摘要直接复用 POL22 的规范化 JSON SHA-256，不按 JSON 字段插入顺序另算。

引擎沿用 `local-release-receipt.mjs` 的原 17 项及耗时校验；另外核对原生归零收据的
`executed=true`、`status=completed`、`codeSha`、内容摘要和通过的 postcheck。
POL25A 没有本模块自行发明的原生 JSON 格式：完整原生验证由独立证据签发者负责。
旧 SHA 历史 POL25A 收据只在当前窗口签发者实际证明连续兼容时可被绑定。

受信适配器接口及职责如下，任何缺失或异常都失败关闭：

| 接口 | 必须实际验证/执行的行为 |
| --- | --- |
| `identity` / `authority` / `now` | 固定部署身份、互不相同的独立信任公钥、受信当前时间；不得从 request 加载 |
| `acquire` | 以固定 deploymentId 获取实例级排他锁，覆盖全部阶段及收据发布；返回释放锁函数 |
| `inspect` | 实际 HEAD/main/clean；实际环境文件摘要；维护入口、有效冻结 all/空 modules、双范围冻结、全部写来源/worker/timer/cron 状态；API 停/运行 SHA；API/Web 实际产物摘要；迁移执行次数；现场数据库身份、迁移集合/checksum、Schema、角色及对象版本摘要。不能仅读配置字面值 |
| `verifyTerminal` | 用受控只读连接查询权威归零终态，返回与独立证据一致的 terminal commit 摘要；不能只读候选文件 |
| `build` | 从干净精确候选构建并验证 API/Web，返回候选及两类产物摘要；不得触发迁移、backfill、grant、归零或远端发布 |
| `snapshot` / `replace` | 安全保存旧 API/Web 文件快照及各自摘要并替换已验证产物；不触及环境/维护入口/写冻结 |
| `start` | 只启动授权的新 API，验证其实际继承已绑定的环境；不启用 timer/worker 或业务入口 |
| `verifyReadOnly` | 实际核验运行 SHA/产物、存活/就绪、角色/权限、受控私有文件、关键只读页面、拒写及失败暂停能力；只返回脱敏结果 |
| `stop` / `restore` | 先确认 API 停止，再恢复旧运行时文件并验证快照；绝不启动旧 API，不恢复数据库/对象 |
| `publish` / `revoke` | 用新路径排他、原子、持久写入收据；只有本次创建且摘要相同的工件才可撤销，绝不覆盖/删除既有或未知工件。隔离适配器在调用publish前创建并保存 `createActivationReceiptStore` 所有权句柄，即使publish及内部清理失败也保留它；受限真实目录、0600临时文件、fsync、原子排他硬链接发布和目录fsync；撤销同时核对inode与完整字节摘要，并必须明确返回 `{revocationConfirmed:true}` |

引擎在构建、快照、替换、启动、只读验收及发布前后反复验证窗口、候选、终态、
Schema/迁移/对象坐标及冻结；启动前再次校验实际产物。失败先停新 API、确认维护冻结，
然后按授权恢复文件快照并撤销本次收据。停机、恢复或撤销失败会明确返回
`ACTIVATION_RECOVERY_FAILED`，不得声称环境已经恢复。异常中的原始命令/凭据不外传。
发布后同步、删除或目录持久化失败时，所有权及待同步状态继续保留；失败结果中的
`receiptRevocationConfirmed=false` 明确表示残留工件可能仍在，不得以文件内 passed 字样认定成功。
文件恢复后还由引擎独立重读实际 API/Web 字节摘要，不能仅凭 restore 返回成功。
最后释放锁属于终态清理；若锁已释放但回调报错，返回 `ACTIVATION_LOCK_RELEASE_UNCERTAIN`，
不在锁所有权不确定时停止/回退下一位持锁者，也不重复释放；已经完成的激活和收据须由
控制面核实，不把此异常报告为自动回滚成功。收据坐标仅输出六个已核验摘要字段。

隔离测试使用临时目录、临时 Ed25519 密钥和合成上游收据；两个进程测试只绑定
`127.0.0.1`，使用合成 API/Web 验证拒写、受控读取、实际停机与文件回退。
这些测试不等同于真实 Nest/PostgreSQL/systemd/COS、正式上游收据或整套发布门验收。
后续生产适配器必须逐项补齐真实只读观测与受信签发，不能复用测试适配器或测试密钥。

## 失败、回退与开放边界

- 激活任一步失败，先停止新 API，保持维护入口及全部写冻结，不自动启动旧 API。
- 可以在批准范围内恢复旧 API/Web 文件快照；旧应用是否兼容最终 Schema 仍须独立证明，
  不得因文件恢复成功即恢复服务。数据库/对象恢复另按批准的协调方案执行。
- 禁止反向删除迁移或复活退休写入口。金额、权限、文件、Schema/收据漂移均维持关闭。
- #124 在新授权下核验完整收据链、解除冻结并正式开放；#123 不替它执行。

权威依据：#296 → #122 → #123 → #124，以及
[生产切换状态机](../specs/2026-08-12-project-operating-ledger-construction-enterprise-takeover-unified-entry.md#262-生产切换状态机)。
