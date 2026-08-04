<template>
  <section
    class="governance-section"
    aria-label="双方授权委托书"
  >
    <div class="section-head">
      <div>
        <strong>双方授权委托书</strong>
        <span>先明确我方和乙方是否需要授权委托书，再组合完整审批 PDF。</span>
      </div>
    </div>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
    />

    <div class="authorization-grid">
      <article
        v-for="side in sides"
        :key="side.key"
        class="authorization-unit"
      >
        <div class="unit-head">
          <strong>{{ side.label }}</strong>
          <t-tag
            :theme="statusView(side.key).tone"
            size="small"
            variant="light"
          >
            {{ statusView(side.key).label }}
          </t-tag>
        </div>

        <t-radio-group
          v-model="forms[side.key].choice"
          :disabled="disabled || busySide !== ''"
          @change="onChoiceChange(side.key, $event)"
        >
          <t-radio value="not_required">
            不需要授权委托书
          </t-radio>
          <t-radio value="required">
            需要授权委托书
          </t-radio>
        </t-radio-group>

        <div
          v-if="forms[side.key].choice === 'required'"
          class="authorization-required"
        >
          <t-radio-group
            v-model="forms[side.key].mode"
            :disabled="disabled || busySide !== ''"
            @change="onModeChange(side.key, $event)"
          >
            <t-radio value="upload">
              上传本版本授权文件
            </t-radio>
            <t-radio
              value="reuse"
              :disabled="reuseCandidates(side.key).length === 0"
            >
              复用本合同历史授权
            </t-radio>
          </t-radio-group>
          <div
            v-if="forms[side.key].mode === 'upload'"
            class="authorization-fields"
          >
            <t-input
              v-model="forms[side.key].grantorName"
              :disabled="disabled || busySide !== ''"
              placeholder="授权人/单位名称"
            />
            <t-input
              v-model="forms[side.key].agentName"
              :disabled="disabled || busySide !== ''"
              placeholder="代理人姓名"
            />
            <t-textarea
              v-model="forms[side.key].scopeSummary"
              :disabled="disabled || busySide !== ''"
              :autosize="{ minRows: 2, maxRows: 3 }"
              placeholder="授权范围，例如：签署、履行、变更及补充协议"
            />
          </div>
          <t-upload
            v-if="forms[side.key].mode === 'upload'"
            v-model="forms[side.key].files"
            theme="file-input"
            accept=".pdf,application/pdf"
            :auto-upload="true"
            :max="1"
            :disabled="disabled || busySide !== '' || !authorizationFieldsComplete(side.key)"
            :request-method="authorizationUploadMethod(side.key)"
            placeholder="选择授权委托书 PDF"
          />
          <div
            v-else
            class="reuse-fields"
          >
            <t-select
              v-model="forms[side.key].reuseAuthorizationId"
              :options="reuseCandidateOptions(side.key)"
              :disabled="disabled || busySide !== ''"
              placeholder="选择同一合同的历史授权"
            />
            <t-button
              variant="outline"
              :loading="busySide === side.key"
              :disabled="disabled || busySide !== '' || !forms[side.key].reuseAuthorizationId"
              @click="reuseAuthorization(side.key)"
            >
              确认复用授权
            </t-button>
            <span
              v-if="reuseCandidates(side.key).length === 0"
              class="muted"
            >
              当前合同暂无符合范围、状态和文件完整性要求的历史授权，请上传新文件。
            </span>
          </div>
          <div
            v-if="staged[side.key].fileId"
            class="retry-row"
          >
            <span>{{ stagedContractDrift(side.key)
              ? "该文件属于另一份合同草稿，不能关联到当前合同。请返回原合同重试，或为当前合同重新上传。"
              : "文件已安全上传，业务关联尚未完成，可直接重试。" }}</span>
            <t-button
              size="small"
              variant="outline"
              :loading="busySide === side.key"
              :disabled="stagedContractDrift(side.key)"
              @click="retryAuthorization(side.key)"
            >
              重试关联
            </t-button>
          </div>
        </div>

        <dl
          v-if="authorizationFor(side.key)"
          class="fact-list"
        >
          <div><dt>代理人</dt><dd>{{ authorizationFor(side.key)?.agentName }}</dd></div>
          <div><dt>授权范围</dt><dd>{{ authorizationFor(side.key)?.scopeSummary }}</dd></div>
          <div><dt>来源</dt><dd>{{ sourceText(side.key) }}</dd></div>
          <div><dt>文件</dt><dd>{{ authorizationFor(side.key)?.pageCount }} 页 · SHA {{ shaText(authorizationFor(side.key)?.contentSha256) }}</dd></div>
          <div><dt>状态</dt><dd>{{ authorizationFor(side.key)?.status === 'active' ? '当前有效' : '已过期或被替代' }}</dd></div>
        </dl>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import type { RequestMethodResponse, UploadFile } from "tdesign-vue-next";
