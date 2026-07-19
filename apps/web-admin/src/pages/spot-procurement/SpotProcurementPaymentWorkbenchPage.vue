<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  fetchSpotProcurementPayments,
  type SpotProcurementPaymentListItemReadModel
} from "../../api/spot-procurement.api";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import { centsTextToYuanText } from "../../lib/money";
import type { SpotProcurementPaymentStatus } from "@jiangkong/shared-domain";

const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const projectError = ref("");
const rows = ref<SpotProcurementPaymentListItemReadModel[]>([]);
const projects = ref<ProjectOptionReadModel[]>([]);
const listMeta = ref({ limit: 0, truncated: false });
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
  { colKey: "code", title: "付款 / 采购单", width: 150, fixed: "left" as const },
  { colKey: "project", title: "项目", width: 160 },
  { colKey: "merchantPayee", title: "商户 / 收款对象", width: 155 },
  { colKey: "amounts", title: "付款金额", width: 135, align: "right" as const },
  { colKey: "fulfillment", title: "收货与发票", width: 130 },
  { colKey: "approval", title: "审批状态", width: 130 },
  { colKey: "handlerUpdated", title: "经办与更新", width: 120 },
  { colKey: "operation", title: "操作", width: 90, fixed: "right" as const }
];

const projectOptions = computed(() => [
  { label: "全部项目", value: "" },
  ...projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
]);
const realRows = computed(() =>
  rows.value.filter((row) => row.form === "real_payment" && row.status !== "invalidated")
);
const amountSummary = computed(() => ({
  approval: sumCents(realRows.value.map((row) => row.approvalAmountCents)),
  actual: sumCents(realRows.value.map((row) => row.actualPaidAmountCents)),
  refund: sumCents(realRows.value.map((row) => row.refundAmountCents)),
  net: sumCents(realRows.value.map((row) => row.netPaidAmountCents))
}));

function money(cents: string | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  try {
    return `¥${centsTextToYuanText(cents)}`;
  } catch {
    return "金额异常";
  }
}

function sumCents(values: Array<string | null | undefined>) {
  try {
    return values.reduce((total, value) => total + BigInt(value ?? "0"), 0n).toString();
  } catch {
    return null;
  }
}

