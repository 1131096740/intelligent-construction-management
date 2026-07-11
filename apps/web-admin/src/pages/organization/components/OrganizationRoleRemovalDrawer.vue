<template>
  <t-drawer
    :visible="visible"
    header="岗位管理"
    size="large"
    :footer="false"
    :close-btn="!busy"
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    @close="requestClose"
  >
    <div class="role-drawer">
      <t-alert
        theme="info"
        :title="user ? `当前人员：${user.name}。当前仅支持逐条撤销，岗位新增尚未开放。` : '未读取待管理人员。'"
        :close="false"
      />

      <section class="role-section">
        <div class="section-head">
          <div>
            <h3>已有岗位</h3>
            <p>项目岗位可能包含兼容读取数据，是否能撤销以服务端预览为准。</p>
          </div>
        </div>
        <t-table
          row-key="key"
          size="small"
          :columns="targetColumns"
          :data="targetRows"
          :loading="false"
          empty="该人员暂无可预览撤销的岗位"
        >
          <template #scopeLabel="{ row }">
            <t-tag
              size="small"
              :theme="row.scope === 'global' ? 'primary' : 'default'"
              variant="light"
            >
              {{ row.scopeLabel }}
            </t-tag>
          </template>
          <template #operation="{ row }">
            <t-button
              size="small"
              variant="text"
              theme="danger"
              :loading="previewing && selectedTarget?.key === row.key"
              :disabled="busy && selectedTarget?.key !== row.key"
              @click="previewTarget(row)"
            >
              预览撤销影响
            </t-button>
          </template>
        </t-table>
      </section>

      <section
        v-if="selectedTarget"
        class="role-section"
      >
        <div class="section-head">
          <div>
            <h3>影响预览</h3>
            <p>{{ selectedTarget.projectLabel }} · {{ selectedTarget.roleName }}</p>
          </div>
          <t-button
            variant="outline"
            :loading="previewing"
            :disabled="applying"
            @click="previewTarget(selectedTarget)"
          >
            重新预览
          </t-button>
        </div>

        <t-alert
          v-if="previewMessage"
          theme="error"
          :title="previewMessage"
          :close="false"
        />
        <t-alert
          v-if="previewStale && preview"
          theme="warning"
          title="当前影响预览已过期，必须重新预览后才能撤销。"
          :close="false"
        />

        <template v-if="preview">
          <div class="preview-summary">
            <t-tag
              :theme="preview.canApply ? 'success' : 'danger'"
              variant="light"
            >
              {{ preview.canApply ? "服务端判定可撤销" : "服务端判定不可撤销" }}
            </t-tag>
            <span>受影响审批 {{ preview.summary.affectedInstances }} 项</span>
            <span>阻断审批 {{ preview.summary.blockingInstances }} 项</span>
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

          <t-table
            row-key="key"
            size="small"
            :columns="impactColumns"
            :data="impactRows"
            empty="未发现当前在途审批影响"
          >
            <template #business="{ row }">
              <div class="impact-business">
                <span>{{ row.businessTypeLabel }}</span>
                <span>{{ row.businessId }}</span>
              </div>
            </template>
            <template #status="{ row }">
              <div class="impact-status">
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

          <div class="hash-panel">
            <span>影响版本校验码</span>
            <code>{{ preview.snapshotHash }}</code>
          </div>

          <div
            v-if="canConfirmRemoval"
            class="confirmation-panel"
          >
            <t-alert
              theme="warning"
              title="撤销后该岗位权限会在服务端立即失效，刷新登录凭证会被撤销，相关人员后续需重新登录。"
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
            <div class="confirmation-actions">
              <t-button
                theme="danger"
                :loading="applying"
                :disabled="previewing"
                @click="applyRemoval"
              >
                确认撤销该岗位
              </t-button>
            </div>
          </div>
          <t-alert
            v-else-if="!previewStale"
            theme="error"
            title="服务端判定当前不能安全撤销，不会开放密码确认。"
            :close="false"
          />
        </template>
      </section>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  applyOrganizationRoleRemoval,
  OrganizationApiError,
  previewOrganizationRoleRemoval,
  type ApplyOrganizationRoleRemovalResult,
  type OrganizationDirectory,
  type OrganizationDirectoryUser,
  type RoleRemovalImpactPreview
} from "../../../api/organization.api";
import {
  buildOrganizationRoleRemovalTargets,
  buildRoleRemovalApplyPayload,
  canConfirmRoleRemoval,
  mergeOrganizationRoleRemovalTargets,
  roleRemovalImpactRows,
  roleRemovalTargetMatchesPreview,
  type OrganizationRoleRemovalTargetRow
} from "../organization.config";

