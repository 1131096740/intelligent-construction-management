import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { fetchContractDraftWorkbench, type ContractDraftWorkbenchReadModel } from "../../../api/contract-workbench.api";
import { fetchDirectSignedContractResult, archiveSignedContractV2,
  type ContractDirectRegistrationPayload } from "../../../api/core-flow-read.api";
import { directRegistrationCoordinates } from "./direct-pending-draft";

type Coordinates = NonNullable<ReturnType<typeof directRegistrationCoordinates>>;
interface Intent {
  actor: string;
  contractId: string;
  versionId: string;
  body: ContractDirectRegistrationPayload;
  requestSha256: string;
}
type StoredIntent = Intent & { phase?: "preparing" | "sent" };

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const sha = /^[a-f0-9]{64}$/u;
function sameFiles(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
function validBody(body: ContractDirectRegistrationPayload | undefined) {
  return body?.archiveProtocolVersion === 2 && body.archiveSource === "direct_signed" && uuid.test(body.idempotencyKey) &&
    Number.isSafeInteger(body.expectedDraftRevision) && body.expectedDraftRevision > 0 &&
    sha.test(body.expectedInputSha256) && body.confirmedMatchingSignedDocument === true &&
    Array.isArray(body.fileIds) && body.fileIds.length > 0 && body.fileIds.length <= 20 &&
    new Set(body.fileIds).size === body.fileIds.length && body.fileIds.every(id => typeof id === "string" && uuid.test(id));
}
function sameBody(left: ContractDirectRegistrationPayload, right: ContractDirectRegistrationPayload) {
  return validBody(left) && left.idempotencyKey === right.idempotencyKey &&
    left.expectedDraftRevision === right.expectedDraftRevision && left.expectedInputSha256 === right.expectedInputSha256 &&
    sameFiles(left.fileIds, right.fileIds);
}
function sameCoordinates(left: Coordinates | null, right: Coordinates) {
  return !!left && left.contractId === right.contractId && left.versionId === right.versionId &&
    left.draftRevision === right.draftRevision && left.inputSha256 === right.inputSha256 && sameFiles(left.fileIds, right.fileIds);
}
async function requestSha({ actor, contractId, versionId, body }: Omit<Intent, "requestSha256">) {
  const encoder = new TextEncoder();
  const parts = ["contract-direct-archive-request-v1", "2", "direct_signed", contractId, versionId, actor,
    body.idempotencyKey, String(body.expectedDraftRevision), body.expectedInputSha256, String(body.fileIds.length), ...body.fileIds, "true"];
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(parts.map(part => encoder.encode(part).length + ":" + part).join("")));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function useDirectContractRegistration(input: {
  actor: Ref<string | undefined>; routeContract: Ref<string>; routeVersion: Ref<string>;
  workbench: Ref<ContractDraftWorkbenchReadModel | null>; blocked: Ref<boolean>; online: Ref<boolean>;
  completed: (contractId: string, versionId: string) => void;
}) {
  const pending = ref<Intent | null>(null), busy = ref(false), hydrating = ref(false), blockedStorage = ref(false), message = ref("");
  const done = ref(false);
  const context = computed(() => directRegistrationCoordinates(input.workbench.value, input.actor.value));
  const version = computed(() => input.routeVersion.value || input.workbench.value?.version.id || "");
  const scope = computed(() => JSON.stringify([input.actor.value, input.routeContract.value, version.value]));
  let epoch = 0;
  onScopeDispose(() => { epoch++; });
  const key = () => `jg:direct-contract-registration:v1:${encodeURIComponent(input.actor.value ?? "")}:${encodeURIComponent(version.value)}`;
  const hasLock = () => typeof globalThis.navigator?.locks?.request === "function";
  const noLockMessage = "当前浏览器暂不支持跨标签页安全登记，请使用支持该功能的浏览器。";

  function sameStoredIntent(raw: string | null, intent: Intent): StoredIntent | null {
    const saved = raw ? JSON.parse(raw) as StoredIntent : null;
    return saved && saved.actor === intent.actor && saved.contractId === intent.contractId && saved.versionId === intent.versionId &&
      saved.requestSha256 === intent.requestSha256 && sameBody(saved.body, intent.body) ? saved : null;
  }
  async function validatedIntent(raw: string | null): Promise<StoredIntent | null> {
    if (raw === null) return null;
    if (raw.length > 8192) throw new Error();
    const saved = JSON.parse(raw) as StoredIntent;
    if (saved.actor !== input.actor.value || saved.versionId !== version.value || saved.contractId !== input.routeContract.value ||
      (saved.phase !== undefined && saved.phase !== "preparing" && saved.phase !== "sent") ||
      !validBody(saved.body) || !sha.test(saved.requestSha256) || await requestSha(saved) !== saved.requestSha256) throw new Error();
    return saved;
  }
  const cancelledKey = (intent: Intent, storageKey: string) => `${storageKey}:cancelled:${intent.requestSha256}`;
  const wasCancelled = (intent: Intent, storageKey: string) =>
    localStorage.getItem(cancelledKey(intent, storageKey)) === intent.body.idempotencyKey;
  function reconcileCancelledUnderLock(intent: Intent, storageKey: string, raw: string | null) {
    const saved = sameStoredIntent(raw, intent);
    if ((saved && saved.phase !== "preparing") || !wasCancelled(intent, storageKey)) return false;
    // A prior cancellation may have persisted its witness before removeItem failed.
    if (saved) localStorage.removeItem(storageKey);
    return true;
  }
  function keepPending(intent: Intent) {
    pending.value = intent;
    message.value = "正式登记结果待核对，请保留原请求并查询。";
  }
  watch(scope, async () => {
    const started = ++epoch;
    pending.value = null; busy.value = false; message.value = ""; blockedStorage.value = false; done.value = false; hydrating.value = false;
    if (!input.actor.value || !input.routeContract.value || !version.value) return;
    hydrating.value = true;
    try {
      const storageKey = key(), raw = localStorage.getItem(storageKey), locks = globalThis.navigator?.locks;
      let saved = await validatedIntent(raw);
      if (started !== epoch) return;
      if (saved?.phase === "preparing" && locks && wasCancelled(saved, storageKey)) {
        const cancelled = saved;
        const current = await locks.request(storageKey, () => {
          const observed = localStorage.getItem(storageKey);
          if (observed === raw && reconcileCancelledUnderLock(cancelled, storageKey, observed)) return null;
          return observed;
        });
        if (started !== epoch) return;
        saved = await validatedIntent(current);
      }
      if (started !== epoch) return;
      if (saved) keepPending(saved);
      else if (!hasLock()) message.value = noLockMessage;
    } catch {
      if (started === epoch) { blockedStorage.value = true; message.value = "本机登记记录无法核对，已暂停发起登记。"; }
    } finally {
      if (started === epoch) hydrating.value = false;
    }
  }, { immediate: true, flush: "sync" });

  const locked = computed(() => busy.value || hydrating.value || !!pending.value || blockedStorage.value || done.value);
  const available = computed(() => context.value?.contractId === input.routeContract.value && context.value.versionId === version.value);
  const confirmationKey = computed(() => JSON.stringify(context.value));
  const visible = computed(() => available.value || !!pending.value || busy.value || done.value);
  const canConfirm = computed(() => available.value && input.online.value && hasLock() && !input.blocked.value && !locked.value);
  const canQuery = computed(() => !!pending.value && input.online.value && !busy.value && !hydrating.value);
  const canContinue = computed(() => canQuery.value && hasLock() && !input.blocked.value && available.value);
  const sendCurrent = (captured: Coordinates, started: number) => started === epoch && available.value &&
    input.online.value && !input.blocked.value && sameCoordinates(context.value, captured);
  async function removeStored(intent: Intent, storageKey: string, unsentOnly: boolean) {
    const locks = globalThis.navigator?.locks;
    if (!locks) return false;
    return locks.request(storageKey, () => {
      const saved = sameStoredIntent(localStorage.getItem(storageKey), intent);
      if (!saved || (unsentOnly && saved.phase !== "preparing")) return false;
      // Retain the proof after another tab replaces this scope with a new request.
      if (unsentOnly) localStorage.setItem(cancelledKey(intent, storageKey), intent.body.idempotencyKey);
      localStorage.removeItem(storageKey);
      return true;
    });
  }
  async function read(intent: Intent, started: number, storageKey: string) {
    const result = await fetchDirectSignedContractResult(intent.versionId, intent.body.idempotencyKey, () => started === epoch);
    if (started !== epoch) return "stale";
    if (result?.status === "unknown") {
      const locks = globalThis.navigator?.locks;
      const cancelled = locks && await locks.request(storageKey, () =>
        reconcileCancelledUnderLock(intent, storageKey, localStorage.getItem(storageKey)));
      if (started !== epoch) return "stale";
      if (cancelled) {
        if (pending.value?.requestSha256 === intent.requestSha256) pending.value = null;
        message.value = "上次登记未发出。请核对已保存原件后重新确认。";
        return "cancelled";
      }
      message.value = "尚未查到正式登记结果。请继续查询，或核对资料后按原请求继续。";
      return "unknown";
    }
    if (result?.status !== "archived" || result.requestSha256 !== intent.requestSha256 || !sameBody(result.intent, intent.body) ||
      !uuid.test(result.result?.archiveId) || result.result?.contractVersionId !== intent.versionId ||
      result.result.status !== "effective" || !Array.isArray(result.result.fileIds) || !sameFiles(result.result.fileIds, intent.body.fileIds)) {
      message.value = "返回结果与原登记请求不一致，请保留原请求并查询。";
      return "mismatch";
    }
    await removeStored(intent, storageKey, false);
    if (started !== epoch) return "stale";
    pending.value = null;
    done.value = true;
    message.value = "正式登记完成，合同已生效。";
    input.completed(intent.contractId, intent.versionId);
    return "archived";
  }
  async function send(intent: Intent, captured: Coordinates, started: number, storageKey: string, resume: boolean) {
    const locks = globalThis.navigator?.locks;
    if (!locks) return;
    const admission = await locks.request(storageKey, () => {
      const saved = sameStoredIntent(localStorage.getItem(storageKey), intent);
      if (!saved || (!resume && saved.phase !== "preparing") || wasCancelled(intent, storageKey) || !sendCurrent(captured, started)) return;
      localStorage.setItem(storageKey, JSON.stringify({ ...intent, phase: "sent" }));
      const response = archiveSignedContractV2(intent.versionId, intent.body, () => started === epoch).catch(() => {});
      // Return the promise inside a value so the lock never waits on the network.
      return { response };
    });
    if (!admission) return;
    await admission.response;
    if (started === epoch) await read(intent, started, storageKey);
  }
  async function refreshCoordinates(captured: Coordinates, started: number) {
    const fresh = await fetchContractDraftWorkbench(captured.versionId, { retryUnauthorized: false, responseIsCurrent: () => started === epoch });
    return sendCurrent(captured, started) && sameCoordinates(directRegistrationCoordinates(fresh, input.actor.value), captured);
  }
  async function confirm() {
    const captured = context.value, actor = input.actor.value, locks = globalThis.navigator?.locks;
    if (!canConfirm.value || !captured || !actor || !locks) return;
    const started = epoch, storageKey = key();
    let claimed: Intent | undefined;
    busy.value = true;
    try {
      const body: ContractDirectRegistrationPayload = { archiveProtocolVersion: 2, archiveSource: "direct_signed",
        idempotencyKey: crypto.randomUUID(), expectedDraftRevision: captured.draftRevision, expectedInputSha256: captured.inputSha256,
        fileIds: captured.fileIds, confirmedMatchingSignedDocument: true };
      const coordinates = { actor, contractId: captured.contractId, versionId: captured.versionId, body };
      const intent = { ...coordinates, requestSha256: await requestSha(coordinates) };
      const observedRaw = localStorage.getItem(storageKey);
      const observed = await validatedIntent(observedRaw);
      const claim = await locks.request(storageKey, () => {
        if (!sendCurrent(captured, started)) return;
        const raw = localStorage.getItem(storageKey);
        if (raw !== null && (raw !== observedRaw || observed?.phase !== "preparing" ||
          !reconcileCancelledUnderLock(observed, storageKey, raw))) return { raw };
        localStorage.setItem(storageKey, JSON.stringify({ ...intent, phase: "preparing" }));
        claimed = intent;
        return { raw: null };
      });
      if (!claim || started !== epoch) return;
      if (claim.raw !== null) {
        const saved = await validatedIntent(claim.raw);
        if (saved && started === epoch) keepPending(saved);
        return;
      }
      keepPending(intent);
      if (!await refreshCoordinates(captured, started)) {
        if (started === epoch) message.value = "合同资料或权限已变化，请刷新并核对保存的原件。";
        return;
      }
      await send(intent, captured, started, storageKey, false);
    } catch {
      if (started === epoch) message.value = pending.value ? "正式登记结果待核对，请查询原请求。" : "暂时无法核对正式登记资料。";
    } finally {
      if (claimed && await removeStored(claimed, storageKey, true).catch(() => false) && started === epoch) pending.value = null;
      if (started === epoch) busy.value = false;
    }
  }
  async function query(continueOriginal = false) {
    const intent = pending.value;
    if (!intent || !(continueOriginal ? canContinue.value : canQuery.value)) return;
    const started = epoch, storageKey = key();
    busy.value = true;
    try {
      if (await read(intent, started, storageKey) !== "unknown" || !continueOriginal || started !== epoch) return;
      const captured = { contractId: intent.contractId, versionId: intent.versionId,
        draftRevision: intent.body.expectedDraftRevision, inputSha256: intent.body.expectedInputSha256, fileIds: intent.body.fileIds };
      if (!sendCurrent(captured, started) || !await refreshCoordinates(captured, started)) {
        if (started === epoch) message.value = "当前资料或权限已变化，请继续查询原登记结果。";
        return;
      }
      await send(intent, captured, started, storageKey, true);
    } catch {
      if (started === epoch) message.value = "暂时无法查询正式登记结果，已保留原请求。";
    } finally {
      if (started === epoch) busy.value = false;
    }
  }
  return { available, confirmationKey, visible, locked, pending, message, busy, canConfirm, canQuery, canContinue, confirm, query };
}
