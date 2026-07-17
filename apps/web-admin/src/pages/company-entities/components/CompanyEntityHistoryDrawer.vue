<template>
  <t-drawer
    v-model:visible="visible"
    header="主体历史"
    size="680px"
  >
    <BusinessFeedback
      v-if="loading"
      state="loading"
      title="正在加载历史"
      description="正在读取不可覆盖的主体版本。"
    />
    <BusinessFeedback
      v-else-if="errorMessage"
      state="error"
      title="历史加载失败"
      :description="errorMessage"
      action-label="重试"
      @action="load"
    />
    <div
      v-else
      class="history-list"
    >
      <article
        v-for="item in historyItems"
        :key="item.id"
        class="history-item"
      >
        <header>
          <div>
            <strong>v{{ item.versionNo }} · {{ item.actionLabel }}</strong>
            <span>{{ item.createdAtLabel }}</span>
          </div>
          <t-tag :theme="item.isActive ? 'success' : 'default'">
            {{ item.isActive ? "启用" : "停用" }}
          </t-tag>
        </header>
        <p>{{ item.roleLabel }} · 操作人身份已留痕</p>
        <dl>
          <template
            v-for="change in item.changes"
            :key="change.label"
          >
            <dt>{{ change.label }}</dt>
            <dd>{{ change.before }} → {{ change.after }}</dd>
          </template>
        </dl>
        <span
          v-if="item.changes.length === 0"
          class="no-change"
        >本版本为历史起点</span>
      </article>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fetchCompanyEntityHistory,
  type CompanyEntityVersionModel
} from "../../../api/company-entity.api";
import BusinessFeedback from "../../../components/BusinessFeedback.vue";
import {
  companyEntityActionLabel,
  companyEntityFieldChanges,
  companyEntityRoleLabel
} from "../company-entity.config";

const props = defineProps<{ modelValue: boolean; entityId: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});
const versions = ref<CompanyEntityVersionModel[]>([]);
const loading = ref(false);
const errorMessage = ref("");

const historyItems = computed(() => versions.value.map((version, index) => ({
  id: version.id,
  versionNo: version.versionNo,
  actionLabel: companyEntityActionLabel(version.action),
  roleLabel: companyEntityRoleLabel(version.actorRoleKey),
  createdAtLabel: formatDateTime(version.createdAt),
  isActive: version.isActive,
  changes: companyEntityFieldChanges(version, versions.value[index + 1])
})));

watch(() => [props.modelValue, props.entityId] as const, ([isVisible]) => {
  if (isVisible) void load();
});

async function load() {
  if (!props.entityId) return;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchCompanyEntityHistory(props.entityId);
    versions.value = [...result.versions].sort((a, b) => b.versionNo - a.versionNo);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载主体历史失败";
  } finally {
    loading.value = false;
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间已留痕" : date.toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.history-list,
.history-item {
  display: grid;
  gap: var(--jg-space-md);
}

.history-item {
  padding: var(--jg-space-md);
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-md);
  font-size: var(--jg-font-size-body);
}

.history-item header,
.history-item header > div {
  display: flex;
  justify-content: space-between;
  gap: var(--jg-space-sm);
}

.history-item header > div {
  flex-direction: column;
}

.history-item p,
.history-item dl {
  margin: 0;
}

.history-item p,
.history-item header span,
.no-change {
  color: var(--jg-color-text-tertiary);
}

.history-item dl {
  display: grid;
  grid-template-columns: minmax(100px, auto) 1fr;
  gap: var(--jg-space-xs) var(--jg-space-md);
}

.history-item dd {
  margin: 0;
}
</style>
