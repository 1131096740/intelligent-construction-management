<template>
  <t-button
    variant="outline"
    :disabled="disabled"
    @click="open"
  >
    补充/变更
  </t-button>
  <t-dialog
    v-model:visible="visible"
    header="合同补充/变更"
    :footer="false"
    :close-on-overlay-click="false"
  >
    <p v-if="loading">
      正在读取补充协议
    </p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <template v-if="detail">
      <p>原合同金额 {{ amount(detail.originalAmountYuan) }} · 当前合同金额 {{ amount(detail.effectiveAmountYuan) }}</p>
      <p
        v-if="detail.currentPaymentAgreementText"
        class="agreement-text"
      >
        当前补充付款约定：{{ detail.currentPaymentAgreementText }}
      </p>
      <ul
        v-if="detail.changes.length"
        class="signed-change-list"
      >
        <li
          v-for="row in detail.changes"
          :key="row.id"
        >
          <div>第 {{ row.sequenceNo }} 次 · {{ statusLabels[row.status] }} · {{ row.summary }}</div>
          <div>变更 {{ row.amountDeltaYuan }} 元 · 变更后金额 {{ amount(row.effectiveAmountYuan) }}</div>
          <p
            v-if="row.paymentAgreementText"
            class="agreement-text"
          >
            补充付款约定：{{ row.paymentAgreementText }}
          </p>
          <p v-if="row.reviewReason">
            驳回原因：{{ row.reviewReason }}
          </p>
          <div class="signed-change-actions">
            <t-button
              size="small"
              variant="text"
              @click="chooseDownload(row)"
            >
              下载签署原件
            </t-button>
            <t-button
              v-if="detail.canReview && row.status === 'pending_review'"
              size="small"
              variant="outline"
              @click="chooseReview(row)"
            >
              复核
            </t-button>
          </div>
        </li>
      </ul>

      <form
        v-if="downloadTarget && detail.canDownloadOriginals"
        class="signed-change-form"
        @submit.prevent="download"
      >
        <label>下载原因<t-input v-model="downloadReason" /></label>
        <label>当前密码<t-input
          v-model="password"
          type="password"
        /></label>
        <t-button
          type="submit"
          :loading="busy"
        >
          确认下载签署原件
        </t-button>
      </form>

      <form
        v-else-if="reviewTarget && detail.canReview"
        class="signed-change-form"
        @submit.prevent="review"
      >
        <p>复核第 {{ reviewTarget.sequenceNo }} 次补充/变更</p>
        <label>
          复核结论
          <t-select
            v-model="decision"
            :options="reviewOptions"
          />
        </label>
        <label v-if="decision === 'reject'">驳回原因<t-textarea v-model="reviewReason" /></label>
        <template v-if="reviewTarget.requiresSelfReview">
          <label>自审原因<t-textarea v-model="reviewReasonSelf" /></label>
          <label>当前密码<t-input
            v-model="password"
            type="password"
          /></label>
        </template>
        <t-button
          type="submit"
          :loading="busy"
        >
          确认复核
        </t-button>
      </form>

      <form
        v-else-if="detail.canSubmit && !detail.changes.some(row => row.status === 'pending_review')"
        class="signed-change-form"
        @submit.prevent="submit"
      >
        <label>
          双方已签补充协议（PDF）
          <t-upload
            v-model="files"
            theme="file-input"
            accept=".pdf,application/pdf"
            :auto-upload="false"
            :max="1"
            :disabled="busy"
            placeholder="选择双方已签署的 PDF"
          />
        </label>
        <label>变更说明<t-textarea
          v-model="summary"
          :maxlength="1000"
        /></label>
        <label>增减金额（元）<t-input
          v-model="delta"
          placeholder="增项填正数，减项填负数，无变更填 0"
        /></label>
        <label>
          新付款约定（选填）
          <t-textarea
            v-model="agreement"
            :maxlength="5000"
            placeholder="仅约定变化时填写，合同部主管复核通过后生效"
          />
        </label>
        <t-alert
          v-if="balanceWarning"
          theme="warning"
          :message="balanceWarning.message"
        />
        <t-button
          type="submit"
          :loading="busy"
        >
          提交合同部主管复核
        </t-button>
      </form>
    </template>
  </t-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { UploadFile } from "tdesign-vue-next";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { formatUnknownApiError } from "../../api/error-message";
import {
  downloadPrivateFileByTicket,
  fetchSignedContractChanges,
  reviewSignedContractChange,
  submitSignedContractChange,
  uploadPrivateFile,
  type SignedContractChange,
  type SignedContractChanges
} from "../../api/core-flow-read.api";
import { signedChangeBalanceWarning } from "./signed-change-balance";

const props = defineProps<{ versionId: string; disabled?: boolean; openRequested?: boolean }>();
const visible = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const detail = ref<SignedContractChanges>();
const summary = ref("");
const agreement = ref("");
const delta = ref("0");
const files = ref<UploadFile[]>([]);
const uploadedFile = ref<{ source: File; id: string }>();
const reviewTarget = ref<SignedContractChange>();
const downloadTarget = ref<SignedContractChange>();
const decision = ref<"approve" | "reject">("approve");
const reviewReason = ref("");
const reviewReasonSelf = ref("");
const downloadReason = ref("");
const password = ref("");
const reviewOptions = [{ label: "通过", value: "approve" }, { label: "驳回", value: "reject" }];
const balanceWarning = computed(() => detail.value
  ? signedChangeBalanceWarning(detail.value, delta.value)
  : null);
