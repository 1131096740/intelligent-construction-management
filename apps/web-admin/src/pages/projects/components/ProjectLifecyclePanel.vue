<template>
  <section class="project-lifecycle" aria-label="项目启停管理">
    <p>建错且尚无业务的空项目可以停用和恢复。已有业务请走结项流程，继续保留历史查询和尾款办理。</p>
    <t-button variant="outline" :loading="loading" :disabled="saving" @click="load">刷新项目列表</t-button>
    <BusinessFeedback v-if="message" state="error" title="暂时无法办理" :description="message" />
    <ul class="project-lifecycle-list">
      <li v-for="project in projects" :key="project.id">
        <div><strong>{{ project.name }}</strong><span>{{ project.code }} · {{ project.isActive ? '启用中' : '已停用' }}</span></div>
        <t-button variant="outline" :disabled="saving || loading" @click="changeStatus(project)">{{ project.isActive ? '停用空项目' : '重新启用' }}</t-button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { DialogPlugin } from "tdesign-vue-next";
import { fetchProjectManagement, updateProjectStatus, type ProjectManagementRow } from "../../../api/project-operating-profile.api";
import { fetchProjectUpdateCapability } from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";
import BusinessFeedback from "../../../components/BusinessFeedback.vue";

const props = defineProps<{ beforeChange: () => Promise<boolean> }>();
const emit = defineEmits<{ saved: [] }>();
const projects = ref<ProjectManagementRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const message = ref("");
onMounted(load);
async function load() {
  loading.value = true;
  message.value = "";
  try { projects.value = await fetchProjectManagement(); }
  catch (error) { message.value = formatUnknownApiError(error, "读取项目列表失败"); }
  finally { loading.value = false; }
}
async function changeStatus(project: ProjectManagementRow) {
  if (saving.value || !await props.beforeChange()) return;
  const dialog = DialogPlugin.confirm({
    header: project.isActive ? "停用空项目" : "重新启用项目",
    body: project.isActive ? `确认停用“${project.name}”？系统会检查是否已有业务，有业务的项目将保持启用。` : `确认重新启用“${project.name}”？`,
    confirmBtn: "确认", cancelBtn: "取消",
    onConfirm: async () => {
      if (saving.value) return;
      saving.value = true;
      message.value = "";
      dialog.hide();
      try {
        await saveProjectStatus(project);
        await load();
        emit("saved");
      } catch (error) { message.value = formatUnknownApiError(error, "更新项目状态失败"); }
      finally { saving.value = false; }
    }
  });
}
async function saveProjectStatus(project: ProjectManagementRow) {
  const capability = await fetchProjectUpdateCapability(project.id);
  const operationAllowed = capability.availableActions.includes("update_project_status");
  if (!operationAllowed) throw new Error("维护权限已变化，请刷新后重试");
  return updateProjectStatus(project.id, !project.isActive);
}
</script>

<style scoped>
.project-lifecycle { display: grid; gap: var(--jg-space-md); color: var(--jg-color-text-primary); }
.project-lifecycle-list { display: grid; gap: var(--jg-space-md); padding: 0; list-style: none; }
.project-lifecycle-list li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--jg-space-sm); }
.project-lifecycle-list li div { display: grid; gap: var(--jg-space-xs); overflow-wrap: anywhere; }
</style>
