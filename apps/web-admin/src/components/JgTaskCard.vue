<script setup lang="ts">
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import BusinessActionPanel from "./BusinessActionPanel.vue";

defineProps<{
  actions: DetailActionReadModel[];
}>();
</script>

<template>
  <section
    class="jg-task-card"
    aria-label="当前办理"
  >
    <BusinessActionPanel :actions="actions" />
  </section>
</template>
