<template>
  <section class="operating-takeover-page jg-responsive-detail">
    <div class="page-head">
      <div>
        <span class="page-eyebrow">项目经营</span>
        <h1>历史经营接管</h1>
        <p>先预检、再整批生成草稿；A/B 资料进入经营账，C 级资料仅登记历史缺口。</p>
      </div>
      <div class="actions">
        <t-button
          :loading="loading"
          @click="load"
        >
          刷新
        </t-button>
        <t-button
          theme="primary"
          :disabled="!selectedProjectId"
          @click="downloadTemplate"
        >
          下载组合模板
        </t-button>
      </div>
    </div>

    <t-alert
      v-if="message"
      theme="error"
      :close="false"
    >
      {{ message }}
    </t-alert>

    <t-card
      class="panel"
      title="项目与场景"
    >
      <div class="filters">
        <label>
          <span>项目</span>
          <t-select
            v-model="selectedProjectId"
            :options="projectOptions"
            :loading="loadingProjects"
            @change="loadProject"
          />
        </label>
        <label>
          <span>接管场景</span>
          <t-select
            v-model="selectedSceneKey"
            :options="sceneOptions"
            :disabled="!selectedProjectId"
          />
        </label>
      </div>
      <p
        v-if="selectedScene"
        class="scene-description"
      >
        {{ selectedScene.description }}
      </p>
    </t-card>

    <t-card
      v-if="selectedProjectId"
      class="panel"
      title="页面录入 / 粘贴 / Excel 预检"
    >
      <t-textarea
        v-model="payloadText"
        :autosize="{ minRows: 5, maxRows: 12 }"
        placeholder="粘贴 JSON 数组，例如：[{&quot;businessRef&quot;:&quot;历史-001&quot;,...}]"
      />
      <div class="form-actions">
        <t-button
          variant="outline"
          :disabled="!selectedSceneKey"
          @click="openDraftCreate"
        >
          新增页面业务行
        </t-button>
        <span class="helper-text">可直接录入多行，也可以继续粘贴 JSON 或上传 Excel。</span>
      </div>
      <t-table
        v-if="draftRows.length"
        :columns="draftColumns"
        :data="draftRows"
        size="small"
        class="draft-table"
      >
        <template #sceneKey="{ row }">
          {{ sceneLabel(row.sceneKey) }}
        </template>
        <template #businessRef="{ row }">
          {{ String(row.values.businessRef ?? "—") }}
        </template>
        <template #occurredAt="{ row }">
          {{ String(row.values.occurredAt ?? "—") }}
        </template>
        <template #amountYuan="{ row }">
          {{ String(row.values.amountYuan ?? "—") }}
        </template>
        <template #actions="{ rowIndex }">
          <t-space>
            <t-link @click="openDraftEdit(rowIndex)">编辑</t-link>
            <t-link theme="danger" @click="removeDraftRow(rowIndex)">删除</t-link>
          </t-space>
        </template>
      </t-table>
      <t-upload
        :model-value="excelFiles"
        theme="file-flow"
        :multiple="false"
        :auto-upload="false"
        accept=".xlsx"
        :size-limit="{ size: 10 * 1024 * 1024, unit: 'B' }"
        @update:model-value="excelFiles = $event"
      />
      <div class="form-actions">
        <t-button
          :loading="submitting"
          @click="precheck"
        >
          预检（零写入）
        </t-button>
        <t-button
          :loading="submitting"
          :disabled="!excelFiles.length"
          @click="precheckExcel"
        >
          Excel 预检（零写入）
        </t-button>
        <t-button
          theme="primary"
          :loading="submitting"
          :disabled="!precheckResult || !canCreate"
          @click="createBatch"
        >
          生成整批草稿
        </t-button>
      </div>
      <t-alert
        v-if="precheckResult"
        theme="info"
        :close="false"
        class="precheck-result"
      >
        预检结果：{{ precheckResult.summary?.totalRows ?? 0 }} 行，阻断 {{ precheckResult.summary?.blockedRows ?? 0 }} 行，警告 {{ precheckResult.summary?.warningRows ?? 0 }} 行。
      </t-alert>
    </t-card>

    <t-card
      v-if="selectedProjectId"
      class="panel"
      title="接管批次"
    >
      <t-table
        row-key="id"
        :columns="batchColumns"
        :data="batches"
        :loading="loading"
        size="small"
        empty="暂无历史经营接管批次"
        @row-click="openBatch"
      >
        <template #status="{ row }">
          {{ batchStatusLabel(row.status) }}
        </template>
      </t-table>
    </t-card>

    <t-card
      v-if="detail"
      class="panel"
      title="批次行复核"
    >
      <div class="detail-head">
        <span>{{ detail.batchNo }} · {{ batchStatusLabel(detail.status) }} · 修订 {{ detail.revision }}</span>
        <div class="form-actions">
          <t-button
            v-if="canConfirmProfession('finance')"
            @click="requestConfirm('finance')"
          >
            财务确认
          </t-button>
          <t-button
            v-if="canConfirmProfession('contract')"
            @click="requestConfirm('contract')"
          >
            合同确认
          </t-button>
          <t-button
            v-if="canActivate"
            theme="primary"
            @click="requestActivate"
          >
            激活批次
          </t-button>
        </div>
      </div>
      <t-table
        row-key="id"
        :columns="rowColumns"
        :data="detail.rows"
        size="small"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无接管行"
      >
        <template #sceneKey="{ row }">
          {{ sceneLabel(row.sceneKey) }}
        </template>
        <template #values="{ row }">
          {{ String(row.values.businessRef ?? "—") }}
        </template>
        <template #amountYuan="{ row }">
          {{ row.amountYuan ?? "—" }}
        </template>
        <template #issues="{ row }">
          {{ issueMessages(row) }}
        </template>
        <template #evidenceLevel="{ row }">
          {{ evidenceLabel(row.evidenceLevel) }}
        </template>
        <template #reviewStatus="{ row }">
          {{ reviewStatusLabel(row.reviewStatus) }}
        </template>
        <template #actions="{ row }">
          <t-space>
            <t-link :disabled="detail.status === 'activated'" @click="openRowEdit(row)">编辑</t-link>
            <t-link :disabled="detail.status === 'activated'" @click="selectAttachmentTarget(row)">附件</t-link>
          </t-space>
        </template>
      </t-table>
      <t-card
        class="attachment-panel"
        title="批次附件与证据来源"
        :bordered="false"
      >
        <p class="helper-text">原始 Excel 已绑定到批次；可继续补充批次或具体行的依据文件。附件只保存文件关联，不把附件文件名写入 Excel 字段。</p>
        <div class="attachment-form">
          <div v-if="attachmentTargetRow" class="attachment-target">
            当前附件目标：第 {{ attachmentTargetRow.rowNo }} 行 · {{ String(attachmentTargetRow.values.businessRef ?? "—") }}
            <t-link @click="clearAttachmentTarget">改为批次附件</t-link>
          </div>
          <t-input v-model="attachmentPurpose" placeholder="附件用途，例如：付款凭据、对账单" />
          <t-upload
            :model-value="attachmentFiles"
            theme="file-flow"
            :multiple="true"
            :auto-upload="false"
            @update:model-value="attachmentFiles = $event"
          />
          <t-button
            :loading="actionSubmitting"
            :disabled="!attachmentPurpose.trim() || !attachmentFiles.length"
            @click="attachFiles"
          >
            {{ attachmentTargetRow ? "关联到当前行" : "关联到批次" }}
          </t-button>
        </div>
        <ul v-if="detail.rows.some((row) => row.attachmentGroups.length)" class="attachment-list">
          <li v-for="group in detail.rows.flatMap((row) => row.attachmentGroups)" :key="group.id">
            {{ group.purpose }} · {{ group.links.length }} 份文件
          </li>
        </ul>
      </t-card>
    </t-card>
  </section>

  <t-dialog
    v-model:visible="draftDialogVisible"
    :header="draftRowIndex === null ? '新增页面业务行' : '编辑页面业务行'"
    width="min(720px, 94vw)"
    :confirm-btn="{ content: '保存行', loading: actionSubmitting }"
    @confirm="saveDraftRow"
  >
    <t-form label-align="top">
      <t-form-item label="接管场景">
        <t-select v-model="draftSceneKey" :options="sceneOptions" :disabled="draftRowIndex !== null" />
      </t-form-item>
      <t-form-item v-for="field in draftScene?.fields ?? []" :key="field.key" :label="field.label">
        <t-textarea
          v-if="field.type === 'long_text'"
          v-model="draftValues[field.key]"
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <t-select
          v-else-if="field.type === 'single_select'"
          v-model="draftValues[field.key]"
          :options="field.options ?? []"
        />
        <t-date-picker
          v-else-if="field.type === 'date'"
          v-model="draftValues[field.key]"
        />
        <t-input v-else v-model="draftValues[field.key]" />
      </t-form-item>
    </t-form>
  </t-dialog>

  <t-dialog
    v-model:visible="rowEditDialogVisible"
    header="编辑接管批次行"
    width="min(720px, 94vw)"
    :confirm-btn="{ content: '保存复核行', loading: actionSubmitting }"
    @confirm="saveRowEdit"
  >
    <t-form label-align="top">
      <t-form-item v-for="field in editingScene?.fields ?? []" :key="field.key" :label="field.label">
        <t-textarea
          v-if="field.type === 'long_text'"
          v-model="editingValues[field.key]"
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <t-select
          v-else-if="field.type === 'single_select'"
          v-model="editingValues[field.key]"
          :options="field.options ?? []"
        />
        <t-date-picker
          v-else-if="field.type === 'date'"
          v-model="editingValues[field.key]"
        />
        <t-input v-else v-model="editingValues[field.key]" />
      </t-form-item>
      <t-form-item label="重复说明">
        <t-input v-model="editingDuplicateNote" />
      </t-form-item>
      <t-form-item label="复核结论">
        <t-textarea v-model="editingReviewConclusion" :autosize="{ minRows: 2, maxRows: 4 }" />
      </t-form-item>
    </t-form>
  </t-dialog>

  <t-dialog
    v-model:visible="confirmationDialogVisible"
    header="确认专业复核"
    :confirm-btn="{ content: '确认提交', loading: actionSubmitting }"
    @confirm="confirm"
  >
    <t-alert theme="warning" :close="false">
      本次将以当前批次修订版本提交{{ professionLabel(confirmationProfession) }}确认；提交后如需修改行，必须重新复核。
    </t-alert>
  </t-dialog>

  <t-dialog
    v-model:visible="activationDialogVisible"
    header="确认激活历史经营接管"
    :confirm-btn="{ content: '确认激活', loading: actionSubmitting }"
    @confirm="activate"
  >
    <t-alert theme="warning" :close="false">
      激活后 A/B 级行将写入正式经营账，C 级行只保留为历史缺口；已激活原始行不能直接修改。
    </t-alert>
  </t-dialog>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import {
  activateOperatingTakeover,
  addOperatingTakeoverAttachmentGroup,
  confirmOperatingTakeover,
  createOperatingTakeoverBatch,
  downloadOperatingTakeoverTemplate,
  fetchOperatingTakeoverBatches,
  fetchOperatingTakeoverCapability,
  fetchOperatingTakeoverDetail,
  precheckOperatingTakeoverXlsx,
  updateOperatingTakeoverRow,
  uploadOperatingTakeoverSourceFile,
  type OperatingTakeoverBatchReadModel,
  type OperatingTakeoverDetailReadModel,
  type OperatingTakeoverPrecheckReadModel,
  type OperatingTakeoverProfession,
  type OperatingTakeoverRowReadModel,
  type OperatingTakeoverSceneReadModel,
  precheckOperatingTakeover
} from "../../api/operating-takeover.api";

