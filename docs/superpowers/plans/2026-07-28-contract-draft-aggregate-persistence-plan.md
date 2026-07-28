# 合同草稿聚合持久化与生命周期实施计划

> **执行要求：** 按任务顺序实施；每个行为任务先锁定失败用例，任何完成声明前运行计划列出的全部验证命令。

**目标：** 建立以 `contractVersionId` 为唯一标识的草稿聚合 API，使顶部保存一次性持久化全部合同资料，并修复继续办理锁死、分散保存、草稿编号提前生成和纯净草稿无法真正删除的问题。

**核心架构：** 在现有 `ContractWorkbenchModule` 中新增版本级聚合服务与控制器。旧服务暂时保留供切换期读取，任何新写入只走聚合事务。文档预览是资料事务之后的独立命令。

**依赖：** Prisma、NestJS、现有 `ContractWorkbenchService`、`ContractBillService`、`BusinessPartyService`、`ContractDocumentService`、`FileService`、`AuditService`。

---

## Task 1：用数据库结构承载编辑租约、草稿附件和可恢复删除

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260728100000_contract_draft_aggregate_foundation/migration.sql`
- Create: `services/api/src/database/contract-draft-aggregate-schema.spec.ts`

### Step 1：先写结构验证测试

测试必须断言：

- `ContractDraftEditLease.contractVersionId` 唯一。
- 租约只存 `tokenHash`，不存客户端原始 token。
- `ContractDraftAttachment` 以 `(contractVersionId, slotKey, displayOrder)` 唯一。
- `ContractDraftSaveRequest.idempotencyKey` 唯一，并保存请求摘要和权威响应修订号。
- `ContractDraftPurgeTask` 可在合同版本删除后保留短期恢复状态，因此只存逻辑 ID，不建立级联删除外键。
- `Contract.performanceStatus` 只承载生效后的履约状态，状态变化另有不可覆盖事件。
- 新表对版本、文件、用户使用 `RESTRICT` 或显式清理，不允许无意级联到正式业务记录。

建议 schema：

```prisma
model ContractDraftEditLease {
  contractVersionId String   @id
  holderUserId      String
  tokenHash         String   @unique
  leaseRevision     Int      @default(1)
  acquiredAt        DateTime @default(now())
  heartbeatAt       DateTime @default(now())
  expiresAt         DateTime
  updatedAt         DateTime @updatedAt
}

model ContractDraftAttachment {
  id                String   @id @default(uuid())
  contractVersionId String
  slotKey           String
  fileId             String
  displayOrder       Int
  createdByUserId    String
  createdAt          DateTime @default(now())

  @@unique([contractVersionId, slotKey, displayOrder])
  @@unique([contractVersionId, slotKey, fileId])
  @@index([fileId])
}

model ContractDraftPurgeTask {
  id                String    @id @default(uuid())
  contractVersionId String
  contractId        String
  expectedRevision  Int
  status            String
  fileIds           Json
  requestedByUserId String
  errorCode         String?
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([contractVersionId, status])
}

model ContractDraftSaveRequest {
  idempotencyKey    String   @id
  contractVersionId String
  expectedRevision  Int
  resultRevision    Int
  requestSha256     String
  responseSnapshot  Json
  createdByUserId   String
  createdAt         DateTime @default(now())

  @@index([contractVersionId, createdAt])
}

model ContractPerformanceStatusEvent {
  id           String   @id @default(uuid())
  contractId   String
  fromStatus   String?
  toStatus     String
  reason       String
  actorUserId  String
  confirmedByUserId String?
  createdAt    DateTime @default(now())

  @@index([contractId, createdAt])
}
```

给 `Contract` 增加：

```prisma
performanceStatus          String?
performanceStatusUpdatedAt DateTime?
performanceStatusUpdatedByUserId String?
```

给 `ContractVersion` 增加：

```prisma
firstSubmittedAt             DateTime?
latestDraftPreviewDocumentId String?
```

`firstSubmittedAt` 只在第一次成功创建审批实例时写入，用于明确区分纯净草稿和曾进入流程的记录；`latestDraftPreviewDocumentId` 只指向当前最新成功的草稿预览。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-draft-aggregate-schema.spec.ts
```

