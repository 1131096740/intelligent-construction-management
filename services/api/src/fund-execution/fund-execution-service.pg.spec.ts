import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuditService } from "../audit/audit.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { FundExecutionCanonicalAdapterService } from "./fund-execution-canonical-adapter.service";
import {
  FUND_EXECUTION_COMMAND_ACTIONS
} from "./fund-execution-command-receipt";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionSelectionRefService } from "./fund-execution-selection-ref.service";
import {
  FundExecutionService,
  type FundExecutionCommandResponse
} from "./fund-execution.service";
import { VerifiedBankTransactionObservationService } from "./verified-bank-transaction-observation.service";

const RUN_POSTGRES = process.env.RUN_FUND_EXECUTION_V7_PG === "1";
const describePostgres = RUN_POSTGRES ? describe : describe.skip;
const WRITE_SECRET = "fund-execution-v7-pg-test-write-secret";
const SHA256 = "a".repeat(64);
const ACTOR_USER_ID = "10000000-0000-4000-8000-000000000001";
const REVIEWER_USER_ID = "10000000-0000-4000-8000-000000000002";
const CONFIRMER_USER_ID = "10000000-0000-4000-8000-000000000003";
const CHAIRMAN_USER_ID = "10000000-0000-4000-8000-000000000004";
const EXECUTOR_USER_ID = "10000000-0000-4000-8000-000000000005";
const REVIEWER_DELEGATE_USER_ID = "10000000-0000-4000-8000-000000000006";
const SCOPED_DELEGATE_USER_ID = "10000000-0000-4000-8000-000000000007";
const INACTIVE_DELEGATE_USER_ID = "10000000-0000-4000-8000-000000000008";
const INACTIVE_DELEGATOR_USER_ID = "10000000-0000-4000-8000-000000000009";
const INACTIVE_DELEGATOR_DELEGATE_USER_ID =
  "10000000-0000-4000-8000-000000000010";
const BOUNDARY_ACTIVE_DELEGATE_USER_ID =
  "10000000-0000-4000-8000-000000000011";
const BOUNDARY_EXPIRED_DELEGATE_USER_ID =
  "10000000-0000-4000-8000-000000000012";
const COMPANY_ID = "11000000-0000-4000-8000-000000000001";
const COMPANY_VERSION_ID = "11000000-0000-4000-8000-000000000002";
const OTHER_COMPANY_ID = "11000000-0000-4000-8000-000000000003";
const OTHER_COMPANY_VERSION_ID = "11000000-0000-4000-8000-000000000004";
const PROJECT_ID = "12000000-0000-4000-8000-000000000001";
const AFFILIATE_PARTY_ID = "13000000-0000-4000-8000-000000000001";
const AFFILIATE_VERSION_ID = "13000000-0000-4000-8000-000000000002";
const AFFILIATE_ASSIGNMENT_ID = "13000000-0000-4000-8000-000000000003";
const PARTICIPANT_ID = "14000000-0000-4000-8000-000000000001";
const PAYER_VERIFICATION_ID = "15000000-0000-4000-8000-000000000001";
const OTHER_PAYER_VERIFICATION_ID = "15000000-0000-4000-8000-000000000002";
const VERIFICATION_FILE_ID = "16000000-0000-4000-8000-000000000001";
const RETURN_TRANSACTION_FILE_ID = "16000000-0000-4000-8000-000000000002";
const CONFIRM_TRANSACTION_FILE_ID = "16000000-0000-4000-8000-000000000003";
const SIGNATURE_FILE_ID = "16000000-0000-4000-8000-000000000004";
const REVERSE_TRANSACTION_FILE_ID_1 = "16000000-0000-4000-8000-000000000005";
const REVERSE_TRANSACTION_FILE_ID_2 = "16000000-0000-4000-8000-000000000006";
const OTHER_VERIFICATION_FILE_ID = "16000000-0000-4000-8000-000000000007";
const HOLDER_MISMATCH_TRANSACTION_FILE_ID = "16000000-0000-4000-8000-000000000008";
const SOD_TRANSACTION_FILE_ID = "16000000-0000-4000-8000-000000000009";
const OUTFLOW_TRANSACTION_FILE_ID = "16000000-0000-4000-8000-000000000010";
const PROJECT_RECEIPT_FILE_ID = "16000000-0000-4000-8000-000000000011";
const WAGE_SOURCE_FILE_ID = "16000000-0000-4000-8000-000000000012";
const SIGNATURE_VERSION_ID = "17000000-0000-4000-8000-000000000001";
const OCCURRED_AT = new Date("2026-08-31T04:00:00.000Z");

type Flow = Readonly<{
  createInput: Readonly<{
    observationSelectionRef: string;
    reason: string;
    idempotencyKey: string;
  }>;
  create: FundExecutionCommandResponse;
  updateInput: Readonly<{
    caseId: string;
    expectedRevision: number;
    reason: string;
    selectionRefs: readonly string[];
    idempotencyKey: string;
  }>;
  update: FundExecutionCommandResponse;
  submitInput: Readonly<{
    caseId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }>;
  submit: FundExecutionCommandResponse;
}>;

type UpdatedFlow = Pick<
  Flow,
  "createInput" | "create" | "updateInput" | "update"
>;

