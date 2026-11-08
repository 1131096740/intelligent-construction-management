import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

/** Prepared source only. Importing this module constructs no client, reads no
 * environment and opens no connection. Only a separately authorized executor
 * may supply already connected, dedicated owner/runtime/observer clients. */
export interface RegisteredPgResourceProof {
  authorizationReference: string;
  runId: string;
  /** Full UUID of the owned resource; runId remains the 12-digit fixture key. */
  resourceRunId: string;
  databaseName: string;
  databaseOid: string;
  systemIdentifier: string;
  host: "127.0.0.1";
  port: number;
  ownerRole: string;
  runtimeRole: string;
  observerRole: string;
  sourceSealSha256: string;
  preparedSqlSha256: Record<string, string>;
  /** Driver verifies actual client TLS configuration/CA/SAN separately. This
   * declaration alone cannot prove certificate verification or its negatives. */
  transport: "isolated-loopback-tls-verify-full";
  application: {
    origin: string;
    databaseRole: string;
    sourceSealSha256: string;
    notificationAdapter: "disabled";
    fileStorage: "dedicated-private-local";
  };
}

export interface RegisteredPgExecutionContext {
  proof: RegisteredPgResourceProof;
  owner: PrismaClient;
  runtime: PrismaClient;
  observer: PrismaClient;
  /** Fresh synthetic password supplied by the future executor, never host env. */
  password: string;
  httpTimeoutMs: number;
}

/** Production-only continuity supplied by the source-bound executor. Tests
 * continue to enter through the original public run and owned fetch boundary. */
export interface RegisteredPgSeedContinuity {
  checkLight: () => void;
  fetch: typeof fetch;
}

export interface RegisteredPgFixturePlan {
  runId: string;
  paidAt: string;
  openingDate: string;
  ids: {
    actor: string; companyA: string; companyB: string;
    companyVersionA: string; companyVersionB: string;
    constructionEnterpriseParty: string; constructionEnterpriseVersion: string; constructionEnterpriseAssignment: string;
    project: string; contract: string; version: string; terms: string;
    settlement: string; payment: string; approvedRound: string; requestKey: string;
  };
  phone: string;
}

export interface PreparedRegisteredPgFixture {
  plan: RegisteredPgFixturePlan;
  /** Private in-memory credential; never include in the public case receipt. */
  accessToken: string;
  companyARegistrationId: string;
  companyBRegistrationId: string;
  companyBSourceId: string;
}

function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

export function describeRegisteredPgPreparation() {
  return {
    executed: false, sqlExecuted: false, resourceExecutorImplemented: false,
    fixtureVariant: "approved-settlement-project-unenabled-company-b-pays-a",
    approvalCoverage: "approved-state fixture only; no approval or notification acceptance",
    order: ["user/position", "companies/versions", "construction enterprise/own version", "project/current construction assignment", "contract/automatic marker", "effective version", "effective terms", "settlement", "payment", "approved round", "real HTTP login", "real HTTP balance openings"],
    unresolvedNativePreconditions: [
      "All governed migrations plus the exact seven prepared fragments must be installed by an authorized executor.",
      "The installed owner/runtime grants and prepared SQL have not been executed or validated.",
      "The approved-state seed does not exercise approval actions/signatures; stronger installed prerequisites must fail, never be bypassed.",
      "No fixture cleanup or database/container creation is implemented here."
    ]
  };
}

function assertFixtureDates(runId: string, paidAt: string, openingDate: string) {
  requireCondition(/^[a-f0-9]{12}$/.test(runId), "PG_PREPARATION_RUN_ID");
  for (const date of [paidAt, openingDate]) {
    requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 4) !== "0000", "PG_PREPARATION_DATE");
    const parsed = new Date(`${date}T00:00:00.000Z`);
    requireCondition(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, "PG_PREPARATION_DATE");
  }
  requireCondition(paidAt >= openingDate, "PG_PREPARATION_DATE_ORDER");
}

