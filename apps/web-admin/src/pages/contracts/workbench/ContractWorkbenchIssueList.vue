<template>
  <section class="issue-list">
    <div class="issue-head">
      <h2>资料检查</h2>
      <t-tag
        size="small"
        variant="light"
        :theme="view.ready ? 'success' : 'warning'"
      >
        {{ view.ready ? "可提交" : "未就绪" }}
      </t-tag>
    </div>

    <p
      v-if="pending"
      class="empty"
    >
      待补全：请保存后重新检查就绪状态。
    </p>

    <template v-else>
      <div class="issue-group">
        <strong class="group-label blocking">
          阻断项（{{ view.blocking.length }}）
        </strong>
        <t-button
          v-for="issue in view.blocking"
          :key="`blocking-${issue.key}-${issue.message}`"
          variant="text"
          class="issue-button blocking"
          @click="emit('locate', issue)"
        >
          {{ issue.message }}
        </t-button>
        <p
          v-if="!view.blocking.length"
          class="empty"
        >
          无阻断项。
        </p>
      </div>

      <div class="issue-group">
        <strong class="group-label warning">
          提醒项（{{ view.warnings.length }}）
        </strong>
        <t-button
          v-for="issue in view.warnings"
          :key="`warning-${issue.key}-${issue.message}`"
          variant="text"
          class="issue-button warning"
          @click="emit('locate', issue)"
        >
          {{ issue.message }}
        </t-button>
        <p
          v-if="!view.warnings.length"
          class="empty"
        >
          无提醒项。
        </p>
      </div>
    </template>

    <t-alert
      v-if="locationMessage"
      theme="info"
      :message="locationMessage"
    />
  </section>
</template>

<script setup lang="ts">
import type { ContractReadinessResult } from "@jiangkong/shared-domain";
import { computed } from "vue";
import {
  normalizeContractReadinessIssue,
  type ContractWorkbenchReadinessIssue
} from "./contract-workbench-issue-location";

const props = defineProps<{
  readiness: ContractReadinessResult;
  locationMessage?: string;
}>();

const emit = defineEmits<{
  (event: "locate", issue: ContractWorkbenchReadinessIssue): void;
}>();

const view = computed(() => {
  const record = props.readiness as ContractReadinessResult & {
    blocking?: unknown;
    warnings?: unknown;
  };
  return {
    ready: props.readiness.ready,
    blocking: issues(
      record.blocking,
      props.readiness.blockingMessages,
      "blocking"
    ),
    warnings: issues(
      record.warnings,
      props.readiness.warningMessages,
      "warning"
    )
  };
});

const pending = computed(
  () => !view.value.ready && !view.value.blocking.length && !view.value.warnings.length
);

function issues(
  structured: unknown,
  fallbackMessages: string[],
  level: ContractWorkbenchReadinessIssue["level"]
) {
  const normalized = Array.isArray(structured)
    ? structured.flatMap((item) => {
        const issue = item !== null && typeof item === "object"
          ? normalizeContractReadinessIssue(
              item as Record<string, unknown>,
              level
            )
          : null;
        return issue ? [issue] : [];
      })
    : [];
  if (normalized.length) return normalized;
  return fallbackMessages.flatMap((message, index) => {
    const issue = normalizeContractReadinessIssue({
      key: `legacy-${level}-${index}`,
      message
    }, level);
    return issue ? [issue] : [];
  });
}
</script>

<style scoped>
.issue-list,
.issue-group {
  display: grid;
  gap: var(--jg-space-md);
}

.issue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.issue-head h2 {
  margin: 0;
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.group-label {
  font-size: var(--jg-font-meta);
}

.group-label.blocking {
  color: var(--jg-danger);
}

.group-label.warning {
  color: var(--jg-warning);
}

.issue-button {
  justify-content: flex-start;
  height: auto;
  min-height: var(--jg-layout-control-min-height);
  padding: var(--jg-space-sm) var(--jg-space-md);
  text-align: left;
  white-space: normal;
}

.issue-button.blocking {
  color: var(--jg-danger);
  background: var(--jg-bg-danger-soft);
}

.issue-button.warning {
  color: var(--jg-warning);
  background: var(--jg-bg-warning-soft);
}

.empty {
  margin: 0;
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}
</style>
