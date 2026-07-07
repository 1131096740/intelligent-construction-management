<template>
  <section class="workbench-page">
    <!-- Draft-creation flow for /contracts/new ------------------------------->
    <div
      v-if="isNewDraft"
      class="create-panel"
    >
      <h1>新建合同</h1>
      <p class="create-hint">
        请先选择项目、合同类型与业务模板，系统将创建草稿并进入工作台。
      </p>

      <div class="create-fields">
        <label class="field">
          <span class="field-label">项目</span>
          <t-select
            :value="initializeDraft.projectId.value"
            :options="projectOptions"
            placeholder="选择项目"
            @change="(value: string) => initializeDraft.setProjectId(value)"
          />
        </label>
        <label class="field">
          <span class="field-label">合同类型</span>
          <t-select
            :value="initializeDraft.contractTypeKey.value"
            :options="contractTypeOptions"
            placeholder="选择合同类型"
            @change="onContractTypeChange"
          />
        </label>
        <label class="field">
          <span class="field-label">业务模板</span>
          <t-select
            :value="initializeDraft.businessTemplateVersionId.value"
            :options="templateOptions"
            :disabled="!initializeDraft.contractTypeKey.value"
            placeholder="选择业务模板"
            @change="(value: string) => initializeDraft.setBusinessTemplateVersionId(value)"
          />
        </label>
      </div>

      <div class="create-actions">
        <t-button
          theme="primary"
          :loading="creating"
          :disabled="!initializeDraft.canCreate.value"
          @click="onCreateDraft"
        >
          创建草稿
        </t-button>
      </div>

      <p
        v-if="errorMessage"
        class="error-text"
      >
        {{ errorMessage }}
      </p>
    </div>

    <!-- Workbench shell for an existing contract ----------------------------->
    <div
      v-else
      class="workbench-shell"
    >
      <header class="status-bar">
        <div class="status-left">
          <h1 class="contract-title">
            {{ workbench?.contract.name || "合同工作台" }}
          </h1>
          <span class="contract-code">{{ workbench?.contract.temporaryCode ?? "" }}</span>
        </div>
        <div class="status-right">
          <span :class="['autosave-status', autosaveTone]">{{ autosaveLabel }}</span>
          <t-button
            v-if="canTransfer"
            size="small"
            variant="outline"
            @click="transferVisible = true"
          >
            转移负责人
          </t-button>
          <t-button
            size="small"
            theme="primary"
            :disabled="!editable"
            :loading="saveState === 'saving'"
            @click="onSave"
          >
            保存
          </t-button>
        </div>
      </header>

      <div class="shell-body">
        <nav class="section-nav">
          <button
            v-for="section in sections"
            :key="section.key"
            type="button"
            :class="['nav-item', { active: activeSection === section.key }]"
            @click="activeSection = section.key"
          >
            {{ section.label }}
          </button>
        </nav>

        <main class="section-editor">
          <p
            v-if="!editable && workbench"
            class="readonly-banner"
          >
            当前状态（{{ contractVersionStatusLabel(workbench.version.status) }}）不可编辑，仅供查看。
          </p>

          <div
            v-if="activeSection === 'overview' && workbench"
            class="migration-control"
          >
            <span class="migration-label">合同类型迁移</span>
            <t-select
              :value="workbench.contract.contractTypeKey"
              :options="contractTypeOptions"
              :disabled="!editable || migrationBusy"
              placeholder="切换合同类型"
              @change="onExistingTypeChange"
            />
            <span class="migration-hint">切换类型前会先生成迁移预览，确认后才会应用。</span>
          </div>

          <ContractOverviewSection
            v-if="activeSection === 'overview'"
            :workbench="workbench"
            :disabled="!editable"
            @create-checkpoint="onCreateCheckpoint"
            @restore-checkpoint="onRestoreCheckpoint"
          />
          <ContractBasicSection
            v-else-if="activeSection === 'basic'"
            :model="model"
            :disabled="!editable"
            @update="applyPatch"
          />
          <ContractPartySection
            v-else-if="activeSection === 'party'"
            :model="model"
            :workbench="workbench"
            :disabled="!editable"
            @update="applyPatch"
            @reload="reloadCurrent"
          />
          <ContractPricingSection
            v-else-if="activeSection === 'pricing'"
            :model="model"
            :workbench="workbench"
            :disabled="!editable"
            @update="applyPatch"
          />
          <ContractProfessionalFieldsSection
            v-else-if="activeSection === 'fields'"
            :model="model"
            :workbench="workbench"
            :disabled="!editable"
            @update="applyPatch"
          />
          <ContractBillsSection
            v-else-if="activeSection === 'bills'"
            :workbench="workbench"
            :disabled="!editable"
            @reload="reloadCurrent"
          />
          <ContractClausesSection
            v-else-if="activeSection === 'clauses'"
            :model="model"
            :readiness="workbench?.readiness"
            :disabled="!editable"
            @update="applyPatch"
          />
          <ContractDocumentsSection
            v-else-if="activeSection === 'documents'"
            :workbench="workbench"
            :disabled="!editable"
            @reload="reloadCurrent"
          />
        </main>

        <ContractReadinessPanel
          class="readiness-slot"
          :readiness="workbench?.readiness ?? emptyReadiness"
        />
      </div>
    </div>

    <!-- Revision conflict resolution ---------------------------------------->
    <t-dialog
      :visible="saveState === 'conflict' && conflict !== null"
      header="检测到版本冲突"
      :close-on-overlay-click="false"
      :footer="false"
      @close="() => undefined"
    >
      <div class="conflict-body">
        <p>该草稿已被其他会话更新。请选择保留哪一份数据：</p>
        <div class="conflict-actions">
          <t-button
            theme="primary"
            @click="onKeepLocal"
          >
            保留本地修改并覆盖
          </t-button>
          <t-button
            variant="outline"
            @click="onLoadServer"
          >
            放弃本地，载入服务器版本
          </t-button>
        </div>
      </div>
    </t-dialog>

    <!-- Contract-type migration preview ------------------------------------->
    <t-dialog
      :visible="migrationVisible"
      header="合同类型迁移预览"
      :confirm-btn="{ content: '确认迁移', loading: migrationBusy }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="onConfirmMigration"
      @close="onCancelMigration"
    >
      <div class="migration-preview">
        <p>
          将合同类型迁移为
          <strong>{{ contractTypeLabel(migrationTargetTypeKey) }}</strong>。请确认下列变更：
        </p>
        <ul class="migration-diff">
          <li>保留字段：{{ migrationDiffText("retainedFields") }}</li>
          <li>移除字段：{{ migrationDiffText("removedFields") }}</li>
          <li>新增默认字段：{{ migrationDiffText("addedDefaults") }}</li>
          <li>移除清单：{{ migrationDiffText("removedBills") }}</li>
          <li>新增清单：{{ migrationDiffText("addedBills") }}</li>
        </ul>
      </div>
    </t-dialog>

    <!-- Ownership transfer --------------------------------------------------->
    <t-dialog
      v-model:visible="transferVisible"
      header="转移负责人"
      :on-confirm="onConfirmTransfer"
    >
      <label class="field">
        <span class="field-label">目标负责人</span>
        <t-select
          v-model="transferUserId"
          :options="transferUserOptions"
          placeholder="选择接收人"
        />
      </label>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type { ContractReadinessResult } from "@jiangkong/shared-domain";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  applyContractTypeChange,
  listPublishedContractTemplates,
  previewContractTypeChange,
  transferContractDraft
} from "../../api/contract-workbench.api";
import { fetchApprovalDelegationUserOptions } from "../../api/core-flow-read.api";
import { contractTypeLabel, contractVersionStatusLabel } from "./contract-labels";
import ContractBasicSection from "./workbench/ContractBasicSection.vue";
import ContractBillsSection from "./workbench/ContractBillsSection.vue";
import ContractClausesSection from "./workbench/ContractClausesSection.vue";
import ContractDocumentsSection from "./workbench/ContractDocumentsSection.vue";
import ContractOverviewSection from "./workbench/ContractOverviewSection.vue";
import ContractPartySection from "./workbench/ContractPartySection.vue";
import ContractPricingSection from "./workbench/ContractPricingSection.vue";
import ContractProfessionalFieldsSection from "./workbench/ContractProfessionalFieldsSection.vue";
import ContractReadinessPanel from "./workbench/ContractReadinessPanel.vue";
import {
  useContractDraft,
  type ContractDraftModel
} from "./workbench/use-contract-draft";

