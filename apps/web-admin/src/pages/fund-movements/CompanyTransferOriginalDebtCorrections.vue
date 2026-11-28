<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useAuthStore } from "../../auth/auth.store";
import {
  confirmCompanyTransferOriginalDebtCorrection,
  fetchCompanyTransferOriginalDebtCorrections,
  requestCompanyTransferOriginalDebtCorrection,
  type TransferOriginalDebtCorrection,
  type TransferOriginalDebtCorrections,
} from "../../api/company-transfer.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";

const props = defineProps<{
  transferId: string;
  eventId: string;
  originalReference: string | null;
  occurredAt: string;
  amountCents: string;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const auth = useAuthStore();
const storageKey = computed(() => `jiangkong-original-debt-correction:${auth.user?.id}:${props.transferId}:${props.eventId}`);
const data = ref<TransferOriginalDebtCorrections | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const target = ref("");
const reason = ref("");
const confirmationPassword = ref("");
const selfReviewReason = ref("");
type Pending = { kind: "request"; targetOriginalSource: string; reason: string; idempotencyKey: string } |
  { kind: "confirm"; correctionId: string; selfReviewReason?: string; idempotencyKey: string };
const pending = ref<Pending | null>(null);
const currentCorrection = computed(() => data.value?.corrections.find(correction => correction.status === "pending"));
let mounted = true;
const isCurrent = (key: string) => mounted && key === storageKey.value;
onBeforeUnmount(() => { mounted = false; });

function setPending(value: Pending | null, key = storageKey.value) {
  if (value) sessionStorage.setItem(key, JSON.stringify(value));
  else sessionStorage.removeItem(key);
  pending.value = value;
}

function correctionStatus(status: string) {
  if (status === "confirmed") return "已更正";
  if (status === "superseded") return "已由其他更正处理";
  return "待财务主管复核";
}

async function load() {
  const key = storageKey.value;
  loading.value = true;
  error.value = "";
  try {
    const result = await fetchCompanyTransferOriginalDebtCorrections(props.transferId, props.eventId, pending.value?.idempotencyKey);
    if (!isCurrent(key)) return;
    data.value = result;
    if (result.result && pending.value) {
      setPending(null, key);
      emit("changed");
    }
  } catch (failure) {
    if (isCurrent(key)) error.value = formatUnknownApiError(failure, "原债更正记录读取失败，请重试");
  } finally {
    loading.value = false;
  }
}

class CorrectionRejectedError extends Error {
  readonly code = "COMPANY_TRANSFER_CORRECTION_REJECTED";
}

async function requestWithCapability(id: string, eventId: string, body: Parameters<typeof requestCompanyTransferOriginalDebtCorrection>[2]) {
  const capability = await fetchCompanyTransferOriginalDebtCorrections(id, eventId);
  const operationAllowed = capability.canRequest;
  if (!operationAllowed) throw new CorrectionRejectedError("当前不能申请更正原债");
  return requestCompanyTransferOriginalDebtCorrection(id, eventId, body);
}

async function confirmWithCapability(
  id: string, eventId: string, correctionId: string,
  body: Parameters<typeof confirmCompanyTransferOriginalDebtCorrection>[3],
) {
  const capability = await fetchCompanyTransferOriginalDebtCorrections(id, eventId);
  const operationAllowed = capability.canConfirm;
  if (!operationAllowed) throw new CorrectionRejectedError("当前不能复核原债更正");
  return confirmCompanyTransferOriginalDebtCorrection(id, eventId, correctionId, body);
}

async function submit(value: Pending) {
  if (saving.value) return;
  const key = storageKey.value;
  const replaying = Boolean(pending.value);
  saving.value = true;
  error.value = "";
  try {
    if (pending.value) {
      await load();
      if (!isCurrent(key) || !pending.value || error.value) return;
    }
    setPending(value, key);
    if (value.kind === "request") {
      const { targetOriginalSource, reason, idempotencyKey } = value;
      await requestWithCapability(props.transferId, props.eventId, { targetOriginalSource, reason, idempotencyKey });
    } else {
      const { correctionId, idempotencyKey, selfReviewReason } = value;
      await confirmWithCapability(props.transferId, props.eventId, correctionId, {
        idempotencyKey, selfReviewReason, confirmationPassword: confirmationPassword.value,
      });
    }
    if (!isCurrent(key)) return;
    setPending(null, key);
    target.value = "";
    reason.value = "";
    confirmationPassword.value = "";
    selfReviewReason.value = "";
    await load();
    if (isCurrent(key)) emit("changed");
  } catch (failure) {
    if (isCurrent(key)) {
      if (!replaying && (failure as { code?: string })?.code === "COMPANY_TRANSFER_CORRECTION_REJECTED") {
        setPending(null, key);
        await load();
        error.value = formatUnknownApiError(failure, "办理原债更正失败");
      } else {
        await load();
        if (pending.value) error.value = formatUnknownApiError(failure, "办理原债更正失败");
      }
    }
  } finally {
    saving.value = false;
  }
}

function requestCorrection() {
  if (!data.value?.candidates.some(candidate => candidate.originalSource === target.value) || !reason.value.trim()) {
    error.value = "请选择正确的原债并填写更正原因";
    return;
  }
  void submit({ kind: "request", targetOriginalSource: target.value, reason: reason.value.trim(), idempotencyKey: crypto.randomUUID() });
}

function confirmCorrection(correction: TransferOriginalDebtCorrection) {
  if (!confirmationPassword.value || (correction.requiresSelfReview && !selfReviewReason.value.trim())) {
    error.value = correction.requiresSelfReview ? "请填写本人复核原因和当前登录密码" : "请输入当前登录密码";
    return;
  }
  void submit({
    kind: "confirm",
    correctionId: correction.id,
    selfReviewReason: correction.requiresSelfReview ? selfReviewReason.value.trim() : undefined,
    idempotencyKey: crypto.randomUUID(),
  });
}

watch(storageKey, async (key) => {
  pending.value = null;
  data.value = null;
  target.value = "";
  reason.value = "";
  confirmationPassword.value = "";
  selfReviewReason.value = "";
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) pending.value = JSON.parse(saved) as Pending;
    await load();
  } catch {
    if (isCurrent(key)) error.value = "暂时无法读取原办理记录，请刷新后核对";
  }
}, { immediate: true });
</script>

