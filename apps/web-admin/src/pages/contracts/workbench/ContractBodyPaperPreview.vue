<template>
  <section
    class="body-paper-preview"
    aria-label="合同草稿纸面检查"
  >
    <p
      v-if="busy"
      role="status"
    >
      正在核对当前草稿纸面…
    </p>
    <p
      v-if="notice"
      class="paper-note"
      role="status"
    >
      {{ notice }}
    </p>
    <t-alert
      v-if="error && !authorizationVisible"
      theme="error"
      :message="error"
    />
    <t-button
      v-if="mayOfferGeneration"
      theme="primary"
      :loading="submitting"
      :disabled="!canGenerate"
      @click="generateCurrentDraft"
    >
      生成当前草稿PDF
    </t-button>
    <t-button
      v-if="!previewUrl"
      variant="outline"
      :disabled="busy || blocked"
      @click="queryCurrentPaper"
    >
      {{ pendingGeneration ? "查询生成结果" : "重新检查" }}
    </t-button>
    <LayoutPdfPreview
      v-if="previewUrl"
      :url="previewUrl"
      context-label="合同正文"
      allow-zoom
    />
    <t-dialog
      v-if="canAuthorize"
      v-model:visible="authorizationVisible"
      role="dialog"
      aria-label="预览合同正文"
      aria-modal="true"
      header="预览合同正文"
      :footer="false"
      :close-on-overlay-click="false"
      :close-btn="!busy"
      width="min(640px, 94vw)"
      @close="cancelAuthorization"
    >
      <t-form label-align="top">
        <t-form-item label="当前登录密码">
          <t-input
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
          />
        </t-form-item>
        <t-form-item label="预览原因">
          <t-input
            v-model="reason"
            placeholder="请填写原因，便于留痕审计"
            :disabled="busy"
          />
        </t-form-item>
      </t-form>
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
      <t-button
        variant="outline"
        :disabled="busy"
        @click="cancelAuthorization"
      >
        取消
      </t-button>
      <t-button
        theme="primary"
        :loading="busy"
        :disabled="!canAuthorize || busy || !password.trim() || !reason.trim()"
        @click="confirmPreview"
      >
        确认预览
      </t-button>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../../../auth/auth.store";
import { fetchContractDraftWorkbench, fetchContractDraftBody, listContractDocuments, queueContractDraftPreview, type ContractDraftBodyReadModel } from "../../../api/contract-workbench.api";
import { getPrivateFileDownloadTicketCapability, downloadPrivateFileByTicket } from "../../../api/core-flow-read.api";

