import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import type { RoleKey } from "@jiangkong/shared-domain";
import { resolveApprovalReviewIdentity } from "../approval/approval-review-identity";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  EXECUTION_ALLOCATION_AXES,
  assertFundExecutionConfirmationSeparation,
  planReverseExecutionAxisEffects,
  type FundExecutionApprovalDelegation
} from "./fund-execution.domain";
import { FundExecutionCanonicalAdapterService } from "./fund-execution-canonical-adapter.service";
import {
  fundExecutionCommandFingerprint,
  type FundExecutionCommandAction
} from "./fund-execution-command-receipt";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { fundExecutionSelectionRefFingerprint } from "./fund-execution-selection-ref.service";

type Transaction = Prisma.TransactionClient;

export type FundExecutionCommandResponse = Readonly<{
  caseId: string;
  fundExecutionId: string;
  status: string;
  revision: number;
  approvalInstanceId: string | null;
}>;

type ReceiptExecution<TResponse> = Readonly<{
  response: TResponse;
  fundExecutionId: string;
  fundExecutionCaseId: string | null;
  expectedRevision: number | null;
}>;

export type CreateFundExecutionCaseInput = Readonly<{
  observationSelectionRef: string;
  reason: string;
  idempotencyKey: string;
}>;

export type UpdateFundExecutionCaseInput = Readonly<{
  caseId: string;
  expectedRevision: number;
  reason: string;
  selectionRefs: readonly string[];
  idempotencyKey: string;
}>;

export type UpdateFundExecutionReversalCaseInput = Readonly<{
  caseId: string;
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
}>;

export type FundExecutionCaseCommandInput = Readonly<{
  caseId: string;
  expectedRevision: number;
  idempotencyKey: string;
}>;

export type ReturnFundExecutionCaseInput = FundExecutionCaseCommandInput &
  Readonly<{ reason: string }>;

export type CreateFundExecutionReversalCaseInput = Readonly<{
  targetSelectionRef: string;
  observationSelectionRef: string;
  reason: string;
  idempotencyKey: string;
}>;

export type ReviewFundExecutionApprovalInput = Readonly<{
  caseId: string;
  action: "approve" | "return_to_applicant";
  comment?: string;
}>;

type ApprovalFreeze = Readonly<{
  approvalInstanceStatus: string;
  approvalFlowType: string;
  approvalBusinessType: string;
  approvalBusinessId: string;
  approvalInstanceSnapshot: Prisma.JsonValue;
  approvalInstanceFingerprint: string;
  approvalActionLogSnapshot: Prisma.JsonValue;
  approvalActionLogCount: number;
  approvalActionLogFingerprint: string;
  finalApprovalActionLogId: string;
  finalApprovalActionFingerprint: string;
  finalApprovalActorUserId: string;
  finalApprovalRepresentedUserId: string | null;
  finalApprovalAction: string;
}>;

type ReversalLine = Readonly<{
  id: string;
  lineNo: number;
  direction: string;
  amountCents: bigint;
  currencyCode: string;
  businessType: string;
  businessId: string;
  sourceIdentity: string;
  sliceIdentity: string;
}>;

type ReversalEffect = Readonly<{
  id: string;
  executionAllocationLineId: string;
  axis: string;
  axisIdentity: string;
  status: string;
  amountCents: bigint;
}>;

type ReversalConsequence = Readonly<{
  id: string;
  axisEffectId: string;
  sequence: number;
  consequenceType: string;
  consequenceIdentity: string;
  sliceIdentity: string | null;
  amountCents: bigint;
  consequenceFingerprint: string;
}>;

type ReversalDraftSelection = Readonly<{
  lineNo: number;
  axis: string;
  status: string;
  amountCents: bigint;
  axisIdentity: string;
  optionSnapshot: Prisma.InputJsonValue;
  optionFingerprint: string;
  consequencePlanSnapshot: Prisma.InputJsonValue;
  consequencePlanFingerprint: string;
  originalAxisEffectId: string;
}>;

type ReversalSource = Readonly<{
  direction: "inflow" | "outflow";
  originalAmountCents: bigint;
  alreadyReversedAmountCents: bigint;
  remainingAmountCents: bigint;
  currencyCode: string;
  holderCompanyEntityId: string;
  lines: readonly ReversalLine[];
  effects: readonly ReversalEffect[];
  consequences: readonly ReversalConsequence[];
}>;

const FINANCE_WRITER_ROLES = ["finance_staff", "finance_director"] as const;
const FUND_EXECUTION_READ_ROLES = new Set([
  "finance_staff",
  "finance_director",
  "chairman",
  "general_manager"
]);
const FUND_EXECUTION_APPROVAL_NODES = [
  {
    name: "财务主管",
    mode: "any",
    roleKeys: ["finance_director"],
    approvedRoleKeys: []
  },
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"],
    approvedRoleKeys: []
  }
] as const;

