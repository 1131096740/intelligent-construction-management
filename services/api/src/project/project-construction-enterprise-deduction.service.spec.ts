import { ConflictException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ProjectConstructionEnterpriseDeductionService } from "./project-construction-enterprise-deduction.service";

const NOW = new Date("2026-11-23T03:00:00.000Z");
const PROJECT_ID = "project-1";
const ACTOR_ID = "finance-1";

function fact(overrides: Record<string, unknown> = {}) {
  return {
    id: "deduction-1",
    projectId: PROJECT_ID,
    factType: "affiliate_deduction",
    entryKind: "original",
    adjustsFactId: null,
    effectDirection: "increase",
    occurredAt: new Date("2026-11-20T00:00:00.000Z"),
    amountCents: 50000n,
    counterpartyName: "施工企业甲",
    basisType: "oral",
    deductionCategory: "other",
    upstreamSettlementId: null,
    companyEntityId: null,
    affiliateCompanyContractId: null,
    affiliateSettlementFactId: null,
    invoiceRecordId: null,
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "施工企业甲",
    description: "管理费",
    evidenceFileId: null,
    documentVersion: 1,
    fileContentSha256Snapshot: null,
    bankObservationReference: null,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    requestFingerprint: "b".repeat(64),
    recordedByUserId: ACTOR_ID,
    recordedByRoleKey: "finance_staff",
    status: "pending_confirm",
    confirmedByUserId: null,
    confirmedAt: null,
    confirmationActionId: null,
    confirmationSignatureVersionId: null,
    confirmationSignatureFileId: null,
    confirmationSignatureSha256: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function roleTables(roleKey: "finance_staff" | "finance_director" | "contract_staff") {
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function createTx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: PROJECT_ID }]),
    project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT_ID }) },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "assignment-1",
        businessPartyVersionId: "party-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: null
      })
    },
    projectUpstreamFundFact: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        fact({ ...data, id: "deduction-new", createdAt: NOW, updatedAt: NOW })
      )
    },
    fileObject: { findUnique: jest.fn().mockResolvedValue(null) },
    ...roleTables("finance_staff"),
    ...overrides
  };
}

function createService(tx: ReturnType<typeof createTx>, options: {
  audit?: { record: jest.Mock };
  entry?: { freeze: jest.Mock };
} = {}) {
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    )
  };
  const audit = options.audit ?? { record: jest.fn().mockResolvedValue(undefined) };
  const entry = options.entry ?? { freeze: jest.fn().mockResolvedValue({ revision: 1 }) };
  const service = new ProjectConstructionEnterpriseDeductionService(
    prisma as never,
    audit as never,
    entry as never
  );
  return { service, prisma, audit, entry };
}

const input = {
  feeName: "管理费",
  amountCents: "50000",
  occurredAt: "2026-11-20T00:00:00.000Z",
  idempotencyKey: "11111111-1111-4111-8111-111111111111"
};

describe("ProjectConstructionEnterpriseDeductionService", () => {
  it("registers a simple deduction with the construction enterprise as counterparty", async () => {
    const tx = createTx();
    const { service, audit, entry } = createService(tx);

    const result = await service.recordDeduction(PROJECT_ID, ACTOR_ID, input);

    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: PROJECT_ID,
        factType: "affiliate_deduction",
        entryKind: "original",
        effectDirection: "increase",
        occurredAt: new Date("2026-11-20T00:00:00.000Z"),
        amountCents: 50000n,
        counterpartyName: "施工企业甲",
        basisType: "oral",
        deductionCategory: "other",
        description: "管理费",
        status: "pending_confirm",
        recordedByUserId: ACTOR_ID,
        recordedByRoleKey: "finance_staff"
      })
    });
    expect(result).toMatchObject({
      id: "deduction-new",
      feeName: "管理费",
      amountCents: "50000",
      status: "pending_confirm"
    });
    expect(entry.freeze).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "project.construction_enterprise_deduction.record"
      })
    );
  });

  it("uses the attached evidence as written basis", async () => {
    const tx = createTx({
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "22222222-2222-4222-8222-222222222222",
          uploadedByUserId: ACTOR_ID,
          storageStatus: "active",
          contentSha256: "a".repeat(64)
        })
      }
    });
    const { service } = createService(tx);

    const result = await service.recordDeduction(PROJECT_ID, ACTOR_ID, {
      ...input,
      evidenceFileId: "22222222-2222-4222-8222-222222222222"
    });

    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        basisType: "written",
        evidenceFileId: "22222222-2222-4222-8222-222222222222",
        fileContentSha256Snapshot: "a".repeat(64)
      })
    });
    expect(result.evidenceFileId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("rejects a second registration with the same fee name, amount and date", async () => {
    const tx = createTx();
    tx.projectUpstreamFundFact.findFirst = jest.fn().mockResolvedValueOnce(fact());
    const { service } = createService(tx);

    await expect(
      service.recordDeduction(PROJECT_ID, ACTOR_ID, {
        ...input,
        idempotencyKey: "33333333-3333-4333-8333-333333333333"
      })
    ).rejects.toThrow("相同费用名称、金额和日期的施工企业扣费已登记");
  });

  it("allows re-registering the same tuple after the original was reversed", async () => {
    const tx = createTx();
    tx.projectUpstreamFundFact.findFirst = jest
      .fn()
      .mockResolvedValueOnce(fact())
      .mockResolvedValueOnce({ id: "reversal-1" });
    const { service } = createService(tx);

    const result = await service.recordDeduction(PROJECT_ID, ACTOR_ID, {
      ...input,
      idempotencyKey: "44444444-4444-4444-8444-444444444444"
    });

    expect(result.id).toBe("deduction-new");
    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledTimes(1);
  });

  it("replays the same idempotency key instead of creating a second fact", async () => {
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        projectId: PROJECT_ID,
        actorUserId: ACTOR_ID,
        feeName: "管理费",
        amountCents: "50000",
        occurredAt: new Date("2026-11-20T00:00:00.000Z").toISOString(),
        evidenceFileId: null
      }), "utf8")
      .digest("hex");
    const existing = fact({ requestFingerprint });
    const tx = createTx();
    tx.projectUpstreamFundFact.findUnique = jest
      .fn()
      .mockResolvedValue(existing);
    const { service } = createService(tx);

    const result = await service.recordDeduction(PROJECT_ID, ACTOR_ID, input);

    expect(result.id).toBe(existing.id);
    expect(tx.projectUpstreamFundFact.create).not.toHaveBeenCalled();
  });

  it("rejects reusing an idempotency key for a different deduction", async () => {
    const tx = createTx();
    tx.projectUpstreamFundFact.findUnique = jest
      .fn()
      .mockResolvedValue(fact({ requestFingerprint: "c".repeat(64) }));
    const { service } = createService(tx);

    await expect(
      service.recordDeduction(PROJECT_ID, ACTOR_ID, input)
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects roles that cannot record upstream fund facts", async () => {
    const tx = createTx(roleTables("contract_staff"));
    const { service } = createService(tx);

    await expect(
      service.recordDeduction(PROJECT_ID, ACTOR_ID, input)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.projectUpstreamFundFact.create).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount", async () => {
    const tx = createTx();
    const { service } = createService(tx);

    await expect(
      service.recordDeduction(PROJECT_ID, ACTOR_ID, {
        ...input,
        amountCents: "0"
      })
    ).rejects.toThrow("扣费金额必须大于零");
  });
});
