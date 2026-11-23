import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ProjectConstructionEnterpriseDeductionService } from "../project/project-construction-enterprise-deduction.service";
import { ProjectUpstreamFundBusinessEntryService } from "../project/project-upstream-fund-business-entry.service";
import { ProjectConstructionPaymentCorrectionService } from "../project/project-construction-payment-correction.service";
import { ProjectUpstreamFundFactOperatingSourceAdapter } from "../project/project-operating-source.adapter";
import { readConstructionEnterprisePaid } from "../project/project-construction-enterprise-paid";
import { ProjectService } from "../project/project.service";

/**
 * #414 真库证据（真实 PostgreSQL 16）：
 * 1) 综合/财务按费用名称 + 实际金额简单登记施工企业扣费，登记后待确认；
 * 2) 同费用名称 + 同金额 + 同日期重复登记被拒，同幂等键只回放原事实；
 * 3) 财务主管确认后才减少施工企业持有资金；不产生已确认成本；
 * 4) #413 两段式更正（反转 + 重登）后扣费净额正确，原记录保留；
 * 5) 扣费登记/确认/更正都不改变施工企业已付聚合。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue414-construction-deduction-local.cjs
 */
describe("issue 414 construction enterprise deduction PostgreSQL", () => {
  const integrationTest =
    process.env.RUN_ISSUE414_CONSTRUCTION_DEDUCTION_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "registers, rejects duplicates, corrects and keeps paid aggregation unchanged",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const fixture = fixtureIds();
      try {
        await prisma.$connect();
        await seedFixture(prisma, fixture);
        const auth = {
          confirmPassword: async (_userId: string, password: string) => {
            if (password !== "current-password") throw new Error("密码错误");
          }
        };
        const deductions = new ProjectConstructionEnterpriseDeductionService(
          prisma as never,
          new AuditService(),
          new ProjectUpstreamFundBusinessEntryService(new AuditService())
        );
        const projects = new ProjectService(
          prisma as never,
          new AuditService(),
          auth as never,
          undefined,
          {
            appendConfirmedSourceIfEnabledInTransaction: async () => null
          } as never
        );
        const corrections = new ProjectConstructionPaymentCorrectionService(
          prisma as never,
          new AuditService(),
          auth as never,
          {
            appendConfirmedSourceIfEnabledInTransaction: async () => null
          } as never
        );

        // 1) 简单登记：费用名称 + 实际金额 + 日期，无需先有合同或结算。
        const deduction = await deductions.recordDeduction(
          fixture.projectId,
          fixture.financeUserId,
          {
            feeName: "管理费",
            amountCents: "5000",
            occurredAt: "2026-11-20T00:00:00.000Z",
            idempotencyKey: fixture.idempotencyKey
          }
        );
        expect(deduction).toMatchObject({
          feeName: "管理费",
          amountCents: "5000",
          status: "pending_confirm",
          basisType: "oral",
          counterpartyName: fixture.affiliateName
        });
        const paidBefore = await readConstructionEnterprisePaid(
          prisma as never,
          fixture.projectId
        );
        assert.equal(paidBefore.summary.paidCents, 80000n);
        const heldBefore = await constructionHeldFunds(
          prisma,
          fixture.projectId,
          fixture.ownerPaymentId
        );
        assert.equal(heldBefore, 100000n);

        // 2) 同费用名称、金额和日期换幂等键重复登记被拒；同幂等键只回放。
        await expect(
          deductions.recordDeduction(fixture.projectId, fixture.financeUserId, {
            feeName: "管理费",
            amountCents: "5000",
            occurredAt: "2026-11-20T00:00:00.000Z",
            idempotencyKey: randomUUID()
          })
        ).rejects.toThrow("相同费用名称、金额和日期的施工企业扣费已登记");
        const replay = await deductions.recordDeduction(
          fixture.projectId,
          fixture.financeUserId,
          {
            feeName: "管理费",
            amountCents: "5000",
            occurredAt: "2026-11-20T00:00:00.000Z",
            idempotencyKey: fixture.idempotencyKey
          }
        );
        expect(replay.id).toBe(deduction.id);

        // 3) 确认前不进入资金口径；确认后才减少施工企业持有资金，且不产成本。
        const pendingList = await deductions.listDeductions(fixture.projectId);
        expect(pendingList.summary).toEqual({
          deductedCents: "0",
          pendingCents: "5000"
        });
        assert.equal(
          await constructionHeldFunds(prisma, fixture.projectId, fixture.ownerPaymentId),
          100000n
        );

        await projects.confirmUpstreamFundFact(
          fixture.projectId,
          deduction.id,
          fixture.directorUserId,
          {
            confirmationPassword: "current-password",
            confirmationActionId: randomUUID()
          }
        );
        const confirmedList = await deductions.listDeductions(fixture.projectId);
        expect(confirmedList.summary).toEqual({
          deductedCents: "5000",
          pendingCents: "0"
        });
        assert.equal(
          await constructionHeldFunds(prisma, fixture.projectId, fixture.ownerPaymentId),
          95000n
        );
        const deductionImpacts = await sourceImpacts(prisma, fixture.projectId, deduction.id);
        expect(deductionImpacts.map((impact) => impact.impactKind)).toEqual([
          "construction_enterprise_funds_decrease"
        ]);
        expect(
          deductionImpacts.some((impact) => impact.impactKind === "confirmed_cost")
        ).toBe(false);
        const paidAfterConfirm = await readConstructionEnterprisePaid(
          prisma as never,
          fixture.projectId
        );
        assert.equal(paidAfterConfirm.summary.paidCents, 80000n);

        // 4) 更正：反转 5000 + 重登 4000；原记录保留，净额 4000。
        const correction = await corrections.requestCorrection(
          fixture.projectId,
          fixture.financeUserId,
          {
            sourceType: "affiliate_deduction",
            originalFactId: deduction.id,
            correctionReason: "金额登记多记 10 元",
            idempotencyKey: randomUUID(),
            feeName: "管理费",
            amountCents: "4000"
          }
        );
        expect(correction).toMatchObject({
          status: "pending_confirm",
          correctionMode: "reversal_and_re_register"
        });
        await corrections.confirmCorrection(
          fixture.projectId,
          "affiliate_deduction",
          deduction.id,
          fixture.directorUserId,
          {
            confirmationPassword: "current-password",
            confirmationActionId: randomUUID()
          }
        );
        const original = await prisma.projectUpstreamFundFact.findUnique({
          where: { id: deduction.id }
        });
        expect(original).toMatchObject({
          status: "confirmed",
          amountCents: 5000n,
          description: "管理费"
        });
        const adjustmentRows = await prisma.projectUpstreamFundFact.findMany({
          where: { adjustsFactId: deduction.id },
          orderBy: { entryKind: "asc" }
        });
        expect(
          adjustmentRows.map((fact) => [fact.entryKind, fact.amountCents, fact.description])
        ).toEqual([
          ["correction", 4000n, "管理费"],
          ["reversal", 5000n, "管理费"]
        ]);
        const correctedList = await deductions.listDeductions(fixture.projectId);
        expect(correctedList.summary).toEqual({
          deductedCents: "4000",
          pendingCents: "0"
        });
        assert.equal(
          await constructionHeldFunds(prisma, fixture.projectId, fixture.ownerPaymentId),
          96000n
        );
        const correctedPaid = await readConstructionEnterprisePaid(
          prisma as never,
          fixture.projectId
        );
        assert.equal(correctedPaid.summary.paidCents, 80000n);
        expect(
          correctedPaid.entries.some(
            (entry) => entry.counterpartyName === fixture.affiliateName
          )
        ).toBe(false);
      } finally {
        await prisma.$disconnect();
      }
    },
    120_000
  );
});

