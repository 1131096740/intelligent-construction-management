<template>
  <section class="organization-page">
    <div class="page-head">
      <div>
        <h1>组织权限</h1>
        <p>维护部门层级、人员归属和启停状态，所有变更均需当前密码确认并写入权限审计。</p>
      </div>
      <div class="page-actions">
        <t-button
          variant="outline"
          :loading="refreshing"
          :disabled="saving || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
          @click="refreshPage"
        >
          刷新
        </t-button>
        <t-button
          variant="outline"
          :disabled="directoryLoading || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
          @click="openUserCreationDrawer"
        >
          新增人员
        </t-button>
        <t-button
          variant="outline"
          :disabled="directoryLoading || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
          @click="openBatchRoleRemovalDrawer"
        >
          批量预览撤岗
        </t-button>
        <t-button
          theme="primary"
          :disabled="directoryLoading || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
          @click="openCreateDepartment"
        >
          新建部门
        </t-button>
      </div>
    </div>

    <t-alert
      theme="info"
      title="本页可安全创建真实人员、维护部门和人员状态，并支持逐条岗位变更及批量撤岗只读预览；人员创建与授岗严格分离。"
      :close="false"
    />

    <t-alert
      v-if="directoryMessage"
      :theme="directoryMessageTone"
      :title="directoryMessage"
      :close="false"
    />

    <BusinessStatusSummary :items="summaryItems" />

    <t-card
      title="岗位数据预检"
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
          <t-table
            row-key="key"
            size="small"
            :columns="integrityColumns"
            :data="integrityIssueRows"
            :loading="integrityLoading"
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
            <template #operation="{ row }">
              <t-button
                v-if="isProjectSuperAdminRemediationRow(row.key)"
                size="small"
                variant="text"
                theme="primary"
                :disabled="saving || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
                @click="openProjectSuperAdminRemediation(row.key)"
              >
                预览清理
              </t-button>
            </template>
          </t-table>
        </template>
      </div>
    </t-card>

    <div class="organization-grid">
      <t-card
        title="部门层级"
        bordered
      >
        <t-table
          row-key="id"
          size="small"
          :columns="departmentColumns"
          :data="flatDepartments"
          :loading="directoryLoading"
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
          <template #operation="{ row }">
            <t-button
              size="small"
              variant="text"
              theme="primary"
              :disabled="saving || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
              @click="openEditDepartment(row)"
            >
              编辑
            </t-button>
          </template>
        </t-table>
      </t-card>

      <t-card
        title="人员目录"
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
          <template #operation="{ row }">
            <div class="row-actions">
              <t-button
                size="small"
                variant="text"
                theme="primary"
                :disabled="saving || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
                @click="openEditUser(row)"
              >
                编辑
              </t-button>
              <t-button
                size="small"
                variant="text"
                theme="primary"
                :disabled="saving || refreshing || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
                @click="openRoleDrawer(row)"
              >
                岗位管理
              </t-button>
              <t-tooltip
                v-if="row.status === 'inactive'"
                content="人员已停用，不能新增岗位"
              >
                <span>
                  <t-button
                    size="small"
                    variant="text"
                    theme="primary"
                    disabled
                  >
                    新增岗位
                  </t-button>
                </span>
              </t-tooltip>
              <t-button
                v-else
                size="small"
                variant="text"
                theme="primary"
                :disabled="saving || refreshing || roleDrawerVisible || roleAdditionDrawerVisible || batchRoleRemovalDrawerVisible || userCreationDrawerVisible"
                @click="openRoleAdditionDrawer(row)"
              >
                新增岗位
              </t-button>
            </div>
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
          {{ position.name }} · {{ position.key }}
        </t-tag>
        <span v-if="!directory.positions.length">暂无岗位</span>
      </div>
    </t-card>

    <t-dialog
      :visible="dialogVisible"
      :header="dialogTitle"
      :confirm-btn="dialogConfirmButton"
      :cancel-btn="dialogCancelButton"
      :close-btn="!saving"
      :close-on-esc-keydown="false"
      :close-on-overlay-click="false"
      @confirm="submitDialog"
      @close="closeDialog"
    >
      <div class="dialog-body">
        <t-alert
          theme="warning"
          :title="dialogConsequence"
          :close="false"
        />
        <t-alert
          v-if="dialogMessage"
          theme="error"
          :title="dialogMessage"
          :close="false"
        />
        <t-form label-align="top">
          <template v-if="dialogAction === 'create_department' || dialogAction === 'update_department'">
            <t-form-item label="部门名称">
              <t-input
                v-model="departmentForm.name"
                :disabled="saving"
                placeholder="请输入部门名称"
              />
            </t-form-item>
            <t-form-item label="上级部门">
              <t-select
                v-model="departmentForm.parentId"
                :disabled="saving"
                clearable
                :options="dialogDepartmentOptions"
                placeholder="不选择则为顶级部门"
                @clear="departmentForm.parentId = null"
              />
            </t-form-item>
            <t-form-item
              v-if="dialogAction === 'update_department'"
              label="部门状态"
            >
              <t-switch
                v-model="departmentForm.isActive"
                :disabled="saving"
                :label="['启用', '停用']"
              />
            </t-form-item>
          </template>

          <template v-if="dialogAction === 'update_user'">
            <t-form-item label="人员">
              <t-input
                :value="editingUser?.name ?? ''"
                disabled
              />
            </t-form-item>
            <t-form-item label="所属部门">
              <t-select
                v-model="userForm.departmentId"
                :disabled="saving"
                clearable
                :options="activeDepartmentOptions"
                placeholder="可清空为未分配部门"
                @clear="userForm.departmentId = null"
              />
            </t-form-item>
            <t-form-item label="人员状态">
              <t-switch
                v-model="userForm.isActive"
                :disabled="saving"
                :label="['启用', '停用']"
              />
            </t-form-item>
          </template>

          <t-form-item label="当前登录密码">
            <t-input
              v-model="confirmationPassword"
              type="password"
              autocomplete="current-password"
              :disabled="saving"
              placeholder="请输入当前登录密码"
            />
          </t-form-item>
        </t-form>
      </div>
    </t-dialog>

    <OrganizationUserCreationDrawer
      :visible="userCreationDrawerVisible"
      :department-options="activeDepartmentOptions"
      @close="closeUserCreationDrawer"
      @busy-change="userCreationDrawerBusy = $event"
      @created="handleUserCreated"
    />

    <OrganizationRoleRemovalDrawer
      :visible="roleDrawerVisible"
      :user="roleDrawerUser"
      :positions="directory.positions"
      :remediation-target="roleDrawerRemediationTarget"
      @close="closeRoleDrawer"
      @busy-change="roleDrawerBusy = $event"
      @applied="handleRoleRemovalApplied"
    />
    <OrganizationRoleAdditionDrawer
      :visible="roleAdditionDrawerVisible"
      :user="roleAdditionDrawerUser"
      :projects="directory.projects"
      :positions="directory.positions"
      @close="closeRoleAdditionDrawer"
      @busy-change="roleAdditionDrawerBusy = $event"
      @applied="handleRoleAdditionApplied"
    />
    <OrganizationBatchRoleRemovalDrawer
      :visible="batchRoleRemovalDrawerVisible"
      :directory="directory"
      @close="closeBatchRoleRemovalDrawer"
      @busy-change="batchRoleRemovalDrawerBusy = $event"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
