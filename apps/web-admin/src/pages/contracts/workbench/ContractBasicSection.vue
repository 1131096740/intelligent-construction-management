<template>
  <div class="workbench-section">
    <h2 class="section-title">
      {{ mode === "settlement" ? "结算方式" : "基础信息" }}
    </h2>

    <p v-if="mode !== 'settlement'" class="field-help">金额口径按本合同约定选择；切换不会换算已填写单价，请逐项核对当前草稿价格。</p>
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

      <div v-if="mode !== 'settlement' && (selectedCandidate || bankBinding)" class="field">
        <strong>我方公司银行资料</strong>
        <p class="field-help">资料随当前所选公司保存；切换公司后原资料会保留，需明确选择是否用于新公司。</p>
        <template v-if="staleBankBinding">
          <t-alert theme="warning" message="保留的银行资料属于此前选择的公司或版本，请核对后选择是否用于当前公司。" />
          <p v-for="field in bankFields" :key="field.key" class="field-help">{{ field.label }}：{{ bankBinding?.values[field.key] || '未填写' }}</p>
          <t-button :disabled="disabled || !selectedCandidate" size="small" @click="copyBankValues(bankBinding!.values)">将保留资料用于当前公司</t-button>
        </template>
        <template v-else>
          <label v-for="field in bankFields" :key="field.key" class="field">
            <span class="field-label">{{ field.label }}</span>
            <t-input :value="bankBinding?.values[field.key] ?? ''" :disabled="disabled" @change="(value: string) => updateBankField(field.key, value)" />
          </label>
        </template>
        <template v-for="(party, index) in legacyBankParties" :key="index">
          <t-alert theme="warning" message="原甲方银行资料尚未绑定我方公司，原资料仍保留在合作单位中。" />
          <p class="field-help">{{ typeof party.snapshot.name === 'string' ? party.snapshot.name : '未命名甲方' }}</p>
          <p v-for="field in bankFields" :key="field.key" class="field-help">{{ field.label }}：{{ party.snapshot[field.key] || '未填写' }}</p>
          <t-button :disabled="disabled || staleBankBinding" size="small" @click="copyBankValues(party.snapshot)">将此甲方资料用于当前公司</t-button>
        </template>
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
import type { ContractDraftPartyModel } from "../../../api/contract-workbench.api";
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
  parties?: ContractDraftPartyModel[];
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
  parties: () => [],
  definition: undefined,
  settlementDefinition: undefined,
  mode: "all"
});
const candidates = ref<CompanyEntityModel[]>([]);
const basicDefinition = computed(() => props.definition ? {
  ...props.definition,
  fields: props.definition.fields.map((field) => ({
    ...field,
    required: props.model.numericProtocolVersion === 2 && field.key === "companyEntityId" ? false : field.required,
    readOnly: field.readOnly || (field.key === "contractName"
      ? props.nameDisabled ?? props.disabled
      : field.key === "companyEntityId" ? props.companyDisabled ?? props.disabled : props.disabled)
  }))
} : null);
const basicEntry = computed<BusinessEntryDraftPayload>(() => ({
  sceneKey: props.definition?.key ?? "contract_basic",
  definitionVersion: props.definition?.version,
  values: { amountBasis: "tax_inclusive", invoiceStatus: props.model.invoiceType ?? "pending",
    ...(props.model.extraDraftData?.contractBasics as Record<string, unknown> ?? {}),
    contractName: props.model.contractName, companyEntityId: props.model.companyEntityId }
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
  const basics = { ...(props.model.extraDraftData?.contractBasics as Record<string, unknown> ?? {}) };
  for (const key of ["relationship", "businessType", "amountBasis", "invoiceStatus", "settlementText"]) {
    if (typeof entry.values[key] === "string") basics[key] = entry.values[key];
  }
  patch.extraDraftData = { ...props.model.extraDraftData, contractBasics: basics };
  if (basics.invoiceStatus === "vat_general" || basics.invoiceStatus === "vat_special") patch.invoiceType = basics.invoiceStatus;
  else if (basics.invoiceStatus === "none" || basics.invoiceStatus === "pending") patch.invoiceType = null;
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
const bankFields = [
  { key: "openingBank", label: "开户行" },
  { key: "bankAccount", label: "开户账号" },
  { key: "paymentBank", label: "实际收款开户行" },
  { key: "paymentAccount", label: "实际收款账号" }
] as const;
type BankField = typeof bankFields[number]["key"];
type BankValues = Record<BankField, string>;
type BankBinding = { protocolVersion: 1; companyEntityId: string; companyEntityVersionNo: number; companyEntityVersionId?: string; values: BankValues };
const bankBinding = computed(() => (props.model.extraDraftData?.companyBankBinding ?? null) as BankBinding | null);
const staleBankBinding = computed(() => Boolean(bankBinding.value && (!selectedCandidate.value ||
  bankBinding.value.companyEntityId !== selectedCandidate.value.id || bankBinding.value.companyEntityVersionNo !== selectedCandidate.value.currentVersionNo)));
const legacyBankParties = computed(() => props.parties.filter((party) => party.roleKey === "party_a" && bankFields.some(({ key }) => typeof party.snapshot[key] === "string" && party.snapshot[key] !== "")));
function copyBankValues(source: Record<string, unknown>) {
  if (props.disabled || !selectedCandidate.value) return;
  const values = Object.fromEntries(bankFields.map(({ key }) => [key, typeof source[key] === "string" ? source[key] : ""])) as BankValues;
  const binding: BankBinding = { protocolVersion: 1, companyEntityId: selectedCandidate.value.id, companyEntityVersionNo: selectedCandidate.value.currentVersionNo, values };
  emit("update", { extraDraftData: { ...props.model.extraDraftData, companyBankBinding: binding } });
}
function updateBankField(field: BankField, value: string) {
  if (staleBankBinding.value) return;
  copyBankValues({ ...bankBinding.value?.values, [field]: value });
}
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

.field-grid > .business-entry-form {
  grid-column: 1 / -1;
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
