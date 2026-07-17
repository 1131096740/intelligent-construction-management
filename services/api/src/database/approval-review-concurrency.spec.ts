import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { lockApprovalReviewRow } from "../approval/approval-review-lock";

describe("approval review concurrency boundary", () => {
  const integrationTest = process.env.RUN_APPROVAL_REVIEW_CONCURRENCY === "1" ? it : it.skip;
  it("awaits the database row lock before continuing", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const queryRaw = jest.fn().mockReturnValue(pending);
    let completed = false;
    const lock = lockApprovalReviewRow({ $queryRaw: queryRaw } as never, Prisma.sql`SELECT 1 FOR UPDATE`)
      .then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    release();
    await lock;
    expect(completed).toBe(true);
  });

  it.each([
    ["contract/contract.service.ts", "ContractVersion"],
    ["settlement/settlement.service.ts", "Settlement"],
    ["payment/payment-request.service.ts", "PaymentRequest"]
  ])("locks %s business row before ApprovalInstance", (relative, businessTable) => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src", relative), "utf8");
    const review = source.slice(source.indexOf("async reviewApproval("));
    const businessLock = businessTable === "PaymentRequest"
      ? review.indexOf("lockPaymentRequestForUpdate")
      : review.indexOf(`FROM "${businessTable}"`);
    const instanceLock = review.indexOf('FROM "ApprovalInstance"');
    expect(businessLock).toBeGreaterThanOrEqual(0);
    expect(instanceLock).toBeGreaterThan(businessLock);
    expect(review.indexOf("approvalActionLog.create")).toBeGreaterThan(instanceLock);
  });

  integrationTest("serializes two independent approval connections so the node advances and logs once", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("并发审批测试必须连接非生产隔离数据库");
    }
    const schema = `approval_review_${randomUUID().replace(/-/g, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("schema", schema);
    const first = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const second = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractVersion" ("id" TEXT PRIMARY KEY)`);
      await first.$executeRawUnsafe(`
        CREATE TABLE "ApprovalInstance" (
          "id" TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "currentNodeIndex" INTEGER NOT NULL
        )
      `);
      await first.$executeRawUnsafe(`
        CREATE TABLE "ApprovalActionLog" (
          "id" TEXT PRIMARY KEY,
          "approvalInstanceId" TEXT NOT NULL,
          "nodeIndex" INTEGER NOT NULL,
          "action" TEXT NOT NULL
        )
      `);
      await first.$executeRawUnsafe(`INSERT INTO "ContractVersion" ("id") VALUES ('version-1')`);
      await first.$executeRawUnsafe(`
        INSERT INTO "ApprovalInstance" ("id", "businessId", "status", "currentNodeIndex")
        VALUES ('instance-1', 'version-1', 'in_progress', 0)
      `);

      const approveOnce = (client: PrismaClient, logId: string) => client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ContractVersion" WHERE "id" = 'version-1' FOR UPDATE`;
        const [instance] = await tx.$queryRaw<Array<{
          currentNodeIndex: number;
          status: string;
        }>>`SELECT "currentNodeIndex", "status" FROM "ApprovalInstance" WHERE "id" = 'instance-1' FOR UPDATE`;
        if (instance.status !== "in_progress" || instance.currentNodeIndex !== 0) return false;
        await tx.$executeRaw`UPDATE "ApprovalInstance" SET "currentNodeIndex" = 1, "status" = 'approved' WHERE "id" = 'instance-1'`;
        await tx.$executeRaw`INSERT INTO "ApprovalActionLog" ("id", "approvalInstanceId", "nodeIndex", "action") VALUES (${logId}, 'instance-1', 0, 'approve')`;
        return true;
      });

      const results = await Promise.all([
        approveOnce(first, "log-first"),
        approveOnce(second, "log-second")
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [instance] = await first.$queryRaw<Array<{ currentNodeIndex: number; status: string }>>`
        SELECT "currentNodeIndex", "status" FROM "ApprovalInstance" WHERE "id" = 'instance-1'
      `;
      const [count] = await first.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "ApprovalActionLog"
        WHERE "approvalInstanceId" = 'instance-1' AND "nodeIndex" = 0 AND "action" = 'approve'
      `;
      expect(instance).toEqual({ currentNodeIndex: 1, status: "approved" });
      expect(count.count).toBe(1n);
    } finally {
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 15_000);
});
