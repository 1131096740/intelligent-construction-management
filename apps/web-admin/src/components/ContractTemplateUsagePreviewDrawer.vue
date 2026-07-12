<template>
  <t-drawer
    :visible="visible"
    header="业务结构预览（非合同正文/版式 PDF）"
    size="large"
    :footer="false"
    @close="emit('close')"
  >
    <div
      v-if="template"
      class="usage-preview"
    >
      <t-alert
        theme="info"
        title="这里展示已发布业务模板会带入草稿的结构，不展示 Word 正文或版式 PDF。"
        :close="false"
      />

      <header class="preview-head">
        <div>
          <h3>{{ template.name }}</h3>
          <p>{{ contractTypeName(template.contractTypeKey) }} · 当前发布版本 V{{ template.versionNo }}</p>
        </div>
        <t-tag
          theme="success"
          variant="light"
        >
          已发布
        </t-tag>
      </header>

      <div class="count-grid">
        <div><strong>{{ preview.fields.length }}</strong><span>专业字段</span></div>
        <div><strong>{{ preview.bills.length }}</strong><span>合同清单</span></div>
        <div><strong>{{ preview.clauses.length }}</strong><span>条款章节</span></div>
        <div><strong>{{ preview.attachments.length }}</strong><span>附件要求</span></div>
      </div>

      <t-card
        title="专业字段"
        :bordered="true"
      >
        <div
          v-if="preview.fields.length"
          class="item-list"
        >
          <div
            v-for="(field, index) in preview.fields"
            :key="`field:${index}`"
            class="preview-item"
          >
            <div>
              <strong>{{ field.label }}</strong>
              <span>{{ field.group || "未分组" }}</span>
            </div>
            <t-space size="small">
              <t-tag
                size="small"
                variant="light"
              >
                {{ fieldTypeName(field.type) }}
              </t-tag>
              <t-tag
                v-if="field.required"
                size="small"
                theme="warning"
                variant="light"
              >
                必填
              </t-tag>
              <t-tag
                v-if="field.conditional"
                size="small"
                variant="light"
              >
                条件显示
              </t-tag>
            </t-space>
          </div>
        </div>
        <t-empty
          v-else
          description="该模板未配置专业字段"
        />
      </t-card>

      <t-card
        title="合同清单"
        :bordered="true"
      >
        <div
          v-if="preview.bills.length"
          class="item-list"
        >
          <div
            v-for="(bill, index) in preview.bills"
            :key="`bill:${index}`"
            class="bill-item"
          >
            <div class="preview-item">
              <div>
                <strong>{{ bill.name }}</strong>
                <span>{{ amountRoleName(bill.amountRole) }} · {{ pricingModeName(bill.pricingMode) }}</span>
              </div>
            </div>
            <div class="column-list">
              <t-tag
                v-for="(column, columnIndex) in bill.columns"
                :key="`bill:${index}:column:${columnIndex}`"
                size="small"
                variant="light"
              >
                {{ column.label }} · {{ columnTypeName(column.type) }}{{ column.required ? " · 必填" : "" }}
              </t-tag>
            </div>
          </div>
        </div>
        <t-empty
          v-else
          description="该模板未配置合同清单"
        />
      </t-card>

      <t-card
        title="条款与附件"
        :bordered="true"
      >
        <div class="split-list">
          <div>
            <h4>条款章节</h4>
            <div class="item-list">
              <div
                v-for="(clause, index) in preview.clauses"
                :key="`clause:${index}`"
                class="preview-item"
              >
                <strong>{{ clause.title }}</strong>
                <t-tag
                  v-if="clause.required"
                  size="small"
                  theme="warning"
                  variant="light"
                >
                  必需
                </t-tag>
              </div>
              <span
                v-if="!preview.clauses.length"
                class="empty-text"
              >未配置条款章节</span>
            </div>
          </div>
          <div>
            <h4>附件要求</h4>
            <div class="item-list">
              <div
                v-for="(attachment, index) in preview.attachments"
                :key="`attachment:${index}`"
                class="preview-item"
              >
                <strong>{{ attachment.name }}</strong>
                <span>{{ attachmentRequirement(attachment) }}</span>
              </div>
              <span
                v-if="!preview.attachments.length"
                class="empty-text"
              >未配置附件要求</span>
            </div>
          </div>
        </div>
      </t-card>

      <t-card
        title="提交检查"
        :bordered="true"
      >
        <div
          v-if="preview.validations.length"
          class="item-list"
        >
          <t-alert
            v-for="(validation, index) in preview.validations"
            :key="`validation:${index}`"
            :theme="validation.level === 'block' ? 'error' : 'warning'"
            :title="validation.message"
            :close="false"
          />
        </div>
        <t-empty
          v-else
          description="该模板未配置额外提交检查"
        />
      </t-card>

      <div
        v-if="allowUse"
        class="preview-actions"
      >
        <t-button @click="emit('close')">
          关闭
        </t-button>
        <t-button
          theme="primary"
          @click="emit('use', template)"
        >
          用此模板建合同
        </t-button>
      </div>
    </div>
  </t-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  ContractTemplateUsagePreview,
  PublishedContractTemplateReadModel
} from "../api/contract-workbench.api";
import { contractTypeLabel } from "../pages/contracts/contract-labels";

