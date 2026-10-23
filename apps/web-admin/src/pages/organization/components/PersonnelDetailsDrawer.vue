<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { BusinessEntryDraftPayload, RoleKey } from "@jiangkong/shared-domain";
import { ORGANIZATION_ROLE_ENTRY_DEFINITION } from "@jiangkong/shared-domain";
import { useAuthStore } from "../../../auth/auth.store";
import { fetchActiveCompanyEntities, type CompanyEntityModel } from "../../../api/company-entity.api";
import { clearPendingPersonnel, loadPendingPersonnel, savePendingPersonnel } from "../personnel-pending";
import { previewPersonnelWithCapability, applyPersonnelWithCapability } from "../personnel-authorized-actions";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { formatUnknownApiError } from "../../../api/error-message";
import { OrganizationApiError, fetchEmploymentHistory,
  fetchPersonnelResult, type EmploymentHistory, type OrganizationDirectory,
  type OrganizationDirectoryUser, type OrganizationManagementCapabilities, type PersonnelCommand, type PersonnelPreview } from "../../../api/organization.api";
import { activeOrganizationProjectOptions, flattenDepartmentTree, organizationRoleAdditionOptions } from "../organization.config";

const props = defineProps<{ visible: boolean; user: OrganizationDirectoryUser; directory: OrganizationDirectory; capabilities: OrganizationManagementCapabilities }>();
const emit = defineEmits<{ close: []; saved: []; pending: [pending: boolean] }>();
type Action = PersonnelCommand["action"];
type RoleRow = { operation: "add" | "remove"; scope: "global" | "project"; projectId: string; roleKey: RoleKey | "" };
const auth = useAuthStore();
const restored = loadPendingPersonnel(auth.user?.id ?? "");
const history = ref<EmploymentHistory | null>(null);
const companies = ref<CompanyEntityModel[]>([]);
const companyEntityId = ref("");
const companyMessage = ref("");
const companiesLoading = ref(false);
let companyGeneration = 0;
let companyController: AbortController | undefined;
const companyOptions = computed(() => companies.value.filter((row) => row.isActive).map((row) => ({ value: row.id, label: row.name })));
function companyName(id: string | null) { return id ? companies.value.find((row) => row.id === id)?.name ?? "已记录公司（名称暂不可用）" : "用工公司待核实"; }
const phase = ref<"idle" | "reading" | "submitting">("idle");
const busy = computed(() => phase.value !== "idle");
const action = ref<Action | "">(restored?.userId === props.user.id ? restored.action : "");
const reason = ref(restored?.userId === props.user.id ? restored.reason : ""); const departmentId = ref(""); const startedOn = ref(""); const password = ref("");
const roleRows = ref<RoleRow[]>([]); const rosterRows = ref<Array<{ operation: "join" | "leave"; projectId: string }>>([]);
const preview = ref<PersonnelPreview | null>(null); const command = ref<PersonnelCommand | null>(restored?.userId === props.user.id ? restored : null);
const recovering = ref(false);
const uncertain = ref(Boolean(command.value)); const message = ref(command.value ? "办理结果尚未确认，请沿原编号核对，暂不要重复提交。" : "");
if (uncertain.value) emit("pending", true); const verificationMessage = ref("");
let generation = 0; let readController: AbortController | undefined;
const currentPeriod = computed(() => history.value?.periods.find((period) => period.endedAt === null));
const ended = computed(() => Boolean(history.value?.periods.length && !currentPeriod.value));
const statusLabel = computed(() => uncertain.value ? "办理结果待核实" : !history.value ? "正在核对任职履历" : ended.value ? "已离职"
  : currentPeriod.value ? (currentPeriod.value.verified ? "在职" : "在职 · 入职资料待核实") : "任职状态待核实");
const canVerify = computed(() => history.value && !ended.value && props.user.status === "active"
  && (!currentPeriod.value || (!currentPeriod.value.verified && !currentPeriod.value.startedOn)));
const canOffboard = computed(() => history.value && !ended.value);
const canAdjust = computed(() => history.value && !ended.value && props.user.status === "active");
const locked = computed(() => busy.value || uncertain.value);
const departmentOptions = computed(() => flattenDepartmentTree(props.directory.departments)
  .filter((row) => row.isActive && props.capabilities.manageableDepartmentIds.includes(row.id)).map((row) => ({ value: row.id, label: row.path })));
