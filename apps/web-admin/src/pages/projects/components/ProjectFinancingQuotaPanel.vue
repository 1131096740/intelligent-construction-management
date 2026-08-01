<template>
  <section
    class="financing-quota-panel"
    aria-labelledby="project-financing-quota-title"
  >
    <t-card
      :bordered="true"
      class="financing-quota-card"
    >
      <div class="panel-heading">
        <div>
          <h2 id="project-financing-quota-title">
            项目垫资额度
          </h2>
          <p>额度生命周期与实际付款分配记录以服务端台账为准。</p>
        </div>
        <t-tag
          theme="primary"
          variant="light"
        >
          只读台账
        </t-tag>
      </div>

      <t-alert
        theme="info"
        title="固定资金分配顺序"
      >
        <strong>自有资金优先</strong>，不足部分再由<strong>垫资额度补足</strong>；使用人不能手工调整或重排两类资金。
      </t-alert>

      <div class="summary-grid">
        <div class="summary-item">
          <span>累计额度金额</span>
          <strong>{{ formatMoney(workbench.summary.quotaAmountCents) }}</strong>
        </div>
        <div class="summary-item">
          <span>额度已使用净额</span>
          <strong>{{ formatMoney(workbench.summary.netUsedAmountCents) }}</strong>
        </div>
        <div class="summary-item">
          <span>当前可用额度</span>
          <strong>{{ formatMoney(workbench.summary.currentlyAvailableAmountCents) }}</strong>
        </div>
        <div class="summary-item">
          <span>生命周期记录</span>
          <strong>{{ workbench.rows.length }} 条</strong>
        </div>
      </div>
    </t-card>

    <t-card
      title="额度生命周期"
      :bordered="true"
      class="financing-quota-card jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="quotaColumns"
        :data="workbench.rows"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无项目垫资额度记录"
      >
        <template #reason="{ row }">
          <div class="reason-cell">
            <strong>{{ row.reason }}</strong>
            <span>{{ row.requestedByName || "未记录申请人" }} · {{ formatDateTime(row.createdAt) }}</span>
          </div>
        </template>
        <template #amountCents="{ row }">
          {{ formatMoney(row.amountCents) }}
        </template>
        <template #netUsedAmountCents="{ row }">
          {{ formatMoney(row.netUsedAmountCents) }}
        </template>
        <template #availableAmountCents="{ row }">
          {{ formatMoney(row.availableAmountCents) }}
        </template>
        <template #status="{ row }">
          <div class="status-cell">
            <t-tag
              :theme="statusTheme(row.status, row.isExpired)"
              variant="light"
            >
              {{ row.statusLabel }}
            </t-tag>
            <template v-if="row.status === 'terminated'">
              <span>终止人：{{ row.terminatedByName || "未记录" }}</span>
              <span>
                终止时间：{{ row.terminatedAt ? formatDateTime(row.terminatedAt) : "未记录" }}
              </span>
              <span class="termination-reason">
                终止原因：{{ row.terminationReason || "未记录" }}
              </span>
            </template>
            <span v-else-if="row.currentApproval?.currentNodeName">
              当前节点：{{ row.currentApproval.currentNodeName }}
            </span>
            <span v-else-if="row.approvedByName">
              批准人：{{ row.approvedByName }}
            </span>
          </div>
        </template>
        <template #validUntil="{ row }">
          {{ row.validUntil ? formatDate(row.validUntil) : "长期有效" }}
        </template>
      </t-table>
    </t-card>

    <t-card
      title="不可变资金使用记录"
      :bordered="true"
      class="financing-quota-card jg-table-region jg-table-region--standard"
    >
      <p class="usage-description">
        每笔实际付款保留自有资金、全部垫资额度与当前额度的借贷发生额，冲正也作为独立历史保留。
      </p>
      <t-table
        row-key="key"
        size="small"
        :columns="usageColumns"
        :data="usageRows"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无垫资额度实际使用记录"
      >
        <template #quota="{ row }">
          <div class="reason-cell">
            <strong>{{ row.quotaReason }}</strong>
            <span>{{ shortId(row.quotaId) }}</span>
          </div>
        </template>
        <template #business="{ row }">
          <div class="reason-cell">
            <strong>{{ businessTypeLabel(row.businessType) }}</strong>
            <span>{{ shortId(row.businessId) }}</span>
          </div>
        </template>
        <template #projectCashNetAmountCents="{ row }">
          {{ formatMoney(row.projectCashNetAmountCents) }}
        </template>
        <template #financingQuotaNetAmountCents="{ row }">
          {{ formatMoney(row.financingQuotaNetAmountCents) }}
        </template>
        <template #currentQuotaNetAmountCents="{ row }">
          <div class="amount-breakdown">
            <strong>{{ formatMoney(row.currentQuotaNetAmountCents) }}</strong>
            <span>借 {{ formatMoney(row.currentQuotaDebitAmountCents) }}</span>
            <span>贷 {{ formatMoney(row.currentQuotaCreditAmountCents) }}</span>
          </div>
        </template>
        <template #occurredAt="{ row }">
          {{ formatDateTime(row.occurredAt) }}
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { centsTextToYuanText } from "../../../lib/money";
import type {
  ProjectFinancingQuotaStatus,
  ProjectFinancingQuotaWorkbenchReadModel
} from "../../../api/project-financing-quota.api";

