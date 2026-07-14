<template>
  <t-drawer
    :visible="visible"
    header="新增岗位"
    size="large"
    :footer="false"
    :close-btn="!busy"
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    @close="requestClose"
  >
    <div class="addition-drawer">
      <t-alert
        theme="info"
        :title="user ? `当前人员：${user.name}。当前仅支持逐条新增。` : '未读取待新增岗位人员。'"
        :close="false"
      />
      <t-alert
        v-if="user?.status === 'inactive'"
        theme="error"
        title="人员已停用，不能新增岗位。"
        :close="false"
      />
      <t-alert
        v-if="previewMessage"
        theme="error"
        :title="previewMessage"
        :close="false"
      />
      <t-alert
        v-if="previewStale"
        theme="warning"
        title="组织或审批数据已变化，请重新选择并预览后再试。"
        :close="false"
      />

      <section class="addition-section">
        <div class="section-head">
          <div>
            <h3>新增目标</h3>
            <p>项目候选来自治理项目目录，不从该人员已有项目岗位反推。</p>
          </div>
        </div>
        <t-form label-align="top">
          <t-form-item label="岗位范围">
            <t-select
              v-model="scope"
              :disabled="selectionDisabled"
              :options="scopeOptions"
              placeholder="请选择岗位范围"
            />
          </t-form-item>
          <t-form-item
            v-if="scope === 'project'"
            label="所属项目"
          >
            <t-select
              v-model="projectId"
              :disabled="selectionDisabled"
              :options="projectOptions"
              placeholder="请选择启用项目"
            />
          </t-form-item>
          <t-form-item label="待新增岗位">
            <t-select
              v-model="roleKey"
              :disabled="selectionDisabled || (scope === 'project' && !projectId)"
              :options="roleOptions"
              placeholder="请选择待新增岗位"
            />
          </t-form-item>
        </t-form>
        <div class="addition-actions">
          <t-button
            theme="primary"
            :loading="previewing"
            :disabled="selectionDisabled || !roleKey || (scope === 'project' && !projectId)"
            @click="previewTarget"
          >
            预览新增影响
          </t-button>
        </div>
      </section>

      <section
        v-if="preview"
        class="addition-section"
      >
        <div class="section-head">
          <div>
            <h3>影响预览</h3>
            <p>只有当前选择与服务端快照完全一致时，才开放密码确认。</p>
          </div>
        </div>
        <div class="preview-summary">
          <t-tag
            :theme="preview.canApply ? 'success' : 'danger'"
            variant="light"
          >
            {{ preview.canApply ? "服务端判定可新增" : "服务端判定不可新增" }}
          </t-tag>
          <span>受影响节点 {{ preview.summary.affectedNodes }} 项</span>
          <span>阻断节点 {{ preview.summary.blockingNodes }} 项</span>
          <span>预览时间 {{ previewTime }}</span>
        </div>

        <div
          v-if="preview.blockingIssues.length"
          class="blocking-list"
        >
          <t-alert
            v-for="(issue, index) in preview.blockingIssues"
            :key="`${issue.code}:${index}`"
            theme="error"
            :title="issue.message"
            :close="false"
          />
        </div>

        <div class="jg-table-region jg-table-region--wide">
          <t-table
            row-key="key"
            size="small"
            :columns="impactColumns"
            :data="impactRows"
            :horizontal-scroll-affixed-bottom="true"
            empty="未发现当前在途审批影响"
          >
            <template #business="{ row }">
              <div class="stacked-cell">
                <span>{{ row.businessTypeLabel }}</span>
                <span>{{ row.businessId }}</span>
              </div>
            </template>
            <template #resolution="{ row }">
              <div class="stacked-cell">
                <span>新增前：{{ row.beforeText }}</span>
                <span>新增后：{{ row.afterText }}</span>
              </div>
            </template>
            <template #status="{ row }">
              <div class="stacked-cell">
                <t-tag
                  size="small"
                  :theme="row.statusTone"
                  variant="light"
                >
                  {{ row.statusLabel }}
                </t-tag>
                <span>{{ row.reasonLabel }}</span>
              </div>
            </template>
          </t-table>
        </div>

        <div class="hash-panel">
          <span>影响版本校验码</span>
          <code>{{ preview.snapshotHash }}</code>
        </div>

        <div
          v-if="canConfirmAddition"
          class="confirmation-panel"
        >
          <t-alert
            theme="warning"
            title="新增后岗位权限立即生效，目标人员刷新登录凭证会被撤销，后续需重新登录。"
            :close="false"
          />
          <t-form label-align="top">
            <t-form-item label="当前登录密码">
              <t-input
                v-model="confirmationPassword"
                type="password"
                autocomplete="current-password"
                :disabled="applying"
                placeholder="请输入当前登录密码"
              />
            </t-form-item>
          </t-form>
          <div class="addition-actions">
            <t-button
              theme="primary"
              :loading="applying"
              :disabled="previewing"
              @click="applyAddition"
            >
              确认新增该岗位
            </t-button>
          </div>
        </div>
        <t-alert
          v-else
          theme="error"
          title="服务端判定当前不能安全新增，不会开放密码确认。"
          :close="false"
        />
      </section>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import type { RoleKey } from "@jiangkong/shared-domain";
