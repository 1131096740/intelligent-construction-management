<template>
  <section class="page jg-responsive-workspace">
    <header class="page-head">
      <div>
        <h1>版式模板治理</h1>
        <p>多人编辑时，系统会阻止覆盖他人保存的内容；更换源文件后，旧检查和旧预览自动失效。</p>
      </div>
      <t-space
        v-if="currentVersion"
        class="jg-responsive-actions"
      >
        <t-button
          v-if="governance.canSubmit"
          :disabled="!inspectionCurrent || !mappingConfirmed"
          @click="submitCurrent"
        >
          提交审核
        </t-button>
        <t-button
          v-if="governance.canPublish"
          theme="primary"
          :disabled="!canPublish"
          @click="publishCurrent"
        >
          发布版式
        </t-button>
        <t-button
          v-if="governance.canClone"
          theme="primary"
          @click="cloneCurrent"
        >
          复制为新草稿
        </t-button>
        <t-button
          v-if="riskStopCandidateAction"
          theme="danger"
          variant="outline"
          :disabled="!riskStopCandidateAction.enabled || riskStopLoading"
          :title="riskStopCandidateAction.disabledReason ?? undefined"
          @click="openRiskStopDialog"
        >
          {{ riskStopCandidateAction.label }}
        </t-button>
      </t-space>
    </header>

    <t-alert
      v-if="message"
      :theme="tone === 'success' ? 'success' : 'error'"
      :message="message"
      class="panel"
      close
      @close="message = ''"
    />

    <t-card
      title="版式与版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <t-form-item label="版式名称">
          <t-input
            v-model="form.name"
            :readonly="!isCreateMode"
            placeholder="请输入版式名称"
          />
        </t-form-item>
        <t-form-item label="合同类型">
          <t-select
            v-model="form.contractTypeKey"
            :disabled="!isCreateMode"
          >
            <t-option
              v-for="option in contractTypeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </t-select>
        </t-form-item>
        <t-form-item
          v-if="!isCreateMode"
          label="治理版本"
        >
          <t-select
            v-model="selectedVersionId"
            @change="selectVersion"
          >
            <t-option
              v-for="version in versions"
              :key="version.id"
              :label="`V${version.versionNo} · ${layoutStatusLabel(version.status)}`"
              :value="version.id"
            />
          </t-select>
        </t-form-item>
        <t-form-item
          v-if="governance.canPublish"
          label="发布说明"
        >
          <t-input
            v-model="publicationSummary"
            placeholder="请填写本次版式发布内容"
          />
        </t-form-item>
        <div
          v-if="currentVersion"
          class="revision-summary"
        >
          <span>草稿修订</span>
          <strong>R{{ currentVersion.draftRevision }}</strong>
          <t-tag :theme="currentVersion.status === 'published' ? 'success' : 'default'">
            {{ layoutStatusLabel(currentVersion.status) }}
          </t-tag>
        </div>
      </div>

      <div class="source-row">
        <t-upload
          v-model="sourceFiles"
          theme="file-input"
          accept=".docx"
          :auto-upload="false"
          :max="1"
          :disabled="!isCreateMode && !governance.canSave"
          placeholder="请选择 DOCX 版式源文件"
        />
        <t-button
          v-if="isCreateMode && canMaintainTemplates"
          theme="primary"
          :loading="saving"
          @click="createLayout"
        >
          创建版式草稿
        </t-button>
        <t-button
          v-else-if="governance.canSave"
          theme="primary"
          :loading="saving"
          @click="saveDraftSource"
        >
          保存新修订
        </t-button>
      </div>
      <p class="warning">
        已发布版本不可覆盖。固定公司名称、联系人、账号等跨公司内容应改用占位符。
      </p>
    </t-card>

    <LayoutSourceMappingPanel
      v-if="currentVersion"
      ref="mappingPanel"
      :version-id="currentVersion.id"
      :revision="currentVersion.draftRevision"
      :editable="governance.canSave"
      :inspection-current="inspectionCurrent"
      :preview-succeeded="latestPreview?.status === 'succeeded' && !previewStale"
      :preview-job-id="latestPreview?.id"
      @changed="refreshDetail(currentVersion?.id)"
      @dirty-change="mappingDirty = $event"
      @confirmation-state="mappingConfirmed = $event"
    />

    <t-card
      title="占位符参考"
      :bordered="true"
      class="panel"
    >
      <div class="reference-list">
        <code
          v-for="item in placeholders"
          :key="item"
        >{{ item }}</code>
      </div>
    </t-card>

    <t-card
      v-if="currentVersion"
      title="检查与预览"
      :bordered="true"
      class="panel"
    >
      <t-alert
        v-if="!inspectionCurrent || previewStale"
        theme="warning"
        message="当前草稿已变化，请重新执行检查并生成当前修订的样张。"
        class="governance-alert"
      />
      <div class="inspection-workspace jg-workspace-scroll">
        <div class="split jg-workspace-scroll__content--compact">
          <div>
            <t-space>
              <t-button
                :disabled="!governance.canSave"
                @click="inspect"
              >
                执行文档检查
              </t-button>
              <t-tag :theme="inspectionCurrent ? 'success' : 'warning'">
                {{ inspectionCurrent ? `检查对应 R${currentVersion.draftRevision}` : "检查已过期" }}
              </t-tag>
            </t-space>
            <pre class="report">{{ inspectionText }}</pre>
          </div>
          <div>
            <p class="hint">
              样张使用主管输入的样例值，并绑定当前原文件、映射和修订。
            </p>
            <t-space class="actions">
              <t-button
                :disabled="!governance.canSave"
                @click="queuePreview"
              >
                生成当前修订样张
              </t-button>
              <t-button
                variant="outline"
                @click="loadPreview"
              >
                刷新预览状态
              </t-button>
            </t-space>
            <PrivatePdfActions
              v-if="latestPreview?.status === 'succeeded' && latestPreview.previewPdfFileId"
              :file-id="latestPreview.previewPdfFileId"
            />
            <div class="preview-summary">
              <span>最新预览：{{ previewStatus }}</span>
              <span v-if="latestPreview">源修订：R{{ latestPreview.sourceRevision }}</span>
            </div>
          </div>
        </div>
      </div>
    </t-card>
    <SensitiveActionDialog
      v-if="riskStopAction?.enabled"
      v-model="riskStopDialogVisible"
      :title="riskStopAction?.label ?? '风险停用'"
      description="风险停用后，该版式不再用于新合同文件；既有合同和已生成的文件仍保留原版式。"
      confirm-text="确认风险停用"
      confirm-theme="danger"
      :loading="riskStopLoading"
      :error="riskStopError"
      @confirm="stopCurrentVersion"
      @cancel="riskStopError = ''"
    />
    <SensitiveActionDialog
      v-model="leaveDialogVisible"
      title="放弃未保存的版式修改？"
      description="继续后会丢弃尚未上传保存的版式源文件和当前页面填写内容。"
      confirm-text="放弃并离开"
      confirm-theme="danger"
      @confirm="resolveLeaveDecision(true)"
      @cancel="resolveLeaveDecision(false)"
    />
  </section>
