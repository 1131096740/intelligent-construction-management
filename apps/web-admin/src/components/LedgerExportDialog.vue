<script setup lang="ts">
import { computed } from "vue";

export interface LedgerExportColumnOption {
  key: string;
  label: string;
  required?: boolean;
}

const props = withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    description?: string;
    rowCount: number;
    filters: Array<{ label: string; value: string }>;
    columns: LedgerExportColumnOption[];
    visibleColumnKeys: string[];
    busy?: boolean;
  }>(),
  { description: "", busy: false }
);

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "confirm"): void;
}>();

const visibleColumns = computed(() => {
  const shown = new Set(props.visibleColumnKeys);
  return props.columns.filter((column) => column.required || shown.has(column.key));
});

const requiredColumns = computed(() =>
  props.columns.filter((column) => column.required)
);

const hasFilters = computed(() => props.filters.length > 0);
</script>

<template>
  <t-dialog
    :visible="visible"
    :header="title"
    width="min(640px, 94vw)"
    :close-on-overlay-click="!busy"
    :close-btn="!busy"
    :confirm-btn="{
      content: busy ? '正在生成…' : '按当前筛选与显示列导出',
      theme: 'primary',
      loading: busy,
      disabled: busy
    }"
    cancel-btn="取消"
    @confirm="emit('confirm')"
    @close="emit('update:visible', false)"
  >
    <section
      class="ledger-export-preview"
      aria-label="导出预览"
    >
      <p class="ledger-export-preview__count">
        当前筛选命中 <strong>{{ rowCount }}</strong> 条可见记录；导出的不是当前页。
      </p>

      <div class="ledger-export-preview__block">
        <h3>导出筛选条件</h3>
        <p v-if="!hasFilters">
          未设置筛选，按当前视图的全部可见记录导出。
        </p>
        <ul v-else>
          <li
            v-for="filter in filters"
            :key="filter.label"
          >
            <span>{{ filter.label }}</span>
            <strong>{{ filter.value }}</strong>
          </li>
        </ul>
      </div>

      <div class="ledger-export-preview__block">
        <h3>显示列（{{ visibleColumns.length }}）</h3>
        <p>必要的项目、业务双方与金额列始终导出，即使当前被隐藏。</p>
        <div class="ledger-export-preview__columns">
          <t-tag
            v-for="column in visibleColumns"
            :key="column.key"
            size="small"
            :theme="column.required ? 'primary' : 'default'"
            variant="light"
          >
            {{ column.label }}{{ column.required ? "（必要）" : "" }}
          </t-tag>
        </div>
      </div>

      <t-alert
        v-if="requiredColumns.length"
        theme="info"
        :message="`必要列：${requiredColumns.map((column) => column.label).join('、')}`"
      />

      <p class="ledger-export-preview__hint">
        导出为服务端生成的中文业务 Excel：金额与日期为可核对单元格，含合计与打印布局；不包含数据库技术字段。
      </p>
    </section>
  </t-dialog>
</template>

<style scoped>
.ledger-export-preview {
  display: grid;
  gap: var(--jg-space-md);
  color: var(--jg-color-text-primary);
}

.ledger-export-preview__count {
  margin: 0;
  padding: var(--jg-space-sm) var(--jg-space-md);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-muted);
}

.ledger-export-preview__count strong {
  font-size: var(--jg-font-size-section-title);
}

.ledger-export-preview__block h3 {
  margin: 0 0 var(--jg-space-xs);
  font-size: var(--jg-font-size-body);
}

.ledger-export-preview__block p,
.ledger-export-preview__hint {
  margin: 0;
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.ledger-export-preview__block ul {
  display: grid;
  gap: var(--jg-space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ledger-export-preview__block li {
  display: flex;
  gap: var(--jg-space-sm);
  justify-content: space-between;
  padding: var(--jg-space-xs) 0;
  border-bottom: var(--jg-border-width-base) dashed var(--jg-color-border);
}

.ledger-export-preview__columns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs);
  margin-top: var(--jg-space-xs);
}

@media (max-width: 720px) {
  .ledger-export-preview__block li {
    flex-direction: column;
    gap: var(--jg-space-xxs);
  }
}
</style>
