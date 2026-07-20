<script setup lang="ts">
import { computed } from "vue";
import type {
  SpotPaymentWorkbenchView,
  SpotProcurementPaymentListItemReadModel
} from "../../../api/spot-procurement.api";
import BusinessStatusText from "../../../components/BusinessStatusText.vue";
import {
  paymentTaskRoute,
  selectSpotPaymentTaskCards,
  spotPaymentWorkbenchViews
} from "../spot-payment-workbench.config";

const props = defineProps<{
  rows: SpotProcurementPaymentListItemReadModel[];
  counts: Record<SpotPaymentWorkbenchView, number>;
  activeView: SpotPaymentWorkbenchView;
  loading?: boolean;
}>();

const emit = defineEmits<{
  viewChange: [view: SpotPaymentWorkbenchView];
  openDetail: [paymentId: string];
}>();

const taskCards = computed(() => selectSpotPaymentTaskCards(
  props.rows.filter((row) => row.currentTask.scope !== "none")
));

function taskActionLabel(taskKey: string) {
  switch (paymentTaskRoute(taskKey)) {
    case "edit-draft": return "填写";
    case "review":
    case "payer":
    case "execution":
    case "refund": return "处理";
    default: return "查看";
  }
}

function taskSemantic(taskKey: string) {
  switch (paymentTaskRoute(taskKey)) {
    case "edit-draft": return "required" as const;
    case "review":
    case "payer":
    case "execution":
    case "refund": return "progress" as const;
    default: return "neutral" as const;
  }
}
</script>

<template>
  <section
    class="payment-task-queue"
    aria-labelledby="payment-task-queue-title"
  >
    <header class="payment-task-queue__header">
      <div>
        <h2 id="payment-task-queue-title">
          当前付款任务
        </h2>
        <p>先处理当前责任，再查询付款台账。</p>
      </div>
      <nav
        class="payment-task-queue__views"
        aria-label="付款工作台视图"
      >
        <t-button
          v-for="view in spotPaymentWorkbenchViews"
          :key="view.value"
          size="small"
          :theme="activeView === view.value ? 'primary' : 'default'"
          :variant="activeView === view.value ? 'light' : 'outline'"
          :loading="loading && activeView === view.value"
          @click="emit('viewChange', view.value)"
        >
          {{ view.label }} {{ counts[view.value] }}
        </t-button>
      </nav>
    </header>

    <div
      v-if="taskCards.length"
      class="payment-task-queue__cards"
    >
      <t-card
        v-for="row in taskCards"
        :key="row.id"
        bordered
        class="payment-task-card"
      >
        <div class="payment-task-card__content">
          <BusinessStatusText
            :text="row.currentTask.label"
            :semantic="taskSemantic(row.currentTask.key)"
          />
          <strong>{{ row.currentTask.hint }}</strong>
          <span>{{ row.code }} · {{ row.project.name }}</span>
        </div>
        <t-button
          size="small"
          :disabled="!row.currentTask.enabled"
          @click="emit('openDetail', row.id)"
        >
          {{ taskActionLabel(row.currentTask.key) }}
        </t-button>
      </t-card>
    </div>
    <t-empty
      v-else-if="!loading"
      class="payment-task-queue__empty"
      description="当前视图暂无需要办理的付款任务"
    />
  </section>
</template>

<style scoped>
.payment-task-queue {
  display: grid;
  gap: var(--jg-space-md);
  min-width: 0;
}

.payment-task-queue__header {
  display: flex;
  gap: var(--jg-space-lg);
  align-items: flex-end;
  justify-content: space-between;
}

.payment-task-queue__header h2,
.payment-task-queue__header p {
  margin: 0;
}

.payment-task-queue__header p,
.payment-task-card__content > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.payment-task-queue__header p {
  margin-top: var(--jg-space-xs);
}

.payment-task-queue__views {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.payment-task-queue__cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.payment-task-card :deep(.t-card__body) {
  display: flex;
  gap: var(--jg-space-md);
  align-items: flex-start;
  justify-content: space-between;
}

.payment-task-card__content {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.payment-task-card__content strong,
.payment-task-card__content > span {
  overflow-wrap: anywhere;
}

.payment-task-queue__empty {
  padding-block: var(--jg-space-md);
}

@media (max-width: 760px) {
  .payment-task-queue__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .payment-task-queue__cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
