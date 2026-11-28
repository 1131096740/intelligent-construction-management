<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import { useRouter } from "vue-router";
import BusinessMobileCards, { type BusinessMobileCard } from "../../components/BusinessMobileCards.vue";
import JgResultState from "../../components/JgResultState.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import type { ExpenseClaimListItemReadModel } from "../../api/expense-claim.api";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchOtherProjectPaymentDetail,
  fetchOtherProjectPaymentEntry,
  fetchOtherProjectPayments,
  type OtherProjectPaymentDetailReadModel,
  type OtherProjectPaymentEntryReadModel
} from "../../api/other-project-payment.api";
import { centsTextToYuanText } from "../../lib/money";

const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const rows = ref<ExpenseClaimListItemReadModel[]>([]);
const entry = ref<OtherProjectPaymentEntryReadModel | null>(null);
const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<OtherProjectPaymentDetailReadModel | null>(null);

const entryDescription = computed(() =>
  entry.value?.description ?? "为真实无合同项目支出登记费用并申请标准项目付款，不补造合同或结算。"
);
const dutyText = computed(() => entry.value?.approvalDutyLabels.join("、") ?? "综合部主管、项目经理、财务主管、董事长/总经理");

const columns = [
  { colKey: "code", title: "正式编号", width: 170, fixed: "left" as const },
  { colKey: "project", title: "项目", minWidth: 180 },
  { colKey: "category", title: "类别", width: 150 },
  { colKey: "payee", title: "收款对象", width: 160 },
  { colKey: "amount", title: "确认金额", width: 130, align: "right" as const },
  { colKey: "funded", title: "已付", width: 130, align: "right" as const },
  { colKey: "status", title: "状态", width: 130 },
  { colKey: "actions", title: "办理", width: 120 }
];

const executionColumns = [
  { colKey: "paidAt", title: "付款日期", width: 120 },
  { colKey: "amountCents", title: "实付金额", width: 130, align: "right" as const },
  { colKey: "paymentMethod", title: "付款方式", width: 130 },
  { colKey: "note", title: "备注", minWidth: 160 }
];

const mobileRows = computed<BusinessMobileCard[]>(() => rows.value.map((row) => ({
  id: row.id,
  title: row.reason || "其他项目付款",
  code: row.code,
  meta: row.project ? `${row.project.code} · ${row.project.name}` : "未关联项目",
  status: statusLabel(row.status),
  tone: row.status === "paid" ? "success" : row.status === "draft" ? "default" : "warning",
  amount: `确认 ${amount(row.companyPayableAmountCents)}`,
  facts: [
    { label: "类别", value: categoryLabel(row.incidentalExpenseCategory) },
    { label: "已付", value: amount(row.fundedAmountCents) }
  ],
  nextAction: "查看详情"
})));

function statusLabel(value: string) {
  return ({
    draft: "草稿",
    approval_pending: "审批中",
    approved_pending_payment: "待付款",
    partially_paid: "部分已付",
    paid: "已付清",
    rejected: "已驳回"
  } as Record<string, string>)[value] ?? value;
}

function categoryLabel(value: string | null) {
  return entry.value?.categories.find((item) => item.key === value)?.label ?? "未填写";
}

function amount(cents: string | undefined) {
  if (!cents) return "¥0.00";
  try {
    return `¥${centsTextToYuanText(cents)}`;
  } catch {
    return cents;
  }
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const [entryResult, rowsResult] = await Promise.all([
      fetchOtherProjectPaymentEntry(),
      fetchOtherProjectPayments()
    ]);
    entry.value = entryResult;
    rows.value = rowsResult;
  } catch (error) {
    loadError.value = formatUnknownApiError(error, "读取其他项目付款失败");
  } finally {
    loading.value = false;
  }
}

