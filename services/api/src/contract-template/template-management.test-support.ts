import { ContractController } from "../contract/contract.controller";
import { ProjectController } from "../project/project.controller";
import { ProjectService } from "../project/project.service";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { OperationalWriteFreezeGuard } from "../operational-write-freeze/operational-write-freeze.guard";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import { AccountRateLimitGuard } from "../auth/guards/account-rate-limit.guard";
import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { ContractDraftController } from "../contract-workbench/contract-draft.controller";
import { ContractWorkbenchController } from "../contract-workbench/contract-workbench.controller";
import { ContractDraftAggregateService } from "../contract-workbench/contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "../contract-workbench/contract-draft-edit-lease.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { PristineDraftDeletionService } from "../contract-workbench/pristine-draft-deletion.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { BusinessPartyService } from "../business-party/business-party.service";
import { ContractService } from "../contract/contract.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { BusinessEntryDefinitionController } from "../business-entry-definition/business-entry-definition.controller";
import { BusinessEntryDefinitionService } from "../business-entry-definition/business-entry-definition.service";
import { BusinessEntrySceneAuthorizationService } from "../business-entry-definition/business-entry-scene-authorization.service";
import { BusinessEntryExcelService } from "../business-entry-definition/business-entry-excel.service";
import { BUSINESS_ENTRY_ACCESS_REGISTRY, BUSINESS_ENTRY_DEFINITION_REGISTRY } from "../business-entry-definition/business-entry-definition.scene-registry";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { ContractReadService } from "../contract/contract-read.service";
import { CONTRACT_VERSION_FILE_READ_AUTHORITY } from "../contract/contract-version-file-read-authority";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ModuleRef, Reflector } from "@nestjs/core";
import * as bcrypt from "bcryptjs";
import PizZip from "pizzip";
import { Prisma } from "@prisma/client";
import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileController } from "../file/file.controller";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { ContractTemplateController } from "./contract-template.controller";
import { ContractTemplateService } from "./contract-template.service";
import { ContractScenarioService } from "./contract-scenario.service";
import { ContractDocumentController } from "../contract-document/contract-document.controller";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractNegotiationService } from "../contract-document/contract-negotiation.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { LayoutTemplateService } from "./layout-template.service";

type Row = Record<string, unknown>;
function fixtureClone<T>(value: T): T {
  if (Prisma.Decimal.isDecimal(value)) return new Prisma.Decimal(value.toString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(fixtureClone) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixtureClone(item)])) as T;
  return value;
}

function jsonbValue(value: unknown): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  if (Array.isArray(value)) return value.map(jsonbValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, jsonbValue(item)]));
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some(item => matches(row, item));
    if (key === "AND") return (expected as Row[]).every(item => matches(row, item));
    const value = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const rule = expected as Row;
      if ("in" in rule) return (rule.in as unknown[]).includes(value);
      if ("not" in rule) return value !== rule.not;
      if ("equals" in rule) return value === rule.equals;
      if ("lt" in rule) return Number(value) < Number(rule.lt);
      if ("lte" in rule) return Number(value) <= Number(rule.lte);
      if ("gt" in rule) return Number(value) > Number(rule.gt);
      if ("gte" in rule) return Number(value) >= Number(rule.gte);
      throw new Error("合成持久层遇到未登记的查询条件");
    }
    return value === expected;
  });
}

/** Test-only persistence/file adapters. No database driver, SQL or COS fallback. */
export class TemplateSyntheticStore {
  private rows: Record<string, Row[]> = {};
  private queue = Promise.resolve();
  participantProjectionCount = 0;

