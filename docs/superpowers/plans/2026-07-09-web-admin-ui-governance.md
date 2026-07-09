# Web Admin UI Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Web Admin V2 UI governance baseline with project design tokens, automated UI rule checks, reusable business components, and the first three sample pages.

**Architecture:** Keep Vue 3, TypeScript, Vite, and TDesign Vue Next as the only frontend foundation. Add a thin CSS-variable token layer, a dependency-free Node checker, and small business components that compose TDesign instead of replacing it.

**Tech Stack:** Vue 3, TypeScript, Vite, TDesign Vue Next, Vitest, ESLint, Node.js ESM scripts, CSS custom properties.

## Global Constraints

- TDesign Vue Next is the only base UI component library.
- Do not add a second UI library.
- Do not add Sass, Less, Style Dictionary, or a new lint plugin.
- Base UI must use TDesign first.
- If similar UI appears more than twice, extract a reusable component before the third copy spreads.
- Colors, font sizes, spacing, radii, shadows, and layout sizes must come from `--jg-*` tokens or TDesign variables.
- Pages live in `apps/web-admin/src/pages/<domain>/`.
- Domain-local components live in `apps/web-admin/src/pages/<domain>/components/`.
- Cross-domain reusable components live in `apps/web-admin/src/components/`.
- API calls live in `apps/web-admin/src/api/<domain>.api.ts`; pages must not call `fetch` directly.
- Keep implementation incremental: rules and samples first, module-by-module rollout after.

---

## File Map

- Modify `apps/web-admin/src/app/design-tokens.css`: add new `--jg-color-*`, `--jg-font-size-*`, `--jg-line-height-*`, `--jg-shadow-*`, and `--jg-layout-*` tokens while keeping old token aliases.
- Create `apps/web-admin/scripts/check-ui-rules.mjs`: dependency-free UI governance checker with centralized migration allowlist and `--self-test`.
- Modify `apps/web-admin/package.json`: add `check:ui`.
- Create `apps/web-admin/src/components/BusinessStatusSummary.vue`: reusable TDesign-based detail status summary.
- Create `apps/web-admin/src/components/business-status-summary.config.ts`: pure config helpers for the summary component.
- Create `apps/web-admin/src/components/business-status-summary.config.test.ts`: Vitest coverage for summary helper behavior.
- Create `apps/web-admin/src/components/BusinessTableToolbar.vue`: reusable TDesign-based list toolbar shell.
- Create `apps/web-admin/src/components/business-table-toolbar.config.ts`: pure helper for toolbar filter state.
- Create `apps/web-admin/src/components/business-table-toolbar.config.test.ts`: Vitest coverage for toolbar helper behavior.
- Create `apps/web-admin/src/components/EmptyBusinessState.vue`: reusable TDesign-based business empty state.
- Create `apps/web-admin/src/components/empty-business-state.config.ts`: pure helper for empty-state actions.
- Create `apps/web-admin/src/components/empty-business-state.config.test.ts`: Vitest coverage for empty-state helper behavior.
- Modify `apps/web-admin/src/pages/contracts/ContractListPage.vue`: first list-page sample using `BusinessTableToolbar`, `EmptyBusinessState`, TDesign controls, and tokens.
- Modify `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`: first detail-page sample using `BusinessStatusSummary`.
- Modify `apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue`: first configuration-page sample aligned to use/config mode and token rules.
- Modify `apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue`: replace any remaining hand-written base controls touched by this plan.
- Modify `AGENTS.md`: add the frontend UI governance constitution.
- Modify `docs/design/web-admin-v2-enterprise-ui.md`: link the governance spec and implementation baseline.
- Modify `docs/design/建工智管_企业流程系统前端改造方案_20260707.md`: record the token/checker/sample rollout.
- Modify `PROGRESS.md`: record completion and verification.

---

### Task 1: Project Token Baseline

**Files:**
- Modify: `apps/web-admin/src/app/design-tokens.css`
- Test: no unit test; verify with `pnpm --filter @jiangkong/web-admin typecheck`, `pnpm --filter @jiangkong/web-admin lint`, and `git diff --check`.

