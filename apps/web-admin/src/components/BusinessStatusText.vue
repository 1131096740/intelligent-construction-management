<script setup lang="ts">
import { computed } from "vue";
import {
  normalizeBusinessStatusSemantic,
  type BusinessStatusSemantic
} from "./business-status-text.config";

const props = withDefaults(defineProps<{
  text: string;
  semantic?: BusinessStatusSemantic;
}>(), {
  semantic: "neutral"
});

const normalizedSemantic = computed(() =>
  normalizeBusinessStatusSemantic(props.semantic)
);
</script>

<template>
  <span
    class="business-status-text"
    :class="`business-status-text--${normalizedSemantic}`"
  >
    <span
      class="business-status-text__dot"
      aria-hidden="true"
    />
    <span>{{ text }}</span>
  </span>
</template>

<style scoped>
.business-status-text {
  display: inline-flex;
  gap: var(--jg-space-sm);
  align-items: center;
  min-width: 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-table-secondary);
  line-height: var(--jg-line-height-body);
}

.business-status-text__dot {
  width: var(--jg-layout-dot-sm);
  height: var(--jg-layout-dot-sm);
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--jg-color-text-muted);
}

.business-status-text--progress .business-status-text__dot {
  background: var(--jg-color-warning);
}

.business-status-text--required .business-status-text__dot {
  background: var(--jg-color-required);
}

.business-status-text--success .business-status-text__dot {
  background: var(--jg-color-success);
}

.business-status-text--danger .business-status-text__dot {
  background: var(--jg-color-danger);
}
</style>
