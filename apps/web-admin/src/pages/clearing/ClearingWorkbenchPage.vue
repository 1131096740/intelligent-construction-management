<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { formatUnknownApiError } from "../../api/error-message";
import {
  attestClearingEvent,
  confirmClearingEvent,
  createClearingCase,
  createClearingEvent,
  fetchClearingCapabilities,
  fetchClearingCase,
  fetchClearingCases,
  reviseClearingEvent,
  reopenClearingEvent,
  returnClearingEvent,
  submitClearingEvent,
  type ClearingCapabilities,
  type ClearingCaseReadModel,
  type ClearingEventReadModel
} from "../../api/clearing.api";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import { fetchProjectOperatingProfile } from "../../api/project-operating-profile.api";
import {
  clearingEventActions,
  clearingKindLabel,
  clearingKindOptions,
  clearingTimeline
} from "./clearing-workbench.state";

const emptyCapabilities: ClearingCapabilities = {
  availableActions: [],
  read: false,
  prepare: false,
  submit: false,
  attest: false,
  confirm: false,
  return: false,
  reopen: false
};

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref("");
const projects = ref<ProjectOptionReadModel[]>([]);
const selectedProjectId = ref("");
const capabilities = ref<ClearingCapabilities>({ ...emptyCapabilities });
const cases = ref<ClearingCaseReadModel[]>([]);
const detail = ref<ClearingCaseReadModel | null>(null);
const caseDialogVisible = ref(false);
const eventDialogVisible = ref(false);
const actionDialogVisible = ref(false);
const pendingAction = ref<"submit" | "attest" | "confirm" | "return" | "reopen" | null>(null);
const selectedEvent = ref<ClearingEventReadModel | null>(null);
const editingEvent = ref<ClearingEventReadModel | null>(null);

const caseForm = reactive({
  projectId: "",
  governedSubjectKey: "",
  category: "management_fee",
  authoritativeGrossCapCents: ""
});
const eventForm = reactive({
  kind: "estimated",
  amountCents: "",
  evidenceLevel: "A",
  payableRef: "",
  payloadText: "{}"
});
const confirmationForm = reactive({
  sourceKind: "authority_cap",
  sourceEventVersionId: "",
  amountCents: "",
  pairedWithheldAmountCents: ""
});

const projectOptions = computed(() =>
  projects.value.map((project) => ({
    value: project.id,
    label: `${project.code} · ${project.name}`
  }))
);
const categoryOptions = [
  { value: "management_fee", label: "管理费" },
  { value: "final_tax", label: "最终税费" },
  { value: "deposit", label: "保证金" },
  { value: "insurance_fee", label: "保险费" },
  { value: "service_fee", label: "服务费" },
  { value: "assigned_management_salary", label: "委派管理人员工资" },
  { value: "other_controlled_deduction", label: "其他受控扣项" }
];
const sourceKindOptions = [
  { value: "authority_cap", label: "权威毛额上限" },
  { value: "withheld", label: "已确认暂扣" },
  { value: "final_confirmed", label: "已确认最终扣项" },
  { value: "supplemental", label: "已确认补扣" }
];
const timeline = computed(() => detail.value ? clearingTimeline(detail.value) : []);
const actionTitle = computed(() => ({
  submit: "提交清分事件",
  attest: "实名核验 B 级证据",
  confirm: "确认清分事件",
  return: "退回清分事件",
  reopen: "重开清分事件"
}[pendingAction.value ?? "submit"]));
const actionDescription = computed(() => {
  if (pendingAction.value === "confirm") {
    return "确认将以当前确认内容、显式分配和最新服务端权限生成正式清分与经营账投影。";
  }
  if (pendingAction.value === "attest") return "实名核验只追加当前 B 级证据的核验记录；正式确认仍必须由另一自然人财务负责人完成。";
  if (pendingAction.value === "submit") return "提交后生成新的不可变已提交版本，后续修改必须追加版本。";
  if (pendingAction.value === "return") return "退回只改变工作流状态，不覆盖已提交版本。";
  return "重开只允许在已退回状态下继续追加草稿版本。";
});
const requiresAllocation = computed(() =>
  selectedEvent.value
    ? ["final_confirmed", "supplemental", "returned"].includes(selectedEvent.value.kind)
    : false
);