/** A pure description builder: dates are supplied explicitly, never inferred
 * from createdAt or the host clock. Generating fixture identities is not a DB write. */
export function buildRegisteredPgFixturePlan(runId: string, paidAt: string, openingDate: string): RegisteredPgFixturePlan {
  assertFixtureDates(runId, paidAt, openingDate);
  return {
    runId, paidAt, openingDate,
    phone: `199${(BigInt(`0x${runId}`) % 100000000n).toString().padStart(8, "0")}`,
    ids: {
      actor: randomUUID(), companyA: randomUUID(), companyB: randomUUID(),
      companyVersionA: randomUUID(), companyVersionB: randomUUID(),
      constructionEnterpriseParty: randomUUID(), constructionEnterpriseVersion: randomUUID(), constructionEnterpriseAssignment: randomUUID(),
      project: randomUUID(), contract: randomUUID(), version: randomUUID(), terms: randomUUID(),
      settlement: randomUUID(), payment: randomUUID(), approvedRound: randomUUID(), requestKey: randomUUID()
    }
  };
}

/** Structural checks are not user authorization. The future executor must also
 * possess and verify the actual resource/SQL approval identified by this proof. */
export function assertRegisteredPgResourceProof(proof: RegisteredPgResourceProof) {
  requireCondition(proof.authorizationReference.trim().length > 0, "PG_RESOURCE_AUTHORIZATION_REQUIRED");
  requireCondition(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(proof.resourceRunId), "PG_RESOURCE_RUN_ID");
  const resourceKey = proof.resourceRunId.replaceAll("-", "");
  requireCondition(proof.runId === resourceKey.slice(0, 12) && proof.databaseName === `jg_task01_${resourceKey}`, "PG_RESOURCE_DATABASE");
  requireCondition(/^[1-9][0-9]*$/.test(proof.databaseOid) && /^[1-9][0-9]*$/.test(proof.systemIdentifier), "PG_RESOURCE_EXPECTED_IDENTITY");
  requireCondition(proof.host === "127.0.0.1" && Number.isInteger(proof.port) && proof.port > 1024 && proof.port <= 65535 && proof.port !== 5432, "PG_RESOURCE_ENDPOINT");
  const roles = [proof.ownerRole, proof.runtimeRole, proof.observerRole];
  requireCondition(roles.every(role => typeof role === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(role)) && new Set(roles).size === 3, "PG_RESOURCE_ROLE_SEPARATION");
  requireCondition(/^[a-f0-9]{64}$/.test(proof.sourceSealSha256), "PG_RESOURCE_SOURCE_SEAL");
  const fragments = ["registered-funding.sql", "registered-history-revision.sql", "registered-write-authority.sql", "registered-canonical-proof.sql", "registered-intercompany.sql", "registered-canonical-adapter.sql", "registered-voucher.sql"];
  requireCondition(Object.keys(proof.preparedSqlSha256).sort().join("|") === [...fragments].sort().join("|") && fragments.every(file => /^[a-f0-9]{64}$/.test(proof.preparedSqlSha256[file] ?? "")), "PG_RESOURCE_INSTALLED_SQL_PROOF");
  requireCondition(proof.transport === "isolated-loopback-tls-verify-full", "PG_RESOURCE_TRANSPORT");
  const origin = new URL(proof.application.origin);
  requireCondition(origin.protocol === "http:" && origin.hostname === "127.0.0.1" && origin.port !== "" && origin.pathname === "/" && !origin.search && !origin.hash && !origin.username && !origin.password, "PG_RESOURCE_HTTP_ORIGIN");
  requireCondition(proof.application.databaseRole === proof.runtimeRole && proof.application.sourceSealSha256 === proof.sourceSealSha256 && proof.application.notificationAdapter === "disabled" && proof.application.fileStorage === "dedicated-private-local", "PG_RESOURCE_APPLICATION_PROOF");
}

