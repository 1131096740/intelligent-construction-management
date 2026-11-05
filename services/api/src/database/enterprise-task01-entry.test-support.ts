import type { PrismaClient } from "@prisma/client";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export type Task01EntryContext = Readonly<{
  schemaVersion: 1;
  runId: string;
  databaseOid: string;
  systemIdentifier: string;
  actor: { phone: string; password: string };
}>;

type ConnectionIdentity = {
  effectiveRole: string;
  loginRole: string;
  databaseOid: string;
  systemIdentifier: string;
  backendPid: number;
  tls: boolean;
  readOnly: string;
};

// This is an input contract for a future, separately authorised resource driver.
// Its presence is not an approval token and does not prove ACL/TLS admission.
export function loadTask01EntryContext(): Task01EntryContext {
  if (process.env.NODE_ENV !== "test" || process.env.DATABASE_OWNER_URL || process.env.JG_TASK01_OWNER_DATABASE_URL) {
    throw new Error("任务01运行进程不得持有owner连接");
  }
  const file = process.env.JG_TASK01_ENTRY_CONTEXT_FILE;
  if (!file || !file.startsWith("/private/tmp/")) throw new Error("任务01缺少专属输入文件");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 16_384 || realpathSync(file) !== resolve(file)) {
    throw new Error("任务01输入文件身份或权限不符合要求");
  }
  let value: Task01EntryContext;
  try { value = JSON.parse(readFileSync(file, "utf8")) as Task01EntryContext; }
  catch { throw new Error("任务01输入文件不是有效合同"); }
  if (!value || typeof value !== "object") throw new Error("任务01输入合同不完整");
  if (value.schemaVersion !== 1 || !/^[a-f0-9]{32}$/u.test(value.runId) || !/^\d+$/u.test(value.databaseOid) || !/^\d+$/u.test(value.systemIdentifier)
    || typeof value.actor?.phone !== "string" || typeof value.actor?.password !== "string" || value.actor.password.length < 32) {
    throw new Error("任务01输入合同不完整");
  }
  for (const [key, role] of [["DATABASE_URL", "jg_task01_runtime"], ["JG_TASK01_OBSERVER_DATABASE_URL", "jg_task01_observer"]] as const) {
    const raw = process.env[key];
    if (!raw) throw new Error("任务01缺少独立受限连接");
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("任务01连接格式不符合要求"); }
    const keys = [...url.searchParams.keys()];
    const allowed = ["schema", "connection_limit", "sslmode", "sslaccept", "sslcert", "application_name", "connect_timeout", "pool_timeout", "options"];
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port || url.username !== role || !url.password
      || url.pathname !== `/jg_task01_${value.runId}` || url.searchParams.get("connection_limit") !== "1"
      || (url.searchParams.get("schema") ?? "public") !== "public"
      || url.searchParams.get("sslmode") !== "require" || url.searchParams.get("sslaccept") !== "strict"
      || !url.searchParams.get("sslcert") || url.hash || new Set(keys).size !== keys.length || keys.some(key => !allowed.includes(key))) {
      throw new Error("任务01连接不符合单池、专库或严格TLS边界");
    }
  }
  if (process.env.FILE_STORAGE_DRIVER !== "local" || process.env.APPROVAL_SMS_ENABLED !== "false") {
    throw new Error("任务01必须使用本地文件适配器且关闭真实短信");
  }
  return value;
}

export async function task01ConnectionIdentity(client: PrismaClient): Promise<ConnectionIdentity> {
  const rows = await client.$queryRaw<ConnectionIdentity[]>`
    SELECT current_user::text AS "effectiveRole", i."loginRole", i."databaseOid", i."systemIdentifier", i."backendPid", i.tls,
           current_setting('transaction_read_only') AS "readOnly"
      FROM public.jg_task01_connection_identity() AS i`;
  if (rows.length !== 1) throw new Error("任务01实际连接身份无法唯一核实");
  return rows[0]!;
}

export async function verifyTask01Connection(client: PrismaClient, context: Task01EntryContext, role: "jg_task01_runtime" | "jg_task01_observer") {
  const identity = await task01ConnectionIdentity(client);
  if (identity.effectiveRole !== role || identity.loginRole !== role || identity.databaseOid !== context.databaseOid
    || identity.systemIdentifier !== context.systemIdentifier || !identity.tls || !Number.isInteger(identity.backendPid)
    || (role === "jg_task01_observer" && identity.readOnly !== "on")) {
    throw new Error("任务01实际连接身份、只读状态或TLS不匹配");
  }
  const flags = await client.$queryRaw<Array<{ unsafe: boolean; memberships: number }>>`
    SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AS unsafe,
           (SELECT count(*)::integer FROM pg_catalog.pg_auth_members WHERE member = r.oid) AS memberships
      FROM pg_catalog.pg_roles AS r WHERE rolname = current_user`;
  if (flags.length !== 1 || flags[0]!.unsafe || flags[0]!.memberships !== 0) {
    throw new Error("任务01受限角色存在高权标志或成员关系");
  }
}
