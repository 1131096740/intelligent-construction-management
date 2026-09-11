<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchProjectFundDisputeCapabilities,
  fetchProjectFundDisputeWorkbench,
  saveProjectFundDisputeDraft,
  transitionProjectFundDispute,
  type ProjectFundDisputeCapabilities,
  type ProjectFundDisputeEntryReadModel,
  type ProjectFundDisputeReadModel
} from "../../api/project-fund-dispute.api";
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
  projectFundDisputeActions,
  projectFundDisputeEntryKindLabels,
  projectFundDisputeStatusLabels
} from "./project-fund-dispute.state";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";

const emptyCapabilities: ProjectFundDisputeCapabilities = {
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
const disputes = ref<ProjectFundDisputeReadModel[]>([]);
const capabilities = ref<ProjectFundDisputeCapabilities>({ ...emptyCapabilities });
const draftVisible = ref(false);
const actionVisible = ref(false);
const evidenceFiles = ref<Array<{ raw?: File; name?: string }>>([]);
const editingEntry = ref<ProjectFundDisputeEntryReadModel | null>(null);
const actionEntry = ref<ProjectFundDisputeEntryReadModel | null>(null);
const pendingAction = ref<"submit" | "attest" | "confirm" | "return">("submit");

const draft = reactive({
  disputeId: "",
  entryId: "",
  businessCode: "",
  disputeKind: "upstream",
  counterpartyKind: "organization",
  counterpartyId: "",
  counterpartyNameSnapshot: "",
  basisKind: "written_evidence",
  basisBusinessIdOrEvidenceSha256: "",
  referenceCode: "",
  fundHolderKind: "construction_enterprise",
  fundHolderId: "",
  entryKind: "establish",
  adjustsEntryId: "",
  amountYuan: "",
  occurredAt: "",
  evidenceLevel: "A",
  evidenceFileId: "",
  evidenceSha256: "",
  disputeSummary: "",
  resolutionBasisSummary: "",
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
const confirmedIncreaseOptions = computed(() => disputes.value.flatMap((dispute) =>
  dispute.entries
    .filter((entry) => entry.status === "confirmed" && ["establish", "increase"].includes(entry.entryKind))
    .map((entry) => ({
      value: entry.id,
      label: `${dispute.businessCode} · 第 ${entry.sequenceNo} 笔 · ¥${centsTextToYuanText(entry.amountCents)}`
    }))
));
const rows = computed(() => disputes.value.flatMap((dispute) => dispute.entries.map((entry) => ({
  ...entry,
  businessCode: dispute.businessCode,
  counterpartyNameSnapshot: dispute.counterpartyNameSnapshot,
  disputeKind: dispute.disputeKind,
  actions: projectFundDisputeActions(entry, capabilities.value)
}))));
const actionTitle = computed(() => ({
  submit: "提交一般争议资金",
  attest: "见证一般争议资金",
  confirm: "确认进入正式经营账",
  return: "退回一般争议资金"
}[pendingAction.value]));
const actionDescription = computed(() => ({
  submit: "提交会冻结当前金额、依据、业务发生日和证据哈希，后续见证与确认必须引用同一指纹。",
  attest: "项目经理或合同总监见证争议、实际持有主体和金额依据真实存在；见证人必须与准备人不同。",
  confirm: "财务总监确认后将同事务追加正式现金限制分录，但不会形成成本、应付或资金移动。",
  return: "退回会保留当前版本和审计轨迹，财务修订后可重新提交。"
}[pendingAction.value]));

const columns = [
  { colKey: "businessCode", title: "业务编号", minWidth: 150 },
  { colKey: "counterpartyNameSnapshot", title: "争议相对方", minWidth: 220 },
  { colKey: "entryKind", title: "变化类型", width: 120 },
  { colKey: "amountCents", title: "金额（元）", width: 130 },
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
    errorMessage.value = formatUnknownApiError(error, "加载一般争议资金工作台失败");
  } finally {
    loading.value = false;
  }
}

async function loadWorkbench() {
  if (!selectedProjectId.value) return;
  const [workbench, projectProfile] = await Promise.all([
    fetchProjectFundDisputeWorkbench(selectedProjectId.value),
    fetchProjectOperatingProfile(selectedProjectId.value)
  ]);
  disputes.value = workbench.disputes;
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
    disputeId: "",
    entryId: "",
    businessCode: "",
    disputeKind: "upstream",
    counterpartyKind: "organization",
    counterpartyId: "",
    counterpartyNameSnapshot: "",
    basisKind: "written_evidence",
    basisBusinessIdOrEvidenceSha256: "",
    referenceCode: "",
    fundHolderKind: "construction_enterprise",
    fundHolderId: "",
    entryKind: "establish",
    adjustsEntryId: "",
    amountYuan: "",
    occurredAt: new Date().toISOString().slice(0, 10),
    evidenceLevel: "A",
    evidenceFileId: "",
    evidenceSha256: "",
    disputeSummary: "",
    resolutionBasisSummary: "",
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

function openIncrease(dispute: ProjectFundDisputeReadModel) {
  resetDraft();
  draft.disputeId = dispute.id;
  draft.businessCode = dispute.businessCode;
  draft.disputeKind = dispute.disputeKind;
  draft.counterpartyKind = dispute.counterpartyKind;
  draft.counterpartyId = dispute.counterpartyId;
  draft.counterpartyNameSnapshot = dispute.counterpartyNameSnapshot;
  draft.basisKind = dispute.basisKind;
  draft.basisBusinessIdOrEvidenceSha256 = dispute.basisBusinessIdOrEvidenceSha256;
  draft.referenceCode = dispute.referenceCode;
  draft.fundHolderKind = dispute.fundHolderKind;
  draft.fundHolderId = dispute.fundHolderId;
  draft.entryKind = "increase";
  draftVisible.value = true;
}

function openEdit(entry: ProjectFundDisputeEntryReadModel) {
  const dispute = disputes.value.find((item) => item.id === entry.disputeId);
  if (!dispute) return;
  resetDraft();
  editingEntry.value = entry;
  Object.assign(draft, {
    disputeId: dispute.id,
    entryId: entry.id,
    businessCode: dispute.businessCode,
    disputeKind: dispute.disputeKind,
    counterpartyKind: dispute.counterpartyKind,
    counterpartyId: dispute.counterpartyId,
    counterpartyNameSnapshot: dispute.counterpartyNameSnapshot,
    basisKind: dispute.basisKind,
    basisBusinessIdOrEvidenceSha256: dispute.basisBusinessIdOrEvidenceSha256,
    referenceCode: dispute.referenceCode,
    fundHolderKind: dispute.fundHolderKind,
    fundHolderId: dispute.fundHolderId,
    entryKind: entry.entryKind,
    adjustsEntryId: entry.adjustsEntryId ?? "",
    amountYuan: centsTextToYuanText(entry.amountCents).replaceAll(",", ""),
    occurredAt: entry.occurredAt,
    evidenceLevel: entry.evidenceLevel,
    evidenceFileId: entry.evidenceFileId,
    evidenceSha256: entry.evidenceSha256,
    disputeSummary: entry.disputeSummary,
    resolutionBasisSummary: entry.resolutionBasisSummary ?? "",
    revision: entry.revision
  });
  draftVisible.value = true;
}

function chooseHolder(value: string) {
  const [kind, ...id] = value.split(":");
  draft.fundHolderKind = kind;
  draft.fundHolderId = id.join(":");
}

async function uploadProjectFundDisputeEvidenceWithCapability(file: File, fileName: string) {
  const capability = await fetchProjectFundDisputeCapabilities(selectedProjectId.value);
  const operationAllowed = capability.prepare;
  if (!operationAllowed) throw new Error("当前岗位没有一般争议资金权限");
  return uploadPrivateFile(file, fileName, crypto.randomUUID());
}

async function persistProjectFundDisputeDraftWithCapability(
  body: Parameters<typeof saveProjectFundDisputeDraft>[0]
) {
  const capability = await fetchProjectFundDisputeCapabilities(selectedProjectId.value);
  const operationAllowed = capability.prepare;
  if (!operationAllowed) throw new Error("当前岗位没有一般争议资金权限");
  return saveProjectFundDisputeDraft(body);
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
        uploadProjectFundDisputeEvidenceWithCapability(file, file.name),
        sha256File(file)
      ]);
      draft.evidenceFileId = uploaded.id;
      draft.evidenceSha256 = sha256;
    }
    if (!draft.evidenceFileId || !draft.evidenceSha256) {
      throw new Error("请选择真实依据文件");
    }
    await persistProjectFundDisputeDraftWithCapability({
      ...(draft.disputeId ? { disputeId: draft.disputeId } : {}),
      ...(draft.entryId ? { entryId: draft.entryId, expectedRevision: draft.revision } : {}),
      projectId: selectedProjectId.value,
      businessCode: draft.businessCode,
      affiliateAssignmentId: projectProfile.constructionEnterprise.assignmentId,
      fundHolderKind: draft.fundHolderKind,
      fundHolderId: draft.fundHolderId,
      disputeKind: draft.disputeKind,
      counterpartyKind: draft.counterpartyKind,
      counterpartyId: draft.counterpartyId,
      counterpartyNameSnapshot: draft.counterpartyNameSnapshot,
      basisKind: draft.basisKind,
      basisBusinessIdOrEvidenceSha256: draft.basisBusinessIdOrEvidenceSha256 || draft.evidenceSha256,
      referenceCode: draft.referenceCode,
      entryKind: draft.entryKind,
      ...(draft.adjustsEntryId ? { adjustsEntryId: draft.adjustsEntryId } : {}),
      amountCents: yuanTextToCentsText(draft.amountYuan.trim()),
      occurredAt: draft.occurredAt,
      evidenceLevel: draft.evidenceLevel,
      evidenceFileId: draft.evidenceFileId,
      evidenceSha256: draft.evidenceSha256,
      disputeSummary: draft.disputeSummary,
      ...(draft.entryKind === "release"
        ? { resolutionBasisSummary: draft.resolutionBasisSummary }
        : {}),
      replacementImpacts: [],
      idempotencyKey: crypto.randomUUID()
    });
    draftVisible.value = false;
    await loadWorkbench();
    await MessagePlugin.success("一般争议资金草稿已保存，尚未进入正式账");
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "保存一般争议资金草稿失败");
  } finally {
    submitting.value = false;
  }
}

