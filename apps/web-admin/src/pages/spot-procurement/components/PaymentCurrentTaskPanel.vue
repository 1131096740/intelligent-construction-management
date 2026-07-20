<script setup lang="ts">
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import type { SpotPaymentCurrentTask } from "../../../api/spot-procurement.api";
import BusinessStatusText from "../../../components/BusinessStatusText.vue";
import {
  spotPaymentCurrentTaskPresentation,
  type SpotPaymentCurrentTaskAction,
  type SpotPaymentCurrentTaskSummary
} from "../spot-payment-detail.config";
import { spotPaymentStatusSemantic } from "../spot-payment-workbench.config";

const props = defineProps<{
  currentTask: SpotPaymentCurrentTask;
  availableActions: DetailActionReadModel[];
  summary: SpotPaymentCurrentTaskSummary;
  busy?: boolean;
}>();

const emit = defineEmits<{
  action: [key: SpotPaymentCurrentTaskAction["key"]];
}>();

const presentation = computed(() => spotPaymentCurrentTaskPresentation({
  currentTask: props.currentTask,
  availableActions: props.availableActions,
  summary: props.summary
}));
</script>

<template>
  <section
    class="payment-current-task"
    aria-labelledby="payment-current-task-title"
  >
    <div class="payment-current-task__heading">
      <BusinessStatusText
        :text="currentTask.label"
        :semantic="presentation.semantic"
      />
      <h2 id="payment-current-task-title">
        {{ presentation.title }}
      </h2>
      <p>{{ presentation.description }}</p>
    </div>

    <dl class="payment-current-task__summary">
      <div>
        <dt>付款状态</dt>
        <dd>
          <BusinessStatusText
            :text="summary.statusLabel"
            :semantic="spotPaymentStatusSemantic(summary.status)"
          />
        </dd>
      </div>
      <div>
        <dt>当前节点</dt>
        <dd>{{ summary.currentNodeName || "—" }}</dd>
      </div>
      <div>
        <dt>审批金额</dt>
        <dd>{{ summary.approvalAmountText }}</dd>
      </div>
      <div>
        <dt>剩余待付</dt>
        <dd>{{ summary.remainingAmountText }}</dd>
      </div>
    </dl>

    <ul class="payment-current-task__focus">
      <li
        v-for="item in presentation.focus"
        :key="item"
      >
        {{ item }}
      </li>
    </ul>

    <div
      v-if="presentation.actions.length"
      class="payment-current-task__actions"
    >
      <t-button
        v-for="item in presentation.actions"
        :key="item.key"
        :theme="item.kind === 'danger' ? 'danger' : item.kind === 'primary' ? 'primary' : 'default'"
        :variant="item.kind === 'normal' ? 'outline' : 'base'"
        :loading="busy"
        @click="emit('action', item.key)"
      >
        {{ item.label }}
      </t-button>
    </div>
  </section>
</template>

<style scoped>
.payment-current-task {
  display: grid;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.payment-current-task__heading,
.payment-current-task__summary,
.payment-current-task__focus {
  margin: 0;
}

.payment-current-task__heading {
  display: grid;
  gap: var(--jg-space-xs);
}

.payment-current-task__heading h2,
.payment-current-task__heading p {
  margin: 0;
}

.payment-current-task__heading p,
.payment-current-task__summary dt {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.payment-current-task__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.payment-current-task__summary > div {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.payment-current-task__summary dd {
  margin: 0;
}

.payment-current-task__focus {
  display: grid;
  gap: var(--jg-space-xs);
  padding-left: var(--jg-space-lg);
  color: var(--jg-color-text-secondary);
}

.payment-current-task__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

@media (max-width: 720px) {
  .payment-current-task__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
