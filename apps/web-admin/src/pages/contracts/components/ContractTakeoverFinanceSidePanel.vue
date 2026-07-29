<template>
  <t-card
    class="department-panel"
    data-testid="contract-takeover-finance-side"
    :bordered="true"
  >
    <template #header>
      <div class="panel-head">
        <div>
          <strong>财务侧资料</strong>
          <span>财务侧修订 v{{ revision }} · 依据合同 v{{ basedOnContractRevision }}/基线 v{{ basedOnFinanceBasisRevision }}</span>
        </div>
        <t-tag :theme="basisTone">
          {{ basisLabel }}
        </t-tag>
      </div>
    </template>

    <div
      v-if="modelValue"
      class="panel-form"
    >
      <t-button
        v-if="editable && basisTone === 'danger'"
        variant="outline"
        size="small"
        @click="$emit('reload-basis')"
      >
        重新读取依据并保留当前输入
      </t-button>
      <t-checkbox
        :checked="modelValue.zeroPaymentDeclared"
        :disabled="!editable"
        @change="updateZeroPayment(Boolean($event))"
      >
        截止接管日没有历史实付
      </t-checkbox>

      <div
        v-for="(payment, index) in modelValue.payments"
        :key="payment.rowKey"
        class="payment-card"
      >
        <div class="payment-head">
          <strong>第 {{ index + 1 }} 笔历史实付</strong>
          <t-button
            v-if="editable"
            size="small"
            theme="danger"
            variant="text"
            @click="removePayment(index)"
          >
            移除
          </t-button>
        </div>
        <div class="form-grid">
          <label>
            <span>实付金额（分）</span>
            <t-input
              :model-value="payment.amountCents"
              :disabled="!editable"
              @update:model-value="updatePayment(index, 'amountCents', textValue($event))"
            />
          </label>
          <label>
            <span>实付日期</span>
            <t-input
              :model-value="payment.paidAt"
              :disabled="!editable"
              type="date"
              @update:model-value="updatePayment(index, 'paidAt', textValue($event))"
            />
          </label>
          <label>
            <span>付款单位</span>
            <t-input
              :model-value="payment.payerName || ''"
              :disabled="!editable"
              @update:model-value="updatePayment(index, 'payerName', textValue($event))"
            />
          </label>
          <label>
            <span>收款单位</span>
            <t-input
              :model-value="payment.payeeName || ''"
              :disabled="!editable"
              @update:model-value="updatePayment(index, 'payeeName', textValue($event))"
            />
          </label>
          <label>
            <span>银行流水说明</span>
            <t-input
              :model-value="payment.bankReference || ''"
              :disabled="!editable"
              @update:model-value="updatePayment(index, 'bankReference', textValue($event))"
            />
          </label>
          <label>
            <span>付款方式</span>
            <t-input
              :model-value="payment.paymentMethod || ''"
              :disabled="!editable"
              @update:model-value="updatePayment(index, 'paymentMethod', textValue($event))"
            />
          </label>
        </div>
        <div class="evidence-line">
          <span>独占凭证 {{ payment.voucherFileIds.length }} 份</span>
          <t-upload
            v-if="editable"
            :files="[]"
            :auto-upload="false"
            :max="1"
            theme="file-input"
            @change="handleVoucherChange(payment.rowKey, $event)"
          />
        </div>
        <div
          v-if="payment.allocations?.length"
          class="allocation-list"
        >
          <span
            v-for="allocation in payment.allocations"
            :key="allocation.id"
          >
            {{ allocation.allocationType }}：{{ allocation.amountCents }} 分
          </span>
        </div>
      </div>

      <t-button
        v-if="editable && !modelValue.zeroPaymentDeclared"
        variant="outline"
        @click="addPayment"
      >
        增加一笔历史实付
      </t-button>

      <div class="form-grid">
        <label>
          <span>超额分类</span>
          <t-select
            :model-value="modelValue.excessTreatment"
            :disabled="!editable"
            clearable
            :options="excessOptions"
            @update:model-value="updateRoot('excessTreatment', excessValue($event))"
          />
        </label>
        <label>
          <span>超额分类原因</span>
          <t-input
            :model-value="modelValue.excessReason || ''"
            :disabled="!editable"
            @update:model-value="updateRoot('excessReason', textValue($event) || undefined)"
          />
        </label>
      </div>
      <div class="evidence-line">
        <span>超额分类依据 {{ modelValue.excessEvidenceFileIds?.length || 0 }} 份</span>
        <t-upload
          v-if="editable"
          :files="[]"
          :auto-upload="false"
          :max="1"
          theme="file-input"
          @change="handleExcessEvidenceChange"
        />
      </div>

      <div
        v-if="balances.length"
        class="balance-grid"
      >
        <div
          v-for="balance in balances"
          :key="balance.id"
          class="balance-card"
        >
          <strong>{{ balance.balanceType === "historical_advance" ? "历史预付款余额" : "异常超付余额" }}</strong>
          <span>期初 {{ balance.openingCents }} 分</span>
          <span>当前 {{ balance.balanceCents }} 分 · 修订 v{{ balance.revision }}</span>
        </div>
      </div>
      <p class="status-line">
        {{ saving ? "财务侧保存中…" : dirty ? "财务侧有未保存修改" : statusText }}
      </p>
    </div>
    <div
      v-else
      class="empty-state"
    >
      财务侧尚未建立独立事实；请先等待合同侧完成首次保存。
    </div>
  </t-card>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import type {
  ContractTakeoverBalanceReadModel,
  SaveContractTakeoverFinanceSidePayload
} from "../../../api/core-flow-read.api";

