<script setup lang="ts">
import { computed,onBeforeUnmount,ref,watch } from "vue";
import { fetchEconomicReviews,prepareEconomicSettlement,prepareEconomicReview,decideEconomicReview,type EconomicReviewData } from "../api/contract-economic-review.api";
import { formatUnknownApiError } from "../api/error-message";
import { centsTextToYuanText,yuanTextToCentsText } from "../lib/money";
const props=defineProps<{projectId:string}>();
const emit=defineEmits<{changed:[]}>();
const data=ref<EconomicReviewData|null>(null),error=ref("");const busy=ref(false),show=ref(false);
const supersedes=ref<string|undefined>();
const targetSource=ref("");
const targets=computed(()=>data.value?.documents.filter(d=>[left.value,right.value].includes(d.ref)&&d.formal===false&&d.hasFormalHistory).map(d=>({value:d.ref,label:d.reference+" · "+d.title}))??[]);
const left=ref(""),right=ref(""),relation=ref("independent"),reason=ref(""),password=ref("");
const lines=ref<Array<{scope:string;left:string;right:string;owner:"left"|"right"}>>([]);
const scopeSettlement=ref<EconomicReviewData["pendingSettlements"][number]|null>(null);
const scopeAmounts=ref<Record<string,string>>({});
const scopeVisible=ref(false);
async function saveScope(){if(busy.value||!scopeSettlement.value)return;busy.value=true;error.value="";try{await prepareEconomicSettlementWithCapability({projectId:props.projectId,sourceRef:scopeSettlement.value.ref,confirmationPassword:password.value,allocations:Object.entries(scopeAmounts.value).filter(([,v])=>v.trim()).map(([scopeKey,value])=>({scopeKey,amountCents:yuanTextToCentsText(value)}))});scopeVisible.value=false;password.value="";await load();emit("changed");}catch(cause){error.value=formatUnknownApiError(cause,"结算履约范围保存失败");}finally{busy.value=false;}}
const decision=ref<{id:string;revision:number;decision:"confirm"|"return"}|null>(null);
let sequence=0;let alive=true;let key=crypto.randomUUID();
const relations=[{label:"独立履约",value:"independent"},{label:"补充文书（有部分覆盖）",value:"supplement"},{label:"替代文书",value:"replacement"},{label:"共同依据",value:"shared_evidence"}];
const statuses:Record<string,string>={pending_review:"待合同专业复核",pending_finance:"待财务核对",confirmed:"已确认统计及结算归属",returned:"已退回"};
const options=computed(()=>data.value?.documents.map(d=>({value:d.ref,label:`${d.reference} · ${d.title} · ${d.counterparty}`}))??[]);
function label(ref:string){return options.value.find(o=>o.value===ref)?.label??"原文书已变更，请核对";}
async function load(){const current=++sequence;data.value=null;error.value="";busy.value=true;try{const value=await fetchEconomicReviews(props.projectId);if(alive&&current===sequence)data.value=value;}catch(e){if(alive&&current===sequence)error.value=formatUnknownApiError(e,"履约复核读取失败");}finally{if(alive&&current===sequence)busy.value=false;}}
function start(l="",r="",prior?:string){supersedes.value=prior;targetSource.value="";left.value=l;right.value=r;relation.value="independent";reason.value="";password.value="";lines.value=[];decision.value=null;key=crypto.randomUUID();show.value=true;}
function review(id:string,revision:number,action:"confirm"|"return"){decision.value={id,revision,decision:action};password.value="";reason.value="";show.value=true;}
async function save(){if(busy.value)return;busy.value=true;error.value="";try{
 if(decision.value)await decideEconomicReviewWithCapability(decision.value.id,{...decision.value,reason:reason.value,confirmationPassword:password.value});
 else await prepareEconomicReviewWithCapability({targetSourceRef:targetSource.value||undefined,supersedesReviewId:supersedes.value,projectId:props.projectId,leftSourceRef:left.value,rightSourceRef:right.value,relation:relation.value,reason:reason.value,confirmationPassword:password.value,idempotencyKey:key,
 coverage:relation.value==="independent"?[]:lines.value.map(l=>({scope:l.scope,owner:l.owner,leftAmountCents:yuanTextToCentsText(l.left),rightAmountCents:yuanTextToCentsText(l.right)}))});
 password.value="";show.value=false;await load();emit("changed");
 }catch(e){error.value=formatUnknownApiError(e,"履约复核办理失败");}finally{busy.value=false;}}