**Interfaces:**
- Consumes: existing legacy tokens such as `--jg-bg-page`, `--jg-brand`, `--jg-font-body`.
- Produces: new tokens such as `--jg-color-bg-page`, `--jg-font-size-body`, `--jg-line-height-body`, `--jg-shadow-panel`, `--jg-layout-table-row-height`.

- [ ] **Step 1: Expand `design-tokens.css` with new names and legacy aliases**

Use this structure and keep values close to the current project palette:

```css
:root {
  --jg-color-bg-page: #f4f6f9;
  --jg-color-bg-panel: #ffffff;
  --jg-color-bg-muted: #f7f9fc;
  --jg-color-border: #dce1e8;
  --jg-color-text-primary: #151922;
  --jg-color-text-secondary: #424955;
  --jg-color-text-tertiary: #5f6673;
  --jg-color-text-muted: #767f8d;
  --jg-color-brand: #0052cc;
  --jg-color-success: #2ba471;
  --jg-color-warning: #d9822b;
  --jg-color-danger: #c9353f;
  --jg-color-info: #0052cc;

  --jg-font-size-page-title: 24px;
  --jg-font-size-section-title: 16px;
  --jg-font-size-body: 13px;
  --jg-font-size-meta: 12px;
  --jg-font-size-mini: 11px;

  --jg-line-height-tight: 1.25;
  --jg-line-height-body: 1.6;
  --jg-line-height-title: 1.35;

  --jg-space-xs: 4px;
  --jg-space-sm: 8px;
  --jg-space-md: 12px;
  --jg-space-lg: 16px;
  --jg-space-xl: 24px;
  --jg-space-xxl: 32px;

  --jg-radius-sm: 3px;
  --jg-radius-md: 6px;
  --jg-radius-lg: 8px;

  --jg-shadow-none: none;
  --jg-shadow-panel: 0 1px 2px rgba(21, 25, 34, 0.06);
  --jg-shadow-overlay: 0 8px 24px rgba(21, 25, 34, 0.14);

  --jg-layout-page-max-width: 1440px;
  --jg-layout-sidebar-width: 240px;
  --jg-layout-header-height: 56px;
  --jg-layout-table-row-height: 46px;

  --jg-bg-page: var(--jg-color-bg-page);
  --jg-bg-panel: var(--jg-color-bg-panel);
  --jg-bg-muted: var(--jg-color-bg-muted);
  --jg-text-strong: var(--jg-color-text-primary);
  --jg-text-main: var(--jg-color-text-secondary);
  --jg-text-subtle: var(--jg-color-text-tertiary);
  --jg-text-muted: var(--jg-color-text-muted);
  --jg-border: var(--jg-color-border);
  --jg-brand: var(--jg-color-brand);
  --jg-success: var(--jg-color-success);
  --jg-warning: var(--jg-color-warning);
  --jg-danger: var(--jg-color-danger);
  --jg-info: var(--jg-color-info);
  --jg-font-page-title: var(--jg-font-size-page-title);
  --jg-font-section-title: var(--jg-font-size-section-title);
  --jg-font-body: var(--jg-font-size-body);
  --jg-font-meta: var(--jg-font-size-meta);
  --jg-font-mini: var(--jg-font-size-mini);
}
```

- [ ] **Step 2: Run token verification commands**

Run:

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 3: Commit**

```bash
git add apps/web-admin/src/app/design-tokens.css
git commit -m "style: establish web admin design tokens"
```

---

### Task 2: UI Rules Checker

**Files:**
- Create: `apps/web-admin/scripts/check-ui-rules.mjs`
- Modify: `apps/web-admin/package.json`
- Test: `node apps/web-admin/scripts/check-ui-rules.mjs --self-test`, `pnpm --filter @jiangkong/web-admin check:ui`

**Interfaces:**
- Consumes: `apps/web-admin/src`.
- Produces: package script `check:ui`.

- [ ] **Step 1: Create the checker with a self-test**

Create `apps/web-admin/scripts/check-ui-rules.mjs`:

