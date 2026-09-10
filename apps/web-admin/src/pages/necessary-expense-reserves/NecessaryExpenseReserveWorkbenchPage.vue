<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchNecessaryExpenseReserveCapabilities,
  fetchNecessaryExpenseReserveWorkbench,
  saveNecessaryExpenseReserveDraft,
  transitionNecessaryExpenseReserve,
  type NecessaryExpenseReserveCapabilities,
  type NecessaryExpenseReserveEntryReadModel,
  type NecessaryExpenseReserveReadModel
} from "../../api/necessary-expense-reserve.api";
import {
  fetchProjects,
  uploadPrivateFile,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  fetchProjectOperatingProfile,
  type ProjectOperatingProfileReadModel
} from "../../api/project-operating-profile.api";
import {
  necessaryExpenseReserveActions,
  necessaryExpenseReserveEntryKindLabels,
  necessaryExpenseReserveStatusLabels
} from "./necessary-expense-reserve.state";

const emptyCapabilities: NecessaryExpenseReserveCapabilities = {
  read: false,
  prepare: false,
  submit: false,
  attest: false,
  confirm: false,
  return: false
};
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref("");
const projects = ref<ProjectOptionReadModel[]>([]);
const selectedProjectId = ref("");
const profile = ref<ProjectOperatingProfileReadModel | null>(null);
const reserves = ref<NecessaryExpenseReserveReadModel[]>([]);
const capabilities = ref<NecessaryExpenseReserveCapabilities>({ ...emptyCapabilities });
const draftVisible = ref(false);
const actionVisible = ref(false);
const evidenceFiles = ref<Array<{ raw?: File; name?: string }>>([]);
const editingEntry = ref<NecessaryExpenseReserveEntryReadModel | null>(null);
const actionEntry = ref<NecessaryExpenseReserveEntryReadModel | null>(null);
const pendingAction = ref<"submit" | "attest" | "confirm" | "return">("submit");

const draft = reactive({
  reserveId: "",
  entryId: "",
  businessCode: "",
  reasonKind: "mandatory_closeout",
  title: "",
  basisKind: "written_evidence",
  basisBusinessIdOrEvidenceSha256: "",
  basisSummary: "",
  fundHolderKind: "construction_enterprise",
  fundHolderId: "",
  entryKind: "establish",
  adjustsEntryId: "",
  amountCents: "",
  occurredAt: "",
  evidenceLevel: "A",
  evidenceFileId: "",
  evidenceSha256: "",
  reason: "",
  revision: 0
});

const projectOptions = computed(() => projects.value.map((project) => ({
  value: project.id,
  label: `${project.code} · ${project.name}`
})));
const holderOptions = computed(() => {
  if (!profile.value) return [];
  const construction = profile.value.constructionEnterprise
    ? [{
        value: `construction_enterprise:${profile.value.constructionEnterprise.businessPartyVersionId}`,
        label: `施工企业 · ${profile.value.constructionEnterprise.name}`
      }]
    : [];
  return [
    ...construction,
    ...profile.value.participatingCompanies
      .filter((company) => company.status === "active" || company.status === "scheduled_active")
      .map((company) => ({
        value: `participating_company:${company.companyEntityId}`,
        label: `参与公司 · ${company.companyName}`
      }))
  ];
});
const confirmedIncreaseOptions = computed(() => reserves.value.flatMap((reserve) =>
  reserve.entries
    .filter((entry) => entry.status === "confirmed" && ["establish", "increase"].includes(entry.entryKind))
    .map((entry) => ({
      value: entry.id,
      label: `${reserve.businessCode} · 第 ${entry.sequenceNo} 笔 · ${entry.amountCents} 分`
    }))
));
const rows = computed(() => reserves.value.flatMap((reserve) => reserve.entries.map((entry) => ({
  ...entry,
  businessCode: reserve.businessCode,
  title: reserve.title,
  reasonKind: reserve.reasonKind,
  actions: necessaryExpenseReserveActions(entry, capabilities.value)
}))));
const actionTitle = computed(() => ({
  submit: "提交必要费用准备",
  attest: "见证必要费用准备",
  confirm: "确认进入正式经营账",
  return: "退回必要费用准备"
}[pendingAction.value]));
const actionDescription = computed(() => ({
  submit: "提交会冻结当前金额、依据、业务发生日和证据哈希，后续见证与确认必须引用同一指纹。",
  attest: "项目经理见证表示该未来支出责任和金额依据真实存在；见证人必须与准备人不同。",
  confirm: "财务总监确认后将同事务追加正式现金限制分录，但不会形成成本、应付或资金移动。",
  return: "退回会保留当前版本和审计轨迹，财务修订后可重新提交。"
}[pendingAction.value]));

