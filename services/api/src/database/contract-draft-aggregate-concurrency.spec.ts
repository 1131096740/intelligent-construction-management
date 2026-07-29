import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { BusinessPartyService } from "../business-party/business-party.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { ContractDraftAggregateService } from "../contract-workbench/contract-draft-aggregate.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";

const TEST_DATABASE = "jiangkong_contract_draft_aggregate_test";
const LEASE_TOKEN_PREFIX = "contract-draft-aggregate-concurrency-lease";

export function contractDraftAggregateDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("合同草稿聚合并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("合同草稿聚合并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract draft aggregate PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "allows one revision winner and rolls back an earlier section after a later failure",
    async () => {
      const databaseUrl = contractDraftAggregateDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const first = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const second = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const seededIds: Array<ReturnType<typeof makeIds>> = [];
      const audit = new AuditService();
      const service = (client: PrismaClient) =>
        new ContractDraftAggregateService(
          client as never,
          new ContractWorkbenchService(client as never, audit),
          new ContractBillService(client as never, audit),
          new BusinessPartyService(client as never, audit),
          {
            assertCanBindContractDraftAttachments: async () => undefined
          } as never,
          audit
        );

      try {
        const concurrentIds = makeIds("concurrent");
        seededIds.push(concurrentIds);
        await seedDraft(first, concurrentIds);
        const concurrent = await Promise.allSettled([
          service(first).saveAggregate(
            concurrentIds.version,
            concurrentIds.owner,
            leaseToken(concurrentIds),
            aggregateInput(randomUUID()) as never
          ),
          service(second).saveAggregate(
            concurrentIds.version,
            concurrentIds.owner,
            leaseToken(concurrentIds),
            aggregateInput(randomUUID()) as never
          )
        ]);
        const concurrentFailures = concurrent.flatMap((result) =>
          result.status === "rejected"
            ? [
                result.reason instanceof Error
                  ? result.reason.stack ?? result.reason.message
                  : String(result.reason)
              ]
            : []
        );

        const fulfilled = concurrent.filter(
          (result) => result.status === "fulfilled"
        );
        if (fulfilled.length !== 1) {
          throw new Error(concurrentFailures.join("\n"));
        }
        expect(fulfilled).toHaveLength(1);
        expect(
          concurrent.filter((result) => result.status === "rejected")
        ).toHaveLength(1);
        const rejected = concurrent.find(
          (result) => result.status === "rejected"
        );
        expect(
          rejected && rejected.status === "rejected"
            ? rejected.reason
            : null
        ).toMatchObject({
          response: expect.objectContaining({
            code: "DRAFT_REVISION_CONFLICT"
          })
        });
        await expect(
          first.contractVersion.findUnique({
            where: { id: concurrentIds.version }
          })
        ).resolves.toMatchObject({ draftRevision: 2 });
        await expect(
          first.contractDraftSaveRequest.count({
            where: { contractVersionId: concurrentIds.version }
          })
        ).resolves.toBe(1);
        await expect(
          first.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: concurrentIds.version
            }
          })
        ).resolves.toBe(1);

        const rollbackIds = makeIds("rollback");
        seededIds.push(rollbackIds);
        await seedDraft(first, rollbackIds, true);
        const rollbackService = new ContractDraftAggregateService(
          first as never,
          new ContractWorkbenchService(first as never, audit),
          {
            replaceRowsInTransaction: async (
              tx: PrismaClient,
              _actorUserId: string,
              _version: unknown,
              bill: { id: string }
            ) => {
              if (bill.id === rollbackIds.billB) {
                throw new Error("second bill validation failed");
              }
              await tx.contractBill.update({
                where: { id: rollbackIds.billA },
                data: { revision: { increment: 1 } }
              });
              return { changed: true, revision: 2, rows: [] };
            }
          } as never,
          {
            replaceContractPartiesInTransaction: async () => ({ changed: false })
          } as never,
          {
            assertCanBindContractDraftAttachments: async () => undefined
          } as never,
          audit
        );
        await expect(
          rollbackService.saveAggregate(
            rollbackIds.version,
            rollbackIds.owner,
            leaseToken(rollbackIds),
            aggregateInput(randomUUID(), true) as never
          )
        ).rejects.toThrow("second bill validation failed");
        await expect(
          first.contractBill.findMany({
            where: { id: { in: [rollbackIds.billA, rollbackIds.billB] } },
            orderBy: { id: "asc" }
          })
        ).resolves.toMatchObject([{ revision: 1 }, { revision: 1 }]);
        await expect(
          first.contractVersion.findUnique({ where: { id: rollbackIds.version } })
        ).resolves.toMatchObject({ draftRevision: 1 });
        await expect(
          first.contractDraftSaveRequest.count({
            where: { contractVersionId: rollbackIds.version }
          })
        ).resolves.toBe(0);
      } finally {
        for (const ids of seededIds.reverse()) {
          await cleanupDraft(first, ids);
        }
        await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      }
    },
    30_000
  );

  integrationTest(
    "records 100, 500 and 1000 row aggregate-save budgets without no-op rewrites",
    async () => {
      const databaseUrl = contractDraftAggregateDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const seededIds: Array<ReturnType<typeof makeIds>> = [];
      const audit = new AuditService();
      const aggregate = new ContractDraftAggregateService(
        client as never,
        new ContractWorkbenchService(client as never, audit),
        new ContractBillService(client as never, audit),
        new BusinessPartyService(client as never, audit),
        {
          assertCanBindContractDraftAttachments: async () => undefined
        } as never,
        audit
      );

      try {
        for (const rowCount of [100, 500, 1000]) {
          const ids = makeIds(`performance-${rowCount}`);
          seededIds.push(ids);
          await seedDraft(client, ids, true);
          const firstInput = aggregatePerformanceInput(
            randomUUID(),
            1,
            1,
            performanceRows(rowCount)
          );
          const auditBefore = await client.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: ids.version
            }
          });
          const receiptsBefore = await client.contractDraftSaveRequest.count({
            where: { contractVersionId: ids.version }
          });
          const firstStartedAt = process.hrtime.bigint();
          const firstResult = await aggregate.saveAggregate(
            ids.version,
            ids.owner,
            leaseToken(ids),
            firstInput as never
          );
          const firstDurationMs = elapsedMilliseconds(firstStartedAt);
          const persistedRows = await client.contractBillRow.findMany({
            where: { contractBillId: ids.billA },
            orderBy: { sortOrder: "asc" }
          });
          const billAfterFirst = await client.contractBill.findUniqueOrThrow({
            where: { id: ids.billA }
          });
          const auditAfterFirst = await client.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: ids.version
            }
          });
          const receiptsAfterFirst =
            await client.contractDraftSaveRequest.count({
              where: { contractVersionId: ids.version }
            });

          expect(persistedRows).toHaveLength(rowCount);
          expect(billAfterFirst.revision).toBe(2);
          expect(firstResult).toMatchObject({
            draftRevision: 2,
            effectiveChangedSections: expect.arrayContaining(["bills"])
          });
          expect(auditAfterFirst - auditBefore).toBe(0);
          expect(receiptsAfterFirst - receiptsBefore).toBe(1);

          const noChangeInput = aggregatePerformanceInput(
            randomUUID(),
            2,
            2,
            persistedRows.map((row) => ({
              clientRowKey: `existing-${row.sortOrder}`,
              rowKey: row.rowKey,
              sortOrder: row.sortOrder,
              itemCode: row.itemCode ?? undefined,
              itemName: row.itemName,
              specification: row.specification ?? undefined,
              unit: row.unit,
              quantity: row.quantity?.toString(),
              unitPrice: row.unitPrice?.toString() ?? "0",
              taxRatePercent: row.taxRate?.toString(),
              taxRateSource: row.taxRateSource as
                | "version_default"
                | "row_override",
              isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis ?? undefined,
              customData: row.customData
            }))
          );
          const noChangeStartedAt = process.hrtime.bigint();
          const noChangeResult = await aggregate.saveAggregate(
            ids.version,
            ids.owner,
            leaseToken(ids),
            noChangeInput as never
          );
          const noChangeDurationMs = elapsedMilliseconds(noChangeStartedAt);
          const [
            billAfterNoChange,
            auditAfterNoChange,
            receiptsAfterNoChange
          ] = await Promise.all([
            client.contractBill.findUniqueOrThrow({ where: { id: ids.billA } }),
            client.auditLog.count({
              where: {
                action: "contract.draft.save",
                businessId: ids.version
              }
            }),
            client.contractDraftSaveRequest.count({
              where: { contractVersionId: ids.version }
            })
          ]);

          expect(noChangeResult).toMatchObject({
            draftRevision: 2,
            effectiveChangedSections: []
          });
          expect(billAfterNoChange.revision).toBe(2);
          expect(auditAfterNoChange).toBe(auditAfterFirst);
          expect(receiptsAfterNoChange - receiptsAfterFirst).toBe(1);
          expect(firstDurationMs).toBeLessThan(30_000);
          expect(noChangeDurationMs).toBeLessThan(10_000);

          process.stdout.write(
            `${JSON.stringify({
              event: "contract_draft_aggregate_performance",
              rowCount,
              requestBytes: Buffer.byteLength(JSON.stringify(firstInput)),
              transactionDurationMs: Number(firstDurationMs.toFixed(2)),
              lockHoldUpperBoundMs: Number(firstDurationMs.toFixed(2)),
              changedRows: rowCount,
              saveRequestGrowth: receiptsAfterFirst - receiptsBefore,
              auditLogGrowth: auditAfterFirst - auditBefore,
              noChangeRequestBytes: Buffer.byteLength(
                JSON.stringify(noChangeInput)
              ),
              noChangeTransactionDurationMs: Number(
                noChangeDurationMs.toFixed(2)
              ),
              noChangeLockHoldUpperBoundMs: Number(
                noChangeDurationMs.toFixed(2)
              ),
              noChangeChangedRows: 0,
              noChangeSaveRequestGrowth:
                receiptsAfterNoChange - receiptsAfterFirst,
              noChangeAuditLogGrowth: auditAfterNoChange - auditAfterFirst
            })}\n`
          );
        }
      } finally {
        for (const ids of seededIds.reverse()) {
          await cleanupDraft(client, ids);
        }
        await client.$disconnect();
      }
    },
    120_000
  );
});

