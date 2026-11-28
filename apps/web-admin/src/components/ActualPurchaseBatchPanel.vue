<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../auth/auth.store";
import { centsTextToYuanText } from "../lib/money";
import { formatUnknownApiError } from "../api/error-message";
import YuanMoneyInput from "./YuanMoneyInput.vue";
import {
  confirmActualPurchaseBatchCorrection,
  createActualPurchaseBatch,
  createActualPurchaseBatchSpotPayment,
  listActualPurchaseBatches,
  recordActualPurchaseBatchRefund,
  requestActualPurchaseBatchCorrection,
  type ActualPurchaseBatchView
} from "../api/actual-purchase-batch.api";

const props = defineProps<{
  kind: "spot_material" | "general";
  procurementId: string;
  projectId?: string | null;
  companyEntityId?: string | null;
  canCreate?: boolean;
  canPay?: boolean;
}>();

const auth = useAuthStore();
const batches = ref<ActualPurchaseBatchView[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const isFinance = computed(() => Boolean(auth.user?.globalRoleKeys?.some(role => ["finance_staff", "finance_director", "comprehensive_director"].includes(role))));
const isFinanceDirector = computed(() => Boolean(auth.user?.globalRoleKeys?.includes("finance_director")));
const yuan = (cents: string | null) => cents == null ? "待明确" : `${centsTextToYuanText(cents)} 元`;
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

const createVisible = ref(false);
const createForm = reactive({
  supplierName: "",
  totalAmountCents: "",
  note: "",
  lines: [{ materialName: "", specification: "", unit: "", quantity: "", unitPrice: "", amountCents: "" }] as Array<{ materialName: string; specification: string; unit: string; quantity: string; unitPrice: string; amountCents: string }>
});
const paymentVisible = ref(false);
const paymentBatch = ref<ActualPurchaseBatchView | null>(null);
const paymentForm = reactive({
  requestedAmountCents: "",
  paymentType: "company_direct" as "company_direct" | "handler_reimbursement",
  payeeName: "",
  accountName: "",
  accountNumber: "",
  bankName: ""
});
const correctionVisible = ref(false);
const correctionBatch = ref<ActualPurchaseBatchView | null>(null);
const correctionForm = reactive({ correctedTotalAmountCents: "", reason: "" });
const confirmVisible = ref(false);
const confirmBatch = ref<ActualPurchaseBatchView | null>(null);
const confirmCorrectionId = ref("");
const confirmForm = reactive({ reviewNote: "", selfReviewReason: "", confirmationPassword: "" });
const refundVisible = ref(false);
const refundBatch = ref<ActualPurchaseBatchView | null>(null);
const refundForm = reactive({ executionId: "", amountCents: "", receivedAt: new Date().toISOString().slice(0, 10), reason: "", accountId: "" });
const refundOptions = computed(() =>
  (refundBatch.value?.payments ?? []).flatMap(payment =>
    (payment.executions ?? [])
      .filter(execution => BigInt(execution.refundableAmountCents) > 0n)
      .map(execution => ({
        label: `${payment.code} · ${payment.merchantName ?? "商家待核对"} · 可退 ${yuan(execution.refundableAmountCents)}`,
        value: execution.id,
        executionType: payment.paymentKind === "spot_procurement_payment" ? "spot_procurement_payment_execution" as const : "expense_claim_payment_execution" as const
      }))
  )
);
const selectedRefundExecution = computed(() => refundOptions.value.find(option => option.value === refundForm.executionId));

async function load() {
  if (!props.procurementId) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await listActualPurchaseBatches(props.procurementId);
    batches.value = result.items.filter(batch => batch.kind === props.kind);
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "实际采购批次读取失败");
  } finally {
    loading.value = false;
  }
}

function newKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addLine() {
  createForm.lines.push({ materialName: "", specification: "", unit: "", quantity: "", unitPrice: "", amountCents: "" });
}