const projectOptions = ref<Array<{ label: string; value: string }>>([]);
const projects = ref<ProjectOptionReadModel[]>([]);
const scenes = ref<OperatingTakeoverSceneReadModel[]>([]);
const batches = ref<OperatingTakeoverBatchReadModel[]>([]);
const detail = ref<OperatingTakeoverDetailReadModel | null>(null);
const selectedProjectId = ref("");
const selectedSceneKey = ref("");
const payloadText = ref("[]");
const excelFiles = ref<UploadFile[]>([]);
const pendingSourceFile = ref<File | null>(null);
const pendingSceneKey = ref<string | undefined>();
const draftRows = ref<Array<{ sceneKey: string; values: Record<string, unknown> }>>([]);
const pendingRows = ref<Array<{ sceneKey?: string; values: Record<string, unknown> }>>([]);
const precheckResult = ref<OperatingTakeoverPrecheckReadModel | null>(null);
const actions = ref<Record<string, boolean>>({});
const confirmationProfessions = ref<Record<OperatingTakeoverProfession, boolean>>({ contract: false, finance: false });
const loading = ref(false);
const loadingProjects = ref(false);
const submitting = ref(false);
const message = ref("");
const draftDialogVisible = ref(false);
const draftRowIndex = ref<number | null>(null);
const draftSceneKey = ref("");
const draftValues = ref<Record<string, string>>({});
const rowEditDialogVisible = ref(false);
const editingRow = ref<OperatingTakeoverRowReadModel | null>(null);
const editingValues = ref<Record<string, string>>({});
const editingReviewConclusion = ref("");
const attachmentFiles = ref<UploadFile[]>([]);
const attachmentPurpose = ref("");
const attachmentTargetRowId = ref<string | null>(null);
const confirmationDialogVisible = ref(false);
const confirmationProfession = ref<OperatingTakeoverProfession>("finance");
const activationDialogVisible = ref(false);
const actionSubmitting = ref(false);

