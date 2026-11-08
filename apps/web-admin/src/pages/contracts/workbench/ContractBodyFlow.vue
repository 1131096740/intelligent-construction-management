<template>
  <template v-for="(node, nodeIndex) in nodes" :key="node.kind === 'paragraph' ? node.paragraphId : `table-${nodeIndex}`">
    <div v-if="node.kind === 'paragraph' && blocks[node.paragraphId]" class="body-paragraph" :style="paragraphStyle(blocks[node.paragraphId])">
      <label v-if="blocks[node.paragraphId].editable && !insideTable" class="body-edit-label">
        <span class="body-input-label">编辑普通条款{{ paragraphNumbers[node.paragraphId] }}</span>
        <t-textarea
          :model-value="blocks[node.paragraphId].text"
          :readonly="disabled"
          :autosize="{ minRows: 1, maxRows: 24 }"
          @update:model-value="emit('edit', node.paragraphId, String($event))"
        />
      </label>
      <p v-else>{{ blocks[node.paragraphId].text || '\u00a0' }}</p>
      <p
        v-if="blocks[node.paragraphId].editable && blocks[node.paragraphId].blankFields.length"
        class="body-blank-note"
        role="note"
      >
        正文空位：{{ blocks[node.paragraphId].blankFields.join("、") }}
      </p>
      <template v-if="!insideTable && paragraphMoves?.[node.paragraphId]">
        <t-button
          variant="outline"
          :disabled="disabled || movingDisabled || !paragraphMoves[node.paragraphId].up"
          @click="emit('move', node.paragraphId, -1)"
        >
          上移条款
        </t-button>
        <t-button
          variant="outline"
          :disabled="disabled || movingDisabled || !paragraphMoves[node.paragraphId].down"
          @click="emit('move', node.paragraphId, 1)"
        >
          下移条款
        </t-button>
      </template>
      <t-button
        v-if="!insideTable && (removableSourceIds?.includes(node.paragraphId) || anchoredSourceIds?.includes(node.paragraphId))"
        variant="outline"
        :disabled="disabled || deletionDisabled || anchoredSourceIds?.includes(node.paragraphId)"
        @click="emit('delete-source', node.paragraphId)"
      >
        删除普通条款
      </t-button>
      <p v-if="!insideTable && anchoredSourceIds?.includes(node.paragraphId)" class="body-blank-note" role="note">此条款后有新增条款，请先处理新增条款，再删除原条款。</p>
      <t-button
        v-if="!insideTable && removableAdditionIds?.includes(node.paragraphId)"
        variant="outline"
        :disabled="disabled || deletionDisabled"
        @click="emit('delete-addition', node.paragraphId)"
      >
        删除新增条款
      </t-button>
    </div>
    <div v-else-if="node.kind === 'table'" class="body-table-section">
      <div v-if="editableTableParagraphs(node).length" class="body-table-toolbar">
        <t-button variant="outline" :disabled="disabled" @click="emit('edit-table', editableTableParagraphs(node))">编辑表格文字</t-button>
      </div>
      <div class="body-table-scroll" role="region" aria-label="合同正文表格" tabindex="0">
      <t-table
        class="body-source-table"
        :style="sourceTableStyle(node)"
        row-key="rowIndex"
        :data="tableData(node)"
        :columns="tableColumns(node)"
        :show-header="false"
        :hover="false"
        :bordered="true"
        table-layout="fixed"
        :rowspan-and-colspan="tableSpanFor(node)"
      >
        <template #wordCell="{ row, col }">
          <ContractBodyFlow :nodes="cellFlow(row, col.colKey)" :blocks="blocks" :paragraph-numbers="paragraphNumbers" :disabled="disabled" :inside-table="true" @edit="(id, text) => emit('edit', id, text)" @edit-table="ids => emit('edit-table', ids)" />
        </template>
      </t-table>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import type { ContractBodyFlowNode, ContractBodyParagraph } from "../../../api/contract-workbench.api";

const props = defineProps<{
  nodes: ContractBodyFlowNode[];
  blocks: Record<string, ContractBodyParagraph>;
  paragraphNumbers: Record<string, number>;
  disabled: boolean;
  insideTable?: boolean;
  removableAdditionIds?: string[];
  removableSourceIds?: string[];
  anchoredSourceIds?: string[];
  deletionDisabled?: boolean;
  paragraphMoves?: Record<string, { up: boolean; down: boolean }>;
  movingDisabled?: boolean;
}>();
const emit = defineEmits<{
  (event: "edit", id: string, text: string): void;
  (event: "edit-table", ids: string[]): void;
  (event: "delete-addition", id: string): void;
  (event: "delete-source", id: string): void;
  (event: "move", id: string, direction: -1 | 1): void;
}>();