import { reactive, ref, watch } from "vue";
import {
  fetchContractDraftOperationCapabilities,
  setContractAuthorization,
  uploadContractWorkbenchPrivateFile,
  type ContractAuthorizationSide
} from "../../../api/contract-workbench.api";
import {
  associateStagedAuthorization,
  type StagedAuthorizationAssociation
} from "./contract-authorization-staging";

async function uploadContractAuthorizationFileWithCapability(
  contractVersionId: string,
  file: Blob,
  fileName: string
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同授权能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "upload_contract_workbench_private_file"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能上传合同授权文件");
  }
  return uploadContractWorkbenchPrivateFile(contractVersionId, file, fileName);
}

async function setContractAuthorizationWithCapability(
  contractVersionId: string,
  body: Parameters<typeof setContractAuthorization>[1]
) {
  const capability = await fetchContractDraftOperationCapabilities(contractVersionId);
  const matchesRequestedVersion = capability.version.id === contractVersionId;
  if (!matchesRequestedVersion) {
    throw new Error("合同授权能力响应版本不一致");
  }
  const operationAllowed = capability.draftOperationAvailableActions.includes(
    "set_contract_authorization"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能修改合同授权事实");
  }
  return setContractAuthorization(contractVersionId, body);
}

type SideForm = {
  choice: "" | "required" | "not_required";
  mode: "upload" | "reuse";
  reuseAuthorizationId: string;
  grantorName: string;
  agentName: string;
  scopeSummary: string;
  files: UploadFile[];
};
const props = defineProps<{
  workbench: ContractWorkbenchReadModel;
  disabled: boolean;
  prepareMutation: () => Promise<ContractWorkbenchReadModel | null>;
  completeMutation: (reload: boolean) => Promise<void>;
}>();

const sides = [
  { key: "first_party" as const, label: "我方授权" },
  { key: "counterparty" as const, label: "乙方授权" }
];
const forms = reactive<Record<ContractAuthorizationSide, SideForm>>({
  first_party: emptyForm(),
  counterparty: emptyForm()
});
const staged = reactive<Record<ContractAuthorizationSide, StagedAuthorizationAssociation>>({
  first_party: emptyStagedAuthorization(),
  counterparty: emptyStagedAuthorization()
});
const busySide = ref<ContractAuthorizationSide | "">("");
const message = ref("");
const messageTone = ref<"success" | "error">("success");

watch(() => props.workbench, syncForms, { immediate: true });

function emptyForm(): SideForm {
  return {
    choice: "",
    mode: "upload",
    reuseAuthorizationId: "",
    grantorName: "",
    agentName: "",
    scopeSummary: "签署、履行、变更及补充协议",
    files: []
  };
}

function emptyStagedAuthorization(): StagedAuthorizationAssociation {
  return {
    fileId: "",
    fileName: "",
    contractVersionId: "",
    grantorName: "",
    agentName: "",
    scopeSummary: ""
  };
}

function stagedContractDrift(side: ContractAuthorizationSide) {
  return Boolean(
    staged[side].fileId && staged[side].contractVersionId !== props.workbench.version.id
  );
}

function governance() {
  return props.workbench.governance;
}

function linkFor(side: ContractAuthorizationSide) {
  return governance()?.authorizationLinks.find((link) => link.side === side) ?? null;
}

function authorizationFor(side: ContractAuthorizationSide) {
  const link = linkFor(side);
  return governance()?.authorizations.find((item) => item.id === link?.authorizationId) ?? null;
}

