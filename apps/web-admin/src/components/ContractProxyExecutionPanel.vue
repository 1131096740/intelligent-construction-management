<script setup lang="ts">
import ApprovalDocumentDownload from "./approval/ApprovalDocumentDownload.vue";
import {useRouter} from "vue-router";
import { computed,onBeforeUnmount,ref,watch } from "vue";
import { fetchContractProxyExecutions,prepareContractProxyExecution,decideContractProxyExecution,type ProxyData,type ProxyEntry } from "../api/contract-proxy-execution.api";
import { uploadPrivateFile } from "../api/core-flow-read.api";
import { formatUnknownApiError } from "../api/error-message";
import { centsTextToYuanText,yuanTextToCentsText } from "../lib/money";
const router=useRouter();
const props=defineProps<{projectId:string}>(),emit=defineEmits<{changed:[]}>();
const data=ref<ProxyData|null>(null),busy=ref(false),error=ref(""),show=ref(false);
const source=ref(""),payer=ref(""),kind=ref("payment"),original=ref<ProxyEntry|null>(null);
const bankObservation=ref(""),receivingBankObservation=ref("");
const amount=ref(""),date=ref(new Date().toISOString().slice(0,10)),bank=ref(""),reason=ref(""),password=ref("");
const file=ref<File|null>(null),fileId=ref<string|null>(null),decision=ref<{id:string;action:"confirm"|"return"}|null>(null);
const allocations=ref<Array<{sourceRef:string;amountYuan:string}>>([]),requestId=ref("");
const requestOptions=computed(()=>(data.value?.requests??[]).filter(r=>r.sourceRef===source.value).map(r=>({value:r.id,label:`${r.label} · 未执行 ${centsTextToYuanText(r.remainingCents)} 元`})));
let sequence=0,key=crypto.randomUUID();
const kinds:Record<string,string>={payment:"实际代付",refund:"原代付款退款",repayment:"归还代付款"};
const statuses:Record<string,string>={pending_confirm:"待财务主管核对",confirmed:"已确认",returned:"已退回"};
async function load(){const current=++sequence;data.value=null;error.value="";try{const result=await fetchContractProxyExecutions(props.projectId);if(current===sequence)data.value=result;}catch(cause){if(current===sequence)error.value=formatUnknownApiError(cause,"代付往来读取失败");}}
function start(entryKind="payment",entry:ProxyEntry|null=null){if(entryKind==="repayment"&&entry?.frozenSource.debtor.kind==="participating_company"&&entry.frozenSource.actualPayer.kind==="participating_company"){void router.push({path:"/公司互转台账",query:{projectId:props.projectId,originalProxyId:entry.id}});return;}allocations.value=entry?.frozenSource.allocations?.map(a=>({sourceRef:a.sourceRef,amountYuan:""}))??[];bankObservation.value="";receivingBankObservation.value="";requestId.value="";kind.value=entryKind;original.value=entry;source.value="";payer.value="";amount.value="";bank.value="";reason.value="";password.value="";file.value=null;fileId.value=null;decision.value=null;key=crypto.randomUUID();show.value=true;}
function decide(entry:ProxyEntry,action:"confirm"|"return"){decision.value={id:entry.id,action};password.value="";show.value=true;}
function selectFile(event:Event){file.value=(event.target as HTMLInputElement).files?.[0]??null;fileId.value=null;}
async function save(){if(busy.value)return;const projectId=props.projectId,context=sequence;busy.value=true;error.value="";try{
 if(decision.value)await decideContractProxyExecutionWithCapability(decision.value.id,decision.value.action,password.value);
 else {
  if(!file.value)throw new Error("请上传本次银行收付凭证");
  if(!fileId.value)fileId.value=(await uploadPrivateFileWithCapability(file.value,file.value.name)).id;
  if(projectId!==props.projectId||context!==sequence)return;
  await prepareContractProxyExecutionWithCapability({projectId,...(receivingBankObservation.value?{receivingBankObservationId:receivingBankObservation.value}:{}),...(bankObservation.value?{bankObservationId:bankObservation.value}:{}),sourceRef:source.value,...(requestId.value?{paymentRequestId:requestId.value}:{}),...(allocations.value.length?{allocations:allocations.value.map(a=>({sourceRef:a.sourceRef,amountCents:yuanTextToCentsText(a.amountYuan)}))}:{}),entryKind:kind.value,...(original.value?{originalId:original.value.id}:{}),amountCents:yuanTextToCentsText(amount.value),occurredAt:`${date.value}T00:00:00+08:00`,actualPayerKey:payer.value,bankReference:bank.value,evidenceFileId:fileId.value,reason:reason.value,idempotencyKey:key,confirmationPassword:password.value});
 }
 if(projectId!==props.projectId||context!==sequence)return;
 password.value="";show.value=false;await load();emit("changed");
 }catch(cause){error.value=formatUnknownApiError(cause,"代付往来办理失败");}finally{busy.value=false;}}
watch(()=>props.projectId,()=>{show.value=false;password.value="";void load();},{immediate:true});onBeforeUnmount(()=>{sequence++;password.value="";});

