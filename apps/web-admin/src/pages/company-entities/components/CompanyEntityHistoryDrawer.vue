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
      v-else-if="historyItems.length > 0"
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
        <p>{{ item.actorName }} · {{ item.roleLabel }}</p>
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
    <BusinessFeedback
      v-else
      state="info"
      title="暂无历史版本"
      description="当前主体尚未形成可展示的历史记录。"
    />
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
  companyEntityRoleLabel,
  createCompanyEntityRequestGate
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
const requestGate = createCompanyEntityRequestGate();

const historyItems = computed(() => versions.value.map((version, index) => ({
  id: version.id,
  versionNo: version.versionNo,
  actionLabel: companyEntityActionLabel(version.action),
  actorName: version.actorName,
  roleLabel: companyEntityRoleLabel(version.actorRoleKey),
  createdAtLabel: formatDateTime(version.createdAt),
  isActive: version.isActive,
  changes: companyEntityFieldChanges(version, versions.value[index + 1])
})));

watch(() => [props.modelValue, props.entityId] as const, ([isVisible]) => {
  if (isVisible) {
    void load();
    return;
  }
  requestGate.invalidate();
  versions.value = [];
  errorMessage.value = "";
  loading.value = false;
});

async function load() {
  const entityId = props.entityId;
  if (!entityId || !props.modelValue) return;
  const token = requestGate.begin(entityId);
  loading.value = true;
  errorMessage.value = "";
  versions.value = [];
  try {
    const result = await fetchCompanyEntityHistory(entityId);
    if (!requestGate.isCurrent(token, props.modelValue ? props.entityId ?? "" : "")) return;
    versions.value = [...result.versions].sort((a, b) => b.versionNo - a.versionNo);
  } catch (error) {
    if (!requestGate.isCurrent(token, props.modelValue ? props.entityId ?? "" : "")) return;
    errorMessage.value = error instanceof Error ? error.message : "加载主体历史失败";
  } finally {
    if (requestGate.isCurrent(token, props.modelValue ? props.entityId ?? "" : "")) {
      loading.value = false;
    }
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
