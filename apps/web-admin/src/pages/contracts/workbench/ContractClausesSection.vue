<template>
  <div class="workbench-section">
    <h2 class="section-title">
      合同条款
    </h2>

    <p
      v-if="model.clauses.length === 0"
      class="empty"
    >
      当前合同模板未定义条款。
    </p>

    <div
      v-for="clause in model.clauses"
      v-else
      :key="clause.key"
      class="clause-item"
      :data-field-key="clause.key"
    >
      <div class="clause-head">
        <label class="field title-field">
          <span class="field-label">
            条款标题
            <em
              v-if="clause.required"
              class="required"
            >*</em>
          </span>
          <t-input
            :model-value="clause.title"
            :disabled="clauseDisabled(clause.key)"
            :data-testid="`clause-title-${clause.key}`"
            @update:model-value="updateClauseTitle(clause.key, String($event))"
          />
        </label>

        <label class="field mode-field">
          <span class="field-label">编号方式</span>
          <t-select
            :value="clause.numberingMode"
            :options="numberingOptions"
            :disabled="clauseDisabled(clause.key)"
            :data-testid="`clause-numbering-${clause.key}`"
            @change="updateClauseNumberingMode(clause.key, $event)"
          />
        </label>
      </div>

      <div class="badges">
        <t-tag
          v-if="clause.required"
          size="small"
          theme="danger"
          variant="light"
        >
          必填
        </t-tag>
        <t-tag
          v-if="clause.standardClauseVersionId"
          size="small"
          theme="primary"
          variant="light"
        >
          {{ standardClauseLabel(clause) }}
        </t-tag>
        <t-tag
          v-if="isDeviated(clause)"
          size="small"
          theme="warning"
          variant="light"
        >
          已偏离标准条款
        </t-tag>
        <t-tag
          v-for="item in readinessFor(clause.key)"
          :key="`${item.level}-${item.message}`"
          size="small"
          :theme="item.level === 'blocking' ? 'danger' : 'warning'"
          variant="light"
        >
          {{ item.message }}
        </t-tag>
      </div>

      <div class="library-row">
        <t-select
          :value="selectedClauseIds[clause.key] ?? ''"
          :options="standardClauseOptionsFor(clause)"
          :disabled="clauseDisabled(clause.key) || libraryBusy"
          :data-testid="`clause-standard-${clause.key}`"
          placeholder="选择已发布标准条款"
          @change="(value: string) => selectStandardClause(clause.key, value)"
        />
      </div>

      <div class="content-editor">
        <span class="field-label">条款正文</span>
        <div
          v-for="(block, index) in clauseDocument(clause.content).blocks"
          :key="index"
          class="content-block"
        >
          <template v-if="block.type === 'paragraph'">
            <div class="inline-tools">
              <label><input
                type="checkbox"
                :checked="block.bold"
                :disabled="clauseDisabled(clause.key)"
                @change="updateParagraphMark(clause.key, index, 'bold', $event)"
              > 加粗</label>
              <label><input
                type="checkbox"
                :checked="block.italic"
                :disabled="clauseDisabled(clause.key)"
                @change="updateParagraphMark(clause.key, index, 'italic', $event)"
              > 斜体</label>
            </div>
            <t-textarea
              :model-value="block.text"
              :disabled="clauseDisabled(clause.key)"
              :autosize="{ minRows: 2, maxRows: 5 }"
              :data-testid="`clause-paragraph-${clause.key}-${index}`"
              @update:model-value="updateParagraphText(clause.key, index, String($event))"
            />
          </template>

          <template v-else-if="block.type === 'list'">
            <t-textarea
              :model-value="block.items.join('\n')"
              :disabled="clauseDisabled(clause.key)"
              :autosize="{ minRows: 2, maxRows: 5 }"
              :data-testid="`clause-list-${clause.key}-${index}`"
              @update:model-value="updateListItems(clause.key, index, String($event))"
            />
          </template>

          <table
            v-else
            class="mini-table"
          >
            <tbody>
              <tr
                v-for="(row, rowIndex) in block.rows"
                :key="rowIndex"
              >
                <td
                  v-for="(cell, cellIndex) in row"
                  :key="cellIndex"
                >
                  <t-input
                    :model-value="cell"
                    :disabled="clauseDisabled(clause.key)"
                    :data-testid="`clause-table-${clause.key}-${index}-${rowIndex}-${cellIndex}`"
                    @update:model-value="updateTableCell(clause.key, index, rowIndex, cellIndex, String($event))"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <button
            type="button"
            class="link-button"
            :disabled="clauseDisabled(clause.key)"
            @click="removeBlock(clause.key, index)"
          >
            删除块
          </button>
        </div>
        <div class="block-actions">
          <button
            type="button"
            :disabled="clauseDisabled(clause.key)"
            @click="addBlock(clause.key, 'paragraph')"
          >
            段落
          </button>
          <button
            type="button"
            :disabled="clauseDisabled(clause.key)"
            @click="addBlock(clause.key, 'list')"
          >
            列表
          </button>
          <button
            type="button"
            :disabled="clauseDisabled(clause.key)"
            @click="addBlock(clause.key, 'table')"
          >
            小表格
          </button>
        </div>
      </div>
    </div>

    <SensitiveActionDialog
      v-model="replacementVisible"
      title="确认替换标准条款"
      description="当前标题和正文将被覆盖，请确认是否继续。"
      confirm-text="确认替换"
      @confirm="confirmStandardReplacement"
      @cancel="cancelStandardReplacement"
    />

    <p
      v-if="message"
      class="message"
    >
      {{ message }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { ContractClauseDefinition } from "@jiangkong/shared-domain";
import { computed, onMounted, onServerPrefetch, ref, watch } from "vue";
import {
  listPublishedStandardClauses,
  type PublishedStandardClause
} from "../../../api/contract-workbench.api";
import SensitiveActionDialog from "../../../components/SensitiveActionDialog.vue";
import {
  clauseDocumentText,
  clauseReadinessMessages,
  normalizeClauseDocument,
  type ClauseBlock,
  type ClauseDocument
} from "./contract-bill-editor";
import {
  applyPublishedStandardClause,
  withClauseDeviation
} from "./contract-clause-editing";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  disabled: boolean;
  editableKeys?: string[];
  readiness?: unknown;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();

function clauseDisabled(key: string) {
  return props.disabled || (props.editableKeys !== undefined && !props.editableKeys.includes(key));
}

const numberingOptions = [
  { label: "自动编号", value: "automatic" },
  { label: "固定编号", value: "fixed" }
];
const standardClauses = ref<PublishedStandardClause[]>([]);
const selectedClauseIds = ref<Record<string, string>>({});
const libraryBusy = ref(false);
const message = ref("");
const replacementVisible = ref(false);
const pendingReplacement = ref<{
  key: string;
  source: PublishedStandardClause;
} | null>(null);

const publishedStandardClauseOptions = computed(() => {
  const seenVersionIds = new Set<string>();
  return standardClauses.value.flatMap((clause) => {
    if (seenVersionIds.has(clause.standardClauseVersionId)) {
      return [];
    }
    seenVersionIds.add(clause.standardClauseVersionId);
    return [{
      label: `${clause.name || clause.title || clause.code} v${clause.versionNo}`,
      value: clause.standardClauseVersionId
    }];
  });
});

onMounted(loadStandardClauses);
onServerPrefetch(loadStandardClauses);

watch(
  () =>
    props.model.clauses.map((clause) => ({
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

function updateClause(key: string, patch: Partial<ContractClauseDefinition>) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  replaceClause({ ...clause, ...patch });
}

function standardClauseOptionsFor(clause: ContractClauseDefinition) {
  const options = [...publishedStandardClauseOptions.value];
  const savedVersionId = clause.standardClauseVersionId;
  if (
    savedVersionId &&
    !options.some((option) => option.value === savedVersionId)
  ) {
    options.push({
      label: historicalStandardClauseLabel(clause, savedVersionId),
      value: savedVersionId
    });
  }
  return options;
}

function historicalStandardClauseLabel(
  clause: ContractClauseDefinition,
  savedVersionId: string
): string {
  const content = clauseContentRecord(clause.content);
  const sourceName = readableHistoryLabelPart(
    content["standardClauseSourceName"],
    savedVersionId
  );
  const versionNo = content["standardClauseVersionNo"];
  if (sourceName) {
    return typeof versionNo === "number" && Number.isFinite(versionNo)
      ? `${sourceName} v${versionNo}`
      : `${sourceName}（历史版本）`;
  }
  const title =
    readableHistoryLabelPart(content["standardTitle"], savedVersionId) ||
    readableHistoryLabelPart(clause.title, savedVersionId) ||
    "标准条款";
  return `${title}（历史版本）`;
}

function readableHistoryLabelPart(
  value: unknown,
  savedVersionId: string
): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === savedVersionId ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized
    )
  ) {
    return "";
  }
  return normalized;
}

function replaceClause(nextClause: ContractClauseDefinition) {
  emit("update", {
    clauses: props.model.clauses.map((clause) =>
      clause.key === nextClause.key ? nextClause : clause
    )
  });
}

function updateClauseTitle(key: string, title: string) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  replaceClause(withClauseDeviation(clause, { title }));
}

