<template>
  <t-card
    class="department-panel"
    data-testid="contract-takeover-contract-side"
    :bordered="true"
  >
    <template #header>
      <div class="panel-head">
        <div>
          <strong>合同侧资料</strong>
          <span>合同侧修订 v{{ revision }} · 财务基线 v{{ financeBasisRevision }}</span>
        </div>
        <t-tag :theme="confirmedRevision === revision ? 'success' : 'warning'">
          {{ confirmedRevision === revision ? "当前修订已确认" : "当前修订待确认" }}
        </t-tag>
      </div>
    </template>

    <div
      v-if="modelValue"
      class="panel-form"
    >
      <div class="form-grid">
        <label>
          <span>历史合同编号</span>
          <t-input
            :model-value="modelValue.contractFacts.contractNo"
            :disabled="!editable"
            @update:model-value="updateContractFact('contractNo', textValue($event))"
          />
        </label>
        <label>
          <span>历史合同名称</span>
          <t-input
            :model-value="modelValue.contractFacts.contractName"
            :disabled="!editable"
            @update:model-value="updateContractFact('contractName', textValue($event))"
          />
        </label>
        <label>
          <span>合同类型</span>
          <t-select
            :model-value="modelValue.contractFacts.contractTypeKey"
            :disabled="!editable"
            :options="contractTypeOptions"
            @update:model-value="updateContractFact('contractTypeKey', textValue($event))"
          />
        </label>
        <label>
          <span>相对方</span>
          <t-input
            :model-value="modelValue.contractFacts.counterparty"
            :disabled="!editable"
            @update:model-value="updateContractFact('counterparty', textValue($event))"
          />
        </label>
        <label>
          <span>原始合同金额（分）</span>
          <t-input
            :model-value="modelValue.contractFacts.originalAmountCents"
            :disabled="!editable"
            @update:model-value="updateContractFact('originalAmountCents', textValue($event))"
          />
        </label>
        <label>
          <span>合同签订日期</span>
          <t-input
            :model-value="modelValue.signedAt"
            :disabled="!editable"
            type="date"
            @update:model-value="updateRoot('signedAt', textValue($event))"
          />
        </label>
        <label>
          <span>履约状态</span>
          <t-select
            :model-value="modelValue.performanceStatus"
            :disabled="!editable"
            :options="performanceOptions"
            @update:model-value="updateRoot('performanceStatus', performanceValue($event))"
          />
        </label>
        <label>
          <span>历史累计结算（分）</span>
          <t-input
            :model-value="modelValue.historicalSettledCents"
            :disabled="!editable"
            @update:model-value="updateRoot('historicalSettledCents', textValue($event))"
          />
        </label>
        <label>
          <span>历史结算截止日</span>
          <t-input
            :model-value="modelValue.contractFacts.settlementCutoffDate || ''"
            :disabled="!editable"
            type="date"
            @update:model-value="updateContractFact('settlementCutoffDate', textValue($event))"
          />
        </label>
      </div>

      <t-checkbox
        :checked="modelValue.contractFacts.zeroSettlementDeclared"
        :disabled="!editable"
        @change="updateZeroSettlement(Boolean($event))"
      >
        历史累计结算确认为零
      </t-checkbox>

      <label v-if="modelValue.contractFacts.zeroSettlementDeclared">
        <span>零结算依据</span>
        <t-textarea
          :model-value="modelValue.contractFacts.zeroSettlementBasis || ''"
          :disabled="!editable"
          @update:model-value="updateContractFact('zeroSettlementBasis', textValue($event))"
        />
      </label>
      <label>
        <span>历史结算依据说明</span>
        <t-textarea
          :model-value="modelValue.settlementEvidenceSummary"
          :disabled="!editable"
          @update:model-value="updateRoot('settlementEvidenceSummary', textValue($event))"
        />
      </label>
      <label>
        <span>历史付款条款原文</span>
        <t-textarea
          :model-value="modelValue.paymentTerms.originalText"
          :disabled="!editable"
          @update:model-value="updatePaymentTerms(textValue($event))"
        />
      </label>

      <div class="evidence-line">
        <span>结算依据文件 {{ modelValue.settlementEvidenceFileIds.length }} 份</span>
        <t-upload
          v-if="editable"
          :files="[]"
          :auto-upload="false"
          :max="1"
          theme="file-input"
          @change="handleEvidenceChange"
        />
      </div>
      <p class="status-line">
        {{ saving ? "合同侧保存中…" : dirty ? "合同侧有未保存修改" : statusText }}
      </p>
    </div>
    <div
      v-else
      class="empty-state"
    >
      合同侧尚未建立独立事实，请由合同岗完成首次保存。
    </div>
  </t-card>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import type {
  ContractTakeoverPerformanceStatus,
  SaveContractTakeoverContractSidePayload
} from "../../../api/core-flow-read.api";

