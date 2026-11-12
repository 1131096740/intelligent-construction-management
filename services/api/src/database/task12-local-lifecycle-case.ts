import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { publishTask12GeneratedMaterialTemplate } from "./task12-generated-material-template";
import { runTask12GeneratedDocument } from "./task12-generated-document-seam";
import { extractContractDocx } from "../contract-document/contract-docx-extractor";

// This consumer performs public requests only. Admission, owner proofs and fault
// installation belong to the owning controller, never to these continuations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
export interface Task12LocalLifecycleRequest {
  method: "GET" | "POST" | "PUT" | "PATCH"; path: string;
  json?: Readonly<Record<string, unknown>>; form?: FormData; headers?: Readonly<Record<string, string>>;
}
export interface Task12LocalLifecycleBridge {
  check(): void;
  send(actor: number, request: Task12LocalLifecycleRequest): Promise<{ status: number; body: unknown }>;
  download(actor: number, path: string): Promise<{ status: number; bytes: Buffer }>;
  now(): number; wait(ms: number): Promise<void>;
}
interface Fixture {
  approval: { project: { id: string }; handler: { id: string }; users: readonly { id: string; phone: string }[] };
  master: { CompanyEntity: readonly { id: string; name: string }[]; BusinessPartyVersion: readonly { id: string }[] };
}
export interface Task12LocalLifecycleCaseInput {
  fixture: Fixture; passwords: readonly string[]; sourceDocx: Uint8Array; originals: readonly Uint8Array[];
  bridge: Task12LocalLifecycleBridge; signal: AbortSignal;
  readPdfDrawnText(bytes: Buffer, signal: AbortSignal): Promise<readonly string[]>;
}
export interface Task12LocalLifecycleCheckpoint {
  stage: "ORIGINALS" | "AUDIT_ROLLBACK" | "COMPLETE";
  fixtureIdentity: string; projectId: string; handlerId: string; contractId: string; versionId: string;
  roundIds: Readonly<{ withdrawn: string; rejected: string; approved: string }>;
  generationIds: Readonly<{ first: string; second: string; final: string }>;
  final: Readonly<{ documentContentRevision: number; documentContentFingerprint: string }>;
  originals: readonly Readonly<{ id: string; sha256: string; sizeBytes: number }>[];
  archive?: Readonly<{ id: string; idempotencyKey: string }>;
}
interface State {
  input: Task12LocalLifecycleCaseInput; checkpoint: Task12LocalLifecycleCheckpoint;
  archive: Body; originalBytes: readonly Buffer[];
}
const checkpoints = new WeakMap<object, State>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const object = (v: unknown): Body => v && typeof v === "object" && !Array.isArray(v) && !types.isProxy(v) ? v as Body : {};
const id = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
function need(value: unknown, stage: string): asserts value {
  if (!value) throw Object.assign(new Error("TASK12_LOCAL_LIFECYCLE_CASE_" + stage), { code: "TASK12_LOCAL_LIFECYCLE_CASE_" + stage });
}
function check(input: Task12LocalLifecycleCaseInput) { need(!input.signal.aborted, "ABORTED"); input.bridge.check(); }
async function send(input: Task12LocalLifecycleCaseInput, actor: number, path: string, method: Task12LocalLifecycleRequest["method"] = "GET", json?: Body, form?: FormData, headers?: Record<string,string>) {
  check(input); const result = await input.bridge.send(actor, { method, path, ...(json ? { json } : {}), ...(form ? { form } : {}), ...(headers ? { headers } : {}) }); check(input); return result;
}
async function accepted(input: Task12LocalLifecycleCaseInput, actor: number, path: string, method: Task12LocalLifecycleRequest["method"] = "GET", json?: Body, form?: FormData, status = method === "POST" ? 201 : 200, headers?: Record<string,string>) {
  const response = await send(input, actor, path, method, json, form, headers); need(response.status === status, "HTTP"); return object(response.body);
}
function form(bytes: Uint8Array, type: string, name: string) { const body = new FormData(); body.append("file", new Blob([Uint8Array.from(bytes)], { type }), name); return body; }
function issue(state: State) { const token = Object.freeze({}); checkpoints.set(token, state); return token; }
function claim(token: object, stage?: Task12LocalLifecycleCheckpoint["stage"]) {
  const state = checkpoints.get(token); need(state && (!stage || state.checkpoint.stage === stage), "CHECKPOINT"); check(state.input); return state;
}
export function claimTask12LocalLifecycleCheckpoint(token: object): Task12LocalLifecycleCheckpoint { return claim(token).checkpoint; }

