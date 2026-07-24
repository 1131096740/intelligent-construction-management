# 合同条款即时入模与保存生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复合同条款未失焦时无法保存和切分区丢失的问题，并落实“首存前仅本地备份、首存成功后普通字段约 1 秒自动保存”的明确生命周期。

**Architecture:** 条款编辑组件通过 `update:model-value` 在每次输入时向页面发送不可变 patch；标准条款选择、来源快照和偏离判断集中到纯函数。`useContractDraft` 继续作为普通草稿字段的唯一持久化协调器，以服务端正式合同编号作为自动保存闸门；清单候选不调用该 composable，因此不会混入普通字段自动保存。

**Tech Stack:** Vue 3、TypeScript、TDesign Vue Next、Vitest fake timers、Playwright、现有合同草稿 API 与浏览器本地恢复副本

---

## 实施边界与文件职责

本计划不修改后端合同草稿存储结构，不创建独立条款表，不修改合同清单保存策略，也不改变合同审批、归档或版本冻结规则。标准条款来源继续保存在现有 clause/draft JSON 结构内。

### 新建文件

- `apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.ts`：标准条款应用、来源快照、偏离重算、正文归一化的纯函数。
- `apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts`：纯函数 TDD。
- `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.ts`：把正式首存、dirty 和保存状态转换为准确中文状态。
- `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts`：保存状态文字纯函数测试。
- `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts`：输入、选择、覆盖确认和取消测试。
- `apps/web-admin/e2e/contract-clause-save-lifecycle.e2e.ts`：未失焦保存、分区往返、首存和自动保存浏览器证据。
- `apps/web-admin/playwright.contract-clause-save.config.ts`：Chromium/WebKit 专用配置。

### 修改文件

- `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue`：所有输入即时 emit；选择标准条款即填充；非空覆盖前确认；展示来源和“已调整”。
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`：首存闸门、1 秒调度、并发复用、本地备份和保存状态。
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`：首存前/后、失败、并发、新输入保留测试。
- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`：右上角保存反馈，不再用无条件 reload 覆盖当前输入；准确展示本地备份/保存中/已保存/失败。
- `PROGRESS.md`：登记实现、测试和真实岗位验收缺口。

## Task 1: 用纯函数冻结标准条款来源和偏离语义

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts`
- Reuse type: `packages/shared-domain/src/contract-workbench.ts`
- Reuse type: `apps/web-admin/src/api/contract-workbench.api.ts`

- [ ] **Step 1: 写失败测试**

测试空条款直接填充，并保留标准 ID、版本、标题、正文快照和来源名称：

```ts
it("copies a published standard clause into an empty contract clause", () => {
  const result = applyPublishedStandardClause(emptyClause, publishedClause);
  expect(result).toMatchObject({
    standardClauseVersionId: publishedClause.standardClauseVersionId,
    title: publishedClause.title,
    content: {
      standardTitle: publishedClause.title,
      standardContent: publishedClause.content,
      standardClauseSourceName: publishedClause.name,
      standardClauseVersionNo: publishedClause.versionNo,
      deviatedFromStandard: false
    }
  });
  expect(clauseDocumentText(result.content)).toBe(clauseDocumentText(publishedClause.content));
});
```

测试标题或正文被修改时为 `true`，完全恢复标准标题和标准正文时重算为 `false`：

```ts
expect(withClauseDeviation(applied, { title: "修改标题" }).content)
  .toMatchObject({ deviatedFromStandard: true });
expect(withClauseDeviation(modified, {
  title: publishedClause.title,
  content: publishedClause.content
}).content).toMatchObject({ deviatedFromStandard: false });
```

测试来源快照是复制值，后续修改 `publishedClause` 不反向改变已应用的合同 clause。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯函数**

定义稳定元数据：

```ts
export type StandardClauseContentMeta = {
  standardTitle?: string;
  standardContent?: unknown;
  standardClauseSourceName?: string;
  standardClauseVersionNo?: number;
  deviatedFromStandard?: boolean;
};
```

完整实现应用和偏离重算：

