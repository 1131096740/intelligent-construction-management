"use strict";

const assert = require("node:assert/strict");
const { AsyncLocalStorage } = require("node:async_hooks");
const { execFileSync } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { prepareTask426A08DirectFixtures, runTask426A08DirectHttp } = require("./task426-a08-direct-fixture.cjs");
const { readOwnedNativeArchiveIdentity } = require("../prisma/seal-retirement-329-archive.cjs");

const dedicatedRoles = Object.freeze({
  DIRECT_ARCHIVE_ISSUER_DATABASE_URL: "jg_c259_outside_issuer_login",
  DIRECT_ARCHIVE_RUNTIME_DATABASE_URL: "jg_c259_outside_executor_login",
  UPWARD_DIRECT_ARCHIVE_ISSUER_DATABASE_URL: "jg_c259_upward_issuer_login",
  UPWARD_DIRECT_ARCHIVE_RUNTIME_DATABASE_URL: "jg_c259_upward_runtime_login"
});
const upwardGuardLabels = Object.freeze({
  "对上登记来源核对器已变化": "VERIFIER_IDENTITY",
  "对上后继连接与原角色绑定不匹配": "CALLER_BINDING",
  "对上后继角色图已变化": "ROLE_GRAPH",
  "对上登记技术凭据须保持私有不可改写": "PRIVATE_RELATIONS",
  "对上专用登录或发行所有者不得取得业务表权限": "DEDICATED_ROLE_BUSINESS_ACCESS",
  "对上专用角色只能经固定发行桥接，不得直读业务来源": "DEDICATED_ROLE_SOURCE_ACCESS",
  "对上登记有限源配方已变化": "RECIPE_IDENTITY",
  "对上登记源码闭包不完整": "RECIPE_CLOSURE",
  "对上登记已绑定源码或元数据变化": "ROUTINE_POSTIMAGE",
  "对上固定源码存在配方外执行权限": "ROUTINE_EXECUTE_ACL",
  "对上登记守卫闭包不完整或重复": "TRIGGER_CLOSURE",
  "对上登记精确后继与前态不一致": "SUCCESSOR_POSTIMAGE",
  "对上登记事务守卫集合不完整": "TRIGGER_SET",
  "对上登记原守卫接线或源码已变化": "TRIGGER_POSTIMAGE",
  "对上生效来源约束后继已变化": "CONSTRAINT_POSTIMAGE",
  "对上来源约束必须独立重建原表达式与固定Q2后继": "CONSTRAINT_RECONSTRUCTION"
});
const currentCoreSha = "c86b37cc155cb5cf424dd682f9767363da264eed8630a0dee9f02acde0dc3f49";
const predecessorCoreSha = "607cc42deccbb17f6de375976b5ed0ef0cbb30805c24ab6d3fb7cf6be74fc5fe";
const predecessorProjectionSha = "5fc49d0c0d0982b14dad70f9498c003dcffb4dfa9d1b7ae58155a93069f220b3";
const currentProjectionSha = "486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7";
const prismaDiagnosticRoutes = new Map([
  ["A08_HTTP_LOGIN", "POST /auth/login"], ["A08_HTTP_CREATE", "POST /contracts"],
  ["A08_HTTP_SAVE", "PUT /contract-drafts/:contractVersionId"],
  ["A08_HTTP_ARCHIVE", "POST /contracts/:contractVersionId/signed-archive"],
  ["A08_HTTP_TICKET", "POST /files/:fileId/download-ticket"],
  ["A08_HTTP_DOWNLOAD", "GET /files/:fileId/download"],
  ["A08_HTTP_OUTSIDER_LOGIN", "POST /auth/login"],
  ["A08_HTTP_OUTSIDER_TICKET", "POST /files/:fileId/download-ticket"]
]);
const signedBindingRowIdentifiers = [
  ["ContractSignedChange", "id"],
  ["SignedContractSettlementAttachment", "settlementId"]
];
// Match the existing native Task12 ordinary role's exact scalar projection.
const reviewReadColumns = [
  "leftSourceRef", "rightSourceRef", "leftFingerprint", "rightFingerprint", "supersedesReviewId",
  "relation", "coverage", "reason", "revision", "preparedByUserId", "contractReviewedById",
  "financeReviewedById", "financeRequired", "idempotencyKey", "requestFingerprint", "targetSourceRef",
  "targetVersionId", "directSourcePins", "createdAt", "returnedAt", "returnReason"
];
const saveGuardLabels = ["A08_DRAFT_VOUCHER_SCOPE", "A08_DRAFT_VOUCHER_BINDING", "A08_DRAFT_VOUCHER_BUSY",
  "A08_OUTSIDE_ORIGINAL_PAIR_SCOPE", "A08_OUTSIDE_ORIGINAL_PAIR_BINDING", "A08_OUTSIDE_ORIGINAL_PAIR_BUSY",
  "A08_OUTSIDE_ORIGINAL_PAIR_COMPLETION_SCOPE", "A08_OUTSIDE_ORIGINAL_PAIR_INCOMPLETE"];