</template>

<script setup lang="ts">
import { formatUnknownApiError } from "../../api/error-message";
import LayoutSourceMappingPanel from "./LayoutSourceMappingPanel.vue";
import PrivatePdfActions from "../../components/files/PrivatePdfActions.vue";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import { getLayoutCreationCapability, getLayoutSourcePositions, getLayoutVersionMaintenanceCapability } from "../../api/contract-template-mapping.api";
import {
  cloneLayoutTemplateVersion,
  createLayoutTemplate,
  getLatestLayoutTemplatePreview,
  getLayoutTemplate,
  inspectLayoutTemplateVersion,
  type LayoutTemplateDetailReadModel,
  type LayoutTemplatePreviewReadModel,
  publishLayoutTemplateVersion,
  queueLayoutTemplatePreview,
  stopLayoutTemplateVersion,
  submitLayoutTemplateVersion,
  updateLayoutTemplateVersion
} from "../../api/contract-workbench.api";
import { templateStatusLabel } from "../contracts/contract-labels";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import { canPublishLayoutVersion, contractTypeOptions } from "./contract-template.config";

const mappingPanel = ref<InstanceType<typeof LayoutSourceMappingPanel> | null>(null);
const mappingDirty = ref(false);
const mappingConfirmed = ref(false);
const route = useRoute();
const router = useRouter();
const creationCapability = ref<{ canCreate: boolean } | null>(null);
const layoutTemplateRouteId = computed(() =>
  String(route.params.layoutTemplateId ?? "")
);
const form = reactive({ name: "", contractTypeKey: "" });
const layoutTemplateCapability = ref<LayoutTemplateDetailReadModel | null>(null);
const detail = ref<LayoutTemplateDetailReadModel | null>(null);
const selectedVersionId = ref("");
const sourceFiles = ref<UploadFile[]>([]);
const saving = ref(false);
const riskStopLoading = ref(false);
const riskStopDialogVisible = ref(false);
const riskStopError = ref("");
const riskStopVersionId = ref("");
const publicationSummary = ref("");
const message = ref("");
const tone = ref<"success" | "danger">("success");
const timer = ref<number | undefined>();
const editorBaseline = ref("");
const lastValidVersionId = ref("");
const leaveDialogVisible = ref(false);
const allowNavigation = ref(false);
let resolvePendingLeave: ((decision: boolean) => void) | null = null;
let layoutLoadGeneration = 0;
let layoutRouteGeneration = 0;
let riskStopOperationId = 0;

