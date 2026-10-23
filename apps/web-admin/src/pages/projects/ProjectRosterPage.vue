<template>
  <section class="project-roster-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>项目花名册</h1>
        <p>按项目查看人员；董事长和综合部主管可维护授权范围内的项目成员</p>
      </div>
      <div
        v-if="canManage"
        class="roster-actions"
      >
        <t-button
          theme="primary"
          :disabled="loading || (!pendingChange && (!selectedProjectId || !management))"
          @click="openJoin"
        >
          {{ pendingChange ? '继续核对人员调整' : '调入人员' }}
        </t-button>
        <p>先选择项目，再调入人员。项目岗位可在员工管理中设置。</p>
      </div>
      <t-button
        theme="primary"
        :loading="loading"
        @click="loadRoster"
      >
        刷新
      </t-button>
    </div>

    <t-alert
      v-if="savedMessage"
      theme="success"
      :title="savedMessage"
    />

    <t-card
      class="panel jg-table-region jg-table-region--wide"
      :bordered="true"
    >
      <div class="filters">
        <label>
          <span>项目</span>
          <t-select
            v-model="selectedProjectId"
            :options="projectOptions"
            clearable
            placeholder="全部可见项目"
          />
        </label>
      </div>
      <div
        v-if="mobile"
        class="roster-cards"

        aria-label="项目花名册"
      >
        <article
          v-for="row in visibleRows"
          :key="row.rowKey"
          class="roster-card"
        >
          <strong>{{ row.name }} · {{ row.phone }}</strong>
          <span>{{ row.project }}</span>
          <span>公司岗位：{{ row.globalPositions }}</span>
          <span>项目岗位：{{ row.projectPositions }}</span>
          <t-button
            v-if="canManagePerson(row.userId)"
            variant="text"
            theme="danger"
            :disabled="loading"
            @click="openLeave(row)"
          >
            调出项目
          </t-button>
          <span v-else-if="canManage">由董事长或其他有权管理员维护</span>
        </article>
        <p v-if="!visibleRows.length">
          {{ loading ? '正在读取人员' : '暂无可查看的项目人员' }}
        </p>
      </div>
      <t-table
        v-else
        row-key="rowKey"
        size="small"
        :columns="columns"
        :data="visibleRows"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无可查看的项目人员"
      >
        <template #operation="{ row }">
          <t-button
            v-if="canManagePerson(row.userId)"
            variant="text"
            theme="danger"
            :disabled="loading"
            @click="openLeave(row)"
          >
            调出项目
          </t-button>
          <span v-else-if="canManage">由董事长或其他有权管理员维护</span>
        </template>
        <template #globalPositions="{ row }">
          {{ row.globalPositions }}
        </template>
        <template #projectPositions="{ row }">
          {{ row.projectPositions }}
        </template>
      </t-table>
      <p
        v-if="message"
        class="message"
      >
        {{ message }}
      </p>
    </t-card>
    <ProjectRosterChangeDrawer
      :visible="drawerVisible"
      :operation="operation"
      :project-id="targetProjectId"
      :project-name="targetProjectName"
      :user-id="targetUserId"
      :users="availableUsers"
      @close="drawerVisible = false"
      @saved="onSaved"
      @refresh="loadRoster"
      @pending="pendingChange = $event"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchProjectRoster, fetchProjects, type ProjectRosterRowReadModel, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import { fetchProjectRosterManagementOptions, type ProjectRosterManagementOptions } from "../../api/organization.api";
import { formatUnknownApiError } from "../../api/error-message";
import { useAuthStore } from "../../auth/auth.store";
import { usePersonnelMobile } from "../organization/use-personnel-mobile";
import ProjectRosterChangeDrawer from "./components/ProjectRosterChangeDrawer.vue";

type RosterTableRow = ProjectRosterRowReadModel & {
  rowKey: string;
  project: string;
  globalPositions: string;
  projectPositions: string;
};

