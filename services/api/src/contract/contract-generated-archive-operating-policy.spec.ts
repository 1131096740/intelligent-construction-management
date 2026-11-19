import { Prisma } from "@prisma/client";
import { ServiceUnavailableException } from "@nestjs/common";
import { ContractOperatingSourceAdapter } from "./contract-operating-source.adapter";
import { readQualifiedGeneratedUpwardReference, type GeneratedUpwardOperatingActivation } from "./contract-generated-upward-operating";
import * as persistentArchive from "./contract-v2-archive-persistent-proof";
import { ContractVersionActivationService } from "./contract-version-activation.service";
import { readGeneratedArchiveOperatingPolicy } from "./contract-generated-archive-operating-policy";

const FullDecimal = Prisma.Decimal.clone({ precision: 60 });
const confirmedAt = new Date("2026-11-08T16:01:00.000Z");
const ids = { project: "project", contract: "contract", version: "version", archive: "archive" };
const creditorSnapshot = { name: "纸面供应商", unifiedSocialCreditCode: "CREDIT-B" };
const enterprise = {
  domain: "project_affiliate_assignment", assignmentId: "assignment", businessPartyId: "enterprise",
  businessPartyVersionId: "enterprise-v1", partySnapshotId: "enterprise-row", roleKey: "party_b", displayOrder: 0
};
const company = {
  domain: "company_entity_version", id: "company-v1", companyEntityId: "company",
  roleKey: "party_a", displayOrder: 0, projectParticipatingCompanyId: "joined", joinedCompanyEntityVersionId: "company-v0"
};

