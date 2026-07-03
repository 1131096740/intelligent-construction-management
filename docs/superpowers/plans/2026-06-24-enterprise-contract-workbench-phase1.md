# Enterprise Contract Workbench Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 当前状态（2026-07-04）：本文对应的合同工作台 Phase 1 已基本完成并记录在 `PROGRESS.md`。后续不要把“历史合同 import”理解为完整 OCR/反向建模任务；当前试运行只做已签合同接管、归档、余额初始化和业务确认，且 P0-1 至 P0-7 最小实现已完成。

**Goal:** Build the first delivery stage of the enterprise contract system: contract workbench, versioned template center, multi-sheet Excel bills, structured clauses, and generated DOCX/PDF previews.

**Architecture:** Extend the existing NestJS/PostgreSQL contract domain instead of creating a parallel system. Keep approval, settlement, payment, file, and audit services intact; add versioned JSON-backed business templates around a fixed relational contract and bill core. Generate documents through persistent database jobs processed by one in-process worker, using uploaded DOCX templates, `docxtemplater`, LibreOffice, and `pdf-lib`.

**Tech Stack:** Vue 3, TypeScript, TDesign Web, Vite, NestJS 10, Prisma 5, PostgreSQL, Jest, Vitest, ExcelJS, Docxtemplater, PizZip, PDF-Lib, LibreOffice CLI.

---

## Scope

This plan implements only delivery stage 1 from the approved design:

- direct entry into a professional contract workbench;
- draft ownership, autosave, manual save, five checkpoints, void/restore;
- versioned cooperation-unit records and multi-party contract snapshots;
- business template versions and standard clause versions;
- DOCX layout template versions and publication preview;
- multiple structured bills per contract;
- Excel template download, import preview, apply, and web editing;
- deterministic money/tax calculation;
- draft, negotiation, and internal-review DOCX/PDF generation;
- submission-readiness validation and freezing of the current draft snapshot.

This plan does not implement:

- negotiation rounds or DOCX diff processing;
- new approval return/diff behavior;
- OCR signed-file comparison;
- supplemental agreements or termination;
- the expanded settlement, invoice, payment, or batch-payment models;
- historical contract import;
- electronic archive ZIP packages;
- mobile editing.

Those remain in delivery stages 2 through 4.

## File Structure

### Backend modules

- `services/api/src/contract-template/` — business templates, versions, standard clauses, layout templates, publication validation.
- `services/api/src/business-party/` — cooperation-unit versions, qualification attachments, and contract party snapshots.
- `services/api/src/contract-workbench/` — draft lifecycle, optimistic autosave, checkpoints, readiness validation, workbench read model.
- `services/api/src/contract-bill/` — bill schemas, rows, decimal calculations, Excel import/export.
- `services/api/src/contract-document/` — persistent document jobs, DOCX rendering, LibreOffice conversion, PDF normalization, generated-file records.
- `services/api/src/money/decimal-money.ts` — one fixed decimal calculation boundary shared by bills and contract totals.

### Frontend modules

- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue` — professional editor shell and section navigation.
- `apps/web-admin/src/pages/contracts/workbench/` — focused section components and draft state composable.
- `apps/web-admin/src/pages/contract-templates/` — business, clause, Excel schema, and DOCX layout management.
- `apps/web-admin/src/api/contract-workbench.api.ts` — workbench-specific API client.

### Shared contracts

- `packages/shared-domain/src/contract-workbench.ts` — template schemas, workbench read models, bill and document DTO types.

### Data

- `services/api/prisma/schema.prisma` — fixed core tables and JSON snapshots.
- `services/api/prisma/migrations/20260624160000_enterprise_contract_workbench_phase1/migration.sql`.

## Milestone A: Data and Domain Foundation

### Task 1: Add document and spreadsheet dependencies

**Files:**
- Modify: `services/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`

- [ ] **Step 1: Add the minimal libraries**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api add exceljs docxtemplater pizzip pdf-lib
```

Expected: `services/api/package.json` contains the four dependencies and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Add the converter command setting**

Add to `.env.example`:

```dotenv
# LibreOffice executable used for DOCX -> PDF conversion.
DOC_CONVERTER_COMMAND=soffice

# Maximum private upload size: 100 MiB.
FILE_UPLOAD_MAX_BYTES=104857600

# Fonts permitted in published contract layouts; install these on the conversion host.
DOC_ALLOWED_FONTS=Noto Sans CJK SC,宋体,仿宋,黑体
```

- [ ] **Step 3: Verify dependency resolution**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/api/package.json pnpm-lock.yaml .env.example
git commit -m "build(api): add contract document dependencies"
```

### Task 2: Add the phase-1 Prisma model

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260624160000_enterprise_contract_workbench_phase1/migration.sql`

- [ ] **Step 1: Extend contract fixed fields and add versioned template models**

Add these fields to `Contract`:

```prisma
  contractTypeKey String?
  ownerUserId     String?
  temporaryCode  String?  @unique
  voidedAt        DateTime?
  voidedReason    String?
```

Change the existing `code` to optional so a new draft does not consume a formal number:

```prisma
  code String? @unique
```

Add these fields to `ContractVersion`:

```prisma
  businessTemplateVersionId String?
  layoutTemplateVersionId   String?
  draftRevision             Int      @default(1)
  pricingNature             String   @default("fixed_total")
  amountSource              String   @default("manual")
  amountAdjustmentReason    String?
  draftData                 Json
  templateSnapshot          Json
  clauseSnapshot            Json
  readinessSnapshot         Json?
```

Change `ContractVersion.amountCents` from `Int` to `BigInt`.

Add:

```prisma
model ContractBusinessTemplate {
  id              String   @id @default(uuid())
  code            String   @unique
  name            String
  contractTypeKey String
  status          String   @default("draft")
  createdByUserId String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ContractBusinessTemplateVersion {
  id                   String    @id @default(uuid())
  templateId           String
  versionNo            Int
  status               String    @default("draft")
  fieldSchema           Json
  billSchema            Json
  clauseSchema          Json
  attachmentSchema      Json
  validationSchema      Json
  submittedByUserId     String?
  publishedByUserId     String?
  publishedAt           DateTime?
  stoppedAt             DateTime?
  revokedAt             DateTime?
  changeSummary         String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@unique([templateId, versionNo])
}

model StandardClause {
  id              String   @id @default(uuid())
  code            String   @unique
  category        String
  name            String
  createdByUserId String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model StandardClauseVersion {
  id                String    @id @default(uuid())
  clauseId          String
  versionNo         Int
  status            String    @default("draft")
  title             String
  content           Json
  submittedByUserId String?
  publishedByUserId String?
  publishedAt       DateTime?
  changeSummary     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([clauseId, versionNo])
}

model BusinessParty {
  id                      String   @id @default(uuid())
  name                    String
  unifiedSocialCreditCode String?  @unique
  status                  String   @default("active")
  createdByUserId         String
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
}

model BusinessPartyVersion {
  id                String   @id @default(uuid())
  businessPartyId   String
  versionNo         Int
  snapshot          Json
  createdByUserId   String
  createdAt         DateTime @default(now())

  @@unique([businessPartyId, versionNo])
}

model ContractPartySnapshot {
  id                     String   @id @default(uuid())
  contractVersionId      String
  roleKey                String
  displayOrder           Int
  businessPartyVersionId String?
  snapshot               Json
  createdAt              DateTime @default(now())

  @@unique([contractVersionId, roleKey, displayOrder])
}

model ContractLayoutTemplate {
  id              String   @id @default(uuid())
  name            String
  contractTypeKey String
  createdByUserId String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ContractLayoutTemplateVersion {
  id                String    @id @default(uuid())
  layoutTemplateId  String
  versionNo         Int
  status            String    @default("draft")
  docxFileId        String
  placeholderSchema Json
  previewPdfFileId  String?
  inspectionReport  Json?
  submittedByUserId String?
  publishedByUserId String?
  publishedAt       DateTime?
  stoppedAt         DateTime?
  revokedAt         DateTime?
  changeSummary     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([layoutTemplateId, versionNo])
}

model ContractLayoutPreviewJob {
  id                      String    @id @default(uuid())
  layoutTemplateVersionId String
  status                  String    @default("queued")
  sampleData              Json
  previewPdfFileId        String?
  errorMessage            String?
  startedAt               DateTime?
  completedAt             DateTime?
  createdByUserId         String
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt
}

model ContractDraftCheckpoint {
  id                String   @id @default(uuid())
  contractVersionId String
  sequenceNo        Int
  name              String?
  snapshot           Json
  createdByUserId   String
  createdAt         DateTime @default(now())

  @@unique([contractVersionId, sequenceNo])
}

model ContractNumberRule {
  id              String   @id @default(uuid())
  name            String
  pattern         String
  companyEntityId String?
  projectId       String?
  contractTypeKey String?
  nextSequence    Int      @default(1)
  sequenceWidth   Int      @default(3)
  isActive        Boolean  @default(true)
  createdByUserId String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ContractBill {
  id                       String   @id @default(uuid())
  contractVersionId        String
  billKey                   String
  name                      String
  amountRole                String
  pricingMode               String
  quantityScale             Int
  unitPriceScale            Int
  schemaSnapshot            Json
  sourceExcelFileId         String?
  revision                  Int      @default(1)
  taxInclusiveAmountCents   BigInt   @default(0)
  taxExclusiveAmountCents   BigInt   @default(0)
  taxAmountCents            BigInt   @default(0)
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  @@unique([contractVersionId, billKey])
}

model ContractBillRow {
  id                       String   @id @default(uuid())
  contractBillId           String
  rowKey                   String
  sortOrder                Int
  itemCode                 String?
  itemName                 String
  specification            String?
  unit                     String
  quantity                 Decimal  @db.Decimal(24, 6)
  unitPrice                Decimal  @db.Decimal(24, 6)
  taxRate                  Decimal  @db.Decimal(9, 6)
  taxInclusiveAmountCents  BigInt
  taxExclusiveAmountCents  BigInt
  taxAmountCents           BigInt
  isProvisional            Boolean  @default(false)
  settlementBasis          String?
  customData               Json
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([contractBillId, rowKey])
  @@index([contractBillId, sortOrder])
}

model ContractBillImport {
  id                String   @id @default(uuid())
  contractBillId    String
  fileId            String
  mode              String
  status            String
  preview            Json
  appliedByUserId   String?
  appliedAt         DateTime?
  createdByUserId   String
  createdAt         DateTime @default(now())
}

model ContractGeneratedDocument {
  id                      String    @id @default(uuid())
  contractVersionId       String
  layoutTemplateVersionId String
  purpose                 String
  status                  String    @default("queued")
  sourceRevision           Int
  inputSnapshot            Json
  idempotencyKey           String    @unique
  docxFileId              String?
  pdfFileId               String?
  errorMessage            String?
  engineVersion           String
  createdByUserId         String
  startedAt               DateTime?
  completedAt             DateTime?
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt
}
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api exec prisma migrate dev --name enterprise_contract_workbench_phase1
```

