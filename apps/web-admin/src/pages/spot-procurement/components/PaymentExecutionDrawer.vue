<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, reactive, ref, watch, type DirectiveBinding } from "vue";
import type {
  SpotProcurementPaymentChannelReadModel,
  SpotProcurementPaymentExecutionReadModel,
  SpotProcurementPaymentMethod
} from "../../../api/spot-procurement.api";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../../components/file-upload-policy.config";
import { centsTextToYuanText } from "../../../lib/money";
import {
  defaultSpotPaymentExecutionDraft,
  spotPaymentExecutionVoucherLabel
} from "../spot-payment-detail.config";

export interface PaymentExecutionSubmitPayload {
  amountYuan: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentChannelId: string;
  files: File[];
  confirmationPassword: string;
}

export interface PaymentExecutionLockedAttempt {
  amountYuan: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentChannelId: string;
  voucherCount: number;
}

const props = defineProps<{
  visible: boolean;
  busy?: boolean;
  error?: string;
  remainingAmountCents: string | null | undefined;
  paymentMethods: Array<{ value: SpotProcurementPaymentMethod; label: string }>;
  paymentChannels: SpotProcurementPaymentChannelReadModel[];
  existingExecutions: SpotProcurementPaymentExecutionReadModel[];
  lockedAttempt?: PaymentExecutionLockedAttempt | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: PaymentExecutionSubmitPayload];
  resetAttempt: [];
}>();

const confirming = ref(false);
const validationError = ref("");
const voucherFiles = ref<UploadFile[]>([]);
const vInnerInputLabel = {
  mounted: setInnerInputLabel,
  updated: setInnerInputLabel
};
const form = reactive({
  amountYuan: "",
  paidAt: "",
  paymentMethod: "bank_transfer" as SpotProcurementPaymentMethod,
  paymentChannelId: "",
  confirmationPassword: ""
});

const drawerVisible = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    if (!visible) emit("close");
  }
});
const availableChannels = computed(() =>
  props.paymentChannels.filter(
    (channel) => channel.channelType === form.paymentMethod
  )
);
const channelOptions = computed(() => availableChannels.value.map((channel) => ({
  label: `${channel.channelTypeLabel} · ${channel.accountName ?? "未填账户名"}${channel.accountNumberLast4 ? `（尾号 ${channel.accountNumberLast4}）` : ""}`,
  value: channel.id
})));
const voucherLabel = computed(() =>
  spotPaymentExecutionVoucherLabel(form.paymentMethod)
);
const activeExecutions = computed(() =>
  props.existingExecutions.filter((execution) => execution.active)
);
const locked = computed(() => Boolean(props.lockedAttempt));

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    confirming.value = false;
    validationError.value = "";
    form.confirmationPassword = "";
    hydrateForm();
  }
);

watch(
  () => props.lockedAttempt,
  () => {
    if (props.visible) hydrateForm();
  }
);

watch(
  () => form.paymentMethod,
  (method, previous) => {
    if (!props.visible || locked.value || method === previous) return;
    const channels = props.paymentChannels.filter(
      (channel) => channel.channelType === method
    );
    form.paymentChannelId = channels.find((channel) => channel.primary)?.id ?? channels[0]?.id ?? "";
  }
);

function hydrateForm() {
  const draft = props.lockedAttempt ?? defaultSpotPaymentExecutionDraft({
    remainingAmountCents: props.remainingAmountCents,
    paymentMethods: props.paymentMethods,
    paymentChannels: props.paymentChannels
  });
  form.amountYuan = draft.amountYuan;
  form.paidAt = draft.paidAt;
  form.paymentMethod = draft.paymentMethod;
  form.paymentChannelId = draft.paymentChannelId;
  if (!props.lockedAttempt) voucherFiles.value = [];
}

function selectedFiles() {
  return voucherFiles.value
    .map((file) => file.raw)
    .filter((file): file is File => file instanceof File);
}

function yuanToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function validateFacts() {
  const cents = yuanToCents(form.amountYuan);
  const remaining = props.remainingAmountCents && /^\d+$/u.test(props.remainingAmountCents)
    ? BigInt(props.remainingAmountCents)
    : 0n;
  if (cents === null || cents <= 0n) return "本次实际付款金额必须大于 0，且最多 2 位小数";
  if (cents > remaining) return `本次实际付款不能超过剩余待付 ¥${centsTextToYuanText(remaining.toString())}`;
  if (!form.paidAt) return "请填写实际付款时间";
  const selectedChannel = props.paymentChannels.find(
    (channel) => channel.id === form.paymentChannelId
  );
  if (!selectedChannel || selectedChannel.channelType !== form.paymentMethod) {
    return "请从已审批冻结的收款渠道中选择本次付款渠道";
  }
  if (!locked.value && !selectedFiles().length) return `请上传${voucherLabel.value}`;
  return "";
}

function beginConfirmation() {
  validationError.value = validateFacts();
  if (validationError.value) return;
  confirming.value = true;
}

function submit() {
  validationError.value = validateFacts();
  if (validationError.value) return;
  if (!form.confirmationPassword) {
    validationError.value = "请输入当前登录密码";
    return;
  }
  const confirmationPassword = form.confirmationPassword;
  form.confirmationPassword = "";
  emit("submit", Object.freeze({
    amountYuan: form.amountYuan.trim(),
    paidAt: form.paidAt,
    paymentMethod: form.paymentMethod,
    paymentChannelId: form.paymentChannelId,
    files: [...selectedFiles()],
    confirmationPassword
  }));
}

function resetAttempt() {
  confirming.value = false;
  validationError.value = "";
  emit("resetAttempt");
}

