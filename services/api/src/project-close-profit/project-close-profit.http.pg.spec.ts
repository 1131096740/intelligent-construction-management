import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";
import { createApiValidationPipe } from "../validation/api-validation";

const describePg = process.env.RUN_POL109_PROJECT_CLOSE_PG16 === "1" ? describe : describe.skip;

describePg("POL-109 project close real HTTP / PostgreSQL 16", () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  const prisma = new PrismaClient();
  let baseUrl = "";
  let operatingProfile: ProjectOperatingProfileService;
  const projectId = "seed-project-jgxm-001";
  const password = process.env.SEED_PASSWORD ?? "";

  async function request(
    path: string,
    token: string,
    method = "GET",
    body?: unknown
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Connection: "close"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }

  async function login(phone: string) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ phone, password })
    });
    expect(response.status).toBe(201);
    return (await response.json()).tokens.accessToken as string;
  }

  function commandBody(fingerprint: string, idempotencyKey = randomUUID()) {
    return {
      expectedProjectionFingerprint: fingerprint,
      idempotencyKey,
      basis: { summary: "POL-109 真实 HTTP 合成验收", evidenceFileIds: [] }
    };
  }

  function confirmationBody(
    fingerprint: string,
    submissionId: string,
    idempotencyKey = randomUUID()
  ) {
    return {
      expectedProjectionFingerprint: fingerprint,
      idempotencyKey,
      submissionId
    };
  }

  async function workbench(token: string) {
    const response = await request(`/projects/${projectId}/close-profit`, token);
    if (response.status !== 200) {
      throw new Error(`项目收口工作台读取失败 ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return response.body;
  }

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? "");
    const writeSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
    if (
      process.env.NODE_ENV === "production" ||
      database.hostname !== "127.0.0.1" ||
      database.pathname !== "/jiangkong_pol109" ||
      password.length < 12 ||
      !writeSecret
    ) {
      throw new Error("仅允许本机一次性 POL-109 PostgreSQL 16 合成验收");
    }
    await prisma.$executeRaw`
      INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, crypt(${writeSecret}, gen_salt('bf')))
      ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
    `;
    await prisma.user.updateMany({
      where: { id: { startsWith: "seed-user-" } },
      data: { mustChangePassword: false }
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    operatingProfile = moduleRef.get(ProjectOperatingProfileService);
    app.useGlobalPipes(createApiValidationPipe());
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it("completes seven stages and real positive, loss, and zero submit-confirm decision cycles", async () => {
    const financeStaffPosition = await prisma.position.findUniqueOrThrow({ where: { key: "finance_staff" } });
    const movementSubmitterPhone = `109${Date.now()}`;
    const movementSubmitterUser = await prisma.user.create({
      data: {
        name: "POL-109 合成资金提交人",
        phone: movementSubmitterPhone,
        passwordHash: await hash(password, 4),
        mustChangePassword: false
      }
    });
    await prisma.userPosition.create({ data: {
      userId: movementSubmitterUser.id,
      positionId: financeStaffPosition.id,
      projectId: null
    } });
    const [
      projectManager,
      contractDirector,
      financeDirector,
      chairman,
      generalManager,
      superAdmin,
      reader,
      movementCreator,
      movementSubmitter
    ] = await Promise.all([
      login("13800001003"),
      login("13800001004"),
      login("13800001007"),
      login("13800001001"),
      login("13800001002"),
      login("13800001015"),
      login("13800001014"),
      login("13800000002"),
      login(movementSubmitterPhone)
    ]);

    await operatingProfile.updateProfile(
      projectId,
      "seed-user-finance-director",
      { operatingLedgerEffectiveDate: "2026-01-01" }
    );

    const affiliate = await prisma.projectAffiliateAssignment.findFirstOrThrow({
      where: { projectId, endedAt: null },
      select: {
        id: true,
        businessPartyVersionId: true,
        affiliateNameSnapshot: true,
        affiliateCreditCodeSnapshot: true
      }
    });
    const ledger = app.get(OperatingLedgerService);
    const occurredAt = new Date("2026-09-18T08:00:00.000Z");
    const enterprise = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
    const commonFact = {
      projectId,
      sourceVersion: 1,
      occurredAt,
      confirmedAt: occurredAt,
      confirmedByUserId: "seed-user-finance-director",
      operatingLevel: "project" as const,
      evidenceLevel: "A" as const,
      amountCents: 10_000n,
      currencyCode: "CNY",
      direction: "inflow" as const,
      isBeforeOperatingLedgerEffectiveDate: false,
      affiliateAssignmentId: affiliate.id,
      affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.affiliateNameSnapshot,
      ...(affiliate.affiliateCreditCodeSnapshot
        ? { affiliateCreditCodeSnapshot: affiliate.affiliateCreditCodeSnapshot }
        : {})
    };
    await ledger.appendFromSource({
      ...commonFact,
      sourceType: "pol109_acceptance_owner_settlement",
      sourceBusinessId: "pol109-income-1",
      sourceBusinessCode: "POL109-SR-001",
      idempotencyKey: "pol109:acceptance:income:fact",
      factKind: "owner_settlement",
      sourceSnapshot: { fixture: "POL-109 positive profit" },
      subjects: {
        debtor: { kind: "owner", id: "pol109-owner" },
        creditor: enterprise
      },
      impacts: [{
        idempotencyKey: "pol109:acceptance:income:impact",
        sourceImpactKey: "confirmed-income",
        impactKind: "confirmed_income",
        amountCents: 10_000n,
        direction: "increase"
      }]
    }, "seed-user-finance-director");
    await ledger.appendFromSource({
      ...commonFact,
      sourceType: "pol109_acceptance_owner_payment",
      sourceBusinessId: "pol109-cash-1",
      sourceBusinessCode: "POL109-SK-001",
      idempotencyKey: "pol109:acceptance:cash:fact",
      factKind: "owner_payment",
      sourceSnapshot: { fixture: "POL-109 distributable cash" },
      subjects: {
        actualPayer: { kind: "owner", id: "pol109-owner" },
        payee: enterprise
      },
      impacts: [{
        idempotencyKey: "pol109:acceptance:cash:impact",
        sourceImpactKey: "enterprise-cash",
        impactKind: "construction_enterprise_funds_increase",
        amountCents: 10_000n,
        direction: "increase",
        subjectRole: "payee",
        subject: enterprise
      }]
    }, "seed-user-finance-director");

    const extraCompanies = await Promise.all(["纳入", "排除"].map(async (label) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
      const company = await prisma.companyEntity.create({
        data: {
          name: `POL-109 cutoff ${label}公司`,
          unifiedSocialCreditCode: `P109${suffix}`,
          dataStatus: "complete",
          currentVersionNo: 1
        }
      });
      return prisma.companyEntityVersion.create({
        data: {
          companyEntityId: company.id,
          versionNo: 1,
          name: company.name,
          unifiedSocialCreditCode: company.unifiedSocialCreditCode,
          isActive: true,
          action: "pol109_acceptance_fixture",
          actorUserId: "seed-user-finance-director"
        }
      });
    }));
    const [cutoffIncluded, cutoffExcluded] = await Promise.all(extraCompanies.map((company, index) =>
      prisma.projectParticipatingCompany.create({
        data: {
          projectId,
          companyEntityId: company.companyEntityId,
          companyEntityVersionId: company.id,
          companyNameSnapshot: company.name,
          companyCreditCodeSnapshot: company.unifiedSocialCreditCode,
          effectiveFrom: new Date(index === 0 ? "2020-01-01" : "2099-01-01"),
          endedAt: index === 0 ? new Date("2099-12-31") : null,
          changeReason: index === 0 ? "cutoff 结束日在未来" : "cutoff 生效日在未来",
          addedByUserId: "seed-user-finance-director"
        }
      })
    ));

    const initial = await workbench(projectManager);
    expect(initial.participatingCompanies.map((row: { id: string }) => row.id))
      .toEqual(expect.arrayContaining([cutoffIncluded.id]));
    expect(initial.participatingCompanies.map((row: { id: string }) => row.id))
      .not.toContain(cutoffExcluded.id);
    expect(initial.stages).toHaveLength(7);
    expect(initial.stages[0]).toMatchObject({ key: "construction_completed", status: "ready" });
    expect(initial.stages.slice(1).every((stage: { status: string }) => stage.status === "pending")).toBe(true);

    const adminView = await workbench(superAdmin);
    expect(adminView.availableActions).toEqual([]);
    const deniedStageCompletion = await request(
      `/projects/${projectId}/close-profit/stages/construction_completed/complete`,
      superAdmin,
      "POST",
      commandBody(adminView.projection.fingerprint)
    );
    if (deniedStageCompletion.status !== 403) {
      throw new Error(`super_admin 阶段拒绝状态异常：${JSON.stringify(deniedStageCompletion)}`);
    }
    const impactCountBeforeDeniedReconcile = await prisma.projectCloseImpact.count({
      where: { projectId }
    });
    for (const deniedToken of [reader, superAdmin]) {
      expect((await request(
        `/projects/${projectId}/close-profit/impacts/reconcile`,
        deniedToken,
        "POST",
        commandBody(initial.projection.fingerprint)
      )).status).toBe(403);
    }
    expect(await prisma.projectCloseImpact.count({ where: { projectId } }))
      .toBe(impactCountBeforeDeniedReconcile);

    const stageOneKey = randomUUID();
    const stageOneBody = commandBody(initial.projection.fingerprint, stageOneKey);
    const stageOnePath = `/projects/${projectId}/close-profit/stages/construction_completed/complete`;
    const firstCompletion = await request(stageOnePath, projectManager, "POST", stageOneBody);
    expect(firstCompletion.status).toBe(201);
    const replay = await request(stageOnePath, projectManager, "POST", stageOneBody);
    expect(replay).toEqual(firstCompletion);

    let current = await workbench(contractDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/stages/owner_settlement_completed/complete`,
      contractDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);

    current = await workbench(contractDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/downstream-cost/attestations/contract`,
      contractDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);
    expect((await workbench(contractDirector)).stages[2].status).toBe("ready");

    current = await workbench(financeDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/downstream-cost/attestations/finance`,
      financeDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);

    current = await workbench(financeDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/stages/tax_and_enterprise_clearing_completed/complete`,
      financeDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);

    current = await workbench(financeDirector);
    const temporaryOverflowCounts = async () => ({
      temporaryDistributions: await prisma.projectTemporaryProfitDistribution.count({
        where: { projectId }
      }),
      authorizations: await prisma.projectProfitDistributionAuthorization.count({
        where: { projectId }
      }),
      receipts: await prisma.projectCloseCommandReceipt.count({ where: { projectId } }),
      stageVersions: await prisma.projectCloseStageVersion.count({ where: { projectId } }),
      audits: await prisma.auditLog.count({
        where: { action: "project_close.temporary_distribution.create" }
      })
    });
    const beforeTemporaryOverflow = await temporaryOverflowCounts();
    const temporaryOverflow = await request(
      `/projects/${projectId}/close-profit/temporary-distributions`,
      financeDirector,
      "POST",
      {
        ...commandBody(current.projection.fingerprint),
        projectParticipatingCompanyId: current.participatingCompanies[0].id,
        amountCents: "9223372036854775808"
      }
    );
    expect(temporaryOverflow.status).toBe(400);
    expect(temporaryOverflow.body.message).toBe("暂分金额超出系统可保存范围");
    expect(await temporaryOverflowCounts()).toEqual(beforeTemporaryOverflow);

    const distributable = BigInt(current.projection.view.distribution.currentDistributableProfitCents);
    if (distributable > 0n) {
      const idempotencyKey = randomUUID();
      const concurrent = await Promise.all([
        request(
          `/projects/${projectId}/close-profit/temporary-distributions`,
          financeDirector,
          "POST",
          {
            ...commandBody(current.projection.fingerprint, idempotencyKey),
            projectParticipatingCompanyId: current.participatingCompanies[0].id,
            amountCents: "1"
          }
        ),
        request(
          `/projects/${projectId}/close-profit/temporary-distributions`,
          financeDirector,
          "POST",
          {
            ...commandBody(current.projection.fingerprint, idempotencyKey),
            projectParticipatingCompanyId: current.participatingCompanies[0].id,
            amountCents: distributable > 1n ? "2" : "1"
          }
        )
      ]);
      expect(concurrent.filter((response) => response.status === 201)).toHaveLength(
        distributable > 1n ? 1 : 2
      );
      if (distributable > 1n) {
        expect(concurrent.some((response) => response.status === 409)).toBe(true);
      } else {
        expect(concurrent[1]).toEqual(concurrent[0]);
      }
      const successfulTemporary = concurrent.find((response) => response.status === 201);
      expect(successfulTemporary).toBeDefined();
      const afterTemporary = await workbench(financeDirector);
      expect(afterTemporary.temporaryDistributions).toHaveLength(1);
      expect(afterTemporary.temporaryDistributions[0]).toMatchObject({
        projectParticipatingCompanyId: current.participatingCompanies[0].id,
        amountCents: successfulTemporary?.body.amountCents
      });

      const otherProject = await prisma.project.create({
        data: {
          code: `POL109-IDEMP-${randomUUID()}`,
          name: "POL-109 跨项目幂等隔离验收"
        },
        select: { id: true }
      });
      await prisma.projectCloseAggregate.upsert({
        where: { projectId: otherProject.id }, create: { projectId: otherProject.id }, update: {}
      });
      expect((await request(
        `/projects/${otherProject.id}/close-profit/temporary-distributions`,
        financeDirector,
        "POST",
        {
          ...commandBody(current.projection.fingerprint, idempotencyKey),
          projectParticipatingCompanyId: current.participatingCompanies[0].id,
          amountCents: "1"
        }
      )).status).toBe(409);

      expect((await request(
        `/projects/${projectId}/close-profit/temporary-distributions`,
        financeDirector,
        "POST",
        {
          ...commandBody(current.projection.fingerprint),
          projectParticipatingCompanyId: "participant-from-another-project",
          amountCents: "1"
        }
      )).status).toBe(400);
    }

    current = await workbench(financeDirector);
    const finalProfitSubmission = await request(
      `/projects/${projectId}/close-profit/final-profit/submissions`,
      financeDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    );
    expect(finalProfitSubmission.status).toBe(201);
    current = await workbench(chairman);
    expect((await request(
      `/projects/${projectId}/close-profit/final-profit/confirm`,
      chairman,
      "POST",
      confirmationBody(current.projection.fingerprint, finalProfitSubmission.body.id)
    )).status).toBe(201);

    current = await workbench(financeDirector);
    const finalProfitCents = current.currentProfitConfirmation.finalProfitCents as string;
    const lines = current.participatingCompanies.map((company: { id: string }, index: number) => ({
      projectParticipatingCompanyId: company.id,
      finalShareCents: index === 0 ? finalProfitCents : "0"
    }));
    expect(lines.reduce((sum: bigint, line: { finalShareCents: string }) =>
      sum + BigInt(line.finalShareCents), 0n)).toBe(BigInt(finalProfitCents));
    expect((await request(
      `/projects/${projectId}/close-profit/distributions/submissions`,
      financeDirector,
      "POST",
      { ...commandBody(current.projection.fingerprint), lines: [] }
    )).status).toBe(400);
    expect(lines).toHaveLength(2);
    const distributionOverflowCounts = async () => ({
      submissions: await prisma.projectCloseDecisionSubmission.count({
        where: { projectId, decisionKind: "distribution" }
      }),
      distributions: await prisma.projectCloseDistribution.count({ where: { projectId } }),
      lines: await prisma.projectCloseDistributionLine.count({
        where: { distribution: { projectId } }
      }),
      authorizations: await prisma.projectProfitDistributionAuthorization.count({
        where: { projectId }
      }),
      receipts: await prisma.projectCloseCommandReceipt.count({ where: { projectId } }),
      stageVersions: await prisma.projectCloseStageVersion.count({ where: { projectId } }),
      audits: await prisma.auditLog.count({
        where: { action: "project_close.distribution.submit" }
      })
    });
    const beforeDistributionOverflow = await distributionOverflowCounts();
    for (const outOfRangeLines of [
      [
        { projectParticipatingCompanyId: lines[0].projectParticipatingCompanyId,
          finalShareCents: "9223372036854775808" },
        { projectParticipatingCompanyId: lines[1].projectParticipatingCompanyId,
          finalShareCents: (BigInt(finalProfitCents) - 9_223_372_036_854_775_808n).toString() }
      ],
      [
        { projectParticipatingCompanyId: lines[0].projectParticipatingCompanyId,
          finalShareCents: "-9223372036854775809" },
        { projectParticipatingCompanyId: lines[1].projectParticipatingCompanyId,
          finalShareCents: (BigInt(finalProfitCents) + 9_223_372_036_854_775_809n).toString() }
      ]
    ]) {
      const overflowResponse = await request(
        `/projects/${projectId}/close-profit/distributions/submissions`,
        financeDirector,
        "POST",
        { ...commandBody(current.projection.fingerprint), lines: outOfRangeLines }
      );
      expect(overflowResponse.status).toBe(400);
      expect(overflowResponse.body.message).toBe("公司分配金额超出系统可保存范围");
      expect(await distributionOverflowCounts()).toEqual(beforeDistributionOverflow);
    }
    expect((await request(
      `/projects/${projectId}/close-profit/distributions/submissions`,
      financeDirector,
      "POST",
      { ...commandBody(current.projection.fingerprint), lines: lines.slice(0, 1) }
    )).status).toBe(400);
    const distributionSubmission = await request(
      `/projects/${projectId}/close-profit/distributions/submissions`,
      financeDirector,
      "POST",
      { ...commandBody(current.projection.fingerprint), lines }
    );
    expect(distributionSubmission.status).toBe(201);
    current = await workbench(generalManager);
    expect((await request(
      `/projects/${projectId}/close-profit/distributions/confirm`,
      generalManager,
      "POST",
      confirmationBody(current.projection.fingerprint, distributionSubmission.body.id)
    )).status).toBe(201);

    current = await workbench(financeDirector);
    const reclearFunds = await request(
      `/projects/${projectId}/close-profit/stages/project_funds_cleared/complete`,
      financeDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    );
    if (reclearFunds.status !== 201) {
      throw new Error(`项目资金重新结清失败：${JSON.stringify(reclearFunds)}`);
    }

    const refreshed = await workbench(generalManager);
    expect(refreshed.stages.map((stage: { status: string }) => stage.status)).toEqual(
      Array.from({ length: 7 }, () => "completed")
    );
    expect(refreshed.history.stageVersions.length).toBeGreaterThanOrEqual(7);
    expect(refreshed.history.profitConfirmations).toHaveLength(1);
    expect(refreshed.history.distributions).toHaveLength(1);
    expect(refreshed.currentDistribution.lines).toHaveLength(refreshed.participatingCompanies.length);

    const concurrentCompanySuffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const newFactCompany = await prisma.companyEntity.create({
      data: {
        name: "POL-109 确认并发参与公司",
        unifiedSocialCreditCode: `P109${concurrentCompanySuffix}`,
        dataStatus: "complete",
        currentVersionNo: 1
      }
    });
    await prisma.companyEntityVersion.create({
      data: {
        companyEntityId: newFactCompany.id,
        versionNo: 1,
        name: newFactCompany.name,
        unifiedSocialCreditCode: newFactCompany.unifiedSocialCreditCode,
        isActive: true,
        action: "pol109_concurrency_fixture",
        actorUserId: "seed-user-finance-director"
      }
    });
    const concurrentConfirmation = request(
      `/projects/${projectId}/close-profit/distributions/confirm`,
      generalManager,
      "POST",
      confirmationBody(refreshed.projection.fingerprint, distributionSubmission.body.id)
    );
    const concurrentNewFact = operatingProfile.addParticipatingCompany(
      projectId,
      "seed-user-finance-director",
      {
        companyEntityId: newFactCompany.id,
        effectiveFrom: "2026-09-18",
        changeReason: "POL-109 确认并发新增经营参与事实"
      }
    );
    const [confirmationRace, newFactRace] = await Promise.allSettled([
      concurrentConfirmation,
      concurrentNewFact
    ]);
    if (newFactRace.status === "rejected") {
      throw new Error(`参与公司并发事实写入失败：${String(newFactRace.reason)}`);
    }
    expect(confirmationRace.status).toBe("fulfilled");
    if (confirmationRace.status === "fulfilled") {
      expect([201, 409]).toContain(confirmationRace.value.status);
    }
    const affected = await workbench(generalManager);
    expect(affected.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: "项目参与公司或分配关系发生变化",
        affectedStageKeys: expect.arrayContaining([
          "profit_distribution_completed",
          "project_funds_cleared"
        ])
      })
    ]));
    expect(affected.stages[5].status).toBe("needs_reconfirmation");
    expect(affected.stages[6].status).toBe("needs_reconfirmation");

    const afterProfitReconfirmation = await workbench(financeDirector);
    const reconfirmLines = afterProfitReconfirmation.participatingCompanies.map(
      (company: { id: string; companyEntityId: string }) => ({
        projectParticipatingCompanyId: company.id,
        finalShareCents: company.companyEntityId === newFactCompany.id
          ? afterProfitReconfirmation.currentProfitConfirmation.finalProfitCents
          : "0"
      })
    );
    const reconfirmDistributionSubmission = await request(
      `/projects/${projectId}/close-profit/distributions/submissions`,
      financeDirector,
      "POST",
      {
        ...commandBody(afterProfitReconfirmation.projection.fingerprint),
        lines: reconfirmLines
      }
    );
    if (reconfirmDistributionSubmission.status !== 201) {
      throw new Error(
        `公司分配重新提交失败：${JSON.stringify(reconfirmDistributionSubmission)}`
      );
    }
    const distributionConfirmationWorkbench = await workbench(generalManager);
    const reconfirmDistribution = await request(
      `/projects/${projectId}/close-profit/distributions/confirm`,
      generalManager,
      "POST",
      confirmationBody(
        distributionConfirmationWorkbench.projection.fingerprint,
        reconfirmDistributionSubmission.body.id
      )
    );
    if (reconfirmDistribution.status !== 201) {
      throw new Error(`公司分配重新确认失败：${JSON.stringify(reconfirmDistribution)}`);
    }
    current = await workbench(financeDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/stages/project_funds_cleared/complete`,
      financeDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);
    const restored = await workbench(generalManager);
    expect(restored.stages.slice(5).map((stage: { status: string }) => stage.status)).toEqual([
      "completed",
      "completed"
    ]);
    expect(restored.history.distributions).toHaveLength(2);
    const reconcileAfterAutomaticImpact = await request(
      `/projects/${projectId}/close-profit/impacts/reconcile`,
      financeDirector,
      "POST",
      commandBody(restored.projection.fingerprint)
    );
    expect(reconcileAfterAutomaticImpact).toMatchObject({
      status: 201,
      body: { createdImpactCount: 0, affectedStageKeys: [] }
    });
    expect((await workbench(generalManager)).stages.slice(5)
      .map((stage: { status: string }) => stage.status)).toEqual([
        "completed",
        "completed"
      ]);

    const executableLine = restored.currentDistribution.lines.find(
      (line: { toReceiveCents: string }) => BigInt(line.toReceiveCents) > 0n
    );
    expect(executableLine).toBeDefined();
    const executionAmount = "1";
    const movementCreate = await request("/fund-movements", movementCreator, "POST", {
      kind: "profit_distribution_execution",
      sourceProjectId: projectId,
      beneficiaryProjectId: projectId,
      sourceCompanyEntityId: executableLine.companyEntityId,
      beneficiaryCompanyEntityId: executableLine.companyEntityId,
      paymentAmountCents: executionAmount,
      projectFundUsedCents: executionAmount,
      companyAdvanceCents: "0",
      legs: [
        {
          role: "source", projectId, companyEntityId: executableLine.companyEntityId,
          direction: "decrease", amountCents: executionAmount, sourceSnapshot: { issue: "#109" }
        },
        {
          role: "beneficiary", projectId, companyEntityId: executableLine.companyEntityId,
          direction: "increase", amountCents: executionAmount, sourceSnapshot: { issue: "#109" }
        }
      ],
      idempotencyKey: randomUUID()
    });
    expect(movementCreate).toMatchObject({ status: 201, body: { status: "draft", revision: 1 } });
    const movementId = movementCreate.body.movementId as string;
    expect((await request(`/fund-movements/${movementId}/submit`, movementSubmitter, "POST", {
      expectedRevision: 1, idempotencyKey: randomUUID()
    }))).toMatchObject({ status: 201, body: { status: "submitted", revision: 2 } });
    expect((await request(`/fund-movements/${movementId}/confirm`, financeDirector, "POST", {
      expectedRevision: 2, idempotencyKey: randomUUID()
    }))).toMatchObject({ status: 201, body: { status: "confirmed", revision: 3 } });
    const movementSnapshot = await request(`/fund-movements/${movementId}`, financeDirector);
    expect(movementSnapshot).toMatchObject({
      status: 200,
      body: {
        id: movementId,
        kind: "profit_distribution_execution",
        status: "confirmed",
        paymentAmountCents: executionAmount
      }
    });
    expect(await prisma.fundMovement.findUniqueOrThrow({
      where: { id: movementId }, select: { profitAuthorizationId: true }
    })).toEqual({ profitAuthorizationId: executableLine.profitAuthorizationId });

    const afterExecution = await workbench(financeDirector);
    expect(afterExecution.stages.slice(4).map((stage: { status: string }) => stage.status)).toEqual([
      "needs_reconfirmation",
      "needs_reconfirmation",
      "needs_reconfirmation"
    ]);

    const appendAdjustment = async (
      suffix: string,
      factKind: "expense" | "owner_settlement",
      amountCents: bigint,
      direction: "outflow" | "inflow",
      impactKind: "confirmed_cost" | "confirmed_income"
    ) => ledger.appendFromSource({
      ...commonFact,
      sourceType: `pol109_acceptance_${suffix}`,
      sourceBusinessId: `pol109-${suffix}`,
      sourceBusinessCode: `POL109-${suffix.toUpperCase()}`,
      idempotencyKey: `pol109:acceptance:${suffix}:fact`,
      factKind,
      amountCents,
      direction,
      sourceSnapshot: { fixture: `POL-109 ${suffix}` },
      subjects: factKind === "expense"
        ? { costBearingCompany: enterprise }
        : { debtor: { kind: "owner", id: "pol109-owner" }, creditor: enterprise },
      impacts: [{
        idempotencyKey: `pol109:acceptance:${suffix}:impact`,
        sourceImpactKey: suffix,
        impactKind,
        amountCents,
        direction: "increase",
        ...(factKind === "expense" ? {
          subjectRole: "cost_bearing_company",
          subject: enterprise,
          costCategoryCode: "other_project_cost"
        } : {})
      }]
    } as never, "seed-user-finance-director");

    const completeSubmittedDecisionCycle = async (expectedProfitCents: string) => {
      let financeView = await workbench(financeDirector);
      const profitSubmission = await request(
        `/projects/${projectId}/close-profit/final-profit/submissions`,
        financeDirector,
        "POST",
        commandBody(financeView.projection.fingerprint)
      );
      expect(profitSubmission).toMatchObject({
        status: 201,
        body: { decisionKind: "final_profit", proposalSnapshot: { finalProfitCents: expectedProfitCents } }
      });
      let executiveView = await workbench(chairman);
      expect((await request(
        `/projects/${projectId}/close-profit/final-profit/confirm`,
        chairman,
        "POST",
        confirmationBody(executiveView.projection.fingerprint, profitSubmission.body.id)
      )).status).toBe(201);
      financeView = await workbench(financeDirector);
      expect(financeView.currentProfitConfirmation.finalProfitCents).toBe(expectedProfitCents);
      const cycleLines = financeView.participatingCompanies.map(
        (company: { id: string }, index: number) => ({
          projectParticipatingCompanyId: company.id,
          finalShareCents: index === 0 ? expectedProfitCents : "0"
        })
      );
      const distributionDraft = await request(
        `/projects/${projectId}/close-profit/distributions/submissions`,
        financeDirector,
        "POST",
        { ...commandBody(financeView.projection.fingerprint), lines: cycleLines }
      );
      expect(distributionDraft).toMatchObject({ status: 201, body: { decisionKind: "distribution" } });
      executiveView = await workbench(generalManager);
      expect((await request(
        `/projects/${projectId}/close-profit/distributions/confirm`,
        generalManager,
        "POST",
        confirmationBody(executiveView.projection.fingerprint, distributionDraft.body.id)
      )).status).toBe(201);
      const readback = await workbench(generalManager);
      expect(readback.currentProfitConfirmation.finalProfitCents).toBe(expectedProfitCents);
      expect(readback.currentDistribution.totalProfitCents).toBe(expectedProfitCents);
      expect(readback.currentDistribution.lines.reduce(
        (sum: bigint, line: { finalShareCents: string }) => sum + BigInt(line.finalShareCents), 0n
      )).toBe(BigInt(expectedProfitCents));
    };

    const profitBeforeLoss = BigInt(
      afterExecution.projection.view.profitAndLoss.currentEstimatedProfitCents
    );
    expect(profitBeforeLoss).toBeGreaterThan(0n);
    await appendAdjustment(
      "loss-cost",
      "expense",
      profitBeforeLoss + 10_000n,
      "outflow",
      "confirmed_cost"
    );
    current = await workbench(contractDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/downstream-cost/attestations/contract`,
      contractDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);
    current = await workbench(financeDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/downstream-cost/attestations/finance`,
      financeDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);
    await completeSubmittedDecisionCycle("-10000");

    await appendAdjustment("zero-income", "owner_settlement", 10_000n, "inflow", "confirmed_income");
    current = await workbench(contractDirector);
    expect((await request(
      `/projects/${projectId}/close-profit/stages/owner_settlement_completed/complete`,
      contractDirector,
      "POST",
      commandBody(current.projection.fingerprint)
    )).status).toBe(201);
    await completeSubmittedDecisionCycle("0");

    await appendAdjustment("browser-reopen", "expense", 1n, "outflow", "confirmed_cost");
  });
});
