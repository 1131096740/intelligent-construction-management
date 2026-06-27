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
        <t-select
          v-model="purpose"
          :options="purposeOptions"
          :disabled="disabled || busy"
        />
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
  listContractDocuments,
  listPublishedLayoutTemplates,
  queueContractDocument,
  retryContractDocument
} from "../../../api/contract-workbench.api";
import { createPrivateFileDownloadTicket } from "../../../api/core-flow-read.api";
import { documentsWithStaleFlag, type WorkbenchDocument } from "./contract-bill-editor";

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

const layoutOptions = ref<Array<{ label: string; value: string }>>([]);
const layoutTemplateVersionId = ref("");
const purpose = ref("draft");
const confirmationPassword = ref("");
const rawDocuments = ref<WorkbenchDocument[]>([]);
const busy = ref(false);
const message = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

const versionId = computed(() => props.workbench?.version.id ?? "");
const currentRevision = computed(() => props.workbench?.version.revision ?? 0);
const documents = computed(() =>
  documentsWithStaleFlag(rawDocuments.value, currentRevision.value)
);
const hasActiveDocument = computed(() =>
  documents.value.some((document) => ["queued", "processing"].includes(document.status))
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
});

onMounted(loadLayouts);
onUnmounted(stopPolling);

async function loadLayouts() {
  const contractTypeKey = props.workbench?.contract.contractTypeKey;
  if (!contractTypeKey) {
    layoutOptions.value = [];
    return;
  }
  try {
    const layouts = (await listPublishedLayoutTemplates(contractTypeKey)) as Array<
      Record<string, unknown>
    >;
    layoutOptions.value = layouts.map((layout) => ({
      label: String(layout["name"] ?? layout["versionName"] ?? layout["id"] ?? "版式"),
      value: String(layout["versionId"] ?? layout["id"] ?? "")
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
  await run(
    () =>
      queueContractDocument(versionId.value, {
        layoutTemplateVersionId: layoutTemplateVersionId.value,
        purpose: purpose.value,
        attachmentFileIds: []
      }),
    "已加入生成队列"
  );
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
  grid-template-columns: minmax(180px, 1fr) 160px 180px auto;
  align-items: end;
  gap: 12px;
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
