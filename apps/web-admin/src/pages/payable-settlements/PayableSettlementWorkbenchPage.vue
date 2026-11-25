<script setup lang="ts">
import { useRouter } from "vue-router";
import { computed, onMounted, ref } from "vue";

import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";
import {
  fetchInterEntityRelationships,
  fetchPayableSettlementCapabilities,
  fetchPayableSettlementWorkbench,
  fetchWagePayableCases,
  type PayableSettlementCapabilities,
  type PayableSettlementWorkbenchItem,
  type InterEntityRelationshipReadModel,
  type WagePayableCaseOption
} from "../../api/payable-settlement.api";

const emptyCapabilities: PayableSettlementCapabilities = {
  read: false,
  allocate: false,
  submit: false,
  confirm: false,
  return: false,
  returnRelationship: false
};

const router = useRouter();
const loading = ref(false);
const errorMessage = ref("");
const capabilities = ref<PayableSettlementCapabilities>({ ...emptyCapabilities });
const wageCases = ref<WagePayableCaseOption[]>([]);
const workbench = ref<PayableSettlementWorkbenchItem[]>([]);
const interEntityRelationships = ref<InterEntityRelationshipReadModel[]>([]);

const overSettledCases = computed(() => wageCases.value.filter(
  (item) => item.status === "over_settled_reconciliation_required"
));
const wageHistoryColumns = [
  { colKey: "displayLabel", title: "工资应付", minWidth: 230 },
  { colKey: "debtorCompanyLabel", title: "债务主体", minWidth: 150 },
  { colKey: "statusLabel", title: "状态", width: 140 },
  { colKey: "remainingAmountCents", title: "剩余金额（元）", width: 150 }
];
const workbenchColumns = [
  { colKey: "statusLabel", title: "状态", width: 120 },
  { colKey: "allocatedAmountCents", title: "已分配金额（元）", width: 170 },
  { colKey: "updatedAt", title: "更新时间", minWidth: 190 }
];
const relationshipColumns = [
  { colKey: "debtorLabel", title: "原债务主体", minWidth: 170 },
  { colKey: "approvedPayerLabel", title: "批准付款主体", minWidth: 170 },
  { colKey: "creditorLabel", title: "实际付款主体", minWidth: 170 },
  { colKey: "amountCents", title: "代付金额（元）", width: 150 },
  { colKey: "remainingAmountCents", title: "未结余额（元）", width: 150 },
  { colKey: "statusLabel", title: "往来状态", width: 110 },
  { colKey: "actions", title: "操作", width: 110 }
];

onMounted(loadInitial);

async function loadInitial() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [serverCapabilities, cases, rows, relationships] = await Promise.all([
      fetchPayableSettlementCapabilities(),
      fetchWagePayableCases(),
      fetchPayableSettlementWorkbench(),
      fetchInterEntityRelationships()
    ]);
    capabilities.value = serverCapabilities;
    wageCases.value = cases;
    workbench.value = rows;
    interEntityRelationships.value = relationships;
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "加载历史工资应付核销失败");
  } finally {
    loading.value = false;
  }
}

function requestRelationshipReturn(row: InterEntityRelationshipReadModel) {
  void router.push({
    path: "/公司互转台账",
    query: { originalInterEntityRelationshipId: row.relationshipEntryId }
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCents(value: string) {
  try {
    return centsTextToYuanText(value);
  } catch {
    return "金额待核对";
  }
}
</script>

<template>
  <section class="payable-settlement-page">
    <header>
      <div>
        <h1>历史工资应付核销</h1>
        <p>工资应付核销已停止办理，历史案件、核销记录和余额可查询。</p>
      </div>
      <t-button variant="outline" :loading="loading" @click="loadInitial">刷新</t-button>
    </header>

    <t-alert v-if="errorMessage" theme="error" title="暂时无法加载" :message="errorMessage" />
    <t-alert
      v-if="overSettledCases.length"
      theme="warning"
      title="超额核销待核对"
      :message="`${overSettledCases.length} 条工资应付的有效金额低于已确认核销额，已停止新增核销，请先完成核对。`"
    />

    <t-card class="panel" title="历史工资应付">
      <t-table
        row-key="payableRef"
        :columns="wageHistoryColumns"
        :data="wageCases"
        :loading="loading"
        empty="暂无历史工资应付"
      >
        <template #remainingAmountCents="{ row }">{{ formatCents(row.remainingAmountCents) }}</template>
      </t-table>
    </t-card>

    <t-card class="panel" title="历史核销案件">
      <t-table
        row-key="settlementCaseId"
        :columns="workbenchColumns"
        :data="workbench"
        :loading="loading"
        empty="暂无核销案件"
      >
        <template #updatedAt="{ row }">{{ formatDate(row.updatedAt) }}</template>
        <template #allocatedAmountCents="{ row }">{{ formatCents(row.allocatedAmountCents) }}</template>
      </t-table>
    </t-card>

    <t-card class="panel" title="跨主体代付往来">
      <t-alert
        theme="info"
        title="独立往来事实"
        message="实际付款主体与原债务主体不一致时，系统只记录实际付款主体对原债务主体的等额往来；归还不会改写工资应付或付款事实。"
      />
      <t-table
        row-key="relationshipEntryId"
        :columns="relationshipColumns"
        :data="interEntityRelationships"
        :loading="loading"
        empty="暂无跨主体代付往来"
      >
        <template #amountCents="{ row }">{{ formatCents(row.amountCents) }}</template>
        <template #remainingAmountCents="{ row }">{{ formatCents(row.remainingAmountCents) }}</template>
        <template #actions="{ row }">
          <t-link
            v-if="row.status === 'open' && capabilities.returnRelationship"
            theme="primary"
            @click="requestRelationshipReturn(row)"
          >追加归还</t-link>
          <span v-else>—</span>
        </template>
      </t-table>
    </t-card>

  </section>
</template>

<style scoped>
.payable-settlement-page {
  display: grid;
  gap: var(--jg-space-lg);
}

header {
  align-items: flex-start;
  display: flex;
  gap: var(--jg-space-lg);
  justify-content: space-between;
}

h1,
p {
  margin: 0;
}

header p {
  color: var(--jg-color-text-secondary);
  margin-top: var(--jg-space-xs);
}

</style>