const route = useRoute();
const router = useRouter();

const draft = useContractDraft({
  replace: (to) => {
    void router.replace(to);
  }
});
const {
  model,
  workbench,
  saveState,
  conflict,
  initializeDraft,
  load,
  markDirty,
  saveNow,
  createCheckpoint,
  restoreCheckpoint,
  keepLocalAfterConflict,
  loadServerAfterConflict
} = draft;

// Sections are presentational: they emit a patch instead of mutating the shared
// model directly. The page owns the (non-prop) composable model and applies it,
// then schedules autosave.
function applyPatch(patch: Partial<ContractDraftModel>) {
  Object.assign(model, patch);
  markDirty();
}

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);

const emptyReadiness: ContractReadinessResult = {
  ready: false,
  blockingMessages: [],
  warningMessages: []
};

const sections = [
  { key: "overview", label: "概览" },
  { key: "basic", label: "基础信息" },
  { key: "party", label: "合作单位" },
  { key: "pricing", label: "计价与金额" },
  { key: "fields", label: "专业字段" },
  { key: "bills", label: "合同清单" },
  { key: "clauses", label: "合同条款" },
  { key: "documents", label: "合同文档" }
] as const;

type SectionKey = (typeof sections)[number]["key"];

const activeSection = ref<SectionKey>("overview");
const creating = ref(false);
const errorMessage = ref("");
const transferVisible = ref(false);
const transferUserId = ref("");
const transferUsers = ref<Array<{ id: string; name: string }>>([]);

