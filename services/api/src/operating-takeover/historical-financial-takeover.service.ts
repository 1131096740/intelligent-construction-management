import { randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, type RoleKey as SharedRoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import {
  HistoricalFinancialTakeoverAdapter,
  type HistoricalFinancialTakeoverMapping,
  type HistoricalFinancialTakeoverRow,
  type HistoricalFundMovementTarget,
  type HistoricalPayableTarget,
  type HistoricalPaymentExecutionTarget,
  type HistoricalRelationshipTarget,
  type HistoricalSettlementAllocationTarget
} from "./historical-financial-takeover.adapter";
import {
  type CompensateHistoricalFinancialTakeoverDto,
  type HistoricalFinancialTakeoverCommandDto,
  type HistoricalFinancialTakeoverRowInput,
  type PrepareHistoricalFinancialTakeoverDto
} from "./historical-financial-takeover.dto";
import { canonicalize, fingerprint } from "./operating-takeover.utils";

type Tx = Prisma.TransactionClient;
type ResolvedMapping = {
  mapping: HistoricalFinancialTakeoverMapping;
  readSetFingerprint: string;
};
export type HistoricalFinancialPrepareResult = {
  batchId: string;
  projectId: string;
  status: string;
  revision: number;
  asOfDate: string;
  manifestFingerprint: string;
  readSetFingerprint: string;
  rowCount: number;
  decisions: Array<HistoricalFinancialTakeoverMapping["decision"] | "SKIP">;
};

@Injectable()
export class HistoricalFinancialTakeoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ProjectVisibilityService,
    private readonly adapter: HistoricalFinancialTakeoverAdapter,
    private readonly audit: AuditService = new AuditService()
  ) {}

  async prepare(
    projectId: string,
    actorUserId: string,
    input: PrepareHistoricalFinancialTakeoverDto
  ): Promise<HistoricalFinancialPrepareResult> {
    assertHistoricalFinancialTakeoverWriteAllowed("prepare");
    if (input.expectedRevision !== 0) throw new ConflictException("新建历史应付与资金 manifest 的 expectedRevision 必须为 0");
    if (!input.rows.length) throw new ConflictException("历史应付与资金 manifest 至少需要一行");
    const roles = await this.authorize(projectId, actorUserId, "operating_takeover.manage");
    if (!roles.includes("contract_director") && !roles.includes("finance_director")) {
      throw new ForbiddenException("只有合同部负责人或财务负责人可以创建历史应付与资金 manifest");
    }
    const asOfDate = dateOnly(input.asOfDate);
    const candidateBaselineSha = exactCandidateSha();
    const commandFingerprint = fingerprint({ action: "prepare", projectId, actorUserId, input });

    return this.serializable<HistoricalFinancialPrepareResult>(async (tx) => {
      const replay = await this.replay<HistoricalFinancialPrepareResult>(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      await this.assertProject(tx, projectId);
      const resolved: ResolvedMapping[] = [];
      for (const row of input.rows) {
        resolved.push(await this.resolveRow(tx, projectId, asOfDate, row));
      }
      const decisions = await this.resolveDuplicateDecisions(tx, projectId, resolved);
      const sourceSetFingerprint = fingerprint(resolved.map(({ mapping }) => ({
        sourceDuplicateGroupKey: mapping.sourceDuplicateGroupKey,
        normalizedRowHash: mapping.normalizedRowHash
      })));
      const readSetFingerprint = fingerprint(resolved.map((item) => item.readSetFingerprint));
      const manifestFingerprint = fingerprint(resolved.map(({ mapping }, index) => ({
        rowNo: index + 1,
        mappingFingerprint: mapping.mappingFingerprint,
        decision: decisions[index]
      })));
      const permissionSnapshotFingerprint = fingerprint({ projectId, actorUserId, roles: [...roles].sort() });
      const batchId = randomUUID();
      const batch = await tx.historicalFinancialTakeoverBatch.create({
        data: {
          id: batchId,
          projectId,
          asOfDate,
          status: "prepared",
          revision: 1,
          candidateBaselineSha,
          sourceSetFingerprint,
          readSetFingerprint,
          manifestFingerprint,
          permissionSnapshotFingerprint,
          createdByUserId: actorUserId
        }
      });
      for (const [index, item] of resolved.entries()) {
        const mapping = item.mapping;
        await tx.historicalFinancialTakeoverRowMapping.create({
          data: {
            id: randomUUID(),
            batchId,
            projectId,
            rowNo: index + 1,
            sourceType: mapping.sourceType,
            sourceBusinessId: mapping.sourceBusinessId,
            sourceVersion: mapping.sourceVersion,
            sourceCoordinate: mapping.sourceCoordinate,
            normalizedRowHash: mapping.normalizedRowHash,
            kind: mapping.kind,
            evidenceLevel: mapping.evidenceLevel,
            amountCents: mapping.amountCents,
            currencyCode: mapping.currencyCode,
            asOfDate: mapping.asOfDate,
            mappingDecision: decisions[index],
            targetKind: mapping.targetKind,
            targetRef: mapping.targetRef,
            targetFingerprint: mapping.targetFingerprint,
            targetSnapshot: jsonInput(mapping.targetSnapshot),
            sourceDuplicateGroupKey: mapping.sourceDuplicateGroupKey,
            bankDuplicateGroupKey: mapping.bankDuplicateGroupKey,
            payableDuplicateGroupKey: mapping.payableDuplicateGroupKey,
            movementDuplicateGroupKey: mapping.movementDuplicateGroupKey,
            openingBalanceDuplicateGroupKey: mapping.openingBalanceDuplicateGroupKey,
            conflictGroupKeys: jsonInput(mapping.conflictGroupKeys),
            legacyProjectProxyPaymentId: mapping.legacyDedupeRefs.projectProxyPaymentId,
            legacyProjectAffiliatePaymentFactId: mapping.legacyDedupeRefs.projectAffiliatePaymentFactId,
            readSetFingerprint: item.readSetFingerprint,
            mappingFingerprint: mapping.mappingFingerprint,
            projectionStatus: "applied_inactive",
            newPaymentAllowed: false,
            settlementAllocationAllowed: false
          }
        });
      }
      const result = {
        batchId,
        projectId,
        status: batch.status,
        revision: batch.revision,
        asOfDate: asOfDate.toISOString().slice(0, 10),
        manifestFingerprint,
        readSetFingerprint,
        rowCount: resolved.length,
        decisions
      };
      await this.writeReceipt(tx, {
        batchId,
        idempotencyKey: input.idempotencyKey,
        action: "prepare",
        expectedRevision: 0,
        actorUserId,
        commandFingerprint,
        status: "prepared",
        result
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "operating_takeover.historical_financial.prepare",
        businessType: "historical_financial_takeover_batch",
        businessId: batchId,
        metadata: jsonInput({ manifestFingerprint, readSetFingerprint, rowCount: resolved.length })
      });
      return result;
    });
  }

  async applyInactive(projectId: string, batchId: string, actorUserId: string, input: HistoricalFinancialTakeoverCommandDto) {
    assertHistoricalFinancialTakeoverWriteAllowed("apply_inactive");
    await this.authorize(projectId, actorUserId, "operating_takeover.manage");
    return this.transition(projectId, batchId, actorUserId, input, {
      action: "apply_inactive",
      fromStatus: "prepared",
      toStatus: "applied_inactive",
      fromRevision: 1,
      toRevision: 2,
      auditAction: "operating_takeover.historical_financial.apply_inactive",
      update: { appliedByUserId: actorUserId, appliedAt: new Date() }
    });
  }

  async attest(projectId: string, batchId: string, actorUserId: string, input: HistoricalFinancialTakeoverCommandDto) {
    assertHistoricalFinancialTakeoverWriteAllowed("attest");
    const roles = await this.authorize(projectId, actorUserId, "operating_takeover.confirm");
    if (!roles.includes("finance_director")) throw new ForbiddenException("历史应付与资金复核必须由财务负责人完成");
    return this.transition(projectId, batchId, actorUserId, input, {
      action: "attest",
      fromStatus: "applied_inactive",
      toStatus: "attested",
      fromRevision: 2,
      toRevision: 3,
      auditAction: "operating_takeover.historical_financial.attest",
      assertActor: (batch) => {
        if (batch.appliedByUserId === actorUserId) throw new ConflictException("inactive apply 与财务复核必须由不同人员完成");
      },
      update: { attestedByUserId: actorUserId, attestedAt: new Date() }
    });
  }

  async activate(projectId: string, batchId: string, actorUserId: string, input: HistoricalFinancialTakeoverCommandDto) {
    assertHistoricalFinancialTakeoverWriteAllowed("activate");
    await this.authorize(projectId, actorUserId, "operating_takeover.activate");
    const commandFingerprint = fingerprint({ action: "activate", projectId, batchId, actorUserId, input });
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const batch = await this.lockBatch(tx, projectId, batchId);
      this.assertCommand(batch, input, "attested", 3);
      if (batch.attestedByUserId === actorUserId) throw new ConflictException("激活人与财务复核人必须分离");
      const revalidated = await this.revalidate(tx, batch);
      const applyReceipt = await this.requiredReceipt(tx, batchId, "apply_inactive");
      const attestationReceipt = await this.requiredReceipt(tx, batchId, "attest");
      const result = {
        batchId,
        projectId,
        status: "activated",
        revision: 4,
        manifestFingerprint: batch.manifestFingerprint,
        activeFormalRows: batch.rows.filter((row) => !["GAP", "SKIP"].includes(row.mappingDecision)).length,
        unresolvedGapRows: batch.rows.filter((row) => row.mappingDecision === "GAP").length
      };
      const activationReceipt = await this.writeReceipt(tx, {
        batchId,
        idempotencyKey: input.idempotencyKey,
        action: "activate",
        expectedRevision: 3,
        actorUserId,
        commandFingerprint,
        status: "activated",
        result,
        causesReceiptId: attestationReceipt.id
      });
      const activationFingerprint = fingerprint({
        batchId,
        manifestFingerprint: batch.manifestFingerprint,
        readSetFingerprint: revalidated,
        applyReceiptId: applyReceipt.id,
        attestationReceiptId: attestationReceipt.id,
        activationReceiptId: activationReceipt.id
      });
      await tx.historicalFinancialTakeoverActivation.create({
        data: {
          id: randomUUID(),
          batchId,
          applyReceiptId: applyReceipt.id,
          attestationReceiptId: attestationReceipt.id,
          activationReceiptId: activationReceipt.id,
          manifestFingerprint: batch.manifestFingerprint,
          preActivationReadSetFingerprint: revalidated,
          activationFingerprint,
          activatedByUserId: actorUserId
        }
      });
      await tx.historicalFinancialTakeoverBatch.update({
        where: { id: batchId },
        data: { status: "activated", revision: 4 }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "operating_takeover.historical_financial.activate",
        businessType: "historical_financial_takeover_batch",
        businessId: batchId,
        metadata: jsonInput({ activationFingerprint, manifestFingerprint: batch.manifestFingerprint })
      });
      return result;
    });
  }

  async compensate(projectId: string, batchId: string, actorUserId: string, input: CompensateHistoricalFinancialTakeoverDto) {
    assertHistoricalFinancialTakeoverWriteAllowed("compensate");
    await this.authorize(projectId, actorUserId, "operating_takeover.activate");
    if (input.reason.trim().length < 5) throw new ConflictException("补偿原因至少需要 5 个字符");
    const commandFingerprint = fingerprint({ action: "compensate", projectId, batchId, actorUserId, input });
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const batch = await this.lockBatch(tx, projectId, batchId);
      this.assertCommand(batch, input, "activated", 4);
      if (!batch.activation || batch.compensation) throw new ConflictException("批次不存在可补偿的唯一激活记录");
      const activeRows = batch.rows
        .filter((row) => !["GAP", "SKIP"].includes(row.mappingDecision))
        .sort((left, right) => right.rowNo - left.rowNo);
      const reverseCausalitySnapshot = activeRows.map((row, index) => ({
        reverseOrdinal: index + 1,
        causesRowId: row.id,
        causesRowNo: row.rowNo,
        targetKind: row.targetKind,
        targetRef: row.targetRef,
        targetFingerprint: row.targetFingerprint,
        direction: "revoke_takeover_eligibility"
      }));
      const result = {
        batchId,
        projectId,
        status: "compensated",
        revision: 5,
        reversedRows: reverseCausalitySnapshot.length
      };
      const activationReceipt = await this.requiredReceipt(tx, batchId, "activate");
      const receipt = await this.writeReceipt(tx, {
        batchId,
        idempotencyKey: input.idempotencyKey,
        action: "compensate",
        expectedRevision: 4,
        actorUserId,
        commandFingerprint,
        status: "compensated",
        result,
        causesReceiptId: activationReceipt.id
      });
      const compensationFingerprint = fingerprint({
        activationFingerprint: batch.activation.activationFingerprint,
        reason: input.reason.trim(),
        reverseCausalitySnapshot
      });
      await tx.historicalFinancialTakeoverCompensation.create({
        data: {
          id: randomUUID(),
          batchId,
          activationId: batch.activation.id,
          compensationReceiptId: receipt.id,
          reason: input.reason.trim(),
          reverseCausalitySnapshot: jsonInput(reverseCausalitySnapshot),
          compensationFingerprint,
          compensatedByUserId: actorUserId
        }
      });
      await tx.historicalFinancialTakeoverBatch.update({
        where: { id: batchId },
        data: { status: "compensated", revision: 5 }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "operating_takeover.historical_financial.compensate",
        businessType: "historical_financial_takeover_batch",
        businessId: batchId,
        metadata: jsonInput({ compensationFingerprint, reversedRows: reverseCausalitySnapshot.length })
      });
      return result;
    });
  }

  async detail(projectId: string, batchId: string, actorUserId: string) {
    const roles = await this.authorize(projectId, actorUserId, "operating_takeover.manage");
    const batch = await this.prisma.historicalFinancialTakeoverBatch.findFirst({
      where: { id: batchId, projectId },
      include: {
        rows: { orderBy: { rowNo: "asc" } },
        receipts: { orderBy: { createdAt: "asc" } },
        activation: true,
        compensation: true
      }
    });
    if (!batch) throw new NotFoundException("历史应付与资金接管批次不存在");
    return serializeHistoricalFinancialTakeoverBatch(batch, canPerform("wage_sensitive_read", roles));
  }

  async list(projectId: string, actorUserId: string) {
    await this.authorize(projectId, actorUserId, "operating_takeover.manage");
    const batches = await this.prisma.historicalFinancialTakeoverBatch.findMany({
      where: { projectId },
      include: { rows: { select: { evidenceLevel: true, mappingDecision: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    });
    return batches.map((batch) => ({
      id: batch.id,
      projectId: batch.projectId,
      asOfDate: batch.asOfDate.toISOString().slice(0, 10),
      status: batch.status,
      revision: batch.revision,
      manifestFingerprint: batch.manifestFingerprint,
      totalRows: batch.rows.length,
      levelARows: batch.rows.filter((row) => row.evidenceLevel === "A").length,
      levelBRows: batch.rows.filter((row) => row.evidenceLevel === "B").length,
      gapRows: batch.rows.filter((row) => row.mappingDecision === "GAP").length,
      blockedRows: batch.rows.filter((row) => row.mappingDecision === "BLOCK").length,
      createdAt: batch.createdAt.toISOString()
    }));
  }

  async activeProjection(projectId: string, actorUserId: string) {
    const roles = await this.authorize(projectId, actorUserId, "operating_takeover.manage");
    assertHistoricalFinancialTakeoverProjectionReadAllowed(roles);
    const batches = await this.prisma.historicalFinancialTakeoverBatch.findMany({
      where: { projectId, status: "activated", activation: { isNot: null }, compensation: { is: null } },
      include: { rows: { orderBy: { rowNo: "asc" } }, activation: true },
      orderBy: { createdAt: "asc" }
    });
    return batches.flatMap((batch) => batch.rows
      .filter((row) => !["GAP", "SKIP"].includes(row.mappingDecision))
      .map((row) => ({
        batchId: batch.id,
        activationId: batch.activation!.id,
        rowId: row.id,
        rowNo: row.rowNo,
        evidenceLevel: row.evidenceLevel,
        mappingDecision: row.mappingDecision,
        targetKind: row.targetKind,
        targetRef: row.targetRef,
        targetSnapshot: row.targetSnapshot,
        amountCents: row.amountCents.toString(),
        currencyCode: row.currencyCode,
        asOfDate: row.asOfDate.toISOString().slice(0, 10),
        newPaymentAllowed: false,
        settlementAllocationAllowed: false
      })));
  }

  private async transition(
    projectId: string,
    batchId: string,
    actorUserId: string,
    input: HistoricalFinancialTakeoverCommandDto,
    config: {
      action: "apply_inactive" | "attest";
      fromStatus: string;
      toStatus: string;
      fromRevision: number;
      toRevision: number;
      auditAction: string;
      assertActor?: (batch: Awaited<ReturnType<HistoricalFinancialTakeoverService["lockBatch"]>>) => void;
      update: Record<string, unknown>;
    }
  ) {
    const commandFingerprint = fingerprint({ action: config.action, projectId, batchId, actorUserId, input });
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const batch = await this.lockBatch(tx, projectId, batchId);
      this.assertCommand(batch, input, config.fromStatus, config.fromRevision);
      config.assertActor?.(batch);
      const readSetFingerprint = await this.revalidate(tx, batch);
      const cause = await this.requiredReceipt(tx, batchId, config.action === "apply_inactive" ? "prepare" : "apply_inactive");
      const result = {
        batchId,
        projectId,
        status: config.toStatus,
        revision: config.toRevision,
        manifestFingerprint: batch.manifestFingerprint,
        readSetFingerprint
      };
      await this.writeReceipt(tx, {
        batchId,
        idempotencyKey: input.idempotencyKey,
        action: config.action,
        expectedRevision: config.fromRevision,
        actorUserId,
        commandFingerprint,
        status: config.toStatus,
        result,
        causesReceiptId: cause.id
      });
      await tx.historicalFinancialTakeoverBatch.update({
        where: { id: batchId },
        data: { status: config.toStatus, revision: config.toRevision, ...config.update }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: config.auditAction,
        businessType: "historical_financial_takeover_batch",
        businessId: batchId,
        metadata: jsonInput({ manifestFingerprint: batch.manifestFingerprint, readSetFingerprint })
      });
      return result;
    });
  }

  private async resolveRow(
    tx: Tx,
    projectId: string,
    asOfDate: Date,
    input: HistoricalFinancialTakeoverRowInput
  ): Promise<ResolvedMapping> {
    const legacySnapshots = await this.legacyDedupeSnapshots(tx, projectId, input);
    const common = {
      projectId,
      sourceType: input.sourceType.trim(),
      sourceBusinessId: input.sourceBusinessId.trim(),
      sourceVersion: input.sourceVersion,
      sourceCoordinate: input.sourceCoordinate.trim(),
      normalizedRowHash: input.normalizedRowHash.toLowerCase(),
      kind: input.kind,
      evidenceLevel: input.evidenceLevel,
      amountCents: BigInt(input.amountCents),
      currencyCode: input.currencyCode?.trim() || "CNY",
      asOfDate,
      gapReason: input.gapReason,
      legacyDedupeRefs: {
        projectProxyPaymentId: input.legacyProjectProxyPaymentId,
        projectAffiliatePaymentFactId: input.legacyProjectAffiliatePaymentFactId
      }
    } satisfies Omit<HistoricalFinancialTakeoverRow, "paymentExecution" | "payable" | "settlementAllocation" | "relationship" | "fundMovement" | "openingBalance">;

    let targetReadSet: unknown = null;
    let row: HistoricalFinancialTakeoverRow;
    if (input.evidenceLevel === "B") {
      if (!input.openingBalance) throw new ConflictException("B 级期初余额缺少受控毛额快照");
      row = {
        ...common,
        openingBalance: { ...input.openingBalance, grossAmountCents: BigInt(input.openingBalance.grossAmountCents) }
      };
    } else if (input.evidenceLevel === "C") {
      row = common;
    } else {
      if (!input.targetRef?.trim()) throw new ConflictException("A 级逐笔历史行必须选择服务端正式 target");
      const target = await this.loadCanonicalTarget(tx, projectId, input.kind, input.targetRef.trim());
      targetReadSet = target.readSet;
      row = { ...common, ...target.row };
    }
    const mapping = this.adapter.map(row);
    const readSetFingerprint = fingerprint({
      mappingFingerprint: mapping.mappingFingerprint,
      targetReadSet,
      legacySnapshots
    });
    return { mapping, readSetFingerprint };
  }

  private async loadCanonicalTarget(tx: Tx, projectId: string, kind: string, targetRef: string): Promise<{
    row: Partial<HistoricalFinancialTakeoverRow>;
    readSet: unknown;
  }> {
    if (kind === "payment_execution") {
      const payment = await tx.paymentExecution.findUnique({
        where: { id: targetRef },
        select: {
          id: true,
          idempotencyKey: true,
          paymentRequestId: true,
          voucherFileId: true,
          amountCents: true,
          paidAt: true,
          companyEntityIdSnapshot: true
        }
      });
      if (!payment) throw new NotFoundException("既有 PaymentExecution 不存在");
      const request = await tx.paymentRequest.findUnique({ where: { id: payment.paymentRequestId }, select: { projectId: true, status: true } });
      if (!request || request.projectId !== projectId || !["paid", "partially_paid"].includes(request.status)) {
        throw new ConflictException("PaymentExecution 不属于当前项目或付款请求状态不具备正式权威");
      }
      const target: HistoricalPaymentExecutionTarget = {
        id: payment.id,
        idempotencyKey: payment.idempotencyKey,
        voucherFileId: payment.voucherFileId,
        amountCents: payment.amountCents,
        paidAt: payment.paidAt,
        payerCompanyEntityId: payment.companyEntityIdSnapshot
      };
      return { row: { paymentExecution: target }, readSet: { payment: target, request } };
    }

    if (kind === "payable") {
      const payable = await tx.wagePayableRef.findUnique({
        where: { id: targetRef },
        include: {
          confirmedVersion: { select: { status: true } },
          creditorBreakdown: { select: { creditorSubjectType: true, creditorSubjectIdentityKey: true } }
        }
      });
      if (!payable) {
        const prohibited = await tx.historicalWageSummaryPayableRef.findUnique({ where: { id: targetRef }, select: { usageScope: true, newPaymentAllowed: true } });
        if (prohibited) throw new ConflictException("HistoricalWageSummaryPayableRef 仅限 historical_reconciliation_only，不得成为新付款或核销来源");
        throw new NotFoundException("封闭应付注册表中不存在该 payable ref");
      }
      if (payable.projectId !== projectId || payable.confirmedVersion.status !== "confirmed" ||
          !payable.creditorBreakdown.creditorSubjectType || !payable.creditorBreakdown.creditorSubjectIdentityKey) {
        throw new ConflictException("payable ref 不属于当前项目或其工资版本尚未确认");
      }
      const target: HistoricalPayableTarget = {
        payableRef: payable.id,
        sourceType: "wage_payable_ref",
        sourceAggregateId: payable.confirmedVersionId,
        sourceLineId: payable.id,
        confirmedVersionId: payable.confirmedVersionId,
        debtorCompanyId: payable.debtorCompanyId,
        payeeSubjectType: payable.creditorBreakdown.creditorSubjectType,
        payeeSubjectId: payable.creditorBreakdown.creditorSubjectIdentityKey,
        beneficiaryProjectId: payable.projectId,
        grossAmountCents: payable.amountCents
      };
      return { row: { payable: target }, readSet: target };
    }

    if (kind === "settlement_allocation") {
      const allocation = await tx.payableSettlementAllocation.findUnique({
        where: { id: targetRef },
        include: {
          settlementCase: { select: { id: true, status: true, revision: true } },
          paymentExecution: {
            select: {
              id: true,
              idempotencyKey: true,
              voucherFileId: true,
              amountCents: true,
              paidAt: true,
              companyEntityIdSnapshot: true,
              paymentRequestId: true
            }
          }
        }
      });
      const paymentRequest = allocation?.paymentExecution
        ? await tx.paymentRequest.findUnique({
            where: { id: allocation.paymentExecution.paymentRequestId },
            select: { projectId: true, status: true }
          })
        : null;
      if (!allocation || !allocation.settlementCase || allocation.settlementCase.status !== "confirmed" ||
          !allocation.paymentExecution || !paymentRequest || paymentRequest.projectId !== projectId ||
          allocation.beneficiaryProjectId !== projectId || !["paid", "partially_paid"].includes(paymentRequest.status)) {
        throw new ConflictException("当前项目不存在已确认且绑定既有 PaymentExecution 的正式核销分配");
      }
      const target: HistoricalSettlementAllocationTarget = {
        id: allocation.id,
        settlementCaseId: allocation.settlementCase.id,
        paymentExecutionId: allocation.paymentExecution.id,
        payableRef: allocation.payableRef,
        sourceType: allocation.sourceType,
        sourceAggregateId: allocation.sourceAggregateId,
        sourceLineId: allocation.sourceLineId,
        confirmedVersionId: allocation.confirmedVersionId,
        debtorCompanyId: allocation.debtorCompanyId,
        payeeSubjectType: allocation.payeeSubjectType,
        payeeSubjectId: allocation.payeeSubjectId,
        beneficiaryProjectId: allocation.beneficiaryProjectId,
        amountCents: allocation.amountCents,
        currencyCode: allocation.currencyCode,
        paymentIdempotencyKey: allocation.paymentExecution.idempotencyKey,
        paymentVoucherFileId: allocation.paymentExecution.voucherFileId,
        paymentPaidAt: allocation.paymentExecution.paidAt,
        payerCompanyEntityId: allocation.paymentExecution.companyEntityIdSnapshot
      };
      return { row: { settlementAllocation: target }, readSet: { allocation, paymentRequest, target } };
    }

    if (kind === "inter_entity_relationship") {
      const payableRelationship = await tx.interEntityRelationshipEntry.findUnique({
        where: { id: targetRef },
        select: {
          id: true,
          status: true,
          projectId: true,
          originalDebtorCompanyId: true,
          creditorCompanyId: true,
          amountCents: true,
          currencyCode: true,
          payloadFingerprint: true
        }
      });
      if (payableRelationship) {
        if (payableRelationship.status !== "confirmed" || payableRelationship.projectId !== projectId) {
          throw new ConflictException("既有往来尚未确认或不属于当前项目");
        }
        const target: HistoricalRelationshipTarget = {
          id: payableRelationship.id,
          payloadFingerprint: payableRelationship.payloadFingerprint,
          originalDebtorCompanyId: payableRelationship.originalDebtorCompanyId,
          creditorCompanyId: payableRelationship.creditorCompanyId,
          amountCents: payableRelationship.amountCents,
          currencyCode: payableRelationship.currencyCode
        };
        return { row: { relationship: target }, readSet: payableRelationship };
      }
      const movementRelationship = await tx.fundMovementRelationshipEntry.findUnique({
        where: { id: targetRef },
        select: {
          id: true,
          status: true,
          sourceProjectId: true,
          beneficiaryProjectId: true,
          debtorCompanyEntityId: true,
          creditorCompanyEntityId: true,
          amountCents: true,
          currencyCode: true,
          payloadFingerprint: true
        }
      });
      if (!movementRelationship || movementRelationship.status !== "confirmed" ||
          (movementRelationship.sourceProjectId !== projectId && movementRelationship.beneficiaryProjectId !== projectId)) {
        throw new NotFoundException("当前项目不存在已确认的正式往来 target");
      }
      const target: HistoricalRelationshipTarget = {
        id: movementRelationship.id,
        payloadFingerprint: movementRelationship.payloadFingerprint,
        originalDebtorCompanyId: movementRelationship.debtorCompanyEntityId,
        creditorCompanyId: movementRelationship.creditorCompanyEntityId,
        amountCents: movementRelationship.amountCents,
        currencyCode: movementRelationship.currencyCode
      };
      return { row: { relationship: target }, readSet: movementRelationship };
    }

    if (kind === "fund_movement") {
      const movement = await tx.fundMovement.findUnique({
        where: { id: targetRef },
        select: {
          id: true,
          status: true,
          payloadFingerprint: true,
          sourceProjectId: true,
          beneficiaryProjectId: true,
          sourceCompanyEntityId: true,
          beneficiaryCompanyEntityId: true,
          paymentAmountCents: true,
          paymentExecutionId: true
        }
      });
      if (!movement || movement.status !== "confirmed" || (movement.sourceProjectId !== projectId && movement.beneficiaryProjectId !== projectId)) {
        throw new NotFoundException("当前项目不存在已确认的 fund movement target");
      }
      const target: HistoricalFundMovementTarget = {
        id: movement.id,
        payloadFingerprint: movement.payloadFingerprint,
        sourceProjectId: movement.sourceProjectId,
        beneficiaryProjectId: movement.beneficiaryProjectId,
        sourceCompanyEntityId: movement.sourceCompanyEntityId,
        beneficiaryCompanyEntityId: movement.beneficiaryCompanyEntityId,
        amountCents: movement.paymentAmountCents,
        paymentExecutionId: movement.paymentExecutionId
      };
      let paymentExecution: HistoricalPaymentExecutionTarget | undefined;
      let paymentReadSet: unknown = null;
      if (movement.paymentExecutionId) {
        const loaded = await this.loadCanonicalTarget(tx, projectId, "payment_execution", movement.paymentExecutionId);
        paymentExecution = loaded.row.paymentExecution;
        paymentReadSet = loaded.readSet;
      }
      return { row: { fundMovement: target, ...(paymentExecution ? { paymentExecution } : {}) }, readSet: { movement, paymentReadSet } };
    }
    throw new ConflictException("A 级逐笔事实不能使用 opening_balance kind");
  }

  private async legacyDedupeSnapshots(tx: Tx, projectId: string, input: HistoricalFinancialTakeoverRowInput) {
    const proxy = input.legacyProjectProxyPaymentId
      ? await tx.projectProxyPayment.findUnique({
          where: { id: input.legacyProjectProxyPaymentId },
          select: { id: true, projectId: true, paidAt: true, amountCents: true, voucherFileId: true, voidedAt: true }
        })
      : null;
    const affiliate = input.legacyProjectAffiliatePaymentFactId
      ? await tx.projectAffiliatePaymentFact.findUnique({
          where: { id: input.legacyProjectAffiliatePaymentFactId },
          select: { id: true, projectId: true, paidAt: true, amountCents: true, evidenceFileId: true, status: true, requestFingerprint: true }
        })
      : null;
    if (input.legacyProjectProxyPaymentId && (!proxy || proxy.projectId !== projectId)) {
      throw new ConflictException("ProjectProxyPayment 去重来源不存在或不属于当前项目");
    }
    if (input.legacyProjectAffiliatePaymentFactId && (!affiliate || affiliate.projectId !== projectId)) {
      throw new ConflictException("ProjectAffiliatePaymentFact 去重来源不存在或不属于当前项目");
    }
    return { proxy, affiliate };
  }

  private async resolveDuplicateDecisions(tx: Tx, projectId: string, rows: ResolvedMapping[]) {
    const all = rows.flatMap((row) => row.mapping.conflictGroupKeys);
    const source = rows.map((row) => row.mapping.sourceDuplicateGroupKey);
    const banks = rows.flatMap((row) => row.mapping.bankDuplicateGroupKey ? [row.mapping.bankDuplicateGroupKey] : []);
    const payables = rows.flatMap((row) => row.mapping.payableDuplicateGroupKey ? [row.mapping.payableDuplicateGroupKey] : []);
    const movements = rows.flatMap((row) => row.mapping.movementDuplicateGroupKey ? [row.mapping.movementDuplicateGroupKey] : []);
    const openings = rows.flatMap((row) => row.mapping.openingBalanceDuplicateGroupKey ? [row.mapping.openingBalanceDuplicateGroupKey] : []);
    const existing = all.length ? await tx.historicalFinancialTakeoverRowMapping.findMany({
      where: {
        projectId,
        batch: { status: { not: "compensated" } },
        OR: [
          { sourceDuplicateGroupKey: { in: source } },
          ...(banks.length ? [{ bankDuplicateGroupKey: { in: banks } }] : []),
          ...(payables.length ? [{ payableDuplicateGroupKey: { in: payables } }] : []),
          ...(movements.length ? [{ movementDuplicateGroupKey: { in: movements } }] : []),
          ...(openings.length ? [{ openingBalanceDuplicateGroupKey: { in: openings } }] : [])
        ]
      }
    }) : [];
    const accepted: HistoricalFinancialTakeoverMapping[] = [];
    return rows.map(({ mapping }) => {
      const collisions = [...existing, ...accepted].filter((candidate) =>
        conflictKeys(candidate).some((key) => mapping.conflictGroupKeys.includes(key))
      );
      if (!collisions.length) {
        accepted.push(mapping);
        return mapping.decision;
      }
      if (collisions.every((candidate) => equivalentTarget(candidate, mapping))) {
        accepted.push(mapping);
        return "SKIP" as const;
      }
      if (collisions.every((candidate) => equivalentTarget(candidate, mapping) || causallyCompatible(candidate, mapping))) {
        accepted.push(mapping);
        return mapping.decision;
      }
      throw new ConflictException("历史来源、银行交易、应付或 movement duplicate group 存在关键冲突，整组阻断");
    });
  }

  private async revalidate(tx: Tx, batch: Awaited<ReturnType<HistoricalFinancialTakeoverService["lockBatch"]>>) {
    if (batch.candidateBaselineSha.toLowerCase() !== exactCandidateSha().toLowerCase()) {
      throw new ConflictException("运行候选 SHA 已变化，历史接管 manifest 必须重新生成");
    }
    const resolved: ResolvedMapping[] = [];
    for (const row of batch.rows) {
      const snapshot = object(row.targetSnapshot);
      const input: HistoricalFinancialTakeoverRowInput = {
        sourceType: row.sourceType,
        sourceBusinessId: row.sourceBusinessId,
        sourceVersion: row.sourceVersion,
        sourceCoordinate: row.sourceCoordinate,
        normalizedRowHash: row.normalizedRowHash,
        kind: row.kind as HistoricalFinancialTakeoverRowInput["kind"],
        evidenceLevel: row.evidenceLevel as HistoricalFinancialTakeoverRowInput["evidenceLevel"],
        amountCents: row.amountCents.toString(),
        currencyCode: row.currencyCode,
        ...(row.targetRef && row.evidenceLevel === "A" ? { targetRef: row.targetRef } : {}),
        ...(row.evidenceLevel === "B" ? {
          openingBalance: {
            axis: String(snapshot.axis) as "payable" | "relationship" | "fund",
            subjectKey: String(snapshot.subjectKey),
            counterpartyKey: String(snapshot.counterpartyKey),
            categoryCode: String(snapshot.categoryCode),
            period: String(snapshot.period),
            grossAmountCents: String(snapshot.grossAmountCents),
            evidenceReference: String(snapshot.evidenceReference)
          }
        } : {}),
        ...(row.evidenceLevel === "C" ? { gapReason: String(snapshot.gapReason) } : {}),
        ...(row.legacyProjectProxyPaymentId ? { legacyProjectProxyPaymentId: row.legacyProjectProxyPaymentId } : {}),
        ...(row.legacyProjectAffiliatePaymentFactId ? { legacyProjectAffiliatePaymentFactId: row.legacyProjectAffiliatePaymentFactId } : {})
      };
      const current = await this.resolveRow(tx, batch.projectId, batch.asOfDate, input);
      if (current.mapping.mappingFingerprint !== row.mappingFingerprint || current.readSetFingerprint !== row.readSetFingerprint) {
        throw new ConflictException(`第 ${row.rowNo} 行权威 read-set 已漂移，拒绝继续`);
      }
      resolved.push(current);
    }
    const readSetFingerprint = fingerprint(resolved.map((item) => item.readSetFingerprint));
    if (readSetFingerprint !== batch.readSetFingerprint) throw new ConflictException("历史接管 read-set fingerprint 已漂移");
    return readSetFingerprint;
  }

  private async authorize(projectId: string, actorUserId: string, action: "operating_takeover.manage" | "operating_takeover.confirm" | "operating_takeover.activate") {
    const roles = await this.visibility.effectiveRoleKeys(actorUserId, projectId);
    if (!canPerform(action, roles)) throw new ForbiddenException("当前人员没有历史经营接管权限");
    return roles as SharedRoleKey[];
  }

  private async assertProject(tx: Tx, projectId: string) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, isActive: true } });
    if (!project?.isActive) throw new NotFoundException("项目不存在或已停用");
  }

  private async lockBatch(tx: Tx, projectId: string, batchId: string) {
    await tx.$queryRaw`SELECT "id" FROM "HistoricalFinancialTakeoverBatch" WHERE "id" = ${batchId} FOR UPDATE`;
    const batch = await tx.historicalFinancialTakeoverBatch.findFirst({
      where: { id: batchId, projectId },
      include: {
        rows: { orderBy: { rowNo: "asc" } },
        activation: true,
        compensation: true
      }
    });
    if (!batch) throw new NotFoundException("历史应付与资金接管批次不存在");
    return batch;
  }

  private assertCommand(
    batch: Awaited<ReturnType<HistoricalFinancialTakeoverService["lockBatch"]>>,
    input: HistoricalFinancialTakeoverCommandDto,
    status: string,
    revision: number
  ) {
    if (batch.status !== status || batch.revision !== revision || input.expectedRevision !== revision) {
      throw new ConflictException("批次状态或版本已变化，请刷新后重试");
    }
    if (input.manifestFingerprint !== batch.manifestFingerprint) {
      throw new ConflictException("dry-run manifest fingerprint 已漂移，拒绝继续");
    }
  }

  private async replay<T>(tx: Tx, idempotencyKey: string, commandFingerprint: string): Promise<T | null> {
    const receipt = await tx.historicalFinancialTakeoverCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== commandFingerprint) throw new ConflictException("幂等键已用于不同历史接管命令");
    return receipt.resultSnapshot as T;
  }

  private async requiredReceipt(tx: Tx, batchId: string, action: string) {
    const receipt = await tx.historicalFinancialTakeoverCommandReceipt.findFirst({
      where: { batchId, action },
      orderBy: { createdAt: "desc" }
    });
    if (!receipt) throw new ConflictException(`批次缺少 ${action} 因果凭据`);
    return receipt;
  }

  private async writeReceipt(tx: Tx, input: {
    batchId: string;
    idempotencyKey: string;
    action: "prepare" | "apply_inactive" | "attest" | "activate" | "compensate";
    expectedRevision: number;
    actorUserId: string;
    commandFingerprint: string;
    status: string;
    result: Record<string, unknown>;
    causesReceiptId?: string;
  }) {
    const causalityFingerprint = fingerprint({
      batchId: input.batchId,
      action: input.action,
      expectedRevision: input.expectedRevision,
      actorUserId: input.actorUserId,
      commandFingerprint: input.commandFingerprint,
      result: input.result,
      causesReceiptId: input.causesReceiptId ?? null
    });
    return tx.historicalFinancialTakeoverCommandReceipt.create({
      data: {
        id: randomUUID(),
        batchId: input.batchId,
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        expectedRevision: input.expectedRevision,
        actorUserId: input.actorUserId,
        fingerprint: input.commandFingerprint,
        status: input.status,
        resultSnapshot: jsonInput(input.result),
        causalityFingerprint,
        causesReceiptId: input.causesReceiptId
      }
    });
  }

  private serializable<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function exactCandidateSha(): string {
  const value = process.env.BUILD_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
  if (!value || !/^[0-9a-f]{40}$/i.test(value)) throw new ConflictException("历史接管缺少精确候选 SHA，必须失败关闭");
  return value;
}

