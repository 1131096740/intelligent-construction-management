<script setup lang="ts">
import ApprovalDocumentDownload from "../../components/approval/ApprovalDocumentDownload.vue";
import {computed,onBeforeUnmount,reactive,ref,watch} from "vue";
import {useRoute} from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import MultiDutySmsStatusPanel from "../../components/MultiDutySmsStatusPanel.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import ContractBankVerificationPanel from "../../components/ContractBankVerificationPanel.vue";
import CompanyTransferOriginalDebtCorrections from "./CompanyTransferOriginalDebtCorrections.vue";
import {fetchCompanyTransferCapabilities,exportCompanyTransfers,fetchCompanyTransfer,fetchCompanyTransfers,createCompanyTransfer,decideCompanyTransfer,executeCompanyTransfer,fetchCompanyTransferBanks,type TransferData,type TransferRow,type TransferApprovalDuty,type TransferEvent} from "../../api/company-transfer.api";
import {uploadPrivateFile,downloadPrivateFileByTicket} from "../../api/core-flow-read.api";
import {formatUnknownApiError} from "../../api/error-message";
import {centsTextToYuanText,yuanTextToCentsText} from "../../lib/money";
import { roleLabels } from "../settings/approval-flow-readonly.config";
const auth = useAuthStore();
const route=useRoute(),data=ref<TransferData|null>(null),error=ref(""),busy=ref(false),page=ref(1),project=ref(typeof route.query.projectId==="string"?route.query.projectId:""),company=ref(typeof route.query.companyId==="string"?route.query.companyId:""),asOf=ref(typeof route.query.asOf==="string"?route.query.asOf:""),bankProject=ref<string|null>(null);
const transferLink = computed(() => route.query.transferId);
const isTransferDetail = computed(() => transferLink.value !== undefined);
const detail = ref<TransferRow | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const visibleRows = computed(() => isTransferDetail.value ? (detail.value ? [detail.value] : []) : data.value?.rows ?? []);
const ledgerLink = computed(() => {
  const query = { ...route.query };
  delete query.transferId;
  return { query };
});
const mode=ref(""),selected=ref<TransferRow|null>(null),password=ref(""),comment=ref(""),bank=ref(""),outgoing=ref(""),banks=ref<Array<{value:string;label:string}>>([]),file=ref<File|null>(null),fileId=ref("");let openedOriginal=false,generation=0,key=crypto.randomUUID();
const form=reactive({kind:"storage",sourceCompanyId:"",destinationCompanyId:"",repaymentDebtorCompanyId:"",sourceProjectId:"",destinationProjectId:"",sourceAccount:"",destinationAccount:"",amountYuan:"",original:"",reason:""});
const projectOptions=computed(()=>[...(data.value?.canUseOwnFunds?[{value:"",label:"公司自有资金"}]:[]),...(data.value?.projects??[]).map(p=>({value:p.id,label:p.name}))]);
const companyOptions=computed(()=>(data.value?.companies??[]).map(c=>({value:c.id,label:c.name})));
const payerCompanyOptions=computed(()=>(data.value?.payerCompanies??data.value?.companies??[]).map(c=>({value:c.id,label:c.name})));
const originals=computed(()=>[...(data.value?.legacyOptions??[]).map(r=>({value:`${r.legacyType}:${r.id}`,approvalFlow:r.approvalFlow,label:`${r.reference} · 未清 ${money(r.remainingCents)} · 可申请 ${money(r.availableCents)}`})),...(data.value?.originalLoans??[]).map(r=>({value:`loan:${r.id}`,approvalFlow:undefined,label:`${r.code} · ${r.sourceCompany} → ${r.destinationCompany} · 未清 ${money(r.remainingCents)} · 可申请 ${money(r.availableCents)}`})),...(data.value?.originalProxies??[]).map(r=>({value:`proxy:${r.id}`,approvalFlow:r.approvalFlow,label:`代付 ${r.source.reference} · ${r.source.actualPayer.name}`}))]);
const money=centsTextToYuanText;
const transferSelectPopupProps = { overlayInnerStyle: (trigger: HTMLElement) => ({ width: `${trigger.offsetWidth}px`, maxWidth: "calc(100vw - 32px)" }) };
async function exportLedger(){try{await exportCompanyTransfers({...(project.value?{projectId:project.value}:{}),...(company.value?{companyId:company.value}:{}),...(asOf.value?{asOf:asOf.value}:{})});}catch(e){error.value=formatUnknownApiError(e,"互转台账导出失败");}}
const sourceQueryKeys = {
  proxy: "originalProxyId",
  inter_entity: "originalInterEntityRelationshipId",
  movement: "originalFundMovementRelationshipId",
  operational: "originalOperationalPaymentId",
} as const;
const linkedSources = computed(() => Object.entries(sourceQueryKeys)
  .map(([kind, queryKey]) => [route.query[queryKey], kind])
  .filter(([value]) => value !== undefined));