预期：`FAIL`，指出模型或迁移不存在。

### Step 3：添加 Prisma 模型和迁移

迁移只做增量建表和约束，不修改现有合同状态，不回填业务事实，不删除 `ContractDraftCheckpoint`。

租约默认参数写在服务常量中：

```ts
export const CONTRACT_DRAFT_LEASE_TTL_MS = 120_000;
export const CONTRACT_DRAFT_LEASE_HEARTBEAT_MS = 30_000;
```

### Step 4：运行 GREEN 和 Prisma 门禁

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-draft-aggregate-schema.spec.ts
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
```

预期：全部退出码 `0`。

### Step 5：提交

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260728100000_contract_draft_aggregate_foundation/migration.sql services/api/src/database/contract-draft-aggregate-schema.spec.ts
git commit -m "feat: add contract draft aggregate foundation"
```

---

## Task 2：新增精确版本读取接口

**Files:**

- Create: `services/api/src/contract-workbench/contract-draft-aggregate.service.ts`
- Create: `services/api/src/contract-workbench/contract-draft.controller.ts`
- Create: `services/api/src/contract-workbench/contract-draft-aggregate.service.spec.ts`
- Create: `services/api/src/contract-workbench/contract-draft.controller.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.module.ts`
- Modify: `services/api/src/contract-workbench/dto/contract-workbench.dto.ts`

### Step 1：先锁定错误版本回归

创建两个同属一个 `contractId` 的可编辑版本 `cv-1`、`cv-2`，请求：

```http
GET /contract-drafts/cv-1/workbench
```

测试必须证明返回 `cv-1`，不能返回 `cv-2`；不存在、无权访问、已作废和非草稿版本分别返回稳定错误。

响应必须包含一个聚合 read model：

```ts
interface ContractDraftWorkbenchReadModel {
  contract: {
    id: string;
    temporaryCode: string;
    formalCode: string | null;
  };
  version: {
    id: string;
    draftRevision: number;
    status: string;
    draftLifecycleKind: "pristine_draft" | "approval_draft" | "formal_record";
  };
  draft: ContractDraftFields;
  parties: ContractDraftParty[];
  bills: ContractDraftBill[];
  paymentTerms: ContractDraftPaymentTerms | null;
  attachments: ContractDraftAttachmentReadModel[];
  documents: ContractDraftDocumentSummary;
  negotiation: ContractNegotiationSummary;
  readiness: ContractReadinessReadModel;
  lease: {
    state: "available" | "held_by_me" | "held_by_other" | "expired";
    holderDisplayName: string | null;
    expiresAt: string | null;
    canTakeOver: boolean;
  };
}
```

不要再返回 `checkpoints`。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-aggregate.service.spec.ts src/contract-workbench/contract-draft.controller.spec.ts
```

预期：新服务和路由不存在。

### Step 3：实现精确版本加载

控制器路由：

```ts
@Controller("contract-drafts")
export class ContractDraftController {
  @Get(":contractVersionId/workbench")
  workbench(@Param("contractVersionId") id: string, @CurrentUser() actor: Actor) {
    return this.aggregate.getWorkbench(id, actor.id);
  }
}
```

服务查询必须以：

```ts
await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
```

为入口，然后按该版本加载主体、清单、付款条款、附件和文档。禁止调用现有 `getDraft(contractId)`。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-aggregate.service.spec.ts src/contract-workbench/contract-draft.controller.spec.ts
```

预期：精确版本、权限和状态用例全部通过。

### Step 5：提交

```bash
git add services/api/src/contract-workbench
git commit -m "feat: add version scoped contract draft read api"
```

---

## Task 3：建立编辑租约

**Files:**

- Create: `services/api/src/contract-workbench/contract-draft-edit-lease.service.ts`
- Create: `services/api/src/contract-workbench/contract-draft-edit-lease.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-draft.controller.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.module.ts`

### Step 1：先写租约行为测试

覆盖：

