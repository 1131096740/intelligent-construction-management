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
  type RoleKey,
  type SpotProcurementPaymentMethod
} from "@jiangkong/shared-domain";
import { pendingRoleKeysForFrozenApprovalNode } from "../approval/approval-node-access";
import { ApprovalFormService } from "../approval/approval-form.service";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt } from "../money/decimal-money";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import type { RecordSpotProcurementPaymentDto } from "./dto/record-spot-procurement-payment.dto";
import type { AbandonSpotProcurementPaymentDraftDto } from "./dto/abandon-spot-procurement-payment-draft.dto";
import type { ReviewSpotProcurementPaymentDto } from "./dto/review-spot-procurement-payment.dto";
import type { UpdateSpotPaymentPayerDto } from "./dto/update-spot-payment-payer.dto";
import {
  type SpotProcurementPaymentAttachmentDto,
  type SpotProcurementPaymentChannelDto,
  SPOT_PROCUREMENT_PAYMENT_METHODS,
  type SpotProcurementPaymentPath,
  type UpdateSpotProcurementPaymentDraftDto
} from "./dto/update-spot-procurement-payment-draft.dto";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { SpotProcurementClosureService } from "./spot-procurement-closure.service";
import {
  paymentApprovalNodes,
  type SpotProcurementApprovalNode
} from "./spot-procurement-approval-nodes";
import { deriveSpotProcurementPaymentExecutionStatus } from "./spot-procurement-payment-status";
import { isSpotPaymentPayerTaskComplete } from "./spot-payment-payer-task";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementPaymentArchiveService } from "./spot-procurement-payment-archive.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";
import { calculateSpotProcurementLine } from "./spot-procurement-money";

