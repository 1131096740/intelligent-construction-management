<template>
  <section
    class="organization-page jg-responsive-workspace"
    data-jg-scroll-owner="child"
  >
    <div class="page-head">
      <div>
        <h1>员工目录与办理</h1>
        <p>查看员工、待审入职和任职办理；部门与账号安全在同页管理。</p>
      </div>
      <div class="page-actions">
        <t-button
          v-if="capabilities?.canCreateUser"
          theme="primary"
          :disabled="refreshing"
          @click="createUserVisible = true"
        >
          新增人员和账号
        </t-button>
        <t-button
          v-if="capabilities?.canManageDepartments"
          variant="outline"
          :disabled="refreshing"
          @click="openDepartment()"
        >
          新增部门
        </t-button>
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
      title="新增人员后，用手机号和公司初始密码登录，首次登录填写姓名并修改密码。调动与离职先核对办理影响；账号停用保留全部历史记录。"
      :close="false"
    />

    <t-alert
      v-if="directoryMessage"
      theme="error"
      :title="directoryMessage"
      :close="false"
    />

    <t-alert
      v-if="savedMessage"
      theme="success"
      :title="savedMessage"
    />
    <BusinessStatusSummary :items="summaryItems" />
    <EmployeeApplicationsCard
      v-if="capabilities?.canReviewApplications"
      :directory="directory"
      :capabilities="capabilities"
      :refresh-key="applicationRefreshKey"
      @approved="loadDirectory"
    />

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
          <template #operation="{ row }">
            <t-button
              v-if="capabilities?.canManageDepartments"
              variant="text"
              @click="openDepartment(row)"
            >
              调整部门
            </t-button>
          </template>
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
        <div
          v-if="mobile"
          class="employee-cards"

          aria-label="人员目录"
        >
          <article
            v-for="row in filteredUsers"
            :key="row.id"
            class="employee-card"
          >
            <strong>{{ row.name }} · {{ row.phone }}</strong>
            <span>{{ row.departmentName }}</span>
            <span>{{ userStatusText(row.status) }}</span>
            <span>首次改密：{{ mustChangePasswordText(row.mustChangePassword) }}</span>
            <span>公司岗位：{{ globalPositionsText(row) }}</span>
            <span>项目归属：{{ rosterProjectsText(row) }}</span>
            <span>项目岗位：{{ projectPositionsText(row) }}</span>
            <OrganizationPersonActions
              :user="row"
              :can-manage="canManagePerson(row.id)"
              :can-manage-roles="canManagePersonRoles(row.id)"
              :can-manage-personnel="canManagePersonnel(row.id)"
              :current-user-id="auth.user?.id"
              @details="openPersonnel(row)"
              @security="openUser(row)"
              @add="openRole(row, 'add')"
              @remove="openRole(row, 'remove')"
              @reset="passwordResetUser = row"
            />
          </article>
          <p v-if="!filteredUsers.length">
            {{ directoryLoading ? '正在读取人员' : '暂无人员' }}
          </p>
        </div>
        <t-table
          v-else
          row-key="id"
          size="small"
          :columns="userColumns"
          :data="filteredUsers"
          :loading="directoryLoading"
          :horizontal-scroll-affixed-bottom="true"
          empty="暂无人员"
        >
          <template #operation="{ row }">
            <OrganizationPersonActions
              :user="row"
              :can-manage="canManagePerson(row.id)"
              :can-manage-roles="canManagePersonRoles(row.id)"
              :can-manage-personnel="canManagePersonnel(row.id)"
              :current-user-id="auth.user?.id"
              @details="openPersonnel(row)"
              @security="openUser(row)"
              @add="openRole(row, 'add')"
              @remove="openRole(row, 'remove')"
              @reset="passwordResetUser = row"
            />
          </template>
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
    <OrganizationUserCreationDrawer
      v-if="createUserVisible && capabilities?.canCreateUser"
      visible
      :department-options="manageableDepartmentOptions"
      :role-options="initialRoleOptions"
      :project-options="activeProjectOptions"
      @close="createUserVisible = false"
      @created="finishManagement"
    />
    <PersonnelDetailsDrawer
      v-if="personnelUser && capabilities"
      :visible="personnelVisible"
      :user="personnelUser"
      :directory="directory"
      :capabilities="capabilities"
      @close="personnelVisible = false"
      @pending="pendingPersonnel = $event"
      @saved="finishPersonnel"
    />
    <AccountCredentialDialog
      v-if="passwordResetUser"
      :id="passwordResetUser.id"
      :name="passwordResetUser.name"
      kind="users"
      @close="passwordResetUser = undefined"
      @saved="loadDirectory"
    />
    <OrganizationDetailsDrawer
      v-if="detailsVisible"
      :directory="directory"
      :department="selectedDepartment"
      :user="selectedUser"
      @close="detailsVisible = false"
      @saved="finishManagement"
    />
    <OrganizationRoleAdditionDrawer
      v-if="roleMode === 'add'"
      visible
      :user="selectedUser ?? null"
      :projects="directory.projects"
      :positions="manageablePositions"
      @close="roleMode = null"
      @applied="finishManagement"
    />
    <OrganizationRoleRemovalDrawer
      v-if="roleMode === 'remove'"
      visible
      :user="selectedUser ?? null"
      :positions="manageablePositions"
      @close="roleMode = null"
      @applied="finishManagement"
    />
  </section>