const columns = [
  { colKey: "businessCode", title: "业务编号", minWidth: 150 },
  { colKey: "title", title: "必要准备事项", minWidth: 220 },
  { colKey: "entryKind", title: "变化类型", width: 120 },
  { colKey: "amountCents", title: "金额（分）", width: 130 },
  { colKey: "occurredAt", title: "业务发生日", width: 130 },
  { colKey: "status", title: "状态", minWidth: 150 },
  { colKey: "actions", title: "操作", minWidth: 260 }
];

onMounted(loadInitial);

async function loadInitial() {
  loading.value = true;
  try {
    projects.value = await fetchProjects();
    selectedProjectId.value ||= projects.value[0]?.id ?? "";
    await loadWorkbench();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载必要费用准备工作台失败");
  } finally {
    loading.value = false;
  }
}

async function loadWorkbench() {
  if (!selectedProjectId.value) return;
  const [workbench, projectProfile] = await Promise.all([
    fetchNecessaryExpenseReserveWorkbench(selectedProjectId.value),
    fetchProjectOperatingProfile(selectedProjectId.value)
  ]);
  reserves.value = workbench.reserves;
  capabilities.value = workbench.capabilities;
  profile.value = projectProfile;
}

async function changeProject() {
  loading.value = true;
  errorMessage.value = "";
  try {
    await loadWorkbench();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "切换项目失败");
  } finally {
    loading.value = false;
  }
}

function resetDraft() {
  Object.assign(draft, {
    reserveId: "",
    entryId: "",
    businessCode: "",
    reasonKind: "mandatory_closeout",
    title: "",
    basisKind: "written_evidence",
    basisBusinessIdOrEvidenceSha256: "",
    basisSummary: "",
    fundHolderKind: "construction_enterprise",
    fundHolderId: "",
    entryKind: "establish",
    adjustsEntryId: "",
    amountCents: "",
    occurredAt: new Date().toISOString().slice(0, 10),
    evidenceLevel: "A",
    evidenceFileId: "",
    evidenceSha256: "",
    reason: "",
    revision: 0
  });
  const firstHolder = holderOptions.value[0]?.value;
  if (firstHolder) chooseHolder(firstHolder);
  editingEntry.value = null;
  evidenceFiles.value = [];
}

function openCreate() {
  resetDraft();
  draftVisible.value = true;
}

function openIncrease(reserve: NecessaryExpenseReserveReadModel) {
  resetDraft();
  draft.reserveId = reserve.id;
  draft.businessCode = reserve.businessCode;
  draft.reasonKind = reserve.reasonKind;
  draft.title = reserve.title;
  draft.basisKind = reserve.basisKind;
  draft.basisBusinessIdOrEvidenceSha256 = reserve.basisBusinessIdOrEvidenceSha256;
  draft.basisSummary = reserve.basisSummary;
  draft.fundHolderKind = reserve.fundHolderKind;
  draft.fundHolderId = reserve.fundHolderId;
  draft.entryKind = "increase";
  draftVisible.value = true;
}

function openEdit(entry: NecessaryExpenseReserveEntryReadModel) {
  const reserve = reserves.value.find((item) => item.id === entry.reserveId);
  if (!reserve) return;
  resetDraft();
  editingEntry.value = entry;
  Object.assign(draft, {
    reserveId: reserve.id,
    entryId: entry.id,
    businessCode: reserve.businessCode,
    reasonKind: reserve.reasonKind,
    title: reserve.title,
    basisKind: reserve.basisKind,
    basisBusinessIdOrEvidenceSha256: reserve.basisBusinessIdOrEvidenceSha256,
    basisSummary: reserve.basisSummary,
    fundHolderKind: reserve.fundHolderKind,
    fundHolderId: reserve.fundHolderId,
    entryKind: entry.entryKind,
    adjustsEntryId: entry.adjustsEntryId ?? "",
    amountCents: entry.amountCents,
    occurredAt: entry.occurredAt,
    evidenceLevel: entry.evidenceLevel,
    evidenceFileId: entry.evidenceFileId,
    evidenceSha256: entry.evidenceSha256,
    reason: entry.reason,
    revision: entry.revision
  });
  draftVisible.value = true;
}