const sceneOptions = computed(() => scenes.value.map((scene) => ({ label: scene.name, value: scene.key })));
const selectedScene = computed(() => scenes.value.find((scene) => scene.key === selectedSceneKey.value));
const canActivate = computed(() => actions.value.activate === true && detail.value?.status !== "activated");
const canCreate = computed(() => actions.value.create === true);
const draftScene = computed(() => scenes.value.find((scene) => scene.key === draftSceneKey.value));
const editingScene = computed(() => scenes.value.find((scene) => scene.key === editingRow.value?.sceneKey));
const attachmentTargetRow = computed(() => detail.value?.rows.find((row) => row.id === attachmentTargetRowId.value) ?? null);
const batchColumns = [
  { colKey: "batchNo", title: "批次编号", minWidth: 180 },
  { colKey: "status", title: "状态", width: 120 },
  { colKey: "totalRows", title: "总行数", width: 90 },
  { colKey: "blockedRows", title: "阻断", width: 90 },
  { colKey: "warningRows", title: "警告", width: 90 }
];
const rowColumns = [
  { colKey: "rowNo", title: "行", width: 60 },
  { colKey: "sceneKey", title: "场景", minWidth: 160 },
  { colKey: "values", title: "业务编号", minWidth: 150 },
  { colKey: "occurredAt", title: "发生日期", width: 120 },
  { colKey: "amountYuan", title: "金额（元）", width: 120 },
  { colKey: "evidenceLevel", title: "证据", width: 80 },
  { colKey: "reviewStatus", title: "复核", width: 90 },
  { colKey: "issues", title: "问题", minWidth: 260 },
  { colKey: "actions", title: "操作", width: 100 }
];
const draftColumns = [
  { colKey: "sceneKey", title: "场景", minWidth: 160 },
  { colKey: "businessRef", title: "业务整理编号", minWidth: 150 },
  { colKey: "occurredAt", title: "发生日期", width: 120 },
  { colKey: "amountYuan", title: "金额（元）", width: 120 },
  { colKey: "actions", title: "操作", width: 120 }
];

