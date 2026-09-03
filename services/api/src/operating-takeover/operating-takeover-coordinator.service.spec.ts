import { createHash } from "node:crypto";
import { OperatingTakeoverCoordinatorService } from "./operating-takeover-coordinator.service";
import { ConstructionEnterpriseClearingAdapter } from "./construction-enterprise-clearing.adapter";
import { resolveAffiliateDeductionSource } from "../clearing/affiliate-clearing-authority.domain";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
process.env.BUILD_COMMIT_SHA = "1".repeat(40);
const authority = {
  projectId: "project-1",
  constructionEnterpriseAssignmentId: "assignment-1",
  category: "assigned_management_salary" as const,
  governedSubjectKey: "construction_enterprise_assigned_wage/project-1/assignment-1/authority-1/2026-08-01/person:user-1",
  authoritativeGrossCapCents: 12345n,
  currencyCode: "CNY",
  authorityVersionId: "authority-1",
  authoritySnapshotRef: "acv_snapshot",
  sourceDiscriminator: "construction_enterprise_assigned_wage" as const,
  coverageKind: "PERSON" as const,
  coverageKey: "person:user-1",
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  authorityFingerprint: "a".repeat(64),
  authorityLineId: "line-1",
  authorityLineFingerprint: "d".repeat(64),
  personAuthorityKey: "user-1"
};

function harness() {
  const tx = {
    operatingTakeoverCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => data)
    },
    operatingTakeoverManifestVersion: {
      create: jest.fn().mockImplementation(({ data }) => data)
    },
    operatingTakeoverRowMapping: {
      create: jest.fn().mockImplementation(({ data }) => data)
    },
    operatingTakeoverCommandReceiptLine: {
      create: jest.fn().mockImplementation(({ data }) => data)
    },
    operatingTakeoverLegacySourceBridge: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => data)
    },
    wagePersonLine: { findFirst: jest.fn().mockResolvedValue(null) },
    projectUpstreamFundFact: { findUnique: jest.fn() },
    operatingFact: { findUnique: jest.fn() }
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) };
  const authorities = {
    resolveCaseSelection: jest.fn().mockResolvedValue(authority),
    revalidateResolvedAuthority: jest.fn().mockResolvedValue(authority)
  };
  const clearing = { planHistoricalImport: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const service = new OperatingTakeoverCoordinatorService(
    prisma as never,
    roles as never,
    authorities as never,
    clearing as never,
    new ConstructionEnterpriseClearingAdapter(),
    audit as never
  );
  return { service, tx, prisma, authorities, clearing };
}

function formalMapping() {
  return {
    id: "mapping-1",
    projectId: "project-1",
    rowNo: 1,
    sourceType: "construction_enterprise_takeover_selection",
    sourceBusinessId: "source-1",
    sourceVersion: 1,
    sourceFingerprint: "b".repeat(64),
    sourceCoordinate: "authority:row-1",
    normalizedRowHash: "c".repeat(64),
    amountCents: 12345n,
    evidenceLevel: "A",
    coverageKind: "PERSON",
    coverageKey: "person:user-1",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    entryKind: "formal",
    mappingDecision: "FORMAL",
    conflictGroupKey: "project-1|PERSON|person:user-1|2026-08-01",
    sourceDiscriminator: authority.sourceDiscriminator,
    governedSubjectKey: authority.governedSubjectKey,
    authorityCategory: authority.category,
    authoritySnapshotRef: authority.authoritySnapshotRef,
    authorityFingerprint: authority.authorityFingerprint,
    authorityVersionId: authority.authorityVersionId,
    authorityLineId: authority.authorityLineId,
    authorityLineFingerprint: authority.authorityLineFingerprint,
    obligationId: null,
    authoritativeGrossCapCents: authority.authoritativeGrossCapCents,
    currencyCode: authority.currencyCode,
    authoritySnapshot: {
      constructionEnterpriseAssignmentId: authority.constructionEnterpriseAssignmentId,
      personAuthorityKey: authority.personAuthorityKey
    },
    legacySourceSnapshot: { businessReason: "历史工资依据归集" },
    readSetSnapshot: {},
    mappingFingerprint: "e".repeat(64)
  };
}

