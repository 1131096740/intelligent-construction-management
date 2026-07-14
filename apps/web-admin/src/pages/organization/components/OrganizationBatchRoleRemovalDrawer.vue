<template>
  <t-drawer
    :visible="visible"
    header="批量预览撤岗"
    size="large"
    :footer="false"
    :close-btn="!previewing"
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    @close="requestClose"
  >
    <div class="batch-drawer">
      <t-alert
        theme="info"
        title="这里只累计模拟 2 至 20 个正常岗位的撤销影响，不会执行任何岗位变更。"
        :close="false"
      />
      <t-alert
        theme="warning"
        title="实际撤销仍需回到单人岗位管理，逐条重新预览并验证当前登录密码；批量组合校验码不得用于撤销接口。"
        :close="false"
      />

      <t-form label-align="top">
        <t-form-item label="待预览岗位">
          <t-select
            v-model="selectedValues"
            multiple
            filterable
            clearable
            :options="targetOptions"
            :disabled="previewing"
            placeholder="请选择跨人员、跨范围的 2 至 20 个已有岗位"
            @change="clearPreview"
            @clear="clearSelection"
          />
        </t-form-item>
      </t-form>

      <div class="selection-actions">
        <span>已选择 {{ selectedValues.length }} / 20 项</span>
        <t-button
          theme="primary"
          :loading="previewing"
          :disabled="!canPreview"
          @click="previewBatch"
        >
          生成累计影响预览
        </t-button>
      </div>

      <t-alert
        v-if="targetOptions.length < 2"
        theme="warning"
        title="当前组织目录中不足两个可批量预览的正常岗位。项目级系统管理员异常请继续使用岗位数据预检中的单条清理入口。"
        :close="false"
      />
      <t-alert
        v-if="previewMessage"
        theme="error"
        :title="previewMessage"
        :close="false"
      />

      <template v-if="preview">
        <section class="batch-section">
          <div class="preview-summary">
            <t-tag
              :theme="preview.canApply ? 'success' : 'danger'"
              variant="light"
            >
              {{ preview.canApply ? "组合预览无阻断" : "组合预览存在阻断" }}
            </t-tag>
            <span>已模拟 {{ preview.simulatedTargets }} / {{ previewTargets.length }} 项</span>
            <span>预览时间 {{ previewTime }}</span>
          </div>
          <t-alert
            v-if="blockingTargetLabel"
            theme="error"
            :title="`首个阻断：${blockingTargetLabel}`"
            :close="false"
          />
          <div class="hash-panel">
            <span>组合预览校验码（只读）</span>
            <code>{{ preview.combinedSnapshotHash }}</code>
          </div>
        </section>

        <section class="batch-section">
          <div class="section-head">
            <div>
              <h3>逐步累计结果</h3>
              <p>按所选顺序模拟；遇到首个阻断后，服务端不会伪造后续安全步骤。</p>
            </div>
          </div>

          <article
            v-for="step in stepViews"
            :key="step.sequence"
            class="step-panel"
          >
            <div class="step-head">
              <div>
                <strong>第 {{ step.sequence + 1 }} 步 · {{ step.targetLabel }}</strong>
                <span>影响审批 {{ step.affectedInstances }} 项 · 阻断 {{ step.blockingInstances }} 项</span>
              </div>
              <t-tag
                :theme="step.canApply ? 'success' : 'danger'"
                variant="light"
              >
                {{ step.canApply ? "该步可继续" : "该步阻断" }}
              </t-tag>
            </div>
            <t-alert
              v-for="(blockingMessage, index) in step.blockingMessages"
              :key="`${step.sequence}:blocking:${index}`"
              theme="error"
              :title="blockingMessage"
              :close="false"
            />
            <div class="jg-table-region jg-table-region--wide">
              <t-table
                row-key="key"
                size="small"
                :columns="impactColumns"
                :data="step.impactRows"
                :horizontal-scroll-affixed-bottom="true"
                empty="该步骤未发现当前或未来审批节点影响"
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
            </div>
          </article>
        </section>
      </template>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  previewOrganizationRoleRemovalBatch,
  type OrganizationDirectory,
  type OrganizationRoleRemovalTarget,
  type RoleRemovalBatchImpactPreview
} from "../../../api/organization.api";
import {
  buildOrganizationRoleRemovalBatchTargets,
  normalizeOrganizationRoleRemovalBatchPreview,
  organizationBatchRoleRemovalOptions,
  roleRemovalBatchStepViews
} from "../organization.config";

