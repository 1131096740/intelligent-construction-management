<template>
  <section class="payment-detail-page">
    <div class="page-head">
      <div>
        <h1>付款详情</h1>
        <p>{{ paymentDetailTitleView }}</p>
      </div>
      <div class="actions">
        <t-button theme="primary">
          登记实付
        </t-button>
        <t-button>
          查看审批记录
        </t-button>
      </div>
    </div>

    <div class="meta-panel">
      <div
        v-for="item in paymentDetailMetaView"
        :key="item.label"
        class="meta-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="item.tone ? `tone-${item.tone}` : undefined">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="chain-strip">
      <span>业务链路</span>
      <t-link
        v-for="link in paymentDetailChainLinksView"
        :key="link.to"
        theme="primary"
        @click="openChainLink(link.to)"
      >
        {{ link.label }}
      </t-link>
    </div>

    <div class="detail-grid">
      <t-card
        title="基础信息"
        :bordered="true"
      >
        <dl class="info-list">
          <template
            v-for="item in paymentBaseInfoView"
            :key="item.label"
          >
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </t-card>

      <t-card
        title="追溯规则"
        :bordered="true"
      >
        <div class="rule-list">
          <span
            v-for="rule in paymentTraceRulesView"
            :key="rule"
          >
            {{ rule }}
          </span>
        </div>
      </t-card>
    </div>

    <div class="timeline-grid">
      <t-card
        title="付款审批链"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in paymentApprovalStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
            <em>{{ step.owner }}</em>
            <t-tag
              size="small"
              :theme="tagTheme(step.tone)"
              variant="light"
            >
              {{ step.status }}
            </t-tag>
          </div>
        </div>
      </t-card>

      <t-card
        title="实际付款执行"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in paymentExecutionStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
            <em>{{ step.owner }}</em>
            <t-tag
              size="small"
              :theme="tagTheme(step.tone)"
              variant="light"
            >
              {{ step.status }}
            </t-tag>
          </div>
        </div>
      </t-card>
    </div>

    <t-card
      class="section-card"
      title="实付登记阻断点"
      :bordered="true"
    >
      <div class="block-message">
        {{ paymentExecutionBlockMessageView }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, PaymentDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchPaymentDetail } from "../../api/core-flow-read.api";
import { paymentDetailChainLinks } from "../business-chain-links.config";
import type { PaymentDetailTone } from "./payment-detail.config";
import {
  paymentApprovalSteps,
  paymentBaseInfo,
  paymentDetailMeta,
  paymentDetailTitle,
  paymentExecutionBlockMessage,
  paymentExecutionSteps,
  paymentTraceRules
} from "./payment-detail.config";

const route = useRoute();
const router = useRouter();
const paymentDetail = ref<PaymentDetailReadModel | null>(null);

const paymentDetailTitleView = computed(() => paymentDetail.value?.title ?? paymentDetailTitle);
const paymentDetailMetaView = computed(() => paymentDetail.value?.meta ?? paymentDetailMeta);
const paymentBaseInfoView = computed(() => paymentDetail.value?.baseInfo ?? paymentBaseInfo);
const paymentTraceRulesView = computed(() => paymentDetail.value?.traceRules ?? paymentTraceRules);
const paymentApprovalStepsView = computed(
  () => paymentDetail.value?.approvalSteps ?? paymentApprovalSteps
);
const paymentExecutionStepsView = computed(
  () => paymentDetail.value?.executionSteps ?? paymentExecutionSteps
);
const paymentExecutionBlockMessageView = computed(
  () => paymentDetail.value?.executionBlockMessage ?? paymentExecutionBlockMessage
);
const paymentDetailChainLinksView = computed(
  () => paymentDetail.value?.chainLinks ?? paymentDetailChainLinks
);

function openChainLink(to: string) {
  void router.push(to);
}

onMounted(async () => {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  try {
    paymentDetail.value = await fetchPaymentDetail(paymentId);
  } catch {
    paymentDetail.value = null;
  }
});

function tagTheme(tone: PaymentDetailTone | CoreFlowTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.payment-detail-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}

.meta-panel {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  padding: 18px 20px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.meta-item {
  display: grid;
  gap: 10px;
}

.meta-item span,
.info-list dt {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.meta-item strong {
  font-size: 13px;
}

.chain-strip {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 16px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.chain-strip span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.tone-primary {
  color: #0052cc;
}

.tone-warning {
  color: #9f4f06;
}

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid,
.timeline-grid {
  display: grid;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-grid {
  grid-template-columns: 1.35fr 1fr;
}

.timeline-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.info-list {
  display: grid;
  grid-template-columns: 104px 1fr;
  row-gap: 16px;
  margin: 0;
}

.info-list dd {
  margin: 0;
}

.rule-list {
  display: grid;
  gap: 12px;
}

.rule-list span {
  min-height: 28px;
  display: flex;
  align-items: center;
  color: #424955;
  font-size: 12px;
}

.flow-list {
  display: grid;
  gap: 12px;
}

.flow-row {
  display: grid;
  grid-template-columns: 14px 1fr 92px auto;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}

.flow-row em {
  color: #767f8d;
  font-size: 12px;
  font-style: normal;
}

.flow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #767f8d;
}

.dot-primary {
  background: #0052cc;
}

.dot-warning {
  background: #9f4f06;
}

.dot-danger {
  background: #b51d2a;
}

.dot-success {
  background: #1b6b3a;
}

.section-card {
  border-radius: 3px;
}

:deep(.section-card .t-card__body) {
  padding: 0;
}

.block-message {
  padding: 18px 20px;
  color: #9f4f06;
  font-weight: 600;
}

@media (max-width: 980px) {
  .meta-panel,
  .detail-grid,
  .timeline-grid {
    grid-template-columns: 1fr;
  }

  .chain-strip {
    flex-wrap: wrap;
    padding: 10px 16px;
  }
}
</style>