function removeLine(index: number) {
  if (createForm.lines.length <= 1) return;
  createForm.lines.splice(index, 1);
}

function openCreate() {
  createForm.supplierName = "";
  createForm.totalAmountCents = "";
  createForm.note = "";
  createForm.lines = [{ materialName: "", specification: "", unit: "", quantity: "", unitPrice: "", amountCents: "" }];
  error.value = "";
  createVisible.value = true;
}

function openPayment(batch: ActualPurchaseBatchView) {
  paymentBatch.value = batch;
  paymentForm.requestedAmountCents = "";
  paymentForm.paymentType = "company_direct";
  paymentForm.payeeName = batch.supplierName;
  paymentForm.accountName = batch.supplierName;
  paymentForm.accountNumber = "";
  paymentForm.bankName = "";
  error.value = "";
  paymentVisible.value = true;
}

function openCorrection(batch: ActualPurchaseBatchView) {
  correctionBatch.value = batch;
  correctionForm.correctedTotalAmountCents = batch.effectiveTotalAmountCents;
  correctionForm.reason = "";
  error.value = "";
  correctionVisible.value = true;
}

function openConfirm(batch: ActualPurchaseBatchView, correctionId: string) {
  confirmBatch.value = batch;
  confirmCorrectionId.value = correctionId;
  confirmForm.reviewNote = "";
  confirmForm.selfReviewReason = "";
  confirmForm.confirmationPassword = "";
  error.value = "";
  confirmVisible.value = true;
}

function openRefund(batch: ActualPurchaseBatchView) {
  refundBatch.value = batch;
  refundForm.executionId = "";
  refundForm.amountCents = "";
  refundForm.receivedAt = new Date().toISOString().slice(0, 10);
  refundForm.reason = "";
  refundForm.accountId = "";
  error.value = "";
  refundVisible.value = true;
}

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
    await load();
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "实际操作采购操作未完成，请核对后重试");
  } finally {
    busy.value = false;
  }
}

async function createBatch() {
  await run(async () => {
    if (!createForm.supplierName.trim()) throw new Error("请填写实际供应商名称");
    if (!createForm.totalAmountCents) throw new Error("请填写实际采购总金额");
    const lines = createForm.lines.map(line => ({
      materialName: line.materialName.trim(),
      specification: line.specification?.trim() || null,
      unit: line.unit?.trim() || null,
      quantity: line.quantity?.trim() || null,
      unitPrice: line.unitPrice?.trim() || null,
      amountCents: line.amountCents?.trim() || null,
      note: null
    }));
    if (lines.some(line => !line.materialName)) throw new Error("请填写每条实际采购事项");
    await createActualPurchaseBatch({
      kind: props.kind,
      procurementId: props.procurementId,
      ...(props.kind === "general" ? { companyEntityId: props.companyEntityId ?? null } : {}),
      supplierName: createForm.supplierName.trim(),
      totalAmountCents: createForm.totalAmountCents,
      note: createForm.note.trim() || null,
      idempotencyKey: newKey(),
      lines
    });
    createVisible.value = false;
    notice.value = "实际采购批次已记录；可与清单合计不同，由人员核对差异。";
  });
}

async function createPayment() {
  await run(async () => {
    const batch = paymentBatch.value;
    if (!batch) return;
    if (!paymentForm.requestedAmountCents) throw new Error("请填写本次实际付款申请金额");
    if (!paymentForm.payeeName.trim()) throw new Error("请填写收款对象");
    if (!paymentForm.accountNumber.trim() || !paymentForm.bankName.trim() || !paymentForm.accountName.trim()) throw new Error("请填写收款账户名称、账号和开户银行");
    await createActualPurchaseBatchSpotPayment(batch.id, {
      requestedAmountCents: paymentForm.requestedAmountCents,
      paymentType: paymentForm.paymentType,
      payeeName: paymentForm.payeeName.trim(),
      payeeAccountName: paymentForm.accountName.trim(),
      payeeBankName: paymentForm.bankName.trim(),
      payeeBankAccount: paymentForm.accountNumber.trim(),
      paymentMethods: ["bank_transfer"],
      channels: [{ channelType: "bank_transfer", accountName: paymentForm.accountName.trim(), accountNumber: paymentForm.accountNumber.trim(), bankName: paymentForm.bankName.trim(), isPrimary: true }],
      idempotencyKey: newKey()
    });
    paymentVisible.value = false;
    notice.value = "批次付款草稿已创建，请到原付款入口提交并联审批。";
  });
}

