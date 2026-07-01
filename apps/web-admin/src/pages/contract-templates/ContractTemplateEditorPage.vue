<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>{{ templateName }}</h1>
        <p>后端详情当前只返回模板主表；版本 ID 需来自创建/克隆/审批返回结果后再维护</p>
      </div>
      <t-space>
        <t-button @click="action('clone')">
          克隆
        </t-button>
        <t-button @click="action('submit')">
          提交
        </t-button>
        <t-button
          theme="primary"
          @click="action('publish')"
        >
          发布
        </t-button>
        <t-button
          theme="danger"
          variant="outline"
          @click="action('stop')"
        >
          停用
        </t-button>
        <t-button
          variant="outline"
          @click="action('revoke')"
        >
          撤销
        </t-button>
      </t-space>
    </div>

    <t-card
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>当前版本 ID</span><t-input
          v-model="versionId"
          placeholder="后端暂未返回版本列表，请粘贴版本 ID"
        /></label>
        <label><span>变更摘要</span><t-input v-model="changeSummary" /></label>
        <label><span>模板状态</span><t-input
          :value="template?.status ? templateStatusLabel(String(template.status)) : '后端未返回'"
          readonly
        /></label>
        <t-button
          theme="primary"
          :disabled="!versionId"
          @click="saveVersion"
        >
          保存草稿版本
        </t-button>
      </div>
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
      class="panel"
    >
      <div
        v-for="(field, index) in schema.fields"
        :key="String(field.key)"
        class="row-editor"
      >
        <t-input
          v-model="field.key"
          placeholder="key"
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
          placeholder="选项：A=1,B=2"
        />
        <t-input
          v-model="field.visibleWhenFieldKey"
          placeholder="可见条件字段"
        />
        <t-input
          v-model="field.visibleWhenValue"
          placeholder="eq 值"
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
      <t-button @click="addField">
        新增字段
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'bills'"
      title="清单"
      :bordered="true"
      class="panel"
    >
      <div
        v-for="(bill, index) in schema.bills"
        :key="String(bill.key)"
        class="row-editor"
      >
        <t-input
          v-model="bill.key"
          placeholder="key"
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
          placeholder="列：spec:规格:text,brand:品牌:text"
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
      <t-button @click="addBill">
        新增清单
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'clauses'"
      title="条款块"
      :bordered="true"
      class="panel"
    >
      <div
        v-for="(clause, index) in schema.clauses"
        :key="String(clause.key)"
        class="row-editor"
      >
        <t-input
          v-model="clause.key"
          placeholder="key"
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
          placeholder="标准条款版本 ID"
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
      <t-button @click="addClause">
        新增条款
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'attachments'"
      title="附件要求"
      :bordered="true"
      class="panel"
    >
      <div
        v-for="(attachment, index) in schema.attachments"
        :key="String(attachment.key)"
        class="row-editor"
      >
        <t-input
          v-model="attachment.key"
          placeholder="key"
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
      <t-button @click="addAttachment">
        新增附件
      </t-button>
    </t-card>

    <t-card
      v-if="activeTab === 'validations'"
      title="校验规则"
      :bordered="true"
      class="panel"
    >
      <div
        v-for="(rule, index) in schema.validations"
        :key="String(rule.key)"
        class="row-editor"
      >
        <t-input
          v-model="rule.key"
          placeholder="key"
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
          placeholder="目标条款 key"
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
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import {
  cloneContractTemplateVersion,
  getContractTemplate,
  publishContractTemplateVersion,
  revokeContractTemplateVersion,
  stopContractTemplateVersion,
  submitContractTemplateVersion,
  updateContractTemplateVersion
} from "../../api/contract-workbench.api";
import { templateStatusLabel } from "../contracts/contract-labels";
import {
  billAmountRoleOptions,
  fieldTypeOptions,
  pricingModeOptions,
  quantityScaleOptions,
  unitPriceScaleOptions
} from "./contract-template.config";

type TabKey = "fields" | "bills" | "clauses" | "attachments" | "validations";
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "fields", label: "字段" },
  { key: "bills", label: "清单" },
  { key: "clauses", label: "条款" },
  { key: "attachments", label: "附件" },
  { key: "validations", label: "校验" }
];

const route = useRoute();
const template = ref<Record<string, unknown> | null>(null);
const templateName = ref("业务模板编辑器");
const versionId = ref("");
const changeSummary = ref("");
const activeTab = ref<TabKey>("fields");
const message = ref("");
const tone = ref<"success" | "danger">("success");