const saveUnavailableMessages = new Map([
  ["已签合同来源资格尚未完整供应或已变化，请保留原件稍后办理", "DIRECT_SOURCE_QUALIFICATION"],
  ["已签合同来源暂时无法核对，请保留资料稍后重试", "DIRECT_SOURCE_STATE"],
  ["已签合同来源坐标尚未核对，请保留资料稍后重试", "DIRECT_SOURCE_COORDINATES"],
  ["已签合同来源修订尚未核对", "DIRECT_SOURCE_REVISION"],
  ["原合同编号暂时无法核对", "ORIGINAL_NUMBER_READ"],
  ["原合同编号写入结果尚未核对", "ORIGINAL_NUMBER_WRITE"],
  ["已保存的对上来源暂时无法核对", "UPWARD_SOURCE_STATE"],
  ["已签变更与结算文件绑定暂不可核验，请稍后重试", "SIGNED_FILE_BINDING_CATALOG"],
  ["付款凭证文件绑定暂不可核验，请稍后重试", "REGISTERED_PAYMENT_FILE_BINDING_CATALOG"]
]);
// These coordinates are admitted only against the exact compiled module bytes.
const compiledSaveGuardOrigins = [
  { module: "../dist/contract/contract-direct-pending-save.js",
    sha256: "5db83979a7a96a3a90bee0040528dac842ca17e4e2257831e31a4fb06ad7e572",
    lines: { 39: "DIRECT_SOURCE_STATE", 43: "DIRECT_SOURCE_COORDINATES", 152: "ORIGINAL_NUMBER_READ",
      173: "ORIGINAL_NUMBER_WRITE", 180: "DIRECT_SOURCE_REVISION" } },
  { module: "../dist/contract/contract-upward-pending-save.js",
    sha256: "6a7b4068482392825ea0da15f36fea8b593dde1eb85b0745754d2d1684274a03",
    lines: { 143: "ORIGINAL_NUMBER_READ", 192: "UPWARD_SAVED_VERSION_MISSING", 207: "UPWARD_SOURCE_STATE" } },
  { module: "../dist/database/registered-payment-catalog.js",
    sha256: "43cdbc559240454f3cdd9367ac02c7d91db3544dee33a99954edc61c77eddb44",
    lines: { 194: "SIGNED_FILE_BINDING_CATALOG", 202: "REGISTERED_PAYMENT_FILE_BINDING_CATALOG" } }
];
const domainGuardFrames = new Map([
  ["assertDirectPendingSourceQualification", "DIRECT_SOURCE_QUALIFICATION"],
  ["assertDirectPendingSourceContinuity", "DIRECT_SOURCE_CONTINUITY"],
  ["readDirectPendingInput", "DIRECT_PENDING_READ"],
  ["assertUpwardPendingSaveContinuity", "UPWARD_SOURCE_CONTINUITY"],
  ["saveDirectPendingAggregate", "OUTSIDE_SAVE"], ["saveUpwardPendingAggregate", "UPWARD_SAVE"]
]);
const secret = () => randomBytes(32).toString("hex");
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sqlLiteral = value => "'" + value.replaceAll("'", "''") + "'";
function identifier(value) {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]*$/u);
  return `"${value}"`;
}

function classifyA08CompiledSaveOrigin(firstFrame) {
  const location = /^\s+at (?:async )?[^()]+ \((\/.+):(\d+):\d+\)$/u.exec(firstFrame ?? "");
  if (!location) return undefined;
  const [, filename, line] = location;
  const origin = compiledSaveGuardOrigins.find(entry => filename.endsWith(entry.module.slice(2)));
  if (!origin || filename !== require.resolve(origin.module) || sha(readFileSync(filename)) !== origin.sha256) return undefined;
  return origin.lines[line];
}

function classifyA08UpwardGuard(message) {
  const matched = Object.entries(upwardGuardLabels).filter(([fixed]) => message.includes(fixed));
  return matched.length === 1 ? matched[0][1] : undefined;
}

