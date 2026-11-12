import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { type INestApplication } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PrismaService } from "./prisma.service";
import { Task12FirstQ2ApplicationModule } from "./task12-first-q2-application.module";
import { buildTask12GeneratedApprovalFixture, hashTask12GeneratedAdmissionPassword } from "./task12-generated-approval-admission";
import { publishTask12GeneratedMaterialTemplate } from "./task12-generated-material-template";
import { runTask12GeneratedDocument } from "./task12-generated-document-seam";
import { ContractTemplateModule } from "../contract-template/contract-template.module";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { extractContractDocx } from "../contract-document/contract-docx-extractor";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { AuditService } from "../audit/audit.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { OperationalWriteFreezeGuard } from "../operational-write-freeze/operational-write-freeze.guard";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import { AccountRateLimitGuard } from "../auth/guards/account-rate-limit.guard";
import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { JwtTokenService } from "../auth/jwt-token.service";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { apiJsonReplacer } from "../api-json-replacer";

// Explicit native-gate payloads are asserted at every public boundary below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;
type Packet = { candidateSha: string; directory: string; runtime: string; runtimeSha: string;
  scope: { database: string; appName: string; appOid: string }; ownerUrl: string;
  urls: Record<"application" | "template" | "worker" | "queue", string> };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const root = resolve(__dirname, "../../../..");
const password = randomBytes(32).toString("hex");
const roles = ["material_director", "contract_director", "project_manager", "finance_director", "general_manager"];
const packetFile = process.env.TASK12_NATIVE_LIFECYCLE_INPUT;
if (!packetFile) throw new Error("TASK12_NATIVE_LIFECYCLE_REQUIRES_EXPLICIT_LOCAL_GATE");
const file = lstatSync(packetFile);
if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.() || (file.mode & 0o777) !== 0o600 ||
  realpathSync(packetFile) !== packetFile || !packetFile.startsWith("/private/tmp/")) throw new Error("TASK12_NATIVE_LIFECYCLE_INPUT");
const packet = JSON.parse(readFileSync(packetFile, "utf8")) as Packet;
// The qualified runtime is a CommonJS control-plane module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createNativeLifecycleDiagnostics, withNativeLifecycleCleanup } = require("../../prisma/task12-native-lifecycle-fixture.cjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyCurrent259GeneratedDocumentRuntime, withCurrent259GeneratedDocumentRuntime } = require("../../prisma/task12-current259-generated-document-runtime.cjs");

