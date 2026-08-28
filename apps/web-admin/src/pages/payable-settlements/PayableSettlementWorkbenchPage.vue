<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { formatUnknownApiError } from "../../api/error-message";
import {
  allocatePayableSettlement,
  confirmPayableSettlement,
  fetchPaymentExecutionCandidates,
  fetchPayableSettlementCapabilities,
  fetchPayableSettlementWorkbench,
  fetchWagePayableCases,
  returnPayableSettlement,
  submitPayableSettlement,
  type PayableSettlementCandidate,
  type PayableSettlementCapabilities,
  type PayableSettlementWorkbenchItem,
  type WagePayableCaseOption
} from "../../api/payable-settlement.api";

const emptyCapabilities: PayableSettlementCapabilities = {
  read: false,
  allocate: false,
  submit: false,
  confirm: false,
  return: false
};

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref("");
const capabilities = ref<PayableSettlementCapabilities>({ ...emptyCapabilities });
const wageCases = ref<WagePayableCaseOption[]>([]);
const workbench = ref<PayableSettlementWorkbenchItem[]>([]);
const selectedPayableRef = ref("");
const caseRevision = ref(0);
const candidates = ref<PayableSettlementCandidate[]>([]);
const selectedCandidateRef = ref("");
const amountCents = ref("");
const actionVisible = ref(false);
const pendingAction = ref<"submit" | "confirm" | "return" | null>(null);
const pendingCase = ref<PayableSettlementWorkbenchItem | null>(null);

const wageCaseOptions = computed(() => wageCases.value.map((item) => ({
  value: item.payableRef,
  label: item.status === "over_settled_reconciliation_required"
    ? `${item.displayLabel} · 超额核销待核对 ${item.overSettledAmountCents} 分`
    : `${item.displayLabel} · 可核销 ${item.remainingAmountCents} 分`,
  disabled: item.status === "over_settled_reconciliation_required"
})));
const overSettledCases = computed(() => wageCases.value.filter(
  (item) => item.status === "over_settled_reconciliation_required"
));
const candidateOptions = computed(() => candidates.value.map((item) => ({
  value: item.selectionRef,
  label: `${item.displayLabel} · 可用 ${item.availableAmountCents} 分`
})));
const selectedCandidate = computed(() =>
  candidates.value.find((item) => item.selectionRef === selectedCandidateRef.value) ?? null
);
const actionTitle = computed(() => ({
  submit: "提交核销案件",
  confirm: "确认核销案件",
  return: "退回核销案件"
}[pendingAction.value ?? "submit"]));
const actionDescription = computed(() => {
  if (pendingAction.value === "confirm") {
    return "确认后将形成不可变核销事实；系统会重新核验付款与应付余额，并执行职责分离检查。";
  }
  if (pendingAction.value === "return") {
    return "退回后当前提交不会进入正式核销事实，后续只能追加新的核销修订。";
  }
  return "提交前系统会重新核验核销金额必须完整覆盖所选实际付款。";
});

const workbenchColumns = [
  { colKey: "statusLabel", title: "状态", width: 120 },
  { colKey: "allocatedAmountCents", title: "已分配金额（分）", width: 170 },
  { colKey: "revision", title: "修订", width: 90 },
  { colKey: "updatedAt", title: "更新时间", minWidth: 190 },
  { colKey: "actions", title: "操作", minWidth: 220 }
];

onMounted(loadInitial);

async function loadInitial() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [serverCapabilities, cases, rows] = await Promise.all([
      fetchPayableSettlementCapabilities(),
      fetchWagePayableCases(),
      fetchPayableSettlementWorkbench()
    ]);
    capabilities.value = serverCapabilities;
    wageCases.value = cases;
    workbench.value = rows;
    const firstAllocatable = cases.find((item) => item.status === "allocatable");
    if (!selectedPayableRef.value && firstAllocatable) {
      selectedPayableRef.value = firstAllocatable.payableRef;
      await refreshCandidates();
    }
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载工资应付核销工作台失败");
  } finally {
    loading.value = false;
  }
}

