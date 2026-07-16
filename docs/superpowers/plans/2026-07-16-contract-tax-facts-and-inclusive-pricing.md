# 合同税务事实与含税计价治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改写既有合同、结算、付款历史金额事实的前提下，把发票类型、税率、含税单价、两位小数精度、历史补录复核和结算提交门槛落成后端领域事实，并提供可保存的结算草稿。

**Architecture:** `ContractVersion` 保存当前版本级税务事实，`ContractBillRow` 保存可为空的历史价格事实和精度来源，`ContractTaxFactRevision` 保存历史补录/更正的不可覆盖复核账本；新合同在既有合同审批中冻结税务事实，历史合同按“合同员录入 → 财务主管复核 → 合同部主管确认”生效。结算草稿使用独立 `SettlementDraft` 表保存原始输入，提交时复用既有结算事务，重新校验合同版本、税务事实、金额、额度和审批实例。

**Tech Stack:** Vue 3、TypeScript、TDesign Vue Next、Vite、NestJS、Prisma 5、PostgreSQL 16、Jest、Vitest、Playwright、ExcelJS、现有 DOCX/PDF 生成链路。

---

## 0. 执行边界、当前基线与成功标准

本计划依据已批准规格：

- `docs/superpowers/specs/2026-07-16-contract-tax-facts-and-pricing-design.md`

计划编写时事实：

- 当前分支：`codex/production-backup-alerts`
- 当前 HEAD：`a004ba7d98c73b95781684661ea47c974234ff69`
- `origin/main`：`48b5ec3fc91efd9f73cfa7a5eb6d4cde48e6c096`
- 生产 Web/API 运行代码：`b857a4269aa907e0550470cece52c846bcbb7623`
- 生产数据库：51 个已完成迁移，0 个未完成迁移。
- 当前工作区在计划编写前洁净。
- `a004ba7d` 相对 `origin/main` 只领先生产备份监控文档和本规格文档。
- 当前只授权编写实施计划；不授权修改业务代码、推送、部署、生产迁移或生产业务写入。

实施必须从 `a004ba7d` 创建独立分支 `codex/contract-tax-facts-pricing`，不得直接在当前备份监控分支继续堆叠业务代码。

### 成功标准

1. 新合同不依赖模板偶然配置，也必须在提交审批前具备：
   - 增值税普通发票或增值税专用发票；
   - 大于 0、不超过 100、最多 3 位小数的税率；
   - 有清单时每个计价行具备含税单价；
   - 新录入数量与含税单价最多 2 位小数。
2. 单一税率合同的清单行继承版本税率；特殊多税率只允许例外行覆盖。
3. 有总价清单的合同金额严格来自真实计价行合计；纯固定总价且无清单时继续允许手工含税总价。
4. 无总价框架合同可不填预计数量，页面显示“按实际发生量结算”，不得显示伪造的 `0`。
5. 历史合同缺票种、税率或单价仍可接管；未知值保持 `null/未明确`，不自动推断。
6. 历史补录只有财务主管复核、合同部主管确认后才更新当前合同版本事实。
7. 结算税务资料缺失时可保存草稿，但不得提交审批；单项缺价只阻断包含该项的结算。
8. 已提交结算保存票种、税率、含税单价、合同版本和税务事实修订号快照。
9. 既有 `manual_adjustment` 是结算域的合法例外，本计划不删除、不改名、不改变其金额逻辑；“禁止调差行”只约束合同计价清单。
10. 既有 `/settlements`、合同/结算/付款路由、审批路线、权限范围、上传 API 和元分转换保持兼容。

## 1. 关键架构决策

### 1.1 规范代码值

数据库和 API 使用稳定代码，中文只用于展示：

```ts
export const CONTRACT_INVOICE_TYPES = ["vat_general", "vat_special"] as const;
export type ContractInvoiceType = (typeof CONTRACT_INVOICE_TYPES)[number];

export const CONTRACT_TAX_MODES = ["single_rate", "multiple_rate"] as const;
export type ContractTaxMode = (typeof CONTRACT_TAX_MODES)[number];

export const CONTRACT_TAX_FACT_STATUSES = [
  "unconfirmed",
  "draft",
  "frozen",
  "pending_finance_review",
  "pending_contract_confirmation",
  "confirmed"
] as const;

export const CONTRACT_TAX_FACT_SOURCES = [
  "contract_document",
  "supplement_evidence",
  "business_finance_confirmation"
] as const;
```

`frozen` 是新合同进入内部审批后的内部状态；它不会被展示成“历史补录已确认”。新合同归档生效时转为 `confirmed`；审批退回后恢复 `draft`，此前提交快照仍保留在既有 `submissionSnapshot` 和审计日志中。

### 1.2 历史精度不追溯改写

既有行可能包含超过 2 位小数的数据。迁移不得舍入、截断或重算这些行。

`ContractBillRow.precisionPolicy`：

- 迁移前既有行：`legacy`
- 功能上线后新增行：`two_decimal`
- 复制到合同变更版本的既有行继续保留 `legacy`
- 一旦用户修改旧行的数量或含税单价，新值必须满足 2 位小数，并切换为 `two_decimal`

### 1.3 未知价格使用空值，不使用 0

为表达历史合同未知事实，以下字段放宽为可空：

- `ContractBillRow.quantity`
- `ContractBillRow.unitPrice`
- `ContractBillRow.taxRate`
- 三个行金额字段

正常新合同仍由服务层和提交就绪检查强制非空。`0` 含税单价仍可表示经确认的真实零价项目，但必须有 `pricingFactStatus = confirmed`，与 `null` 未知值严格区分。

### 1.4 不改变已存在的结算提交接口

- 保留 `POST /settlements` 的现有“一步创建并进入审批”语义。
- 新增项目范围内的结算草稿接口。
- 两条提交路径都调用同一个后端 `SettlementSubmissionService`。
- Web 工作台切换为“保存草稿 → 提交审批”两步。
- 旧调用方继续可用，但同样会受到新的税务事实硬门槛约束。

### 1.5 无总价框架合同的金额语义

`ContractVersion.amountCents` 暂不改为可空，避免大面积破坏合同、付款和额度代码：

- `amountLimitType = unlimited`
- `pricingNature = framework`
- `amountCents = 0`

三者共同表达“不设合同总价”；所有读模型必须显示“不设合同总价”，不能显示 `¥0.00`。框架合同预计数量和预计金额只存在于清单参考信息，不参与合同上限、结算上限和付款上限。

## 2. 文件责任图

### 新增文件

- `packages/shared-domain/src/contract-tax-facts.ts`
- `packages/shared-domain/src/contract-tax-facts.test.ts`
- `services/api/prisma/migrations/20260716160000_contract_tax_facts_and_settlement_drafts/migration.sql`
- `services/api/src/database/contract-tax-facts-schema-verification.spec.ts`
- `services/api/src/contract-tax-facts/contract-tax-facts.module.ts`
- `services/api/src/contract-tax-facts/contract-tax-facts.service.ts`
- `services/api/src/contract-tax-facts/contract-tax-facts.service.spec.ts`
- `services/api/src/contract-tax-facts/dto/contract-tax-fact-revision.dto.ts`
- `services/api/src/settlement/settlement-submission.service.ts`
- `services/api/src/settlement/settlement-submission.service.spec.ts`
- `services/api/src/settlement/settlement-draft.controller.ts`
- `services/api/src/settlement/settlement-draft.service.ts`
- `services/api/src/settlement/settlement-draft.service.spec.ts`
- `services/api/src/settlement/dto/settlement-draft.dto.ts`
- `services/api/src/contract-takeover/contract-takeover-excel.service.ts`
- `services/api/src/contract-takeover/contract-takeover-excel.service.spec.ts`
- `services/api/scripts/inspect-contract-tax-facts-readiness.cjs`
- `services/api/src/database/contract-tax-facts-readiness-script.spec.ts`
- `apps/web-admin/src/pages/contracts/workbench/ContractTaxFactsSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/contract-tax-facts.state.ts`
- `apps/web-admin/src/pages/contracts/workbench/contract-tax-facts.state.test.ts`
- `apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue`
- `apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.ts`
- `apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.test.ts`
- `apps/web-admin/src/api/contract-tax-facts.api.ts`
- `apps/web-admin/src/api/contract-tax-facts.api.test.ts`
- `apps/web-admin/src/api/settlement-drafts.api.ts`
- `apps/web-admin/src/api/settlement-drafts.api.test.ts`
- `docs/progress/2026-07-16-contract-tax-facts-data-audit.md`
- `docs/progress/2026-07-16-contract-tax-facts-release-candidate.md`
- `docs/superpowers/runbooks/2026-07-16-contract-tax-facts-release.md`

