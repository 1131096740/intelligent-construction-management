<template>
  <div class="workbench-section">
    <h2 class="section-title">
      合同文档
    </h2>

    <div class="document-controls">
      <label class="field">
        <span class="field-label">版式模板</span>
        <t-select
          v-model="layoutTemplateVersionId"
          :options="layoutOptions"
          :disabled="disabled || busy"
          placeholder="选择已发布版式"
        />
      </label>
      <label class="field">
        <span class="field-label">文档用途</span>
        <div class="purpose-segments">
          <button
            v-for="option in purposeOptions"
            :key="option.value"
            type="button"
            :class="['segment', { active: purpose === option.value }]"
            :disabled="disabled || busy"
            @click="purpose = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </label>
      <label class="field">
        <span class="field-label">下载确认密码</span>
        <t-input
          v-model="confirmationPassword"
          type="password"
          :disabled="busy"
          placeholder="用于下载 DOCX/PDF"
        />
      </label>
      <t-button
        theme="primary"
        :disabled="disabled || busy || !layoutTemplateVersionId"
        @click="queueDocument"
      >
        生成文档
      </t-button>
    </div>

    <div
      v-if="selectedLayout"
      class="layout-preview"
    >
      <img
        v-if="layoutThumbnailUrl(selectedLayout)"
        :src="layoutThumbnailUrl(selectedLayout)"
        alt="版式缩略图"
      >
      <span>版式 v{{ selectedLayout.versionNo ?? "-" }}</span>
      <button
        v-if="selectedLayout.previewPdfFileId"
        type="button"
        class="link-button"
        :disabled="busy"
        @click="openFile(String(selectedLayout.previewPdfFileId))"
      >
        预览 PDF
      </button>
    </div>

    <div class="attachments">
      <label class="file-button">
        <input
          type="file"
          multiple
          :disabled="disabled || busy"
          @change="uploadAttachments"
        >
        选择附件
      </label>
      <label class="file-button">
        <input
          type="file"
          accept="image/*"
          :disabled="disabled || busy"
          @change="(event) => uploadIdentityAttachment('portrait', event)"
        >
        身份证人像面
      </label>
      <label class="file-button">
        <input
          type="file"
          accept="image/*"
          :disabled="disabled || busy"
          @change="(event) => uploadIdentityAttachment('emblem', event)"
        >
        身份证国徽面
      </label>
      <p class="attachment-hint">
        附件按需上传；未上传则生成文档不占位。图片附件会按 A4 居中追加；身份证请分别上传人像面和国徽面，生成时同页上下排列。
      </p>
      <div
        v-if="attachments.length"
        class="attachment-list"
      >
        <span
          v-for="file in attachments"
          :key="file.id"
          class="attachment-chip"
        >
          {{ file.originalName }}
          <button
            type="button"
            :disabled="disabled || busy"
            @click="removeAttachment(file.id)"
          >
            ×
          </button>
        </span>
      </div>
    </div>

    <p
      v-if="documents.length === 0"
      class="empty"
    >
      暂无生成文档。
    </p>

    <div
      v-for="document in documents"
      :key="document.id"
      class="document-row"
    >
      <div>
        <div class="document-title">
          {{ purposeLabel(String(document.purpose ?? "")) }}
          <t-tag
            v-if="document.stale"
            size="small"
            theme="warning"
            variant="light"
          >
            已过期
          </t-tag>
        </div>
        <div class="document-meta">
          状态 {{ document.status }} · 修订 {{ document.sourceRevision }} ·
          {{ timeText(document.completedAt ?? document.createdAt) }}
        </div>
        <ul
          v-if="warningsFor(document).length"
          class="warning-list"
        >
          <li
            v-for="warning in warningsFor(document)"
            :key="warning"
          >
            {{ warning }}
          </li>
        </ul>
      </div>

      <div class="document-actions">
        <t-button
          v-if="document.docxFileId"
          size="small"
          variant="outline"
          @click="openFile(String(document.docxFileId))"
        >
          DOCX
        </t-button>
        <t-button
          v-if="document.pdfFileId"
          size="small"
          variant="outline"
          @click="openFile(String(document.pdfFileId))"
        >
          PDF
        </t-button>
        <t-button
          v-if="document.status === 'failed'"
          size="small"
          theme="primary"
          :disabled="disabled || busy"
          @click="retryDocument(document.id)"
        >
          重试
        </t-button>
      </div>
    </div>

    <div class="offline-revisions">
      <div class="offline-title">
        线下修订稿
      </div>
      <div class="offline-form">
        <label class="file-button">
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            :disabled="disabled || busy"
            @change="uploadOfflineRevisionFile"
          >
          上传 DOCX
        </label>
        <span
          v-if="offlineRevisionFile"
          class="file-name"
        >
          {{ offlineRevisionFile.originalName }}
        </span>
        <label class="field compact-field">
          <span class="field-label">标签</span>
          <t-input
            v-model="offlineRevisionLabel"
            :disabled="disabled || busy"
          />
        </label>
        <label class="field compact-field note-field">
          <span class="field-label">备注</span>
          <t-textarea
            v-model="offlineRevisionNote"
            :disabled="disabled || busy"
            :autosize="{ minRows: 1, maxRows: 3 }"
          />
        </label>
        <label class="confirm-line">
          <input
            v-model="offlineRevisionConfirmed"
            type="checkbox"
            :disabled="disabled || busy"
          >
          我确认该文件为线下修改后的合同稿件，系统不自动解析其中内容
        </label>
        <t-button
          theme="primary"
          :disabled="disabled || busy || !offlineRevisionFile || !offlineRevisionConfirmed"
          @click="submitOfflineRevision"
        >
          确认上传
        </t-button>
      </div>

      <p
        v-if="offlineRevisions.length === 0"
        class="empty"
      >
        暂无线下修订稿。
      </p>
      <div
        v-for="revision in offlineRevisions"
        :key="String(revision.id)"
        class="revision-row"
      >
        <div>
          <div class="document-title">
            {{ revisionLabel(revision) }}
          </div>
          <div class="document-meta">
            {{ revisionFileText(revision) }} · {{ revisionTimeText(revision) }}
          </div>
          <div
            v-if="revisionNote(revision)"
            class="document-meta"
          >
            {{ revisionNote(revision) }}
          </div>
        </div>
      </div>
    </div>

    <p
      v-if="message"
      class="message"
    >
      {{ message }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  listContractOfflineRevisions,
  listContractDocuments,
  listPublishedLayoutTemplates,
  queueContractDocument,
  retryContractDocument,
  uploadContractOfflineRevision
} from "../../../api/contract-workbench.api";
import {
  createPrivateFileDownloadTicket,
  uploadPrivateFile,
  type PrivateFileReadModel
} from "../../../api/core-flow-read.api";
import {
  defaultOfflineRevisionFormState,
  documentWarnings,
  documentsWithStaleFlag,
  offlineRevisionFormForVersionChange,
  type OfflineRevisionFormState,
  type WorkbenchDocument
} from "./contract-bill-editor";

