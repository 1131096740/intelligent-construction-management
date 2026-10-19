<script setup lang="ts">
import {computed,onBeforeUnmount,reactive,ref,watch} from "vue";
import {useRoute} from "vue-router";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import ContractBankVerificationPanel from "../../components/ContractBankVerificationPanel.vue";
import {exportCompanyTransfers,fetchCompanyTransfers,createCompanyTransfer,decideCompanyTransfer,executeCompanyTransfer,fetchCompanyTransferBanks,type TransferData,type TransferRow} from "../../api/company-transfer.api";
import {uploadPrivateFile,downloadPrivateFileByTicket} from "../../api/core-flow-read.api";
import {formatUnknownApiError} from "../../api/error-message";
import {centsTextToYuanText,yuanTextToCentsText} from "../../lib/money";
const route=useRoute(),data=ref<TransferData|null>(null),error=ref(""),busy=ref(false),page=ref(1),project=ref(typeof route.query.projectId==="string"?route.query.projectId:""),company=ref(typeof route.query.companyId==="string"?route.query.companyId:""),asOf=ref(typeof route.query.asOf==="string"?route.query.asOf:""),bankProject=ref<string|null>(null);
const mode=ref(""),selected=ref<TransferRow|null>(null),password=ref(""),comment=ref(""),bank=ref(""),outgoing=ref(""),banks=ref<Array<{value:string;label:string}>>([]),file=ref<File|null>(null),fileId=ref("");let openedOriginal=false,generation=0,key=crypto.randomUUID();
const form=reactive({kind:"storage",sourceCompanyId:"",destinationCompanyId:"",sourceProjectId:"",destinationProjectId:"",sourceAccount:"",destinationAccount:"",amountYuan:"",original:"",reason:""});
const projectOptions=computed(()=>[...(data.value?.canUseOwnFunds?[{value:"",label:"公司自有资金"}]:[]),...(data.value?.projects??[]).map(p=>({value:p.id,label:p.name}))]);
const companyOptions=computed(()=>(data.value?.companies??[]).map(c=>({value:c.id,label:c.name})));
const originals=computed(()=>[...(data.value?.legacyOptions??[]).map(r=>({value:`${r.legacyType}:${r.id}`,label:`${r.reference} · 未清 ${money(r.remainingCents)} · 可申请 ${money(r.availableCents)}`})),...(data.value?.originalLoans??[]).map(r=>({value:`loan:${r.id}`,label:`${r.code} · ${r.sourceCompany} → ${r.destinationCompany} · 未清 ${money(r.remainingCents)} · 可申请 ${money(r.availableCents)}`})),...(data.value?.originalProxies??[]).map(r=>({value:`proxy:${r.id}`,label:`代付 ${r.source.reference} · ${r.source.actualPayer.name}`}))]);
const money=centsTextToYuanText;
async function exportLedger(){try{await exportCompanyTransfers({...(project.value?{projectId:project.value}:{}),...(company.value?{companyId:company.value}:{}),...(asOf.value?{asOf:asOf.value}:{})});}catch(e){error.value=formatUnknownApiError(e,"互转台账导出失败");}}
async function load(){const g=++generation;error.value="";try{const r=await fetchCompanyTransfers({...(project.value?{projectId:project.value}:{}),...(company.value?{companyId:company.value}:{}),...(asOf.value?{asOf:asOf.value}:{}),page:String(page.value)});if(g===generation){data.value=r;if(!openedOriginal&&(typeof route.query.originalProxyId==="string"||typeof route.query.originalInterEntityRelationshipId==="string"||typeof route.query.originalFundMovementRelationshipId==="string")&&r.canCreate){openedOriginal=true;form.kind="repayment";form.original=route.query.originalProxyId?`proxy:${route.query.originalProxyId}`:route.query.originalInterEntityRelationshipId?`inter_entity:${route.query.originalInterEntityRelationshipId}`:`movement:${route.query.originalFundMovementRelationshipId}`;originalChanged();await start("create");}}}catch(e){if(g===generation){data.value=null;error.value=formatUnknownApiError(e,"互转台账读取失败");}}}
function originalChanged(){const legacy=data.value?.legacyOptions.find(r=>`${r.legacyType}:${r.id}`===form.original);if(legacy)Object.assign(form,{sourceCompanyId:legacy.sourceCompanyId,destinationCompanyId:legacy.destinationCompanyId,sourceProjectId:legacy.sourceProjectId,destinationProjectId:legacy.destinationProjectId});const [kind,id]=form.original.split(":");const loan=data.value?.originalLoans.find(r=>r.id===id),proxy=data.value?.originalProxies.find(r=>r.id===id);if(kind==="loan"&&loan)Object.assign(form,{sourceCompanyId:loan.destinationCompanyId,destinationCompanyId:loan.sourceCompanyId,sourceProjectId:loan.destinationProjectId??"",destinationProjectId:loan.sourceProjectId??""});if(kind==="proxy"&&proxy)Object.assign(form,{sourceCompanyId:proxy.source.debtor.id,destinationCompanyId:proxy.source.actualPayer.id,sourceProjectId:proxy.projectId,destinationProjectId:proxy.projectId});}
async function start(action:string,row:TransferRow|null=null){selected.value=row;password.value="";comment.value="";bank.value="";outgoing.value="";file.value=null;fileId.value="";form.sourceAccount="";form.destinationAccount="";key=crypto.randomUUID();mode.value=action;if(row&&["outgoing","incoming","returned"].includes(action)){try{banks.value=await fetchCompanyTransferBanks(row.id,action);}catch(e){error.value=formatUnknownApiError(e,"银行流水读取失败");}}}
function choose(e:Event){file.value=(e.target as HTMLInputElement).files?.[0]??null;fileId.value="";}
async function save(){if(busy.value)return;busy.value=true;error.value="";try{if(mode.value==="evidence"){await downloadPrivateFileByTicket(selected.value!.evidenceFileId!,{confirmationPassword:password.value,downloadReason:"公司互转申请依据核对"});}else if(mode.value==="create"){if(!file.value)throw new Error("请上传互转申请依据");if(!fileId.value)fileId.value=(await uploadPrivateFile(file.value,file.value.name)).id;const [type,id]=form.original.split(":");await createCompanyTransfer({...form,amountCents:yuanTextToCentsText(form.amountYuan),...(form.kind==="repayment"?type==="loan"?{originalTransferId:id}:type==="movement"?{originalFundMovementRelationshipId:id}:type==="inter_entity"?{originalInterEntityRelationshipId:id}:{originalProxyId:id}:{}),evidenceFileId:fileId.value,idempotencyKey:key,confirmationPassword:password.value});}else if(["approve","reject","withdraw"].includes(mode.value))await decideCompanyTransfer(selected.value!.id,{action:mode.value,comment:comment.value,confirmationPassword:password.value});else await executeCompanyTransfer(selected.value!.id,{kind:mode.value,observationId:bank.value,outgoingEventId:outgoing.value||undefined,idempotencyKey:key,confirmationPassword:password.value});mode.value="";password.value="";form.sourceAccount="";form.destinationAccount="";await load();}catch(e){error.value=formatUnknownApiError(e,"互转提交失败");}finally{busy.value=false;}}
async function evidence(r:TransferRow){if(!r.evidenceFileId)return;try{await downloadPrivateFileByTicket(r.evidenceFileId,{confirmationPassword:password.value,downloadReason:"公司互转审批核对"});}catch(e){error.value=formatUnknownApiError(e,"请填写当前密码后查看申请依据");}}
watch([project,company,asOf],()=>{page.value=1;void load();},{immediate:true});onBeforeUnmount(()=>{generation++;password.value="";form.sourceAccount="";form.destinationAccount="";});
</script>
<template>
  <section class="company-transfer-page">
    <BusinessPageHeader title="公司互转审批与台账" description="财务发起，董事长或总经理任一人终审；实际出款、到账及往来核销分别留痕。" />
    <t-alert v-if="error" theme="error" :message="error" />
    <div class="transfer-filters">
      <t-select v-model="project" :options="[{value:'',label:'全部授权项目及资金'},...(data?.projects??[]).map(p=>({value:p.id,label:p.name}))]" aria-label="筛选互转项目" />
      <t-select v-model="company" :options="[{value:'',label:'全部公司'},...companyOptions]" aria-label="筛选互转公司" />
      <t-date-picker v-model="asOf" placeholder="台账基准日" />
      <t-button @click="load">刷新台账</t-button><t-button @click="exportLedger">导出互转台账</t-button><t-button v-if="data?.canCreate" @click="start('create')">发起公司互转</t-button>
    </div>
    <p>{{ data?.notice }}</p>
    <h3>资金变动与未清往来（元）</h3>
    <article v-for="b in data?.balances??[]" :key="`${b.companyId}:${b.projectId}`">
      <strong>{{ b.companyName }} · {{ b.projectId?data?.projects.find(p=>p.id===b.projectId)?.name:'公司自有资金' }}</strong>
      <p>实际资金净变动 {{ money(b.cashChangeCents) }} · 在途 {{ money(b.inTransitCents) }} · 借款应收 {{ money(b.receivableCents) }} · 借款应还 {{ money(b.payableCents) }} · 旧代付应收 {{ money(b.legacyReceivableCents ?? "0") }} · 旧代付应还 {{ money(b.legacyPayableCents ?? "0") }}</p>
    </article>
    <h3>互转申请与执行</h3>
    <t-pagination v-if="data" v-model="page" :total="data.total" :page-size="50" :show-page-size="false" @current-change="load" />
    <p v-if="data&&!data.rows.length">当前范围暂无公司互转。</p>
    <article v-for="r in data?.rows??[]" :key="r.id">
      <h4>{{ r.code }} · {{ r.kindLabel }} · {{ r.statusLabel }}</h4>
      <p>{{ r.sourceCompany }}（{{ r.sourceScope }}） → {{ r.destinationCompany }}（{{ r.destinationScope }}）</p>
      <p>申请 {{ money(r.amountCents) }} · 已出款 {{ money(r.sentCents) }} · 已到账 {{ money(r.receivedCents) }} · 已退回 {{ money(r.returnedCents) }} · 在途 {{ money(r.inTransitCents) }} 元</p>
      <p>{{ r.reason }}</p><p v-if="r.originalReference">归还原往来：{{ r.originalReference }}</p>
      <p v-for="(a,i) in r.approvalActions" :key="i">{{ a.actorName }} · {{ a.action==='approve'?'终审通过':a.action==='withdraw'?'撤回':'退回' }} · {{ new Date(a.at).toLocaleString('zh-CN') }} · {{ a.signed?'已签署':'' }} {{ a.comment }}</p>
      <t-button v-if="r.evidenceFileId" variant="text" @click="start('evidence',r)">查看申请依据</t-button>
      <t-button v-if="r.canApprove" @click="start('approve',r)">终审通过</t-button><t-button v-if="r.canApprove" variant="outline" @click="start('reject',r)">退回申请</t-button><t-button v-if="r.canWithdraw" variant="outline" @click="start('withdraw',r)">撤回申请</t-button>
      <template v-if="r.canExecute"><t-button v-if="BigInt(r.sentCents)<BigInt(r.amountCents)" @click="start('outgoing',r)">登记实际出款</t-button><t-button v-if="r.events.some(e=>e.canReconcile&&BigInt(e.remainingCents)>0n)" @click="start('incoming',r)">独立确认到账</t-button><t-button v-if="r.events.some(e=>e.canReconcile&&BigInt(e.remainingCents)>0n)" variant="outline" @click="start('returned',r)">登记未到账退回</t-button></template>
      <p v-for="e in r.events" :key="e.id">{{ e.kind==='outgoing'?'出款':e.kind==='incoming'?'到账':'未到账退回' }} {{ money(e.amountCents) }} 元 · {{ new Date(e.occurredAt).toLocaleDateString('zh-CN') }}</p>
    </article>
    <template v-if="data?.canCreate">
      <h3>办理前核验银行账户和流水</h3><t-select v-model="bankProject" :options="projectOptions" placeholder="选择流水所属项目或公司自有资金" aria-label="银行核验资金归属" />
      <ContractBankVerificationPanel v-if="bankProject!==null" :project-id="bankProject" @changed="load" />
    </template>
    <t-drawer v-if="!!mode" :visible="true" header="公司互转办理" size="90%" :footer="false" :close-on-overlay-click="false" @close="mode='';password=''">
      <t-alert v-if="error" theme="error" :message="error" />
      <t-form label-align="top">
        <template v-if="mode==='create'">
          <t-form-item label="办理类别"><t-select v-model="form.kind" :options="[{value:'storage',label:'资金转存'},{value:'loan',label:'临时借款调剂'},{value:'repayment',label:'归还已有往来'}]" /></t-form-item>
          <t-form-item v-if="form.kind==='repayment'" label="原借款或代付往来"><t-select v-model="form.original" :options="originals" @change="originalChanged" /></t-form-item>
          <t-form-item label="转出公司"><t-select v-model="form.sourceCompanyId" :options="companyOptions" /></t-form-item>
          <t-form-item label="转出资金归属"><t-select v-model="form.sourceProjectId" :options="projectOptions" /></t-form-item>
          <t-form-item label="转入公司"><t-select v-model="form.destinationCompanyId" :options="companyOptions" /></t-form-item>
          <t-form-item label="转入资金归属"><t-select v-model="form.destinationProjectId" :options="projectOptions" /></t-form-item>
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
          <t-form-item label="审批意见或退回、撤回原因"><t-textarea v-model="comment" /></t-form-item>
          <p>{{ selected?.sourceScope }}（尾号 {{ selected?.sourceAccountLast4 }}） → {{ selected?.destinationScope }}（尾号 {{ selected?.destinationAccountLast4 }}）</p>
          <p>{{ selected?.reason }}</p>
          <p v-if="selected?.originalReference">归还原往来：{{ selected.originalReference }}</p>
          <t-button v-if="selected?.evidenceFileId" variant="outline" @click="evidence(selected)">查看申请依据</t-button>
        </template>
        <template v-else>
          <t-form-item v-if="mode!=='outgoing'" label="对应出款（须由另一位财务确认）"><t-select v-model="outgoing" :options="(selected?.events??[]).filter(e=>e.canReconcile&&BigInt(e.remainingCents)>0n).map(e=>({value:e.id,label:`${new Date(e.occurredAt).toLocaleDateString('zh-CN')} · 尚待核对 ${money(e.remainingCents)} 元`}))" /></t-form-item>
          <t-form-item label="已核验且未认领的实际银行流水"><t-select v-model="bank" :options="banks" /></t-form-item>
        </template>
        <t-form-item label="当前登录密码"><t-input v-model="password" type="password" autocomplete="current-password" /></t-form-item>
        <t-button :loading="busy" @click="save">{{ mode==='create'?'提交领导终审':mode==='approve'?'签署并终审通过':mode==='evidence'?'核验并下载依据':'确认办理' }}</t-button>
      </t-form>
    </t-drawer>
  </section>
</template>
<style scoped>
.company-transfer-page {display:grid;gap:var(--jg-space-4);min-width:0;}
.transfer-filters {display:flex;flex-wrap:wrap;gap:var(--jg-space-3);}
.transfer-filters>* {max-width:100%;}
article {padding:var(--jg-space-4);border:1px solid var(--jg-border);border-radius:var(--jg-radius-md);overflow-wrap:anywhere;}
</style>
