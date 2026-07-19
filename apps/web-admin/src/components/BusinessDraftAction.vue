<script setup lang="ts">
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import { computed, ref } from "vue";
import SensitiveActionDialog from "./SensitiveActionDialog.vue";
import {
  toBusinessDraftActionItems,
  type BusinessDraftActionItem
} from "./business-draft-action.config";

export interface BusinessDraftActionSubject {
  businessCode: string;
  name: string;
  lastSavedAt: string;
  impactScope: string;
}

export interface BusinessDraftActionRequest {
  action: BusinessDraftActionItem["key"];
  reason: string;
  password: string;
}

const props = withDefaults(defineProps<{
  actions: DetailActionReadModel[];
  subject: BusinessDraftActionSubject;
  blockedReason?: string | null;
  blockedReasons?: string[];
  execute: (request: BusinessDraftActionRequest) => Promise<void>;
}>(), {
  blockedReason: null,
  blockedReasons: () => []
});

const emit = defineEmits<{
  completed: [action: BusinessDraftActionItem["key"]];
}>();

const actionItems = computed(() => toBusinessDraftActionItems(props.actions));
const enabledActionItems = computed(() => actionItems.value.filter((action) => action.enabled));
const allBlockedReasons = computed(() =>
  Array.from(new Set([
    ...(props.blockedReason ? [props.blockedReason] : []),
    ...props.blockedReasons,
    ...actionItems.value.flatMap((action) =>
      !action.enabled && action.disabledReason ? [action.disabledReason] : []
    )
  ]))
);
const selectedAction = ref<BusinessDraftActionItem | null>(null);
const loading = ref(false);
const error = ref("");

function selectAction(action: BusinessDraftActionItem) {
  if (!action.enabled || loading.value) return;
  error.value = "";
  selectedAction.value = action;
}

function closeDialog() {
  if (loading.value) return;
  selectedAction.value = null;
  error.value = "";
}

async function executeAction(values: { reason: string; password: string }) {
  const action = selectedAction.value;
  if (!action || loading.value) return;

  loading.value = true;
  error.value = "";
  try {
    await props.execute({ action: action.key, ...values });
    selectedAction.value = null;
    emit("completed", action.key);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "操作未完成，请稍后重试";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section
    v-if="enabledActionItems.length || allBlockedReasons.length"
    class="business-draft-action"
  >
    <t-alert
      v-for="reason in allBlockedReasons"
      :key="reason"
      theme="warning"
      title="当前操作受阻"
      :message="reason"
    />

    <div
      v-for="action in enabledActionItems"
      :key="action.key"
      class="business-draft-action__item"
    >
      <t-button
        theme="danger"
        :disabled="!action.enabled || loading"
        :loading="loading && selectedAction?.key === action.key"
        @click="selectAction(action)"
      >
        {{ action.label }}
      </t-button>
    </div>
  </section>

  <SensitiveActionDialog
    :model-value="Boolean(selectedAction)"
    :title="selectedAction?.label ?? '确认操作'"
    :description="selectedAction?.description ?? ''"
    :confirm-text="selectedAction?.confirmText"
    confirm-theme="danger"
    :require-reason="selectedAction?.requireReason"
    :require-password="selectedAction?.requirePassword"
    :loading="loading"
    :error="error"
    @update:model-value="(value) => { if (!value) closeDialog(); }"
    @cancel="closeDialog"
    @confirm="executeAction"
  >
    <slot
      name="subject"
      :subject="subject"
    >
      <dl class="business-draft-action__subject">
        <div>
          <dt>业务编号</dt>
          <dd>{{ subject.businessCode }}</dd>
        </div>
        <div>
          <dt>业务名称</dt>
          <dd>{{ subject.name }}</dd>
        </div>
        <div>
          <dt>最后保存时间</dt>
          <dd>{{ subject.lastSavedAt }}</dd>
        </div>
        <div>
          <dt>影响范围</dt>
          <dd>{{ subject.impactScope }}</dd>
        </div>
      </dl>
    </slot>
  </SensitiveActionDialog>
</template>

<style scoped>
.business-draft-action {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--jg-space-sm);
}

.business-draft-action__item {
  display: grid;
  gap: var(--jg-space-xs);
}

.business-draft-action__subject dt {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
}

.business-draft-action__subject {
  display: grid;
  gap: var(--jg-space-sm);
  margin: 0;
}

.business-draft-action__subject div {
  display: grid;
  grid-template-columns: minmax(96px, auto) 1fr;
  gap: var(--jg-space-md);
}

.business-draft-action__subject dd {
  min-width: 0;
  margin: 0;
  color: var(--jg-color-text-primary);
  overflow-wrap: anywhere;
}
</style>
