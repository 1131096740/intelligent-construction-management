<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import {
  confirmFundExecutionCase,
  createFundExecutionCase,
  createFundExecutionReversal,
  fetchFundExecutionCapabilities,
  fetchFundExecutionCaseActions,
  fetchFundExecutionCaseOptions,
  fetchFundExecutionCases,
  fetchFundExecutionObservationOptions,
  fetchFundExecutionReversalOptions,
  returnFundExecutionCase,
  reviewFundExecutionCase,
  submitFundExecutionCase,
  updateFundExecutionCase,
  updateFundExecutionReversalReason,
  type FundExecutionCaseActionKey,
  type FundExecutionCaseListItem,
  type FundExecutionClassificationPlan,
  type FundExecutionObservationOption,
  type FundExecutionReversalOption
} from "../../api/fund-execution.api";
import { formatUnknownApiError } from "../../api/error-message";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText } from "../../lib/money";
import {
  FUND_EXECUTION_AXIS_LABELS,
  caseAllowsClassification,
  createFundExecutionIdempotencyLease,
  flattenClassificationPlan,
  selectedClassificationPlan,
  selectionIsExpired
} from "./fund-execution.state";

type CreateMode = "quarantine" | "reversal";
type PendingAction = Exclude<FundExecutionCaseActionKey, "update_case">;

const loading = ref(false);
const submitting = ref(false);
const optionLoading = ref(false);
const errorMessage = ref("");
const cases = ref<FundExecutionCaseListItem[]>([]);
const observationOptions = ref<FundExecutionObservationOption[]>([]);
const reversalOptions = ref<FundExecutionReversalOption[]>([]);
const selectedCase = ref<FundExecutionCaseListItem | null>(null);
const caseDrawerVisible = ref(false);
const classificationPlans = ref<FundExecutionClassificationPlan[]>([]);
const selectedPlanIndex = ref("");
const draftReason = ref("");
const approvalComment = ref("");
const actionDialogVisible = ref(false);
const pendingAction = ref<PendingAction | null>(null);
const pendingActionCase = ref<FundExecutionCaseListItem | null>(null);
const pendingApprovalComment = ref("");
const actionError = ref("");
const idempotencyLease = createFundExecutionIdempotencyLease();

const createForm = reactive({
  mode: "quarantine" as CreateMode,
  observationSelectionRef: "",
  targetSelectionRef: "",
  reason: ""
});

const columns = [
  { colKey: "caseLabel", title: "业务案件", width: 160, fixed: "left" as const },
  { colKey: "observationSummary", title: "已核验银行流水", minWidth: 300 },
  { colKey: "reason", title: "办理原因", minWidth: 220 },
  { colKey: "classificationSummary", title: "正式分类", minWidth: 220 },
  { colKey: "status", title: "状态", width: 120 },
  { colKey: "updatedAt", title: "更新时间", width: 170 },
  { colKey: "actions", title: "操作", width: 110, fixed: "right" as const }
];