const schema = reactive({
  fields: [] as Array<Record<string, unknown>>,
  bills: [] as Array<Record<string, unknown>>,
  clauses: [] as Array<Record<string, unknown>>,
  attachments: [] as Array<Record<string, unknown>>,
  validations: [] as Array<Record<string, unknown>>
});

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
    columnsText: "itemName:项目:text,unit:单位:text"
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
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [key, label, type = "text"] = item.split(":");
      return { key, label: label ?? key, type };
    });
}

function buildSchema() {
  return {
    fields: schema.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      options: optionTextToOptions(field.optionsText),
      visibleWhen: field.visibleWhenFieldKey
        ? { fieldKey: field.visibleWhenFieldKey, operator: "eq", value: field.visibleWhenValue }
        : undefined
    })),
    bills: schema.bills.map((bill) => ({
      key: bill.key,
      name: bill.name,
      amountRole: bill.amountRole,
      pricingMode: bill.pricingMode,
      quantityScale: Number(bill.quantityScale),
      unitPriceScale: Number(bill.unitPriceScale),
      columns: columnsTextToColumns(bill.columnsText)
    })),
    clauses: schema.clauses.map((clause) => ({
      key: clause.key,
      title: clause.title,
      numberingMode: clause.numberingMode,
      required: Boolean(clause.required),
      standardClauseVersionId: clause.standardClauseVersionId || undefined,
      content: { text: clause.text ?? "" }
    })),
    attachments: schema.attachments.map((attachment) => ({
      key: attachment.key,
      name: attachment.name,
      required: Boolean(attachment.required),
      mustBeValid: Boolean(attachment.mustBeValid)
    })),
    validations: schema.validations.map((rule) => ({
      key: rule.key,
      level: rule.level,
      targetClauseKey: rule.targetClauseKey,
      requiredPhrases: String(rule.requiredPhrasesText ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      message: rule.message
    }))
  };
}

async function saveVersion() {
  try {
    await updateContractTemplateVersion(versionId.value.trim(), {
      schema: buildSchema(),
      changeSummary: changeSummary.value.trim() || undefined
    });
    message.value = "草稿版本已保存";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "保存失败";
    tone.value = "danger";
  }
}

async function action(kind: "clone" | "submit" | "publish" | "stop" | "revoke") {
  const id = versionId.value.trim();
  if (!id) {
    message.value = "请先填写版本 ID";
    tone.value = "danger";
    return;
  }
  try {
    if (kind === "clone") await cloneContractTemplateVersion(id);
    if (kind === "submit") await submitContractTemplateVersion(id);
    if (kind === "publish") await publishContractTemplateVersion(id, { changeSummary: changeSummary.value.trim() || "发布" });
    if (kind === "stop") await stopContractTemplateVersion(id);
    if (kind === "revoke") await revokeContractTemplateVersion(id);
    message.value = "操作已提交";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "操作失败";
    tone.value = "danger";
  }
}

onMounted(async () => {
  const templateId = String(route.params.templateId);
  const queryVersionId = Array.isArray(route.query.versionId)
    ? route.query.versionId[0]
    : route.query.versionId;
  versionId.value = String(queryVersionId ?? "");
  try {
    template.value = (await getContractTemplate(templateId)) as Record<string, unknown>;
    templateName.value = String(template.value.name ?? "业务模板编辑器");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载模板失败";
    tone.value = "danger";
  }
});
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: 1.5fr 1.5fr 1fr auto; gap: 12px; align-items: end; }
label { display: grid; gap: 4px; }
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-bar button { border: 1px solid #dce1e8; background: #fff; padding: 7px 12px; border-radius: 3px; cursor: pointer; }
.tab-bar button.active { border-color: #0052d9; color: #0052d9; }
.row-editor { display: grid; grid-template-columns: repeat(10, minmax(80px, 1fr)); gap: 8px; align-items: center; margin-bottom: 10px; }
.row-editor select { height: 32px; border: 1px solid #dcdfe6; border-radius: 3px; }
.inline { display: flex; align-items: center; gap: 4px; color: #424955; font-size: 12px; }
.message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@media (max-width: 1100px) { .page-head, .form-grid, .row-editor { display: grid; grid-template-columns: 1fr; } }
</style>
