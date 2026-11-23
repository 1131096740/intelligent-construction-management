<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  confirmConstructionPaymentCorrection,
  fetchConstructionEnterprisePaid,
  fetchConstructionPaymentCorrectionCapability,
  requestConstructionPaymentCorrection,
  type ConfirmConstructionPaymentCorrectionPayload,
  type ProjectConstructionEnterprisePaidEntryReadModel,
  type ProjectConstructionEnterprisePaidSummaryReadModel,
  type RequestConstructionPaymentCorrectionPayload
} from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
  canConfirm: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [visible: boolean];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});
const loading = ref(false);
const error = ref("");
const message = ref("");
const items = ref<ProjectConstructionEnterprisePaidEntryReadModel[]>([]);
const summary = ref<ProjectConstructionEnterprisePaidSummaryReadModel | null>(null);
const nextCursor = ref<string | null>(null);
const correctionCapability = ref<string[]>([]);

const correctionVisible = ref(false);
const correctionTarget = ref<ProjectConstructionEnterprisePaidEntryReadModel | null>(null);
const correctionStage = ref<"request" | "confirm">("request");
const correctionSubmitting = ref(false);
const correctionError = ref("");
const idempotencyKey = ref(crypto.randomUUID());
const correctionForm = reactive({
  amountYuan: "",
  occurredAt: "",
  counterpartyName: "",
  correctionReason: "",
  confirmationPassword: "",
  confirmationActionId: crypto.randomUUID(),
  selfReviewReason: ""
});

const overpaid = computed(() => summary.value?.overpaidCents ?? "0");
const hasOverpaid = computed(() => overpaid.value !== "0");

function formatYuan(value: string | null | undefined) {
  return value ? `¥${centsTextToYuanText(value)}` : "—";
}
function sourceLabel(entry: ProjectConstructionEnterprisePaidEntryReadModel) {
  return entry.kind === "downstream_payment" ? "施工企业付下游" : "施工企业转我方";
}
function dateText(value: string) {
  return value.slice(0, 10);
}

async function load(reset = true) {
  loading.value = true;
  error.value = "";
  try {
    const [result, capability] = await Promise.all([
      fetchConstructionEnterprisePaid(props.projectId, {
        cursor: reset ? undefined : nextCursor.value ?? undefined,
        pageSize: 100
      }),
      reset
        ? fetchConstructionPaymentCorrectionCapability(props.projectId)
        : Promise.resolve({ availableActions: correctionCapability.value })
    ]);
    correctionCapability.value = capability.availableActions;
    items.value = reset ? result.items : [...items.value, ...result.items];
    summary.value = result.summary;
    nextCursor.value = result.nextCursor;
  } catch (loadError) {
    error.value = formatUnknownApiError(loadError, "施工企业已付明细读取失败");
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    message.value = "";
    void load(true);
  }
);

function canRequestCorrection() {
  return correctionCapability.value.includes(
    "request_construction_payment_correction"
  );
}
function canConfirmCorrection() {
  return (
    props.canConfirm &&
    correctionCapability.value.includes(
      "confirm_construction_payment_correction"
    )
  );
}

function openCorrection(entry: ProjectConstructionEnterprisePaidEntryReadModel) {
  correctionTarget.value = entry;
  correctionStage.value = "request";
  correctionError.value = "";
  idempotencyKey.value = crypto.randomUUID();
  correctionForm.amountYuan = centsTextToYuanText(
    entry.direction === "decrease"
      ? `-${entry.amountCents.replace("-", "")}`
      : entry.amountCents
  );
  correctionForm.occurredAt = dateText(entry.occurredAt);
  correctionForm.counterpartyName = entry.counterpartyName;
  correctionForm.correctionReason = "";
  correctionForm.confirmationPassword = "";
  correctionForm.confirmationActionId = crypto.randomUUID();
  correctionForm.selfReviewReason = "";
  correctionVisible.value = true;
}

async function requestCorrectionWithCapability(
  projectId: string,
  body: RequestConstructionPaymentCorrectionPayload
) {
  const capability = await fetchConstructionPaymentCorrectionCapability(projectId);
  const allowed = capability.availableActions.includes(
    "request_construction_payment_correction"
  );
  if (!allowed) throw new Error("当前账号不能提出施工企业付款更正");
  return requestConstructionPaymentCorrection(projectId, body);
}

