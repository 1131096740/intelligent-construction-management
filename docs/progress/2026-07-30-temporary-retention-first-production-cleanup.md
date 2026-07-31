# 2026-07-30 temporary-only retention 首次生产清理回执

## 结论

本次只完成用户明确点名的 8 个未绑定临时文件首次清理。9 条合同清单导入预览没有删除，每日 04:30 timer 没有启用。

- 生产 checkout：`5234fd37bc5c320922f73323af77b20317fcf5f7`，clean
- 切换模式：`release-b`
- canary：0
- 首次清理报告 SHA-256：`2309261a9850baca0882b9cc1be8c9f449d961aeb69842d5bd806794feb399a6`
- 批次：`temporary-only-unbound-first-20260730-5234fd37`
- 结果：`applied`
- 删除候选：8
- 删除字节：2,247,112
- 失败：0
- 跳过：0
- 业务草稿 purge：0
- timer：disabled / inactive
- 专用配置：`/etc/jiangkong/draft-retention.env` 不存在
- 公网健康：`{"status":"ok","service":"jiangkong-api"}`

生产完整证据保存在 root-only 目录：

```text
/srv/jiangkong-retention-evidence/5234fd37bc5c320922f73323af77b20317fcf5f7/temporary-only-first-20260730
```

目录权限为 `700 root:root`，证据文件均为 `600 root:root`。报告和审计不输出 objectKey。

## 删除前只读冻结门

删除前确认：

1. checkout 为精确 SHA 且工作区干净；
2. API、Nginx、PostgreSQL active，公网 health 正常；
3. retention timer disabled/inactive、service inactive，专用 retention env 不存在；
4. 生产 systemd service/timer 与该 SHA 仓库文件一致；
5. 只读 preview 为 ready，扫描未截断；
6. 候选为 17 条、2,361,067 bytes：
   - `unbound_temporary_file`：8 条、2,247,112 bytes；
   - `contract_bill_import_preview`：9 条、113,955 bytes；
7. 17/17 候选逐条重扫均为 safe，无 truncated；
8. 8 个未绑定文件已通过统一业务绑定、收货照片和 replacement chain 检查；
9. 9 个导入预览对应 9 个唯一 FileObject，与 8 个未绑定文件零重叠；
10. 无 `business_draft` 候选；
11. 既有备份 `jiangkong-20260730-151236.dump` checksum OK，大小 1,005,167 bytes，`pg_restore --list` 1,658 行。本次未触发新备份。

只读源报告：

```text
generatedAt: 2026-07-30T08:02:56.128Z
expiresAt:   2026-07-30T08:32:56.128Z
reportSha:   efe3631bb463539e968dfa69a4472bf0b4ca9569074ab9f9d42fd6c060384403
```

## 授权边界收窄

原计划把以下动作合并执行：

1. 删除 8 个未绑定临时文件；
2. 删除 9 条超过 7 天的合同清单导入预览及其文件；
3. 持久启用 temporary-only 配置；
4. 启用每日 04:30、`Persistent=true` 的 timer。

授权审查认为用户原句只明确点名第 1 项，未把第 2 项及 timer 未来自动覆盖的全部临时类别说成可持续物理删除范围，因此合并命令在连接生产前被拦截。只读复核随后证明：

```text
/etc/jiangkong/draft-retention.env: absent
timer: disabled / inactive
service: inactive
```

没有把被拦截的合并动作改用其他方式执行。

随后生成只含 8 个 `unbound_temporary_file` 的新报告，再次逐条重扫 8/8 safe，以进程级临时开关执行：

```text
CONTRACT_DRAFT_TEMP_RETENTION_ENABLED=true
CONTRACT_DRAFT_BUSINESS_PURGE_ENABLED=false
```

该开关没有写入生产配置，apply 命令不带 `--include-business-purge`。

## 首次清理 receipt

```json
{
  "status": "applied",
  "reportSha256": "2309261a9850baca0882b9cc1be8c9f449d961aeb69842d5bd806794feb399a6",
  "deletedCount": 8,
  "deletedBytes": "2247112",
  "failedCount": 0,
  "skippedCount": 0,
  "businessPurgeSkippedCount": 0,
  "categoryResults": [
    {
      "category": "unbound_temporary_file",
      "result": "deleted",
      "count": 8
    }
  ]
}
```

## 删除后守恒

| 事实 | 删除前 | 删除后 | 结论 |
| --- | ---: | ---: | --- |
| Contract | 1 | 1 | 不变 |
| ContractVersion | 1 | 1 | 不变 |
| ContractDraftCheckpoint | 0 | 0 | 不变 |
| ApprovalInstance | 2 | 2 | 不变 |
| ContractFormalFile | 0 | 0 | 不变 |
| ContractArchiveFile | 0 | 0 | 不变 |
| ContractTakeover | 0 | 0 | 不变 |
| Settlement | 0 | 0 | 不变 |
| PaymentRequest | 0 | 0 | 不变 |
| PaymentExecution | 0 | 0 | 不变 |
| ContractBillImport | 11 | 11 | 9 条预览未删 |
| ContractDraftSaveRequest | 2 | 2 | 七天技术回执未删 |
| FileObject | 33 | 25 | 精确减少 8 |
| FileObject `deleting` | — | 0 | 无残留 |
| AuditLog | 346 | 347 | 仅新增 1 条 retention 批次审计 |