function makeIds(kind: string) {
  const suffix = randomUUID();
  return {
    owner: `draft-aggregate-owner-${suffix}`,
    project: `draft-aggregate-project-${suffix}`,
    contract: `draft-aggregate-contract-${suffix}`,
    version: `draft-aggregate-version-${suffix}`,
    billA: `draft-aggregate-bill-${suffix}-a`,
    billB: `draft-aggregate-bill-${suffix}-b`,
    kind
  };
}

async function seedDraft(
  client: PrismaClient,
  ids: ReturnType<typeof makeIds>,
  withBill = false
) {
  await client.user.create({
    data: { id: ids.owner, name: `聚合${ids.kind}经办人` }
  });
  await client.project.create({
    data: {
      id: ids.project,
      code: `DRAFT-AGG-${randomUUID()}`,
      name: `聚合${ids.kind}项目`
    }
  });
  await client.contract.create({
    data: {
      id: ids.contract,
      projectId: ids.project,
      source: "system",
      code: null,
      temporaryCode: `DRAFT-AGG-${randomUUID()}`,
      name: `聚合${ids.kind}合同`,
      counterparty: "聚合并发验证单位",
      contractTypeKey: "material_purchase",
      ownerUserId: ids.owner
    }
  });
  await client.contractVersion.create({
    data: {
      id: ids.version,
      contractId: ids.contract,
      versionNo: 1,
      changeType: "original",
      status: "draft",
      amountCents: 0n,
      draftRevision: 1,
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountLimitType: "capped",
      defaultTaxRatePercent: "13",
      draftData: {},
      templateSnapshot: {
        fieldSchema: [],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: []
      },
      clauseSnapshot: []
    }
  });
  await client.contractDraftEditLease.create({
    data: {
      contractVersionId: ids.version,
      holderUserId: ids.owner,
      tokenHash: createHash("sha256").update(leaseToken(ids)).digest("hex"),
      expiresAt: new Date(Date.now() + 120_000)
    }
  });
  if (withBill) {
    await client.contractBill.createMany({
      data: [
        {
          id: ids.billA,
          contractVersionId: ids.version,
          billKey: "main",
          name: "主清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          schemaSnapshot: { columns: [] }
        },
        {
          id: ids.billB,
          contractVersionId: ids.version,
          billKey: "secondary",
          name: "第二清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          schemaSnapshot: { columns: [] }
        }
      ]
    });
  }
}