type RiskStopContext = {
  templateId: string;
  versionId: string;
  routeGeneration: number;
  operationId: number;
};
const isCreateMode = computed(() => layoutTemplateRouteId.value === "new");
const versions = computed(() => detail.value?.versions ?? []);
const currentVersion = computed(() =>
  versions.value.find((version) => version.id === selectedVersionId.value) ?? null
);
const riskStopCandidateAction = computed(() =>
  (layoutTemplateCapability.value?.versions
    .find((version) => version.id === selectedVersionId.value)?.availableActions ?? [])
    .find((action) => action.key === "risk_stop") ?? null
);
const riskStopAction = computed(() =>
  (layoutTemplateCapability.value?.versions
    .find((version) => version.id === riskStopVersionId.value)?.availableActions ?? [])
    .find((action) => action.key === "risk_stop") ?? null
);
const canMaintainTemplates = computed(() => creationCapability.value?.canCreate === true);
const governance = computed(() => ({
  canSave: currentVersion.value?.availableActions?.some(action => action.key === "save_draft" && action.enabled) === true,
  canInspect: currentVersion.value?.availableActions?.some(action => action.key === "inspect_source" && action.enabled) === true,
  canPreview: currentVersion.value?.availableActions?.some(action => action.key === "preview_source" && action.enabled) === true,
  canSubmit: currentVersion.value?.availableActions?.some(action => action.key === "submit_version" && action.enabled) === true,
  canPublish: currentVersion.value?.availableActions?.some(action => action.key === "publish_version" && action.enabled) === true,
  canClone: currentVersion.value?.availableActions?.some(action => action.key === "clone_version" && action.enabled) === true
}));
const latestPreview = computed<LayoutTemplatePreviewReadModel | null>(() =>
  currentVersion.value?.latestPreview ?? null
);
const inspectionCurrent = computed(() => Boolean(
  currentVersion.value?.inspectionReport &&
  currentVersion.value.inspectionRevision === currentVersion.value.draftRevision
));
const previewStale = computed(() => Boolean(
  latestPreview.value && latestPreview.value.sourceRevision !== currentVersion.value?.draftRevision
));
const canPublish = computed(() => canPublishLayoutVersion({
  draftRevision: currentVersion.value?.draftRevision,
  inspectionRevision: currentVersion.value?.inspectionRevision,
  inspectionReport: currentVersion.value?.inspectionReport,
  latestPreview: latestPreview.value
}));
const inspectionText = computed(() => formatInspectionReport(currentVersion.value?.inspectionReport ?? null));
const previewStatus = computed(() => {
  if (!latestPreview.value) return "尚未生成";
  if (previewStale.value || latestPreview.value.status === "stale") return "已过期";
  const labels: Record<LayoutTemplatePreviewReadModel["status"], string> = {
    queued: "等待生成",
    processing: "生成中",
    succeeded: "生成成功",
    failed: "生成失败",
    stale: "已过期"
  };
  return labels[latestPreview.value.status];
});
const placeholders = [
  "{合同名称}",
  "{草稿编号}",
  "{文档水印}",
  "{乙方名称}",
  "{交货地点}",
  "{#材料清单}{名称}{/材料清单}"
];
const isDirty = computed(() => mappingDirty.value || (Boolean(editorBaseline.value) && editorSnapshot() !== editorBaseline.value));
const leaveGuard = useUnsavedChangesGuard({
  isDirty: () => isDirty.value && !allowNavigation.value,
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingLeave?.(false);
    resolvePendingLeave = resolve;
    leaveDialogVisible.value = true;
  })
});

