import { BadRequestException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuditService } from "../audit/audit.service";
import { NecessaryExpenseReserveOperatingSourceAdapter } from "../necessary-expense-reserve/necessary-expense-reserve-operating-source.adapter";
import { NecessaryExpenseReserveService } from "../necessary-expense-reserve/necessary-expense-reserve.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";

const RUN_POSTGRES = process.env.RUN_POL279_NECESSARY_EXPENSE_RESERVE_PG16 === "1";
const describePostgres = RUN_POSTGRES ? describe : describe.skip;
const PROJECT_ID = "seed-project-jgxm-001";
const ASSIGNMENT_ID = "seed-construction-enterprise-assignment-jgxm-001";
const AFFILIATE_VERSION_ID = "seed-construction-enterprise-version-jgxm-001";
const FINANCE_STAFF_ID = "seed-user-cashier";
const PROJECT_MANAGER_ID = "seed-user-project-manager";
const FINANCE_DIRECTOR_ID = "seed-user-finance-director";
const EVIDENCE_FILE_ID = "27900000-0000-4000-8000-000000000001";
const EVIDENCE_SHA256 = "a".repeat(64);
const OCCURRED_AT = "2026-09-01";

describePostgres("POL-279 necessary expense reserve PostgreSQL 16", () => {
  const prisma = new PrismaClient();
  const audit = new AuditService();
  const operatingLedger = new OperatingLedgerService(prisma as never);
  const adapter = new NecessaryExpenseReserveOperatingSourceAdapter();
  const registry = new OperatingSourceAdapterRegistry([adapter], [adapter.sourceType]);
  const replay = new OperatingSourceReplayService(prisma as never, operatingLedger, registry);
  const service = new NecessaryExpenseReserveService(prisma as never, replay, audit);
  const operatingProfile = new ProjectOperatingProfileService(prisma as never, audit);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
      throw new Error("POL-279 PG16 测试必须连接非生产 disposable database");
    }
    const writeSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!writeSecret) {
      throw new Error("POL-279 PG16 测试缺少一次性经营账写入密钥");
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
        objectKey: `pol279/${EVIDENCE_FILE_ID}.pdf`,
        originalName: "pol279-evidence.pdf",
        mimeType: "application/pdf",
        sizeBytes: 279,
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
      businessCode: "POL279-PG-FIRST-APP",
      basis: "1".repeat(64),
      amountCents: 1n,
      entryKind: "increase"
    }), { userId: FINANCE_STAFF_ID })).rejects.toThrow(/首笔分录必须先建立准备/u);

    const rawReserveId = randomUUID();
    const rawEconomicIdentity = createHash("sha256").update(`economic:${rawReserveId}`).digest("hex");
    const rawSourceIdentity = createHash("sha256").update(`source:${rawReserveId}`).digest("hex");
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectNecessaryExpenseReserve" (
        "id", "projectId", "businessCode", "affiliateAssignmentId",
        "affiliateBusinessPartyVersionId", "affiliateNameSnapshot",
        "affiliateCreditCodeSnapshot", "fundHolderKind", "fundHolderId",
        "reasonKind", "title", "basisKind", "basisBusinessIdOrEvidenceSha256",
        "basisSummary", "economicIdentityKey", "sourceIdentityKey",
        "createdByUserId", "updatedAt"
      ) VALUES (
        ${rawReserveId}, ${PROJECT_ID}, ${`POL279-RAW-${rawReserveId}`}, ${ASSIGNMENT_ID},
        ${AFFILIATE_VERSION_ID}, '示例施工企业', '91310000SEEDBUILD01',
        'construction_enterprise', ${AFFILIATE_VERSION_ID}, 'mandatory_closeout',
        '数据库首笔顺序保护', 'written_evidence', ${"2".repeat(64)}, '数据库动态守卫',
        ${rawEconomicIdentity}, ${rawSourceIdentity}, ${FINANCE_STAFF_ID}, NOW()
      )
    `);
    await expect(prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectNecessaryExpenseReserveEntry" (
        "id", "reserveId", "sequenceNo", "entryKind", "amountCents", "occurredAt",
        "reason", "evidenceLevel", "evidenceFileId", "evidenceSha256", "fingerprint",
        "idempotencyKey", "preparedByUserId", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${rawReserveId}, 1, 'increase', 1, ${new Date(`${OCCURRED_AT}T00:00:00.000Z`)},
        '非法首笔增加', 'A', ${EVIDENCE_FILE_ID}, ${EVIDENCE_SHA256}, ${"3".repeat(64)},
        ${randomUUID()}, ${FINANCE_STAFF_ID}, NOW()
      )
    `)).rejects.toThrow(/first reserve entry must establish/u);

    const unconfirmedEstablishment = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-PENDING-ESTABLISH",
      basis: "4".repeat(64),
      amountCents: 100n
    }), { userId: FINANCE_STAFF_ID });
    await expect(service.saveDraft(draftCommand({
      businessCode: "POL279-PG-PENDING-ESTABLISH",
      basis: "4".repeat(64),
      amountCents: 10n,
      reserveId: unconfirmedEstablishment.reserveId,
      entryKind: "increase"
    }), { userId: FINANCE_STAFF_ID })).rejects.toThrow(/建立分录确认后才能追加增加/u);

    const confirmed = await createAndConfirmEstablishment("POL279-PG-001", "b".repeat(64), 120_000n);
    const sameEvidenceIncrease = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-001",
      basis: "b".repeat(64),
      amountCents: 1_000n,
      reserveId: confirmed.reserveId,
      entryKind: "increase",
      evidenceFileId: confirmed.evidenceFileId,
      evidenceSha256: confirmed.evidenceSha256
    }), { userId: FINANCE_STAFF_ID });
    const sameEvidenceSubmitted = await transition(sameEvidenceIncrease, "submit", FINANCE_STAFF_ID);
    const sameEvidenceAttested = await transition(sameEvidenceSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(sameEvidenceAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);

    const increaseEvidence = await createEvidenceFixture("POL279-PG-001-increase");
    await expect(service.saveDraft(draftCommand({
      businessCode: "POL279-PG-001",
      basis: "b".repeat(64),
      amountCents: 5_000n,
      reserveId: confirmed.reserveId,
      entryKind: "increase",
      ...increaseEvidence
    }), { userId: FINANCE_STAFF_ID })).resolves.toMatchObject({
      entryKind: "increase",
      status: "draft"
    });
    const fact = await prisma.operatingFact.findUniqueOrThrow({
      where: {
        sourceType_sourceBusinessId: {
          sourceType: "project_necessary_expense_reserve_entry",
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
        impactKind: "necessary_expense_reserve_increase",
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
      where: { sourceType: "project_necessary_expense_reserve_entry", sourceBusinessId: confirmed.id }
    })).resolves.toBe(1);
  });

  it("允许唯一退回草稿修改说明，但数据库冻结经济身份和在途说明", async () => {
    const basis = "c".repeat(64);
    const draft = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-EDIT",
      basis,
      amountCents: 30_000n
    }), { userId: FINANCE_STAFF_ID });
    await expect(prisma.projectNecessaryExpenseReserve.update({
      where: { id: draft.reserveId },
      data: { businessCode: "ILLEGAL-IDENTITY-CHANGE" }
    })).rejects.toThrow(/reserve root identity is immutable/u);

    const edited = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-EDIT",
      basis,
      amountCents: 30_000n,
      reserveId: draft.reserveId,
      entryId: draft.id,
      expectedRevision: draft.revision,
      title: "经退回前可修订的收尾事项",
      basisSummary: "唯一草稿的说明修订"
    }), { userId: FINANCE_STAFF_ID });
    const submitted = await transition(edited, "submit", FINANCE_STAFF_ID);
    await expect(prisma.projectNecessaryExpenseReserve.update({
      where: { id: draft.reserveId },
      data: { title: "ILLEGAL-IN-FLIGHT-CHANGE" }
    })).rejects.toThrow(/description is frozen/u);
    const returned = await transition(submitted, "return", FINANCE_DIRECTOR_ID, "依据需要补充");
    await expect(service.saveDraft(draftCommand({
      businessCode: "POL279-PG-EDIT",
      basis,
      amountCents: 31_000n,
      reserveId: draft.reserveId,
      entryId: draft.id,
      expectedRevision: returned.revision,
      title: "补充依据后的收尾事项",
      basisSummary: "退回后修订"
    }), { userId: FINANCE_STAFF_ID })).resolves.toMatchObject({ revision: 3, status: "draft" });
  });

  it("在并发释放时保持余额非负，并拒绝剩余额不足的全额技术冲销", async () => {
    const original = await createAndConfirmEstablishment("POL279-PG-CAP", "d".repeat(64), 1_000n);
    const first = await prepareAdjustment(original, "release", 700n);
    const second = await prepareAdjustment(original, "release", 700n);
    const results = await Promise.allSettled([
      transition(first, "confirm", FINANCE_DIRECTOR_ID),
      transition(second, "confirm", FINANCE_DIRECTOR_ID)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(prisma.projectNecessaryExpenseReserveEntry.aggregate({
      where: { adjustsEntryId: original.id, status: "confirmed" },
      _sum: { amountCents: true }
    })).resolves.toMatchObject({ _sum: { amountCents: 700n } });

    const reversal = await prepareAdjustment(original, "technical_reversal", 1_000n);
    await expect(transition(reversal, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/exceeds remaining reserve capacity/u);

    const exactOriginal = await createAndConfirmEstablishment(
      "POL279-PG-REVERSAL",
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
            sourceType: "project_necessary_expense_reserve_entry",
            sourceBusinessId: exactOriginal.id
          }
        },
        include: { impacts: true }
      }),
      prisma.operatingFact.findUniqueOrThrow({
        where: {
          sourceType_sourceBusinessId: {
            sourceType: "project_necessary_expense_reserve_entry",
            sourceBusinessId: exactReversal.id
          }
        },
        include: { impacts: true }
      })
    ]);
    expect(reversalFact.adjustsFactId).toBe(originalFact.id);
    expect(reversalFact.impacts[0]).toMatchObject({
      sourceImpactKey: originalFact.impacts[0]!.sourceImpactKey,
      impactKind: "necessary_expense_reserve_increase",
      direction: "decrease",
      impactSnapshot: originalFact.impacts[0]!.impactSnapshot
    });
  });

  it("替代关联只接受已确认正式扣减，并对未来一般争议来源执行跨来源阻断", async () => {
    const original = await createAndConfirmEstablishment("POL279-PG-REPLACE", "e".repeat(64), 500n);
    const replacementImpact = await appendConfirmedCostImpact(200n);
    const oversizedRelease = await prepareAdjustment(original, "release", 201n);
    const confirmedOversizedRelease = await transition(
      oversizedRelease,
      "confirm",
      FINANCE_DIRECTOR_ID
    );
    await expect(prisma.projectNecessaryExpenseReserveReplacement.create({
      data: {
        reserveEntryId: confirmedOversizedRelease.id,
        operatingImpactEntryId: replacementImpact.id,
        amountCents: 201n
      }
    })).rejects.toThrow(/replacement allocation exceeds formal impact amount/u);

    const releaseDraft = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-REPLACE",
      basis: "e".repeat(64),
      amountCents: 200n,
      reserveId: original.reserveId,
      entryKind: "release",
      adjustsEntryId: original.id,
      replacementImpacts: [{
        operatingImpactEntryId: replacementImpact.id,
        amountCents: "200"
      }]
    }), { userId: FINANCE_STAFF_ID });
    const submitted = await transition(releaseDraft, "submit", FINANCE_STAFF_ID);
    const attested = await transition(submitted, "attest", PROJECT_MANAGER_ID);
    const released = await transition(attested, "confirm", FINANCE_DIRECTOR_ID);
    await expect(prisma.projectNecessaryExpenseReserveReplacement.findUnique({
      where: {
        reserveEntryId_operatingImpactEntryId: {
          reserveEntryId: released.id,
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
    await expect(prisma.projectNecessaryExpenseReserveReplacement.create({
      data: {
        reserveEntryId: confirmedDuplicateReplacementRelease.id,
        operatingImpactEntryId: replacementImpact.id,
        amountCents: 1n
      }
    })).rejects.toThrow(/replacement allocation exceeds formal impact amount/u);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ProjectFundDispute" (
        "id" TEXT PRIMARY KEY,
        "economicIdentityKey" TEXT NOT NULL
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ProjectFundDisputeEntry" (
        "id" TEXT PRIMARY KEY,
        "disputeId" TEXT NOT NULL,
        "entryKind" TEXT NOT NULL,
        "amountCents" BIGINT NOT NULL,
        "status" TEXT NOT NULL
      )
    `);
    const blockedDraft = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-CROSS",
      basis: "f".repeat(64),
      amountCents: 77n
    }), { userId: FINANCE_STAFF_ID });
    const root = await prisma.projectNecessaryExpenseReserve.findUniqueOrThrow({
      where: { id: blockedDraft.reserveId }
    });
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectFundDispute" ("id", "economicIdentityKey")
      VALUES (${randomUUID()}, ${root.economicIdentityKey})
    `);
    const dispute = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ProjectFundDispute" WHERE "economicIdentityKey" = ${root.economicIdentityKey}
    `);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectFundDisputeEntry" ("id", "disputeId", "entryKind", "amountCents", "status")
      VALUES (${randomUUID()}, ${dispute[0]!.id}, 'establish', 77, 'confirmed')
    `);
    const blockedSubmitted = await transition(blockedDraft, "submit", FINANCE_STAFF_ID);
    const blockedAttested = await transition(blockedSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(blockedAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);

    const sharedEvidence = await createEvidenceFixture("POL279-PG-SAME-EVIDENCE");
    await createAndConfirmEstablishment(
      "POL279-PG-SAME-EVIDENCE-1",
      "5".repeat(64),
      66n,
      sharedEvidence
    );
    const sameEvidenceDraft = await service.saveDraft(draftCommand({
      businessCode: "POL279-PG-SAME-EVIDENCE-2",
      basis: "6".repeat(64),
      amountCents: 67n,
      ...sharedEvidence
    }), { userId: FINANCE_STAFF_ID });
    const sameEvidenceSubmitted = await transition(sameEvidenceDraft, "submit", FINANCE_STAFF_ID);
    const sameEvidenceAttested = await transition(sameEvidenceSubmitted, "attest", PROJECT_MANAGER_ID);
    await expect(transition(sameEvidenceAttested, "confirm", FINANCE_DIRECTOR_ID))
      .rejects.toThrow(/duplicate_blocked/u);

    await expect(service.saveDraft({
      ...draftCommand({ businessCode: "POL279-PG-C", basis: "9".repeat(64), amountCents: 1n }),
      evidenceLevel: "C" as never
    }, { userId: FINANCE_STAFF_ID })).rejects.toBeInstanceOf(BadRequestException);
  });

  function draftCommand(input: {
    businessCode: string;
    basis: string;
    amountCents: bigint;
    reserveId?: string;
    entryId?: string;
    expectedRevision?: number;
    entryKind?: "establish" | "increase" | "release" | "technical_reversal";
    adjustsEntryId?: string;
    replacementImpacts?: Array<{ operatingImpactEntryId: string; amountCents: string }>;
    title?: string;
    basisSummary?: string;
    evidenceFileId?: string;
    evidenceSha256?: string;
  }) {
    return {
      projectId: PROJECT_ID,
      businessCode: input.businessCode,
      affiliateAssignmentId: ASSIGNMENT_ID,
      fundHolderKind: "construction_enterprise" as const,
      fundHolderId: AFFILIATE_VERSION_ID,
      reasonKind: "mandatory_closeout" as const,
      title: input.title ?? "法定收尾必要准备",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: input.basis,
      basisSummary: input.basisSummary ?? "已确认仍需承担的法定收尾义务",
      entryKind: input.entryKind ?? "establish" as const,
      amountCents: input.amountCents.toString(),
      occurredAt: OCCURRED_AT,
      evidenceLevel: "A" as const,
      evidenceFileId: input.evidenceFileId ?? EVIDENCE_FILE_ID,
      evidenceSha256: input.evidenceSha256 ?? EVIDENCE_SHA256,
      reason: "PG16 动态验收",
      idempotencyKey: randomUUID(),
      ...(input.reserveId ? { reserveId: input.reserveId } : {}),
      ...(input.entryId ? { entryId: input.entryId } : {}),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
      ...(input.adjustsEntryId ? { adjustsEntryId: input.adjustsEntryId } : {}),
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
        objectKey: `pol279/${evidenceFileId}.pdf`,
        originalName: `${seed}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 279,
        uploadedByUserId: FINANCE_STAFF_ID,
        contentSha256: evidenceSha256
      }
    });
    return { evidenceFileId, evidenceSha256 };
  }

  async function prepareAdjustment(
    original: { id: string; reserveId: string },
    entryKind: "release" | "technical_reversal",
    amountCents: bigint
  ) {
    const root = await prisma.projectNecessaryExpenseReserve.findUniqueOrThrow({
      where: { id: original.reserveId }
    });
    const draft = await service.saveDraft(draftCommand({
      businessCode: root.businessCode,
      basis: root.basisBusinessIdOrEvidenceSha256,
      amountCents,
      reserveId: root.id,
      entryKind,
      adjustsEntryId: original.id,
      title: root.title,
      basisSummary: root.basisSummary
    }), { userId: FINANCE_STAFF_ID });
    const submitted = await transition(draft, "submit", FINANCE_STAFF_ID);
    return transition(submitted, "attest", PROJECT_MANAGER_ID);
  }

  async function appendConfirmedCostImpact(amountCents: bigint) {
    const sourceId = randomUUID();
    const fact = await prisma.$transaction((tx) => operatingLedger.appendConfirmedSourceInTransaction(
      tx,
      {
        projectId: PROJECT_ID,
        sourceType: "pol279_replacement_fixture",
        sourceBusinessId: sourceId,
        sourceBusinessCode: `POL279-COST-${sourceId}`,
        sourceVersion: 1,
        idempotencyKey: `pol279-cost:${sourceId}`,
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
        sourceSnapshot: { formalStatus: "confirmed", sourceId },
        basisSnapshot: { evidenceSha256: "8".repeat(64) },
        subjects: {
          costBearingCompany: { kind: "construction_enterprise", id: AFFILIATE_VERSION_ID }
        },
        impacts: [{
          idempotencyKey: `pol279-cost:${sourceId}:impact`,
          sourceImpactKey: "confirmed_cost",
          impactKind: "confirmed_cost",
          amountCents,
          direction: "increase",
          subjectRole: "cost_bearing_company",
          subject: { kind: "construction_enterprise", id: AFFILIATE_VERSION_ID },
          costCategoryCode: "other_project_cost",
          impactSnapshot: { fixture: "pol279-replacement" }
        }]
      },
      FINANCE_DIRECTOR_ID
    ));
    return prisma.operatingImpactEntry.findFirstOrThrow({ where: { factId: fact.id } });
  }
});
