import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../database/prisma.service";
import {
  type AppendOperatingFactInput,
  OperatingLedgerService,
  type OperatingLedgerTransaction,
  type OperatingSourceComparisonState
} from "./operating-ledger.service";
import {
  mapOperatingSourceSnapshot,
  OperatingSourceAdapterRegistry,
  type OperatingSourceLocator,
  requireOperatingSourceSnapshot
} from "./operating-source-adapter";

const EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE = "employee_project_loan_entry";
const POL08_ENTRY_SOURCE_TYPES = new Set([
  "project_upstream_fund_fact",
  "project_affiliate_contract_fact",
  "project_affiliate_settlement_fact",
  "project_affiliate_payment_fact"
]);

type StoredOperatingFact = Prisma.OperatingFactGetPayload<{
  include: { impacts: true };
}>;
type ExpectedOperatingFact = OperatingSourceComparisonState;

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

export type OperatingSourceAppendPort = Pick<
  OperatingSourceReplayService,
  "appendConfirmedSourceIfEnabledInTransaction"
>;

export function missingOperatingSourceReplayService(): OperatingSourceAppendPort {
  return {
    async appendConfirmedSourceIfEnabledInTransaction(
      tx: OperatingLedgerTransaction,
      locator: OperatingSourceLocator
    ) {
      const projectClient = (
        tx as unknown as {
          project?: typeof tx.project;
        }
      ).project;
      if (!projectClient || typeof projectClient.findUnique !== "function") return null;
      const project = await projectClient.findUnique({
        where: { id: locator.projectId },
        select: { operatingLedgerEffectiveDate: true }
      });
      if (project?.operatingLedgerEffectiveDate) {
        throw new Error("经营账来源投影服务未注入，已拒绝正式来源写入");
      }
      return null;
    }
  };
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
      await this.operatingLedger.assertProjectFinanceAccessInTransaction(
        tx,
        actorUserId,
        locator.projectId
      );
      const snapshot = requireOperatingSourceSnapshot(
        await adapter.readSourceSnapshot(tx, locator),
        locator
      );
      const mapped = await this.resolveMappedSourceInput(
        tx,
        mapOperatingSourceSnapshot(adapter, snapshot, locator)
      );
      return this.operatingLedger.replayFromSourceInTransaction(
        tx,
        mapped.input,
        actorUserId,
        mapped.entryKind
      );
    });
  }

  async appendConfirmedSourceIfEnabledInTransaction(
    tx: OperatingLedgerTransaction,
    locator: OperatingSourceLocator,
    actorUserId: string
  ) {
    const project = await tx.project.findUnique({
      where: { id: locator.projectId },
      select: { operatingLedgerEffectiveDate: true }
    });
    if (!project?.operatingLedgerEffectiveDate) return null;

    const adapter = this.registry.require(locator.sourceType);
    const snapshot = requireOperatingSourceSnapshot(
      await adapter.readSourceSnapshot(tx, locator),
      locator
    );
    const mapped = await this.resolveMappedSourceInput(
      tx,
      mapOperatingSourceSnapshot(adapter, snapshot, locator)
    );
    if (mapped.entryKind === "original") {
      return this.operatingLedger.appendConfirmedSourceInTransaction(
        tx,
        mapped.input,
        actorUserId
      );
    }
    if (
      locator.sourceType === EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE &&
      mapped.entryKind === "reversal"
    ) {
      return this.operatingLedger.appendConfirmedEmployeeLoanReversalInTransaction(
        tx,
        mapped.input,
        actorUserId
      );
    }
    if (POL08_ENTRY_SOURCE_TYPES.has(locator.sourceType)) {
      return this.operatingLedger.appendConfirmedSourceInTransaction(
        tx,
        mapped.input,
        actorUserId,
        mapped.entryKind
      );
    }
    throw new BadRequestException("正式业务来源写入只接受原始经营事实");
  }

  async compareProject(
    projectId: string,
    actorUserId: string
  ): Promise<OperatingConsistencyReport> {
    this.registry.assertComplete();
    return this.prisma.$transaction(
      async (tx) => {
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
          (total, fact) => total + fact.input.impacts.length,
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  private async readExpectedFacts(
    tx: OperatingLedgerTransaction,
    projectId: string
  ): Promise<ExpectedOperatingFact[]> {
    const expected: ExpectedOperatingFact[] = [];
    const seen = new Set<string>();
    for (const adapter of this.registry.list()) {
      const snapshots = await adapter.readProjectSnapshots(tx, projectId);
      for (const snapshot of snapshots) {
        const mapped = await this.resolveMappedSourceInput(
          tx,
          mapOperatingSourceSnapshot(adapter, snapshot)
        );
        const input = mapped.input;
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
        expected.push(
          await this.operatingLedger.materializeSourceForComparisonInTransaction(
            tx,
            input,
            mapped.entryKind
          )
        );
      }
    }
    return expected.sort((left, right) =>
      sourceKey(left.input.sourceType, left.input.sourceBusinessId).localeCompare(
        sourceKey(right.input.sourceType, right.input.sourceBusinessId)
      )
    );
  }

  private async resolveMappedSourceInput(
    tx: OperatingLedgerTransaction,
    mapped: ReturnType<typeof mapOperatingSourceSnapshot>
  ): Promise<ReturnType<typeof mapOperatingSourceSnapshot>> {
    if (
      mapped.entryKind === "original" ||
      !POL08_ENTRY_SOURCE_TYPES.has(mapped.input.sourceType)
    ) {
      return mapped;
    }
    const sourceBusinessId = mapped.input.adjustsFactId?.trim();
    if (!sourceBusinessId) {
      throw new BadRequestException("来源更正或冲销缺少原始来源编号");
    }
    const sourceSnapshot = mapped.input.sourceSnapshot;
    const sourceEntryKind =
      !Array.isArray(sourceSnapshot) &&
      typeof sourceSnapshot === "object" &&
      sourceSnapshot !== null
        ? sourceSnapshot.entryKind
        : undefined;
    if (
      mapped.input.sourceType === "project_upstream_fund_fact" &&
      sourceEntryKind === "reclassification"
    ) {
      const upstreamFundFactClient = (tx as unknown as {
        projectUpstreamFundFact?: typeof tx.projectUpstreamFundFact;
      }).projectUpstreamFundFact;
      const target = upstreamFundFactClient
        ? await upstreamFundFactClient.findFirst({
            where: {
              id: sourceBusinessId,
              projectId: mapped.input.projectId,
              factType: "unreconciled_receipt_difference",
              status: "pending_reconciliation"
            },
            select: { id: true }
          })
        : null;
      if (!target) {
        throw new BadRequestException("上游资金重分类必须关联待核对到账差额原记录");
      }
      return {
        entryKind: "original",
        input: { ...mapped.input, adjustsFactId: undefined }
      };
    }
    const operatingFactClient = (tx as unknown as {
      operatingFact?: typeof tx.operatingFact;
    }).operatingFact;
    if (!operatingFactClient) return mapped;
    const target = await operatingFactClient.findUnique({
      where: {
        sourceType_sourceBusinessId: {
          sourceType: mapped.input.sourceType,
          sourceBusinessId
        }
      },
      select: { id: true }
    });
    if (!target) {
      throw new BadRequestException(
        "来源更正或冲销引用的原始来源尚未进入经营事实账"
      );
    }
    return {
      ...mapped,
      input: { ...mapped.input, adjustsFactId: target.id }
    };
  }
}

function compareFacts(
  expectedFacts: readonly ExpectedOperatingFact[],
  actualFacts: readonly StoredOperatingFact[]
): OperatingConsistencyDifference[] {
  const differences: OperatingConsistencyDifference[] = [];
  const actualBySource = new Map(
    actualFacts.map((fact) => [sourceKey(fact.sourceType, fact.sourceBusinessId), fact])
  );
  const expectedKeys = new Set<string>();

  for (const expectedState of expectedFacts) {
    const expected = expectedState.input;
    const key = sourceKey(expected.sourceType, expected.sourceBusinessId);
    expectedKeys.add(key);
    const actual = actualBySource.get(key);
    if (!actual) {
      differences.push(
        difference(expected, "missing_fact", "缺少经营事实：正式来源尚未进入经营事实账")
      );
      continue;
    }
    compareFactFields(expectedState, actual, differences);
    compareImpacts(expectedState, actual, differences);
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
  expectedState: ExpectedOperatingFact,
  actual: StoredOperatingFact,
  differences: OperatingConsistencyDifference[]
) {
  const expected = expectedState.input;
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
    ["entryKind", expectedState.entryKind, actual.entryKind],
    [
      "adjustsFactId",
      expectedState.entryKind === "original" ? null : expected.adjustsFactId ?? null,
      actual.adjustsFactId
    ],
    ["status", "confirmed", actual.status],
    ["sourceSnapshot", expected.sourceSnapshot, actual.sourceSnapshot],
    ["basisSnapshot", expected.basisSnapshot ?? null, actual.basisSnapshot],
    [
      "operatingLedgerEffectiveDateSnapshot",
      expectedState.operatingLedgerEffectiveDateSnapshot,
      actual.operatingLedgerEffectiveDateSnapshot
    ],
    ["subjectSnapshot", expectedState.subjectSnapshot, actual.subjectSnapshot]
  ];
  for (const [field, expectedValue, actualValue] of fields) {
    if (sameValue(expectedValue, actualValue)) continue;
    const fieldLabel = businessFieldLabel(field);
    differences.push(
      difference(
        expected,
        "fact_mismatch",
        `经营事实字段与正式来源不一致：${fieldLabel}`,
        { field: fieldLabel }
      )
    );
  }

  const subjectFields = subjectColumns(expected);
  for (const [field, expectedValue] of Object.entries(subjectFields)) {
    const actualValue = actual[field as keyof StoredOperatingFact];
    if (sameValue(expectedValue, actualValue)) continue;
    const fieldLabel = businessFieldLabel(field);
    differences.push(
      difference(
        expected,
        "fact_mismatch",
        `经营事实主体与正式来源不一致：${fieldLabel}`,
        { field: fieldLabel }
      )
    );
  }
}

function compareImpacts(
  expectedState: ExpectedOperatingFact,
  actual: StoredOperatingFact,
  differences: OperatingConsistencyDifference[]
) {
  const expected = expectedState.input;
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
      const fieldLabel = businessFieldLabel(field);
      differences.push(
        difference(
          expected,
          "impact_mismatch",
          `经营影响分录与正式来源不一致：${fieldLabel}`,
          { field: fieldLabel, sourceImpactKey: expectedImpact.sourceImpactKey }
        )
      );
    }
    const expectedImpactSnapshot = expectedState.impactSnapshots.get(
      expectedImpact.sourceImpactKey
    );
    if (!sameValue(actualImpact.impactSnapshot, expectedImpactSnapshot)) {
      differences.push(
        difference(
          expected,
          "impact_mismatch",
          "经营影响分录快照与正式来源不一致",
          { field: "影响主体快照", sourceImpactKey: expectedImpact.sourceImpactKey }
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

const BUSINESS_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  sourceBusinessCode: "来源业务编号",
  sourceVersion: "来源修订",
  occurredAt: "业务发生时间",
  confirmedAt: "正式确认时间",
  confirmedByUserId: "正式确认人",
  factKind: "经营事实类型",
  operatingLevel: "经营层级",
  evidenceLevel: "证据等级",
  amountCents: "金额（元）",
  currencyCode: "币种",
  direction: "收支方向",
  isBeforeOperatingLedgerEffectiveDate: "经营账生效日前标记",
  affiliateAssignmentId: "施工企业档案",
  affiliateBusinessPartyVersionId: "施工企业档案版本",
  affiliateNameSnapshot: "施工企业名称快照",
  affiliateCreditCodeSnapshot: "施工企业信用代码快照",
  historicalTakeoverBatchId: "历史接管批次",
  idempotencyKey: "来源唯一键",
  entryKind: "事实登记类型",
  adjustsFactId: "原经营事实引用",
  status: "事实状态",
  sourceSnapshot: "来源冻结快照",
  basisSnapshot: "业务依据快照",
  operatingLedgerEffectiveDateSnapshot: "经营账生效日快照",
  subjectSnapshot: "事实主体快照",
  debtorSubjectKind: "债务主体类型",
  debtorSubjectId: "债务主体",
  creditorSubjectKind: "债权主体类型",
  creditorSubjectId: "债权主体",
  approvedPayerSubjectKind: "批准付款主体类型",
  approvedPayerSubjectId: "批准付款主体",
  actualPayerSubjectKind: "实际付款主体类型",
  actualPayerSubjectId: "实际付款主体",
  payeeSubjectKind: "收款主体类型",
  payeeSubjectId: "收款主体",
  costBearingCompanySubjectKind: "成本承担公司类型",
  costBearingCompanySubjectId: "成本承担公司",
  impactKind: "影响分录类型",
  subjectRole: "主体角色",
  subjectKind: "影响主体类型",
  subjectId: "影响主体",
  costCategoryCode: "成本分类",
  fundPurpose: "资金用途",
  description: "业务说明"
});

function businessFieldLabel(field: string): string {
  const label = BUSINESS_FIELD_LABELS[field];
  if (!label) throw new Error(`经营一致性字段缺少中文标签：${field}`);
  return label;
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