onMounted(load);

watch([selectedProjectId, selectedSceneKey], () => {
  precheckResult.value = null;
  pendingRows.value = [];
  excelFiles.value = [];
  pendingSourceFile.value = null;
  pendingSceneKey.value = undefined;
  draftRows.value = [];
});

async function load() {
  loadingProjects.value = true;
  message.value = "";
  try {
    projects.value = await fetchProjects();
    projectOptions.value = projects.value.map((project) => ({ label: `${project.code} · ${project.name}`, value: project.id }));
    if (!selectedProjectId.value && projectOptions.value[0]) selectedProjectId.value = projectOptions.value[0].value;
    if (selectedProjectId.value) await loadProject();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载历史经营接管失败";
  } finally {
    loadingProjects.value = false;
  }
}

async function loadProject() {
  if (!selectedProjectId.value) return;
  loading.value = true;
  try {
    const capability = await fetchOperatingTakeoverCapability(selectedProjectId.value);
    scenes.value = capability.scenes;
    actions.value = capability.actions;
    confirmationProfessions.value = capability.confirmationProfessions;
    if (!scenes.value.some((scene) => scene.key === selectedSceneKey.value)) selectedSceneKey.value = scenes.value[0]?.key ?? "";
    batches.value = await fetchOperatingTakeoverBatches(selectedProjectId.value);
    detail.value = null;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载历史经营接管场景失败";
  } finally {
    loading.value = false;
  }
}