async function refreshCandidates() {
  candidates.value = [];
  selectedCandidateRef.value = "";
  amountCents.value = "";
  caseRevision.value = 0;
  if (!selectedPayableRef.value) return;
  const selectedCase = wageCases.value.find(
    (item) => item.payableRef === selectedPayableRef.value
  );
  if (selectedCase?.status === "over_settled_reconciliation_required") return;
  const result = await fetchPaymentExecutionCandidates(selectedPayableRef.value);
  candidates.value = result.candidates;
  caseRevision.value = result.caseRevision;
}

async function changeWageCase() {
  loading.value = true;
  errorMessage.value = "";
  try {
    await refreshCandidates();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载可核销付款候选失败");
  } finally {
    loading.value = false;
  }
}

async function allocatePayableSettlementWithCapability(
  payableRef: string,
  input: Parameters<typeof allocatePayableSettlement>[1]
) {
  const capability = await fetchPayableSettlementCapabilities();
  const operationAllowed = capability.allocate;
  if (!operationAllowed) throw new Error("当前账号没有保存工资应付核销草稿的权限");
  return allocatePayableSettlement(payableRef, input);
}

async function submitPayableSettlementWithCapability(
  settlementCaseId: string,
  input: Parameters<typeof submitPayableSettlement>[1]
) {
  const capability = await fetchPayableSettlementCapabilities();
  const operationAllowed = capability.submit;
  if (!operationAllowed) throw new Error("当前账号没有提交工资应付核销案件的权限");
  return submitPayableSettlement(settlementCaseId, input);
}

async function confirmPayableSettlementWithCapability(
  settlementCaseId: string,
  input: Parameters<typeof confirmPayableSettlement>[1]
) {
  const capability = await fetchPayableSettlementCapabilities();
  const operationAllowed = capability.confirm;
  if (!operationAllowed) throw new Error("当前账号没有确认工资应付核销案件的权限");
  return confirmPayableSettlement(settlementCaseId, input);
}

async function returnPayableSettlementWithCapability(
  settlementCaseId: string,
  input: Parameters<typeof returnPayableSettlement>[1]
) {
  const capability = await fetchPayableSettlementCapabilities();
  const operationAllowed = capability.return;
  if (!operationAllowed) throw new Error("当前账号没有退回工资应付核销案件的权限");
  return returnPayableSettlement(settlementCaseId, input);
}

async function allocateSelectedPayment() {
  if (submitting.value || !capabilities.value.allocate) return;
  const selected = selectedCandidate.value;
  if (!selected || !selectedPayableRef.value || !/^[1-9]\d*$/u.test(amountCents.value)) {
    errorMessage.value = "请选择付款候选并填写正整数分的核销金额";
    return;
  }
  const frozenAttempt = Object.freeze({
    payableRef: selectedPayableRef.value,
    selectionRef: selected.selectionRef,
    selectionExpiresAt: selected.expiresAt,
    amountCents: amountCents.value,
    expectedCaseRevision: caseRevision.value,
    idempotencyKey: crypto.randomUUID()
  });
  submitting.value = true;
  errorMessage.value = "";
  try {
    await allocatePayableSettlementWithCapability(frozenAttempt.payableRef, {
      selectionRef: frozenAttempt.selectionRef,
      selectionExpiresAt: frozenAttempt.selectionExpiresAt,
      amountCents: frozenAttempt.amountCents,
      expectedCaseRevision: frozenAttempt.expectedCaseRevision,
      idempotencyKey: frozenAttempt.idempotencyKey
    });
    MessagePlugin.success("工资应付核销已保存为草稿");
    await loadInitial();
    await refreshCandidates();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "保存工资应付核销失败");
    await refreshCandidates().catch(() => undefined);
  } finally {
    submitting.value = false;
  }
}

function requestAction(
  action: "submit" | "confirm" | "return",
  row: PayableSettlementWorkbenchItem
) {
  pendingAction.value = action;
  pendingCase.value = row;
  actionVisible.value = true;
}

