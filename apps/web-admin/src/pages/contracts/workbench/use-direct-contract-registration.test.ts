import { createHash, webcrypto } from "node:crypto";
import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchContractDraftWorkbench, type ContractDraftWorkbenchReadModel } from "../../../api/contract-workbench.api";
import { fetchDirectSignedContractResult, archiveSignedContractV2,
  type ContractDirectRegistrationPayload } from "../../../api/core-flow-read.api";
import { directOriginalSlot, directRegistrationCoordinates, directWorkbenchState } from "./direct-pending-draft";
import { useDirectContractRegistration } from "./use-direct-contract-registration";

vi.mock("../../../api/contract-workbench.api", () => ({ fetchContractDraftWorkbench: vi.fn() }));
vi.mock("../../../api/core-flow-read.api", () => ({ fetchDirectSignedContractResult: vi.fn(), archiveSignedContractV2: vi.fn() }));

const versionId = "f42c7d1a-7de0-42fd-9de0-f7a9270cc47f";
const files = ["d42c7d1a-7de0-42fd-9de0-f7a9270cc47f", "a42c7d1a-7de0-42fd-9de0-f7a9270cc47f"];
const archiveId = "b42c7d1a-7de0-42fd-9de0-f7a9270cc47f";
const actorId = "经办";
const storageKey = "jg:direct-contract-registration:v1:" + encodeURIComponent(actorId) + ":" + versionId;
const scopes: Array<ReturnType<typeof effectScope>> = [];
let simulateInterleavedClaims = false;
let lockDepth = 0;
let failNextPrimaryRemove = false;

function navigatorLocks() {
  const queues = new Map<string, Promise<unknown>>();
  return {
    request: <T>(name: string, task: () => Promise<T>) => {
      const next = (queues.get(name) ?? Promise.resolve()).then(async () => {
        lockDepth++;
        try { return await task(); } finally { lockDepth--; }
      });
      queues.set(name, next.catch(() => {}));
      return next;
    }
  };
}

function workbench(enabled = true, revision = 2): ContractDraftWorkbenchReadModel {
  const marker = { protocolVersion: 1, source: "direct_signed", relationship: "outside", signedOn: null,
    enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 },
    fixedPaymentTermsVersionId: null };
  return {
    contract: { id: "合同", projectId: "project", ownerUserId: actorId },
    version: { id: versionId, contractId: "合同", status: "draft", versionNo: 1, draftRevision: revision, changeType: "original",
      numericProtocolVersion: 2, draftData: { directSigningInput: marker }, documentContentRevision: null,
      documentContentFingerprint: null, originalSignedNumberState: "available", originalSignedNumber: "原号" },
    draft: { directSigningInput: marker },
    paymentTerms: null,
    attachments: files.map((fileId, displayOrder) => ({ slotKey: directOriginalSlot, fileId, displayOrder })),
    directPendingCapabilities: { registrationEnabled: enabled, copyEnabled: false, purgeEnabled: false },
    directPendingInput: { protocolVersion: 1, sourceKind: "direct_signed_pending", state: "complete",
      sourceRevision: revision, inputSha256: "a".repeat(64), Q: {
        inputProtocolVersion: 1, source: { kind: "direct_signed", relationship: "outside" },
        locator: { projectId: "project", contractId: "合同", contractVersionId: versionId, versionNo: 1,
          changeType: "original", draftRevision: revision },
        signedFiles: files.map((fileId, displayOrder) => ({ fileId, displayOrder, mimeType: "application/pdf" }))
      } }
  } as unknown as ContractDraftWorkbenchReadModel;
}
function mount(loaded: ContractDraftWorkbenchReadModel | null = workbench()) {
  const actor = ref<string | undefined>(actorId);
  const receipt = ref(loaded);
  const completed = vi.fn();
  const blocked = ref(false);
  const online = ref(true);
  const scope = effectScope();
  scopes.push(scope);
  const registration = scope.run(() => useDirectContractRegistration({
    actor, routeContract: ref("合同"), routeVersion: ref(versionId), workbench: receipt, blocked, online, completed
  }))!;
  return { registration, scope, completed, actor, receipt, blocked, online };
}
function originalResult(body: ContractDirectRegistrationPayload) {
  const parts = ["contract-direct-archive-request-v1","2","direct_signed","合同",versionId,actorId,body.idempotencyKey,
    String(body.expectedDraftRevision),body.expectedInputSha256,"2",...files,"true"];
  const requestSha256 = createHash("sha256").update(parts.map(part => Buffer.byteLength(part) + ":" + part).join("")).digest("hex");
  return { status: "archived" as const, requestSha256, intent: body,
    result: { archiveId, contractVersionId: versionId, status: "effective" as const, fileIds: files } };
}