async function precheck() {
  try {
    submitting.value = true;
    const values = draftRows.value.length
      ? draftRows.value
      : (JSON.parse(payloadText.value) as Array<Record<string, unknown>>).map((value) => ({ sceneKey: selectedSceneKey.value, values: value }));
    draftRows.value = values.map((row) => ({ sceneKey: row.sceneKey ?? selectedSceneKey.value, values: row.values }));
    pendingRows.value = values.map((row) => ({ sceneKey: row.sceneKey, values: row.values }));
    pendingSceneKey.value = selectedSceneKey.value || undefined;
    pendingSourceFile.value = null;
    precheckResult.value = await precheckOperatingTakeoverWithCapability(selectedProjectId.value, { sceneKey: selectedSceneKey.value, rows: pendingRows.value });
    message.value = "";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "预检失败";
  } finally {
    submitting.value = false;
  }
}

async function precheckExcel() {
  const raw = excelFiles.value[0]?.raw;
  if (!(raw instanceof File)) {
    message.value = "请选择 Excel 文件后再预检";
    return;
  }
  try {
    submitting.value = true;
    precheckResult.value = await precheckOperatingTakeoverXlsxWithCapability(selectedProjectId.value, raw);
    pendingRows.value = precheckResult.value.rows.map((row) => ({ sceneKey: row.sceneKey, values: row.values }));
    pendingSceneKey.value = undefined;
    pendingSourceFile.value = raw;
    message.value = "";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Excel 预检失败";
  } finally {
    submitting.value = false;
  }
}

async function createBatch() {
  if (!precheckResult.value) return;
  try {
    submitting.value = true;
    if (!pendingRows.value.length) return;
    const sourceFileId = pendingSourceFile.value
      ? (await uploadOperatingTakeoverFileWithCapability(selectedProjectId.value, pendingSourceFile.value)).id
      : undefined;
    detail.value = await createOperatingTakeoverBatchWithCapability(selectedProjectId.value, {
      ...(pendingSceneKey.value ? { sceneKey: pendingSceneKey.value } : {}),
      ...(sourceFileId ? { sourceFileId } : {}),
      rows: pendingRows.value
    });
    pendingSourceFile.value = null;
    batches.value = await fetchOperatingTakeoverBatches(selectedProjectId.value);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "生成批次失败";
  } finally {
    submitting.value = false;
  }
}

