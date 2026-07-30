# 合同草稿聚合 transition 生产执行收据

日期：2026-07-30

## 结论

用户已按精确候选
`0619dce268280fe169d34f75cc8ba758bad4c2a5` 授权 Task 6 transition：

- 推送候选分支并将 `main` fast-forward；
- 更新生产 `/opt/jiangkong` checkout；
- 将 `CONTRACT_CUTOVER_MODE` 切换为 `maintenance`、清空 canary 并重启 API；
- 对版本 `722bb87e-700d-40d2-95b5-c82604cfb92c` 使用批次
  `contract-draft-aggregate-20260730-r12`；
- 只写 11 行 `taxExclusiveUnitPrice` 和 1 条 transition 审计；
- 立即执行同报告、同批次零写幂等复核；
- 保持合同工作台与历史接管写入冻结直到 Release B。

上述范围已全部成功执行。生产继续停在 `maintenance`，未执行 Release B、
retention、其他真实业务写入、数据库迁移、API/Web 运行时部署或任何物理删除。

## Git 与生产 checkout

- `origin/codex/whole-site-five-packages`：
  `0619dce268280fe169d34f75cc8ba758bad4c2a5`
- `origin/main`：
  `0619dce268280fe169d34f75cc8ba758bad4c2a5`
- 生产 `/opt/jiangkong`：
  `0619dce268280fe169d34f75cc8ba758bad4c2a5`
- 生产分支：`main`
- 生产工作树：洁净
- 快进前共同 SHA：
  `6910cf0dfd48bc167dec5b0ad3d87e487df171c4`
- 快进提交数：1
- 未使用强推、rebase 或非 fast-forward 合并。

本次候选仅增加 transition 报告时效/未截断门、兼容安全历史操作者 ID、回归测试
和授权文档；没有 Schema 或迁移变化。

## maintenance 切换

切换前生产 readiness 为：

- `CONTRACT_CUTOVER_MODE=release-a`（环境文件未显式配置时的安全默认值）；
- canary 0；
- 其余生产环境检查无 FAIL。

原环境文件保全为：

```text
/etc/jiangkong/api.env.before-contract-draft-aggregate-20260730-r12
```

随后以保全副本生成新环境文件并原子替换：

```text
CONTRACT_CUTOVER_MODE=maintenance
CONTRACT_CUTOVER_CANARY_USER_IDS=
```

重启前 readiness 证明 mode 为 `maintenance`、canary 未启用且无 FAIL。API 重启后
运行进程环境再次证明 `maintenance` / canary 0；API、Nginx、PostgreSQL 均为
active。

首次尝试切换时远端引号被本地 shell 提前截断。该命令在环境文件写入、readiness
和 API 重启前失败关闭；只生成了原环境备份与一个 0 字节暂存文件。只读复核证明：

- `/etc/jiangkong/api.env` 仍无两项切换配置；
- API 仍 active、health 为 `ok`；
- 生产 checkout 仍为精确候选。

0 字节暂存文件未物理删除，已可逆移入本批次证据目录，命名为
`failed-empty-env-staging-preserved`。随后采用分步暂存、核对、原子替换流程成功
完成切换。

## 最新只读报告

正式 apply 使用 maintenance 切换后的新报告，没有复用授权包中的过期报告：

- 生成时间：`2026-07-30T02:11:55.571Z`
- 报告 SHA-256：
  `8c91fa591a9bb2dff9a35530617a004c0a0860734df9c8d89158ec1e4c92f0ef`
- 数据库 fingerprint：
  `cea281848f875b0d683cf1998bffbd6b5b5661868fd7cbff3a27ccabee430225`
- 迁移头：
  `20260728138000_project_affiliate_company_contract`
- 模式：`read_only`
- 截断：否
- 状态：`ready`
- 汇总：`ready=1`、`manualReview=0`、`blocking=0`
- 精确版本：
  `722bb87e-700d-40d2-95b5-c82604cfb92c`
- revision：12
- 缺失不含税单价：11
- 不可精确派生：0
- 提交事实：无
- 正式编号：空
- 原正式编号处置：继续由 B/void 审计保留，序号不复用。

正式执行时报告年龄为 168 秒，满足 30 分钟门。

## 写前精确集合

写前只读 Repeatable Read 核对结果：

| 事实 | 数量 |
| --- | ---: |
| Contract | 1 |
| ContractVersion | 1 |
| ContractBill | 1 |
| ContractBillRow | 11 |
| ContractPartySnapshot | 1 |
| PaymentTermsVersion | 1 |
| ContractDraftAttachment | 0 |
| ContractGeneratedDocument | 0 |
| ContractFormalFile | 0 |
| ContractArchiveFile | 0 |
| ContractTakeover | 0 |
| 既有 transition 审计 | 0 |

金额与派生证据：

- 11 行当前 `taxExclusiveUnitPrice` 均为空；
- 11 行均可由权威不含税金额与非零数量派生六位值；
- 按派生值重构到分差异：0；
- 数量及三类权威金额 SHA-256：
  `d457337527ad4f69a252ac00b1c7282d11d4e0f0cd42d51c3e5555405b14cc36`
- 行 ID 与派生六位单价 SHA-256：
  `08dbe547b344c7912fcb75268b2df534fa0dcca2c5680f541b8aa6a769fdb994`
