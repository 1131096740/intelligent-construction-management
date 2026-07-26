# 合同清单跨版本与结算工作台 V2 数据模型前向迁移与历史回填方案

| 项目 | 内容 |
| --- | --- |
| 方案编号 | `JGZG-CSWV2-DM-001` |
| 版本 | `1.0` |
| 状态 | 已确认、实施基线 |
| 对应规格 | `JGZG-CSWV2-SPEC-001` |
| 数据库 | PostgreSQL + Prisma |
| 迁移原则 | 先新增、双读写、回填核验、再收紧；不覆盖历史事实 |

本方案定义目标数据模型、前向迁移顺序、历史回填算法、回滚策略和授权边界。它不授权连接生产，也不授权执行任何生产业务数据回填。

## 1. 当前基线

截至本方案固化时，代码基线具有以下事实：

| 当前模型/路径 | 已有能力 | V2 缺口 |
| --- | --- | --- |
| `ContractVersion` | 版本、金额、状态、付款条款和合同治理事实 | 没有结算模式 |
| `ContractBillRow` | 单清单内 `rowKey` 唯一，数量/单价可保留 6 位 | 没有稳定跨版本身份 |
| 合同变更复制 | 克隆清单并保留 `rowKey` | 没有正式来源关系和历史占用结转 |
| 合同 Excel | `replace/update/append`，替换模式生成新 `rowKey` | 整表替换切断跨版本关系 |
| `SettlementDraft` | `lines` JSON、修订、提交和作废事实 | 没有结构化草稿行和日期期间 |
| `Settlement`/`SettlementLine` | 正式结算和关联合同清单行 | 只引用某一版本的物理行 |
| 结算来源查询 | 当前版本行、当前版本结算占用 | 不扣减旧合同版本有效结算 |
| `PaymentRequest` | 已支持 `settlement`、`contract_advance`、`contract_due` | 未由合同结算模式统一约束 |
| `SettlementSignedDocument` | SHA、页数、修订、声明、签名合成 | 文件事实和规范化派生口径需补齐 |

当前生产记录数、迁移状态和历史数据形态属于易变事实，必须在实际执行前重新只读核验；本文件不使用旧快照代替届时证据。

## 2. 总体策略

### 2.1 四个阶段

```text
M1 仅新增 Schema
  -> R1 应用双读写与新数据闭环
  -> B1 独立历史回填与人工确认
  -> M2 约束验证和新写入收紧
```

- `M1` 只新增字段、表、索引、外键和 `NOT VALID` 检查约束。
- `R1` 先让新合同、新清单、新结算完整写入 V2 模型，同时保留旧读路径兜底。
- `B1` 是独立的业务数据作业，必须预检、备份、隔离恢复演练和单独授权。
- `M2` 只在覆盖率、歧义和读写一致性达到门禁后验证约束；删除旧字段不在本方案范围。

### 2.2 权威事实与派生事实

- 历史 `SettlementLine` 是历史结算数量和金额的权威事实。
- `ContractBillRowTransition` 是相邻版本关系和分配的权威事实。
- `ContractBillRowCarryForward` 是合同版本生效时冻结的加速快照，可由前两类事实重建，但生效后不得原地编辑。
- `SettlementDraftLine` 是 V2 草稿权威事实；兼容期 `SettlementDraft.lines` 是旧客户端快照。
- 前端合计、Excel 公式和浏览器本地恢复都不是数据库权威事实。

## 3. 目标逻辑模型

### 3.1 现有表新增字段

#### `Contract`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `settlementClosedAt` | `DateTime?` | 是 | 最终结算生效后关闭入口 |
| `finalSettlementId` | `String? @unique` | 是 | 冻结关闭入口的最终结算 |

#### `ContractVersion`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `settlementMode` | `String?` | 是 | `settlement_required/direct_payment` |
| `settlementModeSource` | `String?` | 是 | `user/rule/backfill` |
| `settlementModeConfirmedByUserId` | `String?` | 是 | 合同部主任确认人 |
| `settlementModeConfirmedAt` | `DateTime?` | 是 | 确认时间 |

