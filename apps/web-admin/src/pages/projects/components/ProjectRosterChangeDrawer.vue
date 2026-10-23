<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { PROJECT_ROSTER_ENTRY_DEFINITION, type BusinessEntryDraftPayload } from "@jiangkong/shared-domain";
import { useAuthStore } from "../../../auth/auth.store";
import { clearPendingPersonnel, loadPendingRoster, savePendingRoster, type PendingRosterChange } from "../../organization/personnel-pending";
import { previewRosterWithCapability, applyRosterWithCapability } from "../../organization/personnel-authorized-actions";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { formatUnknownApiError } from "../../../api/error-message";
import { OrganizationApiError, fetchPersonnelResult,
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
const emit = defineEmits<{ close: []; saved: []; refresh: []; pending: [pending: boolean] }>();
const auth = useAuthStore();
const restored = loadPendingRoster(auth.user?.id ?? "");
const phase = ref<"idle" | "reading" | "submitting">("idle");
const busy = computed(() => phase.value !== "idle");
const message = ref(restored ? "调整结果尚未确认，请沿原办理编号核对结果，暂不要重复提交。" : "");
const password = ref("");
const preview = ref<ProjectRosterChangePreview | null>(null);
const uncertainChange = ref<PendingRosterChange | null>(restored);
const commandKey = ref("");
const recovering = ref(false);
const verificationMessage = ref("");
let generation = 0;
let readController: AbortController | undefined;
const draft = ref<BusinessEntryDraftPayload>(restored ? { ...emptyDraft(), values: { userId: restored.userId, reason: restored.reason } } : emptyDraft());
watch(() => Boolean(uncertainChange.value), (pending) => emit("pending", pending), { immediate: true });
const activeOperation = computed(() => uncertainChange.value?.operation ?? props.operation);
const definition = computed(() => ({ ...PROJECT_ROSTER_ENTRY_DEFINITION,
  fields: PROJECT_ROSTER_ENTRY_DEFINITION.fields.filter((field) => activeOperation.value === "join" || field.key !== "userId")
}));
const options = computed(() => ({ userId: props.users.filter((user) => user.canManage)
  .map((user) => ({ value: user.id, label: `${user.name} · ${user.phone ?? "未登记电话"}` })) }));
const personName = computed(() => uncertainChange.value?.personName ?? props.users.find((user) => user.id === props.userId)?.name ?? "所选人员");
const actionLabel = computed(() => (uncertainChange.value?.operation ?? props.operation) === "join" ? "调入项目" : "调出项目");

function emptyDraft(): BusinessEntryDraftPayload {
  return { sceneKey: PROJECT_ROSTER_ENTRY_DEFINITION.key,
    definitionVersion: PROJECT_ROSTER_ENTRY_DEFINITION.version, values: { userId: "", reason: "" } };
}
watch(() => props.visible, () => {
  invalidateRead();
  phase.value = "idle";
  if (uncertainChange.value) return;
  draft.value = emptyDraft(); preview.value = null; password.value = ""; message.value = "";
  commandKey.value = ""; verificationMessage.value = "";
});
watch(() => JSON.stringify(draft.value.values), () => { preview.value = null; password.value = ""; });
onBeforeUnmount(invalidateRead);

function invalidateRead() {
  generation += 1;
  readController?.abort();
  readController = undefined;
  if (phase.value === "reading") phase.value = "idle";
}

function requestClose() {
  if (phase.value === "submitting") return;
  invalidateRead();
  password.value = "";
  emit("close");
}

async function readWithDeadline<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  readController = controller;
  let timeout: ReturnType<typeof setTimeout>;
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    timeout = setTimeout(() => controller.abort(new Error("读取超时，请重试；尚未提交人员调整")), 15_000);
  });
  try { return await Promise.race([read(controller.signal), cancelled]); }
  finally {
    clearTimeout(timeout!);
    if (readController === controller) readController = undefined;
  }
}