const props = defineProps<{
  workbench: ProjectFinancingQuotaWorkbenchReadModel;
}>();

const quotaColumns = [
  { colKey: "reason", title: "申请事由 / 申请人", minWidth: 240 },
  { colKey: "amountCents", title: "额度金额", width: 130 },
  { colKey: "netUsedAmountCents", title: "已使用净额", width: 130 },
  { colKey: "availableAmountCents", title: "当前可用", width: 130 },
  { colKey: "status", title: "状态 / 当前节点", minWidth: 190 },
  { colKey: "validUntil", title: "有效期", width: 130 }
];

const usageColumns = [
  { colKey: "quota", title: "所属额度", minWidth: 210 },
  { colKey: "business", title: "业务对象", minWidth: 170 },
  { colKey: "projectCashNetAmountCents", title: "自有资金净额", width: 145 },
  { colKey: "financingQuotaNetAmountCents", title: "全部垫资净额", width: 145 },
  { colKey: "currentQuotaNetAmountCents", title: "本额度借 / 贷 / 净额", width: 180 },
  { colKey: "occurredAt", title: "发生时间", width: 170 }
];

const usageRows = computed(() =>
  props.workbench.rows.flatMap((quota) =>
    quota.usageGroups.map((usageGroup) => ({
      ...usageGroup,
      key: `${quota.id}:${usageGroup.executionType}:${usageGroup.executionId}`,
      quotaId: quota.id,
      quotaReason: quota.reason
    }))
  )
);

function formatMoney(value: string): string {
  return `¥${centsTextToYuanText(value)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date);
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function businessTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    payment_request: "合同付款",
    project_expense_request: "项目支出",
    spot_procurement_payment: "零星采购付款",
    expense_claim: "费用报销 / 借款",
    incidental_expense: "零星费用",
    project_expense: "项目支出",
    spot_procurement: "零星采购"
  };
  return labels[value] ?? value;
}

function statusTheme(status: ProjectFinancingQuotaStatus, isExpired: boolean) {
  if (
    (status === "approved" && isExpired) ||
    status === "terminated" ||
    status === "rejected"
  ) {
    return "danger" as const;
  }
  if (status === "approved") return "success" as const;
  if (status === "approval_pending") return "warning" as const;
  return "default" as const;
}
</script>

<style scoped>
.financing-quota-panel {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-md-plus);
  margin-bottom: var(--jg-space-md-plus);
}

.financing-quota-card {
  min-width: 0;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md-plus);
  margin-bottom: var(--jg-space-md-plus);
}

.panel-heading h2,
.panel-heading p,
.usage-description {
  margin: 0;
}

.panel-heading h2 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-section-title);
}

.panel-heading p,
.usage-description,
.reason-cell span,
.status-cell span,
.amount-breakdown span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.panel-heading p {
  margin-top: var(--jg-space-xs);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-sm-plus);
  margin-top: var(--jg-space-md-plus);
}

.summary-item {
  display: grid;
  gap: var(--jg-space-xs);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-md);
  padding: var(--jg-space-md-plus);
  background: var(--jg-bg-muted);
}

.summary-item span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.summary-item strong {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-section-title);
}

.reason-cell,
.status-cell,
.amount-breakdown {
  display: grid;
  gap: var(--jg-space-2xs);
}

.termination-reason {
  overflow-wrap: anywhere;
}

.usage-description {
  margin-bottom: var(--jg-space-md-plus);
}

@container jg-page (max-width: 840px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container jg-page (max-width: 620px) {
  .panel-heading {
    display: grid;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