const projectOptions = computed(() => activeOrganizationProjectOptions(props.directory.projects));
const positions = computed(() => props.directory.positions.filter((row) => row.key !== "super_admin" && props.capabilities.manageableRoleKeys.includes(row.key)));
const actionLabels: Record<string, string> = { join: "核实入职", adjust: "调动", offboard: "办理离职", rehire: "返聘", create: "创建账号", onboarding: "审核入职", project_join: "调入项目", project_leave: "调出项目" };
const lockedArrangement = computed(() => {
  const payload = command.value;
  if (!payload) return [];
  const selectedDepartment = flattenDepartmentTree(props.directory.departments).find((row) => row.id === payload.departmentId);
  const lines = [
    `办理事项：${actionLabels[payload.action]}`,
    `办理原因：${payload.reason}`,
    `安排部门：${payload.departmentId ? selectedDepartment?.path ?? "已选部门（名称暂不可用，原选择保留）" : "本次不调整，保留原值"}`,
    `核实入职日期：${payload.startedOn || (["join", "rehire"].includes(payload.action) ? "未核实，保留未知" : "本次不调整")}`,
    `用工公司：${payload.companyEntityId ? companyName(payload.companyEntityId) : payload.action === "rehire" ? "未核实，保留未知"
      : payload.action === "join" ? "本次未指定；已有公司保留，未记录时保留未知" : "本次不调整"}`
  ];
  const projectName = (id?: string | null) => props.directory.projects.find((row) => row.id === id)?.name ?? "已选项目（名称暂不可用，原选择保留）";
  for (const [label, targets] of [["新增岗位", payload.additions ?? []], ["撤销岗位", payload.removals ?? []]] as const) {
    for (const target of targets) {
      const name = props.directory.positions.find((row) => row.key === target.roleKey)?.name ?? "已选岗位（名称暂不可用，原选择保留）";
      lines.push(`${label}：${target.scope === "project" ? `${projectName(target.projectId)} · ${name}（项目岗位）` : `${name}（公司岗位，适用全部项目）`}`);
    }
  }
  for (const row of payload.rosterChanges ?? []) lines.push(`${row.operation === "join" ? "调入" : "调出"}项目：${projectName(row.projectId)}`);
  if (payload.action === "offboard") lines.push("离职安排：核对交接后撤销当前业务岗位和项目归属，并停用账号；不删除历史记录。");
  else {
    if (!payload.additions?.length && !payload.removals?.length) lines.push("岗位安排：本次未安排新增或撤销岗位");
    if (!payload.rosterChanges?.length) lines.push("项目归属：本次未安排调入或调出项目");
  }
  return lines;
});


function invalidateRead() { companyGeneration += 1; companyController?.abort(); companyController = undefined; companiesLoading.value = false; generation += 1; readController?.abort(); readController = undefined; if (phase.value === "reading") phase.value = "idle"; }
onBeforeUnmount(invalidateRead);
watch(() => [props.visible, props.user.id] as const, () => {
  invalidateRead();
  if (!props.visible) return;
  if (uncertain.value) { void loadCompanyOptions(); return; }
  history.value = null; action.value = ""; reason.value = ""; departmentId.value = ""; startedOn.value = "";
  roleRows.value = []; rosterRows.value = []; preview.value = null; command.value = null; message.value = ""; verificationMessage.value = "";
  void loadHistory();
}, { immediate: true });
watch(() => JSON.stringify({ action: action.value, reason: reason.value, departmentId: departmentId.value,
  startedOn: startedOn.value, companyEntityId: companyEntityId.value, roles: roleRows.value, roster: rosterRows.value }), () => {
  if (!uncertain.value) { preview.value = null; command.value = null; password.value = ""; }
});

