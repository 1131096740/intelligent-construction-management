<template>
  <section
    class="negotiation-canvas"
    aria-labelledby="negotiation-canvas-title"
  >
    <header class="canvas-head">
      <div>
        <h2 id="negotiation-canvas-title">
          合同磋商差异画布
        </h2>
        <p>线下修订稿只用于比较；结构候选必须先人工同步到账本，再确认处置。</p>
      </div>
      <t-tag
        :theme="selected ? 'primary' : 'default'"
        variant="light"
      >
        {{ selected ? `第 ${selected.round.roundNo} 轮` : "尚未选择修订稿" }}
      </t-tag>
    </header>

    <t-alert
      v-if="readinessMessages.length"
      theme="error"
      :message="`提交阻断：${readinessMessages.join('；')}`"
      class="readiness-alert"
    />

    <div
      v-if="selected"
      class="revision-summary"
    >
      <div>
        <span>当前修订稿</span>
        <strong>{{ selected.revision.label }}</strong>
        <small>{{ processStatusLabel }}</small>
      </div>
      <t-button
        variant="outline"
        :disabled="!selected.revision.hasPreviewPdf"
        @click="previewDialogVisible = true"
      >
        安全打开修订 PDF
      </t-button>
    </div>

    <div
      v-if="!selected"
      class="empty-stage"
    >
      <t-empty description="请在右侧文档页签开启轮次并选择修订稿" />
    </div>
    <div
      v-else-if="!selected.revision.comparison"
      class="empty-stage"
    >
      <t-loading
        v-if="isProcessing"
        text="修订稿正在进入比较队列……"
      />
      <t-alert
        v-else
        theme="warning"
        message="修订稿尚未形成比较记录，请刷新或重试。"
      />
    </div>
    <div
      v-else-if="selected.revision.comparison.status !== 'succeeded'"
      class="empty-stage"
    >
      <t-loading
        v-if="isProcessing"
        text="系统正在生成修订 PDF 并比较文档差异……"
      />
      <t-alert
        v-else
        :theme="selected.revision.comparison.status === 'failed' ? 'error' : 'warning'"
        :message="selected.revision.comparison.errorMessage || '比较结果已失效，请在右侧重试或上传新修订稿。'"
      />
    </div>
    <div
      v-else-if="differences.length === 0"
      class="empty-stage"
    >
      <t-alert
        theme="success"
        message="本修订稿与轮次来源文档没有可识别差异。"
      />
    </div>
    <div
      v-else
      class="difference-list"
    >
      <t-card
        v-for="difference in differences"
        :key="difference.id"
        :title="`差异 ${difference.sortOrder} · ${changeTypeLabel(difference.changeType)}`"
        :bordered="true"
      >
        <template #actions>
          <t-tag
            :theme="difference.disposition === 'pending' ? 'warning' : 'success'"
            variant="light"
          >
            {{ contractDifferenceDispositionLabel(difference.disposition) }}
          </t-tag>
        </template>
        <div class="difference-meta">
          位置：{{ difference.locationPath }}
        </div>
        <div class="text-comparison">
          <div>
            <span>原文</span>
            <p>{{ difference.beforeText || "无" }}</p>
          </div>
          <div>
            <span>修订后</span>
            <p>{{ difference.afterText || "无" }}</p>
          </div>
        </div>

        <t-alert
          v-if="difference.candidate"
          theme="info"
          :message="`只读结构候选：${candidateText(difference.candidate)}`"
        />
        <p
          v-if="difference.candidate"
          class="candidate-note"
        >
          此处不会修改合同账本。请先在右侧对应业务区人工修改并保存，确认一致后再选择“确认已同步账本”。
        </p>

        <div
          v-if="difference.disposition === 'pending'"
          class="disposition-form"
        >
          <t-radio-group
            :value="draftFor(difference.id).disposition"
            :options="dispositionOptions"
            :disabled="disabled || selected.round.status !== 'open'"
            @change="updateDisposition(difference.id, $event)"
          />
          <t-textarea
            :value="draftFor(difference.id).reason"
            placeholder="不采纳或无实质变化时必须填写原因"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :disabled="disabled || selected.round.status !== 'open'"
            @change="updateDispositionReason(difference.id, $event)"
          />
          <t-popconfirm
            content="差异处置提交后不可在本轮重复修改，确认提交？"
            @confirm="submitDisposition(difference)"
          >
            <t-button
              theme="primary"
              :loading="busyDifferenceId === difference.id"
              :disabled="Boolean(busyDifferenceId) || Boolean(dispositionDisabledReason(difference.id)) || disabled || selected.round.status !== 'open'"
            >
              提交本条处置
            </t-button>
          </t-popconfirm>
          <span
            v-if="dispositionDisabledReason(difference.id)"
            class="form-error"
          >
            {{ dispositionDisabledReason(difference.id) }}
          </span>
        </div>
        <div
          v-else
          class="disposed-summary"
        >
          <span>{{ difference.dispositionReason || "已完成处置" }}</span>
        </div>
      </t-card>
    </div>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
      class="message"
    />

    <t-dialog
      v-model:visible="previewDialogVisible"
      header="安全打开修订 PDF"
      :confirm-btn="{ content: '创建审计下载票据', loading: previewBusy }"
      @confirm="openRevisionPreview"
    >
      <div class="preview-form">
        <t-input
          v-model="confirmationPassword"
          type="password"
          label="当前密码"
          placeholder="请输入当前登录密码"
        />
        <t-textarea
          v-model="downloadReason"
          placeholder="请填写查看修订 PDF 的业务原因"
          :autosize="{ minRows: 3, maxRows: 5 }"
        />
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  disposeContractDocumentDifference,
  openContractRevisionPreview,
  type ContractDifferenceCandidate,
  type ContractDocumentDifferenceReadModel,
  type ContractNegotiationRoundReadModel,
  type ContractOfflineRevisionReadModel
} from "../../../api/contract-negotiation.api";
import {
  contractDifferenceCandidatePresentation,
  contractDifferenceDispositionDisabledReason,
  contractDifferenceDispositionLabel,
  canApplyContractNegotiationSelectionResponse,
  contractNegotiationSelectionKey,
  contractNegotiationProcessStatusLabel,
  contractNegotiationReadinessMessages
} from "./contract-negotiation.state";

