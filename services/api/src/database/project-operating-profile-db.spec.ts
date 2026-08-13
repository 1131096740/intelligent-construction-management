import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";

const TEST_DATABASE = "jiangkong_database_dynamic_misc";
const LIVE_TEST_ENABLED = process.env.RUN_PROJECT_OPERATING_PROFILE_DB_TESTS === "1";

export function projectOperatingProfileDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("项目经营档案数据库测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("项目经营档案数据库测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("project operating profile database target guard", () => {
  it("rejects a production or non-local database target", () => {
    expect(() =>
      projectOperatingProfileDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("项目经营档案数据库测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? projectOperatingProfileDatabaseUrl(process.env.DATABASE_URL)
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describeDatabase("project operating profile PostgreSQL invariants", () => {
  const prisma = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : new PrismaClient();

  jest.setTimeout(15_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not lock on approval pending and locks when the expense becomes formal", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    const claimId = await createExpenseClaim(prisma, fixture, {
      status: "approval_pending",
      occurredOn: "2026-08-02"
    });

    await expect(prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } }))
      .resolves.toMatchObject({ constructionEnterpriseLockedAt: null });

    await prisma.expenseClaim.update({
      where: { id: claimId },
      data: {
        status: "approved_pending_payment",
        approvedAt: date("2026-08-02")
      }
    });

    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });
    expect(project.constructionEnterpriseLockedAt).not.toBeNull();
  });

  it("locks the configured construction enterprise on a pre-activation formal fact without assignment fields", async () => {
    const fixture = await createFixture(prisma, { participant: true });
    await createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-02"
    });

    await expect(prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } }))
      .resolves.toMatchObject({ constructionEnterpriseLockedAt: expect.any(Date) });
    await expect(prisma.projectAffiliateAssignment.update({
      where: { id: fixture.assignmentId },
      data: { endedAt: date("2026-08-02") }
    })).rejects.toThrow("施工企业已经锁定");
  });

  it("rejects a new formal fact before any construction enterprise is configured", async () => {
    const fixture = await createFixture(prisma, { participant: true });
    await prisma.projectAffiliateAssignment.delete({ where: { id: fixture.assignmentId } });

    await expect(
      createExpenseClaim(prisma, fixture, {
        status: "approved_pending_payment",
        occurredOn: "2026-08-02"
      })
    ).rejects.toThrow("正式经营事实发生前必须先设置唯一施工企业");
  });

  it("locks a later activation from an existing proxy-payment fact and then forbids clearing the date", async () => {
    const fixture = await createFixture(prisma, { participant: true });
    const voucherId = `profile-voucher-${randomUUID()}`;
    await prisma.fileObject.create({
      data: {
        id: voucherId,
        bucket: "private-local",
        objectKey: `tests/${voucherId}.pdf`,
        originalName: "代付凭证.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: fixture.financeUserId,
        storageStatus: "active"
      }
    });
    await prisma.projectProxyPayment.create({
      data: {
        projectId: fixture.projectId,
        paidAt: date("2026-08-03"),
        amountCents: 100n,
        generalContractorName: "总包单位",
        paidTargetName: "收款单位",
        paymentType: "other",
        description: "存量代付事实",
        voucherFileId: voucherId,
        recordedByUserId: fixture.financeUserId
      }
    });

    await prisma.project.update({
      where: { id: fixture.projectId },
      data: { operatingLedgerEffectiveDate: date("2026-08-01") }
    });
    const activated = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } });
    expect(activated.constructionEnterpriseLockedAt).not.toBeNull();
    await expect(
      prisma.project.update({
        where: { id: fixture.projectId },
        data: { operatingLedgerEffectiveDate: null }
      })
    ).rejects.toThrow("经营账生效日不能清空");
  });

  it("rejects a new receipt that predates the construction enterprise", async () => {
    const fixture = await createFixture(prisma, {
      participant: true,
      assignmentEffectiveFrom: "2026-07-15"
    });
    const receiptFileId = `profile-receipt-${randomUUID()}`;
    await prisma.fileObject.create({
      data: {
        id: receiptFileId,
        bucket: "private-local",
        objectKey: `tests/${receiptFileId}.pdf`,
        originalName: "收款凭证.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: fixture.financeUserId,
        storageStatus: "active"
      }
    });
    await expect(
      prisma.projectReceipt.create({
        data: {
          projectId: fixture.projectId,
          receivedAt: date("2026-07-01"),
          amountCents: 100n,
          payerName: "业主单位",
          sourceType: "owner_direct_payment",
          voucherFileId: receiptFileId,
          recordedByUserId: fixture.financeUserId
        }
      })
    ).rejects.toThrow("正式经营事实发生前必须先设置唯一施工企业");
  });

  it("revalidates the construction-enterprise period when a non-null ledger date moves earlier", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-10",
      participant: true,
      assignmentEffectiveFrom: "2026-08-05"
    });

    await expect(
      prisma.project.update({
        where: { id: fixture.projectId },
        data: { operatingLedgerEffectiveDate: date("2026-08-01") }
      })
    ).rejects.toThrow("施工企业生效日不得晚于经营账生效日");
  });

  it("rejects activation when an existing formal fact references a company outside its participation period", async () => {
    const fixture = await createFixture(prisma, { participant: false });
    const unrelated = await createCompany(prisma, fixture.financeUserId, "无关参与公司");
    await createParticipant(prisma, fixture.projectId, unrelated, fixture.financeUserId, {
      effectiveFrom: "2026-08-01"
    });
    await createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-02"
    });

    await expect(
      prisma.project.update({
        where: { id: fixture.projectId },
        data: { operatingLedgerEffectiveDate: date("2026-08-01") }
      })
    ).rejects.toThrow("公司未覆盖对应参与期间");
  });

  it("enforces the inclusive start and exclusive end of a participating-company period", async () => {
    const fixture = await createFixture(prisma, { participant: false });
    await createParticipant(prisma, fixture.projectId, fixture.company, fixture.financeUserId, {
      effectiveFrom: "2026-08-10",
      endedAt: "2026-08-11"
    });
    await prisma.project.update({
      where: { id: fixture.projectId },
      data: { operatingLedgerEffectiveDate: date("2026-08-10") }
    });

    await expect(createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-09"
    })).rejects.toThrow("已停止新增业务");
    await expect(createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-10"
    })).resolves.toEqual(expect.any(String));
    await expect(createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-11"
    })).rejects.toThrow("已停止新增业务");
  });

  it("serializes concurrent participant additions so only one interval wins", async () => {
    const fixture = await createFixture(prisma, { participant: false });
    const first = new ProjectOperatingProfileService(prisma as never);
    const second = new ProjectOperatingProfileService(prisma as never);
    const outcomes = await Promise.allSettled([
      first.addParticipatingCompany(fixture.projectId, fixture.financeUserId, {
        companyEntityId: fixture.company.id,
        effectiveFrom: "2026-08-01",
        changeReason: "并发新增验证"
      }),
      second.addParticipatingCompany(fixture.projectId, fixture.financeUserId, {
        companyEntityId: fixture.company.id,
        effectiveFrom: "2026-08-01",
        changeReason: "并发新增验证"
      })
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await expect(prisma.projectParticipatingCompany.count({
      where: { projectId: fixture.projectId, companyEntityId: fixture.company.id }
    })).resolves.toBe(1);
  });

  it("rejects directly truncating a participant period across an existing formal fact", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-12"
    });

    await expect(prisma.projectParticipatingCompany.update({
      where: { id: fixture.participantId! },
      data: { endedAt: date("2026-08-12") }
    })).rejects.toThrow("停止日期当日或之后已有正式经营事实，不能截断参与期间");
  });

  it("revalidates formal facts when an arranged stop date is moved earlier", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-12"
    });
    await prisma.projectParticipatingCompany.update({
      where: { id: fixture.participantId! },
      data: { endedAt: date("2026-08-20") }
    });

    await expect(prisma.projectParticipatingCompany.update({
      where: { id: fixture.participantId! },
      data: { endedAt: date("2026-08-10") }
    })).rejects.toThrow("停止日期当日或之后已有正式经营事实，不能截断参与期间");
  });

  it("rejects activation when a legacy formal fact references a replaced construction enterprise", async () => {
    const fixture = await createFixture(prisma, { participant: true });
    const voucherId = `profile-assignment-receipt-${randomUUID()}`;
    await prisma.fileObject.create({
      data: {
        id: voucherId,
        bucket: "private-local",
        objectKey: `tests/${voucherId}.pdf`,
        originalName: "历史收款凭证.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: fixture.financeUserId,
        storageStatus: "active"
      }
    });
    await prisma.projectReceipt.create({
      data: {
        projectId: fixture.projectId,
        receivedAt: date("2026-08-01"),
        amountCents: 100n,
        payerName: "业主单位",
        sourceType: "owner_direct_payment",
        affiliateAssignmentId: fixture.assignmentId,
        affiliateBusinessPartyVersionId: fixture.partyVersionId,
        affiliateNameSnapshot: "施工企业",
        voucherFileId: voucherId,
        recordedByUserId: fixture.financeUserId
      }
    });
    await prisma.project.update({
      where: { id: fixture.projectId },
      data: { constructionEnterpriseLockedAt: null }
    });
    await prisma.projectAffiliateAssignment.update({
      where: { id: fixture.assignmentId },
      data: { endedAt: date("2026-08-01") }
    });
    const replacement = await createConstructionAssignment(
      prisma,
      fixture.projectId,
      fixture.financeUserId,
      "替换施工企业",
      "2026-08-01"
    );

    await expect(prisma.project.update({
      where: { id: fixture.projectId },
      data: { operatingLedgerEffectiveDate: date("2026-08-01") }
    })).rejects.toThrow("正式经营事实引用的施工企业与当前映射不一致");
    expect(replacement.assignmentId).not.toBe(fixture.assignmentId);
  });

  it("serializes deactivation against a concurrent formal fact and preserves the fact period", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    const factClient = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const stopClient = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const factInserted = deferred<void>();
    const releaseFact = deferred<void>();

    try {
      const factTransaction = factClient.$transaction(async (tx) => {
        await createExpenseClaim(tx, fixture, {
          status: "approved_pending_payment",
          occurredOn: "2026-08-12"
        });
        factInserted.resolve();
        await releaseFact.promise;
      });
      await factInserted.promise;

      const stopOutcome = new ProjectOperatingProfileService(stopClient as never)
        .deactivateParticipatingCompany(
          fixture.projectId,
          fixture.participantId!,
          fixture.financeUserId,
          { endedOn: "2026-08-12", changeReason: "并发停用验证" }
        )
        .then(
          () => ({ status: "fulfilled" as const, error: null }),
          (error: unknown) => ({ status: "rejected" as const, error })
        );
      const stateBeforeFactCommit = await Promise.race([
        stopOutcome.then(() => "settled" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100))
      ]);
      releaseFact.resolve();
      await factTransaction;

      expect(stateBeforeFactCommit).toBe("blocked");
      const outcome = await stopOutcome;
      expect(outcome.status).toBe("rejected");
      expect(String(outcome.error)).toContain(
        "停止日期当日或之后已有正式经营事实，不能截断参与期间"
      );
      await expect(prisma.projectParticipatingCompany.findUniqueOrThrow({
        where: { id: fixture.participantId! }
      })).resolves.toMatchObject({ endedAt: null });
    } finally {
      releaseFact.resolve();
      await Promise.all([factClient.$disconnect(), stopClient.$disconnect()]);
    }
  });

  it("rejects creating a project with an already-enabled operating ledger", async () => {
    const suffix = randomUUID();
    await expect(prisma.project.create({
      data: {
        id: `profile-direct-active-${suffix}`,
        code: `POL02-DIRECT-${suffix}`,
        name: "非法直接启用经营账项目",
        operatingLedgerEffectiveDate: date("2026-08-01")
      }
    })).rejects.toThrow("经营账生效日必须在项目创建后通过项目设置启用");
  });

  it("rejects moving the current construction enterprise after an enabled ledger date", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await expect(prisma.projectAffiliateAssignment.update({
      where: { id: fixture.assignmentId },
      data: { effectiveFrom: date("2026-08-02") }
    })).rejects.toThrow("施工企业生效日不得晚于经营账生效日");
  });

  it("rejects mutating a locked construction-enterprise identity snapshot in place", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await createExpenseClaim(prisma, fixture, {
      status: "approved_pending_payment",
      occurredOn: "2026-08-02"
    });

    await expect(prisma.projectAffiliateAssignment.update({
      where: { id: fixture.assignmentId },
      data: { affiliateNameSnapshot: "被篡改的施工企业" }
    })).rejects.toThrow("施工企业已经锁定");
  });

  it("serializes activation against an unlisted-company formal fact", async () => {
    const fixture = await createFixture(prisma, { participant: false });
    const unrelated = await createCompany(prisma, fixture.financeUserId, "无关参与公司");
    await createParticipant(prisma, fixture.projectId, unrelated, fixture.financeUserId, {
      effectiveFrom: "2026-08-01"
    });
    const factClient = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const activationClient = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const factInserted = deferred<void>();
    const releaseFact = deferred<void>();

    try {
      const factTransaction = factClient.$transaction(async (tx) => {
        await createExpenseClaim(tx, fixture, {
          status: "approved_pending_payment",
          occurredOn: "2026-08-02"
        });
        factInserted.resolve();
        await releaseFact.promise;
      });
      await factInserted.promise;
      const activationOutcome = activationClient.project.update({
        where: { id: fixture.projectId },
        data: { operatingLedgerEffectiveDate: date("2026-08-01") }
      }).then(
        () => ({ status: "fulfilled" as const, error: null }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );
      const stateBeforeFactCommit = await Promise.race([
        activationOutcome.then(() => "settled" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100))
      ]);
      releaseFact.resolve();
      await factTransaction;

      expect(stateBeforeFactCommit).toBe("blocked");
      const outcome = await activationOutcome;
      expect(outcome.status).toBe("rejected");
      expect(String(outcome.error)).toContain("公司未覆盖对应参与期间");
      await expect(prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } }))
        .resolves.toMatchObject({ operatingLedgerEffectiveDate: null });
    } finally {
      releaseFact.resolve();
      await Promise.all([factClient.$disconnect(), activationClient.$disconnect()]);
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function date(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function createFixture(
  prisma: PrismaClient,
  options: {
    operatingLedgerEffectiveDate?: string;
    participant: boolean;
    assignmentEffectiveFrom?: string;
  }
) {
  const suffix = randomUUID();
  const financeUserId = `profile-finance-${suffix}`;
  const projectId = `profile-project-${suffix}`;
  const partyId = `profile-party-${suffix}`;
  const partyVersionId = `profile-party-version-${suffix}`;
  await prisma.user.create({ data: { id: financeUserId, name: "项目财务", isActive: true } });
  await prisma.project.create({
    data: {
      id: projectId,
      code: `POL02-${suffix}`,
      name: "经营档案隔离测试项目"
    }
  });
  await prisma.projectMember.create({
    data: { projectId, userId: financeUserId, positionKey: "finance_staff" }
  });
  await prisma.businessParty.create({
    data: {
      id: partyId,
      name: "施工企业",
      unifiedSocialCreditCode: `BUILD-${suffix}`,
      createdByUserId: financeUserId
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: partyVersionId,
      businessPartyId: partyId,
      versionNo: 1,
      snapshot: { name: "施工企业", unifiedSocialCreditCode: `BUILD-${suffix}` },
      createdByUserId: financeUserId
    }
  });
  const assignment = await prisma.projectAffiliateAssignment.create({
    data: {
      projectId,
      businessPartyId: partyId,
      businessPartyVersionId: partyVersionId,
      affiliateNameSnapshot: "施工企业",
      affiliateCreditCodeSnapshot: `BUILD-${suffix}`,
      effectiveFrom: date(options.assignmentEffectiveFrom ?? "2026-07-01"),
      changeReason: "数据库约束测试",
      assignedByUserId: financeUserId
    }
  });
  const company = await createCompany(prisma, financeUserId, "我方公司");
  const participant = options.participant
    ? await createParticipant(prisma, projectId, company, financeUserId, {
      effectiveFrom: "2026-08-01"
    })
    : null;
  if (options.operatingLedgerEffectiveDate) {
    await prisma.project.update({
      where: { id: projectId },
      data: { operatingLedgerEffectiveDate: date(options.operatingLedgerEffectiveDate) }
    });
  }
  return {
    financeUserId,
    projectId,
    assignmentId: assignment.id,
    partyVersionId,
    company,
    participantId: participant?.id ?? null
  };
}

async function createConstructionAssignment(
  prisma: PrismaClient,
  projectId: string,
  actorUserId: string,
  name: string,
  effectiveFrom: string
) {
  const suffix = randomUUID();
  const partyId = `profile-party-${suffix}`;
  const partyVersionId = `profile-party-version-${suffix}`;
  await prisma.businessParty.create({
    data: {
      id: partyId,
      name,
      unifiedSocialCreditCode: `BUILD-${suffix}`,
      createdByUserId: actorUserId
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: partyVersionId,
      businessPartyId: partyId,
      versionNo: 1,
      snapshot: { name, unifiedSocialCreditCode: `BUILD-${suffix}` },
      createdByUserId: actorUserId
    }
  });
  const assignment = await prisma.projectAffiliateAssignment.create({
    data: {
      projectId,
      businessPartyId: partyId,
      businessPartyVersionId: partyVersionId,
      affiliateNameSnapshot: name,
      affiliateCreditCodeSnapshot: `BUILD-${suffix}`,
      effectiveFrom: date(effectiveFrom),
      changeReason: "数据库约束替换测试",
      assignedByUserId: actorUserId
    }
  });
  return { assignmentId: assignment.id, partyVersionId };
}

async function createCompany(prisma: PrismaClient, actorUserId: string, name: string) {
  const suffix = randomUUID();
  const company = await prisma.companyEntity.create({
    data: {
      id: `profile-company-${suffix}`,
      name,
      unifiedSocialCreditCode: `COMPANY-${suffix}`,
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  const version = await prisma.companyEntityVersion.create({
    data: {
      id: `profile-company-version-${suffix}`,
      companyEntityId: company.id,
      versionNo: 1,
      name,
      unifiedSocialCreditCode: company.unifiedSocialCreditCode,
      isActive: true,
      action: "create",
      actorUserId,
      actorRoleKey: "finance_staff"
    }
  });
  return { ...company, versionId: version.id };
}

function createParticipant(
  prisma: PrismaClient,
  projectId: string,
  company: { id: string; name: string; unifiedSocialCreditCode: string | null; versionId: string },
  actorUserId: string,
  period: { effectiveFrom: string; endedAt?: string }
) {
  return prisma.projectParticipatingCompany.create({
    data: {
      projectId,
      companyEntityId: company.id,
      companyEntityVersionId: company.versionId,
      companyNameSnapshot: company.name,
      companyCreditCodeSnapshot: company.unifiedSocialCreditCode,
      effectiveFrom: date(period.effectiveFrom),
      endedAt: period.endedAt ? date(period.endedAt) : null,
      changeReason: "数据库约束测试",
      addedByUserId: actorUserId
    }
  });
}

async function createExpenseClaim(
  prisma: PrismaClient | Prisma.TransactionClient,
  fixture: { projectId: string; financeUserId: string; company: { id: string; name: string } },
  input: { status: string; occurredOn: string }
) {
  const id = `profile-claim-${randomUUID()}`;
  await prisma.expenseClaim.create({
    data: {
      id,
      code: `POL02-CLAIM-${randomUUID()}`,
      claimType: "reimbursement",
      status: input.status,
      companyEntityId: fixture.company.id,
      companyEntityNameSnapshot: fixture.company.name,
      projectId: fixture.projectId,
      applicantUserId: fixture.financeUserId,
      applicantNameSnapshot: "测试申请人",
      handledByUserId: fixture.financeUserId,
      handledByNameSnapshot: "项目财务",
      reason: "项目经营档案数据库约束测试",
      requestedAmountCents: 100n,
      companyPayableAmountCents: 100n,
      submittedAt: date(input.occurredOn),
      approvedAt: input.status === "approval_pending" ? null : date(input.occurredOn)
    }
  });
  return id;
}
