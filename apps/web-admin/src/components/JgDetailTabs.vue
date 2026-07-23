<script setup lang="ts">
import { computed } from "vue";

export interface JgDetailTab {
  value: string;
  label: string;
}

const props = defineProps<{
  modelValue: string;
  tabs: readonly JgDetailTab[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const selected = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value)
});
</script>

<template>
  <nav
    class="detail-navigation jg-detail-tabs"
    aria-label="详情分区"
  >
    <t-tabs v-model="selected">
      <t-tab-panel
        v-for="tab in tabs"
        :key="tab.value"
        :value="tab.value"
        :label="tab.label"
      />
    </t-tabs>
  </nav>
</template>

<style scoped>
.jg-detail-tabs {
  position: sticky;
  top: 0;
  z-index: 1;
  min-width: 0;
  background: var(--jg-color-bg-page);
}

.jg-detail-tabs :deep(.t-tabs__nav-scroll) {
  overflow-x: auto;
}
</style>
