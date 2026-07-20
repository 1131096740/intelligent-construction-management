<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchSpotProcurements, type SpotProcurementListItemReadModel, type SpotProcurementReceiptSummaryReadModel } from "../../api/spot-procurement.api";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";

const router=useRouter(); const rows=ref<SpotProcurementListItemReadModel[]>([]); const loading=ref(false); const error=ref("");
const listMeta=ref({page:1,pageSize:20,total:0,totalPages:0});
const status=ref<""|"approved_in_progress"|"closed">("");
const receiptSummary=(row: SpotProcurementListItemReadModel) => row.receipt as SpotProcurementReceiptSummaryReadModel;
const receiptStatus=(row:SpotProcurementListItemReadModel)=>{
  if (row.status === "closed") return "已办结";
  const receipt = receiptSummary(row);
  if (!receipt?.openAfterActualPayment) return "待实际付款";
  return receipt.statusLabel ?? "待确认收货";
};
const paymentStatus=(row:SpotProcurementListItemReadModel)=>row.payment.statusLabel ?? "付款事实待读取";
const tableRows=computed(()=>rows.value.map(row=>({
  ...row,
  projectName:row.project.name,
  handlerName:row.handler.name,
  paymentStatus:paymentStatus(row),
  receiptStatus:receiptStatus(row)
})));
async function load(page=1){loading.value=true;error.value="";try{const result=await fetchSpotProcurements({surface:"receipt",view:"active",status:status.value||undefined,page,pageSize:listMeta.value.pageSize});rows.value=result.items;listMeta.value=result.pagination;}catch(e){error.value=e instanceof Error?e.message:'读取收货工作台失败';}finally{loading.value=false;}}
function changePage(page:number){void load(page);}
onMounted(load);
</script>
<template>
  <section class="page">
    <BusinessPageHeader
      title="收货确认工作台"
      description="首笔实际付款后才开放收货；同一次最终收货可上传多张现场照片，不创建收货批次。"
    /><BusinessTableToolbar
      title="最终收货任务"
      description="收货状态直接来自实际付款与收货复核事实，不再展示供应商或余额抵扣。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="loading"
          @click="load(1)"
        >
          刷新
        </t-button>
      </template>
      <label class="filter-field"><span>生命周期</span><t-select
        v-model="status"
        :options="[{label:'全部收货记录',value:''},{label:'办理中',value:'approved_in_progress'},{label:'已办结',value:'closed'}]"
        @change="load(1)"
      /></label>
    </BusinessTableToolbar><BusinessFeedback
      v-if="error"
      state="permission"
      title="收货工作台暂不可用"
      :description="error"
    /><t-table
      v-else
      row-key="id"
      :loading="loading"
      :columns="[{colKey:'code',title:'采购编号'},{colKey:'projectName',title:'项目'},{colKey:'handlerName',title:'采购经办人'},{colKey:'paymentStatus',title:'付款状态'},{colKey:'receiptStatus',title:'收货状态'},{colKey:'operation',title:'操作',width:90}]"
      :data="tableRows"
    >
      <template #operation="{row}">
        <t-link
          theme="primary"
          @click="router.push(`/零星采购收货/${row.id}`)"
        >
          办理
        </t-link>
      </template>
    </t-table><t-pagination
      v-if="listMeta.total>listMeta.pageSize"
      :current="listMeta.page"
      :page-size="listMeta.pageSize"
      :total="listMeta.total"
      @current-change="changePage"
    />
  </section>
</template>
<style scoped>.page{display:grid;gap:var(--jg-space-lg)}.filter-field{display:grid;gap:var(--jg-space-xs);min-width:180px}.filter-field span{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}</style>
