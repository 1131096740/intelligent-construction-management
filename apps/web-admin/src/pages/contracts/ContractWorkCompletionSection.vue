<template>
  <section
    v-if="canRegister || entries.length"
    class="work-completion"
    aria-label="合同履约登记与确认"
  >
    <header>
      <h2>履约登记与确认</h2>
      <t-button
        v-if="canRegister"
        variant="outline"
        :disabled="busy"
        @click="showDraft = !showDraft"
      >
        {{ showDraft ? "收起登记表" : "登记已完成工作" }}
      </t-button>
    </header>
    <form
      v-if="canRegister && showDraft"
      class="work-completion__form"
      @submit.prevent="save"
    >
      <label>已完成工作<t-textarea
        v-model="work"
        :maxlength="2000"
      /></label>
      <label>履约金额（元）<t-input
        v-model="amount"
        placeholder="最多四位小数"
      /></label>
      <t-button
        type="submit"
        :loading="busy"
      >
        保存履约草稿
      </t-button>
    </form>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }}
    </p>
    <article
      v-for="entry in entries"
      :key="entry.id"
      class="work-completion__entry"
    >
      <p>{{ entry.work }}</p>
      <span>{{ entry.amountYuan }} 元 · {{ statusLabels[entry.status] || "状态待刷新" }}</span>
      <t-alert
        v-if="entry.rejectionReason"
        theme="warning"
        :message="`驳回原因：${entry.rejectionReason}`"
      />
      <t-alert
        v-if="entry.exceedsContractAmount"
        theme="warning"
        message="本次履约金额超过合同金额上限，请核对后再提交或确认。"
      />
      <div class="work-completion__actions">
        <t-button
          v-if="entry.canRevise"
          variant="outline"
          :disabled="busy"
          @click="openRevise(entry)"
        >
          修订草稿
        </t-button>
        <t-button
          v-if="entry.canSubmit"
          variant="outline"
          :loading="busy"
          @click="submit(entry.id)"
        >
          提交三职责确认
        </t-button>
        <template
          v-for="duty in entry.duties"
          :key="duty.index"
        >
          <t-button
            v-if="duty.canReview"
            variant="outline"
            :disabled="busy"
            @click="openReview(entry, duty)"
          >
            {{ duty.name }}确认
          </t-button>
        </template>
      </div>
    </article>
    <t-dialog
      v-model:visible="reviewVisible"
      :header="reviewTarget ? reviewTarget.duty.name + '履约确认' : '履约确认'"
      :footer="false"
    >
      <form
        v-if="reviewTarget && reviewTarget.duty.canReview"
        class="work-completion__form"
        @submit.prevent="review('approve')"
      >
        <p>{{ reviewTarget.entry.work }} · {{ reviewTarget.entry.amountYuan }} 元</p>
        <t-alert
          v-if="reviewTarget.entry.exceedsContractAmount"
          theme="warning"
          message="履约金额超过合同金额上限。"
        />
        <label>审批意见（驳回时必填）<t-textarea
          v-model="comment"
          :maxlength="1000"
        /></label>
        <template v-if="reviewTarget.duty.selfReview">
          <label>自审原因<t-textarea
            v-model="selfReviewReason"
            :maxlength="1000"
          /></label>
          <label>当前密码<t-input
            v-model="password"
            type="password"
          /></label>
        </template>
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        />
        <div class="work-completion__actions">
          <t-button
            type="submit"
            :loading="busy"
          >
            通过确认
          </t-button>
          <t-button
            theme="danger"
            variant="outline"
            :disabled="busy"
            @click="review('reject')"
          >
            驳回
          </t-button>
        </div>
      </form>
    </t-dialog>
    <t-dialog
      v-model:visible="reviseVisible"
      header="修订履约草稿"
      :footer="false"
    >
      <form
        v-if="reviseTarget && reviseTarget.canRevise"
        class="work-completion__form"
        @submit.prevent="saveRevision"
      >
        <label>已完成工作<t-textarea
          v-model="reviseWork"
          :maxlength="2000"
        /></label>
        <label>履约金额（元）<t-input
          v-model="reviseAmount"
          placeholder="最多四位小数"
        /></label>
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        />
        <div class="work-completion__actions">
          <t-button
            type="submit"
            :loading="busy"
          >
            保存修订
          </t-button>
        </div>
      </form>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { fetchWorkCompletions, reviewWorkCompletion, reviseWorkCompletionDraft, saveWorkCompletionDraft,
  submitWorkCompletion, type WorkCompletionEntry } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";

const props = defineProps<{ versionId: string }>();
const statusLabels: Record<string, string> = { draft: "草稿", in_approval: "待确认", confirmed: "已确认" };
const entries = ref<WorkCompletionEntry[]>([]);
const canRegister = ref(false);
const showDraft = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const work = ref("");
const amount = ref("");
let attempt: { work: string; amountYuan: string; requestKey: string } | null = null;
const reviewVisible = ref(false);
const reviseVisible = ref(false);
const reviseTarget = ref<WorkCompletionEntry | null>(null);
const reviseWork = ref("");
const reviseAmount = ref("");
const reviewTarget = ref<{ entry: WorkCompletionEntry; duty: WorkCompletionEntry["duties"][number] } | null>(null);
const comment = ref("");
const selfReviewReason = ref("");
const password = ref("");
watch(reviewVisible, visible => {
  if (!visible) password.value = "";
});

