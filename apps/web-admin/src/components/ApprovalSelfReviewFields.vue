<template>
  <div
    v-if="required"
    class="approval-self-review-fields"
  >
    <t-alert
      theme="warning"
      title="领导自审二次确认"
      message="当前单据由您本人发起，且已进入您直接持有的董事长/总经理终审节点。请说明自审原因并输入当前密码。"
    />
    <t-textarea
      v-model="reasonModel"
      placeholder="请填写独立的自审原因"
    />
    <t-input
      v-model="passwordModel"
      type="password"
      autocomplete="current-password"
      placeholder="请输入当前密码"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  required: boolean;
  selfReviewReason: string;
  confirmationPassword: string;
}>();

const emit = defineEmits<{
  "update:selfReviewReason": [value: string];
  "update:confirmationPassword": [value: string];
}>();

const reasonModel = computed({
  get: () => props.selfReviewReason,
  set: (value: string) => emit("update:selfReviewReason", value)
});
const passwordModel = computed({
  get: () => props.confirmationPassword,
  set: (value: string) => emit("update:confirmationPassword", value)
});
</script>

<style scoped>
.approval-self-review-fields {
  display: grid;
  gap: var(--jg-space-sm);
}
</style>
