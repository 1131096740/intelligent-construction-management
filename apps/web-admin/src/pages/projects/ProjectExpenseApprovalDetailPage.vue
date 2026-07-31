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
        :disabled="executionSubmitting || reviewSubmitting || withdrawalSubmitting"
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
        v-if="projectExpenseExecutionEnabled"
        class="section-card"
        title="实付办理"
        :bordered="true"
      >
        <div class="execution-form">
          <MoneyInput
            v-model="executionForm.amountYuan"
            label="实付金额"
            required
          />
          <label class="execution-field">
            <span>实付时间 <b aria-hidden="true">*</b></span>
            <t-date-picker
              v-model="executionForm.paidAt"
              enable-time-picker
              need-confirm
              format="YYYY-MM-DD HH:mm"
              value-type="YYYY-MM-DD HH:mm:ss"
              :disabled="executionSubmitting"
            />
          </label>
          <div class="execution-field execution-field--wide">
            <span>实付凭证 <b aria-hidden="true">*</b></span>
            <t-upload
              v-model="executionVoucherFiles"
              theme="file-input"
              :auto-upload="false"
              :max="1"
              :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              :size-limit="coreArchiveUploadSizeLimit"
              :disabled="executionSubmitting"
              placeholder="选择实付凭证文件"
            />
            <small>{{ executionVoucherFileSummary }}</small>
          </div>
        </div>
        <div class="execution-actions">
          <t-button
            theme="primary"
            :loading="executionSubmitting"
            :disabled="executionSubmitting"
            @click="requestProjectExpenseExecution"
          >
            确认登记实付
          </t-button>
        </div>
      </t-card>

      <SensitiveActionDialog
        v-if="projectExpenseExecutionActionEnabled() && executionConfirmation.visible"
        :key="`project-expense-execution-${executionConfirmation.dialogGeneration}`"
        v-model="executionConfirmation.visible"
        title="确认登记项目支出实付？"
        description="提交后将在同一业务链中记录实付金额、付款时间、凭证和经办人，并更新项目资金余额。"
        confirm-text="确认登记实付"
        confirm-theme="primary"
        require-password
        :loading="executionSubmitting"
        :error="executionConfirmation.error"
        @confirm="confirmProjectExpenseExecution"
        @cancel="cancelProjectExpenseExecution"
      />

      <t-card
        class="section-card"
        title="审批办理"
        :bordered="true"
      >
        <BusinessActionPanel :actions="reviewActionView ? [reviewActionView] : []" />
        <t-alert
          v-if="!projectExpenseReviewEnabled"
          theme="info"
          :message="reviewActionView?.disabledReason ?? '当前账号暂无审批动作'"
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
          <div
            v-if="requiresProjectExpenseSelfReviewConfirmation"
            class="approval-self-review-fields"
          >
            <t-alert
              theme="warning"
              title="领导自审二次确认"
              message="当前单据由您本人发起，请说明独立复核依据；当前密码将在确认对话框中输入。"
            />
            <t-textarea
              v-model="form.selfReviewReason"
              placeholder="请填写独立的自审原因"
            />
          </div>
          <div class="review-buttons">
            <t-button
              theme="primary"
              :disabled="reviewSubmitting"
              :loading="reviewSubmitting && reviewConfirmation.kind === 'approve'"
              @click="requestProjectExpenseReview('approve')"
            >
              审批通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :disabled="reviewSubmitting"
              :loading="reviewSubmitting && reviewConfirmation.kind === 'reject'"
              @click="requestProjectExpenseReview('reject')"
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

      <SensitiveActionDialog
        v-if="projectExpenseReviewActionEnabled('review_approval') && reviewConfirmation.kind === 'approve'"
        :key="`project-expense-review-approve-${reviewConfirmation.dialogGeneration}`"
        v-model="reviewConfirmation.visible"
        title="确认通过项目支出审批？"
        description="通过后将推进当前审批流程；只有终审通过后才进入已批待付。"
        confirm-text="确认通过"
        confirm-theme="primary"
        :require-password="reviewConfirmation.requiresSelfReviewConfirmation"
        :loading="reviewSubmitting"
        :error="reviewConfirmation.error"
        @confirm="confirmProjectExpenseReviewApprove"
        @cancel="cancelProjectExpenseReview"
      />
      <SensitiveActionDialog
        v-if="projectExpenseReviewActionEnabled('review_approval') && reviewConfirmation.kind === 'reject'"
        :key="`project-expense-review-reject-${reviewConfirmation.dialogGeneration}`"
        v-model="reviewConfirmation.visible"
        title="确认驳回项目支出审批？"
        description="驳回后本轮审批将结束，驳回意见和审批坐标将写入历史。"
        confirm-text="确认驳回"
        confirm-theme="danger"
        :require-password="reviewConfirmation.requiresSelfReviewConfirmation"
        :loading="reviewSubmitting"
        :error="reviewConfirmation.error"
        @confirm="confirmProjectExpenseReviewReject"
        @cancel="cancelProjectExpenseReview"
      />

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
import type { UploadFile } from "tdesign-vue-next";
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
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import MoneyInput from "../../components/MoneyInput.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import {
  createProjectExpenseExecutionRecordAttemptState,
  executeProjectExpenseApprovalReviewAction,
  executeProjectExpenseWithdrawalAction,
  fetchProjectExpenseApprovalDetail,
  prepareProjectExpenseApprovalReviewAction,
  prepareProjectExpenseWithdrawalAction,
  recordProjectExpenseExecutionWithUpload,
  voidProjectExpenseRequest,
  type PrepareProjectExpenseApprovalReviewActionResult,
  type PrepareProjectExpenseWithdrawalActionResult,
  type ProjectExpenseApprovalReviewActionContext,
  type ProjectExpenseApprovalReviewActionDecision,
  type ProjectExpenseApprovalLifecycleDetailReadModel,
  type ProjectExpenseExecutionRecordAttemptState,
  type ProjectExpenseWithdrawalActionContext
} from "../../api/core-flow-read.api";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import { projectExpenseApprovedAmountCents } from "./project-expense-approval.config";

