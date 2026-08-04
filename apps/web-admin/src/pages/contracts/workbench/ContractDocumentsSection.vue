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
          data-field-key="layoutTemplateVersionId"
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
      <span>版式版本 {{ selectedLayout.versionNo ?? "-" }}</span>
      <button
        v-if="selectedLayout.previewPdfFileId"
        type="button"
        class="link-button"
        :disabled="busy"
        @click="openFile(String(selectedLayout.previewPdfFileId))"
      >
        预览文件
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
          状态 {{ documentStatusLabel(document.status) }} · 修订 {{ document.sourceRevision }} ·
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
          合同文档
        </t-button>
        <t-button
          v-if="document.pdfFileId"
          size="small"
          variant="outline"
          @click="openFile(String(document.pdfFileId))"
        >
          预览文件
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

    <ContractNegotiationSection
      :version-id="versionId"
      :disabled="disabled"
      :refresh-token="negotiationRefreshToken"
      @selection="emit('negotiation-selection', $event)"
      @changed="onNegotiationChanged"
    />

    <t-dialog
      v-if="contractDocumentDownloadAction && contractDocumentDownloadAction.enabled"
      v-model:visible="downloadDialogVisible"
      header="下载合同文件"
      :confirm-btn="downloadConfirmButtonProps"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="confirmContractDocumentDownload"
      @close="closeContractDocumentDownload"
    >
      <div class="download-dialog-body">
        <label class="field">
          <span class="field-label">当前登录密码</span>
          <t-input
            v-model="confirmationPassword"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
            placeholder="请输入当前登录密码"
          />
        </label>
        <label class="field">
          <span class="field-label">下载原因</span>
          <t-input
            v-model="downloadReason"
            :disabled="busy"
            placeholder="请填写下载原因，便于留痕审计"
          />
        </label>
      </div>
    </t-dialog>

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
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  fetchContractDraftOperationCapabilities,
  listContractDocuments,
  listPublishedLayoutTemplates,
  queueContractDocument,
  retryContractDocument,
  uploadContractWorkbenchPrivateFile
} from "../../../api/contract-workbench.api";
import {
  createPrivateFileDownloadTicket,
  getPrivateFileDownloadTicketCapability,
  type PrivateFileReadModel
} from "../../../api/core-flow-read.api";
import {
  documentWarnings,
  documentsWithStaleFlag,
  type WorkbenchDocument
} from "./contract-bill-editor";
import type {
  ContractNegotiationRoundReadModel,
  ContractOfflineRevisionReadModel
} from "../../../api/contract-negotiation.api";
import ContractNegotiationSection from "./ContractNegotiationSection.vue";

async function queueContractDocumentWithCapability(
  contractVersionId: string,
  body: Parameters<typeof queueContractDocument>[1]
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同文档能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "queue_contract_document"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能生成合同文档");
  }
  return queueContractDocument(contractVersionId, body);
}

async function uploadContractDocumentFileWithCapability(
  contractVersionId: string,
  file: Blob,
  fileName: string
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同文档能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_workbench_private_file"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能上传合同文档附件");
  }
  return uploadContractWorkbenchPrivateFile(contractVersionId, file, fileName);
}

async function retryContractDocumentWithCapability(
  contractVersionId: string,
  documentId: string
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同文档能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "retry_contract_document"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能重试合同文档生成");
  }
  return retryContractDocument(documentId);
}

const props = defineProps<{
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
  negotiationRefreshToken: number;
  prepareMutation?: () => Promise<ContractWorkbenchReadModel | null>;
  completeMutation?: (reload: boolean) => Promise<void>;
}>();

const emit = defineEmits<{
  (event: "reload"): void;
  (event: "negotiation-changed"): void;
  (event: "negotiation-selection", value: {
    round: ContractNegotiationRoundReadModel;
    revision: ContractOfflineRevisionReadModel;
  } | null): void;
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
const downloadReason = ref("");
const downloadDialogVisible = ref(false);
const downloadFileId = ref("");
const contractDocumentDownloadAction = shallowRef<{
  key: "create_private_file_download_ticket";
  enabled: boolean;
} | null>(null);
const rawDocuments = ref<WorkbenchDocument[]>([]);
const attachments = ref<PrivateFileReadModel[]>([]);
const busy = ref(false);
const message = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;
let downloadCapabilityRequestId = 0;
let downloadTicketPromise: Promise<void> | null = null;

const versionId = computed(() => props.workbench?.version.id ?? "");
const currentRevision = computed(() => props.workbench?.version.draftRevision ?? 0);
const documents = computed(() =>
  documentsWithStaleFlag(rawDocuments.value, currentRevision.value)
);
const hasActiveDocument = computed(() =>
  documents.value.some((document) => ["queued", "processing"].includes(document.status))
);
const downloadConfirmButtonProps = computed(() => ({
  content: "确认下载",
  loading: busy.value,
  disabled:
    !downloadFileId.value ||
    !confirmationPassword.value.trim() ||
    !downloadReason.value.trim() ||
    contractDocumentDownloadAction.value?.enabled !== true
}));
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
  },
  { immediate: true }
);

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
  let prepared = false;
  await run(
    async () => {
      const current = props.prepareMutation
        ? await props.prepareMutation()
        : props.workbench;
      if (!current) throw new Error("合同草稿未保存，本次未生成文档");
      prepared = true;
      await queueContractDocumentWithCapability(current.version.id, {
        layoutTemplateVersionId: layoutTemplateVersionId.value,
        purpose: purpose.value,
        attachmentFileIds: attachments.value.map((file) => file.id)
      });
    },
    "已加入生成队列"
  );
  if (prepared && props.completeMutation) await props.completeMutation(false);
}