const props = defineProps<{
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "reload"): void;
}>();

const purposeOptions = [
  { label: "草稿", value: "draft" },
  { label: "对外磋商稿", value: "negotiation" },
  { label: "内部送审稿", value: "internal_review" }
];
const identityAttachmentLabels = {
  portrait: "身份证人像面",
  emblem: "身份证国徽面"
} as const;

const layoutRecords = ref<Array<Record<string, unknown>>>([]);
const layoutOptions = ref<Array<{ label: string; value: string }>>([]);
const layoutTemplateVersionId = ref("");
const purpose = ref("draft");
const confirmationPassword = ref("");
const rawDocuments = ref<WorkbenchDocument[]>([]);
const attachments = ref<PrivateFileReadModel[]>([]);
const offlineRevisions = ref<Array<Record<string, unknown>>>([]);
const offlineRevisionFile = ref<PrivateFileReadModel | null>(null);
const offlineRevisionLabel = ref(defaultOfflineRevisionFormState<PrivateFileReadModel>().label);
const offlineRevisionNote = ref("");
const offlineRevisionConfirmed = ref(false);
const busy = ref(false);
const message = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

const versionId = computed(() => props.workbench?.version.id ?? "");
const currentRevision = computed(() => props.workbench?.version.draftRevision ?? 0);
const documents = computed(() =>
  documentsWithStaleFlag(rawDocuments.value, currentRevision.value)
);
const hasActiveDocument = computed(() =>
  documents.value.some((document) => ["queued", "processing"].includes(document.status))
);
const selectedLayout = computed(
  () =>
    layoutRecords.value.find(
      (layout) =>
        String(layout["layoutTemplateVersionId"] ?? layout["versionId"] ?? layout["id"] ?? "") ===
        layoutTemplateVersionId.value
    ) ?? null
);

