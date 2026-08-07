<template>
  <section
    class="counterparty-panel"
    aria-label="乙方签章灵活格式文件"
  >
    <div class="panel-heading">
      <div>
        <strong>乙方签章灵活格式文件</strong>
        <span>接收 PDF、DOCX 或多张 PNG/JPEG 图片；混合格式需分批上传，系统生成规范化预览后由经办人整体确认。</span>
      </div>
      <t-tag
        :theme="status.tone"
        size="small"
        variant="light"
      >
        {{ status.label }}
      </t-tag>
    </div>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
    />
    <t-alert
      v-if="revisionDrift"
      theme="warning"
      message="草稿内容已修改，原乙方签章确认已失效。请重新上传当前修订的乙方签章文件并再次确认。"
    />

    <t-upload
      v-model="files"
      theme="file-input"
      accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
      :auto-upload="false"
      :multiple="true"
      :max="20"
      :disabled="uploadDisabled"
      placeholder="选择乙方签章文件（PDF / DOCX / PNG / JPEG，可多选）"
    />

    <div
      v-if="files.length"
      class="staged-files"
    >
      <span>{{ files.length }} 个文件待提交：{{ files.map((item) => item.name).join("、") }}</span>
    </div>

    <div class="panel-actions">
      <t-button
        variant="outline"
        :loading="busy"
        :disabled="!canSubmit"
        @click="submitFiles"
      >
        提交乙方签章文件
      </t-button>
      <t-button
        variant="outline"
        :loading="busy"
        :disabled="!canConfirm"
        @click="confirmSigned"
      >
        确认乙方签章文件
      </t-button>
    </div>

    <dl
      v-if="record && (record.originalFiles.length || record.preview)"
      class="counterparty-facts"
    >
      <template v-if="record.originalFiles.length">
        <div class="fact-block">
          <dt>原始文件</dt>
          <dd>
            <ul class="file-list">
              <li
                v-for="item in record.originalFiles"
                :key="item.formalFileId"
              >
                {{ item.fileName }} · {{ mimeLabel(item.mimeType) }}
              </li>
            </ul>
          </dd>
        </div>
      </template>
      <template v-if="record.preview">
        <div class="fact-block">
          <dt>规范化预览</dt>
          <dd>
            {{ record.preview.pageCount }} 页 · {{ modeText(record.preview.mode) }}
            <template v-if="record.preview.confirmedByUserId">
              · 已确认于 {{ record.preview.confirmedAt ?? "—" }}
            </template>
          </dd>
        </div>
        <div class="fact-block">
          <dt>修订</dt>
          <dd>R{{ record.preview.sourceRevision }} / 当前 R{{ record.draftRevision }}</dd>
        </div>
      </template>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import {
  confirmCounterpartySignedFile,
  fetchContractDraftOperationCapabilities,
  listCounterpartySignedFiles,
  type CounterpartySignedReadModel,
  uploadContractWorkbenchPrivateFile,
  uploadCounterpartySignedFiles
} from "../../../api/contract-workbench.api";

const props = defineProps<{
  workbench: ContractWorkbenchReadModel;
  disabled: boolean;
  prepareMutation: () => Promise<ContractWorkbenchReadModel | null>;
  completeMutation: (reload: boolean) => Promise<void>;
}>();

const files = ref<UploadFile[]>([]);
const record = ref<CounterpartySignedReadModel | null>(null);
const busy = ref(false);
const message = ref("");
const messageTone = ref<"info" | "success" | "error">("info");

const uploadDisabled = computed(() => props.disabled || busy.value);
const canSubmit = computed(() => !props.disabled && !busy.value && files.value.some((item) => item.raw));
const revisionDrift = computed(() => {
  const preview = record.value?.preview;
  if (!preview || !preview.confirmedByUserId) return false;
  return !preview.confirmationValid || preview.sourceRevision !== record.value?.draftRevision;
});
const canConfirm = computed(() => {
  const preview = record.value?.preview;
  return Boolean(
    !props.disabled &&
    !busy.value &&
    preview &&
    !revisionDrift.value &&
    preview.sourceRevision === record.value?.draftRevision
  );
});
const status = computed(() => {
  const preview = record.value?.preview;
  if (!preview) return { label: "待上传", tone: "default" as const };
  if (!preview.confirmedByUserId) return { label: "已上传待确认", tone: "warning" as const };
  if (revisionDrift.value) return { label: "已过期", tone: "danger" as const };
  return { label: "已确认", tone: "success" as const };
});

