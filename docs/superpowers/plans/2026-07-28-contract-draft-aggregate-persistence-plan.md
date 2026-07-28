# 合同草稿聚合持久化与生命周期实施计划

> **执行要求：** 按任务顺序实施；每个行为任务先锁定失败用例，任何完成声明前运行计划列出的全部验证命令。

**目标：** 建立以 `contractVersionId` 为唯一标识的草稿聚合 API，使顶部保存一次性持久化全部合同资料，并修复继续办理锁死、分散保存和草稿编号提前生成的问题。日常删除继续复用现有受审计逻辑删除；物理清理留到切换包的受控保留任务。

**核心架构：** 在现有 `ContractWorkbenchModule` 中新增版本级聚合服务与控制器。旧服务暂时保留供切换期读取，任何新写入只走聚合事务。文档预览是资料事务之后的独立命令。

**依赖：** Prisma、NestJS、现有 `ContractWorkbenchService`、`ContractBillService`、`BusinessPartyService`、`ContractDocumentService`、`FileService`、`AuditService`。

---

## Task 1：用数据库结构承载编辑租约、草稿附件和保存幂等

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
- `ContractDraftSaveRequest.expiresAt` 有清理索引，自动保存技术收据不永久增长。
- `ContractDraftSubmissionRequest` 把提交幂等键绑定到合同版本、修订、申请人、
  审批实例和正式编号。
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

model ContractDraftSaveRequest {
  idempotencyKey    String   @id
  contractVersionId String
  expectedRevision  Int
  resultRevision    Int
  saveKind          String
  requestSha256     String
  responseSnapshot  Json
  createdByUserId   String
  createdAt         DateTime @default(now())
  expiresAt         DateTime

  @@index([contractVersionId, createdAt])
  @@index([expiresAt])
}

model ContractDraftSubmissionRequest {
  idempotencyKey     String   @id
  contractVersionId  String
  expectedRevision   Int
  applicantUserId    String
  requestSha256      String
  approvalInstanceId String   @unique
  formalCode         String
  responseSnapshot   Json
  createdAt          DateTime @default(now())

  @@index([contractVersionId, createdAt])
}
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

迁移只做增量建表和约束，不修改现有合同状态，不回填业务事实，不删除
`ContractDraftCheckpoint`，也不引入物理删除或全站履约状态字段。

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

聚合请求必须是完整快照，不接受“只保存当前页签”的部分语义。客户端
`changedSections` 只用于诊断和性能提示，服务端必须根据锁定后的数据库事实
自行计算实际差异，不能把它当作跳过写入或校验的授权：

```ts
export interface SaveContractDraftAggregateDto {
  idempotencyKey: string;
  saveKind: "auto" | "manual";
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
- 非 UUID 幂等键、非法 `saveKind`、空 `changedSections` 或重复 section。
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
- `changedSections` 漏报时仍由服务端差异计算保存真实变化，并在响应返回
  `effectiveChangedSections`。
- 完整快照与锁定后事实完全相同时返回当前 revision，不重写子表、不新增业务
  审计；同一编辑窗口内无效抖动不能制造大量 delete/create。
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

这些助手接收完整权威快照，但必须先和锁定后的当前事实做稳定 key 级差异
比较，只更新、新增或逻辑移除实际变化的行；不能因为协议是全量快照就每 2 秒
把 1000 行清单全部 delete/create。客户端 `changedSections` 仍不能代替该
服务端差异计算。

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

成功提交前在同一事务写入 `ContractDraftSaveRequest`，默认 `expiresAt` 为 7 天后。
响应快照至少包含新 revision、保存时间、服务端计算的实际变化分区、分章节问题
数、readiness、文档是否过期和 `availableActions`；网络重试直接返回该权威
快照。

手动保存继续写 `contract.draft.save` 业务审计。后台自动保存只写短期幂等技术
收据并更新版本的最后保存人/时间，不为每个 2 秒窗口追加永久 AuditLog；租约
接管、冲突、提交和删除等治理动作仍完整审计。

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

同一控制器同时提供日常逻辑删除：

```http
DELETE /contract-drafts/:contractVersionId
{
  "expectedRevision": 8,
  "reason": "主管代清理时必填",
  "currentPassword": "主管代清理时必填"
}
```

它只委托现有 `ContractService.abandonDraft(...delete_pristine_draft...)` 的生命周期
判断和 CAS，不在请求内删除数据库行或 COS 对象。经办人只能删除自己的纯净
草稿；合同部主管代清理必须校验当前密码和原因。已提交、已有正式事实或不再
是当前修订时稳定拒绝。

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

请求：

```http
X-Contract-Draft-Lease: <opaque token>
Content-Type: application/json

{
  "expectedRevision": 8,
  "idempotencyKey": "uuid"
}
```

它只委托同一个 `ContractService.submitApproval`，不得复制提交逻辑。提交前必须
由前端先完成全局 PUT；后端仍重新校验当前 revision、租约和 readiness。提交
幂等键必须与合同版本、revision、申请人和第一次权威响应绑定；网络丢响应后
重试返回同一审批实例和正式编号，不能以“当前已不是 draft”掩盖第一次成功。

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

## Task 9：收口后端验证

### Step 1：运行定向测试

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-workbench/contract-draft-aggregate.service.spec.ts \
  src/contract-workbench/contract-draft-edit-lease.service.spec.ts \
  src/contract-workbench/contract-draft.controller.spec.ts \
  src/contract-workbench/contract-workbench.service.spec.ts \
  src/contract/contract.service.spec.ts \
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

另用 100、500、1000 行清单覆盖连续编辑和无变化手动保存，记录请求体大小、
事务耗时、实际变更行数、锁持有时间和 AuditLog 增长；任何全表重写或明显
超出既有交互预算的结果都阻断实施包 3 接入。

### Step 3：更新进度并提交

在 `PROGRESS.md` 记录：

- 已完成的具体 API 和测试证据。
- 尚未切换前端、未删除旧接口；日常删除仍是受审计逻辑删除，物理清理尚未启用。
- 全站履约状态写模型不在本包内重构。
- 未执行生产迁移、未部署、未修改生产业务数据。

```bash
git add PROGRESS.md
git commit -m "docs: record contract draft aggregate progress"
```