function assertDedicatedDatabase() {
  const databaseUrl =
    process.env.ISSUE414_CONSTRUCTION_DEDUCTION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("ISSUE-414 测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/jiangkong_issue414_construction_deduction"
  ) {
    throw new Error("ISSUE-414 测试只允许本机一次性 PostgreSQL 16 专库");
  }
  return databaseUrl;
}

function fixtureIds() {
  const prefix = `issue414_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    projectId: `${prefix}_project`,
    projectCode: `JG-414-${prefix.slice(-8).toUpperCase()}`,
    financeUserId: `${prefix}_finance`,
    directorUserId: `${prefix}_director`,
    affiliateName: `施工企业 ${prefix}`,
    affiliateAssignmentId: `${prefix}_assignment`,
    affiliateVersionId: `${prefix}_version`,
    signatureFileId: `${prefix}_signature_file`,
    signatureVersionId: `${prefix}_signature_version`,
    ownerPaymentId: `${prefix}_owner_payment`,
    paidFactId: `${prefix}_paid_fact`,
    idempotencyKey: `${prefix}_deduction_idempotency`
  };
}

async function seedFixture(prisma: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  const sha = "a".repeat(64);
  const now = new Date("2026-11-23T00:00:00.000Z");
  await prisma.project.create({
    data: {
      id: fixture.projectId,
      code: fixture.projectCode,
      name: `#414 真库项目 ${fixture.prefix}`,
      operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  await prisma.user.createMany({
    data: [
      { id: fixture.financeUserId, name: "财务经办" },
      { id: fixture.directorUserId, name: "财务主管" }
    ]
  });
  await prisma.projectMember.createMany({
    data: [
      {
        projectId: fixture.projectId,
        userId: fixture.financeUserId,
        positionKey: "finance_staff"
      },
      {
        projectId: fixture.projectId,
        userId: fixture.directorUserId,
        positionKey: "finance_director"
      }
    ]
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: fixture.affiliateAssignmentId,
      projectId: fixture.projectId,
      businessPartyId: `${fixture.prefix}_party`,
      businessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "初始施工企业",
      assignedByUserId: fixture.directorUserId
    }
  });
  await prisma.fileObject.create({
    data: {
      id: fixture.signatureFileId,
      bucket: "private",
      objectKey: `issue414/${fixture.prefix}/signature.png`,
      originalName: "signature.png",
      mimeType: "image/png",
      sizeBytes: 128,
      uploadedByUserId: fixture.directorUserId,
      contentSha256: sha,
      storageStatus: "active"
    }
  });
  await prisma.handwrittenSignatureVersion.create({
    data: {
      id: fixture.signatureVersionId,
      userId: fixture.directorUserId,
      fileId: fixture.signatureFileId,
      contentSha256: sha,
      source: "canvas"
    }
  });
  const confirmed = {
    status: "confirmed",
    confirmedByUserId: fixture.directorUserId,
    confirmedAt: now,
    confirmationActionId: `${fixture.prefix}_confirmation`,
    confirmationSignatureVersionId: fixture.signatureVersionId,
    confirmationSignatureFileId: fixture.signatureFileId,
    confirmationSignatureSha256: sha
  };
  // 业主已付施工 100000 元（OPS-10 的资金底数）。
  await prisma.projectUpstreamFundFact.create({
    data: {
      id: fixture.ownerPaymentId,
      projectId: fixture.projectId,
      factType: "owner_payment_to_affiliate",
      entryKind: "original",
      effectDirection: "increase",
      occurredAt: new Date("2026-11-01T00:00:00.000Z"),
      amountCents: 100000n,
      counterpartyName: fixture.affiliateName,
      basisType: "written",
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      idempotencyKey: `${fixture.prefix}_owner_payment`,
      requestFingerprint: sha,
      recordedByUserId: fixture.financeUserId,
      recordedByRoleKey: "finance_staff",
      ...confirmed,
      confirmationActionId: `${fixture.prefix}_owner_payment_confirmation`
    }
  });
  // 施工企业已付 80000 元（独立事实族，用于证明扣费不改变已付聚合）。
  await prisma.projectAffiliatePaymentFact.create({
    data: {
      id: fixture.paidFactId,
      ledgerId: `${fixture.prefix}_ledger`,
      projectId: fixture.projectId,
      contractLedgerId: `${fixture.prefix}_contract`,
      entryKind: "original",
      effectDirection: "increase",
      counterpartyName: "下游供应商",
      paidAt: new Date("2026-11-05T00:00:00.000Z"),
      amountCents: 80000n,
      paymentKind: "normal",
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      basisType: "written",
      idempotencyKey: `${fixture.prefix}_paid`,
      requestFingerprint: sha,
      recordedByUserId: fixture.financeUserId,
      recordedByRoleKey: "finance_staff",
      ...confirmed,
      confirmationActionId: `${fixture.prefix}_paid_confirmation`
    }
  });
}

