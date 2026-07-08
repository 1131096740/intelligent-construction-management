<template>
  <section class="business-action-panel">
    <header class="business-action-panel__head">
      <div>
        <strong>当前可执行动作</strong>
        <span>由后端按角色、项目权限和单据状态返回</span>
      </div>
      <em>{{ enabledCount }} / {{ actionItems.length }} 可操作</em>
    </header>

    <div
      v-if="!actionItems.length"
      class="business-action-panel__empty"
    >
      当前单据暂无可展示动作，请查看流程状态或刷新详情。
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
import { countEnabledActions, toBusinessActionPanelItems } from "./business-action-panel.config";

const props = defineProps<{
  actions: DetailActionReadModel[];
}>();

const actionItems = computed(() => toBusinessActionPanelItems(props.actions));
const enabledCount = computed(() => countEnabledActions(props.actions));
</script>

<style scoped>
.business-action-panel {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #f7f9fc;
}

.business-action-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.business-action-panel__head div {
  display: grid;
  gap: 4px;
}

.business-action-panel__head strong,
.business-action-panel__item strong {
  color: #151922;
  font-size: 13px;
}

.business-action-panel__head span,
.business-action-panel__head em,
.business-action-panel__item p,
.business-action-panel__item span,
.business-action-panel__empty {
  color: #5f6673;
  font-size: 12px;
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
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.business-action-panel__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
