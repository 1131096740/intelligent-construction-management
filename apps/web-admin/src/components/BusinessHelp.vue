<script setup lang="ts">
import { onMounted, ref } from "vue";
defineProps<{ text: string; label?: string }>();
const visible = ref(false);
const trigger = ref<"hover" | "click">("click");
onMounted(() => { trigger.value = window.matchMedia('(hover: hover)').matches ? "hover" : "click"; });
function focusOpen(event: FocusEvent) {
  if ((event.target as HTMLElement)?.matches(':focus-visible')) visible.value = true;
}
function preventFormSubmission(event: MouseEvent) { event.preventDefault(); }
</script>

<template>
  <t-popup
    v-model:visible="visible"
    :trigger="trigger"
    placement="bottom-left"
    overlay-inner-class-name="jg-business-help-content"
    :content="text"
  >
    <t-button
      class="business-help"
      variant="text"
      shape="circle"
      :aria-label="label ? `${label}填写说明` : '填写说明'"
      :aria-expanded="visible"
      @focus="focusOpen"
      @blur="visible = false"
      @keydown.esc.stop="visible = false"
      @click="preventFormSubmission"
    >
      ?
    </t-button>
  </t-popup>
</template>

<style scoped>
.business-help { width: 28px; min-width: 28px; height: 28px; padding: 0; font-size: var(--jg-font-size-meta); color: var(--jg-color-text-tertiary); vertical-align: middle; }
@media (pointer: coarse) { .business-help { width: 44px; min-width: 44px; height: 44px; } }
</style>
