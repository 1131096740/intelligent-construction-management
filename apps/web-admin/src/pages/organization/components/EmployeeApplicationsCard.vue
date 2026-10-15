<template>
  <t-card
    :title="`入职申请（待处理 ${pendingCount}）`"
    bordered
  >
    <div class="applications-content">
      <p>综合部审核普通员工；管理层、重要岗位和全部财务人员由董事长审核。董事长可直接审核所有申请。</p>
      <t-button
        variant="outline"
        :loading="loading"
        @click="load"
      >
        刷新申请
      </t-button>
      <t-alert
        v-if="message"
        theme="error"
        :message="message"
      />
      <div class="jg-table-region jg-table-region--standard">
        <t-table
          row-key="id"
          :data="applications"
          :columns="columns"
          :loading="loading"
          empty="暂无入职申请"
          :horizontal-scroll-affixed-bottom="true"
        >
          <template #status="{ row }">
            {{ statusText[row.status as EmployeeApplication['status']] }}
          </template>
          <template #phoneVerified="{ row }">
            {{ row.phoneVerified ? '已通过短信验证' : '请核对本人手机号' }}
          </template>
          <template #operation="{ row }">
            <div class="application-actions">
              <t-button
                v-if="canProcess(row) && ['pending', 'chairman_review'].includes(row.status)"
                variant="text"
                @click="open(row)"
              >
                审核申请
              </t-button>
              <t-button
                v-if="canProcess(row) && row.status !== 'approved'"
                variant="text"
                @click="resetTarget = row"
              >
                重置申请密码
              </t-button>
              <span v-if="row.status === 'chairman_review' && !capabilities.canApproveImportantEmployees">待董事长处理</span>
            </div>
          </template>
        </t-table>
      </div>
    </div>
    <t-drawer
      v-if="selected"
      :visible="true"
      header="审核入职申请"
      size="min(680px, 100vw)"
      :footer="false"
      :close-on-overlay-click="false"
      :close-on-esc-keydown="!busy"
      :close-btn="!busy"
      @close="close"
    >
      <div class="applications-content">
        <h2>{{ selected.name }} · {{ selected.phone }}</h2>
        <t-alert
          v-if="selected.mustChangePassword"
          theme="warning"
          message="员工还在使用临时密码，请先让本人登录设置密码后再批准开通。"
        />
        <BusinessEntryForm
          v-model="departmentDraft"
          :definition="departmentDefinition"
          :readonly="busy"
          :options-by-field="{ departmentId: departmentOptions }"
        />
        <div
          v-for="(role, index) in roles"
          :key="index"
          class="role-row"
        >
          <BusinessEntryForm
            :model-value="roleDraft(role)"
            :definition="roleDefinition(role)"
            :readonly="busy"
            :options-by-field="{ initialRoleKey: roleOptions, projectId: projectOptions }"
            @update:model-value="changeRole(index, $event)"
          />
          <t-button
            v-if="roles.length > 1"
            variant="text"
            :disabled="busy"
            @click="roles.splice(index, 1)"
          >
            移除此岗位
          </t-button>
        </div>
        <t-button
          variant="outline"
          :disabled="busy || roles.length >= 20"
          @click="roles.push({ roleKey: '', projectId: '' })"
        >
          再安排一个岗位
        </t-button>
        <t-alert
          v-if="needsChairman && !capabilities.canApproveImportantEmployees"
          theme="info"
          message="包含财务或重要岗位，请转交董事长审核。"
        />
        <t-checkbox
          v-model="identityVerified"
          :disabled="busy"
        >
          我已核对员工本人及手机号
        </t-checkbox>
        <t-textarea
          v-model="reason"
          label="处理说明"
          placeholder="退回时请说明需要员工修改什么"
          :maxlength="500"
          :disabled="busy"
        />
        <t-input
          v-model="password"
          type="password"
          placeholder="请输入本人当前登录密码"
          autocomplete="current-password"
          :disabled="busy"
        />
        <t-alert
          v-if="reviewMessage"
          theme="error"
          :message="reviewMessage"
        />
        <div class="application-actions">
          <t-button
            theme="primary"
            :loading="busy"
            :disabled="!identityVerified || Boolean(selected.mustChangePassword) || (needsChairman && !capabilities.canApproveImportantEmployees)"
            @click="review('approve')"
          >
            批准开通
          </t-button>
          <t-button
            v-if="!capabilities.canApproveImportantEmployees"
            variant="outline"
            :disabled="busy || !identityVerified"
            @click="review('refer')"
          >
            转交董事长
          </t-button>
          <t-button
            variant="outline"
            :disabled="busy"
            @click="review('return')"
          >
            退回修改
          </t-button>
        </div>
      </div>
    </t-drawer>
    <AccountCredentialDialog
      v-if="resetTarget"
      :id="resetTarget.id"
      :name="resetTarget.name"
      kind="applications"
      @close="resetTarget = null"
      @saved="load"
    />
  </t-card>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ORGANIZATION_USER_ENTRY_DEFINITION, type BusinessEntryDraftPayload, type RoleKey } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { GLOBAL_ORGANIZATION_ROLE_KEYS, fetchOrganizationManagementCapabilities, type OrganizationDirectory, type OrganizationManagementCapabilities } from "../../../api/organization.api";