1. 无有效租约时，经办人可取得 120 秒租约和只返回一次的原始 token。
2. 同一浏览器 token 心跳续期不增加 `leaseRevision`。
3. 另一用户只能读取只读状态，不能保存。
4. 合同部主管可以显式接管；旧 token 下一次保存返回 `409 EDIT_LEASE_LOST`。
5. 租约自然过期后，经办人可以重新取得。
6. token、token hash 不进入 AuditLog metadata 和用户错误。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-edit-lease.service.spec.ts
```

预期：`FAIL`。

### Step 3：实现路由和哈希校验

```http
POST /contract-drafts/:contractVersionId/edit-lease
POST /contract-drafts/:contractVersionId/edit-lease/heartbeat
POST /contract-drafts/:contractVersionId/edit-lease/takeover
DELETE /contract-drafts/:contractVersionId/edit-lease
```

写请求用 `X-Contract-Draft-Lease` 传原始 token；数据库仅保存：

```ts
createHash("sha256").update(rawToken).digest("hex");
```

接管必须使用 `SensitiveActionGuard` 对应的密码二次确认，并记录：

```text
contract.draft.edit_lease.takeover
```

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-edit-lease.service.spec.ts src/contract-workbench/contract-draft.controller.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-workbench
git commit -m "feat: add contract draft edit lease"
```

---

## Task 4：定义一次性全局保存 DTO

**Files:**

- Modify: `services/api/src/contract-workbench/dto/contract-workbench.dto.ts`
- Create: `services/api/src/contract-workbench/dto/contract-draft-aggregate.dto.spec.ts`
- Modify: `services/api/src/contract-bill/dto/contract-bill.dto.ts`
- Modify: `services/api/src/business-party/dto/business-party.dto.ts`

### Step 1：先写 DTO 校验测试

聚合请求必须是完整快照，不接受“只保存当前页签”的部分语义：

```ts
export interface SaveContractDraftAggregateDto {
  idempotencyKey: string;
  expectedRevision: number;
  changedSections: Array<
    "draft" | "parties" | "bills" | "payment_terms" |
    "attachments" | "negotiation_documents"
  >;
  draft: {
    companyEntityId?: string;
    draftData: Record<string, unknown>;
    clauses: ContractClauseDefinition[];
    pricingNature: ContractPricingNature;
    amountSource: ContractAmountSource;
    manualAmountCents?: string;
    amountAdjustmentReason?: string;
    layoutTemplateVersionId?: string;
    taxFacts: SaveContractTaxFactsDto;
  };
  parties: Array<{
    roleKey: string;
    displayOrder: number;
    businessPartyVersionId?: string;
    snapshot: Record<string, unknown>;
  }>;
  bills: Array<{
    billKey: string;
    expectedRevision: number;
    rows: SaveContractBillRowDto[];
  }>;
  paymentTerms: {
    originalText: string;
    stages: SavePaymentTermsStageDto[];
  } | null;
  attachments: Array<{
    slotKey: string;
    fileId: string;
    displayOrder: number;
  }>;
  negotiationDocuments: {
    selectedNegotiationRoundId?: string;
    selectedOfflineRevisionId?: string;
    referencedGeneratedDocumentIds: string[];
  };
}
```

测试拒绝：

- 非整数或旧 `expectedRevision`。
- 非 UUID 幂等键、空 `changedSections` 或重复 section。
- 重复主体位置、清单 key、清单 row key、附件位置。
- 金额不是整数字符串。
- 附件 fileId 为空。
- 磋商轮次、离线修订或生成文档不属于当前合同版本。
- 请求携带 `formalCode`、`status`、`amountCents` 等服务端权威字段。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/dto/contract-draft-aggregate.dto.spec.ts
```

### Step 3：实现 class-validator DTO

不要只保留 TypeScript interface；控制器边界必须由运行时 DTO 完整校验嵌套对象。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/dto/contract-draft-aggregate.dto.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-workbench/dto services/api/src/contract-bill/dto services/api/src/business-party/dto
git commit -m "feat: define contract draft aggregate payload"
```

---

## Task 5：把全部资料写入同一个串行化事务

**Files:**

