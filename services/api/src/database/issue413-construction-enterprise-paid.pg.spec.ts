import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ProjectAffiliateBusinessService } from "../project/project-affiliate-business.service";
import { ProjectConstructionPaymentCorrectionService } from "../project/project-construction-payment-correction.service";
import { readConstructionEnterprisePaid } from "../project/project-construction-enterprise-paid";

/**
 * #413 真库证据（真实 PostgreSQL 16）：
 * 1) 已结算 10 万、实际付 12 万——超付放开后登记并确认成功，返回超付 2 万；
 * 2) 同一外部付款重复登记被唯一约束拒绝，同幂等键重试只返回原事实；
 * 3) OPS-09 方案 A「反转 + 重登」后汇总金额正确、原记录保留；
 * 4) 付下游 + 转我方合并为施工企业已付，扣费不计入，超付按结算账本口径提示。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue413-construction-paid-local.cjs
 */
describe("issue 413 construction enterprise paid PostgreSQL", () => {
  const integrationTest =
    process.env.RUN_ISSUE413_CONSTRUCTION_PAID_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "allows overpayment, keeps duplicate registration closed, and re-registers a correction",
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
        const service = new ProjectAffiliateBusinessService(
          prisma as never,
          new AuditService(),
          auth as never
        );
        const corrections = new ProjectConstructionPaymentCorrectionService(
          prisma as never,
          new AuditService(),
          auth as never
        );

        // 1) 已结算 10 万，实际付 12 万：允许如实登记并提示超付 2 万。
        const overpaidPayment = await service.recordPaymentFact(
          fixture.projectId,
          fixture.financeUserId,
          {
            contractLedgerId: fixture.contractLedgerId,
            settlementLedgerId: fixture.settlementLedgerId,
            counterpartyName: fixture.counterpartyName,
            paidAt: "2026-11-01",
            amountCents: "120000",
            paymentKind: "normal",
            externalPaymentReference: "BANK-413-OVERPAID-001",
            basisType: "oral",
            idempotencyKey: randomUUID()
          }
        );
        expect(overpaidPayment).toMatchObject({ status: "pending_confirm" });
        const confirmedOverpaidPayment = (await service.confirmPaymentFact(
          fixture.projectId,
          overpaidPayment.id,
          fixture.directorUserId,
          {
            confirmationPassword: "current-password",
            confirmationActionId: randomUUID()
          }
        )) as { settlementCoverage: { overpaidCents: string; overpaid: boolean } };
        expect(confirmedOverpaidPayment.settlementCoverage).toEqual({
          effectiveAmountCents: "100000",
          paidAmountCents: "120000",
          remittedAmountCents: "0",
          overpaidCents: "20000",
          overpaid: true
        });

        // 2) 同一笔外部付款不能再次登记；同幂等键重试只回放原事实。
        await expect(
          service.recordPaymentFact(fixture.projectId, fixture.financeUserId, {
            contractLedgerId: fixture.contractLedgerId,
            settlementLedgerId: fixture.settlementLedgerId,
            counterpartyName: fixture.counterpartyName,
            paidAt: "2026-11-01",
            amountCents: "120000",
            paymentKind: "normal",
            externalPaymentReference: "BANK-413-OVERPAID-001",
            basisType: "oral",
            idempotencyKey: randomUUID()
          })
        ).rejects.toThrow("同一外部付款已登记，不能跨项目或跨业务重复绑定");

        const secondLedgerPayment = await service.recordPaymentFact(
          fixture.projectId,
          fixture.financeUserId,
          {
            contractLedgerId: fixture.contractLedgerId,
            settlementLedgerId: fixture.settlementLedgerId2,
            counterpartyName: fixture.counterpartyName,
            paidAt: "2026-11-03",
            amountCents: "50000",
            paymentKind: "normal",
            externalPaymentReference: "BANK-413-SECOND-001",
            basisType: "oral",
            idempotencyKey: fixture.secondPaymentIdempotencyKey
          }
        );
        await service.confirmPaymentFact(
          fixture.projectId,
          secondLedgerPayment.id,
          fixture.directorUserId,
          {
            confirmationPassword: "current-password",
            confirmationActionId: randomUUID()
          }
        );
        const replay = await service.recordPaymentFact(
          fixture.projectId,
          fixture.financeUserId,
          {
            contractLedgerId: fixture.contractLedgerId,
            settlementLedgerId: fixture.settlementLedgerId2,
            counterpartyName: fixture.counterpartyName,
            paidAt: "2026-11-03",
            amountCents: "50000",
            paymentKind: "normal",
            externalPaymentReference: "BANK-413-SECOND-001",
            basisType: "oral",
            idempotencyKey: fixture.secondPaymentIdempotencyKey
          }
        );
        expect(replay.id).toBe(secondLedgerPayment.id);

        // 3) 更正方案 A：反转 + 重登；原 12 万记录保留，净额变为 11 万。
        const correction = await corrections.requestCorrection(
          fixture.projectId,
          fixture.financeUserId,
          {
            sourceType: "downstream_payment",
            originalFactId: overpaidPayment.id,
            correctionReason: "金额登记多记 1 万",
            idempotencyKey: randomUUID(),
            amountCents: "110000",
            occurredAt: "2026-11-02"
          }
        );
        expect(correction).toMatchObject({
          status: "pending_confirm",
          correctionMode: "reversal_and_re_register"
        });
        await corrections.confirmCorrection(
          fixture.projectId,
          "downstream_payment",
          overpaidPayment.id,
          fixture.directorUserId,
          {
            confirmationPassword: "current-password",
            confirmationActionId: randomUUID()
          }
        );
        const originalAfterCorrection =
          await prisma.projectAffiliatePaymentFact.findUnique({
            where: { id: overpaidPayment.id }
          });
        expect(originalAfterCorrection).toMatchObject({
          status: "confirmed",
          amountCents: 120000n
        });
        const correctionFacts = await prisma.projectAffiliatePaymentFact.findMany({
          where: { adjustsFactId: overpaidPayment.id },
          orderBy: { entryKind: "asc" }
        });
        expect(correctionFacts.map((fact) => [fact.entryKind, fact.amountCents])).toEqual([
          ["correction", 110000n],
          ["reversal", 120000n]
        ]);

        // 自审规则：财务主管本人提出必须填写原因，填了原因才可确认。
        const selfCorrection = await corrections.requestCorrection(
          fixture.projectId,
          fixture.directorUserId,
          {
            sourceType: "downstream_payment",
            originalFactId: secondLedgerPayment.id,
            correctionReason: "日期登记错误",
            idempotencyKey: randomUUID(),
            amountCents: "40000"
          }
        );
        expect(selfCorrection.status).toBe("pending_confirm");
        await expect(
          corrections.confirmCorrection(
            fixture.projectId,
            "downstream_payment",
            secondLedgerPayment.id,
            fixture.directorUserId,
            {
              confirmationPassword: "current-password",
              confirmationActionId: randomUUID()
            }
          )
        ).rejects.toThrow("本人提出的施工企业付款更正自审必须填写原因");
        await expect(
          corrections.confirmCorrection(
            fixture.projectId,
            "downstream_payment",
            secondLedgerPayment.id,
            fixture.directorUserId,
            {
              confirmationPassword: "current-password",
              confirmationActionId: randomUUID(),
              selfReviewReason: "本人复核并确认日期与金额"
            }
          )
        ).resolves.toMatchObject({ status: "pending_confirm" });

        // 4) 施工企业已付 = 付下游（净 15 万）+ 转我方 5 万；扣费不计入。
        const paid = await readConstructionEnterprisePaid(prisma as never, fixture.projectId);
        assert.equal(paid.summary.downstreamCents, 150000n);
        assert.equal(paid.summary.remittanceCents, 50000n);
        assert.equal(paid.summary.paidCents, 200000n);
        assert.equal(paid.summary.overpaidCents, 10000n);
        expect(
          paid.entries.some((entry) => entry.kind === "affiliate_remittance_to_company")
        ).toBe(true);
        expect(
          paid.entries.some((entry) => entry.counterpartyName === "被排除的扣费")
        ).toBe(false);
      } finally {
        await prisma.$disconnect();
      }
    },
    120_000
  );
});