async function read<T>(fn: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController(); readController = controller;
  let timer: ReturnType<typeof setTimeout>;
  const cancellation = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    timer = setTimeout(() => controller.abort(new Error("读取超时，请稍后重试；尚未提交新的办理")), 15_000);
  });
  try { return await Promise.race([fn(controller.signal), cancellation]); }
  finally { clearTimeout(timer!); if (readController === controller) readController = undefined; }
}
async function loadHistory() {
  const current = ++generation; phase.value = "reading";
  void loadCompanyOptions();
  try {
    const result = await read(() => fetchEmploymentHistory(props.user.id));
    if (current === generation && props.visible) history.value = result;
  } catch (error) { if (current === generation) message.value = formatUnknownApiError(error, "任职履历读取失败，请重试"); }
  finally { if (current === generation) phase.value = "idle"; }
}
async function loadCompanyOptions() {
  const current = ++companyGeneration;
  companyController?.abort();
  const controller = new AbortController(); companyController = controller;
  companiesLoading.value = true; companyMessage.value = "";
  let timer: ReturnType<typeof setTimeout>;
  const cancellation = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    timer = setTimeout(() => controller.abort(new Error("用工公司选项读取超时")), 15_000);
  });
  try {
    const result = await Promise.race([fetchActiveCompanyEntities(), cancellation]);
    if (current === companyGeneration && props.visible) companies.value = result;
  } catch {
    if (current === companyGeneration && props.visible) companyMessage.value = "用工公司选项读取失败，可稍后重读；未选择公司仍保留未知。";
  } finally {
    clearTimeout(timer!);
    if (current === companyGeneration) companiesLoading.value = false;
    if (companyController === controller) companyController = undefined;
  }
}

function chooseAction(next: Action) {
  if (locked.value) return;
  action.value = next; departmentId.value = ""; startedOn.value = ""; companyEntityId.value = ""; roleRows.value = []; rosterRows.value = []; message.value = "";
}
function close() { if (phase.value === "submitting") return; invalidateRead(); password.value = ""; emit("close"); }
function roleDefinition(row: RoleRow) { return { ...ORGANIZATION_ROLE_ENTRY_DEFINITION,
  fields: ORGANIZATION_ROLE_ENTRY_DEFINITION.fields.filter((field) => field.key !== "operation" && (row.scope === "project" || field.key !== "projectId")) }; }
