# Real Contract Word Template Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 当前状态（2026-07-03）：本文对应的真实合同 Word 初稿能力已并入合同工作台第一阶段。历史已签合同试运行接管不要求重排历史原件；原件只作为归档证据和付款条款/余额补录依据。

**Goal:** Generate downloadable Word first drafts that closely preserve the three real company contract templates, while keeping a simple generic Word fallback for contract types that do not yet have a dedicated template.

**Architecture:** Keep the current enterprise contract workbench as the source of structured data, and use high-fidelity DOCX files as layout shells. The backend continues to render through the existing DOCX queue, but seed data points to real placeholderized templates; unsupported contract types use a published generic business template and generic DOCX layout until a dedicated template is uploaded later. Offline Word edits are stored as confirmed uploaded revision files without trying to reverse-parse Word back into structured fields.

**Tech Stack:** NestJS, Prisma, PostgreSQL, PizZip, Docxtemplater, LibreOffice, Vue 3, TypeScript, TDesign Web, Vitest/Jest.

---

## Requirements Locked By User

- All contract drafts are created by contract staff or contract director.
- Contract staff and contract director can both create drafts and submit approval.
- Contract staff is the day-to-day contract controller; contract director is also allowed to create and submit.
- For the next implementation round, do not build complex clause intelligence.
- Word first draft quality is the priority: page margins, page breaks, table styles, header/footer, spacing, and pagination should be as close as practical to the original Word files.
- Key clauses are editable through the workbench. Long fixed clauses stay fixed in the DOCX template.
- No risk prompt is needed because approval follows later.
- Offline Word revision upload is simple: download generated DOCX, edit offline, upload back, confirm it as a manual revision.
- Labor subcontract next round includes only main contract, safety agreement, migrant worker wage commitment, and labor bill.
- Professional subcontract, procurement contracts without a current real template, and other contracts must be supported through a generic Word first-draft template now; when dedicated templates are uploaded later, new contracts can use those templates, while historical generated/approved/archived files remain untouched.

## Source Word Files

Use these as the source-of-truth layout samples during Task 1:

- `/Users/leoyang/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/yjx1031_aa30/temp/drag/CHYB-材-2026-008-其他消耗材购销合同 (2)(1).docx`
- `/Users/leoyang/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/yjx1031_aa30/temp/drag/工程机械设备租赁服务合同（试行）范本-中小企业(1).docx`
- `/Users/leoyang/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/yjx1031_aa30/temp/drag/劳务合同(1).doc`

The labor file is `.doc`; convert it to `.docx` before placeholderization.

## Out Of Scope For This Round

- No DOCX diff viewer.
- No automatic Word reverse parsing into structured fields.
- No OCR.
- No electronic signing.
- No legal risk scoring.
- No arbitrary contract-type registry UI beyond the existing template center plus the generic fallback template.
- No promise of pixel-perfect Word rendering, because Word pagination can vary by font and environment; the target is close preservation of the original DOCX layout shell and visible manual spot checks.

## File Structure

- `services/api/assets/source-contract-templates/` stores copied real source templates for repeatable local development.
- `services/api/assets/templates/` stores placeholderized renderable DOCX assets used by seed data.
- `services/api/src/database/core-flow-seed-data.ts` defines business templates, fields, bills, clauses, layout template metadata, and numbering rules.
- `services/api/prisma/seed.cjs` copies seed DOCX/PDF assets into private storage and upserts file/template records.
- `services/api/src/database/contract-template-docx-assets.spec.ts` validates that the high-fidelity DOCX assets contain required placeholders and Word sections.
- `services/api/prisma/schema.prisma` adds the simple offline revision persistence model.
- `services/api/src/contract-document/contract-document.service.ts` owns document queue/list/retry plus new manual revision upload/list logic.
- `services/api/src/contract-document/contract-document.controller.ts` exposes the new revision endpoints.
- `apps/web-admin/src/api/contract-workbench.api.ts` adds client wrappers for manual revisions.
- `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue` adds the simple upload-and-confirm UI.
- `prisma/verify-contract-workbench.cjs` extends live verification for real template coverage.
- `PROGRESS.md` records completion.

---

### Task 1: Intake Real Word Templates As Stable Assets

