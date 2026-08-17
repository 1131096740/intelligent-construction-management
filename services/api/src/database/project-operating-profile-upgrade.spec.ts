import { PrismaClient } from "@prisma/client";

const LIVE_TEST_ENABLED = process.env.RUN_PROJECT_OPERATING_PROFILE_UPGRADE === "1";
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describeDatabase("project operating profile upgrade backfill", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("locks a pre-migration formal fact to its covering construction enterprise", async () => {
    await expect(prisma.project.findUniqueOrThrow({
      where: { id: "profile-upgrade-project" },
      select: { constructionEnterpriseLockedAt: true }
    })).resolves.toMatchObject({ constructionEnterpriseLockedAt: expect.any(Date) });

    await expect(prisma.projectAffiliateAssignment.update({
      where: { id: "profile-upgrade-assignment" },
      data: { endedAt: new Date("2026-08-01T00:00:00.000Z") }
    })).rejects.toThrow("施工企业已经锁定");
  });

  it("does not lock an enterprise that started after the pre-migration business date", async () => {
    await expect(prisma.project.findUniqueOrThrow({
      where: { id: "profile-upgrade-uncovered-project" },
      select: { constructionEnterpriseLockedAt: true }
    })).resolves.toEqual({ constructionEnterpriseLockedAt: null });

    await expect(prisma.projectAffiliateAssignment.update({
      where: { id: "profile-upgrade-uncovered-assignment" },
      data: { endedAt: new Date("2026-08-02T00:00:00.000Z") }
    })).resolves.toMatchObject({ endedAt: new Date("2026-08-02T00:00:00.000Z") });
  });
});
