<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import {
  allocateGlobalInvoice,
  createGlobalInvoice,
  createRedGlobalInvoice,
  createReissueGlobalInvoice,
  fetchGlobalInvoiceCapabilities,
  reverseGlobalInvoiceAllocation,
  voidGlobalInvoice
} from "../../api/global-invoice.api";
import { fetchClearingCapabilities } from "../../api/clearing.api";
import { formatUnknownApiError } from "../../api/error-message";

const submitting = ref(false);
const message = ref("");
const globalInvoiceCapabilities = ref({ create: false, correct: false });
const clearingCapabilities = ref<{ availableActions: string[] }>({ availableActions: [] });
const invoiceForm = reactive({
  invoiceType: "vat_special", invoiceIdentityKind: "traditional", owningCompanyEntityId: "", direction: "inbound",
  sellerTaxId: "", buyerTaxId: "", invoiceCode: "", invoiceNumber: "",
  externalIdentifier: "", voucherType: "",
  issueDate: "", sellerName: "", buyerName: "", totalAmountCents: "",
  taxExclusiveAmountCents: "", taxAmountCents: "", fileId: ""
});
const allocationForm = reactive({ invoiceRecordId: "", clearingCaseId: "", clearingEventVersionId: "", amountCents: "", structuredReasonCode: "" });
const lifecycleForm = reactive({ invoiceRecordId: "", linkedInvoiceRecordId: "", reasonCode: "", blueAllocationId: "", amountCents: "" });
const reversalForm = reactive({ allocationId: "", amountCents: "", structuredReasonCode: "" });

function idempotencyKey() { return crypto.randomUUID(); }
function invoicePayload() { return { ...invoiceForm, idempotencyKey: idempotencyKey() }; }
async function submit(label: string, work: () => Promise<{ id: string }>) {
  submitting.value = true;
  message.value = "";
  try {
    const result = await work();
    message.value = `${label}已追加，编号：${result.id}`;
    MessagePlugin.success(message.value);
  } catch (error) {
    message.value = formatUnknownApiError(error, `${label}失败`);
    MessagePlugin.error(message.value);
  } finally { submitting.value = false; }
}
function create() { return submit("全局发票", () => createGlobalInvoiceWithCapability(invoicePayload())); }
function allocate() {
  return submit("清分发票分配", () => allocateGlobalInvoiceWithCapability({ ...allocationForm, structuredReasonCode: allocationForm.structuredReasonCode || undefined, idempotencyKey: idempotencyKey() }));
}
function voidInvoice() { return submit("发票作废事实", () => voidGlobalInvoiceWithCapability(lifecycleForm.invoiceRecordId, { reasonCode: lifecycleForm.reasonCode, idempotencyKey: idempotencyKey() })); }
function redInvoice() {
  return submit("红字发票", () => createRedGlobalInvoiceWithCapability({ ...invoicePayload(), blueInvoiceRecordId: lifecycleForm.linkedInvoiceRecordId, reasonCode: lifecycleForm.reasonCode, blueAllocationReferences: [{ blueInvoiceAllocationId: lifecycleForm.blueAllocationId, amountCents: lifecycleForm.amountCents }] }));
}
function reissueInvoice() {
  return submit("重开发票", () => createReissueGlobalInvoiceWithCapability({ ...invoicePayload(), originalInvoiceRecordId: lifecycleForm.linkedInvoiceRecordId, reasonCode: lifecycleForm.reasonCode }));
}
function reverseAllocation() {
  return submit("反向清分分配", () => reverseGlobalInvoiceAllocationWithCapability(reversalForm.allocationId, {
    amountCents: reversalForm.amountCents,
    structuredReasonCode: reversalForm.structuredReasonCode,
    idempotencyKey: idempotencyKey()
  }));
}
async function createGlobalInvoiceWithCapability(body: Parameters<typeof createGlobalInvoice>[0]) {
  const capability = await fetchGlobalInvoiceCapabilities();
  const operationAllowed = capability.create;
  if (!operationAllowed) throw new Error("当前账号无权登记全局发票");
  return await createGlobalInvoice(body);
}
async function voidGlobalInvoiceWithCapability(invoiceRecordId: string, body: Parameters<typeof voidGlobalInvoice>[1]) {
  const capability = await fetchGlobalInvoiceCapabilities();
  const operationAllowed = capability.correct;
  if (!operationAllowed) throw new Error("当前账号无权追加发票作废");
  return await voidGlobalInvoice(invoiceRecordId, body);
}
async function createRedGlobalInvoiceWithCapability(body: Parameters<typeof createRedGlobalInvoice>[0]) {
  const capability = await fetchGlobalInvoiceCapabilities();
  const operationAllowed = capability.correct;
  if (!operationAllowed) throw new Error("当前账号无权追加红字发票");
  return await createRedGlobalInvoice(body);
}
async function createReissueGlobalInvoiceWithCapability(body: Parameters<typeof createReissueGlobalInvoice>[0]) {
  const capability = await fetchGlobalInvoiceCapabilities();
  const operationAllowed = capability.correct;
  if (!operationAllowed) throw new Error("当前账号无权重开发票");
  return await createReissueGlobalInvoice(body);
}
async function allocateGlobalInvoiceWithCapability(body: Parameters<typeof allocateGlobalInvoice>[0]) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.confirm");
  if (!operationAllowed) throw new Error("当前账号无权追加清分分配");
  return allocateGlobalInvoice(body);
}
async function reverseGlobalInvoiceAllocationWithCapability(allocationId: string, body: Parameters<typeof reverseGlobalInvoiceAllocation>[1]) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.confirm");
  if (!operationAllowed) throw new Error("当前账号无权反向清分分配");
  return reverseGlobalInvoiceAllocation(allocationId, body);
}
onMounted(async () => {
  try {
    const [global, clearing] = await Promise.all([fetchGlobalInvoiceCapabilities(), fetchClearingCapabilities()]);
    globalInvoiceCapabilities.value = global;
    clearingCapabilities.value = clearing;
  } catch (error) {
    message.value = formatUnknownApiError(error, "加载操作权限失败");
  }
});
</script>

