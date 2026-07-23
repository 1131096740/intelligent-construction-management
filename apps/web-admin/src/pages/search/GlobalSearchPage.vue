<template>
  <JgWorkbenchShell
    class="global-search-page jg-responsive-ledger"
    title="全局搜索"
    description="统一检索合同、结算、付款和资料库，结果仍回到原业务单据处理。"
  >
    <template #actions>
      <t-button
        theme="primary"
        :loading="loading"
        @click="loadSearchIndex"
      >
        刷新索引
      </t-button>
    </template>

    <template #filters>
      <div class="search-bar">
        <label class="search-field">
          <span>搜索关键词</span>
          <t-input
            v-model="query"
            clearable
            placeholder="输入项目、编号、相对方、状态、文件名，可用空格组合"
            @enter="applySearch"
          />
        </label>
        <t-button
          theme="primary"
          @click="applySearch"
        >
          搜索
        </t-button>
        <t-button @click="resetSearch">
          重置
        </t-button>
      </div>

      <div class="column-strip">
        <span>列设置</span>
        <t-checkbox
          v-for="option in columnOptions"
          :key="option.key"
          :checked="visibleColumnKeys.includes(option.key)"
          @change="toggleColumn(option.key)"
        >
          {{ option.title }}
        </t-checkbox>
      </div>
    </template>

    <template #summary>
      <div class="summary-strip">
        <span>全部 {{ allItems.length }} 条</span>
        <span>合同 {{ typeCount("合同") }} 条</span>
        <span>结算 {{ typeCount("结算") }} 条</span>
        <span>付款 {{ typeCount("付款") }} 条</span>
        <span>资料 {{ typeCount("资料") }} 条</span>
        <strong>当前结果 {{ filteredItems.length }} 条</strong>
      </div>
    </template>

    <JgResultState
      :loading="loading"
      :has-results="filteredItems.length > 0"
      :error="loadError"
      empty-title="未找到匹配业务"
      empty-description="请调整关键词或先刷新索引后重试。"
      @retry="loadSearchIndex"
    >
      <div
        v-if="message"
        class="list-message"
      >
        {{ message }}
      </div>

      <t-card
        class="result-panel jg-table-region jg-table-region--wide"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="visibleGlobalSearchColumns"
          :data="filteredItems"
          :loading="loading"
          :horizontal-scroll-affixed-bottom="true"
        >
          <template #type="{ row }">
            <t-tag
              size="small"
              :theme="typeTheme(row.type)"
              variant="light"
            >
              {{ row.type }}
            </t-tag>
          </template>
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="openResult(row.targetPath)"
            >
              打开
            </t-link>
          </template>
        </t-table>
      </t-card>
    </JgResultState>
  </JgWorkbenchShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import {
  fetchArchives,
  fetchContractLedger,
  fetchPaymentLedger,
  fetchSettlementLedger
} from "../../api/core-flow-read.api";
import {
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import JgResultState from "../../components/JgResultState.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import {
  buildGlobalSearchItems,
  filterGlobalSearchItems,
  globalSearchColumns,
  type GlobalSearchItem,
  type GlobalSearchType
} from "./global-search.config";

const router = useRouter();
const auth = useAuthStore();
const query = ref("");
const loading = ref(false);
const message = ref("");
const loadError = ref("");
const allItems = ref<GlobalSearchItem[]>([]);
const configurableColumnKeys = globalSearchColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visibleColumnKeys = ref<string[]>([...configurableColumnKeys]);

const filteredItems = computed(() => filterGlobalSearchItems(allItems.value, query.value));
const preferenceStorageKey = computed(() =>
  auth.user?.id ? `jiangkong:web-admin:global-search:${auth.user.id}` : ""
);
const columnOptions = computed(() =>
  globalSearchColumns
    .filter((column) => column.colKey !== "operation")
    .map((column) => ({ key: String(column.colKey), title: String(column.title) }))
);
const visibleGlobalSearchColumns = computed(() => {
  const visible = new Set(visibleColumnKeys.value);
  return globalSearchColumns.filter((column) => column.colKey === "operation" || visible.has(String(column.colKey)));
});

