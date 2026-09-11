import {
  BadRequestException,
  ConflictException,
  ForbiddenException
} from "@nestjs/common";

import { ProjectFundDisputeService } from "./project-fund-dispute.service";

describe("ProjectFundDisputeService public business seam", () => {
  const actorRole = new Map([
    ["finance-staff-1", "finance_staff"],
    ["project-manager-1", "project_manager"],
    ["finance-director-1", "finance_director"]
  ]);
  const evidenceSha256 = "a".repeat(64);
  const draftIdempotencyKey = "9d7d5846-e391-4e14-8d7d-2d1d9227d164";
  const submitIdempotencyKey = "5cc9a7ee-6d23-4493-890c-84a395bceaad";
  const attestIdempotencyKey = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
  const confirmIdempotencyKey = "b026a506-84a5-4cfc-9cb4-d6f6bc7c5c72";

  function createHarness() {
    let dispute: Record<string, unknown> | null = null;
    let entry: Record<string, unknown> | null = null;
    const receipts = new Map<string, Record<string, unknown>>();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const replay = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn().mockResolvedValue({ id: "fact-1" })
    };
    const clearingReconciliation = {
      readProjectFundDisputeDuplicateInTransaction: jest.fn().mockResolvedValue("none")
    };
    const files = {
      assertCanDownloadFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join("?") ?? "";
        if (sql.includes("duplicateExists")) return [{ duplicateExists: false }];
        if (sql.includes("OperatingImpactEntry")) return [];
        return [{ id: "locked" }];
      }),
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: {
        findMany: jest.fn(async (args: { where: { userId: string } }) => [{
          positionId: args.where.userId,
          projectId: "project-1"
        }])
      },
      position: {
        findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.map((id) => ({ id, key: actorRole.get(id) })))
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyVersionId: "affiliate-version-1",
          affiliateNameSnapshot: "施工企业甲",
          affiliateCreditCodeSnapshot: "91310000TEST"
        })
      },
      projectParticipatingCompany: { findFirst: jest.fn() },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          contentSha256: evidenceSha256,
          storageStatus: "active"
        })
      },
      projectFundDispute: {
        findUnique: jest.fn(async () => dispute),
        findMany: jest.fn(async () => dispute ? [{
          ...dispute,
          entries: entry ? [{ ...entry, replacements: [] }] : []
        }] : []),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          dispute = {
            ...args.data,
            createdAt: new Date("2026-09-10T00:00:00.000Z"),
            updatedAt: new Date("2026-09-10T00:00:00.000Z")
          };
          return dispute;
        })
      },
      projectFundDisputeEntry: {
        aggregate: jest.fn(async () => ({
          _max: { sequenceNo: entry ? Number(entry.sequenceNo) : null }
        })),
        findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
          if (
            entry &&
            entry.disputeId === args.where.disputeId &&
            entry.entryKind === args.where.entryKind &&
            entry.status === args.where.status
          ) {
            return { id: entry.id };
          }
          return null;
        }),
        findUnique: jest.fn(async (args: { where: Record<string, string> }) => {
          if (!entry) return null;
          if (args.where.idempotencyKey && entry.idempotencyKey !== args.where.idempotencyKey) {
            return null;
          }
          if (args.where.id && entry.id !== args.where.id) return null;
          return { ...entry, dispute, replacements: [] };
        }),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          entry = {
            ...args.data,
            status: "draft",
            submittedByUserId: null,
            submittedAt: null,
            attestedByUserId: null,
            attestedAt: null,
            confirmedByUserId: null,
            confirmedAt: null,
            returnedByUserId: null,
            returnedAt: null,
            returnReason: null,
            createdAt: new Date("2026-09-10T00:00:00.000Z"),
            updatedAt: new Date("2026-09-10T00:00:00.000Z")
          };
          return entry;
        }),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => {
          entry = { ...entry, ...args.data, updatedAt: new Date() };
          return { ...entry, dispute, replacements: [] };
        })
      },
      projectFundDisputeCommandReceipt: {
        findUnique: jest.fn(async (args: { where: { idempotencyKey: string } }) =>
          receipts.get(args.where.idempotencyKey) ?? null),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          receipts.set(String(args.data.idempotencyKey), args.data);
          return args.data;
        })
      },
      operatingFact: { findUnique: jest.fn() },
      operatingImpactEntry: { findMany: jest.fn().mockResolvedValue([]) },
      projectFundDisputeReplacement: { create: jest.fn() }
    };
    const prisma = {
      projectFundDisputeEntry: tx.projectFundDisputeEntry,
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    };
    return {
      service: new ProjectFundDisputeService(
        prisma as never,
        replay as never,
        audit as never,
        clearingReconciliation as never,
        files as never
      ),
      tx,
      replay,
      clearingReconciliation,
      files,
      prisma,
      receipts,
      currentEntry: () => entry
    };
  }

  it("creates, reads, submits, independently attests and confirms in one transaction seam", async () => {
    const harness = createHarness();
    const draft = {
      projectId: "project-1",
      businessCode: "争议资金-001",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "construction_enterprise" as const,
      fundHolderId: "affiliate-version-1",
      disputeKind: "upstream" as const,
      counterpartyKind: "owner",
      counterpartyId: "owner-1",
      counterpartyNameSnapshot: "项目收尾资料整理",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256,
      referenceCode: "经确认仍需完成的法定收尾资料",
      entryKind: "establish" as const,
      amountCents: "120000",
      occurredAt: "2026-09-01",
      evidenceLevel: "B" as const,
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "首次建立争议资金",
      idempotencyKey: draftIdempotencyKey
    };

    const created = await harness.service.saveDraft(draft, { userId: "finance-staff-1" });
    expect(harness.files.assertCanDownloadFile).toHaveBeenCalledWith(
      harness.tx,
      "file-1",
      "finance-staff-1"
    );
    const repeatedCreate = await harness.service.saveDraft(draft, { userId: "finance-staff-1" });
    expect(repeatedCreate).toEqual(created);
    expect(harness.tx.projectFundDisputeEntry.create).toHaveBeenCalledTimes(1);

    const workbench = await harness.service.getWorkbench(
      { projectId: "project-1" },
      { userId: "finance-staff-1" }
    );
    expect(workbench.disputes[0]).toEqual(expect.objectContaining({
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256
    }));
    expect(workbench.capabilities).toEqual(expect.objectContaining({
      read: true,
      prepare: true,
      submit: true,
      attest: false,
      confirm: false
    }));

    const submitted = await harness.service.transition({
      entryId: String(created.id),
      action: "submit",
      expectedRevision: 1,
      expectedFingerprint: String(created.fingerprint),
      idempotencyKey: submitIdempotencyKey
    }, { userId: "finance-staff-1" });
    expect(submitted.status).toBe("submitted");
    expect(harness.currentEntry()?.payloadSnapshot).toEqual(expect.objectContaining({
      schema: "project_fund_dispute_entry/V1",
      evidenceSha256
    }));

    const attested = await harness.service.transition({
      entryId: String(created.id),
      action: "attest",
      expectedRevision: 1,
      expectedFingerprint: String(created.fingerprint),
      idempotencyKey: attestIdempotencyKey
    }, { userId: "project-manager-1" });
    expect(attested.status).toBe("attested");

    const confirmed = await harness.service.transition({
      entryId: String(created.id),
      action: "confirm",
      expectedRevision: 1,
      expectedFingerprint: String(created.fingerprint),
      idempotencyKey: confirmIdempotencyKey
    }, { userId: "finance-director-1" });
    expect(confirmed.status).toBe("confirmed");
    expect(harness.replay.appendConfirmedSourceIfEnabledInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        projectId: "project-1",
        sourceType: "project_fund_dispute_entry",
        sourceBusinessId: created.id
      }),
      "finance-director-1"
    );

    const repeatedConfirm = await harness.service.transition({
      entryId: String(created.id),
      action: "confirm",
      expectedRevision: 1,
      expectedFingerprint: String(created.fingerprint),
      idempotencyKey: confirmIdempotencyKey
    }, { userId: "finance-director-1" });
    expect(repeatedConfirm).toEqual(confirmed);
    expect(harness.replay.appendConfirmedSourceIfEnabledInTransaction).toHaveBeenCalledTimes(1);
    expect(harness.receipts.size).toBe(4);
  });

  it("fails closed when a transition idempotency key is replayed with another action", async () => {
    const harness = createHarness();
    const created = await harness.service.saveDraft({
      projectId: "project-1",
      businessCode: "争议资金-002",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "construction_enterprise",
      fundHolderId: "affiliate-version-1",
      disputeKind: "upstream",
      counterpartyKind: "owner",
      counterpartyId: "owner-1",
      counterpartyNameSnapshot: "项目收尾资料整理",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256,
      referenceCode: "经确认仍需完成的法定收尾资料",
      entryKind: "establish",
      amountCents: "120000",
      occurredAt: "2026-09-01",
      evidenceLevel: "A",
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "首次建立争议资金",
      idempotencyKey: draftIdempotencyKey
    }, { userId: "finance-staff-1" });
    await harness.service.transition({
      entryId: String(created.id),
      action: "submit",
      expectedRevision: 1,
      expectedFingerprint: String(created.fingerprint),
      idempotencyKey: submitIdempotencyKey
    }, { userId: "finance-staff-1" });

    await expect(harness.service.transition({
      entryId: String(created.id),
      action: "return",
      expectedRevision: 1,
      expectedFingerprint: String(created.fingerprint),
      idempotencyKey: submitIdempotencyKey,
      reason: "恶意复用幂等键"
    }, { userId: "finance-director-1" })).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a private evidence file before binding when the canonical ACL denies it", async () => {
    const harness = createHarness();
    harness.files.assertCanDownloadFile.mockRejectedValueOnce(
      new ForbiddenException("当前账号无权下载该资料")
    );

    await expect(harness.service.saveDraft({
      projectId: "project-1",
      businessCode: "争议资金-跨项目文件",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "construction_enterprise",
      fundHolderId: "affiliate-version-1",
      disputeKind: "upstream",
      counterpartyKind: "owner",
      counterpartyId: "owner-1",
      counterpartyNameSnapshot: "项目收尾资料整理",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256,
      referenceCode: "禁止跨项目证据绑定",
      entryKind: "establish",
      amountCents: "120000",
      occurredAt: "2026-09-01",
      evidenceLevel: "A",
      evidenceFileId: "file-foreign-project",
      evidenceSha256,
      disputeSummary: "跨项目读取尝试",
      idempotencyKey: draftIdempotencyKey
    }, { userId: "finance-staff-1" })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(harness.tx.projectFundDisputeEntry.create).not.toHaveBeenCalled();
  });

  it("returns a 400 for an unknown action before permission lookup", async () => {
    const harness = createHarness();
    await expect(harness.service.transition({
      entryId: "entry-1",
      action: "unknown" as never,
      expectedRevision: 1,
      expectedFingerprint: "a".repeat(64),
      idempotencyKey: draftIdempotencyKey
    }, { userId: "finance-staff-1" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { code: "P2010", meta: { code: "23514" } },
    { message: "Unknown query error: SQLSTATE 23514 POL-280 capacity guard" }
  ])("maps database capacity conflicts to HTTP 409 without retry", async (error) => {
    const harness = createHarness();
    harness.prisma.$transaction.mockRejectedValueOnce(error);
    const service = harness.service as unknown as {
      serializable(work: () => Promise<unknown>): Promise<unknown>;
    };
    const result = service.serializable(async () => undefined);
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toMatchObject({ status: 409 });
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "P2034" },
    { code: "P2010", meta: { code: "40001", message: "could not serialize access" } },
    { code: "P2010", meta: { code: "40P01", message: "deadlock detected" } }
  ])("retries a serialization failure once with a fresh transaction", async (error) => {
    const harness = createHarness();
    harness.prisma.$transaction.mockRejectedValueOnce(error);
    const service = harness.service as unknown as {
      serializable(work: () => Promise<string>): Promise<string>;
    };
    await expect(service.serializable(async () => "retried"))
      .resolves.toBe("retried");
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not apply positive-entry duplicate guards to append-only releases", async () => {
    const harness = createHarness();
    const service = harness.service as unknown as {
      assertConfirmableSource(
        tx: unknown,
        entry: unknown,
        actorUserId: string
      ): Promise<void>;
    };
    await expect(service.assertConfirmableSource(harness.tx, {
      dispute: {
        id: "c39f87da-8015-4241-8bbe-025903a11bb3",
        projectId: "project-1",
        businessCode: "争议资金-释放-001",
        affiliateAssignmentId: "assignment-1",
        fundHolderKind: "construction_enterprise",
        fundHolderId: "affiliate-version-1",
        disputeKind: "upstream",
        counterpartyKind: "owner",
      counterpartyId: "owner-1",
      counterpartyNameSnapshot: "项目收尾资料整理",
        basisKind: "written_evidence",
        basisBusinessIdOrEvidenceSha256: evidenceSha256,
        referenceCode: "正式扣减已经替代原争议资金"
      },
      id: "a81b1c41-6d8d-42c5-8574-5b55b92822de",
      entryKind: "release",
      adjustsEntryId: "2a98a151-3ed3-47dd-85d7-af3681d5e19c",
      amountCents: 120000n,
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      evidenceLevel: "A",
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "正式影响已替代争议资金",
      resolutionBasisSummary: "争议已由正式结果解决",
      idempotencyKey: "ca5af90d-05e5-43cc-85f5-222f10557969",
      draftRevision: 1,
      payloadSnapshot: { replacementImpacts: [] },
      replacements: []
    }, "finance-director-1")).resolves.toBeUndefined();
    expect(harness.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("blocks a positive entry when an active formal source already uses the evidence", async () => {
    const harness = createHarness();
    harness.tx.$queryRaw
      .mockResolvedValueOnce([{ duplicateExists: false }])
      .mockResolvedValueOnce([{ duplicateExists: true }]);
    const service = harness.service as unknown as {
      assertConfirmableSource(
        tx: unknown,
        entry: unknown,
        actorUserId: string
      ): Promise<void>;
    };
    await expect(service.assertConfirmableSource(harness.tx, {
      dispute: {
        id: "c39f87da-8015-4241-8bbe-025903a11bb3",
        projectId: "project-1",
        businessCode: "争议资金-证据去重-001",
        affiliateAssignmentId: "assignment-1",
        fundHolderKind: "construction_enterprise",
        fundHolderId: "affiliate-version-1",
        disputeKind: "upstream",
        counterpartyKind: "owner",
        counterpartyId: "owner-1",
        counterpartyNameSnapshot: "项目收尾资料整理",
        basisKind: "written_evidence",
        basisBusinessIdOrEvidenceSha256: "b".repeat(64),
        referenceCode: "同证据不得重复形成限制",
        economicIdentityKey: "c".repeat(64)
      },
      id: "a81b1c41-6d8d-42c5-8574-5b55b92822de",
      entryKind: "establish",
      adjustsEntryId: null,
      amountCents: 120000n,
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      evidenceLevel: "A",
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "建立争议资金",
      idempotencyKey: "ca5af90d-05e5-43cc-85f5-222f10557969",
      draftRevision: 1,
      payloadSnapshot: { replacementImpacts: [] },
      replacements: []
    }, "finance-director-1")).rejects.toThrow(/duplicate_blocked/u);
    const duplicateQuery = harness.tx.$queryRaw.mock.calls[1]?.[0] as { strings?: readonly string[] };
    const duplicateSql = duplicateQuery.strings?.join("?") ?? "";
    expect(duplicateSql).toContain(
      "fact.\"basisSnapshot\" ->> 'evidenceSha256'"
    );
    expect(duplicateSql).toContain("jsonb_path_exists");
    expect(duplicateSql).toContain("construction_enterprise_funds_freeze");
  });

  it("blocks a positive entry through the formal #275 reconciliation reader seam", async () => {
    const harness = createHarness();
    harness.clearingReconciliation.readProjectFundDisputeDuplicateInTransaction
      .mockResolvedValueOnce("active");
    const service = harness.service as unknown as {
      assertConfirmableSource(
        tx: unknown,
        entry: unknown,
        actorUserId: string
      ): Promise<void>;
    };
    await expect(service.assertConfirmableSource(harness.tx, {
      dispute: {
        id: "c39f87da-8015-4241-8bbe-025903a11bb3",
        projectId: "project-1",
        businessCode: "争议资金-清分去重-001",
        affiliateAssignmentId: "assignment-1",
        fundHolderKind: "construction_enterprise",
        fundHolderId: "affiliate-version-1",
        disputeKind: "upstream",
        counterpartyKind: "owner",
        counterpartyId: "owner-1",
        counterpartyNameSnapshot: "项目收尾资料整理",
        basisKind: "written_evidence",
        basisBusinessIdOrEvidenceSha256: "b".repeat(64),
        referenceCode: "正式待核对事项",
        economicIdentityKey: "c".repeat(64)
      },
      id: "a81b1c41-6d8d-42c5-8574-5b55b92822de",
      entryKind: "establish",
      adjustsEntryId: null,
      amountCents: 120000n,
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      evidenceLevel: "A",
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "建立争议资金",
      idempotencyKey: "ca5af90d-05e5-43cc-85f5-222f10557969",
      draftRevision: 1,
      payloadSnapshot: { replacementImpacts: [] },
      replacements: []
    }, "finance-director-1")).rejects.toThrow(/duplicate_blocked/u);
    expect(
      harness.clearingReconciliation
        .readProjectFundDisputeDuplicateInTransaction
    ).toHaveBeenCalledWith(harness.tx, {
      projectId: "project-1",
      constructionEnterpriseAssignmentId: "assignment-1",
      basisBusinessIdOrEvidenceSha256: "b".repeat(64),
      evidenceSha256
    });
  });

  it("rejects a draft update that tries to rewrite entry kind", async () => {
    const harness = createHarness();
    const baseDraft = {
      projectId: "project-1",
      businessCode: "争议资金-003",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "construction_enterprise" as const,
      fundHolderId: "affiliate-version-1",
      disputeKind: "upstream" as const,
      counterpartyKind: "owner",
      counterpartyId: "owner-1",
      counterpartyNameSnapshot: "项目收尾资料整理",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256,
      referenceCode: "经确认仍需完成的法定收尾资料",
      amountCents: "120000",
      occurredAt: "2026-09-01",
      evidenceLevel: "A" as const,
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "首次建立争议资金"
    };
    const created = await harness.service.saveDraft({
      ...baseDraft,
      entryKind: "establish",
      idempotencyKey: draftIdempotencyKey
    }, { userId: "finance-staff-1" });

    await expect(harness.service.saveDraft({
      ...baseDraft,
      disputeId: String(created.disputeId),
      entryId: String(created.id),
      entryKind: "increase",
      expectedRevision: 1,
      idempotencyKey: "3bde4be6-d966-424f-9b8d-0e608a0412e3"
    }, { userId: "finance-staff-1" })).rejects.toThrow(
      "争议资金分录类型与精确调整目标创建后不可改写"
    );
  });

  it("rejects an increase until the dispute establishment is confirmed", async () => {
    const harness = createHarness();
    const baseDraft = {
      projectId: "project-1",
      businessCode: "争议资金-004",
      affiliateAssignmentId: "assignment-1",
      fundHolderKind: "construction_enterprise" as const,
      fundHolderId: "affiliate-version-1",
      disputeKind: "upstream" as const,
      counterpartyKind: "owner",
      counterpartyId: "owner-1",
      counterpartyNameSnapshot: "项目收尾资料整理",
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256,
      referenceCode: "经确认仍需完成的法定收尾资料",
      amountCents: "120000",
      occurredAt: "2026-09-01",
      evidenceLevel: "A" as const,
      evidenceFileId: "file-1",
      evidenceSha256,
      disputeSummary: "争议资金变化"
    };
    const established = await harness.service.saveDraft({
      ...baseDraft,
      entryKind: "establish",
      idempotencyKey: draftIdempotencyKey
    }, { userId: "finance-staff-1" });

    await expect(harness.service.saveDraft({
      ...baseDraft,
      disputeId: String(established.disputeId),
      entryKind: "increase",
      idempotencyKey: "ae20fda4-06c9-4c9c-a84e-d3d958620eab"
    }, { userId: "finance-staff-1" })).rejects.toThrow(
      "争议资金建立分录确认后才能追加增加"
    );
  });
});
