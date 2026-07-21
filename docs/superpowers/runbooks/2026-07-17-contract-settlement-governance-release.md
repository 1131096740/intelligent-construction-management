# 合同结算治理发布 Runbook

> 适用范围：2026-07-17 合同结算治理候选（生产已知 61 个迁移 → 候选 69 个迁移）
> 当前状态：用户已批准证据 HEAD `4b5b6f0a7dbb0b3271b63d682b00967bd81e1452`、运行候选 `74d5d2449ab9e4232f2625f2805c64b1686ff314` 和窗口 A；2026-07-19 推送、部署、M52–M58/M69 与生产验证成功。生产 preview 为空，未授权也未执行 transition apply。
> 运行原则：最小权限、精确 SHA、隔离恢复先行、两次独立授权、失败关闭。

## 1. 两个必须分开的变更窗口

### 窗口 A：代码部署和数据库迁移

用户必须同时明确批准：（1）当时包含本报告和机器证据的 **40 位证据/文档 HEAD**；（2）其中绑定并已通过运行门禁的 **40 位小写运行候选 SHA `74d5d2449ab9e4232f2625f2805c64b1686ff314`**。在执行前必须确认两者之间运行时代码树零差异，且授权范围必须明确包含：

1. 快进推送目标 SHA；
2. 部署 Web/API；
3. 执行生产尚未完成的 M52–M58 与 M69 迁移；
4. 进行生产只读验证和明确列出的最小冒烟。

窗口 A **不授权**终止、退回、失效或重提任何存量业务实例。迁移不得夹带这类业务写入。

### 窗口 B：仅在 preview 产生非空 manifest 时按清单过渡存量未生效实例

只能在窗口 A 完成并稳定且 preview 实际产生非空 manifest 后开始。当前候选 preview 为 0 项，因此本次不存在窗口 B。若未来清单非空，用户必须再次单独批准：

1. 当前生产 40 位 SHA；
2. transition preview 生成的精确 manifest 摘要/哈希；
3. 实例数量及每个脱敏业务编号的建议动作；
4. 操作人用户 ID；
5. 允许执行 transition `--apply` 的精确确认语。

任何“批准上线”、“批准部署”或“批准迁移”都不得被推定为窗口 B 的授权。

## 2. 候选固定前门禁

1. 确认当前分支、HEAD、`origin/main` 和生产 SHA。
2. `git status --short` 只允许已审查的候选改动。
3. 生成对 `origin/main` 及生产 SHA 的提交/文件清单。
4. 确认 M52 `20260716160000_contract_tax_facts_and_settlement_drafts` 与实施前基线零差异。
5. 确认生产 61 个迁移到候选 69 个迁移共有 8 个未部署增量：M52–M58 与 M69，没有编号重用。
6. 确认 M69 的中心 FileObject 引用清单为 54 项、统一触发器为 54 个、旧绑定函数为 0，并在存量冲突时失败关闭。
7. 完成所有定向、全量、构建、UI、E2E 和 `git diff --check` 门禁。
8. 在六个桌面视口完成浏览器验证，记录截图绝对或仓库相对路径。
9. 用脱敏 seed/test 数据执行完整隔离 UAT，证据清单必须绑定当前 SHA。
10. 从已验证的生产备份恢复到 `jiangkong_restore_*`，完成 61→69 迁移和 transition preview；仅当 manifest 非空时才要求隔离 apply/幂等/漂移演练，空 manifest 记为不适用，不人工造数据。
11. 完成业务、财务、技术 Go / No-Go 签认；未签认时发布结论只能为 No-Go/等待。

## 3. 隔离 UAT

### 3.1 安全边界

- API 只能是 `localhost` / `127.0.0.1` / `::1`。
- PostgreSQL 只能是本机脱敏 seed/test 或 `jiangkong_restore_*` 隔离库；不得是生产库名。
- `FILE_STORAGE_DRIVER=local`；不得读写 COS。
- 证据文件不得包含真实合同、身份证、银行账户、印章影像、对象键或密钥。

### 3.2 命令模板

```bash
TRIAL_RUN_ID='<本次隔离 UAT runId>' \
TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH='<脱敏 UAT 证据 JSON 绝对路径>' \
node services/api/prisma/run-contract-settlement-governance-uat-local.cjs
```

