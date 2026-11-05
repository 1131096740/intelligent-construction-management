import { AuthController } from "../auth/auth.controller";
import { ApprovalProgressController } from "../approval/approval-progress.controller";
import { ApprovalProgressService } from "../approval/approval-progress.service";
import { MeController } from "../me/me.controller";
import { MeService } from "../me/me.service";
import { ApprovalDelegationController } from "../approval/approval-delegation.controller";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { GeneralProcurementRequestNotificationService } from "./general-procurement-request-notification.service";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { GeneralProcurementController } from "./general-procurement.controller";
import { GeneralProcurementService } from "./general-procurement.service";
import { GeneralProcurementRequestService } from "./general-procurement-request.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { FileService } from "../file/file.service";
import { PrismaService } from "../database/prisma.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { createApiValidationPipe } from "../validation/api-validation";

type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some(part => matches(row, part));
    if (key === "AND") return (expected as Row[]).every(part => matches(row, part));
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const condition = expected as Row;
      if (Array.isArray(condition.in)) return condition.in.includes(row[key]);
      if ("not" in condition) return row[key] !== condition.not;
      if (condition.lte instanceof Date) return row[key] instanceof Date && row[key] <= condition.lte;
      if (condition.gt instanceof Date) return row[key] instanceof Date && row[key] > condition.gt;
      if (typeof condition.contains === "string") return String(row[key]).includes(condition.contains);
      if (Array.isArray(condition.path)) { let current: unknown = row[key]; for (const part of condition.path) current = current && typeof current === "object" ? (current as Row)[String(part)] : undefined; return current === condition.equals; }
    }
    return row[key] === expected;
  });
}

