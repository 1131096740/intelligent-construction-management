import { createHash, randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import { Prisma } from "@prisma/client";

type Row = Record<string, unknown>;
type Args = { where?: Row; data?: Row; orderBy?: Row; include?: Row };
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some(branch => matches(row, branch));
    if (key === "AND") return (value as Row[]).every(branch => matches(row, branch));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const condition = value as Row;
      if (Array.isArray(condition.path) && "equals" in condition) return condition.path.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Row)[String(key)] : undefined, row[key]) === condition.equals;
      if ("in" in condition) return (condition.in as unknown[]).includes(row[key]);
      if ("not" in condition) return row[key] !== condition.not;
      if ("lte" in condition) return new Date(row[key] as string).getTime() <= new Date(condition.lte as string).getTime();
      if ("gt" in condition) return new Date(row[key] as string).getTime() > new Date(condition.gt as string).getTime();
    }
    return row[key] === value;
  });
}

/** Deterministic persistence adapter for public HTTP and actual local-browser tests.
 * Never opens a database, object store, bank connection or SMS gateway. */
export function createFundAccountSyntheticDb() {
  let conflictNextTransaction = false;
  const tables: Record<string, Row[]> = {
    companyEntity: [{ id: "company-a", name: "甲公司", isActive: true }, { id: "company-b", name: "乙公司", isActive: true }],
    project: [{ id: "project-a", name: "甲项目", isActive: true }],
    registeredFundAccount: [], fundAccountBalanceRegistration: [], fundAccountSourceBatch: [], auditLog: [], approvalInstance: [], approvalActionLog: [], approvalDelegation: []
  };
  for (const model of Prisma.dmmf.datamodel.models) tables[model.name[0].toLowerCase() + model.name.slice(1)] ??= [];
  const roles: Record<string, string> = { finance: "finance_staff", director: "finance_director", keeper: "comprehensive_director", admin: "super_admin", employee: "employee", project_finance: "finance_staff", delegate: "employee", other_director: "finance_director" };
  const initialRoles = { ...roles };
  const passwordHash = hashSync("Synthetic15Password!", 4);
  let failAudit = false;
  const missingSignatures = new Set<string>();
  const inactiveUsers = new Set<string>();
  const sessionVersions = new Map<string, number>();
  const delegate = (table: string) => ({
    findMany: async (args: Args = {}) => {
      let rows = tables[table].filter(row => matches(row, args.where));
      if (args.orderBy) {
        const [key, direction] = Object.entries(args.orderBy)[0];
        rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]), "zh") * (direction === "desc" ? -1 : 1));
      }
      return rows.map(row => {
        if (table === "registeredFundAccount" && args.include?.registrations) {
          return { ...row, registrations: tables.fundAccountBalanceRegistration.filter(r => r.accountId === row.id).map(r => ({ ...r, sources: tables.fundAccountSourceBatch.filter(s => s.registrationId === r.id) })) };
        }
        if (table === "fundAccountBalanceRegistration" && args.include?.sources) return { ...row, sources: tables.fundAccountSourceBatch.filter(s => s.registrationId === row.id) };
        return { ...row };
      });
    },
    findFirst: async (args: Args = {}) => (await delegate(table).findMany(args))[0] ?? null,
    count: async (args: Args = {}) => tables[table].filter(row => matches(row, args.where)).length,
    findUnique: async (args: Args) => {
      const row = tables[table].find(row => matches(row, args.where));
      return row ? { ...row, ...(args.include?.sources ? { sources: tables.fundAccountSourceBatch.filter(s => s.registrationId === row.id) } : {}) } : null;
    },
    create: async (args: Args) => {
      if (table === "auditLog" && failAudit) throw new Error("synthetic audit persistence failure");
      const data = args.data!;
      if (tables[table].some(row => (data.scopeKey && row.scopeKey === data.scopeKey) || (data.idempotencyKey && row.idempotencyKey === data.idempotencyKey) || (table === "fundAccountBalanceRegistration" && row.accountId === data.accountId && row.version === data.version))) {
        throw new Prisma.PrismaClientKnownRequestError("synthetic unique constraint", { code: "P2002", clientVersion: "synthetic" });
      }
      const row = { id: randomUUID(), createdAt: new Date(), ...(table === "approvalDelegation" ? { enabled: true } : {}), ...data };
      tables[table].push(row);
      return { ...row };
    },
    update: async (args: Args) => {
      const index = tables[table].findIndex(row => matches(row, args.where));
      if (index < 0) throw new Error("Synthetic row not found");
      tables[table][index] = { ...tables[table][index], ...args.data };
      return { ...tables[table][index] };
    },
    updateMany: async (args: Args) => {
      let count = 0;
      tables[table] = tables[table].map(row => matches(row, args.where) ? (count++, { ...row, ...args.data }) : row);
      return { count };
    }
  });
  const db = {
    ...Object.fromEntries(Object.keys(tables).map(table => [table, delegate(table)])),
    user: {
      findMany: async ({ where }: Args = {}) => Object.keys(roles).map(id => ({ id, name: id === "director" ? "财务主管" : id === "delegate" ? "代办同事" : "合成人员", isActive: !inactiveUsers.has(id) })).filter(row => matches(row, where)),
      findUnique: async ({ where }: Args) => roles[String(where?.id)] ? ({ id: where?.id, name: where?.id === "director" ? "财务主管" : where?.id === "delegate" ? "代办同事" : "合成人员", phone: null, isActive: !inactiveUsers.has(String(where?.id)), sessionVersion: sessionVersions.get(String(where?.id)) ?? 0, passwordHash }) : null
    },
    userPosition: { count: async ({ where }: Args = {}) => Object.entries(roles).map(([userId, role]) => ({ userId, positionId: role, projectId: userId === "project_finance" ? "project-a" : null })).filter(row => matches(row, where)).length, findMany: async ({ where }: Args) => Object.entries(roles).map(([userId, role]) => ({ userId, positionId: role, projectId: userId === "project_finance" ? "project-a" : null })).filter(row => matches(row, where)) },
    position: { findUnique: async ({ where }: Args) => [...new Set(Object.values(roles))].map(id => ({ id, key: id })).find(row => matches(row, where)) ?? null, findMany: async ({ where }: Args) => [...new Set(Object.values(roles))].map(id => ({ id, key: id })).filter(row => matches(row, where)) },
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.isArray(query) ? query.join("?") : (query as Prisma.Sql).sql;
      const id = String(Array.isArray(query) ? values[0] : (query as Prisma.Sql).values[0]);
      if (sql.includes('SELECT p."key" FROM "UserPosition"')) return roles[id] && !inactiveUsers.has(id) && id !== "project_finance" ? [{ key: roles[id] }] : [];
      if (sql.includes('SELECT DISTINCT up."projectId"')) return id === "project_finance" ? [{ projectId: "project-a" }] : [];
      if (sql.includes('FROM "HandwrittenSignatureVersion"')) return missingSignatures.has(id) ? [] : [{ id: `signature-version:${id}`, fileId: `signature-file:${id}`, contentSha256: createHash("sha256").update(`synthetic-signature:${id}`).digest("hex") }];
      if (sql.includes('FROM "FileObject"')) {
        const actor = id.replace("signature-file:", "");
        return [{ id, contentSha256: createHash("sha256").update(`synthetic-signature:${actor}`).digest("hex"), storageStatus: "active" }];
      }
      if (sql.includes('FROM "UserPosition"')) return []; // Synthetic adapter does not claim real row-lock acceptance.
      if (sql.includes('FROM "ApprovalDelegation"')) return tables.approvalDelegation.filter(row => row.id === id);
      if (sql.includes('FROM "ApprovalInstance"')) return tables.approvalInstance.filter(row => row.id === id);
      if (sql.includes('FROM "User"')) return roles[id] ? [{ id, name: id === "director" ? "财务主管" : id === "delegate" ? "代办同事" : "合成人员", isActive: !inactiveUsers.has(id) }] : [];
      throw new Error("Synthetic database received an unexpected SQL boundary query");
    },
    projectMember: { findMany: async () => [] },
    $transaction: async <T>(run: (client: unknown) => Promise<T>) => {
      if (conflictNextTransaction) { conflictNextTransaction = false; throw new Prisma.PrismaClientKnownRequestError("synthetic committed transaction conflict", {code:"P2034",clientVersion:"synthetic"}); }
      const snapshot = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.map(row => ({ ...row }))]));
      try { return await run(db); }
      catch (error) { Object.assign(tables, snapshot); throw error; }
    }
  };
  return { prisma: db, conflictNextTransaction() { conflictNextTransaction = true; }, reset() { for (const key of ["registeredFundAccount", "fundAccountBalanceRegistration", "fundAccountSourceBatch", "auditLog", "approvalInstance", "approvalActionLog", "approvalDelegation"]) tables[key] = []; conflictNextTransaction = false; failAudit = false; missingSignatures.clear(); inactiveUsers.clear(); sessionVersions.clear(); Object.assign(roles, initialRoles); }, setSessionVersion(actor: string, version: number) { sessionVersions.set(actor, version); }, setSignature(actor: string, present: boolean) { if (present) missingSignatures.delete(actor); else missingSignatures.add(actor); }, setActive(actor: string, active: boolean) { if (active) inactiveUsers.delete(actor); else inactiveUsers.add(actor); }, setRole(actor: string, role: string) { roles[actor] = role; }, failAudit(value: boolean) { failAudit = value; } };
}