import type { BusinessStatusSummaryItem } from "../../components/business-status-summary.config";
import {
  createOrganizationDepartment,
  fetchOrganizationDirectory,
  fetchPermissionIntegrity,
  updateOrganizationDepartment,
  updateOrganizationUser,
  type OrganizationDirectory,
  type OrganizationDirectoryUser,
  type PermissionIntegrityIssue,
  type PermissionIntegrityReadModel
} from "../../api/organization.api";
import {
  buildCreateDepartmentPayload,
  buildDepartmentParentOptions,
  buildDepartmentPatch,
  buildProjectSuperAdminRemediationTarget,
  buildUserPatch,
  departmentStatusText,
  filterOrganizationUsers,
  flattenDepartmentTree,
  globalPositionsText,
  mustChangePasswordText,
  organizationActionConsequence,
  isProjectSuperAdminRemediationIssue,
  permissionIntegrityIssueKey,
  permissionIntegrityIssueRows as buildPermissionIntegrityIssueRows,
  permissionIntegrityPolicyText,
  permissionIntegrityReadinessTag,
  permissionIntegritySummaryItems,
  projectPositionsText,
  userStatusText,
  type FlatOrganizationDepartment,
  type OrganizationActionKind,
  type OrganizationRoleRemovalTargetRow
} from "./organization.config";
import OrganizationRoleRemovalDrawer from "./components/OrganizationRoleRemovalDrawer.vue";
import OrganizationRoleAdditionDrawer from "./components/OrganizationRoleAdditionDrawer.vue";
import OrganizationBatchRoleRemovalDrawer from "./components/OrganizationBatchRoleRemovalDrawer.vue";
import OrganizationUserCreationDrawer from "./components/OrganizationUserCreationDrawer.vue";

