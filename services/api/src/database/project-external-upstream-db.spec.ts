import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const describeDatabase =
  process.env.RUN_PROJECT_EXTERNAL_UPSTREAM_DB_TESTS === "1"
    ? describe
    : describe.skip;

describeDatabase("project external fact PostgreSQL constraints", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects confirming an upstream settlement without the complete signature tuple", async () => {
    const id = `upstream-constraint-${randomUUID()}`;
    await prisma.projectUpstreamSettlement.create({
      data: {
        id,
        projectId: `project-${id}`,
        settledAt: new Date("2026-07-28T00:00:00.000Z"),
        reportedAmountCents: 10000n,
        approvedAmountCents: 9000n,
        approvingPartyName: "建设单位",
        periodLabel: "2026-07",
        voucherFileId: `file-${id}`,
        fileContentSha256Snapshot: "a".repeat(64),
        recordedByUserId: "budget-staff-constraint",
        status: "pending_confirm"
      }
    });

    try {
      await expect(
        prisma.$executeRaw(Prisma.sql`
          UPDATE "ProjectUpstreamSettlement"
          SET "status" = 'confirmed',
              "confirmedByUserId" = 'budget-staff-constraint',
              "confirmedAt" = NOW()
          WHERE "id" = ${id}
        `)
      ).rejects.toThrow("ProjectUpstreamSettlement_confirmation_check");
      await expect(
        prisma.projectUpstreamSettlement.findUnique({
          where: { id },
          select: { status: true }
        })
      ).resolves.toEqual({ status: "pending_confirm" });
    } finally {
      await prisma.projectUpstreamSettlement.delete({ where: { id } });
    }
  });

  it("rejects making an owner contract effective without its confirmer tuple", async () => {
    const id = `owner-contract-constraint-${randomUUID()}`;
    await prisma.projectOwnerContract.create({
      data: {
        id,
        projectId: `project-${id}`,
        ownerName: "建设单位",
        contractName: "施工总承包合同",
        contractCode: `OWNER-${id}`,
        signedAt: new Date("2026-07-28T00:00:00.000Z"),
        amountCents: 10000n,
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: `file-${id}`,
        fileContentSha256Snapshot: "b".repeat(64),
        recordedByUserId: "contract-staff-constraint",
        status: "pending_confirm"
      }
    });

    try {
      await expect(
        prisma.$executeRaw(Prisma.sql`
          UPDATE "ProjectOwnerContract"
          SET "status" = 'effective'
          WHERE "id" = ${id}
        `)
      ).rejects.toThrow("ProjectOwnerContract_external_confirmation_check");
      await expect(
        prisma.projectOwnerContract.findUnique({
          where: { id },
          select: { status: true }
        })
      ).resolves.toEqual({ status: "pending_confirm" });
    } finally {
      await prisma.projectOwnerContract.delete({ where: { id } });
    }
  });
});
