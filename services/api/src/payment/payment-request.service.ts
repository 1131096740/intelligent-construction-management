import { Injectable } from "@nestjs/common";
import {
  canCreatePaymentFromSettlementStatus,
  SettlementStatus
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";

@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly amount: PaymentAmountService,
    private readonly prisma?: PrismaService
  ) {}

  assertSettlementEffective(status: SettlementStatus): void {
    if (!canCreatePaymentFromSettlementStatus(status)) {
      throw new Error("Cannot create payment request from a non-effective settlement");
    }
  }

  assertRequestAllowed(
    status: SettlementStatus,
    capacity: PaymentCapacity,
    requestedAmountCents: number
  ): void {
    this.assertSettlementEffective(status);
    this.amount.assertCanRequest(capacity, requestedAmountCents);
  }

  async create(input: CreatePaymentRequestDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create payment request");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: input.settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      this.assertSettlementEffective(settlement.status as SettlementStatus);

      const existingApprovedOrPending = await tx.paymentRequest.findMany({
        where: {
          settlementId: settlement.id,
          status: {
            in: ["approval_pending", "approved_pending_payment"]
          }
        }
      });
      const approvedPendingPaymentCents = existingApprovedOrPending.reduce(
        (total, payment) =>
          total + Math.max(payment.requestedAmountCents - payment.paidAmountCents, 0),
        0
      );
      const capacity: PaymentCapacity = {
        payableAmountCents: settlement.payableAmountCents,
        approvedPendingPaymentCents,
        paidAmountCents: settlement.paidAmountCents
      };

      this.amount.assertCanRequest(capacity, input.requestedAmountCents);

      return tx.paymentRequest.create({
        data: {
          projectId: settlement.projectId,
          settlementId: settlement.id,
          contractId: settlement.contractId,
          contractVersionId: settlement.contractVersionId,
          paymentTermsVersionId: settlement.paymentTermsVersionId,
          code: input.code,
          status: "approval_pending",
          requestedAmountCents: input.requestedAmountCents,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      });
    });
  }

  async reviewApproval(paymentId: string, input: ReviewPaymentApprovalDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to review payment approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot review payment approval from status ${payment.status}`);
      }

      if (input.decision === "reject") {
        return tx.paymentRequest.update({
          where: { id: payment.id },
          data: {
            status: "rejected",
            approvedAmountCents: null
          }
        });
      }

      const approvedAmountCents = input.approvedAmountCents ?? payment.requestedAmountCents;
      if (approvedAmountCents > payment.requestedAmountCents) {
        throw new Error("Approved amount cannot exceed requested amount");
      }

      return tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          status: "approved_pending_payment",
          approvedAmountCents
        }
      });
    });
  }

  async recordExecution(paymentId: string, input: RecordPaymentExecutionDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to record payment execution");
    }

    if (typeof input.amountCents !== "number" || input.amountCents <= 0) {
      throw new Error("Payment execution amount must be greater than zero");
    }

    if (!input.voucherFileId?.trim()) {
      throw new Error("Payment voucher file is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (!["approved_pending_payment", "partially_paid"].includes(payment.status)) {
        throw new Error(`Cannot record payment execution from status ${payment.status}`);
      }

      const approvedAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const remainingAmountCents = approvedAmountCents - payment.paidAmountCents;
      if (input.amountCents > remainingAmountCents) {
        throw new Error(
          `Payment execution exceeds approved remaining amount: ${remainingAmountCents}`
        );
      }

      const settlement = await tx.settlement.findUnique({
        where: { id: payment.settlementId }
      });

      if (!settlement) {
        throw new Error("Payment settlement not found");
      }

      const newPaymentPaidAmountCents = payment.paidAmountCents + input.amountCents;
      const newPaymentStatus =
        newPaymentPaidAmountCents >= approvedAmountCents ? "paid" : "partially_paid";
      const newSettlementPaidAmountCents = settlement.paidAmountCents + input.amountCents;
      const newSettlementStatus =
        newSettlementPaidAmountCents >= settlement.payableAmountCents ? "paid" : "partially_paid";

      const execution = await tx.paymentExecution.create({
        data: {
          paymentRequestId: payment.id,
          settlementId: payment.settlementId,
          amountCents: input.amountCents,
          paidAt: new Date(input.paidAt),
          executedByUserId: input.executedByUserId,
          voucherFileId: input.voucherFileId
        }
      });

      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          paidAmountCents: newPaymentPaidAmountCents,
          status: newPaymentStatus
        }
      });

      await tx.settlement.update({
        where: { id: settlement.id },
        data: {
          paidAmountCents: newSettlementPaidAmountCents,
          status: newSettlementStatus
        }
      });

      return execution;
    });
  }
}