const props = defineProps<{
  visible: boolean;
  template: PublishedContractTemplateReadModel | null;
  allowUse?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  use: [template: PublishedContractTemplateReadModel];
}>();

const emptyPreview: ContractTemplateUsagePreview = {
  fields: [],
  bills: [],
  clauses: [],
  attachments: [],
  validations: []
};
const preview = computed(() => props.template?.usagePreview ?? emptyPreview);

const fieldTypeLabels: Record<ContractTemplateUsagePreview["fields"][number]["type"], string> = {
  text: "文本",
  long_text: "长文本",
  number: "数字",
  money: "金额",
  date: "日期",
  single_select: "单选",
  multi_select: "多选",
  boolean: "是/否"
};
const amountRoleLabels: Record<ContractTemplateUsagePreview["bills"][number]["amountRole"], string> = {
  included: "计入合同金额",
  reference: "参考金额",
  non_priced: "不计价",
  provisional: "暂列金额"
};
const pricingModeLabels: Record<ContractTemplateUsagePreview["bills"][number]["pricingMode"], string> = {
  tax_inclusive: "含税单价",
  tax_exclusive: "不含税单价"
};
const columnTypeLabels: Record<ContractTemplateUsagePreview["bills"][number]["columns"][number]["type"], string> = {
  text: "文本",
  number: "数字",
  boolean: "是/否"
};

function contractTypeName(value: string) {
  return contractTypeLabel(value);
}

function fieldTypeName(value: ContractTemplateUsagePreview["fields"][number]["type"]) {
  return fieldTypeLabels[value];
}

function amountRoleName(value: ContractTemplateUsagePreview["bills"][number]["amountRole"]) {
  return amountRoleLabels[value];
}

function pricingModeName(value: ContractTemplateUsagePreview["bills"][number]["pricingMode"]) {
  return pricingModeLabels[value];
}

function columnTypeName(value: ContractTemplateUsagePreview["bills"][number]["columns"][number]["type"]) {
  return columnTypeLabels[value];
}

function attachmentRequirement(
  attachment: ContractTemplateUsagePreview["attachments"][number]
) {
  if (attachment.required && attachment.mustBeValid) return "必传且需在有效期内";
  if (attachment.required) return "必传";
  if (attachment.mustBeValid) return "选传，上传后需在有效期内";
  return "选传";
}
</script>

<style scoped>
.usage-preview,
.item-list,
.bill-item {
  display: grid;
  gap: var(--jg-space-md);
}

.preview-head,
.preview-item,
.preview-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.preview-head h3,
.preview-head p,
.split-list h4 {
  margin: 0;
}

.preview-head p,
.preview-item span,
.empty-text {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.count-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.count-grid > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  text-align: center;
}

.count-grid strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-size-section-title);
}

.column-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs);
}

.split-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-lg);
}

.split-list > div {
  display: grid;
  align-content: start;
  gap: var(--jg-space-sm);
}

.preview-actions {
  justify-content: flex-end;
  padding-top: var(--jg-space-md);
  border-top: 1px solid var(--jg-border);
}

@media (max-width: 720px) {
  .count-grid,
  .split-list {
    grid-template-columns: 1fr;
  }
}
</style>
