<script setup lang="ts">
import {computed,onBeforeUnmount,reactive,ref,watch} from "vue";
import {useRouter} from "vue-router";
import {fetchReceiptMatches,prepareReceiptMatch,decideReceiptMatch,type ReceiptMatchData} from "../api/upward-receipt-match.api";
import {centsTextToYuanText,yuanTextToCentsText} from "../lib/money";
import {formatUnknownApiError} from "../api/error-message";
const props=defineProps<{projectId:string}>(),emit=defineEmits<{changed:[]}>(),router=useRouter();
const data=ref<ReceiptMatchData|null>(null),error=ref(""),busy=ref(false),visible=ref(false),password=ref(""),key=ref(crypto.randomUUID());
const form=reactive({receiptFactId:"",settlementLedgerId:"",originalId:"",amountYuan:"",occurredAt:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"}),reason:""});
let generation=0;
const options=computed(()=>(data.value?.receipts??[]).map(r=>({value:r.id,label:`${r.occurredAt.slice(0,10)} 到账 ${centsTextToYuanText(r.amountCents)} 元；待匹配 ${centsTextToYuanText((BigInt(r.amountCents)-BigInt(r.matchedCents)).toString())} 元`})));
async function load(){const current=++generation;data.value=null;try{const result=await fetchReceiptMatches(props.projectId);if(current===generation)data.value=result;}catch(cause){if(current===generation)error.value=formatUnknownApiError(cause,"到账匹配读取失败");}}
watch(()=>props.projectId,()=>{visible.value=false;password.value="";busy.value=false;error.value="";void load();},{immediate:true});onBeforeUnmount(()=>{generation++;});
function open(original?:ReceiptMatchData["matches"][number]){Object.assign(form,{receiptFactId:original?.receiptFactId??"",settlementLedgerId:original?.settlementLedgerId??"",originalId:original?.id??"",amountYuan:"",reason:""});key.value=crypto.randomUUID();password.value="";visible.value=true;}
async function save(){if(busy.value)return;const context=generation;busy.value=true;error.value="";try{await prepareReceiptMatchWithCapability({projectId:props.projectId,receiptFactId:form.receiptFactId,settlementLedgerId:form.settlementLedgerId,...(form.originalId?{originalId:form.originalId}:{}),amountCents:yuanTextToCentsText(form.amountYuan),occurredAt:form.occurredAt,reason:form.reason,confirmationPassword:password.value,idempotencyKey:key.value});if(context!==generation)return;visible.value=false;password.value="";busy.value=false;await load();emit("changed");}catch(cause){if(context===generation)error.value=formatUnknownApiError(cause,"核销登记失败");}finally{if(context===generation)busy.value=false;}}
async function decide(id:string,decision:string){if(busy.value)return;const context=generation;busy.value=true;error.value="";try{await decideReceiptMatchWithCapability(id,decision,password.value);if(context!==generation)return;password.value="";busy.value=false;await load();emit("changed");}catch(cause){if(context===generation)error.value=formatUnknownApiError(cause,"核销确认失败");}finally{if(context===generation)busy.value=false;}}

async function prepareReceiptMatchWithCapability(arg0: Parameters<typeof prepareReceiptMatch>[0]) {
  const capability = await fetchReceiptMatches(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return prepareReceiptMatch(arg0);
}
async function decideReceiptMatchWithCapability(arg0: Parameters<typeof decideReceiptMatch>[0], arg1: Parameters<typeof decideReceiptMatch>[1], arg2: Parameters<typeof decideReceiptMatch>[2]) {
  const capability = await fetchReceiptMatches(props.projectId);
  const operationAllowed = capability.canReview;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return decideReceiptMatch(arg0, arg1, arg2);
}
</script>
<template>
  <section aria-label="对上到账匹配与核销">
    <h3>对上到账匹配与核销</h3><p>先在资金执行登记真实银行到账并归入项目，再匹配对上结算。核销沿用原到账，不重复增加现金、收入或成本。</p>
    <t-button
      variant="outline"
      @click="router.push({path:'/资金执行案件',query:{projectId}})"
    >
      登记或核对真实到账
    </t-button><t-button
      :disabled="!data?.receipts.length"
      @click="open()"
    >
      匹配对上应收
    </t-button><t-button
      variant="text"
      @click="load"
    >
      刷新待匹配
    </t-button>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <p
      v-for="item in options"
      :key="item.value"
    >
      {{ item.label }}
    </p>
    <t-form
      v-if="visible"
      @submit="save"
    >
      <t-form-item label="原实际到账">
        <t-select
          v-model="form.receiptFactId"
          :disabled="!!form.originalId"
          :options="options"
        />
      </t-form-item>
      <t-form-item label="对上结算">
        <t-select
          v-model="form.settlementLedgerId"
          :disabled="!!form.originalId"
          :options="(data?.settlements??[]).map(s=>({value:s.id,label:s.label}))"
        />
      </t-form-item>
      <t-form-item :label="form.originalId?'解除金额（元）':'本次核销（元）'">
        <t-input v-model="form.amountYuan" />
      </t-form-item>
      <t-form-item label="核销日期">
        <t-date-picker v-model="form.occurredAt" />
      </t-form-item><t-form-item label="核对依据与原因">
        <t-textarea v-model="form.reason" />
      </t-form-item>
      <t-form-item label="确认密码">
        <t-input
          v-model="password"
          type="password"
          autocomplete="new-password"
        />
      </t-form-item><t-button
        type="submit"
        :loading="busy"
      >
        提交财务复核
      </t-button><t-button
        variant="text"
        @click="visible=false"
      >
        取消
      </t-button>
    </t-form>
    <t-input
      v-if="data?.matches.some(r=>r.canConfirm) && !visible"
      v-model="password"
      type="password"
      placeholder="财务确认密码"
      autocomplete="new-password"
    />
    <article
      v-for="row in data?.matches??[]"
      :key="row.id"
    >
      <p>{{ row.originalId?'解除匹配':'对上核销' }} · {{ centsTextToYuanText(row.amountCents) }} 元 · {{ row.status==='confirmed'?'已确认':row.status==='returned'?'已退回':'待财务确认' }} · {{ row.reason }}</p><template v-if="row.canConfirm">
        <t-button
          :loading="busy"
          @click="decide(row.id,'confirm')"
        >
          确认核销
        </t-button><t-button
          variant="text"
          :loading="busy"
          @click="decide(row.id,'return')"
        >
          退回
        </t-button>
      </template><t-button
        v-if="row.status==='confirmed'&&!row.originalId"
        variant="text"
        @click="open(row)"
      >
        追加解除匹配
      </t-button>
    </article>
  </section>
</template>
