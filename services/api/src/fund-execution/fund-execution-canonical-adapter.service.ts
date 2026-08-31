import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  occurredBeforeEffectiveDate,
  readOperatingLedgerEffectiveDate
} from "../operating-ledger/formal-operating-source.helpers";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingFactSubjects,
  type OperatingImpactInput,
  type OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import {
  ProjectFundingAvailabilityService,
  type FundingAllocationFact
} from "../project-funding/project-funding-availability.service";
import type {
  FundExecutionAxisOptionSnapshot,
  FundExecutionConsequencePlanItem
} from "./fund-execution-axis-plan";
import { fundExecutionCommandFingerprint } from "./fund-execution-command-receipt";
import {
  EXECUTION_ALLOCATION_AXES,
  type ExecutionAllocationAxis
} from "./fund-execution.domain";

type Transaction = Prisma.TransactionClient;

type ConfirmationInput = Readonly<{
  actorUserId: string;
  fundExecutionId: string;
  fundExecutionCaseId: string;
  auditRequestId: string;
}>;

type SelectionRow = Readonly<{
  allocationLineNo: number;
  axis: string;
  status: string;
  amountCents: bigint;
  axisIdentity: string;
  optionSnapshot: Prisma.JsonValue;
  consequencePlanSnapshot: Prisma.JsonValue;
  originalAxisEffectId: string | null;
}>;

type CanonicalBinding = Readonly<{
  payableSettlementAllocationId?: string;
  projectFundingAllocationId?: string;
  interEntityRelationshipEntryId?: string;
  operatingFactId?: string;
  operatingImpactEntryId?: string;
}>;

type OriginalLineContext = Readonly<{
  input: ConfirmationInput;
  caseRevision: number;
  caseReason: string;
  execution: NonNullable<
    Awaited<ReturnType<Transaction["fundExecution"]["findUnique"]>>
  >;
  observation: NonNullable<
    Awaited<
      ReturnType<Transaction["verifiedBankTransactionObservation"]["findUnique"]>
    >
  >;
  lineNo: number;
  selections: readonly SelectionRow[];
}>;

type ParsedSelection = Readonly<{
  selection: SelectionRow;
  option: FundExecutionAxisOptionSnapshot;
  consequences: readonly FundExecutionConsequencePlanItem[];
}>;

type ReversalLineContext = Readonly<{
  input: ConfirmationInput;
  caseRevision: number;
  caseReason: string;
  execution: OriginalLineContext["execution"];
  lineNo: number;
  selections: readonly SelectionRow[];
}>;

type StoredConsequence = Readonly<{
  id: string;
  axisEffectId: string;
  sequence: number;
  consequenceType: string;
  consequenceIdentity: string;
  sliceIdentity: string | null;
  amountCents: bigint;
  payableSettlementAllocationId: string | null;
  projectFundingAllocationId: string | null;
  interEntityRelationshipEntryId: string | null;
  operatingFactId: string | null;
  operatingImpactEntryId: string | null;
}>;

@Injectable()
export class FundExecutionCanonicalAdapterService {
  constructor(
    private readonly projectFunding: ProjectFundingAvailabilityService,
    private readonly operatingLedger: OperatingLedgerService
  ) {}

  async materializeConfirmation(
    tx: Transaction,
    input: ConfirmationInput
  ): Promise<{ allocationLineCount: number }> {
    const [caseRow, execution, claim] = await Promise.all([
      tx.fundExecutionCase.findUnique({
        where: { id: input.fundExecutionCaseId }
      }),
      tx.fundExecution.findUnique({ where: { id: input.fundExecutionId } }),
      tx.bankTransactionClaim.findUnique({
        where: { fundExecutionId: input.fundExecutionId }
      })
    ]);
    if (
      !caseRow ||
      !execution ||
      !claim ||
      caseRow.status !== "confirmed" ||
      caseRow.fundExecutionId !== execution.id ||
      caseRow.commandActorUserId !== input.actorUserId
    ) {
      throw new ConflictException("资金执行确认事实不完整");
    }
    const observation =
      await tx.verifiedBankTransactionObservation.findUnique({
        where: { id: claim.observationId }
      });
    if (!observation) throw new ConflictException("银行流水冻结事实不存在");
    if (execution.executionKind === "reversal") {
      return this.materializeReversal(tx, input);
    }
    const selections = await tx.fundExecutionCaseAxisSelection.findMany({
      where: { fundExecutionCaseId: caseRow.id },
      orderBy: [{ allocationLineNo: "asc" }, { axis: "asc" }]
    });
    const groups = this.selectionGroups(selections);
    for (const [lineNo, lineSelections] of groups) {
      await this.materializeOriginalLine(tx, {
        input,
        caseRevision: caseRow.revision,
        caseReason: caseRow.reason,
        execution,
        observation,
        lineNo,
        selections: lineSelections
      });
    }
    return { allocationLineCount: groups.length };
  }