function roleDraft(row: RoleRow): BusinessEntryDraftPayload { return { sceneKey: ORGANIZATION_ROLE_ENTRY_DEFINITION.key, values: { ...row } }; }
function changeRole(index: number, draft: BusinessEntryDraftPayload) {
  const old = roleRows.value[index]; if (!old) return;
  const scope = draft.values.scope === "project" ? "project" : "global";
  const projectId = scope === "project" ? String(draft.values.projectId ?? "") : "";
  const roleKey = String(draft.values.roleKey ?? "") as RoleKey | "";
  roleRows.value[index] = { operation: old.operation, scope, projectId, roleKey: old.scope === scope && old.projectId === projectId ? roleKey : "" };
}
function roleOptions(row: RoleRow) {
  if (row.operation === "add") return organizationRoleAdditionOptions(props.user, row.scope, row.projectId, positions.value);
  const existing = row.scope === "global" ? props.user.globalPositions : props.user.projectPositions
    .filter((project) => project.projectId === row.projectId).flatMap((project) => project.keys.map((key, index) => ({ key, name: project.names[index] ?? key })));
  return existing.filter((role) => positions.value.some((position) => position.key === role.key)).map((role) => ({ value: role.key, label: role.name }));
}
function buildCommand(): PersonnelCommand {
  if (!action.value || !reason.value.trim()) throw new Error("请选择办理事项并填写原因");
  if (action.value === "join" && !startedOn.value) throw new Error("请填写已核实的入职日期；尚未核实可暂不办理");
  if (roleRows.value.some((row) => !row.roleKey || (row.scope === "project" && !row.projectId)) || rosterRows.value.some((row) => !row.projectId)) throw new Error("请补全岗位范围、岗位和对应项目");
  const additions: NonNullable<PersonnelCommand["additions"]> = []; const removals: NonNullable<PersonnelCommand["removals"]> = [];
  for (const row of roleRows.value) {
    const target = { userId: props.user.id, scope: row.scope, roleKey: row.roleKey as RoleKey, ...(row.scope === "project" ? { projectId: row.projectId } : {}) };
    if (row.operation === "add") additions.push({ ...target, operation: "add" }); else removals.push({ ...target, operation: "remove" });
  }
  return { commandKey: crypto.randomUUID(), userId: props.user.id, action: action.value, reason: reason.value.trim(),
    ...(departmentId.value ? { departmentId: departmentId.value } : {}), ...(startedOn.value ? { startedOn: startedOn.value } : {}),
    ...(companyEntityId.value && !(action.value === "join" && currentPeriod.value?.companyEntityId) ? { companyEntityId: companyEntityId.value } : {}),
    ...(additions.length ? { additions } : {}), ...(removals.length ? { removals } : {}),
    ...(rosterRows.value.length ? { rosterChanges: rosterRows.value.map((row) => ({ ...row })) } : {}) };
}
async function previewChange() {
  if (locked.value) return;
  let payload: PersonnelCommand;
  try { payload = buildCommand(); } catch (error) { message.value = formatUnknownApiError(error, "请补全办理内容"); return; }
  const current = ++generation; phase.value = "reading"; message.value = ""; preview.value = null; password.value = "";
  try {
    const result = await read((signal) => previewPersonnelWithCapability(payload, signal));
    if (current !== generation || !props.visible) return;
    if (result) { command.value = payload; preview.value = result; }
  } catch (error) { if (current === generation) message.value = formatUnknownApiError(error, "预览未完成，请重试"); }
  finally { if (current === generation) phase.value = "idle"; }
}
async function applyChange() {
  if (!command.value || !preview.value?.canApply || !password.value || busy.value || (uncertain.value && !recovering.value)) return;
  const payload = command.value; const snapshotHash = preview.value.snapshotHash; const confirmationPassword = password.value;
  const current = ++generation; phase.value = "reading"; message.value = "";
  const requestState = { phase, submitted: false };
  const actorId = auth.user?.id ?? "";
  const wasUncertain = uncertain.value;
  try {
    savePendingPersonnel(actorId, payload);
    const result = await read((signal) => applyPersonnelWithCapability({ ...payload, snapshotHash, confirmationPassword }, signal, requestState));
    if (result.commandKey !== payload.commandKey || result.userId !== payload.userId || result.action !== payload.action) throw new Error("办理回执内容待核实");
    if (current === generation) finish();
  } catch (error) {
    if (current !== generation) return;
    if (wasUncertain || (requestState.submitted && !(error instanceof OrganizationApiError && error.status >= 400 && error.status < 500 && error.status !== 408))) {
      uncertain.value = true; emit("pending", true); message.value = "办理结果尚未确认，可能已保存。请沿本次办理核对结果，暂不要重复提交。";
    } else { if (requestState.submitted) clearPendingPersonnel(actorId, "personnel"); message.value = formatUnknownApiError(error, "办理未完成，请重新预览"); command.value = null; }
    preview.value = null; recovering.value = false;
  } finally { if (!requestState.submitted && !wasUncertain) clearPendingPersonnel(actorId, "personnel"); password.value = ""; if (current === generation) phase.value = "idle"; }
}
function finish() { recovering.value = false; clearPendingPersonnel(auth.user?.id ?? "", "personnel"); uncertain.value = false; emit("pending", false); command.value = null; preview.value = null; phase.value = "idle"; emit("saved"); }
async function verifyResult() {
  if (!command.value || !uncertain.value || busy.value) return;
  const payload = command.value; const current = ++generation; phase.value = "reading"; verificationMessage.value = "";
  try {
    const result = await read(() => fetchPersonnelResult(payload.commandKey));
    if (current !== generation || !props.visible) return;
    if ("found" in result) { verificationMessage.value = result.message; return; }
    if (result.commandKey !== payload.commandKey || result.userId !== payload.userId || result.action !== payload.action) throw new Error("办理回执与本次内容不一致，请继续核对，勿重复提交");
    finish();
  } catch (error) { if (current === generation) verificationMessage.value = formatUnknownApiError(error, "结果仍待核实，请稍后再查"); }
  finally { if (current === generation) phase.value = "idle"; }
}
async function repreviewPending() {
  if (!command.value || !uncertain.value || busy.value) return;
  const payload = command.value; const current = ++generation;
  phase.value = "reading"; password.value = ""; preview.value = null; recovering.value = false;
  try {
    const result = await read(() => fetchPersonnelResult(payload.commandKey));
    if (current !== generation || !props.visible) return;
    if (!("found" in result)) {
      if (result.commandKey !== payload.commandKey || result.userId !== payload.userId || result.action !== payload.action) throw new Error("回执内容待核对，请勿重发");
      finish(); return;
    }
    verificationMessage.value = `${result.message}；以下仅重新预览原内容，确认前不会再次提交。`;
    const next = await read((signal) => previewPersonnelWithCapability(payload, signal));
    if (current !== generation || !props.visible) return;
    preview.value = next; recovering.value = true;
  } catch (error) { if (current === generation) verificationMessage.value = formatUnknownApiError(error, "原办理仍待核实，请稍后再查"); }
  finally { if (current === generation) phase.value = "idle"; }
}

</script>

