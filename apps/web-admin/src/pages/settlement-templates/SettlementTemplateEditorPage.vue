<template>
  <section class="template-editor-page jg-responsive-workspace">
    <header class="page-head">
      <div>
        <h1>{{ isCreateMode ? "新建结算模板" : "结算模板治理" }}</h1>
        <p>源文件、兼容规则、检查和脱敏预览共同冻结为可发布版本。</p>
      </div>
      <t-button
        variant="outline"
        @click="router.push('/结算模板库')"
      >
        返回模板库
      </t-button>
    </header>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
      class="panel"
    />

    <t-card
      title="模板与版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <t-form-item label="模板名称">
          <t-input
            v-model="form.name"
            :readonly="!isCreateMode"
            placeholder="例如：劳务月度结算模板"
          />
        </t-form-item>
        <t-form-item label="模板编码">
          <t-input
            v-model="form.code"
            :readonly="!isCreateMode"
            placeholder="例如：SETTLEMENT-LABOR"
          />
        </t-form-item>
        <t-form-item
          v-if="!isCreateMode"
          label="治理版本"
        >
          <t-select
            v-model="selectedVersionId"
            :options="versionOptions"
            @change="syncVersionForm"
          />
        </t-form-item>
        <div
          v-if="currentVersion"
          class="version-summary"
        >
          <span>草稿修订 R{{ currentVersion.draftRevision }}</span>
          <t-tag
            :theme="currentVersion.status === 'published' ? 'success' : 'default'"
            variant="light"
          >
            {{ settlementTemplateStatusLabel(currentVersion.status) }}
          </t-tag>
        </div>
      </div>

      <div class="compatibility-grid">
        <t-form-item label="兼容合同类型">
          <t-select
            v-model="form.compatibleContractTypeKeys"
            multiple
            clearable
            :disabled="!isCreateMode && !governance.canSave"
            :options="settlementTemplateContractTypeOptions"
            placeholder="留空表示兼容全部合同类型"
          />
        </t-form-item>
        <t-form-item label="兼容金额角色">
          <t-select
            v-model="form.compatibleAmountRoles"
            multiple
            clearable
            :disabled="!isCreateMode && !governance.canSave"
            :options="settlementTemplateAmountRoleOptions"
            placeholder="留空表示兼容全部金额角色"
          />
        </t-form-item>
        <t-form-item label="兼容计价模式">
          <t-select
            v-model="form.compatiblePricingModes"
            multiple
            clearable
            :disabled="!isCreateMode && !governance.canSave"
            :options="settlementTemplatePricingModeOptions"
            placeholder="留空表示兼容全部计价模式"
          />
        </t-form-item>
      </div>

      <div class="source-row">
        <t-upload
          v-model="sourceFiles"
          theme="file-input"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          :auto-upload="false"
          :max="1"
          :disabled="!isCreateMode && !governance.canSave"
          placeholder="选择 XLSX 模板源文件"
        />
        <t-button
          v-if="isCreateMode"
          theme="primary"
          :loading="busyAction === 'save'"
          @click="createTemplate"
        >
          创建草稿
        </t-button>
        <t-button
          v-else-if="governance.canSave"
          theme="primary"
          :loading="busyAction === 'save'"
          @click="saveDraft"
        >
          保存新修订
        </t-button>
      </div>
      <t-alert
        theme="info"
        message="固定规则：工作表“本期结算明细”、普通清单不允许负数、必须包含证据说明列和经办人/审核人签字区。"
        class="rule-alert"
      />
    </t-card>

    <t-card
      v-if="currentVersion"
      title="检查与脱敏预览"
      :bordered="true"
      class="panel"
    >
      <t-alert
        v-if="!governance.inspectionCurrent || !governance.previewCurrent"
        theme="warning"
        message="当前修订尚未完成有效检查和 XLSX/PDF 脱敏预览，不能提交发布。"
        class="governance-alert"
      />
      <div class="inspection-workspace jg-workspace-scroll">
        <div class="inspection-layout jg-workspace-scroll__content--compact">
          <div class="inspection-card">
            <div class="section-head">
              <strong>模板检查</strong>
              <t-button
                variant="outline"
                :disabled="!governance.canInspect"
                :loading="busyAction === 'inspect'"
                @click="inspectCurrent"
              >
                执行检查
              </t-button>
            </div>
            <div
              v-if="currentVersion.inspectionReport"
              class="report-groups"
            >
              <div>
                <span>阻断项</span>
                <ul v-if="currentVersion.inspectionReport.blockingErrors.length">
                  <li
                    v-for="item in currentVersion.inspectionReport.blockingErrors"
                    :key="item"
                  >
                    {{ item }}
                  </li>
                </ul>
                <strong
                  v-else
                  class="success-copy"
                >未发现阻断项</strong>
              </div>
              <div v-if="currentVersion.inspectionReport.warnings.length">
                <span>提醒</span>
                <ul>
                  <li
                    v-for="item in currentVersion.inspectionReport.warnings"
                    :key="item"
                  >
                    {{ item }}
                  </li>
                </ul>
              </div>
            </div>
            <span
              v-else
              class="muted"
            >尚未检查当前修订。</span>
          </div>

          <div class="inspection-card">
            <div class="section-head">
              <strong>固定脱敏样张</strong>
              <t-button
                variant="outline"
                :disabled="!governance.canPreview"
                :loading="busyAction === 'preview'"
                @click="generatePreview"
              >
                生成 XLSX/PDF
              </t-button>
            </div>
            <span>{{ previewStatus }}</span>
            <t-input
              v-model="downloadReason"
              label="下载原因"
              placeholder="例如：发布前核对打印版式"
            />
            <t-space>
              <t-button
                variant="outline"
                :disabled="!canDownloadPreview"
                :loading="busyAction === 'download-xlsx'"
                @click="downloadPreview('xlsx')"
              >
                下载 XLSX 样张
              </t-button>
              <t-button
                variant="outline"
                :disabled="!canDownloadPreview"
                :loading="busyAction === 'download-pdf'"
                @click="downloadPreview('pdf')"
              >
                下载 PDF 样张
              </t-button>
            </t-space>
          </div>
        </div>
      </div>
    </t-card>

    <t-card
      v-if="currentVersion"
      title="版本动作"
      :bordered="true"
      class="panel"
    >
      <BusinessDraftAction
        class="version-lifecycle-action"
        :actions="currentVersion.availableActions ?? []"
        :blocked-reasons="currentVersion.blockedReasons ?? []"
        :subject="versionActionSubject"
        :execute="discardCurrentVersion"
        @completed="handleDiscardCompleted"
      />
      <div class="publication-row">
        <t-input
          v-model="publicationSummary"
          label="发布说明"
          :disabled="!governance.canPublish"
          placeholder="发布时必须说明本版本变化"
        />
        <t-space>
          <t-button
            v-if="governance.canSubmit"
            :loading="busyAction === 'submit'"
            @click="runAction('submit')"
          >
            提交发布
          </t-button>
          <t-button
            v-if="governance.canPublish"
            theme="primary"
            :disabled="!publicationSummary.trim()"
            @click="openConfirmation('publish')"
          >
            发布版本
          </t-button>
          <t-button
            v-if="governance.canStop"
            theme="danger"
            variant="outline"
            @click="openConfirmation('stop')"
          >
            停用版本
          </t-button>
          <t-button
            v-if="governance.canClone"
            theme="primary"
            :loading="busyAction === 'clone'"
            @click="runAction('clone')"
          >
            复制为新草稿
          </t-button>
        </t-space>
      </div>
    </t-card>

    <t-dialog
      v-model:visible="confirmVisible"
      :header="confirmAction === 'publish' ? '确认发布结算模板' : '确认停用结算模板'"
      :confirm-btn="{ theme: confirmAction === 'stop' ? 'danger' : 'primary', loading: Boolean(busyAction) }"
      @confirm="confirmGovernanceAction"
    >
      {{ confirmAction === "publish"
        ? "发布后该版本将进入结算工作台推荐范围，请确认检查、样张和发布说明均已复核。"
        : "停用后新建结算将不再推荐该版本，已有结算仍保留版本追溯。" }}
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import {
  cloneSettlementTemplateVersion,
  createSettlementTemplate,
  discardSettlementTemplateVersion,
  downloadSettlementTemplatePreview,
  generateSettlementTemplatePreview,
  getSettlementTemplate,
  inspectSettlementTemplateVersion,
  publishSettlementTemplateVersion,
  stopSettlementTemplateVersion,
  submitSettlementTemplateVersion,
  updateSettlementTemplateVersion,
  type SettlementTemplateDetailReadModel
} from "../../api/settlement-template.api";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import {
  settlementTemplateAmountRoleOptions,
  settlementTemplateContractTypeOptions,
  settlementTemplateFixedRules,
  settlementTemplateGovernance,
  settlementTemplatePricingModeOptions,
  settlementTemplateStatusLabel
} from "./settlement-template.state";

