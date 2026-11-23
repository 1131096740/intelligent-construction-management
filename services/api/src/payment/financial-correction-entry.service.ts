import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { PaymentReadService } from "./payment-read.service";

const FINANCE_ROLES = ["finance_staff", "finance_director", "comprehensive_director"] as const;

export interface EntryAction {
  key: string;
  label: string;
  path: string;
  method: "page" | "api";
  enabled: boolean;
  reason?: string;
}

/**
 * APR-13/APR-14 统一更正入口：同名入口按单据类型、状态和当前岗位给出
 * 唯一去处；它只做引导，不直接改写任何业务事实。
 */
@Injectable()
export class FinancialCorrectionEntryService {
  private readonly roles: CompanyRoleResolverService;
  constructor(private readonly prisma: PrismaService, @Optional() private readonly paymentRead?: PaymentReadService) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  async capability(type: string, id: string, actorUserId: string) {
    const normalized = (type ?? "").trim();
    const businessId = (id ?? "").trim();
    if (!normalized || !businessId) throw new BadRequestException("请选择单据类型并填写业务单号");
    const keys = await this.roles.resolveActiveRoleScopesInTransaction(this.prisma, actorUserId);
    const finance = keys.some(role => (FINANCE_ROLES as readonly string[]).includes(role));
    if (["payment_request", "payment", "payment_execution"].includes(normalized)) {
      return this.paymentEntry(normalized, businessId, finance, actorUserId);
    }
    if (normalized === "actual_purchase_batch") return this.actualPurchaseBatchEntry(businessId, finance);
    if (normalized === "settlement") return this.settlementEntry(businessId);
    if (normalized === "contract") return this.contractEntry(businessId);
    throw new BadRequestException("该单据类型没有统一更正入口，请从原业务页面办理");
  }

  private async paymentEntry(type: string, id: string, finance: boolean, actorUserId: string) {
    const execution = type === "payment_execution"
      ? await this.prisma.paymentExecution.findUnique({ where: { id }, select: { paymentRequestId: true } })
      : null;
    if (type === "payment_execution" && !execution) throw new NotFoundException("实付记录不存在，请核对付款记录");
    const payment = await this.prisma.paymentRequest.findFirst({
      where: execution ? { id: execution.paymentRequestId } : { OR: [{ id }, { code: id }] }
    });
    if (!payment) throw new NotFoundException("付款单据不存在，请核对付款单号");
    const executions = await this.prisma.paymentExecution.findMany({
      where: { paymentRequestId: payment.id },
      select: { id: true, amountCents: true, paidAt: true },
      orderBy: { paidAt: "asc" }
    });
    const path = `/付款管理/${encodeURIComponent(payment.id)}`;
    const actions: EntryAction[] = [];
    if (payment.status === "draft" && this.paymentRead) {
      const detail = await this.paymentRead.getDetail(payment.id, undefined, actorUserId);
      if (detail.availableActionKeys.includes("revise_and_submit")) {
        actions.push({ key: "edit_draft", label: "修改并重新提交付款申请", path, method: "page", enabled: true });
      }
    } else if (["approval_pending", "in_approval"].includes(payment.status)) {
      actions.push({ key: "withdraw_approval", label: "撤回审批后修改", path, method: "page", enabled: true });
    } else if (["approved_pending_payment", "partially_paid", "paid"].includes(payment.status)) {
      const financialPath = `/付款管理/${encodeURIComponent(payment.id)}`;
      if (type !== "payment_request" || finance) {
        actions.push({ key: "correct_payment_execution", label: "更正已确认实付", path: financialPath, method: "page", enabled: finance, ...(finance ? {} : { reason: "只有当前财务人员或综合部主管可以发起实付更正" }) });
      }
      const refundable = executions.reduce((sum, row) => sum + row.amountCents, 0n);
      if (refundable > 0n && finance) {
        actions.push({ key: "record_payment_refund", label: "登记实际收到的退款", path: financialPath, method: "page", enabled: true });
      }
    }
    return {
      type,
      id: type === "payment_execution" ? id : payment.id,
      paymentId: payment.id,
      code: payment.code,
      status: payment.status,
      title: `付款申请 ${payment.code}`,
      guidance: actions.length
        ? "统一更正入口只登记补偿事实，原单和原实付记录均保留。"
        : "当前状态没有可执行的更正动作，请从原单据查看处理进度。",
      actions
    };
  }


