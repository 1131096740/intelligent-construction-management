import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PrismaClient, type PrismaClient as PrismaClientType } from "@prisma/client";

const DATABASE_NAME = "jiangkong_invoice_ledger_pol260";
const localRequire = createRequire(__filename);
const EXPECTED_MIGRATION_COUNT = (
  localRequire(resolve(__dirname, "../../prisma/migration-baseline.cjs")) as {
    deriveMigrationBaseline: (migrationRoot: string) => {
      expectedDirectoryCount: number;
    };
  }
).deriveMigrationBaseline(resolve(__dirname, "../../prisma/migrations"))
  .expectedDirectoryCount;

describe("POL-11B invoice ledger PostgreSQL authority", () => {
  const integrationTest =
    process.env.RUN_INVOICE_LEDGER_POSTGRESQL16 === "1" ? it : it.skip;

  integrationTest(
    "serializes competing red references against one blue allocation",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        const fixture = await seedRedCompetition(clients[2]!);

        const outcomes = await Promise.allSettled([
          clients[0]!.invoiceRedAllocationReference.create({
            data: {
              lifecycleEventId: fixture.firstLifecycleEventId,
              redInvoiceRecordId: fixture.firstRedInvoiceRecordId,
              blueInvoiceAllocationId: fixture.blueInvoiceAllocationId,
              amountCents: 4000n
            }
          }),
          clients[1]!.invoiceRedAllocationReference.create({
            data: {
              lifecycleEventId: fixture.secondLifecycleEventId,
              redInvoiceRecordId: fixture.secondRedInvoiceRecordId,
              blueInvoiceAllocationId: fixture.blueInvoiceAllocationId,
              amountCents: 4000n
            }
          })
        ]);

        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
        await expect(
          clients[2]!.invoiceRedAllocationReference.aggregate({
            where: { blueInvoiceAllocationId: fixture.blueInvoiceAllocationId },
            _sum: { amountCents: true }
          })
        ).resolves.toMatchObject({ _sum: { amountCents: 4000n } });
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    60_000
  );

  integrationTest(
    "serializes a red reference against an ordinary allocation reversal",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        const fixture = await seedRedCompetition(clients[2]!);

        const outcomes = await Promise.allSettled([
          clients[0]!.invoiceRedAllocationReference.create({
            data: {
              lifecycleEventId: fixture.firstLifecycleEventId,
              redInvoiceRecordId: fixture.firstRedInvoiceRecordId,
              blueInvoiceAllocationId: fixture.blueInvoiceAllocationId,
              amountCents: 4000n
            }
          }),
          clients[1]!.invoiceClearingAllocation.create({
            data: {
              invoiceRecordId: fixture.blueInvoiceRecordId,
              projectId: fixture.projectId,
              clearingCaseId: fixture.clearingCaseId,
              clearingEventVersionId: fixture.clearingEventVersionId,
              amountCents: 4000n,
              structuredReasonCode: "allocation_correction",
              reversesAllocationId: fixture.blueInvoiceAllocationId,
              createdByUserId: fixture.actorUserId,
              idempotencyKey: randomUUID(),
              requestFingerprint: "d".repeat(64)
            }
          })
        ]);

        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    60_000
  );

  integrationTest(
    "serializes competing evidence repairs against one replacement invoice cap",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        const fixture = await seedEvidenceRepairCompetition(clients[2]!);

        const outcomes = await Promise.allSettled(
          fixture.impactIds.map((impactId, index) =>
            clients[index]!.invoiceEvidenceRepairResolution.create({
              data: {
                impactId,
                invalidatedInvoiceRecordId: fixture.invalidatedInvoiceRecordId,
                replacementInvoiceRecordId: fixture.replacementInvoiceRecordId,
                replacementFileId: fixture.replacementFileId,
                reasonCode: "replacement_invoice_verified",
                actualActorUserId: fixture.actorUserId,
                expectedRevision: 1,
                idempotencyKey: randomUUID(),
                requestFingerprint: String(index + 7).repeat(64)
              }
            })
          )
        );

        expect(
          outcomes.filter((outcome) => outcome.status === "fulfilled")
        ).toHaveLength(1);
        expect(
          outcomes.filter((outcome) => outcome.status === "rejected")
        ).toHaveLength(1);
        const resolutions =
          await clients[2]!.invoiceEvidenceRepairResolution.findMany({
            where: {
              replacementInvoiceRecordId: fixture.replacementInvoiceRecordId
            }
          });
        expect(resolutions).toHaveLength(1);
        const resolvedImpact =
          await clients[2]!.invoiceEvidenceRepairImpact.findUniqueOrThrow({
            where: { id: resolutions[0]!.impactId }
          });
        expect(resolvedImpact.invalidatedAmountCents).toBe(4000n);
        await expect(
          clients[2]!.invoiceEvidenceRepairImpact.count({
            where: { id: { in: fixture.impactIds } }
          })
        ).resolves.toBe(2);
        await expect(
          clients[2]!.invoiceClearingAllocation.count({
            where: { id: { in: fixture.allocationIds } }
          })
        ).resolves.toBe(2);
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    60_000
  );

  integrationTest(
    "rejects an evidence impact that does not exactly match its lifecycle allocation",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      try {
        await client.$connect();
        await assertFullyMigrated(client);
        const fixture = await seedEvidenceRepairCompetition(client);

        await expect(
          client.invoiceEvidenceRepairImpact.create({
            data: {
              lifecycleEventId: fixture.lifecycleEventId,
              invoiceRecordId: fixture.invalidatedInvoiceRecordId,
              allocationId: fixture.allocationIds[0]!,
              projectId: "wrong-project",
              clearingCaseId: fixture.clearingCaseId,
              clearingEventVersionId: fixture.clearingEventVersionId,
              invalidatedAmountCents: 3999n,
              reasonCode: "invoice_voided",
              actualActorUserId: fixture.actorUserId
            }
          })
        ).rejects.toThrow();
      } finally {
        await client.$disconnect();
      }
    },
    60_000
  );

  integrationTest(
    "allows only the exact replacement file snapshot without weakening exclusive file protection",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      try {
        await client.$connect();
        await assertFullyMigrated(client);
        const fixture = await seedEvidenceRepairCompetition(client);
        const impactId = fixture.impactIds[0]!;

        await expect(
          client.invoiceEvidenceRepairResolution.create({
            data: {
              impactId,
              invalidatedInvoiceRecordId: fixture.invalidatedInvoiceRecordId,
              replacementInvoiceRecordId: fixture.replacementInvoiceRecordId,
              replacementFileId: `file-${fixture.invalidatedInvoiceRecordId}`,
              reasonCode: "replacement_invoice_verified",
              actualActorUserId: fixture.actorUserId,
              expectedRevision: 1,
              idempotencyKey: randomUUID(),
              requestFingerprint: "8".repeat(64)
            }
          })
        ).rejects.toThrow();
        await expect(
          client.invoiceEvidenceRepairResolution.count({ where: { impactId } })
        ).resolves.toBe(0);

        await expect(
          client.invoiceEvidenceRepairResolution.create({
            data: {
              impactId,
              invalidatedInvoiceRecordId: fixture.invalidatedInvoiceRecordId,
              replacementInvoiceRecordId: fixture.replacementInvoiceRecordId,
              replacementFileId: fixture.replacementFileId,
              reasonCode: "replacement_invoice_verified",
              actualActorUserId: fixture.actorUserId,
              expectedRevision: 1,
              idempotencyKey: randomUUID(),
              requestFingerprint: "7".repeat(64)
            }
          })
        ).resolves.toMatchObject({
          replacementFileId: fixture.replacementFileId
        });

        await expect(
          client.fileObject.create({
            data: {
              id: `pol260-replacement-chain-${randomUUID()}`,
              bucket: "private-local",
              objectKey: `pol260/replacement-chain-${randomUUID()}.pdf`,
              originalName: "replacement-chain.pdf",
              mimeType: "application/pdf",
              sizeBytes: 10,
              uploadedByUserId: fixture.actorUserId,
              contentSha256: "6".repeat(64),
              supersedesFileObjectId: fixture.replacementFileId
            }
          })
        ).rejects.toThrow();
        await expect(
          client.fileObject.delete({
            where: { id: fixture.replacementFileId }
          })
        ).rejects.toThrow();
      } finally {
        await client.$disconnect();
      }
    },
    60_000
  );

  integrationTest(
    "keeps the creation-time tax snapshot immutable while allowing revision-only updates",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      try {
        await client.$connect();
        await assertFullyMigrated(client);
        const fixture = await seedRedCompetition(client);

        await expect(
          client.invoiceRecord.update({
            where: { id: fixture.blueInvoiceRecordId },
            data: { revision: { increment: 1 } }
          })
        ).resolves.toMatchObject({ revision: 1 });
        await expect(
          client.invoiceRecord.update({
            where: { id: fixture.blueInvoiceRecordId },
            data: { taxRateSnapshot: "9.000000" }
          })
        ).rejects.toThrow();
        await expect(
          client.invoiceRecord.update({
            where: { id: fixture.firstRedInvoiceRecordId },
            data: { taxRateSnapshot: "13.000000" }
          })
        ).rejects.toThrow();

        await expect(
          client.invoiceRecord.findUniqueOrThrow({
            where: { id: fixture.blueInvoiceRecordId },
            select: { revision: true, taxRateSnapshot: true }
          })
        ).resolves.toMatchObject({ revision: 1 });
        const source = await client.invoiceRecord.findUniqueOrThrow({
          where: { id: fixture.blueInvoiceRecordId },
          select: { taxRateSnapshot: true }
        });
        const historical = await client.invoiceRecord.findUniqueOrThrow({
          where: { id: fixture.firstRedInvoiceRecordId },
          select: { taxRateSnapshot: true }
        });
        expect(source.taxRateSnapshot?.toFixed(6)).toBe("13.000000");
        expect(historical.taxRateSnapshot).toBeNull();
      } finally {
        await client.$disconnect();
      }
    },
    60_000
  );

  integrationTest(
    "rejects a second void lifecycle fact for one invoice",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      try {
        await client.$connect();
        await assertFullyMigrated(client);
        const fixture = await seedEvidenceRepairCompetition(client);

        await expect(
          client.invoiceLifecycleEvent.create({
            data: {
              invoiceRecordId: fixture.invalidatedInvoiceRecordId,
              kind: "void",
              reasonCode: "duplicate_void",
              createdByUserId: fixture.actorUserId,
              idempotencyKey: randomUUID(),
              requestFingerprint: "5".repeat(64)
            }
          })
        ).rejects.toThrow();
        await expect(
          client.invoiceLifecycleEvent.count({
            where: {
              invoiceRecordId: fixture.invalidatedInvoiceRecordId,
              kind: "void"
            }
          })
        ).resolves.toBe(1);
      } finally {
        await client.$disconnect();
      }
    },
    60_000
  );

  integrationTest(
    "rejects red lifecycle facts and late references after void",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      try {
        await client.$connect();
        await assertFullyMigrated(client);
        const voided = await seedEvidenceRepairCompetition(client);
        await expect(
          client.invoiceLifecycleEvent.create({
            data: {
              invoiceRecordId: voided.invalidatedInvoiceRecordId,
              relatedInvoiceRecordId: voided.replacementInvoiceRecordId,
              kind: "red",
              reasonCode: "red_after_void",
              createdByUserId: voided.actorUserId,
              idempotencyKey: randomUUID(),
              requestFingerprint: "2".repeat(64)
            }
          })
        ).rejects.toThrow();
        await expect(
          client.invoiceLifecycleEvent.count({
            where: {
              invoiceRecordId: voided.invalidatedInvoiceRecordId,
              kind: "red"
            }
          })
        ).resolves.toBe(0);

        const lateReference = await seedRedCompetition(client);
        await client.invoiceLifecycleEvent.create({
          data: {
            invoiceRecordId: lateReference.blueInvoiceRecordId,
            kind: "void",
            reasonCode: "invoice_voided",
            createdByUserId: lateReference.actorUserId,
            idempotencyKey: randomUUID(),
            requestFingerprint: "1".repeat(64)
          }
        });
        await expect(
          client.invoiceRedAllocationReference.create({
            data: {
              lifecycleEventId: lateReference.firstLifecycleEventId,
              redInvoiceRecordId: lateReference.firstRedInvoiceRecordId,
              blueInvoiceAllocationId: lateReference.blueInvoiceAllocationId,
              amountCents: 6000n
            }
          })
        ).rejects.toThrow();
        await expect(
          client.invoiceRedAllocationReference.count({
            where: {
              blueInvoiceAllocationId: lateReference.blueInvoiceAllocationId
            }
          })
        ).resolves.toBe(0);
      } finally {
        await client.$disconnect();
      }
    },
    60_000
  );

  integrationTest(
    "serializes void and red commands against the same invoice revision",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        const fixture = await seedRedCompetition(clients[2]!, false);
        const voidLifecycleEventId = `pol260-race-void-${randomUUID()}`;
        const redImpactId = `pol260-race-red-impact-${randomUUID()}`;
        const voidImpactId = `pol260-race-void-impact-${randomUUID()}`;

        const outcomes = await Promise.allSettled([
          clients[0]!.$transaction(async (tx) => {
            const claimed = await tx.invoiceRecord.updateMany({
              where: { id: fixture.blueInvoiceRecordId, revision: 0 },
              data: { revision: { increment: 1 } }
            });
            if (claimed.count !== 1) throw new Error("stale invoice revision");
            await tx.invoiceLifecycleEvent.create({
              data: {
                id: voidLifecycleEventId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                kind: "void",
                reasonCode: "invoice_voided",
                createdByUserId: fixture.actorUserId,
                idempotencyKey: randomUUID(),
                requestFingerprint: "4".repeat(64)
              }
            });
            await tx.invoiceEvidenceRepairImpact.create({
              data: {
                id: voidImpactId,
                lifecycleEventId: voidLifecycleEventId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                allocationId: fixture.blueInvoiceAllocationId,
                projectId: fixture.projectId,
                clearingCaseId: fixture.clearingCaseId,
                clearingEventVersionId: fixture.clearingEventVersionId,
                invalidatedAmountCents: 6000n,
                reasonCode: "invoice_voided",
                actualActorUserId: fixture.actorUserId
              }
            });
          }),
          clients[1]!.$transaction(async (tx) => {
            const claimed = await tx.invoiceRecord.updateMany({
              where: { id: fixture.blueInvoiceRecordId, revision: 0 },
              data: { revision: { increment: 1 } }
            });
            if (claimed.count !== 1) throw new Error("stale invoice revision");
            await tx.invoiceLifecycleEvent.create({
              data: {
                id: fixture.firstLifecycleEventId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                relatedInvoiceRecordId: fixture.firstRedInvoiceRecordId,
                kind: "red",
                reasonCode: "sales_return",
                createdByUserId: fixture.actorUserId,
                idempotencyKey: randomUUID(),
                requestFingerprint: "3".repeat(64)
              }
            });
            await tx.invoiceRedAllocationReference.create({
              data: {
                lifecycleEventId: fixture.firstLifecycleEventId,
                redInvoiceRecordId: fixture.firstRedInvoiceRecordId,
                blueInvoiceAllocationId: fixture.blueInvoiceAllocationId,
                amountCents: 6000n
              }
            });
            await tx.invoiceEvidenceRepairImpact.create({
              data: {
                id: redImpactId,
                lifecycleEventId: fixture.firstLifecycleEventId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                allocationId: fixture.blueInvoiceAllocationId,
                projectId: fixture.projectId,
                clearingCaseId: fixture.clearingCaseId,
                clearingEventVersionId: fixture.clearingEventVersionId,
                invalidatedAmountCents: 6000n,
                reasonCode: "sales_return",
                actualActorUserId: fixture.actorUserId
              }
            });
          })
        ]);

        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
        await expect(
          clients[2]!.invoiceRecord.findUniqueOrThrow({
            where: { id: fixture.blueInvoiceRecordId },
            select: { revision: true }
          })
        ).resolves.toEqual({ revision: 1 });
        await expect(
          clients[2]!.invoiceLifecycleEvent.count({
            where: { invoiceRecordId: fixture.blueInvoiceRecordId }
          })
        ).resolves.toBe(1);
        await expect(
          clients[2]!.invoiceEvidenceRepairImpact.count({
            where: { invoiceRecordId: fixture.blueInvoiceRecordId }
          })
        ).resolves.toBe(1);
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    60_000
  );

  integrationTest(
    "rejects reversals after void and serializes competing void and reversal commands",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        const voided = await seedEvidenceRepairCompetition(clients[2]!);
        await expect(
          clients[2]!.invoiceClearingAllocation.create({
            data: {
              invoiceRecordId: voided.invalidatedInvoiceRecordId,
              projectId: voided.projectId,
              clearingCaseId: voided.clearingCaseId,
              clearingEventVersionId: voided.clearingEventVersionId,
              amountCents: 1000n,
              structuredReasonCode: "allocation_correction",
              reversesAllocationId: voided.allocationIds[0]!,
              createdByUserId: voided.actorUserId,
              idempotencyKey: randomUUID(),
              requestFingerprint: "0".repeat(64)
            }
          })
        ).rejects.toThrow();
        await expect(
          clients[2]!.invoiceClearingAllocation.count({
            where: { reversesAllocationId: voided.allocationIds[0]! }
          })
        ).resolves.toBe(0);

        const fixture = await seedRedCompetition(clients[2]!, false);
        const voidLifecycleEventId = `pol260-race-reversal-void-${randomUUID()}`;
        const voidImpactId = `pol260-race-reversal-impact-${randomUUID()}`;
        const reversalId = `pol260-race-reversal-${randomUUID()}`;
        const outcomes = await Promise.allSettled([
          clients[0]!.$transaction(async (tx) => {
            const claimed = await tx.invoiceRecord.updateMany({
              where: { id: fixture.blueInvoiceRecordId, revision: 0 },
              data: { revision: { increment: 1 } }
            });
            if (claimed.count !== 1) throw new Error("stale invoice revision");
            await tx.invoiceLifecycleEvent.create({
              data: {
                id: voidLifecycleEventId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                kind: "void",
                reasonCode: "invoice_voided",
                createdByUserId: fixture.actorUserId,
                idempotencyKey: randomUUID(),
                requestFingerprint: "e".repeat(64)
              }
            });
            await tx.invoiceEvidenceRepairImpact.create({
              data: {
                id: voidImpactId,
                lifecycleEventId: voidLifecycleEventId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                allocationId: fixture.blueInvoiceAllocationId,
                projectId: fixture.projectId,
                clearingCaseId: fixture.clearingCaseId,
                clearingEventVersionId: fixture.clearingEventVersionId,
                invalidatedAmountCents: 6000n,
                reasonCode: "invoice_voided",
                actualActorUserId: fixture.actorUserId
              }
            });
          }),
          clients[1]!.$transaction(async (tx) => {
            const claimed = await tx.invoiceRecord.updateMany({
              where: { id: fixture.blueInvoiceRecordId, revision: 0 },
              data: { revision: { increment: 1 } }
            });
            if (claimed.count !== 1) throw new Error("stale invoice revision");
            await tx.invoiceClearingAllocation.create({
              data: {
                id: reversalId,
                invoiceRecordId: fixture.blueInvoiceRecordId,
                projectId: fixture.projectId,
                clearingCaseId: fixture.clearingCaseId,
                clearingEventVersionId: fixture.clearingEventVersionId,
                amountCents: 6000n,
                structuredReasonCode: "allocation_correction",
                reversesAllocationId: fixture.blueInvoiceAllocationId,
                createdByUserId: fixture.actorUserId,
                idempotencyKey: randomUUID(),
                requestFingerprint: "d".repeat(64)
              }
            });
          })
        ]);

        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
        await expect(
          clients[2]!.invoiceRecord.findUniqueOrThrow({
            where: { id: fixture.blueInvoiceRecordId },
            select: { revision: true }
          })
        ).resolves.toEqual({ revision: 1 });
        const [voidCount, impactCount, reversalCount] = await Promise.all([
          clients[2]!.invoiceLifecycleEvent.count({
            where: { id: voidLifecycleEventId }
          }),
          clients[2]!.invoiceEvidenceRepairImpact.count({
            where: { id: voidImpactId }
          }),
          clients[2]!.invoiceClearingAllocation.count({
            where: { id: reversalId }
          })
        ]);
        expect([voidCount, impactCount, reversalCount]).toEqual(
          voidCount === 1 ? [1, 1, 0] : [0, 0, 1]
        );
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    60_000
  );
});

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("POL-11B 动态验收必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== `/${DATABASE_NAME}`
  ) {
    throw new Error("POL-11B 动态验收只允许本机固定一次性 PostgreSQL 数据库");
  }
  return databaseUrl;
}

