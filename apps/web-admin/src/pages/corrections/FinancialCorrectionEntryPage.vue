<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchFinancialCorrectionCapability,
  type FinancialCorrectionCapability,
  type FinancialCorrectionDocType
} from "../../api/payment-financial.api";

const router = useRouter();
const type = ref<FinancialCorrectionDocType>("payment_request");
const businessId = ref("");
const loading = ref(false);
const error = ref("");
const capability = ref<FinancialCorrectionCapability | null>(null);

const types = [
  { label: "付款申请", value: "payment_request" },
  { label: "已确认实付", value: "payment_execution" },
  { label: "已签结算", value: "settlement" },
  { label: "已签合同", value: "contract" }
];

async function search() {
  if (!businessId.value.trim()) {
    error.value = "请填写业务单号";
    return;
  }
  loading.value = true;
  error.value = "";
  capability.value = null;
  try {
    capability.value = await fetchFinancialCorrectionCapability(type.value, businessId.value.trim());
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "读取统一更正入口失败，请稍后重试");
  } finally {
    loading.value = false;
  }
}

function open(action: { path: string; enabled: boolean }) {
  if (!action.enabled) return;
  void router.push(action.path);
}
</script>

<template>
  <section class="correction-entry">
    <t-card header="统一更正">
      <p class="correction-entry__hint">
        同一入口按单据类型、当前状态和岗位给出唯一去处；它只登记补偿事实，不直接改写原单。
      </p>
      <t-form label-width="88px" @submit.prevent="search">
        <t-form-item label="单据类型">
          <t-select v-model="type" :options="types" />
        </t-form-item>
        <t-form-item label="业务单号">
          <t-input v-model="businessId" placeholder="付款单号 / 实付记录 / 结算单号 / 合同编号" @enter="search" />
        </t-form-item>
        <t-form-item>
          <t-button theme="primary" :loading="loading" @click="search">查看可办理动作</t-button>
        </t-form-item>
      </t-form>
      <t-alert v-if="error" theme="error" :message="error" />
      <template v-if="capability">
        <div class="correction-entry__title">
          <strong>{{ capability.title }}</strong>
          <t-tag variant="light">{{ capability.status }}</t-tag>
        </div>
        <p>{{ capability.guidance }}</p>
        <div v-if="capability.actions.length" class="correction-entry__actions">
          <t-button
            v-for="action in capability.actions"
            :key="action.key"
            :disabled="!action.enabled"
            @click="open(action)"
          >
            {{ action.label }}
            <span v-if="action.reason" class="correction-entry__reason">（{{ action.reason }}）</span>
          </t-button>
        </div>
        <t-alert v-else theme="info" message="当前状态没有可执行的更正动作，请从原单据查看处理进度。" />
      </template>
    </t-card>
  </section>
</template>

<style scoped>
.correction-entry { max-width: 880px; }
.correction-entry__hint { color: var(--jg-text-secondary); margin-bottom: 16px; }
.correction-entry__title { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; }
.correction-entry__actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.correction-entry__reason { color: var(--jg-text-secondary); font-size: 12px; }
</style>
