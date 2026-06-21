import { Injectable } from "@nestjs/common";
import {
  canCreatePaymentFromSettlementStatus,
  SettlementStatus
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
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
}
