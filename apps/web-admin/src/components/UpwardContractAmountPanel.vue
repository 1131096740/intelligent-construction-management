<script setup lang="ts">
import { onBeforeUnmount,ref,watch } from "vue";
import { fetchUpwardAmounts,prepareUpwardAmount,decideUpwardAmount,type UpwardAmountData } from "../api/upward-contract-amount.api";
import { uploadPrivateFile } from "../api/core-flow-read.api";
import { formatUnknownApiError } from "../api/error-message";
import { yuanTextToCentsText,centsTextToYuanText } from "../lib/money";
const props=defineProps<{projectId:string}>(),emit=defineEmits<{changed:[]}>();
const data=ref<UpwardAmountData|null>(null),show=ref(false),busy=ref(false),error=ref("");
const contract=ref(""),nature=ref("fixed"),amount=ref(""),date=ref(new Date().toISOString().slice(0,10)),reason=ref(""),password=ref("");
const file=ref<File|null>(null),fileId=ref<string|null>(null),decision=ref<{id:string;action:string}|null>(null);
let key=crypto.randomUUID(),generation=0;
async function load(){const current=++generation;data.value=null;try{const result=await fetchUpwardAmounts(props.projectId);if(current===generation)data.value=result;}catch(cause){if(current===generation)error.value=formatUnknownApiError(cause,"金额修订读取失败");}}
function start(){contract.value="";nature.value="fixed";amount.value="";reason.value="";password.value="";file.value=null;fileId.value=null;decision.value=null;key=crypto.randomUUID();show.value=true;}
async function save(){if(busy.value)return;const projectId=props.projectId,context=generation;busy.value=true;error.value="";try{
 if(decision.value)await decideUpwardAmountWithCapability(decision.value.id,decision.value.action,password.value);
 else {
  if(!file.value)throw new Error("请上传本次金额确认或修订依据");
  if(!fileId.value)fileId.value=(await uploadPrivateFileWithCapability(file.value,file.value.name)).id;
  if(projectId!==props.projectId||context!==generation)return;
  const previous=data.value?.revisions.filter(r=>r.contractId===contract.value&&r.status==='confirmed').sort((a,b)=>b.effectiveAt.localeCompare(a.effectiveAt)||(b.confirmedAt??"").localeCompare(a.confirmedAt??"")||b.id.localeCompare(a.id))[0];
  await prepareUpwardAmountWithCapability({projectId,contractId:contract.value,...(previous?{supersedesId:previous.id}:{}),amountNature:nature.value,...(nature.value==='fixed'?{amountCents:yuanTextToCentsText(amount.value)}:{}),effectiveAt:`${date.value}T00:00:00+08:00`,reason:reason.value,evidenceFileId:fileId.value,confirmationPassword:password.value,idempotencyKey:key});
 }
 if(projectId!==props.projectId||context!==generation)return;
 show.value=false;password.value="";await load();emit("changed");
 }catch(cause){error.value=formatUnknownApiError(cause,"金额修订失败");}finally{busy.value=false;}}
function chooseFile(event:Event){file.value=(event.target as HTMLInputElement).files?.[0]??null;fileId.value=null;}
function decide(id:string,action:string){decision.value={id,action};password.value="";show.value=true;}
watch(()=>props.projectId,()=>{show.value=false;password.value="";void load();},{immediate:true});onBeforeUnmount(()=>{generation++;password.value="";});

async function prepareUpwardAmountWithCapability(arg0: Parameters<typeof prepareUpwardAmount>[0]) {
  const capability = await fetchUpwardAmounts(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return prepareUpwardAmount(arg0);
}
async function decideUpwardAmountWithCapability(arg0: Parameters<typeof decideUpwardAmount>[0], arg1: Parameters<typeof decideUpwardAmount>[1], arg2: Parameters<typeof decideUpwardAmount>[2]) {
  const capability = await fetchUpwardAmounts(props.projectId);
  const operationAllowed = capability.canReview;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return decideUpwardAmount(arg0, arg1, arg2);
}
async function uploadPrivateFileWithCapability(arg0: Parameters<typeof uploadPrivateFile>[0], arg1: Parameters<typeof uploadPrivateFile>[1]) {
  const capability = await fetchUpwardAmounts(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return uploadPrivateFile(arg0, arg1);
}
</script>
<template>
  <section aria-label="对上合同金额修订">
    <h3>对上合同金额确认与修订</h3>
    <p>补定金额、变更及更正均保留原记录。填写修订后的完整金额；不重复叠加原额，不影响已确认成本或应收。</p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-button
      v-if="data?.canPrepare"
      variant="outline"
      @click="start"
    >
      追加对上金额确认或修订
    </t-button>
    <div
      v-for="row in data?.revisions ?? []"
      :key="row.id"
    >
      <p>{{ data?.contracts.find(c=>c.id===row.contractId)?.label }} · {{ row.amountCents===null?'未约定总额':`${centsTextToYuanText(row.amountCents)} 元` }} · {{ row.status==='confirmed'?'已确认':row.status==='returned'?'已退回':'待合同主管确认' }} · 生效日期 {{ row.effectiveAt.slice(0,10) }}</p>
      <p>{{ row.reason }}</p>
      <template v-if="row.canConfirm">
        <t-button @click="decide(row.id,'confirm')">
          核对确认
        </t-button><t-button
          variant="text"
          @click="decide(row.id,'return')"
        >
          退回补充
        </t-button>
      </template>
    </div>
    <t-drawer
      v-model:visible="show"
      header="对上合同金额修订"
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
          <t-form-item label="原对上合同">
            <t-select
              v-model="contract"
              :options="(data?.contracts??[]).map(c=>({value:c.id,label:c.label}))"
            />
          </t-form-item>
          <t-form-item label="修订后金额性质">
            <t-select
              v-model="nature"
              :options="[{value:'fixed',label:'确定金额'},{value:'uncapped',label:'未约定总额'}]"
            />
          </t-form-item>
          <t-form-item
            v-if="nature==='fixed'"
            label="修订后完整金额（元）"
          >
            <t-input v-model="amount" />
          </t-form-item>
          <t-form-item label="生效日期">
            <t-date-picker v-model="date" />
          </t-form-item>
          <t-form-item label="金额确认或修订依据">
            <!-- ui-rules-ignore: native-file-input; private evidence file selection. -->
            <input
              aria-label="上传对上金额修订依据"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              @change="chooseFile"
            >
          </t-form-item>
          <t-form-item label="修订原因">
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
          {{ decision?'确认本次处理':'提交合同主管核对' }}
        </t-button>
      </t-form>
    </t-drawer>
  </section>
</template>