Expected: a new migration is created and applied.

- [ ] **Step 3: Regenerate Prisma**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api exec prisma generate
```

Expected: Prisma Client generation succeeds.

- [ ] **Step 4: Inspect the generated SQL**

Verify the migration:

- alters `Contract.code` to nullable without dropping its uniqueness;
- alters `ContractVersion.amountCents` to PostgreSQL `BIGINT`;
- creates every new table and unique/index constraint above;
- does not delete or rewrite existing contract, settlement, payment, approval, or file data.

- [ ] **Step 5: Commit**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations
git commit -m "feat(db): add enterprise contract workbench models"
```

### Task 3: Define shared workbench schemas and read models

**Files:**
- Create: `packages/shared-domain/src/contract-workbench.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Create: `packages/shared-domain/src/contract-workbench.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Create:

```typescript
import {
  isContractFieldDefinition,
  validateContractTemplateSchema
} from "./contract-workbench";

describe("contract workbench schema", () => {
  it("accepts supported fields and rejects scripts", () => {
    expect(
      isContractFieldDefinition({
        key: "deliveryDate",
        label: "交货日期",
        type: "date",
        required: true
      })
    ).toBe(true);

    expect(
      isContractFieldDefinition({
        key: "unsafe",
        label: "脚本",
        type: "script"
      })
    ).toBe(false);
  });

  it("rejects duplicate field and bill keys", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [
          { key: "name", label: "名称", type: "text" },
          { key: "name", label: "重复", type: "text" }
        ],
        bills: [],
        clauses: [],
        attachments: [],
        validations: []
      })
    ).toThrow("Duplicate field key: name");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/shared-domain test -- contract-workbench.test.ts
```

Expected: FAIL because `contract-workbench.ts` does not exist.

- [ ] **Step 3: Add exact shared types and validation**

Define:

```typescript
export type ContractFieldType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "date"
  | "single_select"
  | "multi_select"
  | "boolean";

export interface ContractFieldDefinition {
  key: string;
  label: string;
  type: ContractFieldType;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  group?: string;
  order?: number;
  visibleWhen?: { fieldKey: string; operator: "eq" | "neq"; value: unknown };
}

export interface ContractBillDefinition {
  key: string;
  name: string;
  amountRole: "included" | "reference" | "non_priced" | "provisional";
  pricingMode: "tax_inclusive" | "tax_exclusive";
  quantityScale: number;
  unitPriceScale: number;
  columns: Array<{
    key: string;
    label: string;
    type: "text" | "number" | "boolean";
    required?: boolean;
  }>;
}

export interface ContractClauseDefinition {
  key: string;
  title: string;
  numberingMode: "automatic" | "fixed";
  required?: boolean;
  standardClauseVersionId?: string;
  content: unknown;
}

export interface ContractAttachmentDefinition {
  key: string;
  name: string;
  required: boolean;
  mustBeValid?: boolean;
}

export interface ContractValidationRule {
  key: string;
  level: "block" | "warning";
  targetClauseKey: string;
  requiredPhrases: string[];
  message: string;
}

export interface ContractTemplateSchema {
  fields: ContractFieldDefinition[];
  bills: ContractBillDefinition[];
  clauses: ContractClauseDefinition[];
  attachments: ContractAttachmentDefinition[];
  validations: ContractValidationRule[];
}
```

Also define read models used by API and Web:

```typescript
export interface ContractWorkbenchReadModel {
  contract: {
    id: string;
    temporaryCode: string;
    code: string | null;
    projectId: string;
    contractTypeKey: string;
    ownerUserId: string;
    name: string;
    status: string;
  };
  version: {
    id: string;
    revision: number;
    amountCents: number;
    pricingNature: string;
    amountSource: string;
    draftData: Record<string, unknown>;
    clauses: ContractClauseDefinition[];
    template: ContractTemplateSchema;
  };
  parties: Array<{
    id: string;
    roleKey: string;
    displayOrder: number;
    businessPartyVersionId?: string;
    snapshot: Record<string, unknown>;
  }>;
  bills: ContractBillReadModel[];
  checkpoints: ContractDraftCheckpointReadModel[];
  documents: ContractGeneratedDocumentReadModel[];
  readiness: ContractReadinessResult;
}
```

Implement `isContractFieldDefinition` and `validateContractTemplateSchema` with:

- supported field types only;
- field, bill, clause, attachment, and validation keys unique inside their category;
- quantity scale 0 to 6;
- unit price scale 2 to 6;
- no arbitrary script/formula properties.

- [ ] **Step 4: Export and run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/shared-domain test
node scripts/pnpm-workspace.mjs --filter @jiangkong/shared-domain typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/contract-workbench.ts packages/shared-domain/src/contract-workbench.test.ts packages/shared-domain/src/index.ts
git commit -m "feat(domain): define contract workbench schemas"
```

### Task 4: Add decimal money calculation and BigInt compatibility

**Files:**
- Create: `services/api/src/money/decimal-money.ts`
- Create: `services/api/src/money/decimal-money.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify: `services/api/prisma/seed.cjs`

- [ ] **Step 1: Write failing tests for both pricing modes**

```typescript
import { calculateBillRow } from "./decimal-money";

describe("calculateBillRow", () => {
  it("calculates a tax-inclusive row and keeps the cent relationship exact", () => {
    expect(
      calculateBillRow({
        quantity: "3.333",
        unitPrice: "100.1234",
        taxRatePercent: "13",
        pricingMode: "tax_inclusive"
      })
    ).toEqual({
      taxInclusiveAmountCents: 33371n,
      taxExclusiveAmountCents: 29532n,
      taxAmountCents: 3839n
    });
  });

  it("calculates a tax-exclusive row and derives tax from the rounded base", () => {
    expect(
      calculateBillRow({
        quantity: "10",
        unitPrice: "9.999",
        taxRatePercent: "6",
        pricingMode: "tax_exclusive"
      })
    ).toEqual({
      taxInclusiveAmountCents: 10599n,
      taxExclusiveAmountCents: 9999n,
      taxAmountCents: 600n
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- decimal-money.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement with Prisma.Decimal**

Use `Prisma.Decimal`, never JavaScript floating-point multiplication:

```typescript
import { Prisma } from "@prisma/client";

const HUNDRED = new Prisma.Decimal(100);

