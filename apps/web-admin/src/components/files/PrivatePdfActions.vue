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
    v-if="message"
    role="alert"
  >{{ message }}</span>
</template>

<script setup lang="ts">
import { formatUnknownApiError } from "../../api/error-message";
import { defineAsyncComponent, onUnmounted, ref } from "vue";
import {
  downloadPrivateFileByTicket,
  getPrivateFileDownloadTicketCapability
} from "../../api/core-flow-read.api";

const LayoutPdfPreview = defineAsyncComponent(() => import("./LayoutPdfPreview.vue"));

const props = defineProps<{ fileId: string }>();
const previewVisible = ref(false);
const previewUrl = ref("");
function releasePreview() {
  previewVisible.value = false;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
}
const busy = ref(false);
const message = ref("");

async function downloadSampleWithCapability(fileId: string, accessMode: "preview" | "download") {
  const capability = await getPrivateFileDownloadTicketCapability(fileId);
  const operationAllowed = capability.availableActions.includes(
    "create_private_file_download_ticket"
  );
  if (!operationAllowed) throw new Error("当前账号无权查看该版式样张");
  return downloadPrivateFileByTicket(fileId, { accessMode }, "pdf-blob");
}

async function open(accessMode: "preview" | "download") {
  if (busy.value) return;
  const fileId = props.fileId;
  message.value = "";
  busy.value = true;
  try {
    const result = await downloadSampleWithCapability(fileId, accessMode);
    if (!result) throw new Error("读取版式样张失败");
    releasePreview();
    previewUrl.value = URL.createObjectURL(result.blob);
    if (accessMode === "preview") {
      previewVisible.value = true;
    } else {
      const anchor = document.createElement("a");
      anchor.href = previewUrl.value;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      releasePreview();
    }
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取样张失败");
  } finally {
    busy.value = false;
  }
}

onUnmounted(releasePreview);
</script>

<style scoped>
.pdf-actions {
  display: inline-flex;
  gap: 8px;
}
</style>
