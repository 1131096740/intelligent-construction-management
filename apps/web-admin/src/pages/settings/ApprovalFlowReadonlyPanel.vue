<template>
  <t-card
    title="审批规则只读配置"
    :bordered="true"
    class="settings-card approval-settings-card"
  >
    <p class="hint">
      此处只读展示固定规则、当前在岗人员及缺岗。零采新申请采用当前版本并联职责；其他业务保留各自现行冻结流程。已有单据以实际冻结流程为准，不开放在线编辑。发起人兼任审批岗位或一人兼任多岗时，均须本人逐节点审批并签名，不跳过节点。正式审批单仅在最终通过后有效；零采当前并联轮可查看明确标记未完成的办理中预览。签名取自对应实际审批记录。
    </p>
    <t-select
      v-model="selectedProjectId"
      :options="projectOptions"
      placeholder="选择有权项目查看岗位人员"
      :loading="loading"
      @change="selectProject"
    />
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <p v-if="!loading && !data?.projects.length && !error">
      暂无有权查看的在用项目
    </p>
    <div class="approval-flow-grid">
      <article
        v-for="rule in approvalFlowRules"
        :key="rule.id"
        class="approval-flow"
      >
        <header>
          <div>
            <strong>{{ rule.title }}</strong>
            <span>{{ rule.businessType }}</span>
          </div>
          <small>{{ rule.mechanismLabel ?? "现行冻结流程" }} · 只读</small>
        </header>
        <ol>
          <li
            v-for="node in rule.nodes"
            :key="`${rule.id}-${node.name}`"
          >
            <span class="node-index">{{ rule.nodes.indexOf(node) + 1 }}</span>
            <div>
              <strong>{{ node.name }}</strong>
              <p>{{ modeLabel(node.mode) }} · {{ node.participantLabel || roleNames(node.roleKeys) }}</p>
              <p v-if="node.participantLabel || !node.roleKeys.length">
                按当前单据指定参与人
              </p>
              <p
                v-for="role in node.roleKeys"
                v-else
                :key="role"
              >
                {{ roleNames([role]) }}：{{ personnel(role) }}
              </p>
            </div>
          </li>
        </ol>
        <ul class="guardrail-list">
          <li
            v-for="item in rule.guardrails"
            :key="item"
          >
            {{ item }}
          </li>
        </ul>
      </article>
    </div>
  </t-card>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { approvalFlowRules, modeLabel, roleNames } from "./approval-flow-readonly.config";
import {fetchApprovalRuleAssignments, type ApprovalRuleAssignmentsReadModel} from "../../api/core-flow-read.api";
import {formatUnknownApiError} from "../../api/error-message";
const data=ref<ApprovalRuleAssignmentsReadModel|null>(null);
const selectedProjectId=ref("");const loading=ref(false);const error=ref("");let generation=0;
const projectOptions=computed(()=>data.value?.projects.map(project=>({value:project.id,label:project.name}))??[]);
function personnel(role:string){
 if(loading.value)return "正在读取";
 if(error.value || !data.value?.projectId)return "暂未读取";
 const people=data.value.roles.find(row=>row.roleKey===role)?.people??[];
 return people.length?people.map(person=>person.name).join("、"):"待配置：暂无在岗人员";
}
async function load(projectId?:string){
 const current=++generation;loading.value=true;error.value="";
 try{const result=await fetchApprovalRuleAssignments(projectId);if(current===generation){data.value=result;selectedProjectId.value=result.projectId??"";}}
 catch(cause){if(current===generation){data.value=null;error.value=formatUnknownApiError(cause,"读取当前审批岗位人员失败");}}
 finally{if(current===generation)loading.value=false;}
}
function selectProject(value:unknown){void load(typeof value==="string"?value:undefined);}
onMounted(()=>load());
</script>
<style scoped>
.approval-flow-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,20rem),1fr)); gap: var(--jg-space-md); margin-top: var(--jg-space-md); }
.approval-flow { border: 1px solid var(--jg-color-border); border-radius: var(--jg-radius-md); padding: var(--jg-space-md); min-width: 0; }
.approval-flow header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--jg-space-sm); }
.approval-flow header span { display: block; }
.approval-flow li { margin-bottom: var(--jg-space-sm); overflow-wrap: anywhere; }
.hint { color: var(--jg-color-text-secondary); }
</style>
