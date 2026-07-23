<script setup lang="ts">
import { computed } from "vue";
import type { BusinessSummaryTone } from "./business-status-summary.config";
import { toJgStatusTagView } from "./jg-status-tag.config";

const props = withDefaults(defineProps<{
  label: string;
  tone?: BusinessSummaryTone;
  size?: "small" | "medium";
}>(), {
  tone: "default",
  size: "small"
});

const view = computed(() => toJgStatusTagView(props.label, props.tone));
</script>

<template>
  <t-tag
    class="jg-status-tag"
    :size="size"
    :theme="view.tone"
    variant="light"
  >
    {{ view.label }}
  </t-tag>
</template>

<style scoped>
.jg-status-tag {
  width: max-content;
  max-width: 100%;
}
</style>
