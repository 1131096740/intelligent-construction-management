<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Grid, {
  type AfterEditEvent,
  type ColumnDataSchemaModel,
  type Editors,
  type FocusAfterRenderEvent,
  VGridVueEditor,
  TextEditor
} from "@revolist/vue3-datagrid";
import JgBusinessGridSelectEditor from "./JgBusinessGridSelectEditor.vue";
import {
  applyJgBusinessGridEdit,
  expandJgBusinessGridPaste,
  JG_BUSINESS_SEARCH_SELECT_EDITOR,
  parseJgBusinessGridClipboardText,
  resolveJgBusinessGridPasteFocus,
  type JgBusinessGridColumn,
  type JgBusinessGridRow
} from "./jg-business-grid.config";

const props = withDefaults(defineProps<{
  source: JgBusinessGridRow[];
  columns: JgBusinessGridColumn[];
  readonly?: boolean;
  minHeight?: number;
  expandPasteRows?: boolean;
  managedPaste?: boolean;
  rowSelectionKeyboard?: boolean;
}>(), {
  readonly: false,
  minHeight: 240,
  expandPasteRows: false,
  managedPaste: false,
  rowSelectionKeyboard: false
});

const sectionRef = ref<HTMLElement | null>(null);
let revealFrame: number | null = null;
let renderEpoch = 0;
let focusIntent = 0;
let pendingRenderFocus: { cancel: () => void; check: () => void } | null = null;
function afterGridRender() {
  renderEpoch += 1;
  pendingRenderFocus?.check();
}
function revealActiveEditor() {
  if (revealFrame !== null) cancelAnimationFrame(revealFrame);
  revealFrame = requestAnimationFrame(() => {
    revealFrame = null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && sectionRef.value?.contains(active) && active.closest("revogr-edit")) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}
onMounted(() => {
  window.addEventListener("resize", revealActiveEditor);
  window.visualViewport?.addEventListener("resize", revealActiveEditor);
});
onBeforeUnmount(() => {
  focusIntent += 1;
  pendingRenderFocus?.cancel();
  window.removeEventListener("resize", revealActiveEditor);
  window.visualViewport?.removeEventListener("resize", revealActiveEditor);
  if (revealFrame !== null) cancelAnimationFrame(revealFrame);
});

const emit = defineEmits<{
  "update:source": [value: JgBusinessGridRow[]];
  "focus-row": [rowIndex: number];
  "toggle-focused-row": [rowIndex: number];
  "paste-cells": [paste: { rowIndex: number; colIndex: number; cells: string[][] }];
  "editor-input": [state: { pending: boolean; edited: boolean }];
}>();
// RevoGrid's default text editor re-reads editCell.val on every overlay
// render. Keep the live native input value until this edit is committed.
class DraftTextEditor extends TextEditor {
  private inputValue: string | undefined;
  override render(h: Parameters<TextEditor["render"]>[0]) {
    return h("input", {
      type: "text", enterKeyHint: "enter",
      value: this.inputValue ?? this.editCell?.val ?? "",
      ref: (input: HTMLInputElement) => { this.editInput = input; },
      onInput: (event: Event) => { this.inputValue = (event.target as HTMLInputElement).value; },
      onKeyDown: (event: KeyboardEvent) => this.onKeyDown(event)
    });
  }
}
const gridEditors: Editors = {
  "jg-draft-text": DraftTextEditor,
  [JG_BUSINESS_SEARCH_SELECT_EDITOR]: VGridVueEditor(JgBusinessGridSelectEditor)
};
const editorColumns = computed(() => props.columns.map(column => ({ ...column, editor: column.editor ?? "jg-draft-text" })));

interface RevoGridElement extends HTMLElement {
  getSource(): Promise<JgBusinessGridRow[]>;
  getFocused(): Promise<{ model?: JgBusinessGridRow; column?: { prop: unknown }; cell: { x: number; y: number }; rowType: string } | null>;
  scrollToRow(rowIndex: number): Promise<void>;
  scrollToColumnProp(columnProp: string): Promise<void>;
  setCellsFocus(
    start: { x: number; y: number },
    end: { x: number; y: number },
    colType?: string
  ): Promise<void>;
  setCellEdit(rowIndex: number, prop: string): Promise<void>;
}

const gridRef = ref<{ $el?: RevoGridElement } | null>(null);
const focusedCell = ref<{ rowIndex: number; colIndex: number } | null>(null);
const composing = ref(false);
function editorInput(event: Event, edited: boolean) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.closest("revogr-edit") || input.closest(".jg-business-grid-select-editor")) return;
  emit("editor-input", { pending: true, edited });
}
function finishEditorInput() {
  emit("editor-input", { pending: false, edited: false });
}

