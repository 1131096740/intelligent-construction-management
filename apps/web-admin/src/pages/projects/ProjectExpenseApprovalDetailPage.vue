<template>
  <section class="project-expense-approval-detail-page jg-responsive-detail">
    <div class="page-head">
      <div>
        <h1>项目支出审批详情</h1>
        <p>{{ detail?.title ?? "正在读取项目支出审批详情" }}</p>
      </div>
      <t-button
        variant="outline"
        :loading="loading"
        @click="loadDetail"
      >
        刷新
      </t-button>
    </div>

    <t-alert
      v-if="errorMessage"
      theme="error"
      :message="errorMessage"
    />
    <t-card
      v-else-if="!detail"
      title="审批详情"
      :bordered="true"
    >
      正在加载审批详情
    </t-card>

    <template v-else>
      <t-card
        class="section-card"
        title="支出摘要"
        :bordered="true"
      >
        <div class="summary-grid">
          <div><span>单号</span><strong>{{ detail.code }}</strong></div>
          <div><span>状态</span><strong>{{ detail.statusLabel }}</strong></div>
          <div><span>费用类型</span><strong>{{ detail.expenseTypeLabel }} · {{ detail.expenseSubtypeLabel }}</strong></div>
          <div><span>付款主体</span><strong>{{ detail.paymentSubject }}</strong></div>
          <div><span>申请金额</span><strong>{{ formatCents(detail.requestedAmountCents) }}</strong></div>
          <div><span>批准金额</span><strong>{{ detail.approvedAmountCents ? formatCents(detail.approvedAmountCents) : "待终审" }}</strong></div>
          <div><span>当前节点</span><strong>{{ detail.currentNodeName ?? "流程已结束" }}</strong></div>
          <div class="summary-wide">
            <span>付款事由</span><strong>{{ detail.reason }}</strong>
          </div>
        </div>
      </t-card>

      <t-card
        v-if="withdrawalEnabled || nonWithdrawalLifecycleActions.length || detail.blockedReasons.length"
        class="section-card"
        title="申请处理"
        :bordered="true"
      >
        <t-button
          v-if="withdrawalEnabled"
          theme="danger"
          variant="outline"
          :disabled="withdrawalSubmitting"
          @click="openProjectExpenseWithdrawal"
        >
          撤回项目支出申请
        </t-button>
        <BusinessDraftAction
          :actions="nonWithdrawalLifecycleActions"
          :subject="expenseActionSubject"
          :blocked-reasons="detail.blockedReasons"
          :execute="executeLifecycleAction"
          @completed="loadDetail"
        />
      </t-card>

      <SensitiveActionDialog
        v-if="projectExpenseWithdrawalActionEnabled('withdraw') && withdrawalConfirmation.visible"
        :key="`project-expense-withdraw-${withdrawalDialogGeneration}`"
        v-model="withdrawalConfirmation.visible"
        title="撤回项目支出申请"
        description="撤回后本轮审批结束，申请进入已撤回历史记录；已有审批、金额与审计历史会完整保留。"
        confirm-text="确认撤回"
        confirm-theme="danger"
        :loading="withdrawalSubmitting"
        :error="withdrawalConfirmation.error"
        @confirm="confirmProjectExpenseWithdrawal"
        @cancel="cancelProjectExpenseWithdrawal"
      />

      <t-card
        class="section-card"
        title="审批办理"
        :bordered="true"
      >
        <BusinessActionPanel :actions="[detail.reviewAction]" />
        <t-alert
          v-if="!detail.reviewAction.enabled"
          theme="info"
          :message="detail.reviewAction.disabledReason ?? '当前账号暂无审批动作'"
        />
        <div
          v-else
          class="review-form"
        >
          <t-textarea
            v-model="form.comment"
            placeholder="审批意见；驳回时必填"
          />
          <t-input
            v-if="detail.canSetApprovedAmount"
            v-model="form.approvedAmountYuan"
            placeholder="终审批准金额（元，不填则按申请金额）"
          />
          <ApprovalSelfReviewFields
            v-model:self-review-reason="form.selfReviewReason"
            v-model:confirmation-password="form.confirmationPassword"
            :required="detail.reviewAction.requiresSelfReviewConfirmation === true"
          />
          <div class="review-buttons">
            <t-button
              theme="primary"
              :disabled="busy !== ''"
              :loading="busy === 'approve'"
              @click="submitReview('approve')"
            >
              审批通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :disabled="busy !== ''"
              :loading="busy === 'reject'"
              @click="submitReview('reject')"
            >
              审批驳回
            </t-button>
          </div>
        </div>
        <t-alert
          v-if="actionMessage"
          :theme="actionTone"
          :message="actionMessage"
        />
      </t-card>

      <t-card
        class="section-card"
        title="审批记录"
        :bordered="true"
      >
        <ApprovalTimeline :items="detail.approvalTimeline" />
      </t-card>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch
} from "vue";
import { useRoute } from "vue-router";
import ApprovalSelfReviewFields from "../../components/ApprovalSelfReviewFields.vue";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import {
  executeProjectExpenseWithdrawalAction,
  fetchProjectExpenseApprovalDetail,
  prepareProjectExpenseWithdrawalAction,
  reviewProjectExpenseApproval,
  voidProjectExpenseRequest,
  type PrepareProjectExpenseWithdrawalActionResult,
  type ProjectExpenseApprovalLifecycleDetailReadModel,
  type ProjectExpenseWithdrawalActionContext
} from "../../api/core-flow-read.api";
import { centsTextToYuanText } from "../../lib/money";
import { confirmSensitiveAction } from "../confirm-sensitive-action";
import {
  canBeginProjectExpenseReview,
  projectExpenseApprovedAmountCents,
  submitConfirmedProjectExpenseReview
} from "./project-expense-approval.config";

