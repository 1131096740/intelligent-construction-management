import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";

/** Records payments already made outside the system; it never initiates a bank transfer. */
@Injectable()
export class RegisteredPaymentExecutionService {
  private readonly roles: CompanyRoleResolverService;
  constructor(private readonly prisma: PrismaService) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  private async canRegister(tx: Prisma.TransactionClient, actorUserId: string): Promise<boolean> {
    try {
      const roles = await this.roles.resolveActiveRoleScopesInTransaction(tx, actorUserId);
      return roles.some(role => ["finance_staff", "finance_director", "comprehensive_director"].includes(role));
    } catch { return false; }
  }

  async result(actorUserId: string, idempotencyKey: string) {
    return this.prisma.$transaction(async tx => {
      if (!(await this.canRegister(tx, actorUserId))) throw new ForbiddenException("只有当前财务人员或综合部主管可以查询实际付款登记");
      const execution = await tx.paymentExecution.findUnique({ where: { idempotencyKey } });
      if (!execution) return { status: "unconfirmed", message: "尚未查到付款登记结果，请保留原请求并继续查询" };
      return { status: "recorded", execution: {
        executionId: execution.id, paymentId: execution.paymentRequestId,
        amountCents: execution.amountCents.toString(), paidAt: chinaDateOnly(execution.paidAt),
        voucherPending: execution.voucherFileId === null
      } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async workItems(actorUserId: string) {
    const result = await this.visibleWorkItems(actorUserId);
    if (!result) throw new ForbiddenException("只有当前财务人员或综合部主管可以办理实际付款");
    return result;
  }

  /** A mixed business homepage omits duties the current account cannot perform. */
  async visibleWorkItems(actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      if (!(await this.canRegister(tx, actorUserId))) return null;
      const requests = await tx.paymentRequest.findMany({
        where: { status: { in: ["approved_pending_payment", "partially_paid"] }, paymentSubjectType: "our_company" },
        orderBy: { id: "asc" }
      });
      const items = [];
      for (const request of requests) {
        const round = await tx.approvalInstance.findFirst({
          where: { businessType: "payment_request", businessId: request.id }, orderBy: { createdAt: "desc" }
        });
        if (!round || round.status !== "approved" || round.businessType !== "payment_request" || round.businessId !== request.id) continue;
        const remaining = (request.approvedAmountCents ?? request.requestedAmountCents) - request.paidAmountCents;
        if (remaining <= 0n) continue;
        items.push({ paymentId: request.id, code: request.code, projectId: request.projectId,
          paidAmountCents: request.paidAmountCents.toString(), remainingAmountCents: remaining.toString(),
          expectedPaymentUpdatedAt: request.updatedAt.toISOString() });
      }
      return { items, total: items.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