watch(
  () => props.workbench,
  (workbench) => {
    rawDocuments.value = ((workbench?.documents ?? []) as unknown as WorkbenchDocument[]).map(
      (document) => ({ ...document })
    );
    void loadLayouts();
    void loadOfflineRevisions();
  },
  { immediate: true }
);

watch(versionId, (nextVersionId, previousVersionId) => {
  applyOfflineRevisionFormState(
    offlineRevisionFormForVersionChange(
      currentOfflineRevisionFormState(),
      previousVersionId,
      nextVersionId
    )
  );
}, { immediate: true });

watch(hasActiveDocument, (active) => {
  if (active) {
    startPolling();
  } else {
    stopPolling();
  }
}, { immediate: true });

onMounted(loadLayouts);
onUnmounted(stopPolling);

async function loadLayouts() {
  const contractTypeKey = props.workbench?.contract.contractTypeKey;
  if (!contractTypeKey) {
    layoutRecords.value = [];
    layoutOptions.value = [];
    return;
  }
  try {
    const layouts = (await listPublishedLayoutTemplates(contractTypeKey)) as Array<
      Record<string, unknown>
    >;
    layoutRecords.value = layouts;
    layoutOptions.value = layouts.map((layout) => ({
      label: String(layout["name"] ?? layout["versionName"] ?? layout["id"] ?? "版式"),
      value: String(layout["layoutTemplateVersionId"] ?? layout["versionId"] ?? layout["id"] ?? "")
    }));
    if (!layoutTemplateVersionId.value) {
      layoutTemplateVersionId.value = layoutOptions.value[0]?.value ?? "";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "版式模板加载失败";
  }
}

async function refreshDocuments() {
  if (!versionId.value) {
    return;
  }
  rawDocuments.value = (await listContractDocuments(versionId.value)) as WorkbenchDocument[];
}

async function loadOfflineRevisions() {
  if (!versionId.value) {
    offlineRevisions.value = [];
    return;
  }
  const requestVersionId = versionId.value;
  try {
    const revisions = (await listContractOfflineRevisions(requestVersionId)) as Array<
      Record<string, unknown>
    >;
    if (versionId.value === requestVersionId) {
      offlineRevisions.value = revisions;
    }
  } catch (error) {
    if (versionId.value === requestVersionId) {
      message.value = error instanceof Error ? error.message : "线下修订稿加载失败";
    }
  }
}

function currentOfflineRevisionFormState(): OfflineRevisionFormState<PrivateFileReadModel> {
  return {
    file: offlineRevisionFile.value,
    label: offlineRevisionLabel.value,
    note: offlineRevisionNote.value,
    confirmed: offlineRevisionConfirmed.value
  };
}

function applyOfflineRevisionFormState(state: OfflineRevisionFormState<PrivateFileReadModel>) {
  offlineRevisionFile.value = state.file;
  offlineRevisionLabel.value = state.label;
  offlineRevisionNote.value = state.note;
  offlineRevisionConfirmed.value = state.confirmed;
}

function startPolling() {
  if (pollTimer !== null) {
    return;
  }
  pollTimer = setInterval(() => {
    void refreshDocuments();
  }, 2000);
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function run(action: () => Promise<unknown>, success: string) {
  busy.value = true;
  message.value = "";
  try {
    await action();
    await refreshDocuments();
    emit("reload");
    message.value = success;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    busy.value = false;
  }
}

async function queueDocument() {
  await run(
    () =>
      queueContractDocument(versionId.value, {
        layoutTemplateVersionId: layoutTemplateVersionId.value,
        purpose: purpose.value,
        attachmentFileIds: attachments.value.map((file) => file.id)
      }),
    "已加入生成队列"
  );
}

async function uploadAttachments(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  if (!files.length) return;
  busy.value = true;
  message.value = "";
  try {
    const uploaded = [];
    for (const file of files) {
      uploaded.push(await uploadPrivateFile(file, file.name));
    }
    const byId = new Map([...attachments.value, ...uploaded].map((file) => [file.id, file]));
    attachments.value = [...byId.values()];
    message.value = "附件已加入生成输入";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "附件上传失败";
  } finally {
    busy.value = false;
    (event.target as HTMLInputElement).value = "";
  }
}

async function uploadIdentityAttachment(
  side: keyof typeof identityAttachmentLabels,
  event: Event
) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  message.value = "";
  try {
    const label = identityAttachmentLabels[side];
    const uploaded = await uploadPrivateFile(file, `${label} - ${file.name}`);
    const byId = new Map([...attachments.value, uploaded].map((item) => [item.id, item]));
    attachments.value = [...byId.values()];
    message.value = `${label}已加入生成输入`;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "身份证附件上传失败";
  } finally {
    busy.value = false;
    input.value = "";
  }
}

async function uploadOfflineRevisionFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const requestVersionId = versionId.value;
  busy.value = true;
  message.value = "";
  try {
    const uploadedFile = await uploadPrivateFile(file, file.name);
    if (versionId.value === requestVersionId) {
      offlineRevisionFile.value = uploadedFile;
      message.value = "DOCX 已上传，确认后记录线下修订稿";
    }
  } catch (error) {
    if (versionId.value === requestVersionId) {
      message.value = error instanceof Error ? error.message : "线下修订稿上传失败";
    }
  } finally {
    busy.value = false;
    (event.target as HTMLInputElement).value = "";
  }
}