interface ProjectExpenseExecutionSelection {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  capabilityGeneration: number;
  projectId: string;
  expenseRequestId: string;
  expectedExpenseUpdatedAt: string;
  amountCents: string;
  paidAt: string;
  idempotencyKey: string;
  file: File;
  fileName: string;
  attemptState: ProjectExpenseExecutionRecordAttemptState;
}

const route = useRoute();
const detail = ref<ProjectExpenseApprovalLifecycleDetailReadModel | null>(null);
const projectExpenseWithdrawalCapability =
  shallowRef<ProjectExpenseApprovalLifecycleDetailReadModel | null>(null);
let projectExpenseCapabilityGeneration = 0;
const loading = ref(false);
const errorMessage = ref("");
const actionMessage = ref("");
const actionTone = ref<"success" | "error">("success");
let executionDialogGeneration = 0;
let executionOperationSequence = 0;
let executionBusyOwnerId = 0;
let executionComponentActive = true;
let executionDialogReady = false;
let executionSelection:
  | Readonly<ProjectExpenseExecutionSelection>
  | null = null;
let executionOperationPromise: Promise<unknown> | null = null;
const executionOwnerScope = globalThis.crypto.randomUUID();
const executionSubmitting = ref(false);
const executionVoucherFiles = ref<UploadFile[]>([]);
const executionConfirmation = reactive({
  visible: false,
  error: "",
  dialogGeneration: -1
});
const executionForm = reactive({
  amountYuan: "",
  paidAt: toDatetimePickerValue(new Date())
});
let reviewDialogGeneration = 0;
let reviewOperationSequence = 0;
let reviewBusyOwnerId = 0;
let reviewComponentActive = true;
const reviewOwnerScope = globalThis.crypto.randomUUID();
const reviewSubmitting = ref(false);
const reviewConfirmation = reactive({
  visible: false,
  kind: null as ProjectExpenseApprovalReviewActionDecision | null,
  error: "",
  dialogGeneration: -1,
  projectId: "",
  expenseRequestId: "",
  expectedExpenseUpdatedAt: "",
  expectedApprovalInstanceId: "",
  expectedNodeIndex: -1,
  expectedApprovalUpdatedAt: "",
  requiresSelfReviewConfirmation: false
});
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
  selfReviewReason: ""
});

