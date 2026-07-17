<template>
  <section class="global-search-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>全局搜索</h1>
        <p>统一检索合同、结算、付款和资料库，结果仍回到原业务单据处理。</p>
      </div>
      <t-button
        theme="primary"
        :loading="loading"
        @click="loadSearchIndex"
      >
        刷新索引
      </t-button>
    </div>

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
      <label
        v-for="option in columnOptions"
        :key="option.key"
      >
        <input
          type="checkbox"
          :checked="visibleColumnKeys.includes(option.key)"
          @change="toggleColumn(option.key)"
        >
        {{ option.title }}
      </label>
    </div>

    <div class="summary-strip">
      <span>全部 {{ allItems.length }} 条</span>
      <span>合同 {{ typeCount("合同") }} 条</span>
      <span>结算 {{ typeCount("结算") }} 条</span>
      <span>付款 {{ typeCount("付款") }} 条</span>
      <span>资料 {{ typeCount("资料") }} 条</span>
      <strong>当前结果 {{ filteredItems.length }} 条</strong>
    </div>

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
        empty="暂无搜索结果"
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
  </section>
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
    message.value = error instanceof Error ? error.message : "读取全局搜索数据失败";
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
.global-search-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.search-bar,
.summary-strip {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.search-bar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 76px 76px;
  gap: 10px;
  align-items: end;
  padding: 12px;
  margin-bottom: 12px;
}

.search-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.search-field span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.summary-strip,
.column-strip {
  min-height: 38px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 0 12px;
  margin-bottom: 12px;
  color: #424955;
  font-size: 12px;
}

.column-strip {
  margin-bottom: 12px;
}

.column-strip span {
  color: #767f8d;
  font-weight: 700;
}

.column-strip label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  color: #424955;
}

.summary-strip strong {
  margin-left: auto;
}

.list-message {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
  color: #424955;
  font-size: 12px;
  font-weight: 600;
}

.result-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: 3px;
}

:deep(.t-card__body) {
  padding: 0;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@container jg-page (max-width: 620px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .search-bar {
    grid-template-columns: 1fr;
  }

  .summary-strip strong {
    margin-left: 0;
  }
}
</style>
