<script setup lang="ts">
import { onMounted, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";

import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchFundMovements,
  type FundMovementKind,
  type FundMovementListItem
} from "../../api/fund-movement.api";
import { centsTextToYuanText } from "../../lib/money";

const rows = ref<FundMovementListItem[]>([]);
const loading = ref(false);
const errorMessage = ref("");

const kindLabels: Record<FundMovementKind, string> = {
  cross_project_payment: "跨项目支付",
  same_project_company_transfer: "同项目公司持有调拨",
  temporary_project_fund_use: "临时使用项目资金",
  temporary_project_fund_return: "归还临时使用资金",
  company_advance: "公司为项目垫资",
  company_advance_recovery: "收回项目垫资",
  profit_distribution_execution: "利润分配执行"
};
const statusLabels: Record<string, string> = {
  draft: "草稿",
  submitted: "待确认",
  review_returned: "已退回",
  confirmed: "已确认"
};
const columns = [
  { colKey: "kind", title: "资金用途", width: 190 },
  { colKey: "scope", title: "项目与公司范围", minWidth: 230 },
  { colKey: "paymentAmountCents", title: "金额（元）", width: 150, align: "right" as const },
  { colKey: "legs", title: "分腿", width: 100 },
  { colKey: "status", title: "状态", width: 110 },
  { colKey: "createdAt", title: "创建时间", width: 170 }
];

function amount(value: string) {
  return `¥${centsTextToYuanText(value)}`;
}
function kindLabel(kind: string) {
  return kindLabels[kind as FundMovementKind] ?? "资金移动";
}
function statusTone(status: string) {
  return status === "confirmed" ? "success" as const : status === "review_returned" ? "warning" as const : "default" as const;
}
function dateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
function loadError(error: unknown) {
  errorMessage.value = formatUnknownApiError(error, "读取资金移动工作台失败");
}
async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    rows.value = await fetchFundMovements();
  } catch (error) {
    loadError(error);
  } finally {
    loading.value = false;
  }
}
function showBoundaryNotice() {
  MessagePlugin.info("资金移动确认会重新核验分腿、往来、余额和职责分离；本页不直接执行付款。");
}

onMounted(() => void load());
</script>

<template>
  <section class="fund-movement-page">
    <BusinessPageHeader
      title="项目与公司资金移动"
      description="每条资金移动按项目分腿形成经营事实；确认前会重新核验余额、往来和职责分离。"
    >
      <template #actions>
        <t-button variant="outline" @click="showBoundaryNotice">查看办理边界</t-button>
        <t-button variant="outline" :loading="loading" @click="load">刷新</t-button>
      </template>
    </BusinessPageHeader>

    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="errorMessage"
      empty-title="暂无资金移动"
      empty-description="资金移动由受控来源流程产生，本页不创建银行付款事实。"
      @retry="load"
    >
      <t-card class="jg-table-region jg-table-region--wide" :bordered="true">
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 980 }"
          horizontal-scroll-affixed-bottom
        >
          <template #kind="{ row }">
            {{ kindLabel(row.kind) }}
          </template>
          <template #scope="{ row }">
            来源项目与受益项目已冻结（{{ row.legs.length }} 条项目腿）
          </template>
          <template #paymentAmountCents="{ row }">
            {{ amount(row.paymentAmountCents) }}
          </template>
          <template #legs="{ row }">
            {{ row.legs.length }} 条项目腿
          </template>
          <template #status="{ row }">
            <JgStatusTag :label='statusLabels[row.status] ?? "待处理"' :tone="statusTone(row.status)" />
          </template>
          <template #createdAt="{ row }">
            {{ dateTime(row.createdAt) }}
          </template>
        </t-table>
      </t-card>
    </JgResultState>
  </section>
</template>