  private async materializeOriginalLine(
    tx: Transaction,
    context: OriginalLineContext
  ) {
    const optionByAxis = new Map<ExecutionAllocationAxis, ParsedSelection>(
      context.selections.map((selection) => [
        selection.axis as ExecutionAllocationAxis,
        {
          selection,
          option: this.optionSnapshot(selection.optionSnapshot),
          consequences: this.consequencePlan(
            selection.consequencePlanSnapshot
          )
        }
      ])
    );
    const line = optionByAxis.get("operating")!.option.line;
    if (
      line.lineNo !== context.lineNo ||
      line.direction !== context.execution.direction ||
      BigInt(line.amountCents) <= 0n
    ) {
      throw new ConflictException("资金执行共享分配行冻结信息无效");
    }
    await tx.executionAllocationLine.create({
      data: {
        id: line.allocationLineId,
        executionType: "fund_execution",
        executionId: context.execution.id,
        fundExecutionId: context.execution.id,
        fundExecutionCaseId: context.input.fundExecutionCaseId,
        lineNo: line.lineNo,
        direction: line.direction,
        amountCents: BigInt(line.amountCents),
        currencyCode: line.currencyCode,
        businessType: line.businessType,
        businessId: line.businessId,
        sourceIdentity: line.sourceIdentity,
        sliceIdentity: line.sliceIdentity,
        payloadFingerprint: fundExecutionCommandFingerprint("confirm_case", {
          line,
          axes: context.selections.map((selection) => ({
            axis: selection.axis,
            identity: selection.axisIdentity
          }))
        }),
        createdByUserId: context.input.actorUserId,
        auditRequestId: context.input.auditRequestId,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });

    const effectIdByAxis = new Map<ExecutionAllocationAxis, string>();
    for (const axis of EXECUTION_ALLOCATION_AXES) {
      const selected = optionByAxis.get(axis);
      if (!selected) throw new ConflictException("共享分配行缺少完整四轴");
      const id = randomUUID();
      effectIdByAxis.set(axis, id);
      await tx.executionAllocationAxisEffect.create({
        data: {
          id,
          executionAllocationLineId: line.allocationLineId,
          axis,
          axisIdentity: selected.selection.axisIdentity,
          status: selected.selection.status,
          amountCents: selected.selection.amountCents,
          originalAxisEffectId: null,
          createdByUserId: context.input.actorUserId,
          auditRequestId: context.input.auditRequestId,
          createdTransactionId: 0n,
          createdBackendPid: 0
        }
      });
    }

    const payable = await this.materializePayable(
      tx,
      context,
      optionByAxis.get("payable")!,
      line.allocationLineId
    );
    await this.writeConsequences(
      tx,
      context.input,
      effectIdByAxis.get("payable")!,
      optionByAxis.get("payable")!.consequences,
      payable ? [payable] : []
    );

    const projectFunds = await this.materializeProjectFunds(
      tx,
      context,
      optionByAxis.get("project_fund")!,
      line.allocationLineId
    );
    await this.writeConsequences(
      tx,
      context.input,
      effectIdByAxis.get("project_fund")!,
      optionByAxis.get("project_fund")!.consequences,
      projectFunds.map(({ id }) => ({ projectFundingAllocationId: id }))
    );

    const relationship = await this.materializeRelationship(
      tx,
      context,
      optionByAxis.get("relationship")!,
      line.allocationLineId
    );
    await this.writeConsequences(
      tx,
      context.input,
      effectIdByAxis.get("relationship")!,
      optionByAxis.get("relationship")!.consequences,
      relationship ? [relationship] : []
    );

    const operating = await this.materializeOperating(
      tx,
      context,
      optionByAxis.get("operating")!,
      line.allocationLineId
    );
    await this.writeConsequences(
      tx,
      context.input,
      effectIdByAxis.get("operating")!,
      optionByAxis.get("operating")!.consequences,
      operating ? [operating] : []
    );
  }

  private async materializePayable(
    tx: Transaction,
    context: OriginalLineContext,
    selected: ParsedSelection,
    allocationLineId: string
  ): Promise<CanonicalBinding | null> {
    if (selected.selection.status === "not_applicable") return null;
    const canonical = selected.option.canonical;
    const registered = record(canonical.registered, "应付 canonical 快照无效");
    const id = randomUUID();
    await tx.payableSettlementAllocation.create({
      data: {
        id,
        fundExecutionId: context.execution.id,
        fundExecutionCaseId: context.input.fundExecutionCaseId,
        executionAllocationLineId: allocationLineId,
        payableRef: text(registered.payableRef, "应付引用无效"),
        sourceType: text(registered.sourceType, "应付来源无效"),
        sourceAggregateId: text(
          registered.sourceAggregateId,
          "应付聚合无效"
        ),
        sourceLineId: text(registered.sourceLineId, "应付来源行无效"),
        confirmedVersionId: text(
          registered.confirmedVersionId,
          "应付确认版本无效"
        ),
        debtorCompanyId: text(
          registered.debtorCompanyId,
          "应付债务主体无效"
        ),
        payeeSubjectType: text(
          registered.payeeSubjectType,
          "应付收款主体类型无效"
        ),
        payeeSubjectId: text(
          registered.payeeSubjectId,
          "应付收款主体无效"
        ),
        currencyCode: text(registered.currencyCode, "应付币种无效"),
        beneficiaryProjectId: text(
          registered.beneficiaryProjectId,
          "应付项目无效"
        ),
        sourceSnapshot: canonical.sourceSnapshot as Prisma.InputJsonValue,
        confirmedAmountCents: cents(
          registered.confirmedAmountCents,
          "应付确认金额无效"
        ),
        amountCents: selected.selection.amountCents,
        direction: "settle",
        createdByUserId: context.input.actorUserId
      }
    });
    return { payableSettlementAllocationId: id };
  }

  private async materializeProjectFunds(
    tx: Transaction,
    context: OriginalLineContext,
    selected: ParsedSelection,
    allocationLineId: string
  ): Promise<readonly FundingAllocationFact[]> {
    if (selected.selection.status === "not_applicable") return [];
    const allocations: FundingAllocationFact[] = array(
      selected.option.canonical.allocations,
      "项目资金 canonical 计划无效"
    ).map((value) => {
      const row = record(value, "项目资金 canonical 来源无效");
      const sourceType = text(row.sourceType, "项目资金来源类型无效");
      if (sourceType !== "project_cash" && sourceType !== "financing_quota") {
        throw new ConflictException("项目资金来源类型无效");
      }
      return {
        id: randomUUID(),
        sourceType,
        sourceId:
          row.sourceId === null
            ? null
            : text(row.sourceId, "项目资金来源无效"),
        amountCents: cents(row.amountCents, "项目资金分配金额无效")
      };
    });
    const result = await this.projectFunding.allocateExecution(tx, {
      projectId: selected.option.line.projectId,
      executionType: "fund_execution",
      executionId: context.execution.id,
      businessType: selected.option.line.businessType,
      businessId: selected.option.line.businessId,
      amountCents: selected.selection.amountCents,
      occurredAt: context.execution.occurredAt,
      actorUserId: context.input.actorUserId,
      executionAllocationLineId: allocationLineId,
      expectedAllocations: allocations
    });
    return result.allocations;
  }

  private async materializeRelationship(
    tx: Transaction,
    context: OriginalLineContext,
    selected: ParsedSelection,
    allocationLineId: string
  ): Promise<CanonicalBinding | null> {
    if (selected.selection.status === "not_applicable") return null;
    const canonical = selected.option.canonical;
    const debtor = record(canonical.debtorCompany, "往来债务主体快照无效");
    const holder = record(canonical.holderCompany, "往来账户持有人快照无效");
    const evidence = record(
      canonical.observationEvidence,
      "往来银行证据快照无效"
    );
    const payable = await tx.payableSettlementAllocation.findFirst({
      where: { executionAllocationLineId: allocationLineId }
    });
    if (!payable) throw new ConflictException("往来轴缺少同一行应付后果");
    const id = randomUUID();
    await tx.interEntityRelationshipEntry.create({
      data: {
        id,
        entryKind: "proxy_payment",
        direction: "increase",
        status: "confirmed",
        fundExecutionId: context.execution.id,
        fundExecutionCaseId: context.input.fundExecutionCaseId,
        executionAllocationLineId: allocationLineId,
        originalDebtorCompanyId: text(
          debtor.companyEntityId,
          "往来债务主体无效"
        ),
        creditorCompanyId: text(
          holder.companyEntityId,
          "往来账户持有人无效"
        ),
        approvedPayerCompanyId: text(
          debtor.companyEntityId,
          "批准付款主体无效"
        ),
        debtorSnapshot: debtor as Prisma.InputJsonValue,
        creditorSnapshot: holder as Prisma.InputJsonValue,
        approvedPayerSnapshot: debtor as Prisma.InputJsonValue,
        amountCents: selected.selection.amountCents,
        currencyCode: context.execution.currencyCode,
        evidenceFileId: text(
          evidence.transactionEvidenceFileId,
          "往来交易证据无效"
        ),
        evidenceContentSha256: text(
          evidence.transactionEvidenceContentSha256,
          "往来交易证据哈希无效"
        ),
        actualPayerVerificationEvidenceFileId: text(
          evidence.verificationEvidenceFileId,
          "账户持有人核验证据无效"
        ),
        actualPayerVerificationContentSha256: text(
          evidence.verificationEvidenceContentSha256,
          "账户持有人核验证据哈希无效"
        ),
        projectId: payable.beneficiaryProjectId,
        sourceType: payable.sourceType,
        sourceAggregateId: payable.sourceAggregateId,
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: payable.amountCents,
        reason: context.caseReason,
        idempotencyKey: `fund-execution:${allocationLineId}:relationship`,
        payloadFingerprint: fundExecutionCommandFingerprint("confirm_case", {
          allocationLineId,
          debtor,
          holder,
          evidence,
          amountCents: selected.selection.amountCents
        }),
        createdByUserId: context.input.actorUserId,
        confirmedByUserId: context.input.actorUserId,
        confirmedAt: new Date()
      }
    });
    return { interEntityRelationshipEntryId: id };
  }

  private async materializeOperating(
    tx: Transaction,
    context: OriginalLineContext,
    selected: ParsedSelection,
    allocationLineId: string
  ): Promise<CanonicalBinding | null> {
    if (selected.selection.status === "not_applicable") return null;
    const canonical = selected.option.canonical;
    const affiliate = record(canonical.affiliate, "施工企业归属快照无效");
    const participant = record(canonical.participant, "参与公司归属快照无效");
    const projectId = selected.option.line.projectId;
    const effectiveDate = await readOperatingLedgerEffectiveDate(tx, projectId);
    const participantSubject = {
      kind: "participating_company",
      id: text(participant.companyEntityId, "参与公司主体无效")
    } as const satisfies OperatingSubjectReference;
    const affiliateSubject = {
      kind: "construction_enterprise",
      id: text(
        affiliate.businessPartyVersionId,
        "施工企业主体版本无效"
      )
    } as const satisfies OperatingSubjectReference;
    const payee =
      canonical.payee === undefined
        ? participantSubject
        : operatingSubject(canonical.payee, "经营收款主体快照无效");
    const impactKind = text(canonical.impactKind, "经营影响类型无效") as
      OperatingImpactInput["impactKind"];
    const impact: OperatingImpactInput = {
      idempotencyKey: `fund-execution:${allocationLineId}:operating-impact`,
      sourceImpactKey: allocationLineId,
      impactKind,
      amountCents: selected.selection.amountCents,
      direction:
        context.execution.direction === "inflow" ? "increase" : "decrease",
      subjectRole:
        context.execution.direction === "inflow" ? "payee" : "actual_payer",
      subject: participantSubject,
      description: "资金执行正式分类产生的项目资金影响",
      impactSnapshot: {
        axisIdentity: selected.selection.axisIdentity,
        observationEvidence: canonical.observationEvidence
      } as Prisma.InputJsonObject,
      fundExecutionId: context.execution.id,
      fundExecutionCaseId: context.input.fundExecutionCaseId,
      executionAllocationLineId: allocationLineId
    };
    const operatingInput: AppendOperatingFactInput = {
      projectId,
      sourceType: "fund_execution",
      sourceBusinessId: allocationLineId,
      sourceBusinessCode: `资金执行-${context.input.fundExecutionId}`,
      sourceVersion: context.caseRevision,
      idempotencyKey: `fund-execution:${allocationLineId}:operating-fact`,
      occurredAt: context.execution.occurredAt,
      confirmedAt: new Date(),
      confirmedByUserId: context.input.actorUserId,
      factKind: "fund_movement",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: selected.selection.amountCents,
      currencyCode: context.execution.currencyCode,
      direction: context.execution.direction as "inflow" | "outflow",
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
        context.execution.occurredAt,
        effectiveDate
      ),
      affiliateAssignmentId: text(
        affiliate.assignmentId,
        "施工企业归属标识无效"
      ),
      affiliateBusinessPartyVersionId: text(
        affiliate.businessPartyVersionId,
        "施工企业版本无效"
      ),
      affiliateNameSnapshot: text(affiliate.name, "施工企业名称快照无效"),
      ...(affiliate.creditCode
        ? {
            affiliateCreditCodeSnapshot: text(
              affiliate.creditCode,
              "施工企业信用代码快照无效"
            )
          }
        : {}),
      sourceSnapshot: {
        fundExecutionId: context.execution.id,
        fundExecutionCaseId: context.input.fundExecutionCaseId,
        allocationLineId,
        observationEvidence: canonical.observationEvidence
      } as Prisma.InputJsonObject,
      basisSnapshot: {
        axisIdentity: selected.selection.axisIdentity,
        optionSnapshot: selected.option as unknown as Prisma.InputJsonValue
      } as Prisma.InputJsonObject,
      subjects:
        context.execution.direction === "inflow"
          ? { actualPayer: affiliateSubject, payee: participantSubject }
          : { actualPayer: participantSubject, payee },
      impacts: [impact],
      fundExecutionId: context.execution.id,
      fundExecutionCaseId: context.input.fundExecutionCaseId
    };
    const result = await this.operatingLedger.appendConfirmedSourceInTransaction(
      tx,
      operatingInput,
      context.input.actorUserId
    );
    const impactId = result.impactIds[0];
    if (!impactId) throw new ConflictException("经营轴未生成正式影响分录");
    return {
      operatingFactId: result.id,
      operatingImpactEntryId: impactId
    };
  }

