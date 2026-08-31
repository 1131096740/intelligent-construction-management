import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { PrismaService } from "../database/prisma.service";
import { readAffiliateSnapshot } from "../operating-ledger/formal-operating-source.helpers";
import {
  deriveEffectiveWagePayableAmount,
  payableSourceAdapterRegistry,
  type RegisteredPayable
} from "../payable-registry/wage-payable-source.adapter";
import {
  loadPayableSettlementAllocationTotals,
  payableSettlementAllocationTotalsFor
} from "../payable-registry/payable-settlement-balance-authority";
import {
  ProjectFundingAvailabilityService,
  type FundingAllocationPlan
} from "../project-funding/project-funding-availability.service";
import {
  assertCompleteFundExecutionSelectionSet,
  type FundExecutionAxisOptionSnapshot,
  type FundExecutionConsequencePlanItem,
  type FundExecutionIssuedAxisOption,
  type FundExecutionIssuedPlan,
  type FundExecutionResolvedAxisSelection
} from "./fund-execution-axis-plan";
import {
  EXECUTION_ALLOCATION_AXES,
  type ExecutionAllocationAxis,
  type ExecutionAllocationAxisStatus
} from "./fund-execution.domain";
import {
  FundExecutionSelectionRefService,
  fundExecutionSelectionExpiresAt,
  type AxisBusinessSelectionBinding,
  type BankObservationSelectionBinding,
  type ReversalTargetSelectionBinding
} from "./fund-execution-selection-ref.service";

type FundExecutionTransaction = Prisma.TransactionClient;

type ObservationCandidate = Readonly<{
  id: string;
  reference: string;
  payerVerificationId: string;
  payerVerificationReference: string;
  holderCompanyEntityId: string;
  holderNameSnapshot: string;
  holderCreditCodeSnapshot: string;
  verificationReference: string;
  verifiedByUserId: string;
  verifiedAt: Date;
  verificationEvidenceFileId: string;
  verificationEvidenceContentSha256: string;
  verificationSourceType: string;
  verificationSourceRecordId: string;
  verificationIssuedByDatabaseRole: string;
  transactionSourceType: string;
  transactionSourceId: string;
  transactionSourceIdentity: string;
  transactionEvidenceFileId: string;
  transactionEvidenceContentSha256: string;
  transactionExecutedByUserId: string;
  amountCents: bigint;
  currencyCode: string;
  direction: string;
  occurredAt: Date;
  payloadFingerprint: string;
}>;

export type MatchedObservationCandidate = Readonly<{
  observation: ObservationCandidate;
  binding: BankObservationSelectionBinding;
}>;

type AvailablePayable = Readonly<{
  registered: RegisteredPayable;
  sourceSnapshot: Record<string, unknown>;
  availableAmountCents: bigint;
  projectName: string;
  debtorName: string;
}>;

type PlanLineSeed = Readonly<{
  lineNo: number;
  amountCents: bigint;
  payable: AvailablePayable | null;
  projectId: string;
  projectName: string;
}>;

type ParticipantSnapshot = Readonly<{
  id: string;
  companyEntityId: string;
  companyEntityVersionId: string;
  companyNameSnapshot: string;
  companyCreditCodeSnapshot: string | null;
}>;

type InternalIssuedAxisOption = FundExecutionIssuedAxisOption &
  Readonly<{ binding: AxisBusinessSelectionBinding }>;

type InternalIssuedPlan = Omit<FundExecutionIssuedPlan, "selections"> &
  Readonly<{ selections: readonly InternalIssuedAxisOption[] }>;

type AxisDraft = Readonly<{
  axis: ExecutionAllocationAxis;
  status: ExecutionAllocationAxisStatus;
  axisIdentity: string;
  summary: string;
  optionSnapshot: FundExecutionAxisOptionSnapshot;
  consequencePlanSnapshot: readonly FundExecutionConsequencePlanItem[];
  originalAxisEffectId: string | null;
}>;

type FundingPiece = FundingAllocationPlan & Readonly<{ lineNo: number }>;

type ReversalTargetCandidate = Readonly<{
  targetType: "payment_execution" | "fund_execution";
  targetExecutionId: string;
  businessCode: string | null;
  direction: "inflow" | "outflow";
  amountCents: bigint;
  currencyCode: string;
  occurredAt: Date;
  payloadFingerprint: string;
}>;

