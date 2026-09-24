# #122 独立两文件清理能力：本地开发检查点

## 授权及基线

用户已明确决定删除此前精确定位的两个隔离文件，批准独立清理能力的本地实现与验证，并确认通过独立命令的预检、试运行、执行和后检测试，使用本机 PostgreSQL 16 及隔离对象存储。此检查点不表示已具备生产执行条件。

本地独立候选分支 `codex/pol122-two-orphan-cleanup` 基于只读核验的远端 main `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`。原工作区已有修改保持不动。没有新 Issue、提交、PR、生产命令或生产删除。

## 已实现的首批预检

入口为 `sh services/api/scripts/run-business-zeroing-cli.sh isolated-file-cleanup inspect`，输入 scope、既有来源报告及可选 backup-receipt 路径。直接 Node 启动返回 TRUSTED_LAUNCHER_REQUIRED。当前是未交付的只读开发入口，所有路径仍输出 blocked；没有 ready、试运行、执行或后检能力，不可用于生产删除。

- 严格两条不同 UUID + 完整行哈希，不接受额外目标字段或前缀。
- 来源报告按去除 reportSha256 后的规范化 JSON 验证，并核对 scope 的报告摘要与精确两个 ORPHAN_FILE 主键；不将原 POL-22 blocked 报告改写为 ready。
- 在真实 READ ONLY / REPEATABLE READ 事务中绑定数据库身份，检查目标存在、quarantined 状态及完整行哈希；检查文件替代关系、登记的业务绑定和数据库/逻辑外键。引用覆盖不全时失败关闭。
- 精确匹配归档关联失败审计的 action、businessType、businessId、metadata.fileId、reason 和 actor/uploader。
- 将当前 Schema 摘要、迁移头及数量与来源报告精确比较；其他 FileObject 共用目标 bucket/objectKey 时阻断，不允许对象删除连带影响非目标记录。
- 独立预检复用 #301 的 CONDITIONAL_FILE_DELETE_GUARDS 固定定义，对两个 FileObject 删除守卫的数量、名称、启用状态、函数身份及双定义摘要逐项核验。来源报告即使绑定异常 Schema，也不能绕过缺失/禁用/未知守卫。此处仍不是带对象快照的最终锁内删除证明。
- 复用既有备份收据及真实工件验证：PG custom-format、tar、字节摘要、恢复证据、迁移坐标、时间顺序；本地私有对象逐项匹配已恢复备份的内容 SHA 与大小。
- 输出只含脱敏状态码，无文件标识、对象键、业务内容或连接秘密。
- 复用既有受信启动器 capability，新入口和数据库适配器登记进 EXECUTION_FILES；CLI 进程测试验证直接启动被拒绝、正式启动器可调度，以及 NODE_OPTIONS 预加载在执行前被拒绝。这里只完成启动边界与指纹清单登记，尚未调用完整执行身份/授权校验，不宣称获得执行资格。
- 输入 JSON 通过 O_NOFOLLOW / O_NONBLOCK 打开，只接受普通文件；单文件最多 16 MiB，按初始大小有界读取并比较读取前后大小及修改时间。CLI 符号链接与过大文件阻断均已 RED→GREEN。此项不替代尚待实现的固定信任锚及授权签名。

## 独立处置签名（不是最终执行授权）

可选 `--scope-authorization` 读取 Ed25519 工件。只使用既有固定路径 `/etc/jiangkong/pol22-zeroing-authorization-public-key.pem` 的 root 持有、组和其他用户不可写公钥，不接受调用者公钥路径覆盖。外壳严格为 schemaVersion、algorithm、payload（严格 Base64 原字节）和 signature。

已签名 payload 严格包含 schemaVersion=1、purpose=`isolated-orphan-file-disposition-v1`、authorizationRef、issuer、environment、databaseFingerprint、sourceReportSha256、scopeSha256、issuedAt、expiresAt。scope 摘要包含两个文件及完整行哈希；用途、环境、数据库、报告、范围或时间不匹配均阻断。此类处置决定不伪装成测试来源证明，原 POL-22 的测试来源规则完全保留。

处置签名验证通过后，在连接数据库前复用 readTrustedExecutionIdentity，校验固定 root 文件、实际 UID/用户名，并与签名所绑定来源报告的环境、执行主体、部署身份摘要比较。缺失或漂移返回 EXECUTION_IDENTITY_INVALID。随后 currentCodeIdentity 核验干净仓库、实际 Node/依赖/构建字节，并将 codeSha、executionCodeSha256 与已签名来源逐项比较；读取失败为 EXECUTION_CODE_IDENTITY_INVALID，不匹配为 EXECUTION_CODE_BINDING_FAILED。签名、身份和代码均通过仍不能 ready：精确对象/备份/批次、外部写冻结及最终执行授权尚未完成。缺失签名仍 AUTHORIZATION_REQUIRED；带有效处置签名也最多到 EXECUTION_AUTHORIZATION_REQUIRED。签名和身份必须在未来写入前及每步关键重验时再次校验，不得缓存本次检查作为未来授权。

## 本地验证

### 恢复库完整行的只读证明

独立命令支持专用环境变量 `ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL`，不通过命令行传递或输出连接信息。未提供时仍保留 DATABASE_RESTORE_ROW_PROOF_REQUIRED；提供后必须完成实际 READ ONLY / REPEATABLE READ 核验，不能仅凭备份收据自报通过。源库和恢复库均设置语句/锁等待上限。

恢复连接先读取实际 cluster system identifier、数据库名与 Schema。与源库同 cluster 且同数据库名即 RESTORE_DATABASE_NOT_ISOLATED（不靠 URL、主机别名或用户名差异判断隔离）；恢复库名称必须与备份收据 databaseBackup.restoreTarget 精确相同，Schema 必须相同、session_replication_role 必须为 origin。此次只支持精确数据库名式 restoreTarget，不猜测其他标签含义。

复用正式清单读取恢复库，核对 Schema 摘要/迁移头/数量、两条目标完整 rowSha256；对所有其他表及非目标 FileObject，逐表/主键绑定完整 rowSha256 汇总后与源库同一只读事务的清单比较。目标或保留记录即使数量不变、内容被替换也会分别 RESTORE_TARGET_ROW_MISMATCH / RESTORE_RETAINED_ROWS_MISMATCH。目标名称或 Schema 漂移同样失败关闭。

核验通过仅在独立受限回执记录 databaseRestoreProof（备份收据摘要、恢复库指纹、目标/保留行摘要及观测时间），解除这一项缺口，不解除其他 blocker。此为所连接恢复库的当前行内容一致性证明，不替代官方备份工件/实际恢复过程的来源证明，也不是未来执行时的锁内复验或生产权限。本轮仅连接测试自身创建的本机 PG16 数据库；未连接生产或其他既有数据库。

