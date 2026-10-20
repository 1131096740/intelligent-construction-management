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
    v-if="layoutPdfAction && layoutPdfAction.enabled"
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
import { formatUnknownApiError } from "../../api/error-message";
import { defineAsyncComponent, onUnmounted, ref, shallowRef, watch } from "vue";
import { downloadPrivateFileByTicket, getPrivateFileDownloadTicketCapability } from "../../api/core-flow-read.api";

const LayoutPdfPreview = defineAsyncComponent(() => import("./LayoutPdfPreview.vue"));

const props = defineProps<{ fileId: string }>();
const visible = ref(false);
const layoutPdfAction = shallowRef<{ key: "create_private_file_download_ticket"; enabled: boolean } | null>(null);
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
  layoutPdfAction.value = null;
}

async function open(accessMode: "preview" | "download") {
  if (busy.value) return;
  close();
  const requestGeneration = generation;
  const fileId = props.fileId;
  message.value = "";
  busy.value = true;
  try {
    const capability = await getPrivateFileDownloadTicketCapability(fileId);
    if (requestGeneration !== generation || props.fileId !== fileId) return;
    layoutPdfAction.value = capability.action;
    const matchesRequestedAction = layoutPdfAction.value.key === "create_private_file_download_ticket";
    if (!matchesRequestedAction) {
      throw new Error("样张读取权限未就绪，请重新打开");
    }
    if (!layoutPdfAction.value.enabled) {
      throw new Error("当前账号无权查看该版式样张");
    }
    authorizedFileId = fileId;
    mode.value = accessMode;
    visible.value = true;
  } catch (error) {
    if (requestGeneration === generation) message.value = formatUnknownApiError(error, "读取样张权限失败");
  } finally {
    busy.value = false;
  }
}

async function readSampleWithCapability(fileId: string) {
  const capability = await getPrivateFileDownloadTicketCapability(fileId);
  const operationAllowed = capability.availableActions.includes("create_private_file_download_ticket");
  if (!operationAllowed) throw new Error("当前账号无权查看该版式样张");
  return downloadPrivateFileByTicket(fileId, {
    confirmationPassword: password.value, downloadReason: reason.value, accessMode: mode.value
  }, "pdf-blob");
}

async function confirm() {
  if (busy.value || !authorizedFileId || !password.value.trim() || !reason.value.trim()) return;
  if (!layoutPdfAction.value?.enabled) return;
  const requestGeneration = generation;
  const fileId = authorizedFileId;
  busy.value = true;
  message.value = "";
  try {
    const result = await readSampleWithCapability(fileId);
    if (requestGeneration !== generation || props.fileId !== fileId) return;
    if (!result) throw new Error("读取版式样张失败");
    releasePreview();
    previewUrl.value = URL.createObjectURL(result.blob);
    if (mode.value === "preview") {
      previewVisible.value = true;
    } else {
      const anchor = document.createElement("a");
      anchor.href = previewUrl.value;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    close();
  } catch (error) {
    if (requestGeneration === generation) message.value = formatUnknownApiError(error, "读取样张失败");
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