const emptyDirectory = (): OrganizationDirectory => ({
  summary: { departments: 0, activeUsers: 0, inactiveUsers: 0, positions: 0 },
  departments: [],
  users: [],
  projects: [],
  positions: []
});

const directory = reactive<OrganizationDirectory>(emptyDirectory());
const permissionIntegrity = ref<PermissionIntegrityReadModel | null>(null);
const directoryLoading = ref(false);
const integrityLoading = ref(false);
const refreshing = ref(false);
const saving = ref(false);
const roleDrawerVisible = ref(false);
const roleDrawerBusy = ref(false);
const roleDrawerUser = ref<OrganizationDirectoryUser | null>(null);
const roleDrawerRemediationTarget = ref<OrganizationRoleRemovalTargetRow | null>(null);
const roleAdditionDrawerVisible = ref(false);
const roleAdditionDrawerBusy = ref(false);
const roleAdditionDrawerUser = ref<OrganizationDirectoryUser | null>(null);
const batchRoleRemovalDrawerVisible = ref(false);
const batchRoleRemovalDrawerBusy = ref(false);
const userCreationDrawerVisible = ref(false);
const userCreationDrawerBusy = ref(false);
const directoryMessage = ref("");
const directoryMessageTone = ref<"success" | "error">("success");
const integrityMessage = ref("");
const dialogVisible = ref(false);
const dialogAction = ref<OrganizationActionKind | null>(null);
const dialogMessage = ref("");
const confirmationPassword = ref("");
const editingDepartment = ref<FlatOrganizationDepartment | null>(null);
const editingUser = ref<OrganizationDirectoryUser | null>(null);
const filters = reactive<{
  keyword: string;
  departmentId: string | undefined;
  status: "active" | "inactive" | undefined;
}>({ keyword: "", departmentId: undefined, status: undefined });
const departmentForm = reactive<{ name: string; parentId: string | null; isActive: boolean }>({
  name: "",
  parentId: null,
  isActive: true
});
const userForm = reactive<{ departmentId: string | null; isActive: boolean }>({
  departmentId: null,
  isActive: true
});

const departmentColumns = [
  { colKey: "name", title: "部门", minWidth: 180 },
  { colKey: "parentName", title: "上级", minWidth: 120 },
  { colKey: "isActive", title: "状态", width: 82 },
  { colKey: "operation", title: "操作", width: 72, fixed: "right" }
];
const userColumns = [
  { colKey: "name", title: "姓名", width: 96 },
  { colKey: "phone", title: "电话", width: 132 },
  { colKey: "departmentName", title: "部门", minWidth: 112 },
  { colKey: "status", title: "状态", width: 78 },
  { colKey: "mustChangePassword", title: "首次改密", width: 108 },
  { colKey: "globalPositions", title: "全局岗位", minWidth: 150 },
  { colKey: "projectPositions", title: "项目岗位", minWidth: 200 },
  { colKey: "operation", title: "操作", width: 224, fixed: "right" }
];
const integrityColumns = [
  { colKey: "severity", title: "严重级别", width: 92 },
  { colKey: "issue", title: "问题", minWidth: 220 },
  { colKey: "sourceLabel", title: "来源", width: 120 },
  { colKey: "userId", title: "人员", minWidth: 132 },
  { colKey: "projectId", title: "项目", minWidth: 132 },
  { colKey: "roleKey", title: "岗位", minWidth: 150 },
  { colKey: "assignmentIds", title: "相关记录", minWidth: 200 },
  { colKey: "operation", title: "操作", width: 96, fixed: "right" }
];
const userStatusOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "inactive" }
];