async function confirmCorrectionWithCapability(
  projectId: string,
  sourceType: "downstream_payment" | "affiliate_remittance_to_company",
  originalFactId: string,
  body: ConfirmConstructionPaymentCorrectionPayload
) {
  const capability = await fetchConstructionPaymentCorrectionCapability(projectId);
  const allowed = capability.availableActions.includes(
    "confirm_construction_payment_correction"
  );
  if (!allowed) throw new Error("施工企业付款更正必须由财务主管确认");
  return confirmConstructionPaymentCorrection(
    projectId,
    sourceType,
    originalFactId,
    body
  );
}

async function submitCorrectionRequest() {
  const entry = correctionTarget.value;
  if (!entry) return;
  correctionSubmitting.value = true;
  correctionError.value = "";
  try {
    if (!canRequestCorrection()) throw new Error("当前账号不能提出施工企业付款更正");
    if (!correctionForm.correctionReason.trim()) throw new Error("请填写更正原因");
    await requestCorrectionWithCapability(props.projectId, {
      sourceType:
        entry.kind === "downstream_payment"
          ? "downstream_payment"
          : "affiliate_remittance_to_company",
      originalFactId: entry.id,
      correctionReason: correctionForm.correctionReason.trim(),
      idempotencyKey: idempotencyKey.value,
      amountCents: correctionForm.amountYuan.trim()
        ? yuanTextToCentsText(correctionForm.amountYuan)
        : undefined,
      occurredAt: correctionForm.occurredAt || undefined,
      counterpartyName:
        entry.kind === "downstream_payment"
          ? correctionForm.counterpartyName || undefined
          : undefined
    });
    correctionStage.value = "confirm";
    message.value = "更正已提出（反转 + 重登），等待财务主管确认。";
  } catch (submitError) {
    correctionError.value = formatUnknownApiError(submitError, "施工企业付款更正提出失败");
  } finally {
    correctionSubmitting.value = false;
  }
}

async function submitCorrectionConfirmation() {
  const entry = correctionTarget.value;
  if (!entry) return;
  correctionSubmitting.value = true;
  correctionError.value = "";
  try {
    if (!canConfirmCorrection()) throw new Error("施工企业付款更正必须由财务主管确认");
    if (!correctionForm.confirmationPassword.trim()) throw new Error("请输入当前登录密码");
    await confirmCorrectionWithCapability(
      props.projectId,
      entry.kind === "downstream_payment"
        ? "downstream_payment"
        : "affiliate_remittance_to_company",
      entry.id,
      {
        confirmationPassword: correctionForm.confirmationPassword,
        confirmationActionId: correctionForm.confirmationActionId,
        selfReviewReason: correctionForm.selfReviewReason.trim() || undefined
      }
    );
    correctionVisible.value = false;
    message.value = "更正已确认；原记录保留，施工企业已付与项目资金汇总同步更新。";
    await load(true);
  } catch (submitError) {
    correctionError.value = formatUnknownApiError(submitError, "施工企业付款更正确认失败");
  } finally {
    correctionSubmitting.value = false;
  }
}
</script>

