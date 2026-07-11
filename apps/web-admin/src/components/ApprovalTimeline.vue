<template>
  <div
    v-if="items.length"
    class="approval-timeline"
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="approval-timeline__item"
    >
      <span class="approval-timeline__dot" />
      <div class="approval-timeline__body">
        <div class="approval-timeline__main">
          <strong>{{ item.actionLabel }}</strong>
          <span>{{ item.actorName }}</span>
          <em>{{ formatTime(item.createdAt) }}</em>
        </div>
        <div
          v-if="item.nodeName || item.roleName || item.selfReview"
          class="approval-timeline__meta"
        >
          <span v-if="item.nodeName">{{ item.nodeName }}</span>
          <span v-if="item.roleName">{{ item.roleName }}</span>
          <t-tag
            v-if="item.selfReview"
            size="small"
            theme="warning"
            variant="light"
          >
            领导自审
          </t-tag>
        </div>
        <p
          v-if="item.selfReview && item.selfReviewReason"
          class="approval-timeline__self-review-reason"
        >
          自审原因：{{ item.selfReviewReason }}
        </p>
        <p v-if="item.comment">
          {{ item.comment }}
        </p>
      </div>
    </div>
  </div>
  <t-empty
    v-else
    description="暂无审批历史"
  />
</template>

<script setup lang="ts">
import type { ApprovalTimelineItemReadModel } from "@jiangkong/shared-domain";

defineProps<{
  items: ApprovalTimelineItemReadModel[];
}>();

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.approval-timeline {
  display: grid;
  gap: var(--jg-space-lg);
}

.approval-timeline__item {
  display: grid;
  grid-template-columns: 14px 1fr;
  gap: 10px;
}

.approval-timeline__dot {
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--jg-brand);
}

.approval-timeline__body {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.approval-timeline__main,
.approval-timeline__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  align-items: center;
}

.approval-timeline__main strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-body);
}

.approval-timeline__main span,
.approval-timeline__main em,
.approval-timeline__meta {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
  font-style: normal;
}

.approval-timeline__body p {
  margin: 0;
  color: var(--jg-text-main);
  line-height: 1.6;
}

.approval-timeline__self-review-reason {
  padding: var(--jg-space-sm);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-warning-soft);
}
</style>
