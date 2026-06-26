<template>
  <aside class="readiness-panel">
    <div class="readiness-head">
      <span class="readiness-title">就绪检查</span>
      <t-tag
        size="small"
        variant="light"
        :theme="readiness.ready ? 'success' : 'warning'"
      >
        {{ readiness.ready ? "可提交" : "未就绪" }}
      </t-tag>
    </div>

    <div class="readiness-group">
      <span class="group-label danger">阻断项（{{ readiness.blockingMessages.length }}）</span>
      <ul
        v-if="readiness.blockingMessages.length"
        class="message-list"
      >
        <li
          v-for="(message, index) in readiness.blockingMessages"
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
      <span class="group-label warning">提醒项（{{ readiness.warningMessages.length }}）</span>
      <ul
        v-if="readiness.warningMessages.length"
        class="message-list"
      >
        <li
          v-for="(message, index) in readiness.warningMessages"
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
  </aside>
</template>

<script setup lang="ts">
import type { ContractReadinessResult } from "@jiangkong/shared-domain";

defineProps<{
  readiness: ContractReadinessResult;
}>();
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
