<template>
  <section class="project-expense-approval-detail-page">
    <div class="page-head">
      <div>
        <h1>项目支出审批详情</h1>
        <p>{{ detail?.title ?? "正在读取项目支出审批详情" }}</p>
      </div>
      <t-button
        variant="outline"
        :loading="loading"
        @click="loadDetail"
      >
        刷新
      </t-button>
    </div>

    <t-alert
      v-if="errorMessage"
      theme="error"
      :message="errorMessage"
    />
    <t-card
      v-else-if="!detail"
      title="审批详情"
      :bordered="true"
    >
      正在加载审批详情
    </t-card>

    <template v-else>
      <t-card
        class="section-card"
        title="支出摘要"
        :bordered="true"
      >
        <div class="summary-grid">
          <div><span>单号</span><strong>{{ detail.code }}</strong></div>
          <div><span>状态</span><strong>{{ detail.statusLabel }}</strong></div>
          <div><span>费用类型</span><strong>{{ detail.expenseTypeLabel }} · {{ detail.expenseSubtypeLabel }}</strong></div>
          <div><span>付款主体</span><strong>{{ detail.paymentSubject }}</strong></div>
          <div><span>申请金额</span><strong>{{ formatCents(detail.requestedAmountCents) }}</strong></div>
          <div><span>批准金额</span><strong>{{ detail.approvedAmountCents ? formatCents(detail.approvedAmountCents) : "待终审" }}</strong></div>
          <div><span>当前节点</span><strong>{{ detail.currentNodeName ?? "流程已结束" }}</strong></div>
          <div class="summary-wide">
            <span>付款事由</span><strong>{{ detail.reason }}</strong>
          </div>
        </div>
      </t-card>

      <t-card
        class="section-card"
        title="审批办理"
        :bordered="true"
      >
        <BusinessActionPanel :actions="[detail.reviewAction]" />
        <t-alert
          v-if="!detail.reviewAction.enabled"
          theme="info"
          :message="detail.reviewAction.disabledReason ?? '当前账号暂无审批动作'"
        />
        <div
          v-else
          class="review-form"
        >
          <t-textarea
            v-model="form.comment"
            placeholder="审批意见；驳回时必填"
          />
          <t-input
            v-if="detail.canSetApprovedAmount"
            v-model="form.approvedAmountYuan"
            placeholder="终审批准金额（元，不填则按申请金额）"
          />
          <ApprovalSelfReviewFields
            v-model:self-review-reason="form.selfReviewReason"
            v-model:confirmation-password="form.confirmationPassword"
            :required="detail.reviewAction.requiresSelfReviewConfirmation === true"
          />
          <div class="review-buttons">
            <t-button
              theme="primary"
              :disabled="busy !== ''"
              :loading="busy === 'approve'"
              @click="submitReview('approve')"
            >
              审批通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :disabled="busy !== ''"
              :loading="busy === 'reject'"
              @click="submitReview('reject')"
            >
              审批驳回
            </t-button>
          </div>
        </div>
        <t-alert
          v-if="actionMessage"
          :theme="actionTone"
          :message="actionMessage"
        />
      </t-card>

      <t-card
        class="section-card"
        title="审批记录"
        :bordered="true"
      >
        <ApprovalTimeline :items="detail.approvalTimeline" />
      </t-card>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { ProjectExpenseApprovalDetailReadModel } from "@jiangkong/shared-domain";
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import ApprovalSelfReviewFields from "../../components/ApprovalSelfReviewFields.vue";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import {
  fetchProjectExpenseApprovalDetail,
  reviewProjectExpenseApproval
} from "../../api/core-flow-read.api";
import { centsTextToYuanText } from "../../lib/money";
import { confirmSensitiveAction } from "../confirm-sensitive-action";
import {
  canBeginProjectExpenseReview,
  projectExpenseApprovedAmountCents,
  submitConfirmedProjectExpenseReview
} from "./project-expense-approval.config";

const route = useRoute();
const detail = ref<ProjectExpenseApprovalDetailReadModel | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const busy = ref<"" | "approve" | "reject">("");
const actionMessage = ref("");
const actionTone = ref<"success" | "error">("success");
const form = reactive({
  comment: "",
  approvedAmountYuan: "",
  selfReviewReason: "",
  confirmationPassword: ""
});

function routeIds() {
  return {
    projectId: String(route.params.projectId ?? ""),
    expenseRequestId: String(route.params.expenseRequestId ?? "")
  };
}

function formatCents(value: string) {
  return `¥${centsTextToYuanText(value)}`;
}

async function loadDetail() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const { projectId, expenseRequestId } = routeIds();
    detail.value = await fetchProjectExpenseApprovalDetail(projectId, expenseRequestId);
  } catch (error) {
    detail.value = null;
    errorMessage.value = error instanceof Error ? error.message : "项目支出审批详情读取失败";
  } finally {
    loading.value = false;
  }
}

async function submitReview(decision: "approve" | "reject") {
  if (!canBeginProjectExpenseReview(busy.value)) return;
  if (!detail.value?.reviewAction.enabled) return;
  const comment = form.comment.trim();
  if (decision === "reject" && !comment) {
    actionTone.value = "error";
    actionMessage.value = "审批驳回时请填写审批意见";
    return;
  }

  busy.value = decision;
  actionMessage.value = "";
  try {
    const selfReview = buildApprovalSelfReviewPayload(
      detail.value.reviewAction.requiresSelfReviewConfirmation === true,
      form
    );
    const approvedAmountYuan = form.approvedAmountYuan.trim();
    const approvedAmountCents = projectExpenseApprovedAmountCents(
      detail.value.canSetApprovedAmount,
      decision,
      approvedAmountYuan
    );
    const { projectId, expenseRequestId } = routeIds();
    const submitted = await submitConfirmedProjectExpenseReview({
      decision,
      confirm: (message) => confirmSensitiveAction(message),
      submit: async () => {
        await reviewProjectExpenseApproval(projectId, expenseRequestId, {
          decision,
          comment: comment || undefined,
          approvedAmountCents,
          ...selfReview
        });
      }
    });
    if (!submitted) return;
    form.selfReviewReason = "";
    form.confirmationPassword = "";
    form.comment = "";
    form.approvedAmountYuan = "";
    actionTone.value = "success";
    actionMessage.value = decision === "approve" ? "审批通过，详情已刷新。" : "审批驳回，详情已刷新。";
    await loadDetail();
  } catch (error) {
    actionTone.value = "error";
    actionMessage.value = error instanceof Error ? error.message : "项目支出审批失败";
  } finally {
    busy.value = "";
  }
}

onMounted(loadDetail);
</script>

<style scoped>
.project-expense-approval-detail-page,
.review-form {
  display: grid;
  gap: var(--jg-space-lg);
}

.page-head,
.review-buttons {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.page-head h1 {
  margin: 0;
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
}

.page-head p {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-text-subtle);
}

.section-card {
  border-radius: var(--jg-radius-sm);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.summary-grid div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-muted);
}

.summary-grid span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.summary-grid strong {
  color: var(--jg-text-strong);
}

.summary-wide {
  grid-column: 1 / -1;
}

@media (max-width: 720px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .summary-wide {
    grid-column: auto;
  }
}
</style>
