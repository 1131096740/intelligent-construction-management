import { Prisma } from "@prisma/client";
import { OperatingTakeoverSourceAdapter } from "./operating-takeover-source.adapter";

describe("OperatingTakeoverSourceAdapter", () => {
  it("reconstructs an immutable original fact from its stored source snapshot", () => {
    const adapter = new OperatingTakeoverSourceAdapter();
    const sourceSnapshot = {
      batchId: "batch-1",
      rowId: "row-1",
      fact: {
        occurredAt: "2026-08-01T00:00:00.000Z",
        confirmedAt: "2026-08-16T00:00:00.000Z",
        confirmedByUserId: "finance-1",
        factKind: "expense",
        operatingLevel: "project",
        evidenceLevel: "A",
        amountCents: "10005",
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: true,
        affiliateAssignmentId: "assignment-1",
        affiliateBusinessPartyVersionId: "party-version-1",
        affiliateNameSnapshot: "施工企业",
        historicalTakeoverBatchId: "batch-1",
        subjects: { costBearingCompany: { kind: "construction_enterprise", id: "party-1" } },
        impacts: [{
          idempotencyKey: "cost:10005",
          sourceImpactKey: "cost",
          impactKind: "confirmed_cost",
          amountCents: "10005",
          direction: "increase",
          subjectRole: "cost_bearing_company",
          subject: { kind: "construction_enterprise", id: "party-1" },
          costCategoryCode: "material",
          impactSnapshot: {}
        }]
      }
    } as unknown as Prisma.InputJsonObject;
    const mapped = adapter.toOperatingFactInput({
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "row-1",
      sourceBusinessCode: "OT-1-1",
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot
    });

    expect(mapped.entryKind).toBe("original");
    expect(mapped.input.amountCents).toBe(10005n);
    expect(mapped.input.impacts[0].amountCents).toBe(10005n);
    expect(mapped.input.sourceSnapshot).toBe(sourceSnapshot);
  });
});
