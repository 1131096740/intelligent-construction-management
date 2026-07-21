<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  fetchSpotProcurementPayments,
  type SpotPaymentListAmountSummary,
  type SpotPaymentWorkbenchView,
  type SpotProcurementPaymentListItemReadModel
} from "../../api/spot-procurement.api";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessStatusText from "../../components/BusinessStatusText.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import { centsTextToYuanText } from "../../lib/money";
import type { SpotProcurementPaymentStatus } from "@jiangkong/shared-domain";
import PaymentTaskQueue from "./components/PaymentTaskQueue.vue";
import {
  spotPaymentStatusSemantic,
  spotPaymentTaskPresentation
} from "./spot-payment-workbench.config";

const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const projectError = ref("");
const rows = ref<SpotProcurementPaymentListItemReadModel[]>([]);
const projects = ref<ProjectOptionReadModel[]>([]);
const activeView = ref<SpotPaymentWorkbenchView>("mine");
const viewCounts = ref<Record<SpotPaymentWorkbenchView, number>>({
  mine: 0,
  all: 0,
  closed: 0
});
const amountSummary = ref<SpotPaymentListAmountSummary | null>(null);
const listMeta = ref({ limit: 0, truncated: false });
let latestPaymentRequestId = 0;
const filters = reactive({
  projectId: "",
  status: "" as SpotProcurementPaymentStatus | "",
  keyword: ""
});

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "付款草稿", value: "draft" },
  { label: "付款审批中", value: "approval_pending" },
  { label: "已批待付", value: "approved_pending_payment" },
  { label: "部分已付", value: "partially_paid" },
  { label: "公司付款已付", value: "paid" },
  { label: "已结清", value: "settled" },
  { label: "已退回", value: "returned" },
  { label: "草稿已放弃", value: "invalidated" },
  { label: "已作废", value: "voided" }
];
const columns = [
  { colKey: "application", title: "付款申请", width: 150, fixed: "left" as const },
  { colKey: "projectMerchant", title: "项目 / 商户", width: 190 },
  { colKey: "amount", title: "金额", width: 120, align: "right" as const },
  { colKey: "status", title: "当前状态", width: 125 },
  { colKey: "task", title: "当前任务", width: 180 },
  { colKey: "operation", title: "操作", width: 90, fixed: "right" as const }
];

const projectOptions = computed(() => [
  { label: "全部项目", value: "" },
  ...projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
]);

function money(cents: string | null | undefined) {
  if (cents === null || cents === undefined) return "待确定";
  try {
    return `¥${centsTextToYuanText(cents)}`;
  } catch {
    return "金额异常";
  }
}

function taskPresentation(row: SpotProcurementPaymentListItemReadModel) {
  return spotPaymentTaskPresentation(row.currentTask);
}

function openDetail(paymentId: string) {
  void router.push(`/零星材料付款/${encodeURIComponent(paymentId)}`);
}

async function loadPayments() {
  const requestId = ++latestPaymentRequestId;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await fetchSpotProcurementPayments({
      view: activeView.value,
      projectId: filters.projectId || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword.trim() || undefined
    });
    if (requestId !== latestPaymentRequestId) return;
    activeView.value = result.view;
    rows.value = result.items;
    viewCounts.value = result.viewCounts;
    amountSummary.value = result.amountSummary;
    listMeta.value = { limit: result.limit, truncated: result.truncated };
  } catch (error) {
    if (requestId !== latestPaymentRequestId) return;
    loadError.value = error instanceof Error ? error.message : "零星材料付款工作台读取失败";
  } finally {
    if (requestId === latestPaymentRequestId) loading.value = false;
  }
}

function changeView(view: SpotPaymentWorkbenchView) {
  if (view === activeView.value) return;
  activeView.value = view;
  rows.value = [];
  amountSummary.value = null;
  listMeta.value = { limit: 0, truncated: false };
  void loadPayments();
}

async function loadProjects() {
  projectError.value = "";
  try {
    projects.value = await fetchProjects();
  } catch (error) {
    projectError.value = error instanceof Error ? error.message : "项目筛选选项读取失败";
  }
}

function resetFilters() {
  filters.projectId = "";
  filters.status = "";
  filters.keyword = "";
  void loadPayments();
}

onMounted(() => void Promise.all([loadProjects(), loadPayments()]));
</script>

