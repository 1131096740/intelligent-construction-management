<template>
  <section
    class="financing-quota-panel"
    aria-labelledby="project-financing-quota-title"
  >
    <t-card
      :bordered="true"
      class="financing-quota-card"
    >
      <div class="panel-heading">
        <div>
          <h2 id="project-financing-quota-title">
            项目垫资额度
          </h2>
          <p>额度生命周期与实际付款分配记录以服务端台账为准。</p>
        </div>
        <div class="panel-heading-actions">
          <t-button
            v-if="requestActionEnabled(workbench.requestAction)"
            theme="primary"
            :loading="requestOpening"
            @click="openRequest"
          >
            {{ workbench.requestAction.label }}
          </t-button>
          <t-tag
            theme="primary"
            variant="light"
          >
            权威台账
          </t-tag>
        </div>
      </div>

      <t-alert
        v-if="requestNotice"
        theme="success"
        :message="requestNotice"
        class="request-alert"
      />
      <t-alert
        v-if="requestLaunchError"
        theme="error"
        title="申请资格校验失败"
        :message="requestLaunchError"
        class="request-alert"
      />

      <t-alert
        theme="info"
        title="固定资金分配顺序"
      >
        <strong>自有资金优先</strong>，不足部分再由<strong>垫资额度补足</strong>；使用人不能手工调整或重排两类资金。
      </t-alert>

      <div class="summary-grid">
        <div class="summary-item">
          <span>累计额度金额</span>
          <strong>{{ formatMoney(workbench.summary.quotaAmountCents) }}</strong>
        </div>
        <div class="summary-item">
          <span>额度已使用净额</span>
          <strong>{{ formatMoney(workbench.summary.netUsedAmountCents) }}</strong>
        </div>
        <div class="summary-item">
          <span>当前可用额度</span>
          <strong>{{ formatMoney(workbench.summary.currentlyAvailableAmountCents) }}</strong>
        </div>
        <div class="summary-item">
          <span>生命周期记录</span>
          <strong>{{ workbench.rows.length }} 条</strong>
        </div>
      </div>
    </t-card>

    <t-card
      title="额度生命周期"
      :bordered="true"
      class="financing-quota-card jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="quotaColumns"
        :data="workbench.rows"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无项目垫资额度记录"
      >
        <template #reason="{ row }">
          <div class="reason-cell">
            <strong>{{ row.reason }}</strong>
            <span>{{ row.requestedByName || "未记录申请人" }} · {{ formatDateTime(row.createdAt) }}</span>
          </div>
        </template>
        <template #amountCents="{ row }">
          {{ formatMoney(row.amountCents) }}
        </template>
        <template #netUsedAmountCents="{ row }">
          {{ formatMoney(row.netUsedAmountCents) }}
        </template>
        <template #availableAmountCents="{ row }">
          {{ formatMoney(row.availableAmountCents) }}
        </template>
        <template #status="{ row }">
          <div class="status-cell">
            <t-tag
              :theme="statusTheme(row.status, row.isExpired)"
              variant="light"
            >
              {{ row.statusLabel }}
            </t-tag>
            <template v-if="row.status === 'terminated'">
              <span>终止人：{{ row.terminatedByName || "未记录" }}</span>
              <span>
                终止时间：{{ row.terminatedAt ? formatDateTime(row.terminatedAt) : "未记录" }}
              </span>
              <span class="termination-reason">
                终止原因：{{ row.terminationReason || "未记录" }}
              </span>
            </template>
            <span v-else-if="row.currentApproval?.currentNodeName">
              当前节点：{{ row.currentApproval.currentNodeName }}
            </span>
            <span v-else-if="row.approvedByName">
              批准人：{{ row.approvedByName }}
            </span>
          </div>
        </template>
        <template #validUntil="{ row }">
          {{ row.validUntil ? formatDate(row.validUntil) : "长期有效" }}
        </template>
      </t-table>
    </t-card>

    <t-card
      title="不可变资金使用记录"
      :bordered="true"
      class="financing-quota-card jg-table-region jg-table-region--standard"
    >
      <p class="usage-description">
        每笔实际付款保留自有资金、全部垫资额度与当前额度的借贷发生额，冲正也作为独立历史保留。
      </p>
      <t-table
        row-key="key"
        size="small"
        :columns="usageColumns"
        :data="usageRows"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无垫资额度实际使用记录"
      >
        <template #quota="{ row }">
          <div class="reason-cell">
            <strong>{{ row.quotaReason }}</strong>
            <span>{{ shortId(row.quotaId) }}</span>
          </div>
        </template>
        <template #business="{ row }">
          <div class="reason-cell">
            <strong>{{ businessTypeLabel(row.businessType) }}</strong>
            <span>{{ shortId(row.businessId) }}</span>
          </div>
        </template>
        <template #projectCashNetAmountCents="{ row }">
          {{ formatMoney(row.projectCashNetAmountCents) }}
        </template>
        <template #financingQuotaNetAmountCents="{ row }">
          {{ formatMoney(row.financingQuotaNetAmountCents) }}
        </template>
        <template #currentQuotaNetAmountCents="{ row }">
          <div class="amount-breakdown">
            <strong>{{ formatMoney(row.currentQuotaNetAmountCents) }}</strong>
            <span>借 {{ formatMoney(row.currentQuotaDebitAmountCents) }}</span>
            <span>贷 {{ formatMoney(row.currentQuotaCreditAmountCents) }}</span>
          </div>
        </template>
        <template #occurredAt="{ row }">
          {{ formatDateTime(row.occurredAt) }}
        </template>
      </t-table>
    </t-card>

    <t-dialog
      v-if="requestArmed && selectedFinancingQuotaRequestAction && selectedFinancingQuotaRequestAction.enabled"
      :visible="requestVisible"
      header="申请项目垫资额度"
      width="min(620px, calc(100vw - 32px))"
      :confirm-btn="{
        content: '提交申请',
        theme: 'primary',
        loading: requestBusy,
        disabled: requestBusy || !selectedFinancingQuotaRequestAction?.enabled
      }"
      :cancel-btn="{ content: '取消', disabled: requestBusy }"
      :close-btn="!requestBusy"
      :close-on-esc-keydown="!requestBusy"
      :close-on-overlay-click="false"
      @confirm="submitRequest"
      @cancel="cancelRequest"
      @close="cancelRequest"
      @update:visible="handleRequestVisibleChange"
    >
      <div class="request-form">
        <t-alert
          theme="info"
          message="提交后进入财务主管→董事长/总经理审批；审批通过不等于已发生实际付款。"
        />
        <t-input
          v-model="requestForm.amountYuan"
          label="申请金额（元）"
          placeholder="例如 50000.00"
          :disabled="requestAttempted"
        />
        <t-textarea
          v-model="requestForm.reason"
          label="申请事由"
          placeholder="说明项目阶段、资金缺口与预计用途"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="500"
          :disabled="requestAttempted"
        />
        <t-date-picker
          v-model="requestForm.validUntil"
          label="有效期（选填）"
          value-type="YYYY-MM-DD"
          placeholder="不填则由审批结果约束"
          :disabled="requestAttempted"
        />
        <div class="request-file-field">
          <span>申请依据（必传 1 份）</span>
          <t-upload
            v-model="requestFiles"
            theme="file"
            :auto-upload="false"
            :multiple="false"
            :max="1"
            :disabled="requestAttempted"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
          />
        </div>
        <t-alert
          v-if="requestError"
          theme="error"
          :message="requestError"
        />
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch
} from "vue";
import type { UploadFile } from "tdesign-vue-next";
import { centsTextToYuanText } from "../../../lib/money";
import {
  createProjectFinancingQuotaRequestAttemptState,
  fetchProjectFinancingQuotaRequestCapability,
  requestProjectFinancingQuotaWithUpload,
  type ProjectFinancingQuotaActionReadModel,
  type ProjectFinancingQuotaRequestAttemptState,
  type ProjectFinancingQuotaStatus,
  type ProjectFinancingQuotaWorkbenchReadModel
} from "../../../api/project-financing-quota.api";

