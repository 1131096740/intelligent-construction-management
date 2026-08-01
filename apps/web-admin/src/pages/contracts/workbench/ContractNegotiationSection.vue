<template>
  <section
    class="negotiation-section"
    aria-label="合同磋商轮次"
  >
    <div class="section-head">
      <div>
        <strong>合同磋商</strong>
        <span>每轮锁定当前修订合同 DOCX，线下稿只生成比较结果。</span>
      </div>
      <t-button
        variant="outline"
        :disabled="disabled || busy || Boolean(openRound)"
        @click="openRoundDialogVisible = true"
      >
        开启新轮次
      </t-button>
    </div>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
    />

    <div
      v-if="openRound"
      class="upload-panel"
    >
      <strong>第 {{ openRound.roundNo }} 轮上传线下修订稿</strong>
      <t-upload
        v-model="revisionFiles"
        theme="file-input"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        :auto-upload="false"
        :max="1"
        :disabled="disabled || busy"
        placeholder="选择 DOCX 修订稿"
      />
      <t-input
        v-model="revisionLabel"
        label="修订稿名称"
        placeholder="例如：业主第一轮修订稿"
      />
      <t-textarea
        v-model="revisionNote"
        placeholder="说明本次线下来源或沟通背景"
        :autosize="{ minRows: 2, maxRows: 4 }"
      />
      <t-checkbox
        v-model="revisionConfirmed"
        :disabled="disabled || busy"
      >
        我确认该文件仅作为草稿层比较依据，不作为审批或归档事实
      </t-checkbox>
      <div class="upload-actions">
        <t-button
          theme="primary"
          :loading="busyAction === 'upload'"
          :disabled="disabled || busy || !selectedFile || !revisionConfirmed"
          @click="uploadRevision"
        >
          上传并开始比较
        </t-button>
        <t-tooltip
          v-if="!canCloseOpenRound"
          content="需至少完成一份修订稿比较并处置全部差异"
        >
          <span><t-button
            disabled
            variant="outline"
          >关闭本轮</t-button></span>
        </t-tooltip>
        <t-popconfirm
          v-else
          content="关闭后不能继续上传或修改差异处置，确认关闭本轮？"
          @confirm="closeOpenRound"
        >
          <t-button
            variant="outline"
            :loading="busyAction === 'close'"
          >
            关闭本轮
          </t-button>
        </t-popconfirm>
      </div>
    </div>

    <t-empty
      v-if="!loading && rounds.length === 0"
      description="尚未开启合同磋商轮次"
    />
    <t-loading
      v-else-if="loading"
      text="正在加载磋商记录……"
    />
    <t-timeline
      v-else
      mode="same"
    >
      <t-timeline-item
        v-for="round in rounds"
        :key="round.id"
        :label="timeText(round.openedAt)"
        :dot-color="round.status === 'open' ? 'primary' : 'normal'"
      >
        <div class="round-card">
          <div class="round-head">
            <strong>第 {{ round.roundNo }} 轮</strong>
            <t-tag
              :theme="round.status === 'open' ? 'primary' : 'default'"
              variant="light"
            >
              {{ round.status === "open" ? "进行中" : "已关闭" }}
            </t-tag>
          </div>
          <span
            v-if="round.note"
            class="muted"
          >{{ round.note }}</span>
          <div class="revision-list">
            <div
              v-for="revision in round.revisions"
              :key="revision.id"
              :class="['revision-choice', { active: revision.id === selectedRevisionId }]"
            >
              <t-link
                theme="primary"
                @click="selectRevision(round, revision)"
              >
                <span class="revision-copy">
                  <strong>{{ revision.label }}</strong>
                  <small>{{ contractNegotiationProcessStatusLabel(revision.status) }}</small>
                </span>
              </t-link>
              <t-tag
                v-if="revision.comparison"
                :theme="revision.comparison.status === 'succeeded' ? 'success' : revision.comparison.status === 'failed' ? 'danger' : 'warning'"
                size="small"
                variant="light"
              >
                {{ revision.comparison.differences.length }} 项差异
              </t-tag>
              <t-button
                v-if="revision.status === 'failed' && round.status === 'open'"
                size="small"
                variant="text"
                :loading="busyAction === `retry-${revision.id}`"
                @click="retryRevision(revision.id)"
              >
                重试
              </t-button>
            </div>
          </div>
        </div>
      </t-timeline-item>
    </t-timeline>

    <div
      v-if="!loading"
      class="legacy-revision-history"
    >
      <div class="legacy-revision-head">
        <strong>旧流程修订记录</strong>
        <span>仅供查阅，不进入当前磋商差异处置。</span>
      </div>
      <t-empty
        v-if="legacyRevisionHistory.length === 0"
        description="暂无旧流程修订记录"
      />
      <div
        v-else
        class="legacy-revision-list"
      >
        <article
          v-for="revision in legacyRevisionHistory"
          :key="revision.id"
          class="legacy-revision-card"
        >
          <div class="legacy-revision-copy">
            <strong>{{ revision.label }}</strong>
            <span>{{ timeText(revision.createdAt) }}</span>
          </div>
          <t-tag
            size="small"
            variant="light"
          >
            {{ contractNegotiationProcessStatusLabel(revision.status) }}
          </t-tag>
          <span
            v-if="revision.note"
            class="muted legacy-revision-note"
          >{{ revision.note }}</span>
          <span
            v-if="revision.errorMessage"
            class="legacy-revision-error"
          >{{ revision.errorMessage }}</span>
        </article>
      </div>
    </div>

    <t-dialog
      v-model:visible="openRoundDialogVisible"
      header="开启合同磋商轮次"
      :confirm-btn="{ content: '确认开启', loading: busyAction === 'open' }"
      @confirm="openNegotiationRound"
    >
      <t-textarea
        v-model="roundNote"
        placeholder="可填写本轮沟通对象或目标"
        :autosize="{ minRows: 3, maxRows: 6 }"
      />
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  closeContractNegotiationRound,
  listContractOfflineRevisionHistory,
  listContractNegotiationRounds,
  openContractNegotiationRound,
  retryContractOfflineRevision,
  uploadContractNegotiationRevision,
  type ContractNegotiationRoundReadModel,
  type ContractOfflineRevisionHistoryReadModel,
  type ContractOfflineRevisionReadModel
} from "../../../api/contract-negotiation.api";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";
import {
  canApplyContractNegotiationResponse,
  canCloseContractNegotiationRound,
  contractNegotiationProcessStatusLabel,
  hasActiveContractNegotiationProcessing,
  latestOpenContractNegotiationRound,
  normalizeContractNegotiationRounds,
  reconcileContractNegotiationSelection,
  selectedContractNegotiationRevision,
  type ContractNegotiationSelection
} from "./contract-negotiation.state";