function modeText(mode: string) {
  if (mode === "inline_pdf") return "原始 PDF 直接预览";
  if (mode === "converted_pdf") return "DOCX 转换预览";
  if (mode === "merged_images_pdf") return "多图合并预览";
  return "规范化预览";
}

function mimeLabel(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/jpeg") return "JPEG";
  return mimeType;
}

async function refresh() {
  try {
    record.value = await listCounterpartySignedFiles(props.workbench.version.id);
  } catch (error) {
    showError(errorText(error, "乙方签章文件状态读取失败，请刷新页面。"));
  }
}

async function uploadPrivateFileWithCapability(
  contractVersionId: string,
  file: Blob,
  fileName: string
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同乙方签章能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_workbench_private_file"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能上传乙方签章原始文件");
  }
  return uploadContractWorkbenchPrivateFile(contractVersionId, file, fileName);
}

async function uploadCounterpartySignedFilesWithCapability(
  contractVersionId: string,
  body: Parameters<typeof uploadCounterpartySignedFiles>[1]
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同乙方签章能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_counterparty_signed_files"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能提交乙方签章文件");
  }
  return uploadCounterpartySignedFiles(contractVersionId, body);
}

async function confirmCounterpartySignedFileWithCapability(
  contractVersionId: string,
  body: Parameters<typeof confirmCounterpartySignedFile>[1]
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同乙方签章能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "confirm_contract_counterparty_signed_files"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能确认乙方签章文件");
  }
  return confirmCounterpartySignedFile(contractVersionId, body);
}

async function submitFiles() {
  if (busy.value) return;
  const raws = files.value.filter((item) => item.raw).map((item) => item.raw as File);
  if (!raws.length) return;
  busy.value = true;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    const fileIds: string[] = [];
    for (const raw of raws) {
      const uploaded = await uploadPrivateFileWithCapability(
        current.version.id,
        raw,
        raw.name
      );
      fileIds.push(uploaded.id);
    }
    await uploadCounterpartySignedFilesWithCapability(current.version.id, {
      fileIds,
      sourceRevision: current.version.draftRevision
    });
    files.value = [];
    reload = true;
    await refresh();
    showSuccess(`乙方签章文件已提交并冻结到 R${current.version.draftRevision}，请确认预览。`);
  } catch (error) {
    showError(errorText(error, "乙方签章文件提交失败，原文件已保留，请重试。"));
  } finally {
    if (prepared) await finishMutation(reload);
    busy.value = false;
  }
}

async function confirmSigned() {
  const preview = record.value?.preview;
  if (busy.value || !preview) return;
  busy.value = true;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    await confirmCounterpartySignedFileWithCapability(current.version.id, {
      formalFileId: preview.formalFileId,
      expectedDraftRevision: current.version.draftRevision
    });
    reload = true;
    await refresh();
    showSuccess("乙方签章文件已确认并冻结到当前草稿修订。");
  } catch (error) {
    showError(errorText(error, "乙方签章文件确认失败，请重试。"));
  } finally {
    if (prepared) await finishMutation(reload);
    busy.value = false;
  }
}

async function finishMutation(reload: boolean) {
  try {
    await props.completeMutation(reload);
  } catch (error) {
    showError(errorText(error, "操作已完成，但最新状态读取失败，请刷新页面。"));
  }
}

function showSuccess(text: string) {
  messageTone.value = "success";
  message.value = text;
}

function showError(text: string) {
  messageTone.value = "error";
  message.value = text;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

onMounted(refresh);

watch(
  () => props.workbench.version.id,
  () => refresh()
);
</script>

<style scoped>
.counterparty-panel,
.panel-heading > div,
.counterparty-facts,
.fact-block {
  display: grid;
  gap: var(--jg-space-sm);
}

.counterparty-panel {
  gap: var(--jg-space-md);
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.panel-heading,
.panel-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.panel-heading span,
.staged-files,
.counterparty-facts dt {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.panel-actions {
  flex-wrap: wrap;
}

.staged-files {
  overflow-wrap: anywhere;
}

.counterparty-facts {
  margin: 0;
}

.fact-block {
  grid-template-columns: 96px minmax(0, 1fr);
}

.counterparty-facts dt,
.counterparty-facts dd {
  margin: 0;
}

.counterparty-facts dd {
  overflow-wrap: anywhere;
}

.file-list {
  display: grid;
  gap: var(--jg-space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

@container jg-page (max-width: 720px) {
  .panel-heading,
  .panel-actions {
    flex-direction: column;
  }
}
</style>