function fixture(options: { relationship?: "outside" | "upward"; paper?: boolean; amount?: string | null; excluded?: string } = {}) {
  const { relationship = "outside", paper = true, amount = "123.4567", excluded = "0.0000" } = options;
  const amountState = amount === null ? "unknown" : "known";
  const net = amount === null ? null : new FullDecimal(amount).minus(excluded).toFixed(4);
  const parties = [
    { id: enterprise.partySnapshotId, roleKey: "party_b", displayOrder: 0, businessPartyVersionId: enterprise.businessPartyVersionId,
      snapshot: { name: "施工企业", unifiedSocialCreditCode: "CREDIT-A" } },
    ...(relationship === "outside" ? [{ id: "downstream-row", roleKey: "party_a", displayOrder: 0,
      businessPartyVersionId: paper ? null : "vendor-v1", snapshot: creditorSnapshot }] : [])
  ];
  const signingIdentity = relationship === "outside"
    ? { protocolVersion: 1, relationship, roleSource: "document_party_snapshots", enterprise,
      downstream: { domain: paper ? "contract_party_snapshot" : "business_party_version",
        businessPartyId: paper ? null : "vendor", businessPartyVersionId: paper ? null : "vendor-v1",
        partySnapshotId: "downstream-row", roleKey: "party_a", displayOrder: 0 } }
    : { protocolVersion: 1, relationship, roleSource: "document_company_selection_party_a_and_assignment_party_b", enterprise, company };
  const archiveBasis = {
    basisProtocolVersion: 1,
    sourceLocator: { projectId: ids.project, contractId: ids.contract, contractVersionId: ids.version,
      sourceType: "contract_version", sourceBusinessId: ids.version, sourceVersion: 1, versionNo: 1,
      entryKind: "original", changeType: "original", formalCode: "HT-001" },
    businessTime: { archivedAt: confirmedAt.toISOString(), businessDay: "2026-11-09", handlerUserId: "contract-staff" },
    subjects: { signingIdentity, parties },
    money: { numericProtocolVersion: 2, amountCents: null, amountYuan: amount, amountState,
      amountLimitType: amount === null ? "uncapped" : "capped", pricingNature: "framework", amountSource: "manual",
      ...(relationship === "outside" ? { commitmentDeltaYuan: net, direction: net === null ? "notice" : "increase",
        economicExcludedYuan: excluded, economicReviewSources: excluded === "0.0000" ? [] : [{
          reviewId: "review", revision: 1, confirmedAt: "2026-11-08T16:00:00.000Z",
          leftSourceRef: "contract:contract", rightSourceRef: "affiliate:other",
          frozenDocument: { ref: "contract:contract", version: "version:3" },
          coverage: [{ numericProtocolVersion: 2, owner: "right", leftAmountCents: null, rightAmountCents: null,
            leftAmountYuan: excluded, rightAmountYuan: "10.0000" }]
        }] } : {}) }
  };
  const expectedSource = relationship === "outside" ? {
    sourceType: "contract_version", sourceBusinessId: ids.version, sourceVersion: 1, entryKind: "original",
    factIdempotencyKey: "contract_version:version", impactIdempotencyKey: "contract_version:version:commitment",
    sourceImpactKey: "contract_commitment_reference", impactKind: "contract_commitment_reference",
    numericProtocolVersion: 2, amountState, amountYuan: net, direction: net === null ? "notice" : "increase", sourceBasisSha256: "b".repeat(64)
  } : null;
  return {
    contract: { id: ids.contract, projectId: ids.project, code: "HT-001", ownerUserId: "contract-staff",
      companyEntityId: relationship === "outside" ? null : "company", voidedAt: null },
    version: { id: ids.version, contractId: ids.contract, versionNo: 1, changeType: "original", status: "effective", supersedesVersionId: null,
      firstSubmittedAt: new Date("2026-11-07T16:01:00.000Z"), numericProtocolVersion: 2, effectiveAt: confirmedAt,
      taxFactsFrozenAt: confirmedAt, amountYuan: amount === null ? null : new Prisma.Decimal(amount),
      amountLimitType: amount === null ? "uncapped" : "capped", pricingNature: "framework", amountSource: "manual",
      signingSubjectType: relationship === "outside" ? "affiliate" : "upward",
      affiliateAssignmentId: "assignment", affiliateBusinessPartyVersionId: "enterprise-v1", affiliateNameSnapshot: "施工企业",
      affiliateCreditCodeSnapshot: "CREDIT-A", companyEntityIdSnapshot: relationship === "outside" ? null : "company",
      companyEntityVersionId: relationship === "outside" ? null : "company-v1", companyEntityNameSnapshot: relationship === "outside" ? null : "我方公司",
      draftRevision: 2, documentContentRevision: 3, documentContentFingerprint: "d".repeat(64),
      readinessSnapshot: JSON.parse(JSON.stringify({ signingIdentity, parties })) as Prisma.JsonValue },
    archive: { id: ids.archive, contractVersionId: ids.version, archiveProtocolVersion: 2, archiveSource: "generated_approval",
      status: "confirmed", fileId: null, uploadedByUserId: "contract-staff", confirmedByUserId: "contract-staff", confirmedAt,
      requestSha256: "e".repeat(64), authoritySha256: "a".repeat(64), sourceRevision: 2,
      documentContentRevision: 3, documentContentFingerprint: "d".repeat(64), approvalInstanceId: "round", sealTaskId: "seal",
      authoritySnapshot: {
        authorityProtocolVersion: 1, projectId: ids.project, contractId: ids.contract, contractVersionId: ids.version,
        archiveSource: "generated_approval", handlerUserId: "contract-staff", archivedAt: confirmedAt.toISOString(),
        requestSha256: "e".repeat(64), sourceRevision: 2, documentContentRevision: 3, documentContentFingerprint: "d".repeat(64),
        approvalInstanceId: "round", sealTaskId: "seal", sourceBasisSha256: "b".repeat(64), sourceBasis: archiveBasis,
        operatingConsequence: { protocolVersion: 1, mode: relationship === "outside" ? "projection_required" : "internal_reference_only",
          operatingLedgerEffectiveDateSnapshot: "2026-11-09", expectedSource }
      }
    }
  };
}

