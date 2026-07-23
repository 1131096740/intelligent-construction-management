<script setup lang="ts">
import type { ApprovalTimelineItemReadModel } from "@jiangkong/shared-domain";
import ApprovalTimeline from "./ApprovalTimeline.vue";

defineProps<{
  items: ApprovalTimelineItemReadModel[];
}>();
</script>

<template>
  <section
    class="jg-approval-timeline"
    aria-label="审批历程"
  >
    <ApprovalTimeline :items="items" />
  </section>
</template>