type ContractSideFormModel = Omit<
  SaveContractTakeoverContractSidePayload,
  "idempotencyKey" | "expectedRevision"
>;

const props = defineProps<{
  modelValue: ContractSideFormModel | null;
  revision: number;
  financeBasisRevision: number;
  confirmedRevision: number | null;
  editable: boolean;
  saving: boolean;
  dirty: boolean;
  statusText: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ContractSideFormModel];
  "upload-evidence": [file: File];
}>();

const contractTypeOptions = [
  { value: "material_purchase", label: "材料采购合同" },
  { value: "equipment_rental", label: "工程机械设备租赁合同" },
  { value: "labor_subcontract", label: "劳务分包合同" },
  { value: "professional_subcontract", label: "专业分包合同" },
  { value: "generic_contract", label: "通用合同" }
];
const performanceOptions: Array<{
  value: ContractTakeoverPerformanceStatus;
  label: string;
}> = [
  { value: "not_started", label: "尚未履约" },
  { value: "performing", label: "履约中" },
  { value: "suspended", label: "暂停履约" },
  { value: "completed", label: "履约完成" },
  { value: "terminated", label: "已终止" }
];

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function performanceValue(value: unknown): ContractTakeoverPerformanceStatus {
  const normalized = textValue(value);
  return performanceOptions.some((option) => option.value === normalized)
    ? normalized as ContractTakeoverPerformanceStatus
    : "performing";
}

function updateRoot<Key extends keyof ContractSideFormModel>(
  key: Key,
  value: ContractSideFormModel[Key]
) {
  if (!props.modelValue) return;
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function updateContractFact(
  key: keyof ContractSideFormModel["contractFacts"],
  value: string
) {
  if (!props.modelValue) return;
  emit("update:modelValue", {
    ...props.modelValue,
    contractFacts: {
      ...props.modelValue.contractFacts,
      [key]: value || undefined
    }
  });
}

function updateZeroSettlement(value: boolean) {
  if (!props.modelValue) return;
  emit("update:modelValue", {
    ...props.modelValue,
    historicalSettledCents: value
      ? "0"
      : props.modelValue.historicalSettledCents,
    contractFacts: {
      ...props.modelValue.contractFacts,
      zeroSettlementDeclared: value
    }
  });
}

function updatePaymentTerms(originalText: string) {
  if (!props.modelValue) return;
  emit("update:modelValue", {
    ...props.modelValue,
    paymentTerms: {
      ...props.modelValue.paymentTerms,
      originalText
    }
  });
}

function handleEvidenceChange(files: UploadFile[]) {
  const file = files[0]?.raw;
  if (file instanceof File) {
    emit("upload-evidence", file);
  }
}
</script>

<style scoped>
.department-panel {
  min-width: 0;
}

.panel-head,
.evidence-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-3);
}

.panel-head > div,
.panel-form,
.panel-form label {
  display: grid;
  gap: var(--jg-space-2);
}

.panel-head span,
.status-line,
.empty-state {
  color: var(--jg-text-secondary);
  font-size: var(--jg-font-size-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-3);
}

@media (max-width: 720px) {
  .form-grid,
  .panel-head,
  .evidence-line {
    grid-template-columns: 1fr;
  }

  .panel-head,
  .evidence-line {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