const HANDLER_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const VOID_ROLES = new Set<RoleKey>([
  "project_manager",
  "finance_director"
]);
const ACTIVE_CAPACITY_STATUSES = new Set([
  "approval_pending",
  "approved",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
]);
const SPOT_MATERIAL_PAYMENT_LIMIT_CENTS = 300_000n;
const PLANNED_PAYMENT_STATUSES = ACTIVE_CAPACITY_STATUSES;
const PAYER_TASK_COMPLETED_ERROR = {
  code: "SPOT_PAYMENT_PAYER_TASK_COMPLETED",
  message: "付款主体任务已由其他岗位完成，请刷新后查看最新事实"
} as const;
const EXISTING_PAYER_IMMUTABLE_ERROR = {
  code: "SPOT_PAYMENT_EXISTING_PAYER_IMMUTABLE",
  message: "已有付款主体只能补齐名称或拟付款方式，不能变更主体"
} as const;
const NON_VOIDABLE_EXECUTION_STATUSES = new Set([
  "partially_paid",
  "paid",
  "settled"
]);
const VOIDABLE_PAYMENT_STATUSES = new Set([
  "draft",
  "approval_pending",
  "approved_pending_payment"
]);
const PAYMENT_METHODS = new Set<string>(
  SPOT_PROCUREMENT_PAYMENT_METHODS
);
const VAT_RATE_PERCENT = /^(?:(?:0|[1-9]\d?)(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/u;
type VersionLockRow = {
  id: string;
  procurementId: string;
  projectId: string;
  procurementCode: string;
  currentVersionId: string | null;
  rootStatus: string;
  versionStatus: string;
  versionNo: number;
  supplierPartyId: string | null;
  supplierKey: string;
  supplierNameSnapshot: string;
  handlerUserId: string;
  totalAmountCents: bigint;
};

type PaymentLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  code: string;
  status: string;
  settlementAmountCents: bigint;
  supplierBalanceAmountCents: bigint;
  companyPaymentAmountCents: bigint;
  paidAmountCents: bigint;
  executedSupplierBalanceAmountCents: bigint;
  canceledAmountCents: bigint;
  canceledCompanyPaymentAmountCents: bigint;
  canceledSupplierBalanceAmountCents: bigint;
  paymentPath: string | null;
  paymentMethod: string | null;
  payeePartyId: string | null;
  payeeUserId: string | null;
  payeeNameSnapshot: string | null;
  payeeAccountNameSnapshot: string | null;
  payeeBankNameSnapshot: string | null;
  payeeBankAccountSnapshot: string | null;
  expectedPaymentAt: Date | null;
  paymentNote: string | null;
  supportingAttachmentFileId: string | null;
  merchantPaymentProofFileId: string | null;
  balanceOverrideReason: string | null;
  handlerUserId: string;
  createdByUserId: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  invalidatedAt: Date | null;
  invalidatedByUserId: string | null;
  invalidatedReason: string | null;
  paymentType: string | null;
  merchantNameSnapshot: string | null;
  merchantPayeeMismatchNote: string | null;
  payerCompanyEntityId: string | null;
  payerCompanyNameSnapshot: string | null;
  payerUnifiedSocialCreditCodeSnapshot: string | null;
  approvalAmountCents: bigint;
  primaryPaymentChannelId: string | null;
  factsFrozenAt: Date | null;
  draftOrigin: string | null;
  sourcePaymentId: string | null;
  updatedAt: Date;
};

type PaymentReservationLockRow = {
  paymentId: string;
  amountCents: bigint;
  releasedAmountCents: bigint;
  status: string;
};

type ApprovalLockRow = {
  id: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: Prisma.JsonValue;
  applicantUserId: string;
};

type SpotPaymentExecutionRow = {
  id: string;
  paymentId: string;
  amountCents: bigint;
  paidAt: Date;
  paymentMethod: string;
  paymentChannelId: string | null;
  executedByUserId: string;
  voucherFileId: string | null;
  idempotencyKey: string;
  voidedAt: Date | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: Date;
};

type PreparedPayment = {
  settlementAmountCents: bigint;
  supplierBalanceAmountCents: bigint;
  companyPaymentAmountCents: bigint;
  paymentPath: SpotProcurementPaymentPath | null;
  paymentMethod: string | null;
  payeePartyId: string | null;
  payeeUserId: string | null;
  payeeNameSnapshot: string;
  payeeAccountNameSnapshot: string | null;
  payeeBankNameSnapshot: string | null;
  payeeBankAccountSnapshot: string | null;
  expectedPaymentAt: Date | null;
  paymentNote: string | null;
  supportingAttachmentFileId: string | null;
  merchantPaymentProofFileId: string | null;
  balanceOverrideReason: string | null;
};

@Injectable()
export class SpotProcurementPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly balances: SpotProcurementBalanceService,
    private readonly auth: AuthService,
    private readonly files: FileService,
    private readonly approvalForms: ApprovalFormService,
    private readonly closure: SpotProcurementClosureService,
    private readonly projectFunding: ProjectFundingAvailabilityService,
    private readonly archives?: SpotProcurementPaymentArchiveService
  ) {}

  async recordExecution(
    paymentId: string,
    actorUserId: string,
    input: RecordSpotProcurementPaymentDto
  ): Promise<{
    execution: {
      id: string;
      amountCents: string;
      voucherFileId: string | null;
      paidAt: string;
      paymentMethod: string;
      paymentChannelId: string | null;
      idempotencyKey: string;
      voucherFileIds: string[];
    };
    payment: {
      id: string;
      status: string;
      paidAmountCents: string;
      remainingCompanyPaymentAmountCents: string;
    };
  }> {
    const amountCents = parsePositiveExecutionAmount(
      input.amountCents
    );
    const paidAt = new Date(input.paidAt);
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException("实付日期格式不正确");
    }
    if (paidAt.getTime() > Date.now()) {
      throw new BadRequestException("实付日期不能晚于当前时间");
    }
    if (!PAYMENT_METHODS.has(input.paymentMethod)) {
      throw new BadRequestException("实际付款方式不正确");
    }
    const voucherFileIds = requiredExecutionVoucherFileIds(input);
    const voucherFileId = voucherFileIds[0];
    const paymentChannelId = optionalExecutionText(input.paymentChannelId);
    const idempotencyKey = requiredExecutionText(
      input.idempotencyKey,
      "幂等键不能为空",
      128,
      "幂等键不能超过 128 个字符"
    );
    const confirmationPassword = requiredExecutionText(
      input.confirmationPassword,
      "请输入当前登录密码",
      256,
      "当前密码不能超过 256 个字符"
    );

    await Promise.all(
      voucherFileIds.map((fileId) =>
        this.files.assertCanDownloadFileById(fileId, actorUserId)
      )
    );
    await this.auth.confirmPassword(
      actorUserId,
      confirmationPassword
    );

    try {
      const result = await this.runSerializable(async (tx) => {
        const fundingScope =
          await tx.spotProcurementPayment.findUnique({
            where: { id: paymentId },
            select: { id: true, projectId: true }
          });
        if (!fundingScope) {
          throw new NotFoundException("付款申请不存在");
        }
        // 统一锁序：项目 -> 垫资来源 -> 采购版本 -> 该采购全部付款 -> 实付明细。
        await this.projectFunding.lockFundingContext(
          tx,
          fundingScope.projectId
        );
        const version = await this.requireLockedVersionForPayment(
          tx,
          paymentId
        );
        this.pilot.assertEnabled(version.projectId);
        const procurementPayments =
          await this.lockProcurementPayments(
            tx,
            version.procurementId
          );
        const payment = this.requirePayment(
          procurementPayments,
          paymentId
        );
        if (
          fundingScope.id !== payment.id ||
          fundingScope.projectId !== version.projectId ||
          fundingScope.projectId !== payment.projectId
        ) {
          throw new ConflictException(
            "零星采购付款的项目资金范围已变化，请刷新后重试"
          );
        }
        const isRealFormPayment = Boolean(payment.paymentType);
        await this.requireActiveUser(
          tx,
          actorUserId,
          "实际付款登记人不存在或已停用"
        );
        const actorRoles = await this.loadActorRoleScopes(
          tx,
          actorUserId,
          version.projectId
        );
        if (
          !actorRoles.effectiveRoleKeys.includes("finance_staff") ||
          !actorRoles.projectRoleKeys.includes("finance_staff")
        ) {
          throw new ForbiddenException(
            "只有当前项目财务人员可以登记零星采购实际付款"
          );
        }

        const existingByIdempotencyKey =
          await tx.spotProcurementPaymentExecution.findUnique({
            where: { idempotencyKey }
          });
        if (existingByIdempotencyKey) {
          if (isRealFormPayment) {
            await this.assertSameRealExecutionFacts(
              tx,
              existingByIdempotencyKey,
              {
                paymentId,
                amountCents,
                paidAt,
                paymentMethod: input.paymentMethod,
                actorUserId,
                voucherFileIds,
                paymentChannelId
              }
            );
          } else {
            this.assertSameExecutionFacts(existingByIdempotencyKey, {
              paymentId,
              amountCents,
              paidAt,
              paymentMethod: input.paymentMethod,
              actorUserId,
              voucherFileId
            });
          }
          await this.projectFunding.allocateExecution(tx, {
            projectId: version.projectId,
            executionType:
              "spot_procurement_payment_execution",
            executionId: existingByIdempotencyKey.id,
            businessType:
              SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: payment.id,
            amountCents,
            occurredAt: paidAt,
            actorUserId
          });
          return this.executionReadModel(
            existingByIdempotencyKey,
            payment,
            isRealFormPayment ? voucherFileIds : undefined
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
            "收货差异正在等待物资主管确认，暂不能登记实际付款"
          );
        }

        if (
          !["approved_pending_payment", "partially_paid"].includes(
            payment.status
          )
        ) {
          throw new ConflictException(
            payment.status === "approval_pending"
              ? "当前付款申请尚未批准，不能登记实际付款"
              : "当前付款申请状态不允许登记实际付款"
          );
        }

        let approvedChannel: { id: string; channelType: string } | null = null;
        if (isRealFormPayment) {
          if (
            !payment.payerCompanyEntityId ||
            !payment.payerCompanyNameSnapshot ||
            !payment.payeeNameSnapshot ||
            !paymentChannelId
          ) {
            throw new ConflictException(
              "付款主体、收款对象或付款渠道未冻结，不能登记实际付款"
            );
          }
          const [methods, channels] = await Promise.all([
            tx.spotProcurementPaymentMethodOption.findMany({
              where: { paymentId: payment.id },
              select: { paymentMethod: true }
            }),
            tx.spotProcurementPaymentChannel.findMany({
              where: { paymentId: payment.id },
              select: { id: true, channelType: true }
            })
          ]);
          if (!methods.some((row) => row.paymentMethod === input.paymentMethod)) {
            throw new BadRequestException("实际付款方式不在审批通过的拟付款方式内");
          }
          approvedChannel = channels.find((row) => row.id === paymentChannelId) ?? null;
          if (!approvedChannel || approvedChannel.channelType !== input.paymentMethod) {
            throw new BadRequestException("实际付款渠道不属于审批通过的付款方式");
          }
        }

        const effectiveCompanyPaymentAmountCents =
          this.effectiveCompanyPaymentAmount(payment);
        const remainingCompanyPaymentAmountCents =
          effectiveCompanyPaymentAmountCents -
          payment.paidAmountCents;
        if (
          remainingCompanyPaymentAmountCents <= 0n ||
          amountCents > remainingCompanyPaymentAmountCents
        ) {
          throw new BadRequestException(
            `实付金额超过剩余公司付款额度，当前最多可实付 ${
              remainingCompanyPaymentAmountCents > 0n
                ? remainingCompanyPaymentAmountCents
                : 0n
            } 分`
          );
        }

        const vouchers = isRealFormPayment
          ? await tx.fileObject.findMany({
              where: { id: { in: voucherFileIds } },
              select: { id: true, storageStatus: true, uploadedByUserId: true }
            })
          : [await tx.fileObject.findUnique({
              where: { id: voucherFileId },
              select: { id: true, storageStatus: true, uploadedByUserId: true }
            })];
        if (vouchers.length !== voucherFileIds.length || vouchers.some((voucher) => !voucher)) {
          throw new NotFoundException("付款凭证不存在");
        }
        for (const voucher of vouchers) {
          if (voucher!.storageStatus !== "active") {
            throw new BadRequestException("付款凭证当前不可用");
          }
          await this.files.assertCanDownloadFile(tx, voucher!.id, actorUserId);
        }

        const activeExecutions =
          await this.lockActivePaymentExecutions(
            tx,
            payment.id
          );
        const activeExecutionTotal = activeExecutions.reduce(
          (total, execution) =>
            total +
            dbMoneyToBigInt(
              execution.amountCents,
              "零星采购实际付款金额"
            ),
          0n
        );
        if (activeExecutionTotal !== payment.paidAmountCents) {
          throw new ConflictException(
            "付款累计已付与实际付款明细不一致，请联系财务核对"
          );
        }

        const existingVoucher = isRealFormPayment
          ? await tx.spotProcurementPaymentExecutionVoucher.findFirst({
              where: { fileId: { in: voucherFileIds } },
              select: { id: true, paymentExecutionId: true, fileId: true }
            })
          : await tx.spotProcurementPaymentExecution.findFirst({
              where: {
                voucherFileId,
                voidedAt: null
              },
              select: {
                id: true,
                paymentId: true,
                voucherFileId: true
              }
            });
        if (existingVoucher) {
          throw new ConflictException(
            "该付款凭证已绑定其他有效实际付款记录"
          );
        }
        await Promise.all(
          voucherFileIds.map((fileId) =>
            this.files.assertFileHasNoBusinessBinding(tx, fileId)
          )
        );

        const newPaidAmountCents =
          payment.paidAmountCents + amountCents;
        const newStatus =
          deriveSpotProcurementPaymentExecutionStatus({
            ...payment,
            paidAmountCents: newPaidAmountCents
          });
        const execution =
          await tx.spotProcurementPaymentExecution.create({
            data: {
              paymentId: payment.id,
              amountCents,
              paidAt,
              paymentMethod: input.paymentMethod,
              ...(isRealFormPayment
                ? { paymentChannelId: approvedChannel!.id }
                : {}),
              executedByUserId: actorUserId,
              voucherFileId: isRealFormPayment ? null : voucherFileId,
              idempotencyKey
            }
          });
        if (isRealFormPayment) {
          await tx.spotProcurementPaymentExecutionVoucher.createMany({
            data: voucherFileIds.map((fileId, index) => ({
              paymentExecutionId: execution.id,
              fileId,
              sortOrder: index + 1,
              uploadedByUserId: actorUserId
            }))
          });
        }
        const fundingAllocation =
          await this.projectFunding.allocateExecution(tx, {
            projectId: version.projectId,
            executionType:
              "spot_procurement_payment_execution",
            executionId: execution.id,
            businessType:
              SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: payment.id,
            amountCents,
            occurredAt: paidAt,
            actorUserId
          });
        const updated =
          await tx.spotProcurementPayment.updateMany({
            where: {
              id: payment.id,
              status: payment.status,
              paidAmountCents: payment.paidAmountCents,
              companyPaymentAmountCents:
                payment.companyPaymentAmountCents,
              canceledCompanyPaymentAmountCents:
                payment.canceledCompanyPaymentAmountCents
            },
            data: {
              paidAmountCents: newPaidAmountCents,
              status: newStatus
            }
          });
        if (updated.count !== 1) {
          throw new ConflictException(
            "付款状态或已付金额已变化，请刷新后重试"
          );
        }

        const paymentAfter = {
          ...payment,
          paidAmountCents: newPaidAmountCents,
          status: newStatus
        };
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.execution.record",
          businessType:
            SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            executionId: execution.id,
            paymentId: payment.id,
            projectId: payment.projectId,
            amountCents: amountCents.toString(),
            paidAt: paidAt.toISOString(),
            paymentMethod: input.paymentMethod,
            voucherFileId,
            voucherFileIds,
            paymentChannelId: isRealFormPayment ? approvedChannel!.id : null,
            actorUserId,
            statusBefore: payment.status,
            statusAfter: newStatus,
            paidAmountCents: newPaidAmountCents.toString(),
            remainingCompanyPaymentAmountCents: (
              effectiveCompanyPaymentAmountCents -
              newPaidAmountCents
            ).toString(),
            fundingAllocation: {
              kind: fundingAllocation.kind,
              projectCashAmountCents:
                fundingAllocation.projectCashAmountCents.toString(),
              financingQuotaAmountCents:
                fundingAllocation.financingQuotaAmountCents.toString(),
              allocations:
                fundingAllocation.allocations.map((allocation) => ({
                  sourceType: allocation.sourceType,
                  sourceId: allocation.sourceId,
                  amountCents:
                    allocation.amountCents.toString()
                }))
            }
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          version.procurementId,
          "payment.execution.record",
          actorUserId
        );
        return this.executionReadModel(
          execution,
          paymentAfter,
          isRealFormPayment ? voucherFileIds : undefined
        );
      });
      await this.approvalForms.tryRefreshLatestForBusiness(
        SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        paymentId,
        actorUserId,
        "payment.execution.record"
      );
      await this.archives?.tryCreateVersion(
        paymentId,
        actorUserId,
        "payment.execution.record"
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2002") {
        const concurrentResult =
          await this.resolveConcurrentExecutionResult({
            paymentId,
            actorUserId,
            amountCents,
            paidAt,
            paymentMethod: input.paymentMethod,
            voucherFileIds,
            paymentChannelId,
            idempotencyKey
          });
        if (concurrentResult) {
          await this.approvalForms.tryRefreshLatestForBusiness(
            SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            paymentId,
            actorUserId,
            "payment.execution.record"
          );
          await this.archives?.tryCreateVersion(
            paymentId,
            actorUserId,
            "payment.execution.record"
          );
          return concurrentResult;
        }
        throw new ConflictException(
          "实际付款唯一事实已变化，请刷新后重试"
        );
      }
      if (code === "P2034") {
        const concurrentResult =
          await this.resolveConcurrentExecutionResult({
            paymentId,
            actorUserId,
            amountCents,
            paidAt,
            paymentMethod: input.paymentMethod,
            voucherFileIds,
            paymentChannelId,
            idempotencyKey
          });
        if (concurrentResult) {
          await this.approvalForms.tryRefreshLatestForBusiness(
            SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            paymentId,
            actorUserId,
            "payment.execution.record"
          );
          await this.archives?.tryCreateVersion(
            paymentId,
            actorUserId,
            "payment.execution.record"
          );
          return concurrentResult;
        }
        throw new ConflictException(
          "实际付款并发冲突，请刷新后重试"
        );
      }
      if (code === "P2003" || code === "P2025") {
        throw new ConflictException(
          "实际付款关联数据已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }

  createNextDraft(procurementId: string, actorUserId: string) {
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const version = await this.requireLockedCurrentApprovedVersion(
          tx,
          procurementId
        );
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(tx, version.procurementId);
        const { payment, suggestion, amountCents } = await this.createLegacyNextDraft(
          tx,
          version,
          payments,
          actorUserId
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.draft.create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            procurementId: version.procurementId,
            procurementVersionId: version.id,
            settlementAmountCents: amountCents.toString(),
            suggestedBalanceAmountCents:
              suggestion.suggestedBalanceAmountCents
          }
        });
        return this.paymentReadModel(payment, suggestion);
      })
    );
  }

  recreateDraft(procurementId: string, actorUserId: string) {
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const version = await this.requireLockedCurrentApprovedVersion(tx, procurementId);
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(tx, version.procurementId);
        await this.requireHandler(tx, version, actorUserId);
        if (payments.some((payment) => payment.status === "draft" || ACTIVE_CAPACITY_STATUSES.has(payment.status))) {
          throw new ConflictException("当前采购已存在活动付款草稿或申请");
        }
        const source = payments
          .filter((payment) => payment.procurementVersionId === version.id && payment.status === "invalidated")
          .sort(
            (left, right) => {
              const timeDifference =
                (right.invalidatedAt?.getTime() ?? 0) -
                (left.invalidatedAt?.getTime() ?? 0);
              return timeDifference || right.id.localeCompare(left.id);
            }
          )[0];
        if (!source) {
          throw new ConflictException("当前采购没有可重新创建的已放弃付款草稿");
        }
        const facts = await this.lockPaymentTerminationFacts(
          tx,
          payments.map((payment) => payment.id)
        );
        const sourceReservation = facts.reservations.find(
          (reservation) => reservation.paymentId === source.id
        );
        if (
          facts.approvalBusinessIds.has(source.id) ||
          facts.executionPaymentIds.has(source.id) ||
          facts.invoicePaymentIds.has(source.id) ||
          facts.archivePaymentIds.has(source.id) ||
          facts.refundPaymentIds.has(source.id) ||
          (sourceReservation !== undefined &&
            (sourceReservation.status === "executed" ||
              sourceReservation.amountCents > sourceReservation.releasedAmountCents))
        ) {
          throw new ConflictException("已放弃付款草稿存在正式事实或残余额度占用，不能重新创建");
        }

        if (version.totalAmountCents !== null) {
          const { payment, suggestion } = await this.createLegacyNextDraft(
            tx,
            version,
            payments,
            actorUserId,
            { draftOrigin: "manual_recreate", sourcePaymentId: source.id }
          );
          await this.recordDraftRecreationAudit(tx, actorUserId, version, source.id, payment.id);
          return this.paymentReadModel(payment, suggestion, {
            sourcePaymentId: source.id,
            draftOrigin: "manual_recreate"
          });
        }

        const payment = await this.createDraftFromFacts(
          tx,
          version,
          payments,
          {
            settlementAmountCents: 0n,
            supplierBalanceAmountCents: 0n,
            companyPaymentAmountCents: 0n,
            paymentPath: null,
            paymentMethod: null,
            payeePartyId: null,
            payeeUserId: null,
            payeeNameSnapshot: null,
            payeeAccountNameSnapshot: null,
            payeeBankNameSnapshot: null,
            payeeBankAccountSnapshot: null,
            expectedPaymentAt: null,
            paymentNote: null,
            supportingAttachmentFileId: null,
            merchantPaymentProofFileId: null,
            balanceOverrideReason: null,
            handlerUserId: version.handlerUserId
          },
          actorUserId,
          { draftOrigin: "manual_recreate", sourcePaymentId: source.id }
        );
        await this.recordDraftRecreationAudit(tx, actorUserId, version, source.id, payment.id);
        return this.paymentReadModel(payment, undefined, {
          sourcePaymentId: source.id,
          draftOrigin: "manual_recreate"
        });
      })
    );
  }

  abandonDraft(
    paymentId: string,
    actorUserId: string,
    input: AbandonSpotProcurementPaymentDraftDto
  ) {
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(tx, paymentId);
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(tx, version.procurementId);
        const payment = this.requirePayment(payments, paymentId);
        await this.requireHandler(tx, version, actorUserId, payment);
        if (payment.handlerUserId !== actorUserId) {
          throw new ForbiddenException("只有当前采购经办人可以放弃付款草稿");
        }
        if (payment.status === "invalidated" && payment.invalidatedAt) {
          return this.paymentReadModel(payment);
        }
        const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
        if (payment.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new ConflictException("付款草稿已被更新，请刷新后重试");
        }
        const reason = requiredText(input.reason, "请填写放弃付款草稿原因");
        if (payment.status !== "draft" || payment.submittedAt !== null) {
          throw new ConflictException("只能放弃尚未提交的付款草稿");
        }

        const facts = await this.lockPaymentTerminationFacts(tx, payments.map((row) => row.id));
        if (facts.approvalBusinessIds.has(payment.id)) {
          throw new ConflictException("付款草稿已形成审批历史，不能放弃");
        }
        if (facts.executionPaymentIds.has(payment.id)) {
          throw new ConflictException("付款草稿已形成实际付款历史，不能放弃");
        }
        const reservation = facts.reservations.find((row) => row.paymentId === payment.id);
        if (reservation?.status === "executed") {
          throw new ConflictException("付款草稿已执行供应商余额抵扣，不能放弃");
        }
        if (facts.invoicePaymentIds.has(payment.id) || facts.archivePaymentIds.has(payment.id) || facts.refundPaymentIds.has(payment.id)) {
          throw new ConflictException("付款草稿已形成发票、归档或退款事实，不能放弃");
        }
        if (reservation?.status === "reserved") {
          const remaining = reservation.amountCents - reservation.releasedAmountCents;
          if (remaining > 0n) {
            await this.balances.releaseForShortage(tx, {
              paymentId: payment.id,
              expectedReservedAmountCents: reservation.amountCents,
              releaseAmountCents: remaining,
              expectedProjectId: version.projectId,
              expectedSupplierKey: version.supplierKey,
              actorUserId,
              reason: `放弃付款草稿：${reason}`
            });
          }
        }
        const now = new Date();
        const invalidated = await tx.spotProcurementPayment.updateMany({
          where: {
            id: payment.id,
            status: "draft",
            submittedAt: null,
            invalidatedAt: null,
            updatedAt: expectedUpdatedAt
          },
          data: { status: "invalidated", invalidatedAt: now, invalidatedByUserId: actorUserId, invalidatedReason: reason }
        });
        if (invalidated.count !== 1) {
          throw new ConflictException("付款草稿状态已变化，请刷新后重试");
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.draft.abandon",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: { procurementId: version.procurementId, procurementVersionId: version.id, reason }
        });
        return this.paymentReadModel({
          ...payment,
          status: "invalidated",
          invalidatedAt: now,
          invalidatedByUserId: actorUserId,
          invalidatedReason: reason,
          updatedAt: now
        });
      })
    );
  }

  updateDraft(
    paymentId: string,
    actorUserId: string,
    input: UpdateSpotProcurementPaymentDraftDto
  ) {
    if (hasRealFormPaymentFacts(input)) {
      return this.updateRealFormDraft(paymentId, actorUserId, input);
    }
    return this.runWrite(() =>
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
        const payment = this.requirePayment(payments, paymentId);
        this.assertDraft(payment);
        await this.requireHandler(tx, version, actorUserId, payment);
        const paymentFacts = await this.preparePayment(
          tx,
          version,
          payment,
          input,
          actorUserId
        );
        const suggestion = await this.balances.suggestionWithClient(
          tx,
          version.projectId,
          version.supplierKey,
          paymentFacts.settlementAmountCents
        );
        const prepared = this.applyBalanceOverridePolicy(
          payment,
          paymentFacts,
          suggestion,
          false
        );
        const capacityLimit =
          await this.paymentCapacityLimit(tx, version);
        if (
          prepared.settlementAmountCents >
          capacityLimit
        ) {
          throw new ConflictException(
            "收货差异确认后付款申请金额不能超过本次采购实际成本"
          );
        }
        const systemAdjustedBalance =
          Boolean(payment.balanceOverrideReason) &&
          paymentFacts.settlementAmountCents ===
            payment.settlementAmountCents &&
          paymentFacts.supplierBalanceAmountCents <
            payment.supplierBalanceAmountCents &&
          paymentFacts.supplierBalanceAmountCents ===
            BigInt(suggestion.suggestedBalanceAmountCents) &&
          prepared.balanceOverrideReason === null;
        const updated = await tx.spotProcurementPayment.update({
          where: { id: payment.id },
          data: prepared
        });
        if (systemAdjustedBalance) {
          await this.audit.record(tx, {
            actorUserId,
            action:
              "spot_procurement.payment.balance.system_adjust",
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: payment.id,
            metadata: {
              actorUserId,
              procurementId: version.procurementId,
              procurementVersionId: version.id,
              oldSupplierBalanceAmountCents:
                payment.supplierBalanceAmountCents.toString(),
              financeFloorAmountCents:
                payment.supplierBalanceAmountCents.toString(),
              latestSuggestedBalanceAmountCents:
                suggestion.suggestedBalanceAmountCents,
              reason:
                "供应商可用余额变化，按最新系统建议同步降低抵扣金额"
            }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.draft.update",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            procurementId: version.procurementId,
            procurementVersionId: version.id,
            settlementAmountCents:
              prepared.settlementAmountCents.toString(),
            supplierBalanceAmountCents:
              prepared.supplierBalanceAmountCents.toString(),
            companyPaymentAmountCents:
              prepared.companyPaymentAmountCents.toString(),
            paymentPath: prepared.paymentPath,
            suggestedBalanceAmountCents:
              suggestion.suggestedBalanceAmountCents,
            balanceOverrideReason:
              prepared.balanceOverrideReason
          }
        });
        return this.paymentReadModel(updated, suggestion);
      })
    );
  }

  updatePayer(
    paymentId: string,
    actorUserId: string,
    input: UpdateSpotPaymentPayerDto
  ) {
    return this.runPayerWriteWithRetry(() => this.runSerializable(async (tx) => {
      const payment = await this.lockPaymentForPayerUpdate(tx, paymentId);
      if (!payment) throw new NotFoundException("零星材料付款申请不存在");
      this.pilot.assertEnabled(payment.projectId);
      if (!["draft", "approval_pending"].includes(payment.status)) {
        throw new ConflictException("当前付款申请已锁定付款主体");
      }
      const existingExecution =
        await tx.spotProcurementPaymentExecution.findFirst({
          where: { paymentId: payment.id, voidedAt: null },
          select: { id: true }
        });
      if (existingExecution) {
        throw new ConflictException("已发生实际付款，不能再调整付款主体或拟付款方式");
      }
      const roles = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      this.requireAnyRole(
        roles,
        new Set(["finance_staff", "comprehensive_director", "finance_director"]),
        "只有财务人员、综合部主管或财务主管可以维护付款主体"
      );
      const approval = payment.status === "approval_pending"
        ? await this.requireLockedApproval(tx, payment.id)
        : null;
      const pendingRoles = approval
        ? pendingRoleKeysForFrozenApprovalNode(
            approval.frozenNodes,
            approval.currentNodeIndex
          )
        : [];
      const isFinanceDirectorReapproval =
        pendingRoles.includes("finance_director") &&
        roles.includes("finance_director");
      if (
        !input.paymentMethods?.length ||
        new Set(input.paymentMethods).size !== input.paymentMethods.length
      ) {
        throw new BadRequestException("拟付款方式至少保留一种且不能重复");
      }
      const existingMethodCount =
        await tx.spotProcurementPaymentMethodOption.count({
          where: { paymentId: payment.id }
        });
      const payerTaskComplete = isSpotPaymentPayerTaskComplete(
        payment,
        existingMethodCount
      );
      if (payerTaskComplete && !isFinanceDirectorReapproval) {
        throw new ConflictException(PAYER_TASK_COMPLETED_ERROR);
      }
      if (approval && !isFinanceDirectorReapproval && approval.currentNodeIndex !== 0) {
        throw new ConflictException("综合部主管审批完成后，只有财务主管可在本节点调整付款主体");
      }
      if (isFinanceDirectorReapproval && !optionalText(input.changeReason)) {
        throw new BadRequestException("财务主管调整付款主体时必须填写变更原因");
      }
      const requestedCompanyEntityId = requiredText(
        input.companyEntityId,
        "请选择付款主体"
      );
      const preservesExistingPayer = Boolean(
        payment.payerCompanyEntityId && !isFinanceDirectorReapproval
      );
      if (
        preservesExistingPayer &&
        requestedCompanyEntityId !== payment.payerCompanyEntityId
      ) {
        throw new ConflictException(EXISTING_PAYER_IMMUTABLE_ERROR);
      }
      const completesLegacyMethods = Boolean(
        preservesExistingPayer && payment.payerCompanyNameSnapshot?.trim()
      ) &&
        existingMethodCount === 0 &&
        !isFinanceDirectorReapproval;
      const repairsExistingPayerSnapshot =
        preservesExistingPayer &&
        !payment.payerCompanyNameSnapshot?.trim();
      const company = completesLegacyMethods
        ? {
            id: payment.payerCompanyEntityId as string,
            name: payment.payerCompanyNameSnapshot,
            unifiedSocialCreditCode:
              payment.payerUnifiedSocialCreditCodeSnapshot
          }
        : repairsExistingPayerSnapshot
          ? await tx.companyEntity.findFirst({
              where: { id: payment.payerCompanyEntityId as string },
              select: { id: true, name: true, unifiedSocialCreditCode: true }
            })
        : await tx.companyEntity.findFirst({
            where: { id: requestedCompanyEntityId, isActive: true },
            select: { id: true, name: true, unifiedSocialCreditCode: true }
          });
      if (!company) {
        if (repairsExistingPayerSnapshot) {
          throw new ConflictException("原付款主体档案不存在，无法补齐冻结名称");
        }
        throw new BadRequestException("付款主体不存在或已停用");
      }
      if (
        payment.paymentMethod &&
        !input.paymentMethods.includes(
          payment.paymentMethod as SpotProcurementPaymentMethod
        )
      ) {
        throw new BadRequestException("拟付款方式必须包含当前主收款渠道");
      }
      await tx.spotProcurementPaymentMethodOption.deleteMany({
        where: { paymentId: payment.id }
      });
      await tx.spotProcurementPaymentMethodOption.createMany({
        data: input.paymentMethods.map((paymentMethod, index) => ({
          paymentId: payment.id,
          paymentMethod,
          sortOrder: index + 1
        }))
      });
      const frozenNodes = isFinanceDirectorReapproval && approval
        ? resetPaymentApprovalToComprehensive(approval.frozenNodes)
        : undefined;
      if (isFinanceDirectorReapproval && approval) {
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: approval.id,
            action: "payer_changed_reapproval",
            actorUserId,
            comment: optionalText(input.changeReason),
            metadata: {
              previousPayerCompanyEntityId: payment.payerCompanyEntityId,
              nextPayerCompanyEntityId: company.id,
              reason: optionalText(input.changeReason)
            }
          }
        });
        await tx.approvalInstance.update({
          where: { id: approval.id },
          data: {
            currentNodeIndex: 0,
            status: "approval_pending",
            frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue
          }
        });
      }
      const updated = completesLegacyMethods
        ? payment
        : await tx.spotProcurementPayment.update({
            where: { id: payment.id },
            data: {
              payerCompanyEntityId: company.id,
              payerCompanyNameSnapshot: company.name,
              payerUnifiedSocialCreditCodeSnapshot: company.unifiedSocialCreditCode,
              factsFrozenAt: isFinanceDirectorReapproval
                ? new Date()
                : payment.factsFrozenAt
            }
          });
      await this.audit.record(tx, {
        actorUserId,
        action: "spot_procurement.payment.payer.update",
        businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        businessId: payment.id,
        metadata: {
          companyEntityId: company.id,
          companyName: company.name,
          changeReason: optionalText(input.changeReason),
          reapprovalFromComprehensive: isFinanceDirectorReapproval,
          completedLegacyPaymentMethods: completesLegacyMethods
        }
      });
      return this.paymentReadModel(updated);
    }));
  }

  private async lockPaymentForPayerUpdate(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    const rows = await tx.$queryRaw<Array<PaymentLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "procurementId",
        "procurementVersionId",
        "code",
        "status",
        "settlementAmountCents",
        "supplierBalanceAmountCents",
        "companyPaymentAmountCents",
        "paidAmountCents",
        "executedSupplierBalanceAmountCents",
        "canceledAmountCents",
        "canceledCompanyPaymentAmountCents",
        "canceledSupplierBalanceAmountCents",
        "paymentPath",
        "paymentMethod",
        "payeePartyId",
        "payeeUserId",
        "payeeNameSnapshot",
        "payeeAccountNameSnapshot",
        "payeeBankNameSnapshot",
        "payeeBankAccountSnapshot",
        "expectedPaymentAt",
        "paymentNote",
        "supportingAttachmentFileId",
        "merchantPaymentProofFileId",
        "balanceOverrideReason",
        "handlerUserId",
        "createdByUserId",
        "submittedAt",
        "approvedAt",
        "invalidatedAt",
        "invalidatedByUserId",
        "invalidatedReason",
        "paymentType",
        "merchantNameSnapshot",
        "merchantPayeeMismatchNote",
        "payerCompanyEntityId",
        "payerCompanyNameSnapshot",
        "payerUnifiedSocialCreditCodeSnapshot",
        "approvalAmountCents",
        "primaryPaymentChannelId",
        "factsFrozenAt"
      FROM "SpotProcurementPayment"
      WHERE "id" = ${paymentId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  submit(paymentId: string, actorUserId: string) {
    return this.runWrite(async () => {
      const payment = await this.prisma.spotProcurementPayment.findUnique({
        where: { id: paymentId },
        select: { paymentType: true, merchantNameSnapshot: true }
      });
      if (payment?.paymentType || payment?.merchantNameSnapshot) {
        return this.submitRealForm(paymentId, actorUserId);
      }
      return this.submitLegacyPayment(paymentId, actorUserId);
    });
  }

  private submitLegacyPayment(paymentId: string, actorUserId: string) {
    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(
          tx,
          paymentId
        );
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(
          tx,
          version.procurementId
        );
        const payment = this.requirePayment(payments, paymentId);
        this.assertDraft(payment);
        await this.requireHandler(tx, version, actorUserId, payment);
        const paymentFacts = await this.preparePayment(
          tx,
          version,
          payment,
          {},
          actorUserId,
          true
        );
        const suggestion = await this.balances.suggestionWithClient(
          tx,
          version.projectId,
          version.supplierKey,
          paymentFacts.settlementAmountCents
        );
        const prepared = this.applyBalanceOverridePolicy(
          payment,
          paymentFacts,
          suggestion,
          true
        );
        const occupied = this.activeSettlementTotal(
          payments.filter((row) => row.id !== payment.id),
          version.id
        );
        const capacityLimit =
          await this.paymentCapacityLimit(tx, version);
        if (
          occupied + prepared.settlementAmountCents >
          capacityLimit
        ) {
          throw new ConflictException(
            capacityLimit === version.totalAmountCents
              ? "有效付款申请累计结算金额不能超过当前采购批准金额"
              : "收货差异确认后有效付款申请累计不能超过本次采购实际成本"
          );
        }
        const reservation = await this.balances.reserve(tx, {
          projectId: version.projectId,
          supplierKey: version.supplierKey,
          paymentId: payment.id,
          procurementId: version.procurementId,
          amountCents: prepared.supplierBalanceAmountCents,
          actorUserId
        });
        const now = new Date();
        const approval = await tx.approvalInstance.create({
          data: {
            flowType: "spot_procurement.payment.approve",
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: payment.id,
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes:
              paymentApprovalNodes() as unknown as Prisma.InputJsonValue,
            applicantUserId: payment.handlerUserId
          }
        });
        const updated = await tx.spotProcurementPayment.update({
          where: { id: payment.id },
          data: {
            ...prepared,
            status: "approval_pending",
            submittedAt: now
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.approval.submit",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            approvalInstanceId: approval.id,
            procurementId: version.procurementId,
            procurementVersionId: version.id,
            reservationId: reservation.reservationId,
            availableBalanceAmountCents:
              suggestion.availableBalanceAmountCents,
            suggestedBalanceAmountCents:
              suggestion.suggestedBalanceAmountCents,
            ...this.paymentSnapshot(prepared)
          }
        });
        return this.paymentReadModel(updated);
      });
      await this.approvalForms.tryRefreshLatestForBusiness(
        SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        paymentId,
        actorUserId,
        "approval.submit"
      );
      return result;
    });
  }

  review(
    paymentId: string,
    actorUserId: string,
    input: ReviewSpotProcurementPaymentDto
  ) {
    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(
          tx,
          paymentId
        );
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(
          tx,
          version.procurementId
        );
        const payment = this.requirePayment(payments, paymentId);
        const realPaymentForm = isRealPaymentForm(payment, version);
        if (
          realPaymentForm &&
          input.decision === "reject"
        ) {
          throw new BadRequestException(
            "项目零星付款只允许通过或退回申请人修改"
          );
        }
        if (
          realPaymentForm &&
          input.adjustedSupplierBalanceAmountCents !== undefined
        ) {
          throw new BadRequestException(
            "项目零星付款不支持调整供应商余额抵扣金额"
          );
        }
        if (payment.status !== "approval_pending") {
          throw new ConflictException("当前付款申请不在审批中");
        }
        const approval = await this.requireLockedApproval(tx, payment.id);
        await this.requireActiveUser(
          tx,
          actorUserId,
          "付款审批人不存在或已停用"
        );
        const actorRoles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          version.projectId
        );
        const pendingRoles = pendingRoleKeysForFrozenApprovalNode(
          approval.frozenNodes,
          approval.currentNodeIndex
        );
        const approvedRoleKey = pendingRoles.find((roleKey) =>
          actorRoles.includes(roleKey)
        );
        if (!approvedRoleKey) {
          throw new ForbiddenException("当前用户不是本付款审批节点处理人");
        }
        const selfReview = await confirmApprovalSelfReview({
          applicantUserId: approval.applicantUserId,
          actorUserId,
          actorRoleKeys: actorRoles,
          approvedRoleKey,
          selfReviewReason: input.selfReviewReason,
          confirmationPassword: input.confirmationPassword,
          confirmPassword: (password) =>
            this.auth.confirmPassword(actorUserId, password)
        });
        const selfReviewMetadata = selfReview.metadata;
        const comment = realPaymentForm
          ? input.decision === "approve"
            ? optionalText(input.comment) ?? "同意"
            : requiredText(
                input.comment,
                "退回付款申请时必须填写原因"
              )
          : optionalText(input.comment);
        const adjustedBalanceText =
          input.adjustedSupplierBalanceAmountCents;
        const isFinanceDirectorNode =
          approvedRoleKey === "finance_director";
        if (!realPaymentForm && adjustedBalanceText !== undefined) {
          if (!isFinanceDirectorNode) {
            throw new BadRequestException(
              "只有财务主管在退回申请人时可以指定调整后的供应商余额抵扣金额"
            );
          }
          if (input.decision !== "return_to_applicant") {
            throw new BadRequestException(
              "财务调整后的供应商余额抵扣金额只能随退回申请人动作提交"
            );
          }
        }
        if (
          !realPaymentForm &&
          isFinanceDirectorNode &&
          input.decision === "return_to_applicant"
        ) {
          if (adjustedBalanceText === undefined) {
            throw new BadRequestException(
              "财务主管退回付款申请时必须指定调整后的供应商余额抵扣金额"
            );
          }
          if (!comment) {
            throw new BadRequestException(
              "财务主管调整供应商余额抵扣时必须填写原因"
            );
          }
        } else if (input.decision !== "approve" && !comment) {
          throw new BadRequestException(
            "驳回或退回付款申请时必须填写审批意见"
          );
        }
        if (
          approvedRoleKey === "comprehensive_director" &&
          input.decision === "approve"
        ) {
          const [realPayment, methodCount] = await Promise.all([
            tx.spotProcurementPayment.findUnique({
              where: { id: payment.id },
              select: {
                paymentType: true,
                payerCompanyEntityId: true,
                payerCompanyNameSnapshot: true
              }
            }),
            tx.spotProcurementPaymentMethodOption.count({
              where: { paymentId: payment.id }
            })
          ]);
          if (
            realPayment?.paymentType &&
            (!realPayment.payerCompanyEntityId ||
              !realPayment.payerCompanyNameSnapshot ||
              methodCount < 1)
          ) {
            throw new BadRequestException(
              "综合部主管审批通过前必须确定付款主体和至少一种拟付款方式"
            );
          }
        }
        const recordApprovalAction = () =>
          tx.approvalActionLog.create({
            data: {
              approvalInstanceId: approval.id,
              action: input.decision,
              actorUserId,
              comment,
              metadata: {
                reviewRoleKey: approvedRoleKey,
                ...(adjustedBalanceText !== undefined
                  ? {
                      originalSupplierBalanceAmountCents:
                        payment.supplierBalanceAmountCents.toString(),
                      adjustedSupplierBalanceAmountCents:
                        adjustedBalanceText
                    }
                  : {}),
                ...selfReviewMetadata
              }
            }
          });

        if (input.decision === "reject") {
          await this.balances.releaseReservation(tx, {
            paymentId: payment.id,
            expectedAmountCents:
              payment.supplierBalanceAmountCents,
            expectedProjectId: version.projectId,
            expectedSupplierKey: version.supplierKey,
            actorUserId,
            reason: `付款申请被驳回：${comment}`
          });
          await recordApprovalAction();
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: { status: "rejected" }
          });
          const updated = await tx.spotProcurementPayment.update({
            where: { id: payment.id },
            data: { status: "rejected" }
          });
          await this.recordReviewAudit(
            tx,
            actorUserId,
            payment,
            approval.id,
            input.decision,
            approvedRoleKey,
            selfReviewMetadata
          );
          return this.paymentReadModel(updated);
        }

        if (input.decision === "return_to_applicant") {
          if (!realPaymentForm && isFinanceDirectorNode) {
            const adjustedSupplierBalanceAmountCents = parseMoney(
              adjustedBalanceText,
              0n
            );
            if (
              adjustedSupplierBalanceAmountCents >
              payment.settlementAmountCents
            ) {
              throw new BadRequestException(
                "调整后的供应商余额抵扣金额不能超过本次结算金额"
              );
            }
            if (
              adjustedSupplierBalanceAmountCents >
              payment.supplierBalanceAmountCents
            ) {
              throw new BadRequestException(
                "财务主管指定的供应商余额抵扣金额不能高于原申请抵扣金额"
              );
            }
            const released =
              await this.balances.releaseReservation(tx, {
                paymentId: payment.id,
                expectedAmountCents:
                  payment.supplierBalanceAmountCents,
                expectedProjectId: version.projectId,
                expectedSupplierKey: version.supplierKey,
                actorUserId,
                reason: `付款申请退回经办人：${comment}`
              });
            const suggestion =
              await this.balances.suggestionWithClient(
                tx,
                version.projectId,
                version.supplierKey,
                payment.settlementAmountCents
              );
            if (
              adjustedSupplierBalanceAmountCents >
              BigInt(suggestion.availableBalanceAmountCents)
            ) {
              throw new BadRequestException(
                "调整后的供应商余额抵扣金额不能超过当前可用供应商余额"
              );
            }
            await recordApprovalAction();
            await tx.approvalInstance.update({
              where: { id: approval.id },
              data: { status: "returned_to_applicant" }
            });
            const updated = await tx.spotProcurementPayment.update({
              where: { id: payment.id },
              data: { status: "returned" }
            });
            const newDraft =
              await this.cloneSubmittedPaymentToDraft(
                tx,
                version,
                payments,
                payment,
                actorUserId,
                {
                  supplierBalanceAmountCents:
                    adjustedSupplierBalanceAmountCents,
                  reason: comment as string
                }
              );
            await this.recordReviewAudit(
              tx,
              actorUserId,
              payment,
              approval.id,
              input.decision,
              approvedRoleKey,
              {
                oldPaymentId: payment.id,
                newDraftPaymentId: newDraft.id,
                originalSupplierBalanceAmountCents:
                  payment.supplierBalanceAmountCents.toString(),
                adjustedSupplierBalanceAmountCents:
                  adjustedSupplierBalanceAmountCents.toString(),
                availableBalanceAmountCents:
                  suggestion.availableBalanceAmountCents,
                suggestedBalanceAmountCents:
                  suggestion.suggestedBalanceAmountCents,
                balanceOverrideReason: comment as string,
                reservationReleased: released.released,
                releasedReservationAmountCents:
                  released.amountCents.toString(),
                ...selfReviewMetadata
              }
            );
            return this.paymentReadModel(updated, undefined, {
              newDraftPaymentId: newDraft.id
            });
          }
          await this.balances.releaseReservation(tx, {
            paymentId: payment.id,
            expectedAmountCents:
              payment.supplierBalanceAmountCents,
            expectedProjectId: version.projectId,
            expectedSupplierKey: version.supplierKey,
            actorUserId,
            reason: `付款申请退回经办人：${comment}`
          });
          await recordApprovalAction();
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: { status: "returned_to_applicant" }
          });
          const updated = await tx.spotProcurementPayment.update({
            where: { id: payment.id },
            data: { status: "returned" }
          });
          const realClone = realPaymentForm
            ? await this.cloneSubmittedRealPaymentToDraft(
                tx,
                version,
                payments,
                payment,
                actorUserId
              )
            : null;
          const newDraft = realClone?.payment ??
            (await this.cloneSubmittedPaymentToDraft(
              tx,
              version,
              payments,
              payment,
              actorUserId
            ));
          await this.recordReviewAudit(
            tx,
            actorUserId,
            payment,
            approval.id,
            input.decision,
            approvedRoleKey,
            {
              oldPaymentId: payment.id,
              newDraftPaymentId: newDraft.id,
              ...(realClone
                ? {
                    retainedOriginalAttachmentCount:
                      realClone.retainedOriginalAttachmentCount,
                    clonedPaymentLineCount:
                      realClone.clonedPaymentLineCount,
                    clonedPaymentChannelCount:
                      realClone.clonedPaymentChannelCount,
                    clonedPaymentMethodCount:
                      realClone.clonedPaymentMethodCount
                  }
                : {}),
              ...selfReviewMetadata
            }
          );
          return this.paymentReadModel(updated, undefined, {
            newDraftPaymentId: newDraft.id
          });
        }

        await recordApprovalAction();
        const nextNodes = this.approveCurrentNode(
          approval.frozenNodes,
          approval.currentNodeIndex,
          approvedRoleKey
        );
        const isFinal =
          approval.currentNodeIndex >= nextNodes.length - 1;
        if (!isFinal) {
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: {
              currentNodeIndex: approval.currentNodeIndex + 1,
              status: "approval_pending",
              frozenNodes: nextNodes as unknown as Prisma.InputJsonValue
            }
          });
          await this.recordReviewAudit(
            tx,
            actorUserId,
            payment,
            approval.id,
            input.decision,
            approvedRoleKey,
            selfReviewMetadata
          );
          return this.paymentReadModel(payment);
        }

        const now = new Date();
        await tx.approvalInstance.update({
          where: { id: approval.id },
          data: {
            status: "approved",
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue
          }
        });
        const updated = await tx.spotProcurementPayment.update({
          where: { id: payment.id },
          data: {
            status: "approved_pending_payment",
            approvedAt: now
          }
        });
        await this.recordReviewAudit(
          tx,
          actorUserId,
          payment,
          approval.id,
          input.decision,
          approvedRoleKey,
          selfReviewMetadata
        );
        return this.paymentReadModel(updated);
      });
      await this.approvalForms.tryRefreshLatestForBusiness(
        SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        paymentId,
        actorUserId,
        `approval.${input.decision}`
      );
      if (result.status === "approved_pending_payment") {
        await this.archives?.tryCreateVersion(
          paymentId,
          actorUserId,
          "payment.approval.completed"
        );
      }
      return result;
    });
  }

  withdrawApproval(paymentId: string, actorUserId: string) {
    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(
          tx,
          paymentId
        );
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(
          tx,
          version.procurementId
        );
        const payment = this.requirePayment(payments, paymentId);
        if (payment.status !== "approval_pending") {
          throw new ConflictException("当前付款申请不在审批中，不能撤回");
        }
        const approval = await this.requireLockedApproval(tx, payment.id);
        await this.requireHandler(tx, version, actorUserId, payment);
        if (
          actorUserId !== payment.handlerUserId ||
          actorUserId !== approval.applicantUserId
        ) {
          throw new ForbiddenException("只有采购经办人可以撤回付款审批");
        }
        await this.balances.releaseReservation(tx, {
          paymentId: payment.id,
          expectedAmountCents:
            payment.supplierBalanceAmountCents,
          expectedProjectId: version.projectId,
          expectedSupplierKey: version.supplierKey,
          actorUserId,
          reason: "采购经办人撤回付款审批"
        });
        await tx.approvalInstance.update({
          where: { id: approval.id },
          data: { status: "withdrawn" }
        });
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: approval.id,
            action: "withdraw",
            actorUserId,
            comment: "采购经办人撤回付款审批"
          }
        });
        const updated = await tx.spotProcurementPayment.update({
          where: { id: payment.id },
          data: { status: "withdrawn" }
        });
        const newDraft = await this.cloneSubmittedPaymentToDraft(
          tx,
          version,
          payments,
          payment,
          actorUserId,
          undefined,
          "approval_withdrawal_clone"
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.approval.withdraw",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            approvalInstanceId: approval.id,
            procurementId: version.procurementId,
            procurementVersionId: version.id,
            newDraftPaymentId: newDraft.id
          }
        });
        return this.paymentReadModel(updated, undefined, {
          newDraftPaymentId: newDraft.id
        });
      });
      await this.approvalForms.tryRefreshLatestForBusiness(
        SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        paymentId,
        actorUserId,
        "approval.withdraw"
      );
      return result;
    });
  }

  voidPayment(
    paymentId: string,
    actorUserId: string,
    reasonInput: string
  ) {
    return this.runWrite(async () => {
      let shouldRefreshApprovalForm = false;
      const result = await this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(
          tx,
          paymentId
        );
        this.pilot.assertEnabled(version.projectId);
        const payments = await this.lockProcurementPayments(
          tx,
          version.procurementId
        );
        const payment = this.requirePayment(payments, paymentId);
        shouldRefreshApprovalForm = payment.status !== "draft";
        if (NON_VOIDABLE_EXECUTION_STATUSES.has(payment.status)) {
          throw new ConflictException(
            "付款申请已发生执行事实，不能直接作废"
          );
        }
        if (!VOIDABLE_PAYMENT_STATUSES.has(payment.status)) {
          throw new ConflictException("当前付款申请状态不允许作废");
        }
        const actorRoles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          version.projectId
        );
        await this.requireActiveUser(
          tx,
          actorUserId,
          "付款作废操作人不存在或已停用"
        );
        this.requireAnyRole(
          actorRoles,
          VOID_ROLES,
          "只有项目经理或财务主管可以作废付款申请"
        );
        const reason = requiredText(reasonInput, "请填写付款申请作废原因");
        let approval: ApprovalLockRow | null = null;
        if (payment.status === "approval_pending") {
          approval = await this.requireLockedApproval(tx, payment.id);
        }
        await this.balances.releaseReservation(tx, {
          paymentId: payment.id,
          expectedAmountCents:
            payment.status === "draft"
              ? 0n
              : payment.supplierBalanceAmountCents,
          expectedProjectId: version.projectId,
          expectedSupplierKey: version.supplierKey,
          actorUserId,
          reason: `付款申请作废：${reason}`
        });
        if (approval) {
          const approvalVoided =
            await tx.approvalInstance.updateMany({
            where: {
              id: approval.id,
              status: "approval_pending"
            },
            data: { status: "voided" }
          });
          if (approvalVoided.count !== 1) {
            throw new ConflictException(
              "付款审批状态已变化，请重试付款作废"
            );
          }
        }
        const now = new Date();
        const paymentVoided =
          await tx.spotProcurementPayment.updateMany({
          where: {
            id: payment.id,
            status: payment.status
          },
          data: {
            status: "voided",
            invalidatedAt: now,
            invalidatedByUserId: actorUserId,
            invalidatedReason: reason
          }
        });
        if (paymentVoided.count !== 1) {
          throw new ConflictException(
            "付款状态已变化，请重试付款作废"
          );
        }
        if (approval) {
          await tx.approvalActionLog.create({
            data: {
              approvalInstanceId: approval.id,
              action: "void",
              actorUserId,
              comment: reason
            }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.void",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            procurementId: version.procurementId,
            procurementVersionId: version.id,
            fromStatus: payment.status,
            reason
          }
        });
        return this.paymentReadModel({
          ...payment,
          status: "voided"
        });
      });
      if (shouldRefreshApprovalForm) {
        await this.approvalForms.tryRefreshLatestForBusiness(
          SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          paymentId,
          actorUserId,
          "approval.void"
        );
      }
      return result;
    });
  }

  private async preparePayment(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    payment: PaymentLockRow,
    input: UpdateSpotProcurementPaymentDraftDto,
    actorUserId: string,
    requireComplete = false
  ): Promise<PreparedPayment> {
    const settlementAmountCents = parseMoney(
      input.settlementAmountCents,
      payment.settlementAmountCents
    );
    const supplierBalanceAmountCents = parseMoney(
      input.supplierBalanceAmountCents,
      payment.supplierBalanceAmountCents
    );
    const companyPaymentAmountCents = parseMoney(
      input.companyPaymentAmountCents,
      payment.companyPaymentAmountCents
    );
    if (
      settlementAmountCents !==
      supplierBalanceAmountCents + companyPaymentAmountCents
    ) {
      throw new BadRequestException(
        "本次结算金额必须等于供应商余额抵扣金额与公司实际付款金额之和"
      );
    }
    if (settlementAmountCents <= 0n) {
      throw new BadRequestException("本次结算金额必须大于 0");
    }
    if (settlementAmountCents > version.totalAmountCents) {
      throw new BadRequestException(
        "本次结算金额不能超过当前采购批准金额"
      );
    }
    const inputPath =
      input.paymentPath === undefined
        ? payment.paymentPath
        : input.paymentPath;
    const paymentPath: SpotProcurementPaymentPath | null =
      companyPaymentAmountCents === 0n
        ? "supplier_direct"
        : inputPath === "supplier_direct" ||
            inputPath === "handler_reimbursement"
          ? inputPath
          : null;
    if (
      requireComplete &&
      paymentPath !== "supplier_direct" &&
      paymentPath !== "handler_reimbursement"
    ) {
      throw new BadRequestException("请选择付款路径");
    }
    const paymentMethod = mergedText(
      input.paymentMethod,
      payment.paymentMethod
    );
    if (paymentMethod && !PAYMENT_METHODS.has(paymentMethod)) {
      throw new BadRequestException("付款方式不正确");
    }
    const paymentPathChanged = paymentPath !== payment.paymentPath;
    const paymentMethodChanged =
      paymentMethod !== payment.paymentMethod;
    const resetPayeeAccountSnapshots =
      paymentPathChanged || paymentMethodChanged;
    const payeeAccountNameSnapshot = mergedText(
      input.payeeAccountName,
      resetPayeeAccountSnapshots
        ? null
        : payment.payeeAccountNameSnapshot
    );
    const payeeBankNameSnapshot = mergedText(
      input.payeeBankName,
      resetPayeeAccountSnapshots
        ? null
        : payment.payeeBankNameSnapshot
    );
    const payeeBankAccountSnapshot = mergedText(
      input.payeeBankAccount,
      resetPayeeAccountSnapshots
        ? null
        : payment.payeeBankAccountSnapshot
    );
    const expectedPaymentAt =
      input.expectedPaymentAt === undefined
        ? payment.expectedPaymentAt
        : input.expectedPaymentAt === null
          ? null
          : new Date(input.expectedPaymentAt);
    const paymentNote = mergedText(
      input.paymentNote,
      payment.paymentNote
    );
    const supportingAttachmentFileId = mergedText(
      input.supportingAttachmentFileId,
      payment.supportingAttachmentFileId
    );
    const merchantPaymentProofFileId = mergedText(
      input.merchantPaymentProofFileId,
      payment.merchantPaymentProofFileId
    );
    if (requireComplete && !paymentNote) {
      throw new BadRequestException("请填写真实付款说明");
    }
    if (requireComplete && !supportingAttachmentFileId) {
      throw new BadRequestException("请上传付款申请支撑附件");
    }
    if (companyPaymentAmountCents > 0n) {
      if (!paymentMethod) {
        if (requireComplete) {
          throw new BadRequestException("请填写公司付款方式");
        }
      }
      if (requireComplete && !expectedPaymentAt) {
        throw new BadRequestException("请选择预计付款日期");
      }
      if (
        paymentMethod === "bank_transfer" &&
        (requireComplete ||
          paymentPathChanged ||
          paymentMethodChanged) &&
        (!payeeAccountNameSnapshot ||
          !payeeBankNameSnapshot ||
          !payeeBankAccountSnapshot)
      ) {
        throw new BadRequestException("银行转账必须填写完整收款账户信息");
      }
    }
    const fileIds = [
      supportingAttachmentFileId,
      merchantPaymentProofFileId
    ].filter((fileId): fileId is string => Boolean(fileId));
    const files = fileIds.length
      ? await tx.fileObject.findMany({
          where: { id: { in: [...new Set(fileIds)] } },
          select: {
            id: true,
            storageStatus: true,
            uploadedByUserId: true
          }
        })
      : [];
    if (
      fileIds.some(
        (fileId) =>
          !files.some(
            (file) =>
              file.id === fileId && file.storageStatus === "active"
          )
      )
    ) {
      throw new BadRequestException("付款支撑附件不存在或已失效，请重新上传");
    }
    const merchantProof = merchantPaymentProofFileId
      ? files.find((file) => file.id === merchantPaymentProofFileId)
      : undefined;
    if (
      paymentPath === "handler_reimbursement" &&
      merchantProof &&
      merchantProof.uploadedByUserId !== payment.handlerUserId
    ) {
      throw new ForbiddenException(
        "商家付款证明必须由采购经办人本人上传"
      );
    }
    if (
      files.some(
        (file) =>
          file.uploadedByUserId !== payment.handlerUserId &&
          file.uploadedByUserId !== actorUserId
      )
    ) {
      throw new ForbiddenException(
        "付款支撑附件必须由采购经办人本人上传"
      );
    }

    let payeePartyId: string | null;
    let payeeUserId: string | null;
    let payeeNameSnapshot: string;
    if (paymentPath === "handler_reimbursement") {
      if (requireComplete && !merchantPaymentProofFileId) {
        throw new BadRequestException("经办人垫付报回必须上传商家付款证明");
      }
      if (
        merchantPaymentProofFileId &&
        merchantProof?.uploadedByUserId !== payment.handlerUserId
      ) {
        throw new ForbiddenException(
          "商家付款证明必须由采购经办人本人上传"
        );
      }
      const handler = await tx.user.findUnique({
        where: { id: payment.handlerUserId },
        select: { id: true, name: true, isActive: true }
      });
      if (!handler?.isActive) {
        throw new BadRequestException("采购经办人不存在或已停用");
      }
      payeePartyId = null;
      payeeUserId = handler.id;
      payeeNameSnapshot = handler.name;
    } else {
      payeePartyId = version.supplierPartyId;
      payeeUserId = null;
      payeeNameSnapshot = version.supplierNameSnapshot;
    }
    return {
      settlementAmountCents,
      supplierBalanceAmountCents,
      companyPaymentAmountCents,
      paymentPath,
      paymentMethod:
        companyPaymentAmountCents === 0n ? null : paymentMethod,
      payeePartyId,
      payeeUserId,
      payeeNameSnapshot,
      payeeAccountNameSnapshot:
        companyPaymentAmountCents === 0n ||
        paymentMethod !== "bank_transfer"
          ? null
          : payeeAccountNameSnapshot,
      payeeBankNameSnapshot:
        companyPaymentAmountCents === 0n ||
        paymentMethod !== "bank_transfer"
          ? null
          : payeeBankNameSnapshot,
      payeeBankAccountSnapshot:
        companyPaymentAmountCents === 0n ||
        paymentMethod !== "bank_transfer"
          ? null
          : payeeBankAccountSnapshot,
      expectedPaymentAt:
        companyPaymentAmountCents === 0n ? null : expectedPaymentAt,
      paymentNote,
      supportingAttachmentFileId,
      merchantPaymentProofFileId:
        paymentPath === "handler_reimbursement"
          ? merchantPaymentProofFileId
          : null,
      balanceOverrideReason: payment.balanceOverrideReason
    };
  }

  private applyBalanceOverridePolicy(
    payment: PaymentLockRow,
    prepared: PreparedPayment,
    suggestion: {
      availableBalanceAmountCents: string;
      suggestedBalanceAmountCents: string;
    },
    requireComplete: boolean
  ): PreparedPayment {
    const suggestedBalanceAmountCents = BigInt(
      suggestion.suggestedBalanceAmountCents
    );
    const matchesLatestSuggestion =
      prepared.supplierBalanceAmountCents ===
      suggestedBalanceAmountCents;
    const isSystemConstrainedDecrease =
      Boolean(payment.balanceOverrideReason) &&
      prepared.settlementAmountCents ===
        payment.settlementAmountCents &&
      prepared.supplierBalanceAmountCents <
        payment.supplierBalanceAmountCents &&
      matchesLatestSuggestion &&
      suggestedBalanceAmountCents <
        payment.supplierBalanceAmountCents;
    if (
      payment.balanceOverrideReason &&
      prepared.supplierBalanceAmountCents <
        payment.supplierBalanceAmountCents &&
      !isSystemConstrainedDecrease
    ) {
      throw new BadRequestException(
        "经办人不能把供应商余额抵扣金额降到财务主管指定金额以下，请再次提交财务主管调整"
      );
    }
    if (matchesLatestSuggestion) {
      return { ...prepared, balanceOverrideReason: null };
    }
    if (
      requireComplete &&
      prepared.supplierBalanceAmountCents >
        suggestedBalanceAmountCents
    ) {
      throw new BadRequestException(
        "供应商可用余额已变化，请将抵扣金额调整为最新系统建议后重新提交"
      );
    }
    if (!payment.balanceOverrideReason) {
      if (requireComplete) {
        throw new BadRequestException(
          "本次供应商余额抵扣低于系统建议，请先由财务主管退回并指定调整金额"
        );
      }
      return { ...prepared, balanceOverrideReason: null };
    }
    return {
      ...prepared,
      balanceOverrideReason: payment.balanceOverrideReason
    };
  }

  private async requireHandler(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    actorUserId: string,
    payment?: PaymentLockRow
  ) {
    const handlerUserId = payment?.handlerUserId ?? version.handlerUserId;
    if (
      actorUserId !== handlerUserId ||
      handlerUserId !== version.handlerUserId
    ) {
      throw new ForbiddenException(
        "只有采购经办人可以确认并提交付款申请"
      );
    }
    const handler = await tx.user.findUnique({
      where: { id: handlerUserId },
      select: { id: true, isActive: true }
    });
    if (!handler?.isActive) {
      throw new BadRequestException("采购经办人不存在或已停用");
    }
    const roles = await this.loadActorRoleKeys(
      tx,
      actorUserId,
      version.projectId
    );
    this.requireAnyRole(
      roles,
      HANDLER_ROLES,
      "采购经办人当前不具备物资员或物资主管岗位"
    );
  }

  private async requireLockedCurrentApprovedVersion(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    const rows = await tx.$queryRaw<Array<VersionLockRow>>(Prisma.sql`
      SELECT
        v."id",
        v."procurementId",
        p."projectId",
        p."code" AS "procurementCode",
        p."currentVersionId",
        p."status" AS "rootStatus",
        v."status" AS "versionStatus",
        v."versionNo",
        v."supplierPartyId",
        v."supplierKey",
        v."supplierNameSnapshot",
        v."handlerUserId",
        v."totalAmountCents"
      FROM "SpotProcurementVersion" v
      INNER JOIN "SpotProcurement" p
        ON p."id" = v."procurementId"
       AND p."currentVersionId" = v."id"
      WHERE p."id" = ${procurementId}
      LIMIT 1
      FOR UPDATE OF p, v
    `);
    return this.assertCurrentApprovedVersion(rows[0]);
  }

  private async requireLockedVersionForPayment(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    const rows = await tx.$queryRaw<Array<VersionLockRow>>(Prisma.sql`
      SELECT
        v."id",
        v."procurementId",
        p."projectId",
        p."code" AS "procurementCode",
        p."currentVersionId",
        p."status" AS "rootStatus",
        v."status" AS "versionStatus",
        v."versionNo",
        v."supplierPartyId",
        v."supplierKey",
        v."supplierNameSnapshot",
        v."handlerUserId",
        v."totalAmountCents"
      FROM "SpotProcurementPayment" pay
      INNER JOIN "SpotProcurementVersion" v
        ON v."id" = pay."procurementVersionId"
       AND v."procurementId" = pay."procurementId"
      INNER JOIN "SpotProcurement" p
        ON p."id" = v."procurementId"
      WHERE pay."id" = ${paymentId}
      LIMIT 1
      FOR UPDATE OF p, v
    `);
    return this.assertCurrentApprovedVersion(rows[0]);
  }

  private assertCurrentApprovedVersion(version?: VersionLockRow) {
    if (!version) {
      throw new NotFoundException("零星采购付款申请不存在");
    }
    if (
      version.currentVersionId !== version.id ||
      version.versionStatus !== "approved" ||
      version.rootStatus !== "approved_in_progress"
    ) {
      throw new ConflictException(
        "付款申请关联的采购版本已失效或不再可用"
      );
    }
    return version;
  }

  private async lockProcurementPayments(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    return tx.$queryRaw<Array<PaymentLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "procurementId",
        "procurementVersionId",
        "code",
        "status",
        "settlementAmountCents",
        "supplierBalanceAmountCents",
        "companyPaymentAmountCents",
        "paidAmountCents",
        "executedSupplierBalanceAmountCents",
        "canceledAmountCents",
        "canceledCompanyPaymentAmountCents",
        "canceledSupplierBalanceAmountCents",
        "paymentPath",
        "paymentMethod",
        "payeePartyId",
        "payeeUserId",
        "payeeNameSnapshot",
        "payeeAccountNameSnapshot",
        "payeeBankNameSnapshot",
        "payeeBankAccountSnapshot",
        "expectedPaymentAt",
        "paymentNote",
        "supportingAttachmentFileId",
        "merchantPaymentProofFileId",
        "balanceOverrideReason",
        "handlerUserId",
        "createdByUserId",
        "submittedAt",
        "approvedAt",
        "invalidatedAt",
        "invalidatedByUserId",
        "invalidatedReason",
        "paymentType",
        "merchantNameSnapshot",
        "merchantPayeeMismatchNote",
        "payerCompanyEntityId",
        "payerCompanyNameSnapshot",
        "payerUnifiedSocialCreditCodeSnapshot",
        "approvalAmountCents",
        "primaryPaymentChannelId",
        "factsFrozenAt",
        "draftOrigin",
        "sourcePaymentId",
        "updatedAt"
      FROM "SpotProcurementPayment"
      WHERE "procurementId" = ${procurementId}
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private lockActivePaymentExecutions(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    return tx.$queryRaw<Array<SpotPaymentExecutionRow>>(
      Prisma.sql`
        SELECT
          "id",
          "paymentId",
          "amountCents",
          "paidAt",
          "paymentMethod",
          "paymentChannelId",
          "executedByUserId",
          "voucherFileId",
          "idempotencyKey",
          "voidedAt",
          "voidedByUserId",
          "voidReason",
          "createdAt"
        FROM "SpotProcurementPaymentExecution"
        WHERE "paymentId" = ${paymentId}
          AND "voidedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE
      `
    );
  }

  private effectiveCompanyPaymentAmount(
    payment: Pick<
      PaymentLockRow,
      | "companyPaymentAmountCents"
      | "canceledCompanyPaymentAmountCents"
    >
  ) {
    const amount =
      payment.companyPaymentAmountCents -
      payment.canceledCompanyPaymentAmountCents;
    return amount > 0n ? amount : 0n;
  }

  private assertSameExecutionFacts(
    execution: {
      paymentId: string;
      amountCents: bigint;
      paidAt: Date;
      paymentMethod: string;
      executedByUserId: string;
      voucherFileId: string | null;
    },
    expected: {
      paymentId: string;
      amountCents: bigint;
      paidAt: Date;
      paymentMethod: string;
      actorUserId: string;
      voucherFileId: string | null;
    }
  ) {
    if (
      execution.paymentId !== expected.paymentId ||
      execution.amountCents !== expected.amountCents ||
      execution.paidAt.getTime() !== expected.paidAt.getTime() ||
      execution.paymentMethod !== expected.paymentMethod ||
      execution.executedByUserId !== expected.actorUserId ||
      execution.voucherFileId !== expected.voucherFileId
    ) {
      throw new ConflictException(
        "幂等键已用于不同的实际付款事实"
      );
    }
  }

  private async assertSameRealExecutionFacts(
    tx: Pick<Prisma.TransactionClient | PrismaService, "spotProcurementPaymentExecutionVoucher">,
    execution: {
      id: string;
      paymentId: string;
      amountCents: bigint;
      paidAt: Date;
      paymentMethod: string;
      paymentChannelId: string | null;
      executedByUserId: string;
    },
    expected: {
      paymentId: string;
      amountCents: bigint;
      paidAt: Date;
      paymentMethod: string;
      paymentChannelId: string | null;
      actorUserId: string;
      voucherFileIds: string[];
    }
  ) {
    if (
      execution.paymentId !== expected.paymentId ||
      execution.amountCents !== expected.amountCents ||
      execution.paidAt.getTime() !== expected.paidAt.getTime() ||
      execution.paymentMethod !== expected.paymentMethod ||
      execution.paymentChannelId !== expected.paymentChannelId ||
      execution.executedByUserId !== expected.actorUserId
    ) {
      throw new ConflictException("幂等键已用于不同的实际付款事实");
    }
    const vouchers = await tx.spotProcurementPaymentExecutionVoucher.findMany({
      where: { paymentExecutionId: execution.id },
      orderBy: { sortOrder: "asc" },
      select: { fileId: true }
    });
    if (
      vouchers.length !== expected.voucherFileIds.length ||
      vouchers.some((voucher, index) => voucher.fileId !== expected.voucherFileIds[index])
    ) {
      throw new ConflictException("幂等键已用于不同的实际付款事实");
    }
  }

  private executionReadModel(
    execution: {
      id: string;
      amountCents: bigint;
      paidAt: Date;
      paymentMethod: string;
      paymentChannelId?: string | null;
      voucherFileId: string | null;
      idempotencyKey: string;
    },
    payment: Pick<
      PaymentLockRow,
      | "id"
      | "status"
      | "paidAmountCents"
      | "companyPaymentAmountCents"
      | "canceledCompanyPaymentAmountCents"
    >,
    voucherFileIds?: readonly string[]
  ) {
    const remaining =
      this.effectiveCompanyPaymentAmount(payment) -
      payment.paidAmountCents;
    return {
      execution: {
        id: execution.id,
        amountCents: execution.amountCents.toString(),
        paidAt: execution.paidAt.toISOString(),
        paymentMethod: execution.paymentMethod,
        paymentChannelId: execution.paymentChannelId ?? null,
        voucherFileId: execution.voucherFileId,
        voucherFileIds: [...(voucherFileIds ?? (execution.voucherFileId ? [execution.voucherFileId] : []))],
        idempotencyKey: execution.idempotencyKey
      },
      payment: {
        id: payment.id,
        status: payment.status,
        paidAmountCents: payment.paidAmountCents.toString(),
        remainingCompanyPaymentAmountCents: (
          remaining > 0n ? remaining : 0n
        ).toString()
      }
    };
  }

  private async resolveConcurrentExecutionResult(input: {
    paymentId: string;
    actorUserId: string;
    amountCents: bigint;
    paidAt: Date;
    paymentMethod: string;
    voucherFileIds: string[];
    paymentChannelId: string | null;
    idempotencyKey: string;
  }) {
    const existing =
      await this.prisma.spotProcurementPaymentExecution.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
    if (existing) {
      const payment =
        await this.prisma.spotProcurementPayment.findUnique({
          where: { id: input.paymentId },
          select: {
            id: true,
            status: true,
            paidAmountCents: true,
            companyPaymentAmountCents: true,
            canceledCompanyPaymentAmountCents: true,
            paymentType: true
          }
        });
      if (!payment) {
        throw new ConflictException(
          "实际付款关联的付款申请已变化，请刷新后重试"
        );
      }
      if (payment.paymentType) {
        await this.assertSameRealExecutionFacts(this.prisma, existing, input);
        return this.executionReadModel(existing, payment, input.voucherFileIds);
      }
      this.assertSameExecutionFacts(existing, {
        ...input,
        voucherFileId: input.voucherFileIds[0]
      });
      return this.executionReadModel(existing, payment);
    }
    const voucher = await this.prisma.spotProcurementPaymentExecution.findFirst({
      where: {
        voucherFileId: { in: input.voucherFileIds },
        voidedAt: null
      },
      select: { id: true }
    });
    if (voucher) {
      throw new ConflictException(
        "该付款凭证已绑定其他有效实际付款记录"
      );
    }
    const realVoucher = await this.prisma.spotProcurementPaymentExecutionVoucher.findFirst({
      where: { fileId: { in: input.voucherFileIds } },
      select: { id: true }
    });
    if (realVoucher) {
      throw new ConflictException("该付款凭证已绑定其他有效实际付款记录");
    }
    return null;
  }

  private requirePayment(
    payments: PaymentLockRow[],
    paymentId: string
  ) {
    const payment = payments.find((row) => row.id === paymentId);
    if (!payment) {
      throw new NotFoundException("零星采购付款申请不存在");
    }
    return payment;
  }

  private assertDraft(payment: PaymentLockRow) {
    if (payment.status !== "draft") {
      throw new ConflictException("当前付款申请不是可编辑草稿");
    }
  }

  private activeSettlementTotal(
    payments: PaymentLockRow[],
    versionId: string
  ) {
    return this.settlementTotalForStatuses(
      payments,
      versionId,
      ACTIVE_CAPACITY_STATUSES
    );
  }

  private settlementTotalForStatuses(
    payments: PaymentLockRow[],
    versionId: string,
    statuses: ReadonlySet<string>
  ) {
    return payments
      .filter(
        (payment) =>
          payment.procurementVersionId === versionId &&
          statuses.has(payment.status)
      )
      .reduce(
        (total, payment) =>
          total +
          nonnegative(
            payment.settlementAmountCents -
              payment.canceledAmountCents
          ),
        0n
      );
  }

  private async paymentCapacityLimit(
    tx: Prisma.TransactionClient,
    version: Pick<
      VersionLockRow,
      "id" | "procurementId" | "totalAmountCents"
    >
  ) {
    const discrepancy =
      await tx.spotProcurementDiscrepancy.findFirst({
        where: {
          procurementId: version.procurementId,
          invalidatedAt: null
        },
        select: {
          procurementVersionId: true,
          status: true,
          actualCostCentsSnapshot: true
        }
      });
    if (!discrepancy || discrepancy.status === "pending_resolution") {
      return version.totalAmountCents;
    }
    if (discrepancy.procurementVersionId !== version.id) {
      throw new ConflictException(
        "当前收货差异与采购版本不一致，请刷新后重试"
      );
    }
    return discrepancy.actualCostCentsSnapshot;
  }

  private async createDraftFromFacts(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    existingPayments: PaymentLockRow[],
    facts: {
      settlementAmountCents: bigint;
      supplierBalanceAmountCents: bigint;
      companyPaymentAmountCents: bigint;
      paymentPath: string | null;
      paymentMethod: string | null;
      payeePartyId: string | null;
      payeeUserId: string | null;
      payeeNameSnapshot: string | null;
      payeeAccountNameSnapshot: string | null;
      payeeBankNameSnapshot: string | null;
      payeeBankAccountSnapshot: string | null;
      expectedPaymentAt: Date | null;
      paymentNote: string | null;
      supportingAttachmentFileId: string | null;
      merchantPaymentProofFileId: string | null;
      balanceOverrideReason: string | null;
      handlerUserId: string;
    },
    actorUserId: string,
    provenance?: {
      draftOrigin: string;
      sourcePaymentId: string;
    }
  ) {
    const versionPaymentCount = existingPayments.filter(
      (payment) => payment.procurementVersionId === version.id
    ).length;
    const suffix = String(versionPaymentCount + 1).padStart(3, "0");
    return tx.spotProcurementPayment.create({
      data: {
        projectId: version.projectId,
        procurementId: version.procurementId,
        procurementVersionId: version.id,
        code: `${version.procurementCode}-V${version.versionNo}-P${suffix}`,
        status: "draft",
        settlementAmountCents: facts.settlementAmountCents,
        supplierBalanceAmountCents:
          facts.supplierBalanceAmountCents,
        companyPaymentAmountCents: facts.companyPaymentAmountCents,
        paidAmountCents: 0n,
        executedSupplierBalanceAmountCents: 0n,
        canceledAmountCents: 0n,
        canceledCompanyPaymentAmountCents: 0n,
        canceledSupplierBalanceAmountCents: 0n,
        paymentPath: facts.paymentPath,
        paymentMethod: facts.paymentMethod,
        paymentType: null,
        merchantNameSnapshot: null,
        merchantPayeeMismatchNote: null,
        payeePartyId: facts.payeePartyId,
        payeeUserId: facts.payeeUserId,
        payeeNameSnapshot: facts.payeeNameSnapshot,
        payeeAccountNameSnapshot: facts.payeeAccountNameSnapshot,
        payeeBankNameSnapshot: facts.payeeBankNameSnapshot,
        payeeBankAccountSnapshot: facts.payeeBankAccountSnapshot,
        expectedPaymentAt: facts.expectedPaymentAt,
        paymentNote: facts.paymentNote,
        supportingAttachmentFileId:
          facts.supportingAttachmentFileId,
        merchantPaymentProofFileId:
          facts.merchantPaymentProofFileId,
        balanceOverrideReason: facts.balanceOverrideReason,
        payerCompanyEntityId: null,
        payerCompanyNameSnapshot: null,
        payerUnifiedSocialCreditCodeSnapshot: null,
        approvalAmountCents: 0n,
        primaryPaymentChannelId: null,
        handlerUserId: facts.handlerUserId,
        createdByUserId: actorUserId,
        draftOrigin: provenance?.draftOrigin ?? null,
        sourcePaymentId: provenance?.sourcePaymentId ?? null
      }
    });
  }

  private cloneSubmittedPaymentToDraft(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    payments: PaymentLockRow[],
    source: PaymentLockRow,
    actorUserId: string,
    balanceAdjustment?: {
      supplierBalanceAmountCents: bigint;
      reason: string;
    },
    draftOrigin: "approval_return_clone" | "approval_withdrawal_clone" =
      "approval_return_clone"
  ) {
    const supplierBalanceAmountCents =
      balanceAdjustment?.supplierBalanceAmountCents ??
      source.supplierBalanceAmountCents;
    const companyPaymentAmountCents =
      source.settlementAmountCents - supplierBalanceAmountCents;
    const balanceOnly = companyPaymentAmountCents === 0n;
    return this.createDraftFromFacts(
      tx,
      version,
      payments,
      {
        settlementAmountCents: source.settlementAmountCents,
        supplierBalanceAmountCents,
        companyPaymentAmountCents,
        paymentPath: balanceOnly
          ? "supplier_direct"
          : source.paymentPath,
        paymentMethod: balanceOnly ? null : source.paymentMethod,
        payeePartyId: balanceOnly
          ? version.supplierPartyId
          : source.payeePartyId,
        payeeUserId: balanceOnly ? null : source.payeeUserId,
        payeeNameSnapshot: balanceOnly
          ? version.supplierNameSnapshot
          : source.payeeNameSnapshot,
        payeeAccountNameSnapshot:
          balanceOnly ? null : source.payeeAccountNameSnapshot,
        payeeBankNameSnapshot: balanceOnly
          ? null
          : source.payeeBankNameSnapshot,
        payeeBankAccountSnapshot:
          balanceOnly ? null : source.payeeBankAccountSnapshot,
        expectedPaymentAt: balanceOnly
          ? null
          : source.expectedPaymentAt,
        paymentNote: source.paymentNote,
        supportingAttachmentFileId:
          source.supportingAttachmentFileId,
        merchantPaymentProofFileId:
          balanceOnly
            ? null
            : source.merchantPaymentProofFileId,
        balanceOverrideReason:
          balanceAdjustment?.reason ??
          source.balanceOverrideReason,
        handlerUserId: source.handlerUserId
      },
      actorUserId,
      { draftOrigin, sourcePaymentId: source.id }
    );
  }

  private async cloneSubmittedRealPaymentToDraft(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    payments: PaymentLockRow[],
    source: PaymentLockRow,
    actorUserId: string
  ) {
    const [lines, channels, methods, attachments] = await Promise.all([
      tx.spotProcurementPaymentLine.findMany({
        where: { paymentId: source.id },
        orderBy: { sortOrder: "asc" }
      }),
      tx.spotProcurementPaymentChannel.findMany({
        where: { paymentId: source.id },
        orderBy: { sortOrder: "asc" }
      }),
      tx.spotProcurementPaymentMethodOption.findMany({
        where: { paymentId: source.id },
        orderBy: { sortOrder: "asc" }
      }),
      tx.spotProcurementPaymentAttachment.findMany({
        where: { paymentId: source.id },
        orderBy: { createdAt: "asc" }
      })
    ]);
    const primaryChannels = channels.filter(
      (channel) => channel.isPrimary
    );
    if (
      !source.paymentType ||
      !source.merchantNameSnapshot ||
      !source.payeeNameSnapshot ||
      !lines.length ||
      !channels.length ||
      !methods.length ||
      primaryChannels.length !== 1
    ) {
      throw new ConflictException(
        "付款申请冻结事实不完整，不能退回修改"
      );
    }
    const versionPaymentCount = payments.filter(
      (payment) => payment.procurementVersionId === version.id
    ).length;
    const suffix = String(versionPaymentCount + 1).padStart(3, "0");
    const draft = await tx.spotProcurementPayment.create({
      data: {
        projectId: version.projectId,
        procurementId: version.procurementId,
        procurementVersionId: version.id,
        code: `${version.procurementCode}-V${version.versionNo}-P${suffix}`,
        status: "draft",
        settlementAmountCents: source.settlementAmountCents,
        supplierBalanceAmountCents:
          source.supplierBalanceAmountCents,
        companyPaymentAmountCents:
          source.companyPaymentAmountCents,
        paidAmountCents: 0n,
        executedSupplierBalanceAmountCents: 0n,
        canceledAmountCents: 0n,
        canceledCompanyPaymentAmountCents: 0n,
        canceledSupplierBalanceAmountCents: 0n,
        paymentPath: source.paymentPath,
        paymentMethod: source.paymentMethod,
        paymentType: source.paymentType,
        merchantNameSnapshot: source.merchantNameSnapshot,
        merchantPayeeMismatchNote:
          source.merchantPayeeMismatchNote,
        payeePartyId: source.payeePartyId,
        payeeUserId: source.payeeUserId,
        payeeNameSnapshot: source.payeeNameSnapshot,
        payeeAccountNameSnapshot:
          source.payeeAccountNameSnapshot,
        payeeBankNameSnapshot: source.payeeBankNameSnapshot,
        payeeBankAccountSnapshot:
          source.payeeBankAccountSnapshot,
        expectedPaymentAt: source.expectedPaymentAt,
        paymentNote: source.paymentNote,
        supportingAttachmentFileId: null,
        merchantPaymentProofFileId: null,
        balanceOverrideReason: null,
        payerCompanyEntityId: source.payerCompanyEntityId,
        payerCompanyNameSnapshot:
          source.payerCompanyNameSnapshot,
        payerUnifiedSocialCreditCodeSnapshot:
          source.payerUnifiedSocialCreditCodeSnapshot,
        approvalAmountCents: source.approvalAmountCents,
        primaryPaymentChannelId: null,
        handlerUserId: source.handlerUserId,
        createdByUserId: actorUserId
      }
    });
    await tx.spotProcurementPaymentLine.createMany({
      data: lines.map((line) => ({
        paymentId: draft.id,
        procurementVersionId: line.procurementVersionId,
        procurementLineId: line.procurementLineId,
        sortOrder: line.sortOrder,
        approvedQuantitySnapshot:
          line.approvedQuantitySnapshot,
        paymentQuantity: line.paymentQuantity,
        unitPrice: line.unitPrice,
        amountCents: line.amountCents,
        expectedInvoiceCondition:
          line.expectedInvoiceCondition,
        vatRateOptionId: line.vatRateOptionId,
        vatRateValueSnapshot: line.vatRateValueSnapshot,
        vatRateLabelSnapshot: line.vatRateLabelSnapshot
      }))
    });
    const clonedChannels = await Promise.all(
      channels.map((channel) =>
        tx.spotProcurementPaymentChannel.create({
          data: {
            paymentId: draft.id,
            sortOrder: channel.sortOrder,
            channelType: channel.channelType,
            accountNameSnapshot:
              channel.accountNameSnapshot,
            accountNumberSnapshot:
              channel.accountNumberSnapshot,
            bankNameSnapshot: channel.bankNameSnapshot,
            channelNote: channel.channelNote,
            isPrimary: channel.isPrimary
          }
        })
      )
    );
    await tx.spotProcurementPaymentMethodOption.createMany({
      data: methods.map((method) => ({
        paymentId: draft.id,
        paymentMethod: method.paymentMethod,
        sortOrder: method.sortOrder
      }))
    });
    const primaryChannel = clonedChannels.find(
      (channel) => channel.isPrimary
    );
    if (!primaryChannel) {
      throw new ConflictException(
        "付款申请主收款渠道缺失，不能退回修改"
      );
    }
    const payment = await tx.spotProcurementPayment.update({
      where: { id: draft.id },
      data: {
        primaryPaymentChannelId: primaryChannel.id,
        paymentMethod: primaryChannel.channelType,
        payeeAccountNameSnapshot:
          primaryChannel.accountNameSnapshot,
        payeeBankNameSnapshot:
          primaryChannel.bankNameSnapshot,
        payeeBankAccountSnapshot:
          primaryChannel.accountNumberSnapshot
      }
    });
    return {
      payment,
      retainedOriginalAttachmentCount: attachments.length,
      clonedPaymentLineCount: lines.length,
      clonedPaymentChannelCount: channels.length,
      clonedPaymentMethodCount: methods.length
    };
  }

  private async createLegacyNextDraft(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    payments: PaymentLockRow[],
    actorUserId: string,
    provenance?: { draftOrigin: string; sourcePaymentId: string }
  ) {
    await this.requireHandler(tx, version, actorUserId);
    const occupied = this.settlementTotalForStatuses(
      payments,
      version.id,
      PLANNED_PAYMENT_STATUSES
    );
    const capacityLimit = await this.paymentCapacityLimit(tx, version);
    const remaining = capacityLimit - occupied;
    if (remaining <= 0n) {
      throw new ConflictException("当前采购已没有可新建的付款申请金额");
    }
    const suggestion = await this.balances.suggestionWithClient(
      tx,
      version.projectId,
      version.supplierKey,
      remaining
    );
    const suggestedBalanceAmountCents = BigInt(suggestion.suggestedBalanceAmountCents);
    const payment = await this.createDraftFromFacts(
      tx,
      version,
      payments,
      {
        settlementAmountCents: remaining,
        supplierBalanceAmountCents: suggestedBalanceAmountCents,
        companyPaymentAmountCents: remaining - suggestedBalanceAmountCents,
        paymentPath: null,
        paymentMethod: null,
        payeePartyId: version.supplierPartyId,
        payeeUserId: null,
        payeeNameSnapshot: version.supplierNameSnapshot,
        payeeAccountNameSnapshot: null,
        payeeBankNameSnapshot: null,
        payeeBankAccountSnapshot: null,
        expectedPaymentAt: null,
        paymentNote: null,
        supportingAttachmentFileId: null,
        merchantPaymentProofFileId: null,
        balanceOverrideReason: null,
        handlerUserId: version.handlerUserId
      },
      actorUserId,
      provenance
    );
    return { payment, suggestion, amountCents: remaining };
  }

  private recordDraftRecreationAudit(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    version: VersionLockRow,
    sourcePaymentId: string,
    newPaymentId: string
  ) {
    return this.audit.record(tx, {
      actorUserId,
      action: "spot_procurement.payment.draft.recreate",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
      businessId: newPaymentId,
      metadata: {
        procurementId: version.procurementId,
        procurementVersionId: version.id,
        sourcePaymentId,
        draftOrigin: "manual_recreate"
      }
    });
  }

  private async lockPaymentTerminationFacts(
    tx: Prisma.TransactionClient,
    paymentIds: string[]
  ) {
    const approvals = await tx.$queryRaw<Array<{ businessId: string }>>(Prisma.sql`
      SELECT "businessId"
      FROM "ApprovalInstance"
      WHERE "businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.payment}
        AND "businessId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const reservations = await tx.$queryRaw<PaymentReservationLockRow[]>(Prisma.sql`
      SELECT "paymentId", "amountCents", "releasedAmountCents", "status"
      FROM "SupplierBalanceReservation"
      WHERE "paymentId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const executions = await tx.$queryRaw<Array<{ paymentId: string }>>(Prisma.sql`
      SELECT "paymentId"
      FROM "SpotProcurementPaymentExecution"
      WHERE "paymentId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const invoices = await tx.$queryRaw<Array<{ paymentId: string }>>(Prisma.sql`
      SELECT "paymentId"
      FROM "SpotProcurementPaymentInvoice"
      WHERE "paymentId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const archives = await tx.$queryRaw<Array<{ paymentId: string }>>(Prisma.sql`
      SELECT "paymentId"
      FROM "SpotProcurementPaymentArchive"
      WHERE "paymentId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const archiveRecords = await tx.$queryRaw<Array<{ businessId: string }>>(Prisma.sql`
      SELECT "businessId"
      FROM "ArchiveRecord"
      WHERE "businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.payment}
        AND "businessId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const refunds = await tx.$queryRaw<Array<{ paymentId: string | null }>>(Prisma.sql`
      SELECT "paymentId"
      FROM "SpotProcurementRefund"
      WHERE "paymentId" IN (${Prisma.join(paymentIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    return {
      approvalBusinessIds: new Set(approvals.map((row) => row.businessId)),
      reservations,
      executionPaymentIds: new Set(executions.map((row) => row.paymentId)),
      invoicePaymentIds: new Set(invoices.map((row) => row.paymentId)),
      archivePaymentIds: new Set([
        ...archives.map((row) => row.paymentId),
        ...archiveRecords.map((row) => row.businessId)
      ]),
      refundPaymentIds: new Set(refunds.flatMap((row) => row.paymentId ? [row.paymentId] : []))
    };
  }

  private async requireLockedApproval(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    const rows = await tx.$queryRaw<Array<ApprovalLockRow>>(Prisma.sql`
      SELECT
        "id",
        "status",
        "currentNodeIndex",
        "frozenNodes",
        "applicantUserId"
      FROM "ApprovalInstance"
      WHERE "flowType" = 'spot_procurement.payment.approve'
        AND "businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.payment}
        AND "businessId" = ${paymentId}
        AND "status" = 'approval_pending'
      LIMIT 1
      FOR UPDATE
    `);
    const approval = rows[0];
    if (!approval) {
      throw new ConflictException("当前付款审批实例不存在或状态已变化");
    }
    return approval;
  }

  private approveCurrentNode(
    frozenNodes: Prisma.JsonValue,
    currentNodeIndex: number,
    approvedRoleKey: RoleKey
  ) {
    if (!Array.isArray(frozenNodes)) {
      throw new ConflictException("付款审批节点快照损坏");
    }
    const nodes = frozenNodes.map((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new ConflictException("付款审批节点快照损坏");
      }
      return { ...node } as unknown as SpotProcurementApprovalNode;
    });
    const current = nodes[currentNodeIndex];
    if (!current) {
      throw new ConflictException("付款审批当前节点不存在");
    }
    current.approvedRoleKeys = [
      ...new Set([
        ...(current.approvedRoleKeys ?? []),
        approvedRoleKey
      ])
    ];
    return nodes;
  }

  private async recordReviewAudit(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    payment: PaymentLockRow,
    approvalInstanceId: string,
    decision: string,
    approvedRoleKey: RoleKey,
    extraMetadata: Record<string, Prisma.InputJsonValue> = {}
  ) {
    await this.audit.record(tx, {
      actorUserId,
      action: `spot_procurement.payment.approval.${decision}`,
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
      businessId: payment.id,
      metadata: {
        approvalInstanceId,
        procurementId: payment.procurementId,
        procurementVersionId: payment.procurementVersionId,
        reviewRoleKey: approvedRoleKey,
        ...extraMetadata
      }
    });
  }

  private paymentSnapshot(payment: PreparedPayment) {
    const bankAccount = auditBankAccountFacts(
      payment.payeeBankAccountSnapshot
    );
    return {
      settlementAmountCents:
        payment.settlementAmountCents.toString(),
      supplierBalanceAmountCents:
        payment.supplierBalanceAmountCents.toString(),
      companyPaymentAmountCents:
        payment.companyPaymentAmountCents.toString(),
      paymentPath: payment.paymentPath,
      paymentMethod: payment.paymentMethod,
      payeePartyId: payment.payeePartyId,
      payeeUserId: payment.payeeUserId,
      payeeNameSnapshot: payment.payeeNameSnapshot,
      payeeAccountNameSnapshot:
        payment.payeeAccountNameSnapshot,
      payeeBankNameSnapshot: payment.payeeBankNameSnapshot,
      ...bankAccount,
      expectedPaymentAt:
        payment.expectedPaymentAt?.toISOString() ?? null,
      paymentNote: payment.paymentNote,
      supportingAttachmentFileId:
        payment.supportingAttachmentFileId,
      merchantPaymentProofFileId:
        payment.merchantPaymentProofFileId,
      balanceOverrideReason: payment.balanceOverrideReason
    };
  }

  private updateRealFormDraft(
    paymentId: string,
    actorUserId: string,
    input: UpdateSpotProcurementPaymentDraftDto
  ) {
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const payment = await tx.spotProcurementPayment.findUnique({
          where: { id: paymentId }
        });
        if (!payment) throw new NotFoundException("零星材料付款申请不存在");
        this.pilot.assertEnabled(payment.projectId);
        if (payment.status !== "draft") {
          throw new ConflictException("当前付款申请不是可编辑草稿");
        }
        if (payment.handlerUserId !== actorUserId) {
          throw new ForbiddenException("只有采购经办人可以编辑付款申请");
        }
        const [procurement, version, procurementLines] = await Promise.all([
          tx.spotProcurement.findUnique({ where: { id: payment.procurementId } }),
          tx.spotProcurementVersion.findUnique({
            where: { id: payment.procurementVersionId }
          }),
          tx.spotProcurementLine.findMany({
            where: { versionId: payment.procurementVersionId },
            orderBy: { sortOrder: "asc" }
          })
        ]);
        if (
          !procurement ||
          !version ||
          procurement.currentVersionId !== version.id ||
          version.status !== "approved" ||
          procurement.status !== "approved_in_progress"
        ) {
          throw new ConflictException("付款申请关联的采购批准版本已变化，请刷新后重试");
        }
        const prepared = await this.prepareRealFormPayment(
          tx,
          payment,
          procurementLines,
          actorUserId,
          input
        );
        await tx.spotProcurementPaymentLine.deleteMany({
          where: { paymentId: payment.id }
        });
        await tx.spotProcurementPaymentChannel.deleteMany({
          where: { paymentId: payment.id }
        });
        await tx.spotProcurementPaymentMethodOption.deleteMany({
          where: { paymentId: payment.id }
        });
        await tx.spotProcurementPaymentAttachment.deleteMany({
          where: { paymentId: payment.id }
        });
        await tx.spotProcurementPaymentLine.createMany({
          data: prepared.lines.map((line, index) => ({
            paymentId: payment.id,
            procurementVersionId: payment.procurementVersionId,
            procurementLineId: line.procurementLineId,
            sortOrder: index + 1,
            approvedQuantitySnapshot: line.approvedQuantity,
            paymentQuantity: line.paymentQuantity,
            unitPrice: line.unitPrice,
            amountCents: line.amountCents,
            expectedInvoiceCondition: line.expectedInvoiceCondition,
            vatRateOptionId: line.vatRateOptionId,
            vatRateValueSnapshot: line.vatRateValueSnapshot,
            vatRateLabelSnapshot: line.vatRateLabelSnapshot
          }))
        });
        const channels = await Promise.all(
          prepared.channels.map((channel, index) =>
            tx.spotProcurementPaymentChannel.create({
              data: {
                paymentId: payment.id,
                sortOrder: index + 1,
                channelType: channel.channelType,
                accountNameSnapshot: channel.accountName,
                accountNumberSnapshot: channel.accountNumber,
                bankNameSnapshot: channel.bankName,
                channelNote: channel.note,
                isPrimary: channel.isPrimary
              }
            })
          )
        );
        await tx.spotProcurementPaymentMethodOption.createMany({
          data: prepared.paymentMethods.map((paymentMethod, index) => ({
            paymentId: payment.id,
            paymentMethod,
            sortOrder: index + 1
          }))
        });
        if (prepared.attachments.length) {
          await tx.spotProcurementPaymentAttachment.createMany({
            data: prepared.attachments.map((attachment) => ({
              paymentId: payment.id,
              fileId: attachment.fileId,
              category: attachment.category,
              uploadedByUserId: actorUserId
            }))
          });
        }
        const primaryChannel = channels.find((channel) => channel.isPrimary);
        const updated = await tx.spotProcurementPayment.update({
          where: { id: payment.id },
          data: {
            settlementAmountCents: prepared.approvalAmountCents,
            supplierBalanceAmountCents: 0n,
            companyPaymentAmountCents: prepared.approvalAmountCents,
            paymentPath:
              prepared.paymentType === "company_direct"
                ? "supplier_direct"
                : "handler_reimbursement",
            paymentMethod: primaryChannel?.channelType ?? null,
            paymentType: prepared.paymentType,
            merchantNameSnapshot: prepared.merchantName,
            merchantPayeeMismatchNote: prepared.merchantPayeeMismatchNote,
            payeePartyId: null,
            payeeUserId:
              prepared.paymentType === "handler_reimbursement"
                ? actorUserId
                : null,
            payeeNameSnapshot: prepared.payeeName,
            payeeAccountNameSnapshot:
              primaryChannel?.accountNameSnapshot ?? null,
            payeeBankNameSnapshot: primaryChannel?.bankNameSnapshot ?? null,
            payeeBankAccountSnapshot:
              primaryChannel?.accountNumberSnapshot ?? null,
            approvalAmountCents: prepared.approvalAmountCents,
            primaryPaymentChannelId: primaryChannel?.id ?? null,
            paymentNote: null,
            supportingAttachmentFileId: null,
            merchantPaymentProofFileId: null,
            balanceOverrideReason: null
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.real_form_draft.update",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            procurementId: payment.procurementId,
            procurementVersionId: payment.procurementVersionId,
            merchantName: prepared.merchantName,
            paymentType: prepared.paymentType,
            payeeName: prepared.payeeName,
            approvalAmountCents: prepared.approvalAmountCents.toString(),
            lineCount: prepared.lines.length,
            channelCount: prepared.channels.length,
            attachmentCount: prepared.attachments.length
          }
        });
        return this.paymentReadModel(updated);
      })
    );
  }

  private submitRealForm(paymentId: string, actorUserId: string) {
    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const version = await this.requireLockedVersionForPayment(tx, paymentId);
        this.pilot.assertEnabled(version.projectId);
        const payment = await tx.spotProcurementPayment.findUnique({
          where: { id: paymentId }
        });
        if (!payment) throw new NotFoundException("零星材料付款申请不存在");
        if (payment.status !== "draft") {
          throw new ConflictException("当前付款申请不是可提交草稿");
        }
        if (payment.handlerUserId !== actorUserId) {
          throw new ForbiddenException("只有采购经办人可以提交付款申请");
        }
        const [lines, procurementLines, channels, methods, siblingPayments] = await Promise.all([
          tx.spotProcurementPaymentLine.findMany({
            where: { paymentId: payment.id },
            orderBy: { sortOrder: "asc" }
          }),
          tx.spotProcurementLine.findMany({
            where: { versionId: payment.procurementVersionId },
            orderBy: { sortOrder: "asc" },
            select: { id: true, quantity: true }
          }),
          tx.spotProcurementPaymentChannel.findMany({
            where: { paymentId: payment.id },
            orderBy: { sortOrder: "asc" }
          }),
          tx.spotProcurementPaymentMethodOption.findMany({
            where: { paymentId: payment.id },
            orderBy: { sortOrder: "asc" }
          }),
          tx.spotProcurementPayment.findMany({
            where: {
              procurementVersionId: payment.procurementVersionId,
              id: { not: payment.id },
              status: { in: [...ACTIVE_CAPACITY_STATUSES] }
            },
            select: { id: true }
          })
        ]);
        if (
          !payment.paymentType ||
          !payment.merchantNameSnapshot ||
          !payment.payeeNameSnapshot ||
          !lines.length ||
          !channels.length ||
          !methods.length ||
          channels.filter((channel) => channel.isPrimary).length !== 1
        ) {
          throw new BadRequestException("请完整填写付款商户、明细、收款对象、收款渠道和拟付款方式后再提交");
        }
        if (siblingPayments.length) {
          throw new ConflictException("同一材料申请已有活动付款，不能拆分或重复提交");
        }
        this.assertCompleteRealFormMaterialScope(procurementLines, lines);
        const total = lines.reduce((sum, line) => sum + line.amountCents, 0n);
        if (total <= 0n || total !== payment.approvalAmountCents) {
          throw new ConflictException("付款申请金额与付款明细不一致，请刷新后重试");
        }
        if (total >= SPOT_MATERIAL_PAYMENT_LIMIT_CENTS) {
          throw new BadRequestException(
            "材料申请合计达到 3000 元，请重新走材料采购审批流程"
          );
        }
        const now = new Date();
        const approval = await tx.approvalInstance.create({
          data: {
            flowType: "spot_procurement.payment.approve",
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: payment.id,
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: paymentApprovalNodes() as unknown as Prisma.InputJsonValue,
            applicantUserId: payment.handlerUserId
          }
        });
        const updated = await tx.spotProcurementPayment.update({
          where: { id: payment.id },
          data: {
            status: "approval_pending",
            submittedAt: now,
            submittedVersionNo: version.versionNo,
            factsFrozenAt: now
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.approval.submit",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            approvalInstanceId: approval.id,
            procurementId: payment.procurementId,
            procurementVersionId: payment.procurementVersionId,
            approvalAmountCents: total.toString(),
            payerCompanyEntityId:
              payment.payerCompanyEntityId
          }
        });
        return this.paymentReadModel(updated);
      });
      await this.approvalForms.tryRefreshLatestForBusiness(
        SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        paymentId,
        actorUserId,
        "approval.submit"
      );
      return result;
    });
  }

  private async prepareRealFormPayment(
    tx: Prisma.TransactionClient,
    payment: { handlerUserId: string },
    procurementLines: Array<{
      id: string;
      quantity: Prisma.Decimal;
    }>,
    actorUserId: string,
    input: UpdateSpotProcurementPaymentDraftDto
  ) {
    if (
      !input.paymentType ||
      !input.merchantName ||
      !input.paymentLines ||
      !input.channels ||
      !input.paymentMethods
    ) {
      throw new BadRequestException("请完整填写付款商户、明细、收款对象、收款渠道和拟付款方式");
    }
    const merchantName = requiredText(input.merchantName, "请填写实际商户名称");
    const handler = await tx.user.findUnique({
      where: { id: payment.handlerUserId },
      select: { id: true, name: true, isActive: true }
    });
    if (!handler?.isActive) throw new ConflictException("采购经办人不存在或已停用");
    const payeeName =
      input.paymentType === "handler_reimbursement"
        ? handler.name
        : requiredText(input.payeeName, "请填写收款对象");
    const merchantPayeeMismatchNote =
      input.paymentType === "handler_reimbursement"
        ? "经办人垫付后报回"
        : merchantName === payeeName
          ? null
          : requiredText(
              input.merchantPayeeMismatchNote,
              "实际商户与收款对象不一致时必须填写说明"
            );
    const lineById = new Map(procurementLines.map((line) => [line.id, line]));
    if (new Set(input.paymentLines.map((line) => line.procurementLineId)).size !== input.paymentLines.length) {
      throw new BadRequestException("同一付款申请不能重复引用采购材料明细");
    }
    const lines = input.paymentLines.map((line) => {
      const source = lineById.get(line.procurementLineId);
      if (!source) throw new BadRequestException("付款材料明细必须引用当前采购批准材料");
      const calculated = calculateSpotProcurementLine({
        quantity: line.paymentQuantity,
        unitPrice: line.unitPrice
      });
      const paymentQuantity = new Prisma.Decimal(line.paymentQuantity);
      if (paymentQuantity.greaterThan(source.quantity)) {
        throw new BadRequestException("付款材料数量不能超过采购批准数量");
      }
      const vatRate =
        line.expectedInvoiceCondition === "no_invoice"
          ? null
          : normalizeVatRatePercent(line.vatRatePercent);
      return {
        procurementLineId: source.id,
        approvedQuantity: source.quantity,
        paymentQuantity,
        unitPrice: new Prisma.Decimal(line.unitPrice),
        amountCents: calculated.amountCents,
        expectedInvoiceCondition: line.expectedInvoiceCondition,
        vatRateOptionId: null,
        vatRateValueSnapshot: vatRate?.value ?? null,
        vatRateLabelSnapshot: vatRate?.label ?? null
      };
    });
    this.assertCompleteRealFormMaterialScope(procurementLines, lines);
    const approvalAmountCents = lines.reduce((sum, line) => sum + line.amountCents, 0n);
    if (approvalAmountCents <= 0n) throw new BadRequestException("付款申请金额必须大于 0");
    if (new Set(input.paymentMethods).size !== input.paymentMethods.length) {
      throw new BadRequestException("拟付款方式不能重复");
    }
    if (input.channels.filter((channel) => channel.isPrimary).length !== 1) {
      throw new BadRequestException("必须且只能选择一个主收款渠道");
    }
    const channels = input.channels.map((channel) => this.normalizeRealFormChannel(channel));
    const primary = channels.find((channel) => channel.isPrimary);
    if (!primary || !input.paymentMethods.includes(primary.channelType)) {
      throw new BadRequestException("主收款渠道必须属于已选择的拟付款方式");
    }
    const attachments = await this.validateRealFormAttachments(
      tx,
      input.attachments ?? [],
      actorUserId
    );
    return {
      paymentType: input.paymentType,
      merchantName,
      payeeName,
      merchantPayeeMismatchNote,
      lines,
      channels,
      paymentMethods: input.paymentMethods,
      attachments,
      approvalAmountCents
    };
  }

  private assertCompleteRealFormMaterialScope(
    procurementLines: Array<{ id: string; quantity: Prisma.Decimal }>,
    paymentLines: Array<{
      procurementLineId: string;
      paymentQuantity: Prisma.Decimal;
    }>
  ) {
    if (procurementLines.length !== paymentLines.length) {
      throw new BadRequestException(
        "零星材料付款必须完整覆盖本申请全部批准材料和数量"
      );
    }
    const paymentLineBySource = new Map(
      paymentLines.map((line) => [line.procurementLineId, line])
    );
    if (
      procurementLines.some((source) => {
        const paymentLine = paymentLineBySource.get(source.id);
        return !paymentLine || !paymentLine.paymentQuantity.equals(source.quantity);
      })
    ) {
      throw new BadRequestException(
        "零星材料付款必须完整覆盖本申请全部批准材料和数量"
      );
    }
  }

  private normalizeRealFormChannel(channel: SpotProcurementPaymentChannelDto) {
    const accountName = optionalText(channel.accountName);
    const accountNumber = optionalText(channel.accountNumber);
    const bankName = optionalText(channel.bankName);
    if (channel.channelType === "bank_transfer" && (!accountName || !accountNumber || !bankName)) {
      throw new BadRequestException("银行收款渠道必须填写账户名称、账号和开户银行");
    }
    return {
      channelType: channel.channelType,
      accountName,
      accountNumber,
      bankName,
      note: optionalText(channel.note),
      isPrimary: channel.isPrimary
    };
  }

  private async validateRealFormAttachments(
    tx: Prisma.TransactionClient,
    attachments: SpotProcurementPaymentAttachmentDto[],
    actorUserId: string
  ) {
    const fileIds = attachments.map((attachment) => attachment.fileId);
    if (new Set(fileIds).size !== fileIds.length) {
      throw new BadRequestException("同一付款申请不能重复引用同一付款依据");
    }
    if (!fileIds.length) return [];
    const files = await tx.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, storageStatus: true, uploadedByUserId: true }
    });
    if (files.length !== fileIds.length || files.some((file) => file.storageStatus !== "active")) {
      throw new BadRequestException("付款依据不存在或已失效，请重新上传");
    }
    if (files.some((file) => file.uploadedByUserId !== actorUserId)) {
      throw new ForbiddenException("付款依据必须由采购经办人本人上传");
    }
    return attachments.map((attachment) => ({
      fileId: attachment.fileId,
      category: attachment.category
    }));
  }

  private paymentReadModel(
    payment: {
      id: string;
      code: string;
      status: string;
      projectId: string;
      procurementId: string;
      procurementVersionId: string;
      settlementAmountCents: bigint;
      supplierBalanceAmountCents: bigint;
      companyPaymentAmountCents: bigint;
      paidAmountCents?: bigint;
      executedSupplierBalanceAmountCents?: bigint;
      handlerUserId: string;
      paymentPath?: string | null;
      payeePartyId?: string | null;
      payeeUserId?: string | null;
      payeeNameSnapshot?: string | null;
      balanceOverrideReason?: string | null;
      invalidatedAt?: Date | null;
      invalidatedByUserId?: string | null;
      invalidatedReason?: string | null;
      updatedAt?: Date;
    },
    suggestion?: {
      availableBalanceAmountCents: string;
      suggestedBalanceAmountCents: string;
    },
    extra: Record<string, string> = {}
  ) {
    return {
      id: payment.id,
      code: payment.code,
      status: payment.status,
      projectId: payment.projectId,
      procurementId: payment.procurementId,
      procurementVersionId: payment.procurementVersionId,
      settlementAmountCents:
        payment.settlementAmountCents.toString(),
      supplierBalanceAmountCents:
        payment.supplierBalanceAmountCents.toString(),
      companyPaymentAmountCents:
        payment.companyPaymentAmountCents.toString(),
      paidAmountCents: (payment.paidAmountCents ?? 0n).toString(),
      executedSupplierBalanceAmountCents: (
        payment.executedSupplierBalanceAmountCents ?? 0n
      ).toString(),
      handlerUserId: payment.handlerUserId,
      paymentPath: payment.paymentPath ?? null,
      payeePartyId: payment.payeePartyId ?? null,
      payeeUserId: payment.payeeUserId ?? null,
      payeeNameSnapshot: payment.payeeNameSnapshot ?? "",
      balanceOverrideReason:
        payment.balanceOverrideReason ?? null,
      invalidatedAt: payment.invalidatedAt?.toISOString() ?? null,
      invalidatedByUserId: payment.invalidatedByUserId ?? null,
      invalidatedReason: payment.invalidatedReason ?? null,
      updatedAt: payment.updatedAt?.toISOString() ?? null,
      ...(suggestion ?? {}),
      ...extra
    };
  }

  private async loadActorRoleKeys(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    return (
      await this.loadActorRoleScopes(
        tx,
        actorUserId,
        projectId
      )
    ).effectiveRoleKeys;
  }

  private async loadActorRoleScopes(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<{
    effectiveRoleKeys: RoleKey[];
    projectRoleKeys: RoleKey[];
  }> {
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
    const roleKeyByPositionId = new Map(
      positions.map((position) => [
        position.id,
        position.key as RoleKey
      ])
    );
    const globalRoleKeys = globalPositions.flatMap((position) => {
      const roleKey = roleKeyByPositionId.get(position.positionId);
      return roleKey ? [roleKey] : [];
    });
    const projectRoleKeys = [
      ...projectPositions.flatMap((position) => {
        const roleKey = roleKeyByPositionId.get(position.positionId);
        return roleKey ? [roleKey] : [];
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
      throw new BadRequestException(message);
    }
  }

  private requireAnyRole(
    roles: readonly RoleKey[],
    allowed: ReadonlySet<RoleKey>,
    message: string
  ) {
    if (!roles.some((role) => allowed.has(role))) {
      throw new ForbiddenException(message);
    }
  }

  private runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    return this.prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
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
          "付款或供应商余额已变化，请刷新后重试"
        );
      }
      if (
        code === "P2002" ||
        code === "P2003" ||
        code === "P2025"
      ) {
        throw new ConflictException(
          "零星采购付款数据已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }

  private async runPayerWriteWithRetry<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code = prismaErrorCode(error);
        if (code === "P2034") {
          if (attempt === 0) continue;
          throw new ConflictException(PAYER_TASK_COMPLETED_ERROR);
        }
        if (
          code === "P2002" ||
          code === "P2003" ||
          code === "P2025"
        ) {
          throw new ConflictException(
            "零星采购付款数据已变化，请刷新后重试"
          );
        }
        throw error;
      }
    }
    throw new ConflictException(PAYER_TASK_COMPLETED_ERROR);
  }
}

