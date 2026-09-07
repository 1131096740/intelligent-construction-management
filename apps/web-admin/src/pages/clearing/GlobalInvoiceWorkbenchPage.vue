<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { MessagePlugin, type UploadFile } from "tdesign-vue-next";
import {
  allocateGlobalInvoice,
  createGlobalInvoice,
  createRedGlobalInvoice,
  createReissueGlobalInvoice,
  fetchGlobalInvoiceCapabilities,
  fetchGlobalInvoiceEvidenceRepairImpacts,
  fetchGlobalInvoices,
  resolveGlobalInvoiceEvidenceRepairImpact,
  reverseGlobalInvoiceAllocation,
  voidGlobalInvoice
} from "../../api/global-invoice.api";
import { fetchClearingCapabilities, fetchClearingCases, type ClearingCaseReadModel } from "../../api/clearing.api";
import { fetchActiveCompanyEntities } from "../../api/company-entity.api";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";

const submitting = ref(false);
const message = ref("");
const globalInvoiceCapabilities = ref({ create: false, correct: false });
const clearingCapabilities = ref<{ availableActions: string[] }>({ availableActions: [] });
const invoiceFiles = ref<UploadFile[]>([]);
const companyOptions = ref<Array<{ label: string; value: string }>>([]);
const globalInvoices = ref<Awaited<ReturnType<typeof fetchGlobalInvoices>>>([]);
const evidenceRepairImpacts = ref<Awaited<ReturnType<typeof fetchGlobalInvoiceEvidenceRepairImpacts>>>([]);
const clearingCases = ref<ClearingCaseReadModel[]>([]);
type SensitiveAction = "void" | "red" | "reissue" | "reverse" | "repair";
const confirmDialogVisible = ref(false);
const pendingSensitiveAction = ref<SensitiveAction | null>(null);
const invoiceForm = reactive({
  invoiceType: "vat_special", invoiceIdentityKind: "traditional", owningCompanyEntityId: "", direction: "inbound",
  sellerTaxId: "", buyerTaxId: "", invoiceCode: "", invoiceNumber: "",
  externalIdentifier: "", voucherType: "",
  issueDate: "", sellerName: "", buyerName: "", totalAmountCents: "",
  taxExclusiveAmountCents: "", taxAmountCents: "", taxRateSnapshot: "", fileId: ""
});
const allocationForm = reactive({ invoiceRecordId: "", clearingCaseId: "", clearingEventVersionId: "", amountCents: "", structuredReasonCode: "" });
const lifecycleForm = reactive({ invoiceRecordId: "", linkedInvoiceRecordId: "", reasonCode: "", blueAllocationId: "", amountCents: "" });
const reversalForm = reactive({ allocationId: "", amountCents: "", structuredReasonCode: "" });
const repairForm = reactive({ impactId: "", replacementInvoiceRecordId: "", reasonCode: "" });

