<template>
  <section
    class="settlement-recovery-ledger"
    aria-label="结算回收台账"
  >
    <header class="settlement-recovery-ledger__header">
      <div>
        <h2>结算回收台账</h2>
        <p>仅针对已生效的负结算；退款、抵扣和更正均保留原始事实，不支持删除。</p>
      </div>
      <t-button
        v-if="canRecord && ledger"
        theme="primary"
        :disabled="loading"
        @click="openRecord"
      >
        登记退款 / 抵扣
      </t-button>
    </header>

    <t-alert
      v-if="error"
      theme="error"
      :message="error"
      close
      @close="error = ''"
    />
    <t-loading
      :loading="loading"
      size="small"
    >
      <template v-if="ledger">
        <dl class="settlement-recovery-ledger__summary">
          <div><dt>待回收总额</dt><dd>{{ yuan(ledger.balance.originalAmountCents) }}</dd></div>
          <div><dt>已回收</dt><dd>{{ yuan(ledger.balance.resolvedAmountCents) }}</dd></div>
          <div><dt>待处理</dt><dd>{{ yuan(ledger.balance.outstandingAmountCents) }}</dd></div>
          <div>
            <dt>台账状态</dt><dd>
              <t-tag
                :theme="statusTheme(ledger.balance.status)"
                variant="light"
              >
                {{ statusLabel(ledger.balance.status) }}
              </t-tag>
            </dd>
          </div>
        </dl>
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="ledger.entries"
          :scroll="{ x: 1080 }"
          horizontal-scroll-affixed-bottom
        >
          <template #entryType="{ row }">
            <t-tag
              :theme="entryTheme(row.entryType)"
              variant="light"
            >
              {{ entryLabel(row.entryType) }}
            </t-tag>
          </template>
          <template #amountCents="{ row }">
            {{ yuan(row.amountCents) }}
          </template>
          <template #occurredAt="{ row }">
            {{ dateText(row.occurredAt) }}
          </template>
          <template #evidence="{ row }">
            <t-button
              variant="text"
              size="small"
              @click="emit('download', row.evidenceFileId)"
            >
              查看凭证
            </t-button>
          </template>
          <template #actions="{ row }">
            <t-button
              v-if="canRecord && row.entryType !== 'reversal' && !hasReversal(row.id)"
              theme="danger"
              variant="text"
              size="small"
              @click="openReverse(row.id)"
            >
              反向更正
            </t-button>
            <span v-else>—</span>
          </template>
        </t-table>
        <p
          v-if="!canRecord"
          class="settlement-recovery-ledger__readonly"
        >
          当前账号仅可查看回收事实及凭证；登记和更正由项目财务专员办理。
        </p>
      </template>
      <t-alert
        v-else-if="!loading"
        theme="info"
        title="暂无结算回收台账"
        message="只有负结算在归档生效时才会自动建立回收余额。"
      />
    </t-loading>

    <t-dialog
      v-model:visible="recordVisible"
      header="登记结算退款或抵扣"
      confirm-btn="确认登记"
      :confirm-loading="submitting"
      :close-on-overlay-click="false"
      @confirm="submitRecord"
      @close="resetRecord"
    >
      <t-form label-align="top">
        <t-form-item
          label="处理方式"
          required-mark
        >
          <t-radio-group
            v-model="recordForm.entryType"
            variant="default-filled"
          >
            <t-radio value="refund">
              退款到账
            </t-radio>
            <t-radio value="offset">
              付款抵扣
            </t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item
          label="回收金额（元）"
          required-mark
        >
          <t-input
            v-model="recordForm.amountYuan"
            placeholder="例如 100.00"
            inputmode="decimal"
          />
        </t-form-item>
        <t-form-item
          label="发生日期"
          required-mark
        >
          <t-date-picker
            v-model="recordForm.occurredOn"
            value-type="YYYY-MM-DD"
            format="YYYY-MM-DD"
          />
        </t-form-item>
        <t-form-item
          v-if="recordForm.entryType === 'offset'"
          label="关联付款申请"
          required-mark
        >
          <t-input
            v-model="recordForm.relatedPaymentId"
            placeholder="填写同合同的付款申请编号"
          />
        </t-form-item>
        <t-form-item
          label="回收凭证"
          required-mark
        >
          <t-upload
            v-model="recordFiles"
            theme="file-input"
            :auto-upload="false"
            :max="1"
            accept=".pdf,.jpg,.jpeg,.png"
          />
        </t-form-item>
        <t-form-item
          label="回收原因"
          required-mark
        >
          <t-textarea
            v-model="recordForm.reason"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="说明退款到账或抵扣依据"
          />
        </t-form-item>
        <t-form-item
          label="当前登录密码"
          required-mark
        >
          <t-input
            v-model="recordForm.confirmationPassword"
            type="password"
            placeholder="用于确认敏感登记"
          />
        </t-form-item>
      </t-form>
      <t-alert
        v-if="dialogError"
        theme="error"
        :message="dialogError"
      />
    </t-dialog>

    <t-dialog
      v-model:visible="reverseVisible"
      header="反向更正回收登记"
      confirm-btn="确认更正"
      confirm-btn-theme="danger"
      :confirm-loading="submitting"
      :close-on-overlay-click="false"
      @confirm="submitReverse"
      @close="resetReverse"
    >
      <t-alert
        theme="warning"
        message="更正会新增一条反向事实并恢复待处理余额，原登记不会被删除。"
      />
      <t-form label-align="top">
        <t-form-item
          label="更正凭证"
          required-mark
        >
          <t-upload
            v-model="reverseFiles"
            theme="file-input"
            :auto-upload="false"
            :max="1"
            accept=".pdf,.jpg,.jpeg,.png"
          />
        </t-form-item>
        <t-form-item
          label="更正原因"
          required-mark
        >
          <t-textarea
            v-model="reverseForm.reason"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="说明需要更正的原因"
          />
        </t-form-item>
        <t-form-item
          label="当前登录密码"
          required-mark
        >
          <t-input
            v-model="reverseForm.confirmationPassword"
            type="password"
            placeholder="用于确认敏感更正"
          />
        </t-form-item>
      </t-form>
      <t-alert
        v-if="dialogError"
        theme="error"
        :message="dialogError"
      />
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type { PrimaryTableCol, UploadFile } from "tdesign-vue-next";
import { onMounted, reactive, ref, watch } from "vue";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";
import {
  fetchSettlementRecovery,
  recordSettlementRecovery,
  reverseSettlementRecovery,
  type SettlementRecoveryEntryReadModel,
  type SettlementRecoveryEntryType,
  type SettlementRecoveryReadModel
} from "../../../api/settlement-recovery.api";
import { centsTextToYuanText } from "../../../lib/money";

