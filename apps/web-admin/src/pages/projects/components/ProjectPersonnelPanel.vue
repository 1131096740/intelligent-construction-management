<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { fetchProjectRoster, type ProjectRosterRowReadModel } from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";

const props = defineProps<{ projectId: string }>();
const rows = ref<ProjectRosterRowReadModel[]>([]);
const loading = ref(false);
const message = ref("");
let generation = 0;
onBeforeUnmount(() => { generation += 1; });
const personnelTarget = computed(() => ({ path: "/员工管理", query: { view: "projects", projectId: props.projectId } }));
watch(() => props.projectId, async (projectId) => {
  const current = ++generation;
  rows.value = []; message.value = "";
  if (!projectId) { loading.value = false; return; }
  loading.value = true;
  try {
    const result = await fetchProjectRoster();
    if (current === generation) rows.value = result.filter((row) => row.projectId === projectId);
  } catch (error) {
    if (current === generation) message.value = formatUnknownApiError(error, "读取项目人员失败，请刷新后重试");
  } finally { if (current === generation) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <t-card title="项目人员">
    <p>查看当前项目经理、总工、合同员、物资员等岗位。人员调整统一在员工管理办理。</p>
    <p
      v-if="loading"
      role="status"
    >
      正在读取项目人员
    </p>
    <p
      v-else-if="message"
      role="alert"
    >
      {{ message }}
    </p>
    <ul v-else-if="rows.length">
      <li
        v-for="person in rows"
        :key="person.userId"
      >
        <strong>{{ person.name }}</strong>：{{ person.projectPositionNames.join('、') || '项目成员（未配置项目岗位）' }}
      </li>
    </ul>
    <p v-else>
      当前项目暂无已配置人员，请由有权管理员在员工管理中核对。
    </p>
    <router-link
      v-if="projectId"
      :to="personnelTarget"
    >
      前往人员与岗位
    </router-link>
  </t-card>
</template>

<style scoped>
p, li { color: var(--jg-text-secondary); line-height: 1.6; }
ul { padding-inline-start: var(--jg-space-lg); }
strong { color: var(--jg-text-primary); }
</style>
