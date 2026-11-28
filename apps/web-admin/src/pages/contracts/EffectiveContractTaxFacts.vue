<template>
  <t-button
    variant="outline"
    @click="open"
  >
    税务资料
  </t-button>
  <t-dialog
    v-model:visible="visible"
    header="合同税务资料"
    :footer="false"
  >
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <p v-if="detail">
      当前资料：{{ describe(detail.current) }}
    </p>
    <template v-if="detail?.canSubmit && !pending">
      <t-form @submit="submit">
        <t-form-item label="发票类型">
          <t-select
            v-model="invoiceType"
            clearable
            placeholder="不修改"
            :options="invoiceOptions"
          />
        </t-form-item>
        <t-form-item label="税率（%）">
          <t-input
            v-model="taxRate"
            placeholder="留空则不修改"
          />
        </t-form-item>
        <t-form-item label="资料依据">
          <t-textarea
            v-model="explanation"
            :maxlength="1000"
          />
        </t-form-item>
        <t-button
          type="submit"
          :loading="busy"
          :disabled="!explanation.trim() || (!invoiceType && !taxRate.trim())"
        >
          保存或提交复核
        </t-button>
      </t-form>
    </template>
    <div v-if="pending && detail?.canReview">
      <p>待复核：{{ describe(pending.before) }} → {{ describe(pending.proposed) }}</p>
      <p>{{ pending.explanation }}</p>
      <t-form-item label="复核意见">
        <t-textarea
          v-model="reason"
          :maxlength="1000"
        />
      </t-form-item>
      <template v-if="pending.requiresSelfReview">
        <t-form-item label="自审原因">
          <t-textarea
            v-model="selfReviewReason"
            :maxlength="1000"
          />
        </t-form-item>
        <t-form-item label="确认密码">
          <t-input
            v-model="confirmationPassword"
            type="password"
          />
        </t-form-item>
      </template>
      <t-space>
        <t-button
          :loading="busy"
          :disabled="!reviewReady"
          @click="review('approve')"
        >
          确认更正
        </t-button>
        <t-button
          variant="outline"
          :loading="busy"
          :disabled="!reviewReady || !reason.trim()"
          @click="review('reject')"
        >
          驳回
        </t-button>
      </t-space>
    </div>
    <ul v-if="detail?.revisions.length">
      <li
        v-for="row in detail.revisions"
        :key="row.id"
      >
        {{ row.kind === "supplement" ? "补充" : "更正" }} · {{ statusLabels[row.status] }} ·
        {{ describe(row.before) }} → {{ describe(row.proposed) }}
        <p v-if="row.explanation">
          {{ row.explanation }}
        </p>
        <p v-if="row.reviewComment">
          {{ row.reviewComment }}
        </p>
      </li>
    </ul>
  </t-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  fetchContractTaxRevisions, reviewContractTaxRevision, submitContractTaxRevision, type EffectiveTaxFacts
} from "../../api/core-flow-read.api";

const props = defineProps<{ versionId: string }>();
const visible = ref(false);
const busy = ref(false);
const error = ref("");
const detail = ref<Awaited<ReturnType<typeof fetchContractTaxRevisions>>>();
const invoiceType = ref("");
const taxRate = ref("");
const explanation = ref("");
const reason = ref("");
const selfReviewReason = ref("");
const confirmationPassword = ref("");
const pending = computed(() => detail.value?.revisions.find(row => row.status === "pending_contract_confirmation"));
const reviewReady = computed(() => !pending.value?.requiresSelfReview ||
  Boolean(selfReviewReason.value.trim() && confirmationPassword.value));
const invoiceOptions = [
  { value: "vat_general", label: "增值税普通发票" },
  { value: "vat_special", label: "增值税专用发票" }
];
const statusLabels = { pending_contract_confirmation: "待主管复核", confirmed: "已生效", rejected: "已驳回" };

function describe(facts: EffectiveTaxFacts) {
  const invoice = invoiceOptions.find(option => option.value === facts.invoiceType);
  return `${invoice?.label ?? "发票类型未填"}，${facts.taxRate === null ? "税率未填" : facts.taxRate + "%"}`;
}

async function run(action: () => Promise<void>, fallback: string) {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : fallback;
  } finally {
    busy.value = false;
  }
}

function open() {
  detail.value = undefined;
  visible.value = true;
  return run(async () => {
    detail.value = await fetchContractTaxRevisions(props.versionId);
  }, "读取合同税务资料失败");
}

function submit() {
  const versionId = detail.value?.versionId;
  if (!versionId || !detail.value?.canSubmit) return;
  return run(async () => {
    await submitContractTaxRevision(versionId, {
      ...(invoiceType.value ? { invoiceType: invoiceType.value } : {}),
      ...(taxRate.value.trim() ? { taxRate: taxRate.value.trim() } : {}),
      explanation: explanation.value.trim()
    });
    invoiceType.value = "";
    taxRate.value = "";
    explanation.value = "";
    detail.value = await fetchContractTaxRevisions(props.versionId);
  }, "保存合同税务资料失败");
}

function review(decision: "approve" | "reject") {
  const revision = pending.value;
  const versionId = detail.value?.versionId;
  if (!revision || !versionId || !detail.value?.canReview) return;
  return run(async () => {
    await reviewContractTaxRevision(versionId, revision.id, {
      decision, reason: reason.value.trim() || undefined,
      selfReviewReason: selfReviewReason.value.trim() || undefined,
      confirmationPassword: confirmationPassword.value || undefined
    });
    reason.value = "";
    selfReviewReason.value = "";
    confirmationPassword.value = "";
    detail.value = await fetchContractTaxRevisions(props.versionId);
  }, "复核合同税务更正失败");
}
</script>