export async function runTask12LocalLifecycleCase(input: Task12LocalLifecycleCaseInput): Promise<object> {
  need(input && !types.isProxy(input) && input.signal instanceof AbortSignal && !input.signal.aborted && input.bridge &&
    [input.bridge.check, input.bridge.send, input.bridge.download, input.bridge.now, input.bridge.wait, input.readPdfDrawnText].every(fn => typeof fn === "function"), "INPUT");
  const { fixture, passwords } = input, seed = fixture?.approval, company = fixture?.master?.CompanyEntity?.[0], partyVersion = fixture?.master?.BusinessPartyVersion?.[0];
  need(seed && seed.users.length === 8 && seed.users.every(user => id(user.id) && typeof user.phone === "string") &&
    new Set(seed.users.map(user => user.id)).size === 8 && id(seed.project.id) && seed.handler.id === seed.users[0].id &&
    company && id(company.id) && partyVersion && id(partyVersion.id) && passwords.length === 8 &&
    passwords.every(value => /^[a-f0-9]{64}$/u.test(value)) && new Set(passwords).size === 8 && input.originals.length === 2 &&
    input.originals.every(bytes => bytes instanceof Uint8Array && bytes.length > 5 && Buffer.from(bytes).subarray(0,5).toString() === "%PDF-") &&
    hash(input.originals[0]) !== hash(input.originals[1]), "INPUT");
  check(input);
  for (const [actor, user] of seed.users.entries()) {
    const result = await accepted(input, actor, "/auth/login", "POST", { phone: user.phone, password: passwords[actor] });
    need(typeof result.tokens?.accessToken === "string" && result.tokens.accessToken.length > 0, "LOGIN");
  }
  const signature = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
  for (const actor of [1,2,3,4,5]) await accepted(input, actor, "/me/signature/canvas", "POST", undefined, form(signature, "image/png", "signature.png"));
  const port = (actor: number) => ({ now: () => { check(input); return input.bridge.now(); }, wait: async (ms: number) => { check(input); await input.bridge.wait(ms); check(input); },
    send: (request: Task12LocalLifecycleRequest) => send(input, actor, request.path, request.method, request.json, request.form, request.headers) });
  const published = await publishTask12GeneratedMaterialTemplate(input.sourceDocx, seed.users[2].id, port(2));
  const created = await accepted(input, 0, "/contracts", "POST", { projectId: seed.project.id, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "inside", amountLimitType: "capped" });
  const contractId = created.contract?.id, versionId = created.version?.id; need(id(contractId) && id(versionId), "DRAFT");
  const draft = "/contract-drafts/" + versionId, contract = "/contracts/" + versionId;
  const lease = await accepted(input, 0, draft + "/edit-lease", "POST"); need(typeof lease.token === "string", "LEASE");
  const headers = { "x-contract-draft-lease": lease.token as string };
  const workbench = () => accepted(input, 0, draft + "/workbench");
  const detail = (actor = 0) => accepted(input, actor, "/contracts/" + contractId + "?versionId=" + versionId);
  let bodyPlan: Body | undefined;
  const save = async () => {
    const current = await workbench(); need(Array.isArray(current.bills) && object(current.version).draftRevision, "DRAFT");
    await accepted(input, 0, draft, "PUT", { idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision,
      changedSections: ["draft","parties"], draft: { numericProtocolVersion: 2, companyEntityId: company.id,
        draftData: { ...current.draft, contractName: "本轮隔离V2材料合同", contractBasics: { businessType: "material_purchase", relationship: "inside", amountBasis: "tax_inclusive", invoiceStatus: "pending" }, ...(bodyPlan ? { documentBody: bodyPlan } : {}) },
        clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: published.layoutId,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
      parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: company.name } }, { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: partyVersion.id, snapshot: {} }],
      bills: current.bills.map((bill: Body) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } }, undefined, 200, headers);
  };
  await save(); const sourceBody = await accepted(input, 0, draft + "/document-body");
  const editable = Array.isArray(sourceBody.blocks) && sourceBody.blocks.find((block: Body) => block.editable && typeof block.text === "string" && block.text.startsWith("4.若卖方违背")); need(editable && typeof editable.id === "string", "BODY");
  let clause = "双方补充约定第一版。";
  const edit = () => { bodyPlan = { protocolVersion: 1, layoutTemplateVersionId: published.layoutId, sourceSha256: sourceBody.sourceSha256, edits: [{ positionId: editable.id, text: editable.text + clause }] }; };
  edit(); await save();
  const download = async (fileId: string) => {
    const ticket = await accepted(input, 0, "/files/" + fileId + "/download-ticket", "POST", { confirmationPassword: passwords[0], downloadReason: "本轮隔离合同验收" });
    need(typeof ticket.downloadUrl === "string" && ticket.downloadUrl.startsWith("/files/" + fileId + "/download?"), "DOWNLOAD");
    const response = await input.bridge.download(0, ticket.downloadUrl); check(input); need(response.status === 200 && response.bytes instanceof Uint8Array && response.bytes.length > 0, "DOWNLOAD"); return { bytes: response.bytes, url: ticket.downloadUrl as string };
  };
  const generate = async () => {
    const current = await workbench(), version = object(current.version);
    const generated = await runTask12GeneratedDocument({ template: published, versionId, sourceRevision: version.draftRevision,
      documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
      lease: { token: lease.token, leaseRevision: lease.leaseRevision, expiresAt: current.lease.expiresAt } }, port(0));
    const word = await download(generated.docxFileId), pdf = await download(generated.pdfFileId);
    need(extractContractDocx(word.bytes).blocks.map(block => block.text).join(" ").includes(clause.normalize("NFKC")), "WORD");
    const pdfText = await input.readPdfDrawnText(pdf.bytes, input.signal); check(input); need(pdfText.join(" ").includes("本轮隔离V2材料合同"), "PDF");
    return { generated, submission: { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2,
      documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
      generatedDocumentId: generated.generationId, sourceSha256: sourceBody.sourceSha256, blanksReviewed: true } };
  };
  const reviewContext = async (actor: number) => object((await detail(actor)).reviewApprovalContext);
  const review = (actor: number, context: Body, decision = "approve") => send(input, actor, contract + "/approval", "POST", { ...context, decision, ...(decision === "reject" ? { comment: "本轮退回重新核对" } : {}) });
  const submit = (body: Body) => accepted(input, 0, draft + "/submission", "POST", body, undefined, 201, headers);
  const first = await generate();
  need((await send(input, 0, draft + "/submission", "POST", { ...first.submission, blanksReviewed: false }, undefined, headers)).status === 409, "BLANKS");
  need((await send(input, 7, draft + "/submission", "POST", first.submission, undefined, headers)).status === 403, "OUTSIDER");
  const round1 = await submit(first.submission); need(id(round1.approvalInstanceId), "ROUND");
  need((await review(2, await reviewContext(2))).status === 201, "APPROVAL"); const stale = await reviewContext(1);
  const withdrawal = (await detail()).withdrawApprovalContext; need(withdrawal && typeof withdrawal === "object", "WITHDRAWAL");
  await accepted(input, 0, contract + "/approval-withdrawal", "POST", withdrawal);
  need((await review(1, stale)).status === 409, "STALE_ROUND");
  clause = "撤回修改后的第二版，所有职责重新签署。"; edit(); await save(); const second = await generate();
  need(second.submission.documentContentFingerprint !== first.submission.documentContentFingerprint && second.generated.generationId !== first.generated.generationId, "BODY_CHANGED");
  const round2 = await submit(second.submission); need(id(round2.approvalInstanceId) && round2.approvalInstanceId !== round1.approvalInstanceId, "ROUND");
  need((await review(1, await reviewContext(1), "reject")).status === 201, "REJECTION");
  const final = await generate(), round3 = await submit(final.submission); need(id(round3.approvalInstanceId) && ![round1.approvalInstanceId,round2.approvalInstanceId].includes(round3.approvalInstanceId), "ROUND");
  need(isDeepStrictEqual(await submit(final.submission), round3), "SUBMIT_REPLAY");
  const contexts = await Promise.all([1,2,3,4,5].map(reviewContext));
  need(contexts.every(context => typeof context.expectedParallelApprovalEpoch === "string" && /^[a-f0-9]{64}$/u.test(context.expectedParallelApprovalEpoch)) && new Set(contexts.map(context => context.expectedParallelApprovalEpoch)).size === 1, "EPOCH");
  const approvals = await Promise.all(contexts.map((context, index) => review(index + 1, context))); need(approvals.every(response => response.status === 201), "APPROVAL");
  const lifecycle = object((await detail(6)).v2Lifecycle);
  need(lifecycle.status === "ready" && lifecycle.state === "pending_seal" && lifecycle.approvalInstanceId === round3.approvalInstanceId && id(lifecycle.sealTaskId) && lifecycle.documentContentFingerprint === final.submission.documentContentFingerprint && lifecycle.documentContentRevision === final.submission.documentContentRevision, "SEAL");
  const seal = { expectedApprovalInstanceId: round3.approvalInstanceId, expectedSealTaskId: lifecycle.sealTaskId, documentContentRevision: final.submission.documentContentRevision, documentContentFingerprint: final.submission.documentContentFingerprint, confirmed: true };
  need((await send(input, 0, contract + "/seal-confirmation", "POST", seal)).status === 403, "SEAL_ACTOR");
  const sealed = await accepted(input, 6, contract + "/seal-confirmation", "POST", seal);
  need(isDeepStrictEqual(await accepted(input, 6, contract + "/seal-confirmation", "POST", seal), sealed), "SEAL_REPLAY");
  const originalBytes = input.originals.map(bytes => Buffer.from(bytes)), originals = [];
  for (const [index, bytes] of originalBytes.entries()) {
    const upload = await accepted(input, 0, "/files", "POST", undefined, form(bytes, "application/pdf", "signed-original-" + (index + 1) + ".pdf"));
    need(id(upload.id) && upload.contentSha256 === hash(bytes) && upload.sizeBytes === bytes.length, "ORIGINAL"); originals.push(Object.freeze({ id: upload.id, sha256: hash(bytes), sizeBytes: bytes.length }));
  }
  need(originals[0].id !== originals[1].id, "ORIGINAL");
  const archive = { expectedApprovalInstanceId: seal.expectedApprovalInstanceId, expectedSealTaskId: seal.expectedSealTaskId,
    documentContentRevision: seal.documentContentRevision, documentContentFingerprint: seal.documentContentFingerprint,
    archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: randomUUID(), fileIds: originals.map(original => original.id), confirmedMatchingSignedDocument: true };
  need((await send(input, 7, contract + "/signed-archive", "POST", archive)).status === 403, "OUTSIDER");
  const checkpoint: Task12LocalLifecycleCheckpoint = Object.freeze({ stage: "ORIGINALS", fixtureIdentity: seed.project.id, projectId: seed.project.id, handlerId: seed.handler.id, contractId, versionId,
    roundIds: Object.freeze({ withdrawn: round1.approvalInstanceId, rejected: round2.approvalInstanceId, approved: round3.approvalInstanceId }),
    generationIds: Object.freeze({ first: first.generated.generationId, second: second.generated.generationId, final: final.generated.generationId }),
    final: Object.freeze({ documentContentRevision: final.submission.documentContentRevision, documentContentFingerprint: final.submission.documentContentFingerprint }), originals: Object.freeze(originals) });
  return issue({ input, checkpoint, archive: Object.freeze(archive), originalBytes });
}

