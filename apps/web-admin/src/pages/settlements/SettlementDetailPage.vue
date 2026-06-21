<template>
  <section class="settlement-detail-page">
    <div class="page-head">
      <div>
        <h1>结算详情</h1>
        <p>{{ settlementDetailTitleView }}</p>
      </div>
      <div class="actions">
        <t-button theme="primary">
          确认归档
        </t-button>
        <t-button>
          查看审批记录
        </t-button>
      </div>
    </div>

    <div class="meta-panel">
      <div
        v-for="item in settlementDetailMetaView"
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
        v-for="link in settlementDetailChainLinksView"
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
            v-for="item in settlementBaseInfoView"
            :key="item.label"
          >
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </t-card>

      <t-card
        title="生效流程与阻断点"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in settlementEffectivenessStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
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

    <div class="responsibility-strip">
      <span
        v-for="item in settlementArchiveResponsibilitiesView"
        :key="item"
      >
        {{ item }}
      </span>
    </div>

    <t-card
      class="section-card"
      title="付款执行规则"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="settlementPaymentRuleColumns"
        :data="settlementPaymentRulesView"
      />
    </t-card>

    <t-card
      class="section-card"
      title="付款申请"
      :bordered="true"
    >
      <div class="block-message">
        {{ settlementPaymentBlockMessageView }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, SettlementDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchSettlementDetail } from "../../api/core-flow-read.api";
import { settlementDetailChainLinks } from "../business-chain-links.config";
import type { SettlementDetailTone } from "./settlement-detail.config";
import {
  settlementArchiveResponsibilities,
  settlementBaseInfo,
  settlementDetailMeta,
  settlementDetailTitle,
  settlementEffectivenessSteps,
  settlementPaymentBlockMessage,
  settlementPaymentRuleColumns,
  settlementPaymentRules
} from "./settlement-detail.config";

const route = useRoute();
const router = useRouter();
const settlementDetail = ref<SettlementDetailReadModel | null>(null);

const settlementDetailTitleView = computed(() => settlementDetail.value?.title ?? settlementDetailTitle);
const settlementDetailMetaView = computed(() => settlementDetail.value?.meta ?? settlementDetailMeta);
const settlementBaseInfoView = computed(() => settlementDetail.value?.baseInfo ?? settlementBaseInfo);
const settlementEffectivenessStepsView = computed(
  () => settlementDetail.value?.effectivenessSteps ?? settlementEffectivenessSteps
);
const settlementArchiveResponsibilitiesView = computed(
  () => settlementDetail.value?.archiveResponsibilities ?? settlementArchiveResponsibilities
);
const settlementPaymentRulesView = computed(
  () => settlementDetail.value?.paymentRules ?? settlementPaymentRules
);
const settlementPaymentBlockMessageView = computed(
  () => settlementDetail.value?.paymentBlockMessage ?? settlementPaymentBlockMessage
);
const settlementDetailChainLinksView = computed(
  () => settlementDetail.value?.chainLinks ?? settlementDetailChainLinks
);

function openChainLink(to: string) {
  void router.push(to);
}

onMounted(async () => {
  const settlementId = String(route.params.settlementId ?? "JS-2026-018");

  try {
    settlementDetail.value = await fetchSettlementDetail(settlementId);
  } catch {
    settlementDetail.value = null;
  }
});

function tagTheme(tone: SettlementDetailTone | CoreFlowTone) {
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
.settlement-detail-page {
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

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
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

.flow-list {
  display: grid;
  gap: 12px;
}

.flow-row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 28px;
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

.dot-danger {
  background: #b51d2a;
}

.dot-success {
  background: #1b6b3a;
}

.responsibility-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.responsibility-strip span {
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-right: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
}

.responsibility-strip span:last-child {
  border-right: 0;
}

.section-card {
  margin-top: 20px;
  border-radius: 3px;
}

:deep(.section-card .t-card__body) {
  padding: 0;
  overflow-x: auto;
}

.block-message {
  padding: 18px 20px;
  color: #b51d2a;
  font-weight: 600;
}

@media (max-width: 980px) {
  .meta-panel,
  .detail-grid,
  .responsibility-strip {
    grid-template-columns: 1fr;
  }

  .chain-strip {
    flex-wrap: wrap;
    padding: 10px 16px;
  }
}
</style>