<template>
  <section class="spot-payment-workbench jg-responsive-ledger">
    <BusinessPageHeader
      title="零星材料付款工作台"
      description="先完成待办，再查询全部付款申请。"
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

    <PaymentTaskQueue
      :rows="rows"
      :counts="viewCounts"
      :active-view="activeView"
      :loading="loading"
      @view-change="changeView"
      @open-detail="openDetail"
    />

    <BusinessTableToolbar
      title="付款申请筛选"
      description="按项目、付款状态或编号与商户关键词查找当前视图。"
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
      <label class="filter-field"><span>项目</span><t-select
        v-model="filters.projectId"
        :options="projectOptions"
        placeholder="全部项目"
      /></label>
      <label class="filter-field"><span>付款状态</span><t-select
        v-model="filters.status"
        :options="statusOptions"
      /></label>
      <label class="filter-field filter-field--keyword"><span>关键词</span><t-input
        v-model="filters.keyword"
        clearable
        placeholder="付款编号、采购编号或商户"
        @enter="loadPayments"
      /></label>
    </BusinessTableToolbar>

    <BusinessFeedback
      v-if="projectError"
      state="info"
      title="项目筛选暂不可用"
      :description="projectError"
      action-label="重新读取"
      @action="loadProjects"
    />
    <BusinessFeedback
      v-if="loading && !rows.length"
      state="loading"
      title="正在读取零星材料付款"
      description="系统正在读取当前视图、任务和付款台账。"
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
      <section
        v-if="amountSummary !== null"
        class="amount-summary"
        aria-label="当前真实付款金额摘要"
      >
        <div><span>审批金额</span><strong>{{ money(amountSummary.approvalAmountCents) }}</strong></div>
        <div><span>累计实付</span><strong>{{ money(amountSummary.actualPaidAmountCents) }}</strong></div>
        <div><span>累计退款</span><strong>{{ money(amountSummary.refundAmountCents) }}</strong></div>
        <div><span>净付金额</span><strong>{{ money(amountSummary.netPaidAmountCents) }}</strong></div>
      </section>
      <t-alert
        v-if="amountSummary !== null && !amountSummary.complete"
        theme="warning"
        title="汇总未覆盖全部可见记录"
        message="当前金额摘要仅使用服务端确认可汇总的付款事实，请以各付款详情为准。"
      />

      <header class="section-heading">
        <div>
          <h2 id="spot-payment-table-title">
            付款申请
          </h2>
          <p>工作台只保留六个核心信息组，完整财务事实在付款详情中查看。</p>
        </div>
        <span>当前返回 {{ rows.length }} / {{ listMeta.limit || "—" }} 条</span>
      </header>
      <t-alert
        v-if="listMeta.truncated"
        theme="warning"
        title="结果已截断"
        message="为保护查询性能，当前只返回可访问结果的前一部分；请缩小项目、状态或关键词范围。"
      />
      <div
        v-if="rows.length"
        class="jg-table-region jg-table-region--wide"
      >
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 855 }"
          horizontal-scroll-affixed-bottom
        >
          <template #application="{ row }">
            <div class="two-line-cell">
              <t-link
                theme="primary"
                @click="openDetail(row.id)"
              >
                {{ row.code }}
              </t-link>
              <span>采购 {{ row.procurement.code }}</span>
            </div>
          </template>
          <template #projectMerchant="{ row }">
            <div class="two-line-cell">
              <strong>{{ row.project.code }} · {{ row.project.name }}</strong>
              <span>{{ row.merchantName ?? row.procurement.supplierName ?? "待填写" }}</span>
            </div>
          </template>
          <template #amount="{ row }">
            <strong class="amount-cell">{{ money(row.approvalAmountCents) }}</strong>
          </template>
          <template #status="{ row }">
            <BusinessStatusText
              :text="row.statusLabel"
              :semantic="spotPaymentStatusSemantic(row.status)"
            />
          </template>
          <template #task="{ row }">
            <BusinessStatusText
              :text="row.currentTask.label"
              :semantic="taskPresentation(row).semantic"
            />
          </template>
          <template #operation="{ row }">
            <t-button
              size="small"
              variant="outline"
              @click="openDetail(row.id)"
            >
              {{ taskPresentation(row).actionLabel }}
            </t-button>
          </template>
        </t-table>
      </div>
      <t-empty
        v-else
        description="当前视图暂无可查看的零星材料付款申请"
      />
      <t-alert
        v-if="rows.some((row) => row.voucherStatus === 'anomaly')"
        theme="error"
        title="存在凭证异常"
        message="异常付款禁止继续登记新的实际付款，请由获权财务人员先核对付款凭证事实。"
      />
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
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.amount-summary > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
}

.amount-summary > div:last-child {
  border-right: 0;
}

.amount-summary span,
.section-heading p,
.section-heading > span,
.filter-field > span,
.two-line-cell span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.amount-summary strong {
  font-size: var(--jg-font-size-section-title);
}

.section-heading {
  display: flex;
  gap: var(--jg-space-lg);
  align-items: flex-end;
  justify-content: space-between;
}

.section-heading h2,
.section-heading p {
  margin: 0;
}

.section-heading p {
  margin-top: var(--jg-space-xs);
}

.filter-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: var(--jg-layout-list-filter-field-min-width);
}

.filter-field--keyword {
  min-width: min(var(--jg-layout-list-filter-keyword-min-width), 100%);
}

.two-line-cell {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.two-line-cell strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount-cell {
  display: block;
  text-align: right;
}

@media (max-width: 900px) {
  .amount-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .amount-summary > div:nth-child(2) {
    border-right: 0;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 560px) {
  .amount-summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .amount-summary > div {
    border-right: 0;
  }
}
</style>
