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
          schemaSnapshot: {}
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
          schemaSnapshot: {}
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
  await client.contractBill.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.contractVersion.deleteMany({ where: { id: ids.version } });
  await client.contract.deleteMany({ where: { id: ids.contract } });
  await client.project.deleteMany({ where: { id: ids.project } });
  await client.user.deleteMany({ where: { id: ids.owner } });
}
