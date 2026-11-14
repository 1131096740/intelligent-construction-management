import { Prisma } from "@prisma/client";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { types } from "node:util";
import { AuditService } from "../audit/audit.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { PrismaService } from "./prisma.service";

const expectedRoles = {
  template: "jg_c259_doc_template",
  worker: "jg_c259_doc_worker",
  queue: "jg_c259_doc_queue"
} as const;
const roleSlots = ["template", "worker", "queue"] as const;
const attempted = new WeakSet<PrismaService>();
type Connections = Readonly<Record<typeof roleSlots[number], PrismaService>>;
type Expected = Readonly<{ database: string; databaseOid: string; namespaceOid: string; storageRoot: string;
  roleOids: Readonly<Record<typeof roleSlots[number], string>> }>;

interface Identity {
  role: string;
  sessionRole: string;
  roleOid: string;
  backendPid: number;
  backendStart: string;
  database: string;
  databaseOid: string;
  namespaceOid: string;
  clientAddress: string;
  serverAddress: string;
  serverPort: number;
  ssl: boolean;
}
const identitySql = Prisma.sql`
  SELECT current_user::pg_catalog.text AS role, session_user::pg_catalog.text AS "sessionRole",
    current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "roleOid",
    pg_catalog.pg_backend_pid() AS "backendPid",
    pg_catalog.to_char(pg_catalog.timezone('UTC'::pg_catalog.text,a.backend_start),
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "backendStart",
    pg_catalog.current_database() AS database,
    (SELECT d.oid::pg_catalog.text FROM pg_catalog.pg_database d
      WHERE d.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()) AS "databaseOid",
    pg_catalog.to_regnamespace('public')::pg_catalog.oid::pg_catalog.text AS "namespaceOid",
    pg_catalog.host(pg_catalog.inet_client_addr()) AS "clientAddress",
    pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress",
    pg_catalog.inet_server_port() AS "serverPort",
    EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl s
      WHERE s.pid OPERATOR(pg_catalog.=) pg_catalog.pg_backend_pid() AND s.ssl) AS ssl
  FROM pg_catalog.pg_stat_activity a WHERE a.pid OPERATOR(pg_catalog.=) pg_catalog.pg_backend_pid()
`;

function fault(stage: string, cause?: unknown) {
  const code = "TASK12_DOCUMENT_ROLE_" + stage;
  return Object.assign(new Error(code, { cause }), { code });
}
function requireScope(condition: unknown, stage: string): asserts condition {
  if (!condition) throw fault(stage);
}

// Await adopts a Promise subclass through then. Keep the internal drain
// separate from the caller observing the operation's result.
class ScopedOperation<T> extends Promise<T> {
  static get [Symbol.species]() { return Promise; }

  constructor(result: Promise<T>, private readonly observe: () => void) {
    super((resolve, reject) => { void result.then(resolve, reject); });
  }

  override then<A = T, B = never>(
    fulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    rejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): Promise<A | B> {
    this.observe();
    return super.then(fulfilled, rejected);
  }
}
function oid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && BigInt(value) <= 0xffffffffn;
}
function privateRoot(root: string) {
  try {
    requireScope(isAbsolute(root) && realpathSync(root) === root &&
      process.env.FILE_STORAGE_DRIVER === "local" && process.env.FILE_STORAGE_ROOT === root, "STORAGE");
    const stat = lstatSync(root);
    requireScope(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "STORAGE");
    return [stat.dev, stat.ino, stat.uid, stat.mode].join("/");
  } catch {
    requireScope(false, "STORAGE");
  }
}

interface DocumentOperations {
  template: Pick<LayoutTemplateService, "publishVersion" | "sourcePositions">;
  worker: Pick<ContractDocumentProcessor, "processNext">;
  queue: Pick<ContractDocumentService, "queueDraftPreview">;
}