watch(()=>props.projectId,()=>{show.value=false;scopeVisible.value=false;password.value="";void load();},{immediate:true});
onBeforeUnmount(()=>{alive=false;sequence++;password.value="";});

async function prepareEconomicReviewWithCapability(arg0: Parameters<typeof prepareEconomicReview>[0]) {
  const capability = await fetchEconomicReviews(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return prepareEconomicReview(arg0);
}
async function decideEconomicReviewWithCapability(arg0: Parameters<typeof decideEconomicReview>[0], arg1: Parameters<typeof decideEconomicReview>[1]) {
  const capability = await fetchEconomicReviews(props.projectId);
  const operationAllowed = capability.canReview;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return decideEconomicReview(arg0, arg1);
}
async function prepareEconomicSettlementWithCapability(arg0: Parameters<typeof prepareEconomicSettlement>[0]) {
  const capability = await fetchEconomicReviews(props.projectId);
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号没有本次办理权限，请刷新台账");
  return prepareEconomicSettlement(arg0);
}
</script>
<template>
  <section
    aria-label="经济重复与履约复核"
    class="economic-review"
  >
    <h3>经济重复与履约复核</h3>
    <p>保留原文书金额，按履约分项确认唯一统计及结算归属。已有成本或款项须先核对，不直接覆盖历史。</p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-button
      :loading="busy"
      variant="outline"
      @click="load"
    >
      刷新复核
    </t-button>
    <t-button
      v-if="data?.canPrepare"
      variant="outline"
      @click="start()"
    >
      发起履约关系复核
    </t-button>
    <p v-if="data && !data.candidates.length">
      当前未发现相同相对方及相近资料；仍可主动关联实际重叠事项。
    </p>
    <article
      v-for="c in data?.candidates"
      :key="c.leftSourceRef+c.rightSourceRef"
      class="economic-review__row"
    >
      <strong>疑似重叠，须核对</strong><p>{{ label(c.leftSourceRef) }}</p><p>{{ label(c.rightSourceRef) }}</p>
      <t-button
        v-if="data?.canPrepare"
        variant="text"
        @click="start(c.leftSourceRef,c.rightSourceRef)"
      >
        核对两份文书
      </t-button>
    </article>
    <article
      v-for="r in data?.reviews"
      :key="r.id"
      class="economic-review__row"
    >
      <strong>{{ statuses[r.status] }}</strong><p>{{ label(r.leftSourceRef) }} / {{ label(r.rightSourceRef) }}</p>
      <p>{{ relations.find(item=>item.value===r.relation)?.label }}：{{ r.reason }}</p>
      <p
        v-for="line in r.coverage"
        :key="line.scope"
      >
        {{ line.scope }}：左方 {{ centsTextToYuanText(line.leftAmountCents) }} 元，右方 {{ centsTextToYuanText(line.rightAmountCents) }} 元；由{{ line.owner==='left'?'左方':'右方' }}计入及结算
      </p>
      <t-button
        v-if="r.status==='confirmed' && data?.canPrepare"
        variant="text"
        @click="start(r.leftSourceRef,r.rightSourceRef,r.id)"
      >
        追加复核更正
      </t-button>
      <p v-if="r.returnReason">
        退回原因：{{ r.returnReason }}
      </p>
      <template v-if="r.canContractReview || r.canFinanceReview">
        <t-button @click="review(r.id,r.revision,'confirm')">
          {{ r.canFinanceReview?'财务核对确认':'合同专业确认' }}
        </t-button><t-button
          variant="outline"
          @click="review(r.id,r.revision,'return')"
        >
          退回补充
        </t-button>
      </template>
    </article>
    <article
      v-for="pending in data?.pendingSettlements ?? []"
      :key="pending.ref"
      class="economic-review__row"
    >
      <strong>待确认结算履约分项：{{ pending.label }}</strong>
      <p>{{ label(pending.contractRef) }} · 本次结算 {{ centsTextToYuanText(pending.amountCents) }} 元</p>
      <t-button
        v-if="data?.canPrepare"
        variant="outline"
        @click="scopeSettlement=pending;scopeAmounts={};password='';scopeVisible=true"
      >
        核对本次结算范围
      </t-button>
    </article>
    <t-drawer
      v-model:visible="scopeVisible"
      header="本次结算履约分项"
      size="90%"
      :footer="false"
    >
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
      <p>金额单位：元。只分配归属于本合同的分项；合计须等于本次结算金额。保存后仍须按原结算流程正式确认。</p>
      <t-form label-align="top">
        <t-form-item
          v-for="scope in scopeSettlement?.scopes.filter(s=>s.capacityCents!=='0') ?? []"
          :key="scope.key"
          :label="scope.label+'（分项总额度 '+centsTextToYuanText(scope.capacityCents)+' 元）'"
        >
          <t-input v-model="scopeAmounts[scope.key]" />
        </t-form-item>
        <t-form-item label="当前登录密码">
          <t-input
            v-model="password"
            type="password"
          />
        </t-form-item>
        <t-button
          :loading="busy"
          @click="saveScope"
        >
          保存本次结算范围
        </t-button>
      </t-form>
    </t-drawer>
    <t-drawer
      v-model:visible="show"
      header="履约范围与统计归属复核"
      size="90%"
      :footer="false"
      :close-on-overlay-click="false"
    >
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
      <t-form
        label-align="top"
        @submit.prevent="save"
      >
        <template v-if="!decision">
          <t-form-item label="左方文书">
            <t-select
              v-model="left"
              :options="options"
              filterable
            />
          </t-form-item>
          <t-form-item label="右方文书">
            <t-select
              v-model="right"
              :options="options.filter(o=>o.value!==left)"
              filterable
            />
          </t-form-item>
          <t-form-item
            v-if="targets.length>1"
            label="本次先确认生效的文书（另一份按当前有效版本复核）"
          >
            <t-select
              v-model="targetSource"
              :options="targets"
            />
          </t-form-item>
          <t-form-item label="履约关系">
            <t-select
              v-model="relation"
              :options="relations"
            />
          </t-form-item>
          <template v-if="relation!=='independent'">
            <p>逐项填写实际重叠的工程分项、批次或期间；未列出的部分仍由各自文书承担。金额单位：元。</p>
            <div
              v-for="(line,index) in lines"
              :key="index"
              class="economic-review__row"
            >
              <t-form-item label="履约分项/批次/期间">
                <t-input v-model="line.scope" />
              </t-form-item>
              <t-form-item label="左方文书覆盖金额">
                <t-input v-model="line.left" />
              </t-form-item>
              <t-form-item label="右方文书覆盖金额">
                <t-input v-model="line.right" />
              </t-form-item>
              <t-form-item label="唯一统计及结算归属">
                <t-select
                  v-model="line.owner"
                  :options="[{label:'左方文书',value:'left'},{label:'右方文书',value:'right'}]"
                />
              </t-form-item>
              <t-button
                variant="text"
                @click="lines.splice(index,1)"
              >
                移除此分项
              </t-button>
            </div>
            <t-button
              variant="outline"
              @click="lines.push({scope:'',left:'',right:'',owner:'left'})"
            >
              增加重叠分项
            </t-button>
          </template>
        </template>
        <t-form-item :label="decision?.decision==='return'?'退回原因':'范围依据及复核说明'">
          <t-textarea v-model="reason" />
        </t-form-item>
        <t-form-item label="当前登录密码确认">
          <t-input
            v-model="password"
            type="password"
            autocomplete="current-password"
          />
        </t-form-item>
        <t-button
          theme="primary"
          :loading="busy"
          @click="save"
        >
          {{ decision?'确认本次处理':'提交专业复核' }}
        </t-button>
      </t-form>
    </t-drawer>
  </section>
</template>
<style scoped>
.economic-review { margin-block:var(--jg-space-4); }
.economic-review__row { padding:var(--jg-space-3); margin-block:var(--jg-space-3); border:1px solid var(--jg-border); border-radius:var(--jg-radius-md); overflow-wrap:anywhere; }
</style>