function assertDedicatedDatabase() {
  const databaseUrl = process.env.ISSUE413_CONSTRUCTION_PAID_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("ISSUE-413 测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  const orderedDatabase = process.env.JG_ISSUE413_ORDERED_DATABASE;
  if (orderedDatabase !== undefined) {
    if (
      !/^jg_task01_[a-f0-9]{32}$/u.test(orderedDatabase) ||
      parsed.protocol !== "postgresql:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.username !== "jg_task01_owner" ||
      parsed.pathname !== `/${orderedDatabase}` ||
      parsed.searchParams.getAll("sslmode").join(",") !== "require" ||
      parsed.searchParams.getAll("sslaccept").join(",") !== "strict"
    ) {
      throw new Error("ISSUE-413 测试需要本轮有序安装的 TLS 专库");
    }
    return databaseUrl;
  }
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/jiangkong_issue413_construction_paid"
  ) {
    throw new Error("ISSUE-413 测试只允许本机一次性 PostgreSQL 16 专库");
  }
  return databaseUrl;
}

function fixtureIds() {
  const prefix = `issue413_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    projectId: `${prefix}_project`,
    projectCode: `JG-413-${prefix.slice(-8).toUpperCase()}`,
    financeUserId: `${prefix}_finance`,
    directorUserId: `${prefix}_director`,
    contractLedgerId: `${prefix}_contract_ledger`,
    counterpartyName: `下游供应商 ${prefix}`,
    affiliateName: `施工企业 ${prefix}`,
    affiliatePartyId: `${prefix}_party`,
    affiliateAssignmentId: `${prefix}_assignment`,
    affiliateVersionId: `${prefix}_version`,
    settlementLedgerId: `${prefix}_settlement_ledger_1`,
    settlementLedgerId2: `${prefix}_settlement_ledger_2`,
    signatureFileId: `${prefix}_signature_file`,
    signatureVersionId: `${prefix}_signature_version`,
    secondPaymentIdempotencyKey: `${prefix}_second_payment_idempotency`
  };
}

async function seedFixture(prisma: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  const sha = "a".repeat(64);
  const now = new Date("2026-11-23T00:00:00.000Z");
  await prisma.project.create({
    data: {
      id: fixture.projectId,
      code: fixture.projectCode,
      name: `#413 真库项目 ${fixture.prefix}`
    }
  });
  await prisma.user.createMany({
    data: [
      { id: fixture.financeUserId, name: "财务经办" },
      { id: fixture.directorUserId, name: "财务主管" }
    ]
  });
  await prisma.businessParty.create({
    data: {
      id: fixture.affiliatePartyId,
      name: fixture.affiliateName,
      normalizedName: fixture.affiliateName,
      createdByUserId: fixture.directorUserId
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: fixture.affiliateVersionId,
      businessPartyId: fixture.affiliatePartyId,
      versionNo: 1,
      snapshot: { name: fixture.affiliateName },
      createdByUserId: fixture.directorUserId
    }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: fixture.affiliateAssignmentId,
      projectId: fixture.projectId,
      businessPartyId: fixture.affiliatePartyId,
      businessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "初始施工企业",
      assignedByUserId: fixture.directorUserId
    }
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
  await prisma.fileObject.create({
    data: {
      id: fixture.signatureFileId,
      bucket: "private",
      objectKey: `issue413/${fixture.prefix}/signature.png`,
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
  await prisma.projectAffiliateContractFact.create({
    data: {
      id: fixture.contractLedgerId,
      ledgerId: fixture.contractLedgerId,
      projectId: fixture.projectId,
      entryKind: "original",
      effectDirection: "increase",
      contractType: "labor_subcontract",
      externalContractReference: `EXT-413-${fixture.prefix}`,
      counterpartyName: fixture.counterpartyName,
      signedAt: new Date("2026-10-01T00:00:00.000Z"),
      amountNature: "fixed",
      amountCents: 1_000_000n,
      advanceAllowed: false,
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      basisType: "oral",
      idempotencyKey: `${fixture.prefix}_contract_idempotency`,
      requestFingerprint: sha,
      recordedByUserId: fixture.financeUserId,
      recordedByRoleKey: "finance_staff",
      ...confirmed
    }
  });
  for (const [ledgerId, amountCents, suffix] of [
    [fixture.settlementLedgerId, 100_000n, "1"],
    [fixture.settlementLedgerId2, 200_000n, "2"]
  ] as const) {
    await prisma.projectAffiliateSettlementFact.create({
      data: {
        id: `${ledgerId}_fact`,
        ledgerId,
        projectId: fixture.projectId,
        contractLedgerId: fixture.contractLedgerId,
        entryKind: "original",
        effectDirection: "increase",
        counterpartyName: fixture.counterpartyName,
        settledAt: new Date("2026-10-20T00:00:00.000Z"),
        periodLabel: "2026-10",
        amountCents,
        affiliateAssignmentId: fixture.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
        affiliateNameSnapshot: fixture.affiliateName,
        basisType: "oral",
        idempotencyKey: `${fixture.prefix}_settlement_${suffix}`,
        requestFingerprint: sha,
        recordedByUserId: fixture.financeUserId,
        recordedByRoleKey: "budget_staff",
        ...confirmed,
        confirmationActionId: `${fixture.prefix}_settlement_confirmation_${suffix}`
      }
    });
  }
  // 转我方 5 万（已确认）+ 扣费 3 万（已确认，不计入施工企业已付）。
  await prisma.projectUpstreamFundFact.createMany({
    data: [
      {
        id: `${fixture.prefix}_remittance`,
        projectId: fixture.projectId,
        factType: "affiliate_remittance_to_company",
        entryKind: "original",
        effectDirection: "increase",
        occurredAt: new Date("2026-11-10T00:00:00.000Z"),
        amountCents: 50_000n,
        counterpartyName: "我方公司",
        basisType: "oral",
        affiliateSettlementFactId: `${fixture.settlementLedgerId2}_fact`,
        companyEntityId: `${fixture.prefix}_company`,
        affiliateCompanyContractId: `${fixture.prefix}_company_contract`,
        invoiceRecordId: `${fixture.prefix}_invoice`,
        affiliateAssignmentId: fixture.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
        affiliateNameSnapshot: fixture.affiliateName,
        idempotencyKey: `${fixture.prefix}_remittance`,
        requestFingerprint: sha,
        recordedByUserId: fixture.financeUserId,
        recordedByRoleKey: "finance_staff",
        ...confirmed,
        confirmationActionId: `${fixture.prefix}_remittance_confirmation`
      },
      {
        id: `${fixture.prefix}_deduction`,
        projectId: fixture.projectId,
        factType: "affiliate_deduction",
        entryKind: "original",
        effectDirection: "increase",
        occurredAt: new Date("2026-11-11T00:00:00.000Z"),
        amountCents: 30_000n,
        counterpartyName: "被排除的扣费",
        basisType: "oral",
        deductionCategory: "management_fee",
        affiliateAssignmentId: fixture.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
        affiliateNameSnapshot: fixture.affiliateName,
        idempotencyKey: `${fixture.prefix}_deduction`,
        requestFingerprint: sha,
        recordedByUserId: fixture.financeUserId,
        recordedByRoleKey: "finance_staff",
        ...confirmed,
        confirmationActionId: `${fixture.prefix}_deduction_confirmation`
      }
    ]
  });
}
