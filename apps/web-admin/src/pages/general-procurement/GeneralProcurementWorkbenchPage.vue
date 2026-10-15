<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchProcurementList, fetchProcurementOptions, type ProcurementListItem } from "../../api/general-procurement.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import JgResultState from "../../components/JgResultState.vue";
import ProcurementDraftDrawer from "./ProcurementDraftDrawer.vue";
const router = useRouter(); const loading = ref(true); const error = ref(""); const rows = ref<ProcurementListItem[]>([]); const canCreate = ref(false); const createVisible = ref(false); const filter = ref("all"); const search = ref(""); const total = ref(0);
const filters = [{ label: "全部", value: "all" }, { label: "草稿／待修改", value: "drafts" }, { label: "审批中", value: "approval_pending" }, { label: "待归档", value: "approved_pending_archive" }, { label: "已归档／付款", value: "archived" }];
const filtered = computed(() => rows.value.filter((row) => (filter.value === "all" || (filter.value === "drafts" ? ["draft", "returned"].includes(row.status) : row.status === filter.value)) && (!search.value.trim() || `${row.code} ${row.reason} ${row.projectName} ${row.applicantName}`.includes(search.value.trim()))));
async function load() {
  loading.value = true; error.value = "";
  try { const [list, options] = await Promise.all([fetchProcurementList(), fetchProcurementOptions()]); rows.value = list.items; total.value = list.total; canCreate.value = options.canCreate; }
  catch (cause) { error.value = formatUnknownApiError(cause, "采购申请读取失败"); }
  finally { loading.value = false; }
}
function open(id: string) { void router.push(`/综合采购申请/${encodeURIComponent(id)}`); }
onMounted(load);
</script>
<template>
  <JgWorkbenchShell
    title="综合采购申请"
    description="办公用品、施工工具、后勤及服务费用；综合部 → 项目经理 → 董事长 → 综合部归档后请款。"
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
        @click="load"
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
        /><t-input
          v-model="search"
          placeholder="搜索项目、用途或申请人"
        />
      </div>
    </template>
    <t-alert
      v-if="!loading && !canCreate"
      theme="info"
      message="若需申请，请先由综合部在组织管理中设置您的项目岗位，并补齐费用承担公司。"
    />
    <p v-if="total > rows.length">
      当前显示最近 {{ rows.length }} 条，共 {{ total }} 条。
    </p>
    <JgResultState
      :loading="loading"
      :error="error"
      :has-results="filtered.length > 0"
      empty-title="暂无综合采购申请"
      empty-description="点击新建申请填写项目、用途与金额，保存后再提交审批。"
      @retry="load"
    >
      <div class="procurement-list">
        <t-card
          v-for="row in filtered"
          :key="row.id"
          :title="row.code"
          :subtitle="row.projectName"
        >
          <template #actions>
            <t-tag>{{ row.statusLabel }}</t-tag>
          </template><p>{{ row.reason }}</p><p>{{ row.categoryLabel }} · {{ row.applicantName }}</p><div class="procurement-card-footer">
            <strong>{{ centsTextToYuanText(row.requestedAmountCents) }} 元</strong><t-button
              variant="text"
              @click="open(row.id)"
            >
              查看申请
            </t-button>
          </div>
        </t-card>
      </div>
    </JgResultState>
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