async function reload(versionId = props.versionId) {
  const result = await fetchWorkCompletions(versionId);
  if (versionId !== props.versionId) return;
  entries.value = result.entries;
  canRegister.value = result.canRegister;
}

watch(() => props.versionId, () => {
  entries.value = [];
  canRegister.value = false;
  void reload().catch(() => { error.value = "履约记录加载失败，请刷新合同详情后重试"; });
}, { immediate: true });

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
    await reload().catch(() => { error.value = "履约操作已完成，记录刷新失败，请刷新合同详情"; });
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "履约操作未完成，请刷新后重试");
  } finally {
    busy.value = false;
  }
}

async function save() {
  if (!canRegister.value) return;
  const trimmedWork = work.value.trim();
  let amountYuan: string | null;
  try {
    amountYuan = normalizeBusinessAmount(amount.value);
  } catch {
    amountYuan = null;
  }
  if (!trimmedWork || !amountYuan || amountYuan === "0.0000") {
    error.value = "请输入已完成工作和正数金额，金额最多四位小数";
    return;
  }
  if (!attempt || trimmedWork !== attempt.work || amountYuan !== attempt.amountYuan) {
    attempt = { work: trimmedWork, amountYuan, requestKey: crypto.randomUUID() };
  }
  const body = attempt;
  await run(async () => {
    const saved = await saveWorkCompletionDraft(props.versionId, body);
    notice.value = saved.exceedsContractAmount ? "草稿已保存。金额超过合同上限，请核对后再提交。" : "履约草稿已保存";
    work.value = "";
    amount.value = "";
    attempt = null;
    showDraft.value = false;
  });
}

function openRevise(entry: WorkCompletionEntry) {
  reviseTarget.value = entry;
  reviseWork.value = entry.work;
  reviseAmount.value = entry.amountYuan;
  error.value = "";
  reviseVisible.value = true;
}

async function saveRevision() {
  const target = reviseTarget.value;
  if (!target || !target.canRevise) return;
  const trimmedWork = reviseWork.value.trim();
  let amountYuan: string | null;
  try {
    amountYuan = normalizeBusinessAmount(reviseAmount.value);
  } catch {
    amountYuan = null;
  }
  if (!trimmedWork || !amountYuan || amountYuan === "0.0000") {
    error.value = "请输入已完成工作和正数金额，金额最多四位小数";
    return;
  }
  await run(async () => {
    const saved = await reviseWorkCompletionDraft(props.versionId, target.id, { work: trimmedWork, amountYuan });
    reviseVisible.value = false;
    notice.value = saved.exceedsContractAmount ? "草稿已修订。金额超过合同上限，请核对后再提交。" : "履约草稿已修订";
  });
}

async function submit(id: string) {
  if (!entries.value.find(entry => entry.id === id)?.canSubmit) return;
  await run(async () => {
    await submitWorkCompletion(props.versionId, id);
    notice.value = "已提交合同、项目和财务职责确认";
  });
}

function openReview(entry: WorkCompletionEntry, duty: WorkCompletionEntry["duties"][number]) {
  reviewTarget.value = { entry, duty };
  comment.value = "";
  selfReviewReason.value = "";
  password.value = "";
  error.value = "";
  reviewVisible.value = true;
}

async function review(decision: "approve" | "reject") {
  const target = reviewTarget.value;
  if (!target?.duty.canReview || !target.entry.approvalInstanceId) return;
  if (decision === "reject" && !comment.value.trim()) {
    error.value = "请填写驳回原因";
    return;
  }
  const approvalInstanceId = target.entry.approvalInstanceId;
  await run(async () => {
    const result = await reviewWorkCompletion(props.versionId, target.entry.id, {
      approvalInstanceId, dutyIndex: target.duty.index, decision, comment: comment.value.trim() || undefined,
      ...(target.duty.selfReview ? { selfReviewReason: selfReviewReason.value, confirmationPassword: password.value } : {})
    });
    password.value = "";
    reviewVisible.value = false;
    notice.value = decision === "reject" ? "已驳回并退回原草稿" :
      result.status === "confirmed" ? "三个职责已全部确认" : "本职责已确认，等待其他职责";
  });
}
</script>

<style scoped>
.work-completion, .work-completion__entry, .work-completion__form, .work-completion__form label {
  display: grid;
  gap: var(--jg-space-3, 12px);
}
.work-completion {
  padding: var(--jg-space-4, 16px);
  border: 1px solid var(--jg-border, var(--td-component-border));
}
.work-completion header, .work-completion__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-3, 12px);
}
.work-completion header {
  justify-content: space-between;
}
.work-completion__entry p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
