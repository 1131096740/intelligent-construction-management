import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../database/prisma.service";
import {
  type AppendOperatingFactInput,
  OperatingLedgerService,
  type OperatingLedgerTransaction
} from "./operating-ledger.service";
import {
  mapOperatingSourceSnapshot,
  OperatingSourceAdapterRegistry,
  type OperatingSourceLocator,
  requireOperatingSourceSnapshot
} from "./operating-source-adapter";

type StoredOperatingFact = Prisma.OperatingFactGetPayload<{
  include: { impacts: true };
}>;

export type OperatingConsistencyDifferenceKind =
  | "missing_fact"
  | "unexpected_fact"
  | "fact_mismatch"
  | "missing_impact"
  | "unexpected_impact"
  | "impact_mismatch";

export interface OperatingConsistencyDifference {
  kind: OperatingConsistencyDifferenceKind;
  sourceType: string;
  sourceBusinessId: string;
  sourceBusinessCode: string;
  sourceImpactKey?: string;
  field?: string;
  message: string;
}

export interface OperatingConsistencyReport {
  projectId: string;
  consistent: boolean;
  summary: {
    expectedFacts: number;
    actualFacts: number;
    expectedImpacts: number;
    actualImpacts: number;
    differenceCount: number;
  };
  differences: OperatingConsistencyDifference[];
}

@Injectable()
export class OperatingSourceReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operatingLedger: OperatingLedgerService,
    private readonly registry: OperatingSourceAdapterRegistry
  ) {}

  async replaySource(locator: OperatingSourceLocator, actorUserId: string) {
    const adapter = this.registry.require(locator.sourceType);
    return this.prisma.$transaction(async (tx) => {
      const snapshot = requireOperatingSourceSnapshot(
        await adapter.readSourceSnapshot(tx, locator),
        locator
      );
      const input = mapOperatingSourceSnapshot(adapter, snapshot, locator);
      return this.operatingLedger.appendFromSourceInTransaction(
        tx,
        input,
        actorUserId
      );
    });
  }

  async compareProject(
    projectId: string,
    actorUserId: string
  ): Promise<OperatingConsistencyReport> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const actualFacts = await this.operatingLedger.readFactsInTransaction(
        tx,
        projectId,
        actorUserId
      );
      for (const fact of actualFacts) this.registry.require(fact.sourceType);

      const expectedFacts = await this.readExpectedFacts(tx, projectId);
      const differences = compareFacts(expectedFacts, actualFacts);
      const expectedImpacts = expectedFacts.reduce(
        (total, fact) => total + fact.impacts.length,
        0
      );
      const actualImpacts = actualFacts.reduce(
        (total, fact) => total + fact.impacts.length,
        0
      );
      return {
        projectId,
        consistent: differences.length === 0,
        summary: {
          expectedFacts: expectedFacts.length,
          actualFacts: actualFacts.length,
          expectedImpacts,
          actualImpacts,
          differenceCount: differences.length
        },
        differences
      };
    });
  }

  private async readExpectedFacts(
    tx: OperatingLedgerTransaction,
    projectId: string
  ): Promise<AppendOperatingFactInput[]> {
    const expected: AppendOperatingFactInput[] = [];
    const seen = new Set<string>();
    for (const adapter of this.registry.list()) {
      const snapshots = await adapter.readProjectSnapshots(tx, projectId);
      for (const snapshot of snapshots) {
        const input = mapOperatingSourceSnapshot(adapter, snapshot);
        if (input.projectId !== projectId) {
          throw new BadRequestException("来源适配器返回了其他项目的冻结快照");
        }
        const key = sourceKey(input.sourceType, input.sourceBusinessId);
        if (seen.has(key)) {
          throw new BadRequestException(
            `经营来源快照重复：${input.sourceType}/${input.sourceBusinessId}`
          );
        }
        seen.add(key);
        expected.push(input);
      }
    }
    return expected.sort((left, right) =>
      sourceKey(left.sourceType, left.sourceBusinessId).localeCompare(
        sourceKey(right.sourceType, right.sourceBusinessId)
      )
    );
  }
}

