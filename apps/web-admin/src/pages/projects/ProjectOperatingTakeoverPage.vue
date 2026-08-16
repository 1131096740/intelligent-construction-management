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
          :disabled="!precheckResult"
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
      />
    </t-card>

    <t-card
      v-if="detail"
      class="panel"
      title="批次行复核"
    >
      <div class="detail-head">
        <span>{{ detail.batchNo }} · {{ detail.status }} · 修订 {{ detail.revision }}</span>
        <div class="form-actions">
          <t-button
            v-if="canConfirmProfession('finance')"
            @click="confirm('finance')"
          >
            财务确认
          </t-button>
          <t-button
            v-if="canConfirmProfession('contract')"
            @click="confirm('contract')"
          >
            合同确认
          </t-button>
          <t-button
            v-if="canActivate"
            theme="primary"
            @click="activate"
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
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import {
  activateOperatingTakeover,
  confirmOperatingTakeover,
  createOperatingTakeoverBatch,
  downloadOperatingTakeoverTemplate,
  fetchOperatingTakeoverBatches,
  fetchOperatingTakeoverCapability,
  fetchOperatingTakeoverDetail,
  precheckOperatingTakeoverXlsx,
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
const pendingRows = ref<Array<{ sceneKey?: string; values: Record<string, unknown> }>>([]);
const precheckResult = ref<OperatingTakeoverPrecheckReadModel | null>(null);
const actions = ref<Record<string, boolean>>({});
const confirmationProfessions = ref<Record<OperatingTakeoverProfession, boolean>>({ contract: false, finance: false });
const loading = ref(false);
const loadingProjects = ref(false);
const submitting = ref(false);
const message = ref("");

const sceneOptions = computed(() => scenes.value.map((scene) => ({ label: scene.name, value: scene.key })));
const selectedScene = computed(() => scenes.value.find((scene) => scene.key === selectedSceneKey.value));
const canActivate = computed(() => actions.value.activate === true && detail.value?.status !== "activated");
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
  { colKey: "issues", title: "问题", minWidth: 260 }
];

onMounted(load);

watch([selectedProjectId, selectedSceneKey], () => {
  precheckResult.value = null;
  pendingRows.value = [];
  excelFiles.value = [];
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
    const values = JSON.parse(payloadText.value) as Array<Record<string, unknown>>;
    pendingRows.value = values.map((value) => ({ values: value }));
    precheckResult.value = await precheckOperatingTakeover(selectedProjectId.value, { sceneKey: selectedSceneKey.value, rows: pendingRows.value });
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
    precheckResult.value = await precheckOperatingTakeoverXlsx(selectedProjectId.value, raw, selectedSceneKey.value || undefined);
    pendingRows.value = precheckResult.value.rows.map((row) => ({ sceneKey: row.sceneKey, values: row.values }));
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
    detail.value = await createOperatingTakeoverBatch(selectedProjectId.value, { sceneKey: selectedSceneKey.value, rows: pendingRows.value });
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

async function confirm(profession: OperatingTakeoverProfession) {
  if (!detail.value) return;
  await confirmOperatingTakeover(selectedProjectId.value, detail.value.id, { profession, expectedRevision: detail.value.revision, idempotencyKey: crypto.randomUUID() });
  detail.value = await fetchOperatingTakeoverDetail(selectedProjectId.value, detail.value.id);
}

async function activate() {
  if (!detail.value) return;
  await activateOperatingTakeover(selectedProjectId.value, detail.value.id, crypto.randomUUID());
  detail.value = await fetchOperatingTakeoverDetail(selectedProjectId.value, detail.value.id);
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
</script>

<style scoped>
.operating-takeover-page { display: grid; gap: 16px; min-width: 0; }
.page-head, .detail-head, .actions, .form-actions, .filters { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.page-head { align-items: flex-start; }
.page-eyebrow { color: var(--td-text-color-secondary); font-size: 12px; }
h1 { margin: 4px 0; font-size: 22px; }
.page-head p, .scene-description { margin: 0; color: var(--td-text-color-secondary); }
.filters { justify-content: flex-start; align-items: flex-end; }
.filters label { min-width: min(360px, 100%); display: grid; gap: 6px; color: var(--td-text-color-secondary); font-size: 12px; }
.form-actions { justify-content: flex-start; margin-top: 12px; }
.precheck-result { margin-top: 12px; }
@media (max-width: 720px) { .page-head, .detail-head { align-items: stretch; } .actions, .actions .t-button { width: 100%; } .filters label { min-width: 100%; } }
</style>
