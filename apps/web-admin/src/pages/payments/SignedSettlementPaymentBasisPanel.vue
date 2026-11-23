<script setup lang="ts">
import { ref, watch } from "vue";
import { fetchSignedSettlementPaymentBasis, readSignedSettlementAttachment, type ConfirmedPaymentSettlement } from "../../api/signed-contract-settlement.api";
import { downloadPrivateFileByTicket, saveBlob } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";

const props = defineProps<{ projectId: string; contractId: string }>();
const basis = ref<Awaited<ReturnType<typeof fetchSignedSettlementPaymentBasis>>>();
const busy = ref(false);
const error = ref("");
const expanded = ref(false);
const attachment = ref<{ fileId: string; settlementId?: string }>();
const downloadOpen = ref(false);
let generation = 0;

watch(() => [props.projectId, props.contractId], () => {
  generation += 1;
  basis.value = undefined;
  busy.value = false;
  expanded.value = false;
  error.value = "";
  attachment.value = undefined;
  downloadOpen.value = false;
});

async function load() {
  const request = ++generation;
  busy.value = true;
  error.value = "";
  basis.value = undefined;
  try {
    const result = await fetchSignedSettlementPaymentBasis(props.projectId, props.contractId);
    if (request === generation) basis.value = result;
  } catch (cause) {
    if (request === generation) error.value = formatUnknownApiError(cause, "最新结算依据读取失败");
  } finally {
    if (request === generation) busy.value = false;
  }
}

function openDownload(fileId: string, settlement?: ConfirmedPaymentSettlement | null) {
  if (settlement?.source === "signed_registration") {
    if (!basis.value?.canReadSignedAttachments) return;
    attachment.value = { fileId, settlementId: settlement.id };
  } else {
    attachment.value = { fileId };
  }
  error.value = "";
  downloadOpen.value = true;
}

async function download(values: { reason: string; password: string }) {
  const target = attachment.value;
  if (busy.value || !target || !basis.value?.canReadSignedAttachments) return;
  const request = generation;
  busy.value = true;
  error.value = "";
  try {
    const input = { confirmationPassword: values.password, downloadReason: values.reason };
    if (target.settlementId) {
      const { blob, fileName } = await readSignedSettlementAttachment(props.projectId, target.settlementId, target.fileId, { ...input, accessMode: "download" });
      if (request === generation) saveBlob(blob, fileName);
    } else {
      await downloadPrivateFileByTicket(target.fileId, input);
    }
    if (request === generation) downloadOpen.value = false;
  } catch (cause) {
    if (request === generation) error.value = formatUnknownApiError(cause, "结算依据下载失败");
  } finally {
    if (request === generation) busy.value = false;
  }
}
</script>

<template>
  <t-card
    class="signed-basis-panel"
    title="合同结算依据"
  >
    <template #actions>
      <t-button
        variant="outline"
        :loading="busy"
        @click="load"
      >
        查看最新确认与累计
      </t-button>
    </template>
    <t-alert
      v-if="error && !downloadOpen"
      theme="error"
      :message="error"
    />
    <template v-if="basis">
      <dl class="signed-basis-panel__summary">
        <dt>最新确认</dt>
        <dd v-if="basis.latestConfirmed">
          {{ basis.latestConfirmed.number }} · 本期 {{ basis.latestConfirmed.amountYuan }} 元
        </dd>
        <dd v-else>
          暂无已确认单据
        </dd>
        <dt>合同累计结算</dt>
        <dd>{{ basis.confirmedYuan }} 元</dd>
        <template v-if="basis.downstreamCapacity">
          <dt>已登记付款及代付</dt>
          <dd>{{ basis.downstreamCapacity.recordedPaidYuan }} 元</dd>
          <dt>未结占用</dt>
          <dd>{{ basis.downstreamCapacity.outstandingYuan }} 元</dd>
          <dt>账面未占用余额</dt>
          <dd>{{ basis.downstreamCapacity.unoccupiedYuan }} 元</dd>
          <template v-if="Number(basis.downstreamCapacity.unsettledAdvanceYuan) > 0">
            <dt>尚未结算预付款</dt>
            <dd>{{ basis.downstreamCapacity.unsettledAdvanceYuan }} 元（已付预付款，后续结算自动抵扣）</dd>
          </template>
          <template v-if="Number(basis.downstreamCapacity.overpayYuan) > 0">
            <dt>超付差额</dt>
            <dd>{{ basis.downstreamCapacity.overpayYuan }} 元</dd>
          </template>
          <template v-if="Number(basis.downstreamCapacity.abnormalOverpayYuan) > 0">
            <dt>异常超付</dt>
            <dd>{{ basis.downstreamCapacity.abnormalOverpayYuan }} 元（真实已付保留，不改写原记录）</dd>
          </template>
        </template>
      </dl>
      <t-alert
        v-if="basis.downstreamCapacity?.suspended"
        theme="warning"
        title="合同累计可付余额不足，相关未付申请已暂停"
        message="只按客观余额暂停，不自动挑选先付一笔；可撤回或调整未付部分，新结算补足余额后自动解除。"
      />
      <t-space direction="vertical">
        <p v-if="!basis.canReadSignedAttachments && (basis.latestConfirmed?.source === 'signed_registration' || basis.confirmedHistory.some(record => record.source === 'signed_registration'))">
          已签结算附件由本项目合同员或合同部主管查阅。
        </p>
        <t-space
          v-if="basis.contractAttachmentIds.length"
          break-line
        >
          <t-button
            v-for="(fileId, index) in basis.contractAttachmentIds"
            :key="fileId"
            variant="text"
            :disabled="busy"
            @click="openDownload(fileId)"
          >
            合同原件 {{ index + 1 }}
          </t-button>
        </t-space>
        <t-space
          v-if="basis.latestConfirmed?.attachmentFileIds.length"
          break-line
        >
          <t-button
            v-for="(fileId, index) in basis.latestConfirmed.attachmentFileIds"
            :key="fileId"
            variant="text"
            :disabled="busy"
            @click="openDownload(fileId, basis.latestConfirmed)"
          >
            最新结算附件 {{ index + 1 }}
          </t-button>
        </t-space>
        <t-button
          v-if="basis.confirmedHistory.length"
          variant="text"
          @click="expanded = !expanded"
        >
          {{ expanded ? "收起历史附件" : "展开历史附件" }}
        </t-button>
        <ul v-if="expanded">
          <li
            v-for="record in basis.confirmedHistory"
            :key="`${record.source}:${record.id}`"
          >
            {{ record.number }} · {{ record.amountYuan }} 元
            <t-button
              v-for="(fileId, index) in record.attachmentFileIds"
              :key="fileId"
              variant="text"
              :disabled="busy"
              @click="openDownload(fileId, record)"
            >
              附件 {{ index + 1 }}
            </t-button>
          </li>
        </ul>
      </t-space>
    </template>
    <SensitiveActionDialog
      v-model="downloadOpen"
      title="下载结算付款依据"
      description="请提供当前登录密码和下载原因，系统会记录下载。"
      require-password
      require-reason
      :loading="busy"
      :error="error"
      @confirm="download"
    />
  </t-card>
</template>

<style scoped>
.signed-basis-panel__summary { display: grid; grid-template-columns: max-content 1fr; gap: var(--jg-space-sm) var(--jg-space-md); }
.signed-basis-panel__summary dd { margin: 0; overflow-wrap: anywhere; }
</style>
