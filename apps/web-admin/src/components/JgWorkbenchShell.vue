<script setup lang="ts">
import BusinessPageHeader from "./BusinessPageHeader.vue";

defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <section class="jg-workbench-shell jg-responsive-ledger">
    <BusinessPageHeader
      :title="title"
      :description="description"
    >
      <template #actions>
        <slot name="actions" />
      </template>
    </BusinessPageHeader>

    <section
      v-if="$slots.filters"
      class="jg-workbench-shell__filters"
      aria-label="筛选条件"
    >
      <slot name="filters" />
    </section>

    <section
      v-if="$slots.summary"
      class="jg-workbench-shell__summary"
      aria-label="结果摘要"
    >
      <slot name="summary" />
    </section>

    <section class="jg-workbench-shell__content">
      <slot />
    </section>
  </section>
</template>

<style scoped>
.jg-workbench-shell {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
  container-name: jg-workbench-shell;
  container-type: inline-size;
}

.jg-workbench-shell__filters,
.jg-workbench-shell__summary,
.jg-workbench-shell__content {
  min-width: 0;
}

@container jg-workbench-shell (max-width: 620px) {
  .jg-workbench-shell {
    gap: var(--jg-space-md);
  }
}
</style>
