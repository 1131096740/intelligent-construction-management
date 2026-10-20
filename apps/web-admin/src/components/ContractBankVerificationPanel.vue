<script setup lang="ts">
import ApprovalDocumentDownload from "./approval/ApprovalDocumentDownload.vue";
import {onBeforeUnmount,reactive,ref,watch} from "vue";
import {fetchBankVerifications,prepareBankVerification,decideBankVerification,type BankVerificationData} from "../api/contract-bank-verification.api";
import {uploadPrivateFile,downloadPrivateFileByTicket} from "../api/core-flow-read.api";
import {formatUnknownApiError} from "../api/error-message";
import {yuanTextToCentsText,centsTextToYuanText} from "../lib/money";
const props=defineProps<{projectId:string}>(),emit=defineEmits<{changed:[]}>();
const page=ref(1),status=ref("pending_confirm");
const data=ref<BankVerificationData|null>(null),busy=ref(false),error=ref(""),show=ref(false),password=ref(""),file=ref<File|null>(null),fileId=ref<string>(),decision=ref<{id:string;decision:"confirm"|"return"}|null>(null);
const form=reactive({companyEntityId:"",accountNumber:"",bankReference:"",direction:"outflow",amountYuan:"",occurredAt:new Date().toISOString().slice(0,10),reason:""});let generation=0,key=crypto.randomUUID();
async function load(){const g=++generation;data.value=null;try{const r=await fetchBankVerifications(props.projectId,page.value,status.value);if(g===generation)data.value=r;}catch(c){if(g===generation)error.value=formatUnknownApiError(c,"银行核验读取失败");}}
function start(d:typeof decision.value=null){decision.value=d;password.value="";file.value=null;fileId.value=undefined;form.accountNumber="";key=crypto.randomUUID();show.value=true;}
function choose(e:Event){file.value=(e.target as HTMLInputElement).files?.[0]??null;fileId.value=undefined;}
async function save(){if(busy.value)return;const g=generation,p=props.projectId;busy.value=true;error.value="";try{
 if(decision.value?.decision!=="return"){if(!file.value)throw new Error(decision.value?"请上传本人核对的开户名称及账号证明":"请上传银行交易回单");if(!fileId.value)fileId.value=(await uploadPrivateFileWithCapability(file.value,file.value.name)).id;if(g!==generation)return;}
 if(decision.value)await decideBankVerificationWithCapability(decision.value.id,{decision:decision.value.decision,holderEvidenceFileId:fileId.value,accountNumber:form.accountNumber,confirmationPassword:password.value});
 else await prepareBankVerificationWithCapability({projectId:p,companyEntityId:form.companyEntityId,accountNumber:form.accountNumber,bankReference:form.bankReference,direction:form.direction,amountCents:yuanTextToCentsText(form.amountYuan),occurredAt:`${form.occurredAt}T00:00:00+08:00`,evidenceFileId:fileId.value!,reason:form.reason,idempotencyKey:key,confirmationPassword:password.value});
 if(g!==generation)return;show.value=false;password.value="";form.accountNumber="";busy.value=false;await load();emit("changed");
 }catch(c){if(g===generation)error.value=formatUnknownApiError(c,"银行核验提交失败");}finally{if(g===generation)busy.value=false;}}
async function evidence(row:BankVerificationData["rows"][number]){try{await downloadPrivateFileByTicketWithCapability(row.evidenceFileId,{confirmationPassword:password.value,downloadReason:"独立核验银行账户和交易依据"});}catch(c){error.value=formatUnknownApiError(c,"原交易依据下载失败，请填写当前密码");}}
watch(()=>props.projectId,()=>{page.value=1;show.value=false;password.value="";form.accountNumber="";busy.value=false;void load();},{immediate:true});onBeforeUnmount(()=>{generation++;password.value="";form.accountNumber="";});