  private async writeConsequences(
    tx: Transaction,
    input: ConfirmationInput,
    axisEffectId: string,
    plans: readonly FundExecutionConsequencePlanItem[],
    bindings: readonly CanonicalBinding[]
  ) {
    if (plans.length !== bindings.length) {
      throw new ConflictException("逐轴 canonical 后果数量不一致");
    }
    for (const [index, plan] of plans.entries()) {
      const binding = bindings[index]!;
      await tx.executionAllocationConsequence.create({
        data: {
          id: randomUUID(),
          axisEffectId,
          sequence: plan.sequence,
          consequenceType: plan.consequenceType,
          consequenceIdentity: plan.consequenceIdentity,
          sliceIdentity: plan.sliceIdentity,
          amountCents: BigInt(plan.amountCents),
          consequenceFingerprint: fundExecutionCommandFingerprint(
            "confirm_case",
            { plan, binding }
          ),
          ...binding,
          originalConsequenceId: plan.originalConsequenceId,
          createdByUserId: input.actorUserId,
          auditRequestId: input.auditRequestId,
          createdTransactionId: 0n,
          createdBackendPid: 0
        }
      });
    }
  }

  private selectionGroups(selections: readonly SelectionRow[]) {
    const grouped = new Map<number, SelectionRow[]>();
    for (const selection of selections) {
      const group = grouped.get(selection.allocationLineNo) ?? [];
      group.push(selection);
      grouped.set(selection.allocationLineNo, group);
    }
    const result = [...grouped].sort(([left], [right]) => left - right);
    if (
      !result.length ||
      result.some(
        ([, group]) =>
          group.length !== 4 ||
          EXECUTION_ALLOCATION_AXES.some(
            (axis) => !group.some((selection) => selection.axis === axis)
          )
      )
    ) {
      throw new ConflictException("资金执行确认分类未完整覆盖四轴");
    }
    return result;
  }