async function sourceImpacts(
  prisma: PrismaClient,
  projectId: string,
  sourceBusinessId: string
) {
  const adapter = new ProjectUpstreamFundFactOperatingSourceAdapter();
  const snapshot = await adapter.readSourceSnapshot(prisma as never, {
    projectId,
    sourceType: adapter.sourceType,
    sourceBusinessId
  });
  expect(snapshot).not.toBeNull();
  return adapter.toOperatingFactInput(snapshot!).input.impacts;
}

/**
 * 用真实经营来源适配器汇总施工企业持有资金：
 * 业主付施工增加，施工转我方/施工企业扣费减少；不读取任何手工预期值。
 */
async function constructionHeldFunds(
  prisma: PrismaClient,
  projectId: string,
  ownerPaymentId: string
) {
  const facts = await prisma.projectUpstreamFundFact.findMany({
    where: {
      projectId,
      factType: { in: ["owner_payment_to_affiliate", "affiliate_remittance_to_company", "affiliate_deduction"] },
      status: "confirmed",
      confirmedByUserId: { not: null },
      confirmedAt: { not: null }
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
  });
  let total = 0n;
  for (const fact of facts) {
    const impacts = await sourceImpacts(prisma, projectId, fact.id);
    for (const impact of impacts) {
      const amountCents = impact.amountCents;
      if (amountCents === null) {
        throw new Error(`施工企业资金影响缺少金额：${impact.impactKind}`);
      }
      if (
        impact.impactKind === "construction_enterprise_funds_increase" ||
        impact.impactKind === "construction_enterprise_funds_decrease"
      ) {
        total += impact.direction === "decrease" ? -amountCents : amountCents;
      }
    }
  }
  expect(facts.some((fact) => fact.id === ownerPaymentId)).toBe(true);
  return total;
}