该编排器先要求 Git 工作树完全洁净，再从当前 `HEAD` 读取并冻结 40 位候选 SHA；随后自动创建一次性 PostgreSQL 16、执行全部迁移和脱敏 seed、启动仅监听 `127.0.0.1` 且使用本地文件存储的 API，先运行 20 项治理 UAT，再运行完整 `verify-trial-run.cjs`。成功或失败都会删除临时 API、容器和本地文件；证据 JSON 单独保留。若需外部固定 SHA，可额外设置 `TRIAL_RUN_CANDIDATE_SHA='<40 位小写候选 SHA>'`，与当前 `HEAD` 不一致时编排器会失败关闭。

`verify-trial-run.cjs` 必须验证 20 个必选场景证据：五类合同、主管跳过、最终或签、授权四组合、9.99%/10%/10.01%、两类结算路线、单/多页签名、跨域只读正向和写入负向；不接受缺项、未通过、无证据编号或 SHA/runId 不匹配的清单。完整试运行还必须走通历史接管、税务事实、结算冻结、乙方签署、内部审批签名合成、归档生效、付款审批、实付、入账和资料下载审计。

证据 JSON 是脱敏隔离 UAT 执行器的机器输出，不是人工勾选表。顶层结构必须为：

```json
{
  "schemaVersion": 1,
  "runId": "governance-uat-20260718a",
  "candidateSha": "<40 位小写 SHA>",
  "apiOrigin": "http://127.0.0.1:3000",
  "databaseName": "jiangkong_governance_uat",
  "storageDriver": "local",
  "productionData": false,
  "cases": [
    {
      "id": "contract_material_purchase",
      "passed": true,
      "evidenceIds": ["governance-uat-20260718a:<实际审批实例 UUID>"]
    }
  ]
}
```

实际清单必须包含脚本列出的全部 20 项；每项至少一个脱敏证据编号必须包含本次 `runId`。证据 JSON 只记业务编号/测试实例 ID，不记文件对象键、口令、token 或真实业务内容。

## 4. 隔离恢复与迁移演练

1. 选择最新且已通过 checksum、`pg_restore --list` 和异机回读的生产 custom dump。
2. 只恢复到空 `jiangkong_restore_*` 数据库。
3. 恢复前记录 dump SHA-256、候选 SHA 和原迁移计数；不在文档中记录密码、COS 密钥或对象内部键。
4. 使用精确候选 checkout 执行 `prisma migrate deploy` 和 `prisma migrate status`。
5. 核对恢复前 61 个已完成迁移，候选迁移后 M1–M69 共 69 个已完成迁移、关键索引/约束和存量计数。
6. 使用 `default_transaction_read_only=on` 独立重查历史审批 JSON、金额、税务事实和文件证据计数。
7. 迁移演练不得启动 transition `--apply`，两者的证据必须分开记录。

## 5. 旧实例 transition 演练

### 5.1 只读预览

```bash
DATABASE_URL='<jiangkong_restore_* 隔离库>' \
node services/api/prisma/transition-contract-settlement-governance.cjs \
  --candidate-sha='<40 位小写候选 SHA>' \
  --manifest='<隔离目录>/governance-transition-manifest.json'
```

预览必须是 `READ ONLY`，只输出脱敏业务 ID、状态、审批实例和建议动作；不输出文件对象键、密码、token 或附件内容。

### 5.2 仅非空 manifest 的隔离库 apply

preview 为空时本节不适用，直接记录 0 项/0 阻断和 digest，不为演练 apply 伪造业务数据。preview 非空时，必须先确认操作人 ID 与 CLI 校验兼容；已知生产历史 `super_admin` ID 为非 UUID，而当前 CLI 只接受 UUID，因此未来任何非空 manifest 在 apply 前必须先修复这一兼容性阻断并重跑本节全部门禁。

隔离 apply 使用工具当前实现的精确参数：

```bash
DATABASE_URL='<jiangkong_restore_* 隔离库>' \
node services/api/prisma/transition-contract-settlement-governance.cjs \
  --apply \
  --manifest='<隔离目录>/governance-transition-manifest.json' \
  --candidate-sha='<40 位小写候选 SHA>' \
  --operator-user-id='<隔离库内有效操作者 UUID>' \
  --confirm='ALLOW_GOVERNANCE_TRANSITION_APPLY'
```