import { computed, ref, watch } from "vue";
import {
  applyOrganizationRoleAddition,
  OrganizationApiError,
  previewOrganizationRoleAddition,
  type ApplyOrganizationRoleAdditionResult,
  type OrganizationDirectory,
  type OrganizationDirectoryUser,
  type OrganizationRoleAdditionTarget,
  type OrganizationRoleScope,
  type RoleAdditionImpactPreview
} from "../../../api/organization.api";
import {
  activeOrganizationProjectOptions,
  buildOrganizationRoleAdditionTarget,
  buildRoleAdditionApplyPayload,
  canConfirmRoleAddition,
  organizationRoleAdditionOptions,
  roleAdditionImpactRows,
  roleAdditionTargetMatchesPreview
} from "../organization.config";

const props = defineProps<{
  visible: boolean;
  user: OrganizationDirectoryUser | null;
  projects: OrganizationDirectory["projects"];
  positions: OrganizationDirectory["positions"];
}>();

const emit = defineEmits<{
  close: [];
  applied: [result: ApplyOrganizationRoleAdditionResult];
  "busy-change": [busy: boolean];
}>();

const scope = ref<OrganizationRoleScope>("global");
const projectId = ref<string>();
const roleKey = ref<RoleKey>();
const selectedTarget = ref<OrganizationRoleAdditionTarget | null>(null);
const preview = ref<RoleAdditionImpactPreview | null>(null);
const previewing = ref(false);
const applying = ref(false);
const previewStale = ref(false);
const previewMessage = ref("");
const confirmationPassword = ref("");

const scopeOptions = [
  { label: "全局岗位", value: "global" },
  { label: "项目岗位", value: "project" }
];
const impactColumns = [
  { colKey: "business", title: "受影响业务", minWidth: 168 },
  { colKey: "nodeName", title: "审批节点", minWidth: 136 },
  { colKey: "resolution", title: "办理能力变化", minWidth: 260 },
  { colKey: "status", title: "新增后状态", minWidth: 180 }
];

const projectOptions = computed(() => activeOrganizationProjectOptions(props.projects));
const roleOptions = computed(() =>
  props.user
    ? organizationRoleAdditionOptions(
        props.user,
        scope.value,
        projectId.value,
        props.positions
      )
    : []
);
const selectionDisabled = computed(
  () => busy.value || !props.user || props.user.status !== "active"
);
const busy = computed(() => previewing.value || applying.value);
const canConfirmAddition = computed(() =>
  canConfirmRoleAddition(selectedTarget.value, preview.value, previewStale.value)
);
const impactRows = computed(() =>
  preview.value ? roleAdditionImpactRows(preview.value.impacts, props.positions) : []
);
const previewTime = computed(() => {
  if (!preview.value) return "未读取";
  const date = new Date(preview.value.evaluatedAt);
  return Number.isNaN(date.getTime()) ? "时间未读取" : date.toLocaleString("zh-CN");
});

watch(
  busy,
  (value) => {
    emit("busy-change", value);
  },
  { immediate: true }
);