const flatDepartments = computed(() => flattenDepartmentTree(directory.departments));
const activeDepartmentOptions = computed(() => buildDepartmentParentOptions(directory.departments));
const filterDepartmentOptions = computed(() =>
  flatDepartments.value.map((department) => ({ label: department.path, value: department.id }))
);
const dialogDepartmentOptions = computed(() =>
  buildDepartmentParentOptions(directory.departments, editingDepartment.value?.id)
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
  permissionIntegrity.value ? buildPermissionIntegrityIssueRows(permissionIntegrity.value.issues) : []
);
const projectSuperAdminRemediationIssues = computed(
  () =>
    new Map<string, PermissionIntegrityIssue>(
      (permissionIntegrity.value?.issues ?? [])
        .filter(isProjectSuperAdminRemediationIssue)
        .map((issue) => [permissionIntegrityIssueKey(issue), issue])
    )
);
const dialogTitle = computed(() => {
  if (dialogAction.value === "create_department") return "新建部门";
  if (dialogAction.value === "update_department") return "编辑部门";
  return "编辑人员";
});
const dialogConsequence = computed(() =>
  dialogAction.value
    ? organizationActionConsequence(
        dialogAction.value,
        dialogAction.value === "update_user" ? userForm.isActive : departmentForm.isActive
      )
    : ""
);
const dialogConfirmButton = computed(() => ({
  content: "确认保存",
  loading: saving.value,
  disabled: saving.value
}));
const dialogCancelButton = computed(() => ({ content: "取消", disabled: saving.value }));

onMounted(() => {
  void refreshPage();
});

async function loadDirectory() {
  directoryLoading.value = true;
  try {
    const result = await fetchOrganizationDirectory();
    Object.assign(directory, result);
    directoryMessage.value = "";
    return true;
  } catch (error) {
    directoryMessageTone.value = "error";
    directoryMessage.value = error instanceof Error ? error.message : "读取组织目录失败，请稍后重试。";
    return false;
  } finally {
    directoryLoading.value = false;
  }
}

async function loadPermissionIntegrity() {
  integrityLoading.value = true;
  try {
    permissionIntegrity.value = await fetchPermissionIntegrity();
    integrityMessage.value = "";
    return true;
  } catch (error) {
    integrityMessage.value =
      error instanceof Error ? error.message : "读取权限完整性预检失败，请稍后重试。";
    return false;
  } finally {
    integrityLoading.value = false;
  }
}

async function refreshPage() {
  if (
    refreshing.value ||
    roleDrawerVisible.value ||
    roleAdditionDrawerVisible.value ||
    batchRoleRemovalDrawerVisible.value ||
    userCreationDrawerVisible.value
  ) return;
  refreshing.value = true;
  try {
    await Promise.all([loadDirectory(), loadPermissionIntegrity()]);
  } finally {
    refreshing.value = false;
  }
}

function resetDialogSecrets() {
  confirmationPassword.value = "";
}

function openCreateDepartment() {
  editingDepartment.value = null;
  editingUser.value = null;
  Object.assign(departmentForm, { name: "", parentId: null, isActive: true });
  dialogAction.value = "create_department";
  dialogMessage.value = "";
  resetDialogSecrets();
  dialogVisible.value = true;
}

function openEditDepartment(department: FlatOrganizationDepartment) {
  editingDepartment.value = department;
  editingUser.value = null;
  Object.assign(departmentForm, {
    name: department.name,
    parentId: department.parentId,
    isActive: department.isActive
  });
  dialogAction.value = "update_department";
  dialogMessage.value = "";
  resetDialogSecrets();
  dialogVisible.value = true;
}