```javascript
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_SOURCE_DIR = path.join(ROOT, "src");

const allowlistedFiles = new Set([
  "src/app/design-tokens.css"
]);

const nativeControlPatterns = [
  { pattern: /<button\b/i, message: "使用 t-button，不要手写 button" },
  { pattern: /<input\b/i, message: "使用 TDesign 输入组件；原生文件输入必须加 ui-rules-ignore" },
  { pattern: /<select\b/i, message: "使用 t-select，不要手写 select" },
  { pattern: /<textarea\b/i, message: "使用 t-textarea，不要手写 textarea" },
  { pattern: /<table\b/i, message: "使用 t-table，不要手写 table" },
  { pattern: /<dialog\b/i, message: "使用 t-dialog，不要手写 dialog" }
];

const visualPatterns = [
  { pattern: /#[0-9a-fA-F]{3,8}\b/, message: "颜色必须来自设计 token" },
  { pattern: /\brgba?\s*\(/i, message: "颜色必须来自设计 token" },
  { pattern: /box-shadow\s*:/i, message: "阴影必须来自设计 token" },
  { pattern: /style="[^"]*color\s*:/i, message: "禁止高风险内联颜色样式" },
  { pattern: /style="[^"]*background/i, message: "禁止高风险内联背景样式" },
  { pattern: /style="[^"]*font-size\s*:/i, message: "禁止高风险内联字号样式" },
  { pattern: /style="[^"]*border-radius\s*:/i, message: "禁止高风险内联圆角样式" }
];

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function shouldSkipFile(filePath, source) {
  const relative = relativePath(filePath);
  return allowlistedFiles.has(relative) || source.includes("ui-rules-ignore");
}

export function findUiRuleViolations(filePath, source) {
  if (shouldSkipFile(filePath, source)) return [];
  return [...nativeControlPatterns, ...visualPatterns].flatMap((rule) =>
    rule.pattern.test(source) ? [{ file: relativePath(filePath), message: rule.message }] : []
  );
}

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(vue|css)$/.test(entry.name) ? [fullPath] : [];
  });
}

function runSelfTest() {
  const badFile = path.join(ROOT, "src/pages/contracts/Bad.vue");
  const okFile = path.join(ROOT, "src/app/design-tokens.css");
  const bad = findUiRuleViolations(badFile, "<template><button>保存</button></template><style>.x{color:#fff}</style>");
  const ok = findUiRuleViolations(okFile, ":root { --jg-color-bg-panel: #ffffff; }");
  if (bad.length < 2 || ok.length !== 0) {
    console.error("UI 规则自检失败");
    process.exit(1);
  }
  console.log("UI 规则自检通过");
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const rootArgIndex = process.argv.indexOf("--root");
  const sourceDir = rootArgIndex >= 0 ? path.resolve(process.argv[rootArgIndex + 1]) : DEFAULT_SOURCE_DIR;
  const violations = listSourceFiles(sourceDir).flatMap((filePath) =>
    findUiRuleViolations(filePath, fs.readFileSync(filePath, "utf8"))
  );

  if (violations.length > 0) {
    violations.forEach((violation) => console.error(`${violation.file}: ${violation.message}`));
    process.exit(1);
  }
  console.log("UI 规则检查通过");
}

main();
```

- [ ] **Step 2: Add `check:ui` to `apps/web-admin/package.json`**

Add one script entry:

```json
"check:ui": "node scripts/check-ui-rules.mjs"
```

- [ ] **Step 3: Run self-test**

Run:

```bash
node apps/web-admin/scripts/check-ui-rules.mjs --self-test
```

Expected:

```text
UI 规则自检通过
```

- [ ] **Step 4: Run project checker**

Run:

```bash
pnpm --filter @jiangkong/web-admin check:ui
```

Expected at this stage: either PASS, or FAIL only on existing pages that must be placed into the centralized migration allowlist. If it fails on existing pages, add those file paths to `allowlistedFiles` in the checker with a comment `// migration allowlist` and run again until it exits `0`.

- [ ] **Step 5: Run package verification**