- 唯一有效合同部主管：1；
- 操作者 ID 仅以 SHA-256 留痕：
  `8caaa4fce00371b273b24af8ef18b16c608aac95e0c14425395d3718b5758d7d`
- 预期写入：12。

## Apply 与同批次零写

确认串：

```text
TRANSITION_CONTRACT_DRAFT_AGGREGATE_contract-draft-aggregate-20260730-r12
```

首次 Serializable 事务结果：

```json
{
  "status": "applied",
  "batchId": "contract-draft-aggregate-20260730-r12",
  "selected": 1,
  "processed": 1,
  "writes": 12
}
```

12 次写入精确为：

1. 11 行原值仍为空的 `taxExclusiveUnitPrice` 回填；
2. 1 条 `contract.draft_aggregate.transition` 审计。

立即以同报告、同 fingerprint、同操作者、同 batch 和同确认串再次执行：

```json
{
  "status": "already_applied",
  "batchId": "contract-draft-aggregate-20260730-r12",
  "selected": 1,
  "processed": 0,
  "writes": 0
}
```

## 写后守恒

写后只读 Repeatable Read 核对通过：

- revision 保持 12；
- 状态保持 `draft`；
- 正式编号保持空；
- `firstSubmittedAt` 保持空；
- 合同审批实例保持 0；
- 合同、版本、清单、主体、付款条款、附件、文档、正式文件、归档文件和接管记录
  的数量均与写前一致；
- 11 行缺失不含税单价变为 0；
- 11 行当前单价与授权派生值逐行一致；
- 按当前单价重构到分差异为 0；
- 权威金额 SHA 保持
  `d457337527ad4f69a252ac00b1c7282d11d4e0f0cd42d51c3e5555405b14cc36`；
- 当前单价 SHA 为
  `08dbe547b344c7912fcb75268b2df534fa0dcca2c5680f541b8aa6a769fdb994`；
- transition 审计总数恰好 1，同 batch 审计恰好 1；
- 审计操作者仍为有效合同部主管；
- 审计绑定本次报告 SHA、revision 12 和 11 行派生；
- 审计明确：
  `firstSubmittedAtDerived=false`、
  `initializedContractFacts=false`、
  `initializedFinanceFacts=false`、
  `checkpointCopied=false`、
  `historicalPendingConvertedToPaid=false`。

写后 readiness：

- 生成时间：`2026-07-30T02:16:52.529Z`
- 报告 SHA-256：
  `5f97c0c7da8da33c23239f3668b426c62f9dfcaea186e14d1cfe0c3b7936c175`
- `ready=1`、`manualReview=0`、`blocking=0`
- revision 12
- 缺失不含税单价 0
- 不可派生 0
- 无原因项。

## 在线冻结与健康验收

在线验收使用 60 秒内存访问令牌，不调用登录接口、不落盘令牌、不生成登录审计。
负向请求使用空载荷，并在请求前后对版本、清单、save request、接管和目标审计做
同一快照比较：

- 聚合工作台 GET：HTTP 200，目标版本匹配；
- 合同工作台 PATCH：HTTP 503，
  `CONTRACT_CUTOVER_MAINTENANCE`；
- 历史接管 POST：HTTP 503，
  `CONTRACT_CUTOVER_MAINTENANCE`；
- 请求前后目标状态完全一致；
- 未调用生产登录接口；
- 未持久化临时令牌。

基础健康：

| 验收项 | 结果 |
| --- | --- |
| 生产/远端 SHA | main、候选和 `/opt/jiangkong` 均为 `0619dce2…` |
| API / Nginx / PostgreSQL | active / active / active |
| 内网 API health | `ok` |
| 公网 HTTPS API health | `ok` |
| HTTP → HTTPS | 301 |
| 未认证 `/projects` | 401 |
| 运行进程 mode / canary | maintenance / 0 |
| 近期严格运行健康 | `runtime health ok` |
| Prisma | 109 个迁移，schema up to date |
| retention timer | disabled / inactive |
| retention service | inactive |

首次迁移状态命令误由 root Corepack 选择 pnpm 11，在 Node 20 加载
`node:sqlite` 前失败；它没有进入 Prisma 或连接数据库。随后以 Node 20 直接调用
仓库锁定的 Prisma 5.22 CLI，只读确认 109/109 与 schema up to date。

## 证据位置与剩余门

生产 root-only 证据目录：

```text
/srv/jiangkong-transition-evidence/contract-draft-aggregate-20260730-r12
```

其中保留：

- apply 前 readiness；
- 精确写前哈希/计数；
- apply 与同批次零写收据；
- 写后守恒；
- 写后 readiness；
- maintenance 在线读写门；
- 失败空暂存文件的保全事实。

原环境备份继续保留在
`/etc/jiangkong/api.env.before-contract-draft-aggregate-20260730-r12`。

当前仍未获授权、未执行：

1. Release B、`release-b-maintenance` 或任何 canary 真实业务写入；
2. 恢复 `release-a` 旧写；
3. retention preview/apply 或 timer enable/start；
4. transition 之外的真实业务写入；
5. 旧接口、小程序、数据库记录或 COS 对象的物理删除。

下一合法步骤是保持 `maintenance`，等待 Release B 的独立精确授权。