**Files:**
- Create: `services/api/assets/source-contract-templates/README.md`
- Create: `services/api/assets/source-contract-templates/material-purchase-source.docx`
- Create: `services/api/assets/source-contract-templates/equipment-rental-source.docx`
- Create: `services/api/assets/source-contract-templates/labor-subcontract-source.docx`
- Create: `services/api/assets/templates/material-purchase-real-v1.docx`
- Create: `services/api/assets/templates/equipment-rental-real-v1.docx`
- Create: `services/api/assets/templates/labor-subcontract-real-v1.docx`
- Create: `services/api/assets/templates/generic-contract-v1.docx`

- [ ] **Step 1: Copy the two DOCX source templates into the repo**

Run:

```bash
mkdir -p services/api/assets/source-contract-templates
cp "/Users/leoyang/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/yjx1031_aa30/temp/drag/CHYB-材-2026-008-其他消耗材购销合同 (2)(1).docx" services/api/assets/source-contract-templates/material-purchase-source.docx
cp "/Users/leoyang/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/yjx1031_aa30/temp/drag/工程机械设备租赁服务合同（试行）范本-中小企业(1).docx" services/api/assets/source-contract-templates/equipment-rental-source.docx
```

Expected: both files exist and `file` reports Microsoft Word 2007+ format.

- [ ] **Step 2: Convert the labor `.doc` file to `.docx`**

Run:

```bash
mkdir -p services/api/assets/source-contract-templates
/Applications/LibreOffice.app/Contents/MacOS/soffice \
  --headless \
  --convert-to docx \
  --outdir services/api/assets/source-contract-templates \
  "/Users/leoyang/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/yjx1031_aa30/temp/drag/劳务合同(1).doc"
mv "services/api/assets/source-contract-templates/劳务合同(1).docx" services/api/assets/source-contract-templates/labor-subcontract-source.docx
```

Expected: `services/api/assets/source-contract-templates/labor-subcontract-source.docx` exists and opens in Word/LibreOffice.

- [ ] **Step 3: Create the source asset README**

Write `services/api/assets/source-contract-templates/README.md`:

