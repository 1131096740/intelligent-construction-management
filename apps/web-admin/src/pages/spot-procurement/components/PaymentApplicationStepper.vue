<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, reactive, ref, watch } from "vue";
import type {
  SpotProcurementPaymentDetailReadModel,
  SpotProcurementPaymentMethod,
  VatRateOptionReadModel
} from "../../../api/spot-procurement.api";
import { centsTextToYuanText } from "../../../lib/money";
import { calculateSpotProcurementLineAmountCents } from "../../../lib/money";
import { SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY } from "../../../components/file-upload-policy.config";

export type PaymentApplicationLineDraft = {
  procurementLineId: string;
  materialName: string;
  specification: string | null;
  unit: string;
  approvedQuantity: string;
  included: boolean;
  paymentQuantity: string;
  unitPrice: string;
  expectedInvoiceCondition: "vat_general" | "vat_special" | "no_invoice";
  vatRateOptionId: string;
};

export type PaymentApplicationChannelDraft = {
  channelType: SpotProcurementPaymentMethod;
  accountName: string;
  accountNumber: string;
  bankName: string;
  note: string;
  isPrimary: boolean;
};

export interface PaymentApplicationDraft {
  paymentType: "company_direct" | "handler_reimbursement";
  merchantName: string;
  payeeDiffersFromMerchant: boolean;
  payeeName: string;
  merchantPayeeMismatchNote: string;
  paymentMethods: SpotProcurementPaymentMethod[];
  lines: PaymentApplicationLineDraft[];
  channels: PaymentApplicationChannelDraft[];
  attachmentCategory: "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other";
}

const props = defineProps<{
  detail: SpotProcurementPaymentDetailReadModel;
  draft: PaymentApplicationDraft;
  initialStep: 0 | 1 | 2 | 3;
  vatOptions: VatRateOptionReadModel[];
  historicalMerchants: string[];
  attachmentFiles: UploadFile[];
  retainedAttachmentIds: string[];
  busy?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  save: [draft: PaymentApplicationDraft];
  submit: [draft: PaymentApplicationDraft];
  cancel: [];
  "update:attachmentFiles": [files: UploadFile[]];
  "update:retainedAttachmentIds": [ids: string[]];
}>();

const step = ref<0 | 1 | 2 | 3>(props.initialStep);
const form = reactive<PaymentApplicationDraft>({
  ...props.draft,
  paymentMethods: [...props.draft.paymentMethods],
  lines: props.draft.lines.map((line) => ({ ...line })),
  channels: props.draft.channels.map((channel) => ({ ...channel }))
});
watch(() => props.initialStep, (value) => { step.value = value; });

const steps = [
  "1. 付款与商户",
  "2. 付款材料",
  "3. 收款渠道与依据",
  "4. 核对并提交"
] as const;
const paymentMethodOptions = [
  { label: "银行转账", value: "bank_transfer" },
  { label: "现金", value: "cash" },
  { label: "微信", value: "wechat" },
  { label: "支付宝", value: "alipay" },
  { label: "其他", value: "other" }
];
const invoiceConditionOptions = [
  { label: "普通增值税发票", value: "vat_general" },
  { label: "专用增值税发票", value: "vat_special" },
  { label: "无发票", value: "no_invoice" }
];

const resolvedPayeeName = computed(() => {
  if (form.paymentType === "handler_reimbursement") {
    return props.detail.payment.handler.name;
  }
  return form.payeeDiffersFromMerchant
    ? form.payeeName.trim()
    : form.merchantName.trim();
});
const selectedLines = computed(() => form.lines.filter((line) => line.included));
const previewAmount = computed(() => {
  try {
    const cents = selectedLines.value.reduce(
      (sum, line) => sum + BigInt(calculateSpotProcurementLineAmountCents(line.paymentQuantity, line.unitPrice)),
      0n
    );
    return `¥${centsTextToYuanText(cents.toString())}`;
  } catch {
    return "待完善";
  }
});

function chooseMerchant(name: string) {
  form.merchantName = name;
  if (!form.payeeDiffersFromMerchant) form.payeeName = name;
}

function updatePaymentType(value: string | number) {
  form.paymentType = value as PaymentApplicationDraft["paymentType"];
  if (form.paymentType === "handler_reimbursement") {
    form.payeeDiffersFromMerchant = false;
    form.payeeName = props.detail.payment.handler.name;
    form.merchantPayeeMismatchNote = "经办人垫付后报回";
  }
}