</template>

<script setup lang="ts">
import { formatUnknownApiError } from "../../api/error-message";
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../../auth/auth.store";
import { loadPendingPersonnel } from "./personnel-pending";
import { usePersonnelMobile } from "./use-personnel-mobile";
import OrganizationPersonActions from "./components/OrganizationPersonActions.vue";
import PersonnelDetailsDrawer from "./components/PersonnelDetailsDrawer.vue";
import OrganizationUserCreationDrawer from "./components/OrganizationUserCreationDrawer.vue";
import OrganizationDetailsDrawer from "./components/OrganizationDetailsDrawer.vue";
import OrganizationRoleAdditionDrawer from "./components/OrganizationRoleAdditionDrawer.vue";
import OrganizationRoleRemovalDrawer from "./components/OrganizationRoleRemovalDrawer.vue";
import EmployeeApplicationsCard from "./components/EmployeeApplicationsCard.vue";
import AccountCredentialDialog from "../../components/AccountCredentialDialog.vue";
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
import type { BusinessStatusSummaryItem } from "../../components/business-status-summary.config";
import {
  fetchOrganizationDirectory,
  fetchEmploymentHistory,
  fetchOrganizationManagementCapabilities,
  type OrganizationManagementCapabilities,
  type OrganizationDirectoryUser,
  fetchPermissionIntegrity,
  type OrganizationDirectory,
  type PermissionIntegrityReadModel
} from "../../api/organization.api";
import {
  departmentStatusText,
  activeOrganizationProjectOptions,
  type FlatOrganizationDepartment,
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

const mobile = usePersonnelMobile();
const personnelUser = ref<OrganizationDirectoryUser>();
const personnelVisible = ref(false);
const pendingPersonnel = ref(false);
const savedMessage = ref("");
const directory = reactive<OrganizationDirectory>(emptyDirectory());
const auth = useAuthStore();
const isTechnicalAdmin = computed(
  () => auth.user?.globalRoleKeys.includes("super_admin") ?? false
);
const capabilities = ref<OrganizationManagementCapabilities | null>(null);
const applicationRefreshKey = ref(0);
const passwordResetUser = ref<OrganizationDirectoryUser>();
const createUserVisible = ref(false);
const detailsVisible = ref(false);
const selectedDepartment = ref<FlatOrganizationDepartment>();
const selectedUser = ref<OrganizationDirectoryUser>();
const roleMode = ref<"add" | "remove" | null>(null);
const manageablePositions = computed(() => directory.positions.filter((position) => capabilities.value?.manageableRoleKeys.includes(position.key)));
const initialRoleOptions = computed(() => manageablePositions.value.filter((position) => position.key !== "super_admin").map((position) => ({ label: position.name, value: position.key })));
const activeProjectOptions = computed(() => activeOrganizationProjectOptions(directory.projects));
const manageableDepartmentOptions = computed(() => flatDepartments.value.filter((department) => department.isActive && capabilities.value?.manageableDepartmentIds.includes(department.id)).map((department) => ({ label: department.path, value: department.id })));
function openDepartment(department?: FlatOrganizationDepartment) { selectedUser.value = undefined; selectedDepartment.value = department; detailsVisible.value = true; }
async function openUser(user: OrganizationDirectoryUser) {
  if (user.status === "inactive" && canManagePersonnel(user.id)) {
    try {
      const history = await fetchEmploymentHistory(user.id);
      if (history.periods.length && history.periods.every((period) => period.endedAt !== null)) { openPersonnel(user); return; }
    } catch (error) { directoryMessage.value = formatUnknownApiError(error, "请先核对任职履历，已离职人员须办理返聘"); return; }
  }
  selectedDepartment.value = undefined; selectedUser.value = user; detailsVisible.value = true;
}
function canManagePersonnel(id: string) { return canManagePerson(id) && auth.user?.globalRoleKeys.some((role) => role === "chairman" || role === "comprehensive_director") === true; }
function openPersonnel(user: OrganizationDirectoryUser) { if (!pendingPersonnel.value) personnelUser.value = user; personnelVisible.value = true; }
async function finishPersonnel() { personnelVisible.value = false; savedMessage.value = "人事办理已保存"; await refreshPage(); }
function openRole(user: OrganizationDirectoryUser, mode: "add" | "remove") { selectedUser.value = user; roleMode.value = mode; }
function canManagePerson(id: string) { return capabilities.value?.manageableUserIds.includes(id) === true; }
function canManagePersonRoles(id: string) { return (capabilities.value?.manageableRoleUserIds ?? capabilities.value?.manageableUserIds)?.includes(id) === true; }
async function finishManagement() { createUserVisible.value = false; detailsVisible.value = false; roleMode.value = null; await refreshPage(); }
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
  { colKey: "isActive", title: "状态", width: 82 },
  { colKey: "operation", title: "操作", width: 112 }
];
const userColumns = [
  { colKey: "name", title: "姓名", width: 96 },
  { colKey: "phone", title: "电话", width: 132 },
  { colKey: "departmentName", title: "部门", minWidth: 112 },
  { colKey: "status", title: "状态", width: 78 },
  { colKey: "mustChangePassword", title: "首次改密", width: 108 },
  { colKey: "globalPositions", title: "全局岗位", minWidth: 150 },
  { colKey: "rosterProjects", title: "项目归属", minWidth: 180 },
  { colKey: "projectPositions", title: "项目岗位", minWidth: 200 },
  { colKey: "operation", title: "人员与账号管理", minWidth: 280, fixed: "right" as const }
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
    const [result, access] = await Promise.all([fetchOrganizationDirectory(), fetchOrganizationManagementCapabilities()]);
    capabilities.value = access;
    Object.assign(directory, result);
    const pending = loadPendingPersonnel(auth.user?.id ?? "");
    if (pending && !personnelUser.value) {
      const user = result.users.find((row) => row.id === pending.userId);
      if (user && canManagePersonnel(user.id)) { personnelUser.value = user; pendingPersonnel.value = true; personnelVisible.value = true; }
    }
    applicationRefreshKey.value += 1;
    directoryMessage.value = "";
  } catch (error) {
    capabilities.value = null;
    directoryMessage.value = formatUnknownApiError(error, "读取组织目录失败，请稍后重试。");
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
      formatUnknownApiError(error, "读取权限完整性预检失败，请稍后重试。");
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
.employee-cards, .employee-card { display: grid; min-width: 0; gap: var(--jg-space-md); }
.employee-card { padding: var(--jg-space-md); border: var(--jg-border-width-base) solid var(--jg-border); border-radius: var(--jg-radius-md); overflow-wrap: anywhere; }
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