  private optionSnapshot(value: Prisma.JsonValue) {
    const option = record(value, "逐轴业务选项快照无效");
    const line = record(option.line, "共享分配行快照无效");
    const axis = text(option.axis, "逐轴业务选项类型无效");
    const status = text(option.status, "逐轴业务选项状态无效");
    if (
      option.version !== 1 ||
      !EXECUTION_ALLOCATION_AXES.includes(axis as ExecutionAllocationAxis) ||
      (status !== "applied" && status !== "not_applicable")
    ) {
      throw new ConflictException("逐轴业务选项快照版本无效");
    }
    return {
      version: 1,
      axis: axis as ExecutionAllocationAxis,
      status,
      axisIdentity: text(option.axisIdentity, "逐轴业务身份无效"),
      line: {
        lineNo: integer(line.lineNo, "共享分配行序号无效"),
        allocationLineId: text(line.allocationLineId, "共享分配行标识无效"),
        direction: text(line.direction, "共享分配行方向无效") as
          | "inflow"
          | "outflow",
        amountCents: text(line.amountCents, "共享分配行金额无效"),
        currencyCode: text(line.currencyCode, "共享分配行币种无效") as "CNY",
        businessType: text(line.businessType, "共享分配行业务类型无效"),
        businessId: text(line.businessId, "共享分配行业务标识无效"),
        sourceIdentity: text(line.sourceIdentity, "共享分配行来源身份无效"),
        sliceIdentity: text(line.sliceIdentity, "共享分配行切片身份无效"),
        projectId: text(line.projectId, "共享分配行项目无效")
      },
      canonical: record(option.canonical, "逐轴 canonical 快照无效")
    } satisfies FundExecutionAxisOptionSnapshot;
  }

