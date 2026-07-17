<template>
  <section
    class="participant-select"
    aria-labelledby="settlement-participant-title"
  >
    <div class="participant-copy">
      <strong id="settlement-participant-title">项目现场复核人</strong>
      <span>{{ routeDescription }}</span>
    </div>
    <t-select
      :value="modelValue"
      :options="selectOptions"
      :loading="loading"
      :disabled="disabled || loading"
      :placeholder="placeholder"
      clearable
      @change="onChange"
    />
    <t-alert
      v-if="loadError"
      theme="error"
      :message="`${loadError}。未读取到候选人时不能提交，请重试。`"
    />
    <t-button
      v-if="loadError"
      variant="outline"
      @click="$emit('retry')"
    >
      重试读取
    </t-button>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

export interface SettlementApprovalParticipantOption {
  userId: string;
  name: string;
  roleKey: "material_staff" | "engineering_foreman" | "engineering_tech";
  roleLabel: string;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  routeType: "material_mechanical" | "labor_professional" | "";
  options: readonly SettlementApprovalParticipantOption[];
  loading?: boolean;
  disabled?: boolean;
  loadError?: string;
}>(), {
  loading: false,
  disabled: false,
  loadError: ""
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [option: SettlementApprovalParticipantOption | null];
  retry: [];
}>();

const routeDescription = computed(() => {
  if (props.routeType === "material_mechanical") {
    return "材料、机械结算由所属项目的物资员复核。";
  }
  if (props.routeType === "labor_professional") {
    return "劳务、专业分包结算由所属项目的工长或施工员复核。";
  }
  return "选择有效合同后，系统只显示该项目符合审批路线的人员。";
});

const placeholder = computed(() => {
  if (props.loading) return "正在读取项目人员……";
  if (!props.routeType) return "请先选择有效合同";
  if (!props.options.length) return "当前项目没有可选现场复核人";
  return "请选择现场复核人";
});

const selectOptions = computed(() =>
  props.options.map((item) => ({
    value: item.userId,
    label: `${item.name} · ${item.roleLabel}`
  }))
);

function onChange(value: unknown) {
  const normalized = typeof value === "string" ? value : "";
  emit("update:modelValue", normalized);
  emit("change", props.options.find((item) => item.userId === normalized) ?? null);
}
</script>

<style scoped>
.participant-select {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(280px, 420px);
  align-items: center;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg) 0;
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.participant-copy {
  display: grid;
  gap: var(--jg-space-xs);
}

.participant-copy strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.participant-copy span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.participant-select > :deep(.t-alert) {
  grid-column: 1 / -1;
}

@container jg-page (max-width: 760px) {
  .participant-select {
    grid-template-columns: 1fr;
  }
}
</style>