```markdown
# Source Contract Templates

These files are copied from the company's real contract templates and are kept as stable layout references for the contract workbench.

- `material-purchase-source.docx`: other consumable/material purchase contract.
- `equipment-rental-source.docx`: engineering machinery equipment rental service contract.
- `labor-subcontract-source.docx`: labor contract converted from the original `.doc` file.

Do not render these files directly. The renderable assets live in `services/api/assets/templates/*-real-v1.docx` after placeholders are inserted.
```

- [ ] **Step 4: Placeholderize the material purchase DOCX**

Start from `material-purchase-source.docx` and save as `services/api/assets/templates/material-purchase-real-v1.docx`.

Required placeholder rules:

- Preserve the original page setup, header/footer, page breaks, table borders, table widths, fonts, and signature areas.
- Replace only the fields contract staff should fill from the workbench.
- Keep long fixed clauses as normal Word text.
- Add `{{document.watermark}}` in a header or first-page visible location supported by the current renderer.
- Include these placeholders at minimum:
  - `{{contract.name}}`
  - `{{contract.temporaryCode}}`
  - `{{contract.amountUppercase}}`
  - `{{field.deliveryLocation}}`
  - `{{field.deliveryDeadline}}`
  - `{{field.qualityStandard}}`
  - `{{field.taxRatePercent}}`
  - `{{field.settlementMethod}}`
  - `{{clause.payment.text}}`
  - a Docxtemplater loop for `bill.materials`

The materials bill loop must use existing renderer syntax:

```text
{#bill.materials}
{{itemName}} {{specification}} {{unit}} {{quantity}} {{unitPrice}} {{taxRatePercent}} {{taxInclusiveAmount}}
{/bill.materials}
```

- [ ] **Step 5: Placeholderize the equipment rental DOCX**

Start from `equipment-rental-source.docx` and save as `services/api/assets/templates/equipment-rental-real-v1.docx`.

Required placeholders:

- `{{document.watermark}}`
- `{{contract.name}}`
- `{{contract.temporaryCode}}`
- `{{contract.amountUppercase}}`
- `{{field.rentalStartDate}}`
- `{{field.rentalEndDate}}`
- `{{field.useLocation}}`
- `{{field.settlementCycle}}`
- `{{field.paymentRatioPercent}}`
- `{{clause.payment.text}}`
- a Docxtemplater loop for `bill.equipmentRentals`

- [ ] **Step 6: Placeholderize the labor subcontract DOCX**

Start from `labor-subcontract-source.docx` and save as `services/api/assets/templates/labor-subcontract-real-v1.docx`.

Keep only these sections for this round:

- main contract
- safety agreement
- migrant worker wage commitment
- labor bill

Required placeholders:

- `{{document.watermark}}`
- `{{contract.name}}`
- `{{contract.temporaryCode}}`
- `{{contract.amountUppercase}}`
- `{{field.workScope}}`
- `{{field.workLocation}}`
- `{{field.plannedStartDate}}`
- `{{field.plannedEndDate}}`
- `{{field.settlementCycle}}`
- `{{field.progressPaymentRatioPercent}}`
- `{{clause.payment.text}}`
- `{{clause.safety.text}}`
- `{{clause.wageCommitment.text}}`
- a Docxtemplater loop for `bill.laborItems`

- [ ] **Step 7: Create the generic fallback DOCX**

Create `services/api/assets/templates/generic-contract-v1.docx` as a conservative A4 Word template with:

- title
- contract code
- project name
- counterparty
- amount uppercase
- editable business summary
- editable payment clause
- one generic bill table
- signature area
- header/footer

Required placeholders:

- `{{document.watermark}}`
- `{{contract.name}}`
- `{{contract.temporaryCode}}`
- `{{contract.amountUppercase}}`
- `{{field.businessSummary}}`
- `{{field.settlementCycle}}`
- `{{field.paymentRatioPercent}}`
- `{{clause.payment.text}}`
- `{{clause.specialAgreement.text}}`
- a Docxtemplater loop for `bill.genericItems`

- [ ] **Step 8: Commit source and renderable DOCX assets**

Run:

```bash
git add services/api/assets/source-contract-templates services/api/assets/templates
git commit -m "feat(api): add real contract docx template assets"
```

Expected: commit succeeds and no generated storage files are staged.

---

### Task 2: Add DOCX Asset Validation Tests Before Changing Seed Data

**Files:**
- Create: `services/api/src/database/contract-template-docx-assets.spec.ts`

- [ ] **Step 1: Write the failing DOCX asset test**

Create `services/api/src/database/contract-template-docx-assets.spec.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import PizZip from "pizzip";

const repoRoot = path.resolve(__dirname, "../../../..");
const templatesRoot = path.join(repoRoot, "services/api/assets/templates");

function readDocxXml(fileName: string) {
  const filePath = path.join(templatesRoot, fileName);
  expect(existsSync(filePath)).toBe(true);
  const zip = new PizZip(readFileSync(filePath));
  const xmlFiles = Object.keys(zip.files)
    .filter((name) => name.startsWith("word/") && name.endsWith(".xml"))
    .map((name) => zip.file(name)?.asText() ?? "");
  return {
    fileNames: Object.keys(zip.files),
    text: xmlFiles.join("\n")
  };
}

describe("contract DOCX template assets", () => {
  it.each([
    {
      fileName: "material-purchase-real-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.deliveryLocation",
        "field.deliveryDeadline",
        "field.qualityStandard",
        "field.taxRatePercent",
        "field.settlementMethod",
        "clause.payment.text",
        "bill.materials"
      ]
    },
    {
      fileName: "equipment-rental-real-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.rentalStartDate",
        "field.rentalEndDate",
        "field.useLocation",
        "field.settlementCycle",
        "field.paymentRatioPercent",
        "clause.payment.text",
        "bill.equipmentRentals"
      ]
    },
    {
      fileName: "labor-subcontract-real-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.workScope",
        "field.workLocation",
        "field.plannedStartDate",
        "field.plannedEndDate",
        "field.settlementCycle",
        "field.progressPaymentRatioPercent",
        "clause.payment.text",
        "clause.safety.text",
        "clause.wageCommitment.text",
        "bill.laborItems"
      ]
    },
    {
      fileName: "generic-contract-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.businessSummary",
        "field.settlementCycle",
        "field.paymentRatioPercent",
        "clause.payment.text",
        "clause.specialAgreement.text",
        "bill.genericItems"
      ]
    }
  ])("$fileName contains required placeholders and Word sections", ({ fileName, placeholders }) => {
    const docx = readDocxXml(fileName);
    expect(docx.fileNames.some((name) => name.startsWith("word/header"))).toBe(true);
    expect(docx.fileNames.some((name) => name.startsWith("word/footer"))).toBe(true);
    expect(docx.text).toContain("sectPr");
    expect(docx.text).toContain("document.watermark");
    for (const placeholder of placeholders) {
      expect(docx.text).toContain(placeholder);
    }
  });
});
```

- [ ] **Step 2: Run the new test**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-template-docx-assets.spec.ts
```

Expected: PASS after Task 1 assets exist. If it fails, fix the DOCX placeholders or headers/footers before touching seed data.

- [ ] **Step 3: Commit asset validation**

Run:

```bash
git add services/api/src/database/contract-template-docx-assets.spec.ts
git commit -m "test(api): validate real contract docx assets"
```

---

### Task 3: Point Seed Data At Real Templates And Add Generic Fallback Template

**Files:**
- Modify: `services/api/src/database/core-flow-seed-data.ts`
- Modify: `services/api/prisma/seed.cjs`
- Modify: `services/api/src/database/core-flow-seed-data.spec.ts`
- Modify: `services/api/src/database/contract-workbench-verification.spec.ts`
- Modify: `services/api/prisma/verify-contract-workbench.cjs`

- [ ] **Step 1: Write failing seed-data assertions**

Update seed-data tests to require:

- `material_purchase` layout `originalName` is `material-purchase-real-v1.docx`
- `equipment_rental` layout `originalName` is `equipment-rental-real-v1.docx`
- `labor_subcontract` layout `originalName` is `labor-subcontract-real-v1.docx`
- `generic_contract` business template exists and is published
- `generic_contract` layout `originalName` is `generic-contract-v1.docx`
- `labor_subcontract` contains exactly these next-round attachment/section clauses: main contract data, safety agreement, migrant worker wage commitment, labor bill

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- core-flow-seed-data.spec.ts contract-workbench-verification.spec.ts
```

Expected: FAIL because the current seeds still point at the plain sample DOCX names and no generic template exists.

- [ ] **Step 2: Update `core-flow-seed-data.ts` template metadata**

Change the three existing layout names and file metadata:

```ts
docxFile: {
  id: "seed-file-layout-material-purchase-real-v1-docx",
  bucket: "private-local",
  objectKey: "seed/templates/material-purchase-real-v1.docx",
  originalName: "material-purchase-real-v1.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

Use equivalent IDs/object keys/original names for:

- `equipment-rental-real-v1.docx`
- `labor-subcontract-real-v1.docx`
- `generic-contract-v1.docx`

Keep old IDs only if existing local seed idempotency depends on them. If IDs change, ensure `seed.cjs` upserts by the new IDs and rerunning seed is clean.

- [ ] **Step 3: Add `genericContractWorkbench` to `coreFlowSeedData`**

Add a published generic business template:

```ts
genericContractWorkbench: {
  publishedAt: new Date("2026-06-01T00:00:00.000Z"),
  template: {
    id: "seed-template-generic-contract",
    code: "generic_contract",
    name: "通用合同模板",
    contractTypeKey: "generic_contract",
    status: "published"
  },
  version: {
    id: "seed-template-generic-contract-v1",
    versionNo: 1,
    status: "published",
    changeSummary: "初始化无专用模板合同的通用模板 v1"
  },
  fields: [
    { key: "businessSummary", label: "业务摘要", type: "long_text", required: true, group: "basic", order: 10 },
    { key: "settlementCycle", label: "结算周期", type: "text", required: true, defaultValue: "按双方确认结算", group: "settlement", order: 20 },
    { key: "paymentRatioPercent", label: "付款比例(%)", type: "number", required: true, defaultValue: 80, group: "payment", order: 30 }
  ],
  bills: [
    {
      key: "genericItems",
      name: "合同清单",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      quantityScale: 3,
      unitPriceScale: 4,
      columns: [
        { key: "itemName", label: "项目名称", type: "text", required: true },
        { key: "specification", label: "规格/说明", type: "text" },
        { key: "unit", label: "单位", type: "text", required: true },
        { key: "quantity", label: "数量", type: "number", required: true },
        { key: "unitPrice", label: "含税单价", type: "number", required: true },
        { key: "taxInclusiveAmount", label: "含税金额", type: "number", required: true },
        { key: "remark", label: "备注", type: "text" }
      ]
    }
  ],
  clauses: [
    {
      key: "payment",
      title: "付款及结算",
      numberingMode: "automatic",
      required: true,
      content: { text: "甲方依据双方确认的结算资料和合规发票付款，具体比例、周期及条件以本合同约定为准。" }
    },
    {
      key: "specialAgreement",
      title: "特别约定",
      numberingMode: "automatic",
      required: false,
      content: { text: "" }
    }
  ],
  attachments: [],
  validations: [],
  layout: {
    id: "seed-layout-generic-contract",
    name: "通用合同 Word 版式",
    versionId: "seed-layout-generic-contract-v1",
    versionNo: 1,
    status: "published",
    docxFile: {
      id: "seed-file-layout-generic-contract-v1-docx",
      bucket: "private-local",
      objectKey: "seed/templates/generic-contract-v1.docx",
      originalName: "generic-contract-v1.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    previewPdfFile: {
      id: "seed-file-layout-generic-contract-v1-preview-pdf",
      bucket: "private-local",
      objectKey: "seed/templates/generic-contract-v1-preview.pdf",
      originalName: "generic-contract-v1-preview.pdf",
      mimeType: "application/pdf"
    },
    previewJob: {
      id: "seed-layout-preview-generic-contract-v1",
      status: "succeeded",
      completedAt: new Date("2026-06-01T00:05:00.000Z"),
      sampleData: {
        contract: { name: "通用合同样张", temporaryCode: "TMP-GEN-001", amountUppercase: "人民币壹万元整" },
        field: { businessSummary: "双方约定的业务内容", settlementCycle: "按月结算", paymentRatioPercent: 80 },
        clause: { payment: { text: "甲方依据双方确认的结算资料和合规发票付款。" }, specialAgreement: { text: "" } },
        bill: { genericItems: [{ itemName: "服务项目", specification: "按现场要求", unit: "项", quantity: "1.000", unitPrice: "10000.0000", taxInclusiveAmount: "10000.00" }] }
      }
    },
    inspectionReport: {
      placeholders: [
        "bill.genericItems",
        "clause.payment.text",
        "clause.specialAgreement.text",
        "contract.amountUppercase",
        "contract.name",
        "contract.temporaryCode",
        "document.watermark",
        "field.businessSummary",
        "field.paymentRatioPercent",
        "field.settlementCycle"
      ],
      unknownPlaceholders: [],
      missingRequiredPlaceholders: [],
      hasBillLoop: true,
      blockingErrors: [],
      warnings: []
    }
  },
  numberingRule: {
    id: "seed-contract-number-rule-generic-contract",
    name: "通用合同编号规则",
    pattern: "HT-{project}-{year}-{type}-{sequence}",
    contractTypeKey: "generic_contract",
    nextSequence: 1,
    sequenceWidth: 3,
    isActive: true
  }
}
```

- [ ] **Step 4: Update seed loops to include all four workbench templates**

In `services/api/prisma/seed.cjs`, ensure the array of workbench seed templates includes:

```js
const contractWorkbenchSeeds = [
  data.materialPurchaseWorkbench,
  data.equipmentRentalWorkbench,
  data.laborSubcontractWorkbench,
  data.genericContractWorkbench
];
```

Use this same list for business template upserts, layout template upserts, preview jobs, numbering rules, and asset copying.

- [ ] **Step 5: Update live verification template expectations**

In `services/api/prisma/verify-contract-workbench.cjs`, require all four keys:

```js
const requiredContractTypes = [
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "generic_contract"
];
```

The live script should still create a material purchase draft as its primary path. Add a lightweight check that `GET /contract-templates?contractTypeKey=generic_contract` returns one published template version.

- [ ] **Step 6: Run seed and targeted tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- core-flow-seed-data.spec.ts contract-workbench-verification.spec.ts contract-template-docx-assets.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api seed
```

Expected: tests pass and seed can be rerun idempotently.

- [ ] **Step 7: Commit real-template seed update**

Run:

```bash
git add services/api/src/database services/api/prisma/seed.cjs services/api/prisma/verify-contract-workbench.cjs
git commit -m "feat(api): seed real and generic contract templates"
```

---

### Task 4: Add Simple Offline Word Revision Upload Persistence

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/<timestamp>_contract_offline_revisions/migration.sql`
- Modify: `services/api/src/contract-document/contract-document.service.ts`
- Modify: `services/api/src/contract-document/contract-document.controller.ts`
- Modify: `services/api/src/contract-document/contract-document.service.spec.ts`

- [ ] **Step 1: Add failing service tests**

Add tests in `contract-document.service.spec.ts` covering:

- owner contract staff can upload a manual revision against an editable draft version
- non-owner cannot upload a manual revision
- uploaded file must be downloadable by the actor through `FileService.assertCanDownloadFile`
- non-editable contract versions reject upload
- list returns newest manual revisions first
- audit action is `contract.document.offline_revision.confirm`

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-document.service.spec.ts
```

Expected: FAIL because no model/service methods exist yet.

- [ ] **Step 2: Add Prisma model**

Add to `services/api/prisma/schema.prisma`:

```prisma
model ContractOfflineRevision {
  id                        String   @id @default(uuid())
  contractVersionId         String
  sourceGeneratedDocumentId String?
  fileId                    String
  label                     String
  note                      String?
  confirmedByUserId         String
  confirmedAt               DateTime @default(now())
  createdAt                 DateTime @default(now())

  @@index([contractVersionId, createdAt])
  @@index([fileId])
}
```

Create the migration SQL:

```sql
CREATE TABLE "ContractOfflineRevision" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "sourceGeneratedDocumentId" TEXT,
    "fileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractOfflineRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractOfflineRevision_contractVersionId_createdAt_idx" ON "ContractOfflineRevision"("contractVersionId", "createdAt");
CREATE INDEX "ContractOfflineRevision_fileId_idx" ON "ContractOfflineRevision"("fileId");
```

- [ ] **Step 3: Add service input types and parser**

In `contract-document.service.ts`, add:

```ts
export interface UploadOfflineRevisionInput {
  fileId: string;
  sourceGeneratedDocumentId?: string;
  label?: string;
  note?: string;
  confirmationStatementAccepted: boolean;
}
```

Parser rules:

- `fileId` is required and non-empty.
- `sourceGeneratedDocumentId` is optional and non-empty when present.
- `label` defaults to `线下修订稿`.
- `note` defaults to `null`.
- `confirmationStatementAccepted` must be `true`; otherwise throw `BadRequestException("Offline revision confirmation is required")`.

- [ ] **Step 4: Implement `uploadOfflineRevision`**

Add service method:

```ts
async uploadOfflineRevision(
  contractVersionId: string,
  actorUserId: string,
  rawInput: UploadOfflineRevisionInput
) {
  const input = this.parseOfflineRevisionInput(rawInput);
  return this.prisma.$transaction(async (tx) => {
    const { version } = await this.loadOwnedVersion(tx, contractVersionId, actorUserId);
    if (!EDITABLE_VERSION_STATUSES.includes(version.status)) {
      throw new BadRequestException("Contract version is not editable");
    }
    await this.files.assertCanDownloadFile(tx, input.fileId, actorUserId);
    if (input.sourceGeneratedDocumentId) {
      const source = await tx.contractGeneratedDocument.findUnique({
        where: { id: input.sourceGeneratedDocumentId }
      });
      if (!source || source.contractVersionId !== version.id) {
        throw new BadRequestException("Source generated document does not belong to this contract version");
      }
    }
    const revision = await tx.contractOfflineRevision.create({
      data: {
        contractVersionId: version.id,
        sourceGeneratedDocumentId: input.sourceGeneratedDocumentId ?? null,
        fileId: input.fileId,
        label: input.label,
        note: input.note,
        confirmedByUserId: actorUserId
      }
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "contract.document.offline_revision.confirm",
      businessType: "contract_offline_revision",
      businessId: revision.id,
      metadata: {
        contractVersionId: version.id,
        fileId: input.fileId,
        sourceGeneratedDocumentId: input.sourceGeneratedDocumentId ?? null
      }
    });
    return revision;
  });
}
```

- [ ] **Step 5: Implement `listOfflineRevisions`**

Add:

```ts
async listOfflineRevisions(contractVersionId: string, actorUserId: string) {
  return this.prisma.$transaction(async (tx) => {
    const { version } = await this.loadOwnedVersion(tx, contractVersionId, actorUserId);
    return tx.contractOfflineRevision.findMany({
      where: { contractVersionId: version.id },
      orderBy: { createdAt: "desc" }
    });
  });
}
```

- [ ] **Step 6: Add controller endpoints**

In `contract-document.controller.ts`:

```ts
@Post("contract-workbench/:contractVersionId/offline-revisions")
uploadOfflineRevision(
  @Param("contractVersionId") contractVersionId: string,
  @CurrentUser() user: AuthenticatedUser,
  @Body() body: UploadOfflineRevisionInput
) {
  return this.documents.uploadOfflineRevision(contractVersionId, user.id, body);
}

@Get("contract-workbench/:contractVersionId/offline-revisions")
listOfflineRevisions(
  @Param("contractVersionId") contractVersionId: string,
  @CurrentUser() user: AuthenticatedUser
) {
  return this.documents.listOfflineRevisions(contractVersionId, user.id);
}
```

- [ ] **Step 7: Run Prisma generate and tests**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api exec prisma generate
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-document.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
```

Expected: service tests and typecheck pass.

- [ ] **Step 8: Commit offline revision API**

Run:

```bash
git add services/api/prisma services/api/src/contract-document
git commit -m "feat(api): add offline contract revision upload"
```

---

### Task 5: Add Simple Offline Revision UI In Document Section

**Files:**
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue`

- [ ] **Step 1: Add failing API wrapper tests**

In `contract-workbench.api.test.ts`, assert:

- `listContractOfflineRevisions(versionId)` calls `GET /contract-workbench/:versionId/offline-revisions`
- `uploadContractOfflineRevision(versionId, body)` calls `POST /contract-workbench/:versionId/offline-revisions`

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts
```

Expected: FAIL until wrappers exist.

- [ ] **Step 2: Add API wrappers**

In `contract-workbench.api.ts`:

```ts
export interface UploadContractOfflineRevisionInput {
  fileId: string;
  sourceGeneratedDocumentId?: string;
  label?: string;
  note?: string;
  confirmationStatementAccepted: boolean;
}

export function listContractOfflineRevisions(contractVersionId: string) {
  return readJson<unknown[]>(`/contract-workbench/${contractVersionId}/offline-revisions`);
}

export function uploadContractOfflineRevision(
  contractVersionId: string,
  body: UploadContractOfflineRevisionInput
) {
  return postJson<unknown>(
    `/contract-workbench/${contractVersionId}/offline-revisions`,
    body
  );
}
```

- [ ] **Step 3: Update `ContractDocumentsSection.vue` UI**

Add a compact section below generated documents:

- file upload input using existing private upload helper
- revision label input defaulting to `线下修订稿`
- note textarea
- confirmation checkbox with text: `我确认该文件为线下修改后的合同稿件，系统不自动解析其中内容`
- submit button disabled until a file is selected and confirmation checked
- list of uploaded revisions with label, file id/original name if available, confirmed time, and note

Do not add a diff viewer. Do not overwrite generated structured fields.

- [ ] **Step 4: Add a focused component/config test if current test setup supports it**

Test expected behavior through pure helpers if the component is too large:

- confirmation unchecked disables submit
- upload body includes `confirmationStatementAccepted: true`
- refresh loads both generated docs and offline revisions

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
```

- [ ] **Step 5: Commit offline revision UI**

Run:

```bash
git add apps/web-admin/src/api/contract-workbench.api.ts apps/web-admin/src/api/contract-workbench.api.test.ts apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue
git commit -m "feat(web): add offline contract revision upload"
```

---

### Task 6: Verify Word Generation With Real And Generic Templates

**Files:**
- Modify: `services/api/prisma/verify-contract-workbench.cjs`
- Modify: `services/api/src/database/contract-workbench-verification.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Extend static verification**

Update `contract-workbench-verification.spec.ts` so the live script source must mention:

- `material_purchase`
- `equipment_rental`
- `labor_subcontract`
- `generic_contract`
- `offline-revisions`
- `material-purchase-real-v1.docx`
- `equipment-rental-real-v1.docx`
- `labor-subcontract-real-v1.docx`
- `generic-contract-v1.docx`

- [ ] **Step 2: Extend live script checks without making it slow**

In `verify-contract-workbench.cjs`:

- Keep the current full material purchase happy path.
- Add published template checks for equipment, labor, and generic.
- For generic, create a draft only if the existing script helper can do so without duplicating the whole flow.
- Queue a draft DOCX for the generated generic draft and poll until `success`.
- Upload a small generated DOCX or existing file object as a manual offline revision only in a local test-safe way.

If uploading a real file through HTTP is not already available in the script, skip the upload in live verification and keep offline revision coverage in service/API tests.

- [ ] **Step 3: Run full targeted verification**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api test -- contract-workbench-verification.spec.ts contract-template-docx-assets.spec.ts contract-document.service.spec.ts
node scripts/pnpm-workspace.mjs --filter @jiangkong/api seed
DOC_CONVERTER_COMMAND=/Applications/LibreOffice.app/Contents/MacOS/soffice node scripts/pnpm-workspace.mjs --filter @jiangkong/api verify:contract-workbench
```

Expected:

- tests pass
- seed passes
- live verify passes
- generated DOCX/PDF exists for at least material purchase and one generic draft

- [ ] **Step 4: Run package quality gates**

Run:

```bash
node scripts/pnpm-workspace.mjs --filter @jiangkong/api typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/api lint
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin test
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin typecheck
node scripts/pnpm-workspace.mjs --filter @jiangkong/web-admin lint
```

Expected: all pass.

- [ ] **Step 5: Manually spot-check generated Word files**

Open generated DOCX files for:

- material purchase
- equipment rental
- labor subcontract
- generic contract

Check:

- page margins are close to the source Word files
- visible header/footer survive rendering
- table borders and widths survive rendering
- signature area remains on the expected page
- no placeholder text remains except intentionally blank optional fields
- labor output includes main contract, safety agreement, wage commitment, and labor bill only

Record manual findings in `PROGRESS.md`.

- [ ] **Step 6: Commit verification and progress**

Run:

```bash
git add services/api/prisma/verify-contract-workbench.cjs services/api/src/database/contract-workbench-verification.spec.ts PROGRESS.md
git commit -m "test(api): verify real contract word generation"
```

---

## Final Acceptance Criteria

- The template list API returns published templates for `material_purchase`, `equipment_rental`, `labor_subcontract`, and `generic_contract`.
- Material purchase, equipment rental, and labor subcontract render from high-fidelity DOCX assets derived from the user's real Word files.
- The generic contract template can generate a Word first draft for contract types that do not yet have dedicated templates.
- Generated DOCX files preserve the original template shell as much as practical: margins, table styling, header/footer, page breaks, and signature areas are manually spot-checked.
- Labor subcontract output scope is limited to main contract, safety agreement, migrant worker wage commitment, and labor bill.
- Contract staff/director can upload a manually revised Word file and confirm it as an offline revision.
- Offline revisions do not overwrite structured contract fields, bill rows, or clauses.
- API and Web targeted tests pass.
- `PROGRESS.md` is updated.

## Self-Review Notes

- Spec coverage: all user-confirmed requirements are mapped to tasks above.
- YAGNI check: arbitrary contract type registry, DOCX diffing, OCR, Word reverse parsing, and risk prompts are intentionally excluded.
- Historical-file safety: new dedicated templates only affect future generated drafts; old generated documents and approved archives remain stored file records.
- Main technical risk: high-fidelity placeholder insertion is partly manual Word work. The automated tests catch placeholder/header/footer presence but cannot prove exact pagination, so Task 6 includes manual Word spot checks.
