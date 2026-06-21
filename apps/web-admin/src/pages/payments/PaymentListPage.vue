<template>
  <section class="payment-page">
    <div class="page-head">
      <div>
        <h1>付款管理</h1>
        <p>按结算单、审批状态、实付状态和付款凭证管理付款申请</p>
      </div>
      <t-button theme="primary">
        新建付款申请
      </t-button>
    </div>

    <div class="summary-strip">
      <div
        v-for="item in paymentSummaryItems"
        :key="item.label"
        class="summary-item"
      >
        <span class="summary-label">{{ item.label }}</span>
        <strong :class="['summary-value', `tone-${item.tone}`]">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="rule-strip">
      <span
        v-for="rule in paymentRules"
        :key="rule"
      >
        {{ rule }}
      </span>
    </div>

    <div class="filter-bar">
      <label
        v-for="field in paymentFilterFields"
        :key="field.key"
        :class="['filter-field', { keyword: field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          :placeholder="field.placeholder"
          size="small"
          readonly
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
      >
        查询
      </t-button>
      <t-button class="filter-action">
        重置
      </t-button>
    </div>

    <t-card
      class="ledger-panel"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="paymentLedgerColumns"
        :data="paymentLedgerRows"
        empty="暂无付款数据"
      >
        <template #approvalStatus="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.approvalTone)"
            variant="light"
          >
            {{ row.approvalStatus }}
          </t-tag>
        </template>
        <template #paymentStatus="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.paymentTone)"
            variant="light"
          >
            {{ row.paymentStatus }}
          </t-tag>
        </template>
        <template #operation>
          <t-link theme="primary">
            详情
          </t-link>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { PaymentTone } from "./payment-list.config";
import {
  paymentFilterFields,
  paymentLedgerColumns,
  paymentLedgerRows,
  paymentRules,
  paymentSummaryItems
} from "./payment-list.config";

function statusTagTheme(tone: PaymentTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.payment-page {
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

.summary-strip,
.rule-strip,
.filter-bar {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.summary-strip {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 12px;
}

.summary-item {
  display: flex;
  gap: 10px;
  padding-right: 24px;
  margin-right: 22px;
  border-right: 1px solid #dce1e8;
}

.summary-item:last-child {
  border-right: 0;
}

.summary-label {
  color: #767f8d;
}

.summary-value {
  color: #151922;
}

.tone-primary {
  color: #0052cc;
}

.tone-warning {
  color: #9f4f06;
}

.tone-success {
  color: #1b6b3a;
}

.rule-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 16px;
}

.rule-strip span {
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-right: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
}

.rule-strip span:last-child {
  border-right: 0;
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(96px, 120px)) minmax(150px, 1fr) 76px 76px;
  gap: 8px 10px;
  align-items: end;
  padding: 10px 12px;
  margin-bottom: 16px;
}

.filter-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.filter-field span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.filter-action {
  width: 76px;
  min-width: 76px;
}

.ledger-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: 3px;
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@media (max-width: 980px) {
  .rule-strip,
  .filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }
}
</style>