检查约束：

```text
settlementMode IS NULL
OR settlementMode IN ('settlement_required', 'direct_payment')
```

非空收紧必须等历史回填完成后另行进入 `M2`，不能在首次迁移中强制。

#### `ContractBillRow`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `lineageId` | `String?` | 是 | 稳定业务行身份 |
| `remainderDisposition` | `String?` | 是 | `active/cancelled` |
| `remainderDispositionReason` | `String?` | 是 | 取消未实施余量原因 |
| `remainderDispositionByUserId` | `String?` | 是 | 确认人 |
| `remainderDispositionAt` | `DateTime?` | 是 | 确认时间 |

`rowKey` 继续保留，不更名、不批量重写。

#### `SettlementDraft`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `processId` | `String? @unique` | 是 | 跨草稿/正式结算的业务过程 |
| `periodStart` | `DateTime? @db.Date` | 是 | 后台计算开始日 |
| `periodEnd` | `DateTime? @db.Date` | 是 | 用户选择结束日 |
| `finalDeclarationVersion` | `Int?` | 是 | 总体声明版本 |
| `finalDeclarationSnapshot` | `Json?` | 是 | 声明和自动检查快照 |
| `calculationVersion` | `Int?` | 是 | 权威计算器版本 |
| `sourceSnapshotToken` | `String?` | 是 | 清单来源和占用快照 |

旧 `lines`、五项最终确认和手工累计金额字段保留。

#### `Settlement`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `processId` | `String? @unique` | 是 | 对应业务过程 |
| `periodStart` | `DateTime? @db.Date` | 是 | 冻结开始日 |
| `periodEnd` | `DateTime? @db.Date` | 是 | 冻结结束日 |
| `finalDeclarationVersion` | `Int?` | 是 | 最终声明版本 |
| `finalDeclarationSnapshot` | `Json?` | 是 | 提交时声明/检查 |
| `calculationVersion` | `Int?` | 是 | 计算器版本 |
| `sourceSnapshotToken` | `String?` | 是 | 提交时来源快照 |

新增索引：

```text
Settlement(contractId, status)
Settlement(contractId, periodEnd)
SettlementDraft(contractId, status)
```

#### `SettlementLine`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `lineKey` | `String?` | 是 | 从草稿继承的稳定行键 |
| `contractBillRowLineageId` | `String?` | 是 | 跨版本来源 |
| `sourceContractVersionId` | `String?` | 是 | 来源合同版本快照 |
| `sourceItemType` | `String?` | 是 | 签证/变更项目类型 |
| `occurredOn` | `DateTime? @db.Date` | 是 | 发生日期 |
| `description` | `String?` | 是 | 情况说明 |
| `pricingBasis` | `String?` | 是 | 计价依据 |
| `relatedSettlementLineId` | `String?` | 是 | 负向/补差来源 |
| `overageReason` | `String?` | 是 | 框架超量说明 |

正式行仍保留 `contractBillRowId`、数量、单价快照、金额和税额。

#### `ContractBillImport`

| 字段 | 类型 | 初始可空 | 用途 |
| --- | --- | --- | --- |
| `fileSha256` | `String?` | 是 | 冻结输入文件 |
| `sourceContractVersionId` | `String?` | 是 | 对比来源版本 |
| `targetContractVersionId` | `String?` | 是 | 待应用版本 |
| `expectedBillRevision` | `Int?` | 是 | 乐观并发 |
| `mappingStatus` | `String?` | 是 | `resolved/pending/rejected` |
| `idempotencyKeyDigest` | `String?` | 是 | 幂等审计 |

旧 `mode` 保留为兼容字段；V2 新导入固定写入 `version_replace`。

#### `SettlementImport`

新增 `settlementDraftId`、`expectedDraftRevision` 和 `idempotencyKeyDigest`，用于将正确行应用到指定草稿并保留错误行。

#### `SettlementSignedDocument`

新增：

- `fileFactsSnapshot Json?`；
- `reviewSnapshot Json?`；
- `reviewedByUserId String?`；
- `reviewedAt DateTime?`；
- `derivedFromDocumentId String?`；
- `normalizationStatus String?`。

