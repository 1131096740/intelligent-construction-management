# 测试业务归零预检与受控执行工具

> 本手册只说明 POL-22（Issue #120）交付的工具。POL-22 不授权对任何真实或生产环境执行归零，不授权删除数据库、迁移历史或对象存储内容。真实归零只能由后续 POL-24（Issue #122）在表清单冻结后，按另一份精确授权执行。

## 1. 工具与默认模式

| 工具 | 默认行为 | 作用 |
| --- | --- | --- |
| `inspect-test-business-zeroing.cjs` | 只读 | 识别 Schema、逐主键及完整行指纹候选、中文保留白名单及内容锚点、文件绑定、逻辑/数据库外键顺序、预计释放编号和阻断项 |
| `execute-test-business-zeroing.cjs` | dry-run | 复核报告新鲜度并输出精确执行步骤；只有全部执行门齐备才能进入 apply |
| `verify-test-business-zeroing.cjs` | 只读 | 核对候选已清零、保留数量不漂移、迁移不变、无孤儿文件与悬空外键 |
| `sign-business-zeroing-input.cjs` | 只读输入，新建输出 | 为决定清单或备份恢复收据生成内容完整性 SHA-256 |

`sign-business-zeroing-input.cjs` 只证明 JSON 内容未漂移，不证明决定由谁批准。预检会实际读取两个备份文件并重算字节 SHA-256，但这仍不代替隔离恢复演练。执行授权必须由独立签发者使用 Ed25519 私钥生成；工具不接收命令行公钥，也不包含或生成真实环境私钥。

报告、清单、授权和收据等运行工件必须放在仓库 checkout 之外的专用受限目录；否则它们会使工作树变脏并被代码身份门阻断。每次输出都必须使用不存在的新路径，不能覆盖旧证据。

## 2. 执行前硬门

必须同时满足：

1. 当前 checkout 为已审核的完整 40 位 Git SHA，工作树无未提交/未跟踪文件，API 已由该 SHA 构建；报告同时绑定归零脚本、锁文件、Prisma Schema 和 `services/api/dist/` 全部 JavaScript 产物的 SHA-256。
2. `DATABASE_URL` 精确指向本次授权环境；环境名、数据库系统标识、数据库名/Schema/连接身份和 session replication role 形成的 fingerprint、迁移 head、列/主键/外键/触发器启用状态/用户函数及显式逻辑关联形成的 Schema digest 必须与报告一致。
3. 固定部署身份文件必须把环境、部署实例和逻辑执行主体绑定到当前 OS 用户名和 UID；命令环境、身份文件和当前进程任一不一致都失败关闭。
4. 数据库备份和私有文件备份都绑定绝对本地普通文件路径；工具实际读取并校验字节 SHA-256，且收据分别记录捕获时间、隔离恢复目标、恢复时间与 `passed` 状态。两类备份都必须满足 `capturedAt <= restoreVerifiedAt <= 本次预检 generatedAt`，未来时间或预检后才完成的恢复证据一律阻断。
5. 所有 `review` 基础资料和 `business_review` 业务记录都有逐主键的中文 `preserve`/`delete` 决定和原因；任何未分类记录都阻断，不得按时间或“相关记录”推测。为保证正式编号重新开始，`BusinessDailySequence` 与 `ContractNumberTombstone` 只接受逐主键 `delete`，对它们声明 `preserve` 同样阻断。
6. 报告中没有未知表、缺失表、缺失主键、未分类记录、未登记文件绑定、未知/混合归属、孤儿文件、重复对象键、悬空外键、候选循环依赖，或候选表上的启用拒绝删除触发器；后者必须先由另票提供可审计专用通道，POL-22 不绕过或禁用触发器。
7. 删除候选仅由“中文业务类型 + 表 + 完整主键 + 规范化完整行 SHA-256”构成；文件另需精确 bucket、object key 及备份捕获时已经存在的内容/版本快照，本地文件快照还绑定设备与 inode 标识。候选不得包含数据库或 `_prisma_migrations`。protected 与逐项保留记录同样绑定主键和完整行指纹，只有 `ContractNumberRule.nextSequence/updatedAt` 是为明确 CAS 操作设置的窄豁免。
8. 保留的 `ContractNumberRule` 只允许以完整主键和旧值 CAS 把 `nextSequence` 复位到 `1`；`BusinessDailySequence` 与 `ContractNumberTombstone` 逐主键删除并输出预计释放信息。不得重写项目、人员、岗位、我方公司或模板编号。
9. 只有 `status=ready` 的未过期报告可用于 dry-run 或后续执行门。新表、新记录、新对象版本、触发器/函数或任何状态漂移均要重新预检和审批。