@Injectable()
export class FundExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly options: FundExecutionSelectionOptionsService,
    private readonly canonicalAdapter: FundExecutionCanonicalAdapterService
  ) {}

  async createCase(
    actorUserId: string,
    input: CreateFundExecutionCaseInput
  ): Promise<FundExecutionCommandResponse> {
    const reason = requiredText(input.reason, "资金执行原因不能为空");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const payloadFingerprint = fundExecutionCommandFingerprint("create_case", {
      actorUserId,
      observationSelectionRef: requiredText(
        input.observationSelectionRef,
        "银行流水候选不能为空"
      ),
      reason
    });
    return this.runSerializable(async (tx) => {
      await this.authorizeContext(tx, actorUserId, idempotencyKey, "create_case");
      return this.receiptFirst(tx, {
        actorUserId,
        action: "create_case",
        idempotencyKey,
        payloadFingerprint,
        execute: async () => {
          await this.assertRole(tx, actorUserId, FINANCE_WRITER_ROLES);
          const matched = await this.options.matchObservationInTransaction(
            tx,
            actorUserId,
            input.observationSelectionRef
          );
          const observation = matched.observation;
          const fundExecutionId = randomUUID();
          const caseKey = randomUUID();
          const fundExecutionCaseId = randomUUID();
          const executionPayloadFingerprint = fundExecutionCommandFingerprint(
            "create_case",
            {
              observationFingerprint: observation.payloadFingerprint,
              direction: observation.direction,
              amountCents: observation.amountCents,
              currencyCode: observation.currencyCode,
              occurredAt: observation.occurredAt,
              handledByUserId: actorUserId,
              paymentExecutedByUserId: observation.transactionExecutedByUserId
            }
          );
          await tx.fundExecution.create({
            data: {
              id: fundExecutionId,
              idempotencyKey,
              executionKind: "bank_transaction",
              direction: observation.direction,
              amountCents: observation.amountCents,
              currencyCode: observation.currencyCode,
              occurredAt: observation.occurredAt,
              payloadFingerprint: executionPayloadFingerprint,
              createdByUserId: actorUserId,
              handledByUserId: actorUserId,
              paymentExecutedByUserId:
                observation.transactionExecutedByUserId,
              auditAction: "create_case",
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }
          });
          await tx.bankTransactionClaim.create({
            data: {
              id: randomUUID(),
              observationId: observation.id,
              selectionRefFingerprint: fundExecutionSelectionRefFingerprint(
                input.observationSelectionRef
              ),
              targetType: "fund_execution",
              fundExecutionId,
              createdByUserId: actorUserId,
              auditAction: "create_case",
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }
          });
          const caseRow = await tx.fundExecutionCase.create({
            data: {
              id: fundExecutionCaseId,
              caseKey,
              fundExecutionId,
              revision: 1,
              status: "draft",
              reason,
              payloadFingerprint: this.caseFingerprint({
                caseKey,
                fundExecutionId,
                revision: 1,
                status: "draft",
                reason,
                predecessorCaseId: null,
                selectionFingerprints: []
              }),
              idempotencyKey,
              createdByUserId: actorUserId,
              commandActorUserId: actorUserId,
              auditAction: "create_case",
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }
          });
          const response = this.response(caseRow);
          await this.recordAudit(tx, actorUserId, "create_case", response, {
            observationFingerprint: observation.payloadFingerprint,
            executionPayloadFingerprint
          });
          return {
            response,
            fundExecutionId,
            fundExecutionCaseId,
            expectedRevision: null
          };
        }
      });
    });
  }

  async listCases(actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertReader(tx, actorUserId);
      const actorRoles = await this.globalRoleKeys(tx, actorUserId);
      const delegations = await this.activeDelegationsTo(tx, actorUserId);
      const activeDelegators = await Promise.all(
        delegations.map(async ({ fromUserId, resourceId }) => ({
          userId: fromUserId,
          resourceId,
          roleKeys: await this.globalRoleKeys(tx, fromUserId)
        }))
      );
      const rows = await tx.$queryRaw<
        Array<{
          caseId: string;
          status: string;
          auditAction: string;
          revision: number;
          reason: string;
          executionKind: string;
          direction: string;
          amountCents: bigint;
          currencyCode: string;
          occurredAt: Date;
          approvalStatus: string | null;
          approvalCurrentNodeIndex: number | null;
          approvalFrozenNodes: Prisma.JsonValue | null;
          lastApprovalActorUserId: string | null;
          holderNameSnapshot: string;
          classificationLineCount: number;
          createdAt: Date;
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (case_row."caseKey")
               case_row."caseKey" AS "caseId", case_row."status",
               case_row."auditAction", case_row."revision", case_row."reason",
               execution."executionKind", execution."direction",
               execution."amountCents", execution."currencyCode",
               execution."occurredAt", approval."status" AS "approvalStatus",
               approval."currentNodeIndex" AS "approvalCurrentNodeIndex",
               approval."frozenNodes" AS "approvalFrozenNodes",
               last_action."actorUserId" AS "lastApprovalActorUserId",
               observation."holderNameSnapshot",
               (SELECT COUNT(DISTINCT selection."allocationLineNo")::INTEGER
                  FROM "FundExecutionCaseAxisSelection" selection
                 WHERE selection."fundExecutionCaseId" = case_row."id")
                 AS "classificationLineCount",
               case_row."createdAt"
        FROM "FundExecutionCase" case_row
        INNER JOIN "FundExecution" execution
          ON execution."id" = case_row."fundExecutionId"
        LEFT JOIN "ApprovalInstance" approval
          ON approval."id" = case_row."approvalInstanceId"
        INNER JOIN "BankTransactionClaim" claim
          ON claim."fundExecutionId" = execution."id"
        INNER JOIN "VerifiedBankTransactionObservation" observation
          ON observation."id" = claim."observationId"
        LEFT JOIN LATERAL (
          SELECT action_log."actorUserId"
          FROM "ApprovalActionLog" action_log
          WHERE action_log."approvalInstanceId" = approval."id"
          ORDER BY action_log."createdAt" DESC, action_log."id" DESC
          LIMIT 1
        ) last_action ON TRUE
        ORDER BY case_row."caseKey", case_row."revision" DESC
      `);
      const actorCanReadAll = actorRoles.some((role) =>
        FUND_EXECUTION_READ_ROLES.has(role)
      );
      const authorizedDelegations = activeDelegators.filter(({ roleKeys }) =>
        roleKeys.some((role) =>
          ["finance_director", "chairman", "general_manager"].includes(role)
        )
      );
      const delegatedAllCases = authorizedDelegations.some(
        ({ resourceId }) => resourceId === null
      );
      const delegatedCaseIds = new Set(
        authorizedDelegations.flatMap(({ resourceId }) =>
          resourceId ? [resourceId] : []
        )
      );
      return rows
        .filter(
          (row) =>
            actorCanReadAll ||
            delegatedAllCases ||
            delegatedCaseIds.has(row.caseId)
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.caseId.localeCompare(right.caseId)
        )
        .slice(0, 100)
        .map((row) => {
          const nodes = Array.isArray(row.approvalFrozenNodes)
            ? row.approvalFrozenNodes
            : [];
          const node =
            row.approvalCurrentNodeIndex === null
              ? null
              : nodes[row.approvalCurrentNodeIndex];
          const reviewIdentity =
            row.status === "submitted" &&
            row.approvalStatus === "in_progress" &&
            node &&
            typeof node === "object" &&
            !Array.isArray(node)
              ? resolveApprovalReviewIdentity({
                  node: node as Record<string, unknown>,
                  actorUserId,
                  actorRoleKeys: actorRoles,
                  activeDelegators: activeDelegators.filter(
                    ({ resourceId }) =>
                      resourceId === null || resourceId === row.caseId
                  )
                })
              : null;
          const isReversal = row.executionKind === "reversal";
          const returnedDraft =
            row.status === "draft" && row.auditAction === "return_case";
          const observationSummary = `${row.direction === "inflow" ? "入账" : "出账"} · ${row.holderNameSnapshot} · ${row.currencyCode} ${formatMoneyCents(row.amountCents)} · ${row.occurredAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
          return {
            caseRef: row.caseId,
            caseLabel: `资金执行案件 · ${row.occurredAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
            executionKind: isReversal ? "reversal" : "quarantine",
            direction: row.direction,
            directionLabel: row.direction === "inflow" ? "入账" : "出账",
            observationSummary,
            amountCents: row.amountCents.toString(),
            occurredAt: row.occurredAt,
            reason: row.reason,
            classificationSummary: isReversal
              ? "沿用原执行的逐轴分类"
              : row.classificationLineCount > 0
                ? `已冻结 ${row.classificationLineCount} 条完整四轴分类`
                : null,
            status: row.status,
            statusLabel:
              row.status === "confirmed"
                ? "已确认"
                : row.status === "submitted"
                  ? "审批中"
                  : returnedDraft
                    ? "退回待修改"
                    : "草稿",
            approvalStatusLabel: approvalStatusLabel(row.approvalStatus),
            revision: row.revision,
            updatedAt: row.createdAt,
            actions: fundExecutionCaseActions({
              status: row.status,
              isReversal,
              hasCompleteClassification: row.classificationLineCount > 0,
              canReview: Boolean(reviewIdentity),
              canAppendReturnedDraft:
                row.approvalStatus === "returned_to_applicant" &&
                row.lastApprovalActorUserId === actorUserId,
              canConfirm:
                row.approvalStatus === "approved" &&
                actorRoles.includes("finance_director")
            })
          };
        });
    });
  }

  async getCase(actorUserId: string, caseId: string) {
    const caseKey = requiredText(caseId, "资金执行案件不能为空");
    const listedCase = (await this.listCases(actorUserId)).find(
      (item) => item.caseRef === caseKey
    );
    if (!listedCase) throw new NotFoundException("资金执行案件不存在");
    return this.prisma.$transaction(async (tx) => {
      await this.assertReader(tx, actorUserId, caseKey);
      const [row] = await tx.$queryRaw<
        Array<{
          internalCaseId: string;
          caseId: string;
          status: string;
          revision: number;
          reason: string;
          executionKind: string;
          direction: string;
          amountCents: bigint;
          currencyCode: string;
          occurredAt: Date;
          approvalStatus: string | null;
          returnReason: string | null;
          createdAt: Date;
        }>
      >(Prisma.sql`
        SELECT case_row."id" AS "internalCaseId",
               case_row."caseKey" AS "caseId", case_row."status",
               case_row."revision", case_row."reason",
               execution."executionKind", execution."direction",
               execution."amountCents", execution."currencyCode",
               execution."occurredAt", approval."status" AS "approvalStatus",
               case_row."returnReason", case_row."createdAt"
        FROM "FundExecutionCase" case_row
        INNER JOIN "FundExecution" execution
          ON execution."id" = case_row."fundExecutionId"
        LEFT JOIN "ApprovalInstance" approval
          ON approval."id" = case_row."approvalInstanceId"
        WHERE case_row."caseKey" = ${caseKey}
        ORDER BY case_row."revision" DESC
        LIMIT 1
      `);
      if (!row) throw new NotFoundException("资金执行案件不存在");
      const selections = await tx.fundExecutionCaseAxisSelection.findMany({
        where: { fundExecutionCaseId: row.internalCaseId },
        orderBy: [{ allocationLineNo: "asc" }, { axis: "asc" }]
      });
      return {
        caseId: row.caseId,
        status: row.status,
        revision: row.revision,
        reason: row.reason,
        executionKind: row.executionKind,
        direction: row.direction,
        amountCents: row.amountCents.toString(),
        currencyCode: row.currencyCode,
        occurredAt: row.occurredAt,
        approvalStatus: row.approvalStatus,
        returnReason: row.returnReason,
        createdAt: row.createdAt,
        summary: executionSummary(row),
        classificationLines: publicClassificationLines(selections),
        actions: listedCase.actions
      };
    });
  }

  async createReversalCase(
    actorUserId: string,
    input: CreateFundExecutionReversalCaseInput
  ): Promise<FundExecutionCommandResponse> {
    const targetSelectionRef = requiredText(
      input.targetSelectionRef,
      "原业务事项不能为空"
    );
    const observationSelectionRef = requiredText(
      input.observationSelectionRef,
      "反向银行流水候选不能为空"
    );
    const reason = requiredText(input.reason, "反向执行原因不能为空");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const payloadFingerprint = fundExecutionCommandFingerprint("create_case", {
      actorUserId,
      targetSelectionRef,
      observationSelectionRef,
      reason,
      kind: "reversal"
    });
    return this.runSerializable(async (tx) => {
      await this.authorizeContext(tx, actorUserId, idempotencyKey, "create_case");
      return this.receiptFirst(tx, {
        actorUserId,
        action: "create_case",
        idempotencyKey,
        payloadFingerprint,
        execute: async () => {
          await this.assertRole(tx, actorUserId, FINANCE_WRITER_ROLES);
          const target = await this.options.matchReversalTargetInTransaction(
            tx,
            actorUserId,
            targetSelectionRef
          );
          const targetType = target.targetType;
          const targetExecutionId = target.targetExecutionId;
          const source = await this.lockReversalSource(
            tx,
            targetType,
            targetExecutionId
          );
          const matched = await this.options.matchObservationInTransaction(
            tx,
            actorUserId,
            observationSelectionRef
          );
          const observation = matched.observation;
          const expectedDirection = oppositeDirection(source.direction);
          if (
            observation.direction !== expectedDirection ||
            observation.amountCents <= 0n ||
            observation.amountCents > source.remainingAmountCents ||
            target.amountCents !== source.remainingAmountCents ||
            observation.currencyCode !== source.currencyCode ||
            observation.holderCompanyEntityId !== source.holderCompanyEntityId
          ) {
            throw new ConflictException(
              "反向银行流水与原资金执行的剩余金额、币种、方向或账户持有人不一致"
            );
          }

          const fundExecutionId = randomUUID();
          const caseKey = randomUUID();
          const fundExecutionCaseId = randomUUID();
          const selections = await this.buildReversalDraftSelections(
            tx,
            source,
            expectedDirection,
            observation.amountCents
          );
          const executionPayloadFingerprint = fundExecutionCommandFingerprint(
            "create_case",
            {
              kind: "reversal",
              targetType,
              targetExecutionId,
              observationFingerprint: observation.payloadFingerprint,
              alreadyReversedAmountCents: source.alreadyReversedAmountCents,
              reverseAmountCents: observation.amountCents,
              sourceLineFingerprints: source.lines.map((line) => ({
                id: line.id,
                amountCents: line.amountCents,
                sourceIdentity: line.sourceIdentity,
                sliceIdentity: line.sliceIdentity
              }))
            }
          );
          await tx.fundExecution.create({
            data: {
              id: fundExecutionId,
              idempotencyKey,
              executionKind: "reversal",
              direction: expectedDirection,
              amountCents: observation.amountCents,
              currencyCode: observation.currencyCode,
              occurredAt: observation.occurredAt,
              ...(targetType === "payment_execution"
                ? { reversesPaymentExecutionId: targetExecutionId }
                : { reversesFundExecutionId: targetExecutionId }),
              payloadFingerprint: executionPayloadFingerprint,
              createdByUserId: actorUserId,
              handledByUserId: actorUserId,
              paymentExecutedByUserId:
                observation.transactionExecutedByUserId,
              auditAction: "create_case",
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }
          });
          await tx.bankTransactionClaim.create({
            data: {
              id: randomUUID(),
              observationId: observation.id,
              selectionRefFingerprint: fundExecutionSelectionRefFingerprint(
                observationSelectionRef
              ),
              targetType: "fund_execution",
              fundExecutionId,
              createdByUserId: actorUserId,
              auditAction: "create_case",
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }
          });
          const caseRow = await tx.fundExecutionCase.create({
            data: {
              id: fundExecutionCaseId,
              caseKey,
              fundExecutionId,
              revision: 1,
              status: "draft",
              reason,
              payloadFingerprint: this.caseFingerprint({
                kind: "reversal",
                caseKey,
                fundExecutionId,
                revision: 1,
                status: "draft",
                reason,
                targetType,
                targetExecutionId,
                selectionFingerprints: selections.map((selection) => ({
                  lineNo: selection.lineNo,
                  axis: selection.axis,
                  optionFingerprint: selection.optionFingerprint,
                  consequencePlanFingerprint:
                    selection.consequencePlanFingerprint
                }))
              }),
              idempotencyKey,
              createdByUserId: actorUserId,
              commandActorUserId: actorUserId,
              auditAction: "create_case",
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }
          });
          await tx.fundExecutionCaseAxisSelection.createMany({
            data: selections.map((selection) => ({
              id: randomUUID(),
              fundExecutionCaseId,
              allocationLineNo: selection.lineNo,
              axis: selection.axis,
              status: selection.status,
              amountCents: selection.amountCents,
              axisIdentity: selection.axisIdentity,
              selectionSource: "reversal_copy",
              originalAxisEffectId: selection.originalAxisEffectId,
              optionSnapshot: selection.optionSnapshot,
              optionFingerprint: selection.optionFingerprint,
              consequencePlanSnapshot: selection.consequencePlanSnapshot,
              consequencePlanFingerprint:
                selection.consequencePlanFingerprint,
              createdByUserId: actorUserId,
              auditRequestId: idempotencyKey,
              createdTransactionId: 0n,
              createdBackendPid: 0
            }))
          });
          const response = this.response(caseRow);
          await this.recordAudit(tx, actorUserId, "create_case", response, {
            kind: "reversal",
            targetType,
            targetExecutionFingerprint: fundExecutionCommandFingerprint(
              "create_case",
              targetExecutionId
            ),
            observationFingerprint: observation.payloadFingerprint,
            sourceLineCount: source.lines.length
          });
          return {
            response,
            fundExecutionId,
            fundExecutionCaseId,
            expectedRevision: null
          };
        }
      });
    });
  }

  async updateCase(
    actorUserId: string,
    input: UpdateFundExecutionCaseInput
  ): Promise<FundExecutionCommandResponse> {
    const caseId = requiredText(input.caseId, "资金执行案件不能为空");
    const reason = requiredText(input.reason, "资金执行原因不能为空");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    assertRevision(input.expectedRevision);
    const payloadFingerprint = fundExecutionCommandFingerprint("update_case", {
      actorUserId,
      caseId,
      expectedRevision: input.expectedRevision,
      reason,
      selectionRefs: [...input.selectionRefs].sort()
    });
    return this.runSerializable(async (tx) => {
      await this.authorizeContext(tx, actorUserId, idempotencyKey, "update_case");
      return this.receiptFirst(tx, {
        actorUserId,
        action: "update_case",
        idempotencyKey,
        payloadFingerprint,
        execute: async () => {
          await this.assertRole(tx, actorUserId, FINANCE_WRITER_ROLES);
          const predecessor = await this.lockLatestCase(
            tx,
            caseId,
            input.expectedRevision,
            "draft"
          );
          const execution = await tx.fundExecution.findUnique({
            where: { id: predecessor.fundExecutionId },
            select: { executionKind: true }
          });
          if (!execution || execution.executionKind === "reversal") {
            throw new BadRequestException(
              "反向执行不接受分类选择，只能通过反向草稿入口修改原因"
            );
          }
          const selections = await this.options.resolveCasePlanInTransaction(tx, {
            caseKey: caseId,
            actorUserId,
            expectedRevision: input.expectedRevision,
            selectionRefs: input.selectionRefs
          });
          const caseRow = await this.appendCaseRevision(tx, {
            predecessor,
            actorUserId,
            idempotencyKey,
            status: "draft",
            reason,
            action: "update_case",
            approvalInstanceId: null,
            selections
          });
          const response = this.response(caseRow);
          await this.recordAudit(tx, actorUserId, "update_case", response, {
            selectionCount: selections.length
          });
          return {
            response,
            fundExecutionId: caseRow.fundExecutionId,
            fundExecutionCaseId: caseRow.id,
            expectedRevision: input.expectedRevision
          };
        }
      });
    });
  }

  async updateReversalCase(
    actorUserId: string,
    input: UpdateFundExecutionReversalCaseInput
  ): Promise<FundExecutionCommandResponse> {
    const caseId = requiredText(input.caseId, "资金执行案件不能为空");
    const reason = requiredText(input.reason, "反向执行原因不能为空");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    assertRevision(input.expectedRevision);
    const payloadFingerprint = fundExecutionCommandFingerprint("update_case", {
      actorUserId,
      caseId,
      expectedRevision: input.expectedRevision,
      reason,
      kind: "reversal"
    });
    return this.runSerializable(async (tx) => {
      await this.authorizeContext(tx, actorUserId, idempotencyKey, "update_case");
      return this.receiptFirst(tx, {
        actorUserId,
        action: "update_case",
        idempotencyKey,
        payloadFingerprint,
        execute: async () => {
          await this.assertRole(tx, actorUserId, FINANCE_WRITER_ROLES);
          const predecessor = await this.lockLatestCase(
            tx,
            caseId,
            input.expectedRevision,
            "draft"
          );
          const execution = await tx.fundExecution.findUnique({
            where: { id: predecessor.fundExecutionId },
            select: { executionKind: true }
          });
          if (!execution || execution.executionKind !== "reversal") {
            throw new BadRequestException("当前案件不是反向执行草稿");
          }
          const predecessorSelections =
            await tx.fundExecutionCaseAxisSelection.findMany({
              where: { fundExecutionCaseId: predecessor.id },
              orderBy: [{ allocationLineNo: "asc" }, { axis: "asc" }]
            });
          if (
            !predecessorSelections.length ||
            predecessorSelections.some(
              (selection) =>
                selection.selectionSource !== "reversal_copy" ||
                !selection.originalAxisEffectId
            )
          ) {
            throw new ConflictException("反向执行原分类冻结证据不完整");
          }
          const caseRow = await this.appendCaseRevision(tx, {
            predecessor,
            actorUserId,
            idempotencyKey,
            status: "draft",
            reason,
            action: "update_case",
            approvalInstanceId: null,
            selections: predecessorSelections.map((selection) => ({
              lineNo: selection.allocationLineNo,
              axis: selection.axis,
              status: selection.status,
              amountCents: selection.amountCents,
              axisIdentity: selection.axisIdentity,
              optionSnapshot: selection.optionSnapshot,
              optionFingerprint: selection.optionFingerprint,
              consequencePlanSnapshot: selection.consequencePlanSnapshot,
              consequencePlanFingerprint:
                selection.consequencePlanFingerprint,
              originalAxisEffectId: selection.originalAxisEffectId
            }))
          });
          const response = this.response(caseRow);
          await this.recordAudit(tx, actorUserId, "update_case", response, {
            kind: "reversal",
            selectionCount: predecessorSelections.length
          });
          return {
            response,
            fundExecutionId: caseRow.fundExecutionId,
            fundExecutionCaseId: caseRow.id,
            expectedRevision: input.expectedRevision
          };
        }
      });
    });
  }

  async submitCase(
    actorUserId: string,
    input: FundExecutionCaseCommandInput
  ): Promise<FundExecutionCommandResponse> {
    return this.transition(actorUserId, input, "submit_case");
  }

  async returnCase(
    actorUserId: string,
    input: ReturnFundExecutionCaseInput
  ): Promise<FundExecutionCommandResponse> {
    return this.transition(actorUserId, input, "return_case");
  }

  async confirmCase(
    actorUserId: string,
    input: FundExecutionCaseCommandInput
  ): Promise<FundExecutionCommandResponse> {
    return this.transition(actorUserId, input, "confirm_case");
  }

  async reviewApproval(
    actorUserId: string,
    input: ReviewFundExecutionApprovalInput
  ) {
    const caseId = requiredText(input.caseId, "资金执行案件不能为空");
    return this.runSerializable(async (tx) => {
      const submitted = await this.lockLatestCase(tx, caseId, undefined, "submitted");
      if (!submitted.approvalInstanceId) {
        throw new ConflictException("资金执行案件缺少审批实例");
      }
      const [instance] = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          currentNodeIndex: number;
          frozenNodes: Prisma.JsonValue;
          applicantUserId: string;
          flowType: string;
          businessType: string;
          businessId: string;
        }>
      >(Prisma.sql`
        SELECT "id", "status", "currentNodeIndex", "frozenNodes",
               "applicantUserId", "flowType", "businessType", "businessId"
        FROM "ApprovalInstance"
        WHERE "id" = ${submitted.approvalInstanceId}
        FOR UPDATE
      `);
      if (
        !instance ||
        instance.status !== "in_progress" ||
        instance.flowType !== "fund_execution_case.approve" ||
        instance.businessType !== "fund_execution_case" ||
        instance.businessId !== submitted.caseKey
      ) {
        throw new ConflictException("审批状态已变化，请刷新后重试");
      }
      const nodes = jsonArray(instance.frozenNodes).map((node) => jsonObject(node));
      const node = nodes[instance.currentNodeIndex];
      if (!node) throw new ConflictException("当前审批节点不存在");
      const actorRoles = await this.globalRoleKeys(tx, actorUserId);
      const delegations = await this.activeDelegationsTo(
        tx,
        actorUserId,
        submitted.caseKey
      );
      const delegatorRoles = await Promise.all(
        delegations.map(async ({ fromUserId }) => ({
          userId: fromUserId,
          roleKeys: await this.globalRoleKeys(tx, fromUserId)
        }))
      );
      const identity = resolveApprovalReviewIdentity({
        node,
        actorUserId,
        actorRoleKeys: actorRoles,
        activeDelegators: delegatorRoles
      });
      if (!identity) {
        throw new ForbiddenException("当前用户不能处理该资金执行审批节点");
      }
      if (input.action === "return_to_applicant") {
        const comment = requiredText(input.comment, "退回审批必须填写原因");
        await tx.approvalActionLog.create({
          data: {
            id: randomUUID(),
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
            actorUserId,
            representedUserId: identity.representedUserId,
            approvedRoleKey: identity.approvedRoleKey,
            metadata: {
              fundExecutionApprovalStep: instance.currentNodeIndex + 1
            },
            comment
          }
        });
        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });
        return { caseId, status: "returned_to_applicant" };
      }
      const finalNode = instance.currentNodeIndex === nodes.length - 1;
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: finalNode
      });
      await tx.approvalActionLog.create({
        data: {
          id: randomUUID(),
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          representedUserId: identity.representedUserId,
          approvedRoleKey: identity.approvedRoleKey,
          metadata: {
            fundExecutionApprovalStep: instance.currentNodeIndex + 1
          },
          comment: input.comment?.trim() || null,
          signatureFileIdSnapshot: signature.fileId,
          signatureSha256Snapshot: signature.sha256,
          signatureVersionIdSnapshot: signature.versionId
        }
      });
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          status: finalNode ? "approved" : "in_progress",
          currentNodeIndex: finalNode
            ? instance.currentNodeIndex
            : instance.currentNodeIndex + 1
        }
      });
      return { caseId, status: finalNode ? "approved" : "in_progress" };
    });
  }

  private async transition(
    actorUserId: string,
    input: FundExecutionCaseCommandInput | ReturnFundExecutionCaseInput,
    action: "submit_case" | "return_case" | "confirm_case"
  ) {
    const caseId = requiredText(input.caseId, "资金执行案件不能为空");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    assertRevision(input.expectedRevision);
    const returnReason =
      action === "return_case"
        ? requiredText(
            (input as ReturnFundExecutionCaseInput).reason,
            "退回原因不能为空"
          )
        : null;
    const payloadFingerprint = fundExecutionCommandFingerprint(action, {
      actorUserId,
      caseId,
      expectedRevision: input.expectedRevision,
      returnReason
    });
    return this.runSerializable(async (tx) => {
      await this.authorizeContext(tx, actorUserId, idempotencyKey, action);
      return this.receiptFirst(tx, {
        actorUserId,
        action,
        idempotencyKey,
        payloadFingerprint,
        execute: async () => {
          if (action === "submit_case") {
            await this.assertRole(tx, actorUserId, FINANCE_WRITER_ROLES);
          } else if (action === "confirm_case") {
            await this.assertRole(tx, actorUserId, ["finance_director"]);
          } else {
            await this.assertActiveUser(tx, actorUserId);
          }
          const predecessor = await this.lockLatestCase(
            tx,
            caseId,
            input.expectedRevision,
            action === "submit_case" ? "draft" : "submitted"
          );
          const predecessorSelections =
            await tx.fundExecutionCaseAxisSelection.findMany({
              where: { fundExecutionCaseId: predecessor.id },
              orderBy: [{ allocationLineNo: "asc" }, { axis: "asc" }]
            });
          if (!predecessorSelections.length) {
            throw new ConflictException("资金执行分类尚未完整冻结");
          }

          let approvalInstanceId: string | null = predecessor.approvalInstanceId;
          let freeze: ApprovalFreeze | null = null;
          if (action === "submit_case") {
            const approval = await tx.approvalInstance.create({
              data: {
                id: randomUUID(),
                flowType: "fund_execution_case.approve",
                businessType: "fund_execution_case",
                businessId: predecessor.caseKey,
                status: "in_progress",
                currentNodeIndex: 0,
                frozenNodes:
                  FUND_EXECUTION_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
                applicantUserId: actorUserId
              }
            });
            approvalInstanceId = approval.id;
          } else {
            if (!approvalInstanceId) {
              throw new ConflictException("资金执行案件缺少审批实例");
            }
            freeze = await this.freezeApproval(
              tx,
              approvalInstanceId,
              action === "confirm_case" ? "approve" : "return_to_applicant"
            );
            if (
              freeze.approvalFlowType !== "fund_execution_case.approve" ||
              freeze.approvalBusinessType !== "fund_execution_case" ||
              freeze.approvalBusinessId !== predecessor.caseKey ||
              (action === "confirm_case" &&
                freeze.approvalInstanceStatus !== "approved") ||
              (action === "return_case" &&
                freeze.approvalInstanceStatus !== "returned_to_applicant")
            ) {
              throw new ConflictException("资金执行审批绑定或状态不完整");
            }
            if (
              action === "return_case" &&
              (freeze.finalApprovalAction !== "return_to_applicant" ||
                freeze.finalApprovalActorUserId !== actorUserId)
            ) {
              throw new ConflictException("退回审批动作与当前操作人不一致");
            }
            if (
              action === "confirm_case" &&
              freeze.finalApprovalAction !== "approve"
            ) {
              throw new ConflictException("最终审批尚未通过");
            }
          }

          if (action === "confirm_case" && freeze) {
            const execution = await tx.fundExecution.findUnique({
              where: { id: predecessor.fundExecutionId }
            });
            if (!execution) throw new ConflictException("资金执行事实不存在");
            const [delegations, caseRevisions, approvalActions] =
              await Promise.all([
                this.activeDelegationEdges(tx, predecessor.caseKey),
                tx.fundExecutionCase.findMany({
                  where: { caseKey: predecessor.caseKey },
                  select: {
                    createdByUserId: true,
                    commandActorUserId: true,
                    submittedByUserId: true,
                    returnedByUserId: true
                  }
                }),
                tx.approvalActionLog.findMany({
                  where: { approvalInstanceId: predecessor.approvalInstanceId! },
                  select: { actorUserId: true, representedUserId: true }
                })
              ]);
            try {
              assertFundExecutionConfirmationSeparation({
                confirmerUserId: actorUserId,
                handledByUserId: execution.handledByUserId,
                paymentExecutedByUserId: execution.paymentExecutedByUserId,
                finalApprovalActorUserId: freeze.finalApprovalActorUserId,
                finalApprovalRepresentedUserId:
                  freeze.finalApprovalRepresentedUserId,
                caseParticipantUserIds: [
                  ...new Set(
                    caseRevisions.flatMap((revision) => [
                      revision.createdByUserId,
                      revision.commandActorUserId,
                      revision.submittedByUserId,
                      revision.returnedByUserId
                    ].filter((userId): userId is string => Boolean(userId)))
                  )
                ],
                approvalParticipantUserIds: [
                  ...new Set(
                    approvalActions.flatMap((approval) => [
                      approval.actorUserId,
                      approval.representedUserId
                    ].filter((userId): userId is string => Boolean(userId)))
                  )
                ],
                delegations
              });
            } catch (error) {
              throw new ForbiddenException(
                error instanceof Error ? error.message : "资金执行确认职责未分离"
              );
            }
          }

          const caseRow = await this.appendCaseRevision(tx, {
            predecessor,
            actorUserId,
            idempotencyKey,
            status:
              action === "submit_case"
                ? "submitted"
                : action === "confirm_case"
                  ? "confirmed"
                  : "draft",
            reason: predecessor.reason,
            action,
            approvalInstanceId,
            selections: predecessorSelections.map((selection) => ({
              lineNo: selection.allocationLineNo,
              axis: selection.axis as never,
              status: selection.status as never,
              amountCents: selection.amountCents,
              axisIdentity: selection.axisIdentity,
              optionSnapshot:
                selection.optionSnapshot as unknown as never,
              optionFingerprint: selection.optionFingerprint,
              consequencePlanSnapshot:
                selection.consequencePlanSnapshot as unknown as never,
              consequencePlanFingerprint:
                selection.consequencePlanFingerprint,
              originalAxisEffectId: selection.originalAxisEffectId,
              selectionRef: "copied"
            })),
            returnReason,
            freeze
          });
          if (action === "confirm_case") {
            await this.canonicalAdapter.materializeConfirmation(tx, {
              actorUserId,
              fundExecutionId: caseRow.fundExecutionId,
              fundExecutionCaseId: caseRow.id,
              auditRequestId: idempotencyKey
            });
          }
          const response = this.response(caseRow);
          await this.recordAudit(tx, actorUserId, action, response, {
            approvalInstanceIdFingerprint: approvalInstanceId
              ? fundExecutionCommandFingerprint(action, approvalInstanceId)
              : null,
            selectionCount: predecessorSelections.length,
            finalApprovalActionFingerprint:
              freeze?.finalApprovalActionFingerprint ?? null
          });
          return {
            response,
            fundExecutionId: caseRow.fundExecutionId,
            fundExecutionCaseId: caseRow.id,
            expectedRevision: input.expectedRevision
          };
        }
      });
    });
  }

  private async lockReversalSource(
    tx: Transaction,
    targetType: "payment_execution" | "fund_execution",
    targetExecutionId: string
  ): Promise<ReversalSource> {
    let direction: "inflow" | "outflow";
    let amountCents: bigint;
    let currencyCode: string;
    let holderCompanyEntityId: string;
    if (targetType === "payment_execution") {
      const [payment] = await tx.$queryRaw<
        Array<{ id: string; amountCents: bigint; holderCompanyEntityId: string }>
      >(Prisma.sql`
        SELECT payment."id", payment."amountCents",
               observation."holderCompanyEntityId"
        FROM "PaymentExecution" payment
        INNER JOIN "BankTransactionClaim" claim
          ON claim."paymentExecutionId" = payment."id"
         AND claim."targetType" = 'payment_execution'
        INNER JOIN "VerifiedBankTransactionObservation" observation
          ON observation."id" = claim."observationId"
        WHERE payment."id" = ${targetExecutionId}
        FOR UPDATE
      `);
      if (!payment) {
        throw new ConflictException(
          "原付款执行没有共享银行认领，不能进入反向流程"
        );
      }
      direction = "outflow";
      amountCents = payment.amountCents;
      currencyCode = "CNY";
      holderCompanyEntityId = payment.holderCompanyEntityId;
    } else {
      const [execution] = await tx.$queryRaw<
        Array<{
          id: string;
          direction: string;
          amountCents: bigint;
          currencyCode: string;
          executionKind: string;
          holderCompanyEntityId: string;
        }>
      >(Prisma.sql`
        SELECT execution."id", execution."direction", execution."amountCents",
               execution."currencyCode", execution."executionKind",
               observation."holderCompanyEntityId"
        FROM "FundExecution" execution
        INNER JOIN "BankTransactionClaim" claim
          ON claim."fundExecutionId" = execution."id"
         AND claim."targetType" = 'fund_execution'
        INNER JOIN "VerifiedBankTransactionObservation" observation
          ON observation."id" = claim."observationId"
        WHERE execution."id" = ${targetExecutionId}
        FOR UPDATE
      `);
      if (
        !execution ||
        execution.executionKind !== "bank_transaction" ||
        (execution.direction !== "inflow" && execution.direction !== "outflow")
      ) {
        throw new ConflictException("原资金执行不存在或不是可反向的正式执行");
      }
      direction = execution.direction;
      amountCents = execution.amountCents;
      currencyCode = execution.currencyCode;
      holderCompanyEntityId = execution.holderCompanyEntityId;
    }

    const [reversed] = await tx.$queryRaw<Array<{ amountCents: bigint }>>(
      targetType === "payment_execution"
        ? Prisma.sql`
            SELECT COALESCE(SUM(reverse_execution."amountCents"), 0)::BIGINT AS "amountCents"
            FROM "FundExecution" reverse_execution
            WHERE reverse_execution."reversesPaymentExecutionId" = ${targetExecutionId}
          `
        : Prisma.sql`
            SELECT COALESCE(SUM(reverse_execution."amountCents"), 0)::BIGINT AS "amountCents"
            FROM "FundExecution" reverse_execution
            WHERE reverse_execution."reversesFundExecutionId" = ${targetExecutionId}
          `
    );
    const alreadyReversedAmountCents = reversed?.amountCents ?? 0n;
    const remainingAmountCents = amountCents - alreadyReversedAmountCents;
    if (remainingAmountCents <= 0n) {
      throw new ConflictException("原资金执行已无可反向余额");
    }

    const lines = await tx.$queryRaw<ReversalLine[]>(
      targetType === "payment_execution"
        ? Prisma.sql`
            SELECT line."id", line."lineNo", line."direction",
                   line."amountCents", line."currencyCode", line."businessType",
                   line."businessId", line."sourceIdentity", line."sliceIdentity"
            FROM "ExecutionAllocationLine" line
            WHERE line."paymentExecutionId" = ${targetExecutionId}
              AND line."executionType" = 'payment_execution'
              AND line."reversalOfAllocationLineId" IS NULL
            ORDER BY line."lineNo", line."id"
            FOR UPDATE
          `
        : Prisma.sql`
            SELECT line."id", line."lineNo", line."direction",
                   line."amountCents", line."currencyCode", line."businessType",
                   line."businessId", line."sourceIdentity", line."sliceIdentity"
            FROM "ExecutionAllocationLine" line
            INNER JOIN "FundExecutionCase" case_row
              ON case_row."id" = line."fundExecutionCaseId"
             AND case_row."status" = 'confirmed'
            WHERE line."fundExecutionId" = ${targetExecutionId}
              AND line."executionType" = 'fund_execution'
              AND line."reversalOfAllocationLineId" IS NULL
            ORDER BY line."lineNo", line."id"
            FOR UPDATE OF line
          `
    );
    if (
      !lines.length ||
      lines.some(
        (line) =>
          line.direction !== direction ||
          line.currencyCode !== currencyCode ||
          line.amountCents <= 0n
      ) ||
      lines.reduce((total, line) => total + line.amountCents, 0n) !== amountCents
    ) {
      throw new ConflictException("原资金执行的共享分配不完整");
    }
    const lineIds = lines.map(({ id }) => id);
    const effects = await tx.$queryRaw<ReversalEffect[]>(Prisma.sql`
      SELECT effect."id", effect."executionAllocationLineId", effect."axis",
             effect."axisIdentity", effect."status", effect."amountCents"
      FROM "ExecutionAllocationAxisEffect" effect
      WHERE effect."executionAllocationLineId" IN (${Prisma.join(lineIds)})
      ORDER BY effect."executionAllocationLineId", effect."axis"
      FOR UPDATE
    `);
    if (
      effects.length !== lines.length * 4 ||
      lines.some((line) => {
        const lineEffects = effects.filter(
          (effect) => effect.executionAllocationLineId === line.id
        );
        return (
          lineEffects.length !== 4 ||
          EXECUTION_ALLOCATION_AXES.some(
            (axis) => !lineEffects.some((effect) => effect.axis === axis)
          )
        );
      })
    ) {
      throw new ConflictException("原资金执行未冻结完整四轴");
    }
    const effectIds = effects.map(({ id }) => id);
    const consequences = await tx.$queryRaw<ReversalConsequence[]>(Prisma.sql`
      SELECT consequence."id", consequence."axisEffectId",
             consequence."sequence", consequence."consequenceType",
             consequence."consequenceIdentity", consequence."sliceIdentity",
             consequence."amountCents", consequence."consequenceFingerprint"
      FROM "ExecutionAllocationConsequence" consequence
      WHERE consequence."axisEffectId" IN (${Prisma.join(effectIds)})
      ORDER BY consequence."axisEffectId", consequence."sequence"
      FOR UPDATE
    `);
    if (
      effects.some((effect) => {
        const materialized = consequences.filter(
          (consequence) => consequence.axisEffectId === effect.id
        );
        return effect.status === "not_applicable"
          ? effect.amountCents !== 0n || materialized.length !== 0
          : effect.status !== "applied" ||
              effect.amountCents <= 0n ||
              materialized.length === 0 ||
              materialized.reduce(
                (total, consequence) => total + consequence.amountCents,
                0n
              ) !== effect.amountCents;
      })
    ) {
      throw new ConflictException("原资金执行逐轴正式后果不完整");
    }
    return {
      direction,
      originalAmountCents: amountCents,
      alreadyReversedAmountCents,
      remainingAmountCents,
      currencyCode,
      holderCompanyEntityId,
      lines,
      effects,
      consequences
    };
  }

  private async buildReversalDraftSelections(
    tx: Transaction,
    source: ReversalSource,
    direction: "inflow" | "outflow",
    reverseAmountCents: bigint
  ): Promise<readonly ReversalDraftSelection[]> {
    const selections: ReversalDraftSelection[] = [];
    let offset = source.alreadyReversedAmountCents;
    let remaining = reverseAmountCents;
    for (const line of [...source.lines].sort(
      (left, right) => left.lineNo - right.lineNo || left.id.localeCompare(right.id)
    )) {
      const lineOffset = offset < line.amountCents ? offset : line.amountCents;
      offset -= lineOffset;
      const available = line.amountCents - lineOffset;
      const selectedAmountCents = remaining < available ? remaining : available;
      remaining -= selectedAmountCents;
      if (selectedAmountCents <= 0n) continue;
      const projectId = await this.reversalLineProjectId(tx, line.id);
      const allocationLineId = randomUUID();
      const reversePlans = planReverseExecutionAxisEffects(
        EXECUTION_ALLOCATION_AXES.map((axis) => {
          const effect = source.effects.find(
            (candidate) =>
              candidate.executionAllocationLineId === line.id &&
              candidate.axis === axis
          );
          if (!effect) {
            throw new ConflictException("原资金执行缺少逐轴冻结事实");
          }
          return {
            id: effect.id,
            axis,
            status: effect.status as "applied" | "not_applicable",
            amountCents: effect.amountCents,
            consequences: source.consequences
              .filter((consequence) => consequence.axisEffectId === effect.id)
              .sort((left, right) => left.sequence - right.sequence)
          };
        }),
        selectedAmountCents,
        lineOffset
      );
      for (const axis of EXECUTION_ALLOCATION_AXES) {
        const effect = source.effects.find(
          (candidate) =>
            candidate.executionAllocationLineId === line.id &&
            candidate.axis === axis
        );
        if (!effect) throw new ConflictException("原资金执行缺少逐轴冻结事实");
        const reversePlan = reversePlans.find((plan) => plan.axis === axis);
        if (!reversePlan) throw new ConflictException("反向逐轴切片计划不完整");
        const optionSnapshot = {
          version: 1,
          axis,
          status: reversePlan.status,
          axisIdentity: effect.axisIdentity,
          line: {
            lineNo: line.lineNo,
            allocationLineId,
            direction,
            amountCents: selectedAmountCents.toString(),
            currencyCode: line.currencyCode,
            businessType: line.businessType,
            businessId: line.businessId,
            sourceIdentity: line.sourceIdentity,
            sliceIdentity: line.sliceIdentity,
            projectId
          },
          canonical: {
            reversalOfAllocationLineId: line.id,
            originalAxisEffectId: effect.id,
            originalConsequenceIds: reversePlan.consequences.map(
              ({ originalConsequenceId }) => originalConsequenceId
            )
          }
        } as const;
        const consequencePlanSnapshot = reversePlan.consequences.map(
          (consequence) => ({
            sequence: consequence.sequence,
            consequenceType: consequence.consequenceType,
            consequenceIdentity: consequence.consequenceIdentity,
            sliceIdentity: consequence.sliceIdentity,
            amountCents: consequence.amountCents.toString(),
            originalConsequenceId: consequence.originalConsequenceId
          })
        );
        selections.push({
          lineNo: line.lineNo,
          axis,
          status: reversePlan.status,
          amountCents: reversePlan.amountCents,
          axisIdentity: effect.axisIdentity,
          optionSnapshot: optionSnapshot as unknown as Prisma.InputJsonValue,
          optionFingerprint: await this.jsonbFingerprint(tx, optionSnapshot),
          consequencePlanSnapshot:
            consequencePlanSnapshot as unknown as Prisma.InputJsonValue,
          consequencePlanFingerprint: await this.jsonbFingerprint(
            tx,
            consequencePlanSnapshot
          ),
          originalAxisEffectId: effect.id
        });
      }
    }
    if (remaining !== 0n) {
      throw new ConflictException("反向金额未完整映射到原共享分配行");
    }
    return selections;
  }

  private async reversalLineProjectId(tx: Transaction, lineId: string) {
    const rows = await tx.$queryRaw<Array<{ projectId: string }>>(Prisma.sql`
      SELECT DISTINCT coordinates."projectId"
      FROM (
        SELECT COALESCE(
          project_fund."projectId",
          payable."beneficiaryProjectId",
          relationship."projectId",
          operating."projectId"
        ) AS "projectId"
        FROM "ExecutionAllocationAxisEffect" effect
        INNER JOIN "ExecutionAllocationConsequence" consequence
          ON consequence."axisEffectId" = effect."id"
        LEFT JOIN "ProjectFundingAllocation" project_fund
          ON project_fund."id" = consequence."projectFundingAllocationId"
        LEFT JOIN "PayableSettlementAllocation" payable
          ON payable."id" = consequence."payableSettlementAllocationId"
        LEFT JOIN "InterEntityRelationshipEntry" relationship
          ON relationship."id" = consequence."interEntityRelationshipEntryId"
        LEFT JOIN "OperatingFact" operating
          ON operating."id" = consequence."operatingFactId"
        WHERE effect."executionAllocationLineId" = ${lineId}
      ) coordinates
      WHERE coordinates."projectId" IS NOT NULL
      ORDER BY coordinates."projectId"
    `);
    if (rows.length !== 1) {
      throw new ConflictException("原共享分配行的项目归属不唯一");
    }
    return rows[0]!.projectId;
  }

  private async jsonbFingerprint(tx: Transaction, value: unknown) {
    const [row] = await tx.$queryRaw<Array<{ fingerprint: string }>>(Prisma.sql`
      SELECT encode(public.digest(
        ${JSON.stringify(value)}::JSONB::TEXT,
        'sha256'
      ), 'hex') AS fingerprint
    `);
    if (!row?.fingerprint) throw new ConflictException("冻结快照哈希失败");
    return row.fingerprint;
  }

  private async appendCaseRevision(
    tx: Transaction,
    input: Readonly<{
      predecessor: Awaited<ReturnType<FundExecutionService["lockLatestCase"]>>;
      actorUserId: string;
      idempotencyKey: string;
      status: "draft" | "submitted" | "confirmed";
      reason: string;
      action: "update_case" | "submit_case" | "return_case" | "confirm_case";
      approvalInstanceId: string | null;
      selections: readonly Readonly<{
        lineNo: number;
        axis: string;
        status: string;
        amountCents: bigint;
        axisIdentity: string;
        optionSnapshot: unknown;
        optionFingerprint: string;
        consequencePlanSnapshot: unknown;
        consequencePlanFingerprint: string;
        originalAxisEffectId: string | null;
      }>[];
      returnReason?: string | null;
      freeze?: ApprovalFreeze | null;
    }>
  ) {
    const revision = input.predecessor.revision + 1;
    const id = randomUUID();
    const now = new Date();
    const selectionFingerprints = input.selections.map((selection) => ({
      lineNo: selection.lineNo,
      axis: selection.axis,
      optionFingerprint: selection.optionFingerprint,
      consequencePlanFingerprint: selection.consequencePlanFingerprint
    }));
    const caseRow = await tx.fundExecutionCase.create({
      data: {
        id,
        caseKey: input.predecessor.caseKey,
        fundExecutionId: input.predecessor.fundExecutionId,
        revision,
        status: input.status,
        predecessorCaseId: input.predecessor.id,
        returnedFromCaseId:
          input.action === "return_case" ? input.predecessor.id : null,
        approvalInstanceId: input.approvalInstanceId,
        reason: input.reason,
        ...(input.freeze
          ? {
              approvalInstanceSnapshot:
                input.freeze.approvalInstanceSnapshot as Prisma.InputJsonValue,
              approvalInstanceFingerprint:
                input.freeze.approvalInstanceFingerprint,
              approvalActionLogSnapshot:
                input.freeze.approvalActionLogSnapshot as Prisma.InputJsonValue,
              approvalActionLogCount: input.freeze.approvalActionLogCount,
              approvalActionLogFingerprint:
                input.freeze.approvalActionLogFingerprint,
              finalApprovalActionLogId:
                input.freeze.finalApprovalActionLogId,
              finalApprovalActionFingerprint:
                input.freeze.finalApprovalActionFingerprint
            }
          : {}),
        payloadFingerprint: this.caseFingerprint({
          caseKey: input.predecessor.caseKey,
          fundExecutionId: input.predecessor.fundExecutionId,
          revision,
          status: input.status,
          reason: input.reason,
          predecessorCaseId: input.predecessor.id,
          selectionFingerprints
        }),
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.predecessor.createdByUserId,
        commandActorUserId: input.actorUserId,
        submittedByUserId:
          input.action === "submit_case"
            ? input.actorUserId
            : input.predecessor.submittedByUserId,
        submittedAt:
          input.action === "submit_case" ? now : input.predecessor.submittedAt,
        returnedByUserId:
          input.action === "return_case" ? input.actorUserId : null,
        returnedAt: input.action === "return_case" ? now : null,
        returnReason:
          input.action === "return_case" ? input.returnReason : null,
        confirmedByUserId:
          input.action === "confirm_case" ? input.actorUserId : null,
        confirmedAt: input.action === "confirm_case" ? now : null,
        auditAction: input.action,
        auditRequestId: input.idempotencyKey,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });
    await tx.fundExecutionCaseAxisSelection.createMany({
      data: input.selections.map((selection) => ({
        id: randomUUID(),
        fundExecutionCaseId: id,
        allocationLineNo: selection.lineNo,
        axis: selection.axis,
        status: selection.status,
        amountCents: selection.amountCents,
        axisIdentity: selection.axisIdentity,
        selectionSource: selection.originalAxisEffectId
          ? "reversal_copy"
          : "business_selection",
        originalAxisEffectId: selection.originalAxisEffectId,
        optionSnapshot: selection.optionSnapshot as Prisma.InputJsonValue,
        optionFingerprint: selection.optionFingerprint,
        consequencePlanSnapshot:
          selection.consequencePlanSnapshot as Prisma.InputJsonValue,
        consequencePlanFingerprint: selection.consequencePlanFingerprint,
        createdByUserId: input.actorUserId,
        auditRequestId: input.idempotencyKey,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }))
    });
    return caseRow;
  }

  private async receiptFirst<TResponse>(
    tx: Transaction,
    input: Readonly<{
      actorUserId: string;
      action: FundExecutionCommandAction;
      idempotencyKey: string;
      payloadFingerprint: string;
      execute: () => Promise<ReceiptExecution<TResponse>>;
    }>
  ): Promise<TResponse> {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fund_execution:${input.idempotencyKey}`}, 0))`
    );
    const existing = await tx.fundExecutionCommandReceipt.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (existing) {
      if (
        existing.action !== input.action ||
        existing.payloadFingerprint !== input.payloadFingerprint ||
        existing.createdByUserId !== input.actorUserId
      ) {
        throw new ConflictException("幂等键已被其他资金执行命令占用");
      }
      return existing.responseSnapshot as TResponse;
    }
    const executed = await input.execute();
    await tx.fundExecutionCommandReceipt.create({
      data: {
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        payloadFingerprint: input.payloadFingerprint,
        action: input.action,
        fundExecutionId: executed.fundExecutionId,
        fundExecutionCaseId: executed.fundExecutionCaseId,
        expectedRevision: executed.expectedRevision,
        responseSnapshot: executed.response as Prisma.InputJsonValue,
        createdByUserId: input.actorUserId,
        auditRequestId: input.idempotencyKey,
        createdTransactionId: 0n,
        createdBackendPid: 0
      }
    });
    // Prisma interactive transactions can otherwise surface a successful
    // callback before a deferred PostgreSQL contract rejects COMMIT. Force the
    // aggregate contracts while the callback can still fail closed.
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    return executed.response;
  }

  private async authorizeContext(
    tx: Transaction,
    actorUserId: string,
    requestId: string,
    action: FundExecutionCommandAction
  ) {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
    if (!secret) {
      throw new ForbiddenException("资金执行受控写入密钥未配置");
    }
    await tx.$executeRaw(
      Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${actorUserId}, ${secret})`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_actor', ${actorUserId}, true)`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_request_id', ${requestId}, true)`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_action', ${action}, true)`
    );
  }

  private async lockLatestCase(
    tx: Transaction,
    caseKey: string,
    expectedRevision?: number,
    expectedStatus?: string
  ) {
    const [row] = await tx.$queryRaw<
      Array<{
        id: string;
        caseKey: string;
        fundExecutionId: string;
        revision: number;
        status: string;
        reason: string;
        approvalInstanceId: string | null;
        createdByUserId: string;
        submittedByUserId: string | null;
        submittedAt: Date | null;
        auditAction: string;
        payloadFingerprint: string;
      }>
    >(Prisma.sql`
      SELECT case_row."id", case_row."caseKey", case_row."fundExecutionId",
             case_row."revision", case_row."status", case_row."reason",
             case_row."approvalInstanceId", case_row."createdByUserId",
             case_row."submittedByUserId", case_row."submittedAt",
             case_row."auditAction", case_row."payloadFingerprint"
      FROM "FundExecutionCase" case_row
      WHERE case_row."caseKey" = ${caseKey}
      ORDER BY case_row."revision" DESC
      LIMIT 1
      FOR UPDATE
    `);
    if (!row) throw new NotFoundException("资金执行案件不存在");
    if (
      (expectedRevision !== undefined && row.revision !== expectedRevision) ||
      (expectedStatus !== undefined && row.status !== expectedStatus)
    ) {
      throw new ConflictException("资金执行案件版本或状态已变化，请刷新后重试");
    }
    return row;
  }

  private async freezeApproval(
    tx: Transaction,
    approvalInstanceId: string,
    expectedFinalAction: "approve" | "return_to_applicant"
  ): Promise<ApprovalFreeze> {
    const [row] = await tx.$queryRaw<Array<ApprovalFreeze>>(Prisma.sql`
      SELECT instance."status" AS "approvalInstanceStatus",
             instance."flowType" AS "approvalFlowType",
             instance."businessType" AS "approvalBusinessType",
             instance."businessId" AS "approvalBusinessId",
             to_jsonb(instance) AS "approvalInstanceSnapshot",
             encode(public.digest(to_jsonb(instance)::TEXT, 'sha256'), 'hex')
               AS "approvalInstanceFingerprint",
             logs.snapshot AS "approvalActionLogSnapshot",
             logs.count AS "approvalActionLogCount",
             encode(public.digest(logs.snapshot::TEXT, 'sha256'), 'hex')
               AS "approvalActionLogFingerprint",
             final_action."id" AS "finalApprovalActionLogId",
             encode(public.digest(to_jsonb(final_action)::TEXT, 'sha256'), 'hex')
               AS "finalApprovalActionFingerprint",
             final_action."actorUserId" AS "finalApprovalActorUserId",
             final_action."representedUserId" AS "finalApprovalRepresentedUserId",
             final_action."action" AS "finalApprovalAction"
      FROM "ApprovalInstance" instance
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(to_jsonb(action_log)
                 ORDER BY action_log."createdAt", action_log."id"), '[]'::JSONB) AS snapshot,
               COUNT(*)::INTEGER AS count
        FROM "ApprovalActionLog" action_log
        WHERE action_log."approvalInstanceId" = instance."id"
      ) logs
      CROSS JOIN LATERAL (
        SELECT action_log.*
        FROM "ApprovalActionLog" action_log
        WHERE action_log."approvalInstanceId" = instance."id"
          AND action_log."action" = ${expectedFinalAction}
          AND (${expectedFinalAction} <> 'approve'
            OR action_log."approvedRoleKey" IN ('chairman', 'general_manager'))
        ORDER BY action_log."createdAt" DESC, action_log."id" DESC
        LIMIT 1
      ) final_action
      WHERE instance."id" = ${approvalInstanceId}
      FOR UPDATE OF instance
    `);
    if (!row) throw new ConflictException("审批动作证据不完整");
    return row;
  }

  private async assertRole(
    tx: Transaction,
    actorUserId: string,
    roleKeys: readonly string[]
  ) {
    const [actor] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT user_row."id"
      FROM "User" user_row
      WHERE user_row."id" = ${actorUserId}
        AND user_row."isActive" = TRUE
        AND EXISTS (
          SELECT 1
          FROM "UserPosition" user_position
          INNER JOIN "Position" position
            ON position."id" = user_position."positionId"
          WHERE user_position."userId" = user_row."id"
            AND user_position."projectId" IS NULL
            AND position."key" IN (${Prisma.join(roleKeys)})
        )
      FOR KEY SHARE
    `);
    if (!actor) throw new ForbiddenException("当前用户没有资金执行操作权限");
  }

  private async assertActiveUser(tx: Transaction, actorUserId: string) {
    const user = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { isActive: true }
    });
    if (!user?.isActive) throw new ForbiddenException("当前用户已停用");
  }

  private async assertReader(
    tx: Transaction,
    actorUserId: string,
    caseId?: string
  ) {
    await this.assertActiveUser(tx, actorUserId);
    const actorRoles = await this.globalRoleKeys(tx, actorUserId);
    if (actorRoles.some((role) => FUND_EXECUTION_READ_ROLES.has(role))) return;
    const delegations = await this.activeDelegationsTo(tx, actorUserId, caseId);
    for (const delegation of delegations) {
      const delegatorRoles = await this.globalRoleKeys(tx, delegation.fromUserId);
      if (
        delegatorRoles.some((role) =>
          ["finance_director", "chairman", "general_manager"].includes(role)
        )
      ) {
        return;
      }
    }
    throw new ForbiddenException("当前用户没有资金执行案件查看权限");
  }

  private async globalRoleKeys(tx: Transaction, actorUserId: string) {
    const rows = await tx.$queryRaw<Array<{ key: RoleKey }>>(Prisma.sql`
      SELECT DISTINCT position."key" AS key
      FROM "UserPosition" user_position
      INNER JOIN "Position" position ON position."id" = user_position."positionId"
      INNER JOIN "User" user_row ON user_row."id" = user_position."userId"
      WHERE user_position."userId" = ${actorUserId}
        AND user_position."projectId" IS NULL
        AND user_row."isActive" = TRUE
      ORDER BY position."key"
    `);
    return rows.map(({ key }) => key);
  }

  private async activeDelegationsTo(
    tx: Transaction,
    actorUserId: string,
    caseId?: string
  ) {
    const now = new Date();
    const delegations = await tx.approvalDelegation.findMany({
      where: {
        toUserId: actorUserId,
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [
          { actionKey: null, resourceType: null, resourceId: null },
          {
            actionKey: "fund_execution_case.approve",
            resourceType: "fund_execution_case",
            resourceId: caseId ?? { not: null }
          }
        ]
      },
      select: { fromUserId: true, toUserId: true, resourceId: true }
    });
    if (!delegations.length) return [];
    const activeUsers = await tx.user.findMany({
      where: {
        id: {
          in: Array.from(
            new Set([
              actorUserId,
              ...delegations.flatMap(({ fromUserId, toUserId }) => [
                fromUserId,
                toUserId
              ])
            ])
          )
        },
        isActive: true
      },
      select: { id: true }
    });
    const activeUserIds = new Set(activeUsers.map(({ id }) => id));
    if (!activeUserIds.has(actorUserId)) return [];
    return delegations.filter(
      ({ fromUserId, toUserId }) =>
        activeUserIds.has(fromUserId) && activeUserIds.has(toUserId)
    );
  }

  private async activeDelegationEdges(
    tx: Transaction,
    caseId: string
  ): Promise<readonly FundExecutionApprovalDelegation[]> {
    const now = new Date();
    const delegations = await tx.approvalDelegation.findMany({
      where: {
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [
          { actionKey: null, resourceType: null, resourceId: null },
          {
            actionKey: "fund_execution_case.approve",
            resourceType: "fund_execution_case",
            resourceId: caseId
          }
        ]
      },
      select: { fromUserId: true, toUserId: true }
    });
    if (!delegations.length) return [];
    const activeUsers = await tx.user.findMany({
      where: {
        id: {
          in: Array.from(
            new Set(
              delegations.flatMap(({ fromUserId, toUserId }) => [
                fromUserId,
                toUserId
              ])
            )
          )
        },
        isActive: true
      },
      select: { id: true }
    });
    const activeUserIds = new Set(activeUsers.map(({ id }) => id));
    return delegations.filter(
      ({ fromUserId, toUserId }) =>
        activeUserIds.has(fromUserId) && activeUserIds.has(toUserId)
    );
  }

  private async recordAudit(
    tx: Transaction,
    actorUserId: string,
    action: FundExecutionCommandAction,
    response: FundExecutionCommandResponse,
    metadata: Record<string, unknown>
  ) {
    await this.audit.record(tx, {
      actorUserId,
      action: `fund_execution.${action}`,
      businessType: "fund_execution_case",
      businessId: response.caseId,
      metadata: {
        ...metadata,
        revision: response.revision,
        status: response.status,
        fundExecutionFingerprint: fundExecutionCommandFingerprint(
          action,
          response.fundExecutionId
        )
      } as Prisma.InputJsonObject
    });
  }

  private response(caseRow: {
    caseKey: string;
    fundExecutionId: string;
    status: string;
    revision: number;
    approvalInstanceId: string | null;
  }): FundExecutionCommandResponse {
    return {
      caseId: caseRow.caseKey,
      fundExecutionId: caseRow.fundExecutionId,
      status: caseRow.status,
      revision: caseRow.revision,
      approvalInstanceId: caseRow.approvalInstanceId
    };
  }

  private caseFingerprint(payload: unknown) {
    return fundExecutionCommandFingerprint("update_case", payload);
  }

  private async runSerializable<T>(work: (tx: Transaction) => Promise<T>) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        if (!isRefreshableConcurrencyError(error) || attempt === 3) {
          if (isRefreshableConcurrencyError(error)) {
            throw new ConflictException({
              statusCode: 409,
              code: "FUND_EXECUTION_REFRESH_REQUIRED",
              message: "资金执行状态已并发变化，请刷新后重试"
            });
          }
          throw error;
        }
      }
    }
    throw new ConflictException("资金执行状态已并发变化，请刷新后重试");
  }
}

function executionSummary(input: {
  executionKind: string;
  direction: string;
  amountCents: bigint;
  currencyCode: string;
  occurredAt: Date;
}) {
  const kind = input.executionKind === "reversal" ? "反向执行" : "资金执行";
  const direction = input.direction === "inflow" ? "入账" : "出账";
  return `${kind} · ${direction} · ${input.currencyCode} ${formatMoneyCents(input.amountCents)} · ${input.occurredAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
}

function formatMoneyCents(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function publicClassificationLines(
  selections: readonly {
    allocationLineNo: number;
    axis: string;
    status: string;
    amountCents: bigint;
  }[]
) {
  const byLine = new Map<number, typeof selections[number][]>();
  for (const selection of selections) {
    const group = byLine.get(selection.allocationLineNo) ?? [];
    group.push(selection);
    byLine.set(selection.allocationLineNo, group);
  }
  return [...byLine]
    .sort(([left], [right]) => left - right)
    .map(([lineNo, lineSelections]) => {
      if (
        lineSelections.length !== EXECUTION_ALLOCATION_AXES.length ||
        EXECUTION_ALLOCATION_AXES.some(
          (axis) =>
            lineSelections.filter((selection) => selection.axis === axis)
              .length !== 1
        )
      ) {
        throw new ConflictException("资金执行案件的四轴分类证据不完整");
      }
      const applied = lineSelections.filter(
        (selection) => selection.status === "applied"
      );
      const lineAmount = applied[0]?.amountCents ?? 0n;
      if (
        applied.some((selection) => selection.amountCents !== lineAmount) ||
        lineSelections.some(
          (selection) =>
            selection.status === "not_applicable" && selection.amountCents !== 0n
        )
      ) {
        throw new ConflictException("资金执行案件的四轴分类金额不一致");
      }
      return {
        lineNo,
        amountCents: lineAmount.toString(),
        axes: EXECUTION_ALLOCATION_AXES.map((axis) => {
          const selection = lineSelections.find(
            (candidate) => candidate.axis === axis
          )!;
          return {
            axis,
            status: selection.status,
            summary: publicAxisSummary(axis, selection.status)
          };
        })
      };
    });
}

function publicAxisSummary(axis: string, status: string) {
  const labels: Record<string, string> = {
    payable: "应付核销",
    project_fund: "项目资金",
    relationship: "往来关系",
    operating: "经营投影"
  };
  const label = labels[axis] ?? "业务分类";
  return status === "applied" ? `${label}已生效` : `${label}不适用`;
}

function approvalStatusLabel(status: string | null) {
  if (status === "in_progress") return "审批中";
  if (status === "approved") return "审批通过";
  if (status === "returned_to_applicant") return "已退回申请人";
  return null;
}

function fundExecutionCaseActions(input: {
  status: string;
  isReversal: boolean;
  hasCompleteClassification: boolean;
  canReview: boolean;
  canAppendReturnedDraft: boolean;
  canConfirm: boolean;
}) {
  const action = (
    key: string,
    label: string,
    enabled: boolean,
    disabledReason: string
  ) => ({
    key,
    label,
    enabled,
    disabledReason: enabled ? null : disabledReason
  });
  return [
    action(
      "update_case",
      input.isReversal ? "修改反向原因" : "修改分类",
      input.status === "draft",
      "只有草稿可以修改"
    ),
    action(
      "submit_case",
      "提交审批",
      input.status === "draft" && input.hasCompleteClassification,
      "必须先冻结完整四轴分类"
    ),
    action(
      "return_case",
      "生成退回修改稿",
      input.status === "submitted" && input.canAppendReturnedDraft,
      "只有完成退回审批动作的操作人可以生成修改稿"
    ),
    action(
      "confirm_case",
      "确认进入正式账",
      input.status === "submitted" && input.canConfirm,
      "最终审批通过后由不同的全局财务负责人确认"
    ),
    action(
      "approve",
      "审批通过",
      input.status === "submitted" && input.canReview,
      "当前用户不是冻结审批节点的处理人"
    ),
    action(
      "return_approval",
      "退回申请人",
      input.status === "submitted" && input.canReview,
      "当前用户不是冻结审批节点的处理人"
    )
  ];
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(message);
  }
  return value.trim();
}

function requiredUuid(value: unknown) {
  const normalized = requiredText(value, "资金执行请求格式不正确");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)) {
    throw new BadRequestException("资金执行请求格式不正确");
  }
  return normalized;
}

function assertRevision(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException("资金执行案件修订号无效");
  }
}

function oppositeDirection(direction: "inflow" | "outflow") {
  return direction === "inflow" ? ("outflow" as const) : ("inflow" as const);
}

function jsonArray(value: Prisma.JsonValue): Prisma.JsonValue[] {
  if (!Array.isArray(value)) throw new ConflictException("冻结审批路线无效");
  return value;
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException("冻结审批节点无效");
  }
  return value as Record<string, unknown>;
}

function isRefreshableConcurrencyError(error: unknown) {
  const code =
    error && typeof error === "object"
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const databaseCode =
    error && typeof error === "object"
      ? String((error as { meta?: { code?: unknown } }).meta?.code ?? "")
      : "";
  const message = error instanceof Error ? error.message : "";
  return (
    code === "40001" ||
    code === "40P01" ||
    code === "P2034" ||
    databaseCode === "40001" ||
    databaseCode === "40P01" ||
    /40001|40P01|deadlock|serialization/iu.test(message)
  );
}