const route = useRoute();
const detail = ref<ProjectExpenseApprovalLifecycleDetailReadModel | null>(null);
const projectExpenseWithdrawalCapability =
  shallowRef<ProjectExpenseApprovalLifecycleDetailReadModel | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const busy = ref<"" | "approve" | "reject">("");
const actionMessage = ref("");
const actionTone = ref<"success" | "error">("success");
const withdrawalDialogGeneration = ref(0);
let detailRouteGeneration = 0;
let detailLoadRequestId = 0;
let detailEpoch = 0;
let withdrawalOperationSequence = 0;
let withdrawalBusyOwnerId = 0;
let withdrawalComponentActive = true;
const withdrawalOwnerScope = globalThis.crypto.randomUUID();
const withdrawalSubmitting = ref(false);
const withdrawalConfirmation = reactive({
  visible: false,
  error: "",
  dialogGeneration: -1,
  projectId: "",
  expenseRequestId: "",
  expectedExpenseUpdatedAt: "",
  expectedApprovalInstanceId: "",
  expectedNodeIndex: -1,
  expectedApprovalUpdatedAt: ""
});
const form = reactive({
  comment: "",
  approvedAmountYuan: "",
  selfReviewReason: "",
  confirmationPassword: ""
});

const expenseActionSubject = computed(() => ({
  businessCode: detail.value?.code ?? "—",
  name: detail.value?.paymentSubject ?? "项目支出申请",
  lastSavedAt: formatDateTime(detail.value?.lifecycleUpdatedAt),
  impactScope: "撤回或作废后保留审批、金额与审计历史，不会删除业务记录。"
}));

function projectExpenseWithdrawalActionEnabled(key: "withdraw") {
  return Boolean(
    projectExpenseWithdrawalCapability.value?.availableActions.some(
      (action) => action.key === key && action.enabled
    )
  );
}