async function submitProjectFundDisputeWithCapability(
  entry: ProjectFundDisputeEntryReadModel
) {
  const capability = await fetchProjectFundDisputeCapabilities(selectedProjectId.value);
  const operationAllowed = capability.submit;
  if (!operationAllowed) throw new Error("当前岗位不能提交一般争议资金");
  return transitionProjectFundDispute(entry.id, {
    action: "submit",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID()
  });
}

async function attestProjectFundDisputeWithCapability(
  entry: ProjectFundDisputeEntryReadModel
) {
  const capability = await fetchProjectFundDisputeCapabilities(selectedProjectId.value);
  const operationAllowed = capability.attest;
  if (!operationAllowed) throw new Error("当前岗位不能见证一般争议资金");
  return transitionProjectFundDispute(entry.id, {
    action: "attest",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID()
  });
}

async function confirmProjectFundDisputeWithCapability(
  entry: ProjectFundDisputeEntryReadModel
) {
  const capability = await fetchProjectFundDisputeCapabilities(selectedProjectId.value);
  const operationAllowed = capability.confirm;
  if (!operationAllowed) throw new Error("当前岗位不能确认一般争议资金");
  return transitionProjectFundDispute(entry.id, {
    action: "confirm",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID()
  });
}

async function returnProjectFundDisputeWithCapability(
  entry: ProjectFundDisputeEntryReadModel,
  reason: string
) {
  const capability = await fetchProjectFundDisputeCapabilities(selectedProjectId.value);
  const operationAllowed = capability.return;
  if (!operationAllowed) throw new Error("当前岗位不能退回一般争议资金");
  return transitionProjectFundDispute(entry.id, {
    action: "return",
    expectedRevision: entry.revision,
    expectedFingerprint: entry.fingerprint,
    idempotencyKey: crypto.randomUUID(),
    reason
  });
}