async function submitOfflineRevision() {
  if (!offlineRevisionFile.value || !offlineRevisionConfirmed.value) {
    return;
  }
  const requestVersionId = versionId.value;
  busy.value = true;
  message.value = "";
  try {
    await uploadContractOfflineRevision(requestVersionId, {
      fileId: offlineRevisionFile.value.id,
      label: offlineRevisionLabel.value.trim() || "线下修订稿",
      note: offlineRevisionNote.value.trim() || undefined,
      confirmationStatementAccepted: true
    });
    if (versionId.value === requestVersionId) {
      applyOfflineRevisionFormState(defaultOfflineRevisionFormState<PrivateFileReadModel>());
      await loadOfflineRevisions();
      emit("reload");
      message.value = "线下修订稿已记录";
    }
  } catch (error) {
    if (versionId.value === requestVersionId) {
      message.value = error instanceof Error ? error.message : "线下修订稿记录失败";
    }
  } finally {
    busy.value = false;
  }
}

function removeAttachment(fileId: string) {
  attachments.value = attachments.value.filter((file) => file.id !== fileId);
}

async function retryDocument(documentId: string) {
  await run(() => retryContractDocument(documentId), "已重新加入队列");
}

async function openFile(fileId: string) {
  if (!confirmationPassword.value) {
    message.value = "请输入下载确认密码";
    return;
  }
  busy.value = true;
  message.value = "";
  try {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword: confirmationPassword.value
    });
    window.open(ticket.downloadUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "下载票据创建失败";
  } finally {
    busy.value = false;
  }
}