该能力经真实 CLI RED→GREEN，覆盖完整恢复正向、源库冒充、恢复名称不符、目标行同数量内容替换、保留审计同数量内容替换和恢复 Schema 漂移。最新五文件组合回归 170/170（含真实 PG16），三个触及 CJS lint 和 diff 检查通过；临时容器及合成数据已清理，开发候选未提交。

### 受限的独立核验回执（不是执行就绪报告）

`inspect --output <绝对新路径>` 在数据库目标、备份工件和对象快照核验全部完成后，输出 `mode=isolated_file_cleanup_inspection` 的独立检查点。包含来源报告摘要、精确两目标行哈希/作用域摘要、观测数据库/Schema/迁移坐标、备份及版本恢复收据摘要、实际对象快照及其摘要；仅在确实校验过时填入执行身份/代码身份、处置签名和冻结租约摘要，否则为 null。标准输出仍仅为脱敏状态，不打印对象键、目标主键或连接秘密。

输出只接受当前执行账号持有且组/其他用户无访问权限的目录；文件以 O_EXCL/O_NOFOLLOW、0600 新建，完整写入后 fsync 文件及目录。拒绝已有文件和符号链接，不覆盖原来源或备份收据。前置核验失败时不生成这份完整检查点；落盘异常输出 OUTPUT_REJECTED，可能残留的部分文件不得当成成功回执或自动覆盖重试。

回执始终 `status=blocked, executed=false, eligibleForExecution=false`，并显式列出未通过的处置授权、批次/冻结、数据库恢复完整行证明、最终执行授权和执行/后检能力。它不是 POL-22 ready 报告，不可作为删除入口；未来执行门必须重新核验完整证据，不得靠报告哈希存在跳过任一 blocker。报告 SHA-256 仅用于内容完整性绑定，并非签名或新增授权。

真实 PG16 与隔离本地对象存储的回执写入已 RED→GREEN；额外覆盖 0600、完整字段、输出脱敏、禁止覆盖、符号链接、非私有目录和前置检查不完整时不落完整回执。当前五文件组合回归 164/164 通过，两个触及 CJS lint 和 diff 检查通过；临时容器及合成数据库/对象已清理。这仍不是完整 release:local 或生产可执行证明。

### 独立批次的双范围写冻结预检

独立 `inspect` 增加可选 `--batch-id`（3–80 个字母/数字/点/下划线/连字符，首位字母或数字）。带批次时必须提供有效处置签名、执行身份及代码绑定，然后在连接数据库前核验固定路径 `/etc/jiangkong/pol22-zeroing-write-freeze-public-key.pem` 和 `/etc/jiangkong/pol22-zeroing-write-freeze-lease.json`。公钥必须匹配固定执行身份中的 DER SHA-256，两个工件都沿用 root 持有、组和其他用户不可写规则；不接受命令行公钥或租约覆盖路径。

复用固定信任锚但不复用原 POL-22 租约用途。独立 Ed25519 租约外壳严格为 algorithm/payload/schemaVersion/signature；payload 严格为：`batchId, codeSha, databaseFingerprint, deploymentIdentitySha256, environment, executionCodeSha256, executorIdentity, expiresAt, fenceToken, generation, issuedAt, issuer, leaseId, purpose, revokedAt, schemaVersion, scopeSha256, scopes, sourceReportSha256, status`。purpose 固定 `isolated-orphan-file-write-freeze-v1`，schemaVersion=1、status=active、revokedAt=null、generation 为正安全整数、fenceToken 为 64 位十六进制；scopes 必须精确覆盖 `database_business_writes` 和 `private_object_writes`。

租约绑定精确批次、来源报告、两条行指纹作用域、实际代码/运行时及数据库/部署/执行主体。时间必须为规范 ISO，当前已生效且未过期，租约到期不得晚于处置授权；用途、签名、范围或身份任一漂移均 WRITE_FREEZE_INVALID。每次校验重新读取固定材料，不将一次验签缓存成后续写权限。未带批次的只读调查路径仍不能 ready 或执行；带批次且验签成功也只继续只读预检。

此项仅为预检的冻结证明入口，不代表生产已经实际停写，不是最终执行授权，也尚未实现执行中续验、代际/令牌防重放、部分失败恢复或后检。最终执行报告/授权仍必须绑定该租约摘要与代际并在关键步骤重新核验。未修改原 POL-22 验证器、生产信任材料或权限。隔离 CLI 覆盖有效租约正向，以及缺租约、单范围、其他用途、过期/未生效/超窗口、撤销、错误签发密钥、字段/身份漂移和可写信任材料等反例。

本轮先观察到批次参数尚不支持导致的 RED，再接入冻结校验并完成正向/反向回归。当前五文件标准组合回归 159/159（含真实 PG16），四个触及 CJS lint 与 diff 检查通过；一次性容器及合成数据已由测试清理。此结果不是完整 release:local，也未证明尚未实现的试运行/执行/后检。

### 当前代码绑定及完整局部回归

代码身份正向夹具使用一次性独立 Git 仓库：复制实际脚本、Schema、构建产物及锁文件，在夹具内创建真实提交；依赖只读复用现有候选，不复制 780 MiB node_modules、不修改开发候选 Git 状态。隔离 Node 容器无网络、只读根/仓库/依赖，固定信任材料仅在 tmpfs；进程级 safe.directory 精确为夹具挂载点，不写主机 Git 配置。合成签名只绑定该夹具实际观测的身份，不作为发布证明。

通过真实独立 CLI 验证干净仓库正向进入数据库配置门；已签名来源的 SHA/运行时指纹错配先 RED 后 GREEN，签名后 tracked 文件改动及 Git 忽略的 dist 改动也被拒绝。本轮五文件标准组合回归 133/133（含真实 PG16）、API typecheck/lint、两个触及 CJS lint 和 diff 检查通过。测试容器与临时 Git/对象夹具均已清理；未接入或操作生产。

授权夹具需要本地镜像 `jiangkong/pol122-local-runtime:node20-git`，由 `services/api/scripts/fixtures/isolated-cleanup-runtime.Dockerfile` 构建。基础 Node 镜像固定 digest `2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`；本次构建镜像 ID `fcfec609684088850001661d122df9a1fcce708c80fa8febf1551809c2925fb4`，测试启动前查询并固定 ID。构建时仅安装 Git，业务测试阶段 network=none。镜像缓存保留供复用，不构成生产制品；缺失镜像时报环境失败，不自动换镜像或联网安装。

本地准备命令（非生产）：