const withdrawalEnabled = computed(() => {
  const capability = projectExpenseWithdrawalCapability.value;
  const coordinates = capability?.withdrawalContext;
  const currentDetail = detail.value;
  const { projectId, expenseRequestId } = routeIds();
  const enabledActionCount =
    projectExpenseWithdrawalCapability.value?.availableActions.filter(
      (action) => action.key === "withdraw" && action.enabled
    ).length ?? 0;
  if (
    !capability ||
    !coordinates ||
    capability.projectId !== projectId ||
    capability.id !== expenseRequestId ||
    currentDetail?.projectId !== capability.projectId ||
    currentDetail.id !== capability.id ||
    typeof capability.lifecycleUpdatedAt !== "string" ||
    !capability.lifecycleUpdatedAt ||
    coordinates.expectedExpenseUpdatedAt !== capability.lifecycleUpdatedAt ||
    !coordinates.expectedApprovalInstanceId ||
    !Number.isInteger(coordinates.expectedNodeIndex) ||
    coordinates.expectedNodeIndex < 0 ||
    !coordinates.expectedApprovalUpdatedAt
  ) {
    return false;
  }
  return (
    enabledActionCount === 1 &&
    projectExpenseWithdrawalActionEnabled("withdraw")
  );
});

const nonWithdrawalLifecycleActions = computed(() =>
  detail.value?.availableActions.filter((action) => action.key !== "withdraw") ?? []
);

function routeIds() {
  return {
    projectId: routeParam(route.params.projectId),
    expenseRequestId: routeParam(route.params.expenseRequestId)
  };
}

function routeParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
}

function formatCents(value: string) {
  return `¥${centsTextToYuanText(value)}`;
}

async function loadDetail(): Promise<boolean> {
  const { projectId, expenseRequestId } = routeIds();
  const routeGeneration = detailRouteGeneration;
  const requestId = ++detailLoadRequestId;
  detailEpoch += 1;
  invalidateProjectExpenseWithdrawalDialog(true);
  projectExpenseWithdrawalCapability.value = null;
  if (!projectId || !expenseRequestId) {
    detail.value = null;
    errorMessage.value = "项目支出审批路由参数缺失";
    return false;
  }
  loading.value = true;
  errorMessage.value = "";
  try {
    const serverDetail = await fetchProjectExpenseApprovalDetail(
      projectId,
      expenseRequestId
    );
    if (
      !detailLoadIsCurrent(
        requestId,
        routeGeneration,
        projectId,
        expenseRequestId
      ) ||
      serverDetail.projectId !== projectId ||
      serverDetail.id !== expenseRequestId
    ) {
      return false;
    }
    const viewDetail = structuredClone(serverDetail);
    projectExpenseWithdrawalCapability.value = serverDetail;
    detail.value = viewDetail;
    return true;
  } catch (error) {
    if (
      !detailLoadIsCurrent(
        requestId,
        routeGeneration,
        projectId,
        expenseRequestId
      )
    ) {
      return false;
    }
    projectExpenseWithdrawalCapability.value = null;
    detail.value = null;
    errorMessage.value = error instanceof Error ? error.message : "项目支出审批详情读取失败";
    return false;
  } finally {
    if (
      detailLoadIsCurrent(
        requestId,
        routeGeneration,
        projectId,
        expenseRequestId
      )
    ) {
      loading.value = false;
    }
  }
}

function detailLoadIsCurrent(
  requestId: number,
  routeGeneration: number,
  projectId: string,
  expenseRequestId: string
) {
  const currentRoute = routeIds();
  return (
    withdrawalComponentActive &&
    requestId === detailLoadRequestId &&
    routeGeneration === detailRouteGeneration &&
    currentRoute.projectId === projectId &&
    currentRoute.expenseRequestId === expenseRequestId
  );
}

function clearProjectExpenseRouteContext() {
  detailRouteGeneration += 1;
  detailLoadRequestId += 1;
  detailEpoch += 1;
  withdrawalBusyOwnerId = 0;
  withdrawalSubmitting.value = false;
  invalidateProjectExpenseWithdrawalDialog(true);
  projectExpenseWithdrawalCapability.value = null;
  detail.value = null;
  loading.value = false;
  busy.value = "";
  errorMessage.value = "";
  actionMessage.value = "";
}