it("runs native V2 submission, withdrawal, rejection, five approvals, seal, rollback and two-file private archive on the staged limited roles", async () => {
  expect(packet.scope.database).toBe("jiangkong_contract_draft_aggregate_test");
  expect(new URL(packet.urls.application).username).toBe(packet.scope.appName);
  expect(process.env.DATABASE_URL).toBe(packet.urls.application);
  for (const url of Object.values(packet.urls)) {
    const target = new URL(url);
    expect(target.hostname).toBe("127.0.0.1");
    expect(target.pathname).toBe("/" + packet.scope.database);
    expect(target.username).not.toBe("jiangkong");
  }
  const diagnostic = createNativeLifecycleDiagnostics();
  try {
  const native = verifyCurrent259GeneratedDocumentRuntime(packet.runtime, packet.runtimeSha);
  await withCurrent259GeneratedDocumentRuntime(native, packet.directory, async (runtime: {
    check(): void; readPdfDrawnText(bytes: Buffer, signal: AbortSignal): Promise<string[]>;
  }) => {
    const owner = new PrismaClient({ datasources: { db: { url: packet.ownerUrl } } });
    const application = new PrismaService({ datasources: { db: { url: packet.urls.application } } });
    const templateClient = new PrismaService({ datasources: { db: { url: packet.urls.template } } });
    const workerClient = new PrismaService({ datasources: { db: { url: packet.urls.worker } } });
    const queueClient = new PrismaService({ datasources: { db: { url: packet.urls.queue } } });
    const clients = [application, templateClient, workerClient, queueClient];
    let app: INestApplication | undefined;
    let processor: ContractDocumentProcessor | undefined;
    for (const [role, client] of [['owner',owner],['application',application],['template',templateClient],['worker',workerClient],['queue',queueClient]] as const) {
      client.$use(async (params,next) => {try {return await next(params);} catch(error) {diagnostic.database(role,error);throw error;}});
    }
    await withNativeLifecycleCleanup(async () => {
      diagnostic.enter('IDENTITY');
      for (const [index, client] of clients.entries()) {
        const [identity] = await client.$queryRaw<Array<{ name: string; session: string; oid: string; safe: boolean }>>(Prisma.sql`
          SELECT current_user::text AS name, session_user::text AS session, r.oid::text AS oid,
            NOT (r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication) AS safe
          FROM pg_roles r WHERE r.rolname=current_user`);
        expect(identity).toMatchObject({ name: new URL(Object.values(packet.urls)[index]).username, safe: true });
        expect(identity.session).toBe(identity.name);
        if (index === 0) expect(identity.oid).toBe(packet.scope.appOid);
      }
      diagnostic.enter('SEED');
      const seed = buildTask12GeneratedApprovalFixture(randomUUID());
      const passwordHash = await hashTask12GeneratedAdmissionPassword(password);
      for (const user of seed.users) await owner.user.create({ data: { ...user, passwordHash } });
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
      const storage = new PrivateFileStorage();
      const roleFiles = (client: PrismaService) => new FileService(client, new AuditService(client), storage);
      const layouts = new LayoutTemplateService(templateClient, new AuditService(templateClient), roleFiles(templateClient));
      const queue = new ContractDocumentService(queueClient, new AuditService(queueClient), roleFiles(queueClient));
      processor = new ContractDocumentProcessor(workerClient, roleFiles(workerClient), new AuditService(workerClient));
      diagnostic.enter('NEST_INIT');
      const module = await Test.createTestingModule({ imports: [Task12FirstQ2ApplicationModule, ContractTemplateModule] })
        .overrideProvider(PrismaService).useValue(application)
        .overrideProvider(LayoutTemplateService).useValue(layouts).compile();
      // Route only preview queue writes to the original restricted queue service.
      // All other ContractDocumentService methods use the ordinary application.
      const documents = module.get(ContractDocumentService);
      documents.queueDraftPreview = queue.queueDraftPreview.bind(queue);
      app = module.createNestApplication({ logger: false });
      app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
      app.useGlobalPipes(createApiValidationPipe());
      app.useGlobalGuards(new JwtAuthGuard(new Reflector(), module.get(JwtTokenService), application),
        new RetiredWriteEntryGuard(), new OperationalWriteFreezeGuard(new OperationalWriteFreezeService()),
        new AccountRateLimitGuard(new AuthRateLimitService(application)), new PermissionGuard(new Reflector(), application),
        new ContractCutoverGuard(new Reflector()));
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const send = async (actor: number, path: string, method = "GET", json?: object, form?: FormData, extra: Record<string,string> = {}) => {
        runtime.check();
        const response = await fetch(base + path, { method, headers: { connection: "close", "x-contract-numeric-protocol": "2",
          ...(tokens[actor] ? { authorization: "Bearer " + tokens[actor] } : {}), ...(json ? { "content-type": "application/json" } : {}), ...extra },
          body: form ?? (json ? JSON.stringify(json) : undefined), signal: AbortSignal.timeout(15_000) });
        const body = await response.json() as Payload;
        runtime.check();return { status: response.status, body };
      };
      const accepted = async (actor: number, path: string, method = "GET", json?: object, form?: FormData,
        expected = method === "POST" ? 201 : 200, extra: Record<string,string> = {}) => {
        const result = await send(actor, path, method, json, form, extra);
        expect({ path, status: result.status, error: result.status === expected ? null : result.body }).toEqual({ path, status: expected, error: null });
        return result.body;
      };
      diagnostic.enter('LOGIN');
      const tokens: string[] = [];
      for (const [index, user] of seed.users.entries()) {
        const login = await accepted(index, "/auth/login", "POST", { phone: user.phone, password });
        tokens[index] = login.tokens.accessToken;
      }
      diagnostic.enter('SIGNATURES');
      const signature = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
      for (const actor of [1,2,3,4,5]) {
        const form = new FormData();form.append("file", new Blob([signature], { type: "image/png" }), "signature.png");
        await accepted(actor, "/me/signature/canvas", "POST", undefined, form);
      }
      const stepWorker = async (milliseconds: number) => {
        await processor!.processNext();
        await new Promise(resolve => setTimeout(resolve, Math.min(milliseconds, 100)));
      };
      diagnostic.enter('TEMPLATE');
      const published = await publishTask12GeneratedMaterialTemplate(
        readFileSync(resolve(root, "services/api/assets/templates/material-purchase-real-v1.docx")), seed.users[2].id, {
          now: () => Date.now(), wait: stepWorker,
          send: request => send(2, request.path, request.method, "json" in request ? request.json : undefined, "form" in request ? request.form : undefined)
        });
      diagnostic.enter('DRAFT');
      const created = await accepted(0, "/contracts", "POST", { projectId: seed.project.id, numericProtocolVersion: 2,
        contractTypeKey: "material_purchase", relationship: "inside", amountLimitType: "capped" });
      const versionId = created.version.id as string, contractId = created.contract.id as string;
      const draftPath = "/contract-drafts/" + versionId, contractPath = "/contracts/" + versionId;
      const lease = await accepted(0, draftPath + "/edit-lease", "POST");
      const headers = { "x-contract-draft-lease": lease.token as string };
      const workbench = () => accepted(0, draftPath + "/workbench");
      let bodyPlan: object | undefined;
      const save = async () => {
        const current = await workbench();
        return accepted(0, draftPath, "PUT", {
          idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision,
          changedSections: ["draft", "parties"], draft: { numericProtocolVersion: 2, companyEntityId: company.id,
            draftData: { ...current.draft, contractName: "原生V2材料合同", contractBasics: {
              businessType: "material_purchase", relationship: "inside", amountBasis: "tax_inclusive", invoiceStatus: "pending" },
            ...(bodyPlan ? { documentBody: bodyPlan } : {}) }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum",
            layoutTemplateVersionId: published.layoutId, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
          parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: company.name } },
            { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: partyVersion.id, snapshot: {} }],
          bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision,
            numericProtocolVersion: 2, rows: [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
        }, undefined, 200, headers);
      };
      await save();
      const originalBody = await accepted(0, draftPath + "/document-body");
      const editable = originalBody.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(editable).toBeDefined();
      let currentClause = "双方补充约定第一版。";
      bodyPlan = { protocolVersion: 1, layoutTemplateVersionId: published.layoutId, sourceSha256: originalBody.sourceSha256,
        edits: [{ positionId: editable.id, text: editable.text + currentClause }] };
      await save();
      const download = async (actor: number, id: string) => {
        diagnostic.enter('DOWNLOAD');
        const ticket = await accepted(actor, "/files/" + id + "/download-ticket", "POST",
          { confirmationPassword: password, downloadReason: "本轮原生合同验收" });
        expect(ticket.downloadUrl.startsWith("/files/" + id + "/download?")).toBe(true);
        const response = await fetch(base + ticket.downloadUrl, { signal: AbortSignal.timeout(15_000), headers: { connection: "close" } });
        expect(response.status).toBe(200);
        const bytes = Buffer.from(await response.arrayBuffer());
        const fact = await owner.fileObject.findUniqueOrThrow({ where: { id } });
        expect(sha(bytes)).toBe(fact.contentSha256);expect(bytes.length).toBe(fact.sizeBytes);
        return { bytes, url: ticket.downloadUrl as string };
      };
      let parsedPdf = false;
      const generate = async () => {
        diagnostic.enter('GENERATE');
        const current = await workbench();
        const version = current.version;
        const generated = await runTask12GeneratedDocument({ template: published, versionId,
          sourceRevision: version.draftRevision, documentContentRevision: version.documentContentRevision,
          documentContentFingerprint: version.documentContentFingerprint, lease: {
            token: lease.token, leaseRevision: lease.leaseRevision, expiresAt: current.lease.expiresAt } }, {
          now: () => Date.now(), wait: stepWorker,
          send: request => send(0, request.path, request.method, request.json, undefined, request.headers)
        });
        const fact = await owner.contractGeneratedDocument.findUniqueOrThrow({ where: { id: generated.generationId } });
        expect(fact.status).toBe("success");expect(fact.engineVersion).not.toContain("synthetic");
        const word = await download(0, fact.docxFileId!);const pdf = await download(0, fact.pdfFileId!);
        expect(extractContractDocx(word.bytes).blocks.map(block => block.text).join(" ")).toContain(currentClause);
        expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThan(0);
        if (!parsedPdf) {
          expect((await runtime.readPdfDrawnText(pdf.bytes, AbortSignal.timeout(30_000))).join(" ")).toContain("原生V2材料合同");
          parsedPdf = true;
        }
        return { fact, input: { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(), submissionProtocolVersion: 2,
          documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
          generatedDocumentId: fact.id, sourceSha256: originalBody.sourceSha256, blanksReviewed: true } };
      };
      const detail = (actor = 0) => accepted(actor, "/contracts/" + contractId + "?versionId=" + versionId);
      const reviewContext = async (actor: number) => (await detail(actor)).reviewApprovalContext;
      const review = async (actor: number, context: object, decision = "approve") => send(actor, contractPath + "/approval", "POST",
        { ...context, decision, ...(decision === "reject" ? { comment: "原生验收退回重新核对" } : {}) });
      const first = await generate();
      diagnostic.enter('SUBMIT');
      expect((await send(0, draftPath + "/submission", "POST", { ...first.input, blanksReviewed: false }, undefined, headers)).status).toBe(409);
      expect((await send(7, draftPath + "/submission", "POST", first.input, undefined, headers)).status).toBe(403);
      expect(await owner.approvalInstance.count({ where: { businessId: versionId } })).toBe(0);
      const firstRound = await accepted(0, draftPath + "/submission", "POST", first.input, undefined, 201, headers);
      diagnostic.enter('APPROVE');
      expect((await review(2, await reviewContext(2))).status).toBe(201);
      const oldContext = await reviewContext(1);
      const withdrawal = (await detail()).withdrawApprovalContext;
      expect(withdrawal).toBeTruthy();
      diagnostic.enter('WITHDRAW');
      await accepted(0, contractPath + "/approval-withdrawal", "POST", withdrawal);
      expect((await review(1, oldContext)).status).toBe(409);
      const oldActions = await owner.approvalActionLog.findMany({ where: { approvalInstanceId: firstRound.approvalInstanceId, action: "approve" } });
      expect(oldActions).toHaveLength(1);expect(oldActions[0].signatureFileIdSnapshot).toBeNull();
      expect(await owner.handwrittenSignatureVersion.count({ where: { userId: seed.users[2].id } })).toBe(1);
      currentClause = "撤回修改后的第二版，所有职责重新签署。";
      bodyPlan = { ...bodyPlan, edits: [{ positionId: editable.id, text: editable.text + currentClause }] };
      await save();
      const second = await generate();
      expect(second.fact.id).not.toBe(first.fact.id);
      expect(second.input.documentContentFingerprint).not.toBe(first.input.documentContentFingerprint);
      diagnostic.enter('REJECT');
      const rejected = await accepted(0, draftPath + "/submission", "POST", second.input, undefined, 201, headers);
      expect((await review(1, await reviewContext(1), "reject")).status).toBe(201);
      expect((await owner.contractVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("draft");
      expect(await owner.contractSealTask.count({ where: { contractVersionId: versionId } })).toBe(0);
      const finalGenerated = await generate();
      finalGenerated.input.idempotencyKey = randomUUID();
      diagnostic.enter('SUBMIT');
      const submitted = await accepted(0, draftPath + "/submission", "POST", finalGenerated.input, undefined, 201, headers);
      expect(submitted.approvalInstanceId).not.toBe(rejected.approvalInstanceId);
      expect(await accepted(0, draftPath + "/submission", "POST", finalGenerated.input, undefined, 201, headers)).toEqual(submitted);
      diagnostic.enter('APPROVE');
      const contexts = await Promise.all([1,2,3,4,5].map(actor => reviewContext(actor)));
      expect(new Set(contexts.map(context => context.expectedParallelApprovalEpoch)).size).toBe(1);
      const approved = await Promise.all(contexts.map((context, index) => review(index + 1, context)));
      expect(approved.map(result => result.status)).toEqual([201,201,201,201,201]);
      const actions = await owner.approvalActionLog.findMany({ where: { approvalInstanceId: submitted.approvalInstanceId } });
      expect(actions.map(action => action.approvedRoleKey).sort()).toEqual([...roles].sort());
      expect(actions.every(action => action.signatureVersionIdSnapshot && action.signatureFileIdSnapshot)).toBe(true);
      expect((await owner.contractVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("approved_pending_seal");
      const task = await owner.contractSealTask.findUniqueOrThrow({ where: { approvalInstanceId: submitted.approvalInstanceId } });
      diagnostic.enter('SEAL');
      const seal = { expectedApprovalInstanceId: submitted.approvalInstanceId, expectedSealTaskId: task.id,
        documentContentRevision: finalGenerated.input.documentContentRevision,
        documentContentFingerprint: finalGenerated.input.documentContentFingerprint, confirmed: true };
      expect((await send(0, contractPath + "/seal-confirmation", "POST", seal)).status).toBe(403);
      await accepted(6, contractPath + "/seal-confirmation", "POST", seal);
      await accepted(6, contractPath + "/seal-confirmation", "POST", seal);
      expect(await owner.auditLog.count({ where: { businessId: versionId, action: "contract.seal.complete" } })).toBe(1);
      expect(await owner.auditLog.count({ where: { businessId: versionId, action: "contract.archive_task.create" } })).toBe(1);
      diagnostic.enter('UPLOAD');
      const originals: Array<{ id: string; bytes: Buffer }> = [];
      for (const marker of ["Both parties signed original one", "Both parties signed original two"]) {
        const pdf = await PDFDocument.create();const font = await pdf.embedFont(StandardFonts.Helvetica);
        pdf.addPage().drawText(marker, { x: 40, y: 700, font, size: 14 });
        const bytes = Buffer.from(await pdf.save());
        const form = new FormData();form.append("file", new Blob([bytes], { type: "application/pdf" }), marker + ".pdf");
        const upload = await accepted(0, "/files", "POST", undefined, form);
        originals.push({ id: upload.id, bytes });
      }
      const archive = { ...seal, confirmed: undefined, archiveProtocolVersion: 2, archiveSource: "generated_approval",
        idempotencyKey: randomUUID(), fileIds: originals.map(original => original.id), confirmedMatchingSignedDocument: true };
      expect((await send(7, contractPath + "/signed-archive", "POST", archive)).status).toBe(403);
      // A local-only trigger fails the final audit after the actual archive writes,
      // proving that the real PostgreSQL transaction rolls back every new fact.
      await withNativeLifecycleCleanup(async () => {
        diagnostic.enter('AUDIT_FAULT_INSTALL');
        await owner.$executeRawUnsafe(`CREATE FUNCTION public.jg_task12_native_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."businessId"='${versionId}' AND NEW.action='contract.archive.complete' THEN RAISE EXCEPTION 'TASK12_NATIVE_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
        await owner.$executeRawUnsafe('CREATE TRIGGER jg_task12_native_audit_failure BEFORE INSERT ON public."AuditLog" FOR EACH ROW EXECUTE FUNCTION public.jg_task12_native_audit_failure()');
        diagnostic.enter('AUDIT_FAULT_ARCHIVE');
        expect((await send(0, contractPath + "/signed-archive", "POST", archive)).status).toBe(500);
        diagnostic.enter('AUDIT_FAULT_ROLLBACK_VERIFY');
        expect(await owner.contractArchiveFile.count({ where: { contractVersionId: versionId } })).toBe(0);
        expect(await owner.contractArchiveEvidenceFile.count({ where: { contractVersionId: versionId } })).toBe(0);
        expect((await owner.contractVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("seal_approved_pending_archive");
      }, [
        ['AUDIT_TRIGGER_DROP', () => owner.$executeRawUnsafe('DROP TRIGGER jg_task12_native_audit_failure ON public."AuditLog"')],
        ['AUDIT_FUNCTION_DROP', () => owner.$executeRawUnsafe('DROP FUNCTION public.jg_task12_native_audit_failure()')]
      ], diagnostic);
      diagnostic.enter('ARCHIVE');
      const archived = await accepted(0, contractPath + "/signed-archive", "POST", archive);
      expect(archived).toMatchObject({ status: "effective", contractVersionId: versionId, fileIds: archive.fileIds });
      expect(await accepted(0, contractPath + "/signed-archive", "POST", archive)).toEqual(archived);
      expect((await accepted(0, contractPath + "/archive-requests/" + archive.idempotencyKey)).result).toEqual(archived);
      const evidence = await owner.contractArchiveEvidenceFile.findMany({ where: { contractVersionId: versionId }, orderBy: { displayOrder: "asc" } });
      expect(evidence.map(row => row.fileId)).toEqual(archive.fileIds);
      expect(evidence.map(row => row.contentSha256)).toEqual(originals.map(original => sha(original.bytes)));
      const storedArchive = await owner.contractArchiveFile.findUniqueOrThrow({ where: { id: archived.archiveId } });
      expect(storedArchive.authoritySha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(storedArchive.fileManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect((await owner.contractVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("effective");
      expect(await owner.auditLog.count({ where: { businessId: versionId, action: "contract.archive.complete" } })).toBe(1);
      for (const original of originals) {
        const downloaded = await download(0, original.id);expect(downloaded.bytes).toEqual(original.bytes);
        expect((await send(7, "/files/" + original.id + "/download-ticket", "POST",
          { confirmationPassword: password, downloadReason: "越权负控" })).status).toBe(403);
        const expired = new URL(base + downloaded.url);expired.searchParams.set("expiresAt", "2000-01-01T00:00:00.000Z");
        expect((await fetch(expired, { signal: AbortSignal.timeout(15_000) })).status).not.toBe(200);
      }
      diagnostic.enter('VERIFY');
      expect(await owner.contractArchiveFile.count({ where: { contractVersionId: versionId } })).toBe(1);
      expect((await owner.approvalInstance.findUniqueOrThrow({ where: { id: firstRound.approvalInstanceId } })).status).toBe("withdrawn");
      expect((await owner.approvalInstance.findUniqueOrThrow({ where: { id: rejected.approvalInstanceId } })).status).toBe("rejected");
      expect((await detail()).contractVersionId).toBe(versionId);
    }, [
      ['PROCESSOR_CLOSE', () => processor?.onApplicationShutdown()],
      ['APP_CLOSE', () => app?.close()],
      ...[...clients,owner].map((client,index) => [
        ['APPLICATION_DISCONNECT','TEMPLATE_DISCONNECT','WORKER_DISCONNECT','QUEUE_DISCONNECT','OWNER_DISCONNECT'][index],
        () => client.$disconnect()
      ])
    ], diagnostic);
  });
  } catch(error) {
    diagnostic.primary(error);
    const report=diagnostic.report();
    process.stderr.write('TASK12_NATIVE_DIAGNOSTIC '+JSON.stringify(report)+'\n');
    throw new Error('TASK12_NATIVE_LIFECYCLE_'+report.stage+'_'+report.code);
  }
}, 600_000);
