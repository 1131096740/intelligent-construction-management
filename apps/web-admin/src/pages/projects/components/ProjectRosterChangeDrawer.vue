<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PROJECT_ROSTER_ENTRY_DEFINITION, type BusinessEntryDraftPayload } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { formatUnknownApiError } from "../../../api/error-message";
import { applyProjectRosterChange, previewProjectRosterChange, fetchProjectRosterManagementOptions,
  type ProjectRosterChange, type ProjectRosterChangePreview,
  type ProjectRosterManagementOptions } from "../../../api/organization.api";

const props = defineProps<{
  visible: boolean;
  operation: "join" | "leave";
  projectId: string;
  projectName: string;
  userId: string;
  users: ProjectRosterManagementOptions["users"];
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const busy = ref(false);
const message = ref("");
const password = ref("");
const preview = ref<ProjectRosterChangePreview | null>(null);
const draft = ref<BusinessEntryDraftPayload>(emptyDraft());
const definition = computed(() => ({ ...PROJECT_ROSTER_ENTRY_DEFINITION,
  fields: PROJECT_ROSTER_ENTRY_DEFINITION.fields.filter((field) => props.operation === "join" || field.key !== "userId")
}));
const options = computed(() => ({ userId: props.users.filter((user) => user.canManage)
  .map((user) => ({ value: user.id, label: `${user.name} · ${user.phone ?? "未登记电话"}` })) }));
const personName = computed(() => props.users.find((user) => user.id === props.userId)?.name ?? "所选人员");
const actionLabel = computed(() => props.operation === "join" ? "调入项目" : "调出项目");

function emptyDraft(): BusinessEntryDraftPayload {
  return { sceneKey: PROJECT_ROSTER_ENTRY_DEFINITION.key,
    definitionVersion: PROJECT_ROSTER_ENTRY_DEFINITION.version, values: { userId: "", reason: "" } };
}
watch(() => props.visible, () => {
  draft.value = emptyDraft(); preview.value = null; password.value = ""; message.value = "";
});
watch(() => JSON.stringify(draft.value.values), () => { preview.value = null; password.value = ""; });

async function previewChange() {
  const reason = String(draft.value.values.reason ?? "").trim();
  const userId = props.operation === "leave" ? props.userId : String(draft.value.values.userId ?? "");
  if (!userId || !reason) { message.value = "请选择人员并填写调整原因"; return; }
  const change: ProjectRosterChange = { operation: props.operation, projectId: props.projectId, userId, reason };
  busy.value = true; message.value = ""; preview.value = null; password.value = "";
  try { preview.value = await previewWithCapability(change); }
  catch (error) { message.value = formatUnknownApiError(error, "预览人员调整失败"); }
  finally { busy.value = false; }
}

async function submitChange() {
  if (!preview.value?.canApply || !password.value || busy.value) return;
  const { operation, projectId, userId, reason, snapshotHash } = preview.value;
  busy.value = true; message.value = "";
  try {
    await applyWithCapability({ operation, projectId, userId, reason, snapshotHash, confirmationPassword: password.value });
    emit("saved");
  } catch (error) {
    message.value = formatUnknownApiError(error, "保存人员调整失败");
    preview.value = null;
  } finally { password.value = ""; busy.value = false; }
}

async function previewWithCapability(input: ProjectRosterChange) {
  const capability = await fetchProjectRosterManagementOptions();
  const operationAllowed = capability.canManageRoster;
  if (!operationAllowed) throw new Error("当前账号不能调整项目人员");
  return previewProjectRosterChange(input);
}

async function applyWithCapability(input: Parameters<typeof applyProjectRosterChange>[0]) {
  const capability = await fetchProjectRosterManagementOptions();
  const operationAllowed = capability.canManageRoster;
  if (!operationAllowed) throw new Error("当前账号不能调整项目人员");
  return applyProjectRosterChange(input);
}
</script>

<template>
  <t-drawer :visible="visible" :header="actionLabel" size="large" :footer="false" destroy-on-close
    :close-btn="!busy" :close-on-overlay-click="false" :close-on-esc-keydown="false" @close="emit('close')">
    <div class="roster-change">
      <t-alert theme="info" :title="`当前项目：${projectName}`" />
      <p v-if="operation === 'join'">调入后成为该项目成员。需要办理或审批业务的岗位，请在组织权限中另行设置。</p>
      <p v-else>将{{ personName }}调出此项目，同时撤销其在此项目的岗位。账号、其他项目任职和历史记录保留。</p>
      <BusinessEntryForm v-model="draft" :definition="definition" :readonly="busy" :options-by-field="options" />
      <t-button :loading="busy" @click="previewChange">预览调整</t-button>
      <t-alert v-if="message" theme="error" :title="message" />
      <template v-if="preview">
        <t-alert :theme="preview.canApply ? 'info' : 'warning'"
          :title="`${preview.personName}：${actionLabel} · ${preview.projectName}`" />
        <p v-if="operation === 'leave'">将撤销的项目岗位：{{ preview.projectRoleNames.join('、') || '无项目岗位' }}；涉及审批：{{ preview.affectedApprovals }} 项。</p>
        <t-alert v-if="operation === 'leave' && preview.retainsGlobalAccess" theme="warning"
          title="该人员仍保留公司岗位职责，其公司岗位赋予的跨项目查看权限不会随本次调出撤销。" />
        <t-alert v-for="reason in preview.blockingReasons" :key="reason" theme="error" :title="reason" />
        <template v-if="preview.canApply">
          <label class="password-field">
            <span>本人当前登录密码</span>
            <t-input v-model="password" type="password" autocomplete="current-password"
              placeholder="请输入本人当前登录密码" :disabled="busy" />
          </label>
          <t-button theme="primary" :loading="busy" :disabled="!password" @click="submitChange">确认{{ actionLabel }}</t-button>
        </template>
      </template>
      <t-button variant="outline" :disabled="busy" @click="emit('close')">取消</t-button>
    </div>
  </t-drawer>
</template>

<style scoped>
.roster-change, .password-field { display: grid; gap: var(--jg-space-md); min-width: 0; }
.roster-change p { margin: 0; line-height: 1.6; color: var(--jg-text-secondary); }
</style>