async function assertFullyMigrated(client: PrismaClientType) {
  const [row] = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
     WHERE finished_at IS NOT NULL
       AND rolled_back_at IS NULL
  `;
  expect(row?.count).toBe(BigInt(EXPECTED_MIGRATION_COUNT));
}

async function seedRedCompetition(
  client: PrismaClientType,
  seedLifecycleEvents = true
) {
  const suffix = randomUUID();
  const actorUserId = `pol260-actor-${suffix}`;
  const blueInvoiceRecordId = `pol260-blue-${suffix}`;
  const firstRedInvoiceRecordId = `pol260-red-a-${suffix}`;
  const secondRedInvoiceRecordId = `pol260-red-b-${suffix}`;
  const blueInvoiceAllocationId = `pol260-allocation-${suffix}`;
  const firstLifecycleEventId = `pol260-lifecycle-a-${suffix}`;
  const secondLifecycleEventId = `pol260-lifecycle-b-${suffix}`;
  const clearingCaseId = `pol260-case-${suffix}`;
  const clearingEventId = `pol260-event-${suffix}`;
  const clearingEventVersionId = `pol260-version-${suffix}`;

  await client.user.create({
    data: { id: actorUserId, name: "POL-11B 动态验收财务主管" }
  });
  await client.fileObject.createMany({
    data: [
      blueInvoiceRecordId,
      firstRedInvoiceRecordId,
      secondRedInvoiceRecordId
    ].map((invoiceId, index) => ({
      id: `file-${invoiceId}`,
      bucket: "private-local",
      objectKey: `pol260/${invoiceId}.pdf`,
      originalName: `invoice-${index + 1}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 10,
      uploadedByUserId: actorUserId,
      contentSha256: String(index + 1).repeat(64)
    }))
  });
  const invoiceData = (
    id: string,
    sourceBusinessType: string,
    totalAmountCents: bigint,
    taxRateSnapshot: string | null = null
  ) => ({
    id,
    projectId: null,
    identityKey: `identity-${id}`,
    identityKind: "traditional",
    owningCompanyEntityId: "pol260-company",
    direction: "inbound",
    invoiceType: "vat_general",
    invoiceCode: `CODE-${id}`,
    invoiceNumber: `NO-${id}`,
    issueDate: new Date("2026-09-07T00:00:00.000Z"),
    sellerName: "POL-11B 销售方",
    sellerTaxId: "91310000POL260SELL",
    buyerName: "POL-11B 购买方",
    buyerTaxId: "91310000POL260BUYR",
    taxExclusiveAmountCents: totalAmountCents,
    taxAmountCents: 0n,
    totalAmountCents,
    allocatableAmountCents: totalAmountCents,
    fileId: `file-${id}`,
    uploadedByUserId: actorUserId,
    sourceBusinessType,
    sourceBusinessId: `source-${id}`,
    taxRateSnapshot
  });
  await client.invoiceRecord.createMany({
    data: [
      invoiceData(
        blueInvoiceRecordId,
        "global_clearing_invoice",
        6000n,
        "13.000000"
      ),
      invoiceData(firstRedInvoiceRecordId, "global_clearing_invoice_red", 4000n),
      invoiceData(secondRedInvoiceRecordId, "global_clearing_invoice_red", 4000n)
    ]
  });
  await client.clearingCase.create({
    data: {
      id: clearingCaseId,
      projectId: `pol260-project-${suffix}`,
      constructionEnterpriseAssignmentId: `pol260-assignment-${suffix}`,
      category: "project_receivable",
      governedSubjectKey: `pol260-subject-${suffix}`,
      authoritativeGrossCapCents: 6000n,
      createdByUserId: actorUserId
    }
  });
  await client.clearingEvent.create({
    data: {
      id: clearingEventId,
      clearingCaseId,
      kind: "invoice_evidence",
      workflowStatus: "confirmed",
      createdByUserId: actorUserId
    }
  });
  await client.clearingEventVersion.create({
    data: {
      id: clearingEventVersionId,
      clearingEventId,
      clearingCaseId,
      versionNo: 1,
      workflowStatus: "confirmed",
      amountCents: 6000n,
      evidenceLevel: "B",
      payloadSnapshot: {},
      actorSetSnapshot: {},
      fingerprint: "f".repeat(64),
      createdByUserId: actorUserId
    }
  });
  await client.invoiceClearingAllocation.create({
    data: {
      id: blueInvoiceAllocationId,
      invoiceRecordId: blueInvoiceRecordId,
      projectId: `pol260-project-${suffix}`,
      clearingCaseId,
      clearingEventVersionId,
      amountCents: 6000n,
      createdByUserId: actorUserId,
      idempotencyKey: randomUUID(),
      requestFingerprint: "a".repeat(64)
    }
  });
  if (seedLifecycleEvents) {
    await client.invoiceLifecycleEvent.createMany({
      data: [
      {
        id: firstLifecycleEventId,
        invoiceRecordId: blueInvoiceRecordId,
        relatedInvoiceRecordId: firstRedInvoiceRecordId,
        kind: "red",
        reasonCode: "sales_return",
        createdByUserId: actorUserId,
        idempotencyKey: randomUUID(),
        requestFingerprint: "b".repeat(64)
      },
      {
        id: secondLifecycleEventId,
        invoiceRecordId: blueInvoiceRecordId,
        relatedInvoiceRecordId: secondRedInvoiceRecordId,
        kind: "red",
        reasonCode: "sales_return",
        createdByUserId: actorUserId,
        idempotencyKey: randomUUID(),
        requestFingerprint: "c".repeat(64)
      }
      ]
    });
  }
  return {
    actorUserId,
    blueInvoiceRecordId,
    blueInvoiceAllocationId,
    projectId: `pol260-project-${suffix}`,
    clearingCaseId,
    clearingEventVersionId,
    firstLifecycleEventId,
    firstRedInvoiceRecordId,
    secondLifecycleEventId,
    secondRedInvoiceRecordId
  };
}

