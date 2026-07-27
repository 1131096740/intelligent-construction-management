# 合同清单与结算 V2 历史预检、人工确认与回填

本运行手册只说明工具使用，不授权连接生产、执行迁移或改写业务记录。

## 1. 只读预检

在隔离恢复库执行：

```bash
pnpm --filter @jiangkong/api precheck:contract-settlement-v2 -- --output /安全目录/precheck.json
```

预检在 `RepeatableRead` 事务中执行 `SET TRANSACTION READ ONLY`。报告仅输出稳定 ID、状态、原因、数量和摘要，不输出连接串、密码或业务正文。缺失结算方式、lineage 或期间均为 `manual_review`；工具不会按合同类型、名称、规格或编号猜测。

## 2. 人工确认清单

人工确认程序必须基于预检报告创建单独 JSON 清单。清单只能选择报告中的 `manual_review` 项：

- `settlementModes`：明确的合同版本和结算方式；
- `newLineages`：经人工确认的新稳定 lineage 及其合同、创建版本；
- `lineageAssignments`：清单行到既有或新 lineage 的精确映射。

清单必须保留预检摘要、目标数据库 16 位指纹、批次号和自身 SHA-256 摘要。存在过程冲突、孤立文件或任何未消除的阻断项时，不创建回填清单。

## 3. 隔离库写入与复跑

仅在预检、备份和隔离恢复演练完成后，才可执行：

```bash
pnpm --filter @jiangkong/api backfill:contract-settlement-v2 -- \
  --apply --manifest /安全目录/manual-confirmed.json \
  --batch-id <与清单完全一致> \
  --confirm-target <预检报告中的16位指纹> \
  --operator-user-id <操作者UUID> \
  --confirm ALLOW_CONTRACT_SETTLEMENT_V2_BACKFILL
```

工具要求五重门禁：`--apply`、清单路径、批次号、目标指纹、操作者 UUID 与精确确认串。写入使用可串行化事务、空值 CAS 和审计收据；再次执行相同清单只统计既有事实，遇到不一致立即拒绝覆盖。

生产回填仍须另行取得用户对精确候选 SHA、目标环境、备份、隔离恢复演练和业务回填的授权。