async function openBatch({ row }: { row: OperatingTakeoverBatchReadModel }) {
  detail.value = await fetchOperatingTakeoverDetail(selectedProjectId.value, row.id);
}

function canConfirmProfession(profession: OperatingTakeoverProfession) {
  return actions.value.confirm === true && confirmationProfessions.value[profession] === true && detail.value?.status !== "activated";
}

function requestConfirm(profession: OperatingTakeoverProfession) {
  confirmationProfession.value = profession;
  confirmationDialogVisible.value = true;
}

async function confirm() {
  if (!detail.value) return;
  try {
    actionSubmitting.value = true;
    await confirmOperatingTakeoverWithCapability(selectedProjectId.value, detail.value.id, { profession: confirmationProfession.value, expectedRevision: detail.value.revision, idempotencyKey: crypto.randomUUID() });
    detail.value = await fetchOperatingTakeoverDetail(selectedProjectId.value, detail.value.id);
    confirmationDialogVisible.value = false;
    message.value = "专业确认已提交";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "专业确认失败";
  } finally {
    actionSubmitting.value = false;
  }
}

function requestActivate() {
  activationDialogVisible.value = true;
}

async function activate() {
  if (!detail.value) return;
  try {
    actionSubmitting.value = true;
    await activateOperatingTakeoverWithCapability(selectedProjectId.value, detail.value.id, crypto.randomUUID());
    detail.value = await fetchOperatingTakeoverDetail(selectedProjectId.value, detail.value.id);
    batches.value = await fetchOperatingTakeoverBatches(selectedProjectId.value);
    activationDialogVisible.value = false;
    message.value = "历史经营接管批次已激活";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "激活历史经营接管失败";
  } finally {
    actionSubmitting.value = false;
  }
}

function openDraftCreate() {
  draftRowIndex.value = null;
  draftSceneKey.value = selectedSceneKey.value;
  draftValues.value = {};
  draftDialogVisible.value = true;
}

function openDraftEdit(rowIndex: number) {
  const row = draftRows.value[rowIndex];
  if (!row) return;
  draftRowIndex.value = rowIndex;
  draftSceneKey.value = row.sceneKey;
  draftValues.value = stringValues(row.values);
  draftDialogVisible.value = true;
}

function saveDraftRow() {
  if (!draftSceneKey.value) {
    message.value = "请选择接管场景";
    return;
  }
  const row = { sceneKey: draftSceneKey.value, values: nonEmptyValues(draftValues.value) };
  if (draftRowIndex.value === null) draftRows.value.push(row);
  else draftRows.value.splice(draftRowIndex.value, 1, row);
  payloadText.value = JSON.stringify(draftRows.value.map((item) => item.values), null, 2);
  precheckResult.value = null;
  pendingRows.value = [];
  draftDialogVisible.value = false;
}

function removeDraftRow(rowIndex: number) {
  draftRows.value.splice(rowIndex, 1);
  precheckResult.value = null;
  pendingRows.value = [];
}

function openRowEdit(row: OperatingTakeoverRowReadModel) {
  editingRow.value = row;
  editingValues.value = stringValues(row.values);
  editingDuplicateNote.value = row.duplicateNote ?? "";
  editingReviewConclusion.value = row.reviewConclusion ?? "";
  rowEditDialogVisible.value = true;
}

function selectAttachmentTarget(row: OperatingTakeoverRowReadModel) {
  attachmentTargetRowId.value = row.id;
}

function clearAttachmentTarget() {
  attachmentTargetRowId.value = null;
}

const editingDuplicateNote = ref("");

