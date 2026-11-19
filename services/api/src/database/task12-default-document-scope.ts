import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { FileService } from "../file/file.service";
import { PrismaService } from "./prisma.service";

type Providers = Readonly<{ client: PrismaService; audit: AuditService; files: FileService; template: LayoutTemplateService; queue: ContractDocumentService; worker: ContractDocumentProcessor }>;
type Expected = Readonly<{ database: string; databaseOid: string; namespaceOid: string; roleOid: string; role: string; serverPort: number }>;
export type Task12DefaultIdentity = { database: string; databaseOid: string; namespaceOid: string; ownerOid: string; roleOid: string; role: string; sessionRole: string; pid: number; start: string; clientAddress: string; serverAddress: string; serverPort: number; tls: boolean; restricted: boolean };
const own = (value: object, name: string) => Object.getOwnPropertyDescriptor(value, name)?.value;
function requireScope(condition: unknown): asserts condition {
  if (!condition) throw Object.assign(new Error("TASK12_DEFAULT_DOCUMENT_SCOPE"), { code: "TASK12_DEFAULT_DOCUMENT_SCOPE" });
}
const identitySql = Prisma.sql`
  SELECT current_database() AS database, d.oid::text AS "databaseOid", to_regnamespace('public')::oid::text AS "namespaceOid",
    d.datdba::text AS "ownerOid", current_user::regrole::oid::text AS "roleOid", current_user::text AS role,
    session_user::text AS "sessionRole", pg_backend_pid() AS pid,
    to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start,
    host(inet_client_addr()) AS "clientAddress", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort",
    s.ssl AS tls, r.rolcanlogin AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT has_schema_privilege(r.oid,'public','CREATE') AS restricted
  FROM pg_catalog.pg_database d JOIN pg_catalog.pg_stat_activity a ON a.pid=pg_backend_pid()
    JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid JOIN pg_catalog.pg_roles r ON r.oid=current_user::regrole
  WHERE d.datname=current_database()`;

/** Test-only purpose: accepts genuine Nest providers, observes the same restricted application role before and after use. */
export async function withTask12DefaultDocumentScope<T>(providers: Providers, expected: Expected,
  use: (providers: Providers) => Promise<T>, verifySession?: (identity: Readonly<Task12DefaultIdentity>) => Promise<void>): Promise<T> {
  const { client, audit, files, template, queue, worker } = providers;
  requireScope(client instanceof PrismaService && audit instanceof AuditService && files instanceof FileService &&
    template instanceof LayoutTemplateService && queue instanceof ContractDocumentService && worker instanceof ContractDocumentProcessor &&
    [audit, files, template, queue, worker].every(value => own(value, "prisma") === client) &&
    [template, queue, worker].every(value => own(value, "files") === files) && typeof use === "function" &&
    /^jg_task01_[a-f0-9]{32}$/u.test(expected.database) && /^jg_fixture_app_[a-f0-9]{24}$/u.test(expected.role) &&
    /^[1-9][0-9]*$/u.test(expected.databaseOid) && /^[1-9][0-9]*$/u.test(expected.namespaceOid) &&
    /^[1-9][0-9]*$/u.test(expected.roleOid) && Number.isInteger(expected.serverPort) && expected.serverPort > 1024 && expected.serverPort <= 65535 && expected.serverPort !== 5432);
  const observe = async () => {
    const rows = await client.$queryRaw<Task12DefaultIdentity[]>(identitySql);
    const row = rows.length === 1 ? rows[0] : undefined;
    requireScope(row && row.database === expected.database && row.databaseOid === expected.databaseOid && row.namespaceOid === expected.namespaceOid &&
      row.roleOid === expected.roleOid && row.roleOid !== row.ownerOid && row.role === expected.role && row.sessionRole === expected.role &&
      Number.isSafeInteger(row.pid) && row.pid > 0 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.start) &&
      row.clientAddress === "127.0.0.1" && row.serverAddress === "127.0.0.1" && row.serverPort === expected.serverPort && row.tls === true && row.restricted === true);
    if (verifySession) await verifySession(Object.freeze({ ...row }));
  };
  await observe();
  const result = await use(providers);
  await observe();
  return result;
}
