<template>
  <t-card
    data-testid="contract-takeover-handover"
    :bordered="true"
  >
    <template #header>
      <div class="handover-head">
        <div>
          <strong>接管分工</strong>
          <span>登记合同、财务和复核负责人；分工只决定今后由谁办理，不改写历史接管事实。</span>
        </div>
        <t-tag :theme="model?.registered ? 'success' : 'warning'">
          {{ model?.registered ? `已登记 v${model.revision}` : "待登记" }}
        </t-tag>
      </div>
    </template>

    <p
      v-if="model && !model.registered && model.requiresHandover"
      class="handover-warning"
    >
      无等级/C 级历史合同需先完成分工登记，否则提交复核、确认接管、后续结算和付款都会被后端阻断。
    </p>
    <p
      v-else-if="model && model.registered"
      class="handover-hint"
    >
      当前分工：{{ currentDutyText }}。更换负责人必须填写原因，历史分工记录会保留。
    </p>

    <div class="handover-grid">
      <label
        v-for="duty in dutyRows"
        :key="duty.key"
      >
        <span>{{ duty.label }}</span>
        <t-select
          v-model="form[duty.key]"
          :options="userOptions"
          :disabled="!canManage || saving"
          filterable
          :placeholder="duty.placeholder"
        />
      </label>
    </div>

    <label
      v-if="model?.registered"
      class="handover-reason"
    >
      <span>更换原因</span>
      <t-input
        v-model="reason"
        :disabled="!canManage || saving"
        maxlength="500"
        placeholder="更换负责人时必填，例如原经办调岗"
      />
    </label>

    <div class="handover-actions">
      <t-button
        theme="primary"
        :loading="saving"
        :disabled="!canManage || !canSubmit"
        @click="save"
      >
        {{ model?.registered ? "保存新分工" : "登记分工" }}
      </t-button>
      <t-button
        variant="outline"
        :disabled="saving"
        @click="load"
      >
        刷新
      </t-button>
      <span v-if="!canManage">仅合同部主管可以登记或更换接管分工。</span>
    </div>

    <p
      v-if="error"
      class="handover-error"
    >
      {{ error }}
    </p>

    <div
      v-if="model?.history.length"
      class="handover-history"
    >
      <strong>分工变更记录</strong>
      <ol>
        <li
          v-for="item in model.history"
          :key="item.revision"
        >
          <span>v{{ item.revision }} · {{ item.actionLabel }}</span>
          <span>{{ item.actorUserName || "经办人未读取" }} · {{ formatTime(item.createdAt) }}</span>
          <span>{{ assignmentText(item.assignments) }}</span>
          <span v-if="item.reason">原因：{{ item.reason }}</span>
        </li>
      </ol>
    </div>
  </t-card>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  fetchContractTakeoverProjectCapability,
  getContractTakeoverHandover,
  saveContractTakeoverHandover,
  type ContractTakeoverHandoverAssignmentReadModel,
  type ContractTakeoverHandoverDuty,
  type ContractTakeoverHandoverReadModel,
  type ContractTakeoverReadModel,
  type UserOptionReadModel
} from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";

const props = defineProps<{
  projectId: string;
  takeover: ContractTakeoverReadModel;
  userOptions: UserOptionReadModel[];
  canManage: boolean;
}>();

const dutyRows: Array<{
  key: ContractTakeoverHandoverDuty;
  label: string;
  placeholder: string;
}> = [
  { key: "contract", label: "合同办理负责人", placeholder: "选择合同员或合同部主管" },
  { key: "finance", label: "财务收付负责人", placeholder: "选择财务或财务主管" },
  { key: "supervisor", label: "合同复核负责人", placeholder: "选择合同部主管" }
];

const model = ref<ContractTakeoverHandoverReadModel | null>(null);
const form = reactive<Record<ContractTakeoverHandoverDuty, string>>({
  contract: "",
  finance: "",
  supervisor: ""
});
const reason = ref("");
const saving = ref(false);
const error = ref("");

const userOptions = computed(() =>
  props.userOptions.map((user) => ({ label: user.name, value: user.id }))
);
const canSubmit = computed(() =>
  dutyRows.every((duty) => Boolean(form[duty.key].trim()))
);
const currentDutyText = computed(() => {
  if (!model.value) return "未读取";
  return model.value.assignments
    .map((item) => `${item.dutyLabel} ${item.userName || "未读取"}`)
    .join(" · ");
});

function applyModel(next: ContractTakeoverHandoverReadModel) {
  model.value = next;
  for (const duty of dutyRows) {
    form[duty.key] =
      next.assignments.find((item) => item.duty === duty.key)?.userId ?? "";
  }
}

function assignmentText(
  assignments: ContractTakeoverHandoverAssignmentReadModel[]
) {
  return assignments
    .map((item) => `${item.dutyLabel} ${item.userName || "未读取"}`)
    .join(" · ");
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未读取";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

async function load() {
  if (!props.projectId || !props.takeover.id) return;
  error.value = "";
  try {
    applyModel(
      await getContractTakeoverHandover(props.projectId, props.takeover.id)
    );
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "接管分工读取失败");
  }
}

async function saveContractTakeoverHandoverWithCapability(
  projectId: string,
  takeoverId: string,
  body: Parameters<typeof saveContractTakeoverHandover>[2]
) {
  const capability = await fetchContractTakeoverProjectCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("历史合同接管项目已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes("register_handover");
  if (!operationAllowed) {
    throw new Error("当前用户不能登记接管分工");
  }
  return saveContractTakeoverHandover(projectId, takeoverId, body);
}

async function save() {
  if (!props.canManage || !canSubmit.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const next = await saveContractTakeoverHandoverWithCapability(
      props.projectId,
      props.takeover.id,
      {
        contractUserId: form.contract,
        financeUserId: form.finance,
        supervisorUserId: form.supervisor,
        ...(reason.value.trim() ? { reason: reason.value.trim() } : {}),
        idempotencyKey: globalThis.crypto.randomUUID()
      }
    );
    applyModel(next);
    reason.value = "";
  } catch (cause) {
    error.value = formatUnknownApiError(cause, "接管分工登记失败");
  } finally {
    saving.value = false;
  }
}

watch(
  () => [props.projectId, props.takeover.id] as const,
  () => {
    void load();
  },
  { immediate: true }
);
</script>

<style scoped>
.handover-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.handover-head div {
  display: grid;
  gap: 4px;
}

.handover-head span,
.handover-hint,
.handover-actions span {
  color: var(--jg-text-secondary);
  font-size: 12px;
}

.handover-warning,
.handover-error {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--jg-color-bg-warning-soft);
  color: var(--jg-color-warning);
}

.handover-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.handover-grid label,
.handover-reason {
  display: grid;
  gap: 6px;
}

.handover-grid label > span,
.handover-reason > span {
  font-size: 13px;
  color: var(--jg-text-secondary);
}

.handover-reason {
  margin-top: 12px;
}

.handover-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.handover-history {
  margin-top: 16px;
  display: grid;
  gap: 8px;
}

.handover-history ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 20px;
}

.handover-history li {
  display: grid;
  gap: 2px;
  font-size: 13px;
}
</style>
