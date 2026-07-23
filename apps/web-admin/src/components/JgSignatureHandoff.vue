<template>
  <section
    class="jg-signature-handoff"
    aria-label="扫码手写签名"
  >
    <p>请使用手机扫描二维码，并以当前同一账号完成手写签名。二维码五分钟内有效，仅可完成一次。</p>
    <img
      v-if="qrCodeUrl"
      :src="qrCodeUrl"
      alt="手机手写签名二维码"
    >
    <t-alert
      v-if="message"
      :theme="completed ? 'success' : 'warning'"
      :message="message"
    />
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { toDataURL } from "qrcode";
import { createCanvasSignatureHandoff, getCanvasSignatureHandoff } from "../api/core-flow-read.api";

const emit = defineEmits<{ completed: [] }>();
const qrCodeUrl = ref("");
const message = ref("");
const completed = ref(false);
let timer: number | undefined;
let token = "";

async function refresh() {
  if (!token || completed.value) return;
  try {
    const handoff = await getCanvasSignatureHandoff(token);
    if (!handoff.completedAt) return;
    completed.value = true;
    message.value = "手机端已完成手写签名，现在起可用于之后的审批。";
    window.clearInterval(timer);
    emit("completed");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "签名二维码已失效，请刷新页面重新生成。";
    window.clearInterval(timer);
  }
}

onMounted(async () => {
  try {
    const handoff = await createCanvasSignatureHandoff();
    token = handoff.token;
    qrCodeUrl.value = await toDataURL(new URL(`/手写签名?handoff=${encodeURIComponent(token)}`, window.location.origin).toString(), { margin: 1, width: 240 });
    timer = window.setInterval(refresh, 5_000);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "签名二维码生成失败，请重试。";
  }
});
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<style scoped>
.jg-signature-handoff { display: grid; gap: var(--jg-space-md); justify-items: start; }
.jg-signature-handoff p { margin: 0; color: var(--jg-color-text-secondary); }
.jg-signature-handoff img { width: 240px; max-width: 100%; border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-md); }
</style>