describePostgres("FundExecutionService PostgreSQL 16 command boundary", () => {
  const prisma = new PrismaClient();
  const audit = new AuditService();
  const selectionRefs = new FundExecutionSelectionRefService({
    bankObservationSecret: "fund-execution-v7-pg-bank-selection-secret",
    axisBusinessSecret: "fund-execution-v7-pg-axis-selection-secret"
  });
  const projectFunding = new ProjectFundingAvailabilityService();
  const operatingLedger = new OperatingLedgerService(prisma as never);
  const options = new FundExecutionSelectionOptionsService(
    prisma as never,
    selectionRefs,
    projectFunding
  );
  const canonicalAdapter = new FundExecutionCanonicalAdapterService(
    projectFunding,
    operatingLedger
  );
  const service = new FundExecutionService(
    prisma as never,
    audit,
    options,
    canonicalAdapter
  );
  const observationService = new VerifiedBankTransactionObservationService(
    prisma as never
  );
  let returnFlow: Flow | undefined;
  let confirmFlow: Flow | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
      throw new Error("资金执行 PG 测试必须连接非生产 disposable database");
    }
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = WRITE_SECRET;
    await prisma.$connect();
    await seedExternalDomainFixtures(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("数据库 CHECK 与 TypeScript 暴露完全相同的五类 canonical action", async () => {
    const [row] = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'FundExecutionCommandReceipt_action_check'
    `;

    expect(row?.definition).toBeDefined();
    for (const action of FUND_EXECUTION_COMMAND_ACTIONS) {
      expect(row!.definition).toContain(`'${action}'`);
    }
    expect(row!.definition).not.toMatch(/'create'|'submit'|'return'|'confirm'/u);
  });

  it("首次执行 create→update→submit，并由 service 创建三张回执", async () => {
    await expect(prisma.fundExecution.count()).resolves.toBe(0);
    await expect(prisma.fundExecutionCommandReceipt.count()).resolves.toBe(0);

    returnFlow = await createUpdateSubmitFlow({
      reference: "PG-RETURN-OBSERVATION",
      sourceId: "pg-return-source",
      transactionFileId: RETURN_TRANSACTION_FILE_ID,
      reason: "真实退回路径"
    });
    await expect(
      commandReceiptActions(returnFlow.create.fundExecutionId)
    ).resolves.toEqual(["create_case", "update_case", "submit_case"]);
  });

  it("approval-return→return_case 首次执行并产生 returned successor", async () => {
    const flow = returnFlow;
    if (!flow) throw new Error("return flow setup missing");
    await expect(
      service.reviewApproval(REVIEWER_USER_ID, {
        caseId: flow.create.caseId,
        action: "return_to_applicant",
        comment: "真实 PG 审批退回"
      })
    ).resolves.toEqual({
      caseId: flow.create.caseId,
      status: "returned_to_applicant"
    });
    const returnInput = {
      caseId: flow.create.caseId,
      expectedRevision: flow.submit.revision,
      reason: "根据审批意见退回修改",
      idempotencyKey: randomUUID()
    };
    const returned = await service.returnCase(REVIEWER_USER_ID, returnInput);

    expect(returned).toMatchObject({ status: "draft", revision: 4 });
    await expect(
      commandReceiptActions(returned.fundExecutionId)
    ).resolves.toEqual([
      "create_case",
      "update_case",
      "submit_case",
      "return_case"
    ]);
    await expect(
      service.returnCase(REVIEWER_USER_ID, returnInput)
    ).resolves.toEqual(returned);
    await expect(
      prisma.fundExecutionCase.findMany({
        where: { fundExecutionId: returned.fundExecutionId },
        orderBy: { revision: "asc" },
        select: {
          caseKey: true,
          revision: true,
          auditAction: true,
          returnedFromCaseId: true
        }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseKey: returned.caseId,
          revision: 4,
          auditAction: "return_case",
          returnedFromCaseId: expect.any(String)
        })
      ])
    );
  });

  it("最终审批节点退回后仅全局财务总监可原子生成 successor draft", async () => {
    const flow = await createIsolatedSubmittedFlow("chairman-return");
    await expect(
      service.reviewApproval(REVIEWER_USER_ID, {
        caseId: flow.create.caseId,
        action: "approve",
        comment: "财务主管同意后流转最终节点"
      })
    ).resolves.toEqual({
      caseId: flow.create.caseId,
      status: "in_progress"
    });
    await expect(
      service.reviewApproval(CHAIRMAN_USER_ID, {
        caseId: flow.create.caseId,
        action: "return_to_applicant",
        comment: "董事长退回申请人"
      })
    ).resolves.toEqual({
      caseId: flow.create.caseId,
      status: "returned_to_applicant"
    });

    await expect(
      service.returnCase(CHAIRMAN_USER_ID, {
        caseId: flow.create.caseId,
        expectedRevision: flow.submit.revision,
        reason: "最终审批人不得生成退回修改稿",
        idempotencyKey: randomUUID()
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    const roleSpy = jest
      .spyOn(
        service as unknown as {
          assertRole: (...args: readonly unknown[]) => Promise<void>;
        },
        "assertRole"
      )
      .mockResolvedValueOnce(undefined);
    await expect(
      service.returnCase(CHAIRMAN_USER_ID, {
        caseId: flow.create.caseId,
        expectedRevision: flow.submit.revision,
        reason: "绕过服务角色检查也必须由数据库拒绝",
        idempotencyKey: randomUUID()
      })
    ).rejects.toThrow(/fund_execution_case_global_finance_director_required/u);
    roleSpy.mockRestore();

    await expect(
      service.returnCase(REVIEWER_USER_ID, {
        caseId: flow.create.caseId,
        expectedRevision: flow.submit.revision,
        reason: "全局财务总监根据最终审批意见生成修改稿",
        idempotencyKey: randomUUID()
      })
    ).resolves.toMatchObject({ status: "draft", revision: 4 });
  });

  it("独立首次执行 create→update→submit 后进入 approval-approved→confirm", async () => {
    confirmFlow = await createUpdateSubmitFlow({
      reference: "PG-CONFIRM-OBSERVATION",
      sourceId: "pg-confirm-source",
      transactionFileId: CONFIRM_TRANSACTION_FILE_ID,
      reason: "真实确认路径"
    });
    await prisma.approvalDelegation.create({
      data: {
        id: randomUUID(),
        fromUserId: REVIEWER_USER_ID,
        toUserId: SCOPED_DELEGATE_USER_ID,
        actionKey: "fund_execution_case.approve",
        resourceType: "fund_execution_case",
        resourceId: "另一个资金执行案件",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2027-01-01T00:00:00.000Z"),
        enabled: true
      }
    });
    await expect(service.listCases(SCOPED_DELEGATE_USER_ID)).resolves.toEqual([]);
    await expect(
      service.getCase(SCOPED_DELEGATE_USER_ID, confirmFlow.create.caseId)
    ).rejects.toThrow();
    await expect(
      service.reviewApproval(SCOPED_DELEGATE_USER_ID, {
        caseId: confirmFlow.create.caseId,
        action: "approve",
        comment: "错误资源的委托不得越权"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listCases(REVIEWER_DELEGATE_USER_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseRef: confirmFlow.create.caseId,
          actions: expect.arrayContaining([
            expect.objectContaining({ key: "approve", enabled: true })
          ])
        })
      ])
    );
    await expect(
      service.reviewApproval(REVIEWER_DELEGATE_USER_ID, {
        caseId: confirmFlow.create.caseId,
        action: "approve",
        comment: "财务主管受托人同意"
      })
    ).resolves.toEqual({
      caseId: confirmFlow.create.caseId,
      status: "in_progress"
    });
    await expect(
      service.reviewApproval(CHAIRMAN_USER_ID, {
        caseId: confirmFlow.create.caseId,
        action: "approve",
        comment: "董事长同意"
      })
    ).resolves.toEqual({
      caseId: confirmFlow.create.caseId,
      status: "approved"
    });
    const confirmInput = {
      caseId: confirmFlow.create.caseId,
      expectedRevision: confirmFlow.submit.revision,
      idempotencyKey: randomUUID()
    };
    const confirmed = await service.confirmCase(
      CONFIRMER_USER_ID,
      confirmInput
    );

    expect(confirmed).toMatchObject({ status: "confirmed", revision: 4 });
    await expect(
      commandReceiptActions(confirmed.fundExecutionId)
    ).resolves.toEqual([
      "create_case",
      "update_case",
      "submit_case",
      "confirm_case"
    ]);
    await expect(
      service.confirmCase(CONFIRMER_USER_ID, confirmInput)
    ).resolves.toEqual(confirmed);
    await expect(
      prisma.executionAllocationLine.count({
        where: { fundExecutionId: confirmed.fundExecutionId }
      })
    ).resolves.toBe(1);
    const line = await prisma.executionAllocationLine.findFirstOrThrow({
      where: { fundExecutionId: confirmed.fundExecutionId }
    });
    const effects = await prisma.executionAllocationAxisEffect.findMany({
      where: { executionAllocationLineId: line.id },
      select: { id: true }
    });
    expect(effects).toHaveLength(4);
    await expect(
      prisma.executionAllocationConsequence.count({
        where: { axisEffectId: { in: effects.map(({ id }) => id) } }
      })
    ).resolves.toBe(1);
    const confirmedCase = await prisma.fundExecutionCase.findFirstOrThrow({
      where: { caseKey: confirmed.caseId, status: "confirmed" }
    });
    await expect(
      prisma.operatingFact.findFirstOrThrow({
        where: {
          fundExecutionId: confirmed.fundExecutionId,
          fundExecutionCaseId: confirmedCase.id,
          sourceBusinessId: line.id
        },
        include: { impacts: true }
      })
    ).resolves.toMatchObject({
      status: "confirmed",
      sourceType: "fund_execution",
      impacts: [
        expect.objectContaining({
          fundExecutionId: confirmed.fundExecutionId,
          executionAllocationLineId: line.id
        })
      ]
    });
  });

  it("inactive delegate 或 delegator 均不能读取或审批", async () => {
    const scenarios = [
      {
        label: "inactive-delegate",
        fromUserId: REVIEWER_USER_ID,
        toUserId: INACTIVE_DELEGATE_USER_ID
      },
      {
        label: "inactive-delegator",
        fromUserId: INACTIVE_DELEGATOR_USER_ID,
        toUserId: INACTIVE_DELEGATOR_DELEGATE_USER_ID
      }
    ];
    const outcomes: Array<{
      label: string;
      readError: unknown;
      reviewError: unknown;
    }> = [];

    for (const scenario of scenarios) {
      const flow = await createIsolatedSubmittedFlow(scenario.label);
      await prisma.approvalDelegation.create({
        data: {
          id: randomUUID(),
          fromUserId: scenario.fromUserId,
          toUserId: scenario.toUserId,
          actionKey: "fund_execution_case.approve",
          resourceType: "fund_execution_case",
          resourceId: flow.create.caseId,
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: new Date("2027-01-01T00:00:00.000Z"),
          enabled: true
        }
      });
      const readError = await service
        .listCases(scenario.toUserId)
        .then(() => null, (error: unknown) => error);
      const reviewError = await service
        .reviewApproval(scenario.toUserId, {
          caseId: flow.create.caseId,
          action: "approve",
          comment: `${scenario.label} 不得审批`
        })
        .then(() => null, (error: unknown) => error);
      outcomes.push({ label: scenario.label, readError, reviewError });
    }

    for (const outcome of outcomes) {
      expect(outcome.readError).toBeInstanceOf(ForbiddenException);
      expect(outcome.reviewError).toBeInstanceOf(ForbiddenException);
    }
  });

  it("delegation 采用 startsAt <= now < endsAt 半开区间", async () => {
    const flow = await createIsolatedSubmittedFlow("delegation-boundary");
    const boundary = new Date("2026-09-01T08:00:00.000Z");
    await prisma.approvalDelegation.createMany({
      data: [
        {
          id: randomUUID(),
          fromUserId: REVIEWER_USER_ID,
          toUserId: BOUNDARY_EXPIRED_DELEGATE_USER_ID,
          actionKey: "fund_execution_case.approve",
          resourceType: "fund_execution_case",
          resourceId: flow.create.caseId,
          startsAt: new Date("2026-08-31T08:00:00.000Z"),
          endsAt: boundary,
          enabled: true
        },
        {
          id: randomUUID(),
          fromUserId: REVIEWER_USER_ID,
          toUserId: BOUNDARY_ACTIVE_DELEGATE_USER_ID,
          actionKey: "fund_execution_case.approve",
          resourceType: "fund_execution_case",
          resourceId: flow.create.caseId,
          startsAt: boundary,
          endsAt: new Date("2026-09-02T08:00:00.000Z"),
          enabled: true
        }
      ]
    });

    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout"
      ]
    });
    jest.setSystemTime(boundary);
    try {
      await expect(
        service.listCases(BOUNDARY_EXPIRED_DELEGATE_USER_ID)
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.reviewApproval(BOUNDARY_EXPIRED_DELEGATE_USER_ID, {
          caseId: flow.create.caseId,
          action: "approve",
          comment: "endsAt 等于 now 已失效"
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.listCases(BOUNDARY_ACTIVE_DELEGATE_USER_ID)
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ caseRef: flow.create.caseId })
        ])
      );
      await expect(
        service.reviewApproval(BOUNDARY_ACTIVE_DELEGATE_USER_ID, {
          caseId: flow.create.caseId,
          action: "approve",
          comment: "startsAt 等于 now 已生效"
        })
      ).resolves.toEqual({
        caseId: flow.create.caseId,
        status: "in_progress"
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("数据库 SoD 忽略任一方 inactive 的委托闭包", async () => {
    const flow = await createIsolatedSubmittedFlow("inactive-delegation-sod");
    await service.reviewApproval(REVIEWER_USER_ID, {
      caseId: flow.create.caseId,
      action: "approve",
      comment: "财务主管直接审批"
    });
    await service.reviewApproval(CHAIRMAN_USER_ID, {
      caseId: flow.create.caseId,
      action: "approve",
      comment: "董事长直接审批"
    });
    await prisma.approvalDelegation.create({
      data: {
        id: randomUUID(),
        fromUserId: ACTOR_USER_ID,
        toUserId: CONFIRMER_USER_ID,
        actionKey: "fund_execution_case.approve",
        resourceType: "fund_execution_case",
        resourceId: flow.create.caseId,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2027-01-01T00:00:00.000Z"),
        enabled: true
      }
    });
    await prisma.user.update({
      where: { id: ACTOR_USER_ID },
      data: { isActive: false }
    });

    try {
      await expect(
        service.confirmCase(CONFIRMER_USER_ID, {
          caseId: flow.create.caseId,
          expectedRevision: flow.submit.revision,
          idempotencyKey: randomUUID()
        })
      ).resolves.toMatchObject({ status: "confirmed", revision: 4 });
    } finally {
      await prisma.user.update({
        where: { id: ACTOR_USER_ID },
        data: { isActive: true }
      });
    }
  });

  it("相同 createdAt 的合法审批按冻结步骤而非随机 UUID 确认", async () => {
    const flow = await createIsolatedSubmittedFlow("same-time-approval");
    await service.reviewApproval(REVIEWER_USER_ID, {
      caseId: flow.create.caseId,
      action: "approve",
      comment: "财务主管同意"
    });
    await service.reviewApproval(CHAIRMAN_USER_ID, {
      caseId: flow.create.caseId,
      action: "approve",
      comment: "董事长同意"
    });
    const submittedCase = await prisma.fundExecutionCase.findFirstOrThrow({
      where: { caseKey: flow.create.caseId, status: "submitted" }
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw`
        UPDATE "ApprovalActionLog"
        SET "createdAt" = '2026-09-01T08:00:00.000Z'::TIMESTAMPTZ,
            "id" = CASE "approvedRoleKey"
              WHEN 'finance_director'
                THEN 'ffffffff-ffff-4fff-8fff-fffffffffff1'
              ELSE '00000000-0000-4000-8000-0000000000f2'
            END
        WHERE "approvalInstanceId" = ${submittedCase.approvalInstanceId}
      `;
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
    });

    await expect(
      service.confirmCase(CONFIRMER_USER_ID, {
        caseId: flow.create.caseId,
        expectedRevision: flow.submit.revision,
        idempotencyKey: randomUUID()
      })
    ).resolves.toMatchObject({ status: "confirmed", revision: 4 });
  });

  it("不同实际账户持有人的反向流水在 Claim 创建前失败关闭", async () => {
    if (!confirmFlow) throw new Error("confirmed source flow missing");
    await observationService.record({
      reference: "PG-REVERSE-HOLDER-MISMATCH",
      payerVerificationId: OTHER_PAYER_VERIFICATION_ID,
      transactionSourceType: "pg_test_bank_statement",
      transactionSourceId: "pg-reverse-holder-mismatch",
      transactionSourceIdentity: createHash("sha256")
        .update("pg-test:reverse-holder-mismatch")
        .digest("hex"),
      transactionEvidenceFileId: HOLDER_MISMATCH_TRANSACTION_FILE_ID,
      transactionExecutedByUserId: EXECUTOR_USER_ID,
      amountCents: 1_000n,
      currencyCode: "CNY",
      direction: "outflow",
      occurredAt: new Date("2026-08-31T04:30:00.000Z"),
      createdByUserId: ACTOR_USER_ID,
      auditRequestId: randomUUID()
    });
    const targets = await options.listReversalTargets(ACTOR_USER_ID);
    expect(targets.length).toBeGreaterThan(0);
    const observation = (
      await options.listObservationCandidates(ACTOR_USER_ID)
    ).find(({ summary }) => summary.includes("PG 测试其他账户公司"));
    if (!observation) throw new Error("holder mismatch observation missing");
    await expect(
      service.createReversalCase(ACTOR_USER_ID, {
        targetSelectionRef: targets[0]!.targetSelectionRef,
        observationSelectionRef: observation.selectionRef,
        reason: "账户持有人不一致必须拒绝",
        idempotencyKey: randomUUID()
      })
    ).rejects.toThrow("账户持有人不一致");
  });

  it("同一原执行按 4000+6000 两次累计反向并逐轴精确切片", async () => {
    const original = await createAndConfirmAppliedProjectFundOutflow();
    const originalExecutionId = original.fundExecutionId;
    const originalLine = await prisma.executionAllocationLine.findFirstOrThrow({
      where: { fundExecutionId: originalExecutionId }
    });
    const originalProjectFundEffect =
      await prisma.executionAllocationAxisEffect.findFirstOrThrow({
        where: {
          executionAllocationLineId: originalLine.id,
          axis: "project_fund"
        }
      });
    expect(originalProjectFundEffect).toMatchObject({
      status: "applied",
      amountCents: 10_000n,
      originalAxisEffectId: null
    });
    const originalProjectFundConsequence =
      await prisma.executionAllocationConsequence.findFirstOrThrow({
        where: { axisEffectId: originalProjectFundEffect.id }
      });
    const originalProjectFundAllocation =
      await prisma.projectFundingAllocation.findUniqueOrThrow({
        where: {
          id: originalProjectFundConsequence.projectFundingAllocationId!
        }
      });
    expect(originalProjectFundAllocation.amountCents).toBe(10_000n);

    const first = await createAndConfirmReversal({
      targetSummaryNeedle: "· 出账 ·",
      reference: "PG-REVERSE-OBSERVATION-1",
      sourceId: "pg-reverse-source-1",
      transactionFileId: REVERSE_TRANSACTION_FILE_ID_1,
      amountCents: 4_000n,
      direction: "inflow",
      occurredAt: new Date("2026-08-31T05:00:00.000Z")
    });
    const firstLines = await prisma.executionAllocationLine.findMany({
      where: { fundExecutionId: first.fundExecutionId }
    });
    expect(firstLines).toHaveLength(1);
    expect(firstLines[0]!.amountCents).toBe(4_000n);
    const firstProjectFundEffect =
      await prisma.executionAllocationAxisEffect.findFirstOrThrow({
        where: {
          executionAllocationLineId: firstLines[0]!.id,
          axis: "project_fund"
        }
      });
    expect(firstProjectFundEffect).toMatchObject({
      status: "applied",
      amountCents: 4_000n,
      originalAxisEffectId: originalProjectFundEffect.id
    });
    const firstProjectFundConsequence =
      await prisma.executionAllocationConsequence.findFirstOrThrow({
        where: { axisEffectId: firstProjectFundEffect.id }
      });
    expect(firstProjectFundConsequence).toMatchObject({
      amountCents: 4_000n,
      originalConsequenceId: originalProjectFundConsequence.id
    });
    await expect(
      prisma.projectFundingAllocation.findUniqueOrThrow({
        where: {
          id: firstProjectFundConsequence.projectFundingAllocationId!
        }
      })
    ).resolves.toMatchObject({
      amountCents: 4_000n,
      reversalOfAllocationId: originalProjectFundAllocation.id
    });

    const second = await createAndConfirmReversal({
      targetSummaryNeedle: "· 出账 ·",
      reference: "PG-REVERSE-OBSERVATION-2",
      sourceId: "pg-reverse-source-2",
      transactionFileId: REVERSE_TRANSACTION_FILE_ID_2,
      amountCents: 6_000n,
      direction: "inflow",
      occurredAt: new Date("2026-08-31T06:00:00.000Z")
    });
    const secondLines = await prisma.executionAllocationLine.findMany({
      where: { fundExecutionId: second.fundExecutionId }
    });
    expect(secondLines).toHaveLength(1);
    expect(secondLines[0]!.amountCents).toBe(6_000n);

    const reversals = await prisma.fundExecution.findMany({
      where: { reversesFundExecutionId: originalExecutionId },
      orderBy: { occurredAt: "asc" },
      select: { amountCents: true }
    });
    expect(reversals.map(({ amountCents }) => amountCents)).toEqual([
      4_000n,
      6_000n
    ]);
    const targets = await options.listReversalTargets(ACTOR_USER_ID);
    expect(
      targets.some(({ summary }) => summary.includes("· 出账 ·"))
    ).toBe(false);
  });

  it("曾编辑案件的财务总监不得随后确认同一案件", async () => {
    await observationService.record({
      reference: "PG-SOD-EDITOR-OBSERVATION",
      payerVerificationId: PAYER_VERIFICATION_ID,
      transactionSourceType: "pg_test_bank_statement",
      transactionSourceId: "pg-sod-editor-source",
      transactionSourceIdentity: createHash("sha256")
        .update("pg-test:sod-editor")
        .digest("hex"),
      transactionEvidenceFileId: SOD_TRANSACTION_FILE_ID,
      transactionExecutedByUserId: EXECUTOR_USER_ID,
      amountCents: 10_000n,
      currencyCode: "CNY",
      direction: "inflow",
      occurredAt: new Date("2026-08-31T07:00:00.000Z"),
      createdByUserId: ACTOR_USER_ID,
      auditRequestId: randomUUID()
    });
    const observation = (
      await options.listObservationCandidates(ACTOR_USER_ID)
    ).find(({ summary }) => summary.startsWith("入账"));
    if (!observation) throw new Error("SoD observation missing");
    const created = await service.createCase(ACTOR_USER_ID, {
      observationSelectionRef: observation.selectionRef,
      reason: "确认人历史参与链测试",
      idempotencyKey: randomUUID()
    });
    const plans = await options.listCasePlans(created.caseId, CONFIRMER_USER_ID);
    const updated = await service.updateCase(CONFIRMER_USER_ID, {
      caseId: created.caseId,
      expectedRevision: created.revision,
      reason: "财务总监曾编辑",
      selectionRefs: plans[0]!.lines.flatMap((line) =>
        line.axes.map(({ selectionRef }) => selectionRef)
      ),
      idempotencyKey: randomUUID()
    });
    const submitted = await service.submitCase(ACTOR_USER_ID, {
      caseId: created.caseId,
      expectedRevision: updated.revision,
      idempotencyKey: randomUUID()
    });
    await service.reviewApproval(REVIEWER_USER_ID, {
      caseId: created.caseId,
      action: "approve",
      comment: "财务主管同意"
    });
    await service.reviewApproval(CHAIRMAN_USER_ID, {
      caseId: created.caseId,
      action: "approve",
      comment: "董事长同意"
    });
    await expect(
      service.confirmCase(CONFIRMER_USER_ID, {
        caseId: created.caseId,
        expectedRevision: submitted.revision,
        idempotencyKey: randomUUID()
      })
    ).rejects.toThrow("案件经办链和全部审批自然人分离");
  });

  it("所有首次执行回执来自 production service，重放不增加聚合修订", async () => {
    expect(returnFlow).toBeDefined();
    expect(confirmFlow).toBeDefined();
    const before = await prisma.fundExecutionCase.count();

    await expect(
      service.createCase(ACTOR_USER_ID, returnFlow!.createInput)
    ).resolves.toEqual(returnFlow!.create);
    await expect(
      service.updateCase(ACTOR_USER_ID, returnFlow!.updateInput)
    ).resolves.toEqual(returnFlow!.update);
    await expect(
      service.submitCase(ACTOR_USER_ID, returnFlow!.submitInput)
    ).resolves.toEqual(returnFlow!.submit);

    await expect(prisma.fundExecutionCase.count()).resolves.toBe(before);
    await expect(prisma.fundExecutionCommandReceipt.count()).resolves.toBeGreaterThanOrEqual(6);
  });

  it("相同幂等键但 payload 不同仍在可变状态校验前失败关闭", async () => {
    expect(confirmFlow).toBeDefined();
    await expect(
      service.submitCase(ACTOR_USER_ID, {
        ...confirmFlow!.submitInput,
        caseId: `${confirmFlow!.submitInput.caseId}-different-payload`
      })
    ).rejects.toThrow("幂等键已被其他资金执行命令占用");
  });

  it("旧 action 即使具备服务端写上下文也被数据库拒绝", async () => {
    expect(confirmFlow).toBeDefined();
    const submittedCase = await prisma.fundExecutionCase.findFirstOrThrow({
      where: { caseKey: confirmFlow!.create.caseId, status: "submitted" }
    });
    const requestId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await authorize(tx, requestId, "create");
        await tx.$executeRaw`
          INSERT INTO "FundExecutionCommandReceipt"(
            "id", "idempotencyKey", "payloadFingerprint", "action",
            "fundExecutionId", "fundExecutionCaseId", "expectedRevision",
            "responseSnapshot", "createdByUserId", "auditRequestId",
            "createdTransactionId", "createdBackendPid"
          ) VALUES (
            ${randomUUID()}, ${requestId}, ${SHA256}, 'create',
            ${confirmFlow!.create.fundExecutionId}, ${submittedCase.id}, NULL,
            '{}'::JSONB, ${ACTOR_USER_ID}, ${requestId}, 1, 1
          )
        `;
      })
    ).rejects.toThrow(/FundExecutionCommandReceipt_(action|shape)_check/u);
  });

  it("migration contract 拒绝缺首 route 节点与缺第一审批动作", async () => {
    if (!confirmFlow) throw new Error("confirmed contract probe flow missing");
    const confirmedCase = await prisma.fundExecutionCase.findFirstOrThrow({
      where: { caseKey: confirmFlow.create.caseId, status: "confirmed" }
    });
    if (!confirmedCase.approvalInstanceId) {
      throw new Error("confirmed contract probe approval missing");
    }

    const routeError = await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica"
        );
        await tx.$executeRaw`
          UPDATE "ApprovalInstance"
          SET "frozenNodes" = jsonb_build_array("frozenNodes" -> -1)
          WHERE "id" = ${confirmedCase.approvalInstanceId}
        `;
        await tx.$executeRaw`
          UPDATE "FundExecutionCase" case_row
          SET "approvalInstanceSnapshot" = to_jsonb(instance),
              "approvalInstanceFingerprint" = encode(
                public.digest(to_jsonb(instance)::TEXT, 'sha256'),
                'hex'
              )
          FROM "ApprovalInstance" instance
          WHERE case_row."id" = ${confirmedCase.id}
            AND instance."id" = ${confirmedCase.approvalInstanceId}
        `;
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = origin"
        );
        await tx.$executeRaw`
          SELECT assert_fund_execution_case_contract(${confirmedCase.id})
        `;
        throw new Error("RED: migration accepted route without first node");
      })
      .then(() => null, (error: unknown) => error);

    const actionError = await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica"
        );
        await tx.$executeRaw`
          DELETE FROM "ApprovalActionLog"
          WHERE "approvalInstanceId" = ${confirmedCase.approvalInstanceId}
            AND "action" = 'approve'
            AND "approvedRoleKey" = 'finance_director'
        `;
        await tx.$executeRaw`
          WITH frozen_logs AS (
            SELECT COALESCE(
                     jsonb_agg(
                       to_jsonb(action_log)
                       ORDER BY action_log."createdAt", action_log."id"
                     ),
                     '[]'::JSONB
                   ) AS snapshot,
                   COUNT(*)::INTEGER AS count
            FROM "ApprovalActionLog" action_log
            WHERE action_log."approvalInstanceId" =
              ${confirmedCase.approvalInstanceId}
          )
          UPDATE "FundExecutionCase" case_row
          SET "approvalActionLogSnapshot" = frozen_logs.snapshot,
              "approvalActionLogCount" = frozen_logs.count,
              "approvalActionLogFingerprint" = encode(
                public.digest(frozen_logs.snapshot::TEXT, 'sha256'),
                'hex'
              )
          FROM frozen_logs
          WHERE case_row."id" = ${confirmedCase.id}
        `;
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = origin"
        );
        await tx.$executeRaw`
          SELECT assert_fund_execution_case_contract(${confirmedCase.id})
        `;
        throw new Error("RED: migration accepted logs without first approval");
      })
      .then(() => null, (error: unknown) => error);

    const message = (error: unknown) =>
      error instanceof Error ? error.message : String(error);
    expect({
      route: message(routeError),
      action: message(actionError)
    }).toEqual({
      route: expect.stringMatching(/fund_execution_case_approval/u),
      action: expect.stringMatching(/fund_execution_case_approval/u)
    });
  });

  it.each(["swapped", "extra", "wrong_mode"] as const)(
    "migration contract 拒绝 frozenNodes %s 篡改",
    async (mutation) => {
      const error = await runConfirmedContractMutation(
        "approval_instance",
        `RED: migration accepted frozenNodes ${mutation}`,
        async (tx, context) => {
          if (mutation === "swapped") {
            await tx.$executeRaw`
              UPDATE "ApprovalInstance"
              SET "frozenNodes" = jsonb_build_array(
                "frozenNodes" -> 1,
                "frozenNodes" -> 0
              )
              WHERE "id" = ${context.approvalInstanceId}
            `;
          } else if (mutation === "extra") {
            await tx.$executeRaw`
              UPDATE "ApprovalInstance"
              SET "frozenNodes" = "frozenNodes" ||
                jsonb_build_array("frozenNodes" -> -1)
              WHERE "id" = ${context.approvalInstanceId}
            `;
          } else {
            await tx.$executeRaw`
              UPDATE "ApprovalInstance"
              SET "frozenNodes" = jsonb_set(
                "frozenNodes",
                '{0,mode}',
                '"all"'::JSONB,
                false
              )
              WHERE "id" = ${context.approvalInstanceId}
            `;
          }
        }
      );

      expect(contractProbeMessage(error)).toMatch(
        /fund_execution_case_approval_instance_freeze_invalid/u
      );
    }
  );

  it.each(["wrong_step", "duplicate"] as const)(
    "migration contract 拒绝 confirmed action %s 篡改",
    async (mutation) => {
      const duplicateActionId = randomUUID();
      const error = await runConfirmedContractMutation(
        "approval_actions",
        `RED: migration accepted confirmed action ${mutation}`,
        async (tx, context) => {
          if (mutation === "wrong_step") {
            await tx.$executeRaw`
              UPDATE "ApprovalActionLog"
              SET "metadata" = '{"fundExecutionApprovalStep":2}'::JSONB
              WHERE "approvalInstanceId" = ${context.approvalInstanceId}
                AND "approvedRoleKey" = 'finance_director'
            `;
          } else {
            await tx.$executeRaw`
              INSERT INTO "ApprovalActionLog"(
                "id", "approvalInstanceId", "action", "actorUserId",
                "comment", "metadata", "approvedRoleKey",
                "signatureFileIdSnapshot", "signatureSha256Snapshot",
                "signatureVersionIdSnapshot", "representedUserId", "createdAt"
              )
              SELECT
                ${duplicateActionId}, action_log."approvalInstanceId",
                action_log."action", action_log."actorUserId",
                action_log."comment", action_log."metadata",
                action_log."approvedRoleKey",
                action_log."signatureFileIdSnapshot",
                action_log."signatureSha256Snapshot",
                action_log."signatureVersionIdSnapshot",
                action_log."representedUserId",
                action_log."createdAt" + INTERVAL '1 millisecond'
              FROM "ApprovalActionLog" action_log
              WHERE action_log."approvalInstanceId" =
                ${context.approvalInstanceId}
                AND action_log."approvedRoleKey" = 'finance_director'
              LIMIT 1
            `;
          }
        }
      );

      expect(contractProbeMessage(error)).toMatch(
        /fund_execution_case_approval_action_chain_invalid/u
      );
    }
  );

  it.each(["inactive_actor", "inactive_represented_user"] as const)(
    "migration contract 拒绝 ApprovalActionLog %s",
    async (mutation) => {
      const error = await runConfirmedContractMutation(
        "approval_actions",
        `RED: migration accepted ${mutation}`,
        async (tx, context) => {
          if (mutation === "inactive_actor") {
            await tx.$executeRaw`
              UPDATE "ApprovalActionLog"
              SET "actorUserId" = ${INACTIVE_DELEGATE_USER_ID}
              WHERE "approvalInstanceId" = ${context.approvalInstanceId}
                AND "approvedRoleKey" = 'finance_director'
            `;
          } else {
            await tx.$executeRaw`
              UPDATE "ApprovalActionLog"
              SET "representedUserId" = ${INACTIVE_DELEGATOR_USER_ID}
              WHERE "approvalInstanceId" = ${context.approvalInstanceId}
                AND "approvedRoleKey" = 'finance_director'
            `;
          }
        }
      );

      expect(contractProbeMessage(error)).toMatch(
        /fund_execution_case_approval_action_identity_invalid/u
      );
    }
  );

  it("真实 PostgreSQL 40P01 经 production service 三次重试后映射为可刷新 409", async () => {
    const firstLock = Math.floor(Math.random() * 1_000_000_000) + 1;
    const secondLock = firstLock + 1;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const first = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${firstLock})`;
      releaseFirst();
      await secondReady;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${secondLock})`;
    });
    const second = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${secondLock})`;
      releaseSecond();
      await firstReady;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${firstLock})`;
    });
    const outcomes = await Promise.allSettled([first, second]);
    const deadlock = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected"
    );
    expect(deadlock).toBeDefined();

    const transaction = jest.fn().mockRejectedValue(deadlock!.reason);
    const failingService = new FundExecutionService(
      { $transaction: transaction } as never,
      audit,
      options,
      canonicalAdapter
    );
    let caught: unknown;
    try {
      await failingService.submitCase(ACTOR_USER_ID, {
        caseId: "concurrency-mapping-case",
        expectedRevision: 1,
        idempotencyKey: randomUUID()
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: "FUND_EXECUTION_REFRESH_REQUIRED"
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it.each([
    { label: "P2034", error: { code: "P2034" } },
    {
      label: "P2010/meta.40P01",
      error: { code: "P2010", meta: { code: "40P01" } }
    }
  ])(
    "$label 在三次事务尝试后映射为可刷新 409",
    async ({ error }) => {
      const transaction = jest.fn().mockRejectedValue(error);
      const failingService = new FundExecutionService(
        { $transaction: transaction } as never,
        audit,
        options,
        canonicalAdapter
      );

      let caught: unknown;
      try {
        await failingService.submitCase(ACTOR_USER_ID, {
          caseId: "concurrency-mapping-case",
          expectedRevision: 1,
          idempotencyKey: randomUUID()
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        code: "FUND_EXECUTION_REFRESH_REQUIRED"
      });
      expect(transaction).toHaveBeenCalledTimes(3);
    }
  );

  async function runConfirmedContractMutation(
    snapshot: "approval_instance" | "approval_actions",
    sentinel: string,
    mutate: (
      tx: Prisma.TransactionClient,
      context: { caseId: string; approvalInstanceId: string }
    ) => Promise<void>
  ) {
    if (!confirmFlow) throw new Error("confirmed contract probe flow missing");
    const confirmedCase = await prisma.fundExecutionCase.findFirstOrThrow({
      where: { caseKey: confirmFlow.create.caseId, status: "confirmed" }
    });
    const approvalInstanceId = confirmedCase.approvalInstanceId;
    if (!approvalInstanceId) {
      throw new Error("confirmed contract probe approval missing");
    }
    const context = { caseId: confirmedCase.id, approvalInstanceId };

    return prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica"
        );
        await mutate(tx, context);
        if (snapshot === "approval_instance") {
          await tx.$executeRaw`
            UPDATE "FundExecutionCase" case_row
            SET "approvalInstanceSnapshot" = to_jsonb(instance),
                "approvalInstanceFingerprint" = encode(
                  public.digest(to_jsonb(instance)::TEXT, 'sha256'),
                  'hex'
                )
            FROM "ApprovalInstance" instance
            WHERE case_row."id" = ${context.caseId}
              AND instance."id" = ${context.approvalInstanceId}
          `;
        } else {
          await tx.$executeRaw`
            WITH frozen_logs AS (
              SELECT COALESCE(
                       jsonb_agg(
                         to_jsonb(action_log)
                         ORDER BY action_log."createdAt", action_log."id"
                       ),
                       '[]'::JSONB
                     ) AS snapshot,
                     COUNT(*)::INTEGER AS count
              FROM "ApprovalActionLog" action_log
              WHERE action_log."approvalInstanceId" =
                ${context.approvalInstanceId}
            )
            UPDATE "FundExecutionCase" case_row
            SET "approvalActionLogSnapshot" = frozen_logs.snapshot,
                "approvalActionLogCount" = frozen_logs.count,
                "approvalActionLogFingerprint" = encode(
                  public.digest(frozen_logs.snapshot::TEXT, 'sha256'),
                  'hex'
                )
            FROM frozen_logs
            WHERE case_row."id" = ${context.caseId}
          `;
        }
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = origin"
        );
        await tx.$executeRaw`
          SELECT assert_fund_execution_case_contract(${context.caseId})
        `;
        throw new Error(sentinel);
      })
      .then(() => null, (error: unknown) => error);
  }

  function contractProbeMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  async function createUpdatedFlow(input: {
    reference: string;
    sourceId: string;
    transactionFileId: string;
    reason: string;
  }): Promise<UpdatedFlow> {
    await observationService.record({
      reference: input.reference,
      payerVerificationId: PAYER_VERIFICATION_ID,
      transactionSourceType: "pg_test_bank_statement",
      transactionSourceId: input.sourceId,
      transactionSourceIdentity: createHash("sha256")
        .update(`pg-test:${input.sourceId}`)
        .digest("hex"),
      transactionEvidenceFileId: input.transactionFileId,
      transactionExecutedByUserId: EXECUTOR_USER_ID,
      amountCents: 10_000n,
      currencyCode: "CNY",
      direction: "inflow",
      occurredAt: OCCURRED_AT,
      createdByUserId: ACTOR_USER_ID,
      auditRequestId: randomUUID()
    });
    const candidates = (
      await options.listObservationCandidates(ACTOR_USER_ID)
    ).filter(({ summary }) => summary.startsWith("入账"));
    expect(candidates).toHaveLength(1);
    const createInput = {
      observationSelectionRef: candidates[0]!.selectionRef,
      reason: input.reason,
      idempotencyKey: randomUUID()
    };
    const created = await service.createCase(ACTOR_USER_ID, createInput);
    expect(created).toMatchObject({ status: "draft", revision: 1 });
    await expect(service.createCase(ACTOR_USER_ID, createInput)).resolves.toEqual(
      created
    );

    const plans = await options.listCasePlans(created.caseId, ACTOR_USER_ID);
    expect(plans).toHaveLength(1);
    const selectionRefs = plans[0]!.lines.flatMap((line) =>
      line.axes.map(({ selectionRef }) => selectionRef)
    );
    expect(selectionRefs).toHaveLength(4);
    const updateInput = {
      caseId: created.caseId,
      expectedRevision: created.revision,
      reason: `${input.reason}-分类完成`,
      selectionRefs,
      idempotencyKey: randomUUID()
    };
    const updated = await service.updateCase(ACTOR_USER_ID, updateInput);
    expect(updated).toMatchObject({ status: "draft", revision: 2 });
    await expect(service.updateCase(ACTOR_USER_ID, updateInput)).resolves.toEqual(
      updated
    );

    return {
      createInput,
      create: created,
      updateInput,
      update: updated
    };
  }

  async function createUpdateSubmitFlow(input: {
    reference: string;
    sourceId: string;
    transactionFileId: string;
    reason: string;
  }): Promise<Flow> {
    const flow = await createUpdatedFlow(input);
    const submitInput = {
      caseId: flow.create.caseId,
      expectedRevision: flow.update.revision,
      idempotencyKey: randomUUID()
    };
    const submitted = await service.submitCase(ACTOR_USER_ID, submitInput);
    expect(submitted).toMatchObject({ status: "submitted", revision: 3 });
    await expect(service.submitCase(ACTOR_USER_ID, submitInput)).resolves.toEqual(
      submitted
    );
    return {
      ...flow,
      submitInput,
      submit: submitted
    };
  }

  async function createIsolatedSubmittedFlow(label: string) {
    const transactionFileId = randomUUID();
    await prisma.fileObject.create({
      data: fileFixture(
        transactionFileId,
        `${label}-${transactionFileId}.pdf`,
        ACTOR_USER_ID
      )
    });
    return createUpdateSubmitFlow({
      reference: `PG-${label.toUpperCase()}`,
      sourceId: `pg-${label}-${randomUUID()}`,
      transactionFileId,
      reason: `PG ${label}`
    });
  }

  async function commandReceiptActions(fundExecutionId: string) {
    const receipts = await prisma.fundExecutionCommandReceipt.findMany({
      where: { fundExecutionId },
      orderBy: { createdAt: "asc" },
      select: { action: true }
    });
    return receipts.map(({ action }) => action);
  }

  async function createAndConfirmAppliedProjectFundOutflow() {
    await observationService.record({
      reference: "PG-APPLIED-PROJECT-FUND-OUTFLOW",
      payerVerificationId: PAYER_VERIFICATION_ID,
      transactionSourceType: "pg_test_bank_statement",
      transactionSourceId: "pg-applied-project-fund-outflow",
      transactionSourceIdentity: createHash("sha256")
        .update("pg-test:applied-project-fund-outflow")
        .digest("hex"),
      transactionEvidenceFileId: OUTFLOW_TRANSACTION_FILE_ID,
      transactionExecutedByUserId: EXECUTOR_USER_ID,
      amountCents: 10_000n,
      currencyCode: "CNY",
      direction: "outflow",
      occurredAt: new Date("2026-08-31T04:45:00.000Z"),
      createdByUserId: ACTOR_USER_ID,
      auditRequestId: randomUUID()
    });
    const observation = (
      await options.listObservationCandidates(ACTOR_USER_ID)
    ).find(
      ({ summary }) =>
        summary.startsWith("出账") && summary.includes("PG 测试参与公司")
    );
    if (!observation) throw new Error("applied project fund outflow missing");
    const created = await service.createCase(ACTOR_USER_ID, {
      observationSelectionRef: observation.selectionRef,
      reason: "独立 project_fund applied 部分反向源",
      idempotencyKey: randomUUID()
    });
    const plans = await options.listCasePlans(created.caseId, ACTOR_USER_ID);
    const appliedPlan = plans.find((plan) =>
      plan.lines.some((line) =>
        line.axes.some(
          ({ axis, status }) => axis === "project_fund" && status === "applied"
        )
      )
    );
    if (!appliedPlan) {
      throw new Error("server did not offer an applied project_fund plan");
    }
    const updated = await service.updateCase(ACTOR_USER_ID, {
      caseId: created.caseId,
      expectedRevision: created.revision,
      reason: "选择服务端 project_fund applied 方案",
      selectionRefs: appliedPlan.lines.flatMap((line) =>
        line.axes.map(({ selectionRef }) => selectionRef)
      ),
      idempotencyKey: randomUUID()
    });
    const submitted = await service.submitCase(ACTOR_USER_ID, {
      caseId: created.caseId,
      expectedRevision: updated.revision,
      idempotencyKey: randomUUID()
    });
    await service.reviewApproval(REVIEWER_USER_ID, {
      caseId: created.caseId,
      action: "approve",
      comment: "财务主管同意 applied project_fund 出账"
    });
    await service.reviewApproval(CHAIRMAN_USER_ID, {
      caseId: created.caseId,
      action: "approve",
      comment: "董事长同意 applied project_fund 出账"
    });
    return service.confirmCase(CONFIRMER_USER_ID, {
      caseId: created.caseId,
      expectedRevision: submitted.revision,
      idempotencyKey: randomUUID()
    });
  }

  async function createAndConfirmReversal(input: {
    targetSummaryNeedle: string;
    reference: string;
    sourceId: string;
    transactionFileId: string;
    amountCents: bigint;
    direction: "inflow" | "outflow";
    occurredAt: Date;
  }) {
    await observationService.record({
      reference: input.reference,
      payerVerificationId: PAYER_VERIFICATION_ID,
      transactionSourceType: "pg_test_bank_statement",
      transactionSourceId: input.sourceId,
      transactionSourceIdentity: createHash("sha256")
        .update(`pg-test:${input.sourceId}`)
        .digest("hex"),
      transactionEvidenceFileId: input.transactionFileId,
      transactionExecutedByUserId: EXECUTOR_USER_ID,
      amountCents: input.amountCents,
      currencyCode: "CNY",
      direction: input.direction,
      occurredAt: input.occurredAt,
      createdByUserId: ACTOR_USER_ID,
      auditRequestId: randomUUID()
    });
    const targets = await options.listReversalTargets(ACTOR_USER_ID);
    const target = targets.find(({ summary }) =>
      summary.includes(input.targetSummaryNeedle)
    );
    if (!target) throw new Error("reversal target missing");
    const observation = (
      await options.listObservationCandidates(ACTOR_USER_ID)
    ).find(
      ({ summary }) =>
        summary.startsWith(input.direction === "inflow" ? "入账" : "出账") &&
        summary.includes("PG 测试参与公司")
    );
    if (!observation) throw new Error("reversal observation missing");
    const created = await service.createReversalCase(ACTOR_USER_ID, {
      targetSelectionRef: target.targetSelectionRef,
      observationSelectionRef: observation.selectionRef,
      reason: `累计反向 ${input.amountCents.toString()}`,
      idempotencyKey: randomUUID()
    });
    const submitted = await service.submitCase(ACTOR_USER_ID, {
      caseId: created.caseId,
      expectedRevision: created.revision,
      idempotencyKey: randomUUID()
    });
    await service.reviewApproval(REVIEWER_USER_ID, {
      caseId: created.caseId,
      action: "approve",
      comment: "财务主管同意反向"
    });
    await service.reviewApproval(CHAIRMAN_USER_ID, {
      caseId: created.caseId,
      action: "approve",
      comment: "董事长同意反向"
    });
    return service.confirmCase(CONFIRMER_USER_ID, {
      caseId: created.caseId,
      expectedRevision: submitted.revision,
      idempotencyKey: randomUUID()
    });
  }
});

async function seedExternalDomainFixtures(prisma: PrismaClient) {
  await prisma.user.createMany({
    data: [
      { id: ACTOR_USER_ID, name: "资金执行创建人", isActive: true },
      { id: REVIEWER_USER_ID, name: "资金执行财务审批人", isActive: true },
      { id: CONFIRMER_USER_ID, name: "资金执行确认人", isActive: true },
      { id: CHAIRMAN_USER_ID, name: "资金执行最终审批人", isActive: true },
      { id: EXECUTOR_USER_ID, name: "银行交易执行人", isActive: true },
      {
        id: REVIEWER_DELEGATE_USER_ID,
        name: "资金执行财务审批受托人",
        isActive: true
      },
      {
        id: SCOPED_DELEGATE_USER_ID,
        name: "资金执行限定案件审批受托人",
        isActive: true
      },
      {
        id: INACTIVE_DELEGATE_USER_ID,
        name: "停用审批受托人",
        isActive: false
      },
      {
        id: INACTIVE_DELEGATOR_USER_ID,
        name: "停用审批委托人",
        isActive: false
      },
      {
        id: INACTIVE_DELEGATOR_DELEGATE_USER_ID,
        name: "停用委托人的在用受托人",
        isActive: true
      },
      {
        id: BOUNDARY_ACTIVE_DELEGATE_USER_ID,
        name: "半开区间生效受托人",
        isActive: true
      },
      {
        id: BOUNDARY_EXPIRED_DELEGATE_USER_ID,
        name: "半开区间失效受托人",
        isActive: true
      }
    ]
  });
  const financeStaffPositionId = randomUUID();
  const financeDirectorPositionId = randomUUID();
  const chairmanPositionId = randomUUID();
  await prisma.position.createMany({
    data: [
      { id: financeStaffPositionId, key: "finance_staff", name: "财务人员" },
      {
        id: financeDirectorPositionId,
        key: "finance_director",
        name: "财务主管"
      },
      { id: chairmanPositionId, key: "chairman", name: "董事长" }
    ]
  });
  await prisma.userPosition.createMany({
    data: [
      {
        id: randomUUID(),
        userId: ACTOR_USER_ID,
        positionId: financeStaffPositionId,
        projectId: null
      },
      {
        id: randomUUID(),
        userId: REVIEWER_USER_ID,
        positionId: financeDirectorPositionId,
        projectId: null
      },
      {
        id: randomUUID(),
        userId: CONFIRMER_USER_ID,
        positionId: financeDirectorPositionId,
        projectId: null
      },
      {
        id: randomUUID(),
        userId: INACTIVE_DELEGATOR_USER_ID,
        positionId: financeDirectorPositionId,
        projectId: null
      },
      {
        id: randomUUID(),
        userId: CHAIRMAN_USER_ID,
        positionId: chairmanPositionId,
        projectId: null
      }
    ]
  });
  await prisma.approvalDelegation.create({
    data: {
      id: randomUUID(),
      fromUserId: REVIEWER_USER_ID,
      toUserId: REVIEWER_DELEGATE_USER_ID,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      enabled: true
    }
  });
  await prisma.companyEntity.create({
    data: {
      id: COMPANY_ID,
      name: "PG 测试参与公司",
      unifiedSocialCreditCode: "91310000PGTEST0001",
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await prisma.companyEntityVersion.create({
    data: {
      id: COMPANY_VERSION_ID,
      companyEntityId: COMPANY_ID,
      versionNo: 1,
      name: "PG 测试参与公司",
      unifiedSocialCreditCode: "91310000PGTEST0001",
      isActive: true,
      action: "pg_fixture",
      actorUserId: ACTOR_USER_ID,
      actorRoleKey: "finance_staff"
    }
  });
  await prisma.companyEntity.create({
    data: {
      id: OTHER_COMPANY_ID,
      name: "PG 测试其他账户公司",
      unifiedSocialCreditCode: "91310000PGTEST0003",
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await prisma.companyEntityVersion.create({
    data: {
      id: OTHER_COMPANY_VERSION_ID,
      companyEntityId: OTHER_COMPANY_ID,
      versionNo: 1,
      name: "PG 测试其他账户公司",
      unifiedSocialCreditCode: "91310000PGTEST0003",
      isActive: true,
      action: "pg_fixture",
      actorUserId: ACTOR_USER_ID,
      actorRoleKey: "finance_staff"
    }
  });
  await prisma.businessParty.create({
    data: {
      id: AFFILIATE_PARTY_ID,
      name: "PG 测试施工企业",
      normalizedName: "pg测试施工企业",
      unifiedSocialCreditCode: "91310000PGTEST0002",
      createdByUserId: ACTOR_USER_ID
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: AFFILIATE_VERSION_ID,
      businessPartyId: AFFILIATE_PARTY_ID,
      versionNo: 1,
      snapshot: {
        name: "PG 测试施工企业",
        unifiedSocialCreditCode: "91310000PGTEST0002"
      },
      createdByUserId: ACTOR_USER_ID
    }
  });
  await prisma.project.create({
    data: { id: PROJECT_ID, code: "PG-FUND-V7", name: "PG 资金执行项目" }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: AFFILIATE_ASSIGNMENT_ID,
      projectId: PROJECT_ID,
      businessPartyId: AFFILIATE_PARTY_ID,
      businessPartyVersionId: AFFILIATE_VERSION_ID,
      affiliateNameSnapshot: "PG 测试施工企业",
      affiliateCreditCodeSnapshot: "91310000PGTEST0002",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "PG 外部域 fixture",
      assignedByUserId: ACTOR_USER_ID
    }
  });
  await prisma.projectParticipatingCompany.create({
    data: {
      id: PARTICIPANT_ID,
      projectId: PROJECT_ID,
      companyEntityId: COMPANY_ID,
      companyEntityVersionId: COMPANY_VERSION_ID,
      companyNameSnapshot: "PG 测试参与公司",
      companyCreditCodeSnapshot: "91310000PGTEST0001",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "PG 外部域 fixture",
      addedByUserId: ACTOR_USER_ID
    }
  });
  await prisma.project.update({
    where: { id: PROJECT_ID },
    data: { operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z") }
  });
  await prisma.fileObject.createMany({
    data: [
      fileFixture(VERIFICATION_FILE_ID, "payer-verification.pdf", REVIEWER_USER_ID),
      fileFixture(RETURN_TRANSACTION_FILE_ID, "return-bank.pdf", ACTOR_USER_ID),
      fileFixture(CONFIRM_TRANSACTION_FILE_ID, "confirm-bank.pdf", ACTOR_USER_ID),
      fileFixture(SIGNATURE_FILE_ID, "chairman-signature.png", CHAIRMAN_USER_ID),
      fileFixture(REVERSE_TRANSACTION_FILE_ID_1, "reverse-1-bank.pdf", ACTOR_USER_ID),
      fileFixture(REVERSE_TRANSACTION_FILE_ID_2, "reverse-2-bank.pdf", ACTOR_USER_ID),
      fileFixture(
        OTHER_VERIFICATION_FILE_ID,
        "other-verification.pdf",
        REVIEWER_USER_ID
      ),
      fileFixture(
        HOLDER_MISMATCH_TRANSACTION_FILE_ID,
        "holder-mismatch-bank.pdf",
        ACTOR_USER_ID
      ),
      fileFixture(SOD_TRANSACTION_FILE_ID, "sod-editor-bank.pdf", ACTOR_USER_ID),
      fileFixture(
        OUTFLOW_TRANSACTION_FILE_ID,
        "applied-project-fund-outflow.pdf",
        ACTOR_USER_ID
      ),
      fileFixture(PROJECT_RECEIPT_FILE_ID, "project-receipt.pdf", ACTOR_USER_ID),
      fileFixture(WAGE_SOURCE_FILE_ID, "wage-source.pdf", ACTOR_USER_ID)
    ]
  });
  await prisma.projectReceipt.create({
    data: {
      id: randomUUID(),
      projectId: PROJECT_ID,
      receivedAt: new Date("2026-08-30T00:00:00.000Z"),
      amountCents: 10_000n,
      payerName: "PG 项目资金来源",
      sourceType: "other",
      description: "project_fund applied 测试资金来源",
      voucherFileId: PROJECT_RECEIPT_FILE_ID,
      recordedByUserId: ACTOR_USER_ID
    }
  });
  await seedWagePayableFixture(prisma);
  await prisma.handwrittenSignatureVersion.create({
    data: {
      id: SIGNATURE_VERSION_ID,
      userId: CHAIRMAN_USER_ID,
      fileId: SIGNATURE_FILE_ID,
      contentSha256: SHA256,
      source: "canvas"
    }
  });
  await prisma.$executeRaw`
    INSERT INTO "OperatingLedgerWriteSecret"("id", "secretHash")
    VALUES (1, crypt(${WRITE_SECRET}, gen_salt('bf')))
  `;
  await prisma.$queryRaw`
    SELECT * FROM public."jg_issue_payment_execution_payer_verification_trusted"(
      ${JSON.stringify({
        id: PAYER_VERIFICATION_ID,
        reference: "PG-PAYER-VERIFICATION",
        holderCompanyEntityId: COMPANY_ID,
        holderNameSnapshot: "PG 测试参与公司",
        holderCreditCodeSnapshot: "91310000PGTEST0001",
        verificationReference: "PG-BANK-VERIFY-001",
        verifiedByUserId: REVIEWER_USER_ID,
        verifiedAt: "2026-08-30T04:00:00.000Z",
        verificationEvidenceFileId: VERIFICATION_FILE_ID,
        verificationEvidenceContentSha256: SHA256,
        status: "verified",
        sourceType: "bank_account_legal_holder",
        sourceRecordId: "pg-payer-source-001"
      })}::JSONB
    )
  `;
  await prisma.$queryRaw`
    SELECT * FROM public."jg_issue_payment_execution_payer_verification_trusted"(
      ${JSON.stringify({
        id: OTHER_PAYER_VERIFICATION_ID,
        reference: "PG-PAYER-VERIFICATION-OTHER",
        holderCompanyEntityId: OTHER_COMPANY_ID,
        holderNameSnapshot: "PG 测试其他账户公司",
        holderCreditCodeSnapshot: "91310000PGTEST0003",
        verificationReference: "PG-BANK-VERIFY-002",
        verifiedByUserId: REVIEWER_USER_ID,
        verifiedAt: "2026-08-30T04:10:00.000Z",
        verificationEvidenceFileId: OTHER_VERIFICATION_FILE_ID,
        verificationEvidenceContentSha256: SHA256,
        status: "verified",
        sourceType: "bank_account_legal_holder",
        sourceRecordId: "pg-payer-source-002"
      })}::JSONB
    )
  `;
}

async function seedWagePayableFixture(prisma: PrismaClient) {
  const sourceVersionId = randomUUID();
  const statementId = randomUUID();
  const confirmedVersionId = randomUUID();
  const serviceBasisBindingId = randomUUID();
  const personLineId = randomUUID();
  const creditorBreakdownId = randomUUID();
  const projectAllocationId = randomUUID();
  await prisma.wageApprovedSourceVersion.create({
    data: {
      id: sourceVersionId,
      employmentCompanyId: COMPANY_ID,
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "pg-fund-v7-wage-source",
      sourceVersion: "v1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: WAGE_SOURCE_FILE_ID,
      evidenceSha256: SHA256,
      sourceFingerprint: "b".repeat(64),
      sourceSnapshot: { source: "fund-execution-v7-pg" },
      createdByUserId: ACTOR_USER_ID
    }
  });
  await prisma.wageStatement.create({
    data: {
      id: statementId,
      employmentCompanyId: COMPANY_ID,
      wageMonth: "2026-08",
      currentRevision: 1,
      createdByUserId: ACTOR_USER_ID
    }
  });
  await prisma.wageStatementVersion.create({
    data: {
      id: confirmedVersionId,
      statementId,
      revision: 1,
      kind: "base",
      status: "confirmed",
      sourceVersionId,
      sourceSnapshot: { sourceVersionId },
      createdByUserId: ACTOR_USER_ID,
      lastEditedByUserId: ACTOR_USER_ID,
      confirmedByUserId: REVIEWER_USER_ID,
      confirmedAt: new Date("2026-08-30T01:00:00.000Z")
    }
  });
  await prisma.wageServiceBasisBinding.create({
    data: {
      id: serviceBasisBindingId,
      sourceVersionId,
      projectId: PROJECT_ID,
      serviceSnapshotId: randomUUID(),
      serviceMonth: "2026-08",
      evidenceSha256: "d".repeat(64),
      authorityFingerprint: "e".repeat(64)
    }
  });
  await prisma.wagePersonLine.create({
    data: {
      id: personLineId,
      statementVersionId: confirmedVersionId,
      employeeId: randomUUID(),
      employmentSnapshotId: randomUUID(),
      employeeSnapshot: { protected: true },
      employmentSnapshot: { protected: true },
      periodSnapshot: { wageMonth: "2026-08" },
      positionCategorySnapshot: { category: "general_worker" },
      approvedAmountCents: 10_000n
    }
  });
  await prisma.wageCreditorBreakdown.create({
    data: {
      id: creditorBreakdownId,
      personLineId,
      creditorSubjectType: "employee_user",
      creditorUserId: ACTOR_USER_ID,
      creditorSubjectIdentityKey: `employee_user:${ACTOR_USER_ID}`,
      creditorNameSnapshot: "PG 工资债权人",
      creditorUnifiedIdentitySnapshot: null,
      creditorVersionFingerprint: "c".repeat(64),
      creditorCategory: "employee_net_pay",
      amountCents: 10_000n,
      sourceSnapshot: { protected: true }
    }
  });
  await prisma.wageProjectAllocation.create({
    data: {
      id: projectAllocationId,
      personLineId,
      projectId: PROJECT_ID,
      serviceSnapshotId: randomUUID(),
      serviceBasisBindingId,
      serviceSnapshot: { projectId: PROJECT_ID },
      amountCents: 10_000n
    }
  });
  await prisma.wagePayableRef.create({
    data: {
      id: randomUUID(),
      confirmedVersionId,
      projectAllocationId,
      creditorBreakdownId,
      debtorCompanyId: COMPANY_ID,
      costBearingCompanyId: COMPANY_ID,
      projectId: PROJECT_ID,
      personLineId,
      debtorCompanySnapshot: { companyId: COMPANY_ID },
      costBearingCompanySnapshot: { companyId: COMPANY_ID },
      projectSnapshot: { projectId: PROJECT_ID },
      personSnapshot: { protected: true },
      creditorSnapshot: {
        subjectType: "employee_user",
        identityKey: `employee_user:${ACTOR_USER_ID}`,
        name: "PG 工资债权人"
      },
      amountCents: 10_000n,
      direction: "increase",
      settlementRecheckRequired: false
    }
  });
}

function fileFixture(id: string, name: string, uploadedByUserId: string) {
  return {
    id,
    bucket: "pg-fund-v7-test",
    objectKey: `pg-fund-v7/${name}`,
    originalName: name,
    mimeType: name.endsWith(".png") ? "image/png" : "application/pdf",
    sizeBytes: 128,
    uploadedByUserId,
    contentSha256: SHA256,
    storageStatus: "active"
  };
}

async function authorize(
  tx: Prisma.TransactionClient,
  requestId: string,
  action: string
) {
  await tx.$executeRaw`
    SELECT public."authorizeOperatingLedgerWrite"(${ACTOR_USER_ID}, ${WRITE_SECRET})
  `;
  await tx.$executeRaw`
    SELECT set_config('app.fund_execution_actor', ${ACTOR_USER_ID}, true)
  `;
  await tx.$executeRaw`
    SELECT set_config('app.fund_execution_request_id', ${requestId}, true)
  `;
  await tx.$executeRaw`
    SELECT set_config('app.fund_execution_action', ${action}, true)
  `;
}