// Contract-type migration (existing loaded draft): preview -> confirm -> apply.
const migrationVisible = ref(false);
const migrationBusy = ref(false);
const migrationTargetTypeKey = ref("");
const migrationTargetTemplateVersionId = ref("");
const migrationPreview = ref<Record<string, unknown> | null>(null);

// Selector option sources. Projects are seeded minimally here; a later task can
// wire a real project list endpoint. Contract types come from published
// business templates, so adding a new type is a template-center operation.
const projectOptions = ref<Array<{ label: string; value: string }>>([
  { label: "建设项目一期（JGXM-001）", value: "seed-project-jgxm-001" }
]);
const contractTypeOptions = ref<Array<{ label: string; value: string }>>([]);
const templateOptions = ref<Array<{ label: string; value: string }>>([]);

const contractId = computed(() => {
  const value = route.params.contractId;
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
});
const isNewDraft = computed(() => !contractId.value);

const editable = computed(() => {
  const status = workbench.value?.version.status;
  return status ? EDITABLE_STATUSES.has(status) : false;
});

// A contract director may view + transfer even when they cannot edit. We allow
// transfer whenever a contract is loaded; backend enforces the actual role.
const canTransfer = computed(() => Boolean(workbench.value));
const transferUserOptions = computed(() =>
  transferUsers.value.map((user) => ({ label: user.name, value: user.id }))
);

const autosaveLabel = computed(() => {
  switch (saveState.value) {
    case "saving":
      return "保存中…";
    case "saved":
      return "已保存";
    case "failed":
      return "保存失败，将重试";
    case "conflict":
      return "版本冲突，待处理";
    default:
      return "未改动";
  }
});

const autosaveTone = computed(() => {
  switch (saveState.value) {
    case "saved":
      return "tone-success";
    case "failed":
    case "conflict":
      return "tone-danger";
    case "saving":
      return "tone-primary";
    default:
      return "tone-muted";
  }
});