export async function assertRegisteredPgConnectedRoles(context: RegisteredPgExecutionContext, continuity?: RegisteredPgSeedContinuity) {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  assertRegisteredPgResourceProof(context.proof);
  requireCondition(context.owner !== context.runtime && context.runtime !== context.observer && context.owner !== context.observer, "PG_RESOURCE_INDEPENDENT_CLIENTS");
  type Session = { database: string; effectiveRole: string; loginRole: string; databaseOid: string; systemIdentifier: string; pid: number; version: string; replication: string; tls: boolean; readOnly: string };
  const identities = await checked(() => Promise.all([context.owner, context.runtime, context.observer].map((client, index) =>
    client.$queryRawUnsafe<Session[]>(index === 0
      ? "SELECT pg_catalog.current_database() AS database,current_user::text AS \"effectiveRole\",session_user::text AS \"loginRole\",(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AS \"databaseOid\",(SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS \"systemIdentifier\",pg_catalog.pg_backend_pid() AS pid,pg_catalog.current_setting('server_version_num') AS version,pg_catalog.current_setting('session_replication_role') AS replication,coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false) AS tls,pg_catalog.current_setting('transaction_read_only') AS \"readOnly\""
      : "SELECT pg_catalog.current_database() AS database,current_user::text AS \"effectiveRole\",session_user::text AS \"loginRole\",(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AS \"databaseOid\",i.\"systemIdentifier\",pg_catalog.pg_backend_pid() AS pid,pg_catalog.current_setting('server_version_num') AS version,pg_catalog.current_setting('session_replication_role') AS replication,coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false) AS tls,pg_catalog.current_setting('transaction_read_only') AS \"readOnly\" FROM public.jg_task01_connection_identity() i WHERE i.\"loginRole\"=session_user AND i.\"databaseOid\"=(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AND i.\"backendPid\"=pg_catalog.pg_backend_pid() AND i.tls=coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false)"
    )
  )));
  const [owner, runtime, observer] = identities.map(rows => rows[0]);
  requireCondition(owner && runtime && observer && identities.every(rows => rows.length === 1), "PG_RESOURCE_IDENTITY");
  requireCondition([owner, runtime, observer].every(row => row.database === context.proof.databaseName && row.databaseOid === context.proof.databaseOid && row.systemIdentifier === context.proof.systemIdentifier && Number(row.version) >= 160000 && Number(row.version) < 170000 && row.replication === "origin" && row.tls === true), "PG_RESOURCE_DATABASE_VERSION");
  const expectedRoles = [context.proof.ownerRole, context.proof.runtimeRole, context.proof.observerRole];
  requireCondition([owner, runtime, observer].every((row, index) => row.effectiveRole === expectedRoles[index] && row.loginRole === expectedRoles[index] && Number.isInteger(row.pid) && row.pid > 0) && new Set([owner.pid, runtime.pid, observer.pid]).size === 3, "PG_RESOURCE_ROLE_PID_BINDING");
  requireCondition(observer.readOnly === "on", "PG_RESOURCE_OBSERVER_READ_ONLY");
  const roles = await checked(() => context.owner.$queryRawUnsafe<Array<{ role: string; unsafe: boolean; canWrite: boolean }>>(
    `SELECT r.rolname AS role,(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolinherit OR r.rolreplication OR r.rolbypassrls OR NOT r.rolcanlogin OR r.rolconnlimit<>1
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid)
      OR pg_catalog.pg_has_role(r.oid,o.oid,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE')
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r.oid)
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=r.oid)
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=r.oid)) AS unsafe,
      (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        AND (pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
          OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES'))))
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.oid<>pg_catalog.to_regprocedure('public.jg_task01_connection_identity()') AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))) AS "canWrite"
      FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_roles o ON o.rolname=$3 WHERE r.rolname IN ($1,$2) ORDER BY r.rolname`,
    context.proof.runtimeRole, context.proof.observerRole, context.proof.ownerRole
  ));
  requireCondition(roles.length === 2 && new Set(roles.map(role => role.role)).size === 2 && roles.every(role => [context.proof.runtimeRole, context.proof.observerRole].includes(role.role) && role.unsafe === false), "PG_RESOURCE_RUNTIME_PRIVILEGES");
  requireCondition(roles.find(role => role.role === context.proof.observerRole)?.canWrite === false, "PG_RESOURCE_OBSERVER_PRIVILEGES");
  const functions = await checked(() => context.owner.$queryRawUnsafe<Array<{ name: string; owner: string; definer: boolean; config: string[] | null }>>(
    "SELECT p.proname AS name,pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,p.proconfig AS config FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('jg_registered_history_read_revision','jg_registered_history_lock_revision','jg_registered_operating_scope_lock','jg_registered_payment_projection_deferred')"
  ));
  requireCondition(functions.length === 4 && new Set(functions.map(row => row.name)).size === 4 && functions.every(row => row.owner === context.proof.ownerRole && row.definer === (row.name !== "jg_registered_payment_projection_deferred") && row.config?.some(value => value.replace(/\s+/g, "") === "search_path=pg_catalog,public,pg_temp")), "PG_RESOURCE_PREPARED_FUNCTIONS");
  const triggers = await checked(() => context.owner.$queryRawUnsafe<Array<{ name: string; deferrable: boolean; deferred: boolean; enabled: string; kind: number; correctFunction: boolean }>>(
    "SELECT t.tgname AS name,t.tgdeferrable AS deferrable,t.tginitdeferred AS deferred,t.tgenabled AS enabled,t.tgtype::integer AS kind,t.tgfoid=pg_catalog.to_regprocedure('public.\"jg_registered_payment_projection_deferred\"()') AS \"correctFunction\" FROM pg_catalog.pg_trigger t WHERE (t.tgrelid='public.\"OperatingFact\"'::regclass AND t.tgname='OperatingFact_registered_payment_complete') OR (t.tgrelid='public.\"OperatingImpactEntry\"'::regclass AND t.tgname='OperatingImpactEntry_registered_payment_complete')"
  ));
  requireCondition(triggers.length === 2 && triggers.every(row => row.deferrable && row.deferred && ["O", "A"].includes(row.enabled) && row.kind === 5 && row.correctFunction), "PG_RESOURCE_PREPARED_PROJECTION_TRIGGERS");
  // Presence/configuration checks do not prove installed function-body hashes,
  // SQL correctness or the executor's approval. The installation receipt must
  // independently bind the seven exact source files before this is invoked.
  return { database: owner.database, ownerPid: owner.pid, runtimePid: runtime.pid, observerPid: observer.pid };
}