function parseMoney(input: string | undefined, fallback: bigint) {
  if (input === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/u.test(input)) {
    throw new BadRequestException("付款金额格式不正确");
  }
  const value = BigInt(input);
  if (!isWithinPostgresBigIntRange(value)) {
    throw new BadRequestException("付款金额超出系统可保存范围");
  }
  return value;
}

function mergedText(
  input: string | null | undefined,
  fallback: string | null
) {
  if (input === undefined) return fallback;
  if (input === null) return null;
  const value = input.trim();
  return value || null;
}

function optionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function normalizeVatRatePercent(value: string | null | undefined) {
  const normalized = requiredText(value, "有票明细必须填写税率");
  if (!VAT_RATE_PERCENT.test(normalized)) {
    throw new BadRequestException("税率必须是 0 到 100、最多 2 位小数的数字");
  }
  const decimal = new Prisma.Decimal(normalized);
  return { value: decimal, label: `${decimal.toString()}%` };
}

function requiredText(value: string | null | undefined, message: string) {
  const text = value?.trim() ?? "";
  if (!text) throw new BadRequestException(message);
  return text;
}

function isRealPaymentForm(
  payment: Pick<PaymentLockRow, "paymentType" | "status">,
  version?: { totalAmountCents: bigint | null }
) {
  if (payment.paymentType) return true;

  return (
    payment.status === "draft" &&
    version !== undefined &&
    version.totalAmountCents === null
  );
}