原件和规范化派生件使用不同记录和不同 `purpose`，不覆盖原 `fileId`。

### 3.2 新表

#### `ContractBillRowLineage`

| 字段 | 约束 |
| --- | --- |
| `id` | UUID 主键 |
| `contractId` | 必填，`ON DELETE RESTRICT` |
| `createdInContractVersionId` | 必填 |
| `status` | `active/retired` |
| `createdByUserId` | 新业务行必填；历史回填可记录批次操作者 |
| `createdAt/updatedAt` | 必填 |

索引：`(contractId, status)`、`createdInContractVersionId`。

#### `ContractBillRowTransition`

每条记录表示相邻合同版本的一条来源边。

| 字段 | 说明 |
| --- | --- |
| `contractId` | 所属合同 |
| `fromContractVersionId/toContractVersionId` | 必须是同合同相邻版本 |
| `sourceContractBillRowId/targetContractBillRowId` | 来源和目标物理行 |
| `relationType` | `one_to_one/split/merge` |
| `matchBasis` | `clone_row_key/manual/excel_mapping/backfill_row_key` |
| `sourceSettledQuantityAllocated` | 从来源分出的历史数量 |
| `targetOpeningQuantity` | 换算到目标单位的期初数量 |
| `settledAmountAllocatedCents` | 历史金额分配 |
| `quantityConversionBasis` | 单位不一致时必填 |
| `status` | `draft/confirmed/invalidated` |
| `confirmedByUserId/confirmedAt` | 合同部主任确认事实 |
| `revision` | 乐观并发 |

唯一约束：

```text
(fromContractVersionId, toContractVersionId,
 sourceContractBillRowId, targetContractBillRowId)
```

所有外键使用 `RESTRICT`，不级联删除历史行。

#### `ContractBillRowCarryForward`

合同版本生效时为每个目标行冻结一条期初快照。

| 字段 | 说明 |
| --- | --- |
| `contractVersionId` | 目标版本 |
| `contractBillRowId` | 目标行，唯一 |
| `lineageId` | 目标来源身份 |
| `priorSettledQuantity` | 历史承接数量 |
| `priorSettledAmountCents` | 历史承接金额 |
| `sourceSnapshotHash` | 历史结算和映射事实摘要 |
| `generatedAt` | 生成时间 |
| `confirmedByUserId/confirmedAt` | 复杂映射确认事实 |

快照只在版本生效事务内创建。生效后更正历史业务必须使用补偿性结算或新合同版本，不原地改快照。

#### `ContractSettlementProcess`

该表提供跨 `SettlementDraft` 和 `Settlement` 的唯一业务过程。

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `contractId` | 所属合同 |
| `sequenceNo` | 合同内期次 |
| `contractVersionId` | 发起时有效版本 |
| `settlementDraftId` | 草稿，可空且唯一 |
| `settlementId` | 正式结算，可空且唯一 |
| `status` | `open/effective/voided/invalidated` |
| `periodStart/periodEnd` | 结构化期间 |
| `isFinal` | 是否最终结算 |
| `endedAt` | 结束时间 |
| `endedByUserId/endedReason` | 作废或失效事实 |
| `invalidatedByContractVersionId` | 使旧草稿失效的新版本 |
| `createdAt/updatedAt` | 审计时间 |

约束和索引：

```sql
UNIQUE ("contractId", "sequenceNo");

CREATE UNIQUE INDEX "ContractSettlementProcess_one_open_per_contract_idx"
ON "ContractSettlementProcess" ("contractId")
WHERE "status" = 'open';

CHECK ("periodEnd" >= "periodStart");
```

创建过程仍必须锁定 `Contract` 行。部分唯一索引是最终并发兜底，不能被前端检查替代。

#### `SettlementDraftLine`