async function requestCorrection() {
  await run(async () => {
    const batch = correctionBatch.value;
    if (!batch) return;
    if (!correctionForm.correctedTotalAmountCents) throw new Error("请填写更正后实际采购金额");
    if (!correctionForm.reason.trim()) throw new Error("请填写更正原因");
    await requestActualPurchaseBatchCorrection(batch.id, {
      correctedTotalAmountCents: correctionForm.correctedTotalAmountCents,
      reason: correctionForm.reason.trim(),
      idempotencyKey: newKey()
    });
    correctionVisible.value = false;
    notice.value = "更正已提交，等待财务主管确认；已付款保留。";
  });
}

async function confirmCorrection() {
  await run(async () => {
    const batch = confirmBatch.value;
    if (!batch || !confirmCorrectionId.value) return;
    await confirmActualPurchaseBatchCorrection(batch.id, confirmCorrectionId.value, {
      confirmationKey: newKey(),
      reviewNote: confirmForm.reviewNote.trim() || null,
      ...(auth.user?.id && batch.corrections.find(row => row.id === confirmCorrectionId.value)?.requestedByUserId === auth.user.id
        ? { selfReviewReason: confirmForm.selfReviewReason.trim(), confirmationPassword: confirmForm.confirmationPassword }
        : {})
    });
    confirmVisible.value = false;
    notice.value = "更正已确认；成本按批次有效金额重算，已付款保留。";
  });
}

async function recordRefund() {
  await run(async () => {
    const batch = refundBatch.value;
    if (!batch || !selectedRefundExecution.value) throw new Error("请选择原实付记录");
    if (!refundForm.amountCents) throw new Error("请填写退款金额");
    if (!refundForm.reason.trim()) throw new Error("请填写退款原因");
    if (!refundForm.accountId.trim()) throw new Error("请填写实际收款的资金账户编号");
    await recordActualPurchaseBatchRefund(batch.id, {
      executionType: selectedRefundExecution.value.executionType,
      executionId: refundForm.executionId,
      amountCents: refundForm.amountCents,
      receivedAt: refundForm.receivedAt,
      reason: refundForm.reason.trim(),
      accountId: refundForm.accountId.trim(),
      idempotencyKey: newKey()
    });
    refundVisible.value = false;
    notice.value = "退款已登记；原付款与成本保留，批次容量按净实付恢复。";
  });
}

onMounted(load);
</script>

