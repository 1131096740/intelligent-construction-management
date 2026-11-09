import { requireLegacyOperatingCents } from "../operating-ledger/operating-money-protocol";
import { currentRegisteredPaymentApproval } from "./registered-payment-approval";
import { resolveRegisteredExistingSource } from "./registered-payment-existing-source";
import { currentRegisteredPaymentDomain } from "./registered-payment-domain";
import { paymentExecutionVoucherFileId } from "./payment-execution-voucher";
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

  async existingSource(actorUserId: string, paymentId: string, type: string, id: string) {
    return this.prisma.$transaction(async tx => {
      if (!(await this.canRegister(tx, actorUserId))) throw new ForbiddenException("只有当前财务人员或综合部主管可以核验实际付款来源");
      return resolveRegisteredExistingSource(tx,paymentId,type,id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordedItems(actorUserId: string, paymentId?: string) {
    return this.prisma.$transaction(async tx=>{
      if (!(await this.canRegister(tx,actorUserId))) throw new ForbiddenException("只有当前财务人员或综合部主管可以查看已登记实付");
      const funding = await tx.registeredPaymentFunding.findMany();
      const executions = funding.length ? await tx.paymentExecution.findMany({where:{id:{in:funding.map(row=>row.executionId)},...(paymentId ? {paymentRequestId:paymentId} : {})},orderBy:{createdAt:"desc"}}) : [];
      const items = [];
      for (const execution of executions) {
        const request = await tx.paymentRequest.findUnique({where:{id:execution.paymentRequestId}});
        if (!request) continue;
        if (!(await currentRegisteredPaymentDomain(tx,request.id)).supportedDomain) continue;
        const actor = await tx.user.findUnique({where:{id:execution.executedByUserId},select:{name:true}});
        const receipt = funding.find(row=>row.executionId === execution.id);
        const snapshot = receipt?.actualPayerSnapshot;
        const actualPayerName = receipt?.actualPayerKind === "public_cash" ? "\u516c\u5171\u73b0\u91d1" : snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.name === "string" && snapshot.name.trim() ? snapshot.name : "\u4ed8\u6b3e\u8d44\u91d1\u8d44\u6599\u5f85\u6838\u5bf9";
        const voucherPending = (await paymentExecutionVoucherFileId(tx,execution)) === null;
        items.push({executionId:execution.id,paymentId:request.id,code:request.code,projectId:request.projectId,
          amountCents:execution.amountCents.toString(),paidAt:chinaDateOnly(execution.paidAt),registeredByName:actor?.name??"原登记人",actualPayerName,
          voucherPending,canSupplementVoucher:Boolean(receipt && execution.voucherFileId === null && voucherPending),resultKey:execution.idempotencyKey});
      }
      return {items,total:items.length};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  async result(actorUserId: string, idempotencyKey: string) {
    return this.prisma.$transaction(async tx => {
      if (!(await this.canRegister(tx, actorUserId))) throw new ForbiddenException("只有当前财务人员或综合部主管可以查询实际付款登记");
      const unconfirmed = { status: "unconfirmed", message: "尚未查到付款登记结果，请保留原请求并继续查询" } as const;
      const execution = await tx.paymentExecution.findUnique({ where: { idempotencyKey } });
      if (!execution) return unconfirmed;
      if (!(await currentRegisteredPaymentDomain(tx,execution.paymentRequestId)).supportedDomain) throw new ForbiddenException("该付款记录不属于此办理入口，请经原业务权限入口核验");
      const funding = await tx.registeredPaymentFunding.findUnique({where:{executionId:execution.id}});
      // New registrations have no original voucher and must carry the committed funding receipt.
      if (execution.voucherFileId === null && !funding) return unconfirmed;
      const facts = await tx.operatingFact.findMany({
        where: { sourceType: "payment_execution", sourceBusinessId: execution.id },
        select: { id: true, sourceVersion: true, basisSnapshot: true, actualPayerSubjectKind: true, actualPayerSubjectId: true }
      });
      const impacts = facts.length ? await tx.operatingImpactEntry.findMany({
        where: { factId: { in: facts.map(fact => fact.id) } },
        select: { factId: true, impactKind: true, amountCents: true, numericProtocolVersion: true, subjectKind: true, subjectId: true }
      }) : [];
      const relationshipEntries = await tx.interEntityRelationshipEntry.findMany({where:{paymentExecutionId:execution.id,sourceType:"registered_payment_execution"}});
      const voucherFileId = await paymentExecutionVoucherFileId(tx,execution);
      const canSupplementVoucher = Boolean(funding && execution.voucherFileId === null && voucherFileId === null);
      const intercompany = relationshipEntries.map(entry=>({entryId:entry.id,debtorCompanyId:entry.originalDebtorCompanyId,creditorCompanyId:entry.creditorCompanyId,amountCents:entry.amountCents.toString(),status:entry.status,voucherPending:voucherFileId===null}));
      const effects = facts.map(fact=>({ factId: fact.id, sourceVersion: fact.sourceVersion, recordedVoucherPending: fact.basisSnapshot && typeof fact.basisSnapshot === "object" && !Array.isArray(fact.basisSnapshot) ? fact.basisSnapshot.voucherPending === true : false, actualPayerKind: fact.actualPayerSubjectKind, actualPayerId: fact.actualPayerSubjectId,
        impacts: impacts.filter(impact=>impact.factId===fact.id).map(impact=>({ kind: impact.impactKind, amountCents: requireLegacyOperatingCents(impact).toString(), subjectKind: impact.subjectKind, subjectId: impact.subjectId })) }));
      return { status: "recorded", canSupplementVoucher, execution: {
        executionId: execution.id, paymentId: execution.paymentRequestId,
        amountCents: execution.amountCents.toString(), paidAt: chinaDateOnly(execution.paidAt),
        voucherPending: voucherFileId === null
      }, effects, intercompany };
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
        if (!(await currentRegisteredPaymentDomain(tx,request.id)).supportedDomain) continue;
        const round = await currentRegisteredPaymentApproval(tx,request.id);
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
