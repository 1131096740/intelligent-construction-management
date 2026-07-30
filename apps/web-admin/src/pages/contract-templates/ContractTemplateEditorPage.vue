<template>
  <section class="page jg-responsive-workspace">
    <div class="page-head">
      <div>
        <h1>{{ templateName }}</h1>
        <p>维护字段、条款、清单、附件与版本治理状态</p>
      </div>
      <t-space>
        <t-button
          v-if="governance.canClone"
          :loading="submitting"
          @click="cloneVersion"
        >
          克隆为新草稿
        </t-button>
        <t-button
          v-if="governance.canSubmit"
          :loading="submitting"
          :disabled="isDirty"
          @click="submitVersion"
        >
          提交
        </t-button>
        <t-button
          v-if="governance.canPublish"
          theme="primary"
          :loading="submitting"
          @click="publishVersion"
        >
          发布
        </t-button>
        <t-button
          v-if="riskStopCandidateAction"
          theme="danger"
          variant="outline"
          :disabled="!riskStopCandidateAction.enabled || submitting"
          :title="riskStopCandidateAction.disabledReason ?? undefined"
          @click="openRiskStopDialog"
        >
          {{ riskStopCandidateAction.label }}
        </t-button>
      </t-space>
    </div>

    <t-card
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>模板版本</span><t-select
          v-model="selectedVersionId"
          :options="versionOptions"
          :loading="loading"
          @change="selectVersion"
        /></label>
        <label><span>变更摘要</span><t-input
          v-model="changeSummary"
          :disabled="!governance.canSave && !governance.canPublish"
        /></label>
        <label><span>版本状态</span><t-input
          :value="selectedVersion ? businessTemplateStatusLabel(selectedVersion.status) : '暂无状态记录'"
          readonly
        /></label>
        <t-button
          v-if="governance.canSave"
          theme="primary"
          :loading="submitting"
          @click="saveVersion"
        >
          保存草稿版本
        </t-button>
      </div>
      <BusinessDraftAction
        v-if="selectedVersion"
        class="version-lifecycle-action"
        :actions="selectedVersion.availableActions ?? []"
        :blocked-reasons="selectedVersion.blockedReasons ?? []"
        :subject="versionActionSubject"
        :execute="discardSelectedVersion"
        @completed="handleDiscardCompleted"
      />
    </t-card>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <t-card
      v-if="activeTab === 'fields'"
      title="字段"
      :bordered="true"
      :inert="governance.readOnly"
      class="panel"
    >
      <div class="row-editor-list jg-workspace-scroll">
        <div
          v-for="(field, index) in schema.fields"
          :key="String(field.key)"
          class="row-editor jg-workspace-scroll__content--standard"
        >
          <t-input
            v-model="field.key"
            placeholder="字段标识"
          />
          <t-input
            v-model="field.label"
            placeholder="名称"
          />
          <select v-model="field.type">
            <option
              v-for="option in fieldTypeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <label class="inline"><input
            v-model="field.required"
            type="checkbox"
          > 必填</label>
          <t-input
            v-model="field.optionsText"
            placeholder="选项：是=1，否=0"
          />
          <t-input
            v-model="field.visibleWhenFieldKey"
            placeholder="可见条件字段"
          />
          <t-input
            v-model="field.visibleWhenValue"
            placeholder="匹配值"
          />
          <t-button
            size="small"
            @click="move(schema.fields, index, -1)"
          >
            上移
          </t-button>
          <t-button
            size="small"
            @click="move(schema.fields, index, 1)"
          >
            下移
          </t-button>
        </div>
      </div>
      <t-button @click="addField">
        新增字段
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'bills'"
      title="清单"
      :bordered="true"
      :inert="governance.readOnly"
      class="panel"
    >
      <div class="row-editor-list jg-workspace-scroll">
        <div
          v-for="(bill, index) in schema.bills"
          :key="String(bill.key)"
          class="row-editor jg-workspace-scroll__content--standard"
        >
          <t-input
            v-model="bill.key"
            placeholder="清单标识"
          />
          <t-input
            v-model="bill.name"
            placeholder="名称"
          />
          <select v-model="bill.amountRole">
            <option
              v-for="option in billAmountRoleOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <select v-model="bill.pricingMode">
            <option
              v-for="option in pricingModeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <select v-model.number="bill.quantityScale">
            <option
              v-for="scale in quantityScaleOptions"
              :key="scale"
              :value="scale"
            >
              数量 {{ scale }}
            </option>
          </select>
          <select v-model.number="bill.unitPriceScale">
            <option
              v-for="scale in unitPriceScaleOptions"
              :key="scale"
              :value="scale"
            >
              单价 {{ scale }}
            </option>
          </select>
          <t-input
            v-model="bill.columnsText"
            placeholder="列：规格=规格型号，品牌=品牌"
          />
          <t-button
            size="small"
            @click="move(schema.bills, index, -1)"
          >
            上移
          </t-button>
          <t-button
            size="small"
            @click="move(schema.bills, index, 1)"
          >
            下移
          </t-button>
        </div>
      </div>
      <t-button @click="addBill">
        新增清单
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'clauses'"
      title="条款块"
      :bordered="true"
      :inert="governance.readOnly"
      class="panel"
    >
      <div class="row-editor-list jg-workspace-scroll">
        <div
          v-for="(clause, index) in schema.clauses"
          :key="String(clause.key)"
          class="row-editor jg-workspace-scroll__content--standard"
        >
          <t-input
            v-model="clause.key"
            placeholder="条款标识"
          />
          <t-input
            v-model="clause.title"
            placeholder="标题"
          />
          <select v-model="clause.numberingMode">
            <option value="automatic">
              自动编号
            </option><option value="fixed">
              固定编号
            </option>
          </select>
          <label class="inline"><input
            v-model="clause.required"
            type="checkbox"
          > 必填</label>
          <t-input
            v-model="clause.standardClauseVersionId"
            placeholder="标准条款版本编号"
          />
          <t-textarea
            v-model="clause.text"
            placeholder="条款正文"
          />
          <t-button
            size="small"
            @click="move(schema.clauses, index, -1)"
          >
            上移
          </t-button>
          <t-button
            size="small"
            @click="move(schema.clauses, index, 1)"
          >
            下移
          </t-button>
        </div>
      </div>
      <t-button @click="addClause">
        新增条款
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'attachments'"
      title="附件要求"
      :bordered="true"
      :inert="governance.readOnly"
      class="panel"
    >
      <div class="row-editor-list jg-workspace-scroll">
        <div
          v-for="(attachment, index) in schema.attachments"
          :key="String(attachment.key)"
          class="row-editor jg-workspace-scroll__content--standard"
        >
          <t-input
            v-model="attachment.key"
            placeholder="附件标识"
          />
          <t-input
            v-model="attachment.name"
            placeholder="名称"
          />
          <label class="inline"><input
            v-model="attachment.required"
            type="checkbox"
          > 必填</label>
          <label class="inline"><input
            v-model="attachment.mustBeValid"
            type="checkbox"
          > 有效期内</label>
          <t-button
            size="small"
            @click="move(schema.attachments, index, -1)"
          >
            上移
          </t-button>
          <t-button
            size="small"
            @click="move(schema.attachments, index, 1)"
          >
            下移
          </t-button>
        </div>
      </div>
      <t-button @click="addAttachment">
        新增附件
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'validations'"
      title="校验规则"
      :bordered="true"
      :inert="governance.readOnly"
      class="panel"
    >
      <div class="row-editor-list jg-workspace-scroll">
        <div
          v-for="(rule, index) in schema.validations"
          :key="String(rule.key)"
          class="row-editor jg-workspace-scroll__content--standard"
        >
          <t-input
            v-model="rule.key"
            placeholder="规则标识"
          />
          <select v-model="rule.level">
            <option value="block">
              阻断
            </option><option value="warning">
              提醒
            </option>
          </select>
          <t-input
            v-model="rule.targetClauseKey"
            placeholder="目标条款标识"
          />
          <t-input
            v-model="rule.requiredPhrasesText"
            placeholder="必须短语，逗号分隔"
          />
          <t-input
            v-model="rule.message"
            placeholder="提示"
          />
          <t-button
            size="small"
            @click="move(schema.validations, index, -1)"
          >
            上移
          </t-button>
          <t-button
            size="small"
            @click="move(schema.validations, index, 1)"
          >
            下移
          </t-button>
        </div>
      </div>
      <t-button @click="addValidation">
        新增校验
      </t-button>
    </t-card>

    <p
      v-if="message"
      :class="['message', tone]"
    >
      {{ message }}
    </p>

    <SensitiveActionDialog
      v-if="riskStopAction?.enabled"
      v-model="riskStopDialogVisible"
      :title="riskStopAction?.label ?? '风险停用'"
      description="风险停用后，该版本不再用于新合同；既有合同仍按冻结版本读取。"
      confirm-text="确认风险停用"
      confirm-theme="danger"
      :loading="submitting"
      :error="riskStopError"
      @confirm="stopSelectedVersion"
      @cancel="riskStopError = ''"
    />

    <SensitiveActionDialog
      v-model="leaveDialogVisible"
      title="放弃未保存的模板修改？"
      description="继续后会丢弃当前模板版本尚未保存的字段、清单、条款、附件和校验修改。"
      confirm-text="放弃并离开"
      confirm-theme="danger"
      @confirm="resolveLeaveDecision(true)"
      @cancel="resolveLeaveDecision(false)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  cloneContractTemplateVersion,
  discardContractTemplateVersion,
  getContractTemplate,
  publishContractTemplateVersion,
  stopContractTemplateVersion,
  submitContractTemplateVersion,
  type ContractTemplateDetailReadModel,
  type ContractTemplateSchemaPayload,
  type ContractTemplateVersionReadModel,
  updateContractTemplateVersion
} from "../../api/contract-workbench.api";
import { useAuthStore } from "../../auth/auth.store";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import { templateStatusLabel } from "../contracts/contract-labels";
import {
  billAmountRoleOptions,
  contractTemplateVersionGovernance,
  contractTemplateVersionOptions,
  fieldTypeOptions,
  mergeContractTemplateSchemaForSave,
  normalizeContractTemplateDetail,
  pricingModeOptions,
  quantityScaleOptions,
  unitPriceScaleOptions
} from "./contract-template.config";
import {
  canMaintainContractTemplates,
  canPublishContractTemplates
} from "./template-permissions";