```sh
docker build -t jiangkong/pol122-local-runtime:node20-git \
  -f services/api/scripts/fixtures/isolated-cleanup-runtime.Dockerfile \
  services/api/scripts/fixtures
```

### 代码身份门增补

有效处置签名及执行身份通过后，独立 CLI 在数据库连接前调用既有 `currentCodeIdentity`，核验干净 checkout 和执行代码/运行时指纹；读取失败统一脱敏为 `EXECUTION_CODE_IDENTITY_INVALID`。本轮真实隔离容器没有可核验的仓库身份，用例先观察到旧行为继续到数据库配置门，再完成 RED→GREEN。非 PG 组合工具回归 109/109、两个改动 CJS lint、`git diff --check` 通过，自有测试容器已清理。

此项仅建立身份读取拒绝边界，尚未验证冻结候选正向路径，也尚未将所得指纹绑定最终执行授权；所有路径仍 blocked。未为了通过干净状态检查而提交代码，未伪造仓库或运行时身份。本轮未重跑 PG16，下面的 128/128 为此前本地状态的历史结果，不作为新候选完整门禁证据。

### 全版本离线证据校验

独立 inspect 增加成对参数 `--version-backup-root` / `--version-restore-root`，按现有 POL-25A `private-object-backup-manifest.json` 与 `private-object-backup-receipt.json` 格式读取，不访问 COS、不生成或恢复新文件。校验收据规范化摘要、清单原始字节摘要、来源报告的候选 SHA、时间顺序、记录/对象/版本/删除标记计数、目标文件一对一覆盖。逐版本流式计算备份与已恢复 blob 的内容哈希/大小，并拒绝符号链接、路径越界名称、同目录或同 inode 硬链接冒充独立恢复。

离线工件通过后，独立预检已将目标文件主键对应的 bucket、objectKey、唯一 storageStatus、最新版本大小及数据库非空 contentSha256 与当前 READ ONLY 事务所得 FileObject 核对；不匹配返回 VERSION_BACKUP_BINDING_FAILED。真实 PG16 覆盖坐标/状态/大小/哈希错配及完全匹配仍停在授权门。

离线清单无法自行证明没有遗漏远端版本。2026-09-23 已增加真实签名 HTTPS 枚举结果与全版本清单的逐项集合绑定，并在断网合成服务验证；缺少全版本证据仍 `COS_BACKUP_COVERAGE_UNPROVEN`，实时集合不一致为 `COS_VERSION_BACKUP_MISMATCH`。这不是生产 COS 证明或删除就绪：分页异常/有界传输、最终执行授权和执行时锁内重验仍须完成。恢复库完整目标行及其他保留行的只读证明已增补。

使用 Node 20.20.2、pnpm 9.15.9。新测试从真实进程调用独立 CLI，不使用内部方法 mock。

已完成多轮 RED→GREEN，包括目标扩大、重复、指纹缺失、来源篡改、非隔离状态、替代关系、业务 PDF 引用、审计缺失、备份缺失。规范化 JSON 键顺序/缩进变化不会被误认作文件字节摘要漂移。

隔离 PG16 测试运行完整候选迁移，在一次性容器产生真实 custom dump，恢复到同容器另一数据库，并核对恢复的文件/审计数量；私有合成文件打包并恢复到独立目录后逐个核验摘要。Docker 绑定已验证的本机 socket 和现有镜像 ID，拒绝继承数据库目标变量；随机数据库凭据不输出，测试结束清理自身容器和临时备份/对象目录。

最近标准命令组合测试：既有 business-zeroing-tool 测试 72 项，加新 CLI/PG/授权容器/离线备份 56 项（含父测试计数），合计 128/128 通过；这是局部工具回归，不是完整 release:local。八个新增 CJS 的 eslint 通过。硬链接伪造独立恢复、完整备份错配数据库对象键均经 RED→GREEN 验证；其他坐标/状态/大小/哈希错配、历史版本缺失和损坏均经 CLI 核验。此前 --test-concurrency=1 被既有 Node 运行时保护正确拒绝，未放宽保护，已恢复标准命令。共享 business-zeroing-cli.cjs 的额外直接 lint 有 11 项错误，与 HEAD 基线一致。API build 为增补前的通过结果，不作为最终候选发布证明。

本轮 Docker 短标签 postgres:16 读取失败，但既有镜像 ID 与完整名称 docker.io/library/postgres:16 均解析为 a3b7f434b2dc57ce85a67e171163eb8ab1a1ebcb39d27484661f26b1dfbe30d6；测试改用完整名称查询，再固定 ID 启动。未下载或切换镜像版本。初次环境失败不计入业务 RED，后续确实观察到缺失守卫校验的断言失败才进行实现。

授权正反向测试通过真实受信 CLI 在一次性 Node 20.20.2 Linux 容器执行：network=none、只读根文件系统、cap-drop=ALL、只读脚本/合成夹具挂载、固定信任目录仅为容器 tmpfs。公钥在容器内复制为 root 文件，私钥仅在测试进程内存中生成及签名，不落盘。不安装本机或生产信任材料。用实际镜像 ID 固定本次运行；本轮为测试拉取了 node:20.20.2-bookworm-slim 镜像，其缓存保留供后续复用。

## 必须继续实现，不可跳过

### 2026-09-23 隔离 Linux 与 PG16 联通夹具

本地 Node 运行时镜像增加 Prisma 5.22.0 的 Linux arm64 OpenSSL 3 原生引擎；探针 Schema 仅用于提取引擎，不替换应用生成客户端、不连接数据库、不参与迁移。镜像 ID 为 `sha256:a4fc0672cbed5d290e2fac479e17d7f7489b8c43283d20ae582146f594c6c762`，测试启动前解析并固定实际 ID。

新增真实 CLI 子测试将合成 custom dump 恢复到第二个一次性 PG16 容器，运行时共享其 `network=none` 网络命名空间，使用实际应用 Prisma 客户端及数据库适配器。初次失败已定位为单库 dump 不包含集群角色，恢复时缺少 `jg_pol275_owner`；仅在隔离实例补齐候选迁移定义的五个无登录、无高权限、NOINHERIT 角色，不采用 `--no-owner` 或跳过 ACL。角色名及全部危险属性均显式断言。TCP 就绪探针防止将初始化临时 Unix socket 服务误认为最终实例。

修复后新增子测试通过：真实 CLI 查询恢复库后返回 `BACKUP_RECEIPT_REQUIRED`，仍为 blocked/executed=false。PG16 单独回归 31/31；授权、备份、独立 CLI、PG16 与原 business-zeroing-tool 组合回归 171/171（退出 0，约 74.3 秒），API typecheck/lint、本轮 PG 测试 CJS lint 和 diff 检查通过。该测试不是 COS 联通、最终授权或删除执行的证明。本轮未访问生产、未修改生产角色或权限、未进入 #123/#124。