function statusTheme(status: SpotProcurementPaymentStatus) {
  if (status === "paid" || status === "settled") return "success" as const;
  if (["approval_pending", "approved_pending_payment", "partially_paid"].includes(status)) return "warning" as const;
  if (["rejected", "voided", "invalidated"].includes(status)) return "danger" as const;
  if (["returned", "withdrawn"].includes(status)) return "primary" as const;
  return "default" as const;
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function primaryChannel(row: SpotProcurementPaymentListItemReadModel) {
  const accountLast4 = row.payee?.accountNumberLast4;
  return accountLast4 ? `尾号 ${accountLast4}` : "未填写账户";
}

function receiptLabel(row: SpotProcurementPaymentListItemReadModel) {
  if (!row.receipt || "available" in row.receipt && !row.receipt.available) return "首笔实付后开放";
  return row.receipt.statusLabel;
}

function operationLabel(row: SpotProcurementPaymentListItemReadModel) {
  return row.status === "draft" ? "填写付款申请" : "查看详情";
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
    loadError.value = error instanceof Error ? error.message : "零星材料付款工作台读取失败";
  } finally {
    loading.value = false;
  }
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
      description="采购审批通过后自动生成付款草稿；实际商户、付款主体、收款对象、单价和税率在 A5 付款申请中确定。"
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
      title="只展示真实付款事实"
      message="审批通过不等于已付款。累计实付、退款、净付和剩余待付只由逐笔实际付款与退款凭证形成；收货在首笔实付后开放，发票可在付款后继续追加。"
    />

    <section
      class="amount-summary"
      aria-label="当前真实付款金额摘要"
    >
      <t-card bordered>
        <span>审批金额</span><strong>{{ money(amountSummary.approval) }}</strong>
      </t-card>
      <t-card bordered>
        <span>累计实付</span><strong>{{ money(amountSummary.actual) }}</strong>
      </t-card>
      <t-card bordered>
        <span>累计退款</span><strong>{{ money(amountSummary.refund) }}</strong>
      </t-card>
      <t-card bordered>
        <span>净付金额</span><strong>{{ money(amountSummary.net) }}</strong>
      </t-card>
    </section>

    <BusinessTableToolbar
      title="付款申请筛选"
      description="列表账号与渠道均保持最小展示，银行卡仅显示末四位。"
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
        placeholder="付款编号、采购编号、商户或收款对象"
        @enter="loadPayments"
      /></label>
    </BusinessTableToolbar>

    <BusinessFeedback
      v-if="loading && !rows.length"
      state="loading"
      title="正在读取零星材料付款"
      description="系统正在核对付款审批、逐笔实付、退款、收货和发票事实。"
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
          </h2><p>每张申请只有一个收款对象，可登记多个收款渠道和多次实际付款；历史单据保持可读，不混入新表单金额汇总。</p>
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
          :scroll="{ x: 1100 }"
          horizontal-scroll-affixed-bottom
        >
          <template #code="{ row }">
            <div class="two-line-cell">
              <t-link
                theme="primary"
                @click="openDetail(row.id)"
              >
                {{ row.code }}
              </t-link>
              <span>{{ row.procurement.code }}</span>
            </div>
          </template>
          <template #project="{ row }">
            {{ row.project.code }} · {{ row.project.name }}
          </template>
          <template #merchantPayee="{ row }">
            <div class="two-line-cell">
              <strong>{{ row.merchantName ?? row.procurement.supplierName ?? "待经办人填写" }}</strong>
              <span>{{ row.payee?.name ?? row.payeeName ?? primaryChannel(row) }}</span>
            </div>
          </template>
          <template #amounts="{ row }">
            <div class="two-line-cell amount-cell">
              <strong>审批 {{ money(row.approvalAmountCents) }}</strong>
              <span>净付 {{ money(row.netPaidAmountCents) }}</span>
            </div>
          </template>
          <template #fulfillment="{ row }">
            <div class="two-line-cell">
              <span>收货：{{ receiptLabel(row) }}</span>
              <span>发票：{{ row.invoice?.statusLabel ?? "历史单据" }}</span>
            </div>
          </template>
          <template #approval="{ row }">
            <div class="two-line-cell">
              <t-tag
                size="small"
                :theme="statusTheme(row.status)"
                variant="light"
              >
                {{ row.statusLabel }}
              </t-tag><span>{{ row.approval.currentNodeName }}</span>
            </div>
          </template>
          <template #handlerUpdated="{ row }">
            <div class="two-line-cell">
              <strong>{{ row.handler.name }}</strong>
              <span>{{ dateTime(row.updatedAt) }}</span>
            </div>
          </template>
          <template #operation="{ row }">
            <t-button
              size="small"
              variant="outline"
              @click="openDetail(row.id)"
            >
              {{ operationLabel(row) }}
            </t-button>
          </template>
        </t-table>
      </div>
      <t-empty
        v-else
        description="暂无可查看的零星材料付款申请"
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
.spot-payment-workbench,.data-panel{display:grid;gap:var(--jg-space-lg);min-width:0;color:var(--jg-color-text-primary)}
.amount-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--jg-space-md)}
.amount-summary :deep(.t-card__body){display:grid;gap:var(--jg-space-xs)}
.amount-summary span,.section-heading p,.section-heading>span,.filter-field>span,.two-line-cell span{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}
.amount-summary strong{font-size:var(--jg-font-size-section-title)}
.section-heading{display:flex;justify-content:space-between;gap:var(--jg-space-lg);align-items:flex-end}.section-heading h2,.section-heading p{margin:0}.section-heading p{margin-top:var(--jg-space-xs)}
.filter-field{display:grid;gap:var(--jg-space-xs);min-width:160px}.filter-field--keyword{min-width:min(320px,100%)}.two-line-cell{display:grid;gap:var(--jg-space-xs);min-width:0}.two-line-cell strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.amount-cell{justify-items:end}
@media (max-width:900px){.amount-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.section-heading{align-items:flex-start;flex-direction:column}}@media (max-width:560px){.amount-summary{grid-template-columns:1fr}}
</style>
