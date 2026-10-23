<script setup lang="ts">
import type { OrganizationDirectoryUser } from "../../../api/organization.api";
defineProps<{ user: OrganizationDirectoryUser; canManage: boolean; canManageRoles: boolean; canManagePersonnel: boolean; currentUserId?: string }>();
const emit = defineEmits<{ details: []; security: []; add: []; remove: []; reset: [] }>();
</script>
<template>
  <div
    v-if="canManage || canManageRoles"
    class="person-actions"
  >
    <t-button
      v-if="canManagePersonnel"
      variant="text"
      @click="emit('details')"
    >
      员工详情
    </t-button>
    <t-button
      v-if="canManage"
      variant="text"
      @click="emit('security')"
    >
      {{ user.status === 'active' ? '部门 / 停用' : '重新启用' }}
    </t-button>
    <t-button
      v-if="canManageRoles && user.status === 'active'"
      variant="text"
      @click="emit('add')"
    >
      新增岗位
    </t-button>
    <t-button
      v-if="canManageRoles"
      variant="text"
      @click="emit('remove')"
    >
      撤销岗位
    </t-button>
    <t-button
      v-if="canManage && user.status === 'active'"
      variant="text"
      @click="emit('reset')"
    >
      重置密码
    </t-button>
  </div>
  <span v-else>{{ user.id === currentUserId ? '当前账号' : '无管理权限' }}</span>
</template>
<style scoped>
.person-actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-xs); }
</style>
