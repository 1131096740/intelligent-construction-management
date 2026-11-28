import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { isOwned280ContractDatabase } from "./task12-owned-280.test-support";

type Scope = "procurement" | "project";
const runtimeRole = { procurement: "general_procurement_runtime", project: "project_business_scope_runtime" };

export function ownedProcurementDatabase(target: URL, scope: Scope, owner?: URL): boolean {
  if (process.env.JG_PROCUREMENT_OWNED_SCOPE === undefined) return false;
  const run = process.env.JG_PROCUREMENT_OWNED_RUN_ID ?? "";
  if (process.env.JG_PROCUREMENT_OWNED_SCOPE !== scope || process.env.NODE_ENV !== "test" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(run) ||
      target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" || !target.port ||
      target.pathname !== "/jg_task01_" + run.replaceAll("-", "") || target.username !== runtimeRole[scope] ||
      !target.password || target.hash || target.searchParams.getAll("sslmode").join(",") !== "require" ||
      target.searchParams.getAll("sslaccept").join(",") !== "strict" ||
      !/^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(target.searchParams.get("sslcert") ?? "") ||
      (scope === "project" && (!owner || !isOwned280ContractDatabase(owner) || target.protocol !== owner.protocol || target.host !== owner.host ||
        target.pathname !== owner.pathname || target.search !== owner.search || target.password === owner.password))) {
    throw new Error("PROCUREMENT_OWNED_URL");
  }
  return true;
}

export async function assertOwnedProcurementRuntime(db: PrismaClient, scope: Scope, target: URL) {
  if (!process.env.JG_PROCUREMENT_OWNED_SCOPE) return;
  const role = runtimeRole[scope];
  const run = process.env.JG_PROCUREMENT_OWNED_RUN_ID!.replaceAll("-", "");
  const [observed] = await db.$queryRaw<Array<{ accepted: boolean }>>`
    SELECT current_database() = ${target.pathname.slice(1)}
      AND current_setting('jg.procurement_run_id', true) = ${run}
      AND current_user = ${role} AND session_user = current_user
      AND inet_client_addr() = '127.0.0.1'::inet AND inet_server_addr() = '127.0.0.1'::inet
      AND inet_server_port() = ${Number(target.port)}::int
      AND EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
      AND EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname=current_user
        AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
      AND NOT has_any_column_privilege(current_user, 'public._prisma_migrations', 'SELECT')
      AND NOT has_function_privilege(current_user, 'public.jg_project_owner_settlement_voucher_bound(text)', 'EXECUTE')
      AND has_table_privilege(current_user, 'public."GeneralProcurement"', 'INSERT')
      AND NOT has_table_privilege(current_user, 'public."GeneralProcurement"', 'DELETE') AS accepted
  `;
  if (!observed?.accepted) throw new Error("PROCUREMENT_OWNED_RUNTIME_IDENTITY");
}

export function procurementOwnedBrowserRoot(original: string): string {
  if (process.env.JG_PROCUREMENT_OWNED_SCOPE === undefined) return original;
  const storage = process.env.FILE_STORAGE_ROOT;
  const web = process.env.JG_PROCUREMENT_OWNED_WEB_ROOT;
  if (!storage || !web || web !== path.join(path.dirname(realpathSync(storage)), "apps", "web-admin") || realpathSync(web) !== web) {
    throw new Error("PROCUREMENT_OWNED_BROWSER_ROOT");
  }
  return web;
}

export async function assertOwnedProjectFixtureOwner(db: PrismaClient, owner: URL) {
  if (!process.env.JG_PROCUREMENT_OWNED_SCOPE) return;
  const [observed] = await db.$queryRaw<Array<{ accepted: boolean }>>`
    SELECT current_database() = ${owner.pathname.slice(1)}
      AND current_user='jg_task01_owner' AND current_user=session_user AND current_user::regrole::oid=10
      AND EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=10)
      AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet
      AND inet_server_port()=${Number(owner.port)}::int
      AND EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS accepted
  `;
  if (!observed?.accepted) throw new Error("PROCUREMENT_OWNED_FIXTURE_OWNER");
}
