import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const describeDatabase =
  process.env.RUN_PROJECT_UPSTREAM_FUND_DB_TESTS === "1"
    ? describe
    : describe.skip;

describeDatabase("project upstream fund fact PostgreSQL constraints", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows only a complete confirmation transition and then locks the fact", async () => {
    const id = `upstream-fund-${randomUUID()}`;
    await createProjectAssignment(prisma, {
      projectId: `project-${id}`,
      assignmentId: `assignment-${id}`,
      partyVersionId: `party-version-${id}`
    });
    await prisma.projectUpstreamFundFact.create({
      data: {
        id,
        projectId: `project-${id}`,
        factType: "affiliate_remittance_to_company",
        occurredAt: new Date("2026-07-29T00:00:00.000Z"),
        amountCents: 10000n,
        counterpartyName: "挂靠建设集团",
        basisType: "oral",
        affiliateAssignmentId: `assignment-${id}`,
        affiliateBusinessPartyVersionId: `party-version-${id}`,
        affiliateNameSnapshot: "挂靠建设集团",
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        recordedByUserId: "finance-constraint",
        recordedByRoleKey: "finance_staff"
      }
    });

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectUpstreamFundFact"
        SET "status" = 'confirmed',
            "confirmedByUserId" = 'finance-constraint',
            "confirmedAt" = NOW()
        WHERE "id" = ${id}
      `)
    ).rejects.toThrow("ProjectUpstreamFundFact_business_check");

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectUpstreamFundFact"
        SET "amountCents" = 10001
        WHERE "id" = ${id}
      `)
    ).rejects.toThrow("upstream fund business facts are immutable");

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "ProjectUpstreamFundFact"
      SET "status" = 'confirmed',
          "confirmedByUserId" = 'finance-constraint',
          "confirmedAt" = NOW(),
          "confirmationActionId" = ${randomUUID()},
          "confirmationSignatureVersionId" = 'signature-version-constraint',
          "confirmationSignatureFileId" = 'signature-file-constraint',
          "confirmationSignatureSha256" = ${"b".repeat(64)}
      WHERE "id" = ${id}
    `);

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectUpstreamFundFact"
        SET "description" = 'attempted overwrite'
        WHERE "id" = ${id}
      `)
    ).rejects.toThrow("confirmed upstream fund facts are append-only");
    await expect(
      prisma.projectUpstreamFundFact.delete({ where: { id } })
    ).rejects.toThrow("upstream fund facts cannot be deleted");
  });

  it("accepts only one reversal for the same original fact", async () => {
    const originalId = `upstream-fund-original-${randomUUID()}`;
    const firstReversalId = `upstream-fund-reversal-a-${randomUUID()}`;
    const secondReversalId = `upstream-fund-reversal-b-${randomUUID()}`;
    const common = {
      projectId: `project-${originalId}`,
      factType: "owner_payment_to_affiliate",
      occurredAt: new Date("2026-07-29T00:00:00.000Z"),
      amountCents: 10000n,
      counterpartyName: "建设单位",
      basisType: "oral",
      affiliateAssignmentId: `assignment-${originalId}`,
      affiliateBusinessPartyVersionId: `party-version-${originalId}`,
      affiliateNameSnapshot: "挂靠建设集团",
      requestFingerprint: "c".repeat(64),
      recordedByUserId: "finance-constraint",
      recordedByRoleKey: "finance_staff"
    };

    await createProjectAssignment(prisma, {
      projectId: common.projectId,
      assignmentId: common.affiliateAssignmentId,
      partyVersionId: common.affiliateBusinessPartyVersionId
    });

    await prisma.projectUpstreamFundFact.create({
      data: {
        id: originalId,
        ...common,
        idempotencyKey: randomUUID(),
        status: "confirmed",
        confirmedByUserId: "finance-constraint",
        confirmedAt: new Date("2026-07-29T01:00:00.000Z"),
        confirmationActionId: randomUUID(),
        confirmationSignatureVersionId: "signature-version-constraint",
        confirmationSignatureFileId: "signature-file-constraint",
        confirmationSignatureSha256: "d".repeat(64)
      }
    });

    await prisma.projectUpstreamFundFact.create({
      data: {
        id: firstReversalId,
        ...common,
        entryKind: "reversal",
        adjustsFactId: originalId,
        effectDirection: "decrease",
        idempotencyKey: randomUUID()
      }
    });
    await expect(
      prisma.projectUpstreamFundFact.create({
        data: {
          id: secondReversalId,
          ...common,
          entryKind: "reversal",
          adjustsFactId: originalId,
          effectDirection: "decrease",
          idempotencyKey: randomUUID()
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

async function createProjectAssignment(
  prisma: PrismaClient,
  input: { projectId: string; assignmentId: string; partyVersionId: string }
) {
  await prisma.project.create({
    data: { id: input.projectId, code: `UPSTREAM-${randomUUID()}`, name: "上游资金事实测试项目" }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: input.assignmentId,
      projectId: input.projectId,
      businessPartyId: `party-${randomUUID()}`,
      businessPartyVersionId: input.partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      changeReason: "数据库测试夹具",
      assignedByUserId: "finance-constraint"
    }
  });
}