type TabKey = "fields" | "bills" | "clauses" | "attachments" | "validations";
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "fields", label: "字段" },
  { key: "bills", label: "清单" },
  { key: "clauses", label: "条款" },
  { key: "attachments", label: "附件" },
  { key: "validations", label: "校验" }
];

const route = useRoute();
const auth = useAuthStore();
const templateRouteId = computed(() => String(route.params.templateId ?? ""));
const contractTemplateCapability = ref<ContractTemplateDetailReadModel | null>(null);
const template = ref<ContractTemplateDetailReadModel["template"] | null>(null);
const versions = ref<ContractTemplateVersionReadModel[]>([]);
const templateName = ref("业务模板编辑器");
const selectedVersionId = ref("");
const lastValidVersionId = ref("");
const changeSummary = ref("");
const activeTab = ref<TabKey>("fields");
const message = ref("");
const tone = ref<"success" | "danger">("success");
const loading = ref(false);
const submitting = ref(false);
const riskStopDialogVisible = ref(false);
const riskStopError = ref("");
const riskStopVersionId = ref("");
const editorBaseline = ref("");
const leaveDialogVisible = ref(false);
let resolvePendingLeave: ((decision: boolean) => void) | null = null;
let templateLoadGeneration = 0;

const selectedVersion = computed(() =>
  versions.value.find((version) => version.id === selectedVersionId.value)
);
const riskStopCandidateAction = computed(() =>
  (contractTemplateCapability.value?.versions
    .find((version) => version.id === selectedVersionId.value)?.availableActions ?? [])
    .find((action) => action.key === "risk_stop") ?? null
);
const riskStopAction = computed(() =>
  (contractTemplateCapability.value?.versions
    .find((version) => version.id === riskStopVersionId.value)?.availableActions ?? [])
    .find((action) => action.key === "risk_stop") ?? null
);
const versionOptions = computed(() => contractTemplateVersionOptions(versions.value));
const canMaintainTemplates = computed(() => canMaintainContractTemplates(auth.user?.roleKeys));
const canPublishTemplates = computed(() => canPublishContractTemplates(auth.user?.roleKeys));
const governance = computed(() => {
  const statusGovernance = contractTemplateVersionGovernance(selectedVersion.value);
  return {
    readOnly: statusGovernance.readOnly || !canMaintainTemplates.value,
    canSave: statusGovernance.canSave && canMaintainTemplates.value,
    canSubmit: statusGovernance.canSubmit && canMaintainTemplates.value,
    canPublish: statusGovernance.canPublish && canPublishTemplates.value,
    canClone: statusGovernance.canClone && canMaintainTemplates.value
  };
});
const versionActionSubject = computed(() => ({
  businessCode: template.value?.businessCode ?? template.value?.code ?? "—",
  name: `${templateName.value} V${selectedVersion.value?.versionNo ?? "—"}`,
  lastSavedAt: formatVersionTime(selectedVersion.value?.updatedAt),
  impactScope: "仅废弃当前从未提交的草稿版本；已发布版本和正式引用不受影响。"
}));

