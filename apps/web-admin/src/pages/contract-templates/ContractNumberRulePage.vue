<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>合同编号规则</h1>
        <p>仅允许 {company} {project} {year} {type} {sequence}；规则可停用，不提供删除/回退序号</p>
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
        <label><span>规则 ID（更新时填写）</span><t-input v-model="form.ruleId" /></label>
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>Pattern</span><t-input v-model="form.pattern" /></label>
        <label><span>Sequence width</span><t-input v-model.number="form.sequenceWidth" /></label>
        <label><span>公司主体 Scope</span><t-input v-model="form.companyEntityId" /></label>
        <label><span>项目 Scope</span><t-input v-model="form.projectId" /></label>
        <label><span>合同类型 Scope</span><t-input v-model="form.contractTypeKey" /></label>
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
import {
  hasOnlyAllowedNumberRuleTokens,
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
  { colKey: "pattern", title: "Pattern", minWidth: 220 },
  { colKey: "companyEntityId", title: "公司 Scope", width: 130 },
  { colKey: "projectId", title: "项目 Scope", width: 130 },
  { colKey: "contractTypeKey", title: "类型 Scope", width: 130 },
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
  pattern: "HT-{company}-{project}-{year}-{type}-{sequence}",
  sequenceWidth: 3,
  companyEntityId: "",
  projectId: "",
  contractTypeKey: ""
});

const patternValid = computed(() => hasOnlyAllowedNumberRuleTokens(form.pattern));
const nextPreview = computed(() =>
  patternValid.value
    ? previewContractNumber(form.pattern, 1, Number(form.sequenceWidth) || 3)
    : "包含不允许的占位符"
);

function payload() {
  return {
    name: form.name.trim(),
    pattern: form.pattern.trim(),
    sequenceWidth: Number(form.sequenceWidth) || 3,
    companyEntityId: form.companyEntityId.trim() || undefined,
    projectId: form.projectId.trim() || undefined,
    contractTypeKey: form.contractTypeKey.trim() || undefined
  };
}

function fill(row: RuleRow) {
  form.ruleId = row.id;
  form.name = row.name;
  form.pattern = row.pattern;
  form.sequenceWidth = row.sequenceWidth ?? 3;
  form.companyEntityId = row.companyEntityId ?? "";
  form.projectId = row.projectId ?? "";
  form.contractTypeKey = row.contractTypeKey ?? "";
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
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; margin-bottom: 12px; }
label { display: grid; gap: 4px; }
.preview, .message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@media (max-width: 900px) { .page-head, .form-grid { display: grid; grid-template-columns: 1fr; } }
</style>
