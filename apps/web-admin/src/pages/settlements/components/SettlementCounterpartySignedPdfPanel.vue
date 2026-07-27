<template>
  <section
    class="signed-pdf-panel"
    aria-labelledby="counterparty-signed-pdf-title"
  >
    <div class="panel-heading">
      <div>
        <strong id="counterparty-signed-pdf-title">冻结结算单与乙方签章原件</strong>
        <span>冻结版和扫描件均绑定当前草稿修订号；修改结算事实后必须重新生成、签章和上传。</span>
      </div>
      <t-tag
        :theme="linked ? 'success' : 'default'"
        variant="light"
      >
        {{ linked ? "当前修订版已关联" : "待完成" }}
      </t-tag>
    </div>

    <div class="document-actions">
      <div class="document-fact">
        <span>当前冻结版</span>
        <strong v-if="frozenDocument">R{{ frozenDocument.sourceRevision }} · {{ frozenDocument.pageCount }} 页</strong>
        <strong v-else>尚未生成</strong>
      </div>
      <t-button
        variant="outline"
        :loading="generateBusy"
        :disabled="disabled || generateBusy"
        @click="$emit('generate')"
      >
        {{ frozenDocument ? "重新生成当前修订版" : "生成当前修订版" }}
      </t-button>
      <t-button
        variant="outline"
        :disabled="disabled || !frozenDocument"
        @click="$emit('download')"
      >
        下载冻结结算单
      </t-button>
    </div>

    <div class="signing-instructions">
      <strong>线下签章要求</strong>
      <span>打印完整冻结版，由乙方在要求位置签字并填写日期、逐页盖章；超过一页时加盖骑缝章，再扫描为一份 PDF。系统校验 PDF 可读性和原字节摘要，不做 OCR 或逐页正文比对。</span>
    </div>

    <div class="upload-row">
      <t-upload
        v-model="uploadFiles"
        theme="file-input"
        accept=".pdf,application/pdf"
        :auto-upload="false"
        :max="1"
        :loading="uploadBusy"
        :disabled="disabled || !frozenDocument || uploadBusy"
        placeholder="选择乙方完整签章 PDF"
        @change="onFileChange"
      />
      <span
        v-if="stagedFileName"
        class="staged-file"
      >已上传：{{ stagedFileName }}</span>
    </div>

    <fieldset class="declaration-list">
      <legend>上传人逐项确认</legend>
      <t-checkbox
        v-model="declaration.pageOrderMatchesFrozenDocument"
        :disabled="disabled || uploadBusy || !stagedFileId"
        @click="bindDeclarationToCurrentEvidence"
      >
        已人工核对扫描件页序与签章；页数、方向或尺寸差异（如有）已确认
      </t-checkbox>
      <t-checkbox
        v-model="declaration.counterpartySignedAndDated"
        :disabled="disabled || uploadBusy || !stagedFileId"
        @click="bindDeclarationToCurrentEvidence"
      >
        乙方已在所有要求位置签字并填写日期
      </t-checkbox>
      <t-checkbox
        v-model="declaration.everyPageStamped"
        :disabled="disabled || uploadBusy || !stagedFileId"
        @click="bindDeclarationToCurrentEvidence"
      >
        乙方已逐页盖章
      </t-checkbox>
      <t-checkbox
        v-model="declaration.crossPageSealCompleted"
        :disabled="disabled || uploadBusy || !stagedFileId || !requiresCrossPageSeal"
        @click="bindDeclarationToCurrentEvidence"
      >
        多页文件已加盖骑缝章{{ requiresCrossPageSeal ? "" : "（单页不适用）" }}
      </t-checkbox>
    </fieldset>

    <t-alert
      v-if="linkedInspection"
      theme="info"
      :message="linkedInspectionMessage"
    />

    <div class="panel-footer">
      <span>{{ linked ? "系统已校验并关联当前修订版原件。" : linkHint }}</span>
      <t-button
        variant="outline"
        :disabled="disabled || !frozenDocument || !stagedFileId"
        @click="$emit('review')"
      >
        在线核对两份 PDF
      </t-button>
      <t-button
        variant="outline"
        :loading="linkBusy"
        :disabled="disabled || linked || !canLink"
        @click="emitLink"
      >
        核对通过并关联扫描件
      </t-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { UploadChangeContext, UploadFile } from "tdesign-vue-next";
import { computed, reactive, ref, watch } from "vue";

export interface SettlementFrozenDocumentSummary {
  id: string;
  fileId: string;
  sourceRevision: number;
  pageCount: number;
}

export interface SettlementCounterpartyDeclaration {
  pageOrderMatchesFrozenDocument: boolean;
  counterpartySignedAndDated: boolean;
  everyPageStamped: boolean;
  crossPageSealCompleted: boolean;
  pdfInspection?: {
    version: 1;
    frozenPageCount: number;
    originalPageCount: number;
    hasDifferences: boolean;
    differences: Array<"page_count" | "orientation" | "dimensions" | "rotation">;
  };
}

const props = withDefaults(defineProps<{
  frozenDocument: SettlementFrozenDocumentSummary | null;
  stagedFileName?: string;
  stagedFileId?: string;
  evidenceEpoch?: number;
  linked?: boolean;
  linkedDeclaration?: SettlementCounterpartyDeclaration | null;
  disabled?: boolean;
  generateBusy?: boolean;
  uploadBusy?: boolean;
  linkBusy?: boolean;
}>(), {
  stagedFileName: "",
  stagedFileId: "",
  evidenceEpoch: 0,
  linked: false,
  linkedDeclaration: null,
  disabled: false,
  generateBusy: false,
  uploadBusy: false,
  linkBusy: false
});