- Modify: `services/api/src/contract-workbench/contract-draft-aggregate.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.ts`
- Modify: `services/api/src/business-party/business-party.service.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/contract-workbench/contract-draft-aggregate.service.spec.ts`
- Create: `services/api/src/database/contract-draft-aggregate-concurrency.spec.ts`

### Step 1：先写原子性和并发 RED

构造一次保存同时修改字段、主体、两份清单、税务、付款条款、条款和附件。

至少覆盖：

- 第二份清单校验失败时，第一份清单和字段均不变化。
- 附件已绑定其他业务时，所有资料均不变化。
- 两个相同 `expectedRevision` 并发保存只有一个成功。
- 同一个 idempotency key 和相同请求摘要重试时返回第一次权威响应，不重复增加 revision。
- 同一个 idempotency key 用于不同 payload 时返回 `IDEMPOTENCY_KEY_REUSED`，零业务写。
- 成功保存只把 `ContractVersion.draftRevision` 从 `7` 增加到 `8`，不能按子域多次增加。
- 成功响应回传全部权威金额、子域 revision 和 `savedAt`。
- 租约失效时零业务写。
- 保存草稿时 `Contract.code` 仍为 `null`，只保留 `temporaryCode`。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-aggregate.service.spec.ts src/database/contract-draft-aggregate-concurrency.spec.ts
```

预期：现有分散事务造成断言失败。

### Step 3：提取事务内写入助手

现有公共 API 可以继续开自己的事务，但聚合服务只能调用接收同一 `Prisma.TransactionClient` 的内部助手：

```ts
saveDraftFieldsInTransaction(tx, lockedVersion, input)
replaceContractPartiesInTransaction(tx, lockedVersion, input.parties)
replaceBillRowsInTransaction(tx, lockedVersion, input.bills)
replacePaymentTermsInTransaction(tx, lockedVersion, input.paymentTerms)
replaceDraftAttachmentsInTransaction(tx, lockedVersion, input.attachments)
saveNegotiationDocumentReferencesInTransaction(
  tx,
  lockedVersion,
  input.negotiationDocuments
)
```

磋商和文档本身的上传、比较、差异处置仍是独立领域命令；这里只保存当前草稿选择和引用关系，并写入服务端命名的 `draftData.workbenchReferences`，不能伪造文档状态。

不要在助手内再次调用 `this.prisma.$transaction`。

### Step 4：实现固定锁序

串行化事务固定顺序：

```text
Contract
-> ContractVersion
-> ContractDraftEditLease
-> ContractBill（按 id）
-> ContractBillRow（按 id）
-> ContractPartySnapshot（按 id）
-> PaymentTermsVersion / Stage（按 id）
-> FileObject（按 id）
```

最后以 CAS 统一更新：

```ts
const result = await tx.contractVersion.updateMany({
  where: {
    id: version.id,
    status: "draft",
    draftRevision: input.expectedRevision
  },
  data: {
    ...authoritativeVersionFields,
    draftRevision: { increment: 1 },
    readinessSnapshot: Prisma.JsonNull
  }
});
```

事务隔离级别使用 `Serializable`；`P2034` 和 PostgreSQL `40001` 转为稳定的“资料已变化，请刷新后重试”。

成功提交前在同一事务写入 `ContractDraftSaveRequest`。响应快照至少包含新 revision、保存时间、分章节问题数、readiness、文档是否过期和 `availableActions`；网络重试直接返回该权威快照。

### Step 5：删除保存草稿时的正式编号分配

从 `ContractWorkbenchService.saveDraft` 移除：

```ts
allocateInitialContractCode(tx)
```

以及对 `Contract.code` 的写入。兼容旧保存接口在切换期也不得再分配正式编号。

### Step 6：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-aggregate.service.spec.ts src/database/contract-draft-aggregate-concurrency.spec.ts src/contract-workbench/contract-workbench.service.spec.ts
```

### Step 7：提交

```bash
git add services/api/src/contract-workbench services/api/src/contract-bill services/api/src/business-party services/api/src/file
git commit -m "feat: save contract draft aggregate atomically"
```

---

