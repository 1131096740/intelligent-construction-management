import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const describeDatabase =
  process.env.RUN_PROJECT_AFFILIATE_DB_TESTS === "1" ? describe : describe.skip;

describeDatabase("project affiliate subject PostgreSQL constraints", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rolls back a second current affiliate assignment for the same project", async () => {
    const nonce = randomUUID();
    const projectId = `affiliate-project-${nonce}`;
    const firstId = `affiliate-assignment-a-${nonce}`;
    const secondId = `affiliate-assignment-b-${nonce}`;

    await expect(
      prisma.$transaction(async (tx) => {
        const common = {
          projectId,
          businessPartyId: `party-${nonce}`,
          businessPartyVersionId: `party-version-${nonce}`,
          affiliateNameSnapshot: "数据库唯一约束测试挂靠企业",
          affiliateCreditCodeSnapshot: null,
          effectiveFrom: new Date("2026-07-28T00:00:00.000Z"),
          changeReason: "验证同项目当前挂靠企业唯一约束",
          assignedByUserId: "constraint-test"
        };
        await tx.projectAffiliateAssignment.create({
          data: { id: firstId, ...common }
        });
        await tx.projectAffiliateAssignment.create({
          data: { id: secondId, ...common }
        });
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.projectAffiliateAssignment.count({
        where: { id: { in: [firstId, secondId] } }
      })
    ).resolves.toBe(0);
  });

  it("rolls back an affiliate contract version without a frozen affiliate snapshot", async () => {
    const versionId = `affiliate-version-${randomUUID()}`;

    await expect(
      prisma.contractVersion.create({
        data: {
          id: versionId,
          contractId: `contract-${versionId}`,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          amountCents: 0n,
          signingSubjectType: "affiliate",
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      })
    ).rejects.toThrow("ContractVersion_signing_subject_check");

    await expect(
      prisma.contractVersion.count({ where: { id: versionId } })
    ).resolves.toBe(0);
  });
});
