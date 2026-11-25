<template>
  <div class="historical-party-picker">
    <strong>{{ label }}</strong>
    <template v-if="editable">
      <t-input
        v-model="query"
        :aria-label="label"
        placeholder="按单位名称或信用代码查找"
        @enter="search"
      >
        <template #suffix>
          <t-button
            size="small"
            variant="text"
            :loading="loading"
            @click="search"
          >
            查找
          </t-button>
        </template>
      </t-input>
      <t-select
        v-if="parties.length"
        :options="parties"
        placeholder="选择合作单位"
        :aria-label="label + '合作单位'"
        :loading="loading"
        @change="selectParty"
      />
      <t-select
        v-if="versions.length"
        :model-value="modelValue"
        :options="versions"
        placeholder="选择原合同所用版本"
        :aria-label="label + '版本'"
        @change="selectVersion"
      />
      <t-button
        v-if="modelValue"
        size="small"
        variant="text"
        @click="emit('update:modelValue', undefined)"
      >
        清除选择
      </t-button>
    </template>
    <span role="status">{{ message || (modelValue ? "已选择原签约版本" : "原签约版本待核对") }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { getBusinessParty, listBusinessParties } from "../../../api/contract-workbench.api";

defineProps<{ label: string; modelValue?: string; editable: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string | undefined] }>();
const query = ref("");
const loading = ref(false);
const message = ref("");
const parties = ref<Array<{ value: string; label: string }>>([]);
const versions = ref<Array<{ value: string; label: string }>>([]);
let request = 0;
onBeforeUnmount(() => { request += 1; });

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function search() {
  const name = query.value.trim();
  if (!name) return;
  const current = ++request;
  loading.value = true;
  message.value = "";
  try {
    const items = await listBusinessParties(name);
    if (current !== request) return;
    versions.value = [];
    parties.value = items.map(record).flatMap(({ id, name: partyName }) =>
      typeof id === "string" && typeof partyName === "string" ? [{ value: id, label: partyName }] : []);
    if (!parties.value.length) message.value = "未找到符合条件的合作单位";
  } catch {
    if (current === request) message.value = "合作单位暂时无法查询";
  } finally {
    if (current === request) loading.value = false;
  }
}

async function selectParty(partyId: unknown) {
  if (typeof partyId !== "string" || !parties.value.some((party) => party.value === partyId)) return;
  const current = ++request;
  loading.value = true;
  message.value = "";
  versions.value = [];
  try {
    const result = record(await getBusinessParty(partyId));
    if (current !== request) return;
    versions.value = (Array.isArray(result.versions) ? result.versions : []).map(record).flatMap((version) => {
      const { name } = record(version.snapshot);
      return version.businessPartyId === partyId && typeof version.id === "string" &&
        typeof name === "string" && Number.isSafeInteger(version.versionNo)
        ? [{ value: version.id, label: `${name} · 版本 ${version.versionNo}` }] : [];
    });
    if (!versions.value.length) message.value = "该单位没有可核对的原签约版本";
  } catch {
    if (current === request) message.value = "原签约版本暂时无法读取";
  } finally {
    if (current === request) loading.value = false;
  }
}

function selectVersion(versionId: unknown) {
  if (typeof versionId === "string" && versions.value.some((version) => version.value === versionId)) {
    emit("update:modelValue", versionId);
  }
}
</script>

<style scoped>
.historical-party-picker {
  display: grid;
  gap: 8px;
}
</style>
