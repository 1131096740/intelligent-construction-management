<template>
  <section class="company-entity-page jg-responsive-ledger">
    <BusinessPageHeader
      title="我方公司主体"
      description="统一管理签约主体当前资料和不可覆盖的历史版本。"
    >
      <template #actions>
        <t-button
          v-if="capabilities.canMaintain"
          theme="primary"
          @click="openCreate"
        >
          新增主体
        </t-button>
      </template>
    </BusinessPageHeader>

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
      v-if="feedbackMessage"
      :state="feedbackState"
      :title="feedbackTitle"
      :description="feedbackMessage"
      :action-label="feedbackState === 'error' ? '重试' : undefined"
      @action="load"
    />

    <BusinessFeedback
      v-if="!loading && !errorMessage && rows.length === 0"
      state="info"
      title="暂无符合条件的主体"
      description="请调整搜索条件，或由有维护权限的公司岗位新增主体。"
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
          <t-space size="small">
            <t-button
              v-if="capabilities.canMaintain"
              variant="text"
              size="small"
              theme="primary"
              @click="openEdit(row)"
            >
              修改
            </t-button>
            <t-button
              variant="text"
              size="small"
              theme="primary"
              @click="openHistory(row)"
            >
              查看历史
            </t-button>
            <t-button
              v-if="capabilities.canMaintain"
              variant="text"
              size="small"
              :theme="row.isActive ? 'danger' : 'primary'"
              @click="openStatus(row)"
            >
              {{ row.isActive ? "停用" : "启用" }}
            </t-button>
          </t-space>
        </template>
      </t-table>
    </t-card>

    <CompanyEntityFormDrawer
      v-model="formVisible"
      :entity="editingEntity"
      @saved="afterSaved"
    />
    <CompanyEntityHistoryDrawer
      v-model="historyVisible"
      :entity-id="historyEntityId"
    />
    <SensitiveActionDialog
      v-model="statusDialogVisible"
      :title="statusTarget?.isActive ? '停用我方公司主体' : '启用我方公司主体'"
      :description="statusDescription"
      :confirm-text="statusTarget?.isActive ? '确认停用' : '确认启用'"
      :confirm-theme="statusTarget?.isActive ? 'danger' : 'primary'"
      :require-reason="false"
      :require-password="false"
      :loading="statusSaving"
      :error="statusError"
      @confirm="confirmStatus"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useAuthStore } from "../../auth/auth.store";
import {
  fetchCompanyEntityManagement,
  updateCompanyEntityStatus,
  type CompanyEntityModel
} from "../../api/company-entity.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import CompanyEntityFormDrawer from "./components/CompanyEntityFormDrawer.vue";
import CompanyEntityHistoryDrawer from "./components/CompanyEntityHistoryDrawer.vue";
import {
  companyEntityCapabilities,
  companyEntityDataStatusLabel,
  createCompanyEntityRequestGate
} from "./company-entity.config";

const auth = useAuthStore();
const capabilities = computed(() => companyEntityCapabilities(auth.user?.globalRoleKeys ?? []));
const rows = ref<CompanyEntityModel[]>([]);
const loading = ref(false);
const errorMessage = ref("");
const noticeMessage = ref("");
const noticeWarning = ref(false);
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
  { colKey: "operation", title: "操作", width: 220, fixed: "right" }
];
const formVisible = ref(false);
const editingEntity = ref<CompanyEntityModel | null>(null);
const historyVisible = ref(false);
const historyEntityId = ref<string | null>(null);
const statusDialogVisible = ref(false);
const statusTarget = ref<CompanyEntityModel | null>(null);
const statusSaving = ref(false);
const statusError = ref("");
const requestGate = createCompanyEntityRequestGate();

const feedbackMessage = computed(() => errorMessage.value || noticeMessage.value);
const feedbackState = computed<"error" | "success" | "info">(() => {
  if (errorMessage.value) return "error";
  return noticeWarning.value ? "info" : "success";
});
const feedbackTitle = computed(() => {
  if (errorMessage.value) return "主体台账加载失败";
  return noticeWarning.value ? "保存成功，请核对" : "操作成功";
});
const statusDescription = computed(() => statusTarget.value?.isActive
  ? `停用后，“${statusTarget.value.name}”不能用于新建合同，历史合同不受影响。`
  : `启用后，“${statusTarget.value?.name ?? "该主体"}”将可用于新建合同。`);

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
    errorMessage.value = error instanceof Error ? error.message : "加载我方公司主体失败";
  } finally {
    if (requestGate.isCurrent(token, listRequestSnapshot())) {
      loading.value = false;
    }
  }
}

function listRequestSnapshot() {
  return `${filters.status}\u0000${filters.keyword.trim()}`;
}

function openCreate() {
  editingEntity.value = null;
  formVisible.value = true;
}

function openEdit(entity: CompanyEntityModel) {
  editingEntity.value = entity;
  formVisible.value = true;
}

function openHistory(entity: CompanyEntityModel) {
  historyEntityId.value = entity.id;
  historyVisible.value = true;
}

function openStatus(entity: CompanyEntityModel) {
  statusTarget.value = entity;
  statusError.value = "";
  statusDialogVisible.value = true;
}

async function afterSaved(warning: string | null) {
  noticeWarning.value = Boolean(warning);
  noticeMessage.value = warning || "我方公司主体已保存。";
  await load();
}

async function confirmStatus() {
  if (!statusTarget.value) return;
  statusSaving.value = true;
  statusError.value = "";
  try {
    const nextActive = !statusTarget.value.isActive;
    const result = await updateCompanyEntityStatus(statusTarget.value.id, nextActive);
    statusDialogVisible.value = false;
    noticeWarning.value = false;
    noticeMessage.value = result.unchanged
      ? `“${result.entity.name}”状态未变化。`
      : `“${result.entity.name}”已${nextActive ? "启用" : "停用"}。`;
    await load();
  } catch (error) {
    statusError.value = error instanceof Error ? error.message : "更新主体状态失败";
  } finally {
    statusSaving.value = false;
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间已留痕" : date.toLocaleString("zh-CN", { hour12: false });
}

onMounted(load);
watch(
  () => [filters.keyword, filters.status],
  () => {
    requestGate.invalidate();
    loading.value = false;
  },
  { flush: "sync" }
);
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
