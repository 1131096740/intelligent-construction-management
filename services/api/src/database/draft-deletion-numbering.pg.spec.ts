import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { SpotProcurementApplicationService } from "../spot-procurement/spot-procurement-application.service";
import { SpotProcurementBalanceService } from "../spot-procurement/spot-procurement-balance.service";
import { SpotProcurementPaymentService } from "../spot-procurement/spot-procurement-payment.service";

const run = process.env.RUN_POL115_ENTRY_PG16 === "1" ? it : it.skip;
describe("硬删草稿后的业务编号 PostgreSQL 回归", () => {
  const db = new PrismaClient();
  const actor = randomUUID();
  const projectId = randomUUID();
  const pilot = { assertEnabled: () => undefined };
  const audit = new AuditService();
  const balances = new SpotProcurementBalanceService(db as never, audit);
  const payments = new SpotProcurementPaymentService(db as never, audit, pilot as never, balances, {} as never, {} as never, {} as never, {} as never, {} as never);
  // Entry-definition validation is not the subject of this numbering test. Domain
  // ownership, locking, database constraints, creation, deletion and audits are real.
  const applications = new SpotProcurementApplicationService(db as never, audit, pilot as never, {} as never, undefined, balances, undefined, { validateDraftInTransaction: async () => ({ valid: true, errors: [] }) } as never);
  beforeAll(async () => {
    if (process.env.RUN_POL115_ENTRY_PG16 !== "1") return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_entry_test") throw new Error("只能使用本机一次性测试库");
    await db.user.create({ data: { id: actor, name: "编号回归物资员" } });
    await db.project.create({ data: { id: projectId, code: projectId, name: "编号回归隔离项目" } });
    const party = await db.businessParty.create({ data: { name: "合成施工企业", normalizedName: randomUUID(), createdByUserId: actor } });
    const partyVersion = await db.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: {}, createdByUserId: actor } });
    await db.projectAffiliateAssignment.create({ data: { projectId, businessPartyId: party.id, businessPartyVersionId: partyVersion.id, affiliateNameSnapshot: party.name, effectiveFrom: new Date("2020-01-01"), changeReason: "本地测试", assignedByUserId: actor } });
    await db.projectMember.create({ data: { projectId, userId: actor, positionKey: "material_staff" } });
  });
  afterAll(async () => { await db.$disconnect(); });

  async function approvedProcurement() {
    const p = await db.spotProcurement.create({ data: { projectId, code: randomUUID(), applicantUserId: actor, handlerUserId: actor, status: "approved_in_progress", supplierKey: "numbering-supplier", supplierNameSnapshot: "合成供应商" } });
    const v = await db.spotProcurementVersion.create({ data: { procurementId: p.id, versionNo: 1, status: "approved", reason: "测试", handlerUserId: actor, createdByUserId: actor, applicationDepartmentSnapshot: "测试", applicationNameSnapshot: "测试", purchaserNameSnapshot: "测试", purchaserDepartmentNameSnapshot: "测试", requestedArrivalAt: new Date(), supplierKey: "numbering-supplier", supplierNameSnapshot: "合成供应商", totalAmountCents: 1000n } });
    await db.spotProcurement.update({ where: { id: p.id }, data: { currentVersionId: v.id } });
    return p;
  }
  async function deletePayment(id: string) {
    const row = await db.spotProcurementPayment.findUniqueOrThrow({ where: { id } });
    await payments.abandonDraft(id, actor, { expectedUpdatedAt: row.updatedAt.toISOString(), reason: "编号回归删除" });
    expect(await db.spotProcurementPayment.findUnique({ where: { id } })).toBeNull();
  }
  run("付款草稿反复删除再新建时编号单调递增且审计保持一对一", async () => {
    const procurement = await approvedProcurement();
    for (let sequence = 1; sequence <= 4; sequence++) {
      const draft = await payments.createNextDraft(procurement.id, actor);
      expect(draft.code).toBe(`${procurement.code}-V1-P${String(sequence).padStart(3, "0")}`);
      await deletePayment(draft.id);
    }
    const five = await payments.createNextDraft(procurement.id, actor);
    expect(five.code).toBe(`${procurement.code}-V1-P005`);
    await expect(payments.createNextDraft(procurement.id, actor)).rejects.toThrow("零星采购付款数据已变化");
    expect(await db.spotProcurementPayment.count({ where: { procurementId: procurement.id, status: "draft" } })).toBe(1);
    const sources = await db.spotPaymentAuditSource.findMany({ where: { procurementId: procurement.id } });
    expect(sources).toHaveLength(5);
    expect(new Set(sources.map(source => source.code)).size).toBe(5);
    expect(await db.auditLog.count({ where: { action: "spot_procurement.payment.draft.delete", metadata: { path: ["procurementId"], equals: procurement.id } } })).toBe(4);
  });

  run("删除最后一张采购申请后新申请不复用旧日编号", async () => {
    const input = { projectId, applicationDepartment: "测试", applicationName: "编号回归物资员", requestedArrivalAt: new Date().toISOString(), reason: "合成申请", lines: [{ materialName: "合成材料", unit: "件", quantity: "1" }], attachments: [] };
    const first = await applications.createDraft(actor, input);
    await applications.abandonDraft(first.procurementId, actor, { action: "delete_pristine_draft" });
    expect(await db.spotProcurement.findUnique({ where: { id: first.procurementId } })).toBeNull();
    const second = await applications.createDraft(actor, input);
    const third = await applications.createDraft(actor, input);
    expect(second.code).not.toBe(first.code);
    expect(third.code).not.toBe(first.code);
    expect(Number(second.code.split("-").at(-1))).toBe(Number(first.code.split("-").at(-1)) + 1);
    expect(await db.spotProcurementAuditSource.findUnique({ where: { id: first.procurementId } })).toMatchObject({ code: first.code });
  });
});