const props = defineProps<{
  visible: boolean;
  user: OrganizationDirectoryUser | null;
  positions: OrganizationDirectory["positions"];
  remediationTarget?: OrganizationRoleRemovalTargetRow | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [result: ApplyOrganizationRoleRemovalResult];
  "busy-change": [busy: boolean];
}>();

const selectedTarget = ref<OrganizationRoleRemovalTargetRow | null>(null);
const preview = ref<RoleRemovalImpactPreview | null>(null);
const previewing = ref(false);
const applying = ref(false);
const previewStale = ref(false);
const previewMessage = ref("");
const confirmationPassword = ref("");

const targetColumns = [
  { colKey: "scopeLabel", title: "范围", width: 104 },
  { colKey: "projectLabel", title: "归属", minWidth: 180 },
  { colKey: "roleName", title: "岗位", minWidth: 140 },
  { colKey: "operation", title: "操作", width: 132, fixed: "right" }
];
const impactColumns = [
  { colKey: "business", title: "受影响业务", minWidth: 180 },
  { colKey: "projectId", title: "项目", minWidth: 128 },
  { colKey: "currentNodeName", title: "当前节点", minWidth: 148 },
  { colKey: "pendingRoleNames", title: "待审岗位", minWidth: 148 },
  { colKey: "modeLabel", title: "审批方式", width: 116 },
  { colKey: "status", title: "撤销后状态", minWidth: 190 }
];

const targetRows = computed(() => {
  if (!props.user) return [];
  return mergeOrganizationRoleRemovalTargets(
    buildOrganizationRoleRemovalTargets(props.user, props.positions),
    props.remediationTarget?.userId === props.user.id ? props.remediationTarget : null
  );
});
const impactRows = computed(() =>
  preview.value ? roleRemovalImpactRows(preview.value.impacts, props.positions) : []
);
const busy = computed(() => previewing.value || applying.value);
const canConfirmRemoval = computed(() =>
  canConfirmRoleRemoval(selectedTarget.value, preview.value, previewStale.value)
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
  () => [props.visible, props.user?.id, props.remediationTarget?.key] as const,
  ([visible], previous) => {
    if (
      !visible ||
      previous?.[1] !== props.user?.id ||
      previous?.[2] !== props.remediationTarget?.key
    ) {
      resetFlow();
    }
  }
);

function resetPassword() {
  confirmationPassword.value = "";
}

function resetFlow() {
  selectedTarget.value = null;
  preview.value = null;
  previewStale.value = false;
  previewMessage.value = "";
  resetPassword();
}

function requestClose() {
  if (busy.value) return;
  resetFlow();
  emit("close");
}

async function previewTarget(target: OrganizationRoleRemovalTargetRow) {
  if (busy.value) return;
  const sameTarget = selectedTarget.value?.key === target.key;
  selectedTarget.value = target;
  previewMessage.value = "";
  previewStale.value = true;
  resetPassword();
  if (!sameTarget) preview.value = null;
  previewing.value = true;
  try {
    const result = await previewOrganizationRoleRemoval(target);
    if (selectedTarget.value?.key !== target.key) return;
    if (!roleRemovalTargetMatchesPreview(target, result)) {
      preview.value = null;
      previewMessage.value = "服务端返回的岗位目标与当前选择不一致，请刷新后重试。";
      return;
    }
    preview.value = result;
    previewStale.value = false;
  } catch (error) {
    previewMessage.value = error instanceof Error ? error.message : "读取岗位撤销影响失败，请稍后重试。";
  } finally {
    previewing.value = false;
  }
}

async function applyRemoval() {
  if (busy.value || !selectedTarget.value || !preview.value || !canConfirmRemoval.value) return;
  previewMessage.value = "";
  applying.value = true;
  try {
    const payload = buildRoleRemovalApplyPayload(
      selectedTarget.value,
      preview.value,
      confirmationPassword.value
    );
    const result = await applyOrganizationRoleRemoval(payload);
    resetPassword();
    emit("applied", result);
  } catch (error) {
    resetPassword();
    if (error instanceof OrganizationApiError && error.status === 409) {
      previewStale.value = true;
    }
    previewMessage.value = error instanceof Error ? error.message : "撤销岗位失败，请稍后重试。";
  } finally {
    applying.value = false;
  }
}
</script>

<style scoped>
.role-drawer,
.role-section,
.blocking-list,
.confirmation-panel {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-lg);
}

.role-section {
  padding-top: var(--jg-space-sm);
}

.section-head,
.preview-summary,
.confirmation-actions {
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
.impact-business span:last-child,
.impact-status span,
.hash-panel span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.preview-summary {
  flex-wrap: wrap;
  color: var(--jg-color-text-secondary);
}

.impact-business,
.impact-status,
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

.hash-panel code {
  overflow-wrap: anywhere;
  color: var(--jg-color-text-secondary);
}

.confirmation-actions {
  justify-content: flex-end;
}
</style>