function openEditUser(user: OrganizationDirectoryUser) {
  editingDepartment.value = null;
  editingUser.value = user;
  Object.assign(userForm, { departmentId: user.departmentId, isActive: user.status === "active" });
  dialogAction.value = "update_user";
  dialogMessage.value = "";
  resetDialogSecrets();
  dialogVisible.value = true;
}

function openRoleDrawer(user: OrganizationDirectoryUser) {
  if (
    saving.value ||
    refreshing.value ||
    roleDrawerVisible.value ||
    roleAdditionDrawerVisible.value ||
    batchRoleRemovalDrawerVisible.value ||
    userCreationDrawerVisible.value
  ) return;
  roleDrawerUser.value = user;
  roleDrawerRemediationTarget.value = null;
  roleDrawerVisible.value = true;
}

function isProjectSuperAdminRemediationRow(issueKey: string) {
  return projectSuperAdminRemediationIssues.value.has(issueKey);
}

function openProjectSuperAdminRemediation(issueKey: string) {
  if (
    saving.value ||
    refreshing.value ||
    roleDrawerVisible.value ||
    roleAdditionDrawerVisible.value ||
    batchRoleRemovalDrawerVisible.value ||
    userCreationDrawerVisible.value
  ) return;
  const issue = projectSuperAdminRemediationIssues.value.get(issueKey);
  if (!issue?.userId) return;
  const user = directory.users.find((item) => item.id === issue.userId);
  if (!user) {
    directoryMessageTone.value = "error";
    directoryMessage.value = "未在组织目录中找到对应人员，不能清理该项目超级管理员异常。";
    return;
  }
  const remediationTarget = buildProjectSuperAdminRemediationTarget(
    issue,
    user,
    directory.positions
  );
  if (!remediationTarget) {
    directoryMessageTone.value = "error";
    directoryMessage.value = "该异常记录不满足安全清理条件，请刷新后重试。";
    return;
  }
  roleDrawerUser.value = user;
  roleDrawerRemediationTarget.value = remediationTarget;
  roleDrawerVisible.value = true;
}

function closeRoleDrawer() {
  if (roleDrawerBusy.value) return;
  roleDrawerVisible.value = false;
  roleDrawerUser.value = null;
  roleDrawerRemediationTarget.value = null;
}

async function handleRoleRemovalApplied() {
  roleDrawerVisible.value = false;
  roleDrawerUser.value = null;
  roleDrawerRemediationTarget.value = null;
  refreshing.value = true;
  try {
    const [directoryReloaded, integrityReloaded] = await Promise.all([
      loadDirectory(),
      loadPermissionIntegrity()
    ]);
    const fullyReloaded = directoryReloaded && integrityReloaded;
    directoryMessageTone.value = fullyReloaded ? "success" : "error";
    directoryMessage.value = fullyReloaded
      ? "岗位已撤销，组织目录和岗位数据预检已刷新。"
      : "岗位已撤销，但部分页面数据刷新失败，请手动刷新。";
  } finally {
    refreshing.value = false;
  }
}

function openRoleAdditionDrawer(user: OrganizationDirectoryUser) {
  if (
    saving.value ||
    refreshing.value ||
    roleDrawerVisible.value ||
    roleAdditionDrawerVisible.value ||
    batchRoleRemovalDrawerVisible.value ||
    userCreationDrawerVisible.value
  ) return;
  if (user.status !== "active") {
    directoryMessageTone.value = "error";
    directoryMessage.value = "人员已停用，不能新增岗位。";
    return;
  }
  roleAdditionDrawerUser.value = user;
  roleAdditionDrawerVisible.value = true;
}

function closeRoleAdditionDrawer() {
  if (roleAdditionDrawerBusy.value) return;
  roleAdditionDrawerVisible.value = false;
  roleAdditionDrawerUser.value = null;
}