async function seedEvidenceRepairCompetition(client: PrismaClientType) {
  const suffix = randomUUID();
  const actorUserId = `pol260-repair-actor-${suffix}`;
  const invalidatedInvoiceRecordId = `pol260-invalidated-${suffix}`;
  const replacementInvoiceRecordId = `pol260-replacement-${suffix}`;
  const replacementFileId = `file-${replacementInvoiceRecordId}`;
  const lifecycleEventId = `pol260-void-${suffix}`;
  const clearingCaseId = `pol260-repair-case-${suffix}`;
  const clearingEventId = `pol260-repair-event-${suffix}`;
  const clearingEventVersionId = `pol260-repair-version-${suffix}`;
  const projectId = `pol260-repair-project-${suffix}`;
  const allocationIds = [
    `pol260-repair-allocation-a-${suffix}`,
    `pol260-repair-allocation-b-${suffix}`
  ];
  const impactIds = [
    `pol260-impact-a-${suffix}`,
    `pol260-impact-b-${suffix}`
  ];

  await client.user.create({
    data: { id: actorUserId, name: "POL-11B 证据修复动态验收财务主管" }
  });
  await client.fileObject.createMany({
    data: [invalidatedInvoiceRecordId, replacementInvoiceRecordId].map(
      (invoiceId, index) => ({
        id: `file-${invoiceId}`,
        bucket: "private-local",
        objectKey: `pol260/${invoiceId}.pdf`,
        originalName: `repair-invoice-${index + 1}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 10,
        uploadedByUserId: actorUserId,
        contentSha256: String(index + 4).repeat(64)
      })
    )
  });
  const invoiceData = (id: string, totalAmountCents: bigint) => ({
    id,
    projectId: null,
    identityKey: `identity-${id}`,
    identityKind: "traditional",
    owningCompanyEntityId: "pol260-repair-company",
    direction: "inbound",
    invoiceType: "vat_general",
    invoiceCode: `CODE-${id}`,
    invoiceNumber: `NO-${id}`,
    issueDate: new Date("2026-09-07T00:00:00.000Z"),
    sellerName: "POL-11B 销售方",
    sellerTaxId: "91310000POL260SELL",
    buyerName: "POL-11B 购买方",
    buyerTaxId: "91310000POL260BUYR",
    taxExclusiveAmountCents: totalAmountCents,
    taxAmountCents: 0n,
    totalAmountCents,
    allocatableAmountCents: totalAmountCents,
    fileId: `file-${id}`,
    uploadedByUserId: actorUserId,
    sourceBusinessType: "global_clearing_invoice",
    sourceBusinessId: `source-${id}`
  });
  await client.invoiceRecord.createMany({
    data: [
      invoiceData(invalidatedInvoiceRecordId, 8000n),
      invoiceData(replacementInvoiceRecordId, 6000n)
    ]
  });
  await client.clearingCase.create({
    data: {
      id: clearingCaseId,
      projectId,
      constructionEnterpriseAssignmentId: `pol260-repair-assignment-${suffix}`,
      category: "project_receivable",
      governedSubjectKey: `pol260-repair-subject-${suffix}`,
      authoritativeGrossCapCents: 8000n,
      createdByUserId: actorUserId
    }
  });
  await client.clearingEvent.create({
    data: {
      id: clearingEventId,
      clearingCaseId,
      kind: "invoice_evidence",
      workflowStatus: "confirmed",
      createdByUserId: actorUserId
    }
  });
  await client.clearingEventVersion.create({
    data: {
      id: clearingEventVersionId,
      clearingEventId,
      clearingCaseId,
      versionNo: 1,
      workflowStatus: "confirmed",
      amountCents: 8000n,
      evidenceLevel: "B",
      payloadSnapshot: {},
      actorSetSnapshot: {},
      fingerprint: "e".repeat(64),
      createdByUserId: actorUserId
    }
  });
  await client.invoiceClearingAllocation.createMany({
    data: allocationIds.map((id) => ({
      id,
      invoiceRecordId: invalidatedInvoiceRecordId,
      projectId,
      clearingCaseId,
      clearingEventVersionId,
      amountCents: 4000n,
      createdByUserId: actorUserId,
      idempotencyKey: randomUUID(),
      requestFingerprint: "a".repeat(64)
    }))
  });
  await client.invoiceLifecycleEvent.create({
    data: {
      id: lifecycleEventId,
      invoiceRecordId: invalidatedInvoiceRecordId,
      kind: "void",
      reasonCode: "invoice_voided",
      createdByUserId: actorUserId,
      idempotencyKey: randomUUID(),
      requestFingerprint: "b".repeat(64)
    }
  });
  await client.invoiceEvidenceRepairImpact.createMany({
    data: impactIds.map((id, index) => ({
      id,
      lifecycleEventId,
      invoiceRecordId: invalidatedInvoiceRecordId,
      allocationId: allocationIds[index]!,
      projectId,
      clearingCaseId,
      clearingEventVersionId,
      invalidatedAmountCents: 4000n,
      reasonCode: "invoice_voided",
      actualActorUserId: actorUserId
    }))
  });
  return {
    actorUserId,
    invalidatedInvoiceRecordId,
    replacementInvoiceRecordId,
    replacementFileId,
    lifecycleEventId,
    projectId,
    clearingCaseId,
    clearingEventVersionId,
    allocationIds,
    impactIds
  };
}