Run:

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin/package.json apps/web-admin/scripts/check-ui-rules.mjs
git commit -m "chore: add web admin ui rule checks"
```

---

### Task 3: Shared Business UI Components

**Files:**
- Create: `apps/web-admin/src/components/BusinessStatusSummary.vue`
- Create: `apps/web-admin/src/components/business-status-summary.config.ts`
- Create: `apps/web-admin/src/components/business-status-summary.config.test.ts`
- Create: `apps/web-admin/src/components/BusinessTableToolbar.vue`
- Create: `apps/web-admin/src/components/business-table-toolbar.config.ts`
- Create: `apps/web-admin/src/components/business-table-toolbar.config.test.ts`
- Create: `apps/web-admin/src/components/EmptyBusinessState.vue`
- Create: `apps/web-admin/src/components/empty-business-state.config.ts`
- Create: `apps/web-admin/src/components/empty-business-state.config.test.ts`

**Interfaces:**
- Produces: `BusinessStatusSummaryItem`, `normalizeBusinessStatusSummaryItems`, `hasActiveToolbarFilters`, `normalizeEmptyBusinessStateActions`.
- Consumes: TDesign components and project tokens.

- [ ] **Step 1: Add `BusinessStatusSummary` config and test**

Create `business-status-summary.config.ts`:

```typescript
export type BusinessSummaryTone = "default" | "primary" | "warning" | "danger" | "success";

export interface BusinessStatusSummaryItem {
  label: string;
  value: string;
  tone?: BusinessSummaryTone;
}

export function normalizeBusinessStatusSummaryItems(
  items: readonly BusinessStatusSummaryItem[]
): BusinessStatusSummaryItem[] {
  return items.map((item) => ({
    label: item.label.trim(),
    value: item.value.trim() || "-",
    tone: item.tone ?? "default"
  }));
}
```

Create `business-status-summary.config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeBusinessStatusSummaryItems } from "./business-status-summary.config";

describe("normalizeBusinessStatusSummaryItems", () => {
  it("normalizes blank values and default tone", () => {
    expect(normalizeBusinessStatusSummaryItems([{ label: " 当前状态 ", value: " " }])).toEqual([
      { label: "当前状态", value: "-", tone: "default" }
    ]);
  });
});
```

- [ ] **Step 2: Add `BusinessStatusSummary.vue`**

Create the component:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { normalizeBusinessStatusSummaryItems, type BusinessStatusSummaryItem } from "./business-status-summary.config";

const props = defineProps<{
  items: BusinessStatusSummaryItem[];
}>();

const normalizedItems = computed(() => normalizeBusinessStatusSummaryItems(props.items));
</script>

<template>
  <t-card class="business-status-summary" bordered>
    <div class="business-status-summary__item" v-for="item in normalizedItems" :key="item.label">
      <span class="business-status-summary__label">{{ item.label }}</span>
      <t-tag :theme="item.tone" variant="light">{{ item.value }}</t-tag>
    </div>
  </t-card>
</template>

<style scoped>
.business-status-summary {
  background: var(--jg-color-bg-panel);
}

.business-status-summary :deep(.t-card__body) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--jg-space-md);
  padding: var(--jg-space-md);
}

.business-status-summary__item {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-xs);
}

.business-status-summary__label {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}
</style>
```

- [ ] **Step 3: Add `BusinessTableToolbar` config and component**

Create `business-table-toolbar.config.ts`:

```typescript
export function hasActiveToolbarFilters(filters: Record<string, unknown>) {
  return Object.values(filters).some((value) => String(value ?? "").trim().length > 0);
}
```

Create `business-table-toolbar.config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hasActiveToolbarFilters } from "./business-table-toolbar.config";

describe("hasActiveToolbarFilters", () => {
  it("detects whether a toolbar has active filters", () => {
    expect(hasActiveToolbarFilters({ keyword: "", status: undefined })).toBe(false);
    expect(hasActiveToolbarFilters({ keyword: "合同", status: "" })).toBe(true);
  });
});
```

Create `BusinessTableToolbar.vue`:

```vue
<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <t-card class="business-table-toolbar" bordered>
    <div class="business-table-toolbar__header">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="business-table-toolbar__actions">
        <slot name="actions" />
      </div>
    </div>
    <div class="business-table-toolbar__filters">
      <slot />
    </div>
  </t-card>
</template>

<style scoped>
.business-table-toolbar {
  background: var(--jg-color-bg-panel);
}

.business-table-toolbar__header {
  display: flex;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.business-table-toolbar__header h2 {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.business-table-toolbar__header p {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.business-table-toolbar__actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
}

.business-table-toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-md);
}
</style>
```