async function prepareContractProxyExecutionWithCapability(arg0: Parameters<typeof prepareContractProxyExecution>[0]) {
  const capability = await fetchContractProxyExecutions(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return prepareContractProxyExecution(arg0);
}
async function decideContractProxyExecutionWithCapability(arg0: Parameters<typeof decideContractProxyExecution>[0], arg1: Parameters<typeof decideContractProxyExecution>[1], arg2: Parameters<typeof decideContractProxyExecution>[2]) {
  const capability = await fetchContractProxyExecutions(props.projectId);
  const operationAllowed = capability.canReview;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return decideContractProxyExecution(arg0, arg1, arg2);
}
async function uploadPrivateFileWithCapability(arg0: Parameters<typeof uploadPrivateFile>[0], arg1: Parameters<typeof uploadPrivateFile>[1]) {
  const capability = await fetchContractProxyExecutions(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return uploadPrivateFile(arg0, arg1);
}
</script>
<template>
  <section
    aria-label="代付与往来归还"
    class="proxy-panel"
  >
    <h3>代付与往来归还</h3>
    <p>原签约分类和债务人保持不变。代付只核销一次下游欠款；归还只清偿主体往来。按已批准付款申请登记执行结果；已实际发生而未关联审批的款项须说明事后补录原因。</p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-button
      variant="outline"
      :loading="busy"
      @click="start()"
    >
      登记真实代付
    </t-button>
    <t-button
      variant="text"
      @click="load"
    >
      刷新往来
    </t-button>
    <article
      v-for="entry in data?.entries ?? []"
      :key="entry.id"
      class="proxy-panel__row"
    >
      <strong>{{ entry.frozenSource.contractRelationship==='inside'?'表内（我方签约）':'表外（施工企业签约）' }} · {{ kinds[entry.entryKind] }} · {{ statuses[entry.status] }}</strong>
      <p>{{ entry.frozenSource.reference }} · {{ centsTextToYuanText(entry.amountCents) }} 元</p>
      <p>原债务人：{{ entry.frozenSource.debtor.name }}；原代付方：{{ entry.frozenSource.actualPayer.name }}；下游：{{ entry.frozenSource.counterparty }}</p>
      <p>{{ entry.reason }}</p>
      <template v-if="entry.canConfirm">
        <t-button @click="decide(entry,'confirm')">
          财务核对确认
        </t-button><t-button
          variant="outline"
          @click="decide(entry,'return')"
        >
          退回补充
        </t-button>
      </template>
      <template v-if="entry.status==='confirmed' && entry.entryKind==='payment'">
        <t-button
          variant="text"
          @click="start('refund',entry)"
        >
          登记原款退款
        </t-button><t-button
          variant="text"
          @click="start('repayment',entry)"
        >
          登记归还代付款
        </t-button>
      </template>
      <ApprovalDocumentDownload business-type="contract_proxy_execution" :business-id="entry.id" :refresh-key="entry.status" />
    </article>
    <t-drawer
      v-model:visible="show"
      :header="decision?'财务复核':kinds[kind]"
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
          <template v-if="kind==='payment'">
            <t-form-item label="原下游结算">
              <t-select
                v-model="source"
                :options="data?.sources ?? []"
                filterable
              />
            </t-form-item><t-form-item label="实际出款主体">
              <t-select
                v-model="payer"
                :options="data?.payers ?? []"
              />
            </t-form-item>
          </template>
          <t-form-item
            v-if="kind==='payment'"
            label="关联已批准付款申请（事后补录可留空并说明原因）"
          >
            <t-select
              v-model="requestId"
              :options="requestOptions"
              clearable
            />
          </t-form-item>
          <p v-if="kind!=='payment'">
            关联原代付：{{ original?.frozenSource.reference }}。后台按原冻结主体及未清往来余额核对。
          </p>
          <p v-if="allocations.length">
            本次流水只登记一次，分配合计必须等于实际金额；退款与归还也按原结算分配。
          </p>
          <div
            v-for="(allocation,index) in allocations"
            :key="index"
            class="proxy-panel__allocation"
          >
            <t-select
              v-model="allocation.sourceRef"
              aria-label="核销结算"
              :options="data?.sources ?? []"
            />
            <t-input
              v-model="allocation.amountYuan"
              aria-label="本结算核销金额（元）"
              placeholder="本结算核销金额（元）"
            />
            <t-button
              variant="text"
              @click="allocations.splice(index,1)"
            >
              移除本分配
            </t-button>
          </div>
          <t-button
            v-if="!requestId"
            variant="outline"
            @click="allocations.push({sourceRef:allocations.length?'':source,amountYuan:''})"
          >
            按多笔结算分配本次款项
          </t-button>
          <t-form-item label="实际金额（元）">
            <t-input v-model="amount" />
          </t-form-item>
          <t-form-item label="实际发生日期">
            <t-date-picker v-model="date" />
          </t-form-item>
          <t-form-item label="我方账户已核验银行流水（涉及公司账户必选）">
            <t-select
              v-model="bankObservation"
              :options="data?.observations??[]"
              filterable
              clearable
            />
          </t-form-item>
          <t-form-item
            v-if="kind==='repayment'"
            label="公司间归还：收款公司已核验流水"
          >
            <t-select
              v-model="receivingBankObservation"
              :options="data?.observations??[]"
              filterable
              clearable
              placeholder="双方均为我方公司时必选"
            />
          </t-form-item>
          <t-form-item label="银行流水号">
            <t-input v-model="bank" />
          </t-form-item>
          <t-form-item label="本次收付凭证">
            <!-- ui-rules-ignore: native-file-input; private evidence file selection. -->
            <input
              aria-label="上传代付凭证"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              @change="selectFile"
            >
          </t-form-item>
          <t-form-item label="实际收付依据及事后登记原因">
            <t-textarea v-model="reason" />
          </t-form-item>
        </template>
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
          {{ decision?'确认本次处理':'提交财务复核' }}
        </t-button>
      </t-form>
    </t-drawer>
  </section>
</template>
<style scoped>
.proxy-panel { margin-block:var(--jg-space-4,16px); }
.proxy-panel__row { padding:var(--jg-space-3,12px); border-bottom:1px solid var(--jg-border); overflow-wrap:anywhere; }
</style>