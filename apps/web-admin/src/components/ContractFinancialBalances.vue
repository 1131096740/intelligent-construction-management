<script setup lang="ts">
import {exportCompanyTransfers} from "../api/company-transfer.api";
import { onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchContractFinancialBalances, type OperatingProjectionAggregateReadModel } from "../api/core-flow-read.api";
import { centsTextToYuanText } from "../lib/money";
import { formatUnknownApiError } from "../api/error-message";
const props = defineProps<{ projectId?: string; companyEntityId?: string; asOf?: string }>();
const router = useRouter();
const data = ref<OperatingProjectionAggregateReadModel | null>(null);
const error = ref("");
const busy = ref(false);
let generation = 0;
async function load() {
 const request = ++generation; data.value = null; error.value = "";
 busy.value = true;
 try { const result = await fetchContractFinancialBalances(props); if(request === generation) data.value = result; }
 catch(cause) { if(request === generation) error.value = formatUnknownApiError(cause,"财务余额读取失败，请重试"); }
 finally { if(request === generation) busy.value = false; }
}
watch(() => [props.projectId,props.companyEntityId,props.asOf],load,{immediate:true});
onBeforeUnmount(() => { generation++; });
async function exportTransfers(){try{await exportCompanyTransfers({projectsOnly:"true",...props.projectId?{projectId:props.projectId}:{},...props.companyEntityId?{companyId:props.companyEntityId}:{},...props.asOf?{asOf:props.asOf}:{}});}catch(e){error.value=formatUnknownApiError(e,"互转余额导出失败");}}
function amount(value: string) { return centsTextToYuanText(value); }
</script>
<template>
  <router-link :to="{path:'/公司互转台账',query:{projectId,companyId:companyEntityId,asOf}}">查看公司互转、在途及往来台账</router-link>
  <section
    aria-label="分类财务余额"
    class="financial-balances"
  >
    <h3>{{ companyEntityId ? (projectId ? '所选公司在本项目的余额' : '所选公司在授权项目的余额') : (projectId ? '项目应收应付与内部往来' : '授权项目应收应付与内部往来') }}</h3>
    <p>已确认债务减有效核销形成余额；付款申请、批准额度和合同承诺不作为已付款。对上往来不重复计入项目收入或成本。</p>
    <t-loading :loading="busy">
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
      <template v-if="data">
        <section v-if="data.companyTransferBalances?.length" aria-label="公司借款往来分项">
          <h4>公司借款往来与在途（元）</h4><t-button variant="text" @click="exportTransfers">导出互转和余额分项</t-button><p>按当前项目、公司和基准日列示；借款应收与应还分别核对，资金转存不计入合同收入或成本。公司自有资金另见互转台账。</p>
          <p v-for="b in data.companyTransferBalances" :key="`${b.companyId}:${b.projectId}`">{{ b.companyName }} · {{ b.projectName ?? "项目资金" }} · 借款应收 {{ amount(b.receivableCents) }} · 借款应还 {{ amount(b.payableCents) }} · 旧代付应收 {{ amount(b.legacyReceivableCents ?? "0") }} · 旧代付应还 {{ amount(b.legacyPayableCents ?? "0") }} · 在途 {{ amount(b.inTransitCents) }}</p>
        </section>
        <p>业务基准日：{{ data.asOf.businessDate }} · {{ data.integrity.statusLabel }} · 金额单位：元</p>
        <t-alert
          v-if="!data.integrity.moneyComplete"
          theme="warning"
          message="当前资料不完整，以下为已纳入事实的余额，不能当作全部余额。"
        />
        <p
          v-for="notice in data.integrity.notices"
          :key="notice"
        >
          {{ notice }}
        </p>
        <div class="financial-balances__rows">
          <article
            v-for="row in data.relationshipTotals ?? []"
            :key="row.relationship"
          >
            <strong>{{ row.label }}</strong>
            <p>确认成本：{{ amount(row.confirmedCostCents) }} 元</p>
            <p>应收余额：{{ amount(row.receivableCents) }} 元</p>
            <p>应付余额：{{ amount(row.payableCents) }} 元</p>
            <p>代付往来应收：{{ amount(row.interSubjectReceivableCents) }} 元；应还代付款：{{ amount(row.interSubjectPayableCents) }} 元</p>
          </article>
        </div>
        <p>对外应收：{{ amount(data.operating.receivableCents) }} 元；应付余额：{{ amount(data.operating.payableCents) }} 元。</p>
        <p v-if="!companyEntityId">
          对上内部应收：{{ amount(data.operating.internalReceivableCents ?? '0') }} 元（项目合并单列）。
        </p>
        <p>{{ companyEntityId ? '该公司项目资金' : '我方公司项目资金合计' }}：{{ amount(data.actualFunds.companyProjectFundsCents) }} 元；代垫：{{ amount(data.actualFunds.companyAdvanceForProjectCents) }} 元。</p>
        <p v-if="companyEntityId">
          此处为公司主体余额；项目整体利润不重复归属于各参与公司。
        </p>
      </template>
    </t-loading>
    <t-button
      variant="outline"
      :loading="busy"
      @click="load"
    >
      刷新余额
    </t-button>
    <t-button
      variant="text"
      @click="router.push({ path: '/资金执行案件', query: { projectId } })"
    >
      收付款匹配与核销
    </t-button>
  </section>
</template>
<style scoped>
.financial-balances { padding-block: var(--jg-space-3,12px); }
.financial-balances__rows { display: flex; flex-wrap: wrap; gap: var(--jg-space-3,12px); }
.financial-balances__rows article { padding: var(--jg-space-3,12px); background: var(--jg-surface-secondary); flex: 1 1 210px; overflow-wrap: anywhere; }
</style>