function leaseToken(ids: ReturnType<typeof makeIds>) {
  return `${LEASE_TOKEN_PREFIX}:${ids.version}`;
}

function aggregateInput(idempotencyKey: string, withBill = false) {
  return {
    idempotencyKey,
    saveKind: "manual" as const,
    expectedRevision: 1,
    changedSections: ["draft"] as const,
    draft: {
      draftData: {},
      clauses: [],
      pricingNature: "fixed_total" as const,
      amountSource: "manual" as const,
      manualAmountCents: "100",
      taxFacts: {
        invoiceType: null,
        taxMode: "single_rate" as const,
        defaultTaxRatePercent: null,
        source: "contract_document" as const
      }
    },
    parties: [],
    bills: withBill
      ? [
          { billKey: "main", expectedRevision: 1, rows: [] },
          { billKey: "secondary", expectedRevision: 1, rows: [] }
        ]
      : [],
    paymentTerms: null,
    attachments: [],
    negotiationDocuments: {
      referencedGeneratedDocumentIds: []
    }
  };
}

function performanceRows(rowCount: number) {
  return Array.from({ length: rowCount }, (_, index) => ({
    clientRowKey: `new-${index}`,
    sortOrder: index,
    itemCode: `ITEM-${index + 1}`,
    itemName: `性能验证清单行 ${index + 1}`,
    unit: "项",
    quantity: "1",
    unitPrice: "1.00",
    taxRatePercent: "13",
    taxRateSource: "version_default" as const,
    isProvisional: false,
    customData: {}
  }));
}