- [ ] **Step 4: Add `EmptyBusinessState` config and component**

Create `empty-business-state.config.ts`:

```typescript
export interface EmptyBusinessStateAction {
  label: string;
  to?: string;
}

export function normalizeEmptyBusinessStateActions(
  actions: readonly EmptyBusinessStateAction[]
): EmptyBusinessStateAction[] {
  return actions.filter((action) => action.label.trim().length > 0);
}
```

Create `empty-business-state.config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeEmptyBusinessStateActions } from "./empty-business-state.config";

describe("normalizeEmptyBusinessStateActions", () => {
  it("removes blank actions", () => {
    expect(normalizeEmptyBusinessStateActions([{ label: "" }, { label: "新建合同", to: "/contracts/workbench" }])).toEqual([
      { label: "新建合同", to: "/contracts/workbench" }
    ]);
  });
});
```

Create `EmptyBusinessState.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { normalizeEmptyBusinessStateActions, type EmptyBusinessStateAction } from "./empty-business-state.config";

const props = defineProps<{
  title: string;
  description: string;
  actions?: EmptyBusinessStateAction[];
}>();

const visibleActions = computed(() => normalizeEmptyBusinessStateActions(props.actions ?? []));
</script>

<template>
  <t-card class="empty-business-state" bordered>
    <t-empty :title="title" :description="description">
      <template #actions>
        <t-space v-if="visibleActions.length">
          <router-link v-for="action in visibleActions" :key="action.label" :to="action.to ?? '/'">
            <t-button variant="outline">{{ action.label }}</t-button>
          </router-link>
        </t-space>
      </template>
    </t-empty>
  </t-card>
</template>

<style scoped>
.empty-business-state {
  background: var(--jg-color-bg-panel);
}
</style>
```

- [ ] **Step 5: Run component tests**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- --run src/components/business-status-summary.config.test.ts src/components/business-table-toolbar.config.test.ts src/components/empty-business-state.config.test.ts
```

Expected: all new tests pass.

- [ ] **Step 6: Run package verification**

Run:

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/src/components
git commit -m "feat: add shared web admin business ui components"
```

---

### Task 4: Contract Ledger List Sample

**Files:**
- Modify: `apps/web-admin/src/pages/contracts/ContractListPage.vue`
- Test: `apps/web-admin/src/pages/contracts/contract-list.config.test.ts`

**Interfaces:**
- Consumes: `BusinessTableToolbar`, `EmptyBusinessState`, `contractFilterFields`, `contractLedgerColumns`, `filterContractLedgerRows`.
- Produces: list-page sample pattern for settlement/payment/archive ledgers.

- [ ] **Step 1: Inspect current `ContractListPage.vue` imports and template**

Keep existing data loading and route behavior. Add imports only for the new shared components:

```typescript
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
```

- [ ] **Step 2: Replace custom toolbar shell with `BusinessTableToolbar`**

Wrap the existing filter controls:

```vue
<BusinessTableToolbar title="合同台账" description="查看合同状态、责任人、停留时长和下一步动作">
  <template #actions>
    <router-link to="/contracts/workbench">
      <t-button theme="primary">新建合同</t-button>
    </router-link>
  </template>

  <t-form layout="inline" label-align="top" class="ledger-filter-form">
    <!-- keep existing filters, but use TDesign form/select/input controls -->
  </t-form>
</BusinessTableToolbar>
```

- [ ] **Step 3: Use `EmptyBusinessState` for empty rows**

Use the TDesign table empty slot:

```vue
<template #empty>
  <EmptyBusinessState
    title="暂无合同"
    description="当前筛选条件下没有合同记录。可以调整筛选，或由合同人员新建合同。"
    :actions="[{ label: '新建合同', to: '/contracts/workbench' }]"
  />
</template>
```

- [ ] **Step 4: Replace touched CSS with token usage**

In touched selectors, use only token values:

```css
.contract-list-page {
  background: var(--jg-color-bg-page);
  color: var(--jg-color-text-secondary);
}

.ledger-filter-form {
  gap: var(--jg-space-md);
}
```

