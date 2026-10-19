<script setup lang="ts">
import {useRouter} from "vue-router";
import {ref,watch,onBeforeUnmount} from "vue";
import {fetchCompanyBankEvents} from "../api/contract-proxy-execution.api";
import {formatUnknownApiError} from "../api/error-message";
const props=defineProps<{projectId:string;modelValue?:string}>(),emit=defineEmits<{"update:modelValue":[string]}>();
const router=useRouter();
const options=ref<Array<{value:string;label:string}>>([]),error=ref("");let sequence=0;
async function load(){const current=++sequence;options.value=[];error.value="";if(!props.projectId)return;try{const result=await fetchCompanyBankEvents(props.projectId);if(current===sequence)options.value=result;}catch(e){if(current===sequence)error.value=formatUnknownApiError(e,"银行流水候选读取失败");}}
watch(()=>props.projectId,()=>{emit("update:modelValue","");void load();},{immediate:true});onBeforeUnmount(()=>{sequence++;});
</script>
<template>
  <div>
    <span>已核验银行流水</span><t-select
      :value="modelValue"
      :options="options"
      filterable
      clearable
      placeholder="选择本次实际收付，避免重复登记"
      @change="emit('update:modelValue',String($event??''))"
    /><t-button
      variant="text"
      @click="router.push({path:'/资金执行案件',query:{projectId},hash:'#银行流水核验'})"
    >
      没有候选？提交银行流水核验
    </t-button><t-button
      variant="text"
      @click="load"
    >
      刷新银行流水
    </t-button><t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
  </div>
</template>
