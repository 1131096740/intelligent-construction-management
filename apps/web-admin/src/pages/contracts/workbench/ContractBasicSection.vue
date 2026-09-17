<template>
  <div class="workbench-section">
    <h2 class="section-title">
      {{ mode === "settlement" ? "结算方式" : "基础信息" }}
    </h2>

    <div class="field-grid">
      <BusinessEntryForm
        v-if="mode !== 'settlement' && basicDefinition"
        :definition="basicDefinition"
        :model-value="basicEntry"
        :readonly="disabled"
        :options-by-field="{ companyEntityId: companyOptions }"
        @update:model-value="updateBasicEntry"
      />
      <t-alert
        v-else-if="mode !== 'settlement'"
        theme="warning"
        message="基础信息填写规则尚未加载，请刷新后再填写。"
      />

      <div
        v-if="mode !== 'settlement'"
        class="field"
      >
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
        >
          <template #operation>
            <t-button
              size="small"
              variant="text"
              @click="loadCandidates"
            >
              重试
            </t-button>
          </template>
        </t-alert>
        <t-alert
          v-else-if="loaded && candidates.length === 0"
          theme="info"
          message="暂无可用的我方公司主体，请先到主体台账完善并启用资料。"
        />
      </div>

      <div
        v-if="mode !== 'basic'"
        class="field"
      >
        <BusinessEntryForm
          v-if="settlementDefinition"
          :definition="settlementDefinition"
          :model-value="settlementEntry"
          :readonly="disabled || !settlementMode.canConfirm || settlementModeBusy"
          @update:model-value="updateSettlementEntry"
        />
        <t-alert
          v-else
          theme="warning"
          message="结算方式填写规则尚未加载，请刷新后再确认。"
        />
        <span class="field-help">
          <template v-if="settlementMode.confirmationRequired">
            系统已给出建议，需由合同部主管确认后才能提交审批、开结算或按合同发起应付款。
          </template>
          <template v-else>
            已由合同部主管确认；审批后如需变更，请通过合同变更版本处理。
          </template>
        </span>
        <t-alert
          v-if="settlementMode.confirmationRequired"
          theme="warning"
          message="结算方式待合同部主管确认"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition, ContractSettlementMode } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { formatUnknownApiError } from "../../../api/error-message";
import {
  fetchActiveCompanyEntities,
  type CompanyEntityModel
} from "../../../api/company-entity.api";
import {
  companyEntitySelectionUnavailable,
  companyEntitySyncPatch,
  hasCompanyEntityVersionDrift,
  type ContractDraftModel
} from "./use-contract-draft";

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
  (event: "confirm-settlement-mode", mode: ContractSettlementMode): void;
}>();
const props = withDefaults(defineProps<{
  model: ContractDraftModel;
  definition?: BusinessEntrySceneDefinition;
  settlementDefinition?: BusinessEntrySceneDefinition;
  disabled: boolean;
  mode?: "all" | "basic" | "settlement";
  nameDisabled?: boolean;
  companyDisabled?: boolean;
  settlementMode: {
    value: ContractSettlementMode | null;
    confirmationRequired: boolean;
    canConfirm: boolean;
  };
  settlementModeBusy?: boolean;
}>(), {
  definition: undefined,
  settlementDefinition: undefined,
  mode: "all"
});
const candidates = ref<CompanyEntityModel[]>([]);
const basicDefinition = computed(() => props.definition ? {
  ...props.definition,
  fields: props.definition.fields.map((field) => ({
    ...field,
    readOnly: field.readOnly || (field.key === "contractName"
      ? props.nameDisabled ?? props.disabled
      : props.companyDisabled ?? props.disabled)
  }))
} : null);
const basicEntry = computed<BusinessEntryDraftPayload>(() => ({
  sceneKey: props.definition?.key ?? "contract_basic",
  definitionVersion: props.definition?.version,
  values: { contractName: props.model.contractName, companyEntityId: props.model.companyEntityId }
}));

function updateBasicEntry(entry: BusinessEntryDraftPayload) {
  if (props.disabled) return;
  const patch: Partial<ContractDraftModel> = {};
  if (!(props.nameDisabled ?? props.disabled) && typeof entry.values.contractName === "string") {
    patch.contractName = entry.values.contractName;
  }
  if (!(props.companyDisabled ?? props.disabled) && typeof entry.values.companyEntityId === "string" &&
      entry.values.companyEntityId !== props.model.companyEntityId) {
    Object.assign(patch, companyEntitySyncPatch(entry.values.companyEntityId));
  }
  emit("update", patch);
}
const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");
const companyOptions = computed(() => candidates.value.map((candidate) => ({
  value: candidate.id,
  label: `${candidate.name}（${candidate.unifiedSocialCreditCode ?? "信用代码待补全"}）`
})));
const settlementEntry = computed<BusinessEntryDraftPayload>(() => ({
  sceneKey: props.settlementDefinition?.key ?? "contract_settlement_mode",
  definitionVersion: props.settlementDefinition?.version,
  values: { settlementMode: props.settlementMode.value }
}));
const selectedCandidate = computed(() =>
  candidates.value.find((candidate) => candidate.id === props.model.companyEntityId) ?? null
);
const displayCompany = computed(() => selectedCandidate.value ?? props.model.companyEntitySelection);
const versionDrift = computed(() => hasCompanyEntityVersionDrift(
  selectedCandidate.value,
  props.model.companyEntitySelection
));
const selectionUnavailable = computed(() => companyEntitySelectionUnavailable({
  loaded: loaded.value,
  loadError: loadError.value,
  selectedId: props.model.companyEntityId,
  hasCandidate: Boolean(selectedCandidate.value)
}));

function selectCompany(value: string) {
  emit("update", companyEntitySyncPatch(value));
}

function syncCompany() {
  if (selectedCandidate.value) selectCompany(selectedCandidate.value.id);
}

function updateSettlementEntry(entry: BusinessEntryDraftPayload) {
  if (props.disabled || !props.settlementMode.canConfirm || props.settlementModeBusy) return;
  const value = entry.values.settlementMode;
  if (value === "settlement_required" || value === "direct_payment") {
    emit("confirm-settlement-mode", value);
  }
}

async function loadCandidates() {
  loading.value = true;
  loaded.value = false;
  loadError.value = "";
  try {
    candidates.value = await fetchActiveCompanyEntities();
  } catch (error) {
    loadError.value = formatUnknownApiError(
      error,
      "加载可选我方公司主体失败，请稍后重试"
    );
  } finally {
    loaded.value = true;
    loading.value = false;
  }
}

onMounted(() => {
  if (props.mode !== "settlement") {
    void loadCandidates();
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
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
  font-weight: 600;
}

.field-help {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}
</style>