function updateSource(value: JgBusinessGridRow[]) {
  if (JSON.stringify(value) !== JSON.stringify(props.source)) emit("update:source", value);
}

const unchangedNativeEdits = new WeakSet<object>();
function onBeforeEdit(event: CustomEvent<AfterEditEvent>) {
  const detail = event.detail;
  if ("rowIndex" in detail && typeof detail.rowIndex === "number" && typeof detail.prop === "string" &&
      editable(detail.rowIndex, props.columns.findIndex(column => column.prop === detail.prop)) &&
      String(props.source[detail.rowIndex]?.[detail.prop] ?? "") === String(detail.val ?? "")) {
    unchangedNativeEdits.add(detail);
  }
}
function onAfterEdit(event: CustomEvent<AfterEditEvent>) {
  const detail = event.detail;
  // Native/custom editors may already mutate RevoGrid's source before this
  // event. The domain still needs the committed edit even when values match.
  if (!composing.value) void nextTick(finishEditorInput);
  if (unchangedNativeEdits.has(detail)) return;
  if ("rowIndex" in detail && typeof detail.rowIndex === "number" && typeof detail.prop === "string") {
    if (!editable(detail.rowIndex, props.columns.findIndex(column => column.prop === detail.prop))) return;
    emit("update:source", applyJgBusinessGridEdit(props.source, {
      rowIndex: detail.rowIndex,
      prop: detail.prop,
      val: detail.val
    }));
    return;
  }

  if ("data" in detail && detail.data) {
    const data = Object.fromEntries(Object.entries(detail.data).flatMap(([index, values]) => {
      const rowIndex = Number(index);
      const fields = Object.fromEntries(Object.entries(values as Partial<JgBusinessGridRow>).filter(([prop]) =>
        editable(rowIndex, props.columns.findIndex(column => column.prop === prop))));
      return Object.keys(fields).length ? [[rowIndex, fields]] : [];
    }));
    if (Object.keys(data).length) emit("update:source", applyJgBusinessGridEdit(props.source, { data }));
  }
}

function onAfterFocus(event: CustomEvent<FocusAfterRenderEvent>) {
  if (event.detail.rowType === "rgRow" && Number.isInteger(event.detail.rowIndex)) {
    const group = props.columns.filter(column => (column.pin ?? "rgCol") === event.detail.colType);
    const prop = event.detail.column?.prop ?? group[event.detail.colIndex]?.prop;
    focusedCell.value = {
      rowIndex: event.detail.rowIndex,
      colIndex: props.columns.findIndex(column => column.prop === prop)
    };
    emit("focus-row", event.detail.rowIndex);
  }
}

function editable(rowIndex: number, colIndex: number) {
  const model = props.source[rowIndex];
  const column = props.columns[colIndex];
  if (props.readonly || !model || !column) return false;
  return typeof column.readonly === "function"
    ? !column.readonly({ model, column, prop: column.prop, rowIndex } as ColumnDataSchemaModel)
    : !column.readonly;
}