/** Pure in-process persistence adapter. Never imports a resource driver or creates a database. */
export async function createGeneralRequestHarness(port = 0) {
  const tables: Record<string, Row[]> = {};
  const userId = randomUUID(), directorId = randomUUID(), managerId = randomUUID(), outsiderId = randomUUID();
  const projectId = randomUUID();
  const allRoles = ["employee", "comprehensive_director", "project_manager", "super_admin"];
  tables.position = allRoles.map(key => ({ id: key, key }));
  tables.user = await Promise.all([userId, directorId, managerId, outsiderId].map(async (id, index) => ({ id, name: ["合成员工", "综合主管", "项目经理", "其他项目人员"][index],
    phone: `1380000000${index}`, isActive: true, sessionVersion: 0, passwordHash: await bcrypt.hash("synthetic-current-password", 4) })));
  tables.userPosition = [{ userId, positionId: "employee", projectId }, { userId: directorId, positionId: "comprehensive_director", projectId: null }, { userId: managerId, positionId: "project_manager", projectId }, { userId: outsiderId, positionId: "employee", projectId: randomUUID() }];
  tables.project = [{ id: projectId, name: "合成办公项目", isActive: true }];
  const png = Buffer.from("synthetic private current signature");
  const sha = createHash("sha256").update(png).digest("hex");
  tables.handwrittenSignatureVersion = tables.user.map(row => ({ id: randomUUID(), userId: row.id, fileId: randomUUID(), contentSha256: sha, source: "canvas", createdAt: new Date() }));
  tables.fileObject = tables.handwrittenSignatureVersion.map(row => ({ id: row.fileId, uploadedByUserId: row.userId, contentSha256: sha, storageStatus: "active" }));
  const names = [...new Set([...Prisma.dmmf.datamodel.models.map(model => model.name[0].toLowerCase() + model.name.slice(1)), "user", "position", "userPosition", "project", "projectMember", "projectRosterMember", "companyEntity", "auditLog", "generalProcurement", "approvalInstance", "approvalActionLog", "approvalDelegation", "fileObject", "handwrittenSignatureVersion", "expenseClaim"])];
  const operations: Record<string, unknown> = {};
  let sequence = 0;
  for (const name of names) {
    const rows = () => tables[name] ?? (tables[name] = []);
    const find = ({ where = {} }: { where?: Row } = {}) => rows().filter(row => matches(row, where));
    const update = (row: Row, data: Row) => {
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
      row.updatedAt = new Date(); return structuredClone(row);
    };
    operations[name] = {
      findUnique: async (query: { where?: Row }) => structuredClone(find(query)[0] ?? null),
      findUniqueOrThrow: async (query: { where?: Row }) => { const row = find(query)[0]; if (!row) throw new Error("合成记录不存在"); return structuredClone(row); },
      findFirst: async (query: { where?: Row }) => structuredClone(find(query)[0] ?? null),
      findMany: async (query: { where?: Row } = {}) => structuredClone(find(query)), count: async (query: { where?: Row } = {}) => find(query).length,
      create: async ({ data }: { data: Row }) => { const row = { id: randomUUID(), enabled: true, revision: 1, status: "draft", requestProtocolVersion: 1, scope: "project", lines: [], submissions: [], approvalInstanceId: null, createdAt: new Date(), updatedAt: new Date(), ...data }; rows().push(row); return structuredClone(row); },
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => { let count = 0; for (const row of data) { if (skipDuplicates && rows().some(old => old.id === row.id)) continue; rows().push({ createdAt: new Date(), ...row }); count++; } return { count }; },
      update: async ({ where, data }: { where: Row; data: Row }) => { const row = find({ where })[0]; if (!row) throw new Error("合成记录不存在"); return update(row, data); },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { const found = find({ where }); found.forEach(row => update(row, data)); return { count: found.length }; }
    };
  }
  operations.$queryRaw = async (query: Prisma.Sql) => {
    const sql = Array.isArray(query) ? query.join("?") : query.sql;
    if (sql.includes('INSERT INTO "BusinessDailySequence"')) return [{ sequence: ++sequence }];
    if (sql.includes('FROM "ApprovalActionLog" queued')) {
      const kind = query.values[0];
      return structuredClone((tables.approvalActionLog ?? []).filter(row => {
        const data = row.metadata as Row | undefined;
        return row.action === "system_notification" && data != null && data.kind === kind && data.event === "queued" && !tables.approvalActionLog.some(other => {
          const receipt = other.metadata as Row | undefined;
          return receipt != null && receipt.kind === kind && receipt.intentId === row.id && ["dispatch_claimed", "accepted", "failed", "unknown", "cancelled"].includes(String(receipt.event));
        });
      }).slice(0, 100));
    }
    if (sql.includes("jg_delete_unsubmitted_general_procurement")) {
      const [id, actorUserId, revision] = query.values;
      const row = (tables.generalProcurement ?? []).find(row => row.id === id);
      const valid = Boolean(row && row.applicantUserId === actorUserId && row.revision === revision && row.status === "draft" && !row.approvalInstanceId && Array.isArray(row.submissions) && row.submissions.length === 0);
      if (valid && row) {
        tables.generalProcurement = tables.generalProcurement.filter(item => item.id !== id);
        (tables.auditLog ??= []).push({ id: randomUUID(), actorUserId, action: "general_procurement.draft.delete", businessType: "general_procurement", businessId: id, metadata: { requestKey: row.requestKey }, createdAt: new Date() });
      }
      return [{ deleted: valid }];
    }
    for (const [table, model] of [["HandwrittenSignatureVersion", "handwrittenSignatureVersion"], ["FileObject", "fileObject"], ["User", "user"]]) {
      if (sql.includes(`FROM "${table}"`) && !sql.includes("JOIN")) {
        const key = model === "handwrittenSignatureVersion" ? "userId" : "id";
        return structuredClone((tables[model] ?? []).filter(row => row[key] === query.values[0]));
      }
    }
    return [];
  };
  operations.$executeRaw = async () => 0;
  let transactionDepth = 0;
  let tail = Promise.resolve();
  const db = { ...operations, $transaction: async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    const snapshot = structuredClone(tables); transactionDepth++;
    try { return await callback(operations as unknown as Prisma.TransactionClient); }
    catch (error) { for (const key of Object.keys(tables)) delete tables[key]; Object.assign(tables, snapshot); throw error; }
    finally { transactionDepth--; release(); }
  } } as unknown as PrismaService;
  const sent: Array<{ phone: string; label: string; duty: string; code: string; afterCommit: boolean }> = [];
  const smsMode: { status: "accepted" | "failed" | "unknown" } = { status: "accepted" };
  const tokens = new JwtTokenService();
  const auth = new AuthService(db, tokens, new AuditService());
  const module = await Test.createTestingModule({ controllers: [GeneralProcurementController, ApprovalDelegationController, ApprovalProgressController, MeController, AuthController], providers: [
    { provide: ApprovalSmsService, useValue: { available: () => true, send: async (phone: string, label: string, duty: string, code: string) => { sent.push({ phone, label, duty, code, afterCommit: transactionDepth === 0 }); return { status: smsMode.status, message: "模拟发送结果", ...(smsMode.status === "accepted" ? { receipt: randomUUID() } : {}) }; } } },
    MeService, ApprovalProgressService, ApprovalDelegationService, GeneralProcurementService, GeneralProcurementRequestService, GeneralProcurementRequestNotificationService, { provide: PrismaService, useValue: db },
    { provide: ProjectVisibilityService, useValue: new ProjectVisibilityService(db) },
    BusinessNumberingService,
    { provide: AuditService, useValue: new AuditService() }, { provide: AuthService, useValue: auth },
    { provide: FileService, useValue: { readPrivateBuffer: async () => png } }
  ] }).compile();
  const app = module.createNestApplication({ logger: ["error"] }); app.useGlobalPipes(createApiValidationPipe());
  const reflector = new Reflector(); app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, db), new PermissionGuard(reflector, db), new RetiredWriteEntryGuard());
  await app.listen(port, "127.0.0.1"); const base = await app.getUrl();
  const tokenFor = (id = userId) => tokens.signAccessToken({ id, name: "合成人员", phone: null, sessionVersion: 0 });
  const request = async (path: string, body?: object, actor = userId, method = body ? "POST" : "GET") => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tokenFor(actor)}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5_000) });
    return { status: response.status, body: await response.json() };
  };
  return { app, base, request, tokenFor, userId, directorId, managerId, outsiderId, projectId, tables, db, sent, smsMode };
}
