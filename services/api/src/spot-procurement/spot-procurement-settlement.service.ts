import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";
import type { CreateProcurementDiscrepancyDto } from "./dto/create-procurement-discrepancy.dto";
import type { ExecuteSupplierBalanceDto } from "./dto/execute-supplier-balance.dto";
import {
  PROCUREMENT_REFUND_METHODS,
  type RecordProcurementRefundDto
} from "./dto/record-procurement-refund.dto";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { SpotProcurementClosureService } from "./spot-procurement-closure.service";
import { deriveSpotProcurementPaymentExecutionStatus } from "./spot-procurement-payment-status";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

const HANDLER_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const APPROVED_PAYMENT_STATUSES = new Set([
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
]);
const ACTIVE_PAYMENT_STATUSES = new Set([
  "approval_pending",
  ...APPROVED_PAYMENT_STATUSES
]);
const REFUND_METHODS = new Set<string>(
  PROCUREMENT_REFUND_METHODS
);

type ProcurementLockRow = {
  id: string;
  projectId: string;
  code: string;
  supplierPartyId: string | null;
  supplierKey: string;
  supplierNameSnapshot: string;
  handlerUserId: string;
  currentVersionId: string | null;
  status: string;
  approvedAmountCents: bigint | null;
  actualCostCents: bigint | null;
};

type VersionLockRow = {
  id: string;
  procurementId: string;
  status: string;
  handlerUserId: string;
  supplierPartyId: string | null;
  supplierKey: string | null;
  supplierNameSnapshot: string | null;
  totalAmountCents: bigint | null;
};

type ReceiptLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  currentRevisionNo: number;
  handlerUserId: string;
  actualCostCents: bigint;
};

type ReceiptRevisionLockRow = {
  id: string;
  receiptId: string;
  revisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  handlerUserId: string;
  actualCostCents: bigint;
};

type ReceiptReviewLockRow = {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  sequenceNo: number;
  decision: string;
};

type DiscrepancyLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  receiptId: string;
  receiptRevisionNo: number;
  receiptReviewId: string;
  status: string;
  approvedAmountCentsSnapshot: bigint;
  actualCostCentsSnapshot: bigint;
  shortageAmountCents: bigint;
  canceledUnexecutedAmountCents: bigint;
  paidAmountCentsSnapshot: bigint;
  supplierBalanceUsedAmountCentsSnapshot: bigint;
  overpaidAmountCents: bigint;
  resolutionType: string | null;
  supplierBalanceEntryId: string | null;
  note: string | null;
  createdByUserId: string;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  invalidatedAt: Date | null;
};

export type SettlementPaymentLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  paymentType: string | null;
  approvalAmountCents: bigint;
  settlementAmountCents: bigint;
  supplierBalanceAmountCents: bigint;
  companyPaymentAmountCents: bigint;
  paidAmountCents: bigint;
  executedSupplierBalanceAmountCents: bigint;
  canceledAmountCents: bigint;
  canceledCompanyPaymentAmountCents: bigint;
  canceledSupplierBalanceAmountCents: bigint;
  invalidatedAt: Date | null;
  createdAt: Date;
};

type PaymentExecutionLockRow = {
  id: string;
  paymentId: string;
  amountCents: bigint;
};

type LockedSettlementContext = {
  procurement: ProcurementLockRow;
  version: VersionLockRow;
  receipt: ReceiptLockRow;
  revision: ReceiptRevisionLockRow;
  review: ReceiptReviewLockRow;
  actualCostCents: bigint;
};

type ActorRoleScopes = {
  effectiveRoleKeys: RoleKey[];
  projectRoleKeys: RoleKey[];
};