const schema = reactive({
  fields: [] as Array<Record<string, unknown>>,
  bills: [] as Array<Record<string, unknown>>,
  clauses: [] as Array<Record<string, unknown>>,
  attachments: [] as Array<Record<string, unknown>>,
  validations: [] as Array<Record<string, unknown>>
});
const isDirty = computed(() =>
  governance.value.canSave && Boolean(editorBaseline.value) && editorSnapshot() !== editorBaseline.value
);
const leaveGuard = useUnsavedChangesGuard({
  isDirty,
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingLeave?.(false);
    resolvePendingLeave = resolve;
    leaveDialogVisible.value = true;
  })
});

function editorSnapshot() {
  return JSON.stringify({ changeSummary: changeSummary.value, schema: buildSchema() });
}

function syncEditorBaseline() {
  editorBaseline.value = editorSnapshot();
}

function resolveLeaveDecision(decision: boolean) {
  leaveDialogVisible.value = false;
  const resolve = resolvePendingLeave;
  resolvePendingLeave = null;
  resolve?.(decision);
}

function move<T>(items: T[], index: number, delta: -1 | 1) {
  const next = index + delta;
  if (next < 0 || next >= items.length) return;
  const [item] = items.splice(index, 1);
  items.splice(next, 0, item);
}

