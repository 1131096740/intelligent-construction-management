<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  fetchFundsWorkbench,
  type FundsWorkbenchItem,
  type FundsWorkbenchSource,
  type FundsWorkbenchView
} from "../../api/funds-workbench.api";
import JgFilterBar from "../../components/JgFilterBar.vue";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import { centsTextToYuanText } from "../../lib/money";

const router = useRouter();
const view = ref<FundsWorkbenchView>("all");
const source = ref<FundsWorkbenchSource>("all");
const loading = ref(false);
const loadError = ref("");
const rows = ref<FundsWorkbenchItem[]>([]);
const counts = ref<Record<FundsWorkbenchView, number>>({ all: 0, pending_action: 0, in_progress: 0, pending_funds: 0, partial_payment: 0, pending_refund: 0, pending_evidence: 0, completed: 0 });

const viewOptions = [
  { label: "全部", value: "all" },
  { label: "待我办理", value: "pending_action" },
  { label: "审批中", value: "in_progress" },
  { label: "已批待付", value: "pending_funds" },
  { label: "部分支付", value: "partial_payment" },
  { label: "待退款处理", value: "pending_refund" },
  { label: "待补票据", value: "pending_evidence" },
  { label: "已完成", value: "completed" }
];
const sourceOptions = [
  { label: "全部来源", value: "all" },
  { label: "合同付款", value: "contract_payment" },
  { label: "零星材料付款", value: "spot_procurement_payment" },
  { label: "费用报销补付", value: "expense_reimbursement" },
  { label: "借款放款", value: "loan_disbursement" }
];
const columns = [
  { colKey: "code", title: "业务编号", width: 150, fixed: "left" as const },
  { colKey: "source", title: "来源", width: 140 },
  { colKey: "project", title: "项目 / 来源单据", width: 220 },
  { colKey: "reason", title: "付款事由", minWidth: 220 },
  { colKey: "payeeName", title: "收款对象", width: 160 },
  { colKey: "payerName", title: "我方付款主体", width: 160 },
  { colKey: "progress", title: "金额进度", width: 190, align: "right" as const },
  { colKey: "status", title: "状态", width: 130 },
  { colKey: "updatedAt", title: "更新时间", width: 165 }
];
const summary = computed(() => `待我办理 ${counts.value.pending_action} 条 · 审批中 ${counts.value.in_progress} 条 · 已批待付 ${counts.value.pending_funds} 条 · 部分支付 ${counts.value.partial_payment} 条 · 待退款 ${counts.value.pending_refund} 条 · 待补票据 ${counts.value.pending_evidence} 条 · 已完成 ${counts.value.completed} 条`);

function sourceLabel(value: FundsWorkbenchItem["source"]) {
  return ({ contract_payment: "合同付款", spot_procurement_payment: "零星材料付款", expense_reimbursement: "费用报销补付", loan_disbursement: "借款放款" } as Record<string, string>)[value];
}
function statusTone(row: FundsWorkbenchItem) {
  if (row.statusLabel === "已完成") return "success" as const;
  if (row.statusLabel === "审批中" || row.statusLabel === "已批待付" || row.statusLabel === "部分支付" || row.statusLabel === "待退款处理" || row.statusLabel === "待补票据") return "warning" as const;
  return "default" as const;
}
function amount(value: string) { return `¥${centsTextToYuanText(value)}`; }
function projectText(row: FundsWorkbenchItem) { return row.project ? `${row.project.code} · ${row.project.name} · ${row.sourceDocument}` : row.sourceDocument; }
function dateTime(value: string) { return value.replace("T", " ").slice(0, 16); }
function openSource(row: FundsWorkbenchItem) {
  const path = row.source === "contract_payment"
    ? `/付款管理/${encodeURIComponent(row.id)}`
    : row.source === "spot_procurement_payment"
      ? `/零星材料付款/${encodeURIComponent(row.id)}`
      : `/费用与报销/${encodeURIComponent(row.id)}`;
  void router.push(path);
}
async function loadWorkbench() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await fetchFundsWorkbench({ view: view.value, source: source.value });
    rows.value = result.items;
    counts.value = result.viewCounts;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "统一资金工作台读取失败";
  } finally {
    loading.value = false;
  }
}

watch([view, source], () => void loadWorkbench());
onMounted(() => void loadWorkbench());
</script>

<template>
  <JgWorkbenchShell
    class="funds-workbench"
    title="统一资金办理工作台"
    description="汇集合同付款、零星材料付款、费用报销补付和借款放款；本页只读投影，实际付款仍在各来源的受控流程中办理。"
  >
    <template #actions>
      <t-button
        variant="outline"
        :loading="loading"
        @click="loadWorkbench"
      >
        刷新数据
      </t-button>
    </template>
    <template #filters>
      <JgFilterBar
        title="资金办理筛选"
        description="项目范围由服务端按当前账号可见范围裁剪，非项目费用补付独立保留。"
      >
        <label class="funds-workbench__filter-field">
          <span>视图</span>
          <t-select
            v-model="view"
            :options="viewOptions"
            :disabled="loading"
          />
        </label>
        <label class="funds-workbench__filter-field">
          <span>来源</span>
          <t-select
            v-model="source"
            :options="sourceOptions"
            :disabled="loading"
          />
        </label>
      </JgFilterBar>
    </template>
    <template #summary>
      <t-card :bordered="true">
        当前 {{ counts.all }} 条 · {{ summary }}
      </t-card>
    </template>
    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="loadError"
      empty-title="当前筛选下暂无资金事项"
      empty-description="本页不产生付款或放款事实；请在来源单据完成受控业务操作。"
      @retry="loadWorkbench"
    >
      <t-card
        class="jg-table-region jg-table-region--wide"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 1540 }"
          horizontal-scroll-affixed-bottom
        >
          <template #code="{ row }">
            <t-link
              theme="primary"
              @click="openSource(row)"
            >
              {{ row.code }}
            </t-link>
          </template>
          <template #source="{ row }">
            {{ sourceLabel(row.source) }}
          </template>
          <template #project="{ row }">
            {{ projectText(row) }}
          </template>
          <template #payeeName="{ row }">
            {{ row.payeeName ?? "未登记" }}
          </template>
          <template #payerName="{ row }">
            {{ row.payerName ?? "来源单据补全" }}
          </template>
          <template #progress="{ row }">
            已付 {{ amount(row.paidAmountCents) }} / 应付 {{ amount(row.requestedAmountCents) }} / 待办 {{ amount(row.remainingAmountCents) }}
          </template>
          <template #status="{ row }">
            <JgStatusTag
              :label="row.statusLabel"
              :tone="statusTone(row)"
            />
          </template>
          <template #updatedAt="{ row }">
            {{ dateTime(row.updatedAt) }}
          </template>
        </t-table>
      </t-card>
    </JgResultState>
  </JgWorkbenchShell>
</template>
