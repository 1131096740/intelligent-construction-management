<script setup lang="ts">
import { computed } from "vue";
import BusinessStatusSummary from "../../../components/BusinessStatusSummary.vue";

const props = defineProps<{
  total: number | null;
  draft: number | null;
  pending: number | null;
  inProgress: number | null;
  closed: number | null;
}>();

const items = computed(() => [
  { label: "采购单", value: metric(props.total) },
  { label: "草稿", value: metric(props.draft) },
  {
    label: "审批中",
    value: metric(props.pending),
    tone: "warning" as const
  },
  {
    label: "办理中",
    value: metric(props.inProgress),
    tone: "primary" as const
  },
  {
    label: "已办结",
    value: metric(props.closed),
    tone: "success" as const
  }
]);

function metric(value: number | null) {
  return value === null ? "—" : String(value);
}
</script>

<template>
  <BusinessStatusSummary
    :items="items"
    appearance="metrics"
  />
</template>