function clearProjectExpenseWithdrawalConfirmation() {
  Object.assign(withdrawalConfirmation, {
    error: "",
    dialogGeneration: -1,
    projectId: "",
    expenseRequestId: "",
    expectedExpenseUpdatedAt: "",
    expectedApprovalInstanceId: "",
    expectedNodeIndex: -1,
    expectedApprovalUpdatedAt: ""
  });
}

function invalidateProjectExpenseWithdrawalDialog(close: boolean) {
  withdrawalDialogGeneration.value += 1;
  clearProjectExpenseWithdrawalConfirmation();
  if (close) withdrawalConfirmation.visible = false;
}

function scheduleRouteDetailLoad() {
  const expectedGeneration = detailRouteGeneration;
  void Promise.resolve().then(() => {
    if (
      withdrawalComponentActive &&
      expectedGeneration === detailRouteGeneration
    ) {
      void loadDetail();
    }
  });
}

function openProjectExpenseWithdrawal() {
  const capability = projectExpenseWithdrawalCapability.value;
  const coordinates = capability?.withdrawalContext;
  const { projectId, expenseRequestId } = routeIds();
  if (
    !withdrawalEnabled.value ||
    !capability ||
    !coordinates ||
    capability.projectId !== projectId ||
    capability.id !== expenseRequestId ||
    withdrawalBusyOwnerId !== 0
  ) {
    return;
  }
  withdrawalDialogGeneration.value += 1;
  Object.assign(withdrawalConfirmation, {
    visible: true,
    error: "",
    dialogGeneration: withdrawalDialogGeneration.value,
    projectId,
    expenseRequestId,
    expectedExpenseUpdatedAt: coordinates.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt
  });
}

function cancelProjectExpenseWithdrawal() {
  if (withdrawalBusyOwnerId !== 0) return;
  invalidateProjectExpenseWithdrawalDialog(true);
}

function withdrawalCapabilityMatches(
  context: ProjectExpenseWithdrawalActionContext
) {
  const capability = projectExpenseWithdrawalCapability.value;
  const coordinates = capability?.withdrawalContext;
  const currentDetail = detail.value;
  const enabledActions = capability?.availableActions.filter(
    (action) => action.key === "withdraw" && action.enabled
  );
  return (
    capability?.projectId === context.projectId &&
    capability.id === context.expenseRequestId &&
    currentDetail?.projectId === context.projectId &&
    currentDetail.id === context.expenseRequestId &&
    capability.lifecycleUpdatedAt === context.expectedExpenseUpdatedAt &&
    enabledActions?.length === 1 &&
    coordinates?.expectedExpenseUpdatedAt ===
      context.expectedExpenseUpdatedAt &&
    coordinates.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    coordinates.expectedNodeIndex === context.expectedNodeIndex &&
    coordinates.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt
  );
}

function withdrawalSelectionMatches(
  context: ProjectExpenseWithdrawalActionContext
) {
  return (
    withdrawalConfirmation.visible &&
    withdrawalConfirmation.dialogGeneration === context.dialogGeneration &&
    withdrawalConfirmation.projectId === context.projectId &&
    withdrawalConfirmation.expenseRequestId === context.expenseRequestId &&
    withdrawalConfirmation.expectedExpenseUpdatedAt ===
      context.expectedExpenseUpdatedAt &&
    withdrawalConfirmation.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    withdrawalConfirmation.expectedNodeIndex === context.expectedNodeIndex &&
    withdrawalConfirmation.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt
  );
}

function withdrawalContextIsCurrent(
  context: ProjectExpenseWithdrawalActionContext
) {
  const currentRoute = routeIds();
  return (
    withdrawalComponentActive &&
    context.ownerScope === withdrawalOwnerScope &&
    context.routeGeneration === detailRouteGeneration &&
    context.detailEpoch === detailEpoch &&
    context.dialogGeneration === withdrawalDialogGeneration.value &&
    context.operationId === withdrawalBusyOwnerId &&
    context.projectId === currentRoute.projectId &&
    context.expenseRequestId === currentRoute.expenseRequestId &&
    withdrawalSelectionMatches(context) &&
    withdrawalCapabilityMatches(context)
  );
}

