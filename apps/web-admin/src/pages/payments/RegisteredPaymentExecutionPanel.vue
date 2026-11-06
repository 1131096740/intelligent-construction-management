<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { UploadFile } from "tdesign-vue-next";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import { chinaDateOnly, requiredPastChinaDate } from "@jiangkong/shared-domain";
import { useAuthStore } from "../../auth/auth.store";
import { fetchRegisteredPaymentOptions, fetchRegisteredPaymentWorkItems, fetchRecordedPaymentItems, recordRegisteredPayment, fetchRegisteredPaymentResult, supplementRegisteredPaymentVoucher, downloadRegisteredPaymentVoucher, RegisteredPaymentApiError, type RegisteredPaymentWorkItem, type RegisteredPaymentOptions, type RecordedPaymentItem, type RegisteredPaymentCommand, type RegisteredPaymentResult } from "../../api/registered-payment-execution.api";
import { fetchFundAccounts, type FundAccountsReadModel } from "../../api/fund-account.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { makePendingPaymentAttempt, readPendingPaymentAttempt, writePendingPaymentAttempt, clearPendingPaymentAttemptIfSameKey, type PendingPaymentDraft, type PendingPaymentAttempt } from "./registered-payment-pending-attempt";
interface OutdatedSourceDraft { sourceBatchId:string;accountName:string;sourceName:string;projectName:string;amountYuan:string }
const props = defineProps<{ paymentReference?: string }>();
const emit = defineEmits<{recorded:[paymentId:string,paymentReference:string]}>();
const auth = useAuthStore();
const route = useRoute();
const visible = computed(() => (auth.user?.globalRoleKeys ?? []).some(role => ["finance_staff","finance_director","comprehensive_director"].includes(role)));
const items = ref<RegisteredPaymentWorkItem[]>([]);
const recorded = ref<RecordedPaymentItem[]>([]);
const selected = ref<RegisteredPaymentOptions | null>(null);
const registrationPermission = ref<RegisteredPaymentOptions | null>(null);
const voucherPermission = ref<RegisteredPaymentResult | null>(null);
const registrationPermissionOwner = ref("");
const registrationPermissionRoute = ref("");
const voucherPermissionOwner = ref("");
const voucherPermissionRoute = ref("");
let registrationReadSequence = 0;
let voucherReadSequence = 0;
const registrationAllowed = computed(() => registrationPermission.value?.canRegisterPayment === true && registrationPermissionOwner.value === auth.user?.id && registrationPermissionRoute.value === route.fullPath && registrationPermission.value.paymentId === selected.value?.paymentId);
const funds = ref<FundAccountsReadModel>({accounts:[],projects:[],notice:""});
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const resultMessage = ref("");
const uncertain = ref(false);
const confirmation = ref(false);
const frozenCommand = ref<RegisteredPaymentCommand | null>(null);
const commandPaymentId = ref("");
const commandUserId = ref("");
const preparedDraft = ref<PendingPaymentDraft | null>(null);
const pendingAttempt = ref<PendingPaymentAttempt | null>(null);
const storageNotice = ref("");
const completed = ref(false);
const confirmationAccountName = ref("");
const confirmationFundBasis = ref<{balanceYuan:string|null;asOfDate:string|null} | null>(null);
const basisReadRequired = ref(false);
const basisReadNotice = ref("");
const outdatedSourceDrafts = ref<OutdatedSourceDraft[]>([]);
const voucher = ref<RecordedPaymentItem | null>(null);
const voucherFiles = ref<UploadFile[]>([]);
const voucherUploadKey = ref("");
const voucherFileId = ref<string | null>(null);
const voucherProgressExecutionId = ref("");
const voucherBusy = ref(false);
const voucherError = ref("");
const selectedVoucherFile = computed(() => voucherFiles.value[0]?.raw);
const voucherOperationAllowed = computed(() => voucherPermission.value?.canSupplementVoucher === true && voucherPermission.value.status === "recorded" && voucherPermissionOwner.value === auth.user?.id && voucherPermissionRoute.value === route.fullPath && voucherPermission.value.execution?.executionId === voucher.value?.executionId && voucherPermission.value.execution?.paymentId === voucher.value?.paymentId && voucherProgressExecutionId.value === voucher.value?.executionId);
const registrationActorMatches = computed(() => auth.user?.id === commandUserId.value);
const registrationCommandMatches = computed(() => registrationPermission.value?.paymentId === commandPaymentId.value && registrationPermission.value?.expectedPaymentUpdatedAt === frozenCommand.value?.expectedPaymentUpdatedAt);
watch(() => [auth.user?.id, (auth.user?.globalRoleKeys ?? []).join("|"), route.fullPath], () => {
 registrationReadSequence += 1; voucherReadSequence += 1;
 registrationPermission.value = null; voucherPermission.value = null;
}, { flush: "sync" });
const downloadBusyId = ref("");
const resultDetail = ref<RegisteredPaymentResult | null>(null);
const resultDetailVisible = ref(false);
const resultDetailLoading = ref(false);
const resultDetailTitle = ref("");
const resultDetailError = ref("");
const uploadSizeLimit = {size:CORE_ARCHIVE_UPLOAD_POLICY.limitBytes,unit:"B" as const,message:`文件大小不能超过 ${CORE_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ","")}`};
const form = reactive({amountYuan:"",paidAt:chinaDateOnly(),scopeKey:"",treatment:"",reason:"",evidence:"",password:"",idempotencyKey:"",historyTreatment:"",historyReason:"",historyEvidence:""});
const allocations = reactive<Record<string,string>>({});
const shownItems = computed(() => items.value.filter(item => !props.paymentReference || item.paymentId === props.paymentReference || item.code === props.paymentReference));
const shownRecorded = computed(() => recorded.value.filter(item => !props.paymentReference || item.paymentId === props.paymentReference || item.code === props.paymentReference));
const account = computed(() => funds.value.accounts.find(item=>item.scopeKey === form.scopeKey));
const accountOption = computed(() => selected.value?.accounts.find(item=>item.scopeKey === form.scopeKey));
const locked = computed(() => saving.value || uncertain.value || completed.value);
const accountOptions = computed(() => (selected.value?.accounts ?? []).map(item=>({value:item.scopeKey,label:item.name,disabled:!item.eligible})));
const projectLabel = (source: {projectStatus:string;projectId:string|null}) => source.projectStatus === "project" ? funds.value.projects.find(project=>project.id === source.projectId)?.name ?? "原登记项目" : source.projectStatus === "company_daily" ? "公司日常资金" : "项目归属待核对";
// Transport recovery never restores operation permission or credentials.
function clearConfirmedPointer() {
 const pointer = pendingAttempt.value;
 pendingAttempt.value = null;
 storageNotice.value = clearPendingPaymentAttemptIfSameKey(pointer,() => sessionStorage,storageNotice.value);
}
function restorePendingAttempt(): boolean {
 const userId = auth.user?.id;
 if (!userId) return false;
 const recovered = readPendingPaymentAttempt(userId,() => sessionStorage);
 if (recovered.kind === "missing") return false;
 if (recovered.kind === "unreadable") {
  storageNotice.value = recovered.notice;
  if (recovered.blocksNewAttempt) uncertain.value = true;
  return false;
 }
 const pointer = recovered.attempt;
 const stored = pointer.command;
 const draft = pointer.draft;
 pendingAttempt.value = pointer; preparedDraft.value = draft;
 commandUserId.value = userId; commandPaymentId.value = pointer.paymentId;
 frozenCommand.value = {...stored,confirmationPassword:""}; confirmationAccountName.value = draft.accountName;
 Object.assign(form,{amountYuan:draft.amountYuan,paidAt:draft.paidAt,scopeKey:draft.scopeKey,treatment:draft.treatment,reason:draft.reason,evidence:draft.evidence,password:"",idempotencyKey:stored.idempotencyKey,historyTreatment:stored.contractHistoryConfirmation?.treatment ?? "",historyReason:stored.contractHistoryConfirmation?.reason ?? "",historyEvidence:stored.contractHistoryConfirmation?.evidence ?? ""});
 for (const key of Object.keys(allocations)) delete allocations[key];
 for (const line of draft.allocations) allocations[line.sourceBatchId] = line.amountYuan;
 uncertain.value = true; completed.value = false;
 resultMessage.value = "此前登记结果待确认，正在查询原请求；不会自动重新提交。";
 return true;
}
function outcomeUnconfirmed(failure: unknown) {
 return !(failure instanceof RegisteredPaymentApiError) || failure.code === "PAYMENT_RESULT_UNCONFIRMED" || failure.resultStatus === "unconfirmed" || ![400,409].includes(failure.status);
}
async function load() {
 loading.value = true; error.value = "";
 try { const [work,history] = await Promise.all([fetchRegisteredPaymentWorkItems(),fetchRecordedPaymentItems()]); items.value = work.items; recorded.value = history.items; }
 catch (failure) { error.value = formatUnknownApiError(failure,"付款登记记录读取失败，请重新读取"); }
 finally { loading.value = false; }
}
async function open(item: RegisteredPaymentWorkItem) {
 if (saving.value || uncertain.value) return;
 const readSequence = ++registrationReadSequence;
 const owner = auth.user?.id;
 const routeOwner = route.fullPath;
 registrationPermission.value = null;
 loading.value = true; error.value = "";
 try {
  const options = await fetchRegisteredPaymentOptions(item.paymentId);
  const balances = await fetchFundAccounts();
  if (readSequence !== registrationReadSequence || owner !== auth.user?.id || routeOwner !== route.fullPath) return;
  if (!owner || options.paymentId !== item.paymentId) throw new Error("实付登记许可与当前申请不一致，请重新读取原单资料");
  registrationPermissionOwner.value = owner; registrationPermissionRoute.value = routeOwner;
  registrationPermission.value = options;
  selected.value = structuredClone(options); funds.value = balances; completed.value = false; frozenCommand.value = null; resultMessage.value = "";
  basisReadRequired.value = false; basisReadNotice.value = ""; outdatedSourceDrafts.value = []; confirmationFundBasis.value = null;
  Object.assign(form,{amountYuan:"",paidAt:chinaDateOnly(),scopeKey:"",treatment:"",reason:"",evidence:"",password:"",idempotencyKey:crypto.randomUUID(),historyTreatment:"",historyReason:"",historyEvidence:""});
  for (const key of Object.keys(allocations)) delete allocations[key];
 } catch (failure) { error.value = formatUnknownApiError(failure,"实付登记资料读取失败，原填写已保留"); }
 finally { loading.value = false; }
}
async function reReadFundingBasis() {
 const paymentId = selected.value?.paymentId;
 if (!paymentId || loading.value || locked.value) return;
 const readSequence = ++registrationReadSequence;
 const owner = auth.user?.id;
 const routeOwner = route.fullPath;
 registrationPermission.value = null;
 loading.value = true; error.value = ""; basisReadNotice.value = ""; basisReadRequired.value = true;
 try {
  const options = await fetchRegisteredPaymentOptions(paymentId);
  const balances = await fetchFundAccounts();
  if (selected.value?.paymentId !== paymentId || readSequence !== registrationReadSequence || owner !== auth.user?.id || routeOwner !== route.fullPath) return;
  if (!owner || options.paymentId !== paymentId) throw new Error("实付登记许可与当前申请不一致，请重新读取原单资料");
  registrationPermissionOwner.value = owner; registrationPermissionRoute.value = routeOwner;
  registrationPermission.value = options;
  const drafts = new Map(outdatedSourceDrafts.value.map(draft=>[draft.sourceBatchId,draft]));
  for (const priorAccount of funds.value.accounts) for (const source of priorAccount.sources) {
   const raw = source.id ? allocations[source.id] : undefined;
   if (source.id && raw?.trim()) drafts.set(source.id,{sourceBatchId:source.id,accountName:priorAccount.name,sourceName:source.sourceName || "原出资来源",projectName:projectLabel(source),amountYuan:raw});
  }
  const currentSources = new Set(balances.accounts.flatMap(row=>row.sources.flatMap(source=>source.id ? [source.id] : [])));
  outdatedSourceDrafts.value = [...drafts.values()].filter(draft=>!currentSources.has(draft.sourceBatchId));
  const historyChanged = selected.value.contractHistoryBasis?.fingerprint !== options.contractHistoryBasis.fingerprint;
  if (historyChanged) form.historyTreatment = "";
  selected.value = structuredClone(options); funds.value = balances;
  frozenCommand.value = null; preparedDraft.value = null; confirmationFundBasis.value = null; confirmation.value = false;
  basisReadRequired.value = false;
  basisReadNotice.value = historyChanged && options.contractHistoryBasis.required ? "资料已重新读取，合同历史核对依据已变化，请重新明确本次是否未计入；金额、日期和核对文字已保留。" : "资金资料已重新读取，请核对当前余额、期初归属和来源，再确认这笔实付。";
 } catch (failure) {
  const reason = formatUnknownApiError(failure,"暂时无法读取最新资金资料").replace(/。+$/,"");
  error.value = `资金资料读取未完成：${reason}。原填写和原请求已保留，请重新读取成功后再确认。`;
 } finally { loading.value = false; }
}
async function refreshAfterRecord() {
 await load();
 funds.value = {accounts:[],projects:funds.value.projects,notice:""};
 try { funds.value = await fetchFundAccounts(); }
 catch (failure) { error.value = formatUnknownApiError(failure,"实付已登记，最新资金余额读取失败，请重新读取后核对"); }
}
function prepare() {
 error.value = "";
 try {
  if (locked.value || !selected.value) return;
  if (!registrationAllowed.value) throw new Error("当前申请尚未取得实付登记许可，请重新读取原单资料");
  if (basisReadRequired.value) throw new Error("请先重新读取资金资料成功，再核对确认这笔实付");
  const amountCents = yuanTextToCentsText(form.amountYuan.trim());
  if (BigInt(amountCents) <= 0n) throw new Error("请填写大于零的实付金额");
  if (BigInt(amountCents) > BigInt(selected.value.remainingAmountCents)) throw new Error("实付金额超过当前剩余待付，请核对");
  requiredPastChinaDate(form.paidAt,"实际付款日期");
  if (!account.value || !accountOption.value?.eligible || !account.value.currentRegistrationId) throw new Error("请选择当前可办理的实际付款资金");
  if (account.value.currentRegistrationId !== accountOption.value.currentRegistrationId) throw new Error("余额核对版本已变化，请重新读取并核实后登记，当前填写已保留");
  if (!["included","not_included"].includes(form.treatment)) throw new Error("请明确此次实付已含或未含期初；无法确认时保留填写，暂不提交");
  if (!form.reason.trim() || !form.evidence.trim()) throw new Error("请填写期初核对原因和依据");
  let contractHistoryConfirmation: RegisteredPaymentCommand["contractHistoryConfirmation"];
  if (selected.value.contractHistoryBasis.required) {
   if (form.historyTreatment !== "not_included") throw new Error("请先独立确认本次未计入合同历史已付；已计入、不确定或未选择时，请保留填写并核对原来源");
   if (!form.historyReason.trim() || !form.historyEvidence.trim()) throw new Error("请填写未计入合同历史已付的独立核对原因和依据");
   contractHistoryConfirmation = {treatment:"not_included",expectedFingerprint:selected.value.contractHistoryBasis.fingerprint,reason:form.historyReason.trim(),evidence:form.historyEvidence.trim()};
  }
  if (!form.password.trim()) throw new Error("请输入本人当前密码以确认登记");
  const sourceAllocations = form.treatment === "included" ? [] : account.value.sources.flatMap(source=> {
    const text = allocations[source.id ?? ""]?.trim();
    return !text || text === "0" ? [] : [{sourceBatchId:source.id!,amountCents:yuanTextToCentsText(text)}];
  });
  if (form.treatment === "not_included" && sourceAllocations.reduce((sum,line)=>sum+BigInt(line.amountCents),0n) !== BigInt(amountCents)) throw new Error("来源分摊合计必须等于本次实付金额，请逐项填写");
  const userId = auth.user?.id;
  if (!userId) throw new Error("请重新登录后登记本次实际付款");
  confirmationAccountName.value = accountOption.value.name;
  confirmationFundBasis.value = {balanceYuan:account.value.balanceYuan ?? null,asOfDate:account.value.asOfDate ?? null};
  commandUserId.value = userId;
  preparedDraft.value = {amountYuan:form.amountYuan,paidAt:form.paidAt,scopeKey:form.scopeKey,treatment:form.treatment,reason:form.reason,evidence:form.evidence,accountName:accountOption.value.name,allocations:sourceAllocations.map(line=>({sourceBatchId:line.sourceBatchId,amountYuan:allocations[line.sourceBatchId] ?? centsTextToYuanText(line.amountCents).replaceAll(",","")}))};
  commandPaymentId.value = selected.value.paymentId;
  frozenCommand.value = {...(contractHistoryConfirmation ? {contractHistoryConfirmation} : {}),idempotencyKey:form.idempotencyKey,expectedPaymentUpdatedAt:selected.value.expectedPaymentUpdatedAt,amountCents,paidAt:form.paidAt,scopeKey:form.scopeKey,expectedRegistrationId:account.value.currentRegistrationId,openingTreatment:form.treatment as "included"|"not_included",openingReason:form.reason.trim(),openingEvidence:form.evidence.trim(),sourceAllocations,confirmationPassword:form.password};
  confirmation.value = true;
 } catch (failure) { error.value = formatUnknownApiError(failure,"请检查本次实付填写，金额最多保留两位小数"); }
}
async function submit() {
 const command = frozenCommand.value;
 const draft = preparedDraft.value;
 const owner = commandUserId.value;
 const paymentId = commandPaymentId.value;
 const busy = saving.value;
 const resultUnknown = uncertain.value;
 const resultComplete = completed.value;
 const allowed = registrationAllowed.value;
 const sameActor = registrationActorMatches.value;
 const sameCommand = registrationCommandMatches.value;
 if (!command || !draft || !owner || busy || resultUnknown || resultComplete) return;
 if (!allowed || !sameCommand) { error.value = "当前申请尚未取得实付登记许可，请重新读取原单资料"; return; }
 if (!sameActor) { error.value = "当前登录身份已变化，请重新读取原单据后办理"; return; }
 saving.value = true; error.value = "";
 const pointer = makePendingPaymentAttempt(owner,paymentId,command,draft);
 pendingAttempt.value = pointer;
 storageNotice.value = writePendingPaymentAttempt(pointer,() => sessionStorage,storageNotice.value);
 const request = recordRegisteredPayment(paymentId,command);
 await request.then(async () => {
  registrationPermission.value = null;
  completed.value = true; uncertain.value = false; confirmation.value = false; clearConfirmedPointer(); resultMessage.value = "实际付款已登记，电子凭证待补充。";
  await refreshAfterRecord();
  const current = items.value.find(item=>item.paymentId === commandPaymentId.value);
  if (selected.value) selected.value = current ? {...selected.value,...current} : null;
  emit("recorded",commandPaymentId.value,props.paymentReference ?? commandPaymentId.value);
 }).catch(failure => {
  confirmation.value = false;
  if (failure instanceof RegisteredPaymentApiError && failure.status === 403) registrationPermission.value = null;
  if (outcomeUnconfirmed(failure)) {
   uncertain.value = true;
   resultMessage.value = failure instanceof RegisteredPaymentApiError && failure.status === 403 ? "当前岗位暂不能办理，已保留原请求，请由有权财务或综合部主管核查登记结果。" : "登记结果暂未确认，请保留当前填写并查询本次结果，不能重复登记。";
  } else { clearConfirmedPointer(); resultMessage.value = ""; if (failure instanceof RegisteredPaymentApiError && failure.status === 409) basisReadRequired.value = true; }
  error.value = formatUnknownApiError(failure,"付款登记未完成，当前填写已保留");
 }).finally(() => { saving.value = false; });
}
async function queryOriginal() {
 if (!frozenCommand.value || saving.value) return;
 if (auth.user?.id !== commandUserId.value) { uncertain.value = true; error.value = "当前登录身份已变化，原请求仍已保留，请由原办理人或有权岗位核查"; return; }
 saving.value = true;
 try {
  const result = await fetchRegisteredPaymentResult(frozenCommand.value.idempotencyKey);
  if (result.status === "recorded") {
   if (!result.execution || result.execution.paymentId !== commandPaymentId.value || result.execution.amountCents !== frozenCommand.value.amountCents || result.execution.paidAt !== frozenCommand.value.paidAt) throw new Error("查询结果与本次原填写不一致，请保留原请求并交由有权岗位核查");
   completed.value = true; uncertain.value = false; clearConfirmedPointer(); resultMessage.value = "已查到本次付款登记，电子凭证可继续补充。"; await refreshAfterRecord();
   emit("recorded",commandPaymentId.value,props.paymentReference ?? commandPaymentId.value);
  }
  else resultMessage.value = "尚未查到确切结果，请保留原填写并继续查询；这不代表没有提交。";
 } catch (failure) {
  uncertain.value = true;
  if (failure instanceof RegisteredPaymentApiError && failure.status === 403) resultMessage.value = "当前岗位暂不能查询，已保留原请求，请由有权财务或综合部主管核查登记结果。";
  error.value = formatUnknownApiError(failure,"本次结果查询未完成，请保留原填写继续查询");
 }
 finally { saving.value = false; }
}
let resultReadSequence = 0;
async function viewResult(key: string, code: string) {
 const sequence = ++resultReadSequence;
 resultDetailVisible.value = true; resultDetailTitle.value = `${code} · 原登记结果`; resultDetail.value = null; resultDetailError.value = ""; resultDetailLoading.value = true;
 try { const result = await fetchRegisteredPaymentResult(key); if (sequence === resultReadSequence) resultDetail.value = result; }
 catch (failure) { if (sequence === resultReadSequence) resultDetailError.value = formatUnknownApiError(failure,"原登记结果读取失败，请保留当前填写后重新查询"); }
 finally { if (sequence === resultReadSequence) resultDetailLoading.value = false; }
}
async function openVoucher(item: RecordedPaymentItem) {
 if (voucherBusy.value) return;
 const readSequence = ++voucherReadSequence;
 const owner = auth.user?.id;
 const routeOwner = route.fullPath;
 voucherPermission.value = null;
 if (voucherProgressExecutionId.value !== item.executionId) { voucherFiles.value = []; voucherUploadKey.value = crypto.randomUUID(); voucherFileId.value = null; voucherProgressExecutionId.value = item.executionId; }
 voucher.value = item; voucherError.value = "";
 try {
  const permission = await fetchRegisteredPaymentResult(item.resultKey);
  if (readSequence !== voucherReadSequence || owner !== auth.user?.id || routeOwner !== route.fullPath || voucher.value?.executionId !== item.executionId) return;
  if (!owner || permission.status !== "recorded" || permission.execution?.executionId !== item.executionId || permission.execution.paymentId !== item.paymentId) throw new Error("后补凭证许可与原实付不一致，请重新读取原记录");
  voucherPermissionOwner.value = owner; voucherPermissionRoute.value = routeOwner;
  voucherPermission.value = permission;
  if (permission.canSupplementVoucher !== true) voucherError.value = "原实付暂不能补充凭证，请先核对原记录；当前文件已保留。";
 } catch (failure) { voucherPermission.value = null; voucherError.value = formatUnknownApiError(failure,"后补凭证许可读取失败，当前文件已保留"); }
}
function voucherFileChanged() {
 if (voucherBusy.value) return;
 voucherUploadKey.value = crypto.randomUUID(); voucherFileId.value = null; voucherError.value = "";
}
async function saveVoucher() {
 const selectedVoucher = voucher.value;
 const file = selectedVoucherFile.value;
 const busy = voucherBusy.value;
 const allowed = voucherOperationAllowed.value;
 if (!selectedVoucher || !file || busy) { voucherError.value = "请先选择需要补充的电子付款凭证"; return; }
 if (!allowed) { voucherError.value = "当前记录尚未取得后补凭证许可，请重新读取已登记实付"; return; }
 voucherBusy.value = true; voucherError.value = "";
 const request = supplementRegisteredPaymentVoucher(selectedVoucher.executionId,file,voucherUploadKey.value,voucherFileId.value,fileId => { voucherFileId.value = fileId; });
 await request.then(async () => {
  resultMessage.value = "这笔实付的电子凭证已补充。";
  await load();
  voucherFiles.value = []; voucherFileId.value = null; voucher.value = null; voucherPermission.value = null; voucherProgressExecutionId.value = "";
 }).catch(failure => {
  if (failure instanceof RegisteredPaymentApiError && failure.status === 403) voucherPermission.value = null;
  const reason = formatUnknownApiError(failure,"上传或关联结果暂未确认，请稍后重试").replace(/。+$/,"");
  voucherError.value = `电子凭证补充结果暂未确认：${reason}。已保留所选文件，请重试补充；本次不会新增付款。`;
 }).finally(() => { voucherBusy.value = false; });
}
async function downloadVoucher(item: RecordedPaymentItem) {
 if (downloadBusyId.value) return;
 downloadBusyId.value = item.executionId; voucherError.value = "";
 try { await downloadRegisteredPaymentVoucher(item.executionId); }
 catch (failure) { voucherPermission.value = null; voucherReadSequence += 1; voucher.value = item; voucherError.value = formatUnknownApiError(failure,"付款凭证下载失败，请重新点击下载"); }
 finally { downloadBusyId.value = ""; }
}
onMounted(async () => {
 if (!visible.value) return;
 const restored = restorePendingAttempt();
 if (restored) { await queryOriginal(); if (uncertain.value) await load(); }
 else await load();
});
</script>
<template>
  <section
    v-if="visible"
    class="registered-payment"
    aria-label="共享实付待办"
  >
    <header class="registered-payment__header">
      <div><h2>共享实付待办</h2><p>财务与综合部主管共同办理，部分付款后继续保留剩余待付。</p></div>
      <t-button
        variant="outline"
        :loading="loading"
        :disabled="saving"
        @click="load"
      >
        刷新共享待办
      </t-button>
    </header>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-alert
      v-if="storageNotice"
      theme="warning"
      :message="storageNotice"
    />
    <section
      v-if="uncertain && pendingAttempt"
      class="registered-payment__basis"
      aria-label="待确认的原填写"
    >
      <strong>原填写（结果待确认）</strong>
      <p>实付金额：¥{{ centsTextToYuanText(pendingAttempt.command.amountCents) }}</p>
      <p>实际付款日期：{{ pendingAttempt.command.paidAt }}</p>
      <p>原选择的付款资金：{{ pendingAttempt.draft.accountName }}</p>
      <template v-if="pendingAttempt.command.contractHistoryConfirmation">
        <p>原合同历史确认：未计入合同历史已付</p>
        <p>原合同历史核对原因：{{ pendingAttempt.command.contractHistoryConfirmation.reason }}</p>
        <p>原合同历史核对依据：{{ pendingAttempt.command.contractHistoryConfirmation.evidence }}</p>
      </template>
      <p>请先查询原请求；这些填写不代表已登记或当前资金余额。</p>
    </section>
    <t-alert
      v-if="resultMessage"
      :theme="uncertain ? 'warning' : 'success'"
      :message="resultMessage"
    />
    <t-button
      v-if="uncertain && frozenCommand"
      :loading="saving"
      @click="queryOriginal"
    >
      查询本次登记结果
    </t-button>
    <p v-if="!loading && !shownItems.length">
      当前没有待登记的实付。
    </p>
    <article
      v-for="item in shownItems"
      :key="item.paymentId"
      class="registered-payment__item"
    >
      <strong>{{ item.code }}</strong>
      <span>已付 ¥{{ centsTextToYuanText(item.paidAmountCents) }} · 剩余待付 ¥{{ centsTextToYuanText(item.remainingAmountCents) }}</span>
      <t-button
        :disabled="loading || saving || uncertain"
        @click="open(item)"
      >
        {{ completed ? '开始下一笔实付登记' : '办理实付登记' }}
      </t-button>
    </article>
    <section
      v-if="selected"
      class="registered-payment__form"
      aria-label="实际付款登记"
    >
      <h3>{{ selected.code }} · 实际付款登记</h3>
      <t-alert
        theme="info"
        message="系统外实际支付后登记，电子凭证可以稍后补充。"
      />
      <t-button
        variant="outline"
        :loading="loading"
        :disabled="locked || loading"
        @click="reReadFundingBasis"
      >
        重新读取资金资料
      </t-button>
      <t-alert
        v-if="basisReadNotice"
        theme="info"
        :message="basisReadNotice"
      />
      <section
        v-if="outdatedSourceDrafts.length"
        class="registered-payment__basis"
        aria-label="重读前的来源填写"
      >
        <strong>原来源填写（已过期，待重新核对）</strong>
        <p>原来源填写已保留，当前分摊请按新资料逐项重新填写。</p>
        <p
          v-for="draft in outdatedSourceDrafts"
          :key="draft.sourceBatchId"
        >
          {{ draft.accountName }} · {{ draft.sourceName }} · {{ draft.projectName }}；原填写 {{ draft.amountYuan }} 元
        </p>
      </section>
      <p>已付 ¥{{ centsTextToYuanText(selected.paidAmountCents) }} · 剩余待付 ¥{{ centsTextToYuanText(selected.remainingAmountCents) }}</p>
      <section
        v-if="selected.originalResults?.length"
        class="registered-payment__basis"
        aria-label="已关联的历史实付"
      >
        <h4>已关联的历史实付</h4>
        <p>这些款项已有原登记结果，请先核对，勿重复登记同一笔实付；新的实际付款另行填写。</p>
        <article
          v-for="original in selected.originalResults"
          :key="original.executionId"
          class="registered-payment__item"
        >
          <span>{{ original.paidAt }} · ¥{{ centsTextToYuanText(original.amountCents) }}</span>
          <t-button
            variant="outline"
            @click="viewResult(original.resultKey, selected.code)"
          >
            查看原登记结果
          </t-button>
        </article>
      </section>
      <div class="registered-payment__fields">
        <label aria-label="实付金额（元）"><span>实付金额（元）</span><t-input
          v-model="form.amountYuan"
          inputmode="decimal"
          :disabled="locked"
        /></label>
        <label aria-label="实际付款日期"><span>实际付款日期</span><t-input
          v-model="form.paidAt"
          placeholder="例如：2026-11-04"
          :disabled="locked"
        /></label>
        <label aria-label="实际付款资金"><span>实际付款资金</span><t-select
          v-model="form.scopeKey"
          :options="accountOptions"
          :disabled="locked"
          placeholder="按实际付款选择公司资金或公共现金"
        /></label>
      </div>
      <t-alert
        v-if="!selected.accounts.length"
        theme="warning"
        message="当前没有可办理的付款资金，请联系财务核对资金登记资料，当前填写已保留。"
      />
      <p
        v-for="option in selected.accounts.filter(item=>!item.eligible)"
        :key="option.scopeKey"
      >
        {{ option.name }}：{{ option.reason }}
      </p>
      <section
        v-if="account"
        class="registered-payment__basis"
        aria-label="资金余额与来源"
      >
        <strong>{{ account.name }}：{{ account.balanceYuan === null ? '余额待核对（未知）' : `${uncertain ? '提交前读取的登记余额' : '登记余额'} ¥${account.balanceYuan}` }}</strong>
        <p>核对日期：{{ account.asOfDate || '待核对' }}；未分摊实付：{{ account.unallocatedPaymentAmountYuan ?? '尚未读取' }}元</p>
        <p v-if="account.currentRegistrationId !== accountOption?.currentRegistrationId">
          余额核对版本不一致，请重新读取并核实，当前填写保留。
        </p>
      </section>
      <t-alert
        v-if="completed && !account"
        theme="warning"
        message="实付已登记，最新资金余额尚未读取，请重新读取后核对。"
      />
      <section
        v-if="selected.contractHistoryBasis.required"
        class="registered-payment__basis"
        aria-label="合同历史付款核对"
      >
        <h4>合同历史付款核对</h4>
        <p>合同历史与资金期初分别核对，不能据同日同额判断同一笔付款。</p>
        <article
          v-for="record in selected.contractHistoryBasis.records"
          :key="record.id"
        >
          <p>合同历史已付：¥{{ centsTextToYuanText(record.historicalPaidCents) }}</p>
          <p>合同历史代付：¥{{ centsTextToYuanText(record.historicalProxyPaidCents) }}</p>
          <p>合同历史预付：¥{{ centsTextToYuanText(record.historicalAdvancePaidCents) }}</p>
          <p>历史余额确认日期：{{ chinaDateOnly(record.confirmedAt) }}</p>
          <p v-if="record.activatedAt">
            历史启用日期：{{ chinaDateOnly(record.activatedAt) }}
          </p>
        </article>
        <fieldset
          class="registered-payment__treatment"
          :disabled="locked"
        >
          <legend>本次实付是否已计入合同历史已付</legend>
          <t-radio-group
            v-model="form.historyTreatment"
            :disabled="locked"
          >
            <t-radio value="not_included">
              未计入合同历史已付
            </t-radio>
            <t-radio value="included">
              已计入合同历史已付
            </t-radio>
            <t-radio value="uncertain">
              不确定
            </t-radio>
          </t-radio-group>
        </fieldset>
        <p>已计入、不确定或未选择时，先核对原来源，保留填写，暂不登记。</p>
        <div class="registered-payment__fields">
          <label aria-label="合同历史独立核对原因"><span>未计入合同历史已付的核对原因</span><t-textarea
            v-model="form.historyReason"
            :disabled="locked"
          /></label>
          <label aria-label="合同历史独立核对依据"><span>合同历史核对依据</span><t-textarea
            v-model="form.historyEvidence"
            :disabled="locked"
          /></label>
        </div>
      </section>
      <fieldset
        class="registered-payment__treatment"
        :disabled="locked"
      >
        <legend>本次实付是否已包含在所选资金期初余额中</legend>
        <t-radio-group
          v-model="form.treatment"
          :disabled="locked"
        >
          <t-radio value="included">
            已含期初，不再扣减当前资金
          </t-radio>
          <t-radio value="not_included">
            未含期初，需要扣减登记资金
          </t-radio>
          <t-radio value="unknown">
            无法确认，先保留填写
          </t-radio>
        </t-radio-group>
        <p>资金期初是否已含本次实付，需要单独核实，不代表合同历史累计已含。</p>
      </fieldset>
      <section
        v-if="account && form.treatment === 'not_included'"
        aria-label="明确资金来源分摊"
      >
        <p>逐项填写实际使用的资金来源，不自动分摊。项目归属不足须先核实，不自动记垫资或到账。</p>
        <div
          v-for="(source,index) in account.sources"
          :key="source.id"
          class="registered-payment__source"
        >
          <span>{{ source.sourceName || '出资来源待核对' }} · {{ projectLabel(source) }} · {{ source.amountYuan === null ? '可用分摊待核对（未知）' : `可用 ¥${source.amountYuan}` }}</span>
          <label :aria-label="`来源分摊金额${index+1}`"><span>本次使用金额（元）</span><t-input
            v-model="allocations[source.id!]"
            inputmode="decimal"
            :disabled="locked || source.pendingAllocation || source.amountYuan === null"
          /></label>
        </div>
      </section>
      <div class="registered-payment__fields">
        <label aria-label="期初核对原因"><span>期初核对原因</span><t-textarea
          v-model="form.reason"
          :disabled="locked"
        /></label>
        <label aria-label="期初核对依据"><span>期初核对依据</span><t-textarea
          v-model="form.evidence"
          :disabled="locked"
        /></label>
        <label aria-label="本人当前密码"><span>本人当前密码</span><t-input
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          :disabled="locked"
        /></label>
      </div>
      <t-button
        theme="primary"
        :disabled="locked || loading || basisReadRequired || !registrationAllowed"
        :loading="saving"
        @click="prepare"
      >
        确认登记这笔实付
      </t-button>
    </section>
    <section aria-label="已登记实付">
      <h3>已登记实付</h3>
      <p v-if="!shownRecorded.length">
        暂无已登记实付。
      </p>
      <article
        v-for="item in shownRecorded"
        :key="item.executionId"
        class="registered-payment__item"
      >
        <strong>{{ item.code }} · ¥{{ centsTextToYuanText(item.amountCents) }}</strong>
        <span>{{ item.paidAt }} · {{ item.registeredByName }}</span>
        <span v-if="item.actualPayerName">实际付款资金：{{ item.actualPayerName }}</span>
        <t-tag :theme="item.voucherPending ? 'warning' : 'success'">
          {{ item.voucherPending ? '电子凭证待补充' : '电子凭证已补充' }}
        </t-tag>
        <t-button
          variant="text"
          @click="viewResult(item.resultKey, item.code)"
        >
          查看登记结果
        </t-button>
        <t-button
          v-if="item.voucherPending"
          :disabled="voucherBusy"
          @click="openVoucher(item)"
        >
          补充电子凭证
        </t-button>
        <t-button
          v-else
          :loading="downloadBusyId === item.executionId"
          @click="downloadVoucher(item)"
        >
          下载电子凭证
        </t-button>
        <section
          v-if="voucher?.executionId === item.executionId && item.voucherPending"
          class="registered-payment__voucher"
          aria-label="后补电子付款凭证"
        >
          <p>补充这笔已登记实付的电子凭证，不新增付款。</p>
          <t-upload
            v-model="voucherFiles"
            theme="file-input"
            :auto-upload="false"
            :max="1"
            :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
            :size-limit="uploadSizeLimit"
            :disabled="voucherBusy"
            placeholder="选择电子付款凭证"
            @change="voucherFileChanged"
          />
          <t-button
            v-if="voucherPermission && voucherPermission.canSupplementVoucher && voucherOperationAllowed"
            theme="primary"
            :loading="voucherBusy"
            @click="saveVoucher"
          >
            上传并关联凭证
          </t-button>
          <t-alert
            v-if="voucherError"
            theme="error"
            :message="voucherError"
          />
        </section>
        <t-alert
          v-if="voucher?.executionId === item.executionId && !item.voucherPending && voucherError"
          theme="error"
          :message="voucherError"
        />
      </article>
    </section>
    <t-dialog
      v-model:visible="resultDetailVisible"
      :header="resultDetailTitle"
      :footer="false"
    >
      <section aria-label="登记结果详情">
        <p v-if="resultDetailLoading">
          正在读取原登记结果，请稍候。
        </p>
        <t-alert
          v-if="resultDetailError"
          theme="error"
          :message="resultDetailError"
        />
        <template v-if="resultDetail?.status === 'recorded' && resultDetail.execution">
          <p>实付金额：¥{{ centsTextToYuanText(resultDetail.execution.amountCents) }}</p>
          <p>实际付款日期：{{ resultDetail.execution.paidAt }}</p>
          <p>{{ resultDetail.execution.voucherPending ? '电子凭证待补充' : '电子凭证已补充' }}</p>
          <p
            v-for="(entry,index) in resultDetail.intercompany ?? []"
            :key="index"
          >
            已记录公司代付往来：¥{{ centsTextToYuanText(entry.amountCents) }}
          </p>
        </template>
        <t-alert
          v-else-if="resultDetail?.status === 'unconfirmed'"
          theme="warning"
          message="尚未查到确切登记结果，这不代表没有提交，请保留原填写继续查询。"
        />
        <t-button
          variant="outline"
          @click="resultDetailVisible = false"
        >
          关闭结果
        </t-button>
      </section>
    </t-dialog>
    <SensitiveActionDialog
      v-if="registrationPermission && registrationPermission.canRegisterPayment && registrationAllowed && registrationCommandMatches"
      v-model="confirmation"
      title="确认登记系统外已支付的款项"
      :description="`本次实际付款 ¥${frozenCommand ? centsTextToYuanText(frozenCommand.amountCents) : '—'}，登记后更新已付金额和共同待办，请核实金额、日期、付款资金与来源。`"
      confirm-text="已核实并确认登记"
      :loading="saving"
      :error="error"
      @confirm="submit"
    >
      <p>实际付款日期：{{ frozenCommand?.paidAt }}</p>
      <p>实际付款资金：{{ confirmationAccountName }}</p>
      <template v-if="frozenCommand">
        <p>资金期初独立确认：{{ frozenCommand.openingTreatment === 'included' ? '已含期初，不再扣减当前资金' : '未含期初，需要扣减登记资金' }}</p>
        <p>资金期初核对原因：{{ frozenCommand.openingReason }}</p>
        <p>资金期初核对依据：{{ frozenCommand.openingEvidence }}</p>
      </template>
      <template v-if="frozenCommand?.contractHistoryConfirmation">
        <p>合同历史独立确认：未计入合同历史已付</p>
        <p>合同历史核对原因：{{ frozenCommand.contractHistoryConfirmation.reason }}</p>
        <p>合同历史核对依据：{{ frozenCommand.contractHistoryConfirmation.evidence }}</p>
      </template>
      <p v-if="confirmationFundBasis">
        本次核对余额：{{ confirmationFundBasis.balanceYuan === null ? '待核对（未知）' : `¥${confirmationFundBasis.balanceYuan}` }}；核对日期：{{ confirmationFundBasis.asOfDate || '待核对' }}
      </p>
    </SensitiveActionDialog>
  </section>