const LayoutPdfPreview = defineAsyncComponent(() => import("../../../components/files/LayoutPdfPreview.vue"));
type PaperContext = Pick<ContractDraftBodyReadModel, "contractVersionId" | "draftRevision" | "documentContentRevision" | "layoutTemplateVersionId" | "sourceSha256">;
type Reader = Readonly<{ generation: number; ownerKey: string; actorUserId: string; routeContractId: string; context: Readonly<PaperContext> }>;
type ReadyPdf = Readonly<{ documentId: string; fileId: string; contentRevision: number; fingerprint: string; layoutId: string; sourceSha256: string }>;
type FileCapability = Awaited<ReturnType<typeof getPrivateFileDownloadTicketCapability>>;
type PreviewGrant = Readonly<{
  fileId: string; documentId: string; ownerKey: string; readGeneration: number;
  serverAction: Readonly<FileCapability["action"]>; serverAvailableActions: ReadonlyArray<FileCapability["availableActions"][number]>;
}>;
type PaperState = Readonly<{ fingerprint: string; actions: ReadonlyArray<string>; documents: ReadonlyArray<unknown> }>;
type GenerationGrant = Readonly<{ ownerKey: string; readGeneration: number; sourceRevision: number; fingerprint: string; actions: ReadonlyArray<string> }>;
type PendingGeneration = Readonly<{ ownerKey: string; readGeneration: number; generationId: string | null; fingerprint: string; status: "queued" | "processing" | "unknown" }>;
const props = defineProps<{ context: PaperContext; blocked: boolean }>();
const route = useRoute();
const auth = useAuthStore();
const previewUrl = ref("");
const busy = ref(false);
const notice = ref("");
const error = ref("");
const password = ref("");
const reason = ref("");
const authorizationVisible = ref(false);
const reader = shallowRef<Reader | null>(null);
const readyPdf = shallowRef<ReadyPdf | null>(null);
// The actual server capability lives apart from file display/body data.
const previewGrant = shallowRef<PreviewGrant | null>(null);
// Generation permission is a separate fresh workbench action receipt, never a file-read grant.
const generationGrant = shallowRef<GenerationGrant | null>(null);
const pendingGeneration = shallowRef<PendingGeneration | null>(null);
const submitting = ref(false);
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let automaticQueries = 0;
let generation = 0;
const HASH = /^[a-f0-9]{64}$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function ownerKey() {
  const actor = auth.user?.id, contract = route.params.contractId, version = route.query.versionId;
  if (!actor || typeof contract !== "string" || !contract || (version != null && (typeof version !== "string" || version !== props.context.contractVersionId))) return "";
  return JSON.stringify([actor, contract, version ?? null, props.context.contractVersionId, props.context.draftRevision,
    props.context.documentContentRevision, props.context.layoutTemplateVersionId, props.context.sourceSha256]);
}
function takeReader(): Reader | null {
  const owner = ownerKey();
  if (!owner || props.blocked || !HASH.test(props.context.sourceSha256) || !props.context.layoutTemplateVersionId ||
    !Number.isInteger(props.context.draftRevision) || !Number.isInteger(props.context.documentContentRevision)) return null;
  return Object.freeze({ generation, ownerKey: owner, actorUserId: auth.user!.id, routeContractId: String(route.params.contractId), context: Object.freeze({ ...props.context }) });
}
function isCurrent(value: Reader) {
  return !props.blocked && value.generation === generation && value.ownerKey === ownerKey() && auth.user?.id === value.actorUserId;
}
function permits(value: Reader, pdf: ReadyPdf, grant: PreviewGrant | null) {
  return Boolean(isCurrent(value) && grant && grant.ownerKey === value.ownerKey && grant.readGeneration === value.generation &&
    grant.fileId === pdf.fileId && grant.documentId === pdf.documentId && grant.serverAction.key === "create_private_file_download_ticket" &&
    grant.serverAction.enabled === true && grant.serverAvailableActions.includes("create_private_file_download_ticket"));
}
const canAuthorize = computed(() => Boolean(reader.value && readyPdf.value && permits(reader.value, readyPdf.value, previewGrant.value)));
function releasePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
}
function stopPolling() {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
}
function invalidate() {
  generation += 1;
  stopPolling();
  automaticQueries = 0;
  generationGrant.value = null;
  pendingGeneration.value = null;
  submitting.value = false;
  releasePreview();
  reader.value = null;
  readyPdf.value = null;
  previewGrant.value = null;
  authorizationVisible.value = false;
  password.value = "";
  reason.value = "";
  busy.value = false;
}
function cancelAuthorization() {
  if (busy.value) return;
  invalidate();
  notice.value = "预览已取消，当前编辑内容保留。";
}