async function handleRoleAdditionApplied() {
  roleAdditionDrawerVisible.value = false;
  roleAdditionDrawerUser.value = null;
  refreshing.value = true;
  try {
    const [directoryReloaded, integrityReloaded] = await Promise.all([
      loadDirectory(),
      loadPermissionIntegrity()
    ]);
    const fullyReloaded = directoryReloaded && integrityReloaded;
    directoryMessageTone.value = fullyReloaded ? "success" : "error";
    directoryMessage.value = fullyReloaded
      ? "岗位已新增，组织目录和岗位数据预检已刷新。"
      : "岗位已新增，但部分页面数据刷新失败，请手动刷新。";
  } finally {
    refreshing.value = false;
  }
}

function openBatchRoleRemovalDrawer() {
  if (
    saving.value ||
    refreshing.value ||
    roleDrawerVisible.value ||
    roleAdditionDrawerVisible.value ||
    batchRoleRemovalDrawerVisible.value ||
    userCreationDrawerVisible.value
  ) return;
  batchRoleRemovalDrawerVisible.value = true;
}

function closeBatchRoleRemovalDrawer() {
  if (batchRoleRemovalDrawerBusy.value) return;
  batchRoleRemovalDrawerVisible.value = false;
}

function openUserCreationDrawer() {
  if (
    saving.value ||
    refreshing.value ||
    roleDrawerVisible.value ||
    roleAdditionDrawerVisible.value ||
    batchRoleRemovalDrawerVisible.value ||
    userCreationDrawerVisible.value
  ) return;
  userCreationDrawerVisible.value = true;
}

function closeUserCreationDrawer() {
  if (userCreationDrawerBusy.value) return;
  userCreationDrawerVisible.value = false;
}

async function handleUserCreated() {
  userCreationDrawerVisible.value = false;
  refreshing.value = true;
  try {
    const reloaded = await loadDirectory();
    directoryMessageTone.value = reloaded ? "success" : "error";
    directoryMessage.value = reloaded
      ? "人员已创建但尚未授岗，组织目录已刷新。请使用“新增岗位”继续办理。"
      : "人员已创建但目录刷新失败，请手动刷新后再授岗。";
  } finally {
    refreshing.value = false;
  }
}

function closeDialog() {
  if (saving.value) return;
  resetDialogSecrets();
  dialogMessage.value = "";
  dialogVisible.value = false;
  dialogAction.value = null;
  editingDepartment.value = null;
  editingUser.value = null;
}

async function submitDialog() {
  if (saving.value || !dialogAction.value) return;
  saving.value = true;
  dialogMessage.value = "";
  try {
    if (dialogAction.value === "create_department") {
      await createOrganizationDepartment(
        buildCreateDepartmentPayload({ ...departmentForm, confirmationPassword: confirmationPassword.value })
      );
    } else if (dialogAction.value === "update_department") {
      if (!editingDepartment.value) throw new Error("未找到待编辑部门，请关闭后重试。");
      await updateOrganizationDepartment(
        editingDepartment.value.id,
        buildDepartmentPatch(editingDepartment.value, departmentForm, confirmationPassword.value)
      );
    } else {
      if (!editingUser.value) throw new Error("未找到待编辑人员，请关闭后重试。");
      await updateOrganizationUser(
        editingUser.value.id,
        buildUserPatch(
          {
            departmentId: editingUser.value.departmentId,
            isActive: editingUser.value.status === "active"
          },
          userForm,
          confirmationPassword.value
        )
      );
    }
    const reloaded = await loadDirectory();
    directoryMessageTone.value = reloaded ? "success" : "error";
    directoryMessage.value = reloaded
      ? "组织信息已保存，并已重新读取最新目录。"
      : "组织信息已保存，但目录刷新失败，请手动刷新。";
    saving.value = false;
    closeDialog();
  } catch (error) {
    dialogMessage.value = error instanceof Error ? error.message : "保存组织信息失败，请稍后重试。";
  } finally {
    resetDialogSecrets();
    saving.value = false;
  }
}
</script>

<style scoped>
.organization-page {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-lg);
  max-width: var(--jg-layout-page-max-width);
  margin: 0 auto;
}

.page-head,
.page-actions,
.row-actions,
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

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-md);
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

</style>