describe("表外直签工作台登记", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    simulateInterleavedClaims = false;
    lockDepth = 0;
    failNextPrimaryRemove = false;
    vi.stubGlobal("navigator", { locks: navigatorLocks() });
    const store = new Map<string, string>();
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("localStorage", {
      // Model two browser tabs reading the old value before either write is visible
      // when their independent localStorage operations run without a shared lock.
      getItem: (key: string) => simulateInterleavedClaims && lockDepth === 0 ? null : store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => {
        if (key === storageKey && failNextPrimaryRemove) {
          failNextPrimaryRemove = false;
          throw new Error("取消见证已写，原记录删除中断");
        }
        store.delete(key);
      }
    });
  });
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    vi.unstubAllGlobals();
  });

  it("只接受当前经办和完整、原顺序保存的 PDF 坐标", () => {
    const ready = workbench();
    expect(directWorkbenchState(ready)).toBe("complete");
    expect(directRegistrationCoordinates(ready, actorId)).toMatchObject({ fileIds: files, draftRevision: 2 });
    expect(directRegistrationCoordinates(ready, "another")).toBeNull();
    expect(directRegistrationCoordinates(workbench(false), actorId)).toBeNull();
    ready.attachments.reverse();
    expect(directRegistrationCoordinates(ready, actorId)).toBeNull();
  });

  it("丢失响应只查原标识，重新打开工作台后仍可核对", async () => {
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    const first = mount();
    await vi.waitFor(() => expect(first.registration.canConfirm.value).toBe(true));
    await first.registration.confirm();
    const body = vi.mocked(archiveSignedContractV2).mock.calls[0][1];
    expect(body).toMatchObject({ archiveSource: "direct_signed", expectedDraftRevision: 2, fileIds: files,
      expectedInputSha256: "a".repeat(64), confirmedMatchingSignedDocument: true });
    expect(vi.mocked(fetchDirectSignedContractResult).mock.calls[0].slice(0,2)).toEqual([versionId,body.idempotencyKey]);
    expect(first.registration.canConfirm.value).toBe(false);
    await first.registration.confirm();
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    first.scope.stop();
    const again = mount(null);
    await vi.waitFor(() => expect(again.registration.canQuery.value).toBe(true));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue(originalResult(body));
    await again.registration.query();
    expect(again.completed).toHaveBeenCalledWith("合同",versionId);
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("查询期间切换账号时保留原记录，不应用旧账号的结果", async () => {
    const fixture = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(fixture.registration.canConfirm.value).toBe(true));
    await fixture.registration.confirm();
    const body = vi.mocked(archiveSignedContractV2).mock.calls[0][1];
    let completeRead: (value: ReturnType<typeof originalResult>) => void = () => {};
    vi.mocked(fetchDirectSignedContractResult).mockImplementationOnce(() => new Promise(resolve => { completeRead = resolve; }));
    const observed = fixture.registration.query();
    await vi.waitFor(() => expect(fetchDirectSignedContractResult).toHaveBeenCalledTimes(2));
    fixture.actor.value = "另一经办";
    completeRead(originalResult(body));
    await observed;
    expect(fixture.completed).not.toHaveBeenCalled();
    expect(fixture.registration.pending.value).toBeNull();
    expect(localStorage.getItem(storageKey)).not.toBeNull();
  });

  it("两个标签页同时确认时，只保留并提交第一份原请求", async () => {
    const first = mount(), second = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    simulateInterleavedClaims = true;
    await vi.waitFor(() => expect(first.registration.canConfirm.value && second.registration.canConfirm.value).toBe(true));
    await Promise.all([first.registration.confirm(), second.registration.confirm()]);
    simulateInterleavedClaims = false;
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    const body = vi.mocked(archiveSignedContractV2).mock.calls[0][1];
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "null")?.body).toEqual(body);
    expect(second.registration.pending.value?.body).toEqual(body);
  });

  it("另一标签页的登记 POST 挂起时，仍可读取已经提交的原标识", async () => {
    const first = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    let finishPost: () => void = () => {};
    vi.mocked(archiveSignedContractV2).mockImplementation(() => new Promise(resolve => {
      finishPost = () => resolve({ archiveId, contractVersionId: versionId, status: "effective", fileIds: files });
    }));
    await vi.waitFor(() => expect(first.registration.canConfirm.value).toBe(true));
    const submitting = first.registration.confirm();
    await vi.waitFor(() => expect(archiveSignedContractV2).toHaveBeenCalledTimes(1));
    const body = vi.mocked(archiveSignedContractV2).mock.calls[0][1];
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue(originalResult(body));
    const second = mount();
    await vi.waitFor(() => expect(second.registration.canQuery.value).toBe(true));
    const querying = second.registration.query();
    try {
      await vi.waitFor(() => expect(second.completed).toHaveBeenCalledWith("合同", versionId), { timeout: 300 });
      expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    } finally {
      finishPost();
      await Promise.all([submitting, querying]);
    }
  });

  it("第一份 POST 仍等待时，另一页只能明确续办完全相同的原请求", async () => {
    const first = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    let finishPost: () => void = () => {};
    vi.mocked(archiveSignedContractV2).mockImplementationOnce(() => new Promise(resolve => {
      finishPost = () => resolve({ archiveId, contractVersionId: versionId, status: "effective", fileIds: files });
    })).mockRejectedValueOnce(new Error("续办结果待核对"));
    await vi.waitFor(() => expect(first.registration.canConfirm.value).toBe(true));
    const submitting = first.registration.confirm();
    try {
      await vi.waitFor(() => expect(archiveSignedContractV2).toHaveBeenCalledTimes(1));
      const original = vi.mocked(archiveSignedContractV2).mock.calls[0][1];
      const second = mount();
      await vi.waitFor(() => expect(second.registration.canContinue.value).toBe(true));
      await second.registration.query(true);
      expect(vi.mocked(archiveSignedContractV2).mock.calls.map(([, body]) => body)).toEqual([original, original]);
      expect(vi.mocked(fetchDirectSignedContractResult).mock.calls.every(([, key]) => key === original.idempotencyKey)).toBe(true);
      expect(JSON.parse(localStorage.getItem(storageKey) ?? "null")?.body).toEqual(original);
    } finally {
      finishPost();
      await submitting;
    }
  });

  it("另一页可以解除确实未发出的原请求并重新确认", async () => {
    const first = mount();
    let rejectRefresh: (error: Error) => void = () => {};
    vi.mocked(fetchContractDraftWorkbench).mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(first.registration.canConfirm.value).toBe(true));
    const confirming = first.registration.confirm();
    await vi.waitFor(() => expect(fetchContractDraftWorkbench).toHaveBeenCalledTimes(1));
    const second = mount();
    await vi.waitFor(() => expect(second.registration.canQuery.value).toBe(true));
    const cancelled = second.registration.pending.value?.body;
    rejectRefresh(new Error("本次刷新未完成"));
    await confirming;
    expect(archiveSignedContractV2).not.toHaveBeenCalled();
    await second.registration.query(true);
    expect(archiveSignedContractV2).not.toHaveBeenCalled();
    expect(second.registration.pending.value).toBeNull();
    expect(second.registration.canConfirm.value).toBe(true);
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    await second.registration.confirm();
    expect(vi.mocked(archiveSignedContractV2).mock.calls[0][1].idempotencyKey).not.toBe(cancelled?.idempotencyKey);
  });

  it.each(["查询", "重开", "确认"] as const)("%s 能修复取消见证写成后未删除的待办", async mode => {
    const first = mount();
    const untouched = mode === "确认" ? mount() : null;
    let rejectRefresh: (error: Error) => void = () => {};
    vi.mocked(fetchContractDraftWorkbench).mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(first.registration.canConfirm.value).toBe(true));
    const confirming = first.registration.confirm();
    await vi.waitFor(() => expect(fetchContractDraftWorkbench).toHaveBeenCalledTimes(1));
    const observer = mode === "查询" ? mount() : null;
    if (observer) await vi.waitFor(() => expect(observer.registration.canQuery.value).toBe(true));
    const old = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    failNextPrimaryRemove = true;
    rejectRefresh(new Error("首次预检失败"));
    await confirming;
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    expect(archiveSignedContractV2).not.toHaveBeenCalled();

    if (observer) await observer.registration.query();
    const next = observer ?? untouched ?? mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    await vi.waitFor(() => expect(next.registration.canConfirm.value).toBe(true));
    if (mode !== "确认") expect(localStorage.getItem(storageKey)).toBeNull();
    await next.registration.confirm();
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(archiveSignedContractV2).mock.calls[0][1].idempotencyKey).not.toBe(old.body.idempotencyKey);
  });

  it("浏览器记录消失但没有未发出的见证时，保留已发送原请求", async () => {
    const page = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(page.registration.canConfirm.value).toBe(true));
    await page.registration.confirm();
    const original = page.registration.pending.value?.body;
    localStorage.removeItem(storageKey);
    await page.registration.query(true);
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    expect(page.registration.pending.value?.body).toEqual(original);
    expect(page.registration.canConfirm.value).toBe(false);
  });

  it("浏览器不支持跨标签页锁时只允许读取已有请求", async () => {
    const first = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(first.registration.canConfirm.value).toBe(true));
    await first.registration.confirm();
    first.scope.stop();
    vi.stubGlobal("navigator", {});
    const second = mount();
    await vi.waitFor(() => expect(second.registration.canQuery.value).toBe(true));
    expect(second.registration.canContinue.value).toBe(false);
    await second.registration.query(true);
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
  });

  it("等待服务端重读期间本页修订变化时不提交旧资料", async () => {
    const page = mount();
    let resolveRefresh: (value: ContractDraftWorkbenchReadModel) => void = () => {};
    vi.mocked(fetchContractDraftWorkbench).mockImplementation(() => new Promise(resolve => { resolveRefresh = resolve; }));
    await vi.waitFor(() => expect(page.registration.canConfirm.value).toBe(true));
    const confirming = page.registration.confirm();
    await vi.waitFor(() => expect(fetchContractDraftWorkbench).toHaveBeenCalledTimes(1));
    page.receipt.value = workbench(true, 3);
    resolveRefresh(workbench());
    await confirming;
    expect(archiveSignedContractV2).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("原请求续办重读期间离线时不重发", async () => {
    const page = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValueOnce(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(page.registration.canConfirm.value).toBe(true));
    await page.registration.confirm();
    let resolveRefresh: (value: ContractDraftWorkbenchReadModel) => void = () => {};
    vi.mocked(fetchContractDraftWorkbench).mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    const continuation = page.registration.query(true);
    await vi.waitFor(() => expect(fetchContractDraftWorkbench).toHaveBeenCalledTimes(2));
    page.online.value = false;
    resolveRefresh(workbench());
    await continuation;
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
  });

  it("明确继续时先查原键，重新核对同一资料，再原样发一次", async () => {
    const fixture = mount();
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValue(workbench());
    vi.mocked(archiveSignedContractV2).mockRejectedValue(new Error("连接断开"));
    vi.mocked(fetchDirectSignedContractResult).mockResolvedValue({ status: "unknown" });
    await vi.waitFor(() => expect(fixture.registration.canConfirm.value).toBe(true));
    await fixture.registration.confirm();
    const body = vi.mocked(archiveSignedContractV2).mock.calls[0][1];
    vi.mocked(fetchContractDraftWorkbench).mockResolvedValueOnce(workbench(true,3));
    await fixture.registration.query(true);
    expect(archiveSignedContractV2).toHaveBeenCalledTimes(1);
    await fixture.registration.query(true);
    expect(vi.mocked(archiveSignedContractV2).mock.calls.map(([, request]) => request)).toEqual([body,body]);
    expect(vi.mocked(fetchDirectSignedContractResult).mock.calls.every(([, key]) => key === body.idempotencyKey)).toBe(true);
    expect(vi.mocked(fetchDirectSignedContractResult).mock.invocationCallOrder[2])
      .toBeLessThan(vi.mocked(archiveSignedContractV2).mock.invocationCallOrder[1]);
  });
});