<template>
  <t-drawer
    v-model:visible="visible"
    header="施工企业已付金额"
    size="900px"
    :footer="false"
  >
    <div class="construction-paid-drawer">
      <t-alert
        theme="info"
        message="施工企业已付 = 施工企业直接付下游 + 施工企业转我方。它与「项目对外支付」成对定义、口径不同，不可相加；我方收到后再付下游不计入本口径。"
      />
      <t-alert
        v-if="hasOverpaid"
        theme="warning"
        :message="`当前结算账本存在超付 ${formatYuan(overpaid)}：真实金额未改写，仅提示。`"
      />
      <t-alert
        v-if="message"
        theme="success"
        :message="message"
      />
      <t-alert
        v-if="error"
        theme="warning"
        :message="error"
      />

      <div
        v-if="summary"
        class="construction-paid-drawer__summary"
      >
        <div>
          <span>施工企业已付金额</span>
          <strong>{{ formatYuan(summary.paidCents) }}</strong>
        </div>
        <div>
          <span>其中付下游</span>
          <strong>{{ formatYuan(summary.downstreamCents) }}</strong>
        </div>
        <div>
          <span>其中转我方</span>
          <strong>{{ formatYuan(summary.remittanceCents) }}</strong>
        </div>
        <div>
          <span>超付提示</span>
          <strong>{{ formatYuan(summary.overpaidCents) }}</strong>
        </div>
      </div>

      <t-table
        row-key="id"
        :data="items"
        :columns="[
          { colKey: 'counterpartyName', title: '收款方' },
          { colKey: 'source', title: '来源', width: 150 },
          { colKey: 'occurredAt', title: '时间', width: 120 },
          { colKey: 'amount', title: '金额', width: 150, align: 'right' },
          { colKey: 'overpaid', title: '超付提示', width: 130 },
          { colKey: 'actions', title: '操作', width: 110 }
        ]"
        :loading="loading"
        size="small"
      >
        <template #source="{ row }">
          {{ sourceLabel(row) }}
        </template>
        <template #occurredAt="{ row }">
          {{ dateText(row.occurredAt) }}
        </template>
        <template #amount="{ row }">
          <span :class="{ 'construction-paid-drawer__negative': row.direction === 'decrease' }">
            {{ row.direction === "decrease" ? "-" : "" }}{{ formatYuan(row.amountCents.replace("-", "")) }}
          </span>
        </template>
        <template #overpaid="{ row }">
          <t-tag
            v-if="row.overpaidCents !== '0'"
            theme="warning"
            variant="light"
          >
            {{ formatYuan(row.overpaidCents) }}
          </t-tag>
          <span v-else>—</span>
        </template>
        <template #actions="{ row }">
          <t-button
            v-if="canRequestCorrection()"
            size="small"
            variant="text"
            @click="openCorrection(row)"
          >
            更正
          </t-button>
        </template>
      </t-table>

      <t-button
        v-if="nextCursor"
        variant="outline"
        :loading="loading"
        @click="load(false)"
      >
        加载更多
      </t-button>
    </div>

    <t-dialog
      v-model:visible="correctionVisible"
      header="更正施工企业付款"
      width="560px"
      :confirm-btn="{
        content: correctionStage === 'request' ? '提出更正' : '财务主管确认',
        loading: correctionSubmitting,
        disabled: correctionStage === 'confirm' && !canConfirm
      }"
      @confirm="correctionStage === 'request' ? submitCorrectionRequest() : submitCorrectionConfirmation()"
    >
      <div class="construction-paid-drawer__correction">
        <t-alert
          v-if="correctionStage === 'confirm' && !canConfirm"
          theme="warning"
          message="更正已提出，须由财务主管在本人账号下确认。"
        />
        <label>
          更正后金额（元）
          <t-input
            v-model="correctionForm.amountYuan"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <label>
          更正后业务日期
          <t-date-picker
            v-model="correctionForm.occurredAt"
            format="YYYY-MM-DD"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <label v-if="correctionTarget?.kind === 'downstream_payment'">
          更正后收款方
          <t-input
            v-model="correctionForm.counterpartyName"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <label>
          更正原因
          <t-input
            v-model="correctionForm.correctionReason"
            maxlength="500"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <template v-if="correctionStage === 'confirm'">
          <t-alert
            theme="normal"
            message="更正采用「反转 + 重登」：原记录保留，反向事实冲回后重登正确值；确认后两端汇总同步。"
          />
          <label>
            自审原因（本人提出并确认时必填）
            <t-input
              v-model="correctionForm.selfReviewReason"
              maxlength="500"
            />
          </label>
          <label>
            当前登录密码
            <t-input
              v-model="correctionForm.confirmationPassword"
              type="password"
              autocomplete="current-password"
            />
          </label>
        </template>
        <t-alert
          v-if="correctionError"
          theme="warning"
          :message="correctionError"
        />
      </div>
    </t-dialog>
  </t-drawer>
</template>

<style scoped>
.construction-paid-drawer {
  display: grid;
  gap: 16px;
}
.construction-paid-drawer__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.construction-paid-drawer__summary div {
  display: grid;
  gap: 6px;
  padding: 12px;
  background: var(--jg-surface-muted);
  border-radius: var(--jg-radius-md);
}
.construction-paid-drawer__summary span {
  color: var(--jg-text-secondary);
  font-size: 13px;
}
.construction-paid-drawer__summary strong {
  font-size: 18px;
}
.construction-paid-drawer__negative {
  color: var(--jg-danger);
}
.construction-paid-drawer__correction {
  display: grid;
  gap: 12px;
}
.construction-paid-drawer__correction label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--jg-text-secondary);
}
@media (max-width: 720px) {
  .construction-paid-drawer__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
