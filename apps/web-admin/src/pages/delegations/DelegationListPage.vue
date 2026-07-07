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
          <t-input
            v-model="form.startsAt"
            placeholder="开始 ISO，如 2026-06-23T00:00:00.000Z"
          />
        </label>
        <label>
          <span>失效时间</span>
          <t-input
            v-model="form.endsAt"
            placeholder="结束 ISO，如 2026-07-23T00:00:00.000Z"
          />
        </label>
        <t-button
          theme="primary"
          :loading="creating"
          @click="submitCreate"
        >
          创建委托
        </t-button>
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
import { onMounted, reactive, ref } from "vue";
import {
  createApprovalDelegation,
  fetchApprovalDelegationUserOptions,
  listApprovalDelegations,
  revokeApprovalDelegation,
  type ApprovalDelegationReadModel
} from "../../api/core-flow-read.api";

const columns = [
  { colKey: "fromUserName", title: "委托人" },
  { colKey: "toUserName", title: "受托人" },
  { colKey: "startsAt", title: "生效时间" },
  { colKey: "endsAt", title: "失效时间" },
  { colKey: "enabled", title: "状态" },
  { colKey: "operation", title: "操作" }
];

const rows = ref<ApprovalDelegationReadModel[]>([]);
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

async function loadDelegations() {
  loading.value = true;
  try {
    rows.value = await listApprovalDelegations();
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
  creating.value = true;
  try {
    await createApprovalDelegation({
      toUserId: form.toUserId.trim(),
      startsAt: form.startsAt.trim(),
      endsAt: form.endsAt.trim()
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