```ts
export function applyPublishedStandardClause(
  clause: ContractClauseDefinition,
  source: PublishedStandardClause
): ContractClauseDefinition {
  const document = normalizeClauseDocument(structuredClone(source.content));
  return {
    ...clause,
    standardClauseVersionId: source.standardClauseVersionId,
    title: source.title,
    content: {
      ...document,
      standardTitle: source.title,
      standardContent: structuredClone(source.content),
      standardClauseSourceName: source.name || source.title || source.code,
      standardClauseVersionNo: source.versionNo,
      deviatedFromStandard: false
    }
  };
}

export function withClauseDeviation(
  clause: ContractClauseDefinition,
  patch: Partial<Pick<ContractClauseDefinition, "title" | "content">>
): ContractClauseDefinition {
  const next = { ...clause, ...patch };
  const meta = standardClauseMeta(clause.content);
  if (meta.standardContent === undefined) return next;
  const standardTitle = meta.standardTitle ?? clause.title;
  const nextContent = patch.content === undefined ? clause.content : patch.content;
  const nextDocument = normalizeClauseDocument(nextContent);
  const deviatedFromStandard =
    next.title !== standardTitle ||
    clauseDocumentText(nextDocument) !== clauseDocumentText(meta.standardContent);
  return {
    ...next,
    content: {
      ...nextDocument,
      ...meta,
      standardTitle,
      deviatedFromStandard
    }
  };
}

export function standardClauseMeta(content: unknown): StandardClauseContentMeta {
  const record = content && typeof content === "object" && !Array.isArray(content)
    ? content as Record<string, unknown>
    : {};
  return {
    ...(typeof record.standardTitle === "string"
      ? { standardTitle: record.standardTitle }
      : {}),
    ...(record.standardContent === undefined
      ? {}
      : { standardContent: structuredClone(record.standardContent) }),
    ...(typeof record.standardClauseSourceName === "string"
      ? { standardClauseSourceName: record.standardClauseSourceName }
      : {}),
    ...(typeof record.standardClauseVersionNo === "number"
      ? { standardClauseVersionNo: record.standardClauseVersionNo }
      : {}),
    ...(typeof record.deviatedFromStandard === "boolean"
      ? { deviatedFromStandard: record.deviatedFromStandard }
      : {})
  };
}
```

- [ ] **Step 4: 运行纯函数测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交纯函数**

```bash
git add apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.ts apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts
git commit -m "fix: preserve contract clause standard source"
```

## Task 2: 将所有条款输入改为即时受控更新

**Files:**
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts`

- [ ] **Step 1: 写未失焦和分区重挂载失败测试**

用真实父组件 ref 接收 `update`，输入一个字符后不触发 blur/change：

```ts
const wrapper = mountClauseHarness();
await wrapper.get("[data-testid='clause-title-payment']").setValue("新");
expect(wrapper.vm.model.clauses[0].title).toBe("新");
expect(wrapper.emitted("dirty")?.length).toBe(1);

await wrapper.setProps({ visible: false });
await wrapper.setProps({ visible: true });
expect(wrapper.get("[data-testid='clause-title-payment']").element).toHaveValue("新");
```

正文 paragraph、list item、table cell、编号方式都应各有一例即时更新断言。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts
```

Expected: FAIL；标题/正文仍只在 change 或 blur 后进入父模型。

- [ ] **Step 3: 替换标题和块输入事件**

标题改为：

```vue
<t-input
  :model-value="clause.title"
  :disabled="clauseDisabled(clause.key)"
  :data-testid="`clause-title-${clause.key}`"
  @update:model-value="updateClauseTitle(clause.key, String($event))"
/>
```

正文 paragraph 改为：

```vue
<t-textarea
  :model-value="block.text"
  :disabled="clauseDisabled(clause.key)"
  @update:model-value="updateParagraphText(clause.key, blockIndex, String($event))"
/>
```

list item 和 table cell 也改用 `@update:model-value`，helper 接收 value 而不是读取 `event.target`。编号 select 使用：

```vue
@change="updateClause(clause.key, { numbering: String($event) })"
```

`updateClauseTitle` 和 `updateClauseBlocks` 必须调用 `withClauseDeviation`，不能只保留旧 `standardContentMeta`：

```ts
function updateClauseTitle(key: string, title: string) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  replaceClause(withClauseDeviation(clause, { title }));
}

function updateClauseBlocks(key: string, blocks: ClauseBlock[]) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  const content = { text: clauseDocumentText({ text: "", blocks }), blocks };
  replaceClause(withClauseDeviation(clause, { content }));
}

function replaceClause(nextClause: ContractClauseDefinition) {
  emit("update", {
    clauses: props.model.clauses.map((clause) =>
      clause.key === nextClause.key ? nextClause : clause
    )
  });
}
```

- [ ] **Step 4: 运行组件测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交即时入模**