function originalHistoryLocation(row: TransferRow) {
  const [kind, id] = row.originalSource?.split(":") ?? [];
  if (!id || !kind || !(kind in sourceQueryKeys)) return undefined;
  return {
    path: "/公司互转台账",
    query: {
      projectId: row.sourceProjectId ?? undefined,
      view: "history",
      [sourceQueryKeys[kind as keyof typeof sourceQueryKeys]]: id,
    },
  };
}
const linkedSource = computed(() => {
  const [entry] = linkedSources.value;
  if (linkedSources.value.length !== 1 || typeof entry?.[0] !== "string" || !entry[0]) return "";
  return `${entry[1]}:${entry[0]}`;
});
const fixedOriginal = ref(false);
const correctionSelection = ref<{ row: TransferRow; event: TransferEvent } | null>(null);
const linkedTransfer = computed(() => typeof route.query.transferId === "string" ? route.query.transferId : "");
const hasTransferLink = computed(() => route.query.transferId !== undefined);
const hasOriginalLink = computed(() => !hasTransferLink.value && linkedSources.value.length > 0);
const approvalDuty = ref<TransferApprovalDuty | null>(null);
function isProjectRepayment(value: string) {
  return originals.value.some(option => option.value === value && option.approvalFlow === "proxy_repayment_parallel");
}
const projectRepayment = computed(() => form.kind === "repayment" && isProjectRepayment(form.original));
function dutyName(duty: TransferApprovalDuty) {
  return duty.roleKeys.flatMap(key => key in roleLabels ? [roleLabels[key as keyof typeof roleLabels]] : []).join("、") || "本次审批职责";
}
function startDuty(action: "approve" | "reject", row: TransferRow, duty: TransferApprovalDuty) {
  void start(action, row);
  approvalDuty.value = duty;
}

async function load() {
  if (isTransferDetail.value) {
    return loadTransferDetail();
  }
  const request = ++generation;
  error.value = "";
  const source = hasOriginalLink.value ? linkedSource.value : "";
  if (hasOriginalLink.value && !source) {
    data.value = null;
    error.value = "原往来不存在或当前账号无权查看";
    return;
  }
  try {
    const result = await fetchCompanyTransfers({
      ...(project.value ? { projectId: project.value } : {}),
      ...(company.value ? { companyId: company.value } : {}),
      ...(asOf.value ? { asOf: asOf.value } : {}),
      page: String(page.value),
      ...(linkedTransfer.value ? { transferId: linkedTransfer.value } : {}),
      ...(source ? { originalSource: source } : {}),
    });
    if (request !== generation) return;
    data.value = result;
    if (!source) return;
    if (!result.originalSourceFound) {
      data.value = null;
      error.value = "原往来不存在或当前账号无权查看";
    } else if (!openedOriginal && result.canCreate && route.query.view !== "history") {
      openOriginalApplication();
    }
  } catch (cause) {
    if (request === generation) {
      data.value = null;
      error.value = formatUnknownApiError(cause, "互转台账读取失败");
    }
  }
}

