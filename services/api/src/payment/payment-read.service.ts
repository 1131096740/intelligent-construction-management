import { Injectable, NotFoundException } from "@nestjs/common";
import type { CoreFlowTone, PaymentDetailReadModel } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class PaymentReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecent(rawLimit?: string | number) {
    const take = this.limit(rawLimit);
    const payments = await this.prisma.paymentRequest.findMany({
      take,
      orderBy: { updatedAt: "desc" }
    });
    const paymentIds = payments.map((payment) => payment.id);
    const settlementIds = [...new Set(payments.map((payment) => payment.settlementId))];
    const projectIds = [...new Set(payments.map((payment) => payment.projectId))];
    const [settlements, projects, executions] = await Promise.all([
      settlementIds.length
        ? this.prisma.settlement.findMany({ where: { id: { in: settlementIds } } })
        : Promise.resolve([]),
      projectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: projectIds } } })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.paymentExecution.findMany({ where: { paymentRequestId: { in: paymentIds } } })
        : Promise.resolve([])
    ]);
    const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const paidByPaymentId = new Map<string, number>();
    for (const execution of executions) {
      paidByPaymentId.set(
        execution.paymentRequestId,
        (paidByPaymentId.get(execution.paymentRequestId) ?? 0) + execution.amountCents
      );
    }

    const rows = payments.map((payment) => {
      const paidAmountCents = paidByPaymentId.get(payment.id) ?? payment.paidAmountCents;
      const payableAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const approval = this.approvalStatusView(payment.status);
      const execution = this.executionStatusView(payment.status, paidAmountCents, payableAmountCents);

      return {
        id: payment.code,
        paymentNo: payment.code,
        settlementNo: settlementById.get(payment.settlementId)?.code ?? payment.settlementId,
        project: projectById.get(payment.projectId)?.name ?? payment.projectId,
        requestedAmount: this.formatMoney(payment.requestedAmountCents),
        approvalStatus: approval.label,
        approvalTone: approval.tone,
        paymentStatus: execution.label,
        paymentTone: execution.tone,
        currentNode: this.nextActionLabel(payment.status, execution.complete),
        ownerDepartment: this.currentOwnerLabel(payment.status, execution.complete),
        updatedAt: this.date(payment.updatedAt)
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        pendingApproval: payments.filter((payment) => ["draft", "approval_pending"].includes(payment.status)).length,
        orSign: payments.filter((payment) => payment.status === "approval_pending").length,
        pendingPayment: payments.filter((payment) => payment.status === "approved_pending_payment").length,
        paid: rows.filter((row) => row.paymentStatus === "已付款").length
      }
    };
  }

  async getDetail(paymentId: string): Promise<PaymentDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(paymentId);
    }

    const payment = await this.prisma.paymentRequest.findFirst({
      where: { OR: [{ id: paymentId }, { code: paymentId }] }
    });

    if (!payment) {
      throw new NotFoundException("Payment request not found");
    }

    const [settlement, contractVersion, terms, executions, financeRecords] = await Promise.all([
      this.prisma.settlement.findUnique({ where: { id: payment.settlementId } }),
      this.prisma.contractVersion.findUnique({ where: { id: payment.contractVersionId } }),
      this.prisma.paymentTermsVersion.findUnique({
        where: { id: payment.paymentTermsVersionId }
      }),
      this.prisma.paymentExecution.findMany({
        where: { paymentRequestId: payment.id },
        orderBy: { paidAt: "desc" }
      }),
      this.prisma.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      })
    ]);

    if (!settlement) {
      throw new NotFoundException("Payment settlement not found");
    }

    if (!contractVersion) {
      throw new NotFoundException("Payment contract version not found");
    }

    if (!terms) {
      throw new NotFoundException("Payment terms version not found");
    }

    const stage = await this.prisma.paymentTermsStage.findFirst({
      where: { paymentTermsVersionId: terms.id },
      orderBy: { createdAt: "asc" }
    });
    const executionAmountCents = executions.reduce(
      (total, execution) => total + execution.amountCents,
      0
    );
    const financeRecordedAmountCents = financeRecords.reduce(
      (total, record) => total + record.amountCents,
      0
    );
    const paidAmountCents = executions.length > 0 ? executionAmountCents : payment.paidAmountCents;
    const payableAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
    const approval = this.approvalStatusView(payment.status);
    const execution = this.executionStatusView(payment.status, paidAmountCents, payableAmountCents);

    return {
      id: payment.code,
      title: `${payment.code} · ${settlement.periodLabel}付款申请`,
      meta: [
        { label: "审批状态", value: approval.label, tone: approval.tone },
        { label: "实付状态", value: execution.label, tone: execution.tone },
        { label: "付款条款版本", value: `v${terms.versionNo} 随合同生效` },
        { label: "关联合同版本", value: `合同 v${contractVersion.versionNo}` },
        { label: "责任部门", value: "财务部" },
        { label: "下一步动作", value: this.nextActionLabel(payment.status, execution.complete), tone: execution.tone }
      ],
      baseInfo: [
        { label: "付款编号", value: payment.code },
        { label: "关联结算", value: `${settlement.code} · ${settlement.periodLabel}结算单` },
        { label: "结算状态", value: this.settlementStatusLabel(settlement.status) },
        { label: "付款阶段", value: stage?.name ?? "按付款条款执行" },
        { label: "付款比例", value: this.ratioLabel(stage?.ratioBps ?? null) },
        { label: "付款账期", value: stage ? `${stage.dueDays}天` : "-" },
        { label: "申请金额", value: this.formatMoney(payment.requestedAmountCents) },
        { label: "已付金额", value: this.formatMoney(paidAmountCents) }
      ],
      approvalSteps: this.approvalSteps(payment.status),
      executionSteps: this.executionSteps(
        payment.status,
        paidAmountCents,
        payableAmountCents,
        financeRecordedAmountCents
      ),
      traceRules: [
        "付款申请只能来自已生效结算",
        "审批通过进入已批待付",
        "审批通过不等于实际付款完成",
        "实付登记必须上传付款凭证并写入审计日志"
      ],
      executionBlockMessage: this.executionBlockMessage(payment.status, execution.complete),
      chainLinks: [
        { label: "关联结算", to: `/settlements/${settlement.code}` },
        { label: "付款凭证", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private sampleDetail(paymentId: string): PaymentDetailReadModel {
    return {
      id: paymentId,
      title: "FK-2026-006 · 5月材料结算付款申请",
      meta: [
        { label: "审批状态", value: "已通过", tone: "success" },
        { label: "实付状态", value: "已批待付", tone: "warning" },
        { label: "付款条款版本", value: "v1 随合同生效" },
        { label: "关联合同版本", value: "合同 v1" },
        { label: "责任部门", value: "财务部" },
        { label: "下一步动作", value: "出纳付款登记", tone: "primary" }
      ],
      baseInfo: [
        { label: "付款编号", value: paymentId },
        { label: "关联结算", value: "JS-2026-018 · 5月材料结算单" },
        { label: "结算状态", value: "已生效" },
        { label: "付款阶段", value: "当期结算款" },
        { label: "付款比例", value: "80%" },
        { label: "付款账期", value: "30天" },
        { label: "申请金额", value: "¥256,000.00" },
        { label: "申请人", value: "项目经理 张工" }
      ],
      approvalSteps: [
        { label: "付款申请", status: "已提交", owner: "项目经理", tone: "success" },
        { label: "项目经理审批", status: "已通过", owner: "项目经理", tone: "success" },
        { label: "合同结算部/预算部审批", status: "已通过", owner: "合同结算部/预算部", tone: "success" },
        { label: "财务复核", status: "已通过", owner: "财务主管", tone: "success" },
        { label: "董事长/总经理或签", status: "已通过", owner: "董事长或总经理", tone: "success" },
        { label: "审批通过", status: "已批待付", owner: "系统", tone: "warning" }
      ],
      executionSteps: [
        { label: "已批待付", status: "当前状态", owner: "财务部", tone: "warning" },
        { label: "出纳付款登记", status: "待处理", owner: "出纳/财务", tone: "primary" },
        { label: "付款凭证上传", status: "待处理", owner: "出纳/财务", tone: "default" },
        { label: "财务入账", status: "待处理", owner: "财务部", tone: "default" },
        { label: "付款完成", status: "未完成", owner: "系统", tone: "danger" }
      ],
      traceRules: [
        "付款申请只能来自已生效结算",
        "审批通过进入已批待付",
        "审批通过不等于实际付款完成",
        "实付登记必须上传付款凭证并写入审计日志"
      ],
      executionBlockMessage:
        "付款审批已通过，但尚未登记实际付款；必须由出纳/财务登记实付金额并上传付款凭证后，才能进入财务入账与付款完成。",
      chainLinks: [
        { label: "关联结算", to: "/settlements/JS-2026-018" },
        { label: "付款凭证", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private approvalStatusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      draft: { label: "草拟中", tone: "default" },
      approval_pending: { label: "审批中", tone: "primary" },
      approved_pending_payment: { label: "已通过", tone: "success" },
      partially_paid: { label: "已通过", tone: "success" },
      paid: { label: "已通过", tone: "success" },
      completed: { label: "已通过", tone: "success" },
      rejected: { label: "已退回", tone: "danger" }
    };

    return views[status] ?? { label: status, tone: "default" };
  }

  private executionStatusView(
    status: string,
    paidAmountCents: number,
    payableAmountCents: number
  ): { label: string; tone: CoreFlowTone; complete: boolean } {
    if (paidAmountCents >= payableAmountCents && payableAmountCents > 0) {
      return { label: "已付款", tone: "success", complete: true };
    }

    if (paidAmountCents > 0) {
      return { label: "部分付款", tone: "warning", complete: false };
    }

    if (status === "approved_pending_payment") {
      return { label: "已批待付", tone: "warning", complete: false };
    }

    return { label: "未付款", tone: "default", complete: false };
  }

  private nextActionLabel(status: string, complete: boolean): string {
    if (complete) {
      return "财务入账归档";
    }

    if (status === "approved_pending_payment") {
      return "出纳付款登记";
    }

    if (status === "partially_paid") {
      return "继续出纳付款登记";
    }

    return "等待付款审批";
  }

  private currentOwnerLabel(status: string, complete: boolean): string {
    if (complete) {
      return "财务部";
    }

    const labels: Record<string, string> = {
      draft: "项目经理",
      approval_pending: "审批节点处理人",
      approved_pending_payment: "出纳/财务",
      partially_paid: "出纳/财务",
      paid: "财务部",
      completed: "财务部",
      rejected: "项目经理"
    };

    return labels[status] ?? "财务部";
  }

  private settlementStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      approval_pending: "审批中",
      archive_pending: "待归档确认",
      effective: "已生效",
      partially_paid: "部分付款",
      paid: "已付款",
      voided: "已作废"
    };

    return labels[status] ?? status;
  }

  private approvalSteps(status: string): PaymentDetailReadModel["approvalSteps"] {
    const approvalComplete = ["approved_pending_payment", "partially_paid", "paid", "completed"].includes(status);

    return [
      { label: "付款申请", status: "已提交", owner: "项目经理", tone: "success" },
      { label: "项目经理审批", status: approvalComplete ? "已通过" : "待处理", owner: "项目经理", tone: approvalComplete ? "success" : "primary" },
      { label: "合同结算部/预算部审批", status: approvalComplete ? "已通过" : "待处理", owner: "合同结算部/预算部", tone: approvalComplete ? "success" : "default" },
      { label: "财务复核", status: approvalComplete ? "已通过" : "待处理", owner: "财务主管", tone: approvalComplete ? "success" : "default" },
      { label: "董事长/总经理或签", status: approvalComplete ? "已通过" : "待处理", owner: "董事长或总经理", tone: approvalComplete ? "success" : "default" },
      {
        label: "审批通过",
        status: approvalComplete ? "已批待付" : "未完成",
        owner: "系统",
        tone: approvalComplete ? "warning" : "default"
      }
    ];
  }

  private executionSteps(
    status: string,
    paidAmountCents: number,
    payableAmountCents: number,
    financeRecordedAmountCents = 0
  ): PaymentDetailReadModel["executionSteps"] {
    const hasPayment = paidAmountCents > 0;
    const complete = paidAmountCents >= payableAmountCents && payableAmountCents > 0;
    const approved = status === "approved_pending_payment" || hasPayment || complete;
    const financeRecorded = hasPayment && financeRecordedAmountCents >= paidAmountCents;

    return [
      { label: "已批待付", status: approved ? "当前状态" : "未到达", owner: "财务部", tone: approved ? "warning" : "default" },
      { label: "出纳付款登记", status: hasPayment ? "已登记" : "待处理", owner: "出纳/财务", tone: hasPayment ? "success" : "primary" },
      { label: "付款凭证上传", status: hasPayment ? "已上传" : "待处理", owner: "出纳/财务", tone: hasPayment ? "success" : "default" },
      {
        label: "财务入账",
        status: financeRecorded ? "已入账" : complete ? "待处理" : "未开始",
        owner: "财务部",
        tone: financeRecorded ? "success" : complete ? "primary" : "default"
      },
      { label: "付款完成", status: complete ? "已完成" : "未完成", owner: "系统", tone: complete ? "success" : "danger" }
    ];
  }

  private executionBlockMessage(status: string, complete: boolean): string {
    if (complete) {
      return "实际付款已登记并上传付款凭证，后续由财务完成入账与归档。";
    }

    if (status === "partially_paid") {
      return "已登记部分实际付款；可在剩余审批金额内继续登记实付并上传付款凭证。";
    }

    if (status !== "approved_pending_payment") {
      return "付款申请仍在审批中；审批通过后才会进入已批待付，并开放出纳付款登记。";
    }

    return "付款审批已通过，但尚未登记实际付款；必须由出纳/财务登记实付金额并上传付款凭证后，才能进入财务入账与付款完成。";
  }

  private ratioLabel(ratioBps: number | null): string {
    if (ratioBps === null) {
      return "-";
    }

    return `${ratioBps / 100}%`;
  }

  private formatMoney(amountCents: number): string {
    return `¥${(amountCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false });
  }
}