```bash
git add apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts
git commit -m "fix: update contract clauses on every input"
```

## Task 3: 选择标准条款即填充，并保护非空内容

**Files:**
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts`

- [ ] **Step 1: 写直接填充、确认替换和取消失败测试**

```ts
await standardSelect.selectOption("standard-v2");
expect(harness.vm.model.clauses[0]).toMatchObject({
  standardClauseVersionId: "standard-v2",
  title: "付款条款",
  content: expect.objectContaining({ deviatedFromStandard: false })
});
expect(wrapper.find("[data-testid='insert-standard-clause']").exists()).toBe(false);
```

当当前标题或正文非空：

```ts
await standardSelect.selectOption("standard-v3");
expect(wrapper.getComponent(SensitiveActionDialog).props("visible")).toBe(true);
expect(wrapper.text()).toContain("当前标题和正文将被覆盖");
await wrapper.getComponent(SensitiveActionDialog).vm.$emit("cancel");
expect(harness.vm.model.clauses[0]).toEqual(beforeSelection);
expect(standardSelect.element).toHaveValue(previousSelectedId);

await standardSelect.selectOption("standard-v3");
await wrapper.getComponent(SensitiveActionDialog).vm.$emit("confirm");
expect(harness.vm.model.clauses[0].standardClauseVersionId).toBe("standard-v3");
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts
```

Expected: FAIL；当前仍需点击“插入标准条款”，且没有覆盖确认。

- [ ] **Step 3: 实现待确认选择状态**

移除“插入标准条款”按钮。增加：

```ts
const replacementVisible = ref(false);
const pendingReplacement = ref<{ key: string; source: PublishedStandardClause } | null>(null);

function clauseHasUserContent(clause: ContractClauseDefinition) {
  return Boolean(clause.title.trim() || clauseDocumentText(clause.content).trim());
}

function selectStandardClause(key: string, selectedId: string) {
  const clause = props.model.clauses.find((item) => item.key === key);
  const source = standardClauses.value.find(
    (item) => item.standardClauseVersionId === selectedId
  );
  if (!clause || !source) return;
  if (clauseHasUserContent(clause)) {
    pendingReplacement.value = { key, source };
    replacementVisible.value = true;
    return;
  }
  applyStandardClause(key, source);
}

function applyStandardClause(key: string, source: PublishedStandardClause) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  replaceClause(applyPublishedStandardClause(clause, source));
  selectedClauseIds.value = {
    ...selectedClauseIds.value,
    [key]: source.standardClauseVersionId
  };
  message.value = "已填充标准条款，可继续调整。";
}

function confirmStandardReplacement() {
  const pending = pendingReplacement.value;
  if (pending) applyStandardClause(pending.key, pending.source);
  pendingReplacement.value = null;
  replacementVisible.value = false;
}

function cancelStandardReplacement() {
  pendingReplacement.value = null;
  replacementVisible.value = false;
}
```

用 immediate watch 从模型恢复已保存来源：

```ts
watch(
  () => props.model.clauses.map((clause) => ({
    key: clause.key,
    standardClauseVersionId: clause.standardClauseVersionId
  })),
  (clauses) => {
    const next: Record<string, string> = {};
    clauses.forEach((clause) => {
      if (clause.standardClauseVersionId) {
        next[clause.key] = clause.standardClauseVersionId;
      }
    });
    selectedClauseIds.value = next;
  },
  { immediate: true }
);
```

取消时不得写 `selectedClauseIds`，因此选择器继续显示旧来源；确认后才更新选中值和模型。使用 `SensitiveActionDialog` 组合 TDesign，不新增第二套弹窗。

- [ ] **Step 4: 运行组件测试和 UI 检查**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts
pnpm --filter @jiangkong/web-admin check:ui
```

Expected: PASS。

- [ ] **Step 5: 提交标准条款交互**

```bash
git add apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts
git commit -m "fix: confirm contract clause replacement"
```

## Task 4: 用测试冻结首存前不自动请求、首存后自动保存

**Files:**
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`

- [ ] **Step 1: 写首存前失败测试**

使用 fake timers。加载 `contract.code = null` 的工作台，修改 clause 后：

```ts
draft.model.clauses[0].title = "首存前输入";
draft.markDirty();
expect(localStorage.getItem("contract-draft:version-1")).toContain("首存前输入");
expect(draft.formalSaveCompleted.value).toBe(false);