<template>
  <main class="global-invoice-workbench">
    <header><h1>全局发票与清分分配</h1><p>法定发票头不绑定项目；项目、清分案件和版本仅在不可变分配事实中引用。所有更正均追加，不覆盖既有事实。</p></header>
    <t-alert theme="info" title="证据与经济事实隔离" message="登记或分配发票不会自动生成成本、应付或资金影响。金额差异必须填写结构化原因，并由服务端校验 B 级双人确认。" />
    <p v-if="message" class="result-message">{{ message }}</p>
    <t-card title="登记全局发票" class="panel">
      <t-form label-align="top" @submit.prevent="create"><div class="form-grid">
        <t-select v-model="invoiceForm.invoiceType" label="发票类型" :options="[{label:'增值税专用发票',value:'vat_special'},{label:'增值税普通发票',value:'vat_general'},{label:'其他受控凭证',value:'other'}]" />
        <t-select v-model="invoiceForm.invoiceIdentityKind" label="法定身份类型" :options="[{label:'传统发票（代码+号码）',value:'traditional'},{label:'数电票（20位号码）',value:'digital'},{label:'其他受控凭证',value:'other'}]" />
        <t-select v-model="invoiceForm.direction" label="方向" :options="[{label:'进项',value:'inbound'},{label:'销项',value:'outbound'}]" />
        <t-input v-model="invoiceForm.owningCompanyEntityId" label="我方公司主体编号" />
        <t-input v-model="invoiceForm.issueDate" label="开票日期（YYYY-MM-DD）" />
        <t-input v-model="invoiceForm.sellerName" label="销售方名称" /><t-input v-model="invoiceForm.sellerTaxId" label="销售方税号" />
        <t-input v-model="invoiceForm.buyerName" label="购买方名称" /><t-input v-model="invoiceForm.buyerTaxId" label="购买方税号" />
        <t-input v-model="invoiceForm.invoiceCode" label="发票代码" /><t-input v-model="invoiceForm.invoiceNumber" label="发票号码" />
        <t-input v-model="invoiceForm.externalIdentifier" label="外部凭证编号（保留前导零）" />
        <t-input v-if="invoiceForm.invoiceIdentityKind === 'other'" v-model="invoiceForm.voucherType" label="受控凭证类型" />
        <t-input v-model="invoiceForm.taxExclusiveAmountCents" label="不含税金额（分）" /><t-input v-model="invoiceForm.taxAmountCents" label="税额（分）" />
        <t-input v-model="invoiceForm.totalAmountCents" label="价税合计（分）" /><t-input v-model="invoiceForm.fileId" label="私有附件编号" />
      </div><t-button theme="primary" type="submit" :loading="submitting">追加全局发票</t-button></t-form>
    </t-card>
    <t-card title="绑定清分版本" class="panel"><t-form label-align="top" @submit.prevent="allocate"><div class="form-grid">
      <t-input v-model="allocationForm.invoiceRecordId" label="全局发票编号" /><t-input v-model="allocationForm.clearingCaseId" label="清分案件编号" />
      <t-input v-model="allocationForm.clearingEventVersionId" label="已确认清分版本编号" /><t-input v-model="allocationForm.amountCents" label="分配金额（分）" />
      <t-input v-model="allocationForm.structuredReasonCode" label="金额差异结构化原因（有差异时必填）" />
    </div><t-button theme="primary" type="submit" :loading="submitting">追加清分分配</t-button></t-form></t-card>
    <t-card title="反向清分分配" class="panel"><t-form label-align="top" @submit.prevent="reverseAllocation"><div class="form-grid">
      <t-input v-model="reversalForm.allocationId" label="原清分分配编号" /><t-input v-model="reversalForm.amountCents" label="反向金额（分）" />
      <t-input v-model="reversalForm.structuredReasonCode" label="结构化更正原因" />
    </div><t-button variant="outline" theme="danger" type="submit" :loading="submitting">追加反向分配</t-button></t-form></t-card>
    <t-card title="追加作废、红字或重开" class="panel"><t-form label-align="top"><div class="form-grid">
      <t-input v-model="lifecycleForm.invoiceRecordId" label="作废目标发票编号" /><t-input v-model="lifecycleForm.linkedInvoiceRecordId" label="蓝字/原发票编号" />
      <t-input v-model="lifecycleForm.reasonCode" label="结构化原因" /><t-input v-model="lifecycleForm.blueAllocationId" label="蓝字分配编号（红字必填）" />
      <t-input v-model="lifecycleForm.amountCents" label="红字引用金额（分）" />
    </div><div class="actions"><t-button variant="outline" theme="danger" :loading="submitting" @click="voidInvoice">追加作废</t-button><t-button variant="outline" :loading="submitting" @click="redInvoice">追加红字</t-button><t-button variant="outline" :loading="submitting" @click="reissueInvoice">追加重开</t-button></div></t-form></t-card>
  </main>
</template>

<style scoped>
.global-invoice-workbench { display:grid; gap:16px; max-width:1200px; margin:0 auto; padding:24px; }.panel { margin-top:0; }.form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-bottom:16px; }.actions { display:flex; gap:12px; flex-wrap:wrap; }.result-message { color:var(--td-success-color-6); }
</style>
