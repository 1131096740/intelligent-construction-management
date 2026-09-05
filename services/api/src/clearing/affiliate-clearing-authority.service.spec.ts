import { ConflictException } from "@nestjs/common";

import { AffiliateClearingAuthorityService } from "./affiliate-clearing-authority.service";
import { resolveAffiliateDeductionSource } from "./affiliate-clearing-authority.domain";
import { computePol219AssignedWageExclusionSet } from "../operating-takeover/historical-wage-takeover-fingerprint";

const COMMAND_ID = "22222222-2222-4222-8222-222222222222";
const CONTRACT_REF = "fac1.contract-selection-ref";

function hasNestedOwnKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNestedOwnKey(item, key));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) return true;
  return Object.values(record).some((item) => hasNestedOwnKey(item, key));
}

function harness() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    projectAffiliateCompanyContract: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-1",
        projectId: "project-1",
        companyEntityId: "company-1",
        status: "confirmed"
      }),
      findMany: jest.fn().mockResolvedValue([{
        id: "contract-1",
        projectId: "project-1",
        contractReference: "HT-001",
        contractName: "挂靠协议",
        affiliateAssignmentId: "assignment-1",
        affiliateNameSnapshot: "挂靠企业",
        affiliateCreditCodeSnapshot: "9111",
        companyEntityNameSnapshot: "施工企业",
        companyEntityCreditCodeSnapshot: "9222",
        fileContentSha256Snapshot: "a".repeat(64),
        status: "confirmed"
      }])
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "assignment-1",
        projectId: "project-1",
        affiliateNameSnapshot: "挂靠企业",
        affiliateCreditCodeSnapshot: "9111",
        endedAt: null
      })
    },
    fileObject: {
      findFirst: jest.fn().mockResolvedValue({ id: "file-1", contentSha256: "b".repeat(64) }),
      findMany: jest.fn().mockResolvedValue([])
    },
    projectRosterMember: { findMany: jest.fn().mockResolvedValue([{ userId: "user-1" }]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "project_manager" }]) },
    wagePersonLine: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null)
    },
    projectUpstreamFundFact: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: "user-1", name: "张三", isActive: true }]) },
    affiliateClearingAuthorityVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...data }))
    },
    assignedWageAuthorityLine: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ ...data }))
    },
    guaranteeObligationVersion: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ ...data }))
    },
    historicalWageSummaryAuthorityVersion: { findMany: jest.fn().mockResolvedValue([]) },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    projectAffiliateCompanyContract: {
      findMany: jest.fn().mockResolvedValue([{
        id: "contract-1",
        projectId: "project-1",
        contractReference: "HT-001",
        contractName: "挂靠协议",
        affiliateAssignmentId: "assignment-1",
        affiliateNameSnapshot: "挂靠企业",
        affiliateCreditCodeSnapshot: "9111",
        companyEntityNameSnapshot: "施工企业",
        companyEntityCreditCodeSnapshot: "9222",
        fileContentSha256Snapshot: "a".repeat(64),
        status: "confirmed"
      }]),
      findFirst: jest.fn().mockResolvedValue({
        id: "contract-1",
        projectId: "project-1",
        contractReference: "HT-001",
        contractName: "挂靠协议",
        affiliateAssignmentId: "assignment-1",
        affiliateNameSnapshot: "挂靠企业",
        affiliateCreditCodeSnapshot: "9111",
        companyEntityNameSnapshot: "施工企业",
        companyEntityCreditCodeSnapshot: "9222",
        fileContentSha256Snapshot: "a".repeat(64),
        status: "confirmed"
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "assignment-1",
        projectId: "project-1",
        affiliateNameSnapshot: "挂靠企业",
        affiliateCreditCodeSnapshot: "9111",
        endedAt: null
      })
    },
    fileObject: { findFirst: jest.fn().mockResolvedValue({ id: "file-1", contentSha256: "b".repeat(64) }) },
    projectRosterMember: { findMany: jest.fn().mockResolvedValue([{ userId: "user-1" }]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "project_manager" }]) },
    projectUpstreamFundFact: { findMany: jest.fn().mockResolvedValue([]) },
    affiliateClearingAuthorityVersion: { findMany: jest.fn().mockResolvedValue([]) },
    assignedWageAuthorityLine: { findMany: jest.fn().mockResolvedValue([]) },
    guaranteeObligationVersion: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: "user-1", name: "张三", isActive: true }]) },
    roles: undefined
  };
  const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff", "finance_director"]) };
  const selection = {
    issue: jest.fn().mockReturnValue("fac1.abc.signature"),
    matches: jest.fn().mockReturnValue(true)
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  return {
    service: new AffiliateClearingAuthorityService(
      prisma as never,
      roles as never,
      selection as never,
      audit as never
    ),
    prisma,
    tx,
    roles,
    selection,
    audit
  };
}