</template>
<style scoped>
.registered-payment { display: grid; gap: var(--jg-space-md); padding: var(--jg-space-lg); margin-block: var(--jg-space-lg); border: 1px solid var(--jg-border); border-radius: var(--jg-radius-md); background: var(--jg-bg-panel); min-width: 0; }
.registered-payment__header, .registered-payment__item { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-md); flex-wrap: wrap; }
.registered-payment__header h2, .registered-payment__form h3 { margin: 0; font-size: var(--jg-font-section-title); color: var(--jg-text-strong); }
.registered-payment p { color: var(--jg-text-subtle); overflow-wrap: anywhere; }
.registered-payment__item, .registered-payment__form { padding: var(--jg-space-md); border: 1px solid var(--jg-border); border-radius: var(--jg-radius-sm); }
@media (max-width: 640px) { .registered-payment { padding: var(--jg-space-md); } .registered-payment__item { align-items: stretch; flex-direction: column; } }
.registered-payment__fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: var(--jg-space-md); margin-block: var(--jg-space-md); }
.registered-payment__fields label, .registered-payment__source label { display: grid; gap: var(--jg-space-xs); min-width: 0; }
.registered-payment__source, .registered-payment__basis { padding: var(--jg-space-md); background: var(--jg-bg-muted); margin-block: var(--jg-space-sm); }
.registered-payment__treatment { border: 1px solid var(--jg-border); margin-block: var(--jg-space-md); min-width: 0; }
.registered-payment__treatment :deep(.t-radio-group) { display: flex; flex-direction: column; gap: var(--jg-space-sm); }
.registered-payment__voucher { display: grid; gap: var(--jg-space-md); flex-basis: 100%; min-width: 0; }
</style>