### 主要修改文件

- `services/api/prisma/schema.prisma`
- `packages/shared-domain/src/index.ts`
- `packages/shared-domain/src/permissions.ts`
- `packages/shared-domain/src/permissions.test.ts`
- `packages/shared-domain/src/contract-workbench.ts`
- `packages/shared-domain/src/settlement-workbench.ts`
- `packages/shared-domain/src/core-flow-read-model.ts`
- `services/api/package.json`
- `services/api/src/app.module.ts`
- `services/api/src/auth/guards/permission.guard.spec.ts`
- `services/api/src/database/core-flow-seed-data.ts`
- `services/api/src/database/core-flow-seed-data.spec.ts`
- `services/api/src/money/decimal-money.ts`
- `services/api/src/money/decimal-money.spec.ts`
- `services/api/src/contract/dto/create-contract.dto.ts`
- `services/api/src/contract/contract.service.ts`
- `services/api/src/contract/contract.service.spec.ts`
- `services/api/src/contract/contract-read.service.ts`
- `services/api/src/contract/contract-read.service.spec.ts`
- `services/api/src/contract-workbench/dto/contract-workbench.dto.ts`
- `services/api/src/contract-workbench/contract-workbench.service.ts`
- `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- `services/api/src/contract-workbench/contract-readiness.service.ts`
- `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- `services/api/src/contract-bill/dto/contract-bill.dto.ts`
- `services/api/src/contract-bill/contract-bill.service.ts`
- `services/api/src/contract-bill/contract-bill.service.spec.ts`
- `services/api/src/contract-bill/contract-bill-totals.ts`
- `services/api/src/contract-bill/contract-bill-excel.service.ts`
- `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`
- `services/api/src/contract-document/contract-document.service.ts`
- `services/api/src/contract-document/contract-document.service.spec.ts`
- `services/api/src/contract-document/contract-placeholder-registry.ts`
- `services/api/src/contract-document/contract-docx-renderer.spec.ts`
- `services/api/src/contract-takeover/contract-takeover.controller.ts`
- `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- `services/api/src/contract-takeover/contract-takeover.service.ts`
- `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- `services/api/src/contract-takeover/dto/create-contract-takeover.dto.ts`
- `services/api/src/contract-takeover/dto/precheck-contract-takeover-import.dto.ts`
- `services/api/src/settlement/settlement.module.ts`
- `services/api/src/settlement/settlement.controller.ts`
- `services/api/src/settlement/settlement.controller.spec.ts`
- `services/api/src/settlement/settlement.service.ts`
- `services/api/src/settlement/settlement.service.spec.ts`
- `services/api/src/settlement/settlement-workbench.service.ts`
- `services/api/src/settlement/settlement-workbench.service.spec.ts`
- `services/api/src/settlement/settlement-line-calculator.ts`
- `services/api/src/settlement/settlement-line-calculator.spec.ts`
- `services/api/src/settlement/settlement-quantity.ts`
- `services/api/src/settlement/settlement-quantity.spec.ts`
- `services/api/src/settlement/settlement-read.service.ts`
- `services/api/src/settlement/settlement-read.service.spec.ts`
- `services/api/src/settlement/settlement-document-renderer.ts`
- `services/api/src/settlement/settlement-document-renderer.spec.ts`
- `apps/web-admin/src/api/contract-workbench.api.ts`
- `apps/web-admin/src/api/contract-workbench.api.test.ts`
- `apps/web-admin/src/api/core-flow-read.api.ts`
- `apps/web-admin/src/api/core-flow-read.api.test.ts`
- `apps/web-admin/src/api/settlement-workbench.api.ts`
- `apps/web-admin/src/api/settlement-workbench.api.test.ts`
- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- `apps/web-admin/src/pages/contracts/workbench/ContractProfessionalFieldsSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractPricingSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue`
- `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts`
- `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.test.ts`
- `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- `apps/web-admin/src/pages/settlements/SettlementListPage.vue`
- `apps/web-admin/src/pages/settlements/settlement-workbench.state.ts`
- `apps/web-admin/src/pages/settlements/settlement-workbench.state.test.ts`
- `apps/web-admin/src/pages/settlements/settlement-workbench.structure.test.ts`
- `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- `apps/web-admin/e2e/contract-workbench-canvas.e2e.ts`
- `apps/web-admin/e2e/contract-takeover-responsive.e2e.ts`
- `apps/web-admin/e2e/settlement-workbench.e2e.ts`
- `apps/web-admin/e2e/ui-p1-contract-visual.e2e.ts`
- `apps/web-admin/e2e/ui-p1-settlement-visual.e2e.ts`
- `PROGRESS.md`

不得修改：

- 现有审批路线定义和冻结节点顺序。
- `apps/web-admin/src/routes/route-records.ts` 的路由地址。
- 付款额度、实付、入账和元分转换规则。
- 现有文件上传 API、文件类型、大小、私有桶和下载权限。
- 生产 CAM、COS、数据库备份和告警配置。

## Task 1：先建立生产数据只读审计和迁移分组

**Files:**

- Create: `services/api/scripts/inspect-contract-tax-facts-readiness.cjs`
- Create: `services/api/src/database/contract-tax-facts-readiness-script.spec.ts`
- Modify: `services/api/package.json`
- Create: `docs/progress/2026-07-16-contract-tax-facts-data-audit.md`

- [ ] **Step 1：先写会失败的脚本结构测试**

测试必须断言脚本：

```ts
expect(script).toContain('process.argv.includes("--json")');
expect(script).toContain('"historical_takeover"');
expect(script).toContain('decimalPlaces');
expect(script).toContain('draftData');
expect(script).not.toContain('UPDATE ');
expect(script).not.toContain('DELETE ');
expect(script).not.toContain('INSERT ');
```

- [ ] **Step 2：运行定向测试确认失败**

Run:

```bash
pnpm --filter @jiangkong/api test -- contract-tax-facts-readiness-script.spec.ts --runInBand
```

Expected: FAIL，提示审计脚本不存在。

- [ ] **Step 3：实现只读审计脚本**

脚本只使用 Prisma `findMany/count/groupBy`，输出以下聚合，不打印合同名称、相对方、文件名或用户信息：

```ts
type ContractTaxFactsReadinessReport = {
  generatedAt: string;
  contractVersions: {
    total: number;
    historicalTakeover: number;
    systemCreated: number;
    provableInvoiceAndRate: number;
    unconfirmed: number;
  };
  billRows: {
    total: number;
    taxRateNotPositive: number;
    quantityOverTwoDecimals: number;
    unitPriceOverTwoDecimals: number;
  };
  templates: {
    published: number;
    quantityScaleOverTwo: number;
    containsZeroTaxOption: number;
  };
  settlements: {
    draft: number;
    active: number;
    completed: number;
  };
  migrationGroups: {
    systemFactsCanBackfill: number;
    mustRemainUnconfirmed: number;
    legacyPrecisionRows: number;
  };
};
```

新增脚本：

```json
"inspect:contract-tax-facts": "node scripts/inspect-contract-tax-facts-readiness.cjs"
```

- [ ] **Step 4：本地运行并验证零写**

Run:

```bash
pnpm --filter @jiangkong/api inspect:contract-tax-facts -- --json
git diff --check
```

Expected: 输出合法 JSON；脚本不包含写 SQL，不修改数据库。

- [ ] **Step 5：实施开始后，以生产只读凭据执行并记录**

生产审计必须在 `default_transaction_read_only=on` 会话中执行，将聚合结果写入：

`docs/progress/2026-07-16-contract-tax-facts-data-audit.md`

文档必须包含：

- 执行时间、生产应用 SHA、迁移数量；
- 各分组数量；
- 哪些记录可从结构化字段证明并安全回填；
- 哪些必须保持未确认；
- 超过两位小数的既有行数量；
- 迁移前备份和隔离恢复演练要求。

- [ ] **Step 6：提交**

```bash
git add services/api/scripts/inspect-contract-tax-facts-readiness.cjs \
  services/api/src/database/contract-tax-facts-readiness-script.spec.ts \
  services/api/package.json \
  docs/progress/2026-07-16-contract-tax-facts-data-audit.md
git commit -m "test: 增加合同税务事实迁移只读审计"
```

## Task 2：建立共享税务事实类型、中文标签和精确权限

**Files:**

- Create: `packages/shared-domain/src/contract-tax-facts.ts`
- Create: `packages/shared-domain/src/contract-tax-facts.test.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`

- [ ] **Step 1：先写类型和权限失败测试**

覆盖：