const props = withDefaults(defineProps<{ settlementId: string; canRecord?: boolean }>(), { canRecord: false });
const emit = defineEmits<{ download: [fileId: string] }>();
const ledger = ref<SettlementRecoveryReadModel | null>(null);
const loading = ref(false);
const submitting = ref(false);
const error = ref("");
const dialogError = ref("");
const recordVisible = ref(false);
const reverseVisible = ref(false);
const reverseEntryId = ref("");
const recordFiles = ref<UploadFile[]>([]);
const reverseFiles = ref<UploadFile[]>([]);
const recordForm = reactive({ entryType: "refund" as "refund" | "offset", amountYuan: "", occurredOn: today(), relatedPaymentId: "", reason: "", confirmationPassword: "" });
const reverseForm = reactive({ reason: "", confirmationPassword: "" });
const columns: PrimaryTableCol<SettlementRecoveryEntryReadModel>[] = [
  { colKey: "entryType", title: "事实类型", width: 108 },
  { colKey: "amountCents", title: "金额", width: 132, align: "right" },
  { colKey: "occurredAt", title: "发生日期", width: 118 },
  { colKey: "reason", title: "依据 / 原因", minWidth: 240 },
  { colKey: "relatedPaymentId", title: "关联付款申请", width: 168 },
  { colKey: "evidence", title: "凭证", width: 104 },
  { colKey: "actions", title: "操作", width: 104, fixed: "right" }
];

function yuan(value: string) { return `¥${centsTextToYuanText(value)}`; }
function dateText(value: string) { return value.slice(0, 10); }
function statusLabel(status: SettlementRecoveryReadModel["balance"]["status"]) { return ({ open: "待处理", partially_resolved: "部分已处理", resolved: "已处理完毕" })[status]; }
function statusTheme(status: SettlementRecoveryReadModel["balance"]["status"]) { return status === "resolved" ? "success" as const : status === "partially_resolved" ? "warning" as const : "primary" as const; }
function entryLabel(type: SettlementRecoveryEntryType) { return ({ refund: "退款到账", offset: "付款抵扣", reversal: "反向更正" })[type]; }
function entryTheme(type: SettlementRecoveryEntryType) { return type === "reversal" ? "danger" as const : type === "offset" ? "warning" as const : "success" as const; }
function hasReversal(entryId: string) { return ledger.value?.entries.some((entry) => entry.reversalOfEntryId === entryId) ?? false; }
function today() { return new Date().toISOString().slice(0, 10); }
function selectedFile(files: UploadFile[]) { const raw = files[0]?.raw; return raw instanceof File ? raw : null; }
function centsFromYuan(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("回收金额必须是大于 0 的元金额，最多保留两位小数");
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (cents <= 0n) throw new Error("回收金额必须大于 0");
  return cents.toString();
}
function required(value: string, label: string) { const normalized = value.trim(); if (!normalized) throw new Error(`${label}不能为空`); return normalized; }
function nextKey(prefix: string) { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }

