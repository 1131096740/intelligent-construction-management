<script setup lang="ts">
import type { BusinessSummaryTone } from "./business-status-summary.config";
import BusinessDetailHeader from "./BusinessDetailHeader.vue";

const props = withDefaults(defineProps<{
  businessCode: string;
  title: string;
  status: string;
  statusTone?: BusinessSummaryTone;
  owner: string;
  currentNode: string;
  nextStep: string;
  requestedAmount?: string;
  amountLabel?: string;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
}>(), {
  statusTone: "default",
  requestedAmount: "",
  amountLabel: "申请金额",
  primaryActionLabel: "",
  primaryActionDisabled: false
});

const emit = defineEmits<{
  "primary-action": [];
}>();
</script>

<template>
  <BusinessDetailHeader
    :business-code="props.businessCode"
    :title="props.title"
    :status="props.status"
    :status-tone="props.statusTone"
    :owner="props.owner"
    :current-node="props.currentNode"
    :next-step="props.nextStep"
    :requested-amount="props.requestedAmount"
    :amount-label="props.amountLabel"
    :primary-action-label="props.primaryActionLabel"
    :primary-action-disabled="props.primaryActionDisabled"
    @primary-action="emit('primary-action')"
  >
    <template #actions>
      <slot name="actions" />
    </template>
  </BusinessDetailHeader>
</template>