const selectedExecutionVoucherFile = computed(() => {
  const rawFile = executionVoucherFiles.value[0]?.raw;
  return rawFile instanceof File ? rawFile : null;
});
const coreArchiveUploadSizeLimit = {
  size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${CORE_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};
const executionVoucherFileSummary = computed(() =>
  buildFileUploadSummary(
    selectedExecutionVoucherFile.value,
    executionSubmitting.value,
    CORE_ARCHIVE_UPLOAD_POLICY.acceptText,
    CORE_ARCHIVE_UPLOAD_POLICY.limitText
  )
);

const expenseActionSubject = computed(() => ({
  businessCode: detail.value?.code ?? "—",
  name: detail.value?.paymentSubject ?? "项目支出申请",
  lastSavedAt: formatDateTime(detail.value?.lifecycleUpdatedAt),
  impactScope: "撤回或作废后保留审批、金额与审计历史，不会删除业务记录。"
}));

function projectExpenseReviewActionEnabled(key: "review_approval") {
  return Boolean(
    projectExpenseWithdrawalCapability.value?.availableActions.some(
      (action) => action.key === key && action.enabled
    )
  );
}

const reviewActionView = computed(() =>
  detail.value?.availableActions.find(
    (action) => action.key === "review_approval"
  ) ?? detail.value?.reviewAction ?? null
);

const requiresProjectExpenseSelfReviewConfirmation = computed(
  () =>
    projectExpenseWithdrawalCapability.value?.availableActions.some(
      (action) =>
        action.key === "review_approval" &&
        action.enabled &&
        action.requiresSelfReviewConfirmation === true
    ) === true
);

const projectExpenseReviewEnabled = computed(() => {
  const capability = projectExpenseWithdrawalCapability.value;
  const coordinates = capability?.reviewApprovalContext;
  const currentDetail = detail.value;
  const { projectId, expenseRequestId } = routeIds();
  const enabledActionCount =
    capability?.availableActions.filter(
      (action) => action.key === "review_approval" && action.enabled
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
    projectExpenseReviewActionEnabled("review_approval")
  );
});

function projectExpenseWithdrawalActionEnabled(key: "withdraw") {
  return Boolean(
    projectExpenseWithdrawalCapability.value?.availableActions.some(
      (action) => action.key === key && action.enabled
    )
  );
}

function projectExpenseExecutionActionEnabled() {
  return Boolean(
    projectExpenseWithdrawalCapability.value?.availableActions.some(
      (action) =>
        action.key === "record_execution" && action.enabled
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
  detail.value?.availableActions.filter(
    (action) =>
      action.key !== "withdraw" &&
      action.key !== "review_approval" &&
      action.key !== "record_execution"
  ) ?? []
);

const projectExpenseExecutionEnabled = computed(() => {
  const capability = projectExpenseWithdrawalCapability.value;
  const executionContext = capability?.executionContext;
  const currentDetail = detail.value;
  const { projectId, expenseRequestId } = routeIds();
  const enabledActionCount =
    capability?.availableActions.filter(
      (action) =>
        action.key === "record_execution" && action.enabled
    ).length ?? 0;
  if (
    !capability ||
    !executionContext ||
    capability.projectId !== projectId ||
    capability.id !== expenseRequestId ||
    currentDetail?.projectId !== capability.projectId ||
    currentDetail.id !== capability.id ||
    typeof capability.lifecycleUpdatedAt !== "string" ||
    !capability.lifecycleUpdatedAt ||
    executionContext.expectedExpenseUpdatedAt !==
      capability.lifecycleUpdatedAt
  ) {
    return false;
  }
  return (
    enabledActionCount === 1 &&
    projectExpenseExecutionActionEnabled()
  );
});

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
  invalidateProjectExpenseReviewDialog(true);
  invalidateProjectExpenseWithdrawalDialog(true);
  invalidateProjectExpenseExecutionDialog(true);
  projectExpenseCapabilityGeneration += 1;
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
    projectExpenseCapabilityGeneration += 1;
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
    projectExpenseCapabilityGeneration += 1;
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
    reviewComponentActive &&
    executionComponentActive &&
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
  reviewBusyOwnerId = 0;
  reviewSubmitting.value = false;
  invalidateProjectExpenseReviewDialog(true);
  withdrawalBusyOwnerId = 0;
  withdrawalSubmitting.value = false;
  invalidateProjectExpenseWithdrawalDialog(true);
  executionBusyOwnerId = 0;
  executionSubmitting.value = false;
  executionOperationPromise = null;
  invalidateProjectExpenseExecutionDialog(true);
  executionVoucherFiles.value = [];
  executionForm.amountYuan = "";
  executionForm.paidAt = toDatetimePickerValue(new Date());
  projectExpenseCapabilityGeneration += 1;
  projectExpenseWithdrawalCapability.value = null;
  detail.value = null;
  loading.value = false;
  errorMessage.value = "";
  actionMessage.value = "";
  form.comment = "";
  form.approvedAmountYuan = "";
  form.selfReviewReason = "";
}

function clearProjectExpenseReviewConfirmation() {
  Object.assign(reviewConfirmation, {
    kind: null,
    error: "",
    dialogGeneration: -1,
    projectId: "",
    expenseRequestId: "",
    expectedExpenseUpdatedAt: "",
    expectedApprovalInstanceId: "",
    expectedNodeIndex: -1,
    expectedApprovalUpdatedAt: "",
    requiresSelfReviewConfirmation: false
  });
}

function invalidateProjectExpenseReviewDialog(close: boolean) {
  reviewDialogGeneration += 1;
  clearProjectExpenseReviewConfirmation();
  if (close) reviewConfirmation.visible = false;
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

function invalidateProjectExpenseExecutionDialog(close: boolean) {
  executionDialogGeneration += 1;
  executionDialogReady = false;
  executionSelection = null;
  executionConfirmation.error = "";
  executionConfirmation.dialogGeneration = -1;
  if (close) executionConfirmation.visible = false;
}

function scheduleRouteDetailLoad() {
  const expectedGeneration = detailRouteGeneration;
  void Promise.resolve().then(() => {
    if (
      withdrawalComponentActive &&
      reviewComponentActive &&
      expectedGeneration === detailRouteGeneration
    ) {
      void loadDetail();
    }
  });
}

function requestProjectExpenseExecution() {
  const capability = projectExpenseWithdrawalCapability.value;
  const executionContext = capability?.executionContext;
  const { projectId, expenseRequestId } = routeIds();
  try {
    if (
      !projectExpenseExecutionEnabled.value ||
      !capability ||
      !executionContext ||
      capability.projectId !== projectId ||
      capability.id !== expenseRequestId
    ) {
      throw new Error(
        "项目支出实付资格或版本未读取，请刷新详情后重试"
      );
    }
    if (executionBusyOwnerId !== 0 || executionSubmitting.value) {
      throw new Error(
        "当前项目支出实付正在提交，请等待本次操作完成"
      );
    }
    const file = selectedExecutionVoucherFile.value;
    if (!file) throw new Error("项目支出实付凭证不能为空");
    const amountCents = parseExecutionYuanAmount(
      executionForm.amountYuan
    );
    const paidAt = toExecutionIsoDatetime(
      executionForm.paidAt
    );
    executionDialogGeneration += 1;
    executionSelection = Object.freeze({
      ownerScope: executionOwnerScope,
      routeGeneration: detailRouteGeneration,
      detailEpoch,
      dialogGeneration: executionDialogGeneration,
      capabilityGeneration: projectExpenseCapabilityGeneration,
      projectId,
      expenseRequestId,
      expectedExpenseUpdatedAt:
        executionContext.expectedExpenseUpdatedAt,
      amountCents,
      paidAt,
      idempotencyKey: globalThis.crypto.randomUUID(),
      file,
      fileName: file.name,
      attemptState:
        createProjectExpenseExecutionRecordAttemptState()
    });
    executionDialogReady = true;
    Object.assign(executionConfirmation, {
      visible: true,
      error: "",
      dialogGeneration: executionDialogGeneration
    });
    actionMessage.value = "";
  } catch (error) {
    actionTone.value = "error";
    actionMessage.value =
      error instanceof Error
        ? error.message
        : "项目支出实付信息不完整";
  }
}

function projectExpenseExecutionSelectionIsCurrent(
  selection: Readonly<ProjectExpenseExecutionSelection>
) {
  const currentDetail = detail.value;
  const currentRoute = routeIds();
  return (
    executionComponentActive &&
    selection.ownerScope === executionOwnerScope &&
    selection.routeGeneration === detailRouteGeneration &&
    selection.detailEpoch === detailEpoch &&
    selection.dialogGeneration === executionDialogGeneration &&
    selection.projectId === currentRoute.projectId &&
    selection.expenseRequestId === currentRoute.expenseRequestId &&
    executionSelection === selection &&
    executionDialogReady &&
    executionConfirmation.visible &&
    executionConfirmation.dialogGeneration ===
      selection.dialogGeneration &&
    selection.capabilityGeneration ===
      projectExpenseCapabilityGeneration &&
    currentDetail?.projectId === selection.projectId &&
    currentDetail.id === selection.expenseRequestId
  );
}

function confirmProjectExpenseExecution(values: {
  reason: string;
  password: string;
}) {
  if (executionOperationPromise) {
    return executionOperationPromise;
  }
  const selection = executionSelection;
  if (!selection || !executionDialogReady) {
    executionConfirmation.error =
      "项目支出实付上下文已失效，请重新打开确认窗口";
    return Promise.resolve({ status: "not_started" });
  }
  if (executionBusyOwnerId !== 0) {
    executionConfirmation.error =
      "当前项目支出实付正在提交，请等待本次操作完成";
    return Promise.resolve({ status: "not_started" });
  }

  const ownerId = ++executionOperationSequence;
  executionBusyOwnerId = ownerId;
  executionSubmitting.value = true;
  actionMessage.value = "";
  executionConfirmation.error = "";
  const request = recordProjectExpenseExecutionWithUpload(
    selection.projectId,
    selection.expenseRequestId,
    {
      amountCents: selection.amountCents,
      paidAt: selection.paidAt,
      confirmationPassword: values.password,
      expectedExpenseUpdatedAt:
        selection.expectedExpenseUpdatedAt,
      idempotencyKey: selection.idempotencyKey,
      file: selection.file,
      fileName: selection.fileName,
      context: selection,
      isCurrent: projectExpenseExecutionSelectionIsCurrent
    },
    selection.attemptState
  );
  let operation!: Promise<unknown>;
  operation = request
    .then((result) =>
      completeProjectExpenseExecution(selection, result)
    )
    .catch((error) => {
      if (projectExpenseExecutionSelectionIsCurrent(selection)) {
        const reason =
          error instanceof Error
            ? error.message
            : "项目支出实付登记失败";
        actionTone.value = "error";
        actionMessage.value =
          `操作未完成：${reason}。已保留当前凭证与幂等请求，可直接重试。`;
        executionConfirmation.error = reason;
      }
      return { status: "failed" as const };
    })
    .finally(() => {
      if (executionBusyOwnerId === ownerId) {
        executionBusyOwnerId = 0;
        executionSubmitting.value = false;
      }
      if (executionOperationPromise === operation) {
        executionOperationPromise = null;
      }
    });
  executionOperationPromise = operation;
  return operation;
}

async function completeProjectExpenseExecution(
  selection: Readonly<ProjectExpenseExecutionSelection>,
  response: unknown
) {
  if (!projectExpenseExecutionSelectionIsCurrent(selection)) {
    return { status: "stale" as const };
  }
  const serverDetail = await fetchProjectExpenseApprovalDetail(
    selection.projectId,
    selection.expenseRequestId
  );
  if (!projectExpenseExecutionSelectionIsCurrent(selection)) {
    return { status: "stale" as const };
  }
  const enabledActions = serverDetail.availableActions.filter(
    (action) =>
      action.key === "record_execution" && action.enabled
  );
  const contextMatches =
    enabledActions.length === 1
      ? serverDetail.executionContext
          ?.expectedExpenseUpdatedAt ===
        serverDetail.lifecycleUpdatedAt
      : enabledActions.length === 0 &&
        serverDetail.executionContext === null;
  if (
    serverDetail.projectId !== selection.projectId ||
    serverDetail.id !== selection.expenseRequestId ||
    typeof serverDetail.lifecycleUpdatedAt !== "string" ||
    !serverDetail.lifecycleUpdatedAt ||
    enabledActions.length > 1 ||
    !contextMatches
  ) {
    throw new Error(
      "项目支出实付后的权威详情不完整，请刷新后核对"
    );
  }
  if (
    serverDetail.lifecycleUpdatedAt ===
    selection.expectedExpenseUpdatedAt
  ) {
    throw new Error(
      "项目支出实付后的权威详情尚未反映本次写入，请直接重试"
    );
  }
  projectExpenseCapabilityGeneration += 1;
  projectExpenseWithdrawalCapability.value = serverDetail;
  detail.value = structuredClone(serverDetail);
  detailEpoch += 1;
  executionVoucherFiles.value = [];
  executionForm.amountYuan = "";
  executionForm.paidAt = toDatetimePickerValue(new Date());
  actionTone.value = "success";
  actionMessage.value =
    "项目支出实付已登记，权威详情已刷新。";
  invalidateProjectExpenseExecutionDialog(true);
  return { status: "completed" as const, response };
}

function cancelProjectExpenseExecution() {
  if (executionBusyOwnerId !== 0) {
    executionConfirmation.visible = true;
    executionConfirmation.error =
      "当前项目支出实付正在提交，请等待本次操作完成";
    return;
  }
  invalidateProjectExpenseExecutionDialog(true);
}

function parseExecutionYuanAmount(raw: string) {
  let amountCents: string;
  try {
    amountCents = yuanTextToCentsText(raw.trim());
  } catch {
    throw new Error("实付金额必须为正数，最多两位小数");
  }
  if (amountCents === "0") {
    throw new Error("实付金额必须为正数，最多两位小数");
  }
  return amountCents;
}

function toExecutionIsoDatetime(raw: string) {
  const value = raw.trim();
  if (!value) throw new Error("请填写实付时间");
  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("实付时间格式不正确");
  }
  return parsed.toISOString();
}

function toDatetimePickerValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function requestProjectExpenseReview(
  decision: ProjectExpenseApprovalReviewActionDecision
) {
  const capability = projectExpenseWithdrawalCapability.value;
  const coordinates = capability?.reviewApprovalContext;
  const { projectId, expenseRequestId } = routeIds();
  try {
    if (
      !projectExpenseReviewEnabled.value ||
      !capability ||
      !coordinates ||
      capability.projectId !== projectId ||
      capability.id !== expenseRequestId
    ) {
      throw new Error(
        "项目支出审批资格或坐标未读取，请刷新详情后重试"
      );
    }
    if (reviewBusyOwnerId !== 0 || reviewSubmitting.value) {
      throw new Error("当前审批正在提交，请等待本次操作完成");
    }
    const comment = form.comment.trim();
    if (decision === "reject" && !comment) {
      throw new Error("审批驳回时请填写审批意见");
    }
    projectExpenseApprovedAmountCents(
      capability.canSetApprovedAmount,
      decision,
      form.approvedAmountYuan
    );
    if (requiresProjectExpenseSelfReviewConfirmation.value) {
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: form.selfReviewReason,
        confirmationPassword: "validation"
      });
    }
  } catch (error) {
    actionTone.value = "error";
    actionMessage.value =
      error instanceof Error ? error.message : "项目支出审批信息不完整";
    return;
  }

  reviewDialogGeneration += 1;
  Object.assign(reviewConfirmation, {
    visible: true,
    kind: decision,
    error: "",
    dialogGeneration: reviewDialogGeneration,
    projectId,
    expenseRequestId,
    expectedExpenseUpdatedAt: coordinates.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt,
    requiresSelfReviewConfirmation:
      requiresProjectExpenseSelfReviewConfirmation.value
  });
  actionMessage.value = "";
}