```ts
expect(contractInvoiceTypeLabel("vat_general")).toBe("增值税普通发票");
expect(contractInvoiceTypeLabel("vat_special")).toBe("增值税专用发票");
expect(normalizeTaxRatePercent("13")).toBe("13");
expect(normalizeTaxRatePercent("6.5")).toBe("6.5");
expect(() => normalizeTaxRatePercent("0")).toThrow("税率必须大于 0");
expect(() => normalizeTaxRatePercent("13.0001")).toThrow("税率最多保留 3 位小数");

expect(canPerform("contract.tax_fact.supplement", ["contract_staff"])).toBe(true);
expect(canPerform("contract.tax_fact.finance_review", ["finance_director"])).toBe(true);
expect(canPerform("contract.tax_fact.confirm", ["contract_director"])).toBe(true);
expect(canPerform("contract.tax_fact.finance_review", ["contract_staff"])).toBe(false);
expect(canPerform("contract.tax_fact.confirm", ["super_admin"])).toBe(false);
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-tax-facts.test.ts permissions.test.ts
```

- [ ] **Step 3：实现纯字符串税率规范化**

禁止 `Number()` 参与税率精度判断。使用正则和字符串去尾零：

```ts
const TAX_RATE_TEXT = /^(?:0|[1-9]\d{0,2})(?:\.(\d{1,3}))?$/;

export function normalizeTaxRatePercent(value: string): string {
  const text = value.trim();
  const decimalPart = text.includes(".") ? text.split(".")[1] : "";
  if (decimalPart.length > 3) {
    throw new Error("税率最多保留 3 位小数");
  }
  const match = TAX_RATE_TEXT.exec(text);
  if (!match) throw new Error("税率必须是 0 到 100 之间且最多 3 位小数的数字");
  const [whole] = text.split(".");
  if (whole === "0" && !/[1-9]/.test(match[1] ?? "")) {
    throw new Error("税率必须大于 0");
  }
  if (BigInt(whole) > 100n || (whole === "100" && /[1-9]/.test(match[1] ?? ""))) {
    throw new Error("税率不能超过 100");
  }
  return text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}
```

- [ ] **Step 4：加入三项独立业务权限**

```ts
"contract.tax_fact.supplement": ["contract_staff"],
"contract.tax_fact.finance_review": ["finance_director"],
"contract.tax_fact.confirm": ["contract_director"],
```

不得把 `super_admin` 加入业务权限，不得复用过宽的 `settlement.approve`。

- [ ] **Step 5：运行共享包验证并提交**

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/shared-domain typecheck
git add packages/shared-domain
git commit -m "feat: 定义合同税务事实领域类型"
```

## Task 3：增加可兼容回滚的数据库结构

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716160000_contract_tax_facts_and_settlement_drafts/migration.sql`
- Create: `services/api/src/database/contract-tax-facts-schema-verification.spec.ts`

- [ ] **Step 1：先写迁移静态测试**

测试必须锁定：

```ts
expect(sql).toContain('ADD COLUMN "invoiceType" TEXT');
expect(sql).toContain('ADD COLUMN "taxFactStatus" TEXT NOT NULL DEFAULT');
expect(sql).toContain('ALTER COLUMN "unitPrice" DROP NOT NULL');
expect(sql).toContain('CREATE TABLE "ContractTaxFactRevision"');
expect(sql).toContain('CREATE TABLE "SettlementDraft"');
expect(sql).toContain('"invoiceTypeSnapshot"');
expect(sql).toContain('"taxExclusiveAmountCents"');
expect(sql).toContain("BEGIN;");
expect(sql).toContain("COMMIT;");
expect(sql).not.toMatch(/UPDATE[\s\S]+\"historical_takeover\"[\s\S]+\"confirmed\"/u);
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @jiangkong/api test -- contract-tax-facts-schema-verification.spec.ts --runInBand
```

- [ ] **Step 3：更新 Prisma 模型**

`ContractVersion` 新增：

```prisma
invoiceType                 String?
taxMode                     String    @default("single_rate")
defaultTaxRatePercent       Decimal?  @db.Decimal(9, 6)
taxFactStatus               String    @default("unconfirmed")
taxFactSource               String?
taxFactExplanation          String?
taxFactEvidenceFileId       String?
taxFactRevision             Int       @default(0)
taxFactsFrozenAt            DateTime?
```

`ContractBillRow` 调整：

```prisma
quantity                    Decimal?  @db.Decimal(24, 6)
unitPrice                   Decimal?  @db.Decimal(24, 6)
taxRate                     Decimal?  @db.Decimal(9, 6)
taxRateSource               String    @default("version_default")
pricingFactStatus           String    @default("unconfirmed")
precisionPolicy             String    @default("two_decimal")
taxInclusiveAmountCents     BigInt?
taxExclusiveAmountCents     BigInt?
taxAmountCents              BigInt?
```

新增历史复核账本：

```prisma
model ContractTaxFactRevision {
  id                       String   @id @default(uuid())
  projectId                String
  contractId               String
  contractVersionId        String
  revisionNo               Int
  kind                     String
  status                   String   @default("draft")
  invoiceType              String?
  taxMode                  String?
  defaultTaxRatePercent    Decimal? @db.Decimal(9, 6)
  source                   String?
  confirmationExplanation String?
  evidenceFileId           String?
  rowFacts                 Json
  beforeSnapshot           Json
  createdByUserId          String
  submittedByUserId        String?
  submittedAt              DateTime?
  financeReviewedByUserId  String?
  financeReviewedAt        DateTime?
  financeReviewComment     String?
  confirmedByUserId        String?
  confirmedAt              DateTime?
  contractReviewComment    String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([contractVersionId, revisionNo])
  @@index([projectId, status])
  @@index([contractVersionId, status])
}
```

新增结算草稿：

```prisma
model SettlementDraft {
  id                           String   @id @default(uuid())
  projectId                    String
  contractId                   String
  contractVersionId            String
  paymentTermsVersionId        String
  settlementTemplateVersionId  String?
  code                         String
  periodLabel                  String
  isFinal                      Boolean  @default(false)
  finalCumulativeAmountCents   BigInt?
  lines                        Json
  revision                     Int      @default(1)
  status                       String   @default("draft")
  ownerUserId                  String
  submittedSettlementId        String?  @unique
  submittedAt                  DateTime?
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @updatedAt

  @@index([projectId, ownerUserId, status, updatedAt])
  @@index([contractVersionId, status])
}
```

`Settlement` 新增：

```prisma
invoiceTypeSnapshot       String?
taxFactRevisionSnapshot   Int?
```

`SettlementLine` 新增：

```prisma
taxExclusiveAmountCents BigInt?
taxAmountCents          BigInt?
```

- [ ] **Step 4：实现迁移的保守回填**

迁移规则：

1. 现有 `ContractBillRow.precisionPolicy = legacy`。
2. 现有行仅在 `unitPrice IS NOT NULL AND taxRate > 0` 时标记为 `confirmed`；`taxRate = 0` 不能被视为已确认。
3. 只对非 `historical_takeover` 合同版本，从以下两处读取可证明的字段：
   - `draftData #>> '{fieldValues,invoiceType}'`
   - `draftData ->> 'invoiceType'`
   - `draftData #>> '{fieldValues,taxRatePercent}'`
   - `draftData ->> 'taxRatePercent'`
4. 票种必须精确等于“增值税普通发票”或“增值税专用发票”，税率必须满足 `> 0 AND <= 100`，才能回填。
5. 已生效的系统合同回填 `confirmed`；草稿/退回合同回填 `draft`；其他处理中合同回填 `frozen`。
6. 历史接管一律保持 `unconfirmed`，即使旧 JSON 中存在类似文字也不自动确认。
7. 迁移不更新任何既有金额、数量、单价或税额。

- [ ] **Step 5：增加数据库 CHECK 约束**

使用 `NOT VALID`，先约束新写入：

```sql
CHECK ("invoiceType" IS NULL OR "invoiceType" IN ('vat_general', 'vat_special'))
CHECK ("taxMode" IN ('single_rate', 'multiple_rate'))
CHECK ("taxFactStatus" IN (
  'unconfirmed', 'draft', 'frozen',
  'pending_finance_review', 'pending_contract_confirmation', 'confirmed'
))
CHECK ("defaultTaxRatePercent" IS NULL OR (
  "defaultTaxRatePercent" > 0 AND "defaultTaxRatePercent" <= 100
))
```

复核账本和结算草稿状态也增加有限集合约束。

- [ ] **Step 6：生成客户端并验证**

```bash
pnpm --filter @jiangkong/api prisma generate
pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api test -- contract-tax-facts-schema-verification.spec.ts --runInBand
git diff --check
```

- [ ] **Step 7：提交**