async function loadTemplatesForType(contractTypeKey: string) {
  templateOptions.value = [];
  if (!contractTypeKey) {
    return;
  }
  try {
    const templates = (await listPublishedContractTemplates(contractTypeKey)) as Array<
      Record<string, unknown>
    >;
    templateOptions.value = templates.map((template) => ({
      label: String(template["name"] ?? template["id"] ?? "模板"),
      value: String(template["versionId"] ?? template["id"] ?? "")
    }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "模板加载失败";
  }
}

async function loadContractTypeOptions() {
  try {
    const templates = (await listPublishedContractTemplates()) as Array<
      Record<string, unknown>
    >;
    const typeKeys = [
      ...new Set(
        templates
          .map((template) => String(template["contractTypeKey"] ?? "").trim())
          .filter(Boolean)
      )
    ];
    contractTypeOptions.value = typeKeys.map((typeKey) => ({
      label: contractTypeLabel(typeKey),
      value: typeKey
    }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "合同类型加载失败";
  }
}

function onContractTypeChange(value: string) {
  initializeDraft.setContractTypeKey(value);
  initializeDraft.setBusinessTemplateVersionId("");
  void loadTemplatesForType(value);
}

function firstTemplateVersionId(templates: Array<Record<string, unknown>>): string {
  const first = templates[0];
  if (!first) {
    return "";
  }
  return String(first["versionId"] ?? first["id"] ?? "");
}

// Existing loaded draft: changing the contract type opens a migration preview
// dialog; the change is applied only after the user confirms. Cancel reverts the
// selector to the current type (the select is bound to the read model, so simply
// closing the dialog restores the displayed value).
async function onExistingTypeChange(value: string) {
  const wb = workbench.value;
  if (!wb || value === wb.contract.contractTypeKey) {
    return;
  }

  migrationBusy.value = true;
  errorMessage.value = "";
  try {
    const templates = (await listPublishedContractTemplates(value)) as Array<
      Record<string, unknown>
    >;
    const targetTemplateVersionId = firstTemplateVersionId(templates);
    if (!targetTemplateVersionId) {
      errorMessage.value = "目标合同类型暂无已发布模板，无法迁移。";
      return;
    }

    const preview = (await previewContractTypeChange(wb.version.id, {
      targetBusinessTemplateVersionId: targetTemplateVersionId,
      expectedRevision: wb.version.draftRevision
    })) as Record<string, unknown>;

    migrationTargetTypeKey.value = value;
    migrationTargetTemplateVersionId.value = targetTemplateVersionId;
    migrationPreview.value = preview;
    migrationVisible.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "迁移预览失败";
  } finally {
    migrationBusy.value = false;
  }
}

function migrationDiffText(key: string): string {
  const preview = migrationPreview.value;
  const value = preview ? preview[key] : undefined;
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item) => String(item)).join("、");
  }
  return "无";
}

function resetMigrationState() {
  migrationVisible.value = false;
  migrationTargetTypeKey.value = "";
  migrationTargetTemplateVersionId.value = "";
  migrationPreview.value = null;
}

function onCancelMigration() {
  resetMigrationState();
}

async function onConfirmMigration() {
  const wb = workbench.value;
  if (!wb || !migrationTargetTemplateVersionId.value) {
    return;
  }

  migrationBusy.value = true;
  errorMessage.value = "";
  try {
    await applyContractTypeChange(wb.version.id, {
      targetBusinessTemplateVersionId: migrationTargetTemplateVersionId.value,
      expectedRevision: wb.version.draftRevision
    });
    resetMigrationState();
    await load(contractId.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "合同类型迁移失败";
  } finally {
    migrationBusy.value = false;
  }
}

async function onCreateDraft() {
  creating.value = true;
  errorMessage.value = "";
  try {
    await initializeDraft.commit();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "创建草稿失败";
  } finally {
    creating.value = false;
  }
}

async function onSave() {
  await saveNow();
}

async function reloadCurrent() {
  if (contractId.value) {
    await load(contractId.value);
  }
}

async function onCreateCheckpoint() {
  await createCheckpoint({
    confirmEviction: () =>
      window.confirm("已有 5 个检查点，创建新检查点将移除最早的一个，是否继续？")
  });
}

async function onRestoreCheckpoint(checkpointId: string) {
  await restoreCheckpoint(checkpointId);
}

async function onKeepLocal() {
  await keepLocalAfterConflict();
}

async function onLoadServer() {
  await loadServerAfterConflict();
}

async function onConfirmTransfer() {
  const target = transferUserId.value.trim();
  const id = contractId.value;
  if (!target || !id) {
    return;
  }
  try {
    await transferContractDraft(id, { toUserId: target });
    transferVisible.value = false;
    transferUserId.value = "";
    await load(id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "转移失败";
  }
}

async function loadExisting() {
  if (!contractId.value) {
    return;
  }
  try {
    await load(contractId.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "工作台加载失败";
  }
}

onMounted(() => {
  void loadContractTypeOptions();
  void loadExisting();
  void fetchApprovalDelegationUserOptions()
    .then((users) => {
      transferUsers.value = users;
    })
    .catch(() => {
      transferUsers.value = [];
    });
});

// Loading a different contract (or arriving from the create flow) reloads.
watch(contractId, (next, previous) => {
  if (next && next !== previous) {
    void loadExisting();
  }
});
</script>

<style scoped>
.workbench-page {
  width: 100%;
  min-width: 0;
  color: #151922;
}

/* Draft-creation panel ------------------------------------------------------*/
.create-panel {
  display: grid;
  gap: 16px;
  max-width: 720px;
  padding: 24px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.create-panel h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.create-hint {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.create-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.create-actions {
  display: flex;
  gap: 8px;
}

/* Shell ---------------------------------------------------------------------*/
.workbench-shell {
  display: grid;
  gap: 0;
}

.status-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 0 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.status-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.contract-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contract-code {
  color: #767f8d;
  font-size: 12px;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.autosave-status {
  font-size: 12px;
  font-weight: 600;
}

.tone-success {
  color: #1b6b3a;
}

.tone-danger {
  color: #b51d2a;
}

.tone-primary {
  color: #0052d9;
}

.tone-muted {
  color: #767f8d;
}

.shell-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 300px;
  gap: 16px;
  margin-top: 16px;
}

.section-nav {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 8px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.nav-item {
  display: block;
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  text-align: left;
  font-size: 13px;
  color: #424955;
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.nav-item:hover {
  background: #f3f5f8;
}

.nav-item.active {
  color: #0052d9;
  background: #eaf2ff;
  font-weight: 600;
}

.section-editor {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
  padding: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.readonly-banner {
  margin: 0;
  padding: 10px 12px;
  color: #9f4f06;
  background: #fff8ef;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}

.readiness-slot {
  align-self: start;
}

/* Migration control + preview ----------------------------------------------*/
.migration-control {
  display: grid;
  grid-template-columns: auto minmax(180px, 280px) 1fr;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #f7f9fc;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.migration-label {
  font-size: 12px;
  font-weight: 600;
  color: #424955;
}

.migration-hint {
  color: #767f8d;
  font-size: 12px;
}

.migration-preview {
  display: grid;
  gap: 12px;
}

.migration-diff {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: #424955;
}

/* Conflict + transfer -------------------------------------------------------*/
.conflict-body {
  display: grid;
  gap: 16px;
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.error-text {
  margin: 0;
  color: #b51d2a;
  font-size: 12px;
  font-weight: 600;
}

/* Responsive collapse under 1100px -----------------------------------------*/
@media (max-width: 1100px) {
  .shell-body {
    grid-template-columns: 1fr;
  }

  .section-nav {
    display: flex;
    flex-wrap: wrap;
  }

  .nav-item {
    width: auto;
  }
}
</style>