function cancelProjectExpenseReview() {
  if (reviewBusyOwnerId !== 0) return;
  invalidateProjectExpenseReviewDialog(true);
}

function projectExpenseReviewCapabilityMatches(
  context: ProjectExpenseApprovalReviewActionContext
) {
  const capability = projectExpenseWithdrawalCapability.value;
  const coordinates = capability?.reviewApprovalContext;
  const currentDetail = detail.value;
  const enabledActions = capability?.availableActions.filter(
    (action) => action.key === "review_approval" && action.enabled
  );
  return (
    capability?.projectId === context.projectId &&
    capability.id === context.expenseRequestId &&
    currentDetail?.projectId === context.projectId &&
    currentDetail.id === context.expenseRequestId &&
    capability.lifecycleUpdatedAt === context.expectedExpenseUpdatedAt &&
    enabledActions?.length === 1 &&
    capability.availableActions.some(
      (action) =>
        action.key === "review_approval" &&
        action.enabled &&
        action.requiresSelfReviewConfirmation ===
          context.requiresSelfReviewConfirmation
    ) &&
    coordinates?.expectedExpenseUpdatedAt ===
      context.expectedExpenseUpdatedAt &&
    coordinates.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    coordinates.expectedNodeIndex === context.expectedNodeIndex &&
    coordinates.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt
  );
}