<template>
  <section class="actual-purchase-batches">
    <header>
      <h2>实际采购批次</h2>
      <p>采购需求与实际批次分开：可多批/多供应商按真实事项、数量、单价和实际总金额记录；付款申请金额可与清单合计不同，只按批次剩余可付校验，不以申请预计额作支付上限。</p>
    </header>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-alert
      v-if="notice"
      theme="success"
      :message="notice"
    />
    <div class="batch-actions">
      <t-button
        v-if="canCreate"
        theme="primary"
        :loading="loading"
        @click="openCreate"
      >
        新增实际采购批次
      </t-button>
      <t-button
        theme="default"
        :loading="loading"
        @click="load"
      >
        刷新批次
      </t-button>
    </div>
    <p
      v-if="!loading && !batches.length"
      class="batch-empty"
    >
      当前还没有实际采购批次；审批通过后由采购人员按实际供应商和金额记录。
    </p>
    <article
      v-for="batch in batches"
      :key="batch.id"
      class="batch-card"
    >
      <header class="batch-card__header">
        <div>
          <h3>{{ batch.supplierName }}</h3>
          <p>
            批次成本版本 {{ batch.costVersion }} · 原批次总额 {{ yuan(batch.totalAmountCents) }} · 当前有效 {{ yuan(batch.effectiveTotalAmountCents) }}
          </p>
        </div>
        <t-tag
          :theme="batch.capacity.suspended ? 'warning' : batch.costVersion > 0 ? 'success' : 'default'"
          variant="light"
        >
          {{ batch.capacity.suspended ? "待付已暂停" : batch.costVersion > 0 ? "成本已确认" : "待首批付款确认成本" }}
        </t-tag>
      </header>
      <t-alert
        v-if="batch.capacity.suspended"
        theme="warning"
        title="实际确认金额不足"
        :message="batch.capacity.suspendReason === 'cost_overpaid' ? '批次有效金额低于已付金额，剩余付款暂停；退款或更正后自动重算。' : '批次有效金额不足以覆盖剩余付款，相关待付暂停；更正后自动重算。'"
      />
      <div class="batch-metrics">
        <div><span>申请总额</span><strong>{{ yuan(batch.effectiveTotalAmountCents) }}</strong></div>
        <div><span>累计已付</span><strong>{{ yuan(batch.capacity.paidAmountCents) }}</strong></div>
        <div><span>累计已退</span><strong>{{ yuan(batch.capacity.refundedAmountCents) }}</strong></div>
        <div><span>净已付</span><strong>{{ yuan(batch.capacity.netPaidAmountCents) }}</strong></div>
        <div><span>剩余待付占用</span><strong>{{ yuan(batch.capacity.outstandingCommittedAmountCents) }}</strong></div>
        <div><span>可付余额</span><strong>{{ yuan(batch.capacity.availableAmountCents) }}</strong></div>
        <div v-if="batch.capacity.overpaidAmountCents !== '0'"><span>超付</span><strong>{{ yuan(batch.capacity.overpaidAmountCents) }}</strong></div>
      </div>
      <div class="batch-lines">
        <div
          v-for="line in batch.lines"
          :key="line.id"
          class="batch-line"
        >
          <span>{{ line.materialName }}</span>
          <span>{{ line.specification ?? "规格待明确" }} · {{ line.unit ?? "单位待明确" }}</span>
          <span>数量 {{ line.quantity ?? "待明确" }} · 单价 {{ line.unitPrice ?? "待明确" }}</span>
          <span>金额 {{ line.amountCents == null ? "待明确" : yuan(line.amountCents) }}</span>
        </div>
      </div>
      <div class="batch-payments">
        <h4>付款/报销记录</h4>
        <p v-if="!batch.payments.length">尚无付款或报销申请。</p>
        <div
          v-for="payment in batch.payments"
          :key="payment.id"
          class="batch-payment"
        >
          <div>
            <strong>{{ payment.merchantName ?? "商家待核对" }} · {{ payment.code }}</strong>
            <span>{{ payment.status }}</span>
          </div>
          <div>
            申请 {{ yuan(payment.requestedAmountCents) }} · 已付 {{ yuan(payment.paidAmountCents) }} · 已退 {{ yuan(payment.refundedAmountCents) }}
          </div>
          <div
            v-for="execution in payment.executions ?? []"
            :key="execution.id"
            class="batch-execution"
          >
            实付 {{ yuan(execution.amountCents) }}（{{ date(execution.paidAt) }}）· 可退 {{ yuan(execution.refundableAmountCents) }}
          </div>
        </div>
      </div>
      <div
        v-if="batch.corrections.length"
        class="batch-corrections"
      >
        <h4>金额更正</h4>
        <div
          v-for="correction in batch.corrections"
          :key="correction.id"
          class="batch-correction"
        >
          <span>{{ correction.status === "confirmed" ? "已确认" : "待财务主管确认" }}：{{ yuan(correction.originalTotalAmountCents) }} → {{ yuan(correction.correctedTotalAmountCents) }} · {{ correction.reason }}</span>
          <t-button
            v-if="correction.status === 'pending_confirm' && isFinanceDirector"
            size="small"
            theme="primary"
            @click="openConfirm(batch, correction.id)"
          >
            确认更正
          </t-button>
        </div>
      </div>
      <div
        v-if="batch.refunds.length"
        class="batch-refunds"
      >
        <h4>退款</h4>
        <div
          v-for="refund in batch.refunds"
          :key="refund.id"
          class="batch-refund"
        >
          {{ date(refund.receivedAt) }} 退 {{ yuan(refund.amountCents) }} · {{ refund.reason }}
        </div>
      </div>
      <div class="batch-actions">
        <t-button
          v-if="kind === 'spot_material' && canPay && !batch.capacity.suspended"
          theme="primary"
          @click="openPayment(batch)"
        >
          发起本批付款
        </t-button>
        <t-button
          v-if="isFinance && batch.costVersion > 0"
          theme="default"
          @click="openCorrection(batch)"
        >
          更正批次金额
        </t-button>
        <t-button
          v-if="isFinance && Number(batch.capacity.paidAmountCents) > 0"
          theme="default"
          @click="openRefund(batch)"
        >
          登记退款
        </t-button>
      </div>
    </article>

    <t-dialog
      v-model:visible="createVisible"
      header="记录实际采购批次"
      width="min(980px, 94vw)"
      :confirm-btn="{ content: '保存批次', loading: busy }"
      @confirm="createBatch"
    >
      <div class="batch-form">
        <label><span>实际供应商</span><t-input v-model="createForm.supplierName" placeholder="按实际开票/收款商家填写" /></label>
        <label><span>实际采购总金额</span><YuanMoneyInput v-model="createForm.totalAmountCents" /></label>
        <label><span>说明</span><t-textarea v-model="createForm.note" placeholder="优惠、差异或其他核对说明" /></label>
        <div
          v-for="(line, index) in createForm.lines"
          :key="index"
          class="batch-line-form"
        >
          <t-input v-model="line.materialName" placeholder="实际事项" />
          <t-input v-model="line.specification" placeholder="规格（可空）" />
          <t-input v-model="line.unit" placeholder="单位（可空）" />
          <t-input v-model="line.quantity" placeholder="数量（可空）" />
          <t-input v-model="line.unitPrice" placeholder="单价（可空）" />
          <YuanMoneyInput v-model="line.amountCents" />
          <t-button theme="default" variant="text" :disabled="createForm.lines.length <= 1" @click="removeLine(index)">删除</t-button>
        </div>
        <t-button theme="default" variant="outline" @click="addLine">增加明细行</t-button>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="paymentVisible"
      header="发起本批实际付款"
      width="min(720px, 94vw)"
      :confirm-btn="{ content: '创建付款草稿', loading: busy }"
      @confirm="createPayment"
    >
      <div class="batch-form">
        <label><span>本次付款申请金额</span><YuanMoneyInput v-model="paymentForm.requestedAmountCents" /></label>
        <label><span>付款类型</span><t-select v-model="paymentForm.paymentType" :options="[{ label: '公司直付商家', value: 'company_direct' }, { label: '经办人垫付后报回', value: 'handler_reimbursement' }]" /></label>
        <label><span>收款对象</span><t-input v-model="paymentForm.payeeName" /></label>
        <label><span>收款账户名称</span><t-input v-model="paymentForm.accountName" /></label>
        <label><span>收款账号</span><t-input v-model="paymentForm.accountNumber" /></label>
        <label><span>开户银行</span><t-input v-model="paymentForm.bankName" /></label>
        <t-alert theme="info" message="付款申请金额可低于批次总额，也可与清单合计不同；按批次剩余可付金额校验，不用申请预计额作上限。" />
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="correctionVisible"
      header="更正实际采购金额"
      width="min(640px, 94vw)"
      :confirm-btn="{ content: '提交财务主管确认', loading: busy }"
      @confirm="requestCorrection"
    >
      <div class="batch-form">
        <label><span>更正后实际采购金额</span><YuanMoneyInput v-model="correctionForm.correctedTotalAmountCents" /></label>
        <label><span>更正原因</span><t-textarea v-model="correctionForm.reason" placeholder="折让、退货或其他正确金额依据" /></label>
        <t-alert theme="info" message="已付款保留；只有确认金额不足以覆盖已付或剩余付款时才暂停，否则照常。" />
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="confirmVisible"
      header="财务主管确认实际采购更正"
      width="min(640px, 94vw)"
      :confirm-btn="{ content: '确认更正', loading: busy }"
      @confirm="confirmCorrection"
    >
      <div class="batch-form">
        <label><span>复核说明</span><t-textarea v-model="confirmForm.reviewNote" /></label>
        <template v-if="auth.user?.id && confirmBatch?.corrections.find(row => row.id === confirmCorrectionId)?.requestedByUserId === auth.user.id">
          <label><span>自审原因</span><t-input v-model="confirmForm.selfReviewReason" /></label>
          <label><span>当前登录密码</span><t-input v-model="confirmForm.confirmationPassword" type="password" autocomplete="current-password" /></label>
        </template>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="refundVisible"
      header="登记实际收到的退款"
      width="min(720px, 94vw)"
      :confirm-btn="{ content: '登记退款', loading: busy }"
      @confirm="recordRefund"
    >
      <div class="batch-form">
        <label><span>原实付记录</span><t-select v-model="refundForm.executionId" :options="refundOptions" placeholder="选择可退实付" /></label>
        <label><span>退款金额</span><YuanMoneyInput v-model="refundForm.amountCents" /></label>
        <label><span>到账日期</span><t-input v-model="refundForm.receivedAt" /></label>
        <label><span>退款原因</span><t-input v-model="refundForm.reason" /></label>
        <label><span>实际收款资金账户编号</span><t-input v-model="refundForm.accountId" placeholder="已核对余额的公司资金或公共现金账户" /></label>
        <t-alert theme="info" message="退款不改原实付和已确认采购成本，只恢复净付款与批次可付容量；累计退款不超过原实付。" />
      </div>
    </t-dialog>
  </section>
