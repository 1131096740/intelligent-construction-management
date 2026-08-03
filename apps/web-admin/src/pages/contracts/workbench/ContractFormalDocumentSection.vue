<template>
  <section
    class="formal-section"
    aria-label="乙方签章完整审批文件"
  >
    <div class="section-head">
      <div>
        <strong>乙方签章完整审批 PDF</strong>
        <span>必须包含正文、附件与清单、所需授权委托书和最终签署页。</span>
      </div>
      <t-tag
        :theme="formalStatus.tone"
        size="small"
        variant="light"
      >
        {{ formalStatus.label }}
      </t-tag>
    </div>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
    />
    <t-alert
      v-if="!authorizationReady"
      theme="warning"
      message="请先完成我方和乙方授权选择，再上传已合并的审批 PDF。"
    />

    <div class="declarations">
      <t-checkbox
        v-model="declaration.counterpartySigned"
        :disabled="uploadDisabled"
      >
        乙方已在合同签署页完成签字
      </t-checkbox>
      <t-checkbox
        v-model="declaration.counterpartyStamped"
        :disabled="uploadDisabled"
      >
        乙方已加盖合同印章
      </t-checkbox>
      <t-checkbox
        v-model="declaration.crossPageSealCompleted"
        :disabled="uploadDisabled"
      >
        多页文件已按规则加盖骑缝章（单页亦确认）
      </t-checkbox>
      <t-checkbox
        v-model="declaration.documentOrderConfirmed"
        :disabled="uploadDisabled"
      >
        已确认正文、附件、清单和签署页顺序完整
      </t-checkbox>
      <t-checkbox
        v-model="declaration.authorizationsBeforeSignaturePageConfirmed"
        :disabled="uploadDisabled"
      >
        所需授权委托书已放在最终签署页之前
      </t-checkbox>
    </div>

    <t-upload
      v-model="files"
      theme="file-input"
      accept=".pdf,application/pdf"
      :auto-upload="true"
      :max="1"
      :disabled="uploadDisabled || !declarationComplete"
      :request-method="uploadApprovalPdf"
      placeholder="选择完整审批 PDF"
    />

    <div
      v-if="stagedFileId"
      class="retry-row"
    >
      <span>{{ stagedRevisionDrift
        ? `文件对应 R${stagedAssociation?.sourceRevision}，当前已是 R${workbench.version.draftRevision}，不能将旧 PDF 提升为新修订。请重新生成并选择 PDF。`
        : "文件已安全上传，业务关联尚未完成，重试不会再次上传。" }}</span>
      <t-button
        size="small"
        variant="outline"
        :loading="busy"
        :disabled="stagedRevisionDrift"
        @click="retryAssociation"
      >
        重试关联
      </t-button>
    </div>

    <dl
      v-if="formalFile"
      class="formal-facts"
    >
      <div><dt>修订</dt><dd>R{{ formalFile.sourceRevision }} / 当前 R{{ workbench.version.draftRevision }}</dd></div>
      <div><dt>文件</dt><dd>{{ formalFile.pageCount }} 页 · SHA {{ shaText(formalFile.contentSha256) }}</dd></div>
      <div><dt>来源</dt><dd>本合同工作台上传的原始 PDF</dd></div>
      <div><dt>状态</dt><dd>{{ formalStatus.detail }}</dd></div>
      <div><dt>声明</dt><dd>{{ declarationSummary(formalFile.declarationSnapshot) }}</dd></div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import type { RequestMethodResponse, UploadFile } from "tdesign-vue-next";
import { computed, reactive, ref } from "vue";
import {
  fetchContractDraftOperationCapabilities,
  uploadContractFormalApprovalFile,
  uploadContractWorkbenchPrivateFile
} from "../../../api/contract-workbench.api";

async function uploadContractFormalFileWithCapability(
  contractVersionId: string,
  file: Blob,
  fileName: string
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同正式文件能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_workbench_private_file"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能上传合同正式文件");
  }
  return uploadContractWorkbenchPrivateFile(contractVersionId, file, fileName);
}

async function uploadContractFormalApprovalFileWithCapability(
  contractVersionId: string,
  body: Parameters<typeof uploadContractFormalApprovalFile>[1]
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同正式文件能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_formal_approval_file"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能关联完整审批文件");
  }
  return uploadContractFormalApprovalFile(contractVersionId, body);
}

const props = defineProps<{
  workbench: ContractWorkbenchReadModel;
  disabled: boolean;
  prepareMutation: () => Promise<ContractWorkbenchReadModel | null>;
  completeMutation: (reload: boolean) => Promise<void>;
}>();

type FormalDeclaration = {
  counterpartySigned: boolean;
  counterpartyStamped: boolean;
  crossPageSealCompleted: boolean;
  documentOrderConfirmed: boolean;
  authorizationsBeforeSignaturePageConfirmed: boolean;
};
type StagedFormalAssociation = {
  fileId: string;
  contractVersionId: string;
  sourceRevision: number;
  declaration: FormalDeclaration;
};

const files = ref<UploadFile[]>([]);
const busy = ref(false);
const stagedAssociation = ref<StagedFormalAssociation | null>(null);
const stagedFileId = computed(() => stagedAssociation.value?.fileId ?? "");
const message = ref("");
const messageTone = ref<"success" | "error">("success");
const declaration = reactive({
  counterpartySigned: false,
  counterpartyStamped: false,
  crossPageSealCompleted: false,
  documentOrderConfirmed: false,
  authorizationsBeforeSignaturePageConfirmed: false
});