async function previewChange() {
  if (busy.value || uncertainChange.value) return;
  const reason = String(draft.value.values.reason ?? "").trim();
  const userId = props.operation === "leave" ? props.userId : String(draft.value.values.userId ?? "");
  if (!userId || !reason) { message.value = "请选择人员并填写调整原因"; return; }
  const change: ProjectRosterChange = { operation: props.operation, projectId: props.projectId, userId, reason };
  commandKey.value = crypto.randomUUID();
  const current = ++generation;
  phase.value = "reading"; message.value = ""; preview.value = null; password.value = "";
  try {
    const result = await readWithDeadline((signal) => previewRosterWithCapability(change, signal));
    if (current === generation && props.visible) preview.value = result;
  } catch (error) {
    if (current === generation) message.value = formatUnknownApiError(error, "预览人员调整失败");
  } finally { if (current === generation) phase.value = "idle"; }
}

async function submitChange() {
  if (!preview.value?.canApply || !password.value || busy.value || (uncertainChange.value && !recovering.value)) return;
  const { operation, projectId, userId, reason } = uncertainChange.value ?? preview.value;
  const snapshotHash = preview.value.snapshotHash;
  const confirmationPassword = password.value;
  const actorId = auth.user?.id ?? "";
  const wasUncertain = Boolean(uncertainChange.value);
  const pending: PendingRosterChange = uncertainChange.value ?? { operation, projectId, userId, reason, commandKey: commandKey.value, projectName: props.projectName, personName: preview.value.personName };
  const current = ++generation;
  const requestState = { phase, submitted: false };
  phase.value = "reading"; message.value = "";
  try {
    savePendingRoster(actorId, pending);
    const result = await readWithDeadline((signal) => applyRosterWithCapability({ operation, projectId, userId, reason, snapshotHash, confirmationPassword, commandKey: pending.commandKey }, signal, requestState));
    if (result.commandKey !== pending.commandKey || result.userId !== userId || result.operation !== operation || result.projectId !== projectId) throw new Error("办理回执与本次调整不一致，请核对原办理结果");
    clearPendingPersonnel(actorId, "roster");
    if (current !== generation || !props.visible) return;
    uncertainChange.value = null; recovering.value = false;
    emit("saved");
  } catch (error) {
    if (current !== generation) return;
    if (wasUncertain || (requestState.submitted && !(error instanceof OrganizationApiError && error.status >= 400 && error.status < 500 && error.status !== 408))) {
      uncertainChange.value = pending;
      message.value = "调整结果尚未确认，可能已办理。请核对办理结果，暂不要重复提交。";
    } else {
      if (requestState.submitted) clearPendingPersonnel(actorId, "roster");
      message.value = formatUnknownApiError(error, requestState.submitted ? "人员调整未完成，请重新预览" : "读取维护权限失败，尚未提交人员调整");
    }
    if (requestState.submitted || wasUncertain) { preview.value = null; recovering.value = false; }
  } finally {
    if (!requestState.submitted && !wasUncertain) clearPendingPersonnel(actorId, "roster");
    password.value = "";
    if (current === generation) phase.value = "idle";
  }
}

async function verifyLatestRoster() {
  if (!uncertainChange.value || busy.value) return;
  const change = uncertainChange.value;
  const current = ++generation;
  phase.value = "reading"; verificationMessage.value = "";
  try {
    const result = await readWithDeadline(() => fetchPersonnelResult(change.commandKey));
    if (current !== generation || !props.visible) return;
    if ("found" in result) { verificationMessage.value = result.message; return; }
    if (result.commandKey !== change.commandKey || result.userId !== change.userId || result.action !== `project_${change.operation}`) {
      throw new Error("办理回执与本次调整不一致，请继续核对，勿重复提交");
    }
    clearPendingPersonnel(auth.user?.id ?? "", "roster");
    uncertainChange.value = null;
    emit("saved");
  } catch (error) {
    if (current === generation) verificationMessage.value = formatUnknownApiError(error, "核对名单失败，请稍后再查；请勿重复提交");
  } finally { if (current === generation) phase.value = "idle"; }
}
async function repreviewPending() {
  if (!uncertainChange.value || busy.value) return;
  const pending = uncertainChange.value; const current = ++generation;
  phase.value = "reading"; password.value = ""; preview.value = null; recovering.value = false;
  try {
    const result = await readWithDeadline(() => fetchPersonnelResult(pending.commandKey));
    if (current !== generation || !props.visible) return;
    if (!("found" in result)) {
      if (result.commandKey !== pending.commandKey || result.userId !== pending.userId || result.action !== `project_${pending.operation}`) throw new Error("回执内容待核对，请勿重发");
      clearPendingPersonnel(auth.user?.id ?? "", "roster"); uncertainChange.value = null; emit("saved"); return;
    }
    verificationMessage.value = `${result.message}；以下仅重新预览原内容，确认前不会再次提交。`;
    const { operation, projectId, userId, reason } = pending;
    const next = await readWithDeadline((signal) => previewRosterWithCapability({ operation, projectId, userId, reason }, signal));
    if (current !== generation || !props.visible) return;
    commandKey.value = pending.commandKey; preview.value = next; recovering.value = true;
  } catch (error) { if (current === generation) verificationMessage.value = formatUnknownApiError(error, "原办理仍待核实，请稍后再查"); }
  finally { if (current === generation) phase.value = "idle"; }
}