function updateClauseNumberingMode(key: string, value: unknown) {
  const numberingMode = String(value);
  if (numberingMode !== "automatic" && numberingMode !== "fixed") return;
  updateClause(key, { numberingMode });
}

function clauseDocument(content: unknown): ClauseDocument {
  return normalizeClauseDocument(content);
}

function updateClauseBlocks(key: string, blocks: ClauseBlock[]) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  const text = clauseDocumentText({ text: "", blocks });
  const content = {
    ...clauseContentRecord(clause.content),
    text,
    blocks
  };
  replaceClause(withClauseDeviation(clause, { content }));
}

function updateBlock(
  key: string,
  index: number,
  transform: (block: ClauseBlock) => ClauseBlock | null
) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  const blocks = clauseDocument(clause.content).blocks;
  const currentBlock = blocks[index];
  if (!currentBlock) return;
  const nextBlock = transform(currentBlock);
  if (!nextBlock) return;
  updateClauseBlocks(
    key,
    blocks.map((block, blockIndex) => blockIndex === index ? nextBlock : block)
  );
}

function updateParagraphText(key: string, index: number, value: string) {
  updateBlock(key, index, (block) =>
    block.type === "paragraph" ? { ...block, text: value } : null
  );
}

function updateListItems(key: string, index: number, value: string) {
  updateBlock(key, index, (block) =>
    block.type === "list"
      ? { type: "list", items: value.split("\n") }
      : null
  );
}

