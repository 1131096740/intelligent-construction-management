<script setup lang="ts">
export interface BusinessMobileCard {
  id: string;
  title: string;
  code?: string;
  meta?: string;
  status?: string;
  tone?: "default" | "primary" | "warning" | "danger" | "success";
  amount?: string;
  facts?: Array<{ label: string; value: string }>;
  nextAction: string;
}
defineProps<{ items: BusinessMobileCard[]; loading?: boolean; emptyText?: string }>();
const emit = defineEmits<{ open: [id: string] }>();
</script>

<template>
  <div
    class="business-mobile-cards"
    :aria-busy="loading"
  >
    <p
      v-if="loading"
      role="status"
    >
      正在读取记录，请稍候…
    </p>
    <t-empty
      v-else-if="!items.length && emptyText"
      :title="emptyText"
      description="可以调整筛选条件，或刷新查看最新记录。"
    />
    <article
      v-for="item in items"
      v-show="!loading"
      :key="item.id"
      class="business-mobile-card"
    >
      <div class="business-mobile-card__heading">
        <h3>{{ item.title }}</h3>
        <t-tag
          v-if="item.status"
          :theme="item.tone || 'default'"
          variant="light"
        >
          {{ item.status }}
        </t-tag>
      </div>
      <p
        v-if="item.code"
        class="business-mobile-card__code"
      >
        {{ item.code }}
      </p>
      <p v-if="item.meta">
        {{ item.meta }}
      </p>
      <dl v-if="item.facts?.length">
        <div
          v-for="fact in item.facts"
          :key="fact.label"
        >
          <dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd>
        </div>
      </dl>
      <footer>
        <strong
          v-if="item.amount"
          class="business-mobile-card__amount"
        >{{ item.amount }}</strong>
        <t-button
          variant="outline"
          theme="primary"
          @click="emit('open', item.id)"
        >
          {{ item.nextAction }}
        </t-button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.business-mobile-cards { display: none; }
@media (max-width: 720px) {
  .business-mobile-cards { display: grid; gap: var(--jg-space-md); }
  .business-mobile-card { min-width: 0; padding: var(--jg-space-lg); border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-panel); background: var(--jg-color-bg-surface); }
  .business-mobile-card__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--jg-space-sm); }
  h3 { margin: 0; min-width: 0; overflow-wrap: anywhere; font-size: var(--jg-font-size-section-title); line-height: var(--jg-line-height-body); }
  p { margin: var(--jg-space-xs) 0; color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); overflow-wrap: anywhere; }
  dl { margin: var(--jg-space-md) 0; display: grid; gap: var(--jg-space-sm); }
  dl > div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: var(--jg-space-sm); font-size: var(--jg-font-size-body); }
  dt { color: var(--jg-color-text-tertiary); }
  dd { margin: 0; overflow-wrap: anywhere; }
  footer { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: var(--jg-space-sm); margin-top: var(--jg-space-md); }
  .business-mobile-card__amount { margin-right: auto; font-variant-numeric: tabular-nums; }
}
</style>