await vi.advanceTimersByTimeAsync(1500);
expect(saveContractDraft).not.toHaveBeenCalled();
expect(draft.saveState.value).toBe("idle");
```

断言离开/重新创建 composable 后可从本地恢复副本还原该内容，但仍不是正式已保存。

- [ ] **Step 2: 写首存成功后失败测试**

```ts
vi.setSystemTime(new Date("2026-07-24T10:00:00.000Z"));
saveContractDraft.mockResolvedValueOnce({ id: "version-1", draftRevision: 2 });
await expect(draft.saveNow()).resolves.toBe(true);
expect(draft.formalSaveCompleted.value).toBe(true);
expect(draft.lastSavedAt.value).toEqual(new Date("2026-07-24T10:00:00.000Z"));

draft.model.clauses[0].title = "首存后输入";
draft.markDirty();
await vi.advanceTimersByTimeAsync(999);
expect(saveContractDraft).toHaveBeenCalledTimes(1);
await vi.advanceTimersByTimeAsync(1);
expect(saveContractDraft).toHaveBeenCalledTimes(2);
```

- [ ] **Step 3: 写并发和新输入保留失败测试**

覆盖：

- 1 秒自动保存请求进行中，点击手动保存只等待同一个 promise；
- 请求发出后用户又输入，旧响应不得清除 dirty 或覆盖新内容；
- 自动保存失败保留模型和 localStorage backup，saveState 为 `failed`；
- `suspendAutosaveForLifecycleAction()` 取消 timer，resume 后只有仍 dirty 才重新调度；
- conflict 状态不继续自动重试。

关键断言：

```ts
expect(saveContractDraft).toHaveBeenCalledTimes(1);
expect(draft.model.clauses[0].title).toBe("请求期间的新输入");
expect(draft.isDirty.value).toBe(true);
expect(draft.saveState.value).not.toBe("saved");
```

- [ ] **Step 4: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
```

Expected: FAIL；当前 `markDirty` 不调度服务端保存，也不暴露正式首存闸门。

## Task 5: 实现普通草稿字段的两段式保存调度

**Files:**
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`

- [ ] **Step 1: 增加正式首存状态和调度常量**

```ts
const AUTOSAVE_DELAY_MS = 1000;
const formalSaveCompleted = ref(false);
const lastSavedAt = ref<Date | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledSave() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function scheduleSave() {
  cancelScheduledSave();
  if (
    !formalSaveCompleted.value ||
    pausedRef.value ||
    !dirtyRef.value ||
    conflict.value !== null
  ) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void saveNow();
  }, AUTOSAVE_DELAY_MS);
}
```

这里的 `dirty` 仅表示 `ContractDraftModel` 普通字段；清单候选必须继续由清单组件单独管理，禁止调用 `markDirty`。

- [ ] **Step 2: 修改 load、markDirty 和 discard**

加载服务端工作台后：

```ts
formalSaveCompleted.value = Boolean(result.contract.code);
lastSavedAt.value = null;
```

`markDirty` 改为：

```ts
function markDirty() {
  editGeneration += 1;
  dirtyRef.value = true;
  if (!activeSave) saveState.value = "idle";
  writeBackup();
  scheduleSave();
}
```

`discardLocalState` 和 composable teardown 均取消 timer；discard 同时把 `formalSaveCompleted` 重置为 `false`、`lastSavedAt` 重置为 null。

- [ ] **Step 3: 首次成功保存后打开闸门**

在 `performSave` 成功拿到服务端 version、更新 revision 后打开首存闸门：

```ts
formalSaveCompleted.value = true;
lastSavedAt.value = new Date();
```

如果保存请求期间又有新输入：

```ts
if (editGeneration !== savingGeneration) {
  dirtyRef.value = true;
  writeBackup();
  scheduleSave();
  return true;
}
```

只有 generation 未变化时才 clear backup、置 dirty false 和 saveState saved。

- [ ] **Step 4: 保留现有串行保存循环并接入调度**

不要把当前 `activeSave + while (dirtyRef.value || activeSave)` 改成一次 promise 的简化实现；该循环负责等待进行中的请求，并在请求期间又有输入时把新一代数据继续保存。只做三处改动：

```ts
async function saveNow(): Promise<boolean> {
  cancelScheduledSave();
  while (dirtyRef.value || activeSave) {
    if (pausedRef.value) return false;
    if (activeSave) {
      const saved = await activeSave;
      if (!saved) return false;
      if (!dirtyRef.value) return true;
      continue;
    }
    const pending = performSave();
    activeSave = pending;
    try {
      if (!await pending) return false;
    } finally {
      if (activeSave === pending) activeSave = null;
    }
  }
  return true;
}
```

失败时不得清模型或 backup。`resumeAutosaveAfterLifecycleAction()` 改为 `pausedRef.value = false; scheduleSave();`，不再通过 `markDirty()` 人为增加 edit generation。

- [ ] **Step 5: 导出状态并运行测试**

`UseContractDraft` 返回值和 return object 加入：

```ts
formalSaveCompleted: Readonly<Ref<boolean>>;
lastSavedAt: Readonly<Ref<Date | null>>;
```

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
```

