<template>
  <section class="contract-detail-page">
    <div class="page-head">
      <div>
        <h1>合同详情</h1>
        <p>{{ contractDetailTitle }}</p>
      </div>
      <div class="actions">
        <t-button theme="primary">
          发起用章
        </t-button>
        <t-button>
          查看审批记录
        </t-button>
      </div>
    </div>

    <div class="meta-panel">
      <div
        v-for="item in contractDetailMeta"
        :key="item.label"
        class="meta-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="item.tone ? `tone-${item.tone}` : undefined">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="detail-grid">
      <t-card
        title="基础信息"
        :bordered="true"
      >
        <dl class="info-list">
          <template
            v-for="item in contractBaseInfo"
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
            v-for="step in contractEffectivenessSteps"
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

    <t-card
      class="section-card"
      title="付款条款版本记录"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="contractPaymentTermColumns"
        :data="contractPaymentTermStages"
      >
        <template #operation>
          <t-link theme="primary">
            查看
          </t-link>
        </template>
      </t-table>
    </t-card>

    <t-card
      class="section-card"
      title="关联结算 / 付款"
      :bordered="true"
    >
      <div class="block-message">
        {{ contractSettlementBlockMessage }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { DetailTone } from "./contract-detail.config";
import {
  contractBaseInfo,
  contractDetailMeta,
  contractDetailTitle,
  contractEffectivenessSteps,
  contractPaymentTermColumns,
  contractPaymentTermStages,
  contractSettlementBlockMessage
} from "./contract-detail.config";

function tagTheme(tone: DetailTone) {
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
.contract-detail-page {
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

.tone-warning {
  color: #9f4f06;
}

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.info-list {
  display: grid;
  grid-template-columns: 92px 1fr;
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
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
