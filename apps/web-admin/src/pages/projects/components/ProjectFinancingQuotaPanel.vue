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
        v-if="reviewNotice"
        theme="success"
        :message="reviewNotice"
        class="request-alert"
      />
      <t-alert
        v-if="reviewLaunchError"
        theme="error"
        title="审批资格校验失败"
        :message="reviewLaunchError"
        class="request-alert"
      />
      <t-alert
        v-if="terminationNotice"
        theme="success"
        :message="terminationNotice"
        class="request-alert"
      />
      <t-alert
        v-if="terminationLaunchError"
        theme="error"
        title="终止资格校验失败"
        :message="terminationLaunchError"
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
        <template #operation="{ row }">
          <div
            v-if="reviewActionEnabled(row.reviewAction) || terminateActionEnabled(row.terminateAction)"
            class="quota-actions"
          >
            <div
              v-if="reviewActionEnabled(row.reviewAction)"
              class="review-actions"
            >
              <t-button
                size="small"
                theme="primary"
                variant="text"
                :loading="reviewOpeningQuotaId === row.id"
                :disabled="reviewBusy || terminationBusy"
                @click="openReview(row, 'approve')"
              >
                通过
              </t-button>
              <t-button
                size="small"
                theme="danger"
                variant="text"
                :loading="reviewOpeningQuotaId === row.id"
                :disabled="reviewBusy || terminationBusy"
                @click="openReview(row, 'reject')"
              >
                驳回
              </t-button>
            </div>
            <t-button
              v-if="terminateActionEnabled(row.terminateAction)"
              size="small"
              theme="danger"
              variant="text"
              :loading="terminationOpeningQuotaId === row.id"
              :disabled="reviewBusy || terminationBusy"
              @click="openTermination(row)"
            >
              终止额度
            </t-button>
          </div>
          <span v-else>—</span>
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

    <t-dialog
      v-if="reviewArmed && selectedFinancingQuotaReviewAction && selectedFinancingQuotaReviewAction.enabled"
      :visible="reviewVisible"
      :header="reviewContext.decision === 'approve' ? '确认通过垫资额度审批？' : '确认驳回垫资额度审批？'"
      width="min(560px, calc(100vw - 32px))"
      :close-btn="!reviewBusy"
      :close-on-esc-keydown="!reviewBusy"
      :close-on-overlay-click="false"
      @close="cancelReview"
      @update:visible="handleReviewVisibleChange"
    >
      <div class="review-form">
        <t-alert
          theme="warning"
          title="请确认审批影响"
          :message="reviewContext.decision === 'approve'
            ? '通过后将推进当前节点；只有董事长或总经理终审通过后额度才生效，本操作不会占用额度。'
            : '驳回后本轮额度审批结束，审批意见和签名将保留在审计历史中。'"
        />
        <label>
          <span>审批意见（选填）</span>
          <t-textarea
            v-model="reviewForm.comment"
            :disabled="reviewAttempted"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="填写审批意见"
          />
        </label>
        <label v-if="reviewContext.requiresSelfReviewConfirmation">
          <span>本人独立复核说明 <b aria-hidden="true">*</b></span>
          <t-textarea
            v-model="reviewForm.selfReviewReason"
            :disabled="reviewAttempted"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="说明本人发起后如何完成独立复核"
          />
        </label>
        <label>
          <span>当前登录密码 <b aria-hidden="true">*</b></span>
          <t-input
            v-model="reviewForm.confirmationPassword"
            type="password"
            autocomplete="current-password"
            :disabled="reviewAttempted"
            placeholder="用于确认当前操作者身份"
          />
        </label>
        <t-alert
          v-if="reviewError"
          theme="error"
          title="暂时无法提交"
          :message="reviewError"
        />
      </div>
      <template #footer>
        <t-space>
          <t-button
            variant="outline"
            :disabled="reviewBusy"
            @click="cancelReview"
          >
            取消
          </t-button>
          <t-button
            v-if="reviewContext.decision === 'approve' && selectedFinancingQuotaReviewAction && selectedFinancingQuotaReviewAction.enabled"
            theme="primary"
            :loading="reviewBusy"
            :disabled="reviewBusy"
            @click="submitApproveReview"
          >
            确认通过
          </t-button>
          <t-button
            v-if="reviewContext.decision === 'reject' && selectedFinancingQuotaReviewAction && selectedFinancingQuotaReviewAction.enabled"
            theme="danger"
            :loading="reviewBusy"
            :disabled="reviewBusy"
            @click="submitRejectReview"
          >
            确认驳回
          </t-button>
        </t-space>
      </template>
    </t-dialog>

    <t-dialog
      v-if="terminationArmed && selectedFinancingQuotaTerminationAction && selectedFinancingQuotaTerminationAction.enabled"
      :visible="terminationVisible"
      header="确认终止垫资额度？"
      width="min(560px, calc(100vw - 32px))"
      :close-btn="!terminationBusy"
      :close-on-esc-keydown="!terminationBusy"
      :close-on-overlay-click="false"
      @close="cancelTermination"
      @update:visible="handleTerminationVisibleChange"
    >
      <div class="termination-form">
        <t-alert
          theme="error"
          title="终止后立即阻止新占用"
          message="本操作不删除、不释放、不重排既有资金使用和冲正历史；后续合法退款或冲正仍以服务端权威台账为准。"
        />
        <div class="termination-impact">
          <span>当前已占用</span>
          <strong>{{ formatMoney(terminationContext.netUsedAmountCents) }}</strong>
          <span>当前剩余额度</span>
          <strong>{{ formatMoney(terminationContext.availableAmountCents) }}</strong>
        </div>
        <label>
          <span>终止原因 <b aria-hidden="true">*</b></span>
          <t-textarea
            v-model="terminationForm.reason"
            :disabled="terminationAttempted"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="说明终止额度的业务原因"
          />
        </label>
        <label>
          <span>当前登录密码 <b aria-hidden="true">*</b></span>
          <t-input
            v-model="terminationForm.confirmationPassword"
            type="password"
            autocomplete="current-password"
            :disabled="terminationAttempted"
            placeholder="用于确认当前操作者身份"
          />
        </label>
        <t-alert
          v-if="terminationError"
          theme="error"
          title="暂时无法提交"
          :message="terminationError"
        />
      </div>
      <template #footer>
        <t-space>
          <t-button
            variant="outline"
            :disabled="terminationBusy"
            @click="cancelTermination"
          >
            取消
          </t-button>
          <t-button
            v-if="selectedFinancingQuotaTerminationAction && selectedFinancingQuotaTerminationAction.enabled"
            theme="danger"
            :loading="terminationBusy"
            :disabled="terminationBusy"
            @click="submitTermination"
          >
            确认终止
          </t-button>
        </t-space>
      </template>
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
  createProjectFinancingQuotaTerminationExecutionState,
  createProjectFinancingQuotaTerminationAttemptState,
  createProjectFinancingQuotaReviewExecutionState,
  createProjectFinancingQuotaReviewAttemptState,
  createProjectFinancingQuotaRequestAttemptState,
  executeProjectFinancingQuotaReviewAction,
  executeProjectFinancingQuotaTerminationAction,
  fetchProjectFinancingQuotaTerminationCapability,
  fetchProjectFinancingQuotaReviewCapability,
  fetchProjectFinancingQuotaRequestCapability,
  reviewActionEnabled,
  requestProjectFinancingQuotaWithUpload,
  terminateActionEnabled,
  type ProjectFinancingQuotaActionReadModel,
  type ProjectFinancingQuotaReviewAttemptState,
  type ProjectFinancingQuotaReviewDecision,
  type ProjectFinancingQuotaReviewExecutionState,
  type ProjectFinancingQuotaReviewExecutionSubmission,
  type ProjectFinancingQuotaRequestAttemptState,
  type ProjectFinancingQuotaRowReadModel,
  type ProjectFinancingQuotaStatus,
  type ProjectFinancingQuotaTerminationAttemptState,
  type ProjectFinancingQuotaTerminationExecutionState,
  type ProjectFinancingQuotaTerminationExecutionSubmission,
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

