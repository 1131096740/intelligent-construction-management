<template>
  <span class="pdf-actions">
    <t-button
      size="small"
      variant="text"
      :disabled="busy"
      @click="open('preview')"
    >
      预览样张
    </t-button>
    <t-button
      size="small"
      variant="text"
      :disabled="busy"
      @click="open('download')"
    >
      下载样张
    </t-button>
  </span>
  <t-dialog
    v-model:visible="visible"
    :header="mode === 'preview' ? '预览版式样张' : '下载版式样张'"
    :confirm-btn="{ content: mode === 'preview' ? '确认预览' : '确认下载', loading: busy,
                    disabled: !password.trim() || !reason.trim() || busy }"
    :close-on-overlay-click="false"
    :close-btn="!busy"
    :cancel-btn="{ content: '取消', disabled: busy }"
    @confirm="confirm"
    @close="close"
  >
    <t-form label-align="top">
      <t-form-item label="当前登录密码">
        <t-input
          v-model="password"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
        />
      </t-form-item>
      <t-form-item :label="mode === 'preview' ? '预览原因' : '下载原因'">
        <t-input
          v-model="reason"
          placeholder="请填写原因，便于留痕审计"
          :disabled="busy"
        />
      </t-form-item>
    </t-form>
    <t-alert
      v-if="message"
      theme="error"
      :message="message"
    />
  </t-dialog>
  <t-dialog
    v-model:visible="previewVisible"
    header="版式样张预览"
    width="90vw"
    :footer="false"
    @close="releasePreview"
  >
    <LayoutPdfPreview
      v-if="previewVisible && previewUrl"
      :url="previewUrl"
    />
  </t-dialog>
  <span
    v-if="message && !visible"
    role="alert"
  >{{ message }}</span>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onUnmounted, ref, watch } from "vue";
import { createPrivateFileDownloadTicket, getPrivateFileDownloadTicketCapability, readPrivatePdfTicket } from "../../api/core-flow-read.api";

const LayoutPdfPreview = defineAsyncComponent(() => import("./LayoutPdfPreview.vue"));

const props = defineProps<{ fileId: string }>();
const visible = ref(false);
const previewVisible = ref(false);
const previewUrl = ref("");
function releasePreview() {
  previewVisible.value = false;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
}
const busy = ref(false);
const mode = ref<"preview" | "download">("preview");
const password = ref("");
const reason = ref("");
const message = ref("");
let generation = 0;
let authorizedFileId = "";

function close() {
  generation += 1;
  visible.value = false;
  password.value = "";
  reason.value = "";
  authorizedFileId = "";
}

async function open(accessMode: "preview" | "download") {
  if (busy.value) return;
  close();
  const requestGeneration = generation;
  const fileId = props.fileId;
  message.value = "";
  busy.value = true;
  try {
    const { action } = await getPrivateFileDownloadTicketCapability(fileId);
    if (requestGeneration !== generation || props.fileId !== fileId) return;
    if (action.key !== "create_private_file_download_ticket" || !action.enabled) {
      throw new Error("当前账号无权查看该版式样张");
    }
    authorizedFileId = fileId;
    mode.value = accessMode;
    visible.value = true;
  } catch (error) {
    if (requestGeneration === generation) message.value = error instanceof Error ? error.message : "读取样张权限失败";
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  if (busy.value || !authorizedFileId || !password.value.trim() || !reason.value.trim()) return;
  const requestGeneration = generation;
  const fileId = authorizedFileId;
  busy.value = true;
  message.value = "";
  try {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword: password.value, downloadReason: reason.value, accessMode: mode.value
    });
    if (requestGeneration !== generation || props.fileId !== fileId) return;
    const blob = await readPrivatePdfTicket(ticket);
    if (requestGeneration !== generation || props.fileId !== fileId) return;
    releasePreview();
    previewUrl.value = URL.createObjectURL(blob);
    if (mode.value === "preview") {
      previewVisible.value = true;
    } else {
      const anchor = document.createElement("a");
      anchor.href = previewUrl.value;
      anchor.download = ticket.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    close();
  } catch (error) {
    if (requestGeneration === generation) message.value = error instanceof Error ? error.message : "读取样张失败";
  } finally {
    busy.value = false;
  }
}
function cleanup() { close(); releasePreview(); }
watch(() => props.fileId, cleanup);
onUnmounted(cleanup);
</script>

<style scoped>
.pdf-actions { display: inline-flex; flex-wrap: wrap; gap: var(--jg-space-xs); }
</style>