const caseColumns = [
  { colKey: "governedSubjectKey", title: "受控事项", minWidth: 180 },
  { colKey: "category", title: "分类", width: 140 },
  { colKey: "authoritativeGrossCapCents", title: "权威毛额（分）", width: 150 },
  { colKey: "revision", title: "修订", width: 80 },
  { colKey: "status", title: "状态", width: 100 }
];
const eventColumns = [
  { colKey: "kind", title: "经济类型", width: 140 },
  { colKey: "workflowStatus", title: "流程状态", width: 120 },
  { colKey: "amount", title: "当前金额（分）", width: 150 },
  { colKey: "revision", title: "修订", width: 80 },
  { colKey: "actions", title: "操作", minWidth: 260 }
];
const timelineColumns = [
  { colKey: "kindLabel", title: "类型", width: 130 },
  { colKey: "versionNo", title: "版本", width: 80 },
  { colKey: "workflowStatus", title: "版本状态", width: 110 },
  { colKey: "amountCents", title: "金额（分）", width: 140 },
  { colKey: "createdAt", title: "创建时间", minWidth: 180 },
  { colKey: "confirmedAt", title: "确认时间", minWidth: 180 }
];

onMounted(loadInitial);

async function loadInitial() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [capability, projectRows] = await Promise.all([
      fetchClearingCapabilities(),
      fetchProjects()
    ]);
    capabilities.value = capability;
    projects.value = projectRows;
    if (!selectedProjectId.value && projectRows[0]) selectedProjectId.value = projectRows[0].id;
    await loadCases();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载清分工作台失败");
  } finally {
    loading.value = false;
  }
}

async function loadCases() {
  cases.value = await fetchClearingCases(selectedProjectId.value || undefined);
  if (detail.value) {
    const stillVisible = cases.value.some((row) => row.id === detail.value?.id);
    if (stillVisible) detail.value = await fetchClearingCase(detail.value.id);
    else detail.value = null;
  }
}

async function changeProject() {
  detail.value = null;
  loading.value = true;
  try {
    await loadCases();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载清分事项失败");
  } finally {
    loading.value = false;
  }
}

async function openCase(row: ClearingCaseReadModel) {
  loading.value = true;
  try {
    detail.value = await fetchClearingCase(row.id);
  } finally {
    loading.value = false;
  }
}

function openCaseCreate() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  caseForm.projectId = selectedProjectId.value || projects.value[0]?.id || "";
  caseForm.governedSubjectKey = "";
  caseForm.category = "management_fee";
  caseForm.authoritativeGrossCapCents = "";
  caseDialogVisible.value = true;
}

async function saveCase() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  submitting.value = true;
  try {
    const profile = await fetchProjectOperatingProfile(caseForm.projectId);
    if (!profile.constructionEnterprise?.assignmentId) {
      throw new Error("项目尚未设置有效施工企业档案");
    }
    await createClearingCaseWithCapability({
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: 0,
      projectId: caseForm.projectId,
      constructionEnterpriseAssignmentId: profile.constructionEnterprise.assignmentId,
      category: caseForm.category,
      governedSubjectKey: caseForm.governedSubjectKey.trim(),
      authoritativeGrossCapCents: caseForm.authoritativeGrossCapCents
    });
    caseDialogVisible.value = false;
    selectedProjectId.value = caseForm.projectId;
    await loadCases();
    await MessagePlugin.success("清分事项已创建");
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "创建清分事项失败");
  } finally {
    submitting.value = false;
  }
}

function openEventCreate() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  editingEvent.value = null;
  eventForm.kind = "estimated";
  eventForm.amountCents = "";
  eventForm.evidenceLevel = "A";
  eventForm.payableRef = "";
  eventForm.payloadText = "{}";
  eventDialogVisible.value = true;
}

function openEventRevision(event: ClearingEventReadModel) {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  const current = event.versions.find((version) => version.versionNo === event.currentVersionNo);
  if (!current || event.workflowStatus !== "draft") return;
  editingEvent.value = event;
  eventForm.kind = event.kind;
  eventForm.amountCents = current.amountCents;
  eventForm.evidenceLevel = current.evidenceLevel;
  eventForm.payableRef = current.payableRef ?? "";
  eventForm.payloadText = JSON.stringify(current.payloadSnapshot, null, 2);
  eventDialogVisible.value = true;
}

