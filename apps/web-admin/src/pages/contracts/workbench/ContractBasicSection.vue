<template>
  <div class="workbench-section">
    <h2 class="section-title">
      基础信息
    </h2>

    <div class="field-grid">
      <label class="field">
        <span class="field-label">合同名称</span>
        <t-input
          :value="model.contractName"
          :disabled="nameDisabled ?? disabled"
          placeholder="请输入合同名称"
          @change="(value: string) => emit('update', { contractName: value })"
        />
      </label>

      <label class="field">
        <span class="field-label">我方签约主体</span>
        <t-select
          :value="model.companyEntityId"
          :options="companyOptions"
          :disabled="companyDisabled ?? disabled"
          :loading="loading"
          placeholder="请选择我方公司主体"
          @change="selectCompany"
        />
        <span
          v-if="displayCompany"
          class="field-help"
        >
          {{ displayCompany.unifiedSocialCreditCode }}
          <template v-if="displayCompany.registeredAddress">
            · {{ displayCompany.registeredAddress }}
          </template>
        </span>
        <t-alert
          v-if="versionDrift"
          theme="warning"
          message="主体资料已更新，请同步最新版本后重新生成预览。"
        >
          <template #operation>
            <t-button
              size="small"
              variant="text"
              @click="syncCompany"
            >
              同步最新版本
            </t-button>
          </template>
        </t-alert>
        <t-alert
          v-else-if="selectionUnavailable"
          theme="warning"
          message="已选主体已停用或资料不完整，请重新选择可用主体。"
        />
        <t-alert
          v-if="loadError"
          theme="error"
          :message="loadError"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  fetchActiveCompanyEntities,
  type CompanyEntityModel
} from "../../../api/company-entity.api";
import {
  hasCompanyEntityVersionDrift,
  type ContractDraftModel
} from "./use-contract-draft";

const emit = defineEmits<{ (event: "update", patch: Partial<ContractDraftModel>): void }>();
const props = defineProps<{
  model: ContractDraftModel;
  disabled: boolean;
  nameDisabled?: boolean;
  companyDisabled?: boolean;
}>();
const candidates = ref<CompanyEntityModel[]>([]);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");
const companyOptions = computed(() => candidates.value.map((candidate) => ({
  value: candidate.id,
  label: `${candidate.name}（${candidate.unifiedSocialCreditCode ?? "信用代码待补全"}）`
})));
const selectedCandidate = computed(() =>
  candidates.value.find((candidate) => candidate.id === props.model.companyEntityId) ?? null
);
const displayCompany = computed(() => selectedCandidate.value ?? props.model.companyEntitySelection);
const versionDrift = computed(() => hasCompanyEntityVersionDrift(
  selectedCandidate.value,
  props.model.companyEntitySelection
));
const selectionUnavailable = computed(() => Boolean(
  loaded.value && props.model.companyEntityId && !selectedCandidate.value
));

function selectCompany(value: string) {
  emit("update", {
    companyEntityId: value,
    companyEntitySelection: null
  });
}

function syncCompany() {
  if (selectedCandidate.value) selectCompany(selectedCandidate.value.id);
}

onMounted(async () => {
  loading.value = true;
  loadError.value = "";
  try {
    candidates.value = await fetchActiveCompanyEntities();
  } catch (error) {
    loadError.value = error instanceof Error
      ? error.message
      : "加载可选我方公司主体失败，请稍后重试";
  } finally {
    loaded.value = true;
    loading.value = false;
  }
});
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

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.field-help {
  color: #767f8d;
  font-size: 12px;
}
</style>
