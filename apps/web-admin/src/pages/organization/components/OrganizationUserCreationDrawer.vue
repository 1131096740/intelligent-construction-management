<template>
  <t-drawer
    :visible="visible"
    header="新增人员和账号"
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
        <BusinessEntryForm
          v-model="entryDraft"
          :definition="entryDefinition"
          :readonly="submitting"
          :options-by-field="{ departmentId: departmentOptions, initialRoleKey: roleOptions, projectId: projectOptions }"
        />
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
          创建人员和账号
        </t-button>
      </div>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import { formatUnknownApiError } from "../../../api/error-message";
import { ORGANIZATION_USER_ENTRY_DEFINITION, type BusinessEntryDraftPayload, type RoleKey } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { computed, reactive, ref, watch } from "vue";
import {
  createOrganizationUser,
  fetchOrganizationManagementCapabilities,
  GLOBAL_ORGANIZATION_ROLE_KEYS,
  DUAL_SCOPE_ORGANIZATION_ROLE_KEYS
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
const dualScopeRole = computed(() => DUAL_SCOPE_ORGANIZATION_ROLE_KEYS.includes(form.initialRoleKey as RoleKey));
const requiresProject = computed(
  () =>
    Boolean(form.initialRoleKey) &&
    (dualScopeRole.value ? form.initialRoleScope === "project" : !GLOBAL_ORGANIZATION_ROLE_KEYS.includes(form.initialRoleKey as RoleKey))
);

const entryDefinition = computed(() => ({
  ...ORGANIZATION_USER_ENTRY_DEFINITION,
  fields: ORGANIZATION_USER_ENTRY_DEFINITION.fields.filter((field) => ["phone", "departmentId", "initialRoleKey", ...(dualScopeRole.value ? ["initialRoleScope"] : []), ...(requiresProject.value ? ["projectId"] : [])].includes(field.key))
}));
const entryDraft = computed<BusinessEntryDraftPayload>({
  get: () => ({ sceneKey: entryDefinition.value.key, values: { phone: form.phone, departmentId: form.departmentId, initialRoleKey: form.initialRoleKey, initialRoleScope: form.initialRoleScope, projectId: form.projectId } }),
  set: ({ values }) => {
    form.phone = String(values.phone ?? ""); form.departmentId = String(values.departmentId ?? "");
    form.initialRoleKey = String(values.initialRoleKey ?? "") as RoleKey | "";
    form.initialRoleScope = values.initialRoleScope === "global" || values.initialRoleScope === "project" ? values.initialRoleScope : "";
    form.projectId = String(values.projectId ?? "");
  }
});

watch(() => form.initialRoleKey, () => { form.initialRoleScope = ""; form.projectId = ""; });
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
    await createOrganizationUserWithCapability(buildOrganizationUserCreatePayload(form));
    resetSensitiveFields();
    emit("created");
  } catch (error) {
    resetSensitiveFields();
    message.value = formatUnknownApiError(error, "创建人员失败，请稍后重试。");
  } finally {
    submitting.value = false;
  }
}

async function createOrganizationUserWithCapability(body: Parameters<typeof createOrganizationUser>[0]) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canCreateUser;
  if (!operationAllowed) throw new Error("当前账号不能执行此组织管理操作");
  return createOrganizationUser(body);
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