function addField() {
  schema.fields.push({ key: `field_${schema.fields.length + 1}`, label: "", type: "text", required: false });
}

function addBill() {
  schema.bills.push({
    key: `bill_${schema.bills.length + 1}`,
    name: "",
    amountRole: "included",
    pricingMode: "tax_inclusive",
    quantityScale: 2,
    unitPriceScale: 2,
    columnsText: "项目=项目名称，单位=计量单位"
  });
}

function addClause() {
  schema.clauses.push({ key: `clause_${schema.clauses.length + 1}`, title: "", numberingMode: "automatic", required: false, text: "" });
}

function addAttachment() {
  schema.attachments.push({ key: `attachment_${schema.attachments.length + 1}`, name: "", required: false, mustBeValid: false });
}

function addValidation() {
  schema.validations.push({ key: `rule_${schema.validations.length + 1}`, level: "warning", targetClauseKey: "", requiredPhrasesText: "", message: "" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionsToText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .filter(isRecord)
    .map((option) => {
      const label = String(option.label ?? "");
      const optionValue = String(option.value ?? label);
      return label === optionValue ? label : `${label}=${optionValue}`;
    })
    .filter(Boolean)
    .join(",");
}

function columnsToText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .filter(isRecord)
    .map((column) => {
      const key = String(column.key ?? "");
      const label = String(column.label ?? key);
      const type = String(column.type ?? "text");
      return `${key}:${label}:${type}`;
    })
    .filter(Boolean)
    .join("，");
}

function applySchema(value: ContractTemplateSchemaPayload) {
  schema.fields.splice(
    0,
    schema.fields.length,
    ...value.fields.filter(isRecord).map((field) => {
      const visibleWhen = isRecord(field.visibleWhen) ? field.visibleWhen : null;
      return {
        ...field,
        optionsText: optionsToText(field.options),
        visibleWhenFieldKey: visibleWhen?.fieldKey ?? "",
        visibleWhenValue: visibleWhen?.value ?? ""
      };
    })
  );
  schema.bills.splice(
    0,
    schema.bills.length,
    ...value.bills.filter(isRecord).map((bill) => ({
      ...bill,
      columnsText: columnsToText(bill.columns)
    }))
  );
  schema.clauses.splice(
    0,
    schema.clauses.length,
    ...value.clauses.filter(isRecord).map((clause) => ({
      ...clause,
      text: isRecord(clause.content) ? clause.content.text ?? "" : ""
    }))
  );
  schema.attachments.splice(
    0,
    schema.attachments.length,
    ...value.attachments.filter(isRecord)
  );
  schema.validations.splice(
    0,
    schema.validations.length,
    ...value.validations.filter(isRecord).map((rule) => ({
      ...rule,
      requiredPhrasesText: Array.isArray(rule.requiredPhrases)
        ? rule.requiredPhrases.join(",")
        : ""
    }))
  );
}

function applyVersion(version: ContractTemplateVersionReadModel) {
  selectedVersionId.value = version.id;
  lastValidVersionId.value = version.id;
  changeSummary.value = version.changeSummary ?? "";
  applySchema(version.schema);
  syncEditorBaseline();
}

async function selectVersion(value: unknown) {
  const id = typeof value === "string" ? value : "";
  const version = versions.value.find((item) => item.id === id);
  if (!version) {
    selectedVersionId.value = lastValidVersionId.value;
    message.value = "模板版本不存在，请刷新后重试";
    tone.value = "danger";
    return;
  }
  if (!(await leaveGuard.requestClose())) {
    selectedVersionId.value = lastValidVersionId.value;
    return;
  }
  applyVersion(version);
  message.value = "";
}

async function loadTemplate(preferredVersionId?: string) {
  const templateId = templateRouteId.value;
  const generation = ++templateLoadGeneration;
  const serverDetail = await getContractTemplate(templateId, true);
  if (
    generation !== templateLoadGeneration ||
    templateRouteId.value !== templateId
  ) {
    return false;
  }
  contractTemplateCapability.value = serverDetail;
  const detail = normalizeContractTemplateDetail(
    structuredClone(serverDetail)
  );
  const targetId = preferredVersionId ?? detail.defaultVersionId;
  const version = detail.versions.find((item) => item.id === targetId);
  if (!version) {
    throw new Error("模板版本不存在，请刷新后重试");
  }
  template.value = detail.template;
  versions.value = detail.versions;
  templateName.value = detail.template.businessCode ?? detail.template.name;
  applyVersion(version);
  return true;
}

function clearTemplateRouteContext() {
  templateLoadGeneration += 1;
  contractTemplateCapability.value = null;
  template.value = null;
  versions.value = [];
  selectedVersionId.value = "";
  lastValidVersionId.value = "";
  riskStopDialogVisible.value = false;
  riskStopError.value = "";
  riskStopVersionId.value = "";
  message.value = "";
  editorBaseline.value = "";
  changeSummary.value = "";
  schema.fields = [];
  schema.bills = [];
  schema.clauses = [];
  schema.attachments = [];
  schema.validations = [];
}

async function loadTemplateRoute() {
  const expectedTemplateId = templateRouteId.value;
  loading.value = true;
  try {
    await loadTemplate();
  } catch (error) {
    if (templateRouteId.value === expectedTemplateId) {
      message.value = error instanceof Error ? error.message : "加载模板失败";
      tone.value = "danger";
    }
  } finally {
    if (templateRouteId.value === expectedTemplateId) {
      loading.value = false;
    }
  }
}

function formatVersionTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

function businessTemplateStatusLabel(status: string) {
  return status === "discarded" ? "已废弃" : templateStatusLabel(status);
}

async function discardSelectedVersion(request: BusinessDraftActionRequest) {
  const version = selectedVersion.value;
  if (!version || request.action !== "discard_version") {
    throw new Error("当前模板版本不支持该操作，请刷新后重试");
  }
  if (!version.updatedAt) {
    throw new Error("模板版本更新时间缺失，请刷新后重试");
  }
  await discardContractTemplateVersion(version.id, {
    reason: request.reason,
    expectedUpdatedAt: version.updatedAt
  });
  await loadTemplate(version.id);
}

function handleDiscardCompleted() {
  message.value = "草稿版本已废弃，已提交、发布和引用记录均未改变";
  tone.value = "success";
}

function openRiskStopDialog() {
  const version = selectedVersion.value;
  if (!version || !riskStopCandidateAction.value?.enabled || submitting.value) return;
  riskStopVersionId.value = version.id;
  riskStopError.value = "";
  riskStopDialogVisible.value = true;
}

function completeRiskStop() {
  riskStopDialogVisible.value = false;
  message.value = "模板版本已风险停用，新合同不再使用该版本";
  tone.value = "success";
  return loadTemplate(riskStopVersionId.value);
}

function failRiskStop(error: unknown) {
  riskStopError.value = error instanceof Error ? error.message : "风险停用失败";
}

function finishRiskStop() {
  submitting.value = false;
}

function stopSelectedVersion() {
  submitting.value = true;
  riskStopError.value = "";
  return stopContractTemplateVersion(riskStopVersionId.value)
    .then(completeRiskStop)
    .catch(failRiskStop)
    .finally(finishRiskStop);
}

function requireVersion(action: keyof Omit<ReturnType<typeof contractTemplateVersionGovernance>, "readOnly">) {
  const version = selectedVersion.value;
  if (!version || !governance.value[action]) {
    throw new Error("当前模板版本状态不允许此操作，请刷新后重试");
  }
  return version;
}

function optionTextToOptions(value: unknown) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [label, rawValue] = item.split("=");
      return { label, value: rawValue ?? label };
    });
}