<template>
  <t-drawer
    :visible="true"
    header="归还原债更正"
    size="min(560px, 100vw)"
    :footer="false"
    :close-btn="!saving"
    :close-on-overlay-click="false"
    @close="emit('close')"
  >
    <t-alert v-if="error" theme="error" :message="error" />
    <p>归还金额 ¥{{ centsTextToYuanText(amountCents) }} · 流水日期 {{ new Date(occurredAt).toLocaleDateString('zh-CN') }}</p>
    <p>登记时归还的原债 {{ data?.originalReference || originalReference || '原代付往来' }}</p>
    <p>更正只调整归还对应的原债。沿用本笔已核银行流水。</p>
    <t-loading :loading="loading">
      <section v-if="data">
        <h3>更正记录</h3>
        <p v-if="!data.corrections.length">暂无更正记录。</p>
        <div v-for="correction in data.corrections" :key="correction.id">
          <p>{{ correctionStatus(correction.status) }} · {{ correction.targetReference || '更正后的原债' }}</p>
          <p>{{ correction.reason }}</p>
          <p>申请 {{ new Date(correction.requestedAt).toLocaleString('zh-CN') }}<template v-if="correction.confirmedAt">
            · 复核 {{ new Date(correction.confirmedAt).toLocaleString('zh-CN') }}
          </template></p>
        </div>
        <t-form v-if="(data.canConfirm && currentCorrection) || pending?.kind === 'confirm'" label-align="top">
          <t-form-item label="当前登录密码">
            <t-input v-model="confirmationPassword" type="password" autocomplete="current-password" />
          </t-form-item>
          <t-form-item v-if="currentCorrection?.requiresSelfReview && !pending" label="本人复核原因">
            <t-textarea v-model="selfReviewReason" />
          </t-form-item>
          <t-button
            v-if="data.canConfirm && currentCorrection && !pending"
            :loading="saving"
            @click="confirmCorrection(currentCorrection)"
          >
            确认更正
          </t-button>
        </t-form>
        <t-form v-if="data.canRequest && !pending" label-align="top">
          <t-form-item label="正确的原债">
            <t-select
              v-model="target"
              :options="data.candidates.map(candidate => ({ value: candidate.originalSource, label: `${candidate.reference} · 可用 ¥${centsTextToYuanText(candidate.availableCents)}` }))"
            />
          </t-form-item>
          <t-form-item label="更正原因">
            <t-textarea v-model="reason" />
          </t-form-item>
          <t-button :loading="saving" @click="requestCorrection">提交原债更正申请</t-button>
        </t-form>
        <template v-if="pending">
          <p>原办理结果待核对。继续操作会使用原有记录。</p>
          <t-button
            :loading="saving"
            :disabled="pending.kind === 'confirm' && !confirmationPassword"
            @click="submit(pending)"
          >
            继续核对原办理
          </t-button>
        </template>
      </section>
      <t-button v-else-if="error" variant="outline" @click="load">重新读取</t-button>
    </t-loading>
  </t-drawer>
</template>
