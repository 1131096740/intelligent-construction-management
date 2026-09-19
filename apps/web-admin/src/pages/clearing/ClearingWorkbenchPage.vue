<script setup lang="ts">
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import BusinessEntryForm from "../../components/BusinessEntryForm.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { formatUnknownApiError } from "../../api/error-message";
import {
  attestClearingEvent,
  confirmClearingEvent,
  createClearingCase,
  createClearingEvent,
  fetchAffiliateClearingAuthorityOptions,
  fetchClearingCapabilities,
  fetchClearingAllocationOptions,
  fetchClearingCase,
  fetchClearingCases,
  reviseClearingEvent,
  reopenClearingEvent,
  returnClearingEvent,
  submitClearingEvent,
  type ClearingCapabilities,
  type ClearingCaseReadModel,
  type ClearingEventReadModel,
  type ClearingAllocationOption
} from "../../api/clearing.api";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import { fetchProjectOperatingProfile } from "../../api/project-operating-profile.api";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import {
  CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION,
  CLEARING_CASE_ENTRY_DEFINITION,
  CLEARING_CONFIRMATION_ENTRY_DEFINITION,
  CLEARING_EVENT_ENTRY_DEFINITION
} from "./clearing-entry-definitions";
import {
  clearingEventActions,
  clearingKindLabel,
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
const authorityOptions = ref<import("../../api/clearing.api").AffiliateClearingAuthorityOption[]>([]);
const allocationOptions = ref<ClearingAllocationOption[]>([]);
const detail = ref<ClearingCaseReadModel | null>(null);
const caseDialogVisible = ref(false);
const eventDialogVisible = ref(false);
const actionDialogVisible = ref(false);
const pendingAction = ref<"submit" | "attest" | "confirm" | "return" | "reopen" | null>(null);
const selectedEvent = ref<ClearingEventReadModel | null>(null);
const editingEvent = ref<ClearingEventReadModel | null>(null);

const caseForm = reactive({
  projectId: "",
  category: "management_fee",
  authoritySelectionRef: "",
  guaranteeTrancheYuan: "",
  governedSubjectKey: "",
  authoritativeGrossCapYuan: ""
});
const eventForm = reactive({
  kind: "estimated",
  amountYuan: "",
  evidenceLevel: "A",
  businessReason: "",
  evidenceRef: ""
});
const editingPayableRef = ref("");
const editingPayloadSnapshot = ref<Record<string, unknown>>({});
const confirmationForm = reactive({
  sourceKind: "authority_cap",
  sourceEventVersionId: "",
  sourceSelectionRef: "",
  amountYuan: "",
  pairedWithheldAmountYuan: ""
});

const projectOptions = computed(() =>
  projects.value.map((project) => ({
    value: project.id,
    label: `${project.code} · ${project.name}`
  }))
);
const authorityCategoryValues = new Set(["deposit", "assigned_management_salary"]);
const authorityCaseOptions = computed(() => authorityOptions.value.filter((option) =>
  caseForm.category === "deposit" ? option.optionKind === "guarantee" : option.optionKind === "assigned_wage"
));
const isAuthorityCase = computed(() => Boolean(detail.value?.sourceDiscriminator));
const sourceKindOptions = [
  { value: "authority_cap", label: "权威毛额上限" },
  { value: "withheld", label: "已确认暂扣" },
  { value: "final_confirmed", label: "已确认最终扣项" },
  { value: "supplemental", label: "已确认补扣" }
];
const visibleSourceKindOptions = computed(() =>
  isAuthorityCase.value
    ? [
        sourceKindOptions[0],
        ...Array.from(new Set(allocationOptions.value.map((option) => option.sourceKind))).map((kind) => ({
          value: kind,
          label: kind === "withheld" ? "已确认暂扣" : kind === "final_confirmed" ? "已确认最终扣项" : "已确认补扣"
        }))
      ]
    : sourceKindOptions
);
const visibleAllocationOptions = computed(() => allocationOptions.value.filter((option) => option.sourceKind === confirmationForm.sourceKind));
const sourceEventVersionOptions = computed(() =>
  (detail.value?.events ?? []).flatMap((event) =>
    event.kind === confirmationForm.sourceKind
      ? event.versions
        .filter((version) => Boolean(version.confirmation) && version.id !== selectedEvent.value?.id)
        .map((version) => ({
          value: version.id,
          label: `${clearingKindLabel(event.kind)} · 第 ${version.versionNo} 版 · ¥${centsTextToYuanText(version.amountCents)}`
        }))
      : []
  )
);
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
const caseEntryOptions = computed(() => ({
  projectId: projectOptions.value,
  authoritySelectionRef: authorityCaseOptions.value.map((option) => ({
    value: option.selectionRef,
    label: authorityOptionLabel(option)
  }))
}));
const caseEntryPayload = computed<BusinessEntryDraftPayload>({
  get: () => ({
    sceneKey: CLEARING_CASE_ENTRY_DEFINITION.key,
    definitionVersion: CLEARING_CASE_ENTRY_DEFINITION.version,
    values: { ...caseForm }
  }),
  set: (payload) => assignStringValues(caseForm, payload.values)
});
const activeEventDefinition = computed<BusinessEntrySceneDefinition>(() => {
  if (!isAuthorityCase.value) return CLEARING_EVENT_ENTRY_DEFINITION;
  if (detail.value?.sourceDiscriminator === "construction_enterprise_guarantee") {
    return CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION;
  }
  return {
    ...CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION,
    fields: CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION.fields.filter((field) => field.key !== "amountYuan")
  };
});
const eventEntryPayload = computed<BusinessEntryDraftPayload>({
  get: () => ({
    sceneKey: activeEventDefinition.value.key,
    definitionVersion: activeEventDefinition.value.version,
    values: { ...eventForm }
  }),
  set: (payload) => assignStringValues(eventForm, payload.values)
});
const activeConfirmationDefinition = computed<BusinessEntrySceneDefinition>(() => {
  const fieldKeys = new Set<string>();
  if (requiresAllocation.value) {
    fieldKeys.add("sourceKind");
    fieldKeys.add("amountYuan");
    if (confirmationForm.sourceKind !== "authority_cap") {
      fieldKeys.add(isAuthorityCase.value ? "sourceSelectionRef" : "sourceEventVersionId");
    }
  }
  if (selectedEvent.value?.kind === "pending_reconciliation") {
    fieldKeys.add("pairedWithheldAmountYuan");
  }
  return {
    ...CLEARING_CONFIRMATION_ENTRY_DEFINITION,
    fields: CLEARING_CONFIRMATION_ENTRY_DEFINITION.fields.filter((field) => fieldKeys.has(field.key))
  };
});
const confirmationEntryOptions = computed(() => ({
  sourceKind: visibleSourceKindOptions.value,
  sourceEventVersionId: sourceEventVersionOptions.value,
  sourceSelectionRef: visibleAllocationOptions.value.map((option) => ({
    value: option.selectionRef,
    label: `${option.sourceKind === "withheld" ? "暂扣" : option.sourceKind === "final_confirmed" ? "最终扣项" : "补扣"} · 可用 ¥${centsTextToYuanText(option.remainingCents)}`
  }))
}));
const confirmationEntryPayload = computed<BusinessEntryDraftPayload>({
  get: () => ({
    sceneKey: CLEARING_CONFIRMATION_ENTRY_DEFINITION.key,
    definitionVersion: CLEARING_CONFIRMATION_ENTRY_DEFINITION.version,
    values: { ...confirmationForm }
  }),
  set: (payload) => assignStringValues(confirmationForm, payload.values)
});

const caseColumns = [
  { colKey: "subject", title: "受控事项", minWidth: 180 },
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
    await Promise.all([loadCases(), loadAuthorityOptions()]);
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

async function loadAuthorityOptions() {
  authorityOptions.value = (await fetchAffiliateClearingAuthorityOptions(selectedProjectId.value || undefined)).options;
}

async function changeProject() {
  detail.value = null;
  loading.value = true;
  try {
    await Promise.all([loadCases(), loadAuthorityOptions()]);
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
    allocationOptions.value = (await fetchClearingAllocationOptions(row.id)).options;
  } finally {
    loading.value = false;
  }
}

function openCaseCreate() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  caseForm.projectId = selectedProjectId.value || projects.value[0]?.id || "";
  caseForm.governedSubjectKey = "";
  caseForm.category = "management_fee";
  caseForm.authoritativeGrossCapYuan = "";
  caseForm.authoritySelectionRef = "";
  caseForm.guaranteeTrancheYuan = "";
  caseDialogVisible.value = true;
}

async function saveCase() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  submitting.value = true;
  try {
    const base = {
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: 0,
      category: caseForm.category
    };
    if (authorityCategoryValues.has(caseForm.category)) {
      if (!caseForm.authoritySelectionRef) throw new Error("请选择服务端权威业务选项");
      await createClearingCaseWithCapability({
        ...base,
        authoritySelectionRef: caseForm.authoritySelectionRef,
        guaranteeTrancheAmountCents: caseForm.category === "deposit" && caseForm.guaranteeTrancheYuan
          ? yuanTextToCentsText(caseForm.guaranteeTrancheYuan)
          : undefined
      });
    } else {
      const profile = await fetchProjectOperatingProfile(caseForm.projectId);
      if (!profile.constructionEnterprise?.assignmentId) {
        throw new Error("项目尚未设置有效施工企业档案");
      }
      await createClearingCaseWithCapability({
        ...base,
        projectId: caseForm.projectId,
        constructionEnterpriseAssignmentId: profile.constructionEnterprise.assignmentId,
        governedSubjectKey: caseForm.governedSubjectKey.trim(),
        authoritativeGrossCapCents: yuanTextToCentsText(caseForm.authoritativeGrossCapYuan)
      });
    }
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
  eventForm.amountYuan = "";
  eventForm.evidenceLevel = "A";
  eventForm.businessReason = "";
  eventForm.evidenceRef = "";
  editingPayableRef.value = "";
  editingPayloadSnapshot.value = {};
  eventDialogVisible.value = true;
}

function openEventRevision(event: ClearingEventReadModel) {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  const current = event.versions.find((version) => version.versionNo === event.currentVersionNo);
  if (!current || event.workflowStatus !== "draft") return;
  editingEvent.value = event;
  eventForm.kind = event.kind;
  eventForm.amountYuan = centsTextToYuanText(current.amountCents);
  eventForm.evidenceLevel = current.evidenceLevel;
  eventForm.businessReason = typeof current.payloadSnapshot.businessReason === "string" ? current.payloadSnapshot.businessReason : "";
  eventForm.evidenceRef = typeof current.payloadSnapshot.evidenceRef === "string" ? current.payloadSnapshot.evidenceRef : "";
  editingPayableRef.value = current.payableRef ?? "";
  editingPayloadSnapshot.value = { ...current.payloadSnapshot };
  eventDialogVisible.value = true;
}

async function saveEvent() {
  if (!capabilities.value.availableActions.includes("clearing.prepare")) return;
  if (!detail.value) return;
  submitting.value = true;
  try {
    const base = {
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: editingEvent.value?.revision ?? detail.value.revision,
      kind: eventForm.kind,
    };
    const body = isAuthorityCase.value
      ? {
          ...base,
          amountCents: detail.value.sourceDiscriminator === "construction_enterprise_guarantee"
            ? yuanTextToCentsText(eventForm.amountYuan)
            : undefined,
          businessReason: eventForm.businessReason.trim(),
          evidenceRef: eventForm.evidenceRef.trim() || undefined
        }
      : {
          ...base,
          amountCents: yuanTextToCentsText(eventForm.amountYuan),
          evidenceLevel: eventForm.evidenceLevel,
          payableRef: editingPayableRef.value || undefined,
          payload: {
            ...editingPayloadSnapshot.value,
            ...(eventForm.businessReason.trim()
              ? { businessReason: eventForm.businessReason.trim() }
              : {}),
            ...(eventForm.evidenceRef.trim()
              ? { evidenceRef: eventForm.evidenceRef.trim() }
              : {})
          }
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
  confirmationForm.sourceKind = isAuthorityCase.value
    ? event.kind === "returned" ? allocationOptions.value[0]?.sourceKind ?? "withheld" : "authority_cap"
    : event.kind === "returned" ? "final_confirmed" : "authority_cap";
  confirmationForm.sourceEventVersionId = "";
  confirmationForm.sourceSelectionRef = "";
  confirmationForm.amountYuan = current ? centsTextToYuanText(current.amountCents) : "";
  confirmationForm.pairedWithheldAmountYuan = event.kind === "pending_reconciliation" && current
    ? centsTextToYuanText(current.amountCents)
    : "";
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
              : isAuthorityCase.value ? undefined : confirmationForm.sourceEventVersionId.trim(),
            sourceSelectionRef: isAuthorityCase.value && confirmationForm.sourceKind !== "authority_cap"
              ? confirmationForm.sourceSelectionRef
              : undefined,
            amountCents: yuanTextToCentsText(confirmationForm.amountYuan)
          }]
        : [];
      await confirmClearingEventWithCapability(event.id, {
        ...base,
        allocations,
        pairedWithheldAmountCents: event.kind === "pending_reconciliation"
          ? yuanTextToCentsText(confirmationForm.pairedWithheldAmountYuan)
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
  allocationOptions.value = (await fetchClearingAllocationOptions(detail.value.id)).options;
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

function assignStringValues(
  target: Record<string, string>,
  values: Record<string, unknown>
) {
  for (const key of Object.keys(target)) {
    const value = values[key];
    target[key] = typeof value === "string" ? value : "";
  }
}

function displaySubject(row: ClearingCaseReadModel) {
  if (row.sourceDiscriminator === "construction_enterprise_assigned_wage") {
    return `派驻工资 · ${row.coverageKind === "ROLE_SUMMARY" ? "岗位汇总" : "人员"}`;
  }
  if (row.sourceDiscriminator === "construction_enterprise_guarantee") return "保证金义务";
  return row.governedSubjectKey;
}

function authorityOptionLabel(option: import("../../api/clearing.api").AffiliateClearingAuthorityOption) {
  const cap = option.grossCapCents ? ` · 上限 ${option.grossCapCents} 分` : "";
  const period = option.period ? ` · ${option.period}` : "";
  return `${option.label ?? "权威业务选项"}${period}${cap}`;
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
      >
        <template #subject="{ row }">{{ displaySubject(row) }}</template>
      </t-table>
    </t-card>

    <t-card v-if="detail" class="panel" :title="`事项：${displaySubject(detail)}`">
      <template #actions>
        <t-button v-if="capabilities.prepare" theme="primary" @click="openEventCreate">新增事件草稿</t-button>
      </template>
      <t-descriptions bordered :column="2">
        <t-descriptions-item v-if="!detail.sourceDiscriminator" label="项目">{{ detail.projectId }}</t-descriptions-item>
        <t-descriptions-item v-if="!detail.sourceDiscriminator" label="施工企业档案">{{ detail.constructionEnterpriseAssignmentId }}</t-descriptions-item>
        <t-descriptions-item v-if="detail.sourceDiscriminator" label="权威快照">{{ detail.authoritySnapshotRef }}</t-descriptions-item>
        <t-descriptions-item v-if="detail.sourceDiscriminator" label="来源">{{ detail.sourceDiscriminator === "construction_enterprise_guarantee" ? "服务端保证金义务" : "服务端派驻工资" }}</t-descriptions-item>
        <t-descriptions-item v-if="detail.sourceDiscriminator" label="覆盖方式">{{ detail.coverageKind === "ROLE_SUMMARY" ? "岗位汇总（不含人员）" : "服务端人员身份" }}</t-descriptions-item>
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
        <BusinessEntryForm
          v-model="caseEntryPayload"
          :definition="CLEARING_CASE_ENTRY_DEFINITION"
          :options-by-field="caseEntryOptions"
        />
        <template v-if="authorityCategoryValues.has(caseForm.category)">
          <t-alert theme="info" :close="false" message="协议、人员/岗位、规则、上限和快照均由服务端派生；客户端只提交短效 selectionRef。" />
        </template>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="eventDialogVisible" :header="editingEvent ? '修订清分事件草稿' : '新增清分事件草稿'" :confirm-btn="{ loading: submitting }" @confirm="saveEvent">
      <t-form label-align="top">
        <BusinessEntryForm
          v-model="eventEntryPayload"
          :definition="activeEventDefinition"
        />
        <template v-if="isAuthorityCase">
          <t-alert theme="info" :close="false" message="正式金额、证据等级和冻结快照由服务端 authority case 派生；不接受客户端 JSON 或应付/付款引用。" />
        </template>
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
        <BusinessEntryForm
          v-model="confirmationEntryPayload"
          :definition="activeConfirmationDefinition"
          :options-by-field="confirmationEntryOptions"
        />
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