## Task 6：暴露统一保存路由并保留明确冲突契约

**Files:**

- Modify: `services/api/src/contract-workbench/contract-draft.controller.ts`
- Modify: `services/api/src/contract-workbench/contract-draft.controller.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-draft-aggregate.service.spec.ts`

### Step 1：先写路由契约测试

```http
PUT /contract-drafts/:contractVersionId
X-Contract-Draft-Lease: <opaque token>
Content-Type: application/json
```

响应：

```json
{
  "contractVersionId": "cv-1",
  "draftRevision": 8,
  "savedAt": "2026-07-28T10:00:00.000Z",
  "amounts": {
    "taxInclusiveAmountCents": "75000000",
    "taxExclusiveAmountCents": "68807339",
    "taxAmountCents": "6192661"
  },
  "billRevisions": {
    "pricing": 4
  },
  "issueCounts": {
    "bill_tax": 0,
    "settlement_payment": 1
  },
  "documentsOutdated": true,
  "availableActions": []
}
```

错误码至少区分：

- `DRAFT_REVISION_CONFLICT`
- `EDIT_LEASE_REQUIRED`
- `EDIT_LEASE_LOST`
- `DRAFT_NOT_EDITABLE`
- `DRAFT_VALIDATION_FAILED`

`DRAFT_REVISION_CONFLICT` 和 `EDIT_LEASE_LOST` 响应必须包含服务器最新 revision、冲突原因和是否可重新取得租约；不得回传数据库字段、堆栈或 COS objectKey。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft.controller.spec.ts
```

### Step 3：实现并运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft.controller.spec.ts src/contract-workbench/contract-draft-aggregate.service.spec.ts
```

### Step 4：提交

```bash
git add services/api/src/contract-workbench
git commit -m "feat: expose global contract draft save api"
```

---

## Task 7：把正式编号移动到审批提交事务

**Files:**

- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Modify: `services/api/src/contract-workbench/contract-draft.controller.ts`
- Modify: `services/api/src/contract-workbench/contract-draft.controller.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.module.ts`

### Step 1：先写编号时机 RED

覆盖：

1. 保存草稿十次，`Contract.code` 仍为空。
2. readiness 阻断时，不消耗 `HT` 业务号。
3. 创建审批实例失败时，编号分配和合同状态同时回滚。
4. 成功提交时，在同一个串行化事务中分配编号、冻结资料、更新 `in_approval`、创建 `ApprovalInstance`。
5. 两次并发提交只有一次创建审批实例和一个正式编号。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.service.spec.ts
```

### Step 3：在 `submitApproval` 中分配

在 readiness、治理文件、候选审批人全部校验通过之后，在更新版本和创建审批实例之前：

```ts
const formalCode = contract.code ??
  await this.businessNumbers.allocateDaily(tx, "HT");
```

随后同事务更新 `Contract.code`。删除当前错误文案：

```text
合同尚未生成正式编号，请先成功保存草稿后再提交审批
```

替换为只有编号服务真正不可用时才出现的错误。

把 `formalCode` 同时写入审批 `submissionSnapshot`，确保编号和冻结送审资料可追溯；不能只存在可变的 Contract 主表。

同一个成功事务在 `firstSubmittedAt` 为空时写当前时间；退回、驳回、撤回后不得清空，因此这些记录永远不能重新变成可物理删除的纯净草稿。

同时新增版本级提交入口：

```http
POST /contract-drafts/:contractVersionId/submission
```

它只委托同一个 `ContractService.submitApproval`，不得复制提交逻辑。提交前必须由前端先完成全局 PUT；后端仍重新校验当前 revision、租约和 readiness。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts src/contract-workbench/contract-draft.controller.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract services/api/src/contract-workbench
git commit -m "fix: allocate contract code during approval submission"
```

---

## Task 8：把预览生成变成资料保存后的独立命令

**Files:**

- Modify: `services/api/src/contract-workbench/contract-draft.controller.ts`
- Modify: `services/api/src/contract-document/contract-document.service.ts`
- Modify: `services/api/src/contract-document/contract-document.processor.ts`
- Modify: `services/api/src/contract-document/contract-document.service.spec.ts`
- Modify: `services/api/src/contract-document/contract-document.processor.spec.ts`
- Modify: `services/api/src/file/file.service.ts`

