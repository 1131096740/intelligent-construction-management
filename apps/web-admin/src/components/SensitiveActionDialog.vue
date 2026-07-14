<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { sensitiveActionConfirmationError } from "./sensitive-action-dialog.config";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  description: string;
  confirmText?: string;
  confirmTheme?: "primary" | "danger";
  requireReason?: boolean;
  requirePassword?: boolean;
  reasonLabel?: string;
  loading?: boolean;
  error?: string;
}>(), {
  confirmText: "确认",
  confirmTheme: "primary",
  requireReason: false,
  requirePassword: false,
  reasonLabel: "操作原因",
  loading: false,
  error: ""
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  confirm: [values: { reason: string; password: string }];
  cancel: [];
}>();

const reason = ref("");
const password = ref("");
const localError = ref("");
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});

watch(
  () => props.modelValue,
  (isVisible) => {
    if (!isVisible) return;
    reason.value = "";
    password.value = "";
    localError.value = "";
  }
);

function close() {
  if (props.loading) return;
  visible.value = false;
  emit("cancel");
}

function confirm() {
  localError.value = sensitiveActionConfirmationError({
    requireReason: props.requireReason,
    reason: reason.value,
    requirePassword: props.requirePassword,
    password: password.value
  });
  if (localError.value) return;
  emit("confirm", { reason: reason.value.trim(), password: password.value });
}
</script>

<template>
  <t-dialog
    v-model:visible="visible"
    :header="title"
    :close-on-overlay-click="false"
    :close-on-esc-keydown="!loading"
    width="520px"
    @close="close"
  >
    <div class="sensitive-action-dialog">
      <t-alert
        theme="warning"
        title="请确认业务影响"
        :message="description"
      />
      <slot />
      <label v-if="requireReason">
        <span>{{ reasonLabel }} <b aria-hidden="true">*</b></span>
        <t-textarea
          v-model="reason"
          :disabled="loading"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="说明本次操作原因"
        />
      </label>
      <label v-if="requirePassword">
        <span>当前登录密码 <b aria-hidden="true">*</b></span>
        <t-input
          v-model="password"
          type="password"
          autocomplete="current-password"
          :disabled="loading"
          placeholder="用于确认当前操作者身份"
        />
      </label>
      <t-alert
        v-if="error || localError"
        theme="error"
        title="暂时无法提交"
        :message="error || localError"
      />
    </div>
    <template #footer>
      <t-button
        :disabled="loading"
        variant="outline"
        @click="close"
      >
        取消
      </t-button>
      <t-button
        :theme="confirmTheme"
        :loading="loading"
        @click="confirm"
      >
        {{ confirmText }}
      </t-button>
    </template>
  </t-dialog>
</template>

<style scoped>
.sensitive-action-dialog,
.sensitive-action-dialog label {
  display: grid;
  gap: var(--jg-space-sm);
}

.sensitive-action-dialog {
  gap: var(--jg-space-lg);
}

.sensitive-action-dialog label > span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
}

.sensitive-action-dialog b {
  color: var(--jg-color-danger);
}
</style>