function compareFacts(
  expectedFacts: readonly AppendOperatingFactInput[],
  actualFacts: readonly StoredOperatingFact[]
): OperatingConsistencyDifference[] {
  const differences: OperatingConsistencyDifference[] = [];
  const actualBySource = new Map(
    actualFacts.map((fact) => [sourceKey(fact.sourceType, fact.sourceBusinessId), fact])
  );
  const expectedKeys = new Set<string>();

  for (const expected of expectedFacts) {
    const key = sourceKey(expected.sourceType, expected.sourceBusinessId);
    expectedKeys.add(key);
    const actual = actualBySource.get(key);
    if (!actual) {
      differences.push(
        difference(expected, "missing_fact", "缺少经营事实：正式来源尚未进入经营事实账")
      );
      continue;
    }
    compareFactFields(expected, actual, differences);
    compareImpacts(expected, actual, differences);
  }

  for (const actual of actualFacts) {
    const key = sourceKey(actual.sourceType, actual.sourceBusinessId);
    if (expectedKeys.has(key)) continue;
    differences.push({
      kind: "unexpected_fact",
      sourceType: actual.sourceType,
      sourceBusinessId: actual.sourceBusinessId,
      sourceBusinessCode: actual.sourceBusinessCode,
      message: "经营事实账存在正式来源中已不存在的经营事实"
    });
  }
  return differences;
}

function compareFactFields(
  expected: AppendOperatingFactInput,
  actual: StoredOperatingFact,
  differences: OperatingConsistencyDifference[]
) {
  const fields: Array<[string, unknown, unknown]> = [
    ["sourceBusinessCode", expected.sourceBusinessCode, actual.sourceBusinessCode],
    ["sourceVersion", expected.sourceVersion, actual.sourceVersion],
    ["occurredAt", expected.occurredAt, actual.occurredAt],
    ["confirmedAt", expected.confirmedAt, actual.confirmedAt],
    ["confirmedByUserId", expected.confirmedByUserId, actual.confirmedByUserId],
    ["factKind", expected.factKind, actual.factKind],
    ["operatingLevel", expected.operatingLevel, actual.operatingLevel],
    ["evidenceLevel", expected.evidenceLevel, actual.evidenceLevel],
    ["amountCents", expected.amountCents, actual.amountCents],
    ["currencyCode", expected.currencyCode, actual.currencyCode],
    ["direction", expected.direction, actual.direction],
    [
      "isBeforeOperatingLedgerEffectiveDate",
      expected.isBeforeOperatingLedgerEffectiveDate,
      actual.isBeforeOperatingLedgerEffectiveDate
    ],
    ["affiliateAssignmentId", expected.affiliateAssignmentId, actual.affiliateAssignmentId],
    [
      "affiliateBusinessPartyVersionId",
      expected.affiliateBusinessPartyVersionId,
      actual.affiliateBusinessPartyVersionId
    ],
    ["affiliateNameSnapshot", expected.affiliateNameSnapshot, actual.affiliateNameSnapshot],
    [
      "affiliateCreditCodeSnapshot",
      expected.affiliateCreditCodeSnapshot ?? null,
      actual.affiliateCreditCodeSnapshot
    ],
    [
      "historicalTakeoverBatchId",
      expected.historicalTakeoverBatchId ?? null,
      actual.historicalTakeoverBatchId
    ],
    ["idempotencyKey", expected.idempotencyKey, actual.idempotencyKey],
    ["entryKind", "original", actual.entryKind],
    ["status", "confirmed", actual.status],
    ["sourceSnapshot", expected.sourceSnapshot, actual.sourceSnapshot],
    ["basisSnapshot", expected.basisSnapshot ?? null, actual.basisSnapshot]
  ];
  for (const [field, expectedValue, actualValue] of fields) {
    if (sameValue(expectedValue, actualValue)) continue;
    differences.push(
      difference(
        expected,
        "fact_mismatch",
        `经营事实字段与正式来源不一致：${field}`,
        { field }
      )
    );
  }

  const subjectFields = subjectColumns(expected);
  for (const [field, expectedValue] of Object.entries(subjectFields)) {
    const actualValue = actual[field as keyof StoredOperatingFact];
    if (sameValue(expectedValue, actualValue)) continue;
    differences.push(
      difference(
        expected,
        "fact_mismatch",
        `经营事实主体与正式来源不一致：${field}`,
        { field }
      )
    );
  }
}