function observeA08UpwardOwner(sql, archiveMaterial, record, successor) {
  const { owner, application } = readOwnedNativeArchiveIdentity(archiveMaterial);
  assert.match(application.oid, /^[1-9][0-9]{0,9}$/u);
  assert.ok(Number.isInteger(owner.serverPort) && owner.serverPort > 1024 && owner.serverPort !== 5432 && owner.serverPort <= 65535);
  // Never return the protected binding or projection payload. Both checks run
  // on the already qualified TLS owner connection, in a read-only transaction.
  const observed = JSON.parse(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path TO pg_catalog, pg_temp;
WITH identity AS MATERIALIZED (
  SELECT current_database()=${sqlLiteral(owner.database)} AND current_user=session_user AND current_user::regrole::oid=10
    AND inet_server_port()=${owner.serverPort} AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet
    AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    AND EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10 AND oid::text=${sqlLiteral(owner.databaseOid)})
    AND (SELECT system_identifier::text FROM pg_control_system())=${sqlLiteral(owner.systemIdentifier)}
    AND current_setting('transaction_read_only')='on' AS qualified
), source AS MATERIALIZED (
  SELECT identity.qualified,
    (SELECT proowner=10 AND NOT prosecdef AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=${sqlLiteral(currentCoreSha)}
      FROM pg_proc WHERE oid=to_regprocedure('public.jg_require_contract_direct_upward_source_v2()')) AS core_pinned,
    (SELECT proowner=10 AND prosecdef AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=${sqlLiteral(successor ? currentProjectionSha : predecessorProjectionSha)}
      FROM pg_proc WHERE oid=to_regprocedure('public.jg_upward_archive_catalog_projection_v2()')) AS projection_pinned,
    (SELECT pg_catalog.strpos(prosrc,${sqlLiteral(currentCoreSha)})>0
      FROM pg_proc WHERE oid=to_regprocedure('public.jg_upward_archive_catalog_projection_v2()')) AS projection_uses_current_core,
    (SELECT pg_catalog.strpos(prosrc,${sqlLiteral(predecessorCoreSha)})>0
      FROM pg_proc WHERE oid=to_regprocedure('public.jg_upward_archive_catalog_projection_v2()')) AS projection_uses_predecessor_core,
    (SELECT count(*)=1 AND bool_and(b."applicationRoleOid"=${application.oid}::oid
      AND b."anchorOwnerOid"=10 AND b."databaseOid"::text=${sqlLiteral(owner.databaseOid)})
      FROM public.jg_contract_direct_upward_closure_v2 b) AS binding_matches
  FROM identity
)
SELECT jsonb_build_object('ownerTls',qualified,'corePinned',core_pinned,'projectionPinned',projection_pinned,
  'projectionUsesCurrentCore',projection_uses_current_core,'projectionUsesPredecessorCore',projection_uses_predecessor_core,
  'bindingMatches',binding_matches,'coreAccepted',CASE WHEN qualified AND core_pinned AND projection_pinned AND binding_matches
    THEN public.jg_require_contract_direct_upward_source_v2() IS NOT NULL ELSE false END) FROM source;
ROLLBACK;`));
  const required = { ownerTls: true, corePinned: true, projectionPinned: true, bindingMatches: true, coreAccepted: true };
  const keys = [...Object.keys(required), "projectionUsesCurrentCore", "projectionUsesPredecessorCore"];
  const facts = Object.fromEntries(keys.map(key => [key, observed?.[key] === true]));
  record(facts);
  assert.deepEqual(facts, { ...required, projectionUsesCurrentCore: true, projectionUsesPredecessorCore: false },
    "A08_UPWARD_OWNER_OBSERVATION");
  return facts;
}

async function prepareNativeA08Mode(source, relationship) {
  assert.ok(Object.hasOwn({ outside: true, upward: true }, relationship));
  const businessDate = Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const fixtures = await prepareTask426A08DirectFixtures({ source: source.sourceProfile, sourceSha: source.candidate,
    businessDate, outsideCaseId: randomUUID(), upwardCaseId: randomUUID() });
  const { bucket, region } = fixtures;
  const bytes = readFileSync(require.resolve("../prisma/task16-current259-ordinary-archive-acl.requirements.json"));
  const aclSha256 = sha(bytes);
  assert.equal(aclSha256, "195a30acc5923f5b09a3c1bbafc2601cd7909628d815f6d63f62805e26e14759");
  const requirements = JSON.parse(bytes);
  const scenario = fixtures[relationship];
  const originalManifest = scenario.expectedOriginals.map(({ id, ...metadata }) => metadata);
  return { scenario, requirements, bucket, region, successor: true,
    evidence: { relationship, originalCount: originalManifest.length, originalManifest,
      originalManifestSha256: sha(JSON.stringify(originalManifest)), aclSha256, storage: "SYNTHETIC_OFFLINE_BYTES" } };
}

function compileNativeA08Application({ root, api, env }) {
  const compiler = require.resolve("typescript/bin/tsc");
  for (const config of [join(root, "packages/shared-domain/tsconfig.json"), join(api, "tsconfig.build.json")]) {
    execFileSync(process.execPath, [compiler, "-p", config], { cwd: api, env, timeout: 120_000, stdio: "pipe" });
  }
  for (const name of ["app.module", "file/file.service", "database/task12-con18-default-http"]) {
    require.resolve(`../dist/${name}.js`);
  }
}

function grantOrdinaryAcl(requirements, role) {
  const target = identifier(role);
  const statements = [];
  for (const [table, [read, insert, update, remove]] of Object.entries(requirements.tables)) {
    const relation = `public.${identifier(table)}`;
    for (const [privilege, columns] of [["SELECT", read], ["INSERT", insert], ["UPDATE", update]]) {
      // A08 original assets are seeded by the owner, and no public file upload is used.
      if (columns.length && !(table === "FileObject" && privilege === "INSERT")) {
        statements.push(`GRANT ${privilege} (${columns.map(identifier).join(", ")}) ON ${relation} TO ${target};`);
      }
    }
    if (remove) statements.push(`GRANT DELETE ON ${relation} TO ${target};`);
  }
  for (const [table, column] of Object.entries({ ...requirements.retainRowLocks, BusinessParty: requirements.businessPartyRowLockFallback })) {
    statements.push(`GRANT UPDATE (${identifier(column)}) ON public.${identifier(table)} TO ${target};`);
  }
  // These fixed Prisma defaults are covered by the ordinary lifecycle ACL.
  const prismaDefaults = {
    AuditLog: ["createdAt"],
    RefreshToken: ["createdAt"],
    Contract: ["source", "createdAt"],
    ContractVersion: ["cumulativeIncreaseCents", "cumulativeDecreaseCents", "draftRevision", "documentContentRevision", "taxFactRevision", "createdAt"],
    ContractBill: ["revision", "taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents", "createdAt"],
    ContractPartySnapshot: ["createdAt"],
    PaymentTermsVersion: ["createdAt"],
    ContractDraftSaveRequest: ["createdAt"]
  };
  for (const [table, columns] of Object.entries(prismaDefaults)) {
    statements.push(`GRANT INSERT (${columns.map(identifier).join(", ")}) ON public.${identifier(table)} TO ${target};`);
  }
  // Same current file-pointer and roster columns as the trusted native lifecycle.
  for (const [table, columns] of [["ContractSignedChange", ["appendixFormalFileId"]],
    ["SignedContractSettlementAttachment", ["fileId"]], ["ContractTakeoverCorrection", ["correctionType", "schemaVersion"]],
    ["ProjectRosterMember", ["projectId", "userId"]],
    ["ContractNumberTombstone", ["id", "formalCode"]]]) {
    statements.push(`GRANT SELECT (${columns.map(identifier).join(", ")}) ON public.${identifier(table)} TO ${target};`);
  }
  // The signed file catalog also verifies the row identifiers projected by its readers.
  for (const [table, column] of signedBindingRowIdentifiers) {
    statements.push(`GRANT SELECT (${identifier(column)}) ON public.${identifier(table)} TO ${target};`);
  }
  statements.push(`GRANT SELECT (${reviewReadColumns.map(identifier).join(", ")}) ON public."ContractEconomicReview" TO ${target};`);
  return statements;
}

function prepareA08TlsSessions({ ownerUrl, archiveMaterial, requirements, sql, recordReviewAcl = () => {} }) {
  const { owner, application } = readOwnedNativeArchiveIdentity(archiveMaterial);
  assert.equal(ownerUrl.protocol, "postgresql:");
  assert.equal(ownerUrl.hostname, "127.0.0.1");
  assert.equal(ownerUrl.username, owner.actor);
  assert.equal(ownerUrl.port, String(owner.serverPort));
  assert.equal(ownerUrl.pathname, `/${owner.database}`);
  assert.equal(ownerUrl.searchParams.get("sslmode"), "require");
  assert.equal(ownerUrl.searchParams.get("sslaccept"), "strict");
  assert.match(application.name, /^jg_fixture_app_[a-f0-9]{24}$/u);
  const roles = { DATABASE_URL: application.name, ...dedicatedRoles };
  const passwords = Object.fromEntries(Object.values(roles).map(role => [role, secret()]));
  const expectedRoles = Object.values(roles).map(sqlLiteral).join(", ");
  const roleWitness = ordinaryLimit => `(SELECT count(*)=5 AND bool_and(r.rolcanlogin
    AND NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    AND r.rolconnlimit=CASE WHEN r.rolname=${sqlLiteral(application.name)} THEN ${ordinaryLimit} ELSE 1 END
    AND (r.rolname<>${sqlLiteral(application.name)} OR r.oid=${application.oid}::oid)
    AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE r.oid IN (m.member,m.roleid)))
    FROM pg_roles r WHERE r.rolname IN (${expectedRoles}))`;
  const columnRead = (table, column) =>
    `has_column_privilege(${application.oid}::oid,${sqlLiteral(`public.${identifier(table)}`)}::regclass,${column},'SELECT')`;
  const noTableRead = table =>
    `NOT has_table_privilege(${application.oid}::oid,${sqlLiteral(`public.${identifier(table)}`)}::regclass,'SELECT')`;
  const signedBindingAcl = granted => signedBindingRowIdentifiers.map(([table, column]) =>
    `${noTableRead(table)} AND ${columnRead(table, sqlLiteral(column))} IS ${granted ? "TRUE" : "FALSE"}`).join(" AND ");
  const reviewTable = "ContractEconomicReview";
  const readableReviewColumns = `ARRAY(SELECT col FROM unnest(ARRAY[${reviewReadColumns.map(sqlLiteral).join(", ")}]) col
    WHERE ${columnRead(reviewTable, "col")})`;
  const reviewAcl = JSON.parse(sql(`BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