async function onEditorKeydown(event: KeyboardEvent) {
  if (composing.value || event.isComposing || event.keyCode === 229) {
    event.stopPropagation();
    return;
  }
  const input = event.target;
  if (props.rowSelectionKeyboard && !props.readonly && event.shiftKey && event.key === " " &&
      input instanceof HTMLElement && input.closest('[role="gridcell"]') &&
      !input.closest('input, textarea, select, button, [contenteditable="true"]')) {
    const row = input.closest('[role="gridcell"]')?.getAttribute("data-rgrow");
    const rowIndex = row === null || row === undefined ? -1 : Number(row);
    if (Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < props.source.length) {
      event.preventDefault();
      event.stopPropagation();
      emit("toggle-focused-row", rowIndex);
      return;
    }
  }
  if (!(input instanceof HTMLInputElement) || input.closest(".jg-business-grid-select-editor")) return;
  const editor = input.closest<HTMLElement & { cancelChanges(): Promise<void> }>("revogr-edit");
  const current = focusedCell.value;
  if (!editor || !current || !["Tab", "Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const column = props.columns[current.colIndex];
  if (!column || typeof column.prop !== "string") return;
  if (event.key !== "Escape") {
    updateSource(applyJgBusinessGridEdit(props.source, { rowIndex: current.rowIndex, prop: column.prop, val: input.value }));
  }
  await editor.cancelChanges();
  await nextTick();
  finishEditorInput();
  let rowIndex = current.rowIndex;
  let colIndex = current.colIndex;
  const direction = event.shiftKey ? -1 : 1;
  if (event.key === "Enter") rowIndex += direction;
  if (event.key === "Tab") {
    do {
      colIndex += direction;
      if (colIndex >= props.columns.length) { colIndex = 0; rowIndex += 1; }
      if (colIndex < 0) { colIndex = props.columns.length - 1; rowIndex -= 1; }
    } while (rowIndex >= 0 && rowIndex < props.source.length && !editable(rowIndex, colIndex));
  }
  if (event.key === "Escape" || !editable(rowIndex, colIndex)) {
    await focusCell(current.rowIndex, column.prop);
    return;
  }
  const nextProp = props.columns[colIndex]?.prop;
  if (typeof nextProp === "string") {
    await focusCell(rowIndex, nextProp);
    await gridRef.value?.$el?.setCellEdit(rowIndex, nextProp);
  }
}

async function onPaste(event: ClipboardEvent) {
  if (props.readonly || composing.value || (!props.expandPasteRows && !props.managedPaste)) return;
  const parsed = parseJgBusinessGridClipboardText(event.clipboardData?.getData("text/plain") ?? "");
  if (!parsed) return;
  if (props.managedPaste && (parsed.length > 1 || parsed.some(row => row.length > 1))) {
    // RevoGrid focus is already translated from its pinned column group into
    // this component's fixed column coordinates. Do not shift clipboard values
    // when the domain skips a read-only column.
    const focus = focusedCell.value;
    if (!focus) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target;
    const editor = target instanceof Element
      ? target.closest<HTMLElement & { cancelChanges(): Promise<void> }>("revogr-edit")
      : null;
    if (editor) await editor.cancelChanges();
    emit("paste-cells", { ...focus, cells: parsed });
    emit("editor-input", { pending: false, edited: false });
    return;
  }
  if (!props.expandPasteRows) return;
  const focus = resolveJgBusinessGridPasteFocus(event.composedPath(), focusedCell.value);
  if (!focus) return;
  const expanded = expandJgBusinessGridPaste(props.source, props.columns, focus, parsed);
  if (!expanded) return;
  event.preventDefault();
  updateSource(expanded);
}

function focusRenderedRow(grid: RevoGridElement, rowIndex: number, colIndex: number, colType: string, prop: string, clientKey: string, edit: boolean, intent: number): Promise<boolean> {
  const value = String(props.source[rowIndex]?.[prop] ?? "");
  return new Promise(resolve => {
    let settled = false;
    let lastEpoch = -1;
    let queue = Promise.resolve();
    let stopTarget: (() => void) | undefined;
    const targetCurrent = () => focusIntent === intent && props.source[rowIndex]?.clientRowKey === clientKey && String(props.source[rowIndex]?.[prop] ?? "") === value && (!edit || editable(rowIndex, props.columns.findIndex(column => column.prop === prop)));
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      stopTarget?.();
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      if (pendingRenderFocus === pending) pendingRenderFocus = null;
      resolve(ready);
    };
    const cancel = () => finish(false);
    const focusedMatches = async () => {
      const focused = await grid.getFocused();
      return focused?.rowType === "rgRow" && focused.cell.y === rowIndex && focused.column?.prop === prop && focused.model?.clientRowKey === clientKey && String(focused.model?.[prop] ?? "") === value;
    };
    const attempt = async () => {
      if (settled) return;
      if (!targetCurrent()) { finish(false); return; }
      if (lastEpoch === renderEpoch) return;
      lastEpoch = renderEpoch;
      const source = await grid.getSource();
      if (settled) return;
      if (!targetCurrent()) { finish(false); return; }
      if (source[rowIndex]?.clientRowKey !== clientKey || String(source[rowIndex]?.[prop] ?? "") !== value) return;
      await grid.scrollToRow(rowIndex);
      if (settled || !targetCurrent()) { finish(false); return; }
      await grid.scrollToColumnProp(prop);
      if (settled || !targetCurrent()) { finish(false); return; }
      await grid.setCellsFocus({ x: colIndex, y: rowIndex }, { x: colIndex, y: rowIndex }, colType);
      if (settled || !targetCurrent()) { finish(false); return; }
      // A provider update can precede the viewport's lastCell update. Never
      // open an editor on the different row selected by that old boundary.
      if (!(await focusedMatches())) return;
      if (settled || !targetCurrent()) { finish(false); return; }
      if (edit) await grid.setCellEdit(rowIndex, prop);
      if (settled) return;
      finish(targetCurrent() && await focusedMatches());
    };
    const pending = { cancel, check: () => { queue = queue.then(attempt).catch(() => finish(false)); } };
    stopTarget = watch(() => [props.source[rowIndex]?.clientRowKey, props.source[rowIndex]?.[prop], props.readonly, props.columns], () => { if (!targetCurrent()) cancel(); }, { flush: "sync" });
    // Only a pending intent observes later user actions, and only to cancel
    // itself. Other controls and other grids retain their normal handling.
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    pendingRenderFocus = pending;
    pending.check();
  });
}

async function focusCell(rowIndex: number, columnProp: string, expectedClientKey?: string, edit = false): Promise<boolean> {
  const intent = ++focusIntent;
  pendingRenderFocus?.cancel();
  const grid = gridRef.value?.$el;
  const target = props.columns.find(column => column.prop === columnProp);
  const colType = target?.pin ?? "rgCol";
  const columnIndex = props.columns.filter(column => (column.pin ?? "rgCol") === colType).findIndex(column => column.prop === columnProp);
  if (!grid || columnIndex < 0 || !Number.isInteger(rowIndex) || rowIndex < 0) {
    return false;
  }
  if (expectedClientKey) return focusRenderedRow(grid, rowIndex, columnIndex, colType, columnProp, expectedClientKey, edit, intent);
  try {
    await grid.scrollToRow(rowIndex);
    await grid.scrollToColumnProp(columnProp);
    await grid.setCellsFocus(
      { x: columnIndex, y: rowIndex },
      { x: columnIndex, y: rowIndex },
      colType
    );
    return true;
  } catch {
    return false;
  }
}

async function editCell(rowIndex: number, columnProp: string, expectedClientKey?: string): Promise<boolean> {
  const colIndex = props.columns.findIndex(column => column.prop === columnProp);
  if (!editable(rowIndex, colIndex)) return false;
  if (expectedClientKey) return focusCell(rowIndex, columnProp, expectedClientKey, true);
  if (!(await focusCell(rowIndex, columnProp))) return false;
  await gridRef.value?.$el?.setCellEdit(rowIndex, columnProp);
  return true;
}
defineExpose({ focusCell, editCell });
</script>

<template>
  <section
    ref="sectionRef"
    class="jg-business-grid"
    :style="{ minHeight: `${minHeight}px` }"
    :aria-readonly="readonly"
    @paste.capture="onPaste"
    @keydown.capture="onEditorKeydown"
    @input.capture="editorInput($event, true)"
    @compositionstart.capture="composing = true; editorInput($event, false)"
    @compositionend.capture="composing = false"
  >
    <Grid
      ref="gridRef"
      :columns="editorColumns"
      :editors="gridEditors"
      :source="source"
      :readonly="readonly"
      :can-focus="true"
      :use-clipboard="!readonly"
      :apply-on-close="true"
      @aftergridrender="afterGridRender"
      @beforeedit="onBeforeEdit"
      @afteredit="onAfterEdit"
      @afterfocus="onAfterFocus"
    />
  </section>
</template>

<style scoped>
.jg-business-grid {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-panel);
}

.jg-business-grid :deep(revo-grid) {
  height: 100%;
  min-height: inherit;
  --rgRowBorder: var(--jg-color-border);
  --rgHeaderBackground: var(--jg-color-bg-muted);
  --rgHeaderColor: var(--jg-color-text-secondary);
  --rgCellColor: var(--jg-color-text-primary);
  --rgRowHover: var(--jg-color-bg-muted);
}

@media (max-width: 767px) {
  .jg-business-grid :deep(.mobile-handler) { display: none; }
}
</style>
