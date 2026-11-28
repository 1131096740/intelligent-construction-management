<script setup lang="ts">
import type { HomeActionGroupCard } from "./home.config";

defineProps<{ groups: readonly HomeActionGroupCard[] }>();
const emit = defineEmits<{ open: [path: string]; viewAll: [key: string] }>();
</script>

<template>
  <section
    class="home-action-groups"
    aria-labelledby="home-action-groups-title"
  >
    <header class="home-action-groups__head">
      <h2 id="home-action-groups-title">
        按办理动作看待办
      </h2>
      <span>数量取全部待办；摘要只列最近三项，点击直达原单。</span>
    </header>
    <div class="home-action-groups__grid">
      <article
        v-for="group in groups"
        :key="group.key"
        class="home-action-group"
        :data-action-group="group.key"
      >
        <header class="home-action-group__head">
          <h3>{{ group.title }}</h3>
          <span
            class="home-action-group__count"
            :aria-label="`${group.title} ${group.countText} 项`"
          >{{ group.countText }}</span>
        </header>
        <ul
          v-if="group.items.length"
          class="home-action-group__items"
        >
          <li
            v-for="item in group.items"
            :key="item.id"
          >
            <t-button
              variant="text"
              class="home-action-group__item"
              @click="emit('open', item.targetPath)"
            >
              <span>{{ item.title }}</span>
              <small>{{ item.meta }}</small>
            </t-button>
          </li>
        </ul>
        <p
          v-else
          class="home-action-group__empty"
        >
          暂无摘要
        </p>
        <footer class="home-action-group__footer">
          <t-button
            size="small"
            variant="text"
            @click="emit('viewAll', group.key)"
          >
            查看全部 {{ group.countText }} 项
          </t-button>
          <t-link
            theme="primary"
            @click="emit('open', group.targetPath)"
          >
            前往办理
          </t-link>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.home-action-groups { display: grid; gap: var(--jg-space-md); }
.home-action-groups__head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--jg-space-md); }
.home-action-groups__head h2 { margin: 0; font-size: var(--jg-font-size-section-title); }
.home-action-groups__head span { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.home-action-groups__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--jg-space-md); }
.home-action-group { display: grid; gap: var(--jg-space-sm); padding: var(--jg-space-lg); background: var(--jg-color-bg-surface); border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-panel); }
.home-action-group__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--jg-space-sm); }
.home-action-group__head h3 { margin: 0; font-size: var(--jg-font-size-body); }
.home-action-group__count { min-width: 28px; padding: 0 var(--jg-space-sm); text-align: center; color: var(--jg-color-text-inverse); background: var(--jg-color-brand); border-radius: 999px; font-size: var(--jg-font-size-meta); line-height: 22px; }
.home-action-group__items { display: grid; gap: var(--jg-space-xs); margin: 0; padding: 0; list-style: none; }
.home-action-group__item { width: 100%; height: auto; padding: var(--jg-space-xs) 0; text-align: left; background: none; color: var(--jg-color-text-primary); }
.home-action-group__item :deep(.t-button__text) { display: grid; gap: 2px; width: 100%; }
.home-action-group__item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-action-group__item small { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); font-weight: var(--jg-font-weight-regular); }
.home-action-group__item:hover span { color: var(--jg-color-brand); text-decoration: underline; }
.home-action-group__empty { margin: 0; color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.home-action-group__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-sm); border-top: var(--jg-border-width-base) solid var(--jg-color-border); padding-top: var(--jg-space-xs); }
@media (max-width: 720px) {
  .home-action-groups__grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