## 3. 准备显式输入

未签名的逐主键决定清单示例（基础资料和业务记录均须逐条列明）：

```json
{
  "schemaVersion": 1,
  "policyId": "pol-22-business-zeroing-v1",
  "environment": "<精确环境标识>",
  "databaseFingerprint": "<64 位 SHA-256>",
  "records": [
    {
      "businessType": "项目基本资料",
      "table": "Project",
      "primaryKey": { "id": "<精确主键>" },
      "decision": "preserve",
      "reason": "已由业务负责人逐项核实为真实基础资料"
    },
    {
      "businessType": "合同业务",
      "table": "Contract",
      "primaryKey": { "id": "<精确主键>" },
      "decision": "delete",
      "reason": "已由业务负责人逐项核实为测试合同"
    }
  ]
}
```

未签名的备份恢复收据示例：

```json
{
  "schemaVersion": 1,
  "environment": "<精确环境标识>",
  "databaseFingerprint": "<64 位 SHA-256>",
  "databaseBackup": {
    "location": "<数据库备份精确位置>",
    "sha256": "<64 位 SHA-256>",
    "capturedAt": "<ISO-8601 捕获时间>",
    "restoreVerifiedAt": "<ISO-8601 时间>",
    "restoreTarget": "<隔离恢复目标>",
    "restoreStatus": "passed"
  },
  "privateFileBackup": {
    "location": "<私有文件备份精确位置>",
    "sha256": "<64 位 SHA-256>",
    "capturedAt": "<ISO-8601 捕获时间>",
    "restoreVerifiedAt": "<ISO-8601 时间>",
    "restoreTarget": "<隔离恢复目标>",
    "restoreStatus": "passed"
  }
}
```

内容审核完成后，用新输出路径生成完整性 SHA-256 收据：

```bash
node services/api/scripts/sign-business-zeroing-input.cjs \
  --input <reviewed-decisions.json> \
  --output <signed-decisions.json>

node services/api/scripts/sign-business-zeroing-input.cjs \
  --input <verified-backup-receipt.json> \
  --output <signed-backup-receipt.json>
```

预检、dry-run、受控执行和后置核验还要求固定路径 `/etc/jiangkong/pol22-zeroing-execution-identity.json` 存在，并由 root 持有、不是符号链接、不可被组或其他用户写入。POL-22 不安装该文件；后续 #122 必须在独立控制面按实际运行用户精确预置，字段不得增减：

```json
{
  "schemaVersion": 1,
  "environment": "<精确环境标识>",
  "deploymentId": "<不可复用的部署实例标识>",
  "executorIdentity": "<授权执行主体标识>",
  "executorUid": 1234,
  "executorUsername": "<专用系统用户名>"
}
```

工具会把完整身份文件计算为 `deploymentIdentitySha256`，并同时核对当前进程真实 UID 和系统用户名；命令行不能覆盖该身份锚。

## 4. 只读预检

```bash
node services/api/scripts/inspect-test-business-zeroing.cjs \
  --environment <精确环境标识> \
  --decision-manifest <signed-decisions.json> \
  --backup-receipt <signed-backup-receipt.json> \
  --output <new-preflight-report.json>
```

不带决定清单或备份收据时，命令仍只读扫描，但以退出码 2 和 `status=blocked` 结束。检查输出中的：

- `databaseFingerprint` / `migrationHead` / `schemaDigest` / `codeSha` / `executionCodeSha256` / `deploymentIdentitySha256` / `executorIdentity`；
- `preservationWhitelist` / `preservationAnchors` / `preservationCountsByBusinessType` / `classificationRequired`；
- `deletionCandidates` / `deletionCountsByBusinessType` / `numberResets` / `expectedReleasedNumbers` / `candidateSha256` / `deletionOrder`；
- `fileBindings` 中的精确 bucket、object key、业务主键与归属分类，以及文件删除候选中的对象内容或全部版本快照；
- `backupRecovery` / `blockers` / `reportSha256` / `expiresAt`。