function addBlock(key: string, type: ClauseBlock["type"]) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  const blocks = clauseDocument(clause.content).blocks;
  blocks.push(
    type === "paragraph"
      ? { type, text: "" }
      : type === "list"
        ? { type, items: [""] }
        : { type, rows: [["", ""], ["", ""]] }
  );
  updateClauseBlocks(key, blocks);
}

function removeBlock(key: string, index: number) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  const blocks = clauseDocument(clause.content).blocks.filter((_, itemIndex) => itemIndex !== index);
  updateClauseBlocks(key, blocks.length ? blocks : [{ type: "paragraph", text: "" }]);
}

function updateParagraphMark(
  key: string,
  index: number,
  mark: "bold" | "italic",
  event: Event
) {
  const checked = (event.target as HTMLInputElement).checked;
  updateBlock(key, index, (block) =>
    block.type === "paragraph"
      ? { ...block, [mark]: checked }
      : null
  );
}

function updateTableCell(
  key: string,
  index: number,
  rowIndex: number,
  cellIndex: number,
  value: string
) {
  updateBlock(key, index, (block) =>
    block.type === "table"
      ? {
          type: "table",
          rows: block.rows.map((row, currentRowIndex) =>
            currentRowIndex === rowIndex
              ? row.map((cell, currentCellIndex) =>
                  currentCellIndex === cellIndex ? value : cell
                )
              : row
          )
        }
      : null
  );
}

