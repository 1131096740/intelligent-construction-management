import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const describeDatabase =
  process.env.RUN_PROJECT_AFFILIATE_BUSINESS_DB_TESTS === "1"
    ? describe
    : describe.skip;

describeDatabase("project affiliate business PostgreSQL constraints", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows a complete external confirmation transition and then locks the contract fact", async () => {
    const id = randomUUID();
    await prisma.project.create({
      data: { id: `project-${id}`, code: `AFFILIATE-${id}`, name: "施工企业业务事实测试项目" }
    });
    await prisma.projectAffiliateAssignment.create({
      data: {
        id: `assignment-${id}`,
        projectId: `project-${id}`,
        businessPartyId: `party-${id}`,
        businessPartyVersionId: `party-version-${id}`,
        affiliateNameSnapshot: "挂靠建设集团",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        changeReason: "数据库测试夹具",
        assignedByUserId: "contract-constraint"
      }
    });
    await prisma.projectAffiliateContractFact.create({
      data: {
        id,
        ledgerId: id,
        projectId: `project-${id}`,
        contractType: "material_purchase",
        externalContractReference: `EXT-${id}`,
        counterpartyName: "材料供应商",
        signedAt: new Date("2026-07-20T00:00:00.000Z"),
        amountNature: "fixed",
        amountCents: 10000n,
        affiliateAssignmentId: `assignment-${id}`,
        affiliateBusinessPartyVersionId: `party-version-${id}`,
        affiliateNameSnapshot: "挂靠建设集团",
        basisType: "oral",
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        recordedByUserId: "contract-constraint",
        recordedByRoleKey: "contract_staff"
      }
    });

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectAffiliateContractFact"
        SET "status" = 'confirmed',
            "confirmedByUserId" = 'contract-director-constraint',
            "confirmedAt" = NOW()
        WHERE "id" = ${id}
      `)
    ).rejects.toThrow("ProjectAffiliateContractFact_business_check");

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "ProjectAffiliateContractFact"
      SET "status" = 'confirmed',
          "confirmedByUserId" = 'contract-director-constraint',
          "confirmedAt" = NOW(),
          "confirmationActionId" = ${randomUUID()},
          "confirmationSignatureVersionId" = 'signature-version-constraint',
          "confirmationSignatureFileId" = ${`signature-${id}`},
          "confirmationSignatureSha256" = ${"b".repeat(64)}
      WHERE "id" = ${id}
    `);

    await expect(
      prisma.projectAffiliateContractFact.update({
        where: { id },
        data: { counterpartyName: "覆盖后的供应商" }
      })
    ).rejects.toThrow("confirmed affiliate contract facts are append-only");
    await expect(
      prisma.projectAffiliateContractFact.delete({ where: { id } })
    ).rejects.toThrow("affiliate contract facts cannot be deleted");
  });

  it("rejects the same external payment reference across projects", async () => {
    const externalPaymentReference = `BANK-${randomUUID()}`;
    const firstId = randomUUID();
    const payment = {
      contractLedgerId: `contract-ledger-${firstId}`,
      settlementLedgerId: `settlement-ledger-${firstId}`,
      counterpartyName: "材料供应商",
      paidAt: new Date("2026-07-29T00:00:00.000Z"),
      amountCents: 1000n,
      paymentKind: "normal",
      externalPaymentReference,
      affiliateAssignmentId: `assignment-${firstId}`,
      affiliateBusinessPartyVersionId: `party-version-${firstId}`,
      affiliateNameSnapshot: "挂靠建设集团",
      basisType: "oral",
      requestFingerprint: "c".repeat(64),
      recordedByUserId: "finance-constraint",
      recordedByRoleKey: "finance_staff"
    };
    await prisma.projectAffiliatePaymentFact.create({
      data: {
        id: firstId,
        ledgerId: firstId,
        projectId: `project-a-${firstId}`,
        idempotencyKey: randomUUID(),
        ...payment
      }
    });

    const secondId = randomUUID();
    await expect(
      prisma.projectAffiliatePaymentFact.create({
        data: {
          id: secondId,
          ledgerId: secondId,
          projectId: `project-b-${secondId}`,
          idempotencyKey: randomUUID(),
          ...payment
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects one external evidence file bound to two business facts", async () => {
    const fileId = `exclusive-affiliate-file-${randomUUID()}`;
    const contractId = randomUUID();
    await prisma.projectAffiliateContractFact.create({
      data: {
        id: contractId,
        ledgerId: contractId,
        projectId: `project-${contractId}`,
        contractType: "material_purchase",
        externalContractReference: `EXT-${contractId}`,
        counterpartyName: "材料供应商",
        signedAt: new Date("2026-07-20T00:00:00.000Z"),
        amountNature: "fixed",
        amountCents: 10000n,
        affiliateAssignmentId: `assignment-${contractId}`,
        affiliateBusinessPartyVersionId: `party-version-${contractId}`,
        affiliateNameSnapshot: "挂靠建设集团",
        basisType: "written",
        evidenceFileId: fileId,
        fileContentSha256Snapshot: "d".repeat(64),
        idempotencyKey: randomUUID(),
        requestFingerprint: "e".repeat(64),
        recordedByUserId: "contract-constraint",
        recordedByRoleKey: "contract_staff"
      }
    });

    const settlementId = randomUUID();
    await expect(
      prisma.projectAffiliateSettlementFact.create({
        data: {
          id: settlementId,
          ledgerId: settlementId,
          projectId: `project-other-${settlementId}`,
          contractLedgerId: `contract-ledger-${settlementId}`,
          counterpartyName: "另一供应商",
          settledAt: new Date("2026-07-28T00:00:00.000Z"),
          periodLabel: "2026-07",
          amountCents: 1000n,
          affiliateAssignmentId: `assignment-${settlementId}`,
          affiliateBusinessPartyVersionId: `party-version-${settlementId}`,
          affiliateNameSnapshot: "另一挂靠企业",
          basisType: "written",
          evidenceFileId: fileId,
          fileContentSha256Snapshot: "f".repeat(64),
          idempotencyKey: randomUUID(),
          requestFingerprint: "1".repeat(64),
          recordedByUserId: "budget-constraint",
          recordedByRoleKey: "budget_staff"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