function chooseHolder(value: string) {
  const [kind, ...id] = value.split(":");
  draft.fundHolderKind = kind;
  draft.fundHolderId = id.join(":");
}

async function uploadNecessaryExpenseReserveEvidenceWithCapability(file: File, fileName: string) {
  const capability = await fetchNecessaryExpenseReserveCapabilities(selectedProjectId.value);
  const operationAllowed = capability.prepare;
  if (!operationAllowed) throw new Error("当前岗位没有必要费用准备权限");
  return uploadPrivateFile(file, fileName, crypto.randomUUID());
}

async function persistNecessaryExpenseReserveDraftWithCapability(
  body: Parameters<typeof saveNecessaryExpenseReserveDraft>[0]
) {
  const capability = await fetchNecessaryExpenseReserveCapabilities(selectedProjectId.value);
  const operationAllowed = capability.prepare;
  if (!operationAllowed) throw new Error("当前岗位没有必要费用准备权限");
  return saveNecessaryExpenseReserveDraft(body);
}

async function saveDraft() {
  const projectProfile = profile.value;
  if (!projectProfile?.constructionEnterprise?.assignmentId) {
    throw new Error("项目尚未设置有效施工企业档案");
  }
  submitting.value = true;
  try {
    const file = evidenceFiles.value[0]?.raw;
    if (file instanceof File) {
      const [uploaded, sha256] = await Promise.all([
        uploadNecessaryExpenseReserveEvidenceWithCapability(file, file.name),
        sha256File(file)
      ]);
      draft.evidenceFileId = uploaded.id;
      draft.evidenceSha256 = sha256;
    }
    if (!draft.evidenceFileId || !draft.evidenceSha256) {
      throw new Error("请选择真实依据文件");
    }
    await persistNecessaryExpenseReserveDraftWithCapability({
      ...(draft.reserveId ? { reserveId: draft.reserveId } : {}),
      ...(draft.entryId ? { entryId: draft.entryId, expectedRevision: draft.revision } : {}),
      projectId: selectedProjectId.value,
      businessCode: draft.businessCode,
      affiliateAssignmentId: projectProfile.constructionEnterprise.assignmentId,
      fundHolderKind: draft.fundHolderKind,
      fundHolderId: draft.fundHolderId,
      reasonKind: draft.reasonKind,
      title: draft.title,
      basisKind: draft.basisKind,
      basisBusinessIdOrEvidenceSha256: draft.basisBusinessIdOrEvidenceSha256 || draft.evidenceSha256,
      basisSummary: draft.basisSummary,
      entryKind: draft.entryKind,
      ...(draft.adjustsEntryId ? { adjustsEntryId: draft.adjustsEntryId } : {}),
      amountCents: draft.amountCents,
      occurredAt: draft.occurredAt,
      evidenceLevel: draft.evidenceLevel,
      evidenceFileId: draft.evidenceFileId,
      evidenceSha256: draft.evidenceSha256,
      reason: draft.reason,
      replacementImpacts: [],
      idempotencyKey: crypto.randomUUID()
    });
    draftVisible.value = false;
    await loadWorkbench();
    await MessagePlugin.success("必要费用准备草稿已保存，尚未进入正式账");
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "保存必要费用准备草稿失败");
  } finally {
    submitting.value = false;
  }
}

async function submitNecessaryExpenseReserveWithCapability(
  entry: NecessaryExpenseReserveEntryReadModel
) {
  const capability = await fetchNecessaryExpenseReserveCapabilities(selectedProjectId.value);
  const operationAllowed = capability.submit;
  if (!operationAllowed) throw new Error("当前岗位不能提交必要费用准备");
  return transitionNecessaryExpenseReserve(entry.id, {
    action: "submit",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID()
  });
}

async function attestNecessaryExpenseReserveWithCapability(
  entry: NecessaryExpenseReserveEntryReadModel
) {
  const capability = await fetchNecessaryExpenseReserveCapabilities(selectedProjectId.value);
  const operationAllowed = capability.attest;
  if (!operationAllowed) throw new Error("当前岗位不能见证必要费用准备");
  return transitionNecessaryExpenseReserve(entry.id, {
    action: "attest",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID()
  });
}

