<script setup lang="ts">
import type { SpotProcurementPaymentStatus } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  fetchProjects,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  fetchSpotProcurementPayments,
  type SpotProcurementPaymentListItemReadModel,
  type SpotProcurementVoucherStatus
} from "../../api/spot-procurement.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import { centsTextToYuanText } from "../../lib/money";

const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const projectError = ref("");
const rows = ref<SpotProcurementPaymentListItemReadModel[]>([]);
const projects = ref<ProjectOptionReadModel[]>([]);
const listMeta = ref<{
  limit: number;
  truncated: boolean;
}>({
  limit: 200,
  truncated: false
});

const filters = reactive({
  projectId: "",
  status: "" as SpotProcurementPaymentStatus | "",
  keyword: ""
});

const columns = [
  { colKey: "code", title: "付款申请编号", width: 175, fixed: "left" as const },
  { colKey: "procurement", title: "采购编号/供应商", width: 190 },
  { colKey: "project", title: "项目", width: 170 },
  { colKey: "paymentPathLabel", title: "支付路径", width: 120 },
  { colKey: "payeeName", title: "收款对象", width: 140 },
  { colKey: "settlementAmountCents", title: "结算申请金额", width: 130, align: "right" as const },
  { colKey: "supplierBalanceAmountCents", title: "供应商余额抵扣", width: 140, align: "right" as const },
  { colKey: "companyPaymentAmountCents", title: "公司付款申请", width: 130, align: "right" as const },
  { colKey: "paidAmountCents", title: "公司实际付款", width: 130, align: "right" as const },
  { colKey: "remainingCompanyPaymentAmountCents", title: "公司剩余待付", width: 130, align: "right" as const },
  { colKey: "canceledAmountCents", title: "未执行取消", width: 120, align: "right" as const },
  { colKey: "approval", title: "审批状态", width: 120 },
  { colKey: "companyPaymentStatusLabel", title: "执行与结清", width: 125 },
  { colKey: "voucherStatus", title: "付款凭证", width: 125 },
  { colKey: "invoiceCoverage", title: "发票覆盖", width: 110 },
  { colKey: "currentNode", title: "当前处理节点", width: 140 },
  { colKey: "updatedAt", title: "更新时间", width: 170 },
  { colKey: "operation", title: "操作", width: 90, fixed: "right" as const }
];

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "草稿", value: "draft" },
  { label: "审批中", value: "approval_pending" },
  { label: "已批准待付款", value: "approved_pending_payment" },
  { label: "部分已付", value: "partially_paid" },
  { label: "已付", value: "paid" },
  { label: "已结清", value: "settled" },
  { label: "已退回", value: "returned" },
  { label: "已驳回", value: "rejected" },
  { label: "已撤回", value: "withdrawn" },
  { label: "已作废", value: "voided" },
  { label: "已失效", value: "invalidated" }
];

const projectOptions = computed(() => [
  { label: "全部项目", value: "" },
  ...projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
]);

const amountSummary = computed(() => ({
  settlement: sumCents(rows.value.map((row) => row.settlementAmountCents)),
  supplierBalance: sumCents(rows.value.map((row) => row.supplierBalanceAmountCents)),
  companyRequested: sumCents(rows.value.map((row) => row.companyPaymentAmountCents)),
  companyPaid: sumCents(rows.value.map((row) => row.paidAmountCents))
}));

function money(cents: string | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  try {
    return `¥${centsTextToYuanText(cents)}`;
  } catch {
    return "金额异常";
  }
}

function sumCents(values: readonly string[]) {
  try {
    return values.reduce((total, value) => total + BigInt(value), 0n).toString();
  } catch {
    return null;
  }
}

function dateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

function statusTheme(status: SpotProcurementPaymentStatus) {
  if (status === "paid" || status === "settled") return "success" as const;
  if (status === "approval_pending" || status === "approved_pending_payment" || status === "partially_paid") {
    return "warning" as const;
  }
  if (status === "rejected" || status === "voided" || status === "invalidated") {
    return "danger" as const;
  }
  if (status === "returned" || status === "withdrawn") return "primary" as const;
  return "default" as const;
}

function voucherTheme(status: SpotProcurementVoucherStatus) {
  if (status === "complete") return "success" as const;
  if (status === "anomaly") return "danger" as const;
  return "default" as const;
}

function openDetail(paymentId: string) {
  void router.push(`/零星材料付款/${encodeURIComponent(paymentId)}`);
}