const props = defineProps<{
  projectId: string;
  workbench: ProjectFinancingQuotaWorkbenchReadModel;
}>();
const emit = defineEmits<{
  updated: [workbench: ProjectFinancingQuotaWorkbenchReadModel];
}>();

type RequestContext = {
  projectId: string;
  projectGeneration: number;
  idempotencyKey: string;
};

type RequestOperationContext = RequestContext & {
  operationId: number;
};

const EMPTY_REQUEST_CONTEXT: RequestContext = {
  projectId: "",
  projectGeneration: -1,
  idempotencyKey: ""
};

const requestVisible = ref(false);
const requestOpening = ref(false);
const requestBusy = ref(false);
const requestAttempted = ref(false);
const requestError = ref("");
const requestLaunchError = ref("");
const requestNotice = ref("");
const requestFiles = ref<UploadFile[]>([]);
const requestForm = ref(createRequestForm());
const requestContext = ref<RequestContext>({ ...EMPTY_REQUEST_CONTEXT });
const selectedFinancingQuotaRequestAction = shallowRef<
  ProjectFinancingQuotaActionReadModel | null
>(null);
const requestArmed = ref(false);
let componentAlive = true;
let projectGeneration = 0;
let requestOpenSequence = 0;
let requestOperationSequence = 0;
let activeRequestOperationId = 0;
let requestAttemptState: ProjectFinancingQuotaRequestAttemptState =
  createProjectFinancingQuotaRequestAttemptState();