function setInnerInputLabel(
  root: HTMLElement,
  binding: DirectiveBinding<string>
) {
  root.querySelector<HTMLInputElement>("input")?.setAttribute(
    "aria-label",
    binding.value
  );
}
</script>

<template>
  <t-drawer
    v-model:visible="drawerVisible"
    placement="right"
    size="min(600px, 100vw)"
    :close-on-overlay-click="false"
    :close-btn="!busy"
    drawer-class-name="payment-execution-drawer"
  >
    <template #header>
      <div class="payment-execution-drawer__title">
        <span>实际付款与凭证</span>
        <small>每笔实付独立冻结金额、时间、方式、渠道和凭证</small>
      </div>
    </template>

    <div class="payment-execution-drawer__body">
      <t-alert
        v-if="lockedAttempt"
        theme="warning"
        title="本次重试参数已锁定"
        :message="`将沿用同一幂等键和已上传的 ${lockedAttempt.voucherCount} 份${voucherLabel}，不会重复记账。`"
      />
      <section
        v-if="activeExecutions.length"
        class="payment-execution-drawer__history"
      >
        <div><h3>已登记实付</h3><span>{{ activeExecutions.length }} 笔</span></div>
        <p>本次仅新增一笔实际付款，不改写已有记录。</p>
      </section>

      <template v-if="!confirming">
        <dl class="payment-execution-drawer__facts">
          <div><dt>剩余待付</dt><dd>¥{{ remainingAmountCents ? centsTextToYuanText(remainingAmountCents) : "0.00" }}</dd></div>
          <div><dt>凭证要求</dt><dd>{{ voucherLabel }}</dd></div>
        </dl>
        <label><span>本次实际付款金额</span><t-input
          v-model="form.amountYuan"
          placeholder="元，最多 2 位小数"
          :disabled="locked"
        /></label>
        <label><span>实际付款时间</span><t-date-picker
          v-model="form.paidAt"
          enable-time-picker
          need-confirm
          value-type="YYYY-MM-DD HH:mm:ss"
          :disabled="locked"
        /></label>
        <label><span>实际付款方式</span><t-select
          v-model="form.paymentMethod"
          :options="paymentMethods"
          :disabled="locked"
        /></label>
        <label><span>已冻结收款渠道</span><t-select
          v-model="form.paymentChannelId"
          :options="channelOptions"
          :disabled="locked"
        /></label>
        <label v-if="!locked"><span>{{ voucherLabel }}</span><t-upload
          v-model="voucherFiles"
          theme="file-flow"
          multiple
          :auto-upload="false"
          :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
          :size-limit="{ size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes, unit: 'B' }"
        /></label>
        <t-button
          v-else
          variant="text"
          theme="primary"
          @click="resetAttempt"
        >
          修改本次付款
        </t-button>
      </template>
      <template v-else>
        <t-alert
          theme="warning"
          title="提交后将写入真实实付"
          message="请再次核对金额、付款时间和冻结渠道。登记成功后会根据服务端事实更新累计实付与剩余待付。"
        />
        <dl class="payment-execution-drawer__facts payment-execution-drawer__facts--confirm">
          <div><dt>本次实付</dt><dd>¥{{ form.amountYuan }}</dd></div>
          <div><dt>实付时间</dt><dd>{{ form.paidAt }}</dd></div>
          <div><dt>实付方式</dt><dd>{{ paymentMethods.find((item) => item.value === form.paymentMethod)?.label ?? form.paymentMethod }}</dd></div>
          <div><dt>冻结渠道</dt><dd>{{ channelOptions.find((item) => item.value === form.paymentChannelId)?.label ?? "待核对" }}</dd></div>
          <div><dt>附件</dt><dd>{{ lockedAttempt?.voucherCount ?? voucherFiles.length }} 份{{ voucherLabel }}</dd></div>
        </dl>
        <label><span>当前登录密码</span><t-input
          v-model="form.confirmationPassword"
          v-inner-input-label="'当前登录密码'"
          type="password"
          autocomplete="current-password"
        /></label>
      </template>
      <t-alert
        v-if="validationError || error"
        theme="error"
        title="暂时无法登记"
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
        {{ locked && !confirming ? "重试登记" : confirming ? "确认登记" : "继续核对" }}
      </t-button>
    </template>
  </t-drawer>
</template>

<style scoped>
.payment-execution-drawer__title,.payment-execution-drawer__body,.payment-execution-drawer__body label,.payment-execution-drawer__history{display:grid;gap:var(--jg-space-sm)}.payment-execution-drawer__title>span{font-size:var(--jg-font-size-section-title);font-weight:var(--jg-font-weight-semibold)}.payment-execution-drawer__title small,.payment-execution-drawer__body label>span,.payment-execution-drawer__facts dt,.payment-execution-drawer__history p{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.payment-execution-drawer__body{gap:var(--jg-space-lg)}.payment-execution-drawer__facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--jg-space-md);margin:0}.payment-execution-drawer__facts>div,.payment-execution-drawer__history{padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel);background:var(--jg-color-bg-surface)}.payment-execution-drawer__facts dt,.payment-execution-drawer__facts dd,.payment-execution-drawer__history h3,.payment-execution-drawer__history p{margin:0}.payment-execution-drawer__facts dd{margin-top:var(--jg-space-xs);font-weight:var(--jg-font-weight-medium)}.payment-execution-drawer__history>div{display:flex;justify-content:space-between;gap:var(--jg-space-md)}@media(max-width:480px){.payment-execution-drawer__facts{grid-template-columns:1fr}}
</style>