async function saveEvent() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  if (!detail.value) return;
  submitting.value = true;
  try {
    const payload = JSON.parse(eventForm.payloadText) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("业务快照必须是 JSON 对象");
    }
    const body = {
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: editingEvent.value?.revision ?? detail.value.revision,
      kind: eventForm.kind,
      amountCents: eventForm.amountCents,
      evidenceLevel: eventForm.evidenceLevel,
      payableRef: eventForm.payableRef.trim() || undefined,
      payload
    };
    const isRevision = Boolean(editingEvent.value);
    if (editingEvent.value) await reviseClearingEventWithCapability(editingEvent.value.id, body);
    else await createClearingEventWithCapability(detail.value.id, body);
    eventDialogVisible.value = false;
    editingEvent.value = null;
    await refreshDetail();
    await MessagePlugin.success(isRevision ? "清分草稿已修订" : "清分草稿已创建");
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "创建清分草稿失败");
  } finally {
    submitting.value = false;
  }
}

function requestAction(action: "submit" | "attest" | "confirm" | "return" | "reopen", event: ClearingEventReadModel) {
  pendingAction.value = action;
  selectedEvent.value = event;
  const current = event.versions.find((version) => version.versionNo === event.currentVersionNo);
  confirmationForm.sourceKind = event.kind === "returned" ? "final_confirmed" : "authority_cap";
  confirmationForm.sourceEventVersionId = "";
  confirmationForm.amountCents = current?.amountCents ?? "";
  confirmationForm.pairedWithheldAmountCents = event.kind === "pending_reconciliation" ? current?.amountCents ?? "" : "";
  actionDialogVisible.value = true;
}

async function executeAction(values: { reason: string }) {
  const event = selectedEvent.value;
  const action = pendingAction.value;
  if (!event || !action) return;
  submitting.value = true;
  try {
    const base = {
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: event.revision
    };
    if (action === "submit") {
      if (!capabilities.value.availableActions.includes("clearing.submit")) return;
      await submitClearingEventWithCapability(event.id, base);
    }
    if (action === "attest") {
      if (!capabilities.value.availableActions.includes("clearing.attest")) return;
      await attestClearingEventWithCapability(event.id, base);
    }
    if (action === "return") {
      if (!capabilities.value.availableActions.includes("clearing.return")) return;
      await returnClearingEventWithCapability(event.id, { ...base, reason: values.reason });
    }
    if (action === "reopen") {
      if (!capabilities.value.availableActions.includes("clearing.reopen")) return;
      await reopenClearingEventWithCapability(event.id, { ...base, reason: values.reason });
    }
    if (action === "confirm") {
      if (!capabilities.value.availableActions.includes("clearing.confirm")) return;
      const allocations = requiresAllocation.value
        ? [{
            sourceKind: confirmationForm.sourceKind,
            sourceEventVersionId: confirmationForm.sourceKind === "authority_cap"
              ? undefined
              : confirmationForm.sourceEventVersionId.trim(),
            amountCents: confirmationForm.amountCents
          }]
        : [];
      await confirmClearingEventWithCapability(event.id, {
        ...base,
        allocations,
        pairedWithheldAmountCents: event.kind === "pending_reconciliation"
          ? confirmationForm.pairedWithheldAmountCents
          : undefined
      });
    }
    actionDialogVisible.value = false;
    await refreshDetail();
    await MessagePlugin.success("清分状态已更新");
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "清分操作失败");
  } finally {
    submitting.value = false;
  }
}

async function refreshDetail() {
  if (!detail.value) return;
  detail.value = await fetchClearingCase(detail.value.id);
  await loadCases();
}

async function createClearingCaseWithCapability(body: Parameters<typeof createClearingCase>[0]) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.prepare");
  if (!operationAllowed) throw new Error("当前用户不可创建清分事项");
  return createClearingCase(body);
}

async function createClearingEventWithCapability(
  caseId: string,
  body: Parameters<typeof createClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.prepare");
  if (!operationAllowed) throw new Error("当前用户不可创建清分事件");
  return createClearingEvent(caseId, body);
}