  table(name: string) {
    this.rows[name] ??= [];
    const find = (where?: Row) => this.rows[name].filter(row => matches(row, where));
    return {
      findUnique: async ({ where }: { where: Row }) => fixtureClone(find(where)[0] ?? null),
      findFirst: async (args: { where?: Row; orderBy?: Row } = {}) => this.sorted(find(args.where), args.orderBy)[0] ?? null,
      findMany: async (args: { where?: Row; orderBy?: Row } = {}) => this.sorted(find(args.where), args.orderBy),
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), draftRevision: 1, status: "draft", ...(name === "contract" ? { voidedAt: null } : {}), ...(name === "contractVersion" ? { baseVersionId: null, firstSubmittedAt: null, effectiveAt: null, documentContentRevision: 1, documentContentFingerprint: null, readinessSnapshot: null, companyEntityId: null, companyEntityNameSnapshot: null, estimatedAmountCents: null, estimatedAmountYuan: null, settlementMode: "none", settlementModeConfirmedAt: null, latestDraftPreviewDocumentId: null } : {}), ...(name === "contractGeneratedDocument" ? { docxFileId: null, pdfFileId: null, errorMessage: null } : {}), ...data };
        this.apply(row, data, name);
        this.rows[name].push(row);
        return fixtureClone(row);
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = find(where)[0];
        if (!row) throw new Error("合成持久层未找到待更新记录");
        this.apply(row, data, name);
        return fixtureClone(row);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = find(where);
        rows.forEach(row => this.apply(row, data, name));
        return { count: rows.length };
      },
      delete: async ({ where }: { where: Row }) => {
        const row = find(where)[0];
        if (!row) throw new Error("合成持久层未找到待移除记录");
        this.rows[name] = this.rows[name].filter(value => value !== row);
        return fixtureClone(row);
      },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        let row = find(where)[0];
        if (row) this.apply(row, update, name);
        else { row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...create }; this.rows[name].push(row); }
        return fixtureClone(row);
      },
      deleteMany: async ({ where }: { where?: Row } = {}) => { const selected = find(where); this.rows[name] = this.rows[name].filter(row => !selected.includes(row)); return { count: selected.length }; },
      createMany: async ({ data }: { data: Row[] }) => { for (const row of data) this.rows[name].push({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...(name === "contractBill" ? { revision: 1, taxInclusiveAmountCents: 0n, taxExclusiveAmountCents: 0n, taxAmountCents: 0n, sourceExcelFileId: null } : {}), ...row }); return { count: data.length }; },
      count: async ({ where }: { where?: Row } = {}) => find(where).length
    };
  }

  private sorted(rows: Row[], order?: Row) {
    const [key, direction] = Object.entries(order ?? {})[0] ?? [];
    return fixtureClone(key ? [...rows].sort((a, b) => (Number(a[key]) - Number(b[key])) * (direction === "desc" ? -1 : 1)) : rows);
  }

  private apply(row: Row, data: Row, tableName: string) {
    // Match Prisma's declared Decimal scalar conversion at this synthetic boundary.
    const model = Prisma.dmmf.datamodel.models.find(model => model.name[0].toLowerCase() + model.name.slice(1) === tableName);
    const decimals = new Set(model?.fields.filter(field => field.kind === "scalar" && field.type === "Decimal").map(field => field.name));
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value
        ? Number(row[key]) + Number((value as Row).increment)
        : value !== null && value !== undefined && decimals.has(key) ? new Prisma.Decimal(String(value))
        : /Schema$|Report$|^sampleData$|^inputSnapshot$/u.test(key) ? jsonbValue(value)
        : value;
    }
    row.updatedAt = new Date();
  }

  readonly prisma = {
    authRateLimit: this.table("authRateLimit"),
    user: this.table("user"), userPosition: this.table("userPosition"), position: this.table("position"),
    project: this.table("project"), projectRosterMember: this.table("projectRosterMember"),
    projectMember: this.table("projectMember"), refreshToken: this.table("refreshToken"), auditLog: this.table("auditLog"),
    fileObject: this.table("fileObject"), contractLayoutTemplate: this.table("contractLayoutTemplate"),
    contractLayoutTemplateVersion: this.table("contractLayoutTemplateVersion"), contractLayoutPreviewJob: this.table("contractLayoutPreviewJob"),
    contractScenarioTemplateMapping: this.table("contractScenarioTemplateMapping"),
    standardClause: this.table("standardClause"), standardClauseVersion: this.table("standardClauseVersion"),
    contractBusinessTemplate: this.table("contractBusinessTemplate"), contractBusinessTemplateVersion: this.table("contractBusinessTemplateVersion"),
    contractOfflineRevision: this.table("contractOfflineRevision"), contractDocumentComparison: this.table("contractDocumentComparison"),
    contractNegotiationRound: this.table("contractNegotiationRound"), contractDocumentDifference: this.table("contractDocumentDifference"),
    // Explicitly empty adjacent-domain bindings for the real private-file policy.
    approvalActionLog: this.table("approvalActionLog"),
    approvalInstance: this.table("approvalInstance"),
    contractArchiveFile: this.table("contractArchiveFile"),
    generalProcurement: this.table("generalProcurement"),
    invoiceExceptionConfirmation: this.table("invoiceExceptionConfirmation"),
    invoiceRecord: this.table("invoiceRecord"),
    noInvoiceConfirmation: this.table("noInvoiceConfirmation"),
    paymentExecution: this.table("paymentExecution"),
    projectNecessaryExpenseReserveEntry: this.table("projectNecessaryExpenseReserveEntry"),
    projectFundDisputeEntry: this.table("projectFundDisputeEntry"),
    paymentRequest: this.table("paymentRequest"),
    pdfDocument: this.table("pdfDocument"),
    settlement: this.table("settlement"),
    settlementArchiveFile: this.table("settlementArchiveFile"),
    settlementDraft: this.table("settlementDraft"),
    spotProcurementPaymentInvoice: this.table("spotProcurementPaymentInvoice"),
    spotProcurementReceiptPhoto: this.table("spotProcurementReceiptPhoto"),
    spotProcurementRefund: this.table("spotProcurementRefund"),
    spotProcurementAttachment: this.table("spotProcurementAttachment"),
    spotProcurementPayment: this.table("spotProcurementPayment"),
    spotProcurementDiscrepancy: this.table("spotProcurementDiscrepancy"),
    spotProcurementPaymentExecutionVoucher: this.table("spotProcurementPaymentExecutionVoucher"),
    spotProcurementPaymentExecution: this.table("spotProcurementPaymentExecution"),
    contractDraftEditLease: this.table("contractDraftEditLease"),
    contractDraftSaveRequest: this.table("contractDraftSaveRequest"),
    contractDraftAttachment: this.table("contractDraftAttachment"),
    contractDraftCheckpoint: this.table("contractDraftCheckpoint"),
    paymentTermsVersion: this.table("paymentTermsVersion"),
    paymentTermsStage: this.table("paymentTermsStage"),
    contractVersionAuthorizationLink: this.table("contractVersionAuthorizationLink"),
    contractFormalFile: this.table("contractFormalFile"),
    contractAuthorization: this.table("contractAuthorization"),
    businessEntrySubmissionSnapshot: this.table("businessEntrySubmissionSnapshot"),
    contractSealTask: this.table("contractSealTask"),
    contractVersionCodeAllocation: this.table("contractVersionCodeAllocation"),
    businessDailySequence: this.table("businessDailySequence"),
    contractNumberTombstone: this.table("contractNumberTombstone"),
    contractDraftDeletionReceipt: this.table("contractDraftDeletionReceipt"),
    contractDraftDeletionCodeTombstone: this.table("contractDraftDeletionCodeTombstone"),
    businessParty: this.table("businessParty"),
    contractBusinessScenario: this.table("contractBusinessScenario"),
    contract: this.table("contract"), contractPartySnapshot: this.table("contractPartySnapshot"), contractBill: this.table("contractBill"), contractBillRow: this.table("contractBillRow"),
    contractVersion: this.table("contractVersion"), contractGeneratedDocument: this.table("contractGeneratedDocument"),
    // Only explicitly registered business/file lock and read projections are modeled.
    // This does not connect to a database or execute SQL; every other query is rejected.
    $queryRaw: async (query: Prisma.Sql): Promise<Row[]> => {
      const text = query.strings.join("?").replace(/\s+/gu, " ").trim();
      // The existing one-contract audit/approval participant read projection.
      // Fixed normalized SQL fingerprint; evaluate only the synthetic stored facts.
      if (createHash("sha256").update(text).digest("hex") === "d600870300bbe7561e1b2c5b09efb160a203677722461258a58711490198d01d") {
        this.participantProjectionCount += 1;
        const [contractId, actorId, ...actorChecks] = query.values;
        if (query.values.length !== 5 || typeof contractId !== "string" || typeof actorId !== "string" || !actorChecks.every(value => value === actorId)) throw new Error("合成参与读取投影参数不符");
        const versions = await this.prisma.contractVersion.findMany({ where: { contractId } });
        const ids = versions.map(version => version.id);
        const audits = await this.prisma.auditLog.findMany({ where: { actorUserId: actorId } });
        const approvals = await this.prisma.approvalInstance.findMany({ where: { businessType: "contract_version", businessId: { in: ids } } });
        const actions = await this.prisma.approvalActionLog.findMany({ where: { approvalInstanceId: { in: approvals.map(approval => approval.id) } } });
        const participated = audits.some(audit => audit.businessType === "contract" && audit.businessId === contractId && ["contract.draft.create", "contract.draft.copy"].includes(String(audit.action)) || audit.businessType === "contract_version" && ids.includes(audit.businessId) && audit.action === "contract.change_draft.create") || approvals.some(approval => approval.applicantUserId === actorId) || actions.some(action => ["approve", "reject", "reject_previous", "return_to_applicant", "transfer", "delegate"].includes(String(action.action)) && (action.actorUserId === actorId || action.representedUserId === actorId));
        return participated ? [{ contractId }] : [];
      }
      if (text === "INSERT INTO \"BusinessDailySequence\" (\"prefix\", \"businessDate\", \"nextSequence\", \"updatedAt\") VALUES (?, ?, 2, CURRENT_TIMESTAMP) ON CONFLICT (\"prefix\", \"businessDate\") DO UPDATE SET \"nextSequence\" = \"BusinessDailySequence\".\"nextSequence\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP RETURNING \"nextSequence\" - 1 AS \"sequence\"") {
        const [prefix, businessDate] = query.values;
        if (query.values.length !== 2 || prefix !== "HT" || typeof businessDate !== "string" || !/^\d{8}$/u.test(businessDate)) throw new Error("合成合同编号投影参数不符");
        const row = await this.prisma.businessDailySequence.upsert({ where: { prefix, businessDate }, create: { prefix, businessDate, nextSequence: 2 }, update: { nextSequence: { increment: 1 } } });
        return [{ sequence: Number(row.nextSequence) - 1 }];
      }
      const id = query.values[0];
      if (typeof id !== "string" || !query.values.every(value => value === id)) throw new Error("合成锁投影参数不符");
      if (text === 'SELECT "id", "isActive" FROM "Project" WHERE "id" = ? FOR UPDATE') { const project = await this.prisma.project.findUnique({ where: { id } }); return project ? [project] : []; }
      // Current FileService first checks the registered-payment voucher join.
      // These contract-only fixtures create no voucher relation; a future
      // nonempty relation is deliberately not modeled as permission-free.
      if (createHash("sha256").update(text).digest("hex") === "a3ffde9e356083472920cfdbfe8d370880c9725a212caf612b0dc2e8ffb428e2") {
        if (query.values.length !== 1 || (this.rows.registeredPaymentVoucher ?? []).length !== 0) throw new Error("合成实付凭证读取投影未登记当前关系");
        return [];
      }
      // FileService's real referenced-predecessor cleanup path. Model only the
      // exact lock and positive generated-document reference facts of this fake;
      // orphan/unmodeled references remain refused, never guessed false.
      if (text === 'SELECT "id" FROM "FileObject" WHERE "id" = ? FOR UPDATE') {
        const file = await this.prisma.fileObject.findUnique({ where: { id } });
        return file ? [{ id: file.id }] : [];
      }
      if (createHash("sha256").update(text).digest("hex") === "9e5581891d6da3266df4f8d8f74e654da7036f7f480db9216b09fbcc69b19203") {
        if (query.values.length !== 73) throw new Error("合成文件引用投影参数不符");
        const documents = await this.prisma.contractGeneratedDocument.findMany();
        if (!documents.some(document => document.docxFileId === id || document.pdfFileId === id)) throw new Error("合成文件引用投影仅支持已生成文书的正引用事实");
        return [{ referenced: true }];
      }
      const version = await this.prisma.contractVersion.findUnique({ where: { id } });
      if (text === 'SELECT c.* FROM "Contract" c INNER JOIN "ContractVersion" cv ON cv."contractId" = c."id" WHERE cv."id" = ? FOR UPDATE OF c') {
        const contract = version ? await this.prisma.contract.findUnique({ where: { id: version.contractId } }) : null;
        return contract ? [contract] : [];
      }
      if (text === 'SELECT cv.*, EXISTS ( SELECT 1 FROM "ContractTakeover" takeover WHERE takeover."contractVersionId" = cv."id" ) AS "hasHistoricalTakeoverRelation" FROM "ContractVersion" cv WHERE cv."id" = ? FOR UPDATE OF cv') return version ? [{ ...version, hasHistoricalTakeoverRelation: false }] : [];
      if (text === 'SELECT EXISTS ( SELECT 1 FROM "ContractFormalFile" f WHERE f."contractVersionId" = ? AND f."purpose" = \'mutually_signed_final\' AND f."status" = \'active\' ) AS "hasSignedFormalFile", EXISTS ( SELECT 1 FROM "ContractSealTask" s WHERE s."contractVersionId" = ? AND s."status" <> \'cancelled\' ) AS "hasActiveSealTask", EXISTS ( SELECT 1 FROM "ContractArchiveFile" a WHERE a."contractVersionId" = ? ) AS "hasArchiveFile", EXISTS ( SELECT 1 FROM "Settlement" st WHERE st."contractVersionId" = ? ) AS "hasSettlement", EXISTS ( SELECT 1 FROM "PaymentRequest" p WHERE p."contractVersionId" = ? ) AS "hasPaymentRequest"') return [{ hasSignedFormalFile: false, hasActiveSealTask: false, hasArchiveFile: false, hasSettlement: false, hasPaymentRequest: false }];
      if (text === "SELECT \"contractVersionId\" FROM \"ContractDraftEditLease\" WHERE \"contractVersionId\" = ? FOR UPDATE") return this.prisma.contractDraftEditLease.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT \"id\" FROM \"ContractBill\" WHERE \"contractVersionId\" = ? ORDER BY \"id\" FOR UPDATE") return this.prisma.contractBill.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT r.\"id\" FROM \"ContractBillRow\" r JOIN \"ContractBill\" b ON b.\"id\" = r.\"contractBillId\" WHERE b.\"contractVersionId\" = ? ORDER BY r.\"id\" FOR UPDATE") { const bills = await this.prisma.contractBill.findMany({ where: { contractVersionId: id } }); return this.prisma.contractBillRow.findMany({ where: { contractBillId: { in: bills.map(bill => bill.id) } } }); }
      if (text === "SELECT \"id\" FROM \"ContractPartySnapshot\" WHERE \"contractVersionId\" = ? ORDER BY \"id\" FOR UPDATE") return this.prisma.contractPartySnapshot.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT \"id\" FROM \"PaymentTermsVersion\" WHERE \"contractVersionId\" = ? ORDER BY \"id\" FOR UPDATE") return this.prisma.paymentTermsVersion.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT s.\"id\" FROM \"PaymentTermsStage\" s JOIN \"PaymentTermsVersion\" t ON t.\"id\" = s.\"paymentTermsVersionId\" WHERE t.\"contractVersionId\" = ? ORDER BY s.\"id\" FOR UPDATE") { const terms = await this.prisma.paymentTermsVersion.findMany({ where: { contractVersionId: id } }); return this.prisma.paymentTermsStage.findMany({ where: { paymentTermsVersionId: { in: terms.map(term => term.id) } } }); }
      throw new Error("合成持久层拒绝未登记的锁投影：" + text);
    },
    $transaction: async <T>(work: (client: unknown) => Promise<T>): Promise<T> => {
      const previous = this.queue;
      let release!: () => void;
      this.queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const snapshot = fixtureClone(this.rows);
      try { return await work(this.prisma); }
      catch (error) { this.rows = snapshot; throw error; }
      finally { release(); }
    }
  };
}

