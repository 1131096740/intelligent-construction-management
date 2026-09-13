import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingFactSubjects
} from "../operating-ledger/operating-ledger.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";

const TEST_DATABASE = "jiangkong_database_dynamic_misc";
const PARTICIPANT_HISTORY_TEST_DATABASE = "jiangkong_participant_history_integrity_test";
const LIVE_TEST_ENABLED = process.env.RUN_PROJECT_OPERATING_PROFILE_DB_TESTS === "1";
const PARTICIPANT_HISTORY_LIVE_TEST_ENABLED =
  process.env.RUN_PARTICIPANT_HISTORY_INTEGRITY_DATABASE === "1";
const PARTICIPANT_HISTORY_RUNTIME_ROLE =
  `pol284_runtime_${randomUUID().replace(/-/gu, "").slice(0, 16)}`;

export function projectOperatingProfileDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("项目经营档案数据库测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    ![`/${TEST_DATABASE}`, `/${PARTICIPANT_HISTORY_TEST_DATABASE}`].includes(
      url.pathname
    )
  ) {
    throw new Error("项目经营档案数据库测试拒绝非本机专用数据库");
  }
  return url.toString();
}

export function participantHistoryIntegrityDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("参与公司历史完整性测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${PARTICIPANT_HISTORY_TEST_DATABASE}`
  ) {
    throw new Error("参与公司历史完整性测试拒绝非本机专用数据库");
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

  it("rejects a non-dedicated participant-history target", () => {
    expect(() => participantHistoryIntegrityDatabaseUrl(
      "postgresql://user:pass@127.0.0.1/jiangkong_database_dynamic_misc"
    )).toThrow("参与公司历史完整性测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? projectOperatingProfileDatabaseUrl(process.env.DATABASE_URL)
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;
const participantHistoryDatabaseUrl = PARTICIPANT_HISTORY_LIVE_TEST_ENABLED
  ? participantHistoryIntegrityDatabaseUrl(
    process.env.PARTICIPANT_HISTORY_INTEGRITY_DATABASE_URL ?? process.env.DATABASE_URL
  )
  : undefined;
const describeParticipantHistory = PARTICIPANT_HISTORY_LIVE_TEST_ENABLED
  ? describe
  : describe.skip;

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
    await addFallbackParticipant(prisma, fixture);
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
    await addFallbackParticipant(prisma, fixture);
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
    await addFallbackParticipant(prisma, fixture);
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

describeParticipantHistory("POL-284 participant history integrity on PostgreSQL 16", () => {
  const prisma = participantHistoryDatabaseUrl
    ? new PrismaClient({ datasources: { db: { url: participantHistoryDatabaseUrl } } })
    : new PrismaClient();

  jest.setTimeout(180_000);

  beforeAll(async () => {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!secret) throw new Error("POL-284 PostgreSQL 测试缺少经营账写入密钥");
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, crypt(${secret}, gen_salt('bf')))
      ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
    `);
    await prisma.$executeRawUnsafe(
      `CREATE ROLE "${PARTICIPANT_HISTORY_RUNTIME_ROLE}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
    );
    await prisma.$executeRawUnsafe(
      `GRANT "${PARTICIPANT_HISTORY_RUNTIME_ROLE}" TO CURRENT_USER`
    );
    await prisma.$executeRawUnsafe(
      `GRANT USAGE ON SCHEMA public TO "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
    );
    await prisma.$executeRawUnsafe(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
    );
    await prisma.$executeRawUnsafe(
      `GRANT UPDATE, DELETE ON TABLE public."ProjectParticipatingCompany" TO "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
    );
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION public."serializeProjectParticipatingCompanyMutation"(TEXT) TO "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
    );
  });

  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(
        `DROP OWNED BY "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
      );
      await prisma.$executeRawUnsafe(
        `REVOKE "${PARTICIPANT_HISTORY_RUNTIME_ROLE}" FROM CURRENT_USER`
      );
      await prisma.$executeRawUnsafe(
        `DROP ROLE "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("blocks DELETE and end-date for all six fact roles through stable and frozen identities", async () => {
    const roles: Array<keyof OperatingFactSubjects> = [
      "debtor", "creditor", "approvedPayer", "actualPayer", "payee", "costBearingCompany"
    ];
    for (const role of roles) {
      for (const identity of ["stable", "version"] as const) {
        for (const mutation of ["delete", "end"] as const) {
          const fixture = await createFixture(prisma, {
            operatingLedgerEffectiveDate: "2026-08-01",
            participant: true
          });
          await addFallbackParticipant(prisma, fixture);
          const targetId = identity === "stable" ? fixture.company.id : fixture.company.versionId;
          await new OperatingLedgerService(prisma as never).appendFromSource(
            participantFactInput(fixture, `${role}-${identity}-${mutation}`, role, targetId),
            fixture.financeUserId
          );

          const operation = mutation === "delete"
            ? prisma.projectParticipatingCompany.delete({ where: { id: fixture.participantId! } })
            : prisma.projectParticipatingCompany.update({
              where: { id: fixture.participantId! },
              data: { endedAt: date("2026-08-14") }
            });
          await expect(operation).rejects.toThrow(
            mutation === "delete"
              ? "该公司已有正式经营事实"
              : "停止日期当日或之后已有正式经营事实"
          );
        }
      }
    }
  });

  it("protects independent impact subjects through stable and frozen identities", async () => {
    for (const identity of ["stable", "version"] as const) {
      for (const mutation of ["delete", "end"] as const) {
        const fixture = await createFixture(prisma, {
          operatingLedgerEffectiveDate: "2026-08-01",
          participant: true
        });
        await addFallbackParticipant(prisma, fixture);
        const targetId = identity === "stable" ? fixture.company.id : fixture.company.versionId;
        const input = participantFactInput(
          fixture,
          `impact-${identity}-${mutation}`,
          "costBearingCompany",
          fixture.partyVersionId
        );
        input.subjects.costBearingCompany = {
          kind: "construction_enterprise",
          id: fixture.partyVersionId
        };
        input.impacts[0] = {
          ...input.impacts[0]!,
          subjectRole: "cost_bearing_company",
          subject: { kind: "participating_company", id: targetId }
        };
        await new OperatingLedgerService(prisma as never).appendFromSource(
          input,
          fixture.financeUserId
        );

        const operation = mutation === "delete"
          ? prisma.projectParticipatingCompany.delete({ where: { id: fixture.participantId! } })
          : prisma.projectParticipatingCompany.update({
            where: { id: fixture.participantId! },
            data: { endedAt: date("2026-08-14") }
          });
        await expect(operation).rejects.toThrow(
          mutation === "delete"
            ? "该公司已有正式经营事实"
            : "停止日期当日或之后已有正式经营事实"
        );
      }
    }
  });

  it("allows empty deletion, a later stop, and ignores other companies or projects", async () => {
    const empty = await createFixture(prisma, { participant: true });
    await expect(prisma.projectParticipatingCompany.delete({
      where: { id: empty.participantId! }
    })).resolves.toBeDefined();

    const later = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await addFallbackParticipant(prisma, later);
    await new OperatingLedgerService(prisma as never).appendFromSource(
      participantFactInput(later, "later-end", "costBearingCompany", later.company.versionId),
      later.financeUserId
    );
    await expect(prisma.projectParticipatingCompany.update({
      where: { id: later.participantId! },
      data: { endedAt: date("2026-08-15") }
    })).resolves.toMatchObject({ endedAt: date("2026-08-15") });

    const sameProject = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    const other = await addFallbackParticipant(prisma, sameProject);
    await new OperatingLedgerService(prisma as never).appendFromSource(
      participantFactInput(sameProject, "other-company", "costBearingCompany", other.versionId),
      sameProject.financeUserId
    );
    await expect(prisma.projectParticipatingCompany.delete({
      where: { id: sameProject.participantId! }
    })).resolves.toBeDefined();

    const firstProject = await createFixture(prisma, { participant: true });
    const secondProject = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await createParticipant(
      prisma,
      secondProject.projectId,
      firstProject.company,
      secondProject.financeUserId,
      { effectiveFrom: "2026-08-01" }
    );
    await new OperatingLedgerService(prisma as never).appendFromSource(
      participantFactInput(
        secondProject,
        "cross-project",
        "costBearingCompany",
        firstProject.company.versionId
      ),
      secondProject.financeUserId
    );
    await expect(prisma.projectParticipatingCompany.delete({
      where: { id: firstProject.participantId! }
    })).resolves.toBeDefined();
  });

  it("serializes fact and independent-impact writes against DELETE and end-date in both commit orders", async () => {
    for (const reference of ["fact", "impact"] as const) {
      for (const mutation of ["delete", "end"] as const) {
        for (const first of ["writer", "mutation"] as const) {
          await expect(runParticipantMutationRace(prisma, participantHistoryDatabaseUrl!, {
            reference,
            mutation,
            first
          })).resolves.toBeUndefined();
        }
      }
    }
  });

  it("maps a real Repeatable Read 40001 to 409 without retry or dirty fact", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    await addFallbackParticipant(prisma, fixture);
    const snapshotClient = new PrismaClient({
      datasources: { db: { url: participantHistoryDatabaseUrl! } }
    });
    const mutationClient = new PrismaClient({
      datasources: { db: { url: participantHistoryDatabaseUrl! } }
    });
    const snapshotReady = deferred<void>();
    const continueWrite = deferred<void>();
    const input = participantFactInput(
      fixture,
      "repeatable-read-40001",
      "costBearingCompany",
      fixture.company.versionId
    );
    let attempts = 0;
    try {
      const write = snapshotClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ProjectParticipatingCompany"
          WHERE "id" = ${fixture.participantId!}
        `);
        snapshotReady.resolve();
        await continueWrite.promise;
        attempts += 1;
        return new OperatingLedgerService(snapshotClient as never)
          .appendConfirmedSourceInTransaction(tx, input, fixture.financeUserId);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      await snapshotReady.promise;
      await mutationClient.projectParticipatingCompany.update({
        where: { id: fixture.participantId! },
        data: { endedAt: date("2026-08-14") }
      });
      continueWrite.resolve();

      const outcome = await settled(write);
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(ConflictException);
        expect((outcome.reason as ConflictException).getStatus()).toBe(409);
        expect(String((outcome.reason as Error).message)).toContain("并发状态变化");
      }
      expect(attempts).toBe(1);
      await expect(prisma.operatingFact.count({
        where: { sourceBusinessId: input.sourceBusinessId }
      })).resolves.toBe(0);
    } finally {
      continueWrite.resolve();
      await Promise.all([snapshotClient.$disconnect(), mutationClient.$disconnect()]);
    }
  });

  it("locks inverse multi-participant stable/version roles without deadlock", async () => {
    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    const secondCompany = await addFallbackParticipant(prisma, fixture);
    const first = participantFactInput(
      fixture,
      "inverse-first",
      "debtor",
      fixture.company.id
    );
    first.factKind = "owner_settlement";
    first.subjects = {
      debtor: { kind: "participating_company", id: fixture.company.id },
      creditor: { kind: "participating_company", id: secondCompany.versionId }
    };
    const second = participantFactInput(
      fixture,
      "inverse-second",
      "debtor",
      secondCompany.id
    );
    second.factKind = "owner_settlement";
    second.subjects = {
      debtor: { kind: "participating_company", id: secondCompany.id },
      creditor: { kind: "participating_company", id: fixture.company.versionId }
    };
    const firstClient = new PrismaClient({ datasources: { db: { url: participantHistoryDatabaseUrl! } } });
    const secondClient = new PrismaClient({ datasources: { db: { url: participantHistoryDatabaseUrl! } } });
    try {
      const outcomes = await Promise.allSettled([
        new OperatingLedgerService(firstClient as never).appendFromSource(first, fixture.financeUserId),
        new OperatingLedgerService(secondClient as never).appendFromSource(second, fixture.financeUserId)
      ]);
      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
      expect(outcomes.map(describeOutcome).join(" ")).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
  });

  it("serializes operating-ledger activation against direct end-date in both commit orders", async () => {
    for (const first of ["activation", "end"] as const) {
      await expect(runActivationEndRace(
        prisma,
        participantHistoryDatabaseUrl!,
        first
      )).resolves.toBeUndefined();
    }
  });

  it("preserves all five legacy formal-flow guards against direct end-date in both commit orders", async () => {
    for (const flow of [
      "contract_version",
      "affiliate_company_contract",
      "expense_claim",
      "spot_payment",
      "payment_execution_allocation"
    ] as const) {
      for (const first of ["writer", "end"] as const) {
        await expect(runLegacyFlowEndRace(
          prisma,
          participantHistoryDatabaseUrl!,
          flow,
          first
        )).resolves.toBeUndefined();
      }
    }
  });

  it("serializes different-participant exits through the project fence at every supported isolation level", async () => {
    for (const isolationLevel of [
      Prisma.TransactionIsolationLevel.ReadCommitted,
      Prisma.TransactionIsolationLevel.RepeatableRead,
      Prisma.TransactionIsolationLevel.Serializable
    ]) {
      for (const [firstMutation, secondMutation] of [
        ["delete", "delete"],
        ["end", "end"],
        ["delete", "end"],
        ["end", "delete"]
      ] as const) {
        for (const [firstEndedOn, secondEndedOn] of [
          ["2026-08-01", "2026-08-01"],
          ["2026-08-14", "2026-08-14"],
          ["2026-08-10", "2026-08-20"],
          ["2026-08-20", "2026-08-10"]
        ] as const) {
          await expect(runLastParticipantMutationRace(
            prisma,
            participantHistoryDatabaseUrl!,
            isolationLevel,
            firstMutation,
            secondMutation,
            firstEndedOn,
            secondEndedOn
          )).resolves.toBeUndefined();
        }
      }
    }
  });

  it("lets the least-privileged runtime role use the fixed-schema fence without direct fence writes", async () => {
    const updateFixture = await createFixture(prisma, { participant: true });
    const deleteFixture = await createFixture(prisma, { participant: true });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL ROLE "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
      );
      await tx.$executeRawUnsafe("SET LOCAL search_path = pg_temp, public");
      await expect(tx.$executeRaw(Prisma.sql`
        UPDATE public."ProjectParticipatingCompany"
        SET "endedAt" = DATE '2026-08-14'
        WHERE "id" = ${updateFixture.participantId!}
      `)).resolves.toBe(1);
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL ROLE "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
      );
      await tx.$executeRawUnsafe("SET LOCAL search_path = pg_temp, public");
      await expect(tx.$executeRaw(Prisma.sql`
        DELETE FROM public."ProjectParticipatingCompany"
        WHERE "id" = ${deleteFixture.participantId!}
      `)).resolves.toBe(1);
    });

    const directFenceWrite = await settled(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL ROLE "${PARTICIPANT_HISTORY_RUNTIME_ROLE}"`
      );
      return tx.$executeRaw(Prisma.sql`
        INSERT INTO public."ProjectParticipatingCompanyMutationFence"
          ("projectId", "revision")
        VALUES (${`${updateFixture.projectId}-forbidden`}, 1)
      `);
    }));
    expect(directFenceWrite.status).toBe("rejected");
    if (directFenceWrite.status === "rejected") {
      expect(sqlState(directFenceWrite.reason)).toBe("42501");
    }

    const fenceRows = await prisma.projectParticipatingCompanyMutationFence.findMany({
      where: { projectId: { in: [updateFixture.projectId, deleteFixture.projectId] } },
      select: { projectId: true, revision: true }
    });
    expect(fenceRows).toEqual(expect.arrayContaining([
      { projectId: updateFixture.projectId, revision: 1n },
      { projectId: deleteFixture.projectId, revision: 1n }
    ]));
  });

  it("preserves terminal validator semantics and uses all seven directed indexes with the default planner", async () => {
    const [factDefinition] = await prisma.$queryRaw<Array<{ definition: string }>>(Prisma.sql`
      SELECT pg_get_functiondef('"validateOperatingFactReferences"()'::regprocedure) AS definition
    `);
    const [impactDefinition] = await prisma.$queryRaw<Array<{ definition: string }>>(Prisma.sql`
      SELECT pg_get_functiondef('"validateOperatingImpactEntryReferences"()'::regprocedure) AS definition
    `);
    expect(factDefinition?.definition).toContain("downstream_counterparty");
    expect(factDefinition?.definition).toContain("employee");
    expect(factDefinition?.definition).toContain("jg_validate_canonical_wage_operating_fact");
    expect(impactDefinition?.definition).toContain("fund_execution");
    expect(impactDefinition?.definition).toContain("经营影响累计冲销金额超过原分录");

    const fixture = await createFixture(prisma, {
      operatingLedgerEffectiveDate: "2026-08-01",
      participant: true
    });
    const roleColumns = [
      ["debtor", "debtorSubjectKind", "debtorSubjectId"],
      ["creditor", "creditorSubjectKind", "creditorSubjectId"],
      ["approvedPayer", "approvedPayerSubjectKind", "approvedPayerSubjectId"],
      ["actualPayer", "actualPayerSubjectKind", "actualPayerSubjectId"],
      ["payee", "payeeSubjectKind", "payeeSubjectId"],
      ["costBearingCompany", "costBearingCompanySubjectKind", "costBearingCompanySubjectId"]
    ] as const;
    for (const [role] of roleColumns) {
      await new OperatingLedgerService(prisma as never).appendFromSource(
        participantFactInput(fixture, `plan-${role}`, role, fixture.company.versionId),
        fixture.financeUserId
      );
    }
    const impactInput = participantFactInput(
      fixture,
      "plan-impact",
      "costBearingCompany",
      fixture.partyVersionId
    );
    impactInput.subjects.costBearingCompany = {
      kind: "construction_enterprise",
      id: fixture.partyVersionId
    };
    impactInput.impacts[0] = {
      ...impactInput.impacts[0]!,
      subjectRole: "cost_bearing_company",
      subject: { kind: "participating_company", id: fixture.company.versionId }
    };
    await new OperatingLedgerService(prisma as never).appendFromSource(
      impactInput,
      fixture.financeUserId
    );
    const noiseCompany = await addFallbackParticipant(prisma, fixture);
    await seedRepresentativeParticipantIndexData(prisma, fixture, noiseCompany);
    await prisma.$executeRawUnsafe(
      'ANALYZE "OperatingFact", "OperatingImpactEntry"'
    );

    const factEndDatePlan = await explainIndexPlan(
      prisma,
      `SELECT 1
       FROM "OperatingFact" fact
       WHERE fact."projectId" = $1
         AND fact."occurredAt" >= $4::timestamp
         AND (
           (fact."debtorSubjectKind" = 'participating_company' AND fact."debtorSubjectId" IN ($2, $3))
           OR (fact."creditorSubjectKind" = 'participating_company' AND fact."creditorSubjectId" IN ($2, $3))
           OR (fact."approvedPayerSubjectKind" = 'participating_company' AND fact."approvedPayerSubjectId" IN ($2, $3))
           OR (fact."actualPayerSubjectKind" = 'participating_company' AND fact."actualPayerSubjectId" IN ($2, $3))
           OR (fact."payeeSubjectKind" = 'participating_company' AND fact."payeeSubjectId" IN ($2, $3))
           OR (fact."costBearingCompanySubjectKind" = 'participating_company' AND fact."costBearingCompanySubjectId" IN ($2, $3))
         )`,
      fixture.projectId,
      fixture.company.id,
      fixture.company.versionId,
      "2026-08-14"
    );
    const factDeletePlan = await explainIndexPlan(
      prisma,
      `SELECT 1
       FROM "OperatingFact" fact
       WHERE fact."projectId" = $1
         AND (
           (fact."debtorSubjectKind" = 'participating_company' AND fact."debtorSubjectId" IN ($2, $3))
           OR (fact."creditorSubjectKind" = 'participating_company' AND fact."creditorSubjectId" IN ($2, $3))
           OR (fact."approvedPayerSubjectKind" = 'participating_company' AND fact."approvedPayerSubjectId" IN ($2, $3))
           OR (fact."actualPayerSubjectKind" = 'participating_company' AND fact."actualPayerSubjectId" IN ($2, $3))
           OR (fact."payeeSubjectKind" = 'participating_company' AND fact."payeeSubjectId" IN ($2, $3))
           OR (fact."costBearingCompanySubjectKind" = 'participating_company' AND fact."costBearingCompanySubjectId" IN ($2, $3))
         )`,
      fixture.projectId,
      fixture.company.id,
      fixture.company.versionId
    );
    for (const [role] of roleColumns) {
      expect(factEndDatePlan).toContain(`OperatingFact_participant_${role}_history_idx`);
      expect(factDeletePlan).toContain(`OperatingFact_participant_${role}_history_idx`);
    }
    expect(factEndDatePlan).not.toContain('Seq Scan on "OperatingFact"');
    expect(factDeletePlan).not.toContain('Seq Scan on "OperatingFact"');

    const impactEndDatePlan = await explainIndexPlan(
      prisma,
      `SELECT 1
       FROM "OperatingImpactEntry" impact
       INNER JOIN "OperatingFact" fact ON fact."id" = impact."factId"
       WHERE impact."projectId" = $1
         AND impact."subjectKind" = 'participating_company'
         AND impact."subjectId" IN ($2, $3)
         AND fact."occurredAt" >= $4::timestamp`,
      fixture.projectId,
      fixture.company.id,
      fixture.company.versionId,
      "2026-08-14"
    );
    const impactDeletePlan = await explainIndexPlan(
      prisma,
      `SELECT 1
       FROM "OperatingImpactEntry" impact
       WHERE impact."projectId" = $1
         AND impact."subjectKind" = 'participating_company'
         AND impact."subjectId" IN ($2, $3)`,
      fixture.projectId,
      fixture.company.id,
      fixture.company.versionId
    );
    expect(impactEndDatePlan).toContain("OperatingImpactEntry_participant_subject_history_idx");
    expect(impactDeletePlan).toContain("OperatingImpactEntry_participant_subject_history_idx");
    expect(impactEndDatePlan).not.toContain('Seq Scan on "OperatingImpactEntry"');
    expect(impactDeletePlan).not.toContain('Seq Scan on "OperatingImpactEntry"');
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
      normalizedName: `施工企业-${suffix}`,
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
    affiliateNameSnapshot: assignment.affiliateNameSnapshot,
    affiliateCreditCodeSnapshot: assignment.affiliateCreditCodeSnapshot,
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
      normalizedName: `${name}-${suffix}`,
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

async function addFallbackParticipant(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>
) {
  const company = await createCompany(prisma, fixture.financeUserId, "备用我方公司");
  await createParticipant(prisma, fixture.projectId, company, fixture.financeUserId, {
    effectiveFrom: "2026-08-01"
  });
  return company;
}

function participantFactInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  suffix: string,
  role: keyof OperatingFactSubjects,
  participantId: string
): AppendOperatingFactInput {
  const subjects: OperatingFactSubjects = {
    costBearingCompany: {
      kind: "construction_enterprise",
      id: fixture.partyVersionId
    }
  };
  subjects[role] = { kind: "participating_company", id: participantId };
  return {
    projectId: fixture.projectId,
    sourceType: "pol284_participant_history_test",
    sourceBusinessId: `pol284-${suffix}-${randomUUID()}`,
    sourceBusinessCode: `POL284-${suffix}`,
    sourceVersion: 1,
    idempotencyKey: `pol284-${suffix}-${randomUUID()}`,
    occurredAt: date("2026-08-14"),
    confirmedAt: new Date("2026-08-14T01:00:00.000Z"),
    confirmedByUserId: fixture.financeUserId,
    factKind: "expense",
    operatingLevel: "project",
    evidenceLevel: "A",
    amountCents: 100n,
    currencyCode: "CNY",
    direction: "outflow",
    isBeforeOperatingLedgerEffectiveDate: false,
    affiliateAssignmentId: fixture.assignmentId,
    affiliateBusinessPartyVersionId: fixture.partyVersionId,
    affiliateNameSnapshot: fixture.affiliateNameSnapshot,
    affiliateCreditCodeSnapshot: fixture.affiliateCreditCodeSnapshot ?? undefined,
    sourceSnapshot: { source: "POL-284 PostgreSQL 16 acceptance", suffix },
    subjects,
    impacts: [{
      idempotencyKey: `pol284-impact-${suffix}-${randomUUID()}`,
      sourceImpactKey: "confirmed-cost",
      impactKind: "confirmed_cost",
      amountCents: 100n,
      direction: "increase",
      costCategoryCode: "project_daily_expense",
      impactSnapshot: { source: "POL-284 PostgreSQL 16 acceptance" }
    }]
  };
}

async function explainIndexPlan(
  prisma: PrismaClient,
  sql: string,
  ...parameters: unknown[]
) {
  const rows = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
    ...parameters
  );
  return rows.map((row) => row["QUERY PLAN"]).join("\n");
}