const props = defineProps<{ versionId: string; disabled: boolean; refreshToken: number }>();
const emit = defineEmits<{
  selection: [value: { round: ContractNegotiationRoundReadModel; revision: ContractOfflineRevisionReadModel } | null];
  changed: [];
}>();

const rounds = ref<ContractNegotiationRoundReadModel[]>([]);
const offlineRevisionHistory = ref<ContractOfflineRevisionHistoryReadModel[]>([]);
const selection = ref<ContractNegotiationSelection | null>(null);
const loading = ref(false);
const busyAction = ref("");
const message = ref("");
const messageTone = ref<"success" | "error">("success");
const openRoundDialogVisible = ref(false);
const roundNote = ref("");
const revisionFiles = ref<UploadFile[]>([]);
const revisionLabel = ref("线下修订稿");
const revisionNote = ref("");
const revisionConfirmed = ref(false);
let requestId = 0;
let actionRequestId = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const busy = computed(() => Boolean(busyAction.value));
const legacyRevisionHistory = computed(() =>
  offlineRevisionHistory.value.filter((revision) => revision.negotiationRound === null)
);
const openRound = computed(() => latestOpenContractNegotiationRound(rounds.value));
const canCloseOpenRound = computed(() =>
  openRound.value ? canCloseContractNegotiationRound(openRound.value) : false
);
const selectedRevisionId = computed(() => selection.value?.revisionId ?? "");
const selectedFile = computed(() => {
  const raw = revisionFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
});

watch(
  () => [props.versionId, props.refreshToken] as const,
  ([versionId], previous) => {
    if (!previous || previous[0] !== versionId) resetVersionState();
    void loadRounds();
  },
  { immediate: true }
);

watch(openRoundDialogVisible, (visible) => {
  if (!visible) roundNote.value = "";
});

onBeforeUnmount(() => {
  requestId += 1;
  actionRequestId += 1;
  if (pollTimer) clearTimeout(pollTimer);
  offlineRevisionHistory.value = [];
  clearUploadState();
  roundNote.value = "";
  message.value = "";
  emit("selection", null);
});

async function loadRounds() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
  const versionId = props.versionId;
  const currentRequest = ++requestId;
  if (!versionId) {
    rounds.value = [];
    offlineRevisionHistory.value = [];
    selection.value = null;
    emit("selection", null);
    return;
  }
  loading.value = true;
  try {
    const [roundPayload, historyResult] = await Promise.all([
      listContractNegotiationRounds(versionId),
      listContractOfflineRevisionHistory(versionId)
    ]);
    const result = normalizeContractNegotiationRounds(roundPayload);
    if (!canApplyContractNegotiationResponse(currentRequest, requestId, versionId, props.versionId)) return;
    rounds.value = result;
    offlineRevisionHistory.value = historyResult;
    selection.value = reconcileContractNegotiationSelection(result, selection.value);
    emit("selection", selectedContractNegotiationRevision(result, selection.value));
    if (hasActiveContractNegotiationProcessing(result)) {
      pollTimer = setTimeout(() => void loadRounds(), 2000);
    }
  } catch (error) {
    if (currentRequest === requestId) showError(error instanceof Error ? error.message : "加载合同磋商记录失败。");
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
}

