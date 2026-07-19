<template>
  <section class="page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>合同模板库</h1>
        <p>合同部经办人维护模板草稿和版式；合同主管负责发布、停用与编号规则</p>
      </div>
      <t-space
        v-if="canMaintainTemplates"
        class="jg-responsive-actions"
      >
        <t-button @click="go('/合同模板库/版式/new')">
          版式模板
        </t-button>
        <t-button @click="go('/合同模板库/标准条款')">
          标准条款
        </t-button>
        <t-button
          v-if="canPublishTemplates"
          @click="go('/合同模板库/编号规则')"
        >
          编号规则
        </t-button>
      </t-space>
    </div>

    <div class="mode-switch">
      <t-button
        :theme="mode === 'use' ? 'primary' : 'default'"
        @click="mode = 'use'"
      >
        使用模式
      </t-button>
      <t-button
        v-if="canMaintainTemplates"
        :theme="mode === 'config' ? 'primary' : 'default'"
        @click="mode = 'config'"
      >
        配置模式
      </t-button>
    </div>

    <section
      v-if="mode === 'use'"
      class="use-mode"
    >
      <div class="mode-note">
        <strong>选择一个已发布模板，新建合同时会自动带入合同类型和模板版本。</strong>
        <span>{{ canMaintainTemplates ? "如果没有合适模板，可在配置模式维护。" : "如果没有合适模板，请联系合同部维护。" }}</span>
      </div>

      <div
        v-if="templates.length"
        class="template-grid"
      >
        <t-card
          v-for="template in templates"
          :key="template.id"
          class="template-card"
          :bordered="true"
        >
          <template #title>
            {{ templateName(template) }}
          </template>
          <t-space
            size="small"
            class="template-meta"
          >
            <t-tag
              size="small"
              theme="success"
              variant="light"
            >
              已发布
            </t-tag>
            <t-tag
              size="small"
              variant="light"
            >
              {{ contractTypeLabel(template.contractTypeKey) }}
            </t-tag>
            <t-tag
              v-if="template.businessCode"
              size="small"
              theme="primary"
              variant="light"
            >
              {{ template.businessCode }}
            </t-tag>
          </t-space>
          <div class="template-card-body">
            <p>{{ versionLabel(template) }}</p>
            <div class="template-card-actions">
              <t-button @click="openPreview(template)">
                预览模板内容
              </t-button>
              <t-button
                theme="primary"
                @click="useTemplate(template)"
              >
                用此模板建合同
              </t-button>
            </div>
          </div>
        </t-card>
      </div>

      <t-empty
        v-else
        description="暂无已发布业务模板"
      />
    </section>

    <template v-else>
      <t-card
        title="配置模式：新建业务模板"
        :bordered="true"
        class="panel"
      >
        <div class="form-grid">
          <label><span>中文业务编号</span><t-input
            v-model="form.businessCode"
            placeholder="如：合同模板-材料采购-V1"
          /></label>
          <label><span>名称</span><t-input v-model="form.name" /></label>
          <label><span>合同类型</span><t-select v-model="form.contractTypeKey">
            <t-option
              v-for="option in contractTypeOptions"
              :key="option.value"
              :value="option.value"
              :label="option.label"
            />
          </t-select></label>
          <label><span>系统稳定键（内部）</span><t-input
            v-model="form.code"
            placeholder="如：TPL-MATERIAL"
          /></label>
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
        class="panel jg-table-region jg-table-region--standard"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="columns"
          :data="templates"
          :loading="loading"
          horizontal-scroll-affixed-bottom
          empty="暂无已发布业务模板"
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
          <template #businessCode="{ row }">
            {{ row.businessCode || "待补充" }}
          </template>
          <template #latestVersion="{ row }">
            {{ row.versionNo ? `v${row.versionNo}` : "暂无发布版本" }}
          </template>
          <template #publicationStatus="{ row }">
            {{ row.versionNo ? "已发布" : "暂无发布记录" }}
          </template>
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="go(`/合同模板库/${row.id}`)"
            >
              编辑/治理
            </t-link>
          </template>
        </t-table>
      </t-card>
    </template>

    <ContractTemplateUsagePreviewDrawer
      :visible="previewVisible"
      :template="selectedPreview"
      :allow-use="true"
      @close="closePreview"
      @use="useTemplate"
    />

    <p
      v-if="message"
      :class="['message', tone]"
    >
      {{ message }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  createContractTemplate,
  listPublishedContractTemplates,
  type PublishedContractTemplateReadModel
} from "../../api/contract-workbench.api";
import { useAuthStore } from "../../auth/auth.store";
import ContractTemplateUsagePreviewDrawer from "../../components/ContractTemplateUsagePreviewDrawer.vue";
import { contractTypeLabel, templateStatusLabel } from "../contracts/contract-labels";
import {
  contractTypeOptions,
  normalizePublishedContractTemplates,
  templateListColumns
} from "./contract-template.config";
import {
  canMaintainContractTemplates,
  canPublishContractTemplates
} from "./template-permissions";