onBeforeUnmount(() => {
  componentAlive = false;
  projectGeneration += 1;
  requestOpenSequence += 1;
  activeRequestOperationId = 0;
});

watch(
  () => props.projectId,
  () => {
    projectGeneration += 1;
    requestOpenSequence += 1;
    activeRequestOperationId = 0;
    requestOpening.value = false;
    requestBusy.value = false;
    clearRequestSelection();
    requestLaunchError.value = "";
    requestNotice.value = "";
  }
);

const quotaColumns = [
  { colKey: "reason", title: "申请事由 / 申请人", minWidth: 240 },
  { colKey: "amountCents", title: "额度金额", width: 130 },
  { colKey: "netUsedAmountCents", title: "已使用净额", width: 130 },
  { colKey: "availableAmountCents", title: "当前可用", width: 130 },
  { colKey: "status", title: "状态 / 当前节点", minWidth: 190 },
  { colKey: "validUntil", title: "有效期", width: 130 }
];

const usageColumns = [
  { colKey: "quota", title: "所属额度", minWidth: 210 },
  { colKey: "business", title: "业务对象", minWidth: 170 },
  { colKey: "projectCashNetAmountCents", title: "自有资金净额", width: 145 },
  { colKey: "financingQuotaNetAmountCents", title: "全部垫资净额", width: 145 },
  { colKey: "currentQuotaNetAmountCents", title: "本额度借 / 贷 / 净额", width: 180 },
  { colKey: "occurredAt", title: "发生时间", width: 170 }
];

const usageRows = computed(() =>
  props.workbench.rows.flatMap((quota) =>
    quota.usageGroups.map((usageGroup) => ({
      ...usageGroup,
      key: `${quota.id}:${usageGroup.executionType}:${usageGroup.executionId}`,
      quotaId: quota.id,
      quotaReason: quota.reason
    }))
  )
);