export async function expectTask12LocalLifecycleAuditRollback(token: object): Promise<object> {
  const state = claim(token, "ORIGINALS"); checkpoints.delete(token);
  const response = await send(state.input, 0, "/contracts/" + state.checkpoint.versionId + "/signed-archive", "POST", state.archive);
  need(response.status === 500, "AUDIT_FAILURE");
  return issue({ ...state, checkpoint: Object.freeze({ ...state.checkpoint, stage: "AUDIT_ROLLBACK" }) });
}
export async function finishTask12LocalLifecycleCase(token: object): Promise<object> {
  const state = claim(token, "AUDIT_ROLLBACK"); checkpoints.delete(token);
  const { input, checkpoint, archive } = state, path = "/contracts/" + checkpoint.versionId;
  const archived = await accepted(input, 0, path + "/signed-archive", "POST", archive);
  need(archived.status === "effective" && archived.contractVersionId === checkpoint.versionId && id(archived.archiveId) && isDeepStrictEqual(archived.fileIds, archive.fileIds), "ARCHIVE");
  need(isDeepStrictEqual(await accepted(input, 0, path + "/signed-archive", "POST", archive), archived), "ARCHIVE_REPLAY");
  const queried = await accepted(input, 0, path + "/archive-requests/" + archive.idempotencyKey); need(isDeepStrictEqual(queried.result, archived), "ARCHIVE_QUERY");
  for (const [index, original] of checkpoint.originals.entries()) {
    const ticket = await accepted(input, 0, "/files/" + original.id + "/download-ticket", "POST", { confirmationPassword: input.passwords[0], downloadReason: "本轮签章原件核对" });
    need(typeof ticket.downloadUrl === "string" && ticket.downloadUrl.startsWith("/files/" + original.id + "/download?"), "DOWNLOAD");
    const downloaded = await input.bridge.download(0, ticket.downloadUrl); check(input); need(downloaded.status === 200 && downloaded.bytes.equals(state.originalBytes[index]), "DOWNLOAD");
    need((await send(input, 7, "/files/" + original.id + "/download-ticket", "POST", { confirmationPassword: input.passwords[7], downloadReason: "越权负控" })).status === 403, "OUTSIDER_DOWNLOAD");
    const expired = new URL(ticket.downloadUrl, "http://127.0.0.1"); expired.searchParams.set("expiresAt", "2000-01-01T00:00:00.000Z");
    const rejected = await input.bridge.download(0, expired.pathname + expired.search); check(input); need(rejected.status !== 200, "EXPIRED_DOWNLOAD");
  }
  const detail = await accepted(input, 0, "/contracts/" + checkpoint.contractId + "?versionId=" + checkpoint.versionId); need(detail.contractVersionId === checkpoint.versionId, "DETAIL");
  const complete = Object.freeze({ ...checkpoint, stage: "COMPLETE" as const, archive: Object.freeze({ id: archived.archiveId, idempotencyKey: archive.idempotencyKey as string }) });
  const summary = Object.freeze({ status: "LOCAL_LIFECYCLE_HTTP_COMPLETED_OWNER_PROOF_PENDING", storage: "LOCAL_ONLY", cosAccepted: false, browserAccepted: false, full394Accepted: false });
  checkpoints.set(summary, { ...state, checkpoint: complete }); return summary;
}