function hasRealFormPaymentFacts(input: UpdateSpotProcurementPaymentDraftDto) {
  return (
    input.paymentType !== undefined ||
    input.merchantName !== undefined ||
    input.payeeName !== undefined ||
    input.paymentLines !== undefined ||
    input.channels !== undefined ||
    input.paymentMethods !== undefined ||
    input.attachments !== undefined
  );
}

function resetPaymentApprovalToComprehensive(frozenNodes: Prisma.JsonValue) {
  if (!Array.isArray(frozenNodes) || frozenNodes.length < 3) {
    throw new ConflictException("付款审批节点快照损坏，不能重新发起审批");
  }
  return frozenNodes.map((node, index) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new ConflictException("付款审批节点快照损坏，不能重新发起审批");
    }
    const copy = { ...(node as Record<string, Prisma.JsonValue>) };
    if (index <= 2) delete copy.approvedRoleKeys;
    return copy;
  });
}

function parsePositiveExecutionAmount(value: string) {
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new BadRequestException("实付金额格式不正确");
  }
  const amount = BigInt(value);
  if (!isWithinPostgresBigIntRange(amount)) {
    throw new BadRequestException("实付金额超出系统可保存范围");
  }
  if (amount <= 0n) {
    throw new BadRequestException("实付金额必须大于 0");
  }
  return amount;
}