import { fetchEmployeeApplications, reviewEmployeeApplication, type EmployeeApplication, type EmployeeReview } from "../../../api/employee-onboarding.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { flattenDepartmentTree } from "../organization.config";
import AccountCredentialDialog from "./AccountCredentialDialog.vue";
const props = defineProps<{ directory: OrganizationDirectory; capabilities: OrganizationManagementCapabilities; refreshKey: number }>();
const emit = defineEmits<{ approved: [] }>();
const applications = ref<EmployeeApplication[]>([]); const pendingCount = ref(0); const loading = ref(false); const message = ref("");
const selected = ref<EmployeeApplication | null>(null); const resetTarget = ref<EmployeeApplication | null>(null);
const departmentId = ref(""); const roles = ref<Array<{ roleKey: RoleKey | ""; projectId: string }>>([]);
const identityVerified = ref(false); const reason = ref(""); const password = ref(""); const busy = ref(false); const reviewMessage = ref("");
const columns = [{ colKey: "name", title: "姓名", width: 110 }, { colKey: "phone", title: "手机号", width: 140 }, { colKey: "status", title: "进度", width: 140 }, { colKey: "phoneVerified", title: "身份核验", width: 160 }, { colKey: "operation", title: "操作", minWidth: 200 }];
const statusText = { pending: "待审核", chairman_review: "待董事长审核", returned: "已退回", approved: "已开通" };
const departmentOptions = computed(() => flattenDepartmentTree(props.directory.departments).filter((item) => item.isActive).map((item) => ({ label: item.path, value: item.id })));
const projectOptions = computed(() => props.directory.projects.filter((item) => item.isActive).map((item) => ({ label: item.name, value: item.id })));
const roleOptions = computed(() => props.directory.positions.filter((item) => item.key !== "super_admin").map((item) => ({ label: item.name, value: item.key })));
const departmentDefinition = { ...ORGANIZATION_USER_ENTRY_DEFINITION, fields: ORGANIZATION_USER_ENTRY_DEFINITION.fields.filter((field) => field.key === "departmentId") };
const departmentDraft = computed<BusinessEntryDraftPayload>({ get: () => ({ sceneKey: departmentDefinition.key, values: { departmentId: departmentId.value } }), set: ({ values }) => { departmentId.value = String(values.departmentId ?? ""); } });
const needsChairman = computed(() => roles.value.some((role) => role.roleKey && props.capabilities.importantEmployeeRoleKeys?.includes(role.roleKey)));
const requiresProject = (role: { roleKey: RoleKey | "" }) => Boolean(role.roleKey) && !GLOBAL_ORGANIZATION_ROLE_KEYS.includes(role.roleKey as RoleKey);
const roleDefinition = (role: { roleKey: RoleKey | "" }) => ({ ...ORGANIZATION_USER_ENTRY_DEFINITION, fields: ORGANIZATION_USER_ENTRY_DEFINITION.fields.filter((field) => field.key === "initialRoleKey" || (field.key === "projectId" && requiresProject(role))) });
const roleDraft = (role: { roleKey: RoleKey | ""; projectId: string }): BusinessEntryDraftPayload => ({ sceneKey: ORGANIZATION_USER_ENTRY_DEFINITION.key, values: { initialRoleKey: role.roleKey, projectId: role.projectId } });
function changeRole(index: number, draft: BusinessEntryDraftPayload) {
  const roleKey = String(draft.values.initialRoleKey ?? "") as RoleKey | "";
  roles.value[index] = { roleKey, projectId: requiresProject({ roleKey }) ? String(draft.values.projectId ?? "") : "" };
}
function canProcess(row: EmployeeApplication) { return row.status !== "chairman_review" || props.capabilities.canApproveImportantEmployees; }
onMounted(load); watch(() => props.refreshKey, load);
async function load() { if (loading.value) return; loading.value = true; try { const result = await fetchEmployeeApplications(); applications.value = result.applications; pendingCount.value = result.pendingCount; message.value = ""; } catch (error) { message.value = formatUnknownApiError(error, "读取入职申请失败"); } finally { loading.value = false; } }
function open(row: EmployeeApplication) {
  selected.value = row; departmentId.value = row.departmentId ?? "";
  roles.value = row.proposedRoles?.length ? row.proposedRoles.map((role) => ({ roleKey: role.roleKey, projectId: role.projectId ?? "" })) : [{ roleKey: "", projectId: "" }];
  identityVerified.value = false; reason.value = ""; password.value = ""; reviewMessage.value = "";
}
function close() { if (busy.value) return; selected.value = null; password.value = ""; }
async function review(decision: EmployeeReview["decision"]) {
  if (!selected.value || busy.value) return;
  if (!password.value || (decision === "return" && !reason.value.trim())) { reviewMessage.value = decision === "return" ? "请填写退回原因和本人当前密码" : "请输入本人当前密码"; return; }
  if (decision !== "return" && (!departmentId.value || roles.value.some((role) => !role.roleKey || (requiresProject(role) && !role.projectId)))) { reviewMessage.value = "请安排部门、岗位及对应项目"; return; }
  busy.value = true;
  try {
    await reviewWithCapability(selected.value.id, { revision: selected.value.revision, decision,
      ...(decision !== "return" ? { departmentId: departmentId.value, roles: roles.value.map((role) => ({ roleKey: role.roleKey as RoleKey, ...(requiresProject(role) ? { projectId: role.projectId } : {}) })), identityVerified: identityVerified.value } : {}),
      reason: reason.value.trim(), confirmationPassword: password.value });
    selected.value = null; reviewMessage.value = ""; await load(); emit("approved");
  } catch (error) { reviewMessage.value = formatUnknownApiError(error, "审核未完成，请刷新申请后重试"); } finally { busy.value = false; password.value = ""; }
}
async function reviewWithCapability(id: string, input: EmployeeReview) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canReviewApplications;
  if (!operationAllowed) throw new Error("当前账号没有入职审核权限");
  return reviewEmployeeApplication(id, input);
}
</script>
<style scoped>
.applications-content { display: grid; gap: var(--jg-space-md); min-width: 0; }
.application-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--jg-space-sm); }
.role-row { padding: var(--jg-space-sm); border: var(--jg-border-width-base) solid var(--jg-border); border-radius: var(--jg-radius-md); }
h2 { font-size: var(--jg-font-size-title, 18px); overflow-wrap: anywhere; }
</style>
