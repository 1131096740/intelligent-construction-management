<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  state: "loading" | "error" | "success" | "info" | "permission";
  title: string;
  description: string;
  actionLabel?: string;
}>();

const emit = defineEmits<{
  action: [];
}>();

const theme = computed(() => {
  if (props.state === "error" || props.state === "permission") return "error";
  if (props.state === "success") return "success";
  return "info";
});
</script>

<template>
  <div
    class="business-feedback"
    :aria-busy="state === 'loading'"
  >
    <t-alert
      :theme="theme"
      :title="title"
      :message="description"
    />
    <t-button
      v-if="actionLabel"
      class="business-feedback__action"
      size="small"
      variant="outline"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </t-button>
  </div>
</template>

<style scoped>
.business-feedback {
  position: relative;
}

.business-feedback__action {
  position: absolute;
  top: var(--jg-space-sm);
  right: var(--jg-space-sm);
}
</style>
