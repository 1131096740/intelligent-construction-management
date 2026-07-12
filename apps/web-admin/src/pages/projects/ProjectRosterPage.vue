<template>
  <section class="project-roster-page">
    <div class="page-head">
      <div>
        <h1>项目花名册</h1>
        <p>查看当前账号可见项目的人员、公司岗位和项目业务岗位</p>
      </div>
      <t-button
        theme="primary"
        :loading="loading"
        @click="loadRoster"
      >
        刷新
      </t-button>
    </div>

    <t-card
      class="panel"
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
      <t-table
        row-key="rowKey"
        size="small"
        :columns="columns"
        :data="visibleRows"
        :loading="loading"
        empty="暂无可查看的项目人员"
      >
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchProjectRoster, type ProjectRosterRowReadModel } from "../../api/core-flow-read.api";

type RosterTableRow = ProjectRosterRowReadModel & {
  rowKey: string;
  project: string;
  globalPositions: string;
  projectPositions: string;
};

const columns = [
  { colKey: "project", title: "项目", minWidth: 180 },
  { colKey: "name", title: "姓名", width: 120 },
  { colKey: "phone", title: "电话", width: 150 },
  { colKey: "globalPositions", title: "公司岗位", minWidth: 180 },
  { colKey: "projectPositions", title: "项目岗位", minWidth: 180 }
];
const loading = ref(false);
const message = ref("");
const selectedProjectId = ref("");
const rows = ref<ProjectRosterRowReadModel[]>([]);
const tableRows = computed<RosterTableRow[]>(() =>
  rows.value.map((row) => ({
    ...row,
    rowKey: `${row.projectId}:${row.userId}`,
    project: `${row.projectCode} · ${row.projectName}`,
    globalPositions: row.globalPositionNames.join("、") || "无",
    projectPositions: row.projectPositionNames.join("、") || "无"
  }))
);
const visibleRows = computed(() =>
  selectedProjectId.value
    ? tableRows.value.filter((row) => row.projectId === selectedProjectId.value)
    : tableRows.value
);
const projectOptions = computed(() =>
  Array.from(new Map(rows.value.map((row) => [row.projectId, `${row.projectCode} · ${row.projectName}`]))).map(
    ([value, label]) => ({ value, label })
  )
);

onMounted(loadRoster);

async function loadRoster() {
  loading.value = true;
  message.value = "";
  try {
    rows.value = await fetchProjectRoster();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "读取项目花名册失败";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.project-roster-page {
  display: grid;
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

.message {
  margin-top: 12px;
  color: #b42318;
}
</style>