function selectRevision(round: ContractNegotiationRoundReadModel, revision: ContractOfflineRevisionReadModel) {
  selection.value = { roundId: round.id, revisionId: revision.id };
  emit("selection", { round, revision });
}

async function run(action: string, task: () => Promise<unknown>, success: string) {
  const versionId = props.versionId;
  const actionRequest = ++actionRequestId;
  if (!versionId) return false;
  busyAction.value = action;
  message.value = "";
  try {
    await task();
    if (!isActionCurrent(actionRequest, versionId)) return false;
    emit("changed");
    message.value = success;
    messageTone.value = "success";
    return true;
  } catch (error) {
    if (!isActionCurrent(actionRequest, versionId)) return false;
    showError(error instanceof Error ? error.message : "合同磋商操作失败。");
    return false;
  } finally {
    if (isActionCurrent(actionRequest, versionId)) busyAction.value = "";
  }
}

async function openNegotiationRound() {
  const versionId = props.versionId;
  if (
    await run(
      "open",
      () => openContractNegotiationRound(versionId, roundNote.value),
      "新磋商轮次已开启。"
    )
  ) {
    openRoundDialogVisible.value = false;
    roundNote.value = "";
  }
}

async function uploadRevision() {
  const file = selectedFile.value;
  if (!file || !revisionConfirmed.value) return;
  const versionId = props.versionId;
  if (!versionId) return;
  const actionRequest = ++actionRequestId;
  const label = revisionLabel.value.trim() || "线下修订稿";
  const note = revisionNote.value.trim() || undefined;
  busyAction.value = "upload";
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    if (!isActionCurrent(actionRequest, versionId)) {
      showUploadReselectMessage(versionId);
      return;
    }
    await uploadContractNegotiationRevision(versionId, {
      fileId: uploaded.id,
      label,
      note,
      confirmationStatementAccepted: true
    });
    if (!isActionCurrent(actionRequest, versionId)) return;
    emit("changed");
    message.value = "线下修订稿已进入比较队列。";
    messageTone.value = "success";
    clearUploadState();
  } catch (error) {
    if (!isActionCurrent(actionRequest, versionId)) return;
    showError(error instanceof Error ? error.message : "上传线下修订稿失败。");
  } finally {
    if (isActionCurrent(actionRequest, versionId)) busyAction.value = "";
  }
}

async function closeOpenRound() {
  if (!openRound.value || !canCloseOpenRound.value) return;
  const roundId = openRound.value.id;
  await run("close", () => closeContractNegotiationRound(roundId), "本轮磋商已关闭。");
}

async function retryRevision(revisionId: string) {
  await run(`retry-${revisionId}`, () => retryContractOfflineRevision(revisionId), "修订稿已重新进入比较队列。");
}

function showError(value: string) {
  message.value = value;
  messageTone.value = "error";
}

function resetVersionState() {
  requestId += 1;
  actionRequestId += 1;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
  rounds.value = [];
  offlineRevisionHistory.value = [];
  selection.value = null;
  loading.value = false;
  busyAction.value = "";
  openRoundDialogVisible.value = false;
  roundNote.value = "";
  clearUploadState();
  message.value = "";
  messageTone.value = "success";
  emit("selection", null);
}

function clearUploadState() {
  revisionFiles.value = [];
  revisionLabel.value = "线下修订稿";
  revisionNote.value = "";
  revisionConfirmed.value = false;
}

function isActionCurrent(actionRequest: number, versionId: string) {
  return canApplyContractNegotiationResponse(
    actionRequest,
    actionRequestId,
    versionId,
    props.versionId
  );
}

function showUploadReselectMessage(uploadedForVersionId: string) {
  if (props.versionId === uploadedForVersionId) return;
  message.value = "合同版本已切换，本次上传结果已丢弃，请重新选择文件。";
  messageTone.value = "error";
}

function timeText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.negotiation-section,
.section-head > div,
.upload-panel,
.round-card,
.revision-list,
.legacy-revision-history,
.legacy-revision-list,
.legacy-revision-card,
.legacy-revision-copy {
  display: grid;
  gap: var(--jg-space-sm);
}

.section-head,
.round-head,
.upload-actions,
.revision-choice,
.legacy-revision-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-sm);
}

.section-head span,
.muted,
.revision-choice small,
.legacy-revision-head span,
.legacy-revision-copy span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.upload-panel,
.round-card,
.legacy-revision-history {
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.legacy-revision-card {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  padding: var(--jg-space-sm);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.legacy-revision-note,
.legacy-revision-error {
  grid-column: 1 / -1;
}

.legacy-revision-error {
  color: var(--jg-danger);
  font-size: var(--jg-font-meta);
}

.upload-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.revision-choice {
  padding: var(--jg-space-sm);
  color: var(--jg-text-main);
  text-align: left;
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.revision-choice.active {
  border-color: var(--jg-primary);
  border-left: var(--jg-border-width-accent) solid var(--jg-primary);
}

.revision-copy {
  display: grid;
  gap: var(--jg-space-xs);
}
</style>