| 字段 | 说明 |
| --- | --- |
| `settlementDraftId/lineKey` | 联合唯一 |
| `sourceType` | `contract_bill_row/signature_change/adjustment` |
| `contractBillRowId/contractBillRowLineageId` | 合同清单来源 |
| `relatedSettlementLineId` | 负向或追溯调价来源 |
| `sourceItemType/occurredOn` | 签证/变更事实 |
| `name/description/unit` | 明细内容 |
| `quantity/unitPriceCents/directAmountCents` | 数量计价或直接金额 |
| `calculationMode` | `quantity_price/direct_amount` |
| `pricingBasis/overageReason/reason/remark` | 依据和说明 |
| `sortOrder` | 稳定排序 |
| `createdAt/updatedAt` | 审计时间 |

数据库检查只做稳定结构约束，复杂金额、上限、来源占用和精度由共享后台计算器在事务中校验。

#### `SettlementLineAttachment`

附件记录必须恰好绑定 `SettlementDraftLine` 或 `SettlementLine` 之一，保存 `fileId`、用途、状态、上传人和时间。提交时复制绑定关系，不移动或覆盖原文件。

该表的 `fileId` 必须加入统一文件业务绑定清单和敏感下载权限检查。

#### `SettlementRecoveryBalance`（P2）

每份有效负金额结算创建一条正数口径的待处理余额：

- `settlementId @unique`；
- `originalAmountCents`；
- `resolvedAmountCents`；
- `outstandingAmountCents`；
- `status open/partially_resolved/resolved`；
- `revision`。

检查：三个金额均非负，`resolved + outstanding = original`。

#### `SettlementRecoveryEntry`（P2）

记录 `refund/offset/reversal`，包括余额、金额、发生日、关联付款/抵扣对象、凭证文件、操作者、幂等键和反向来源。删除被禁止，更正只能新增 `reversal`。

## 4. 写路径切换

### 4.1 合同草稿和合同变更

1. 新合同草稿写入结算模式建议；合同部主任确认后更新确认事实。
2. 合同变更克隆模式、清单和 `lineageId`。
3. 一对一克隆同时写 `ContractBillRowTransition`。
4. 在线新增行创建新 lineage。
5. 在线删除有历史占用行时拒绝；“取消未实施余量”写专用事实。
6. 新版本生效前生成并校验 carry-forward，检查旧版进行中结算。

旧归档入口和当前正式文件归档入口都必须调用同一个“合同版本生效前置服务”，避免只修其中一条路径。

### 4.2 结算创建和提交

1. 锁定 `Contract`。
2. 检查结算模式、最终关闭事实和历史来源覆盖。
3. 创建 `ContractSettlementProcess(status=open)`；部分唯一索引裁决并发。
4. 创建草稿和结构化草稿行。
5. 保存时更新 `SettlementDraftLine`，并生成兼容 `lines` 快照。
6. 提交时锁过程和草稿，重新计算期间、占用、金额、合同上限和文件事实。
7. 在同一事务创建 `Settlement`、`SettlementLine`，并将过程关联到正式结算。
8. 归档生效时过程改为 `effective`；最终结算同时更新合同关闭事实。

### 4.3 付款

- `settlement_required` 的普通进度款只能走 `sourceType=settlement`。
- `direct_payment` 的普通合同到期款走既有 `sourceType=contract_due`。
- 预付款继续按有效付款条款和现有 `contract_advance` 规则办理。
- 模式未确认时，新结算和普通 `contract_due` 必须返回明确补确认提示；合法
  `contract_advance` 继续按冻结付款条款办理，只读历史台账也不受影响。

## 5. 历史回填算法

### 5.1 只读预检输出

预检必须生成批次清单，不写业务表：

1. 合同、版本、清单、行、结算和草稿数量；
2. 结算模式确定/待确认数量；
3. 单版本合同、可自动一对一、待人工映射合同数量；
4. `SettlementDraft.lines` 可解析/不可解析数量；
5. 期间可结构化/待确认数量；
6. 来源缺失、孤立 `SettlementLine`、异常金额或单位变化；
7. 每个待人工合同的原因和建议动作；
8. 预检代码 SHA、数据库只读时间点和结果摘要。

### 5.2 结算模式

自动规则只生成建议：

- 已存在正式结算的版本建议 `settlement_required`；
- 存在已确认 `contract_due` 业务且无结算依赖的版本建议 `direct_payment`；
- 其余按当前合同类型、清单和付款条款规则生成建议。