任何 blocker 存在时，工具强制把 `deletionCandidates`、`numberResets`、`expectedReleasedNumbers` 和 `deletionOrder` 置空。

## 5. dry-run

不得带 `--apply`：

```bash
node services/api/scripts/execute-test-business-zeroing.cjs \
  --report <new-preflight-report.json> \
  --environment <精确环境标识> \
  --decision-manifest <signed-decisions.json> \
  --backup-receipt <signed-backup-receipt.json> \
  --output <new-dry-run-receipt.json>
```

dry-run 会重新执行只读预检，对比环境/执行主体、数据库、代码、迁移、Schema、决定清单、备份收据、对象快照、状态和候选指纹。输出步骤包含逐主键删除和逐规则 CAS 编号复位；任何漂移都会阻断，不调用数据库或文件写接口。

## 6. 受控执行模板（POL-22 不执行）

> 以下命令仅是后续 #122 的参数契约。未获得另一份针对精确环境、精确候选、时间窗口和候选 SHA 的授权时，严禁执行。

独立签发者必须对 UTF-8 JSON payload 原始字节做 Ed25519 签名，并交付以下 envelope；字段必须逐项绑定已批准报告和批次。签发者私钥不得交给执行人或放入仓库：

```json
{
  "schemaVersion": 1,
  "algorithm": "Ed25519",
  "payload": "<下述 JSON 原始字节的严格 Base64>",
  "signature": "<Ed25519 签名的严格 Base64>"
}
```

payload 必须精确包含：`schemaVersion`、`authorizationRef`、`issuer`、`issuedAt`、`expiresAt`、`policyId`、`environment`、`databaseFingerprint`、`codeSha`、`executionCodeSha256`、`deploymentIdentitySha256`、`executorIdentity`、`reportSha256`、`candidateSha256`、`decisionManifestSha256`、`backupReceiptSha256`、`batchId`、`confirmation`。授权不得早于报告生成时间，也不得晚于报告过期时间。

执行入口只从固定路径 `/etc/jiangkong/pol22-zeroing-authorization-public-key.pem` 读取由 root 持有、非符号链接、不可被组/其他用户写入的 Ed25519 公钥。命令行不能覆盖该信任锚；POL-22 不安装该文件，因此默认保持执行禁用。后续 #122 必须由独立控制面预置正确公钥并另行授权，不能把私钥放到执行主机。

```bash
node services/api/scripts/execute-test-business-zeroing.cjs \
  --apply \
  --report <approved-preflight-report.json> \
  --environment <精确环境标识> \
  --decision-manifest <signed-decisions.json> \
  --backup-receipt <signed-backup-receipt.json> \
  --batch-id <approved-batch-id> \
  --expected-database-fingerprint <report.databaseFingerprint> \
  --expected-code-sha <report.codeSha> \
  --expected-execution-code-sha256 <report.executionCodeSha256> \
  --expected-report-sha256 <report.reportSha256> \
  --expected-candidate-sha256 <report.candidateSha256> \
  --authorization <independent-ed25519-authorization.json> \
  --confirm EXECUTE_TEST_BUSINESS_ZEROING_<approved-batch-id> \
  --output <new-execution-receipt.json>
```

`--output` 必须指向仓库外的新文件。工具在任何数据库写入前以独占创建和 `0600` 权限预留该路径；已存在、不可写或无法安全预留都会阻断。

工具会在 `Serializable` 事务中取事务级 advisory lock，锁定当前表并重建预检报告。只有锁内完整候选行指纹、保留记录内容锚点和全部状态与审批报告完全一致，才会推进逐主键删除。每个候选在实际 `DELETE` 前还会在同一事务内按完整主键 `FOR UPDATE` 重读完整行并逐条比对已签名 `rowSha256`，因此前序删除触发器若修改后续候选，整笔事务立即回滚；随后才执行带 `WHERE` 的参数化删除及逐主键/旧值 CAS 编号复位。任何一项影响行数不是 1 都回滚整个数据库事务。删除完成后先在同一事务内重建并通过保留主键/内容、候选清零、关联和 Schema 后置断言，才允许提交。

