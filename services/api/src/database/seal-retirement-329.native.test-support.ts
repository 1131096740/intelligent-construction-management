import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { configureApiSecurity } from "../api-security";
import { PrismaService } from "./prisma.service";
import { CONTRACT_BODY_DOCX4J_ENGINE_VERSION } from "../contract-document/contract-document.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { extractContractDocx } from "../contract-document/contract-docx-extractor";
import { createTask12Con18DefaultHttp } from "./task12-con18-default-http";
import { buildTask12GeneratedApprovalFixture, hashTask12GeneratedAdmissionPassword } from "./task12-generated-approval-admission";
import { runTask12GeneratedDocument } from "./task12-generated-document-seam";
import { publishTask12GeneratedMaterialTemplate } from "./task12-generated-material-template";
import type { Task12LocalLifecycleRequest } from "./task12-local-lifecycle-case";

// The runner owns the isolated cluster, effective database grants and all storage.
type Packet = { ownerUrl: string; applicationOid: string; database: string; candidate: string };
type RequestDetails = Pick<Task12LocalLifecycleRequest, "json" | "form" | "headers">;
// The existing public transport returns untyped JSON. The assertions below check the fields used by the case.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const form = (bytes: Uint8Array, type: string, name: string) => {
  const data = new FormData();
  data.append("file", new Blob([Uint8Array.from(bytes)], { type }), name);
  return data;
};

function privatePacket(): Packet {
  const path = process.env.SEAL_329_NATIVE_PACKET;
  if (!path || !/^\/private\/tmp\/jg425-seal-329-[a-zA-Z0-9]+\/input[.]json$/u.test(path)) throw new Error("NATIVE_329_PACKET");
  const entry = lstatSync(path);
  if (!entry.isFile() || realpathSync(path) !== path || entry.uid !== process.getuid?.() || (entry.mode & 0o777) !== 0o600) throw new Error("NATIVE_329_PACKET");
  return JSON.parse(readFileSync(path, "utf8")) as Packet;
}