export function syntheticWordSource(includeSignatures = false) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = ["合同名称：合成工程合同", "甲方：合成甲方公司", "乙方：合成乙方公司", "编号：{草稿编号}", "{文档水印}", "交货地点：合成工地", "手工条款：本项普通约定按原文保留。"];
  if (includeSignatures) paragraphs.push("甲方签章：合成甲方公司", "乙方签章：合成乙方公司");
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs.map(text => '<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>').join("") + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>');
  return zip.generate({ type: "nodebuffer" });
}

export async function createTemplateTestServer(options: { draftWorkbench?: boolean; realNegotiationReads?: boolean; legacyWorkbenchReads?: boolean } = {}) {
  const store = new TemplateSyntheticStore();
  const actors = [
    { id: "director", name: "合成合同主管", phone: "13800001101", role: "contract_director" },
    { id: "staff", name: "合成合同员", phone: "13800001102", role: "contract_staff" },
    { id: "technical", name: "合成技术管理员", phone: "13800001103", role: "super_admin" },
    { id: "employee", name: "合成普通员工", phone: "13800001104", role: "employee" },
    { id: "finance", name: "合成财务经办人", phone: "13800001105", role: "finance_staff" },
    { id: "manager", name: "合成项目经理", phone: "13800001106", role: "employee" }
  ];
  const password = "Synthetic-Template-Only-2026!";
  for (const actor of actors) {
    await store.prisma.user.create({ data: { ...actor, isActive: true, mustChangePassword: false, sessionVersion: 0, passwordHash: await bcrypt.hash(password, 4) } });
    if (!await store.prisma.position.findUnique({ where: { id: actor.role } })) await store.prisma.position.create({ data: { id: actor.role, key: actor.role } });
    if (actor.role !== "employee") await store.prisma.userPosition.create({ data: { userId: actor.id, positionId: actor.role, projectId: null } });
  }
  const objects = new Map<string, Buffer>();
  let failNextRead = false;
  const storage = {
    bucketName: () => "synthetic-private-no-network",
    write: async (key: string, value: Buffer) => { objects.set(key, Buffer.from(value)); },
    read: async (key: string) => { if (failNextRead) { failNextRead = false; throw new Error("合成私有存储单次读取故障"); } const value = objects.get(key); if (!value) throw new Error("合成私有文件不存在"); return Buffer.from(value); },
    delete: async (key: string) => { objects.delete(key); }
  } as unknown as PrivateFileStorage;
  const prisma = store.prisma as unknown as PrismaService;
  const audit = new AuditService(prisma);
  const tokens = new JwtTokenService();
  const auth = new AuthService(prisma, tokens, audit);
  const module = await Test.createTestingModule({ controllers: [...(options.draftWorkbench ? [ContractDraftController, ContractController, ProjectController, ...(options.legacyWorkbenchReads ? [ContractWorkbenchController] : [])] : []), BusinessEntryDefinitionController, AuthController, FileController, ContractTemplateController, ContractDocumentController], providers: [
    { provide: PrismaService, useValue: prisma }, { provide: AuditService, useValue: audit },
    { provide: PrivateFileStorage, useValue: storage }, ProjectVisibilityService, ContractReadService,
    { provide: CONTRACT_VERSION_FILE_READ_AUTHORITY, useExisting: ContractReadService },
    { provide: FileService, useFactory: (moduleRef: ModuleRef) => new FileService(prisma, audit, storage, undefined, undefined, moduleRef), inject: [ModuleRef] },
    { provide: ContractDocumentService, useFactory: (files: FileService) => new ContractDocumentService(prisma, audit, files, new BusinessNumberingService()), inject: [FileService] },
    { provide: ContractNegotiationService, useFactory: (files: FileService) => options.realNegotiationReads ? new ContractNegotiationService(prisma, audit, files, auth) : {}, inject: [FileService] }, { provide: AuthService, useValue: auth },
    LayoutTemplateService, ContractTemplateService, { provide: ContractScenarioService, useValue: {} },
    ...(options.draftWorkbench ? [
      { provide: ContractDraftAggregateService, useFactory: (files: FileService) => new ContractDraftAggregateService(prisma, new ContractWorkbenchService(prisma, audit), new ContractBillService(prisma, audit), new BusinessPartyService(prisma, audit), files, audit), inject: [FileService] },
      { provide: ContractDraftEditLeaseService, useFactory: () => new ContractDraftEditLeaseService(prisma, auth, audit) },
      // Real creation and read-only project choices join the same guarded workbench seam.
      { provide: ContractService, useFactory: () => new ContractService(prisma, audit) },
      { provide: ContractWorkbenchService, useFactory: () => new ContractWorkbenchService(prisma, audit) },
      { provide: ProjectService, useFactory: () => new ProjectService(prisma, audit, auth) }, { provide: PristineDraftDeletionService, useValue: {} }
    ] : []),
    // Only the real template scene is exercised; unrelated domains and Excel are not invoked.
    { provide: BusinessEntryExcelService, useValue: {} },
    { provide: BusinessEntryDefinitionService, useFactory: (templates: ContractTemplateService, layouts: LayoutTemplateService, visibility: ProjectVisibilityService) => {
      const authority = new BusinessEntrySceneAuthorizationService({} as never, {} as never, {} as never, {} as never, templates, layouts, {} as never, {} as never, {} as never, prisma, {} as never);
      return new BusinessEntryDefinitionService(BUSINESS_ENTRY_DEFINITION_REGISTRY, BUSINESS_ENTRY_ACCESS_REGISTRY, visibility, {} as never, prisma, authority);
    }, inject: [ContractTemplateService, LayoutTemplateService, ProjectVisibilityService] }
  ] }).compile();
  const files = module.get(FileService);
  const layouts = module.get(LayoutTemplateService);
  const documents = module.get(ContractDocumentService);
  if (module.get(CONTRACT_VERSION_FILE_READ_AUTHORITY) !== module.get(ContractReadService)) throw new Error("合同文件读取权威必须复用同一只读服务");
  const app = module.createNestApplication({ logger: options.draftWorkbench ? ["error"] : false });
  app.useGlobalPipes(createApiValidationPipe());
  app.useGlobalGuards(new JwtAuthGuard(new Reflector(), tokens, prisma), new RetiredWriteEntryGuard(), new OperationalWriteFreezeGuard(new OperationalWriteFreezeService()), new AccountRateLimitGuard(new AuthRateLimitService(prisma)), new PermissionGuard(new Reflector(), prisma), new ContractCutoverGuard(new Reflector()));
  await app.listen(0, "127.0.0.1");
  return { app, store, actors, password, files, layouts, documents, failNextPrivateRead: () => { failNextRead = true; }, templates: module.get(ContractTemplateService), moduleRef: module.get(ModuleRef), processor: new ContractDocumentProcessor(prisma, files, audit) };
}