Expected: PASS，且原有 conflict、backup、checkpoint、save generation 测试仍通过。

- [ ] **Step 6: 提交保存生命周期**

```bash
git add apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
git commit -m "fix: gate contract draft autosave after first save"
```

## Task 6: 让右上角保存始终给出准确反馈且不无条件回读

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`

- [ ] **Step 1: 写页面保存行为失败测试**

先为纯状态函数写测试：

```ts
expect(contractDraftSaveStatusText({
  formalSaveCompleted: false,
  dirty: true,
  saveState: "idle"
})).toBe("本地已备份，尚未正式保存");

expect(contractDraftSaveStatusText({
  formalSaveCompleted: true,
  dirty: false,
  saveState: "saved"
})).toBe("已保存");
```

工作台页面若已有组件 harness，在其中增加无修改保存断言；若没有，则把该行为放进本计划 Task 7 的 Playwright 网络断言，不为了一个按钮引入整页 mock。必须断言：

```ts
await onSave();
expect(loadExpectedWorkbench).not.toHaveBeenCalled();
expect(manualSaveMessage.value).toBe("当前内容已保存");
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts
```

Expected: FAIL，状态 helper 不存在。

- [ ] **Step 3: 实现准确状态文字**

新文件完整实现：

```ts
import type { ContractDraftSaveState } from "./use-contract-draft";

export function contractDraftSaveStatusText(input: {
  formalSaveCompleted: boolean;
  dirty: boolean;
  saveState: ContractDraftSaveState;
}) {
  if (input.saveState === "saving") return "保存中";
  if (input.saveState === "failed") return "保存失败";
  if (input.saveState === "conflict") return "存在保存冲突";
  if (!input.formalSaveCompleted) {
    return input.dirty ? "本地已备份，尚未正式保存" : "未正式保存";
  }
  if (input.dirty) return "有待保存修改";
  return input.saveState === "saved" ? "已保存" : "当前内容已保存";
}
```

页面从 draft 解构 `formalSaveCompleted`，并调用：

```ts
const autosaveLabel = computed(() => contractDraftSaveStatusText({
  formalSaveCompleted: formalSaveCompleted.value,
  dirty: isDirty.value,
  saveState: saveState.value
}));
```

页面另加 `manualSaveMessage`，点击无修改保存后短暂展示“当前内容已保存”。在状态旁显示最近一次成功写入和权威修订号：

```ts
const saveReceiptText = computed(() => {
  if (!formalSaveCompleted.value || lastSavedAt.value === null) return "";
  return `修订 ${savedRevision.value} · ${lastSavedAt.value.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}`;
});
```

加载已有正式合同时 `lastSavedAt` 可以保持 null，直到本页首次成功写入；不得把页面加载时间伪装成保存时间。

- [ ] **Step 4: 移除 `onSave` 的无条件 reload**

```ts
async function onSave() {
  if (writeLocked.value) return;
  errorMessage.value = "";
  const hadDirtyContent = isDirty.value;
  const wasFormallySaved = formalSaveCompleted.value;
  const saved = await saveNow();
  if (!saved) {
    errorMessage.value = saveError.value || "合同草稿未保存成功，已保留当前内容，请重试。";
    return;
  }
  manualSaveMessage.value = hadDirtyContent
    ? "已保存当前合同内容"
    : formalSaveCompleted.value
      ? "当前内容已保存"
      : "当前没有待保存修改，合同尚未正式保存";
  if (!wasFormallySaved && formalSaveCompleted.value && contractId.value) {
    await loadExpectedWorkbench(contractId.value);
  }
}
```

`performSave` 当前只更新草稿 revision，不返回合同主记录，因此仅首次正式保存成功后安全回读一次，用于取得正式合同编号；后续普通手动保存和无修改保存不再额外回读。`saveNow` 返回前已串行落完请求期间的新输入，因此首次回读不会覆盖仍未落库的新一代模型。需要治理动作时，`prepareGovernanceMutation` 仍可在保存成功后显式读取最新工作台，因为那是动作前置一致性要求。

- [ ] **Step 5: 运行条款、draft 和 UI 测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
pnpm --filter @jiangkong/web-admin check:ui
```