/** Fixed operations over pre-owned connections. The caller retains the native admission gate. */
export function withTask12DocumentRoleServices<T>(
  connections: Connections, expected: Expected, use: (operations: DocumentOperations) => Promise<T>
): Promise<T> {
  return runRoleServices(connections, expected, operations => use(operations), true);
}

/** The fixed native issuer keeps disconnect and relay-drain ownership. */
export function withTask12PreownedDocumentRoleServices<T>(
  connections: Connections, expected: Expected, use: (operations: DocumentOperations) => Promise<T>
): Promise<T> {
  return runRoleServices(connections, expected, operations => use(operations), false);
}

type DocumentNestProviders = Readonly<{ storage: PrivateFileStorage; template: LayoutTemplateService; worker: ContractDocumentProcessor }>;

/** Invoked only by the fixed native scope, which owns the Nest and pool lifecycles. */
export function withTask12NestDocumentRoleServices<T>(
  connections: Connections, expected: Expected,
  use: (operations: DocumentOperations, providers: DocumentNestProviders) => Promise<T>
): Promise<T> {
  return runRoleServices(connections, expected, use, false);
}

async function runRoleServices<T>(
  connections: Connections, expected: Expected,
  use: (operations: DocumentOperations, providers: DocumentNestProviders) => Promise<T>,
  disconnectInScope: boolean
): Promise<T> {
  requireScope(connections && typeof connections === "object" && !types.isProxy(connections) &&
    expected && typeof expected === "object" && !types.isProxy(expected) &&
    expected.roleOids && typeof expected.roleOids === "object" && !types.isProxy(expected.roleOids), "INPUT");
  const clients = roleSlots.map(role => Object.getOwnPropertyDescriptor(connections, role)?.value as PrismaService);
  requireScope(new Set(clients).size === roleSlots.length && clients.every(client => client &&
    typeof client.$queryRaw === "function" && typeof client.$disconnect === "function"), "CONNECTIONS");
  requireScope(/^jg_task01_[a-f0-9]{32}$/u.test(expected.database) && oid(expected.databaseOid) &&
    oid(expected.namespaceOid) && typeof use === "function", "INPUT");
  const roleOids = roleSlots.map(role => Object.getOwnPropertyDescriptor(expected.roleOids, role)?.value);
  requireScope(new Set(roleOids).size === roleSlots.length &&
    roleOids.every(value => oid(value) && value !== "10"), "INPUT");
  requireScope(clients.every(client => !attempted.has(client)), "REPLAY");
  clients.forEach(client => attempted.add(client));
  const { database, databaseOid, namespaceOid, storageRoot } = expected;
  const methods = clients.map(client => ({ query: client.$queryRaw, disconnect: client.$disconnect }));
  let worker: ContractDocumentProcessor | undefined;
  let active = false;
  let rootIdentity: string;
  const operations: Array<{ result: Promise<unknown>; settled: boolean; observed: boolean }> = [];
  const checkStorage = () => requireScope(privateRoot(storageRoot) === rootIdentity, "STORAGE");
  const observe = async () => {
    checkStorage();
    const identities = [];
    for (const [index, client] of clients.entries()) {
      const role = expectedRoles[roleSlots[index]];
      requireScope(client.$queryRaw === methods[index].query && client.$disconnect === methods[index].disconnect, "CONNECTIONS");
      const rows = await methods[index].query.call(client, identitySql) as Identity[];
      const row = rows?.[0];
      requireScope(rows?.length === 1 && row && row.role === role && row.sessionRole === role &&
        row.roleOid === roleOids[index] && Number.isInteger(row.backendPid) && row.backendPid > 0 &&
        typeof row.backendStart === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.backendStart) &&
        Number.isFinite(Date.parse(row.backendStart)) &&
        row.database === database && row.databaseOid === databaseOid && row.namespaceOid === namespaceOid &&
        row.clientAddress === "127.0.0.1" && row.serverAddress === "127.0.0.1" &&
        row.serverPort === 5432 && row.ssl === true, "IDENTITY");
      identities.push([row.roleOid, row.backendPid, row.backendStart] as const);
    }
    requireScope(new Set(identities.map(row => row[0])).size === clients.length &&
      new Set(identities.map(row => row[1])).size === clients.length, "IDENTITY");
    checkStorage();
    return JSON.stringify(identities);
  };
  const operate = <Result>(call: () => Promise<Result>) => {
    requireScope(active, "CLOSED");
    checkStorage();
    const result = call();
    const operation = { result, settled: false, observed: false };
    operations.push(operation);
    const settle = () => { operation.settled = true; };
    void result.then(settle, settle);
    const exposed = new ScopedOperation(result, () => { operation.observed = true; });
    // Suppress the process-level rejection only. The scope still sees the
    // original result and rejects detached work after draining it.
    void Promise.prototype.then.call(exposed, undefined, () => undefined);
    return exposed;
  };
  let value!: T;
  let first: string | undefined;
  let failed = false;
  let failure: unknown;
  try {
    rootIdentity = privateRoot(storageRoot);
    first = await observe();
    const storage = new PrivateFileStorage();
    storage.assertConfigured();
    const [templateClient, workerClient, queueClient] = clients;
    const files = (client: PrismaService) => new FileService(client, new AuditService(client), storage);
    const template = new LayoutTemplateService(templateClient, new AuditService(templateClient), files(templateClient));
    const processor = new ContractDocumentProcessor(workerClient, files(workerClient), new AuditService(workerClient));
    worker = processor;
    const queue = new ContractDocumentService(queueClient, new AuditService(queueClient), files(queueClient));
    active = true;
    value = await use(Object.freeze({
      template: Object.freeze({
        publishVersion: (...args: Parameters<LayoutTemplateService["publishVersion"]>) =>
          operate(() => template.publishVersion(...args)),
        sourcePositions: (...args: Parameters<LayoutTemplateService["sourcePositions"]>) =>
          operate(() => template.sourcePositions(...args))
      }),
      worker: Object.freeze({ processNext: () => operate(() => processor.processNext()) }),
      queue: Object.freeze({ queueDraftPreview: (...args: Parameters<ContractDocumentService["queueDraftPreview"]>) =>
        operate(() => queue.queueDraftPreview(...args)) })
    }), Object.freeze({ storage, template, worker: processor }));
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    active = false;
  }
  const detached = operations.filter(operation => !operation.settled || !operation.observed);
  const scopeViolation = detached.some(operation => !operation.settled)
    ? "OPERATIONS_INCOMPLETE" : detached.length ? "OPERATIONS_UNOBSERVED" : undefined;
  try {
    await worker?.onApplicationShutdown();
  } catch (shutdown) {
    const cause = failed ? failure : scopeViolation ? fault(scopeViolation, shutdown) : shutdown;
    throw Object.assign(fault("CLEANUP_UNKNOWN", cause), { appCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" });
  }
  const drained = await Promise.allSettled(operations.map(operation => operation.result));
  if (!failed && scopeViolation) {
    const rejected = drained.find((result, index) => result.status === "rejected" && detached.includes(operations[index]));
    failed = true;
    failure = fault(scopeViolation, rejected?.status === "rejected" ? rejected.reason : undefined);
  }
  if (!failed) {
    try { requireScope(await observe() === first, "IDENTITY"); }
    catch (error) { failed = true; failure = error; }
  }
  if (disconnectInScope) {
    const closed = await Promise.allSettled(clients.map((client, index) =>
      Promise.resolve().then(() => methods[index].disconnect.call(client))));
    if (closed.some(result => result.status === "rejected")) {
      throw Object.assign(fault("CLEANUP_UNKNOWN", failure), { appCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" });
    }
  }
  if (failed) throw failure;
  return value;
}
