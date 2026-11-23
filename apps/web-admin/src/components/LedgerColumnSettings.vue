<script setup lang="ts">
import { computed } from "vue";

export interface LedgerColumnSettingOption {
  key: string;
  label: string;
  required?: boolean;
}

const props = defineProps<{
  columns: LedgerColumnSettingOption[];
  visibleColumnKeys: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
}>();

const emit = defineEmits<{
  (event: "update:visibleColumnKeys", value: string[]): void;
  (event: "update:columnOrder", value: string[]): void;
  (event: "update:columnWidths", value: Record<string, number>): void;
}>();

const orderedVisibleColumns = computed(() => {
  const byKey = new Map(props.columns.map((column) => [column.key, column]));
  return props.columnOrder
    .map((key) => byKey.get(key))
    .filter((column): column is LedgerColumnSettingOption => Boolean(column))
    .filter((column) => props.visibleColumnKeys.includes(column.key));
});

function toggle(key: string, checked: boolean) {
  const required = props.columns.find((column) => column.key === key)?.required;
  if (required) return;
  if (checked) {
    if (props.visibleColumnKeys.includes(key)) return;
    emit("update:visibleColumnKeys", [...props.visibleColumnKeys, key]);
    return;
  }
  emit(
    "update:visibleColumnKeys",
    props.visibleColumnKeys.filter((item) => item !== key)
  );
}

function move(key: string, direction: -1 | 1) {
  const order = [...props.columnOrder];
  const index = order.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  emit("update:columnOrder", order);
}

function setWidth(key: string, value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  emit("update:columnWidths", {
    ...props.columnWidths,
    [key]: Math.min(600, Math.max(60, Math.round(parsed)))
  });
}
</script>

<template>
  <section
    class="ledger-column-settings"
    aria-label="个人列视图设置"
  >
    <header>
      <strong>个人列视图</strong>
      <span>只保存在本机；不改变数据含义、权限或他人设置。</span>
    </header>
    <div class="ledger-column-settings__visible">
      <t-checkbox
        v-for="column in columns"
        :key="column.key"
        :checked="visibleColumnKeys.includes(column.key) || Boolean(column.required)"
        :disabled="Boolean(column.required)"
        @change="toggle(column.key, Boolean($event))"
      >
        {{ column.label }}{{ column.required ? "（必要）" : "" }}
      </t-checkbox>
    </div>
    <ol class="ledger-column-settings__order">
      <li
        v-for="(column, index) in orderedVisibleColumns"
        :key="column.key"
      >
        <span>{{ column.label }}</span>
        <t-button
          size="small"
          variant="text"
          :disabled="index === 0"
          @click="move(column.key, -1)"
        >
          上移
        </t-button>
        <t-button
          size="small"
          variant="text"
          :disabled="index === orderedVisibleColumns.length - 1"
          @click="move(column.key, 1)"
        >
          下移
        </t-button>
        <t-input-number
          :value="columnWidths[column.key]"
          :min="60"
          :max="600"
          :step="10"
          size="small"
          theme="normal"
          aria-label="列宽"
          @change="setWidth(column.key, $event)"
        />
        <span class="ledger-column-settings__unit">像素</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ledger-column-settings {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-sm) 0;
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.ledger-column-settings header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  align-items: baseline;
}

.ledger-column-settings header span,
.ledger-column-settings__unit {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.ledger-column-settings__visible {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs) var(--jg-space-lg);
}

.ledger-column-settings__order {
  display: grid;
  gap: var(--jg-space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ledger-column-settings__order li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  align-items: center;
  min-width: 0;
}

.ledger-column-settings__order li > span:first-child {
  min-width: 120px;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}
</style>