function captureProjectExpenseWithdrawalContext(
  action: "withdraw"
): ProjectExpenseWithdrawalActionContext | null {
  const coordinates = withdrawalConfirmation;
  const { projectId, expenseRequestId } = routeIds();
  if (
    action !== "withdraw" ||
    withdrawalBusyOwnerId !== 0 ||
    !withdrawalConfirmation.visible ||
    coordinates.dialogGeneration !== withdrawalDialogGeneration.value ||
    !withdrawalEnabled.value ||
    coordinates.projectId !== projectId ||
    coordinates.expenseRequestId !== expenseRequestId ||
    !coordinates.expectedExpenseUpdatedAt ||
    !coordinates.expectedApprovalInstanceId ||
    !Number.isInteger(coordinates.expectedNodeIndex) ||
    coordinates.expectedNodeIndex < 0 ||
    !coordinates.expectedApprovalUpdatedAt
  ) {
    withdrawalConfirmation.error =
      "撤回上下文已失效，请重新打开确认。";
    return null;
  }
  const context = Object.freeze({
    action,
    ownerScope: withdrawalOwnerScope,
    routeGeneration: detailRouteGeneration,
    detailEpoch,
    dialogGeneration: coordinates.dialogGeneration,
    operationId: ++withdrawalOperationSequence,
    projectId,
    expenseRequestId,
    expectedExpenseUpdatedAt: coordinates.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt
  });
  withdrawalBusyOwnerId = context.operationId;
  withdrawalSubmitting.value = true;
  withdrawalConfirmation.error = "";
  return context;
}

function sameWithdrawalContext(
  left: ProjectExpenseWithdrawalActionContext,
  right: ProjectExpenseWithdrawalActionContext
) {
  return (
    left.action === right.action &&
    left.ownerScope === right.ownerScope &&
    left.routeGeneration === right.routeGeneration &&
    left.detailEpoch === right.detailEpoch &&
    left.dialogGeneration === right.dialogGeneration &&
    left.operationId === right.operationId &&
    left.projectId === right.projectId &&
    left.expenseRequestId === right.expenseRequestId &&
    left.expectedExpenseUpdatedAt === right.expectedExpenseUpdatedAt &&
    left.expectedApprovalInstanceId === right.expectedApprovalInstanceId &&
    left.expectedNodeIndex === right.expectedNodeIndex &&
    left.expectedApprovalUpdatedAt === right.expectedApprovalUpdatedAt
  );
}

function preparedWithdrawalIsCurrent(
  context: ProjectExpenseWithdrawalActionContext,
  prepared: PrepareProjectExpenseWithdrawalActionResult
) {
  return (
    prepared.status === "ready" &&
    sameWithdrawalContext(context, prepared.context) &&
    withdrawalContextIsCurrent(context)
  );
}

async function completeProjectExpenseWithdrawal(
  context: ProjectExpenseWithdrawalActionContext
) {
  if (!withdrawalContextIsCurrent(context)) return;
  withdrawalConfirmation.visible = false;
  withdrawalConfirmation.error = "";
  actionTone.value = "success";
  actionMessage.value = "项目支出申请已撤回，审批历史已保留。";
  await loadDetail();
}

function failProjectExpenseWithdrawal(
  context: ProjectExpenseWithdrawalActionContext,
  error: unknown
) {
  if (!withdrawalContextIsCurrent(context)) return;
  const reason =
    error instanceof Error ? error.message : "项目支出申请撤回失败";
  actionTone.value = "error";
  actionMessage.value = reason;
  withdrawalConfirmation.error = reason;
}