function columnsTextToColumns(value: unknown) {
  const usedKeys = new Set<string>();
  return String(value ?? "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const column = parseColumnText(item, index);
      const key = ensureUniqueColumnKey(column.key, usedKeys, index);
      usedKeys.add(key);
      return { ...column, key };
    });
}

function parseColumnText(item: string, index: number) {
  if (item.includes(":")) {
    const [rawKey, rawLabel, type = "text"] = item.split(":").map((part) => part.trim());
    const label = rawLabel || rawKey || `列${index + 1}`;
    return { key: rawKey || columnKeyFromLabel(label, index), label, type: type || "text" };
  }
  const [rawName, rawLabel] = item.split("=").map((part) => part.trim());
  const label = rawLabel || rawName || `列${index + 1}`;
  return { key: columnKeyFromLabel(rawName || label, index), label, type: inferColumnType(label) };
}

function columnKeyFromLabel(label: string, index: number) {
  const normalized = label.replace(/\s+/g, "");
  const knownKeys: Record<string, string> = {
    项目: "itemName",
    项目名称: "itemName",
    名称: "itemName",
    材料名称: "itemName",
    设备名称: "itemName",
    机械名称: "itemName",
    规格: "specification",
    规格型号: "specification",
    型号: "specification",
    单位: "unit",
    计量单位: "unit",
    数量: "quantity",
    工程量: "quantity",
    暂估数量: "quantity",
    单价: "unitPrice",
    含税单价: "unitPrice",
    税率: "taxRatePercent",
    金额: "taxInclusiveAmount",
    含税金额: "taxInclusiveAmount",
    合计: "taxInclusiveAmount",
    价税合计: "taxInclusiveAmount",
    品牌: "brand",
    备注: "remark"
  };
  return knownKeys[normalized] ?? `custom_${index + 1}`;
}