function editorSnapshot() {
  return JSON.stringify({
    name: form.name,
    contractTypeKey: form.contractTypeKey,
    sourceFiles: sourceFiles.value.map((file) => file.name),
    publicationSummary: publicationSummary.value
  });
}

function syncEditorBaseline() {
  editorBaseline.value = editorSnapshot();
  lastValidVersionId.value = selectedVersionId.value;
}

function resolveLeaveDecision(decision: boolean) {
  leaveDialogVisible.value = false;
  const resolve = resolvePendingLeave;
  resolvePendingLeave = null;
  resolve?.(decision);
}

async function selectVersion() {
  if (!(await leaveGuard.requestClose())) {
    selectedVersionId.value = lastValidVersionId.value;
    return;
  }
  clearTransientState();
  syncEditorBaseline();
}

function selectedFile() {
  const raw = sourceFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
}

async function createLayoutWithCapability(file: File, body: Omit<Parameters<typeof createLayoutTemplate>[0], "docxFileId">) {
  const capability = await getLayoutCreationCapability();
  const operationAllowed = capability.canCreate;
  if (!operationAllowed) throw new Error("当前账号不能新增合同模板");
  const uploaded = await uploadPrivateFile(file, file.name);
  return createLayoutTemplate({ ...body, docxFileId: uploaded.id });
}

