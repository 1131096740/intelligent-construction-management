<template>
  <t-card
    data-testid="contract-takeover-correction"
    :bordered="true"
  >
    <template #header>
      <div class="panel-head">
        <div>
          <strong>激活后更正</strong>
          <span>通过追加差额、重新分类或冲销更正，保留原有实付和凭证。</span>
        </div>
      </div>
    </template>

    <div
      v-if="corrections.length"
      class="correction-list"
    >
      <article
        v-for="correction in corrections"
        :key="correction.id"
        class="correction-item"
      >
        <div class="correction-title">
<ApprovalDocumentDownload  business-type="contract_takeover_correction" :business-id="correction.id" :refresh-key="correction.status" />
          <strong>{{ scopeLabel(correction.correctionScope) }} · {{ operationLabel(correction.correctionOperation) }}</strong>
          <t-tag :theme="correction.status === 'applied' ? 'success' : correction.status === 'rejected' ? 'danger' : 'warning'">
            {{ statusLabel(correction.status) }}
          </t-tag>
        </div>
        <p>改前：{{ snapshotText(correction.before) }}</p>
        <p>差额：{{ snapshotText(correction.delta) }}</p>
        <p>改后：{{ snapshotText(correction.after) }}</p>
        <p>原因：{{ correction.reason }}</p>
        <p>提交人：{{ correction.submittedByName }}；复核人：{{ correction.reviewedByName || "待复核" }}</p>
        <p v-if="correction.reviewComment">
          复核意见：{{ correction.reviewComment }}
        </p>
        <div
          v-if="canReview && correction.status === 'submitted'"
          class="actions"
        >
          <t-button
            size="small"
            theme="primary"
            @click="$emit('review', { correctionId: correction.id, decision: 'apply' })"
          >
            复核并应用
          </t-button>
          <t-button
            size="small"
            theme="danger"
            variant="outline"
            @click="$emit('review', { correctionId: correction.id, decision: 'reject' })"
          >
            驳回
          </t-button>
        </div>
      </article>
    </div>
    <div
      v-else
      class="empty-state"
    >
      暂无更正记录。
    </div>

    <div
      v-if="canSubmit"
      class="correction-form"
    >
      <div class="form-grid">
        <label>
          <span>更正范围</span>
          <t-select
            v-model="form.correctionScope"
            :options="scopeOptions"
            @change="resetTargets"
          />
        </label>
        <label>
          <span>更正动作</span>
          <t-select
            v-model="form.correctionOperation"
            :options="availableOperationOptions"
            @change="resetTargets"
          />
        </label>
        <label v-if="form.correctionScope === 'historical_payment'">
          <span>目标历史实付</span>
          <t-select
            v-model="form.targetHistoricalPaymentId"
            :options="paymentOptions"
            @change="selectPayment"
          />
        </label>
        <label v-if="form.correctionScope === 'historical_payment'">
          <span>目标实付分配</span>
          <t-select
            v-model="form.targetAllocationId"
            :options="allocationOptions"
          />
        </label>
        <label v-if="isBalanceScope">
          <span>目标余额账户</span>
          <t-select
            v-model="form.targetBalanceId"
            :options="balanceOptions"
            @change="selectBalance"
          />
        </label>
        <label
          v-if="isBalanceScope && form.correctionOperation === 'reclassification'"
        >
          <span>目标来源分配</span>
          <t-select
            v-model="form.targetAllocationId"
            :options="balanceAllocationOptions"
          />
        </label>
        <label v-if="form.correctionOperation === 'reversal'">
          <span>目标原流水</span>
          <t-select
            v-model="form.targetBalanceEntryId"
            :options="balanceEntryOptions"
          />
        </label>
        <label v-if="form.correctionOperation === 'reclassification'">
          <span>重分类目标</span>
          <t-select
            v-model="form.reclassificationTarget"
            :options="reclassificationOptions"
          />
        </label>
        <label v-if="form.correctionOperation !== 'reversal'">
          <span>差额（元，可正可负）</span>
          <YuanMoneyInput v-model="form.deltaCents" signed />
        </label>
        <label>
          <span>更正责任人</span>
          <t-select
            v-model="form.responsibleUserId"
            :options="responsibleOptions"
            filterable
          />
        </label>
        <label>
          <span>更正原因</span>
          <t-textarea v-model="form.reason" />
        </label>
        <label>
          <span>当前登录密码</span>
          <t-input
            v-model="form.currentPassword"
            type="password"
            autocomplete="current-password"
          />
        </label>
        <label>
          <span>独占更正依据</span>
          <t-upload
            v-model="attachmentFiles"
            :auto-upload="false"
            :max="1"
            theme="file-input"
          />
        </label>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          :loading="submitting"
          :disabled="!canSubmitDraft"
          @click="submitDraft"
        >
          提交更正复核
        </t-button>
      </div>
    </div>
  </t-card>