async function openPaymentDetail(id: string) {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    detail.value = await fetchOtherProjectPaymentDetail(id);
  } catch (error) {
    MessagePlugin.error(formatUnknownApiError(error, "读取其他项目付款详情失败"));
    detailVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function openCreateInExpenseClaims() {
  void router.push("/费用与报销工作台");
}

function openExpenseRecord() {
  if (!detail.value) return;
  void router.push(`/费用与报销/${detail.value.id}`);
}

onMounted(() => void load());
</script>

<template>
  <JgWorkbenchShell
    class="other-project-payment"
    title="其他项目付款"
    :description="entryDescription"
  >
    <template #actions>
      <t-button
        theme="primary"
        @click="openCreateInExpenseClaims"
      >
        去登记其他项目付款
      </t-button>
      <t-button
        variant="outline"
        :loading="loading"
        @click="load"
      >
        刷新数据
      </t-button>
    </template>

    <template #summary>
      <t-card
        class="other-project-payment__summary"
        :bordered="true"
      >
        <span>并联审批岗位：{{ dutyText }}</span>
        <span>{{ entry?.costCountingRule ?? "费用确认后计成本一次；分次实付不重复计成本。" }}</span>
        <span>登记时在费用与报销工作台选择“零星费用”，填项目、用途、类别、收款对象和金额。</span>
      </t-card>
    </template>

    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="loadError"
      empty-title="暂无其他项目付款"
      empty-description="登记无合同特殊项目支出后，将在这里看到审批、实付、退款和更正进度。"
      @retry="load"
    >
      <t-card
        class="other-project-payment__table jg-table-region jg-table-region--wide"
        :bordered="true"
      >
        <t-table
          class="jg-desktop-record-list"
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 1300 }"
          horizontal-scroll-affixed-bottom
        >
          <template #code="{ row }">
            <t-link
              theme="primary"
              @click="openPaymentDetail(row.id)"
            >
              {{ row.code }}
            </t-link>
          </template>
          <template #project="{ row }">
            {{ row.project ? `${row.project.code} · ${row.project.name}` : "未关联项目" }}
          </template>
          <template #category="{ row }">
            {{ categoryLabel(row.incidentalExpenseCategory) }}
          </template>
          <template #payee="{ row }">
            {{ row.reason }}
          </template>
          <template #amount="{ row }">
            {{ amount(row.companyPayableAmountCents) }}
          </template>
          <template #funded="{ row }">
            {{ amount(row.fundedAmountCents) }}
          </template>
          <template #status="{ row }">
            {{ statusLabel(row.status) }}
          </template>
          <template #actions="{ row }">
            <t-link
              theme="primary"
              @click="openPaymentDetail(row.id)"
            >
              详情
            </t-link>
          </template>
        </t-table>
        <BusinessMobileCards
          :items="mobileRows"
          :loading="loading"
          @open="openPaymentDetail"
        />
      </t-card>
    </JgResultState>

    <t-dialog
      v-model:visible="detailVisible"
      header="其他项目付款详情"
      width="720px"
      :footer="false"
    >
      <p
        v-if="detailLoading"
        role="status"
      >
        正在读取详情，请稍候…
      </p>
      <div
        v-else-if="detail"
        class="other-project-payment__detail"
      >
        <p>
          <strong>{{ detail.code }}</strong>
          · {{ statusLabel(detail.status) }}
          · {{ detail.reason }}
        </p>
        <p class="other-project-payment__hint">
          项目：{{ detail.project ? `${detail.project.code} · ${detail.project.name}` : "未关联项目" }}
          · 类别：{{ categoryLabel(detail.incidentalExpenseCategory) }}
          · 收款对象：{{ detail.payeeNameSnapshot || "未填写" }}
        </p>
        <p v-if="detail.paymentCapacity">
          确认 {{ amount(detail.paymentCapacity.payableCents) }}
          · 已付 {{ amount(detail.paymentCapacity.fundedAmountCents) }}
          · 退款 {{ amount(detail.paymentCapacity.refundedCents) }}
          · 净付 {{ amount(detail.paymentCapacity.netPaidCents) }}
          · 可付 {{ amount(detail.paymentCapacity.remainingPayableCents) }}
          · 超付 {{ amount(detail.paymentCapacity.overpaidCents) }}
        </p>
        <p class="other-project-payment__hint">
          审批、分次实付、退款与费用金额更正都在原费用单办理；本页只展示台账口径并回链原单，避免形成第二套付款入口。
        </p>
        <t-link
          theme="primary"
          @click="openExpenseRecord"
        >
          打开原费用单办理
        </t-link>
        <h3>分次实付</h3>
        <p
          v-if="!detail.paymentExecutions.length"
          class="other-project-payment__hint"
        >
          审批全部通过后，财务可按实际付款分次登记实付。
        </p>
        <t-table
          v-else
          row-key="id"
          size="small"
          :columns="executionColumns"
          :data="detail.paymentExecutions"
        >
          <template #amountCents="{ row }">
            {{ amount(row.amountCents) }}
          </template>
        </t-table>
      </div>
    </t-dialog>
  </JgWorkbenchShell>
</template>

<style scoped>
.other-project-payment__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-lg);
  align-items: center;
  color: var(--jg-color-text-secondary);
}

.other-project-payment__hint {
  margin: 0 0 var(--jg-space-md);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.other-project-payment__detail h3 {
  margin: var(--jg-space-lg) 0 var(--jg-space-sm);
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-title);
}

.other-project-payment__table {
  min-width: 0;
}
</style>
