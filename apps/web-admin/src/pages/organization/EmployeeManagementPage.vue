<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import { organizationAdminRoleKeys } from "../../routes/route-records";
import OrganizationManagementPage from "./OrganizationManagementPage.vue";
import ProjectRosterPage from "../projects/ProjectRosterPage.vue";

const auth = useAuthStore();
const route = useRoute();
const canReadDirectory = computed(() => organizationAdminRoleKeys.some((role) => auth.user?.globalRoleKeys.includes(role)));
const view = ref(route.query.view === "projects" ? "projects" : "people");
</script>

<template>
  <section class="employee-management jg-responsive-workspace">
    <header>
      <h1>员工管理</h1>
      <p>按原有权限查看员工、办理入职及人员调整。</p>
    </header>
    <template v-if="canReadDirectory">
      <t-tabs v-model="view">
        <t-tab-panel
          value="people"
          label="员工目录"
        />
        <t-tab-panel
          value="projects"
          label="项目花名册"
        />
      </t-tabs>
      <OrganizationManagementPage v-if="view === 'people'" />
      <ProjectRosterPage v-else />
    </template>
    <ProjectRosterPage v-else />
  </section>
</template>

<style scoped>
.employee-management { display: grid; min-width: 0; gap: var(--jg-space-lg); }
h1 { margin: 0; font-size: var(--jg-font-size-title); }
p { color: var(--jg-text-secondary); margin: var(--jg-space-sm) 0 0; }
</style>