function finishProjectExpenseWithdrawal(
  context: ProjectExpenseWithdrawalActionContext
) {
  if (
    context.ownerScope === withdrawalOwnerScope &&
    context.operationId === withdrawalBusyOwnerId
  ) {
    withdrawalBusyOwnerId = 0;
    withdrawalSubmitting.value = false;
  }
}

function confirmProjectExpenseWithdrawal() {
  return executeProjectExpenseWithdrawalAction({
    action: "withdraw",
    capture: captureProjectExpenseWithdrawalContext,
    preflight: (context) =>
      prepareProjectExpenseWithdrawalAction({
        ...context,
        isCurrent: withdrawalContextIsCurrent
      }),
    current: preparedWithdrawalIsCurrent,
    complete: completeProjectExpenseWithdrawal,
    fail: failProjectExpenseWithdrawal,
    finish: finishProjectExpenseWithdrawal
  });
}

async function executeLifecycleAction(request: BusinessDraftActionRequest) {
  const { projectId, expenseRequestId } = routeIds();
  if (request.action === "void") {
    await voidProjectExpenseRequest(projectId, expenseRequestId, {
      reason: request.reason
    });
    actionTone.value = "success";
    actionMessage.value = "项目支出申请已作废，审批和金额历史已保留。";
    return;
  }
  throw new Error("当前项目支出不支持该操作，请刷新后重试。");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function submitReview(decision: "approve" | "reject") {
  if (!canBeginProjectExpenseReview(busy.value)) return;
  if (!detail.value?.reviewAction.enabled) return;
  const comment = form.comment.trim();
  if (decision === "reject" && !comment) {
    actionTone.value = "error";
    actionMessage.value = "审批驳回时请填写审批意见";
    return;
  }

  busy.value = decision;
  actionMessage.value = "";
  try {
    const selfReview = buildApprovalSelfReviewPayload(
      detail.value.reviewAction.requiresSelfReviewConfirmation === true,
      form
    );
    const approvedAmountYuan = form.approvedAmountYuan.trim();
    const approvedAmountCents = projectExpenseApprovedAmountCents(
      detail.value.canSetApprovedAmount,
      decision,
      approvedAmountYuan
    );
    const { projectId, expenseRequestId } = routeIds();
    const submitted = await submitConfirmedProjectExpenseReview({
      decision,
      confirm: (message) => confirmSensitiveAction(message),
      submit: async () => {
        await reviewProjectExpenseApproval(projectId, expenseRequestId, {
          decision,
          comment: comment || undefined,
          approvedAmountCents,
          ...selfReview
        });
      }
    });
    if (!submitted) return;
    form.selfReviewReason = "";
    form.confirmationPassword = "";
    form.comment = "";
    form.approvedAmountYuan = "";
    actionTone.value = "success";
    actionMessage.value = decision === "approve" ? "审批通过，详情已刷新。" : "审批驳回，详情已刷新。";
    await loadDetail();
  } catch (error) {
    actionTone.value = "error";
    actionMessage.value = error instanceof Error ? error.message : "项目支出审批失败";
  } finally {
    busy.value = "";
  }
}

watch(
  () => [routeIds().projectId, routeIds().expenseRequestId] as const,
  () => {
    clearProjectExpenseRouteContext();
    scheduleRouteDetailLoad();
  },
  { flush: "sync" }
);

onMounted(() => {
  void loadDetail();
});

onBeforeUnmount(() => {
  withdrawalComponentActive = false;
  clearProjectExpenseRouteContext();
});
</script>

<style scoped>
.project-expense-approval-detail-page,
.review-form {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-lg);
}

.page-head,
.review-buttons {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.page-head h1 {
  margin: 0;
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
}

.page-head p {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-text-subtle);
}

.section-card {
  border-radius: var(--jg-radius-sm);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.summary-grid div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-muted);
}

.summary-grid span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.summary-grid strong {
  color: var(--jg-text-strong);
}

.summary-wide {
  grid-column: 1 / -1;
}

@container jg-page (max-width: 620px) {
  .page-head,
  .review-buttons {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .summary-wide {
    grid-column: auto;
  }
}
</style>