### Step 1：先写预览生命周期 RED

覆盖：

- `POST /contract-drafts/:id/preview-generation` 只接受已保存的当前 `draftRevision`。
- 同一版本、revision、layout、purpose 重复请求幂等。
- 生成失败时保留上一份成功预览。
- 新 DOCX 和 PDF 都成功且 FileObject 已绑定后，才把旧成功预览标记 superseded 并删除旧对象。
- DOCX 成功、PDF 失败时，新 DOCX 作为未绑定临时文件清理，旧预览继续可用。
- 页面资料保存成功不因预览失败变成保存失败。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-document/contract-document.service.spec.ts src/contract-document/contract-document.processor.spec.ts
```

### Step 3：实现独立命令

```http
POST /contract-drafts/:contractVersionId/preview-generation
{
  "sourceRevision": 8
}
```

返回任务状态，不等待 LibreOffice 完整渲染：

```json
{
  "generationId": "doc-1",
  "status": "queued",
  "sourceRevision": 8
}
```

处理器完成后由现有轮询读取最新成功预览。

新预览完整成功时，在绑定文件的同一最终事务更新 `ContractVersion.latestDraftPreviewDocumentId`；失败任务不改变该指针。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-document/contract-document.service.spec.ts src/contract-document/contract-document.processor.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-workbench services/api/src/contract-document services/api/src/file
git commit -m "feat: separate contract draft save from preview generation"
```

---

## Task 9：实现纯净草稿的受控物理删除

**Files:**

- Create: `services/api/src/contract-workbench/contract-draft-purge.service.ts`
- Create: `services/api/src/contract-workbench/contract-draft-purge.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-draft.controller.ts`
- Modify: `services/api/src/contract-workbench/contract-draft.controller.spec.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.module.ts`

### Step 1：先写“能删”和“绝不能删”测试

允许删除必须同时满足：

- `ContractVersion.status === "draft"`。
- `expectedRevision` 命中。
- 合同来源是系统草稿。
- 从未存在审批实例、提交审计、用章任务、正式文件、归档、结算、付款或已激活历史接管。
- 当前操作者是经办人或合同部主管。

以下任何一种必须拒绝物理删除：

- 曾提交后退回。
- 已逻辑作废或已归档。
- 有结算或付款历史。
- 有正式编号但无法证明由旧错误逻辑提前生成。
- 有其他版本仍依赖该版本。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-purge.service.spec.ts src/contract-workbench/contract-draft.controller.spec.ts
```

### Step 3：实现幂等删除流程

路由：

```http
DELETE /contract-drafts/:contractVersionId?expectedRevision=8
```

流程：

1. 串行化事务锁定合同、版本和依赖记录，建立 `ContractDraftPurgeTask`。
2. 该任务存在期间，草稿不再出现在列表，也不允许继续保存。
3. 只收集仅由该草稿占用的 Excel、预览、附件临时文件；共享文件不得删除。
4. 事务外逐个调用 `PrivateFileStorage.delete`，失败可按任务重试。
5. 全部对象删除成功后，在最终事务按显式顺序删除草稿依赖、FileObject、版本；若合同不再有任何版本且无历史，则删除空 Contract。
6. 写一条最小审计收据：

```json
{
  "action": "contract.draft.purge",
  "businessType": "contract_draft",
  "businessId": "cv-1",
  "metadata": {
    "contractId": "c-1",
    "draftRevision": 8,
    "deletedFileCount": 3
  }
}
```

不得在审计中保存对象键、原始合同正文或租约 token。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-draft-purge.service.spec.ts src/contract-workbench/contract-draft.controller.spec.ts src/file/file.service.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-workbench services/api/src/file
git commit -m "feat: purge pristine contract drafts safely"
```

---

## Task 10：把多套内部状态收敛为一个前端当前状态

**Files:**

