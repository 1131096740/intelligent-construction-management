<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  fetchExpenseClaims,
  type ExpenseClaimListItemReadModel,
  type ExpenseClaimWorkbenchView
} from "../../api/expense-claim.api";
import JgFilterBar from "../../components/JgFilterBar.vue";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import { centsTextToYuanText } from "../../lib/money";
import ExpenseClaimCreateDrawer from "./components/ExpenseClaimCreateDrawer.vue";

const view = ref<ExpenseClaimWorkbenchView>("all");
const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const rows = ref<ExpenseClaimListItemReadModel[]>([]);
const createVisible = ref(false);

const viewOptions = [
  { label: "全部", value: "all" },
  { label: "我的草稿", value: "drafts" },
  { label: "审批中", value: "in_progress" },
  { label: "待付款 / 待冲销", value: "pending_funds" }
];

const columns = [
  { colKey: "code", title: "正式编号", width: 150, fixed: "left" as const },
  { colKey: "claimType", title: "业务类型", width: 100 },
  { colKey: "applicant", title: "报销人 / 借款人", width: 150 },
  { colKey: "scope", title: "项目或使用单位", width: 180 },
  { colKey: "reason", title: "事由摘要", minWidth: 220 },
  { colKey: "amount", title: "申请金额", width: 130, align: "right" as const },
  { colKey: "result", title: "冲销 / 实付结果", width: 180, align: "right" as const },
  { colKey: "status", title: "状态", width: 150 },
  { colKey: "handledBy", title: "经办人", width: 110 },
  { colKey: "updatedAt", title: "更新时间", width: 150 }
];

const summary = computed(() => ({
  total: rows.value.length,
  drafts: rows.value.filter((row) => row.status === "draft").length,
  inProgress: rows.value.filter((row) => row.status === "approval_pending").length,
  pendingFunds: rows.value.filter((row) => ["approved_pending_payment", "approved_pending_disbursement", "partially_disbursed"].includes(row.status)).length
}));

function claimTypeLabel(value: ExpenseClaimListItemReadModel["claimType"]) {
  return value === "loan" ? "借款申请" : "费用报销";
}

function statusLabel(value: string) {
  return ({
    draft: "草稿",
    approval_pending: "审批中",
    approved_pending_payment: "待公司付款",
    partially_paid: "部分公司付款",
    approved_pending_disbursement: "待放款",
    partially_disbursed: "部分放款",
    disbursed: "已放款",
    offset_completed: "借款冲销完成",
    rejected: "已驳回"
  } as Record<string, string>)[value] ?? value;
}

function statusTone(value: string) {
  if (["offset_completed", "disbursed"].includes(value)) return "success" as const;
  if (value === "rejected") return "danger" as const;
  if (["approval_pending", "approved_pending_payment", "partially_paid", "approved_pending_disbursement", "partially_disbursed"].includes(value)) return "warning" as const;
  return "default" as const;
}

function amount(value: string) {
  return `¥${centsTextToYuanText(value)}`;
}

function result(row: ExpenseClaimListItemReadModel) {
  if (row.claimType === "loan") return `已放款 ${amount(row.fundedAmountCents)}`;
  return `冲销 ${amount(row.loanOffsetAmountCents)} / 待付 ${amount(row.companyPayableAmountCents)}`;
}

function scope(row: ExpenseClaimListItemReadModel) {
  return row.project
    ? `${row.project.code} · ${row.project.name} · ${row.companyEntityNameSnapshot}`
    : row.companyEntityNameSnapshot;
}

function dateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function openDetail(claimId: string) { void router.push(`/费用与报销/${encodeURIComponent(claimId)}`); }

function created(claim: { id: string }) {
  void loadWorkbench();
  void router.push(`/费用与报销/${encodeURIComponent(claim.id)}`);
}

async function loadWorkbench() {
  loading.value = true;
  loadError.value = "";
  try {
    rows.value = await fetchExpenseClaims(view.value);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "费用与报销工作台读取失败";
  } finally {
    loading.value = false;
  }
}

watch(view, () => void loadWorkbench());
onMounted(() => void loadWorkbench());
</script>

<template>
  <JgWorkbenchShell
    class="expense-claim-workbench"
    title="费用与报销工作台"
    description="只展示当前账号作为报销人、借款人或经办人的新版费用事实；旧项目支出继续作为历史兼容域单独保留。"
  >
    <template #actions>
      <t-button
        theme="primary"
        @click="createVisible = true"
      >
        新建费用报销 / 借款
      </t-button>
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
        title="办理视图"
        description="筛选由服务端按当前登录账号的申请人或经办人范围执行。"
      >
        <label class="expense-claim-workbench__filter-field">
          <span>视图</span>
          <t-select
            v-model="view"
            :options="viewOptions"
            :disabled="loading"
          />
        </label>
      </JgFilterBar>
    </template>

    <template #summary>
      <t-card
        class="expense-claim-workbench__summary"
        :bordered="true"
      >
        <span>当前 {{ summary.total }} 条</span>
        <span>草稿 {{ summary.drafts }} 条</span>
        <span>审批中 {{ summary.inProgress }} 条</span>
        <strong>待付款 / 待冲销 {{ summary.pendingFunds }} 条</strong>
      </t-card>
    </template>

    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="loadError"
      empty-title="暂无新版费用申请"
      empty-description="新建费用报销和借款将进入本工作台；旧项目支出不会被混入此处。"
      @retry="loadWorkbench"
    >
      <t-card
        class="expense-claim-workbench__table jg-table-region jg-table-region--wide"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 1500 }"
          horizontal-scroll-affixed-bottom
        >
          <template #claimType="{ row }">
            {{ claimTypeLabel(row.claimType) }}
          </template>
          <template #code="{ row }">
            <t-link
              theme="primary"
              @click="openDetail(row.id)"
            >
              {{ row.code }}
            </t-link>
          </template>
          <template #applicant="{ row }">
            <strong>{{ row.applicantNameSnapshot }}</strong>
          </template>
          <template #scope="{ row }">
            {{ scope(row) }}
          </template>
          <template #amount="{ row }">
            {{ amount(row.requestedAmountCents) }}
          </template>
          <template #result="{ row }">
            {{ result(row) }}
          </template>
          <template #status="{ row }">
            <JgStatusTag
              :label="statusLabel(row.status)"
              :tone="statusTone(row.status)"
            />
          </template>
          <template #updatedAt="{ row }">
            {{ dateTime(row.updatedAt) }}
          </template>
        </t-table>
      </t-card>
    </JgResultState>
    <ExpenseClaimCreateDrawer
      v-model="createVisible"
      @saved="created"
    />
  </JgWorkbenchShell>
</template>

<style scoped>
.expense-claim-workbench__filter-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: min(100%, 240px);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.expense-claim-workbench__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-lg);
  align-items: center;
  color: var(--jg-color-text-secondary);
}

.expense-claim-workbench__summary strong {
  color: var(--jg-color-text-primary);
}

.expense-claim-workbench__table {
  min-width: 0;
}
</style>