function projectExpenseReviewSelectionMatches(
  context: ProjectExpenseApprovalReviewActionContext
) {
  return (
    reviewConfirmation.visible &&
    reviewConfirmation.kind === context.decision &&
    reviewConfirmation.dialogGeneration === context.dialogGeneration &&
    reviewConfirmation.projectId === context.projectId &&
    reviewConfirmation.expenseRequestId === context.expenseRequestId &&
    reviewConfirmation.expectedExpenseUpdatedAt ===
      context.expectedExpenseUpdatedAt &&
    reviewConfirmation.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    reviewConfirmation.expectedNodeIndex === context.expectedNodeIndex &&
    reviewConfirmation.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt &&
    reviewConfirmation.requiresSelfReviewConfirmation ===
      context.requiresSelfReviewConfirmation
  );
}

function projectExpenseReviewContextIsCurrent(
  context: ProjectExpenseApprovalReviewActionContext
) {
  const currentRoute = routeIds();
  return (
    reviewComponentActive &&
    context.ownerScope === reviewOwnerScope &&
    context.routeGeneration === detailRouteGeneration &&
    context.detailEpoch === detailEpoch &&
    context.dialogGeneration === reviewDialogGeneration &&
    context.operationId === reviewBusyOwnerId &&
    context.projectId === currentRoute.projectId &&
    context.expenseRequestId === currentRoute.expenseRequestId &&
    projectExpenseReviewSelectionMatches(context) &&
    projectExpenseReviewCapabilityMatches(context)
  );
}