describe("生成审批合同的经营来源", () => {
  it("表外原件上的纸面下游可以形成唯一四位元承诺，施工企业是债务主体", () => {
    const result = readGeneratedArchiveOperatingPolicy(fixture({ excluded: "23.4567" }));
    expect(result).toMatchObject({ mode: "outside_downstream_commitment", fact: { entryKind: "original", input: {
      idempotencyKey: "contract_version:version", factKind: "downstream_contract", numericProtocolVersion: 2,
      amountCents: null, amountYuan: "100.0000", direction: "neutral", isBeforeOperatingLedgerEffectiveDate: false,
      subjects: { debtor: { kind: "construction_enterprise", id: "enterprise-v1" },
        creditor: { kind: "downstream_counterparty", id: "contract_party_snapshot:downstream-row" } },
      sourceSnapshot: { archiveAuthorityId: ids.archive, counterpartyVersionId: null, counterpartyName: "纸面供应商",
        archiveBusinessDay: "2026-11-09", economicExcludedYuan: "23.4567" },
      impacts: [{ sourceImpactKey: "contract_commitment_reference", impactKind: "contract_commitment_reference",
        amountCents: null, amountYuan: "100.0000", direction: "increase", subjectRole: "debtor" }]
    } } });
  });

  it.each([
    [null, "notice"],
    ["0.0000", "increase"],
    ["99999999999999999999.9999", "increase"]
  ])("保留原承诺 %s 的四位元状态及其影响方向", (amount, direction) => {
    const result = readGeneratedArchiveOperatingPolicy(fixture({ paper: false, amount }));
    expect(result).toMatchObject({ mode: "outside_downstream_commitment", fact: { input: {
      amountYuan: amount, subjects: { creditor: { kind: "downstream_counterparty", id: "vendor-v1" } },
      sourceSnapshot: { counterpartyVersionId: "vendor-v1" },
      impacts: [{ amountYuan: amount, direction }]
    } } });
  });

  it("合同总额未知时保留已核对的重叠金额，承诺仍为未知", () => {
    const result = readGeneratedArchiveOperatingPolicy(fixture({ amount: null, excluded: "23.4567" }));
    expect(result).toMatchObject({ mode: "outside_downstream_commitment", fact: { input: {
      amountYuan: null, sourceSnapshot: { amountState: "unknown", economicExcludedYuan: "23.4567" },
      impacts: [{ amountYuan: null, direction: "notice" }]
    } } });
  });

  it("对上仅保留我方公司和施工企业的内部往来依据", () => {
    const result = readGeneratedArchiveOperatingPolicy(fixture({ relationship: "upward" }));
    expect(result).toEqual({ mode: "upward_internal_reference", reference: {
      archiveId: ids.archive, archiveAuthoritySha256: "a".repeat(64), sourceBasisSha256: "b".repeat(64),
      projectId: ids.project, contractId: ids.contract, contractVersionId: ids.version, sourceBusinessCode: "HT-001",
      effectiveAt: confirmedAt.toISOString(), businessDay: "2026-11-09", operatingLedgerEffectiveDateSnapshot: "2026-11-09",
      contractAmountYuan: "123.4567",
      company: { id: "company", versionId: "company-v1", name: "我方公司", participationId: "joined", joinedCompanyVersionId: "company-v0" },
      enterprise: { assignmentId: "assignment", businessPartyId: "enterprise", businessPartyVersionId: "enterprise-v1",
        name: "施工企业", creditCode: "CREDIT-A" }
    } });
  });

  it("以归档冻结的经营启用日标记生效前来源，原归档从未启用时不补造经营事实", () => {
    const input = fixture();
    input.archive.authoritySnapshot.operatingConsequence.operatingLedgerEffectiveDateSnapshot = "2026-11-10";
    expect(readGeneratedArchiveOperatingPolicy(input)).toMatchObject({
      mode: "outside_downstream_commitment", fact: { input: { isBeforeOperatingLedgerEffectiveDate: true } }
    });
    expect(readGeneratedArchiveOperatingPolicy({ ...input, archive: { ...input.archive, authoritySnapshot: {
      ...input.archive.authoritySnapshot, operatingConsequence: {
        protocolVersion: 1, mode: "not_applicable", operatingLedgerEffectiveDateSnapshot: null, expectedSource: null
      }
    } } })).toBeNull();
  });

  it("原轮冻结主体换号、重名或将对上伪装为下游时拒绝", () => {
    const changed = fixture();
    const changedIdentity = changed.archive.authoritySnapshot.sourceBasis.subjects.signingIdentity;
    if (!changedIdentity.downstream) throw new Error("缺少表外测试夹具");
    changedIdentity.downstream.partySnapshotId = "another-row";
    expect(() => readGeneratedArchiveOperatingPolicy(changed)).toThrow("冻结经营依据不一致");
    const substitutedDigest = fixture();
    substitutedDigest.archive.authoritySnapshot.operatingConsequence.expectedSource!.sourceBasisSha256 = "d".repeat(64);
    expect(() => readGeneratedArchiveOperatingPolicy(substitutedDigest)).toThrow("冻结经营依据不一致");
    const identical = fixture();
    identical.archive.authoritySnapshot.sourceBasis.subjects.parties[1].snapshot = { name: "施工企业", unifiedSocialCreditCode: "CREDIT-B" };
    identical.version.readinessSnapshot = JSON.parse(JSON.stringify(identical.archive.authoritySnapshot.sourceBasis.subjects));
    expect(() => readGeneratedArchiveOperatingPolicy(identical)).toThrow("冻结经营依据不一致");
    const upward = fixture({ relationship: "upward" });
    upward.archive.authoritySnapshot.operatingConsequence.expectedSource = fixture().archive.authoritySnapshot.operatingConsequence.expectedSource;
    expect(() => readGeneratedArchiveOperatingPolicy(upward)).toThrow("冻结经营依据不一致");
  });

  it("核对履约复核版本、扣除金额与原合同上限", () => {
    const mismatch = fixture({ excluded: "23.4567" });
    mismatch.archive.authoritySnapshot.sourceBasis.money.economicReviewSources![0].frozenDocument.version = "version:2";
    expect(() => readGeneratedArchiveOperatingPolicy(mismatch)).toThrow("冻结经营依据不一致");
    const excessive = fixture({ amount: "10.0000", excluded: "20.0000" });
    expect(() => readGeneratedArchiveOperatingPolicy(excessive)).toThrow("冻结经营依据不一致");
    const inconsistent = fixture({ excluded: "23.4567" });
    inconsistent.archive.authoritySnapshot.sourceBasis.money.economicExcludedYuan = "0.0000";
    expect(() => readGeneratedArchiveOperatingPolicy(inconsistent)).toThrow("冻结经营依据不一致");
  });
});


