<template>
  <section class="line-attachment-panel jg-table-region jg-table-region--standard">
    <div class="section-title">
      <div><strong>结算明细附件</strong><span>附件关联至已保存的具体明细；更新附件会使当前冻结结算单失效。</span></div>
      <t-button
        variant="outline"
        :loading="loading"
        @click="load"
      >
        刷新
      </t-button>
    </div>
    <t-alert
      v-if="disabledReason"
      theme="info"
      :message="disabledReason"
    />
    <div
      v-else
      class="attachment-form"
    >
      <t-select
        v-model="lineKey"
        label="结算明细"
        :options="lineOptions"
        placeholder="请选择明细"
      />
      <t-input
        v-model="purpose"
        label="附件用途"
        placeholder="如：现场签证单、计量凭证"
      />
      <!-- ui-rules-ignore: native-file-input -->
      <input
        ref="fileInput"
        class="native-file-input"
        type="file"
        @change="selectFile"
      >
      <t-button
        theme="primary"
        :loading="uploading"
        :disabled="!lineKey || !purpose.trim()"
        @click="fileInput?.click()"
      >
        上传并关联
      </t-button>
    </div>
    <t-table
      row-key="id"
      size="small"
      :data="attachments"
      :columns="columns"
      :loading="loading"
      :pagination="false"
    >
      <template #status="{ row }">
        <t-tag :theme="row.status === 'active' ? 'success' : 'default'">
          {{ row.status === 'active' ? '有效' : '已作废' }}
        </t-tag>
      </template>
      <template #operation="{ row }">
        <t-popconfirm
          v-if="row.status === 'active' && !disabledReason"
          content="作废后保留审计记录，并需要重新生成冻结结算单。"
          @confirm="invalidate(row.id)"
        >
          <t-link theme="danger">
            作废
          </t-link>
        </t-popconfirm>
      </template>
    </t-table>
    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
      class="panel-message"
    />
  </section>
</template>

<script setup lang="ts">
import type { PrimaryTableCol } from "tdesign-vue-next";
import { computed, ref, watch } from "vue";
import { formatUnknownApiError } from "../../../api/error-message";
import {
  attachSettlementDraftLineFile,
  fetchSettlementProjectCapability,
  invalidateSettlementDraftLineAttachment,
  listSettlementDraftLineAttachments,
  uploadSettlementDraftPrivateFile,
  type SettlementLineAttachmentReadModel
} from "../../../api/settlement-drafts.api";

const props = defineProps<{ projectId: string; draftId: string; revision: number; lines: Array<{ lineKey: string; label: string }>; disabledReason?: string }>();
const emit = defineEmits<{ updated: [revision: number] }>();
const attachments = ref<SettlementLineAttachmentReadModel[]>([]);
const loading = ref(false); const uploading = ref(false); const lineKey = ref(""); const purpose = ref("");
const fileInput = ref<HTMLInputElement | null>(null); const message = ref(""); const messageTone = ref<"success" | "error" | "info">("info");
const lineOptions = computed(() => props.lines.map((line) => ({ label: line.label, value: line.lineKey })));
const columns: PrimaryTableCol<SettlementLineAttachmentReadModel>[] = [
  { colKey: "lineKey", title: "结算明细", width: 220, ellipsis: true }, { colKey: "fileName", title: "附件文件", minWidth: 200, ellipsis: true },
  { colKey: "purpose", title: "用途", minWidth: 160, ellipsis: true }, { colKey: "status", title: "状态", width: 92 }, { colKey: "operation", title: "操作", width: 80, fixed: "right" }
];
watch(() => [props.projectId, props.draftId], () => void load(), { immediate: true });
async function load() { if (!props.projectId || !props.draftId) return; loading.value = true; try { attachments.value = await listSettlementDraftLineAttachments(props.projectId, props.draftId); } catch (error) { setMessage(formatUnknownApiError(error, "读取结算明细附件失败"), "error"); } finally { loading.value = false; } }
function selectFile(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) void uploadAndAttach(file); if (fileInput.value) fileInput.value.value = ""; }

async function attachSettlementLineFileWithCapability(file: File) {
  const capability = await fetchSettlementProjectCapability(props.projectId);
  const matchesRequestedProject = capability.projectId === props.projectId;
  if (!matchesRequestedProject) throw new Error("结算项目已变化，请刷新工作台后重试");
  const operationAllowed = capability.availableActions.includes("attach_line_file");
  if (!operationAllowed) throw new Error("当前用户不能上传结算明细附件");
  const uploaded = await uploadSettlementDraftPrivateFile(
    props.projectId,
    file,
    file.name
  );
  return attachSettlementDraftLineFile(
    props.projectId,
    props.draftId,
    lineKey.value,
    {
      fileId: uploaded.id,
      purpose: purpose.value.trim(),
      expectedRevision: props.revision
    }
  );
}

async function invalidateSettlementLineAttachmentWithCapability(attachmentId: string) {
  const capability = await fetchSettlementProjectCapability(props.projectId);
  const matchesRequestedProject = capability.projectId === props.projectId;
  if (!matchesRequestedProject) throw new Error("结算项目已变化，请刷新工作台后重试");
  const operationAllowed = capability.availableActions.includes(
    "invalidate_line_attachment"
  );
  if (!operationAllowed) throw new Error("当前用户不能作废结算明细附件");
  return invalidateSettlementDraftLineAttachment(
    props.projectId,
    props.draftId,
    attachmentId,
    props.revision
  );
}

async function uploadAndAttach(file: File) {
  if (props.disabledReason || !lineKey.value || !purpose.value.trim()) return;
  uploading.value = true;
  try {
    const result = await attachSettlementLineFileWithCapability(file);
    purpose.value = "";
    emit("updated", result.revision);
    await load();
    setMessage("附件已关联；请重新生成冻结结算单。", "success");
  } catch (error) {
    setMessage(formatUnknownApiError(error, "附件关联失败"), "error");
  } finally {
    uploading.value = false;
  }
}

async function invalidate(attachmentId: string) {
  if (props.disabledReason) return;
  try {
    const result = await invalidateSettlementLineAttachmentWithCapability(attachmentId);
    emit("updated", result.revision);
    await load();
    setMessage("附件已作废；请重新生成冻结结算单。", "success");
  } catch (error) {
    setMessage(formatUnknownApiError(error, "作废附件失败"), "error");
  }
}
function setMessage(next: string, tone: "success" | "error" | "info") { message.value = next; messageTone.value = tone; }
</script>

<style scoped>
.attachment-form { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(180px, 1fr) auto; gap: var(--jg-space-md); align-items: end; margin: var(--jg-space-md) 0; }
.native-file-input { display: none; }.panel-message { margin-top: var(--jg-space-md); }
@media (max-width: 900px) { .attachment-form { grid-template-columns: 1fr; } }
</style>
