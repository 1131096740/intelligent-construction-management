import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PaymentAmountService } from "../payment/payment-amount.service";
import { PaymentRequestService } from "../payment/payment-request.service";

function directPaymentDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("直接付款容量并发测试必须连接非生产专用数据库");
  }
  const parsed = new URL(value);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.pathname.includes("direct_payment_task13")
  ) {
    throw new Error("直接付款容量并发测试拒绝非本机专用数据库");
  }
  return value;
}

describe("direct payment capacity database concurrency", () => {
  const integrationTest =
    process.env.RUN_DIRECT_PAYMENT_CAPACITY_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "serializes different payment sources so they cannot both spend the old fixed limit",
    async () => {
      const databaseUrl = directPaymentDatabaseUrl(
        process.env.DIRECT_PAYMENT_CAPACITY_DATABASE_URL
      );
      const schema = `direct_payment_${randomUUID().replace(/-/gu, "")}`;
      const admin = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const isolatedUrl = new URL(databaseUrl);
      isolatedUrl.searchParams.set("schema", schema);
      const clients = [0, 1].map(
        () =>
          new PrismaClient({
            datasources: { db: { url: isolatedUrl.toString() } }
          })
      );

      try {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await clients[0]!.$executeRawUnsafe(`
          CREATE TABLE "Contract" (
            "id" TEXT PRIMARY KEY
          )
        `);
        await clients[0]!.$executeRawUnsafe(`
          CREATE TABLE "PaymentRequest" (
            "id" TEXT PRIMARY KEY,
            "contractId" TEXT NOT NULL,
            "sourceType" TEXT NOT NULL,
            "paymentTermsStageId" TEXT,
            "status" TEXT NOT NULL,
            "requestedAmountCents" BIGINT NOT NULL,
            "approvedAmountCents" BIGINT,
            "paidAmountCents" BIGINT NOT NULL
          )
        `);
        await clients[0]!.$executeRaw`
          INSERT INTO "Contract" ("id") VALUES ('contract-fixed')
        `;

        const service = new PaymentRequestService(
          new PaymentAmountService(),
          {} as never
        );
        const assertCapacity = (
          service as unknown as {
            assertGenericContractPaymentStageCapacity(
              tx: unknown,
              contractVersion: unknown,
              stage: unknown,
              requestedAmountCents: bigint
            ): Promise<void>;
          }
        ).assertGenericContractPaymentStageCapacity.bind(service);
        const stage = {
          id: "stage-fixed",
          paymentTermsVersionId: "terms-fixed",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: null,
          fixedAmountCents: 1_000n,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          allowsEarlyPayment: true,
          allowsInstallments: true
        };
        const contractVersion = {
          id: "version-fixed",
          contractId: "contract-fixed",
          amountCents: 1_000n,
          amountLimitType: "capped",
          effectiveAt: new Date("2026-07-01T00:00:00.000Z")
        };

        const attempt = (
          client: PrismaClient,
          sourceType: "settlement" | "contract_due"
        ) =>
          client.$transaction(async (rawTx) => {
            const tx = {
              $queryRaw: rawTx.$queryRaw.bind(rawTx),
              paymentRequest: {
                findMany: async () =>
                  rawTx.$queryRaw<
                    Array<{
                      paymentTermsStageId: string | null;
                      status: string;
                      requestedAmountCents: bigint;
                      approvedAmountCents: bigint | null;
                      paidAmountCents: bigint;
                    }>
                  >(Prisma.sql`
                    SELECT
                      "paymentTermsStageId",
                      "status",
                      "requestedAmountCents",
                      "approvedAmountCents",
                      "paidAmountCents"
                    FROM "PaymentRequest"
                    WHERE "contractId" = 'contract-fixed'
                  `)
              }
            };
            await assertCapacity(
              tx,
              contractVersion,
              stage,
              600n
            );
            await rawTx.$executeRaw(Prisma.sql`
              INSERT INTO "PaymentRequest" (
                "id",
                "contractId",
                "sourceType",
                "paymentTermsStageId",
                "status",
                "requestedAmountCents",
                "approvedAmountCents",
                "paidAmountCents"
              ) VALUES (
                ${randomUUID()},
                'contract-fixed',
                ${sourceType},
                ${sourceType === "contract_due" ? "stage-fixed" : null},
                'approval_pending',
                600,
                NULL,
                0
              )
            `);
          });

        const results = await Promise.allSettled([
          attempt(clients[0]!, "settlement"),
          attempt(clients[1]!, "contract_due")
        ]);
        expect(
          results.filter((result) => result.status === "fulfilled")
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.status === "rejected")
        ).toHaveLength(1);
        expect(
          await clients[0]!.$queryRaw<
            Array<{ count: bigint; total: bigint }>
          >(Prisma.sql`
            SELECT
              COUNT(*)::bigint AS "count",
              COALESCE(SUM("requestedAmountCents"), 0)::bigint AS "total"
            FROM "PaymentRequest"
          `)
        ).toEqual([{ count: 1n, total: 600n }]);
      } finally {
        await Promise.allSettled(
          clients.map((client) => client.$disconnect())
        );
        await admin.$disconnect();
      }
    },
    20_000
  );
});
