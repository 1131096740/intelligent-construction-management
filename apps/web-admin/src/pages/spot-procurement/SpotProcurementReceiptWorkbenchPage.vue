<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchSpotProcurements, type SpotProcurementListItemReadModel } from "../../api/spot-procurement.api";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";

const router=useRouter(); const rows=ref<SpotProcurementListItemReadModel[]>([]); const loading=ref(false); const error=ref("");
const receiptStatus=(row:SpotProcurementListItemReadModel)=>row.status==='closed'?'已办结':row.status!=='approved_in_progress'?'待收货':row.actualCostCents?'复核已通过':'收货草稿';
async function load(){loading.value=true;error.value="";try{rows.value=(await fetchSpotProcurements()).items.filter(row=>['approved_in_progress','closed'].includes(row.status));}catch(e){error.value=e instanceof Error?e.message:'读取收货工作台失败';}finally{loading.value=false;}}
onMounted(load);
</script>
<template>
  <section class="page">
    <BusinessPageHeader
      title="收货确认工作台"
      description="一张采购单对应一次最终收货；分车到场可在同一确认中上传多张照片。"
    /><BusinessTableToolbar
      title="最终收货任务"
      description="状态来自零星采购真实数据，不创建收货批次。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="loading"
          @click="load"
        >
          刷新
        </t-button>
      </template>
    </BusinessTableToolbar><BusinessFeedback
      v-if="error"
      state="permission"
      title="收货工作台暂不可用"
      :description="error"
    /><t-table
      v-else
      row-key="id"
      :loading="loading"
      :columns="[{colKey:'code',title:'采购编号'},{colKey:'projectName',title:'项目'},{colKey:'supplierName',title:'供应商'},{colKey:'handlerName',title:'经办人'},{colKey:'receiptStatus',title:'收货状态'},{colKey:'operation',title:'操作',width:90}]"
      :data="rows.map(row=>({...row,projectName:row.project.name,handlerName:row.handler.name,receiptStatus:receiptStatus(row)}))"
    >
      <template #operation="{row}">
        <t-link
          theme="primary"
          @click="router.push(`/零星采购收货/${row.id}`)"
        >
          办理
        </t-link>
      </template>
    </t-table>
  </section>
</template>
<style scoped>.page{display:grid;gap:var(--jg-space-lg)}</style>
