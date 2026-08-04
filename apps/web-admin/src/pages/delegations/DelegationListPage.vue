<template>
  <section class="delegation-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>审批委托台账</h1>
        <p>常驻委托：在窗口期内，受托人可代你完成你岗位有权审批的合同 / 结算 / 付款节点</p>
      </div>
    </div>

    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="当前可查看审批委托及生效状态；创建和撤销入口将在权限治理完成后重新开放。"
      class="readonly-alert"
    />
    <t-alert
      v-if="message"
      theme="error"
      :message="message"
      class="readonly-alert"
    />

    <t-card
      class="ledger-panel jg-table-region jg-table-region--wide"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="rows"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
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
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  listApprovalDelegations,
  type ApprovalDelegationReadModel
} from "../../api/core-flow-read.api";
import { useAuthStore } from "../../auth/auth.store";
import {
  delegationLedgerColumns,
  mapDelegationLedgerRows
} from "./delegation-list.config";

const auth = useAuthStore();
const columns = delegationLedgerColumns;
const rawRows = ref<ApprovalDelegationReadModel[]>([]);
const rows = computed(() => mapDelegationLedgerRows(rawRows.value, auth.user?.id));
const loading = ref(false);
const message = ref("");

async function loadDelegations() {
  loading.value = true;
  try {
    rawRows.value = await listApprovalDelegations();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载委托失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadDelegations());
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

.readonly-alert {
  margin-bottom: 16px;
}

.ledger-panel {
  border-radius: 3px;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}
</style>