function requiredExecutionText(
  value: string,
  emptyMessage: string,
  max: number,
  longMessage: string
) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestException(emptyMessage);
  }
  if ([...normalized].length > max) {
    throw new BadRequestException(longMessage);
  }
  return normalized;
}

function optionalExecutionText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function requiredExecutionVoucherFileIds(input: RecordSpotProcurementPaymentDto) {
  const source = input.voucherFileIds ?? (input.voucherFileId ? [input.voucherFileId] : []);
  if (!source.length) {
    throw new BadRequestException("付款凭证不能为空");
  }
  const ids = source.map((value) =>
    requiredExecutionText(value, "付款凭证不能为空", 128, "付款凭证编号不能超过 128 个字符")
  );
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException("同一笔实际付款不能重复上传同一凭证");
  }
  return ids;
}

function auditBankAccountFacts(value: string | null) {
  const normalized = value?.replace(/\s+/gu, "") ?? "";
  return {
    bankAccountProvided: normalized.length > 0,
    bankAccountLast4:
      normalized.length > 0 ? normalized.slice(-4) : null
  };
}

function nonnegative(value: bigint) {
  return value > 0n ? value : 0n;
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (code === "P2010") {
    const meta = (error as { meta?: unknown }).meta;
    if (meta && typeof meta === "object") {
      const postgresCode = (meta as { code?: unknown }).code;
      if (
        ["40001", "40P01"].includes(
          String(postgresCode)
        )
      ) {
        return "P2034";
      }
    }
  }
  if (code === "40P01") {
    return "P2034";
  }
  return typeof code === "string" ? code : undefined;
}