SET LOCAL password_encryption='scram-sha-256';
DO $a08_sessions$ BEGIN
  IF (current_database()=${sqlLiteral(owner.database)} AND current_user=session_user AND current_user::regrole::oid=10
    AND EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10 AND oid::text=${sqlLiteral(owner.databaseOid)})
    AND inet_server_port()=${owner.serverPort} AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet
    AND (SELECT system_identifier::text FROM pg_control_system())=${sqlLiteral(owner.systemIdentifier)}
    AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    AND NOT EXISTS(SELECT FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid())
    AND ${roleWitness(0)} AND ${signedBindingAcl(false)} AND ${noTableRead(reviewTable)}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A08_SESSION_PREIMAGE'; END IF;
  PERFORM set_config('jg.a08_review_columns_before', to_jsonb(${readableReviewColumns})::text, true);
END $a08_sessions$;
${Object.entries(passwords).map(([role, password]) =>
    `ALTER ROLE ${identifier(role)} PASSWORD ${sqlLiteral(password)}${role === application.name ? " CONNECTION LIMIT 3" : ""};`).join("\n")}
GRANT CONNECT ON DATABASE ${identifier(owner.database)} TO ${identifier(application.name)};
GRANT USAGE ON SCHEMA public TO ${identifier(application.name)};
${grantOrdinaryAcl(requirements, application.name).join("\n")}
DO $a08_session_acl$ BEGIN
  IF NOT (${roleWitness(3)} AND ${signedBindingAcl(true)} AND ${noTableRead(reviewTable)}
    AND cardinality(${readableReviewColumns})=${reviewReadColumns.length}) OR EXISTS (SELECT FROM pg_class c WHERE c.oid IN (${requirements.privateTablesDenied
    .map(table => `to_regclass(${sqlLiteral(`public.${table}`)})`).join(", ")}) AND
    (has_table_privilege(${application.oid}::oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(${application.oid}::oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    THEN RAISE EXCEPTION 'A08_SESSION_ACL_POSTIMAGE'; END IF;
END $a08_session_acl$;
SELECT jsonb_build_object('before',current_setting('jg.a08_review_columns_before')::jsonb,
  'after',to_jsonb(${readableReviewColumns}),'tableRead',NOT (${noTableRead(reviewTable)}));
COMMIT;`));
  assert.ok(Array.isArray(reviewAcl.before) && reviewAcl.before.every(column => reviewReadColumns.includes(column)));
  assert.deepEqual(reviewAcl.after, reviewReadColumns);
  assert.equal(reviewAcl.tableRead, false);
  recordReviewAcl(reviewAcl);
  return Object.fromEntries(Object.entries(roles).map(([key, role]) => {
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = passwords[role];
    url.searchParams.set("connection_limit", key === "DATABASE_URL" ? "3" : "1");
    return [key, url.toString()];
  }));
}

function readArchivedOriginals(sql, relationship, { archiveId, versionId, actorId, outsiderId, fileIds }) {
  for (const value of [archiveId, versionId, actorId, outsiderId, ...fileIds]) assert.match(value, id);
  const actor = sqlLiteral(actorId);
  const version = sqlLiteral(versionId);
  const archive = sqlLiteral(archiveId);
  const ids = fileIds.map(sqlLiteral).join(", ");
  const generation = relationship === "outside" ? `g."objectGeneration"` : `
    a."authoritySnapshot"->'originals'->e."displayOrder"->>'objectGeneration'`;
  const generationJoin = relationship === "outside" ? `JOIN public.jg_contract_direct_archive_generation_v1 g ON g."evidenceId"=e.id` : "";
  const result = JSON.parse(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('effective', v.status='effective' AND v."effectiveAt" IS NOT NULL,
  'originals', (SELECT jsonb_agg(jsonb_build_object('fileId', e."fileId", 'displayOrder', e."displayOrder",
    'mimeType', e."mimeType", 'sizeBytes', e."sizeBytes", 'contentSha256', e."contentSha256",
    'bucket',f.bucket,'objectKey',f."objectKey",'objectGeneration',${generation}) ORDER BY e."displayOrder")
    FROM public."ContractArchiveEvidenceFile" e JOIN public."FileObject" f ON f.id=e."fileId" ${generationJoin}
    WHERE e."archiveFileId"=a.id AND e."contractVersionId"=v.id AND e."fileId" IN (${ids})),
  'counts',jsonb_build_object('archives',(SELECT count(*) FROM public."ContractArchiveFile" WHERE "contractVersionId"=v.id),
    'approvalRounds',(SELECT count(*) FROM public."ApprovalInstance" WHERE "businessId"=v.id),
    'sealTasks',(SELECT count(*) FROM public."ContractSealTask" WHERE "contractVersionId"=v.id),
    'draftOriginals',(SELECT count(*) FROM public."ContractDraftAttachment" WHERE "contractVersionId"=v.id AND "slotKey"='direct_signed_originals_v1'),
    'archiveAudits',(SELECT count(*) FROM public."AuditLog" WHERE action='contract.archive.complete' AND "actorUserId"=${actor} AND "businessId"=v.id),
    'downloadTicketAudits',(SELECT count(*) FROM public."AuditLog" WHERE action='file.download.ticket' AND "actorUserId"=${actor} AND "businessId" IN (${ids})),
    'downloadAudits',(SELECT count(*) FROM public."AuditLog" WHERE action='file.download' AND "actorUserId"=${actor} AND "businessId" IN (${ids})),
    'outsiderTicketAudits',(SELECT count(*) FROM public."AuditLog" WHERE action='file.download.ticket'
      AND "actorUserId"=${sqlLiteral(outsiderId)} AND "businessId" IN (${ids}))))
FROM public."ContractArchiveFile" a JOIN public."ContractVersion" v ON v.id=a."contractVersionId"
WHERE a.id=${archive} AND v.id=${version} AND a."uploadedByUserId"=${actor} AND a."confirmedByUserId"=${actor}
  AND a."archiveSource"='direct_signed' AND a."archiveProtocolVersion"=2 AND a.status='confirmed'
  AND a."approvalInstanceId" IS NULL AND a."sealTaskId" IS NULL;
ROLLBACK;`));
  assert.equal(result.effective, true, "A08_ARCHIVE_EFFECTIVE");
  return { originals: result.originals, counts: result.counts };
}

const ticketReads = [
  { model: "spotProcurementAttachment", table: "SpotProcurementAttachment", key: "fileId", result: ["versionId"] },
  { model: "spotProcurementPaymentExecution", table: "SpotProcurementPaymentExecution", key: "voucherFileId",
    result: ["paymentId", "executedByUserId", "voidedAt"] },
  { model: "spotProcurementPaymentInvoice", table: "SpotProcurementPaymentInvoice", key: "fileId",
    result: ["paymentId", "uploadedByUserId", "invalidatedByUserId"] },
  { model: "spotProcurementPaymentExecutionVoucher", table: "SpotProcurementPaymentExecutionVoucher", key: "fileId",
    result: ["paymentExecutionId"] },
  { model: "spotProcurementPaymentArchiveFile", table: "SpotProcurementPaymentArchiveFile", key: "fileId",
    result: ["archiveId"] },
  { model: "contractBankVerificationRequest", table: "ContractBankVerificationRequest",
    keys: ["evidenceFileId", "holderEvidenceFileId"], result: ["projectId"] },
  { model: "contractProxyExecution", table: "ContractProxyExecution", key: "evidenceFileId", result: ["projectId"] },
  { model: "upwardContractAmountRevision", table: "UpwardContractAmountRevision", key: "evidenceFileId", result: ["projectId"] },
  { model: "projectAffiliateContractFact", table: "ProjectAffiliateContractFact",
    keys: ["evidenceFileId", "confirmationSignatureFileId"], result: ["projectId"] },
  { model: "projectAffiliateSettlementFact", table: "ProjectAffiliateSettlementFact",
    keys: ["evidenceFileId", "confirmationSignatureFileId"], result: ["projectId"] },
  { model: "projectAffiliatePaymentFact", table: "ProjectAffiliatePaymentFact",
    keys: ["evidenceFileId", "confirmationSignatureFileId"], result: ["projectId"] },
  { model: "projectAffiliateBusinessEvidence", table: "ProjectAffiliateBusinessEvidence",
    key: "fileId", result: ["projectId", "businessType"] },
  { model: "projectAffiliateCompanyContract", table: "ProjectAffiliateCompanyContract",
    keys: ["fileId", "confirmationSignatureFileId"], result: ["projectId"] }
];

async function diagnoseA08TicketReads(databaseUrl, fileId, requirements) {
  assert.match(fileId, id);
  const { Prisma, PrismaClient } = require("@prisma/client");
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ level: "query", emit: "event" }] });
  const eventShape = new Map();
  client.$on("query", ({ query }) => {
    for (const { table } of ticketReads) {
      const [selected, after] = query.split(`FROM "public"."${table}"`);
      if (!after || !selected.trimStart().startsWith("SELECT")) continue;
      eventShape.set(table, { selectsPrimaryKey: selected.includes('"id"'), ordersByPrimaryKey: /ORDER BY [^\n]*"id"/u.test(after) });
    }
  });
  const readOnly = operation => client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return operation(tx);
  });
  const outcome = operation => readOnly(operation).then(() => "READ_ACCEPTED", () => "READ_REJECTED");
  try {
    const proof = [];
    for (const { model, table, key, keys = [key], result } of ticketReads) {
      const required = [...keys, ...result];
      assert.deepEqual([...requirements.tables[table][0]].sort(), [...required].sort());
      const relation = `public.${identifier(table)}`;
      const [acl] = await readOnly(tx => tx.$queryRaw`
        SELECT has_column_privilege(current_user, ${relation}::text, 'id', 'SELECT') AS "id",
          has_table_privilege(current_user, ${relation}::text, 'SELECT') AS "table"
      `);
      const where = key ? { [key]: fileId } : { OR: keys.map(column => ({ [column]: fileId })) };
      const prisma = await outcome(tx => tx[model].findFirst({ where,
        select: Object.fromEntries(result.map(column => [column, true])) }));
      const emitted = eventShape.get(table);
      const fields = Prisma.join(result.map(column => Prisma.raw(identifier(column))));
      const matchingFile = Prisma.join(keys.map(column =>
        Prisma.sql`${Prisma.raw(identifier(column))}=${fileId}`), " OR ");
      const fixedColumns = await outcome(tx => tx.$queryRaw(Prisma.sql`
        SELECT ${fields} FROM ${Prisma.raw(relation)} WHERE ${matchingFile} LIMIT 1
      `));
      proof.push({ table, acl, prisma, fixedColumns, emittedSelect: Boolean(emitted), ...emitted });
    }
    return proof;
  } finally {
    await client.$disconnect();
  }
}