export async function registeredPgHttp(context: RegisteredPgExecutionContext, route: string, method: "GET" | "POST", body?: unknown, accessToken?: string, continuity?: RegisteredPgSeedContinuity) {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  assertRegisteredPgResourceProof(context.proof);
  requireCondition(route.startsWith("/") && !route.startsWith("//") && !route.includes("#"), "PG_RESOURCE_HTTP_ROUTE");
  requireCondition(Number.isInteger(context.httpTimeoutMs) && context.httpTimeoutMs > 0 && context.httpTimeoutMs <= 5000, "PG_RESOURCE_HTTP_BUDGET");
  const application = new URL(context.proof.application.origin);
  const target = new URL(route, application);
  requireCondition(target.origin === application.origin && !target.username && !target.password && !target.hash, "PG_RESOURCE_HTTP_TARGET_ORIGIN");
  if (continuity) requireCondition(method === "POST" && ["/auth/login", "/fund-accounts/openings"].includes(route), "PG_RESOURCE_SEED_HTTP_ROUTE");
  const transport = continuity ? continuity.fetch : fetch;
  requireCondition(typeof transport === "function", "PG_RESOURCE_HTTP_TRANSPORT");
  light();
  const response = await checked(() => transport(target, {
    method, redirect: "error", signal: AbortSignal.timeout(context.httpTimeoutMs),
    headers: { "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }));
  const status = response.status, json = response.json;
  requireCondition(typeof json === "function", "PG_RESOURCE_HTTP_RESPONSE");
  if (continuity) {
    const responseUrl = response.url, redirected = response.redirected;
    requireCondition(responseUrl === target.href && redirected === false, "PG_RESOURCE_HTTP_RESPONSE_ORIGIN");
  }
  light();
  return { status, body: await checked(() => json.call(response)) as unknown };
}

/** Executes nothing unless explicitly called with already connected resources.
 * No SQL installation, client construction, resource creation or cleanup here. */
export async function seedRegisteredPgFixture(context: RegisteredPgExecutionContext, plan: RegisteredPgFixturePlan, continuity?: RegisteredPgSeedContinuity): Promise<PreparedRegisteredPgFixture> {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  let ownerAttempted = false;
  try {
    light();
    // Snapshot caller input before any await. This fixture never refreshes an
    // altered plan into a new baseline after session/owner work has started.
    plan = structuredClone(plan);
    assertFixtureDates(plan.runId, plan.paidAt, plan.openingDate);
    const identityKeys: Array<keyof RegisteredPgFixturePlan["ids"]> = [
      "actor", "companyA", "companyB", "companyVersionA", "companyVersionB", "constructionEnterpriseParty",
      "constructionEnterpriseVersion", "constructionEnterpriseAssignment", "project", "contract", "version", "terms",
      "settlement", "payment", "approvedRound", "requestKey"
    ];
    requireCondition(Object.keys(plan.ids).length === 16 && identityKeys.every(key => typeof plan.ids[key] === "string"
      && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(plan.ids[key]))
      && new Set(identityKeys.map(key => plan.ids[key])).size === 16, "PG_FIXTURE_IDENTITIES");
    await checked(() => assertRegisteredPgConnectedRoles(context, continuity));
    requireCondition(plan.runId === context.proof.runId && context.password.length >= 12, "PG_FIXTURE_INPUT");
    const bcrypt = await checked(() => import("bcryptjs"));
    const { assertValidUnifiedSocialCreditCode } = await checked(() => import("../company-entity/unified-social-credit-code"));
    const passwordHash = await checked(() => bcrypt.hash(context.password, 12));
    const ids = plan.ids;
    ownerAttempted = true;
    await checked(() => context.owner.$transaction(async tx => {
      await checked(() => tx.user.create({ data: { id: ids.actor, phone: plan.phone, name: `PG合成财务${plan.runId}`, passwordHash, isActive: true, mustChangePassword: false } }));
      const position = await checked(() => tx.position.findUnique({ where: { key: "finance_staff" } })) ?? await checked(() => tx.position.create({ data: { key: "finance_staff", name: "财务人员" } }));
      await checked(() => tx.userPosition.create({ data: { userId: ids.actor, positionId: position.id, projectId: null } }));
      for (const [id, versionId, suffix, creditCode] of [[ids.companyA, ids.companyVersionA, "AA", "91350211M000100Y46"], [ids.companyB, ids.companyVersionB, "BB", "91440300708461136T"]] as const) {
        const name = `PG合成公司${suffix}${plan.runId}`;
        // Reuse the repository's two checksum-valid unit-test vectors. They
        // identify no real business here; this is one dedicated fixture DB.
        const code = assertValidUnifiedSocialCreditCode(creditCode);
        await checked(() => tx.companyEntity.create({ data: { id, name, unifiedSocialCreditCode: code, dataStatus: "complete", currentVersionNo: 1, isActive: true } }));
        await checked(() => tx.companyEntityVersion.create({ data: { id: versionId, companyEntityId: id, versionNo: 1, name, unifiedSocialCreditCode: code, isActive: true, action: "create", actorUserId: ids.actor } }));
      }
      const constructionName = `T16施工企业${plan.runId}`;
      const formalSeedInstant = new Date(`${plan.openingDate}T00:00:00.000Z`);
      const constructionParty = await checked(() => tx.businessParty.create({ data: {
        id: ids.constructionEnterpriseParty, type: "organization", name: constructionName,
        normalizedName: constructionName, unifiedSocialCreditCode: null, status: "active", createdByUserId: ids.actor
      } }));
      const constructionVersion = await checked(() => tx.businessPartyVersion.create({ data: {
        id: ids.constructionEnterpriseVersion, businessPartyId: ids.constructionEnterpriseParty, versionNo: 1,
        snapshot: { type: "organization", name: constructionName, attachments: [] }, createdByUserId: ids.actor
      } }));
      requireCondition(constructionParty.id === ids.constructionEnterpriseParty && constructionParty.type === "organization"
        && constructionParty.status === "active" && constructionParty.name === constructionName
        && constructionParty.normalizedName === constructionName && constructionParty.unifiedSocialCreditCode === null
        && constructionVersion.id === ids.constructionEnterpriseVersion && constructionVersion.businessPartyId === constructionParty.id
        && constructionVersion.versionNo === 1 && constructionVersion.snapshot !== null && typeof constructionVersion.snapshot === "object"
        && !Array.isArray(constructionVersion.snapshot) && constructionVersion.snapshot.name === constructionName, "PG_FIXTURE_CONSTRUCTION_PARTY");
      await checked(() => tx.project.create({ data: { id: ids.project, code: `T16-${plan.runId}-P`, name: `PG合成项目${plan.runId}`, isActive: true, operatingLedgerEffectiveDate: null } }));
      await checked(() => tx.projectAffiliateAssignment.create({ data: {
        id: ids.constructionEnterpriseAssignment, projectId: ids.project,
        businessPartyId: constructionParty.id, businessPartyVersionId: constructionVersion.id,
        affiliateNameSnapshot: constructionName, affiliateCreditCodeSnapshot: null,
        effectiveFrom: formalSeedInstant, endedAt: null, changeReason: "Task16隔离合成前置", assignedByUserId: ids.actor
      } }));
      const assignments = await checked(() => tx.projectAffiliateAssignment.findMany({ where: { projectId: ids.project, endedAt: null } }));
      const assignment = assignments[0];
      requireCondition(assignments.length === 1 && assignment?.id === ids.constructionEnterpriseAssignment
        && assignment.projectId === ids.project && assignment.businessPartyId === constructionParty.id
        && assignment.businessPartyVersionId === constructionVersion.id && assignment.affiliateNameSnapshot === constructionName
        && assignment.affiliateCreditCodeSnapshot === null && assignment.endedAt === null
        && assignment.effectiveFrom.getTime() === formalSeedInstant.getTime() && assignment.assignedByUserId === ids.actor,
      "PG_FIXTURE_CONSTRUCTION_ASSIGNMENT");
      const company = await checked(() => tx.companyEntity.findUniqueOrThrow({ where: { id: ids.companyA } }));
      await checked(() => tx.contract.create({ data: { id: ids.contract, projectId: ids.project, code: `T16-${plan.runId}-HT`, name: "PG合成材料合同", counterparty: "PG合成供应商", contractTypeKey: "material_purchase", companyEntityId: ids.companyA, companyEntityName: company.name, ownerUserId: ids.actor } }));
      const marker = await checked(() => tx.registeredContractHistoryRevision.findUnique({ where: { contractId: ids.contract } }));
      requireCondition(marker?.revision === 0n, "PG_FIXTURE_AUTOMATIC_HISTORY_MARKER_REQUIRED");
      await checked(() => tx.contractVersion.create({ data: { id: ids.version, contractId: ids.contract, versionNo: 1, changeType: "original", status: "effective", effectiveAt: formalSeedInstant, amountCents: 10000n, signingSubjectType: "our_company", companyEntityIdSnapshot: company.id, companyEntityVersionId: ids.companyVersionA, companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: company.unifiedSocialCreditCode, draftData: {}, templateSnapshot: {}, clauseSnapshot: {} } }));
      await checked(() => tx.paymentTermsVersion.create({ data: { id: ids.terms, contractId: ids.contract, contractVersionId: ids.version, versionNo: 1, status: "effective", originalText: "按已确认结算分次付款" } }));
      await checked(() => tx.settlement.create({ data: { id: ids.settlement, projectId: ids.project, contractId: ids.contract, contractVersionId: ids.version, paymentTermsVersionId: ids.terms, code: `T16-${plan.runId}-JS`, periodLabel: "合成第一期", status: "effective", createdAt: formalSeedInstant, amountCents: 10000n, payableAmountCents: 10000n, paidAmountCents: 0n } }));
      await checked(() => tx.paymentRequest.create({ data: { id: ids.payment, projectId: ids.project, settlementId: ids.settlement, sourceType: "settlement", contractId: ids.contract, contractVersionId: ids.version, paymentTermsVersionId: ids.terms, code: `T16-${plan.runId}-FK`, status: "approved_pending_payment", requestedAmountCents: 10000n, approvedAmountCents: 10000n, paidAmountCents: 0n, paymentSubjectType: "our_company" } }));
      // This is an explicitly pre-approved state fixture, not a simulated review
      // action or a claim that approval/signature/notification paths were tested.
      await checked(() => tx.approvalInstance.create({ data: { id: ids.approvedRound, flowType: "payment.approve", businessType: "payment_request", businessId: ids.payment, status: "approved", currentNodeIndex: 0, frozenNodes: [], applicantUserId: ids.actor } }));
    }, { isolationLevel: "Serializable" }));
    const login = await checked(() => registeredPgHttp(context, "/auth/login", "POST", { phone: plan.phone, password: context.password }, undefined, continuity));
    const auth = login.body as { tokens?: { accessToken?: unknown } };
    requireCondition(login.status === 201 && typeof auth.tokens?.accessToken === "string", "PG_FIXTURE_REAL_HTTP_LOGIN");
    const accessToken = auth.tokens.accessToken;
    const registrations: Array<{ id: string; sources: Array<{ id: string }> }> = [];
    for (const companyId of [ids.companyA, ids.companyB]) {
      const response = await checked(() => registeredPgHttp(context, "/fund-accounts/openings", "POST", {
        scopeKey: `company:${companyId}`, balanceYuan: "100", asOfDate: plan.openingDate,
        evidenceReference: "隔离PG合成期初核对", reconciliationNote: "项目来源明确，不新增收入", reason: "合成期初",
        idempotencyKey: `opening-${plan.runId}-${companyId}`,
        sources: [{ amountYuan: "100", sourceStatus: "known", sourceName: "合成已知项目资金", projectStatus: "project", projectId: ids.project }]
      }, accessToken, continuity));
      const registration = response.body as { id?: unknown; sources?: Array<{ id: string }> };
      requireCondition(response.status === 201 && typeof registration.id === "string" && registration.sources?.length === 1 && typeof registration.sources[0]?.id === "string", "PG_FIXTURE_REAL_HTTP_OPENING");
      registrations.push({ id: registration.id, sources: registration.sources });
    }
    return { plan, accessToken, companyARegistrationId: registrations[0]!.id, companyBRegistrationId: registrations[1]!.id, companyBSourceId: registrations[1]!.sources[0]!.id };
  } catch {
    // A rejected/unknown owner transaction or later HTTP write is never proof
    // of rollback. Do not retain raw SDK/HTTP errors, credentials or causes.
    throw Object.assign(new Error("TASK16_FIXTURE_FAILED_CLOSED"), {
      code: "TASK16_FIXTURE_FAILED_CLOSED",
      fixtureOutcome: ownerAttempted ? "UNKNOWN_DO_NOT_RETRY" : "NOT_ATTEMPTED"
    });
  }
}
