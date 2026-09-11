import { BadRequestException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { ClearingService } from "../clearing/clearing.service";
import { FileService } from "../file/file.service";
import { ProjectFundDisputeOperatingSourceAdapter } from "../project-fund-dispute/project-fund-dispute-operating-source.adapter";
import { ProjectFundDisputeService } from "../project-fund-dispute/project-fund-dispute.service";
import { NecessaryExpenseReserveOperatingSourceAdapter } from "../necessary-expense-reserve/necessary-expense-reserve-operating-source.adapter";
import { NecessaryExpenseReserveService } from "../necessary-expense-reserve/necessary-expense-reserve.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";

const RUN_POSTGRES = process.env.RUN_POL280_PROJECT_FUND_DISPUTE_PG16 === "1";
const describePostgres = RUN_POSTGRES ? describe : describe.skip;
const PROJECT_ID = "seed-project-jgxm-001";
const ASSIGNMENT_ID = "seed-construction-enterprise-assignment-jgxm-001";
const AFFILIATE_VERSION_ID = "seed-construction-enterprise-version-jgxm-001";
const FINANCE_STAFF_ID = "seed-user-cashier";
const PROJECT_MANAGER_ID = "seed-user-project-manager";
const FINANCE_DIRECTOR_ID = "seed-user-finance-director";
const EVIDENCE_FILE_ID = "28000000-0000-4000-8000-000000000001";
const EVIDENCE_SHA256 = "a".repeat(64);
const OCCURRED_AT = "2026-09-01";

describePostgres("POL-280 project fund dispute PostgreSQL 16", () => {
  const prisma = new PrismaClient();
  const audit = new AuditService();
  const operatingLedger = new OperatingLedgerService(prisma as never);
  const adapter = new ProjectFundDisputeOperatingSourceAdapter();
  const necessaryAdapter = new NecessaryExpenseReserveOperatingSourceAdapter();
  const registry = new OperatingSourceAdapterRegistry(
    [adapter, necessaryAdapter],
    [adapter.sourceType, necessaryAdapter.sourceType]
  );
  const replay = new OperatingSourceReplayService(prisma as never, operatingLedger, registry);
  const roleResolver = new CompanyRoleResolverService(prisma as never);
  const clearingReconciliation = new ClearingReconciliationReaderService(
    prisma as never,
    roleResolver
  );
  const clearing = new ClearingService(
    prisma as never,
    roleResolver,
    operatingLedger,
    audit
  );
  const files = new FileService(prisma as never, audit);
  const service = new ProjectFundDisputeService(
    prisma as never,
    replay,
    audit,
    clearingReconciliation,
    files
  );
  const necessaryService = new NecessaryExpenseReserveService(prisma as never, replay, audit);
  const operatingProfile = new ProjectOperatingProfileService(prisma as never, audit);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
      throw new Error("POL-280 PG16 测试必须连接非生产 disposable database");
    }
    const writeSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!writeSecret) {
      throw new Error("POL-280 PG16 测试缺少一次性经营账写入密钥");
    }
    await prisma.$connect();
    await prisma.$executeRaw`
      INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, crypt(${writeSecret}, gen_salt('bf')))
      ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
    `;
    await operatingProfile.updateProfile(PROJECT_ID, FINANCE_STAFF_ID, {
      operatingLedgerEffectiveDate: "2026-08-01"
    });
    await prisma.fileObject.create({
      data: {
        id: EVIDENCE_FILE_ID,
        bucket: "private-local",
        objectKey: `pol280/${EVIDENCE_FILE_ID}.pdf`,
        originalName: "pol280-evidence.pdf",
        mimeType: "application/pdf",
        sizeBytes: 280,
        uploadedByUserId: FINANCE_STAFF_ID,
        contentSha256: EVIDENCE_SHA256
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("通过公开业务缝完成职责分离确认，且只写入资金限制影响", async () => {
    await expect(service.saveDraft(draftCommand({
      businessCode: "POL280-PG-FIRST-APP",
      basis: "1".repeat(64),
      amountCents: 1n,
      entryKind: "increase"
    }), { userId: FINANCE_STAFF_ID })).rejects.toThrow(/首笔分录必须先建立争议/u);

    const rawDisputeId = randomUUID();
    const rawEconomicIdentity = createHash("sha256").update(`economic:${rawDisputeId}`).digest("hex");
    const rawSourceIdentity = createHash("sha256").update(`source:${rawDisputeId}`).digest("hex");
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectFundDispute" (
        "id", "projectId", "businessCode", "affiliateAssignmentId",
        "affiliateBusinessPartyVersionId", "affiliateNameSnapshot",
        "affiliateCreditCodeSnapshot", "fundHolderKind", "fundHolderId",
        "disputeKind", "counterpartyKind", "counterpartyId", "counterpartyNameSnapshot",
        "basisKind", "basisBusinessIdOrEvidenceSha256",
        "referenceCode", "economicIdentityKey", "sourceIdentityKey",
        "createdByUserId", "updatedAt"
      ) VALUES (
        ${rawDisputeId}, ${PROJECT_ID}, ${`POL280-RAW-${rawDisputeId}`}, ${ASSIGNMENT_ID},
        ${AFFILIATE_VERSION_ID}, '示例施工企业', '91310000SEEDBUILD01',
        'construction_enterprise', ${AFFILIATE_VERSION_ID}, 'upstream',
        'owner', 'owner-raw', '数据库首笔顺序保护',
        'written_evidence', ${"2".repeat(64)}, '数据库动态守卫',
        ${rawEconomicIdentity}, ${rawSourceIdentity}, ${FINANCE_STAFF_ID}, NOW()
      )
    `);
    await expect(prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectFundDisputeEntry" (
        "id", "disputeId", "sequenceNo", "entryKind", "amountCents", "occurredAt",
        "disputeSummary", "evidenceLevel", "evidenceFileId", "evidenceSha256", "fingerprint",
        "idempotencyKey", "preparedByUserId", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${rawDisputeId}, 1, 'increase', 1, ${new Date(`${OCCURRED_AT}T00:00:00.000Z`)},
        '非法首笔增加', 'A', ${EVIDENCE_FILE_ID}, ${EVIDENCE_SHA256}, ${"3".repeat(64)},
        ${randomUUID()}, ${FINANCE_STAFF_ID}, NOW()
      )
    `)).rejects.toThrow(/first dispute entry must establish/u);

    const unconfirmedEstablishment = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-PENDING-ESTABLISH",
      basis: "4".repeat(64),
      amountCents: 100n
    }), { userId: FINANCE_STAFF_ID });
    await expect(service.saveDraft(draftCommand({
      businessCode: "POL280-PG-PENDING-ESTABLISH",
      basis: "4".repeat(64),
      amountCents: 10n,
      disputeId: unconfirmedEstablishment.disputeId,
      entryKind: "increase"
    }), { userId: FINANCE_STAFF_ID })).rejects.toThrow(/建立分录确认后才能追加增加/u);

    const confirmed = await createAndConfirmEstablishment("POL280-PG-001", "b".repeat(64), 120_000n);
    const sameEvidenceIncrease = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-001",
      basis: "b".repeat(64),
      amountCents: 1_000n,
      disputeId: confirmed.disputeId,
      entryKind: "increase",
      evidenceFileId: confirmed.evidenceFileId,
      evidenceSha256: confirmed.evidenceSha256
    }), { userId: FINANCE_STAFF_ID });
    const sameEvidenceSubmitted = await transition(sameEvidenceIncrease, "submit", FINANCE_STAFF_ID);
    const sameEvidenceAttested = await transition(sameEvidenceSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(sameEvidenceAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);
    await expect(prisma.operatingFact.count({
      where: {
        sourceType: "project_fund_dispute_entry",
        sourceBusinessId: sameEvidenceIncrease.id
      }
    })).resolves.toBe(0);

    const increaseEvidence = await createEvidenceFixture("POL280-PG-001-increase");
    const increased = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-001",
      basis: "b".repeat(64),
      amountCents: 5_000n,
      disputeId: confirmed.disputeId,
      entryKind: "increase",
      ...increaseEvidence
    }), { userId: FINANCE_STAFF_ID });
    expect(increased).toMatchObject({
      entryKind: "increase",
      status: "draft"
    });
    const increasedSubmitted = await transition(increased, "submit", FINANCE_STAFF_ID);
    const increasedAttested = await transition(increasedSubmitted, "attest", PROJECT_MANAGER_ID);
    const increasedConfirmed = await transition(increasedAttested, "confirm", FINANCE_DIRECTOR_ID);
    expect(increasedConfirmed).toMatchObject({ status: "confirmed" });
    await expect(prisma.operatingFact.findUnique({
      where: {
        sourceType_sourceBusinessId: {
          sourceType: "project_fund_dispute_entry",
          sourceBusinessId: increased.id
        }
      },
      include: { impacts: true }
    })).resolves.toMatchObject({
      amountCents: 5_000n,
      impacts: [expect.objectContaining({
        impactKind: "project_disputed_funds_increase",
        amountCents: 5_000n
      })]
    });
    const fact = await prisma.operatingFact.findUniqueOrThrow({
      where: {
        sourceType_sourceBusinessId: {
          sourceType: "project_fund_dispute_entry",
          sourceBusinessId: confirmed.id
        }
      },
      include: { impacts: true }
    });

    expect(fact).toMatchObject({
      status: "confirmed",
      factKind: "project_cash_restriction",
      direction: "neutral",
      amountCents: 120_000n
    });
    expect(fact.impacts).toEqual([
      expect.objectContaining({
        impactKind: "project_disputed_funds_increase",
        direction: "increase",
        subjectRole: "fund_holder",
        subjectKind: "construction_enterprise",
        subjectId: AFFILIATE_VERSION_ID,
        amountCents: 120_000n
      })
    ]);
    expect(fact.impacts.some((impact) =>
      ["confirmed_cost", "payable_increase", "funds_increase", "funds_decrease"]
        .includes(impact.impactKind)
    )).toBe(false);

    const repeated = await service.transition({
      entryId: confirmed.id,
      action: "confirm",
      expectedRevision: confirmed.revision,
      expectedFingerprint: confirmed.fingerprint,
      idempotencyKey: confirmed.confirmIdempotencyKey
    }, { userId: FINANCE_DIRECTOR_ID });
    expect(repeated.status).toBe("confirmed");
    await expect(prisma.operatingFact.count({
      where: { sourceType: "project_fund_dispute_entry", sourceBusinessId: confirmed.id }
    })).resolves.toBe(1);
  });

  it("允许唯一退回草稿修改说明，但数据库冻结经济身份和在途说明", async () => {
    const basis = "c".repeat(64);
    const draft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-EDIT",
      basis,
      amountCents: 30_000n
    }), { userId: FINANCE_STAFF_ID });
    await expect(prisma.projectFundDispute.update({
      where: { id: draft.disputeId },
      data: { businessCode: "ILLEGAL-IDENTITY-CHANGE" }
    })).rejects.toThrow(/dispute root identity is immutable/u);

    const edited = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-EDIT",
      basis,
      amountCents: 30_000n,
      disputeId: draft.disputeId,
      entryId: draft.id,
      expectedRevision: draft.revision,
      counterpartyNameSnapshot: "经退回前可修订的收尾事项",
      referenceCode: "唯一草稿的说明修订"
    }), { userId: FINANCE_STAFF_ID });
    const submitted = await transition(edited, "submit", FINANCE_STAFF_ID);
    await expect(prisma.projectFundDispute.update({
      where: { id: draft.disputeId },
      data: { counterpartyNameSnapshot: "ILLEGAL-IN-FLIGHT-CHANGE" }
    })).rejects.toThrow(/description is frozen/u);
    const returned = await transition(submitted, "return", FINANCE_DIRECTOR_ID, "依据需要补充");
    await expect(service.saveDraft(draftCommand({
      businessCode: "POL280-PG-EDIT",
      basis,
      amountCents: 31_000n,
      disputeId: draft.disputeId,
      entryId: draft.id,
      expectedRevision: returned.revision,
      counterpartyNameSnapshot: "补充依据后的收尾事项",
      referenceCode: "退回后修订"
    }), { userId: FINANCE_STAFF_ID })).resolves.toMatchObject({ revision: 3, status: "draft" });
  });

  it("在并发释放时保持余额非负，并拒绝剩余额不足的全额技术冲销", async () => {
    const original = await createAndConfirmEstablishment("POL280-PG-CAP", "d".repeat(64), 1_000n);
    const first = await prepareAdjustment(original, "release", 700n);
    const second = await prepareAdjustment(original, "release", 700n);
    const results = await Promise.allSettled([
      transition(first, "confirm", FINANCE_DIRECTOR_ID),
      transition(second, "confirm", FINANCE_DIRECTOR_ID)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")?.reason)
      .toMatchObject({ status: 409 });
    await expect(prisma.projectFundDisputeEntry.aggregate({
      where: { adjustsEntryId: original.id, status: "confirmed" },
      _sum: { amountCents: true }
    })).resolves.toMatchObject({ _sum: { amountCents: 700n } });

    const reversal = await prepareAdjustment(original, "technical_reversal", 1_000n);
    await expect(transition(reversal, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/并发或容量校验冲突/u);

    const exactOriginal = await createAndConfirmEstablishment(
      "POL280-PG-REVERSAL",
      "7".repeat(64),
      880n
    );
    const exactReversalDraft = await prepareAdjustment(
      exactOriginal,
      "technical_reversal",
      880n
    );
    const exactReversal = await transition(
      exactReversalDraft,
      "confirm",
      FINANCE_DIRECTOR_ID
    );
    const [originalFact, reversalFact] = await Promise.all([
      prisma.operatingFact.findUniqueOrThrow({
        where: {
          sourceType_sourceBusinessId: {
            sourceType: "project_fund_dispute_entry",
            sourceBusinessId: exactOriginal.id
          }
        },
        include: { impacts: true }
      }),
      prisma.operatingFact.findUniqueOrThrow({
        where: {
          sourceType_sourceBusinessId: {
            sourceType: "project_fund_dispute_entry",
            sourceBusinessId: exactReversal.id
          }
        },
        include: { impacts: true }
      })
    ]);
    expect(reversalFact.adjustsFactId).toBe(originalFact.id);
    expect(reversalFact.impacts[0]).toMatchObject({
      sourceImpactKey: originalFact.impacts[0]!.sourceImpactKey,
      impactKind: "project_disputed_funds_increase",
      direction: "decrease",
      impactSnapshot: originalFact.impacts[0]!.impactSnapshot
    });
  });

  it("替代关联只接受已确认正式扣减，并对 #279/#275 及其他正式资金来源执行跨来源阻断", async () => {
    const original = await createAndConfirmEstablishment("POL280-PG-REPLACE", "e".repeat(64), 500n);
    const replacementImpact = await appendConfirmedCostImpact(200n);
    const oversizedRelease = await prepareAdjustment(original, "release", 201n);
    const confirmedOversizedRelease = await transition(
      oversizedRelease,
      "confirm",
      FINANCE_DIRECTOR_ID
    );
    await expect(prisma.projectFundDisputeReplacement.create({
      data: {
        disputeEntryId: confirmedOversizedRelease.id,
        operatingImpactEntryId: replacementImpact.id,
        amountCents: 201n
      }
    })).rejects.toThrow(/replacement allocation exceeds formal impact amount/u);

    const crossReplacementEvidence = await createEvidenceFixture(
      "POL280-PG-CROSS-REPLACEMENT-N279"
    );
    const crossCapacityImpact = await appendConfirmedCostImpact(1n);
    const crossCapacityEvidence = await createEvidenceFixture(
      "POL280-PG-CROSS-REPLACEMENT-P280"
    );
    const crossCapacityReleaseDraft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-REPLACE",
      basis: "e".repeat(64),
      amountCents: 1n,
      disputeId: original.disputeId,
      entryKind: "release",
      adjustsEntryId: original.id,
      evidenceFileId: crossCapacityEvidence.evidenceFileId,
      evidenceSha256: crossCapacityEvidence.evidenceSha256,
      resolutionBasisSummary: "跨来源容量已由争议资金释放消费",
      replacementImpacts: [{
        operatingImpactEntryId: crossCapacityImpact.id,
        amountCents: "1"
      }]
    }), { userId: FINANCE_STAFF_ID });
    const crossCapacitySubmitted = await transition(
      crossCapacityReleaseDraft,
      "submit",
      FINANCE_STAFF_ID
    );
    const crossCapacityAttested = await transition(
      crossCapacitySubmitted,
      "attest",
      PROJECT_MANAGER_ID
    );
    await transition(crossCapacityAttested, "confirm", FINANCE_DIRECTOR_ID);
    const necessaryOriginal = await necessaryService.saveDraft({
      projectId: PROJECT_ID,
      businessCode: "POL280-PG-CROSS-REPLACEMENT-N279",
      affiliateAssignmentId: ASSIGNMENT_ID,
      fundHolderKind: "construction_enterprise",
      fundHolderId: AFFILIATE_VERSION_ID,
      reasonKind: "mandatory_closeout",
      title: "跨来源替代容量验证",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: "4".repeat(64),
      basisSummary: "#279 与 #280 不得重复消费同一正式影响",
      entryKind: "establish",
      amountCents: "1",
      occurredAt: OCCURRED_AT,
      evidenceLevel: "A",
      evidenceFileId: crossReplacementEvidence.evidenceFileId,
      evidenceSha256: crossReplacementEvidence.evidenceSha256,
      reason: "建立跨来源替代容量验证",
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const necessaryOriginalSubmitted = await necessaryService.transition({
      entryId: necessaryOriginal.id,
      action: "submit",
      expectedRevision: necessaryOriginal.revision,
      expectedFingerprint: necessaryOriginal.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const necessaryOriginalAttested = await necessaryService.transition({
      entryId: necessaryOriginalSubmitted.id,
      action: "attest",
      expectedRevision: necessaryOriginalSubmitted.revision,
      expectedFingerprint: necessaryOriginalSubmitted.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: PROJECT_MANAGER_ID });
    const necessaryOriginalConfirmed = await necessaryService.transition({
      entryId: necessaryOriginalAttested.id,
      action: "confirm",
      expectedRevision: necessaryOriginalAttested.revision,
      expectedFingerprint: necessaryOriginalAttested.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_DIRECTOR_ID });
    const necessaryReleaseDraft = await necessaryService.saveDraft({
      projectId: PROJECT_ID,
      reserveId: necessaryOriginalConfirmed.reserveId,
      businessCode: "POL280-PG-CROSS-REPLACEMENT-N279",
      affiliateAssignmentId: ASSIGNMENT_ID,
      fundHolderKind: "construction_enterprise",
      fundHolderId: AFFILIATE_VERSION_ID,
      reasonKind: "mandatory_closeout",
      title: "跨来源替代容量验证",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: "4".repeat(64),
      basisSummary: "#279 与 #280 不得重复消费同一正式影响",
      entryKind: "release",
      adjustsEntryId: necessaryOriginalConfirmed.id,
      amountCents: "1",
      occurredAt: OCCURRED_AT,
      evidenceLevel: "A",
      evidenceFileId: crossReplacementEvidence.evidenceFileId,
      evidenceSha256: crossReplacementEvidence.evidenceSha256,
      reason: "正式影响已替代必要费用准备",
      replacementImpacts: [{
        operatingImpactEntryId: crossCapacityImpact.id,
        amountCents: "1"
      }],
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const necessaryReleaseSubmitted = await necessaryService.transition({
      entryId: necessaryReleaseDraft.id,
      action: "submit",
      expectedRevision: necessaryReleaseDraft.revision,
      expectedFingerprint: necessaryReleaseDraft.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const necessaryReleaseAttested = await necessaryService.transition({
      entryId: necessaryReleaseSubmitted.id,
      action: "attest",
      expectedRevision: necessaryReleaseSubmitted.revision,
      expectedFingerprint: necessaryReleaseSubmitted.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: PROJECT_MANAGER_ID });
    const crossCapacityResult = necessaryService.transition({
      entryId: necessaryReleaseAttested.id,
      action: "confirm",
      expectedRevision: necessaryReleaseAttested.revision,
      expectedFingerprint: necessaryReleaseAttested.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_DIRECTOR_ID });
    await expect(crossCapacityResult).rejects.toMatchObject({ status: 409 });
    await expect(prisma.projectNecessaryExpenseReserveReplacement.count({
      where: { operatingImpactEntryId: crossCapacityImpact.id }
    })).resolves.toBe(0);

    const runtimeOriginal = await createAndConfirmEstablishment(
      "POL280-PG-RUNTIME-REPLACEMENT",
      "0".repeat(64),
      1n
    );
    const runtimeReleasePrepared = await prepareAdjustment(
      runtimeOriginal,
      "release",
      1n
    );
    const runtimeRelease = await transition(
      runtimeReleasePrepared,
      "confirm",
      FINANCE_DIRECTOR_ID
    );
    const runtimeImpact = await appendConfirmedCostImpact(1n);
    const runtimeReplacementId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE "jg_pol280_runtime"');
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ProjectFundDisputeReplacement" (
          "id", "disputeEntryId", "operatingImpactEntryId", "amountCents"
        ) VALUES (
          ${runtimeReplacementId}, ${runtimeRelease.id}, ${runtimeImpact.id}, 1
        )
      `);
    });
    await expect(prisma.projectFundDisputeReplacement.findUnique({
      where: { id: runtimeReplacementId }
    })).resolves.toMatchObject({ amountCents: 1n });

    const releaseDraft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-REPLACE",
      basis: "e".repeat(64),
      amountCents: 200n,
      disputeId: original.disputeId,
      entryKind: "release",
      adjustsEntryId: original.id,
      resolutionBasisSummary: "争议已由正式成本结果解决",
      replacementImpacts: [{
        operatingImpactEntryId: replacementImpact.id,
        amountCents: "200"
      }]
    }), { userId: FINANCE_STAFF_ID });
    const submitted = await transition(releaseDraft, "submit", FINANCE_STAFF_ID);
    const attested = await transition(submitted, "attest", PROJECT_MANAGER_ID);
    const released = await transition(attested, "confirm", FINANCE_DIRECTOR_ID);
    await expect(prisma.projectFundDisputeReplacement.findUnique({
      where: {
        disputeEntryId_operatingImpactEntryId: {
          disputeEntryId: released.id,
          operatingImpactEntryId: replacementImpact.id
        }
      }
    })).resolves.toMatchObject({ amountCents: 200n });

    const duplicateReplacementRelease = await prepareAdjustment(original, "release", 1n);
    const confirmedDuplicateReplacementRelease = await transition(
      duplicateReplacementRelease,
      "confirm",
      FINANCE_DIRECTOR_ID
    );
    await expect(prisma.projectFundDisputeReplacement.create({
      data: {
        disputeEntryId: confirmedDuplicateReplacementRelease.id,
        operatingImpactEntryId: replacementImpact.id,
        amountCents: 1n
      }
    })).rejects.toThrow(/replacement allocation exceeds formal impact amount/u);

    const blockedDraft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-CROSS",
      basis: "f".repeat(64),
      amountCents: 77n
    }), { userId: FINANCE_STAFF_ID });
    const necessaryDraft = await necessaryService.saveDraft({
      projectId: PROJECT_ID,
      businessCode: "POL280-PG-CROSS-N279",
      affiliateAssignmentId: ASSIGNMENT_ID,
      fundHolderKind: "construction_enterprise",
      fundHolderId: AFFILIATE_VERSION_ID,
      reasonKind: "mandatory_closeout",
      title: "相同经济事项的必要费用准备",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: "f".repeat(64),
      basisSummary: "用于验证 #279 与 #280 不能重复占用项目现金",
      entryKind: "establish",
      amountCents: "77",
      occurredAt: OCCURRED_AT,
      evidenceLevel: "A",
      evidenceFileId: EVIDENCE_FILE_ID,
      evidenceSha256: EVIDENCE_SHA256,
      reason: "跨来源动态验证",
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const necessarySubmitted = await necessaryService.transition({
      entryId: necessaryDraft.id,
      action: "submit",
      expectedRevision: necessaryDraft.revision,
      expectedFingerprint: necessaryDraft.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const necessaryAttested = await necessaryService.transition({
      entryId: necessarySubmitted.id,
      action: "attest",
      expectedRevision: necessarySubmitted.revision,
      expectedFingerprint: necessarySubmitted.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: PROJECT_MANAGER_ID });
    await necessaryService.transition({
      entryId: necessaryAttested.id,
      action: "confirm",
      expectedRevision: necessaryAttested.revision,
      expectedFingerprint: necessaryAttested.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_DIRECTOR_ID });
    const blockedSubmitted = await transition(blockedDraft, "submit", FINANCE_STAFF_ID);
    const blockedAttested = await transition(blockedSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(blockedAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);

    const clearingEvidence = await createEvidenceFixture("POL280-PG-CLEARING");
    const clearingBasis = "2".repeat(64);
    const clearingCase = await clearing.createCase(FINANCE_STAFF_ID, {
      projectId: PROJECT_ID,
      constructionEnterpriseAssignmentId: ASSIGNMENT_ID,
      category: "management_fee",
      governedSubjectKey: clearingBasis,
      authoritativeGrossCapCents: "1000",
      expectedRevision: 0,
      idempotencyKey: randomUUID()
    }) as { id: string; revision: number };
    const pending = await clearing.createEvent(
      FINANCE_STAFF_ID,
      clearingCase.id,
      {
        kind: "pending_reconciliation",
        amountCents: "88",
        evidenceLevel: "A",
        businessReason: "#280 正式读取缝去重验证",
        reconciliationIntent: {
          operation: "open_item",
          itemDefinition: {
            mode: "independent",
            amountCents: "88"
          },
          coverages: []
        },
        expectedRevision: clearingCase.revision,
        idempotencyKey: randomUUID()
      }
    ) as { id: string; versionId: string; revision: number };
    const pendingDraftVersion = await prisma.clearingEventVersion.findUniqueOrThrow({
      where: { id: pending.versionId },
      select: { id: true, fingerprint: true }
    });
    const pendingSubmitted = await clearing.submitEvent(
      FINANCE_STAFF_ID,
      pending.id,
      {
        expectedRevision: pending.revision,
        eventVersionId: pendingDraftVersion.id,
        expectedFingerprint: pendingDraftVersion.fingerprint,
        idempotencyKey: randomUUID()
      }
    ) as { versionId: string; revision: number };
    const pendingSubmittedVersion = await prisma.clearingEventVersion.findUniqueOrThrow({
      where: { id: pendingSubmitted.versionId },
      select: { id: true, fingerprint: true }
    });
    const pendingCaseRevision = await prisma.clearingCase.findUniqueOrThrow({
      where: { id: clearingCase.id },
      select: { revision: true }
    });
    await clearing.confirmEvent(FINANCE_DIRECTOR_ID, pending.id, {
      expectedRevision: pendingSubmitted.revision,
      expectedCaseRevision: pendingCaseRevision.revision,
      eventVersionId: pendingSubmittedVersion.id,
      expectedFingerprint: pendingSubmittedVersion.fingerprint,
      confirmed: true,
      idempotencyKey: randomUUID()
    });
    const clearingDraft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-CLEARING-BLOCK",
      basis: clearingBasis,
      amountCents: 88n,
      ...clearingEvidence
    }), { userId: FINANCE_STAFF_ID });
    const clearingSubmitted = await transition(clearingDraft, "submit", FINANCE_STAFF_ID);
    const clearingAttested = await transition(clearingSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(clearingAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);

    const concurrentBasis = "3".repeat(64);
    const concurrentDisputeEvidence = await createEvidenceFixture(
      "POL280-PG-CROSS-CONCURRENT-DISPUTE"
    );
    const concurrentReserveEvidence = await createEvidenceFixture(
      "POL280-PG-CROSS-CONCURRENT-RESERVE"
    );
    const concurrentDisputeDraft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-CROSS-CONCURRENT",
      basis: concurrentBasis,
      amountCents: 91n,
      ...concurrentDisputeEvidence
    }), { userId: FINANCE_STAFF_ID });
    const concurrentDisputeSubmitted = await transition(
      concurrentDisputeDraft,
      "submit",
      FINANCE_STAFF_ID
    );
    const concurrentDisputeAttested = await transition(
      concurrentDisputeSubmitted,
      "attest",
      PROJECT_MANAGER_ID
    );
    const concurrentReserveDraft = await necessaryService.saveDraft({
      projectId: PROJECT_ID,
      businessCode: "POL280-PG-CROSS-CONCURRENT-N279",
      affiliateAssignmentId: ASSIGNMENT_ID,
      fundHolderKind: "construction_enterprise",
      fundHolderId: AFFILIATE_VERSION_ID,
      reasonKind: "mandatory_closeout",
      title: "并发相同经济事项必要费用准备",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: concurrentBasis,
      basisSummary: "验证 #279/#280 共用稳定经济身份锁",
      entryKind: "establish",
      amountCents: "91",
      occurredAt: OCCURRED_AT,
      evidenceLevel: "A",
      evidenceFileId: concurrentReserveEvidence.evidenceFileId,
      evidenceSha256: concurrentReserveEvidence.evidenceSha256,
      reason: "跨来源并发验证",
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const concurrentReserveSubmitted = await necessaryService.transition({
      entryId: concurrentReserveDraft.id,
      action: "submit",
      expectedRevision: concurrentReserveDraft.revision,
      expectedFingerprint: concurrentReserveDraft.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: FINANCE_STAFF_ID });
    const concurrentReserveAttested = await necessaryService.transition({
      entryId: concurrentReserveSubmitted.id,
      action: "attest",
      expectedRevision: concurrentReserveSubmitted.revision,
      expectedFingerprint: concurrentReserveSubmitted.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId: PROJECT_MANAGER_ID });
    const concurrentResults = await Promise.allSettled([
      transition(
        concurrentDisputeAttested,
        "confirm",
        FINANCE_DIRECTOR_ID
      ),
      necessaryService.transition({
        entryId: concurrentReserveAttested.id,
        action: "confirm",
        expectedRevision: concurrentReserveAttested.revision,
        expectedFingerprint: concurrentReserveAttested.fingerprint,
        idempotencyKey: randomUUID()
      }, { userId: FINANCE_DIRECTOR_ID })
    ]);
    expect(concurrentResults.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    const concurrentRejected = concurrentResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(concurrentRejected?.reason).toMatchObject({ status: 409 });
    expect(String(concurrentRejected?.reason?.message)).toMatch(
      /duplicate_blocked/u
    );

    const sharedEvidence = await createEvidenceFixture("POL280-PG-SAME-EVIDENCE");
    await createAndConfirmEstablishment(
      "POL280-PG-SAME-EVIDENCE-1",
      "5".repeat(64),
      66n,
      sharedEvidence
    );
    const sameEvidenceDraft = await service.saveDraft(draftCommand({
      businessCode: "POL280-PG-SAME-EVIDENCE-2",
      basis: "6".repeat(64),
      amountCents: 67n,
      ...sharedEvidence
    }), { userId: FINANCE_STAFF_ID });
    const sameEvidenceSubmitted = await transition(sameEvidenceDraft, "submit", FINANCE_STAFF_ID);
    const sameEvidenceAttested = await transition(sameEvidenceSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(sameEvidenceAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);

    await expect(service.saveDraft({
      ...draftCommand({ businessCode: "POL280-PG-C", basis: "9".repeat(64), amountCents: 1n }),
      evidenceLevel: "C" as never
    }, { userId: FINANCE_STAFF_ID })).rejects.toBeInstanceOf(BadRequestException);
  });

  function draftCommand(input: {
    businessCode: string;
    basis: string;
    amountCents: bigint;
    disputeId?: string;
    entryId?: string;
    expectedRevision?: number;
    entryKind?: "establish" | "increase" | "release" | "technical_reversal";
    adjustsEntryId?: string;
    replacementImpacts?: Array<{ operatingImpactEntryId: string; amountCents: string }>;
    counterpartyKind?: string;
    counterpartyId?: string;
    counterpartyNameSnapshot?: string;
    referenceCode?: string;
    resolutionBasisSummary?: string;
    evidenceFileId?: string;
    evidenceSha256?: string;
  }) {
    return {
      projectId: PROJECT_ID,
      businessCode: input.businessCode,
      affiliateAssignmentId: ASSIGNMENT_ID,
      fundHolderKind: "construction_enterprise" as const,
      fundHolderId: AFFILIATE_VERSION_ID,
      disputeKind: "upstream" as const,
      counterpartyKind: input.counterpartyKind ?? "owner",
      counterpartyId: input.counterpartyId ?? "owner-1",
      counterpartyNameSnapshot: input.counterpartyNameSnapshot ?? "业主单位甲",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: input.basis,
      referenceCode: input.referenceCode ?? "CASE-2026-001",
      entryKind: input.entryKind ?? "establish" as const,
      amountCents: input.amountCents.toString(),
      occurredAt: OCCURRED_AT,
      evidenceLevel: "A" as const,
      evidenceFileId: input.evidenceFileId ?? EVIDENCE_FILE_ID,
      evidenceSha256: input.evidenceSha256 ?? EVIDENCE_SHA256,
      disputeSummary: "PG16 动态验收",
      idempotencyKey: randomUUID(),
      ...(input.disputeId ? { disputeId: input.disputeId } : {}),
      ...(input.entryId ? { entryId: input.entryId } : {}),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
      ...(input.adjustsEntryId ? { adjustsEntryId: input.adjustsEntryId } : {}),
      ...(input.resolutionBasisSummary
        ? { resolutionBasisSummary: input.resolutionBasisSummary }
        : {}),
      ...(input.replacementImpacts ? { replacementImpacts: input.replacementImpacts } : {})
    };
  }

  async function transition(
    entry: { id: string; revision: number; fingerprint: string },
    action: "submit" | "attest" | "confirm" | "return",
    userId: string,
    reason?: string
  ) {
    return service.transition({
      entryId: entry.id,
      action,
      expectedRevision: entry.revision,
      expectedFingerprint: entry.fingerprint,
      idempotencyKey: randomUUID(),
      ...(reason ? { reason } : {})
    }, { userId });
  }

  async function createAndConfirmEstablishment(
    businessCode: string,
    basis: string,
    amountCents: bigint,
    evidence?: { evidenceFileId: string; evidenceSha256: string }
  ) {
    const resolvedEvidence = evidence ?? await createEvidenceFixture(businessCode);
    const draft = await service.saveDraft(draftCommand({
      businessCode,
      basis,
      amountCents,
      ...resolvedEvidence
    }), {
      userId: FINANCE_STAFF_ID
    });
    const submitted = await transition(draft, "submit", FINANCE_STAFF_ID);
    const attested = await transition(submitted, "attest", PROJECT_MANAGER_ID);
    const confirmIdempotencyKey = randomUUID();
    const confirmed = await service.transition({
      entryId: attested.id,
      action: "confirm",
      expectedRevision: attested.revision,
      expectedFingerprint: attested.fingerprint,
      idempotencyKey: confirmIdempotencyKey
    }, { userId: FINANCE_DIRECTOR_ID });
    return { ...confirmed, ...resolvedEvidence, confirmIdempotencyKey };
  }

  async function createEvidenceFixture(seed: string) {
    const evidenceFileId = randomUUID();
    const evidenceSha256 = createHash("sha256").update(`${seed}:${evidenceFileId}`).digest("hex");
    await prisma.fileObject.create({
      data: {
        id: evidenceFileId,
        bucket: "private-local",
        objectKey: `pol280/${evidenceFileId}.pdf`,
        originalName: `${seed}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 280,
        uploadedByUserId: FINANCE_STAFF_ID,
        contentSha256: evidenceSha256
      }
    });
    return { evidenceFileId, evidenceSha256 };
  }

  async function prepareAdjustment(
    original: { id: string; disputeId: string },
    entryKind: "release" | "technical_reversal",
    amountCents: bigint
  ) {
    const root = await prisma.projectFundDispute.findUniqueOrThrow({
      where: { id: original.disputeId }
    });
    const draft = await service.saveDraft(draftCommand({
      businessCode: root.businessCode,
      basis: root.basisBusinessIdOrEvidenceSha256,
      amountCents,
      disputeId: root.id,
      entryKind,
      adjustsEntryId: original.id,
      ...(entryKind === "release"
        ? { resolutionBasisSummary: "争议已解决，资金恢复可用或由正式结果替代" }
        : {}),
      counterpartyNameSnapshot: root.counterpartyNameSnapshot,
      referenceCode: root.referenceCode
    }), { userId: FINANCE_STAFF_ID });
    const submitted = await transition(draft, "submit", FINANCE_STAFF_ID);
    return transition(submitted, "attest", PROJECT_MANAGER_ID);
  }

  async function appendConfirmedCostImpact(
    amountCents: bigint,
    options: {
      sourceType?: string;
      impactKind?: "confirmed_cost" | "estimated_clearing_expense";
      basis?: string;
      evidenceSha256?: string;
    } = {}
  ) {
    const sourceId = randomUUID();
    const sourceType = options.sourceType ?? "pol280_replacement_fixture";
    const impactKind = options.impactKind ?? "confirmed_cost";
    const fact = await prisma.$transaction((tx) => operatingLedger.appendConfirmedSourceInTransaction(
      tx,
      {
        projectId: PROJECT_ID,
        sourceType,
        sourceBusinessId: sourceId,
        sourceBusinessCode: `POL280-COST-${sourceId}`,
        sourceVersion: 1,
        idempotencyKey: `pol280-cost:${sourceId}`,
        occurredAt: new Date(`${OCCURRED_AT}T00:00:00.000Z`),
        confirmedAt: new Date(),
        confirmedByUserId: FINANCE_DIRECTOR_ID,
        factKind: "expense",
        operatingLevel: "project",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: false,
        affiliateAssignmentId: ASSIGNMENT_ID,
        affiliateBusinessPartyVersionId: AFFILIATE_VERSION_ID,
        affiliateNameSnapshot: "示例施工企业",
        affiliateCreditCodeSnapshot: "91310000SEEDBUILD01",
        sourceSnapshot: {
          formalStatus: "confirmed",
          sourceId,
          ...(options.basis
            ? { basisBusinessIdOrEvidenceSha256: options.basis }
            : {})
        },
        basisSnapshot: { evidenceSha256: options.evidenceSha256 ?? "8".repeat(64) },
        subjects: {
          costBearingCompany: { kind: "construction_enterprise", id: AFFILIATE_VERSION_ID }
        },
        impacts: [{
          idempotencyKey: `pol280-cost:${sourceId}:impact`,
          sourceImpactKey: impactKind,
          impactKind,
          amountCents,
          direction: "increase",
          subjectRole: "cost_bearing_company",
          subject: { kind: "construction_enterprise", id: AFFILIATE_VERSION_ID },
          costCategoryCode: "other_project_cost",
          impactSnapshot: { fixture: "pol280-replacement" }
        }]
      },
      FINANCE_DIRECTOR_ID
    ));
    return prisma.operatingImpactEntry.findFirstOrThrow({ where: { factId: fact.id } });
  }
});