function idempotencyKey() { return crypto.randomUUID(); }
function invoiceLabel(invoice: (typeof globalInvoices.value)[number]) {
  const identifier = invoice.invoiceNumber || invoice.externalIdentifier || "未显示编号";
  return `${invoice.sellerName} · ${identifier} · ${invoice.issueDate} · ${invoice.totalAmountCents} 分`;
}
const invoiceOptions = computed(() => globalInvoices.value.map((invoice) => ({ label: invoiceLabel(invoice), value: invoice.id })));
const clearingCaseOptions = computed(() => clearingCases.value.map((item) => ({ label: `${item.governedSubjectKey} · ${item.category} · ${item.status}`, value: item.id })));
const clearingVersionOptions = computed(() => {
  const clearingCase = clearingCases.value.find((item) => item.id === allocationForm.clearingCaseId);
  return (clearingCase?.events ?? []).flatMap((event) => event.versions)
    .filter((version) => Boolean(version.confirmation))
    .map((version) => ({ label: `第 ${version.versionNo} 版 · ${version.amountCents} 分 · ${version.evidenceLevel} 级证据`, value: version.id }));
});
const allocationOptions = computed(() => globalInvoices.value.flatMap((invoice) => invoice.allocations.filter((allocation) => !allocation.reversesAllocationId).map((allocation) => ({ label: `${invoiceLabel(invoice)} · 已分配 ${allocation.amountCents} 分`, value: allocation.id }))));
const replacementInvoiceOptions = computed(() => globalInvoices.value.filter((invoice) => invoice.status === "active" && ["global_clearing_invoice", "global_clearing_invoice_reissue"].includes(invoice.sourceBusinessType)).map((invoice) => ({ label: invoiceLabel(invoice), value: invoice.id })));
const evidenceRepairImpactOptions = computed(() => evidenceRepairImpacts.value.filter((impact) => !impact.resolution).map((impact) => ({ label: `${impact.invalidatedInvoice?.sellerName ?? "原发票"} · ${impact.invalidatedInvoice?.invoiceNumber ?? impact.invalidatedInvoice?.externalIdentifier ?? "未显示编号"} · 待修复 ${impact.invalidatedAmountCents} 分`, value: impact.id })));
const unresolvedImpactCount = computed(() => evidenceRepairImpacts.value.filter((impact) => !impact.resolution).length);
const resolvedImpactCount = computed(() => evidenceRepairImpacts.value.filter((impact) => Boolean(impact.resolution)).length);
const selectedAllocationInvoice = computed(() => globalInvoices.value.find((invoice) => invoice.id === allocationForm.invoiceRecordId));
const selectedLifecycleInvoice = computed(() => globalInvoices.value.find((invoice) => invoice.id === lifecycleForm.invoiceRecordId));
const selectedLinkedInvoice = computed(() => globalInvoices.value.find((invoice) => invoice.id === lifecycleForm.linkedInvoiceRecordId));
const selectedReversalInvoice = computed(() => {
  const allocation = globalInvoices.value.flatMap((invoice) => invoice.allocations).find((item) => item.id === reversalForm.allocationId);
  return globalInvoices.value.find((invoice) => invoice.id === allocation?.invoiceRecordId);
});
const selectedRepairImpact = computed(() => evidenceRepairImpacts.value.find((impact) => impact.id === repairForm.impactId));
const selectedReplacementInvoice = computed(() => globalInvoices.value.find((invoice) => invoice.id === repairForm.replacementInvoiceRecordId));
const confirmationTitle = computed(() => ({ void: "确认追加发票作废事实", red: "确认追加红字发票", reissue: "确认追加重开发票", reverse: "确认追加反向清分分配", repair: "确认解决发票证据待修复事项" }[pendingSensitiveAction.value ?? "void"]));
const confirmationMessage = computed(() => ({ void: "作废只追加失效事实，不会删除原发票或既有清分事实。", red: "红字将逐笔占用所选蓝字分配的剩余可反向额度。", reissue: "重开会追加一张新发票事实，原发票与完整时间链保持不变。", reverse: "反向分配只追加逆向事实，不会改写原清分分配。", repair: "解决动作只追加证据修复记录；部分解决不会清除其他待修复事项。" }[pendingSensitiveAction.value ?? "void"]));
function requiredSelection<T>(value: T | undefined | null, messageText: string): T { if (!value) throw new Error(messageText); return value; }
async function invoicePayload(expectedRevision: number) {
  const file = invoiceFiles.value[0]?.raw;
  if (!(file instanceof File)) throw new Error("请先选择发票附件");
  const uploaded = await uploadInvoiceFileWithCapability(file, file.name);
  return { ...invoiceForm, fileId: uploaded.id, expectedRevision, idempotencyKey: idempotencyKey() };
}
async function uploadInvoiceFileWithCapability(file: File, fileName: string) {
  const capability = await fetchGlobalInvoiceCapabilities();
  const operationAllowed = capability.create;
  if (!operationAllowed) throw new Error("当前账号无权上传全局发票附件");
  return uploadPrivateFile(file, fileName);
}
async function refreshSelections() {
  const [companies, invoices, cases, impacts] = await Promise.all([fetchActiveCompanyEntities(), fetchGlobalInvoices(), fetchClearingCases(), fetchGlobalInvoiceEvidenceRepairImpacts()]);
  companyOptions.value = companies.map((company) => ({ label: company.name, value: company.id }));
  globalInvoices.value = invoices;
  clearingCases.value = cases;
  evidenceRepairImpacts.value = impacts;
}
async function submit(label: string, work: () => Promise<{ id: string }>) {
  submitting.value = true;
  message.value = "";
  try {
    await work();
    await refreshSelections();
    message.value = `${label}已追加，可在下方业务选择中继续处理。`;
    await MessagePlugin.success(message.value);
  } catch (error) {
    const detail = formatUnknownApiError(error, `${label}失败`);
    if (detail.includes("发票版本已变化")) {
      await refreshSelections().catch(() => undefined);
      message.value = "发票版本已变化，请刷新后重试";
    } else {
      message.value = detail;
    }
    await MessagePlugin.error(message.value);
  } finally { submitting.value = false; }
}
function create() { return submit("全局发票", async () => createGlobalInvoiceWithCapability(await invoicePayload(0))); }
function allocate() {
  const selected = requiredSelection(selectedAllocationInvoice.value, "请选择需要分配的全局发票");
  return submit("清分发票分配", () => allocateGlobalInvoiceWithCapability({ ...allocationForm, structuredReasonCode: allocationForm.structuredReasonCode || undefined, expectedRevision: selected.revision, idempotencyKey: idempotencyKey() }));
}
function requestSensitiveAction(action: SensitiveAction) {
  pendingSensitiveAction.value = action;
  confirmDialogVisible.value = true;
}
async function confirmSensitiveAction() {
  const action = pendingSensitiveAction.value;
  if (!action) return;
  confirmDialogVisible.value = false;
  pendingSensitiveAction.value = null;
  if (action === "void") await performVoidInvoice();
  if (action === "red") await performRedInvoice();
  if (action === "reissue") await performReissueInvoice();
  if (action === "reverse") await performReverseAllocation();
  if (action === "repair") await performEvidenceRepair();
}
function performVoidInvoice() {
  const selected = requiredSelection(selectedLifecycleInvoice.value, "请选择需要作废的全局发票");
  return submit("发票作废事实", () => voidGlobalInvoiceWithCapability(selected.id, { reasonCode: lifecycleForm.reasonCode, expectedRevision: selected.revision, idempotencyKey: idempotencyKey(), confirmVoid: true }));
}
function performRedInvoice() {
  const selected = requiredSelection(selectedLinkedInvoice.value, "请选择对应蓝字发票");
  return submit("红字发票", async () => createRedGlobalInvoiceWithCapability({ ...(await invoicePayload(selected.revision)), blueInvoiceRecordId: selected.id, reasonCode: lifecycleForm.reasonCode, confirmRed: true, blueAllocationReferences: [{ blueInvoiceAllocationId: lifecycleForm.blueAllocationId, amountCents: lifecycleForm.amountCents }] }));
}
function performReissueInvoice() {
  const selected = requiredSelection(selectedLinkedInvoice.value, "请选择需要重开的原发票");
  return submit("重开发票", async () => createReissueGlobalInvoiceWithCapability({ ...(await invoicePayload(selected.revision)), originalInvoiceRecordId: selected.id, reasonCode: lifecycleForm.reasonCode, confirmReissue: true }));
}
function performReverseAllocation() {
  const selected = requiredSelection(selectedReversalInvoice.value, "请选择需要反向的清分发票分配");
  return submit("反向清分分配", () => reverseGlobalInvoiceAllocationWithCapability(reversalForm.allocationId, {
    amountCents: reversalForm.amountCents,
    structuredReasonCode: reversalForm.structuredReasonCode,
    expectedRevision: selected.revision,
    idempotencyKey: idempotencyKey(),
    confirmReversal: true
  }));
}
async function performEvidenceRepair() {
  const selected = requiredSelection(selectedRepairImpact.value, "请选择待修复事项");
  const replacement = requiredSelection(selectedReplacementInvoice.value, "请选择替代蓝字或重开发票");
  const invalidatedInvoice = requiredSelection(selected.invalidatedInvoice, "原发票状态不完整，请刷新后重试");
  const globalCapability = await fetchGlobalInvoiceCapabilities();
  if (!globalCapability.correct) throw new Error("当前账号无权解决发票证据待修复事项");
  return submit("发票证据修复", () => resolveGlobalInvoiceEvidenceRepairImpactWithCapability(selected.id, {
    replacementInvoiceRecordId: replacement.id,
    replacementFileId: replacement.fileId,
    reasonCode: repairForm.reasonCode,
    expectedRevision: invalidatedInvoice.revision,
    idempotencyKey: idempotencyKey(),
    confirmRepair: true
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
async function resolveGlobalInvoiceEvidenceRepairImpactWithCapability(impactId: string, body: Parameters<typeof resolveGlobalInvoiceEvidenceRepairImpact>[1]) {
  const capability = await fetchClearingCapabilities();
  const operationAllowed = capability.availableActions.includes("clearing.confirm");
  if (!operationAllowed) throw new Error("当前账号无权解决发票证据待修复事项");
  return await resolveGlobalInvoiceEvidenceRepairImpact(impactId, body);
}
onMounted(async () => {
  try {
    const [global, clearing] = await Promise.all([fetchGlobalInvoiceCapabilities(), fetchClearingCapabilities()]);
    globalInvoiceCapabilities.value = global;
    clearingCapabilities.value = clearing;
    await refreshSelections();
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
    <section class="status-strip" aria-label="发票证据修复状态"><t-tag theme="warning">待修复 {{ unresolvedImpactCount }} 项</t-tag><t-tag theme="success">已解决 {{ resolvedImpactCount }} 项</t-tag><span>部分解决不会清除其他待修复事项。</span></section>
    <t-card title="登记全局发票" class="panel">
      <t-form label-align="top" @submit.prevent="create"><div class="form-grid">
        <t-select v-model="invoiceForm.invoiceType" label="发票类型" :options="[{label:'增值税专用发票',value:'vat_special'},{label:'增值税普通发票',value:'vat_general'},{label:'其他受控凭证',value:'other'}]" />
        <t-select v-model="invoiceForm.invoiceIdentityKind" label="法定身份类型" :options="[{label:'传统发票（代码+号码）',value:'traditional'},{label:'数电票（20位号码）',value:'digital'},{label:'其他受控凭证',value:'other'}]" />
        <t-select v-model="invoiceForm.direction" label="方向" :options="[{label:'进项',value:'inbound'},{label:'销项',value:'outbound'}]" />
        <t-select v-model="invoiceForm.owningCompanyEntityId" label="我方公司主体" :options="companyOptions" filterable />
        <t-input v-model="invoiceForm.issueDate" label="开票日期（YYYY-MM-DD）" />
        <t-input v-model="invoiceForm.sellerName" label="销售方名称" /><t-input v-model="invoiceForm.sellerTaxId" label="销售方税号" />
        <t-input v-model="invoiceForm.buyerName" label="购买方名称" /><t-input v-model="invoiceForm.buyerTaxId" label="购买方税号" />
        <t-input v-model="invoiceForm.invoiceCode" label="发票代码" /><t-input v-model="invoiceForm.invoiceNumber" label="发票号码" />
        <t-input v-model="invoiceForm.externalIdentifier" label="外部凭证编号（保留前导零）" />
        <t-input v-if="invoiceForm.invoiceIdentityKind === 'other'" v-model="invoiceForm.voucherType" label="受控凭证类型" />
        <t-input v-model="invoiceForm.taxExclusiveAmountCents" label="不含税金额（分）" /><t-input v-model="invoiceForm.taxAmountCents" label="税额（分）" />
        <t-input v-model="invoiceForm.totalAmountCents" label="价税合计（分）" />
        <t-input v-model="invoiceForm.taxRateSnapshot" label="票面税率快照（固定六位小数）" placeholder="例如 13.000000" />
        <t-upload v-model="invoiceFiles" theme="file-flow" :auto-upload="false" :multiple="false" accept=".pdf,.jpg,.jpeg,.png" />
      </div><t-button theme="primary" type="submit" :loading="submitting" :disabled="!globalInvoiceCapabilities.create">追加全局发票</t-button></t-form>
    </t-card>
    <t-card title="绑定清分版本" class="panel"><t-form label-align="top" @submit.prevent="allocate"><div class="form-grid">
      <t-select v-model="allocationForm.invoiceRecordId" label="全局发票" :options="invoiceOptions" filterable /><t-select v-model="allocationForm.clearingCaseId" label="清分事项" :options="clearingCaseOptions" filterable />
      <t-select v-model="allocationForm.clearingEventVersionId" label="已确认清分版本" :options="clearingVersionOptions" /><t-input v-model="allocationForm.amountCents" label="分配金额（分）" />
      <t-input v-model="allocationForm.structuredReasonCode" label="金额差异结构化原因（有差异时必填）" />
    </div><t-button theme="primary" type="submit" :loading="submitting" :disabled="!clearingCapabilities.availableActions.includes('clearing.confirm')">追加清分分配</t-button></t-form></t-card>
    <t-card title="反向清分分配" class="panel"><t-form label-align="top" @submit.prevent="requestSensitiveAction('reverse')"><div class="form-grid">
      <t-select v-model="reversalForm.allocationId" label="原清分分配" :options="allocationOptions" filterable /><t-input v-model="reversalForm.amountCents" label="反向金额（分）" />
      <t-input v-model="reversalForm.structuredReasonCode" label="结构化更正原因" />
    </div><t-button variant="outline" theme="danger" type="button" :loading="submitting" :disabled="!clearingCapabilities.availableActions.includes('clearing.confirm')" @click="requestSensitiveAction('reverse')">追加反向分配</t-button></t-form></t-card>
    <t-card title="追加作废、红字或重开" class="panel"><t-form label-align="top"><div class="form-grid">
      <t-select v-model="lifecycleForm.invoiceRecordId" label="作废目标发票" :options="invoiceOptions" filterable /><t-select v-model="lifecycleForm.linkedInvoiceRecordId" label="蓝字/原发票" :options="invoiceOptions" filterable />
      <t-input v-model="lifecycleForm.reasonCode" label="结构化原因" /><t-select v-model="lifecycleForm.blueAllocationId" label="蓝字分配（红字必填）" :options="allocationOptions" filterable />
      <t-input v-model="lifecycleForm.amountCents" label="红字引用金额（分）" />
    </div><div class="actions"><t-button type="button" variant="outline" theme="danger" :loading="submitting" :disabled="!globalInvoiceCapabilities.correct" @click="requestSensitiveAction('void')">追加作废</t-button><t-button type="button" variant="outline" :loading="submitting" :disabled="!globalInvoiceCapabilities.correct" @click="requestSensitiveAction('red')">追加红字</t-button><t-button type="button" variant="outline" :loading="submitting" :disabled="!globalInvoiceCapabilities.correct" @click="requestSensitiveAction('reissue')">追加重开</t-button></div></t-form></t-card>
    <t-card title="发票证据待修复" class="panel"><t-alert theme="warning" message="只能用仍有效、公司与方向同一公司主体的发票方向且已绑定附件的蓝字或重开发票逐项解决；原清分、案件和确认版本保持不变。" /><t-form label-align="top" @submit.prevent="requestSensitiveAction('repair')"><div class="form-grid">
      <t-select v-model="repairForm.impactId" label="待修复事项" :options="evidenceRepairImpactOptions" filterable /><t-select v-model="repairForm.replacementInvoiceRecordId" label="替代蓝字或重开发票" :options="replacementInvoiceOptions" filterable /><t-input v-model="repairForm.reasonCode" label="证据修复原因" />
    </div><t-button type="button" theme="primary" :loading="submitting" :disabled="!globalInvoiceCapabilities.correct || !clearingCapabilities.availableActions.includes('clearing.confirm')" @click="requestSensitiveAction('repair')">解决所选待修复事项</t-button></t-form><t-empty v-if="evidenceRepairImpacts.length === 0" description="暂无发票证据待修复记录" /></t-card>
    <t-dialog v-model:visible="confirmDialogVisible" :header="confirmationTitle" :confirm-btn="{ content: '确认追加', loading: submitting, theme: 'danger' }" cancel-btn="返回检查" @confirm="confirmSensitiveAction"><t-alert theme="warning" title="请再次核对" :message="confirmationMessage" /></t-dialog>
  </main>
</template>

<style scoped>
.global-invoice-workbench { display:grid; gap:var(--jg-space-section); max-width:var(--jg-layout-page-max-width); margin:0 auto; padding:var(--jg-layout-content-padding); }.panel { margin-top:0; }.form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(var(--jg-layout-form-field-min-width-wide),1fr)); gap:var(--jg-space-sm); margin-bottom:var(--jg-space-md); }.actions,.status-strip { display:flex; align-items:center; gap:var(--jg-space-sm); flex-wrap:wrap; }.status-strip { color:var(--jg-color-text-secondary); }.result-message { color:var(--jg-color-success); }
</style>