### 2026-09-23 实时版本集合与单次请求

在同一断网 Linux/PG16 夹具增加 HTTPS 对象服务，域名只在该容器的只读 hosts 映射到 loopback。临时自签证书经 `NODE_EXTRA_CA_CERTS` 明确受信，不关闭 TLS 校验、不改变宿主 DNS 或信任材料；凭据由本地测试生成。服务独立验证实际请求的 HMAC 签名和精确对象前缀，不导入应用内部适配器；仅合成服务状态可变，网络命名空间不能访问外部 COS。

独立 CLI 将已核验的备份/恢复清单与真实版本枚举作完整集合比对：版本 ID、删除标记、最新标记、修改时间和数据版本大小逐项相同才进入后续门。旧/当前版本及删除标记均覆盖，返回顺序不影响结果。缺失旧版本或删除标记、多出未备份版本、同数量身份替换、大小/时间/最新标记漂移、重复版本身份均阻断，且不继续访问第二个对象。

最初正向用例确认旧实现返回 `COS_BACKUP_COVERAGE_UNPROVEN`，新增绑定后通过；503 反例确认原适配器进行了 3 次请求。独立入口使用真实 `CosVersionedObjectStorage` 配合单次重试参数，修复后一次失败立即返回 `OBJECT_SNAPSHOT_FAILED`，不访问第二对象。仅该 CLI 进程关闭库诊断日志以保持脱敏 JSON 输出；原 POL-22 适配器、默认重试、Schema 和权限未修改。合成 tar 仅排除 macOS xattr，避免跨平台归档警告；不忽略验证错误。

本轮授权、备份、独立 CLI、PG16 与原 business-zeroing-tool 组合回归 182/182（退出 0，约 91.5 秒），API typecheck/lint、三个本轮 CJS lint 和 diff 检查通过。该证据仍不构成生产版本枚举或可执行授权。分页异常/有界传输尚待验证，最终授权、执行中重验、持久恢复与后检继续保持未完成。

### 2026-09-23 分页与有界传输增补

真实 CLI 先观察到缺少 `IsTruncated` 的响应被当作完整版本集合并进入授权门。独立入口现通过真实 `fetch` 包装器限制同一 HTTPS 主机、GET 枚举、禁止重定向、每页显式唯一 true/false 完成标记及截断时双游标；重复请求 URL 不发送第二次。保留原签名和存储适配器，不更改原 POL-22 默认传输行为。

保守资源上限为单请求（含读取响应体）10 秒、整轮 60 秒、单页 2 MiB、累计 16 MiB、最多 1000 请求；超出即 blocked，不截断后继续，不将部分响应作为证据。该实现不是通用 XML 解析器，也不代表最终执行授权或生产网络验收。

响应体挂起反例暴露：定时器已经触发，但仅调用 AbortController 没有使该运行时的待读取结束。脱敏阶段标记确认没有进入 finally，故改为 fetch/read 同时受超时 Promise 约束，并取消流读取；清理不再无限等待 cancel Promise。临时调试标记及测试过滤已移除。最终组合回归 190/190（退出 0，约 112.9 秒），响应体挂起在约 11.5 秒内由 CLI 自行返回 blocked，未靠外层 45 秒超时杀进程。API typecheck/lint、三个本轮 CJS lint 和 diff 检查通过。总页数/累计字节/总时长上限已有实现，本轮动态反例直接覆盖单页大小、单请求响应体超时及游标循环，不把它们夸大为各总量阈值的边界测试。

### 2026-09-23 最终授权绑定增补（仍不可执行）

独立 inspect 新增成对参数 `--inspection-report` 与 `--execution-authorization`，必须同时带精确批次、处置授权和固定冻结租约。执行授权仅从既有 root-only 固定授权公钥验证严格 Ed25519 envelope，独立用途为 `isolated-orphan-file-execution-v1`；不新增信任锚、不安装材料、不提供生产私钥或签发工具。处置同意 envelope 不能直接充当执行授权。

payload 精确绑定来源/检查点报告、scope、环境/数据库/代码/运行时/部署/执行主体、批次、数据库备份及全版本备份回执、数据库恢复证明、对象快照集合、处置 envelope、冻结 envelope、fenceToken 与 generation，另含 schemaVersion/purpose/authorizationRef/issuer/issuedAt/expiresAt。时间不能早于检查点生成、晚于当前时刻生效或超出处置/冻结窗口；多字段、换签发密钥、身份或摘要漂移全部拒绝。

检查点必须自身摘要正确、精确两个目标及对象、恢复证明存在、没有遗留事实 blocker（只允许当前两个执行阶段 blocker），并与当前验证出的处置/冻结/代码身份一致。真实数据复验代码还比较 Schema/迁移、备份回执、对象集合及恢复证明稳定字段；只有 `verifiedAt` 这种重验时间不作为数据漂移。任何不一致为 `APPROVED_INSPECTION_DRIFT`。即使全部通过仍输出 `EXECUTION_AND_POSTCHECK_NOT_IMPLEMENTED`、executed=false、eligibleForExecution=false，未开放 execute。

本轮新增正向及 32 项反向测试，通过真实受信 CLI、一次性干净 Git 夹具和固定容器信任锚运行。授权单独回归 81/81，标准五文件组合回归 223/223（退出 0，约 117 秒），API typecheck/lint、三个触及 CJS lint 和 diff 检查通过。检查点是明确标注的合成签名材料，正向只进入 `DATABASE_NOT_CONFIGURED`：它证明密码学/绑定入口，不是数据库、备份或执行证明。授权与真实 PG16/COS 复验的贯通、执行中持续重验、持久恢复及后检仍须完成，不以这一测试替代完整验收。

### 2026-09-23 恢复证明精确目标绑定补强

在已批准的真实独立 CLI seam 增加反例：恢复证明的 `targetRowsSha256` 指向另一组记录，并同步重算检查点及重新签发有效执行签名。原实现只核验该字段为摘要格式，反例失败；现要求其等于 scope 内两个精确完整行目标的摘要，在数据库连接前阻断自相矛盾的证明。正常夹具同步使用这两个目标的实际摘要，不放宽后续真实数据库复验。

此项仍是授权入口的合成检查点测试，不代表已完成真实生成检查点与 PG16/COS 贯通。预检/试运行/执行/后检整体能力仍未完成，独立工具继续保持 blocked，不执行生产操作。

