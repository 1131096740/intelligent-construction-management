<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import ApprovalSelfReviewFields from "../../../components/ApprovalSelfReviewFields.vue";

export type A5ApprovalResult = "approve" | "return_to_applicant";

export interface A5ApprovalSubmitPayload {
  result: A5ApprovalResult;
  comment: string;
  selfReviewReason: string;
  confirmationPassword: string;
}

const props = defineProps<{
  visible: boolean;
  busy?: boolean;
  error?: string;
  approvalAmountText: string;
  payerCompanyName: string;
  payeeName: string;
  approveDestination: string;
  returnDestination: string;
  requiresSelfReviewConfirmation?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: A5ApprovalSubmitPayload];
}>();

const result = ref<A5ApprovalResult>("approve");
const confirming = ref(false);
const validationError = ref("");
const titleElement = ref<HTMLElement | null>(null);
let titleFocusObserver: MutationObserver | null = null;
let titleFocusTimeout: number | null = null;
const form = reactive({
  comment: "",
  selfReviewReason: "",
  confirmationPassword: ""
});

const destination = computed(() =>
  result.value === "approve" ? props.approveDestination : props.returnDestination
);
const drawerVisible = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    if (!visible) emit("close");
  }
});
const resultLabel = computed(() =>
  result.value === "approve" ? "通过" : "退回申请人修改"
);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      clearTitleFocusAttempt();
      return;
    }
    result.value = "approve";
    confirming.value = false;
    validationError.value = "";
    form.comment = "";
    form.selfReviewReason = "";
    form.confirmationPassword = "";
  }
);

function beginConfirmation() {
  validationError.value = "";
  if (result.value === "return_to_applicant" && !form.comment.trim()) {
    validationError.value = "退回原因不能为空";
    return;
  }
  if (
    props.requiresSelfReviewConfirmation &&
    (!form.selfReviewReason.trim() || !form.confirmationPassword)
  ) {
    validationError.value = "请填写自审原因并输入当前密码";
    return;
  }
  confirming.value = true;
}

function submit() {
  emit("submit", {
    result: result.value,
    comment: form.comment.trim(),
    selfReviewReason: form.selfReviewReason.trim(),
    confirmationPassword: form.confirmationPassword
  });
}

function clearTitleFocusAttempt() {
  titleFocusObserver?.disconnect();
  titleFocusObserver = null;
  if (titleFocusTimeout !== null) window.clearTimeout(titleFocusTimeout);
  titleFocusTimeout = null;
}

function focusVisibleTitle() {
  const referencedTitle = titleElement.value;
  const title = referencedTitle?.getClientRects().length
    ? referencedTitle
    : [...document.querySelectorAll<HTMLElement>(
        ".payment-approval-drawer__title"
      )].find((element) => element.getClientRects().length > 0);
  if (!title) return false;
  title.focus();
  if (document.activeElement !== title) return false;
  clearTitleFocusAttempt();
  return true;
}

function focusTitle() {
  clearTitleFocusAttempt();
  let remainingMutations = 12;
  titleFocusObserver = new MutationObserver(() => {
    if (focusVisibleTitle()) return;
    remainingMutations -= 1;
    if (remainingMutations <= 0) clearTitleFocusAttempt();
  });
  titleFocusObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"]
  });
  titleFocusTimeout = window.setTimeout(() => {
    focusVisibleTitle();
    clearTitleFocusAttempt();
  }, 750);
  void nextTick(() => focusVisibleTitle());
}

onBeforeUnmount(clearTitleFocusAttempt);
</script>