const createModeOptions = [
  { label: "初始待分类", value: "quarantine" },
  { label: "反向执行", value: "reversal" }
];
const observationSelectOptions = computed(() =>
  observationOptions.value.map((option) => ({
    value: option.selectionRef,
    label: option.summary,
    disabled: selectionIsExpired(option.expiresAt)
  }))
);
const reversalSelectOptions = computed(() =>
  reversalOptions.value.map((option) => ({
    value: option.targetSelectionRef,
    label: option.summary,
    disabled: selectionIsExpired(option.expiresAt)
  }))
);
const selectedPlan = computed(() =>
  selectedClassificationPlan(classificationPlans.value, selectedPlanIndex.value)
);
const caseSummary = computed(() => ({
  total: cases.value.length,
  draft: cases.value.filter(({ status }) => status === "draft").length,
  submitted: cases.value.filter(({ status }) => status === "submitted").length,
  confirmed: cases.value.filter(({ status }) => status === "confirmed").length
}));
const selectedCaseCanClassify = computed(() =>
  selectedCase.value ? caseAllowsClassification(selectedCase.value) : false
);
const selectedCaseCanEditReversalReason = computed(() => {
  const row = selectedCase.value;
  return Boolean(
    row &&
      row.executionKind === "reversal" &&
      actionEnabled(row, "update_case")
  );
});
const pendingActionConfig = computed(() => {
  switch (pendingAction.value) {
    case "submit_case":
      return {
        title: "确认提交资金执行案件？",
        description: "提交后当前草稿与逐轴分类将被冻结并进入审批。",
        confirmText: "确认提交",
        requireReason: false,
        confirmTheme: "primary" as const
      };
    case "return_case":
      return {
        title: "确认生成退回修改稿？",
        description: "当前已提交案件保持冻结，系统将追加一个沿用同一执行事实的修改稿。",
        confirmText: "确认退回",
        requireReason: true,
        confirmTheme: "danger" as const
      };
    case "confirm_case":
      return {
        title: "确认进入正式账？",
        description: "确认后将按已审批的逐轴分类形成不可变正式后果。",
        confirmText: "确认入账",
        requireReason: false,
        confirmTheme: "primary" as const
      };
    case "approve":
      return {
        title: "确认通过当前审批？",
        description: "系统将记录当前审批动作；最终确认仍由具有相应职责的人员另行完成。",
        confirmText: "审批通过",
        requireReason: false,
        confirmTheme: "primary" as const
      };
    default:
      return {
        title: "确认退回审批？",
        description: "当前提交稿保持冻结，申请人需根据退回原因继续办理。",
        confirmText: "退回申请人",
        requireReason: true,
        confirmTheme: "danger" as const
      };
  }
});

onMounted(() => void loadWorkbench());

async function loadWorkbench() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [caseRows, observations, reversals] = await Promise.all([
      fetchFundExecutionCases(),
      fetchFundExecutionObservationOptions("fund_execution_case"),
      fetchFundExecutionReversalOptions()
    ]);
    cases.value = caseRows;
    observationOptions.value = observations;
    reversalOptions.value = reversals;
    refreshSelectedCase(caseRows);
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载资金执行工作台失败");
  } finally {
    loading.value = false;
  }
}

function refreshSelectedCase(rows: FundExecutionCaseListItem[]) {
  const current = selectedCase.value;
  if (!current) return;
  const refreshed = rows.find(({ caseRef }) => caseRef === current.caseRef);
  if (!refreshed) {
    closeCaseDrawer();
    return;
  }
  selectedCase.value = refreshed;
  draftReason.value = refreshed.reason;
}

function changeCreateMode() {
  createForm.observationSelectionRef = "";
  createForm.targetSelectionRef = "";
  errorMessage.value = "";
}

async function submitCreate() {
  if (submitting.value) return;
  const observation = observationOptions.value.find(
    ({ selectionRef }) => selectionRef === createForm.observationSelectionRef
  );
  if (
    !observation?.selectionRef ||
    selectionIsExpired(observation.expiresAt)
  ) {
    errorMessage.value = "请选择仍在有效期内的银行流水候选";
    return;
  }
  const reason = createForm.reason.trim();
  if (!reason) {
    errorMessage.value = "请填写本次资金执行的业务原因";
    return;
  }
  submitting.value = true;
  errorMessage.value = "";
  try {
    if (createForm.mode === "reversal") {
      const target = reversalOptions.value.find(
        ({ targetSelectionRef }) => targetSelectionRef === createForm.targetSelectionRef
      );
      if (
        !target?.targetSelectionRef ||
        selectionIsExpired(target.expiresAt)
      ) {
        throw new Error("请选择仍可反向执行的原业务事项");
      }
      const command = "create-reversal";
      const payload = {
        targetSelectionRef: target.targetSelectionRef,
        observationSelectionRef: observation.selectionRef,
        reason
      };
      await createFundExecutionReversalWithCapability({
        ...payload,
        idempotencyKey: idempotencyLease.acquire(command, payload)
      });
      idempotencyLease.complete(command, payload);
      MessagePlugin.success("反向资金执行案件已创建，原分类已由系统沿用");
    } else {
      const command = "create-case";
      const payload = {
        observationSelectionRef: observation.selectionRef,
        reason
      };
      await createFundExecutionCaseWithCapability({
        ...payload,
        idempotencyKey: idempotencyLease.acquire(command, payload)
      });
      idempotencyLease.complete(command, payload);
      MessagePlugin.success("待分类资金执行案件已创建");
    }
    clearCreateForm();
    await loadWorkbench();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "创建资金执行案件失败");
  } finally {
    submitting.value = false;
  }
}

