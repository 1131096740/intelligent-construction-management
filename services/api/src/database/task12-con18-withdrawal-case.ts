import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { current261LifecycleCaseFromFixture } from "../../prisma/task12-current261-lifecycle-cases.cjs";
import { publishTask12GeneratedMaterialTemplate, publishTask12GeneratedEquipmentTemplate } from "./task12-generated-material-template";
import { runTask12GeneratedDocument, type Task12QueuedDocumentCoordinates } from "./task12-generated-document-seam";
import { extractContractDocx } from "../contract-document/contract-docx-extractor";
import { PDFDocument } from "pdf-lib";
import type { Task12LocalLifecycleCaseInput, Task12LocalLifecycleRequest, Task12LocalLifecycleDownloadedFile } from "./task12-local-lifecycle-case";
// Fixed contract lifecycle test only; owner observation is an independent
// read-only fixture boundary and does not replace the public HTTP actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
export interface Task12Con18Proof {
  withdrawnRoundId: string; newRoundId: string; withdrawnStatus: string; newStatus: string;
  oldApproveCount: number; oldSignatureSnapshotsCleared: boolean;
  newApproveCount: number; newAllUnsigned: boolean; newPendingCount: number;
}
export type Task12Con18Input = Task12LocalLifecycleCaseInput & {
  observer: { queued?(coordinates: Task12QueuedDocumentCoordinates): void; signed(versionId: string, roundId: string, actorId: string): Promise<boolean>; rounds(versionId: string, withdrawnRoundId: string, newRoundId: string): Promise<Task12Con18Proof>; archived(versionId: string, roundId: string, archiveId: string): Promise<boolean> };
};
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
async function pendingTask(input: Task12LocalLifecycleCaseInput, actor: number, versionId: string, count: 0 | 1) {
  const page = await accepted(input, actor, "/contracts/workbench?view=pending_action&page=1&pageSize=100");
  need(Array.isArray(page.rows) && page.rows.length === count && page.meta?.total === count && page.summary?.pending_action === count &&
    page.rows.every((row: unknown) => object(row).contractVersionId === versionId), "TASK_RELAY");
}

