<script setup lang="ts">
import { ref } from "vue";
import type { WorkItemReadModel } from "../api/core-flow-read.api";

defineProps<{ pending: WorkItemReadModel[]; count: number; newest: WorkItemReadModel[]; newestCount: number; offset: number; pageSize: number }>();
const emit = defineEmits<{ dismiss: []; page: [offset: number] }>();
const open = ref(false);
const toggle = ref<{ $el: HTMLElement }>();
function close() {
  open.value = false;
  toggle.value?.$el.focus();
}
</script>

<template>
  <section
    class="work-notices"
    aria-label="待办通知"
    @keydown.esc="close"
  >
    <div
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        v-if="newestCount"
        class="work-notices__alert"
      >
        <div>
          <strong>有 {{ newestCount }} 项新待办</strong>
          <router-link
            v-if="newest.length === 1"
            :to="newest[0].targetPath"
            @click="emit('dismiss')"
          >
            {{ newest[0].title }} · {{ newest[0].businessCode }}
          </router-link>
          <span v-else>打开待办查看详情</span>
        </div>
        <t-button
          size="small"
          variant="text"
          @click="emit('dismiss')"
        >
          关闭提示
        </t-button>
      </div>
    </div>
    <t-button
      ref="toggle"
      variant="outline"
      :aria-expanded="open"
      :aria-label="`待办通知，共 ${count} 项`"
      aria-controls="work-notices-list"
      @click="open = !open"
    >
      <span aria-hidden="true">🔔</span> 待办 {{ count }}
    </t-button>
    <div
      v-if="open"
      id="work-notices-list"
      class="work-notices__list"
    >
      <h2>待我处理</h2>
      <p v-if="!count">
        当前没有待办。
      </p>
      <ol v-else>
        <li
          v-for="item in pending"
          :key="item.id"
        >
          <router-link
            :to="item.targetPath"
            @click="open = false; emit('dismiss')"
          >
            {{ item.title }} · {{ item.businessCode }}
          </router-link>
          <span>{{ item.projectName }} · {{ item.currentNode }}</span>
        </li>
      </ol>
      <div
        v-if="count > pageSize"
        class="work-notices__pages"
        aria-label="待办分页"
      >
        <t-button
          size="small"
          variant="outline"
          :disabled="offset === 0"
          @click="emit('page', offset - pageSize)"
        >
          上一页
        </t-button>
        <span>第 {{ Math.floor(offset / pageSize) + 1 }} 页</span>
        <t-button
          size="small"
          variant="outline"
          :disabled="offset + pageSize >= count"
          @click="emit('page', offset + pageSize)"
        >
          下一页
        </t-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work-notices { position: fixed; inset-inline-end: var(--jg-space-lg); bottom: var(--jg-space-lg); z-index: 10; display: grid; justify-items: end; gap: var(--jg-space-xs); }
.work-notices__alert, .work-notices__list { box-sizing: border-box; background: var(--jg-color-bg-surface); border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-control); padding: var(--jg-space-sm) var(--jg-space-md); overflow-wrap: anywhere; }
.work-notices__alert { display: flex; align-items: flex-start; gap: var(--jg-space-sm); max-width: min(26rem, calc(100vw - 2rem)); }
.work-notices__alert a, .work-notices__alert span, .work-notices__list li span { display: block; }
.work-notices__list { position: absolute; right: 0; bottom: calc(100% + var(--jg-space-xs)); width: min(25rem, calc(100vw - 2rem)); max-height: 55dvh; overflow-y: auto; }
.work-notices__list h2 { margin: 0; font-size: var(--jg-font-size-section-title); }
.work-notices__list ol { padding-inline-start: var(--jg-space-lg); }
.work-notices__list li { margin-block: var(--jg-space-sm); }
.work-notices__pages { display: flex; align-items: center; gap: var(--jg-space-sm); }
@media (max-width: 720px) {
  .work-notices { position: relative; inset: auto; justify-items: stretch; padding: var(--jg-space-xs) var(--jg-space-md); }
  .work-notices__alert { max-width: none; justify-content: space-between; }
  .work-notices > .t-button { justify-self: end; }
  .work-notices__list { inset-inline: var(--jg-space-md); top: 100%; bottom: auto; width: auto; }
}
</style>
