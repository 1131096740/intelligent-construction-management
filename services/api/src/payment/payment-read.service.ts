import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ContractPaymentApplicationPreviewReadModel,
  CoreFlowTone,
  PaymentDetailReadModel
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import {
  buildContractPaymentApplicationPreview,
  CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES,
  SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
  sumSafeCents
} from "./settlement-payment-capacity";

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
    const settlementIds = [
      ...new Set(
        payments
          .map((payment) => payment.settlementId)
          .filter((settlementId): settlementId is string => typeof settlementId === "string")
      )
    ];
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
        settlementNo: payment.settlementId
          ? (settlementById.get(payment.settlementId)?.code ?? payment.settlementId)
          : this.paymentSourceLabel(payment.sourceType),
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

    const isContractAdvance = payment.sourceType === "contract_advance";
    const isContractLevelPayment = isContractAdvance || payment.sourceType === "contract_due" || !payment.settlementId;
    const [settlement, contract, contractVersion, terms, executions, financeRecords] = await Promise.all([
      payment.settlementId
        ? this.prisma.settlement.findUnique({ where: { id: payment.settlementId } })
        : Promise.resolve(null),
      isContractLevelPayment
        ? this.prisma.contract.findUnique({ where: { id: payment.contractId } })
        : Promise.resolve(null),
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

    if (payment.settlementId && !settlement) {
      throw new NotFoundException("Payment settlement not found");
    }

    if (!contractVersion) {
      throw new NotFoundException("Payment contract version not found");
    }

    if (!terms) {
      throw new NotFoundException("Payment terms version not found");
    }

    const stage = await this.prisma.paymentTermsStage.findFirst({
      where: isContractAdvance
        ? {
            paymentTermsVersionId: terms.id,
            stageType: "advance",
            basis: "contract_amount",
            triggerAnchor: "contract_effective"
          }
        : {
            paymentTermsVersionId: terms.id,
            ...(payment.sourceType === "contract_due"
              ? { basis: "current_settlement" }
              : {})
          },
      orderBy: { createdAt: "asc" }
    });
    const executionAmountCents = executions.reduce(
      (total, execution) => total + execution.amountCents,
      0
    );
    const executionAllocations = await this.prisma.paymentExecutionAllocation.findMany({
      where: { paymentRequestId: payment.id },
      orderBy: [{ createdAt: "asc" }, { allocationOrder: "asc" }]
    });
    const allocationSettlementIds = [
      ...new Set(
        executionAllocations
          .map((allocation) => allocation.settlementId)
          .filter((settlementId): settlementId is string => typeof settlementId === "string")
      )
    ];
    const allocationSettlements = allocationSettlementIds.length
      ? await this.prisma.settlement.findMany({
          where: { id: { in: allocationSettlementIds } },
          select: { id: true, code: true, periodLabel: true }
        })
      : [];
    const settlementByAllocationId = new Map(
      allocationSettlements.map((allocationSettlement) => [
        allocationSettlement.id,
        allocationSettlement
      ])
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
      title: isContractAdvance
        ? `${payment.code} · 合同预付款申请`
        : payment.sourceType === "contract_due"
          ? `${payment.code} · 合同累计结算付款申请`
        : `${payment.code} · ${settlement?.periodLabel}付款申请`,
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
        ...(isContractLevelPayment
          ? [
              { label: "付款来源", value: this.paymentSourceLabel(payment.sourceType) },
              {
                label: "关联合同",
                value: `${contract?.code ?? payment.contractId} · ${contract?.name ?? payment.contractId}`
              }
            ]
          : [
              {
                label: "关联结算",
                value: `${settlement?.code ?? payment.settlementId} · ${settlement?.periodLabel ?? ""}结算单`
              },
              { label: "结算状态", value: this.settlementStatusLabel(settlement?.status ?? "") }
            ]),
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
      executionAllocations: executionAllocations.map((allocation) => {
        const allocationSettlement = allocation.settlementId
          ? settlementByAllocationId.get(allocation.settlementId)
          : undefined;

        return {
          id: allocation.id,
          executionCode: `${payment.code} · 第${allocation.allocationOrder + 1}笔`,
          settlementNo: allocationSettlement
            ? `${allocationSettlement.code} · ${allocationSettlement.periodLabel}`
            : (allocation.settlementId ?? "-"),
          stageName: allocation.stageName ?? allocation.stageType,
          allocationType: this.allocationTypeLabel(allocation.allocationType),
          amountCents: allocation.amountCents
        };
      }),
      traceRules: [
        isContractAdvance
          ? "预付款按合同生效日和账期计算，不依赖结算单"
          : payment.sourceType === "contract_due"
            ? "付款申请按合同下全部已生效结算累计计算，实付后自动生成分摊台账"
          : "付款申请只能来自已生效结算",
        "审批通过进入已批待付",
        "审批通过不等于实际付款完成",
        "实付登记必须上传付款凭证并写入审计日志"
      ],
      executionBlockMessage: this.executionBlockMessage(payment.status, execution.complete),
      chainLinks: [
        isContractLevelPayment
          ? { label: "关联合同", to: `/contracts/${contract?.code ?? payment.contractId}` }
          : { label: "关联结算", to: `/settlements/${settlement?.code ?? payment.settlementId}` },
        { label: "付款凭证", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  async getContractApplication(
    contractVersionId: string,
    rawAsOf?: string
  ): Promise<ContractPaymentApplicationPreviewReadModel> {
    if (!contractVersionId) {
      throw new BadRequestException("Contract version is required");
    }

    const asOf = rawAsOf ? new Date(rawAsOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      throw new BadRequestException("Invalid asOf date");
    }

    const contractVersion = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!contractVersion) {
      throw new NotFoundException("Contract version not found");
    }
    if (contractVersion.status !== "effective") {
      throw new BadRequestException("Cannot create payment from a non-effective contract version");
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractVersion.contractId }
    });
    if (!contract) {
      throw new NotFoundException("Contract not found");
    }

    const project = await this.prisma.project.findUnique({
      where: { id: contract.projectId }
    });

    const settlements = await this.prisma.settlement.findMany({
      where: {
        contractId: contract.id,
        status: { in: [...CONTRACT_DUE_PAYMENT_SETTLEMENT_STATUSES] }
      },
      orderBy: { createdAt: "asc" }
    });
    const settlementIds = settlements.map((settlement) => settlement.id);
    const settlementTermsVersionIds = settlements.map((settlement) => settlement.paymentTermsVersionId);
    const paymentTermsVersions = await this.prisma.paymentTermsVersion.findMany({
      where: {
        contractVersionId: contractVersion.id,
        status: "effective"
      },
      select: { id: true }
    });
    const paymentTermsVersionIds = [
      ...new Set([
        ...settlementTermsVersionIds,
        ...paymentTermsVersions.map((terms) => terms.id)
      ])
    ];

    const [
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests,
      projectProxyPayments,
      settlementContractVersions
    ] = await Promise.all([
      paymentTermsVersionIds.length
        ? this.prisma.paymentTermsStage.findMany({
            where: {
              paymentTermsVersionId: { in: paymentTermsVersionIds },
              OR: [{ basis: "current_settlement" }, { stageType: "advance" }]
            },
            select: {
              id: true,
              paymentTermsVersionId: true,
              name: true,
              stageType: true,
              basis: true,
              ratioBps: true,
              fixedAmountCents: true,
              triggerAnchor: true,
              triggerEvent: true,
              dueDays: true,
              advanceDeductionMode: true,
              advanceDeductionRatioBps: true,
              advanceDeductionStartRatioBps: true
            }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlementArchiveFile.findMany({
            where: {
              settlementId: { in: settlementIds },
              status: "confirmed",
              confirmedAt: { not: null }
            },
            select: { settlementId: true, confirmedAt: true }
          })
        : Promise.resolve([]),
      this.prisma.paymentRequest.findMany({
        where: {
          contractId: contract.id,
          status: {
            in: [
              ...SETTLEMENT_CAPACITY_PAYMENT_STATUSES,
              "paid"
            ]
          }
        },
        select: {
          settlementId: true,
          sourceType: true,
          paymentTermsVersionId: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      }),
      this.prisma.projectProxyPayment.findMany({
        where: {
          voidedAt: null,
          OR: [
            { contractId: contract.id },
            ...(settlementIds.length ? [{ settlementId: { in: settlementIds } }] : [])
          ]
        },
        select: { amountCents: true }
      }),
      settlements.length
        ? this.prisma.contractVersion.findMany({
            where: {
              id: {
                in: [
                  ...new Set(
                    settlements.map((settlement) => settlement.contractVersionId)
                  )
                ]
              }
            },
            select: { id: true, amountCents: true }
          })
        : Promise.resolve([])
    ]);
    const contractAmountCentsByVersionId = new Map(
      settlementContractVersions.map((version) => [
        version.id,
        sumSafeCents([version.amountCents])
      ])
    );
    const contractAmountCentsByPaymentTermsVersionId = settlements.reduce<Record<string, number>>(
      (amounts, settlement) => ({
        ...amounts,
        [settlement.paymentTermsVersionId]:
          contractAmountCentsByVersionId.get(settlement.contractVersionId) ??
          sumSafeCents([contractVersion.amountCents])
      }),
      {}
    );
    for (const terms of paymentTermsVersions) {
      contractAmountCentsByPaymentTermsVersionId[terms.id] =
        contractAmountCentsByPaymentTermsVersionId[terms.id] ??
        sumSafeCents([contractVersion.amountCents]);
    }

    const settlementPaymentRequests = paymentRequests.filter(
      (payment) =>
        payment.sourceType === "settlement" ||
        payment.sourceType === "contract_due" ||
        payment.settlementId
    );
    const advancePaymentRequests = paymentRequests.filter(
      (payment) =>
        payment.sourceType === "contract_advance" &&
        payment.paidAmountCents > 0 &&
        payment.paymentTermsVersionId
    );
    const proxyPaidCents = sumSafeCents(projectProxyPayments.map((payment) => payment.amountCents));
    const preview = buildContractPaymentApplicationPreview({
      asOf,
      contractEffectiveAt: contractVersion.effectiveAt,
      settlements,
      paymentTermsStages,
      settlementArchiveFiles,
      paymentRequests: settlementPaymentRequests,
      proxyPaidAmountCents: proxyPaidCents,
      contractAmountCents: sumSafeCents([contractVersion.amountCents]),
      contractAmountCentsByPaymentTermsVersionId,
      advancePaymentRequests
    });
    const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));
    const occupancy = this.paymentOccupancyBreakdown(settlementPaymentRequests);
    const actualPaidCents =
      sumSafeCents(settlements.map((settlement) => settlement.paidAmountCents)) +
      sumSafeCents(
        settlementPaymentRequests
          .filter((payment) => payment.settlementId === null)
          .map((payment) => payment.paidAmountCents)
      );

    return {
      contract: {
        contractId: contract.id,
        contractVersionId: contractVersion.id,
        contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
        contractName: contract.name,
        contractVersion: `合同 v${contractVersion.versionNo}`,
        projectId: contract.projectId,
        projectName: project?.name ?? contract.projectId
      },
      asOf: asOf.toISOString(),
      includedSettlements: settlements.map((settlement) => ({
        settlementId: settlement.id,
        settlementNo: settlement.code,
        period: settlement.periodLabel,
        amountCents: settlement.amountCents,
        status: settlement.status,
        isFinal: settlement.isFinal
      })),
      capacity: {
        ...preview.capacity,
        actualPaidCents,
        approvalPendingCents: occupancy.approvalPendingCents,
        approvedPendingCents: occupancy.approvedPendingCents,
        proxyPaidCents
      },
      advanceDeduction: preview.advanceDeduction,
      sections: preview.sections.map((section) => ({
        type: section.type,
        title: section.title,
        rows: section.rows.map((row) => {
          const settlement = row.settlementId ? settlementById.get(row.settlementId) : undefined;

          return {
            id: row.id,
            source: settlement ? `${settlement.code} · ${settlement.periodLabel}` : row.source,
            settlementId: row.settlementId,
            settlementNo: settlement?.code ?? null,
            currentSettlementAmountCents: row.currentSettlementAmountCents,
            cumulativeBeforeAmountCents: row.cumulativeBeforeAmountCents,
            cumulativeAfterAmountCents: row.cumulativeAfterAmountCents,
            effectiveAt: this.dateOnly(row.effectiveAt),
            expectedPayableAt: this.dateOnly(row.expectedPayableAt),
            paymentRule: row.paymentRule,
            isDue: row.isDue,
            includableAmountCents: row.includableAmountCents
          };
        })
      })),
      formula:
        "当前累计可付款金额 - 已实际付款金额 - 审批中占用 - 已批待付款金额 - 总包代付金额 - 本次应扣回预付款金额 = 本次最多可申请金额"
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
      executionAllocations: [],
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

  private paymentSourceLabel(sourceType?: string | null) {
    if (sourceType === "contract_advance") {
      return "合同预付款";
    }

    if (sourceType === "contract_due") {
      return "合同累计结算付款";
    }

    return "未关联结算";
  }

  private allocationTypeLabel(allocationType: string) {
    if (allocationType === "contract_due_payment") {
      return "合同累计结算付款分摊";
    }

    if (allocationType === "advance_deduction") {
      return "预付款扣回";
    }

    return allocationType;
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

  private dateOnly(value: Date | null) {
    return value ? value.toISOString().slice(0, 10) : null;
  }

  private paymentOccupancyBreakdown(
    paymentRequests: Array<{
      status: string;
      requestedAmountCents: number;
      approvedAmountCents: number | null;
      paidAmountCents: number;
    }>
  ) {
    return paymentRequests.reduce(
      (totals, payment) => {
        const paidAmountCents = Math.max(payment.paidAmountCents, 0);
        if (["approval_pending", "in_approval"].includes(payment.status)) {
          return {
            ...totals,
            approvalPendingCents:
              totals.approvalPendingCents +
              Math.max(payment.requestedAmountCents - paidAmountCents, 0)
          };
        }

        if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
          return {
            ...totals,
            approvedPendingCents:
              totals.approvedPendingCents +
              Math.max(
                (payment.approvedAmountCents ?? payment.requestedAmountCents) - paidAmountCents,
                0
              )
          };
        }

        return totals;
      },
      {
        approvalPendingCents: 0,
        approvedPendingCents: 0
      }
    );
  }
}