```bash
git add services/api/prisma services/api/src/database/contract-tax-facts-schema-verification.spec.ts
git commit -m "feat: 增加合同税务事实与结算草稿结构"
```

## Task 4：固化金额、税额和不含税单价计算

**Files:**

- Modify: `services/api/src/money/decimal-money.ts`
- Modify: `services/api/src/money/decimal-money.spec.ts`

- [ ] **Step 1：先写计算失败测试**

```ts
expect(calculateBillRow({
  quantity: "1.23",
  unitPrice: "4.56",
  taxRatePercent: "13",
  pricingMode: "tax_inclusive"
})).toEqual({
  taxInclusiveAmountCents: 561n,
  taxExclusiveAmountCents: 496n,
  taxAmountCents: 65n
});

expect(deriveTaxExclusiveUnitPrice({
  taxInclusiveUnitPrice: "4.56",
  taxRatePercent: "13"
})).toBe("4.04");
```

增加多行逐行舍入后汇总测试，证明不是先汇总高精度金额再舍入。

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @jiangkong/api test -- decimal-money.spec.ts --runInBand
```

- [ ] **Step 3：增加只读派生函数**

```ts
export function deriveTaxExclusiveUnitPrice(input: {
  taxInclusiveUnitPrice: string;
  taxRatePercent: string;
}): string {
  return new Prisma.Decimal(input.taxInclusiveUnitPrice)
    .div(new Prisma.Decimal(input.taxRatePercent).div(100).add(1))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
```

`calculateBillRow` 的含税模式继续以“已舍入行含税金额 ÷ (1 + 税率)”计算行不含税金额。

保留 `tax_exclusive` 读取兼容分支，不再允许新合同或新行选择该模式，但不得删除旧数据计算能力。

- [ ] **Step 4：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- decimal-money.spec.ts --runInBand
git add services/api/src/money
git commit -m "feat: 固化合同含税金额计算口径"
```

## Task 5：把新合同税务事实纳入保存、就绪检查、冻结和生效

**Files:**

- Modify: `services/api/src/contract-workbench/dto/contract-workbench.dto.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `packages/shared-domain/src/contract-workbench.ts`

- [ ] **Step 1：先写保存和提交门槛测试**

至少覆盖：

- 缺票种不能提交。
- 缺税率不能提交。
- `0%`、负数、超过 100、超过 3 位小数不能保存。
- 纯固定总价、无清单可凭含税总价提交。
- 有计价清单时不能使用手工金额覆盖清单合计。
- 单一税率行不能提交不同税率。
- 特殊多税率的例外行可覆盖。
- 审批提交后状态为 `frozen`。
- 审批退回后恢复可编辑 `draft`。
- 归档生效后状态为 `confirmed`。
- 合同变更版本复制旧事实，但更改后只影响新版本。

- [ ] **Step 2：扩展保存 DTO**

```ts
export interface SaveContractTaxFactsDto {
  invoiceType: "vat_general" | "vat_special" | null;
  taxMode: "single_rate" | "multiple_rate";
  defaultTaxRatePercent: string | null;
  source: "contract_document";
}

export interface SaveContractDraftDto {
  expectedRevision: number;
  draftData: Record<string, unknown>;
  clauses: ContractClauseDefinition[];
  pricingNature: "fixed_total" | "provisional_total" | "unit_price" | "framework";
  amountSource: "bill_sum" | "manual";
  manualAmountCents?: string;
  amountAdjustmentReason?: string;
  layoutTemplateVersionId?: string;
  paymentTermsOriginalText?: string;
  paymentStages?: Array<{
    name: string;
    basis: "current_settlement";
    ratioBps: number;
    triggerEvent: string;
    dueDays: number;
    requiresInvoice: boolean;
    allowsInstallments: boolean;
    originalText: string;
  }>;
  taxFacts: SaveContractTaxFactsDto;
}
```

- [ ] **Step 3：以规范字段为唯一事实**

保存时：

1. 校验规范税务字段。
2. 更新 `ContractVersion` 规范字段和 `taxFactRevision + 1`。
3. 为旧合同母版兼容，把中文展示值镜像到 `draftData.fieldValues.invoiceType` 和 `taxRatePercent`。
4. 后续检查、结算和 API 不再从镜像字段读取事实。
5. 审计保存前后值，不记录用户密码或文件下载地址。

- [ ] **Step 4：严格区分三种金额结构**

在就绪检查和保存服务中建立一个共享判断：

```ts
type ContractPricingPolicy =
  | { kind: "fixed_total_without_bill"; amountSource: "manual" }
  | { kind: "priced_bill"; amountSource: "bill_sum" }
  | { kind: "unlimited_framework"; amountSource: "bill_sum"; contractAmountCents: 0n };
```

规则：

- 无计价行的纯固定总价：允许手工含税总价。
- 存在计价行：必须由 `included/provisional` 真实行汇总。
- 无总价框架：合同金额固定为内部 `0n`，页面不显示零金额。
- `amountAdjustmentReason` 只保留历史读取兼容；新保存不再用它绕过清单合计。
- 不修改结算域 `manual_adjustment`。

- [ ] **Step 5：冻结和生效**

`ContractReadinessService.freeze()` 增加：

```ts
taxFacts: {
  invoiceType: version.invoiceType,
  taxMode: version.taxMode,
  defaultTaxRatePercent: version.defaultTaxRatePercent?.toString() ?? null,
  taxFactRevision: version.taxFactRevision
}
```

合同提交事务把版本税务事实设为 `frozen`。审批退回/驳回到申请人时恢复 `draft`；归档确认生效时设为 `confirmed`。

- [ ] **Step 6：读取模型**

`ContractWorkbenchReadModel.version` 增加：

```ts
taxFacts: {
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string | null;
  status: ContractTaxFactStatus;
  source: ContractTaxFactSource | null;
  revision: number;
  frozenAt: string | null;
};
```

合同详情显示一次票种、税率、含税金额事实，不在多个卡片重复。

- [ ] **Step 7：运行定向测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  contract-workbench.service.spec.ts \
  contract-readiness.service.spec.ts \
  contract.service.spec.ts \
  contract-read.service.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
git add services/api/src/contract services/api/src/contract-workbench packages/shared-domain/src/contract-workbench.ts
git commit -m "feat: 将税务事实纳入合同版本冻结"
```

## Task 6：治理合同清单精度、税率继承、框架数量和严格合计

**Files:**

- Modify: `services/api/src/contract-bill/dto/contract-bill.dto.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill-totals.ts`
- Modify: `services/api/src/contract-bill/contract-bill-excel.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/database/core-flow-seed-data.ts`
- Modify: `services/api/src/database/core-flow-seed-data.spec.ts`
- Modify: `packages/shared-domain/src/contract-workbench.ts`

- [ ] **Step 1：先写行保存失败测试**

覆盖：

```ts
await expect(addRow({ quantity: "1.001" })).rejects.toThrow("数量最多保留 2 位小数");
await expect(addRow({ unitPrice: "1.001" })).rejects.toThrow("含税单价最多保留 2 位小数");
await expect(addRow({ taxRatePercent: "0" })).rejects.toThrow("税率必须大于 0");
await expect(addRow({ quantity: "" }, frameworkBill)).resolves.toMatchObject({
  quantity: null,
  taxInclusiveAmountCents: null
});
await expect(addRow({ quantity: "" }, normalBill)).rejects.toThrow("数量不能为空");
```

另加：

- 单一税率行继承版本税率。
- 单一税率行伪造不同税率被拒绝。
- 多税率例外行记录 `taxRateSource = row_override`。
- 旧 `legacy` 行未修改时保持原值。
- 修改旧行时必须符合两位小数并切换策略。

- [ ] **Step 2：调整 DTO**

```ts
export interface SaveBillRowDto {
  expectedBillRevision: number;
  itemName: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  itemCode?: string;
  specification?: string;
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}
```

- [ ] **Step 3：后端根据版本事实计算有效税率**

服务必须加载 `ContractVersion`：

```ts
const effectiveTaxRate =
  version.taxMode === "single_rate"
    ? requiredVersionTaxRate(version)
    : input.taxRateSource === "row_override"
      ? requiredTaxRate(input.taxRatePercent)
      : requiredVersionTaxRate(version);
```

新行只允许 `pricingMode = tax_inclusive`。旧 `tax_exclusive` 行保持只读和计算兼容，不能通过普通编辑改造成新行。

- [ ] **Step 4：框架合同允许预计数量为空**

只有 `pricingNature = framework AND amountLimitType = unlimited` 时允许 `quantity = null`。此时：

- 含税单价和税率仍必填；
- 三个预计行金额为 `null`；
- 读模型显示“按实际发生量结算”；
- 不进入合同金额汇总。

- [ ] **Step 5：重写清单汇总**

`recalculateBillAndContractAmount`：

- 只汇总金额完整的行；
- 任一应计价行缺价格事实时，清单返回 `pricingFactStatus = unconfirmed`；
- 合同金额只有在所有应计价行完整时才能更新；
- 框架参考行不更新合同金额；
- `included` 与既有 `provisional` 语义保留；
- 不允许手工金额覆盖。

- [ ] **Step 6：Excel 与网页执行同一规则**

修改中文列名：

- `单价(元)` → `含税单价(元)`
- 新增只读导出列 `不含税单价(元)`
- 单一税率模式中税率列导出默认值；导入为空时继承，填入不同值时报错。
- 特殊多税率模式允许例外税率。
- 数量和含税单价超 2 位直接报错。
- `0%` 报错。
- 框架预计数量可空。

- [ ] **Step 7：新建合同精度归一，旧模板不追溯篡改**

创建新合同清单时：

```ts
quantityScale: 2,
unitPriceScale: 2,
pricingMode: "tax_inclusive"
```

已发布模板 JSON 和历史合同快照不批量改写。新模板保存/发布校验要求两位小数；旧模板仍可读取。

种子数据：

- 删除 `0%` 快捷项；
- 数量精度统一为 2；
- 保留 1/3/6/9/13；
- 票种使用两项固定选项。

- [ ] **Step 8：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  contract-bill.service.spec.ts \
  contract-bill-excel.service.spec.ts \
  core-flow-seed-data.spec.ts \
  --runInBand
git add services/api/src/contract-bill services/api/src/database/core-flow-seed-data* \
  services/api/src/contract/contract.service.ts packages/shared-domain/src/contract-workbench.ts
git commit -m "feat: 统一合同清单含税计价规则"
```

## Task 7：改造合同工作台和合同文档映射

**Files:**

- Create: `apps/web-admin/src/pages/contracts/workbench/ContractTaxFactsSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-tax-facts.state.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-tax-facts.state.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractProfessionalFieldsSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractPricingSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.test.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `services/api/src/contract-document/contract-document.service.ts`
- Modify: `services/api/src/contract-document/contract-document.service.spec.ts`
- Modify: `services/api/src/contract-document/contract-placeholder-registry.ts`
- Modify: `services/api/src/contract-document/contract-docx-renderer.spec.ts`

- [ ] **Step 1：先写前端状态测试**

```ts
expect(taxRateQuickOptions.map((item) => item.value)).toEqual(["1", "3", "6", "9", "13", "other"]);
expect(taxFactsDisabledReason({ invoiceType: null, rate: "13" })).toBe("请选择发票类型");
expect(taxFactsDisabledReason({ invoiceType: "vat_special", rate: "0" })).toBe("税率必须大于 0");
expect(contractProfessionalFields(fields).map((item) => item.key)).not.toContain("invoiceType");
expect(contractProfessionalFields(fields).map((item) => item.key)).not.toContain("taxRatePercent");
```

- [ ] **Step 2：增加规范税务事实区**

页面结构：

- 发票类型：固定二选一。
- 计税模式：默认单一税率；特殊多税率为次级选项。
- 常用税率：1/3/6/9/13。
- 其他税率：选择“其他”后显示普通数字输入。
- 状态文字：草稿、随审批冻结、已确认。

不得用颜色作为唯一状态，不新增大卡片、动画或阴影。

- [ ] **Step 3：去除模板字段重复展示**

`ContractProfessionalFieldsSection` 过滤 `invoiceType` 和 `taxRatePercent`。模板字段仍保留，用于兼容旧母版和历史快照。

- [ ] **Step 4：清单编辑器使用 TDesign**

由于本任务必须触碰该组件，应同时把现有原生：

- `<select>`
- `<input type="file">`
- 原生 `<button>`

替换为已有 TDesign `t-select/t-input/t-upload/t-button`，不改变上传接口和清单 CRUD。

单一税率下行税率只读显示“继承合同税率”；特殊多税率下允许选“使用合同税率”或“例外税率”。

- [ ] **Step 5：调整计价区**

- 有清单时只显示系统合计，不显示手工调整原因。
- 纯固定总价无清单时显示“含税合同总价（元）”。
- 无总价框架显示“不设合同总价；按实际发生量结算”。
- 未计算值显示 `—` 或引导文字，不显示已生效样式的 `0`。

- [ ] **Step 6：母版占位符向后兼容**

规范字段映射：

```ts
"field.invoiceType" = contractInvoiceTypeLabel(version.invoiceType);
"field.taxRatePercent" = `${version.defaultTaxRatePercent}%`;
```

清单占位符：

- `单价` 继续作为旧母版别名，但值明确为含税单价；
- 新增 `含税单价`；
- 新增 `不含税单价`；
- 保留 `税率`、`含税金额`；
- 新增 `不含税金额`、`税额`。

历史未知值输出 `—`，合同提交就绪检查会阻止新合同生成不完整正式文档。

- [ ] **Step 7：运行定向验证并提交**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  contract-tax-facts.state.test.ts \
  contract-bill-editor.test.ts \
  use-contract-draft.test.ts
pnpm --filter @jiangkong/api test -- \
  contract-document.service.spec.ts \
  contract-docx-renderer.spec.ts \
  --runInBand
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git add apps/web-admin/src/pages/contracts apps/web-admin/src/api/contract-workbench.api* \
  services/api/src/contract-document
git commit -m "feat: 在合同工作台录入规范税务事实"
```

## Task 8：让历史接管表达未知税务事实和历史计价行

**Files:**

- Modify: `services/api/src/contract-takeover/dto/create-contract-takeover.dto.ts`
- Modify: `services/api/src/contract-takeover/dto/precheck-contract-takeover-import.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-excel.service.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-excel.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`

- [ ] **Step 1：先写历史接管测试**

覆盖：

- 票种、税率、单价全空仍可创建和确认接管。
- 空值读模型显示“原合同未明确”，不返回 `"0"`。
- 完整输入在接管后仍为 `unconfirmed`，必须走专门复核。
- 框架历史行可不填预计数量。
- 某行缺单价时保留该项目和缺口。
- 0% 或超过两位小数的导入行被阻断。

- [ ] **Step 2：扩展接管 DTO**

```ts
export interface HistoricalPricingItemDto {
  billKey: string;
  billName: string;
  rowKey: string;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  estimatedQuantity?: string;
  taxInclusiveUnitPrice?: string;
  taxRatePercentOverride?: string;
  isProvisional?: boolean;
  settlementBasis?: string;
}

export interface HistoricalContractTaxFactsInput {
  invoiceType?: ContractInvoiceType;
  taxMode?: ContractTaxMode;
  defaultTaxRatePercent?: string;
  taxFactSource?: ContractTaxFactSource;
  taxFactExplanation?: string;
  pricingItems?: HistoricalPricingItemDto[];
}
```

把 `HistoricalContractTaxFactsInput` 的六个字段逐项加入现有
`CreateContractTakeoverDto`；既有合同编号、名称、相对方、签约主体、金额、
签订日期、接管等级、履约状态、付款条款、历史余额和复核字段保持原样。

- [ ] **Step 3：创建历史清单但不伪造事实**

- 每份历史合同按 `billKey` 创建 `ContractBill`。
- 未知数量、单价、税率写 `null`。
- 完整输入也先写 `pricingFactStatus = unconfirmed`。
- 行金额只有数量、单价、税率完整时才计算，否则为 `null`。
- 合同版本 `taxFactStatus = unconfirmed`。
- 接管确认不自动把税务事实设为已确认。

- [ ] **Step 4：增加两张工作表的 Excel 导入**

复用现有 ExcelJS 和私有文件上传：

工作表“合同主表”至少包含：

- 合同编号、名称、相对方、合同类型、签约主体；
- 合同金额、签订日期、接管等级、履约状态；
- 发票类型、计税模式、默认税率；
- 税务事实来源、确认说明。

工作表“计价清单”至少包含：

- 合同编号、清单标识、清单名称、项目标识；
- 名称、规格、单位、预计数量；
- 含税单价、例外税率、暂定项、结算依据。

新增接口：

```text
GET  /projects/:projectId/contract-takeovers/import-template
POST /projects/:projectId/contract-takeovers/imports/preview
POST /projects/:projectId/contract-takeovers/imports/apply
```

`apply` 必须重新读取同一私有 `FileObject`、重新计算 SHA-256/指纹和预检结果，不能信任前端回传金额。

保留现有粘贴导入作为兼容入口，不删除。

- [ ] **Step 5：Web 展示缺口**

- 接管表单增加可选票种、税率和历史计价行。
- 未知字段显示中性 `—` 和“原合同未明确”。
- 接管确认摘要列出缺失字段及后续影响。
- 不用大面积红色提示。
- Excel 使用 `t-upload`，不改变私有文件 API。

- [ ] **Step 6：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  contract-takeover.service.spec.ts \
  contract-takeover.controller.spec.ts \
  contract-takeover-excel.service.spec.ts \
  --runInBand
pnpm --filter @jiangkong/web-admin test -- contract-takeover.config.test.ts core-flow-read.api.test.ts
git add services/api/src/contract-takeover apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue \
  apps/web-admin/src/pages/contracts/contract-takeover.config* apps/web-admin/src/api/core-flow-read.api*
git commit -m "feat: 扩展历史合同税务事实接管"
```

## Task 9：实现历史税务事实补录、复核、确认和更正账本

**Files:**

- Create: `services/api/src/contract-tax-facts/contract-tax-facts.module.ts`
- Create: `services/api/src/contract-tax-facts/contract-tax-facts.service.ts`
- Create: `services/api/src/contract-tax-facts/contract-tax-facts.service.spec.ts`
- Create: `services/api/src/contract-tax-facts/dto/contract-tax-fact-revision.dto.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- Modify: `services/api/src/auth/guards/permission.guard.spec.ts`
- Create: `apps/web-admin/src/api/contract-tax-facts.api.ts`
- Create: `apps/web-admin/src/api/contract-tax-facts.api.test.ts`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue`
- Create: `apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.ts`
- Create: `apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`

- [ ] **Step 1：先写状态机和权限测试**

状态机：

```text
draft
  -> pending_finance_review
  -> pending_contract_confirmation
  -> confirmed

pending_finance_review -> rejected
pending_contract_confirmation -> rejected
```

`rejected` 不可原地覆盖；合同员从被退回记录复制出新的 `revisionNo`。

测试必须证明：

- 合同员不能财务复核。
- 财务主管不能合同确认。
- 合同部主管不能替合同员创建补录。
- 技术管理员不能代替任何业务节点。
- 复核和确认都校验项目与合同版本归属。
- 文件可选；无文件时说明必填。
- 更正必须保存更正前完整快照和原因。

- [ ] **Step 2：增加端点**

```text
POST  /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions
PATCH /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId
POST  /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/finance-review-submission
POST  /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/finance-review
POST  /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/contract-confirmation
```

权限：

- 创建、编辑、提交：`contract.tax_fact.supplement`
- 财务复核：`contract.tax_fact.finance_review`
- 合同确认：`contract.tax_fact.confirm`

- [ ] **Step 3：实现候选快照**

账本记录必须保存：

```ts
type ContractTaxFactCandidate = {
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string | null;
  source: ContractTaxFactSource | null;
  confirmationExplanation: string | null;
  evidenceFileId: string | null;
  rowFacts: Array<{
    contractBillRowId: string;
    taxInclusiveUnitPrice: string | null;
    taxRatePercentOverride: string | null;
  }>;
};
```

合同员保存草稿不更新 `ContractVersion` 或 `ContractBillRow` 当前事实。

- [ ] **Step 4：财务复核**

财务主管核对：

- 票种；
- 税率；
- 单一/多税率模式；
- 行税率覆盖；
- 税额计算预览。

同意后只把账本状态转为 `pending_contract_confirmation`；不得提前解除结算阻断。

- [ ] **Step 5：合同部主管确认**

在一个事务内：

1. `FOR UPDATE` 锁定版本、复核记录和目标清单行。
2. 验证状态仍为待合同确认。
3. 更新 `ContractVersion` 当前事实。
4. 更新本次涉及的 `ContractBillRow`。
5. 重新计算完整行金额和清单合计。
6. `taxFactRevision + 1`。
7. 将账本状态设为 `confirmed`。
8. 写审计日志，包含前后快照、来源、附件 ID、操作者和时间。

已提交/已生效结算不更新。

- [ ] **Step 6：更正**

已确认事实的录入错误：

- 新建 `kind = correction` 的新修订；
- 原值进入 `beforeSnapshot`；
- 更正原因必填；
- 重新走财务复核和合同确认；
- 不修改历史结算快照。

双方约定发生变化时，UI 只提供“前往合同变更”，不能使用更正流程。

- [ ] **Step 7：Web 复核面板**

面板显示：

- 当前事实与状态；
- 缺失字段；
- 补录草稿；
- 财务复核意见；
- 合同确认意见；
- 历史修订时间线；
- 直达结算阻断解除条件。

按钮按后端返回的权限和状态显示，不伪造无权限操作。

- [ ] **Step 8：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  contract-tax-facts.service.spec.ts \
  contract-takeover.controller.spec.ts \
  permission.guard.spec.ts \
  --runInBand
pnpm --filter @jiangkong/web-admin test -- \
  contract-tax-facts.api.test.ts \
  contract-tax-fact-review.state.test.ts
git add services/api/src/contract-tax-facts services/api/src/contract-takeover \
  services/api/src/app.module.ts services/api/src/auth/guards/permission.guard.spec.ts \
  apps/web-admin/src/api/contract-tax-facts.api* \
  apps/web-admin/src/pages/contracts
git commit -m "feat: 增加历史合同税务事实复核"
```

## Task 10：让结算选行和预览精准表达税务缺口

**Files:**

- Modify: `packages/shared-domain/src/settlement-workbench.ts`
- Modify: `services/api/src/settlement/settlement-workbench.service.ts`
- Modify: `services/api/src/settlement/settlement-workbench.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-line-calculator.ts`
- Modify: `services/api/src/settlement/settlement-line-calculator.spec.ts`
- Modify: `services/api/src/settlement/settlement-quantity.ts`
- Modify: `services/api/src/settlement/settlement-quantity.spec.ts`
- Modify: `services/api/src/settlement/settlement-canonical-preview.spec.ts`
- Modify: `apps/web-admin/src/api/settlement-workbench.api.ts`
- Modify: `apps/web-admin/src/api/settlement-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.state.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.state.test.ts`

- [ ] **Step 1：先写缺口读取测试**

`SettlementSourceLineReadModel` 调整为：

```ts
quantity: string | null;
unitPrice: string | null;
taxRatePercent: string | null;
taxExclusiveUnitPrice: string | null;
pricingFactStatus: "confirmed" | "unconfirmed";
calculationAvailable: boolean;
submissionBlocker: {
  code: "missing_invoice_type" | "missing_tax_rate" | "missing_unit_price";
  message: string;
  remedyPath: string;
} | null;
```

测试：

- 合同级缺票种时所有行都说明合同级阻断。
- 某行缺单价时只有该行阻断。
- 其他完整行仍可计算。
- 未知值不序列化为 `"0"`。
- 框架预计数量为空时仍可录入本期实际数量。

- [ ] **Step 2：把结算新输入精度改为两位**

`parseSettlementQuantity` 对新请求最多 2 位小数。数据库历史 `SettlementLine.quantity` 不迁移、不重算。

错误文案：

```text
本期结算数量最多保留 2 位小数，请修改后重试。
```

- [ ] **Step 3：预览返回阻断而不是清空输入**

预览模型增加：

```ts
submissionBlockers: Array<{
  code: string;
  contractBillRowId: string | null;
  message: string;
  remedyPath: string;
}>;
```

缺价格行的 `amountCents` 为 `null`。完整行继续以后端计算结果返回。

- [ ] **Step 4：明确保留人工调整**

不得删除：

```ts
sourceType: "manual_adjustment"
calculationMode: "manual_adjustment"
```

本任务只阻止合同清单中出现虚构调差行；结算人工调整仍按现有原因必填、可正可负和审计逻辑执行。

- [ ] **Step 5：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  settlement-workbench.service.spec.ts \
  settlement-line-calculator.spec.ts \
  settlement-quantity.spec.ts \
  settlement-canonical-preview.spec.ts \
  --runInBand
pnpm --filter @jiangkong/web-admin test -- \
  settlement-workbench.api.test.ts \
  settlement-workbench.state.test.ts
git add packages/shared-domain/src/settlement-workbench.ts services/api/src/settlement \
  apps/web-admin/src/api/settlement-workbench.api* apps/web-admin/src/pages/settlements/settlement-workbench.state*
git commit -m "feat: 精准标记结算税务事实缺口"
```

## Task 11：拆分结算草稿保存和审批提交

**Files:**

- Create: `services/api/src/settlement/dto/settlement-draft.dto.ts`
- Create: `services/api/src/settlement/settlement-draft.controller.ts`
- Create: `services/api/src/settlement/settlement-draft.service.ts`
- Create: `services/api/src/settlement/settlement-draft.service.spec.ts`
- Create: `services/api/src/settlement/settlement-submission.service.ts`
- Create: `services/api/src/settlement/settlement-submission.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.module.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.controller.ts`
- Modify: `services/api/src/settlement/settlement.controller.spec.ts`

- [ ] **Step 1：先写草稿零占用测试**

保存草稿后必须断言：

```ts
expect(tx.settlement.create).not.toHaveBeenCalled();
expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
expect(tx.projectSettlementExceptionQuotaUsage.createMany).not.toHaveBeenCalled();
expect(tx.approvalInstance.create).not.toHaveBeenCalled();
```

并覆盖：

- 缺票种/税率/单价仍可保存。
- 只能读写自己的草稿。
- 项目 ID 以合同版本真实归属为准，伪造 body/projectId 无效。
- `expectedRevision` 冲突返回可理解错误。
- 草稿提交成功后不可再次提交。

- [ ] **Step 2：增加草稿 DTO**

```ts
export class SaveSettlementDraftDto {
  contractVersionId!: string;
  settlementTemplateVersionId!: string;
  code!: string;
  periodLabel!: string;
  isFinal?: boolean;
  finalCumulativeAmountCents?: string;
  settlementLines!: CreateSettlementLineDto[];
  expectedRevision?: number;
}
```

- [ ] **Step 3：增加项目范围接口**

```text
POST  /projects/:projectId/settlement-drafts
GET   /projects/:projectId/settlement-drafts
GET   /projects/:projectId/settlement-drafts/:draftId
PATCH /projects/:projectId/settlement-drafts/:draftId
POST  /projects/:projectId/settlement-drafts/:draftId/approval-submission
```

全部使用 `settlement.create` 权限；草稿 Service 再校验 `ownerUserId`。

- [ ] **Step 4：抽取唯一提交事务**

把当前 `SettlementService.create()` 中以下逻辑移动到 `SettlementSubmissionService`：

- 锁定当前生效合同版本；
- 模板兼容；
- 期间重复；
- 规范化结算行；
- 付款条款；
- 最终结算计算；
- 合同清单上限；
- 项目例外额度；
- 应付金额；
- Settlement/Line 创建；
- 额度占用；
- 审批实例；
- 审计。

新增税务门槛在规范化结算行之前执行：

```ts
await this.assertTaxFactsReadyForSubmission(tx, version, requestedLines);
```

既有 `POST /settlements` 只改为委托该服务，HTTP 路径、请求体和返回值保持兼容。

- [ ] **Step 5：草稿提交**

事务中：

1. 锁定草稿。
2. 校验所有者、状态和修订号。
3. 用草稿原始输入调用唯一提交服务。
4. 生成正式 Settlement 和快照。
5. 把草稿标记为 `submitted` 并记录 `submittedSettlementId`。
6. 税务阻断时只返回错误和补录路径，不修改草稿。

- [ ] **Step 6：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  settlement-draft.service.spec.ts \
  settlement-submission.service.spec.ts \
  settlement.service.spec.ts \
  settlement.controller.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
git add services/api/src/settlement
git commit -m "feat: 拆分结算草稿与审批提交"
```

## Task 12：在 Web 结算工作台提供保存草稿和精准提交反馈

**Files:**

- Create: `apps/web-admin/src/api/settlement-drafts.api.ts`
- Create: `apps/web-admin/src/api/settlement-drafts.api.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/settlements/SettlementListPage.vue`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.state.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.state.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.structure.test.ts`

- [ ] **Step 1：先写 API 和结构测试**

断言：

- 保存使用 `/projects/:projectId/settlement-drafts`。
- 更新带 `expectedRevision`。
- 提交使用 `/approval-submission`。
- 页头有“保存草稿”和唯一主按钮“提交结算审批”。
- 不再把 `createSettlementDraft()` 指向 `/settlements`。
- 税务阻断不会禁用保存草稿。

- [ ] **Step 2：加载与恢复草稿**

工作台使用现有路由 `/结算工作台`，只增加查询参数：

```text
/结算工作台?draftId=<id>
```

不新增路由地址。加载草稿后恢复项目、合同、模板、编号、期间、选中行、数量、人工调整和备注。

- [ ] **Step 3：保存和提交分离**

- “保存草稿”：次级按钮；不要求税务事实完整。
- “提交结算审批”：页面唯一主按钮；要求后台预览为当前版本且无阻断。
- 提交失败保留所有输入。
- 保存成功后用 `router.replace` 写入 `draftId` 查询参数。
- 页面离开时有未保存更改提醒。

- [ ] **Step 4：草稿入口**

在现有结算台账增加“我的草稿”页签或紧凑区，显示：

- 结算编号；
- 项目；
- 合同；
- 结算期间；
- 最近保存时间；
- 税务缺口数量；
- “继续填写”。

不改变既有正式结算台账统计口径。

- [ ] **Step 5：税务阻断反馈**

错误必须说明：

1. 缺少什么；
2. 当前草稿已保存、不受影响；
3. 为什么不能提交；
4. 下一步去哪里处理。

历史合同跳转：

```ts
router.push({
  path: "/历史合同接管",
  query: { takeoverId, section: "tax-facts" }
});
```

单项缺价只在对应行显示“含税单价待确认”。

- [ ] **Step 6：运行 Web 验证并提交**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  settlement-drafts.api.test.ts \
  settlement-workbench.state.test.ts \
  settlement-workbench.structure.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git add apps/web-admin/src/api/settlement-drafts.api* apps/web-admin/src/pages/settlements
git commit -m "feat: 支持结算草稿保存后提交"
```

## Task 13：冻结结算税务快照并统一合同、结算文件展示

**Files:**

- Modify: `packages/shared-domain/src/core-flow-read-model.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.ts`
- Modify: `services/api/src/settlement/settlement-read.service.ts`
- Modify: `services/api/src/settlement/settlement-read.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-document-renderer.ts`
- Modify: `services/api/src/settlement/settlement-document-renderer.spec.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`

- [ ] **Step 1：先写快照测试**

正式提交后断言：

```ts
expect(createdSettlement.invoiceTypeSnapshot).toBe("vat_special");
expect(createdSettlement.taxFactRevisionSnapshot).toBe(3);
expect(createdLine.unitPriceSnapshot?.toString()).toBe("4.56");
expect(createdLine.taxRatePercentSnapshot?.toString()).toBe("13");
expect(createdLine.amountCents).toBe(561n);
expect(createdLine.taxExclusiveAmountCents).toBe(496n);
expect(createdLine.taxAmountCents).toBe(65n);
```

后续合同税务更正后，旧结算详情和文件仍显示旧快照。

- [ ] **Step 2：创建行时保存税额快照**

正常合同清单行：

- `amountCents` = 行含税金额；
- `taxExclusiveAmountCents` = 行不含税金额；
- `taxAmountCents` = 税额。

`manual_adjustment`：

- 保留既有金额；
- 税率、含税单价、不含税金额和税额为 `null`；
- 文件中明确显示“人工调整，不适用合同单价税额拆分”，不伪造税值。

- [ ] **Step 3：结算详情**

增加一次性税务事实摘要：

- 发票类型；
- 税率模式；
- 默认税率；
- 税务事实修订号。

明细表列名：

- 含税单价；
- 不含税单价；
- 税率；
- 含税金额；
- 不含税金额；
- 税额。

金额右对齐。页面不在其他区块重复同一事实。

- [ ] **Step 4：结算审批单和归档文件**

保留已确认的 A4 横向、重复表头和签名布局。明细表加入上述税务列，并保证：

- 每页表头重复；
- 多页签名区仍位于页底；
- 不含税单价仅为只读展示；
- 行不含税金额来自快照，不用“数量 × 舍入后不含税单价”重算；
- 手工调整行清楚区分。

- [ ] **Step 5：运行测试并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  settlement-submission.service.spec.ts \
  settlement-read.service.spec.ts \
  settlement-document-renderer.spec.ts \
  --runInBand
pnpm --filter @jiangkong/web-admin test -- core-flow-read.api.test.ts
git add packages/shared-domain/src/core-flow-read-model.ts services/api/src/settlement \
  apps/web-admin/src/api/core-flow-read.api* apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
git commit -m "feat: 冻结结算税务与价格快照"
```

## Task 14：全量回归、浏览器验收和业务 UAT

**Files:**

- Modify: `apps/web-admin/e2e/contract-workbench-canvas.e2e.ts`
- Modify: `apps/web-admin/e2e/contract-takeover-responsive.e2e.ts`
- Modify: `apps/web-admin/e2e/settlement-workbench.e2e.ts`
- Modify: `apps/web-admin/e2e/ui-p1-contract-visual.e2e.ts`
- Modify: `apps/web-admin/e2e/ui-p1-settlement-visual.e2e.ts`
- Create: `docs/superpowers/runbooks/2026-07-16-contract-tax-facts-release.md`

- [ ] **Step 1：增加稳定 Mock 场景**

至少覆盖：

1. 新固定总价无清单合同。
2. 新单一税率有清单合同。
3. 特殊多税率合同。
4. 无总价框架合同，预计数量为空。
5. 历史合同票种和税率均缺失。
6. 历史合同单项缺含税单价。
7. 历史补录待财务复核。
8. 历史补录待合同确认。
9. 结算草稿可保存、提交被阻断。
10. 补录确认后同一草稿可提交。

- [ ] **Step 2：浏览器尺寸**

使用现有 Playwright 和稳定 Mock，在以下尺寸验证：

- 1512×982
- 1440×900
- 1280×800
- 1180×820
- 1024×768
- 900×768

页面：

- 合同工作台税务事实；
- 合同清单；
- 历史接管税务复核；
- 结算台账草稿；
- 结算工作台正常；
- 结算工作台税务阻断；
- 结算详情税务快照。

检查：

- 无文档级横向溢出；
- 宽清单只在表格/工作区内部滚动；
- 无父子嵌套横向滚动条；
- 页头和主操作不参与横滚；
- 未知值不显示为 0；
- 没有原生按钮、上传、confirm 或 prompt；
- 没有新增动画、渐变、玻璃拟态和装饰阴影。

- [ ] **Step 3：定向 UAT**

在隔离测试数据中按岗位执行：

```text
合同员：
  新合同保存 -> 清单录入 -> 提交审批
  历史合同补录 -> 提交财务复核

财务主管：
  查看候选税务事实 -> 退回一次 -> 复核通过

合同部主管：
  确认补录 -> 验证合同版本事实更新

合同员：
  打开原结算草稿 -> 提交审批
```

验证：

- 退回前后记录不覆盖；
- 无附件时说明必填；
- 单项缺价只阻断对应行；
- 完整行仍可计算；
- 历史结算和付款事实不漂移。

- [ ] **Step 4：运行全部测试**

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin typecheck:e2e
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/web-admin test:e2e:p0
git diff --check
```

Expected: 全部通过；现有有效测试不得删除、弱化或改成无意义断言。

- [ ] **Step 5：受保护范围复核**

```bash
git diff origin/main -- \
  apps/web-admin/src/routes \
  services/api/src/payment \
  services/api/src/file \
  services/api/src/storage \
  services/api/src/approval
```

允许结果：

- `services/api/src/approval` 必须为空。
- `apps/web-admin/src/routes` 必须为空。
- `services/api/src/payment` 必须为空。
- 文件/存储目录必须为空。

若出现差异，停止并审查，不得以“顺便重构”为理由保留。

- [ ] **Step 6：提交**

```bash
git add apps/web-admin/e2e docs/superpowers/runbooks/2026-07-16-contract-tax-facts-release.md
git commit -m "test: 覆盖合同税务事实端到端验收"
```

## Task 15：迁移演练、发布候选、回滚和生产闸门

**Files:**

- Create: `docs/progress/2026-07-16-contract-tax-facts-release-candidate.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1：在隔离数据库执行迁移**

流程：

1. 使用最新异机备份从 COS 独立下载。
2. 校验 SHA-256 和 `pg_restore --list`。
3. 恢复到 `jiangkong_restore_*` 隔离数据库。
4. 记录迁移前 51 个迁移。
5. 在候选 SHA 上执行新迁移。
6. 运行 Prisma `migrate status`。
7. 执行 Task 1 审计脚本。
8. 使用 `default_transaction_read_only=on` 验证既有金额、数量、单价、结算和付款计数未变化。
9. 删除隔离数据库和临时文件。

- [ ] **Step 2：迁移后数据断言**

必须证明：

- 既有 `ContractVersion.amountCents` 总和前后一致。
- 既有 `ContractBillRow` 数量、单价、税率和金额逐行未变化。
- 既有 Settlement/SettlementLine/PaymentRequest/PaymentExecution 计数和金额未变化。
- 历史接管未被自动确认。
- 可证明的系统合同税务字段按规则回填。
- 旧精度行全部标记 `legacy`。
- 迁移没有生成结算草稿或审批实例。

- [ ] **Step 3：建立兼容回滚点**

发布候选必须保留一个“迁移兼容代码”提交：它能读取新字段、空历史价格和新状态，但不要求 UI 已开启。

回滚规则：

- **尚未发生新税务补录/结算草稿写入：** 可回滚到迁移兼容提交，数据库保留新增列和表。
- **已经发生新功能写入：** 不允许回滚到 `48b5ec3f` 或 `b857a426`；只能回滚到仍理解新结构的兼容提交。
- **必须完全撤销数据库：** 使用迁移前备份恢复，不在生产执行手写 down migration。

- [ ] **Step 4：生成发布候选报告**

`docs/progress/2026-07-16-contract-tax-facts-release-candidate.md` 必须包含：

- 当前分支和完整目标 SHA；
- 相对 `origin/main` 提交列表；
- 实际修改文件；
- 新增迁移和迁移号；
- 生产只读审计结果；
- 隔离恢复和迁移结果；
- 全部测试结果；
- E2E 截图位置；
- 受保护目录 diff；
- 数据库是否有写迁移；
- 未解决问题；
- 回滚提交和恢复方式；
- 明确说明尚未推送、部署或执行生产迁移。

- [ ] **Step 5：更新进度并提交文档**

```bash
git add PROGRESS.md docs/progress/2026-07-16-contract-tax-facts-release-candidate.md
git commit -m "docs: 记录合同税务事实发布候选"
```

- [ ] **Step 6：停止并请求生产授权**

必须向用户报告：

- 候选 SHA；
- 迁移前后迁移数量；
- 测试和 UAT；
- 生产数据分类；
- 备份和恢复演练；
- 回滚方式。

只有用户明确批准该 40 位 SHA 后，才允许：

1. 推送 `main`；
2. 执行生产备份；
3. 部署 Web/API；
4. 执行新迁移；
5. 进行生产只读和最小写入验证。

## 3. 实施过程中的每次阶段闸门

每个 Task 开始前：

```bash
sed -n '1,220p' PROGRESS.md
sed -n '1,520p' docs/superpowers/specs/2026-07-16-contract-tax-facts-and-pricing-design.md
git status --short
git log --oneline --decorate -8
```

每个 Task 结束前：

```bash
git diff --check
git diff --stat
git status --short
```

任何阶段发现下列情况必须停止：

- 用户未提交修改与计划文件重叠；
- 生产数据分布与 Task 1 审计结论冲突；
- 现有金额、审批、权限或上传逻辑必须被改变才能继续；
- 迁移会追溯改写已有数量、单价或金额；
- 需要删除有效测试才能通过；
- 需要修改既有路由地址。

## 4. 最终验收矩阵

| 场景 | 保存草稿 | 提交审批 | 预期 |
| --- | --- | --- | --- |
| 新合同缺票种 | 可以保存合同草稿 | 阻断合同提交 | 提示选择普通/专用发票 |
| 新合同税率 0% | 保存即拒绝非法值 | 阻断 | 不接受 0% |
| 固定总价无清单 | 可以 | 可以 | 使用含税合同总价 |
| 有清单缺含税单价 | 可以保存未完成行 | 阻断合同提交 | 精确定位行 |
| 无总价框架预计数量空 | 可以 | 可以 | 显示按实际发生量结算 |
| 历史合同缺票种/税率 | 可以接管 | 可保存结算草稿，阻断结算提交 | 不显示 0 |
| 历史合同单项缺价 | 可以接管 | 只阻断包含该项的结算 | 其他项目可用 |
| 历史补录仅合同员保存 | 可以 | 仍阻断结算提交 | 未经复核不生效 |
| 财务复核通过 | — | 仍阻断 | 等待合同部主管 |
| 合同部主管确认 | — | 解除对应阻断 | 版本修订号递增 |
| 已提交旧结算后更正税率 | — | 旧结算不变化 | 快照稳定 |
| 结算人工调整 | 可以 | 按现有规则 | 不受合同清单禁调差规则误伤 |

## 5. 不在本计划内

- 发票申请、开票、验真、抵扣、红冲、认证和税务申报。
- OCR 自动识别合同或发票。
- 通用审批流配置器。
- 修改合同、结算、付款审批路线。
- 修改历史合同、结算、付款金额。
- 为旧数据自动猜测票种、税率或单价。
- 清理旧模板、旧快照或非当前 CAM 策略版本。
- 推送、部署、生产迁移和生产业务写入。