async function saveDraftSourceWithCapability(versionId: string, file: File, revision: number) {
  const capability = await getLayoutSourcePositions(versionId);
  const operationAllowed = capability.availableActions.some(action => action.key === "save_draft" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许修改原文");
  const matchesRequestedVersion = capability.versionId === versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const matchesRequestedRevision = capability.draftRevision === revision;
  if (!matchesRequestedRevision) throw new Error("版式修订已变化，请刷新后重试");
  const uploaded = await uploadPrivateFile(file, file.name);
  return updateLayoutTemplateVersion(versionId, { expectedRevision: revision, docxFileId: uploaded.id });
}

async function inspectWithCapability(versionId: string, revision: number) {
  const capability = await getLayoutSourcePositions(versionId);
  const operationAllowed = capability.availableActions.some(action => action.key === "inspect_source" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许此操作，请刷新后重试");
  const matchesRequestedVersion = capability.versionId === versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const matchesRequestedRevision = capability.draftRevision === revision;
  if (!matchesRequestedRevision) throw new Error("版式版本已变化，请刷新后重试");
  return inspectLayoutTemplateVersion(versionId);
}

async function queuePreviewWithCapability(versionId: string, revision: number, body: Parameters<typeof queueLayoutTemplatePreview>[1]) {
  const capability = await getLayoutSourcePositions(versionId);
  const operationAllowed = capability.availableActions.some(action => action.key === "preview_source" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许此操作，请刷新后重试");
  const matchesRequestedVersion = capability.versionId === versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const matchesRequestedRevision = capability.draftRevision === revision;
  if (!matchesRequestedRevision) throw new Error("版式版本已变化，请刷新后重试");
  return queueLayoutTemplatePreview(versionId, body);
}

async function submitCurrentWithCapability(versionId: string, revision: number) {
  const capability = await getLayoutSourcePositions(versionId);
  const operationAllowed = capability.availableActions.some(action => action.key === "submit_version" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许此操作，请刷新后重试");
  const matchesRequestedVersion = capability.versionId === versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const matchesRequestedRevision = capability.draftRevision === revision;
  if (!matchesRequestedRevision) throw new Error("版式版本已变化，请刷新后重试");
  return submitLayoutTemplateVersion(versionId);
}

async function publishCurrentWithCapability(versionId: string, revision: number, body: Parameters<typeof publishLayoutTemplateVersion>[1]) {
  const capability = await getLayoutSourcePositions(versionId);
  const operationAllowed = capability.availableActions.some(action => action.key === "publish_version" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许此操作，请刷新后重试");
  const matchesRequestedVersion = capability.versionId === versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const matchesRequestedRevision = capability.draftRevision === revision;
  if (!matchesRequestedRevision) throw new Error("版式版本已变化，请刷新后重试");
  return publishLayoutTemplateVersion(versionId, body);
}

async function cloneCurrentWithCapability(versionId: string, revision: number) {
  const capability = await getLayoutSourcePositions(versionId);
  const operationAllowed = capability.availableActions.some(action => action.key === "clone_version" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许此操作，请刷新后重试");
  const matchesRequestedVersion = capability.versionId === versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const matchesRequestedRevision = capability.draftRevision === revision;
  if (!matchesRequestedRevision) throw new Error("版式版本已变化，请刷新后重试");
  return cloneLayoutTemplateVersion(versionId);
}

async function stopCurrentVersionWithCapability(context: RiskStopContext) {
  const capability = await getLayoutVersionMaintenanceCapability(context.versionId);
  if (!riskStopResultCanWrite(context)) return;
  const matchesRequestedVersion = capability.versionId === context.versionId;
  if (!matchesRequestedVersion) throw new Error("版式版本已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.some(action => action.key === "risk_stop" && action.enabled);
  if (!operationAllowed) throw new Error("当前版式不允许风险停用");
  return stopLayoutTemplateVersion(context.versionId);
}

async function createLayout() {
  if (!creationCapability.value?.canCreate) return showError("当前账号不能新增模板，请刷新后重试");
  const file = selectedFile();
  if (!file) return showError("请选择 DOCX 版式源文件");
  saving.value = true;
  try {
    const created = await createLayoutWithCapability(file, {
      name: form.name.trim(),
      contractTypeKey: form.contractTypeKey.trim(),
      placeholderSchema: { bills: [] }
    });
    allowNavigation.value = true;
    await router.replace(`/合同模板库/版式/${created.template.id}/维护`);
    allowNavigation.value = false;
    await refreshDetail(created.version.id);
    sourceFiles.value = [];
    syncEditorBaseline();
    showSuccess("版式草稿已创建");
  } catch (error) {
    showError(formatUnknownApiError(error, "创建失败"));
  } finally {
    allowNavigation.value = false;
    saving.value = false;
  }
}

async function saveDraftSource() {
  if (!governance.value.canSave) return showError("当前版式不允许此操作，请刷新后重试");
  const version = currentVersion.value;
  const file = selectedFile();
  if (!version || !file) return showError("请选择新的 DOCX 版式源文件");
  saving.value = true;
  try {
    await saveDraftSourceWithCapability(version.id, file, version.draftRevision);
    sourceFiles.value = [];
    await refreshDetail(version.id);
    showSuccess("新修订已保存，旧检查和旧预览已失效");
  } catch (error) {
    showError(formatUnknownApiError(error, "保存失败"));
  } finally {
    saving.value = false;
  }
}

async function inspect() {
  if (!governance.value.canInspect) return showError("当前版式不允许此操作，请刷新后重试");
  const version = currentVersion.value;
  if (!version) return;
  try {
    const report = await inspectWithCapability(version.id, version.draftRevision);
    version.inspectionReport = report;
    version.inspectionRevision = report.sourceRevision;
    showSuccess("检查完成");
  } catch (error) {
    showError(formatUnknownApiError(error, "检查失败"));
  }
}

async function queuePreview() {
  if (!governance.value.canPreview) return showError("当前版式不允许此操作，请刷新后重试");
  const version = currentVersion.value;
  if (!version) return;
  try {
    if (mappingDirty.value) throw new Error("请先保存填写位置，再生成样张");
    version.latestPreview = await queuePreviewWithCapability(version.id, version.draftRevision, mappingPanel.value?.previewSampleData() ?? {});
    mappingConfirmed.value = false;
    showSuccess("当前修订样张已进入队列");
    startPolling();
  } catch (error) {
    showError(formatUnknownApiError(error, "生成预览失败"));
  }
}

async function loadPreview() {
  const version = currentVersion.value;
  if (!version) return;
  try {
    version.latestPreview = await getLatestLayoutTemplatePreview(version.id);
    if (!["queued", "processing"].includes(version.latestPreview?.status ?? "")) {
      window.clearInterval(timer.value);
    }
  } catch (error) {
    showError(formatUnknownApiError(error, "读取预览失败"));
  }
}

async function submitCurrent() {
  if (!governance.value.canSubmit) return showError("当前版式不允许此操作，请刷新后重试");
  const version = currentVersion.value;
  if (!version) return;
  await runVersionAction(() => submitCurrentWithCapability(version.id, version.draftRevision), "版式已提交", version.id);
}

async function publishCurrent() {
  if (!governance.value.canPublish) return showError("当前版式不允许此操作，请刷新后重试");
  const version = currentVersion.value;
  if (!version) return;
  const changeSummary = publicationSummary.value.trim();
  if (!changeSummary) return showError("请填写本次版式发布说明");
  await runVersionAction(
    () => publishCurrentWithCapability(version.id, version.draftRevision, { changeSummary }),
    "版式已发布",
    version.id
  );
}

async function cloneCurrent() {
  if (!governance.value.canClone) return showError("当前版式不允许此操作，请刷新后重试");
  const version = currentVersion.value;
  if (!version) return;
  try {
    const cloned = await cloneCurrentWithCapability(version.id, version.draftRevision);
    await refreshDetail(cloned.id);
    showSuccess("已复制为新草稿，请在新草稿中修订");
  } catch (error) {
    showError(formatUnknownApiError(error, "复制失败"));
  }
}

function openRiskStopDialog() {
  const version = currentVersion.value;
  if (!version || !riskStopCandidateAction.value?.enabled || riskStopLoading.value) return;
  riskStopVersionId.value = version.id;
  riskStopError.value = "";
  riskStopDialogVisible.value = true;
}

function captureRiskStopContext(): RiskStopContext {
  return {
    templateId: layoutTemplateRouteId.value,
    versionId: riskStopVersionId.value,
    routeGeneration: layoutRouteGeneration,
    operationId: riskStopOperationId + 1
  };
}

function riskStopContextIsCurrent(context: RiskStopContext) {
  return Boolean(context.templateId && context.versionId) &&
    context.templateId === layoutTemplateRouteId.value &&
    context.versionId === riskStopVersionId.value &&
    context.versionId === selectedVersionId.value &&
    context.routeGeneration === layoutRouteGeneration;
}

function requireCurrentRiskStopContext(context: RiskStopContext) {
  if (!riskStopContextIsCurrent(context)) {
    throw new Error("版式版本操作上下文已失效，请重新打开风险停用确认");
  }
}

function riskStopOperationIsCurrent(context: RiskStopContext) {
  return context.templateId === layoutTemplateRouteId.value &&
    context.routeGeneration === layoutRouteGeneration &&
    context.operationId === riskStopOperationId;
}

function riskStopResultCanWrite(context: RiskStopContext) {
  return riskStopContextIsCurrent(context) &&
    riskStopOperationIsCurrent(context);
}

function completeRiskStop(context: RiskStopContext) {
  if (!riskStopResultCanWrite(context)) return;
  riskStopDialogVisible.value = false;
  showSuccess("版式版本已风险停用，新合同文件不再使用该版本");
  return refreshDetail(context.versionId);
}

function failRiskStop(error: unknown, context: RiskStopContext) {
  if (!riskStopResultCanWrite(context)) return;
  riskStopError.value = formatUnknownApiError(error, "风险停用失败");
}

function finishRiskStop(context: RiskStopContext) {
  if (!riskStopOperationIsCurrent(context)) return;
  riskStopLoading.value = false;
}

function stopCurrentVersion() {
  if (!riskStopAction.value?.enabled) return;
  const context = captureRiskStopContext();
  requireCurrentRiskStopContext(context);
  riskStopOperationId = context.operationId;
  riskStopLoading.value = true;
  riskStopError.value = "";
  return stopCurrentVersionWithCapability(context)
    .then(() => completeRiskStop(context))
    .catch((error) => failRiskStop(error, context))
    .finally(() => finishRiskStop(context));
}

async function runVersionAction(action: () => Promise<unknown>, success: string, versionId: string) {
  try {
    await action();
    await refreshDetail(versionId);
    showSuccess(success);
  } catch (error) {
    showError(formatUnknownApiError(error, "操作失败"));
  }
}

async function refreshDetail(preferredVersionId?: string) {
  const templateId = layoutTemplateRouteId.value;
  if (!templateId || templateId === "new") return false;
  const generation = ++layoutLoadGeneration;
  const serverDetail = await getLayoutTemplate(templateId, true);
  if (
    generation !== layoutLoadGeneration ||
    layoutTemplateRouteId.value !== templateId
  ) {
    return false;
  }
  const viewDetail = structuredClone(serverDetail);
  layoutTemplateCapability.value = serverDetail;
  detail.value = viewDetail;
  form.name = viewDetail.template.name;
  form.contractTypeKey = viewDetail.template.contractTypeKey;
  selectedVersionId.value =
    viewDetail.versions.find((version) => version.id === preferredVersionId)?.id ??
    viewDetail.versions.find((version) => version.status === "draft")?.id ??
    viewDetail.versions.find((version) => version.status === "published")?.id ??
    viewDetail.versions[0]?.id ??
    "";
  clearTransientState();
  syncEditorBaseline();
  return true;
}

function layoutStatusLabel(status: string) {
  return status === "discarded" ? "已废弃" : templateStatusLabel(status);
}

function clearTransientState() {
  sourceFiles.value = [];
  publicationSummary.value = "";
  window.clearInterval(timer.value);
}

function clearLayoutRouteContext() {
  layoutRouteGeneration += 1;
  layoutLoadGeneration += 1;
  riskStopOperationId += 1;
  layoutTemplateCapability.value = null;
  detail.value = null;
  selectedVersionId.value = "";
  lastValidVersionId.value = "";
  riskStopDialogVisible.value = false;
  riskStopError.value = "";
  riskStopVersionId.value = "";
  riskStopLoading.value = false;
  message.value = "";
  editorBaseline.value = "";
  form.name = "";
  form.contractTypeKey = "";
  clearTransientState();
}

async function loadLayoutRoute() {
  const expectedTemplateId = layoutTemplateRouteId.value;
  if (!expectedTemplateId || expectedTemplateId === "new") {
    creationCapability.value = null;
    try { creationCapability.value = await getLayoutCreationCapability(); }
    catch (error) { showError(formatUnknownApiError(error, "无法新增模板")); }
    syncEditorBaseline();
    return;
  }
  try {
    await refreshDetail(typeof route.query.versionId === "string" ? route.query.versionId : undefined);
  } catch (error) {
    if (layoutTemplateRouteId.value === expectedTemplateId) {
      showError(formatUnknownApiError(error, "读取版式失败"));
    }
  }
}

function startPolling() {
  window.clearInterval(timer.value);
  timer.value = window.setInterval(() => void loadPreview(), 2000);
}

function showSuccess(value: string) {
  message.value = value;
  tone.value = "success";
}

function showError(value: string) {
  message.value = value;
  tone.value = "danger";
}

watch(layoutTemplateRouteId, () => {
  clearLayoutRouteContext();
  void loadLayoutRoute();
});
onMounted(() => void loadLayoutRoute());
onBeforeUnmount(() => window.clearInterval(timer.value));

function formatInspectionReport(report: Record<string, unknown> | null) {
  if (!report) return "尚未检查";
  const placeholdersFound = toStringList(report.placeholders).map(toChinesePlaceholder);
  const missing = toStringList(report.missingRequiredPlaceholders).map(toChinesePlaceholder);
  const unknown = toStringList(report.unknownPlaceholders).map(toChinesePlaceholder);
  const blocking = toStringList(report.blockingErrors).map(toChineseInspectionIssue);
  const warnings = toStringList(report.warnings).map(toChineseInspectionIssue);
  return [
    `识别占位符：${placeholdersFound.length ? placeholdersFound.join("、") : "无"}`,
    `清单循环：${report.hasBillLoop ? "已识别" : "未识别"}`,
    `缺少必要项：${missing.length ? missing.join("、") : "无"}`,
    `未登记项：${unknown.length ? unknown.join("、") : "无"}`,
    `阻断项：${blocking.length ? blocking.join("；") : "无"}`,
    `提醒项：${warnings.length ? warnings.join("；") : "无"}`
  ].join("\n");
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function toChinesePlaceholder(value: string) {
  const labels: Record<string, string> = {
    "contract.name": "合同名称",
    "contract.temporaryCode": "草稿编号",
    "contract.code": "合同编号",
    "contract.amount": "合同金额",
    "contract.amountUppercase": "合同金额大写",
    "document.watermark": "文档水印",
    "document.generatedAt": "生成时间",
    "party.party_a.name": "甲方名称",
    "party.party_b.name": "乙方名称",
    "field.deliveryLocation": "交货地点",
    "clause.payment.text": "付款条款",
    "bill.materials": "材料清单",
    "bill.equipment": "设备清单",
    "bill.labor": "劳务清单"
  };
  return labels[value] ?? (/[A-Za-z]/.test(value) ? "未登记占位符" : value);
}

function toChineseInspectionIssue(value: string) {
  if (value.startsWith("Unknown placeholders:")) return `存在未登记占位符：${translateInspectionList(value)}`;
  if (value.startsWith("Missing required placeholders:")) return `缺少必要占位符：${translateInspectionList(value)}`;
  if (value.startsWith("Missing bill loop marker for:")) return `缺少清单循环块：${translateInspectionList(value)}`;
  if (value.startsWith("Disallowed fonts:")) return "存在未允许字体，请改用系统允许字体";
  return /[A-Za-z]/.test(value) ? "检查失败，请根据模板规范调整后重试" : value;
}

function translateInspectionList(value: string) {
  return value
    .slice(value.indexOf(":") + 1)
    .split(",")
    .map((item) => toChinesePlaceholder(item.trim()))
    .join("、");
}
</script>

<style scoped>
.page {
  color: var(--jg-text-strong);
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  margin-bottom: var(--jg-space-lg);
}

.page-head h1 {
  margin: 0;
  font-size: var(--jg-font-page-title);
}

.page-head p,
.hint,
.warning {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.panel {
  margin-bottom: var(--jg-space-lg);
  border-radius: var(--jg-radius-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(var(--jg-layout-form-field-min-width-compact), 1fr));
  gap: var(--jg-space-md);
  align-items: end;
}

.revision-summary,
.source-row,
.preview-summary {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
}

.revision-summary {
  min-height: 40px;
  color: var(--jg-text-subtle);
}

.revision-summary strong {
  color: var(--jg-text-strong);
}

.source-row {
  margin-top: var(--jg-space-md);
}

.source-row :deep(.t-upload) {
  flex: 1;
}

.warning {
  color: var(--jg-warning);
}

.version-lifecycle-action {
  margin-top: var(--jg-space-md);
}

.reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

code {
  padding: var(--jg-space-xs) var(--jg-space-sm);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-muted);
}

.governance-alert {
  margin-bottom: var(--jg-space-md);
}

.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--jg-space-lg);
}

.report {
  min-height: 180px;
  margin: var(--jg-space-md) 0 0;
  padding: var(--jg-space-md);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-muted);
  white-space: pre-wrap;
}

.actions {
  margin-top: var(--jg-space-sm);
}

.preview-summary {
  align-items: flex-start;
  flex-direction: column;
  margin-top: var(--jg-space-md);
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

@container jg-page (max-width: 840px) {
  .page-head,
  .form-grid {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
