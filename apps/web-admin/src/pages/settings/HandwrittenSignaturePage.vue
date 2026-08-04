<template>
  <main class="handwritten-signature-page">
    <t-card
      title="手机手写签名"
      :bordered="true"
    >
      <t-alert
        v-if="message"
        :theme="messageTone"
        :message="message"
      />
      <JgSignaturePanel
        v-if="ready && !completed && handoffActionEnabled('complete_canvas_signature_handoff')"
        preview-url=""
        :busy="busy"
        @save="complete"
      />
    </t-card>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { useRoute } from "vue-router";
import { completeCanvasSignatureHandoff, getCanvasSignatureHandoff } from "../../api/core-flow-read.api";
import JgSignaturePanel from "../../components/JgSignaturePanel.vue";

const route = useRoute();
const token = typeof route.query.handoff === "string" ? route.query.handoff : "";
const busy = ref(false);
const ready = ref(false);
const completed = ref(false);
const handoffAvailableActions = shallowRef<Array<"complete_canvas_signature_handoff"> | null>(null);
const message = ref("");
const messageTone = ref<"error" | "success">("error");
let handoffCompletionPromise: Promise<void> | null = null;

function handoffActionEnabled(key: "complete_canvas_signature_handoff") {
  return handoffAvailableActions.value !== null
    && handoffAvailableActions.value.includes(key);
}

onMounted(async () => {
  if (!token) { message.value = "签名二维码无效或已失效，请在电脑端重新生成。"; return; }
  try {
    const handoff = await getCanvasSignatureHandoff(token);
    handoffAvailableActions.value = handoff.availableActions;
    if (handoff.completedAt) { completed.value = true; messageTone.value = "success"; message.value = "该二维码已完成手写签名，请回到电脑端继续。"; }
    else ready.value = handoffActionEnabled("complete_canvas_signature_handoff");
  } catch (error) { message.value = error instanceof Error ? error.message : "签名二维码已失效，请在电脑端重新生成。"; }
});

function complete(file: File) {
  if (handoffCompletionPromise) return handoffCompletionPromise;
  busy.value = true;
  const request = completeCanvasSignatureHandoff(token, file);
  handoffCompletionPromise = request
    .then(() => {
      completed.value = true;
      handoffAvailableActions.value = null;
      messageTone.value = "success";
      message.value = "手写签名已完成，请回到电脑端继续。";
    })
    .catch((error: unknown) => {
      message.value = error instanceof Error ? error.message : "保存手写签名失败";
    })
    .finally(() => {
      busy.value = false;
      handoffCompletionPromise = null;
    });
  return handoffCompletionPromise;
}
</script>

<style scoped>
.handwritten-signature-page { min-height: 100vh; padding: var(--jg-space-lg); background: var(--jg-color-bg-page); }
</style>