function aggregatePerformanceInput(
  idempotencyKey: string,
  expectedRevision: number,
  expectedBillRevision: number,
  rows: Array<Record<string, unknown>>
) {
  const base = aggregateInput(idempotencyKey, true);
  return {
    ...base,
    saveKind: "auto" as const,
    expectedRevision,
    changedSections: ["draft", "bills"] as const,
    draft: {
      ...base.draft,
      amountSource: "bill_sum" as const,
      manualAmountCents: undefined,
      taxFacts: {
        ...base.draft.taxFacts,
        defaultTaxRatePercent: "13"
      }
    },
    bills: [
      {
        billKey: "main",
        expectedRevision: expectedBillRevision,
        rows
      },
      {
        billKey: "secondary",
        expectedRevision: 1,
        rows: []
      }
    ]
  };
}

function elapsedMilliseconds(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function cleanupDraft(
  client: PrismaClient,
  ids: ReturnType<typeof makeIds>
) {
  await client.contractDraftSaveRequest.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.auditLog.deleteMany({ where: { businessId: ids.version } });
  await client.contractDraftEditLease.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.contractBillRow.deleteMany({
    where: { contractBillId: { in: [ids.billA, ids.billB] } }
  });
  await client.contractBillRowLineage.deleteMany({
    where: { createdInContractVersionId: ids.version }
  });
  await client.contractBill.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.contractVersion.deleteMany({ where: { id: ids.version } });
  await client.contract.deleteMany({ where: { id: ids.contract } });
  await client.project.deleteMany({ where: { id: ids.project } });
  await client.user.deleteMany({ where: { id: ids.owner } });
}
