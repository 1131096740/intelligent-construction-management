<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>版式模板编辑器</h1>
        <p>合同文档版式只做占位符检查、样张预览和版本治理；固定内容需人工确认跨公司风险</p>
      </div>
      <t-space>
        <t-button @click="versionAction('submit')">
          提交
        </t-button>
        <t-button
          theme="primary"
          :disabled="!canPublish"
          @click="versionAction('publish')"
        >
          发布
        </t-button>
        <t-button @click="versionAction('clone')">
          克隆
        </t-button>
        <t-button
          theme="danger"
          variant="outline"
          @click="versionAction('stop')"
        >
          停用
        </t-button>
        <t-button
          variant="outline"
          @click="versionAction('revoke')"
        >
          撤销
        </t-button>
      </t-space>
    </div>

    <t-card
      title="合同文档来源"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>版式名称</span><t-input v-model="form.name" /></label>
        <label><span>合同类型</span><t-select v-model="form.contractTypeKey">
          <t-option
            v-for="option in contractTypeOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </t-select></label>
        <label><span>版本编号</span><t-input
          v-model="versionId"
          placeholder="创建后自动填入，或粘贴已有版本编号"
        /></label>
        <label>
          <span>合同文档文件</span>
          <input
            type="file"
            accept=".docx"
            @change="onFileChange"
          >
        </label>
        <t-button
          theme="primary"
          :loading="uploading"
          @click="createLayout"
        >
          创建版式草稿
        </t-button>
      </div>
      <p class="warning">
        固定公司名称、联系人、账号等写死在合同文档中会跨公司复用，请改用中文占位符。
      </p>
    </t-card>

    <t-card
      title="占位符参考"
      :bordered="true"
      class="panel"
    >
      <div class="reference-list">
        <code
          v-for="item in placeholders"
          :key="item"
        >{{ item }}</code>
      </div>
    </t-card>

    <t-card
      title="检查与预览"
      :bordered="true"
      class="panel"
    >
      <div class="split">
        <div>
          <t-button
            :disabled="!versionId"
            @click="inspect"
          >
            执行文档检查
          </t-button>
          <pre class="report">{{ inspectionText }}</pre>
        </div>
        <div>
          <p class="hint">
            样张会使用系统内置的合同名称、草稿编号和水印示例生成。
          </p>
          <t-space class="actions">
            <t-button
              :disabled="!versionId"
              @click="queuePreview"
            >
              生成样张
            </t-button>
            <t-button
              :disabled="!versionId"
              @click="loadPreview"
            >
              刷新预览状态
            </t-button>
          </t-space>
          <p class="preview-line">
            最新预览：{{ previewStatus }}
          </p>
          <p
            v-if="latestPreviewPdfFileId"
            class="preview-line"
          >
            预览文件编号：{{ latestPreviewPdfFileId }}
          </p>
        </div>
      </div>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import {
  cloneLayoutTemplateVersion,
  createLayoutTemplate,
  getLatestLayoutTemplatePreview,
  inspectLayoutTemplateVersion,
  publishLayoutTemplateVersion,
  queueLayoutTemplatePreview,
  revokeLayoutTemplateVersion,
  stopLayoutTemplateVersion,
  submitLayoutTemplateVersion
} from "../../api/contract-workbench.api";
import { templateStatusLabel } from "../contracts/contract-labels";
import { canPublishLayoutVersion, contractTypeOptions } from "./contract-template.config";

const route = useRoute();
const form = reactive({ name: "", contractTypeKey: "" });
const versionId = ref("");
const docxFile = ref<File | null>(null);
const uploading = ref(false);
const inspectionReport = ref<Record<string, unknown> | null>(null);
const latestPreview = ref<Record<string, unknown> | null>(null);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const timer = ref<number | undefined>();
const placeholders = [
  "{合同名称}",
  "{草稿编号}",
  "{文档水印}",
  "{乙方名称}",
  "{交货地点}",
  "{#材料清单}{名称}{/材料清单}"
];

const inspectionText = computed(() => formatInspectionReport(inspectionReport.value));
const previewStatus = computed(() =>
  latestPreview.value?.status ? templateStatusLabel(String(latestPreview.value.status)) : "尚未生成"
);
const latestPreviewPdfFileId = computed(() => String(latestPreview.value?.previewPdfFileId ?? ""));
const canPublish = computed(() => canPublishLayoutVersion({ inspectionReport: inspectionReport.value, latestPreview: latestPreview.value }));