  private consequencePlan(value: Prisma.JsonValue) {
    return array(value, "逐轴 canonical 后果计划无效").map((item) => {
      const plan = record(item, "逐轴 canonical 后果无效");
      return {
        sequence: integer(plan.sequence, "逐轴后果序号无效"),
        consequenceType: text(
          plan.consequenceType,
          "逐轴后果类型无效"
        ) as FundExecutionConsequencePlanItem["consequenceType"],
        consequenceIdentity: text(
          plan.consequenceIdentity,
          "逐轴后果身份无效"
        ),
        sliceIdentity:
          plan.sliceIdentity === null
            ? null
            : text(plan.sliceIdentity, "逐轴后果切片无效"),
        amountCents: text(plan.amountCents, "逐轴后果金额无效"),
        originalConsequenceId:
          plan.originalConsequenceId === null
            ? null
            : text(plan.originalConsequenceId, "原后果引用无效")
      };
    });
  }

  private async materializeReversal(
    tx: Transaction,
    input: ConfirmationInput
  ): Promise<{ allocationLineCount: number }> {
    const [caseRow, execution] = await Promise.all([
      tx.fundExecutionCase.findUnique({ where: { id: input.fundExecutionCaseId } }),
      tx.fundExecution.findUnique({ where: { id: input.fundExecutionId } })
    ]);
    if (
      !caseRow ||
      !execution ||
      caseRow.status !== "confirmed" ||
      caseRow.fundExecutionId !== execution.id ||
      execution.executionKind !== "reversal"
    ) {
      throw new ConflictException("反向资金执行确认事实不完整");
    }
    const selections = await tx.fundExecutionCaseAxisSelection.findMany({
      where: { fundExecutionCaseId: caseRow.id },
      orderBy: [{ allocationLineNo: "asc" }, { axis: "asc" }]
    });
    const groups = this.selectionGroups(selections);
    const parsedGroups = groups.map(([lineNo, group]) => ({
      lineNo,
      selections: group,
      parsed: group.map((selection) => ({
        selection,
        option: this.optionSnapshot(selection.optionSnapshot),
        consequences: this.consequencePlan(selection.consequencePlanSnapshot)
      }))
    }));
    const originalLineIds = parsedGroups
      .map(({ parsed }) =>
        text(
          parsed[0]!.option.canonical.reversalOfAllocationLineId,
          "反向共享分配行引用无效"
        )
      )
      .sort();
    if (new Set(originalLineIds).size !== originalLineIds.length) {
      throw new ConflictException("反向共享分配行引用不能重复");
    }
    const originalLines = await tx.$queryRaw<
      Array<{
        id: string;
        direction: string;
        amountCents: bigint;
        currencyCode: string;
        businessType: string;
        businessId: string;
        sourceIdentity: string;
        sliceIdentity: string;
      }>
    >(Prisma.sql`
      SELECT line."id", line."direction", line."amountCents",
             line."currencyCode", line."businessType", line."businessId",
             line."sourceIdentity", line."sliceIdentity"
      FROM "ExecutionAllocationLine" line
      WHERE line."id" IN (${Prisma.join(originalLineIds)})
        AND line."reversalOfAllocationLineId" IS NULL
      ORDER BY line."id"
      FOR UPDATE
    `);
    if (originalLines.length !== originalLineIds.length) {
      throw new ConflictException("原共享分配行不存在或不可再次反向");
    }
    const originalConsequenceIds = parsedGroups
      .flatMap(({ parsed }) =>
        parsed.flatMap(({ consequences }) =>
          consequences.map((plan) =>
            text(plan.originalConsequenceId, "反向 canonical 后果引用无效")
          )
        )
      )
      .sort();
    if (
      new Set(originalConsequenceIds).size !== originalConsequenceIds.length
    ) {
      throw new ConflictException("反向 canonical 后果引用不能重复");
    }
    const storedConsequences = originalConsequenceIds.length
      ? await tx.$queryRaw<StoredConsequence[]>(Prisma.sql`
          SELECT consequence."id", consequence."axisEffectId",
                 consequence."sequence", consequence."consequenceType",
                 consequence."consequenceIdentity", consequence."sliceIdentity",
                 consequence."amountCents",
                 consequence."payableSettlementAllocationId",
                 consequence."projectFundingAllocationId",
                 consequence."interEntityRelationshipEntryId",
                 consequence."operatingFactId",
                 consequence."operatingImpactEntryId"
          FROM "ExecutionAllocationConsequence" consequence
          WHERE consequence."id" IN (${Prisma.join(originalConsequenceIds)})
          ORDER BY consequence."id"
          FOR UPDATE
        `)
      : [];
    if (storedConsequences.length !== originalConsequenceIds.length) {
      throw new ConflictException("原 canonical 后果不存在");
    }

    for (const group of parsedGroups) {
      const lineOption = group.parsed[0]!.option;
      const originalLineId = text(
        lineOption.canonical.reversalOfAllocationLineId,
        "反向共享分配行引用无效"
      );
      const originalLine = originalLines.find(({ id }) => id === originalLineId);
      if (!originalLine) throw new ConflictException("原共享分配行不存在");
      await this.materializeReversalLine(
        tx,
        {
          input,
          caseRevision: caseRow.revision,
          caseReason: caseRow.reason,
          execution,
          lineNo: group.lineNo,
          selections: group.selections
        },
        group.parsed,
        originalLine,
        storedConsequences
      );
    }
    return { allocationLineCount: groups.length };
  }