async function runNativeA08Http(mode, { sql, stage, ownerUrl, archiveMaterial, baseEnv, recordOwnerUpward, recordOrdinaryReviewAcl, recordArchiveStage }) {
  const { scenario, bucket, region, requirements, successor } = mode;
  stage("A08_UPWARD_OWNER_BEFORE_ROLES");
  observeA08UpwardOwner(sql, archiveMaterial, facts => recordOwnerUpward("BEFORE_ROLES", facts), successor);
  stage("A08_NATIVE_OWNER_SEED");
  const plan = scenario.prepareNativeOwnerSeed(archiveMaterial);
  const seeded = plan.accept(JSON.parse(sql(plan.sql)));
  seeded.seed.verifyBefore(sql(seeded.seed.beforeSql()));
  seeded.seed.verifyWritten(sql(seeded.seed.writeSql()));
  const seed = seeded.seed.finish(sql(seeded.seed.committedSql()));
  stage("A08_TLS_ROLE_SETUP");
  const sessions = prepareA08TlsSessions({ ownerUrl, archiveMaterial, requirements, sql, recordReviewAcl: recordOrdinaryReviewAcl });
  stage("A08_UPWARD_OWNER_AFTER_ROLES");
  observeA08UpwardOwner(sql, archiveMaterial, facts => recordOwnerUpward("AFTER_ROLES", facts), successor);

  // This runner mode owns the process. Start the real application with only
  // disposable loopback DSNs and replay credentials in its environment.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, baseEnv, sessions, { NODE_ENV: "test", FILE_STORAGE_DRIVER: "cos", COS_BUCKET: bucket,
    COS_REGION: region, COS_SECRET_ID: "offline-a08-id", COS_SECRET_KEY: "offline-a08-key", FILE_DOWNLOAD_SECRET: secret(),
    JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret() });
  const realFetch = globalThis.fetch;
  globalThis.fetch = scenario.offlineOriginalTransport.fetch;
  let app;
  let activeStage;
  let ordinaryProbeClient;
  let stagePrisma;
  let directSource;
  let domainGuards;
  let domainReason;
  const requests = new AsyncLocalStorage();
  try {
    stage("A08_LOOPBACK_APP");
    require("reflect-metadata");
    const { NestFactory } = require("@nestjs/core");
    const { ServiceUnavailableException } = require("@nestjs/common");
    const { AppModule } = require("../dist/app.module.js");
    const { apiJsonReplacer } = require("../dist/api-json-replacer.js");
    const { createApiValidationPipe } = require("../dist/validation/api-validation.js");
    const { configureApiSecurity } = require("../dist/api-security.js");
    const { createTask12Con18DefaultHttp } = require("../dist/database/task12-con18-default-http.js");
    const { PrismaService } = require("../dist/database/prisma.service.js");
    const { ContractDirectArchiveRuntime, ContractUpwardDirectArchiveRuntime } = require("../dist/contract/contract-direct-archive-runtime.js");
    const { ContractDocumentProcessor } = require("../dist/contract-document/contract-document.processor.js");
    const { projectTask16RegistrationError } = require("../dist/database/task16-registration-error-diagnostic.js");
    const { observeTask12DirectSourceDiagnostic } = require("../dist/contract/task12-direct-source-diagnostic.js");
    const { issueTask12NativeReviewReadiness, withTask12NativeReviewReadiness,
      TASK12_NATIVE_REVIEW_CHECKSUM, TASK12_NATIVE_REVIEW_MIGRATION } = require("../dist/file/task12-native-review-readiness.js");
    const { Prisma } = require("@prisma/client");
    const { from, lastValueFrom } = require("rxjs");
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    const { owner, application } = readOwnedNativeArchiveIdentity(archiveMaterial);
    assert.match(application.oid, /^[1-9][0-9]{0,9}$/u);
    const identity = { database: owner.database, databaseOid: owner.databaseOid,
      ordinaryName: application.name, ordinaryOid: application.oid,
      serverPort: owner.serverPort, systemIdentifier: owner.systemIdentifier };
    const ticketProof = JSON.parse(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'ownerOid',d.datdba::text,
  'ownerSession',current_user=session_user AND current_user::regrole::oid=d.datdba,
  'ordinaryOid',r.oid::text,'ordinaryName',r.rolname::text,'serverPort',inet_server_port(),
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
  'completed',(SELECT count(*)=1 AND count(*) FILTER (WHERE finished_at IS NOT NULL
    AND checksum=${sqlLiteral(TASK12_NATIVE_REVIEW_CHECKSUM)})=1
    FROM public."_prisma_migrations" WHERE migration_name=${sqlLiteral(TASK12_NATIVE_REVIEW_MIGRATION)} AND rolled_back_at IS NULL),
  'ledgerDenied',NOT has_any_column_privilege(r.oid,'public."_prisma_migrations"'::regclass,'SELECT'))
FROM pg_database d JOIN pg_roles r ON r.oid=${application.oid}::oid WHERE d.datname=current_database();
ROLLBACK;`));
    assert.equal(ticketProof.ledgerDenied, true, "A08_TICKET_LEDGER_DENIED_TO_APP");
    const scopedFiles = new Set(scenario.expectedOriginals.map(file => file.id));
    const server = app.getHttpServer();
    app.use((request, response, next) => {
      const pathname = (request.url ?? "").split("?", 1)[0];
      const route = request.method === "POST" ? /^\/files\/([a-f0-9-]{36})\/download-ticket$/u :
        request.method === "GET" ? /^\/files\/([a-f0-9-]{36})\/download$/u : undefined;
      const fileId = route?.exec(pathname)?.[1];
      if (!fileId || !scopedFiles.has(fileId)) return next();
      const token = issueTask12NativeReviewReadiness(identity, ticketProof, () => {
        assert.ok(server.listening && request.socket.remoteAddress === "127.0.0.1", "A08_TICKET_OWNED_LOOPBACK_SCOPE");
      });
      void withTask12NativeReviewReadiness(token, () => new Promise(resolve => {
        response.once("finish", resolve);
        response.once("close", resolve);
        next();
      })).catch(next);
    });
    // These direct-signed cases never generate documents. Stop the unrelated
    // background job recovery before bootstrap, with no worker grants.
    await app.get(ContractDocumentProcessor).onApplicationShutdown();
    app.useGlobalInterceptors({ intercept(context, next) {
      const request = context.switchToHttp().getRequest();
      if (prismaDiagnosticRoutes.get(activeStage) !== `${request.method} ${request.route?.path}`) return next.handle();
      const scoped = { stage: activeStage, rawOrdinal: 0 };
      return from(requests.run(scoped, async () => {
        try {
          return await observeTask12DirectSourceDiagnostic(() => lastValueFrom(next.handle()), detail => { directSource = detail; });
        } catch (error) {
          if (scoped.stage === "A08_HTTP_SAVE" && error instanceof ServiceUnavailableException) {
            const frames = String(error.stack ?? "").split("\n").slice(1, 12);
            domainReason = classifyA08CompiledSaveOrigin(frames[0]) ?? saveUnavailableMessages.get(error.message);
            domainGuards = frames.map(frame => /^\s+at (?:async )?(\w+) \([^\n]+\/dist\/contract\//u.exec(frame)?.[1])
              .map(name => domainGuardFrames.get(name)).filter(Boolean);
          }
          throw error;
        }
      }));
    } });
    const outsideRuntime = app.get(ContractDirectArchiveRuntime);
    const upwardRuntime = app.get(ContractUpwardDirectArchiveRuntime);
    const dbClients = {
      ORDINARY: app.get(PrismaService),
      OUTSIDE_ISSUER: outsideRuntime.issuer, OUTSIDE_EXECUTOR: outsideRuntime.executor,
      UPWARD_ISSUER: upwardRuntime.issuer, UPWARD_EXECUTOR: upwardRuntime.executor
    };
    ordinaryProbeClient = dbClients.ORDINARY;
    for (const [clientKind, client] of Object.entries(dbClients)) client.$use(async (params, next) => {
      const request = requests.getStore();
      const ordinal = request && params.action === "queryRaw" ? ++request.rawOrdinal : undefined;
      try { return await next(params); }
      catch (error) {
        if (request && request.stage === activeStage && !stagePrisma) {
          const detail = projectTask16RegistrationError(error);
          const metadata = detail.serverPrismaCode === "P2010" && error instanceof Prisma.PrismaClientKnownRequestError
            ? error.meta : undefined;
          const sqlState = typeof metadata?.code === "string" && /^[0-9A-Z]{5}$/u.test(metadata.code) ? metadata.code : undefined;
          const message = typeof metadata?.message === "string" ? metadata.message
            : detail.serverErrorKind === "UNKNOWN_REQUEST_ERROR" && error instanceof Error ? error.message : "";
          const denied = /permission denied|(?:code:\s*"|SQLSTATE[ :]+)42501\b/iu.test(message);
          const relation = /permission denied for (?:(?:column "?[A-Za-z][A-Za-z0-9_]{0,63}"? of )?(?:table|relation|view)) "?([A-Za-z][A-Za-z0-9_]{0,63})/u.exec(message)?.[1];
          const deniedFunction = /permission denied for function "?((?:jg_)[a-z0-9_]{1,63})/u.exec(message)?.[1];
          const deniedCatalog = /permission denied for (schema|sequence|database|routine|function|table|column|view)\b/iu.exec(message)?.[1];
          const rawStatements = ordinal ? [params.args].flat().flatMap(value => [
            typeof value === "string" ? value : undefined, value?.sql, value?.text, value?.query,
            ...(Array.isArray(value?.strings) ? value.strings : [])
          ]).filter(value => typeof value === "string") : [];
          const rawOperation = [
            ["NECESSARY_EXPENSE_RESERVE", 'FROM public."ProjectNecessaryExpenseReserveEntry" entry'],
            ["PROJECT_FUND_DISPUTE", 'FROM public."ProjectFundDisputeEntry" entry'],
            ["ECONOMIC_REVIEW_FILE_REFERENCES", "contract_economic_review_ticket_references"],
            ["ECONOMIC_REVIEW_ORPHANED_PROOF", "contract_economic_review_ticket_orphaned_proof"],
            ["ECONOMIC_REVIEW_REFERENCE_CATALOG", "contract_economic_review_file_reference_catalog"],
            ["ECONOMIC_REVIEW_REFERENCE_MIGRATION", "contract_economic_review_file_reference_migration"]
          ].find(([, marker]) => rawStatements.some(statement => statement.includes(marker)))?.[0];
          const upwardGuard = sqlState === "55000" ? classifyA08UpwardGuard(message) : undefined;
          const saveGuard = request.stage === "A08_HTTP_SAVE" ? saveGuardLabels.find(label => message.includes(label)) : undefined;
          const failureClass = /failed to deserialize column|unsupported .*type/i.test(message) ? "RAW_RESULT_UNSUPPORTED_TYPE"
            : denied ? "INSUFFICIENT_PRIVILEGE" : undefined;
          stagePrisma = { ...detail, clientKind,
            ...(sqlState || denied ? { serverSqlState: sqlState ?? "42501" } : {}),
            ...(failureClass ? { failureClass } : {}),
            ...(upwardGuard ? { upwardGuard } : {}),
            ...(saveGuard ? { saveGuard } : {}),
            ...(Object.hasOwn(Prisma.ModelName, relation ?? "") ? { relation } : {}),
            ...(deniedFunction ? { deniedFunction } : {}),
            ...(deniedCatalog ? { deniedCatalog } : {}),
            ...(rawOperation ? { rawOperation } : {}),
            ...(Object.hasOwn(Prisma.ModelName, params.model ?? "") ? { model: params.model } : {}),
            ...(ordinal ? { rawQueryOrdinal: ordinal } : {}),
            ...(/^[A-Za-z]{1,32}$/u.test(params.action) ? { action: params.action } : {}) };
        }
        throw error;
      }
    });
    configureApiSecurity(app);
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const http = createTask12Con18DefaultHttp(await app.getUrl(), AbortSignal.timeout(180_000), async (target, options) => {
      const response = await realFetch(target, options);
      if (activeStage === "A08_HTTP_DOWNLOAD" && response.status === 200) {
        const original = scenario.expectedOriginals.find(file => target.pathname === `/files/${file.id}/download`);
        assert.ok(original, "A08_DOWNLOAD_SCOPE");
        assert.equal(response.headers.get("content-length"), String(original.sizeBytes), "A08_DOWNLOAD_LENGTH");
        assert.equal(response.headers.get("content-disposition"),
          `attachment; filename*=UTF-8''${encodeURIComponent(original.originalName)}`, "A08_DOWNLOAD_DISPOSITION");
      }
      return response;
    });
    stage("A08_PUBLIC_HTTP");
    const result = await runTask426A08DirectHttp(scenario, { http, archiveMaterial,
      outsiderId: seeded.seed.outsiderId, outsiderLoginRequest: seeded.seed.outsiderLoginRequest,
      recordArchiveStage,
      enter(next) { activeStage = next; stagePrisma = undefined; directSource = undefined; domainGuards = undefined; domainReason = undefined; stage(next); },
      ownerSql(statement) { return JSON.parse(sql(statement)); },
      readArchive(input) { return readArchivedOriginals(sql, scenario.relationship, input); }
    });
    const reads = scenario.offlineOriginalTransport.readsSince(0);
    for (const original of scenario.expectedOriginals) {
      assert.ok(reads.some(row => row.pinned && row.contentSha256 === original.contentSha256), "A08_PINNED_DOWNLOAD_MISSING");
    }
    return { ...result, seedRows: seed.seedRows, documentWorker: "DISABLED_DIRECT_ONLY",
      offlineReads: reads.length, pinnedReads: reads.filter(row => row.pinned).length };
  } catch (error) {
    if (error?.code === "A08_HTTP_TICKET" && stagePrisma?.clientKind === "ORDINARY"
      && ticketReads.some(row => row.table === stagePrisma.relation) && stagePrisma.serverSqlState === "42501") {
      try {
        // Close the finished app's ordinary pool before a second read-only session
        // so the isolated ordinary role's connection limit stays in force.
        await ordinaryProbeClient.$disconnect();
        error.a08TicketRead = await diagnoseA08TicketReads(sessions.DATABASE_URL, scenario.expectedOriginals[0].id, requirements);
      } catch {
        error.a08TicketRead = { status: "PROBE_NOT_COMPLETED" };
      }
    }
    if (error?.code === activeStage && stagePrisma) error.a08Prisma = stagePrisma;
    if (error?.code === activeStage && directSource) error.a08DirectSource = directSource;
    if (error?.code === activeStage && domainReason) error.a08DomainReason = domainReason;
    if (error?.code === activeStage && domainGuards?.length) error.a08DomainGuards = domainGuards;
    throw error;
  } finally {
    try { await app?.close(); }
    finally { globalThis.fetch = realFetch; }
  }
}

module.exports = { prepareNativeA08Mode, compileNativeA08Application, prepareA08TlsSessions, runNativeA08Http,
  classifyA08UpwardGuard, observeA08UpwardOwner };
