<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>合同编号规则</h1>
        <p>编号格式支持公司、项目、年份、类型、流水号；规则可停用，不提供删除或回退序号</p>
      </div>
      <t-button @click="loadRules">
        刷新
      </t-button>
    </div>

    <t-card
      title="维护规则"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>编辑状态</span><t-input
          :value="form.ruleId ? '正在编辑已有规则' : '新建规则'"
          readonly
        /></label>
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>编号格式</span><t-input v-model="form.pattern" /></label>
        <label><span>流水号位数</span><t-input v-model.number="form.sequenceWidth" /></label>
        <label><span>适用公司主体</span><t-input
          v-model="form.companyEntityId"
          placeholder="留空代表全部公司"
        /></label>
        <label><span>适用项目</span><t-input
          v-model="form.projectId"
          placeholder="留空代表全部项目"
        /></label>
        <label><span>适用合同类型</span><t-select v-model="form.contractTypeKey">
          <t-option
            value=""
            label="全部类型"
          />
          <t-option
            v-for="option in contractTypeOptions"
            :key="option.value"
            :value="option.value"
            :label="option.label"
          />
        </t-select></label>
      </div>
      <div class="token-list">
        <t-button
          v-for="token in numberRuleTokenOptions"
          :key="token.value"
          size="small"
          variant="outline"
          @click="appendToken(token.value)"
        >
          {{ token.label }}
        </t-button>
      </div>
      <p :class="['preview', patternValid ? 'success' : 'danger']">
        下一编号预览：{{ nextPreview }}
      </p>
      <t-space>
        <t-button
          theme="primary"
          :disabled="!patternValid"
          @click="saveRule"
        >
          保存
        </t-button>
        <t-button
          theme="danger"
          variant="outline"
          :disabled="!form.ruleId"
          @click="stopRule"
        >
          停用
        </t-button>
      </t-space>
    </t-card>

    <t-card
      :bordered="true"
      class="panel"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="rules"
        :loading="loading"
        empty="暂无编号规则"
      >
        <template #pattern="{ row }">
          {{ displayContractNumberPattern(row.pattern) }}
        </template>
        <template #companyEntityId="{ row }">
          {{ scopeLabel(row.companyEntityId) }}
        </template>
        <template #projectId="{ row }">
          {{ scopeLabel(row.projectId) }}
        </template>
        <template #contractTypeKey="{ row }">
          {{ row.contractTypeKey ? contractTypeLabel(row.contractTypeKey) : "全部类型" }}
        </template>
        <template #next="{ row }">
          {{ previewContractNumber(row.pattern, row.nextSequence ?? 1, row.sequenceWidth ?? 3) }}
        </template>
        <template #isActive="{ row }">
          <t-tag
            size="small"
            :theme="row.isActive ? 'success' : 'default'"
            variant="light"
          >
            {{ row.isActive ? "启用" : "停用" }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="fill(row)"
          >
            编辑
          </t-link>
        </template>
      </t-table>
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
import { computed, onMounted, reactive, ref } from "vue";
import {
  createContractNumberRule,
  listContractNumberRules,
  stopContractNumberRule,
  updateContractNumberRule
} from "../../api/contract-workbench.api";
import { contractTypeLabel } from "../contracts/contract-labels";
import {
  contractTypeOptions,
  displayContractNumberPattern,
  hasOnlyAllowedNumberRuleTokens,
  isValidContractNumberPattern,
  normalizeContractNumberPattern,
  numberRuleTokenOptions,
  previewContractNumber
} from "./contract-template.config";

interface RuleRow {
  id: string;
  name: string;
  pattern: string;
  companyEntityId?: string | null;
  projectId?: string | null;
  contractTypeKey?: string | null;
  nextSequence?: number;
  sequenceWidth?: number;
  isActive?: boolean;
}

const columns = [
  { colKey: "name", title: "名称", minWidth: 160 },
  { colKey: "pattern", title: "编号格式", minWidth: 220 },
  { colKey: "companyEntityId", title: "适用公司", width: 130 },
  { colKey: "projectId", title: "适用项目", width: 130 },
  { colKey: "contractTypeKey", title: "适用类型", width: 130 },
  { colKey: "next", title: "下一编号", minWidth: 160 },
  { colKey: "isActive", title: "状态", width: 90 },
  { colKey: "operation", title: "操作", width: 90 }
];

const rules = ref<RuleRow[]>([]);
const loading = ref(false);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const form = reactive({
  ruleId: "",
  name: "",
  pattern: "合同-{公司}-{项目}-{年份}-{类型}-{流水号}",
  sequenceWidth: 3,
  companyEntityId: "",
  projectId: "",
  contractTypeKey: ""
});

const patternValid = computed(() => isValidContractNumberPattern(form.pattern));
const nextPreview = computed(() =>
  patternValid.value
    ? previewContractNumber(form.pattern, 1, Number(form.sequenceWidth) || 3)
    : hasOnlyAllowedNumberRuleTokens(form.pattern) ? "必须包含流水号" : "包含不允许的占位符"
);

function payload() {
  return {
    name: form.name.trim(),
    pattern: normalizeContractNumberPattern(form.pattern.trim()),
    sequenceWidth: Number(form.sequenceWidth) || 3,
    companyEntityId: form.companyEntityId.trim() || undefined,
    projectId: form.projectId.trim() || undefined,
    contractTypeKey: form.contractTypeKey.trim() || undefined
  };
}

function fill(row: RuleRow) {
  form.ruleId = row.id;
  form.name = row.name;
  form.pattern = displayContractNumberPattern(row.pattern);
  form.sequenceWidth = row.sequenceWidth ?? 3;
  form.companyEntityId = row.companyEntityId ?? "";
  form.projectId = row.projectId ?? "";
  form.contractTypeKey = row.contractTypeKey ?? "";
}

function appendToken(token: string) {
  form.pattern = `${form.pattern}${token}`;
}

function scopeLabel(value?: string | null) {
  return value ? "指定范围" : "全部";
}

async function loadRules() {
  loading.value = true;
  try {
    rules.value = (await listContractNumberRules()) as RuleRow[];
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载规则失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function saveRule() {
  try {
    if (form.ruleId.trim()) {
      await updateContractNumberRule(form.ruleId.trim(), payload());
    } else {
      await createContractNumberRule(payload());
    }
    message.value = "编号规则已保存";
    tone.value = "success";
    await loadRules();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "保存失败";
    tone.value = "danger";
  }
}

async function stopRule() {
  try {
    await stopContractNumberRule(form.ruleId.trim());
    message.value = "编号规则已停用";
    tone.value = "success";
    await loadRules();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "停用失败";
    tone.value = "danger";
  }
}

onMounted(loadRules);
</script>

<style scoped>
.page { color: var(--jg-text-strong); }
.page-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  margin-bottom: var(--jg-space-lg);
}
.page-head h1 {
  margin: 0 0 var(--jg-space-sm);
  font-size: var(--jg-font-size-page-title);
  line-height: var(--jg-line-height-tight);
}
.page-head p, label span { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-size-meta); }
.panel { margin-bottom: var(--jg-space-lg); border-radius: var(--jg-radius-sm); }
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-form-field-min-width-compact), 1fr));
  gap: var(--jg-space-md);
  margin-bottom: var(--jg-space-md);
}
label { display: grid; gap: var(--jg-space-xs); }
.token-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  margin-bottom: var(--jg-space-md);
}
.preview, .message { font-size: var(--jg-font-size-meta); }
.success { color: var(--jg-success); }
.danger { color: var(--jg-danger); }
</style>