async function executeAction() {
  if (submitting.value || !pendingAction.value || !pendingCase.value) return;
  const action = pendingAction.value;
  const row = pendingCase.value;
  submitting.value = true;
  errorMessage.value = "";
  try {
    const input = { expectedRevision: row.revision, idempotencyKey: crypto.randomUUID() };
    if (action === "submit") {
      await submitPayableSettlementWithCapability(row.settlementCaseId, input);
    }
    if (action === "confirm") {
      await confirmPayableSettlementWithCapability(row.settlementCaseId, input);
    }
    if (action === "return") {
      await returnPayableSettlementWithCapability(row.settlementCaseId, input);
    }
    actionVisible.value = false;
    pendingAction.value = null;
    pendingCase.value = null;
    MessagePlugin.success("核销案件状态已更新");
    workbench.value = await fetchPayableSettlementWorkbench();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "更新核销案件失败");
  } finally {
    submitting.value = false;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
</script>

<template>
  <section class="payable-settlement-page">
    <header>
      <div>
        <p class="eyebrow">POL-13A · 工资应付核销</p>
        <h1>工资应付核销工作台</h1>
        <p>从服务端筛选的已执行付款中明确选择并核销；页面不会展示或提交付款技术编号。</p>
      </div>
      <t-button variant="outline" :loading="loading" @click="loadInitial">刷新</t-button>
    </header>

    <t-alert v-if="errorMessage" theme="error" title="暂时无法办理" :message="errorMessage" />
    <t-alert
      v-if="overSettledCases.length"
      theme="warning"
      title="超额核销待核对"
      :message="`${overSettledCases.length} 条工资应付的有效金额低于已确认核销额，已停止新增核销，请先完成核对。`"
    />

    <t-card class="panel" title="新增核销草稿">
      <t-form label-align="top">
        <div class="form-grid">
          <t-form-item label="工资应付案件">
            <t-select
              v-model="selectedPayableRef"
              :options="wageCaseOptions"
              :loading="loading"
              placeholder="选择已确认且仍有余额的工资应付案件"
              @change="changeWageCase"
            />
          </t-form-item>
          <t-form-item label="已执行付款候选">
            <t-select
              v-model="selectedCandidateRef"
              :options="candidateOptions"
              :loading="loading"
              placeholder="选择服务端当前允许核销的付款"
            />
          </t-form-item>
          <t-form-item label="本次核销金额（整数分）">
            <t-input v-model="amountCents" placeholder="例如 400000" />
          </t-form-item>
        </div>
        <t-alert
          v-if="selectedCandidate"
          theme="info"
          title="短期选择引用"
          :message="`该候选有效至 ${formatDate(selectedCandidate.expiresAt)}；付款或应付状态变化后必须重新选择。`"
        />
        <t-button
          theme="primary"
          :disabled="!capabilities.allocate || !selectedCandidate"
          :loading="submitting"
          @click="allocateSelectedPayment"
        >
          保存核销草稿
        </t-button>
      </t-form>
    </t-card>

    <t-card class="panel" title="核销案件">
      <t-table
        row-key="settlementCaseId"
        :columns="workbenchColumns"
        :data="workbench"
        :loading="loading"
        empty="暂无核销案件"
      >
        <template #updatedAt="{ row }">{{ formatDate(row.updatedAt) }}</template>
        <template #actions="{ row }">
          <t-space>
            <t-link
              v-if="row.status === 'draft' && capabilities.submit"
              theme="primary"
              @click="requestAction('submit', row)"
            >提交</t-link>
            <t-link
              v-if="row.status === 'submitted' && capabilities.confirm"
              theme="primary"
              @click="requestAction('confirm', row)"
            >确认</t-link>
            <t-link
              v-if="row.status === 'submitted' && capabilities.return"
              theme="warning"
              @click="requestAction('return', row)"
            >退回</t-link>
          </t-space>
        </template>
      </t-table>
    </t-card>

    <SensitiveActionDialog
      v-model="actionVisible"
      :title="actionTitle"
      :description="actionDescription"
      :loading="submitting"
      @confirm="executeAction"
    />
  </section>
</template>

<style scoped>
.payable-settlement-page {
  display: grid;
  gap: var(--jg-space-lg);
}

header {
  align-items: flex-start;
  display: flex;
  gap: var(--jg-space-lg);
  justify-content: space-between;
}

h1,
p {
  margin: 0;
}

header p:not(.eyebrow) {
  color: var(--jg-color-text-secondary);
  margin-top: var(--jg-space-xs);
}

.eyebrow {
  color: var(--jg-color-brand);
  font-size: var(--jg-font-size-caption);
  font-weight: var(--jg-font-weight-semibold);
}

.panel,
.panel :deep(.t-form) {
  display: grid;
  gap: var(--jg-space-md);
}

.form-grid {
  display: grid;
  gap: var(--jg-space-md);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