const props = defineProps<{
  visible: boolean;
  directory: OrganizationDirectory;
}>();

const emit = defineEmits<{
  close: [];
  "busy-change": [busy: boolean];
}>();

const selectedValues = ref<string[]>([]);
const previewTargets = ref<OrganizationRoleRemovalTarget[]>([]);
const preview = ref<RoleRemovalBatchImpactPreview | null>(null);
const previewMessage = ref("");
const previewing = ref(false);
let previewRequestId = 0;

const targetOptions = computed(() => organizationBatchRoleRemovalOptions(props.directory));
const canPreview = computed(
  () => selectedValues.value.length >= 2 && selectedValues.value.length <= 20 && !previewing.value
);
const stepViews = computed(() =>
  preview.value
    ? roleRemovalBatchStepViews(preview.value, props.directory, previewTargets.value)
    : []
);
const blockingTargetLabel = computed(
  () => stepViews.value.find((step) => !step.canApply)?.targetLabel ?? ""
);
const previewTime = computed(() =>
  preview.value ? new Date(preview.value.evaluatedAt).toLocaleString("zh-CN", { hour12: false }) : ""
);

watch(previewing, (busy) => emit("busy-change", busy), { immediate: true });
watch(
  () => props.visible,
  () => resetDrawer()
);

function clearPreview() {
  previewRequestId += 1;
  previewTargets.value = [];
  preview.value = null;
  previewMessage.value = "";
}

function clearSelection() {
  selectedValues.value = [];
  clearPreview();
}

function resetDrawer() {
  selectedValues.value = [];
  previewing.value = false;
  clearPreview();
}

function requestClose() {
  if (previewing.value) return;
  resetDrawer();
  emit("close");
}

async function previewBatch() {
  if (previewing.value) return;
  const requestId = ++previewRequestId;
  previewing.value = true;
  preview.value = null;
  previewMessage.value = "";
  try {
    const targets = buildOrganizationRoleRemovalBatchTargets(
      selectedValues.value,
      targetOptions.value
    );
    const result = await previewOrganizationRoleRemovalBatch({ targets });
    if (requestId !== previewRequestId) return;
    previewTargets.value = targets;
    preview.value = normalizeOrganizationRoleRemovalBatchPreview(result, targets);
  } catch (error) {
    if (requestId !== previewRequestId) return;
    previewMessage.value =
      error instanceof Error ? error.message : "读取批量岗位撤销影响失败，请稍后重试。";
  } finally {
    if (requestId === previewRequestId) previewing.value = false;
  }
}

const impactColumns = [
  { colKey: "business", title: "业务", minWidth: 176 },
  { colKey: "projectId", title: "项目", minWidth: 128 },
  { colKey: "currentNodeName", title: "审批节点", minWidth: 144 },
  { colKey: "modeLabel", title: "审批方式", width: 108 },
  { colKey: "pendingRoleNames", title: "待审岗位", minWidth: 144 },
  { colKey: "status", title: "模拟结果", minWidth: 196 }
];
</script>

<style scoped>
.batch-drawer,
.batch-section,
.step-panel,
.impact-business,
.impact-status,
.step-head > div {
  display: flex;
  flex-direction: column;
  gap: var(--jg-space-md);
}

.batch-drawer {
  container-name: organization-drawer;
  container-type: inline-size;
}

.selection-actions,
.preview-summary,
.step-head,
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.selection-actions span,
.preview-summary span,
.step-head span,
.section-head p,
.impact-business span:last-child,
.impact-status span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.batch-section {
  padding-top: var(--jg-space-lg);
  border-top: 1px solid var(--jg-border);
}

.section-head h3,
.section-head p {
  margin: 0;
}

.step-panel {
  padding: var(--jg-space-md) 0;
  border-bottom: 1px solid var(--jg-border);
}

.hash-panel {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
}

.hash-panel code {
  overflow-wrap: anywhere;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

@container organization-drawer (max-width: 620px) {
  .selection-actions,
  .step-head,
  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