type ReviewContext = {
  projectId: string;
  quotaId: string;
  projectGeneration: number;
  actionId: string;
  lifecycleToken: string;
  decision: ProjectFinancingQuotaReviewDecision;
  requiresSelfReviewConfirmation: boolean;
};

type ReviewOperationContext = ReviewContext & {
  operationId: number;
};

type TerminationContext = {
  projectId: string;
  quotaId: string;
  projectGeneration: number;
  actionId: string;
  lifecycleToken: string;
  netUsedAmountCents: string;
  availableAmountCents: string;
};

type TerminationOperationContext = TerminationContext & {
  operationId: number;
};

const EMPTY_REQUEST_CONTEXT: RequestContext = {
  projectId: "",
  projectGeneration: -1,
  idempotencyKey: ""
};

const EMPTY_REVIEW_CONTEXT: ReviewContext = {
  projectId: "",
  quotaId: "",
  projectGeneration: -1,
  actionId: "",
  lifecycleToken: "",
  decision: "approve",
  requiresSelfReviewConfirmation: false
};

const EMPTY_TERMINATION_CONTEXT: TerminationContext = {
  projectId: "",
  quotaId: "",
  projectGeneration: -1,
  actionId: "",
  lifecycleToken: "",
  netUsedAmountCents: "0",
  availableAmountCents: "0"
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
const reviewVisible = ref(false);
const reviewBusy = ref(false);
const reviewAttempted = ref(false);
const reviewError = ref("");
const reviewLaunchError = ref("");
const reviewNotice = ref("");
const reviewOpeningQuotaId = ref("");
const reviewForm = ref(createReviewForm());
const reviewContext = ref<ReviewContext>({ ...EMPTY_REVIEW_CONTEXT });
const selectedFinancingQuotaReviewAction = shallowRef<
  ProjectFinancingQuotaActionReadModel | null
>(null);
const reviewArmed = ref(false);
const terminationVisible = ref(false);
const terminationBusy = ref(false);
const terminationAttempted = ref(false);
const terminationError = ref("");
const terminationLaunchError = ref("");
const terminationNotice = ref("");
const terminationOpeningQuotaId = ref("");
const terminationForm = ref(createTerminationForm());
const terminationContext = ref<TerminationContext>({
  ...EMPTY_TERMINATION_CONTEXT
});
const selectedFinancingQuotaTerminationAction = shallowRef<
  ProjectFinancingQuotaActionReadModel | null
>(null);
const terminationArmed = ref(false);
let componentAlive = true;
let projectGeneration = 0;
let requestOpenSequence = 0;
let requestOperationSequence = 0;
let activeRequestOperationId = 0;
let reviewOpenSequence = 0;
let reviewOperationSequence = 0;
let activeReviewOperationId = 0;
let terminationOpenSequence = 0;
let terminationOperationSequence = 0;
let activeTerminationOperationId = 0;
let requestAttemptState: ProjectFinancingQuotaRequestAttemptState =
  createProjectFinancingQuotaRequestAttemptState();
let reviewAttemptState: ProjectFinancingQuotaReviewAttemptState =
  createProjectFinancingQuotaReviewAttemptState();
let reviewExecutionState: ProjectFinancingQuotaReviewExecutionState<ReviewOperationContext> =
  createProjectFinancingQuotaReviewExecutionState<ReviewOperationContext>();
let terminationAttemptState: ProjectFinancingQuotaTerminationAttemptState =
  createProjectFinancingQuotaTerminationAttemptState();
let terminationExecutionState: ProjectFinancingQuotaTerminationExecutionState<TerminationOperationContext> =
  createProjectFinancingQuotaTerminationExecutionState<TerminationOperationContext>();

onBeforeUnmount(() => {
  componentAlive = false;
  projectGeneration += 1;
  requestOpenSequence += 1;
  activeRequestOperationId = 0;
  reviewOpenSequence += 1;
  activeReviewOperationId = 0;
  reviewExecutionState =
    createProjectFinancingQuotaReviewExecutionState<ReviewOperationContext>();
  terminationOpenSequence += 1;
  activeTerminationOperationId = 0;
  terminationExecutionState =
    createProjectFinancingQuotaTerminationExecutionState<TerminationOperationContext>();
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
    reviewOpenSequence += 1;
    activeReviewOperationId = 0;
    reviewExecutionState =
      createProjectFinancingQuotaReviewExecutionState<ReviewOperationContext>();
    reviewOpeningQuotaId.value = "";
    reviewBusy.value = false;
    clearReviewSelection();
    reviewLaunchError.value = "";
    reviewNotice.value = "";
    terminationOpenSequence += 1;
    activeTerminationOperationId = 0;
    terminationExecutionState =
      createProjectFinancingQuotaTerminationExecutionState<TerminationOperationContext>();
    terminationOpeningQuotaId.value = "";
    terminationBusy.value = false;
    clearTerminationSelection();
    terminationLaunchError.value = "";
    terminationNotice.value = "";
  }
);

const quotaColumns = [
  { colKey: "reason", title: "申请事由 / 申请人", minWidth: 240 },
  { colKey: "amountCents", title: "额度金额", width: 130 },
  { colKey: "netUsedAmountCents", title: "已使用净额", width: 130 },
  { colKey: "availableAmountCents", title: "当前可用", width: 130 },
  { colKey: "status", title: "状态 / 当前节点", minWidth: 190 },
  { colKey: "validUntil", title: "有效期", width: 130 },
  { colKey: "operation", title: "审批 / 终止", width: 188, fixed: "right" }
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

async function openReview(
  row: ProjectFinancingQuotaRowReadModel,
  decision: ProjectFinancingQuotaReviewDecision
) {
  if (
    reviewOpeningQuotaId.value ||
    reviewBusy.value ||
    reviewVisible.value ||
    terminationOpeningQuotaId.value ||
    terminationBusy.value ||
    terminationVisible.value ||
    props.workbench.project.id !== props.projectId ||
    !reviewActionEnabled(row.reviewAction)
  ) {
    return;
  }

  clearReviewSelection();
  const context: ReviewContext = {
    projectId: props.projectId,
    quotaId: row.id,
    projectGeneration,
    actionId: crypto.randomUUID(),
    lifecycleToken: row.lifecycleToken,
    decision,
    requiresSelfReviewConfirmation:
      row.reviewAction.requiresSelfReviewConfirmation === true
  };
  const openReviewId = ++reviewOpenSequence;
  reviewContext.value = context;
  reviewOpeningQuotaId.value = row.id;
  reviewLaunchError.value = "";
  reviewNotice.value = "";
  try {
    const freshCapability = await fetchProjectFinancingQuotaReviewCapability(
      context.projectId,
      context.quotaId
    );
    if (!reviewOpenContextIsCurrent(context, openReviewId)) return;
    const requiresSelfReviewConfirmation =
      freshCapability.reviewAction.requiresSelfReviewConfirmation === true;
    if (
      freshCapability.projectId !== context.projectId ||
      freshCapability.quotaId !== context.quotaId ||
      freshCapability.status !== "approval_pending" ||
      freshCapability.reviewAction.key !== "review_financing_quota" ||
      freshCapability.reviewAction.enabled !== true ||
      freshCapability.reviewAction.requiredAction !==
        "project.financing_quota.approve" ||
      freshCapability.reviewAction.requiresPassword !== true ||
      (freshCapability.reviewAction.requiresSelfReviewConfirmation === true) !==
        requiresSelfReviewConfirmation
    ) {
      throw new Error("项目垫资额度审批资格已变化，请刷新台账后重试");
    }
    reviewContext.value = {
      ...context,
      lifecycleToken: freshCapability.lifecycleToken,
      requiresSelfReviewConfirmation
    };
    selectedFinancingQuotaReviewAction.value =
      freshCapability.reviewAction;
    reviewAttemptState = createProjectFinancingQuotaReviewAttemptState();
    reviewArmed.value = true;
    reviewVisible.value = true;
  } catch (error) {
    if (reviewOpenOperationIsCurrent(context, openReviewId)) {
      reviewContext.value = { ...EMPTY_REVIEW_CONTEXT };
      reviewLaunchError.value = errorMessage(
        error,
        "项目垫资额度审批资格校验失败"
      );
    }
  } finally {
    if (reviewOpenOperationIsCurrent(context, openReviewId)) {
      reviewOpeningQuotaId.value = "";
    }
  }
}

function submitApproveReview(): Promise<unknown> {
  return executeProjectFinancingQuotaReviewAction(
    {
      decision: "approve",
      attemptState: reviewAttemptState,
      capture: captureReviewSubmission,
      current: reviewContextIsCurrent,
      complete: (context, result) =>
        completeReview(result.workbench, context),
      fail: (context, error) => failReview(error, context),
      finish: finishReview
    },
    reviewExecutionState
  );
}

function submitRejectReview(): Promise<unknown> {
  return executeProjectFinancingQuotaReviewAction(
    {
      decision: "reject",
      attemptState: reviewAttemptState,
      capture: captureReviewSubmission,
      current: reviewContextIsCurrent,
      complete: (context, result) =>
        completeReview(result.workbench, context),
      fail: (context, error) => failReview(error, context),
      finish: finishReview
    },
    reviewExecutionState
  );
}

function captureReviewSubmission(
  decision: ProjectFinancingQuotaReviewDecision
): ProjectFinancingQuotaReviewExecutionSubmission<ReviewOperationContext> | null {
  const selected = reviewContext.value;
  const confirmationPassword = reviewForm.value.confirmationPassword;
  const comment = reviewForm.value.comment.trim();
  const selfReviewReason = reviewForm.value.selfReviewReason.trim();
  if (
    selected.decision !== decision ||
    !reviewContextIsCurrent(selected)
  ) {
    reviewError.value = "审批上下文已失效，请重新打开确认窗口。";
    return null;
  }
  if (!confirmationPassword.trim()) {
    reviewError.value = "请输入当前登录密码";
    return null;
  }
  if (Array.from(comment).length > 500) {
    reviewError.value = "审批意见不能超过 500 个字符";
    return null;
  }
  if (Array.from(selfReviewReason).length > 500) {
    reviewError.value = "本人独立复核说明不能超过 500 个字符";
    return null;
  }
  if (selected.requiresSelfReviewConfirmation && !selfReviewReason) {
    reviewError.value = "请填写财务主管本人独立复核说明";
    return null;
  }

  const context: ReviewOperationContext = {
    ...selected,
    operationId: ++reviewOperationSequence
  };
  activeReviewOperationId = context.operationId;
  reviewBusy.value = true;
  reviewAttempted.value = true;
  reviewError.value = "";
  return {
    projectId: context.projectId,
    quotaId: context.quotaId,
    confirmationPassword,
    ...(comment ? { comment } : {}),
    ...(context.requiresSelfReviewConfirmation
      ? { selfReviewReason }
      : {}),
    requiresSelfReviewConfirmation:
      context.requiresSelfReviewConfirmation,
    actionId: context.actionId,
    lifecycleToken: context.lifecycleToken,
    context
  };
}

function reviewOpenContextIsCurrent(
  context: ReviewContext,
  openReviewId: number
) {
  const selected = reviewContext.value;
  return Boolean(
    componentAlive &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration &&
      reviewOpenSequence === openReviewId &&
      selected.projectId === context.projectId &&
      selected.quotaId === context.quotaId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.actionId === context.actionId
  );
}

function reviewOpenOperationIsCurrent(
  context: ReviewContext,
  openReviewId: number
) {
  return (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    reviewOpenSequence === openReviewId
  );
}

function reviewContextIsCurrent(context: ReviewContext) {
  const selected = reviewContext.value;
  return Boolean(
    componentAlive &&
      reviewArmed.value &&
      reviewVisible.value &&
      selected.projectId === context.projectId &&
      selected.quotaId === context.quotaId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.actionId === context.actionId &&
      selected.lifecycleToken === context.lifecycleToken &&
      selected.decision === context.decision &&
      selected.requiresSelfReviewConfirmation ===
        context.requiresSelfReviewConfirmation &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration
  );
}

function reviewOperationIsCurrent(context: ReviewOperationContext) {
  return (
    reviewContextIsCurrent(context) &&
    activeReviewOperationId === context.operationId
  );
}

function completeReview(
  nextWorkbench: ProjectFinancingQuotaWorkbenchReadModel,
  context: ReviewOperationContext
) {
  if (!reviewOperationIsCurrent(context)) return;
  const decision = context.decision;
  clearReviewSelection();
  reviewNotice.value = decision === "approve"
    ? "垫资额度审批已通过当前节点，权威台账已刷新。"
    : "垫资额度审批已驳回，权威台账已刷新。";
  emit("updated", nextWorkbench);
}

function failReview(error: unknown, context: ReviewOperationContext) {
  if (!reviewOperationIsCurrent(context)) return;
  reviewAttempted.value = reviewAttemptState.submission !== null;
  reviewError.value = errorMessage(error, "项目垫资额度审批失败");
}

function finishReview(context: ReviewOperationContext) {
  if (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    activeReviewOperationId === context.operationId
  ) {
    reviewBusy.value = false;
    activeReviewOperationId = 0;
  }
}

function cancelReview() {
  if (reviewBusy.value) return;
  reviewOpenSequence += 1;
  activeReviewOperationId = 0;
  reviewExecutionState =
    createProjectFinancingQuotaReviewExecutionState<ReviewOperationContext>();
  clearReviewSelection();
}

function handleReviewVisibleChange(visible: boolean) {
  if (visible || reviewBusy.value) return;
  cancelReview();
}

function clearReviewSelection() {
  reviewVisible.value = false;
  reviewArmed.value = false;
  reviewContext.value = { ...EMPTY_REVIEW_CONTEXT };
  selectedFinancingQuotaReviewAction.value = null;
  reviewAttemptState = createProjectFinancingQuotaReviewAttemptState();
  reviewExecutionState =
    createProjectFinancingQuotaReviewExecutionState<ReviewOperationContext>();
  reviewAttempted.value = false;
  reviewBusy.value = false;
  activeReviewOperationId = 0;
  reviewForm.value = createReviewForm();
  reviewError.value = "";
}

async function openTermination(row: ProjectFinancingQuotaRowReadModel) {
  if (
    terminationOpeningQuotaId.value ||
    terminationBusy.value ||
    terminationVisible.value ||
    reviewOpeningQuotaId.value ||
    reviewBusy.value ||
    reviewVisible.value ||
    props.workbench.project.id !== props.projectId ||
    !terminateActionEnabled(row.terminateAction)
  ) {
    return;
  }

  clearTerminationSelection();
  const context: TerminationContext = {
    projectId: props.projectId,
    quotaId: row.id,
    projectGeneration,
    actionId: crypto.randomUUID(),
    lifecycleToken: row.lifecycleToken,
    netUsedAmountCents: row.netUsedAmountCents,
    availableAmountCents: row.availableAmountCents
  };
  const openTerminationId = ++terminationOpenSequence;
  terminationContext.value = context;
  terminationOpeningQuotaId.value = row.id;
  terminationLaunchError.value = "";
  terminationNotice.value = "";
  try {
    const freshCapability =
      await fetchProjectFinancingQuotaTerminationCapability(
        context.projectId,
        context.quotaId
      );
    if (!terminationOpenContextIsCurrent(context, openTerminationId)) return;
    if (
      freshCapability.projectId !== context.projectId ||
      freshCapability.quotaId !== context.quotaId ||
      freshCapability.status !== "approved" ||
      freshCapability.lifecycleToken !== context.lifecycleToken ||
      freshCapability.terminateAction.key !== "terminate_financing_quota" ||
      freshCapability.terminateAction.kind !== "danger" ||
      freshCapability.terminateAction.enabled !== true ||
      freshCapability.terminateAction.disabledReason !== null ||
      freshCapability.terminateAction.requiredAction !==
        "project.financing_quota.terminate" ||
      freshCapability.terminateAction.requiresPassword !== true
    ) {
      throw new Error("项目垫资额度终止资格已变化，请刷新台账后重试");
    }
    selectedFinancingQuotaTerminationAction.value =
      freshCapability.terminateAction;
    terminationAttemptState =
      createProjectFinancingQuotaTerminationAttemptState();
    terminationArmed.value = true;
    terminationVisible.value = true;
  } catch (error) {
    if (terminationOpenOperationIsCurrent(context, openTerminationId)) {
      terminationContext.value = { ...EMPTY_TERMINATION_CONTEXT };
      terminationLaunchError.value = errorMessage(
        error,
        "项目垫资额度终止资格校验失败"
      );
    }
  } finally {
    if (terminationOpenOperationIsCurrent(context, openTerminationId)) {
      terminationOpeningQuotaId.value = "";
    }
  }
}

function submitTermination(): Promise<unknown> {
  return executeProjectFinancingQuotaTerminationAction(
    {
      attemptState: terminationAttemptState,
      capture: captureTerminationSubmission,
      current: terminationContextIsCurrent,
      complete: (context, result) =>
        completeTermination(result.workbench, context),
      fail: (context, error) => failTermination(error, context),
      finish: finishTermination
    },
    terminationExecutionState
  );
}

function captureTerminationSubmission(): ProjectFinancingQuotaTerminationExecutionSubmission<TerminationOperationContext> | null {
  const selected = terminationContext.value;
  const reason = terminationForm.value.reason.trim();
  const confirmationPassword = terminationForm.value.confirmationPassword;
  if (!terminationContextIsCurrent(selected)) {
    terminationError.value = "终止上下文已失效，请重新打开确认窗口。";
    return null;
  }
  if (!reason) {
    terminationError.value = "请填写终止原因";
    return null;
  }
  if (Array.from(reason).length > 500) {
    terminationError.value = "终止原因不能超过 500 个字符";
    return null;
  }
  if (!confirmationPassword.trim()) {
    terminationError.value = "请输入当前登录密码";
    return null;
  }

  const context: TerminationOperationContext = {
    ...selected,
    operationId: ++terminationOperationSequence
  };
  activeTerminationOperationId = context.operationId;
  terminationBusy.value = true;
  terminationAttempted.value = true;
  terminationError.value = "";
  return {
    projectId: context.projectId,
    quotaId: context.quotaId,
    reason,
    confirmationPassword,
    actionId: context.actionId,
    lifecycleToken: context.lifecycleToken,
    context
  };
}

function terminationOpenContextIsCurrent(
  context: TerminationContext,
  openTerminationId: number
) {
  const selected = terminationContext.value;
  return Boolean(
    componentAlive &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration &&
      terminationOpenSequence === openTerminationId &&
      selected.projectId === context.projectId &&
      selected.quotaId === context.quotaId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.actionId === context.actionId
  );
}

function terminationOpenOperationIsCurrent(
  context: TerminationContext,
  openTerminationId: number
) {
  return (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    terminationOpenSequence === openTerminationId
  );
}

function terminationContextIsCurrent(context: TerminationContext) {
  const selected = terminationContext.value;
  return Boolean(
    componentAlive &&
      terminationArmed.value &&
      terminationVisible.value &&
      selected.projectId === context.projectId &&
      selected.quotaId === context.quotaId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.actionId === context.actionId &&
      selected.lifecycleToken === context.lifecycleToken &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration
  );
}

function terminationOperationIsCurrent(
  context: TerminationOperationContext
) {
  return (
    terminationContextIsCurrent(context) &&
    activeTerminationOperationId === context.operationId
  );
}

function completeTermination(
  nextWorkbench: ProjectFinancingQuotaWorkbenchReadModel,
  context: TerminationOperationContext
) {
  if (!terminationOperationIsCurrent(context)) return;
  clearTerminationSelection();
  terminationNotice.value =
    "垫资额度已终止新占用，既有使用与冲正历史已保留，权威台账已刷新。";
  emit("updated", nextWorkbench);
}

function failTermination(
  error: unknown,
  context: TerminationOperationContext
) {
  if (!terminationOperationIsCurrent(context)) return;
  terminationAttempted.value = terminationAttemptState.submission !== null;
  terminationError.value = errorMessage(
    error,
    "项目垫资额度终止失败"
  );
}

function finishTermination(context: TerminationOperationContext) {
  if (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    activeTerminationOperationId === context.operationId
  ) {
    terminationBusy.value = false;
    activeTerminationOperationId = 0;
  }
}

function cancelTermination() {
  if (terminationBusy.value) return;
  terminationOpenSequence += 1;
  activeTerminationOperationId = 0;
  terminationExecutionState =
    createProjectFinancingQuotaTerminationExecutionState<TerminationOperationContext>();
  clearTerminationSelection();
}

function handleTerminationVisibleChange(visible: boolean) {
  if (visible || terminationBusy.value) return;
  cancelTermination();
}

function clearTerminationSelection() {
  terminationVisible.value = false;
  terminationArmed.value = false;
  terminationContext.value = { ...EMPTY_TERMINATION_CONTEXT };
  selectedFinancingQuotaTerminationAction.value = null;
  terminationAttemptState = createProjectFinancingQuotaTerminationAttemptState();
  terminationExecutionState =
    createProjectFinancingQuotaTerminationExecutionState<TerminationOperationContext>();
  terminationAttempted.value = false;
  terminationBusy.value = false;
  activeTerminationOperationId = 0;
  terminationForm.value = createTerminationForm();
  terminationError.value = "";
}

function createRequestForm() {
  return {
    amountYuan: "",
    reason: "",
    validUntil: ""
  };
}

function createReviewForm() {
  return {
    comment: "",
    confirmationPassword: "",
    selfReviewReason: ""
  };
}

function createTerminationForm() {
  return {
    reason: "",
    confirmationPassword: ""
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

.review-form,
.review-form label,
.termination-form,
.termination-form label {
  display: grid;
  gap: var(--jg-space-sm);
}

.review-form,
.termination-form {
  gap: var(--jg-space-md-plus);
}

.review-form label > span,
.termination-form label > span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
}

.review-form b,
.termination-form b {
  color: var(--jg-color-danger);
}

.quota-actions,
.review-actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-xs);
}

.quota-actions {
  flex-wrap: wrap;
}

.termination-impact {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--jg-space-sm);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-md);
  padding: var(--jg-space-md-plus);
  background: var(--jg-bg-muted);
}

.termination-impact span {
  color: var(--jg-color-text-secondary);
}

.termination-impact strong {
  color: var(--jg-color-text-primary);
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