演练时必须同时提供：

- 候选 SHA；
- 工具要求的精确确认语；
- 操作人用户 ID；
- 未改动的 preview manifest。

验收：

1. 任一状态、版本、审批实例或摘要漂移都整批回滚；
2. 只终止 manifest 中未生效的旧合同/结算实例；
3. 保留旧日志和文件，仅按模型标记失效；
4. 未生效单据回到可补资料并重提的状态；
5. 重复执行幂等，不重复日志；
6. 付款申请、实付、入账和凭证零改动。

### 5.3 开发期模块级演练收据与不可替代边界

2026-07-18 的本地开发期演练 runId 为 `task22-20260718T160702Z`，执行时 HEAD 为 `2bef123cfbdc231cba41d212b17ed6f9cd5f0c30`，使用 PostgreSQL `16.14` 并应用 M1–M58 共 58 个迁移。manifest digest 为 `a4ac20b349f0a157228d072d876cfad7c8dd70f82a06beaa2703930a0eee24fc`，manifest 文件 SHA-256 为 `8f7e8f7c0175e690a1625e55dc5f25262605f22d54a0ea7aaee91ca6abdb4c5d`；首次 apply 为 `applied=2/alreadyProcessed=0`，二次 apply 为 `0/2`，漂移批次被整批拒绝且零 transition 审计、零替代草稿写入，付款申请、实付、入账及已付金额事实不变。机器收据 `/tmp/task22-20260718T160702Z-transition-evidence.json` 的 SHA-256 为 `67a272e0378033bd77c35783ffbd90c0bca009fff5fec48d8aa5999f03424bdf`，harness cleanup 通过。

这次演练在 **dirty shared worktree** 中调用 **committed HEAD module**，只作为核心行为的开发期证据；它不替代最终候选的生产备份恢复。后续已对洁净候选完成生产备份 61→69 隔离恢复、只读核验和精确 CLI preview；实际 manifest 为空，所以 5.2 对本次候选为不适用，未人工造数据。

## 6. 窗口 A 生产执行前检查

> 只有用户已精确批准证据/文档 HEAD、运行候选 `74d5d244…` 和窗口 A 时才能执行。

### 6.1 已完成的候选前置证据（2026-07-19）

- 不可变运行候选：`74d5d2449ab9e4232f2625f2805c64b1686ff314`；后续仅文档证据 HEAD 必须与该 SHA 的运行树零差异。
- 精确 SHA 隔离 UAT：`task22-final-74d5d244-20260719a`，20/20，证据 SHA-256 `8e433478da8a2ea472c4997e949c00b88022da41ec77bff1560b5794cfe7e692`。
- 六视口精确截图：3/3 视觉用例、76 张 PNG，截图 manifest SHA-256 `46dbe0d0c0f5d293f052d3d792cb972635d53fdccaab4d48c3743dee05878f84`。
- 生产异机备份回读 SHA-256：`7a961c4caa0d07dd73f6076438610a21cd77603db6aeaf9d5c95670780e3462e`。
- 隔离恢复：生产 61 个迁移恢复成功，候选 61→69 成功，`prisma migrate status` 最新；113 张 public 表、54 个统一触发器、5 个统一函数、0 个旧函数。恢复执行原绑定 `e47129ba…`；已证明它到 `74d5d244…` 的 Prisma schema、migrations 和 transition 工具树零差异，因此恢复证据对当前运行候选等价，不得表述为在 `74d5d244…` 上重做了一次生产备份恢复。
- transition preview：0 项/0 阻断，digest `4cfe129a3db1737283bf593018dc88be5adf7a007d85db93a1c72e86108b6876`；本次无需 apply，不存在窗口 B 业务写入清单。
- 隔离库、checkout、bundle 和恢复输入均已清理；生产当前为 `89e434da7cde3ef30800b9f458b9b5ee59305de9` / `61|0|0`，API、Nginx、PostgreSQL、Cron 和公网 health 正常。
- 已知兼容性阻断：生产历史 `super_admin` ID 为非 UUID，CLI 当前只接受 UUID 操作人。由于 preview 为空，它不阻断窗口 A；若未来出现非空 manifest，它是窗口 B 前的强制阻断，必须先修复并重跑全部 transition 门禁。