async function uploadAttachments(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  if (!files.length) return;
  busy.value = true;
  message.value = "";
  try {
    const uploaded = [];
    for (const file of files) {
      uploaded.push(await uploadContractDocumentFileWithCapability(versionId.value, file, file.name));
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
    const uploaded = await uploadContractDocumentFileWithCapability(
      versionId.value,
      file,
      `${label} - ${file.name}`
    );
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

function removeAttachment(fileId: string) {
  attachments.value = attachments.value.filter((file) => file.id !== fileId);
}

async function retryDocument(documentId: string) {
  await run(
    () => retryContractDocumentWithCapability(versionId.value, documentId),
    "已重新加入队列"
  );
}

async function openFile(fileId: string) {
  const capabilityRequestId = ++downloadCapabilityRequestId;
  contractDocumentDownloadAction.value = null;
  message.value = "";
  try {
    const capability = await getPrivateFileDownloadTicketCapability(fileId);
    if (capabilityRequestId !== downloadCapabilityRequestId) {
      return;
    }
    contractDocumentDownloadAction.value = capability.action;
    const matchesRequestedAction =
      contractDocumentDownloadAction.value.key ===
      "create_private_file_download_ticket";
    if (!matchesRequestedAction) {
      throw new Error("合同文件下载能力响应不一致");
    }
    if (!contractDocumentDownloadAction.value.enabled) {
      throw new Error("当前用户不能下载该合同文件");
    }
    downloadFileId.value = fileId;
    confirmationPassword.value = "";
    downloadReason.value = "";
    downloadDialogVisible.value = true;
  } catch (error) {
    if (capabilityRequestId === downloadCapabilityRequestId) {
      message.value = error instanceof Error ? error.message : "下载能力读取失败";
    }
  }
}

function confirmContractDocumentDownload() {
  if (downloadTicketPromise) return downloadTicketPromise;
  busy.value = true;
  message.value = "";
  const request = createPrivateFileDownloadTicket(downloadFileId.value, {
    confirmationPassword: confirmationPassword.value,
    downloadReason: downloadReason.value
  });
  downloadTicketPromise = request
    .then((ticket) => {
      window.open(ticket.downloadUrl, "_blank", "noopener,noreferrer");
      closeContractDocumentDownload();
    })
    .catch((error: unknown) => {
      message.value = error instanceof Error ? error.message : "下载票据创建失败";
    })
    .finally(() => {
      busy.value = false;
      downloadTicketPromise = null;
    });
  return downloadTicketPromise;
}

function closeContractDocumentDownload() {
  downloadCapabilityRequestId += 1;
  downloadDialogVisible.value = false;
  downloadFileId.value = "";
  confirmationPassword.value = "";
  downloadReason.value = "";
  contractDocumentDownloadAction.value = null;
}

function purposeLabel(value: string) {
  return purposeOptions.find((option) => option.value === value)?.label ?? value;
}

function documentStatusLabel(value: string) {
  return (
    {
      queued: "排队中",
      processing: "生成中",
      success: "已生成",
      failed: "生成失败",
      stale: "已过期"
    }[value] ?? value
  );
}

function timeText(value: unknown): string {
  return typeof value === "string" && value ? new Date(value).toLocaleString() : "未完成";
}

function onNegotiationChanged() {
  emit("negotiation-changed");
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
  container-name: contract-documents;
  container-type: inline-size;
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
.attachment-list {
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

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.download-dialog-body {
  display: grid;
  gap: 12px;
}

.empty,
.message,
.document-meta {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

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

@container contract-documents (max-width: 720px) {
  .document-controls,
  .document-row {
    grid-template-columns: 1fr;
  }

  .document-row {
    display: grid;
  }
}
</style>