function captureProjectExpenseReviewContext(
  decision: ProjectExpenseApprovalReviewActionDecision,
  password: string
): ProjectExpenseApprovalReviewActionContext | null {
  const coordinates = reviewConfirmation;
  const capability = projectExpenseWithdrawalCapability.value;
  const { projectId, expenseRequestId } = routeIds();
  if (
    reviewBusyOwnerId !== 0 ||
    reviewSubmitting.value ||
    !reviewConfirmation.visible ||
    reviewConfirmation.kind !== decision ||
    coordinates.dialogGeneration !== reviewDialogGeneration ||
    !projectExpenseReviewEnabled.value ||
    !capability ||
    coordinates.projectId !== projectId ||
    coordinates.expenseRequestId !== expenseRequestId ||
    !coordinates.expectedExpenseUpdatedAt ||
    !coordinates.expectedApprovalInstanceId ||
    !Number.isInteger(coordinates.expectedNodeIndex) ||
    coordinates.expectedNodeIndex < 0 ||
    !coordinates.expectedApprovalUpdatedAt
  ) {
    reviewConfirmation.error =
      "审批上下文已失效，请重新打开确认。";
    return null;
  }

  try {
    const comment = form.comment.trim() || undefined;
    if (decision === "reject" && !comment) {
      throw new Error("审批驳回时请填写审批意见");
    }
    const approvedAmountCents = projectExpenseApprovedAmountCents(
      capability.canSetApprovedAmount,
      decision,
      form.approvedAmountYuan
    );
    const selfReview = buildApprovalSelfReviewPayload(
      coordinates.requiresSelfReviewConfirmation,
      {
        selfReviewReason: form.selfReviewReason,
        confirmationPassword: password
      }
    );
    const context = Object.freeze({
      ownerScope: reviewOwnerScope,
      routeGeneration: detailRouteGeneration,
      detailEpoch,
      dialogGeneration: coordinates.dialogGeneration,
      operationId: ++reviewOperationSequence,
      projectId,
      expenseRequestId,
      expectedExpenseUpdatedAt: coordinates.expectedExpenseUpdatedAt,
      expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
      expectedNodeIndex: coordinates.expectedNodeIndex,
      expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt,
      decision,
      requiresSelfReviewConfirmation:
        coordinates.requiresSelfReviewConfirmation,
      ...(approvedAmountCents ? { approvedAmountCents } : {}),
      ...(comment ? { comment } : {}),
      ...selfReview
    });
    reviewBusyOwnerId = context.operationId;
    reviewSubmitting.value = true;
    reviewConfirmation.error = "";
    actionMessage.value = "";
    return context;
  } catch (error) {
    reviewConfirmation.error =
      error instanceof Error ? error.message : "项目支出审批信息不完整";
    return null;
  }
}