</template>

<script setup lang="ts">
import ApprovalDocumentDownload from "../../../components/approval/ApprovalDocumentDownload.vue";
import YuanMoneyInput from "../../../components/YuanMoneyInput.vue";
import { centsTextToYuanText } from "../../../lib/money";
import type { UploadFile } from "tdesign-vue-next";
import { computed, reactive, ref, watch } from "vue";
import type {
  ContractTakeoverAppliedCorrectionReadModel,
  ContractTakeoverBalanceReadModel,
  ContractTakeoverCorrectionOperation,
  ContractTakeoverCorrectionScope,
  ContractTakeoverHistoricalPaymentReadModel
} from "../../../api/core-flow-read.api";

const props = defineProps<{
  corrections: ContractTakeoverAppliedCorrectionReadModel[];
  payments: ContractTakeoverHistoricalPaymentReadModel[];
  balances: ContractTakeoverBalanceReadModel[];
  contractRevision: number;
  financeRevision: number;
  responsibleOptions: Array<{ value: string; label: string }>;
  allowedScopes: ContractTakeoverCorrectionScope[];
  canSubmit: boolean;
  canReview: boolean;
  submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: {
    correctionScope: ContractTakeoverCorrectionScope;
    correctionOperation: ContractTakeoverCorrectionOperation;
    targetRevision: number;
    targetBalanceRevision?: number;
    deltaCents?: string;
    targetHistoricalPaymentId?: string;
    targetAllocationId?: string;
    targetBalanceEntryId?: string;
    reclassificationTarget?: "historical_advance" | "abnormal_overpay";
    reason: string;
    responsibleUserId: string;
    currentPassword: string;
    file: File;
  }];
  review: [payload: {
    correctionId: string;
    decision: "apply" | "reject";
  }];
}>();

const allScopeOptions = [
  { value: "historical_settlement", label: "历史累计结算" },
  { value: "historical_payment", label: "逐笔历史实付" },
  { value: "historical_advance", label: "历史预付款余额" },
  { value: "abnormal_overpay", label: "异常超付余额" }
] satisfies Array<{ value: ContractTakeoverCorrectionScope; label: string }>;
const scopeOptions = computed(() =>
  allScopeOptions.filter((option) => props.allowedScopes.includes(option.value))
);
const operationOptions = [
  { value: "correction", label: "差额更正" },
  { value: "reclassification", label: "余额重分类" },
  { value: "reversal", label: "精确反向" }
] satisfies Array<{ value: ContractTakeoverCorrectionOperation; label: string }>;
const reclassificationOptions = [
  { value: "historical_advance", label: "转为历史预付款" },
  { value: "abnormal_overpay", label: "转为异常超付" }
];
const form = reactive({
  correctionScope: "historical_settlement" as ContractTakeoverCorrectionScope,
  correctionOperation: "correction" as ContractTakeoverCorrectionOperation,
  targetHistoricalPaymentId: "",
  targetAllocationId: "",
  targetBalanceId: "",
  targetBalanceEntryId: "",
  reclassificationTarget: "" as "" | "historical_advance" | "abnormal_overpay",
  deltaCents: "",
  reason: "",
  responsibleUserId: "",
  currentPassword: ""
});
const attachmentFiles = ref<UploadFile[]>([]);

watch(
  () => props.allowedScopes,
  (scopes) => {
    if (scopes.includes(form.correctionScope)) return;
    form.correctionScope = scopes[0] ?? "historical_settlement";
    resetTargets();
  },
  { immediate: true }
);