冲突或无充分依据时保持 `NULL`，由合同部主任确认。不得只因合同名称或对方名称自动决定。

### 5.3 清单 lineage

按合同、版本号升序处理：

1. 首个版本每行创建 lineage。
2. 相邻版本中 `billKey + rowKey` 在两侧都唯一、单位兼容且没有分支冲突时，生成一对一建议。
3. 确认无歧义的一对一继承原 lineage，记录 `backfill_row_key` transition。
4. 无来源候选的目标行创建新 lineage。
5. 来源缺失、整表替换导致全新 `rowKey`、单位变化、重复编码、拆分或合并都进入人工复核。
6. 编码、名称和规格只能用于展示建议，不允许无人工确认落库。

### 5.4 历史占用和 carry-forward

1. 从正式 `SettlementLine.contractBillRowId` 汇总有效历史数量和金额。
2. 沿已确认 transition 分配到目标行。
3. 校验每个来源的数量、金额守恒。
4. 为当前有效版本生成 carry-forward 候选和 `sourceSnapshotHash`。
5. 未解决来源的合同标记为“跨版本结算不可用”；旧台账继续只读。

不得把历史数量乘当前单价重算历史金额。

### 5.5 草稿结构化

- 使用与当前提交路径相同的解析器读取 `SettlementDraft.lines`。
- 可完整解析的草稿生成 `SettlementDraftLine`，保留原 JSON。
- 无法解析、引用行不存在或精度不合法的草稿进入待人工处理，不部分改写。
- 已提交草稿仅回填只读结构化副本，不改变其提交关系和正式结算。

### 5.6 期间

- 只有严格符合受支持格式并且与合同生效日、有效结算顺序不冲突的 `periodLabel` 才能生成建议。
- 自由文本、年月缺日、重叠或间断记录不得猜测。
- 合同部主任确认日期后记录操作者、依据和原文本。

### 5.7 既有结算过程

- `SettlementDraft.submittedSettlementId` 明确关联的草稿和正式结算归入同一过程。
- 已有效、部分付款或已付款结算按归档确认事实和创建顺序生成已结束过程候选；
  只有创建时间而缺少可靠生效时间时标记待确认。
- 每合同最多一个未提交草稿或仍在审批/归档中的正式结算可成为 `open` 候选。
- 同合同存在多个 open 候选时不自动选择，不写过程表，输出全部编号和状态供人工处理。
- 已作废记录回填为 `voided`，因新版合同产生的旧普通草稿回填为
  `invalidated`；原因不明时保持待确认。
- 历史最终结算只有在状态有效、期间已确认且不存在更新的有效结算时，才生成合同关闭建议；
  `Contract.settlementClosedAt/finalSettlementId` 由合同部主任确认后写入。

## 6. 迁移批次

### `M1-A`：核心新增结构

- 合同/合同版本新增字段；
- lineage、transition、carry-forward、process；
- 草稿/正式结算期间和计算快照；
- `SettlementDraftLine`、`SettlementLine` 扩展；
- 必要索引、外键和 `NOT VALID` 检查。

验证：

```text
prisma format
prisma validate
prisma generate
迁移 SQL 静态检查
空库迁移
生产同结构快照迁移
```

### `R1-A`：新写入双轨

- 新合同、新清单、新结算写 V2；
- 旧读模型在字段空值时回退；
- 新提交只信结构化草稿行；
- 旧草稿仍可查看，但未转换前不能按 V2 直接提交。

### `B1-A`：无歧义回填

- 仅执行单版本 lineage 和确定性 `billKey + rowKey` 一对一；
- 回填建议先保存到批次暂存或专用脚本输出，正式应用须单独授权；
- 每批幂等，重复执行不产生第二 lineage 或 transition。

### `B1-B`：人工确认

- 合同部主任逐合同确认模式、映射和期间；
- 确认操作经过 Web/API，不直接手改数据库；
- 复杂拆分/合并在 P2 上线前保持阻断。

### `M2-A`：验证与收紧