function syncForms() {
  // prepareMutation reloads the workbench to obtain the authoritative revision.
  // Keep the user's unsent fields while that mutation is in flight.
  if (busySide.value) return;
  for (const side of sides) {
    const link = linkFor(side.key);
    const authorization = authorizationFor(side.key);
    forms[side.key].choice = link ? (link.required ? "required" : "not_required") : "";
    forms[side.key].mode = link?.reusedFromContractVersionId ? "reuse" : "upload";
    forms[side.key].reuseAuthorizationId = link?.reusedFromContractVersionId
      ? link.authorizationId ?? ""
      : "";
    if (authorization) {
      forms[side.key].grantorName = authorization.grantorName;
      forms[side.key].agentName = authorization.agentName;
      forms[side.key].scopeSummary = authorization.scopeSummary;
    }
  }
}

function statusView(side: ContractAuthorizationSide) {
  const link = linkFor(side);
  if (!link) return { label: "尚未选择", tone: "warning" as const };
  if (!link.required) return { label: "已确认不需要", tone: "default" as const };
  const authorization = authorizationFor(side);
  return authorization?.status === "active"
    ? { label: "已关联", tone: "success" as const }
    : { label: "授权文件不可用", tone: "danger" as const };
}

function authorizationFieldsComplete(side: ContractAuthorizationSide) {
  const form = forms[side];
  return Boolean(form.grantorName.trim() && form.agentName.trim() && form.scopeSummary.trim());
}

function reuseCandidates(side: ContractAuthorizationSide) {
  return governance()?.authorizationReuseCandidates?.filter((candidate) => candidate.side === side) ?? [];
}

function reuseCandidateOptions(side: ContractAuthorizationSide) {
  return reuseCandidates(side).map((candidate) => ({
    label: `合同 v${candidate.sourceVersionNo} · ${candidate.agentName} · ${candidate.pageCount} 页`,
    value: candidate.authorizationId
  }));
}

async function onChoiceChange(side: ContractAuthorizationSide, value: unknown) {
  if (value !== "required" && value !== "not_required") return;
  forms[side].choice = value;
  if (value !== "not_required") return;
  if (busySide.value) return;
  busySide.value = side;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容，请重试。");
    prepared = true;
    await setContractAuthorizationWithCapability(current.version.id, {
      side,
      expectedRevision: current.version.draftRevision,
      required: false
    });
    staged[side] = emptyStagedAuthorization();
    forms[side].files = [];
    reload = true;
    showSuccess(`${sideLabel(side)}已确认不需要授权委托书。`);
  } catch (error) {
    showError(error, "授权选择保存失败，已保留当前选择，请重试。");
  } finally {
    if (prepared) await finishMutation(reload);
    busySide.value = "";
  }
}

function onModeChange(side: ContractAuthorizationSide, value: unknown) {
  if (value === "reuse" || value === "upload") forms[side].mode = value;
}

async function reuseAuthorization(side: ContractAuthorizationSide) {
  if (busySide.value) return;
  busySide.value = side;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    const candidate = current.governance?.authorizationReuseCandidates.find((item) =>
      item.side === side && item.authorizationId === forms[side].reuseAuthorizationId
    );
    if (!candidate) throw new Error("所选历史授权已不可用，请重新选择或上传新文件。");
    await setContractAuthorizationWithCapability(current.version.id, {
      side,
      expectedRevision: current.version.draftRevision,
      required: true,
      reuse: {
        authorizationId: candidate.authorizationId,
        sourceContractVersionId: candidate.sourceContractVersionId,
        agentName: candidate.agentName
      }
    });
    reload = true;
    showSuccess(`${sideLabel(side)}已复用合同 v${candidate.sourceVersionNo} 的授权委托书。`);
  } catch (error) {
    showError(error, "历史授权复用失败，已保留当前选择，请重试。");
  } finally {
    if (prepared) await finishMutation(reload);
    busySide.value = "";
  }
}