it("generates a V2 document on native docx4j, approves it, confirms the automatic seal and downloads its private archive", async () => {
  const packet = privatePacket();
  const owner = new PrismaClient({ datasources: { db: { url: packet.ownerUrl } } });
  const readOnlyApplication = new PrismaClient();
  const passwords = Array.from({length: 8}, () => randomBytes(32).toString("hex"));
  let app: INestApplication | undefined;
  let stage = "IDENTITY";
  let databaseFailure: { model?: string; action: string; code: string; sqlState?: string } | undefined;
  try {
    const [identity] = await readOnlyApplication.$queryRaw<Array<{ safe: boolean; oid: string }>>`
      SELECT current_database()  = ${packet.database} AND current_user = session_user
        AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication)
        AND inet_server_addr() = '127.0.0.1'::inet AS safe, r.oid::text AS oid FROM pg_roles r WHERE r.rolname = current_user`;
    expect(identity).toEqual({ safe: true, oid: packet.applicationOid });
    expect(await owner.project.count()).toBe(0);
    expect(await owner.contract.count()).toBe(0);
    stage = "SEED";
    const seed = buildTask12GeneratedApprovalFixture(randomUUID());
    for (const [actor, user] of seed.users.entries()) {
      await owner.user.create({ data: { ...user, passwordHash: await hashTask12GeneratedAdmissionPassword(passwords[actor]) } });
    }
    await owner.project.create({ data: seed.project });
    for (const member of seed.members) await owner.projectMember.create({ data: member });
    for (const role of seed.globalRoles) {
      await owner.position.create({ data: { id: role.positionId, key: role.roleKey, name: role.positionName } });
      await owner.userPosition.create({ data: { id: role.id, userId: role.userId, positionId: role.positionId } });
    }
    const company = await owner.companyEntity.create({ data: { name: "原生验收我方公司", dataStatus: "complete", currentVersionNo: 1,
      unifiedSocialCreditCode: "91440300708461136T", registeredAddress: "隔离测试地址" } });
    const companyVersion = await owner.companyEntityVersion.create({ data: { companyEntityId: company.id, versionNo: 1,
      name: company.name, isActive: true, action: "create", actorUserId: seed.handler.id,
      unifiedSocialCreditCode: company.unifiedSocialCreditCode, registeredAddress: company.registeredAddress } });
    await owner.projectParticipatingCompany.create({ data: { projectId: seed.project.id, companyEntityId: company.id,
      companyEntityVersionId: companyVersion.id, companyNameSnapshot: company.name, companyCreditCodeSnapshot: company.unifiedSocialCreditCode,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"), changeReason: "本轮隔离验收", addedByUserId: seed.handler.id } });
    const counterparty = await owner.businessParty.create({ data: { name: "原生验收供应单位", normalizedName: "原生验收供应单位",
      unifiedSocialCreditCode: "91350211M000100Y46", createdByUserId: seed.handler.id } });
    const partyVersion = await owner.businessPartyVersion.create({ data: { businessPartyId: counterparty.id, versionNo: 1,
      createdByUserId: seed.handler.id, snapshot: { name: counterparty.name, type: "organization",
        unifiedSocialCreditCode: counterparty.unifiedSocialCreditCode, registeredAddress: "隔离供应地址" } } });
    stage = "HTTP_BOOT";
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    configureApiSecurity(app);
    app.get(PrismaService).$use(async (params, next) => {
      try {
        return await next(params);
      } catch (error) {
        const detail = error as { code?: string; meta?: { code?: string } };
        if (typeof detail?.code === "string" && /^P[0-9]{4}$/u.test(detail.code)) {
          const sqlState = detail.meta?.code;
          databaseFailure = { model: params.model, action: params.action, code: detail.code,
            sqlState: typeof sqlState === "string" && /^[A-Z0-9]{5}$/u.test(sqlState) ? sqlState : undefined };
        }
        throw error;
      }
    });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const http = createTask12Con18DefaultHttp(await app.getUrl(), AbortSignal.timeout(360_000));
    const send = (actor: number, path: string, method: Task12LocalLifecycleRequest["method"] = "GET", details: RequestDetails = {}) =>
      http.send(actor, { path, method, ...details, headers: { "x-contract-numeric-protocol": "2", ...details.headers } });
    const expectStatus = async (response: ReturnType<typeof send>, expected: number): Promise<Payload> => {
      const result = await response;
      const body = result.body as Payload;
      if (result.status !== expected) {
        const code = typeof body?.code === "string" && /^[A-Z0-9_]{1,100}$/u.test(body.code) ? body.code : undefined;
        throw Object.assign(new Error("NATIVE_329_HTTP"), { status: result.status, expected, code });
      }
      return body;
    };
    const get = (actor: number, path: string) => expectStatus(send(actor, path), 200);
    const post = (actor: number, path: string, json?: Payload, headers?: Record<string, string>) =>
      expectStatus(send(actor, path, "POST", { json, headers }), 201);
    const port = (actor: number) => ({ now: http.now, wait: http.wait, send: (request: Task12LocalLifecycleRequest) => send(actor, request.path, request.method, request) });
    stage = "LOGIN";
    for (const [actor, user] of seed.users.entries()) await post(actor, "/auth/login", { phone: user.phone, password: passwords[actor] });
    stage = "SIGNATURES";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
    for (const actor of [1, 2, 3, 4, 5]) await expectStatus(send(actor, "/me/signature/canvas", "POST", { form: form(png, "image/png", "signature.png") }), 201);

    stage = "TEMPLATE";
    const material = readFileSync(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
    const published = await publishTask12GeneratedMaterialTemplate(material, seed.users[2].id, port(2));
    stage = "DRAFT";
    const created = await post(0, "/contracts", { projectId: seed.project.id, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "inside", amountLimitType: "capped" });
    const { id: contractId } = created.contract;
    const { id: versionId } = created.version;
    expect(typeof versionId).toBe("string");
    const draft = "/contract-drafts/" + versionId;
    const contract = "/contracts/" + versionId;
    const detail = (actor = 0) => get(actor, "/contracts/" + contractId + "?versionId=" + versionId);
    const lease = await post(0, draft + "/edit-lease");
    const headers = { "x-contract-draft-lease": lease.token as string };
    const workbench = () => get(0, draft + "/workbench");
    const name = "隔离验收材料合同";
    const addedClause = "双方补充约定原件保密。";
    const save = async (documentBody?: object) => {
      const current = await workbench();
      await expectStatus(send(0, draft, "PUT", { headers, json: {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision,
        changedSections: ["draft", "parties"],
        draft: { numericProtocolVersion: 2, companyEntityId: company.id,
          draftData: { ...current.draft, contractName: name, contractBasics: { businessType: "material_purchase", relationship: "inside", amountBasis: "tax_inclusive", invoiceStatus: "pending" },
            ...(documentBody ? { documentBody } : {}) },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: published.layoutId,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: company.name } },
          { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: partyVersion.id, snapshot: {} }],
        bills: current.bills.map((bill: Payload) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }}), 200);
    };
    await save();
    const source = await get(0, draft + "/document-body");
    const block = source.blocks.find((item: Payload) => item.editable && item.text.startsWith("4.若卖方违背"));
    expect(block?.id).toBeDefined();
    await save({ protocolVersion: 1, layoutTemplateVersionId: published.layoutId, sourceSha256: source.sourceSha256,
      edits: [{ positionId: block.id, text: block.text + addedClause }] });

    stage = "GENERATED";
    const current = await workbench();
    const version = current.version;
    const generated = await runTask12GeneratedDocument({ template: published, versionId, sourceRevision: version.draftRevision,
      documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
      lease: { token: lease.token, leaseRevision: lease.leaseRevision, expiresAt: current.lease.expiresAt } }, port(0));
    const download = async (id: string, mimeType: string) => {
      const ticket = await post(0, "/files/" + id + "/download-ticket", { confirmationPassword: passwords[0], downloadReason: "隔离验收证据核对" });
      expect(ticket).toMatchObject({ fileId: id, mimeType });
      const downloaded = await http.download(0, ticket.downloadUrl);
      expect(downloaded).toMatchObject({ status: 200, mimeType });
      expect(downloaded.bytes.length).toBe(ticket.sizeBytes);
      return downloaded.bytes;
    };
    const docx = await download(generated.docxFileId, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const pdf = await download(generated.pdfFileId, "application/pdf");
    const job = await owner.contractGeneratedDocument.findUniqueOrThrow({ where: { id: generated.generationId } });
    expect(job).toMatchObject({ status: "success", engineVersion: CONTRACT_BODY_DOCX4J_ENGINE_VERSION,
      docxFileId: generated.docxFileId, pdfFileId: generated.pdfFileId });
    for (const [id, bytes] of [[generated.docxFileId, docx], [generated.pdfFileId, pdf]] as const) {
      const file = await owner.fileObject.findUniqueOrThrow({ where: { id } });
      expect(file.contentSha256).toBe(hash(bytes));
    }
    expect(extractContractDocx(docx).blocks.map(block => block.text).join(" ")).toContain(addedClause);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);

    stage = "SUBMISSION";
    const submission = { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(),
      documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
      generatedDocumentId: generated.generationId, sourceSha256: source.sourceSha256, blanksReviewed: true };
    await expectStatus(send(0, draft + "/submission", "POST", { json: submission, headers }), 410);
    const submitted = await post(0, draft + "/submission", { ...submission, submissionProtocolVersion: 2 }, headers);
    expect(submitted.approvalInstanceId).toEqual(expect.any(String));
    expect(await post(0, draft + "/submission", { ...submission, submissionProtocolVersion: 2 }, headers)).toEqual(submitted);

    stage = "APPROVAL";
    const pending = async (actor: number) => (await get(actor, "/contracts/workbench?view=pending_action&page=1&pageSize=100")).rows
      .filter((row: Payload) => row.contractVersionId === versionId).length;
    expect(await pending(6)).toBe(0);
    const actors = [1, 2, 3, 4, 5];
    const approvals = await Promise.all(actors.map(async actor => (await detail(actor)).reviewApprovalContext));
    expect(approvals.every(context => /^[a-f0-9]{64}$/u.test(context?.expectedParallelApprovalEpoch))).toBe(true);
    await Promise.all(actors.map((actor, index) => post(actor, contract + "/approval", { ...approvals[index], decision: "approve" })));
    expect(await pending(6)).toBe(1);
    stage = "SEAL";
    for (const path of ["/seal-approval", "/seal/approve", "/seal/complete"]) {
      await expectStatus(send(6, contract + path, "POST", { json: {} }), 410);
    }
    const lifecycle = (await detail(6)).v2Lifecycle;
    expect(lifecycle).toMatchObject({ status: "ready", state: "pending_seal", approvalInstanceId: submitted.approvalInstanceId,
      documentContentRevision: submission.documentContentRevision, documentContentFingerprint: submission.documentContentFingerprint });
    const seal = { expectedApprovalInstanceId: submitted.approvalInstanceId, expectedSealTaskId: lifecycle.sealTaskId,
      documentContentRevision: submission.documentContentRevision, documentContentFingerprint: submission.documentContentFingerprint, confirmed: true };
    await expectStatus(send(0, contract + "/seal-confirmation", "POST", { json: seal }), 403);
    const sealed = await post(6, contract + "/seal-confirmation", seal);
    expect(await post(6, contract + "/seal-confirmation", seal)).toEqual(sealed);
    expect(await pending(6)).toBe(0);
    expect(await pending(0)).toBe(1);
    expect(await owner.contractSealTask.count({ where: { contractVersionId: versionId, approvalInstanceId: submitted.approvalInstanceId } })).toBe(1);
    expect(await owner.approvalInstance.count({ where: { businessId: versionId, flowType: "contract_seal" } })).toBe(0);

    stage = "ARCHIVE";
    const original = await PDFDocument.create();
    const font = await original.embedFont(StandardFonts.Helvetica);
    original.addPage().drawText("Synthetic original for native contract archive", { font });
    const file = await original.save();
    const uploaded = await expectStatus(send(0, "/files", "POST", { form: form(file, "application/pdf", "signed-original.pdf") }), 201);
    expect(uploaded.contentSha256).toBe(hash(file));
    const archive = { ...seal, confirmed: undefined, archiveProtocolVersion: 2, archiveSource: "generated_approval",
      idempotencyKey: randomUUID(), fileIds: [uploaded.id], confirmedMatchingSignedDocument: true };
    await expectStatus(send(7, contract + "/signed-archive", "POST", { json: archive }), 403);
    const archived = await post(0, contract + "/signed-archive", archive);
    expect(archived).toMatchObject({ status: "effective", contractVersionId: versionId, fileIds: [uploaded.id] });
    expect(await post(0, contract + "/signed-archive", archive)).toEqual(archived);
    expect((await get(0, contract + "/archive-requests/" + archive.idempotencyKey)).result).toEqual(archived);
    expect(await pending(0)).toBe(0);
    expect(hash(await download(uploaded.id, "application/pdf"))).toBe(hash(file));
    await expectStatus(send(7, "/files/" + uploaded.id + "/download-ticket", "POST", {
      json: { confirmationPassword: passwords[7], downloadReason: "隔离测试访问限制" }
    }), 403);
    expect((await detail()).contractVersionId).toBe(versionId);
    for (const [action, actor] of [["contract.seal_task.create", null], ["contract.seal.complete", seed.users[6].id], ["contract.archive.complete", seed.users[0].id]] as const) {
      expect(await owner.auditLog.count({ where: { action, businessId: versionId, ...(actor ? { actorUserId: actor } : {}) } })).toBe(1);
    }
    process.stdout.write("SEAL_329_NATIVE_PROOF " + JSON.stringify({ candidate: packet.candidate, docxSha256: hash(docx), pdfSha256: hash(pdf),
      originalSha256: hash(file), approvals: actors.length, legacyRouteResponses: [410,410,410,410], sealTasks: 1, storage: "local" }) + "\n");
  } catch (error) {
    const detail = error as { code?: unknown; status?: unknown; expected?: unknown; message?: unknown };
    const code = typeof detail?.code === "string" && /^[A-Z0-9_]{1,100}$/u.test(detail.code) ? detail.code : undefined;
    const marker = typeof detail?.message === "string" && /^(?:NATIVE_329|TASK12)_[A-Z0-9_]{1,100}$/u.test(detail.message) ? detail.message : undefined;
    const status = typeof detail?.status === "number" ? detail.status : undefined;
    const expected = typeof detail?.expected === "number" ? detail.expected : undefined;
    const diagnostic = JSON.stringify({ stage, code, marker, status, expected, databaseFailure });
    process.stdout.write("SEAL_329_NATIVE_FAILURE " + diagnostic + "\n");
    throw new Error(diagnostic);
  } finally {
    await Promise.allSettled([app?.close(), owner.$disconnect(), readOnlyApplication.$disconnect()]);
  }
}, 420_000);