async function confirmNecessaryExpenseReserveWithCapability(
  entry: NecessaryExpenseReserveEntryReadModel
) {
  const capability = await fetchNecessaryExpenseReserveCapabilities(selectedProjectId.value);
  const operationAllowed = capability.confirm;
  if (!operationAllowed) throw new Error("当前岗位不能确认必要费用准备");
  return transitionNecessaryExpenseReserve(entry.id, {
    action: "confirm",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID()
  });
}

async function returnNecessaryExpenseReserveWithCapability(
  entry: NecessaryExpenseReserveEntryReadModel,
  reason: string
) {
  const capability = await fetchNecessaryExpenseReserveCapabilities(selectedProjectId.value);
  const operationAllowed = capability.return;
  if (!operationAllowed) throw new Error("当前岗位不能退回必要费用准备");
  return transitionNecessaryExpenseReserve(entry.id, {
    action: "return",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID(),
    reason
  });
}

function openAction(
  entry: NecessaryExpenseReserveEntryReadModel,
  action: "submit" | "attest" | "confirm" | "return"
) {
  actionEntry.value = entry;
  pendingAction.value = action;
  actionVisible.value = true;
}

async function executeAction(values: { reason: string }) {
  if (!actionEntry.value) return;
  submitting.value = true;
  try {
    if (pendingAction.value === "submit") {
      await submitNecessaryExpenseReserveWithCapability(actionEntry.value);
    } else if (pendingAction.value === "attest") {
      await attestNecessaryExpenseReserveWithCapability(actionEntry.value);
    } else if (pendingAction.value === "confirm") {
      await confirmNecessaryExpenseReserveWithCapability(actionEntry.value);
    } else {
      await returnNecessaryExpenseReserveWithCapability(actionEntry.value, values.reason);
    }
    actionVisible.value = false;
    await loadWorkbench();
    await MessagePlugin.success(`${actionTitle.value}已完成`);
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, `${actionTitle.value}失败`);
  } finally {
    submitting.value = false;
  }
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
</script>

