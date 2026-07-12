<template>
  <section class="scenario-page">
    <header class="page-head">
      <div>
        <h1>合同业务场景</h1>
        <p>管理签约场景与精确已发布业务模板的推荐映射。</p>
      </div>
      <t-button
        theme="primary"
        :disabled="!canGovern"
        @click="openCreateScenario"
      >
        新建业务场景
      </t-button>
    </header>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
      class="message"
    />

    <t-table
      row-key="id"
      :columns="scenarioColumns"
      :data="scenarios"
      :loading="loading"
      table-layout="fixed"
      empty="尚未配置业务场景"
    >
      <template #scenarioName="{ row }">
        <div class="name-cell">
          <strong>{{ row.name }}</strong>
          <span>{{ row.code }}</span>
        </div>
      </template>
      <template #active="{ row }">
        <t-tag
          :theme="row.active ? 'success' : 'default'"
          variant="light"
        >
          {{ row.active ? "启用" : "停用" }}
        </t-tag>
      </template>
      <template #mappingCount="{ row }">
        {{ row.mappings.length }} 项
      </template>
      <template #updatedAt="{ row }">
        {{ formatDateTime(row.updatedAt) }}
      </template>
      <template #operation="{ row }">
        <div class="table-actions">
          <t-link
            theme="primary"
            @click="selectScenario(row)"
          >
            管理映射
          </t-link>
          <t-link
            theme="primary"
            :disabled="!canGovern"
            @click="openEditScenario(row)"
          >
            编辑
          </t-link>
          <t-popconfirm
            :content="row.active ? '停用后普通经办人不再可选，确认停用？' : '确认重新启用该场景？'"
            :disabled="!canGovern"
            @confirm="toggleScenario(row)"
          >
            <t-link
              :theme="row.active ? 'danger' : 'primary'"
              :disabled="!canGovern"
            >
              {{ row.active ? "停用" : "启用" }}
            </t-link>
          </t-popconfirm>
        </div>
      </template>
    </t-table>

    <section
      v-if="selectedScenario"
      class="mapping-section"
    >
      <header class="mapping-head">
        <div>
          <h2>{{ selectedScenario.name }}·模板映射</h2>
          <p>新增映射只能选择当前可用的精确已发布版本。</p>
        </div>
        <t-button
          variant="outline"
          :disabled="!canGovern || !publishedTemplateOptions.length"
          @click="openCreateMapping"
        >
          新增模板映射
        </t-button>
      </header>

      <t-table
        row-key="id"
        :columns="mappingColumns"
        :data="selectedScenario.mappings"
        table-layout="fixed"
        empty="该场景尚未配置模板映射"
      >
        <template #template="{ row }">
          <div class="name-cell">
            <strong>{{ mappingTemplateLabel(row) }}</strong>
            <span>{{ contractTypeLabel(row.contractTypeKey) }}</span>
          </div>
        </template>
        <template #reason="{ row }">
          <span class="reason-cell">{{ row.reason }}</span>
        </template>
        <template #active="{ row }">
          <t-tag
            :theme="row.active ? 'success' : 'default'"
            variant="light"
          >
            {{ row.active ? "启用" : "停用" }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <div class="table-actions">
            <t-link
              theme="primary"
              :disabled="!canGovern"
              @click="openEditMapping(row)"
            >
              编辑
            </t-link>
            <t-popconfirm
              :content="row.active ? '确认停用该映射？' : '启用前系统会重新验证精确模板版本，是否继续？'"
              :disabled="!canGovern"
              @confirm="toggleMapping(row)"
            >
              <t-link
                :theme="row.active ? 'danger' : 'primary'"
                :disabled="!canGovern"
              >
                {{ row.active ? "停用" : "启用" }}
              </t-link>
            </t-popconfirm>
          </div>
        </template>
      </t-table>
    </section>

    <t-dialog
      v-model:visible="scenarioDialogVisible"
      :header="editingScenarioId ? '编辑业务场景' : '新建业务场景'"
      :confirm-btn="{ content: '保存', loading: saving, disabled: !canGovern }"
      @confirm="saveScenario"
      @close="clearScenarioForm"
    >
      <div class="dialog-form">
        <t-input
          v-model="scenarioForm.code"
          label="场景编码"
          :disabled="Boolean(editingScenarioId)"
          placeholder="例如：material_purchase"
        />
        <t-input
          v-model="scenarioForm.name"
          label="场景名称"
          placeholder="例如：材料采购"
        />
        <t-textarea
          v-model="scenarioForm.description"
          placeholder="说明适用范围，不作为推荐理由"
          :autosize="{ minRows: 3, maxRows: 6 }"
        />
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="mappingDialogVisible"
      :header="editingMappingId ? '编辑模板映射' : '新增模板映射'"
      :confirm-btn="{ content: '保存', loading: saving, disabled: !canGovern }"
      @confirm="saveMapping"
      @close="clearMappingForm"
    >
      <div class="dialog-form">
        <t-select
          v-model="mappingForm.businessTemplateVersionId"
          label="精确已发布模板"
          :options="publishedTemplateOptions"
          :disabled="Boolean(editingMappingId)"
          placeholder="选择模板版本"
        />
        <t-textarea
          v-model="mappingForm.reason"
          placeholder="填写给经办人看的推荐理由"
          :autosize="{ minRows: 3, maxRows: 6 }"
        />
        <t-input-number
          v-model="mappingForm.priority"
          label="治理排序值"
          :min="0"
          :max="1000000"
          theme="normal"
        />
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type { PrimaryTableCol } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { useAuthStore } from "../../auth/auth.store";
import {
  createContractBusinessScenario,
  createContractScenarioMapping,
  listContractScenarioGovernance,
  updateContractBusinessScenario,
  updateContractScenarioMapping
} from "../../api/contract-scenario.api";
import {
  listPublishedContractTemplates,
  type PublishedContractTemplateReadModel
} from "../../api/contract-workbench.api";
import { contractTypeLabel } from "../contracts/contract-labels";
import {
  normalizeContractScenarioGovernance,
  type ContractScenarioGovernanceMapping,
  type ContractScenarioGovernanceRow
} from "../contracts/contract-scenario.state";
import { normalizePublishedContractTemplates } from "./contract-template.config";

const governanceRoles = new Set(["contract_director", "super_admin"]);
const auth = useAuthStore();
const scenarios = ref<ContractScenarioGovernanceRow[]>([]);
const publishedTemplates = ref<PublishedContractTemplateReadModel[]>([]);
const selectedScenarioId = ref("");
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const messageTone = ref<"success" | "error">("success");
const scenarioDialogVisible = ref(false);
const mappingDialogVisible = ref(false);
const editingScenarioId = ref("");
const editingMappingId = ref("");
const scenarioForm = reactive({ code: "", name: "", description: "" });
const mappingForm = reactive({ businessTemplateVersionId: "", reason: "", priority: 0 });

const canGovern = computed(() =>
  (auth.user?.globalRoleKeys ?? []).some((role) => governanceRoles.has(role))
);
const selectedScenario = computed(
  () => scenarios.value.find((scenario) => scenario.id === selectedScenarioId.value) ?? null
);
const publishedTemplateOptions = computed(() =>
  publishedTemplates.value.map((template) => ({
    label: `${template.name}·V${template.versionNo}·${contractTypeLabel(template.contractTypeKey)}`,
    value: template.versionId
  }))
);

const scenarioColumns: PrimaryTableCol<ContractScenarioGovernanceRow>[] = [
  { colKey: "scenarioName", title: "业务场景", minWidth: 160 },
  { colKey: "description", title: "适用说明", minWidth: 160, ellipsis: true },
  { colKey: "active", title: "状态", width: 76 },
  { colKey: "mappingCount", title: "映射", width: 70 },
  { colKey: "revision", title: "修订", width: 64 },
  { colKey: "updatedAt", title: "更新时间", width: 145 },
  { colKey: "operation", title: "操作", width: 170 }
];
const mappingColumns: PrimaryTableCol<ContractScenarioGovernanceMapping>[] = [
  { colKey: "template", title: "精确模板", minWidth: 180 },
  { colKey: "reason", title: "经办人可见推荐理由", minWidth: 200 },
  { colKey: "priority", title: "排序值", width: 70 },
  { colKey: "active", title: "状态", width: 76 },
  { colKey: "revision", title: "修订", width: 64 },
  { colKey: "operation", title: "操作", width: 120 }
];

onMounted(() => {
  if (!canGovern.value) {
    message.value = "仅全局合同部主管或系统管理员可以治理业务场景。";
    messageTone.value = "error";
    return;
  }
  void loadGovernance();
});

async function loadGovernance() {
  loading.value = true;
  message.value = "";
  try {
    const [scenarioPayload, templatePayload] = await Promise.all([
      listContractScenarioGovernance(),
      listPublishedContractTemplates()
    ]);
    scenarios.value = normalizeContractScenarioGovernance(scenarioPayload);
    publishedTemplates.value = normalizePublishedContractTemplates(templatePayload);
    if (!scenarios.value.some((scenario) => scenario.id === selectedScenarioId.value)) {
      selectedScenarioId.value = scenarios.value[0]?.id ?? "";
    }
    return true;
  } catch (error) {
    scenarios.value = [];
    publishedTemplates.value = [];
    showError(error instanceof Error ? error.message : "加载业务场景治理失败。");
    return false;
  } finally {
    loading.value = false;
  }
}

function selectScenario(row: ContractScenarioGovernanceRow) {
  selectedScenarioId.value = row.id;
}

function openCreateScenario() {
  if (!assertCanGovern()) return;
  clearScenarioForm();
  scenarioDialogVisible.value = true;
}

function openEditScenario(row: ContractScenarioGovernanceRow) {
  if (!assertCanGovern()) return;
  editingScenarioId.value = row.id;
  scenarioForm.code = row.code;
  scenarioForm.name = row.name;
  scenarioForm.description = row.description ?? "";
  scenarioDialogVisible.value = true;
}

function openCreateMapping() {
  if (!assertCanGovern()) return;
  clearMappingForm();
  mappingDialogVisible.value = true;
}

function openEditMapping(row: ContractScenarioGovernanceMapping) {
  if (!assertCanGovern()) return;
  editingMappingId.value = row.id;
  mappingForm.businessTemplateVersionId = row.businessTemplateVersionId;
  mappingForm.reason = row.reason;
  mappingForm.priority = row.priority;
  mappingDialogVisible.value = true;
}

async function saveScenario() {
  if (!assertCanGovern()) return;
  const name = scenarioForm.name.trim();
  const code = scenarioForm.code.trim();
  if (!name || (!editingScenarioId.value && !code)) {
    showError("请填写场景编码和名称。");
    return;
  }
  const editing = scenarios.value.find((scenario) => scenario.id === editingScenarioId.value);
  const saved = await runMutation(async () => {
    if (editing) {
      await updateContractBusinessScenario(editing.id, {
        expectedRevision: editing.revision,
        name,
        description: scenarioForm.description.trim()
      });
    } else {
      await createContractBusinessScenario({
        code,
        name,
        description: scenarioForm.description.trim() || undefined
      });
    }
  }, "业务场景已保存。");
  if (!saved) return;
  scenarioDialogVisible.value = false;
  clearScenarioForm();
}

async function saveMapping() {
  if (!assertCanGovern()) return;
  const scenario = selectedScenario.value;
  const reason = mappingForm.reason.trim();
  if (!scenario || !reason || (!editingMappingId.value && !mappingForm.businessTemplateVersionId)) {
    showError("请选择精确模板版本并填写推荐理由。");
    return;
  }
  const editing = scenario.mappings.find((mapping) => mapping.id === editingMappingId.value);
  const saved = await runMutation(async () => {
    if (editing) {
      await updateContractScenarioMapping(editing.id, {
        expectedRevision: editing.revision,
        reason,
        priority: mappingForm.priority
      });
    } else {
      await createContractScenarioMapping(scenario.id, {
        expectedScenarioRevision: scenario.revision,
        businessTemplateVersionId: mappingForm.businessTemplateVersionId,
        reason,
        priority: mappingForm.priority
      });
    }
  }, "模板映射已保存。");
  if (!saved) return;
  mappingDialogVisible.value = false;
  clearMappingForm();
}

async function toggleScenario(row: ContractScenarioGovernanceRow) {
  if (!assertCanGovern()) return;
  await runMutation(
    () => updateContractBusinessScenario(row.id, {
      expectedRevision: row.revision,
      active: !row.active
    }),
    row.active ? "业务场景已停用。" : "业务场景已启用。"
  );
}

async function toggleMapping(row: ContractScenarioGovernanceMapping) {
  if (!assertCanGovern()) return;
  await runMutation(
    () => updateContractScenarioMapping(row.id, {
      expectedRevision: row.revision,
      active: !row.active
    }),
    row.active ? "模板映射已停用。" : "模板映射已启用。"
  );
}

async function runMutation(task: () => Promise<unknown>, success: string) {
  saving.value = true;
  message.value = "";
  try {
    await task();
    if (!(await loadGovernance())) return false;
    message.value = success;
    messageTone.value = "success";
    return true;
  } catch (error) {
    showError(error instanceof Error ? error.message : "业务场景治理操作失败。");
    return false;
  } finally {
    saving.value = false;
  }
}

function mappingTemplateLabel(row: ContractScenarioGovernanceMapping) {
  const template = publishedTemplates.value.find(
    (item) => item.versionId === row.businessTemplateVersionId
  );
  return template ? `${template.name}·V${template.versionNo}` : "已配置的历史精确版本";
}

function clearScenarioForm() {
  editingScenarioId.value = "";
  scenarioForm.code = "";
  scenarioForm.name = "";
  scenarioForm.description = "";
}

function clearMappingForm() {
  editingMappingId.value = "";
  mappingForm.businessTemplateVersionId = "";
  mappingForm.reason = "";
  mappingForm.priority = 0;
}

function showError(value: string) {
  message.value = value;
  messageTone.value = "error";
}

function assertCanGovern() {
  if (canGovern.value) return true;
  showError("当前会话已无合同业务场景治理权限，请重新登录后重试。");
  return false;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.scenario-page,
.mapping-section {
  display: grid;
  gap: var(--jg-space-lg);
  width: 100%;
  min-width: 0;
}

.page-head,
.mapping-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.page-head h1,
.mapping-head h2,
.page-head p,
.mapping-head p {
  margin: 0;
}

.page-head h1 {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
}

.mapping-head h2 {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.page-head p,
.mapping-head p,
.name-cell span {
  margin-top: var(--jg-space-xs);
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.message {
  margin-bottom: var(--jg-space-sm);
}

.mapping-section {
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.name-cell,
.dialog-form {
  display: grid;
  gap: var(--jg-space-sm);
}

.table-actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
}

.reason-cell {
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (max-width: 1100px) {
  .page-head,
  .mapping-head {
    flex-direction: column;
  }
}
</style>