清理后 fresh preview 为 ready、未截断，剩余候选精确为：

```text
contract_bill_import_preview: 9
candidateBytes: 113955
business_draft: 0
```

## 仍关闭的范围

- 9 条现有合同清单导入预览及其文件；
- future temporary-only timer apply；
- 业务草稿 purge；
- 正式业务记录物理删除；
- AuditLog 物理删除；
- checkpoint 物理删除；
- 旧表、旧字段物理删除。

如要继续完成原目标，需要用户明确授权：

```text
确认将当前 9 条 contract_bill_import_preview 及其 9 个唯一临时文件纳入首次清理，并允许启用每日 04:30（AccuracySec=5min、RandomizedDelaySec=15min、Persistent=true）timer；timer 未来仅自动清理既定 temporary-only 类别：超过 24 小时且重扫无任何业务引用的未绑定文件、超过 7 天的临时导入/预览与七天技术保存回执、满足既定规则的渲染中间件和被更新草稿预览。业务草稿 purge、正式业务记录、AuditLog、checkpoint、旧表旧字段仍禁止物理删除。
```

## 21:34+08:00 新授权后的只读漂移复核

用户随后授权“开启 temporary-only retention”，但执行范围仍明确以“先只读核对
8 个未绑定临时文件”为前置。生产只读重扫证明该对象集合已经不再存在：

- checkout：`5234fd37bc5c320922f73323af77b20317fcf5f7`，clean；
- API、Nginx、PostgreSQL：active；
- retention timer：disabled / inactive；
- retention service：inactive；
- `/etc/jiangkong/draft-retention.env`：absent；
- preview 生成时间：`2026-07-30T13:34:50.741Z`；
- preview 到期时间：`2026-07-30T14:04:50.741Z`；
- preview SHA-256：
  `4a404ce8f4b0726bb1cdcde2ffc830c38c2c23e3132646ca7eec2d4f2da3b7c5`；
- preview：ready、未截断；
- 当前候选：9 个 `contract_bill_import_preview`、113,955 bytes；
- `unbound_temporary_file`：0。

这 9 个候选与已消费授权并清理完成的原 8 个未绑定文件不是同一对象集合。每日
04:30 timer 配置了 `Persistent=true`；在当前时间启用可能立即补跑，并对这 9
个及未来六类 temporary-only 对象执行物理清理。因此本轮在漂移门停住，没有
保存 preview、没有 apply、没有创建 retention env、没有 enable/start timer，
也没有修改业务数据或文件。

继续所需的精确授权仍为：

```text
确认删除当前 9 个 contract_bill_import_preview，并授权 04:30 timer 未来仅自动清理既定 6 类 temporary-only 对象；业务草稿 purge、正式业务记录、审计、checkpoint、旧表旧字段仍关闭。
```

## 23:14+08:00 精确授权后的首次全范围清理与 timer 启用

用户随后逐字确认当前 9 条 `contract_bill_import_preview` 及未来既定六类
temporary-only 自动清理范围。写入前重新执行完整失败关闭门：

- 生产 checkout：`5234fd37bc5c320922f73323af77b20317fcf5f7`，clean；
- API、Nginx、PostgreSQL：active，公网 health 正常；
- 既有备份 `jiangkong-20260730-151236.dump`：
  - 1,005,167 bytes、root:root 600；
  - checksum OK；
  - `pg_restore --list` 1,658 项；
  - 异机回执的对象键、备份 SHA、checksum SHA 和大小与本地工件一致；
- fresh preview：
  - generatedAt：`2026-07-30T15:09:11.838Z`；
  - expiresAt：`2026-07-30T15:39:11.838Z`；
  - SHA-256：`06d11e49fd84c909f331d54f1e09ac1b41a5c4cc261670dceec03f8206fe2a6e`；
  - ready、未截断；
  - 精确 9 条、113,955 bytes；
  - 唯一类别为 `contract_bill_import_preview`；
  - 唯一种类为 `contract_bill_import_file_record`；
- apply 前 9/9 逐条重扫均 `safe=true`，无 truncated、无业务绑定或其他文件引用，
  且每条精确关联一个唯一临时文件。

固定批次：

```text
temporary-only-import-preview-first-20260730-5234fd37
```

返回：

