import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  occurredBeforeEffectiveDate,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate
} from "../operating-ledger/formal-operating-source.helpers";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import {
  deriveEffectiveWagePayableAmount,
  payableSourceAdapterRegistry,
  type RegisteredPayable
} from "../payable-registry/wage-payable-source.adapter";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { fundExecutionCommandFingerprint } from "./fund-execution-command-receipt";
import {
  executionOperatingPayee as operatingPayee,
  stableExecutionIdentity as stableIdentity
} from "./fund-execution-canonical-identity";
import { EXECUTION_ALLOCATION_AXES, type ExecutionAllocationAxis } from "./fund-execution.domain";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { fundExecutionSelectionRefFingerprint } from "./fund-execution-selection-ref.service";

type Transaction = Prisma.TransactionClient;

export type ClaimedPaymentWageBinding = Readonly<{
  payableRef: string;
  amountCents: bigint;
}>;

export type ClaimedPaymentExecutionInput = Readonly<{
  actorUserId: string;
  auditRequestId: string;
  observationSelectionRef: string;
  paymentExecutionId: string;
  paymentRequestId: string;
  projectId: string;
  amountCents: bigint;
  occurredAt: Date;
  wagePayableBindings: readonly ClaimedPaymentWageBinding[];
}>;

type PayableContext = Readonly<{
  registered: RegisteredPayable;
  sourceSnapshot: Prisma.InputJsonObject;
  amountCents: bigint;
}>;

type FrozenProxyAuthorization = Readonly<{
  reason: string;
  evidenceFileId: string;
  evidenceContentSha256: string;
  reauthorizationReference: string;
  approvalInstanceId: string;
  approvalActionLogId: string;
  reauthorizedByUserId: string;
  reauthorizedAt: Date;
}>;

@Injectable()
export class PaymentExecutionSharedAllocationService {
  constructor(
    private readonly options: FundExecutionSelectionOptionsService,
    private readonly projectFunding: ProjectFundingAvailabilityService,
    private readonly operatingLedger: OperatingLedgerService
  ) {}

  async assertReplayInTransaction(
    tx: Transaction,
    input: ClaimedPaymentExecutionInput
  ) {
    const claim = await tx.bankTransactionClaim.findUnique({
      where: { paymentExecutionId: input.paymentExecutionId }
    });
    if (!claim || claim.targetType !== "payment_execution") {
      throw new ConflictException("该付款执行没有可重放的共享银行认领");
    }
    if (
      claim.selectionRefFingerprint !==
      fundExecutionSelectionRefFingerprint(input.observationSelectionRef)
    ) {
      throw new ConflictException("付款执行共享银行认领与原始候选引用不一致");
    }
    const lines = await tx.executionAllocationLine.findMany({
      where: {
        paymentExecutionId: input.paymentExecutionId,
        executionType: "payment_execution"
      },
      orderBy: { lineNo: "asc" }
    });
    if (
      !lines.length ||
      lines.reduce((sum, line) => sum + line.amountCents, 0n) !==
        input.amountCents
    ) {
      throw new ConflictException("付款执行共享分配重放证据不完整");
    }
    const effects = await tx.executionAllocationAxisEffect.findMany({
      where: { executionAllocationLineId: { in: lines.map(({ id }) => id) } }
    });
    if (effects.length !== lines.length * 4) {
      throw new ConflictException("付款执行共享四轴重放证据不完整");
    }
    return { allocationLineCount: lines.length };
  }