仅在以下指标同时满足时执行：

- 新写入 V2 字段覆盖率 100%；
- 待人工确认合同为 0，或已明确冻结为只读；
- V2/旧快照双读对比无差异；
- 孤立来源、孤立过程、金额守恒错误均为 0；
- 回滚演练通过。

`M2-A` 可以验证 `NOT VALID` 约束，并将新写入必填要求提升到数据库；不得在同批删除旧字段。

### P2 扩展

拆分/合并、追溯调价和退款/抵扣分别使用独立迁移。P2 迁移不得与 P1 首次上线绑成一个不可回滚批次。

## 7. SQL 与并发要求

- 迁移开头检查目标表、旧约束和索引定义，发现意外结构立即失败。
- 长表新增约束先 `NOT VALID`，验证单独执行。
- 索引名称和定义冲突时失败，不静默接受同名异构索引。
- 新外键默认 `ON DELETE RESTRICT ON UPDATE RESTRICT`。
- `ContractSettlementProcess` 部分唯一索引随空表创建；向该表回填既有过程前，
  必须只读证明每合同最多一个候选 open 过程，冲突合同不得自动回填。
- 写路径使用 `SERIALIZABLE` 或合同行锁加修订检查；不得只依赖“先查后写”。
- 金额守恒、最终关闭和版本生效必须在同一事务完成。

## 8. 文件绑定要求

新增 `SettlementLineAttachment.fileId` 和 `SettlementRecoveryEntry.evidenceFileId` 时，必须同步更新：

1. `jg_file_business_binding_columns()`；
2. 文件独占/非独占绑定触发器；
3. 私有下载权限；
4. 敏感下载审计；
5. 备份与恢复验证覆盖。

原件和派生 PDF 必须拥有独立文件对象和内容摘要。

## 9. 回滚与故障恢复

### 9.1 应用回滚

- M1 为纯新增，旧应用忽略新字段和表。
- R1 期间通过服务端能力开关切回旧读模型；新写入仍保留，不删除。
- 已创建 V2 结算过程时，旧应用不得继续创建新结算，必须由兼容门禁阻断。

### 9.2 回填回滚

- 回填前记录批次 ID、输入快照和创建记录 ID。
- 未确认的回填记录可以标记 `invalidated`，不得删除历史业务行。
- 已经支撑有效新合同版本或有效结算的 lineage、transition 和 carry-forward 不允许物理回滚；错误通过新版本或补偿事实修正。

### 9.3 数据库恢复

- 生产执行前必须有新备份、校验和、非空 `pg_restore --list` 和隔离恢复演练。
- 恢复演练只能在隔离数据库执行，禁止恢复到生产。
- 回滚应用不等于回滚生产业务数据，两者必须分别决策。

## 10. 生产授权矩阵

| 动作 | 是否由本方案授权 | 所需独立授权 |
| --- | --- | --- |
| 编写 Schema 和迁移 SQL | 是 | 无 |
| 本地空库/测试库执行迁移 | 是 | 无 |
| 生产只读预检 | 否 | 只读生产访问授权 |
| 推送候选 SHA | 否 | 精确 SHA 推送授权 |
| 部署应用 | 否 | 精确 SHA 生产部署授权 |
| 执行 M1 Schema 迁移 | 否 | 生产发布/迁移授权 |
| 自动无歧义历史回填 | 否 | 独立业务数据变更授权 |
| 人工确认模式/映射/期间 | 否 | 业务负责人确认与数据变更授权 |
| P2 退款/抵扣历史初始化 | 否 | 财务数据变更授权 |

## 11. 完成证据

每个迁移批次必须保存：

- 候选 SHA 与迁移目录名；
- 迁移前后 Prisma 状态；
- 表、字段、索引、约束和外键验证；
- 回填前后总数、已确认数、待确认数；
- 数量和金额守恒检查；
- 同合同 open 过程重复数；
- V2 与旧读模型差异；
- 备份、隔离恢复和健康检查；
- 未执行动作和剩余授权。

没有这些证据时，只能称为“迁移脚本完成”，不能称为“生产迁移完成”。