@Injectable()
export class SpotProcurementSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly balances: SpotProcurementBalanceService,
    private readonly auth: AuthService,
    private readonly files: FileService,
    private readonly approvalForms: ApprovalFormService,
    private readonly closure: SpotProcurementClosureService
  ) {}

  async createOrConfirmDiscrepancy(
    procurementId: string,
    actorUserId: string,
    input: CreateProcurementDiscrepancyDto
  ) {
    if (
      input.operation !== "initiate" &&
      input.operation !== "confirm"
    ) {
      throw new BadRequestException("差异处理操作不正确");
    }
    const note = optionalText(input.note);
    const result = await this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedReviewedContext(
          tx,
          procurementId
        );
        const payments = await this.lockProcurementPayments(
          tx,
          context.procurement.id
        );
        const currentPayments = payments.filter(
          (payment) =>
            payment.procurementVersionId === context.version.id &&
            !payment.invalidatedAt
        );
        await this.assertPaymentExecutionFacts(
          tx,
          currentPayments
        );
        const discrepancy = await this.lockActiveDiscrepancy(
          tx,
          context.receipt.id
        );
        const financial = calculateFinancialFacts(
          currentPayments,
          context.actualCostCents,
          context.version.totalAmountCents
        );
        this.assertFinancialFacts(financial);

        if (!discrepancy) {
          if (input.operation !== "initiate") {
            throw new ConflictException(
              "当前采购尚未发起收货差异，不能直接确认"
            );
          }
          if (context.receipt.status === "locked") {
            throw new ConflictException(
              "零星采购已经办结，不能再发起收货差异处理"
            );
          }
          await this.requireCurrentHandler(
            tx,
            context,
            actorUserId
          );
          if (financial.shortageAmountCents <= 0n) {
            throw new ConflictException(
              "当前复核收货不存在少货差异，无需发起差异处理"
            );
          }
          this.assertResolutionChoice(
            input.resolutionType,
            financial.overpaidAmountCents,
            financial.isRealForm
          );
          const created =
            await tx.spotProcurementDiscrepancy.create({
              data: {
                projectId: context.procurement.projectId,
                procurementId: context.procurement.id,
                procurementVersionId: context.version.id,
                receiptId: context.receipt.id,
                receiptRevisionNo:
                  context.receipt.currentRevisionNo,
                receiptReviewId: context.review.id,
                status: "pending_resolution",
                approvedAmountCentsSnapshot:
                  financial.approvedAmountCents,
                actualCostCentsSnapshot:
                  context.actualCostCents,
                shortageAmountCents:
                  financial.shortageAmountCents,
                canceledUnexecutedAmountCents: 0n,
                paidAmountCentsSnapshot:
                  financial.companyPaidAmountCents,
                supplierBalanceUsedAmountCentsSnapshot:
                  financial.executedSupplierBalanceAmountCents,
                overpaidAmountCents:
                  financial.overpaidAmountCents,
                resolutionType:
                  financial.overpaidAmountCents > 0n
                    ? input.resolutionType
                    : null,
                note,
                createdByUserId: actorUserId
              }
            });
          const settlement = settlementReadModel({
            ...financial,
            canceledUnexecutedAmountCents: 0n,
            refundedAmountCents: 0n,
            transferredSupplierBalanceAmountCents: 0n
          });
          await this.audit.record(tx, {
            actorUserId,
            action: "spot_procurement.discrepancy.create",
            businessType: "spot_procurement_discrepancy",
            businessId: created.id,
            metadata: {
              projectId: context.procurement.projectId,
              procurementId: context.procurement.id,
              procurementVersionId: context.version.id,
              receiptId: context.receipt.id,
              receiptRevisionNo:
                context.receipt.currentRevisionNo,
              receiptReviewId: context.review.id,
              approvedAmountCents:
                financial.approvedAmountCents.toString(),
              actualCostCents:
                context.actualCostCents.toString(),
              shortageAmountCents:
                financial.shortageAmountCents.toString(),
              companyPaidAmountCents:
                financial.companyPaidAmountCents.toString(),
              executedSupplierBalanceAmountCents:
                financial.executedSupplierBalanceAmountCents.toString(),
              overpaidAmountCents:
                financial.overpaidAmountCents.toString(),
              resolutionType:
                financial.overpaidAmountCents > 0n
                  ? input.resolutionType ?? null
                  : null,
              settlement
            }
          });
          return {
            discrepancy: discrepancyReadModel(created),
            settlement,
            paymentIds: currentPayments.map(
              (payment) => payment.id
            )
          };
        }
        if (input.operation === "initiate") {
          await this.requireCurrentHandler(
            tx,
            context,
            actorUserId
          );
          this.assertDiscrepancyCoordinates(
            discrepancy,
            context
          );
          this.assertDiscrepancySnapshot(
            discrepancy,
            context,
            financial
          );
          if (
            discrepancy.status !== "pending_resolution" ||
            discrepancy.createdByUserId !== actorUserId ||
            (input.resolutionType ?? null) !==
              discrepancy.resolutionType ||
            note !== discrepancy.note
          ) {
            throw new ConflictException(
              "当前差异已发起，重复请求不能改变处理方式或备注"
            );
          }
          return {
            discrepancy: discrepancyReadModel(discrepancy),
            settlement: settlementReadModel({
              ...financial,
              canceledUnexecutedAmountCents: 0n,
              refundedAmountCents: 0n,
              transferredSupplierBalanceAmountCents: 0n
            }),
            paymentIds: currentPayments.map(
              (payment) => payment.id
            )
          };
        }

        await this.requireMaterialDirector(
          tx,
          actorUserId,
          context.procurement.projectId,
          "只有物资主管可以确认零星采购收货差异事实"
        );
        this.assertDiscrepancyCoordinates(
          discrepancy,
          context
        );
        this.assertDiscrepancySnapshot(
          discrepancy,
          context,
          financial
        );
        if (
          note !== null &&
          note !== discrepancy.note
        ) {
          throw new BadRequestException(
            "确认时不能改变经办人填写的差异处理备注"
          );
        }
        if (
          input.resolutionType !== undefined &&
          input.resolutionType !== discrepancy.resolutionType
        ) {
          throw new BadRequestException(
            "确认时不能改变经办人选择的整笔多付处理方式"
          );
        }
        if (discrepancy.status !== "pending_resolution") {
          return this.confirmedDiscrepancyResult(
            tx,
            discrepancy,
            context,
            currentPayments
          );
        }
        if (context.procurement.status === "closed") {
          throw new ConflictException(
            "零星采购已经办结，不能再确认新的收货差异事实"
          );
        }
        if (
          currentPayments.some(
            (payment) =>
              payment.status === "approval_pending"
          )
        ) {
          throw new ConflictException(
            "存在审批中的零星采购付款，请先完成或撤回后再确认收货差异"
          );
        }

        const canceledUnexecutedAmountCents =
          await this.cancelUnneededApprovedCapacity(
            tx,
            context,
            currentPayments,
            nonnegative(
              financial.approvedPaymentCoverageAmountCents -
                context.actualCostCents
            ),
            actorUserId
          );
        const now = new Date();
        const status =
          financial.overpaidAmountCents === 0n
            ? "resolved"
            : discrepancy.resolutionType === "full_refund"
              ? "awaiting_refund"
              : financial.isRealForm
                ? "awaiting_replenishment"
                : "awaiting_supplier_balance";
        const updated =
          await tx.spotProcurementDiscrepancy.updateMany({
            where: {
              id: discrepancy.id,
              status: "pending_resolution"
            },
            data: {
              status,
              canceledUnexecutedAmountCents,
              unexecutedAmountClosedCents:
                financial.isRealForm
                  ? canceledUnexecutedAmountCents
                  : 0n,
              refundExpectedAmountCents:
                financial.isRealForm &&
                discrepancy.resolutionType === "full_refund"
                  ? financial.overpaidAmountCents
                  : 0n,
              resolvedAt:
                status === "resolved" ? now : null,
              resolvedByUserId:
                status === "resolved" ? actorUserId : null
            }
          });
        if (updated.count !== 1) {
          throw new ConflictException(
            "收货差异状态已变化，请刷新后重试"
          );
        }
        const confirmed =
          await tx.spotProcurementDiscrepancy.findUniqueOrThrow({
            where: { id: discrepancy.id }
          });
        const paymentsAfter =
          await this.readCurrentPaymentFacts(
            tx,
            context.procurement.id,
            context.version.id
          );
        const confirmedFinancial = calculateFinancialFacts(
          paymentsAfter,
          context.actualCostCents,
          context.version.totalAmountCents
        );
        this.assertFinancialFacts(confirmedFinancial);
        const settlement = settlementReadModel({
          ...confirmedFinancial,
          canceledUnexecutedAmountCents,
          refundedAmountCents: 0n,
          transferredSupplierBalanceAmountCents: 0n
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.discrepancy.confirm",
          businessType: "spot_procurement_discrepancy",
          businessId: discrepancy.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId: context.procurement.id,
            receiptReviewId: context.review.id,
            statusBefore: discrepancy.status,
            statusAfter: status,
            canceledUnexecutedAmountCents:
              canceledUnexecutedAmountCents.toString(),
            remainingPayableAmountCents:
              confirmedFinancial.remainingPayableAmountCents.toString(),
            overpaidAmountCents:
              confirmedFinancial.overpaidAmountCents.toString(),
            settlement
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          context.procurement.id,
          "discrepancy.confirm",
          actorUserId
        );
        return {
          discrepancy: discrepancyReadModel(confirmed),
          settlement,
          paymentIds: currentPayments.map(
            (payment) => payment.id
          )
        };
      })
    );
    await this.refreshPaymentForms(
      result.paymentIds,
      actorUserId,
      "discrepancy.changed"
    );
    return {
      discrepancy: result.discrepancy,
      settlement: result.settlement
    };
  }

  async recordRefund(
    procurementId: string,
    actorUserId: string,
    input: RecordProcurementRefundDto
  ) {
    const amountCents = parsePositiveMoney(
      input.amountCents,
      "退款到账金额"
    );
    const receivedAt = parsePastDate(
      input.receivedAt,
      "退款实际到账日期"
    );
    if (!REFUND_METHODS.has(input.refundMethod)) {
      throw new BadRequestException("退款到账方式不正确");
    }
    const voucherFileId = requiredText(
      input.voucherFileId,
      "退款到账凭证不能为空"
    );
    const idempotencyKey = requiredText(
      input.idempotencyKey,
      "幂等键不能为空"
    );
    await this.files.assertCanDownloadFileById(
      voucherFileId,
      actorUserId
    );

    try {
      const result = await this.runSerializable(async (tx) => {
        const context = await this.requireLockedReviewedContext(
          tx,
          procurementId
        );
        await this.requireProjectFinanceStaff(
          tx,
          actorUserId,
          context.procurement.projectId
        );
        const payments = await this.lockProcurementPayments(
          tx,
          context.procurement.id
        );
        const currentPayments = payments.filter(
          (payment) =>
            payment.procurementVersionId === context.version.id &&
            !payment.invalidatedAt
        );
        await this.assertPaymentExecutionFacts(
          tx,
          currentPayments
        );
        const existing =
          await tx.spotProcurementRefund.findUnique({
            where: { idempotencyKey }
          });
        if (existing) {
          this.assertSameRefundFacts(existing, {
            procurementId,
            amountCents,
            receivedAt,
            refundMethod: input.refundMethod,
            voucherFileId,
            actorUserId
          });
          const discrepancy =
            await tx.spotProcurementDiscrepancy.findUniqueOrThrow({
              where: { id: existing.discrepancyId }
            });
          this.assertDiscrepancyCoordinates(
            discrepancy,
            context
          );
          const financial = calculateFinancialFacts(
            currentPayments,
            context.actualCostCents,
            context.version.totalAmountCents
          );
          this.assertFinancialFacts(financial);
          this.assertDiscrepancySnapshot(
            discrepancy,
            context,
            financial
          );
          this.assertRefundSettlementFacts(
            existing,
            discrepancy,
            context
          );
          return this.refundResult(
            existing,
            discrepancy,
            context,
            currentPayments
          );
        }
        const discrepancy = await this.lockActiveDiscrepancy(
          tx,
          context.receipt.id
        );
        if (
          !discrepancy ||
          discrepancy.status !== "awaiting_refund" ||
          discrepancy.resolutionType !== "full_refund"
        ) {
          throw new ConflictException(
            "当前采购不存在待登记到账的整笔供应商退款"
          );
        }
        if (context.procurement.status === "closed") {
          throw new ConflictException(
            "零星采购已经办结，不能新增供应商退款到账事实"
          );
        }
        this.assertDiscrepancyCoordinates(
          discrepancy,
          context
        );
        const financial = calculateFinancialFacts(
          currentPayments,
          context.actualCostCents,
          context.version.totalAmountCents
        );
        this.assertFinancialFacts(financial);
        this.assertDiscrepancySnapshot(
          discrepancy,
          context,
          financial
        );
        if (amountCents !== discrepancy.overpaidAmountCents) {
          throw new BadRequestException(
            `退款到账金额必须等于待退款整笔差额 ${discrepancy.overpaidAmountCents} 分`
          );
        }
        await this.lockProjectForCashFacts(
          tx,
          context.procurement.projectId
        );
        await this.files.assertFileHasNoBusinessBinding(
          tx,
          voucherFileId
        );
        await this.files.assertCanDownloadFile(
          tx,
          voucherFileId,
          actorUserId
        );
        const refund = await tx.spotProcurementRefund.create({
          data: {
            discrepancyId: discrepancy.id,
            procurementId: context.procurement.id,
            amountCents,
            receivedAt,
            refundMethod: input.refundMethod,
            voucherFileId,
            recordedByUserId: actorUserId,
            idempotencyKey
          }
        });
        const resolved =
          await tx.spotProcurementDiscrepancy.updateMany({
            where: {
              id: discrepancy.id,
              status: "awaiting_refund",
              supplierBalanceEntryId: null
            },
            data: {
              status: "resolved",
              resolvedAt: new Date(),
              resolvedByUserId: actorUserId
            }
          });
        if (resolved.count !== 1) {
          throw new ConflictException(
            "待退款差异状态已变化，请刷新后重试"
          );
        }
        const discrepancyAfter = {
          ...discrepancy,
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByUserId: actorUserId
        };
        const refundResult = this.refundResult(
          refund,
          discrepancyAfter,
          context,
          currentPayments
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.refund.record",
          businessType: "spot_procurement_discrepancy",
          businessId: discrepancy.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId: context.procurement.id,
            refundId: refund.id,
            amountCents: amountCents.toString(),
            receivedAt: receivedAt.toISOString(),
            refundMethod: input.refundMethod,
            voucherFileId,
            statusBefore: discrepancy.status,
            statusAfter: "resolved",
            settlement: refundResult.settlement
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          context.procurement.id,
          "refund.record",
          actorUserId
        );
        return refundResult;
      });
      await this.refreshPaymentForms(
        result.paymentIds,
        actorUserId,
        "refund.record"
      );
      return {
        refund: result.refund,
        discrepancy: result.discrepancy,
        settlement: result.settlement
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2002" || code === "P2034") {
        const existing =
          await this.prisma.spotProcurementRefund.findUnique({
            where: { idempotencyKey }
          });
        if (existing) {
          this.assertSameRefundFacts(existing, {
            procurementId,
            amountCents,
            receivedAt,
            refundMethod: input.refundMethod,
            voucherFileId,
            actorUserId
          });
          return this.readRefundResult(existing);
        }
        throw new ConflictException(
          code === "P2034"
            ? "供应商退款登记并发冲突，请刷新后重试"
            : "供应商退款唯一事实已变化，请刷新后重试"
        );
      }
      if (code === "P2003" || code === "P2025") {
        throw new ConflictException(
          "供应商退款关联数据已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }

  async creditSupplierBalance(
    procurementId: string,
    actorUserId: string,
    input: ExecuteSupplierBalanceDto
  ) {
    const password = requiredText(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    await this.auth.confirmPassword(actorUserId, password);
    const result = await this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedReviewedContext(
          tx,
          procurementId
        );
        await this.requireFinanceDirector(
          tx,
          actorUserId,
          context.procurement.projectId
        );
        const payments = await this.lockProcurementPayments(
          tx,
          context.procurement.id
        );
        const currentPayments = payments.filter(
          (payment) =>
            payment.procurementVersionId === context.version.id &&
            !payment.invalidatedAt
        );
        await this.assertPaymentExecutionFacts(
          tx,
          currentPayments
        );
        const discrepancy = await this.lockActiveDiscrepancy(
          tx,
          context.receipt.id
        );
        if (!discrepancy) {
          throw new ConflictException(
            "当前采购不存在待转入供应商余额的差异"
          );
        }
        this.assertDiscrepancyCoordinates(
          discrepancy,
          context
        );
        const financial = calculateFinancialFacts(
          currentPayments,
          context.actualCostCents,
          context.version.totalAmountCents
        );
        this.assertFinancialFacts(financial);
        if (financial.isRealForm) {
          await this.recordLegacyBalancePathRejected(
            tx,
            actorUserId,
            context.procurement,
            currentPayments,
            "credit"
          );
        }
        this.assertDiscrepancySnapshot(
          discrepancy,
          context,
          financial
        );
        if (
          discrepancy.status === "resolved" &&
          discrepancy.resolutionType ===
            "full_supplier_balance" &&
          discrepancy.supplierBalanceEntryId
        ) {
          const entry =
            await tx.supplierBalanceEntry.findUnique({
              where: {
                id: discrepancy.supplierBalanceEntryId
              },
              select: {
                id: true,
                accountId: true,
                procurementId: true,
                entryType: true,
                availableDeltaCents: true,
                reservedDeltaCents: true
              }
            });
          if (
            !entry ||
            entry.procurementId !== context.procurement.id ||
            entry.entryType !==
              "credit_from_discrepancy" ||
            entry.availableDeltaCents !==
              discrepancy.overpaidAmountCents ||
            entry.reservedDeltaCents !== 0n
          ) {
            throw new ConflictException(
              "供应商余额转入分录与差异事实不一致，请联系财务核对"
            );
          }
          return this.creditResult(
            discrepancy,
            context,
            currentPayments,
            entry.accountId
          );
        }
        if (
          discrepancy.status !==
            "awaiting_supplier_balance" ||
          discrepancy.resolutionType !==
            "full_supplier_balance"
        ) {
          throw new ConflictException(
            "当前采购不存在待确认的整笔供应商余额转入"
          );
        }
        if (context.procurement.status === "closed") {
          throw new ConflictException(
            "零星采购已经办结，不能新增供应商余额转入事实"
          );
        }
        const entry = await this.balances.creditFromDiscrepancy(
          tx,
          {
            discrepancyId: discrepancy.id,
            projectId: context.procurement.projectId,
            supplierPartyId:
              context.procurement.supplierPartyId,
            supplierKey: context.procurement.supplierKey,
            supplierNameSnapshot:
              context.procurement.supplierNameSnapshot,
            procurementId: context.procurement.id,
            amountCents: discrepancy.overpaidAmountCents,
            actorUserId,
            reason: "零星采购少货真实多付整笔转供应商余额"
          }
        );
        const resolvedAt = new Date();
        const resolved =
          await tx.spotProcurementDiscrepancy.updateMany({
            where: {
              id: discrepancy.id,
              status: "awaiting_supplier_balance",
              supplierBalanceEntryId: null
            },
            data: {
              status: "resolved",
              supplierBalanceEntryId: entry.entryId,
              resolvedAt,
              resolvedByUserId: actorUserId
            }
          });
        if (resolved.count !== 1) {
          throw new ConflictException(
            "供应商余额转入状态已变化，请刷新后重试"
          );
        }
        const discrepancyAfter = {
          ...discrepancy,
          status: "resolved",
          supplierBalanceEntryId: entry.entryId,
          resolvedAt,
          resolvedByUserId: actorUserId
        };
        const creditResult = this.creditResult(
          discrepancyAfter,
          context,
          currentPayments,
          entry.accountId
        );
        await this.audit.record(tx, {
          actorUserId,
          action:
            "spot_procurement.discrepancy.supplier_balance_resolved",
          businessType: "spot_procurement_discrepancy",
          businessId: discrepancy.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId: context.procurement.id,
            supplierBalanceEntryId: entry.entryId,
            amountCents:
              discrepancy.overpaidAmountCents.toString(),
            statusBefore: discrepancy.status,
            statusAfter: "resolved",
            settlement: creditResult.settlement
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          context.procurement.id,
          "supplier_balance.credit",
          actorUserId
        );
        return creditResult;
      })
    );
    await this.refreshPaymentForms(
      result.paymentIds,
      actorUserId,
      "supplier_balance.credit"
    );
    return {
      supplierBalance: result.supplierBalance,
      discrepancy: result.discrepancy,
      settlement: result.settlement
    };
  }

  async executeSupplierBalance(
    paymentId: string,
    actorUserId: string,
    input: ExecuteSupplierBalanceDto
  ) {
    const password = requiredText(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    await this.auth.confirmPassword(actorUserId, password);
    const result = await this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(
          tx,
          paymentId
        );
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(
          tx,
          version.procurementId
        );
        const payment = payments.find(
          (candidate) => candidate.id === paymentId
        );
        if (!payment) {
          throw new NotFoundException(
            "零星采购付款申请不存在"
          );
        }
        await this.requireFinanceDirector(
          tx,
          actorUserId,
          version.projectId
        );
        if (payment.paymentType) {
          await this.audit.record(tx, {
            actorUserId,
            action: "spot_procurement.balance.legacy_path.rejected",
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: payment.id,
            metadata: {
              projectId: version.projectId,
              procurementId: version.procurementId,
              paymentId: payment.id,
              operation: "execute"
            }
          });
          throw new ConflictException(
            "零星采购真实表单已取消转商户余额，只允许商户补货或登记退款"
          );
        }
        if (
          payment.procurementVersionId !== version.id ||
          payment.invalidatedAt
        ) {
          throw new ConflictException(
            "付款申请不属于当前有效采购版本"
          );
        }
        if (
          ![
            "approved_pending_payment",
            "partially_paid",
            "paid",
            "settled"
          ].includes(payment.status)
        ) {
          throw new ConflictException(
            "当前付款申请尚未批准或状态不允许执行供应商余额"
          );
        }
        const effectiveBalanceAmountCents = nonnegative(
          payment.supplierBalanceAmountCents -
            payment.canceledSupplierBalanceAmountCents
        );
        if (
          payment.executedSupplierBalanceAmountCents ===
            effectiveBalanceAmountCents &&
          effectiveBalanceAmountCents > 0n
        ) {
          const reservation =
            await tx.supplierBalanceReservation.findUnique({
              where: { paymentId },
              select: {
                id: true,
                accountId: true,
                amountCents: true,
                releasedAmountCents: true,
                status: true
              }
            });
          const entry =
            await tx.supplierBalanceEntry.findFirst({
              where: {
                paymentId,
                entryType: "execute"
              },
              select: {
                id: true,
                accountId: true,
                reservationId: true,
                procurementId: true,
                availableDeltaCents: true,
                reservedDeltaCents: true
              }
            });
          if (
            !reservation ||
            reservation.status !== "executed" ||
            reservation.amountCents !==
              payment.supplierBalanceAmountCents ||
            reservation.releasedAmountCents !==
              payment.canceledSupplierBalanceAmountCents ||
            !entry ||
            entry.accountId !== reservation.accountId ||
            entry.reservationId !== reservation.id ||
            entry.procurementId !== version.procurementId ||
            entry.availableDeltaCents !==
              -effectiveBalanceAmountCents ||
            entry.reservedDeltaCents !==
              -effectiveBalanceAmountCents
          ) {
            throw new ConflictException(
              "供应商余额执行分录与付款事实不一致，请联系财务核对"
            );
          }
          return this.balanceExecutionResult(
            payment,
            effectiveBalanceAmountCents,
            entry.id
          );
        }
        if (version.rootStatus === "closed") {
          throw new ConflictException(
            "零星采购已经办结，不能新增供应商余额执行事实"
          );
        }
        const pendingDiscrepancy =
          await tx.spotProcurementDiscrepancy.findFirst({
            where: {
              procurementId: version.procurementId,
              status: "pending_resolution",
              invalidatedAt: null
            },
            select: { id: true }
          });
        if (pendingDiscrepancy) {
          throw new ConflictException(
            "收货差异正在等待物资主管确认，暂不能执行供应商余额抵扣"
          );
        }
        if (
          effectiveBalanceAmountCents <= 0n ||
          payment.executedSupplierBalanceAmountCents !== 0n
        ) {
          throw new ConflictException(
            "当前付款申请没有可执行的供应商余额预留"
          );
        }
        const executed =
          await this.balances.executeReservation(tx, {
            paymentId,
            expectedAmountCents:
              effectiveBalanceAmountCents,
            expectedProjectId: version.projectId,
            expectedSupplierKey: version.supplierKey,
            expectedProcurementId: version.procurementId,
            actorUserId,
            reason: "财务主管确认执行零星采购供应商余额抵扣"
          });
        const paymentAfter = {
          ...payment,
          executedSupplierBalanceAmountCents:
            payment.executedSupplierBalanceAmountCents +
            executed.amountCents
        };
        const statusAfter =
          deriveSpotProcurementPaymentExecutionStatus(
            paymentAfter
          );
        const updated =
          await tx.spotProcurementPayment.updateMany({
            where: {
              id: payment.id,
              status: payment.status,
              executedSupplierBalanceAmountCents:
                payment.executedSupplierBalanceAmountCents,
              canceledSupplierBalanceAmountCents:
                payment.canceledSupplierBalanceAmountCents
            },
            data: {
              executedSupplierBalanceAmountCents:
                paymentAfter.executedSupplierBalanceAmountCents,
              status: statusAfter
            }
          });
        if (updated.count !== 1) {
          throw new ConflictException(
            "付款状态或供应商余额执行事实已变化，请刷新后重试"
          );
        }
        await this.audit.record(tx, {
          actorUserId,
          action:
            "spot_procurement.payment.balance.execute",
          businessType:
            SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            projectId: version.projectId,
            procurementId: version.procurementId,
            accountId: executed.accountId,
            supplierBalanceEntryId: executed.entryId,
            amountCents: executed.amountCents.toString(),
            paidAmountCents:
              payment.paidAmountCents.toString(),
            statusBefore: payment.status,
            statusAfter
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          version.procurementId,
          "supplier_balance.execute",
          actorUserId
        );
        return this.balanceExecutionResult(
          { ...paymentAfter, status: statusAfter },
          executed.amountCents,
          executed.entryId
        );
      })
    );
    await this.refreshPaymentForms(
      [paymentId],
      actorUserId,
      "supplier_balance.execute"
    );
    return result;
  }

  private async requireLockedReviewedContext(
    tx: Prisma.TransactionClient,
    procurementId: string
  ): Promise<LockedSettlementContext> {
    const procurement = (
      await tx.$queryRaw<ProcurementLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "projectId",
          "code",
          "supplierPartyId",
          "supplierKey",
          "supplierNameSnapshot",
          "handlerUserId",
          "currentVersionId",
          "status",
          "approvedAmountCents",
          "actualCostCents"
        FROM "SpotProcurement"
        WHERE "id" = ${procurementId}
        LIMIT 1
        FOR UPDATE
      `)
    )[0];
    if (!procurement) {
      throw new NotFoundException("零星采购不存在");
    }
    this.pilot.assertEnabled(procurement.projectId);
    if (
      !["approved_in_progress", "closed"].includes(
        procurement.status
      ) ||
      !procurement.currentVersionId
    ) {
      throw new ConflictException(
        "当前采购不是已审批办理中的有效采购"
      );
    }
    const version = (
      await tx.$queryRaw<VersionLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "procurementId",
          "status",
          "handlerUserId",
          "supplierPartyId",
          "supplierKey",
          "supplierNameSnapshot",
          "totalAmountCents"
        FROM "SpotProcurementVersion"
        WHERE "id" = ${procurement.currentVersionId}
          AND "procurementId" = ${procurement.id}
        LIMIT 1
        FOR UPDATE
      `)
    )[0];
    if (!version || version.status !== "approved") {
      throw new ConflictException(
        "零星采购当前批准版本不存在或已失效"
      );
    }
    const receipt = (
      await tx.$queryRaw<ReceiptLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "projectId",
          "procurementId",
          "procurementVersionId",
          "status",
          "currentRevisionNo",
          "handlerUserId",
          "actualCostCents"
        FROM "SpotProcurementReceipt"
        WHERE "procurementId" = ${procurement.id}
        LIMIT 1
        FOR UPDATE
      `)
    )[0];
    if (
      !receipt ||
      !["reviewed", "locked"].includes(receipt.status)
    ) {
      throw new ConflictException(
        "只有当前物资主管复核通过的收货结果可以处理差异"
      );
    }
    const revision = (
      await tx.$queryRaw<ReceiptRevisionLockRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "receiptId",
            "revisionNo",
            "procurementId",
            "procurementVersionId",
            "handlerUserId",
            "actualCostCents"
          FROM "SpotProcurementReceiptRevision"
          WHERE "receiptId" = ${receipt.id}
            AND "revisionNo" = ${receipt.currentRevisionNo}
            AND "procurementId" = ${procurement.id}
          LIMIT 1
          FOR UPDATE
        `
      )
    )[0];
    if (!revision) {
      throw new ConflictException(
        "当前收货修订不存在或归属不正确"
      );
    }
    const review = (
      await tx.$queryRaw<ReceiptReviewLockRow[]>(
        Prisma.sql`
          SELECT
            "id",
            "receiptId",
            "receiptRevisionNo",
            "procurementId",
            "procurementVersionId",
            "sequenceNo",
            "decision"
          FROM "SpotProcurementReceiptReview"
          WHERE "receiptId" = ${receipt.id}
          ORDER BY "sequenceNo" DESC, "id" DESC
          LIMIT 1
          FOR UPDATE
        `
      )
    )[0];
    if (
      !review ||
      review.decision !== "approved" ||
      review.receiptRevisionNo !== receipt.currentRevisionNo ||
      review.procurementId !== procurement.id ||
      review.procurementVersionId !== version.id
    ) {
      throw new ConflictException(
        "当前收货复核已变化，请刷新后重试"
      );
    }
    if (
      procurement.projectId !== receipt.projectId ||
      version.procurementId !== procurement.id ||
      receipt.procurementId !== procurement.id ||
      receipt.procurementVersionId !== version.id ||
      revision.receiptId !== receipt.id ||
      revision.procurementVersionId !== version.id ||
      procurement.handlerUserId !== version.handlerUserId ||
      receipt.handlerUserId !== version.handlerUserId ||
      revision.handlerUserId !== version.handlerUserId ||
      procurement.supplierPartyId !== version.supplierPartyId ||
      procurement.supplierKey !== version.supplierKey ||
      procurement.supplierNameSnapshot !==
        version.supplierNameSnapshot ||
      procurement.approvedAmountCents !==
        version.totalAmountCents
    ) {
      throw new ConflictException(
        "采购、版本、收货或供应商冻结坐标不一致"
      );
    }
    const receiptLines =
      await tx.$queryRaw<Array<{ actualCostCents: bigint }>>(
        Prisma.sql`
          SELECT "actualCostCents"
          FROM "SpotProcurementReceiptLine"
          WHERE "receiptId" = ${receipt.id}
            AND "receiptRevisionNo" = ${receipt.currentRevisionNo}
            AND "procurementId" = ${procurement.id}
            AND "procurementVersionId" = ${version.id}
          ORDER BY "procurementLineId"
          FOR UPDATE
        `
      );
    if (!receiptLines.length) {
      throw new ConflictException(
        "当前复核收货缺少材料明细"
      );
    }
    const actualCostCents = receiptLines.reduce(
      (total, line) => total + line.actualCostCents,
      0n
    );
    if (
      actualCostCents !== receipt.actualCostCents ||
      actualCostCents !== revision.actualCostCents ||
      procurement.actualCostCents !== actualCostCents ||
      (version.totalAmountCents !== null &&
        actualCostCents > version.totalAmountCents)
    ) {
      throw new ConflictException(
        "当前收货实际成本汇总不一致，请联系管理员核对"
      );
    }
    return {
      procurement,
      version,
      receipt,
      revision,
      review,
      actualCostCents
    };
  }

  private async requireLockedVersionForPayment(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        procurementId: string;
        projectId: string;
        currentVersionId: string | null;
        rootStatus: string;
        status: string;
        supplierKey: string;
      }>
    >(Prisma.sql`
      SELECT
        version."id",
        version."procurementId",
        procurement."projectId",
        procurement."currentVersionId",
        procurement."status" AS "rootStatus",
        version."status",
        version."supplierKey"
      FROM "SpotProcurementPayment" payment
      INNER JOIN "SpotProcurementVersion" version
        ON version."id" = payment."procurementVersionId"
       AND version."procurementId" = payment."procurementId"
      INNER JOIN "SpotProcurement" procurement
        ON procurement."id" = version."procurementId"
      WHERE payment."id" = ${paymentId}
      LIMIT 1
      FOR UPDATE OF version
    `);
    const version = rows[0];
    if (
      !version ||
      version.currentVersionId !== version.id ||
      !["approved_in_progress", "closed"].includes(
        version.rootStatus
      ) ||
      version.status !== "approved"
    ) {
      throw new ConflictException(
        "付款申请关联的采购版本已失效或不再可用"
      );
    }
    return version;
  }

  private lockProcurementPayments(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    return tx.$queryRaw<SettlementPaymentLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "procurementId",
          "procurementVersionId",
          "status",
          "paymentType",
          "approvalAmountCents",
          "settlementAmountCents",
          "supplierBalanceAmountCents",
          "companyPaymentAmountCents",
          "paidAmountCents",
          "executedSupplierBalanceAmountCents",
          "canceledAmountCents",
          "canceledCompanyPaymentAmountCents",
          "canceledSupplierBalanceAmountCents",
          "invalidatedAt",
          "createdAt"
        FROM "SpotProcurementPayment"
        WHERE "procurementId" = ${procurementId}
        ORDER BY "id"
        FOR UPDATE
      `
    );
  }

  private async lockProjectForCashFacts(
    tx: Prisma.TransactionClient,
    projectId: string
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean }>
    >(Prisma.sql`
      SELECT "id", "isActive"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);
    if (!rows[0]?.isActive) {
      throw new ConflictException(
        "项目不存在或已停用，不能登记供应商退款到账"
      );
    }
  }

  private async readCurrentPaymentFacts(
    tx: Prisma.TransactionClient,
    procurementId: string,
    versionId: string
  ) {
    return (
      await this.lockProcurementPayments(tx, procurementId)
    ).filter(
      (payment) =>
        payment.procurementVersionId === versionId &&
        !payment.invalidatedAt
    );
  }

  private async assertPaymentExecutionFacts(
    tx: Prisma.TransactionClient,
    payments: SettlementPaymentLockRow[]
  ) {
    const paymentIds = payments.map((payment) => payment.id);
    const executions = paymentIds.length
      ? await tx.$queryRaw<PaymentExecutionLockRow[]>(
          Prisma.sql`
            SELECT
              "id",
              "paymentId",
              "amountCents"
            FROM "SpotProcurementPaymentExecution"
            WHERE "paymentId" IN (${Prisma.join(paymentIds)})
              AND "voidedAt" IS NULL
            ORDER BY "paymentId", "id"
            FOR UPDATE
          `
        )
      : [];
    const paidByPayment = new Map<string, bigint>();
    for (const execution of executions) {
      paidByPayment.set(
        execution.paymentId,
        (paidByPayment.get(execution.paymentId) ?? 0n) +
          execution.amountCents
      );
    }
    for (const payment of payments) {
      if (
        (paidByPayment.get(payment.id) ?? 0n) !==
        payment.paidAmountCents
      ) {
        throw new ConflictException(
          "付款累计已付与实际付款明细不一致，请联系财务核对"
        );
      }
    }
  }

  private async lockActiveDiscrepancy(
    tx: Prisma.TransactionClient,
    receiptId: string
  ) {
    const rows = await tx.$queryRaw<DiscrepancyLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "procurementId",
          "procurementVersionId",
          "receiptId",
          "receiptRevisionNo",
          "receiptReviewId",
          "status",
          "approvedAmountCentsSnapshot",
          "actualCostCentsSnapshot",
          "shortageAmountCents",
          "canceledUnexecutedAmountCents",
          "paidAmountCentsSnapshot",
          "supplierBalanceUsedAmountCentsSnapshot",
          "overpaidAmountCents",
          "resolutionType",
          "supplierBalanceEntryId",
          "note",
          "createdByUserId",
          "resolvedAt",
          "resolvedByUserId",
          "invalidatedAt"
        FROM "SpotProcurementDiscrepancy"
        WHERE "receiptId" = ${receiptId}
          AND "invalidatedAt" IS NULL
        LIMIT 1
        FOR UPDATE
      `
    );
    return rows[0] ?? null;
  }

  private async cancelUnneededApprovedCapacity(
    tx: Prisma.TransactionClient,
    context: LockedSettlementContext,
    payments: SettlementPaymentLockRow[],
    excessApprovedCapacityCents: bigint,
    actorUserId: string
  ) {
    // 冻结规则：先从最新付款单回收，单张付款内先取消尚未银行支付的
    // 公司额度，再释放尚未执行的供应商余额预留；历史批准金额保持不变。
    const candidates = payments
      .filter(
        (payment) =>
          APPROVED_PAYMENT_STATUSES.has(payment.status) &&
          ACTIVE_PAYMENT_STATUSES.has(payment.status)
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() -
            left.createdAt.getTime() ||
          right.id.localeCompare(left.id)
      );
    const totalUnexecuted = candidates.reduce(
      (total, payment) =>
        total +
        nonnegative(
          payment.companyPaymentAmountCents -
            payment.canceledCompanyPaymentAmountCents -
            payment.paidAmountCents
        ) +
        nonnegative(
          payment.supplierBalanceAmountCents -
            payment.canceledSupplierBalanceAmountCents -
            payment.executedSupplierBalanceAmountCents
        ),
      0n
    );
    let remaining = minimum(
      excessApprovedCapacityCents,
      totalUnexecuted
    );
    const cancelTotal = remaining;

    for (const payment of candidates) {
      if (remaining === 0n) break;
      const companyUnexecuted = nonnegative(
        payment.companyPaymentAmountCents -
          payment.canceledCompanyPaymentAmountCents -
          payment.paidAmountCents
      );
      const canceledCompany = minimum(
        remaining,
        companyUnexecuted
      );
      remaining -= canceledCompany;
      const balanceUnexecuted = nonnegative(
        payment.supplierBalanceAmountCents -
          payment.canceledSupplierBalanceAmountCents -
          payment.executedSupplierBalanceAmountCents
      );
      const canceledBalance = minimum(
        remaining,
        balanceUnexecuted
      );
      remaining -= canceledBalance;
      if (canceledBalance > 0n) {
        await this.balances.releaseForShortage(tx, {
          paymentId: payment.id,
          expectedReservedAmountCents:
            payment.supplierBalanceAmountCents,
          releaseAmountCents: canceledBalance,
          expectedProjectId: context.procurement.projectId,
          expectedSupplierKey:
            context.procurement.supplierKey,
          actorUserId,
          reason: "最终收货少货，取消不再需要的供应商余额预留"
        });
      }
      const canceledCompanyAfter =
        payment.canceledCompanyPaymentAmountCents +
        canceledCompany;
      const canceledBalanceAfter =
        payment.canceledSupplierBalanceAmountCents +
        canceledBalance;
      const canceledAmountAfter =
        canceledCompanyAfter + canceledBalanceAfter;
      const statusAfter =
        deriveSpotProcurementPaymentExecutionStatus({
          ...payment,
          canceledCompanyPaymentAmountCents:
            canceledCompanyAfter,
          canceledSupplierBalanceAmountCents:
            canceledBalanceAfter
        });
      const updated =
        await tx.spotProcurementPayment.updateMany({
          where: {
            id: payment.id,
            status: payment.status,
            canceledAmountCents:
              payment.canceledAmountCents,
            canceledCompanyPaymentAmountCents:
              payment.canceledCompanyPaymentAmountCents,
            canceledSupplierBalanceAmountCents:
              payment.canceledSupplierBalanceAmountCents
          },
          data: {
            canceledAmountCents: canceledAmountAfter,
            canceledCompanyPaymentAmountCents:
              canceledCompanyAfter,
            canceledSupplierBalanceAmountCents:
              canceledBalanceAfter,
            status: statusAfter
          }
        });
      if (updated.count !== 1) {
        throw new ConflictException(
          "付款取消额度已变化，请刷新后重试"
        );
      }
      await this.audit.record(tx, {
        actorUserId,
        action:
          "spot_procurement.payment.unexecuted_capacity.cancel",
        businessType:
          SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        businessId: payment.id,
        metadata: {
          procurementId: context.procurement.id,
          discrepancyReceiptReviewId: context.review.id,
          canceledCompanyPaymentAmountCents:
            canceledCompany.toString(),
          canceledSupplierBalanceAmountCents:
            canceledBalance.toString(),
          canceledAmountCents: (
            canceledCompany + canceledBalance
          ).toString(),
          approvedSettlementAmountCents:
            payment.settlementAmountCents.toString(),
          statusBefore: payment.status,
          statusAfter
        }
      });
    }
    // 已实际支付的部分不能被改写为“已取消额度”；其与实际应付的差额
    // 由后续补货或退款闭环处理。
    return cancelTotal;
  }

  private assertResolutionChoice(
    resolutionType:
      | "replenishment"
      | "full_refund"
      | "full_supplier_balance"
      | undefined,
    overpaidAmountCents: bigint,
    isRealForm: boolean
  ) {
    if (overpaidAmountCents > 0n && !resolutionType) {
      throw new BadRequestException(
        isRealForm
          ? "存在真实多付时必须选择商户补货或整笔退款"
          : "存在真实多付时必须选择整笔退款或整笔转供应商余额"
      );
    }
    if (overpaidAmountCents === 0n && resolutionType) {
      throw new BadRequestException(
        "当前不存在真实多付，不能选择退款或转供应商余额"
      );
    }
    if (
      overpaidAmountCents > 0n &&
      isRealForm &&
      !["replenishment", "full_refund"].includes(
        resolutionType ?? ""
      )
    ) {
      throw new BadRequestException(
        "零星采购真实表单少货多付只允许商户补货或整笔退款"
      );
    }
    if (
      overpaidAmountCents > 0n &&
      !isRealForm &&
      !["full_refund", "full_supplier_balance"].includes(
        resolutionType ?? ""
      )
    ) {
      throw new BadRequestException(
        "历史零星采购多付处理方式不正确"
      );
    }
  }

  private assertDiscrepancyCoordinates(
    discrepancy: DiscrepancyLockRow,
    context: LockedSettlementContext
  ) {
    if (
      discrepancy.projectId !== context.procurement.projectId ||
      discrepancy.procurementId !== context.procurement.id ||
      discrepancy.procurementVersionId !== context.version.id ||
      discrepancy.receiptId !== context.receipt.id ||
      discrepancy.receiptRevisionNo !==
        context.receipt.currentRevisionNo ||
      discrepancy.receiptReviewId !== context.review.id
    ) {
      throw new ConflictException(
        "收货差异与当前采购、收货或复核坐标不一致"
      );
    }
  }

  private assertDiscrepancySnapshot(
    discrepancy: DiscrepancyLockRow,
    context: LockedSettlementContext,
    financial: ReturnType<typeof calculateFinancialFacts>
  ) {
    if (
      discrepancy.approvedAmountCentsSnapshot !==
        financial.approvedAmountCents ||
      discrepancy.actualCostCentsSnapshot !==
        context.actualCostCents ||
      discrepancy.shortageAmountCents !==
        financial.shortageAmountCents ||
      discrepancy.paidAmountCentsSnapshot !==
        financial.companyPaidAmountCents ||
      discrepancy.supplierBalanceUsedAmountCentsSnapshot !==
        financial.executedSupplierBalanceAmountCents ||
      discrepancy.overpaidAmountCents !==
        financial.overpaidAmountCents
    ) {
      throw new ConflictException(
        "差异发起后的付款事实已变化，请重新核对后再处理"
      );
    }
  }

  private assertFinancialFacts(
    financial: ReturnType<typeof calculateFinancialFacts>
  ) {
    if (
      financial.approvedPaymentCoverageAmountCents >
        financial.approvedAmountCents ||
      financial.grossExecutedAmountCents >
        financial.approvedPaymentCoverageAmountCents
    ) {
      throw new ConflictException(
        "付款覆盖、取消额度或执行金额超出采购账本范围，请联系财务核对"
      );
    }
    if (
      financial.isRealForm &&
      financial.executedSupplierBalanceAmountCents !== 0n
    ) {
      throw new ConflictException(
        "零星采购真实表单不得使用商户余额抵扣"
      );
    }
  }

  private async recordLegacyBalancePathRejected(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    procurement: ProcurementLockRow,
    payments: SettlementPaymentLockRow[],
    operation: "credit" | "execute"
  ) {
    await this.audit.record(tx, {
      actorUserId,
      action: "spot_procurement.balance.legacy_path.rejected",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
      businessId: procurement.id,
      metadata: {
        projectId: procurement.projectId,
        procurementId: procurement.id,
        paymentIds: payments.map((payment) => payment.id),
        operation
      }
    });
    throw new ConflictException(
      "零星采购真实表单已取消转商户余额，只允许商户补货或登记退款"
    );
  }

  private async requireCurrentHandler(
    tx: Prisma.TransactionClient,
    context: LockedSettlementContext,
    actorUserId: string
  ) {
    if (actorUserId !== context.version.handlerUserId) {
      throw new ForbiddenException(
        "只有当前采购经办人可以发起收货差异处理"
      );
    }
    await this.requireActiveUser(
      tx,
      actorUserId,
      "当前采购经办人不存在或已停用"
    );
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      context.procurement.projectId
    );
    if (
      !roles.effectiveRoleKeys.some((role) =>
        HANDLER_ROLES.has(role)
      )
    ) {
      throw new ForbiddenException(
        "当前采购经办人不具备物资员或物资主管岗位"
      );
    }
  }

  private async requireMaterialDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string,
    message: string
  ) {
    await this.requireActiveUser(
      tx,
      actorUserId,
      "物资主管不存在或已停用"
    );
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      projectId
    );
    if (
      !roles.effectiveRoleKeys.includes("material_director")
    ) {
      throw new ForbiddenException(message);
    }
  }

  private async requireProjectFinanceStaff(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ) {
    await this.requireActiveUser(
      tx,
      actorUserId,
      "财务人员不存在或已停用"
    );
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      projectId
    );
    if (
      !roles.effectiveRoleKeys.includes("finance_staff") ||
      !roles.projectRoleKeys.includes("finance_staff")
    ) {
      throw new ForbiddenException(
        "只有当前项目财务人员可以登记供应商退款到账"
      );
    }
  }

  private async requireFinanceDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ) {
    await this.requireActiveUser(
      tx,
      actorUserId,
      "财务主管不存在或已停用"
    );
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      projectId
    );
    if (
      !roles.effectiveRoleKeys.includes("finance_director")
    ) {
      throw new ForbiddenException(
        "只有财务主管可以确认供应商余额转入或执行"
      );
    }
  }

  private async requireActiveUser(
    tx: Prisma.TransactionClient,
    userId: string,
    message: string
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true }
    });
    if (!user?.isActive) {
      throw new ForbiddenException(message);
    }
  }

  private async loadActorRoleScopes(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<ActorRoleScopes> {
    const [globalPositions, projectPositions, memberPositions] =
      await Promise.all([
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId: null },
          select: { positionId: true }
        }),
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionId: true }
        }),
        tx.projectMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionKey: true }
        })
      ]);
    const positionIds = [
      ...new Set(
        [...globalPositions, ...projectPositions].map(
          (position) => position.positionId
        )
      )
    ];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const roleByPositionId = new Map(
      positions.map((position) => [
        position.id,
        position.key as RoleKey
      ])
    );
    const globalRoleKeys = globalPositions.flatMap(
      (position) => {
        const role = roleByPositionId.get(position.positionId);
        return role ? [role] : [];
      }
    );
    const projectRoleKeys = [
      ...projectPositions.flatMap((position) => {
        const role = roleByPositionId.get(
          position.positionId
        );
        return role ? [role] : [];
      }),
      ...memberPositions.map(
        (position) => position.positionKey as RoleKey
      )
    ];
    return {
      effectiveRoleKeys: resolveEffectiveRoleKeys(
        globalRoleKeys,
        projectRoleKeys
      ),
      projectRoleKeys: [...new Set(projectRoleKeys)]
    };
  }

  private assertSameRefundFacts(
    refund: {
      procurementId: string;
      amountCents: bigint;
      receivedAt: Date;
      refundMethod: string;
      voucherFileId: string;
      recordedByUserId: string;
    },
    expected: {
      procurementId: string;
      amountCents: bigint;
      receivedAt: Date;
      refundMethod: string;
      voucherFileId: string;
      actorUserId: string;
    }
  ) {
    if (
      refund.procurementId !== expected.procurementId ||
      refund.amountCents !== expected.amountCents ||
      refund.receivedAt.getTime() !==
        expected.receivedAt.getTime() ||
      refund.refundMethod !== expected.refundMethod ||
      refund.voucherFileId !== expected.voucherFileId ||
      refund.recordedByUserId !== expected.actorUserId
    ) {
      throw new ConflictException(
        "幂等键已用于不同的供应商退款到账事实"
      );
    }
  }

  private assertRefundSettlementFacts(
    refund: {
      discrepancyId: string;
      procurementId: string;
      amountCents: bigint;
    },
    discrepancy: DiscrepancyLockRow,
    context: LockedSettlementContext
  ) {
    if (
      discrepancy.invalidatedAt ||
      discrepancy.status !== "resolved" ||
      discrepancy.resolutionType !== "full_refund" ||
      discrepancy.supplierBalanceEntryId !== null ||
      refund.discrepancyId !== discrepancy.id ||
      refund.procurementId !== context.procurement.id ||
      refund.amountCents !== discrepancy.overpaidAmountCents
    ) {
      throw new ConflictException(
        "供应商退款到账事实与收货差异不一致，请联系财务核对"
      );
    }
  }

  private async confirmedDiscrepancyResult(
    tx: Prisma.TransactionClient,
    discrepancy: DiscrepancyLockRow,
    context: LockedSettlementContext,
    payments: SettlementPaymentLockRow[]
  ) {
    if (discrepancy.resolutionType === "full_refund") {
      const refund =
        await tx.spotProcurementRefund.findUnique({
          where: { discrepancyId: discrepancy.id },
          select: {
            id: true,
            discrepancyId: true,
            procurementId: true,
            amountCents: true,
            receivedAt: true,
            refundMethod: true,
            voucherFileId: true,
            idempotencyKey: true
          }
        });
      if (refund) {
        this.assertRefundSettlementFacts(
          refund,
          discrepancy,
          context
        );
        return this.refundResult(
          refund,
          discrepancy,
          context,
          payments
        );
      }
      if (discrepancy.status === "resolved") {
        throw new ConflictException(
          "已解决的退款差异缺少供应商退款到账事实"
        );
      }
    }

    if (
      discrepancy.resolutionType ===
      "full_supplier_balance"
    ) {
      const entry = discrepancy.supplierBalanceEntryId
        ? await tx.supplierBalanceEntry.findUnique({
            where: {
              id: discrepancy.supplierBalanceEntryId
            },
            select: {
              id: true,
              accountId: true,
              procurementId: true,
              entryType: true,
              availableDeltaCents: true,
              reservedDeltaCents: true
            }
          })
        : null;
      if (entry) {
        if (
          discrepancy.status !== "resolved" ||
          entry.procurementId !== context.procurement.id ||
          entry.entryType !==
            "credit_from_discrepancy" ||
          entry.availableDeltaCents !==
            discrepancy.overpaidAmountCents ||
          entry.reservedDeltaCents !== 0n
        ) {
          throw new ConflictException(
            "供应商余额转入分录与收货差异不一致，请联系财务核对"
          );
        }
        return this.creditResult(
          discrepancy,
          context,
          payments,
          entry.accountId
        );
      }
      if (discrepancy.status === "resolved") {
        throw new ConflictException(
          "已解决的差异缺少供应商余额转入分录"
        );
      }
    }

    const financial = calculateFinancialFacts(
      payments,
      context.actualCostCents,
      context.version.totalAmountCents
    );
    return {
      discrepancy: discrepancyReadModel(discrepancy),
      settlement: settlementReadModel({
        ...financial,
        canceledUnexecutedAmountCents:
          discrepancy.canceledUnexecutedAmountCents,
        refundedAmountCents: 0n,
        transferredSupplierBalanceAmountCents: 0n
      }),
      paymentIds: payments.map((payment) => payment.id)
    };
  }

  private refundResult(
    refund: {
      id: string;
      amountCents: bigint;
      receivedAt: Date;
      refundMethod: string;
      voucherFileId: string;
      idempotencyKey: string;
    },
    discrepancy: DiscrepancyLockRow | {
      id: string;
      status: string;
      approvedAmountCentsSnapshot: bigint;
      actualCostCentsSnapshot: bigint;
      shortageAmountCents: bigint;
      canceledUnexecutedAmountCents: bigint;
      paidAmountCentsSnapshot: bigint;
      supplierBalanceUsedAmountCentsSnapshot: bigint;
      overpaidAmountCents: bigint;
      resolutionType: string | null;
      supplierBalanceEntryId: string | null;
      note: string | null;
    },
    context: LockedSettlementContext,
    payments: SettlementPaymentLockRow[]
  ) {
    const financial = calculateFinancialFacts(
      payments,
      context.actualCostCents,
      context.version.totalAmountCents
    );
    return {
      refund: refundReadModel(refund),
      discrepancy: discrepancyReadModel(discrepancy),
      settlement: settlementReadModel({
        ...financial,
        canceledUnexecutedAmountCents:
          discrepancy.canceledUnexecutedAmountCents,
        refundedAmountCents: refund.amountCents,
        transferredSupplierBalanceAmountCents: 0n
      }),
      paymentIds: payments.map((payment) => payment.id)
    };
  }

  private creditResult(
    discrepancy: DiscrepancyLockRow | {
      id: string;
      status: string;
      approvedAmountCentsSnapshot: bigint;
      actualCostCentsSnapshot: bigint;
      shortageAmountCents: bigint;
      canceledUnexecutedAmountCents: bigint;
      paidAmountCentsSnapshot: bigint;
      supplierBalanceUsedAmountCentsSnapshot: bigint;
      overpaidAmountCents: bigint;
      resolutionType: string | null;
      supplierBalanceEntryId: string | null;
      note: string | null;
    },
    context: LockedSettlementContext,
    payments: SettlementPaymentLockRow[],
    accountId: string | null = null
  ) {
    const financial = calculateFinancialFacts(
      payments,
      context.actualCostCents,
      context.version.totalAmountCents
    );
    return {
      supplierBalance: {
        accountId,
        entryId: discrepancy.supplierBalanceEntryId,
        amountCents: discrepancy.overpaidAmountCents.toString()
      },
      discrepancy: discrepancyReadModel(discrepancy),
      settlement: settlementReadModel({
        ...financial,
        canceledUnexecutedAmountCents:
          discrepancy.canceledUnexecutedAmountCents,
        refundedAmountCents: 0n,
        transferredSupplierBalanceAmountCents:
          discrepancy.overpaidAmountCents
      }),
      paymentIds: payments.map((payment) => payment.id)
    };
  }

  private balanceExecutionResult(
    payment: SettlementPaymentLockRow,
    amountCents: bigint,
    entryId: string | null
  ) {
    return {
      supplierBalanceExecution: {
        entryId,
        amountCents: amountCents.toString()
      },
      payment: {
        id: payment.id,
        status: payment.status,
        paidAmountCents: payment.paidAmountCents.toString(),
        executedSupplierBalanceAmountCents:
          payment.executedSupplierBalanceAmountCents.toString(),
        canceledAmountCents:
          payment.canceledAmountCents.toString()
      }
    };
  }

  private async readRefundResult(refund: {
    discrepancyId: string;
    procurementId: string;
    id: string;
    amountCents: bigint;
    receivedAt: Date;
    refundMethod: string;
    voucherFileId: string;
    idempotencyKey: string;
  }) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const context =
          await this.requireLockedReviewedContext(
            tx,
            refund.procurementId
          );
        const payments =
          await this.lockProcurementPayments(
            tx,
            refund.procurementId
          );
        const currentPayments = payments.filter(
          (payment) =>
            payment.procurementVersionId ===
              context.version.id && !payment.invalidatedAt
        );
        const discrepancy =
          await tx.spotProcurementDiscrepancy.findUniqueOrThrow({
            where: { id: refund.discrepancyId }
          });
        await this.assertPaymentExecutionFacts(
          tx,
          currentPayments
        );
        this.assertDiscrepancyCoordinates(
          discrepancy,
          context
        );
        const financial = calculateFinancialFacts(
          currentPayments,
          context.actualCostCents,
          context.version.totalAmountCents
        );
        this.assertFinancialFacts(financial);
        this.assertDiscrepancySnapshot(
          discrepancy,
          context,
          financial
        );
        this.assertRefundSettlementFacts(
          refund,
          discrepancy,
          context
        );
        return this.refundResult(
          refund,
          discrepancy,
          context,
          currentPayments
        );
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead
      }
    );
    return {
      refund: result.refund,
      discrepancy: result.discrepancy,
      settlement: result.settlement
    };
  }

  private async refreshPaymentForms(
    paymentIds: string[],
    actorUserId: string,
    reason: string
  ) {
    await Promise.all(
      [...new Set(paymentIds)].map((paymentId) =>
        this.approvalForms.tryRefreshLatestForBusiness(
          SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          paymentId,
          actorUserId,
          reason
        )
      )
    );
  }

  private runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    return this.prisma.$transaction(operation, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    });
  }

  private async runWrite<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2034") {
        throw new ConflictException(
          "差异、退款或供应商余额已变化，请刷新后重试"
        );
      }
      if (
        code === "P2002" ||
        code === "P2003" ||
        code === "P2025"
      ) {
        throw new ConflictException(
          "零星采购结算唯一事实已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }
}

export function calculateFinancialFacts(
  payments: SettlementPaymentLockRow[],
  actualCostCents: bigint,
  purchaseApprovedAmountCents: bigint | null
) {
  const activePayments = payments.filter(
    (payment) =>
      ACTIVE_PAYMENT_STATUSES.has(payment.status) &&
      !payment.invalidatedAt
  );
  const isRealForm = activePayments.some(
    (payment) => payment.paymentType !== null
  );
  if (
    isRealForm &&
    activePayments.some((payment) => payment.paymentType === null)
  ) {
    throw new ConflictException(
      "当前采购混入新旧付款事实，不能计算收货结算"
    );
  }
  if (
    isRealForm &&
    activePayments.some(
      (payment) =>
        payment.supplierBalanceAmountCents !== 0n ||
        payment.executedSupplierBalanceAmountCents !== 0n ||
        payment.canceledSupplierBalanceAmountCents !== 0n
    )
  ) {
    throw new ConflictException(
      "零星采购真实表单不得保留或使用商户余额"
    );
  }
  if (!isRealForm && purchaseApprovedAmountCents === null) {
    throw new ConflictException(
      "历史采购缺少批准金额，不能计算收货结算"
    );
  }
  const approvedAmountCents: bigint = isRealForm
    ? activePayments.reduce(
        (total, payment) => total + payment.approvalAmountCents,
        0n
      )
    : purchaseApprovedAmountCents!;
  const approvedPaymentCoverageAmountCents =
    activePayments.reduce(
    (total, payment) =>
      total +
      nonnegative(
        (isRealForm
          ? payment.approvalAmountCents
          : payment.settlementAmountCents) -
          payment.canceledAmountCents
      ),
    0n
  );
  const companyPaidAmountCents = activePayments.reduce(
    (total, payment) => total + payment.paidAmountCents,
    0n
  );
  const executedSupplierBalanceAmountCents =
    activePayments.reduce(
      (total, payment) =>
        total +
        payment.executedSupplierBalanceAmountCents,
      0n
    );
  const canceledUnexecutedAmountCents =
    activePayments.reduce(
      (total, payment) =>
        total + payment.canceledAmountCents,
      0n
    );
  const grossExecutedAmountCents =
    companyPaidAmountCents +
    executedSupplierBalanceAmountCents;
  return {
    isRealForm,
    approvedAmountCents,
    approvedPaymentCoverageAmountCents,
    actualCostCents,
    shortageAmountCents: nonnegative(
      approvedAmountCents - actualCostCents
    ),
    companyPaidAmountCents,
    executedSupplierBalanceAmountCents,
    grossExecutedAmountCents,
    canceledUnexecutedAmountCents,
    overpaidAmountCents: nonnegative(
      grossExecutedAmountCents - actualCostCents
    ),
    remainingPayableAmountCents: nonnegative(
      actualCostCents - grossExecutedAmountCents
    )
  };
}

function settlementReadModel(
  facts: ReturnType<typeof calculateFinancialFacts> & {
    refundedAmountCents: bigint;
    transferredSupplierBalanceAmountCents: bigint;
    canceledUnexecutedAmountCents: bigint;
  }
) {
  const fundsSettledAmountCents =
    facts.grossExecutedAmountCents -
    facts.refundedAmountCents -
    facts.transferredSupplierBalanceAmountCents;
  return {
    approvedPaymentCoverageAmountCents:
      facts.approvedPaymentCoverageAmountCents.toString(),
    purchaseApprovedAmountCents:
      facts.approvedAmountCents.toString(),
    actualCostCents: facts.actualCostCents.toString(),
    shortageAmountCents:
      facts.shortageAmountCents.toString(),
    companyPaidAmountCents:
      facts.companyPaidAmountCents.toString(),
    executedSupplierBalanceAmountCents:
      facts.executedSupplierBalanceAmountCents.toString(),
    grossExecutedAmountCents:
      facts.grossExecutedAmountCents.toString(),
    canceledUnexecutedAmountCents:
      facts.canceledUnexecutedAmountCents.toString(),
    refundedAmountCents:
      facts.refundedAmountCents.toString(),
    transferredSupplierBalanceAmountCents:
      facts.transferredSupplierBalanceAmountCents.toString(),
    fundsSettledAmountCents:
      fundsSettledAmountCents.toString(),
    remainingPayableAmountCents:
      nonnegative(
        facts.actualCostCents - fundsSettledAmountCents
      ).toString(),
    overpaidAmountCents:
      nonnegative(
        fundsSettledAmountCents - facts.actualCostCents
      ).toString()
  };
}

function discrepancyReadModel(discrepancy: {
  id: string;
  status: string;
  approvedAmountCentsSnapshot: bigint;
  actualCostCentsSnapshot: bigint;
  shortageAmountCents: bigint;
  canceledUnexecutedAmountCents: bigint;
  paidAmountCentsSnapshot: bigint;
  supplierBalanceUsedAmountCentsSnapshot: bigint;
  overpaidAmountCents: bigint;
  resolutionType: string | null;
  supplierBalanceEntryId?: string | null;
  note: string | null;
}) {
  return {
    id: discrepancy.id,
    status: discrepancy.status,
    approvedAmountCents:
      discrepancy.approvedAmountCentsSnapshot.toString(),
    actualCostCents:
      discrepancy.actualCostCentsSnapshot.toString(),
    shortageAmountCents:
      discrepancy.shortageAmountCents.toString(),
    canceledUnexecutedAmountCents:
      discrepancy.canceledUnexecutedAmountCents.toString(),
    companyPaidAmountCents:
      discrepancy.paidAmountCentsSnapshot.toString(),
    executedSupplierBalanceAmountCents:
      discrepancy.supplierBalanceUsedAmountCentsSnapshot.toString(),
    overpaidAmountCents:
      discrepancy.overpaidAmountCents.toString(),
    resolutionType: discrepancy.resolutionType,
    supplierBalanceEntryId:
      discrepancy.supplierBalanceEntryId ?? null,
    note: discrepancy.note
  };
}

function refundReadModel(refund: {
  id: string;
  amountCents: bigint;
  receivedAt: Date;
  refundMethod: string;
  voucherFileId: string;
  idempotencyKey: string;
}) {
  return {
    id: refund.id,
    amountCents: refund.amountCents.toString(),
    receivedAt: refund.receivedAt.toISOString(),
    refundMethod: refund.refundMethod,
    voucherFileId: refund.voucherFileId,
    idempotencyKey: refund.idempotencyKey
  };
}

function parsePositiveMoney(value: string, fieldName: string) {
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new BadRequestException(
      `${fieldName}必须按分填写为整数`
    );
  }
  const amount = BigInt(value);
  if (
    !isWithinPostgresBigIntRange(amount) ||
    amount <= 0n
  ) {
    throw new BadRequestException(`${fieldName}必须大于 0`);
  }
  return amount;
}

function parsePastDate(value: string, fieldName: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName}格式不正确`);
  }
  if (date.getTime() > Date.now()) {
    throw new BadRequestException(`${fieldName}不能晚于当前时间`);
  }
  return date;
}

function requiredText(value: string, message: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestException(message);
  }
  return normalized;
}

function optionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function nonnegative(value: bigint) {
  return value > 0n ? value : 0n;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (code === "P2010") {
    const meta = (error as { meta?: unknown }).meta;
    if (
      meta &&
      typeof meta === "object" &&
      ["40001", "40P01"].includes(
        String((meta as { code?: unknown }).code)
      )
    ) {
      return "P2034";
    }
  }
  if (code === "40P01") {
    return "P2034";
  }
  return typeof code === "string" ? code : undefined;
}