async function load() {
  const settlementId = props.settlementId.trim();
  if (!settlementId) return;
  loading.value = true;
  error.value = "";
  try { ledger.value = await fetchSettlementRecovery(settlementId); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "读取结算回收台账失败"; }
  finally { loading.value = false; }
}
function openRecord() { dialogError.value = ""; recordVisible.value = true; }
function openReverse(entryId: string) { reverseEntryId.value = entryId; dialogError.value = ""; reverseVisible.value = true; }
function resetRecord() { recordFiles.value = []; Object.assign(recordForm, { entryType: "refund", amountYuan: "", occurredOn: today(), relatedPaymentId: "", reason: "", confirmationPassword: "" }); dialogError.value = ""; }
function resetReverse() { reverseEntryId.value = ""; reverseFiles.value = []; Object.assign(reverseForm, { reason: "", confirmationPassword: "" }); dialogError.value = ""; }

async function submitRecord() {
  try {
    const file = selectedFile(recordFiles.value);
    if (!file) throw new Error("请上传回收凭证");
    submitting.value = true; dialogError.value = "";
    const uploaded = await uploadPrivateFile(file, file.name);
    await recordSettlementRecovery(props.settlementId, {
      entryType: recordForm.entryType,
      amountCents: centsFromYuan(recordForm.amountYuan),
      occurredOn: required(recordForm.occurredOn, "发生日期"),
      relatedPaymentId: recordForm.entryType === "offset" ? required(recordForm.relatedPaymentId, "关联付款申请") : undefined,
      evidenceFileId: uploaded.id,
      reason: required(recordForm.reason, "回收原因"),
      idempotencyKey: nextKey("settlement-recovery"),
      confirmationPassword: required(recordForm.confirmationPassword, "当前登录密码")
    });
    recordVisible.value = false; resetRecord(); await load();
  } catch (cause) { dialogError.value = cause instanceof Error ? cause.message : "登记结算回收失败"; }
  finally { submitting.value = false; }
}

async function submitReverse() {
  try {
    const file = selectedFile(reverseFiles.value);
    if (!file) throw new Error("请上传更正凭证");
    submitting.value = true; dialogError.value = "";
    const uploaded = await uploadPrivateFile(file, file.name);
    await reverseSettlementRecovery(props.settlementId, required(reverseEntryId.value, "待更正回收登记"), {
      evidenceFileId: uploaded.id,
      reason: required(reverseForm.reason, "更正原因"),
      idempotencyKey: nextKey("settlement-recovery-reversal"),
      confirmationPassword: required(reverseForm.confirmationPassword, "当前登录密码")
    });
    reverseVisible.value = false; resetReverse(); await load();
  } catch (cause) { dialogError.value = cause instanceof Error ? cause.message : "登记反向更正失败"; }
  finally { submitting.value = false; }
}

watch(() => props.settlementId, () => void load());
onMounted(() => void load());
</script>

<style scoped>
.settlement-recovery-ledger { display: grid; gap: var(--jg-space-4); }
.settlement-recovery-ledger__header { display: flex; align-items: start; justify-content: space-between; gap: var(--jg-space-4); }
.settlement-recovery-ledger__header h2 { margin: 0; font-size: var(--jg-font-size-lg); }
.settlement-recovery-ledger__header p, .settlement-recovery-ledger__readonly { margin: var(--jg-space-1) 0 0; color: var(--jg-color-text-secondary); }
.settlement-recovery-ledger__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--jg-space-3); margin: 0; }
.settlement-recovery-ledger__summary > div { padding: var(--jg-space-3); border: 1px solid var(--jg-color-border); border-radius: var(--jg-radius-md); background: var(--jg-color-bg-container); }
.settlement-recovery-ledger__summary dt { color: var(--jg-color-text-secondary); font-size: var(--jg-font-size-sm); }
.settlement-recovery-ledger__summary dd { margin: var(--jg-space-1) 0 0; font-weight: 600; }
@media (max-width: 760px) { .settlement-recovery-ledger__header { display: grid; } .settlement-recovery-ledger__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