async function uploadAuthorization(
  side: ContractAuthorizationSide,
  selected: UploadFile | UploadFile[]
): Promise<RequestMethodResponse> {
  if (busySide.value) return failed("文件正在处理，请勿重复提交。");
  const upload = Array.isArray(selected) ? selected[0] : selected;
  if (!upload?.raw) return failed("请重新选择 PDF 文件。");
  busySide.value = side;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    const uploaded = await uploadContractAuthorizationFileWithCapability(
      current.version.id,
      upload.raw,
      upload.name || upload.raw.name
    );
    staged[side] = {
      fileId: uploaded.id,
      fileName: upload.name || upload.raw.name,
      contractVersionId: current.version.id,
      grantorName: forms[side].grantorName.trim(),
      agentName: forms[side].agentName.trim(),
      scopeSummary: forms[side].scopeSummary.trim()
    };
    await associate(side, current, staged[side]);
    staged[side] = emptyStagedAuthorization();
    reload = true;
    showSuccess(`${sideLabel(side)}授权委托书已关联。`);
    return { status: "success", response: { url: `private-file:${uploaded.id}`, fileId: uploaded.id } };
  } catch (error) {
    const text = errorText(error, "授权委托书处理失败，请重试。");
    showError(error, text);
    return failed(text, staged[side].fileId);
  } finally {
    if (prepared) await finishMutation(reload);
    busySide.value = "";
  }
}

function authorizationUploadMethod(side: ContractAuthorizationSide) {
  return (selected: UploadFile | UploadFile[]) => uploadAuthorization(side, selected);
}

async function retryAuthorization(side: ContractAuthorizationSide) {
  if (busySide.value || !staged[side].fileId) return;
  busySide.value = side;
  message.value = "";
  let prepared = false;
  let reload = false;
  try {
    const current = await props.prepareMutation();
    if (!current) throw new Error("草稿保存失败，已保留当前内容。");
    prepared = true;
    await associate(side, current, staged[side]);
    staged[side] = emptyStagedAuthorization();
    forms[side].files = [];
    reload = true;
    showSuccess(`${sideLabel(side)}授权委托书已关联，未重复上传文件。`);
  } catch (error) {
    showError(error, "业务关联仍未完成，原文件已保留，请稍后重试。");
  } finally {
    if (prepared) await finishMutation(reload);
    busySide.value = "";
  }
}

function associate(
  side: ContractAuthorizationSide,
  current: ContractWorkbenchReadModel,
  upload: StagedAuthorizationAssociation
) {
  return associateStagedAuthorization(
    side,
    current,
    upload,
    setContractAuthorizationWithCapability
  );
}

async function finishMutation(reload: boolean) {
  try {
    await props.completeMutation(reload);
  } catch (error) {
    showError(error, "操作已完成，但最新状态读取失败，请刷新页面。");
  }
}

function sourceText(side: ContractAuthorizationSide) {
  const link = linkFor(side);
  return link?.reusedFromContractVersionId
    ? `复用合同版本 ${link.reusedFromContractVersionId}`
    : "本版本上传";
}

function shaText(value?: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function sideLabel(side: ContractAuthorizationSide) {
  return side === "first_party" ? "我方" : "乙方";
}

function failed(error: string, fileId = ""): RequestMethodResponse {
  return { status: "fail", error, response: { error, fileId } };
}

function showSuccess(text: string) {
  messageTone.value = "success";
  message.value = text;
}

function showError(error: unknown, fallback: string) {
  messageTone.value = "error";
  message.value = errorText(error, fallback);
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
</script>

<style scoped>
.governance-section,
.authorization-unit {
  display: grid;
  gap: var(--jg-space-md);
}

.governance-section {
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.section-head > div,
.authorization-required,
.authorization-fields,
.reuse-fields,
.fact-list {
  display: grid;
  gap: var(--jg-space-sm);
}

.section-head span,
.retry-row,
.muted,
.fact-list dt {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.authorization-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-lg);
}

.authorization-unit {
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  border-radius: var(--jg-radius-sm);
}

.unit-head,
.retry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-sm);
}

.fact-list {
  margin: 0;
}

.fact-list > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: var(--jg-space-sm);
}

.fact-list dt,
.fact-list dd {
  margin: 0;
}

.fact-list dd {
  overflow-wrap: anywhere;
}

@container jg-page (max-width: 720px) {
  .authorization-grid {
    grid-template-columns: 1fr;
  }

  .retry-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
