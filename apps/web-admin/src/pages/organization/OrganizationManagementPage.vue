<template>
  <section
    class="organization-page jg-responsive-workspace"
    data-jg-scroll-owner="child"
  >
    <div class="page-head">
      <div>
        <h1>组织权限</h1>
        <p>只读查看部门层级、人员归属、启停状态和岗位分配。</p>
      </div>
      <div class="page-actions">
        <t-button
          variant="outline"
          :loading="refreshing"
          :disabled="directoryLoading || integrityLoading || refreshing"
          @click="refreshPage"
        >
          刷新
        </t-button>
      </div>
    </div>

    <t-alert
      theme="info"
      title="首次上线只读：新增、编辑、启停、授岗和撤岗已从生产页面关闭；既有组织、人员与岗位事实保持可查。"
      :close="false"
    />

    <t-alert
      v-if="directoryMessage"
      theme="error"
      :title="directoryMessage"
      :close="false"
    />

    <BusinessStatusSummary :items="summaryItems" />

    <t-card
      v-if="isTechnicalAdmin"
      title="岗位数据预检（只读）"
      bordered
    >
      <div class="integrity-card-content">
        <t-alert
          theme="info"
          :title="integrityPolicyText"
          :close="false"
        />
        <t-alert
          v-if="integrityMessage"
          theme="error"
          :title="integrityMessage"
          :close="false"
        />
        <template v-if="permissionIntegrity">
          <div class="readiness-tags">
            <t-tag
              v-for="tag in integrityReadinessTags"
              :key="tag.label"
              :theme="tag.tone"
              variant="light"
            >
              {{ tag.label }}
            </t-tag>
          </div>
          <BusinessStatusSummary :items="integritySummaryItems" />
          <div class="jg-table-region jg-table-region--wide">
            <t-table
              row-key="key"
              size="small"
              :columns="integrityColumns"
              :data="integrityIssueRows"
              :loading="integrityLoading"
              :horizontal-scroll-affixed-bottom="true"
              empty="未发现权限数据问题"
            >
              <template #severity="{ row }">
                <t-tag
                  size="small"
                  :theme="row.severityTone"
                  variant="light"
                >
                  {{ row.severityLabel }}
                </t-tag>
              </template>
              <template #issue="{ row }">
                <div class="integrity-issue">
                  <span class="integrity-issue__title">{{ row.issueLabel }}</span>
                  <span class="integrity-issue__message">{{ row.message }}</span>
                </div>
              </template>
            </t-table>
          </div>
        </template>
      </div>
    </t-card>

    <div class="organization-grid">
      <t-card
        title="部门层级"
        class="jg-table-region jg-table-region--standard"
        bordered
      >
        <t-table
          row-key="id"
          size="small"
          :columns="departmentColumns"
          :data="flatDepartments"
          :loading="directoryLoading"
          :horizontal-scroll-affixed-bottom="true"
          empty="暂无部门"
        >
          <template #name="{ row }">
            <span class="department-name">{{ row.path }}</span>
          </template>
          <template #isActive="{ row }">
            <t-tag
              size="small"
              :theme="row.isActive ? 'success' : 'default'"
              variant="light"
            >
              {{ departmentStatusText(row.isActive) }}
            </t-tag>
          </template>
        </t-table>
      </t-card>

      <t-card
        title="人员目录"
        class="jg-table-region jg-table-region--wide"
        bordered
      >
        <div class="filter-bar">
          <t-input
            v-model="filters.keyword"
            clearable
            placeholder="姓名、电话、部门或岗位关键词"
          />
          <t-select
            v-model="filters.departmentId"
            clearable
            :options="filterDepartmentOptions"
            placeholder="全部部门"
          />
          <t-select
            v-model="filters.status"
            clearable
            :options="userStatusOptions"
            placeholder="全部状态"
          />
        </div>
        <t-table
          row-key="id"
          size="small"
          :columns="userColumns"
          :data="filteredUsers"
          :loading="directoryLoading"
          :horizontal-scroll-affixed-bottom="true"
          empty="暂无人员"
        >
          <template #status="{ row }">
            <t-tag
              size="small"
              :theme="row.status === 'active' ? 'success' : 'default'"
              variant="light"
            >
              {{ userStatusText(row.status) }}
            </t-tag>
          </template>
          <template #mustChangePassword="{ row }">
            <t-tag
              size="small"
              :theme="row.mustChangePassword ? 'warning' : 'success'"
              variant="light"
            >
              {{ mustChangePasswordText(row.mustChangePassword) }}
            </t-tag>
          </template>
          <template #globalPositions="{ row }">
            {{ globalPositionsText(row) }}
          </template>
          <template #projectPositions="{ row }">
            {{ projectPositionsText(row) }}
          </template>
          <template #rosterProjects="{ row }">
            {{ rosterProjectsText(row) }}
          </template>
        </t-table>
      </t-card>
    </div>

    <t-card
      title="固定岗位字典（只读）"
      bordered
    >
      <div class="position-tags">
        <t-tag
          v-for="position in directory.positions"
          :key="position.id"
          variant="outline"
        >
          {{ position.name }}
        </t-tag>
        <span v-if="!directory.positions.length">暂无岗位</span>
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../../auth/auth.store";
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
import type { BusinessStatusSummaryItem } from "../../components/business-status-summary.config";
import {
  fetchOrganizationDirectory,
  fetchPermissionIntegrity,
  type OrganizationDirectory,
  type PermissionIntegrityReadModel
} from "../../api/organization.api";
import {
  departmentStatusText,
  filterOrganizationUsers,
  flattenDepartmentTree,
  globalPositionsText,
  mustChangePasswordText,
  permissionIntegrityIssueRows as buildPermissionIntegrityIssueRows,
  permissionIntegrityPolicyText,
  permissionIntegrityReadinessTag,
  permissionIntegritySummaryItems,
  projectPositionsText,
  rosterProjectsText,
  userStatusText
} from "./organization.config";