@Injectable()
export class FundExecutionSelectionOptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly selectionRefs: FundExecutionSelectionRefService,
    private readonly projectFunding: ProjectFundingAvailabilityService
  ) {}

  async listObservationCandidates(
    actorUserId: string,
    now = new Date(),
    purpose: "fund_execution_case" | "payment_execution" =
      "fund_execution_case"
  ) {
    const observations = (
      await this.loadUnclaimedObservations(this.prisma)
    ).filter(
      (observation) =>
        purpose === "fund_execution_case" || observation.direction === "outflow"
    );
    return observations.map((observation) => ({
      selectionRef: this.selectionRefs.issueBankObservation(
        this.observationBinding(actorUserId, observation),
        now
      ),
      expiresAt: fundExecutionSelectionExpiresAt(now).toISOString(),
      summary: this.observationSummary(observation)
    }));
  }

  async listReversalTargets(actorUserId: string, now = new Date()) {
    const targets = await this.loadAvailableReversalTargets(this.prisma);
    return targets.map((target) => ({
      targetSelectionRef: this.selectionRefs.issueReversalTarget(
        this.reversalTargetBinding(actorUserId, target),
        now
      ),
      expiresAt: fundExecutionSelectionExpiresAt(now).toISOString(),
      summary: this.reversalTargetSummary(target)
    }));
  }

  async matchReversalTargetInTransaction(
    tx: FundExecutionTransaction,
    actorUserId: string,
    targetSelectionRef: string,
    now = new Date()
  ) {
    const targets = await this.loadAvailableReversalTargets(tx);
    const matches = targets.filter((target) =>
      this.selectionRefs.matchesReversalTarget(
        targetSelectionRef,
        this.reversalTargetBinding(actorUserId, target),
        now
      )
    );
    if (matches.length !== 1) {
      throw new ConflictException("可反向业务事项已变化，请刷新后重新选择");
    }
    return matches[0]!;
  }

  async matchObservationInTransaction(
    tx: FundExecutionTransaction,
    actorUserId: string,
    selectionRef: string,
    now = new Date()
  ): Promise<MatchedObservationCandidate> {
    const observations = await this.loadUnclaimedObservations(tx);
    const matches = observations.filter((observation) =>
      this.selectionRefs.matchesBankObservation(
        selectionRef,
        this.observationBinding(actorUserId, observation),
        now
      )
    );
    if (matches.length !== 1) {
      throw new ConflictException("银行流水候选已失效，请刷新后重新选择");
    }
    const selected = matches[0]!;
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT observation."id"
      FROM "VerifiedBankTransactionObservation" observation
      WHERE observation."id" = ${selected.id}
        AND NOT EXISTS (
          SELECT 1 FROM "BankTransactionClaim" claim
          WHERE claim."observationId" = observation."id"
        )
      FOR UPDATE
    `);
    if (locked.length !== 1) {
      throw new ConflictException("银行流水候选已被占用，请刷新后重试");
    }
    return {
      observation: selected,
      binding: this.observationBinding(actorUserId, selected)
    };
  }

  async assertObservationSelectionInTransaction(
    tx: FundExecutionTransaction,
    actorUserId: string,
    selectionRef: string,
    observationId: string,
    now = new Date()
  ) {
    const observation = await tx.verifiedBankTransactionObservation.findUnique({
      where: { id: observationId }
    });
    if (
      !observation ||
      !this.selectionRefs.matchesBankObservation(
        selectionRef,
        this.observationBinding(actorUserId, observation as ObservationCandidate),
        now
      )
    ) {
      throw new ConflictException("银行流水候选已失效，请刷新后重试");
    }
    return observation as ObservationCandidate;
  }

  async listCasePlans(caseKey: string, actorUserId: string, now = new Date()) {
    const plans = await this.prisma.$transaction((tx) =>
      this.buildPlansInTransaction(tx, caseKey, actorUserId, now)
    );
    return plans.map((plan) => ({
      summary: plan.summary,
      expiresAt: fundExecutionSelectionExpiresAt(now).toISOString(),
      lines: this.publicLines(plan)
    }));
  }

  async resolveCasePlanInTransaction(
    tx: FundExecutionTransaction,
    input: Readonly<{
      caseKey: string;
      actorUserId: string;
      expectedRevision: number;
      selectionRefs: readonly string[];
      now?: Date;
    }>
  ): Promise<readonly FundExecutionResolvedAxisSelection[]> {
    if (new Set(input.selectionRefs).size !== input.selectionRefs.length) {
      throw new BadRequestException("逐轴业务选项不能重复提交");
    }
    const now = input.now ?? new Date();
    const context = await this.loadCaseContext(tx, input.caseKey);
    if (
      context.caseRow.status !== "draft" ||
      context.caseRow.revision !== input.expectedRevision
    ) {
      throw new ConflictException("资金执行案件版本或状态已变化，请刷新后重试");
    }
    const plans = await this.buildPlansForContext(
      tx,
      context,
      input.actorUserId,
      now
    );
    const matchedPlans = plans
      .map((plan) => this.matchSubmittedRefs(plan, input.selectionRefs, now))
      .filter(
        (resolved): resolved is readonly FundExecutionResolvedAxisSelection[] =>
          resolved !== null
      );
    if (matchedPlans.length !== 1) {
      throw new ConflictException("逐轴业务选项已失效，请刷新后重新选择");
    }
    const selections = matchedPlans[0]!;
    assertCompleteFundExecutionSelectionSet(
      selections,
      context.execution.amountCents
    );
    return selections;
  }

  private async buildPlansInTransaction(
    tx: FundExecutionTransaction,
    caseKey: string,
    actorUserId: string,
    now: Date
  ) {
    const context = await this.loadCaseContext(tx, caseKey);
    if (context.caseRow.status !== "draft") {
      throw new ConflictException("当前资金执行案件不可修改分类");
    }
    return this.buildPlansForContext(tx, context, actorUserId, now);
  }

  private async buildPlansForContext(
    tx: FundExecutionTransaction,
    context: Awaited<ReturnType<FundExecutionSelectionOptionsService["loadCaseContext"]>>,
    actorUserId: string,
    now: Date
  ): Promise<readonly InternalIssuedPlan[]> {
    if (context.execution.executionKind === "reversal") {
      throw new BadRequestException("反向执行沿用原分类，不接受新的业务选择");
    }
    if (context.execution.direction === "inflow") {
      return this.buildInflowPlans(tx, context, actorUserId, now);
    }
    if (context.execution.direction !== "outflow") {
      throw new ConflictException("资金执行方向无效");
    }
    return this.buildOutflowPlans(tx, context, actorUserId, now);
  }

  private async buildOutflowPlans(
    tx: FundExecutionTransaction,
    context: Awaited<ReturnType<FundExecutionSelectionOptionsService["loadCaseContext"]>>,
    actorUserId: string,
    now: Date
  ) {
    const payables = await this.loadAvailablePayables(tx);
    const amount = context.execution.amountCents;
    const seeds: PlanLineSeed[][] = [];
    for (const payable of payables) {
      if (payable.availableAmountCents >= amount) {
        seeds.push([
          {
            lineNo: 1,
            amountCents: amount,
            payable,
            projectId: payable.registered.beneficiaryProjectId,
            projectName: payable.projectName
          }
        ]);
      }
      if (seeds.length >= 12) break;
    }
    const projectIds = [
      ...new Set(
        payables.map(({ registered }) => registered.beneficiaryProjectId)
      )
    ].sort();
    for (const projectId of projectIds) {
      let remaining = amount;
      const combined: PlanLineSeed[] = [];
      for (const payable of payables.filter(
        ({ registered }) => registered.beneficiaryProjectId === projectId
      )) {
        if (remaining === 0n || combined.length >= 20) break;
        const allocated =
          payable.availableAmountCents >= remaining
            ? remaining
            : payable.availableAmountCents;
        if (allocated <= 0n) continue;
        combined.push({
          lineNo: combined.length + 1,
          amountCents: allocated,
          payable,
          projectId,
          projectName: payable.projectName
        });
        remaining -= allocated;
      }
      if (remaining === 0n && combined.length > 1) seeds.push(combined);
    }

    const plans: InternalIssuedPlan[] = [];
    for (const [index, lines] of seeds.entries()) {
      try {
        plans.push(
          await this.materializeOutflowPlan(
            tx,
            context,
            actorUserId,
            now,
            lines,
            index + 1
          )
        );
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ConflictException
        ) {
          continue;
        }
        throw error;
      }
    }
    if (!plans.length) {
      throw new BadRequestException(
        "没有可完整覆盖该笔出账的正式应付与项目资金方案"
      );
    }
    return plans;
  }

  private async materializeOutflowPlan(
    tx: FundExecutionTransaction,
    context: Awaited<ReturnType<FundExecutionSelectionOptionsService["loadCaseContext"]>>,
    actorUserId: string,
    now: Date,
    lines: readonly PlanLineSeed[],
    planOrdinal: number
  ): Promise<InternalIssuedPlan> {
    const fundingPieces = await this.planFundingByLine(tx, lines);
    const drafts: AxisDraft[] = [];
    for (const line of lines) {
      const payable = line.payable!;
      const projectContext = await this.loadProjectContext(
        tx,
        line.projectId,
        context.execution.occurredAt,
        context.observation.holderCompanyEntityId,
        payable.registered.debtorCompanyId
      );
      const sliceIdentity = this.stableIdentity("outflow-slice", {
        fundExecutionId: context.execution.id,
        payableRef: payable.registered.payableRef,
        amountCents: line.amountCents.toString()
      });
      const lineSnapshot = {
        lineNo: line.lineNo,
        allocationLineId: this.deterministicUuid(
          "fund-execution-allocation-line",
          context.execution.id,
          sliceIdentity
        ),
        direction: "outflow",
        amountCents: line.amountCents.toString(),
        currencyCode: "CNY",
        businessType: payable.registered.sourceType,
        businessId: payable.registered.payableRef,
        sourceIdentity: payable.registered.payableRef,
        sliceIdentity,
        projectId: line.projectId
      } as const;
      const payableConsequence = this.consequence(
        1,
        "payable_settlement_allocation",
        `payable:${payable.registered.payableRef}:${sliceIdentity}`,
        sliceIdentity,
        line.amountCents
      );
      drafts.push(
        this.axisDraft(
          "payable",
          "applied",
          `payable:${payable.registered.payableRef}`,
          `核销已确认应付 · ${payable.debtorName} · ${line.projectName}`,
          lineSnapshot,
          {
            registered: this.jsonPayable(payable.registered),
            sourceSnapshot: payable.sourceSnapshot
          },
          [payableConsequence]
        )
      );

      const lineFunding = fundingPieces.filter(
        (piece) => piece.lineNo === line.lineNo
      );
      drafts.push(
        this.axisDraft(
          "project_fund",
          "applied",
          `project_fund:${line.projectId}:${this.stableIdentity("funding", lineFunding)}`,
          `占用 ${line.projectName} 的正式项目资金来源`,
          lineSnapshot,
          { projectId: line.projectId, allocations: lineFunding },
          lineFunding.map((piece, pieceIndex) =>
            this.consequence(
              pieceIndex + 1,
              "project_funding_allocation",
              `project_fund:${piece.sourceType}:${piece.sourceId ?? "project_cash"}:${sliceIdentity}`,
              sliceIdentity,
              piece.amountCents
            )
          )
        )
      );

      const relationshipApplied =
        payable.registered.debtorCompanyId !==
        context.observation.holderCompanyEntityId;
      drafts.push(
        this.axisDraft(
          "relationship",
          relationshipApplied ? "applied" : "not_applicable",
          relationshipApplied
            ? `relationship:${payable.registered.debtorCompanyId}:${context.observation.holderCompanyEntityId}`
            : `relationship:not_applicable:${payable.registered.debtorCompanyId}`,
          relationshipApplied
            ? "实际账户持有人与原债务主体不同，生成正式代付往来"
            : "实际账户持有人与原债务主体一致，无往来后果",
          lineSnapshot,
          {
            debtorCompany: projectContext.debtorCompany,
            holderCompany: projectContext.holderCompany,
            observationEvidence: this.observationEvidence(context.observation)
          },
          relationshipApplied
            ? [
                this.consequence(
                  1,
                  "inter_entity_relationship_entry",
                  `relationship:${payable.registered.debtorCompanyId}:${context.observation.holderCompanyEntityId}:${sliceIdentity}`,
                  sliceIdentity,
                  line.amountCents
                )
              ]
            : []
        )
      );

      drafts.push(
        this.axisDraft(
          "operating",
          "applied",
          `operating:${line.projectId}:${projectContext.affiliate.assignmentId}:${context.observation.holderCompanyEntityId}`,
          `登记 ${line.projectName} 的公司项目资金减少`,
          lineSnapshot,
          {
            affiliate: projectContext.affiliate,
            participant: projectContext.participant,
            payee: this.operatingPayee(payable.registered),
            impactKind: "company_project_funds_decrease",
            observationEvidence: this.observationEvidence(context.observation)
          },
          [
            this.consequence(
              1,
              "operating_fact_impact",
              `operating:${line.projectId}:${sliceIdentity}`,
              sliceIdentity,
              line.amountCents
            )
          ]
        )
      );
    }
    const selections = await this.issueDrafts(
      tx,
      drafts,
      context,
      actorUserId,
      now
    );
    return {
      planKey: this.stableIdentity("outflow-plan", {
        executionId: context.execution.id,
        lines: lines.map((line) => ({
          payableRef: line.payable!.registered.payableRef,
          amountCents: line.amountCents.toString()
        }))
      }),
      summary:
        lines.length === 1
          ? `方案 ${planOrdinal}：单笔应付完整分类`
          : `方案 ${planOrdinal}：${lines.length} 笔应付组合完整分类`,
      selections
    };
  }

  private async buildInflowPlans(
    tx: FundExecutionTransaction,
    context: Awaited<ReturnType<FundExecutionSelectionOptionsService["loadCaseContext"]>>,
    actorUserId: string,
    now: Date
  ): Promise<readonly InternalIssuedPlan[]> {
    const participantRows = await tx.projectParticipatingCompany.findMany({
      where: {
        companyEntityId: context.observation.holderCompanyEntityId,
        effectiveFrom: { lte: context.execution.occurredAt },
        OR: [
          { endedAt: null },
          { endedAt: { gt: context.execution.occurredAt } }
        ]
      },
      select: {
        id: true,
        projectId: true,
        companyEntityId: true,
        companyEntityVersionId: true,
        companyNameSnapshot: true,
        companyCreditCodeSnapshot: true
      },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
      take: 20
    });
    const projects = await tx.project.findMany({
      where: {
        id: { in: participantRows.map(({ projectId }) => projectId) },
        isActive: true,
        operatingLedgerEffectiveDate: { not: null }
      },
      select: { id: true, name: true }
    });
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
    const participants = participantRows.flatMap((participant) => {
      const projectName = projectNameById.get(participant.projectId);
      return projectName ? [{ ...participant, projectName }] : [];
    });
    const plans: InternalIssuedPlan[] = [];
    for (const participant of participants) {
      const projectContext = await this.loadProjectContext(
        tx,
        participant.projectId,
        context.execution.occurredAt,
        context.observation.holderCompanyEntityId,
        context.observation.holderCompanyEntityId
      );
      const sliceIdentity = this.stableIdentity("inflow-slice", {
        fundExecutionId: context.execution.id,
        projectId: participant.projectId
      });
      const line = {
        lineNo: 1,
        allocationLineId: this.deterministicUuid(
          "fund-execution-allocation-line",
          context.execution.id,
          sliceIdentity
        ),
        direction: "inflow",
        amountCents: context.execution.amountCents.toString(),
        currencyCode: "CNY",
        businessType: "project_fund_receipt",
        businessId: participant.projectId,
        sourceIdentity: `project_fund_receipt:${participant.projectId}`,
        sliceIdentity,
        projectId: participant.projectId
      } as const;
      const drafts: AxisDraft[] = [
        this.axisDraft(
          "payable",
          "not_applicable",
          `payable:not_applicable:${participant.projectId}`,
          "入账不核销应付",
          line,
          {},
          []
        ),
        this.axisDraft(
          "project_fund",
          "not_applicable",
          `project_fund:not_applicable:${participant.projectId}`,
          "入账不占用项目资金来源",
          line,
          {},
          []
        ),
        this.axisDraft(
          "relationship",
          "not_applicable",
          `relationship:not_applicable:${participant.projectId}`,
          "本次入账不生成代付往来",
          line,
          {},
          []
        ),
        this.axisDraft(
          "operating",
          "applied",
          `operating:${participant.projectId}:${projectContext.affiliate.assignmentId}:${participant.companyEntityId}`,
          `登记 ${participant.projectName} 的公司项目资金增加`,
          line,
          {
            affiliate: projectContext.affiliate,
            participant: projectContext.participant,
            impactKind: "company_project_funds_increase",
            observationEvidence: this.observationEvidence(context.observation)
          },
          [
            this.consequence(
              1,
              "operating_fact_impact",
              `operating:${participant.projectId}:${sliceIdentity}`,
              sliceIdentity,
              context.execution.amountCents
            )
          ]
        )
      ];
      plans.push({
        planKey: this.stableIdentity("inflow-plan", {
          executionId: context.execution.id,
          projectId: participant.projectId
        }),
        summary: `归入 ${participant.projectName} 的项目资金`,
        selections: await this.issueDrafts(
          tx,
          drafts,
          context,
          actorUserId,
          now
        )
      });
    }
    if (!plans.length) {
      throw new BadRequestException(
        "实际账户持有人在业务发生日没有可用的项目及施工企业归属"
      );
    }
    return plans;
  }

  private async issueDrafts(
    tx: FundExecutionTransaction,
    drafts: readonly AxisDraft[],
    context: Awaited<ReturnType<FundExecutionSelectionOptionsService["loadCaseContext"]>>,
    actorUserId: string,
    now: Date
  ): Promise<readonly InternalIssuedAxisOption[]> {
    const optionFingerprints = await this.pgJsonFingerprints(
      tx,
      drafts.map(({ optionSnapshot }) => optionSnapshot)
    );
    const planFingerprints = await this.pgJsonFingerprints(
      tx,
      drafts.map(({ consequencePlanSnapshot }) => consequencePlanSnapshot)
    );
    return drafts.map((draft, index) => {
      const appliedAmount =
        draft.status === "applied"
          ? BigInt(draft.optionSnapshot.line.amountCents)
          : 0n;
      const binding = {
        actorUserId,
        caseId: context.caseRow.caseKey,
        caseRevision: context.caseRow.revision,
        executionId: context.execution.id,
        allocationLineId: draft.optionSnapshot.line.allocationLineId,
        axis: draft.axis,
        optionFingerprint: optionFingerprints[index]!,
        amountCents: appliedAmount
      } satisfies AxisBusinessSelectionBinding;
      return {
        selectionRef: this.selectionRefs.issueAxisBusinessOption(binding, now),
        summary: draft.summary,
        lineNo: draft.optionSnapshot.line.lineNo,
        axis: draft.axis,
        status: draft.status,
        amountCents: appliedAmount,
        axisIdentity: draft.axisIdentity,
        optionSnapshot: draft.optionSnapshot,
        optionFingerprint: optionFingerprints[index]!,
        consequencePlanSnapshot: draft.consequencePlanSnapshot,
        consequencePlanFingerprint: planFingerprints[index]!,
        originalAxisEffectId: draft.originalAxisEffectId,
        binding
      };
    });
  }

  private matchSubmittedRefs(
    plan: InternalIssuedPlan,
    submittedRefs: readonly string[],
    now: Date
  ): readonly FundExecutionResolvedAxisSelection[] | null {
    if (plan.selections.length !== submittedRefs.length) return null;
    const unused = new Set(submittedRefs);
    const resolved: FundExecutionResolvedAxisSelection[] = [];
    for (const option of plan.selections) {
      const matched = [...unused].filter((selectionRef) =>
        this.selectionRefs.matchesAxisBusinessOption(
          selectionRef,
          option.binding,
          now
        )
      );
      if (matched.length !== 1) return null;
      const selectionRef = matched[0]!;
      unused.delete(selectionRef);
      resolved.push({
        selectionRef,
        lineNo: option.lineNo,
        axis: option.axis,
        status: option.status,
        amountCents: option.amountCents,
        axisIdentity: option.axisIdentity,
        optionSnapshot: option.optionSnapshot,
        optionFingerprint: option.optionFingerprint,
        consequencePlanSnapshot: option.consequencePlanSnapshot,
        consequencePlanFingerprint: option.consequencePlanFingerprint,
        originalAxisEffectId: option.originalAxisEffectId
      });
    }
    return unused.size === 0 ? resolved : null;
  }

  private async loadCaseContext(tx: FundExecutionTransaction, caseKey: string) {
    const caseRow = await tx.fundExecutionCase.findFirst({
      where: { caseKey },
      orderBy: { revision: "desc" }
    });
    if (!caseRow) throw new NotFoundException("资金执行案件不存在");
    const [execution, claim] = await Promise.all([
      tx.fundExecution.findUnique({ where: { id: caseRow.fundExecutionId } }),
      tx.bankTransactionClaim.findUnique({
        where: { fundExecutionId: caseRow.fundExecutionId }
      })
    ]);
    if (!execution || !claim) {
      throw new ConflictException("资金执行案件缺少不可变执行事实或银行流水占用");
    }
    const observation = await tx.verifiedBankTransactionObservation.findUnique({
      where: { id: claim.observationId }
    });
    if (!observation) {
      throw new ConflictException("资金执行案件缺少冻结银行流水观察");
    }
    return { caseRow, execution, claim, observation };
  }

  private async loadAvailablePayables(
    tx: FundExecutionTransaction
  ): Promise<readonly AvailablePayable[]> {
    const rows = await tx.wagePayableRef.findMany({
      where: {
        direction: "increase",
        adjustsPayableRefId: null,
        confirmedVersion: { status: "confirmed" }
      },
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
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200
    });
    if (!rows.length) return [];
    const payableRefs = rows.map(({ id }) => id);
    const allocationTotals = await loadPayableSettlementAllocationTotals(
      tx,
      payableRefs
    );
    const projectIds = [...new Set(rows.map(({ projectId }) => projectId))];
    const companyIds = [...new Set(rows.map(({ debtorCompanyId }) => debtorCompanyId))];
    const [projects, companies] = await Promise.all([
      tx.project.findMany({
        where: { id: { in: projectIds }, isActive: true },
        select: { id: true, name: true }
      }),
      tx.companyEntity.findMany({
        where: { id: { in: companyIds }, isActive: true },
        select: { id: true, name: true }
      })
    ]);
    const projectById = new Map(projects.map((row) => [row.id, row.name]));
    const companyById = new Map(companies.map((row) => [row.id, row.name]));
    return rows.flatMap((row) => {
      const registered = payableSourceAdapterRegistry
        .require("wage_payable_ref")
        .toRegisteredPayable(row);
      const effective = deriveEffectiveWagePayableAmount(
        row.amountCents,
        row.adjustments
      );
      const available = effective - payableSettlementAllocationTotalsFor(
        allocationTotals,
        row.id
      ).activeAmountCents;
      const projectName = projectById.get(row.projectId);
      const debtorName = companyById.get(row.debtorCompanyId);
      if (available <= 0n || !projectName || !debtorName) return [];
      return [
        {
          registered,
          availableAmountCents: available,
          projectName,
          debtorName,
          sourceSnapshot: {
            payableRef: registered.payableRef,
            confirmedVersionId: registered.confirmedVersionId,
            confirmedAmountCents: registered.confirmedAmountCents.toString(),
            effectiveAmountCents: effective.toString(),
            debtorCompanyId: registered.debtorCompanyId,
            payeeSubjectType: registered.payeeSubjectType,
            payeeSubjectId: registered.payeeSubjectId,
            beneficiaryProjectId: registered.beneficiaryProjectId
          }
        }
      ];
    });
  }

  private async planFundingByLine(
    tx: FundExecutionTransaction,
    lines: readonly PlanLineSeed[]
  ): Promise<readonly FundingPiece[]> {
    const pieces: FundingPiece[] = [];
    const projectIds = [...new Set(lines.map(({ projectId }) => projectId))].sort();
    for (const projectId of projectIds) {
      const projectLines = lines
        .filter((line) => line.projectId === projectId)
        .sort((left, right) => left.lineNo - right.lineNo);
      const total = projectLines.reduce(
        (sum, line) => sum + line.amountCents,
        0n
      );
      const funding = await this.projectFunding.previewExecutionAllocation(tx, {
        projectId,
        amountCents: total
      });
      let fundingIndex = 0;
      let fundingRemaining = funding[0]?.amountCents ?? 0n;
      for (const line of projectLines) {
        let lineRemaining = line.amountCents;
        while (lineRemaining > 0n) {
          const source = funding[fundingIndex];
          if (!source || fundingRemaining <= 0n) {
            throw new ConflictException("项目资金来源规划不完整");
          }
          const amount =
            fundingRemaining >= lineRemaining ? lineRemaining : fundingRemaining;
          pieces.push({ ...source, amountCents: amount, lineNo: line.lineNo });
          lineRemaining -= amount;
          fundingRemaining -= amount;
          if (fundingRemaining === 0n) {
            fundingIndex += 1;
            fundingRemaining = funding[fundingIndex]?.amountCents ?? 0n;
          }
        }
      }
    }
    return pieces;
  }

  private async loadProjectContext(
    tx: FundExecutionTransaction,
    projectId: string,
    occurredAt: Date,
    holderCompanyEntityId: string,
    debtorCompanyEntityId: string
  ) {
    const [affiliate, participant, holderCompany, debtorCompany] = await Promise.all([
      readAffiliateSnapshot(tx, { projectId, occurredAt }),
      tx.projectParticipatingCompany.findFirst({
        where: {
          projectId,
          companyEntityId: holderCompanyEntityId,
          effectiveFrom: { lte: occurredAt },
          OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
        },
        select: {
          id: true,
          companyEntityId: true,
          companyEntityVersionId: true,
          companyNameSnapshot: true,
          companyCreditCodeSnapshot: true
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }]
      }),
      tx.companyEntity.findUnique({
        where: { id: holderCompanyEntityId },
        select: { id: true, name: true, unifiedSocialCreditCode: true }
      }),
      tx.companyEntity.findUnique({
        where: { id: debtorCompanyEntityId },
        select: { id: true, name: true, unifiedSocialCreditCode: true }
      })
    ]);
    if (!participant || !holderCompany || !debtorCompany) {
      throw new BadRequestException(
        "实际账户持有人在业务发生日不属于该项目的有效参与公司"
      );
    }
    return {
      affiliate,
      participant: participant satisfies ParticipantSnapshot,
      holderCompany: this.companySnapshot(holderCompany),
      debtorCompany: this.companySnapshot(debtorCompany)
    };
  }

  private async loadUnclaimedObservations(
    db: PrismaService | FundExecutionTransaction
  ): Promise<readonly ObservationCandidate[]> {
    const claims = await db.bankTransactionClaim.findMany({
      select: { observationId: true }
    });
    const observations = await db.verifiedBankTransactionObservation.findMany({
      where: { id: { notIn: claims.map(({ observationId }) => observationId) } },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: 100
    });
    return observations.filter(
      (observation) =>
        (observation.direction === "inflow" ||
          observation.direction === "outflow") &&
        observation.amountCents > 0n &&
        observation.currencyCode === "CNY"
    ) as ObservationCandidate[];
  }

  private observationBinding(
    actorUserId: string,
    observation: ObservationCandidate
  ): BankObservationSelectionBinding {
    return {
      actorUserId,
      observationId: observation.id,
      observationFingerprint: observation.payloadFingerprint,
      payerVerificationId: observation.payerVerificationId,
      payerVerificationFingerprint: this.stableIdentity(
        "payer-verification",
        {
          reference: observation.payerVerificationReference,
          holderCompanyEntityId: observation.holderCompanyEntityId,
          holderNameSnapshot: observation.holderNameSnapshot,
          holderCreditCodeSnapshot: observation.holderCreditCodeSnapshot,
          verificationReference: observation.verificationReference,
          verifiedByUserId: observation.verifiedByUserId,
          verifiedAt: observation.verifiedAt,
          evidenceHash: observation.verificationEvidenceContentSha256,
          sourceType: observation.verificationSourceType,
          sourceRecordId: observation.verificationSourceRecordId,
          issuedByDatabaseRole: observation.verificationIssuedByDatabaseRole
        }
      ),
      direction: observation.direction as "inflow" | "outflow",
      amountCents: observation.amountCents,
      currency: observation.currencyCode
    };
  }

  private axisDraft(
    axis: ExecutionAllocationAxis,
    status: ExecutionAllocationAxisStatus,
    axisIdentity: string,
    summary: string,
    line: FundExecutionAxisOptionSnapshot["line"],
    canonical: Record<string, unknown>,
    consequencePlanSnapshot: readonly FundExecutionConsequencePlanItem[]
  ): AxisDraft {
    return {
      axis,
      status,
      axisIdentity,
      summary,
      optionSnapshot: { version: 1, axis, status, axisIdentity, line, canonical },
      consequencePlanSnapshot,
      originalAxisEffectId: null
    };
  }

  private consequence(
    sequence: number,
    consequenceType: FundExecutionConsequencePlanItem["consequenceType"],
    consequenceIdentity: string,
    sliceIdentity: string,
    amountCents: bigint
  ): FundExecutionConsequencePlanItem {
    return {
      sequence,
      consequenceType,
      consequenceIdentity,
      sliceIdentity,
      amountCents: amountCents.toString(),
      originalConsequenceId: null
    };
  }

  private async pgJsonFingerprints(
    tx: FundExecutionTransaction,
    values: readonly unknown[]
  ) {
    if (!values.length) return [];
    const rows = await tx.$queryRaw<Array<{ ordinal: bigint; fingerprint: string }>>(
      Prisma.sql`
        SELECT item.ordinality::BIGINT AS ordinal,
               encode(public.digest(item.value::TEXT, 'sha256'), 'hex') AS fingerprint
        FROM jsonb_array_elements(CAST(${JSON.stringify(values)} AS JSONB))
          WITH ORDINALITY AS item(value, ordinality)
        ORDER BY item.ordinality
      `
    );
    if (rows.length !== values.length) {
      throw new ConflictException("业务选项指纹冻结失败");
    }
    return rows.map(({ fingerprint }) => fingerprint);
  }

  private async loadAvailableReversalTargets(
    tx: FundExecutionTransaction | PrismaService
  ): Promise<readonly ReversalTargetCandidate[]> {
    return tx.$queryRaw<ReversalTargetCandidate[]>(Prisma.sql`
      SELECT 'payment_execution'::TEXT AS "targetType",
             payment."id" AS "targetExecutionId",
             request."code" AS "businessCode",
             'outflow'::TEXT AS "direction",
             (payment."amountCents" - COALESCE(reversed."amountCents", 0))::BIGINT
               AS "amountCents",
             'CNY'::TEXT AS "currencyCode",
             payment."paidAt" AS "occurredAt",
             payment."idempotencyKey" AS "payloadFingerprint"
      FROM "PaymentExecution" payment
      INNER JOIN "PaymentRequest" request
        ON request."id" = payment."paymentRequestId"
      INNER JOIN "BankTransactionClaim" claim
        ON claim."paymentExecutionId" = payment."id"
       AND claim."targetType" = 'payment_execution'
      LEFT JOIN LATERAL (
        SELECT SUM(reverse_execution."amountCents")::BIGINT AS "amountCents"
        FROM "FundExecution" reverse_execution
        WHERE reverse_execution."reversesPaymentExecutionId" = payment."id"
      ) reversed ON TRUE
      WHERE payment."amountCents" > COALESCE(reversed."amountCents", 0)
      UNION ALL
      SELECT 'fund_execution'::TEXT AS "targetType",
             execution."id" AS "targetExecutionId",
             NULL::TEXT AS "businessCode", execution."direction",
             (execution."amountCents" - COALESCE(reversed."amountCents", 0))::BIGINT
               AS "amountCents",
             execution."currencyCode",
             execution."occurredAt", execution."payloadFingerprint"
      FROM "FundExecution" execution
      LEFT JOIN LATERAL (
        SELECT SUM(reverse_execution."amountCents")::BIGINT AS "amountCents"
        FROM "FundExecution" reverse_execution
        WHERE reverse_execution."reversesFundExecutionId" = execution."id"
      ) reversed ON TRUE
      WHERE execution."executionKind" = 'bank_transaction'
        AND EXISTS (
          SELECT 1 FROM "FundExecutionCase" case_row
           WHERE case_row."fundExecutionId" = execution."id"
             AND case_row."status" = 'confirmed'
        )
        AND execution."amountCents" > COALESCE(reversed."amountCents", 0)
      ORDER BY "occurredAt" DESC, "targetExecutionId"
      LIMIT 100
    `);
  }

  private reversalTargetBinding(
    actorUserId: string,
    target: ReversalTargetCandidate
  ): ReversalTargetSelectionBinding {
    return {
      actorUserId,
      targetType: target.targetType,
      targetExecutionId: target.targetExecutionId,
      targetFingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            targetType: target.targetType,
            targetExecutionId: target.targetExecutionId,
            direction: target.direction,
            amountCents: target.amountCents.toString(),
            currencyCode: target.currencyCode,
            occurredAt: target.occurredAt.toISOString(),
            payloadFingerprint: target.payloadFingerprint
          })
        )
        .digest("hex")
    };
  }

  private reversalTargetSummary(target: ReversalTargetCandidate) {
    const source =
      target.targetType === "payment_execution"
        ? `付款 ${target.businessCode ?? "已确认实付"}`
        : "已确认资金执行";
    const direction = target.direction === "inflow" ? "入账" : "出账";
    return `${source} · ${direction} · ${target.currencyCode} ${moneySummary(target.amountCents)} · ${target.occurredAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
  }

  private publicLines(plan: InternalIssuedPlan) {
    const byLine = new Map<number, InternalIssuedAxisOption[]>();
    for (const selection of plan.selections) {
      const group = byLine.get(selection.lineNo) ?? [];
      group.push(selection);
      byLine.set(selection.lineNo, group);
    }
    return [...byLine]
      .sort(([left], [right]) => left - right)
      .map(([lineNo, selections]) => ({
        lineNo,
        amountCents: selections.find(({ status }) => status === "applied")!
          .amountCents.toString(),
        summary: `第 ${lineNo} 条正式资金分类`,
        axes: EXECUTION_ALLOCATION_AXES.map((axis) => {
          const option = selections.find((selection) => selection.axis === axis)!;
          return {
            axis,
            status: option.status,
            selectionRef: option.selectionRef,
            summary: option.summary
          };
        })
      }));
  }

  private observationSummary(observation: ObservationCandidate) {
    const direction = observation.direction === "inflow" ? "入账" : "出账";
    return `${direction} · ${observation.holderNameSnapshot} · CNY ${moneySummary(observation.amountCents)} · ${observation.occurredAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
  }

  private observationEvidence(observation: ObservationCandidate) {
    return {
      transactionEvidenceFileId: observation.transactionEvidenceFileId,
      transactionEvidenceContentSha256:
        observation.transactionEvidenceContentSha256,
      verificationEvidenceFileId: observation.verificationEvidenceFileId,
      verificationEvidenceContentSha256:
        observation.verificationEvidenceContentSha256,
      verificationReference: observation.verificationReference
    };
  }

  private operatingPayee(registered: RegisteredPayable) {
    const prefix = `${registered.payeeSubjectType}:`;
    const id = registered.payeeSubjectId.startsWith(prefix)
      ? registered.payeeSubjectId.slice(prefix.length)
      : registered.payeeSubjectId;
    return {
      kind:
        registered.payeeSubjectType === "employee_user"
          ? "employee"
          : "downstream_counterparty",
      id
    };
  }

  private jsonPayable(registered: RegisteredPayable) {
    return {
      ...registered,
      confirmedAmountCents: registered.confirmedAmountCents.toString()
    };
  }

  private companySnapshot(company: {
    id: string;
    name: string;
    unifiedSocialCreditCode: string | null;
  }) {
    return {
      companyEntityId: company.id,
      name: company.name,
      creditCode: company.unifiedSocialCreditCode
    };
  }

  private stableIdentity(namespace: string, value: unknown) {
    return createHash("sha256")
      .update(`${namespace}:${this.canonicalJson(value)}`)
      .digest("hex");
  }

  private deterministicUuid(namespace: string, ...parts: string[]) {
    const hex = createHash("sha256")
      .update([namespace, ...parts].join(":"))
      .digest("hex")
      .slice(0, 32)
      .split("");
    hex[12] = "5";
    hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    const value = hex.join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  private canonicalJson(value: unknown): string {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, nested]) =>
            `${JSON.stringify(key)}:${this.canonicalJson(nested)}`
        )
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }
}

function moneySummary(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