async function prepareBankVerificationWithCapability(arg0: Parameters<typeof prepareBankVerification>[0]) {
  const capability = await fetchBankVerifications(props.projectId,page.value,status.value);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return prepareBankVerification(arg0);
}
async function decideBankVerificationWithCapability(arg0: Parameters<typeof decideBankVerification>[0], arg1: Parameters<typeof decideBankVerification>[1]) {
  const capability = await fetchBankVerifications(props.projectId,page.value,status.value);
  const operationAllowed = capability.canReview;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return decideBankVerification(arg0, arg1);
}
async function uploadPrivateFileWithCapability(arg0: Parameters<typeof uploadPrivateFile>[0], arg1: Parameters<typeof uploadPrivateFile>[1]) {
  const capability = await fetchBankVerifications(props.projectId,page.value,status.value);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return uploadPrivateFile(arg0, arg1);
}
async function downloadPrivateFileByTicketWithCapability(arg0: Parameters<typeof downloadPrivateFileByTicket>[0], arg1: Parameters<typeof downloadPrivateFileByTicket>[1]) {
  const capability = await fetchBankVerifications(props.projectId,page.value,status.value);
  const operationAllowed = capability.canReadEvidence;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return downloadPrivateFileByTicket(arg0, arg1);
}
</script>
<template>
  <section
    id="银行流水核验"
    aria-label="银行流水核验"
  >
    <h3>银行流水核验</h3><p>财务经办提交银行回单，独立公司财务负责人核对账户开户名称、账号和交易后确认。核验不改变现金余额，办理实际收付时仅能认领一次。</p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-button
      variant="outline"
      @click="start()"
    >
      提交银行流水核验
    </t-button><t-button
      variant="text"
      @click="load"
    >
      刷新核验
    </t-button>
    <t-input
      v-if="data?.rows.some(r=>r.canConfirm)"
      v-model="password"
      type="password"
      placeholder="核对原回单前填写当前登录密码"
    />
    <t-select
      v-model="status"
      :options="[{value:'pending_confirm',label:'待核验'},{value:'confirmed',label:'已核验'},{value:'returned',label:'已退回'},{value:'all',label:'全部状态'}]"
      aria-label="核验状态"
      @change="page=1;load()"
    />
    <t-pagination
      v-if="data"
      v-model="page"
      :total="data.total??0"
      :page-size="50"
      :show-page-size="false"
      @current-change="load"
    />
    <article
      v-for="r in data?.rows??[]"
      :key="r.id"
    >
      <p>{{ r.companyName }} · 账号尾号 {{ r.accountLast4 }} · {{ r.direction==='inflow'?'到账':'出款' }} {{ centsTextToYuanText(r.amountCents) }} 元 · {{ new Date(r.occurredAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}) }} · {{ r.status==='confirmed'?'已核验可办理收付':r.status==='returned'?'已退回':'待独立财务核验' }}</p>
      <p>银行交易流水号：{{ r.bankReference }} · {{ r.reason }}</p>
      <template v-if="r.canConfirm">
        <t-button
          variant="text"
          @click="evidence(r)"
        >
          查看原银行回单
        </t-button><t-button @click="start({id:r.id,decision:'confirm'})">
          核验账户及流水
        </t-button><t-button
          variant="outline"
          @click="start({id:r.id,decision:'return'})"
        >
          退回重填
        </t-button>
      </template>
      <ApprovalDocumentDownload business-type="contract_bank_verification" :business-id="r.id" :refresh-key="r.status" />
    </article>
    <t-drawer
      v-model:visible="show"
      header="银行账户与交易核验"
      size="90%"
      :footer="false"
      :close-on-overlay-click="false"
    >
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
      <t-form label-align="top">
        <template v-if="!decision">
          <t-form-item label="真实开户公司">
            <t-select
              v-model="form.companyEntityId"
              :options="data?.companies??[]"
            />
          </t-form-item>
          <t-form-item label="回单上的完整银行账号（仅保存摘要和尾号）">
            <t-input
              v-model="form.accountNumber"
              autocomplete="off"
            />
          </t-form-item>
          <t-form-item label="银行交易流水号">
            <t-input v-model="form.bankReference" />
          </t-form-item>
          <t-form-item label="方向">
            <t-select
              v-model="form.direction"
              :options="[{value:'outflow',label:'出款'},{value:'inflow',label:'到账'}]"
            />
          </t-form-item>
          <t-form-item label="实际金额（元）">
            <t-input v-model="form.amountYuan" />
          </t-form-item>
          <t-form-item label="银行发生日期">
            <t-date-picker v-model="form.occurredAt" />
          </t-form-item>
          <t-form-item label="核验说明">
            <t-textarea v-model="form.reason" />
          </t-form-item>
        </template>
        <t-form-item
          v-if="decision?.decision==='confirm'"
          label="请按独立账户证明重新输入完整银行账号"
        >
          <t-input
            v-model="form.accountNumber"
            autocomplete="off"
          />
        </t-form-item>
        <t-form-item
          v-if="decision?.decision!=='return'"
          :label="decision?'本人核对的开户名称和账号证明（与原回单核对一致）':'银行交易回单'"
        >
          <!-- ui-rules-ignore: native-file-input; private bank evidence picker. -->
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            aria-label="上传银行核验依据"
            @change="choose"
          >
        </t-form-item>
        <t-form-item label="当前登录密码">
          <t-input
            v-model="password"
            type="password"
            autocomplete="current-password"
          />
        </t-form-item>
        <t-button
          :loading="busy"
          @click="save"
        >
          {{ decision?'提交核验决定':'提交独立核验' }}
        </t-button>
      </t-form>
    </t-drawer>
  </section>
</template>
