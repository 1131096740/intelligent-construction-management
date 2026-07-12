<template>
  <section
    class="template-panel"
    aria-label="结算模板匹配"
  >
    <div class="template-copy">
      <strong>结算模板</strong>
      <span>{{ state.message }}</span>
    </div>
    <t-loading
      v-if="state.mode === 'loading'"
      text="正在匹配已发布模板……"
      size="small"
    />
    <t-alert
      v-else-if="state.mode === 'blocked'"
      theme="error"
      :message="state.message"
    />
    <div
      v-else-if="state.mode === 'automatic'"
      class="template-selected"
    >
      <t-tag
        theme="success"
        variant="light"
      >
        已自动匹配
      </t-tag>
      <strong>{{ selectedLabel }}</strong>
      <span>{{ selectedReasons }}</span>
    </div>
    <div
      v-else-if="state.mode === 'choice_required'"
      class="template-choice"
    >
      <t-select
        :value="state.selectedVersionId"
        :options="options"
        placeholder="请选择兼容的结算模板"
        @change="$emit('select', String($event ?? ''))"
      />
      <span v-if="selectedReasons">{{ selectedReasons }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SettlementTemplateSelectionState } from "../../settlement-templates/settlement-template.state";

const props = defineProps<{ state: SettlementTemplateSelectionState }>();
defineEmits<{ select: [value: string] }>();

const options = computed(() =>
  props.state.choices.map((choice) => ({
    label: `${choice.templateName} · V${choice.versionNo}`,
    value: choice.templateVersionId
  }))
);
const selected = computed(() =>
  props.state.choices.find((choice) => choice.templateVersionId === props.state.selectedVersionId)
);
const selectedLabel = computed(() =>
  selected.value ? `${selected.value.templateName} · V${selected.value.versionNo}` : ""
);
const selectedReasons = computed(() => selected.value?.reasons.join("；") ?? "");
</script>

<style scoped>
.template-panel,
.template-selected,
.template-choice {
  display: flex;
  align-items: center;
  gap: var(--jg-space-md);
}

.template-panel {
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: var(--jg-space-md);
  padding: var(--jg-space-md) var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.template-copy {
  display: grid;
  min-width: 220px;
  gap: var(--jg-space-xs);
}

.template-copy span,
.template-selected span,
.template-choice span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.template-selected,
.template-choice {
  flex: 1;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.template-choice :deep(.t-select__wrap) {
  width: 360px;
}

@media (max-width: 1100px) {
  .template-selected,
  .template-choice {
    justify-content: flex-start;
  }
}
</style>