async function saveRowEdit() {
  if (!detail.value || !editingRow.value) return;
  try {
    actionSubmitting.value = true;
    const capability = await fetchOperatingTakeoverCapability(selectedProjectId.value);
    if (capability.projectId !== selectedProjectId.value || !capability.availableActions.includes("manage")) {
      throw new Error("当前用户不能编辑历史经营接管行");
    }
    detail.value = await updateOperatingTakeoverRowWithCapability(selectedProjectId.value, detail.value.id, editingRow.value.id, {
      expectedRevision: editingRow.value.revision,
      values: nonEmptyValues(editingValues.value),
      duplicateNote: editingDuplicateNote.value.trim() || undefined,
      reviewConclusion: editingReviewConclusion.value.trim() || undefined
    });
    batches.value = await fetchOperatingTakeoverBatches(selectedProjectId.value);
    rowEditDialogVisible.value = false;
    message.value = "接管行已保存，专业确认需要重新提交";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "保存接管行失败";
  } finally {
    actionSubmitting.value = false;
  }
}

async function attachFiles() {
  if (!detail.value) return;
  const files = attachmentFiles.value.map((item) => item.raw).filter((file): file is File => file instanceof File);
  if (!files.length || !attachmentPurpose.value.trim()) return;
  try {
    actionSubmitting.value = true;
    const capability = await fetchOperatingTakeoverCapability(selectedProjectId.value);
    if (capability.projectId !== selectedProjectId.value || !capability.availableActions.includes("file_upload")) {
      throw new Error("当前用户不能上传或关联历史经营接管附件");
    }
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadOperatingTakeoverFileWithCapability(selectedProjectId.value, file));
    await addOperatingTakeoverAttachmentGroupWithCapability(selectedProjectId.value, detail.value.id, {
      purpose: attachmentPurpose.value.trim(),
      fileIds: uploaded.map((file) => file.id),
      ...(attachmentTargetRowId.value ? { rowId: attachmentTargetRowId.value } : {})
    });
    detail.value = await fetchOperatingTakeoverDetail(selectedProjectId.value, detail.value.id);
    attachmentFiles.value = [];
    attachmentPurpose.value = "";
    attachmentTargetRowId.value = null;
    message.value = "附件已关联到接管批次";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "关联附件失败";
  } finally {
    actionSubmitting.value = false;
  }
}

function stringValues(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]));
}

function nonEmptyValues(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ""));
}

async function precheckOperatingTakeoverWithCapability(
  projectId: string,
  body: Parameters<typeof precheckOperatingTakeover>[1]
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("manage");
  if (!operationAllowed) throw new Error("当前用户不能预检历史经营接管");
  return precheckOperatingTakeover(projectId, body);
}

async function precheckOperatingTakeoverXlsxWithCapability(
  projectId: string,
  file: File,
  sceneKey?: string
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("manage");
  if (!operationAllowed) throw new Error("当前用户不能预检历史经营接管 Excel");
  return precheckOperatingTakeoverXlsx(projectId, file, sceneKey);
}

async function createOperatingTakeoverBatchWithCapability(
  projectId: string,
  body: Parameters<typeof createOperatingTakeoverBatch>[1]
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("manage");
  if (!operationAllowed) throw new Error("当前用户不能生成历史经营接管批次");
  return createOperatingTakeoverBatch(projectId, body);
}

async function confirmOperatingTakeoverWithCapability(
  projectId: string,
  batchId: string,
  body: Parameters<typeof confirmOperatingTakeover>[2]
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("confirm");
  if (!operationAllowed) throw new Error("当前用户不能确认历史经营接管");
  return confirmOperatingTakeover(projectId, batchId, body);
}

async function activateOperatingTakeoverWithCapability(
  projectId: string,
  batchId: string,
  idempotencyKey: string
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("activate");
  if (!operationAllowed) throw new Error("当前用户不能激活历史经营接管");
  return activateOperatingTakeover(projectId, batchId, idempotencyKey);
}