const mobile = usePersonnelMobile();
const auth = useAuthStore();
const canManage = computed(() => auth.user?.globalRoleKeys.some((role) => role === "chairman" || role === "comprehensive_director") ?? false);
const columns = computed(() => [
  { colKey: "project", title: "项目", minWidth: 180 },
  { colKey: "name", title: "姓名", width: 120 },
  { colKey: "phone", title: "电话", width: 150 },
  { colKey: "globalPositions", title: "公司岗位", minWidth: 180 },
  { colKey: "projectPositions", title: "项目岗位", minWidth: 180 },
  ...(canManage.value ? [{ colKey: "operation", title: "操作", minWidth: 180 }] : [])
]);
const loading = ref(false);
const message = ref("");
const savedMessage = ref("");
const selectedProjectId = ref("");
const rows = ref<ProjectRosterRowReadModel[]>([]);
const projects = ref<ProjectOptionReadModel[]>([]);
const management = ref<ProjectRosterManagementOptions | null>(null);
const drawerVisible = ref(false);
const pendingChange = ref(false);
const operation = ref<"join" | "leave">("join");
const targetProjectId = ref("");
const targetProjectName = ref("");
const targetUserId = ref("");
const availableUsers = computed(() => (management.value?.users ?? []).filter((user) =>
  operation.value === "leave" || !rows.value.some((row) => row.projectId === targetProjectId.value && row.userId === user.id)
));
function canManagePerson(userId: string) { return management.value?.users.some((user) => user.id === userId && user.canManage) ?? false; }
function openJoin() {
  if (pendingChange.value) { drawerVisible.value = true; return; }
  const project = projects.value.find((row) => row.id === selectedProjectId.value);
  if (!project || !management.value) return;
  operation.value = "join"; targetProjectId.value = project.id; targetProjectName.value = project.name;
  targetUserId.value = ""; drawerVisible.value = true;
}
function openLeave(row: RosterTableRow) {
  if (!canManagePerson(row.userId)) return;
  operation.value = "leave"; targetProjectId.value = row.projectId; targetProjectName.value = row.projectName;
  targetUserId.value = row.userId; drawerVisible.value = true;
}
async function onSaved() { drawerVisible.value = false; savedMessage.value = "人员调整已保存"; await loadRoster(); }
const tableRows = computed<RosterTableRow[]>(() =>
  rows.value.map((row) => ({
    ...row,
    rowKey: `${row.projectId}:${row.userId}`,
    project: `${row.projectCode} · ${row.projectName}`,
    globalPositions: row.globalPositionNames.join("、") || "无",
    projectPositions: `${row.projectPositionNames.join("、") || "无"}${row.needsReconciliation ? `；旧任职待核对（${row.legacyPositionNames?.join("、") || "原岗位待核实"}）` : ""}`
  }))
);
const visibleRows = computed(() =>
  selectedProjectId.value
    ? tableRows.value.filter((row) => row.projectId === selectedProjectId.value)
    : tableRows.value
);
const projectOptions = computed(() =>
  projects.value.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))
);

onMounted(loadRoster);

async function loadRoster() {
  loading.value = true;
  message.value = "";
  management.value = null;
  try {
    const [nextRows, nextProjects, nextManagement] = await Promise.allSettled([
      fetchProjectRoster(), fetchProjects(), canManage.value ? fetchProjectRosterManagementOptions() : Promise.resolve(null)
    ]);
    const failures: string[] = [];
    if (nextRows.status === "fulfilled") rows.value = nextRows.value;
    else failures.push(formatUnknownApiError(nextRows.reason, "读取项目花名册失败"));
    if (nextProjects.status === "fulfilled") projects.value = nextProjects.value;
    else failures.push(`读取项目列表失败：${formatUnknownApiError(nextProjects.reason, "请稍后刷新")}`);
    if (nextManagement.status === "fulfilled") management.value = nextManagement.value;
    else failures.push(formatUnknownApiError(nextManagement.reason, "读取项目人员维护范围失败"));
    message.value = failures.join("；");
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取项目花名册失败");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.roster-cards, .roster-card { display: grid; min-width: 0; gap: var(--jg-space-md); }
.roster-card { padding: var(--jg-space-md); border: var(--jg-border-width-base) solid var(--jg-border); border-radius: var(--jg-radius-md); overflow-wrap: anywhere; }
.project-roster-page {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.page-head p,
.message {
  margin: 0;
  color: #5d6675;
}

.panel {
  border-radius: 6px;
}

.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.filters label {
  min-width: 260px;
  display: grid;
  gap: 6px;
  color: #5d6675;
  font-size: 12px;
}

.roster-actions { display: flex; align-items: center; gap: var(--jg-space-md); flex-wrap: wrap; margin-bottom: var(--jg-space-md); }
.roster-actions p { margin: 0; color: var(--jg-text-secondary); }

.message {
  margin-top: 12px;
  color: #b42318;
}

@container jg-page (max-width: 620px) {
  .page-head {
    flex-direction: column;
  }

  .filters,
  .filters label {
    width: 100%;
    min-width: 0;
  }
}
</style>
