<template>
  <t-drawer
    :visible="visible"
    header="新增人员"
    size="medium"
    :footer="false"
    :close-btn="!submitting"
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    @close="requestClose"
  >
    <div class="user-creation-drawer">
      <t-alert
        theme="info"
        title="人员创建后姓名固定为“待本人确认”，并获得所选初始岗位；首次登录时由本人填写真实姓名并强制改密。"
        :close="false"
      />
      <t-alert
        theme="warning"
        title="新账号使用公司统一初始密码。请通过线下安全渠道告知本人，并提醒其首次登录立即修改。"
        :close="false"
      />
      <t-alert
        v-if="message"
        theme="error"
        :title="message"
        :close="false"
      />

      <t-form label-align="top">
        <t-form-item label="手机号">
          <t-input
            v-model="form.phone"
            :disabled="submitting"
            placeholder="请输入 11 位中国大陆手机号"
          />
        </t-form-item>
        <t-form-item label="所属部门">
          <t-select
            v-model="form.departmentId"
            :disabled="submitting"
            :options="departmentOptions"
            placeholder="请选择启用部门"
          />
        </t-form-item>
        <t-form-item label="初始岗位">
          <t-select
            v-model="form.initialRoleKey"
            :disabled="submitting"
            :options="roleOptions"
            placeholder="请选择允许授予的初始岗位"
          />
        </t-form-item>
        <t-form-item
          v-if="requiresProject"
          label="安排项目"
        >
          <t-select
            v-model="form.projectId"
            :disabled="submitting"
            :options="projectOptions"
            placeholder="请选择启用项目"
          />
        </t-form-item>
        <t-form-item>
          <t-checkbox
            v-model="form.passwordRecorded"
            :disabled="submitting"
          >
            我已通过线下安全渠道告知公司统一初始密码
          </t-checkbox>
        </t-form-item>
        <t-form-item label="管理员当前密码">
          <t-input
            v-model="form.confirmationPassword"
            type="password"
            autocomplete="current-password"
            :disabled="submitting"
            placeholder="请验证管理员当前密码"
          />
        </t-form-item>
      </t-form>

      <div class="drawer-actions">
        <t-button
          variant="outline"
          :disabled="submitting"
          @click="requestClose"
        >
          取消
        </t-button>
        <t-button
          theme="primary"
          :loading="submitting"
          @click="submitCreation"
        >
          确认创建人员
        </t-button>
      </div>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import type { RoleKey } from "@jiangkong/shared-domain";
import { computed, reactive, ref, watch } from "vue";
import {
  createOrganizationUser,
  GLOBAL_ORGANIZATION_ROLE_KEYS
} from "../../../api/organization.api";
import {
  buildOrganizationUserCreatePayload,
  emptyOrganizationUserCreationForm
} from "../organization-user-creation";

const props = defineProps<{
  visible: boolean;
  departmentOptions: Array<{ label: string; value: string }>;
  roleOptions: Array<{ label: string; value: RoleKey }>;
  projectOptions: Array<{ label: string; value: string }>;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
  "busy-change": [busy: boolean];
}>();

const form = reactive(emptyOrganizationUserCreationForm());
const submitting = ref(false);
const message = ref("");
const requiresProject = computed(
  () =>
    Boolean(form.initialRoleKey) &&
    !GLOBAL_ORGANIZATION_ROLE_KEYS.includes(form.initialRoleKey as RoleKey)
);

watch(requiresProject, (required) => {
  if (!required) form.projectId = "";
});

watch(submitting, (busy) => emit("busy-change", busy), { immediate: true });
watch(
  () => props.visible,
  () => {
    resetDrawer();
  }
);

function resetSensitiveFields() {
  form.confirmationPassword = "";
  form.passwordRecorded = false;
}

function resetDrawer() {
  Object.assign(form, emptyOrganizationUserCreationForm());
  submitting.value = false;
  message.value = "";
}

function requestClose() {
  if (submitting.value) return;
  resetDrawer();
  emit("close");
}

async function submitCreation() {
  if (submitting.value) return;
  submitting.value = true;
  message.value = "";
  try {
    await createOrganizationUser(buildOrganizationUserCreatePayload(form));
    resetSensitiveFields();
    emit("created");
  } catch (error) {
    resetSensitiveFields();
    message.value = error instanceof Error ? error.message : "创建人员失败，请稍后重试。";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.user-creation-drawer {
  container-name: organization-drawer;
  container-type: inline-size;
  display: grid;
  gap: var(--jg-space-md);
}

.drawer-actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
}

.drawer-actions {
  justify-content: flex-end;
}
</style>
