# Task 6 草稿聚合 transition 生产授权包

日期：2026-07-30

## 当前结论

B/void 已完成后，Task 6 的唯一生产候选已从 blocking 转为 ready。当前尚未执行
transition，也没有切换维护模式。本文件是授权前证据，不构成生产写入授权。

transition 必须单独获批，因为它会：

1. 将合同工作台和历史接管写入切换为维护冻结；
2. 对 11 行真实生产清单回填六位不含税单价；
3. 写入一条批次审计；
4. 完成后继续保持维护冻结，直到 Release B 另行获批并通过烟测。

## 当前生产只读快照

- 生产 checkout：
  `6910cf0dfd48bc167dec5b0ad3d87e487df171c4`
- 数据库 fingerprint：
  `cea281848f875b0d683cf1998bffbd6b5b5661868fd7cbff3a27ccabee430225`
- 快照生成时间：`2026-07-29T16:12:07.420Z`
- 快照报告 SHA-256：
  `baa1101847fc2cc69ad385dd127f0a375814adf2a1f88e217c41e7e3b1a033cd`
- 精确版本：
  `722bb87e-700d-40d2-95b5-c82604cfb92c`
- revision：12
- readiness：`ready=1`、`manualReview=0`、`blocking=0`
- Prisma 迁移：109/109，失败 0，回滚 0
- 已有 `contract.draft_aggregate.transition` 收据：0
- 有效合同部主管：1
- `CONTRACT_CUTOVER_MODE`：`release-a`
- canary：0
- API、Nginx、PostgreSQL：active
- 回环 API health：`ok`

该报告只证明授权前快照，超过 30 分钟后不能用于 apply。正式执行必须在维护切换
前重新生成报告，并把 apply 绑定到新报告 SHA、数据库 fingerprint 和逐记录
revision。

## 精确写集合

当前精确版本包含：

| 事实 | 数量 |
| --- | ---: |
| Contract | 1 |
| ContractVersion | 1 |
| ContractBill | 1 |
| ContractBillRow | 11 |
| ContractPartySnapshot | 1 |
| PaymentTermsVersion | 1 |
| 草稿附件 | 0 |
| 生成文档 | 0 |
| 正式文件 | 0 |
| 归档文件 | 0 |

11 行 `taxExclusiveUnitPrice` 当前均为空；每行均同时具备权威
`taxExclusiveAmountCents`、非零 `quantity`，因此可按下式派生：

```text
taxExclusiveUnitPrice =
  round((taxExclusiveAmountCents / 100) / quantity, 6)
```

只读预演结果：

- 待派生：11 行
- 可精确派生：11 行
- 按派生六位单价重构到分的差异：0 行
- 权威数量/含税金额/不含税金额/税额快照 SHA-256：
  `d457337527ad4f69a252ac00b1c7282d11d4e0f0cd42d51c3e5555405b14cc36`
- 行 ID 与派生六位单价快照 SHA-256：
  `08dbe547b344c7912fcb75268b2df534fa0dcca2c5680f541b8aa6a769fdb994`

预期 transition 写入恰好 12：

1. 11 行只在当前值仍为空时回填 `taxExclusiveUnitPrice`；
2. 1 条 `contract.draft_aggregate.transition` 批次审计。

不在写集合内：

- 合同或清单金额；
- 数量、税率、含税/不含税金额、税额；
- `draftRevision`（保持 12）；
- 正式编号（保持空）；
- `firstSubmittedAt` 或审批实例；
- 主体、付款条款、附件、生成文档、正式文件或归档文件；
- checkpoint、历史实付、pending/approved unpaid；
- transition 之外任何业务记录。

## 本地工具门修复

生产操作者使用合法历史 seed 用户 ID。transition 工具原先只接受 UUID，并且没有
强制报告时效；两者都会破坏 Task 6 的正式执行门。

本轮先取得失败证据并锁定缺失门：

- seed 用户 ID 被 `actor-user-id` 参数门拒绝；
- 代码审计确认不存在报告时效校验，新增回归要求 31 分钟报告必须拒绝。

最小修复：

- 接受 1–128 位安全用户 ID 字符集，兼容 UUID 和历史 seed ID；
- 事务内仍锁定并验证操作者存在且 active；
- 报告必须是未截断 `read_only`；
- 报告生成时间必须不晚于当前时间且不超过 30 分钟；
- 原有 SHA、fingerprint、全量 ready、revision、锁内重算和 batch 幂等门不变。

验证：

- transition/readiness/正式编号处置目标 Jest：3 套 20/20；
- API 全量 Jest：251 套通过、15 套条件跳过；4,749 通过、38 跳过；
- API typecheck、lint、build：通过；
- transition 脚本语法与 `git diff --check`：通过。

## 建议批次与确认串

建议固定批次：

```text
contract-draft-aggregate-20260730-r12
```

精确确认串：

```text
TRANSITION_CONTRACT_DRAFT_AGGREGATE_contract-draft-aggregate-20260730-r12
```

正式执行仍必须从新报告读取：

- `expected-database-fingerprint`
- `expected-report-sha256`
- 精确记录 revision
- 唯一有效合同部主管用户 ID

不得复用本文件中的过期报告 SHA。

## 获批后的执行顺序

1. 推送并 fast-forward 包含 transition 门修复的精确候选；
2. 更新生产 checkout，保持工作树洁净；
3. 将 `CONTRACT_CUTOVER_MODE` 改为 `maintenance`，canary 清空；
4. 运行生产 readiness，重启 API；
5. 验证合同草稿、清单、文档和历史接管写入固定返回维护错误，GET/导出仍可用；
6. 重新生成 30 分钟内、未截断的只读报告；
7. 核对仍为精确版本、revision 12、11 行可派生、全量 ready；
8. 使用建议 batch、最新 fingerprint/报告 SHA、唯一有效合同部主管和精确确认串
   执行 Serializable transition；
9. 只读复核金额/文件/主体/付款条款计数与两个快照哈希；
10. 立即用同 batch 和同报告验证 `already_applied / writes=0`；
11. 保持 `maintenance`，不得恢复旧写或进入 Release B。

任一 revision、报告、金额哈希、派生哈希、记录数量、角色、服务或写门发生漂移，
均停止且不执行 apply。

## 需要的明确授权

若只授权 Task 6 transition，请明确包含：

- 允许推送和 fast-forward 本地 transition 门修复候选；
- 允许更新生产 checkout；
- 允许修改 `/etc/jiangkong/api.env` 的切换模式为 `maintenance`、清空 canary
  并重启 API；
- 接受合同工作台与历史接管写入在 Release B 前持续冻结；
- 允许对精确版本执行上述 11 行单价回填和 1 条批次审计；
- 允许立即执行同批次零写幂等复核；
- 允许只读健康、守恒和权限验收。

本授权不得隐含：

- Release B 前后端部署或 canary 真实业务写入；
- 恢复 `release-a` 旧写；
- transition 之外的真实业务修改；
- retention apply；
- 旧接口、小程序、数据库记录或 COS 对象的物理删除。