type FinancePaymentForm =
  SaveContractTakeoverFinanceSidePayload["payments"][number] & {
    allocations?: Array<{
      id: string;
      allocationType: string;
      amountCents: string;
    }>;
  };
type FinanceSideFormModel = Omit<
  SaveContractTakeoverFinanceSidePayload,
  "idempotencyKey" | "expectedRevision"
> & {
  payments: FinancePaymentForm[];
};

const props = defineProps<{
  modelValue: FinanceSideFormModel | null;
  revision: number;
  basedOnContractRevision: number;
  basedOnFinanceBasisRevision: number;
  basisLabel: string;
  basisTone: "success" | "warning" | "danger";
  balances: ContractTakeoverBalanceReadModel[];
  editable: boolean;
  saving: boolean;
  dirty: boolean;
  statusText: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: FinanceSideFormModel];
  "upload-voucher": [payload: { rowKey: string; file: File }];
  "upload-excess-evidence": [file: File];
  "reload-basis": [];
}>();

const excessOptions = [
  { value: "historical_advance", label: "历史预付款" },
  { value: "abnormal_overpay", label: "异常超付" }
];

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function excessValue(
  value: unknown
): FinanceSideFormModel["excessTreatment"] {
  const normalized = textValue(value);
  return normalized === "historical_advance" || normalized === "abnormal_overpay"
    ? normalized
    : undefined;
}

function updateRoot<Key extends keyof FinanceSideFormModel>(
  key: Key,
  value: FinanceSideFormModel[Key]
) {
  if (!props.modelValue) return;
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function updateZeroPayment(value: boolean) {
  if (!props.modelValue) return;
  emit("update:modelValue", {
    ...props.modelValue,
    zeroPaymentDeclared: value,
    payments: value ? [] : props.modelValue.payments
  });
}

function updatePayment(
  index: number,
  key: keyof FinancePaymentForm,
  value: string
) {
  if (!props.modelValue) return;
  const payments = props.modelValue.payments.map((payment, paymentIndex) =>
    paymentIndex === index ? { ...payment, [key]: value || undefined } : payment
  );
  emit("update:modelValue", { ...props.modelValue, payments });
}

function addPayment() {
  if (!props.modelValue) return;
  emit("update:modelValue", {
    ...props.modelValue,
    payments: [
      ...props.modelValue.payments,
      {
        rowKey: crypto.randomUUID(),
        amountCents: "",
        paidAt: "",
        voucherFileIds: []
      }
    ]
  });
}

function removePayment(index: number) {
  if (!props.modelValue) return;
  emit("update:modelValue", {
    ...props.modelValue,
    payments: props.modelValue.payments.filter(
      (_payment, paymentIndex) => paymentIndex !== index
    )
  });
}

function handleVoucherChange(rowKey: string, files: UploadFile[]) {
  const file = files[0]?.raw;
  if (file instanceof File) {
    emit("upload-voucher", { rowKey, file });
  }
}

function handleExcessEvidenceChange(files: UploadFile[]) {
  const file = files[0]?.raw;
  if (file instanceof File) {
    emit("upload-excess-evidence", file);
  }
}
</script>

<style scoped>
.department-panel,
.panel-form {
  min-width: 0;
}

.panel-form,
.payment-card,
.balance-card {
  display: grid;
  gap: var(--jg-space-3);
}

.panel-head,
.payment-head,
.evidence-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--jg-space-3);
}

.panel-head > div {
  display: grid;
  gap: var(--jg-space-1);
}

.panel-head span,
.status-line,
.empty-state {
  color: var(--jg-text-secondary);
  font-size: var(--jg-font-size-sm);
}

.form-grid,
.balance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-3);
}

.form-grid label {
  display: grid;
  gap: var(--jg-space-2);
}

.payment-card,
.balance-card {
  padding: var(--jg-space-3);
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-md);
}

.allocation-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-2);
  color: var(--jg-text-secondary);
}

@media (max-width: 720px) {
  .form-grid,
  .balance-grid {
    grid-template-columns: 1fr;
  }

  .panel-head,
  .evidence-line {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
