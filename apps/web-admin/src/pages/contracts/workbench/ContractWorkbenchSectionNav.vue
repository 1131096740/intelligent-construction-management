<template>
  <nav
    class="section-navigation"
    aria-label="合同资料章节"
  >
    <a
      v-for="section in CONTRACT_WORKBENCH_SECTIONS"
      :key="section.id"
      :href="`#${contractWorkbenchSectionAnchorId(section.id)}`"
      :class="['section-link', { active: section.id === activeId }]"
      :aria-current="section.id === activeId ? 'location' : undefined"
      :data-section-nav-id="section.id"
      @click.prevent="emit('select', section.id)"
    >
      {{ section.label }}
    </a>
  </nav>
</template>

<script setup lang="ts">
import {
  CONTRACT_WORKBENCH_SECTIONS,
  contractWorkbenchSectionAnchorId,
  type ContractWorkbenchSectionId
} from "./contract-workbench-sections";

defineProps<{
  activeId: ContractWorkbenchSectionId;
}>();

const emit = defineEmits<{
  (event: "select", id: ContractWorkbenchSectionId): void;
}>();
</script>

<style scoped>
.section-navigation {
  position: sticky;
  top: calc(var(--jg-layout-header-height) + var(--jg-space-sm));
  z-index: 3;
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-sm);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.section-link {
  min-width: 0;
  padding: var(--jg-space-sm) var(--jg-space-md);
  color: var(--jg-text-muted);
  border-left: var(--jg-border-width-accent) solid transparent;
  text-decoration: none;
}

.section-link:hover {
  color: var(--jg-brand);
  background: var(--jg-bg-muted);
}

.section-link.active {
  color: var(--jg-brand);
  background: var(--jg-bg-muted);
  border-left-color: var(--jg-brand);
  font-weight: 600;
}

@container jg-page (max-width: 1080px) {
  .section-navigation {
    position: static;
    display: flex;
    overflow-x: auto;
  }

  .section-link {
    flex: 0 0 auto;
    border-bottom: var(--jg-border-width-accent) solid transparent;
    border-left: 0;
  }

  .section-link.active {
    border-bottom-color: var(--jg-brand);
  }
}
</style>