async function reviseClearingEventWithCapability(
  eventId: string,
  body: Parameters<typeof reviseClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.prepare");
  if (!operationAllowed) throw new Error("当前用户不可修订清分事件");
  return reviseClearingEvent(eventId, body);
}

async function submitClearingEventWithCapability(
  eventId: string,
  body: Parameters<typeof submitClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.submit");
  if (!operationAllowed) throw new Error("当前用户不可提交清分事件");
  return submitClearingEvent(eventId, body);
}

async function confirmClearingEventWithCapability(
  eventId: string,
  body: Parameters<typeof confirmClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.confirm");
  if (!operationAllowed) throw new Error("当前用户不可确认清分事件");
  return confirmClearingEvent(eventId, body);
}

async function attestClearingEventWithCapability(
  eventId: string,
  body: Parameters<typeof attestClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.attest");
  if (!operationAllowed) throw new Error("当前用户不可实名核验 B 级清分证据");
  return attestClearingEvent(eventId, body);
}

async function returnClearingEventWithCapability(
  eventId: string,
  body: Parameters<typeof returnClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.return");
  if (!operationAllowed) throw new Error("当前用户不可退回清分事件");
  return returnClearingEvent(eventId, body);
}

async function reopenClearingEventWithCapability(
  eventId: string,
  body: Parameters<typeof reopenClearingEvent>[1]
) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.reopen");
  if (!operationAllowed) throw new Error("当前用户不可重开清分事件");
  return reopenClearingEvent(eventId, body);
}

function currentAmount(event: ClearingEventReadModel) {
  return event.versions.find((version) => version.versionNo === event.currentVersionNo)?.amountCents ?? "—";
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}
</script>