function yuanToCents(value: Prisma.Decimal): bigint {
  return BigInt(value.mul(HUNDRED).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

export function calculateBillRow(input: {
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  pricingMode: "tax_inclusive" | "tax_exclusive";
}) {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const rate = new Prisma.Decimal(input.taxRatePercent).div(HUNDRED);

  if (input.pricingMode === "tax_inclusive") {
    const inclusive = yuanToCents(quantity.mul(unitPrice));
    const exclusive = BigInt(
      new Prisma.Decimal(inclusive.toString())
        .div(rate.add(1))
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(0)
    );
    return {
      taxInclusiveAmountCents: inclusive,
      taxExclusiveAmountCents: exclusive,
      taxAmountCents: inclusive - exclusive
    };
  }

  const exclusive = yuanToCents(quantity.mul(unitPrice));
  const tax = BigInt(
    new Prisma.Decimal(exclusive.toString())
      .mul(rate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(0)
  );
  return {
    taxInclusiveAmountCents: exclusive + tax,
    taxExclusiveAmountCents: exclusive,
    taxAmountCents: tax
  };
}

export function centsToSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Money value exceeds the supported API range");
  }
  return result;
}
```

- [ ] **Step 4: Update every existing contract-amount caller**

Make these exact compatibility changes:

- `ContractReadService.formatMoney` accepts `number | bigint` and calls `centsToSafeNumber`;
- `ContractService.formatCents` accepts `number | bigint` and calls `centsToSafeNumber`;
- `approval-form.service.ts` changes `formatYuan(cents: number)` to `formatYuan(cents: number | bigint)` and converts through `centsToSafeNumber`;
- contract-version seed writes use `BigInt(seed.contractVersion.amountCents)`;
- service tests expect `amountCents: 1_000_000n` in Prisma writes while API payloads remain safe integer numbers.

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- decimal-money.spec.ts contract-read.service.spec.ts contract.service.spec.ts approval-form.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/money services/api/src/contract services/api/src/approval/approval-form.service.ts services/api/prisma/seed.cjs
git commit -m "feat(api): add decimal contract money calculations"
```

## Milestone B: Template Center

### Task 5: Implement business template and standard clause APIs

**Files:**
- Create: `services/api/src/contract-template/contract-template.module.ts`
- Create: `services/api/src/contract-template/contract-template.controller.ts`
- Create: `services/api/src/contract-template/contract-template.service.ts`
- Create: `services/api/src/contract-template/contract-template.service.spec.ts`
- Create: `services/api/src/contract-template/dto/contract-template.dto.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Write failing service tests**

Cover:

```typescript
it("creates version 1 as draft");
it("publishes only after schema validation");
it("does not mutate a published version");
it("creates a new draft version from a published version");
it("stops a version without changing existing contract snapshots");
it("revokes a version so new drafts cannot use it");
it("publishes a standard clause version");
```

The publication assertion must expect:

```typescript
expect(tx.contractBusinessTemplateVersion.update).toHaveBeenCalledWith({
  where: { id: "version-1" },
  data: expect.objectContaining({
    status: "published",
    publishedByUserId: "contract-director",
    publishedAt: expect.any(Date)
  })
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-template.service.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement DTOs**

Define exact payloads:

```typescript
export interface CreateBusinessTemplateDto {
  code: string;
  name: string;
  contractTypeKey: string;
  schema: ContractTemplateSchema;
}

export interface UpdateBusinessTemplateVersionDto {
  schema: ContractTemplateSchema;
  changeSummary?: string;
}

export interface PublishTemplateVersionDto {
  changeSummary: string;
}

export interface CreateStandardClauseDto {
  code: string;
  category: string;
  name: string;
  title: string;
  content: unknown;
}
```

- [ ] **Step 4: Implement service methods**

Implement:

```typescript
listPublished(contractTypeKey?: string)
getTemplate(templateId: string)
createTemplate(actorUserId: string, input: CreateBusinessTemplateDto)
updateDraftVersion(versionId: string, actorUserId: string, input: UpdateBusinessTemplateVersionDto)
cloneVersion(versionId: string, actorUserId: string)
submitVersion(versionId: string, actorUserId: string)
publishVersion(versionId: string, actorUserId: string, input: PublishTemplateVersionDto)
stopVersion(versionId: string, actorUserId: string)
revokeVersion(versionId: string, actorUserId: string)
listPublishedClauses(category?: string)
createClause(actorUserId: string, input: CreateStandardClauseDto)
publishClauseVersion(versionId: string, actorUserId: string, changeSummary: string)
```

Rules:

- only `draft` versions can be edited;
- only `submitted` versions can be published;
- require global `contract_staff` for template/clause creation and draft editing;
- require global `contract_director` for publication, stop, and revoke;
- call `validateContractTemplateSchema` before submission and publication;
- published rows are immutable;
- every mutation records an audit event under `contract_template` or `standard_clause`.

- [ ] **Step 5: Implement controller routes**

Use:

```text
GET    /contract-templates?contractTypeKey=
GET    /contract-templates/:templateId
POST   /contract-templates
PATCH  /contract-template-versions/:versionId
POST   /contract-template-versions/:versionId/clone
POST   /contract-template-versions/:versionId/submission
POST   /contract-template-versions/:versionId/publication
POST   /contract-template-versions/:versionId/stop
POST   /contract-template-versions/:versionId/revoke
GET    /standard-clauses?category=
POST   /standard-clauses
POST   /standard-clause-versions/:versionId/publication
```

Pass `@CurrentUser()` into every mutation. Reuse current authentication; do not add a second auth mechanism.

- [ ] **Step 6: Register the module and run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-template.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/api lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/contract-template services/api/src/app.module.ts
git commit -m "feat(api): add versioned contract templates and clauses"
```

### Task 6: Implement DOCX layout template lifecycle and inspection

**Files:**
- Create: `services/api/src/contract-template/layout-template.service.ts`
- Create: `services/api/src/contract-template/layout-template.service.spec.ts`
- Modify: `services/api/src/contract-template/contract-template.controller.ts`
- Modify: `services/api/src/contract-template/contract-template.module.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/file/file.controller.ts`

- [ ] **Step 1: Add an internal file-buffer method test**

Add:

```typescript
it("loads a private file buffer for an authorized internal service", async () => {
  const result = await service.getFileBuffer("file-docx");
  expect(result.file.id).toBe("file-docx");
  expect(result.buffer.equals(Buffer.from("docx"))).toBe(true);
});
```

- [ ] **Step 2: Implement `FileService.getFileBuffer`**

```typescript
async getFileBuffer(fileId: string) {
  const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
  if (!file) {
    throw new Error("Private file not found");
  }
  return { file, buffer: await this.storage.read(file.objectKey) };
}
```

This is service-internal access. User-facing access continues to use existing permission checks and download auditing.

- [ ] **Step 3: Add declared-extension and size controls**

Add tests:

```typescript
it("rejects files over FILE_UPLOAD_MAX_BYTES");
it("rejects extensions outside DOCX XLSX PDF PNG JPEG");
it("rejects DOCM and XLSM macro files");
it("does not inspect magic bytes or run virus scanning");
```

In `FileController`, configure:

```typescript
@UseInterceptors(
  FileInterceptor("file", {
    limits: {
      fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
    }
  })
)
```

In `FileService.uploadPrivateFile`, validate the lower-cased declared filename extension against:

```typescript
const ALLOWED_EXTENSIONS = new Set([".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg"]);
```

Do not add magic-byte or antivirus inspection; the approved design explicitly defers both.

- [ ] **Step 4: Write failing layout tests**

Cover:

```typescript
it("rejects a non-DOCX source extension");
it("extracts placeholders from word/document.xml");
it("reports unknown placeholders");
it("queues a layout preview with saved sample data");
it("publishes only when inspection has no blocking errors and the latest preview succeeded");
it("keeps a published layout immutable");
```

- [ ] **Step 5: Implement DOCX inspection**

Use PizZip to read XML parts. Extract `{{...}}` tags from:

- `word/document.xml`;
- `word/header*.xml`;
- `word/footer*.xml`.
- `word/styles.xml` font declarations.

Return:

```typescript
interface LayoutInspectionReport {
  placeholders: string[];
  unknownPlaceholders: string[];
  missingRequiredPlaceholders: string[];
  hasBillLoop: boolean;
  blockingErrors: string[];
  warnings: string[];
}
```

Recognized namespaces:

```text
contract.*
party.*
field.*
clause.*
bill.*
document.*
```

Require at least:

```text
contract.name
contract.temporaryCode
document.watermark
```

Report a blocking error when the DOCX uses a font outside `DOC_ALLOWED_FONTS`. This is a declared-font check, not binary font inspection.

For a template whose business schema contains bills, require at least one `bill.<billKey>` loop marker.

- [ ] **Step 6: Implement layout lifecycle**

Methods:

```typescript
createLayout(actorUserId, { name, contractTypeKey, docxFileId, placeholderSchema })
inspectVersion(versionId, actorUserId)
queuePreview(versionId, actorUserId, sampleData)
submitVersion(versionId, actorUserId)
publishVersion(versionId, actorUserId, changeSummary)
cloneVersion(versionId, actorUserId)
stopVersion(versionId, actorUserId)
revokeVersion(versionId, actorUserId)
listPublishedLayouts(contractTypeKey?)
```

`queuePreview` stores a `ContractLayoutPreviewJob`. Task 14's processor renders it after the DOCX and PDF services exist. Publication reads the latest successful preview job and copies its `previewPdfFileId` to the layout version.

Require global `contract_staff` for create/inspect/preview/clone/submit and global `contract_director` for publish/stop/revoke.

Routes:

```text
GET  /contract-layout-templates?contractTypeKey=
POST /contract-layout-templates
POST /contract-layout-template-versions/:versionId/inspection
POST /contract-layout-template-versions/:versionId/preview-generation
GET  /contract-layout-template-versions/:versionId/preview-generation
POST /contract-layout-template-versions/:versionId/submission
POST /contract-layout-template-versions/:versionId/publication
POST /contract-layout-template-versions/:versionId/clone
POST /contract-layout-template-versions/:versionId/stop
POST /contract-layout-template-versions/:versionId/revoke
```

- [ ] **Step 7: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- file.service.spec.ts layout-template.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/api/src/file services/api/src/contract-template
git commit -m "feat(api): add DOCX layout template governance"
```

## Milestone C: Draft Workbench and Bills

### Task 7: Add versioned cooperation-unit records and multi-party snapshots

**Files:**
- Create: `services/api/src/business-party/business-party.module.ts`
- Create: `services/api/src/business-party/business-party.controller.ts`
- Create: `services/api/src/business-party/business-party.service.ts`
- Create: `services/api/src/business-party/business-party.service.spec.ts`
- Create: `services/api/src/business-party/dto/business-party.dto.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Write failing party tests**

Cover these concrete cases:

```typescript
it("creates version 1 and normalizes the unified social credit code");
it("rejects a duplicate unified social credit code");
it("creates a new immutable version instead of overwriting history");
it("keeps qualification attachment file ids in the version snapshot");
it("adds multiple role snapshots to one draft contract");
it("does not change an existing contract snapshot when the party record changes");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- business-party.service.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact DTOs**

```typescript
export interface BusinessPartySnapshotDto {
  name: string;
  unifiedSocialCreditCode?: string;
  legalRepresentative?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  attachments: Array<{
    category: "business_license" | "bank_account" | "legal_id" | "authorization" | "qualification" | "other";
    fileId: string;
    name: string;
    validUntil?: string;
  }>;
}

export interface CreateBusinessPartyDto extends BusinessPartySnapshotDto {}

export interface AddContractPartyDto {
  roleKey: "party_a" | "party_b" | "party_c" | "guarantor" | "consortium_member" | "other";
  businessPartyVersionId?: string;
  snapshot?: BusinessPartySnapshotDto;
}
```

- [ ] **Step 4: Implement service and routes**

Routes:

```text
GET   /business-parties?query=
GET   /business-parties/:partyId
POST  /business-parties
POST  /business-parties/:partyId/versions
POST  /contract-workbench/:contractVersionId/parties
PATCH /contract-workbench/:contractVersionId/parties/:partySnapshotId
DELETE /contract-workbench/:contractVersionId/parties/:partySnapshotId
```

Rules:

- normalize credit codes with `trim().toUpperCase()`;
- require global `contract_staff` or `contract_director` for cooperation-unit creation and new versions;
- do not overwrite `BusinessPartyVersion`;
- require either `businessPartyVersionId` or an inline snapshot;
- copy source version JSON into `ContractPartySnapshot.snapshot`;
- draft owner only may mutate contract parties;
- audit create, version, attach, update-role, and remove-role actions;
- deleting a draft party snapshot is allowed only before approval submission.

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- business-party.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/api lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/business-party services/api/src/app.module.ts
git commit -m "feat(api): add contract party snapshots"
```

### Task 8: Replace the minimal contract-create endpoint with workbench draft creation

**Files:**
- Modify: `services/api/src/contract/dto/create-contract.dto.ts`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/prisma/verify-core-flow.cjs`

- [ ] **Step 1: Replace the creation test**

The new create payload is:

```typescript
export interface CreateContractDraftDto {
  projectId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
}
```

Test:

```typescript
it("creates a minimal owned workbench draft from a published template snapshot", async () => {
  const result = await service.createDraft(
    {
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "template-version-1"
    },
    "contract-user"
  );

  expect(tx.contract.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      ownerUserId: "contract-user",
      temporaryCode: expect.stringMatching(/^DRAFT-/),
      code: null
    })
  });
  expect(result.version.status).toBe("draft");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract.service.spec.ts
```

Expected: FAIL because `createDraft` still expects the legacy full form.

- [ ] **Step 3: Implement minimal draft creation**

Change the controller:

```typescript
@Post()
create(
  @Body() body: CreateContractDraftDto,
  @CurrentUser() user: AuthenticatedUser
) {
  return this.contracts.createDraft(body, user.id);
}
```

In the service:

- require a published business template version;
- copy its field, bill, clause, attachment, and validation schemas into `templateSnapshot`;
- initialize `draftData` with template defaults;
- initialize `clauseSnapshot` from template clauses;
- create one `ContractBill` per bill definition;
- create a draft payment-terms version with empty text and no stages for compatibility;
- set `amountCents` to `0n`;
- generate `temporaryCode` as `DRAFT-YYYYMMDD-<8 uppercase chars>`;
- do not allocate a formal contract code;
- audit `contract.draft.create`.

- [ ] **Step 4: Keep legacy reads working**

Update `ContractReadService`:

- display `contract.code ?? contract.temporaryCode`;
- convert `version.amountCents` through `centsToSafeNumber`;
- tolerate empty payment terms stages;
- preserve all current approval/archive detail fields.

- [ ] **Step 5: Run contract tests**

Update `verify-core-flow.cjs` so its RBAC and lifecycle setup creates the required disposable contract/version/payment-terms rows with Prisma before calling approval endpoints. The existing core-flow verifier no longer calls the removed legacy full-form `POST /contracts`; the new phase-1 verifier covers the workbench create endpoint.

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract.service.spec.ts contract-read.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract
git commit -m "feat(api): create owned contract workbench drafts"
```

### Task 9: Implement autosave, checkpoints, void, restore, and optimistic concurrency

**Files:**
- Create: `services/api/src/contract-workbench/contract-workbench.module.ts`
- Create: `services/api/src/contract-workbench/contract-workbench.controller.ts`
- Create: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Create: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Create: `services/api/src/contract-workbench/dto/contract-workbench.dto.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover:

```typescript
it("saves when expectedRevision matches and increments revision");
it("rejects stale autosave without overwriting server data");
it("allows only the owner to edit a draft");
it("allows a contract director to view and transfer a draft");
it("lists current and voided drafts separately");
it("creates a manual checkpoint snapshot");
it("keeps only five checkpoints by deleting the oldest");
it("restores a checkpoint as a new draft revision");
it("voids and restores a draft without physical deletion");
it("previews a contract-type change without mutating the draft");
it("keeps compatible fields and replaces incompatible bills when a type change is applied");
```

Conflict assertion:

```typescript
await expect(
  service.saveDraft("version-1", "owner-1", {
    expectedRevision: 4,
    draftData: { name: "本地修改" },
    clauses: [],
    pricingNature: "fixed_total",
    amountSource: "manual",
    manualAmountCents: 1_000_000
  })
).rejects.toThrow("Contract draft revision conflict");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-workbench.service.spec.ts
```

Expected: FAIL because the workbench module does not exist.

- [ ] **Step 3: Implement DTOs**

```typescript
export interface SaveContractDraftDto {
  expectedRevision: number;
  draftData: Record<string, unknown>;
  clauses: ContractClauseDefinition[];
  pricingNature: "fixed_total" | "provisional_total" | "unit_price" | "framework";
  amountSource: "bill_sum" | "manual";
  manualAmountCents?: number;
  amountAdjustmentReason?: string;
  layoutTemplateVersionId?: string;
}

export interface CreateDraftCheckpointDto {
  name?: string;
}

export interface VoidDraftDto {
  reason: string;
}

export interface PreviewContractTypeChangeDto {
  targetBusinessTemplateVersionId: string;
  expectedRevision: number;
}

export interface ApplyContractTypeChangeDto extends PreviewContractTypeChangeDto {
  confirmed: true;
}

export interface TransferContractDraftDto {
  toUserId: string;
}
```

- [ ] **Step 4: Implement exact persistence rules**

`saveDraft`:

- load `ContractVersion` and parent `Contract`;
- require parent `ownerUserId === actorUserId`;
- allow `draft` and `approval_rejected`, reject approval/effective statuses;
- require `draftRevision === expectedRevision`;
- validate field keys and clause keys against `templateSnapshot`;
- for `amountSource=bill_sum`, calculate amount from bills whose `amountRole` is `included` or `provisional`;
- for `amountSource=manual`, require `manualAmountCents`;
- require an adjustment reason when manual amount differs from included bill sum;
- increment revision atomically with `updateMany({ where: { id, draftRevision: expectedRevision } })`;
- audit one batch summary, including changed top-level keys and amount before/after.

`createCheckpoint`:

- store the current version draft, clauses, pricing, layout, and bill snapshots;
- assign the next sequence number;
- after insert, delete the oldest rows until only five remain.

`restoreCheckpoint`:

- owner only;
- draft-editable statuses only;
- copy snapshot into the current draft;
- increment revision;
- never mutate the checkpoint.

`voidDraft` and `restoreDraft`:

- set or clear `Contract.voidedAt` and `voidedReason`;
- never delete contract rows.

`listDrafts` and `transferDraft`:

- `scope=my` returns contracts owned by the current user;
- `scope=voided` returns voided drafts visible to the current user;
- global `contract_director` can view all drafts and transfer ownership;
- transfer records old and new owner ids in the audit log.

`previewTypeChange`:

- require a published target business-template version;
- return retained fields, removed fields, added defaults, removed bills, and added bills;
- make no database changes.

`applyTypeChange`:

- require the expected draft revision and explicit confirmation;
- retain fields only when key and type are compatible;
- replace clauses and bills missing from the target template;
- keep removed values only inside the audit snapshot;
- update contract type, template version, and template snapshot;
- increment the draft revision;
- reject after approval submission.

- [ ] **Step 5: Add routes**

```text
GET   /contract-workbench?scope=my|voided
GET   /contract-workbench/:contractId
PATCH /contract-workbench/:contractVersionId
POST  /contract-workbench/:contractVersionId/checkpoints
POST  /contract-workbench/:contractVersionId/checkpoints/:checkpointId/restore
POST  /contract-workbench/:contractVersionId/type-change-preview
POST  /contract-workbench/:contractVersionId/type-change
POST  /contract-workbench/:contractId/transfer
POST  /contract-workbench/:contractId/void
POST  /contract-workbench/:contractId/restore
```

- [ ] **Step 6: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-workbench.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/api lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/contract-workbench services/api/src/app.module.ts
git commit -m "feat(api): add contract draft lifecycle"
```

### Task 10: Implement bill row CRUD and totals

**Files:**
- Create: `services/api/src/contract-bill/contract-bill.module.ts`
- Create: `services/api/src/contract-bill/contract-bill.controller.ts`
- Create: `services/api/src/contract-bill/contract-bill.service.ts`
- Create: `services/api/src/contract-bill/contract-bill.service.spec.ts`
- Create: `services/api/src/contract-bill/dto/contract-bill.dto.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Write failing bill tests**

Cover:

```typescript
it("adds a row and calculates exact amounts");
it("updates a row only when bill revision matches");
it("allows different row tax rates in the same bill");
it("reorders rows without changing row keys");
it("deletes a draft row and recalculates totals");
it("rejects quantity precision beyond the bill schema");
it("sums only included and provisional bills into contract amount");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-bill.service.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add DTOs**

```typescript
export interface SaveBillRowDto {
  expectedBillRevision: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReorderBillRowsDto {
  expectedBillRevision: number;
  rowKeys: string[];
}
```

- [ ] **Step 4: Implement row mutation**

Routes:

```text
POST   /contract-bills/:billId/rows
PATCH  /contract-bills/:billId/rows/:rowKey
DELETE /contract-bills/:billId/rows/:rowKey
POST   /contract-bills/:billId/rows/reorder
```

Rules:

- require draft owner;
- require draft-editable contract status;
- validate required custom columns against `schemaSnapshot`;
- validate quantity and unit-price scales;
- calculate all money server-side with `calculateBillRow`;
- generate immutable UUID `rowKey` on first insert;
- use bill `revision` for optimistic concurrency;
- recalculate bill totals from rounded row cents;
- recalculate contract amount only when `amountSource=bill_sum`;
- record one audit batch per API mutation.

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-bill.service.spec.ts decimal-money.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract-bill services/api/src/app.module.ts
git commit -m "feat(api): add structured contract bills"
```

### Task 11: Implement Excel template download and import preview/apply

**Files:**
- Create: `services/api/src/contract-bill/contract-bill-excel.service.ts`
- Create: `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill.controller.ts`
- Modify: `services/api/src/contract-bill/contract-bill.module.ts`

- [ ] **Step 1: Write failing Excel tests**

Use in-memory ExcelJS workbooks. Cover:

```typescript
it("exports an instruction sheet and one named data sheet");
it("includes hidden internal field codes and row keys");
it("recalculates formulas from raw quantity, price, and tax cells");
it("returns sheet-row-column errors for invalid numbers");
it("previews append, replace, and update-by-row-key modes");
it("does not write rows until the preview is explicitly applied");
it("keeps the original uploaded XLSX file id on the import record");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-bill-excel.service.spec.ts
```

Expected: FAIL because the Excel service does not exist.

- [ ] **Step 3: Implement template export**

Generate:

- worksheet `填写说明`;
- worksheet `清单数据`;
- row 1: user-facing labels;
- row 2: stable field codes;
- frozen first two rows;
- hidden `__rowKey` column;
- number formats based on configured quantity and price scales;
- formulas may be included for user convenience, but are never trusted on import.

Route:

```text
GET /contract-bills/:billId/excel-template
```

Return a streamed `.xlsx` download with an ASCII-safe fallback filename and UTF-8 filename parameter.

- [ ] **Step 4: Implement import preview**

Route:

```text
POST /contract-bills/:billId/excel-imports
```

Input:

```typescript
{
  fileId: string;
  mode: "replace" | "update" | "append";
}
```

Behavior:

- read the private file through `FileService.getFileBuffer`;
- parse only `清单数据`;
- read field codes from row 2;
- reject merged cells in the data area;
- ignore formula results for core money fields;
- parse raw quantity, unit price, and tax rate;
- validate every row and return precise errors;
- compare by `__rowKey` only in update mode;
- store preview JSON in `ContractBillImport`;
- do not change bill rows.

Preview shape:

```typescript
{
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  beforeAmountCents: number;
  afterAmountCents: number;
  rows: Array<{ action: "add" | "update" | "remove" | "skip"; rowKey?: string; values: unknown }>;
  errors: Array<{ sheet: string; row: number; column: string; message: string }>;
}
```

- [ ] **Step 5: Implement apply**

Route:

```text
POST /contract-bill-imports/:importId/apply
```

Rules:

- reject previews containing errors;
- reject already applied imports;
- apply all row changes in one transaction;
- recheck bill revision;
- store `appliedByUserId` and `appliedAt`;
- recalculate bill and contract totals;
- retain original Excel file and preview permanently.

- [ ] **Step 6: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-bill-excel.service.spec.ts contract-bill.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/contract-bill
git commit -m "feat(api): add contract bill Excel import and export"
```

## Milestone D: Document Generation

### Task 12: Implement DOCX rendering

**Files:**
- Create: `services/api/src/contract-document/contract-docx-renderer.ts`
- Create: `services/api/src/contract-document/contract-docx-renderer.spec.ts`
- Create: `services/api/src/contract-document/contract-document.types.ts`

- [ ] **Step 1: Write failing renderer tests**

Create a minimal DOCX fixture in the test with PizZip. Cover:

```typescript
it("renders contract, field, clause, and party placeholders");
it("renders bill rows through a docxtemplater loop");
it("uses formatted money and uppercase money values");
it("fails on an unresolved required placeholder");
it("adds the requested draft or negotiation watermark value");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-docx-renderer.spec.ts
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement the render input**

Define:

```typescript
export interface ContractDocumentRenderInput {
  values: Record<string, unknown>;
}
```

Build `values` with stable flat keys so the default Docxtemplater parser treats dots as part of the key:

```typescript
{
  "contract.name": "钢材采购合同",
  "contract.temporaryCode": "DRAFT-20260624-AB12CD34",
  "contract.code": "",
  "contract.amount": "1,000,000.00",
  "contract.amountUppercase": "人民币壹佰万元整",
  "party.party_b.name": "云南示例供应商有限公司",
  "field.deliveryLocation": "项目现场",
  "clause.payment.text": "结算单生效后方可付款。",
  "bill.materials": [
    {
      itemName: "螺纹钢",
      specification: "HRB400E Φ20",
      unit: "吨",
      quantity: "10.000",
      unitPrice: "3,500.00",
      taxRatePercent: "13%",
      taxInclusiveAmount: "35,000.00"
    }
  ],
  "document.watermark": "草稿",
  "document.generatedAt": "2026-06-24 16:00:00"
}
```

- [ ] **Step 4: Implement rendering**

Use:

```typescript
const zip = new PizZip(templateBuffer);
const document = new Docxtemplater(zip, {
  paragraphLoop: true,
  linebreaks: true,
  nullGetter: () => ""
});
document.render(renderInput.values);
return document.getZip().generate({ type: "nodebuffer" });
```

Keep section orientation, page margins, headers, footers, table styles, and signature pages in the uploaded DOCX template. Do not attempt to reproduce Word layout in application code.

Implement Chinese uppercase money in one pure helper and cover zero, integer, cents, and large amounts.

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-docx-renderer.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract-document
git commit -m "feat(api): render contract DOCX templates"
```

### Task 13: Implement PDF conversion and A4 attachment normalization

**Files:**
- Create: `services/api/src/contract-document/libreoffice-converter.ts`
- Create: `services/api/src/contract-document/libreoffice-converter.spec.ts`
- Create: `services/api/src/contract-document/pdf-normalizer.ts`
- Create: `services/api/src/contract-document/pdf-normalizer.spec.ts`

- [ ] **Step 1: Write failing converter tests**

Inject the executable runner so tests do not require LibreOffice:

```typescript
it("calls LibreOffice with headless PDF conversion arguments");
it("returns a clear error when the converter executable is missing");
it("returns a clear error when an allowed DOCX font is unavailable on the conversion host");
it("cleans temporary files after success and failure");
```

Expected command arguments:

```text
--headless
--convert-to
pdf
--outdir
<temporary-directory>
<input.docx>
```

- [ ] **Step 2: Write failing PDF normalization tests**

Use PDF-Lib to create sample portrait, landscape, and non-A4 pages. Cover:

```typescript
it("keeps A4 portrait pages portrait");
it("keeps A4 landscape bill pages landscape");
it("scales an external PDF page onto A4 without cropping");
it("converts PNG and JPEG attachments into centered A4 pages");
it("returns page count and page-size inspection results");
```

- [ ] **Step 3: Implement the converter**

Use `execFile`, not a shell string:

```typescript
const command = process.env.DOC_CONVERTER_COMMAND ?? "soffice";
await execFileAsync(command, [
  "--headless",
  "--convert-to",
  "pdf",
  "--outdir",
  tempDir,
  inputPath
]);
```

Do not execute user-controlled arguments. The input path is a generated temporary file.

Before conversion, verify each declared template font with `fc-match` on Linux. On non-Linux development hosts, skip `fc-match` and rely on the generated PDF preview inspection. Production deployment must install the fonts listed in `DOC_ALLOWED_FONTS`.

- [ ] **Step 4: Implement PDF normalization**

Using PDF-Lib:

- preserve portrait/landscape A4 pages;
- scale other pages proportionally onto A4;
- center images without stretching;
- merge selected attachment PDFs/images after the generated contract PDF;
- return:

```typescript
{
  buffer: Buffer;
  pageCount: number;
  warnings: string[];
  pageSizes: Array<"A4_portrait" | "A4_landscape">;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- libreoffice-converter.spec.ts pdf-normalizer.spec.ts
```

Expected: PASS without requiring an installed LibreOffice binary.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract-document
git commit -m "feat(api): convert contract DOCX and normalize PDFs"
```

### Task 14: Add persistent document jobs and polling processor

**Files:**
- Create: `services/api/src/contract-document/contract-document.module.ts`
- Create: `services/api/src/contract-document/contract-document.controller.ts`
- Create: `services/api/src/contract-document/contract-document.service.ts`
- Create: `services/api/src/contract-document/contract-document.processor.ts`
- Create: `services/api/src/contract-document/contract-document.service.spec.ts`
- Create: `services/api/src/contract-document/contract-document.processor.spec.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Write failing job tests**

Cover:

```typescript
it("queues a document for the current draft revision");
it("marks older successful documents stale after a draft save");
it("claims one queued job and marks it processing");
it("renders DOCX, converts PDF, uploads both files, and marks success");
it("renders a queued layout preview and attaches its PDF");
it("marks failure with a bounded error message and allows retry");
it("does not produce duplicate files when a completed job is polled again");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-document.service.spec.ts contract-document.processor.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement queue service**

Routes:

```text
POST /contract-workbench/:contractVersionId/documents
GET  /contract-workbench/:contractVersionId/documents
POST /contract-documents/:documentId/retry
```

Create input:

```typescript
{
  layoutTemplateVersionId: string;
  purpose: "draft" | "negotiation" | "internal_review";
  attachmentFileIds?: string[];
}
```

Rules:

- owner only for draft generation;
- layout version must be published;
- draft and negotiation generation may have readiness warnings;
- internal-review generation requires no blocking readiness errors;
- snapshot all render input at queue time;
- store current `draftRevision`;
- generate one idempotency key from contract version, revision, layout version, purpose, and attachment ids;
- return an existing queued/processing/success job for the same key.

- [ ] **Step 4: Implement the processor**

Use `OnApplicationBootstrap` and one interval:

```typescript
@Injectable()
export class ContractDocumentProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.processNext(), 1000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
```

`processNext`:

- first atomically claim one queued layout-preview job; if none exists, claim one queued contract-document row;
- atomically change the claimed row to `processing`;
- render layout-preview jobs with their saved sample data, upload the preview PDF, and mark the job successful;
- build or load the saved input snapshot;
- load the DOCX template buffer;
- render DOCX;
- convert to PDF;
- normalize/merge selected attachments;
- upload generated DOCX and PDF through `FileService`;
- mark the row `success`, file ids, timestamps, engine version, inspection results;
- on failure mark `failed`, store at most 2,000 characters, and retain the input snapshot;
- record audit events for queue, success, failure, and retry.

Ponytail constraint:

```typescript
// ponytail: one DB-backed worker matches the current single API deployment;
// replace with a distributed queue before running multiple API replicas.
```

- [ ] **Step 5: Register and test**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-document.service.spec.ts contract-document.processor.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/api lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract-document services/api/src/app.module.ts services/api/prisma
git commit -m "feat(api): add persistent contract document generation"
```

### Task 15: Add readiness checks and freeze the phase-1 draft on approval submission

**Files:**
- Create: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Create: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Create: `services/api/src/contract-workbench/contract-numbering.service.ts`
- Create: `services/api/src/contract-workbench/contract-numbering.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`

- [ ] **Step 1: Write failing readiness tests**

Cover:

```typescript
it("allows an incomplete draft to save");
it("blocks internal review when a required field is missing");
it("blocks when a required clause is empty");
it("blocks when required payment-basis phrases are missing");
it("warns but does not block for non-critical phrase rules");
it("blocks approval submission when the latest internal-review document is stale");
it("stores the readiness snapshot when submission succeeds");
it("allocates a unique formal number from a configured rule");
it("never reuses a consumed sequence after a later contract is voided");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-readiness.service.spec.ts contract.service.spec.ts
```

Expected: FAIL because readiness validation does not exist.

- [ ] **Step 3: Implement readiness**

Return:

```typescript
export interface ContractReadinessResult {
  blocking: Array<{ key: string; section: string; message: string }>;
  warnings: Array<{ key: string; section: string; message: string }>;
  checkedRevision: number;
}
```

Check:

- required structured fields;
- required clauses and required phrases;
- bill row errors and empty required bills;
- contract amount/manual adjustment reason consistency;
- selected published layout;
- all required party roles;
- latest successful internal-review document matches current revision and layout;
- no unresolved document-generation failure for the current revision.

Attachment completeness is represented in the template snapshot but enforced in stage 2 when attachment classification is implemented.

- [ ] **Step 4: Integrate submission**

Before existing `submitApproval` changes status:

- run readiness;
- reject if `blocking.length > 0`;
- allocate a formal contract code from the selected active numbering rule;
- store `readinessSnapshot`;
- freeze the current draft, clauses, bills, layout, and latest internal-review document references in `templateSnapshot`/`clauseSnapshot` and audit metadata;
- continue to create the existing approval instance unchanged.

Implement `ContractNumberingService`:

- global `contract_staff` can list active rules;
- global `contract_director` can create, update, and stop rules;
- supported tokens are `{company}`, `{project}`, `{year}`, `{type}`, and `{sequence}`;
- reject unknown tokens;
- atomically increment `nextSequence` inside the submission transaction;
- use the returned pre-increment value, padded to `sequenceWidth`;
- never decrement or reuse a consumed sequence;
- allow an optional manual override only with a reason and global `contract_director` authorization.

Routes:

```text
GET   /contract-number-rules
POST  /contract-number-rules
PATCH /contract-number-rules/:ruleId
POST  /contract-number-rules/:ruleId/stop
```

Update submission DTO:

```typescript
export interface SubmitContractApprovalDto {
  numberRuleId: string;
  formalCodeOverride?: string;
  overrideReason?: string;
}
```

Update controller and Web client accordingly.

In the existing contract detail page, add a numbering-rule selector before “提交审批”. Call:

```typescript
submitContractApproval(contractVersionId, {
  numberRuleId: selectedNumberRuleId
});
```

Do not keep the old body-less submission call.

- [ ] **Step 5: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-readiness.service.spec.ts contract.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract-workbench services/api/src/contract
git commit -m "feat(api): validate and freeze contract submissions"
```

## Milestone E: Web Workbench and Template Center

### Task 16: Add workbench API client and routes

**Files:**
- Create: `apps/web-admin/src/api/contract-workbench.api.ts`
- Create: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractListPage.vue`
- Modify: `apps/web-admin/src/app/AdminLayout.vue`

- [ ] **Step 1: Write failing API client tests**

Call each exported function with explicit sample input:

```typescript
await createWorkbenchDraft({
  projectId: "project-1",
  contractTypeKey: "material_purchase",
  businessTemplateVersionId: "template-version-1"
});
await fetchContractWorkbench("contract-1");
await listContractDrafts("my");
await listContractDrafts("voided");
await saveContractDraft("version-1", {
  expectedRevision: 1,
  draftData: { name: "钢材采购合同" },
  clauses: [],
  pricingNature: "fixed_total",
  amountSource: "manual",
  manualAmountCents: 1_000_000
});
await createDraftCheckpoint("version-1", { name: "首次完整稿" });
await restoreDraftCheckpoint("version-1", "checkpoint-1");
await voidContractDraft("contract-1", { reason: "重复创建" });
await previewContractTypeChange("version-1", {
  targetBusinessTemplateVersionId: "template-version-2",
  expectedRevision: 2
});
await transferContractDraft("contract-1", { toUserId: "contract-user-2" });
await listBusinessParties("云南");
await createBusinessParty({
  name: "云南示例供应商有限公司",
  unifiedSocialCreditCode: "91530000EXAMPLE01",
  attachments: []
});
await addContractParty("version-1", {
  roleKey: "party_b",
  businessPartyVersionId: "party-version-1"
});
await listContractNumberRules();
await createContractNumberRule({
  name: "项目材料合同编号",
  pattern: "HT-{project}-{year}-{type}-{sequence}",
  contractTypeKey: "material_purchase",
  sequenceWidth: 3
});
await listPublishedContractTemplates("material_purchase");
await listPublishedLayoutTemplates("material_purchase");
await addBillRow("bill-1", {
  expectedBillRevision: 1,
  itemName: "螺纹钢",
  unit: "吨",
  quantity: "10",
  unitPrice: "3500",
  taxRatePercent: "13",
  customData: {}
});
await updateBillRow("bill-1", "row-1", {
  expectedBillRevision: 2,
  itemName: "螺纹钢",
  unit: "吨",
  quantity: "12",
  unitPrice: "3500",
  taxRatePercent: "13",
  customData: {}
});
await downloadBillExcelTemplate("bill-1");
await previewBillExcelImport("bill-1", { fileId: "file-1", mode: "update" });
await applyBillExcelImport("import-1");
await queueContractDocument("version-1", {
  layoutTemplateVersionId: "layout-version-1",
  purpose: "draft"
});
await listContractDocuments("version-1");
```

Assert `PATCH` is used for autosave and `FormData` is not used for already-uploaded Excel file ids.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts
```

Expected: FAIL because the API client does not exist.

- [ ] **Step 3: Implement the API client**

Keep one local `ensureOk`, `readJson`, `postJson`, and `patchJson` implementation in the new file. Do not modify the large existing core-flow client for these workbench endpoints.

- [ ] **Step 4: Add routes**

```typescript
{
  path: "contracts/new",
  component: () => import("../pages/contracts/ContractWorkbenchPage.vue")
},
{
  path: "contracts/:contractId/workbench",
  component: () => import("../pages/contracts/ContractWorkbenchPage.vue")
},
{
  path: "contract-templates",
  component: () => import("../pages/contract-templates/ContractTemplateListPage.vue")
}
```

Place `/contracts/new` before `/contracts/:contractId`.

- [ ] **Step 5: Replace the list-page modal entry**

The “新建合同” button must route directly:

```typescript
void router.push("/contracts/new");
```

Remove the legacy minimal create form and its default seed project/code values.

Add “合同模板” to the sidebar.

Add “我的草稿” and “已作废草稿” tabs to the contract list. Each tab uses the workbench draft-list endpoint and opens `/contracts/:contractId/workbench`.

- [ ] **Step 6: Run tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts routes/index.test.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/src/api apps/web-admin/src/routes apps/web-admin/src/pages/contracts/ContractListPage.vue apps/web-admin/src/app/AdminLayout.vue
git commit -m "feat(web): add contract workbench routes and client"
```

### Task 17: Build the workbench shell and autosave state

**Files:**
- Create: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractOverviewSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBasicSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractPartySection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractProfessionalFieldsSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractPricingSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractReadinessPanel.vue`

- [ ] **Step 1: Write failing autosave tests**

Use fake timers. Cover:

```typescript
it("does not create a draft before project and type are selected");
it("creates the draft after project, type, and template are selected");
it("debounces autosave");
it("shows saving, saved, failed, and conflict states");
it("keeps local edits when autosave fails");
it("pauses after a revision conflict until the user chooses local or server data");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- use-contract-draft.test.ts
```

Expected: FAIL because the composable does not exist.

- [ ] **Step 3: Implement the composable**

Expose:

```typescript
{
  model,
  workbench,
  saveState,
  conflict,
  initializeDraft,
  load,
  markDirty,
  saveNow,
  createCheckpoint,
  restoreCheckpoint,
  keepLocalAfterConflict,
  loadServerAfterConflict
}
```

Autosave rules:

- debounce 1,000ms after a change;
- send `expectedRevision`;
- never clear dirty state before the request succeeds;
- on conflict, pause autosave;
- keep unsaved data in `localStorage` under `contract-draft:<contractVersionId>`;
- remove local backup only after a successful save.
- before creating a sixth manual checkpoint, show that the oldest of the five retained checkpoints will be removed and require confirmation.

- [ ] **Step 4: Build the professional shell**

Use:

- fixed top status bar;
- 220px left section navigation;
- flexible center editor;
- 300px right readiness panel;
- responsive collapse under 1100px;
- no nested cards;
- stable heights for toolbar controls;
- explicit save button beside autosave status.

For `/contracts/new`:

- show project, contract type, and business template selectors in the center;
- create only after all required selections are made;
- replace the URL with `/contracts/<id>/workbench`.

For an existing contract:

- load the workbench;
- select sections without route changes;
- disable editing when status is not draft/editable.
- allow a contract director to view and transfer ownership;
- show a migration preview before applying a new contract type.

- [ ] **Step 5: Implement basic sections**

The first set edits:

- contract name;
- my company entity;
- multiple party roles selected from the phase-1 cooperation-unit records or entered as an inline snapshot;
- qualification attachment references and validity dates;
- pricing nature;
- amount source and manual amount;
- dynamic professional fields;
- simple party values stored in `draftData`;
- readiness messages.

- [ ] **Step 6: Run tests and build**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- use-contract-draft.test.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/src/pages/contracts
git commit -m "feat(web): build contract workbench shell"
```

### Task 18: Add bill, clause, and document sections

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBillsSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`

- [ ] **Step 1: Write failing bill editor tests**

Cover:

```typescript
it("shows one tab per configured bill");
it("edits rows without changing row keys");
it("downloads the selected bill template");
it("shows import added, updated, removed, skipped, and error counts");
it("does not apply an import containing errors");
it("marks generated documents stale after bill changes");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-bill-editor.test.ts
```

Expected: FAIL because the editor does not exist.

- [ ] **Step 3: Implement bill editing**

Use a dense table with:

- add, duplicate, delete, and reorder actions;
- fixed core columns;
- template-defined custom columns;
- tax-rate per row;
- totals footer;
- Excel template download;
- upload via existing `uploadPrivateFile`;
- preview dialog;
- explicit apply button;
- conflict/error messages that preserve current rows.

Do not implement spreadsheet formulas in the browser. Show values returned by the API.

- [ ] **Step 4: Implement clause editing**

For each clause:

- title and numbering mode;
- content editor with paragraph text, basic emphasis, lists, and small tables;
- standard clause source/version badge;
- “已偏离标准条款” badge when content differs;
- required and readiness status;
- insert from published clause library.

Use a constrained JSON document model. Do not embed a general-purpose Word editor.

- [ ] **Step 5: Implement document generation**

Show:

- layout template selector with preview thumbnail/file link;
- purpose segmented control: 草稿、对外磋商稿、内部送审稿;
- queue button;
- polling every 2 seconds while a job is queued or processing;
- status, revision, generated time, warnings, DOCX download and PDF preview;
- stale badge when `sourceRevision !== current revision`;
- retry button for failed jobs.

- [ ] **Step 6: Run tests and build**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-bill-editor.test.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/src/pages/contracts/workbench apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
git commit -m "feat(web): add bills clauses and document generation"
```

### Task 19: Build the template center Web UI

**Files:**
- Create: `apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue`
- Create: `apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue`
- Create: `apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue`
- Create: `apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue`
- Create: `apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue`
- Create: `apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue`
- Create: `apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue`
- Create: `apps/web-admin/src/pages/contract-templates/contract-template.config.ts`
- Create: `apps/web-admin/src/pages/contract-templates/contract-template.config.test.ts`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`

- [ ] **Step 1: Write failing page/config tests**

Assert:

- template list exposes status, type, latest version, publisher, and actions;
- editors expose only supported field types;
- quantity scale options are 0 through 6;
- unit-price scale options are 2 through 6;
- no script/formula field type exists;
- published versions have no direct edit action;
- layout publication is disabled without inspection success and preview PDF.
- cooperation-unit edits create a visible new version instead of replacing historical data.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-template.config.test.ts
```

Expected: FAIL because the template center does not exist.

- [ ] **Step 3: Add routes**

```text
/contract-templates
/contract-templates/:templateId
/contract-layout-templates/:layoutTemplateId
/standard-clauses
/business-parties
/business-parties/:partyId
/contract-number-rules
```

- [ ] **Step 4: Implement business template editor**

Use tabs:

- fields;
- bills and columns;
- clause blocks;
- attachment requirements;
- validation rules.

Controls:

- field-type select;
- required checkbox;
- options list;
- simple equality visibility condition;
- bill amount role, pricing mode, quantity scale, price scale;
- publish workflow actions.

Do not implement drag-and-drop. Use explicit move-up/move-down buttons for deterministic ordering.

- [ ] **Step 5: Implement layout editor**

Support:

- DOCX upload through existing file API;
- placeholder reference list;
- inspection report;
- sample-data editor;
- queued preview generation with polling;
- generated PDF preview from the latest successful preview job;
- submit, publish, stop, revoke, and clone;
- fixed-content cross-company warning text;
- no logo controls.

- [ ] **Step 6: Implement clause library**

Support:

- category filter;
- clause draft creation;
- version history;
- publication;
- read-only published version preview.

- [ ] **Step 7: Implement cooperation-unit archive pages**

Support:

- search by name or unified social credit code;
- create a party and a new immutable version;
- upload and classify qualification attachments;
- show attachment validity dates;
- show version history;
- do not add bank-account approval behavior in phase 1; payment account governance remains stage 3.

Add “合作单位档案” to the sidebar.

- [ ] **Step 8: Implement numbering-rule maintenance**

Support:

- pattern editing with only `{company}`, `{project}`, `{year}`, `{type}`, `{sequence}`;
- sequence width;
- optional company, project, and contract-type scope;
- current next-sequence preview;
- stop but never delete a used rule;
- no reset or decrement action.

- [ ] **Step 9: Run tests and build**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web-admin/src/pages/contract-templates apps/web-admin/src/pages/business-parties apps/web-admin/src/routes apps/web-admin/src/api/contract-workbench.api.ts apps/web-admin/src/app/AdminLayout.vue
git commit -m "feat(web): add contract template and party centers"
```

## Milestone F: End-to-End Verification

### Task 20: Seed one complete material-purchase template

**Files:**
- Modify: `services/api/prisma/seed.cjs`
- Modify: `services/api/src/database/core-flow-seed-data.spec.ts`
- Add: `services/api/assets/templates/material-purchase-v1.docx`

- [ ] **Step 1: Add the seed test**

Assert the seed contains:

- published `material_purchase` business template v1;
- fields for delivery, quality, tax, and settlement;
- at least two bills: material price list and transport fee list;
- required payment-basis clause rule;
- published standard payment clause;
- published DOCX layout version with preview metadata.
- active numbering rule `HT-{project}-{year}-{type}-{sequence}`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- core-flow-seed-data.spec.ts
```

Expected: FAIL because the template seed is absent.

- [ ] **Step 3: Add deterministic seed data**

Use stable ids and idempotent upserts. The DOCX fixture must contain:

```text
{{contract.name}}
{{contract.temporaryCode}}
{{contract.amountUppercase}}
{{field.deliveryLocation}}
{{clause.payment.text}}
{#bill.materials}
{itemName} {specification} {unit} {quantity} {unitPrice} {taxRatePercent} {taxInclusiveAmount}
{/bill.materials}
```

Keep the fixture intentionally plain but valid A4; production administrators will upload corporate layouts through the UI.

- [ ] **Step 4: Run seed tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- core-flow-seed-data.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/prisma/seed.cjs services/api/src/database/core-flow-seed-data.spec.ts services/api/assets/templates/material-purchase-v1.docx
git commit -m "test(seed): add material contract workbench template"
```

### Task 21: Add phase-1 verification script

**Files:**
- Create: `services/api/prisma/verify-contract-workbench.cjs`
- Modify: `services/api/package.json`
- Create: `services/api/src/database/contract-workbench-verification.spec.ts`

- [ ] **Step 1: Add a static verification test**

Assert the script contains calls for:

```text
login
list published templates
create minimal draft
autosave
manual checkpoint
add bill row
export Excel template
upload/import/apply Excel
queue document
poll document success
submit approval
```

- [ ] **Step 2: Add the package script**

```json
"preverify:contract-workbench": "node ../../scripts/pnpm-workspace.mjs --filter @jiangkong/api build",
"verify:contract-workbench": "node prisma/verify-contract-workbench.cjs"
```

- [ ] **Step 3: Implement live verification**

The script must:

1. log in as seeded contract staff;
2. fetch the published material template;
3. create a draft;
4. save name, company, price nature, clauses, and fields;
5. create a checkpoint;
6. add a material row;
7. export the XLSX template;
8. modify the XLSX in memory with ExcelJS;
9. upload it through `/files`;
10. preview and apply the import;
11. queue a draft document;
12. poll until success or a 60-second timeout;
13. assert DOCX and PDF file ids exist;
14. queue an internal-review document;
15. submit approval using the seeded numbering rule;
16. assert the contract version is `in_approval`;
17. assert audit logs exist for create, save, import, document success, and submission.

If LibreOffice is unavailable, fail with:

```text
DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path.
```

- [ ] **Step 4: Run automated tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/api lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/api build
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin build
```

Expected: all commands PASS.

- [ ] **Step 5: Install/configure LibreOffice and run live verification**

On the development machine, install LibreOffice or point `DOC_CONVERTER_COMMAND` to an existing executable, then run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api verify:contract-workbench
```

Expected: the script prints a successful draft-to-submission trace and exits 0.

- [ ] **Step 6: Commit**

```bash
git add services/api/prisma/verify-contract-workbench.cjs services/api/package.json services/api/src/database/contract-workbench-verification.spec.ts
git commit -m "test(api): verify contract workbench phase 1"
```

### Task 22: Browser verification and project progress

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Start the API and Web servers**

Run in separate sessions:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api dev
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin dev
```

Expected: API and Vite report ready URLs.

- [ ] **Step 2: Verify desktop Chrome/Edge layout**

Using Playwright or the in-app browser:

- open `/contracts`;
- click new contract and confirm direct workbench entry;
- select project, type, and template;
- add Party B from the cooperation-unit archive and add a Party C inline snapshot;
- verify autosave and manual save states;
- edit every basic section;
- add and edit bill rows;
- download, upload, preview, and apply Excel;
- edit a standard clause and verify the deviation badge;
- generate draft and internal-review Word/PDF;
- preview PDF and download DOCX;
- refresh and verify persisted data;
- create six manual checkpoints and confirm only five remain;
- preview a contract-type change and cancel it without data loss;
- submit with a numbering rule and confirm the formal number is permanently occupied;
- open the same draft in two tabs and verify conflict handling;
- resize to 1440x900 and 1100x800 and confirm no overlap or clipped controls.

- [ ] **Step 3: Verify template center**

- create a template draft;
- add supported field and bill definitions;
- confirm no script/formula field exists;
- submit and publish;
- upload a DOCX layout;
- inspect placeholders;
- generate and review preview;
- publish layout;
- clone the version and confirm the published source remains unchanged.
- create a cooperation-unit version and confirm an existing contract party snapshot does not change;
- create and stop a numbering rule, confirming no sequence reset control exists.

- [ ] **Step 4: Update `PROGRESS.md`**

Add a top entry containing:

- completed phase-1 capabilities;
- exact automated test counts;
- live verification result;
- LibreOffice configuration used;
- remaining stage-2 work;
- any deliberate limitations.

Mark only work actually verified as complete.

- [ ] **Step 5: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: record contract workbench phase 1"
```

## Final Verification

Run from repository root:

```bash
node scripts/pnpm-workspace.mjs -r test
node scripts/pnpm-workspace.mjs -r typecheck
node scripts/pnpm-workspace.mjs -r lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/api build
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin build
node scripts/pnpm-workspace.mjs --filter @jiangkong/api verify:core-flow
node scripts/pnpm-workspace.mjs --filter @jiangkong/api verify:contract-workbench
git status --short
```

Expected:

- all test, typecheck, lint, and build commands pass;
- existing contract-to-settlement-to-payment verification still passes;
- new contract-workbench verification passes;
- `git status --short` is empty.

## Deferred Upgrade Triggers

- Replace the in-process document worker with a distributed queue only before multiple API replicas are deployed.
- Add multipart/resumable upload only when real 100MB uploads show reliability problems.
- Add richer DOCX table modules only if uploaded corporate templates cannot express required loops with standard Docxtemplater tags.
- Add browser spreadsheet behavior only if web row editing proves insufficient; Excel remains the bulk-edit path.

## Implementation References

- ExcelJS workbook and worksheet API: https://github.com/exceljs/exceljs
- Docxtemplater Node.js and tag documentation: https://docxtemplater.com/docs/
- LibreOffice command-line parameters: https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html
- PDF-Lib page creation, embedding, and copying: https://pdf-lib.js.org/