watch(
  () => [props.visible, props.user?.id] as const,
  ([visible], previous) => {
    if (!visible || previous?.[1] !== props.user?.id) resetFlow();
  }
);

watch(
  () => [scope.value, projectId.value, roleKey.value] as const,
  ([nextScope, nextProject], previous) => {
    if (!previous) return;
    resetPreview();
    if (previous[0] !== nextScope) {
      projectId.value = undefined;
      roleKey.value = undefined;
    } else if (previous[1] !== nextProject) {
      roleKey.value = undefined;
    }
  }
);

function drawerDirectory(): OrganizationDirectory {
  return {
    summary: { departments: 0, activeUsers: props.user?.status === "active" ? 1 : 0, inactiveUsers: props.user?.status === "inactive" ? 1 : 0, positions: props.positions.length },
    departments: [],
    users: props.user ? [props.user] : [],
    projects: props.projects,
    positions: props.positions
  };
}

function resetPassword() {
  confirmationPassword.value = "";
}

function resetPreview() {
  selectedTarget.value = null;
  preview.value = null;
  previewStale.value = false;
  previewMessage.value = "";
  resetPassword();
}

function resetFlow() {
  scope.value = "global";
  projectId.value = undefined;
  roleKey.value = undefined;
  resetPreview();
}

function requestClose() {
  if (busy.value) return;
  resetFlow();
  emit("close");
}

async function previewTarget() {
  if (busy.value || !props.user) return;
  resetPreview();
  let target: OrganizationRoleAdditionTarget;
  try {
    target = buildOrganizationRoleAdditionTarget(
      props.user,
      { scope: scope.value, projectId: projectId.value, roleKey: roleKey.value },
      drawerDirectory()
    );
  } catch (error) {
    previewMessage.value = error instanceof Error ? error.message : "新增岗位目标无效，请刷新后重试。";
    return;
  }
  selectedTarget.value = target;
  previewing.value = true;
  try {
    const result = await previewOrganizationRoleAddition(target);
    if (!roleAdditionTargetMatchesPreview(target, result)) {
      previewMessage.value = "服务端返回的岗位目标与当前选择不一致，请刷新后重试。";
      return;
    }
    preview.value = result;
  } catch (error) {
    previewMessage.value = error instanceof Error ? error.message : "读取岗位新增影响失败，请稍后重试。";
    resetPassword();
  } finally {
    previewing.value = false;
  }
}

async function applyAddition() {
  if (busy.value || !selectedTarget.value || !preview.value || !canConfirmAddition.value) return;
  previewMessage.value = "";
  applying.value = true;
  try {
    const payload = buildRoleAdditionApplyPayload(
      selectedTarget.value,
      preview.value,
      confirmationPassword.value
    );
    const result = await applyOrganizationRoleAddition(payload);
    resetFlow();
    emit("applied", result);
  } catch (error) {
    resetPassword();
    if (error instanceof OrganizationApiError && error.status === 409) {
      preview.value = null;
      selectedTarget.value = null;
      previewStale.value = true;
    }
    previewMessage.value = error instanceof Error ? error.message : "新增岗位失败，请稍后重试。";
  } finally {
    applying.value = false;
  }
}
</script>

<style scoped>
.addition-drawer,
.addition-section,
.blocking-list,
.confirmation-panel {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-lg);
}

.addition-drawer {
  container-name: organization-drawer;
  container-type: inline-size;
}

.addition-section {
  padding-top: var(--jg-space-sm);
}

.section-head,
.preview-summary,
.addition-actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-md);
}

.section-head {
  justify-content: space-between;
}

.section-head h3,
.section-head p {
  margin: 0;
}

.section-head h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.section-head p,
.stacked-cell span:last-child,
.hash-panel span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.preview-summary {
  flex-wrap: wrap;
  color: var(--jg-color-text-secondary);
}

.stacked-cell,
.hash-panel {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-xs);
}

.hash-panel {
  padding: var(--jg-space-md);
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-md);
  background: var(--jg-color-bg-muted);
}

@container organization-drawer (max-width: 620px) {
  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
