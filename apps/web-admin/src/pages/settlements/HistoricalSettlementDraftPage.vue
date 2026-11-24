<template>
  <section class="historical-settlement-draft">
    <BusinessPageHeader title="历史结算草稿">
      <template #actions>
        <t-button variant="outline" @click="router.push('/结算工作台')">返回结算台账</t-button>
      </template>
    </BusinessPageHeader>
    <BusinessFeedback v-if="error" state="error" title="历史草稿暂时无法读取" :description="error" />
    <t-loading v-else :loading="loading">
      <template v-if="draft">
        <t-descriptions :column="2" bordered>
          <t-descriptions-item label="结算编号">{{ draft.code || "—" }}</t-descriptions-item>
          <t-descriptions-item label="结算期间">{{ draft.periodLabel || "—" }}</t-descriptions-item>
          <t-descriptions-item label="项目">{{ projectLabel }}</t-descriptions-item>
          <t-descriptions-item label="历史状态">{{ statusLabels[draft.status] || '历史记录' }}</t-descriptions-item>
          <t-descriptions-item label="结算类型">{{ draft.isFinal ? "最终结算" : "过程结算" }}</t-descriptions-item>
          <t-descriptions-item v-if="draft.abandonReason" label="放弃原因">{{ draft.abandonReason }}</t-descriptions-item>
        </t-descriptions>
        <t-link
          v-if="draft.submittedSettlementId"
          theme="primary"
          @click="router.push(`/settlements/${draft.submittedSettlementId}`)"
        >查看正式结算</t-link>
        <h2>历史结算明细</h2>
        <t-table row-key="key" :columns="lineColumns" :data="lines" size="small" />
        <h2>历史文件</h2>
        <t-alert v-if="fileError" theme="warning" :message="fileError" />
        <t-alert v-if="downloadError" theme="warning" :message="downloadError" />
        <p v-if="!historyFiles.length && !fileError">暂无历史文件</p>
        <ul v-else-if="historyFiles.length">
          <li v-for="file in historyFiles" :key="file.id">
            <span>{{ file.label }} · {{ file.fileName }}</span>
            <t-button size="small" variant="text" :loading="downloadingFile === file.id" :disabled="downloadingFile !== null" @click="downloadHistoryFile(file)">下载</t-button>
          </li>
        </ul>
      </template>
    </t-loading>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import {
  fetchSettlementDraftRecord,
  listSettlementDraftLineAttachments,
  listSettlementDraftRecords,
  type SettlementDraftReadModel,
  type SettlementLineAttachmentReadModel
} from "../../api/settlement-drafts.api";
import {
  createPrivateFileDownloadTicket,
  fetchProjects,
  getPrivateFileDownloadTicketCapability
} from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";

type HistoryFile = { id: string; fileId: string; label: string; fileName: string };
const route = useRoute();
const router = useRouter();
const draft = ref<SettlementDraftReadModel | null>(null);
const attachments = ref<SettlementLineAttachmentReadModel[]>([]);
const projectLabel = ref("");
const error = ref("");
const fileError = ref("");
const loading = ref(false);
const downloadingFile = ref<string | null>(null);
const downloadError = ref("");
const statusLabels = { draft: "历史草稿", submitted: "已提交", abandoned: "已放弃" };
const lineColumns = [
  { colKey: "name", title: "明细", minWidth: 180 },
  { colKey: "quantity", title: "数量", width: 110 },
  { colKey: "amount", title: "金额（元）", width: 130 },
  { colKey: "reason", title: "说明", minWidth: 180 }
];
const lines = computed(() => (draft.value?.lines ?? []).map((line, index) => ({
  key: index,
  name: line.name || line.description || `第 ${index + 1} 条明细`,
  quantity: [line.quantity, line.unit].filter(Boolean).join(" ") || "—",
  amount: typeof line.amountCents === "string" ? centsTextToYuanText(line.amountCents) : "—",
  reason: [line.reason, line.remark].filter(Boolean).join(" · ") || "—"
})));
const historyFiles = computed<HistoryFile[]>(() => {
  const documents = draft.value?.documents;
  const frozen = documents?.frozenDocument;
  const original = documents?.counterpartySignedOriginal;
  return [
    ...(frozen ? [{ ...frozen, label: "冻结结算单" }] : []),
    ...(original ? [{ ...original, label: "乙方签章原件" }] : []),
    ...attachments.value.filter(file => file.status === "active").map(file => ({
      ...file,
      label: file.purpose || "明细附件"
    }))
  ];
});

function routeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

watch(() => [routeText(route.query.project), routeText(route.query.draftId)], async ([project, id], _prior, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  draft.value = null;
  attachments.value = [];
  error.value = "";
  fileError.value = "";
  downloadError.value = "";
  if (!id) {
    await router.replace("/结算工作台/已签登记");
    return;
  }

  loading.value = true;
  try {
    const projects = await fetchProjects();
    const matches = project ? projects.filter(row => [row.id, row.code, row.name].includes(project)) : projects;
    let owner = project && matches.length === 1 ? matches[0] : undefined;
    if (!project) {
      for (const visibleProject of matches) {
        if (!current) return;
        const records = await listSettlementDraftRecords(visibleProject.id).catch(() => []);
        if (records.some(record => record.id === id)) {
          owner = visibleProject;
          break;
        }
      }
    }
    if (!current) return;
    if (!owner) throw new Error("未找到可查看的历史草稿，请从结算台账重新进入。");
    const result = await fetchSettlementDraftRecord(owner.id, id);
    if (!current) return;
    if (result.id !== id || result.projectId !== owner.id) throw new Error("历史草稿读取坐标不一致。");
    draft.value = result;
    projectLabel.value = owner.name;
    try {
      const files = await listSettlementDraftLineAttachments(owner.id, id);
      if (current) attachments.value = files;
    } catch (cause) {
      if (current) fileError.value = formatUnknownApiError(cause, "读取历史结算附件失败。");
    }
  } catch (cause) {
    if (current) error.value = formatUnknownApiError(cause, "读取历史结算草稿失败。");
  } finally {
    if (current) loading.value = false;
  }
}, { immediate: true });

async function createHistoricalDownloadTicketWithCapability(fileId: string) {
  const capability = await getPrivateFileDownloadTicketCapability(fileId);
  const operationAllowed = capability.availableActions.includes("create_private_file_download_ticket");
  if (!operationAllowed) throw new Error("当前账号无权下载该历史文件。");
  return createPrivateFileDownloadTicket(fileId, {});
}

async function downloadHistoryFile(file: HistoryFile) {
  if (downloadingFile.value !== null) return;
  const requestedDraft = draft.value;
  downloadingFile.value = file.id;
  downloadError.value = "";
  try {
    const ticket = await createHistoricalDownloadTicketWithCapability(file.fileId);
    if (draft.value !== requestedDraft) return;
    const downloadUrl = ticket.downloadUrl.replace(/^\/api(?=\/)/u, "");
    const prefix = `/files/${encodeURIComponent(file.fileId)}/download?`;
    if (!downloadUrl.startsWith(prefix) || downloadUrl.includes("\\")) {
      throw new Error("历史结算文件下载地址无效，请重新申请。");
    }
    const link = document.createElement("a");
    link.href = `/api${downloadUrl}`;
    link.download = ticket.fileName;
    link.click();
  } catch (cause) {
    if (draft.value === requestedDraft) downloadError.value = formatUnknownApiError(cause, "下载历史结算文件失败。");
  } finally {
    downloadingFile.value = null;
  }
}
</script>

<style scoped>
.historical-settlement-draft {
  display: grid;
  gap: var(--jg-space-4);
}
.historical-settlement-draft h2 {
  font-size: var(--jg-text-lg);
}
</style>
