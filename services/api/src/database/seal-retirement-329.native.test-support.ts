import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { Prisma, PrismaClient } from "@prisma/client";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AppModule } from "../app.module";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { AuthService } from "../auth/auth.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { configureApiSecurity } from "../api-security";
import { PrismaService } from "./prisma.service";
import { armTask12AuthError, takeTask12AuthError, Task12AuthErrorFilter, Task12AuthStageInterceptor } from "./task12-auth-error-diagnostic";
import { projectTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { CONTRACT_BODY_DOCX4J_ENGINE_VERSION } from "../contract-document/contract-document.service";
import { ContractDutyNotificationService } from "../contract/contract-duty-notification.service";
import { issueTask12NativeReviewReadiness, TASK12_NATIVE_REVIEW_CHECKSUM, TASK12_NATIVE_REVIEW_MIGRATION,
  withTask12NativeReviewReadiness } from "../file/task12-native-review-readiness";
import { createApiValidationPipe } from "../validation/api-validation";
import { extractContractDocx } from "../contract-document/contract-docx-extractor";
import { createTask12Con18DefaultHttp } from "./task12-con18-default-http";
import { buildTask12GeneratedApprovalFixture, hashTask12GeneratedAdmissionPassword } from "./task12-generated-approval-admission";
import { runTask12GeneratedDocument } from "./task12-generated-document-seam";
import { publishTask12GeneratedEquipmentTemplate } from "./task12-generated-material-template";
import type { Task12LocalLifecycleRequest } from "./task12-local-lifecycle-case";

// The runner owns the isolated cluster, effective database grants and all storage.
type Packet = { ownerUrl: string; psql: string; applicationOid: string; database: string; candidate: string };
type ArchiveIdentity = { database: string; databaseOid: string; systemIdentifier: string; serverPort: number;
  ordinaryName: string; ordinaryOid: string };
type ArchiveCheckpoint = { projectId: string; handlerId: string; contractId: string; versionId: string; approvalInstanceId: string;
  requestKey: string; documentContentRevision: number; documentContentFingerprint: string;
  originals: Array<{ id: string; sha256: string; sizeBytes: number }> };
const {
  renderNormal274ConstructionFixture, renderNormal274ArchiveBinding
}: {
  renderNormal274ConstructionFixture(identity: ArchiveIdentity, ids: { party: string; version: string; assignment: string }, project: string, applicant: string): string;
  renderNormal274ArchiveBinding(lease: { identity: ArchiveIdentity; serverPort: number; roles: { 3: { name: string; oid: string } } },
    checkpoint: ArchiveCheckpoint, voucherInstalled: boolean): string;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("../../prisma/task12-normal274-archive-binding.cjs");
const { renderTask12NativeApprovalLock }: {
  renderTask12NativeApprovalLock(identity: ArchiveIdentity, fixture: ReturnType<typeof buildTask12GeneratedApprovalFixture>): string;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("../../prisma/task12-native-approval-lock.cjs");
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
  assert.ok(path && /^\/private\/tmp\/jg425-seal-329-[a-zA-Z0-9]+\/input[.]json$/u.test(path), "NATIVE_329_PACKET");
  const entry = lstatSync(path);
  assert.ok(entry.isFile() && realpathSync(path) === path && entry.uid === process.getuid?.() && (entry.mode & 0o777) === 0o600,
    "NATIVE_329_PACKET");
  const packet = JSON.parse(readFileSync(path, "utf8")) as Packet;
  const url = new URL(packet.ownerUrl);
  assert.ok(/^jg_task01_[a-f0-9]{32}$/u.test(packet.database) && url.protocol === "postgresql:" && url.hostname === "127.0.0.1" &&
    url.pathname === "/" + packet.database && url.username === "jg_task01_owner" && url.port &&
    url.searchParams.get("sslmode") === "require" && url.searchParams.get("sslaccept") === "strict" &&
    url.searchParams.get("sslcert") === resolve(path, "../ca.crt") && realpathSync(packet.psql) === packet.psql,
    "NATIVE_329_PACKET");
  return packet;
}

function executeOwnerFixtureSql(packet: Packet, sql: string) {
  const url = new URL(packet.ownerUrl);
  const result = spawnSync(packet.psql, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", packet.database, "-f", "-"], {
    input: sql, encoding: "utf8", maxBuffer: 256 * 1024, timeout: 45_000,
    env: { PATH: "/usr/bin:/bin", HOME: resolve(process.env.SEAL_329_NATIVE_PACKET!, ".."), LANG: "C", PGHOST: url.hostname,
      PGPORT: url.port, PGUSER: url.username, PGPASSWORD: url.password, PGSSLMODE: "verify-full",
      PGSSLROOTCERT: url.searchParams.get("sslcert")!, PGCONNECT_TIMEOUT: "5" }
  });
  if (result.status !== 0) {
    const code = /ERROR:\s+([A-Z0-9]{5}):/u.exec(result.stderr ?? "")?.[1];
    throw Object.assign(new Error("NATIVE_329_OWNER_ARCHIVE_FIXTURE"), { code });
  }
}

it("generates a V2 document on native docx4j, approves it, confirms the automatic seal and downloads its private archive", async () => {
  const packet = privatePacket();
  const owner = new PrismaClient({ datasources: { db: { url: packet.ownerUrl } } });
  const readOnlyApplication = new PrismaClient();
  const passwords = Array.from({length: 8}, () => randomBytes(32).toString("hex"));
  let app: INestApplication | undefined;
  let stage = "IDENTITY";
  let databaseFailure: { model?: string; action: string; kind: string; code?: string; sqlState?: string; relation?: string; routine?: string } | undefined;
  let generatedFacts: { engine: string; docxSha256: string; pdfSha256: string } | undefined;
  let loginFacts: { rateLimitRows?: number; lastLoginRecorded?: boolean; auditRows?: number; refreshRows?: number } | undefined;
  let authFailure: ReturnType<typeof takeTask12AuthError>;
  let loggedAuthFailure: ReturnType<typeof projectTask16RegistrationError> | undefined;
  let loginBoundary: "RATE_LIMIT" | "AUTH_SERVICE" | undefined;
  let loginError: ReturnType<typeof projectTask16RegistrationError> | undefined;
  try {
    const [identity] = await readOnlyApplication.$queryRaw<Array<{ safe: boolean; oid: string }>>`
      SELECT current_database()  = ${packet.database} AND current_user = session_user
        AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication)
        AND inet_server_addr() = '127.0.0.1'::inet AS safe, r.oid::text AS oid FROM pg_roles r WHERE r.rolname = current_user`;
    expect(identity).toEqual({ safe: true, oid: packet.applicationOid });
    expect(await owner.project.count()).toBe(0);
    expect(await owner.contract.count()).toBe(0);
    stage = "SEED";
    const seed = buildTask12GeneratedApprovalFixture(randomUUID(), "inside:equipment_rental");
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
    stage = "EQUIPMENT_CONSTRUCTION_FIXTURE";
    const ownerEndpoint = new URL(packet.ownerUrl);
    const applicationEndpoint = new URL(process.env.DATABASE_URL!);
    expect(applicationEndpoint.hostname).toBe(ownerEndpoint.hostname);
    expect(applicationEndpoint.port).toBe(ownerEndpoint.port);
    expect(applicationEndpoint.pathname).toBe(ownerEndpoint.pathname);
    expect(applicationEndpoint.searchParams.get("sslcert")).toBe(ownerEndpoint.searchParams.get("sslcert"));
    const [coordinates] = await owner.$queryRaw<Array<{ databaseOid: string; systemIdentifier: string; serverPort: number }>>`
      SELECT d.oid::text AS "databaseOid", (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
        inet_server_port() AS "serverPort" FROM pg_database d WHERE datname=current_database() AND datdba=10`;
    const archiveIdentity = { ...coordinates, database: packet.database, ordinaryName: applicationEndpoint.username, ordinaryOid: packet.applicationOid };
    const readinessIdentity = { ...archiveIdentity, project: seed.project.id, applicant: seed.handler.id };
    const [ticketOwnerProof] = await owner.$queryRaw<Array<typeof archiveIdentity & { ownerOid: string; ownerSession: boolean; ssl: boolean; completed: boolean }>>`
      SELECT current_database() AS "database", d.oid::text AS "databaseOid", d.datdba::text AS "ownerOid",
        current_user=session_user AND current_user::regrole::oid=d.datdba AS "ownerSession",
        r.oid::text AS "ordinaryOid", r.rolname::text AS "ordinaryName", inet_server_port() AS "serverPort",
        (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
        (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS "ssl",
        (SELECT count(*)=1 AND count(*) FILTER (WHERE finished_at IS NOT NULL AND checksum=${TASK12_NATIVE_REVIEW_CHECKSUM})=1
         FROM public."_prisma_migrations" WHERE migration_name=${TASK12_NATIVE_REVIEW_MIGRATION} AND rolled_back_at IS NULL) AS "completed"
      FROM pg_database d JOIN pg_roles r ON r.oid=${packet.applicationOid}::oid
      WHERE d.datname=current_database()`;
    const [restricted] = await owner.$queryRaw<Array<{ ledgerDenied: boolean; assignmentWritesDenied: boolean }>>`
      SELECT NOT has_any_column_privilege(${packet.applicationOid}::oid,'public."_prisma_migrations"'::regclass,'SELECT') AS "ledgerDenied",
        NOT EXISTS(SELECT FROM (VALUES ('public."ProjectMember"'::regclass), ('public."UserPosition"'::regclass),
          ('public."Position"'::regclass), ('public."HandwrittenSignatureVersion"'::regclass)) targets(relation)
          WHERE has_any_column_privilege(${packet.applicationOid}::oid,targets.relation,'UPDATE')) AS "assignmentWritesDenied"`;
    expect(restricted).toEqual({ ledgerDenied: true, assignmentWritesDenied: true });
    const construction = { party: randomUUID(), version: randomUUID(), assignment: randomUUID() };
    executeOwnerFixtureSql(packet, renderNormal274ConstructionFixture(archiveIdentity, construction, seed.project.id, seed.handler.id));
    executeOwnerFixtureSql(packet, renderTask12NativeApprovalLock(archiveIdentity, seed));

    const qualifiedFiles = new Set<string>();
    const qualifiedWrites = new Set<string>();
    const qualifiedReads = new Set<string>();
    stage = "HTTP_BOOT";
    app = await NestFactory.create(AppModule, {
      logger: {
        log() {}, warn() {},
        error(error: unknown) {
          if (stage === "LOGIN" && error instanceof Error) loggedAuthFailure = projectTask16RegistrationError(error);
        }
      },
      abortOnError: false
    });
    configureApiSecurity(app);
    const server = app.getHttpServer() as Server;
    app.use((request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
      const url = request.url ?? "";
      const pathname = url.split("?", 1)[0];
      const filePath = request.method === "GET" ? /^\/files\/([a-f0-9-]{36})\/download$/u :
        request.method === "POST" ? /^\/files\/([a-f0-9-]{36})\/download-ticket$/u : undefined;
      const file = filePath?.exec(pathname)?.[1];
      const allowContract = request.method === "POST" ? qualifiedWrites.has(pathname) : request.method === "GET" && qualifiedReads.has(url);
      if (!allowContract && !(file && qualifiedFiles.has(file))) return next();
      const token = issueTask12NativeReviewReadiness(readinessIdentity, ticketOwnerProof, () => {
        assert.ok(server.listening && request.socket.remoteAddress === "127.0.0.1", "NATIVE_329_DOWNLOAD_SCOPE");
      });
      // Only the armed fixture's public routes inherit the verified native
      // scope. The normal role guards and controllers still own the requests.
      void withTask12NativeReviewReadiness(token, () => new Promise<void>(resolve => {
        response.once("finish", resolve);
        response.once("close", resolve);
        next();
      })).catch(next);
    });
    const authErrors = new Task12AuthErrorFilter(app.get(HttpAdapterHost));
    app.useGlobalFilters(authErrors);
    app.useGlobalInterceptors(new Task12AuthStageInterceptor(authErrors));
    const accountRateLimit = app.get(AuthRateLimitService);
    const takeRateLimit = accountRateLimit.take.bind(accountRateLimit);
    accountRateLimit.take = async (...args) => {
      if (stage === "LOGIN") loginBoundary = "RATE_LIMIT";
      try { return await takeRateLimit(...args); }
      catch (error) {
        if (stage === "LOGIN") loginError = projectTask16RegistrationError(error);
        throw error;
      }
    };
    const auth = app.get(AuthService);
    const login = auth.login.bind(auth);
    auth.login = async (...args) => {
      if (stage === "LOGIN") loginBoundary = "AUTH_SERVICE";
      try { return await login(...args); }
      catch (error) {
        if (stage === "LOGIN") loginError = projectTask16RegistrationError(error);
        throw error;
      }
    };
    app.get(PrismaService).$use(async (params, next) => {
      try {
        return await next(params);
      } catch (error) {
        const projected = projectTask16RegistrationError(error);
        const unknown = projected.serverErrorKind === "UNKNOWN_REQUEST_ERROR";
        if (projected.serverPrismaCode || unknown) {
          const metadata = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.message : undefined;
          const message = typeof metadata === "string" ? metadata : unknown && error instanceof Error ? error.message : "";
          const unknownSqlState = /(?:code:\s*"|SQLSTATE[ :]+)([0-9A-Z]{5})\b/u.exec(message)?.[1];
          const sqlState = projected.serverSqlState ?? (
            unknownSqlState && ["42501", "23502", "23503", "23505", "23514", "42P01", "42703", "25006", "25P02"].includes(unknownSqlState)
              ? unknownSqlState : undefined
          );
          const relation = /permission denied for (?:table|relation) "?([a-zA-Z0-9_]+)"?/u.exec(message)?.[1];
          const routine = /permission denied for function (jg_[a-z0-9_]{1,95})\b/u.exec(message)?.[1];
          databaseFailure = { model: params.model, action: params.action, kind: projected.serverErrorKind, code: projected.serverPrismaCode,
            sqlState, relation: relation && (Object.hasOwn(Prisma.ModelName, relation) || relation === "_prisma_migrations") ? relation : undefined, routine };
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
    for (const [actor, user] of seed.users.entries()) {
      const server = app.getHttpServer() as object;
      const ticket = armTask12AuthError(authErrors, server, user.phone);
      loggedAuthFailure = undefined;
      loginBoundary = undefined;
      loginError = undefined;
      databaseFailure = undefined;
      try {
        await post(actor, "/auth/login", { phone: user.phone, password: passwords[actor] });
      } catch (error) {
        // Brokering the failed request has already returned. Inspect only
        // committed facts for this exact synthetic identity using the owner.
        const [limits, userRow, audits, refresh] = await Promise.allSettled([
          owner.authRateLimit.count(),
          owner.user.findUnique({ where: { id: user.id }, select: { lastLoginAt: true } }),
          owner.auditLog.count({ where: { action: "auth.login", actorUserId: user.id, businessId: user.id } }),
          owner.refreshToken.count({ where: { userId: user.id } })
        ]);
        loginFacts = {
          rateLimitRows: limits.status === "fulfilled" ? limits.value : undefined,
          lastLoginRecorded: userRow.status === "fulfilled" ? Boolean(userRow.value?.lastLoginAt) : undefined,
          auditRows: audits.status === "fulfilled" ? audits.value : undefined,
          refreshRows: refresh.status === "fulfilled" ? refresh.value : undefined
        };
        throw error;
      } finally {
        authFailure = takeTask12AuthError(authErrors, server, ticket);
      }
    }
    stage = "SIGNATURES";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
    for (const actor of [1, 2, 3, 4, 5]) await expectStatus(send(actor, "/me/signature/canvas", "POST", { form: form(png, "image/png", "signature.png") }), 201);

    stage = "TEMPLATE";
    const equipment = readFileSync(resolve(__dirname, "../../assets/templates/equipment-rental-real-v1.docx"));
    const published = await publishTask12GeneratedEquipmentTemplate(equipment, seed.users[2].id, port(2));
    stage = "DRAFT_CREATE";
    const created = await post(0, "/contracts", { projectId: seed.project.id, numericProtocolVersion: 2, contractTypeKey: "equipment_rental", relationship: "inside", amountLimitType: "capped" });
    const { id: contractId } = created.contract;
    const { id: versionId } = created.version;
    expect(typeof versionId).toBe("string");
    const draft = "/contract-drafts/" + versionId;
    const contract = "/contracts/" + versionId;
    for (const path of [draft + "/submission", contract + "/approval", contract + "/seal-confirmation"]) qualifiedWrites.add(path);
    const detailPath = "/contracts/" + contractId + "?versionId=" + versionId;
    const pendingPath = "/contracts/workbench?view=pending_action&page=1&pageSize=100";
    qualifiedReads.add(detailPath);
    qualifiedReads.add(pendingPath);
    const detail = (actor = 0) => get(actor, detailPath);
    stage = "DRAFT_LEASE";
    const lease = await post(0, draft + "/edit-lease");
    const headers = { "x-contract-draft-lease": lease.token as string };
    const workbench = () => get(0, draft + "/workbench");
    const name = "隔离验收设备租赁合同";
    const addedClause = "双方补充约定原件保密。";
    const save = async (documentBody?: object) => {
      stage = documentBody ? "DRAFT_WORKBENCH_BEFORE_EDIT" : "DRAFT_WORKBENCH_BEFORE_SETUP";
      const current = await workbench();
      stage = documentBody ? "DRAFT_SAVE_EDIT" : "DRAFT_SAVE_SETUP";
      await expectStatus(send(0, draft, "PUT", { headers, json: {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision,
        changedSections: ["draft", "parties"],
        draft: { numericProtocolVersion: 2, companyEntityId: company.id,
          draftData: { ...current.draft, contractName: name, contractBasics: { businessType: "equipment_rental", relationship: "inside", amountBasis: "tax_inclusive", invoiceStatus: "pending" },
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
    stage = "DRAFT_DOCUMENT_BODY";
    const source = await get(0, draft + "/document-body");
    const block = source.blocks.find((item: Payload) => item.editable && item.text.startsWith("3.甲方需要延长本合同租赁期限"));
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
      if (downloaded.status !== 200) {
        throw Object.assign(new Error("NATIVE_329_DOWNLOAD_HTTP"), { status: downloaded.status, expected: 200 });
      }
      expect(downloaded.mimeType).toBe(mimeType);
      expect(downloaded.bytes.length).toBe(ticket.sizeBytes);
      return downloaded.bytes;
    };
    const job = await owner.contractGeneratedDocument.findUniqueOrThrow({ where: { id: generated.generationId } });
    expect(job).toMatchObject({ status: "success", engineVersion: CONTRACT_BODY_DOCX4J_ENGINE_VERSION,
      docxFileId: generated.docxFileId, pdfFileId: generated.pdfFileId });
    const [docxFact, pdfFact] = await Promise.all([generated.docxFileId, generated.pdfFileId].map(id =>
      owner.fileObject.findUniqueOrThrow({ where: { id }, select: { contentSha256: true } })));
    expect(docxFact.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(pdfFact.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    generatedFacts = { engine: job.engineVersion, docxSha256: docxFact.contentSha256!, pdfSha256: pdfFact.contentSha256! };
    qualifiedFiles.add(generated.docxFileId);
    qualifiedFiles.add(generated.pdfFileId);
    stage = "GENERATED_DOWNLOAD";
    const docx = await download(generated.docxFileId, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const pdf = await download(generated.pdfFileId, "application/pdf");
    expect(hash(docx)).toBe(generatedFacts.docxSha256);
    expect(hash(pdf)).toBe(generatedFacts.pdfSha256);
    expect(extractContractDocx(docx).blocks.map(block => block.text).join(" ")).toContain(addedClause);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);

    stage = "SUBMISSION";
    const lateAssignment = seed.globalRoles.find(role => role.roleKey === "finance_director")!;
    await owner.userPosition.delete({ where: { id: lateAssignment.id } });
    const submission = { expectedRevision: version.draftRevision, idempotencyKey: randomUUID(),
      documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint,
      generatedDocumentId: generated.generationId, sourceSha256: source.sourceSha256, blanksReviewed: true };
    await expectStatus(send(0, draft + "/submission", "POST", { json: submission, headers }), 410);
    const submitted = await post(0, draft + "/submission", { ...submission, submissionProtocolVersion: 2 }, headers);
    expect(submitted.approvalInstanceId).toEqual(expect.any(String));
    expect(await post(0, draft + "/submission", { ...submission, submissionProtocolVersion: 2 }, headers)).toEqual(submitted);

    stage = "APPROVAL";
    const pending = async (actor: number) => (await get(actor, pendingPath)).rows
      .filter((row: Payload) => row.contractVersionId === versionId).length;
    expect(await pending(6)).toBe(0);
    const lateNotice = {
      businessType: "contract_v2_inside_duty_notification", businessId: submitted.approvalInstanceId,
      action: "queued", metadata: { path: ["recipientId"], equals: lateAssignment.userId }
    };
    expect(await owner.auditLog.count({ where: lateNotice })).toBe(0);
    const approvalProgress = "/approval-progress/" + submitted.approvalInstanceId;
    const financeDuty = async (actor: number) => (await get(actor, approvalProgress)).nodes
      .find((node: Payload) => node.name === "财务主管");
    stage = "LATE_APPROVAL_MISSING_PROGRESS";
    expect(await financeDuty(0)).toMatchObject({ status: "待配置", pending: [] });
    const firstApproval = (await detail(1)).reviewApprovalContext;
    await post(1, contract + "/approval", { ...firstApproval, decision: "approve" });
    expect(await pending(6)).toBe(0);

    stage = "LATE_APPROVAL_ROLE";
    const notices = app.get(ContractDutyNotificationService);
    await owner.$transaction(async tx => {
      await tx.userPosition.create({ data: {
        id: lateAssignment.id, userId: lateAssignment.userId, positionId: lateAssignment.positionId
      } });
      const roundIds = [submitted.approvalInstanceId as string];
      await notices.queueNewApprovalDuties(tx, lateAssignment.userId, roundIds);
      await notices.queueNewApprovalDuties(tx, lateAssignment.userId, roundIds);
    });
    stage = "LATE_APPROVAL_QUEUE";
    const queued = await owner.auditLog.findMany({ where: lateNotice });
    expect(queued).toHaveLength(1);
    stage = "LATE_APPROVAL_TODO";
    expect(await pending(4)).toBe(1);
    stage = "LATE_APPROVAL_ACTIVE_PROGRESS";
    expect(await financeDuty(4)).toMatchObject({ status: "处理中", pending: [{ id: lateAssignment.userId }] });
    expect((await get(0, approvalProgress)).parallelCompletion).toEqual({ completed: 1, total: 5 });
    stage = "LATE_APPROVAL_DELIVERY";
    const mockSend = jest.fn().mockResolvedValue({ status: "accepted", message: "合成接收" });
    const dispatcher = new ContractDutyNotificationService(app.get(PrismaService),
      { available: () => true, sendDutyIntent: mockSend } as unknown as ApprovalSmsService);
    await dispatcher.afterCommit(queued[0].id);
    await dispatcher.afterCommit(queued[0].id);
    expect(mockSend).toHaveBeenCalledTimes(1);

    stage = "APPROVAL_AFTER_ROLE";
    const remainingActors = [2, 3, 4, 5];
    const approvals = await Promise.all(remainingActors.map(async actor => (await detail(actor)).reviewApprovalContext));
    expect(approvals.every(context => /^[a-f0-9]{64}$/u.test(context?.expectedParallelApprovalEpoch))).toBe(true);
    await Promise.all(remainingActors.map((actor, index) => post(actor, contract + "/approval", { ...approvals[index], decision: "approve" })));
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
    expect(await owner.approvalInstance.findMany({ where: { businessId: versionId }, select: { id: true, flowType: true } }))
      .toEqual([{ id: submitted.approvalInstanceId, flowType: "contract.approve" }]);

    stage = "ORIGINALS";
    const originals = [];
    for (const index of [0, 1]) {
      const original = await PDFDocument.load(pdf);
      const font = await original.embedFont(StandardFonts.Helvetica);
      original.getPage(0).drawText("Synthetic original, party " + (index + 1), { font, x: 48, y: 20, size: 9 });
      const bytes = await original.save();
      const uploaded = await expectStatus(send(0, "/files", "POST", { form: form(bytes, "application/pdf", "signed-original-" + (index + 1) + ".pdf") }), 201);
      expect(uploaded).toMatchObject({ contentSha256: hash(bytes), sizeBytes: bytes.length });
      originals.push({ id: uploaded.id as string, sha256: hash(bytes), sizeBytes: bytes.length });
      qualifiedFiles.add(uploaded.id);
    }
    expect(originals[0].sha256).not.toBe(originals[1].sha256);
    const fileIds = originals.map(original => original.id);
    const archive = { ...seal, confirmed: undefined, archiveProtocolVersion: 2, archiveSource: "generated_approval",
      idempotencyKey: randomUUID(), fileIds, confirmedMatchingSignedDocument: true };
    stage = "ARCHIVE_ADMISSION";
    const leaseIdentity = { identity: archiveIdentity, serverPort: archiveIdentity.serverPort,
      roles: { 3: { name: archiveIdentity.ordinaryName, oid: archiveIdentity.ordinaryOid } } };
    executeOwnerFixtureSql(packet, renderNormal274ArchiveBinding(leaseIdentity, { projectId: seed.project.id, handlerId: seed.handler.id, contractId, versionId,
      approvalInstanceId: submitted.approvalInstanceId, requestKey: archive.idempotencyKey, documentContentRevision: submission.documentContentRevision,
      documentContentFingerprint: submission.documentContentFingerprint, originals }, true));

    stage = "ARCHIVE_ACCESS";
    await expectStatus(send(7, contract + "/signed-archive", "POST", { json: archive }), 403);
    stage = "ARCHIVE_REQUEST";
    const archiveWindowStart = Date.now();
    const archived = await post(0, contract + "/signed-archive", archive);
    expect(archived).toMatchObject({ status: "effective", contractVersionId: versionId, fileIds });
    stage = "ARCHIVE_REPLAY";
    expect(await post(0, contract + "/signed-archive", archive)).toEqual(archived);
    expect((await get(0, contract + "/archive-requests/" + archive.idempotencyKey)).result).toEqual(archived);
    expect(await pending(0)).toBe(0);
    stage = "ARCHIVE_DOWNLOAD";
    for (const original of originals) {
      expect(hash(await download(original.id, "application/pdf"))).toBe(original.sha256);
      await expectStatus(send(7, "/files/" + original.id + "/download-ticket", "POST", {
        json: { confirmationPassword: passwords[7], downloadReason: "隔离测试访问限制" }
      }), 403);
    }
    stage = "ARCHIVE_OWNER_PROOF";
    const activatedVersion = await owner.contractVersion.findUniqueOrThrow({ where: { id: versionId } });
    const project = await owner.project.findUniqueOrThrow({ where: { id: seed.project.id } });
    expect(activatedVersion.status).toBe("effective");
    expect(project.constructionEnterpriseLockedAt).toBeInstanceOf(Date);
    expect(project.constructionEnterpriseLockedAt?.getTime()).toBeGreaterThanOrEqual(archiveWindowStart);
    expect(project.constructionEnterpriseLockedAt?.getTime()).toBeLessThanOrEqual(activatedVersion.effectiveAt!.getTime());
    const durableArchive = await owner.contractArchiveFile.findUniqueOrThrow({ where: { id: archived.archiveId } });
    expect(durableArchive).toMatchObject({ contractVersionId: versionId, archiveSource: "generated_approval", status: "confirmed" });
    expect(durableArchive.authoritySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(durableArchive.fileManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    stage = "ARCHIVE_DETAIL";
    expect(await detail()).toMatchObject({ contractVersionId: versionId,
      v2Lifecycle: { status: "ready", state: "archived", approvalInstanceId: submitted.approvalInstanceId, sealTaskId: lifecycle.sealTaskId } });
    stage = "ARCHIVE_AUDIT";
    for (const [action, actor] of [["contract.seal_task.create", null], ["contract.seal.complete", seed.users[6].id], ["contract.archive.complete", seed.users[0].id]] as const) {
      expect(await owner.auditLog.count({ where: { action, businessId: versionId, ...(actor ? { actorUserId: actor } : {}) } })).toBe(1);
    }
    stage = "THREE_SESSIONS";
    const additionalUsers = ["兼岗验收员", "无项目验收员"].map((name, index) => ({
      id: randomUUID(),
      name,
      phone: "198" + seed.users[index].phone.slice(3),
      password: randomBytes(32).toString("hex")
    }));
    for (const { password, ...user } of additionalUsers) {
      await owner.user.create({ data: {
        ...user, isActive: true, mustChangePassword: false, sessionVersion: 0,
        passwordHash: await hashTask12GeneratedAdmissionPassword(password)
      } });
    }
    await owner.projectMember.createMany({ data: ["contract_staff", "project_manager"].map((positionKey) => ({
      projectId: seed.project.id, userId: additionalUsers[0].id, positionKey
    })) });
    const additionalHttp = createTask12Con18DefaultHttp(await app.getUrl(), AbortSignal.timeout(60_000));
    for (const [actor, { phone, password }] of additionalUsers.entries()) {
      await expectStatus(additionalHttp.send(actor, { path: "/auth/login", method: "POST", json: { phone, password } }), 201);
    }
    const readRequest = { path: detailPath, method: "GET", headers: { "x-contract-numeric-protocol": "2" } } as const;
    const [handlerView, bothRolesView, outsiderView] = await Promise.all([
      send(0, detailPath),
      additionalHttp.send(0, readRequest),
      additionalHttp.send(1, readRequest)
    ]);
    expect(handlerView).toMatchObject({ status: 200, body: { contractVersionId: versionId } });
    expect(bothRolesView).toMatchObject({ status: 200, body: { contractVersionId: versionId } });
    expect(outsiderView.status).toBe(404);

    process.stdout.write("SEAL_329_NATIVE_PROOF " + JSON.stringify({ candidate: packet.candidate, docxSha256: hash(docx), pdfSha256: hash(pdf),
      contractType: "equipment_rental", originalSha256: originals.map(original => original.sha256),
      authoritySha256: durableArchive.authoritySha256, fileManifestSha256: durableArchive.fileManifestSha256, approvals: remainingActors.length + 1,
      lateApprovalNotice: { pending: 1, queued: queued.length, simulatedSends: mockSend.mock.calls.length },
      legacyRouteResponses: [410,410,410,410], sealTasks: 1, storage: "local",
      accounts: seed.users.length + additionalUsers.length, concurrentReadStatuses: [handlerView.status, bothRolesView.status, outsiderView.status] }) + "\n");
  } catch (error) {
    const detail = error as { code?: unknown; status?: unknown; expected?: unknown; message?: unknown };
    const code = typeof detail?.code === "string" && /^[A-Z0-9_]{1,100}$/u.test(detail.code) ? detail.code : undefined;
    const marker = typeof detail?.message === "string" && /^(?:NATIVE_329|TASK12)_[A-Z0-9_]{1,100}$/u.test(detail.message) ? detail.message : undefined;
    const status = typeof detail?.status === "number" ? detail.status : undefined;
    const expected = typeof detail?.expected === "number" ? detail.expected : undefined;
    const diagnostic = JSON.stringify({ stage, code, marker, status, expected, databaseFailure, authFailure, loggedAuthFailure,
      loginBoundary, loginError, loginFacts, generatedFacts });
    process.stdout.write("SEAL_329_NATIVE_FAILURE " + diagnostic + "\n");
    throw new Error(diagnostic);
  } finally {
    await Promise.allSettled([app?.close(), owner.$disconnect(), readOnlyApplication.$disconnect()]);
  }
}, 420_000);