<template>
  <t-drawer
    :visible="visible"
    header="员工详情"
    size="min(760px, 100vw)"
    :footer="false"
    destroy-on-close
    :close-btn="phase !== 'submitting'"
    :close-on-esc-keydown="phase !== 'submitting'"
    :close-on-overlay-click="false"
    @close="close"
  >
    <div class="personnel-details">
      <h2>{{ user.name }} · {{ user.phone }}</h2>
      <t-alert
        theme="info"
        :title="statusLabel"
      />
      <t-alert
        v-if="companiesLoading"
        theme="info"
        title="正在读取用工公司选项，可保留未知并继续办理。"
      />
      <t-alert
        v-if="companyMessage"
        theme="warning"
        :title="companyMessage"
      />
      <p>账号{{ user.status === 'active' ? '启用' : '停用' }}；{{ user.departmentName }}。账号启停与任职履历分别记录。</p>
      <p v-if="ended">
        再次入职请办理返聘，沿用原员工账号和历史记录，不恢复旧岗位。
      </p>
      <t-button
        v-if="!history"
        variant="outline"
        :loading="busy"
        @click="loadHistory"
      >
        重读任职履历
      </t-button>
      <div class="actions">
        <t-button
          v-if="canVerify"
          :disabled="locked"
          variant="outline"
          @click="chooseAction('join')"
        >
          核实入职
        </t-button>
        <t-button
          v-if="canAdjust"
          :disabled="locked"
          variant="outline"
          @click="chooseAction('adjust')"
        >
          调动
        </t-button>
        <t-button
          v-if="canOffboard"
          :disabled="locked"
          variant="outline"
          theme="danger"
          @click="chooseAction('offboard')"
        >
          办理离职
        </t-button>
        <t-button
          v-if="ended"
          :disabled="locked"
          variant="outline"
          @click="chooseAction('rehire')"
        >
          返聘
        </t-button>
      </div>
      <template v-if="action && !uncertain">
        <h3>{{ actionLabels[action] }}</h3>
        <t-alert
          v-if="action === 'offboard'"
          theme="warning"
          title="离职将核对审批交接、撤销业务岗位和项目归属，并停用账号。服务端发现阻断时不会保存。"
        />
        <template v-else>
          <label>本次安排部门（未选择则保留原值）<t-select
            v-model="departmentId"
            :options="departmentOptions"
            :disabled="locked"
            clearable
          /></label>
          <label v-if="action !== 'adjust'">核实入职日期<t-input
            v-model="startedOn"
            placeholder="YYYY-MM-DD"
            :disabled="locked"
          /></label>
          <template v-if="action !== 'adjust'">
            <p v-if="action === 'join' && currentPeriod?.companyEntityId">
              用工公司：{{ companyName(currentPeriod.companyEntityId) }}；本次核实日期保留原公司。
            </p>
            <label v-else>用工公司（选填，未选择保留未知）<t-select
              v-model="companyEntityId"
              data-field="companyEntityId"
              :options="companyOptions"
              :disabled="locked || companiesLoading"
              clearable
              placeholder="请选择已核实的用工公司"
            /></label>
            <p>返聘的岗位和项目须重新安排。</p>
          </template>
          <div
            v-for="(row, index) in roleRows"
            :key="index"
            class="arrangement"
          >
            <label>岗位操作<t-select
              v-model="row.operation"
              :disabled="locked"
              :options="[{ value: 'add', label: '新增岗位' }, { value: 'remove', label: '撤销岗位' }]"
              @change="row.roleKey = ''"
            /></label>
            <BusinessEntryForm
              :model-value="roleDraft(row)"
              :definition="roleDefinition(row)"
              :readonly="locked"
              :options-by-field="{ projectId: projectOptions, roleKey: roleOptions(row) }"
              @update:model-value="changeRole(index, $event)"
            />
            <t-button
              variant="text"
              :disabled="locked"
              @click="roleRows.splice(index, 1)"
            >
              移除此项岗位
            </t-button>
          </div>
          <t-button
            variant="outline"
            :disabled="locked || roleRows.length >= 20"
            @click="roleRows.push({ operation: 'add', scope: 'project', projectId: '', roleKey: '' })"
          >
            安排岗位调整
          </t-button>
          <div
            v-for="(row, index) in rosterRows"
            :key="index"
            class="arrangement"
          >
            <label>项目人员调整<t-select
              v-model="row.operation"
              :disabled="locked"
              :options="[{ value: 'join', label: '调入项目' }, { value: 'leave', label: '调出项目' }]"
            /></label>
            <label>项目<t-select
              v-model="row.projectId"
              :disabled="locked"
              :options="projectOptions"
            /></label>
            <t-button
              variant="text"
              :disabled="locked"
              @click="rosterRows.splice(index, 1)"
            >
              移除此项项目
            </t-button>
          </div>
          <t-button
            variant="outline"
            :disabled="locked || rosterRows.length >= 20"
            @click="rosterRows.push({ operation: 'join', projectId: '' })"
          >
            安排项目调整
          </t-button>
        </template>
        <label>办理原因<t-textarea
          v-model="reason"
          :maxlength="500"
          :disabled="locked"
        /></label>
        <t-button
          theme="primary"
          :loading="phase === 'reading'"
          :disabled="locked"
          @click="previewChange"
        >
          预览办理影响
        </t-button>
      </template>
      <t-alert
        v-if="phase === 'reading'"
        theme="info"
        title="正在读取，可关闭并取消等待；尚未提交新的办理。"
      />
      <t-alert
        v-if="phase === 'submitting'"
        theme="info"
        title="正在提交，请等待结果。关闭页面不代表撤销已发出的办理。"
      />
      <t-alert
        v-if="message"
        :theme="uncertain ? 'warning' : 'error'"
        :title="message"
      />
      <section
        v-if="uncertain && command"
        class="arrangement"
        aria-label="原办理安排（已锁定）"
      >
        <h3>原办理安排（已锁定）</h3>
        <p>以下为原办理的全部安排。重新预览和确认沿用原内容，不会按空白表单重新生成。</p>
        <p
          v-for="(line, index) in lockedArrangement"
          :key="index"
        >
          {{ line }}
        </p>
      </section>
      <template v-if="preview">
        <t-alert
          :theme="preview.canApply ? 'success' : 'warning'"
          :title="`${preview.personName} · ${actionLabels[preview.action]}：${preview.canApply ? '可办理' : '暂不可办理'}`"
        />
        <t-alert
          v-for="blocker in preview.blockingReasons"
          :key="blocker"
          theme="error"
          :title="blocker"
        />
        <template v-if="preview.canApply">
          <label>本人当前登录密码<t-input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入本人当前登录密码"
            :disabled="busy"
          /></label>
          <t-button
            theme="primary"
            :disabled="busy || !password"
            :loading="phase === 'submitting'"
            @click="applyChange"
          >
            确认办理
          </t-button>
        </template>
      </template>
      <template v-if="uncertain">
        <p>{{ actionLabels[command?.action ?? ''] }} · {{ command?.reason }}</p>
        <t-button
          :loading="busy"
          @click="verifyResult"
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
      <section
        v-if="history"
        class="history"
      >
        <h3>任职履历</h3>
        <p v-if="!history.periods.length">
          未核实任职日期或用工公司，保留未知。
        </p>
        <p
          v-for="period in history.periods"
          :key="period.id"
        >
          入职：{{ period.startedOn?.slice(0, 10) || '日期待核实' }}；{{ period.endedAt ? `离职：${period.endedOn?.slice(0, 10) || '日期待核实'}` : '当前任职' }}；{{ companyName(period.companyEntityId) }}；{{ period.verified ? '已核实' : '资料待核实' }}
        </p>
        <h3>办理记录</h3>
        <p v-if="!history.changes.length">
          暂无已记录的人事办理
        </p>
        <p
          v-for="change in history.changes"
          :key="change.id"
        >
          {{ actionLabels[change.action] || '人员调整' }} · {{ change.createdAt.slice(0, 10) }} · {{ change.reason }}
        </p>
      </section>
      <t-button
        variant="outline"
        :disabled="phase === 'submitting'"
        @click="close"
      >
        {{ uncertain ? '关闭并保留待核实办理' : '关闭' }}
      </t-button>
    </div>
  </t-drawer>
</template>

<style scoped>
.personnel-details, .personnel-details label, .arrangement, .history { display: grid; min-width: 0; gap: var(--jg-space-md); }
.actions { display: flex; gap: var(--jg-space-sm); flex-wrap: wrap; }
.arrangement { padding: var(--jg-space-md); border: var(--jg-border-width-base) solid var(--jg-border); border-radius: var(--jg-radius-md); }
h2, h3, p { margin: 0; overflow-wrap: anywhere; }
p { color: var(--jg-text-secondary); line-height: 1.6; }
</style>
