<script setup lang="ts">
import type { AdminNavigationGroup } from "../routes/route-records";
defineProps<{ groups: AdminNavigationGroup[]; activePath: string; counts: Record<string, number> }>();
const emit = defineEmits<{ navigate: [path: string] }>();
</script>

<template>
  <nav
    class="business-navigation"
    aria-label="业务导航"
  >
    <section
      v-for="group in groups"
      :key="group.label"
    >
      <h2>{{ group.label }}</h2>
      <t-button
        v-for="item in group.items"
        :key="item.path"
        variant="text"
        :class="['business-navigation__item', { 'is-active': activePath === item.path }]"
        :aria-current="activePath === item.path ? 'page' : undefined"
        @click="emit('navigate', item.path)"
      >
        <span>{{ item.label }}</span>
        <t-badge
          v-if="counts[item.path]"
          :count="counts[item.path]"
          :max-count="99"
        />
      </t-button>
    </section>
  </nav>
</template>

<style scoped>
.business-navigation { padding: var(--jg-space-lg) var(--jg-space-md) var(--jg-space-xxl); }
.business-navigation section + section { margin-top: var(--jg-space-section); }
.business-navigation h2 { margin: 0 0 var(--jg-space-xs); padding: 0 var(--jg-space-md); font-size: var(--jg-font-size-meta); line-height: var(--jg-line-height-body); color: var(--jg-color-text-tertiary); font-weight: var(--jg-font-weight-medium); }
.business-navigation__item { width: 100%; height: auto; min-height: 38px; text-align: left; padding: var(--jg-space-sm) var(--jg-space-md); border-radius: var(--jg-radius-control); white-space: normal; color: var(--jg-color-text-secondary); }
.business-navigation__item :deep(.t-button__text) { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-sm); }
.business-navigation__item.is-active { background: var(--jg-color-bg-brand-soft); color: var(--jg-color-brand); font-weight: var(--jg-font-weight-semibold); }
@media (max-width: 720px) { .business-navigation__item { min-height: 44px; } }
</style>