<template>
  <section class="reserve-workbench">
    <header class="page-head">
      <div>
        <span class="eyebrow">项目现金限制来源</span>
        <h1>必要费用准备工作台</h1>
        <p>只保留当前可分配现金，不形成成本、应付或资金移动。</p>
      </div>
      <t-button v-if="capabilities.prepare" @click="openCreate">建立必要准备</t-button>
    </header>

    <t-alert
      v-if="errorMessage"
      theme="error"
      title="暂时无法处理"
      :message="errorMessage"
      :close="false"
    />

    <t-card class="panel" :bordered="false">
      <div class="project-filter">
        <span>当前项目</span>
        <t-select
          v-model="selectedProjectId"
          :options="projectOptions"
          :loading="loading"
          @change="changeProject"
        />
      </div>
      <t-alert
        theme="info"
        :close="false"
        message="A级或B级真实依据方可登记金额；财务准备、项目经理独立见证、财务总监确认。"
      />
    </t-card>

    <t-card class="panel" :bordered="false" title="准备事项与追加分录">
      <t-table :data="rows" :columns="columns" row-key="id" :loading="loading">
        <template #entryKind="{ row }">
          {{ necessaryExpenseReserveEntryKindLabels[row.entryKind as keyof typeof necessaryExpenseReserveEntryKindLabels] }}
        </template>
        <template #status="{ row }">
          <t-tag :theme="row.status === 'confirmed' ? 'success' : row.status === 'returned' ? 'danger' : 'warning'">
            {{ necessaryExpenseReserveStatusLabels[row.status as keyof typeof necessaryExpenseReserveStatusLabels] }}
          </t-tag>
        </template>
        <template #actions="{ row }">
          <div class="row-actions">
            <t-button v-if="row.actions.edit" size="small" variant="text" @click="openEdit(row)">修改草稿</t-button>
            <t-button v-if="row.actions.submit" size="small" variant="text" @click="openAction(row, 'submit')">提交</t-button>
            <t-button v-if="row.actions.attest" size="small" variant="text" @click="openAction(row, 'attest')">项目经理见证</t-button>
            <t-button v-if="row.actions.confirm" size="small" variant="text" @click="openAction(row, 'confirm')">财务确认</t-button>
            <t-button v-if="row.actions.return" size="small" variant="text" theme="danger" @click="openAction(row, 'return')">退回</t-button>
            <t-button
              v-if="row.status === 'confirmed' && capabilities.prepare"
              size="small"
              variant="text"
              @click="openIncrease(reserves.find((item) => item.id === row.reserveId)!)"
            >追加变化</t-button>
          </div>
        </template>
      </t-table>
    </t-card>

    <t-dialog
      v-model:visible="draftVisible"
      :header="editingEntry ? '修改必要准备草稿' : '登记必要费用准备'"
      :confirm-btn="{ loading: submitting }"
      width="720px"
      @confirm="saveDraft"
    >
      <t-form label-align="top" class="draft-form">
        <t-form-item label="业务编号"><t-input v-model="draft.businessCode" /></t-form-item>
        <t-form-item label="准备原因类型">
          <t-select v-model="draft.reasonKind" :options="[
            { value: 'warranty_or_remediation', label: '质保、返修或缺陷整改' },
            { value: 'legal_or_compliance', label: '法律、合规或行政事项' },
            { value: 'mandatory_closeout', label: '项目收尾必要支出' },
            { value: 'other_approved_necessary', label: '其他已批准必要准备' }
          ]" />
        </t-form-item>
        <t-form-item label="事项名称"><t-input v-model="draft.title" /></t-form-item>
        <t-form-item label="资金当前持有主体">
          <t-select
            :value="`${draft.fundHolderKind}:${draft.fundHolderId}`"
            :options="holderOptions"
            @change="(value: unknown) => chooseHolder(String(value))"
          />
        </t-form-item>
        <t-form-item label="本次变化">
          <t-select v-model="draft.entryKind" :disabled="!draft.reserveId" :options="[
            { value: 'establish', label: '建立准备' },
            { value: 'increase', label: '增加准备' },
            { value: 'release', label: '释放准备' },
            { value: 'technical_reversal', label: '技术冲销' }
          ]" />
        </t-form-item>
        <t-form-item v-if="draft.entryKind === 'release' || draft.entryKind === 'technical_reversal'" label="所调整的已确认准备">
          <t-select v-model="draft.adjustsEntryId" :options="confirmedIncreaseOptions" />
        </t-form-item>
        <t-form-item label="金额（整数分）"><t-input v-model="draft.amountCents" /></t-form-item>
        <t-form-item label="业务发生日"><t-date-picker v-model="draft.occurredAt" /></t-form-item>
        <t-form-item label="证据等级">
          <t-select v-model="draft.evidenceLevel" :options="[
            { value: 'A', label: 'A级逐笔可靠事实' },
            { value: 'B', label: 'B级受控汇总事实' }
          ]" />
        </t-form-item>
        <t-form-item label="依据类型"><t-input v-model="draft.basisKind" /></t-form-item>
        <t-form-item label="依据业务编号（无编号时留空，使用文件哈希）"><t-input v-model="draft.basisBusinessIdOrEvidenceSha256" /></t-form-item>
        <t-form-item label="依据摘要"><t-textarea v-model="draft.basisSummary" /></t-form-item>
        <t-form-item label="本次登记原因"><t-textarea v-model="draft.reason" /></t-form-item>
        <t-form-item label="真实依据文件">
          <t-upload v-model="evidenceFiles" theme="file-flow" :auto-upload="false" :multiple="false" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <SensitiveActionDialog
      v-model="actionVisible"
      :title="actionTitle"
      :description="actionDescription"
      :loading="submitting"
      :require-reason="pendingAction === 'return'"
      @confirm="executeAction"
    />
  </section>
</template>

<style scoped>
.reserve-workbench,
.draft-form,
.panel {
  display: grid;
  gap: var(--jg-space-lg);
}

.reserve-workbench {
  gap: var(--jg-space-xl);
}

.page-head,
.row-actions,
.project-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.page-head h1,
.page-head p {
  margin: 0;
}

.eyebrow,
.project-filter > span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
}

.project-filter :deep(.t-select__wrap) {
  width: 100%;
}

.row-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .page-head,
  .project-filter {
    align-items: stretch;
    flex-direction: column;
  }

  .project-filter :deep(.t-select__wrap) {
    min-width: 0;
    width: 100%;
  }
}
</style>
