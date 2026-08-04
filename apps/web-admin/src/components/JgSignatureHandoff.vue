<template>
  <section
    class="jg-signature-handoff"
    aria-label="扫码手写签名"
  >
    <p>请使用手机扫描二维码，并以当前同一账号完成手写签名。二维码五分钟内有效，仅可完成一次。</p>
    <t-button
      v-if="!qrCodeUrl && signatureActionEnabled('create_canvas_signature_handoff')"
      theme="primary"
      :loading="creatingHandoff"
      @click="createAuthorizedCanvasSignatureHandoff"
    >
      生成手写签名二维码
    </t-button>
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
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { toDataURL } from "qrcode";
import {
  createCanvasSignatureHandoff,
  getCanvasSignatureCapabilities,
  getCanvasSignatureHandoff
} from "../api/core-flow-read.api";

const emit = defineEmits<{ completed: [] }>();
const qrCodeUrl = ref("");
const message = ref("");
const completed = ref(false);
const creatingHandoff = ref(false);
const signatureAvailableActions = shallowRef<Array<
  "upload_canvas_signature" | "create_canvas_signature_handoff"
> | null>(null);
let timer: number | undefined;
let token = "";
let createHandoffPromise: Promise<void> | null = null;

function signatureActionEnabled(key: "create_canvas_signature_handoff") {
  return signatureAvailableActions.value !== null
    && signatureAvailableActions.value.includes(key);
}

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

async function loadCanvasSignatureCapabilities() {
  try {
    const capability = await getCanvasSignatureCapabilities();
    signatureAvailableActions.value = capability.availableActions;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "签名二维码生成失败，请重试。";
  }
}

function createAuthorizedCanvasSignatureHandoff() {
  if (createHandoffPromise) return createHandoffPromise;
  creatingHandoff.value = true;
  const request = createCanvasSignatureHandoff();
  createHandoffPromise = request
    .then(async (handoff) => {
      token = handoff.token;
      qrCodeUrl.value = await toDataURL(new URL(`/手写签名?handoff=${encodeURIComponent(token)}`, window.location.origin).toString(), { margin: 1, width: 240 });
      timer = window.setInterval(refresh, 5_000);
    })
    .catch((error: unknown) => {
      message.value = error instanceof Error ? error.message : "签名二维码生成失败，请重试。";
    })
    .finally(() => {
      creatingHandoff.value = false;
      createHandoffPromise = null;
    });
  return createHandoffPromise;
}

onMounted(loadCanvasSignatureCapabilities);
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<style scoped>
.jg-signature-handoff { display: grid; gap: var(--jg-space-md); justify-items: start; }
.jg-signature-handoff p { margin: 0; color: var(--jg-color-text-secondary); }
.jg-signature-handoff img { width: 240px; max-width: 100%; border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-md); }
</style>