  private async materializeReversalLine(
    tx: Transaction,
    context: ReversalLineContext,
    parsedSelections: readonly ParsedSelection[],
    originalLine: Readonly<{
      id: string;
      direction: string;
      amountCents: bigint;
      currencyCode: string;
      businessType: string;
      businessId: string;
      sourceIdentity: string;
      sliceIdentity: string;
    }>,
    storedConsequences: readonly StoredConsequence[]
  ) {
    const byAxis = new Map(
      parsedSelections.map((selection) => [selection.option.axis, selection])
    );
    const line = byAxis.get("operating")!.option.line;
    if (
      line.lineNo !== context.lineNo ||
      line.direction !== context.execution.direction ||
      line.direction === originalLine.direction ||
      BigInt(line.amountCents) <= 0n ||
      BigInt(line.amountCents) > originalLine.amountCents ||
      line.currencyCode !== originalLine.currencyCode ||
      line.businessType !== originalLine.businessType ||
      line.businessId !== originalLine.businessId ||
      line.sourceIdentity !== originalLine.sourceIdentity ||
      line.sliceIdentity !== originalLine.sliceIdentity ||
      parsedSelections.some(
        ({ option }) =>
          option.line.allocationLineId !== line.allocationLineId ||
          option.canonical.reversalOfAllocationLineId !== originalLine.id
      )
    ) {
      throw new ConflictException("反向共享分配行未精确复制原身份与切片");
    }
    const [sequence] = await tx.$queryRaw<Array<{ next: number }>>(Prisma.sql`
      SELECT (COUNT(*) + 1)::INTEGER AS next
      FROM "ExecutionAllocationLine"
      WHERE "reversalOfAllocationLineId" = ${originalLine.id}
    `);
    await tx.executionAllocationLine.create({
      data: {
        id: line.allocationLineId,
        executionType: "fund_execution",
        executionId: context.execution.id,
        fundExecutionId: context.execution.id,
        fundExecutionCaseId: context.input.fundExecutionCaseId,
        lineNo: line.lineNo,
        direction: line.direction,
        amountCents: BigInt(line.amountCents),
        currencyCode: line.currencyCode,
        businessType: line.businessType,
        businessId: line.businessId,
        sourceIdentity: line.sourceIdentity,
        sliceIdentity: line.sliceIdentity,
        reversalOfAllocationLineId: originalLine.id,
        reversalSequence: sequence?.next ?? 1,
        reversalReason: context.caseReason,
        payloadFingerprint: fundExecutionCommandFingerprint("confirm_case", {
          line,
          reversalOfAllocationLineId: originalLine.id,
          axes: context.selections.map((selection) => ({
            axis: selection.axis,
            identity: selection.axisIdentity,
            originalAxisEffectId: selection.originalAxisEffectId
          }))
        }),
        createdByUserId: context.input.actorUserId,
        auditRequestId: context.input.auditRequestId,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });

    for (const axis of EXECUTION_ALLOCATION_AXES) {
      const selected = byAxis.get(axis);
      if (!selected || !selected.selection.originalAxisEffectId) {
        throw new ConflictException("反向共享分配行缺少原轴引用");
      }
      const effectId = randomUUID();
      await tx.executionAllocationAxisEffect.create({
        data: {
          id: effectId,
          executionAllocationLineId: line.allocationLineId,
          axis,
          axisIdentity: selected.selection.axisIdentity,
          status: selected.selection.status,
          amountCents: selected.selection.amountCents,
          originalAxisEffectId: selected.selection.originalAxisEffectId,
          createdByUserId: context.input.actorUserId,
          auditRequestId: context.input.auditRequestId,
          createdTransactionId: 0n,
          createdBackendPid: 0
        }
      });
      const bindings: CanonicalBinding[] = [];
      for (const plan of selected.consequences) {
        const original = storedConsequences.find(
          ({ id }) => id === plan.originalConsequenceId
        );
        if (
          !original ||
          original.axisEffectId !== selected.selection.originalAxisEffectId ||
          original.consequenceType !== plan.consequenceType ||
          original.consequenceIdentity !== plan.consequenceIdentity ||
          original.sliceIdentity !== plan.sliceIdentity ||
          BigInt(plan.amountCents) <= 0n ||
          BigInt(plan.amountCents) > original.amountCents
        ) {
          throw new ConflictException("反向 canonical 后果未精确复制原冻结身份");
        }
        bindings.push(
          await this.materializeReversalConsequence(
            tx,
            context,
            line.allocationLineId,
            axis,
            original,
            BigInt(plan.amountCents)
          )
        );
      }
      await this.writeConsequences(
        tx,
        context.input,
        effectId,
        selected.consequences,
        bindings
      );
    }
  }

  private async materializeReversalConsequence(
    tx: Transaction,
    context: ReversalLineContext,
    allocationLineId: string,
    axis: ExecutionAllocationAxis,
    original: StoredConsequence,
    amountCents: bigint
  ): Promise<CanonicalBinding> {
    if (axis === "payable") {
      if (!original.payableSettlementAllocationId) {
        throw new ConflictException("原应付后果引用不完整");
      }
      const payable = await tx.payableSettlementAllocation.findUnique({
        where: { id: original.payableSettlementAllocationId }
      });
      if (!payable) throw new ConflictException("原应付正式分配不存在");
      const id = randomUUID();
      await tx.payableSettlementAllocation.create({
        data: {
          id,
          fundExecutionId: context.execution.id,
          fundExecutionCaseId: context.input.fundExecutionCaseId,
          executionAllocationLineId: allocationLineId,
          payableRef: payable.payableRef,
          sourceType: payable.sourceType,
          sourceAggregateId: payable.sourceAggregateId,
          sourceLineId: payable.sourceLineId,
          confirmedVersionId: payable.confirmedVersionId,
          debtorCompanyId: payable.debtorCompanyId,
          payeeSubjectType: payable.payeeSubjectType,
          payeeSubjectId: payable.payeeSubjectId,
          currencyCode: payable.currencyCode,
          beneficiaryProjectId: payable.beneficiaryProjectId,
          sourceSnapshot: payable.sourceSnapshot as Prisma.InputJsonValue,
          confirmedAmountCents: payable.confirmedAmountCents,
          amountCents,
          direction: "reverse",
          reversalOfAllocationId: payable.id,
          createdByUserId: context.input.actorUserId
        }
      });
      return { payableSettlementAllocationId: id };
    }
    if (axis === "project_fund") {
      if (!original.projectFundingAllocationId) {
        throw new ConflictException("原项目资金后果引用不完整");
      }
      const allocation = await tx.projectFundingAllocation.findUnique({
        where: { id: original.projectFundingAllocationId }
      });
      if (!allocation) throw new ConflictException("原项目资金分配不存在");
      const id = randomUUID();
      await this.projectFunding.reverseSharedExecutionAllocation(tx, {
        id,
        projectId: allocation.projectId,
        executionId: context.execution.id,
        businessType: allocation.businessType,
        businessId: allocation.businessId,
        executionAllocationLineId: allocationLineId,
        originalAllocationId: allocation.id,
        amountCents,
        occurredAt: context.execution.occurredAt,
        reversalKey: `fund-execution:${allocationLineId}:${allocation.id}`,
        reason: context.caseReason,
        actorUserId: context.input.actorUserId
      });
      return { projectFundingAllocationId: id };
    }
    if (axis === "relationship") {
      if (!original.interEntityRelationshipEntryId) {
        throw new ConflictException("原往来后果引用不完整");
      }
      const relationship = await tx.interEntityRelationshipEntry.findUnique({
        where: { id: original.interEntityRelationshipEntryId }
      });
      if (!relationship) throw new ConflictException("原往来正式分录不存在");
      const id = randomUUID();
      await tx.interEntityRelationshipEntry.create({
        data: {
          id,
          entryKind: "proxy_return",
          direction: "decrease",
          status: "confirmed",
          adjustsEntryId: relationship.id,
          fundExecutionId: context.execution.id,
          fundExecutionCaseId: context.input.fundExecutionCaseId,
          executionAllocationLineId: allocationLineId,
          originalDebtorCompanyId: relationship.originalDebtorCompanyId,
          creditorCompanyId: relationship.creditorCompanyId,
          approvedPayerCompanyId: relationship.approvedPayerCompanyId,
          debtorSnapshot: relationship.debtorSnapshot as Prisma.InputJsonValue,
          creditorSnapshot:
            relationship.creditorSnapshot as Prisma.InputJsonValue,
          approvedPayerSnapshot:
            relationship.approvedPayerSnapshot as Prisma.InputJsonValue,
          amountCents,
          currencyCode: relationship.currencyCode,
          evidenceFileId: relationship.evidenceFileId,
          evidenceContentSha256: relationship.evidenceContentSha256,
          actualPayerVerificationEvidenceFileId:
            relationship.actualPayerVerificationEvidenceFileId,
          actualPayerVerificationContentSha256:
            relationship.actualPayerVerificationContentSha256,
          projectId: relationship.projectId,
          contractId: relationship.contractId,
          contractVersionId: relationship.contractVersionId,
          sourceType: relationship.sourceType,
          sourceAggregateId: relationship.sourceAggregateId,
          sourceAllocationCount: relationship.sourceAllocationCount,
          sourceAllocationAmountCents:
            relationship.sourceAllocationAmountCents,
          reason: context.caseReason,
          idempotencyKey: `fund-execution:${allocationLineId}:relationship-reversal`,
          payloadFingerprint: fundExecutionCommandFingerprint("confirm_case", {
            allocationLineId,
            originalRelationshipEntryId: relationship.id,
            amountCents
          }),
          createdByUserId: context.input.actorUserId,
          confirmedByUserId: context.input.actorUserId,
          confirmedAt: new Date()
        }
      });
      return { interEntityRelationshipEntryId: id };
    }
    if (!original.operatingFactId || !original.operatingImpactEntryId) {
      throw new ConflictException("原经营后果引用不完整");
    }
    return this.materializeOperatingReversal(
      tx,
      context,
      allocationLineId,
      original,
      amountCents
    );
  }

  private async materializeOperatingReversal(
    tx: Transaction,
    context: ReversalLineContext,
    allocationLineId: string,
    original: StoredConsequence,
    amountCents: bigint
  ): Promise<CanonicalBinding> {
    const fact = await tx.operatingFact.findUnique({
      where: { id: original.operatingFactId! },
      include: { impacts: true }
    });
    if (
      !fact ||
      fact.impacts.length !== 1 ||
      fact.impacts[0]!.id !== original.operatingImpactEntryId
    ) {
      throw new ConflictException("原经营事实与影响分录不完整");
    }
    const originalImpact = fact.impacts[0]!;
    const subjects = operatingSubjectsFromFact(fact);
    const impact: OperatingImpactInput = {
      idempotencyKey: `fund-execution:${allocationLineId}:operating-impact`,
      sourceImpactKey: originalImpact.sourceImpactKey,
      impactKind: originalImpact.impactKind as OperatingImpactInput["impactKind"],
      amountCents,
      direction: inverseImpactDirection(originalImpact.direction),
      ...(originalImpact.subjectRole
        ? {
            subjectRole:
              originalImpact.subjectRole as OperatingImpactInput["subjectRole"]
          }
        : {}),
      ...(originalImpact.subjectKind && originalImpact.subjectId
        ? {
            subject: {
              kind: originalImpact.subjectKind as OperatingSubjectReference["kind"],
              id: originalImpact.subjectId
            }
          }
        : {}),
      ...(originalImpact.costCategoryCode
        ? {
            costCategoryCode:
              originalImpact.costCategoryCode as OperatingImpactInput["costCategoryCode"]
          }
        : {}),
      ...(originalImpact.fundPurpose
        ? { fundPurpose: originalImpact.fundPurpose }
        : {}),
      description: "资金执行反向事实精确冲销原经营影响",
      impactSnapshot: {
        originalOperatingImpactEntryId: originalImpact.id,
        originalExecutionAllocationConsequenceId: original.id
      },
      fundExecutionId: context.execution.id,
      fundExecutionCaseId: context.input.fundExecutionCaseId,
      executionAllocationLineId: allocationLineId
    };
    const effectiveDate = await readOperatingLedgerEffectiveDate(
      tx,
      fact.projectId
    );
    const input: AppendOperatingFactInput = {
      projectId: fact.projectId,
      sourceType: "fund_execution",
      sourceBusinessId: allocationLineId,
      sourceBusinessCode: `资金反向执行-${context.execution.id}`,
      sourceVersion: context.caseRevision,
      idempotencyKey: `fund-execution:${allocationLineId}:operating-fact`,
      occurredAt: context.execution.occurredAt,
      confirmedAt: new Date(),
      confirmedByUserId: context.input.actorUserId,
      factKind: fact.factKind as AppendOperatingFactInput["factKind"],
      operatingLevel:
        fact.operatingLevel as AppendOperatingFactInput["operatingLevel"],
      evidenceLevel:
        fact.evidenceLevel as AppendOperatingFactInput["evidenceLevel"],
      amountCents,
      currencyCode: fact.currencyCode,
      direction: context.execution.direction as "inflow" | "outflow",
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
        context.execution.occurredAt,
        effectiveDate
      ),
      affiliateAssignmentId: fact.affiliateAssignmentId,
      affiliateBusinessPartyVersionId:
        fact.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: fact.affiliateNameSnapshot,
      ...(fact.affiliateCreditCodeSnapshot
        ? { affiliateCreditCodeSnapshot: fact.affiliateCreditCodeSnapshot }
        : {}),
      sourceSnapshot: {
        fundExecutionId: context.execution.id,
        fundExecutionCaseId: context.input.fundExecutionCaseId,
        allocationLineId,
        originalOperatingFactId: fact.id,
        originalExecutionAllocationConsequenceId: original.id
      },
      basisSnapshot: {
        originalOperatingFactFingerprint: fundExecutionCommandFingerprint(
          "confirm_case",
          {
            id: fact.id,
            sourceType: fact.sourceType,
            sourceBusinessId: fact.sourceBusinessId,
            amountCents: fact.amountCents
          }
        )
      },
      subjects,
      impacts: [impact],
      adjustsFactId: fact.id,
      fundExecutionId: context.execution.id,
      fundExecutionCaseId: context.input.fundExecutionCaseId
    };
    const result = await this.operatingLedger.appendFundExecutionReversalInTransaction(
      tx,
      input,
      context.input.actorUserId
    );
    const impactId = result.impactIds[0];
    if (!impactId) throw new ConflictException("经营轴反向影响未生成");
    return {
      operatingFactId: result.id,
      operatingImpactEntryId: impactId
    };
  }
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException(message);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new ConflictException(message);
  return value;
}