async function uploadOperatingTakeoverFileWithCapability(projectId: string, file: File) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("file_upload");
  if (!operationAllowed) throw new Error("当前用户不能上传历史经营接管附件");
  return uploadOperatingTakeoverSourceFile(projectId, file);
}

async function updateOperatingTakeoverRowWithCapability(
  projectId: string,
  batchId: string,
  rowId: string,
  body: Parameters<typeof updateOperatingTakeoverRow>[3]
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("manage");
  if (!operationAllowed) throw new Error("当前用户不能编辑历史经营接管行");
  return updateOperatingTakeoverRow(projectId, batchId, rowId, body);
}

async function addOperatingTakeoverAttachmentGroupWithCapability(
  projectId: string,
  batchId: string,
  body: Parameters<typeof addOperatingTakeoverAttachmentGroup>[2]
) {
  const capability = await fetchOperatingTakeoverCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("历史经营接管项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("file_upload");
  if (!operationAllowed) throw new Error("当前用户不能关联历史经营接管附件");
  return addOperatingTakeoverAttachmentGroup(projectId, batchId, body);
}

async function downloadTemplate() {
  const blob = await downloadOperatingTakeoverTemplate(selectedProjectId.value);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "历史经营接管-组合导入模板.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}

function sceneLabel(key: string) {
  return scenes.value.find((scene) => scene.key === key)?.name ?? key;
}

function issueMessages(row: OperatingTakeoverRowReadModel) {
  return row.issues.map((issue) => issue.message).join("；") || "通过";
}

function batchStatusLabel(status: string) {
  return { draft: "草稿", under_review: "待复核", activated: "已激活" }[status as "draft" | "under_review" | "activated"] ?? "待识别状态";
}

function reviewStatusLabel(status: string) {
  return { pending: "待复核", accepted: "已接受", blocked: "已阻断", activated: "已激活" }[status as "pending" | "accepted" | "blocked" | "activated"] ?? "待识别状态";
}

function evidenceLabel(level: string | null) {
  return { A: "A 级", B: "B 级", C: "C 级" }[level ?? ""] ?? "未评级";
}

function professionLabel(profession: OperatingTakeoverProfession) {
  return profession === "contract" ? "合同专业" : "财务专业";
}
</script>

<style scoped>
.operating-takeover-page { display: grid; gap: var(--jg-space-lg); min-width: 0; }
.page-head, .detail-head, .actions, .form-actions, .filters { display: flex; gap: var(--jg-space-md); align-items: center; justify-content: space-between; flex-wrap: wrap; }
.page-head { align-items: flex-start; }
.page-eyebrow { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
h1 { margin: var(--jg-space-xs) 0; font-size: var(--jg-font-size-page-title); }
.page-head p, .scene-description { margin: 0; color: var(--td-text-color-secondary); }
.filters { justify-content: flex-start; align-items: flex-end; }
.filters label { min-width: var(--jg-layout-list-filter-field-min-width); display: grid; gap: var(--jg-space-xs); color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.form-actions { justify-content: flex-start; margin-top: var(--jg-space-md); }
.precheck-result { margin-top: var(--jg-space-md); }
.helper-text { margin: 0; color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.draft-table, .attachment-panel { margin-top: var(--jg-space-md); }
.attachment-form { display: grid; gap: var(--jg-space-sm); }
.attachment-target { display: flex; gap: var(--jg-space-sm); align-items: center; color: var(--jg-color-text-secondary); font-size: var(--jg-font-size-meta); }
.attachment-list { display: grid; gap: var(--jg-space-xs); margin: var(--jg-space-md) 0 0; padding-left: var(--jg-space-lg); color: var(--jg-color-text-secondary); }
@media (max-width: 720px) { .page-head, .detail-head { align-items: stretch; } .actions, .actions .t-button { width: 100%; } .filters label { min-width: 100%; } }
</style>
