<template>
  <section class="delegation-page">
    <div class="page-head">
      <div>
        <h1>审批委托台账</h1>
        <p>常驻委托：在窗口期内，受托人可代你完成你岗位有权审批的合同 / 结算 / 付款节点</p>
      </div>
    </div>

    <t-card
      class="form-panel"
      title="新增委托"
      :bordered="true"
    >
      <div class="form-fields">
        <label>
          <span>受托人</span>
          <t-select
            v-model="form.toUserId"
            :options="userOptions"
            filterable
            placeholder="选择受托人"
          />
        </label>
        <label>
          <span>生效时间</span>
          <input
            v-model="form.startsAt"
            class="native-input"
            type="datetime-local"
            aria-label="委托生效时间"
          >
        </label>
        <label>
          <span>失效时间</span>
          <input
            v-model="form.endsAt"
            class="native-input"
            type="datetime-local"
            aria-label="委托失效时间"
          >
        </label>
        <div class="form-action">
          <t-button
            theme="primary"
            :disabled="Boolean(createDisabledReason) || creating"
            :loading="creating"
            :title="createDisabledReason || (creating ? '正在创建委托，请稍候' : '创建审批委托')"
            @click="submitCreate"
          >
            创建委托
          </t-button>
          <span v-if="createDisabledReason">
            {{ createDisabledReason }}
          </span>
        </div>
      </div>
      <p
        v-if="message"
        :class="['form-message', `tone-${messageTone}`]"
      >
        {{ message }}
      </p>
    </t-card>

    <t-card
      class="ledger-panel"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="rows"
        :loading="loading"
        empty="暂无委托记录"
      >
        <template #enabled="{ row }">
          <t-tag
            size="small"
            :theme="row.enabled ? 'success' : 'default'"
            variant="light"
          >
            {{ row.enabled ? "生效中" : "已撤销" }}
          </t-tag>
        </template>
        <template #deadlineLabel="{ row }">
          <t-tag
            size="small"
            :theme="row.deadlineTone"
            variant="light"
          >
            {{ row.deadlineLabel }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link
            v-if="row.enabled"
            theme="danger"
            @click="submitRevoke(row.id)"
          >
            撤销
          </t-link>
          <span v-else>—</span>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  createApprovalDelegation,
  fetchApprovalDelegationUserOptions,
  listApprovalDelegations,
  revokeApprovalDelegation,
  type ApprovalDelegationReadModel
} from "../../api/core-flow-read.api";
import { useAuthStore } from "../../auth/auth.store";
import {
  delegationLedgerColumns,
  getDelegationCreateDisabledReason,
  mapDelegationLedgerRows,
  toDelegationIsoDatetime
} from "./delegation-list.config";

const auth = useAuthStore();
const columns = delegationLedgerColumns;
const rawRows = ref<ApprovalDelegationReadModel[]>([]);
const rows = computed(() => mapDelegationLedgerRows(rawRows.value, auth.user?.id));
const userOptions = ref<Array<{ label: string; value: string }>>([]);
const loading = ref(false);
const creating = ref(false);
const message = ref("");
const messageTone = ref<"success" | "danger">("success");
const form = reactive({
  toUserId: "",
  startsAt: "",
  endsAt: ""
});
const createDisabledReason = computed(() => getDelegationCreateDisabledReason(form));

async function loadDelegations() {
  loading.value = true;
  try {
    rawRows.value = await listApprovalDelegations();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载委托失败";
    messageTone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function loadUserOptions() {
  try {
    const users = await fetchApprovalDelegationUserOptions();
    userOptions.value = users.map((user) => ({
      label: user.name,
      value: user.id
    }));
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载人员列表失败";
    messageTone.value = "danger";
  }
}

async function submitCreate() {
  if (createDisabledReason.value) {
    message.value = createDisabledReason.value;
    messageTone.value = "danger";
    return;
  }

  creating.value = true;
  try {
    await createApprovalDelegation({
      toUserId: form.toUserId.trim(),
      startsAt: toDelegationIsoDatetime(form.startsAt),
      endsAt: toDelegationIsoDatetime(form.endsAt)
    });
    form.toUserId = "";
    form.startsAt = "";
    form.endsAt = "";
    message.value = "委托创建成功";
    messageTone.value = "success";
    await loadDelegations();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建委托失败";
    messageTone.value = "danger";
  } finally {
    creating.value = false;
  }
}

async function submitRevoke(delegationId: string) {
  try {
    await revokeApprovalDelegation(delegationId);
    message.value = "委托已撤销";
    messageTone.value = "success";
    await loadDelegations();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "撤销委托失败";
    messageTone.value = "danger";
  }
}

onMounted(() => {
  void Promise.all([loadDelegations(), loadUserOptions()]);
});
</script>

<style scoped>
.delegation-page {
  width: 100%;
  min-width: 0;
  color: #151922;
}

.page-head {
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.form-panel {
  margin-bottom: 16px;
  border-radius: 3px;
}

.form-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.form-fields label {
  display: grid;
  gap: 4px;
  min-width: 220px;
}

.form-fields span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.form-action {
  display: grid;
  gap: 4px;
}

.form-action span {
  color: #b51d2a;
  font-size: 12px;
}

.native-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
  color: #424955;
  font-size: 12px;
}

.form-message {
  margin: 12px 0 0;
  font-size: 12px;
}

.tone-success {
  color: #1b6b3a;
}

.tone-danger {
  color: #b51d2a;
}

.ledger-panel {
  border-radius: 3px;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}
</style>