async function seedRepresentativeParticipantIndexData(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  noiseCompany: Awaited<ReturnType<typeof addFallbackParticipant>>
) {
  const roles: Array<keyof OperatingFactSubjects> = [
    "debtor", "creditor", "approvedPayer", "actualPayer", "payee", "costBearingCompany"
  ];
  await prisma.$transaction(async (tx) => {
    const ledger = new OperatingLedgerService(prisma as never);
    for (let index = 0; index < 1_200; index += 1) {
      const role = roles[index % roles.length]!;
      const input = participantFactInput(
        fixture,
        `plan-noise-${index}`,
        role,
        noiseCompany.versionId
      );
      input.impacts[0] = {
        ...input.impacts[0]!,
        subjectRole: "cost_bearing_company",
        subject: { kind: "participating_company", id: noiseCompany.versionId }
      };
      await ledger.appendConfirmedSourceInTransaction(tx, input, fixture.financeUserId);
    }
  }, { timeout: 60_000 });
}

type ParticipantMutationRace = {
  reference: "fact" | "impact";
  mutation: "delete" | "end";
  first: "writer" | "mutation";
};

async function runParticipantMutationRace(
  prisma: PrismaClient,
  databaseUrl: string,
  scenario: ParticipantMutationRace
) {
  const fixture = await createFixture(prisma, {
    operatingLedgerEffectiveDate: "2026-08-01",
    participant: true
  });
  await addFallbackParticipant(prisma, fixture);
  const input = participantFactInput(
    fixture,
    `${scenario.reference}-${scenario.mutation}-${scenario.first}`,
    "costBearingCompany",
    scenario.reference === "fact" ? fixture.company.versionId : fixture.partyVersionId
  );
  if (scenario.reference === "impact") {
    input.subjects.costBearingCompany = {
      kind: "construction_enterprise",
      id: fixture.partyVersionId
    };
    input.impacts[0] = {
      ...input.impacts[0]!,
      subjectRole: "cost_bearing_company",
      subject: { kind: "participating_company", id: fixture.company.versionId }
    };
  }
  const writerClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const mutationClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const firstStatementDone = deferred<void>();
  const releaseFirst = deferred<void>();
  try {
    if (scenario.first === "writer") {
      const writer = writerClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        const result = await new OperatingLedgerService(writerClient as never)
          .appendConfirmedSourceInTransaction(tx, input, fixture.financeUserId);
        firstStatementDone.resolve();
        await releaseFirst.promise;
        return result;
      });
      await firstStatementDone.promise;
      const mutation = mutationClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        return mutateParticipant(tx, fixture.participantId!, scenario.mutation);
      });
      await expectBlocked(mutation);
      releaseFirst.resolve();
      await writer;
      const mutationOutcome = await settled(mutation);
      expect(mutationOutcome.status).toBe("rejected");
      if (mutationOutcome.status === "rejected") {
        if (sqlState(mutationOutcome.reason) !== "23514") {
          throw new Error(
            `${scenario.reference}/${scenario.mutation}/${scenario.first}: ${describeOutcome(mutationOutcome)}`
          );
        }
        expect(describeOutcome(mutationOutcome)).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
      }
      await expect(prisma.operatingFact.count({
        where: { sourceBusinessId: input.sourceBusinessId }
      })).resolves.toBe(1);
      await expect(prisma.projectParticipatingCompany.findUnique({
        where: { id: fixture.participantId! }
      })).resolves.toMatchObject({ endedAt: null });
      return;
    }

    const mutation = mutationClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      const result = await mutateParticipant(tx, fixture.participantId!, scenario.mutation);
      firstStatementDone.resolve();
      await releaseFirst.promise;
      return result;
    });
    await firstStatementDone.promise;
    const writer = writerClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      return new OperatingLedgerService(writerClient as never)
        .appendConfirmedSourceInTransaction(tx, input, fixture.financeUserId);
    });
    await expectBlocked(writer);
    releaseFirst.resolve();
    await mutation;
    const writerOutcome = await settled(writer);
    expect(writerOutcome.status).toBe("rejected");
    if (writerOutcome.status === "rejected") {
      const message = describeOutcome(writerOutcome);
      const rejectedByResolvedParticipantSnapshot = scenario.reference === "impact"
        && message.includes("影响分录引用的我方公司未在本项目事实日参与");
      if (sqlState(writerOutcome.reason) !== "23514" && !rejectedByResolvedParticipantSnapshot) {
        throw new Error(
          `${scenario.reference}/${scenario.mutation}/${scenario.first}: ${message}`
        );
      }
      expect(message).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
    }
    await expect(prisma.operatingFact.count({
      where: { sourceBusinessId: input.sourceBusinessId }
    })).resolves.toBe(0);
    const participant = await prisma.projectParticipatingCompany.findUnique({
      where: { id: fixture.participantId! }
    });
    if (scenario.mutation === "delete") expect(participant).toBeNull();
    else expect(participant?.endedAt).toEqual(date("2026-08-14"));
  } finally {
    releaseFirst.resolve();
    await Promise.all([writerClient.$disconnect(), mutationClient.$disconnect()]);
  }
}