const route = useRoute();
const router = useRouter();
const detail = ref<SettlementTemplateDetailReadModel | null>(null);
const selectedVersionId = ref("");
const sourceFiles = ref<UploadFile[]>([]);
const busyAction = ref("");
const message = ref("");
const messageTone = ref<"success" | "error">("success");
const publicationSummary = ref("");
const downloadReason = ref("");
const confirmVisible = ref(false);
const confirmAction = ref<"publish" | "stop">("publish");
const form = reactive({
  name: "",
  code: "",
  compatibleContractTypeKeys: [] as string[],
  compatibleAmountRoles: [] as string[],
  compatiblePricingModes: [] as string[]
});

const isCreateMode = computed(() => !route.params.templateId);
const versions = computed(() => detail.value?.versions ?? []);
const currentVersion = computed(
  () => versions.value.find((version) => version.id === selectedVersionId.value) ?? null
);
const versionOptions = computed(() =>
  versions.value.map((version) => ({
    label: `V${version.versionNo} · ${settlementTemplateStatusLabel(version.status)}`,
    value: version.id
  }))
);
const governance = computed(() => settlementTemplateGovernance(currentVersion.value ?? undefined));
const previewStatus = computed(() => {
  const preview = currentVersion.value?.latestPreview;
  if (!preview) return "尚未生成当前修订样张。";
  if (preview.status === "succeeded" && governance.value.previewCurrent) return "当前修订样张已生成。";
  const labels = {
    queued: "等待生成",
    processing: "生成中",
    succeeded: "样张已过期",
    failed: "生成失败",
    stale: "样张已过期"
  } as const;
  return labels[preview.status];
});
const canDownloadPreview = computed(
  () => governance.value.previewCurrent && Boolean(downloadReason.value.trim())
);
const versionActionSubject = computed(() => ({
  businessCode: detail.value?.template.code ?? "—",
  name: `${detail.value?.template.name ?? "结算模板"} V${currentVersion.value?.versionNo ?? "—"}`,
  lastSavedAt: formatDateTime(currentVersion.value?.updatedAt),
  impactScope: "仅废弃当前从未提交的草稿版本；已发布版本和正式结算引用不受影响。"
}));