function openAction(
  entry: ProjectFundDisputeEntryReadModel,
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
      await submitProjectFundDisputeWithCapability(actionEntry.value);
    } else if (pendingAction.value === "attest") {
      await attestProjectFundDisputeWithCapability(actionEntry.value);
    } else if (pendingAction.value === "confirm") {
      await confirmProjectFundDisputeWithCapability(actionEntry.value);
    } else {
      await returnProjectFundDisputeWithCapability(actionEntry.value, values.reason);
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
  <section class="dispute-workbench">
    <header class="page-head">
      <div>
        <span class="eyebrow">项目现金限制来源</span>
        <h1>一般争议资金工作台</h1>
        <p>只保留当前可分配现金，不形成成本、应付或资金移动。</p>
      </div>
      <t-button
        v-if="capabilities.prepare"
        @click="openCreate"
      >
        建立争议资金
      </t-button>
    </header>

    <t-alert
      v-if="errorMessage"
      theme="error"
      title="暂时无法处理"
      :message="errorMessage"
      :close="false"
    />

    <t-card
      class="panel"
      :bordered="false"
    >
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

    <t-card
      class="panel"
      :bordered="false"
      title="争议事项与追加分录"
    >
      <t-table
        :data="rows"
        :columns="columns"
        row-key="id"
        :loading="loading"
      >
        <template #entryKind="{ row }">
          {{ projectFundDisputeEntryKindLabels[row.entryKind as keyof typeof projectFundDisputeEntryKindLabels] }}
        </template>
        <template #amountCents="{ row }">
          ¥{{ centsTextToYuanText(row.amountCents) }}
        </template>
        <template #status="{ row }">
          <t-tag :theme="row.status === 'confirmed' ? 'success' : row.status === 'returned' ? 'danger' : 'warning'">
            {{ projectFundDisputeStatusLabels[row.status as keyof typeof projectFundDisputeStatusLabels] }}
          </t-tag>
        </template>
        <template #actions="{ row }">
          <div class="row-actions">
            <t-button
              v-if="row.actions.edit"
              size="small"
              variant="text"
              @click="openEdit(row)"
            >
              修改草稿
            </t-button>
            <t-button
              v-if="row.actions.submit"
              size="small"
              variant="text"
              @click="openAction(row, 'submit')"
            >
              提交
            </t-button>
            <t-button
              v-if="row.actions.attest"
              size="small"
              variant="text"
              @click="openAction(row, 'attest')"
            >
              独立见证
            </t-button>
            <t-button
              v-if="row.actions.confirm"
              size="small"
              variant="text"
              @click="openAction(row, 'confirm')"
            >
              财务确认
            </t-button>
            <t-button
              v-if="row.actions.return"
              size="small"
              variant="text"
              theme="danger"
              @click="openAction(row, 'return')"
            >
              退回
            </t-button>
            <t-button
              v-if="row.status === 'confirmed' && capabilities.prepare"
              size="small"
              variant="text"
              @click="openIncrease(disputes.find((item) => item.id === row.disputeId)!)"
            >
              追加变化
            </t-button>
          </div>
        </template>
      </t-table>
    </t-card>

    <t-dialog
      v-model:visible="draftVisible"
      :header="editingEntry ? '修改争议资金草稿' : '登记一般争议资金'"
      :confirm-btn="{ loading: submitting }"
      width="720px"
      @confirm="saveDraft"
    >
      <t-form
        label-align="top"
        class="draft-form"
      >
        <t-form-item label="业务编号">
          <t-input v-model="draft.businessCode" />
        </t-form-item>
        <t-form-item label="争议类型">
          <t-select
            v-model="draft.disputeKind"
            :options="[
              { value: 'upstream', label: '上游已收项目资金争议' },
              { value: 'downstream', label: '下游已持有项目资金争议' },
              { value: 'inter_subject', label: '施工企业与参与公司资金归属争议' },
              { value: 'external_restriction', label: '司法、行政或其他外部限制' }
            ]"
          />
        </t-form-item>
        <t-form-item label="相对方类型">
          <t-input v-model="draft.counterpartyKind" />
        </t-form-item>
        <t-form-item label="相对方标识">
          <t-input v-model="draft.counterpartyId" />
        </t-form-item>
        <t-form-item label="相对方名称">
          <t-input v-model="draft.counterpartyNameSnapshot" />
        </t-form-item>
        <t-form-item label="资金当前持有主体">
          <t-select
            :value="`${draft.fundHolderKind}:${draft.fundHolderId}`"
            :options="holderOptions"
            @change="(value: unknown) => chooseHolder(String(value))"
          />
        </t-form-item>
        <t-form-item label="本次变化">
          <t-select
            v-model="draft.entryKind"
            :disabled="!draft.disputeId"
            :options="[
              { value: 'establish', label: '建立争议占用' },
              { value: 'increase', label: '增加争议占用' },
              { value: 'release', label: '解除争议占用' },
              { value: 'technical_reversal', label: '技术冲销' }
            ]"
          />
        </t-form-item>
        <t-form-item
          v-if="draft.entryKind === 'release' || draft.entryKind === 'technical_reversal'"
          label="所调整的已确认争议分录"
        >
          <t-select
            v-model="draft.adjustsEntryId"
            :options="confirmedIncreaseOptions"
          />
        </t-form-item>
        <t-form-item label="金额（元）">
          <t-input
            v-model="draft.amountYuan"
            placeholder="0.00"
          />
        </t-form-item>
        <t-form-item label="业务发生日">
          <t-date-picker v-model="draft.occurredAt" />
        </t-form-item>
        <t-form-item label="证据等级">
          <t-select
            v-model="draft.evidenceLevel"
            :options="[
              { value: 'A', label: 'A级逐笔可靠事实' },
              { value: 'B', label: 'B级受控汇总事实' }
            ]"
          />
        </t-form-item>
        <t-form-item label="依据类型">
          <t-input v-model="draft.basisKind" />
        </t-form-item>
        <t-form-item label="依据业务编号（无编号时留空，使用文件哈希）">
          <t-input v-model="draft.basisBusinessIdOrEvidenceSha256" />
        </t-form-item>
        <t-form-item label="外部案号或内部依据编号">
          <t-input v-model="draft.referenceCode" />
        </t-form-item>
        <t-form-item label="争议摘要">
          <t-textarea v-model="draft.disputeSummary" />
        </t-form-item>
        <t-form-item
          v-if="draft.entryKind === 'release'"
          label="解决依据"
        >
          <t-textarea v-model="draft.resolutionBasisSummary" />
        </t-form-item>
        <t-form-item label="真实依据文件">
          <t-upload
            v-model="evidenceFiles"
            theme="file-flow"
            :auto-upload="false"
            :multiple="false"
          />
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
.dispute-workbench,
.draft-form,
.panel {
  display: grid;
  gap: var(--jg-space-lg);
}

.dispute-workbench {
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