function editableTableParagraphs(node: ContractBodyFlowNode): string[] {
  if (node.kind === "paragraph") return props.blocks[node.paragraphId]?.editable ? [node.paragraphId] : [];
  return node.rows.flatMap(row => row.cells.flatMap(cell => cell.flow.flatMap(editableTableParagraphs)));
}

function paragraphStyle(block: ContractBodyParagraph): CSSProperties {
  const align = ["left", "right", "center", "justify"].includes(block.format.align) ? block.format.align : "left";
  return { fontFamily: block.format.fontFamily, fontSize: `${Math.max(16, (block.format.fontSizePt ?? 12) * 4 / 3)}px`,
    fontWeight: block.format.bold ? "700" : "400", textAlign: align as CSSProperties["textAlign"] };
}

function tableCells(table: Extract<ContractBodyFlowNode, { kind: "table" }>, rowIndex: number) {
  let column = 0;
  return table.rows[rowIndex].cells.flatMap(cell => {
    const start = column;
    column += cell.columnSpan;
    if (cell.verticalMerge === "continue") return [];
    let rowSpan = 1;
    if (cell.verticalMerge === "restart") {
      for (let index = rowIndex + 1; index < table.rows.length; index++) {
        let nextColumn = 0;
        const continued = table.rows[index].cells.find(next => { const matches = nextColumn === start; nextColumn += next.columnSpan; return matches; });
        if (continued?.verticalMerge !== "continue" || continued.columnSpan !== cell.columnSpan) break;
        rowSpan++;
      }
    }
    return [{ ...cell, column: start, rowSpan }];
  });
}

function tableData(table: Extract<ContractBodyFlowNode, { kind: "table" }>) {
  return table.rows.map((_row, index) => ({ rowIndex: index,
    cells: Object.fromEntries(tableCells(table, index).map(cell => [`c${cell.column}`, cell])) }));
}

function tableColumns(table: Extract<ContractBodyFlowNode, { kind: "table" }>) {
  const count = Math.max(table.columns.length, ...table.rows.map(row => row.cells.reduce((sum, cell) => sum + cell.columnSpan, 0)));
  const total = table.columns.reduce((sum, width) => sum + width, 0);
  return Array.from({ length: count }, (_, index) => ({ colKey: `c${index}`, title: "", cell: "wordCell",
    width: `${total ? (table.columns[index] ?? 0) / total * 100 : 100 / count}%` }));
}

function sourceTableStyle(table: Extract<ContractBodyFlowNode, { kind: "table" }>): CSSProperties {
  // OOXML grid widths are twips: 20/point, 72 points/inch, 96 CSS pixels/inch.
  // Keep the original relative grid and allow only the local table to scroll.
  return { minWidth: `${Math.max(440, table.columns.reduce((sum, width) => sum + width, 0) / 15)}px` };
}

function tableSpan(table: ContractBodyFlowNode, rowIndex: number, colIndex: number) {
  if (table.kind !== "table") return {};
  const cell = tableCells(table, rowIndex).find(value => value.column === colIndex);
  return cell ? { rowspan: cell.rowSpan, colspan: cell.columnSpan } : {};
}

function tableSpanFor(table: ContractBodyFlowNode) {
  return ({ rowIndex, colIndex }: { rowIndex: number; colIndex: number }) => tableSpan(table, rowIndex, colIndex);
}

function cellFlow(row: unknown, key: unknown): ContractBodyFlowNode[] {
  return (row as ReturnType<typeof tableData>[number]).cells[String(key)]?.flow ?? [];
}
</script>

<style scoped>
.body-paragraph { min-width: 0; line-height: 1.7; overflow-wrap: anywhere; margin: var(--jg-space-sm) 0; }
.body-paragraph p { margin: 0; white-space: pre-wrap; }
.body-edit-label { display: block; font: inherit; }
.body-edit-label :deep(.t-textarea) { font: inherit; }
.body-input-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.body-edit-label :deep(.t-textarea__inner) { font: inherit; line-height: 1.7; min-height: 40px; resize: vertical; color: var(--jg-text-main); }
.body-table-scroll { overflow-x: auto; max-width: 100%; margin: var(--jg-space-md) 0; }
.body-source-table { width: 100%; }
.body-source-table :deep(table) { min-width: 440px; }
.body-source-table :deep(td) { padding: var(--jg-space-sm); vertical-align: top; }
.body-table-toolbar { margin-bottom: var(--jg-space-sm); }
</style>