```json
{
  "status": "applied",
  "reportSha256": "06d11e49fd84c909f331d54f1e09ac1b41a5c4cc261670dceec03f8206fe2a6e",
  "deletedCount": 9,
  "deletedBytes": "113955",
  "failedCount": 0,
  "skippedCount": 0,
  "businessPurgeSkippedCount": 0,
  "categoryResults": [
    {
      "category": "contract_bill_import_preview",
      "result": "deleted",
      "count": 9
    }
  ]
}
```

删除前后守恒：

| 事实 | 删除前 | 删除后 | 结论 |
| --- | ---: | ---: | --- |
| Contract | 2 | 2 | 不变 |
| ContractVersion | 2 | 2 | 不变 |
| ContractDraftCheckpoint | 0 | 0 | 不变 |
| ApprovalInstance | 2 | 2 | 不变 |
| ContractFormalFile | 0 | 0 | 不变 |
| ContractArchiveFile | 0 | 0 | 不变 |
| ContractTakeover | 1 | 1 | 不变 |
| Settlement | 0 | 0 | 不变 |
| PaymentRequest | 0 | 0 | 不变 |
| PaymentExecution | 0 | 0 | 不变 |
| ContractBill | 1 | 1 | 不变 |
| ContractBillImport | 11 | 2 | 精确减少 9 条临时导入预览 |
| ContractDraftSaveRequest | 2 | 2 | 不变 |
| ContractGeneratedDocument | 0 | 0 | 不变 |
| SettlementImport | 0 | 0 | 不变 |
| SettlementTemplatePreviewJob | 0 | 0 | 不变 |
| ContractLayoutPreviewJob | 4 | 4 | 不变 |
| FileObject | 26 | 17 | 精确减少 9 个临时文件 |
| FileObject `deleting` | 0 | 0 | 无残留 |
| AuditLog | 350 | 351 | 仅新增唯一 retention 批次审计 |

删除后 fresh preview 为 ready、未截断、0 条/0 bytes。唯一批次审计的
report SHA、deleted/failed/skipped/business purge 和类别计数与 apply receipt
完全一致。

随后原子创建：

```text
/etc/jiangkong/draft-retention.env
```

权限为 root:root 600，内容精确为：

```text
CONTRACT_DRAFT_TEMP_RETENTION_ENABLED=true
CONTRACT_DRAFT_BUSINESS_PURGE_ENABLED=false
```

仓库与 `/etc/systemd/system` 中的 service/timer 字节一致；timer 已
`enabled/active/waiting`，service 保持 oneshot `inactive/dead`，首次启动未发生
`Persistent=true` 补跑，下一次为 `2026-07-31 04:30:23 +08:00`。

未来 timer 只覆盖既定六类 temporary-only：

1. `unbound_temporary_file`；
2. `contract_bill_import_preview`；
3. `settlement_contract_import_preview`；
4. `render_intermediate_file`；
5. `contract_draft_preview_superseded`；
6. `contract_draft_save_receipt`。

业务草稿 purge、正式业务记录、AuditLog、checkpoint、旧表和旧字段物理删除仍
保持关闭。生产 root-only 完整证据目录：

```text
/srv/jiangkong-retention-evidence/5234fd37bc5c320922f73323af77b20317fcf5f7/temporary-only-enable-20260730
```

## 2026-07-31 08:05+08:00 首次自然 timer 只读验收

每日 timer 已在未人工触发的情况下完成首次自然运行：

- 生产 checkout 仍为洁净
  `5234fd37bc5c320922f73323af77b20317fcf5f7`；
- API、Nginx、PostgreSQL 与公网 health 均正常；
- timer 为 `enabled / active / waiting`；
- 首次自然触发：`2026-07-31 04:30:23 +08:00`；
- service 于 `04:30:24` 正常退出，`Result=success`、
  `ExecMainStatus=0`；
- 下一次计划时间：`2026-08-01 04:33:15 +08:00`；
- 专用配置仍精确为
  `CONTRACT_DRAFT_TEMP_RETENTION_ENABLED=true`、
  `CONTRACT_DRAFT_BUSINESS_PURGE_ENABLED=false`；
- 仓库与 `/etc/systemd/system` 的 service/timer SHA-256 逐一一致。

自然运行回执：

```json
{
  "status": "applied",
  "reportSha256": "4788f9a3bd44ffa3bac3aa1122bb483ac8ba4d5813572c1fcb30b8f708f31e1c",
  "deletedCount": 0,
  "deletedBytes": "0",
  "failedCount": 0,
  "skippedCount": 0,
  "businessPurgeSkippedCount": 0,
  "categoryResults": []
}
```

随后生成的只读 preview（`2026-07-31T00:05:13.499Z`）为 ready、未截断，
SHA-256 为
`2a9449a5db70d6ddcf47a7baf3e16a0cd7ba4ebb7f471130fff49a004397a8a7`，
候选仍为 0 条/0 bytes。由此确认首次删除没有重复执行，timer 没有越界到业务
草稿或其他关闭范围。