function clearCreateForm() {
  createForm.observationSelectionRef = "";
  createForm.targetSelectionRef = "";
  createForm.reason = "";
}

async function openCase(row: FundExecutionCaseListItem) {
  selectedCase.value = row;
  draftReason.value = row.reason;
  approvalComment.value = "";
  classificationPlans.value = [];
  selectedPlanIndex.value = "";
  caseDrawerVisible.value = true;
  if (!caseAllowsClassification(row)) return;
  optionLoading.value = true;
  try {
    classificationPlans.value = await fetchFundExecutionCaseOptions(row.caseRef);
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载逐轴分类选项失败");
  } finally {
    optionLoading.value = false;
  }
}

function closeCaseDrawer() {
  caseDrawerVisible.value = false;
  selectedCase.value = null;
  classificationPlans.value = [];
  selectedPlanIndex.value = "";
  draftReason.value = "";
  approvalComment.value = "";
}

async function saveClassification() {
  const row = selectedCase.value;
  const plan = selectedPlan.value;
  if (!row || !selectedCaseCanClassify.value || !plan) {
    errorMessage.value = "请选择一套仍有效的完整逐轴分类方案";
    return;
  }
  if (selectionIsExpired(plan.expiresAt)) {
    errorMessage.value = "逐轴分类选项已过期，请刷新案件后重新选择";
    return;
  }
  const reason = draftReason.value.trim();
  if (!reason) {
    errorMessage.value = "请填写资金执行原因";
    return;
  }
  submitting.value = true;
  errorMessage.value = "";
  try {
    const command = `update-classification:${row.caseRef}`;
    const payload = {
      expectedRevision: row.revision,
      reason,
      selections: flattenClassificationPlan(plan)
    };
    await updateFundExecutionCaseWithCapability(row.caseRef, {
      ...payload,
      idempotencyKey: idempotencyLease.acquire(command, payload)
    });
    idempotencyLease.complete(command, payload);
    MessagePlugin.success("逐轴分类修改稿已保存");
    closeCaseDrawer();
    await loadWorkbench();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "保存逐轴分类失败");
  } finally {
    submitting.value = false;
  }
}

async function saveReversalReason() {
  const row = selectedCase.value;
  if (!row || !selectedCaseCanEditReversalReason.value) {
    errorMessage.value = "当前反向执行案件不可修改";
    return;
  }
  const reason = draftReason.value.trim();
  if (!reason) {
    errorMessage.value = "请填写反向资金执行原因";
    return;
  }
  submitting.value = true;
  errorMessage.value = "";
  try {
    const command = `update-reversal-reason:${row.caseRef}`;
    const payload = {
      expectedRevision: row.revision,
      reason
    };
    await updateFundExecutionReversalReasonWithCapability(row.caseRef, {
      ...payload,
      idempotencyKey: idempotencyLease.acquire(command, payload)
    });
    idempotencyLease.complete(command, payload);
    MessagePlugin.success("反向资金执行原因已保存");
    closeCaseDrawer();
    await loadWorkbench();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "保存反向资金执行原因失败");
  } finally {
    submitting.value = false;
  }
}

function actionEnabled(row: FundExecutionCaseListItem, key: FundExecutionCaseActionKey) {
  return row.actions.some((action) => action.key === key && action.enabled);
}

async function createFundExecutionCaseWithCapability(
  input: Parameters<typeof createFundExecutionCase>[0]
) {
  const capability = await fetchFundExecutionCapabilities();
  const operationAllowed = capability.createCase;
  if (!operationAllowed) throw new Error("服务端已撤销资金执行案件创建权限");
  return createFundExecutionCase(input);
}

async function createFundExecutionReversalWithCapability(
  input: Parameters<typeof createFundExecutionReversal>[0]
) {
  const capability = await fetchFundExecutionCapabilities();
  const operationAllowed = capability.createReversal;
  if (!operationAllowed) throw new Error("服务端已撤销反向执行案件创建权限");
  return createFundExecutionReversal(input);
}

async function updateFundExecutionCaseWithCapability(
  caseRef: string,
  input: Parameters<typeof updateFundExecutionCase>[1]
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "update_case" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销资金执行分类修改权限");
  return updateFundExecutionCase(caseRef, input);
}