</script>

<template>
  <t-drawer
    :visible="visible"
    :header="actionLabel"
    size="min(760px, 100vw)"
    :footer="false"
    destroy-on-close
    :close-btn="phase !== 'submitting'"
    :close-on-overlay-click="false"
    :close-on-esc-keydown="phase !== 'submitting'"
    @close="requestClose"
  >
    <div class="roster-change">
      <t-alert
        theme="info"
        :title="`当前项目：${uncertainChange?.projectName ?? projectName}`"
      />
      <p v-if="activeOperation === 'join'">
        调入后成为该项目成员。需要办理或审批业务的岗位，请在员工管理中另行设置。
      </p>
      <p v-else>
        将{{ personName }}调出此项目，同时撤销其在此项目的岗位。账号、其他项目任职和历史记录保留。
      </p>
      <BusinessEntryForm
        v-model="draft"
        :definition="definition"
        :readonly="busy || Boolean(uncertainChange)"
        :options-by-field="options"
      />
      <t-button
        :loading="busy"
        :disabled="Boolean(uncertainChange)"
        @click="previewChange"
      >
        预览调整
      </t-button>
      <t-alert
        v-if="phase === 'reading'"
        theme="info"
        title="正在读取，可取消等待；尚未提交新的人员调整。"
      />
      <t-alert
        v-if="phase === 'submitting'"
        theme="info"
        title="正在提交人员调整，请等待结果。关闭页面不代表撤销已发出的调整。"
      />
      <t-alert
        v-if="message"
        :theme="uncertainChange ? 'warning' : 'error'"
        :title="message"
      />
      <template v-if="uncertainChange">
        <t-button
          :loading="busy"
          @click="verifyLatestRoster"
        >
          核对办理结果
        </t-button>
        <t-button
          :disabled="busy"
          variant="outline"
          @click="repreviewPending"
        >
          按原内容重新预览
        </t-button>
        <t-alert
          v-if="verificationMessage"
          theme="info"
          :title="verificationMessage"
        />
      </template>
      <template v-if="preview">
        <t-alert
          :theme="preview.canApply ? 'info' : 'warning'"
          :title="`${preview.personName}：${actionLabel} · ${preview.projectName}`"
        />
        <p v-if="activeOperation === 'leave'">
          将撤销的项目岗位：{{ preview.projectRoleNames.join('、') || '无项目岗位' }}；涉及审批：{{ preview.affectedApprovals }} 项。
        </p>
        <t-alert
          v-if="activeOperation === 'leave' && preview.retainsGlobalAccess"
          theme="warning"
          title="该人员仍保留公司岗位职责，其公司岗位赋予的跨项目查看权限不会随本次调出撤销。"
        />
        <t-alert
          v-for="reason in preview.blockingReasons"
          :key="reason"
          theme="error"
          :title="reason"
        />
        <template v-if="preview.canApply">
          <label class="password-field">
            <span>本人当前登录密码</span>
            <t-input
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入本人当前登录密码"
              :disabled="busy"
            />
          </label>
          <t-button
            theme="primary"
            :loading="busy"
            :disabled="!password"
            @click="submitChange"
          >
            确认{{ actionLabel }}
          </t-button>
        </template>
      </template>
      <t-button
        variant="outline"
        :disabled="phase === 'submitting'"
        @click="requestClose"
      >
        取消
      </t-button>
    </div>
  </t-drawer>
</template>

<style scoped>
.roster-change, .password-field { display: grid; gap: var(--jg-space-md); min-width: 0; }
.roster-change p { margin: 0; line-height: 1.6; color: var(--jg-text-secondary); }
</style>