- [ ] **Step 5: Run list tests**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- --run src/pages/contracts/contract-list.config.test.ts src/components/business-table-toolbar.config.test.ts src/components/empty-business-state.config.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Run package verification**

Run:

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/src/pages/contracts/ContractListPage.vue apps/web-admin/src/components
git commit -m "feat: standardize contract ledger ui sample"
```

---

### Task 5: Contract Detail Sample

**Files:**
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-detail.config.ts`
- Test: `apps/web-admin/src/pages/contracts/contract-detail.config.test.ts`

**Interfaces:**
- Consumes: `BusinessStatusSummary`, `buildContractFlowSummary`.
- Produces: detail-page sample pattern for settlement and payment details.

- [ ] **Step 1: Import `BusinessStatusSummary`**

In `ContractDetailPage.vue`:

```typescript
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
```

- [ ] **Step 2: Render the summary with existing config output**

Use the existing `buildContractFlowSummary` data:

```vue
<BusinessStatusSummary :items="flowSummaryItems" />
```

Keep existing `flowSummaryItems` computed or create one if the page currently inlines summary data:

```typescript
const flowSummaryItems = computed(() => buildContractFlowSummary(contractDetailMeta, contractBaseInfo));
```

- [ ] **Step 3: Remove duplicate local summary markup**

Delete the local summary card markup that duplicates the new component. Keep business sections, tables, timelines, evidence files, and actions unchanged.

- [ ] **Step 4: Tokenize touched CSS**

Touched selectors must use token variables:

```css
.contract-detail-page {
  background: var(--jg-color-bg-page);
}

.detail-section {
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-md);
}
```

- [ ] **Step 5: Run detail tests**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- --run src/pages/contracts/contract-detail.config.test.ts src/components/business-status-summary.config.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Run package verification**

Run:

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/src/pages/contracts/ContractDetailPage.vue apps/web-admin/src/pages/contracts/contract-detail.config.ts apps/web-admin/src/components
git commit -m "feat: standardize contract detail summary ui"
```

---

### Task 6: Contract Template Configuration Sample

**Files:**
- Modify: `apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue`
- Modify: `apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue`
- Test: `apps/web-admin/src/pages/contract-templates/contract-template.config.test.ts`

**Interfaces:**
- Consumes: TDesign tabs, cards, table, buttons, and token rules.
- Produces: configuration-page sample pattern for standard clauses, number rules, and layout templates.

- [ ] **Step 1: Ensure mode switching uses TDesign tabs or radio group**

In `ContractTemplateListPage.vue`, use a TDesign control:

```vue
<t-tabs v-model="mode">
  <t-tab-panel value="use" label="使用模式" />
  <t-tab-panel v-if="canConfigureTemplates" value="config" label="配置模式" />
</t-tabs>
```

If the page already uses another TDesign mode control, keep it and do not churn.

- [ ] **Step 2: Keep published template cards based on TDesign**

Template cards should use `t-card`, `t-tag`, `t-button`, and `t-space`:

```vue
<t-card v-for="template in publishedTemplates" :key="template.id" class="template-card" bordered>
  <template #title>{{ template.name }}</template>
  <t-space>
    <t-tag theme="success" variant="light">已发布</t-tag>
    <t-tag variant="light">{{ template.contractTypeLabel }}</t-tag>
  </t-space>
  <template #actions>
    <t-button theme="primary" @click="startContractFromTemplate(template)">用此模板建合同</t-button>
  </template>
</t-card>
```

- [ ] **Step 3: Keep configuration actions behind role gating**

Keep the existing `canConfigureTemplates` behavior:

```typescript
const TEMPLATE_CONFIG_ROLE_KEYS = new Set(["contract_director", "super_admin"]);
```

Do not show configuration entry points to users without those roles.

- [ ] **Step 4: Replace touched CSS with tokens**

Use:

```css
.template-card {
  background: var(--jg-color-bg-panel);
  border-color: var(--jg-color-border);
  border-radius: var(--jg-radius-md);
}
```

- [ ] **Step 5: Check `ContractNumberRulePage.vue` touched controls**

Keep token buttons as TDesign:

```vue
<t-button v-for="token in tokens" :key="token.value" size="small" variant="outline">
  {{ token.label }}