const emptyDirectory = (): OrganizationDirectory => ({
  summary: { departments: 0, activeUsers: 0, inactiveUsers: 0, positions: 0 },
  departments: [],
  users: [],
  projects: [],
  positions: []
});

const directory = reactive<OrganizationDirectory>(emptyDirectory());
const auth = useAuthStore();
const isTechnicalAdmin = computed(
  () => auth.user?.globalRoleKeys.includes("super_admin") ?? false
);
const permissionIntegrity = ref<PermissionIntegrityReadModel | null>(null);
const directoryLoading = ref(false);
const integrityLoading = ref(false);
const refreshing = ref(false);
const directoryMessage = ref("");
const integrityMessage = ref("");
const filters = reactive<{
  keyword: string;
  departmentId: string | undefined;
  status: "active" | "inactive" | undefined;
}>({ keyword: "", departmentId: undefined, status: undefined });

const departmentColumns = [
  { colKey: "name", title: "部门", minWidth: 180 },
  { colKey: "parentName", title: "上级", minWidth: 120 },
  { colKey: "isActive", title: "状态", width: 82 }
];
const userColumns = [
  { colKey: "name", title: "姓名", width: 96 },
  { colKey: "phone", title: "电话", width: 132 },
  { colKey: "departmentName", title: "部门", minWidth: 112 },
  { colKey: "status", title: "状态", width: 78 },
  { colKey: "mustChangePassword", title: "首次改密", width: 108 },
  { colKey: "globalPositions", title: "全局岗位", minWidth: 150 },
  { colKey: "rosterProjects", title: "项目归属", minWidth: 180 },
  { colKey: "projectPositions", title: "项目岗位", minWidth: 200 }
];
const integrityColumns = [
  { colKey: "severity", title: "严重级别", width: 92 },
  { colKey: "issue", title: "问题", minWidth: 220 },
  { colKey: "sourceLabel", title: "来源", width: 120 },
  { colKey: "userId", title: "人员", minWidth: 132 },
  { colKey: "projectId", title: "项目", minWidth: 132 },
  { colKey: "roleKey", title: "岗位", minWidth: 150 },
  { colKey: "assignmentIds", title: "相关记录", minWidth: 200 }
];
const userStatusOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "inactive" }
];