  private async actualPurchaseBatchEntry(id: string, finance: boolean) {
    const batch = await this.prisma.actualPurchaseBatch.findFirst({
      where: { OR: [{ id }, { idempotencyKey: id }] },
      select: {
        id: true, kind: true, supplierName: true, status: true,
        totalAmountCents: true, effectiveTotalAmountCents: true, costVersion: true
      }
    });
    if (!batch) throw new NotFoundException("实际采购批次不存在，请核对原采购单");
    const [spotPayments, claims] = await Promise.all([
      this.prisma.spotProcurementPayment.findMany({
        where: { actualPurchaseBatchId: batch.id },
        select: { id: true, approvalAmountCents: true, paidAmountCents: true, status: true }
      }),
      this.prisma.expenseClaim.findMany({
        where: { actualPurchaseBatchId: batch.id },
        select: { id: true, requestedAmountCents: true, fundedAmountCents: true, status: true }
      })
    ]);
    const activeStatuses = new Set(["approval_pending", "approved", "approved_pending_payment", "partially_paid", "paid", "settled", "offset_completed"]);
    const paidAmountCents = spotPayments.reduce((sum, row) => sum + row.paidAmountCents, 0n) + claims.reduce((sum, row) => sum + row.fundedAmountCents, 0n);
    const outstandingCents = [
      ...spotPayments.filter(row => activeStatuses.has(row.status)).map(row => row.approvalAmountCents > row.paidAmountCents ? row.approvalAmountCents - row.paidAmountCents : 0n),
      ...claims.filter(row => activeStatuses.has(row.status)).map(row => row.requestedAmountCents > row.fundedAmountCents ? row.requestedAmountCents - row.fundedAmountCents : 0n)
    ].reduce((sum, value) => sum + value, 0n);
    const path = `/实际采购批次/${encodeURIComponent(batch.id)}`;
    const confirmed = batch.costVersion > 0;
    const overpaidCents = paidAmountCents > batch.effectiveTotalAmountCents ? paidAmountCents - batch.effectiveTotalAmountCents : 0n;
    const suspended = confirmed && (overpaidCents > 0n || paidAmountCents + outstandingCents > batch.effectiveTotalAmountCents);
    const actions: EntryAction[] = [];
    if (confirmed) {
      actions.push({
        key: "correct_actual_purchase_batch",
        label: "更正实际采购金额",
        path,
        method: "page",
        enabled: finance,
        ...(finance ? {} : { reason: "只有当前财务人员或综合部主管可以发起实际采购金额更正" })
      });
      if (paidAmountCents > 0n && finance) {
        actions.push({ key: "record_actual_purchase_batch_refund", label: "登记实际收到的退款", path, method: "page", enabled: true });
      }
    }
    return {
      type: "actual_purchase_batch",
      id: batch.id,
      code: batch.id,
      status: batch.status,
      title: `实际采购批次 ${batch.supplierName}`,
      guidance: !confirmed
        ? "实际采购批次成本尚未确认；首批付款或垫付报销审批通过时会整批确认，之后才能从统一入口更正。"
        : suspended
          ? "实际确认金额不足以覆盖已付或剩余付款，相关待付已暂停；更正或退款后按最新金额自动重算，已付款保留。"
          : "批次成本只确认一次；更正只改批次有效金额与成本贡献，已付款和付款记录保留，金额仍够时照常付款。",
      actualPurchaseBatch: {
        costVersion: batch.costVersion,
        totalAmountCents: batch.totalAmountCents.toString(),
        effectiveTotalAmountCents: batch.effectiveTotalAmountCents.toString(),
        paidAmountCents: paidAmountCents.toString(),
        outstandingCommittedAmountCents: outstandingCents.toString(),
        overpaidAmountCents: overpaidCents.toString(),
        suspended
      },
      actions
    };
  }

  private async settlementEntry(id: string) {
    const signed = await this.prisma.signedContractSettlement.findFirst({
      where: { OR: [{ id }, { number: id }] },
      select: { id: true, number: true, contractId: true, state: true, amountYuan: true }
    });
    if (signed) {
      const confirmed = signed.state === "confirmed";
      return {
        type: "settlement",
        id: signed.id,
        code: signed.number,
        status: signed.state,
        title: `已签结算 ${signed.number ?? ""}`,
        guidance: confirmed
          ? "已确认结算不能直接更正；金额或合同错误请新增正负结算冲减并重新登记。"
          : "结算尚未确认，请回到原结算复核流程处理。",
        actions: confirmed
          ? [{ key: "new_signed_settlement", label: "新增正负结算", path: `/结算工作台/新建?contractId=${encodeURIComponent(signed.contractId)}`, method: "page" as const, enabled: true }]
          : []
      };
    }
    const settlement = await this.prisma.settlement.findFirst({
      where: { OR: [{ id }, { code: id }] },
      select: { id: true, code: true, contractId: true, status: true }
    });
    if (!settlement) throw new NotFoundException("结算单据不存在，请核对结算单号");
    const confirmed = ["effective", "partially_paid", "paid"].includes(settlement.status);
    return {
      type: "settlement",
      id: settlement.id,
      code: settlement.code,
      status: settlement.status,
      title: `结算 ${settlement.code}`,
      guidance: confirmed
        ? "已确认结算不可走更正绕过；请新增正负结算并重新复核。"
        : "结算尚未确认，请回到原结算处理。",
      actions: confirmed
        ? [{ key: "new_signed_settlement", label: "新增正负结算", path: `/结算工作台/新建?contractId=${encodeURIComponent(settlement.contractId)}`, method: "page" as const, enabled: true }]
        : []
    };
  }

  private async contractEntry(id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { OR: [{ id }, { code: id }] },
      select: { id: true, code: true, name: true, voidedAt: true }
    });
    if (!contract) throw new NotFoundException("合同不存在，请核对合同编号");
    const latestVersion = await this.prisma.contractVersion.findFirst({
      where: { contractId: contract.id },
      orderBy: { versionNo: "desc" },
      select: { status: true }
    });
    const contractStatus = contract.voidedAt ? "voided" : latestVersion?.status ?? "draft";
    const effective = contractStatus === "effective";
    return {
      type: "contract",
      id: contract.id,
      code: contract.code,
      status: contractStatus,
      title: `合同 ${[contract.code, contract.name].filter(Boolean).join(" · ")}`,
      guidance: effective
        ? "已签合同不能走付款更正直接改事实；请办理补充变更并重新签章归档。"
        : "合同尚未生效，请回到原合同编辑或审批流程。",
      actions: effective
        ? [{ key: "contract_supplement_change", label: "办理补充变更", path: `/合同管理/${encodeURIComponent(contract.id)}`, method: "page" as const, enabled: true }]
        : []
    };
  }

  async assertFinanceActor(actorUserId: string) {
    const keys = await this.roles.resolveActiveRoleScopesInTransaction(this.prisma, actorUserId);
    if (!keys.some(role => (FINANCE_ROLES as readonly string[]).includes(role))) {
      throw new ForbiddenException("只有当前财务人员或综合部主管可以办理财务更正");
    }
  }
}