<template>
  <t-drawer
    v-model:visible="drawerVisible"
    placement="right"
    size="min(560px, 100vw)"
    :close-on-overlay-click="false"
    :close-btn="!busy"
    :class="['payment-approval-drawer', { 'payment-approval-drawer--confirming': confirming }]"
    :on-before-open="focusTitle"
  >
    <template #header>
      <h2
        ref="titleElement"
        class="payment-approval-drawer__title"
        tabindex="-1"
      >
        办理项目零星付款审批
      </h2>
    </template>
    <div class="payment-approval-drawer__body">
      <template v-if="!confirming">
        <section>
          <h3>审批结果</h3>
          <t-radio-group v-model="result">
            <t-radio value="approve">
              通过
            </t-radio>
            <t-radio value="return_to_applicant">
              退回申请人修改
            </t-radio>
          </t-radio-group>
        </section>
        <dl class="payment-approval-drawer__facts">
          <div><dt>审批金额</dt><dd>{{ approvalAmountText }}</dd></div>
          <div><dt>付款主体</dt><dd>{{ payerCompanyName }}</dd></div>
          <div><dt>收款对象</dt><dd>{{ payeeName }}</dd></div>
          <div><dt>下一去向</dt><dd>{{ destination }}</dd></div>
        </dl>
        <label class="payment-approval-drawer__field">
          <span>{{ result === "approve" ? "审批意见（可选）" : "退回原因" }}</span>
          <t-textarea
            v-model="form.comment"
            :placeholder="result === 'approve' ? '留空后由系统冻结为“同意”' : '请说明需要申请人修改的内容'"
            :autosize="{ minRows: 3, maxRows: 6 }"
          />
        </label>
        <ApprovalSelfReviewFields
          v-model:self-review-reason="form.selfReviewReason"
          v-model:confirmation-password="form.confirmationPassword"
          :required="requiresSelfReviewConfirmation === true"
        />
      </template>
      <template v-else>
        <t-alert
          theme="warning"
          title="提交前请再次核对"
          message="本次审批会立即写入审批历史并流转到下一个节点。"
        />
        <dl class="payment-approval-drawer__facts payment-approval-drawer__facts--confirm">
          <div><dt>审批结果</dt><dd>{{ resultLabel }}</dd></div>
          <div><dt>审批金额</dt><dd>{{ approvalAmountText }}</dd></div>
          <div><dt>付款主体</dt><dd>{{ payerCompanyName }}</dd></div>
          <div><dt>收款对象</dt><dd>{{ payeeName }}</dd></div>
          <div><dt>下一去向</dt><dd>{{ destination }}</dd></div>
          <div><dt>审批意见</dt><dd>{{ form.comment.trim() || "同意（由服务端冻结）" }}</dd></div>
        </dl>
      </template>
      <t-alert
        v-if="validationError || error"
        theme="error"
        title="暂时无法提交"
        :message="validationError || error"
      />
    </div>
    <template #footer>
      <t-button
        variant="outline"
        :disabled="busy"
        @click="confirming ? (confirming = false) : emit('close')"
      >
        {{ confirming ? "返回修改" : "取消" }}
      </t-button>
      <t-button
        theme="primary"
        :loading="busy"
        @click="confirming ? submit() : beginConfirmation()"
      >
        {{ confirming ? "确认提交" : "继续确认" }}
      </t-button>
    </template>
  </t-drawer>
</template>

<style scoped>
.payment-approval-drawer__body,
.payment-approval-drawer__body section,
.payment-approval-drawer__field {
  display: grid;
  gap: var(--jg-space-md);
}

.payment-approval-drawer__body section h3 {
  margin: 0;
}

.payment-approval-drawer__title {
  margin: 0;
  font-size: var(--jg-font-size-section-title);
  outline: none;
}

.payment-approval-drawer__title:focus-visible {
  border-radius: var(--jg-radius-control);
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: 2px;
}

.payment-approval-drawer__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
  margin: 0;
}

.payment-approval-drawer__facts > div {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.payment-approval-drawer__facts dt,
.payment-approval-drawer__field > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.payment-approval-drawer__facts dd {
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--jg-color-text-primary);
  font-weight: var(--jg-font-weight-medium);
}

.payment-approval-drawer__facts--confirm > div:last-child {
  grid-column: 1 / -1;
}

@media (max-width: 480px) {
  .payment-approval-drawer__facts {
    grid-template-columns: 1fr;
  }

  .payment-approval-drawer__facts--confirm > div:last-child {
    grid-column: auto;
  }
}
</style>
