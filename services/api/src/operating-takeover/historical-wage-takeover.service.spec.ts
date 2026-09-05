import "reflect-metadata";

import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";

import { ANY_PROJECT_POSITION_SCOPE_KEY, REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { HistoricalWageTakeoverController } from "./historical-wage-takeover.controller";
import {
  finalizeHistoricalWageBalanceTarget,
  historicalWageSummarySelectionFingerprint,
  parseHistoricalWageSummaryAuthority
} from "./historical-wage-takeover-r2";
import {
  computePol219AssignedWageExclusionSet,
  computePol219HistoricalWageAuthorityFingerprint,
  computePol219HistoricalWageSourceVersionFingerprint
} from "./historical-wage-takeover-fingerprint";
import { HistoricalWageTakeoverSelectionRefService } from "./historical-wage-takeover-selection-ref.service";
import { HistoricalWageTakeoverService, historicalWageLegacyFingerprint } from "./historical-wage-takeover.service";
import { fingerprint } from "./operating-takeover.utils";

const HASH = "a".repeat(64);

describe("HistoricalWageTakeoverController authorization", () => {
  it("binds every route to company-global finance positions with the exact action matrix", () => {
    const expected = {
      options: { action: "clearing.prepare", positions: ["finance_staff", "finance_director"] },
      issueScopedCommandSelection: { action: "clearing.prepare", positions: ["finance_staff", "finance_director"] },
      createScope: { action: "clearing.prepare", positions: ["finance_staff", "finance_director"] },
      apply: { action: "clearing.prepare", positions: ["finance_staff", "finance_director"] },
      attest: { action: "clearing.attest", positions: ["finance_director"] },
      activate: { action: "clearing.confirm", positions: ["finance_director"] },
      compensate: { action: "clearing.confirm", positions: ["finance_director"] }
    } as const;

    for (const [method, policy] of Object.entries(expected)) {
      const handler = HistoricalWageTakeoverController.prototype[
        method as keyof typeof HistoricalWageTakeoverController.prototype
      ];
      expect(Reflect.getMetadata(ANY_PROJECT_POSITION_SCOPE_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(policy.action);
      expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler)).toEqual(policy.positions);
    }
  });
});

describe("HistoricalWageTakeoverService", () => {
  const legacyFact = {
    id: "fact-1",
    projectId: "project-1",
    sourceType: "project_wage",
    sourceBusinessId: "legacy-wage-1",
    sourceVersion: 1,
    factKind: "project_wage",
    amountCents: 1000n,
    occurredAt: new Date("2026-08-31T00:00:00.000Z"),
    costBearingCompanySubjectKind: "participating_company",
    costBearingCompanySubjectId: "company-1",
    entryKind: "original",
    status: "confirmed",
    sourceSnapshot: { legacy: true },
    impacts: [
      { id: "impact-cost-1", impactKind: "confirmed_cost", amountCents: 1000n, direction: "increase", sourceImpactKey: "cost" },
      { id: "impact-payable-1", impactKind: "payable_increase", amountCents: 1000n, direction: "increase", sourceImpactKey: "payable" }
    ]
  };
  const LEGACY_HASH = historicalWageLegacyFingerprint(legacyFact);

  function receiptCommandEvidence(
    action: string,
    actorUserId: string,
    expectedRevision: number,
    atomicScopeVersionId: string,
    delegatorUserId: string | null = null
  ) {
    const commandSnapshot = {
      action,
      actorUserId,
      binding: {
        actorUserId,
        ...(delegatorUserId ? { delegatorUserId } : {}),
        selectionFingerprint: "e".repeat(64),
        ...(action === "historical_wage_takeover.scope.create" ? {} : { atomicScopeVersionId }),
        legacyCoordinates: [],
        grade: "A"
      },
      expectedRevision,
      businessReason: "历史工资接管测试命令证据",
      evidenceRefs: [],
      delegatorUserId
    };
    return {
      commandSnapshotSchemaVersion: 1,
      commandSnapshot,
      fingerprint: fingerprint(commandSnapshot)
    };
  }

  function r2Coordinate(rowNumber: string) {
    return {
      sourceObjectSha256: "1".repeat(64),
      worksheetName: "历史工资表",
      rowNumber,
      columnNumber: null,
      normalizedRowSha256: "2".repeat(64)
    };
  }

  function r2HistoricalSummary() {
    const sourceEvidence = {
      fileObjectId: "file-source-1",
      contentSha256: "3".repeat(64),
      evidenceCoordinate: r2Coordinate("12")
    };
    return {
      schemaVersion: 1,
      sourceDiscriminator: "historical_wage_summary",
      sourceObjectId: "legacy-wage-1",
      sourceObjectCoordinate: r2Coordinate("12"),
      originalSourceVersion: "V1",
      originalBusinessNumber: "WAGE-2026-08",
      asOfDate: "2026-08-31",
      basisDate: null,
      sourceHeader: {
        employmentCompanyId: "company-1",
        employmentCompanyNameSnapshot: "工资承担公司",
        employmentCompanyCreditCodeSnapshot: "913100000000000001",
        projectId: "project-1",
        projectCodeSnapshot: "P-1",
        projectNameSnapshot: "项目一",
        wageMonth: "2026-08",
        catalogVersion: "historical_wage_position_category_v1",
        positionCategoryCode: "engineering_technical",
        positionCategoryLabelSnapshot: "工程技术人员"
      },
      originalControlledScopeDescription: null,
      evidence: [sourceEvidence],
      sourceDeclarerSnapshot: { externalIdentityId: "source-declarer-1" },
      sourceEvidenceReviewerSnapshot: {
        externalIdentityId: "source-reviewer-1",
        evidence: [sourceEvidence]
      },
      sourceVersionFingerprint: null,
      lines: [{
        creditorCategoryCode: "employee_net_pay",
        creditorCategoryLabel: "员工实发工资",
        creditorIdentityKind: "aggregate_creditor_scope",
        creditorPartyVersionId: null,
        controlledScopeCode: "employees",
        controlledScopeDescription: "历史员工实发工资范围",
        controlledScopeEvidenceCoordinate: r2Coordinate("13"),
        grossDebtCents: "1000",
        historicallySettledCents: "0",
        outstandingBalanceCents: "1000",
        debtStatus: "outstanding",
        target: {
          kind: "historical_wage_balance_reconciliation_version",
          reconciliationAuthorityVersionId: "balance-v1",
          reconciliationReference: "BAL-2026-08-1",
          schemaVersion: 1,
          sourceVersionFingerprint: null,
          reconciliationFingerprint: null,
          asOfDate: "2026-08-31",
          employmentCompanyId: "company-1",
          employmentCompanyNameSnapshot: "工资承担公司",
          employmentCompanyCreditCodeSnapshot: "913100000000000001",
          projectId: "project-1",
          projectCodeSnapshot: "P-1",
          projectNameSnapshot: "项目一",
          wageMonth: "2026-08",
          catalogVersion: "historical_wage_position_category_v1",
          positionCategoryCode: "engineering_technical",
          positionCategoryLabelSnapshot: "工程技术人员",
          wageCreditorCategoryCode: "employee_net_pay",
          wageCreditorCategoryLabelSnapshot: "员工实发工资",
          currencyCode: "CNY",
          debtStatus: "outstanding",
          grossDebtCents: "1000",
          historicallySettledCents: "0",
          outstandingBalanceCents: "1000",
          evidence: [{
            fileObjectId: "file-balance-1",
            contentSha256: "4".repeat(64),
            evidenceCoordinate: r2Coordinate("14")
          }],
          supportingPaymentExecutions: []
        }
      }],
      assignedWageExclusions: [],
      assignedWageExclusionSetFingerprint: null
    };
  }

  function schemaFaithfulApprovedSource<T extends {
    id: string;
    employmentCompanyId?: string;
    wageMonth: string;
    evidenceFileId: string;
    evidenceSha256: string;
    sourceSnapshot: { approvedPersonLines: Array<Record<string, unknown>> };
  }>(source: T) {
    const employmentCompanyId = source.employmentCompanyId ??
      String(source.sourceSnapshot.approvedPersonLines[0]?.employmentCompanyId ?? "");
    const periodStart = new Date(`${source.wageMonth}-01T00:00:00.000Z`);
    const [year, month] = source.wageMonth.split("-").map(Number);
    const lastDay = String(new Date(Date.UTC(year!, month!, 0)).getUTCDate()).padStart(2, "0");
    const periodEnd = new Date(`${source.wageMonth}-${lastDay}T00:00:00.000Z`);
    const externalReference = `PAYROLL-${source.id}`;
    const sourceVersion = "v1";
    const approvedPersonLines = source.sourceSnapshot.approvedPersonLines.map((person) => {
      const employeeId = String(person.employeeId ?? "");
      const approvedAmountCents = String(person.approvedAmountCents ?? "0");
      const projectAllocations: Array<Record<string, unknown>> = Array.isArray(person.projectAllocations)
        ? person.projectAllocations.map((allocation) => ({
            ...(allocation as Record<string, unknown>),
            serviceMonth: (allocation as Record<string, unknown>).serviceMonth ?? source.wageMonth,
            serviceEvidenceSha256: (allocation as Record<string, unknown>).serviceEvidenceSha256 ?? source.evidenceSha256
          }))
        : [];
      const costComponents = Array.isArray(person.costComponents)
        ? person.costComponents.map((component) => ({ ...(component as Record<string, unknown>) }))
        : [{ componentCode: "gross_wage", amountCents: approvedAmountCents }];
      const suppliedCreditors = Array.isArray(person.creditorBreakdowns)
        ? person.creditorBreakdowns as Array<Record<string, unknown>>
        : [];
      const creditorsAreComplete = suppliedCreditors.length > 0 && suppliedCreditors.every((creditor) =>
        creditor.creditorSubjectType && creditor.creditorCategory && creditor.amountCents !== undefined
      );
      const creditorBreakdowns = creditorsAreComplete
        ? suppliedCreditors.map((creditor) => ({ ...creditor }))
        : [{
            creditorSubjectType: "employee_user",
            creditorUserId: employeeId,
            creditorCategory: "employee_net_pay",
            amountCents: approvedAmountCents
          }, ...[...new Set(suppliedCreditors.flatMap((creditor) =>
            typeof creditor.creditorBusinessPartyVersionId === "string"
              ? [creditor.creditorBusinessPartyVersionId]
              : []
          ))].map((creditorBusinessPartyVersionId) => ({
            creditorSubjectType: "business_party",
            creditorBusinessPartyVersionId,
            creditorCategory: "withheld_individual_income_tax",
            amountCents: "0"
          }))];
      const distribute = <T extends Record<string, unknown>>(
        dimensions: T[],
        identity: (dimension: T) => Record<string, unknown>
      ) => {
        const remaining = dimensions.map((dimension) => BigInt(String(dimension.amountCents ?? "0")));
        return projectAllocations.flatMap((allocation) => {
          let projectRemaining = BigInt(String(allocation.amountCents ?? "0"));
          return dimensions.map((dimension, index) => {
            const amount = projectRemaining < remaining[index]! ? projectRemaining : remaining[index]!;
            projectRemaining -= amount;
            remaining[index] = remaining[index]! - amount;
            return {
              projectId: allocation.projectId,
              serviceSnapshotId: allocation.serviceSnapshotId,
              ...identity(dimension),
              amountCents: amount.toString()
            };
          });
        });
      };
      const projectCostComponentAllocations = Array.isArray(person.projectCostComponentAllocations)
        ? person.projectCostComponentAllocations.map((allocation) => ({
            ...(allocation as Record<string, unknown>)
          }))
        : distribute(costComponents, (component) => ({ componentCode: component.componentCode }));
      const projectCreditorAllocations = Array.isArray(person.projectCreditorAllocations)
        ? person.projectCreditorAllocations.map((allocation) => ({
            ...(allocation as Record<string, unknown>)
          }))
        : distribute(creditorBreakdowns, (creditor) => ({
            creditorSubjectType: creditor.creditorSubjectType,
            ...(creditor.creditorUserId ? { creditorUserId: creditor.creditorUserId } : {}),
            ...(creditor.creditorBusinessPartyVersionId
              ? { creditorBusinessPartyVersionId: creditor.creditorBusinessPartyVersionId }
              : {}),
            creditorCategory: creditor.creditorCategory
          }));
      return {
        ...person,
        employmentPeriodStart: person.employmentPeriodStart ?? periodStart.toISOString().slice(0, 10),
        employmentPeriodEnd: person.employmentPeriodEnd ?? periodEnd.toISOString().slice(0, 10),
        positionCategory: person.positionCategory ?? "工程技术人员",
        costComponents,
        creditorBreakdowns,
        projectAllocations,
        projectCostComponentAllocations,
        projectCreditorAllocations
      };
    });
    const sourceSnapshot = {
      ...source.sourceSnapshot,
      employmentCompany: { id: employmentCompanyId, name: "工资承担公司" },
      wageMonth: source.wageMonth,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      externalReference,
      sourceVersion,
      basisDate: periodEnd.toISOString().slice(0, 10),
      evidence: { fileId: source.evidenceFileId, sha256: source.evidenceSha256 },
      approvedPersonLines
    };
    return {
      ...source,
      employmentCompanyId,
      periodStart,
      periodEnd,
      sourceType: "external_approved_wage",
      externalReference,
      sourceVersion,
      basisDate: periodEnd,
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
  }

  function canonicalPriorPersonLines(
    allocations: Array<{ projectId: string; serviceSnapshotId: string; amountCents: bigint }> = [
      { projectId: "project-1", serviceSnapshotId: "service-1", amountCents: 1000n }
    ]
  ) {
    const total = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0n);
    return [{
      id: "prior-person-structural-1",
      employeeId: "employee-1",
      employmentSnapshotId: "employment-snapshot-1",
      costComponents: [{
        id: "prior-cost-structural-1",
        componentCode: "gross_wage",
        amountCents: total,
        projectAllocations: allocations.map((allocation, index) => ({
          id: `prior-cost-cell-structural-${index + 1}`,
          projectAllocationId: `prior-project-allocation-structural-${index + 1}`,
          amountCents: allocation.amountCents
        }))
      }],
      creditorBreakdowns: [{
        id: "prior-creditor-structural-1",
        creditorSubjectType: "employee_user",
        creditorSubjectIdentityKey: "employee_user:employee-1",
        creditorCategory: "employee_net_pay",
        amountCents: total,
        projectAllocations: allocations.map((allocation, index) => ({
          id: `prior-creditor-cell-structural-${index + 1}`,
          projectAllocationId: `prior-project-allocation-structural-${index + 1}`,
          amountCents: allocation.amountCents
        }))
      }],
      projectAllocations: allocations.map((allocation, index) => ({
        id: `prior-project-allocation-structural-${index + 1}`,
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        amountCents: allocation.amountCents,
        componentAllocations: [{
          id: `prior-cost-cell-structural-${index + 1}`,
          costComponentId: "prior-cost-structural-1",
          amountCents: allocation.amountCents,
          costComponent: { id: "prior-cost-structural-1", componentCode: "gross_wage" }
        }],
        creditorAllocations: [{
          id: `prior-creditor-cell-structural-${index + 1}`,
          creditorBreakdownId: "prior-creditor-structural-1",
          amountCents: allocation.amountCents,
          creditorBreakdown: {
            id: "prior-creditor-structural-1",
            creditorSubjectType: "employee_user",
            creditorSubjectIdentityKey: "employee_user:employee-1",
            creditorCategory: "employee_net_pay"
          }
        }]
      }))
    }];
  }

  it("binds the immutable legacy adjustment root into the source fingerprint", () => {
    const correction = {
      ...legacyFact,
      id: "fact-correction-1",
      sourceBusinessId: "legacy-wage-correction-1",
      sourceVersion: 2,
      entryKind: "correction",
      adjustsFactId: "fact-root-1",
      impacts: [
        { id: "impact-cost-correction-1", impactKind: "confirmed_cost", amountCents: 1000n, direction: "decrease", sourceImpactKey: "cost" },
        { id: "impact-payable-correction-1", impactKind: "payable_decrease", amountCents: 1000n, direction: "decrease", sourceImpactKey: "payable" }
      ]
    };

    expect(historicalWageLegacyFingerprint(correction as never)).not.toBe(
      historicalWageLegacyFingerprint({ ...correction, adjustsFactId: "fact-root-2" } as never)
    );
    expect(historicalWageLegacyFingerprint(correction as never)).not.toBe(
      historicalWageLegacyFingerprint({ ...correction, occurredAt: new Date("2026-09-01T00:00:00.000Z") } as never)
    );
    expect(historicalWageLegacyFingerprint(correction as never)).not.toBe(
      historicalWageLegacyFingerprint({ ...correction, costBearingCompanySubjectId: "company-2" } as never)
    );
  });

  type OperatingFactFixture = Parameters<typeof historicalWageLegacyFingerprint>[0] & {
    id: string;
    factKind: string;
  };
  type OperatingFactDiscoveryQuery = {
    where: { sourceType?: string; factKind: string; status: string };
    include: { impacts: true };
    orderBy: Array<Record<string, "asc">>;
  };
  type OperatingFactRevalidationQuery = {
    where:
      | { sourceType_sourceBusinessId: { sourceType: string; sourceBusinessId: string } }
      | { id: string };
    include: { impacts: true };
  };

  function operatingFactResult(fact: OperatingFactFixture) {
    return { ...fact, impacts: fact.impacts.map((impact) => ({ ...impact })) };
  }

  function installOperatingFactQueryContract(
    delegate: {
      findMany: ReturnType<typeof jest.fn>;
      findUnique: ReturnType<typeof jest.fn>;
    },
    facts: readonly OperatingFactFixture[]
  ) {
    let nextFindManyIsCRevalidation = false;
    delegate.findMany.mockImplementation((query: OperatingFactDiscoveryQuery) => {
      const entry = nextFindManyIsCRevalidation ? "c_revalidation" : "options_discovery";
      nextFindManyIsCRevalidation = false;
      const expectedQuery: OperatingFactDiscoveryQuery = {
        where: entry === "options_discovery"
          ? { factKind: "project_wage", status: "confirmed" }
          : { sourceType: "project_wage", factKind: "project_wage", status: "confirmed" },
        include: { impacts: true },
        orderBy: [{ projectId: "asc" }, { sourceType: "asc" }, { sourceBusinessId: "asc" }]
      };
      expect(query).toEqual(expectedQuery);
      return Promise.resolve(facts
        .filter((fact) =>
          fact.factKind === "project_wage" &&
          fact.status === "confirmed" &&
          (entry === "options_discovery" || fact.sourceType === "project_wage")
        )
        .sort((left, right) =>
          left.projectId.localeCompare(right.projectId) ||
          left.sourceType.localeCompare(right.sourceType) ||
          left.sourceBusinessId.localeCompare(right.sourceBusinessId)
        )
        .map(operatingFactResult));
    });
    delegate.findUnique.mockImplementation((query: OperatingFactRevalidationQuery) => {
      expect(query.include).toEqual({ impacts: true });
      nextFindManyIsCRevalidation = true;
      if ("sourceType_sourceBusinessId" in query.where) {
        expect(Object.keys(query.where)).toEqual(["sourceType_sourceBusinessId"]);
        expect(Object.keys(query.where.sourceType_sourceBusinessId).sort()).toEqual([
          "sourceBusinessId",
          "sourceType"
        ]);
        const coordinate = query.where.sourceType_sourceBusinessId;
        const fact = facts.find((candidate) =>
          candidate.sourceType === coordinate.sourceType &&
          candidate.sourceBusinessId === coordinate.sourceBusinessId
        );
        return Promise.resolve(fact ? operatingFactResult(fact) : null);
      }
      if ("id" in query.where) {
        expect(Object.keys(query.where)).toEqual(["id"]);
        const factId = query.where.id;
        const fact = facts.find((candidate) => candidate.id === factId);
        return Promise.resolve(fact ? operatingFactResult(fact) : null);
      }
      return Promise.resolve(null);
    });
  }

  function rewriteOperatingFactFindManyBoundary(
    delegate: { findMany: ReturnType<typeof jest.fn> },
    rewriteQuery: (query: OperatingFactDiscoveryQuery) => OperatingFactDiscoveryQuery,
    rewriteResult?: (rows: OperatingFactFixture[]) => OperatingFactFixture[]
  ) {
    const implementation = delegate.findMany.getMockImplementation() as
      | ((query: OperatingFactDiscoveryQuery) => Promise<OperatingFactFixture[]>)
      | undefined;
    if (!implementation) throw new Error("operatingFact.findMany contract is not installed");
    delegate.findMany.mockImplementation(async (query: OperatingFactDiscoveryQuery) => {
      const rows = await implementation(rewriteQuery(query));
      return rewriteResult ? rewriteResult(rows) : rows;
    });
  }

  function setup() {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      operatingFact: { findUnique: jest.fn().mockResolvedValue(legacyFact), findMany: jest.fn().mockResolvedValue([legacyFact]) },
      operatingTakeoverCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      operatingTakeoverCommandReceiptLine: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "receipt-line-1" })
      },
      operatingTakeoverAtomicScopeVersion: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      wageTakeoverWageStatementReservation: {
        create: jest.fn().mockResolvedValue({ id: "reserved-wage-version-1" }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      operatingTakeoverManifestVersion: {
        create: jest.fn().mockResolvedValue({ id: "manifest-1" }),
        findMany: jest.fn().mockResolvedValue([])
      },
      operatingTakeoverAtomicScopeProject: { create: jest.fn().mockResolvedValue({ id: "scope-project-1" }) },
      operatingTakeoverRowMapping: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "mapping-1" })
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
      companyEntity: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
      wageServiceBasisBinding: { findMany: jest.fn().mockResolvedValue([]) },
      businessPartyVersion: { findMany: jest.fn().mockResolvedValue([]) },
      projectAffiliateCompanyContract: { findMany: jest.fn().mockResolvedValue([]) },
      affiliateClearingAuthorityVersion: { findMany: jest.fn().mockResolvedValue([]) },
      assignedWageAuthorityLine: { findMany: jest.fn().mockResolvedValue([]) },
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      wageStatement: { findUnique: jest.fn().mockResolvedValue(null) },
      wageStatementVersion: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      wagePayableRef: { findMany: jest.fn().mockResolvedValue([]) },
      wageTakeoverProjectionEnvelope: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      wageTakeoverProjectionEnvelopeCostCell: { create: jest.fn() },
      wageTakeoverProjectionEnvelopePayableRef: { create: jest.fn() },
      wageTakeoverLegacyImpactBridge: { create: jest.fn() },
      paymentExecutionWagePayableBinding: { findMany: jest.fn().mockResolvedValue([]) },
      historicalWageSummaryPayableRef: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: `summary-ref-${data.wageCreditorCategoryCode}` }))
      },
      historicalWageBalanceReconciliationVersion: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: `balance-${data.wageCreditorCategoryCode}` }))
      },
      historicalWageSummaryPaymentExecutionLink: { create: jest.fn() },
      unresolvedWagePayableGap: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      operatingTakeoverLegacySourceBridge: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      wageTakeoverProjectionEnvelopeEligibilityRevocation: { create: jest.fn() },
      historicalWageSummaryPayableRefEligibilityRevocation: { create: jest.fn() },
      fileObject: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      historicalWageSummaryAuthorityVersion: {
        create: jest.fn().mockResolvedValue({ id: "summary-authority-1" }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      historicalWageSummaryAuthorityCreditorLine: { create: jest.fn().mockResolvedValue({ id: "summary-creditor-line-1" }) },
      historicalWageSummaryAuthorityAttestation: { create: jest.fn().mockResolvedValue({ id: "summary-attestation-1" }) }
    };
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const prisma = {
      $transaction: jest.fn((work) => work(tx))
    };
    const rootRoles = { resolveActiveRoleScopes: jest.fn(() => { throw new Error("root authorization read is forbidden"); }) };
    const roles = {
      ...rootRoles,
      resolveActiveRoleScopesInTransaction: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const selectionRefs = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const wageStatements = {
      planHistoricalTakeoverInTransaction: jest.fn().mockResolvedValue({
        targetWageStatementId: "statement-reserved-1",
        expectedCurrentRevision: 0,
        reservedRevision: 1,
        versionKind: "base",
        priorConfirmedVersionId: null,
        priorSourceVersionId: null,
        sourceDeltaFingerprint: "d".repeat(64),
        canonicalRootClosureFingerprint: "e".repeat(64),
        canonicalRootPayableRefIds: [],
        projects: [{ projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" }]
      }),
      confirmHistoricalTakeoverInTransaction: jest.fn()
    };
    const service = new HistoricalWageTakeoverService(
      prisma as never,
      roles as never,
      selectionRefs,
      wageStatements as never
    );
    return { service, selectionRefs, tx, prisma, roles, wageStatements };
  }

  async function captureActiveBPrior(
    sourceSummary: ReturnType<typeof r2HistoricalSummary>,
    sourceFact: Omit<typeof legacyFact, "sourceSnapshot"> & { sourceSnapshot: Record<string, unknown> } = legacyFact,
    options: { compensate?: boolean } = {}
  ) {
    const fixture = setup();
    const fact = {
      ...sourceFact,
      sourceSnapshot: { historicalWageSummaryAuthority: sourceSummary }
    };
    fixture.tx.operatingFact.findMany.mockResolvedValue([fact]);
    fixture.tx.operatingFact.findUnique.mockResolvedValue(fact);
    fixture.tx.fileObject.findMany.mockImplementation(({ where }) => {
      const files = [
        { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
        { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) },
        { id: "file-balance-social", storageStatus: "active", contentSha256: "5".repeat(64) }
      ];
      return Promise.resolve(files.filter((file) => where?.id?.in?.includes(file.id)));
    });
    fixture.tx.operatingTakeoverCommandReceipt.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: data.id })
    );
    fixture.tx.operatingTakeoverManifestVersion.create.mockImplementation(({ data }) =>
      Promise.resolve(data)
    );
    fixture.tx.operatingTakeoverRowMapping.create.mockImplementation(({ data }) =>
      Promise.resolve(data)
    );
    const issued = await fixture.service.options(
      "finance-1",
      fact.projectId,
      new Date("2026-09-03T00:00:00.000Z")
    );
    const selectionRef = issued.options.find((option) => option.grade === "B")?.selectionRef;
    if (!selectionRef) throw new Error("expected complete B authority to issue an option");
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    let created: Awaited<ReturnType<typeof fixture.service.createScope>>;
    try {
      created = await fixture.service.createScope("finance-1", {
        selectionRef,
        idempotencyKey: "91919191-9191-4191-8191-919191919191",
        expectedRevision: 0,
        businessReason: "构造已完整激活的B级直接前序"
      }, new Date("2026-09-03T00:01:00.000Z"));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    if (
      typeof created !== "object" ||
      created === null ||
      !("commandSelectionRef" in created) ||
      typeof created.commandSelectionRef !== "string"
    ) {
      throw new Error("expected B createScope to return a scoped selectionRef");
    }
    const commandSelectionRef = created.commandSelectionRef;

    const scopeData = fixture.tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]![0].data;
    const manifestData = fixture.tx.operatingTakeoverManifestVersion.create.mock.calls[0]![0].data;
    const scopeProjectData = fixture.tx.operatingTakeoverAtomicScopeProject.create.mock.calls[0]![0].data;
    const mappingData = fixture.tx.operatingTakeoverRowMapping.create.mock.calls[0]![0].data;
    const authorityData = fixture.tx.historicalWageSummaryAuthorityVersion.create.mock.calls[0]![0].data;
    const creditorLines = fixture.tx.historicalWageSummaryAuthorityCreditorLine.create.mock.calls
      .map((call) => ({
        ...call[0].data,
        createdTransactionId: 21n,
        createdAt: new Date("2026-09-03T00:01:00.000Z")
      }));
    const manifest = {
      ...manifestData,
      status: "prepared",
      createdAt: new Date("2026-09-03T00:01:00.000Z")
    };
    const mapping = {
      ...mappingData,
      manifestVersionId: manifest.id,
      manifest,
      createdAt: new Date("2026-09-03T00:01:00.000Z")
    };
    const stageByAction = new Map([
      ["historical_wage_takeover.scope.create", { transactionId: 31n, createdAt: new Date("2026-09-03T00:01:00.000Z") }],
      ["historical_wage_takeover.scope.apply", { transactionId: 32n, createdAt: new Date("2026-09-03T00:02:00.000Z") }],
      ["historical_wage_takeover.scope.attest", { transactionId: 33n, createdAt: new Date("2026-09-03T00:04:00.000Z") }],
      ["historical_wage_takeover.scope.activate", { transactionId: 34n, createdAt: new Date("2026-09-03T00:06:00.000Z") }],
      ["historical_wage_takeover.scope.compensate", { transactionId: 35n, createdAt: new Date("2026-09-03T00:08:00.000Z") }]
    ]);
    const persistedReceiptLines = () => fixture.tx.operatingTakeoverCommandReceiptLine.create.mock.calls
      .map((call) => {
        const data = call[0].data;
        const receiptData = fixture.tx.operatingTakeoverCommandReceipt.create.mock.calls
          .map((receiptCall) => receiptCall[0].data)
          .find((candidate) => candidate.id === data.receiptId);
        const stage = stageByAction.get(receiptData?.action) ?? stageByAction.get("historical_wage_takeover.scope.create")!;
        return {
          targetKind: null,
          targetRef: null,
          reversesLineId: null,
          causesLineId: null,
          ...data,
          createdAt: stage.createdAt
        };
      });
    const persistedReceipts = () => fixture.tx.operatingTakeoverCommandReceipt.create.mock.calls
      .map((call) => {
        const data = call[0].data;
        const stage = stageByAction.get(data.action) ?? stageByAction.get("historical_wage_takeover.scope.create")!;
        return {
          manifestVersionId: null,
          delegatorUserId: null,
          causesReceiptId: null,
          ...data,
          createdTransactionId: stage.transactionId,
          createdAt: stage.createdAt,
          lines: persistedReceiptLines().filter((line) => line.receiptId === data.id)
        };
      });
    const persistedAttestations = () => fixture.tx.historicalWageSummaryAuthorityAttestation.create.mock.calls
      .map((call, index) => {
        const data = call[0].data;
        const receipt = persistedReceipts().find((candidate) => candidate.id === data.receiptId);
        return {
          delegatorUserId: null,
          ...data,
          attestationOrdinal: index + 1,
          createdTransactionId: receipt?.createdTransactionId ?? 31n,
          createdAt: receipt?.createdAt ?? new Date("2026-09-03T00:01:00.000Z")
        };
      });
    fixture.tx.historicalWageBalanceReconciliationVersion.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, createdTransactionId: 34n, createdAt: new Date("2026-09-03T00:06:00.000Z") })
    );
    fixture.tx.historicalWageSummaryPayableRef.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, createdTransactionId: 34n, createdAt: new Date("2026-09-03T00:06:00.000Z") })
    );
    const persistedPayableRefs = () => fixture.tx.historicalWageSummaryPayableRef.create.mock.calls
      .map((call) => ({
        creditorPartyVersionId: null,
        controlledScopeCode: null,
        controlledScopeDescription: null,
        controlledScopeEvidenceCoordinate: null,
        historicalWageBalanceReconciliationVersionId: null,
        currencyCode: "CNY",
        ...call[0].data,
        createdTransactionId: 34n,
        createdAt: new Date("2026-09-03T00:06:00.000Z"),
        eligibilityRevocations: fixture.tx.historicalWageSummaryPayableRefEligibilityRevocation.create.mock.calls
          .filter((revocationCall) => revocationCall[0].data.summaryPayableRefId === call[0].data.id)
          .map((revocationCall) => ({
            ...revocationCall[0].data,
            createdTransactionId: 35n,
            createdAt: new Date("2026-09-03T00:08:00.000Z")
          }))
      }));
    const scopeForLifecycle = () => {
      const receiptRows = persistedReceipts();
      const mappingRow = {
        ...mapping,
        receiptLines: persistedReceiptLines().filter((line) => line.rowMappingId === mapping.id)
      };
      const manifestRow = {
        ...manifest,
        rows: [mappingRow],
        receipts: receiptRows.filter((receipt) => receipt.manifestVersionId === manifest.id)
      };
      const authorityRow = {
        ...authorityData,
        createdTransactionId: 31n,
        createdAt: new Date("2026-09-03T00:01:00.000Z"),
        creditorLines,
        attestations: persistedAttestations(),
        payableRefs: persistedPayableRefs()
      };
      return {
        reservedWageStatementVersionId: null,
        ...scopeData,
        createdTransactionId: 31n,
        createdAt: new Date("2026-09-03T00:01:00.000Z"),
        projects: [{
          ...scopeProjectData,
          atomicScopeVersionId: scopeData.id,
          manifestVersionId: manifest.id,
          manifest: manifestRow,
          createdTransactionId: 31n,
          createdAt: new Date("2026-09-03T00:01:00.000Z")
        }],
        manifests: [manifestRow],
        historicalSummaryAuthorities: [authorityRow],
        wageStatementReservation: null,
        receipts: receiptRows
      };
    };
    fixture.tx.operatingTakeoverAtomicScopeVersion.findUnique.mockImplementation(() =>
      Promise.resolve(scopeForLifecycle())
    );
    fixture.roles.resolveActiveRoleScopesInTransaction.mockImplementation((_tx, actorUserId) =>
      Promise.resolve(actorUserId === "finance-1" ? ["finance_staff"] : ["finance_director"])
    );
    const preparedScope = scopeForLifecycle();
    let appliedScope = preparedScope;
    let attestedScope = preparedScope;
    const lifecycleSavedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await fixture.service.apply("finance-1", {
        selectionRef: commandSelectionRef,
        idempotencyKey: "91919191-9191-4191-8191-919191919192",
        expectedRevision: 1,
        businessReason: "真实执行B级 inactive apply"
      }, new Date("2026-09-03T00:02:00.000Z"));
      appliedScope = scopeForLifecycle();
      const reviewerSelection = await fixture.service.issueScopedCommandSelection("finance-director-2", {
        selectionRef: commandSelectionRef
      }, new Date("2026-09-03T00:03:00.000Z"));
      await fixture.service.attest("finance-director-2", {
        selectionRef: reviewerSelection.commandSelectionRef,
        idempotencyKey: "91919191-9191-4191-8191-919191919193",
        expectedRevision: 2,
        businessReason: "真实执行B级独立复核"
      }, new Date("2026-09-03T00:04:00.000Z"));
      attestedScope = scopeForLifecycle();
      const activatorSelection = await fixture.service.issueScopedCommandSelection("finance-director-3", {
        selectionRef: commandSelectionRef
      }, new Date("2026-09-03T00:05:00.000Z"));
      await fixture.service.activate("finance-director-3", {
        selectionRef: activatorSelection.commandSelectionRef,
        idempotencyKey: "91919191-9191-4191-8191-919191919194",
        expectedRevision: 3,
        businessReason: "真实执行B级原子激活"
      }, new Date("2026-09-03T00:06:00.000Z"));
      if (options.compensate) {
        fixture.tx.historicalWageSummaryPayableRef.findMany.mockImplementation(({ where }) =>
          Promise.resolve(where?.atomicScopeVersionId === scopeData.id ? persistedPayableRefs() : [])
        );
        const compensatorSelection = await fixture.service.issueScopedCommandSelection("finance-director-4", {
          selectionRef: commandSelectionRef
        }, new Date("2026-09-03T00:07:00.000Z"));
        await fixture.service.compensate("finance-director-4", {
          selectionRef: compensatorSelection.commandSelectionRef,
          idempotencyKey: "91919191-9191-4191-8191-919191919195",
          expectedRevision: 4,
          businessReason: "真实执行B级接管资格补偿"
        }, new Date("2026-09-03T00:08:00.000Z"));
      }
    } finally {
      if (lifecycleSavedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = lifecycleSavedSha;
    }
    const attestations = persistedAttestations();
    const activationReceipt = persistedReceipts().find((receipt) =>
      receipt.action === "historical_wage_takeover.scope.activate"
    )!;
    const activationLineId = activationReceipt.lines[0]!.id;
    const scope = scopeForLifecycle();
    const payableRefs = persistedPayableRefs();
    const mappingWithReverseLines = {
      ...mapping,
      receiptLines: persistedReceiptLines().filter((line) => line.rowMappingId === mapping.id)
    };
    const authority = {
      ...scope.historicalSummaryAuthorities[0]!,
      attestations,
      payableRefs,
      takeoverMappings: [mappingWithReverseLines],
      atomicScope: scope
    };
    return {
      ...fixture,
      created,
      commandSelectionRef,
      authority,
      payableRefs,
      scope,
      preparedScope,
      appliedScope,
      attestedScope,
      mapping: mappingWithReverseLines,
      activationReceipt,
      activationLineId
    };
  }

  function bCorrectionScenario() {
    const priorSummary = r2HistoricalSummary();
    const currentSummary = r2HistoricalSummary();
    currentSummary.originalSourceVersion = "V2";
    currentSummary.lines[0]!.grossDebtCents = "600";
    currentSummary.lines[0]!.outstandingBalanceCents = "600";
    currentSummary.lines[0]!.target.grossDebtCents = "600";
    currentSummary.lines[0]!.target.outstandingBalanceCents = "600";
    const rootFact = {
      ...legacyFact,
      id: "fact-b-lineage-root",
      sourceBusinessId: "legacy-wage-lineage-root",
      sourceSnapshot: { historicalWageSummaryAuthority: priorSummary }
    };
    const correctionFact = {
      ...legacyFact,
      id: "fact-b-lineage-correction",
      sourceBusinessId: "legacy-wage-lineage-correction",
      sourceVersion: 2,
      amountCents: 400n,
      entryKind: "correction",
      adjustsFactId: rootFact.id,
      sourceSnapshot: { historicalWageSummaryAuthority: currentSummary },
      impacts: [
        { id: "impact-cost-b-lineage-correction", impactKind: "confirmed_cost", amountCents: 400n, direction: "decrease", sourceImpactKey: "cost" },
        { id: "impact-payable-b-lineage-correction", impactKind: "payable_decrease", amountCents: 400n, direction: "decrease", sourceImpactKey: "payable" }
      ]
    };
    return { priorSummary, currentSummary, rootFact, correctionFact };
  }

  it("binds public options discovery and C revalidation to distinct operatingFact query contracts", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForApply(setup());
      expect(fixture.tx.operatingFact.findMany).toHaveBeenCalledTimes(2);
      expect(fixture.tx.operatingFact.findMany).toHaveBeenNthCalledWith(1, {
        where: { factKind: "project_wage", status: "confirmed" },
        include: { impacts: true },
        orderBy: [{ projectId: "asc" }, { sourceType: "asc" }, { sourceBusinessId: "asc" }]
      });
      expect(fixture.tx.operatingFact.findMany).toHaveBeenNthCalledWith(2, {
        where: { sourceType: "project_wage", factKind: "project_wage", status: "confirmed" },
        include: { impacts: true },
        orderBy: [{ projectId: "asc" }, { sourceType: "asc" }, { sourceBusinessId: "asc" }]
      });
      expect(fixture.tx.operatingFact.findUnique).toHaveBeenCalledWith({
        where: {
          sourceType_sourceBusinessId: {
            sourceType: "project_wage",
            sourceBusinessId: "legacy-wage-1"
          }
        },
        include: { impacts: true }
      });
      expect(fixture.scope.projects[0]!.manifest.rows[0]!.legacySourceSnapshot).toEqual(
        expect.objectContaining({
          costImpactId: "impact-cost-1",
          payableImpactId: "impact-payable-1"
        })
      );
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each([
    ["C-only sourceType key", (query: OperatingFactDiscoveryQuery) => ({
      ...query,
      where: { ...query.where, sourceType: "project_wage" }
    })],
    ["wrong factKind key", (query: OperatingFactDiscoveryQuery) => ({
      ...query,
      where: { ...query.where, factKind: "project_salary" }
    })],
    ["wrong include", (query: OperatingFactDiscoveryQuery) => ({
      ...query,
      include: { impacts: false }
    }) as unknown as OperatingFactDiscoveryQuery],
    ["wrong orderBy", (query: OperatingFactDiscoveryQuery) => ({
      ...query,
      orderBy: [{ sourceType: "asc" }, { projectId: "asc" }, { sourceBusinessId: "asc" }]
    }) as unknown as OperatingFactDiscoveryQuery],
    ["unexpected select projection", (query: OperatingFactDiscoveryQuery) => ({
      ...query,
      select: { id: true }
    }) as unknown as OperatingFactDiscoveryQuery]
  ] as const)("fails the public options query contract on %s", async (_label, rewriteQuery) => {
    const fixture = setup();
    rewriteOperatingFactFindManyBoundary(fixture.tx.operatingFact, rewriteQuery);

    await expect(fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    )).rejects.toThrow();
  });

  it("fails the public C revalidation query contract when sourceType is missing", async () => {
    const fixture = setup();
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    rewriteOperatingFactFindManyBoundary(fixture.tx.operatingFact, (query) => {
      const where = { ...query.where };
      Reflect.deleteProperty(where, "sourceType");
      return { ...query, where };
    });
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(fixture.service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898975",
        expectedRevision: 0,
        businessReason: "证明 C revalidation 不能退化成 discovery 查询"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toThrow();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("fails public options when the operatingFact projection omits impact rows", async () => {
    const fixture = setup();
    rewriteOperatingFactFindManyBoundary(
      fixture.tx.operatingFact,
      (query) => query,
      (rows) => rows.map((fact) => {
        const withoutImpacts = { ...fact };
        Reflect.deleteProperty(withoutImpacts, "impacts");
        return withoutImpacts as OperatingFactFixture;
      })
    );

    await expect(fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    )).rejects.toThrow();
  });

  function expectNoTakeoverWrites(
    tx: ReturnType<typeof setup>["tx"],
    wageStatements?: ReturnType<typeof setup>["wageStatements"]
  ) {
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const [delegateName, delegate] of Object.entries(tx)) {
      if (delegateName === "$executeRaw" || !delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) {
          expect(method).not.toHaveBeenCalled();
        }
      }
    }
    if (wageStatements) {
      expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    }
  }

  async function expectConflict409(work: Promise<unknown>, message: string) {
    const failure = await work.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getStatus()).toBe(409);
    expect((failure as Error).message).toContain(message);
  }

  async function expectCMatrixConflict409(work: Promise<unknown>, message: string) {
    const failure = await work.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getStatus()).toBe(409);
    expect((failure as Error).message).toBe(message);
  }

  function expectOnlyTakeoverWrites(
    tx: ReturnType<typeof setup>["tx"],
    allowedWrites: Record<string, number>
  ) {
    const allowed = new Map(Object.entries(allowedWrites));
    const observedAllowed = new Set<string>();
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const [delegateName, delegate] of Object.entries(tx)) {
      if (delegateName === "$executeRaw" || !delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (!jest.isMockFunction(method)) continue;
        const mutationKey = `${delegateName}.${methodName}`;
        const expectedCount = allowed.get(mutationKey) ?? 0;
        expect(method).toHaveBeenCalledTimes(expectedCount);
        if (allowed.has(mutationKey)) observedAllowed.add(mutationKey);
      }
    }
    expect([...observedAllowed].sort()).toEqual([...allowed.keys()].sort());
  }

  function captureTakeoverWrites(
    tx: ReturnType<typeof setup>["tx"],
    wageStatements: ReturnType<typeof setup>["wageStatements"]
  ) {
    const snapshot = new Map<string, string[]>();
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const [delegateName, delegate] of Object.entries(tx)) {
      if (delegateName === "$executeRaw" || !delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) {
          snapshot.set(`${delegateName}.${methodName}`, method.mock.calls.map((call) => fingerprint(call)));
        }
      }
    }
    snapshot.set(
      "wageStatements.confirmHistoricalTakeoverInTransaction",
      wageStatements.confirmHistoricalTakeoverInTransaction.mock.calls.map((call) => fingerprint(call))
    );
    return snapshot;
  }

  function expectTakeoverWriteDelta(
    tx: ReturnType<typeof setup>["tx"],
    wageStatements: ReturnType<typeof setup>["wageStatements"],
    before: Map<string, string[]>,
    allowedAdditionalWrites: Record<string, number> = {}
  ) {
    const after = captureTakeoverWrites(tx, wageStatements);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [key, afterCalls] of after) {
      const beforeCalls = before.get(key)!;
      expect(afterCalls.slice(0, beforeCalls.length)).toEqual(beforeCalls);
      expect(afterCalls.length - beforeCalls.length).toBe(allowedAdditionalWrites[key] ?? 0);
    }
    expect(Object.keys(allowedAdditionalWrites).sort()).toEqual(
      Object.entries(allowedAdditionalWrites)
        .filter(([key, count]) => count > 0 && after.has(key))
        .map(([key]) => key)
        .sort()
    );
  }

  type PrismaOrderBy = Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
  type PrismaRelationQuery = {
    select?: PrismaSelection;
    include?: PrismaInclude;
    orderBy?: PrismaOrderBy;
  };
  type PrismaSelection = Record<string, true | PrismaRelationQuery>;
  type PrismaInclude = Record<string, true | PrismaRelationQuery>;
  type PrismaFindUniqueQuery = { where?: { id?: string }; select: PrismaSelection };
  type PrismaFindManyQuery = { where?: Record<string, unknown>; select: PrismaSelection; orderBy?: PrismaOrderBy };
  type PrismaScopeFindUniqueQuery = { where: { id: string }; include: PrismaInclude };

  const SCOPE_REVALIDATION_INCLUDE = {
    projects: {
      include: {
        manifest: { include: { rows: { orderBy: { rowNo: "asc" } } } }
      }
    },
    historicalSummaryAuthorities: {
      include: {
        attestations: { orderBy: { createdAt: "asc" } },
        payableRefs: { orderBy: { wageCreditorCategoryCode: "asc" } },
        creditorLines: { orderBy: { wageCreditorCategoryCode: "asc" } }
      }
    },
    wageStatementReservation: true,
    receipts: {
      include: { lines: { orderBy: { lineNo: "asc" } } },
      orderBy: { createdAt: "asc" }
    }
  } as const;

  const C_OCCUPANCY_BRIDGE_SELECT = {
    id: true,
    projectId: true,
    rowMappingId: true,
    sourceType: true,
    sourceBusinessId: true,
    sourceVersion: true,
    sourceFingerprint: true,
    targetKind: true,
    targetRef: true,
    targetFingerprint: true,
    mappingDecision: true,
    createdByUserId: true,
    createdTransactionId: true,
    createdAt: true
  } as const;
  const C_OCCUPANCY_MAPPING_SELECT = {
    id: true,
    manifestVersionId: true,
    projectId: true,
    adapterKind: true,
    rowNo: true,
    sourceType: true,
    sourceBusinessId: true,
    sourceVersion: true,
    sourceFingerprint: true,
    sourceCoordinate: true,
    normalizedRowHash: true,
    amountCents: true,
    evidenceLevel: true,
    coverageKind: true,
    coverageKey: true,
    periodStart: true,
    entryKind: true,
    mappingDecision: true,
    conflictGroupKey: true,
    adjustmentTargetRef: true,
    sourceDiscriminator: true,
    governedSubjectKey: true,
    authorityCategory: true,
    authoritySnapshotRef: true,
    authorityFingerprint: true,
    authorityVersionId: true,
    authorityLineId: true,
    authorityLineFingerprint: true,
    obligationId: true,
    authoritativeGrossCapCents: true,
    currencyCode: true,
    wageApprovedSourceVersionId: true,
    wageStatementReservationId: true,
    historicalWageSummaryAuthorityVersionId: true,
    authoritySnapshot: true,
    legacySourceSnapshot: true,
    readSetSnapshot: true,
    mappingFingerprint: true,
    createdAt: true
  } as const;
  const C_OCCUPANCY_MANIFEST_SELECT = {
    id: true,
    projectId: true,
    atomicScopeVersionId: true,
    adapterKind: true,
    manifestNo: true,
    version: true,
    status: true,
    sourceScopeFingerprint: true,
    mapperName: true,
    mapperVersion: true,
    schemaVersion: true,
    candidateBaselineSha: true,
    permissionSnapshotFingerprint: true,
    readSetFingerprint: true,
    manifestFingerprint: true,
    createdByUserId: true,
    createdAt: true
  } as const;
  const C_OCCUPANCY_RECEIPT_LINE_SELECT = {
    id: true,
    receiptId: true,
    rowMappingId: true,
    projectId: true,
    lineNo: true,
    decision: true,
    entryKind: true,
    amountCents: true,
    targetKind: true,
    targetRef: true,
    causalOrdinal: true,
    reversesLineId: true,
    causesLineId: true,
    causalityFingerprint: true,
    lineSnapshot: true,
    createdAt: true
  } as const;
  const C_OCCUPANCY_RECEIPT_SELECT = {
    id: true,
    manifestVersionId: true,
    atomicScopeVersionId: true,
    idempotencyKey: true,
    action: true,
    expectedRevision: true,
    actorUserId: true,
    delegatorUserId: true,
    actorSetSnapshot: true,
    permissionSnapshotFingerprint: true,
    fingerprint: true,
    status: true,
    commandSnapshotSchemaVersion: true,
    commandSnapshot: true,
    resultSnapshot: true,
    causalityFingerprint: true,
    createdTransactionId: true,
    causesReceiptId: true,
    createdAt: true,
    lines: {
      select: C_OCCUPANCY_RECEIPT_LINE_SELECT,
      orderBy: { id: "asc" }
    }
  } as const;
  const C_OCCUPANCY_SCOPE_SELECT = {
    id: true,
    scopeKind: true,
    authoritySourceRef: true,
    authoritySourceFingerprint: true,
    sourceClosureFingerprint: true,
    reservedWageStatementVersionId: true,
    candidateBaselineSha: true,
    permissionSnapshotFingerprint: true,
    readSetFingerprint: true,
    createdByUserId: true,
    createdTransactionId: true,
    createdAt: true,
    projects: {
      select: {
        id: true,
        atomicScopeVersionId: true,
        projectId: true,
        manifestVersionId: true,
        createdTransactionId: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    },
    manifests: {
      select: {
        ...C_OCCUPANCY_MANIFEST_SELECT,
        rows: {
          select: C_OCCUPANCY_MAPPING_SELECT,
          orderBy: [{ rowNo: "asc" }, { id: "asc" }]
        }
      },
      orderBy: { id: "asc" }
    },
    wageStatementReservation: {
      select: {
        id: true,
        atomicScopeVersionId: true,
        targetWageStatementId: true,
        expectedCurrentRevision: true,
        reservedRevision: true,
        versionKind: true,
        priorConfirmedVersionId: true,
        priorSourceVersionId: true,
        sourceDeltaFingerprint: true,
        canonicalRootClosureFingerprint: true,
        createdAt: true,
        mappings: {
          select: C_OCCUPANCY_MAPPING_SELECT,
          orderBy: [{ rowNo: "asc" }, { id: "asc" }]
        }
      }
    }
  } as const;
  const C_OCCUPANCY_GAP_SELECT = {
    id: true,
    atomicScopeVersionId: true,
    manifestVersionId: true,
    rowMappingId: true,
    projectId: true,
    wageMonth: true,
    reasonCode: true,
    sourceFingerprint: true,
    gapSnapshot: true,
    createdTransactionId: true,
    createdAt: true
  } as const;

  function comparePrismaOrderValue(left: unknown, right: unknown) {
    if (typeof left === "number" && typeof right === "number") return left - right;
    if (typeof left === "bigint" && typeof right === "bigint") return left < right ? -1 : 1;
    if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
    return String(left).localeCompare(String(right));
  }

  function prismaOrderRows<T>(
    rows: T[],
    orderBy: PrismaOrderBy | undefined
  ) {
    const clauses = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
    return [...rows].sort((left, right) => {
      const leftRecord = left as Record<string, unknown>;
      const rightRecord = right as Record<string, unknown>;
      for (const clause of clauses) {
        const [key, direction] = Object.entries(clause)[0] ?? [];
        if (!key || leftRecord[key] === rightRecord[key]) continue;
        const comparison = comparePrismaOrderValue(leftRecord[key], rightRecord[key]);
        return direction === "desc" ? -comparison : comparison;
      }
      return 0;
    });
  }

  function prismaSelect(source: unknown, select: PrismaSelection): unknown {
    if (source === null || source === undefined) return source;
    const record = source as Record<string, unknown>;
    return Object.fromEntries(Object.entries(select).map(([key, field]) => {
      const value = record[key];
      if (field === true) return [key, value];
      if (Array.isArray(value)) {
        const ordered = prismaOrderRows(value, field.orderBy);
        const nestedSelect = field.select;
        return [key, nestedSelect ? ordered.map((item) => prismaSelect(item, nestedSelect)) : ordered];
      }
      return [key, field.select ? prismaSelect(value, field.select) : value];
    }));
  }

  const SCOPE_RELATIONS_BY_PATH: Record<string, readonly string[]> = {
    "": ["projects", "historicalSummaryAuthorities", "wageStatementReservation", "receipts"],
    projects: ["manifest"],
    "projects.manifest": ["rows"],
    historicalSummaryAuthorities: ["attestations", "payableRefs", "creditorLines"],
    receipts: ["lines"]
  };

  function prismaInclude(source: unknown, include: PrismaInclude, path = ""): unknown {
    if (source === null || source === undefined) return source;
    const record = source as Record<string, unknown>;
    const relations = new Set(SCOPE_RELATIONS_BY_PATH[path] ?? []);
    const result = Object.fromEntries(
      Object.entries(record).filter(([key]) => !relations.has(key))
    );
    for (const [key, field] of Object.entries(include)) {
      const value = record[key];
      if (field === true) {
        result[key] = value;
        continue;
      }
      const childPath = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        const ordered = prismaOrderRows(value, field.orderBy);
        result[key] = field.select
          ? ordered.map((item) => prismaSelect(item, field.select!))
          : field.include
            ? ordered.map((item) => prismaInclude(item, field.include!, childPath))
            : ordered;
      } else {
        result[key] = field.select
          ? prismaSelect(value, field.select)
          : field.include
            ? prismaInclude(value, field.include, childPath)
            : value;
      }
    }
    return result;
  }

  function mockAssignedWageConflict(
    tx: ReturnType<typeof setup>["tx"],
    input: {
      companyId: string;
      coverageKind: "PERSON" | "ROLE_SUMMARY";
      personAuthorityKey?: string | null;
      projectId?: string;
      wageMonth?: string;
      authorityStatus?: "draft" | "submitted" | "confirmed";
    }
  ) {
    const projectId = input.projectId ?? "project-1";
    const wageMonth = input.wageMonth ?? "2026-08";
    const contractId = `affiliate-contract-${input.companyId}`;
    const authorityId = `authority-${input.companyId}`;
    const lineId = `assigned-wage-${input.coverageKind.toLowerCase()}-${input.companyId}`;
    const mappingId = `mapping-${lineId}`;
    const manifestVersionId = `manifest-${lineId}`;
    let lifecycle: "prepared" | "attested" | "active" | "compensated" = "prepared";
    tx.projectAffiliateCompanyContract.findMany.mockImplementation(({ where }) => Promise.resolve(
      (!where.companyEntityId || where.companyEntityId === input.companyId) &&
      where.projectId.in.includes(projectId) &&
      where.status === "confirmed"
        ? [{
            id: contractId,
            projectId,
            companyEntityId: input.companyId,
            companyEntityVersionId: `company-version-${input.companyId}`,
            requestFingerprint: "1".repeat(64),
            fileContentSha256Snapshot: "2".repeat(64)
          }]
        : []
    ));
    tx.affiliateClearingAuthorityVersion.findMany.mockImplementation(({ where }) => Promise.resolve(
      (input.authorityStatus ?? "confirmed") === "confirmed" &&
      where.status === "confirmed" &&
      where.projectId.in.includes(projectId) &&
      where.affiliateCompanyContractId.in.includes(contractId)
        ? [{ id: authorityId, affiliateCompanyContractId: contractId, authorityFingerprint: "3".repeat(64) }]
        : []
    ));
    tx.assignedWageAuthorityLine.findMany.mockImplementation(({ where }) => Promise.resolve(
      where.projectId.in.includes(projectId) &&
      where.authorityVersionId.in.includes(authorityId) &&
      where.wageMonth.toISOString().slice(0, 7) === wageMonth
        ? [{
            id: lineId,
            authorityVersionId: authorityId,
            projectId,
            coverageKind: input.coverageKind,
            personAuthorityKey: input.coverageKind === "PERSON" ? input.personAuthorityKey ?? "employee-1" : null,
            lineFingerprint: "4".repeat(64)
          }]
        : []
    ));
    tx.operatingTakeoverRowMapping.findMany.mockResolvedValue([{
      id: mappingId,
      manifestVersionId,
      projectId,
      authorityVersionId: authorityId,
      authorityLineId: lineId
    }]);
    tx.operatingTakeoverCommandReceipt.findMany.mockImplementation(({ where }) => Promise.resolve(
      (lifecycle === "active" || lifecycle === "compensated") && where?.action === "manifest.activate"
        ? [{
            id: `activation-${lineId}`,
            manifestVersionId,
            action: "manifest.activate",
            status: "activated",
            lines: [{
              id: `activation-line-${lineId}`,
              rowMappingId: mappingId,
              decision: "FORMAL",
              targetKind: "clearing_event_version",
              targetRef: `clearing-event-${lineId}`,
              causalOrdinal: 1
            }],
            causedReceipts: lifecycle === "compensated"
              ? [{
                  id: `compensation-${lineId}`,
                  causesReceiptId: `activation-${lineId}`,
                  lines: [{
                    rowMappingId: mappingId,
                    reversesLineId: `activation-line-${lineId}`
                  }]
                }]
              : []
          }]
        : []
    ));
    return {
      authorityId,
      lineId,
      lineFingerprint: "4".repeat(64),
      attest: () => { lifecycle = "attested"; },
      activate: () => { lifecycle = "active"; },
      compensate: () => { lifecycle = "compensated"; }
    };
  }

  function mockAMaterializationAuthority(
    tx: ReturnType<typeof setup>["tx"],
    source: {
      id: string;
      employmentCompanyId?: string;
      wageMonth: string;
      evidenceSha256: string;
      sourceSnapshot: {
        approvedPersonLines: Array<{
          employeeId: string;
          employmentCompanyId?: string;
          projectAllocations?: Array<{
            projectId: string;
            serviceSnapshotId: string;
            serviceMonth?: string;
            serviceEvidenceSha256?: string;
          }>;
          creditorBreakdowns?: Array<{
            creditorBusinessPartyVersionId?: string;
          }>;
        }>;
      };
    }
  ) {
    const companyId = source.employmentCompanyId ?? String(source.sourceSnapshot.approvedPersonLines[0]?.employmentCompanyId ?? "");
    const employeeIds = [...new Set(source.sourceSnapshot.approvedPersonLines.map((person) => String(person.employeeId)))];
    const serviceDefinitions = new Map<string, {
      projectId: string;
      serviceSnapshotId: string;
      serviceMonth: string;
      evidenceSha256: string;
    }>();
    const partyVersionIds = new Set<string>();
    for (const person of source.sourceSnapshot.approvedPersonLines) {
      for (const allocation of person.projectAllocations ?? []) {
        allocation.serviceMonth ??= source.wageMonth;
        allocation.serviceEvidenceSha256 ??= source.evidenceSha256;
        serviceDefinitions.set(`${allocation.projectId}:${allocation.serviceSnapshotId}`, {
          projectId: allocation.projectId,
          serviceSnapshotId: allocation.serviceSnapshotId,
          serviceMonth: allocation.serviceMonth,
          evidenceSha256: allocation.serviceEvidenceSha256
        });
      }
      for (const creditor of person.creditorBreakdowns ?? []) {
        if (creditor.creditorBusinessPartyVersionId) partyVersionIds.add(creditor.creditorBusinessPartyVersionId);
      }
    }
    const projectIds = [...new Set([...serviceDefinitions.values()].map((definition) => definition.projectId))];
    tx.companyEntity.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.id === companyId && where?.isActive === true ? { id: companyId } : null
    ));
    tx.user.findMany.mockImplementation(({ where }) => Promise.resolve(
      employeeIds
        .filter((id) => where?.id?.in?.includes(id) && where?.isActive === true)
        .map((id) => ({ id, name: `人员-${id}`, departmentId: null }))
    ));
    tx.project.findMany.mockImplementation(({ where }) => Promise.resolve(
      projectIds
        .filter((id) => where?.id?.in?.includes(id) && where?.isActive === true)
        .map((id) => ({ id, code: `CODE-${id}`, name: `项目-${id}` }))
    ));
    tx.wageServiceBasisBinding.findMany.mockImplementation(({ where }) => Promise.resolve(
      where?.sourceVersionId === source.id
        ? [...serviceDefinitions.values()].map((definition) => ({
            id: `binding-${definition.projectId}-${definition.serviceSnapshotId}`,
            ...definition,
            authorityFingerprint: fingerprint({ sourceVersionId: source.id, ...definition })
          }))
        : []
    ));
    tx.businessPartyVersion.findMany.mockImplementation(({ where }) => Promise.resolve(
      [...partyVersionIds]
        .filter((id) => where?.id?.in?.includes(id))
        .map((id) => ({
          id,
          businessPartyId: `party-for-${id}`,
          versionNo: 1,
          snapshot: { name: `机构-${id}` }
        }))
    ));
  }

  function mockCompleteASource(
    tx: ReturnType<typeof setup>["tx"],
    wageStatements: ReturnType<typeof setup>["wageStatements"]
  ) {
    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-company-1",
      employmentCompanyId: "company-1",
      sourceFingerprint: "b".repeat(64),
      evidenceFileId: "approved-evidence-company-1",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    });
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-company-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" }]
    });
    mockAMaterializationAuthority(tx, source);
    return source;
  }

  function setupAmbiguousCApprovedSourceFrontier() {
    const harness = setup();
    const evidenceSha256 = "c".repeat(64);
    const sourceSnapshot = {
      employmentCompany: { id: "company-1", name: "工资承担公司" },
      wageMonth: "2026-08",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      externalReference: "PAYROLL-2026-08",
      sourceVersion: "v1",
      basisDate: "2026-08-31",
      evidence: { fileId: "approved-evidence-1", sha256: evidenceSha256 },
      approvedPersonLines: [{
        employeeId: "employee-1",
        employmentSnapshotId: "employment-snapshot-1",
        employmentCompanyId: "company-1",
        employmentPeriodStart: "2026-08-01",
        employmentPeriodEnd: "2026-08-31",
        positionCategory: "工程技术人员",
        approvedAmountCents: "1000",
        evidenceSha256,
        costComponents: [{ componentCode: "gross_wage", amountCents: "1000" }],
        creditorBreakdowns: [{
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-1",
          creditorCategory: "employee_net_pay",
          amountCents: "500"
        }, {
          creditorSubjectType: "business_party",
          creditorBusinessPartyVersionId: "party-version-1",
          creditorCategory: "withheld_individual_income_tax",
          amountCents: "500"
        }],
        projectAllocations: [{
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          serviceMonth: "2026-08",
          serviceEvidenceSha256: evidenceSha256,
          amountCents: "1000"
        }, {
          projectId: "project-1",
          serviceSnapshotId: "service-2",
          serviceMonth: "2026-08",
          serviceEvidenceSha256: evidenceSha256,
          amountCents: "0"
        }],
        projectCostComponentAllocations: [{
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          componentCode: "gross_wage",
          amountCents: "1000"
        }, {
          projectId: "project-1",
          serviceSnapshotId: "service-2",
          componentCode: "gross_wage",
          amountCents: "0"
        }],
        projectCreditorAllocations: [{
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-1",
          creditorCategory: "employee_net_pay",
          amountCents: "500"
        }, {
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          creditorSubjectType: "business_party",
          creditorBusinessPartyVersionId: "party-version-1",
          creditorCategory: "withheld_individual_income_tax",
          amountCents: "500"
        }, {
          projectId: "project-1",
          serviceSnapshotId: "service-2",
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-1",
          creditorCategory: "employee_net_pay",
          amountCents: "0"
        }, {
          projectId: "project-1",
          serviceSnapshotId: "service-2",
          creditorSubjectType: "business_party",
          creditorBusinessPartyVersionId: "party-version-1",
          creditorCategory: "withheld_individual_income_tax",
          amountCents: "0"
        }]
      }, {
        employeeId: "employee-2",
        employmentSnapshotId: "employment-snapshot-2",
        employmentCompanyId: "company-1",
        employmentPeriodStart: "2026-08-01",
        employmentPeriodEnd: "2026-08-31",
        positionCategory: "质量安全人员",
        approvedAmountCents: "0",
        evidenceSha256,
        costComponents: [{ componentCode: "gross_wage", amountCents: "0" }],
        creditorBreakdowns: [{
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-2",
          creditorCategory: "employee_net_pay",
          amountCents: "0"
        }, {
          creditorSubjectType: "business_party",
          creditorBusinessPartyVersionId: "party-version-2",
          creditorCategory: "withheld_individual_income_tax",
          amountCents: "0"
        }],
        projectAllocations: [{
          projectId: "project-2",
          serviceSnapshotId: "service-3",
          serviceMonth: "2026-08",
          serviceEvidenceSha256: evidenceSha256,
          amountCents: "0"
        }],
        projectCostComponentAllocations: [{
          projectId: "project-2",
          serviceSnapshotId: "service-3",
          componentCode: "gross_wage",
          amountCents: "0"
        }],
        projectCreditorAllocations: [{
          projectId: "project-2",
          serviceSnapshotId: "service-3",
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-2",
          creditorCategory: "employee_net_pay",
          amountCents: "0"
        }, {
          projectId: "project-2",
          serviceSnapshotId: "service-3",
          creditorSubjectType: "business_party",
          creditorBusinessPartyVersionId: "party-version-2",
          creditorCategory: "withheld_individual_income_tax",
          amountCents: "0"
        }]
      }]
    };
    const secondSourceSnapshot = {
      ...sourceSnapshot,
      externalReference: "PAYROLL-2026-08-B",
      approvedPersonLines: sourceSnapshot.approvedPersonLines.map((person) => ({
        ...person,
        costComponents: person.costComponents.map((component) => ({ ...component })),
        creditorBreakdowns: person.creditorBreakdowns.map((creditor) => ({ ...creditor })),
        projectAllocations: person.projectAllocations.map((allocation) => ({ ...allocation })),
        projectCostComponentAllocations: person.projectCostComponentAllocations
          .map((allocation) => ({ ...allocation })),
        projectCreditorAllocations: person.projectCreditorAllocations
          .map((allocation) => ({ ...allocation }))
      }))
    };
    const sourceBase = {
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "PAYROLL-2026-08",
      sourceVersion: "v1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "approved-evidence-1",
      evidenceSha256,
    };
    const sources = [
      { ...sourceBase, id: "approved-source-1", sourceFingerprint: fingerprint(sourceSnapshot), sourceSnapshot },
      {
        ...sourceBase,
        id: "approved-source-2",
        externalReference: "PAYROLL-2026-08-B",
        sourceFingerprint: fingerprint(secondSourceSnapshot),
        sourceSnapshot: secondSourceSnapshot
      }
    ];
    let companyActive = true;
    let employeeActive = true;
    let reverseQueryOrder = false;
    const employees = [
      { id: "employee-1", name: "人员-employee-1", departmentId: null as string | null },
      { id: "employee-2", name: "人员-employee-2", departmentId: "department-2" as string | null }
    ];
    const projects = [
      { id: "project-1", code: "CODE-project-1", name: "项目-project-1" },
      { id: "project-2", code: "CODE-project-2", name: "项目-project-2" }
    ];
    const serviceBindingIds = new Map([
      ["service-1", "binding-project-1-service-1"],
      ["service-2", "binding-project-1-service-2"],
      ["service-3", "binding-project-1-service-3"]
    ]);
    const businessPartySnapshots = new Map([
      ["party-version-1", { name: "历史工资受控收款方一", unifiedSocialCreditCode: "913100000000000001" }],
      ["party-version-2", { name: "历史工资受控收款方二", unifiedSocialCreditCode: "913100000000000002" }]
    ]);
    const ordered = <T>(values: T[]) => reverseQueryOrder ? [...values].reverse() : values;
    const approvedSourceSelectKeys = [
      "basisDate",
      "employmentCompanyId",
      "evidenceFileId",
      "evidenceSha256",
      "externalReference",
      "id",
      "periodEnd",
      "periodStart",
      "sourceFingerprint",
      "sourceSnapshot",
      "sourceType",
      "sourceVersion",
      "wageMonth"
    ].sort();
    const selectMany = (values: unknown[], query: PrismaFindManyQuery) =>
      prismaOrderRows(ordered(values), query.orderBy).map((value) => prismaSelect(value, query.select));

    installOperatingFactQueryContract(harness.tx.operatingFact, [legacyFact]);
    harness.tx.wageApprovedSourceVersion.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(Object.keys(query.select).sort()).toEqual(approvedSourceSelectKeys);
      if (query.where) {
        expect(query.where).toEqual({ employmentCompanyId: "company-1", wageMonth: "2026-08" });
        expect(query.orderBy).toEqual({ id: "asc" });
      } else {
        expect(query.orderBy).toEqual([{ wageMonth: "desc" }, { id: "asc" }]);
      }
      return Promise.resolve(selectMany([...sources], query));
    });
    harness.tx.wageApprovedSourceVersion.findUnique.mockImplementation((query: PrismaFindUniqueQuery) => {
      expect(Object.keys(query.select).sort()).toEqual(approvedSourceSelectKeys);
      return Promise.resolve(prismaSelect(
        sources.find((source) => source.id === query.where?.id) ?? null,
        query.select
      ));
    });
    harness.tx.fileObject.findUnique.mockImplementation((query: PrismaFindUniqueQuery) => {
      expect(query.where).toEqual({ id: sourceBase.evidenceFileId });
      expect(query.select).toEqual({ id: true, storageStatus: true, contentSha256: true });
      return Promise.resolve(prismaSelect({
        id: sourceBase.evidenceFileId,
        storageStatus: "active",
        contentSha256: evidenceSha256
      }, query.select));
    });
    harness.tx.companyEntity.findUnique.mockImplementation((query: PrismaFindUniqueQuery) => {
      expect(query.where).toEqual({ id: "company-1", isActive: true });
      expect(query.select).toEqual({ id: true });
      return Promise.resolve(prismaSelect(companyActive ? { id: "company-1" } : null, query.select));
    });
    harness.tx.user.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ id: { in: ["employee-1", "employee-2"] }, isActive: true });
      expect(query.select).toEqual({ id: true, name: true, departmentId: true });
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectMany(
        employees.filter((employee) => employeeActive || employee.id !== "employee-1").map((employee) => ({ ...employee })),
        query
      ));
    });
    harness.tx.project.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ id: { in: ["project-1", "project-2"] }, isActive: true });
      expect(query.select).toEqual({ id: true, code: true, name: true });
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectMany(projects.map((project) => ({ ...project })), query));
    });
    harness.tx.wageServiceBasisBinding.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      const sourceVersionId = (query.where as { sourceVersionId?: string } | undefined)?.sourceVersionId;
      expect(sourceVersionId).toMatch(/^approved-source-[12]$/u);
      expect(query.select).toEqual({
        id: true,
        projectId: true,
        serviceSnapshotId: true,
        serviceMonth: true,
        evidenceSha256: true,
        authorityFingerprint: true
      });
      expect(query.orderBy).toEqual([{ projectId: "asc" }, { serviceSnapshotId: "asc" }, { id: "asc" }]);
      return Promise.resolve(selectMany(
        [
          { projectId: "project-1", serviceSnapshotId: "service-1" },
          { projectId: "project-1", serviceSnapshotId: "service-2" },
          { projectId: "project-2", serviceSnapshotId: "service-3" }
        ].map(({ projectId, serviceSnapshotId }) => ({
        id: serviceBindingIds.get(serviceSnapshotId)!,
        projectId,
        serviceSnapshotId,
        serviceMonth: "2026-08",
        evidenceSha256,
        authorityFingerprint: fingerprint({
          sourceVersionId,
          projectId,
          serviceSnapshotId,
          serviceMonth: "2026-08",
          evidenceSha256
        })
      })),
        query
      ));
    });
    harness.tx.businessPartyVersion.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ id: { in: ["party-version-1", "party-version-2"] } });
      expect(query.select).toEqual({ id: true, businessPartyId: true, versionNo: true, snapshot: true });
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectMany([...businessPartySnapshots].map(([id, snapshot]) => ({
        id,
        businessPartyId: id === "party-version-1" ? "party-1" : "party-2",
        versionNo: id === "party-version-1" ? 1 : 2,
        snapshot: { ...snapshot }
      })), query));
    });
    let plannerProjects: unknown = [{
      projectId: "project-1",
      signedCostDeltaCents: "1000",
      signedPayableDeltaCents: "1000"
    }, {
      projectId: "project-2",
      signedCostDeltaCents: "0",
      signedPayableDeltaCents: "0"
    }];
    let plannerVersionKind: unknown = "base";
    let plannerTargetWageStatementId: unknown = "unmaterialized:company-1:2026-08";
    let plannerSourceDeltaFingerprint: unknown = "e".repeat(64);
    harness.wageStatements.planHistoricalTakeoverInTransaction.mockImplementation(() => Promise.resolve({
      targetWageStatementId: plannerTargetWageStatementId,
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: plannerVersionKind,
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: plannerSourceDeltaFingerprint,
      canonicalRootClosureFingerprint: "f".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: plannerProjects
    } as never));

    return {
      ...harness,
      mutatePeriodStart: () => {
        sources[0]!.periodStart = new Date("2026-08-02T00:00:00.000Z");
        sourceSnapshot.periodStart = "2026-08-02";
        sourceSnapshot.approvedPersonLines.forEach((person) => {
          person.employmentPeriodStart = "2026-08-02";
        });
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      mutatePeriodEnd: () => {
        sources[0]!.periodEnd = new Date("2026-08-30T00:00:00.000Z");
        sourceSnapshot.periodEnd = "2026-08-30";
        sourceSnapshot.approvedPersonLines.forEach((person) => {
          person.employmentPeriodEnd = "2026-08-30";
        });
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      mutateSourceType: () => { sources[0]!.sourceType = "historical_payroll_archive_corrected"; },
      invalidateSourceDate: () => { sources[0]!.periodStart = new Date(Number.NaN); },
      emptySourceId: () => { sources[0]!.id = ""; },
      duplicateSourceId: () => { sources[1]!.id = sources[0]!.id; },
      mismatchSourceFingerprint: () => { sources[0]!.sourceFingerprint = "a".repeat(64); },
      useNonCanonicalSourceAmount: () => {
        sourceSnapshot.approvedPersonLines[0]!.approvedAmountCents = "01000";
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      useNullProjectAllocation: () => {
        const allocations = sourceSnapshot.approvedPersonLines[0]!.projectAllocations as unknown[];
        allocations[0] = null;
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      duplicateSourceCostIdentity: () => {
        const cells = sourceSnapshot.approvedPersonLines[0]!.projectCostComponentAllocations;
        cells.push({ ...cells[0]! });
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      duplicateSourcePayableIdentity: () => {
        const cells = sourceSnapshot.approvedPersonLines[0]!.projectCreditorAllocations;
        cells.push({ ...cells[0]! });
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      removeSourceCostMatrixCell: () => {
        sourceSnapshot.approvedPersonLines[0]!.projectCostComponentAllocations.pop();
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      addForbiddenBusinessPartyIdToEmployeeCreditor: () => {
        const person = sourceSnapshot.approvedPersonLines[0]!;
        Object.assign(person.creditorBreakdowns[0]!, {
          creditorBusinessPartyVersionId: "   "
        });
        person.projectCreditorAllocations
          .filter((cell) => cell.creditorSubjectType === "employee_user")
          .forEach((cell) => Object.assign(cell, {
            creditorBusinessPartyVersionId: "   "
          }));
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      addForbiddenUserIdToBusinessPartyCreditor: () => {
        const person = sourceSnapshot.approvedPersonLines[0]!;
        Object.assign(person.creditorBreakdowns[1]!, {
          creditorUserId: { unexpected: "truthy" }
        });
        person.projectCreditorAllocations
          .filter((cell) => cell.creditorSubjectType === "business_party")
          .forEach((cell) => Object.assign(cell, {
            creditorUserId: { unexpected: "truthy" }
          }));
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      mutateExternalReference: () => {
        sources[0]!.externalReference = "PAYROLL-2026-08-CORRECTED";
        sourceSnapshot.externalReference = "PAYROLL-2026-08-CORRECTED";
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      mutateSourceVersion: () => {
        sources[0]!.sourceVersion = "v2";
        sourceSnapshot.sourceVersion = "v2";
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      mutateBasisDate: () => {
        sources[0]!.basisDate = new Date("2026-08-30T00:00:00.000Z");
        sourceSnapshot.basisDate = "2026-08-30";
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      removeSourceHeader: (header: "periodStart" | "periodEnd" | "sourceType" | "externalReference" | "sourceVersion" | "basisDate") => {
        (sources[0] as Record<string, unknown>)[header] = undefined;
      },
      mismatchSourceSnapshotWageMonth: () => {
        sourceSnapshot.wageMonth = "2026-07";
        sources[0]!.sourceFingerprint = fingerprint(sourceSnapshot);
      },
      removeCompany: () => { companyActive = false; },
      removeEmployee: () => { employeeActive = false; },
      mutateEmployeeName: () => { employees[0]!.name = "人员-employee-1-改"; },
      mutateEmployeeDepartment: () => { employees[0]!.departmentId = "department-1-改"; },
      mutateProjectCode: () => { projects[0]!.code = "CODE-project-1-改"; },
      mutateProjectName: () => { projects[0]!.name = "项目-project-1-改"; },
      mutateServiceBinding: () => { serviceBindingIds.set("service-1", "binding-project-1-service-1-replacement"); },
      mutateBusinessPartySnapshot: () => {
        businessPartySnapshots.set("party-version-1", {
          ...businessPartySnapshots.get("party-version-1")!,
          name: "历史工资受控收款方一-改"
        });
      },
      usePlannerWithEmptyProjectId: () => {
        plannerProjects = [
          { projectId: "", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" },
          { projectId: "project-2", signedCostDeltaCents: "0", signedPayableDeltaCents: "0" }
        ];
      },
      usePlannerWithDuplicateProject: () => {
        plannerProjects = [
          { projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" },
          { projectId: "project-1", signedCostDeltaCents: "0", signedPayableDeltaCents: "0" }
        ];
      },
      usePlannerWithNoProjects: () => { plannerProjects = []; },
      usePlannerWithExtraProjectOwnership: () => {
        plannerProjects = [
          { projectId: "project-3", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" },
          { projectId: "project-2", signedCostDeltaCents: "0", signedPayableDeltaCents: "0" }
        ];
      },
      usePlannerWithNonCanonicalAmount: () => {
        plannerProjects = [
          { projectId: "project-1", signedCostDeltaCents: "01", signedPayableDeltaCents: "01" },
          { projectId: "project-2", signedCostDeltaCents: "0", signedPayableDeltaCents: "0" }
        ];
      },
      usePlannerWithInvalidShape: () => { plannerProjects = null; },
      usePlannerWithInvalidVersionKind: () => { plannerVersionKind = "supplemental"; },
      usePlannerWithEmptyTargetId: () => { plannerTargetWageStatementId = ""; },
      usePlannerWithObjectHash: () => {
        plannerSourceDeltaFingerprint = { toString: () => "e".repeat(64) };
      },
      mutatePlannerTargetId: () => {
        plannerTargetWageStatementId = "unmaterialized:company-1:2026-08:changed";
      },
      useIncompletePlannerAmount: (amountCents: string) => {
        plannerProjects = [
          { projectId: "project-1", signedCostDeltaCents: amountCents, signedPayableDeltaCents: amountCents },
          { projectId: "project-2", signedCostDeltaCents: "0", signedPayableDeltaCents: "0" }
        ];
      },
      useOppositePlannerOrder: () => {
        if (Array.isArray(plannerProjects)) plannerProjects = [...plannerProjects].reverse();
      },
      useOppositeQueryOrder: () => { reverseQueryOrder = !reverseQueryOrder; }
    };
  }

  function setupUnresolvedCLegacyFrontier() {
    const harness = setup();
    const unresolvedLegacyFact = {
      ...legacyFact,
      occurredAt: null,
      costBearingCompanySubjectKind: null,
      costBearingCompanySubjectId: null
    };
    installOperatingFactQueryContract(harness.tx.operatingFact, [unresolvedLegacyFact]);
    return { ...harness, unresolvedLegacyFact };
  }

  function setupMalformedBSummaryCFrontier() {
    const harness = setup();
    const malformedSummaryFact = {
      ...legacyFact,
      sourceSnapshot: {
        historicalWageSummaryAuthority: {
          schemaVersion: 1,
          sourceDiscriminator: "historical_wage_summary"
        }
      }
    };
    installOperatingFactQueryContract(harness.tx.operatingFact, [malformedSummaryFact]);
    return { ...harness, malformedSummaryFact };
  }

  function installRejectedPlannerPriorMatrixFrontier(
    fixture: ReturnType<typeof setupAmbiguousCApprovedSourceFrontier>
  ) {
    let costAmountCents = 1000n;
    let costCellAmountCents = 1000n;
    let creditorAmountCents = 1000n;
    let creditorCellAmountCents = 1000n;
    let projectAmountCents = 1000n;
    let omitPriorCostCell = false;
    let priorCreditorReferenceId = "prior-creditor-1";
    let invalidRootAdjustment = false;
    let overdrawnRootAdjustment = false;
    let priorPersonLinesEmpty = false;
    let duplicatePriorCreditorSemanticKey = false;
    fixture.tx.wageStatement.findUnique.mockResolvedValue({
      id: "statement-existing",
      currentRevision: 1
    });
    fixture.tx.wageStatementVersion.findFirst.mockImplementation(() => Promise.resolve({
      id: "prior-version-1",
      statementId: "statement-existing",
      revision: 1,
      kind: "base",
      status: "confirmed",
      projectionOrigin: "historical_takeover_legacy_link",
      sourceVersionId: "prior-source-1",
      sourceSnapshot: { prior: true },
      operatingProjectionSnapshot: null,
      personLines: priorPersonLinesEmpty ? [] : [{
        id: "prior-person-1",
        employeeId: "employee-1",
        employmentSnapshotId: "employment-snapshot-1",
        costComponents: [{
          id: "prior-cost-1",
          componentCode: "gross_wage",
          amountCents: costAmountCents,
          projectAllocations: [{ id: "prior-cost-cell-1", projectAllocationId: "prior-allocation-1", amountCents: costCellAmountCents }]
        }],
        creditorBreakdowns: duplicatePriorCreditorSemanticKey
          ? [{
              id: "prior-creditor-1",
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay",
              amountCents: 500n,
              projectAllocations: [{
                id: "prior-creditor-cell-1",
                projectAllocationId: "prior-allocation-1",
                amountCents: 500n
              }]
            }, {
              id: "prior-creditor-2",
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay",
              amountCents: 500n,
              projectAllocations: [{
                id: "prior-creditor-cell-2",
                projectAllocationId: "prior-allocation-1",
                amountCents: 500n
              }]
            }]
          : [{
              id: "prior-creditor-1",
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay",
              amountCents: creditorAmountCents,
              projectAllocations: [{
                id: "prior-creditor-cell-1",
                projectAllocationId: "prior-allocation-1",
                amountCents: creditorCellAmountCents
              }]
            }],
          projectAllocations: [{
            id: "prior-allocation-1",
            projectId: "project-1",
            serviceSnapshotId: "service-1",
            amountCents: projectAmountCents,
          componentAllocations: omitPriorCostCell ? [] : [{
              id: "prior-cost-cell-1",
              costComponentId: "prior-cost-1",
              amountCents: costCellAmountCents,
              costComponent: { id: "prior-cost-1", componentCode: "gross_wage" }
            }],
          creditorAllocations: duplicatePriorCreditorSemanticKey
            ? [{
                id: "prior-creditor-cell-1",
                creditorBreakdownId: "prior-creditor-1",
                amountCents: 500n,
                creditorBreakdown: {
                  id: "prior-creditor-1",
                  creditorSubjectType: "employee_user",
                  creditorSubjectIdentityKey: "employee_user:employee-1",
                  creditorCategory: "employee_net_pay"
                }
              }, {
                id: "prior-creditor-cell-2",
                creditorBreakdownId: "prior-creditor-2",
                amountCents: 500n,
                creditorBreakdown: {
                  id: "prior-creditor-2",
                  creditorSubjectType: "employee_user",
                  creditorSubjectIdentityKey: "employee_user:employee-1",
                  creditorCategory: "employee_net_pay"
                }
              }]
            : [{
                id: "prior-creditor-cell-1",
                creditorBreakdownId: priorCreditorReferenceId,
                amountCents: creditorCellAmountCents,
                creditorBreakdown: {
                  id: priorCreditorReferenceId,
                  creditorSubjectType: "employee_user",
                  creditorSubjectIdentityKey: "employee_user:employee-1",
                  creditorCategory: "employee_net_pay"
                }
              }]
        }]
      }]
    }));
    fixture.tx.wagePayableRef.findMany.mockImplementation((query) => Promise.resolve(
      invalidRootAdjustment || overdrawnRootAdjustment
        ? [prismaSelect({
            id: "root-invalid-adjustment",
            confirmedVersionId: "prior-version-1",
            direction: "increase",
            amountCents: 1000n,
            debtorCompanyId: "company-1",
            costBearingCompanyId: "company-1",
            projectId: "project-1",
            confirmedVersion: {
              id: "prior-version-1",
              revision: 1,
              status: "confirmed",
              projectionOrigin: "historical_takeover_legacy_link"
            },
            projectAllocation: { serviceSnapshotId: "service-1" },
            personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-snapshot-1" },
            creditorBreakdown: {
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay"
            },
            adjustments: [{
              id: "bad-adjustment-1",
              direction: invalidRootAdjustment ? "sideways" : "decrease",
              amountCents: overdrawnRootAdjustment ? 1001n : 1n
            }]
          }, query.select)]
        : []
    ));
    fixture.wageStatements.planHistoricalTakeoverInTransaction.mockRejectedValue(
      new ConflictException("历史工资前置矩阵仍不满足 canonical lineage")
    );
    return {
      mutatePriorCostCell: () => {
        costAmountCents = 999n;
        costCellAmountCents = 999n;
        creditorAmountCents = 999n;
        creditorCellAmountCents = 999n;
        projectAmountCents = 999n;
      },
      emptyPriorPersonLines: () => { priorPersonLinesEmpty = true; },
      unbalancePriorCostMatrix: () => { costCellAmountCents = 999n; },
      unbalancePriorPayableMatrix: () => { creditorCellAmountCents = 999n; },
      unbalancePriorProjectAmount: () => { projectAmountCents = 999n; },
      omitPriorCostMatrixCell: () => { omitPriorCostCell = true; },
      breakPriorCreditorReference: () => { priorCreditorReferenceId = "prior-creditor-missing"; },
      useInvalidRootAdjustment: () => { invalidRootAdjustment = true; },
      useOverdrawnRootAdjustment: () => { overdrawnRootAdjustment = true; },
      duplicatePriorCreditorSemanticKey: () => { duplicatePriorCreditorSemanticKey = true; }
    };
  }

  type RootEligibilityVariant = "direction" | "status" | "revision" | "projectionOrigin";
  const rootEligibilityVariants: ReadonlyArray<[RootEligibilityVariant]> = [
    ["direction"],
    ["status"],
    ["revision"],
    ["projectionOrigin"]
  ];

  function installRejectedPlannerRootEligibilityFrontier(
    fixture: ReturnType<typeof setupAmbiguousCApprovedSourceFrontier>,
    variant: RootEligibilityVariant
  ) {
    installRejectedPlannerPriorMatrixFrontier(fixture);
    const eligibleVersion = {
      id: "prior-version-1",
      statementId: "statement-existing",
      revision: 1,
      status: "confirmed",
      projectionOrigin: "historical_takeover_legacy_link"
    };
    const root = (id: string) => ({
      id,
      confirmedVersionId: eligibleVersion.id,
      direction: "increase",
      amountCents: 1000n,
      debtorCompanyId: "company-1",
      costBearingCompanyId: "company-1",
      projectId: "project-1",
      adjustsPayableRefId: null,
      projectAllocation: { serviceSnapshotId: "service-1" },
      personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-snapshot-1" },
      creditorBreakdown: {
        creditorSubjectType: "employee_user",
        creditorSubjectIdentityKey: "employee_user:employee-1",
        creditorCategory: "employee_net_pay"
      },
      confirmedVersion: { ...eligibleVersion },
      adjustments: []
    });
    const roots = [root("root-1"), root("root-2"), root("root-3")];
    if (variant === "direction") roots[2]!.direction = "decrease";
    if (variant === "status") roots[2]!.confirmedVersion.status = "draft";
    if (variant === "revision") roots[2]!.confirmedVersion.revision = 2;
    if (variant === "projectionOrigin") roots[2]!.confirmedVersion.projectionOrigin = "ordinary";
    fixture.tx.wagePayableRef.findMany.mockImplementation((query) => {
      const relation = query.where.confirmedVersion;
      const rows = roots.filter((candidate) =>
        candidate.adjustsPayableRefId === query.where.adjustsPayableRefId &&
        (!query.where.direction || candidate.direction === query.where.direction) &&
        candidate.confirmedVersion.statementId === relation.statementId &&
        (!relation.revision?.lte || candidate.confirmedVersion.revision <= relation.revision.lte) &&
        (!relation.status || candidate.confirmedVersion.status === relation.status) &&
        (!relation.projectionOrigin || candidate.confirmedVersion.projectionOrigin === relation.projectionOrigin)
      );
      return Promise.resolve(rows.map((candidate) => prismaSelect(candidate, query.select)));
    });
    return {
      makeThirdRootEligible: () => {
        roots[2]!.direction = "increase";
        roots[2]!.confirmedVersion = { ...eligibleVersion };
      },
      mutateRootDebtorCompany: () => { roots[0]!.debtorCompanyId = "company-2"; },
      mutateRootCostBearingCompany: () => { roots[0]!.costBearingCompanyId = "company-2"; }
    };
  }

  type RejectedPlannerRootFrontier = ReturnType<typeof installRejectedPlannerRootEligibilityFrontier>;
  const rootOwnershipDrifts: ReadonlyArray<[
    string,
    (frontier: RejectedPlannerRootFrontier) => void
  ]> = [
    ["debtor company", (frontier) => frontier.mutateRootDebtorCompany()],
    ["cost-bearing company", (frontier) => frontier.mutateRootCostBearingCompany()]
  ];

  type RejectedPlannerPriorFrontier = ReturnType<typeof installRejectedPlannerPriorMatrixFrontier>;
  const invalidPriorDependencyFrontiers: Array<[
    string,
    (frontier: RejectedPlannerPriorFrontier) => void
  ]> = [
    ["empty prior person lines", (frontier) => frontier.emptyPriorPersonLines()],
    ["unbalanced prior cost matrix", (frontier) => frontier.unbalancePriorCostMatrix()],
    ["unbalanced prior payable matrix", (frontier) => frontier.unbalancePriorPayableMatrix()],
    ["unbalanced prior project amount", (frontier) => frontier.unbalancePriorProjectAmount()],
    ["incomplete prior cost matrix", (frontier) => frontier.omitPriorCostMatrixCell()],
    ["invalid prior creditor reference", (frontier) => frontier.breakPriorCreditorReference()],
    ["invalid root adjustment direction", (frontier) => frontier.useInvalidRootAdjustment()],
    ["overdrawn root adjustments", (frontier) => frontier.useOverdrawnRootAdjustment()],
    ["duplicate prior creditor semantic key", (frontier) =>
      frontier.duplicatePriorCreditorSemanticKey()]
  ];

  type AmbiguousCApprovedSourceFixture = ReturnType<typeof setupAmbiguousCApprovedSourceFrontier>;
  const cApprovedSourceFrontierDrifts: Array<[
    string,
    (fixture: AmbiguousCApprovedSourceFixture) => void
  ]> = [
    ["approved source periodStart", (fixture) => fixture.mutatePeriodStart()],
    ["approved source periodEnd", (fixture) => fixture.mutatePeriodEnd()],
    ["approved source externalReference", (fixture) => fixture.mutateExternalReference()],
    ["approved source sourceVersion", (fixture) => fixture.mutateSourceVersion()],
    ["approved source basisDate", (fixture) => fixture.mutateBasisDate()],
    ["A materialization company active row", (fixture) => fixture.removeCompany()],
    ["A materialization employee active row", (fixture) => fixture.removeEmployee()],
    ["A materialization employee name", (fixture) => fixture.mutateEmployeeName()],
    ["A materialization employee departmentId", (fixture) => fixture.mutateEmployeeDepartment()],
    ["A materialization project code", (fixture) => fixture.mutateProjectCode()],
    ["A materialization project name", (fixture) => fixture.mutateProjectName()],
    ["A materialization service binding", (fixture) => fixture.mutateServiceBinding()],
    ["A materialization business-party snapshot", (fixture) => fixture.mutateBusinessPartySnapshot()],
    ["canonical planner target", (fixture) => fixture.mutatePlannerTargetId()]
  ];

  const invalidCPlannerInputs: Array<[
    string,
    (fixture: AmbiguousCApprovedSourceFixture) => void
  ]> = [
    ["empty project ID", (fixture) => fixture.usePlannerWithEmptyProjectId()],
    ["duplicate project ownership", (fixture) => fixture.usePlannerWithDuplicateProject()],
    ["missing project closure", (fixture) => fixture.usePlannerWithNoProjects()],
    ["extra project ownership", (fixture) => fixture.usePlannerWithExtraProjectOwnership()],
    ["non-canonical amount", (fixture) => fixture.usePlannerWithNonCanonicalAmount()],
    ["invalid projects shape", (fixture) => fixture.usePlannerWithInvalidShape()],
    ["invalid version kind", (fixture) => fixture.usePlannerWithInvalidVersionKind()],
    ["empty target aggregate ID", (fixture) => fixture.usePlannerWithEmptyTargetId()],
    ["non-string source delta hash", (fixture) => fixture.usePlannerWithObjectHash()]
  ];
  const invalidCApprovedSourceInputs: Array<[
    string,
    (fixture: AmbiguousCApprovedSourceFixture) => void
  ]> = [
    ["invalid sourceType enum", (fixture) => fixture.mutateSourceType()],
    ["invalid source date", (fixture) => fixture.invalidateSourceDate()],
    ["empty source ID", (fixture) => fixture.emptySourceId()],
    ["duplicate source ID", (fixture) => fixture.duplicateSourceId()],
    ["snapshot fingerprint mismatch", (fixture) => fixture.mismatchSourceFingerprint()],
    ["non-canonical source amount", (fixture) => fixture.useNonCanonicalSourceAmount()]
  ];
  const INVALID_C_FRONTIER_INPUT_MESSAGE = "C级负权威前沿包含非法或不完整的服务端权威输入";
  const requiredApprovedSourceHeaders = [
    "periodStart",
    "periodEnd",
    "sourceType",
    "externalReference",
    "sourceVersion",
    "basisDate"
  ] as const;
  const approvedSourceParityFailures: Array<[
    string,
    (fixture: AmbiguousCApprovedSourceFixture) => void
  ]> = [
    ["row-to-snapshot wageMonth parity", (fixture) => fixture.mismatchSourceSnapshotWageMonth()],
    ["sourceSnapshot fingerprint parity", (fixture) => fixture.mismatchSourceFingerprint()]
  ];
  const structuralApprovedSourceFailures: Array<[
    string,
    (fixture: AmbiguousCApprovedSourceFixture) => void
  ]> = [
    ["duplicate source cost identity", (fixture) => fixture.duplicateSourceCostIdentity()],
    ["duplicate source payable identity", (fixture) => fixture.duplicateSourcePayableIdentity()],
    ["incomplete source cost matrix", (fixture) => fixture.removeSourceCostMatrixCell()],
    ["forbidden opposite creditor identity with whitespace", (fixture) =>
      fixture.addForbiddenBusinessPartyIdToEmployeeCreditor()],
    ["forbidden opposite creditor identity with object", (fixture) =>
      fixture.addForbiddenUserIdToBusinessPartyCreditor()]
  ];
  const invalidApprovedSourceLifecycleMutations: Array<[
    string,
    (fixture: AmbiguousCApprovedSourceFixture) => void
  ]> = [
    ...requiredApprovedSourceHeaders.map((header) => [
      `missing ${header}`,
      (fixture: AmbiguousCApprovedSourceFixture) => fixture.removeSourceHeader(header)
    ] as [string, (fixture: AmbiguousCApprovedSourceFixture) => void]),
    ...approvedSourceParityFailures,
    ...structuralApprovedSourceFailures,
    ["nested null project allocation", (fixture) => fixture.useNullProjectAllocation()]
  ];

  function persistCreatedCScope<T extends ReturnType<typeof setup>>(fixture: T) {
    const scopeData = fixture.tx.operatingTakeoverAtomicScopeVersion.create.mock.calls.at(-1)![0].data;
    const manifestData = fixture.tx.operatingTakeoverManifestVersion.create.mock.calls.at(-1)![0].data;
    const projectLinkData = fixture.tx.operatingTakeoverAtomicScopeProject.create.mock.calls.at(-1)![0].data;
    const mappingData = fixture.tx.operatingTakeoverRowMapping.create.mock.calls.at(-1)![0].data;
    const receiptData = fixture.tx.operatingTakeoverCommandReceipt.create.mock.calls.at(-1)![0].data;
    const receiptLineData = fixture.tx.operatingTakeoverCommandReceiptLine.create.mock.calls.at(-1)![0].data;
    const mapping = { ...mappingData };
    const scope = {
      ...scopeData,
      projects: [{
        ...projectLinkData,
        manifest: { ...manifestData, rows: [mapping] }
      }],
      historicalSummaryAuthorities: [],
      wageStatementReservation: null,
      receipts: [{ ...receiptData, lines: [receiptLineData] }]
    };
    fixture.tx.operatingTakeoverAtomicScopeVersion.findUnique.mockImplementation((query: PrismaScopeFindUniqueQuery) => {
      expect(query).toEqual({ where: { id: scope.id }, include: SCOPE_REVALIDATION_INCLUDE });
      return Promise.resolve(query.where.id === scope.id
        ? prismaInclude(scope, query.include)
        : null);
    });
    return scope;
  }

  async function createCScopeForApply<T extends ReturnType<typeof setup>>(fixture: T) {
    fixture.tx.operatingTakeoverManifestVersion.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverAtomicScopeProject.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverRowMapping.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverCommandReceipt.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverCommandReceiptLine.create.mockImplementation(({ data }) => Promise.resolve(data));
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    const cOption = issued.options.find((option) => option.grade === "C");
    expect(cOption).toBeDefined();
    const createCommand = {
      selectionRef: cOption!.selectionRef,
      idempotencyKey: "89898989-8989-4989-8989-898989898980",
      expectedRevision: 0,
      businessReason: "创建 C 级前沿 scope 供后续稳定性校验"
    };
    const created = await fixture.service.createScope(
      "finance-1",
      createCommand,
      new Date("2026-09-04T00:02:00.000Z")
    );
    if (
      typeof created !== "object" ||
      created === null ||
      !("commandSelectionRef" in created) ||
      typeof created.commandSelectionRef !== "string"
    ) {
      throw new Error("expected C createScope to return a scoped selectionRef");
    }
    const scope = persistCreatedCScope(fixture);
    return { ...fixture, scope, createCommand, commandSelectionRef: created.commandSelectionRef };
  }

  async function createAmbiguousCScopeForApply() {
    return createCScopeForApply(setupAmbiguousCApprovedSourceFrontier());
  }

  async function createCScopeForActivate<T extends ReturnType<typeof setup>>(initialFixture: T) {
    const fixture = await createCScopeForApply(initialFixture);
    fixture.roles.resolveActiveRoleScopesInTransaction.mockImplementation(
      (_tx: unknown, actorUserId: string) => Promise.resolve(
        actorUserId === "finance-director-1" ? ["finance_director"] : ["finance_staff"]
      )
    );
    const renewed = await fixture.service.issueScopedCommandSelection("finance-director-1", {
      selectionRef: fixture.commandSelectionRef
    }, new Date("2026-09-04T00:02:30.000Z"));
    const firstApplyReceiptLineCallIndex = fixture.tx.operatingTakeoverCommandReceiptLine.create.mock.calls.length;
    await expect(fixture.service.apply("finance-1", {
      selectionRef: fixture.commandSelectionRef,
      idempotencyKey: "89898989-8989-4989-8989-898989898981",
      expectedRevision: 1,
      businessReason: "完成 C 级 inactive apply 供激活前稳定性校验"
    }, new Date("2026-09-04T00:03:00.000Z"))).resolves.toEqual(expect.objectContaining({
      grade: "C",
      status: "inactive_applied",
      revision: 2
    }));
    persistLatestScopeReceipt(fixture.tx, fixture.scope, firstApplyReceiptLineCallIndex);
    return { ...fixture, activationSelectionRef: renewed.commandSelectionRef };
  }

  async function createAmbiguousCScopeForActivate() {
    return createCScopeForActivate(setupAmbiguousCApprovedSourceFrontier());
  }

  async function captureCompleteCGapGraphFromPublicLifecycle(
    initialFixture: ReturnType<typeof setup> = setupAmbiguousCApprovedSourceFrontier(),
    includeCompensation = false
  ) {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForActivate(initialFixture);
      fixture.tx.unresolvedWagePayableGap.create.mockImplementation(({ data }) => Promise.resolve(data));
      fixture.tx.operatingTakeoverLegacySourceBridge.create.mockImplementation(({ data }) => Promise.resolve(data));
      const firstActivationReceiptLineCallIndex = fixture.tx.operatingTakeoverCommandReceiptLine.create.mock.calls.length;
      await expect(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898982",
        expectedRevision: 2,
        businessReason: "通过公开生命周期生成真实不同 scope 的完整 C occupancy 图"
      }, new Date("2026-09-04T00:04:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "activated",
        revision: 3
      }));
      persistLatestScopeReceipt(fixture.tx, fixture.scope, firstActivationReceiptLineCallIndex);
      if (includeCompensation) {
        fixture.roles.resolveActiveRoleScopesInTransaction.mockImplementation(
          (_tx: unknown, actorUserId: string) => Promise.resolve(
            actorUserId === "finance-director-1" || actorUserId === "finance-director-2"
              ? ["finance_director"]
              : ["finance_staff"]
          )
        );
        const renewed = await fixture.service.issueScopedCommandSelection("finance-director-2", {
          selectionRef: fixture.activationSelectionRef
        }, new Date("2026-09-04T00:04:30.000Z"));
        const firstCompensationReceiptLineCallIndex = fixture.tx.operatingTakeoverCommandReceiptLine.create.mock.calls.length;
        await expect(fixture.service.compensate("finance-director-2", {
          selectionRef: renewed.commandSelectionRef,
          idempotencyKey: "89898989-8989-4989-8989-898989898983",
          expectedRevision: 3,
          businessReason: "通过公开补偿命令生成真实 C occupancy 资格回退图"
        }, new Date("2026-09-04T00:05:00.000Z"))).resolves.toEqual(expect.objectContaining({
          grade: "C",
          status: "compensated",
          revision: 4
        }));
        persistLatestScopeReceipt(
          fixture.tx,
          fixture.scope,
          firstCompensationReceiptLineCallIndex
        );
      }

      const project = fixture.scope.projects[0]!;
      const manifest = project.manifest;
      const rowMapping = manifest.rows[0]!;
      const gap = fixture.tx.unresolvedWagePayableGap.create.mock.calls.at(-1)![0].data;
      const bridge = fixture.tx.operatingTakeoverLegacySourceBridge.create.mock.calls.at(-1)![0].data;
      Object.assign(rowMapping, {
        coverageKind: null,
        coverageKey: null,
        periodStart: null,
        governedSubjectKey: null,
        authorityCategory: null,
        authoritySnapshotRef: null,
        authorityFingerprint: null,
        authorityVersionId: null,
        authorityLineId: null,
        authorityLineFingerprint: null,
        obligationId: null,
        authoritativeGrossCapCents: null,
        currencyCode: null,
        wageApprovedSourceVersionId: null,
        wageStatementReservationId: null,
        historicalWageSummaryAuthorityVersionId: null,
        createdAt: new Date("2026-09-04T00:02:03.000Z")
      });
      Object.assign(manifest, { createdAt: new Date("2026-09-04T00:02:02.000Z"), rows: [rowMapping] });
      Object.assign(project, {
        createdTransactionId: 603n,
        createdAt: new Date("2026-09-04T00:02:04.000Z"),
        manifest
      });
      const storedReceipts = fixture.scope.receipts as Array<Record<string, unknown> & {
        lines: Array<Record<string, unknown>>;
      }>;
      storedReceipts.forEach((storedReceipt, receiptIndex) => {
        Object.assign(storedReceipt, {
          manifestVersionId: null,
          causesReceiptId: storedReceipt.causesReceiptId ?? null,
          createdTransactionId: BigInt(610 + receiptIndex),
          createdAt: new Date(`2026-09-04T00:0${receiptIndex + 2}:10.000Z`)
        });
        storedReceipt.lines.forEach((line, lineIndex) => Object.assign(line, {
          targetKind: line.targetKind ?? null,
          targetRef: line.targetRef ?? null,
          reversesLineId: line.reversesLineId ?? null,
          causesLineId: line.causesLineId ?? null,
          createdAt: new Date(`2026-09-04T00:0${receiptIndex + 2}:${20 + lineIndex}.000Z`)
        }));
      });
      Object.assign(fixture.scope, {
        reservedWageStatementVersionId: null,
        createdTransactionId: 601n,
        createdAt: new Date("2026-09-04T00:02:01.000Z"),
        projects: [project],
        manifests: [manifest]
      });
      Object.assign(gap, {
        wageMonth: gap.wageMonth ?? null,
        createdTransactionId: 620n,
        createdAt: new Date("2026-09-04T00:04:01.000Z")
      });
      Object.assign(bridge, {
        createdTransactionId: 621n,
        createdAt: new Date("2026-09-04T00:04:02.000Z")
      });
      return {
        scope: fixture.scope,
        project,
        manifest,
        rowMapping,
        gap,
        bridge,
        receipts: storedReceipts
      };
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  }

  type CapturedCompleteCGapGraph = Awaited<ReturnType<typeof captureCompleteCGapGraphFromPublicLifecycle>>;

  function cLegacyReadSet() {
    return {
      projectId: "project-1",
      sourceType: "project_wage",
      sourceBusinessId: "legacy-wage-1",
      sourceVersion: 1,
      sourceFingerprint: LEGACY_HASH,
      legacyWageMonth: "2026-08",
      employmentCompanyId: "company-1",
      amountCents: 1000n,
      factId: "fact-1",
      entryKind: "original",
      direction: "increase",
      adjustsFactId: null,
      adjustmentRoot: null,
      costImpactId: "impact-cost-1",
      payableImpactId: "impact-payable-1"
    };
  }

  function installCompleteDifferentScopeCGapOccupancy(
    tx: ReturnType<typeof setup>["tx"],
    captured: CapturedCompleteCGapGraph
  ) {
    const scopeId = captured.scope.id;
    const manifestVersionId = captured.manifest.id;
    const rowMappingId = captured.rowMapping.id;
    const gapId = captured.gap.id;
    const legacy = cLegacyReadSet();
    const readSetFingerprint = captured.scope.readSetFingerprint;
    const storedPlan = captured.rowMapping.readSetSnapshot.plan;
    const targetFingerprint = fingerprint({
      targetKind: "unresolved_wage_payable_gap",
      targetRef: gapId,
      sourceFingerprint: LEGACY_HASH
    });
    const rowMapping = {
      id: rowMappingId,
      manifestVersionId,
      projectId: "project-1",
      adapterKind: "historical_wage",
      rowNo: 1,
      sourceType: "project_wage",
      sourceBusinessId: "legacy-wage-1",
      sourceVersion: 1,
      sourceFingerprint: LEGACY_HASH,
      sourceCoordinate: "project_wage:legacy-wage-1:1",
      normalizedRowHash: fingerprint(legacy),
      amountCents: 1000n,
      evidenceLevel: "C",
      coverageKind: null,
      coverageKey: null,
      periodStart: null,
      entryKind: "gap",
      mappingDecision: "GAP",
      conflictGroupKey: "wage:project-1:unresolved",
      adjustmentTargetRef: null,
      sourceDiscriminator: null,
      governedSubjectKey: null,
      authorityCategory: null,
      authoritySnapshotRef: null,
      authorityFingerprint: null,
      authorityVersionId: null,
      authorityLineId: null,
      authorityLineFingerprint: null,
      obligationId: null,
      authoritativeGrossCapCents: null,
      currencyCode: null,
      wageApprovedSourceVersionId: null,
      wageStatementReservationId: null,
      historicalWageSummaryAuthorityVersionId: null,
      authoritySnapshot: {},
      legacySourceSnapshot: { legacy },
      readSetSnapshot: { readSetFingerprint, plan: storedPlan, legacy },
      mappingFingerprint: fingerprint({ scopeId, projectId: "project-1", plan: storedPlan, legacy }),
      createdAt: new Date("2026-09-03T00:00:03.000Z")
    };
    Object.assign(rowMapping, captured.rowMapping);
    const manifest = {
      id: manifestVersionId,
      projectId: "project-1",
      atomicScopeVersionId: scopeId,
      adapterKind: "historical_wage",
      manifestNo: "OT219-OCCUPIED-2",
      version: 1,
      status: "prepared",
      sourceScopeFingerprint: fingerprint([legacy]),
      mapperName: "historical_wage_takeover",
      mapperVersion: 1,
      schemaVersion: 1,
      candidateBaselineSha: "e".repeat(40),
      permissionSnapshotFingerprint: "5".repeat(64),
      readSetFingerprint,
      manifestFingerprint: fingerprint({ scopeId, projectId: "project-1", plan: storedPlan, rows: [legacy] }),
      createdByUserId: "finance-staff-occupied",
      createdAt: new Date("2026-09-03T00:00:02.000Z"),
      rows: [rowMapping]
    };
    Object.assign(manifest, captured.manifest, { rows: [rowMapping] });
    const scope = {
      id: scopeId,
      scopeKind: "historical_wage",
      authoritySourceRef: "legacy:occupied-selection",
      authoritySourceFingerprint: "8".repeat(64),
      sourceClosureFingerprint: fingerprint([legacy]),
      reservedWageStatementVersionId: null,
      candidateBaselineSha: "e".repeat(40),
      permissionSnapshotFingerprint: "5".repeat(64),
      readSetFingerprint,
      createdByUserId: "finance-staff-occupied",
      createdTransactionId: 401n,
      createdAt: new Date("2026-09-03T00:00:01.000Z"),
      manifests: [manifest],
      wageStatementReservation: null,
      projects: [{
        id: "occupied-scope-project-2",
        projectId: "project-1",
        manifestVersionId,
        atomicScopeVersionId: scopeId,
        createdTransactionId: 403n,
        createdAt: new Date("2026-09-03T00:00:04.000Z")
      }]
    };
    Object.assign(scope, captured.scope, {
      manifests: [manifest],
      wageStatementReservation: null,
      projects: [{ ...captured.project, manifestVersionId, manifest: undefined }]
    });
    delete (scope.projects[0] as Record<string, unknown>).manifest;
    const gap = {
      id: gapId,
      atomicScopeVersionId: scopeId,
      manifestVersionId,
      rowMappingId,
      projectId: "project-1",
      wageMonth: "2026-08",
      reasonCode: "NO_COMPLETE_A_OR_B_AUTHORITY",
      sourceFingerprint: LEGACY_HASH,
      gapSnapshot: {
        reasonCode: "NO_COMPLETE_A_OR_B_AUTHORITY",
        legacy,
        negativeAuthorityFrontierFingerprint: "8".repeat(64),
        readSetFingerprint
      },
      createdTransactionId: 402n,
      createdAt: new Date("2026-09-03T00:03:01.000Z")
    };
    Object.assign(gap, captured.gap);
    type OccupancyReceiptLine = {
      id: string;
      receiptId: string;
      rowMappingId: string;
      projectId: string | null;
      lineNo: number;
      decision: string;
      entryKind: string;
      amountCents: bigint;
      targetKind: string | null;
      targetRef: string | null;
      causalOrdinal: number;
      reversesLineId: string | null;
      causesLineId: string | null;
      causalityFingerprint: string;
      lineSnapshot: unknown;
      createdAt: Date;
    };
    type OccupancyReceipt = {
      id: string;
      manifestVersionId: string | null;
      atomicScopeVersionId: string | null;
      idempotencyKey: string;
      action: string;
      expectedRevision: number;
      actorUserId: string;
      delegatorUserId: string | null;
      actorSetSnapshot: Record<string, unknown> & { actualUserId: string };
      permissionSnapshotFingerprint: string;
      fingerprint: string;
      status: string;
      resultSnapshot: unknown;
      causalityFingerprint: string;
      createdTransactionId: bigint;
      causesReceiptId: string | null;
      createdAt: Date;
      lines: OccupancyReceiptLine[];
    };
    const receipts = captured.receipts.map((item) => item as unknown as OccupancyReceipt);
    const activationReceipt = receipts.find(
      (receipt) => receipt.action === "historical_wage_takeover.scope.activate"
    )!;
    const compensationReceipt = receipts.find(
      (receipt) => receipt.action === "historical_wage_takeover.scope.compensate"
    );
    const manifestReceipts: OccupancyReceipt[] = [];
    const foreignMappingReceiptLines: OccupancyReceiptLine[] = [];
    const activationReverseLines = compensationReceipt ? [...compensationReceipt.lines] : [];
    const causalSuccessors = compensationReceipt ? [compensationReceipt] : [];
    const bridge = {
      id: "occupied-bridge-2",
      projectId: "project-1",
      rowMappingId,
      sourceType: "project_wage",
      sourceBusinessId: "legacy-wage-1",
      sourceVersion: 1,
      sourceFingerprint: LEGACY_HASH,
      targetKind: "unresolved_wage_payable_gap",
      targetRef: gapId,
      targetFingerprint,
      mappingDecision: "GAP",
      createdByUserId: "finance-director-occupied",
      createdTransactionId: 420n,
      createdAt: new Date("2026-09-03T00:03:02.000Z")
    };
    Object.assign(bridge, captured.bridge);
    const sourceBridges = [bridge];
    const reverseBridges = [bridge];
    const mappings = [rowMapping];
    const gaps = [gap];

    let reverseStorageOrder = false;
    const selectedRows = (rows: unknown[], query: PrismaFindManyQuery) => {
      const stored = reverseStorageOrder ? [...rows].reverse() : rows;
      return prismaOrderRows(stored, query.orderBy).map((item) => prismaSelect(item, query.select));
    };
    tx.operatingTakeoverLegacySourceBridge.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.select).toEqual(C_OCCUPANCY_BRIDGE_SELECT);
      if (query.where?.OR) {
        expect(query.where).toEqual({
          OR: [
            { rowMappingId },
            { targetKind: "unresolved_wage_payable_gap", targetRef: gapId }
          ]
        });
        expect(query.orderBy).toEqual({ id: "asc" });
        return Promise.resolve(selectedRows(reverseBridges, query));
      }
      expect(query.where).toEqual({
        projectId: "project-1",
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1
      });
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectedRows(sourceBridges, query));
    });
    tx.operatingTakeoverRowMapping.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ id: { in: [rowMappingId] } });
      expect(query.select).toEqual(C_OCCUPANCY_MAPPING_SELECT);
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectedRows(mappings, query));
    });
    tx.operatingTakeoverManifestVersion.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ id: { in: [manifestVersionId] } });
      expect(query.select).toEqual(C_OCCUPANCY_MANIFEST_SELECT);
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectedRows([manifest], query));
    });
    tx.operatingTakeoverAtomicScopeVersion.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ id: { in: [scopeId] } });
      expect(query.orderBy).toEqual({ id: "asc" });
      expect(query.select).toEqual(C_OCCUPANCY_SCOPE_SELECT);
      return Promise.resolve(selectedRows([scope], query));
    });
    tx.unresolvedWagePayableGap.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.where).toEqual({ atomicScopeVersionId: scopeId });
      expect(query.select).toEqual(C_OCCUPANCY_GAP_SELECT);
      expect(query.orderBy).toEqual({ id: "asc" });
      return Promise.resolve(selectedRows(gaps, query));
    });
    tx.operatingTakeoverCommandReceipt.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.orderBy).toEqual({ id: "asc" });
      expect(query.select).toEqual(C_OCCUPANCY_RECEIPT_SELECT);
      const rows = query.where?.manifestVersionId === manifestVersionId
        ? manifestReceipts
        : query.where?.causesReceiptId === activationReceipt.id
        ? causalSuccessors
        : query.where?.atomicScopeVersionId === scopeId
          ? receipts
          : [];
      expect(query.where).toEqual(
        query.where?.manifestVersionId
          ? { manifestVersionId }
          : query.where?.causesReceiptId
          ? { causesReceiptId: activationReceipt.id }
          : { atomicScopeVersionId: scopeId }
      );
      return Promise.resolve(selectedRows(rows, query));
    });
    tx.operatingTakeoverCommandReceiptLine.findMany.mockImplementation((query: PrismaFindManyQuery) => {
      expect(query.orderBy).toEqual({ id: "asc" });
      expect(query.select).toEqual(C_OCCUPANCY_RECEIPT_LINE_SELECT);
      const rows = query.where?.rowMappingId === rowMappingId
        ? [...receipts.flatMap((item) => item.lines), ...foreignMappingReceiptLines]
        : query.where?.OR
          ? activationReverseLines
          : [];
      expect(query.where).toEqual(
        query.where?.rowMappingId
          ? { rowMappingId }
          : {
              OR: [
                { causesLineId: activationReceipt.lines[0]!.id },
                { reversesLineId: activationReceipt.lines[0]!.id }
              ]
            }
      );
      return Promise.resolve(selectedRows(rows, query));
    });
    return {
      scope,
      manifest,
      rowMapping,
      gap,
      receipts,
      bridge,
      sourceBridges,
      reverseBridges,
      mappings,
      gaps,
      manifestReceipts,
      foreignMappingReceiptLines,
      activationReverseLines,
      causalSuccessors,
      useOppositeStorageOrder: () => { reverseStorageOrder = !reverseStorageOrder; }
    };
  }

  function emptyCNegativeAuthorityFrontier() {
    const legacy = cLegacyReadSet();
    return {
      schemaVersion: 1,
      authorityScope: {
        state: "resolved",
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        focusProjectId: "project-1",
        focusLegacyCoordinate: "project-1:project_wage:legacy-wage-1:1"
      },
      legacyNamespace: [legacy],
      canonicalWageDependencyReadSet: {
        statement: null,
        currentVersion: null,
        rootPayableRefs: [],
        envelopes: []
      },
      approvedSourceProbes: [],
      summaryDependencyReadSet: {
        authorities: [],
        payableRefs: []
      },
      summaryProbe: {
        summaryFingerprint: null,
        summarySourceVersionFingerprint: null,
        evidenceFiles: [],
        stablePlan: null,
        priorLineageProof: {
          schemaVersion: 1,
          summaryBucketKey: null,
          state: "none",
          reasonCode: "NO_SUMMARY_AUTHORITY",
          activePriorAuthorityId: null,
          readSetFingerprint: fingerprint({ authorities: [], payableRefs: [] }),
          readSet: { authorities: [], payableRefs: [] }
        },
        outcome: "absent_or_invalid",
        blockedReason: null
      },
      focusConflictReadSet: {
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        projectIds: ["project-1"],
        contracts: [],
        authorities: [],
        lines: []
      },
      focusOccupancyReadSet: {
        state: "unoccupied",
        bridges: [],
        mappings: [],
        reservations: [],
        manifests: [],
        scopes: [],
        scopeProjects: [],
        gaps: [],
        receipts: [],
        manifestReceipts: [],
        mappingReceiptLines: [],
        activationCausedByLines: [],
        activationReversedByLines: [],
        compensationReceipts: [],
        causalSuccessors: []
      },
      resolution: {
        eligibleASourceVersionIds: [],
        ambiguousA: false,
        eligibleB: false,
        focusOccupied: false,
        reasonCode: "NO_COMPLETE_A_OR_B_AUTHORITY"
      }
    };
  }

  function cBinding(overrides: Record<string, unknown> = {}) {
    const legacy = cLegacyReadSet();
    const negativeAuthorityFrontierFingerprint = fingerprint(emptyCNegativeAuthorityFrontier());
    return {
      actorUserId: "finance-1",
      selectionFingerprint: fingerprint({
        policy: "pol219-historical-wage-selection-v1",
        grade: "C",
        negativeAuthorityFrontierFingerprint,
        legacy: [legacy]
      }),
      grade: "C" as const,
      negativeAuthorityFrontierFingerprint,
      legacyCoordinates: [{
        projectId: "project-1",
        sourceType: "project_wage" as const,
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: LEGACY_HASH
      }],
      ...overrides
    };
  }

  function cScope(binding: Record<string, unknown>, baselineSha = "f".repeat(40)) {
    const legacy = cLegacyReadSet();
    const negativeAuthorityFrontier = emptyCNegativeAuthorityFrontier();
    const negativeAuthorityFrontierFingerprint = fingerprint(negativeAuthorityFrontier);
    const plan = {
      grade: "C",
      sourceVersionId: null,
      sourceFingerprint: null,
      sourceClosureFingerprint: null,
      projectIds: ["project-1"],
      projectDeltas: [],
      adjustmentRootProofs: [],
      negativeAuthorityFrontierFingerprint,
      negativeAuthorityFrontier,
      wageReservation: null,
      conflictReadSet: null,
      summaryAuthorityFingerprint: null,
      summarySourceVersionFingerprint: null,
      blockedReason: "NO_COMPLETE_A_OR_B_AUTHORITY"
    };
    const permissionSnapshotFingerprint = fingerprint({
      policy: "pol219-historical-wage-v1",
      selectionFingerprint: binding.selectionFingerprint,
      grade: "C",
      sourceClosureFingerprint: null,
      summaryFingerprint: null,
      negativeAuthorityFrontierFingerprint: binding.negativeAuthorityFrontierFingerprint ?? null,
      requiredActions: ["clearing.prepare", "clearing.attest", "clearing.confirm", "wage_sensitive_read"]
    });
    const sourceBinding = {
      selectionFingerprint: binding.selectionFingerprint,
      grade: binding.grade,
      sourceVersionId: binding.sourceVersionId ?? null,
      sourceFingerprint: binding.sourceFingerprint ?? null,
      sourceClosureFingerprint: binding.sourceClosureFingerprint ?? null,
      summaryFingerprint: binding.summaryFingerprint ?? null,
      negativeAuthorityFrontierFingerprint: binding.negativeAuthorityFrontierFingerprint ?? null,
      legacyCoordinates: binding.legacyCoordinates
    };
    const readSetFingerprint = fingerprint({ binding: sourceBinding, legacy: [legacy], plan });
    return {
      id: "scope-1",
      scopeKind: "historical_wage",
      authoritySourceRef: `legacy:${binding.selectionFingerprint}`,
      authoritySourceFingerprint: negativeAuthorityFrontierFingerprint,
      sourceClosureFingerprint: fingerprint([legacy]),
      reservedWageStatementVersionId: null,
      wageStatementReservation: null,
      candidateBaselineSha: baselineSha,
      permissionSnapshotFingerprint,
      readSetFingerprint,
      projects: [{
        projectId: "project-1",
        manifest: {
          id: "manifest-1",
          rows: [{
            id: "mapping-1",
            projectId: "project-1",
            adapterKind: "historical_wage",
            sourceType: "project_wage",
            sourceBusinessId: "legacy-wage-1",
            sourceVersion: 1,
            sourceFingerprint: LEGACY_HASH,
            amountCents: 1000n,
            mappingDecision: "GAP",
            evidenceLevel: "C",
            sourceDiscriminator: null,
            wageApprovedSourceVersionId: null,
            wageStatementReservationId: null,
            historicalWageSummaryAuthorityVersionId: null,
            readSetSnapshot: { readSetFingerprint, plan, legacy },
            mappingFingerprint: fingerprint({ scopeId: "scope-1", projectId: "project-1", plan, legacy })
          }]
        }
      }],
      historicalSummaryAuthorities: [],
      receipts: [{
        id: "receipt-create",
        action: "historical_wage_takeover.scope.create",
        status: "prepared",
        actorUserId: "finance-1",
        delegatorUserId: null,
        lines: [] as Array<{
          id?: string;
          rowMappingId: string;
          projectId?: string;
          amountCents?: bigint;
          causalOrdinal?: number;
          causalityFingerprint?: string;
          decision: string;
          targetKind: string;
          targetRef: string;
        }>
      }]
    };
  }

  function mockActivePriorAEligibility(tx: ReturnType<typeof setup>["tx"], input: {
    versionId: string;
    sourceVersionId: string;
    statementId: string;
    revision: number;
    projectId: string;
    legacySourceFingerprint: string;
  }) {
    const scopeId = `scope-for-${input.versionId}`;
    const envelopeId = `envelope-for-${input.versionId}`;
    const mappingId = `mapping-for-${input.versionId}`;
    const manifestId = `manifest-for-${input.versionId}`;
    const activationReceiptId = `activation-for-${input.versionId}`;
    const canonicalFingerprint = "1".repeat(64);
    const legacySourceBusinessId = "legacy-wage-1";
    const costImpactId = "impact-cost-1";
    const payableImpactId = "impact-payable-1";
    const costImpactSnapshot = {};
    const payableImpactSnapshot = {};
    const costImpactFingerprint = fingerprint({
      legacySourceFingerprint: input.legacySourceFingerprint,
      legacyImpactEntryId: costImpactId,
      impactKind: "confirmed_cost",
      direction: "increase",
      amountCents: 1000n,
      impactSnapshot: costImpactSnapshot
    });
    const payableImpactFingerprint = fingerprint({
      legacySourceFingerprint: input.legacySourceFingerprint,
      legacyImpactEntryId: payableImpactId,
      impactKind: "payable_increase",
      direction: "increase",
      amountCents: 1000n,
      impactSnapshot: payableImpactSnapshot
    });
    const authoritySourceFingerprint = "9".repeat(64);
    const sourceClosureFingerprint = "3".repeat(64);
    const permissionSnapshotFingerprint = "6".repeat(64);
    const readSetFingerprint = "d".repeat(64);
    const candidateBaselineSha = "f".repeat(40);
    const legacyReadSetValue = {
      factId: "fact-root-1",
      projectId: input.projectId,
      sourceType: "project_wage",
      sourceBusinessId: legacySourceBusinessId,
      sourceVersion: 1,
      sourceFingerprint: input.legacySourceFingerprint,
      legacyWageMonth: "2026-08",
      employmentCompanyId: "company-1",
      amountCents: "1000",
      entryKind: "original",
      direction: "increase",
      adjustsFactId: null,
      adjustmentRoot: null,
      costImpactId,
      payableImpactId
    };
    const frozenPlanReadSet = {
      grade: "A",
      sourceVersionId: input.sourceVersionId,
      sourceFingerprint: authoritySourceFingerprint,
      sourceClosureFingerprint,
      projectIds: [input.projectId]
    };
    const mappingOwner = {
      id: mappingId,
      manifestVersionId: manifestId,
      projectId: input.projectId,
      rowNo: 1,
      adapterKind: "historical_wage",
      sourceType: "project_wage",
      sourceBusinessId: legacySourceBusinessId,
      sourceVersion: 1,
      sourceFingerprint: input.legacySourceFingerprint,
      sourceCoordinate: `project_wage:${legacySourceBusinessId}:1`,
      normalizedRowHash: fingerprint(legacyReadSetValue),
      amountCents: 1000n,
      evidenceLevel: "A",
      coverageKind: null,
      coverageKey: null,
      periodStart: null,
      entryKind: "formal",
      mappingDecision: "FORMAL",
      conflictGroupKey: `wage:${input.projectId}:${input.sourceVersionId}`,
      adjustmentTargetRef: null,
      sourceDiscriminator: "wage_statement_version",
      governedSubjectKey: null,
      authorityCategory: null,
      authoritySnapshotRef: null,
      authorityFingerprint: null,
      authorityVersionId: null,
      authorityLineId: null,
      authorityLineFingerprint: null as string | null,
      obligationId: null,
      authoritativeGrossCapCents: null,
      currencyCode: null,
      wageApprovedSourceVersionId: input.sourceVersionId,
      wageStatementReservationId: input.versionId,
      historicalWageSummaryAuthorityVersionId: null,
      authoritySnapshot: {},
      legacySourceSnapshot: {
        ...legacyReadSetValue,
        costImpactSnapshot,
        costImpactFingerprint,
        payableImpactSnapshot,
        payableImpactFingerprint,
        businessReason: "active prior A eligibility fixture",
        evidenceRefs: []
      },
      readSetSnapshot: {
        readSetFingerprint,
        plan: frozenPlanReadSet,
        legacy: legacyReadSetValue
      },
      mappingFingerprint: fingerprint({
        scopeId,
        projectId: input.projectId,
        plan: frozenPlanReadSet,
        legacy: legacyReadSetValue
      }),
      createdAt: new Date("2026-09-04T00:00:00.500Z")
    };
    const envelope = {
      id: envelopeId,
      atomicScopeVersionId: scopeId,
      manifestVersionId: manifestId,
      wageStatementVersionId: input.versionId,
      rowMappingId: mappingId,
      projectId: input.projectId,
      legacySourceType: "project_wage",
      legacySourceBusinessId,
      legacySourceVersion: 1,
      canonicalFingerprint,
      legacySourceFingerprint: input.legacySourceFingerprint,
      legacyImpactSnapshot: {
        factId: "fact-root-1",
        costImpactId,
        costImpactSnapshot,
        costImpactFingerprint,
        payableImpactId,
        payableImpactSnapshot,
        payableImpactFingerprint
      },
      projectionOrigin: "historical_takeover_legacy_link",
      deltaDirection: "increase",
      createdTransactionId: 301n,
      createdAt: new Date("2026-09-04T00:00:01.000Z"),
      manifest: { id: manifestId, atomicScopeVersionId: scopeId, projectId: input.projectId },
      rowMapping: mappingOwner,
      reservation: { id: input.versionId, atomicScopeVersionId: scopeId },
      costCells: [{
        id: `cost-envelope-for-${input.versionId}`,
        envelopeId,
        costCellId: `cost-cell-for-${input.versionId}`,
        direction: "increase",
        amountCents: 1000n
      }],
      payableRefs: [{
        id: `payable-envelope-for-${input.versionId}`,
        envelopeId,
        payableRefId: "wage-root-ref-1",
        direction: "increase",
        amountCents: 1000n
      }],
      legacyImpactBridges: [
        {
          id: `impact-bridge-cost-for-${input.versionId}`,
          envelopeId,
          summaryAuthorityVersionId: null,
          rowMappingId: mappingId,
          projectId: input.projectId,
          legacyImpactEntryId: costImpactId,
          impactKind: "confirmed_cost",
          direction: "increase",
          amountCents: 1000n,
          sourceFingerprint: costImpactFingerprint,
          createdTransactionId: 302n,
          createdAt: new Date("2026-09-04T00:00:02.000Z")
        },
        {
          id: `impact-bridge-payable-for-${input.versionId}`,
          envelopeId,
          summaryAuthorityVersionId: null,
          rowMappingId: mappingId,
          projectId: input.projectId,
          legacyImpactEntryId: payableImpactId,
          impactKind: "payable_increase",
          direction: "increase",
          amountCents: 1000n,
          sourceFingerprint: payableImpactFingerprint,
          createdTransactionId: 303n,
          createdAt: new Date("2026-09-04T00:00:03.000Z")
        }
      ],
      eligibilityRevocations: []
    };
    const scopeManifest = {
      id: manifestId,
      projectId: input.projectId,
      atomicScopeVersionId: scopeId,
      adapterKind: "historical_wage",
      manifestNo: `OT219-${input.versionId}`,
      version: 1,
      status: "prepared",
      sourceScopeFingerprint: fingerprint([legacyReadSetValue]),
      mapperName: "historical_wage_takeover",
      mapperVersion: 1,
      schemaVersion: 1,
      candidateBaselineSha,
      permissionSnapshotFingerprint,
      readSetFingerprint,
      manifestFingerprint: fingerprint({
        scopeId,
        projectId: input.projectId,
        plan: frozenPlanReadSet,
        rows: [legacyReadSetValue]
      }),
      createdByUserId: "finance-staff-prior",
      createdAt: new Date("2026-09-04T00:00:01.000Z"),
      rows: [mappingOwner]
    };
    const scopeProject = {
      id: `scope-project-for-${input.versionId}`,
      atomicScopeVersionId: scopeId,
      projectId: input.projectId,
      manifestVersionId: manifestId,
      createdTransactionId: 306n,
      createdAt: new Date("2026-09-04T00:00:02.000Z"),
      manifest: scopeManifest
    };
    const receiptLine = (
      receiptId: string,
      lineId: string,
      decision: "PREPARED" | "inactive_applied" | "FORMAL",
      createdAt: string
    ) => ({
      id: lineId,
      receiptId,
      rowMappingId: mappingId,
      projectId: input.projectId,
      lineNo: 1,
      amountCents: 1000n,
      causalOrdinal: 1,
      decision,
      entryKind: "historical_wage",
      targetKind: decision === "FORMAL" ? "wage_takeover_projection_envelope" : null,
      targetRef: decision === "FORMAL" ? envelopeId : null,
      reversesLineId: null,
      causesLineId: null,
      causalityFingerprint: fingerprint({
        receiptId,
        mappingId,
        causalOrdinal: 1,
        causesLineId: null,
        causeLineFingerprint: null
      }),
      lineSnapshot: legacyReadSetValue,
      createdAt: new Date(createdAt),
      rowMapping: mappingOwner
    });
    const createReceiptId = `create-for-${input.versionId}`;
    const applyReceiptId = `apply-for-${input.versionId}`;
    const createCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.create",
      "finance-staff-prior",
      0,
      scopeId
    );
    const applyCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.apply",
      "finance-staff-prior",
      1,
      scopeId
    );
    const activationCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.activate",
      "finance-director-prior",
      2,
      scopeId
    );
    const createReceipt = {
      id: createReceiptId,
      manifestVersionId: null,
      atomicScopeVersionId: scopeId,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      action: "historical_wage_takeover.scope.create",
      expectedRevision: 0,
      actorUserId: "finance-staff-prior",
      delegatorUserId: null,
      actorSetSnapshot: {
        actualUserId: "finance-staff-prior",
        actualRoles: ["finance_staff"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-staff-prior"]
      },
      permissionSnapshotFingerprint,
      ...createCommand,
      status: "prepared",
      resultSnapshot: {
        atomicScopeVersionId: scopeId,
        grade: "A",
        status: "prepared",
        projectCount: 1,
        rowCount: 1,
        commandSelectionRef: `hwt1.fixture.${input.versionId}`
      },
      causesReceiptId: null as string | null,
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.create",
        atomicScopeVersionId: scopeId,
        commandFingerprint: createCommand.fingerprint,
        mappings: [mappingId]
      }),
      createdTransactionId: 307n,
      createdAt: new Date("2026-09-04T00:00:03.000Z"),
      causedReceipts: [],
      lines: [receiptLine(createReceiptId, `create-line-for-${input.versionId}`, "PREPARED", "2026-09-04T00:00:04.000Z")]
    };
    const applyReceipt = {
      ...createReceipt,
      id: applyReceiptId,
      idempotencyKey: "23232323-2323-4232-8232-232323232323",
      action: "historical_wage_takeover.scope.apply",
      expectedRevision: 1,
      ...applyCommand,
      status: "inactive_applied",
      resultSnapshot: {
        atomicScopeVersionId: scopeId,
        grade: "A",
        status: "inactive_applied",
        revision: 2,
        rowCount: 1
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.apply",
        atomicScopeVersionId: scopeId,
        commandFingerprint: applyCommand.fingerprint,
        mappings: [mappingId]
      }),
      createdTransactionId: 308n,
      createdAt: new Date("2026-09-04T00:00:05.000Z"),
      lines: [receiptLine(applyReceiptId, `apply-line-for-${input.versionId}`, "inactive_applied", "2026-09-04T00:00:06.000Z")]
    };
    const activationReceipt = {
      ...createReceipt,
      id: activationReceiptId,
      idempotencyKey: "21212121-2121-4121-8121-212121212121",
      action: "historical_wage_takeover.scope.activate",
      expectedRevision: 2,
      actorUserId: "finance-director-prior",
      actorSetSnapshot: {
        actualUserId: "finance-director-prior",
        actualRoles: ["finance_director"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-director-prior"]
      },
      ...activationCommand,
      status: "activated",
      resultSnapshot: {
        atomicScopeVersionId: scopeId,
        grade: "A",
        status: "activated",
        revision: 3,
        rows: [{
          projectId: input.projectId,
          decision: "FORMAL",
          targetKind: "wage_takeover_projection_envelope",
          targetRef: envelopeId
        }]
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.activate",
        atomicScopeVersionId: scopeId,
        commandFingerprint: activationCommand.fingerprint,
        mappings: [mappingId]
      }),
      createdTransactionId: 304n,
      createdAt: new Date("2026-09-04T00:00:07.000Z"),
      lines: [receiptLine(activationReceiptId, `activation-line-for-${input.versionId}`, "FORMAL", "2026-09-04T00:00:08.000Z")]
    };
    const reservation = {
      id: input.versionId,
      atomicScopeVersionId: scopeId,
      targetWageStatementId: input.statementId,
      expectedCurrentRevision: input.revision - 1,
      reservedRevision: input.revision,
      versionKind: input.revision === 1 ? "base" : "correction",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "2".repeat(64),
      canonicalRootClosureFingerprint: "5".repeat(64),
      createdAt: new Date("2026-09-04T00:00:00.000Z"),
      mappings: [mappingOwner],
      atomicScope: {
        id: scopeId,
        scopeKind: "historical_wage",
        authoritySourceRef: input.sourceVersionId,
        authoritySourceFingerprint,
        sourceClosureFingerprint,
        reservedWageStatementVersionId: input.versionId,
        candidateBaselineSha,
        permissionSnapshotFingerprint,
        readSetFingerprint,
        createdByUserId: "finance-staff-prior",
        createdTransactionId: 300n,
        createdAt: new Date("2026-09-03T23:59:59.000Z"),
        projects: [scopeProject],
        manifests: [scopeManifest],
        receipts: [activationReceipt, createReceipt, applyReceipt],
        wageProjectionEnvelopes: [envelope]
      }
    };
    tx.wageTakeoverWageStatementReservation.findUnique.mockImplementation(({ where, select }: PrismaFindUniqueQuery) => Promise.resolve(
      where?.id === input.versionId ? prismaSelect(reservation, select) : null
    ));
    tx.operatingTakeoverLegacySourceBridge.findMany.mockResolvedValue([{
      id: `bridge-for-${input.versionId}`,
      projectId: input.projectId,
      rowMappingId: mappingId,
      sourceType: "project_wage",
      sourceBusinessId: legacySourceBusinessId,
      sourceVersion: 1,
      sourceFingerprint: input.legacySourceFingerprint,
      targetKind: "wage_takeover_projection_envelope",
      targetRef: envelopeId,
      targetFingerprint: fingerprint({
        targetKind: "wage_takeover_projection_envelope",
        targetRef: envelopeId,
        canonicalFingerprint,
        sourceFingerprint: input.legacySourceFingerprint
      }),
      mappingDecision: "FORMAL",
      createdByUserId: "finance-director-prior",
      createdTransactionId: 305n,
      createdAt: new Date("2026-09-04T00:00:06.000Z")
    }]);
  }

  function setupTwoProjectACorrection() {
    const harness = setup();
    const { tx, wageStatements } = harness;
    const evidenceSha256 = "c".repeat(64);
    const sourceFingerprint = "b".repeat(64);
    const priorSourceVersionId = "approved-source-root-1";
    const targetWageStatementId = "statement-correction-1";
    const priorWageStatementVersionId = "wage-version-root-1";
    const rootFacts = [
      {
        ...legacyFact,
        id: "fact-root-project-1",
        sourceBusinessId: "legacy-root-project-1"
      },
      {
        ...legacyFact,
        id: "fact-root-project-2",
        projectId: "project-2",
        sourceBusinessId: "legacy-root-project-2",
        amountCents: 2000n,
        impacts: [
          { id: "impact-cost-root-project-2", impactKind: "confirmed_cost", amountCents: 2000n, direction: "increase", sourceImpactKey: "cost" },
          { id: "impact-payable-root-project-2", impactKind: "payable_increase", amountCents: 2000n, direction: "increase", sourceImpactKey: "payable" }
        ]
      }
    ];
    const correctionFacts = [
      {
        ...legacyFact,
        id: "fact-correction-project-1",
        sourceBusinessId: "legacy-correction-project-1",
        sourceVersion: 2,
        amountCents: 200n,
        entryKind: "correction",
        adjustsFactId: rootFacts[0]!.id,
        impacts: [
          { id: "impact-cost-correction-project-1", impactKind: "confirmed_cost", amountCents: 200n, direction: "decrease", sourceImpactKey: "cost" },
          { id: "impact-payable-correction-project-1", impactKind: "payable_decrease", amountCents: 200n, direction: "decrease", sourceImpactKey: "payable" }
        ]
      },
      {
        ...legacyFact,
        id: "fact-correction-project-2",
        projectId: "project-2",
        sourceBusinessId: "legacy-correction-project-2",
        sourceVersion: 2,
        amountCents: 300n,
        entryKind: "correction",
        adjustsFactId: rootFacts[1]!.id,
        impacts: [
          { id: "impact-cost-correction-project-2", impactKind: "confirmed_cost", amountCents: 300n, direction: "decrease", sourceImpactKey: "cost" },
          { id: "impact-payable-correction-project-2", impactKind: "payable_decrease", amountCents: 300n, direction: "decrease", sourceImpactKey: "payable" }
        ]
      }
    ];
    const rootFingerprints = rootFacts.map((fact) => historicalWageLegacyFingerprint(fact));
    const currentSource = schemaFaithfulApprovedSource({
      id: "approved-source-correction-2",
      employmentCompanyId: "company-1",
      sourceFingerprint,
      evidenceFileId: "approved-evidence-correction-2",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [
          {
            employeeId: "employee-1",
            employmentSnapshotId: "employment-snapshot-1",
            employmentCompanyId: "company-1",
            approvedAmountCents: "1500",
            evidenceSha256,
            projectAllocations: [
              { projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "500" },
              { projectId: "project-2", serviceSnapshotId: "service-2", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "1000" }
            ],
            creditorBreakdowns: [{ creditorSubjectType: "business_party", creditorBusinessPartyVersionId: "party-version-1" }]
          },
          {
            employeeId: "employee-2",
            employmentSnapshotId: "employment-snapshot-2",
            employmentCompanyId: "company-1",
            approvedAmountCents: "1000",
            evidenceSha256,
            projectAllocations: [
              { projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "300" },
              { projectId: "project-2", serviceSnapshotId: "service-2", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "700" }
            ],
            creditorBreakdowns: [{ creditorSubjectType: "business_party", creditorBusinessPartyVersionId: "party-version-2" }]
          }
        ]
      }
    });
    const priorSourceSnapshot = {
      approvedPersonLines: [
        {
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1800",
          evidenceSha256,
          projectAllocations: [
            { projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "600" },
            { projectId: "project-2", serviceSnapshotId: "service-2", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "1200" }
          ],
          creditorBreakdowns: [{ creditorSubjectType: "business_party", creditorBusinessPartyVersionId: "party-version-1" }]
        },
        {
          employeeId: "employee-2",
          employmentSnapshotId: "employment-snapshot-2",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1200",
          evidenceSha256,
          projectAllocations: [
            { projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "400" },
            { projectId: "project-2", serviceSnapshotId: "service-2", serviceMonth: "2026-08", serviceEvidenceSha256: evidenceSha256, amountCents: "800" }
          ],
          creditorBreakdowns: [{ creditorSubjectType: "business_party", creditorBusinessPartyVersionId: "party-version-2" }]
        }
      ]
    };
    const canonicalRootRefs = {
      project1: "root-z-project-1",
      project2: "root-a-project-2"
    };
    let canonicalRootPayableRefIds = [canonicalRootRefs.project2, canonicalRootRefs.project1];
    const plan = () => ({
      targetWageStatementId,
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind: "correction",
      priorConfirmedVersionId: priorWageStatementVersionId,
      priorSourceVersionId,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [...canonicalRootPayableRefIds],
      projects: [
        { projectId: "project-1", signedCostDeltaCents: "-200", signedPayableDeltaCents: "-200" },
        { projectId: "project-2", signedCostDeltaCents: "-300", signedPayableDeltaCents: "-300" }
      ]
    });
    const planningAuthorityInput = Object.freeze({
      sourceVersionId: currentSource.id,
      sourceFingerprint: currentSource.sourceFingerprint
    });
    wageStatements.planHistoricalTakeoverInTransaction.mockImplementation((client, input) => {
      expect(client).toBe(tx);
      const hasReservedTarget = Object.prototype.hasOwnProperty.call(input, "reservedTargetWageStatementId");
      expect(input).toEqual(hasReservedTarget
        ? { ...planningAuthorityInput, reservedTargetWageStatementId: targetWageStatementId }
        : planningAuthorityInput);
      return Promise.resolve(plan());
    });

    const facts = [...rootFacts, ...correctionFacts];
    const factsById = new Map(facts.map((fact) => [fact.id, fact]));
    const factsByBusinessId = new Map(facts.map((fact) => [fact.sourceBusinessId, fact]));
    tx.operatingFact.findMany.mockImplementation(({ where }) => Promise.resolve(
      where?.factKind === "project_wage" && where?.status === "confirmed" ? facts : []
    ));
    tx.operatingFact.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.id
        ? factsById.get(where.id) ?? null
        : factsByBusinessId.get(where?.sourceType_sourceBusinessId?.sourceBusinessId) ?? null
    ));
    tx.wageApprovedSourceVersion.findMany.mockImplementation(({ orderBy }) => Promise.resolve(
      orderBy?.[0]?.wageMonth === "desc" ? [currentSource] : []
    ));
    tx.wageApprovedSourceVersion.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.id === currentSource.id ? currentSource : null
    ));
    tx.fileObject.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.id === currentSource.evidenceFileId
        ? { id: currentSource.evidenceFileId, storageStatus: "active", contentSha256: evidenceSha256 }
        : null
    ));
    tx.wageStatement.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.employmentCompanyId_wageMonth?.employmentCompanyId === "company-1" &&
      where?.employmentCompanyId_wageMonth?.wageMonth === "2026-08"
        ? { id: targetWageStatementId, currentRevision: 1 }
        : null
    ));
    tx.wageStatementVersion.findFirst.mockImplementation(({ where }) => Promise.resolve(
      where?.statementId === targetWageStatementId && where?.revision === 1
        ? {
            id: priorWageStatementVersionId,
            statementId: targetWageStatementId,
            revision: 1,
            kind: "base",
            status: "confirmed",
            projectionOrigin: "historical_takeover_legacy_link",
            sourceVersionId: priorSourceVersionId,
            sourceSnapshot: priorSourceSnapshot,
            operatingProjectionSnapshot: null,
            personLines: canonicalPriorPersonLines([
              { projectId: "project-1", serviceSnapshotId: "service-1", amountCents: 1000n },
              { projectId: "project-2", serviceSnapshotId: "service-2", amountCents: 2000n }
            ])
          }
        : null
    ));

    const priorScopeId = "scope-root-two-projects";
    const activationReceiptId = "activation-root-two-projects";
    const priorAuthorityFingerprint = "8".repeat(64);
    const priorSourceClosureFingerprint = "3".repeat(64);
    const priorPermissionFingerprint = "5".repeat(64);
    const priorReadSetFingerprint = "7".repeat(64);
    const priorCandidateBaselineSha = "e".repeat(40);
    const priorFrozenPlanReadSet = {
      grade: "A",
      sourceVersionId: priorSourceVersionId,
      sourceFingerprint: priorAuthorityFingerprint,
      sourceClosureFingerprint: priorSourceClosureFingerprint,
      projectIds: rootFacts.map((fact) => fact.projectId)
    };
    const envelopes = rootFacts.map((rootFact, index) => {
      const projectNo = index + 1;
      const envelopeId = `envelope-${projectNo === 1 ? "a" : "z"}-project-${projectNo}`;
      const rowMappingId = `mapping-root-project-${projectNo}`;
      const manifestVersionId = `manifest-root-project-${projectNo}`;
      const canonicalFingerprint = String(projectNo).repeat(64);
      const costImpact = rootFact.impacts.find((impact) => impact.impactKind === "confirmed_cost")!;
      const payableImpact = rootFact.impacts.find((impact) => impact.impactKind === "payable_increase")!;
      const costImpactSnapshot = {};
      const payableImpactSnapshot = {};
      const costImpactFingerprint = fingerprint({
        legacySourceFingerprint: rootFingerprints[index]!,
        legacyImpactEntryId: costImpact.id,
        impactKind: costImpact.impactKind,
        direction: costImpact.direction,
        amountCents: costImpact.amountCents,
        impactSnapshot: costImpactSnapshot
      });
      const payableImpactFingerprint = fingerprint({
        legacySourceFingerprint: rootFingerprints[index]!,
        legacyImpactEntryId: payableImpact.id,
        impactKind: payableImpact.impactKind,
        direction: payableImpact.direction,
        amountCents: payableImpact.amountCents,
        impactSnapshot: payableImpactSnapshot
      });
      const legacyReadSetValue = {
        factId: rootFact.id,
        projectId: rootFact.projectId,
        sourceType: "project_wage",
        sourceBusinessId: rootFact.sourceBusinessId,
        sourceVersion: rootFact.sourceVersion,
        sourceFingerprint: rootFingerprints[index]!,
        legacyWageMonth: "2026-08",
        employmentCompanyId: "company-1",
        amountCents: rootFact.amountCents.toString(),
        entryKind: "original",
        direction: "increase",
        adjustsFactId: null,
        adjustmentRoot: null,
        costImpactId: costImpact.id,
        payableImpactId: payableImpact.id
      };
      return {
        id: envelopeId,
        atomicScopeVersionId: priorScopeId,
        manifestVersionId,
        wageStatementVersionId: priorWageStatementVersionId,
        rowMappingId,
        projectId: rootFact.projectId,
        canonicalFingerprint,
        legacySourceType: "project_wage",
        legacySourceBusinessId: rootFact.sourceBusinessId,
        legacySourceVersion: rootFact.sourceVersion,
        legacySourceFingerprint: rootFingerprints[index]!,
        legacyImpactSnapshot: {
          factId: rootFact.id,
          costImpactId: costImpact.id,
          costImpactSnapshot,
          costImpactFingerprint,
          payableImpactId: payableImpact.id,
          payableImpactSnapshot,
          payableImpactFingerprint
        },
        projectionOrigin: "historical_takeover_legacy_link",
        deltaDirection: "increase",
        createdTransactionId: BigInt(200 + projectNo),
        createdAt: new Date(`2026-09-04T00:00:0${projectNo}.000Z`),
        manifest: { id: manifestVersionId, atomicScopeVersionId: priorScopeId, projectId: rootFact.projectId },
        rowMapping: {
          id: rowMappingId,
          manifestVersionId,
          projectId: rootFact.projectId,
          rowNo: projectNo,
          adapterKind: "historical_wage",
          sourceType: "project_wage",
          sourceBusinessId: rootFact.sourceBusinessId,
          sourceVersion: rootFact.sourceVersion,
          sourceFingerprint: rootFingerprints[index]!,
          sourceCoordinate: `project_wage:${rootFact.sourceBusinessId}:${rootFact.sourceVersion}`,
          normalizedRowHash: fingerprint(legacyReadSetValue),
          amountCents: rootFact.amountCents,
          evidenceLevel: "A",
          coverageKind: null,
          coverageKey: null,
          periodStart: null,
          entryKind: "formal",
          mappingDecision: "FORMAL",
          conflictGroupKey: `wage:${rootFact.projectId}:${priorSourceVersionId}`,
          adjustmentTargetRef: null,
          sourceDiscriminator: "wage_statement_version",
          governedSubjectKey: null,
          authorityCategory: null,
          authoritySnapshotRef: null,
          authorityFingerprint: null,
          authorityVersionId: null,
          authorityLineId: null,
          authorityLineFingerprint: null as string | null,
          obligationId: null,
          authoritativeGrossCapCents: null,
          currencyCode: null,
          wageApprovedSourceVersionId: priorSourceVersionId,
          wageStatementReservationId: priorWageStatementVersionId,
          historicalWageSummaryAuthorityVersionId: null,
          authoritySnapshot: {},
          legacySourceSnapshot: {
            ...legacyReadSetValue,
            costImpactSnapshot,
            costImpactFingerprint,
            payableImpactSnapshot,
            payableImpactFingerprint,
            businessReason: "two-project prior graph",
            evidenceRefs: []
          },
          readSetSnapshot: {
            readSetFingerprint: priorReadSetFingerprint,
            plan: priorFrozenPlanReadSet,
            legacy: legacyReadSetValue
          },
          mappingFingerprint: fingerprint({
            scopeId: priorScopeId,
            projectId: rootFact.projectId,
            plan: priorFrozenPlanReadSet,
            legacy: legacyReadSetValue
          }),
          createdAt: new Date(`2026-09-04T00:00:4${projectNo}.000Z`)
        },
        reservation: { id: priorWageStatementVersionId, atomicScopeVersionId: priorScopeId },
        costCells: [{
          id: `envelope-cost-root-project-${projectNo}`,
          envelopeId,
          costCellId: `cost-cell-root-project-${projectNo}`,
          direction: "increase",
          amountCents: rootFact.amountCents
        }],
        payableRefs: [{
          id: `envelope-payable-root-project-${projectNo}`,
          envelopeId,
          payableRefId: projectNo === 1 ? canonicalRootRefs.project1 : canonicalRootRefs.project2,
          direction: "increase",
          amountCents: rootFact.amountCents
        }],
        legacyImpactBridges: [
          {
            id: `impact-bridge-cost-root-project-${projectNo}`,
            envelopeId,
            summaryAuthorityVersionId: null,
            rowMappingId,
            projectId: rootFact.projectId,
            legacyImpactEntryId: costImpact.id,
            impactKind: "confirmed_cost",
            direction: "increase",
            amountCents: rootFact.amountCents,
            sourceFingerprint: costImpactFingerprint,
            createdTransactionId: BigInt(210 + projectNo),
            createdAt: new Date(`2026-09-04T00:00:1${projectNo}.000Z`)
          },
          {
            id: `impact-bridge-payable-root-project-${projectNo}`,
            envelopeId,
            summaryAuthorityVersionId: null,
            rowMappingId,
            projectId: rootFact.projectId,
            legacyImpactEntryId: payableImpact.id,
            impactKind: "payable_increase",
            direction: "increase",
            amountCents: rootFact.amountCents,
            sourceFingerprint: payableImpactFingerprint,
            createdTransactionId: BigInt(220 + projectNo),
            createdAt: new Date(`2026-09-04T00:00:2${projectNo}.000Z`)
          }
        ],
        eligibilityRevocations: [],
        wageStatementVersion: {
          id: priorWageStatementVersionId,
          statementId: targetWageStatementId,
          revision: 1,
          kind: "base",
          sourceVersionId: priorSourceVersionId,
          projectionOrigin: "historical_takeover_legacy_link",
          status: "confirmed"
        }
      };
    });
    const bridges = envelopes.map((envelope, index) => ({
      id: `bridge-root-project-${index + 1}`,
      rowMappingId: envelope.rowMappingId,
      projectId: envelope.projectId,
      sourceType: "project_wage",
      sourceBusinessId: envelope.legacySourceBusinessId,
      sourceVersion: envelope.legacySourceVersion,
      sourceFingerprint: envelope.legacySourceFingerprint,
      targetKind: "wage_takeover_projection_envelope",
      targetRef: envelope.id,
      targetFingerprint: fingerprint({
        targetKind: "wage_takeover_projection_envelope",
        targetRef: envelope.id,
        canonicalFingerprint: envelope.canonicalFingerprint,
        sourceFingerprint: envelope.legacySourceFingerprint
      }),
      mappingDecision: "FORMAL",
      createdByUserId: "finance-director-root",
      createdTransactionId: BigInt(230 + index),
      createdAt: new Date(`2026-09-04T00:00:3${index + 1}.000Z`)
    }));
    const priorScopeProjects = envelopes.map((envelope, index) => {
      const legacyReadSetValue = envelope.rowMapping.readSetSnapshot.legacy;
      const manifest = {
        id: envelope.manifestVersionId,
        projectId: envelope.projectId,
        atomicScopeVersionId: priorScopeId,
        adapterKind: "historical_wage",
        manifestNo: `OT219-prior-project-${index + 1}`,
        version: 1,
        status: "prepared",
        sourceScopeFingerprint: fingerprint([legacyReadSetValue]),
        mapperName: "historical_wage_takeover",
        mapperVersion: 1,
        schemaVersion: 1,
        candidateBaselineSha: priorCandidateBaselineSha,
        permissionSnapshotFingerprint: priorPermissionFingerprint,
        readSetFingerprint: priorReadSetFingerprint,
        manifestFingerprint: fingerprint({
          scopeId: priorScopeId,
          projectId: envelope.projectId,
          plan: priorFrozenPlanReadSet,
          rows: [legacyReadSetValue]
        }),
        createdByUserId: "finance-staff-root",
        createdAt: new Date(`2026-09-04T00:00:5${index + 1}.000Z`),
        rows: [envelope.rowMapping]
      };
      return {
        id: `scope-project-root-${index + 1}`,
        atomicScopeVersionId: priorScopeId,
        projectId: envelope.projectId,
        manifestVersionId: envelope.manifestVersionId,
        createdTransactionId: BigInt(250 + index),
        createdAt: new Date(`2026-09-04T00:00:5${index + 3}.000Z`),
        manifest
      };
    });
    const receiptLines = (
      receiptId: string,
      linePrefix: string,
      decision: "PREPARED" | "inactive_applied" | "FORMAL",
      createdMinute: number
    ) => envelopes.map((envelope, index) => ({
      id: `${linePrefix}-line-root-project-${index + 1}`,
      receiptId,
      rowMappingId: envelope.rowMappingId,
      projectId: envelope.projectId,
      lineNo: index + 1,
      amountCents: rootFacts[index]!.amountCents,
      causalOrdinal: index + 1,
      decision,
      entryKind: "historical_wage",
      targetKind: decision === "FORMAL" ? "wage_takeover_projection_envelope" : null,
      targetRef: decision === "FORMAL" ? envelope.id : null,
      reversesLineId: null,
      causesLineId: null,
      causalityFingerprint: fingerprint({
        receiptId,
        mappingId: envelope.rowMappingId,
        causalOrdinal: index + 1,
        causesLineId: null,
        causeLineFingerprint: null
      }),
      lineSnapshot: envelope.rowMapping.readSetSnapshot.legacy,
      createdAt: new Date(`2026-09-04T00:0${createdMinute}:0${index + 1}.000Z`),
      rowMapping: {
        id: envelope.rowMappingId,
        manifestVersionId: envelope.manifestVersionId,
        projectId: envelope.projectId
      }
    }));
    const mappingIds = envelopes.map((envelope) => envelope.rowMappingId);
    const priorCreateCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.create",
      "finance-staff-root",
      0,
      priorScopeId
    );
    const priorApplyCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.apply",
      "finance-staff-root",
      1,
      priorScopeId
    );
    const priorActivationCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.activate",
      "finance-director-root",
      2,
      priorScopeId
    );
    const priorCreateReceipt = {
      id: "create-root-two-projects",
      manifestVersionId: null,
      atomicScopeVersionId: priorScopeId,
      idempotencyKey: "18181818-1818-4181-8181-181818181818",
      action: "historical_wage_takeover.scope.create",
      expectedRevision: 0,
      actorUserId: "finance-staff-root",
      delegatorUserId: null,
      actorSetSnapshot: {
        actualUserId: "finance-staff-root",
        actualRoles: ["finance_staff"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-staff-root"]
      },
      permissionSnapshotFingerprint: priorPermissionFingerprint,
      ...priorCreateCommand,
      status: "prepared",
      resultSnapshot: {
        atomicScopeVersionId: priorScopeId,
        grade: "A",
        status: "prepared",
        projectCount: 2,
        rowCount: 2,
        commandSelectionRef: "hwt1.fixture.two-projects"
      },
      causesReceiptId: null as string | null,
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.create",
        atomicScopeVersionId: priorScopeId,
        commandFingerprint: priorCreateCommand.fingerprint,
        mappings: mappingIds
      }),
      createdTransactionId: 260n,
      createdAt: new Date("2026-09-04T00:01:00.000Z"),
      causedReceipts: [],
      lines: receiptLines("create-root-two-projects", "create", "PREPARED", 1)
    };
    const priorApplyReceipt = {
      ...priorCreateReceipt,
      id: "apply-root-two-projects",
      idempotencyKey: "19191919-1919-4191-8191-191919191919",
      action: "historical_wage_takeover.scope.apply",
      expectedRevision: 1,
      ...priorApplyCommand,
      status: "inactive_applied",
      resultSnapshot: {
        atomicScopeVersionId: priorScopeId,
        grade: "A",
        status: "inactive_applied",
        revision: 2,
        rowCount: 2
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.apply",
        atomicScopeVersionId: priorScopeId,
        commandFingerprint: priorApplyCommand.fingerprint,
        mappings: mappingIds
      }),
      createdTransactionId: 261n,
      createdAt: new Date("2026-09-04T00:02:00.000Z"),
      lines: receiptLines("apply-root-two-projects", "apply", "inactive_applied", 2)
    };
    const priorActivationReceipt = {
      ...priorCreateReceipt,
      id: activationReceiptId,
      idempotencyKey: "20202020-2020-4020-8020-202020202020",
      action: "historical_wage_takeover.scope.activate",
      expectedRevision: 2,
      actorUserId: "finance-director-root",
      actorSetSnapshot: {
        actualUserId: "finance-director-root",
        actualRoles: ["finance_director"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-director-root"]
      },
      ...priorActivationCommand,
      status: "activated",
      resultSnapshot: {
        atomicScopeVersionId: priorScopeId,
        grade: "A",
        status: "activated",
        revision: 3,
        rows: envelopes.map((envelope) => ({
          projectId: envelope.projectId,
          decision: "FORMAL",
          targetKind: "wage_takeover_projection_envelope",
          targetRef: envelope.id
        }))
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.activate",
        atomicScopeVersionId: priorScopeId,
        commandFingerprint: priorActivationCommand.fingerprint,
        mappings: mappingIds
      }),
      createdTransactionId: 262n,
      createdAt: new Date("2026-09-04T00:03:00.000Z"),
      lines: receiptLines(activationReceiptId, "activation", "FORMAL", 3)
    };
    const priorScope = {
      id: priorScopeId,
      scopeKind: "historical_wage",
      authoritySourceRef: priorSourceVersionId,
      authoritySourceFingerprint: priorAuthorityFingerprint,
      sourceClosureFingerprint: priorSourceClosureFingerprint,
      reservedWageStatementVersionId: priorWageStatementVersionId,
      candidateBaselineSha: priorCandidateBaselineSha,
      permissionSnapshotFingerprint: priorPermissionFingerprint,
      readSetFingerprint: priorReadSetFingerprint,
      createdByUserId: "finance-staff-root",
      createdTransactionId: 199n,
      createdAt: new Date("2026-09-04T00:00:00.000Z"),
      projects: priorScopeProjects,
      manifests: priorScopeProjects.map((project) => project.manifest),
      receipts: [priorActivationReceipt, priorCreateReceipt, priorApplyReceipt],
      wageProjectionEnvelopes: envelopes
    };
    const priorReservation = {
      id: priorWageStatementVersionId,
      atomicScopeVersionId: priorScopeId,
      targetWageStatementId,
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "9".repeat(64),
      canonicalRootClosureFingerprint: "a".repeat(64),
      createdAt: new Date("2026-09-04T00:00:00.000Z"),
      mappings: envelopes.map((envelope) => envelope.rowMapping),
      atomicScope: priorScope
    };
    tx.wageTakeoverWageStatementReservation.findUnique.mockImplementation(({ where, select }: PrismaFindUniqueQuery) => Promise.resolve(
      where?.id === priorWageStatementVersionId ? prismaSelect(priorReservation, select) : null
    ));
    tx.operatingTakeoverLegacySourceBridge.findMany.mockImplementation(({ where, select, orderBy }) => Promise.resolve(
      Array.isArray(where?.OR) &&
      where.OR.some((clause: { rowMappingId?: { in?: string[] } }) =>
        clause.rowMappingId?.in?.length === envelopes.length &&
        clause.rowMappingId.in.every((id: string) => envelopes.some((envelope) => envelope.rowMappingId === id))
      ) &&
      where.OR.some((clause: { targetKind?: string; targetRef?: { in?: string[] } }) =>
        clause.targetKind === "wage_takeover_projection_envelope" &&
        clause.targetRef?.in?.length === envelopes.length &&
        clause.targetRef.in.every((id: string) => envelopes.some((envelope) => envelope.id === id))
      )
        ? prismaOrderRows(bridges, orderBy).map((bridge) => prismaSelect(bridge, select))
        : []
    ));
    tx.operatingTakeoverLegacySourceBridge.findFirst.mockImplementation(({ where }) => Promise.resolve(
      bridges.find((bridge) =>
        bridge.projectId === where?.projectId &&
        bridge.sourceType === where?.sourceType &&
        bridge.sourceBusinessId === where?.sourceBusinessId &&
        bridge.sourceVersion === where?.sourceVersion &&
        bridge.sourceFingerprint === where?.sourceFingerprint
      ) ?? null
    ));
    tx.wageTakeoverProjectionEnvelope.findFirst.mockImplementation(({ where }) => Promise.resolve(
      envelopes.find((envelope) => envelope.id === where?.id) ?? null
    ));
    let companyActive = true;
    let employees: Array<{ id: string; name: string; departmentId: string | null }> = [
      { id: "employee-1", name: "张三", departmentId: "department-1" },
      { id: "employee-2", name: "李四", departmentId: "department-2" }
    ];
    let projects = [
      { id: "project-1", code: "P-001", name: "项目一" },
      { id: "project-2", code: "P-002", name: "项目二" }
    ];
    let serviceBasisBindings = [
      {
        id: "service-binding-1",
        projectId: "project-1",
        serviceSnapshotId: "service-1",
        serviceMonth: "2026-08",
        evidenceSha256,
        authorityFingerprint: fingerprint({
          sourceVersionId: currentSource.id,
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          serviceMonth: "2026-08",
          evidenceSha256
        })
      },
      {
        id: "service-binding-2",
        projectId: "project-2",
        serviceSnapshotId: "service-2",
        serviceMonth: "2026-08",
        evidenceSha256,
        authorityFingerprint: fingerprint({
          sourceVersionId: currentSource.id,
          projectId: "project-2",
          serviceSnapshotId: "service-2",
          serviceMonth: "2026-08",
          evidenceSha256
        })
      }
    ];
    let businessPartyVersions: Array<{
      id: string;
      businessPartyId: string;
      versionNo: number;
      snapshot: Record<string, unknown>;
    }> = [
      { id: "party-version-1", businessPartyId: "party-1", versionNo: 1, snapshot: { name: "税务机关", unifiedSocialCreditCode: "913100000000000011" } },
      { id: "party-version-2", businessPartyId: "party-2", versionNo: 2, snapshot: { name: "社保机构", unifiedSocialCreditCode: "913100000000000022" } }
    ];
    const authorityReadOrders = {
      employees: [] as string[][],
      projects: [] as string[][],
      serviceBasisBindings: [] as string[][],
      businessPartyVersions: [] as string[][]
    };
    let reverseAuthorityQueryOrder = true;
    const alternatingRows = <T extends { id: string }>(rows: T[], _callIndex: number, orders: string[][]) => {
      const result = reverseAuthorityQueryOrder ? [...rows].reverse() : [...rows];
      orders.push(result.map((row) => row.id));
      return result;
    };
    let employeeReadCount = 0;
    let projectReadCount = 0;
    let serviceBindingReadCount = 0;
    let businessPartyReadCount = 0;
    Object.assign(tx, {
      companyEntity: {
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          companyActive && where?.id === "company-1" && where?.isActive === true ? { id: "company-1" } : null
        ))
      },
      user: {
        findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          alternatingRows(
            employees.filter((employee) => where?.id?.in?.includes(employee.id) && where?.isActive === true),
            employeeReadCount++,
            authorityReadOrders.employees
          )
        ))
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          alternatingRows(
            projects.filter((project) => where?.id?.in?.includes(project.id) && where?.isActive === true),
            projectReadCount++,
            authorityReadOrders.projects
          )
        ))
      },
      wageServiceBasisBinding: {
        findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          where?.sourceVersionId === currentSource.id
            ? alternatingRows(serviceBasisBindings, serviceBindingReadCount++, authorityReadOrders.serviceBasisBindings)
            : []
        ))
      },
      businessPartyVersion: {
        findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          alternatingRows(
            businessPartyVersions.filter((version) => where?.id?.in?.includes(version.id)),
            businessPartyReadCount++,
            authorityReadOrders.businessPartyVersions
          )
        ))
      }
    });
    tx.operatingTakeoverManifestVersion.create.mockImplementation(({ data }) => Promise.resolve(data));
    tx.operatingTakeoverAtomicScopeProject.create.mockImplementation(({ data }) => Promise.resolve(data));
    tx.operatingTakeoverRowMapping.create.mockImplementation(({ data }) => Promise.resolve(data));

    return {
      ...harness,
      canonicalRootRefs,
      planningAuthorityInput,
      authorityReadOrders,
      priorCanonicalGraphFixture: { envelopes, bridges, priorScope, priorReservation },
      materializationAuthority: {
        removeCompany: () => { companyActive = false; },
        removeEmployee: (id: string) => { employees = employees.filter((employee) => employee.id !== id); },
        mutateEmployee: (id: string, patch: Partial<{ name: string; departmentId: string | null }>) => {
          employees = employees.map((employee) => employee.id === id ? { ...employee, ...patch } : employee);
        },
        mutateProject: (id: string, patch: Partial<{ code: string; name: string }>) => {
          projects = projects.map((project) => project.id === id ? { ...project, ...patch } : project);
        },
        replaceServiceBindingId: (projectId: string, id: string) => {
          serviceBasisBindings = serviceBasisBindings.map((binding) => binding.projectId === projectId ? { ...binding, id } : binding);
        },
        mutateBusinessPartySnapshot: (id: string, snapshot: Record<string, unknown>) => {
          businessPartyVersions = businessPartyVersions.map((version) => version.id === id ? { ...version, snapshot } : version);
        },
        useOppositeQueryOrder: () => { reverseAuthorityQueryOrder = false; }
      },
      setCanonicalRootPayableRefIds: (ids: string[]) => { canonicalRootPayableRefIds = [...ids]; }
    };
  }

  type PublicPriorGraphFixture = ReturnType<typeof setupTwoProjectACorrection>["priorCanonicalGraphFixture"];

  function priorLifecycleReceipt(fixture: PublicPriorGraphFixture, action: string) {
    const receipt = fixture.priorScope.receipts.find((candidate) => candidate.action === action);
    if (!receipt) throw new Error(`missing prior lifecycle receipt: ${action}`);
    return receipt;
  }

  function reversePriorGraphCollections(fixture: PublicPriorGraphFixture) {
    fixture.priorReservation.mappings.reverse();
    fixture.priorScope.projects.reverse();
    fixture.priorScope.manifests.reverse();
    fixture.priorScope.manifests.forEach((manifest) => manifest.rows.reverse());
    fixture.priorScope.receipts.reverse();
    fixture.priorScope.receipts.forEach((receipt) => {
      receipt.lines.reverse();
      receipt.causedReceipts.reverse();
    });
    fixture.priorScope.wageProjectionEnvelopes.reverse();
    fixture.envelopes.forEach((envelope) => {
      envelope.costCells.reverse();
      envelope.payableRefs.reverse();
      envelope.legacyImpactBridges.reverse();
      envelope.eligibilityRevocations.reverse();
    });
    fixture.bridges.reverse();
  }

  function makeManifestIdsOpposeRowOrder(fixture: PublicPriorGraphFixture) {
    const envelopesByRow = [...fixture.envelopes].sort(
      (left, right) => left.rowMapping.rowNo - right.rowMapping.rowNo
    );
    const manifestIds = ["manifest-z", "manifest-a"];

    envelopesByRow.forEach((envelope, index) => {
      const oldManifestVersionId = envelope.manifestVersionId;
      const manifestVersionId = manifestIds[index]!;
      envelope.manifestVersionId = manifestVersionId;
      envelope.manifest.id = manifestVersionId;
      envelope.rowMapping.manifestVersionId = manifestVersionId;

      const scopeProject = fixture.priorScope.projects.find(
        (project) => project.manifestVersionId === oldManifestVersionId
      );
      if (!scopeProject) throw new Error(`missing prior scope project for ${oldManifestVersionId}`);
      scopeProject.manifestVersionId = manifestVersionId;
      scopeProject.manifest.id = manifestVersionId;

      fixture.priorScope.receipts.forEach((receipt) => {
        const receiptLine = receipt.lines.find((line) => line.rowMappingId === envelope.rowMappingId);
        if (receiptLine) receiptLine.rowMapping.manifestVersionId = manifestVersionId;
      });
    });
  }

  const publicPriorGraphDrifts: Array<[string, (fixture: PublicPriorGraphFixture) => void]> = [
    ["atomic scope header rewrite", (fixture) => {
      fixture.priorScope.createdAt = new Date("2026-09-04T00:00:09.000Z");
    }],
    ["scope project membership addition", (fixture) => {
      const project = fixture.priorScope.projects[0]!;
      fixture.priorScope.projects.push({
        ...project,
        id: "scope-project-added-after-signing",
        projectId: "project-added-after-signing",
        manifestVersionId: "manifest-added-after-signing",
        manifest: {
          ...project.manifest,
          id: "manifest-added-after-signing",
          projectId: "project-added-after-signing"
        }
      });
    }],
    ["scope project membership deletion", (fixture) => {
      fixture.priorScope.projects.pop();
    }],
    ["manifest ownership rewrite", (fixture) => {
      fixture.priorScope.projects[0]!.manifest.atomicScopeVersionId = "scope-wrong-owner-after-signing";
    }],
    ["A mapping approved scalar rewrite", (fixture) => {
      fixture.envelopes[0]!.rowMapping.sourceCoordinate = "project_wage:rewritten:1";
    }],
    ["A mapping authorityLineFingerprint rewrite", (fixture) => {
      fixture.envelopes[0]!.rowMapping.authorityLineFingerprint = "0".repeat(64);
    }],
    ["scope-owned orphan manifest append", (fixture) => {
      const manifest = fixture.priorScope.manifests[0]!;
      fixture.priorScope.manifests.push({
        ...manifest,
        id: "manifest-added-after-signing",
        manifestNo: "OT219-prior-project-added-after-signing",
        sourceScopeFingerprint: fingerprint([]),
        manifestFingerprint: "0".repeat(64),
        rows: []
      });
    }],
    ["reservation-and-manifest-owned orphan mapping append", (fixture) => {
      const mapping = fixture.envelopes[0]!.rowMapping;
      const orphan = {
        ...mapping,
        id: "mapping-added-after-signing",
        rowNo: 3,
        sourceBusinessId: "legacy-added-after-signing",
        sourceFingerprint: "0".repeat(64),
        sourceCoordinate: "project_wage:legacy-added-after-signing:1"
      };
      fixture.priorReservation.mappings.push(orphan);
      fixture.priorScope.manifests.find((manifest) => manifest.id === mapping.manifestVersionId)!.rows.push(orphan);
    }],
    ["A mapping fingerprint rewrite", (fixture) => {
      fixture.envelopes[0]!.rowMapping.mappingFingerprint = "0".repeat(64);
    }],
    ["A mapping read-set rewrite", (fixture) => {
      fixture.envelopes[0]!.rowMapping.readSetSnapshot = {
        ...fixture.envelopes[0]!.rowMapping.readSetSnapshot,
        readSetFingerprint: "0".repeat(64)
      };
    }],
    ["A mapping legacy-impact snapshot mismatch", (fixture) => {
      fixture.envelopes[0]!.rowMapping.legacySourceSnapshot = {
        ...fixture.envelopes[0]!.rowMapping.legacySourceSnapshot,
        costImpactSnapshot: { rewritten: true }
      };
    }],
    ["envelope header rewrite", (fixture) => {
      fixture.envelopes[0]!.createdAt = new Date("2026-09-04T00:00:09.000Z");
    }],
    ["envelope FK rewrite", (fixture) => {
      fixture.envelopes[0]!.manifestVersionId = "manifest-wrong-after-signing";
    }],
    ["envelope legacy snapshot rewrite", (fixture) => {
      fixture.envelopes[0]!.legacyImpactSnapshot = {
        ...fixture.envelopes[0]!.legacyImpactSnapshot,
        costImpactSnapshot: { rewritten: true }
      };
    }],
    ["cost child set addition", (fixture) => {
      const cell = fixture.envelopes[0]!.costCells[0]!;
      cell.amountCents = 400n;
      fixture.envelopes[0]!.costCells.push({
        ...cell,
        id: "cost-envelope-added-after-signing",
        costCellId: "cost-cell-added-after-signing",
        amountCents: 600n
      });
    }],
    ["payable child set addition", (fixture) => {
      const payable = fixture.envelopes[0]!.payableRefs[0]!;
      payable.amountCents = 400n;
      fixture.envelopes[0]!.payableRefs.push({
        ...payable,
        id: "payable-envelope-added-after-signing",
        payableRefId: "payable-ref-added-after-signing",
        amountCents: 600n
      });
    }],
    ["legacy-impact bridge set deletion", (fixture) => {
      fixture.envelopes[0]!.legacyImpactBridges.pop();
    }],
    ["generic bridge set deletion", (fixture) => {
      fixture.bridges.pop();
    }],
    ...[
      "historical_wage_takeover.scope.create",
      "historical_wage_takeover.scope.apply",
      "historical_wage_takeover.scope.activate"
    ].flatMap((action) => [
      [`${action} receipt header rewrite`, (fixture: PublicPriorGraphFixture) => {
        const receipt = priorLifecycleReceipt(fixture, action);
        receipt.actorSetSnapshot = {
          ...receipt.actorSetSnapshot,
          actualRoles: ["finance_staff", "finance_director"]
        };
      }],
      [`${action} receipt-line set addition`, (fixture: PublicPriorGraphFixture) => {
        const receipt = priorLifecycleReceipt(fixture, action);
        receipt.lines.push({
          ...receipt.lines[0]!,
          id: `${receipt.id}-line-added-after-signing`
        });
      }]
    ] as Array<[string, (fixture: PublicPriorGraphFixture) => void]>),
    ["eligibility revocation append", (fixture) => {
      const envelope = fixture.envelopes[0]!;
      (envelope.eligibilityRevocations as Array<Record<string, unknown>>).push({
        id: "revocation-added-after-signing",
        envelopeId: envelope.id,
        compensationReceiptId: "compensation-added-after-signing",
        reason: "eligibility changed after signing",
        createdTransactionId: 999n,
        createdAt: new Date("2026-09-04T00:09:00.000Z")
      });
    }],
    ["compensation receipt append", (fixture) => {
      const activation = priorLifecycleReceipt(fixture, "historical_wage_takeover.scope.activate");
      fixture.priorScope.receipts.push({
        ...activation,
        id: "compensation-added-after-signing",
        idempotencyKey: "26262626-2626-4262-8262-262626262626",
        action: "historical_wage_takeover.scope.compensate",
        expectedRevision: 3,
        status: "failed",
        causesReceiptId: activation.id,
        lines: [],
        causedReceipts: []
      });
    }],
    ["activation cause-successor append", (fixture) => {
      const activation = priorLifecycleReceipt(fixture, "historical_wage_takeover.scope.activate");
      (activation.causedReceipts as Array<Record<string, unknown>>).push({
        id: "activation-successor-added-after-signing",
        action: "historical_wage_takeover.scope.activate",
        status: "prepared",
        atomicScopeVersionId: "scope-successor-after-signing",
        causesReceiptId: activation.id
      });
    }]
  ];

  function persistCreatedTwoProjectAScope(tx: ReturnType<typeof setup>["tx"]) {
    const scopeData = tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]![0].data;
    const manifests = tx.operatingTakeoverManifestVersion.create.mock.calls.map((call) => call[0].data);
    const projectLinks = tx.operatingTakeoverAtomicScopeProject.create.mock.calls.map((call) => call[0].data);
    const mappings = tx.operatingTakeoverRowMapping.create.mock.calls.map((call) => call[0].data);
    const reservation = tx.wageTakeoverWageStatementReservation.create.mock.calls[0]![0].data;
    const receipt = tx.operatingTakeoverCommandReceipt.create.mock.calls[0]![0].data;
    const receiptLines = tx.operatingTakeoverCommandReceiptLine.create.mock.calls.map((call) => call[0].data);
    type PersistedScopeFixture = Record<string, unknown> & {
      id: string;
      authoritySourceRef: string;
      authoritySourceFingerprint: string;
      sourceClosureFingerprint: string;
      readSetFingerprint: string;
      projects: Array<{
        projectId: string;
        manifest: Record<string, unknown> & { rows: Array<Record<string, unknown>> };
      }>;
      receipts: Array<Record<string, unknown> & {
        createdAt: Date;
        lines: Array<Record<string, unknown>>;
      }>;
      wageStatementReservation: {
        id: string;
        targetWageStatementId: string;
        expectedCurrentRevision: number;
        reservedRevision: number;
        versionKind: string;
        priorConfirmedVersionId: string | null;
        priorSourceVersionId: string | null;
        sourceDeltaFingerprint: string;
        canonicalRootClosureFingerprint: string;
      };
    };
    const scope = {
      ...scopeData,
      projects: projectLinks.map((link) => ({
        projectId: link.projectId,
        manifest: {
          ...manifests.find((manifest) => manifest.id === link.manifestVersionId)!,
          rows: mappings.filter((mapping) => mapping.manifestVersionId === link.manifestVersionId)
        }
      })),
      historicalSummaryAuthorities: [],
      wageStatementReservation: reservation,
      receipts: [{ ...receipt, lines: receiptLines }]
    } as PersistedScopeFixture;
    tx.operatingTakeoverAtomicScopeVersion.findUnique.mockImplementation(({ where, include }) => {
      if (where?.id !== scope.id) return Promise.resolve(null);
      expect(include).toEqual({
        projects: {
          include: { manifest: { include: { rows: { orderBy: { rowNo: "asc" } } } } }
        },
        historicalSummaryAuthorities: {
          include: {
            attestations: { orderBy: { createdAt: "asc" } },
            payableRefs: { orderBy: { wageCreditorCategoryCode: "asc" } },
            creditorLines: { orderBy: { wageCreditorCategoryCode: "asc" } }
          }
        },
        wageStatementReservation: true,
        receipts: { include: { lines: { orderBy: { lineNo: "asc" } } }, orderBy: { createdAt: "asc" } }
      });
      return Promise.resolve({
        ...scope,
        projects: scope.projects.map((project) => ({
          ...project,
          manifest: {
            ...project.manifest,
            rows: prismaOrderRows(project.manifest.rows, { rowNo: "asc" })
          }
        })),
        receipts: prismaOrderRows(scope.receipts, { createdAt: "asc" }).map((receipt) => ({
          ...receipt,
          lines: prismaOrderRows(receipt.lines, { lineNo: "asc" })
        }))
      });
    });
    return scope;
  }

  it("binds the complete normalized prior canonical graph fingerprint into A selection", async () => {
    const { service, selectionRefs, priorCanonicalGraphFixture } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const firstOption = (await service.options("finance-1", "project-1", now)).options.find((option) => option.grade === "A");
    expect(firstOption).toBeDefined();
    const firstBinding = selectionRefs.read(firstOption!.selectionRef, now);
    expect(firstBinding).toEqual(expect.objectContaining({ grade: "A" }));

    priorCanonicalGraphFixture.priorScope.receipts[0]!.actorSetSnapshot = {
      ...priorCanonicalGraphFixture.priorScope.receipts[0]!.actorSetSnapshot,
      actualRoles: ["finance_director", "finance_staff"]
    };
    const secondOption = (await service.options("finance-1", "project-1", now)).options.find((option) => option.grade === "A");
    expect(secondOption).toBeDefined();
    const secondBinding = selectionRefs.read(secondOption!.selectionRef, now);

    expect(secondBinding).toEqual(expect.objectContaining({
      grade: "A",
      sourceClosureFingerprint: firstBinding && firstBinding.grade === "A"
        ? firstBinding.sourceClosureFingerprint
        : undefined,
      legacyCoordinates: firstBinding?.legacyCoordinates
    }));
    expect(secondBinding?.selectionFingerprint).not.toBe(firstBinding?.selectionFingerprint);
  });

  it("rejects an old A selectionRef after the prior canonical graph changes", async () => {
    const { service, tx, wageStatements, priorCanonicalGraphFixture } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const option = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(option).toBeDefined();

    priorCanonicalGraphFixture.priorScope.receipts[0]!.actorSetSnapshot = {
      ...priorCanonicalGraphFixture.priorScope.receipts[0]!.actorSetSnapshot,
      actualRoles: ["finance_director", "finance_staff"]
    };
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: option!.selectionRef,
        idempotencyKey: "24242424-2424-4242-8242-242424242424",
        expectedRevision: 0,
        businessReason: "拒绝 prior canonical graph 漂移后的旧 selectionRef"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("rejects create when the prior A mapping fingerprint changes after options", async () => {
    const { service, tx, wageStatements, priorCanonicalGraphFixture } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const option = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(option).toBeDefined();
    priorCanonicalGraphFixture.envelopes[0]!.rowMapping.mappingFingerprint = "0".repeat(64);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const failure = await service.createScope("finance-1", {
        selectionRef: option!.selectionRef,
        idempotencyKey: "25252525-2525-4252-8252-252525252525",
        expectedRevision: 0,
        businessReason: "拒绝 options 后漂移的 prior A mapping fingerprint"
      }, new Date("2026-09-04T00:02:00.000Z")).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each(publicPriorGraphDrifts)("public create rejects prior graph drift: %s", async (_label, mutate) => {
    const { service, tx, wageStatements, priorCanonicalGraphFixture } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const option = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(option).toBeDefined();
    mutate(priorCanonicalGraphFixture);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const failure = await service.createScope("finance-1", {
        selectionRef: option!.selectionRef,
        idempotencyKey: "27272727-2727-4272-8272-272727272727",
        expectedRevision: 0,
        businessReason: "public create 必须拒绝 prior canonical graph 漂移"
      }, new Date("2026-09-04T00:02:00.000Z")).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each(publicPriorGraphDrifts)("public apply rejects prior graph drift: %s", async (_label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const harness = await createTwoProjectAScopeForApply("28282828-2828-4282-8282-282828282828");
      const writesAfterCreate = captureTakeoverWrites(harness.tx, harness.wageStatements);
      mutate(harness.priorCanonicalGraphFixture);

      const failure = await harness.service.apply("finance-1", {
        selectionRef: harness.commandSelectionRef,
        idempotencyKey: "29292929-2929-4292-8292-292929292929",
        expectedRevision: 1,
        businessReason: "public apply 必须拒绝 prior canonical graph 漂移"
      }, new Date("2026-09-04T00:03:00.000Z")).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
      expectTakeoverWriteDelta(harness.tx, harness.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each(publicPriorGraphDrifts)("public activate rejects prior graph drift: %s", async (_label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const harness = await createTwoProjectAScopeForActivate();
      const writesAfterApply = captureTakeoverWrites(harness.tx, harness.wageStatements);
      mutate(harness.priorCanonicalGraphFixture);

      const failure = await harness.service.activate("finance-director-1", {
        selectionRef: harness.activationSelectionRef,
        idempotencyKey: "30303030-3030-4030-8030-303030303030",
        expectedRevision: 2,
        businessReason: "public activate 必须拒绝 prior canonical graph 漂移"
      }, new Date("2026-09-04T00:04:00.000Z")).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
      expectTakeoverWriteDelta(harness.tx, harness.wageStatements, writesAfterApply);
      expect(harness.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      expect(harness.tx.wageTakeoverProjectionEnvelope.create).not.toHaveBeenCalled();
      expect(harness.tx.wageTakeoverProjectionEnvelopeCostCell.create).not.toHaveBeenCalled();
      expect(harness.tx.wageTakeoverProjectionEnvelopePayableRef.create).not.toHaveBeenCalled();
      expect(harness.tx.wageTakeoverLegacyImpactBridge.create).not.toHaveBeenCalled();
      expect(harness.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("normalizes the complete two-project prior graph before signing A selection", async () => {
    const { service, selectionRefs, priorCanonicalGraphFixture } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const firstOption = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(firstOption).toBeDefined();
    const firstBinding = selectionRefs.read(firstOption!.selectionRef, now);

    reversePriorGraphCollections(priorCanonicalGraphFixture);

    const secondOption = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(secondOption).toBeDefined();
    const secondBinding = selectionRefs.read(secondOption!.selectionRef, now);
    expect(secondBinding?.selectionFingerprint).toBe(firstBinding?.selectionFingerprint);
  });

  it("accepts public create with the old server-signed option when only prior graph collection order reverses", async () => {
    const { service, selectionRefs, tx, wageStatements, priorCanonicalGraphFixture } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const firstOption = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(firstOption).toBeDefined();
    const firstBinding = selectionRefs.read(firstOption!.selectionRef, now);
    reversePriorGraphCollections(priorCanonicalGraphFixture);
    const reorderedOption = (await service.options("finance-1", "project-1", now)).options.find((candidate) => candidate.grade === "A");
    expect(reorderedOption).toBeDefined();
    expect(selectionRefs.read(reorderedOption!.selectionRef, now)?.selectionFingerprint).toBe(firstBinding?.selectionFingerprint);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: firstOption!.selectionRef,
        idempotencyKey: "31313131-3131-4131-8131-313131313131",
        expectedRevision: 0,
        businessReason: "prior graph 仅集合顺序变化时允许 public create"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "A",
        status: "prepared",
        projectCount: 2,
        rowCount: 2
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectOnlyTakeoverWrites(tx, {
      "operatingTakeoverAtomicScopeVersion.create": 1,
      "wageTakeoverWageStatementReservation.create": 1,
      "operatingTakeoverManifestVersion.create": 2,
      "operatingTakeoverAtomicScopeProject.create": 2,
      "operatingTakeoverRowMapping.create": 2,
      "operatingTakeoverCommandReceipt.create": 1,
      "operatingTakeoverCommandReceiptLine.create": 2,
      "auditLog.create": 1
    });
    expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
  });

  async function createTwoProjectAScopeForApply(
    idempotencyKey: string,
    configurePrior?: (fixture: PublicPriorGraphFixture) => void
  ) {
    const harness = setupTwoProjectACorrection();
    configurePrior?.(harness.priorCanonicalGraphFixture);
    const optionsAt = new Date("2026-09-04T00:01:00.000Z");
    const options = await harness.service.options("finance-1", "project-1", optionsAt);
    const aOption = options.options.find((option) => option.grade === "A");
    expect(aOption).toBeDefined();
    const optionSelectionFingerprint = harness.selectionRefs.read(
      aOption!.selectionRef,
      optionsAt
    )?.selectionFingerprint;
    const created = await harness.service.createScope("finance-1", {
      selectionRef: aOption!.selectionRef,
      idempotencyKey,
      expectedRevision: 0,
      businessReason: "创建 A 级工资接管范围供 inactive apply 校验"
    }, new Date("2026-09-04T00:02:00.000Z"));
    if (
      typeof created !== "object"
      || created === null
      || !("commandSelectionRef" in created)
      || typeof created.commandSelectionRef !== "string"
    ) {
      throw new Error("expected createScope to return a prepared command selectionRef");
    }
    const commandSelectionRef = created.commandSelectionRef;
    const scope = persistCreatedTwoProjectAScope(harness.tx);
    return { ...harness, created, commandSelectionRef, optionSelectionFingerprint, scope };
  }

  function persistLatestScopeReceipt(
    tx: ReturnType<typeof setup>["tx"],
    scope: { receipts: Array<Record<string, unknown>> },
    firstReceiptLineCallIndex: number
  ) {
    const receiptData = tx.operatingTakeoverCommandReceipt.create.mock.calls.at(-1)![0].data;
    const lines = tx.operatingTakeoverCommandReceiptLine.create.mock.calls
      .slice(firstReceiptLineCallIndex)
      .map((call) => call[0].data);
    const receipt = { ...receiptData, lines };
    scope.receipts.push(receipt);
    return receipt;
  }

  async function createTwoProjectAScopeForActivate(
    configurePrior?: (fixture: PublicPriorGraphFixture) => void
  ) {
    const harness = await createTwoProjectAScopeForApply(
      "61616161-6161-4161-8161-616161616161",
      configurePrior
    );
    harness.roles.resolveActiveRoleScopesInTransaction.mockImplementation(
      (_tx: unknown, actorUserId: string) => Promise.resolve(
        actorUserId === "finance-director-1" ? ["finance_director"] : ["finance_staff"]
      )
    );
    const renewed = await harness.service.issueScopedCommandSelection("finance-director-1", {
      selectionRef: harness.commandSelectionRef
    }, new Date("2026-09-04T00:02:30.000Z"));
    if (typeof renewed.commandSelectionRef !== "string") {
      throw new Error("expected a scoped activation selectionRef for the independent director");
    }
    const firstApplyReceiptLineCallIndex = harness.tx.operatingTakeoverCommandReceiptLine.create.mock.calls.length;
    const applied = await harness.service.apply("finance-1", {
      selectionRef: harness.commandSelectionRef,
      idempotencyKey: "62626262-6262-4262-8262-626262626262",
      expectedRevision: 1,
      businessReason: "完成 A 级 inactive apply 后等待独立激活"
    }, new Date("2026-09-04T00:03:00.000Z"));
    expect(applied).toEqual({
      atomicScopeVersionId: harness.scope.id,
      grade: "A",
      status: "inactive_applied",
      revision: 2,
      rowCount: 2
    });
    persistLatestScopeReceipt(harness.tx, harness.scope, firstApplyReceiptLineCallIndex);
    return {
      ...harness,
      activationSelectionRef: renewed.commandSelectionRef
    };
  }

  function setupPriorCanonicalGraphProof() {
    const harness = setup();
    const scopeId = "scope-prior-graph";
    const reservationId = "wage-version-prior-graph";
    const manifestId = "manifest-prior-graph";
    const mappingId = "mapping-prior-graph";
    const envelopeId = "envelope-prior-graph";
    const projectId = "project-1";
    const legacySourceFingerprint = "2".repeat(64);
    const canonicalFingerprint = "1".repeat(64);
    const costImpactSnapshot = { impactKind: "confirmed_cost", sourceImpactKey: "cost" };
    const payableImpactSnapshot = { impactKind: "payable_increase", sourceImpactKey: "payable" };
    const impactFingerprint = (legacyImpactEntryId: string, impactKind: string, impactSnapshot: unknown) => fingerprint({
      legacySourceFingerprint,
      legacyImpactEntryId,
      impactKind,
      direction: "increase",
      amountCents: 1000n,
      impactSnapshot
    });
    const authoritySourceFingerprint = "d".repeat(64);
    const sourceClosureFingerprint = "c".repeat(64);
    const permissionSnapshotFingerprint = "7".repeat(64);
    const readSetFingerprint = "e".repeat(64);
    const candidateBaselineSha = "f".repeat(40);
    const legacyReadSetValue = {
      factId: "fact-prior-graph",
      projectId,
      sourceType: "project_wage",
      sourceBusinessId: "legacy-prior-graph",
      sourceVersion: 1,
      sourceFingerprint: legacySourceFingerprint,
      legacyWageMonth: "2026-08",
      employmentCompanyId: "company-1",
      amountCents: "1000",
      entryKind: "original",
      direction: "increase",
      adjustsFactId: null,
      adjustmentRoot: null,
      costImpactId: "impact-cost-prior-graph",
      payableImpactId: "impact-payable-prior-graph"
    };
    const frozenPlanReadSet = {
      grade: "A",
      sourceVersionId: "approved-source-prior-graph",
      sourceFingerprint: authoritySourceFingerprint,
      sourceClosureFingerprint,
      projectIds: [projectId]
    };
    const manifestOwner = { id: manifestId, atomicScopeVersionId: scopeId, projectId };
    const mappingOwner = {
      id: mappingId,
      manifestVersionId: manifestId,
      projectId,
      rowNo: 1,
      adapterKind: "historical_wage",
      sourceType: "project_wage",
      sourceBusinessId: "legacy-prior-graph",
      sourceVersion: 1,
      sourceFingerprint: legacySourceFingerprint,
      sourceCoordinate: "project_wage:legacy-prior-graph:1",
      normalizedRowHash: fingerprint(legacyReadSetValue),
      amountCents: 1000n,
      evidenceLevel: "A",
      coverageKind: null,
      coverageKey: null,
      periodStart: null,
      entryKind: "formal",
      mappingDecision: "FORMAL",
      conflictGroupKey: "wage:project-1:approved-source-prior-graph",
      adjustmentTargetRef: null,
      sourceDiscriminator: "wage_statement_version",
      governedSubjectKey: null,
      authorityCategory: null,
      authoritySnapshotRef: null,
      authorityFingerprint: null,
      authorityVersionId: null,
      authorityLineId: null,
      authorityLineFingerprint: null as string | null,
      obligationId: null,
      authoritativeGrossCapCents: null,
      currencyCode: null,
      wageApprovedSourceVersionId: "approved-source-prior-graph",
      wageStatementReservationId: reservationId,
      historicalWageSummaryAuthorityVersionId: null,
      authoritySnapshot: {},
      legacySourceSnapshot: {
        ...legacyReadSetValue,
        costImpactSnapshot,
        costImpactFingerprint: impactFingerprint("impact-cost-prior-graph", "confirmed_cost", costImpactSnapshot),
        payableImpactSnapshot,
        payableImpactFingerprint: impactFingerprint("impact-payable-prior-graph", "payable_increase", payableImpactSnapshot),
        businessReason: "历史工资 prior graph fixture",
        evidenceRefs: []
      },
      readSetSnapshot: {
        readSetFingerprint,
        plan: frozenPlanReadSet,
        legacy: legacyReadSetValue
      },
      mappingFingerprint: fingerprint({
        scopeId,
        projectId,
        plan: frozenPlanReadSet,
        legacy: legacyReadSetValue
      }),
      createdAt: new Date("2026-09-04T00:02:03.000Z")
    };
    const reservationOwner = { id: reservationId, atomicScopeVersionId: scopeId };
    const envelope = {
      id: envelopeId,
      atomicScopeVersionId: scopeId,
      manifestVersionId: manifestId,
      rowMappingId: mappingId,
      wageStatementVersionId: reservationId,
      projectId,
      legacySourceType: "project_wage",
      legacySourceBusinessId: "legacy-prior-graph",
      legacySourceVersion: 1,
      legacySourceFingerprint,
      legacyImpactSnapshot: {
        factId: "fact-prior-graph",
        costImpactId: "impact-cost-prior-graph",
        costImpactSnapshot,
        costImpactFingerprint: impactFingerprint("impact-cost-prior-graph", "confirmed_cost", costImpactSnapshot),
        payableImpactId: "impact-payable-prior-graph",
        payableImpactSnapshot,
        payableImpactFingerprint: impactFingerprint("impact-payable-prior-graph", "payable_increase", payableImpactSnapshot)
      },
      projectionOrigin: "historical_takeover_legacy_link",
      deltaDirection: "increase",
      canonicalFingerprint,
      createdTransactionId: 101n,
      createdAt: new Date("2026-09-04T00:03:00.000Z"),
      manifest: manifestOwner,
      rowMapping: mappingOwner,
      reservation: reservationOwner,
      costCells: [{
        id: "envelope-cost-prior-graph",
        envelopeId,
        costCellId: "cost-cell-prior-graph",
        direction: "increase",
        amountCents: 1000n
      }],
      payableRefs: [{
        id: "envelope-payable-prior-graph",
        envelopeId,
        payableRefId: "payable-ref-prior-graph",
        direction: "increase",
        amountCents: 1000n
      }],
      legacyImpactBridges: [
        {
          id: "impact-bridge-cost-prior-graph",
          envelopeId,
          summaryAuthorityVersionId: null,
          rowMappingId: mappingId,
          projectId,
          legacyImpactEntryId: "impact-cost-prior-graph",
          impactKind: "confirmed_cost",
          direction: "increase",
          amountCents: 1000n,
          sourceFingerprint: impactFingerprint("impact-cost-prior-graph", "confirmed_cost", costImpactSnapshot),
          createdTransactionId: 102n,
          createdAt: new Date("2026-09-04T00:03:01.000Z")
        },
        {
          id: "impact-bridge-payable-prior-graph",
          envelopeId,
          summaryAuthorityVersionId: null,
          rowMappingId: mappingId,
          projectId,
          legacyImpactEntryId: "impact-payable-prior-graph",
          impactKind: "payable_increase",
          direction: "increase",
          amountCents: 1000n,
          sourceFingerprint: impactFingerprint("impact-payable-prior-graph", "payable_increase", payableImpactSnapshot),
          createdTransactionId: 103n,
          createdAt: new Date("2026-09-04T00:03:02.000Z")
        }
      ],
      eligibilityRevocations: [] as Array<Record<string, unknown>>
    };
    const activationLine = {
      id: "activation-line-prior-graph",
      receiptId: "activation-receipt-prior-graph",
      rowMappingId: mappingId,
      lineNo: 1,
      decision: "FORMAL",
      entryKind: "historical_wage",
      amountCents: 1000n,
      targetKind: "wage_takeover_projection_envelope",
      targetRef: envelopeId,
      projectId,
      causalOrdinal: 1,
      reversesLineId: null,
      causesLineId: null,
      causalityFingerprint: fingerprint({
        receiptId: "activation-receipt-prior-graph",
        mappingId,
        causalOrdinal: 1,
        causesLineId: null,
        causeLineFingerprint: null
      }),
      lineSnapshot: legacyReadSetValue,
      createdAt: new Date("2026-09-04T00:04:01.000Z"),
      rowMapping: mappingOwner
    };
    const createLine = {
      ...activationLine,
      id: "create-line-prior-graph",
      receiptId: "create-receipt-prior-graph",
      decision: "PREPARED",
      targetKind: null,
      targetRef: null,
      causalityFingerprint: fingerprint({
        receiptId: "create-receipt-prior-graph",
        mappingId,
        causalOrdinal: 1,
        causesLineId: null,
        causeLineFingerprint: null
      }),
      createdAt: new Date("2026-09-04T00:02:11.000Z")
    };
    const applyLine = {
      ...activationLine,
      id: "apply-line-prior-graph",
      receiptId: "apply-receipt-prior-graph",
      decision: "inactive_applied",
      targetKind: null,
      targetRef: null,
      causalityFingerprint: fingerprint({
        receiptId: "apply-receipt-prior-graph",
        mappingId,
        causalOrdinal: 1,
        causesLineId: null,
        causeLineFingerprint: null
      }),
      createdAt: new Date("2026-09-04T00:03:11.000Z")
    };
    const activationCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.activate",
      "finance-director-1",
      2,
      scopeId
    );
    const createCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.create",
      "finance-staff-1",
      0,
      scopeId
    );
    const applyCommand = receiptCommandEvidence(
      "historical_wage_takeover.scope.apply",
      "finance-staff-1",
      1,
      scopeId
    );
    const activation = {
      id: "activation-receipt-prior-graph",
      manifestVersionId: null,
      atomicScopeVersionId: scopeId,
      idempotencyKey: "81818181-8181-4181-8181-818181818181",
      action: "historical_wage_takeover.scope.activate",
      expectedRevision: 2,
      actorUserId: "finance-director-1",
      delegatorUserId: null,
      actorSetSnapshot: {
        actualUserId: "finance-director-1",
        actualRoles: ["finance_director"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-director-1"]
      },
      permissionSnapshotFingerprint,
      ...activationCommand,
      status: "activated",
      resultSnapshot: {
        atomicScopeVersionId: scopeId,
        grade: "A",
        status: "activated",
        revision: 3,
        rows: [{
          projectId,
          decision: "FORMAL",
          targetKind: "wage_takeover_projection_envelope",
          targetRef: envelopeId
        }]
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.activate",
        atomicScopeVersionId: scopeId,
        commandFingerprint: activationCommand.fingerprint,
        mappings: [mappingId]
      }),
      createdTransactionId: 104n,
      causesReceiptId: "activation-receipt-root-graph",
      createdAt: new Date("2026-09-04T00:04:00.000Z"),
      lines: [activationLine],
      causedReceipts: [] as Array<Record<string, unknown>>
    };
    const createReceipt = {
      id: "create-receipt-prior-graph",
      manifestVersionId: null,
      atomicScopeVersionId: scopeId,
      idempotencyKey: "61616161-6161-4161-8161-616161616161",
      action: "historical_wage_takeover.scope.create",
      expectedRevision: 0,
      actorUserId: "finance-staff-1",
      delegatorUserId: null,
      actorSetSnapshot: {
        actualUserId: "finance-staff-1",
        actualRoles: ["finance_staff"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-staff-1"]
      },
      permissionSnapshotFingerprint,
      ...createCommand,
      status: "prepared",
      resultSnapshot: {
        atomicScopeVersionId: scopeId,
        grade: "A",
        status: "prepared",
        projectCount: 1,
        rowCount: 1,
        commandSelectionRef: "hwt1.fixture.prior.graph"
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.create",
        atomicScopeVersionId: scopeId,
        commandFingerprint: createCommand.fingerprint,
        mappings: [mappingId]
      }),
      createdTransactionId: 106n,
      causesReceiptId: null,
      createdAt: new Date("2026-09-04T00:02:10.000Z"),
      lines: [createLine],
      causedReceipts: [] as Array<Record<string, unknown>>
    };
    const applyReceipt = {
      id: "apply-receipt-prior-graph",
      manifestVersionId: null,
      atomicScopeVersionId: scopeId,
      idempotencyKey: "71717171-7171-4171-8171-717171717171",
      action: "historical_wage_takeover.scope.apply",
      expectedRevision: 1,
      actorUserId: "finance-staff-1",
      delegatorUserId: null,
      actorSetSnapshot: {
        actualUserId: "finance-staff-1",
        actualRoles: ["finance_staff"],
        delegatorUserId: null,
        delegatorRoles: null,
        actorIds: ["finance-staff-1"]
      },
      permissionSnapshotFingerprint,
      ...applyCommand,
      status: "inactive_applied",
      resultSnapshot: {
        atomicScopeVersionId: scopeId,
        grade: "A",
        status: "inactive_applied",
        revision: 2,
        rowCount: 1
      },
      causalityFingerprint: fingerprint({
        action: "historical_wage_takeover.scope.apply",
        atomicScopeVersionId: scopeId,
        commandFingerprint: applyCommand.fingerprint,
        mappings: [mappingId]
      }),
      createdTransactionId: 107n,
      causesReceiptId: null,
      createdAt: new Date("2026-09-04T00:03:10.000Z"),
      lines: [applyLine],
      causedReceipts: [] as Array<Record<string, unknown>>
    };
    const genericBridge = {
      id: "legacy-bridge-prior-graph",
      projectId,
      rowMappingId: mappingId,
      sourceType: "project_wage",
      sourceBusinessId: "legacy-prior-graph",
      sourceVersion: 1,
      sourceFingerprint: legacySourceFingerprint,
      targetKind: "wage_takeover_projection_envelope",
      targetRef: envelopeId,
      targetFingerprint: fingerprint({
        targetKind: "wage_takeover_projection_envelope",
        targetRef: envelopeId,
        canonicalFingerprint,
        sourceFingerprint: legacySourceFingerprint
      }),
      mappingDecision: "FORMAL",
      createdByUserId: "finance-director-1",
      createdTransactionId: 105n,
      createdAt: new Date("2026-09-04T00:04:02.000Z")
    };
    const genericBridges = [genericBridge];
    const scopeManifest = {
      id: manifestId,
      projectId,
      atomicScopeVersionId: scopeId,
      adapterKind: "historical_wage",
      manifestNo: "OT219-prior-project",
      version: 1,
      status: "prepared",
      sourceScopeFingerprint: fingerprint([legacyReadSetValue]),
      mapperName: "historical_wage_takeover",
      mapperVersion: 1,
      schemaVersion: 1,
      candidateBaselineSha,
      permissionSnapshotFingerprint,
      readSetFingerprint,
      manifestFingerprint: fingerprint({
        scopeId,
        projectId,
        plan: frozenPlanReadSet,
        rows: [legacyReadSetValue]
      }),
      createdByUserId: "finance-staff-1",
      createdAt: new Date("2026-09-04T00:02:01.000Z"),
      rows: [mappingOwner]
    };
    const scopeProject = {
      id: "scope-project-prior-graph",
      atomicScopeVersionId: scopeId,
      projectId,
      manifestVersionId: manifestId,
      createdTransactionId: 108n,
      createdAt: new Date("2026-09-04T00:02:02.000Z"),
      manifest: scopeManifest
    };
    const reservation = {
      id: reservationId,
      atomicScopeVersionId: scopeId,
      targetWageStatementId: "statement-prior-graph",
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind: "correction",
      priorConfirmedVersionId: "wage-version-root-graph",
      priorSourceVersionId: "approved-source-root-graph",
      sourceDeltaFingerprint: "a".repeat(64),
      canonicalRootClosureFingerprint: "b".repeat(64),
      createdAt: new Date("2026-09-04T00:02:00.000Z"),
      atomicScope: {
        id: scopeId,
        scopeKind: "historical_wage",
        authoritySourceRef: "approved-source-prior-graph",
        authoritySourceFingerprint,
        sourceClosureFingerprint,
        reservedWageStatementVersionId: reservationId,
        candidateBaselineSha,
        permissionSnapshotFingerprint,
        readSetFingerprint,
        createdByUserId: "finance-staff-1",
        createdTransactionId: 100n,
        createdAt: new Date("2026-09-04T00:01:59.000Z"),
        projects: [scopeProject],
        manifests: [scopeManifest],
        receipts: [activation, createReceipt, applyReceipt],
        wageProjectionEnvelopes: [envelope]
      },
      mappings: [mappingOwner]
    };
    const plan = {
      targetWageStatementId: reservation.targetWageStatementId,
      expectedCurrentRevision: 2,
      reservedRevision: 3,
      versionKind: "correction" as const,
      priorConfirmedVersionId: reservationId,
      priorSourceVersionId: "approved-source-prior-graph",
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: ["root-ref-prior-graph"],
      projects: [{ projectId, signedCostDeltaCents: "-100", signedPayableDeltaCents: "-100" }]
    };
    harness.tx.wageTakeoverWageStatementReservation.findUnique.mockImplementation(({ where, select }: PrismaFindUniqueQuery) => Promise.resolve(
      where?.id === reservationId ? prismaSelect(reservation, select) : null
    ));
    harness.tx.operatingTakeoverLegacySourceBridge.findMany.mockImplementation(() => Promise.resolve(genericBridges));
    const prove = () => (harness.service as never as {
      proveHistoricalPriorVersionEligibility: (client: unknown, value: unknown) => Promise<unknown>;
    }).proveHistoricalPriorVersionEligibility(harness.tx, plan);
    return {
      ...harness,
      plan,
      reservation,
      envelope,
      activation,
      activationLine,
      createReceipt,
      createLine,
      applyReceipt,
      applyLine,
      scopeProject,
      scopeManifest,
      mappingOwner,
      genericBridge,
      genericBridges,
      prove
    };
  }

  it("keeps a two-project A correction authoritative when canonical root payable refs differ only by envelope traversal order", async () => {
    const { service, tx, wageStatements, planningAuthorityInput } = setupTwoProjectACorrection();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const options = await service.options("finance-1", "project-1", now);
    const aOption = options.options.find((option) => option.grade === "A");

    expect(aOption).toBeDefined();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: aOption!.selectionRef,
        idempotencyKey: "29292929-2929-4292-8292-292929292929",
        expectedRevision: 0,
        businessReason: "按完整跨项目 canonical root 集合建立历史工资更正范围"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "A",
        status: "prepared",
        projectCount: 2,
        rowCount: 2
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    const directPreflightCalls = wageStatements.planHistoricalTakeoverInTransaction.mock.calls.filter(([, input]) =>
      !Object.prototype.hasOwnProperty.call(input, "reservedTargetWageStatementId")
    );
    expect(directPreflightCalls).toEqual([
      [tx, planningAuthorityInput],
      [tx, planningAuthorityInput]
    ]);
    expectOnlyTakeoverWrites(tx, {
      "operatingTakeoverAtomicScopeVersion.create": 1,
      "wageTakeoverWageStatementReservation.create": 1,
      "operatingTakeoverManifestVersion.create": 2,
      "operatingTakeoverAtomicScopeProject.create": 2,
      "operatingTakeoverRowMapping.create": 2,
      "operatingTakeoverCommandReceipt.create": 1,
      "operatingTakeoverCommandReceiptLine.create": 2,
      "auditLog.create": 1
    });
    const scopeData = tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]![0].data;
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "finance-1",
        action: "operating_takeover.historical_wage.scope.create",
        businessType: "operating_takeover_atomic_scope",
        businessId: scopeData.id,
        metadata: {
          grade: "A",
          projectCount: 2,
          rowCount: 2,
          readSetFingerprint: scopeData.readSetFingerprint
        }
      }
    });
    expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    expect(tx.wageStatementVersion.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelope.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelopeCostCell.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelopePayableRef.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverLegacyImpactBridge.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
    expect(tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
  });

  async function expectTwoProjectACorrectionCanonicalDrift(
    idempotencyKey: string,
    mutate: (refs: { project1: string; project2: string }) => string[]
  ) {
    const { service, tx, wageStatements, canonicalRootRefs, setCanonicalRootPayableRefIds } = setupTwoProjectACorrection();
    const options = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    const aOption = options.options.find((option) => option.grade === "A");
    expect(aOption).toBeDefined();
    setCanonicalRootPayableRefIds(mutate(canonicalRootRefs));

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    let failure: unknown;
    try {
      failure = await service.createScope("finance-1", {
        selectionRef: aOption!.selectionRef,
        idempotencyKey,
        expectedRevision: 0,
        businessReason: "拒绝 canonical root 成员集合漂移"
      }, new Date("2026-09-04T00:02:00.000Z")).catch((error: unknown) => error);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getStatus()).toBe(409);
    expectNoTakeoverWrites(tx, wageStatements);
  }

  it("rejects a two-project A correction when the canonical root set gains a member after options", async () => {
    await expectTwoProjectACorrectionCanonicalDrift(
      "30303030-3030-4030-8030-303030303030",
      ({ project1, project2 }) => [project2, project1, "root-extra-project-3"]
    );
  });

  it("rejects a two-project A correction when the canonical root set loses a covered member after options", async () => {
    await expectTwoProjectACorrectionCanonicalDrift(
      "31313131-3131-4131-8131-313131313131",
      ({ project2 }) => [project2]
    );
  });

  it("rejects a two-project A correction when the canonical root set replaces a member at equal cardinality after options", async () => {
    await expectTwoProjectACorrectionCanonicalDrift(
      "32323232-3232-4232-8232-323232323232",
      ({ project2 }) => [project2, "root-replacement-project-1"]
    );
  });

  async function expectAMaterializationAuthorityDrift(
    idempotencyKey: string,
    mutate: (authority: ReturnType<typeof setupTwoProjectACorrection>["materializationAuthority"]) => void
  ) {
    const { service, tx, wageStatements, materializationAuthority } = setupTwoProjectACorrection();
    const options = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    const aOption = options.options.find((option) => option.grade === "A");
    expect(aOption).toBeDefined();
    mutate(materializationAuthority);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    let failure: unknown;
    try {
      failure = await service.createScope("finance-1", {
        selectionRef: aOption!.selectionRef,
        idempotencyKey,
        expectedRevision: 0,
        businessReason: "拒绝 A 级工资物化权威 read-set 漂移"
      }, new Date("2026-09-04T00:02:00.000Z")).catch((error: unknown) => error);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getStatus()).toBe(409);
    expectNoTakeoverWrites(tx, wageStatements);
  }

  it("rejects create when the A materialization company active row disappears after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "33333333-3333-4333-8333-333333333333",
      (authority) => authority.removeCompany()
    );
  });

  it("rejects create when an A materialization employee active row disappears after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "34343434-3434-4434-8434-343434343434",
      (authority) => authority.removeEmployee("employee-2")
    );
  });

  it("rejects create when an A materialization employee name drifts after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "35353535-3535-4535-8535-353535353535",
      (authority) => authority.mutateEmployee("employee-2", { name: "李四（已变更）" })
    );
  });

  it("rejects create when an A materialization employee departmentId drifts after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "36363636-3636-4636-8636-363636363636",
      (authority) => authority.mutateEmployee("employee-2", { departmentId: "department-3" })
    );
  });

  it("rejects create when an A materialization project code drifts after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "37373737-3737-4737-8737-373737373737",
      (authority) => authority.mutateProject("project-2", { code: "P-002-CHANGED" })
    );
  });

  it("rejects create when an A materialization project name drifts after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "38383838-3838-4838-8838-383838383838",
      (authority) => authority.mutateProject("project-2", { name: "项目二（已变更）" })
    );
  });

  it("rejects create when an A materialization service binding changes to another valid id after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "39393939-3939-4939-8939-393939393939",
      (authority) => authority.replaceServiceBindingId("project-2", "service-binding-2-replaced")
    );
  });

  it("rejects create when an A materialization business party version snapshot drifts under the same id after options", async () => {
    await expectAMaterializationAuthorityDrift(
      "40404040-4040-4040-8040-404040404040",
      (authority) => authority.mutateBusinessPartySnapshot("party-version-2", {
        name: "社保机构（已变更）",
        unifiedSocialCreditCode: "913100000000000022"
      })
    );
  });

  it("normalizes the complete A materialization authority read-set across reversed options and create query order", async () => {
    const {
      service,
      tx,
      wageStatements,
      planningAuthorityInput,
      authorityReadOrders,
      materializationAuthority
    } = setupTwoProjectACorrection();
    const options = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    const aOption = options.options.find((option) => option.grade === "A");
    expect(aOption).toBeDefined();
    materializationAuthority.useOppositeQueryOrder();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    let created: Awaited<ReturnType<typeof service.createScope>>;
    try {
      created = await service.createScope("finance-1", {
        selectionRef: aOption!.selectionRef,
        idempotencyKey: "41414141-4141-4141-8141-414141414141",
        expectedRevision: 0,
        businessReason: "冻结完整 A 级工资物化权威 read-set"
      }, new Date("2026-09-04T00:02:00.000Z"));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(created).toEqual(expect.objectContaining({
      grade: "A",
      status: "prepared",
      projectCount: 2,
      rowCount: 2
    }));
    for (const orders of Object.values(authorityReadOrders)) {
      expect(orders.length).toBeGreaterThanOrEqual(2);
      expect(orders[0]).toEqual([...orders.at(-1)!].reverse());
    }
    const expectedMaterializationAuthorityReadSet = {
      schemaVersion: 1,
      employmentCompany: { id: "company-1" },
      employees: [
        { id: "employee-1", name: "张三", departmentId: "department-1" },
        { id: "employee-2", name: "李四", departmentId: "department-2" }
      ],
      projects: [
        { id: "project-1", code: "P-001", name: "项目一" },
        { id: "project-2", code: "P-002", name: "项目二" }
      ],
      serviceBasisBindings: [
        {
          id: "service-binding-1",
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          serviceMonth: "2026-08",
          evidenceSha256: "c".repeat(64),
          authorityFingerprint: fingerprint({
            sourceVersionId: planningAuthorityInput.sourceVersionId,
            projectId: "project-1",
            serviceSnapshotId: "service-1",
            serviceMonth: "2026-08",
            evidenceSha256: "c".repeat(64)
          })
        },
        {
          id: "service-binding-2",
          projectId: "project-2",
          serviceSnapshotId: "service-2",
          serviceMonth: "2026-08",
          evidenceSha256: "c".repeat(64),
          authorityFingerprint: fingerprint({
            sourceVersionId: planningAuthorityInput.sourceVersionId,
            projectId: "project-2",
            serviceSnapshotId: "service-2",
            serviceMonth: "2026-08",
            evidenceSha256: "c".repeat(64)
          })
        }
      ],
      businessPartyVersions: [
        { id: "party-version-1", businessPartyId: "party-1", versionNo: 1, snapshot: { name: "税务机关", unifiedSocialCreditCode: "913100000000000011" } },
        { id: "party-version-2", businessPartyId: "party-2", versionNo: 2, snapshot: { name: "社保机构", unifiedSocialCreditCode: "913100000000000022" } }
      ]
    };
    for (const call of tx.operatingTakeoverRowMapping.create.mock.calls) {
      expect(call[0].data.readSetSnapshot.plan.materializationAuthorityReadSet)
        .toEqual(expectedMaterializationAuthorityReadSet);
    }
    const directPreflightCalls = wageStatements.planHistoricalTakeoverInTransaction.mock.calls.filter(([, input]) =>
      !Object.prototype.hasOwnProperty.call(input, "reservedTargetWageStatementId")
    );
    expect(directPreflightCalls).toEqual([
      [tx, planningAuthorityInput],
      [tx, planningAuthorityInput]
    ]);
    expectOnlyTakeoverWrites(tx, {
      "operatingTakeoverAtomicScopeVersion.create": 1,
      "wageTakeoverWageStatementReservation.create": 1,
      "operatingTakeoverManifestVersion.create": 2,
      "operatingTakeoverAtomicScopeProject.create": 2,
      "operatingTakeoverRowMapping.create": 2,
      "operatingTakeoverCommandReceipt.create": 1,
      "operatingTakeoverCommandReceiptLine.create": 2,
      "auditLog.create": 1
    });
    expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    const scopeData = tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]![0].data;
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "finance-1",
        action: "operating_takeover.historical_wage.scope.create",
        businessType: "operating_takeover_atomic_scope",
        businessId: scopeData.id,
        metadata: {
          grade: "A",
          projectCount: 2,
          rowCount: 2,
          readSetFingerprint: scopeData.readSetFingerprint
        }
      }
    });
  });

  it("rejects A apply when the materialization company active row disappears after create", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const { service, tx, wageStatements, commandSelectionRef, materializationAuthority } =
        await createTwoProjectAScopeForApply("42424242-4242-4242-8242-424242424242");
      const writesAfterCreate = captureTakeoverWrites(tx, wageStatements);
      materializationAuthority.removeCompany();

      const failure = await service.apply("finance-1", {
        selectionRef: commandSelectionRef,
        idempotencyKey: "43434343-4343-4343-8343-434343434343",
        expectedRevision: 1,
        businessReason: "拒绝 create 后失效的工资承担公司"
      }, new Date("2026-09-04T00:03:00.000Z")).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
      expectTakeoverWriteDelta(tx, wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each([
    ["employee active row disappears", "employee_missing", "44444444-4444-4444-8444-444444444444", "拒绝 create 后失效的工资人员"],
    ["employee name drifts", "employee_name", "45454545-4545-4545-8545-454545454545", "拒绝 create 后变化的工资人员姓名快照"],
    ["employee departmentId drifts", "employee_department", "46464646-4646-4646-8646-464646464646", "拒绝 create 后变化的工资人员部门快照"],
    ["project code drifts", "project_code", "47474747-4747-4747-8747-474747474747", "拒绝 create 后变化的工资项目编码快照"],
    ["project name drifts", "project_name", "48484848-4848-4848-8848-484848484848", "拒绝 create 后变化的工资项目名称快照"],
    ["service binding changes to another valid id", "service_binding", "49494949-4949-4949-8949-494949494949", "拒绝 create 后替换的工资服务依据绑定"],
    ["business party snapshot drifts under the same id", "business_party", "50505050-5050-4050-8050-505050505050", "拒绝 create 后变化的债权主体版本快照"]
  ] as const)("rejects A apply when the materialization %s after create", async (_label, drift, idempotencyKey, businessReason) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const { service, tx, wageStatements, commandSelectionRef, materializationAuthority } =
        await createTwoProjectAScopeForApply(idempotencyKey.replace(/^./u, "6"));
      const writesAfterCreate = captureTakeoverWrites(tx, wageStatements);
      switch (drift) {
        case "employee_missing":
          materializationAuthority.removeEmployee("employee-1");
          break;
        case "employee_name":
          materializationAuthority.mutateEmployee("employee-1", { name: "张三（变更）" });
          break;
        case "employee_department":
          materializationAuthority.mutateEmployee("employee-1", { departmentId: "department-9" });
          break;
        case "project_code":
          materializationAuthority.mutateProject("project-1", { code: "P-001-CHANGED" });
          break;
        case "project_name":
          materializationAuthority.mutateProject("project-1", { name: "项目一（变更）" });
          break;
        case "service_binding":
          materializationAuthority.replaceServiceBindingId("project-1", "service-binding-1-replacement");
          break;
        case "business_party":
          materializationAuthority.mutateBusinessPartySnapshot("party-version-1", {
            name: "税务机关（变更）",
            unifiedSocialCreditCode: "913100000000000011"
          });
          break;
      }

      const failure = await service.apply("finance-1", {
        selectionRef: commandSelectionRef,
        idempotencyKey,
        expectedRevision: 1,
        businessReason
      }, new Date("2026-09-04T00:03:00.000Z")).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
      expectTakeoverWriteDelta(tx, wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("accepts A apply when prior graph collections and materialization authority query order reverse after create", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const {
        service,
        tx,
        wageStatements,
        commandSelectionRef,
        scope,
        authorityReadOrders,
        materializationAuthority,
        priorCanonicalGraphFixture
      } = await createTwoProjectAScopeForApply("51515151-5151-4151-8151-515151515151");
      type PersistedMapping = {
        id: string;
        projectId: string;
        amountCents: bigint;
        mappingFingerprint: string;
        readSetSnapshot: unknown;
      };
      const persistedMappings: PersistedMapping[] = (scope.projects as unknown as Array<{ manifest: { rows: PersistedMapping[] } }>).flatMap(
        (project: { manifest: { rows: PersistedMapping[] } }) => project.manifest.rows
      );
      const persistedScopeReadSetFingerprint = scope.readSetFingerprint;
      const persistedMappingReadSets = persistedMappings.map((mapping) => ({
        mappingFingerprint: mapping.mappingFingerprint,
        readSetSnapshotFingerprint: fingerprint(mapping.readSetSnapshot)
      }));
      const createAuthorityOrders = Object.fromEntries(
        Object.entries(authorityReadOrders).map(([key, orders]) => [key, [...orders.at(-1)!]])
      ) as Record<keyof typeof authorityReadOrders, string[]>;
      const writesAfterCreate = captureTakeoverWrites(tx, wageStatements);
      reversePriorGraphCollections(priorCanonicalGraphFixture);
      materializationAuthority.useOppositeQueryOrder();

      await expect(service.apply("finance-1", {
        selectionRef: commandSelectionRef,
        idempotencyKey: "52525252-5252-4252-8252-525252525252",
        expectedRevision: 1,
        businessReason: "查询顺序变化但完整工资物化权威未漂移"
      }, new Date("2026-09-04T00:03:00.000Z"))).resolves.toEqual({
        atomicScopeVersionId: scope.id,
        grade: "A",
        status: "inactive_applied",
        revision: 2,
        rowCount: 2
      });

      expectTakeoverWriteDelta(tx, wageStatements, writesAfterCreate, {
        "operatingTakeoverCommandReceipt.create": 1,
        "operatingTakeoverCommandReceiptLine.create": 2,
        "auditLog.create": 1
      });
      for (const [key, orders] of Object.entries(authorityReadOrders)) {
        expect(orders.at(-1)).toEqual([...createAuthorityOrders[key as keyof typeof authorityReadOrders]].reverse());
      }
      expect(scope.readSetFingerprint).toBe(persistedScopeReadSetFingerprint);
      expect(persistedMappings.map((mapping) => ({
        mappingFingerprint: mapping.mappingFingerprint,
        readSetSnapshotFingerprint: fingerprint(mapping.readSetSnapshot)
      }))).toEqual(persistedMappingReadSets);
      expect(tx.operatingTakeoverCommandReceipt.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          atomicScopeVersionId: scope.id,
          idempotencyKey: "52525252-5252-4252-8252-525252525252",
          action: "historical_wage_takeover.scope.apply",
          expectedRevision: 1,
          actorUserId: "finance-1",
          status: "inactive_applied",
          resultSnapshot: {
            atomicScopeVersionId: scope.id,
            grade: "A",
            status: "inactive_applied",
            revision: 2,
            rowCount: 2
          }
        }),
        select: { id: true }
      });
      expect(tx.operatingTakeoverCommandReceiptLine.create.mock.calls.slice(-2).map((call) => call[0].data)).toEqual(
        persistedMappings.map((mapping, index) => expect.objectContaining({
          rowMappingId: mapping.id,
          projectId: mapping.projectId,
          lineNo: index + 1,
          decision: "inactive_applied",
          entryKind: "historical_wage",
          amountCents: mapping.amountCents,
          causalOrdinal: index + 1
        }))
      );
      expect(tx.auditLog.create).toHaveBeenLastCalledWith({
        data: {
          actorUserId: "finance-1",
          action: "operating_takeover.historical_wage.scope.apply",
          businessType: "operating_takeover_atomic_scope",
          businessId: scope.id,
          metadata: { grade: "A", inactive: true, rowCount: 2 }
        }
      });
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects A activate when the materialization company active row disappears after apply", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const {
        service,
        tx,
        wageStatements,
        activationSelectionRef,
        materializationAuthority
      } = await createTwoProjectAScopeForActivate();
      const writesAfterApply = captureTakeoverWrites(tx, wageStatements);
      materializationAuthority.removeCompany();

      const failure = await service.activate("finance-director-1", {
        selectionRef: activationSelectionRef,
        idempotencyKey: "63636363-6363-4363-8363-636363636363",
        expectedRevision: 2,
        businessReason: "拒绝 apply 后失效的工资承担公司"
      }, new Date("2026-09-04T00:04:00.000Z")).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
      expectTakeoverWriteDelta(tx, wageStatements, writesAfterApply);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each([
    ["employee active row disappears", "employee_missing", "64646464-6464-4464-8464-646464646464", "拒绝 apply 后失效的工资人员"],
    ["employee name drifts", "employee_name", "65656565-6565-4565-8565-656565656565", "拒绝 apply 后变化的工资人员姓名快照"],
    ["employee departmentId drifts", "employee_department", "66666666-6666-4666-8666-666666666666", "拒绝 apply 后变化的工资人员部门快照"],
    ["project code drifts", "project_code", "67676767-6767-4767-8767-676767676767", "拒绝 apply 后变化的工资项目编码快照"],
    ["project name drifts", "project_name", "68686868-6868-4868-8868-686868686868", "拒绝 apply 后变化的工资项目名称快照"],
    ["service binding changes to another valid id", "service_binding", "69696969-6969-4969-8969-696969696969", "拒绝 apply 后替换的工资服务依据绑定"],
    ["business party snapshot drifts under the same id", "business_party", "70707070-7070-4070-8070-707070707070", "拒绝 apply 后变化的债权主体版本快照"]
  ] as const)("rejects A activate when the materialization %s after apply", async (_label, drift, idempotencyKey, businessReason) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const {
        service,
        tx,
        wageStatements,
        activationSelectionRef,
        materializationAuthority
      } = await createTwoProjectAScopeForActivate();
      const writesAfterApply = captureTakeoverWrites(tx, wageStatements);
      switch (drift) {
        case "employee_missing":
          materializationAuthority.removeEmployee("employee-1");
          break;
        case "employee_name":
          materializationAuthority.mutateEmployee("employee-1", { name: "张三（激活前变更）" });
          break;
        case "employee_department":
          materializationAuthority.mutateEmployee("employee-1", { departmentId: "department-activate-drift" });
          break;
        case "project_code":
          materializationAuthority.mutateProject("project-1", { code: "P-001-ACTIVATE-DRIFT" });
          break;
        case "project_name":
          materializationAuthority.mutateProject("project-1", { name: "项目一（激活前变更）" });
          break;
        case "service_binding":
          materializationAuthority.replaceServiceBindingId("project-1", "service-binding-1-activate-replacement");
          break;
        case "business_party":
          materializationAuthority.mutateBusinessPartySnapshot("party-version-1", {
            name: "税务机关（激活前变更）",
            unifiedSocialCreditCode: "913100000000000011"
          });
          break;
      }

      const failure = await service.activate("finance-director-1", {
        selectionRef: activationSelectionRef,
        idempotencyKey,
        expectedRevision: 2,
        businessReason
      }, new Date("2026-09-04T00:04:00.000Z")).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect((failure as ConflictException).getStatus()).toBe(409);
      expectTakeoverWriteDelta(tx, wageStatements, writesAfterApply);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("accepts public A lifecycle when row order opposes manifest ID order and relations reverse", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const {
        service,
        tx,
        wageStatements,
        selectionRefs,
        commandSelectionRef,
        activationSelectionRef,
        optionSelectionFingerprint,
        scope,
        authorityReadOrders,
        materializationAuthority,
        priorCanonicalGraphFixture
      } = await createTwoProjectAScopeForActivate(makeManifestIdsOpposeRowOrder);
      expect([...priorCanonicalGraphFixture.envelopes]
        .sort((left, right) => left.rowMapping.rowNo - right.rowMapping.rowNo)
        .map((envelope) => [envelope.rowMapping.rowNo, envelope.manifestVersionId]))
        .toEqual([[1, "manifest-z"], [2, "manifest-a"]]);
      expect(selectionRefs.read(
        commandSelectionRef,
        new Date("2026-09-04T00:02:00.000Z")
      )?.selectionFingerprint).toBe(optionSelectionFingerprint);
      expect(selectionRefs.read(
        activationSelectionRef,
        new Date("2026-09-04T00:02:30.000Z")
      )?.selectionFingerprint).toBe(optionSelectionFingerprint);
      type PersistedMapping = {
        id: string;
        projectId: string;
        sourceType: string;
        sourceBusinessId: string;
        sourceVersion: number;
        sourceFingerprint: string;
        amountCents: bigint;
        mappingFingerprint: string;
        readSetSnapshot: unknown;
        legacySourceSnapshot: {
          direction: "increase" | "decrease";
          costImpactId: string;
          payableImpactId: string;
        };
      };
      const persistedMappings: PersistedMapping[] = (scope.projects as unknown as Array<{ manifest: { rows: PersistedMapping[] } }>).flatMap(
        (project) => project.manifest.rows
      );
      const reservation = scope.wageStatementReservation;
      const expectedConfirmationInput = {
        atomicScopeVersionId: scope.id,
        reservedVersionId: reservation.id,
        sourceVersionId: scope.authoritySourceRef,
        sourceFingerprint: scope.authoritySourceFingerprint,
        expectedProjectIds: ["project-1", "project-2"],
        sourceClosureFingerprint: scope.sourceClosureFingerprint,
        targetWageStatementId: reservation.targetWageStatementId,
        expectedCurrentRevision: reservation.expectedCurrentRevision,
        reservedRevision: reservation.reservedRevision,
        versionKind: reservation.versionKind,
        priorConfirmedVersionId: reservation.priorConfirmedVersionId,
        priorSourceVersionId: reservation.priorSourceVersionId,
        sourceDeltaFingerprint: reservation.sourceDeltaFingerprint,
        canonicalRootClosureFingerprint: reservation.canonicalRootClosureFingerprint,
        actorUserId: "finance-director-1"
      };
      const canonicalAmounts = new Map([
        ["project-1", 200n],
        ["project-2", 300n]
      ]);
      const operatingProjectionSnapshot = {
        projectionOrigin: "historical_takeover_legacy_link",
        wageStatementVersionId: reservation.id,
        wageVersionKind: "correction",
        projects: Object.fromEntries([...canonicalAmounts].map(([projectId, amountCents]) => [projectId, {
          canonicalCostDeltas: [{
            costCellId: `cost-delta-${projectId}`,
            amountCents: amountCents.toString(),
            direction: "decrease"
          }],
          canonicalPayableDeltas: [{
            payableCellId: `payable-cell-${projectId}`,
            payableRefId: `payable-ref-${projectId}`,
            amountCents: amountCents.toString(),
            direction: "decrease"
          }]
        }]))
      };
      wageStatements.confirmHistoricalTakeoverInTransaction.mockImplementation((client, input) => {
        expect(client).toBe(tx);
        expect(input).toEqual(expectedConfirmationInput);
        return Promise.resolve({ versionId: reservation.id, decision: "FORMAL" });
      });
      Object.assign(tx.wageStatementVersion, {
        findUnique: jest.fn().mockResolvedValue({
          id: reservation.id,
          projectionOrigin: "historical_takeover_legacy_link",
          operatingProjectionSnapshot
        })
      });
      Object.assign(tx, {
        wageProjectAllocation: {
          findMany: jest.fn().mockImplementation(({ where }) => {
            const projectId = where.projectId as string;
            const amountCents = canonicalAmounts.get(projectId)!;
            return Promise.resolve([{
              id: `allocation-${projectId}`,
              componentAllocations: [{ id: `cost-delta-${projectId}`, amountCents }],
              creditorAllocations: [{
                id: `payable-cell-${projectId}`,
                projectAllocationId: `allocation-${projectId}`,
                creditorBreakdownId: `creditor-${projectId}`,
                amountCents
              }]
            }]);
          })
        }
      });
      tx.wagePayableRef.findMany.mockImplementation(({ where }) => {
        const projectId = where.projectId as string;
        const amountCents = canonicalAmounts.get(projectId)!;
        return Promise.resolve([{
          id: `payable-ref-${projectId}`,
          amountCents,
          projectAllocationId: `allocation-${projectId}`,
          creditorBreakdownId: `creditor-${projectId}`,
          direction: "decrease"
        }]);
      });
      tx.wageTakeoverProjectionEnvelope.create.mockImplementation(({ data }) => Promise.resolve(data));
      const persistedScopeReadSetFingerprint = scope.readSetFingerprint;
      const persistedMappingReadSets = persistedMappings.map((mapping) => ({
        mappingFingerprint: mapping.mappingFingerprint,
        readSetSnapshotFingerprint: fingerprint(mapping.readSetSnapshot)
      }));
      const applyAuthorityOrders = Object.fromEntries(
        Object.entries(authorityReadOrders).map(([key, orders]) => [key, [...orders.at(-1)!]])
      ) as Record<keyof typeof authorityReadOrders, string[]>;
      const writesAfterApply = captureTakeoverWrites(tx, wageStatements);
      reversePriorGraphCollections(priorCanonicalGraphFixture);
      materializationAuthority.useOppositeQueryOrder();

      const result = await service.activate("finance-director-1", {
        selectionRef: activationSelectionRef,
        idempotencyKey: "71717171-7171-4171-8171-717171717171",
        expectedRevision: 2,
        businessReason: "权威读取顺序变化但 A 级完整闭合未漂移"
      }, new Date("2026-09-04T00:04:00.000Z"));

      expectTakeoverWriteDelta(tx, wageStatements, writesAfterApply, {
        "wageTakeoverProjectionEnvelope.create": 2,
        "wageTakeoverProjectionEnvelopeCostCell.create": 2,
        "wageTakeoverProjectionEnvelopePayableRef.create": 2,
        "wageTakeoverLegacyImpactBridge.create": 4,
        "operatingTakeoverLegacySourceBridge.create": 2,
        "operatingTakeoverCommandReceipt.create": 1,
        "operatingTakeoverCommandReceiptLine.create": 2,
        "auditLog.create": 1,
        "wageStatements.confirmHistoricalTakeoverInTransaction": 1
      });
      expect(wageStatements.confirmHistoricalTakeoverInTransaction.mock.calls.slice(-1)).toEqual([
        [tx, expectedConfirmationInput]
      ]);
      for (const [key, orders] of Object.entries(authorityReadOrders)) {
        expect(orders.at(-1)).toEqual([...applyAuthorityOrders[key as keyof typeof authorityReadOrders]].reverse());
      }
      expect(scope.readSetFingerprint).toBe(persistedScopeReadSetFingerprint);
      expect(persistedMappings.map((mapping) => ({
        mappingFingerprint: mapping.mappingFingerprint,
        readSetSnapshotFingerprint: fingerprint(mapping.readSetSnapshot)
      }))).toEqual(persistedMappingReadSets);

      const envelopes = tx.wageTakeoverProjectionEnvelope.create.mock.calls.slice(-2).map((call) => call[0].data);
      expect(envelopes.map((envelope) => ({
        atomicScopeVersionId: envelope.atomicScopeVersionId,
        rowMappingId: envelope.rowMappingId,
        wageStatementVersionId: envelope.wageStatementVersionId,
        projectId: envelope.projectId,
        legacySourceType: envelope.legacySourceType,
        legacySourceBusinessId: envelope.legacySourceBusinessId,
        legacySourceVersion: envelope.legacySourceVersion,
        legacySourceFingerprint: envelope.legacySourceFingerprint,
        projectionOrigin: envelope.projectionOrigin,
        deltaDirection: envelope.deltaDirection
      }))).toEqual(persistedMappings.map((mapping) => ({
        atomicScopeVersionId: scope.id,
        rowMappingId: mapping.id,
        wageStatementVersionId: reservation.id,
        projectId: mapping.projectId,
        legacySourceType: mapping.sourceType,
        legacySourceBusinessId: mapping.sourceBusinessId,
        legacySourceVersion: mapping.sourceVersion,
        legacySourceFingerprint: mapping.sourceFingerprint,
        projectionOrigin: "historical_takeover_legacy_link",
        deltaDirection: mapping.legacySourceSnapshot.direction
      })));
      const envelopeByMappingId = new Map(envelopes.map((envelope) => [envelope.rowMappingId, envelope]));
      expect(tx.wageTakeoverLegacyImpactBridge.create.mock.calls.slice(-4).map((call) => {
        const data = call[0].data;
        return {
          envelopeId: data.envelopeId,
          rowMappingId: data.rowMappingId,
          projectId: data.projectId,
          legacyImpactEntryId: data.legacyImpactEntryId,
          impactKind: data.impactKind,
          direction: data.direction,
          amountCents: data.amountCents
        };
      })).toEqual(persistedMappings.flatMap((mapping) => [
        {
          envelopeId: envelopeByMappingId.get(mapping.id)!.id,
          rowMappingId: mapping.id,
          projectId: mapping.projectId,
          legacyImpactEntryId: mapping.legacySourceSnapshot.costImpactId,
          impactKind: "confirmed_cost",
          direction: mapping.legacySourceSnapshot.direction,
          amountCents: mapping.amountCents
        },
        {
          envelopeId: envelopeByMappingId.get(mapping.id)!.id,
          rowMappingId: mapping.id,
          projectId: mapping.projectId,
          legacyImpactEntryId: mapping.legacySourceSnapshot.payableImpactId,
          impactKind: "payable_decrease",
          direction: mapping.legacySourceSnapshot.direction,
          amountCents: mapping.amountCents
        }
      ]));
      expect(tx.wageTakeoverProjectionEnvelopeCostCell.create.mock.calls.slice(-2).map((call) => {
        const data = call[0].data;
        return { envelopeId: data.envelopeId, costCellId: data.costCellId, direction: data.direction, amountCents: data.amountCents };
      })).toEqual(persistedMappings.map((mapping) => ({
        envelopeId: envelopeByMappingId.get(mapping.id)!.id,
        costCellId: `cost-delta-${mapping.projectId}`,
        direction: "decrease",
        amountCents: canonicalAmounts.get(mapping.projectId)
      })));
      expect(tx.wageTakeoverProjectionEnvelopePayableRef.create.mock.calls.slice(-2).map((call) => {
        const data = call[0].data;
        return { envelopeId: data.envelopeId, payableRefId: data.payableRefId, direction: data.direction, amountCents: data.amountCents };
      })).toEqual(persistedMappings.map((mapping) => ({
        envelopeId: envelopeByMappingId.get(mapping.id)!.id,
        payableRefId: `payable-ref-${mapping.projectId}`,
        direction: "decrease",
        amountCents: canonicalAmounts.get(mapping.projectId)
      })));
      expect(tx.operatingTakeoverLegacySourceBridge.create.mock.calls.slice(-2).map((call) => {
        const data = call[0].data;
        return {
          projectId: data.projectId,
          rowMappingId: data.rowMappingId,
          sourceType: data.sourceType,
          sourceBusinessId: data.sourceBusinessId,
          sourceVersion: data.sourceVersion,
          sourceFingerprint: data.sourceFingerprint,
          targetKind: data.targetKind,
          targetRef: data.targetRef,
          mappingDecision: data.mappingDecision,
          createdByUserId: data.createdByUserId
        };
      })).toEqual(persistedMappings.map((mapping) => ({
        projectId: mapping.projectId,
        rowMappingId: mapping.id,
        sourceType: mapping.sourceType,
        sourceBusinessId: mapping.sourceBusinessId,
        sourceVersion: mapping.sourceVersion,
        sourceFingerprint: mapping.sourceFingerprint,
        targetKind: "wage_takeover_projection_envelope",
        targetRef: envelopeByMappingId.get(mapping.id)!.id,
        mappingDecision: "FORMAL",
        createdByUserId: "finance-director-1"
      })));
      const expectedRows = persistedMappings.map((mapping) => ({
        projectId: mapping.projectId,
        decision: "FORMAL",
        targetKind: "wage_takeover_projection_envelope",
        targetRef: envelopeByMappingId.get(mapping.id)!.id
      }));
      expect(result).toEqual({
        atomicScopeVersionId: scope.id,
        grade: "A",
        status: "activated",
        revision: 3,
        rows: expectedRows
      });
      expect(tx.operatingTakeoverCommandReceipt.create.mock.calls.at(-1)![0]).toEqual({
        data: expect.objectContaining({
          atomicScopeVersionId: scope.id,
          idempotencyKey: "71717171-7171-4171-8171-717171717171",
          action: "historical_wage_takeover.scope.activate",
          expectedRevision: 2,
          actorUserId: "finance-director-1",
          delegatorUserId: null,
          status: "activated",
          resultSnapshot: result,
          causesReceiptId: "activation-root-two-projects"
        }),
        select: { id: true }
      });
      expect(tx.operatingTakeoverCommandReceiptLine.create.mock.calls.slice(-2).map((call) => {
        const data = call[0].data;
        return {
          rowMappingId: data.rowMappingId,
          projectId: data.projectId,
          lineNo: data.lineNo,
          decision: data.decision,
          entryKind: data.entryKind,
          amountCents: data.amountCents,
          targetKind: data.targetKind,
          targetRef: data.targetRef,
          causalOrdinal: data.causalOrdinal
        };
      })).toEqual(persistedMappings.map((mapping, index) => ({
        rowMappingId: mapping.id,
        projectId: mapping.projectId,
        lineNo: index + 1,
        decision: "FORMAL",
        entryKind: "historical_wage",
        amountCents: mapping.amountCents,
        targetKind: "wage_takeover_projection_envelope",
        targetRef: envelopeByMappingId.get(mapping.id)!.id,
        causalOrdinal: index + 1
      })));
      expect(tx.auditLog.create.mock.calls.at(-1)![0]).toEqual({
        data: {
          actorUserId: "finance-director-1",
          action: "operating_takeover.historical_wage.scope.activate",
          businessType: "operating_takeover_atomic_scope",
          businessId: scope.id,
          metadata: { grade: "A", targets: expectedRows }
        }
      });
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("accepts only a server-signed selectionRef and resolves prepare authority through the same transaction", async () => {
    const { service, selectionRefs, tx, roles } = setup();
    const lockSpy = jest.spyOn(
      service as unknown as {
        lock: (transaction: typeof tx, key: string) => Promise<void>;
      },
      "lock"
    );
    const selectionRef = selectionRefs.issue(cBinding(), new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        expectedRevision: 0,
        businessReason: "历史工资接管核对"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({
        atomicScopeVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        grade: "C"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(roles.resolveActiveRoleScopes).not.toHaveBeenCalled();
    expect(roles.resolveActiveRoleScopesInTransaction).toHaveBeenCalledWith(tx, "finance-1");
    expect(lockSpy).toHaveBeenCalledWith(tx, "pol219:idempotency:11111111-1111-4111-8111-111111111111");
    expect(tx.operatingTakeoverAtomicScopeVersion.create).toHaveBeenCalled();
  });

  it("issues one opaque A option for a server-resolved complete cross-project closure", async () => {
    const { service, selectionRefs, tx, wageStatements } = setup();
    const secondLegacyFact = {
      ...legacyFact,
      id: "fact-2",
      projectId: "project-2",
      sourceBusinessId: "legacy-wage-2",
      amountCents: 2000n,
      impacts: [
        { id: "impact-cost-2", impactKind: "confirmed_cost", amountCents: 2000n, direction: "increase", sourceImpactKey: "cost" },
        { id: "impact-payable-2", impactKind: "payable_increase", amountCents: 2000n, direction: "increase", sourceImpactKey: "payable" }
      ]
    };
    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-1",
      sourceFingerprint: "b".repeat(64),
      evidenceFileId: "approved-evidence-1",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "3000",
          evidenceSha256,
          projectAllocations: [
            { projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" },
            { projectId: "project-2", serviceSnapshotId: "service-2", amountCents: "2000" },
            { projectId: "project-3", serviceSnapshotId: "service-3", amountCents: "0" }
          ]
        }]
      }
    });
    tx.operatingFact.findMany.mockResolvedValue([legacyFact, secondLegacyFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-reserved-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [
        { projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" },
        { projectId: "project-2", signedCostDeltaCents: "2000", signedPayableDeltaCents: "2000" },
        { projectId: "project-3", signedCostDeltaCents: "0", signedPayableDeltaCents: "0" }
      ]
    });
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    mockAMaterializationAuthority(tx, source);

    const result = await service.options("finance-1", "project-3", new Date("2026-09-04T00:01:00.000Z"));

    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toEqual({
      selectionRef: expect.stringMatching(/^hwt1\./u),
      grade: "A",
      label: "A级逐人工资权威（3个项目）",
      projectCount: 3,
      legacyFactCount: 2
    });
    expect(result.options[0]).not.toEqual(expect.objectContaining({
      projectId: expect.anything(),
      sourceVersionId: expect.anything(),
      wageMonth: expect.anything(),
      amountCents: expect.anything(),
      employeeId: expect.anything()
    }));
    const binding = selectionRefs.read(result.options[0]!.selectionRef, new Date("2026-09-04T00:01:00.000Z"));
    expect(binding).toEqual(expect.objectContaining({
      actorUserId: "finance-1",
      grade: "A",
      sourceVersionId: source.id,
      legacyCoordinates: [
        expect.objectContaining({ projectId: "project-1", sourceBusinessId: "legacy-wage-1" }),
        expect.objectContaining({ projectId: "project-2", sourceBusinessId: "legacy-wage-2" })
      ]
    }));

    for (const drift of [
      { occurredAt: new Date("2026-07-31T00:00:00.000Z") },
      { costBearingCompanySubjectId: "company-2" }
    ]) {
      tx.operatingFact.findMany.mockResolvedValue([
        { ...legacyFact, ...drift },
        { ...secondLegacyFact, ...drift }
      ]);
      const drifted = await service.options("finance-1", "project-1", new Date("2026-09-04T00:02:00.000Z"));
      expect(drifted.options.some((option) => option.grade === "A")).toBe(false);
    }
  });

  it.each([
    ["PERSON", "employee-1"],
    ["ROLE_SUMMARY", null]
  ] as const)("rejects an A selection with zero writes when another company's active #214 %s line appears before create", async (
    coverageKind,
    personAuthorityKey
  ) => {
    const { service, tx, wageStatements } = setup();
    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-company-1",
      employmentCompanyId: "company-1",
      sourceFingerprint: "b".repeat(64),
      evidenceFileId: "approved-evidence-company-1",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    });
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    mockAMaterializationAuthority(tx, source);
    let active = false;
    tx.projectAffiliateCompanyContract.findMany.mockImplementation(({ where }) => Promise.resolve(
      (!where.companyEntityId || where.companyEntityId === "company-2") && where.projectId.in.includes("project-1")
        ? [{
            id: "affiliate-contract-company-2",
            projectId: "project-1",
            companyEntityId: "company-2",
            companyEntityVersionId: "company-version-2",
            requestFingerprint: "1".repeat(64),
            fileContentSha256Snapshot: "2".repeat(64)
          }]
        : []
    ));
    tx.affiliateClearingAuthorityVersion.findMany.mockResolvedValue([{
      id: "authority-company-2",
      affiliateCompanyContractId: "affiliate-contract-company-2",
      authorityFingerprint: "3".repeat(64)
    }]);
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([{
      id: "conflict-line-company-2",
      authorityVersionId: "authority-company-2",
      projectId: "project-1",
      coverageKind,
      personAuthorityKey,
      lineFingerprint: "4".repeat(64)
    }]);
    tx.operatingTakeoverRowMapping.findMany.mockImplementation(() => Promise.resolve(active ? [{
      id: "mapping-214-company-2",
      manifestVersionId: "manifest-214-company-2",
      projectId: "project-1",
      authorityVersionId: "authority-company-2",
      authorityLineId: "conflict-line-company-2"
    }] : []));
    tx.operatingTakeoverCommandReceipt.findMany.mockImplementation(({ where }) => Promise.resolve(
      active && where?.action === "manifest.activate"
        ? [{
            id: "activation-214-company-2",
            manifestVersionId: "manifest-214-company-2",
            action: "manifest.activate",
            status: "activated",
            lines: [{
              id: "activation-line-214-company-2",
              rowMappingId: "mapping-214-company-2",
              decision: "FORMAL",
              targetKind: "clearing_event_version",
              targetRef: "clearing-event-214-company-2",
              causalOrdinal: 1
            }],
            causedReceipts: []
          }]
        : []
    ));
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-company-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" }]
    });

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "A" })]);
    active = true;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "86868686-8686-4686-8686-868686868686",
        expectedRevision: 0,
        businessReason: "另一公司同项目同月同人员的已激活工资承担权威必须整组阻断"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  /* eslint-disable @typescript-eslint/no-unused-vars -- keep one uniform drift-mutator signature for the table-driven test */
  const cOccupancyGraphDrifts = [
    ["truncated stored plan", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const readSet = occupancy.rowMapping.readSetSnapshot as unknown as {
        plan: Record<string, unknown>;
        legacy: unknown;
      };
      readSet.plan = { grade: "C" };
      occupancy.rowMapping.mappingFingerprint = fingerprint({
        scopeId: occupancy.scope.id,
        projectId: occupancy.rowMapping.projectId,
        plan: readSet.plan,
        legacy: readSet.legacy
      });
      occupancy.manifest.manifestFingerprint = fingerprint({
        scopeId: occupancy.scope.id,
        projectId: occupancy.manifest.projectId,
        plan: readSet.plan,
        rows: [readSet.legacy]
      });
    }],
    ["wrapped legacy source snapshot", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      (occupancy.rowMapping as unknown as { legacySourceSnapshot: unknown }).legacySourceSnapshot = {
        legacy: occupancy.rowMapping.readSetSnapshot.legacy
      };
    }],
    ["negative frontier fingerprint triple mismatch", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.gap.gapSnapshot.negativeAuthorityFrontierFingerprint = "f".repeat(64);
    }],
    ["cost impact snapshot tamper with synchronized hash", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const legacySource = occupancy.rowMapping.legacySourceSnapshot as unknown as {
        sourceFingerprint: string;
        costImpactId: string;
        direction: "increase" | "decrease";
        amountCents: bigint | string;
        costImpactSnapshot: unknown;
        costImpactFingerprint: string;
      };
      legacySource.costImpactSnapshot = { tampered: "cost-current-focus-mismatch" };
      legacySource.costImpactFingerprint = fingerprint({
        legacySourceFingerprint: legacySource.sourceFingerprint,
        legacyImpactEntryId: legacySource.costImpactId,
        impactKind: "confirmed_cost",
        direction: legacySource.direction,
        amountCents: legacySource.amountCents,
        impactSnapshot: legacySource.costImpactSnapshot
      });
    }],
    ["payable impact snapshot tamper with synchronized hash", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const legacySource = occupancy.rowMapping.legacySourceSnapshot as unknown as {
        sourceFingerprint: string;
        payableImpactId: string;
        direction: "increase" | "decrease";
        amountCents: bigint | string;
        payableImpactSnapshot: unknown;
        payableImpactFingerprint: string;
      };
      legacySource.payableImpactSnapshot = { tampered: "payable-current-focus-mismatch" };
      legacySource.payableImpactFingerprint = fingerprint({
        legacySourceFingerprint: legacySource.sourceFingerprint,
        legacyImpactEntryId: legacySource.payableImpactId,
        impactKind: legacySource.direction === "increase" ? "payable_increase" : "payable_decrease",
        direction: legacySource.direction,
        amountCents: legacySource.amountCents,
        impactSnapshot: legacySource.payableImpactSnapshot
      });
    }],
    ["illegal unresolved authority coordinates with synchronized hashes", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const readSet = occupancy.rowMapping.readSetSnapshot as unknown as {
        plan: Record<string, unknown> & {
          negativeAuthorityFrontier: Record<string, unknown> & {
            authorityScope: Record<string, unknown>;
          };
          negativeAuthorityFrontierFingerprint: string;
        };
        legacy: unknown;
      };
      readSet.plan.negativeAuthorityFrontier.authorityScope = {
        ...readSet.plan.negativeAuthorityFrontier.authorityScope,
        state: "unresolved",
        wageMonth: "2026-08"
      };
      const frontierFingerprint = fingerprint(readSet.plan.negativeAuthorityFrontier);
      readSet.plan.negativeAuthorityFrontierFingerprint = frontierFingerprint;
      occupancy.scope.authoritySourceFingerprint = frontierFingerprint;
      occupancy.gap.gapSnapshot.negativeAuthorityFrontierFingerprint = frontierFingerprint;
      occupancy.rowMapping.mappingFingerprint = fingerprint({
        scopeId: occupancy.scope.id,
        projectId: occupancy.rowMapping.projectId,
        plan: readSet.plan,
        legacy: readSet.legacy
      });
      occupancy.manifest.manifestFingerprint = fingerprint({
        scopeId: occupancy.scope.id,
        projectId: occupancy.manifest.projectId,
        plan: readSet.plan,
        rows: [readSet.legacy]
      });
    }],
    ["scope-project append", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.scope.projects.push({
        ...occupancy.scope.projects[0]!,
        id: "occupied-scope-project-orphan",
        projectId: "project-orphan"
      });
    }],
    ["manifest reverse-row append", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.scope.manifests[0]!.rows.push({
        ...occupancy.rowMapping,
        id: "occupied-mapping-orphan",
        rowNo: 2
      });
    }],
    ["manifest reverse-row FK rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.scope.manifests[0]!.rows[0] = {
        ...occupancy.rowMapping,
        manifestVersionId: "foreign-manifest"
      };
    }],
    ["unexpected C reservation with reverse mapping", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      (occupancy.scope as unknown as Record<string, unknown>).wageStatementReservation = {
        id: "occupied-reservation-orphan",
        atomicScopeVersionId: occupancy.scope.id,
        mappings: [{ ...occupancy.rowMapping, wageStatementReservationId: "occupied-reservation-orphan" }]
      };
    }],
    ["scope-owned orphan gap", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.gaps.push({
        ...occupancy.gap,
        id: "occupied-gap-orphan",
        rowMappingId: "occupied-mapping-orphan"
      });
    }],
    ["reverse orphan bridge", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.reverseBridges.push({
        ...occupancy.bridge,
        id: "occupied-bridge-orphan",
        sourceBusinessId: "legacy-wage-orphan"
      });
    }],
    ["receipt permission rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[0]!.permissionSnapshotFingerprint = "f".repeat(64);
    }],
    ["receipt actor-set rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[1]!.actorSetSnapshot.actualUserId = "foreign-actor";
    }],
    ["receipt command fingerprint corruption", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[2]!.fingerprint = "not-a-sha";
    }],
    ["receipt causality rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[2]!.causalityFingerprint = "0".repeat(64);
    }],
    ["non-UUID persisted receipt idempotency key", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[0]!.idempotencyKey = "not-a-v4-uuid";
    }],
    ["receipt-line append", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[0]!.lines.push({
        ...occupancy.receipts[0]!.lines[0]!,
        id: "occupied-create-2-line-orphan",
        lineNo: 2,
        causalOrdinal: 2
      });
    }],
    ["receipt-line duplicate ordinal", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[0]!.lines.push({
        ...occupancy.receipts[0]!.lines[0]!,
        id: "occupied-create-2-line-duplicate"
      });
    }],
    ["activation-line decision rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[2]!.lines[0]!.decision = "FORMAL";
    }],
    ["activation-line target rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts[2]!.lines[0]!.targetRef = "foreign-gap";
    }],
    ["compensation receipt cause rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const compensation = occupancy.receipts.find(
        (receipt) => receipt.action === "historical_wage_takeover.scope.compensate"
      );
      if (!compensation) throw new Error("expected public compensation receipt fixture");
      compensation.causesReceiptId = "foreign-activation";
    }],
    ["compensation-line cause rewrite", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const compensation = occupancy.receipts.find(
        (receipt) => receipt.action === "historical_wage_takeover.scope.compensate"
      );
      if (!compensation) throw new Error("expected public compensation receipt fixture");
      compensation.lines[0]!.causesLineId = "foreign-activation-line";
    }],
    ["causal successor append", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.causalSuccessors.push({
        ...occupancy.receipts[2]!,
        id: "occupied-causal-successor-orphan",
        action: "unrelated.successor",
        expectedRevision: 9,
        causesReceiptId: occupancy.receipts[2]!.id
      });
    }],
    ["manifest-owned orphan receipt", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.manifestReceipts.push({
        ...occupancy.receipts[0]!,
        id: "occupied-manifest-receipt-orphan",
        manifestVersionId: occupancy.manifest.id,
        atomicScopeVersionId: null,
        lines: []
      });
    }],
    ["foreign-scope mapping receipt line", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.foreignMappingReceiptLines.push({
        ...occupancy.receipts[0]!.lines[0]!,
        id: "occupied-foreign-scope-line",
        receiptId: "foreign-scope-receipt"
      });
    }],
    ["orphan line-only activation cause", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      const activationLine = occupancy.receipts[2]!.lines[0]!;
      occupancy.activationReverseLines.push({
        ...activationLine,
        id: "occupied-orphan-activation-cause-line",
        receiptId: "orphan-compensation-receipt",
        targetKind: null,
        targetRef: null,
        causesLineId: activationLine.id
      });
    }],
    ["duplicate source bridge", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.sourceBridges.push({ ...occupancy.bridge, id: "occupied-bridge-source-duplicate" });
    }],
    ["missing mapping", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.mappings.splice(0, occupancy.mappings.length);
    }],
    ["scope-owned orphan manifest", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.scope.manifests.push({
        ...occupancy.manifest,
        id: "occupied-manifest-orphan",
        projectId: "project-orphan",
        rows: []
      });
    }],
    ["foreign scope ownership", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.scope.manifests[0] = {
        ...occupancy.manifest,
        atomicScopeVersionId: "foreign-scope",
        rows: [occupancy.rowMapping]
      };
    }],
    ["wrong target kind", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.bridge.targetKind = "historical_wage_summary_payable_ref";
    }],
    ["incomplete lifecycle", (occupancy: ReturnType<typeof installCompleteDifferentScopeCGapOccupancy>, _tx: ReturnType<typeof setup>["tx"]): void => {
      occupancy.receipts.splice(1, 1);
    }]
  ] as const;
  /* eslint-enable @typescript-eslint/no-unused-vars */

  function cOccupancyConflictMessage(label: string) {
    if (label === "duplicate source bridge") return "C级 focus legacy 存在重复 #219 bridge，禁止签发候选";
    if (label === "missing mapping") return "C级 focus legacy bridge 未唯一指向 #219 mapping";
    if (label === "wrong target kind") return "C级 focus legacy 已存在无效的正式 #219 bridge";
    if (label === "scope-owned orphan gap") return "C级 focus legacy occupancy 缺少唯一 scope 或 gap";
    return "C级 focus legacy occupancy 的所有权、FK 或因果闭合无效";
  }

  function cOccupancyNeedsCompensation(label: string) {
    return label === "compensation receipt cause rewrite" || label === "compensation-line cause rewrite";
  }

  type OpaquePersistedReceiptGraph = Array<{
    id: string;
    idempotencyKey: string;
    causesReceiptId: string | null;
    resultSnapshot: unknown;
    lines: Array<{
      id: string;
      receiptId: string;
      rowMappingId: string;
      causalOrdinal: number;
      causesLineId: string | null;
      reversesLineId: string | null;
      causalityFingerprint: string;
    }>;
  }>;

  function recomputeOpaqueReceiptLineCausality(receipts: OpaquePersistedReceiptGraph) {
    const linesById = new Map(receipts.flatMap((receipt) => receipt.lines).map((line) => [line.id, line] as const));
    for (const receipt of receipts) {
      for (const line of receipt.lines) {
        const causeLine = line.causesLineId ? linesById.get(line.causesLineId) : null;
        line.causalityFingerprint = fingerprint({
          receiptId: receipt.id,
          mappingId: line.rowMappingId,
          causalOrdinal: line.causalOrdinal,
          causesLineId: line.causesLineId,
          causeLineFingerprint: causeLine?.causalityFingerprint ?? null
        });
      }
    }
  }

  const opaquePersistedIdentityMutations: ReadonlyArray<readonly [
    string,
    (receipts: OpaquePersistedReceiptGraph) => void
  ]> = [
    ["opaque persisted receipt id", (receipts) => {
      const receipt = receipts[0]!;
      const previousId = receipt.id;
      receipt.id = "legacy-receipt:create:opaque-v1";
      for (const candidate of receipts) {
        if (candidate.causesReceiptId === previousId) candidate.causesReceiptId = receipt.id;
        if (candidate.resultSnapshot && typeof candidate.resultSnapshot === "object") {
          const result = candidate.resultSnapshot as Record<string, unknown>;
          if (result.causesReceiptId === previousId) result.causesReceiptId = receipt.id;
        }
        for (const line of candidate.lines) {
          if (line.receiptId === previousId) line.receiptId = receipt.id;
        }
      }
      recomputeOpaqueReceiptLineCausality(receipts);
    }],
    ["opaque persisted receipt-line id", (receipts) => {
      const line = receipts[0]!.lines[0]!;
      const previousId = line.id;
      line.id = "legacy-receipt-line:create:opaque-v1";
      for (const candidate of receipts.flatMap((receipt) => receipt.lines)) {
        if (candidate.causesLineId === previousId) candidate.causesLineId = line.id;
        if (candidate.reversesLineId === previousId) candidate.reversesLineId = line.id;
      }
      recomputeOpaqueReceiptLineCausality(receipts);
    }]
  ];

  it.each(opaquePersistedIdentityMutations)("accepts %s through public options as a closed occupied graph", async (_label, mutate) => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const occupancy = installCompleteDifferentScopeCGapOccupancy(
      tx,
      await captureCompleteCGapGraphFromPublicLifecycle(setupAmbiguousCApprovedSourceFrontier(), true)
    );
    mutate(occupancy.receipts);

    await expect(service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    )).resolves.toEqual({ options: [] });
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each(opaquePersistedIdentityMutations)("accepts %s on exact public create replay with zero additional writes", async (_label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForApply(setupAmbiguousCApprovedSourceFrontier());
      const receipts = fixture.scope.receipts as unknown as OpaquePersistedReceiptGraph;
      mutate(receipts);
      const persistedReceipt = receipts[0]!;
      fixture.tx.operatingTakeoverCommandReceipt.findUnique.mockImplementation(({ where }) => Promise.resolve(
        where?.idempotencyKey === fixture.createCommand.idempotencyKey ? persistedReceipt : null
      ));
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);

      await expect(fixture.service.createScope(
        "finance-1",
        fixture.createCommand,
        new Date("2026-09-04T00:02:00.000Z")
      )).resolves.toEqual(persistedReceipt.resultSnapshot);
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each(opaquePersistedIdentityMutations)("accepts %s through public inactive apply", async (_label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForApply(setupAmbiguousCApprovedSourceFrontier());
      mutate(fixture.scope.receipts as unknown as OpaquePersistedReceiptGraph);
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);

      await expect(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898976",
        expectedRevision: 1,
        businessReason: "opaque persisted receipt identity 不改变 inactive apply 语义"
      }, new Date("2026-09-04T00:03:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "inactive_applied",
        revision: 2
      }));
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate, {
        "operatingTakeoverCommandReceipt.create": 1,
        "operatingTakeoverCommandReceiptLine.create": 1,
        "auditLog.create": 1
      });
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each(opaquePersistedIdentityMutations)("accepts %s through public activate", async (_label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForActivate(setupAmbiguousCApprovedSourceFrontier());
      mutate(fixture.scope.receipts as unknown as OpaquePersistedReceiptGraph);
      fixture.tx.unresolvedWagePayableGap.create.mockImplementation(({ data }) => Promise.resolve(data));
      fixture.tx.operatingTakeoverLegacySourceBridge.create.mockImplementation(({ data }) => Promise.resolve(data));
      const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);

      await expect(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898977",
        expectedRevision: 2,
        businessReason: "opaque persisted receipt identity 不改变 C gap 激活语义"
      }, new Date("2026-09-04T00:04:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "activated",
        revision: 3,
        rows: [expect.objectContaining({ decision: "GAP" })]
      }));
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply, {
        "unresolvedWagePayableGap.create": 1,
        "operatingTakeoverLegacySourceBridge.create": 1,
        "operatingTakeoverCommandReceipt.create": 1,
        "operatingTakeoverCommandReceiptLine.create": 1,
        "auditLog.create": 1
      });
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each(cOccupancyGraphDrifts)("fails closed on complete C occupancy graph drift: %s", async (label, mutate) => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const occupancy = installCompleteDifferentScopeCGapOccupancy(
      tx,
      await captureCompleteCGapGraphFromPublicLifecycle(
        setupAmbiguousCApprovedSourceFrontier(),
        cOccupancyNeedsCompensation(label)
      )
    );
    mutate(occupancy, tx);

    await expectCMatrixConflict409(
      service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      cOccupancyConflictMessage(label)
    );
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each(cOccupancyGraphDrifts)("rejects public C create on complete occupancy graph drift: %s", async (label, mutate) => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    const occupancy = installCompleteDifferentScopeCGapOccupancy(
      tx,
      await captureCompleteCGapGraphFromPublicLifecycle(
        setupAmbiguousCApprovedSourceFrontier(),
        cOccupancyNeedsCompensation(label)
      )
    );
    mutate(occupancy, tx);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectCMatrixConflict409(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898987",
        expectedRevision: 0,
        businessReason: "拒绝损坏的不同 scope C occupancy 图"
      }, new Date("2026-09-04T00:02:00.000Z")), cOccupancyConflictMessage(label));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each(cOccupancyGraphDrifts)("rejects public C apply on complete occupancy graph drift: %s", async (label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForApply();
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      const occupancy = installCompleteDifferentScopeCGapOccupancy(
        fixture.tx,
        await captureCompleteCGapGraphFromPublicLifecycle(
          setupAmbiguousCApprovedSourceFrontier(),
          cOccupancyNeedsCompensation(label)
        )
      );
      mutate(occupancy, fixture.tx);

      await expectCMatrixConflict409(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898988",
        expectedRevision: 1,
        businessReason: "拒绝 inactive apply 前损坏的不同 scope C occupancy 图"
      }, new Date("2026-09-04T00:03:00.000Z")), cOccupancyConflictMessage(label));
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each(cOccupancyGraphDrifts)("rejects public C activate on complete occupancy graph drift: %s", async (label, mutate) => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForActivate();
      const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      const occupancy = installCompleteDifferentScopeCGapOccupancy(
        fixture.tx,
        await captureCompleteCGapGraphFromPublicLifecycle(
          setupAmbiguousCApprovedSourceFrontier(),
          cOccupancyNeedsCompensation(label)
        )
      );
      mutate(occupancy, fixture.tx);

      await expectCMatrixConflict409(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898989",
        expectedRevision: 2,
        businessReason: "拒绝激活前损坏的不同 scope C occupancy 图"
      }, new Date("2026-09-04T00:04:00.000Z")), cOccupancyConflictMessage(label));
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
      expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
      expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects A with zero writes when a two-line #214 activation is only partially compensated", async () => {
    const { service, tx, wageStatements } = setup();
    mockCompleteASource(tx, wageStatements);
    const authorityId = "authority-company-2-partial";
    const contractId = "affiliate-contract-company-2-partial";
    const manifestVersionId = "manifest-company-2-partial";
    const compensatedLine = {
      id: "assigned-wage-person-company-2-compensated",
      authorityVersionId: authorityId,
      projectId: "project-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-2",
      lineFingerprint: "4".repeat(64)
    };
    const activeLine = {
      id: "assigned-wage-person-company-2-active",
      authorityVersionId: authorityId,
      projectId: "project-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1",
      lineFingerprint: "5".repeat(64)
    };
    const mappings = [compensatedLine, activeLine].map((line) => ({
      id: `mapping-${line.id}`,
      manifestVersionId,
      projectId: line.projectId,
      authorityVersionId: line.authorityVersionId,
      authorityLineId: line.id
    }));
    let partiallyCompensated = false;
    tx.projectAffiliateCompanyContract.findMany.mockResolvedValue([{
      id: contractId,
      projectId: "project-1",
      companyEntityId: "company-2",
      companyEntityVersionId: "company-version-2",
      requestFingerprint: "1".repeat(64),
      fileContentSha256Snapshot: "2".repeat(64)
    }]);
    tx.affiliateClearingAuthorityVersion.findMany.mockResolvedValue([{
      id: authorityId,
      affiliateCompanyContractId: contractId,
      authorityFingerprint: "3".repeat(64)
    }]);
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([compensatedLine, activeLine]);
    tx.operatingTakeoverRowMapping.findMany.mockResolvedValue(mappings);
    tx.operatingTakeoverCommandReceipt.findMany.mockImplementation(({ where }) => Promise.resolve(
      partiallyCompensated && where?.action === "manifest.activate"
        ? [{
            id: "activation-company-2-partial",
            manifestVersionId,
            action: "manifest.activate",
            status: "activated",
            lines: [
              {
                id: "activation-line-company-2-compensated",
                rowMappingId: mappings[0]!.id,
                decision: "FORMAL",
                causalOrdinal: 1
              },
              {
                id: "activation-line-company-2-active",
                rowMappingId: mappings[1]!.id,
                decision: "FORMAL",
                causalOrdinal: 2
              }
            ],
            causedReceipts: [{
              id: "compensation-company-2-partial",
              causesReceiptId: "activation-company-2-partial",
              action: "manifest.compensate",
              status: "compensated",
              lines: [{
                id: "compensation-line-company-2-partial",
                rowMappingId: mappings[0]!.id,
                decision: "COMPENSATION",
                causalOrdinal: 1,
                reversesLineId: "activation-line-company-2-compensated"
              }]
            }]
          }]
        : []
    ));

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "A" })]);
    partiallyCompensated = true;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "93939393-9393-4393-8393-939393939393",
        expectedRevision: 0,
        businessReason: "部分补偿不得掩盖仍然活跃的同人工资承担行"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each([
    {
      label: "prepared but not active",
      conflict: {},
      transition: "prepared",
      idempotencyKey: "92929292-9292-4292-8292-929292929290"
    },
    {
      label: "attested but not active",
      conflict: {},
      transition: "attested",
      idempotencyKey: "92929292-9292-4292-8292-929292929291"
    },
    {
      label: "compensated",
      conflict: {},
      transition: "compensated",
      idempotencyKey: "92929292-9292-4292-8292-929292929292"
    },
    {
      label: "in another project",
      conflict: { projectId: "project-2" },
      transition: "active",
      idempotencyKey: "92929292-9292-4292-8292-929292929293"
    },
    {
      label: "in another month",
      conflict: { wageMonth: "2026-07" },
      transition: "active",
      idempotencyKey: "92929292-9292-4292-8292-929292929294"
    },
    {
      label: "on a non-confirmed authority version",
      conflict: { authorityStatus: "submitted" as const },
      transition: "active",
      idempotencyKey: "92929292-9292-4292-8292-929292929295"
    }
  ])("does not let a $label #214 PERSON line block A options or create", async ({
    conflict: conflictInput,
    transition,
    idempotencyKey
  }) => {
    const { service, tx, wageStatements } = setup();
    mockCompleteASource(tx, wageStatements);
    const conflict = mockAssignedWageConflict(tx, {
      companyId: "company-2",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1",
      ...conflictInput
    });
    if (transition === "attested") conflict.attest();
    if (transition === "active") conflict.activate();
    if (transition === "compensated") conflict.compensate();

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "A" })]);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey,
        expectedRevision: 0,
        businessReason: "未构成活跃重叠的工资承担权威不得阻断A级历史接管"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "A",
        status: "prepared"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("issues only C when two A authorities compete for the same legacy closure", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const result = await fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));

    expect(result.options).toEqual([expect.objectContaining({ grade: "C", legacyFactCount: 1 })]);
    expect(result.options).not.toEqual(expect.arrayContaining([expect.objectContaining({ grade: "A" })]));
  });

  it("issues a C gap option when no unique complete A or B authority exists", async () => {
    const { service, selectionRefs, tx } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);

    const result = await service.options("finance-1", undefined, new Date("2026-09-04T00:01:00.000Z"));

    expect(result.options).toEqual([{
      selectionRef: expect.stringMatching(/^hwt1\./u),
      grade: "C",
      label: "C级待补证工资缺口（1个项目）",
      projectCount: 1,
      legacyFactCount: 1
    }]);
    expect(selectionRefs.read(result.options[0]!.selectionRef, new Date("2026-09-04T00:01:00.000Z"))).toEqual(expect.objectContaining({
      actorUserId: "finance-1",
      grade: "C",
      legacyCoordinates: [expect.objectContaining({ sourceBusinessId: "legacy-wage-1" })]
    }));
  });

  it("does not issue C when the exact legacy coordinate has a complete different-scope #219 gap occupancy", async () => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const occupancy = installCompleteDifferentScopeCGapOccupancy(
      tx,
      await captureCompleteCGapGraphFromPublicLifecycle()
    );
    const storedReadSet = occupancy.rowMapping.readSetSnapshot;
    expect(Object.keys(storedReadSet.plan).sort()).toEqual([
      "adjustmentRootProofs",
      "blockedReason",
      "conflictReadSet",
      "grade",
      "negativeAuthorityFrontier",
      "negativeAuthorityFrontierFingerprint",
      "projectDeltas",
      "projectIds",
      "sourceClosureFingerprint",
      "sourceFingerprint",
      "sourceVersionId",
      "summaryAuthorityFingerprint",
      "summarySourceVersionFingerprint",
      "wageReservation"
    ].sort());
    expect(occupancy.rowMapping.legacySourceSnapshot).toEqual(expect.objectContaining({
      factId: "fact-1",
      costImpactId: "impact-cost-1",
      costImpactSnapshot: {},
      costImpactFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      payableImpactId: "impact-payable-1",
      payableImpactSnapshot: {},
      payableImpactFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      businessReason: "创建 C 级前沿 scope 供后续稳定性校验"
    }));
    expect(occupancy.scope.readSetFingerprint).toBe(storedReadSet.readSetFingerprint);
    expect(occupancy.gap.gapSnapshot.readSetFingerprint).toBe(occupancy.scope.readSetFingerprint);
    expect(occupancy.gap.gapSnapshot.negativeAuthorityFrontierFingerprint)
      .toBe(storedReadSet.plan.negativeAuthorityFrontierFingerprint);
    expect(occupancy.rowMapping.mappingFingerprint).toBe(fingerprint({
      scopeId: occupancy.scope.id,
      projectId: "project-1",
      plan: storedReadSet.plan,
      legacy: storedReadSet.legacy
    }));
    const result = await service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );

    expect(result.options).toEqual([]);
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("keeps a real unresolved-coordinate C graph occupied after public options, create, apply, and activate", async () => {
    const captured = await captureCompleteCGapGraphFromPublicLifecycle(setupUnresolvedCLegacyFrontier());
    const storedPlan = captured.rowMapping.readSetSnapshot.plan;
    expect(captured.receipts.map((receipt) => receipt.action)).toEqual([
      "historical_wage_takeover.scope.create",
      "historical_wage_takeover.scope.apply",
      "historical_wage_takeover.scope.activate"
    ]);
    expect(storedPlan).toEqual(expect.objectContaining({
      grade: "C",
      blockedReason: "LEGACY_AUTHORITY_COORDINATE_UNRESOLVED",
      negativeAuthorityFrontier: expect.objectContaining({
        authorityScope: {
          state: "unresolved",
          employmentCompanyId: null,
          wageMonth: null,
          focusProjectId: "project-1",
          focusLegacyCoordinate: "project-1:project_wage:legacy-wage-1:1"
        }
      })
    }));
    expect(captured.gap).toEqual(expect.objectContaining({
      wageMonth: null,
      reasonCode: "LEGACY_AUTHORITY_COORDINATE_UNRESOLVED"
    }));
    expect(captured.rowMapping).toEqual(expect.objectContaining({
      mappingDecision: "GAP",
      conflictGroupKey: "wage:project-1:unresolved",
      wageApprovedSourceVersionId: null,
      wageStatementReservationId: null,
      historicalWageSummaryAuthorityVersionId: null
    }));

    const { service, tx, wageStatements } = setupUnresolvedCLegacyFrontier();
    installCompleteDifferentScopeCGapOccupancy(tx, captured);

    await expect(service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:05:00.000Z")
    )).resolves.toEqual({ options: [] });
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("keeps a fully compensated unresolved-coordinate C graph occupied", async () => {
    const captured = await captureCompleteCGapGraphFromPublicLifecycle(
      setupUnresolvedCLegacyFrontier(),
      true
    );
    const { service, tx, wageStatements } = setupUnresolvedCLegacyFrontier();
    installCompleteDifferentScopeCGapOccupancy(tx, captured);

    await expect(service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:05:00.000Z")
    )).resolves.toEqual({ options: [] });
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("keeps a fully compensated C graph occupied after validating its exact inverse causality", async () => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    installCompleteDifferentScopeCGapOccupancy(
      tx,
      await captureCompleteCGapGraphFromPublicLifecycle(
        setupAmbiguousCApprovedSourceFrontier(),
        true
      )
    );

    await expect(service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    )).resolves.toEqual({ options: [] });
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("normalizes every complete C occupancy collection before hashing the read-set", async () => {
    const { service, tx } = setup();
    const occupancy = installCompleteDifferentScopeCGapOccupancy(
      tx,
      await captureCompleteCGapGraphFromPublicLifecycle(
        setupAmbiguousCApprovedSourceFrontier(),
        true
      )
    );
    const reader = service as unknown as {
      readCFocusOccupancy(transaction: unknown, focus: unknown): Promise<unknown>;
    };

    const focus = {
      ...cLegacyReadSet(),
      legacySnapshot: {},
      costImpactSnapshot: {},
      payableImpactSnapshot: {}
    };
    const first = await reader.readCFocusOccupancy(tx, focus);
    occupancy.useOppositeStorageOrder();
    const reordered = await reader.readCFocusOccupancy(tx, focus);

    expect(fingerprint(reordered)).toBe(fingerprint(first));
  });

  it("rejects public C create with zero writes when a complete focus occupancy appears after options", async () => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    installCompleteDifferentScopeCGapOccupancy(tx, await captureCompleteCGapGraphFromPublicLifecycle());

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectConflict409(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898984",
        expectedRevision: 0,
        businessReason: "拒绝 options 后出现的完整 C focus occupancy"
      }, new Date("2026-09-04T00:02:00.000Z")), "C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("rejects public C apply with zero additional writes when a complete focus occupancy appears after create", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForApply();
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      installCompleteDifferentScopeCGapOccupancy(
        fixture.tx,
        await captureCompleteCGapGraphFromPublicLifecycle()
      );

      await expectConflict409(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898985",
        expectedRevision: 1,
        businessReason: "拒绝 create 后出现的完整 C focus occupancy"
      }, new Date("2026-09-04T00:03:00.000Z")), "C级负权威前沿已漂移");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C activate with zero additional writes when a complete focus occupancy appears after apply", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForActivate();
      const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      installCompleteDifferentScopeCGapOccupancy(
        fixture.tx,
        await captureCompleteCGapGraphFromPublicLifecycle()
      );

      await expectConflict409(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898986",
        expectedRevision: 2,
        businessReason: "拒绝 apply 后出现的完整 C focus occupancy"
      }, new Date("2026-09-04T00:04:00.000Z")), "C级负权威前沿已漂移");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
      expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
      expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it.each(cApprovedSourceFrontierDrifts)(
    "rejects public C create when the %s drifts while A remains ambiguous",
    async (_label, mutate) => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    mutate(fixture);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectConflict409(fixture.service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898989",
        expectedRevision: 0,
        businessReason: "C级必须冻结完整A级来源与物化权威前沿"
      }, new Date("2026-09-04T00:02:00.000Z")), "C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    }
  );

  it.each(cApprovedSourceFrontierDrifts)(
    "rejects public C apply when the %s drifts while A remains ambiguous",
    async (_label, mutate) => {
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createAmbiguousCScopeForApply();
        const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        mutate(fixture);

        await expectConflict409(fixture.service.apply("finance-1", {
          selectionRef: fixture.commandSelectionRef,
          idempotencyKey: "89898989-8989-4989-8989-898989898982",
          expectedRevision: 1,
          businessReason: "C级 apply 必须冻结完整 A 来源与物化权威前沿"
        }, new Date("2026-09-04T00:03:00.000Z")), "C级负权威前沿已漂移");
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(cApprovedSourceFrontierDrifts)(
    "rejects public C activate when the %s drifts while A remains ambiguous",
    async (_label, mutate) => {
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createAmbiguousCScopeForActivate();
        const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        mutate(fixture);

        await expectConflict409(fixture.service.activate("finance-director-1", {
          selectionRef: fixture.activationSelectionRef,
          idempotencyKey: "89898989-8989-4989-8989-898989898983",
          expectedRevision: 2,
          businessReason: "C级 activate 必须冻结完整 A 来源与物化权威前沿"
        }, new Date("2026-09-04T00:04:00.000Z")), "C级负权威前沿已漂移");
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
        expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
        expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
        expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it("changes the public C option fingerprint when a structurally valid ineligible planner result changes", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const now = new Date("2026-09-04T00:01:00.000Z");
    fixture.useIncompletePlannerAmount("2000");
    const first = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    const firstBinding = fixture.selectionRefs.read(first.selectionRef, now);
    expect(first).toEqual(expect.objectContaining({ grade: "C" }));

    fixture.useIncompletePlannerAmount("3000");
    const second = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    expect(second).toEqual(expect.objectContaining({ grade: "C" }));
    expect(fixture.selectionRefs.read(second.selectionRef, now)?.selectionFingerprint)
      .not.toBe(firstBinding?.selectionFingerprint);
  });

  it("changes the public C option fingerprint when a rejected planner prior matrix cell changes", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const prior = installRejectedPlannerPriorMatrixFrontier(fixture);
    const now = new Date("2026-09-04T00:01:00.000Z");
    const first = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    const firstBinding = fixture.selectionRefs.read(first.selectionRef, now);
    expect(first).toEqual(expect.objectContaining({ grade: "C" }));

    prior.mutatePriorCostCell();
    const second = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    expect(second).toEqual(expect.objectContaining({ grade: "C" }));
    expect(fixture.selectionRefs.read(second.selectionRef, now)?.selectionFingerprint)
      .not.toBe(firstBinding?.selectionFingerprint);
  });

  it.each(rootEligibilityVariants)(
    "changes the public C option fingerprint when a third same-identity root becomes %s-eligible",
    async (variant) => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const roots = installRejectedPlannerRootEligibilityFrontier(fixture, variant);
    const now = new Date("2026-09-04T00:01:00.000Z");
    const first = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    const firstBinding = fixture.selectionRefs.read(first.selectionRef, now);
    expect(first).toEqual(expect.objectContaining({ grade: "C" }));

    roots.makeThirdRootEligible();
    const second = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    expect(second).toEqual(expect.objectContaining({ grade: "C" }));
    expect(fixture.selectionRefs.read(second.selectionRef, now)?.selectionFingerprint)
      .not.toBe(firstBinding?.selectionFingerprint);
    }
  );

  it.each(rootEligibilityVariants)(
    "rejects public C create when a third same-identity root becomes %s-eligible",
    async (variant) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(fixture, variant);
      const issued = await fixture.service.options(
        "finance-1",
        "project-1",
        new Date("2026-09-04T00:01:00.000Z")
      );
      roots.makeThirdRootEligible();

      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        await expectConflict409(fixture.service.createScope("finance-1", {
          selectionRef: issued.options[0]!.selectionRef,
          idempotencyKey: "86868686-8686-4686-8686-868686868681",
          expectedRevision: 0,
          businessReason: "C级 create 必须冻结 root payable eligibility"
        }, new Date("2026-09-04T00:02:00.000Z")), "C级负权威前沿已漂移");
        expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(rootEligibilityVariants)(
    "rejects public C apply when a third same-identity root becomes %s-eligible",
    async (variant) => {
      const initial = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(initial, variant);
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createCScopeForApply(initial);
        const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        roots.makeThirdRootEligible();

        await expectConflict409(fixture.service.apply("finance-1", {
          selectionRef: fixture.commandSelectionRef,
          idempotencyKey: "86868686-8686-4686-8686-868686868682",
          expectedRevision: 1,
          businessReason: "C级 apply 必须冻结 root payable eligibility"
        }, new Date("2026-09-04T00:03:00.000Z")), "C级负权威前沿已漂移");
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(rootEligibilityVariants)(
    "rejects public C activate when a third same-identity root becomes %s-eligible",
    async (variant) => {
      const initial = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(initial, variant);
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createCScopeForActivate(initial);
        const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        roots.makeThirdRootEligible();

        await expectConflict409(fixture.service.activate("finance-director-1", {
          selectionRef: fixture.activationSelectionRef,
          idempotencyKey: "86868686-8686-4686-8686-868686868683",
          expectedRevision: 2,
          businessReason: "C级 activate 必须冻结 root payable eligibility"
        }, new Date("2026-09-04T00:04:00.000Z")), "C级负权威前沿已漂移");
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
        expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
        expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
        expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(rootOwnershipDrifts)(
    "changes the public C option fingerprint when canonical root %s ownership drifts",
    async (_label, mutate) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(fixture, "direction");
      const now = new Date("2026-09-04T00:01:00.000Z");
      const first = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
      const firstBinding = fixture.selectionRefs.read(first.selectionRef, now);
      mutate(roots);

      const second = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
      expect(first).toEqual(expect.objectContaining({ grade: "C" }));
      expect(second).toEqual(expect.objectContaining({ grade: "C" }));
      expect(fixture.selectionRefs.read(second.selectionRef, now)?.selectionFingerprint)
        .not.toBe(firstBinding?.selectionFingerprint);
      expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(4);
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    }
  );

  it.each(rootOwnershipDrifts)(
    "rejects public C createScope when canonical root %s ownership drifts",
    async (_label, mutate) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(fixture, "direction");
      const issued = await fixture.service.options(
        "finance-1",
        "project-1",
        new Date("2026-09-04T00:01:00.000Z")
      );
      const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
      mutate(roots);
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        await expectCMatrixConflict409(fixture.service.createScope("finance-1", {
          selectionRef: issued.options[0]!.selectionRef,
          idempotencyKey: "84848484-8484-4484-8484-848484848481",
          expectedRevision: 0,
          businessReason: "C级 createScope 必须冻结 canonical root ownership"
        }, new Date("2026-09-04T00:02:00.000Z")),
        "C级负权威前沿已漂移，必须零写入失败并重新获取 selectionRef");
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction)
          .toHaveBeenCalledTimes(plannerCallsBefore + 2);
        expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(rootOwnershipDrifts)(
    "rejects public C apply when canonical root %s ownership drifts",
    async (_label, mutate) => {
      const initial = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(initial, "direction");
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createCScopeForApply(initial);
        const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
        mutate(roots);
        await expectCMatrixConflict409(fixture.service.apply("finance-1", {
          selectionRef: fixture.commandSelectionRef,
          idempotencyKey: "84848484-8484-4484-8484-848484848482",
          expectedRevision: 1,
          businessReason: "C级 apply 必须重验 canonical root ownership"
        }, new Date("2026-09-04T00:03:00.000Z")),
        "C级负权威前沿已漂移，必须零写入失败并重新获取 selectionRef");
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction)
          .toHaveBeenCalledTimes(plannerCallsBefore + 2);
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(rootOwnershipDrifts)(
    "rejects public C activate when canonical root %s ownership drifts",
    async (_label, mutate) => {
      const initial = setupAmbiguousCApprovedSourceFrontier();
      const roots = installRejectedPlannerRootEligibilityFrontier(initial, "direction");
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createCScopeForActivate(initial);
        const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
        mutate(roots);
        await expectCMatrixConflict409(fixture.service.activate("finance-director-1", {
          selectionRef: fixture.activationSelectionRef,
          idempotencyKey: "84848484-8484-4484-8484-848484848483",
          expectedRevision: 2,
          businessReason: "C级 activate 必须重验 canonical root ownership"
        }, new Date("2026-09-04T00:04:00.000Z")),
        "C级负权威前沿已漂移，必须零写入失败并重新获取 selectionRef");
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction)
          .toHaveBeenCalledTimes(plannerCallsBefore + 2);
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
        expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
        expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
        expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it("reads the rejected planner prior matrix with the complete deterministic dependency projection", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    installRejectedPlannerPriorMatrixFrontier(fixture);
    await fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));

    expect(fixture.tx.wageStatementVersion.findFirst).toHaveBeenCalledWith({
      where: { statementId: "statement-existing", revision: 1 },
      select: {
        id: true,
        statementId: true,
        revision: true,
        kind: true,
        status: true,
        projectionOrigin: true,
        sourceVersionId: true,
        sourceSnapshot: true,
        operatingProjectionSnapshot: true,
        personLines: {
          select: {
            id: true,
            employeeId: true,
            employmentSnapshotId: true,
            costComponents: {
              select: {
                id: true,
                componentCode: true,
                amountCents: true,
                projectAllocations: {
                  select: { id: true, projectAllocationId: true, amountCents: true },
                  orderBy: { id: "asc" }
                }
              },
              orderBy: { id: "asc" }
            },
            creditorBreakdowns: {
              select: {
                id: true,
                creditorSubjectType: true,
                creditorSubjectIdentityKey: true,
                creditorCategory: true,
                amountCents: true,
                projectAllocations: {
                  select: { id: true, projectAllocationId: true, amountCents: true },
                  orderBy: { id: "asc" }
                }
              },
              orderBy: { id: "asc" }
            },
            projectAllocations: {
              select: {
                id: true,
                projectId: true,
                serviceSnapshotId: true,
                amountCents: true,
                componentAllocations: {
                  select: {
                    id: true,
                    costComponentId: true,
                    amountCents: true,
                    costComponent: { select: { id: true, componentCode: true } }
                  },
                  orderBy: { id: "asc" }
                },
                creditorAllocations: {
                  select: {
                    id: true,
                    creditorBreakdownId: true,
                    amountCents: true,
                    creditorBreakdown: {
                      select: {
                        id: true,
                        creditorSubjectType: true,
                        creditorSubjectIdentityKey: true,
                        creditorCategory: true
                      }
                    }
                  },
                  orderBy: { id: "asc" }
                }
              },
              orderBy: { id: "asc" }
            }
          },
          orderBy: { id: "asc" }
        }
      }
    });
  });

  it("reads the rejected planner root payable identities with the exact deterministic dependency projection", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    installRejectedPlannerPriorMatrixFrontier(fixture);
    fixture.tx.wagePayableRef.findMany.mockImplementation((query) => {
      expect(query).toEqual({
        where: {
          adjustsPayableRefId: null,
          direction: "increase",
          confirmedVersion: {
            statementId: "statement-existing",
            revision: { lte: 1 },
            status: "confirmed",
            projectionOrigin: "historical_takeover_legacy_link"
          }
        },
        select: {
          id: true,
          confirmedVersionId: true,
          direction: true,
          amountCents: true,
          debtorCompanyId: true,
          costBearingCompanyId: true,
          projectId: true,
          confirmedVersion: {
            select: {
              id: true,
              revision: true,
              status: true,
              projectionOrigin: true
            }
          },
          projectAllocation: { select: { serviceSnapshotId: true } },
          personLine: { select: { employeeId: true, employmentSnapshotId: true } },
          creditorBreakdown: {
            select: {
              creditorSubjectType: true,
              creditorSubjectIdentityKey: true,
              creditorCategory: true
            }
          },
          adjustments: {
            select: { id: true, direction: true, amountCents: true },
            orderBy: { id: "asc" }
          }
        },
        orderBy: { id: "asc" }
      });
      return Promise.resolve([]);
    });

    await expect(fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    )).resolves.toEqual(expect.objectContaining({ options: [expect.objectContaining({ grade: "C" })] }));
  });

  it.each(invalidPriorDependencyFrontiers)(
    "rejects public options before planner downgrade on %s",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      const frontier = installRejectedPlannerPriorMatrixFrontier(fixture);
      makeInvalid(frontier);

      await expectCMatrixConflict409(
        fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
      expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(invalidPriorDependencyFrontiers)(
    "rejects public C create before planner downgrade on %s",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      const frontier = installRejectedPlannerPriorMatrixFrontier(fixture);
      const issued = await fixture.service.options(
        "finance-1",
        "project-1",
        new Date("2026-09-04T00:01:00.000Z")
      );
      const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
      makeInvalid(frontier);
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        await expectCMatrixConflict409(fixture.service.createScope("finance-1", {
          selectionRef: issued.options[0]!.selectionRef,
          idempotencyKey: "85858585-8585-4585-8585-858585858581",
          expectedRevision: 0,
          businessReason: "C级 create 必须先拒绝非法 prior dependency"
        }, new Date("2026-09-04T00:02:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
        expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(plannerCallsBefore);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(invalidPriorDependencyFrontiers)(
    "rejects public C apply before planner downgrade on %s",
    async (_label, makeInvalid) => {
      const initial = setupAmbiguousCApprovedSourceFrontier();
      const frontier = installRejectedPlannerPriorMatrixFrontier(initial);
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createCScopeForApply(initial);
        const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
        makeInvalid(frontier);

        await expectCMatrixConflict409(fixture.service.apply("finance-1", {
          selectionRef: fixture.commandSelectionRef,
          idempotencyKey: "85858585-8585-4585-8585-858585858582",
          expectedRevision: 1,
          businessReason: "C级 apply 必须先拒绝非法 prior dependency"
        }, new Date("2026-09-04T00:03:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(plannerCallsBefore);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(invalidPriorDependencyFrontiers)(
    "rejects public C activate before planner downgrade on %s",
    async (_label, makeInvalid) => {
      const initial = setupAmbiguousCApprovedSourceFrontier();
      const frontier = installRejectedPlannerPriorMatrixFrontier(initial);
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createCScopeForActivate(initial);
        const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
        makeInvalid(frontier);

        await expectCMatrixConflict409(fixture.service.activate("finance-director-1", {
          selectionRef: fixture.activationSelectionRef,
          idempotencyKey: "85858585-8585-4585-8585-858585858583",
          expectedRevision: 2,
          businessReason: "C级 activate 必须先拒绝非法 prior dependency"
        }, new Date("2026-09-04T00:04:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(plannerCallsBefore);
        expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
        expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
        expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it("rejects public C create when a rejected planner prior matrix cell changes", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const prior = installRejectedPlannerPriorMatrixFrontier(fixture);
    const issued = await fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    prior.mutatePriorCostCell();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectConflict409(fixture.service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878784",
        expectedRevision: 0,
        businessReason: "C级必须冻结被拒绝 planner 的 prior matrix 读取集"
      }, new Date("2026-09-04T00:02:00.000Z")), "C级负权威前沿已漂移");
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C apply when a rejected planner prior matrix cell changes", async () => {
    const initial = setupAmbiguousCApprovedSourceFrontier();
    const prior = installRejectedPlannerPriorMatrixFrontier(initial);
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForApply(initial);
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      prior.mutatePriorCostCell();
      await expectConflict409(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878785",
        expectedRevision: 1,
        businessReason: "apply 必须重验被拒绝 planner 的 prior matrix 读取集"
      }, new Date("2026-09-04T00:03:00.000Z")), "C级负权威前沿已漂移");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C activate when a rejected planner prior matrix cell changes", async () => {
    const initial = setupAmbiguousCApprovedSourceFrontier();
    const prior = installRejectedPlannerPriorMatrixFrontier(initial);
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForActivate(initial);
      const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      prior.mutatePriorCostCell();
      await expectConflict409(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878786",
        expectedRevision: 2,
        businessReason: "activate 必须重验被拒绝 planner 的 prior matrix 读取集"
      }, new Date("2026-09-04T00:04:00.000Z")), "C级负权威前沿已漂移");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
      expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
      expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C create when a structurally valid ineligible planner result changes", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    fixture.useIncompletePlannerAmount("2000");
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    fixture.useIncompletePlannerAmount("3000");

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectConflict409(fixture.service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878781",
        expectedRevision: 0,
        businessReason: "C级必须冻结结构合法但不满足 legacy 闭合的 planner 结果"
      }, new Date("2026-09-04T00:02:00.000Z")), "C级负权威前沿已漂移");
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C apply when a structurally valid ineligible planner result changes", async () => {
    const initial = setupAmbiguousCApprovedSourceFrontier();
    initial.useIncompletePlannerAmount("2000");
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForApply(initial);
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      fixture.useIncompletePlannerAmount("3000");
      await expectConflict409(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878782",
        expectedRevision: 1,
        businessReason: "apply 必须重验不满足 legacy 闭合的 planner 结果"
      }, new Date("2026-09-04T00:03:00.000Z")), "C级负权威前沿已漂移");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C activate when a structurally valid ineligible planner result changes", async () => {
    const initial = setupAmbiguousCApprovedSourceFrontier();
    initial.useIncompletePlannerAmount("2000");
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createCScopeForActivate(initial);
      const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      fixture.useIncompletePlannerAmount("3000");
      await expectConflict409(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878783",
        expectedRevision: 2,
        businessReason: "activate 必须重验不满足 legacy 闭合的 planner 结果"
      }, new Date("2026-09-04T00:04:00.000Z")), "C级负权威前沿已漂移");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
      expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
      expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C create when an invalid A materialization dependency changes but remains invalid", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    fixture.removeCompany();
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    fixture.mutateEmployeeName();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectConflict409(fixture.service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "89999999-8999-4999-8999-899999999999",
        expectedRevision: 0,
        businessReason: "C级不得吞掉持续无效的A级物化依赖漂移"
      }, new Date("2026-09-04T00:02:00.000Z")), "C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it.each(invalidCPlannerInputs)(
    "rejects public options when the C negative planner returns %s instead of issuing a gap selection",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      makeInvalid(fixture);

      await expectCMatrixConflict409(
        fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    }
  );

  it("keeps a real business planner conflict in C without matching its error text", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    fixture.wageStatements.planHistoricalTakeoverInTransaction.mockRejectedValue(
      new ConflictException("同一工资债权语义命中多个可用 canonical root")
    );

    await expect(fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    )).resolves.toEqual(expect.objectContaining({
      options: [expect.objectContaining({ grade: "C" })]
    }));
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it.each(structuralApprovedSourceFailures)(
    "rejects public options before planner downgrade on %s",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      makeInvalid(fixture);

      await expectCMatrixConflict409(
        fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
      expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(invalidCApprovedSourceInputs)(
    "rejects public options when the C authority candidate contains %s instead of issuing a gap selection",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      makeInvalid(fixture);
      fixture.removeCompany();

      await expectCMatrixConflict409(
        fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    }
  );

  it.each(requiredApprovedSourceHeaders)(
    "rejects public options before planner downgrade when the approved source omits required %s",
    async (header) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      fixture.removeSourceHeader(header);

      await expectCMatrixConflict409(
        fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
      expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(approvedSourceParityFailures)(
    "rejects public options before planner downgrade on %s failure",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      makeInvalid(fixture);

      await expectCMatrixConflict409(
        fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
      expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    }
  );

  it("rejects public options before planner downgrade on a nested null project allocation", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    fixture.useNullProjectAllocation();

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
  });

  it.each(invalidApprovedSourceLifecycleMutations)(
    "rejects public C create before planner downgrade on approved-source %s",
    async (_label, makeInvalid) => {
      const fixture = setupAmbiguousCApprovedSourceFrontier();
      const issued = await fixture.service.options(
        "finance-1",
        "project-1",
        new Date("2026-09-04T00:01:00.000Z")
      );
      const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
      makeInvalid(fixture);

      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        await expectCMatrixConflict409(fixture.service.createScope("finance-1", {
          selectionRef: issued.options[0]!.selectionRef,
          idempotencyKey: "88888888-8888-4888-8888-888888888881",
          expectedRevision: 0,
          businessReason: "malformed A source 必须先于 create planner 降级失败"
        }, new Date("2026-09-04T00:02:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
        expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(plannerCallsBefore);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(invalidApprovedSourceLifecycleMutations)(
    "rejects public C apply before planner downgrade on approved-source %s",
    async (_label, makeInvalid) => {
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createAmbiguousCScopeForApply();
        const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
        makeInvalid(fixture);

        await expectCMatrixConflict409(fixture.service.apply("finance-1", {
          selectionRef: fixture.commandSelectionRef,
          idempotencyKey: "88888888-8888-4888-8888-888888888882",
          expectedRevision: 1,
          businessReason: "malformed A source 必须先于 apply planner 降级失败"
        }, new Date("2026-09-04T00:03:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(plannerCallsBefore);
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it.each(invalidApprovedSourceLifecycleMutations)(
    "rejects public C activate before planner downgrade on approved-source %s",
    async (_label, makeInvalid) => {
      const savedSha = process.env.BUILD_COMMIT_SHA;
      process.env.BUILD_COMMIT_SHA = "f".repeat(40);
      try {
        const fixture = await createAmbiguousCScopeForActivate();
        const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
        const plannerCallsBefore = fixture.wageStatements.planHistoricalTakeoverInTransaction.mock.calls.length;
        makeInvalid(fixture);

        await expectCMatrixConflict409(fixture.service.activate("finance-director-1", {
          selectionRef: fixture.activationSelectionRef,
          idempotencyKey: "88888888-8888-4888-8888-888888888883",
          expectedRevision: 2,
          businessReason: "malformed A source 必须先于 activate planner 降级失败"
        }, new Date("2026-09-04T00:04:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
        expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
        expect(fixture.wageStatements.planHistoricalTakeoverInTransaction).toHaveBeenCalledTimes(plannerCallsBefore);
        expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
        expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
        expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      } finally {
        if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
        else process.env.BUILD_COMMIT_SHA = savedSha;
      }
    }
  );

  it("rejects a malformed B authority snapshot instead of interpreting it as an absent C candidate", async () => {
    const fixture = setupMalformedBSummaryCFrontier();
    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it("rejects public B create at the authority-input gate when the signed summary becomes malformed", async () => {
    const fixture = setup();
    const fact = {
      ...legacyFact,
      sourceSnapshot: { historicalWageSummaryAuthority: r2HistoricalSummary() }
    };
    fixture.tx.operatingFact.findMany.mockResolvedValue([fact]);
    fixture.tx.operatingFact.findUnique.mockResolvedValue(fact);
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    expect(issued.options).toEqual([expect.objectContaining({ grade: "B" })]);
    fact.sourceSnapshot = {
      historicalWageSummaryAuthority: {
        schemaVersion: 1,
        sourceDiscriminator: "historical_wage_summary"
      }
    } as never;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectCMatrixConflict409(fixture.service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "93939393-9393-4393-8393-939393939391",
        expectedRevision: 0,
        businessReason: "B级 create 必须先拒绝非法权威快照"
      }, new Date("2026-09-04T00:02:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it.each([
    ["apply", "finance-1", ["finance_staff"]],
    ["activate", "finance-director-3", ["finance_director"]]
  ] as const)("rejects public B %s at the authority-input gate when the frozen summary becomes malformed", async (action, actorUserId, actorRoles) => {
    const fixture = await captureActiveBPrior(r2HistoricalSummary());
    const fact = {
      ...legacyFact,
      sourceSnapshot: { historicalWageSummaryAuthority: r2HistoricalSummary() }
    };
    fixture.tx.operatingFact.findUnique.mockResolvedValue(fact);
    fixture.tx.operatingTakeoverAtomicScopeVersion.findUnique.mockImplementation(
      (query: PrismaScopeFindUniqueQuery) => Promise.resolve(prismaInclude(fixture.preparedScope, query.include))
    );
    fixture.roles.resolveActiveRoleScopesInTransaction.mockResolvedValue([...actorRoles]);
    const scopedBinding = fixture.selectionRefs.read(
      fixture.commandSelectionRef,
      new Date("2026-09-03T00:01:00.000Z")
    )!;
    const selectionRef = fixture.selectionRefs.issue(
      { ...scopedBinding, actorUserId },
      new Date("2026-09-04T00:00:00.000Z")
    );
    fact.sourceSnapshot = {
      historicalWageSummaryAuthority: {
        schemaVersion: 1,
        sourceDiscriminator: "historical_wage_summary"
      }
    } as never;
    const writesBefore = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
    const command = {
      selectionRef,
      idempotencyKey: action === "apply"
        ? "93939393-9393-4393-8393-939393939392"
        : "93939393-9393-4393-8393-939393939393",
      expectedRevision: 1,
      businessReason: `B级 ${action} 必须先拒绝非法权威快照`
    };

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectCMatrixConflict409(
        action === "apply"
          ? fixture.service.apply(actorUserId, command, new Date("2026-09-04T00:03:00.000Z"))
          : fixture.service.activate(actorUserId, command, new Date("2026-09-04T00:04:00.000Z")),
        INVALID_C_FRONTIER_INPUT_MESSAGE
      );
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesBefore);
  });

  it("rejects public C create before fingerprint comparison when the current planner input is malformed", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const issued = await fixture.service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );
    const cOption = issued.options.find((option) => option.grade === "C");
    expect(cOption).toBeDefined();
    fixture.usePlannerWithEmptyProjectId();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectCMatrixConflict409(fixture.service.createScope("finance-1", {
        selectionRef: cOption!.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898970",
        expectedRevision: 0,
        businessReason: "非法 planner 输入必须先于 C 前沿指纹比较失败"
      }, new Date("2026-09-04T00:02:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
      expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C apply before fingerprint comparison when the current planner input is malformed", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForApply();
      const writesAfterCreate = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      fixture.usePlannerWithEmptyProjectId();

      await expectCMatrixConflict409(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898971",
        expectedRevision: 1,
        businessReason: "apply 必须先拒绝非法 planner 输入"
      }, new Date("2026-09-04T00:03:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterCreate);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects public C activate before fingerprint comparison when the current planner input is malformed", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForActivate();
      const writesAfterApply = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      fixture.usePlannerWithEmptyProjectId();

      await expectCMatrixConflict409(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898972",
        expectedRevision: 2,
        businessReason: "activate 必须先拒绝非法 planner 输入"
      }, new Date("2026-09-04T00:04:00.000Z")), INVALID_C_FRONTIER_INPUT_MESSAGE);
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, writesAfterApply);
      expect(fixture.tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
      expect(fixture.tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("normalizes C A-source and materialization collections before signing and accepts the old selection", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const optionsAt = new Date("2026-09-04T00:01:00.000Z");
    const first = (await fixture.service.options("finance-1", "project-1", optionsAt)).options[0]!;
    const firstBinding = fixture.selectionRefs.read(first.selectionRef, optionsAt);
    expect(first).toEqual(expect.objectContaining({ grade: "C" }));
    fixture.useOppositeQueryOrder();
    const reordered = (await fixture.service.options("finance-1", "project-1", optionsAt)).options[0]!;
    expect(fixture.selectionRefs.read(reordered.selectionRef, optionsAt)?.selectionFingerprint)
      .toBe(firstBinding?.selectionFingerprint);

    fixture.tx.operatingTakeoverManifestVersion.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverAtomicScopeProject.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverRowMapping.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverCommandReceipt.create.mockImplementation(({ data }) => Promise.resolve(data));
    fixture.tx.operatingTakeoverCommandReceiptLine.create.mockImplementation(({ data }) => Promise.resolve(data));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(fixture.service.createScope("finance-1", {
        selectionRef: first.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898987",
        expectedRevision: 0,
        businessReason: "仅查询集合顺序变化时旧 C selectionRef 仍可创建"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "prepared"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("normalizes the complete multi-project planner result before signing the C frontier", async () => {
    const fixture = setupAmbiguousCApprovedSourceFrontier();
    const now = new Date("2026-09-04T00:01:00.000Z");
    const first = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    const firstBinding = fixture.selectionRefs.read(first.selectionRef, now);
    expect(first).toEqual(expect.objectContaining({ grade: "C" }));

    fixture.useOppositePlannerOrder();
    const reordered = (await fixture.service.options("finance-1", "project-1", now)).options[0]!;
    expect(fixture.selectionRefs.read(reordered.selectionRef, now)?.selectionFingerprint)
      .toBe(firstBinding?.selectionFingerprint);
  });

  it("accepts a public C apply when only authoritative query order changes", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForApply();
      fixture.useOppositeQueryOrder();
      fixture.useOppositePlannerOrder();
      await expect(fixture.service.apply("finance-1", {
        selectionRef: fixture.commandSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898973",
        expectedRevision: 1,
        businessReason: "仅权威查询顺序变化时 apply 继续"
      }, new Date("2026-09-04T00:03:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "inactive_applied",
        revision: 2
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("accepts a public C activate when only authoritative query order changes", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForActivate();
      fixture.useOppositeQueryOrder();
      fixture.useOppositePlannerOrder();
      fixture.tx.unresolvedWagePayableGap.create.mockImplementation(({ data }) => Promise.resolve(data));
      fixture.tx.operatingTakeoverLegacySourceBridge.create.mockImplementation(({ data }) => Promise.resolve(data));
      await expect(fixture.service.activate("finance-director-1", {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898974",
        expectedRevision: 2,
        businessReason: "仅权威查询顺序变化时 activate 继续"
      }, new Date("2026-09-04T00:04:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "activated",
        revision: 3
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("completes the no-drift public C lifecycle and replays the exact activation without another write", async () => {
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const fixture = await createAmbiguousCScopeForActivate();
      fixture.tx.unresolvedWagePayableGap.create.mockImplementation(({ data }) => Promise.resolve(data));
      fixture.tx.operatingTakeoverLegacySourceBridge.create.mockImplementation(({ data }) => Promise.resolve(data));
      const command = {
        selectionRef: fixture.activationSelectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898988",
        expectedRevision: 2,
        businessReason: "无漂移 C 级只创建 gap 和一对一 bridge"
      };
      const activationAt = new Date("2026-09-04T00:04:00.000Z");
      const beforeActivation = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      const firstActivationReceiptLineCallIndex = fixture.tx.operatingTakeoverCommandReceiptLine.create.mock.calls.length;
      const activated = await fixture.service.activate("finance-director-1", command, activationAt);
      expect(activated).toEqual(expect.objectContaining({
        grade: "C",
        status: "activated",
        revision: 3,
        rows: [expect.objectContaining({
          projectId: "project-1",
          decision: "GAP",
          targetKind: "unresolved_wage_payable_gap"
        })]
      }));
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, beforeActivation, {
        "unresolvedWagePayableGap.create": 1,
        "operatingTakeoverLegacySourceBridge.create": 1,
        "operatingTakeoverCommandReceipt.create": 1,
        "operatingTakeoverCommandReceiptLine.create": 1,
        "auditLog.create": 1
      });
      expect(fixture.wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
      expect(fixture.tx.wageTakeoverProjectionEnvelope.create).not.toHaveBeenCalled();

      const activationReceipt = fixture.tx.operatingTakeoverCommandReceipt.create.mock.calls.at(-1)![0].data;
      persistLatestScopeReceipt(fixture.tx, fixture.scope, firstActivationReceiptLineCallIndex);
      fixture.tx.operatingTakeoverCommandReceipt.findUnique.mockImplementation(({ where }) => Promise.resolve(
        where?.idempotencyKey === command.idempotencyKey ? activationReceipt : null
      ));
      const afterActivation = captureTakeoverWrites(fixture.tx, fixture.wageStatements);
      await expect(fixture.service.activate("finance-director-1", command, activationAt)).resolves.toEqual(activated);
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, afterActivation);

      await expectConflict409(fixture.service.activate("finance-director-1", {
        ...command,
        idempotencyKey: "89898989-8989-4989-8989-898989898998",
        expectedRevision: 3
      }, new Date("2026-09-04T00:05:00.000Z")), "已经激活");
      expectTakeoverWriteDelta(fixture.tx, fixture.wageStatements, afterActivation);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects a server-issued C selection when a complete A authority appears before scope creation", async () => {
    const { service, tx, wageStatements } = setup();
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);

    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-new",
      employmentCompanyId: "company-1",
      evidenceFileId: "approved-evidence-new",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceFingerprint: "b".repeat(64),
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    });
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-new",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" }]
    });
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "81818181-8181-4181-8181-818181818181",
        expectedRevision: 0,
        businessReason: "C级签发后出现A级权威必须重新选项"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toThrow("C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx);
  });

  it("rejects a server-issued C selection when one of two competing A authorities disappears", async () => {
    const { service, tx, wageStatements } = setup();
    const evidenceSha256 = "c".repeat(64);
    const sourceBase = {
      employmentCompanyId: "company-1",
      evidenceFileId: "approved-evidence-1",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    };
    const sources = [
      schemaFaithfulApprovedSource({ ...sourceBase, id: "approved-source-1" }),
      schemaFaithfulApprovedSource({ ...sourceBase, id: "approved-source-2" })
    ];
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue(sources);
    tx.wageApprovedSourceVersion.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(sources.find((source) => source.id === where.id) ?? null)
    );
    tx.fileObject.findUnique.mockResolvedValue({ id: "approved-evidence-1", storageStatus: "active", contentSha256: evidenceSha256 });
    wageStatements.planHistoricalTakeoverInTransaction.mockImplementation((_tx, input) => Promise.resolve({
      targetWageStatementId: `statement-${input.sourceVersionId}`,
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" }]
    }));
    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([sources[0]]);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "82828282-8282-4282-8282-828282828282",
        expectedRevision: 0,
        businessReason: "A级歧义被解除后不得沿用旧C级选择"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toThrow("C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx);
  });

  it("rejects a server-issued C selection when a blocking #214 line in another A project drifts", async () => {
    const { service, tx, wageStatements } = setup();
    const secondLegacyFact = {
      ...legacyFact,
      id: "fact-2",
      projectId: "project-2",
      sourceBusinessId: "legacy-wage-2",
      amountCents: 2000n,
      impacts: [
        { id: "impact-cost-2", impactKind: "confirmed_cost", amountCents: 2000n, direction: "increase", sourceImpactKey: "cost" },
        { id: "impact-payable-2", impactKind: "payable_increase", amountCents: 2000n, direction: "increase", sourceImpactKey: "payable" }
      ]
    };
    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-cross-project",
      employmentCompanyId: "company-1",
      sourceFingerprint: "b".repeat(64),
      evidenceFileId: "approved-evidence-1",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "3000",
          evidenceSha256,
          projectAllocations: [
            { projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" },
            { projectId: "project-2", serviceSnapshotId: "service-2", amountCents: "2000" }
          ]
        }]
      }
    });
    let lineFingerprint = "1".repeat(64);
    tx.operatingFact.findMany.mockResolvedValue([legacyFact, secondLegacyFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    tx.projectAffiliateCompanyContract.findMany.mockImplementation(({ where }) => Promise.resolve(
      (!where.companyEntityId || where.companyEntityId === "company-1") && where.projectId.in.includes("project-2")
        ? [{
            id: "affiliate-contract-project-2",
            projectId: "project-2",
            companyEntityId: "company-1",
            companyEntityVersionId: "company-version-1",
            requestFingerprint: "5".repeat(64),
            fileContentSha256Snapshot: "6".repeat(64)
          }]
        : []
    ));
    tx.affiliateClearingAuthorityVersion.findMany.mockResolvedValue([{
      id: "authority-project-2",
      affiliateCompanyContractId: "affiliate-contract-project-2",
      authorityFingerprint: "2".repeat(64)
    }]);
    tx.assignedWageAuthorityLine.findMany.mockImplementation(() => Promise.resolve([{
      id: "assigned-wage-project-2",
      authorityVersionId: "authority-project-2",
      projectId: "project-2",
      coverageKind: "ROLE_SUMMARY",
      personAuthorityKey: null,
      lineFingerprint
    }]));
    tx.operatingTakeoverRowMapping.findMany.mockResolvedValue([{
      id: "mapping-assigned-wage-project-2",
      manifestVersionId: "manifest-assigned-wage-project-2",
      projectId: "project-2",
      authorityVersionId: "authority-project-2",
      authorityLineId: "assigned-wage-project-2"
    }]);
    tx.operatingTakeoverCommandReceipt.findMany.mockResolvedValue([{
      id: "activation-assigned-wage-project-2",
      manifestVersionId: "manifest-assigned-wage-project-2",
      action: "manifest.activate",
      status: "activated",
      lines: [{ rowMappingId: "mapping-assigned-wage-project-2" }],
      causedReceipts: []
    }]);
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-cross-project",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [
        { projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" },
        { projectId: "project-2", signedCostDeltaCents: "2000", signedPayableDeltaCents: "2000" }
      ]
    });
    mockAMaterializationAuthority(tx, source);

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    lineFingerprint = "3".repeat(64);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "83838383-8383-4383-8383-838383838383",
        expectedRevision: 0,
        businessReason: "A级跨项目阻断行漂移后不得沿用旧C级选择"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toThrow("C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx);
  });

  it("does not invalidate a C selection when a confirmed zero-line #214 authority disappears before activation", async () => {
    const { service, tx } = setup();
    const contract = {
      id: "affiliate-contract-1",
      projectId: "project-1",
      companyEntityId: "company-1",
      companyEntityVersionId: "company-version-1",
      requestFingerprint: "4".repeat(64),
      fileContentSha256Snapshot: "5".repeat(64)
    };
    let authorityPresent = true;
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    tx.projectAffiliateCompanyContract.findMany.mockResolvedValue([contract]);
    tx.affiliateClearingAuthorityVersion.findMany.mockImplementation(() => Promise.resolve(
      authorityPresent
        ? [{
            id: "authority-zero-lines",
            affiliateCompanyContractId: contract.id,
            authorityFingerprint: "6".repeat(64)
          }]
        : []
    ));
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([]);

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    authorityPresent = false;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "84848484-8484-4484-8484-848484848484",
        expectedRevision: 0,
        businessReason: "未激活且零行的工资承担权威不进入冲突前沿"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "C",
        status: "prepared"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expect(tx.operatingTakeoverAtomicScopeVersion.create).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate a C selection for a #214 authority in another company", async () => {
    const { service, tx } = setup();
    let unrelatedAuthorityExists = false;
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    tx.projectAffiliateCompanyContract.findMany.mockImplementation(({ where }) => Promise.resolve(
      unrelatedAuthorityExists && where.companyEntityId === "company-2"
        ? [{
            id: "affiliate-contract-other-company",
            projectId: "project-1",
            companyEntityId: "company-2",
            companyEntityVersionId: "company-version-2",
            requestFingerprint: "7".repeat(64),
            fileContentSha256Snapshot: "8".repeat(64)
          }]
        : []
    ));

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    unrelatedAuthorityExists = true;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "85858585-8585-4585-8585-858585858585",
        expectedRevision: 0,
        businessReason: "其他公司同项目同月权威不属于本债务公司冲突前沿"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({ grade: "C" }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expect(tx.projectAffiliateCompanyContract.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyEntityId: "company-1" })
    }));
  });

  it("rejects a server-issued C selection when an invalid canonical wage dependency changes but remains invalid", async () => {
    const { service, tx, wageStatements } = setup();
    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-invalid",
      employmentCompanyId: "company-1",
      sourceFingerprint: "b".repeat(64),
      evidenceFileId: "approved-evidence-invalid",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    });
    let currentRevision = 1;
    installOperatingFactQueryContract(tx.operatingFact, [legacyFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    tx.wageStatement.findUnique.mockImplementation(() => Promise.resolve({
      id: "statement-existing",
      currentRevision
    }));
    tx.wageStatementVersion.findFirst.mockImplementation(() => Promise.resolve({
      id: `prior-version-${currentRevision}`,
      statementId: "statement-existing",
      revision: currentRevision,
      kind: "base",
      status: "confirmed",
      projectionOrigin: "historical_takeover_legacy_link",
      sourceVersionId: `prior-source-${currentRevision}`,
      operatingProjectionSnapshot: null,
      sourceSnapshot: source.sourceSnapshot,
      personLines: canonicalPriorPersonLines()
    }));
    wageStatements.planHistoricalTakeoverInTransaction.mockRejectedValue(
      new ConflictException("CANONICAL_WAGE_DEPENDENCY_INVALID")
    );

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    currentRevision = 2;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "86868686-8686-4686-8686-868686868686",
        expectedRevision: 0,
        businessReason: "A级仍不可用但 canonical 当前版本已变化"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toThrow("C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx);
  });

  it("rejects options with the frozen 409 when a persisted B lineage is invalid", async () => {
    const { service, tx } = setup();
    const summary = r2HistoricalSummary();
    const parsed = parseHistoricalWageSummaryAuthority(summary)!;
    const summaryFact = {
      ...legacyFact,
      sourceSnapshot: { historicalWageSummaryAuthority: summary }
    };
    const priorRevision = 1;
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const priorSummary = () => ({
      id: `prior-summary-${priorRevision}`,
      atomicScopeVersionId: `prior-scope-${priorRevision}`,
      summaryBucketKey: "company-1:project-1:engineering_technical:2026-08",
      revision: priorRevision,
      sourceVersionFingerprint: `${priorRevision}`.repeat(64),
      authorityFingerprint: `${priorRevision + 2}`.repeat(64),
      assignedWageExclusionSetFingerprint: `${priorRevision + 4}`.repeat(64),
      lineageRootAuthorityVersionId: null,
      supersedesVersionId: null,
      sourceDeltaFingerprint: `${priorRevision + 6}`.repeat(64),
      rootClosureFingerprint: `${priorRevision + 8}`.repeat(64),
      creditorLines: [{
        id: `prior-summary-line-${priorRevision}`,
        stableBucketKey: parsed.lines[0]!.creditorStableKey,
        stableBucketKeyFingerprint: `${priorRevision + 10}`.repeat(64),
        targetFingerprint: `${priorRevision + 12}`.repeat(64),
        deltaFingerprint: `${priorRevision + 14}`.repeat(64),
        grossDebtCents: 1000n,
        historicallySettledCents: 0n,
        outstandingBalanceCents: 1000n,
        rootCreditorLineId: null,
        rootPayableRefId: null
      }]
    });
    tx.historicalWageSummaryAuthorityVersion.findFirst.mockImplementation(() => Promise.resolve(priorSummary()));
    tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(() => Promise.resolve([priorSummary()]));

    await expectCMatrixConflict409(
      service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(tx);
  });

  it("freezes the complete prior B authority lifecycle in the public C frontier read-set", async () => {
    const { service, tx } = setup();
    const summary = r2HistoricalSummary();
    const summaryFact = {
      ...legacyFact,
      sourceSnapshot: { historicalWageSummaryAuthority: summary }
    };
    installOperatingFactQueryContract(tx.operatingFact, [summaryFact]);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const draftPrior = {
      id: "prior-summary-draft",
      revision: 1,
      sourceVersionFingerprint: "5".repeat(64),
      creditorLines: []
    };
    tx.historicalWageSummaryAuthorityVersion.findFirst.mockResolvedValue(draftPrior);
    tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([draftPrior]);

    await expectCMatrixConflict409(
      service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expect(tx.historicalWageSummaryAuthorityVersion.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ summaryBucketKey: "company-1:project-1:2026-08:engineering_technical" }),
      select: expect.objectContaining({
        sourcePayload: true,
        authorityPayload: true,
        scopeCreatorIdentitySnapshot: true,
        creditorLines: expect.objectContaining({ select: expect.objectContaining({ targetPayload: true }) }),
        attestations: expect.objectContaining({ select: expect.objectContaining({ receiptId: true, attestationOrdinal: true }) }),
        takeoverMappings: expect.objectContaining({ select: expect.objectContaining({ historicalWageSummaryAuthorityVersionId: true }) }),
        atomicScope: expect.objectContaining({
          select: expect.objectContaining({
            receipts: expect.objectContaining({
              select: expect.objectContaining({ lines: expect.objectContaining({ select: expect.objectContaining({ causesLineId: true }) }) })
            })
          })
        })
      }),
      orderBy: [{ revision: "asc" }, { id: "asc" }]
    });
  });

  it("builds the prior B proof through the public create, apply, attest and activate lifecycle", async () => {
    const prior = await captureActiveBPrior(r2HistoricalSummary());

    expect(prior.tx.operatingTakeoverCommandReceipt.create.mock.calls.map((call) =>
      call[0].data.action
    )).toEqual([
      "historical_wage_takeover.scope.create",
      "historical_wage_takeover.scope.apply",
      "historical_wage_takeover.scope.attest",
      "historical_wage_takeover.scope.activate"
    ]);
    expect(prior.tx.historicalWageSummaryAuthorityAttestation.create).toHaveBeenCalledTimes(2);
    expect(prior.activationReceipt.expectedRevision).toBe(3);
    expect(prior.scope.receipts).toHaveLength(4);
  });

  it("persists a versioned canonical command snapshot without changing the public result snapshot", async () => {
    const prior = await captureActiveBPrior(r2HistoricalSummary(), legacyFact, { compensate: true });
    const receipts = prior.tx.operatingTakeoverCommandReceipt.create.mock.calls.map((call) => call[0].data);

    expect(receipts.map((receipt) => ({
      action: receipt.action,
      expectedRevision: receipt.expectedRevision,
      actorUserId: receipt.actorUserId,
      commandSnapshotSchemaVersion: receipt.commandSnapshotSchemaVersion,
      snapshotAction: receipt.commandSnapshot?.action,
      snapshotExpectedRevision: receipt.commandSnapshot?.expectedRevision,
      snapshotActorUserId: receipt.commandSnapshot?.actorUserId,
      snapshotBusinessReason: receipt.commandSnapshot?.businessReason,
      snapshotEvidenceRefs: receipt.commandSnapshot?.evidenceRefs,
      snapshotDelegatorUserId: receipt.commandSnapshot?.delegatorUserId,
      snapshotFingerprintMatches: receipt.commandSnapshot
        ? receipt.fingerprint === fingerprint(receipt.commandSnapshot)
        : false,
      publicResultKeys: Object.keys(receipt.resultSnapshot).sort()
    }))).toEqual([
      {
        action: "historical_wage_takeover.scope.create",
        expectedRevision: 0,
        actorUserId: "finance-1",
        commandSnapshotSchemaVersion: 1,
        snapshotAction: "historical_wage_takeover.scope.create",
        snapshotExpectedRevision: 0,
        snapshotActorUserId: "finance-1",
        snapshotBusinessReason: "构造已完整激活的B级直接前序",
        snapshotEvidenceRefs: [],
        snapshotDelegatorUserId: null,
        snapshotFingerprintMatches: true,
        publicResultKeys: ["atomicScopeVersionId", "commandSelectionRef", "grade", "projectCount", "rowCount", "status"]
      },
      {
        action: "historical_wage_takeover.scope.apply",
        expectedRevision: 1,
        actorUserId: "finance-1",
        commandSnapshotSchemaVersion: 1,
        snapshotAction: "historical_wage_takeover.scope.apply",
        snapshotExpectedRevision: 1,
        snapshotActorUserId: "finance-1",
        snapshotBusinessReason: "真实执行B级 inactive apply",
        snapshotEvidenceRefs: [],
        snapshotDelegatorUserId: null,
        snapshotFingerprintMatches: true,
        publicResultKeys: ["atomicScopeVersionId", "grade", "revision", "rowCount", "status"]
      },
      {
        action: "historical_wage_takeover.scope.attest",
        expectedRevision: 2,
        actorUserId: "finance-director-2",
        commandSnapshotSchemaVersion: 1,
        snapshotAction: "historical_wage_takeover.scope.attest",
        snapshotExpectedRevision: 2,
        snapshotActorUserId: "finance-director-2",
        snapshotBusinessReason: "真实执行B级独立复核",
        snapshotEvidenceRefs: [],
        snapshotDelegatorUserId: null,
        snapshotFingerprintMatches: true,
        publicResultKeys: ["atomicScopeVersionId", "authorityVersionId", "grade", "revision", "status"]
      },
      {
        action: "historical_wage_takeover.scope.activate",
        expectedRevision: 3,
        actorUserId: "finance-director-3",
        commandSnapshotSchemaVersion: 1,
        snapshotAction: "historical_wage_takeover.scope.activate",
        snapshotExpectedRevision: 3,
        snapshotActorUserId: "finance-director-3",
        snapshotBusinessReason: "真实执行B级原子激活",
        snapshotEvidenceRefs: [],
        snapshotDelegatorUserId: null,
        snapshotFingerprintMatches: true,
        publicResultKeys: ["atomicScopeVersionId", "grade", "revision", "rows", "status"]
      },
      {
        action: "historical_wage_takeover.scope.compensate",
        expectedRevision: 4,
        actorUserId: "finance-director-4",
        commandSnapshotSchemaVersion: 1,
        snapshotAction: "historical_wage_takeover.scope.compensate",
        snapshotExpectedRevision: 4,
        snapshotActorUserId: "finance-director-4",
        snapshotBusinessReason: "真实执行B级接管资格补偿",
        snapshotEvidenceRefs: [],
        snapshotDelegatorUserId: null,
        snapshotFingerprintMatches: true,
        publicResultKeys: ["atomicScopeVersionId", "causesReceiptId", "grade", "revision", "status"]
      }
    ]);
    for (const receipt of receipts) {
      expect(Object.keys(receipt.commandSnapshot).sort()).toEqual([
        "action",
        "actorUserId",
        "binding",
        "businessReason",
        "delegatorUserId",
        "evidenceRefs",
        "expectedRevision"
      ]);
    }
  });

  it.each([
    "scope_manifest",
    "scope_authority",
    "manifest_receipt",
    "mapping_receipt_line"
  ] as const)("rejects a prior B reverse-ownership orphan at %s", async (variant) => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    let authority = prior.authority;
    if (variant === "scope_manifest") {
      authority = {
        ...authority,
        atomicScope: {
          ...authority.atomicScope,
          manifests: [
            ...authority.atomicScope.manifests,
            {
              ...authority.atomicScope.manifests[0]!,
              id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
              rows: [],
              receipts: []
            }
          ]
        }
      };
    } else if (variant === "scope_authority") {
      authority = {
        ...authority,
        atomicScope: {
          ...authority.atomicScope,
          historicalSummaryAuthorities: [
            ...authority.atomicScope.historicalSummaryAuthorities,
            {
              ...authority.atomicScope.historicalSummaryAuthorities[0]!,
              id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"
            }
          ]
        }
      };
    } else if (variant === "manifest_receipt") {
      authority = {
        ...authority,
        atomicScope: {
          ...authority.atomicScope,
          manifests: authority.atomicScope.manifests.map((
            manifest: Record<string, unknown> & { id: string; receipts: Array<Record<string, unknown>> },
            index: number
          ) => index === 0
            ? {
                ...manifest,
                receipts: [{
                  ...prior.activationReceipt,
                  id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
                  manifestVersionId: manifest.id,
                  atomicScopeVersionId: null
                }]
              }
            : manifest)
        }
      };
    } else {
      authority = {
        ...authority,
        takeoverMappings: authority.takeoverMappings.map((
          mapping: Record<string, unknown> & { receiptLines: Array<Record<string, unknown>> },
          index: number
        ) => index === 0
          ? {
              ...mapping,
              receiptLines: [
                ...mapping.receiptLines,
                {
                  ...mapping.receiptLines[0]!,
                  id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
                  receiptId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5"
                }
              ]
            }
          : mapping)
      };
    }
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(
      (query: PrismaFindManyQuery) => Promise.resolve([prismaSelect(authority, query.select)])
    );
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockImplementation(
      (query: PrismaFindManyQuery) => Promise.resolve(
        prior.payableRefs.map((ref) => prismaSelect(ref, query.select))
      )
    );

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it.each([
    "receipt_manifest_fk",
    "receipt_idempotency_key",
    "receipt_fingerprint",
    "receipt_command_snapshot",
    "receipt_causality",
    "receipt_actor_set",
    "receipt_result",
    "line_number",
    "line_amount",
    "line_target",
    "line_causality",
    "line_snapshot",
    "activation_result_rows"
  ] as const)("rejects a prior B lifecycle proof with a mutated %s", async (variant) => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const authority = {
      ...prior.authority,
      atomicScope: {
        ...prior.authority.atomicScope,
        receipts: prior.authority.atomicScope.receipts.map((receipt: Record<string, unknown> & {
          action: string;
          lines: Array<Record<string, unknown>>;
          resultSnapshot: Record<string, unknown>;
          commandSnapshot: Record<string, unknown>;
          actorSetSnapshot: Record<string, unknown>;
        }) => {
          const isApply = receipt.action === "historical_wage_takeover.scope.apply";
          const isActivation = receipt.action === "historical_wage_takeover.scope.activate";
          if (variant === "receipt_manifest_fk" && isApply) {
            return { ...receipt, manifestVersionId: prior.mapping.manifestVersionId };
          }
          if (variant === "receipt_idempotency_key" && isApply) {
            return { ...receipt, idempotencyKey: "not-a-uuid" };
          }
          if (variant === "receipt_fingerprint" && isApply) {
            return { ...receipt, fingerprint: "0".repeat(64) };
          }
          if (variant === "receipt_command_snapshot" && isApply) {
            return {
              ...receipt,
              commandSnapshot: { ...receipt.commandSnapshot, businessReason: "被改写的命令证据" }
            };
          }
          if (variant === "receipt_causality" && isApply) {
            return { ...receipt, causalityFingerprint: "0".repeat(64) };
          }
          if (variant === "receipt_actor_set" && isApply) {
            return { ...receipt, actorSetSnapshot: { ...receipt.actorSetSnapshot, actorIds: ["foreign-actor"] } };
          }
          if (variant === "receipt_result" && isApply) {
            return { ...receipt, resultSnapshot: { ...receipt.resultSnapshot, revision: 99 } };
          }
          if (variant === "activation_result_rows" && isActivation) {
            return {
              ...receipt,
              resultSnapshot: {
                ...receipt.resultSnapshot,
                rows: [{
                  projectId: scenario.rootFact.projectId,
                  decision: "FORMAL",
                  targetKind: "historical_wage_summary_authority_version",
                  targetRef: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
                }]
              }
            };
          }
          if (!isApply) return receipt;
          return {
            ...receipt,
            lines: receipt.lines.map((line, index) => index === 0
              ? {
                  ...line,
                  ...(variant === "line_number" ? { lineNo: 2 } : {}),
                  ...(variant === "line_amount" ? { amountCents: 999n } : {}),
                  ...(variant === "line_target"
                    ? { targetKind: "historical_wage_summary_authority_version", targetRef: prior.authority.id }
                    : {}),
                  ...(variant === "line_causality" ? { causalityFingerprint: "0".repeat(64) } : {}),
                  ...(variant === "line_snapshot" ? { lineSnapshot: { tampered: true } } : {})
                }
              : line)
          };
        })
      }
    };
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(
      (query: PrismaFindManyQuery) => Promise.resolve([prismaSelect(authority, query.select)])
    );
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockImplementation(
      (query: PrismaFindManyQuery) => Promise.resolve(
        prior.payableRefs.map((ref) => prismaSelect(ref, query.select))
      )
    );

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it("accepts a valid public B lifecycle through the exact Prisma select boundary", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const scopeReceiptLineIds = prior.authority.atomicScope.receipts.flatMap(
      (receipt: { lines: Array<{ id: string }> }) => receipt.lines.map((line) => line.id)
    ).sort();
    expect({
      manifests: prior.authority.atomicScope.manifests.map((manifest: { id: string }) => manifest.id),
      projectManifestId: prior.authority.atomicScope.projects[0]!.manifest.id,
      projectManifestRows: prior.authority.atomicScope.projects[0]!.manifest.rows.map(
        (row: { id: string }) => row.id
      ),
      reverseManifestRows: prior.authority.atomicScope.manifests[0]!.rows.map(
        (row: { id: string }) => row.id
      ),
      mappingReceiptLineIds: prior.mapping.receiptLines.map((line: { id: string }) => line.id).sort(),
      projectReceiptLineIds: prior.authority.atomicScope.projects[0]!.manifest.rows[0]!.receiptLines
        .map((line: { id: string }) => line.id).sort(),
      reverseReceiptLineIds: prior.authority.atomicScope.manifests[0]!.rows[0]!.receiptLines
        .map((line: { id: string }) => line.id).sort(),
      receiptMappings: prior.authority.atomicScope.receipts.map(
        (receipt: { action: string; lines: Array<{ rowMappingId: string }> }) => ({
          action: receipt.action,
          rowMappingIds: receipt.lines.map((line) => line.rowMappingId)
        })
      )
    }).toEqual({
      manifests: [prior.mapping.manifestVersionId],
      projectManifestId: prior.mapping.manifestVersionId,
      projectManifestRows: [prior.mapping.id],
      reverseManifestRows: [prior.mapping.id],
      mappingReceiptLineIds: scopeReceiptLineIds,
      projectReceiptLineIds: scopeReceiptLineIds,
      reverseReceiptLineIds: scopeReceiptLineIds,
      receiptMappings: [
        "historical_wage_takeover.scope.create",
        "historical_wage_takeover.scope.apply",
        "historical_wage_takeover.scope.attest",
        "historical_wage_takeover.scope.activate"
      ].map((action) => ({ action, rowMappingIds: [prior.mapping.id] }))
    });
    const priorScope = prior.authority.atomicScope;
    const computedPriorSource = computePol219HistoricalWageSourceVersionFingerprint(prior.authority.sourcePayload);
    const computedPriorAuthority = computePol219HistoricalWageAuthorityFingerprint(prior.authority.authorityPayload);
    const priorLine = prior.authority.creditorLines[0]!;
    const priorPayable = prior.payableRefs[0]!;
    const expectedPriorDeltaFingerprint = fingerprint({
      bucketKey: prior.authority.summaryBucketKey,
      creditorStableKey: priorLine.stableBucketKey,
      priorAuthorityVersionId: null,
      currentAuthoritySourceVersionFingerprint: prior.authority.sourceVersionFingerprint,
      signedGrossDeltaCents: priorLine.grossDebtCents,
      signedHistoricallySettledDeltaCents: priorLine.historicallySettledCents,
      signedOutstandingBalanceDeltaCents: priorLine.outstandingBalanceCents,
      rootCreditorLineId: null,
      rootPayableRefId: null
    });
    expect(Object.entries({
      authorityId: /^[0-9a-f-]{36}$/iu.test(prior.authority.id),
      authorityRevision: prior.authority.revision === 1,
      authorityDag: prior.authority.supersedesVersionId === null &&
        prior.authority.lineageRootAuthorityVersionId === null,
      sourcePayload: JSON.stringify(computedPriorSource.payload) === JSON.stringify(prior.authority.sourcePayload),
      sourceFingerprint: computedPriorSource.fingerprint === prior.authority.sourceVersionFingerprint,
      authorityPayload: JSON.stringify(computedPriorAuthority.payload) === JSON.stringify(prior.authority.authorityPayload),
      authorityFingerprint: computedPriorAuthority.fingerprint === prior.authority.authorityFingerprint,
      creditorLineCount: prior.authority.creditorLines.length === 1,
      payableCount: prior.payableRefs.length === 1,
      lineAuthority: priorLine.authorityVersionId === prior.authority.id,
      lineScope: priorLine.atomicScopeVersionId === prior.authority.atomicScopeVersionId,
      lineStableFingerprint: priorLine.stableBucketKeyFingerprint ===
        createHash("sha256").update(priorLine.stableBucketKey, "utf8").digest("hex"),
      lineDelta: priorLine.deltaFingerprint === expectedPriorDeltaFingerprint,
      payableAuthority: priorPayable.authorityVersionId === prior.authority.id,
      payableLine: priorPayable.authorityCreditorLineId === priorLine.id,
      payableScope: priorPayable.atomicScopeVersionId === prior.authority.atomicScopeVersionId,
      payableDelta: priorPayable.deltaFingerprint === priorLine.deltaFingerprint,
      payableRoot: priorPayable.adjustsSummaryPayableRefId === null,
      sourceDelta: prior.authority.sourceDeltaFingerprint === fingerprint({
        bucketKey: prior.authority.summaryBucketKey,
        revision: 1,
        supersedesVersionId: null,
        sourceVersionFingerprint: prior.authority.sourceVersionFingerprint,
        lines: [{
          creditorCategoryCode: priorLine.wageCreditorCategoryCode,
          signedGrossDeltaCents: priorLine.signedGrossDeltaCents,
          signedHistoricallySettledDeltaCents: priorLine.signedHistoricallySettledDeltaCents,
          signedOutstandingBalanceDeltaCents: priorLine.signedOutstandingBalanceDeltaCents,
          deltaFingerprint: priorLine.deltaFingerprint
        }]
      }),
      rootClosure: prior.authority.rootClosureFingerprint === fingerprint([])
    }).filter(([, valid]) => !valid).map(([name]) => name)).toEqual([]);
    const payloadLine = computedPriorAuthority.payload.creditorLines[0]!;
    expect(Object.entries({
      payloadLineId: payloadLine.authorityCreditorLineId === priorLine.id,
      lineCategory: priorLine.wageCreditorCategoryCode === payloadLine.categoryCode,
      lineCategoryLabel: priorLine.wageCreditorCategoryLabelSnapshot === payloadLine.categoryLabelSnapshot,
      lineIdentity: priorLine.creditorIdentityKind === payloadLine.creditorIdentityKind,
      lineParty: priorLine.creditorPartyVersionId === payloadLine.creditorPartyVersionId,
      lineControlledCode: priorLine.controlledScopeCode === payloadLine.controlledScopeCode,
      lineControlledDescription: priorLine.controlledScopeDescription === payloadLine.controlledScopeDescription,
      lineControlledCoordinate: fingerprint(priorLine.controlledScopeEvidenceCoordinate ?? null) ===
        fingerprint(payloadLine.controlledScopeEvidenceCoordinate),
      lineAmounts: priorLine.grossDebtCents === BigInt(payloadLine.grossDebtCents) &&
        priorLine.historicallySettledCents === BigInt(payloadLine.historicallySettledCents) &&
        priorLine.outstandingBalanceCents === BigInt(payloadLine.outstandingBalanceCents),
      lineStatus: priorLine.debtStatus === payloadLine.debtStatus,
      lineTargetKind: priorLine.targetKind === payloadLine.targetKind,
      lineTargetKey: priorLine.targetBusinessKey === payloadLine.targetBusinessKey,
      lineTargetPayload: fingerprint(priorLine.targetPayload) === fingerprint(payloadLine.targetPayload),
      lineTargetFingerprint: priorLine.targetFingerprint === payloadLine.targetFingerprint,
      lineSignedAmounts: priorLine.signedGrossDeltaCents === BigInt(payloadLine.signedGrossDeltaCents) &&
        priorLine.signedHistoricallySettledDeltaCents === BigInt(payloadLine.signedHistoricallySettledDeltaCents) &&
        priorLine.signedOutstandingBalanceDeltaCents === BigInt(payloadLine.signedOutstandingBalanceDeltaCents),
      refStableKey: priorPayable.stableBucketKey === priorLine.stableBucketKey,
      refCompany: priorPayable.employmentCompanyId === priorLine.employmentCompanyId,
      refProject: priorPayable.projectId === priorLine.projectId,
      refMonth: priorPayable.wageMonth === priorLine.wageMonth,
      refPosition: priorPayable.positionCategoryCode === priorLine.positionCategoryCode,
      refCategory: priorPayable.wageCreditorCategoryCode === priorLine.wageCreditorCategoryCode,
      refCategoryLabel: priorPayable.wageCreditorCategoryLabelSnapshot ===
        priorLine.wageCreditorCategoryLabelSnapshot,
      refIdentity: priorPayable.creditorIdentityKind === priorLine.creditorIdentityKind,
      refParty: priorPayable.creditorPartyVersionId === priorLine.creditorPartyVersionId,
      refControlledCode: priorPayable.controlledScopeCode === priorLine.controlledScopeCode,
      refControlledDescription: priorPayable.controlledScopeDescription === priorLine.controlledScopeDescription,
      refControlledCoordinate: fingerprint(priorPayable.controlledScopeEvidenceCoordinate ?? null) ===
        fingerprint(priorLine.controlledScopeEvidenceCoordinate ?? null),
      refAmounts: priorPayable.grossDebtCents === priorLine.grossDebtCents &&
        priorPayable.historicallySettledCents === priorLine.historicallySettledCents &&
        priorPayable.outstandingBalanceCents === priorLine.outstandingBalanceCents,
      refTarget: priorPayable.targetKind === priorLine.targetKind &&
        priorPayable.targetBusinessKey === priorLine.targetBusinessKey &&
        fingerprint(priorPayable.targetPayload) === fingerprint(priorLine.targetPayload) &&
        priorPayable.targetFingerprint === priorLine.targetFingerprint,
      refUsage: priorPayable.usageScope === "historical_reconciliation_only" &&
        priorPayable.newPaymentAllowed === false && priorPayable.settlementAllocationAllowed === false,
      refDirection: priorPayable.direction === "increase",
      refDeltaAmount: priorPayable.deltaAmountCents === priorLine.signedGrossDeltaCents
    }).filter(([, valid]) => !valid).map(([name]) => name)).toEqual([]);
    type CapturedReceipt = (typeof priorScope.receipts)[number];
    const priorReceipts = new Map<string, CapturedReceipt>(priorScope.receipts.map(
      (receipt: CapturedReceipt) => [receipt.action, receipt]
    ));
    const createReceipt = priorReceipts.get("historical_wage_takeover.scope.create")!;
    const applyReceipt = priorReceipts.get("historical_wage_takeover.scope.apply")!;
    const attestReceipt = priorReceipts.get("historical_wage_takeover.scope.attest")!;
    const activationReceipt = priorReceipts.get("historical_wage_takeover.scope.activate")!;
    expect(Object.entries({
      scopeId: priorScope.id === prior.authority.atomicScopeVersionId,
      scopeKind: priorScope.scopeKind === "historical_wage",
      permission: priorScope.permissionSnapshotFingerprint === prior.authority.permissionScopeFingerprint,
      creator: priorScope.createdByUserId === prior.authority.declaredByUserId,
      reservation: priorScope.reservedWageStatementVersionId === null,
      projectCount: priorScope.projects.length === 1,
      projectScope: priorScope.projects[0]!.atomicScopeVersionId === priorScope.id,
      projectId: priorScope.projects[0]!.projectId === prior.authority.projectId,
      projectManifestScope: priorScope.projects[0]!.manifest.atomicScopeVersionId === priorScope.id,
      projectManifestProject: priorScope.projects[0]!.manifest.projectId === prior.authority.projectId,
      projectManifestAdapter: priorScope.projects[0]!.manifest.adapterKind === "historical_wage",
      reverseManifestScope: priorScope.manifests[0]!.atomicScopeVersionId === priorScope.id,
      reverseManifestProject: priorScope.manifests[0]!.projectId === prior.authority.projectId,
      reverseManifestAdapter: priorScope.manifests[0]!.adapterKind === "historical_wage",
      reverseAuthorityCount: priorScope.historicalSummaryAuthorities.length === 1,
      reverseAuthorityId: priorScope.historicalSummaryAuthorities[0]!.id === prior.authority.id,
      reverseAuthorityScope: priorScope.historicalSummaryAuthorities[0]!.atomicScopeVersionId === priorScope.id,
      reverseAuthorityBucket: priorScope.historicalSummaryAuthorities[0]!.summaryBucketKey === prior.authority.summaryBucketKey,
      reverseAuthorityRevision: priorScope.historicalSummaryAuthorities[0]!.revision === prior.authority.revision,
      mappingCount: prior.authority.takeoverMappings.length === 1,
      mappingAuthority: prior.mapping.historicalWageSummaryAuthorityVersionId === prior.authority.id,
      mappingEvidence: prior.mapping.evidenceLevel === "B",
      mappingEntry: prior.mapping.entryKind === "formal",
      mappingDecision: prior.mapping.mappingDecision === "FORMAL",
      mappingSource: prior.mapping.sourceDiscriminator === "historical_wage_summary",
      projectRowManifest: priorScope.projects[0]!.manifest.rows[0]!.manifestVersionId ===
        priorScope.projects[0]!.manifest.id,
      reverseRowManifest: priorScope.manifests[0]!.rows[0]!.manifestVersionId === priorScope.manifests[0]!.id,
      projectRowProject: priorScope.projects[0]!.manifest.rows[0]!.projectId === prior.authority.projectId,
      reverseRowProject: priorScope.manifests[0]!.rows[0]!.projectId === prior.authority.projectId,
      projectRowAuthority: priorScope.projects[0]!.manifest.rows[0]!
        .historicalWageSummaryAuthorityVersionId === prior.authority.id,
      reverseRowAuthority: priorScope.manifests[0]!.rows[0]!
        .historicalWageSummaryAuthorityVersionId === prior.authority.id,
      projectManifestReceiptCount: priorScope.projects[0]!.manifest.receipts.length === 0,
      reverseManifestReceiptCount: priorScope.manifests[0]!.receipts.length === 0,
      receiptCount: priorScope.receipts.length === 4,
      createStatus: createReceipt.status === "prepared" && createReceipt.expectedRevision === 0,
      applyStatus: applyReceipt.status === "inactive_applied" && applyReceipt.expectedRevision === 1,
      attestStatus: attestReceipt.status === "attested" && attestReceipt.expectedRevision === 2,
      activationStatus: activationReceipt.status === "activated" && activationReceipt.expectedRevision === 3,
      createIdentity: createReceipt.actorUserId === prior.authority.declaredByUserId,
      createActorSet: JSON.stringify(createReceipt.actorSetSnapshot) ===
        JSON.stringify(prior.authority.scopeCreatorIdentitySnapshot),
      attestationCount: prior.authority.attestations.length === 2,
      firstAttestationReceipt: prior.authority.attestations[0]!.receiptId === createReceipt.id,
      secondAttestationReceipt: prior.authority.attestations[1]!.receiptId === attestReceipt.id,
      activationLineCount: activationReceipt.lines.length === 1,
      activationLineMapping: activationReceipt.lines[0]!.rowMappingId === prior.mapping.id,
      activationLineTarget: activationReceipt.lines[0]!.targetRef === prior.authority.id,
      payableMapping: prior.payableRefs.every((ref) => ref.rowMappingId === prior.mapping.id)
    }).filter(([, valid]) => !valid).map(([name]) => name)).toEqual([]);
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(
      (query: PrismaFindManyQuery) => {
        const selected = prismaSelect(prior.authority, query.select) as typeof prior.authority;
        expect(Object.entries({
          manifests: selected.atomicScope.manifests.length === 1,
          reverseRows: selected.atomicScope.manifests[0]!.rows.length === 1,
          projectRows: selected.atomicScope.projects[0]!.manifest.rows.length === 1,
          reverseAuthority: selected.atomicScope.historicalSummaryAuthorities[0]!.id === selected.id,
          mappingLines: selected.takeoverMappings[0]!.receiptLines.length === selected.atomicScope.receipts.length,
          reverseLines: selected.atomicScope.manifests[0]!.rows[0]!.receiptLines.length ===
            selected.atomicScope.receipts.length,
          projectLines: selected.atomicScope.projects[0]!.manifest.rows[0]!.receiptLines.length ===
            selected.atomicScope.receipts.length
        }).filter(([, valid]) => !valid).map(([name]) => name)).toEqual([]);
        return Promise.resolve([selected]);
      }
    );
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockImplementation(
      (query: PrismaFindManyQuery) => Promise.resolve(
        prior.payableRefs.map((ref) => prismaSelect(ref, query.select))
      )
    );

    const issuedAt = new Date("2026-09-04T00:01:00.000Z");
    const issued = await fixture.service.options("finance-1", "project-1", issuedAt);
    const correctionOptions = issued.options.filter((option) =>
      fixture.selectionRefs.read(option.selectionRef, issuedAt)
        ?.legacyCoordinates[0]?.sourceBusinessId === scenario.correctionFact.sourceBusinessId
    );
    expect(correctionOptions).toEqual([expect.objectContaining({ grade: "B" })]);
  });

  it("issues B and suppresses C only when the direct predecessor has a complete active lifecycle", async () => {
    const scenario = bCorrectionScenario();
    const activePrior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const { service, selectionRefs, tx } = setup();
    tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([activePrior.authority]);
    tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(activePrior.payableRefs);

    const issued = await service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );

    const correctionOptions = issued.options.filter((option) =>
      selectionRefs.read(option.selectionRef, new Date("2026-09-04T00:01:00.000Z"))
        ?.legacyCoordinates[0]?.sourceBusinessId === scenario.correctionFact.sourceBusinessId
    );
    expect(correctionOptions).toEqual([expect.objectContaining({ grade: "B" })]);
  });

  it("treats a fully compensated prior B authority as inactive instead of a correction predecessor", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(
      scenario.priorSummary,
      scenario.rootFact,
      { compensate: true }
    );
    const { service, selectionRefs, tx } = setup();
    tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([prior.authority]);
    tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(prior.payableRefs);

    const issued = await service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:01:00.000Z")
    );

    const correctionOptions = issued.options.filter((option) =>
      selectionRefs.read(option.selectionRef, new Date("2026-09-04T00:01:00.000Z"))
        ?.legacyCoordinates[0]?.sourceBusinessId === scenario.correctionFact.sourceBusinessId
    );
    expect(correctionOptions).toEqual([expect.objectContaining({ grade: "C" })]);
  });

  it("does not issue C when a persisted B lifecycle is already invalid", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const { service, tx, wageStatements } = setup();
    tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const priorState = {
      ...prior.authority,
      attestations: [prior.authority.attestations[0]]
    };
    tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(() => Promise.resolve([priorState]));
    tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(prior.payableRefs);

    await expectCMatrixConflict409(
      service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it.each([
    "draft",
    "unapplied",
    "unattested",
    "one_attestation",
    "effective_identity_overlap",
    "unactivated",
    "partial_compensation",
    "mapping_authority_fk_mismatch"
  ] as const)("rejects options when its prior B lifecycle is %s", async (variant) => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    let authority = { ...prior.authority };
    let payableRefs = prior.payableRefs;
    const receipts = prior.authority.atomicScope.receipts;
    switch (variant) {
      case "draft":
        authority = {
          ...authority,
          attestations: [authority.attestations[0]!],
          atomicScope: { ...authority.atomicScope, receipts: [receipts[0]!] }
        };
        break;
      case "unapplied":
        authority = {
          ...authority,
          atomicScope: {
            ...authority.atomicScope,
            receipts: receipts.filter((receipt: { action: string }) => receipt.action !== "historical_wage_takeover.scope.apply")
          }
        };
        break;
      case "unattested":
        authority = {
          ...authority,
          attestations: [authority.attestations[0]!],
          atomicScope: {
            ...authority.atomicScope,
            receipts: receipts.filter((receipt: { action: string }) => receipt.action !== "historical_wage_takeover.scope.attest")
          }
        };
        break;
      case "one_attestation":
        authority = { ...authority, attestations: [authority.attestations[0]!] };
        break;
      case "effective_identity_overlap":
        authority = {
          ...authority,
          attestations: authority.attestations.map((attestation: Record<string, unknown>, index: number) => index === 1
            ? { ...attestation, actorUserId: "finance-1" }
            : attestation),
          atomicScope: {
            ...authority.atomicScope,
            receipts: receipts.map((receipt: Record<string, unknown> & { action: string }) => receipt.action === "historical_wage_takeover.scope.attest"
              ? { ...receipt, actorUserId: "finance-1" }
              : receipt)
          }
        };
        break;
      case "unactivated":
        authority = {
          ...authority,
          atomicScope: {
            ...authority.atomicScope,
            receipts: receipts.filter((receipt: { action: string }) => receipt.action !== "historical_wage_takeover.scope.activate")
          }
        };
        break;
      case "partial_compensation": {
        const activationLine = prior.activationReceipt.lines[0]!;
        const compensationReceipt = {
          ...prior.activationReceipt,
          id: "receipt-prior-b-partial-compensate",
          action: "historical_wage_takeover.scope.compensate",
          status: "compensated",
          expectedRevision: 4,
          actorUserId: "finance-director-4",
          delegatorUserId: null,
          actorSetSnapshot: {
            actualUserId: "finance-director-4",
            actualRoles: ["finance_director"],
            delegatorUserId: null,
            delegatorRoles: null,
            actorIds: ["finance-director-4"]
          },
          causesReceiptId: prior.activationReceipt.id,
          createdTransactionId: 35n,
          createdAt: new Date("2026-09-03T00:05:00.000Z"),
          lines: [{
            ...activationLine,
            id: "receipt-line-prior-b-partial-compensate",
            receiptId: "receipt-prior-b-partial-compensate",
            decision: "compensated",
            targetKind: null,
            targetRef: null,
            causesLineId: activationLine.id,
            createdAt: new Date("2026-09-03T00:05:00.000Z")
          }]
        };
        authority = {
          ...authority,
          atomicScope: {
            ...authority.atomicScope,
            receipts: [...receipts, compensationReceipt]
          }
        };
        payableRefs = payableRefs.map((ref) => ({ ...ref, eligibilityRevocations: [] }));
        break;
      }
      case "mapping_authority_fk_mismatch":
        authority = {
          ...authority,
          takeoverMappings: authority.takeoverMappings.map((mapping: Record<string, unknown>) => ({
            ...mapping,
            historicalWageSummaryAuthorityVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          }))
        };
        break;
    }

    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([authority]);
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(payableRefs);

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it("rejects a B selection when a still-valid prior lifecycle changes after options", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    let priorState = prior.authority;
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(() => Promise.resolve([priorState]));
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(prior.payableRefs);
    const issuedAt = new Date("2026-09-04T00:01:00.000Z");
    const issued = await fixture.service.options("finance-1", "project-1", issuedAt);
    const correctionOption = issued.options.find((option) =>
      fixture.selectionRefs.read(option.selectionRef, issuedAt)
        ?.legacyCoordinates[0]?.sourceBusinessId === scenario.correctionFact.sourceBusinessId
    );
    expect(correctionOption).toEqual(expect.objectContaining({ grade: "B" }));
    priorState = {
      ...prior.authority,
      createdAt: new Date("2026-09-03T00:01:01.000Z")
    };

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expectConflict409(fixture.service.createScope("finance-1", {
        selectionRef: correctionOption!.selectionRef,
        idempotencyKey: "94949494-9494-4494-8494-949494949491",
        expectedRevision: 0,
        businessReason: "B级 selectionRef 必须绑定完整前序生命周期"
      }, new Date("2026-09-04T00:02:00.000Z")), "B级汇总权威已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it("rejects options when a prior B authority owns an extra payable outside the expected stable-key set", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([prior.authority]);
    const extraRef = {
      ...prior.payableRefs[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      authorityCreditorLineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      stableBucketKey: "foreign-extra-stable-key"
    };
    const storedRefs = [...prior.payableRefs, extraRef];
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockImplementation((query: {
      where?: { stableBucketKey?: { in?: string[] }; OR?: unknown[] };
    }) => {
      if (query.where?.OR) return Promise.resolve(storedRefs);
      const stableKeys = query.where?.stableBucketKey?.in ?? [];
      return Promise.resolve(storedRefs.filter((ref) => stableKeys.includes(ref.stableBucketKey)));
    });

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it("rejects options when a prior B creditor line is referenced by a foreign authority payable", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([prior.authority]);
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue([
      ...prior.payableRefs,
      {
        ...prior.payableRefs[0]!,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        authorityVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
      }
    ]);

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it("rejects options when an unowned payable adjustment points into the prior B root", async () => {
    const scenario = bCorrectionScenario();
    const prior = await captureActiveBPrior(scenario.priorSummary, scenario.rootFact);
    const fixture = setup();
    fixture.tx.operatingFact.findMany.mockResolvedValue([scenario.rootFact, scenario.correctionFact]);
    fixture.tx.operatingFact.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where?.id === scenario.rootFact.id ? scenario.rootFact : scenario.correctionFact)
    );
    fixture.tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    fixture.tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([prior.authority]);
    const orphanAdjustment = {
      ...prior.payableRefs[0]!,
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      atomicScopeVersionId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      authorityVersionId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      authorityCreditorLineId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
      rowMappingId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
      adjustsSummaryPayableRefId: prior.payableRefs[0]!.id,
      direction: "decrease",
      deltaAmountCents: 1n
    };
    fixture.tx.historicalWageSummaryPayableRef.findMany.mockImplementation((query: {
      where?: { OR?: Array<Record<string, unknown>> };
    }) => Promise.resolve(
      query.where?.OR?.some((selector) => "adjustsSummaryPayableRefId" in selector)
        ? [orphanAdjustment]
        : prior.payableRefs
    ));

    await expectCMatrixConflict409(
      fixture.service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
    expectNoTakeoverWrites(fixture.tx, fixture.wageStatements);
  });

  it.each([
    ["apply", "finance-1", ["finance_staff"]],
    ["activate", "finance-director-3", ["finance_director"]]
  ] as const)("rejects public B %s when the complete prior-lineage read-set changes after scope creation", async (action, actorUserId, actorRoles) => {
    const current = await captureActiveBPrior(r2HistoricalSummary());
    const insertedPrior = await captureActiveBPrior(r2HistoricalSummary());
    current.tx.operatingTakeoverAtomicScopeVersion.findUnique.mockImplementation(
      (query: PrismaScopeFindUniqueQuery) => Promise.resolve(prismaInclude(
        action === "apply" ? current.preparedScope : current.attestedScope,
        query.include
      ))
    );
    current.tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([insertedPrior.authority]);
    current.tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(insertedPrior.payableRefs);
    current.roles.resolveActiveRoleScopesInTransaction.mockResolvedValue([...actorRoles]);
    const scopedBinding = current.selectionRefs.read(
      current.commandSelectionRef,
      new Date("2026-09-03T00:01:00.000Z")
    )!;
    const selectionRef = current.selectionRefs.issue(
      { ...scopedBinding, actorUserId },
      new Date("2026-09-04T00:00:00.000Z")
    );
    const writesBefore = captureTakeoverWrites(current.tx, current.wageStatements);
    const command = {
      selectionRef,
      idempotencyKey: action === "apply"
        ? "94949494-9494-4494-8494-949494949492"
        : "94949494-9494-4494-8494-949494949493",
      expectedRevision: action === "apply" ? 1 : 3,
      businessReason: `B级 ${action} 必须重验完整前序 lineage read-set`
    };

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(
        action === "apply"
          ? current.service.apply(actorUserId, command, new Date("2026-09-04T00:03:00.000Z"))
          : current.service.activate(actorUserId, command, new Date("2026-09-04T00:04:00.000Z"))
      ).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectTakeoverWriteDelta(current.tx, current.wageStatements, writesBefore);
  });

  it("rejects a server-issued C selection when missing B evidence becomes active before scope creation", async () => {
    const { service, tx } = setup();
    const summary = r2HistoricalSummary();
    const summaryFact = {
      ...legacyFact,
      sourceSnapshot: { historicalWageSummaryAuthority: summary }
    };
    let evidenceActive = false;
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockImplementation(() => Promise.resolve(evidenceActive ? [
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ] : []));

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "C" })]);
    evidenceActive = true;

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "88888888-8888-4888-8888-888888888888",
        expectedRevision: 0,
        businessReason: "B级证据补齐后不得沿用旧C级选择"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toThrow("C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx);
  });

  it("issues an opaque B option only from the server-resolved historical summary authority", async () => {
    const { service, selectionRefs, tx } = setup();
    const summary = r2HistoricalSummary();
    const parsed = parseHistoricalWageSummaryAuthority(summary)!;
    expect(parsed).not.toBeNull();
    tx.operatingFact.findMany.mockResolvedValue([{ ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } }]);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);

    const result = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));

    expect(result.options).toEqual([{
      selectionRef: expect.stringMatching(/^hwt1\./u),
      grade: "B",
      label: "B级历史工资汇总权威（1个项目）",
      projectCount: 1,
      legacyFactCount: 1
    }]);
    expect(result.options[0]).not.toEqual(expect.objectContaining({
      employmentCompanyId: expect.anything(),
      projectId: expect.anything(),
      wageMonth: expect.anything(),
      amountCents: expect.anything(),
      positionCategoryCode: expect.anything(),
      sourceDiscriminator: expect.anything()
    }));
    const binding = selectionRefs.read(result.options[0]!.selectionRef, new Date("2026-09-04T00:01:00.000Z"));
    expect(binding).toEqual(expect.objectContaining({
      actorUserId: "finance-1",
      grade: "B",
      summaryFingerprint: historicalWageSummarySelectionFingerprint(parsed),
      legacyCoordinates: [expect.objectContaining({ sourceBusinessId: "legacy-wage-1" })]
    }));
    expect(tx.fileObject.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: expect.arrayContaining(["file-source-1", "file-balance-1"]) } }
    }));

    summary.lines[0]!.target.projectId = "project-other";
    await expectCMatrixConflict409(
      service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z")),
      INVALID_C_FRONTIER_INPUT_MESSAGE
    );
  });

  it("rejects a B selection with zero writes when a same-company active #214 ROLE_SUMMARY line appears before create", async () => {
    const { service, tx, wageStatements } = setup();
    const summary = r2HistoricalSummary();
    const summaryFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const conflict = mockAssignedWageConflict(tx, {
      companyId: "company-1",
      coverageKind: "ROLE_SUMMARY"
    });

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "B" })]);
    conflict.activate();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "87878787-8787-4787-8787-878787878787",
        expectedRevision: 0,
        businessReason: "同公司同项目同月的已激活岗位汇总工资承担权威必须整组阻断"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("rejects a B selection with zero writes when a same-company active #214 PERSON line lacks exclusion proof", async () => {
    const { service, tx, wageStatements } = setup();
    const summary = r2HistoricalSummary();
    const summaryFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const conflict = mockAssignedWageConflict(tx, {
      companyId: "company-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1"
    });

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "B" })]);
    conflict.activate();

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "89898989-8989-4989-8989-898989898989",
        expectedRevision: 0,
        businessReason: "同公司同项目同月逐人工资承担权威缺少排除证明时必须整组阻断"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("rejects a B selection with zero writes when its #214 PERSON exclusion proof becomes incomplete", async () => {
    const { service, tx, wageStatements } = setup();
    const baseSummary = r2HistoricalSummary();
    const conflict = mockAssignedWageConflict(tx, {
      companyId: "company-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1"
    });
    const exclusionEvidenceSha256 = "9".repeat(64);
    const exclusion = computePol219AssignedWageExclusionSet([{
      authorityVersionId: conflict.authorityId,
      lineId: conflict.lineId,
      lineFingerprint: conflict.lineFingerprint,
      fileObjectId: "file-exclusion-1",
      contentSha256: exclusionEvidenceSha256,
      evidenceCoordinate: r2Coordinate("15")
    }]);
    const summary = {
      ...baseSummary,
      assignedWageExclusions: exclusion.payload.assignedWageExclusions,
      assignedWageExclusionSetFingerprint: exclusion.fingerprint
    };
    const summaryFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) },
      { id: "file-exclusion-1", storageStatus: "active", contentSha256: exclusionEvidenceSha256 }
    ]);
    conflict.activate();

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "B" })]);

    const secondLine = {
      id: "assigned-wage-person-company-1-second",
      authorityVersionId: conflict.authorityId,
      projectId: "project-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-2",
      lineFingerprint: "5".repeat(64)
    };
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([
      {
        id: conflict.lineId,
        authorityVersionId: conflict.authorityId,
        projectId: "project-1",
        coverageKind: "PERSON",
        personAuthorityKey: "employee-1",
        lineFingerprint: conflict.lineFingerprint
      },
      secondLine
    ]);
    tx.operatingTakeoverRowMapping.findMany.mockResolvedValue([
      {
        id: `mapping-${conflict.lineId}`,
        manifestVersionId: `manifest-${conflict.lineId}`,
        projectId: "project-1",
        authorityVersionId: conflict.authorityId,
        authorityLineId: conflict.lineId
      },
      {
        id: `mapping-${secondLine.id}`,
        manifestVersionId: `manifest-${conflict.lineId}`,
        projectId: "project-1",
        authorityVersionId: conflict.authorityId,
        authorityLineId: secondLine.id
      }
    ]);
    tx.operatingTakeoverCommandReceipt.findMany.mockResolvedValue([{
      id: `activation-${conflict.lineId}`,
      manifestVersionId: `manifest-${conflict.lineId}`,
      action: "manifest.activate",
      status: "activated",
      lines: [
        { rowMappingId: `mapping-${conflict.lineId}` },
        { rowMappingId: `mapping-${secondLine.id}` }
      ],
      causedReceipts: []
    }]);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "90909090-9090-4090-9090-909090909090",
        expectedRevision: 0,
        businessReason: "活跃逐人工资承担行集合扩张后旧排除证明不再完整"
      }, new Date("2026-09-04T00:02:00.000Z"))).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx, wageStatements);
  });

  it("keeps B usable when its exclusion proof exactly covers every same-company active #214 PERSON line", async () => {
    const { service, tx } = setup();
    const baseSummary = r2HistoricalSummary();
    const conflict = mockAssignedWageConflict(tx, {
      companyId: "company-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1"
    });
    const exclusionEvidenceSha256 = "9".repeat(64);
    const exclusion = computePol219AssignedWageExclusionSet([{
      authorityVersionId: conflict.authorityId,
      lineId: conflict.lineId,
      lineFingerprint: conflict.lineFingerprint,
      fileObjectId: "file-exclusion-1",
      contentSha256: exclusionEvidenceSha256,
      evidenceCoordinate: r2Coordinate("15")
    }]);
    const summary = {
      ...baseSummary,
      assignedWageExclusions: exclusion.payload.assignedWageExclusions,
      assignedWageExclusionSetFingerprint: exclusion.fingerprint
    };
    const summaryFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) },
      { id: "file-exclusion-1", storageStatus: "active", contentSha256: exclusionEvidenceSha256 }
    ]);
    conflict.activate();

    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));
    expect(issued.options).toEqual([expect.objectContaining({ grade: "B" })]);

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: issued.options[0]!.selectionRef,
        idempotencyKey: "91919191-9191-4191-9191-919191919191",
        expectedRevision: 0,
        businessReason: "完整人员排除证明覆盖全部活跃工资承担行"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "B",
        status: "prepared"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("does not let another company's #214 wage authority block an otherwise complete B authority", async () => {
    const { service, tx } = setup();
    const summary = r2HistoricalSummary();
    const summaryFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([summaryFact]);
    tx.operatingFact.findUnique.mockResolvedValue(summaryFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const unrelated = mockAssignedWageConflict(tx, {
      companyId: "company-2",
      coverageKind: "ROLE_SUMMARY"
    });
    unrelated.activate();

    const result = await service.options("finance-1", "project-1", new Date("2026-09-04T00:01:00.000Z"));

    expect(result.options).toEqual([expect.objectContaining({ grade: "B" })]);
    expect(tx.projectAffiliateCompanyContract.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyEntityId: "company-1" })
    }));

    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: result.options[0]!.selectionRef,
        idempotencyKey: "94949494-9494-4494-8494-949494949494",
        expectedRevision: 0,
        businessReason: "异公司工资承担权威不属于B级历史工资汇总冲突域"
      }, new Date("2026-09-04T00:02:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "B",
        status: "prepared"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("rejects finance_staff from the director-only attest action before reading the scope", async () => {
    const { service, selectionRefs, tx } = setup();
    const selectionRef = selectionRefs.issue(cBinding({
      actorUserId: "finance-staff-1",
      atomicScopeVersionId: "scope-1"
    }), new Date("2026-09-04T00:00:00.000Z"));

    await expect(service.attest("finance-staff-1", {
      selectionRef,
      idempotencyKey: "12121212-1212-4212-8212-121212121212",
      expectedRevision: 2,
      businessReason: "执行独立复核"
    }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("财务负责人");

    expect(tx.operatingTakeoverAtomicScopeVersion.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a signed self-delegation before combining any effective identity", async () => {
    const { service, selectionRefs, roles } = setup();
    roles.resolveActiveRoleScopesInTransaction.mockResolvedValue(["finance_director"]);
    const selectionRef = selectionRefs.issue(cBinding({
      actorUserId: "finance-director-1",
      delegatorUserId: "finance-director-1",
      atomicScopeVersionId: "scope-1"
    }), new Date("2026-09-04T00:00:00.000Z"));

    await expect(service.activate("finance-director-1", {
      selectionRef,
      delegatorUserId: "finance-director-1",
      idempotencyKey: "13131313-1313-4313-8313-131313131313",
      expectedRevision: 2,
      businessReason: "拒绝自委托身份"
    }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("不能与委托人相同");

    expect(roles.resolveActiveRoleScopesInTransaction).not.toHaveBeenCalled();
  });

  it("keeps the compensation effective identity disjoint from the activation identity", async () => {
    const { service, selectionRefs, tx, roles } = setup();
    roles.resolveActiveRoleScopesInTransaction.mockResolvedValue(["finance_director"]);
    const binding = cBinding({ actorUserId: "finance-director-1", atomicScopeVersionId: "scope-1" });
    const scope = cScope(binding);
    scope.receipts.push(
      {
        id: "receipt-apply",
        action: "historical_wage_takeover.scope.apply",
        status: "inactive_applied",
        actorUserId: "finance-staff-1",
        delegatorUserId: null,
        lines: []
      },
      {
        id: "receipt-activate",
        action: "historical_wage_takeover.scope.activate",
        status: "activated",
        actorUserId: "finance-director-1",
        delegatorUserId: null,
        lines: [{ rowMappingId: "mapping-1", decision: "GAP", targetKind: "unresolved_wage_payable_gap", targetRef: "gap-1" }]
      }
    );
    tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValue(scope);
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.compensate("finance-director-1", {
        selectionRef,
        idempotencyKey: "14141414-1414-4414-8414-141414141414",
        expectedRevision: 3,
        businessReason: "补偿回退必须职责分离"
      }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("激活人与补偿人");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.wageTakeoverProjectionEnvelope.findMany).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverCommandReceipt.create).not.toHaveBeenCalled();
  });

  it("blocks eligibility compensation while any causal successor of the activation receipt exists", async () => {
    const { service, selectionRefs, tx, roles } = setup();
    roles.resolveActiveRoleScopesInTransaction.mockResolvedValue(["finance_director"]);
    const binding = cBinding({ actorUserId: "finance-director-2", atomicScopeVersionId: "scope-1" });
    const scope = cScope(binding);
    scope.receipts.push(
      {
        id: "receipt-apply",
        action: "historical_wage_takeover.scope.apply",
        status: "inactive_applied",
        actorUserId: "finance-staff-1",
        delegatorUserId: null,
        lines: []
      },
      {
        id: "receipt-activate",
        action: "historical_wage_takeover.scope.activate",
        status: "activated",
        actorUserId: "finance-director-1",
        delegatorUserId: null,
        lines: [{ rowMappingId: "mapping-1", decision: "GAP", targetKind: "unresolved_wage_payable_gap", targetRef: "gap-1" }]
      }
    );
    tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValue(scope);
    tx.operatingTakeoverCommandReceipt.findMany.mockResolvedValue([{ id: "downstream-receipt-224" }]);
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.compensate("finance-director-2", {
        selectionRef,
        idempotencyKey: "15151515-1515-4515-8515-151515151515",
        expectedRevision: 3,
        businessReason: "存在下游因果消费时必须阻断接管资格回退"
      }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("CAUSAL_SUCCESSOR_EXISTS");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.operatingTakeoverCommandReceipt.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelopeEligibilityRevocation.create).not.toHaveBeenCalled();
    expect(tx.historicalWageSummaryPayableRefEligibilityRevocation.create).not.toHaveBeenCalled();
  });

  it("binds every compensation receipt line to its exact activation predecessor", async () => {
    const { service, selectionRefs, tx, roles } = setup();
    roles.resolveActiveRoleScopesInTransaction.mockResolvedValue(["finance_director"]);
    const binding = cBinding({ actorUserId: "finance-director-2", atomicScopeVersionId: "scope-1" });
    const scope = cScope(binding);
    scope.receipts.push(
      {
        id: "receipt-apply",
        action: "historical_wage_takeover.scope.apply",
        status: "inactive_applied",
        actorUserId: "finance-staff-1",
        delegatorUserId: null,
        lines: []
      },
      {
        id: "receipt-activate",
        action: "historical_wage_takeover.scope.activate",
        status: "activated",
        actorUserId: "finance-director-1",
        delegatorUserId: null,
        lines: [{
          id: "activation-line-1",
          rowMappingId: "mapping-1",
          projectId: "project-1",
          amountCents: 1000n,
          causalOrdinal: 1,
          causalityFingerprint: "b".repeat(64),
          decision: "GAP",
          targetKind: "unresolved_wage_payable_gap",
          targetRef: "gap-1"
        }]
      }
    );
    tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValue(scope);
    tx.operatingTakeoverCommandReceipt.findMany.mockResolvedValue([]);
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.compensate("finance-director-2", {
        selectionRef,
        idempotencyKey: "16161616-1616-4616-8616-161616161616",
        expectedRevision: 3,
        businessReason: "仅撤销历史工资接管资格"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({
        status: "compensated",
        causesReceiptId: "receipt-activate"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.operatingTakeoverCommandReceiptLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rowMappingId: "mapping-1",
        projectId: "project-1",
        amountCents: 1000n,
        causalOrdinal: 1,
        causesLineId: "activation-line-1"
      })
    });
  });

  it("allows predecessor compensation only after its historical activation successor is completely compensated", async () => {
    const { service, selectionRefs, tx, roles } = setup();
    roles.resolveActiveRoleScopesInTransaction.mockResolvedValue(["finance_director"]);
    const binding = cBinding({ actorUserId: "finance-director-2", atomicScopeVersionId: "scope-1" });
    const scope = cScope(binding);
    scope.receipts.push(
      {
        id: "receipt-apply",
        action: "historical_wage_takeover.scope.apply",
        status: "inactive_applied",
        actorUserId: "finance-staff-1",
        delegatorUserId: null,
        lines: []
      },
      {
        id: "receipt-v2-activate",
        action: "historical_wage_takeover.scope.activate",
        status: "activated",
        actorUserId: "finance-director-1",
        delegatorUserId: null,
        lines: [{
          id: "v2-line-1",
          rowMappingId: "mapping-1",
          projectId: "project-1",
          amountCents: 1000n,
          causalOrdinal: 1,
          causalityFingerprint: "b".repeat(64),
          decision: "GAP",
          targetKind: "unresolved_wage_payable_gap",
          targetRef: "gap-1"
        }]
      }
    );
    tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValue(scope);
    tx.operatingTakeoverCommandReceipt.findMany.mockResolvedValue([{
      id: "receipt-v3-activate",
      action: "historical_wage_takeover.scope.activate",
      status: "activated",
      atomicScopeVersionId: "scope-v3",
      lines: [{
        id: "v3-line-1",
        rowMappingId: "mapping-v3-1",
        projectId: "project-1",
        amountCents: 200n,
        causalOrdinal: 1
      }],
      causedReceipts: [{
        id: "receipt-v3-compensate",
        action: "historical_wage_takeover.scope.compensate",
        status: "compensated",
        atomicScopeVersionId: "scope-v3",
        causesReceiptId: "receipt-v3-activate",
        lines: [{
          rowMappingId: "mapping-v3-1",
          projectId: "project-1",
          amountCents: 200n,
          causalOrdinal: 1,
          causesLineId: "v3-line-1"
        }]
      }]
    }]);
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.compensate("finance-director-2", {
        selectionRef,
        idempotencyKey: "17171717-1717-4717-8717-171717171717",
        expectedRevision: 3,
        businessReason: "下游版本已完成资格补偿后回退前置版本"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({
        status: "compensated"
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("fails a signed A selection drift with zero writes instead of silently reclassifying it as C", async () => {
    const { service, selectionRefs, tx } = setup();
    const selectionRef = selectionRefs.issue({
      actorUserId: "finance-1",
      selectionFingerprint: HASH,
      grade: "A",
      sourceVersionId: "missing-approved-source",
      sourceFingerprint: "b".repeat(64),
      sourceClosureFingerprint: "c".repeat(64),
      legacyCoordinates: [{
        projectId: "project-1",
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: LEGACY_HASH
      }]
    }, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef,
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        expectedRevision: 0,
        businessReason: "历史工资接管核对"
      }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("A级权威来源已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.wageStatementVersion.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverAtomicScopeVersion.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverRowMapping.create).not.toHaveBeenCalled();
  });

  it("takes the shared #214/#219 bucket lock before freezing the complete competing line set", async () => {
    const { service, tx } = setup();
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({ wageMonth: "2026-08", employmentCompanyId: "company-1" });
    tx.projectAffiliateCompanyContract.findMany.mockResolvedValue([
      {
        id: "contract-1",
        projectId: "project-1",
        companyEntityId: "company-1",
        companyEntityVersionId: "company-version-1",
        requestFingerprint: "5".repeat(64),
        fileContentSha256Snapshot: "6".repeat(64)
      },
      {
        id: "contract-2",
        projectId: "project-2",
        companyEntityId: "company-1",
        companyEntityVersionId: "company-version-1",
        requestFingerprint: "7".repeat(64),
        fileContentSha256Snapshot: "8".repeat(64)
      }
    ]);
    tx.affiliateClearingAuthorityVersion.findMany.mockResolvedValue([
      { id: "authority-2", affiliateCompanyContractId: "contract-2", authorityFingerprint: "2".repeat(64) },
      { id: "authority-1", affiliateCompanyContractId: "contract-1", authorityFingerprint: "1".repeat(64) }
    ]);
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([
      {
        id: "line-2",
        authorityVersionId: "authority-2",
        projectId: "project-2",
        coverageKind: "PERSON",
        personAuthorityKey: "someone-else",
        lineFingerprint: "4".repeat(64)
      },
      {
        id: "line-1",
        authorityVersionId: "authority-1",
        projectId: "project-1",
        coverageKind: "PERSON",
        personAuthorityKey: "someone-else",
        lineFingerprint: "3".repeat(64)
      }
    ]);
    tx.operatingTakeoverRowMapping.findMany.mockResolvedValue([
      {
        id: "mapping-line-1",
        manifestVersionId: "manifest-active-lines",
        projectId: "project-1",
        authorityVersionId: "authority-1",
        authorityLineId: "line-1"
      },
      {
        id: "mapping-line-2",
        manifestVersionId: "manifest-active-lines",
        projectId: "project-2",
        authorityVersionId: "authority-2",
        authorityLineId: "line-2"
      }
    ]);
    tx.operatingTakeoverCommandReceipt.findMany.mockResolvedValue([{
      id: "activation-active-lines",
      manifestVersionId: "manifest-active-lines",
      action: "manifest.activate",
      status: "activated",
      lines: [{ rowMappingId: "mapping-line-1" }, { rowMappingId: "mapping-line-2" }],
      causedReceipts: []
    }]);
    const plan = {
      grade: "A" as const,
      sourceVersionId: "approved-source-1",
      projectIds: ["project-3", "project-1", "project-2"]
    };
    const legacy = [
      { ...legacyFact, factId: "fact-2", projectId: "project-2" },
      { ...legacyFact, factId: "fact-1", projectId: "project-1" }
    ];

    const crossSourceConflict = (
      service as unknown as {
        crossSourceConflict: (...args: unknown[]) => Promise<string | null>;
      }
    ).crossSourceConflict.bind(service);
    await expect(crossSourceConflict(tx, plan, legacy)).resolves.toBeNull();

    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(tx.$executeRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.affiliateClearingAuthorityVersion.findMany.mock.invocationCallOrder[0]!
    );
    expect(plan).toEqual(expect.objectContaining({
      conflictReadSet: {
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        projectIds: ["project-1", "project-2", "project-3"],
        contracts: [
          expect.objectContaining({ id: "contract-1", projectId: "project-1" }),
          expect.objectContaining({ id: "contract-2", projectId: "project-2" })
        ],
        employeeIdsByProject: [
          { projectId: "project-1", employeeIds: [] },
          { projectId: "project-2", employeeIds: [] },
          { projectId: "project-3", employeeIds: [] }
        ],
        authorities: [
          { id: "authority-1", affiliateCompanyContractId: "contract-1", authorityFingerprint: "1".repeat(64) },
          { id: "authority-2", affiliateCompanyContractId: "contract-2", authorityFingerprint: "2".repeat(64) }
        ],
        lines: [
          expect.objectContaining({ id: "line-1", lineFingerprint: "3".repeat(64) }),
          expect.objectContaining({ id: "line-2", lineFingerprint: "4".repeat(64) })
        ]
      }
    }));
  });

  it("matches #214 PERSON conflicts within the same project instead of across the whole A scope", async () => {
    const { service, tx } = setup();
    tx.wageApprovedSourceVersion.findUnique
      .mockResolvedValue({
        wageMonth: "2026-08",
        employmentCompanyId: "company-1",
        evidenceSha256: "c".repeat(64),
        sourceSnapshot: {
          approvedPersonLines: [{
            employeeId: "employee-1",
            employmentSnapshotId: "employment-1",
            employmentCompanyId: "company-1",
            approvedAmountCents: "1000",
            evidenceSha256: "c".repeat(64),
            projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
          }]
        }
      });
    tx.projectAffiliateCompanyContract.findMany.mockResolvedValue([{
      id: "contract-1",
      projectId: "project-1",
      companyEntityId: "company-1",
      companyEntityVersionId: "company-version-1",
      requestFingerprint: "5".repeat(64),
      fileContentSha256Snapshot: "6".repeat(64)
    }]);
    tx.affiliateClearingAuthorityVersion.findMany.mockResolvedValue([
      { id: "authority-1", affiliateCompanyContractId: "contract-1", authorityFingerprint: "1".repeat(64) }
    ]);
    const plan = {
      grade: "A" as const,
      sourceVersionId: "approved-source-1",
      projectIds: ["project-1", "project-2"]
    };
    const legacy = [{ ...legacyFact, factId: "fact-1", projectId: "project-1" }];
    let currentMappingIds: string[] = [];
    tx.operatingTakeoverRowMapping.findMany.mockImplementation(({ where }) => {
      currentMappingIds = where.authorityLineId.in.map((lineId: string) => `mapping-${lineId}`);
      return Promise.resolve(where.authorityLineId.in.map((lineId: string) => ({
        id: `mapping-${lineId}`,
        manifestVersionId: "manifest-project-match",
        projectId: lineId.endsWith("2") ? "project-2" : "project-1",
        authorityVersionId: "authority-1",
        authorityLineId: lineId
      })));
    });
    tx.operatingTakeoverCommandReceipt.findMany.mockImplementation(() => Promise.resolve([{
      id: "activation-project-match",
      manifestVersionId: "manifest-project-match",
      action: "manifest.activate",
      status: "activated",
      lines: currentMappingIds.map((rowMappingId) => ({ rowMappingId })),
      causedReceipts: []
    }]));

    tx.assignedWageAuthorityLine.findMany.mockResolvedValueOnce([{
      id: "line-project-2",
      authorityVersionId: "authority-1",
      projectId: "project-2",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1",
      lineFingerprint: "2".repeat(64)
    }]);
    const crossSourceConflict = (
      service as unknown as {
        crossSourceConflict: (...args: unknown[]) => Promise<string | null>;
      }
    ).crossSourceConflict.bind(service);
    await expect(crossSourceConflict(tx, plan, legacy)).resolves.toBeNull();

    tx.assignedWageAuthorityLine.findMany.mockResolvedValueOnce([{
      id: "line-project-1",
      authorityVersionId: "authority-1",
      projectId: "project-1",
      coverageKind: "PERSON",
      personAuthorityKey: "employee-1",
      lineFingerprint: "3".repeat(64)
    }]);
    await expect(crossSourceConflict(tx, plan, legacy)).resolves.toBe("CROSS_SOURCE_WAGE_BLOCK");
  });

  it("prepares A by reserving the final version UUID without creating or targeting a wage version early", async () => {
    const { service, tx, wageStatements } = setup();
    const sourceFingerprint = "b".repeat(64);
    const evidenceSha256 = "c".repeat(64);
    const approvedSource = schemaFaithfulApprovedSource({
      id: "approved-source-1",
      sourceFingerprint,
      evidenceFileId: "approved-evidence-1",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    });
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([approvedSource]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(approvedSource);
    tx.fileObject.findUnique.mockResolvedValue({
      id: approvedSource.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    mockAMaterializationAuthority(tx, approvedSource);
    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:00:00.000Z"));
    const selectionRef = issued.options.find((option) => option.grade === "A")?.selectionRef;
    expect(selectionRef).toEqual(expect.stringMatching(/^hwt1\./u));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: selectionRef!,
        idempotencyKey: "26262626-2626-4262-8262-262626262626",
        expectedRevision: 0,
        businessReason: "预留历史工资正式版本标识"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "A",
        atomicScopeVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/u)
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    const reservedVersionId = tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]?.[0]?.data?.reservedWageStatementVersionId;
    const reservedScopeId = tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]?.[0]?.data?.id;
    expect(reservedVersionId).toEqual(expect.any(String));
    expect(tx.wageTakeoverWageStatementReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: reservedVersionId,
        atomicScopeVersionId: reservedScopeId,
        expectedCurrentRevision: 0,
        reservedRevision: 1,
        versionKind: "base",
        priorConfirmedVersionId: null,
        priorSourceVersionId: null
      })
    });
    expect(tx.operatingTakeoverRowMapping.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wageStatementReservationId: reservedVersionId
      })
    }));
    expect(tx.operatingTakeoverRowMapping.create.mock.calls[0]?.[0]?.data).not.toHaveProperty("wageStatementVersionId");
    expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    expect(tx.wageStatementVersion.create).not.toHaveBeenCalled();
  });

  it("records inactive apply after a scoped read-set revalidation without calling the canonical wage path", async () => {
    const { service, selectionRefs, tx, wageStatements } = setup();
    const binding = cBinding({ actorUserId: "finance-1", atomicScopeVersionId: "scope-1" });
    tx.operatingTakeoverAtomicScopeVersion.findUnique = jest.fn().mockResolvedValue(cScope(binding));
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.apply("finance-1", {
        selectionRef,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        expectedRevision: 1,
        businessReason: "只执行 inactive apply"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({ status: "inactive_applied", revision: 2 }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverCommandReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "historical_wage_takeover.scope.apply", status: "inactive_applied" })
    }));
  });

  it.each([
    ["apply", "finance-1", ["finance_staff"], "36363636-3636-4363-8363-363636363636"],
    ["attest", "finance-director-1", ["finance_director"], "37373737-3737-4373-8373-373737373737"],
    ["activate", "finance-director-2", ["finance_director"], "38383838-3838-4383-8383-383838383838"]
  ] as const)("rejects C authority drift with zero writes at scoped %s", async (action, actorUserId, actorRoles, idempotencyKey) => {
    const { service, selectionRefs, tx, roles, wageStatements } = setup();
    roles.resolveActiveRoleScopesInTransaction.mockResolvedValue([...actorRoles]);
    const binding = cBinding({ actorUserId, atomicScopeVersionId: "scope-1" });
    tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValue(cScope(binding));
    const evidenceSha256 = "c".repeat(64);
    const source = schemaFaithfulApprovedSource({
      id: "approved-source-after-scope",
      employmentCompanyId: "company-1",
      sourceFingerprint: "b".repeat(64),
      evidenceFileId: "approved-evidence-after-scope",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "1000",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
        }]
      }
    });
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([source]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(source);
    tx.fileObject.findUnique.mockResolvedValue({
      id: source.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-after-scope",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: [],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "1000", signedPayableDeltaCents: "1000" }]
    });
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const command = {
      selectionRef,
      idempotencyKey,
      expectedRevision: 1,
      businessReason: `C级 scope 后权威漂移必须阻断 ${action}`
    };
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const result = action === "apply"
        ? service.apply(actorUserId, command, new Date("2026-09-04T00:01:00.000Z"))
        : action === "attest"
          ? service.attest(actorUserId, command, new Date("2026-09-04T00:01:00.000Z"))
          : service.activate(actorUserId, command, new Date("2026-09-04T00:01:00.000Z"));
      await expect(result).rejects.toThrow("C级负权威前沿已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expectNoTakeoverWrites(tx);
  });

  it("rejects a prior canonical graph envelope header ownership rewrite", async () => {
    const { prove, envelope } = setupPriorCanonicalGraphProof();

    await expect(prove()).resolves.toEqual(expect.objectContaining({
      priorVersionId: "wage-version-prior-graph"
    }));
    envelope.manifestVersionId = "manifest-rewritten-after-options";

    await expect(prove()).resolves.toBeNull();
  });

  it("rejects an activation-only prior canonical graph lifecycle", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    fixture.reservation.atomicScope.receipts.splice(0, 3, fixture.activation);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it.each([
    "historical_wage_takeover.scope.create",
    "historical_wage_takeover.scope.apply",
    "historical_wage_takeover.scope.activate"
  ])("rejects a prior canonical graph missing %s", async (action) => {
    const fixture = setupPriorCanonicalGraphProof();
    const receiptIndex = fixture.reservation.atomicScope.receipts.findIndex((receipt) => receipt.action === action);
    fixture.reservation.atomicScope.receipts.splice(receiptIndex, 1);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("rejects a duplicate prior canonical graph lifecycle action", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    fixture.reservation.atomicScope.receipts.push({
      ...fixture.createReceipt,
      id: "create-receipt-prior-graph-duplicate",
      idempotencyKey: "62626262-6262-4262-8262-626262626262"
    });

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it.each(["createReceipt", "applyReceipt", "activation"] as const)(
    "rejects %s critical lifecycle field rewrites",
    async (receiptKey) => {
      const mutations: Array<(fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => void> = [
        (fixture) => { fixture[receiptKey].status = "rewritten"; },
        (fixture) => { fixture[receiptKey].expectedRevision += 1; },
        (fixture) => { fixture[receiptKey].causalityFingerprint = "f".repeat(64); },
        (fixture) => { fixture[receiptKey].permissionSnapshotFingerprint = "0".repeat(64); },
        (fixture) => {
          fixture[receiptKey].causesReceiptId = receiptKey === "activation" ? null : "receipt-forbidden-predecessor";
        },
        (fixture) => { fixture[receiptKey].resultSnapshot.status = "rewritten"; },
        (fixture) => {
          fixture[receiptKey].lines[0]!.lineSnapshot = {
            ...fixture[receiptKey].lines[0]!.lineSnapshot,
            sourceBusinessId: "legacy-prior-graph-rewritten"
          };
        }
      ];
      for (const mutate of mutations) {
        const fixture = setupPriorCanonicalGraphProof();
        mutate(fixture);
        await expect(fixture.prove()).resolves.toBeNull();
      }
    }
  );

  it.each([
    ["permission", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.permissionSnapshotFingerprint = "0".repeat(64);
    }],
    ["read-set", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.readSetFingerprint = "0".repeat(64);
    }],
    ["candidate baseline", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.candidateBaselineSha = "0".repeat(40);
    }],
    ["authority fingerprint", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.authoritySourceFingerprint = "0".repeat(64);
    }],
    ["source closure", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.sourceClosureFingerprint = "0".repeat(64);
    }]
  ] as const)("rejects prior canonical scope %s rewrite", async (_label, mutate) => {
    const fixture = setupPriorCanonicalGraphProof();
    mutate(fixture);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it.each([
    ["membership addition", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.projects.push({
        ...fixture.scopeProject,
        id: "scope-project-prior-graph-added",
        projectId: "project-added",
        manifestVersionId: "manifest-added",
        manifest: {
          ...fixture.scopeManifest,
          id: "manifest-added",
          projectId: "project-added"
        }
      });
    }],
    ["membership deletion", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.reservation.atomicScope.projects.splice(0);
    }],
    ["membership rewrite", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.scopeProject.projectId = "project-rewritten";
      fixture.scopeManifest.projectId = "project-rewritten";
    }],
    ["scope ownership rewrite", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.scopeProject.atomicScopeVersionId = "scope-wrong-owner";
    }],
    ["manifest ownership rewrite", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.scopeManifest.atomicScopeVersionId = "scope-wrong-owner";
    }]
  ] as const)("rejects prior canonical scope project %s", async (_label, mutate) => {
    const fixture = setupPriorCanonicalGraphProof();
    mutate(fixture);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it.each([
    ["adapterKind", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.mappingOwner.adapterKind = "construction_enterprise_clearing";
    }],
    ["evidenceLevel", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.mappingOwner.evidenceLevel = "B";
    }],
    ["mappingDecision", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.mappingOwner.mappingDecision = "LINK";
    }],
    ["sourceDiscriminator", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.mappingOwner.sourceDiscriminator = "project_wage";
    }],
    ["wageApprovedSourceVersionId", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.mappingOwner.wageApprovedSourceVersionId = "approved-source-wrong";
    }],
    ["historicalWageSummaryAuthorityVersionId", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      (fixture.mappingOwner as unknown as { historicalWageSummaryAuthorityVersionId: string | null })
        .historicalWageSummaryAuthorityVersionId = "summary-authority-forbidden";
    }],
    ["legacySourceSnapshot", (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => {
      fixture.mappingOwner.legacySourceSnapshot.costImpactId = "impact-cost-rewritten";
    }]
  ] as const)("rejects prior canonical A mapping %s rewrite", async (_label, mutate) => {
    const fixture = setupPriorCanonicalGraphProof();
    mutate(fixture);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("rejects prior canonical A mapping authorityLineFingerprint rewrite", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    fixture.mappingOwner.authorityLineFingerprint = "1".repeat(64);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("rejects a late-appended scope-owned orphan manifest", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    fixture.reservation.atomicScope.manifests.push({
      ...fixture.scopeManifest,
      id: "manifest-prior-graph-orphan",
      manifestNo: "OT219-prior-project-orphan",
      sourceScopeFingerprint: fingerprint([]),
      manifestFingerprint: fingerprint({
        scopeId: fixture.reservation.atomicScopeVersionId,
        projectId: fixture.scopeManifest.projectId,
        plan: fixture.mappingOwner.readSetSnapshot.plan,
        rows: []
      }),
      rows: []
    });

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("rejects a late-appended reservation-and-manifest-owned orphan mapping", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    const orphanLegacy = {
      ...fixture.mappingOwner.readSetSnapshot.legacy,
      factId: "fact-prior-graph-orphan",
      sourceBusinessId: "legacy-prior-graph-orphan",
      sourceFingerprint: "4".repeat(64),
      costImpactId: "impact-cost-prior-graph-orphan",
      payableImpactId: "impact-payable-prior-graph-orphan"
    };
    const orphanMapping = {
      ...fixture.mappingOwner,
      id: "mapping-prior-graph-orphan",
      rowNo: 2,
      sourceBusinessId: orphanLegacy.sourceBusinessId,
      sourceFingerprint: orphanLegacy.sourceFingerprint,
      sourceCoordinate: "project_wage:legacy-prior-graph-orphan:1",
      normalizedRowHash: fingerprint(orphanLegacy),
      legacySourceSnapshot: {
        ...fixture.mappingOwner.legacySourceSnapshot,
        ...orphanLegacy
      },
      readSetSnapshot: {
        ...fixture.mappingOwner.readSetSnapshot,
        legacy: orphanLegacy
      },
      mappingFingerprint: fingerprint({
        scopeId: fixture.reservation.atomicScopeVersionId,
        projectId: fixture.mappingOwner.projectId,
        plan: fixture.mappingOwner.readSetSnapshot.plan,
        legacy: orphanLegacy
      })
    };
    fixture.reservation.mappings.push(orphanMapping);
    fixture.scopeManifest.rows.push(orphanMapping);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("reads the complete prior scope, project, manifest, mapping and receipt graph with stable ordering", async () => {
    const fixture = setupPriorCanonicalGraphProof();

    await expect(fixture.prove()).resolves.toEqual(expect.objectContaining({
      priorCanonicalGraphFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
    }));
    expect(fixture.tx.wageTakeoverWageStatementReservation.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        mappings: expect.objectContaining({
          orderBy: [{ manifestVersionId: "asc" }, { rowNo: "asc" }, { id: "asc" }],
          select: {
            id: true,
            manifestVersionId: true,
            projectId: true,
            rowNo: true,
            wageStatementReservationId: true
          }
        }),
        atomicScope: expect.objectContaining({
          select: expect.objectContaining({
            scopeKind: true,
            authoritySourceFingerprint: true,
            candidateBaselineSha: true,
            permissionSnapshotFingerprint: true,
            readSetFingerprint: true,
            projects: expect.objectContaining({
              orderBy: [{ projectId: "asc" }, { id: "asc" }],
              select: expect.objectContaining({ manifest: expect.any(Object) })
            }),
            manifests: expect.objectContaining({
              orderBy: [{ projectId: "asc" }, { id: "asc" }],
              select: expect.objectContaining({
                rows: expect.objectContaining({
                  orderBy: [{ rowNo: "asc" }, { id: "asc" }],
                  select: {
                    id: true,
                    manifestVersionId: true,
                    projectId: true,
                    rowNo: true,
                    wageStatementReservationId: true
                  }
                })
              })
            }),
            receipts: expect.objectContaining({ orderBy: { id: "asc" } }),
            wageProjectionEnvelopes: expect.objectContaining({
              select: expect.objectContaining({
                rowMapping: expect.objectContaining({
                  select: expect.objectContaining({
                    adapterKind: true,
                    sourceCoordinate: true,
                    normalizedRowHash: true,
                    evidenceLevel: true,
                    coverageKind: true,
                    coverageKey: true,
                    periodStart: true,
                    entryKind: true,
                    mappingDecision: true,
                    conflictGroupKey: true,
                    adjustmentTargetRef: true,
                    sourceDiscriminator: true,
                    governedSubjectKey: true,
                    authorityCategory: true,
                    authoritySnapshotRef: true,
                    authorityFingerprint: true,
                    authorityVersionId: true,
                    authorityLineId: true,
                    authorityLineFingerprint: true,
                    obligationId: true,
                    authoritativeGrossCapCents: true,
                    currencyCode: true,
                    wageApprovedSourceVersionId: true,
                    historicalWageSummaryAuthorityVersionId: true,
                    authoritySnapshot: true,
                    legacySourceSnapshot: true,
                    readSetSnapshot: true,
                    mappingFingerprint: true,
                    createdAt: true
                  })
                })
              })
            })
          })
        })
      })
    }));
  });

  const priorCanonicalGraphInvalidations: Array<[
    string,
    (fixture: ReturnType<typeof setupPriorCanonicalGraphProof>) => void
  ]> = [
    ["cost child addition", ({ envelope }) => {
      envelope.costCells.push({
        ...envelope.costCells[0]!,
        id: "envelope-cost-added",
        costCellId: "cost-cell-added",
        amountCents: 1n
      });
    }],
    ["cost child deletion", ({ envelope }) => { envelope.costCells.splice(0); }],
    ["cost child amount rewrite", ({ envelope }) => { envelope.costCells[0]!.amountCents = 999n; }],
    ["payable child addition", ({ envelope }) => {
      envelope.payableRefs.push({
        ...envelope.payableRefs[0]!,
        id: "envelope-payable-added",
        payableRefId: "payable-ref-added",
        amountCents: 1n
      });
    }],
    ["payable child deletion", ({ envelope }) => { envelope.payableRefs.splice(0); }],
    ["payable child direction rewrite", ({ envelope }) => { envelope.payableRefs[0]!.direction = "decrease"; }],
    ["legacy-impact bridge addition", ({ envelope }) => {
      envelope.legacyImpactBridges.push({
        ...envelope.legacyImpactBridges[0]!,
        id: "impact-bridge-added",
        legacyImpactEntryId: "impact-added"
      });
    }],
    ["legacy-impact bridge deletion", ({ envelope }) => { envelope.legacyImpactBridges.splice(0, 1); }],
    ["legacy-impact bridge fingerprint rewrite", ({ envelope }) => {
      envelope.legacyImpactBridges[0]!.sourceFingerprint = "f".repeat(64);
    }],
    ["legacy-impact bridge owner rewrite", ({ envelope }) => {
      envelope.legacyImpactBridges[0]!.rowMappingId = "mapping-wrong-owner";
    }],
    ["legacy source discriminator rewrite", ({ envelope, genericBridge }) => {
      envelope.legacySourceType = "rewritten_source";
      envelope.rowMapping.sourceType = "rewritten_source";
      genericBridge.sourceType = "rewritten_source";
    }],
    ["missing nested legacy impact snapshot", ({ envelope }) => {
      const legacyImpactSnapshot = envelope.legacyImpactSnapshot as Record<string, unknown>;
      legacyImpactSnapshot.costImpactSnapshot = undefined;
      const rewrittenFingerprint = fingerprint({
        legacySourceFingerprint: envelope.legacySourceFingerprint,
        legacyImpactEntryId: legacyImpactSnapshot.costImpactId,
        impactKind: "confirmed_cost",
        direction: envelope.deltaDirection,
        amountCents: envelope.legacyImpactBridges[0]!.amountCents,
        impactSnapshot: undefined
      });
      legacyImpactSnapshot.costImpactFingerprint = rewrittenFingerprint;
      envelope.legacyImpactBridges[0]!.sourceFingerprint = rewrittenFingerprint;
    }],
    ["generic bridge wrong-mapping append", ({ genericBridge, genericBridges }) => {
      genericBridges.push({ ...genericBridge, id: "legacy-bridge-wrong-mapping", rowMappingId: "mapping-wrong-owner" });
    }],
    ["generic bridge wrong-target append", ({ genericBridge, genericBridges }) => {
      genericBridges.push({ ...genericBridge, id: "legacy-bridge-wrong-target", targetRef: "envelope-wrong-target" });
    }],
    ["receipt line addition", ({ activation, activationLine }) => {
      activation.lines.push({ ...activationLine, id: "activation-line-added" });
    }],
    ["receipt line deletion", ({ activation }) => { activation.lines.splice(0); }],
    ["receipt line target rewrite", ({ activationLine }) => { activationLine.targetRef = "envelope-wrong-target"; }],
    ["receipt line duplicate ordinal and lineNo", ({ activation, activationLine }) => {
      activation.lines.push({
        ...activationLine,
        id: "activation-line-duplicate-order",
        rowMappingId: "mapping-duplicate-order"
      });
    }],
    ["eligibility revocation append", ({ envelope }) => {
      envelope.eligibilityRevocations.push({
        id: "revocation-prior-graph",
        envelopeId: envelope.id,
        compensationReceiptId: "compensation-prior-graph",
        reason: "eligibility revoked",
        createdTransactionId: 106n,
        createdAt: new Date("2026-09-04T00:05:00.000Z")
      });
    }],
    ["non-success compensation receipt append", ({ reservation, activation }) => {
      reservation.atomicScope.receipts.push({
        ...activation,
        id: "compensation-receipt-prior-graph",
        action: "historical_wage_takeover.scope.compensate",
        status: "failed",
        causesReceiptId: activation.id,
        lines: [],
        causedReceipts: []
      });
    }],
    ["activation cause successor append", ({ activation }) => {
      activation.causedReceipts.push({
        id: "cause-successor-prior-graph",
        action: "historical_wage_takeover.scope.activate",
        status: "prepared",
        atomicScopeVersionId: "scope-successor-prior-graph",
        causesReceiptId: activation.id
      });
    }],
    ["duplicate cost semantic key", ({ envelope }) => {
      envelope.costCells.push({ ...envelope.costCells[0]!, id: "envelope-cost-duplicate-semantic" });
    }],
    ["duplicate payable child id", ({ envelope }) => {
      envelope.payableRefs.push({ ...envelope.payableRefs[0]!, payableRefId: "payable-ref-duplicate-id" });
    }]
  ];

  it.each(priorCanonicalGraphInvalidations)("rejects prior canonical graph %s", async (_label, mutate) => {
    const fixture = setupPriorCanonicalGraphProof();
    await expect(fixture.prove()).resolves.toEqual(expect.objectContaining({
      priorCanonicalGraphFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
    }));

    mutate(fixture);

    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("fingerprints valid prior canonical graph header, actor snapshot and line timestamp rewrites", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    const initial = await fixture.prove() as { priorCanonicalGraphFingerprint: string };

    fixture.envelope.createdAt = new Date("2026-09-04T00:03:05.000Z");
    const envelopeRewrite = await fixture.prove() as { priorCanonicalGraphFingerprint: string };
    expect(envelopeRewrite.priorCanonicalGraphFingerprint).not.toBe(initial.priorCanonicalGraphFingerprint);

    fixture.activation.actorSetSnapshot = {
      ...fixture.activation.actorSetSnapshot,
      actualRoles: ["finance_director", "finance_staff"]
    };
    const receiptRewrite = await fixture.prove() as { priorCanonicalGraphFingerprint: string };
    expect(receiptRewrite.priorCanonicalGraphFingerprint).not.toBe(envelopeRewrite.priorCanonicalGraphFingerprint);

    fixture.activationLine.createdAt = new Date("2026-09-04T00:04:05.000Z");
    const lineRewrite = await fixture.prove() as { priorCanonicalGraphFingerprint: string };
    expect(lineRewrite.priorCanonicalGraphFingerprint).not.toBe(receiptRewrite.priorCanonicalGraphFingerprint);
  });

  it("normalizes prior canonical graph collection order without swallowing duplicates", async () => {
    const fixture = setupPriorCanonicalGraphProof();
    fixture.envelope.costCells[0]!.amountCents = 400n;
    fixture.envelope.costCells.push({
      ...fixture.envelope.costCells[0]!,
      id: "envelope-cost-second",
      costCellId: "cost-cell-second",
      amountCents: 600n
    });
    fixture.envelope.payableRefs[0]!.amountCents = 400n;
    fixture.envelope.payableRefs.push({
      ...fixture.envelope.payableRefs[0]!,
      id: "envelope-payable-second",
      payableRefId: "payable-ref-second",
      amountCents: 600n
    });
    const initial = await fixture.prove() as { priorCanonicalGraphFingerprint: string; priorCanonicalGraph: unknown };

    fixture.envelope.costCells.reverse();
    fixture.envelope.payableRefs.reverse();
    fixture.envelope.legacyImpactBridges.reverse();
    fixture.reservation.atomicScope.projects.reverse();
    fixture.reservation.atomicScope.receipts.reverse();
    fixture.reservation.atomicScope.receipts.forEach((receipt) => receipt.lines.reverse());
    fixture.reservation.atomicScope.wageProjectionEnvelopes.reverse();
    fixture.genericBridges.reverse();
    const reversed = await fixture.prove() as { priorCanonicalGraphFingerprint: string; priorCanonicalGraph: unknown };

    expect(reversed.priorCanonicalGraphFingerprint).toBe(initial.priorCanonicalGraphFingerprint);
    expect(reversed.priorCanonicalGraph).toEqual(initial.priorCanonicalGraph);
    expect(fixture.tx.operatingTakeoverLegacySourceBridge.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        OR: [
          { rowMappingId: { in: ["mapping-prior-graph"] } },
          { targetKind: "wage_takeover_projection_envelope", targetRef: { in: ["envelope-prior-graph"] } }
        ]
      }
    }));
  });

  it("proves the active direct predecessor scope instead of accepting only the immutable root envelope", async () => {
    const fixture = setupPriorCanonicalGraphProof();

    await expect(fixture.prove()).resolves.toEqual(expect.objectContaining({
      priorVersionId: fixture.reservation.id,
      priorSourceVersionId: fixture.plan.priorSourceVersionId,
      priorAtomicScopeVersionId: fixture.reservation.atomicScopeVersionId,
      activationReceiptId: fixture.activation.id,
      activeEnvelopes: [expect.objectContaining({
        envelopeId: fixture.envelope.id,
        bridgeId: fixture.genericBridge.id
      })]
    }));

    fixture.envelope.eligibilityRevocations.push({ id: "revocation-prior-graph" });
    await expect(fixture.prove()).resolves.toBeNull();
  });

  it("reserves the exact N+1 revision on the existing logical statement for a legacy correction", async () => {
    const { service, tx, wageStatements } = setup();
    const sourceFingerprint = "b".repeat(64);
    const evidenceSha256 = "c".repeat(64);
    const correctionFact = {
      ...legacyFact,
      id: "fact-correction-1",
      sourceBusinessId: "legacy-wage-correction-1",
      sourceVersion: 2,
      amountCents: 200n,
      entryKind: "correction",
      adjustsFactId: "fact-root-1",
      impacts: [
        { id: "impact-cost-correction-1", impactKind: "confirmed_cost", amountCents: 200n, direction: "decrease", sourceImpactKey: "cost" },
        { id: "impact-payable-correction-1", impactKind: "payable_decrease", amountCents: 200n, direction: "decrease", sourceImpactKey: "payable" }
      ]
    };
    const rootFact = { ...legacyFact, id: "fact-root-1" };
    const rootHash = historicalWageLegacyFingerprint(rootFact);
    const currentSource = schemaFaithfulApprovedSource({
      id: "approved-source-2",
      employmentCompanyId: "company-1",
      sourceFingerprint,
      evidenceFileId: "approved-evidence-2",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "800",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "800" }]
        }]
      }
    });
    const priorSourceSnapshot = {
      approvedPersonLines: [{
        employeeId: "employee-1",
        employmentSnapshotId: "employment-snapshot-1",
        employmentCompanyId: "company-1",
        approvedAmountCents: "1000",
        evidenceSha256,
        projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "1000" }]
      }]
    };
    tx.operatingFact.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.id === "fact-root-1" ? rootFact : correctionFact
    ));
    tx.operatingFact.findMany.mockResolvedValue([rootFact, correctionFact]);
    tx.wageApprovedSourceVersion.findMany.mockResolvedValue([currentSource]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(currentSource);
    tx.fileObject.findUnique.mockResolvedValue({
      id: currentSource.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    tx.wageStatementVersion.findFirst.mockResolvedValue({
      id: "wage-version-1",
      statementId: "statement-1",
      revision: 1,
      kind: "base",
      status: "confirmed",
      projectionOrigin: "historical_takeover_legacy_link",
      sourceVersionId: "approved-source-1",
      sourceSnapshot: priorSourceSnapshot,
      operatingProjectionSnapshot: null,
      personLines: canonicalPriorPersonLines()
    });
    tx.wagePayableRef.findMany.mockResolvedValue([{
      id: "wage-root-ref-1",
      confirmedVersionId: "wage-version-1",
      direction: "increase",
      amountCents: 1000n,
      adjustsPayableRefId: null,
      debtorCompanyId: "company-1",
      costBearingCompanyId: "company-1",
      projectId: "project-1",
      confirmedVersion: {
        id: "wage-version-1",
        revision: 1,
        status: "confirmed",
        projectionOrigin: "historical_takeover_legacy_link"
      },
      projectAllocation: { serviceSnapshotId: "service-1" },
      personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-snapshot-1" },
      creditorBreakdown: {
        creditorSubjectType: "employee_user",
        creditorSubjectIdentityKey: "employee_user:employee-1",
        creditorCategory: "employee_net_pay"
      },
      adjustments: []
    }]);
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind: "correction",
      priorConfirmedVersionId: "wage-version-1",
      priorSourceVersionId: "approved-source-1",
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: ["wage-root-ref-1"],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "-200", signedPayableDeltaCents: "-200" }]
    });
    mockActivePriorAEligibility(tx, {
      versionId: "wage-version-1",
      sourceVersionId: "approved-source-1",
      statementId: "statement-1",
      revision: 1,
      projectId: "project-1",
      legacySourceFingerprint: rootHash
    });
    mockAMaterializationAuthority(tx, currentSource);
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    const rootEnvelopeId = "envelope-root-1";
    const rootCanonicalFingerprint = "a".repeat(64);
    tx.operatingTakeoverLegacySourceBridge.findFirst.mockResolvedValue({
      id: "bridge-root-1",
      targetKind: "wage_takeover_projection_envelope",
      targetRef: rootEnvelopeId,
      targetFingerprint: fingerprint({
        targetKind: "wage_takeover_projection_envelope",
        targetRef: rootEnvelopeId,
        canonicalFingerprint: rootCanonicalFingerprint,
        sourceFingerprint: rootHash
      }),
      mappingDecision: "FORMAL"
    });
    tx.wageTakeoverProjectionEnvelope.findFirst.mockResolvedValue({
      id: rootEnvelopeId,
      wageStatementVersionId: "wage-version-1",
      projectId: "project-1",
      legacySourceType: "project_wage",
      legacySourceBusinessId: "legacy-wage-1",
      legacySourceVersion: 1,
      legacySourceFingerprint: rootHash,
      projectionOrigin: "historical_takeover_legacy_link",
      deltaDirection: "increase",
      canonicalFingerprint: rootCanonicalFingerprint,
      payableRefs: [{ payableRefId: "wage-root-ref-1" }],
      eligibilityRevocations: [],
      wageStatementVersion: {
        id: "wage-version-1",
        statementId: "statement-1",
        revision: 1,
        kind: "base",
        sourceVersionId: "approved-source-1",
        projectionOrigin: "historical_takeover_legacy_link",
        status: "confirmed"
      }
    });
    const issued = await service.options("finance-1", "project-1", new Date("2026-09-04T00:00:00.000Z"));
    const selectionRef = issued.options.find((option) => option.grade === "A")?.selectionRef;
    expect(selectionRef).toEqual(expect.stringMatching(/^hwt1\./u));
    try {
      await expect(service.createScope("finance-1", {
        selectionRef: selectionRef!,
        idempotencyKey: "27272727-2727-4272-8272-272727272727",
        expectedRevision: 0,
        businessReason: "冻结既有逻辑工资单的相邻更正版本"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({ grade: "A" }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.wageTakeoverWageStatementReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetWageStatementId: "statement-1",
        expectedCurrentRevision: 1,
        reservedRevision: 2,
        versionKind: "correction",
        priorConfirmedVersionId: "wage-version-1",
        priorSourceVersionId: "approved-source-1"
      })
    });
  });

  it("rejects a correction whose root envelope contains a payable outside the canonical root closure", async () => {
    const { service, selectionRefs, tx, wageStatements } = setup();
    const sourceFingerprint = "b".repeat(64);
    const evidenceSha256 = "c".repeat(64);
    const correctionFact = {
      ...legacyFact,
      id: "fact-correction-unrelated-root",
      sourceBusinessId: "legacy-wage-correction-unrelated-root",
      sourceVersion: 2,
      amountCents: 200n,
      entryKind: "correction",
      adjustsFactId: "fact-root-1",
      impacts: [
        { id: "impact-cost-correction-unrelated-root", impactKind: "confirmed_cost", amountCents: 200n, direction: "decrease", sourceImpactKey: "cost" },
        { id: "impact-payable-correction-unrelated-root", impactKind: "payable_decrease", amountCents: 200n, direction: "decrease", sourceImpactKey: "payable" }
      ]
    };
    const rootFact = { ...legacyFact, id: "fact-root-1" };
    const rootHash = historicalWageLegacyFingerprint(rootFact);
    const correctionHash = historicalWageLegacyFingerprint(correctionFact as never);
    const currentSource = schemaFaithfulApprovedSource({
      id: "approved-source-2",
      employmentCompanyId: "company-1",
      sourceFingerprint,
      evidenceFileId: "approved-evidence-2",
      evidenceSha256,
      wageMonth: "2026-08",
      sourceSnapshot: {
        approvedPersonLines: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-snapshot-1",
          employmentCompanyId: "company-1",
          approvedAmountCents: "800",
          evidenceSha256,
          projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", amountCents: "800" }]
        }]
      }
    });
    const legacyRead = {
      factId: correctionFact.id,
      projectId: "project-1",
      sourceType: "project_wage",
      sourceBusinessId: correctionFact.sourceBusinessId,
      sourceVersion: 2,
      sourceFingerprint: correctionHash,
      legacyWageMonth: "2026-08",
      employmentCompanyId: "company-1",
      amountCents: 200n,
      entryKind: "correction",
      direction: "decrease",
      adjustsFactId: "fact-root-1",
      adjustmentRoot: {
        factId: "fact-root-1",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: rootHash,
        legacyWageMonth: "2026-08",
        employmentCompanyId: "company-1"
      },
      costImpactId: "impact-cost-correction-unrelated-root",
      payableImpactId: "impact-payable-correction-unrelated-root"
    };
    const sourceClosureFingerprint = fingerprint({
      sourceVersionId: currentSource.id,
      sourceFingerprint,
      projectIds: ["project-1"],
      legacy: [legacyRead]
    });
    tx.operatingFact.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where?.id === "fact-root-1" ? rootFact : correctionFact
    ));
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue(currentSource);
    tx.fileObject.findUnique.mockResolvedValue({
      id: currentSource.evidenceFileId,
      storageStatus: "active",
      contentSha256: evidenceSha256
    });
    wageStatements.planHistoricalTakeoverInTransaction.mockResolvedValue({
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind: "correction",
      priorConfirmedVersionId: "wage-version-1",
      priorSourceVersionId: "approved-source-1",
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      canonicalRootPayableRefIds: ["wage-root-ref-1"],
      projects: [{ projectId: "project-1", signedCostDeltaCents: "-200", signedPayableDeltaCents: "-200" }]
    });
    mockActivePriorAEligibility(tx, {
      versionId: "wage-version-1",
      sourceVersionId: "approved-source-1",
      statementId: "statement-1",
      revision: 1,
      projectId: "project-1",
      legacySourceFingerprint: rootHash
    });
    const unrelatedEnvelopeId = "envelope-unrelated-root";
    const unrelatedCanonicalFingerprint = "a".repeat(64);
    tx.operatingTakeoverLegacySourceBridge.findFirst.mockResolvedValue({
      id: "bridge-unrelated-root",
      targetKind: "wage_takeover_projection_envelope",
      targetRef: unrelatedEnvelopeId,
      targetFingerprint: fingerprint({
        targetKind: "wage_takeover_projection_envelope",
        targetRef: unrelatedEnvelopeId,
        canonicalFingerprint: unrelatedCanonicalFingerprint,
        sourceFingerprint: rootHash
      }),
      mappingDecision: "FORMAL"
    });
    tx.wageTakeoverProjectionEnvelope.findFirst.mockResolvedValue({
      id: unrelatedEnvelopeId,
      wageStatementVersionId: "wage-version-1",
      projectId: "project-1",
      legacySourceType: "project_wage",
      legacySourceBusinessId: "legacy-wage-1",
      legacySourceVersion: 1,
      legacySourceFingerprint: rootHash,
      projectionOrigin: "historical_takeover_legacy_link",
      deltaDirection: "increase",
      canonicalFingerprint: unrelatedCanonicalFingerprint,
      payableRefs: [
        { payableRefId: "wage-root-ref-1" },
        { payableRefId: "wage-unrelated-root-ref" }
      ],
      eligibilityRevocations: [],
      wageStatementVersion: {
        id: "wage-version-1",
        statementId: "statement-1",
        revision: 1,
        kind: "base",
        sourceVersionId: "approved-source-1",
        projectionOrigin: "historical_takeover_legacy_link",
        status: "confirmed"
      }
    });
    const selectionRef = selectionRefs.issue({
      actorUserId: "finance-1",
      selectionFingerprint: HASH,
      grade: "A",
      sourceVersionId: currentSource.id,
      sourceFingerprint,
      sourceClosureFingerprint,
      legacyCoordinates: [{
        projectId: "project-1",
        sourceType: "project_wage",
        sourceBusinessId: correctionFact.sourceBusinessId,
        sourceVersion: 2,
        sourceFingerprint: correctionHash
      }]
    }, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef,
        idempotencyKey: "28282828-2828-4282-8282-282828282828",
        expectedRevision: 0,
        businessReason: "拒绝无关 legacy root 或 canonical payable root 的工资更正"
      }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("A级权威来源已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.operatingTakeoverAtomicScopeVersion.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverManifestVersion.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverAtomicScopeProject.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverWageStatementReservation.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverRowMapping.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverCommandReceipt.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverCommandReceiptLine.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(wageStatements.confirmHistoricalTakeoverInTransaction).not.toHaveBeenCalled();
    expect(tx.wageStatementVersion.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelope.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelopeCostCell.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverProjectionEnvelopePayableRef.create).not.toHaveBeenCalled();
    expect(tx.wageTakeoverLegacyImpactBridge.create).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
    expect(tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
    expect(tx.wagePayableRef.findMany).not.toHaveBeenCalled();
  });

  it("reissues a scoped command ref to the independent reviewer without letting client data alter the scope", async () => {
    const { service, selectionRefs, tx } = setup();
    const binding = cBinding({ actorUserId: "finance-1", atomicScopeVersionId: "scope-1" });
    tx.operatingTakeoverAtomicScopeVersion.findUnique = jest.fn().mockResolvedValue(cScope(binding));
    const sourceRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.issueScopedCommandSelection("finance-2", { selectionRef: sourceRef }, new Date("2026-09-04T00:01:00.000Z")))
        .resolves.toEqual(expect.objectContaining({ atomicScopeVersionId: "scope-1", commandSelectionRef: expect.any(String) }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("fails baseline drift before writing an inactive-apply receipt", async () => {
    const { service, selectionRefs, tx } = setup();
    const binding = cBinding({ actorUserId: "finance-1", atomicScopeVersionId: "scope-1" });
    tx.operatingTakeoverAtomicScopeVersion.findUnique = jest.fn().mockResolvedValue(cScope(binding, "e".repeat(40)));
    const selectionRef = selectionRefs.issue(binding, new Date("2026-09-04T00:00:00.000Z"));
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.apply("finance-1", {
        selectionRef,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        expectedRevision: 1,
        businessReason: "验证候选基线"
      }, new Date("2026-09-04T00:01:00.000Z"))).rejects.toThrow("候选基线已漂移");
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expect(tx.operatingTakeoverCommandReceipt.create).not.toHaveBeenCalled();
  });

  it("freezes a B aggregate authority from a server snapshot without inventing an employee or payment", async () => {
    const { service, tx } = setup();
    const summary = r2HistoricalSummary();
    const parsed = parseHistoricalWageSummaryAuthority(summary)!;
    const bLegacyFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([bLegacyFact]);
    tx.operatingFact.findUnique.mockResolvedValue(bLegacyFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const issued = await service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:00:00.000Z")
    );
    const selectionRef = issued.options.find((option) => option.grade === "B")?.selectionRef;
    if (!selectionRef) throw new Error("expected complete B authority to issue an option");
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        expectedRevision: 0,
        businessReason: "冻结历史工资汇总余额"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({
        grade: "B",
        atomicScopeVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/u)
      }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
    expect(tx.historicalWageSummaryAuthorityVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        sourceSchemaVersion: 1,
        sourcePayload: parsed.sourceVersionPayload,
        sourceVersionFingerprint: parsed.sourceVersionFingerprint,
        authoritySchemaVersion: 1,
        authorityPayload: expect.objectContaining({
          authorityVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          atomicScopeVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/u)
        }),
        authorityFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    }));
    expect(tx.historicalWageSummaryAuthorityVersion.create.mock.calls[0]![0].data)
      .not.toEqual(expect.objectContaining({ employeeId: expect.anything(), payeeSubjectId: expect.anything() }));
    expect(tx.historicalWageSummaryAuthorityCreditorLine.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetBusinessKey: "balance-v1",
        targetPayload: expect.objectContaining({ reservedTargetId: expect.stringMatching(/^[0-9a-f-]{36}$/u) }),
        targetFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    }));
    expect(tx.historicalWageSummaryAuthorityAttestation.create).toHaveBeenCalled();
    expect(tx.wageStatementVersion.create).not.toHaveBeenCalled();
  });

  it("recomputes the server-finalized B authority from its reserved IDs during scope revalidation", async () => {
    const { service, selectionRefs, tx } = setup();
    const revalidator = service as unknown as {
      loadAndRevalidateScope(client: unknown, binding: unknown): Promise<Record<string, unknown>>;
    };
    const summary = r2HistoricalSummary();
    const bLegacyFact = { ...legacyFact, sourceSnapshot: { historicalWageSummaryAuthority: summary } };
    tx.operatingFact.findMany.mockResolvedValue([bLegacyFact]);
    tx.operatingFact.findUnique.mockResolvedValue(bLegacyFact);
    tx.fileObject.findMany.mockResolvedValue([
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) }
    ]);
    const issued = await service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:00:00.000Z")
    );
    const sourceRef = issued.options.find((option) => option.grade === "B")?.selectionRef;
    if (!sourceRef) throw new Error("expected complete B authority to issue an option");
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      const created = await service.createScope("finance-1", {
        selectionRef: sourceRef,
        idempotencyKey: "57575757-5757-4757-8757-575757575757",
        expectedRevision: 0,
        businessReason: "验证B级服务端预留标识重验"
      }, new Date("2026-09-04T00:01:00.000Z"));
      if (
        typeof created !== "object" ||
        created === null ||
        !("commandSelectionRef" in created) ||
        typeof created.commandSelectionRef !== "string" ||
        !("atomicScopeVersionId" in created) ||
        typeof created.atomicScopeVersionId !== "string"
      ) {
        throw new Error("expected B createScope to return its reserved scope and scoped selectionRef");
      }
      const commandSelectionRef = created.commandSelectionRef;
      const atomicScopeVersionId = created.atomicScopeVersionId;

      const scopeData = tx.operatingTakeoverAtomicScopeVersion.create.mock.calls[0]![0].data;
      const manifestData = tx.operatingTakeoverManifestVersion.create.mock.calls[0]![0].data;
      const scopeProjectData = tx.operatingTakeoverAtomicScopeProject.create.mock.calls[0]![0].data;
      const mappingData = tx.operatingTakeoverRowMapping.create.mock.calls[0]![0].data;
      const authorityData = tx.historicalWageSummaryAuthorityVersion.create.mock.calls[0]![0].data;
      const creditorLines = tx.historicalWageSummaryAuthorityCreditorLine.create.mock.calls.map((call) => call[0].data);
      const receiptData = tx.operatingTakeoverCommandReceipt.create.mock.calls[0]![0].data;
      const persistedScope = {
        ...scopeData,
        projects: [{
          ...scopeProjectData,
          manifest: { ...manifestData, id: "manifest-1", rows: [{ ...mappingData, id: "mapping-1" }] }
        }],
        historicalSummaryAuthorities: [{
          ...authorityData,
          attestations: [],
          payableRefs: [],
          creditorLines
        }],
        wageStatementReservation: null,
        receipts: [{ ...receiptData, id: "receipt-1", lines: [] }]
      };
      tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValue(persistedScope);
      const scopedBinding = selectionRefs.read(commandSelectionRef, new Date("2026-09-04T00:01:30.000Z"))!;

      await expect(revalidator.loadAndRevalidateScope(tx, scopedBinding)).resolves.toEqual(expect.objectContaining({
        scope: expect.objectContaining({ id: atomicScopeVersionId }),
        plan: expect.objectContaining({ grade: "B" }),
        authorities: [expect.objectContaining({ id: authorityData.id })]
      }));

      const receiptWriteCount = tx.operatingTakeoverCommandReceipt.create.mock.calls.length;
      const formalTargetWriteCount = tx.historicalWageSummaryPayableRef.create.mock.calls.length;
      const driftedScopes = [
        {
          ...persistedScope,
          historicalSummaryAuthorities: [{
            ...persistedScope.historicalSummaryAuthorities[0],
            sourcePayload: { ...authorityData.sourcePayload, originalBusinessNumber: "DRIFTED" }
          }]
        },
        {
          ...persistedScope,
          historicalSummaryAuthorities: [{
            ...persistedScope.historicalSummaryAuthorities[0],
            scopeCreatorIdentitySnapshot: {
              ...authorityData.scopeCreatorIdentitySnapshot,
              actorIds: ["finance-1", "intruder-1"]
            }
          }]
        },
        {
          ...persistedScope,
          historicalSummaryAuthorities: [{
            ...persistedScope.historicalSummaryAuthorities[0],
            creditorLines: creditorLines.map((line, index) => index === 0
              ? { ...line, id: "not-a-reserved-uuid" }
              : line)
          }]
        },
        {
          ...persistedScope,
          historicalSummaryAuthorities: [{
            ...persistedScope.historicalSummaryAuthorities[0],
            creditorLines: creditorLines.map((line, index) => index === 0
              ? { ...line, targetPayload: { ...line.targetPayload, reconciliationReference: "DRIFTED" } }
              : line)
          }]
        },
        {
          ...persistedScope,
          projects: persistedScope.projects.map((project: {
            manifest: { rows: Array<Record<string, unknown>> };
            [key: string]: unknown;
          }) => ({
            ...project,
            manifest: {
              ...project.manifest,
              rows: project.manifest.rows.map((row) => ({
                ...row,
                historicalWageSummaryAuthorityVersionId: null
              }))
            }
          }))
        }
      ];
      for (const driftedScope of driftedScopes) {
        tx.operatingTakeoverAtomicScopeVersion.findUnique.mockResolvedValueOnce(driftedScope);
        await expect(revalidator.loadAndRevalidateScope(tx, scopedBinding)).rejects.toThrow();
        expect(tx.operatingTakeoverCommandReceipt.create).toHaveBeenCalledTimes(receiptWriteCount);
        expect(tx.historicalWageSummaryPayableRef.create).toHaveBeenCalledTimes(formalTargetWriteCount);
      }
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }
  });

  it("creates B revision N+1 against its direct predecessor and preserves a zero creditor tombstone", async () => {
    const { service, selectionRefs, tx } = setup();
    const priorSummary = r2HistoricalSummary();
    const socialLine = {
      ...priorSummary.lines[0]!,
      creditorCategoryCode: "employer_social_insurance",
      creditorCategoryLabel: "单位承担社会保险",
      controlledScopeCode: "social_insurance_authority",
      controlledScopeDescription: "历史单位社会保险范围",
      grossDebtCents: "0",
      historicallySettledCents: "0",
      outstandingBalanceCents: "0",
      debtStatus: "settled",
      target: {
        ...priorSummary.lines[0]!.target,
        reconciliationAuthorityVersionId: "balance-social-v1",
        reconciliationReference: "BAL-SOCIAL-2026-08-1",
        wageCreditorCategoryCode: "employer_social_insurance",
        wageCreditorCategoryLabelSnapshot: "单位承担社会保险",
        debtStatus: "settled",
        grossDebtCents: "0",
        historicallySettledCents: "0",
        outstandingBalanceCents: "0",
        evidence: [{
          fileObjectId: "file-balance-social",
          contentSha256: "5".repeat(64),
          evidenceCoordinate: r2Coordinate("15")
        }]
      }
    };
    priorSummary.lines = [priorSummary.lines[0]!, socialLine];
    const summary = {
      ...priorSummary,
      originalSourceVersion: "V2",
      sourceVersionFingerprint: null,
      lines: priorSummary.lines.map((line) => line.creditorCategoryCode === "employee_net_pay"
        ? {
            ...line,
            grossDebtCents: "600",
            outstandingBalanceCents: "600",
            target: {
              ...line.target,
              sourceVersionFingerprint: null,
              reconciliationFingerprint: null,
              grossDebtCents: "600",
              outstandingBalanceCents: "600"
            }
          }
        : {
            ...line,
            target: {
              ...line.target,
              sourceVersionFingerprint: null,
              reconciliationFingerprint: null
            }
          })
    };
    const parsed = parseHistoricalWageSummaryAuthority(summary)!;
    expect(parsed).not.toBeNull();
    const rootFact = {
      ...legacyFact,
      id: "fact-b-root-1",
      sourceBusinessId: "legacy-wage-b-root-1",
      sourceSnapshot: { historicalWageSummaryAuthority: priorSummary }
    };
    const activePrior = await captureActiveBPrior(priorSummary, rootFact);
    const correctionFact = {
      ...legacyFact,
      id: "fact-b-correction-1",
      sourceBusinessId: "legacy-wage-b-correction-1",
      sourceVersion: 2,
      amountCents: 400n,
      entryKind: "correction",
      adjustsFactId: rootFact.id,
      sourceSnapshot: { historicalWageSummaryAuthority: summary },
      impacts: [
        { id: "impact-cost-b-correction-1", impactKind: "confirmed_cost", amountCents: 400n, direction: "decrease", sourceImpactKey: "cost" },
        { id: "impact-payable-b-correction-1", impactKind: "payable_decrease", amountCents: 400n, direction: "decrease", sourceImpactKey: "payable" }
      ]
    };
    tx.operatingFact.findMany.mockResolvedValue([rootFact, correctionFact]);
    tx.operatingFact.findUnique.mockImplementation(({ where }) => Promise.resolve(where?.id === rootFact.id ? rootFact : correctionFact));
    const evidenceFiles = [
      { id: "file-source-1", storageStatus: "active", contentSha256: "3".repeat(64) },
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) },
      { id: "file-balance-social", storageStatus: "active", contentSha256: "5".repeat(64) }
    ];
    tx.fileObject.findMany.mockImplementation(({ where }) => Promise.resolve(
      evidenceFiles.filter((file) => where?.id?.in?.includes(file.id))
    ));
    tx.historicalWageSummaryAuthorityVersion.findMany.mockResolvedValue([activePrior.authority]);
    tx.historicalWageSummaryPayableRef.findMany.mockResolvedValue(activePrior.payableRefs);
    const lineageReader = service as unknown as {
      readSummaryPriorLineageProof(client: unknown, snapshot: unknown): Promise<Record<string, unknown>>;
    };
    await expect(lineageReader.readSummaryPriorLineageProof(tx, parsed)).resolves.toEqual(
      expect.objectContaining({
        state: "active",
        reasonCode: "B_PRIOR_ACTIVE",
        activePriorAuthorityId: activePrior.authority.id
      })
    );
    const issued = await service.options(
      "finance-1",
      "project-1",
      new Date("2026-09-04T00:00:00.000Z")
    );
    const selectionRef = issued.options.find((option) =>
      selectionRefs.read(option.selectionRef, new Date("2026-09-04T00:00:00.000Z"))
        ?.legacyCoordinates[0]?.sourceBusinessId === correctionFact.sourceBusinessId
    )?.selectionRef;
    if (!selectionRef) throw new Error("expected B correction to issue an option");
    const savedSha = process.env.BUILD_COMMIT_SHA;
    process.env.BUILD_COMMIT_SHA = "f".repeat(40);
    try {
      await expect(service.createScope("finance-1", {
        selectionRef,
        idempotencyKey: "56565656-5656-4656-8656-565656565656",
        expectedRevision: 0,
        businessReason: "冻结B级相邻快照更正与零类别墓碑"
      }, new Date("2026-09-04T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({ grade: "B" }));
    } finally {
      if (savedSha === undefined) delete process.env.BUILD_COMMIT_SHA;
      else process.env.BUILD_COMMIT_SHA = savedSha;
    }

    expect(tx.historicalWageSummaryAuthorityVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 2,
        supersedesVersionId: activePrior.authority.id,
        lineageRootAuthorityVersionId: activePrior.authority.id
      })
    }));
    expect(tx.historicalWageSummaryAuthorityCreditorLine.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wageCreditorCategoryCode: "employee_net_pay",
        signedGrossDeltaCents: -400n,
        rootCreditorLineId: activePrior.authority.creditorLines.find(
          (line: { wageCreditorCategoryCode: string }) => line.wageCreditorCategoryCode === "employee_net_pay"
        )!.id
      })
    }));
    expect(tx.historicalWageSummaryAuthorityCreditorLine.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wageCreditorCategoryCode: "employer_social_insurance",
        grossDebtCents: 0n,
        isTombstone: true,
        signedGrossDeltaCents: 0n,
        rootCreditorLineId: activePrior.authority.creditorLines.find(
          (line: { wageCreditorCategoryCode: string }) => line.wageCreditorCategoryCode === "employer_social_insurance"
        )!.id
      })
    }));
    expect(tx.operatingTakeoverRowMapping.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adjustmentTargetRef: rootFact.id,
        readSetSnapshot: expect.objectContaining({
          plan: expect.objectContaining({
            summaryRevision: 2,
            summarySupersedesVersionId: activePrior.authority.id,
            summaryLines: expect.arrayContaining([
              expect.objectContaining({ wageCreditorCategoryCode: "employee_net_pay", signedGrossDeltaCents: "-400" }),
              expect.objectContaining({ wageCreditorCategoryCode: "employer_social_insurance", signedGrossDeltaCents: "0" })
            ])
          })
        })
      })
    }));
  });

  it("keeps a zero B delta in the authority snapshot without creating a payable effect", async () => {
    const { service, tx } = setup();
    const summary = r2HistoricalSummary();
    summary.lines[0]!.grossDebtCents = "600";
    summary.lines[0]!.outstandingBalanceCents = "600";
    summary.lines[0]!.target.grossDebtCents = "600";
    summary.lines[0]!.target.outstandingBalanceCents = "600";
    const socialSourceLine = {
      ...summary.lines[0]!,
      creditorCategoryCode: "employer_social_insurance",
      creditorCategoryLabel: "单位承担社会保险",
      controlledScopeCode: "social_insurance_authority",
      controlledScopeDescription: "历史单位社会保险范围",
      grossDebtCents: "0",
      outstandingBalanceCents: "0",
      debtStatus: "settled",
      target: {
        ...summary.lines[0]!.target,
        reconciliationAuthorityVersionId: "balance-social-v1",
        reconciliationReference: "BAL-SOCIAL-2026-08-1",
        wageCreditorCategoryCode: "employer_social_insurance",
        wageCreditorCategoryLabelSnapshot: "单位承担社会保险",
        debtStatus: "settled",
        grossDebtCents: "0",
        outstandingBalanceCents: "0",
        evidence: [{
          fileObjectId: "file-balance-social",
          contentSha256: "5".repeat(64),
          evidenceCoordinate: r2Coordinate("15")
        }]
      }
    };
    summary.lines.push(socialSourceLine);
    const parsed = parseHistoricalWageSummaryAuthority(summary)!;
    expect(parsed).not.toBeNull();
    const plannedLines = parsed.lines.map((line) => ({
      ...line,
      stableBucketKey: line.creditorStableKey,
      signedGrossDeltaCents: line.creditorCategoryCode === "employee_net_pay" ? -400n : 0n,
      signedHistoricallySettledDeltaCents: 0n,
      signedOutstandingBalanceDeltaCents: line.creditorCategoryCode === "employee_net_pay" ? -400n : 0n,
      deltaFingerprint: line.creditorCategoryCode === "employee_net_pay" ? "1".repeat(64) : "2".repeat(64),
      rootCreditorLineId: line.creditorCategoryCode === "employee_net_pay" ? "summary-creditor-root-net" : "summary-creditor-root-social",
      rootPayableRefId: line.creditorCategoryCode === "employee_net_pay" ? "summary-payable-root-net" : null
    }));
    const summaryAuthority = {
      authorityFingerprint: "b".repeat(64),
      sourceVersionFingerprint: parsed.sourceVersionFingerprint,
      employmentCompanyId: parsed.employmentCompanyId,
      projectId: parsed.projectId,
      wageMonth: parsed.wageMonth,
      catalogVersion: parsed.catalogVersion,
      positionCategoryCode: parsed.positionCategoryCode,
      positionCategoryLabel: parsed.positionCategoryLabel,
      evidenceCoordinate: parsed.evidenceCoordinate,
      revision: 2,
      supersedesVersionId: "summary-authority-v1",
      lineageRootAuthorityVersionId: "summary-authority-v1",
      sourceDeltaFingerprint: "d".repeat(64),
      rootClosureFingerprint: "f".repeat(64),
      sourceSnapshot: parsed.raw,
      snapshot: parsed
    };
    const context = {
      scope: { id: "scope-1", authoritySourceFingerprint: "a".repeat(64) },
      mappings: [{
        id: "mapping-1",
        manifestId: "manifest-1",
        projectId: "project-1",
        legacy: {
          factId: legacyFact.id,
          sourceType: legacyFact.sourceType,
          sourceBusinessId: legacyFact.sourceBusinessId,
          sourceVersion: legacyFact.sourceVersion,
          sourceFingerprint: LEGACY_HASH,
          projectId: legacyFact.projectId,
          amountCents: legacyFact.amountCents,
          direction: "increase",
          costImpactId: "impact-cost-1",
          payableImpactId: "impact-payable-1",
          costImpactSnapshot: {},
          payableImpactSnapshot: {}
        }
      }],
      plan: { grade: "B", summaryAuthority, summary: plannedLines }
    };
    const persistedLine = (id: string, line: (typeof plannedLines)[number], reservedTargetId: string) => {
      const finalizedTarget = finalizeHistoricalWageBalanceTarget(line, reservedTargetId)!;
      return {
      id,
      authorityVersionId: "summary-authority-v2",
      revision: 2,
      stableBucketKey: line.stableBucketKey,
      stableBucketKeyFingerprint: createHash("sha256").update(line.stableBucketKey, "utf8").digest("hex"),
      employmentCompanyId: "company-1",
      projectId: "project-1",
      wageMonth: "2026-08",
      positionCategoryCode: "engineering_technical",
      wageCreditorCategoryCode: line.creditorCategoryCode,
      wageCreditorCategoryLabelSnapshot: line.creditorCategoryLabel,
      creditorIdentityKind: line.creditorIdentityKind,
      creditorPartyVersionId: line.creditorPartyVersionId,
      controlledScopeCode: line.controlledScopeCode,
      controlledScopeDescription: line.controlledScopeDescription,
      controlledScopeEvidenceCoordinate: line.controlledScopeEvidenceCoordinate,
      currencyCode: "CNY",
      debtStatus: line.debtStatus,
      grossDebtCents: line.grossDebtCents,
      historicallySettledCents: line.historicallySettledCents,
      outstandingBalanceCents: line.outstandingBalanceCents,
      isTombstone: line.grossDebtCents === 0n,
      targetKind: line.target.kind,
      targetSchemaVersion: 1,
      targetBusinessKey: line.targetBusinessKey,
      targetPayload: finalizedTarget.canonicalPayload,
      targetFingerprint: finalizedTarget.reconciliationFingerprint,
      signedGrossDeltaCents: line.signedGrossDeltaCents,
      signedHistoricallySettledDeltaCents: line.signedHistoricallySettledDeltaCents,
      signedOutstandingBalanceDeltaCents: line.signedOutstandingBalanceDeltaCents,
      deltaFingerprint: line.deltaFingerprint,
      rootCreditorLineId: line.rootCreditorLineId,
      rootPayableRefId: line.rootPayableRefId
      };
    };
    const netLine = plannedLines.find((line) => line.creditorCategoryCode === "employee_net_pay")!;
    const socialLine = plannedLines.find((line) => line.creditorCategoryCode === "employer_social_insurance")!;
    const authority = {
      id: "summary-authority-v2",
      summaryBucketKey: "company-1:project-1:2026-08:engineering_technical",
      authorityFingerprint: summaryAuthority.authorityFingerprint,
      creditorLines: [
        persistedLine("summary-creditor-v2-net", netLine, "550e8400-e29b-41d4-a716-446655440021"),
        persistedLine("summary-creditor-v2-social", socialLine, "550e8400-e29b-41d4-a716-446655440022")
      ]
    };
    const evidenceFiles = [
      { id: "file-balance-1", storageStatus: "active", contentSha256: "4".repeat(64) },
      { id: "file-balance-social", storageStatus: "active", contentSha256: "5".repeat(64) }
    ];
    tx.fileObject.findMany.mockImplementation(({ where }) => Promise.resolve(
      evidenceFiles.filter((file) => where?.id?.in?.includes(file.id))
    ));

    const materializeBSummaryRefs = (
      service as unknown as {
        materializeBSummaryRefs: (...args: unknown[]) => Promise<unknown>;
      }
    ).materializeBSummaryRefs.bind(service);
    await expect(materializeBSummaryRefs(tx, context, authority, "finance-director-1"))
      .resolves.toEqual(expect.objectContaining({ decision: "FORMAL", targetRef: authority.id }));

    expect(tx.historicalWageBalanceReconciliationVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.historicalWageSummaryPaymentExecutionLink.create).not.toHaveBeenCalled();
    expect(tx.historicalWageSummaryPayableRef.create).toHaveBeenCalledTimes(1);
    expect(tx.historicalWageSummaryPayableRef.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wageCreditorCategoryCode: "employee_net_pay",
        direction: "decrease",
        deltaAmountCents: 400n
      })
    }));
    expect(tx.wageTakeoverLegacyImpactBridge.create).toHaveBeenCalledTimes(2);
    expect(tx.wageTakeoverLegacyImpactBridge.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ summaryAuthorityVersionId: authority.id, envelopeId: null })
    }));
  });

  it("materializes an A envelope from the signed canonical delta snapshot without flattening mixed directions", async () => {
    const { service, tx } = setup();
    const envelopeCreate = jest.fn().mockResolvedValue({ id: "envelope-1" });
    const costLinkCreate = jest.fn().mockResolvedValue({ id: "cost-link" });
    const payableLinkCreate = jest.fn().mockResolvedValue({ id: "payable-link" });
    const impactBridgeCreate = jest.fn().mockResolvedValue({ id: "impact-bridge" });
    Object.assign(tx, {
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "wage-version-2",
          projectionOrigin: "historical_takeover_legacy_link",
          operatingProjectionSnapshot: {
            projectionOrigin: "historical_takeover_legacy_link",
            wageStatementVersionId: "wage-version-2",
            wageVersionKind: "correction",
            projects: {
              "project-1": {
                canonicalCostDeltas: [
                  { costCellId: "cost-cell-plus", amountCents: "1200", direction: "increase" },
                  { costCellId: "cost-cell-minus", amountCents: "200", direction: "decrease" }
                ],
                canonicalPayableDeltas: [
                  { payableCellId: "payable-cell-plus", payableRefId: "payable-plus", amountCents: "1200", direction: "increase" },
                  { payableCellId: "payable-cell-minus", payableRefId: "payable-minus", amountCents: "200", direction: "decrease" }
                ]
              }
            }
          }
        })
      },
      wageProjectAllocation: {
        findMany: jest.fn().mockResolvedValue([{
          id: "allocation-1",
          componentAllocations: [
            { id: "cost-cell-plus", amountCents: 1300n },
            { id: "cost-cell-minus", amountCents: 300n }
          ],
          creditorAllocations: [
            { id: "payable-cell-plus", projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-plus", amountCents: 1300n },
            { id: "payable-cell-minus", projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-minus", amountCents: 300n }
          ]
        }])
      },
      wagePayableRef: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payable-plus", amountCents: 1200n, projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-plus", direction: "increase" },
          { id: "payable-minus", amountCents: 200n, projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-minus", direction: "decrease" }
        ])
      },
      wageTakeoverProjectionEnvelope: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: envelopeCreate
      },
      wageTakeoverProjectionEnvelopeCostCell: { create: costLinkCreate },
      wageTakeoverProjectionEnvelopePayableRef: { create: payableLinkCreate },
      wageTakeoverLegacyImpactBridge: { create: impactBridgeCreate }
    });
    const mapping = {
      id: "mapping-1",
      manifestId: "manifest-1",
      projectId: "project-1",
      legacy: {
        factId: "fact-1",
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-correction-1",
        sourceVersion: 2,
        sourceFingerprint: LEGACY_HASH,
        amountCents: 1000n,
        direction: "increase",
        costImpactId: "impact-cost-1",
        costImpactSnapshot: {},
        payableImpactId: "impact-payable-1",
        payableImpactSnapshot: {}
      }
    };

    await expect((service as never as {
      materializeAEnvelope: (
        client: unknown,
        scopeId: string,
        row: unknown,
        versionId: string,
        decision: "FORMAL",
        actor: string
      ) => Promise<unknown>;
    }).materializeAEnvelope(
      tx,
      "scope-1",
      mapping,
      "wage-version-2",
      "FORMAL",
      "finance-director-1"
    )).resolves.toEqual(expect.objectContaining({
      targetKind: "wage_takeover_projection_envelope",
      decision: "FORMAL"
    }));

    expect(costLinkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ costCellId: "cost-cell-plus", direction: "increase", amountCents: 1200n })
    }));
    expect(costLinkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ costCellId: "cost-cell-minus", direction: "decrease", amountCents: 200n })
    }));
    expect(payableLinkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payableRefId: "payable-minus", direction: "decrease", amountCents: 200n })
    }));
    expect(envelopeCreate).toHaveBeenCalledTimes(1);
    expect(impactBridgeCreate).toHaveBeenCalledTimes(2);
  });

  it("freezes the server-resolved C authority month on the unresolved gap", async () => {
    const { service, tx } = setup();
    const mapping = {
      id: "mapping-1",
      manifestId: "manifest-1",
      projectId: "project-1",
      mappingDecision: "GAP",
      evidenceLevel: "C",
      sourceDiscriminator: null,
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: LEGACY_HASH,
        projectId: "project-1",
        costImpactId: "impact-cost-1",
        payableImpactId: "impact-payable-1",
        amountCents: 1000n,
        factId: "fact-1",
        legacySnapshot: {},
        costImpactSnapshot: {},
        payableImpactSnapshot: {}
      }
    };
    tx.unresolvedWagePayableGap.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, id: "gap-1" })
    );

    await expect((service as never as {
      materializeCGap: (client: unknown, context: unknown, row: unknown, actor: string) => Promise<unknown>;
    }).materializeCGap(tx, {
      scope: { id: "scope-1", readSetFingerprint: HASH },
      plan: {
        grade: "C",
        negativeAuthorityFrontierFingerprint: HASH,
        negativeAuthorityFrontier: {
          authorityScope: {
            employmentCompanyId: "company-1",
            wageMonth: "2026-08",
            legacySourceNamespace: "project_wage"
          }
        }
      }
    }, mapping, "finance-director-1")).resolves.toEqual(expect.objectContaining({
      targetKind: "unresolved_wage_payable_gap",
      targetRef: "gap-1",
      decision: "GAP"
    }));

    expect(tx.unresolvedWagePayableGap.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ wageMonth: "2026-08" })
    });
  });

  it("rejects cross-scope adoption of an existing C gap instead of returning LINK", async () => {
    const { service, tx } = setup();
    const mapping = {
      id: "mapping-1",
      manifestId: "manifest-1",
      projectId: "project-1",
      mappingDecision: "GAP",
      evidenceLevel: "C",
      sourceDiscriminator: null,
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: LEGACY_HASH,
        projectId: "project-1",
        costImpactId: "impact-cost-1",
        payableImpactId: "impact-payable-1",
        amountCents: 1000n,
        factId: "fact-1",
        legacySnapshot: {},
        costImpactSnapshot: {},
        payableImpactSnapshot: {}
      }
    };
    tx.unresolvedWagePayableGap.findUnique.mockResolvedValue({ id: "gap-existing", sourceFingerprint: LEGACY_HASH });

    await expect((service as never as {
      materializeCGap: (client: unknown, context: unknown, row: unknown, actor: string) => Promise<unknown>;
    }).materializeCGap(tx, {
      scope: { id: "scope-1", readSetFingerprint: HASH },
      plan: { grade: "C" }
    }, mapping, "finance-director-1")).rejects.toThrow("禁止跨范围 LINK");

    expect(tx.unresolvedWagePayableGap.create).not.toHaveBeenCalled();
  });

  it("rejects an existing legacy bridge for a new command instead of returning SKIP", async () => {
    const { service, tx } = setup();
    const mapping = {
      id: "mapping-1",
      manifestId: "manifest-1",
      projectId: "project-1",
      mappingDecision: "GAP",
      evidenceLevel: "C",
      sourceDiscriminator: null,
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: LEGACY_HASH,
        projectId: "project-1",
        costImpactId: "impact-cost-1",
        payableImpactId: "impact-payable-1",
        amountCents: 1000n,
        factId: "fact-1",
        legacySnapshot: {},
        costImpactSnapshot: {},
        payableImpactSnapshot: {}
      }
    };
    tx.operatingTakeoverLegacySourceBridge.findFirst.mockResolvedValue({
        sourceFingerprint: LEGACY_HASH,
        targetKind: "unresolved_wage_payable_gap",
        targetRef: "gap-1",
        targetFingerprint: HASH
      });

    await expect((service as never as {
      ensureLegacyBridge: (client: unknown, row: unknown, target: unknown, actor: string) => Promise<unknown>;
    }).ensureLegacyBridge(tx, mapping, {
      targetKind: "unresolved_wage_payable_gap",
      targetRef: "gap-1",
      targetFingerprint: HASH,
      decision: "GAP"
    }, "finance-director-1")).rejects.toThrow("禁止跨范围 SKIP");

    expect(tx.operatingTakeoverLegacySourceBridge.create).not.toHaveBeenCalled();
  });
});