</template>

<style scoped>
.actual-purchase-batches { display: grid; gap: var(--jg-space-md); min-width: 0; }
.actual-purchase-batches > header p, .batch-empty { color: var(--jg-color-text-tertiary); }
.batch-card { display: grid; gap: var(--jg-space-md); padding: var(--jg-space-md); border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-panel); background: var(--jg-color-bg-surface); min-width: 0; }
.batch-card__header { display: flex; justify-content: space-between; gap: var(--jg-space-sm); flex-wrap: wrap; }
.batch-card__header p { color: var(--jg-color-text-tertiary); }
.batch-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--jg-space-sm); }
.batch-metrics > div { display: grid; gap: var(--jg-space-xs); padding: var(--jg-space-sm); border-radius: var(--jg-radius-panel); background: var(--jg-color-bg-subtle); }
.batch-metrics span { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.batch-lines, .batch-payments, .batch-corrections, .batch-refunds { display: grid; gap: var(--jg-space-sm); }
.batch-line, .batch-payment, .batch-correction, .batch-refund { display: flex; justify-content: space-between; gap: var(--jg-space-sm); flex-wrap: wrap; padding-block: var(--jg-space-xs); border-bottom: 1px solid var(--jg-color-border); }
.batch-execution { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.batch-actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
.batch-form { display: grid; gap: var(--jg-space-md); }
.batch-form label { display: grid; gap: var(--jg-space-xs); }
.batch-line-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--jg-space-xs); align-items: center; }
</style>