function selectedFile() {
  const raw = sourceFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
}

function payloadCompatibility() {
  return {
    compatibleContractTypeKeys: [...form.compatibleContractTypeKeys],
    compatibleAmountRoles: [...form.compatibleAmountRoles],
    compatiblePricingModes: [...form.compatiblePricingModes]
  };
}

function syncVersionForm() {
  const version = currentVersion.value;
  if (!version) return;
  form.compatibleContractTypeKeys = [...version.compatibleContractTypeKeys];
  form.compatibleAmountRoles = [...version.compatibleAmountRoles];
  form.compatiblePricingModes = [...version.compatiblePricingModes];
  sourceFiles.value = [];
  publicationSummary.value = version.changeSummary ?? "";
  downloadReason.value = "";
}

async function createTemplate() {
  const file = selectedFile();
  if (!form.name.trim() || !form.code.trim()) return showError("请填写模板名称和编码。");
  if (!file) return showError("请选择 XLSX 模板源文件。");
  busyAction.value = "save";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    const created = await createSettlementTemplate({
      name: form.name.trim(),
      code: form.code.trim(),
      xlsxFileId: uploaded.id,
      ...payloadCompatibility(),
      ...settlementTemplateFixedRules
    });
    await router.replace(`/结算模板库/${encodeURIComponent(created.template.id)}`);
    await loadDetail(created.version.id);
    showSuccess("结算模板草稿已创建。");
  } catch (error) {
    showError(error instanceof Error ? error.message : "创建结算模板失败。");
  } finally {
    busyAction.value = "";
  }
}

async function saveDraft() {
  const version = currentVersion.value;
  if (!version) return;
  busyAction.value = "save";
  try {
    const file = selectedFile();
    const xlsxFileId = file ? (await uploadPrivateFile(file, file.name)).id : undefined;
    await updateSettlementTemplateVersion(version.id, {
      expectedRevision: version.draftRevision,
      ...payloadCompatibility(),
      ...(xlsxFileId ? { xlsxFileId } : {})
    });
    await loadDetail(version.id);
    showSuccess("草稿新修订已保存，旧检查和旧样张已失效。");
  } catch (error) {
    showError(error instanceof Error ? error.message : "保存结算模板失败。");
  } finally {
    busyAction.value = "";
  }
}

async function inspectCurrent() {
  const version = currentVersion.value;
  if (!version) return;
  busyAction.value = "inspect";
  try {
    await inspectSettlementTemplateVersion(version.id);
    await loadDetail(version.id);
    showSuccess("当前修订检查完成。");
  } catch (error) {
    showError(error instanceof Error ? error.message : "检查结算模板失败。");
  } finally {
    busyAction.value = "";
  }
}

async function generatePreview() {
  const version = currentVersion.value;
  if (!version) return;
  busyAction.value = "preview";
  try {
    await generateSettlementTemplatePreview(version.id);
    await loadDetail(version.id);
    showSuccess("当前修订的 XLSX/PDF 脱敏样张已生成。");
  } catch (error) {
    showError(error instanceof Error ? error.message : "生成脱敏样张失败。");
  } finally {
    busyAction.value = "";
  }
}