function openOriginalApplication() {
  const source = linkedSource.value;
  if (!data.value?.canCreate || !originals.value.some(({ value }) => value === source)) return;
  openedOriginal = true;
  form.kind = "repayment";
  form.original = source;
  originalChanged();
  void start("create", null, true);
}
async function loadTransferDetail() {
  const request = ++generation;
  const id = transferLink.value;
  const actor = auth.user?.id;
  error.value = "";
  detail.value = null;
  detailError.value = "";
  detailLoading.value = false;
  if (!actor || typeof id !== "string" || !id) {
    detailError.value = "互转记录不存在或当前账号无权查看";
    return;
  }
  detailLoading.value = true;
  try {
    const row = await fetchCompanyTransfer(id);
    if (request !== generation || actor !== auth.user?.id) return;
    if (row.id !== id) {
      detailError.value = "互转记录不存在或当前账号无权查看";
      return;
    }
    detail.value = row;
    const eventId = route.query.correctionEventId;
    if (row.canReadOriginalDebtCorrections && typeof eventId === "string") {
      const event = row.events.find(item => item.id === eventId && item.kind === "outgoing");
      if (event) correctionSelection.value = {row,event};
    }
  } catch (cause) {
    if (request === generation) detailError.value = formatUnknownApiError(cause, "互转记录读取失败，请刷新");
  } finally {
    if (request === generation) detailLoading.value = false;
  }
}
function originalChanged(){const legacy=data.value?.legacyOptions.find(r=>`${r.legacyType}:${r.id}`===form.original);if(legacy)Object.assign(form,{sourceCompanyId:legacy.sourceCompanyId,destinationCompanyId:legacy.destinationCompanyId,repaymentDebtorCompanyId:legacy.sourceCompanyId,sourceProjectId:legacy.sourceProjectId,destinationProjectId:legacy.destinationProjectId});const [kind,id]=form.original.split(":");const loan=data.value?.originalLoans.find(r=>r.id===id),proxy=data.value?.originalProxies.find(r=>r.id===id);if(kind==="loan"&&loan)Object.assign(form,{sourceCompanyId:loan.destinationCompanyId,destinationCompanyId:loan.sourceCompanyId,repaymentDebtorCompanyId:loan.destinationCompanyId,sourceProjectId:loan.destinationProjectId??"",destinationProjectId:loan.sourceProjectId??""});if(kind==="proxy"&&proxy)Object.assign(form,{sourceCompanyId:proxy.source.debtor.id,destinationCompanyId:proxy.source.actualPayer.id,repaymentDebtorCompanyId:proxy.source.debtor.id,sourceProjectId:proxy.projectId,destinationProjectId:proxy.projectId});}
async function start(action:string,row:TransferRow|null=null,fromOriginal=false){fixedOriginal.value=fromOriginal;approvalDuty.value=null;selected.value=row;password.value="";comment.value="";bank.value="";outgoing.value="";file.value=null;fileId.value="";form.sourceAccount="";form.destinationAccount="";key=crypto.randomUUID();mode.value=action;if(row&&["outgoing","incoming","returned","settled_return"].includes(action)){try{banks.value=await fetchCompanyTransferBanks(row.id,action);}catch(e){error.value=formatUnknownApiError(e,"银行流水读取失败");}}}
function choose(e:Event){file.value=(e.target as HTMLInputElement).files?.[0]??null;fileId.value="";}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (mode.value === "evidence") {
      await downloadPrivateFileByTicketWithCapability(selected.value!.evidenceFileId!, {
        confirmationPassword: password.value, downloadReason: "公司互转申请依据核对",
      });
    } else if (mode.value === "create") {
      const upload = file.value;
      if (!upload) throw new Error("请上传互转申请依据");
      const draft = { ...form };
      if (draft.kind === "repayment" && !originals.value.some(({ value }) => value === draft.original)) {
        throw new Error("请选择当前可归还的原往来");
      }
      const [type, id] = draft.original.split(":");
      const originalSource = draft.kind === "repayment" && type !== "loan" ? draft.original : "";
      const amountCents = yuanTextToCentsText(draft.amountYuan);
      const confirmationPassword = password.value;
      const idempotencyKey = key;
      if (!fileId.value) fileId.value = (await uploadPrivateFileWithCapability(upload, upload.name, originalSource)).id;
      await createCompanyTransferWithCapability({
        ...draft,
        ...(draft.kind === "repayment" ? { repaymentDebtorCompanyId: draft.repaymentDebtorCompanyId || draft.sourceCompanyId } : { repaymentDebtorCompanyId: undefined }),
        amountCents,
        ...(draft.kind !== "repayment" ? {} : type === "loan" ? { originalTransferId: id } :
          { [sourceQueryKeys[type as keyof typeof sourceQueryKeys]]: id }),
        evidenceFileId: fileId.value,
        idempotencyKey,
        confirmationPassword,
      }, originalSource);
    } else if (["approve", "reject", "withdraw"].includes(mode.value)) {
      if (approvalDuty.value?.requiresSelfPassword && (!comment.value.trim() || !password.value)) {
        throw new Error("请填写自审原因并输入本人密码");
      }
      await decideCompanyTransferWithCapability(selected.value!.id, {
        action: mode.value, comment: comment.value, confirmationPassword: password.value,
        ...(approvalDuty.value ? { nodeIndex: approvalDuty.value.nodeIndex } : {}),
      });
    } else {
      await executeCompanyTransferWithCapability(selected.value!.id, {
        kind: mode.value, observationId: bank.value,
        ...(mode.value === "settled_return"
          ? { incomingEventId: outgoing.value, reason: comment.value }
          : { outgoingEventId: outgoing.value || undefined }),
        idempotencyKey: key, confirmationPassword: password.value,
      });
    }
    mode.value = "";
    password.value = "";
    form.sourceAccount = "";
    form.destinationAccount = "";
    await load();
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "互转提交失败");
  } finally {
    busy.value = false;
  }
}
async function evidence(r:TransferRow){if(!r.evidenceFileId)return;try{await downloadPrivateFileByTicketWithCapability(r.evidenceFileId,{confirmationPassword:password.value,downloadReason:"公司互转审批核对"});}catch(e){error.value=formatUnknownApiError(e,"请填写当前密码后查看申请依据");}}
watch([project,company,asOf],()=>{page.value=1;void load();},{immediate:true});watch(Object.values(sourceQueryKeys).map(queryKey => () => route.query[queryKey]), () => {
  openedOriginal = false;
  project.value = typeof route.query.projectId === "string" ? route.query.projectId : "";
  if (fixedOriginal.value) {
    mode.value = "";
    password.value = "";
  }
  void load();
});
watch([transferLink, () => route.query.correctionEventId, () => auth.user?.id], () => {
  mode.value = "";
  selected.value = null;
  correctionSelection.value = null;
  password.value = "";
  banks.value = [];
  data.value = null;
  detail.value = null;
  page.value = 1;
  void load();
}, { flush: "sync" });
onBeforeUnmount(()=>{generation++;password.value="";form.sourceAccount="";form.destinationAccount="";});