function sameProjectExpenseReviewContext(
  left: ProjectExpenseApprovalReviewActionContext,
  right: ProjectExpenseApprovalReviewActionContext
) {
  return (
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
    left.expectedApprovalUpdatedAt === right.expectedApprovalUpdatedAt &&
    left.decision === right.decision &&
    left.requiresSelfReviewConfirmation ===
      right.requiresSelfReviewConfirmation &&
    left.approvedAmountCents === right.approvedAmountCents &&
    left.comment === right.comment &&
    left.selfReviewReason === right.selfReviewReason &&
    left.confirmationPassword === right.confirmationPassword
  );
}

function preparedProjectExpenseReviewIsCurrent(
  context: ProjectExpenseApprovalReviewActionContext,
  prepared: PrepareProjectExpenseApprovalReviewActionResult
) {
  return (
    prepared.status === "ready" &&
    sameProjectExpenseReviewContext(context, prepared.context) &&
    projectExpenseReviewContextIsCurrent(context)
  );
}

async function completeProjectExpenseReview(
  context: ProjectExpenseApprovalReviewActionContext
) {
  if (!projectExpenseReviewContextIsCurrent(context)) return;
  reviewConfirmation.visible = false;
  reviewConfirmation.error = "";
  form.comment = "";
  form.approvedAmountYuan = "";
  form.selfReviewReason = "";
  actionTone.value = "success";
  actionMessage.value =
    context.decision === "approve"
      ? "项目支出审批已通过，详情已刷新。"
      : "项目支出审批已驳回，详情已刷新。";
  await loadDetail();
}