async function downloadPreview(format: "xlsx" | "pdf") {
  const version = currentVersion.value;
  if (!version || !canDownloadPreview.value) return;
  busyAction.value = `download-${format}`;
  try {
    await downloadSettlementTemplatePreview(version.id, format, downloadReason.value.trim());
    showSuccess(`${format.toUpperCase()} 脱敏样张已下载。`);
  } catch (error) {
    showError(error instanceof Error ? error.message : "下载脱敏样张失败。");
  } finally {
    busyAction.value = "";
  }
}

async function runAction(action: "submit" | "publish" | "stop" | "clone") {
  const version = currentVersion.value;
  if (!version) return;
  busyAction.value = action;
  try {
    if (action === "submit") await submitSettlementTemplateVersion(version.id);
    if (action === "publish") {
      await publishSettlementTemplateVersion(version.id, publicationSummary.value.trim());
    }
    if (action === "stop") await stopSettlementTemplateVersion(version.id);
    if (action === "clone") {
      const cloned = await cloneSettlementTemplateVersion(version.id);
      await loadDetail(cloned.id);
      showSuccess("已复制为新的结算模板草稿。");
      return;
    }
    await loadDetail(version.id);
    showSuccess(action === "submit" ? "版本已提交发布。" : action === "publish" ? "版本已发布。" : "版本已停用。");
  } catch (error) {
    showError(error instanceof Error ? error.message : "结算模板版本操作失败。");
  } finally {
    busyAction.value = "";
    confirmVisible.value = false;
  }
}

async function discardCurrentVersion(request: BusinessDraftActionRequest) {
  const version = currentVersion.value;
  if (!version || request.action !== "discard_version") {
    throw new Error("当前结算模板版本不支持该操作，请刷新后重试");
  }
  await discardSettlementTemplateVersion(version.id, {
    reason: request.reason,
    expectedRevision: version.draftRevision
  });
  await loadDetail(version.id);
}

function handleDiscardCompleted() {
  showSuccess("草稿版本已废弃，已提交、发布和引用记录均未改变。");
}

function openConfirmation(action: "publish" | "stop") {
  confirmAction.value = action;
  confirmVisible.value = true;
}

function confirmGovernanceAction() {
  void runAction(confirmAction.value);
}

async function loadDetail(preferredVersionId = "") {
  const templateId = String(route.params.templateId ?? "");
  if (!templateId || templateId === "new") return;
  detail.value = await getSettlementTemplate(templateId, true);
  form.name = detail.value.template.name;
  form.code = detail.value.template.code;
  selectedVersionId.value =
    detail.value.versions.find((version) => version.id === preferredVersionId)?.id ??
    detail.value.versions[0]?.id ??
    "";
  syncVersionForm();
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

function showSuccess(value: string) {
  message.value = value;
  messageTone.value = "success";
}

function showError(value: string) {
  message.value = value;
  messageTone.value = "error";
}

onMounted(async () => {
  if (isCreateMode.value) return;
  try {
    await loadDetail();
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载结算模板失败。");
  }
});
</script>

<style scoped>
.template-editor-page {
  width: 100%;
  min-width: 0;
}

.page-head,
.source-row,
.section-head,
.publication-row,
.version-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.page-head {
  margin-bottom: var(--jg-space-lg);
}

.page-head h1 {
  margin: 0 0 var(--jg-space-xs);
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
}

.page-head p,
.muted,
.report-groups span {
  margin: 0;
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.panel {
  margin-bottom: var(--jg-space-lg);
}

.version-lifecycle-action {
  margin-bottom: var(--jg-space-md);
}

.form-grid,
.compatibility-grid,
.inspection-layout {
  display: grid;
  gap: var(--jg-space-md);
}

.form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.compatibility-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: var(--jg-space-md);
}

.source-row,
.rule-alert,
.governance-alert {
  margin-top: var(--jg-space-md);
}

.source-row :deep(.t-upload) {
  flex: 1;
}

.inspection-layout {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.inspection-workspace {
  padding-bottom: var(--jg-space-xs);
}

.inspection-card {
  display: grid;
  align-content: start;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.report-groups {
  display: grid;
  gap: var(--jg-space-md);
}

.report-groups ul {
  margin: var(--jg-space-xs) 0 0;
  padding-left: var(--jg-space-lg);
}

.success-copy {
  display: block;
  margin-top: var(--jg-space-xs);
  color: var(--jg-success);
}

.publication-row > :first-child {
  flex: 1;
}

@container jg-page (max-width: 840px) {
  .compatibility-grid {
    grid-template-columns: 1fr;
  }
}

@container jg-page (max-width: 620px) {
  .page-head,
  .source-row,
  .publication-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .source-row :deep(.t-upload),
  .publication-row > :first-child {
    width: 100%;
  }
}
</style>