<template>
  <section class="clearing-workbench jg-responsive-detail">
    <header class="page-head">
      <div>
        <span class="page-eyebrow">项目经营 · POL-11A</span>
        <h1>清分工作台</h1>
        <p>稳定事项与事件标识，版本只追加；正式确认只消费显式分配并投影到经营账。</p>
      </div>
      <t-space>
        <t-button :loading="loading" variant="outline" @click="loadInitial">刷新</t-button>
        <t-button v-if="capabilities.prepare" theme="primary" @click="openCaseCreate">新建清分事项</t-button>
      </t-space>
    </header>

    <t-alert v-if="errorMessage" theme="error" :close="false" :message="errorMessage" />

    <t-card class="panel" title="项目与清分事项">
      <div class="filters">
        <t-select
          v-model="selectedProjectId"
          :options="projectOptions"
          placeholder="选择项目"
          @change="changeProject"
        />
      </div>
      <t-table
        row-key="id"
        :columns="caseColumns"
        :data="cases"
        :loading="loading"
        empty="暂无清分事项"
        @row-click="openCase"
      />
    </t-card>

    <t-card v-if="detail" class="panel" :title="`事项：${detail.governedSubjectKey}`">
      <template #actions>
        <t-button v-if="capabilities.prepare" theme="primary" @click="openEventCreate">新增事件草稿</t-button>
      </template>
      <t-descriptions bordered :column="2">
        <t-descriptions-item label="项目">{{ detail.projectId }}</t-descriptions-item>
        <t-descriptions-item label="施工企业档案">{{ detail.constructionEnterpriseAssignmentId }}</t-descriptions-item>
        <t-descriptions-item label="权威毛额（分）">{{ detail.authoritativeGrossCapCents }}</t-descriptions-item>
        <t-descriptions-item label="事项修订">{{ detail.revision }}</t-descriptions-item>
      </t-descriptions>
      <t-table row-key="id" :columns="eventColumns" :data="detail.events" empty="暂无清分事件">
        <template #kind="{ row }">{{ clearingKindLabel(row.kind) }}</template>
        <template #amount="{ row }">{{ currentAmount(row) }}</template>
        <template #actions="{ row }">
          <t-space break-line>
            <t-link v-if="row.workflowStatus === 'draft' && capabilities.prepare" @click="openEventRevision(row)">修订</t-link>
            <t-link v-if="clearingEventActions(row, capabilities).submit" @click="requestAction('submit', row)">提交</t-link>
            <t-link v-if="clearingEventActions(row, capabilities).attest" @click="requestAction('attest', row)">实名核验</t-link>
            <t-link v-if="clearingEventActions(row, capabilities).confirm" theme="primary" @click="requestAction('confirm', row)">确认</t-link>
            <t-link v-if="clearingEventActions(row, capabilities).return" theme="warning" @click="requestAction('return', row)">退回</t-link>
            <t-link v-if="clearingEventActions(row, capabilities).reopen" @click="requestAction('reopen', row)">重开</t-link>
          </t-space>
        </template>
      </t-table>
    </t-card>

    <t-card v-if="detail" class="panel" title="不可变版本时间线">
      <t-table row-key="key" :columns="timelineColumns" :data="timeline" empty="暂无版本记录">
        <template #createdAt="{ row }">{{ formatDate(row.createdAt) }}</template>
        <template #confirmedAt="{ row }">{{ formatDate(row.confirmedAt) }}</template>
      </t-table>
    </t-card>

    <t-dialog v-model:visible="caseDialogVisible" header="新建清分事项" :confirm-btn="{ loading: submitting }" @confirm="saveCase">
      <t-form label-align="top">
        <t-form-item label="项目"><t-select v-model="caseForm.projectId" :options="projectOptions" /></t-form-item>
        <t-form-item label="分类"><t-select v-model="caseForm.category" :options="categoryOptions" /></t-form-item>
        <t-form-item label="受控事项键"><t-input v-model="caseForm.governedSubjectKey" /></t-form-item>
        <t-form-item label="权威毛额（整数分）"><t-input v-model="caseForm.authoritativeGrossCapCents" /></t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="eventDialogVisible" :header="editingEvent ? '修订清分事件草稿' : '新增清分事件草稿'" :confirm-btn="{ loading: submitting }" @confirm="saveEvent">
      <t-form label-align="top">
        <t-form-item label="事件类型"><t-select v-model="eventForm.kind" :options="clearingKindOptions" /></t-form-item>
        <t-form-item label="金额（整数分）"><t-input v-model="eventForm.amountCents" /></t-form-item>
        <t-form-item label="证据等级"><t-select v-model="eventForm.evidenceLevel" :options="[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }]" /></t-form-item>
        <t-form-item label="应付引用（可选，仅引用不自动建应付）"><t-input v-model="eventForm.payableRef" /></t-form-item>
        <t-form-item label="冻结业务快照 JSON"><t-textarea v-model="eventForm.payloadText" :autosize="{ minRows: 4, maxRows: 8 }" /></t-form-item>
      </t-form>
    </t-dialog>

    <SensitiveActionDialog
      v-model="actionDialogVisible"
      :title="actionTitle"
      :description="actionDescription"
      :loading="submitting"
      :require-reason="pendingAction === 'return' || pendingAction === 'reopen'"
      @confirm="executeAction"
    >
      <div v-if="pendingAction === 'confirm'" class="confirmation-fields">
        <template v-if="requiresAllocation">
          <label>
            <span>分配来源</span>
            <t-select v-model="confirmationForm.sourceKind" :options="sourceKindOptions" />
          </label>
          <label v-if="confirmationForm.sourceKind !== 'authority_cap'">
            <span>来源事件版本 ID</span>
            <t-input v-model="confirmationForm.sourceEventVersionId" />
          </label>
          <label>
            <span>本次分配金额（分）</span>
            <t-input v-model="confirmationForm.amountCents" />
          </label>
        </template>
        <label v-if="selectedEvent?.kind === 'pending_reconciliation'">
          <span>无暂扣余额时同事务配对暂扣金额（分）</span>
          <t-input v-model="confirmationForm.pairedWithheldAmountCents" />
        </label>
      </div>
    </SensitiveActionDialog>
  </section>
</template>

<style scoped>
.clearing-workbench,
.confirmation-fields,
.confirmation-fields label {
  display: grid;
  gap: var(--jg-space-md);
}

.clearing-workbench {
  gap: var(--jg-space-xl);
}

.page-head,
.filters {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-lg);
}

.page-head h1,
.page-head p {
  margin: 0;
}

.page-eyebrow,
.confirmation-fields span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
}

.filters {
  margin-bottom: var(--jg-space-md);
  max-width: 420px;
}

.panel {
  min-width: 0;
}

@media (max-width: 768px) {
  .page-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
