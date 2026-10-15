<script setup lang="ts">
import { ORGANIZATION_DEPARTMENT_ENTRY_DEFINITION, ORGANIZATION_USER_ENTRY_DEFINITION, type BusinessEntryDraftPayload } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { computed, reactive, ref } from "vue";
import {
  createOrganizationDepartment, updateOrganizationDepartment, updateOrganizationUser,
  fetchOrganizationManagementCapabilities,
  type OrganizationDirectory, type OrganizationDirectoryUser
} from "../../../api/organization.api";
import { formatUnknownApiError } from "../../../api/error-message";
import {
  buildCreateDepartmentPayload, buildDepartmentPatch, buildDepartmentParentOptions,
  buildUserPatch, flattenDepartmentTree, type FlatOrganizationDepartment
} from "../organization.config";

const props = defineProps<{
  directory: OrganizationDirectory;
  department?: FlatOrganizationDepartment;
  user?: OrganizationDirectoryUser;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const saving = ref(false);
const message = ref("");
const form = reactive({
  name: props.department?.name ?? "",
  parentId: props.department?.parentId ?? "",
  departmentId: props.user?.departmentId ?? "",
  isActive: props.user ? props.user.status === "active" : props.department?.isActive ?? true,
  confirmationPassword: ""
});
const parentOptions = computed(() => [
  { label: "无上级部门", value: "" },
  ...buildDepartmentParentOptions(props.directory.departments, props.department?.id)
]);
const departmentOptions = computed(() => flattenDepartmentTree(props.directory.departments)
  .filter((department) => department.isActive)
  .map((department) => ({ label: department.path, value: department.id })));

const entryDefinition = computed(() => {
  const definition = props.user ? ORGANIZATION_USER_ENTRY_DEFINITION : ORGANIZATION_DEPARTMENT_ENTRY_DEFINITION;
  const keys = props.user ? ["departmentId", "isActive"] : props.department ? ["name", "parentId", "isActive"] : ["name", "parentId"];
  return { ...definition, fields: definition.fields.filter((field) => keys.includes(field.key)) };
});
const entryDraft = computed<BusinessEntryDraftPayload>({
  get: () => ({ sceneKey: entryDefinition.value.key, values: { name: form.name, parentId: form.parentId, departmentId: form.departmentId, isActive: form.isActive } }),
  set: ({ values }) => {
    for (const key of ["name", "parentId", "departmentId"] as const) if (key in values) form[key] = String(values[key] ?? "");
    if (typeof values.isActive === "boolean") form.isActive = values.isActive;
  }
});

async function saveDepartment() {
  const capability = await fetchOrganizationManagementCapabilities();
  if (!capability.canManageDepartments) throw new Error("当前账号不能调整部门");
  await createOrganizationDepartmentWithCapability(buildCreateDepartmentPayload({ ...form, parentId: form.parentId || null }));
}
async function updateDepartment() {
  if (!props.department) return;
  const capability = await fetchOrganizationManagementCapabilities();
  if (!capability.canManageDepartments) throw new Error("当前账号不能调整部门");
  await updateOrganizationDepartmentWithCapability(props.department.id, buildDepartmentPatch(
    props.department, { ...form, parentId: form.parentId || null }, form.confirmationPassword
  ));
}
async function saveUser() {
  if (!props.user) return;
  const capability = await fetchOrganizationManagementCapabilities();
  if (!capability.canManageUsers) throw new Error("当前账号不能管理人员");
  if (!capability.manageableUserIds.includes(props.user.id)) throw new Error("当前账号不能管理该人员");
  if (!form.departmentId || !capability.manageableDepartmentIds.includes(form.departmentId)) {
    throw new Error("请选择可管理的启用部门");
  }
  await updateOrganizationUserWithCapability(props.user.id, buildUserPatch(
    { departmentId: props.user.departmentId, isActive: props.user.status === "active" },
    { departmentId: form.departmentId, isActive: form.isActive }, form.confirmationPassword
  ));
}
async function submit() {
  if (saving.value) return;
  saving.value = true;
  message.value = "";
  try {
    if (props.user) await saveUser();
    else if (props.department) await updateDepartment();
    else await saveDepartment();
    emit("saved");
  } catch (error) {
    message.value = formatUnknownApiError(error, "保存组织信息失败，请稍后重试");
  } finally {
    form.confirmationPassword = "";
    saving.value = false;
  }
}

async function createOrganizationDepartmentWithCapability(body: Parameters<typeof createOrganizationDepartment>[0]) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageDepartments;
  if (!operationAllowed) throw new Error("当前账号不能执行此组织管理操作");
  return createOrganizationDepartment(body);
}

async function updateOrganizationDepartmentWithCapability(id: string, body: Parameters<typeof updateOrganizationDepartment>[1]) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageDepartments;
  if (!operationAllowed) throw new Error("当前账号不能执行此组织管理操作");
  return updateOrganizationDepartment(id, body);
}

async function updateOrganizationUserWithCapability(id: string, body: Parameters<typeof updateOrganizationUser>[1]) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageUsers;
  if (!operationAllowed) throw new Error("当前账号不能执行此组织管理操作");
  return updateOrganizationUser(id, body);
}
</script>

<template>
  <t-drawer
    visible
    :header="user ? `调整人员：${user.name}` : department ? '调整部门' : '新增部门'"
    size="medium"
    :footer="false"
    :close-btn="!saving"
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    @close="!saving && emit('close')"
  >
    <div class="organization-details">
      <t-alert v-if="message" theme="error" :title="message" :close="false" />
      <t-alert
        v-if="user"
        theme="info"
        title="人员与登录账号是同一条记录。停用前请先撤销岗位并完成待办交接；停用后不能登录，历史记录保留。重新启用后可为原账号重新安排岗位。"
        :close="false"
      />
      <t-form label-align="top">
        <BusinessEntryForm v-model="entryDraft" :definition="entryDefinition" :readonly="saving" :options-by-field="{ parentId: parentOptions, departmentId: departmentOptions }" />
        <t-form-item label="你的当前登录密码">
          <t-input v-model="form.confirmationPassword" type="password" autocomplete="current-password" :disabled="saving" />
        </t-form-item>
      </t-form>
      <div class="drawer-actions">
        <t-button variant="outline" :disabled="saving" @click="emit('close')">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submit">保存调整</t-button>
      </div>
    </div>
  </t-drawer>
</template>

<style scoped>
.organization-details { display: grid; gap: var(--jg-space-md); }
.drawer-actions { display: flex; justify-content: flex-end; gap: var(--jg-space-sm); }
</style>