const emit = defineEmits<{
  generate: [];
  download: [];
  "select-file": [file: File];
  "clear-file": [];
  review: [];
  link: [declaration: SettlementCounterpartyDeclaration];
}>();

const uploadFiles = ref<UploadFile[]>([]);
const confirmedEvidenceEpoch = ref(-1);
const declaration = reactive<SettlementCounterpartyDeclaration>({
  pageOrderMatchesFrozenDocument: false,
  counterpartySignedAndDated: false,
  everyPageStamped: false,
  crossPageSealCompleted: false
});

const requiresCrossPageSeal = computed(() => (props.frozenDocument?.pageCount ?? 0) > 1);
const linkedInspection = computed(() => props.linkedDeclaration?.pdfInspection ?? null);
const pdfDifferenceLabel: Record<NonNullable<SettlementCounterpartyDeclaration["pdfInspection"]>["differences"][number], string> = {
  page_count: "页数",
  orientation: "方向",
  dimensions: "页面尺寸",
  rotation: "旋转角度"
};
const linkedInspectionMessage = computed(() => {
  const inspection = linkedInspection.value;
  if (!inspection) return "";
  const differences = inspection.hasDifferences
    ? `已记录版式差异：${inspection.differences.map((item) => pdfDifferenceLabel[item]).join("、")}。`
    : "版式核验未发现差异。";
  return `PDF 核验快照：冻结版 ${inspection.frozenPageCount} 页，乙方原件 ${inspection.originalPageCount} 页；${differences}`;
});
const declarationComplete = computed(() =>
  declaration.pageOrderMatchesFrozenDocument &&
  declaration.counterpartySignedAndDated &&
  declaration.everyPageStamped &&
  (!requiresCrossPageSeal.value || declaration.crossPageSealCompleted)
);
const canLink = computed(() =>
  Boolean(
    props.frozenDocument &&
    props.stagedFileId &&
    declarationComplete.value &&
    confirmedEvidenceEpoch.value === props.evidenceEpoch
  )
);
const linkHint = computed(() => {
  if (!props.frozenDocument) return "请先生成当前修订版冻结结算单。";
  if (!props.stagedFileId) return "请上传乙方完整签章扫描件。";
  if (!declarationComplete.value) return "请逐项完成签章声明。";
  return "可以执行一次核对通过并关联当前草稿修订版。";
});

watch(requiresCrossPageSeal, (required) => {
  if (!required) declaration.crossPageSealCompleted = false;
});

watch(
  () => `${props.frozenDocument?.id ?? ""}:${props.frozenDocument?.sourceRevision ?? 0}`,
  () => resetLocalEvidence()
);

watch(
  () => props.evidenceEpoch,
  () => {
    resetLocalEvidence();
  },
  { immediate: true }
);

function onFileChange(files: UploadFile[], context: UploadChangeContext) {
  if (context.trigger === "remove") {
    resetLocalEvidence();
    emit("clear-file");
    return;
  }
  if (context.trigger !== "add") return;
  const file = context.file?.raw ?? files.at(-1)?.raw;
  if (!file) return;
  resetDeclaration();
  emit("select-file", file);
}

function emitLink() {
  if (!canLink.value) return;
  emit("link", { ...declaration });
}

function resetDeclaration() {
  confirmedEvidenceEpoch.value = -1;
  declaration.pageOrderMatchesFrozenDocument = false;
  declaration.counterpartySignedAndDated = false;
  declaration.everyPageStamped = false;
  declaration.crossPageSealCompleted = false;
}

function bindDeclarationToCurrentEvidence() {
  confirmedEvidenceEpoch.value = props.evidenceEpoch;
}

function resetLocalEvidence() {
  uploadFiles.value = [];
  resetDeclaration();
}

defineExpose({ resetLocalEvidence });
</script>

<style scoped>
.signed-pdf-panel {
  display: grid;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-section) 0;
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.panel-heading,
.document-actions,
.upload-row,
.panel-footer {
  display: flex;
  align-items: center;
  gap: var(--jg-space-md);
}

.panel-heading,
.panel-footer {
  justify-content: space-between;
}

.panel-heading > div,
.document-fact,
.signing-instructions {
  display: grid;
  gap: var(--jg-space-xs);
}

.panel-heading strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.panel-heading span,
.document-fact span,
.signing-instructions span,
.panel-footer span,
.staged-file {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.document-actions {
  flex-wrap: wrap;
  padding: var(--jg-space-md) var(--jg-space-lg);
  background: var(--jg-bg-muted);
}

.document-fact {
  flex: 1;
  min-width: 200px;
}

.upload-row {
  flex-wrap: wrap;
}

.declaration-list {
  display: grid;
  gap: var(--jg-space-sm);
  margin: 0;
  padding: var(--jg-space-md) 0 0;
  border: 0;
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.declaration-list legend {
  margin-bottom: var(--jg-space-sm);
  color: var(--jg-text-strong);
  font-weight: var(--jg-font-weight-semibold);
}

@container jg-page (max-width: 760px) {
  .panel-heading,
  .panel-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