async function createCompanyTransferWithCapability(arg0: Parameters<typeof createCompanyTransfer>[0], originalSource: string) {
  const capability = await fetchCompanyTransferCapabilities(project.value, page.value, company.value, asOf.value, originalSource);
  const operationAllowed = capability.canCreate;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return createCompanyTransfer(arg0);
}
async function decideCompanyTransferWithCapability(arg0: Parameters<typeof decideCompanyTransfer>[0], arg1: Parameters<typeof decideCompanyTransfer>[1]) {
  const capability = await fetchCompanyTransferCapabilities(project.value, page.value, company.value, asOf.value);
  const operationAllowed = capability.canDecide;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return decideCompanyTransfer(arg0, arg1);
}
async function executeCompanyTransferWithCapability(arg0: Parameters<typeof executeCompanyTransfer>[0], arg1: Parameters<typeof executeCompanyTransfer>[1]) {
  const capability = await fetchCompanyTransferCapabilities(project.value, page.value, company.value, asOf.value);
  const operationAllowed = capability.canExecute;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return executeCompanyTransfer(arg0, arg1);
}
async function uploadPrivateFileWithCapability(arg0: Parameters<typeof uploadPrivateFile>[0], arg1: Parameters<typeof uploadPrivateFile>[1], originalSource: string) {
  const capability = await fetchCompanyTransferCapabilities(project.value, page.value, company.value, asOf.value, originalSource);
  const operationAllowed = capability.canCreate;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return uploadPrivateFile(arg0, arg1);
}
async function downloadPrivateFileByTicketWithCapability(arg0: Parameters<typeof downloadPrivateFileByTicket>[0], arg1: Parameters<typeof downloadPrivateFileByTicket>[1]) {
  const capability = await fetchCompanyTransferCapabilities(project.value, page.value, company.value, asOf.value);
  const operationAllowed = capability.canReadEvidence;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return downloadPrivateFileByTicket(arg0, arg1);
}
</script>
<template>
  <section class="company-transfer-page">
    <BusinessPageHeader title="公司互转审批与台账" description="查看互转申请、实际出款、到账及往来核销。项目代付归还按原往来办理。" />
    <t-alert v-if="error" theme="error" :message="error" />
    <template v-if="isTransferDetail">
      <router-link :to="ledgerLink">返回公司互转台账</router-link>
      <p v-if="detailLoading" role="status">正在读取互转记录</p>
      <t-alert v-else-if="detailError" theme="error" :message="detailError" />
    </template>
    <div v-if="!isTransferDetail">
    <router-link v-if="hasOriginalLink" to="/公司互转台账">返回全部互转台账</router-link>
    <div class="transfer-filters">
      <t-select v-model="project" :options="[{value:'',label:'全部授权项目及资金'},...(data?.projects??[]).map(p=>({value:p.id,label:p.name}))]" aria-label="筛选互转项目" />
      <t-select v-model="company" :options="[{value:'',label:'全部公司'},...companyOptions]" aria-label="筛选互转公司" />
      <t-date-picker v-model="asOf" placeholder="台账基准日" />
      <t-button @click="load">刷新台账</t-button><t-button @click="exportLedger">导出互转台账</t-button><t-button v-if="data?.canCreate && !hasOriginalLink && !hasTransferLink" @click="start('create')">发起公司互转</t-button>
    </div>
    <p>{{ data?.notice }}</p>
    <h3>资金变动与未清往来（元）</h3>
    <article v-for="b in data?.balances??[]" :key="`${b.companyId}:${b.projectId}`">
      <strong>{{ b.companyName }} · {{ b.projectId?data?.projects.find(p=>p.id===b.projectId)?.name:'公司自有资金' }}</strong>
      <p>实际资金净变动 {{ money(b.cashChangeCents) }} · 在途 {{ money(b.inTransitCents) }} · 借款应收 {{ money(b.receivableCents) }} · 借款应还 {{ money(b.payableCents) }} · 代付应收 {{ money(b.legacyReceivableCents ?? "0") }} · 代付应还 {{ money(b.legacyPayableCents ?? "0") }} · 第三家代还应收 {{ money(b.onBehalfReceivableCents ?? "0") }} · 第三家代还应还 {{ money(b.onBehalfPayableCents ?? "0") }}</p>
    </article>
    <h3>{{ hasOriginalLink ? '原往来归还记录' : '互转申请与执行' }}</h3>
    <t-button v-if="hasOriginalLink && data?.canCreate" @click="openOriginalApplication">申请归还该往来</t-button>
    <p v-else-if="hasOriginalLink && data?.originalSourceFound">当前不可发起归还，已有记录仍可查看。</p>
    <t-pagination v-if="data && !hasTransferLink && !hasOriginalLink" v-model="page" :total="data.total" :page-size="50" :show-page-size="false" @current-change="load" />
    <p v-if="data && !visibleRows.length">{{ hasTransferLink ? '互转记录不存在或当前账号无权查看。' : hasOriginalLink ? '该往来暂无归还记录。' : '当前范围暂无公司互转。' }}</p>
    </div>
    <article v-for="r in visibleRows" :key="r.id">
      <h4>{{ r.code }} · {{ r.kindLabel }} · {{ r.statusLabel }}</h4>
      <p>{{ r.sourceCompany }}（{{ r.sourceScope }}） → {{ r.destinationCompany }}（{{ r.destinationScope }}）</p>
      <p v-if="r.onBehalfRepayment">第三家公司代还：{{ r.sourceCompany }} 代 {{ r.repaymentDebtorCompany }} 归还 {{ r.destinationCompany }}</p>
      <p>申请 {{ money(r.amountCents) }} · 已出款 {{ money(r.sentCents) }} · 已到账 {{ money(r.receivedCents) }} · 已退回 {{ money(r.returnedCents) }} · 在途 {{ money(r.inTransitCents) }} 元</p>
      <p>{{ r.reason }}</p>
      <p v-if="r.originalReference">归还原往来：{{ r.originalReference }}</p>
      <router-link v-if="!hasOriginalLink && originalHistoryLocation(r)" :to="originalHistoryLocation(r)!">查看原往来归还记录</router-link>
      <p v-for="(a,i) in r.approvalActions" :key="i">{{ a.actorName }} · {{ a.action==='approve'?(r.approvalFlow==='proxy_repayment_parallel'?'审批通过':'终审通过'):a.action==='withdraw'?'撤回':'退回' }} · {{ new Date(a.at).toLocaleString('zh-CN') }} · {{ a.signed?'已签署':'' }} {{ a.comment }}</p>
      <ApprovalDocumentDownload business-type="company_transfer" :business-id="r.id" :refresh-key="r.status" />
      <t-button v-if="r.evidenceFileId" variant="text" @click="start('evidence',r)">查看申请依据</t-button>
      <template v-if="r.approvalFlow === 'proxy_repayment_parallel'">
        <template v-for="duty in r.approvalDuties" :key="duty.nodeIndex">
          <t-button @click="startDuty('approve', r, duty)">同意（{{ dutyName(duty) }}）</t-button>
          <t-button variant="outline" @click="startDuty('reject', r, duty)">驳回（{{ dutyName(duty) }}）</t-button>
        </template>
      </template>
      <template v-else>
      <t-button v-if="r.canApprove" @click="start('approve',r)">终审通过</t-button><t-button v-if="r.canApprove" variant="outline" @click="start('reject',r)">退回申请</t-button>
      </template>
      <t-button v-if="r.canWithdraw" variant="outline" @click="start('withdraw',r)">撤回申请</t-button>
      <template v-if="r.canExecute"><t-button v-if="BigInt(r.sentCents)<BigInt(r.amountCents)" @click="start('outgoing',r)">登记实际出款</t-button><t-button v-if="r.events.some(e=>e.canReconcile&&BigInt(e.remainingCents)>0n)" @click="start('incoming',r)">独立确认到账</t-button><t-button v-if="r.events.some(e=>e.canReconcile&&BigInt(e.remainingCents)>0n)" variant="outline" @click="start('returned',r)">登记未到账退回</t-button>
        <t-button v-if="r.events.some(e=>e.canRefund&&BigInt(e.remainingCents)>0n)" variant="outline" @click="start('settled_return',r)">登记到账后退回</t-button>
      </template>
      <MultiDutySmsStatusPanel
        v-if="auth.user?.id && (r.canApprove || r.canExecute)"
        :key="`${auth.user.id}:${r.id}:${r.status}:${r.sentCents}:${r.inTransitCents}`"
        domain="company-transfers"
        :business-id="r.id"
      />
      <div v-for="event in r.events" :key="event.id">
        <p>{{ event.kind === 'outgoing' ? '出款' : event.kind === 'incoming' ? '到账' : event.kind === 'settled_return' ? '到账后退回' : '未到账退回' }}
          {{ money(event.amountCents) }} 元 · {{ new Date(event.occurredAt).toLocaleDateString('zh-CN') }}</p>
        <t-button
          v-if="r.canReadOriginalDebtCorrections && r.approvalFlow === 'proxy_repayment_parallel' && event.kind === 'outgoing'"
          variant="text"
          @click="correctionSelection = { row: r, event }"
        >
          查看归还原债与更正
        </t-button>
      </div>
    </article>
    <template v-if="data?.canCreate && !hasOriginalLink && !hasTransferLink">
      <h3>办理前核验银行账户和流水</h3><t-select v-model="bankProject" :options="projectOptions" placeholder="选择流水所属项目或公司自有资金" aria-label="银行核验资金归属" />
      <ContractBankVerificationPanel v-if="bankProject!==null" :project-id="bankProject" @changed="load" />
    </template>
    <t-drawer v-if="!!mode" :visible="true" header="公司互转办理" size="90%" :footer="false" :close-on-overlay-click="false" @close="mode='';password=''">
      <t-alert v-if="error" theme="error" :message="error" />
      <t-form label-align="top">
        <template v-if="mode==='create'">
          <t-form-item label="办理类别"><t-select :popup-props="transferSelectPopupProps" v-model="form.kind" :disabled="fixedOriginal" :options="[{value:'storage',label:'资金转存'},{value:'loan',label:'临时借款调剂'},{value:'repayment',label:'归还已有往来'}]" /></t-form-item>
          <t-form-item v-if="form.kind==='repayment'" label="原借款或代付往来"><t-select :popup-props="transferSelectPopupProps" v-model="form.original" :disabled="fixedOriginal" :options="originals" @change="originalChanged" /></t-form-item>
          <t-form-item v-if="form.kind==='repayment'" label="代还债务人（原债务公司）"><t-select :popup-props="transferSelectPopupProps" v-model="form.repaymentDebtorCompanyId" :disabled="fixedOriginal" :options="companyOptions" /></t-form-item>
          <p v-if="form.kind==='repayment'" class="transfer-hint">转出公司须是实际出款公司；若它与代还债务人不同，即为第三家公司代还：原债务公司欠款结清，转而欠实际出款公司，不新增项目成本或第二笔付款。</p>
          <t-form-item label="转出公司（实际出款）"><t-select :popup-props="transferSelectPopupProps" v-model="form.sourceCompanyId" :disabled="fixedOriginal" :options="form.kind==='repayment'?payerCompanyOptions:companyOptions" /></t-form-item>
          <t-form-item label="转出资金归属"><t-select :popup-props="transferSelectPopupProps" v-model="form.sourceProjectId" :disabled="fixedOriginal" :options="projectOptions" /></t-form-item>
          <t-form-item label="转入公司"><t-select :popup-props="transferSelectPopupProps" v-model="form.destinationCompanyId" :disabled="fixedOriginal" :options="companyOptions" /></t-form-item>
          <t-form-item label="转入资金归属"><t-select :popup-props="transferSelectPopupProps" v-model="form.destinationProjectId" :disabled="fixedOriginal" :options="projectOptions" /></t-form-item>
          <t-form-item label="转出银行完整账号"><t-input v-model="form.sourceAccount" autocomplete="off" /></t-form-item>
          <t-form-item label="转入银行完整账号"><t-input v-model="form.destinationAccount" autocomplete="off" /></t-form-item>
          <t-form-item label="申请金额（元）"><t-input v-model="form.amountYuan" /></t-form-item>
          <t-form-item label="用途和依据"><t-textarea v-model="form.reason" /></t-form-item>
          <t-form-item label="申请依据附件">
            <!-- ui-rules-ignore: native-file-input; private transfer evidence picker. -->
            <input type="file" aria-label="上传互转申请依据" accept=".pdf,.png,.jpg,.jpeg" @change="choose">
          </t-form-item>
        </template>
        <template v-else-if="['approve','reject','withdraw','evidence'].includes(mode)">
          <p>{{ selected?.kindLabel }} · {{ selected?.code }} · {{ selected?.sourceCompany }} → {{ selected?.destinationCompany }} · {{ money(selected?.amountCents??'0') }} 元</p>
          <t-form-item :label="approvalDuty?.requiresSelfPassword ? '本人审批原因（必填）' : '审批意见或退回、撤回原因'"><t-textarea v-model="comment" /></t-form-item>
          <p v-if="selected?.onBehalfRepayment">第三家公司代还：{{ selected?.sourceCompany }} 代 {{ selected?.repaymentDebtorCompany }} 归还 {{ selected?.destinationCompany }}</p>
          <p>{{ selected?.sourceScope }}（尾号 {{ selected?.sourceAccountLast4 }}） → {{ selected?.destinationScope }}（尾号 {{ selected?.destinationAccountLast4 }}）</p>
          <p>{{ selected?.reason }}</p>
          <p v-if="selected?.originalReference">归还原往来：{{ selected.originalReference }}</p>
          <t-button v-if="selected?.evidenceFileId" variant="outline" @click="evidence(selected)">查看申请依据</t-button>
        </template>
        <template v-else>
          <template v-if="mode==='settled_return'">
            <t-form-item label="原代还到账">
              <t-select :popup-props="transferSelectPopupProps" v-model="outgoing" :options="(selected?.events??[]).filter(e=>e.canRefund&&BigInt(e.remainingCents)>0n).map(e=>({value:e.id,label:`${new Date(e.occurredAt).toLocaleDateString('zh-CN')} · 尚可退回 ${money(e.remainingCents)} 元`}))" />
            </t-form-item>
            <t-form-item label="退款或银行退回原因"><t-textarea v-model="comment" /></t-form-item>
          </template>
          <t-form-item v-else-if="mode!=='outgoing'" label="对应出款（须由另一位财务确认）"><t-select :popup-props="transferSelectPopupProps" v-model="outgoing" :options="(selected?.events??[]).filter(e=>e.canReconcile&&BigInt(e.remainingCents)>0n).map(e=>({value:e.id,label:`${new Date(e.occurredAt).toLocaleDateString('zh-CN')} · 尚待核对 ${money(e.remainingCents)} 元`}))" /></t-form-item>
          <t-form-item label="已核验且未认领的实际银行流水"><t-select :popup-props="transferSelectPopupProps" v-model="bank" :options="banks" /></t-form-item>
        </template>
        <t-form-item label="当前登录密码"><t-input v-model="password" type="password" autocomplete="current-password" /></t-form-item>
        <t-button :loading="busy" @click="save">{{ mode==='create'?(projectRepayment?'提交项目审批':'提交领导终审'):mode==='approve'?(approvalDuty?'同意本次审批':'签署并终审通过'):mode==='evidence'?'核验并下载依据':'确认办理' }}</t-button>
      </t-form>
    </t-drawer>
    <CompanyTransferOriginalDebtCorrections
      v-if="correctionSelection"
      :key="correctionSelection.event.id"
      :transfer-id="correctionSelection.row.id"
      :event-id="correctionSelection.event.id"
      :original-reference="correctionSelection.row.originalReference"
      :occurred-at="correctionSelection.event.occurredAt"
      :amount-cents="correctionSelection.event.amountCents"
      @close="correctionSelection = null"
      @changed="load"
    />
  </section>
</template>
<style scoped>
.company-transfer-page {display:grid;gap:var(--jg-space-4);min-width:0;}
.transfer-filters {display:flex;flex-wrap:wrap;gap:var(--jg-space-3);}
.transfer-filters>* {max-width:100%;}
.transfer-hint {color:var(--jg-text-secondary);font-size:var(--jg-font-size-sm);margin:0;}
article {padding:var(--jg-space-4);border:1px solid var(--jg-border);border-radius:var(--jg-radius-md);overflow-wrap:anywhere;}
</style>
