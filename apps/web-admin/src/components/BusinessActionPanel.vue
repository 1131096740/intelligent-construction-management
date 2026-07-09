<template>
  <section class="business-action-panel">
    <header class="business-action-panel__head">
      <div>
        <strong>当前可执行动作</strong>
        <span>只显示当前账号现在可以办理的动作</span>
      </div>
      <em>{{ actionItems.length }} 项</em>
    </header>

    <div
      v-if="!actionItems.length"
      class="business-action-panel__empty"
    >
      当前账号在此单据暂无可办理动作。
    </div>

    <div
      v-else
      class="business-action-panel__grid"
    >
      <article
        v-for="action in actionItems"
        :key="action.key"
        class="business-action-panel__item"
      >
        <div class="business-action-panel__main">
          <strong>{{ action.label }}</strong>
          <t-tag
            size="small"
            :theme="action.statusTheme"
            variant="light"
          >
            {{ action.statusText }}
          </t-tag>
        </div>
        <p v-if="action.reason">
          {{ action.reason }}
        </p>
        <span v-if="action.requirementText">
          {{ action.requirementText }}
        </span>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import { toBusinessActionPanelItems } from "./business-action-panel.config";

const props = defineProps<{
  actions: DetailActionReadModel[];
}>();

const actionItems = computed(() => toBusinessActionPanelItems(props.actions));
</script>

<style scoped>
.business-action-panel {
  display: grid;
  gap: var(--jg-space-md);
  margin-bottom: var(--jg-space-lg);
  padding: var(--jg-space-md);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-muted);
}

.business-action-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.business-action-panel__head div {
  display: grid;
  gap: var(--jg-space-xs);
}

.business-action-panel__head strong,
.business-action-panel__item strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-body);
}

.business-action-panel__head span,
.business-action-panel__head em,
.business-action-panel__item p,
.business-action-panel__item span,
.business-action-panel__empty {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
  font-style: normal;
}

.business-action-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.business-action-panel__item {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-panel);
}

.business-action-panel__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-sm);
}

.business-action-panel__item p {
  margin: 0;
  line-height: 1.5;
}

@media (max-width: 720px) {
  .business-action-panel__head,
  .business-action-panel__main {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