function text(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConflictException(message);
  }
  return value.trim();
}

function integer(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ConflictException(message);
  }
  return value;
}

function cents(value: unknown, message: string): bigint {
  try {
    const parsed =
      typeof value === "bigint" ? value : BigInt(text(value, message));
    if (parsed <= 0n) throw new Error(message);
    return parsed;
  } catch {
    throw new ConflictException(message);
  }
}

function operatingSubject(value: unknown, message: string): OperatingSubjectReference {
  const subject = record(value, message);
  return {
    kind: text(subject.kind, message) as OperatingSubjectReference["kind"],
    id: text(subject.id, message)
  };
}

function operatingSubjectsFromFact(fact: {
  debtorSubjectKind: string | null;
  debtorSubjectId: string | null;
  creditorSubjectKind: string | null;
  creditorSubjectId: string | null;
  approvedPayerSubjectKind: string | null;
  approvedPayerSubjectId: string | null;
  actualPayerSubjectKind: string | null;
  actualPayerSubjectId: string | null;
  payeeSubjectKind: string | null;
  payeeSubjectId: string | null;
  costBearingCompanySubjectKind: string | null;
  costBearingCompanySubjectId: string | null;
}): OperatingFactSubjects {
  return {
    ...storedOperatingSubject(
      "debtor",
      fact.debtorSubjectKind,
      fact.debtorSubjectId
    ),
    ...storedOperatingSubject(
      "creditor",
      fact.creditorSubjectKind,
      fact.creditorSubjectId
    ),
    ...storedOperatingSubject(
      "approvedPayer",
      fact.approvedPayerSubjectKind,
      fact.approvedPayerSubjectId
    ),
    ...storedOperatingSubject(
      "actualPayer",
      fact.actualPayerSubjectKind,
      fact.actualPayerSubjectId
    ),
    ...storedOperatingSubject(
      "payee",
      fact.payeeSubjectKind,
      fact.payeeSubjectId
    ),
    ...storedOperatingSubject(
      "costBearingCompany",
      fact.costBearingCompanySubjectKind,
      fact.costBearingCompanySubjectId
    )
  };
}

function storedOperatingSubject(
  role: keyof OperatingFactSubjects,
  kind: string | null,
  id: string | null
): Partial<OperatingFactSubjects> {
  if (!kind || !id) return {};
  return {
    [role]: {
      kind: kind as OperatingSubjectReference["kind"],
      id
    }
  };
}

function inverseImpactDirection(
  direction: string
): OperatingImpactInput["direction"] {
  if (direction === "increase") return "decrease";
  if (direction === "decrease") return "increase";
  if (direction === "notice") return "notice";
  throw new ConflictException("原经营影响方向无效");
}