  async materializeInTransaction(
    tx: Transaction,
    input: ClaimedPaymentExecutionInput
  ): Promise<{ allocationLineCount: number }> {
    if (!input.wagePayableBindings.length) {
      throw new BadRequestException(
        "只有完整关联已确认工资应付的付款执行才能认领银行流水"
      );
    }
    const total = input.wagePayableBindings.reduce(
      (sum, binding) => sum + binding.amountCents,
      0n
    );
    if (
      input.amountCents <= 0n ||
      total !== input.amountCents ||
      input.wagePayableBindings.some(({ amountCents }) => amountCents <= 0n)
    ) {
      throw new BadRequestException("银行流水认领必须完整覆盖付款执行金额");
    }
    await this.authorizeContext(tx, input);
    const matched = await this.options.matchObservationInTransaction(
      tx,
      input.actorUserId,
      input.observationSelectionRef
    );
    const observation = matched.observation;
    if (
      observation.direction !== "outflow" ||
      observation.amountCents !== input.amountCents ||
      observation.currencyCode !== "CNY" ||
      observation.occurredAt.getTime() !== input.occurredAt.getTime()
    ) {
      throw new ConflictException("银行流水候选与付款执行金额、方向或时间不一致");
    }
    const execution = await tx.paymentExecution.findUnique({
      where: { id: input.paymentExecutionId }
    });
    const attestation = await tx.paymentExecutionPayerAttestation.findUnique({
      where: { paymentExecutionId: input.paymentExecutionId }
    });
    if (
      !execution ||
      !attestation ||
      execution.paymentRequestId !== input.paymentRequestId ||
      execution.amountCents !== input.amountCents ||
      execution.paidAt.getTime() !== input.occurredAt.getTime() ||
      attestation.payerVerificationId !== observation.payerVerificationId ||
      attestation.holderCompanyEntityId !== observation.holderCompanyEntityId ||
      attestation.verificationEvidenceFileId !==
        observation.verificationEvidenceFileId ||
      attestation.verificationEvidenceContentSha256 !==
        observation.verificationEvidenceContentSha256
    ) {
      throw new ConflictException("付款执行与服务端核验的银行流水权威不一致");
    }
    const payables = await this.lockPayables(tx, input.wagePayableBindings);
    const projectContext = await this.projectContext(tx, {
      projectId: input.projectId,
      occurredAt: input.occurredAt,
      holderCompanyEntityId: observation.holderCompanyEntityId
    });
    const ordered = [...payables].sort((left, right) =>
      left.registered.payableRef.localeCompare(right.registered.payableRef)
    );
    if (
      ordered.some(
        (payable) =>
          payable.registered.beneficiaryProjectId !== input.projectId ||
          payable.registered.debtorCompanyId !== execution.companyEntityIdSnapshot
      )
    ) {
      throw new ConflictException("付款执行关联的应付不属于同一项目或债务主体");
    }
    const relationshipApplied = ordered.some(
      (payable) =>
        payable.registered.debtorCompanyId !== observation.holderCompanyEntityId
    );
    const proxyAuthorization = relationshipApplied
      ? this.frozenProxyAuthorization(attestation, input.paymentRequestId)
      : null;

    // A Claim is the last eligibility write: every immutable input and the
    // complete formal allocation plan must already have resolved successfully.
    // The surrounding recordExecution transaction still owns atomic commit.
    await tx.bankTransactionClaim.create({
      data: {
        id: randomUUID(),
        observationId: observation.id,
        selectionRefFingerprint: fundExecutionSelectionRefFingerprint(
          input.observationSelectionRef
        ),
        targetType: "payment_execution",
        paymentExecutionId: input.paymentExecutionId,
        createdByUserId: input.actorUserId,
        auditAction: "payment_execution_record",
        auditRequestId: input.auditRequestId,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });

    const settlementCase = await tx.payableSettlementCase.create({
      data: {
        id: randomUUID(),
        paymentExecutionId: input.paymentExecutionId,
        status: "draft",
        revision: 1,
        createdByUserId: input.actorUserId
      }
    });

    for (const [index, payable] of ordered.entries()) {
      await this.materializeLine(tx, input, observation, projectContext, {
        lineNo: index + 1,
        payable,
        settlementCaseId: settlementCase.id,
        proxyAuthorization
      });
    }
    return { allocationLineCount: ordered.length };
  }

  private async materializeLine(
    tx: Transaction,
    input: ClaimedPaymentExecutionInput,
    observation: Awaited<
      ReturnType<FundExecutionSelectionOptionsService["matchObservationInTransaction"]>
    >["observation"],
    projectContext: Awaited<ReturnType<PaymentExecutionSharedAllocationService["projectContext"]>>,
    lineInput: Readonly<{
      lineNo: number;
      payable: PayableContext;
      settlementCaseId: string;
      proxyAuthorization: FrozenProxyAuthorization | null;
    }>
  ) {
    const { payable, lineNo } = lineInput;
    const lineId = randomUUID();
    const sliceIdentity = stableIdentity("claimed-payment-slice", {
      paymentExecutionId: input.paymentExecutionId,
      payableRef: payable.registered.payableRef,
      amountCents: payable.amountCents
    });
    await tx.executionAllocationLine.create({
      data: {
        id: lineId,
        executionType: "payment_execution",
        executionId: input.paymentExecutionId,
        paymentExecutionId: input.paymentExecutionId,
        lineNo,
        direction: "outflow",
        amountCents: payable.amountCents,
        currencyCode: "CNY",
        businessType: payable.registered.sourceType,
        businessId: payable.registered.payableRef,
        sourceIdentity: payable.registered.payableRef,
        sliceIdentity,
        payloadFingerprint: fundExecutionCommandFingerprint("confirm_case", {
          paymentExecutionId: input.paymentExecutionId,
          lineNo,
          payableRef: payable.registered.payableRef,
          sliceIdentity,
          amountCents: payable.amountCents
        }),
        createdByUserId: input.actorUserId,
        auditRequestId: input.auditRequestId,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });
    const relationshipApplied =
      payable.registered.debtorCompanyId !== observation.holderCompanyEntityId;
    const effectIds = new Map<ExecutionAllocationAxis, string>();
    const identities: Record<ExecutionAllocationAxis, string> = {
      payable: `payable:${payable.registered.payableRef}`,
      project_fund: `project_fund:${input.projectId}:${sliceIdentity}`,
      relationship: relationshipApplied
        ? `relationship:${payable.registered.debtorCompanyId}:${observation.holderCompanyEntityId}`
        : `relationship:not_applicable:${payable.registered.debtorCompanyId}`,
      operating: `operating:${input.projectId}:${projectContext.affiliate.assignmentId}:${observation.holderCompanyEntityId}`
    };
    for (const axis of EXECUTION_ALLOCATION_AXES) {
      const applied = axis !== "relationship" || relationshipApplied;
      const id = randomUUID();
      effectIds.set(axis, id);
      await tx.executionAllocationAxisEffect.create({
        data: {
          id,
          executionAllocationLineId: lineId,
          axis,
          axisIdentity: identities[axis],
          status: applied ? "applied" : "not_applicable",
          amountCents: applied ? payable.amountCents : 0n,
          createdByUserId: input.actorUserId,
          auditRequestId: input.auditRequestId,
          createdTransactionId: 0n,
          createdBackendPid: 0
        }
      });
    }

    const payableAllocationId = randomUUID();
    await tx.payableSettlementAllocation.create({
      data: {
        id: payableAllocationId,
        settlementCaseId: lineInput.settlementCaseId,
        paymentExecutionId: input.paymentExecutionId,
        executionAllocationLineId: lineId,
        payableRef: payable.registered.payableRef,
        sourceType: payable.registered.sourceType,
        sourceAggregateId: payable.registered.sourceAggregateId,
        sourceLineId: payable.registered.sourceLineId,
        confirmedVersionId: payable.registered.confirmedVersionId,
        debtorCompanyId: payable.registered.debtorCompanyId,
        payeeSubjectType: payable.registered.payeeSubjectType,
        payeeSubjectId: payable.registered.payeeSubjectId,
        currencyCode: payable.registered.currencyCode,
        beneficiaryProjectId: payable.registered.beneficiaryProjectId,
        sourceSnapshot: payable.sourceSnapshot,
        confirmedAmountCents: payable.registered.confirmedAmountCents,
        amountCents: payable.amountCents,
        direction: "settle",
        createdByUserId: input.actorUserId
      }
    });
    await this.consequence(tx, input, {
      effectId: effectIds.get("payable")!,
      sequence: 1,
      type: "payable_settlement_allocation",
      identity: `payable:${payable.registered.payableRef}:${sliceIdentity}`,
      sliceIdentity,
      amountCents: payable.amountCents,
      payableSettlementAllocationId: payableAllocationId
    });

    const funding = await this.projectFunding.allocateExecution(tx, {
      projectId: input.projectId,
      executionType: "payment_execution",
      executionId: input.paymentExecutionId,
      businessType: payable.registered.sourceType,
      businessId: payable.registered.payableRef,
      amountCents: payable.amountCents,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId,
      executionAllocationLineId: lineId
    });
    for (const [index, allocation] of funding.allocations.entries()) {
      await this.consequence(tx, input, {
        effectId: effectIds.get("project_fund")!,
        sequence: index + 1,
        type: "project_funding_allocation",
        identity: `project_fund:${allocation.sourceType}:${allocation.sourceId ?? "project_cash"}:${sliceIdentity}`,
        sliceIdentity,
        amountCents: allocation.amountCents,
        projectFundingAllocationId: allocation.id
      });
    }

    if (relationshipApplied) {
      const relationshipId = randomUUID();
      const debtor = await tx.companyEntity.findUnique({
        where: { id: payable.registered.debtorCompanyId }
      });
      if (!debtor) throw new ConflictException("应付债务主体不存在");
      await tx.interEntityRelationshipEntry.create({
        data: {
          id: relationshipId,
          entryKind: "proxy_payment",
          direction: "increase",
          status: "confirmed",
          paymentExecutionId: input.paymentExecutionId,
          settlementCaseId: lineInput.settlementCaseId,
          executionAllocationLineId: lineId,
          originalDebtorCompanyId: debtor.id,
          creditorCompanyId: observation.holderCompanyEntityId,
          approvedPayerCompanyId: debtor.id,
          debtorSnapshot: companySnapshot(debtor),
          creditorSnapshot: companySnapshot(projectContext.holderCompany),
          approvedPayerSnapshot: companySnapshot(debtor),
          amountCents: payable.amountCents,
          currencyCode: "CNY",
          evidenceFileId: observation.transactionEvidenceFileId,
          evidenceContentSha256:
            observation.transactionEvidenceContentSha256,
          actualPayerVerificationEvidenceFileId:
            observation.verificationEvidenceFileId,
          actualPayerVerificationContentSha256:
            observation.verificationEvidenceContentSha256,
          authorizationEvidenceFileId:
            lineInput.proxyAuthorization!.evidenceFileId,
          authorizationEvidenceContentSha256:
            lineInput.proxyAuthorization!.evidenceContentSha256,
          reauthorizationReference:
            lineInput.proxyAuthorization!.reauthorizationReference,
          reauthorizedByUserId:
            lineInput.proxyAuthorization!.reauthorizedByUserId,
          reauthorizedAt: lineInput.proxyAuthorization!.reauthorizedAt,
          projectId: input.projectId,
          sourceType: payable.registered.sourceType,
          sourceAggregateId: payable.registered.sourceAggregateId,
          sourceAllocationCount: 1,
          sourceAllocationAmountCents: payable.amountCents,
          reason: "付款执行银行流水认领产生的正式代付往来",
          idempotencyKey: `payment-execution:${lineId}:relationship`,
          payloadFingerprint: fundExecutionCommandFingerprint("confirm_case", {
            lineId,
            debtorCompanyId: debtor.id,
            holderCompanyEntityId: observation.holderCompanyEntityId,
            amountCents: payable.amountCents
          }),
          createdByUserId: input.actorUserId,
          confirmedByUserId: input.actorUserId,
          confirmedAt: new Date()
        }
      });
      await this.consequence(tx, input, {
        effectId: effectIds.get("relationship")!,
        sequence: 1,
        type: "inter_entity_relationship_entry",
        identity: `relationship:${debtor.id}:${observation.holderCompanyEntityId}:${sliceIdentity}`,
        sliceIdentity,
        amountCents: payable.amountCents,
        interEntityRelationshipEntryId: relationshipId
      });
    }

    const operating = await this.materializeOperating(tx, input, {
      lineId,
      sliceIdentity,
      payable,
      observation,
      projectContext
    });
    await this.consequence(tx, input, {
      effectId: effectIds.get("operating")!,
      sequence: 1,
      type: "operating_fact_impact",
      identity: `operating:${input.projectId}:${sliceIdentity}`,
      sliceIdentity,
      amountCents: payable.amountCents,
      ...operating
    });
  }

  private async materializeOperating(
    tx: Transaction,
    input: ClaimedPaymentExecutionInput,
    context: Readonly<{
      lineId: string;
      sliceIdentity: string;
      payable: PayableContext;
      observation: Awaited<
        ReturnType<FundExecutionSelectionOptionsService["matchObservationInTransaction"]>
      >["observation"];
      projectContext: Awaited<
        ReturnType<PaymentExecutionSharedAllocationService["projectContext"]>
      >;
    }>
  ) {
    const effectiveDate = await readOperatingLedgerEffectiveDate(
      tx,
      input.projectId
    );
    const participant = {
      kind: "participating_company",
      id: context.observation.holderCompanyEntityId
    } as const satisfies OperatingSubjectReference;
    const payee = operatingPayee(context.payable.registered);
    const operatingInput: AppendOperatingFactInput = {
      projectId: input.projectId,
      sourceType: "payment_execution",
      sourceBusinessId: context.lineId,
      sourceBusinessCode: `付款执行-${input.paymentExecutionId}`,
      sourceVersion: 1,
      idempotencyKey: `payment-execution:${context.lineId}:operating-fact`,
      occurredAt: input.occurredAt,
      confirmedAt: new Date(),
      confirmedByUserId: input.actorUserId,
      factKind: "fund_movement",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: context.payable.amountCents,
      currencyCode: "CNY",
      direction: "outflow",
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
        input.occurredAt,
        effectiveDate
      ),
      affiliateAssignmentId: context.projectContext.affiliate.assignmentId,
      affiliateBusinessPartyVersionId:
        context.projectContext.affiliate.businessPartyVersionId,
      affiliateNameSnapshot: context.projectContext.affiliate.name,
      ...(context.projectContext.affiliate.creditCode
        ? {
            affiliateCreditCodeSnapshot:
              context.projectContext.affiliate.creditCode
          }
        : {}),
      sourceSnapshot: {
        paymentExecutionId: input.paymentExecutionId,
        allocationLineId: context.lineId,
        observationFingerprint: context.observation.payloadFingerprint
      },
      basisSnapshot: {
        payableRef: context.payable.registered.payableRef,
        sliceIdentity: context.sliceIdentity
      },
      subjects: { actualPayer: participant, payee },
      impacts: [
        {
          idempotencyKey: `payment-execution:${context.lineId}:operating-impact`,
          sourceImpactKey: context.lineId,
          impactKind: "company_project_funds_decrease",
          amountCents: context.payable.amountCents,
          direction: "decrease",
          subjectRole: "actual_payer",
          subject: participant,
          description: "付款执行银行流水认领产生的项目资金影响",
          impactSnapshot: {
            payableRef: context.payable.registered.payableRef,
            observationFingerprint: context.observation.payloadFingerprint
          },
          paymentExecutionId: input.paymentExecutionId,
          executionAllocationLineId: context.lineId
        }
      ],
      paymentExecutionId: input.paymentExecutionId
    };
    const result = await this.operatingLedger.appendConfirmedSourceInTransaction(
      tx,
      operatingInput,
      input.actorUserId
    );
    const impactId = result.impactIds[0];
    if (!impactId) throw new ConflictException("付款执行经营轴未生成正式影响");
    return {
      operatingFactId: result.id,
      operatingImpactEntryId: impactId
    };
  }

  private async consequence(
    tx: Transaction,
    input: ClaimedPaymentExecutionInput,
    data: Readonly<{
      effectId: string;
      sequence: number;
      type: string;
      identity: string;
      sliceIdentity: string;
      amountCents: bigint;
      payableSettlementAllocationId?: string;
      projectFundingAllocationId?: string;
      interEntityRelationshipEntryId?: string;
      operatingFactId?: string;
      operatingImpactEntryId?: string;
    }>
  ) {
    const binding = {
      payableSettlementAllocationId: data.payableSettlementAllocationId,
      projectFundingAllocationId: data.projectFundingAllocationId,
      interEntityRelationshipEntryId: data.interEntityRelationshipEntryId,
      operatingFactId: data.operatingFactId,
      operatingImpactEntryId: data.operatingImpactEntryId
    };
    await tx.executionAllocationConsequence.create({
      data: {
        id: randomUUID(),
        axisEffectId: data.effectId,
        sequence: data.sequence,
        consequenceType: data.type,
        consequenceIdentity: data.identity,
        sliceIdentity: data.sliceIdentity,
        amountCents: data.amountCents,
        consequenceFingerprint: fundExecutionCommandFingerprint(
          "confirm_case",
          { data, binding }
        ),
        ...binding,
        createdByUserId: input.actorUserId,
        auditRequestId: input.auditRequestId,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });
  }

  private async lockPayables(
    tx: Transaction,
    bindings: readonly ClaimedPaymentWageBinding[]
  ): Promise<readonly PayableContext[]> {
    const payableRefs = bindings.map(({ payableRef }) => payableRef).sort();
    if (new Set(payableRefs).size !== payableRefs.length) {
      throw new BadRequestException("同一工资应付不能重复关联");
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT ref."id" FROM "WagePayableRef" ref
      WHERE ref."id" IN (${Prisma.join(payableRefs)})
      ORDER BY ref."id"
      FOR UPDATE
    `);
    const rows = await tx.wagePayableRef.findMany({
      where: { id: { in: payableRefs } },
      include: {
        confirmedVersion: { select: { status: true } },
        creditorBreakdown: {
          select: {
            creditorSubjectType: true,
            creditorSubjectIdentityKey: true,
            creditorNameSnapshot: true
          }
        },
        adjustments: { select: { direction: true, amountCents: true } }
      }
    });
    if (rows.length !== payableRefs.length) {
      throw new ConflictException("工资应付引用不存在");
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return bindings.map((binding) => {
      const row = byId.get(binding.payableRef)!;
      const registered = payableSourceAdapterRegistry
        .require("wage_payable_ref")
        .toRegisteredPayable(row);
      const effectiveAmountCents = deriveEffectiveWagePayableAmount(
        row.amountCents,
        row.adjustments
      );
      return {
        registered,
        amountCents: binding.amountCents,
        sourceSnapshot: {
          payableRef: registered.payableRef,
          confirmedVersionId: registered.confirmedVersionId,
          confirmedAmountCents: registered.confirmedAmountCents.toString(),
          effectiveAmountCents: effectiveAmountCents.toString(),
          debtorCompanyId: registered.debtorCompanyId,
          payeeSubjectType: registered.payeeSubjectType,
          payeeSubjectId: registered.payeeSubjectId,
          beneficiaryProjectId: registered.beneficiaryProjectId
        }
      };
    });
  }

  private async projectContext(
    tx: Transaction,
    input: Readonly<{
      projectId: string;
      occurredAt: Date;
      holderCompanyEntityId: string;
    }>
  ) {
    const [affiliate, participant, holderCompany] = await Promise.all([
      readAffiliateSnapshot(tx, input),
      tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: input.projectId,
          companyEntityId: input.holderCompanyEntityId,
          effectiveFrom: { lte: input.occurredAt },
          OR: [{ endedAt: null }, { endedAt: { gt: input.occurredAt } }]
        }
      }),
      tx.companyEntity.findUnique({
        where: { id: input.holderCompanyEntityId }
      })
    ]);
    if (!participant || !holderCompany) {
      throw new ConflictException(
        "实际账户持有人在付款发生日不是项目有效参与公司"
      );
    }
    return { affiliate, participant, holderCompany };
  }

  private async authorizeContext(
    tx: Transaction,
    input: ClaimedPaymentExecutionInput
  ) {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
    if (!secret) throw new ForbiddenException("资金执行受控写入密钥未配置");
    await tx.$executeRaw(
      Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${input.actorUserId}, ${secret})`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_actor', ${input.actorUserId}, true)`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_request_id', ${input.auditRequestId}, true)`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_action', 'payment_execution_record', true)`
    );
  }

  private frozenProxyAuthorization(
    attestation: Readonly<Record<string, unknown>>,
    paymentRequestId: string
  ): FrozenProxyAuthorization {
    const reason = text(attestation.proxyAuthorizationReason);
    const evidenceFileId = text(attestation.proxyAuthorizationEvidenceFileId);
    const evidenceContentSha256 = text(
      attestation.proxyAuthorizationEvidenceSha256
    );
    const reauthorizationReference = text(attestation.reauthorizationReference);
    const approvalInstanceId = text(attestation.reauthorizationApprovalInstanceId);
    const approvalActionLogId = text(attestation.reauthorizationApprovalActionLogId);
    const boundPaymentRequestId = text(attestation.reauthorizationPaymentRequestId);
    const reauthorizedByUserId = text(attestation.reauthorizedByUserId);
    const reauthorizedAt = attestation.reauthorizedAt;
    if (
      !reason ||
      !evidenceFileId ||
      !/^[0-9a-f]{64}$/u.test(evidenceContentSha256) ||
      !reauthorizationReference ||
      !approvalInstanceId ||
      !approvalActionLogId ||
      boundPaymentRequestId !== paymentRequestId ||
      !reauthorizedByUserId ||
      !(reauthorizedAt instanceof Date) ||
      Number.isNaN(reauthorizedAt.getTime())
    ) {
      throw new ConflictException(
        "跨主体付款执行缺少服务端冻结的完整重新授权事实"
      );
    }
    return {
      reason,
      evidenceFileId,
      evidenceContentSha256,
      reauthorizationReference,
      approvalInstanceId,
      approvalActionLogId,
      reauthorizedByUserId,
      reauthorizedAt
    };
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function companySnapshot(company: {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
}) {
  if (!company.unifiedSocialCreditCode?.trim()) {
    throw new ConflictException("公司主体信用代码快照不完整");
  }
  return {
    companyEntityId: company.id,
    name: company.name,
    creditCode: company.unifiedSocialCreditCode.trim()
  };
}
