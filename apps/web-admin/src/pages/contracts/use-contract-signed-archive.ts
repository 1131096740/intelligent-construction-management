import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { ContractDetailReadModel, ContractV2LifecycleReadModel } from "@jiangkong/shared-domain";
import {
  CoreFlowApiError, archiveSignedContractV2, confirmContractSealV2, fetchContractDetail, fetchSignedContractArchiveV2Result, uploadPrivateFile,
  type ContractSealConfirmationV2Payload, type ContractSignedArchiveV2Payload
} from "../../api/core-flow-read.api";
import { PRIVATE_FILE_UPLOAD_MAX_BYTES } from "../../components/file-upload-policy.config";

export interface ContractSigningCompletion { actor: string; versionId: string; kind: "seal" | "seal_by_other" | "archive" }

type Ready = Extract<ContractV2LifecycleReadModel, { status: "ready" }>;
interface OperationScope { key: string; epoch: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fingerprint = /^[0-9a-f]{64}$/u;
interface SealIntent { schemaVersion: 1; actor: string; versionId: string; body: ContractSealConfirmationV2Payload }
interface SignedFile { localId: string; name: string; file?: File; fileId: string | null; contentSha256: string; error: string }
interface ArchiveIntent { schemaVersion: 1; actor: string; versionId: string; body: ContractSignedArchiveV2Payload; requestSha256: string; files: Array<{ fileId: string; name: string }> }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function sameStrings(a: unknown, b: readonly string[]) { return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]); }
function validCoordinates(body: unknown): body is ContractSealConfirmationV2Payload {
  return object(body) && typeof body.expectedApprovalInstanceId === "string" && uuid.test(body.expectedApprovalInstanceId) &&
    typeof body.expectedSealTaskId === "string" && uuid.test(body.expectedSealTaskId) && Number.isInteger(body.documentContentRevision) && Number(body.documentContentRevision) > 0 &&
    typeof body.documentContentFingerprint === "string" && fingerprint.test(body.documentContentFingerprint);
}
function validArchiveBody(body: unknown): body is ContractSignedArchiveV2Payload {
  return validCoordinates(body) && object(body) && Object.keys(body).length === 9 && body.archiveProtocolVersion === 2 && body.archiveSource === "generated_approval" &&
    typeof body.idempotencyKey === "string" && uuid.test(body.idempotencyKey) && body.confirmedMatchingSignedDocument === true &&
    Array.isArray(body.fileIds) && body.fileIds.length >= 1 && body.fileIds.length <= 20 && new Set(body.fileIds).size === body.fileIds.length && body.fileIds.every(id => typeof id === "string" && uuid.test(id));
}
function sameCoordinates(value: Ready | null, body: ContractSealConfirmationV2Payload | ContractSignedArchiveV2Payload) {
  return !!value && value.approvalInstanceId === body.expectedApprovalInstanceId && value.sealTaskId === body.expectedSealTaskId &&
    value.documentContentRevision === body.documentContentRevision && value.documentContentFingerprint === body.documentContentFingerprint;
}
function sameArchiveBody(a: unknown, b: ContractSignedArchiveV2Payload) {
  return validArchiveBody(a) && a.archiveProtocolVersion === b.archiveProtocolVersion && a.archiveSource === b.archiveSource && a.idempotencyKey === b.idempotencyKey &&
    a.expectedApprovalInstanceId === b.expectedApprovalInstanceId && a.expectedSealTaskId === b.expectedSealTaskId &&
    a.documentContentRevision === b.documentContentRevision && a.documentContentFingerprint === b.documentContentFingerprint &&
    a.confirmedMatchingSignedDocument === b.confirmedMatchingSignedDocument && sameStrings(a.fileIds, b.fileIds);
}
function readyContext(detail: ContractDetailReadModel | null, actor: string | undefined): Ready | null {
  const value = detail?.v2Lifecycle;
  return value?.status === "ready" && value.protocolVersion === 2 && value.source === "generated_approval" && value.scope === "inside_original" &&
    !detail?.historyReadOnly && !!actor && value.actorUserId === actor && value.contractVersionId === detail?.contractVersionId &&
    uuid.test(value.contractVersionId) && uuid.test(value.approvalInstanceId) && uuid.test(value.sealTaskId) &&
    Number.isInteger(value.documentContentRevision) && value.documentContentRevision > 0 && fingerprint.test(value.documentContentFingerprint) &&
    value.approvalSource?.status === "references_ready" ? value : null;
}
function coordinates(value: Ready): ContractSealConfirmationV2Payload {
  return { expectedApprovalInstanceId: value.approvalInstanceId, expectedSealTaskId: value.sealTaskId,
    documentContentRevision: value.documentContentRevision, documentContentFingerprint: value.documentContentFingerprint, confirmed: true };
}
async function sha256(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function archiveRequestSha(intent: Pick<ArchiveIntent, "actor" | "versionId" | "body">) {
  const body = intent.body;
  return sha256(new TextEncoder().encode(JSON.stringify({ versionId: intent.versionId, actor: intent.actor,
    archiveProtocolVersion: body.archiveProtocolVersion, archiveSource: body.archiveSource, idempotencyKey: body.idempotencyKey,
    expectedApprovalInstanceId: body.expectedApprovalInstanceId, expectedSealTaskId: body.expectedSealTaskId,
    documentContentRevision: body.documentContentRevision, documentContentFingerprint: body.documentContentFingerprint,
    fileIds: body.fileIds, confirmedMatchingSignedDocument: body.confirmedMatchingSignedDocument })));
}
function archiveEligible(value: Ready | null) {
  return value?.state === "pending_archive" && value.webWriteReleased === true && value.archiveAction?.key === "archive_signed_v2" &&
    value.archiveAction.eligible === true && value.archiveAction.enabled === true && value.signedFilePolicy?.mimeType === "application/pdf" &&
    value.signedFilePolicy.minCount === 1 && value.signedFilePolicy.maxCount === 20 && value.signedFilePolicy.ordered === true;
}
function sealEligible(value: Ready | null) {
  return value?.state === "pending_seal" && value.webWriteReleased === true && value.sealAction?.key === "confirm_seal_v2" &&
    value.sealAction.eligible === true && value.sealAction.enabled === true;
}

export function useContractSignedArchive(input: {
  detail: Ref<ContractDetailReadModel | null>; actor: Ref<string | undefined>; routeContractId: Ref<string>;
  externalBusy: Ref<boolean>; refresh: (completion: ContractSigningCompletion) => void;
}) {
  const busy = ref(false), hydrating = ref(false), storageBlocked = ref(false), message = ref("");
  const sealIntent = ref<SealIntent | null>(null), archiveIntent = ref<ArchiveIntent | null>(null), files = ref<SignedFile[]>([]);
  const scope = computed(() => `${input.actor.value ?? ""}:${input.detail.value?.contractVersionId ?? ""}`);
  const context = computed(() => readyContext(input.detail.value, input.actor.value));
  let disposed = false, hydrateSequence = 0, scopeEpoch = 0;
  onBeforeUnmount(() => { disposed = true; hydrateSequence++; scopeEpoch++; });
  const captureScope = (): OperationScope => ({ key: scope.value, epoch: scopeEpoch });
  const current = (started: OperationScope) => !disposed && scope.value === started.key && scopeEpoch === started.epoch;
  const storageKey = (kind: "seal" | "archive") => `jg:contract-${kind}-intent:v1:${encodeURIComponent(input.actor.value ?? "")}:${encodeURIComponent(input.detail.value?.contractVersionId ?? "")}`;
  watch(scope, async () => {
    scopeEpoch++;
    const sequence = ++hydrateSequence, started = captureScope();
    busy.value = false;
    sealIntent.value = null; archiveIntent.value = null; files.value = []; message.value = ""; storageBlocked.value = false; hydrating.value = true;
    try {
      if (!input.actor.value || !input.detail.value) return;
      const sealRaw = localStorage.getItem(storageKey("seal")), archiveRaw = localStorage.getItem(storageKey("archive"));
      if (sealRaw) {
        const saved = JSON.parse(sealRaw) as SealIntent;
        if (saved.schemaVersion !== 1 || saved.actor !== input.actor.value || saved.versionId !== input.detail.value.contractVersionId || !validCoordinates(saved.body) ||
          Object.keys(saved.body).length !== 5 || saved.body.confirmed !== true) throw new Error();
        sealIntent.value = saved; message.value = "盖章结果待核对，请查询本次办理结果";
      }
      if (archiveRaw) {
        if (archiveRaw.length > 32_768) throw new Error();
        const saved = JSON.parse(archiveRaw) as ArchiveIntent;
        if (saved.schemaVersion !== 1 || saved.actor !== input.actor.value || saved.versionId !== input.detail.value.contractVersionId || !validArchiveBody(saved.body) ||
          !fingerprint.test(saved.requestSha256) || !Array.isArray(saved.files) || saved.files.length !== saved.body.fileIds.length || saved.files.some((file, index) => !object(file) || file.fileId !== saved.body.fileIds[index] || typeof file.name !== "string" || !file.name || file.name.length > 1024)) throw new Error();
        const expected = await archiveRequestSha(saved);
        if (!current(started) || sequence !== hydrateSequence) return;
        if (saved.requestSha256 !== expected) throw new Error();
        archiveIntent.value = saved;
        files.value = saved.files.map(file => ({ localId: file.fileId, name: file.name, fileId: file.fileId, contentSha256: "", error: "" }));
        message.value = "归档结果待核对，请保留本次原请求并查询结果";
      }
    } catch { if (current(started) && sequence === hydrateSequence) { storageBlocked.value = true; message.value = "本机办理记录无法核对，已停止发起新操作"; } }
    finally { if (current(started) && sequence === hydrateSequence) hydrating.value = false; }
  }, { immediate: true, flush: "sync" });
  const locked = computed(() => busy.value || hydrating.value || storageBlocked.value || !!sealIntent.value || !!archiveIntent.value);
  const canSeal = computed(() => sealEligible(context.value) && !locked.value && !input.externalBusy.value);
  const canSelectFiles = computed(() => archiveEligible(context.value) && !locked.value && !input.externalBusy.value);
  const canArchive = computed(() => canSelectFiles.value && files.value.length >= 1 && files.value.length <= 20);
  const canContinueSeal = computed(() => !!sealIntent.value && !archiveIntent.value && !busy.value && !hydrating.value && !storageBlocked.value && !input.externalBusy.value && sealEligible(context.value));
  const canContinueArchive = computed(() => !!archiveIntent.value && !sealIntent.value && !busy.value && !hydrating.value && !storageBlocked.value && !input.externalBusy.value && archiveEligible(context.value));
  function persist(kind: "seal" | "archive", value: SealIntent | ArchiveIntent) {
    if (localStorage.getItem(storageKey(kind))) { storageBlocked.value = true; throw new Error(); }
    localStorage.setItem(storageKey(kind), JSON.stringify(value));
  }
  function removeSaved(kind: "seal" | "archive", intent: SealIntent | ArchiveIntent) {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return;
    const saved = JSON.parse(raw) as SealIntent | ArchiveIntent;
    const matches = kind === "archive" ? "requestSha256" in saved && "requestSha256" in intent && saved.requestSha256 === intent.requestSha256 &&
      "idempotencyKey" in saved.body && "idempotencyKey" in intent.body && saved.body.idempotencyKey === intent.body.idempotencyKey :
      saved.actor === intent.actor && saved.versionId === intent.versionId && JSON.stringify(saved.body) === JSON.stringify(intent.body);
    if (!matches) { storageBlocked.value = true; throw new Error(); }
    localStorage.removeItem(storageKey(kind));
  }
  async function readSeal(intent: SealIntent, started: OperationScope) {
    const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
    if (!current(started)) return false;
    const value = readyContext(fresh, input.actor.value);
    if (!sameCoordinates(value, intent.body) || value?.sealOutcome.status !== "completed" || !value.sealOutcome.completedAt || !value.sealOutcome.completedByUserId) {
      message.value = "盖章结果待核对，请保留本次办理记录后再次查询"; return false;
    }
    removeSaved("seal", intent); sealIntent.value = null;
    message.value = value.sealOutcome.completedByUserId === intent.actor ? "已核对盖章完成结果" : "已由其他经办人确认盖章，请核对当前合同";
    input.refresh({ actor: intent.actor, versionId: intent.versionId, kind: value.sealOutcome.completedByUserId === intent.actor ? "seal" : "seal_by_other" }); return true;
  }
  async function confirmSeal() {
    if (!canSeal.value || !context.value) return;
    const started = captureScope();
    const intent: SealIntent = { schemaVersion: 1, actor: input.actor.value!, versionId: context.value.contractVersionId, body: coordinates(context.value) };
    busy.value = true;
    try {
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, intent.actor);
      if (!sameCoordinates(value, intent.body) || !sealEligible(value)) { message.value = "当前合同办理资料或权限已变化，请刷新后核对"; return; }
      persist("seal", intent); sealIntent.value = intent;
      try { await confirmContractSealV2(intent.versionId, intent.body); } catch { /* Recovery only reads the original task. */ }
      if (current(started)) await readSeal(intent, started);
    } catch { if (current(started)) message.value = sealIntent.value ? "盖章结果待核对，请保留本次办理记录后再次查询" : "未能核对当前办理资料，本次未发起新操作"; }
    finally { if (current(started)) busy.value = false; }
  }
  async function querySeal() {
    if (busy.value || !sealIntent.value) return;
    const started = captureScope(); busy.value = true;
    try { await readSeal(sealIntent.value, started); }
    catch { if (current(started)) message.value = "暂时无法读取盖章结果，请保留本次办理记录后重试查询"; }
    finally { if (current(started)) busy.value = false; }
  }
  async function continueSeal() {
    if (!canContinueSeal.value || !sealIntent.value) return;
    const started = captureScope(), intent = JSON.parse(JSON.stringify(sealIntent.value)) as SealIntent;
    busy.value = true;
    try {
      if (await readSeal(intent, started) || !current(started)) return;
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, intent.actor);
      if (!sameCoordinates(value, intent.body) || !sealEligible(value)) { message.value = "当前盖章资料或权限已变化，请继续查询原办理结果"; return; }
      try { await confirmContractSealV2(intent.versionId, intent.body); } catch { /* An explicit same-tuple continuation still recovers by reading. */ }
      if (current(started)) await readSeal(intent, started);
    } catch { if (current(started)) message.value = "暂时无法继续核对盖章结果，请保留本次办理记录"; }
    finally { if (current(started)) busy.value = false; }
  }
  async function selectFiles(selected: File[]) {
    if (!canSelectFiles.value) return;
    if (files.value.length + selected.length > 20) { message.value = "一次最多归档20份PDF，请减少文件后核对"; return; }
    const started = captureScope(); busy.value = true;
    try {
      const additions: SignedFile[] = [];
      for (const file of selected) {
        if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf") || file.size <= 0 || file.size > PRIVATE_FILE_UPLOAD_MAX_BYTES) throw new Error("format");
        const bytes = await file.arrayBuffer();
        if (!current(started)) return;
        const contentSha256 = await sha256(bytes);
        if (!current(started)) return;
        if ([...files.value, ...additions].some(item => item.name === file.name && item.contentSha256 === contentSha256)) throw new Error("duplicate");
        additions.push({ localId: crypto.randomUUID(), name: file.name, file, fileId: null, contentSha256, error: "" });
      }
      files.value.push(...additions); message.value = "";
    } catch (error) { if (current(started)) message.value = error instanceof Error && error.message === "duplicate" ? "请勿重复选择同一份签章PDF" : "请选择非空且不超过100MB的PDF文件"; }
    finally { if (current(started)) busy.value = false; }
  }
  function removeFile(index: number) { if (canSelectFiles.value) files.value.splice(index, 1); }
  function moveFile(index: number, delta: number) {
    if (!canSelectFiles.value || index + delta < 0 || index + delta >= files.value.length) return;
    const [item] = files.value.splice(index, 1); files.value.splice(index + delta, 0, item);
  }
  async function readArchive(intent: ArchiveIntent, started: OperationScope) {
    const result = await fetchSignedContractArchiveV2Result(intent.versionId, intent.body.idempotencyKey);
    if (!current(started)) return "stale";
    if (result?.status === "unknown") { message.value = "归档结果待核对，请保留原请求；可查询或按原请求继续"; return "unknown"; }
    if (result?.status !== "archived" || result.requestSha256 !== intent.requestSha256 || !sameArchiveBody(result.intent, intent.body) ||
      !object(result.result) || !uuid.test(result.result.archiveId) || result.result.contractVersionId !== intent.versionId || result.result.status !== "effective" || !sameStrings(result.result.fileIds, intent.body.fileIds)) {
      message.value = "返回结果与原归档请求尚未核对一致，请保留原请求并查询"; return "mismatch";
    }
    removeSaved("archive", intent); archiveIntent.value = null; files.value = [];
    message.value = "双方签章原件已归档，合同已生效"; input.refresh({ actor: intent.actor, versionId: intent.versionId, kind: "archive" }); return "archived";
  }
  async function sendArchive(intent: ArchiveIntent, started: OperationScope) {
    try { await archiveSignedContractV2(intent.versionId, intent.body); } catch { /* Never repeat a write from an automatic recovery path. */ }
    if (current(started)) await readArchive(intent, started);
  }
  async function confirmArchive() {
    if (!canArchive.value || !context.value) return;
    const started = captureScope(), captured = coordinates(context.value), versionId = context.value.contractVersionId, actor = input.actor.value!;
    busy.value = true;
    try {
      const beforeUpload = await fetchContractDetail(input.routeContractId.value, { versionId });
      if (!current(started)) return;
      const uploadContext = readyContext(beforeUpload, actor);
      if (!archiveEligible(uploadContext) || !sameCoordinates(uploadContext, captured)) { message.value = "当前合同或权限已变化，已保留当前原件，请核对当前轮次"; return; }
      for (const item of files.value) {
        if (item.fileId) continue;
        if (!item.file) { message.value = "请重新选择尚未上传的PDF文件"; return; }
        try {
          const uploaded = await uploadPrivateFile(item.file, item.name, item.localId);
          if (!current(started)) return;
          if (!uploaded || !uuid.test(uploaded.id)) throw new Error();
          item.fileId = uploaded.id; item.error = "";
        } catch { if (current(started)) { item.error = "上传未完成，重试将保留已成功的原件"; message.value = item.error; } return; }
      }
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, actor);
      if (!archiveEligible(value) || !sameCoordinates(value, captured)) { message.value = "当前合同或权限已变化，已保留当前原件，请核对当前轮次"; return; }
      const fileIds = files.value.map(item => item.fileId!);
      if (new Set(fileIds).size !== fileIds.length) { message.value = "原件引用重复，已停止归档，请核对上传文件"; return; }
      const body: ContractSignedArchiveV2Payload = { archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: crypto.randomUUID(),
        expectedApprovalInstanceId: captured.expectedApprovalInstanceId, expectedSealTaskId: captured.expectedSealTaskId,
        documentContentRevision: captured.documentContentRevision, documentContentFingerprint: captured.documentContentFingerprint,
        fileIds, confirmedMatchingSignedDocument: true };
      const intent: ArchiveIntent = { schemaVersion: 1, actor, versionId, body, requestSha256: "", files: files.value.map(item => ({ fileId: item.fileId!, name: item.name })) };
      intent.requestSha256 = await archiveRequestSha(intent);
      if (!current(started)) return;
      persist("archive", intent); archiveIntent.value = intent;
      await sendArchive(intent, started);
    } catch (error) { if (current(started)) message.value = archiveIntent.value
      ? error instanceof CoreFlowApiError && error.status === 403 ? "当前账号权限已变化，已保留原请求和原件，请核对权限后查询" : "归档结果待核对，请保留原请求后再次查询"
      : "未能完成归档前核对，已保留当前原件"; }
    finally { if (current(started)) busy.value = false; }
  }
  async function queryArchive() {
    if (busy.value || !archiveIntent.value) return;
    const started = captureScope(); busy.value = true;
    try { await readArchive(archiveIntent.value, started); }
    catch (error) { if (current(started)) message.value = error instanceof CoreFlowApiError && error.status === 403
      ? "当前账号权限已变化，已保留原请求和原件，请核对权限后查询" : "暂时无法查询归档结果，已保留原请求和原件"; }
    finally { if (current(started)) busy.value = false; }
  }
  async function continueArchive() {
    if (!canContinueArchive.value || !archiveIntent.value) return;
    const started = captureScope(), intent = JSON.parse(JSON.stringify(archiveIntent.value)) as ArchiveIntent; busy.value = true;
    try {
      if (await readArchive(intent, started) !== "unknown" || !current(started)) return;
      const fresh = await fetchContractDetail(input.routeContractId.value, { versionId: intent.versionId });
      if (!current(started)) return;
      const value = readyContext(fresh, intent.actor);
      if (!archiveEligible(value) || !sameCoordinates(value, intent.body)) { message.value = "当前合同或权限已变化，请继续核对原归档结果"; return; }
      await sendArchive(intent, started);
    } catch (error) { if (current(started)) message.value = error instanceof CoreFlowApiError && error.status === 403
      ? "当前账号权限已变化，已保留原请求和原件，请核对权限后查询" : "暂时无法继续核对原请求，已保留原请求和原件"; }
    finally { if (current(started)) busy.value = false; }
  }
  return { context, busy, message, sealIntent, archiveIntent, files, canSeal, canSelectFiles, canArchive, canContinueSeal, canContinueArchive, locked,
    confirmSeal, querySeal, continueSeal, selectFiles, removeFile, moveFile, confirmArchive, queryArchive, continueArchive };
}