async function loadPayments() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await fetchSpotProcurementPayments({
      projectId: filters.projectId || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword.trim() || undefined
    });
    rows.value = result.items;
    listMeta.value = { limit: result.limit, truncated: result.truncated };
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "零星材料付款工作台读取失败";
  } finally {
    loading.value = false;
  }
}

async function loadProjects() {
  projectError.value = "";
  try {
    projects.value = await fetchProjects();
  } catch (error) {
    projectError.value =
      error instanceof Error ? error.message : "项目筛选选项读取失败";
  }
}

function resetFilters() {
  filters.projectId = "";
  filters.status = "";
  filters.keyword = "";
  void loadPayments();
}

onMounted(() => {
  void Promise.all([loadProjects(), loadPayments()]);
});
</script>

<template>
  <section class="spot-payment-workbench">
    <BusinessPageHeader
      title="零星材料付款工作台"
      description="新付款草稿从已审批的采购详情创建；本页仅展示真实关联付款，不提供脱离采购来源的新建入口。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="loading"
          @click="loadPayments"
        >
          刷新数据
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="projectError"
      state="info"
      title="项目筛选暂不可用"
      :description="projectError"
      action-label="重新读取"
      @action="loadProjects"
    />

    <t-alert
      theme="info"
      title="四个金额口径独立展示"
      message="结算申请金额 = 供应商余额抵扣 + 公司付款申请；公司实际付款只来自未作废且付款凭证有效的执行事实。供应商余额抵扣绝不显示为银行已付。"
    />

    <section
      class="amount-summary"
      aria-label="当前付款列表金额摘要"
    >
      <t-card bordered>
        <span>结算申请金额</span>
        <strong>{{ money(amountSummary.settlement) }}</strong>
      </t-card>
      <t-card bordered>
        <span>供应商余额抵扣</span>
        <strong>{{ money(amountSummary.supplierBalance) }}</strong>
      </t-card>
      <t-card bordered>
        <span>公司付款申请</span>
        <strong>{{ money(amountSummary.companyRequested) }}</strong>
      </t-card>
      <t-card bordered>
        <span>公司实际付款</span>
        <strong>{{ money(amountSummary.companyPaid) }}</strong>
      </t-card>
    </section>

    <BusinessTableToolbar
      title="付款申请筛选"
      description="列表只展示当前账号有权查看的付款事实。"
      appearance="plain"
    >
      <template #actions>
        <t-button
          size="small"
          variant="text"
          @click="resetFilters"
        >
          重置筛选
        </t-button>
        <t-button
          size="small"
          variant="outline"
          :loading="loading"
          @click="loadPayments"
        >
          查询
        </t-button>
      </template>

      <label class="filter-field">
        <span>项目</span>
        <t-select
          v-model="filters.projectId"
          :options="projectOptions"
          placeholder="全部项目"
        />
      </label>
      <label class="filter-field">
        <span>付款状态</span>
        <t-select
          v-model="filters.status"
          :options="statusOptions"
        />
      </label>
      <label class="filter-field filter-field--keyword">
        <span>关键词</span>
        <t-input
          v-model="filters.keyword"
          clearable
          placeholder="付款编号、采购编号、供应商或收款人"
          @enter="loadPayments"
        />
      </label>
    </BusinessTableToolbar>

    <BusinessFeedback
      v-if="loading && !rows.length"
      state="loading"
      title="正在读取零星材料付款"
      description="系统正在核对审批、余额抵扣、实际付款与凭证事实。"
    />
    <BusinessFeedback
      v-else-if="loadError"
      state="error"
      title="零星材料付款暂不可用"
      :description="loadError"
      action-label="重新加载"
      @action="loadPayments"
    />

    <section
      v-else
      class="data-panel"
      aria-labelledby="spot-payment-table-title"
    >
      <header class="section-heading">
        <div>
          <h2 id="spot-payment-table-title">
            付款申请记录
          </h2>
          <p>公司实际付款与余额抵扣分列展示；发票覆盖在相关功能开放前标记为“阶段 B 开放”。</p>
        </div>
        <span>当前返回 {{ rows.length }} 条</span>
      </header>

      <t-table
        v-if="rows.length"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="columns"
        :data="rows"
        :loading="loading"
        :scroll="{ x: 2440 }"
      >
        <template #code="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            {{ row.code }}
          </t-link>
        </template>
        <template #procurement="{ row }">
          <div class="two-line-cell">
            <strong>{{ row.procurement.code }}</strong>
            <span>{{ row.procurement.supplierName }}</span>
          </div>
        </template>
        <template #project="{ row }">
          {{ row.project.code }} · {{ row.project.name }}
        </template>
        <template #settlementAmountCents="{ row }">
          <strong>{{ money(row.settlementAmountCents) }}</strong>
        </template>
        <template #supplierBalanceAmountCents="{ row }">
          <div class="two-line-cell two-line-cell--money">
            <strong>{{ money(row.supplierBalanceAmountCents) }}</strong>
            <span>已执行 {{ money(row.executedSupplierBalanceAmountCents) }}</span>
          </div>
        </template>
        <template #companyPaymentAmountCents="{ row }">
          <div class="two-line-cell two-line-cell--money">
            <strong>{{ money(row.companyPaymentAmountCents) }}</strong>
            <span>当前有效 {{ money(row.effectiveCompanyPaymentAmountCents) }}</span>
          </div>
        </template>
        <template #paidAmountCents="{ row }">
          <div class="two-line-cell two-line-cell--money">
            <strong>{{ money(row.paidAmountCents) }}</strong>
            <t-tag
              v-if="!row.paymentFactConsistent"
              size="small"
              theme="danger"
              variant="light"
            >
              付款事实待核对
            </t-tag>
          </div>
        </template>
        <template #remainingCompanyPaymentAmountCents="{ row }">
          {{ money(row.remainingCompanyPaymentAmountCents) }}
        </template>
        <template #canceledAmountCents="{ row }">
          {{ money(row.canceledAmountCents) }}
        </template>
        <template #approval="{ row }">
          <t-tag
            :theme="statusTheme(row.status)"
            variant="light"
          >
            {{ row.approval.statusLabel || row.statusLabel }}
          </t-tag>
        </template>
        <template #companyPaymentStatusLabel="{ row }">
          {{ row.companyPaymentStatusLabel }}
        </template>
        <template #voucherStatus="{ row }">
          <t-tag
            :theme="voucherTheme(row.voucherStatus)"
            variant="light"
          >
            {{ row.voucherStatusLabel }}
          </t-tag>
        </template>
        <template #invoiceCoverage>
          <t-tag variant="outline">
            阶段 B 开放
          </t-tag>
        </template>
        <template #currentNode="{ row }">
          {{ row.approval.currentNodeName || "—" }}
        </template>
        <template #updatedAt="{ row }">
          {{ dateTime(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            查看详情
          </t-link>
        </template>
      </t-table>

      <EmptyBusinessState
        v-else
        title="当前条件下暂无零星材料付款"
        description="新付款草稿需从已审批的零星采购详情创建；也可以调整本页筛选条件。"
      />

      <footer class="data-footer">
        <span>数据范围</span>
        <p v-if="listMeta.truncated">
          当前最多展示 {{ listMeta.limit }} 条可见付款，请收紧筛选条件继续查询。
        </p>
        <p v-else>
          已展示当前筛选下的全部可见付款。
        </p>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.spot-payment-workbench,
.data-panel {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.amount-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.amount-summary :deep(.t-card__body) {
  display: grid;
  gap: var(--jg-space-xs);
}

.amount-summary span,
.filter-field > span,
.section-heading p,
.data-footer,
.data-footer p,
.two-line-cell span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.amount-summary strong {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.filter-field {
  display: grid;
  flex: 1 1 var(--jg-control-width-md);
  gap: var(--jg-space-xs);
  min-width: 0;
}

.filter-field--keyword {
  flex-grow: 2;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.section-heading h2,
.section-heading p,
.data-footer p {
  margin: 0;
}

.section-heading h2 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.section-heading p {
  margin-top: var(--jg-space-xs);
}

.two-line-cell {
  display: grid;
  gap: var(--jg-space-2xs);
}

.two-line-cell--money {
  justify-items: end;
}

.data-footer {
  display: flex;
  gap: var(--jg-space-md);
  padding-top: var(--jg-space-md);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.data-footer > span {
  flex: 0 0 auto;
  color: var(--jg-color-text-secondary);
  font-weight: var(--jg-font-weight-semibold);
}

@media (max-width: 960px) {
  .amount-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .amount-summary {
    grid-template-columns: 1fr;
  }

  .section-heading,
  .data-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