onMounted(() => {
  void loadSearchIndex();
});

watch(
  preferenceStorageKey,
  () => {
    loadPersonalPreferences();
  },
  { immediate: true }
);

watch(
  [query, visibleColumnKeys],
  () => {
    savePersonalPreferences();
  },
  { deep: true }
);

async function loadSearchIndex() {
  loading.value = true;
  loadError.value = "";
  try {
    const [contracts, settlements, payments, archives] = await Promise.all([
      fetchContractLedger(),
      fetchSettlementLedger(),
      fetchPaymentLedger(),
      fetchArchives()
    ]);
    allItems.value = buildGlobalSearchItems({
      contracts: contracts.rows,
      settlements: settlements.rows,
      payments: payments.rows,
      archives: archives.rows
    });
    message.value = "";
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "读取全局搜索数据失败";
  } finally {
    loading.value = false;
  }
}

function applySearch() {
  message.value = `已筛选出 ${filteredItems.value.length} 条结果。`;
}

function resetSearch() {
  query.value = "";
  message.value = "";
}

function toggleColumn(key: string) {
  const next = visibleColumnKeys.value.includes(key)
    ? visibleColumnKeys.value.filter((item) => item !== key)
    : [...visibleColumnKeys.value, key];
  visibleColumnKeys.value = normalizeVisibleColumnKeys(next, configurableColumnKeys);
}

function typeCount(type: GlobalSearchType) {
  return allItems.value.filter((item) => item.type === type).length;
}

function openResult(path: string) {
  void router.push(path);
}

function typeTheme(type: GlobalSearchType) {
  const themes = {
    合同: "primary",
    结算: "success",
    付款: "warning",
    资料: "default"
  } as const;
  return themes[type];
}

function loadPersonalPreferences() {
  const storageKey = preferenceStorageKey.value;
  if (!storageKey) {
    query.value = "";
    visibleColumnKeys.value = [...configurableColumnKeys];
    return;
  }
  const preferences = readPersonalTablePreferences(getPreferenceStorage(), storageKey, configurableColumnKeys);
  query.value = preferences.query;
  visibleColumnKeys.value = preferences.visibleColumnKeys;
}

function savePersonalPreferences() {
  const storageKey = preferenceStorageKey.value;
  if (!storageKey) {
    return;
  }
  writePersonalTablePreferences(getPreferenceStorage(), storageKey, {
    query: query.value,
    visibleColumnKeys: visibleColumnKeys.value
  });
}

function getPreferenceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
</script>

<style scoped>
.search-bar,
.summary-strip {
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.search-bar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 76px 76px;
  gap: var(--jg-space-sm-plus);
  align-items: end;
  padding: var(--jg-space-md);
}

.search-field {
  min-width: 0;
  display: grid;
  gap: var(--jg-space-xs);
}

.search-field span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.summary-strip,
.column-strip {
  min-height: var(--jg-layout-business-summary-strip-min-height);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  padding: 0 var(--jg-space-md);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.column-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  min-height: var(--jg-layout-business-summary-strip-min-height);
  padding: 0 var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.column-strip span {
  color: var(--jg-color-text-tertiary);
  font-weight: var(--jg-font-weight-bold);
}

.summary-strip strong {
  margin-left: auto;
}

.list-message {
  padding: var(--jg-space-sm-plus) var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.result-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: var(--jg-radius-panel);
}

:deep(.t-card__body) {
  padding: 0;
}

:deep(.t-table th) {
  background: var(--jg-color-bg-muted);
  font-size: var(--jg-font-size-table-secondary);
}

@container jg-workbench-shell (max-width: 620px) {
  .search-bar {
    grid-template-columns: 1fr;
  }

  .summary-strip strong {
    margin-left: 0;
  }
}
</style>