function onFileChange(event: Event) {
  docxFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

async function createLayout() {
  if (!docxFile.value) {
    message.value = "请选择合同文档文件";
    tone.value = "danger";
    return;
  }
  uploading.value = true;
  try {
    const file = await uploadPrivateFile(docxFile.value, docxFile.value.name);
    const created = await createLayoutTemplate({
      name: form.name.trim(),
      contractTypeKey: form.contractTypeKey.trim(),
      docxFileId: file.id,
      placeholderSchema: { bills: [] }
    });
    versionId.value = String((created as { version?: { id?: string } }).version?.id ?? versionId.value);
    message.value = "版式草稿已创建";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建失败";
    tone.value = "danger";
  } finally {
    uploading.value = false;
  }
}

async function inspect() {
  try {
    inspectionReport.value = (await inspectLayoutTemplateVersion(versionId.value.trim())) as Record<string, unknown>;
    message.value = "检查完成";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "检查失败";
    tone.value = "danger";
  }
}

async function loadPreview() {
  try {
    latestPreview.value = (await getLatestLayoutTemplatePreview(versionId.value.trim())) as Record<string, unknown>;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "读取预览失败";
    tone.value = "danger";
  }
}

async function queuePreview() {
  try {
    await queueLayoutTemplatePreview(versionId.value.trim(), {});
    message.value = "样张已进入队列";
    tone.value = "success";
    startPolling();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "生成预览失败";
    tone.value = "danger";
  }
}

function startPolling() {
  window.clearInterval(timer.value);
  timer.value = window.setInterval(() => void loadPreview(), 2000);
}

async function versionAction(kind: "submit" | "publish" | "clone" | "stop" | "revoke") {
  const id = versionId.value.trim();
  if (!id) {
    message.value = "请先填写版本编号";
    tone.value = "danger";
    return;
  }
  try {
    if (kind === "submit") await submitLayoutTemplateVersion(id);
    if (kind === "publish") await publishLayoutTemplateVersion(id, { changeSummary: "发布版式" });
    if (kind === "clone") await cloneLayoutTemplateVersion(id);
    if (kind === "stop") await stopLayoutTemplateVersion(id);
    if (kind === "revoke") await revokeLayoutTemplateVersion(id);
    message.value = "操作已提交";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "操作失败";
    tone.value = "danger";
  }
}

onMounted(() => {
  versionId.value = String(route.params.layoutTemplateId ?? "");
  if (versionId.value === "new") versionId.value = "";
});
onBeforeUnmount(() => window.clearInterval(timer.value));

function formatInspectionReport(report: Record<string, unknown> | null) {
  if (!report) return "尚未检查";
  const placeholders = toStringList(report.placeholders).map(toChinesePlaceholder);
  const missing = toStringList(report.missingRequiredPlaceholders).map(toChinesePlaceholder);
  const unknown = toStringList(report.unknownPlaceholders).map(toChinesePlaceholder);
  const blocking = toStringList(report.blockingErrors).map(toChineseInspectionIssue);
  const warnings = toStringList(report.warnings).map(toChineseInspectionIssue);
  return [
    `识别占位符：${placeholders.length ? placeholders.join("、") : "无"}`,
    `清单循环：${report.hasBillLoop ? "已识别" : "未识别"}`,
    `缺少必要项：${missing.length ? missing.join("、") : "无"}`,
    `未登记项：${unknown.length ? unknown.join("、") : "无"}`,
    `阻断项：${blocking.length ? blocking.join("；") : "无"}`,
    `提醒项：${warnings.length ? warnings.join("；") : "无"}`
  ].join("\n");
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function toChinesePlaceholder(value: string) {
  const labels: Record<string, string> = {
    "contract.name": "合同名称",
    "contract.temporaryCode": "草稿编号",
    "contract.code": "合同编号",
    "contract.amount": "合同金额",
    "contract.amountUppercase": "合同金额大写",
    "document.watermark": "文档水印",
    "document.generatedAt": "生成时间",
    "party.party_a.name": "甲方名称",
    "party.party_b.name": "乙方名称",
    "field.deliveryLocation": "交货地点",
    "clause.payment.text": "付款条款",
    "bill.materials": "材料清单",
    "bill.equipment": "设备清单",
    "bill.labor": "劳务清单"
  };
  return labels[value] ?? (/[A-Za-z]/.test(value) ? "未登记占位符" : value);
}

function toChineseInspectionIssue(value: string) {
  if (value.startsWith("Unknown placeholders:")) {
    return `存在未登记占位符：${translateInspectionList(value)}`;
  }
  if (value.startsWith("Missing required placeholders:")) {
    return `缺少必要占位符：${translateInspectionList(value)}`;
  }
  if (value.startsWith("Missing bill loop marker for:")) {
    return `缺少清单循环块：${translateInspectionList(value)}`;
  }
  if (value.startsWith("Disallowed fonts:")) {
    return "存在未允许字体，请改用宋体、仿宋、黑体或系统允许字体";
  }
  return /[A-Za-z]/.test(value) ? "检查失败，请根据模板规范调整后重试" : value;
}

function translateInspectionList(value: string) {
  return value
    .slice(value.indexOf(":") + 1)
    .split(",")
    .map((item) => toChinesePlaceholder(item.trim()))
    .join("、");
}
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span, .hint { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(5, minmax(140px, 1fr)); gap: 12px; align-items: end; }
label { display: grid; gap: 4px; }
.warning { margin: 12px 0 0; color: #b95000; font-size: 12px; }
.reference-list { display: flex; flex-wrap: wrap; gap: 8px; }
code { background: #f4f6f9; padding: 4px 8px; border-radius: 3px; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.report { min-height: 180px; padding: 12px; background: #f6f8fb; white-space: pre-wrap; }
.actions { margin-top: 8px; }
.preview-line, .message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@media (max-width: 1000px) { .page-head, .form-grid, .split { display: grid; grid-template-columns: 1fr; } }
</style>