export function assertHistoricalFinancialTakeoverWriteAllowed(
  action: "prepare" | "apply_inactive" | "attest" | "activate" | "compensate",
  environment = process.env.NODE_ENV
) {
  if (environment === "production") {
    throw new ForbiddenException(`POL-224 ${action} 未获独立生产授权，生产写命令默认关闭`);
  }
}

export function assertHistoricalFinancialTakeoverProjectionReadAllowed(roles: readonly SharedRoleKey[]) {
  if (!canPerform("payable_settlement.read", roles)) {
    throw new ForbiddenException("历史应付与资金正式投影只允许财务岗位读取");
  }
}

function dateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ConflictException("历史接管基准日必须为 YYYY-MM-DD");
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new ConflictException("历史接管基准日无效");
  return result;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return canonicalize(value) as Prisma.InputJsonValue;
}

function object(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function conflictKeys(candidate: {
  sourceDuplicateGroupKey: string;
  bankDuplicateGroupKey: string | null;
  payableDuplicateGroupKey: string | null;
  movementDuplicateGroupKey: string | null;
  openingBalanceDuplicateGroupKey: string | null;
}) {
  return [
    candidate.sourceDuplicateGroupKey,
    candidate.bankDuplicateGroupKey,
    candidate.payableDuplicateGroupKey,
    candidate.movementDuplicateGroupKey,
    candidate.openingBalanceDuplicateGroupKey
  ].filter((value): value is string => value !== null);
}

function equivalentTarget(candidate: {
  sourceDuplicateGroupKey: string;
  targetKind: string | null;
  targetRef: string | null;
  targetFingerprint: string | null;
  mappingFingerprint: string;
}, mapping: HistoricalFinancialTakeoverMapping) {
  if (candidate.sourceDuplicateGroupKey === mapping.sourceDuplicateGroupKey) {
    return candidate.mappingFingerprint === mapping.mappingFingerprint;
  }
  return candidate.targetKind === mapping.targetKind &&
    candidate.targetRef === mapping.targetRef &&
    candidate.targetFingerprint === mapping.targetFingerprint;
}

function causallyCompatible(candidate: {
  targetKind: string | null;
  targetRef: string | null;
  targetSnapshot: Prisma.JsonValue | Record<string, unknown>;
}, mapping: HistoricalFinancialTakeoverMapping) {
  const candidateSnapshot = object(candidate.targetSnapshot as Prisma.JsonValue);
  const mappingSnapshot = mapping.targetSnapshot;
  const pair = new Set([candidate.targetKind, mapping.targetKind]);
  if (pair.has("settlement_allocation") && pair.has("payment_execution")) {
    const allocation = candidate.targetKind === "settlement_allocation" ? candidateSnapshot : mappingSnapshot;
    const paymentRef = candidate.targetKind === "payment_execution" ? candidate.targetRef : mapping.targetRef;
    return allocation.paymentExecutionId === paymentRef;
  }
  if (pair.has("settlement_allocation") && pair.has("payable")) {
    const allocation = candidate.targetKind === "settlement_allocation" ? candidateSnapshot : mappingSnapshot;
    const payableRef = candidate.targetKind === "payable" ? candidate.targetRef : mapping.targetRef;
    return allocation.payableRef === payableRef;
  }
  if (pair.has("fund_movement") && pair.has("payment_execution")) {
    const movement = candidate.targetKind === "fund_movement" ? candidateSnapshot : mappingSnapshot;
    const paymentRef = candidate.targetKind === "payment_execution" ? candidate.targetRef : mapping.targetRef;
    return movement.paymentExecutionId === paymentRef;
  }
  return false;
}

export function serializeHistoricalFinancialTakeoverBatch(batch: {
  id: string;
  projectId: string;
  asOfDate: Date;
  status: string;
  revision: number;
  manifestFingerprint: string;
  readSetFingerprint: string;
  candidateBaselineSha: string;
  rows: Array<{
    id: string;
    rowNo: number;
    kind: string;
    evidenceLevel: string;
    mappingDecision: string;
    amountCents: bigint;
    currencyCode: string;
    targetKind: string | null;
    targetRef: string | null;
    targetFingerprint: string | null;
    targetSnapshot: Prisma.JsonValue;
    projectionStatus: string;
    newPaymentAllowed: boolean;
    settlementAllocationAllowed: boolean;
  }>;
  receipts: unknown[];
  activation: unknown;
  compensation: unknown;
}, exposeSensitiveTargets: boolean) {
  return {
    id: batch.id,
    projectId: batch.projectId,
    asOfDate: batch.asOfDate.toISOString().slice(0, 10),
    status: batch.status,
    revision: batch.revision,
    manifestFingerprint: batch.manifestFingerprint,
    readSetFingerprint: batch.readSetFingerprint,
    candidateBaselineSha: batch.candidateBaselineSha,
    rows: batch.rows.map((row) => ({
      id: row.id,
      rowNo: row.rowNo,
      kind: row.kind,
      evidenceLevel: row.evidenceLevel,
      mappingDecision: row.mappingDecision,
      amountCents: row.amountCents.toString(),
      currencyCode: row.currencyCode,
      targetKind: row.targetKind,
      targetRef: exposeSensitiveTargets ? row.targetRef : null,
      targetFingerprint: row.targetFingerprint,
      targetSnapshot: exposeSensitiveTargets ? row.targetSnapshot : null,
      projectionStatus: row.projectionStatus,
      newPaymentAllowed: row.newPaymentAllowed,
      settlementAllocationAllowed: row.settlementAllocationAllowed
    })),
    receipts: batch.receipts,
    activation: batch.activation,
    compensation: exposeSensitiveTargets
      ? batch.compensation
      : batch.compensation
        ? { redacted: true }
        : null
  };
}