Expected: PASS。

- [ ] **Step 6: 提交页面反馈**

```bash
git add apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.ts apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
git commit -m "fix: show contract draft save feedback"
```

## Task 7: 浏览器验证未失焦、分区往返、首存和后续自动保存

**Files:**
- Create: `apps/web-admin/e2e/contract-clause-save-lifecycle.e2e.ts`
- Create: `apps/web-admin/playwright.contract-clause-save.config.ts`

- [ ] **Step 1: 建立 Chromium/WebKit 配置**

```ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: "contract-clause-save-lifecycle.e2e.ts",
  use: { baseURL: "http://127.0.0.1:4189", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: devices["Desktop Safari"] }
  ],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4189",
    port: 4189,
    reuseExistingServer: false
  }
});
```

- [ ] **Step 2: 写首存前浏览器场景**

route mock 返回 `contract.code = null`。测试：

- 输入正文最后一个字符后不 blur；
- 立刻点右上角保存；
- 捕获 PATCH/POST body，断言含该字符；
- 保存前等待 1.5 秒，没有自动保存请求；
- 状态显示“本地已备份，尚未正式保存”；
- 切到清单再返回，内容仍存在。

- [ ] **Step 3: 写标准条款和首存后场景**

测试：

- 空条款选择标准条款立即填充；
- 非空条款选择另一来源时取消，原内容和选择值都不变；
- 再次选择并确认，来源版本更新；
- 修改正文显示“已调整”；
- 首次手动保存响应返回正式编号；
- 再输入一个字符，约 1 秒后只有一次自动保存；
- 自动保存失败时内容仍在，状态为“保存失败”；
- 无修改点击保存不触发 workbench GET reload，显示“当前内容已保存”。

- [ ] **Step 4: 运行双浏览器测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.contract-clause-save.config.ts
```

Expected: Chromium 和 WebKit 全部 PASS。

- [ ] **Step 5: 提交 E2E**

```bash
git add apps/web-admin/e2e/contract-clause-save-lifecycle.e2e.ts apps/web-admin/playwright.contract-clause-save.config.ts
git commit -m "test: cover contract clause save lifecycle"
```

## Task 8: 完成门禁和进度登记

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: 运行 Web 定向与全量门禁**

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-clause-editing.test.ts apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.contract-clause-save.config.ts
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 2: 检查未扩大后端和 Schema**

```bash
git diff --name-only -- services/api packages/shared-domain services/api/prisma
```

Expected: 没有后端、shared-domain 或 Prisma 变更。若现有 clause 类型无法保存来源元数据，先用已允许的 `content` JSON；仍无法满足才停止并重新确认。

- [ ] **Step 3: 更新 `PROGRESS.md`**

记录：

- 未失焦保存和分区往返证据；
- 首存前零自动请求、首存后 1 秒自动保存证据；
- 标准来源/版本和偏离标记；
- 无修改保存不 reload；
- Chromium/WebKit 结果和精确命令；
- 当前 Git SHA；
- 尚缺真实合同员对标准条款覆盖提示和保存状态文案的业务验收；
- 未推送、未部署、未写生产数据。

- [ ] **Step 4: 提交进度**

```bash
git add PROGRESS.md
git commit -m "docs: record contract clause save verification"
```

## 完成定义

只有同时满足以下条件，才能把本计划标记为“本地实现完成”：

- 标题、段落、列表和表格单元格每次输入都即时进入父草稿模型；
- 未失焦立即保存包含最后输入字符；
- 分区切换不会用旧服务端数据覆盖本地条款；
- 选择标准条款即填充，非空覆盖必须确认，取消完整保留原状态；
- 标准 ID、版本、标题和正文快照保留，修改后准确显示“已调整”；
- 首存前只写本地恢复副本，1 秒后不请求服务端、不分配正式编号；
- 首次手动保存成功后，普通字段才启用约 1 秒自动保存；
- 清单候选不进入普通字段 autosave；
- 无修改手动保存有反馈且不 reload；
- 请求期间的新输入、失败和冲突均不丢内容；
- Web 门禁和 Chromium/WebKit E2E 通过；
- `PROGRESS.md` 已随实现提交更新。