</t-button>
```

- [ ] **Step 6: Run template tests**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- --run src/pages/contract-templates/contract-template.config.test.ts
```

Expected: tests pass.

- [ ] **Step 7: Run package verification**

Run:

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 8: Commit**

```bash
git add apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
git commit -m "feat: standardize contract template ui sample"
```

---

### Task 7: Governance Documentation And Final Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/design/web-admin-v2-enterprise-ui.md`
- Modify: `docs/design/建工智管_企业流程系统前端改造方案_20260707.md`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: completed tasks 1 through 6.
- Produces: project-level frontend UI governance rules and progress record.

- [ ] **Step 1: Add the frontend UI governance constitution to `AGENTS.md`**

Add this section under the existing project rules:

```markdown
## Frontend UI Governance

- Web Admin uses Vue 3 + TypeScript + TDesign Vue Next.
- TDesign is the only base UI component library.
- Base UI controls must use TDesign first: buttons, inputs, selects, tables, dialogs, drawers, tags, tabs, cards, alerts, messages, upload controls, and forms.
- If similar UI structure appears more than twice, extract a reusable component before adding a third copy.
- Business components must compose TDesign and `--jg-*` design tokens; they must not create a second visual system.
- Colors, font sizes, spacing, radii, shadows, and layout dimensions must come from project design tokens or TDesign variables.
- Pages live in `apps/web-admin/src/pages/<domain>/`.
- Domain-only components live in `apps/web-admin/src/pages/<domain>/components/`.
- Cross-domain reusable components live in `apps/web-admin/src/components/`.
- API calls live in `apps/web-admin/src/api/<domain>.api.ts`; pages must not call `fetch` directly.
- Pure helpers live in `apps/web-admin/src/lib/` or the nearest existing helper module.
```

- [ ] **Step 2: Update design docs**

In `docs/design/web-admin-v2-enterprise-ui.md`, add a short section:

```markdown
## 2026-07-09 UI 治理基线

Web Admin V2 统一采用 TDesign Vue Next、项目级 `--jg-*` 设计 token、可复用业务组件和 `check:ui` 自动检查。第一批样板为合同台账、合同详情和合同模板库。
```

In `docs/design/建工智管_企业流程系统前端改造方案_20260707.md`, add the same governance baseline under the existing Web Admin V2 / design token area.

- [ ] **Step 3: Update `PROGRESS.md`**

Add a newest change entry:

```markdown
- 2026-07-09 (CodeX)：确认并开始落地 Web Admin UI 治理基线：TDesign 作为唯一基础组件库，新增项目级 token 命名、`check:ui` 自动检查、合同台账/合同详情/合同模板库三类样板和同类 UI 第三次出现前必须抽象的 agent 宪法。验证：Web 组件 Vitest、Web typecheck、Web lint、Web build、`check:ui`、`git diff --check` 通过。
```

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- --run src/components/business-status-summary.config.test.ts src/components/business-table-toolbar.config.test.ts src/components/empty-business-state.config.test.ts src/pages/contracts/contract-list.config.test.ts src/pages/contracts/contract-detail.config.test.ts src/pages/contract-templates/contract-template.config.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

Expected: all commands exit `0`. Vite may print an existing large chunk warning; that warning is acceptable only if the build exits `0`.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/design/web-admin-v2-enterprise-ui.md docs/design/建工智管_企业流程系统前端改造方案_20260707.md PROGRESS.md
git commit -m "docs: record web admin ui governance baseline"
```

---

## Execution Notes

- Run tasks in order. Later tasks depend on tokens and the checker from earlier tasks.
- Keep `.superpowers/` untracked unless the user explicitly asks to commit local superpowers state.
- Prefer the smallest diff that satisfies each task.
- Do not remove existing page behavior while replacing UI shells.
- If `check:ui` catches an old page unrelated to the current task, add it to the centralized migration allowlist and record the module for later cleanup.
- If a TDesign component cannot cover an existing native control, add a narrow `ui-rules-ignore` explanation and keep the exception visible.