const isBalanceScope = computed(() =>
  ["historical_advance", "abnormal_overpay"].includes(form.correctionScope)
);
const availableOperationOptions = computed(() =>
  isBalanceScope.value
    ? operationOptions
    : operationOptions.filter((option) => option.value === "correction")
);
const selectedPayment = computed(() =>
  props.payments.find((payment) => payment.id === form.targetHistoricalPaymentId)
);
const selectedAllocation = computed(() =>
  selectedPayment.value?.allocations.find(
    (allocation) => allocation.id === form.targetAllocationId
  )
);
const selectedBalance = computed(() =>
  props.balances.find((balance) => balance.id === form.targetBalanceId)
);
const paymentAllocationBalance = computed(() => {
  const type = selectedAllocation.value?.allocationType;
  if (type !== "historical_advance" && type !== "abnormal_overpay") return null;
  return props.balances.find((balance) => balance.balanceType === type) ?? null;
});
const paymentOptions = computed(() =>
  props.payments.map((payment) => ({
    value: payment.id,
    label: `第 ${payment.sequenceNo} 笔 · ${centsTextToYuanText(payment.amountCents)} 元`
  }))
);
const allocationOptions = computed(() =>
  (selectedPayment.value?.allocations ?? []).map((allocation) => ({
    value: allocation.id,
    label: `${allocationLabel(allocation.allocationType)} · ${centsTextToYuanText(allocation.amountCents)} 元`
  }))
);
const balanceOptions = computed(() =>
  props.balances
    .filter((balance) => balance.balanceType === form.correctionScope)
    .map((balance) => ({
      value: balance.id,
      label: `${scopeLabel(balance.balanceType)} · 当前 ${centsTextToYuanText(balance.balanceCents)} 元`
    }))
);
const balanceAllocationOptions = computed(() =>
  props.payments.flatMap((payment) =>
    payment.allocations
      .filter((allocation) => allocation.allocationType === form.correctionScope)
      .map((allocation) => ({
        value: allocation.id,
        label: `第 ${payment.sequenceNo} 笔 · ${centsTextToYuanText(allocation.amountCents)} 元`
      }))
  )
);
const balanceEntryOptions = computed(() =>
  (selectedBalance.value?.entries ?? [])
    .filter((entry) => entry.entryKind === "deduction")
    .map((entry) => ({
      value: entry.id,
      label: `已扣减流水 · ${centsTextToYuanText(entry.amountCents)} 元`
    }))
);
const canSubmitDraft = computed(() => {
  const file = attachmentFiles.value[0]?.raw;
  const targetReady =
    form.correctionScope === "historical_settlement"
      ? form.correctionOperation === "correction"
      : form.correctionScope === "historical_payment"
        ? form.correctionOperation === "correction" &&
          Boolean(form.targetHistoricalPaymentId && form.targetAllocationId)
        : form.correctionOperation === "reversal"
          ? Boolean(form.targetBalanceId && form.targetBalanceEntryId)
          : form.correctionOperation === "reclassification"
            ? Boolean(
                form.targetBalanceId &&
                form.targetAllocationId &&
                form.reclassificationTarget &&
                form.reclassificationTarget !== form.correctionScope
              )
            : Boolean(form.targetBalanceId);
  return Boolean(
    file instanceof File &&
    form.reason.trim() &&
    form.responsibleUserId &&
    form.currentPassword.trim() &&
    targetReady &&
    (form.correctionOperation === "reversal" ||
      /^-?[1-9]\d*$/u.test(form.deltaCents.trim()))
  );
});

watch(
  () => form.correctionScope,
  () => {
    if (
      !availableOperationOptions.value.some(
        (option) => option.value === form.correctionOperation
      )
    ) {
      form.correctionOperation = "correction";
    }
  }
);

function allocationLabel(value: string) {
  return ({ settlement: "结算核销", historical_advance: "历史预付款", abnormal_overpay: "异常超付" } as Record<string, string>)[value] ?? "历史实付分配";
}