function compareImpacts(
  expected: AppendOperatingFactInput,
  actual: StoredOperatingFact,
  differences: OperatingConsistencyDifference[]
) {
  const actualByKey = new Map(
    actual.impacts.map((impact) => [impact.sourceImpactKey, impact])
  );
  const expectedKeys = new Set<string>();
  for (const expectedImpact of expected.impacts) {
    expectedKeys.add(expectedImpact.sourceImpactKey);
    const actualImpact = actualByKey.get(expectedImpact.sourceImpactKey);
    if (!actualImpact) {
      differences.push(
        difference(expected, "missing_impact", "经营事实缺少预期影响分录", {
          sourceImpactKey: expectedImpact.sourceImpactKey
        })
      );
      continue;
    }
    const fields: Array<[string, unknown, unknown]> = [
      ["idempotencyKey", expectedImpact.idempotencyKey, actualImpact.idempotencyKey],
      ["impactKind", expectedImpact.impactKind, actualImpact.impactKind],
      ["amountCents", expectedImpact.amountCents, actualImpact.amountCents],
      ["direction", expectedImpact.direction, actualImpact.direction],
      ["subjectRole", expectedImpact.subjectRole ?? null, actualImpact.subjectRole],
      ["subjectKind", expectedImpact.subject?.kind ?? null, actualImpact.subjectKind],
      ["subjectId", expectedImpact.subject?.id ?? null, actualImpact.subjectId],
      [
        "costCategoryCode",
        expectedImpact.costCategoryCode ?? null,
        actualImpact.costCategoryCode
      ],
      ["fundPurpose", expectedImpact.fundPurpose ?? null, actualImpact.fundPurpose],
      ["description", expectedImpact.description ?? null, actualImpact.description]
    ];
    for (const [field, expectedValue, actualValue] of fields) {
      if (sameValue(expectedValue, actualValue)) continue;
      differences.push(
        difference(
          expected,
          "impact_mismatch",
          `经营影响分录与正式来源不一致：${field}`,
          { field, sourceImpactKey: expectedImpact.sourceImpactKey }
        )
      );
    }
    if (
      expectedImpact.impactSnapshot &&
      !jsonContains(actualImpact.impactSnapshot, expectedImpact.impactSnapshot)
    ) {
      differences.push(
        difference(
          expected,
          "impact_mismatch",
          "经营影响分录快照与正式来源不一致",
          { field: "impactSnapshot", sourceImpactKey: expectedImpact.sourceImpactKey }
        )
      );
    }
  }

  for (const actualImpact of actual.impacts) {
    if (expectedKeys.has(actualImpact.sourceImpactKey)) continue;
    differences.push(
      difference(expected, "unexpected_impact", "经营事实存在正式来源未产生的影响分录", {
        sourceImpactKey: actualImpact.sourceImpactKey
      })
    );
  }
}

function difference(
  input: AppendOperatingFactInput,
  kind: OperatingConsistencyDifferenceKind,
  message: string,
  details: Pick<OperatingConsistencyDifference, "field" | "sourceImpactKey"> = {}
): OperatingConsistencyDifference {
  return {
    kind,
    sourceType: input.sourceType,
    sourceBusinessId: input.sourceBusinessId,
    sourceBusinessCode: input.sourceBusinessCode,
    ...details,
    message
  };
}

function sourceKey(sourceType: string, sourceBusinessId: string): string {
  return `${sourceType}\u0000${sourceBusinessId}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (typeof left === "bigint" && typeof right === "bigint") return left === right;
  if (left && right && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
  }
  return left === right;
}

function jsonContains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => jsonContains(actual[index], value))
    );
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      jsonContains((actual as Record<string, unknown>)[key], value)
    );
  }
  return sameValue(actual, expected);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}

function subjectColumns(input: AppendOperatingFactInput): Record<string, string | null> {
  return {
    debtorSubjectKind: input.subjects.debtor?.kind ?? null,
    debtorSubjectId: input.subjects.debtor?.id ?? null,
    creditorSubjectKind: input.subjects.creditor?.kind ?? null,
    creditorSubjectId: input.subjects.creditor?.id ?? null,
    approvedPayerSubjectKind: input.subjects.approvedPayer?.kind ?? null,
    approvedPayerSubjectId: input.subjects.approvedPayer?.id ?? null,
    actualPayerSubjectKind: input.subjects.actualPayer?.kind ?? null,
    actualPayerSubjectId: input.subjects.actualPayer?.id ?? null,
    payeeSubjectKind: input.subjects.payee?.kind ?? null,
    payeeSubjectId: input.subjects.payee?.id ?? null,
    costBearingCompanySubjectKind: input.subjects.costBearingCompany?.kind ?? null,
    costBearingCompanySubjectId: input.subjects.costBearingCompany?.id ?? null
  };
}