type SelectedNegotiation = {
  round: ContractNegotiationRoundReadModel;
  revision: ContractOfflineRevisionReadModel;
};
type DispositionDraft = {
  disposition: "confirmed" | "rejected" | "no_material_change";
  reason: string;
};

const props = defineProps<{ selected: SelectedNegotiation | null; readiness: unknown; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const dispositionDrafts = reactive<Record<string, DispositionDraft>>({});
const busyDifferenceId = ref("");
const message = ref("");
const messageTone = ref<"success" | "error">("success");
const previewDialogVisible = ref(false);
const previewBusy = ref(false);
const confirmationPassword = ref("");
const downloadReason = ref("");
let previewRequestId = 0;
let dispositionRequestId = 0;

const differences = computed(() => props.selected?.revision.comparison?.differences ?? []);
const readinessMessages = computed(() => contractNegotiationReadinessMessages(props.readiness));
const isProcessing = computed(() =>
  ["queued", "processing"].includes(
    props.selected?.revision.comparison?.status ?? props.selected?.revision.status ?? ""
  )
);
const processStatusLabel = computed(() =>
  props.selected ? contractNegotiationProcessStatusLabel(props.selected.revision.status) : ""
);
const dispositionOptions = [
  { label: "确认已同步账本", value: "confirmed" },
  { label: "不采纳", value: "rejected" },
  { label: "无实质变化", value: "no_material_change" }
];

watch(
  () => contractNegotiationSelectionKey(props.selected),
  () => {
    previewRequestId += 1;
    dispositionRequestId += 1;
    previewBusy.value = false;
    busyDifferenceId.value = "";
    previewDialogVisible.value = false;
    clearPreviewCredentials();
    clearDispositionDrafts();
    for (const difference of differences.value) draftFor(difference.id);
    message.value = "";
  },
  { immediate: true }
);

watch(previewDialogVisible, (visible) => {
  if (!visible) {
    previewRequestId += 1;
    previewBusy.value = false;
    clearPreviewCredentials();
  }
});

onBeforeUnmount(() => {
  previewRequestId += 1;
  dispositionRequestId += 1;
  clearPreviewCredentials();
  clearDispositionDrafts();
});

function draftFor(differenceId: string) {
  return (dispositionDrafts[differenceId] ??= { disposition: "confirmed", reason: "" });
}

function dispositionDisabledReason(differenceId: string) {
  const draft = draftFor(differenceId);
  return contractDifferenceDispositionDisabledReason(draft.disposition, draft.reason);
}

function updateDisposition(differenceId: string, value: unknown) {
  if (["confirmed", "rejected", "no_material_change"].includes(String(value))) {
    draftFor(differenceId).disposition = value as DispositionDraft["disposition"];
  }
}

function updateDispositionReason(differenceId: string, value: unknown) {
  draftFor(differenceId).reason = String(value ?? "");
}

async function submitDisposition(difference: ContractDocumentDifferenceReadModel) {
  const draft = draftFor(difference.id);
  if (dispositionDisabledReason(difference.id)) return;
  const selectionKey = contractNegotiationSelectionKey(props.selected);
  if (!selectionKey || !differences.value.some((item) => item.id === difference.id)) return;
  const request = ++dispositionRequestId;
  busyDifferenceId.value = difference.id;
  message.value = "";
  try {
    await disposeContractDocumentDifference(difference.id, {
      disposition: draft.disposition,
      reason: draft.reason.trim() || undefined
    });
    if (!isDispositionCurrent(request, selectionKey, difference.id)) return;
    message.value = "本条差异处置已记录。";
    messageTone.value = "success";
    emit("changed");
  } catch (error) {
    if (!isDispositionCurrent(request, selectionKey, difference.id)) return;
    message.value = error instanceof Error ? error.message : "提交差异处置失败。";
    messageTone.value = "error";
  } finally {
    if (isDispositionCurrent(request, selectionKey, difference.id)) {
      busyDifferenceId.value = "";
    }
  }
}

async function openRevisionPreview() {
  const revision = props.selected?.revision;
  const selectionKey = contractNegotiationSelectionKey(props.selected);
  if (!revision?.hasPreviewPdf || !confirmationPassword.value.trim() || !downloadReason.value.trim()) {
    message.value = "请输入当前密码并填写查看原因。";
    messageTone.value = "error";
    previewDialogVisible.value = false;
    clearPreviewCredentials();
    return;
  }
  const request = ++previewRequestId;
  const password = confirmationPassword.value;
  const reason = downloadReason.value.trim();
  previewBusy.value = true;
  try {
    const opened = await openContractRevisionPreview(
      revision.id,
      { confirmationPassword: password, downloadReason: reason },
      () => isPreviewCurrent(request, selectionKey)
    );
    if (!opened || !isPreviewCurrent(request, selectionKey)) return;
    previewDialogVisible.value = false;
    message.value = "修订 PDF 已通过审计票据安全打开。";
    messageTone.value = "success";
  } catch (error) {
    if (!isPreviewCurrent(request, selectionKey)) return;
    previewDialogVisible.value = false;
    clearPreviewCredentials();
    message.value = error instanceof Error ? error.message : "打开修订 PDF 失败。";
    messageTone.value = "error";
  } finally {
    if (isPreviewCurrent(request, selectionKey)) previewBusy.value = false;
  }
}

function isPreviewCurrent(request: number, selectionKey: string) {
  return canApplyContractNegotiationSelectionResponse(
    request,
    previewRequestId,
    selectionKey,
    contractNegotiationSelectionKey(props.selected)
  );
}

function isDispositionCurrent(request: number, selectionKey: string, differenceId: string) {
  return canApplyContractNegotiationSelectionResponse(
    request,
    dispositionRequestId,
    selectionKey,
    contractNegotiationSelectionKey(props.selected)
  ) && differences.value.some((difference) => difference.id === differenceId);
}

function clearPreviewCredentials() {
  confirmationPassword.value = "";
  downloadReason.value = "";
}

function clearDispositionDrafts() {
  for (const differenceId of Object.keys(dispositionDrafts)) {
    delete dispositionDrafts[differenceId];
  }
}

function candidateText(candidate: ContractDifferenceCandidate) {
  const presentation = contractDifferenceCandidatePresentation(candidate);
  return `${presentation.title}：${presentation.value}`;
}

function changeTypeLabel(value: ContractDocumentDifferenceReadModel["changeType"]) {
  return { insert: "新增", delete: "删除", replace: "修改" }[value];
}
</script>

<style scoped>
.negotiation-canvas {
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 720px;
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
  container-name: contract-negotiation;
  container-type: inline-size;
}

.canvas-head,
.revision-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md) var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-border);
}