async function loadStandardClauses() {
  libraryBusy.value = true;
  try {
    standardClauses.value = await listPublishedStandardClauses();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "标准条款库加载失败";
  } finally {
    libraryBusy.value = false;
  }
}

function clauseHasUserContent(clause: ContractClauseDefinition): boolean {
  return Boolean(
    clause.title.trim() ||
      clauseDocumentText(normalizeClauseDocument(clause.content)).trim()
  );
}

function selectStandardClause(key: string, selectedId: string) {
  if (clauseDisabled(key)) return;
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

function applyStandardClause(
  key: string,
  source: PublishedStandardClause
) {
  if (
    clauseDisabled(key) ||
    !standardClauses.value.some(
      (item) =>
        item.standardClauseVersionId === source.standardClauseVersionId
    )
  ) {
    return;
  }
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
  if (pending) {
    applyStandardClause(pending.key, pending.source);
  }
  pendingReplacement.value = null;
  replacementVisible.value = false;
}

function cancelStandardReplacement() {
  pendingReplacement.value = null;
  replacementVisible.value = false;
}

function readinessFor(key: string) {
  return clauseReadinessMessages(props.readiness, key);
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  if (Array.isArray(content)) {
    return content.map((item) => contentText(item)).join("\n");
  }
  if (typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record["text"] === "string") {
      return record["text"];
    }
    return Object.values(record).map((item) => contentText(item)).join("\n");
  }
  return String(content);
}

function isDeviated(clause: ContractClauseDefinition): boolean {
  const content = clauseContentRecord(clause.content);
  if (content["deviatedFromStandard"] === true) {
    return true;
  }
  return (
    content["standardContent"] !== undefined &&
    contentText(content["standardContent"]) !== contentText(clause.content)
  );
}

function standardClauseLabel(clause: ContractClauseDefinition): string {
  const content = clauseContentRecord(clause.content);
  const name =
    typeof content["standardClauseSourceName"] === "string"
      ? content["standardClauseSourceName"]
      : "标准条款";
  const versionNo = content["standardClauseVersionNo"];
  return typeof versionNo === "number" ? `${name} v${versionNo}` : name;
}

function clauseContentRecord(content: unknown): Record<string, unknown> {
  return content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
  container-name: contract-clauses;
  container-type: inline-size;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #151922;
}

.empty {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.clause-item {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.clause-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.library-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.field {
  display: grid;
  gap: 8px;
}

.content-editor,
.content-block {
  display: grid;
  gap: 8px;
}

.content-block {
  padding: 10px;
  background: #f7f9fc;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.inline-tools,
.block-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.block-actions button,
.link-button {
  min-height: 26px;
  padding: 0 8px;
  color: #0052d9;
  background: #fff;
  border: 1px solid #b8c7e6;
  border-radius: 3px;
  cursor: pointer;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
}

.mini-table td {
  padding: 4px;
  border: 1px solid #dce1e8;
}

.mini-table input {
  width: 100%;
  min-height: 28px;
  padding: 0 6px;
  border: 1px solid #ccd4df;
  border-radius: 3px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.message {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.required {
  color: #b51d2a;
  font-style: normal;
}

@container contract-clauses (max-width: 620px) {
  .clause-head {
    grid-template-columns: 1fr;
  }

  .library-row {
    grid-template-columns: 1fr;
  }
}
</style>