function activationFixture(relationship: "outside" | "upward" = "upward") {
  const input = fixture({ relationship });
  const update = jest.fn().mockResolvedValue(input.version);
  const tx = {
    contractArchiveFile: { findUnique: jest.fn().mockResolvedValue(input.archive) },
    contractVersion: { findUniqueOrThrow: jest.fn().mockResolvedValue({
      ...input.version, status: "seal_approved_pending_archive", effectiveAt: null, taxFactsFrozenAt: null
    }), update },
    paymentTermsVersion: { updateMany: jest.fn() },
    contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(input.contract) },
    project: { findUniqueOrThrow: jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date("2026-11-09") }) },
    operatingFact: { count: jest.fn().mockResolvedValue(0) },
    operatingImpactEntry: { count: jest.fn().mockResolvedValue(0) }
  };
  const append = jest.fn();
  const activate = (authority?: GeneratedUpwardOperatingActivation) =>
    new ContractVersionActivationService({ appendConfirmedSourceIfEnabledInTransaction: append }, authority)
      .activateArchivedV2(tx as never, input.version.id, "contract-staff", confirmedAt, input.archive.id);
  return { tx, append, activate };
}

describe("生成对上合同经营接线", () => {
  it("经营已启用但缺少原生见证时在生效写入前关闭", async () => {
    const { tx, append, activate } = activationFixture();
    await expect(activate()).rejects.toThrow("生成合同经营依据尚未核对");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("同一归档事务收到准确的对上见证后推进生效，不追加下游事实", async () => {
    const { tx, append, activate } = activationFixture();
    const authority: GeneratedUpwardOperatingActivation = {
      readBeforeActivation: async (transaction, binding) => {
        expect(binding).toMatchObject({ mode: "internal_reference_only", archiveId: ids.archive,
          contractVersionId: ids.version, operatingLedgerEffectiveDateSnapshot: "2026-11-09" });
        return { transaction, binding };
      }
    };
    await activate(authority);
    expect(tx.contractVersion.update).toHaveBeenCalledWith({ where: { id: ids.version },
      data: { status: "effective", effectiveAt: confirmedAt, taxFactsFrozenAt: confirmedAt } });
    expect(tx.operatingFact.count).toHaveBeenCalledTimes(2);
    expect(tx.operatingImpactEntry.count).toHaveBeenCalledTimes(2);
    expect(append).not.toHaveBeenCalled();
  });

  it("拒绝另一事务或错误归档标识见证，表外也不沿对上分支通过", async () => {
    const { tx, append, activate } = activationFixture();
    await expect(activate({ readBeforeActivation: async (_transaction, binding) =>
      ({ transaction: {} as never, binding }) })).rejects.toThrow("生成合同经营依据尚未核对");
    await expect(activate({ readBeforeActivation: async (transaction, binding) =>
      ({ transaction, binding: { ...binding, archiveId: "another" } }) })).rejects.toThrow("生成合同经营依据尚未核对");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();

    const outside = activationFixture("outside");
    const notCalled = jest.fn();
    await expect(outside.activate({ readBeforeActivation: notCalled })).rejects.toThrow("生成合同经营依据尚未核对");
    expect(notCalled).not.toHaveBeenCalled();
    expect(outside.tx.contractVersion.update).not.toHaveBeenCalled();
    expect(outside.append).not.toHaveBeenCalled();
  });

  it("原键持久完成证据通过后才从逐源重放和项目期望事实排除对上", async () => {
    const input = fixture({ relationship: "upward" });
    const tx = {
      contractArchiveFile: { findFirst: jest.fn().mockImplementation(async ({ where }: { where: { archiveSource?: string } }) =>
        where.archiveSource === "direct_signed" ? null : input.archive) },
      contractVersion: { findUnique: jest.fn().mockResolvedValue(input.version), findUniqueOrThrow: jest.fn().mockResolvedValue(input.version),
        findMany: jest.fn().mockResolvedValue([input.version]) },
      contract: { findFirst: jest.fn().mockResolvedValue(input.contract), findUniqueOrThrow: jest.fn().mockResolvedValue(input.contract),
        findMany: jest.fn().mockResolvedValue([input.contract]) },
      operatingFact: { count: jest.fn().mockResolvedValue(0) },
      operatingImpactEntry: { count: jest.fn().mockResolvedValue(0) }
    };
    const adapter = new ContractOperatingSourceAdapter();
    const locator = { projectId: ids.project, sourceType: "contract_version", sourceBusinessId: ids.version };
    const proof = jest.spyOn(persistentArchive, "assertContractV2ArchivePersistentProof").mockResolvedValue({} as never);
    try {
      await expect(adapter.readSourceSnapshot(tx as never, locator)).resolves.toBeNull();
      await expect(adapter.readProjectSnapshots(tx as never, ids.project)).resolves.toEqual([]);
      await expect(readQualifiedGeneratedUpwardReference(tx as never, input.contract as never, input.version as never, input.archive as never))
        .resolves.toMatchObject({ company: { name: "我方公司" }, enterprise: { name: "施工企业" } });
      expect(proof).toHaveBeenCalledTimes(3);
      proof.mockRejectedValueOnce(new ServiceUnavailableException("归档持久结果尚未核对"));
      await expect(adapter.readSourceSnapshot(tx as never, locator)).rejects.toThrow("归档持久结果尚未核对");
      tx.operatingFact.count.mockResolvedValueOnce(1);
      await expect(adapter.readProjectSnapshots(tx as never, ids.project)).rejects.toThrow("生成合同经营依据尚未核对");
    } finally { proof.mockRestore(); }
  });
});