1. 公网 Web/API health、Nginx、API、PostgreSQL、Cron 正常。
2. 空间、内存、时间同步、TLS 和防火墙正常。
3. 备份监控不是失败/陈旧状态。
4. 立即执行一次发布前本地+异机备份，验证 dump、checksum、收据、HEAD/GET 回读。
5. 备份必须先在 `jiangkong_restore_*` 恢复并绑定本次精确候选通过 61→69 迁移。
6. 生产 `git status`、当前 SHA、数据库已完成迁移数与发布前记录一致。
7. 当前 `JiangKongProdCosUploadsRW` 策略版本保持不变；不在本窗口删除非当前版本。

## 7. 窗口 A 发布后验证

1. `origin/main`、部署 workflow checkout SHA、服务器 HEAD 和用户批准 SHA 四者一致。
2. `prisma migrate status` 显示 M1–M69 全部完成，无失败记录；M69 引用清单和触发器均为 54。
3. API/Nginx/PostgreSQL 正常，内外网 health 正常，无新 error/fatal 日志。
4. 普通岗位最小冒烟：登录、主体只读/维护、五类合同候选、结算候选、通用合同付款选择、私有文件下载权限。
5. 只读查询确认迁移未自动终止或改写任何旧实例，付款/实付/入账计数不变。
6. 生产 transition 仍只允许 preview；没有窗口 B 授权时禁止 `--apply`。

## 8. 失败与回滚

### 应用或健康失败

- 迁移前失败：不停旧 API，不替换运行时。
- 迁移或新运行时失败：依既有发布脚本恢复旧 Web/API 快照并重做 health。
- 新格式业务事实已产生后：先停止写入并评估前向兼容修复，禁止盲目切回不识别新事实的旧代码。

### 数据库失败

- M52–M58 与 M69 不自动 down migration；先定界故障迁移，编写并在隔离库验证前向修复。
- 只有在数据不可前向修复且用户另行批准维护窗口后，才可以基于发布前备份恢复生产。
- 禁止对生产执行 `prisma migrate reset`。

### transition 失败

- 任一 manifest 漂移、权限、确认语或状态不匹配必须整批回滚，不允许手工跳过单行。
- 若已成功处理一批，不能通过删日志或回改状态伪造未执行；使用工具幂等重查和前向业务修复。

## 9. 执行记录模板

| 项目 | 回填 |
| --- | --- |
| 用户批准的窗口 | A；B 不存在且未执行 |
| 批准的证据/文档 HEAD | `4b5b6f0a7dbb0b3271b63d682b00967bd81e1452` |
| 批准的运行候选 SHA | `74d5d2449ab9e4232f2625f2805c64b1686ff314` |
| transition manifest SHA-256（仅窗口 B） | 不适用；生产只读 preview 0/0，临时 manifest SHA-256 `7928ffb175b9f60eb3d9d5cc17b588423da88f983f762968453d199fe96f51a4` 后已删除 |
| 执行人 | CodeX，经用户精确授权 |
| 开始/结束时间 | 2026-07-19 18:41–18:54 CST；独立复核随后完成 |
| 发布前备份/恢复证据 | `jiangkong-20260719-185424.dump`，521315 字节，checksum 与异机收据通过；发布前 61→69 隔离恢复证据沿用已审计候选收据 |
| 迁移前/后计数 | `61|0|0` → `69|0|0` |
| M69 引用清单/触发器计数 | 54 个引用、54 个触发器、5 个统一函数、0 个旧函数 |
| 隔离恢复数据库名 | 发布前已审计的 `jiangkong_restore_*` 隔离恢复；生产发布未新建恢复库 |
| 隔离库与临时 checkout 清理 | 发布前隔离资源已清理；发布后 preview 临时 checkout/manifest 已清理 |
| 工作流运行 ID | `29683793910`，成功 |
| 服务器 HEAD | `4b5b6f0a7dbb0b3271b63d682b00967bd81e1452` |
| 健康与冒烟结果 | API/Nginx/PostgreSQL/Cron active；Web/API 200；TLS 有效；发布后 error/alert 为空；备份监控 active/success |
| 已知问题 | 我方主体 0 条，4 个合同版本税务事实未确认；普通岗位真实账号矩阵和真实母版/业务长链仍待签认 |
| Go / No-Go 签认 | 技术窗口 A：Go；全面业务 Go-Live：待业务/财务签认 |