const authorizationReady = computed(() => {
  const links = props.workbench.governance?.authorizationLinks ?? [];
  const authorizations = props.workbench.governance?.authorizations ?? [];
  return (["first_party", "counterparty"] as const).every((side) => {
    const link = links.find((item) => item.side === side);
    if (!link) return false;
    if (!link.required) return link.authorizationId === null;
    return authorizations.some((authorization) =>
      authorization.id === link.authorizationId &&
      authorization.side === side &&
      authorization.status === "active"
    );
  });
});
const stagedRevisionDrift = computed(() => Boolean(
  stagedAssociation.value &&
  (
    stagedAssociation.value.contractVersionId !== props.workbench.version.id ||
    stagedAssociation.value.sourceRevision !== props.workbench.version.draftRevision
  )
));
const uploadDisabled = computed(() => props.disabled || busy.value || !authorizationReady.value);
const declarationComplete = computed(() => Object.values(declaration).every(Boolean));
const formalFile = computed(() =>
  props.workbench.governance?.formalFiles.find((item) => item.purpose === "approval") ?? null
);
const formalStatus = computed(() => {
  const file = formalFile.value;
  if (!file) return { label: "尚未上传", detail: "当前修订尚无完整审批 PDF", tone: "warning" as const };
  if (file.status !== "active") return { label: "已过期或被替代", detail: "需重新上传当前修订文件", tone: "danger" as const };
  if (file.sourceRevision !== props.workbench.version.draftRevision) {
    return { label: "已过期", detail: "草稿已修改，该 PDF 不再对应当前修订", tone: "danger" as const };
  }
  return { label: "当前有效", detail: "文件与当前草稿修订一致", tone: "success" as const };
});

async function uploadApprovalPdf(selected: UploadFile | UploadFile[]): Promise<RequestMethodResponse> {
  if (busy.value) return failed("文件正在处理，请勿重复提交。");
  const upload = Array.isArray(selected) ? selected[0] : selected;
  if (!upload?.raw) return failed("请重新选择 PDF 文件。");
  busy.value = true;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    const uploaded = await uploadContractFormalFileWithCapability(
      current.version.id,
      upload.raw,
      upload.name || upload.raw.name
    );
    stagedAssociation.value = {
      fileId: uploaded.id,
      contractVersionId: current.version.id,
      sourceRevision: current.version.draftRevision,
      declaration: { ...declaration }
    };
    await associate(stagedAssociation.value);
    stagedAssociation.value = null;
    reload = true;
    showSuccess("完整审批 PDF 已关联到当前草稿修订。");
    return { status: "success", response: { url: `private-file:${uploaded.id}`, fileId: uploaded.id } };
  } catch (error) {
    const text = errorText(error, "完整审批 PDF 处理失败，请重试。");
    showError(text);
    return failed(text, stagedFileId.value);
  } finally {
    if (prepared) await finishMutation(reload);
    busy.value = false;
  }
}

async function retryAssociation() {
  if (busy.value || !stagedAssociation.value) return;
  busy.value = true;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    const staged = stagedAssociation.value;
    if (
      staged.contractVersionId !== current.version.id ||
      staged.sourceRevision !== current.version.draftRevision
    ) {
      throw new Error(`原 PDF 对应 R${staged.sourceRevision}，当前草稿已是 R${current.version.draftRevision}，请重新生成并选择 PDF。`);
    }
    await associate(staged);
    stagedAssociation.value = null;
    files.value = [];
    reload = true;
    showSuccess("完整审批 PDF 已关联，未重复上传文件。");
  } catch (error) {
    showError(errorText(error, "业务关联仍未完成，原文件已保留，请稍后重试。"));
  } finally {
    if (prepared) await finishMutation(reload);
    busy.value = false;
  }
}

function associate(staged: StagedFormalAssociation) {
  return uploadContractFormalApprovalFileWithCapability(staged.contractVersionId, {
    fileId: staged.fileId,
    sourceRevision: staged.sourceRevision,
    ...staged.declaration
  });
}

async function finishMutation(reload: boolean) {
  try {
    await props.completeMutation(reload);
  } catch (error) {
    showError(errorText(error, "操作已完成，但最新状态读取失败，请刷新页面。"));
  }
}

function declarationSummary(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  const facts = value as Record<string, unknown>;
  return [
    facts["counterpartySigned"] && "乙方已签字",
    facts["counterpartyStamped"] && "乙方已盖章",
    facts["crossPageSealCompleted"] && "骑缝章已确认",
    facts["documentOrderConfirmed"] && "页面顺序已确认",
    facts["authorizationsBeforeSignaturePageConfirmed"] && "授权页位置已确认"
  ].filter(Boolean).join("、") || "—";
}

function shaText(value: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function failed(error: string, fileId = ""): RequestMethodResponse {
  return { status: "fail", error, response: { error, fileId } };
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
</script>

<style scoped>
.formal-section,
.section-head > div,
.declarations,
.formal-facts {
  display: grid;
  gap: var(--jg-space-sm);
}

.formal-section {
  gap: var(--jg-space-md);
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.section-head,
.retry-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.section-head span,
.retry-row,
.formal-facts dt {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.declarations {
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  border-radius: var(--jg-radius-sm);
}

.formal-facts {
  margin: 0;
}

.formal-facts > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: var(--jg-space-sm);
}

.formal-facts dt,
.formal-facts dd {
  margin: 0;
}

.formal-facts dd {
  overflow-wrap: anywhere;
}

@container jg-page (max-width: 720px) {
  .section-head,
  .retry-row {
    flex-direction: column;
  }
}
</style>