function scopeLabel(scope: string) {
  return allScopeOptions.find((option) => option.value === scope)?.label ?? scope;
}

function operationLabel(operation: string) {
  return operationOptions.find((option) => option.value === operation)?.label ?? operation;
}

function statusLabel(status: string) {
  return {
    draft: "草稿",
    submitted: "待复核",
    applied: "已应用",
    rejected: "已驳回"
  }[status] ?? status;
}

function snapshotText(value: unknown) {
  if (!value || typeof value !== "object") return "无金额变化";
  const labels: Record<string, string> = { amountCents: "金额", deltaCents: "调整差额", balanceCents: "余额", openingCents: "期初金额", historicalSettledCents: "累计结算", historicalPaidCents: "累计实付", sourceBalanceCents: "来源余额", originalEntryAmountCents: "原记录金额" };
  const amounts = Object.entries(value).flatMap(([key, amount]) =>
    /Cents$/.test(key) && typeof amount === "string" && /^-?\d+$/.test(amount)
      ? [`${labels[key] ?? "金额"} ${centsTextToYuanText(amount)} 元`] : []
  );
  const factLabels: Record<string, string> = { allocationType: "分配类型", sourceType: "来源", targetType: "目标", from: "转出", to: "转入", originalEntryKind: "原记录类型" };
  const typeLabels: Record<string, string> = { historical_settlement: "历史结算", settlement: "结算核销", historical_advance: "历史预付款", abnormal_overpay: "异常超付", opening: "期初", deduction: "抵扣", reversal: "冲销", correction: "更正", adjustment: "调整", reclassification: "重新分类" };
  const facts = Object.entries(value).flatMap(([key, fact]) =>
    factLabels[key] && typeof fact === "string" ? [`${factLabels[key]}：${typeLabels[fact] ?? "历史记录"}`] : []
  );
  return [...amounts, ...facts].join("；") || "无金额变化";
}

function resetTargets() {
  form.targetHistoricalPaymentId = "";
  form.targetAllocationId = "";
  form.targetBalanceId = "";
  form.targetBalanceEntryId = "";
  form.reclassificationTarget = "";
}

function selectPayment() {
  form.targetAllocationId = selectedPayment.value?.allocations[0]?.id ?? "";
}

function selectBalance() {
  form.targetBalanceEntryId = "";
}

function submitDraft() {
  const file = attachmentFiles.value[0]?.raw;
  if (!(file instanceof File) || !canSubmitDraft.value) return;
  emit("submit", {
    correctionScope: form.correctionScope,
    correctionOperation: form.correctionOperation,
    targetRevision:
      form.correctionScope === "historical_settlement"
        ? props.contractRevision
        : props.financeRevision,
    ...(selectedBalance.value || paymentAllocationBalance.value
      ? {
          targetBalanceRevision:
            selectedBalance.value?.revision ??
            paymentAllocationBalance.value?.revision
        }
      : {}),
    ...(form.correctionOperation === "reversal"
      ? {}
      : { deltaCents: form.deltaCents.trim() }),
    ...(form.targetHistoricalPaymentId
      ? { targetHistoricalPaymentId: form.targetHistoricalPaymentId }
      : {}),
    ...(form.targetAllocationId
      ? { targetAllocationId: form.targetAllocationId }
      : {}),
    ...(form.targetBalanceEntryId
      ? { targetBalanceEntryId: form.targetBalanceEntryId }
      : {}),
    ...(form.reclassificationTarget
      ? { reclassificationTarget: form.reclassificationTarget }
      : {}),
    reason: form.reason.trim(),
    responsibleUserId: form.responsibleUserId,
    currentPassword: form.currentPassword,
    file
  });
}
</script>

<style scoped>
.panel-head,
.panel-head > div,
.correction-list,
.correction-item,
.correction-form {
  display: grid;
  gap: var(--jg-space-3);
}

.panel-head span,
.empty-state,
.correction-item p {
  color: var(--jg-text-secondary);
}

.correction-item {
  padding: var(--jg-space-3);
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-md);
}

.correction-title,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-2);
  flex-wrap: wrap;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-3);
}

.form-grid label {
  display: grid;
  gap: var(--jg-space-2);
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