function inferColumnType(label: string) {
  return /数量|工程量|单价|金额|合计|税率/.test(label) ? "number" : "text";
}

function ensureUniqueColumnKey(key: string, usedKeys: Set<string>, index: number) {
  if (!usedKeys.has(key)) return key;
  let candidate = `${key}_${index + 1}`;
  let suffix = index + 2;
  while (usedKeys.has(candidate)) {
    candidate = `${key}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function buildSchema() {
  return {
    fields: schema.fields.map((field) => {
      const { optionsText, visibleWhenFieldKey, visibleWhenValue, ...persisted } = field;
      return {
        ...persisted,
        key: field.key,
        label: field.label,
        type: field.type,
        required: Boolean(field.required),
        options: optionTextToOptions(optionsText),
        visibleWhen: visibleWhenFieldKey
          ? { fieldKey: visibleWhenFieldKey, operator: "eq", value: visibleWhenValue }
          : undefined
      };
    }),
    bills: schema.bills.map((bill) => {
      const { columnsText, ...persisted } = bill;
      return {
        ...persisted,
        key: bill.key,
        name: bill.name,
        amountRole: bill.amountRole,
        pricingMode: bill.pricingMode,
        quantityScale: Number(bill.quantityScale),
        unitPriceScale: Number(bill.unitPriceScale),
        columns: columnsTextToColumns(columnsText)
      };
    }),
    clauses: schema.clauses.map((clause) => {
      const { text, ...persisted } = clause;
      return {
        ...persisted,
        key: clause.key,
        title: clause.title,
        numberingMode: clause.numberingMode,
        required: Boolean(clause.required),
        standardClauseVersionId: clause.standardClauseVersionId || undefined,
        content: {
          ...(isRecord(clause.content) ? clause.content : {}),
          text: text ?? ""
        }
      };
    }),
    attachments: schema.attachments.map((attachment) => ({
      key: attachment.key,
      name: attachment.name,
      required: Boolean(attachment.required),
      mustBeValid: Boolean(attachment.mustBeValid)
    })),
    validations: schema.validations.map((rule) => {
      const { requiredPhrasesText, ...persisted } = rule;
      return {
        ...persisted,
        key: rule.key,
        level: rule.level,
        targetClauseKey: rule.targetClauseKey,
        requiredPhrases: String(requiredPhrasesText ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        message: rule.message
      };
    })
  };
}

async function saveVersion() {
  submitting.value = true;
  try {
    const version = requireVersion("canSave");
    await updateContractTemplateVersion(version.id, {
      schema: mergeContractTemplateSchemaForSave(version.schema, buildSchema()),
      changeSummary: changeSummary.value.trim() || undefined
    });
    await loadTemplate(version.id);
    message.value = "草稿版本已保存";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "保存失败";
    tone.value = "danger";
  } finally {
    submitting.value = false;
  }
}

async function cloneVersion() {
  submitting.value = true;
  try {
    const source = requireVersion("canClone");
    const cloned = await cloneContractTemplateVersion(source.id);
    if (!cloned || typeof cloned.id !== "string" || cloned.status !== "draft") {
      throw new Error("克隆结果不正确，请刷新后重试");
    }
    await loadTemplate(cloned.id);
    if (selectedVersion.value?.status !== "draft") {
      throw new Error("克隆后的草稿版本不存在，请刷新后重试");
    }
    message.value = "已克隆并切换到新草稿版本";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "克隆失败";
    tone.value = "danger";
  } finally {
    submitting.value = false;
  }
}

async function submitVersion() {
  submitting.value = true;
  try {
    const version = requireVersion("canSubmit");
    await submitContractTemplateVersion(version.id);
    await loadTemplate(version.id);
    message.value = "模板版本已提交，等待发布";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "提交失败";
    tone.value = "danger";
  } finally {
    submitting.value = false;
  }
}

async function publishVersion() {
  submitting.value = true;
  try {
    const version = requireVersion("canPublish");
    const summary = changeSummary.value.trim();
    if (!summary) {
      throw new Error("请填写模板发布说明");
    }
    await publishContractTemplateVersion(version.id, { changeSummary: summary });
    await loadTemplate(version.id);
    message.value = "模板版本已发布，后续修改请克隆新草稿";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "发布失败";
    tone.value = "danger";
  } finally {
    submitting.value = false;
  }
}

watch(templateRouteId, () => {
  clearTemplateRouteContext();
  void loadTemplateRoute();
});
onMounted(() => void loadTemplateRoute());
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.version-lifecycle-action { margin-top: var(--jg-space-md); }
.form-grid { display: grid; grid-template-columns: 1.5fr 1.5fr 1fr auto; gap: 12px; align-items: end; }
label { display: grid; gap: 4px; }
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-bar button { border: 1px solid #dce1e8; background: #fff; padding: 7px 12px; border-radius: 3px; cursor: pointer; }
.tab-bar button.active { border-color: #0052d9; color: #0052d9; }
.row-editor-list { margin-bottom: 10px; }
.row-editor { display: grid; grid-template-columns: repeat(10, minmax(80px, 1fr)); gap: 8px; align-items: center; margin-bottom: 10px; }
.row-editor select { height: 32px; border: 1px solid #dcdfe6; border-radius: 3px; }
.inline { display: flex; align-items: center; gap: 4px; color: #424955; font-size: 12px; }
.message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@container jg-page (max-width: 840px) { .page-head, .form-grid { display: grid; grid-template-columns: 1fr; } }
</style>