async function updateFundExecutionReversalReasonWithCapability(
  caseRef: string,
  input: Parameters<typeof updateFundExecutionReversalReason>[1]
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "update_case" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销反向执行修改权限");
  return updateFundExecutionReversalReason(caseRef, input);
}

async function submitFundExecutionCaseWithCapability(
  caseRef: string,
  input: Parameters<typeof submitFundExecutionCase>[1]
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "submit_case" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销资金执行提交权限");
  return submitFundExecutionCase(caseRef, input);
}

async function returnFundExecutionCaseWithCapability(
  caseRef: string,
  input: Parameters<typeof returnFundExecutionCase>[1]
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "return_case" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销资金执行退回权限");
  return returnFundExecutionCase(caseRef, input);
}

async function confirmFundExecutionCaseWithCapability(
  caseRef: string,
  input: Parameters<typeof confirmFundExecutionCase>[1]
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "confirm_case" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销资金执行确认权限");
  return confirmFundExecutionCase(caseRef, input);
}

async function approveFundExecutionCaseWithCapability(
  caseRef: string,
  comment?: string
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "approve" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销资金执行审批权限");
  return reviewFundExecutionCase(caseRef, { action: "approve", comment });
}

async function returnFundExecutionApprovalWithCapability(
  caseRef: string,
  comment: string
) {
  const freshCase = await fetchFundExecutionCaseActions(caseRef);
  const operationAllowed = freshCase.actions.some(
    (action) => action.key === "return_approval" && action.enabled
  );
  if (!operationAllowed) throw new Error("服务端已撤销资金执行审批退回权限");
  return reviewFundExecutionCase(caseRef, {
    action: "return_to_applicant",
    comment
  });
}

function requestAction(action: PendingAction, row: FundExecutionCaseListItem) {
  if (!actionEnabled(row, action)) return;
  pendingAction.value = action;
  pendingActionCase.value = row;
  pendingApprovalComment.value = approvalComment.value.trim();
  actionError.value = "";
  actionDialogVisible.value = true;
}

async function executePendingAction(values: { reason: string; password: string }) {
  const action = pendingAction.value;
  const row = pendingActionCase.value;
  if (!action || !row || submitting.value) return;
  if (!actionEnabled(row, action)) return;
  submitting.value = true;
  actionError.value = "";
  try {
    if (action === "submit_case") {
      const command = `submit-case:${row.caseRef}`;
      const payload = { expectedRevision: row.revision };
      await submitFundExecutionCaseWithCapability(row.caseRef, {
        ...payload,
        idempotencyKey: idempotencyLease.acquire(command, payload)
      });
      idempotencyLease.complete(command, payload);
    }
    if (action === "return_case") {
      const command = `return-case:${row.caseRef}`;
      const payload = {
        expectedRevision: row.revision,
        reason: values.reason
      };
      await returnFundExecutionCaseWithCapability(row.caseRef, {
        ...payload,
        idempotencyKey: idempotencyLease.acquire(command, payload)
      });
      idempotencyLease.complete(command, payload);
    }
    if (action === "confirm_case") {
      const command = `confirm-case:${row.caseRef}`;
      const payload = { expectedRevision: row.revision };
      await confirmFundExecutionCaseWithCapability(row.caseRef, {
        ...payload,
        idempotencyKey: idempotencyLease.acquire(command, payload)
      });
      idempotencyLease.complete(command, payload);
    }
    if (action === "approve") {
      await approveFundExecutionCaseWithCapability(
        row.caseRef,
        pendingApprovalComment.value
      );
    }
    if (action === "return_approval") {
      await returnFundExecutionApprovalWithCapability(row.caseRef, values.reason);
    }
    actionDialogVisible.value = false;
    pendingAction.value = null;
    pendingActionCase.value = null;
    pendingApprovalComment.value = "";
    MessagePlugin.success("资金执行案件状态已更新");
    closeCaseDrawer();
    await loadWorkbench();
  } catch (error) {
    actionError.value = formatUnknownApiError(error, "办理资金执行案件失败");
  } finally {
    submitting.value = false;
  }
}

