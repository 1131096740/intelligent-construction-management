import { AffiliateClearingAuthorityService } from "./affiliate-clearing-authority.service";

const COMMAND_ID = "22222222-2222-4222-8222-222222222222";
const CONTRACT_REF = "fac1.contract-selection-ref";

function harness() {
  const tx = {
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
    fileObject: { findFirst: jest.fn().mockResolvedValue({ id: "file-1", contentSha256: "b".repeat(64) }) },
    projectRosterMember: { findMany: jest.fn().mockResolvedValue([{ userId: "user-1" }]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "project_manager" }]) },
    wagePersonLine: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: "user-1", name: "张三", isActive: true }]) },
    affiliateClearingAuthorityVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ ...data }))
    },
    assignedWageAuthorityLine: {
      create: jest.fn().mockImplementation(({ data }) => ({ ...data }))
    },
    guaranteeObligationVersion: {
      create: jest.fn().mockImplementation(({ data }) => ({ ...data }))
    }
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
});
