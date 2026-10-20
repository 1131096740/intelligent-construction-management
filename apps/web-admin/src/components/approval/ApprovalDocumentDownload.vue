<template>
  <t-button
    v-if="available"
    variant="outline"
    @click="open"
  >
    下载审批单 PDF
  </t-button>
  <t-dialog
    v-model:visible="visible"
    header="下载审批单"
    :confirm-btn="{ content: '下载 PDF', loading: downloading, disabled: !password || !reason.trim() }"
    :close-on-overlay-click="false"
    @confirm="download"
    @close="password = ''"
  >
    <t-form label-align="top">
      <t-form-item label="留存用途">
        <t-input
          v-model="reason"
          placeholder="例如：公司纸质归档"
        />
      </t-form-item>
      <t-form-item label="当前登录密码">
        <t-input
          v-model="password"
          type="password"
          autocomplete="current-password"
        />
      </t-form-item>
    </t-form>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
  </t-dialog>
</template>
<script setup lang="ts">
import { ref, watch } from "vue";
import { approvalDocumentCapability } from "../../api/approval-forms.api";
import { downloadApprovalForm } from "../../api/core-flow-read.api";
const props = defineProps<{ businessType: string; businessId: string; refreshKey?: unknown }>();
const available = ref(false);
const visible = ref(false);
const downloading = ref(false);
const password = ref("");
const reason = ref("公司纸质归档");
const error = ref("");
let request = 0;
watch(() => [props.businessType, props.businessId, props.refreshKey], async () => {
  const token = ++request;
  available.value = false;
  visible.value = false;
  password.value = "";
  error.value = "";
  if (!props.businessId) return;
  try {
    const capability = await approvalDocumentCapability(props.businessType, props.businessId);
    if (request === token) available.value = capability.available;
  } catch { if (request === token) available.value = false; }
}, { immediate: true });
function open() { password.value = ""; error.value = ""; visible.value = true; }
async function download() {
  if (downloading.value || !password.value || !reason.value.trim()) return;
  downloading.value = true;
  error.value = "";
  try {
    await downloadApprovalForm(props.businessType, props.businessId, { confirmationPassword: password.value, downloadReason: reason.value.trim() });
    visible.value = false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "下载失败，请重试"; }
  finally { password.value = ""; downloading.value = false; }
}
</script>