const flatDepartments = computed(() => flattenDepartmentTree(directory.departments));
const filterDepartmentOptions = computed(() =>
  flatDepartments.value.map((department) => ({ label: department.path, value: department.id }))
);
const filteredUsers = computed(() => filterOrganizationUsers(directory.users, filters));
const summaryItems = computed<BusinessStatusSummaryItem[]>(() => [
  { label: "部门数", value: String(directory.summary.departments), tone: "primary" },
  { label: "启用人员", value: String(directory.summary.activeUsers), tone: "success" },
  { label: "停用人员", value: String(directory.summary.inactiveUsers), tone: "warning" },
  { label: "岗位数", value: String(directory.summary.positions), tone: "default" }
]);
const integrityPolicyText = computed(() =>
  permissionIntegrity.value
    ? permissionIntegrityPolicyText(permissionIntegrity.value.policy)
    : "正在读取全局与项目岗位规范源及兼容读取策略。"
);
const integrityReadinessTags = computed(() =>
  permissionIntegrity.value
    ? [
        permissionIntegrityReadinessTag("canonical", permissionIntegrity.value.readiness),
        permissionIntegrityReadinessTag("migration", permissionIntegrity.value.readiness)
      ]
    : []
);
const integritySummaryItems = computed<BusinessStatusSummaryItem[]>(() =>
  permissionIntegrity.value ? permissionIntegritySummaryItems(permissionIntegrity.value.summary) : []
);
const integrityIssueRows = computed(() =>
  permissionIntegrity.value
    ? buildPermissionIntegrityIssueRows(permissionIntegrity.value.issues, directory)
    : []
);

onMounted(() => {
  void refreshPage();
});

async function loadDirectory() {
  directoryLoading.value = true;
  try {
    const result = await fetchOrganizationDirectory();
    Object.assign(directory, result);
    directoryMessage.value = "";
  } catch (error) {
    directoryMessage.value = error instanceof Error ? error.message : "读取组织目录失败，请稍后重试。";
  } finally {
    directoryLoading.value = false;
  }
}

async function loadPermissionIntegrity() {
  if (!isTechnicalAdmin.value) {
    permissionIntegrity.value = null;
    integrityMessage.value = "";
    return;
  }
  integrityLoading.value = true;
  try {
    permissionIntegrity.value = await fetchPermissionIntegrity();
    integrityMessage.value = "";
  } catch (error) {
    integrityMessage.value =
      error instanceof Error ? error.message : "读取权限完整性预检失败，请稍后重试。";
  } finally {
    integrityLoading.value = false;
  }
}

async function refreshPage() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await Promise.all([loadDirectory(), loadPermissionIntegrity()]);
  } finally {
    refreshing.value = false;
  }
}
</script>

<style scoped>
.organization-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  gap: var(--jg-space-lg);
  max-width: var(--jg-layout-page-max-width);
  margin: 0 auto;
}

.page-head,
.page-actions,
.filter-bar,
.position-tags,
.readiness-tags {
  display: flex;
  align-items: center;
  gap: var(--jg-space-md);
}

.page-head {
  justify-content: space-between;
}

.page-actions {
  flex-wrap: wrap;
}

.page-head h1 {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-page-title);
}

.page-head p {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-body);
}

.organization-grid {
  display: grid;
  grid-template-columns: minmax(var(--jg-layout-template-card-min-width), 0.8fr) minmax(0, 1.6fr);
  gap: var(--jg-space-lg);
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(var(--jg-layout-list-filter-keyword-min-width), 1fr) repeat(2, minmax(var(--jg-layout-form-field-min-width-compact), 0.5fr));
  margin-bottom: var(--jg-space-md);
}

.department-name {
  white-space: pre;
}

.position-tags {
  flex-wrap: wrap;
}

.integrity-card-content,
.integrity-issue {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-md);
}

.integrity-issue {
  gap: var(--jg-space-xs);
}

.integrity-issue__title {
  color: var(--jg-color-text-primary);
}

.integrity-issue__message {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

@container jg-page (max-width: 1100px) {
  .organization-grid {
    grid-template-columns: 1fr;
  }
}

@container jg-page (max-width: 840px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .filter-bar {
    grid-template-columns: 1fr;
  }
}
</style>