async function runLastParticipantMutationRace(
  prisma: PrismaClient,
  databaseUrl: string,
  isolationLevel: Prisma.TransactionIsolationLevel,
  firstMutation: "delete" | "end",
  secondMutation: "delete" | "end",
  firstEndedOn: string,
  secondEndedOn: string
) {
  const fixture = await createFixture(prisma, {
    operatingLedgerEffectiveDate: "2026-08-01",
    participant: true
  });
  const secondCompany = await addFallbackParticipant(prisma, fixture);
  const secondParticipant = await prisma.projectParticipatingCompany.findFirstOrThrow({
    where: {
      projectId: fixture.projectId,
      companyEntityId: secondCompany.id
    },
    select: { id: true }
  });
  const firstClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const secondClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const firstStatementDone = deferred<void>();
  const releaseFirst = deferred<void>();
  try {
    const first = firstClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      const result = await mutateParticipantForExit(
        tx,
        fixture.participantId!,
        firstMutation,
        firstEndedOn
      );
      firstStatementDone.resolve();
      await releaseFirst.promise;
      return result;
    }, { isolationLevel });
    await waitForFirstStatement(firstStatementDone.promise, first);

    if (
      isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted
      && firstMutation === "delete"
      && secondMutation === "delete"
    ) {
      await expect(prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "Project"
        WHERE "id" = ${fixture.projectId}
        FOR UPDATE NOWAIT
      `)).resolves.toEqual([{ id: fixture.projectId }]);
    }

    const second = secondClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      return mutateParticipantForExit(
        tx,
        secondParticipant.id,
        secondMutation,
        secondEndedOn
      );
    }, { isolationLevel });
    await expectBlocked(second);
    releaseFirst.resolve();
    await expect(first).resolves.toBe(1);

    const secondOutcome = await settled(second);
    expect(secondOutcome.status).toBe("rejected");
    if (secondOutcome.status === "rejected") {
      expect(sqlState(secondOutcome.reason)).toBe(
        isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted
          ? "23514"
          : "40001"
      );
      expect(describeOutcome(secondOutcome)).not.toMatch(
        /40P01|55P03|deadlock|lock timeout/iu
      );
    }

    const unboundedParticipantCount = await prisma.projectParticipatingCompany.count({
      where: {
        projectId: fixture.projectId,
        effectiveFrom: { lte: date("2026-08-01") },
        endedAt: null
      }
    });
    expect(unboundedParticipantCount).toBe(1);
    const [coverage] = await prisma.$queryRaw<Array<{ covered: boolean }>>(Prisma.sql`
      SELECT "hasProjectParticipatingCompanyCoverage"(
        ${fixture.projectId},
        ${"__no_participant_excluded__"}
      ) AS covered
    `);
    expect(coverage?.covered).toBe(true);
  } finally {
    releaseFirst.resolve();
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
  }
}

async function runActivationEndRace(
  prisma: PrismaClient,
  databaseUrl: string,
  first: "activation" | "end"
) {
  const fixture = await createFixture(prisma, { participant: true });
  const activationClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const endClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const firstStatementDone = deferred<void>();
  const releaseFirst = deferred<void>();
  try {
    if (first === "activation") {
      const activation = activationClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        const result = await tx.$executeRaw(Prisma.sql`
          UPDATE "Project"
          SET "operatingLedgerEffectiveDate" = DATE '2026-08-01'
          WHERE "id" = ${fixture.projectId}
        `);
        firstStatementDone.resolve();
        await releaseFirst.promise;
        return result;
      });
      await firstStatementDone.promise;
      const end = endClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        return tx.$executeRaw(Prisma.sql`
          UPDATE "ProjectParticipatingCompany"
          SET "endedAt" = DATE '2026-08-01'
          WHERE "id" = ${fixture.participantId!}
        `);
      });
      await expectBlocked(end);
      releaseFirst.resolve();
      await activation;
      const endOutcome = await settled(end);
      expect(endOutcome.status).toBe("rejected");
      if (endOutcome.status === "rejected") {
        if (sqlState(endOutcome.reason) !== "23514") {
          throw new Error(`activation/${first}: ${describeOutcome(endOutcome)}`);
        }
        expect(describeOutcome(endOutcome)).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
      }
      await expect(prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } }))
        .resolves.toMatchObject({ operatingLedgerEffectiveDate: date("2026-08-01") });
      await expect(prisma.projectParticipatingCompany.findUniqueOrThrow({
        where: { id: fixture.participantId! }
      })).resolves.toMatchObject({ endedAt: null });
      return;
    }

    const end = endClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      const result = await tx.$executeRaw(Prisma.sql`
        UPDATE "ProjectParticipatingCompany"
        SET "endedAt" = DATE '2026-08-01'
        WHERE "id" = ${fixture.participantId!}
      `);
      firstStatementDone.resolve();
      await releaseFirst.promise;
      return result;
    });
    await firstStatementDone.promise;
    const activation = activationClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      return tx.$executeRaw(Prisma.sql`
        UPDATE "Project"
        SET "operatingLedgerEffectiveDate" = DATE '2026-08-01'
        WHERE "id" = ${fixture.projectId}
      `);
    });
    await expectBlocked(activation);
    releaseFirst.resolve();
    await end;
    const activationOutcome = await settled(activation);
    expect(activationOutcome.status).toBe("rejected");
    if (activationOutcome.status === "rejected") {
      expect(sqlState(activationOutcome.reason)).toBe("23514");
      expect(describeOutcome(activationOutcome)).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
    }
    await expect(prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId } }))
      .resolves.toMatchObject({ operatingLedgerEffectiveDate: null });
    await expect(prisma.projectParticipatingCompany.findUniqueOrThrow({
      where: { id: fixture.participantId! }
    })).resolves.toMatchObject({ endedAt: date("2026-08-01") });
  } finally {
    releaseFirst.resolve();
    await Promise.all([activationClient.$disconnect(), endClient.$disconnect()]);
  }
}

type LegacyFormalFlow =
  | "contract_version"
  | "affiliate_company_contract"
  | "expense_claim"
  | "spot_payment"
  | "payment_execution_allocation";

type PreparedLegacyFlow = {
  write: (tx: Prisma.TransactionClient) => Promise<unknown>;
  count: (client: PrismaClient) => Promise<number>;
};

async function runLegacyFlowEndRace(
  prisma: PrismaClient,
  databaseUrl: string,
  flow: LegacyFormalFlow,
  first: "writer" | "end"
) {
  const fixture = await createFixture(prisma, {
    operatingLedgerEffectiveDate: "2026-08-01",
    participant: true
  });
  await addFallbackParticipant(prisma, fixture);
  const prepared = await prepareLegacyFlow(prisma, fixture, flow);
  const writerClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const endClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const firstStatementDone = deferred<void>();
  const releaseFirst = deferred<void>();
  try {
    if (first === "writer") {
      const writer = writerClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        const result = await prepared.write(tx);
        firstStatementDone.resolve();
        await releaseFirst.promise;
        return result;
      });
      await waitForFirstStatement(firstStatementDone.promise, writer);
      const end = endClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
        return tx.$executeRaw(Prisma.sql`
          UPDATE "ProjectParticipatingCompany"
          SET "endedAt" = DATE '2026-08-14'
          WHERE "id" = ${fixture.participantId!}
        `);
      });
      await expectBlocked(end);
      releaseFirst.resolve();
      await writer;
      const endOutcome = await settled(end);
      expect(endOutcome.status).toBe("rejected");
      if (endOutcome.status === "rejected") {
        if (sqlState(endOutcome.reason) !== "23514") {
          throw new Error(`${flow}/${first}: ${describeOutcome(endOutcome)}`);
        }
        expect(describeOutcome(endOutcome)).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
      }
      await expect(prepared.count(prisma)).resolves.toBe(1);
      await expect(prisma.projectParticipatingCompany.findUniqueOrThrow({
        where: { id: fixture.participantId! }
      })).resolves.toMatchObject({ endedAt: null });
      return;
    }

    const end = endClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      const result = await tx.$executeRaw(Prisma.sql`
        UPDATE "ProjectParticipatingCompany"
        SET "endedAt" = DATE '2026-08-14'
        WHERE "id" = ${fixture.participantId!}
      `);
      firstStatementDone.resolve();
      await releaseFirst.promise;
      return result;
    });
    await waitForFirstStatement(firstStatementDone.promise, end);
    const writer = writerClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      return prepared.write(tx);
    });
    await expectBlocked(writer);
    releaseFirst.resolve();
    await end;
    const writerOutcome = await settled(writer);
    expect(writerOutcome.status).toBe("rejected");
    if (writerOutcome.status === "rejected") {
      if (sqlState(writerOutcome.reason) !== "23514") {
        throw new Error(`${flow}/${first}: ${describeOutcome(writerOutcome)}`);
      }
      expect(describeOutcome(writerOutcome)).not.toMatch(/40P01|55P03|deadlock|lock timeout/i);
    }
    await expect(prepared.count(prisma)).resolves.toBe(0);
    await expect(prisma.projectParticipatingCompany.findUniqueOrThrow({
      where: { id: fixture.participantId! }
    })).resolves.toMatchObject({ endedAt: date("2026-08-14") });
  } finally {
    releaseFirst.resolve();
    await Promise.all([writerClient.$disconnect(), endClient.$disconnect()]);
  }
}

async function prepareLegacyFlow(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  flow: LegacyFormalFlow
): Promise<PreparedLegacyFlow> {
  const id = `pol284-${flow}-${randomUUID()}`;
  if (flow === "expense_claim") {
    return {
      write: (tx) => createExpenseClaim(tx, fixture, {
        status: "approved_pending_payment",
        occurredOn: "2026-08-14"
      }),
      count: (client) => client.expenseClaim.count({
        where: { projectId: fixture.projectId, status: "approved_pending_payment" }
      })
    };
  }

  if (flow === "contract_version") {
    const contract = await prisma.contract.create({
      data: {
        id: `${id}-contract`,
        projectId: fixture.projectId,
        code: `${id}-code`,
        name: "POL-284 合同流程",
        counterparty: "测试相对方",
        companyEntityId: fixture.company.id,
        companyEntityName: fixture.company.name
      }
    });
    return {
      write: (tx) => tx.contractVersion.create({
        data: {
          id,
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "effective",
          amountCents: 100n,
          effectiveAt: date("2026-08-14"),
          companyEntityIdSnapshot: fixture.company.id,
          companyEntityVersionId: fixture.company.versionId,
          companyEntityNameSnapshot: fixture.company.name,
          companyEntityCreditCodeSnapshot: fixture.company.unifiedSocialCreditCode,
          signingSubjectType: "our_company",
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: {}
        }
      }),
      count: (client) => client.contractVersion.count({ where: { id } })
    };
  }

  if (flow === "affiliate_company_contract") {
    const documentFile = await createPol284File(prisma, fixture.financeUserId, `${id}-document`, "application/pdf", "a");
    const signatureFile = await createPol284File(prisma, fixture.financeUserId, `${id}-signature`, "image/png", "c");
    const signature = await prisma.handwrittenSignatureVersion.create({
      data: {
        id: `${id}-signature-version`,
        userId: fixture.financeUserId,
        fileId: signatureFile.id,
        contentSha256: "c".repeat(64),
        source: "canvas"
      }
    });
    return {
      write: (tx) => tx.projectAffiliateCompanyContract.create({
        data: {
          id,
          projectId: fixture.projectId,
          contractReference: `${id}-reference`,
          contractName: "POL-284 参与公司合同",
          signedAt: date("2026-08-14"),
          rightsObligationsSummary: "参与公司合同并发守卫验证",
          affiliateAssignmentId: fixture.assignmentId,
          affiliateBusinessPartyVersionId: fixture.partyVersionId,
          affiliateNameSnapshot: fixture.affiliateNameSnapshot,
          affiliateCreditCodeSnapshot: fixture.affiliateCreditCodeSnapshot,
          companyEntityId: fixture.company.id,
          companyEntityVersionId: fixture.company.versionId,
          companyEntityNameSnapshot: fixture.company.name,
          companyEntityCreditCodeSnapshot: fixture.company.unifiedSocialCreditCode!,
          fileId: documentFile.id,
          fileContentSha256Snapshot: "a".repeat(64),
          idempotencyKey: randomUUID(),
          requestFingerprint: "b".repeat(64),
          recordedByUserId: fixture.financeUserId,
          recordedByRoleKey: "contract_staff",
          status: "confirmed",
          confirmedByUserId: fixture.financeUserId,
          confirmedAt: date("2026-08-14"),
          confirmationActionId: randomUUID(),
          confirmationSignatureVersionId: signature.id,
          confirmationSignatureFileId: signatureFile.id,
          confirmationSignatureSha256: "c".repeat(64)
        }
      }),
      count: (client) => client.projectAffiliateCompanyContract.count({ where: { id } })
    };
  }

  if (flow === "spot_payment") {
    const procurementId = `${id}-procurement`;
    const versionId = `${id}-version`;
    await prisma.spotProcurement.create({
      data: {
        id: procurementId,
        projectId: fixture.projectId,
        code: `${id}-procurement-code`,
        applicantUserId: fixture.financeUserId,
        handlerUserId: fixture.financeUserId,
        status: "approved_in_progress"
      }
    });
    await prisma.spotProcurementVersion.create({
      data: {
        id: versionId,
        procurementId,
        versionNo: 1,
        status: "approved",
        reason: "POL-284 并发验证",
        handlerUserId: fixture.financeUserId,
        applicationDepartmentSnapshot: "财务部",
        applicationNameSnapshot: "零星采购",
        purchaserNameSnapshot: "项目财务",
        purchaserDepartmentNameSnapshot: "财务部",
        requestedArrivalAt: date("2026-08-14"),
        approvedAt: date("2026-08-14"),
        createdByUserId: fixture.financeUserId
      }
    });
    await prisma.spotProcurement.update({
      where: { id: procurementId },
      data: { currentVersionId: versionId }
    });
    return {
      write: (tx) => tx.spotProcurementPayment.create({
        data: {
          id,
          projectId: fixture.projectId,
          procurementId,
          procurementVersionId: versionId,
          code: `${id}-payment-code`,
          status: "approved_pending_payment",
          settlementAmountCents: 100n,
          companyPaymentAmountCents: 100n,
          approvalAmountCents: 100n,
          payerCompanyEntityId: fixture.company.id,
          payerCompanyNameSnapshot: fixture.company.name,
          payerUnifiedSocialCreditCodeSnapshot: fixture.company.unifiedSocialCreditCode,
          handlerUserId: fixture.financeUserId,
          createdByUserId: fixture.financeUserId,
          approvedAt: date("2026-08-14")
        }
      }),
      count: (client) => client.spotProcurementPayment.count({ where: { id } })
    };
  }

  const contractId = `${id}-contract`;
  const contractVersionId = `${id}-contract-version`;
  const termsId = `${id}-terms`;
  const settlementId = `${id}-settlement`;
  const requestId = `${id}-request`;
  const executionId = `${id}-execution`;
  await prisma.contract.create({
    data: {
      id: contractId,
      projectId: fixture.projectId,
      code: `${id}-contract-code`,
      name: "POL-284 付款分配合同",
      counterparty: "测试相对方",
      companyEntityId: fixture.company.id,
      companyEntityName: fixture.company.name
    }
  });
  await prisma.contractVersion.create({
    data: {
      id: contractVersionId,
      contractId,
      versionNo: 1,
      changeType: "original",
      status: "draft",
      amountCents: 100n,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await prisma.paymentTermsVersion.create({
    data: {
      id: termsId,
      contractId,
      contractVersionId,
      versionNo: 1,
      status: "effective",
      originalText: "测试付款条件"
    }
  });
  await prisma.settlement.create({
    data: {
      id: settlementId,
      projectId: fixture.projectId,
      contractId,
      contractVersionId,
      paymentTermsVersionId: termsId,
      code: `${id}-settlement-code`,
      periodLabel: "2026-08",
      status: "effective",
      amountCents: 100n,
      payableAmountCents: 100n
    }
  });
  await prisma.paymentRequest.create({
    data: {
      id: requestId,
      projectId: fixture.projectId,
      settlementId,
      sourceType: "settlement",
      contractId,
      contractVersionId,
      paymentTermsVersionId: termsId,
      code: `${id}-request-code`,
      status: "approved_pending_payment",
      requestedAmountCents: 100n,
      approvedAmountCents: 100n,
      paymentSubjectType: "our_company"
    }
  });
  const voucher = await createPol284File(prisma, fixture.financeUserId, `${id}-voucher`, "application/pdf", "d");
  await prisma.paymentExecution.create({
    data: {
      id: executionId,
      idempotencyKey: randomUUID(),
      paymentRequestId: requestId,
      settlementId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: fixture.company.id,
      companyEntityNameSnapshot: fixture.company.name,
      companyEntityCreditCodeSnapshot: fixture.company.unifiedSocialCreditCode!,
      amountCents: 100n,
      paidAt: date("2026-08-14"),
      executedByUserId: fixture.financeUserId,
      voucherFileId: voucher.id
    }
  });
  return {
    write: (tx) => tx.paymentExecutionAllocation.create({
      data: {
        id,
        paymentExecutionId: executionId,
        paymentRequestId: requestId,
        projectId: fixture.projectId,
        contractId,
        contractVersionId,
        settlementId,
        sourceType: "contract_due",
        allocationType: "contract_due_payment",
        sourceRowId: settlementId,
        paymentTermsVersionId: termsId,
        stageType: "progress",
        sourcePayableAmountCents: 100n,
        amountCents: 100n,
        allocationOrder: 1,
        createdByUserId: fixture.financeUserId
      }
    }),
    count: (client) => client.paymentExecutionAllocation.count({ where: { id } })
  };
}

async function createPol284File(
  prisma: PrismaClient,
  userId: string,
  id: string,
  mimeType: string,
  hashCharacter: string
) {
  return prisma.fileObject.create({
    data: {
      id,
      bucket: "private-local",
      objectKey: `tests/${id}`,
      originalName: id,
      mimeType,
      sizeBytes: 100,
      uploadedByUserId: userId,
      contentSha256: hashCharacter.repeat(64),
      storageStatus: "active"
    }
  });
}

async function waitForFirstStatement<T>(ready: Promise<void>, transaction: Promise<T>) {
  await Promise.race([
    ready,
    transaction.then(
      () => Promise.reject(new Error("transaction ended before its hold point")),
      (error) => Promise.reject(error)
    )
  ]);
}

function mutateParticipant(
  tx: Prisma.TransactionClient,
  participantId: string,
  mutation: "delete" | "end"
) {
  return mutation === "delete"
    ? tx.$executeRaw(Prisma.sql`
      DELETE FROM "ProjectParticipatingCompany" WHERE "id" = ${participantId}
    `)
    : tx.$executeRaw(Prisma.sql`
      UPDATE "ProjectParticipatingCompany"
      SET "endedAt" = DATE '2026-08-14'
      WHERE "id" = ${participantId}
    `);
}

function mutateParticipantForExit(
  tx: Prisma.TransactionClient,
  participantId: string,
  mutation: "delete" | "end",
  endedOn: string
) {
  return mutation === "delete"
    ? tx.$executeRaw(Prisma.sql`
      DELETE FROM "ProjectParticipatingCompany" WHERE "id" = ${participantId}
    `)
    : tx.$executeRaw(Prisma.sql`
      UPDATE "ProjectParticipatingCompany"
      SET "endedAt" = ${date(endedOn)}
      WHERE "id" = ${participantId}
    `);
}

async function expectBlocked<T>(operation: Promise<T>) {
  const state = await Promise.race([
    operation.then(() => "settled" as const, () => "settled" as const),
    new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100))
  ]);
  expect(state).toBe("blocked");
}

async function settled<T>(operation: Promise<T>): Promise<
  { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown }
> {
  try {
    return { status: "fulfilled", value: await operation };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function sqlState(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = error as { code?: unknown; meta?: { code?: unknown; sqlstate?: unknown } };
  if (typeof value.meta?.code === "string") return value.meta.code;
  if (typeof value.meta?.sqlstate === "string") return value.meta.sqlstate;
  if (typeof value.code === "string" && /^\d{5}$/u.test(value.code)) return value.code;
  return String(error).match(/code: ["']?(\d{5})/u)?.[1] ?? null;
}

function describeOutcome(outcome: PromiseSettledResult<unknown> | Awaited<ReturnType<typeof settled>>) {
  return outcome.status === "fulfilled"
    ? "fulfilled"
    : String((outcome.reason as { message?: unknown })?.message ?? outcome.reason);
}
