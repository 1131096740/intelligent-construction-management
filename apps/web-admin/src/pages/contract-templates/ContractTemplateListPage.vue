<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>模板中心</h1>
        <p>业务模板、版式、标准条款和编号规则统一维护</p>
      </div>
      <t-space>
        <t-button @click="go('/contract-layout-templates/new')">
          版式模板
        </t-button>
        <t-button @click="go('/standard-clauses')">
          标准条款
        </t-button>
        <t-button @click="go('/contract-number-rules')">
          编号规则
        </t-button>
      </t-space>
    </div>

    <t-card
      title="新建业务模板"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>编码</span><t-input v-model="form.code" /></label>
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>合同类型</span><t-input v-model="form.contractTypeKey" /></label>
        <t-button
          theme="primary"
          :loading="saving"
          @click="createTemplate"
        >
          创建草稿版本
        </t-button>
      </div>
    </t-card>

    <t-card
      :bordered="true"
      class="panel"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="templates"
        :loading="loading"
        empty="暂无已发布业务模板；后端当前列表只返回已有 published version 的模板主表"
      >
        <template #status="{ row }">
          <t-tag
            size="small"
            variant="light"
          >
            {{ templateStatusLabel(row.status) }}
          </t-tag>
        </template>
        <template #contractTypeKey="{ row }">
          {{ contractTypeLabel(row.contractTypeKey) }}
        </template>
        <template #latestVersion="{ row }">
          {{ row.versionNo ? `v${row.versionNo}` : "后端未返回" }}
        </template>
        <template #publishedBy="{ row }">
          {{ row.publishedByUserId ?? "后端未返回" }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="go(`/contract-templates/${row.id}`)"
          >
            编辑/治理
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
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createContractTemplate,
  listPublishedContractTemplates
} from "../../api/contract-workbench.api";
import { contractTypeLabel, templateStatusLabel } from "../contracts/contract-labels";
import { templateListColumns } from "./contract-template.config";

interface TemplateRow {
  id: string;
  status?: string;
  contractTypeKey?: string;
  versionNo?: number;
  publishedByUserId?: string;
  [key: string]: unknown;
}

const router = useRouter();
const columns = templateListColumns.map((column) => ({ ...column }));
const templates = ref<TemplateRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const emptySchema = { fields: [], bills: [], clauses: [], attachments: [], validations: [] };
const form = reactive({ code: "", name: "", contractTypeKey: "" });

function go(path: string) {
  void router.push(path);
}

async function loadTemplates() {
  loading.value = true;
  try {
    templates.value = (await listPublishedContractTemplates()) as TemplateRow[];
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载模板失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function createTemplate() {
  saving.value = true;
  try {
    const created = await createContractTemplate({
      code: form.code.trim(),
      name: form.name.trim(),
      contractTypeKey: form.contractTypeKey.trim(),
      schema: emptySchema
    });
    const templateId = (created as { template?: { id?: string } }).template?.id;
    const versionId = (created as { version?: { id?: string } }).version?.id;
    message.value = versionId ? `业务模板草稿已创建，版本 ID：${versionId}` : "业务模板草稿已创建";
    tone.value = "success";
    if (templateId) {
      void router.push({
        path: `/contract-templates/${templateId}`,
        query: versionId ? { versionId } : undefined
      });
    }
    await loadTemplates();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建模板失败";
    tone.value = "danger";
  } finally {
    saving.value = false;
  }
}

onMounted(loadTemplates);
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 12px; align-items: end; }
label { display: grid; gap: 4px; }
label span { color: #767f8d; font-size: 12px; font-weight: 600; }
.message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@media (max-width: 900px) { .page-head, .form-grid { display: grid; grid-template-columns: 1fr; } }
</style>
