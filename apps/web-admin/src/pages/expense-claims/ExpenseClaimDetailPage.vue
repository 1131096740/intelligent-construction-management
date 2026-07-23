<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { fetchExpenseClaimDetail, submitExpenseClaim, type ExpenseClaimDetailReadModel } from "../../api/expense-claim.api";
import JgDetailTabs from "../../components/JgDetailTabs.vue";
import JgPageHeader from "../../components/JgPageHeader.vue";
import JgResultState from "../../components/JgResultState.vue";
import { centsTextToYuanText } from "../../lib/money";

const route = useRoute();
const loading = ref(false);
const loadError = ref("");
const actionError = ref("");
const submitting = ref(false);
const detail = ref<ExpenseClaimDetailReadModel | null>(null);
const tab = ref("business");
const tabs = [{ value: "business", label: "业务信息" }, { value: "lines", label: "费用明细" }, { value: "funds", label: "资金结果" }];
const columns = [
  { colKey: "sortOrder", title: "序号", width: 70 },
  { colKey: "expenseCategory", title: "费用类别", width: 120 },
  { colKey: "occurredOn", title: "发生日期", width: 120 },
  { colKey: "purpose", title: "用途说明", minWidth: 220 },
  { colKey: "receiptCount", title: "单据张数", width: 100, align: "right" as const },
  { colKey: "amount", title: "金额", width: 120, align: "right" as const },
  { colKey: "evidenceType", title: "证据类型", width: 130 },
  { colKey: "remark", title: "备注", minWidth: 160 }
];
const title = computed(() => detail.value?.claimType === "loan" ? "借款申请" : "费用报销");
function amount(value: string) { return `¥${centsTextToYuanText(value)}`; }
function statusLabel(value: string) { return ({ draft: "草稿", approval_pending: "审批中", approved_pending_payment: "待公司付款", approved_pending_disbursement: "待放款", partially_disbursed: "部分放款", disbursed: "已放款", offset_completed: "借款冲销完成", rejected: "已驳回" } as Record<string, string>)[value] ?? value; }
function tone(value: string) { return ["offset_completed", "disbursed"].includes(value) ? "success" as const : value === "rejected" ? "danger" as const : value === "draft" ? "default" as const : "warning" as const; }
function evidenceType(value: string) { return ({ invoice: "发票", receipt_or_other: "收据或其他凭证", none: "无凭证" } as Record<string, string>)[value] ?? value; }
function date(value: string | null) { return value ? value.replace("T", " ").slice(0, 16) : "未记录"; }
async function loadDetail() {
  loading.value = true; loadError.value = "";
  try { detail.value = await fetchExpenseClaimDetail(String(route.params.claimId)); }
  catch (error) { loadError.value = error instanceof Error ? error.message : "费用详情读取失败"; }
  finally { loading.value = false; }
}
async function submit() {
  if (!detail.value || submitting.value) return;
  submitting.value = true;
  actionError.value = "";
  try { await submitExpenseClaim(detail.value.id); await loadDetail(); }
  catch (error) { actionError.value = error instanceof Error ? error.message : "提交费用申请失败"; }
  finally { submitting.value = false; }
}
onMounted(() => void loadDetail());
</script>

<template>
  <section class="expense-claim-detail">
    <JgResultState
      :loading="loading"
      :has-results="Boolean(detail)"
      :error="loadError"
      empty-title="费用申请不存在"
      empty-description="该记录可能不属于当前申请人或经办人。"
      @retry="loadDetail"
    >
      <template v-if="detail">
        <JgPageHeader
          :business-code="detail.code"
          :title="title"
          :status="statusLabel(detail.status)"
          :status-tone="tone(detail.status)"
          :owner="detail.handledByNameSnapshot"
          current-node="按冻结审批节点办理"
          :next-step="detail.status === 'draft' ? '经办人提交' : '查看资金或审批进度'"
          :requested-amount="amount(detail.requestedAmountCents)"
        >
          <template #actions>
            <t-popconfirm
              v-if="detail.status === 'draft'"
              content="提交后将按当前有效岗位冻结审批候选，草稿不能再按原方式修改。"
              confirm-btn="确认提交"
              cancel-btn="继续核对"
              @confirm="submit"
            >
              <t-button
                theme="primary"
                :loading="submitting"
              >
                提交审批
              </t-button>
            </t-popconfirm>
          </template>
        </JgPageHeader>
        <t-alert
          v-if="actionError"
          theme="error"
          :message="actionError"
          close
          @close="actionError = ''"
        />
        <JgDetailTabs
          v-model="tab"
          :tabs="tabs"
        />
        <t-card
          v-if="tab === 'business'"
          :bordered="true"
        >
          <t-descriptions
            :column="2"
            bordered
          >
            <t-descriptions-item label="使用单位">
              {{ detail.companyEntityNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="项目">
              {{ detail.project ? `${detail.project.code} · ${detail.project.name}` : '非项目费用' }}
            </t-descriptions-item>
            <t-descriptions-item label="报销人 / 借款人">
              {{ detail.applicantNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="经办人">
              {{ detail.handledByNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="事实证明人">
              {{ detail.factWitnessNameSnapshot ?? '不适用' }}
            </t-descriptions-item>
            <t-descriptions-item label="提交时间">
              {{ date(detail.submittedAt) }}
            </t-descriptions-item>
            <t-descriptions-item
              label="事由"
              :span="2"
            >
              {{ detail.reason }}
            </t-descriptions-item>
          </t-descriptions>
        </t-card>
        <t-card
          v-else-if="tab === 'lines'"
          class="jg-table-region jg-table-region--wide"
          :bordered="true"
        >
          <t-table
            row-key="id"
            size="small"
            :columns="columns"
            :data="detail.lines"
            :scroll="{ x: 1000 }"
            horizontal-scroll-affixed-bottom
          >
            <template #amount="{ row }">
              {{ amount(row.amountCents) }}
            </template>
            <template #evidenceType="{ row }">
              {{ evidenceType(row.evidenceType) }}
            </template>
          </t-table>
        </t-card>
        <t-card
          v-else
          :bordered="true"
        >
          <t-descriptions
            :column="1"
            bordered
          >
            <t-descriptions-item label="借款冲销">
              {{ amount(detail.loanOffsetAmountCents) }}
            </t-descriptions-item>
            <t-descriptions-item label="公司待付">
              {{ amount(detail.companyPayableAmountCents) }}
            </t-descriptions-item>
            <t-descriptions-item label="实际放款">
              {{ amount(detail.fundedAmountCents) }}
            </t-descriptions-item>
            <t-descriptions-item label="付款方式">
              {{ detail.paymentMethod ?? '待办理' }}
            </t-descriptions-item>
          </t-descriptions>
        </t-card>
      </template>
    </JgResultState>
  </section>
</template>

<style scoped>
.expense-claim-detail { display: grid; gap: var(--jg-space-lg); min-width: 0; }
</style>