async function readCurrentState(owner: Reader): Promise<PaperState | null> {
  const current = await fetchContractDraftWorkbench(owner.context.contractVersionId);
  if (!isCurrent(owner)) return null;
  const version = current.version;
  if (current.contract.id !== owner.routeContractId || version.id !== owner.context.contractVersionId ||
    version.draftRevision !== owner.context.draftRevision || version.layoutTemplateVersionId !== owner.context.layoutTemplateVersionId ||
    version.documentContentRevision !== owner.context.documentContentRevision || typeof version.documentContentFingerprint !== "string" || !HASH.test(version.documentContentFingerprint)) {
    throw new Error("当前正文资料已变化，请重新读取并核对保存结果");
  }
  const documents = await listContractDocuments(owner.context.contractVersionId);
  if (!isCurrent(owner)) return null;
  if (!Array.isArray(documents)) throw new Error("当前草稿生成记录无法核对，请重新检查");
  const actions = current.draftOperationAvailableActions;
  return Object.freeze({ fingerprint: version.documentContentFingerprint, documents,
    actions: Object.freeze(Array.isArray(actions) && actions.every(action => typeof action === "string") ? [...actions] : []) });
}
function matchingDocuments(owner: Reader, state: PaperState) {
  return state.documents.filter((item): item is Record<string, unknown> => isRecord(item) &&
    typeof item.id === "string" && Boolean(item.id) && item.purpose === "draft" && item.layoutTemplateVersionId === owner.context.layoutTemplateVersionId &&
    item.documentContentRevision === owner.context.documentContentRevision && item.documentContentFingerprint === state.fingerprint &&
    isRecord(item.inputSnapshot) && isRecord(item.inputSnapshot.bodyDocument) && item.inputSnapshot.bodyDocument.sourceSha256 === owner.context.sourceSha256);
}
function readyFile(owner: Reader, state: PaperState, item: Record<string, unknown>): ReadyPdf | null {
  if (item.status !== "success" || typeof item.id !== "string" || typeof item.pdfFileId !== "string" || !item.pdfFileId) return null;
  return Object.freeze({ documentId: item.id, fileId: item.pdfFileId, contentRevision: owner.context.documentContentRevision,
    fingerprint: state.fingerprint, layoutId: owner.context.layoutTemplateVersionId, sourceSha256: owner.context.sourceSha256 });
}
async function findCurrentPdf(owner: Reader, expected?: ReadyPdf): Promise<ReadyPdf | null> {
  const state = await readCurrentState(owner);
  if (!state) return null;
  for (const item of matchingDocuments(owner, state)) {
    const pdf = readyFile(owner, state, item);
    if (pdf && (!expected || (pdf.documentId === expected.documentId && pdf.fileId === expected.fileId && pdf.fingerprint === expected.fingerprint))) return pdf;
  }
  return null;
}
function generationPermits(owner: Reader, grant: GenerationGrant | null) {
  return Boolean(isCurrent(owner) && grant && grant.ownerKey === owner.ownerKey && grant.readGeneration === owner.generation &&
    grant.sourceRevision === owner.context.draftRevision && HASH.test(grant.fingerprint) && grant.actions.includes("queue_contract_draft_preview"));
}
const mayOfferGeneration = computed(() => Boolean(reader.value && !readyPdf.value && !previewUrl.value && generationPermits(reader.value, generationGrant.value)));
const canGenerate = computed(() => mayOfferGeneration.value && !busy.value && !submitting.value && !pendingGeneration.value);
async function refreshGenerationGrant(owner: Reader, state: PaperState) {
  if (!isCurrent(owner)) return false;
  generationGrant.value = null;
  if (!state.actions.includes("queue_contract_draft_preview")) return false;
  // Workbench does not expose source SHA; verify the actual public body before offering a write action.
  const body = await fetchContractDraftBody(owner.context.contractVersionId);
  if (!isCurrent(owner)) return false;
  if (body.contractVersionId !== owner.context.contractVersionId || body.draftRevision !== owner.context.draftRevision ||
    body.documentContentRevision !== owner.context.documentContentRevision || body.layoutTemplateVersionId !== owner.context.layoutTemplateVersionId || body.sourceSha256 !== owner.context.sourceSha256) {
    throw new Error("当前正文来源已变化，请重新读取并核对保存结果");
  }
  generationGrant.value = Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation, sourceRevision: body.draftRevision,
    fingerprint: state.fingerprint, actions: Object.freeze([...state.actions]) });
  return generationPermits(owner, generationGrant.value);
}
function scheduleQuery(owner: Reader) {
  stopPolling();
  if (!isCurrent(owner) || !pendingGeneration.value) return;
  if (automaticQueries >= 120) {
    notice.value = "当前生成仍需核对，请手动查询生成结果；无需重复生成。";
    return;
  }
  pollTimer = setTimeout(() => {
    pollTimer = null;
    if (!isCurrent(owner) || !pendingGeneration.value) return;
    if (busy.value) { scheduleQuery(owner); return; }
    automaticQueries += 1;
    void refreshPaper(owner);
  }, 1000);
}
function observePending(owner: Reader, state: PaperState, id: string | null, status: PendingGeneration["status"]) {
  pendingGeneration.value = Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation, generationId: id, fingerprint: state.fingerprint, status });
  notice.value = status === "unknown" ? "生成请求的结果尚未确认，请先查询生成结果；当前正文已保留。" : "当前草稿 PDF 正在生成，请稍候；无需重复生成。";
  scheduleQuery(owner);
}
async function applyCurrentState(owner: Reader, state: PaperState) {
  if (!isCurrent(owner)) return;
  const records = matchingDocuments(owner, state);
  const pending = pendingGeneration.value;
  const targetId = pending?.generationId;
  const target = targetId ? records.find(item => item.id === targetId) :
    records.find(item => item.status === "success" && readyFile(owner, state, item)) ?? records.find(item => item.status === "queued" || item.status === "processing");
  if (target) {
    const pdf = readyFile(owner, state, target);
    if (pdf) {
      stopPolling(); pendingGeneration.value = null; generationGrant.value = null;
      readyPdf.value = pdf; notice.value = "";
      if (!await refreshCapability(owner, pdf)) {
        if (isCurrent(owner)) error.value = "当前账号无权预览这份合同草稿 PDF。";
        return;
      }
      if (isCurrent(owner) && permits(owner, pdf, previewGrant.value)) authorizationVisible.value = true;
      return;
    }
    if (target.status === "queued" || target.status === "processing") {
      observePending(owner, state, String(target.id), target.status); return;
    }
    if (target.status === "failed") {
      stopPolling(); pendingGeneration.value = null;
      error.value = "当前草稿 PDF 未生成成功，请核对后再明确重新生成。";
    } else {
      observePending(owner, state, String(target.id), "unknown"); return;
    }
  } else if (pending) {
    observePending(owner, state, pending.generationId, "unknown"); return;
  }
  notice.value = "当前已保存正文还没有可查看的草稿 PDF。";
  await refreshGenerationGrant(owner, state);
}
async function refreshPaper(owner: Reader) {
  if (!isCurrent(owner)) return;
  stopPolling(); busy.value = true; error.value = "";
  try {
    const state = await readCurrentState(owner);
    if (state) await applyCurrentState(owner, state);
  } catch (cause) {
    if (isCurrent(owner)) {
      generationGrant.value = null;
      error.value = "查询当前草稿纸面失败，请稍后重新检查";
      if (pendingGeneration.value) scheduleQuery(owner);
    }
  } finally { if (isCurrent(owner)) busy.value = false; }
}
async function queryCurrentPaper() {
  if (busy.value || props.blocked) return;
  const owner = reader.value;
  automaticQueries = 0;
  if (owner && isCurrent(owner)) await refreshPaper(owner);
  else await readReadyPdf();
}
async function generateCurrentDraft() {
  const owner = reader.value;
  if (!owner || !canGenerate.value || !generationPermits(owner, generationGrant.value)) return;
  busy.value = true; submitting.value = true; error.value = ""; stopPolling();
  let dispatched = false;
  try {
    const state = await readCurrentState(owner);
    if (!state || !isCurrent(owner)) return;
    const existing = matchingDocuments(owner, state).some(item => item.status === "queued" || item.status === "processing" || item.status === "success");
    if (existing) { await applyCurrentState(owner, state); return; }
    if (!await refreshGenerationGrant(owner, state)) {
      if (isCurrent(owner)) error.value = "当前账号无权生成这份合同草稿 PDF。";
      return;
    }
    const granted = generationGrant.value;
    if (!generationPermits(owner, granted) || !granted || !isCurrent(owner)) return;
    automaticQueries = 0;
    pendingGeneration.value = Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation, generationId: null, fingerprint: granted.fingerprint, status: "unknown" });
    dispatched = true;
    const response = await queueContractDraftPreview(owner.context.contractVersionId, granted.sourceRevision);
    if (!isCurrent(owner)) return;
    if (!isRecord(response) || typeof response.generationId !== "string" || !response.generationId.trim() ||
      typeof response.status !== "string" || !["queued", "processing", "success"].includes(response.status) || response.sourceRevision !== granted.sourceRevision ||
      response.documentContentRevision !== owner.context.documentContentRevision || response.documentContentFingerprint !== granted.fingerprint) {
      throw new Error("生成请求的回执尚不能确认，请先查询生成结果");
    }
    pendingGeneration.value = Object.freeze({ ownerKey: owner.ownerKey, readGeneration: owner.generation, generationId: response.generationId,
      fingerprint: granted.fingerprint, status: response.status === "processing" ? "processing" : "queued" });
    await refreshPaper(owner);
  } catch (cause) {
    if (isCurrent(owner)) {
      error.value = "生成请求的结果尚未确认，请先查询生成结果";
      if (dispatched) {
        notice.value = "生成请求的结果尚未确认，请先查询生成结果；不会自动重复提交。";
        await refreshPaper(owner);
      }
    }
  } finally { if (isCurrent(owner)) { submitting.value = false; busy.value = false; } }
}
async function refreshCapability(owner: Reader, pdf: ReadyPdf) {
  const result = await getPrivateFileDownloadTicketCapability(pdf.fileId);
  if (!isCurrent(owner)) return false;
  previewGrant.value = Object.freeze({ fileId: pdf.fileId, documentId: pdf.documentId, ownerKey: owner.ownerKey, readGeneration: owner.generation,
    serverAction: Object.freeze({ ...result.action }), serverAvailableActions: Object.freeze([...result.availableActions]) });
  return permits(owner, pdf, previewGrant.value);
}
async function readReadyPdf() {
  invalidate(); notice.value = ""; error.value = "";
  const owner = takeReader();
  if (!owner) { notice.value = "请先保存并核对当前资料，再查看草稿纸面。"; return; }
  reader.value = owner;
  await refreshPaper(owner);
}
async function confirmPreview() {
  const owner = reader.value, pdf = readyPdf.value;
  if (!authorizationVisible.value || busy.value || !owner || !pdf || !permits(owner, pdf, previewGrant.value) || !password.value.trim() || !reason.value.trim()) return;
  busy.value = true;
  error.value = "";
  try {
    if (!await findCurrentPdf(owner, pdf)) { if (isCurrent(owner)) throw new Error("当前草稿纸面已变化，请重新检查"); return; }
    if (!isCurrent(owner)) return;
    if (!await refreshCapability(owner, pdf)) { if (isCurrent(owner)) throw new Error("当前账号无权预览这份合同草稿 PDF"); return; }
    const granted = previewGrant.value;
    if (!granted || !permits(owner, pdf, granted)) return;
    const result = await downloadPrivateFileByTicket(granted.fileId, { confirmationPassword: password.value, downloadReason: reason.value, accessMode: "preview" }, "pdf-blob");
    if (!isCurrent(owner) || previewGrant.value !== granted) return;
    if (!result || !result.blob.size || result.blob.size > 100_000_000) throw new Error("合同草稿 PDF 无法显示，请重新检查文件");
    if (!await findCurrentPdf(owner, pdf)) { if (isCurrent(owner)) throw new Error("当前草稿纸面已变化，请重新检查"); return; }
    if (!isCurrent(owner) || !permits(owner, pdf, previewGrant.value)) return;
    releasePreview();
    previewUrl.value = URL.createObjectURL(result.blob);
    authorizationVisible.value = false;
    password.value = "";
    reason.value = "";
  } catch (cause) {
    if (isCurrent(owner)) error.value = "读取合同草稿 PDF 失败，请保留编辑内容后重试";
  } finally { if (isCurrent(owner)) busy.value = false; }
}
watch(() => [props.context.contractVersionId, props.context.draftRevision, props.context.documentContentRevision, props.context.layoutTemplateVersionId,
  props.context.sourceSha256, props.blocked, auth.user?.id, route.params.contractId, route.query.versionId] as const, () => { void readReadyPdf(); }, { immediate: true, flush: "sync" });
onBeforeUnmount(invalidate);
</script>

<style scoped>
.body-paper-preview { min-width: 0; padding: var(--jg-space-lg); }
.paper-note { color: var(--jg-text-muted); margin: 0 0 var(--jg-space-md); }
</style>