function purposeLabel(value: string) {
  return purposeOptions.find((option) => option.value === value)?.label ?? value;
}

function timeText(value: unknown): string {
  return typeof value === "string" && value ? new Date(value).toLocaleString() : "未完成";
}

function revisionLabel(revision: Record<string, unknown>): string {
  return typeof revision["label"] === "string" && revision["label"]
    ? revision["label"]
    : "线下修订稿";
}

function revisionFileText(revision: Record<string, unknown>): string {
  const file = revision["file"];
  if (file && typeof file === "object") {
    const originalName = (file as Record<string, unknown>)["originalName"];
    if (typeof originalName === "string" && originalName) {
      return originalName;
    }
  }
  if (typeof revision["originalName"] === "string" && revision["originalName"]) {
    return revision["originalName"];
  }
  return typeof revision["fileId"] === "string" && revision["fileId"]
    ? revision["fileId"]
    : "未记录文件";
}

function revisionTimeText(revision: Record<string, unknown>): string {
  return timeText(revision["confirmedAt"] ?? revision["createdAt"]);
}

function revisionNote(revision: Record<string, unknown>): string {
  return typeof revision["note"] === "string" ? revision["note"] : "";
}

function warningsFor(document: WorkbenchDocument) {
  return documentWarnings(document);
}

function layoutThumbnailUrl(layout: Record<string, unknown>) {
  return typeof layout["thumbnailUrl"] === "string"
    ? layout["thumbnailUrl"]
    : typeof layout["previewThumbnailUrl"] === "string"
      ? layout["previewThumbnailUrl"]
      : "";
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #151922;
}

.document-controls {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(240px, auto) 180px auto;
  align-items: end;
  gap: 12px;
}

.purpose-segments {
  display: inline-flex;
  border: 1px solid #b8c7e6;
  border-radius: 3px;
  overflow: hidden;
}

.segment {
  min-height: 30px;
  padding: 0 10px;
  color: #424955;
  background: #fff;
  border: 0;
  border-right: 1px solid #b8c7e6;
  cursor: pointer;
}

.segment:last-child {
  border-right: 0;
}

.segment.active {
  color: #0052d9;
  background: #eaf2ff;
  font-weight: 600;
}

.layout-preview,
.attachments,
.attachment-list,
.offline-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.layout-preview {
  padding: 10px 12px;
  background: #f7f9fc;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  color: #424955;
  font-size: 12px;
}

.layout-preview img {
  width: 72px;
  height: 96px;
  object-fit: cover;
  border: 1px solid #dce1e8;
}

.file-button,
.link-button,
.attachment-chip button {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 8px;
  color: #0052d9;
  background: #fff;
  border: 1px solid #b8c7e6;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
}

.file-button {
  position: relative;
}

.file-button input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.file-button:focus-within {
  outline: 2px solid #0052d9;
  outline-offset: 2px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  background: #f7f9fc;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  color: #424955;
  font-size: 12px;
}

.attachment-hint {
  flex-basis: 100%;
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.offline-revisions {
  display: grid;
  gap: 10px;
  padding-top: 4px;
}

.offline-title {
  font-size: 14px;
  font-weight: 700;
  color: #151922;
}

.compact-field {
  min-width: 160px;
}

.note-field {
  min-width: 220px;
  flex: 1;
}

.confirm-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #424955;
  font-size: 12px;
}

.file-name {
  color: #424955;
  font-size: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.empty,
.message,
.document-meta {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.revision-row,
.document-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.document-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.document-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.warning-list {
  display: grid;
  gap: 4px;
  margin: 6px 0 0;
  padding-left: 16px;
  color: #9f4f06;
  font-size: 12px;
}

@media (max-width: 900px) {
  .document-controls,
  .document-row {
    grid-template-columns: 1fr;
  }

  .document-row {
    display: grid;
  }
}
</style>
