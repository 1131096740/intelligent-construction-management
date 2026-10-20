<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../auth/auth.store";
import { CONTRACT_RELATIONSHIP_LABELS } from "@jiangkong/shared-domain";

const props = defineProps<{
  modelValue: "inside" | "outside" | "upward";
  projectId: string;
  mode: "new" | "takeover";
}>();
const emit = defineEmits<{ "update:modelValue": [value: "inside" | "outside" | "upward"] }>();
const router = useRouter();
const auth = useAuthStore();
const canMaintainProject = computed(() => (auth.user?.globalRoleKeys ?? []).some(role => role === "chairman" || role === "comprehensive_director"));
const options = (["inside", "outside", "upward"] as const).map(value => ({
  value, label: CONTRACT_RELATIONSHIP_LABELS[value]
}));
const explanation = computed(() => ({
  inside: "我方具体公司与供应商或班组签约。合同计入表内下游承诺，结算确认成本，付款只清偿原欠款。",
  outside: "本项目施工企业与供应商或班组签约。登记真实合同及签约依据，计入表外下游承诺；结算确认成本，付款不重复计成本。",
  upward: "本项目施工企业与我方具体公司签约。单独管理对上合同、结算和收款往来，不加入下游合同额或重复增加项目收入、成本。"
})[props.modelValue]);
function choose(value: string | number | boolean) {
  if (value === "inside" || value === "outside" || value === "upward") emit("update:modelValue", value);
}
function proceed() {
  if (!props.projectId || props.modelValue === "inside") return;
  void router.push({ path: "/合同工作台", query: {
    projectId: props.projectId, ledgerSection: "contracts",
    contractHandling: props.modelValue, entryMode: props.mode
  } });
}
</script>

<template>
  <t-card
    title="谁与谁签约？"
    class="contract-entry-choice"
  >
    <t-radio-group
      :value="modelValue"
      :options="options"
      aria-label="本次合同分类"
      @change="choose"
    />
    <p>{{ explanation }}</p>
    <p v-if="mode === 'takeover'">
      历史接管按原件中的真实签约双方选择；不补造过去审批。已有记录继续补充依据，不能换一个类别再登记一次。
    </p>
    <p v-else-if="modelValue !== 'inside'">
      施工企业自行签署合同，本系统登记真实依据并专业复核；内部复核不代表施工企业审批或用章。
    </p>
    <p>施工企业取项目唯一绑定，我方公司按真实参与主体选择。结算、付款继承原合同分类，代付不改变分类。</p>
    <t-space break-line>
      <t-button
        v-if="modelValue !== 'inside'"
        :disabled="!projectId"
        @click="proceed"
      >
        {{ mode === "takeover" ? "办理所选类别历史接管" : "登记所选类别合同" }}
      </t-button>
      <t-button
        v-if="canMaintainProject"
        variant="text"
        :disabled="!projectId"
        @click="router.push({ path: '/项目经营', query: { projectId, tab: 'settings' } })"
      >
        查看项目施工企业与参与公司
      </t-button>
    </t-space>
    <p v-if="!projectId">
      请先选择所属项目。
    </p>
    <p>绑定维护入口：项目工作台 → 项目设置 → 唯一施工企业，由董事长或公司级综合部主管办理。</p>
  </t-card>
</template>

<style scoped>
.contract-entry-choice { margin-block: var(--jg-space-4); }
.contract-entry-choice :deep(.t-radio-group) { display: flex; flex-wrap: wrap; gap: var(--jg-space-3); }
.contract-entry-choice :deep(.t-radio__label) { white-space: normal; }
.contract-entry-choice :deep(.t-button) { max-width: 100%; height: auto; min-height: var(--jg-control-height-md); white-space: normal; }
</style>
