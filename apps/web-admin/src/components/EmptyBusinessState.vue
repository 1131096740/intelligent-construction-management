<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  normalizeEmptyBusinessStateActions,
  type EmptyBusinessStateAction
} from "./empty-business-state.config";

const props = defineProps<{
  title: string;
  description: string;
  actions?: EmptyBusinessStateAction[];
}>();

const router = useRouter();
const visibleActions = computed(() => normalizeEmptyBusinessStateActions(props.actions ?? []));

function openAction(to: string) {
  void router.push(to);
}
</script>

<template>
  <t-empty
    :title="title"
    :description="description"
  >
    <template #actions>
      <t-space v-if="visibleActions.length">
        <t-button
          v-for="action in visibleActions"
          :key="action.label"
          variant="outline"
          @click="openAction(action.to)"
        >
          {{ action.label }}
        </t-button>
      </t-space>
    </template>
  </t-empty>
</template>
