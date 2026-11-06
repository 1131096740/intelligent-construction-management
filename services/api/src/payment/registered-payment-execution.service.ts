import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";

/** Records payments already made outside the system; it never initiates a bank transfer. */
@Injectable()
export class RegisteredPaymentExecutionService {
  private readonly roles: CompanyRoleResolverService;
  constructor(private readonly prisma: PrismaService) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  async workItems(actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      let roles;
      try { roles = await this.roles.resolveActiveRoleScopesInTransaction(tx, actorUserId); }
      catch { throw new ForbiddenException("当前付款登记账号或公司岗位不可用"); }
      if (!roles.some(role => ["finance_staff", "finance_director", "comprehensive_director"].includes(role))) {
        throw new ForbiddenException("只有当前财务人员或综合部主管可以办理实际付款");
      }
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
