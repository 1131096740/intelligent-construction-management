<template>
  <section class="company-entity-page jg-responsive-ledger">
    <BusinessPageHeader
      title="我方公司主体"
      description="统一管理签约主体当前资料和不可覆盖的历史版本。"
    >
      <template #actions>
        <t-button v-if="canMaintain" theme="primary" @click="openCreate">新增我方公司</t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      state="info"
      title="我方公司资料维护"
      description="综合部主管和董事长可新增、修改或启停主体；变更保留历史版本。停用后不再用于新增业务。"
    />

    <BusinessTableToolbar
      title="主体台账"
      description="搜索会同时匹配当前资料与历史版本。"
      appearance="plain"
    >
      <t-input
        v-model="filters.keyword"
        clearable
        placeholder="公司全称 / 统一社会信用代码"
        @enter="load"
        @clear="load"
      />
      <t-select
        v-model="filters.status"
        :options="statusOptions"
      />
      <t-button
        variant="outline"
        :loading="loading"
        @click="load"
      >
        查询
      </t-button>
    </BusinessTableToolbar>

    <BusinessFeedback
      v-if="errorMessage"
      state="error"
      title="主体台账加载失败"
      :description="errorMessage"
      action-label="重试"
      @action="load"
    />

    <BusinessFeedback
      v-if="!loading && !errorMessage && rows.length === 0"
      state="info"
      title="暂无符合条件的主体"
      description="请调整搜索条件，或由综合部主管、董事长新增我方公司。"
    />

    <t-card
      v-else
      :bordered="true"
      class="jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="rows"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
      >
        <template #registeredAddress="{ row }">
          {{ row.registeredAddress || "未填写" }}
        </template>
        <template #dataStatus="{ row }">
          <t-tag :theme="row.dataStatus === 'complete' ? 'success' : 'warning'">
            {{ companyEntityDataStatusLabel(row.dataStatus) }}
          </t-tag>
        </template>
        <template #isActive="{ row }">
          <t-tag :theme="row.isActive ? 'success' : 'default'">
            {{ row.isActive ? "启用" : "停用" }}
          </t-tag>
        </template>
        <template #updatedAt="{ row }">
          {{ formatDateTime(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-button v-if="canMaintain" variant="text" size="small" @click="openEdit(row)">修改</t-button>
          <t-button v-if="canMaintain" variant="text" size="small" @click="statusEntity = row">
            {{ row.isActive ? "停用" : "重新启用" }}
          </t-button>
          <t-button
            variant="text"
            size="small"
            theme="primary"
            @click="openHistory(row)"
          >
            查看历史
          </t-button>
        </template>
      </t-table>
    </t-card>

    <CompanyEntityFormDrawer v-model="formVisible" :entity="editingEntity" @saved="afterSave" />
    <t-dialog
      :visible="Boolean(statusEntity)"
      :header="statusEntity?.isActive ? '停用我方公司' : '重新启用我方公司'"
      :body="statusEntity?.isActive ? '停用后不再用于新增业务，历史资料和业务记录保留。确认停用？' : '确认重新启用该公司主体？'"
      :confirm-btn="{ content: '确认', loading: savingStatus }"
      :close-on-overlay-click="false"
      :close-on-esc-keydown="false"
      :close-btn="!savingStatus"
      :cancel-btn="{ content: '取消', disabled: savingStatus }"
      @confirm="saveStatus"
      @cancel="statusEntity = null"
      @close="statusEntity = null"
    />
    <p v-if="maintenanceMessage" role="status">{{ maintenanceMessage }}</p>
    <CompanyEntityHistoryDrawer
      v-model="historyVisible"
      :entity-id="historyEntityId"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  fetchCompanyEntityManagement,
  fetchCompanyEntityManagementCapability,
  updateCompanyEntityStatus,
  type CompanyEntityModel
} from "../../api/company-entity.api";
import { formatUnknownApiError } from "../../api/error-message";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import CompanyEntityFormDrawer from "./components/CompanyEntityFormDrawer.vue";
import CompanyEntityHistoryDrawer from "./components/CompanyEntityHistoryDrawer.vue";
import {
  companyEntityDataStatusLabel,
  createCompanyEntityRequestGate
} from "./company-entity.config";

const maintenanceActions = ref<string[]>([]);
const canMaintain = computed(() => maintenanceActions.value.includes("update_company_entity"));
const formVisible = ref(false);
const editingEntity = ref<CompanyEntityModel | null>(null);
const statusEntity = ref<CompanyEntityModel | null>(null);
const savingStatus = ref(false);
const maintenanceMessage = ref("");
const rows = ref<CompanyEntityModel[]>([]);
const loading = ref(false);
const errorMessage = ref("");
const filters = reactive<{ keyword: string; status: "all" | "active" | "inactive" }>({
  keyword: "",
  status: "all"
});
const statusOptions = [
  { label: "全部状态", value: "all" },
  { label: "启用", value: "active" },
  { label: "停用", value: "inactive" }
];
const columns = [
  { colKey: "name", title: "公司全称", minWidth: 220 },
  { colKey: "unifiedSocialCreditCode", title: "统一社会信用代码", minWidth: 190 },
  { colKey: "registeredAddress", title: "注册地址", minWidth: 220 },
  { colKey: "dataStatus", title: "资料状态", width: 120 },
  { colKey: "isActive", title: "启停状态", width: 100 },
  { colKey: "updatedAt", title: "更新时间", width: 180 },
  { colKey: "operation", title: "操作", width: 260, fixed: "right" }
];
const historyVisible = ref(false);
const historyEntityId = ref<string | null>(null);
const requestGate = createCompanyEntityRequestGate();

async function load() {
  const snapshot = listRequestSnapshot();
  const token = requestGate.begin(snapshot);
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchCompanyEntityManagement({
      keyword: filters.keyword.trim() || undefined,
      status: filters.status
    });
    if (!requestGate.isCurrent(token, listRequestSnapshot())) return;
    rows.value = result;
  } catch (error) {
    if (!requestGate.isCurrent(token, listRequestSnapshot())) return;
    rows.value = [];
    errorMessage.value = formatUnknownApiError(error, "加载我方公司主体失败");
  } finally {
    if (requestGate.isCurrent(token, listRequestSnapshot())) {
      loading.value = false;
    }
  }
}

function listRequestSnapshot() {
  return `${filters.status}\u0000${filters.keyword.trim()}`;
}

function openHistory(entity: CompanyEntityModel) {
  historyEntityId.value = entity.id;
  historyVisible.value = true;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间已留痕" : date.toLocaleString("zh-CN", { hour12: false });
}

function openCreate() {
  editingEntity.value = null;
  formVisible.value = true;
}
function openEdit(entity: CompanyEntityModel) {
  editingEntity.value = entity;
  formVisible.value = true;
}
async function afterSave(warning: string | null) {
  maintenanceMessage.value = warning || "我方公司资料已保存";
  await load();
}
async function loadCapability() {
  try { maintenanceActions.value = (await fetchCompanyEntityManagementCapability()).availableActions; }
  catch { maintenanceActions.value = []; }
}
async function saveStatus() {
  const entity = statusEntity.value;
  if (!entity || savingStatus.value) return;
  savingStatus.value = true;
  maintenanceMessage.value = "";
  try {
    await saveCompanyStatusWithCapability(entity.id, !entity.isActive);
    statusEntity.value = null;
    maintenanceMessage.value = entity.isActive ? "我方公司已停用，历史记录保留" : "我方公司已重新启用";
    await load();
  } catch (error) {
    maintenanceMessage.value = formatUnknownApiError(error, "更新主体状态失败");
  } finally { savingStatus.value = false; }
}
onMounted(() => { void load(); void loadCapability(); });
watch(
  () => [filters.keyword, filters.status],
  () => {
    requestGate.invalidate();
    loading.value = false;
  },
  { flush: "sync" }
);
async function saveCompanyStatusWithCapability(id: string, isActive: boolean) {
  const capability = await fetchCompanyEntityManagementCapability();
  const operationAllowed = capability.availableActions.includes("update_company_entity_status");
  if (!operationAllowed) throw new Error("维护权限已变化，请刷新后重试");
  return updateCompanyEntityStatus(id, isActive);
}
</script>

<style scoped>
.company-entity-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
}
</style>