验证：Node 20.20.2 标准五文件组合回归 224/224，退出 0，117.1 秒；API typecheck/lint、两个修改 CJS 的 ESLint 及 diff 检查通过。初次 RED 的宿主测试调度为 Node 22.23.0，实际授权 CLI 始终运行在既有隔离 Node 20 容器；最终组合已统一宿主 Node 20.20.2。开发候选保持未提交，不作为精确发布 SHA 证据。

### 2026-09-23 最终授权与真实检查点贯通

新增隔离测试夹具 `fixtures/isolated-cleanup-authorized-inspect-fixture.cjs`，从真实 custom dump 恢复第二个 PG16 数据库。对一次性干净 Git 仓库的真实代码/运行时身份签发合成处置授权和双范围冻结租约，使用官方独立 CLI 生成检查点后，再签发绑定该检查点的最终授权。私钥仅在测试进程内存中生成，固定信任材料仅安装到无外网容器 tmpfs；不安装本机或生产信任材料，不提交开发候选。

贯通场景已通过：签名后重新检查原库、恢复库、备份字节、独立恢复字节和真实 HTTPS 版本集合；保持事实不变可继续只读核验，但明确保留 `EXECUTION_AND_POSTCHECK_NOT_IMPLEMENTED`，不产生 ready 或删除权限。

以下反例通过真实 CLI 验证：

- 同时替换 HTTPS 返回的旧版本身份及离线备份清单/收据，新事实可独立通过预检，但旧检查点授权返回 `APPROVED_INSPECTION_DRIFT`。
- 在源库和恢复库同步修改同一条保留审计的 metadata，数量与两库内容仍一致，新恢复证明可通过，但旧授权因保留行摘要改变而拒绝。
- 有旧签名恢复证明但不再提供本次恢复库连接，不能跳过实时复验。
- 测试夹具撤销上述合成改动后，原检查点再次只读核验通过，仍不开放执行。

这证明现有最终授权与真实复验路径已贯通，不证明备份恢复过程的生产因果链、执行中持续重验或跨数据库/对象部分失败恢复。仍须实现试运行、持久恢复计划、精确执行、独立后检并完成正式发布门。本轮未修改独立工具或原 POL-22 的生产逻辑，只增加集成证据。

本轮重新读取 origin/main 与 GitHub：main 仍为 `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`，开放票为 #93/#122/#123/#124；#122 验收和生产授权边界未变，无 GitHub 写入。

验证：正向贯通首轮 PG16 文件 52/52；补齐漂移反例后，Node 20.20.2 标准五文件组合 230/230、退出 0、141.1 秒；API typecheck/lint、两个本轮 CJS ESLint、diff 检查通过。此为未提交工作树的本地集成证据，不是全部正式发布门或固定 SHA 交付收据。

### 2026-09-23 独立试运行与精确计划

独立入口新增 `dry-run`，要求已有签名检查点、对应执行授权、批次、处置授权及独立 `--output`。沿用 inspect 的全部当前事实核验与检查点漂移比较；不执行删除、业务写入或对象变更。无授权、无输出、事实漂移或输出路径不安全均失败关闭，`execute` 仍不可调用。

计划模式为 `isolated_file_cleanup_dry_run`，正文 `status=verified`、`executed=false`、`eligibleForExecution=false`，明确保留 `EXECUTION_AND_POSTCHECK_NOT_IMPLEMENTED`。每项计划只含一个 FileObject 精确主键/完整行哈希及其精确 bucket/key/完整版本快照；恢复描述绑定数据库备份摘要与位置、恢复库身份、保留行摘要、私有文件备份/恢复位置、全版本备份收据和清单摘要及独立恢复目录。无通配符、扩大范围或自动恢复指令。全部标识只进入受限报告，不在 stdout 展示。

报告复用 0700 父目录、0600 文件、O_EXCL/O_NOFOLLOW、文件和目录 fsync 约束；这里的“不可覆盖”指工具拒绝覆盖已有报告，不声称 root 无法改写文件。stdout 成功只返回 `dry_run_verified/DRY_RUN_VERIFIED/executed=false`，不返回执行 ready。计划摘要还须由后续执行授权/恢复日志消费；本轮没有假定计划自带执行权，持久化部分失败日志与协调恢复执行器仍未实现。

TDD 先由真实 CLI 的参数测试和 PG16 贯通测试观察到 `COMMAND_NOT_AVAILABLE`，再实现试运行。验证计划需要在试运行之后重新调用公开 inspect，证明目标完整行、保留行及对象快照仍与原检查点一致；另覆盖旧版本与备份同时变化时不得输出计划、拒绝覆盖/符号链接/公开目录。

本轮验证：Node 20.20.2 标准五文件组合 233/233、退出 0、160.3 秒；API typecheck/lint、三个本轮 CJS ESLint 及 diff 检查通过。试运行尚不是完整执行验收：完成前/执行中对授权时效、固定冻结租约与事实的持续重验、执行绑定及耐久恢复日志仍必须补齐。没有生产 SSH/数据库/COS 操作，没有 GitHub 写入，候选未提交。

### 2026-09-23 发布检查点/试运行计划前的授权复核

真实 HTTPS 协调反例发现：CLI 已在入口验证冻结租约，随后等待最后一个对象响应时，测试控制端将容器内固定租约签名撤销；旧实现仍返回试运行成功（退出 0，而反例要求退出 2）。该 RED 只涉及隔离容器合成材料，没有生产操作。

现于当前事实与检查点比较之后、报告/计划发布之前，重新读取 scope/来源、处置签名、固定执行身份、实际代码/运行时指纹、固定冻结租约、检查点与执行授权，并再次执行有效期和签名验证。新读结果必须与入口完全一致；即使是另一份有效签名或更高租约代际，也不能沿用本次处理中旧的授权上下文。变化统一输出 `AUTHORITY_CHANGED_DURING_INSPECTION`，不发布报告或计划。

测试的 HTTPS 服务只用 `/tmp` ready/release 信号暂停最后一个响应，不读取或修改应用信任材料；测试控制端另行更新容器内真实固定材料后释放响应。业务数据库、查询适配器、签名验证器和存储适配器均未 mock。覆盖租约撤销、有效新代际、部署身份改变、执行授权在处理中到期、替换有效执行授权、替换有效处置授权，并验证控制面夹具恢复后能再次只读核验。

这是一次完成前授权复核，不宣称数据库/COS/文件系统间原子快照或连续写冻结已经由代码证明。执行期间的每步锁内重验、事实并发变化、耐久日志与恢复、计划执行绑定及最终后检仍未完成；执行入口仍不可用。