function amountText(amountCents: string) {
  try {
    return `¥${centsTextToYuanText(amountCents)}`;
  } catch {
    return "金额待核对";
  }
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间待核对"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

function statusTone(row: FundExecutionCaseListItem) {
  if (row.status === "confirmed") return "success" as const;
  if (row.status === "submitted") return "warning" as const;
  return "default" as const;
}
</script>

<template>
  <JgWorkbenchShell
    class="fund-execution-workbench"
    title="资金执行案件"
    description="银行流水先形成不可变资金执行事实和待办案件；正式归类只选择服务端签发的中文业务方案。"
  >
    <template #actions>
      <t-button
        variant="outline"
        :loading="loading"
        @click="loadWorkbench"
      >
        刷新候选与案件
      </t-button>
    </template>

    <template #summary>
      <div class="fund-execution-workbench__summary">
        <t-card :bordered="true">
          全部 {{ caseSummary.total }} 件
        </t-card>
        <t-card :bordered="true">
          可修改草稿 {{ caseSummary.draft }} 件
        </t-card>
        <t-card :bordered="true">
          审批中 {{ caseSummary.submitted }} 件
        </t-card>
        <t-card :bordered="true">
          已确认 {{ caseSummary.confirmed }} 件
        </t-card>
      </div>
    </template>

    <t-alert
      v-if="errorMessage"
      theme="error"
      title="暂时无法办理"
      :message="errorMessage"
    />

    <t-card
      class="fund-execution-workbench__create"
      title="新建资金执行案件"
      :bordered="true"
    >
      <t-form label-align="top">
        <div class="fund-execution-workbench__form-grid">
          <t-form-item label="办理类型">
            <t-radio-group
              v-model="createForm.mode"
              @change="changeCreateMode"
            >
              <t-radio-button
                v-for="option in createModeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </t-radio-button>
            </t-radio-group>
          </t-form-item>
          <t-form-item
            v-if="createForm.mode === 'reversal'"
            label="原业务事项"
          >
            <t-select
              v-model="createForm.targetSelectionRef"
              :options="reversalSelectOptions"
              :loading="loading"
              filterable
              placeholder="选择服务端返回的可反向业务摘要"
            />
          </t-form-item>
          <t-form-item label="银行流水候选">
            <t-select
              v-model="createForm.observationSelectionRef"
              :options="observationSelectOptions"
              :loading="loading"
              filterable
              placeholder="选择已核验且尚未认领的银行流水"
            />
          </t-form-item>
          <t-form-item
            class="fund-execution-workbench__reason"
            label="办理原因"
          >
            <t-textarea
              v-model="createForm.reason"
              :maxlength="500"
              :autosize="{ minRows: 2, maxRows: 4 }"
              placeholder="说明暂存待分类或反向执行的真实业务原因"
            />
          </t-form-item>
        </div>
        <t-alert
          v-if="createForm.mode === 'reversal'"
          theme="info"
          title="反向执行沿用原分类"
          message="反向执行只选择原业务事项和相反方向的银行流水，不提供重新分类入口。"
        />
        <t-button
          theme="primary"
          :loading="submitting"
          @click="submitCreate"
        >
          {{ createForm.mode === "reversal" ? "创建反向执行案件" : "创建待分类案件" }}
        </t-button>
      </t-form>
    </t-card>

    <JgResultState
      :loading="loading"
      :has-results="cases.length > 0"
      :error="''"
      empty-title="暂无资金执行案件"
      empty-description="请从已核验且尚未认领的银行流水候选创建案件。"
      @retry="loadWorkbench"
    >
      <t-card
        class="jg-table-region jg-table-region--wide"
        :bordered="true"
      >
        <t-table
          row-key="caseRef"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="cases"
          :loading="loading"
          :scroll="{ x: 1460 }"
          horizontal-scroll-affixed-bottom
        >
          <template #caseLabel="{ row }">
            <t-link
              theme="primary"
              @click="openCase(row)"
            >
              {{ row.caseLabel }}
            </t-link>
          </template>
          <template #observationSummary="{ row }">
            <div class="fund-execution-workbench__observation">
              <span>{{ row.observationSummary }}</span>
              <small>{{ row.directionLabel }} · {{ amountText(row.amountCents) }} · {{ dateTime(row.occurredAt) }}</small>
            </div>
          </template>
          <template #classificationSummary="{ row }">
            {{ row.executionKind === "reversal" ? "沿用原执行的逐轴分类" : row.classificationSummary ?? "待选择正式分类方案" }}
          </template>
          <template #status="{ row }">
            <JgStatusTag
              :label="row.statusLabel"
              :tone="statusTone(row)"
            />
          </template>
          <template #updatedAt="{ row }">
            {{ dateTime(row.updatedAt) }}
          </template>
          <template #actions="{ row }">
            <t-link
              theme="primary"
              @click="openCase(row)"
            >
              查看办理
            </t-link>
          </template>
        </t-table>
      </t-card>
    </JgResultState>

    <t-drawer
      v-model:visible="caseDrawerVisible"
      header="资金执行案件办理"
      size="large"
      :footer="false"
      :close-on-overlay-click="!submitting"
      @close="closeCaseDrawer"
    >
      <div
        v-if="selectedCase"
        class="fund-execution-workbench__drawer"
      >
        <t-card :bordered="true">
          <dl class="fund-execution-workbench__meta">
            <div><dt>业务案件</dt><dd>{{ selectedCase.caseLabel }}</dd></div>
            <div><dt>案件状态</dt><dd>{{ selectedCase.statusLabel }}</dd></div>
            <div><dt>银行流水</dt><dd>{{ selectedCase.observationSummary }}</dd></div>
            <div><dt>审批状态</dt><dd>{{ selectedCase.approvalStatusLabel ?? "尚未进入审批" }}</dd></div>
          </dl>
        </t-card>

        <t-alert
          v-if="selectedCase.executionKind === 'reversal'"
          theme="info"
          title="反向执行沿用原分类"
          message="逐轴业务身份和原始后果由系统精确复制，本案件不接受新的分类选择。"
        />

        <t-card
          v-if="selectedCaseCanEditReversalReason"
          title="修改反向执行原因"
          :bordered="true"
        >
          <t-form label-align="top">
            <t-form-item label="办理原因">
              <t-textarea
                v-model="draftReason"
                :maxlength="500"
                :autosize="{ minRows: 2, maxRows: 4 }"
                placeholder="补充或修改反向执行的业务原因"
              />
            </t-form-item>
            <t-button
              theme="primary"
              :loading="submitting"
              @click="saveReversalReason"
            >
              保存反向执行原因
            </t-button>
          </t-form>
        </t-card>

        <t-card
          v-if="caseAllowsClassification(selectedCase)"
          title="选择完整逐轴分类方案"
          :bordered="true"
        >
          <t-alert
            theme="info"
            title="只提交短效选择凭据"
            message="每套方案都由服务端按每条资金的应付、项目资金、主体往来和经营四轴完整签发。"
          />
          <t-loading :loading="optionLoading">
            <t-radio-group
              v-model="selectedPlanIndex"
              class="fund-execution-workbench__plans"
            >
              <t-radio
                v-for="(plan, planIndex) in classificationPlans"
                :key="`${planIndex}-${plan.expiresAt}`"
                :value="String(planIndex)"
                :disabled="selectionIsExpired(plan.expiresAt)"
              >
                <div class="fund-execution-workbench__plan">
                  <strong>{{ plan.summary }}</strong>
                  <div
                    v-for="line in plan.lines"
                    :key="line.lineNo"
                    class="fund-execution-workbench__line"
                  >
                    <div>
                      <span>{{ line.summary }}</span>
                      <strong>{{ amountText(line.amountCents) }}</strong>
                    </div>
                    <ul>
                      <li
                        v-for="option in line.axes"
                        :key="option.axis"
                      >
                        <t-tag
                          size="small"
                          variant="light"
                        >
                          {{ FUND_EXECUTION_AXIS_LABELS[option.axis] }}
                        </t-tag>
                        <span>{{ option.summary }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </t-radio>
            </t-radio-group>
          </t-loading>
          <t-form label-align="top">
            <t-form-item label="办理原因">
              <t-textarea
                v-model="draftReason"
                :maxlength="500"
                :autosize="{ minRows: 2, maxRows: 4 }"
              />
            </t-form-item>
            <t-button
              theme="primary"
              :disabled="!selectedPlan"
              :loading="submitting"
              @click="saveClassification"
            >
              保存逐轴分类修改稿
            </t-button>
          </t-form>
        </t-card>

        <t-card
          title="案件办理"
          :bordered="true"
        >
          <t-form-item
            v-if="actionEnabled(selectedCase, 'approve')"
            label="审批意见（选填）"
          >
            <t-textarea
              v-model="approvalComment"
              :maxlength="500"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </t-form-item>
          <t-space break-line>
            <t-button
              v-if="actionEnabled(selectedCase, 'submit_case')"
              theme="primary"
              @click="requestAction('submit_case', selectedCase)"
            >
              提交审批
            </t-button>
            <t-button
              v-if="actionEnabled(selectedCase, 'approve')"
              theme="primary"
              @click="requestAction('approve', selectedCase)"
            >
              审批通过
            </t-button>
            <t-button
              v-if="actionEnabled(selectedCase, 'return_approval')"
              theme="danger"
              variant="outline"
              @click="requestAction('return_approval', selectedCase)"
            >
              退回申请人
            </t-button>
            <t-button
              v-if="actionEnabled(selectedCase, 'return_case')"
              theme="danger"
              variant="outline"
              @click="requestAction('return_case', selectedCase)"
            >
              生成退回修改稿
            </t-button>
            <t-button
              v-if="actionEnabled(selectedCase, 'confirm_case')"
              theme="primary"
              @click="requestAction('confirm_case', selectedCase)"
            >
              确认进入正式账
            </t-button>
          </t-space>
        </t-card>
      </div>
    </t-drawer>

    <SensitiveActionDialog
      v-model="actionDialogVisible"
      :title="pendingActionConfig.title"
      :description="pendingActionConfig.description"
      :confirm-text="pendingActionConfig.confirmText"
      :confirm-theme="pendingActionConfig.confirmTheme"
      :require-reason="pendingActionConfig.requireReason"
      reason-label="退回原因"
      :loading="submitting"
      :error="actionError"
      @confirm="executePendingAction"
      @cancel="actionError = ''"
    />
  </JgWorkbenchShell>
</template>

<style scoped>
.fund-execution-workbench,
.fund-execution-workbench__drawer,
.fund-execution-workbench__observation,
.fund-execution-workbench__plans,
.fund-execution-workbench__plan,
.fund-execution-workbench__line,
.fund-execution-workbench__line ul {
  display: grid;
  gap: var(--jg-space-md);
  min-width: 0;
}

.fund-execution-workbench__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-summary-metric-min-width), 1fr));
  gap: var(--jg-space-md);
}

