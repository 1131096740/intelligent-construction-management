<script setup lang="ts">
import { computed } from "vue";
import {
  normalizeEmptyBusinessStateActions,
  type EmptyBusinessStateAction
} from "./empty-business-state.config";

const props = defineProps<{
  title: string;
  description: string;
  actions?: EmptyBusinessStateAction[];
}>();

const visibleActions = computed(() => normalizeEmptyBusinessStateActions(props.actions ?? []));
</script>

<template>
  <t-card
    class="empty-business-state"
    bordered
  >
    <t-empty
      :title="title"
      :description="description"
    >
      <template #actions>
        <t-space v-if="visibleActions.length">
          <router-link
            v-for="action in visibleActions"
            :key="action.label"
            :to="action.to ?? '/'"
          >
            <t-button variant="outline">
              {{ action.label }}
            </t-button>
          </router-link>
        </t-space>
      </template>
    </t-empty>
  </t-card>
</template>

<style scoped>
.empty-business-state {
  background: var(--jg-color-bg-panel);
}
</style>