function failProjectExpenseReview(
  context: ProjectExpenseApprovalReviewActionContext,
  error: unknown
) {
  if (!projectExpenseReviewContextIsCurrent(context)) return;
  const reason =
    error instanceof Error ? error.message : "项目支出审批操作失败";
  actionTone.value = "error";
  actionMessage.value = reason;
  reviewConfirmation.error = reason;
}

function finishProjectExpenseReview(
  context: ProjectExpenseApprovalReviewActionContext
) {
  if (
    context.ownerScope === reviewOwnerScope &&
    context.operationId === reviewBusyOwnerId
  ) {
    reviewBusyOwnerId = 0;
    reviewSubmitting.value = false;
  }
}

function confirmProjectExpenseReviewApprove(values: {
  reason: string;
  password: string;
}) {
  return executeProjectExpenseApprovalReviewAction({
    decision: "approve",
    capture: () =>
      captureProjectExpenseReviewContext("approve", values.password),
    preflight: (context) =>
      prepareProjectExpenseApprovalReviewAction({
        ...context,
        decision: "approve",
        isCurrent: projectExpenseReviewContextIsCurrent
      }),
    current: preparedProjectExpenseReviewIsCurrent,
    complete: completeProjectExpenseReview,
    fail: failProjectExpenseReview,
    finish: finishProjectExpenseReview
  });
}

function confirmProjectExpenseReviewReject(values: {
  reason: string;
  password: string;
}) {
  return executeProjectExpenseApprovalReviewAction({
    decision: "reject",
    capture: () =>
      captureProjectExpenseReviewContext("reject", values.password),
    preflight: (context) =>
      prepareProjectExpenseApprovalReviewAction({
        ...context,
        decision: "reject",
        isCurrent: projectExpenseReviewContextIsCurrent
      }),
    current: preparedProjectExpenseReviewIsCurrent,
    complete: completeProjectExpenseReview,
    fail: failProjectExpenseReview,
    finish: finishProjectExpenseReview
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
  reviewComponentActive = false;
  withdrawalComponentActive = false;
  executionComponentActive = false;
  clearProjectExpenseRouteContext();
});
</script>

<style scoped>
.project-expense-approval-detail-page,
.review-form,
.approval-self-review-fields {
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

.execution-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
  min-width: 0;
}

.execution-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.execution-field--wide {
  grid-column: 1 / -1;
}

.execution-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--jg-space-md);
}

@container jg-page (max-width: 620px) {
  .page-head,
  .review-buttons {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-grid,
  .execution-form {
    grid-template-columns: 1fr;
  }

  .summary-wide,
  .execution-field--wide {
    grid-column: auto;
  }

  .execution-actions {
    display: grid;
  }
}
</style>
