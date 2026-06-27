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
            :value="clause.title"
            :disabled="disabled"
            @change="(value: string) => updateClause(clause.key, { title: value })"
          />
        </label>

        <label class="field mode-field">
          <span class="field-label">编号方式</span>
          <t-select
            :value="clause.numberingMode"
            :options="numberingOptions"
            :disabled="disabled"
            @change="(value: 'automatic' | 'fixed') => updateClause(clause.key, { numberingMode: value })"
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
          标准条款 {{ clause.standardClauseVersionId }}
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
          :options="standardClauseOptions"
          :disabled="disabled || libraryBusy"
          placeholder="选择已发布标准条款"
          @change="(value: string) => selectStandardClause(clause.key, value)"
        />
        <t-button
          size="small"
          variant="outline"
          :disabled="disabled || !selectedClauseIds[clause.key]"
          @click="insertStandardClause(clause.key)"
        >
          插入标准条款
        </t-button>
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
                :disabled="disabled"
                @change="updateParagraphMark(clause.key, index, 'bold', $event)"
              > B</label>
              <label><input
                type="checkbox"
                :checked="block.italic"
                :disabled="disabled"
                @change="updateParagraphMark(clause.key, index, 'italic', $event)"
              > I</label>
            </div>
            <t-textarea
              :value="block.text"
              :disabled="disabled"
              :autosize="{ minRows: 2, maxRows: 5 }"
              @change="(value: string) => updateBlock(clause.key, index, { ...block, text: value })"
            />
          </template>

          <template v-else-if="block.type === 'list'">
            <t-textarea
              :value="block.items.join('\n')"
              :disabled="disabled"
              :autosize="{ minRows: 2, maxRows: 5 }"
              @change="(value: string) => updateBlock(clause.key, index, { type: 'list', items: value.split('\n') })"
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
                  <input
                    :value="cell"
                    :disabled="disabled"
                    @input="updateTableCell(clause.key, index, rowIndex, cellIndex, $event)"
                  >
                </td>
              </tr>
            </tbody>
          </table>

          <button
            type="button"
            class="link-button"
            :disabled="disabled"
            @click="removeBlock(clause.key, index)"
          >
            删除块
          </button>
        </div>
        <div class="block-actions">
          <button
            type="button"
            :disabled="disabled"
            @click="addBlock(clause.key, 'paragraph')"
          >
            段落
          </button>
          <button
            type="button"
            :disabled="disabled"
            @click="addBlock(clause.key, 'list')"
          >
            列表
          </button>
          <button
            type="button"
            :disabled="disabled"
            @click="addBlock(clause.key, 'table')"
          >
            小表格
          </button>
        </div>
      </div>
    </div>

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
import { computed, onMounted, ref } from "vue";
import { listPublishedStandardClauses } from "../../../api/contract-workbench.api";
import {
  clauseDocumentText,
  clauseReadinessMessages,
  normalizeClauseDocument,
  type ClauseBlock,
  type ClauseDocument
} from "./contract-bill-editor";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  disabled: boolean;
  readiness?: unknown;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();

const numberingOptions = [
  { label: "自动编号", value: "automatic" },
  { label: "固定编号", value: "fixed" }
];
const standardClauses = ref<Array<Record<string, unknown>>>([]);
const selectedClauseIds = ref<Record<string, string>>({});
const libraryBusy = ref(false);
const message = ref("");

const standardClauseOptions = computed(() =>
  standardClauses.value.map((clause) => ({
    label: String(clause["name"] ?? clause["title"] ?? clause["code"] ?? clause["id"] ?? "标准条款"),
    value: String(clause["versionId"] ?? clause["standardClauseVersionId"] ?? clause["id"] ?? "")
  }))
);

onMounted(loadStandardClauses);

function updateClause(key: string, patch: Partial<ContractClauseDefinition>) {
  emit("update", {
    clauses: props.model.clauses.map((clause) =>
      clause.key === key ? { ...clause, ...patch } : clause
    )
  });
}

function clauseDocument(content: unknown): ClauseDocument {
  return normalizeClauseDocument(content);
}

function updateClauseBlocks(key: string, blocks: ClauseBlock[]) {
  const text = clauseDocumentText({ text: "", blocks });
  updateClause(key, { content: { text, blocks } });
}

function updateBlock(key: string, index: number, block: ClauseBlock) {
  const clause = props.model.clauses.find((item) => item.key === key);
  if (!clause) return;
  const blocks = clauseDocument(clause.content).blocks;
  blocks[index] = block;
  updateClauseBlocks(key, blocks);
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
  const clause = props.model.clauses.find((item) => item.key === key);
  const block = clause ? clauseDocument(clause.content).blocks[index] : null;
  if (!block || block.type !== "paragraph") return;
  updateBlock(key, index, {
    ...block,
    [mark]: (event.target as HTMLInputElement).checked
  });
}

function updateTableCell(
  key: string,
  index: number,
  rowIndex: number,
  cellIndex: number,
  event: Event
) {
  const clause = props.model.clauses.find((item) => item.key === key);
  const block = clause ? clauseDocument(clause.content).blocks[index] : null;
  if (!block || block.type !== "table") return;
  const rows = block.rows.map((row) => [...row]);
  rows[rowIndex][cellIndex] = (event.target as HTMLInputElement).value;
  updateBlock(key, index, { type: "table", rows });
}

async function loadStandardClauses() {
  libraryBusy.value = true;
  try {
    standardClauses.value = (await listPublishedStandardClauses()) as Array<Record<string, unknown>>;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "标准条款库加载失败";
  } finally {
    libraryBusy.value = false;
  }
}

function insertStandardClause(key: string) {
  const selectedId = selectedClauseIds.value[key];
  const source = standardClauses.value.find((item) =>
    [item["versionId"], item["standardClauseVersionId"], item["id"]].some(
      (value) => String(value ?? "") === selectedId
    )
  );
  if (!source) return;
  const content = source["content"];
  updateClause(key, {
    standardClauseVersionId: selectedId,
    ...(typeof source["title"] === "string" ? { title: source["title"] } : {}),
    ...(content === undefined ? {} : { content })
  });
  message.value =
    content === undefined
      ? "已记录标准条款来源；当前接口未返回条款正文，请手动维护正文。"
      : "已插入标准条款。";
}

function selectStandardClause(key: string, value: string) {
  selectedClauseIds.value = { ...selectedClauseIds.value, [key]: value };
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
  const record = clause as ContractClauseDefinition & {
    standardContent?: unknown;
    deviatedFromStandard?: boolean;
  };
  if (record.deviatedFromStandard) {
    return true;
  }
  return (
    record.standardContent !== undefined &&
    contentText(record.standardContent) !== contentText(clause.content)
  );
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
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

@media (max-width: 900px) {
  .clause-head {
    grid-template-columns: 1fr;
  }

  .library-row {
    grid-template-columns: 1fr;
  }
}
</style>