const router = useRouter();
const auth = useAuthStore();
const columns = templateListColumns.map((column) => ({
  ...column,
  ...(column.colKey === "operation" ? { width: 112, fixed: "right" as const } : {})
}));
const templates = ref<PublishedContractTemplateReadModel[]>([]);
const loading = ref(false);
const saving = ref(false);
const previewVisible = ref(false);
const selectedPreview = ref<PublishedContractTemplateReadModel | null>(null);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const mode = ref<"use" | "config">("use");
const emptySchema = { fields: [], bills: [], clauses: [], attachments: [], validations: [] };
const form = reactive({
  code: "",
  businessCode: "",
  name: "",
  contractTypeKey: contractTypeOptions[0]?.value ?? ""
});
const canMaintainTemplates = computed(() => canMaintainContractTemplates(auth.user?.roleKeys));
const canPublishTemplates = computed(() => canPublishContractTemplates(auth.user?.roleKeys));

watch(canMaintainTemplates, (allowed) => {
  if (!allowed) {
    mode.value = "use";
  }
});

function go(path: string) {
  void router.push(path);
}

function templateName(template: PublishedContractTemplateReadModel) {
  return template.name;
}

function versionLabel(template: PublishedContractTemplateReadModel) {
  return `当前发布版本 v${template.versionNo}`;
}

function openPreview(template: PublishedContractTemplateReadModel) {
  selectedPreview.value = template;
  previewVisible.value = true;
}

function closePreview() {
  previewVisible.value = false;
  selectedPreview.value = null;
}

function useTemplate(template: PublishedContractTemplateReadModel) {
  closePreview();
  void router.push({
    path: "/合同工作台",
    query: {
      contractType: template.contractTypeKey,
      templateVersionId: template.versionId
    }
  });
}

async function loadTemplates() {
  loading.value = true;
  try {
    templates.value = normalizePublishedContractTemplates(
      await listPublishedContractTemplates()
    );
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
      businessCode: form.businessCode.trim(),
      name: form.name.trim(),
      contractTypeKey: form.contractTypeKey.trim(),
      schema: emptySchema
    });
    const templateId = (created as { template?: { id?: string } }).template?.id;
    const versionId = (created as { version?: { id?: string } }).version?.id;
    message.value = "业务模板草稿已创建，正在进入编辑页";
    tone.value = "success";
    if (templateId) {
      void router.push({
        path: `/合同模板库/${templateId}`,
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
.page-head p { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-size-meta); }
.mode-switch {
  display: flex;
  gap: var(--jg-space-sm);
  margin-bottom: var(--jg-space-lg);
}
.use-mode { display: grid; gap: var(--jg-space-lg); }
.mode-note {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  color: var(--jg-text-main);
  background: var(--jg-bg-muted);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  font-size: var(--jg-font-size-meta);
}
.mode-note span { color: var(--jg-text-muted); }
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: var(--jg-space-md);
}
.template-card {
  display: grid;
  background: var(--jg-color-bg-panel);
  border-color: var(--jg-color-border);
  border-radius: var(--jg-radius-md);
}
.template-card :deep(.t-card__header) { padding-bottom: var(--jg-space-sm); }
.template-card :deep(.t-card__body) {
  display: grid;
  gap: var(--jg-space-md);
  padding-top: 0;
}
.template-card :deep(.t-card__actions) {
  padding-top: 0;
  border-top: 0;
}
.template-card-body p { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-size-meta); }
.template-card-actions { display: grid; gap: var(--jg-space-sm); }
.template-card-actions :deep(.t-button) { box-sizing: border-box; justify-content: center; max-width: 100%; width: 100%; }
.template-meta { color: var(--jg-text-main); }
.panel { margin-bottom: var(--jg-space-lg); border-radius: var(--jg-radius-sm); }
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-form-field-min-width-wide), 1fr));
  gap: var(--jg-space-md);
  align-items: end;
}
label { display: grid; gap: var(--jg-space-xs); }
label span { color: var(--jg-text-muted); font-size: var(--jg-font-size-meta); font-weight: 600; }
.message { font-size: var(--jg-font-size-meta); }
.success { color: var(--jg-success); }
.danger { color: var(--jg-danger); }
</style>