本轮验证：先观察到撤销租约反例仍退出 0，再修复；Node 20.20.2 标准五文件组合 240/240、退出 0、191.7 秒，API typecheck/lint、三个本轮 CJS ESLint 及 diff 检查通过。origin/main 本轮只读核验仍为 `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`；工作树未提交，未形成发布 SHA 证据，未访问生产。

### 2026-09-22 全树实时复核（历史明细续）

2026-09-23 本轮仅读取 GitHub/远端引用再次确认：main 仍为 `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`，开放票仍为 #93/#122/#123/#124；没有远端写入，也没有将历史生产回执当作实时验证。

- `git ls-remote origin refs/heads/main` 仍为本候选基线 `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`。GitHub 当前仅 #93、#122、#123、#124 为 OPEN。
- [#301 最终回执](https://github.com/1131096740/intelligent-construction-management/issues/301#issuecomment-5776059724) 已 CLOSED；PR #302 已 MERGED。候选 CI 35720628352 与合并 CI 35722385725 的实时状态均 completed/success，headSha 分别为 a1c2b48c… 与 56fd5243…。不再按过期账本调度 #301。
- [#296 最终回执](https://github.com/1131096740/intelligent-construction-management/issues/296#issuecomment-5750811887) 已 CLOSED，但历史回执绑定 2ca8d507…；这不是当前工具 SHA 的自动通过证据。本次仅读取 GitHub 回执，未连接生产复验。
- #122 仍要求保留闭包、逐主键决定/测试来源、本窗口备份恢复、固定身份与双 scope 冻结，以及 inspect→dry-run→精确 apply→postcheck。独立两文件清理即使完成，也不等于 #122 整体完成。
- #123 明确要求 #296/#122 同 SHA 连续收据、同 SHA 部署、零迁移、保持维护态；#124 还要求单独开放授权、真实第一笔业务及四岗位代表验收。本地 110 项工具测试不覆盖这些运行验收。
- 后续冻结新工具 SHA 时必须核验兼容回执与新 SHA 的证据连续性，不能改写历史回执或把旧成功自动复制到新候选；本轮不重签、不迁移、不部署。

### 剩余实现顺序

2026-09-23 协调器增量及工具审核停点：新增 `isolated-file-cleanup-execution.cjs`，将数据库意图/提交结果、各精确版本的对象意图/确认、最终数据库审计和独立后检组合；失败区分 not_started/committed/unknown，不自动重试，操作坐标仅进私有日志。数据库模块增加完成审计同事务验证，并要求数据库后检审计 action/state 对应 database_deleted/completed。模块登记进入执行代码指纹，但尚无公开调用、无新路径动态证据。

尝试将上述模块接入实际 CLI 的 apply_patch 被安全审核拒绝：接入后同一入口可指向真实数据库及 COS，当前明确授权范围仅为本机合成环境。该拒绝补丁未应用，已检索确认 CLI 不含 runCleanup/executeCleanup 接线；不通过其他方式绕过。后续需要明确批准实际删除能力的 CLI 代码接线（不等于任何生产运行授权），或经用户确定强制隔离的实现边界，再继续公开端到端验证。本轮不宣称现有 RED 已转 GREEN。

2026-09-23 执行器代码增量（未接线、未动态验证新增路径）：

- `deleteTargetsTransaction` 在事务外取得锁表名称，避免串行化数据快照早于锁；进入事务先按稳定顺序锁 public 普通/分区表，再复用精确目标核验，比较计划中的数据库/Schema/迁移及全部保留行摘要，拒绝已有同批次独立审计。每条删除前重验授权和完整行指纹，删除数量必须为 1；两条删除与独立 `AuditLog` 事件同事务，提交前复验保留行（仅排除本次新审计）和授权。提交网络错误仍必须由未来协调器作为未知结果处理，不能自动当作回滚重试。
- `verifyDeletedDatabase` 在 READ ONLY / RepeatableRead 下验证目标缺失、Schema/引用完整性，以及精确已知审计指纹和其余记录不变；它只是数据库阶段证明，尚不是对象完成或权威终态证明。
- `readJournal` / `appendJournal` 校验私有目录与文件、计划摘要、顺序号和前项哈希链，限制 prepared → database_intent → database_deleted → object_intent/object_deleted → completed 或失败状态；新事件排他写入并 fsync，禁止覆盖及跳过已有终态。

上述新函数尚未被 CLI 调用，不宣称已完成真实删除。PG16 本轮仍 61 pass/5 fail（同一个执行未实现叶子及其父套件）、201.8 秒；抽取共用事务核验后的只读检查未出现新失败。三文件回归 93/93、两个模块 ESLint 和 diff 检查通过；新增日志追加与删除函数未被本轮端到端覆盖。下一步必须接实际协调器、每版本对象意图/确认、权威完成审计与独立后检，而不是继续扩大准备通过的结论。

2026-09-23 完整执行契约进入 RED：既有实际 CLI 用例不再把 `EXECUTION_AND_POSTCHECK_NOT_IMPLEMENTED` 当作正向终点，改为要求 `execute` 返回 completed/EXECUTION_COMPLETED、独立 `postcheck` 返回 completed/POSTCHECK_PASSED、再次 execute 拒绝已有批次、再 inspect 看到目标已不存在。隔离 HTTPS 夹具增加显式 `deleteEnabled` 开关、真实签名核验、精确对象/版本白名单 DELETE 和删除后枚举状态；正向用例要求恰好六个已批准版本的 DELETE。没有开放生产存储或修改实际删除实现。

真实 PG16 本次确实在 `execute` 处 RED：实际退出 2，JSON 为 blocked/EXECUTION_AND_POSTCHECK_NOT_IMPLEMENTED/executed=false，期望退出 0；总计 66 项、61 pass、5 fail（同一叶子失败及其四层父套件），201.1 秒、退出 1。后检和 DELETE 次数断言尚未到达，不能宣称这两项已被动态验证。两个修改夹具 lint 和 diff 检查通过。后续保持此完成契约并实现 GREEN，不再把只写准备日志当作完成。

2026-09-23 准备链反例补证：通过真实独立 CLI / PG16 / 隔离 HTTPS 增加四项断言：修改精确行指纹并重新签署计划仍因当前事实不符而阻断；非固定信任锚的签名阻断；签名绑定另一日志目录阻断；日志根目录 0755 阻断。每次失败均检查批次目录不存在，随后恢复有效输入，正常准备、重复批次阻断及公开 inspect 不变性仍通过。没有改动生产实现或放宽门禁；这四项属于既有集成用例内新增断言，不另计为四个测试。

本轮只读核验 origin/main 仍为 `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`，GitHub OPEN 集合仍为 #93/#122/#123/#124。下一条实现主线应转向事务内目标/引用/保留行重验与精确执行，再接对象逐版本耐久状态和独立后检；准备日志不能替代实际执行完成证据。

2026-09-23 执行准备增量：实际 CLI 新增 `execute` 的完整参数和精确确认串要求，但只允许保存准备证据，不执行删除。单独 Ed25519 apply 授权绑定试运行计划摘要、既有检查点授权、代码身份、冻结代际/令牌和精确日志根目录。重新生成的当前计划只排除报告生成/恢复核验时间和自身摘要后与已签计划比较，其余字段必须一致。私有 0700 日志根下排他创建批次目录，以 0600 排他文件和 fsync 保存计划、授权、首条 `prepared` 哈希日志；部分写入失败保留批次占用，不覆盖、不自动重试。这还不是跨目录或数据库级重放保护，也不是完整执行状态机。

TDD 参数反例先失败后通过 13/13；真实 PG16 新增公开入口用例先因 execute 不可用失败，再通过。当前 Node 20.20.2 真实 PG16 集成 66/66（199.8 秒）、四文件回归 175/175（43.7 秒）均退出 0，分两次运行共 241 项；API typecheck/lint、四个本轮独立 CJS lint 和 diff 检查通过。新增测试核验计划及签名副本、目录/文件模式、准备日志哈希、重复批次阻断及事后公开 inspect 事实不变。尚未补齐 apply 签名/日志异常反例，不应将正例视为完整安全验收。实际事务删除、逐版本对象处置、每步锁内重验和后检仍待完成，无生产访问或真实数据删除。

1. 已有独立处置签名、固定授权公钥、执行身份、代码/运行时、双范围冻结及报告/备份/对象/批次/租约代际的最终授权绑定，并完成实际检查点与真实 PG16/隔离 HTTPS 复验贯通；还须执行中持续重验。未签名 scope 本身永远不能作为执行授权。
2. 全部 Schema/文件引用登记、触发器守卫及并发重验的最终完整性。已补齐来源 Schema/迁移绑定及重复对象键预检，仍不代表该项最终验收完成。
3. 已有全版本备份/恢复工件离线核验、数据库对象绑定、真实 HTTPS 全版本集合比对及有界传输。本机合成服务覆盖版本漂移、首次失败停止及分页/挂起等异常；最终执行收据和执行中重验仍待补齐，不能以合成测试替代生产 COS 证明。
4. 已实现试运行精确计划及恢复锚描述；仍须计划的最终授权绑定、持久化执行/恢复日志、数据库及对象部分失败状态、每步冻结/引用/版本重验、禁止重放扩大范围，以及精确执行。
5. 独立后检、权威终态审计、其余记录完整性证明、失败恢复测试、完整本机门禁和审查。

共享启动器仅增加独立子命令及其执行文件登记；没有放宽现有 POL-22 门禁、修改 Schema、业务权限或签名材料。#122 尚未通过，不进入 #123/#124。

## 2026-09-23 独立 CLI 本机执行接线

用户明确批准本地实现及本机 PG16/隔离对象存储验证，不授权生产运行。初次无强制隔离的接线被工具安全审核拒绝；随后加入不可关闭的本机运行边界后实施：Linux Docker、仅回环网络/路由、精确测试库与恢复库、固定合成 bucket/region 和回环 DNS，每步处置前复验。该实现不能直接投入生产。

execute 串联精确计划和签名重验、耐久日志、事务内两目标/引用/保留行重验、数据库删除审计、逐版本单请求处置、终态审计；postcheck 独立核验日志链、全部版本处置和数据库保留行指纹。部分提交失败明确报告 committed，不自动续删；后检无法证明时报告 unknown，而不声称未执行。

公开 CLI 的 RED 用例曾在隔离数据库提交后停止。定位并修正三处接线问题：通用清单只提供行指纹，故审计业务字段改为同一事务内按精确审计 ID 查询；隔离 HTTPS 夹具签名参数名规范化；现有适配器生成小写 versionid，CLI 在精确值和单参数约束下转换为 versionId 发送。没有改共享存储适配器、Schema 或业务权限。失败诊断仅输出固定白名单错误码及合成请求校验布尔值。

最终本轮真实 PG16 66/66（231472 ms），四文件回归 175/175（44578 ms），均退出 0。实际执行用例通过两文件/6 版本精确处置、保留记录不变、独立后检、重复批次拒绝及目标消失后的 inspect 阻断。触及独立脚本 lint、API typecheck/lint 已通过。证据针对基线 56fd5243d6b096d4ce022eac1d8e95f7f1da97f0 上的未提交本地候选，不是固定提交发布证明。

后续本机补证：错误恢复库名在执行日志创建前被强制隔离门拒绝；完整成功及 6 个版本删除后篡改终态日志，独立后检拒绝成功并将数据库结果报为未知。清理计划新增 `eligibleForIsolatedExecution`，仅在固定本机边界及全部绑定证据满足时为 true；生产执行标记继续为 false，报告阻断码改为准确的 `PRODUCTION_EXECUTION_NOT_ENABLED`。相应签名校验拒绝无隔离执行资格的计划。成功路径再次通过真实 PG16 66/66、四文件回归 175/175、API typecheck/lint 与触及独立脚本 lint。

另起全新合成窗口注入第一笔 HTTPS 版本 DELETE 被拒，真实 PG16 66/66（207394 ms）：数据库两目标已删除且仅有一条已提交审计，日志状态精确为 prepared→database_intent→database_deleted→object_intent→failed；仅有一次签名正确但被隔离服务拒绝的 DELETE；独立后检不能出成功回执，同批次 execute 不能重放。此为停机对账证据，不是自动恢复或可安全续删的证明。默认成功路径在加入该测试分支后重新运行中。

加入失败分支后的默认成功路径已重新通过真实 PG16 66/66（227651 ms）；本轮四文件回归 175/175、API typecheck/lint、触及独立脚本 lint 及 diff 检查通过。测试只在一次性 PG16 和无外网隔离 HTTPS 对象服务执行。

剩余：独立安全双审、固定候选 SHA 全套正式门禁及部分提交后的人工对账/恢复契约；不能据本机正例宣称 #122 全部完成或生产 ready。未连接生产、未访问真实 COS、未删除真实数据、未执行 Git/GitHub 交付或 #123/#124。

2026-09-23 本地补充设计：[`#122 两文件失败对账与恢复决策契约`](../design/2026-09-23-pol122-two-orphan-failure-reconciliation.md) 已把 prepared、数据库提交不明、可证明回滚、数据库已提交且对象未收敛、对象单请求结果不明、完成等状态的只读证据与处理边界列清。当前 CLI 的部分失败只停机并保留日志，不提供自动续删或生产恢复。该设计尚须独立审查及正式恢复路径授权，不能替代失败后的实际对账收据。

2026-09-23 当前代码补证：数据库事务已提交后如遇对象处置失败，CLI 尽最大努力在新的串行化事务中重验授权与目标删除事实，并记录独立 `failed_after_database_commit` 审计；失败或无法写审计时仍保留私有日志和停机状态，不自动续删。全新本机 PG16/隔离 HTTPS 拒绝首笔 DELETE 窗口 66/66（216.4 秒），断言该批次恰好有删除及失败两条审计，且仅发生一次被拒的签名 DELETE、后检与重放继续阻断。当前代码默认成功窗口 66/66（229.9 秒），其余四文件回归 175/175；API typecheck/lint、触及 CJS lint 与 `git diff --check` 均通过；测试容器已退出。以上仅是未提交本地候选的合成证据，不能替代固定 SHA 完整门禁、双审或生产授权。

2026-09-23 对账关联补证：故障夹具追加断言，私有 `failed` 事件必须声明数据库已提交、失败阶段为首笔对象版本 DELETE，且 `failureAudit.auditId` 精确对应本批次 PG16 中唯一的 `failed_after_database_commit` 审计。修改后重新运行全新 PG16/隔离 HTTPS 故障窗口 66/66（211.0 秒），CJS lint 通过。未改变执行逻辑或生产边界。

2026-09-23 扩展本地静态与编排门：工作区 `pnpm typecheck` 退出 0；`pnpm lint` 退出 0，API/shared-domain 无错误，Web 有 570 条既有格式警告；`pnpm inspect:release-manifests` 退出 0，最终能力矩阵 606 routes、0 blockers；`pnpm test:ci-orchestration` 117/117。检查前后候选仍为未提交本地工作树，故这些结果不是 `release:local` 的固定 SHA 回执，也不构成正式双审。

2026-09-23 工作区测试补证：`pnpm --filter @jiangkong/api test -- --runInBand` 退出 0，437 套件通过、47 套件按配置跳过，7866 项通过、314 项跳过；shared-domain 27 文件/239 项通过；Web 223 文件/2147 项通过。以上为未提交本地工作树的测试，不替代固定 SHA 发布门或双审。

2026-09-23 其余可执行本机门：`pnpm check:migration-baseline` 退出 0，171 项迁移、最终迁移 checksum 与清单一致且无漂移；Web `typecheck:e2e`、`check:ui`、API build、Web build 均退出 0。Web build 有大 chunk 提示但无构建失败。正式 `release:local` 要求干净、固定提交 SHA，当前未提交候选不满足入口条件，故未运行或声称正式门通过。

### #122 正式验收差距（截至本地候选）

| Issue 验收条件 | 当前可证明范围 | 未完成的正式证据 |
| --- | --- | --- |
| #296 SHA、迁移、Schema、备份恢复、停写绑定 | 本地候选基线为 `56fd5243d6b096d4ce022eac1d8e95f7f1da97f0`；本地迁移基线检查 171 项无漂移 | 新窗口正式环境精确绑定及权威回执重验 |
| 最终 Schema 的数据库指纹、逐行哈希、对象版本快照 | 两文件独立 CLI 在一次性 PG16/隔离 HTTPS 中计算与重验 | 完整正式数据范围的窗口快照 |
| 每条 review/business_review 中文决定与独立测试来源 | 两隔离文件的本地精确授权/来源夹具可验 | #122 全部记录的正式决定、来源与独立可信证明 |
| 数据库与私有对象本窗口隔离恢复 | 两文件合成数据库和对象版本恢复通过 | 正式本窗口完整数据库及对象恢复证据 |
| 六项身份、授权、来源、冻结材料 | 本地合成材料与签名/漂移反例通过 | 固定候选与正式控制面逐项核验 |
| inspect→dry-run→apply→postcheck 串行 | 独立两文件 CLI 本地正例和失败即停反例通过 | 原范围正式工具与生产窗口串行收据；生产执行另行授权 |
| 保留资料、事实归零、无悬空引用/孤儿对象及编号状态 | 两文件本地保留行/引用及终态后检通过 | #122 全范围正式结果与编号状态证明 |
| terminal marker 与 zeroing_receipt 同 SHA | 本地两文件日志可后检，但不产生正式 POL-22 终态 | 权威同 SHA 双收据 |

因此两文件本地 GREEN 不能等同 #122 全范围完成，#123/#124 依赖仍保持阻断。

2026-09-23 依赖审计环境停止：执行一次 `pnpm audit --prod --audit-level high`，工具内建重试后退出 1；npm registry 审计请求经本机 `127.0.0.1:7897` 代理被 `ECONNREFUSED`。没有得到漏洞报告，故本门为未验证而非通过/发现漏洞。未修改代理、锁文件或依赖，也未重试另一传输路径。固定 SHA 正式门禁仍须在可访问审计服务的受控环境重新执行。

2026-09-23 POL-22 本地只读动态预检环境停止：执行一次 `bash services/api/scripts/run-business-zeroing-cli.sh preflight-dynamic`，在启动 PostgreSQL 容器前的 `docker image inspect postgres:16` 处退出 1，报告 `No such image: postgres:16`。随后只读核对同一主机的 `docker image ls` 和 `docker image inspect` 均确认该镜像存在；显式固定 Docker Unix socket、最小化环境的直接 inspect 也通过。该差异原因未证实，没有重跑官方预检、修改镜像/配置或将其登记为通过。未触发生产连接与删除。

只读差异缩小：官方代码从当前 Docker context 解析并固定本机 Docker Unix socket；随后直接执行与官方相同、无 `--format` 的 `docker image inspect postgres:16`，在最小化环境与该 socket 上退出 0。默认与显式固定 socket 的 Docker daemon ID 一致。仍不能证明先前一次官方失败的瞬时原因，也不以事后可见镜像替代官方门禁结果；未重跑官方命令。

2026-09-24 新授权后的门禁接续：确认本机代理端口无监听，而直连 npm registry 可用；不改全局配置，仅对当前进程设置 `npm_config_proxy=false npm_config_https_proxy=false`，再次运行生产依赖审计退出 0，报告 1 项 moderate、无 high。官方 POL-22 本地只读预检在未显式设置 `DOCKER_HOST` 时再次于镜像检查失败；随后仅进程级显式绑定已核验的同一本机 Docker Unix socket，官方预检完成 171 项迁移并通过 API 构建，接着在“当前 checkout 含未提交或未跟踪改动”处退出 1。此为正式固定 SHA 门的预期入口阻断，不是预检通过；无生产连接、无业务或 COS 删除。下一步仅将本候选精确提交、保证 checkout clean 后，从头重跑正式门禁。
