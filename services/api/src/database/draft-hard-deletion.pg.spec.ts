import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { OperatingTakeoverService } from "../operating-takeover/operating-takeover.service";
import { AuditService } from "../audit/audit.service";
import { SettlementDraftService } from "../settlement/settlement-draft.service";
import { ContractTakeoverService } from "../contract-takeover/contract-takeover.service";
import { SpotProcurementBalanceService } from "../spot-procurement/spot-procurement-balance.service";
import { ContractTaxFactsService } from "../contract-tax-facts/contract-tax-facts.service";
import { SpotProcurementPaymentService } from "../spot-procurement/spot-procurement-payment.service";

const run = process.env.RUN_POL115_ENTRY_PG16 === "1" ? it : it.skip;
describe("未提交草稿实际删除 PostgreSQL 回归", () => {
  const db = new PrismaClient();
  const actor = randomUUID(); const other = randomUUID(); const project = randomUUID();
  beforeAll(async () => {
    if (process.env.RUN_POL115_ENTRY_PG16 !== "1") return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_entry_test") throw new Error("只能使用本机一次性测试库");
    await db.user.createMany({ data: [{ id: actor, name: "草稿经办人" }, { id: other, name: "其他员工" }] });
    await db.project.create({ data: { id: project, code: project, name: "删除草稿隔离项目" } });
    const party = await db.businessParty.create({ data: { name: "合成施工企业", normalizedName: randomUUID(), createdByUserId: actor } });
    const version = await db.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: {}, createdByUserId: actor } });
    await db.projectAffiliateAssignment.create({ data: { projectId: project, businessPartyId: party.id, businessPartyVersionId: version.id, affiliateNameSnapshot: party.name, effectiveFrom: new Date("2020-01-01"), changeReason: "测试", assignedByUserId: actor } });
    await db.projectMember.create({ data: { projectId: project, userId: actor, positionKey: "material_staff" } });
  });
  afterAll(async () => { await db.$disconnect(); });

  run("审计来源补充迁移仅恢复原只读默认授权，不扩大运行时或 PUBLIC 权限", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const reader = `audit_reader_${suffix}`;
    const writer = `audit_writer_${suffix}`;
    const outsider = `audit_outsider_${suffix}`;
    const migration = readFileSync(resolve(__dirname, "../../prisma/migrations/20261019160000_draft_audit_source_backup_read/migration.sql"), "utf8");
    // Roll back roles, default ACLs and table grants together; no fixture cleanup leak.
    const rollback = new Error("rollback isolated ACL regression");
    await expect(db.$transaction(async tx => {
      for (const role of [reader, writer, outsider]) await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
      await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${reader}"`);
      await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO "${writer}"`);
      await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT ON TABLES TO "${writer}"`);
      const privileges = () => tx.$queryRaw<Array<{ tableName: string; readerSelect: boolean; readerWrites: boolean; writerSelect: boolean; outsiderSelect: boolean }>>(Prisma.sql`
        SELECT c.relname AS "tableName", has_table_privilege(${reader}, c.oid, 'SELECT') AS "readerSelect",
          has_table_privilege(${reader}, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS "readerWrites",
          has_table_privilege(${writer}, c.oid, 'SELECT') AS "writerSelect",
          has_table_privilege(${outsider}, c.oid, 'SELECT') AS "outsiderSelect"
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('SpotProcurementAuditSource','SpotPaymentAuditSource') ORDER BY c.relname`);
      expect((await privileges()).every(row => !row.readerSelect)).toBe(true);
      await tx.$executeRawUnsafe(migration);
      await tx.$executeRawUnsafe(migration);
      const rows = await privileges();
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toMatchObject({ readerSelect: true, readerWrites: false, writerSelect: false, outsiderSelect: false });
      expect(await tx.$queryRaw(Prisma.sql`SELECT count(*)::int AS count FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname='public' AND c.relname IN ('SpotProcurementAuditSource','SpotPaymentAuditSource') AND a.grantee=0`)).toEqual([{ count: 0 }]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  async function contract(historical = false) {
    const c = await db.contract.create({ data: { projectId: project, code: randomUUID(), name: "合成合同", counterparty: "合成供应商", contractTypeKey: "material_purchase", ownerUserId: actor, source: historical ? "historical_takeover" : "system" } });
    const v = await db.contractVersion.create({ data: { contractId: c.id, versionNo: 1, changeType: historical ? "historical_takeover" : "original", status: historical ? "draft" : "effective", effectiveAt: historical ? null : new Date(), amountCents: 10000n, draftData: {}, templateSnapshot: {}, clauseSnapshot: [] } });
    const terms = await db.paymentTermsVersion.create({ data: { contractId: c.id, contractVersionId: v.id, versionNo: 1, status: historical ? "draft" : "effective", originalText: "测试" } });
    return { c, v, terms };
  }
  async function settlement() {
    const { c, v, terms } = await contract();
    const process = await db.contractSettlementProcess.create({ data: { contractId: c.id, contractVersionId: v.id, sequenceNo: 1 } });
    const draft = await db.settlementDraft.create({ data: { projectId: project, contractId: c.id, contractVersionId: v.id, paymentTermsVersionId: terms.id, code: randomUUID(), periodLabel: "2026-10", ownerUserId: actor, lines: [], processId: process.id } });
    await db.contractSettlementProcess.update({ where: { id: process.id }, data: { settlementDraftId: draft.id } });
    return { draft, process };
  }
  async function file() {
    return db.fileObject.create({ data: { bucket: "local", objectKey: randomUUID(), originalName: "合成附件.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedByUserId: actor, contentSha256: "a".repeat(64) } });
  }
  const settlements = new SettlementDraftService(db as never, new AuditService());
  const takeovers = new ContractTakeoverService(db as never, new AuditService(), {} as never);
  run("删除带文件和明细的结算草稿，释放流程占位并保留审计", async () => {
    const { draft, process } = await settlement(); const f = await file(); const lineFile = await file();
    const line = await db.settlementDraftLine.create({ data: { settlementDraftId: draft.id, lineKey: "manual:1", sourceType: "manual_adjustment", name: "测试明细", calculationMode: "manual_adjustment", sortOrder: 1 } });
    await db.settlementLineAttachment.create({ data: { settlementDraftLineId: line.id, fileId: lineFile.id, purpose: "测试依据", uploadedByUserId: actor } });
    await db.settlementSignedDocument.create({ data: { settlementDraftId: draft.id, fileId: f.id, purpose: "frozen_counterparty_copy", generationStatus: "completed", contentSha256: f.contentSha256!, pageCount: 1, sourceRevision: 1, businessSnapshotToken: "test", generatedByUserId: actor } });
    expect(await settlements.abandon(project, draft.id, actor, { expectedRevision: 1, action: "delete_pristine_draft" })).toMatchObject({ status: "deleted" });
    expect(await db.settlementDraft.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await db.settlementDraftLine.count({ where: { settlementDraftId: draft.id } })).toBe(0);
    expect(await db.settlementLineAttachment.count({ where: { settlementDraftLineId: line.id } })).toBe(0);
    expect(await db.settlementSignedDocument.count({ where: { settlementDraftId: draft.id } })).toBe(0);
    expect(await db.contractSettlementProcess.findUnique({ where: { id: process.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { businessId: draft.id, action: "settlement.draft.delete" } })).toBe(1);
    expect(await db.fileObject.findUnique({ where: { id: f.id } })).not.toBeNull();
    const deletionAudit = await db.auditLog.findFirstOrThrow({ where: { businessId: draft.id, action: "settlement.draft.delete" } });
    expect(deletionAudit.metadata).toMatchObject({ projectId: project, previousStatus: "draft", deletedReferences: { lineIds: [line.id], processIds: [process.id] } });
    const auditedFiles = (deletionAudit.metadata as { files: Array<{ id: string; contentSha256: string }> }).files;
    expect(auditedFiles.map(item => item.id).sort()).toEqual([f.id, lineFile.id].sort());
    expect(auditedFiles.every(item => item.contentSha256 === "a".repeat(64))).toBe(true);
  });
  run("结算越权、过期版本和已提交均拒绝删除", async () => {
    const { draft } = await settlement();
    await expect(settlements.abandon(project, draft.id, other, { expectedRevision: 1, action: "delete_pristine_draft" })).rejects.toThrow();
    await expect(settlements.abandon(project, draft.id, actor, { expectedRevision: 2, action: "delete_pristine_draft" })).rejects.toThrow();
    const formal = await db.settlement.create({ data: { projectId: project, contractId: draft.contractId, contractVersionId: draft.contractVersionId, paymentTermsVersionId: draft.paymentTermsVersionId, code: randomUUID(), periodLabel: "2026-10", status: "approval_pending", amountCents: 100n, payableAmountCents: 100n } });
    await db.settlementDraft.update({ where: { id: draft.id }, data: { status: "submitted", submittedAt: new Date(), submittedSettlementId: formal.id } });
    await expect(settlements.abandon(project, draft.id, actor, { expectedRevision: 1, action: "delete_pristine_draft" })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { businessId: draft.id, action: "settlement.draft.delete" } })).toBe(0);
  });
  async function takeover() {
    const { c, v, terms } = await contract(true);
    const row = await db.contractTakeover.create({ data: { projectId: project, contractId: c.id, contractVersionId: v.id, paymentTermsVersionId: terms.id, takeoverLevel: "A", takeoverStatus: "draft", lifecycleStatus: "in_progress", signedAt: new Date(), createdByUserId: actor } });
    return { c, v, terms, row };
  }
  run("历史合同接管草稿和生成合同、附件关联彻底删除但保留审计", async () => {
    const { c, v, terms, row } = await takeover(); const f = await file();
    await db.archiveRecord.create({ data: { businessType: "contract_takeover", businessId: row.id, fileId: f.id, departmentScope: "historical_contract" } });
    expect(await takeovers.abandonDraft(project, row.id, { expectedUpdatedAt: row.updatedAt.toISOString(), action: "delete_pristine_draft" }, actor)).toMatchObject({ status: "deleted" });
    expect(await db.contractTakeover.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await db.contract.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.contractVersion.findUnique({ where: { id: v.id } })).toBeNull();
    expect(await db.paymentTermsVersion.findUnique({ where: { id: terms.id } })).toBeNull();
    expect(await db.archiveRecord.count({ where: { businessId: row.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { businessId: row.id, action: "contract_takeover.draft.delete" } })).toBe(1);
    expect(await db.contractNumberTombstone.count({ where: { formalCode: c.code! } })).toBe(1);
  });
  run("历史接管已确认或已激活，即使状态异常回到草稿也禁止删除", async () => {
    const { row } = await takeover();
    const changed = await db.contractTakeover.update({ where: { id: row.id }, data: { activatedAt: new Date(), activatedByUserId: actor, activationIdempotencyKey: randomUUID() } });
    await expect(takeovers.abandonDraft(project, row.id, { expectedUpdatedAt: changed.updatedAt.toISOString(), action: "delete_pristine_draft" }, actor)).rejects.toThrow();
    expect(await db.contractTakeover.count({ where: { id: row.id } })).toBe(1);
  });
  run("父接管仍是草稿但子付款已激活时整笔拒绝删除", async () => {
    const { row, c } = await takeover();
    const payment = await db.$transaction(async tx => {
      const payment = await tx.contractTakeoverHistoricalPayment.create({ data: { takeoverId: row.id, rowKey: randomUUID(), sequenceNo: 1, amountCents: 100n, paidAt: new Date(), status: "activated", activatedAt: new Date() } });
      await tx.contractTakeoverHistoricalPaymentAllocation.create({ data: { historicalPaymentId: payment.id, allocationType: "settlement", amountCents: 100n, allocationOrder: 1 } });
      return payment;
    });
    await expect(takeovers.abandonDraft(project, row.id, { expectedUpdatedAt: row.updatedAt.toISOString(), action: "delete_pristine_draft" }, actor)).rejects.toThrow();
    expect(await db.contractTakeoverHistoricalPayment.count({ where: { id: payment.id } })).toBe(1);
    expect(await db.contract.count({ where: { id: c.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { businessId: row.id, action: "contract_takeover.draft.delete" } })).toBe(0);
  });
  async function spot(approved = false) {
    const p = await db.spotProcurement.create({ data: { projectId: project, code: randomUUID(), applicantUserId: actor, handlerUserId: actor, status: approved ? "approved_in_progress" : "draft", supplierKey: "test-supplier", supplierNameSnapshot: "合成供应商" } });
    const v = await db.spotProcurementVersion.create({ data: { procurementId: p.id, versionNo: 1, status: approved ? "approved" : "draft", reason: "测试", handlerUserId: actor, createdByUserId: actor, applicationDepartmentSnapshot: "测试", applicationNameSnapshot: "测试", purchaserNameSnapshot: "测试", purchaserDepartmentNameSnapshot: "测试", requestedArrivalAt: new Date(), supplierKey: "test-supplier", supplierNameSnapshot: "合成供应商", totalAmountCents: 1000n } });
    await db.spotProcurement.update({ where: { id: p.id }, data: { currentVersionId: v.id } });
    return { p, v };
  }
  async function payment() {
    const { p, v } = await spot(true);
    const pay = await db.spotProcurementPayment.create({ data: { projectId: project, procurementId: p.id, procurementVersionId: v.id, code: randomUUID(), handlerUserId: actor, createdByUserId: actor, settlementAmountCents: 100n, supplierBalanceAmountCents: 100n } });
    return { p, v, pay };
  }
  run("零采申请删除实际移除版本明细附件，保留审计来源", async () => {
    const { p, v } = await spot(); const f = await file();
    await db.spotProcurementLine.create({ data: { versionId: v.id, sortOrder: 1, materialName: "测试材料", unit: "件", quantity: 1 } });
    await db.spotProcurementAttachment.create({ data: { versionId: v.id, fileId: f.id, category: "application_attachment", uploadedByUserId: actor } });
    const [result] = await db.$queryRaw<Array<{ deleted: boolean }>>(Prisma.sql`SELECT public.jg_delete_unsubmitted_spot_procurement(${p.id},${actor}) AS deleted`);
    expect(result.deleted).toBe(true);
    expect(await db.spotProcurement.count({ where: { id: p.id } })).toBe(0);
    expect(await db.spotProcurementVersion.count({ where: { id: v.id } })).toBe(0);
    expect(await db.spotProcurementLine.count({ where: { versionId: v.id } })).toBe(0);
    expect(await db.spotProcurementAttachment.count({ where: { versionId: v.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { businessId: p.id, action: "spot_procurement.draft.delete" } })).toBe(1);
    expect(await db.spotProcurementAuditSource.count({ where: { id: p.id } })).toBe(1);
  });
  run("零采申请其他经办人及审批历史均不允许硬删", async () => {
    const { p, v } = await spot();
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_spot_procurement(${p.id},${other}) AS deleted`)).toEqual([{ deleted: false }]);
    await db.spotProcurementVersion.update({ where: { id: v.id }, data: { submittedAt: new Date() } });
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_spot_procurement(${p.id},${actor}) AS deleted`)).toEqual([{ deleted: false }]);
  });
  run("付款删除通过原余额服务释放预占；余额、完整账序和审计引用保留", async () => {
    const { p, pay } = await payment();
    const balances = new SpotProcurementBalanceService(db as never, new AuditService());
    const account = await db.supplierBalanceAccount.upsert({ where: { projectId_supplierKey: { projectId: project, supplierKey: "test-supplier" } }, create: { projectId: project, supplierKey: "test-supplier", supplierNameSnapshot: "合成供应商", availableAmountCents: 1000n }, update: {} });
    await db.$transaction(tx => balances.reserve(tx, { projectId: project, supplierKey: "test-supplier", paymentId: pay.id, procurementId: p.id, amountCents: 100n, actorUserId: actor }));
    await expect(db.spotProcurementPayment.delete({ where: { id: pay.id } })).rejects.toThrow();
    const service = new SpotProcurementPaymentService(db as never, new AuditService(), { assertEnabled: () => undefined } as never, balances, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await service.abandonDraft(pay.id, actor, { expectedUpdatedAt: pay.updatedAt.toISOString(), reason: "不再申请" })).toMatchObject({ deleted: true });
    expect(await db.spotProcurementPayment.count({ where: { id: pay.id } })).toBe(0);
    expect(await db.supplierBalanceAccount.findUnique({ where: { id: account.id } })).toMatchObject({ availableAmountCents: 1000n, reservedAmountCents: 0n });
    const entries = await db.supplierBalanceEntry.findMany({ where: { paymentId: pay.id }, orderBy: { sequenceNo: "asc" } });
    expect(entries.map(e => [e.entryType,e.reservedDeltaCents])).toEqual([["reserve",100n],["release",-100n]]);
    expect(await db.supplierBalanceReservation.findUnique({ where: { paymentId: pay.id } })).toMatchObject({ status: "released", releasedAmountCents: 100n });
    expect(await db.spotPaymentAuditSource.findUnique({ where: { id: pay.id } })).toMatchObject({ code: pay.code, procurementId: p.id });
    expect(await db.auditLog.count({ where: { businessId: pay.id, action: "spot_procurement.payment.draft.delete" } })).toBe(1);
    await expect(db.supplierBalanceEntry.create({ data: { ...entries[0], id: randomUUID(), sequenceNo: 999n } })).rejects.toThrow();
    await expect(db.spotPaymentAuditSource.delete({ where: { id: pay.id } })).rejects.toThrow();
  });
  run("删除末端校验失败时原预占释放与审计同事务回滚", async () => {
    const { p, pay } = await payment();
    const balances = new SpotProcurementBalanceService(db as never, new AuditService());
    await db.$transaction(tx => balances.reserve(tx, { projectId: project, supplierKey: "test-supplier", paymentId: pay.id, procurementId: p.id, amountCents: 100n, actorUserId: actor }));
    const before = await db.supplierBalanceAccount.findUniqueOrThrow({ where: { projectId_supplierKey: { projectId: project, supplierKey: "test-supplier" } } });
    const changed = await db.spotProcurementPayment.update({ where: { id: pay.id }, data: { approvedAt: new Date() } });
    const service = new SpotProcurementPaymentService(db as never, new AuditService(), { assertEnabled: () => undefined } as never, balances, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.abandonDraft(pay.id, actor, { expectedUpdatedAt: changed.updatedAt.toISOString(), reason: "合成删除失败" })).rejects.toThrow();
    expect(await db.supplierBalanceAccount.findUnique({ where: { id: before.id } })).toMatchObject({ availableAmountCents: before.availableAmountCents, reservedAmountCents: before.reservedAmountCents });
    expect(await db.supplierBalanceReservation.findUnique({ where: { paymentId: pay.id } })).toMatchObject({ status: "reserved", releasedAmountCents: 0n });
    expect(await db.supplierBalanceEntry.count({ where: { paymentId: pay.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { businessId: pay.id, action: "spot_procurement.payment.draft.delete" } })).toBe(0);
  });
  run("已有付款金额或审批时间的付款草稿禁止删除", async () => {
    const { pay } = await payment();
    const changed = await db.spotProcurementPayment.update({ where: { id: pay.id }, data: { approvedAt: new Date() } });
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_spot_payment(${pay.id},${actor},${changed.updatedAt}::timestamp,'测试') AS deleted`)).toEqual([{ deleted: false }]);
  });
  run("并发重复删除只成功一次且只有一份审计", async () => {
    const { draft } = await settlement();
    const results = await Promise.allSettled([1,2].map(() => settlements.abandon(project,draft.id,actor,{ expectedRevision: 1, action: "delete_pristine_draft" })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.settlementDraft.count({ where: { id: draft.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { businessId: draft.id, action: "settlement.draft.delete" } })).toBe(1);
  });
  run("删除先获锁时旧窗口的保存不会复活草稿", async () => {
    const { draft } = await settlement();
    let signal!: () => void; let release!: () => void;
    const reached = new Promise<void>(resolve => { signal=resolve; });
    const gate = new Promise<void>(resolve => { release=resolve; });
    const deleting = db.$transaction(async tx => {
      const result = await tx.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_settlement(${draft.id},${actor},1::integer) AS deleted`);
      signal(); await gate; return result;
    });
    await reached;
    const saving = db.settlementDraft.updateMany({ where: { id: draft.id, status: "draft", revision: 1 }, data: { revision: { increment: 1 } } });
    release();
    expect(await deleting).toEqual([{ deleted: true }]);
    expect((await saving).count).toBe(0);
  });
  run("受限身份只能执行窄删除函数且不能绕过所有者和版本校验", async () => {
    const { draft } = await settlement(); const role = `draft_delete_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
    try {
      await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await db.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_settlement(TEXT,TEXT,INTEGER) TO "${role}"`);
      const deleted = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        expect(await tx.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_settlement(${draft.id},${other},1::integer) AS deleted`)).toEqual([{ deleted: false }]);
        expect(await tx.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_settlement(${draft.id},${actor},NULL::integer) AS deleted`)).toEqual([{ deleted: false }]);
        return tx.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_settlement(${draft.id},${actor},1::integer) AS deleted`);
      });
      expect(deleted).toEqual([{ deleted: true }]);
    } finally { await db.$executeRawUnsafe(`DROP OWNED BY "${role}"`); await db.$executeRawUnsafe(`DROP ROLE "${role}"`); }
  });

  run("税务修订草稿实际删除，已进入复核的版本保留", async () => {
    const { c, v, row } = await takeover();
    const rev = await db.contractTaxFactRevision.create({ data: { projectId: project, contractId: c.id, contractVersionId: v.id, revisionNo: 1, kind: "supplement", rowFacts: [], beforeSnapshot: {}, createdByUserId: actor } });
    const service = new ContractTaxFactsService(db as never, new AuditService());
    expect(await service.abandon(project,row.id,rev.id,{ expectedUpdatedAt: rev.updatedAt.toISOString(), action: "delete_pristine_draft" },actor)).toMatchObject({ deleted: true });
    expect(await db.contractTaxFactRevision.count({ where: { id: rev.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { businessId: rev.id, action: "contract.tax_fact_revision.draft.delete" } })).toBe(1);
    const reviewed = await db.contractTaxFactRevision.create({ data: { projectId: project, contractId: c.id, contractVersionId: v.id, revisionNo: 2, kind: "supplement", rowFacts: [], beforeSnapshot: {}, createdByUserId: actor, submittedAt: new Date() } });
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_tax_revision(${reviewed.id},${actor},${reviewed.updatedAt}::timestamp) AS deleted`)).toEqual([{ deleted: false }]);
    expect(await db.contractTaxFactRevision.count({ where: { id: reviewed.id } })).toBe(1);
  });
  run("税务草稿删除后真实新建不复用审计修订号", async () => {
    const { row } = await takeover();
    const service = new ContractTaxFactsService(db as never, new AuditService());
    const input = { kind: "supplement" as const, invoiceType: "vat_special" as const, taxMode: "single_rate" as const, defaultTaxRatePercent: "13", source: "business_finance_confirmation" as const, confirmationExplanation: "合成测试确认说明" };
    const first = await service.create(project, row.id, input, actor);
    await service.abandon(project, row.id, first.id, { expectedUpdatedAt: first.updatedAt.toISOString(), action: "delete_pristine_draft" }, actor);
    const second = await service.create(project, row.id, input, actor);
    expect(second.revisionNo).toBe(first.revisionNo + 1);
  });
  run("真实创建的待复核经营接管批次可由本人删除，其他岗位不能删除", async () => {
    const service = new OperatingTakeoverService(db as never, { validateDraft: async () => ({ valid: true, definitionVersion: 1, errors: [] }), validateDraftWithRoles: async () => ({ valid: true, definitionVersion: 1, errors: [] }) } as never,
      { effectiveRoleKeys: async (id: string) => id === actor ? ["contract_director"] : ["employee"] } as never, {} as never, {} as never, new AuditService());
    const created = await service.createBatch(project, actor, { batchNo: randomUUID(), rows: [{ sceneKey: "historical_expense", definitionVersion: 1, values: { businessRef: randomUUID(), occurredAt: "2026-08-01", amountYuan: "100.00", counterpartyName: "合成供应商", costCategoryCode: "material", evidenceLevel: "A", sourceDescription: "合成历史依据" } }] });
    expect(created.status).toBe("under_review");
    expect(created.canDeleteDraft).toBe(true);
    await expect(service.deleteDraft(project, created.id, other, created.revision)).rejects.toThrow();
    expect(await service.deleteDraft(project, created.id, actor, created.revision)).toEqual({ id: created.id, deleted: true });
    expect(await db.operatingTakeoverBatch.count({ where: { id: created.id } })).toBe(0);
  });
  run("经营接管批次连同明细问题和附件关联删除；确认后拒绝删除", async () => {
    const batch = await db.operatingTakeoverBatch.create({ data: { projectId: project, batchNo: randomUUID(), sceneKeys: ["historical_expense"], importFingerprint: randomUUID(), createdByUserId: actor } });
    const row = await db.operatingTakeoverRow.create({ data: { batchId: batch.id, rowNo: 1, sceneKey: "historical_expense", definitionVersion: 1, valuesSnapshot: {}, evidenceLevel: "A" } });
    await db.operatingTakeoverIssue.create({ data: { batchId: batch.id, rowId: row.id, code: "test", severity: "warning", message: "合成问题" } });
    const group = await db.operatingTakeoverAttachmentGroup.create({ data: { batchId: batch.id, rowId: row.id, purpose: "合成附件", createdByUserId: actor } });
    const f = await file();
    await db.operatingTakeoverAttachmentLink.create({ data: { groupId: group.id, fileId: f.id } });
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_operating_batch(${batch.id},${other},${project},1::integer) AS deleted`)).toEqual([{ deleted: false }]);
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_operating_batch(${batch.id},${actor},${project},1::integer) AS deleted`)).toEqual([{ deleted: true }]);
    expect(await db.operatingTakeoverBatch.count({ where: { id: batch.id } })).toBe(0);
    expect(await db.operatingTakeoverRow.count({ where: { batchId: batch.id } })).toBe(0);
    expect(await db.operatingTakeoverAttachmentLink.count({ where: { groupId: group.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { businessId: batch.id, action: "operating_takeover.draft.delete" } })).toBe(1);
    const confirmed = await db.operatingTakeoverBatch.create({ data: { projectId: project, batchNo: randomUUID(), sceneKeys: [], importFingerprint: randomUUID(), createdByUserId: actor } });
    await db.operatingTakeoverConfirmation.create({ data: { batchId: confirmed.id, idempotencyKey: randomUUID(), profession: "finance", revision: 1, snapshot: {}, confirmedByUserId: actor } });
    expect(await db.$queryRaw(Prisma.sql`SELECT public.jg_delete_unsubmitted_operating_batch(${confirmed.id},${actor},${project},1::integer) AS deleted`)).toEqual([{ deleted: false }]);
  });

});
