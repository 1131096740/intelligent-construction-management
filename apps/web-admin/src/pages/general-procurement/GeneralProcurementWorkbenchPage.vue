<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchProcurementList, fetchProcurementOptions, type ProcurementListItem } from "../../api/general-procurement.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import JgResultState from "../../components/JgResultState.vue";
import ProcurementDraftDrawer from "./components/ProcurementDraftDrawer.vue";
const router = useRouter(); const loading = ref(true); const error = ref(""); const rows = ref<ProcurementListItem[]>([]); const canCreate = ref(false); const createVisible = ref(false); const filter = ref("all"); const search = ref(""); const total = ref(0);
const filters = [{ label: "全部", value: "all" }, { label: "草稿／待修改", value: "drafts" }, { label: "审批中", value: "approval_pending" }, { label: "待综合部采购", value: "approved_pending_procurement" }, { label: "历史待归档", value: "approved_pending_archive" }, { label: "已归档／付款", value: "archived" }];
const currentPage = ref(1); const pageSize = 20; let loadGeneration = 0;
async function load(page = 1) {
  const generation = ++loadGeneration; loading.value = true; error.value = "";
  try {
    const [list, options] = await Promise.all([fetchProcurementList({ page, pageSize, search: search.value.trim(), status: filter.value }), fetchProcurementOptions()]);
    if (generation !== loadGeneration) return;
    rows.value = list.items; total.value = list.total; currentPage.value = list.page; canCreate.value = options.canCreate;
  } catch (cause) { if (generation === loadGeneration) error.value = formatUnknownApiError(cause, "采购申请读取失败"); }
  finally { if (generation === loadGeneration) loading.value = false; }
}
function open(id: string) { void router.push(`/综合采购申请/${encodeURIComponent(id)}`); }
onMounted(() => load());
</script>
<template>
  <JgWorkbenchShell
    title="综合采购申请"
    description="所有员工可申请办公用品、设备、软件或服务。项目采购由综合主管和项目经理同时审批；公司日常由公司综合主管审批，通过后交综合部采购。"
  >
    <template #actions>
      <t-button
        v-if="canCreate"
        @click="createVisible = true"
      >
        新建综合采购申请
      </t-button><t-button
        theme="default"
        :loading="loading"
        @click="load()"
      >
        刷新
      </t-button>
    </template>
    <template #filters>
      <div class="procurement-filters">
        <t-select
          v-model="filter"
          :options="filters"
          aria-label="申请状态"
          @change="load()"
        /><t-input
          v-model="search"
          placeholder="搜索项目、用途或申请人"
          @enter="load()"
        /><t-button
          :loading="loading"
          @click="load()"
        >
          搜索
        </t-button>
      </div>
    </template>
    <t-alert
      v-if="!loading && !canCreate"
      theme="info"
      message="当前账号暂不能发起采购申请，请联系综合部核对账号状态。"
    />
    <p>共 {{ total }} 条 · 第 {{ currentPage }} 页</p>
    <JgResultState
      :loading="loading"
      :error="error"
      :has-results="rows.length > 0"
      empty-title="暂无综合采购申请"
      empty-description="点击新建申请填写采购名称，未定内容可留空；保存草稿后再提交审批。"
      @retry="load()"
    >
      <div class="procurement-list">
        <t-card
          v-for="row in rows"
          :key="row.id"
          :title="row.code"
          :subtitle="row.projectName"
        >
          <template #actions>
            <t-tag>{{ row.statusLabel }}</t-tag>
          </template><p>{{ row.reason }}</p><p>{{ row.categoryLabel }} · {{ row.applicantName }}</p><div class="procurement-card-footer">
            <strong>{{ row.requestProtocolVersion === 2 ? (row.estimatedAmount == null ? "预计金额待明确" : `${row.estimatedAmount} 元`) : row.requestedAmountCents == null ? "预计金额待明确" : `${centsTextToYuanText(row.requestedAmountCents)} 元` }}</strong><t-button
              variant="text"
              @click="open(row.id)"
            >
              查看申请
            </t-button>
          </div>
        </t-card>
      </div>
    </JgResultState>
    <t-space
      v-if="total > pageSize"
      break-line
    >
      <t-button
        theme="default"
        :disabled="loading || currentPage <= 1"
        @click="load(currentPage - 1)"
      >
        上一页
      </t-button>
      <t-button
        theme="default"
        :disabled="loading || currentPage * pageSize >= total"
        @click="load(currentPage + 1)"
      >
        下一页
      </t-button>
    </t-space>
    <ProcurementDraftDrawer
      v-model:visible="createVisible"
      @saved="open"
    />
  </JgWorkbenchShell>
</template>
<style scoped>
.procurement-filters, .procurement-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-md); }
.procurement-card-footer { display: flex; justify-content: space-between; align-items: center; gap: var(--jg-space-sm); }
p { overflow-wrap: anywhere; }
@media (max-width: 767px) { .procurement-filters, .procurement-list { grid-template-columns: minmax(0, 1fr); } }
</style>
