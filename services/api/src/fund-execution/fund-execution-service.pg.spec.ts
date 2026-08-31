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
    expect(targets).toHaveLength(1);
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
    if (!confirmFlow) throw new Error("confirmed source flow missing");
    const originalExecutionId = confirmFlow.create.fundExecutionId;

    const first = await createAndConfirmReversal({
      targetExecutionId: originalExecutionId,
      reference: "PG-REVERSE-OBSERVATION-1",
      sourceId: "pg-reverse-source-1",
      transactionFileId: REVERSE_TRANSACTION_FILE_ID_1,
      amountCents: 4_000n,
      occurredAt: new Date("2026-08-31T05:00:00.000Z")
    });
    const firstLines = await prisma.executionAllocationLine.findMany({
      where: { fundExecutionId: first.fundExecutionId }
    });
    expect(firstLines).toHaveLength(1);
    expect(firstLines[0]!.amountCents).toBe(4_000n);

    const second = await createAndConfirmReversal({
      targetExecutionId: originalExecutionId,
      reference: "PG-REVERSE-OBSERVATION-2",
      sourceId: "pg-reverse-source-2",
      transactionFileId: REVERSE_TRANSACTION_FILE_ID_2,
      amountCents: 6_000n,
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
    expect(targets).toHaveLength(0);
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

  it.each(["40P01", "P2034"])(
    "%s 在三次事务尝试后映射为可刷新 409",
    async (code) => {
      const transaction = jest.fn().mockRejectedValue({ code });
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

  async function createUpdateSubmitFlow(input: {
    reference: string;
    sourceId: string;
    transactionFileId: string;
    reason: string;
  }): Promise<Flow> {
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
    const candidates = await options.listObservationCandidates(ACTOR_USER_ID);
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

    const submitInput = {
      caseId: created.caseId,
      expectedRevision: updated.revision,
      idempotencyKey: randomUUID()
    };
    const submitted = await service.submitCase(ACTOR_USER_ID, submitInput);
    expect(submitted).toMatchObject({ status: "submitted", revision: 3 });
    await expect(service.submitCase(ACTOR_USER_ID, submitInput)).resolves.toEqual(
      submitted
    );
    return {
      createInput,
      create: created,
      updateInput,
      update: updated,
      submitInput,
      submit: submitted
    };
  }

  async function commandReceiptActions(fundExecutionId: string) {
    const receipts = await prisma.fundExecutionCommandReceipt.findMany({
      where: { fundExecutionId },
      orderBy: { createdAt: "asc" },
      select: { action: true }
    });
    return receipts.map(({ action }) => action);
  }

  async function createAndConfirmReversal(input: {
    targetExecutionId: string;
    reference: string;
    sourceId: string;
    transactionFileId: string;
    amountCents: bigint;
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
      direction: "outflow",
      occurredAt: input.occurredAt,
      createdByUserId: ACTOR_USER_ID,
      auditRequestId: randomUUID()
    });
    const targets = await options.listReversalTargets(ACTOR_USER_ID);
    expect(targets).toHaveLength(1);
    const target = targets[0]!;
    const observation = (
      await options.listObservationCandidates(ACTOR_USER_ID)
    ).find(({ summary }) => summary.includes("PG 测试参与公司"));
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
      fileFixture(SOD_TRANSACTION_FILE_ID, "sod-editor-bank.pdf", ACTOR_USER_ID)
    ]
  });
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