describe("#214 AffiliateClearingAuthorityService", () => {
  async function preparePersonAuthorityAgainstCanonicalStatus(
    canonicalState:
      | { status: "draft" | "submitted" | "confirmed"; reviewDisposition: null }
      | { status: "superseded"; reviewDisposition: "review_returned" }
  ) {
    const { service, tx, audit } = harness();
    type AuthorityRow = {
      id: string;
      projectId: string;
      affiliateCompanyContractId: string;
      status: string;
      createdByUserId: string;
      submittedByUserId?: string;
      [key: string]: unknown;
    };
    type AuthorityLine = {
      authorityVersionId: string;
      projectId: string;
      affiliateCompanyContractId: string;
      [key: string]: unknown;
    };
    let authority: AuthorityRow | null = null;
    const authorityLines: AuthorityLine[] = [];
    tx.affiliateClearingAuthorityVersion.findUnique.mockImplementation(async ({ where }: {
      where: { id?: string; idempotencyKey?: string };
    }) => {
      if (!authority) return null;
      if (where.id) return authority.id === where.id ? authority : null;
      if (where.idempotencyKey) return authority.idempotencyKey === where.idempotencyKey ? authority : null;
      return null;
    });
    tx.affiliateClearingAuthorityVersion.create.mockImplementation(async ({ data }: { data: AuthorityRow }) => {
      authority = { ...data };
      return authority;
    });
    tx.affiliateClearingAuthorityVersion.update.mockImplementation(async ({ data }: {
      data: Partial<AuthorityRow>;
    }) => {
      if (!authority) throw new Error("authority fixture was not created");
      authority = { ...authority, ...data };
      return authority;
    });
    tx.assignedWageAuthorityLine.create.mockImplementation(async ({ data }: { data: AuthorityLine }) => {
      const stored = { id: `line-${authorityLines.length + 1}`, ...data };
      authorityLines.push(stored);
      return stored;
    });
    tx.assignedWageAuthorityLine.findMany.mockImplementation(async ({ where }: {
      where: { authorityVersionId: string };
    }) => authorityLines.filter((line) => line.authorityVersionId === where.authorityVersionId));
    const canonicalLine = {
      id: `canonical-${canonicalState.status}-person-line-1`,
      employeeId: "user-1",
      projectAllocations: [{ projectId: "project-1" }],
      statementVersion: {
        status: canonicalState.status,
        reviewDisposition: canonicalState.reviewDisposition,
        projectionOrigin: "ordinary",
        takeoverProjectionEnvelopes: [],
        sourceVersion: { wageMonth: "2026-08" }
      }
    };
    tx.wagePersonLine.findFirst.mockImplementation(async ({ where }: {
      where: {
        employeeId?: string;
        projectAllocations?: { some?: { projectId?: string } };
        statementVersion?: {
          status?: string;
          reviewDisposition?: string | null;
          sourceVersion?: { wageMonth?: string };
          OR?: Array<{
            projectionOrigin?: string;
            takeoverProjectionEnvelopes?: { some?: { projectId?: string } };
          }>;
        };
      };
    }) => {
      const projectId = where.projectAllocations?.some?.projectId;
      const wageMonth = where.statementVersion?.sourceVersion?.wageMonth;
      const requestedStatus = where.statementVersion?.status;
      const requestedReviewDisposition = where.statementVersion?.reviewDisposition;
      const requestedProjectionBranches = where.statementVersion?.OR;
      const matches =
        where.employeeId === canonicalLine.employeeId &&
        canonicalLine.projectAllocations.some((allocation) => allocation.projectId === projectId) &&
        canonicalLine.statementVersion.sourceVersion.wageMonth === wageMonth &&
        (requestedStatus === undefined || canonicalLine.statementVersion.status === requestedStatus) &&
        (requestedReviewDisposition === undefined ||
          canonicalLine.statementVersion.reviewDisposition === requestedReviewDisposition) &&
        (!requestedProjectionBranches || requestedProjectionBranches.some((branch) =>
          branch.projectionOrigin === canonicalLine.statementVersion.projectionOrigin &&
          branch.takeoverProjectionEnvelopes?.some === undefined
        ));
      return matches ? { id: canonicalLine.id } : null;
    });
    Object.assign(tx.historicalWageSummaryAuthorityVersion, {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    });

    await service.createAuthority("maker-1", {
      idempotencyKey: "51515151-5151-4151-8151-515151515151",
      expectedRevision: 0,
      contractSelectionRef: CONTRACT_REF,
      effectiveFrom: "2026-08-01",
      evidenceRef: "file-selection-ref",
      wageLines: [{
        selectionRef: "person-selection-ref",
        wageMonth: "2026-08",
        amountCents: "12345",
        amountMode: "CONFIRMED_AMOUNT",
        amountRuleVersion: 1,
        midMonthPolicy: "NOT_APPLICABLE",
        evidenceCoordinate: "工资表第 3 行"
      }],
      guaranteeObligations: []
    });
    if (!authority) throw new Error("authority fixture was not persisted");
    const authorityId = (authority as AuthorityRow).id;
    await service.submitAuthority("submitter-1", authorityId, {
      idempotencyKey: "52525252-5252-4252-8252-525252525252",
      expectedRevision: 1
    });
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const delegate of Object.values(tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) method.mockClear();
      }
    }
    audit.record.mockClear();
    return {
      service,
      tx,
      audit,
      authorityId,
      canonicalLine,
      mutationMethods,
      confirm: () => service.confirmAuthority("confirmer-1", authorityId, {
        idempotencyKey: "53535353-5353-4353-8353-535353535353",
        expectedRevision: 2
      })
    };
  }

  async function preparePersonAuthorityAgainstHistoricalSummary(
    buildExclusion: (line: {
      authorityVersionId: string;
      lineId: string;
      lineFingerprint: string;
    }) => ReturnType<typeof computePol219AssignedWageExclusionSet>,
    control: {
      lifecycle: "attested" | "active" | "compensated";
      projectId: string;
      wageMonth: string;
    } = { lifecycle: "active", projectId: "project-1", wageMonth: "2026-08" }
  ) {
    const { service, tx, audit } = harness();
    type AuthorityRow = {
      id: string;
      projectId: string;
      affiliateCompanyContractId: string;
      status: string;
      createdByUserId: string;
      submittedByUserId?: string;
      [key: string]: unknown;
    };
    type AuthorityLine = {
      id: string;
      authorityVersionId: string;
      projectId: string;
      affiliateCompanyContractId: string;
      lineFingerprint: string;
      [key: string]: unknown;
    };
    let authority: AuthorityRow | null = null;
    const authorityLines: AuthorityLine[] = [];
    tx.affiliateClearingAuthorityVersion.findUnique.mockImplementation(async ({ where }: {
      where: { id?: string; idempotencyKey?: string };
    }) => {
      if (!authority) return null;
      if (where.id) return authority.id === where.id ? authority : null;
      if (where.idempotencyKey) return authority.idempotencyKey === where.idempotencyKey ? authority : null;
      return null;
    });
    tx.affiliateClearingAuthorityVersion.create.mockImplementation(async ({ data }: { data: AuthorityRow }) => {
      authority = { ...data };
      return authority;
    });
    tx.affiliateClearingAuthorityVersion.update.mockImplementation(async ({ data }: {
      data: Partial<AuthorityRow>;
    }) => {
      if (!authority) throw new Error("authority fixture was not created");
      authority = { ...authority, ...data };
      return authority;
    });
    tx.assignedWageAuthorityLine.create.mockImplementation(async ({ data }: {
      data: Omit<AuthorityLine, "id">;
    }) => {
      const stored = { id: `line-${authorityLines.length + 1}`, ...data } as AuthorityLine;
      authorityLines.push(stored);
      return stored;
    });
    tx.assignedWageAuthorityLine.findMany.mockImplementation(async ({ where }: {
      where: { authorityVersionId: string };
    }) => authorityLines.filter((line) => line.authorityVersionId === where.authorityVersionId));

    await service.createAuthority("maker-1", {
      idempotencyKey: "61616161-6161-4161-8161-616161616161",
      expectedRevision: 0,
      contractSelectionRef: CONTRACT_REF,
      effectiveFrom: "2026-08-01",
      evidenceRef: "file-selection-ref",
      wageLines: [{
        selectionRef: "person-selection-ref",
        wageMonth: "2026-08",
        amountCents: "12345",
        amountMode: "CONFIRMED_AMOUNT",
        amountRuleVersion: 1,
        midMonthPolicy: "NOT_APPLICABLE",
        evidenceCoordinate: "工资表第 3 行"
      }],
      guaranteeObligations: []
    });
    if (!authority) throw new Error("authority fixture was not persisted");
    const authorityId = (authority as AuthorityRow).id;
    const authoritySnapshotRef = (authority as AuthorityRow).authoritySnapshotRef;
    if (typeof authoritySnapshotRef !== "string") throw new Error("authority snapshot fixture was not persisted");
    const incomingLine = authorityLines[0];
    if (!incomingLine) throw new Error("PERSON authority line fixture was not persisted");
    const exclusion = buildExclusion({
      authorityVersionId: authorityId,
      lineId: incomingLine.id,
      lineFingerprint: incomingLine.lineFingerprint
    });
    await service.submitAuthority("submitter-1", authorityId, {
      idempotencyKey: "62626262-6262-4262-8262-626262626262",
      expectedRevision: 1
    });

    const summaryAuthorities = [{
      id: "summary-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      summaryBucketKey: `company-1:${control.projectId}:${control.wageMonth}:project_leadership`,
      employmentCompanyId: "company-1",
      projectId: control.projectId,
      wageMonth: control.wageMonth,
      assignedWageExclusionSchemaVersion: 1,
      assignedWageExclusionPayload: exclusion.payload,
      assignedWageExclusionSetFingerprint: exclusion.fingerprint
    }];
    const scopes = [{ id: "scope-person-b-1", scopeKind: "historical_wage" }];
    const manifests = [{
      id: "manifest-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      projectId: control.projectId,
      adapterKind: "historical_wage"
    }];
    const scopeProjects = [{
      id: "scope-project-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      manifestVersionId: "manifest-person-b-1",
      projectId: control.projectId
    }];
    const mappings = [{
      id: "mapping-person-b-1",
      manifestVersionId: "manifest-person-b-1",
      projectId: control.projectId,
      adapterKind: "historical_wage",
      evidenceLevel: "B",
      mappingDecision: "FORMAL",
      sourceDiscriminator: "historical_wage_summary",
      historicalWageSummaryAuthorityVersionId: "summary-person-b-1"
    }];
    type ScopeReceipt = {
      id: string;
      atomicScopeVersionId: string;
      manifestVersionId: null;
      action: string;
      status: string;
      actorUserId: string;
      delegatorUserId: null;
      causesReceiptId?: string;
    };
    const receipts: ScopeReceipt[] = [{
      id: "receipt-create-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.create",
      status: "prepared",
      actorUserId: "finance-maker-b-1",
      delegatorUserId: null
    }, {
      id: "receipt-attest-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.attest",
      status: "attested",
      actorUserId: "finance-attester-b-1",
      delegatorUserId: null
    }];
    if (control.lifecycle === "active" || control.lifecycle === "compensated") {
      receipts.push({
        id: "receipt-activate-person-b-1",
        atomicScopeVersionId: "scope-person-b-1",
        manifestVersionId: null,
        action: "historical_wage_takeover.scope.activate",
        status: "activated",
        actorUserId: "finance-activator-b-1",
        delegatorUserId: null
      });
    }
    if (control.lifecycle === "compensated") {
      receipts.push({
        id: "receipt-compensate-person-b-1",
        atomicScopeVersionId: "scope-person-b-1",
        manifestVersionId: null,
        action: "historical_wage_takeover.scope.compensate",
        status: "compensated",
        actorUserId: "finance-compensator-b-1",
        delegatorUserId: null,
        causesReceiptId: "receipt-activate-person-b-1"
      });
    }
    const attestations = [{
      id: "attestation-create-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      authorityVersionId: "summary-person-b-1",
      summaryBucketKey: summaryAuthorities[0]!.summaryBucketKey,
      receiptId: "receipt-create-person-b-1",
      actorUserId: "finance-maker-b-1",
      delegatorUserId: null,
      attestationOrdinal: 1
    }, {
      id: "attestation-review-person-b-1",
      atomicScopeVersionId: "scope-person-b-1",
      authorityVersionId: "summary-person-b-1",
      summaryBucketKey: summaryAuthorities[0]!.summaryBucketKey,
      receiptId: "receipt-attest-person-b-1",
      actorUserId: "finance-attester-b-1",
      delegatorUserId: null,
      attestationOrdinal: 2
    }];
    type ScopeReceiptLine = {
      id: string;
      receiptId: string;
      rowMappingId: string;
      projectId: string;
      entryKind: "historical_wage";
      decision: "FORMAL" | "compensated";
      targetKind: "historical_wage_summary_authority_version" | null;
      targetRef: string | null;
      amountCents: bigint;
      causalOrdinal: number;
      causesLineId: string | null;
    };
    const receiptLines: ScopeReceiptLine[] = [];
    if (control.lifecycle === "active" || control.lifecycle === "compensated") {
      receiptLines.push({
        id: "receipt-line-activate-person-b-1",
        receiptId: "receipt-activate-person-b-1",
        rowMappingId: "mapping-person-b-1",
        projectId: control.projectId,
        entryKind: "historical_wage",
        decision: "FORMAL",
        targetKind: "historical_wage_summary_authority_version",
        targetRef: "summary-person-b-1",
        amountCents: 12345n,
        causalOrdinal: 1,
        causesLineId: null
      });
    }
    if (control.lifecycle === "compensated") {
      receiptLines.push({
        id: "receipt-line-compensate-person-b-1",
        receiptId: "receipt-compensate-person-b-1",
        rowMappingId: "mapping-person-b-1",
        projectId: control.projectId,
        entryKind: "historical_wage",
        decision: "compensated",
        targetKind: null,
        targetRef: null,
        amountCents: 12345n,
        causalOrdinal: 1,
        causesLineId: "receipt-line-activate-person-b-1"
      });
      const activationLines = receiptLines.filter((line) => line.receiptId === "receipt-activate-person-b-1");
      const compensationLines = receiptLines.filter((line) => line.receiptId === "receipt-compensate-person-b-1");
      if (
        activationLines.length === 0 ||
        compensationLines.length !== activationLines.length ||
        activationLines.some((line) => !compensationLines.some((candidate) =>
          candidate.rowMappingId === line.rowMappingId &&
          candidate.projectId === line.projectId &&
          candidate.entryKind === "historical_wage" &&
          candidate.decision === "compensated" &&
          candidate.targetKind === null &&
          candidate.targetRef === null &&
          candidate.amountCents === line.amountCents &&
          candidate.causalOrdinal === line.causalOrdinal &&
          candidate.causesLineId === line.id
        ))
      ) {
        throw new Error("compensated B fixture must reverse the complete activation batch");
      }
    }
    tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(async (query: {
      where?: {
        employmentCompanyId?: string;
        OR?: Array<{ projectId?: string; wageMonth?: string }>;
        atomicScope?: {
          is?: {
            scopeKind?: string;
            receipts?: {
              some?: { action?: string; status?: string };
              none?: { action?: string; status?: string };
            };
          };
        };
      };
    }) => {
      const receiptQuery = query.where?.atomicScope?.is?.receipts;
      if (
        query.where?.employmentCompanyId !== "company-1" ||
        !Array.isArray(query.where.OR) ||
        !query.where.OR.some((bucket) => bucket.projectId === "project-1" && bucket.wageMonth === "2026-08") ||
        query.where.atomicScope?.is?.scopeKind !== "historical_wage" ||
        receiptQuery?.some?.action !== "historical_wage_takeover.scope.activate" ||
        receiptQuery.some.status !== "activated" ||
        receiptQuery?.none?.action !== "historical_wage_takeover.scope.compensate" ||
        receiptQuery.none.status !== "compensated"
      ) {
        return [];
      }
      return summaryAuthorities.filter((summary) => {
        const scope = scopes.find((item) => item.id === summary.atomicScopeVersionId);
        const manifest = manifests.find((item) =>
          item.atomicScopeVersionId === scope?.id && item.projectId === summary.projectId
        );
        const scopeProject = scopeProjects.find((item) =>
          item.atomicScopeVersionId === scope?.id &&
          item.manifestVersionId === manifest?.id &&
          item.projectId === summary.projectId
        );
        const mapping = mappings.find((item) =>
          item.manifestVersionId === manifest?.id &&
          item.projectId === summary.projectId &&
          item.adapterKind === "historical_wage" &&
          item.evidenceLevel === "B" &&
          item.mappingDecision === "FORMAL" &&
          item.sourceDiscriminator === "historical_wage_summary" &&
          item.historicalWageSummaryAuthorityVersionId === summary.id
        );
        const summaryAttestations = attestations.filter((item) =>
          item.atomicScopeVersionId === scope?.id &&
          item.authorityVersionId === summary.id &&
          item.summaryBucketKey === summary.summaryBucketKey
        );
        const attestationReceipts = summaryAttestations.map((attestation) => receipts.find((receipt) =>
          receipt.id === attestation.receiptId &&
          receipt.atomicScopeVersionId === scope?.id &&
          receipt.manifestVersionId === null &&
          receipt.actorUserId === attestation.actorUserId &&
          receipt.delegatorUserId === attestation.delegatorUserId
        ));
        const scopeReceipts = receipts.filter((receipt) => receipt.atomicScopeVersionId === scope?.id);
        const activationReceipt = scopeReceipts.find((receipt) =>
          receipt.manifestVersionId === null &&
          receipt.action === receiptQuery.some?.action &&
          receipt.status === receiptQuery.some.status
        );
        const activationLine = receiptLines.find((line) =>
          line.receiptId === activationReceipt?.id &&
          line.rowMappingId === mapping?.id &&
          line.projectId === summary.projectId &&
          line.entryKind === "historical_wage" &&
          line.decision === "FORMAL" &&
          line.amountCents === 12345n &&
          line.causalOrdinal === 1 &&
          line.causesLineId === null &&
          `${line.targetKind}:${line.targetRef}` ===
            `historical_wage_summary_authority_version:${summary.id}`
        );
        const compensationReceipt = scopeReceipts.find((receipt) =>
          receipt.manifestVersionId === null &&
          receipt.action === receiptQuery.none?.action &&
          receipt.status === receiptQuery.none.status
        );
        const activationLines = receiptLines.filter((line) => line.receiptId === activationReceipt?.id);
        const compensationLines = receiptLines.filter((line) => line.receiptId === compensationReceipt?.id);
        const isCompletelyCompensated = Boolean(
          compensationReceipt &&
          compensationReceipt.causesReceiptId === activationReceipt?.id &&
          activationLines.length === mappings.length &&
          compensationLines.length === activationLines.length &&
          activationLines.every((line, index) =>
            line.causalOrdinal === index + 1 &&
            Number.isInteger(line.causalOrdinal) &&
            line.causalOrdinal > 0 &&
            compensationLines.some((candidate) =>
              candidate.rowMappingId === line.rowMappingId &&
              candidate.projectId === line.projectId &&
              candidate.entryKind === "historical_wage" &&
              candidate.decision === "compensated" &&
              candidate.targetKind === null &&
              candidate.targetRef === null &&
              candidate.amountCents === line.amountCents &&
              candidate.causalOrdinal === line.causalOrdinal &&
              candidate.causesLineId === line.id
            )
          )
        );
        if (compensationReceipt && !isCompletelyCompensated) return false;
        const attestationOrdinals = summaryAttestations
          .map((item) => item.attestationOrdinal)
          .sort((left, right) => left - right);
        const effectiveIdentitySets = summaryAttestations.map((item) => new Set(
          [item.actorUserId, item.delegatorUserId].filter((identity): identity is string => Boolean(identity))
        ));
        const distinctEffectiveIdentities =
          effectiveIdentitySets.length === 2 &&
          effectiveIdentitySets.every((identities) => identities.size > 0) &&
          [...effectiveIdentitySets[0]!].every((identity) => !effectiveIdentitySets[1]!.has(identity));
        return summary.employmentCompanyId === query.where?.employmentCompanyId &&
          query.where.OR!.some((bucket) =>
            bucket.projectId === summary.projectId && bucket.wageMonth === summary.wageMonth
          ) &&
          scope?.scopeKind === query.where.atomicScope?.is?.scopeKind &&
          Boolean(manifest && scopeProject && mapping && activationReceipt && activationLine) &&
          summaryAttestations.length === 2 &&
          attestationOrdinals[0] === 1 &&
          attestationOrdinals[1] === 2 &&
          new Set(summaryAttestations.map((item) => item.receiptId)).size === 2 &&
          distinctEffectiveIdentities &&
          attestationReceipts.every(Boolean) &&
          attestationReceipts.some((receipt) =>
            receipt?.action === "historical_wage_takeover.scope.create" && receipt.status === "prepared"
          ) &&
          attestationReceipts.some((receipt) =>
            receipt?.action === "historical_wage_takeover.scope.attest" && receipt.status === "attested"
          ) &&
          !compensationReceipt;
      });
    });
    Object.assign(tx.historicalWageSummaryAuthorityVersion, {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    });
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const delegate of Object.values(tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) method.mockClear();
      }
    }
    audit.record.mockClear();
    return {
      service,
      tx,
      audit,
      authorityId,
      authoritySnapshotRef,
      incomingLine,
      exclusion,
      mutationMethods,
      confirm: () => service.confirmAuthority("confirmer-1", authorityId, {
        idempotencyKey: "63636363-6363-4363-8363-636363636363",
        expectedRevision: 2
      })
    };
  }

  async function preparePersonAuthorityAgainstHistoricalA(control: {
    lifecycle: "inactive_applied" | "active" | "compensated";
    projectId: string;
    wageMonth: string;
    employeeId: string;
    employmentCompanyId: string;
  }) {
    const { service, tx, audit } = harness();
    type AuthorityRow = {
      id: string;
      projectId: string;
      affiliateCompanyContractId: string;
      status: string;
      createdByUserId: string;
      submittedByUserId?: string;
      [key: string]: unknown;
    };
    type AuthorityLine = {
      id: string;
      authorityVersionId: string;
      projectId: string;
      affiliateCompanyContractId: string;
      lineFingerprint: string;
      [key: string]: unknown;
    };
    let authority: AuthorityRow | null = null;
    const authorityLines: AuthorityLine[] = [];
    tx.affiliateClearingAuthorityVersion.findUnique.mockImplementation(async ({ where }: {
      where: { id?: string; idempotencyKey?: string };
    }) => {
      if (!authority) return null;
      if (where.id) return authority.id === where.id ? authority : null;
      if (where.idempotencyKey) return authority.idempotencyKey === where.idempotencyKey ? authority : null;
      return null;
    });
    tx.affiliateClearingAuthorityVersion.create.mockImplementation(async ({ data }: { data: AuthorityRow }) => {
      authority = { ...data };
      return authority;
    });
    tx.affiliateClearingAuthorityVersion.update.mockImplementation(async ({ data }: {
      data: Partial<AuthorityRow>;
    }) => {
      if (!authority) throw new Error("authority fixture was not created");
      authority = { ...authority, ...data };
      return authority;
    });
    tx.assignedWageAuthorityLine.create.mockImplementation(async ({ data }: {
      data: Omit<AuthorityLine, "id">;
    }) => {
      const stored = { id: `line-${authorityLines.length + 1}`, ...data } as AuthorityLine;
      authorityLines.push(stored);
      return stored;
    });
    tx.assignedWageAuthorityLine.findMany.mockImplementation(async ({ where }: {
      where: { authorityVersionId: string };
    }) => authorityLines.filter((line) => line.authorityVersionId === where.authorityVersionId));

    await service.createAuthority("maker-1", {
      idempotencyKey: "71717171-7171-4171-8171-717171717171",
      expectedRevision: 0,
      contractSelectionRef: CONTRACT_REF,
      effectiveFrom: "2026-08-01",
      evidenceRef: "file-selection-ref",
      wageLines: [{
        selectionRef: "person-selection-ref",
        wageMonth: "2026-08",
        amountCents: "12345",
        amountMode: "CONFIRMED_AMOUNT",
        amountRuleVersion: 1,
        midMonthPolicy: "NOT_APPLICABLE",
        evidenceCoordinate: "工资表第 3 行"
      }],
      guaranteeObligations: []
    });
    if (!authority) throw new Error("authority fixture was not persisted");
    const authorityId = (authority as AuthorityRow).id;
    const authoritySnapshotRef = (authority as AuthorityRow).authoritySnapshotRef;
    if (typeof authoritySnapshotRef !== "string") throw new Error("authority snapshot fixture was not persisted");
    await service.submitAuthority("submitter-1", authorityId, {
      idempotencyKey: "72727272-7272-4272-8272-727272727272",
      expectedRevision: 1
    });

    const scope = {
      id: "scope-person-a-1",
      scopeKind: "historical_wage",
      authoritySourceRef: "approved-source-a-1",
      reservedWageStatementVersionId: "wage-version-a-1"
    };
    const manifest = {
      id: "manifest-person-a-1",
      atomicScopeVersionId: scope.id,
      projectId: control.projectId,
      adapterKind: "historical_wage"
    };
    const scopeProject = {
      id: "scope-project-person-a-1",
      atomicScopeVersionId: scope.id,
      manifestVersionId: manifest.id,
      projectId: control.projectId
    };
    const reservation = {
      id: "wage-version-a-1",
      atomicScopeVersionId: scope.id,
      targetWageStatementId: "wage-statement-a-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base"
    };
    const mapping = {
      id: "mapping-person-a-1",
      manifestVersionId: manifest.id,
      projectId: control.projectId,
      adapterKind: "historical_wage",
      sourceType: "project_wage",
      entryKind: "formal",
      evidenceLevel: "A",
      mappingDecision: "FORMAL",
      sourceDiscriminator: "wage_statement_version",
      wageApprovedSourceVersionId: "approved-source-a-1",
      wageStatementReservationId: reservation.id,
      amountCents: 12345n
    };
    const approvedSource = {
      id: "approved-source-a-1",
      employmentCompanyId: control.employmentCompanyId,
      wageMonth: control.wageMonth
    };
    type ScopeReceipt = {
      id: string;
      atomicScopeVersionId: string;
      manifestVersionId: null;
      action: string;
      status: string;
      actorUserId: string;
      delegatorUserId: null;
      causesReceiptId?: string;
    };
    const receipts: ScopeReceipt[] = [{
      id: "receipt-create-person-a-1",
      atomicScopeVersionId: scope.id,
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.create",
      status: "prepared",
      actorUserId: "finance-maker-a-1",
      delegatorUserId: null
    }, {
      id: "receipt-apply-person-a-1",
      atomicScopeVersionId: scope.id,
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.apply",
      status: "inactive_applied",
      actorUserId: "finance-maker-a-1",
      delegatorUserId: null
    }];
    if (control.lifecycle === "active" || control.lifecycle === "compensated") {
      receipts.push({
        id: "receipt-activate-person-a-1",
        atomicScopeVersionId: scope.id,
        manifestVersionId: null,
        action: "historical_wage_takeover.scope.activate",
        status: "activated",
        actorUserId: "finance-activator-a-1",
        delegatorUserId: null
      });
    }
    if (control.lifecycle === "compensated") {
      receipts.push({
        id: "receipt-compensate-person-a-1",
        atomicScopeVersionId: scope.id,
        manifestVersionId: null,
        action: "historical_wage_takeover.scope.compensate",
        status: "compensated",
        actorUserId: "finance-compensator-a-1",
        delegatorUserId: null,
        causesReceiptId: "receipt-activate-person-a-1"
      });
    }
    type ScopeReceiptLine = {
      id: string;
      receiptId: string;
      rowMappingId: string;
      projectId: string;
      entryKind: "historical_wage";
      decision: "FORMAL" | "compensated";
      targetKind: "wage_takeover_projection_envelope" | null;
      targetRef: string | null;
      amountCents: bigint;
      causalOrdinal: number;
      causesLineId: string | null;
    };
    const receiptLines: ScopeReceiptLine[] = [];
    if (control.lifecycle === "active" || control.lifecycle === "compensated") {
      receiptLines.push({
        id: "receipt-line-activate-person-a-1",
        receiptId: "receipt-activate-person-a-1",
        rowMappingId: mapping.id,
        projectId: control.projectId,
        entryKind: "historical_wage",
        decision: "FORMAL",
        targetKind: "wage_takeover_projection_envelope",
        targetRef: "envelope-person-a-1",
        amountCents: mapping.amountCents,
        causalOrdinal: 1,
        causesLineId: null
      });
    }
    if (control.lifecycle === "compensated") {
      receiptLines.push({
        id: "receipt-line-compensate-person-a-1",
        receiptId: "receipt-compensate-person-a-1",
        rowMappingId: mapping.id,
        projectId: control.projectId,
        entryKind: "historical_wage",
        decision: "compensated",
        targetKind: null,
        targetRef: null,
        amountCents: mapping.amountCents,
        causalOrdinal: 1,
        causesLineId: "receipt-line-activate-person-a-1"
      });
    }
    const wageStatementVersions = control.lifecycle === "inactive_applied" ? [] : [{
      id: reservation.id,
      statementId: reservation.targetWageStatementId,
      revision: reservation.reservedRevision,
      status: "confirmed",
      projectionOrigin: "historical_takeover_legacy_link",
      sourceVersionId: approvedSource.id
    }];
    const personLines = control.lifecycle === "inactive_applied" ? [] : [{
      id: "wage-person-line-a-1",
      statementVersionId: reservation.id,
      employeeId: control.employeeId,
      projectAllocations: [{ projectId: control.projectId }]
    }];
    const envelopes = control.lifecycle === "inactive_applied" ? [] : [{
      id: "envelope-person-a-1",
      atomicScopeVersionId: scope.id,
      manifestVersionId: manifest.id,
      rowMappingId: mapping.id,
      wageStatementVersionId: reservation.id,
      projectId: control.projectId,
      legacySourceType: "project_wage",
      projectionOrigin: "historical_takeover_legacy_link"
    }];
    const eligibilityRevocations = control.lifecycle === "compensated" ? [{
      id: "eligibility-revocation-person-a-1",
      envelopeId: "envelope-person-a-1",
      compensationReceiptId: "receipt-compensate-person-a-1"
    }] : [];

    const hasLegalBaseGraph =
      scope.scopeKind === "historical_wage" &&
      scope.authoritySourceRef === approvedSource.id &&
      scope.reservedWageStatementVersionId === reservation.id &&
      manifest.atomicScopeVersionId === scope.id &&
      manifest.projectId === control.projectId &&
      manifest.adapterKind === "historical_wage" &&
      scopeProject.atomicScopeVersionId === scope.id &&
      scopeProject.manifestVersionId === manifest.id &&
      scopeProject.projectId === control.projectId &&
      mapping.manifestVersionId === manifest.id &&
      mapping.projectId === control.projectId &&
      mapping.adapterKind === "historical_wage" &&
      mapping.sourceType === "project_wage" &&
      mapping.entryKind === "formal" &&
      mapping.evidenceLevel === "A" &&
      mapping.mappingDecision === "FORMAL" &&
      mapping.sourceDiscriminator === "wage_statement_version" &&
      mapping.wageApprovedSourceVersionId === approvedSource.id &&
      mapping.wageStatementReservationId === reservation.id &&
      reservation.atomicScopeVersionId === scope.id;
    if (!hasLegalBaseGraph) throw new Error("historical A fixture base graph is invalid");
    const activationReceipt = receipts.find((receipt) =>
      receipt.action === "historical_wage_takeover.scope.activate" && receipt.status === "activated"
    );
    const activationLine = receiptLines.find((line) => line.receiptId === activationReceipt?.id);
    const materializedVersion = wageStatementVersions[0];
    const envelope = envelopes[0];
    const hasLegalActivationGraph = Boolean(
      activationReceipt &&
      activationReceipt.manifestVersionId === null &&
      materializedVersion?.id === reservation.id &&
      materializedVersion.statementId === reservation.targetWageStatementId &&
      materializedVersion.status === "confirmed" &&
      materializedVersion.projectionOrigin === "historical_takeover_legacy_link" &&
      materializedVersion.sourceVersionId === approvedSource.id &&
      envelope?.atomicScopeVersionId === scope.id &&
      envelope.manifestVersionId === manifest.id &&
      envelope.rowMappingId === mapping.id &&
      envelope.wageStatementVersionId === materializedVersion.id &&
      envelope.projectId === control.projectId &&
      envelope.legacySourceType === "project_wage" &&
      envelope.projectionOrigin === "historical_takeover_legacy_link" &&
      activationLine?.rowMappingId === mapping.id &&
      activationLine.projectId === control.projectId &&
      activationLine.entryKind === "historical_wage" &&
      activationLine.decision === "FORMAL" &&
      activationLine.targetKind === "wage_takeover_projection_envelope" &&
      activationLine.targetRef === envelope.id &&
      activationLine.amountCents === mapping.amountCents &&
      activationLine.causalOrdinal === 1 &&
      activationLine.causesLineId === null
    );
    if (control.lifecycle === "inactive_applied") {
      if (activationReceipt || activationLine || materializedVersion || envelope || personLines.length) {
        throw new Error("inactive historical A fixture must not materialize a canonical wage target");
      }
    } else if (!hasLegalActivationGraph) {
      throw new Error("historical A fixture activation graph is invalid");
    }
    if (control.lifecycle === "compensated") {
      const compensationReceipt = receipts.find((receipt) =>
        receipt.action === "historical_wage_takeover.scope.compensate" && receipt.status === "compensated"
      );
      const compensationLines = receiptLines.filter((line) => line.receiptId === compensationReceipt?.id);
      if (
        !compensationReceipt ||
        compensationReceipt.causesReceiptId !== activationReceipt?.id ||
        compensationLines.length !== 1 ||
        compensationLines[0]?.rowMappingId !== activationLine?.rowMappingId ||
        compensationLines[0]?.projectId !== activationLine.projectId ||
        compensationLines[0]?.entryKind !== "historical_wage" ||
        compensationLines[0]?.decision !== "compensated" ||
        compensationLines[0]?.targetKind !== null ||
        compensationLines[0]?.targetRef !== null ||
        compensationLines[0]?.amountCents !== activationLine.amountCents ||
        compensationLines[0]?.causalOrdinal !== activationLine.causalOrdinal ||
        compensationLines[0]?.causesLineId !== activationLine.id ||
        eligibilityRevocations.length !== 1 ||
        eligibilityRevocations[0]?.envelopeId !== envelope?.id ||
        eligibilityRevocations[0]?.compensationReceiptId !== compensationReceipt.id
      ) {
        throw new Error("compensated historical A fixture must revoke the complete activation batch eligibility");
      }
    }

    type HistoricalEnvelopeWhere = {
      projectId?: string;
      eligibilityRevocations?: { none?: Record<string, never> };
    };
    type StatementBranch = {
      projectionOrigin?: string;
      takeoverProjectionEnvelopes?: { some?: HistoricalEnvelopeWhere };
    };
    tx.wagePersonLine.findFirst.mockImplementation(async ({ where }: {
      where: {
        employeeId?: string;
        projectAllocations?: { some?: { projectId?: string } };
        statementVersion?: {
          status?: string;
          sourceVersion?: { wageMonth?: string };
          OR?: StatementBranch[];
        };
      };
    }) => {
      if (hasNestedOwnKey(where, "employmentCompanyId")) return null;
      const requestedProjectId = where.projectAllocations?.some?.projectId;
      const statementWhere = where.statementVersion;
      const matching = personLines.find((personLine) => {
        const version = wageStatementVersions.find((item) => item.id === personLine.statementVersionId);
        const source = version ? [approvedSource].find((item) => item.id === version.sourceVersionId) : undefined;
        if (
          !version ||
          !source ||
          personLine.employeeId !== where.employeeId ||
          !personLine.projectAllocations.some((allocation) => allocation.projectId === requestedProjectId) ||
          version.status !== statementWhere?.status ||
          source.wageMonth !== statementWhere.sourceVersion?.wageMonth
        ) {
          return false;
        }
        if (!statementWhere.OR) return true;
        return statementWhere.OR.some((branch) => {
          if (version.projectionOrigin !== branch.projectionOrigin) return false;
          const envelopeWhere = branch.takeoverProjectionEnvelopes?.some;
          if (!envelopeWhere) return true;
          return envelopes.some((candidate) => {
            const candidateRevocations = eligibilityRevocations.filter((item) => item.envelopeId === candidate.id);
            return hasLegalActivationGraph &&
              candidate.wageStatementVersionId === version.id &&
              (envelopeWhere.projectId === undefined || candidate.projectId === envelopeWhere.projectId) &&
              (envelopeWhere.eligibilityRevocations?.none === undefined || candidateRevocations.length === 0);
          });
        });
      });
      return matching ? { id: matching.id } : null;
    });
    const makeMutationDelegate = () => ({
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    });
    Object.assign(tx, {
      operatingTakeoverAtomicScopeVersion: makeMutationDelegate(),
      operatingTakeoverCommandReceipt: makeMutationDelegate(),
      operatingTakeoverCommandReceiptLine: makeMutationDelegate(),
      wageTakeoverProjectionEnvelope: makeMutationDelegate(),
      wageTakeoverProjectionEnvelopeEligibilityRevocation: makeMutationDelegate()
    });
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const delegate of Object.values(tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) method.mockClear();
      }
    }
    audit.record.mockClear();
    return {
      service,
      tx,
      audit,
      authorityId,
      authoritySnapshotRef,
      historicalEmploymentCompanyId: approvedSource.employmentCompanyId,
      mutationMethods,
      confirm: () => service.confirmAuthority("confirmer-1", authorityId, {
        idempotencyKey: "73737373-7373-4373-8373-737373737373",
        expectedRevision: 2
      })
    };
  }

  it("derives a server-side authority snapshot and freezes PERSON wage facts", async () => {
    const { service, tx, selection } = harness();

    const result = await service.createAuthority("finance-staff", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 0,
      contractSelectionRef: CONTRACT_REF,
      effectiveFrom: "2026-08-01",
      evidenceRef: "file-selection-ref",
      wageLines: [
        {
          selectionRef: "person-selection-ref",
          wageMonth: "2026-08",
          amountCents: "12345",
          amountMode: "CONFIRMED_AMOUNT",
          amountRuleVersion: 1,
          midMonthPolicy: "NOT_APPLICABLE",
          evidenceCoordinate: "工资表第 3 行"
        }
      ],
      guaranteeObligations: []
    });

    expect(selection.matches).toHaveBeenCalled();
    expect(tx.affiliateClearingAuthorityVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        protocolNameSnapshot: "挂靠协议",
        coverageKind: "PERSON",
        evidenceSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "draft"
      })
    });
    expect(tx.assignedWageAuthorityLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        coverageKind: "PERSON",
        coverageKey: "person:user-1",
        personNameSnapshot: "张三",
        approvedAmountCents: 12345n,
        grossCapCents: 12345n,
        evidenceLevel: "A"
      })
    });
    expect(result).toEqual(expect.objectContaining({
      coverageKind: "PERSON",
      sourceDiscriminator: "construction_enterprise_assigned_wage"
    }));
  });

  it("locks normalized wage buckets before confirmation rechecks canonical wage conflicts", async () => {
    const { service, tx } = harness();
    const sequence: string[] = [];
    tx.affiliateClearingAuthorityVersion.findUnique.mockResolvedValue({
      id: "authority-1",
      projectId: "project-1",
      affiliateCompanyContractId: "contract-1",
      status: "submitted",
      createdByUserId: "maker-1",
      submittedByUserId: "submitter-1"
    });
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([
      {
        id: "line-jul-role",
        authorityVersionId: "authority-1",
        affiliateCompanyContractId: "contract-1",
        projectId: "project-1",
        wageMonth: new Date("2026-07-01T00:00:00.000Z"),
        coverageKind: "ROLE_SUMMARY",
        personAuthorityKey: null,
        lineFingerprint: "1".repeat(64)
      },
      {
        id: "line-aug-person",
        authorityVersionId: "authority-1",
        affiliateCompanyContractId: "contract-1",
        projectId: "project-1",
        wageMonth: new Date("2026-08-01T00:00:00.000Z"),
        coverageKind: "PERSON",
        personAuthorityKey: "user-1",
        lineFingerprint: "2".repeat(64)
      },
      {
        id: "line-aug-role",
        authorityVersionId: "authority-1",
        affiliateCompanyContractId: "contract-1",
        projectId: "project-1",
        wageMonth: new Date("2026-08-01T00:00:00.000Z"),
        coverageKind: "ROLE_SUMMARY",
        personAuthorityKey: null,
        lineFingerprint: "3".repeat(64)
      }
    ]);
    tx.$executeRaw.mockImplementation(async (query: { values: unknown[] }) => {
      sequence.push(`lock:${String(query.values[0])}`);
      return 0;
    });
    tx.wagePersonLine.findFirst.mockImplementation(async () => {
      sequence.push("canonical-recheck");
      return { id: "canonical-wage-line-1" };
    });

    await expect(service.confirmAuthority("finance-staff", "authority-1", {
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      expectedRevision: 2
    })).rejects.toThrow("B级岗位汇总与同项目同月 #105 工资来源重叠");

    expect(sequence).toEqual([
      "lock:wage-conflict:v1:project-1:2026-07",
      "lock:wage-conflict:v1:project-1:2026-08",
      "canonical-recheck"
    ]);
    expect(tx.wagePersonLine.findFirst).toHaveBeenCalledWith({
      where: {
        projectAllocations: { some: { projectId: "project-1" } },
        statementVersion: {
          status: "confirmed",
          sourceVersion: { wageMonth: "2026-07" },
          OR: [{
            projectionOrigin: "ordinary"
          }, {
            projectionOrigin: "historical_takeover_legacy_link",
            takeoverProjectionEnvelopes: {
              some: {
                projectId: "project-1",
                eligibilityRevocations: { none: {} }
              }
            }
          }]
        }
      },
      select: { id: true }
    });
    expect(tx.affiliateClearingAuthorityVersion.update).not.toHaveBeenCalled();
  });

  it.each([
    { label: "draft", status: "draft", reviewDisposition: null },
    { label: "submitted", status: "submitted", reviewDisposition: null },
    { label: "review-returned/superseded", status: "superseded", reviewDisposition: "review_returned" }
  ] as const)(
    "does not treat an exact PERSON canonical wage line on a $label statement as a formal conflict",
    async (canonicalState) => {
      const context = await preparePersonAuthorityAgainstCanonicalStatus(canonicalState);

      await expect(context.confirm()).resolves.toEqual(expect.objectContaining({ status: "confirmed" }));

      expect(context.tx.wagePersonLine.findFirst).toHaveBeenCalledWith({
        where: {
          employeeId: "user-1",
          projectAllocations: { some: { projectId: "project-1" } },
          statementVersion: {
            status: "confirmed",
            sourceVersion: { wageMonth: "2026-08" },
            OR: [{
              projectionOrigin: "ordinary"
            }, {
              projectionOrigin: "historical_takeover_legacy_link",
              takeoverProjectionEnvelopes: {
                some: {
                  projectId: "project-1",
                  eligibilityRevocations: { none: {} }
                }
              }
            }]
          }
        },
        select: { id: true }
      });
      expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledTimes(1);
      expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledWith({
        where: { id: context.authorityId },
        data: {
          status: "confirmed",
          confirmedByUserId: "confirmer-1",
          confirmedAt: expect.any(Date)
        }
      });
      expect(context.audit.record).toHaveBeenCalledTimes(1);
      for (const delegate of Object.values(context.tx)) {
        if (!delegate || typeof delegate !== "object") continue;
        for (const methodName of context.mutationMethods) {
          const method = (delegate as Record<string, unknown>)[methodName];
          if (!jest.isMockFunction(method)) continue;
          if (delegate === context.tx.affiliateClearingAuthorityVersion && methodName === "update") {
            expect(method).toHaveBeenCalledTimes(1);
          } else {
            expect(method).not.toHaveBeenCalled();
          }
        }
      }
    }
  );

  it("blocks an exact PERSON canonical wage line on a confirmed statement before the first confirmation write", async () => {
    const context = await preparePersonAuthorityAgainstCanonicalStatus({
      status: "confirmed",
      reviewDisposition: null
    });

    let conflict: unknown;
    try {
      await context.confirm();
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getStatus()).toBe(409);
    expect((conflict as ConflictException).message).toBe(
      "同人同月跨 #104/#105 工资来源冲突，必须整组阻断"
    );
    expect(context.tx.wagePersonLine.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: "user-1",
        projectAllocations: { some: { projectId: "project-1" } },
        statementVersion: {
          status: "confirmed",
          sourceVersion: { wageMonth: "2026-08" },
          OR: [{
            projectionOrigin: "ordinary"
          }, {
            projectionOrigin: "historical_takeover_legacy_link",
            takeoverProjectionEnvelopes: {
              some: {
                projectId: "project-1",
                eligibilityRevocations: { none: {} }
              }
            }
          }]
        }
      },
      select: { id: true }
    });
    for (const delegate of Object.values(context.tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of context.mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) expect(method).not.toHaveBeenCalled();
      }
    }
    expect(context.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "active at the same coordinates and company",
      employmentCompanyId: "company-1"
    },
    {
      label: "active at the same coordinates for another company",
      employmentCompanyId: "company-2"
    }
  ] as const)("blocks #214 PERSON confirmation when historical A is $label", async ({
    employmentCompanyId
  }) => {
    const context = await preparePersonAuthorityAgainstHistoricalA({
      lifecycle: "active",
      projectId: "project-1",
      wageMonth: "2026-08",
      employeeId: "user-1",
      employmentCompanyId
    });

    let conflict: unknown;
    try {
      await context.confirm();
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getStatus()).toBe(409);
    expect((conflict as ConflictException).message).toBe(
      "同人同月跨 #104/#105 工资来源冲突，必须整组阻断"
    );
    expect(context.tx.wagePersonLine.findFirst).toHaveBeenCalledTimes(1);
    expect(context.historicalEmploymentCompanyId).toBe(employmentCompanyId);
    const canonicalQuery = context.tx.wagePersonLine.findFirst.mock.calls[0]?.[0] as
      | { where?: unknown }
      | undefined;
    expect(hasNestedOwnKey(canonicalQuery?.where, "employmentCompanyId")).toBe(false);
    for (const delegate of Object.values(context.tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of context.mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) expect(method).not.toHaveBeenCalled();
      }
    }
    expect(context.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "inactive_applied at the same coordinates",
      lifecycle: "inactive_applied",
      projectId: "project-1",
      wageMonth: "2026-08",
      employeeId: "user-1"
    },
    {
      label: "active then completely compensated at the same coordinates",
      lifecycle: "compensated",
      projectId: "project-1",
      wageMonth: "2026-08",
      employeeId: "user-1"
    },
    {
      label: "active and uncompensated in another project",
      lifecycle: "active",
      projectId: "project-2",
      wageMonth: "2026-08",
      employeeId: "user-1"
    },
    {
      label: "active and uncompensated in another wage month",
      lifecycle: "active",
      projectId: "project-1",
      wageMonth: "2026-09",
      employeeId: "user-1"
    },
    {
      label: "active and uncompensated for another employee",
      lifecycle: "active",
      projectId: "project-1",
      wageMonth: "2026-08",
      employeeId: "user-2"
    }
  ] as const)("allows #214 PERSON confirmation when historical A is $label", async (control) => {
    const context = await preparePersonAuthorityAgainstHistoricalA({
      lifecycle: control.lifecycle,
      projectId: control.projectId,
      wageMonth: control.wageMonth,
      employeeId: control.employeeId,
      employmentCompanyId: "company-1"
    });

    await expect(context.confirm()).resolves.toEqual(expect.objectContaining({ status: "confirmed" }));

    expect(context.tx.wagePersonLine.findFirst).toHaveBeenCalledTimes(1);
    expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledTimes(1);
    expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledWith({
      where: { id: context.authorityId },
      data: {
        status: "confirmed",
        confirmedByUserId: "confirmer-1",
        confirmedAt: expect.any(Date)
      }
    });
    expect(context.audit.record).toHaveBeenCalledTimes(1);
    expect(context.audit.record).toHaveBeenCalledWith(context.tx, {
      action: "clearing.authority.confirm",
      actorUserId: "confirmer-1",
      businessType: "affiliate_clearing_authority",
      businessId: context.authorityId,
      metadata: { authoritySnapshotRef: context.authoritySnapshotRef }
    });
    for (const delegate of Object.values(context.tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of context.mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (!jest.isMockFunction(method)) continue;
        if (delegate === context.tx.affiliateClearingAuthorityVersion && methodName === "update") {
          expect(method).toHaveBeenCalledTimes(1);
        } else {
          expect(method).not.toHaveBeenCalled();
        }
      }
    }
  });

  it("blocks ROLE_SUMMARY confirmation against an activated B summary in the exact company, project, and month", async () => {
    const { service, tx, audit } = harness();
    const exclusion = computePol219AssignedWageExclusionSet([]);
    const summaryAuthorities = [{
      id: "summary-b-1",
      atomicScopeVersionId: "scope-b-1",
      summaryBucketKey: "company-1:project-1:2026-08:project_leadership",
      employmentCompanyId: "company-1",
      projectId: "project-1",
      wageMonth: "2026-08",
      assignedWageExclusionSchemaVersion: 1,
      assignedWageExclusionPayload: exclusion.payload,
      assignedWageExclusionSetFingerprint: exclusion.fingerprint
    }];
    const scopes = [{ id: "scope-b-1", scopeKind: "historical_wage" }];
    const manifests = [{
      id: "manifest-b-1",
      atomicScopeVersionId: "scope-b-1",
      projectId: "project-1",
      adapterKind: "historical_wage"
    }];
    const scopeProjects = [{
      id: "scope-project-b-1",
      atomicScopeVersionId: "scope-b-1",
      manifestVersionId: "manifest-b-1",
      projectId: "project-1"
    }];
    const mappings = [{
      id: "mapping-b-1",
      manifestVersionId: "manifest-b-1",
      projectId: "project-1",
      adapterKind: "historical_wage",
      evidenceLevel: "B",
      mappingDecision: "FORMAL",
      sourceDiscriminator: "historical_wage_summary",
      historicalWageSummaryAuthorityVersionId: "summary-b-1"
    }];
    const receipts = [{
      id: "receipt-create-b-1",
      atomicScopeVersionId: "scope-b-1",
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.create",
      status: "prepared",
      actorUserId: "finance-maker-b-1",
      delegatorUserId: null
    }, {
      id: "receipt-attest-b-1",
      atomicScopeVersionId: "scope-b-1",
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.attest",
      status: "attested",
      actorUserId: "finance-attester-b-1",
      delegatorUserId: null
    }, {
      id: "receipt-activate-b-1",
      atomicScopeVersionId: "scope-b-1",
      manifestVersionId: null,
      action: "historical_wage_takeover.scope.activate",
      status: "activated",
      actorUserId: "finance-activator-b-1",
      delegatorUserId: null
    }];
    const attestations = [{
      id: "attestation-create-b-1",
      atomicScopeVersionId: "scope-b-1",
      authorityVersionId: "summary-b-1",
      summaryBucketKey: summaryAuthorities[0]!.summaryBucketKey,
      receiptId: "receipt-create-b-1",
      actorUserId: "finance-maker-b-1",
      delegatorUserId: null,
      attestationOrdinal: 1
    }, {
      id: "attestation-review-b-1",
      atomicScopeVersionId: "scope-b-1",
      authorityVersionId: "summary-b-1",
      summaryBucketKey: summaryAuthorities[0]!.summaryBucketKey,
      receiptId: "receipt-attest-b-1",
      actorUserId: "finance-attester-b-1",
      delegatorUserId: null,
      attestationOrdinal: 2
    }];
    const receiptLines = [{
      id: "receipt-line-activate-b-1",
      receiptId: "receipt-activate-b-1",
      rowMappingId: "mapping-b-1",
      projectId: "project-1",
      decision: "FORMAL",
      targetKind: "historical_wage_summary_authority_version",
      targetRef: "summary-b-1"
    }];
    tx.affiliateClearingAuthorityVersion.findUnique.mockResolvedValue({
      id: "authority-1",
      projectId: "project-1",
      affiliateCompanyContractId: "contract-1",
      authoritySnapshotRef: "AUTH-1",
      status: "submitted",
      createdByUserId: "maker-1",
      submittedByUserId: "submitter-1"
    });
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([{
      id: "line-role-1",
      authorityVersionId: "authority-1",
      affiliateCompanyContractId: "contract-1",
      projectId: "project-1",
      wageMonth: new Date("2026-08-01T00:00:00.000Z"),
      coverageKind: "ROLE_SUMMARY",
      personAuthorityKey: null,
      lineFingerprint: "1".repeat(64)
    }]);
    tx.historicalWageSummaryAuthorityVersion.findMany.mockImplementation(async (query: {
      where?: {
        employmentCompanyId?: string;
        OR?: Array<{ projectId?: string; wageMonth?: string }>;
        atomicScope?: {
          is?: {
            scopeKind?: string;
            receipts?: {
              some?: { action?: string; status?: string };
              none?: { action?: string; status?: string };
            };
          };
        };
      };
    }) => {
      const expectedActivation = {
        action: "historical_wage_takeover.scope.activate",
        status: "activated"
      };
      const expectedCompensation = {
        action: "historical_wage_takeover.scope.compensate",
        status: "compensated"
      };
      const receiptQuery = query.where?.atomicScope?.is?.receipts;
      if (
        !Array.isArray(query.where?.OR) ||
        query.where?.atomicScope?.is?.scopeKind !== "historical_wage" ||
        receiptQuery?.some?.action !== expectedActivation.action ||
        receiptQuery.some.status !== expectedActivation.status ||
        receiptQuery?.none?.action !== expectedCompensation.action ||
        receiptQuery.none.status !== expectedCompensation.status
      ) {
        return [];
      }
      return summaryAuthorities.filter((summary) => {
      const scope = scopes.find((item) => item.id === summary.atomicScopeVersionId);
      if (!scope) return false;
      const manifest = manifests.find((item) =>
        item.atomicScopeVersionId === scope.id && item.projectId === summary.projectId
      );
      const scopeProject = scopeProjects.find((item) =>
        item.atomicScopeVersionId === scope.id &&
        item.manifestVersionId === manifest?.id &&
        item.projectId === summary.projectId
      );
      const mapping = mappings.find((item) =>
        item.manifestVersionId === manifest?.id &&
        item.projectId === summary.projectId &&
        item.adapterKind === "historical_wage" &&
        item.evidenceLevel === "B" &&
        item.mappingDecision === "FORMAL" &&
        item.sourceDiscriminator === "historical_wage_summary" &&
        item.historicalWageSummaryAuthorityVersionId === summary.id
      );
      const summaryAttestations = attestations.filter((item) =>
        item.atomicScopeVersionId === scope.id &&
        item.authorityVersionId === summary.id &&
        item.summaryBucketKey === summary.summaryBucketKey
      );
      const attestationReceipts = summaryAttestations.map((attestation) => receipts.find((receipt) =>
        receipt.id === attestation.receiptId &&
        receipt.atomicScopeVersionId === scope.id &&
        receipt.manifestVersionId === null &&
        receipt.actorUserId === attestation.actorUserId &&
        receipt.delegatorUserId === attestation.delegatorUserId
      ));
      const scopeReceipts = receipts.filter((receipt) => receipt.atomicScopeVersionId === scope.id);
      const matchesReceiptFilter = (
        receipt: (typeof receipts)[number],
        filter: { action?: string; status?: string }
      ) => receipt.action === filter.action && receipt.status === filter.status;
      const activationReceipt = scopeReceipts.find((receipt) =>
        receipt.manifestVersionId === null && matchesReceiptFilter(receipt, receiptQuery.some!)
      );
      const activationLine = receiptLines.find((line) =>
        line.receiptId === activationReceipt?.id &&
        line.rowMappingId === mapping?.id &&
        line.projectId === summary.projectId &&
        line.decision === "FORMAL" &&
        `${line.targetKind}:${line.targetRef}` === `historical_wage_summary_authority_version:${summary.id}`
      );
      const attestationOrdinals = summaryAttestations
        .map((item) => item.attestationOrdinal)
        .sort((left, right) => left - right);
      const effectiveIdentitySets = summaryAttestations.map((item) => new Set(
        [item.actorUserId, item.delegatorUserId].filter((identity): identity is string => Boolean(identity))
      ));
      const distinctEffectiveIdentities =
        effectiveIdentitySets.length === 2 &&
        effectiveIdentitySets.every((identities) => identities.size > 0) &&
        [...effectiveIdentitySets[0]!].every((identity) => !effectiveIdentitySets[1]!.has(identity));
      return summary.employmentCompanyId === query.where?.employmentCompanyId &&
        query.where.OR!.some((bucket) =>
          bucket.projectId === summary.projectId && bucket.wageMonth === summary.wageMonth
        ) &&
        scope.scopeKind === query.where.atomicScope!.is!.scopeKind &&
        Boolean(manifest && scopeProject && mapping && activationReceipt && activationLine) &&
        summaryAttestations.length === 2 &&
        attestationOrdinals[0] === 1 &&
        attestationOrdinals[1] === 2 &&
        new Set(summaryAttestations.map((item) => item.receiptId)).size === 2 &&
        distinctEffectiveIdentities &&
        attestationReceipts.every(Boolean) &&
        attestationReceipts.some((receipt) =>
          receipt?.action === "historical_wage_takeover.scope.create" && receipt.status === "prepared"
        ) &&
        attestationReceipts.some((receipt) =>
          receipt?.action === "historical_wage_takeover.scope.attest" && receipt.status === "attested"
        ) &&
        !scopeReceipts.some((receipt) => matchesReceiptFilter(receipt, receiptQuery.none!));
      });
    });
    Object.assign(tx.historicalWageSummaryAuthorityVersion, {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    });

    let conflict: unknown;
    try {
      await service.confirmAuthority("finance-director", "authority-1", {
        idempotencyKey: "91919191-9191-4191-8191-919191919191",
        expectedRevision: 2
      });
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getStatus()).toBe(409);
    expect((conflict as ConflictException).message).toBe(
      "B级历史工资汇总与同公司、同项目、同月 ROLE_SUMMARY 工资权威冲突"
    );
    expect(tx.wagePersonLine.findFirst).not.toHaveBeenCalled();
    const mutationMethods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const delegate of Object.values(tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) expect(method).not.toHaveBeenCalled();
      }
    }
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("blocks PERSON confirmation when an activated B summary lacks the full canonical exclusion set", async () => {
    const context = await preparePersonAuthorityAgainstHistoricalSummary(() =>
      computePol219AssignedWageExclusionSet([])
    );

    let conflict: unknown;
    try {
      await context.confirm();
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getStatus()).toBe(409);
    expect((conflict as ConflictException).message).toContain("人员排除证明");
    expect(context.tx.historicalWageSummaryAuthorityVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        employmentCompanyId: "company-1",
        OR: [{ projectId: "project-1", wageMonth: "2026-08" }],
        atomicScope: {
          is: {
            scopeKind: "historical_wage",
            receipts: {
              some: {
                action: "historical_wage_takeover.scope.activate",
                status: "activated"
              },
              none: {
                action: "historical_wage_takeover.scope.compensate",
                status: "compensated"
              }
            }
          }
        }
      }
    }));
    expect(context.tx.wagePersonLine.findFirst).not.toHaveBeenCalled();
    for (const delegate of Object.values(context.tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of context.mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) expect(method).not.toHaveBeenCalled();
      }
    }
    expect(context.audit.record).not.toHaveBeenCalled();
  });

  it("allows PERSON confirmation only when every matching line has a canonical active exclusion proof", async () => {
    const proofHash = "9".repeat(64);
    const context = await preparePersonAuthorityAgainstHistoricalSummary((incomingLine) =>
      computePol219AssignedWageExclusionSet([{
        ...incomingLine,
        fileObjectId: "exclusion-file-1",
        contentSha256: proofHash,
        evidenceCoordinate: {
          sourceObjectSha256: "a".repeat(64),
          worksheetName: "工资排除证明",
          rowNumber: "3",
          columnNumber: null,
          normalizedRowSha256: "b".repeat(64)
        }
      }])
    );
    context.tx.fileObject.findMany.mockImplementation(async (query: {
      where?: { id?: { in?: string[] } };
      select?: { id?: boolean; storageStatus?: boolean; contentSha256?: boolean };
    }) => query.where?.id?.in?.length === 1 &&
      query.where.id.in[0] === "exclusion-file-1" &&
      query.select?.id === true &&
      query.select.storageStatus === true &&
      query.select.contentSha256 === true
      ? [{ id: "exclusion-file-1", storageStatus: "active", contentSha256: proofHash }]
      : []);

    await expect(context.confirm()).resolves.toEqual(expect.objectContaining({ status: "confirmed" }));

    expect(context.exclusion.payload.assignedWageExclusions).toEqual([expect.objectContaining({
      authorityVersionId: context.authorityId,
      lineId: context.incomingLine.id,
      lineFingerprint: context.incomingLine.lineFingerprint,
      fileObjectId: "exclusion-file-1",
      contentSha256: proofHash
    })]);
    expect(context.tx.fileObject.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["exclusion-file-1"] } },
      select: { id: true, storageStatus: true, contentSha256: true }
    });
    expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledTimes(1);
    expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledWith({
      where: { id: context.authorityId },
      data: {
        status: "confirmed",
        confirmedByUserId: "confirmer-1",
        confirmedAt: expect.any(Date)
      }
    });
    expect(context.audit.record).toHaveBeenCalledTimes(1);
    for (const delegate of Object.values(context.tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of context.mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (!jest.isMockFunction(method)) continue;
        if (delegate === context.tx.affiliateClearingAuthorityVersion && methodName === "update") {
          expect(method).toHaveBeenCalledTimes(1);
        } else {
          expect(method).not.toHaveBeenCalled();
        }
      }
    }
  });

  it.each([
    {
      label: "the same bucket is attested but not active",
      lifecycle: "attested",
      projectId: "project-1",
      wageMonth: "2026-08"
    },
    {
      label: "the same active bucket is completely compensated",
      lifecycle: "compensated",
      projectId: "project-1",
      wageMonth: "2026-08"
    },
    {
      label: "an active uncompensated bucket belongs to another project",
      lifecycle: "active",
      projectId: "project-2",
      wageMonth: "2026-08"
    },
    {
      label: "an active uncompensated bucket belongs to another wage month",
      lifecycle: "active",
      projectId: "project-1",
      wageMonth: "2026-09"
    }
  ] as const)("allows PERSON confirmation when $label", async (control) => {
    const context = await preparePersonAuthorityAgainstHistoricalSummary(
      () => computePol219AssignedWageExclusionSet([]),
      {
        lifecycle: control.lifecycle,
        projectId: control.projectId,
        wageMonth: control.wageMonth
      }
    );

    await expect(context.confirm()).resolves.toEqual(expect.objectContaining({ status: "confirmed" }));

    expect(context.tx.historicalWageSummaryAuthorityVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        employmentCompanyId: "company-1",
        OR: [{ projectId: "project-1", wageMonth: "2026-08" }],
        atomicScope: {
          is: {
            scopeKind: "historical_wage",
            receipts: {
              some: {
                action: "historical_wage_takeover.scope.activate",
                status: "activated"
              },
              none: {
                action: "historical_wage_takeover.scope.compensate",
                status: "compensated"
              }
            }
          }
        }
      }
    }));
    expect(context.tx.wagePersonLine.findFirst).toHaveBeenCalledTimes(1);
    expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledTimes(1);
    expect(context.tx.affiliateClearingAuthorityVersion.update).toHaveBeenCalledWith({
      where: { id: context.authorityId },
      data: {
        status: "confirmed",
        confirmedByUserId: "confirmer-1",
        confirmedAt: expect.any(Date)
      }
    });
    expect(context.audit.record).toHaveBeenCalledTimes(1);
    expect(context.audit.record).toHaveBeenCalledWith(context.tx, {
      action: "clearing.authority.confirm",
      actorUserId: "confirmer-1",
      businessType: "affiliate_clearing_authority",
      businessId: context.authorityId,
      metadata: { authoritySnapshotRef: context.authoritySnapshotRef }
    });
    for (const delegate of Object.values(context.tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of context.mutationMethods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (!jest.isMockFunction(method)) continue;
        if (delegate === context.tx.affiliateClearingAuthorityVersion && methodName === "update") {
          expect(method).toHaveBeenCalledTimes(1);
        } else {
          expect(method).not.toHaveBeenCalled();
        }
      }
    }
  });

  it("fails closed when selectionRef is invalid before any authority write", async () => {
    const { service, tx, selection } = harness();
    selection.matches.mockReturnValue(false);

    await expect(
      service.createAuthority("finance-staff", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 0,
        contractSelectionRef: CONTRACT_REF,
        effectiveFrom: "2026-08-01",
        evidenceRef: "file-selection-ref",
        wageLines: [],
        guaranteeObligations: [{
          selectionRef: "guarantee-selection-ref",
          baseAmountCents: "100000",
          calculationMode: "RATE_BPS",
          rateBps: 1000,
          returnCondition: "协议结算后确认退回"
        }]
      })
    ).rejects.toThrow("authority selectionRef 已失效");
    expect(tx.affiliateClearingAuthorityVersion.create).not.toHaveBeenCalled();
  });

  it("uses the server-issued contract selectionRef to create a guarantee obligation", async () => {
    const { service, tx, selection } = harness();

    await service.createAuthority("finance-staff", {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 0,
      contractSelectionRef: CONTRACT_REF,
      effectiveFrom: "2026-08-01",
      evidenceRef: "file-selection-ref",
      wageLines: [],
      guaranteeObligations: [{
        selectionRef: CONTRACT_REF,
        baseAmountCents: "100000",
        calculationMode: "RATE_BPS",
        rateBps: 1000,
        returnCondition: "协议结算后确认退回"
      }]
    });

    expect(tx.guaranteeObligationVersion.create).toHaveBeenCalled();
    expect(selection.matches.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      purpose: "contract",
      selectedKey: ""
    }));
  });

  it("does not resolve an expired guarantee obligation into a new clearing case", async () => {
    const now = new Date();
    const { roles, selection, audit } = harness();
    const prisma = {
      affiliateClearingAuthorityVersion: {
        findMany: jest.fn().mockResolvedValue([{
          id: "authority-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          authoritySnapshotRef: "acv-1",
          authorityFingerprint: "c".repeat(64),
          versionNo: 1,
          coverageKind: "ROLE_SUMMARY",
          effectiveFrom: new Date(now.getTime() - 86_400_000),
          effectiveTo: null,
          status: "confirmed"
        }])
      },
      guaranteeObligationVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            obligationId: "expired",
            enabled: true,
            effectiveFrom: new Date(now.getTime() - 172_800_000),
            effectiveTo: new Date(now.getTime() - 86_400_000),
            capCents: 1000n,
            currencyCode: "CNY"
          },
          {
            obligationId: "active",
            enabled: true,
            effectiveFrom: new Date(now.getTime() - 86_400_000),
            effectiveTo: null,
            capCents: 2000n,
            currencyCode: "CNY"
          }
        ])
      }
    };
    selection.matches.mockReturnValue(true);
    const service = new AffiliateClearingAuthorityService(
      prisma as never,
      roles as never,
      selection as never,
      audit as never
    );

    const result = await service.resolveCaseSelection("finance-staff", {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      expectedRevision: 0,
      selectionRef: "fac1.guarantee-selection-ref"
    }, "deposit");

    expect(result.governedSubjectKey).toContain("/active");
  });

  it("revalidates a frozen wage selection against the confirmed authority row inside the transaction", async () => {
    const now = new Date();
    const service = harness().service;
    const tx = {
      affiliateClearingAuthorityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "authority-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          authorityFingerprint: "a".repeat(64),
          status: "confirmed",
          effectiveFrom: new Date(now.getTime() - 86_400_000),
          effectiveTo: null
        })
      },
      assignedWageAuthorityLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: "line-1",
          authorityVersionId: "authority-1",
          coverageKey: "person:user-1",
          coverageKind: "PERSON",
          wageMonth: new Date("2026-08-01T00:00:00.000Z"),
          grossCapCents: 12345n,
          currencyCode: "CNY",
          lineFingerprint: "d".repeat(64)
        })
      },
      guaranteeObligationVersion: { findFirst: jest.fn() }
    };

    const result = await service.revalidateResolvedAuthority(tx as never, {
      projectId: "project-1",
      constructionEnterpriseAssignmentId: "assignment-1",
      category: "assigned_management_salary",
      governedSubjectKey: "construction_enterprise_assigned_wage/project-1/assignment-1/authority-1/2026-08-01/person:user-1",
      authoritativeGrossCapCents: 12345n,
      currencyCode: "CNY",
      authorityVersionId: "authority-1",
      authoritySnapshotRef: "acv_snapshot",
      sourceDiscriminator: "construction_enterprise_assigned_wage",
      coverageKind: "PERSON",
      coverageKey: "person:user-1",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      authorityFingerprint: "a".repeat(64),
      authorityLineId: "line-1",
      authorityLineFingerprint: "d".repeat(64)
    });

    expect(result.authoritySnapshotRef).toBe("acv_snapshot");
    expect(tx.assignedWageAuthorityLine.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ authorityVersionId: "authority-1", coverageKey: "person:user-1" })
    });
  });

  it("resolves a server-issued takeover selection to an exact role-summary legacy deduction", async () => {
    const { service, tx, selection } = harness();
    const legacy = {
      id: "legacy-deduction-1",
      projectId: "project-1",
      factType: "affiliate_deduction",
      entryKind: "original",
      adjustsFactId: null,
      effectDirection: "increase",
      occurredAt: new Date("2026-08-15T00:00:00.000Z"),
      amountCents: 12345n,
      counterpartyName: "挂靠企业",
      basisType: "written",
      deductionCategory: "management_fee",
      affiliateAssignmentId: "assignment-1",
      affiliateBusinessPartyVersionId: "business-version-1",
      affiliateNameSnapshot: "挂靠企业",
      description: "历史管理费扣款",
      evidenceFileId: "file-legacy-1",
      documentVersion: 1,
      fileContentSha256Snapshot: "b".repeat(64),
      confirmedByUserId: "finance-director",
      confirmedAt: new Date("2026-08-16T00:00:00.000Z"),
      status: "confirmed"
    };
    const source = resolveAffiliateDeductionSource(legacy);
    tx.affiliateClearingAuthorityVersion.findMany = jest.fn().mockResolvedValue([{
      id: "authority-1",
      projectId: "project-1",
      constructionEnterpriseAssignmentId: "assignment-1",
      authoritySnapshotRef: "acv-1",
      authorityFingerprint: "a".repeat(64),
      versionNo: 1,
      coverageKind: "ROLE_SUMMARY",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      status: "confirmed",
      evidenceSha256: "b".repeat(64),
      evidenceManifestSha256: "c".repeat(64)
    }]);
    tx.assignedWageAuthorityLine.findMany = jest.fn().mockResolvedValue([{
      id: "line-1",
      authorityVersionId: "authority-1",
      coverageKey: "role:project_manager",
      coverageKind: "ROLE_SUMMARY",
      wageMonth: new Date("2026-08-01T00:00:00.000Z"),
      grossCapCents: 12345n,
      currencyCode: "CNY",
      lineFingerprint: "d".repeat(64),
      evidenceSha256: "b".repeat(64),
      personAuthorityKey: null
    }]);
    tx.projectUpstreamFundFact.findMany.mockResolvedValue([legacy]);
    selection.matches.mockImplementation((_ref: string, binding: { purpose: string }) => binding.purpose === "takeover");

    const result = await service.resolveCaseSelection("finance-staff", {
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
      expectedRevision: 0,
      selectionRef: "fac1.takeover-selection-ref"
    }, "assigned_management_salary", tx as never);

    expect(result.legacySource).toEqual(expect.objectContaining({
      sourceType: "project_upstream_fund_fact",
      sourceBusinessId: legacy.id,
      sourceFingerprint: source.sourceFingerprint,
      normalizedRowHash: source.normalizedRowHash
    }));
  });

  it("allows a scoped one-hop delegate to resolve a delegate-bound selectionRef", async () => {
    const { service, tx, roles, selection } = harness();
    tx.affiliateClearingAuthorityVersion.findMany.mockResolvedValue([{
      id: "authority-1",
      projectId: "project-1",
      constructionEnterpriseAssignmentId: "assignment-1",
      authoritySnapshotRef: "acv-1",
      authorityFingerprint: "a".repeat(64),
      versionNo: 1,
      coverageKind: "PERSON",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      status: "confirmed",
      evidenceSha256: "b".repeat(64),
      evidenceManifestSha256: "c".repeat(64)
    }]);
    tx.assignedWageAuthorityLine.findMany.mockResolvedValue([{
      id: "line-1",
      authorityVersionId: "authority-1",
      coverageKey: "person:user-1",
      coverageKind: "PERSON",
      wageMonth: new Date("2026-08-01T00:00:00.000Z"),
      grossCapCents: 12345n,
      currencyCode: "CNY",
      lineFingerprint: "d".repeat(64),
      evidenceSha256: "b".repeat(64),
      personAuthorityKey: "user-1"
    }]);
    tx.approvalDelegation.findMany.mockResolvedValue([{ fromUserId: "director-1" }]);
    tx.user.findMany.mockResolvedValue([
        { id: "delegate-1", isActive: true },
        { id: "director-1", isActive: true }
    ]);
    roles.resolveActiveRoleScopes.mockImplementation(async (userId: string) => userId === "director-1" ? ["finance_director"] : []);
    selection.matches.mockImplementation((_ref: string, binding: { actorUserId: string }) => binding.actorUserId === "director-1");

    const result = await service.resolveCaseSelection("delegate-1", {
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
      expectedRevision: 0,
      delegatorUserId: "director-1",
      selectionRef: "fac1.delegate-bound-selection-ref"
    }, "assigned_management_salary", tx as never);

    expect(result).toEqual(expect.objectContaining({
      authorityVersionId: "authority-1",
      personAuthorityKey: "user-1"
    }));
    expect(tx.approvalDelegation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        toUserId: "delegate-1",
        actionKey: "clearing.prepare",
        resourceType: "clearing_project",
        resourceId: "project-1"
      })
    }));
  });

  it("returns business labels and opaque selectionRefs without authority technical identifiers", async () => {
    const { service, prisma } = harness();
    prisma.affiliateClearingAuthorityVersion = {
      findMany: jest.fn().mockResolvedValue([{
        id: "authority-1",
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        authoritySnapshotRef: "acv-technical-ref",
        authorityFingerprint: "a".repeat(64),
        coverageKind: "PERSON",
        versionNo: 1,
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        effectiveTo: null
      }])
    };
    prisma.assignedWageAuthorityLine = {
      findMany: jest.fn().mockResolvedValue([{
        coverageKey: "person:user-1",
        coverageKind: "PERSON",
        wageMonth: new Date("2026-08-01T00:00:00.000Z"),
        grossCapCents: 12345n,
        evidenceLevel: "A",
        personNameSnapshot: "张三",
        roleNameSnapshot: null
      }])
    };
    prisma.guaranteeObligationVersion = { findMany: jest.fn().mockResolvedValue([]) };

    const result = await service.options("finance-staff", "project-1");
    const wageOption = result.options.find((option) => option.optionKind === "assigned_wage");

    expect(wageOption).toEqual(expect.objectContaining({ label: "张三", selectionRef: expect.any(String) }));
    expect(wageOption).not.toHaveProperty("authoritySnapshotRef");
    expect(wageOption).not.toHaveProperty("authorityFingerprint");
  });
});