function addChannel() {
  form.channels.push({
    channelType: form.paymentMethods[0] ?? "bank_transfer",
    accountName: "",
    accountNumber: "",
    bankName: "",
    note: "",
    isPrimary: form.channels.length === 0
  });
}

function removeChannel(index: number) {
  if (form.channels.length === 1) return;
  const wasPrimary = form.channels[index]?.isPrimary;
  form.channels.splice(index, 1);
  if (wasPrimary && form.channels[0]) form.channels[0].isPrimary = true;
}

function setPrimary(index: number) {
  form.channels.forEach((channel, channelIndex) => {
    channel.isPrimary = channelIndex === index;
  });
}

function snapshot() {
  return {
    ...form,
    paymentMethods: [...form.paymentMethods],
    lines: form.lines.map((line) => ({ ...line })),
    channels: form.channels.map((channel) => ({ ...channel }))
  };
}
</script>

<template>
  <section
    class="payment-application-stepper"
    aria-labelledby="payment-application-title"
  >
    <header class="payment-application-stepper__header">
      <div>
        <span class="payment-application-stepper__eyebrow">A5 付款申请</span>
        <h2 id="payment-application-title">
          继续填写付款申请
        </h2>
        <p>按业务顺序补全付款条件；离开前保存的是一份完整草稿快照。</p>
      </div>
      <t-button
        variant="text"
        :disabled="busy"
        @click="emit('cancel')"
      >
        退出填写
      </t-button>
    </header>

    <ol
      class="payment-application-stepper__steps"
      aria-label="付款申请填写步骤"
    >
      <li
        v-for="(label, index) in steps"
        :key="label"
        :class="{ 'is-active': step === index, 'is-complete': step > index }"
      >
        <t-button
          variant="text"
          :aria-current="step === index ? 'step' : undefined"
          @click="step = index as 0 | 1 | 2 | 3"
        >
          {{ label }}
        </t-button>
      </li>
    </ol>

    <div
      v-if="step === 0"
      class="payment-application-stepper__body"
    >
      <header><h3>确认付款对象</h3><p>一般情况下商户就是收款对象；仅在确有代收安排时开启例外。</p></header>
      <div class="payment-application-stepper__grid">
        <label><span>付款类型</span><t-radio-group
          :model-value="form.paymentType"
          @update:model-value="updatePaymentType"
        ><t-radio value="company_direct">公司直付</t-radio><t-radio value="handler_reimbursement">经办人垫付报回</t-radio></t-radio-group></label>
        <label><span>实际商户名称</span><t-input
          v-model="form.merchantName"
          placeholder="实际购买的商户"
          @change="!form.payeeDiffersFromMerchant && (form.payeeName = form.merchantName)"
        /></label>
        <label v-if="form.paymentType === 'handler_reimbursement'"><span>收款对象（已锁定）</span><t-input
          :value="detail.payment.handler.name"
          disabled
        /></label>
      </div>
      <div
        v-if="historicalMerchants.length"
        class="payment-application-stepper__suggestions"
      >
        <span>同项目历史商户（只复制名称）</span><t-button
          v-for="name in historicalMerchants"
          :key="name"
          size="small"
          variant="outline"
          @click="chooseMerchant(name)"
        >
          {{ name }}
        </t-button>
      </div>
      <template v-if="form.paymentType === 'company_direct'">
        <t-checkbox v-model="form.payeeDiffersFromMerchant">
          收款对象与商户不一致（例外）
        </t-checkbox>
        <div
          v-if="form.payeeDiffersFromMerchant"
          class="payment-application-stepper__grid"
        >
          <label><span>独立收款对象</span><t-input
            v-model="form.payeeName"
            placeholder="一张付款申请只能对应一个收款对象"
          /></label>
          <label><span>不一致说明</span><t-textarea
            v-model="form.merchantPayeeMismatchNote"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="例如：由商户指定个人或关联账户收款"
          /></label>
        </div>
      </template>
      <label><span>拟付款方式</span><t-checkbox-group
        v-model="form.paymentMethods"
        :options="paymentMethodOptions"
      /></label>
    </div>

    <div
      v-else-if="step === 1"
      class="payment-application-stepper__body"
    >
      <header><h3>填写付款材料</h3><p>只能选择采购批准材料；付款数量不得超过批准数量，数量和单价最多 2 位小数。</p></header>
      <article
        v-for="line in form.lines"
        :key="line.procurementLineId"
        class="payment-application-stepper__card"
      >
        <t-checkbox v-model="line.included">
          {{ line.materialName }}{{ line.specification ? ` · ${line.specification}` : "" }}（{{ line.unit }}，批准数量 {{ line.approvedQuantity }}）
        </t-checkbox>
        <div
          v-if="line.included"
          class="payment-application-stepper__grid"
        >
          <label><span>付款数量</span><t-input
            v-model="line.paymentQuantity"
            placeholder="最多 2 位小数"
          /></label>
          <label><span>含税/无票单价</span><t-input
            v-model="line.unitPrice"
            placeholder="最多 2 位小数"
          /></label>
          <label><span>预计票据</span><t-select
            v-model="line.expectedInvoiceCondition"
            :options="invoiceConditionOptions"
          /></label>
          <label v-if="line.expectedInvoiceCondition !== 'no_invoice'"><span>税率</span><t-select
            v-model="line.vatRateOptionId"
            :options="vatOptions.map((option) => ({ label: option.label, value: option.id }))"
            placeholder="选择税率"
          /></label>
        </div>
      </article>
      <div class="payment-application-stepper__amount">
        <span>付款申请合计（预览）</span><strong>{{ previewAmount }}</strong>
      </div>
    </div>

    <div
      v-else-if="step === 2"
      class="payment-application-stepper__body"
    >
      <header><h3>设置收款渠道与付款依据</h3><p>一个收款对象可登记多个渠道，但必须且只能有一个主渠道。</p></header>
      <article
        v-for="(channel, index) in form.channels"
        :key="index"
        class="payment-application-stepper__card"
      >
        <div class="payment-application-stepper__card-head">
          <strong>渠道 {{ index + 1 }}</strong><t-button
            size="small"
            variant="text"
            :disabled="form.channels.length === 1"
            @click="removeChannel(index)"
          >
            删除
          </t-button>
        </div>
        <div class="payment-application-stepper__grid">
          <label><span>方式</span><t-select
            v-model="channel.channelType"
            :options="paymentMethodOptions"
          /></label>
          <label><span>账户名称</span><t-input v-model="channel.accountName" /></label>
          <label><span>账号</span><t-input v-model="channel.accountNumber" /></label>
          <label><span>开户银行</span><t-input v-model="channel.bankName" /></label>
          <label><span>备注</span><t-input v-model="channel.note" /></label>
          <label><span>主渠道</span><t-radio-group
            :model-value="channel.isPrimary ? String(index) : ''"
            @update:model-value="setPrimary(index)"
          ><t-radio :value="String(index)">设为主渠道</t-radio></t-radio-group></label>
        </div>
      </article>
      <t-button
        variant="outline"
        @click="addChannel"
      >
        新增收款渠道
      </t-button>
      <section class="payment-application-stepper__evidence">
        <header><h3>付款依据（可选）</h3><p>可上传商家收据、报价单、商家发票或其他资料。</p></header>
        <label><span>资料类别</span><t-select
          v-model="form.attachmentCategory"
          :options="[{label:'商家收据',value:'merchant_receipt'},{label:'商家报价单',value:'merchant_quote'},{label:'商家发票',value:'merchant_invoice'},{label:'其他',value:'other'}]"
        /></label>
        <t-upload
          :model-value="attachmentFiles"
          theme="file-flow"
          multiple
          :auto-upload="false"
          :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
          :size-limit="{ size: SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitBytes, unit: 'B' }"
          @update:model-value="emit('update:attachmentFiles', $event)"
        />
        <label v-if="detail.evidenceFiles.length"><span>保留已有付款依据</span><t-checkbox-group
          :model-value="retainedAttachmentIds"
          @update:model-value="emit('update:retainedAttachmentIds', $event as string[])"
        ><t-checkbox
          v-for="file in detail.evidenceFiles"
          :key="file.fileId"
          :value="file.fileId"
          :disabled="file.status !== 'active'"
        >{{ file.fileName }} · {{ file.purpose }}</t-checkbox></t-checkbox-group></label>
      </section>
    </div>

    <div
      v-else
      class="payment-application-stepper__body"
    >
      <header><h3>核对后提交审批</h3><p>提交前会先保存当前完整草稿；只有保存成功才会创建付款审批。</p></header>
      <dl class="payment-application-stepper__review">
        <div><dt>项目</dt><dd>{{ detail.payment.project.code }} · {{ detail.payment.project.name }}</dd></div>
        <div><dt>采购申请</dt><dd>{{ detail.payment.procurement.code }}</dd></div>
        <div><dt>实际商户</dt><dd>{{ form.merchantName || "待填写" }}</dd></div>
        <div><dt>收款对象</dt><dd>{{ resolvedPayeeName || "待填写" }}</dd></div>
        <div><dt>付款材料</dt><dd>{{ selectedLines.length }} 项</dd></div>
        <div><dt>申请金额</dt><dd>{{ previewAmount }}</dd></div>
        <div><dt>收款渠道</dt><dd>{{ form.channels.length }} 个，{{ form.channels.filter((item) => item.isPrimary).length }} 个主渠道</dd></div>
        <div><dt>我方付款主体</dt><dd>{{ detail.payment.payerCompanyName ?? "待财务/综合部补全" }}</dd></div>
        <div><dt>首个审批节点</dt><dd>综合部主管</dd></div>
      </dl>
    </div>

    <t-alert
      v-if="error"
      theme="error"
      title="暂时无法保存"
      :message="error"
    />
    <footer class="payment-application-stepper__footer">
      <t-button
        variant="outline"
        :loading="busy"
        @click="emit('save', snapshot())"
      >
        保存并退出
      </t-button>
      <div>
        <t-button
          v-if="step > 0"
          variant="outline"
          :disabled="busy"
          @click="step = (step - 1) as 0 | 1 | 2"
        >
          上一步
        </t-button>
        <t-button
          v-if="step < 3"
          theme="primary"
          :disabled="busy"
          @click="step = (step + 1) as 1 | 2 | 3"
        >
          下一步
        </t-button>
        <t-button
          v-else
          theme="primary"
          :loading="busy"
          @click="emit('submit', snapshot())"
        >
          提交付款审批
        </t-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.payment-application-stepper,.payment-application-stepper__body,.payment-application-stepper__evidence{display:grid;gap:var(--jg-space-lg);min-width:0}.payment-application-stepper{padding:var(--jg-space-lg);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel);background:var(--jg-color-bg-surface)}.payment-application-stepper__header,.payment-application-stepper__footer,.payment-application-stepper__card-head,.payment-application-stepper__amount{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--jg-space-md)}.payment-application-stepper__header h2,.payment-application-stepper__header p,.payment-application-stepper__body h3,.payment-application-stepper__body p{margin:0}.payment-application-stepper__header p,.payment-application-stepper__body p{margin-top:var(--jg-space-xs);color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.payment-application-stepper__eyebrow{color:var(--jg-color-brand);font-size:var(--jg-font-size-meta);font-weight:var(--jg-font-weight-semibold)}.payment-application-stepper__steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--jg-space-sm);margin:0;padding:0;list-style:none}.payment-application-stepper__steps button{width:100%;padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-control);background:var(--jg-color-bg-muted);color:var(--jg-color-text-secondary);cursor:pointer}.payment-application-stepper__steps .is-active button{border-color:var(--jg-color-brand);background:var(--jg-color-brand-soft);color:var(--jg-color-brand);font-weight:var(--jg-font-weight-semibold)}.payment-application-stepper__steps .is-complete button{color:var(--jg-color-success)}.payment-application-stepper__grid,.payment-application-stepper__review{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--jg-space-md)}.payment-application-stepper label{display:grid;gap:var(--jg-space-xs)}.payment-application-stepper label>span,.payment-application-stepper__review dt,.payment-application-stepper__suggestions>span{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.payment-application-stepper__suggestions,.payment-application-stepper__footer>div{display:flex;flex-wrap:wrap;align-items:center;gap:var(--jg-space-sm)}.payment-application-stepper__card,.payment-application-stepper__review>div{display:grid;gap:var(--jg-space-md);padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel);background:var(--jg-color-bg-subtle)}.payment-application-stepper__review{margin:0}.payment-application-stepper__review dd{margin:0}.payment-application-stepper__amount{align-items:center;padding:var(--jg-space-md);border-radius:var(--jg-radius-panel);background:var(--jg-color-brand-soft)}
@media(max-width:720px){.payment-application-stepper__steps{grid-template-columns:1fr}.payment-application-stepper__header,.payment-application-stepper__footer{align-items:stretch;flex-direction:column}.payment-application-stepper__footer>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