const statusLabels = { pending_review: "待复核", approved: "已生效", rejected: "已驳回" };
let generation = 0;

function amount(value: string | null) {
  return value === null ? "未约定" : `${value} 元`;
}

async function reload(token: number, versionId: string) {
  loading.value = true;
  try {
    const data = await fetchSignedContractChanges(versionId);
    if (generation === token) detail.value = data;
  } catch (cause) {
    if (generation === token) error.value = formatUnknownApiError(cause, "读取补充协议失败");
  } finally {
    if (generation === token) loading.value = false;
  }
}

function open() {
  if (props.disabled || !props.versionId) return;
  visible.value = true;
  error.value = "";
  void reload(++generation, props.versionId);
}

watch(() => props.versionId, () => {
  visible.value = false;
  detail.value = undefined;
}, { flush: "sync" });
watch(visible, value => {
  if (!value) {
    generation++;
    password.value = "";
    loading.value = false;
    busy.value = false;
    reviewTarget.value = undefined;
    downloadTarget.value = undefined;
    files.value = [];
    uploadedFile.value = undefined;
    summary.value = "";
    agreement.value = "";
    delta.value = "0";
  }
}, { flush: "sync" });
watch(() => [props.versionId, props.openRequested, props.disabled], () => {
  if (props.openRequested && !visible.value) open();
}, { immediate: true });

function chooseReview(row: SignedContractChange) {
  downloadTarget.value = undefined;
  reviewTarget.value = row;
  decision.value = "approve";
  reviewReason.value = "";
  reviewReasonSelf.value = "";
  password.value = "";
}

function chooseDownload(row: SignedContractChange) {
  reviewTarget.value = undefined;
  downloadTarget.value = row;
  downloadReason.value = "";
  password.value = "";
}

async function submit() {
  if (busy.value) return;
  const source = files.value[0]?.raw;
  const details = detail.value;
  const changeSummary = summary.value.trim();
  const paymentAgreementText = agreement.value.trim();
  if (!details?.canSubmit || !source || !changeSummary) {
    error.value = "请上传双方已签补充协议并填写变更说明";
    return;
  }
  let amountDeltaYuan: string | null;
  try {
    amountDeltaYuan = normalizeBusinessAmount(delta.value.trim(), { allowNegative: true });
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "请输入有效的增减金额");
    return;
  }
  if (amountDeltaYuan === null) {
    error.value = "请输入增减金额";
    return;
  }
  busy.value = true;
  error.value = "";
  const token = generation;
  const versionId = props.versionId;
  try {
    const id = uploadedFile.value?.source === source
      ? uploadedFile.value.id
      : (await uploadPrivateFile(source, source.name)).id;
    if (token !== generation) return;
    uploadedFile.value = { source, id };
    await submitSignedContractChange(details.baseVersionId, {
      fileId: id,
      summary: changeSummary,
      amountDeltaYuan,
      ...(paymentAgreementText ? { paymentAgreementText } : {})
    });
    if (token !== generation) return;
    summary.value = "";
    agreement.value = "";
    files.value = [];
    uploadedFile.value = undefined;
    await reload(token, versionId);
  } catch (cause) {
    if (token === generation) error.value = formatUnknownApiError(cause, "提交补充协议失败");
  } finally {
    if (token === generation) busy.value = false;
  }
}

async function review() {
  const row = reviewTarget.value;
  if (busy.value || !row || !detail.value?.canReview) return;
  if (decision.value === "reject" && !reviewReason.value.trim()) {
    error.value = "请填写驳回原因";
    return;
  }
  busy.value = true;
  error.value = "";
  const token = generation;
  const versionId = props.versionId;
  try {
    await reviewSignedContractChange(row.baseVersionId, row.id, {
      decision: decision.value,
      ...(decision.value === "reject" ? { reason: reviewReason.value } : {}),
      ...(row.requiresSelfReview ? { selfReviewReason: reviewReasonSelf.value, confirmationPassword: password.value } : {})
    });
    if (token !== generation) return;
    reviewTarget.value = undefined;
    password.value = "";
    await reload(token, versionId);
  } catch (cause) {
    if (token === generation) error.value = formatUnknownApiError(cause, "复核补充协议失败");
  } finally {
    if (token === generation) busy.value = false;
  }
}

async function download() {
  const row = downloadTarget.value;
  if (busy.value || !row || !detail.value?.canDownloadOriginals) return;
  busy.value = true;
  error.value = "";
  const token = generation;
  try {
    await downloadPrivateFileByTicket(row.appendixFileId, {
      downloadReason: downloadReason.value,
      confirmationPassword: password.value
    });
    if (token === generation) {
      downloadTarget.value = undefined;
      password.value = "";
    }
  } catch (cause) {
    if (token === generation) error.value = formatUnknownApiError(cause, "下载签署原件失败");
  } finally {
    if (token === generation) busy.value = false;
  }
}
</script>

<style scoped>
.signed-change-form,
.signed-change-form label,
.signed-change-list {
  display: grid;
  gap: var(--jg-space-sm);
}
.signed-change-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}
.agreement-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