数据库提交后，再逐个处理报告中的精确对象键。本地文件先原子移动到同目录唯一隔离名，再复核被移动 inode 的内容 SHA-256、字节数和修改时间；漂移时只做无覆盖恢复，无法安全恢复则保留隔离工件并失败关闭。为防止已打开文件描述符在复核后写入而使新增字节被物理丢弃，POL-22 只移除原精确对象键并永久保留唯一 quarantine 硬恢复工件，不执行该 inode 的 `unlink`；其相对路径写入最终收据的 `objectDispositions`。quarantine 工件的物理清理由后续独立停写、核验和授权票处理，不属于 #120 或 #122 的归零动作。COS 必须完整匹配已批准的所有 version ID、删除标记、大小和修改时间，只删除这些精确 version ID。任何新增/修改/缺失都立即停止，不支持前缀删除。执行全过程在提交前、每个对象删除前和完成时重新校验授权窗口；收据分别记录真实 `startedAt` 与 `completedAt`。最终后置核验通过后，工具先 fsync 写入已预留的 `0600` 输出，再独立尝试写永久 `AuditLog`；两端任一失败仍尝试另一端并报告失败，避免已提交执行失去完整收据。

## 7. 只读后置核验

```bash
node services/api/scripts/verify-test-business-zeroing.cjs \
  --before-report <approved-preflight-report.json> \
  --execution-receipt <new-execution-receipt.json> \
  --environment <精确环境标识> \
  --decision-manifest <signed-decisions.json> \
  --backup-receipt <signed-backup-receipt.json> \
  --output <new-postcheck-receipt.json>
```

后置核验会使用固定公钥重新验证执行收据内的原始 Ed25519 envelope，而不是只相信摘要；同时复核部署/执行主体、完整候选、Git SHA、执行代码指纹，并要求数据库 `completed` 审计保存完全一致的完整最终收据。只有原决定明确为 `delete` 的基础资料，才允许其主键在后置核验中已消失。空白/伪造执行前报告、签名或收据内容漂移、审计缺失/漂移、任何 `preserve` 主键消失、保留数量改变、正式编号未回到 `1`、候选残留、新 blocker、孤儿文件、悬空数据库或逻辑关联、迁移/Schema 改变均失败关闭。

## 8. 失败和恢复

- 事务提交前失败：数据库整体回滚，不得放宽条件或改用 broad delete 重试。
- 数据库提交后、精确对象删除或后置核验失败：工具写入 `failed_after_database_commit` 审计事件并停止。保留原报告、精确对象版本清单和备份收据，由独立授权决定继续精确收敛或从已验证备份恢复。
- 本地精确对象键已移除：最终收据中的 `objectDispositions[].quarantineObjectKey` 是相对于私有存储根的恢复工件；不得清理、覆盖或按通配符处理。若需恢复，只能在另行停写与授权后执行无覆盖原子恢复并重新核验内容。
- 完成审计失败但预留输出成功：不得重跑删除。保留并验证已 fsync 的完整收据，排查审计写失败后由独立授权决定修复永久审计；工具仍以失败退出。
- 本地输出失败但完成审计成功：不得重跑删除。按精确 `batchId` 只读查询 `AuditLog` 中 `action=test_business_zeroing.controlled_execution`、`businessType=test_business_zeroing`、`metadata.status=completed` 的最新唯一记录，取出 `metadata.executionReceipt`，再用固定公钥和后置核验工具验证。
- 任何备份校验/恢复证据失效、Schema 新增表、决定漂移或报告过期：回到第 2 节重新建立完整证据链，不得绕过。
- 工具不提供删库、删 Schema、删迁移历史、按时间推测、“等等”或前缀对象删除能力。

## 9. POL-22 隔离验证

仅在本机 Docker 端点、已缓存的 `postgres:16` 镜像和系统临时目录中执行；运行器会拒绝继承的数据库 URL 和生产 `NODE_ENV`：

```bash
env -u DATABASE_URL -u CONTRACT_DATABASE_URL -u SHADOW_DATABASE_URL \
  -u TEST_DATABASE_URL NODE_ENV=test \
  node services/api/prisma/run-business-zeroing-local.cjs
```

该门会临时应用全部迁移，只对隔离夹具执行预检、dry-run、受控逐主键删除、本地精确对象键删除和后置核验，随后清理临时容器与文件。收据必须显示 `productionAccessed: false`。