.canvas-head h2,
.canvas-head p {
  margin: 0;
}

.canvas-head h2 {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.canvas-head p,
.revision-summary span,
.revision-summary small,
.difference-meta,
.candidate-note {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.readiness-alert,
.message {
  margin: var(--jg-space-md) var(--jg-space-lg) 0;
}

.revision-summary > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.empty-stage {
  display: grid;
  min-height: 520px;
  place-items: center;
  padding: var(--jg-space-xl);
  background: var(--jg-bg-muted);
}

.difference-list {
  display: grid;
  gap: var(--jg-space-md);
  padding: var(--jg-space-lg);
  background: var(--jg-bg-muted);
}

.text-comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
  margin: var(--jg-space-md) 0;
}

.text-comparison > div {
  min-width: 0;
  padding: var(--jg-space-md);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.text-comparison span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.text-comparison p {
  margin: var(--jg-space-sm) 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.candidate-note {
  margin: var(--jg-space-sm) 0;
}

.disposition-form,
.preview-form {
  display: grid;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-md);
}

.form-error {
  color: var(--jg-danger);
  font-size: var(--jg-font-meta);
}

.disposed-summary {
  margin-top: var(--jg-space-md);
  color: var(--jg-text-muted);
}

@container contract-negotiation (max-width: 720px) {
  .text-comparison {
    grid-template-columns: 1fr;
  }
}
</style>