- Create: `packages/shared-domain/src/contract-performance-status.ts`
- Create: `packages/shared-domain/src/contract-performance-status.test.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Create: `services/api/src/contract/contract-performance-status.service.ts`
- Create: `services/api/src/contract/contract-performance-status.service.spec.ts`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Modify: `services/api/src/contract/contract-version-activation.service.ts`
- Modify: `services/api/src/contract/contract-version-activation.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Create: `apps/web-admin/src/pages/contracts/contract-current-status.ts`
- Create: `apps/web-admin/src/pages/contracts/contract-current-status.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractListPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`

### Step 1：先写单一状态 RED

生效前 read model 只返回一个办理状态：

```text
draft -> 草稿编制
approval_pending -> 待审批
in_approval -> 审批中
in_seal -> 待用印
awaiting_mutual_signature -> 待双方签署
awaiting_archive_confirmation -> 待归档确认
```

生效后只返回一个履约状态：

```text
not_started -> 未开始
performing -> 履约中
suspended -> 已暂停
completed -> 已完成
terminated -> 已终止
```

争议、异常超付、资料缺失只进入 `riskTags`，不能覆盖主状态。

测试还要断言：

- 台账、详情、工作台显示同一个后端 `currentStatus`。
- 页面不并排展示流程状态、版本状态、归档状态三套标签。
- read model 只给一个 `nextAction`。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-performance-status.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-performance-status.service.spec.ts src/contract/contract-read.service.spec.ts src/contract/contract-version-activation.service.spec.ts src/settlement/settlement.service.spec.ts
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-current-status.test.ts
```

### Step 3：实现履约状态权限和流转

路由：

```http
POST /contracts/:contractId/performance-status
{
  "toStatus": "performing",
  "reason": "项目已进场"
}
```

后端规则：

- 只有合同版本已 effective 才能更新。
- 经办人可更新 `not_started`、`performing`、`suspended`。
- `completed`、`terminated` 必须由合同部主管二次确认。
- `completed` 禁止发起普通履约结算。
- `terminated` 只允许终止清算或更正流程。
- 每次变更写 `ContractPerformanceStatusEvent` 和 AuditLog。
- 普通合同首次归档生效时初始化 `not_started`；合同变更版本生效时继承同一 Contract 当前履约状态，不重置。

历史接管激活时根据已确认事实初始化 `performing` 或 `completed`，不能再使用一套仅历史接管可见的 lifecycle 主状态。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-performance-status.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-performance-status.service.spec.ts src/contract/contract-read.service.spec.ts src/contract/contract-version-activation.service.spec.ts src/settlement/settlement.service.spec.ts
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-current-status.test.ts
```

### Step 5：提交

```bash
git add packages/shared-domain/src services/api/src/contract services/api/src/settlement apps/web-admin/src/pages/contracts
git commit -m "feat: expose one current contract status"
```

---

## Task 11：收口后端验证

### Step 1：运行定向测试

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-workbench/contract-draft-aggregate.service.spec.ts \
  src/contract-workbench/contract-draft-edit-lease.service.spec.ts \
  src/contract-workbench/contract-draft-purge.service.spec.ts \
  src/contract-workbench/contract-draft.controller.spec.ts \
  src/contract-workbench/contract-workbench.service.spec.ts \
  src/contract/contract.service.spec.ts \
  src/contract/contract-performance-status.service.spec.ts \
  src/contract/contract-read.service.spec.ts \
  src/contract/contract-version-activation.service.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/contract-document/contract-document.service.spec.ts \
  src/contract-document/contract-document.processor.spec.ts \
  src/database/contract-draft-aggregate-schema.spec.ts \
  src/database/contract-draft-aggregate-concurrency.spec.ts
```

### Step 2：运行静态门禁

```bash
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api exec prisma validate
git diff --check
```

预期：全部退出码 `0`。

### Step 3：更新进度并提交

在 `PROGRESS.md` 记录：

- 已完成的具体 API 和测试证据。
- 尚未切换前端、未删除旧接口。
- 未执行生产迁移、未部署、未修改生产业务数据。

```bash
git add PROGRESS.md
git commit -m "docs: record contract draft aggregate progress"
```