export async function runTask12Con18Withdrawal(input: Task12Con18Input) {
  need(input && !types.isProxy(input) && input.signal instanceof AbortSignal && !input.signal.aborted && input.bridge &&
    [input.bridge.check, input.bridge.send, input.bridge.download, input.bridge.now, input.bridge.wait, input.readPdfDrawnText].every(fn => typeof fn === "function"), "INPUT");
  const { fixture, passwords } = input, seed = fixture?.approval, company = fixture?.master?.CompanyEntity?.[0], partyVersion = fixture?.master?.BusinessPartyVersion?.[0];
  need(seed && seed.users.length === 8 && seed.users.every(user => id(user.id) && typeof user.phone === "string") &&
    new Set(seed.users.map(user => user.id)).size === 8 && id(seed.project.id) && seed.handler.id === seed.users[0].id &&
    company && id(company.id) && partyVersion && id(partyVersion.id) && passwords.length === 8 &&
    passwords.every(value => /^[a-f0-9]{64}$/u.test(value)) && new Set(passwords).size === 8 && input.originals.length === 2 && input.observer && typeof input.observer.signed === "function" && typeof input.observer.rounds === "function" && typeof input.observer.archived === "function", "INPUT");
  const selected = current261LifecycleCaseFromFixture(fixture);
  need(selected.relationship === "inside" && ["material_purchase", "equipment_rental"].includes(selected.contractTypeKey), "CASE");
  const equipment = selected.contractTypeKey === "equipment_rental", contractName = equipment ? "本轮隔离V2设备租赁合同" : "本轮隔离V2材料合同";
  check(input);
  for (const [actor, user] of seed.users.entries()) {
    const result = await accepted(input, actor, "/auth/login", "POST", { phone: user.phone, password: passwords[actor] });
    need(typeof result.tokens?.accessToken === "string" && result.tokens.accessToken.length > 0, "LOGIN");
  }
  const signature = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
  for (const actor of [1,2,3,4,5]) await accepted(input, actor, "/me/signature/canvas", "POST", undefined, form(signature, "image/png", "signature.png"));
  const port = (actor: number) => ({ now: () => { check(input); return input.bridge.now(); }, wait: async (ms: number) => { check(input); await input.bridge.wait(ms); check(input); },
    send: (request: Task12LocalLifecycleRequest) => send(input, actor, request.path, request.method, request.json, request.form, request.headers) });
  const published = await (equipment ? publishTask12GeneratedEquipmentTemplate : publishTask12GeneratedMaterialTemplate)(input.sourceDocx, seed.users[2].id, port(2));
  const created = await accepted(input, 0, "/contracts", "POST", { projectId: seed.project.id, numericProtocolVersion: 2, contractTypeKey: selected.contractTypeKey, relationship: selected.relationship, amountLimitType: "capped" });
  const contractId = created.contract?.id, versionId = created.version?.id; need(id(contractId) && id(versionId) && created.contract?.contractTypeKey === selected.contractTypeKey, "DRAFT");
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
        draftData: { ...current.draft, contractName, contractBasics: { businessType: selected.contractTypeKey, relationship: selected.relationship, amountBasis: "tax_inclusive", invoiceStatus: "pending" }, ...(bodyPlan ? { documentBody: bodyPlan } : {}) },
        clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: published.layoutId,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
      parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: company.name } }, { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: partyVersion.id, snapshot: {} }],
      bills: current.bills.map((bill: Body) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } }, undefined, 200, headers);
  };
  await save(); const sourceBody = await accepted(input, 0, draft + "/document-body");
  const editable = Array.isArray(sourceBody.blocks) && sourceBody.blocks.find((block: Body) => block.editable && typeof block.text === "string" && block.text.startsWith(equipment ? "3.甲方需要延长本合同租赁期限" : "4.若卖方违背")); need(editable && typeof editable.id === "string", "BODY");
  let clause = "双方补充约定第一版。";
  const edit = () => { bodyPlan = { protocolVersion: 1, layoutTemplateVersionId: published.layoutId, sourceSha256: sourceBody.sourceSha256, edits: [{ positionId: editable.id, text: editable.text + clause }] }; };
  edit(); await save();
  const generatedFiles = new Map<string, Readonly<{ generationId: string; docx: Task12LocalLifecycleDownloadedFile; pdf: Task12LocalLifecycleDownloadedFile }>>();
  const download = async (fileId: string, mimeType: string) => {
    const ticket = await accepted(input, 0, "/files/" + fileId + "/download-ticket", "POST", { confirmationPassword: passwords[0], downloadReason: "本轮隔离合同验收" });
    need(ticket.fileId === fileId && ticket.mimeType === mimeType && Number.isSafeInteger(ticket.sizeBytes) && ticket.sizeBytes > 0 &&
      typeof ticket.downloadUrl === "string" && ticket.downloadUrl.startsWith("/files/" + fileId + "/download?"), "DOWNLOAD");
    const response = await input.bridge.download(0, ticket.downloadUrl); check(input); need(response.status === 200 && response.bytes instanceof Uint8Array && response.bytes.length === ticket.sizeBytes && response.mimeType === mimeType, "DOWNLOAD");
    return { bytes: response.bytes, evidence: Object.freeze({ id: fileId, sha256: hash(response.bytes), sizeBytes: response.bytes.length, mimeType }) };
  };
  const pdfRounds: { generationId: string; bytes: Buffer; sha256: string; expectedBody: string }[] = [];
  const generate = async () => {
    const current = await workbench(), version = object(current.version);
    const generated = await runTask12GeneratedDocument({ template: published, versionId, sourceRevision: version.draftRevision,
      documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
      lease: { token: lease.token, leaseRevision: lease.leaseRevision, expiresAt: current.lease.expiresAt } }, { ...port(0), onQueued: input.observer.queued });
    const word = await download(generated.docxFileId, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), pdf = await download(generated.pdfFileId, "application/pdf");
    const downloaded = Object.freeze({ generationId: generated.generationId, docx: word.evidence, pdf: pdf.evidence });
    const previous = generatedFiles.get(generated.generationId);
    need(!previous || isDeepStrictEqual(previous, downloaded), "GENERATED_FILES_CHANGED");
    if (!previous) generatedFiles.set(generated.generationId, downloaded);
    need(extractContractDocx(word.bytes).blocks.map(block => block.text).join(" ").includes(clause.normalize("NFKC")), "WORD");
    pdfRounds.push({ generationId: generated.generationId, bytes: Buffer.from(pdf.bytes), sha256: pdf.evidence.sha256, expectedBody: editable.text + clause });
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
  need((await review(2, await reviewContext(2))).status === 201, "APPROVAL");
  check(input);need(await input.observer.signed(versionId, round1.approvalInstanceId, seed.users[2].id), "FIRST_SIGNATURE");check(input);
  const stale = await reviewContext(1);
  const withdrawal = (await detail()).withdrawApprovalContext; need(withdrawal && typeof withdrawal === "object", "WITHDRAWAL");
  await accepted(input, 0, contract + "/approval-withdrawal", "POST", withdrawal);
  need((await review(1, stale)).status === 409, "STALE_ROUND");
  clause = "撤回修改后的第二版，所有职责重新签署。"; edit(); await save(); const second = await generate();
  need(second.submission.documentContentFingerprint !== first.submission.documentContentFingerprint && second.generated.generationId !== first.generated.generationId, "BODY_CHANGED");
  const round2 = await submit(second.submission); need(id(round2.approvalInstanceId) && round2.approvalInstanceId !== round1.approvalInstanceId, "ROUND");
  const views = [];
  for (const actor of [1,2,3,4,5]) views.push(await detail(actor));
  const contexts = views.map(view => object(view.reviewApprovalContext));
  need(contexts.every(context => context.expectedApprovalInstanceId === round2.approvalInstanceId && Number.isSafeInteger(context.expectedNodeIndex) && typeof context.expectedParallelApprovalEpoch === "string" && /^[a-f0-9]{64}$/u.test(context.expectedParallelApprovalEpoch)) && new Set(contexts.map(context => context.expectedNodeIndex)).size === 5 && new Set(contexts.map(context => context.expectedParallelApprovalEpoch)).size === 1, "NEW_REVIEW_COORDINATES");
  const latest = await detail();
  need(Array.isArray(latest.approvalTimeline) && !latest.approvalTimeline.some((entry: Body) => entry.action === "approve"), "NEW_TIMELINE");
  for (const actor of [1,2,3,4,5]) await pendingTask(input, actor, versionId, 1);
  check(input); const proof = await input.observer.rounds(versionId, round1.approvalInstanceId, round2.approvalInstanceId); check(input);
  need(proof.withdrawnRoundId === round1.approvalInstanceId && proof.newRoundId === round2.approvalInstanceId && proof.withdrawnStatus === "withdrawn" && proof.newStatus === "in_progress" && proof.oldApproveCount === 1 && proof.oldSignatureSnapshotsCleared === true && proof.newApproveCount === 0 && proof.newAllUnsigned === true && proof.newPendingCount === 5, "ROUND_PROOF");
  const merged = await PDFDocument.create(), pages: Array<{first: number; count: number; body: string}> = [];
  for (const item of pdfRounds) {
    check(input); need(item.bytes.length <= 100000000 && hash(item.bytes) === item.sha256, "PDF");
    const doc = await PDFDocument.load(item.bytes, { throwOnInvalidObject: true, updateMetadata: false });
    const firstPage = merged.getPageCount(), count = doc.getPageCount(); need(!doc.isEncrypted && count > 0 && firstPage + count <= 100, "PDF");
    for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
    pages.push({first:firstPage,count,body:item.expectedBody});
  }
  const bytes = Buffer.from(await merged.save()); need(bytes.length <= 100000000 && pages.length === 2, "PDF");
  const pdfText = await input.readPdfDrawnText(bytes, input.signal); check(input);
  need(Array.isArray(pdfText) && pdfText.length === merged.getPageCount() && pdfText.every(page => typeof page === "string") && pdfText.reduce((n,page) => n + page.length, 0) <= 500000, "PDF");
  const compact = (text:string) => text.normalize("NFKC").replace(/\s/gu, "");
  for (const page of pages) { const text = compact(pdfText.slice(page.first,page.first+page.count).join("")); need(text.includes(compact(contractName)) && text.includes(compact(page.body)) && pages.every(other => other === page || !text.includes(compact(other.body))), "PDF"); }
  const approvals = await Promise.all(contexts.map((context, index) => review(index + 1, context)));
  need(approvals.every(response => response.status === 201), "APPROVAL");
  const lifecycle = object((await detail(6)).v2Lifecycle);
  need(lifecycle.status === "ready" && lifecycle.state === "pending_seal" && lifecycle.approvalInstanceId === round2.approvalInstanceId && id(lifecycle.sealTaskId) && lifecycle.documentContentFingerprint === second.submission.documentContentFingerprint && lifecycle.documentContentRevision === second.submission.documentContentRevision, "SEAL");
  const seal = { expectedApprovalInstanceId: round2.approvalInstanceId, expectedSealTaskId: lifecycle.sealTaskId, documentContentRevision: second.submission.documentContentRevision, documentContentFingerprint: second.submission.documentContentFingerprint, confirmed: true };
  need((await send(input, 0, contract + "/seal-confirmation", "POST", seal)).status === 403, "SEAL_ACTOR");
  await accepted(input, 6, contract + "/seal-confirmation", "POST", seal);
  const originals = [];
  for (const [index, original] of input.originals.entries()) {
    const bytes = Buffer.from(original), upload = await accepted(input, 0, "/files", "POST", undefined, form(bytes, "application/pdf", `signed-original-${index + 1}.pdf`));
    need(id(upload.id) && upload.contentSha256 === hash(bytes) && upload.sizeBytes === bytes.length, "ORIGINAL");
    originals.push({id:upload.id,bytes});
  }
  need(originals[0].id !== originals[1].id, "ORIGINAL");
  const archive = { expectedApprovalInstanceId: seal.expectedApprovalInstanceId, expectedSealTaskId: seal.expectedSealTaskId, documentContentRevision: seal.documentContentRevision, documentContentFingerprint: seal.documentContentFingerprint, archiveProtocolVersion: 2, archiveSource: "generated_approval", idempotencyKey: randomUUID(), fileIds: originals.map(original => original.id), confirmedMatchingSignedDocument: true };
  need((await send(input, 7, contract + "/signed-archive", "POST", archive)).status === 403, "OUTSIDER");
  const archived = await accepted(input, 0, contract + "/signed-archive", "POST", archive);
  need(archived.status === "effective" && archived.contractVersionId === versionId && id(archived.archiveId) && isDeepStrictEqual(archived.fileIds, archive.fileIds), "ARCHIVE");
  need(isDeepStrictEqual(await accepted(input, 0, contract + "/signed-archive", "POST", archive), archived), "ARCHIVE_REPLAY");
  need((await send(input, 0, contract + "/signed-archive", "POST", {...archive,idempotencyKey:randomUUID(),fileIds:[...archive.fileIds].reverse()})).status === 409, "ARCHIVE_REPLACEMENT");
  for (const original of originals) {
    const saved = await download(original.id, "application/pdf"); need(Buffer.from(saved.bytes).equals(original.bytes), "DOWNLOAD");
    need((await send(input, 7, "/files/" + original.id + "/download-ticket", "POST", {confirmationPassword:passwords[7],downloadReason:"越权负控"})).status === 403, "OUTSIDER_DOWNLOAD");
  }
  check(input); need(await input.observer.archived(versionId, round2.approvalInstanceId, archived.archiveId), "ARCHIVE_PROOF"); check(input);
  return Object.freeze({ oldCoordinateRejected:true, changedGeneration:true, newRoundPending:5, oldApprovalsVisible:false, archived:true, storage:"LOCAL_ONLY", full394Accepted:false });
}