.fund-execution-workbench__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(var(--jg-layout-form-field-min-width-wide), 1fr));
  gap: var(--jg-space-md) var(--jg-space-lg);
}

.fund-execution-workbench__reason {
  grid-column: 1 / -1;
}

.fund-execution-workbench__create :deep(.t-form),
.fund-execution-workbench__drawer :deep(.t-card__body) {
  display: grid;
  gap: var(--jg-space-lg);
}

.fund-execution-workbench__observation {
  gap: var(--jg-space-xs);
}

.fund-execution-workbench__observation small,
.fund-execution-workbench__line span {
  color: var(--jg-color-text-tertiary);
}

.fund-execution-workbench__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-lg);
  margin: 0;
}

.fund-execution-workbench__meta div {
  display: grid;
  gap: var(--jg-space-xs);
}

.fund-execution-workbench__meta dt {
  color: var(--jg-color-text-tertiary);
}

.fund-execution-workbench__meta dd {
  margin: 0;
  color: var(--jg-color-text-primary);
}

.fund-execution-workbench__plans {
  align-items: stretch;
}

.fund-execution-workbench__plans :deep(.t-radio) {
  align-items: flex-start;
  margin-right: 0;
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
}

.fund-execution-workbench__plan {
  width: 100%;
}

.fund-execution-workbench__line {
  padding-top: var(--jg-space-md);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.fund-execution-workbench__line > div,
.fund-execution-workbench__line li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.fund-execution-workbench__line ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 720px) {
  .fund-execution-workbench__form-grid,
  .fund-execution-workbench__meta {
    grid-template-columns: minmax(0, 1fr);
  }

  .fund-execution-workbench__line > div,
  .fund-execution-workbench__line li {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