function manifestWith(rows: ReturnType<typeof formalMapping>[]) {
  const readSet = createHash("sha256")
    .update(`[${rows.map((row) => `{"authorityFingerprint":"${row.authorityFingerprint}","mappingFingerprint":"${row.mappingFingerprint}","sourceFingerprint":"${row.sourceFingerprint}"}`).join(",")}]`)
    .digest("hex");
  return {
    id: "manifest-1",
    projectId: "project-1",
    permissionSnapshotFingerprint: "f".repeat(64),
    readSetFingerprint: readSet,
    rows
  };
}

describe("OperatingTakeoverCoordinatorService", () => {
  it("accepts only the short-lived selectionRef contract and freezes server-derived authority in a manifest", async () => {
    const { service, tx, authorities } = harness();
    const result = await service.createManifest("project-1", "finance-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 0,
      rows: [{
        kind: "assigned_wage",
        selectionRef: "fac1.short-lived",
        period: "2026-08",
        businessReason: "历史工资依据归集"
      }]
    });

    expect(authorities.resolveCaseSelection).toHaveBeenCalledWith(
      "finance-1",
      expect.objectContaining({ selectionRef: "fac1.short-lived" }),
      "assigned_management_salary",
      tx
    );
    expect(tx.operatingTakeoverManifestVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        mapperName: "construction-enterprise-clearing",
        permissionSnapshotFingerprint: expect.any(String)
      })
    });
    expect(tx.operatingTakeoverRowMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authoritySnapshotRef: "acv_snapshot",
        authorityFingerprint: "a".repeat(64),
        authoritativeGrossCapCents: 12345n,
        sourceDiscriminator: "construction_enterprise_assigned_wage"
      })
    });
    expect(result).toEqual(expect.objectContaining({ status: "prepared", rowCount: 1 }));
  });

  it("makes inactive apply an append-only receipt with no Clearing planner call", async () => {
    const { service, tx, clearing, authorities } = harness();
    const manifest = {
      id: "manifest-1",
      projectId: "project-1",
      permissionSnapshotFingerprint: "will-be-replaced",
      readSetFingerprint: "read-set",
      rows: []
    };
    const fingerprint = createHash("sha256").update('{"action":"clearing.prepare","projectId":"project-1","roles":["finance_director"]}').digest("hex");
    manifest.permissionSnapshotFingerprint = fingerprint;
    manifest.readSetFingerprint = createHash("sha256").update("[]").digest("hex");
    tx.operatingTakeoverManifestVersion = { findUnique: jest.fn().mockResolvedValue(manifest) } as never;

    const result = await service.apply("project-1", "manifest-1", "finance-1", {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 1
    });

    expect(result).toEqual(expect.objectContaining({ status: "inactive_applied", ledgerMutation: false }));
    expect(clearing.planHistoricalImport).not.toHaveBeenCalled();
    expect(authorities.revalidateResolvedAuthority).not.toHaveBeenCalled();
    expect(tx.operatingTakeoverCommandReceipt.create).toHaveBeenCalled();
  });

  it("binds every manifest command to the route project", async () => {
    const { service, tx } = harness();
    tx.operatingTakeoverManifestVersion = {
      findUnique: jest.fn().mockResolvedValue(manifestWith([]))
    } as never;

    await expect(service.apply("project-2", "manifest-1", "finance-1", {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 1
    })).rejects.toThrow("不属于当前项目");
  });

  it("lets ClearingModule create the formal event during activation", async () => {
    const { service, tx, clearing } = harness();
    const row = formalMapping();
    tx.operatingTakeoverManifestVersion = {
      findUnique: jest.fn().mockResolvedValue(manifestWith([row]))
    } as never;
    clearing.planHistoricalImport.mockResolvedValue({ versionId: "clearing-version-1" });

    const result = await service.activate("project-1", "manifest-1", "finance-1", {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      expectedRevision: 1
    });

    expect(result).toEqual(expect.objectContaining({ status: "activated", formalCount: 1 }));
    expect(clearing.planHistoricalImport).toHaveBeenCalledWith(tx, expect.objectContaining({
      mappingId: "mapping-1",
      entryKind: "original",
      amountCents: 12345n
    }));
    expect(tx.operatingTakeoverLegacySourceBridge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetRef: "clearing-version-1", mappingDecision: "FORMAL" })
    });
    expect(tx.operatingTakeoverCommandReceiptLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetRef: "clearing-version-1", reversesLineId: null })
    });
  });

  it("compensates activation in reverse causal order and links receipt lines", async () => {
    const { service, tx, clearing } = harness();
    const row = formalMapping();
    tx.operatingTakeoverManifestVersion = {
      findUnique: jest.fn().mockResolvedValue(manifestWith([row]))
    } as never;
    const activation = {
      id: "activation-1",
      manifestVersionId: "manifest-1",
      action: "manifest.activate",
      status: "activated",
      lines: [{ id: "activation-line-1", rowMappingId: "mapping-1", decision: "FORMAL", targetRef: "clearing-version-1", causalOrdinal: 1 }]
    };
    tx.operatingTakeoverCommandReceipt.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === activation.id ? activation : null));
    clearing.planHistoricalImport.mockResolvedValue({ versionId: "compensation-version-1" });

    const result = await service.compensateActivation("project-1", "manifest-1", "finance-1", {
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      expectedRevision: 2,
      activationReceiptId: activation.id
    });

    expect(result).toEqual(expect.objectContaining({ status: "compensated", compensationCount: 1 }));
    expect(clearing.planHistoricalImport).toHaveBeenCalledWith(tx, expect.objectContaining({
      entryKind: "reversal",
      adjustsEventVersionId: "clearing-version-1"
    }));
    expect(tx.operatingTakeoverCommandReceiptLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reversesLineId: "activation-line-1" })
    });
  });

  it("bridges an exact legacy deduction through ClearingModule without duplicating its source fact", async () => {
    const { service, tx, clearing } = harness();
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
    const row = {
      ...formalMapping(),
      sourceType: source.sourceType,
      sourceBusinessId: source.sourceBusinessId,
      sourceVersion: source.sourceVersion,
      sourceFingerprint: source.sourceFingerprint,
      sourceCoordinate: source.sourceCoordinate,
      normalizedRowHash: source.normalizedRowHash
    };
    tx.operatingTakeoverManifestVersion = {
      findUnique: jest.fn().mockResolvedValue(manifestWith([row]))
    } as never;
    tx.projectUpstreamFundFact.findUnique.mockResolvedValue(legacy);
    tx.operatingFact.findUnique.mockResolvedValue({
      id: "operating-fact-1",
      projectId: "project-1",
      sourceType: source.sourceType,
      sourceBusinessId: source.sourceBusinessId,
      sourceVersion: source.sourceVersion,
      factKind: "construction_enterprise_deduction",
      entryKind: "original",
      amountCents: 12345n,
      status: "confirmed",
      affiliateAssignmentId: "assignment-1",
      affiliateBusinessPartyVersionId: "business-version-1",
      impacts: [],
      clearingImpactLinks: []
    });
    clearing.planHistoricalImport.mockResolvedValue({ versionId: "clearing-version-1" });

    const result = await service.activate("project-1", "manifest-1", "finance-1", {
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
      expectedRevision: 1
    });

    expect(result).toEqual(expect.objectContaining({ status: "activated", formalCount: 1 }));
    expect(clearing.planHistoricalImport).toHaveBeenCalledWith(tx, expect.objectContaining({
      sourceType: source.sourceType,
      sourceBusinessId: source.sourceBusinessId,
      existingOperatingFactId: "operating-fact-1"
    }));
    expect(tx.operatingTakeoverLegacySourceBridge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceType: source.sourceType, sourceBusinessId: source.sourceBusinessId })
    });
  });
});