async function openRequest() {
  if (
    requestOpening.value ||
    requestBusy.value ||
    props.workbench.project.id !== props.projectId ||
    !requestActionEnabled(props.workbench.requestAction)
  ) {
    return;
  }

  clearRequestSelection();
  const context: RequestContext = {
    projectId: props.projectId,
    projectGeneration,
    idempotencyKey: crypto.randomUUID()
  };
  const openRequestId = ++requestOpenSequence;
  requestContext.value = context;
  requestOpening.value = true;
  requestLaunchError.value = "";
  requestNotice.value = "";
  try {
    const freshCapability =
      await fetchProjectFinancingQuotaRequestCapability(context.projectId);
    if (!requestOpenContextIsCurrent(context, openRequestId)) return;
    if (
      freshCapability?.project?.id !== context.projectId ||
      freshCapability?.requestAction?.key !== "request_financing_quota" ||
      typeof freshCapability?.requestAction?.enabled !== "boolean" ||
      freshCapability?.requestAction?.requiresFile !== true ||
      freshCapability?.requestAction?.requiredAction !==
        "project.financing_quota.request"
    ) {
      throw new Error("项目垫资额度申请资格数据异常，请刷新后重试");
    }
    if (freshCapability.requestAction.enabled !== true) {
      throw new Error("项目垫资额度申请资格已变化，请刷新后重试");
    }
    selectedFinancingQuotaRequestAction.value = freshCapability.requestAction;
    requestAttemptState =
      createProjectFinancingQuotaRequestAttemptState();
    requestArmed.value = true;
    requestVisible.value = true;
  } catch (error) {
    if (requestOpenOperationIsCurrent(context, openRequestId)) {
      requestContext.value = { ...EMPTY_REQUEST_CONTEXT };
      requestLaunchError.value = errorMessage(
        error instanceof SyntaxError
          ? new Error("项目垫资额度申请资格数据异常，请刷新后重试")
          : error,
        "项目垫资额度申请资格校验失败"
      );
    }
  } finally {
    if (requestOpenOperationIsCurrent(context, openRequestId)) {
      requestOpening.value = false;
    }
  }
}

function submitRequest() {
  const context = captureRequestOperation();
  const request = requestProjectFinancingQuotaWithUpload(
    context.projectId,
    {
      form: requestForm.value,
      files: requestFiles.value,
      idempotencyKey: context.idempotencyKey,
      context,
      isCurrent: requestContextIsCurrent
    },
    requestAttemptState
  );
  requestOperationSequence = context.operationId;
  activeRequestOperationId = context.operationId;
  requestAttempted.value = requestAttemptState.submission !== null;
  requestBusy.value = true;
  requestError.value = "";
  return request
    .then((result) => completeRequest(result.workbench, context))
    .catch((error) => failRequest(error, context))
    .finally(() => finishRequest(context));
}

function requestActionEnabled(
  action: unknown
): action is ProjectFinancingQuotaActionReadModel & {
  key: "request_financing_quota";
  enabled: true;
  requiresFile: true;
} {
  return (
    typeof action === "object" &&
    action !== null &&
    "key" in action &&
    "enabled" in action &&
    "requiresFile" in action &&
    action.key === "request_financing_quota" &&
    action.enabled === true &&
    action.requiresFile === true
  );
}

function requestOpenContextIsCurrent(
  context: RequestContext,
  openRequestId: number
) {
  const selected = requestContext.value;
  return Boolean(
    componentAlive &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration &&
      requestOpenSequence === openRequestId &&
      selected.projectId === context.projectId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.idempotencyKey === context.idempotencyKey
  );
}

function requestOpenOperationIsCurrent(
  context: RequestContext,
  openRequestId: number
) {
  return (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    requestOpenSequence === openRequestId
  );
}

function requestContextIsCurrent(context: RequestContext) {
  const selected = requestContext.value;
  return Boolean(
    componentAlive &&
      requestArmed.value &&
      requestVisible.value &&
      selected.projectId === context.projectId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.idempotencyKey === context.idempotencyKey &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration
  );
}

function captureRequestOperation(): RequestOperationContext {
  return {
    ...requestContext.value,
    operationId: requestOperationSequence + 1
  };
}

function requestOperationIsCurrent(context: RequestOperationContext) {
  return (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    activeRequestOperationId === context.operationId
  );
}

function requestResultCanWrite(context: RequestOperationContext) {
  return (
    requestOperationIsCurrent(context) &&
    requestContextIsCurrent(context)
  );
}

