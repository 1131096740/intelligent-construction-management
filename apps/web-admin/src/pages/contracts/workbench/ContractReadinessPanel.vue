<template>
  <aside class="readiness-panel">
    <div class="readiness-head">
      <span class="readiness-title">就绪检查</span>
      <t-tag
        size="small"
        variant="light"
        :theme="readinessView.ready ? 'success' : 'warning'"
      >
        {{ readinessView.ready ? "可提交" : "未就绪" }}
      </t-tag>
    </div>

    <div
      v-if="isPendingCheck"
      class="readiness-group"
    >
      <p class="message warning">
        待补全：请保存后重新检查就绪状态。
      </p>
    </div>

    <template v-else>
      <div class="readiness-group">
        <span class="group-label danger">阻断项（{{ readinessView.blockingMessages.length }}）</span>
        <ul
          v-if="readinessView.blockingMessages.length"
          class="message-list"
        >
          <li
            v-for="(message, index) in readinessView.blockingMessages"
            :key="`block-${index}`"
            class="message danger"
          >
            {{ message }}
          </li>
        </ul>
        <p
          v-else
          class="message muted"
        >
          无阻断项。
        </p>
      </div>

      <div class="readiness-group">
        <span class="group-label warning">提醒项（{{ readinessView.warningMessages.length }}）</span>
        <ul
          v-if="readinessView.warningMessages.length"
          class="message-list"
        >
          <li
            v-for="(message, index) in readinessView.warningMessages"
            :key="`warn-${index}`"
            class="message warning"
          >
            {{ message }}
          </li>
        </ul>
        <p
          v-else
          class="message muted"
        >
          无提醒项。
        </p>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import type { ContractReadinessResult } from "@jiangkong/shared-domain";
import { computed } from "vue";

type StructuredReadiness = ContractReadinessResult & {
  blocking?: unknown;
  warnings?: unknown;
};

const props = defineProps<{
  readiness: ContractReadinessResult;
}>();

const readinessView = computed(() => {
  const readiness = props.readiness as StructuredReadiness;
  const blockingMessages =
    structuredMessages(readiness.blocking) || stringMessages(readiness.blockingMessages);
  const warningMessages =
    structuredMessages(readiness.warnings) || stringMessages(readiness.warningMessages);

  return {
    ready: readiness.ready,
    blockingMessages,
    warningMessages
  };
});

const isPendingCheck = computed(
  () =>
    !readinessView.value.ready &&
    !readinessView.value.blockingMessages.length &&
    !readinessView.value.warningMessages.length
);

function structuredMessages(value: unknown) {
  if (!Array.isArray(value)) return null;
  const messages = value.flatMap((item) => {
    const record = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return typeof record["message"] === "string" ? [record["message"]] : [];
  });
  return messages.length ? messages : null;
}

function stringMessages(value: unknown) {
  return Array.isArray(value)
    ? value.filter((message): message is string => typeof message === "string")
    : [];
}
</script>

<style scoped>
.readiness-panel {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.readiness-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.readiness-title {
  font-size: 14px;
  font-weight: 700;
  color: #151922;
}

.readiness-group {
  display: grid;
  gap: 8px;
}

.group-label {
  font-size: 12px;
  font-weight: 600;
}

.group-label.danger {
  color: #b51d2a;
}

.group-label.warning {
  color: #9f4f06;
}

.message-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.message {
  padding: 8px 10px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1.5;
}

.message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.message.warning {
  color: #9f4f06;
  background: #fff8ef;
}

.message.muted {
  color: #767f8d;
  background: transparent;
  padding: 0;
}
</style>
