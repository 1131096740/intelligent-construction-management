<script setup lang="ts">
import { computed } from "vue";
import BusinessFeedback from "./BusinessFeedback.vue";
import EmptyBusinessState from "./EmptyBusinessState.vue";
import { resolveJgResultState } from "./jg-result-state.config";

const props = withDefaults(defineProps<{
  loading: boolean;
  hasResults: boolean;
  error?: string;
  permissionReason?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  retryLabel?: string;
}>(), {
  error: "",
  permissionReason: "",
  emptyTitle: "暂无结果",
  emptyDescription: "请调整筛选条件后重试。",
  retryLabel: "重新加载"
});

const emit = defineEmits<{
  retry: [];
}>();

const state = computed(() => resolveJgResultState(props));
</script>

<template>
  <section
    class="jg-result-state"
    :aria-busy="loading"
    aria-live="polite"
  >
    <BusinessFeedback
      v-if="state === 'error'"
      state="error"
      title="读取结果失败"
      :description="error"
      :action-label="retryLabel"
      @action="emit('retry')"
    />

    <BusinessFeedback
      v-else-if="state === 'permission'"
      state="permission"
      title="暂无查看权限"
      :description="permissionReason"
    />

    <div
      v-else-if="state === 'loading'"
      class="jg-result-state__loading"
    >
      <t-loading size="small" />
      <span>正在读取结果…</span>
    </div>

    <EmptyBusinessState
      v-else-if="state === 'empty'"
      :title="emptyTitle"
      :description="emptyDescription"
    />

    <template v-else>
      <BusinessFeedback
        v-if="error"
        class="jg-result-state__inline-feedback"
        state="error"
        title="刷新结果失败"
        :description="error"
        :action-label="retryLabel"
        @action="emit('retry')"
      />
      <slot />
      <div
        v-if="loading"
        class="jg-result-state__refreshing"
      >
        <t-loading size="small" />
        <span>正在刷新结果…</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.jg-result-state {
  display: grid;
  gap: var(--jg-space-md);
  min-width: 0;
}

.jg-result-state__loading,
.jg-result-state__refreshing {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--jg-space-sm);
  min-height: var(--jg-layout-business-summary-strip-min-height);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.jg-result-state__refreshing {
  justify-self: start;
  min-height: auto;
  padding: var(--jg-space-xs) var(--jg-space-sm);
  border-color: transparent;
  background: var(--jg-color-bg-muted);
}
</style>