function completeRequest(
  nextWorkbench: ProjectFinancingQuotaWorkbenchReadModel,
  context: RequestOperationContext
) {
  if (!requestResultCanWrite(context)) return;
  clearRequestSelection();
  requestNotice.value = "垫资额度申请已提交审批，权威台账已刷新。";
  emit("updated", nextWorkbench);
}

function failRequest(error: unknown, context: RequestOperationContext) {
  if (!requestResultCanWrite(context)) return;
  requestError.value = errorMessage(error, "项目垫资额度申请失败");
}

function finishRequest(context: RequestOperationContext) {
  if (!requestOperationIsCurrent(context)) return;
  requestBusy.value = false;
}

function cancelRequest() {
  if (requestBusy.value) return;
  activeRequestOperationId = 0;
  clearRequestSelection();
}

function handleRequestVisibleChange(visible: boolean) {
  if (visible || requestBusy.value) return;
  cancelRequest();
}

function clearRequestSelection() {
  requestVisible.value = false;
  requestArmed.value = false;
  requestContext.value = { ...EMPTY_REQUEST_CONTEXT };
  selectedFinancingQuotaRequestAction.value = null;
  requestAttemptState =
    createProjectFinancingQuotaRequestAttemptState();
  requestAttempted.value = false;
  requestFiles.value = [];
  requestForm.value = createRequestForm();
  requestError.value = "";
}

function createRequestForm() {
  return {
    amountYuan: "",
    reason: "",
    validUntil: ""
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatMoney(value: string): string {
  return `¥${centsTextToYuanText(value)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date);
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function businessTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    payment_request: "合同付款",
    project_expense_request: "项目支出",
    spot_procurement_payment: "零星采购付款",
    expense_claim: "费用报销 / 借款",
    incidental_expense: "零星费用",
    project_expense: "项目支出",
    spot_procurement: "零星采购"
  };
  return labels[value] ?? value;
}

function statusTheme(status: ProjectFinancingQuotaStatus, isExpired: boolean) {
  if (
    (status === "approved" && isExpired) ||
    status === "terminated" ||
    status === "rejected"
  ) {
    return "danger" as const;
  }
  if (status === "approved") return "success" as const;
  if (status === "approval_pending") return "warning" as const;
  return "default" as const;
}
</script>

<style scoped>
.financing-quota-panel {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-md-plus);
  margin-bottom: var(--jg-space-md-plus);
}

.financing-quota-card {
  min-width: 0;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md-plus);
  margin-bottom: var(--jg-space-md-plus);
}

.panel-heading h2,
.panel-heading p,
.usage-description {
  margin: 0;
}

.panel-heading h2 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-section-title);
}

.panel-heading p,
.usage-description,
.reason-cell span,
.status-cell span,
.amount-breakdown span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.panel-heading p {
  margin-top: var(--jg-space-xs);
}

.panel-heading-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
}

.request-alert {
  margin-bottom: var(--jg-space-md-plus);
}

.request-form {
  display: grid;
  gap: var(--jg-space-md-plus);
}

.request-file-field {
  display: grid;
  gap: var(--jg-space-xs);
  color: var(--jg-color-text-primary);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-sm-plus);
  margin-top: var(--jg-space-md-plus);
}

.summary-item {
  display: grid;
  gap: var(--jg-space-xs);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-md);
  padding: var(--jg-space-md-plus);
  background: var(--jg-bg-muted);
}

.summary-item span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.summary-item strong {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-section-title);
}

.reason-cell,
.status-cell,
.amount-breakdown {
  display: grid;
  gap: var(--jg-space-2xs);
}

.termination-reason {
  overflow-wrap: anywhere;
}

.usage-description {
  margin-bottom: var(--jg-space-md-plus);
}

@container jg-page (max-width: 840px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container jg-page (max-width: 620px) {
  .panel-heading {
    display: grid;
  }

  .panel-heading-actions {
    justify-content: flex-start;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
