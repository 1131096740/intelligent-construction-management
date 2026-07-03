import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  canCreatePaymentFromSettlementStatus,
  type SettlementStatus,
  ContractBusinessOptionReadModel,
  ContractDetailReadModel,
  ContractSettlementPaymentReadModel,
  CoreFlowTone
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { centsToSafeNumber } from "../money/decimal-money";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "../payment/contract-takeover-balance";
import type { HistoricalContractPaymentBalance } from "../payment/settlement-payment-capacity";

@Injectable()
export class ContractReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async confirmedHistoricalBalanceForContract(contractId: string) {
    const takeoverClient = (this.prisma as unknown as {
      contractTakeover?: {
        findFirst(args: {
          where: {
            contractId: string;
            takeoverStatus: string;
            historicalBalanceConfirmedAt: { not: null };
          };
          select: typeof CONTRACT_TAKEOVER_BALANCE_SELECT;
        }): Promise<ContractTakeoverBalanceRow | null>;
      };
    }).contractTakeover;

    if (!takeoverClient) {
      return undefined;
    }

    const takeover = await takeoverClient.findFirst({
      where: {
        contractId,
        takeoverStatus: "confirmed",
        historicalBalanceConfirmedAt: { not: null }
      },
      select: CONTRACT_TAKEOVER_BALANCE_SELECT
    });

    return toHistoricalContractPaymentBalance(takeover);
  }

  async listRecent(rawLimit?: string | number) {
    const take = this.limit(rawLimit);
    const contracts = await this.prisma.contract.findMany({
      take,
      orderBy: { updatedAt: "desc" }
    });
    const contractIds = contracts.map((contract) => contract.id);
    const [versions, terms, projects] = await Promise.all([
      contractIds.length
        ? this.prisma.contractVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      contractIds.length
        ? this.prisma.paymentTermsVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      this.prisma.project.findMany({
        where: { id: { in: [...new Set(contracts.map((contract) => contract.projectId))] } }
      })
    ]);
    const versionByContractId = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!versionByContractId.has(version.contractId)) versionByContractId.set(version.contractId, version);
    }
    const termsByContractId = new Map<string, (typeof terms)[number]>();
    for (const term of terms) {
      if (!termsByContractId.has(term.contractId)) termsByContractId.set(term.contractId, term);
    }
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const rows = contracts.map((contract) => {
      const version = versionByContractId.get(contract.id);
      const termsVersion = termsByContractId.get(contract.id);
      const status = this.statusView(version?.status ?? "draft");
      return {
        id: contract.code ?? contract.id,
        contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
        name: contract.name,
        project: projectById.get(contract.projectId)?.name ?? contract.projectId,
        counterparty: contract.counterparty,
        amount: version ? this.formatMoney(version.amountCents) : "-",
        version: version ? `v${version.versionNo}` : "-",
        currentNode: this.nextActionLabel(version?.status ?? "draft"),
        nodeTone: status.tone,
        ownerDepartment: this.currentOwnerLabel(version?.status ?? "draft"),
        updatedAt: this.date(contract.updatedAt),
        paymentTermsVersion: termsVersion ? `v${termsVersion.versionNo}` : "-"
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        inApproval: rows.filter((row) => row.currentNode === "等待审批").length,
        pendingSeal: rows.filter((row) => row.currentNode === "发起用章").length,
        pendingArchive: rows.filter((row) => row.currentNode.includes("归档")).length,
        effective: rows.filter((row) => row.currentNode === "可发起结算").length
      }
    };
  }

  async listCreateOptions(projectId: string): Promise<ContractBusinessOptionReadModel[]> {
    if (!projectId?.trim()) {
      throw new BadRequestException("项目不能为空");
    }

    const contracts = await this.prisma.contract.findMany({
      where: { projectId, voidedAt: null },
      orderBy: [{ code: "asc" }, { temporaryCode: "asc" }, { updatedAt: "desc" }]
    });
    const contractIds = contracts.map((contract) => contract.id);
    if (!contractIds.length) {
      return [];
    }

    const [versions, takeovers, settlements] = await Promise.all([
      this.prisma.contractVersion.findMany({
        where: { contractId: { in: contractIds } },
        orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
      }),
      (this.prisma as unknown as {
        contractTakeover?: {
          findMany(args: {
            where: { projectId: string; contractId: { in: string[] } };
            select: {
              contractId: true;
              takeoverLevel: true;
              takeoverStatus: true;
              historicalBalanceConfirmedAt: true;
              balanceSourceSummary: true;
            };
            orderBy: { updatedAt: "desc" };
          }): Promise<
            Array<{
              contractId: string;
              takeoverLevel: string;
              takeoverStatus: string;
              historicalBalanceConfirmedAt: Date | null;
              balanceSourceSummary: string | null;
            }>
          >;
        };
      }).contractTakeover?.findMany({
        where: { projectId, contractId: { in: contractIds } },
        select: {
          contractId: true,
          takeoverLevel: true,
          takeoverStatus: true,
          historicalBalanceConfirmedAt: true,
          balanceSourceSummary: true
        },
        orderBy: { updatedAt: "desc" }
      }) ?? Promise.resolve([]),
      this.prisma.settlement.findMany({
        where: { projectId, contractId: { in: contractIds } },
        orderBy: [{ contractId: "asc" }, { createdAt: "desc" }]
      })
    ]);

    const latestVersionByContractId = new Map<string, (typeof versions)[number]>();
    const effectiveVersionByContractId = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!latestVersionByContractId.has(version.contractId)) {
        latestVersionByContractId.set(version.contractId, version);
      }
      if (version.status === "effective" && !effectiveVersionByContractId.has(version.contractId)) {
        effectiveVersionByContractId.set(version.contractId, version);
      }
    }

    const takeoverByContractId = new Map<string, (typeof takeovers)[number]>();
    for (const takeover of takeovers) {
      if (!takeoverByContractId.has(takeover.contractId)) {
        takeoverByContractId.set(takeover.contractId, takeover);
      }
    }

    const settlementsByContractId = new Map<string, typeof settlements>();
    for (const settlement of settlements) {
      const rows = settlementsByContractId.get(settlement.contractId) ?? [];
      settlementsByContractId.set(settlement.contractId, [...rows, settlement]);
    }

    return contracts.map((contract) => {
      const latestVersion = latestVersionByContractId.get(contract.id);
      const effectiveVersion = effectiveVersionByContractId.get(contract.id);
      const takeover = takeoverByContractId.get(contract.id);
      const source = contract.source === "historical_takeover" ? "historical_takeover" : "system";
      const paymentUnavailableReason = this.contractPaymentUnavailableReason(
        source,
        latestVersion?.status ?? "draft",
        effectiveVersion?.id ?? null,
        takeover
      );

      return {
        contractId: contract.id,
        contractVersionId: effectiveVersion?.id ?? null,
        contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
        contractName: contract.name,
        counterparty: contract.counterparty,
        amountCents: this.centsValue(effectiveVersion?.amountCents ?? latestVersion?.amountCents ?? 0),
        versionLabel: effectiveVersion ? `合同 v${effectiveVersion.versionNo}` : "-",
        contractStatus: effectiveVersion?.status ?? latestVersion?.status ?? "draft",
        contractStatusLabel: this.statusView(effectiveVersion?.status ?? latestVersion?.status ?? "draft").label,
        source,
        sourceLabel:
          source === "historical_takeover"
            ? `历史接管${takeover?.balanceSourceSummary ? ` · ${takeover.balanceSourceSummary}` : ""}`
            : "系统合同",
        takeoverLevel: takeover?.takeoverLevel ?? null,
        takeoverStatus: takeover?.takeoverStatus ?? null,
        takeoverStatusLabel: takeover ? this.takeoverStatusLabel(takeover.takeoverStatus) : null,
        historicalBalanceConfirmedAt: takeover?.historicalBalanceConfirmedAt?.toISOString() ?? null,
        canCreateSettlement: Boolean(effectiveVersion),
        settlementUnavailableReason: effectiveVersion ? null : "合同尚未生效，不能发起结算",
        canCreatePayment: !paymentUnavailableReason,
        paymentUnavailableReason,
        settlements: (settlementsByContractId.get(contract.id) ?? []).map((settlement) => {
          const canCreatePayment = canCreatePaymentFromSettlementStatus(settlement.status as SettlementStatus);
          return {
            settlementId: settlement.id,
            settlementNo: settlement.code,
            periodLabel: settlement.periodLabel,
            amountCents: settlement.amountCents,
            payableAmountCents: settlement.payableAmountCents,
            paidAmountCents: settlement.paidAmountCents,
            status: settlement.status,
            statusLabel: this.settlementApprovalStatusLabel(settlement.status),
            canCreatePayment,
            unavailableReason: canCreatePayment ? null : "结算未生效或已付款完成"
          };
        })
      };
    });
  }

  async getDetail(contractId: string): Promise<ContractDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(contractId);
    }

    const contract = await this.prisma.contract.findFirst({
      where: { OR: [{ id: contractId }, { code: contractId }] }
    });

    if (!contract) {
      throw new NotFoundException("Contract not found");
    }

    const [project, version] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: contract.projectId } }),
      this.prisma.contractVersion.findFirst({
        where: { contractId: contract.id },
        orderBy: { versionNo: "desc" }
      })
    ]);

    if (!version) {
      throw new NotFoundException("Contract version not found");
    }

    const terms = await this.prisma.paymentTermsVersion.findFirst({
      where: { contractVersionId: version.id },
      orderBy: { versionNo: "desc" }
    });

    if (!terms) {
      throw new NotFoundException("Payment terms version not found");
    }

    const [stages, settlements, paymentRequests] = await Promise.all([
      this.prisma.paymentTermsStage.findMany({
        where: { paymentTermsVersionId: terms.id },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.settlement.findMany({
        where: { contractId: contract.id },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.paymentRequest.findMany({
        where: { contractId: contract.id },
        orderBy: { updatedAt: "desc" }
      })
    ]);
    const paymentIds = paymentRequests.map((payment) => payment.id);
    const settlementIds = settlements.map((settlement) => settlement.id);
    const [paymentExecutions, settlementArchiveFiles, projectProxyPayments] = await Promise.all([
      paymentIds.length
        ? this.prisma.paymentExecution.findMany({
            where: { paymentRequestId: { in: paymentIds } }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlementArchiveFile.findMany({
            where: { settlementId: { in: settlementIds } },
            orderBy: { createdAt: "desc" }
          })
        : Promise.resolve([]),
      settlementIds.length ? this.findProjectProxyPayments(settlementIds) : Promise.resolve([])
    ]);
    const historicalBalance = await this.confirmedHistoricalBalanceForContract(contract.id);

    const status = this.statusView(version.status);

    const contractCode = contract.code ?? contract.temporaryCode ?? contract.id;
    const latestSettlement = settlements.at(-1);
    return {
      id: contractCode,
      contractVersionId: version.id,
      title: `${contractCode} · ${contract.name}`,
      meta: [
        { label: "当前状态", value: status.label, tone: status.tone },
        { label: "当前版本", value: `合同 v${version.versionNo}` },
        { label: "付款条款", value: `v${terms.versionNo} ${this.termsStatusLabel(terms.status)}` },
        { label: "责任部门", value: "合同部" },
        { label: "当前处理人", value: this.currentOwnerLabel(version.status) },
        { label: "下一步动作", value: this.nextActionLabel(version.status), tone: status.tone }
      ],
      baseInfo: [
        { label: "合同编号", value: contractCode },
        { label: "合同名称", value: contract.name },
        { label: "项目", value: project?.name ?? contract.projectId },
        { label: "相对方", value: contract.counterparty },
        { label: "合同金额", value: this.formatMoney(version.amountCents) },
        { label: "创建人", value: "合同部" }
      ],
      effectivenessSteps: this.effectivenessSteps(version.status),
      paymentTermStages: stages.map((stage) => ({
        id: stage.id,
        version: `v${terms.versionNo}`,
        paymentTermsVersion: `v${terms.versionNo}`,
        status: this.termsStatusLabel(terms.status),
        contractVersion: `合同 v${version.versionNo}`,
        basis: this.basisLabel(stage.basis),
        ratio: this.ratioLabel(stage.ratioBps),
        accountPeriod: `${stage.dueDays}天`,
        triggerEvent: stage.triggerEvent,
        advanceDeductionMode: stage.advanceDeductionMode,
        advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
        advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps
      })),
      settlementBlockMessage: this.settlementBlockMessage(version.status),
      settlementPayment: this.settlementPayment(
        version.amountCents,
        settlements,
        settlementArchiveFiles,
        paymentRequests,
        paymentExecutions,
        projectProxyPayments,
        historicalBalance
      ),
      chainLinks: [
        { label: "关联合同台账", to: "/contracts" },
        { label: "关联结算", to: latestSettlement ? `/settlements/${latestSettlement.code}` : "/settlements" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private sampleDetail(contractId: string): ContractDetailReadModel {
    return {
      id: contractId,
      contractVersionId: "contract-version-sample",
      title: "HT-2026-001 · 钢材采购合同",
      meta: [
        { label: "当前状态", value: "待用章", tone: "warning" },
        { label: "当前版本", value: "合同 v1" },
        { label: "付款条款", value: "v1 草拟中" },
        { label: "责任部门", value: "合同部" },
        { label: "当前处理人", value: "合同部成员" },
        { label: "下一步动作", value: "发起用章", tone: "warning" }
      ],
      baseInfo: [
        { label: "合同编号", value: contractId },
        { label: "合同名称", value: "钢材采购合同" },
        { label: "项目", value: "建设项目一期" },
        { label: "相对方", value: "钢材供应商" },
        { label: "合同金额", value: "¥1,280,000.00" },
        { label: "创建人", value: "合同部 李工" }
      ],
      effectivenessSteps: [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "待处理", tone: "warning" },
        { label: "归档上传", status: "未开始", tone: "default" },
        { label: "主管确认", status: "未开始", tone: "default" },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ],
      paymentTermStages: [
        {
          id: "current-settlement-payment",
          version: "v1",
          paymentTermsVersion: "v1",
          status: "随合同生效",
          contractVersion: "合同 v1",
          basis: "当期结算",
          ratio: "80%",
          accountPeriod: "30天",
          triggerEvent: "结算归档生效"
        },
        {
          id: "retention-payment",
          version: "v1",
          paymentTermsVersion: "v1",
          status: "随合同生效",
          contractVersion: "合同 v1",
          basis: "质保金",
          ratio: "20%",
          accountPeriod: "365天",
          triggerEvent: "质保期满"
        }
      ],
      settlementBlockMessage:
        "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。",
      settlementPayment: {
        summary: [
          { label: "累计生效结算", value: "¥0.00", tone: "default" },
          { label: "保守可申请余额", value: "¥0.00", tone: "warning" },
          { label: "审批中占用", value: "¥0.00", tone: "warning" },
          { label: "已批待付", value: "¥0.00", tone: "default" },
          { label: "已实付", value: "¥0.00", tone: "default" },
          { label: "最新合同剩余额度", value: "¥1,280,000.00", tone: "primary" }
        ],
        settlementRows: [],
        paymentRows: [],
        calculationNote:
          "当前可申请余额暂按已生效应付金额 - 已实付 - 审批中占用 - 已批待付计算，未纳入账期、质保金、预付款扣回和项目资金池；最新合同剩余额度以当前最新合同金额扣减合同维度累计生效结算，仅作台账提示。"
      },
      chainLinks: [
        { label: "关联合同台账", to: "/contracts" },
        { label: "关联结算", to: "/settlements/JS-2026-018" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private async findProjectProxyPayments(settlementIds: string[]) {
    const projectProxyPaymentClient = (this.prisma as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: { settlementId: { in: string[] }; voidedAt: null };
          select: { settlementId: true; amountCents: true };
        }) => Promise<Array<{ settlementId: string | null; amountCents: bigint | number }>>;
      };
    }).projectProxyPayment;

    if (!projectProxyPaymentClient) {
      return [];
    }

    return projectProxyPaymentClient.findMany({
      where: { settlementId: { in: settlementIds }, voidedAt: null },
      select: { settlementId: true, amountCents: true }
    });
  }

  private settlementPayment(
    contractAmountCents: number | bigint,
    settlements: Array<{
      id: string;
      code: string;
      periodLabel: string;
      status: string;
      amountCents: number;
      payableAmountCents: number;
      updatedAt: Date;
    }>,
    settlementArchiveFiles: Array<{
      settlementId: string;
      status: string;
      confirmedAt: Date | null;
    }>,
    paymentRequests: Array<{
      id: string;
      settlementId: string | null;
      sourceType?: string | null;
      code: string;
      status: string;
      requestedAmountCents: number;
      approvedAmountCents: number | null;
      paidAmountCents: number;
      updatedAt: Date;
    }>,
    paymentExecutions: Array<{
      paymentRequestId: string;
      amountCents: number;
      paidAt: Date;
      voucherFileId: string;
    }>,
    projectProxyPayments: Array<{
      settlementId: string | null;
      amountCents: bigint | number;
    }>,
    historicalBalance?: HistoricalContractPaymentBalance
  ): ContractSettlementPaymentReadModel {
    const historicalSettledCents = this.toBigIntCents(historicalBalance?.settledCents ?? 0);
    const historicalApprovalPendingCents = this.toBigIntCents(
      historicalBalance?.approvalPendingPaymentCents ?? 0
    );
    const historicalApprovedPendingCents = this.toBigIntCents(
      historicalBalance?.approvedPendingPaymentCents ?? 0
    );
    const historicalPaidCents = this.toBigIntCents(historicalBalance?.paidCents ?? 0);
    const historicalProxyPaidCents = this.toBigIntCents(historicalBalance?.proxyPaidCents ?? 0);
    const historicalAdvancePaidCents = this.toBigIntCents(
      historicalBalance?.advancePaidCents ?? 0
    );
    const historicalAdvanceDeductedCents = this.toBigIntCents(
      historicalBalance?.advanceDeductedCents ?? 0
    );
    const historicalOtherConfirmedOccupancyCents = this.toBigIntCents(
      historicalBalance?.otherConfirmedOccupancyCents ?? 0
    );
    const hasHistoricalBalance =
      historicalSettledCents +
        historicalApprovalPendingCents +
        historicalApprovedPendingCents +
        historicalPaidCents +
        historicalProxyPaidCents +
        historicalAdvancePaidCents +
        historicalAdvanceDeductedCents +
        historicalOtherConfirmedOccupancyCents >
      0n;
    const archiveFileBySettlementId = new Map<string, (typeof settlementArchiveFiles)[number]>();
    for (const archiveFile of settlementArchiveFiles) {
      if (!archiveFileBySettlementId.has(archiveFile.settlementId)) {
        archiveFileBySettlementId.set(archiveFile.settlementId, archiveFile);
      }
    }
    const paidByPaymentId = new Map<
      string,
      { amountCents: bigint; paidAt: Date | null; hasVoucher: boolean }
    >();
    for (const execution of paymentExecutions) {
      const current = paidByPaymentId.get(execution.paymentRequestId) ?? {
        amountCents: 0n,
        paidAt: null,
        hasVoucher: false
      };
      paidByPaymentId.set(execution.paymentRequestId, {
        amountCents: current.amountCents + BigInt(execution.amountCents),
        paidAt:
          !current.paidAt || execution.paidAt.getTime() > current.paidAt.getTime()
            ? execution.paidAt
            : current.paidAt,
        hasVoucher: current.hasVoucher || !!execution.voucherFileId
      });
    }

    let cumulativeEffectiveSettlementCents = 0n;
    let cumulativeEffectivePayableCents = 0n;
    const settlementRows = settlements.map((settlement) => {
      const archiveFile = archiveFileBySettlementId.get(settlement.id);
      const before = cumulativeEffectiveSettlementCents;
      if (this.isEffectiveSettlementStatus(settlement.status)) {
        cumulativeEffectiveSettlementCents += BigInt(settlement.amountCents);
        cumulativeEffectivePayableCents += BigInt(settlement.payableAmountCents);
      }

      return {
        id: settlement.code,
        settlementNo: settlement.code,
        period: settlement.periodLabel,
        settlementDate: this.date(settlement.updatedAt),
        settlementMethod: "待补充",
        currentAmount: this.formatMoney(settlement.amountCents),
        cumulativeBeforeAmount: this.formatMoney(before),
        cumulativeAfterAmount: this.formatMoney(cumulativeEffectiveSettlementCents),
        approvalStatus: this.settlementApprovalStatusLabel(settlement.status),
        archiveStatus: archiveFile
          ? this.settlementArchiveFileStatusLabel(archiveFile)
          : this.settlementArchiveStatusLabel(settlement.status)
      };
    });
    const settlementNoById = new Map(settlements.map((settlement) => [settlement.id, settlement.code]));
    const proxyPaidBySettlementId = new Map<string, bigint>();
    for (const proxyPayment of projectProxyPayments) {
      if (!proxyPayment.settlementId) {
        continue;
      }
      proxyPaidBySettlementId.set(
        proxyPayment.settlementId,
        (proxyPaidBySettlementId.get(proxyPayment.settlementId) ?? 0n) +
          this.toBigIntCents(proxyPayment.amountCents)
      );
    }

    let actualPaidCents = 0n;
    let proxyPaidCents = 0n;
    let approvalPendingCents = 0n;
    let approvedPendingCents = 0n;
    const paymentRows = paymentRequests.map((payment) => {
      const execution = paidByPaymentId.get(payment.id);
      const paidCents = execution?.amountCents ?? BigInt(payment.paidAmountCents);
      const approved = this.isApprovedPaymentStatus(payment.status);
      const approvedCents = approved
        ? BigInt(payment.approvedAmountCents ?? payment.requestedAmountCents)
        : 0n;
      const remainingApprovedCents = approvedCents - paidCents;
      actualPaidCents += paidCents;
      if (["approval_pending", "in_approval"].includes(payment.status)) {
        approvalPendingCents += BigInt(Math.max(payment.requestedAmountCents - payment.paidAmountCents, 0));
      }
      if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
        approvedPendingCents += remainingApprovedCents > 0n ? remainingApprovedCents : 0n;
      }

      return {
        id: payment.code,
        paymentNo: payment.code,
        settlementNo: payment.settlementId
          ? (settlementNoById.get(payment.settlementId) ?? payment.settlementId)
          : this.paymentSourceLabel(payment.sourceType),
        requestedAmount: this.formatMoney(payment.requestedAmountCents),
        approvedAmount: approved ? this.formatMoney(approvedCents) : "待审批",
        paidAmount: this.formatMoney(paidCents),
        paymentDate: execution?.paidAt ? this.date(execution.paidAt) : "-",
        approvalStatus: this.paymentApprovalStatusLabel(payment.status),
        paymentStatus: this.paymentExecutionStatusLabel(payment.status, paidCents, approvedCents),
        voucherStatus: execution?.hasVoucher ? "已上传" : paidCents > 0n ? "待上传" : "未上传"
      };
    });
    for (const proxyAmountCents of proxyPaidBySettlementId.values()) {
      proxyPaidCents += proxyAmountCents;
    }
    const totalEffectiveSettlementCents =
      cumulativeEffectiveSettlementCents + historicalSettledCents;
    const totalApprovalPendingCents = approvalPendingCents + historicalApprovalPendingCents;
    const totalApprovedPendingCents = approvedPendingCents + historicalApprovedPendingCents;
    const totalActualPaidCents = actualPaidCents + historicalPaidCents;
    const totalProxyPaidCents = proxyPaidCents + historicalProxyPaidCents;
    const cumulativePaidCents = totalActualPaidCents + totalProxyPaidCents;
    const conservativeAvailableCents =
      cumulativeEffectivePayableCents -
      cumulativePaidCents -
      totalApprovalPendingCents -
      totalApprovedPendingCents -
      historicalOtherConfirmedOccupancyCents;
    const remainingContractCents =
      BigInt(contractAmountCents) - totalEffectiveSettlementCents;
    const summary: ContractSettlementPaymentReadModel["summary"] = [
      { label: "累计生效结算", value: this.formatMoney(totalEffectiveSettlementCents), tone: "success" },
      ...(hasHistoricalBalance
        ? [
            {
              label: "系统内累计生效结算",
              value: this.formatMoney(cumulativeEffectiveSettlementCents),
              tone: "default" as const
            },
            {
              label: "历史累计生效结算",
              value: this.formatMoney(historicalSettledCents),
              tone: "success" as const
            }
          ]
        : []),
      {
        label: "保守可申请余额",
        value: this.formatMoney(conservativeAvailableCents > 0n ? conservativeAvailableCents : 0n),
        tone: "warning"
      },
      ...(hasHistoricalBalance
        ? [
            {
              label: "系统内审批中占用",
              value: this.formatMoney(approvalPendingCents),
              tone: "warning" as const
            },
            {
              label: "历史审批中占用",
              value: this.formatMoney(historicalApprovalPendingCents),
              tone: "warning" as const
            },
            {
              label: "系统内已批待付",
              value: this.formatMoney(approvedPendingCents),
              tone: "warning" as const
            },
            {
              label: "历史已批待付",
              value: this.formatMoney(historicalApprovedPendingCents),
              tone: "warning" as const
            },
            {
              label: "系统内已实付",
              value: this.formatMoney(actualPaidCents),
              tone: "success" as const
            },
            {
              label: "历史已实付",
              value: this.formatMoney(historicalPaidCents),
              tone: "success" as const
            }
          ]
        : [
            { label: "审批中占用", value: this.formatMoney(approvalPendingCents), tone: "warning" as const },
            { label: "已批待付", value: this.formatMoney(approvedPendingCents), tone: "warning" as const },
            { label: "已实付", value: this.formatMoney(actualPaidCents), tone: "success" as const }
          ])
    ];

    if (hasHistoricalBalance || proxyPaidCents > 0n) {
      if (hasHistoricalBalance) {
        summary.push(
          { label: "系统内总包代付", value: this.formatMoney(proxyPaidCents), tone: "success" },
          { label: "历史总包代付", value: this.formatMoney(historicalProxyPaidCents), tone: "success" }
        );
      } else {
        summary.push({ label: "总包代付", value: this.formatMoney(proxyPaidCents), tone: "success" });
      }
      summary.push({ label: "累计已支付", value: this.formatMoney(cumulativePaidCents), tone: "success" });
    }
    if (hasHistoricalBalance) {
      summary.push(
        { label: "历史其他确认占用", value: this.formatMoney(historicalOtherConfirmedOccupancyCents), tone: "warning" },
        { label: "历史预付款已付", value: this.formatMoney(historicalAdvancePaidCents), tone: "success" },
        { label: "历史预付款已扣回", value: this.formatMoney(historicalAdvanceDeductedCents), tone: "default" }
      );
    }

    summary.push({
      label: "最新合同剩余额度",
      value: this.formatMoney(remainingContractCents > 0n ? remainingContractCents : 0n),
      tone: "primary"
    });

    return {
      summary,
      settlementRows,
      paymentRows,
      calculationNote:
        "合同详情为金额摘要，系统内金额与历史接管余额分列；精确可申请额以付款申请预览的到账期、预付款扣回、总包代付和历史余额硬扣减口径为准。"
    };
  }

  private statusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      draft: { label: "草拟中", tone: "default" },
      in_approval: { label: "审批中", tone: "primary" },
      approval_pending: { label: "审批中", tone: "primary" },
      approval_rejected: { label: "审批退回", tone: "danger" },
      approved_pending_seal: { label: "待用章", tone: "warning" },
      approved: { label: "待用章", tone: "warning" },
      in_seal: { label: "用章中", tone: "warning" },
      seal_approved_pending_archive: { label: "待归档上传", tone: "primary" },
      pending_archive_confirm: { label: "待归档确认", tone: "primary" },
      sealed_pending_archive: { label: "待归档确认", tone: "primary" },
      effective: { label: "已生效", tone: "success" },
      voided: { label: "已作废", tone: "danger" }
    };

    return views[status] ?? { label: status, tone: "default" };
  }

  private takeoverStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      pending_review: "待复核",
      confirmed: "已接管",
      needs_supplement: "待补充",
      voided: "已作废"
    };

    return labels[status] ?? status;
  }

  private contractPaymentUnavailableReason(
    source: "system" | "historical_takeover",
    latestStatus: string,
    effectiveVersionId: string | null,
    takeover:
      | {
          takeoverStatus: string;
          historicalBalanceConfirmedAt: Date | null;
        }
      | undefined
  ): string | null {
    if (!effectiveVersionId) {
      return `合同状态为${this.statusView(latestStatus).label}，不能发起付款`;
    }
    if (source !== "historical_takeover") {
      return null;
    }
    if (!takeover) {
      return "历史合同尚未完成接管确认";
    }
    if (takeover.takeoverStatus !== "confirmed") {
      return `历史合同接管状态为${this.takeoverStatusLabel(takeover.takeoverStatus)}，确认后才能付款`;
    }
    if (!takeover.historicalBalanceConfirmedAt) {
      return "历史余额尚未确认，不能发起付款";
    }

    return null;
  }

  private termsStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草拟中",
      effective: "已生效",
      archived: "已归档"
    };

    return labels[status] ?? status;
  }

  private currentOwnerLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "合同部成员",
      in_approval: "审批节点处理人",
      approval_pending: "审批节点处理人",
      approval_rejected: "合同部成员",
      approved_pending_seal: "合同部成员",
      approved: "合同部成员",
      in_seal: "合同部成员",
      seal_approved_pending_archive: "合同部成员",
      pending_archive_confirm: "合同部主管",
      sealed_pending_archive: "合同部主管",
      effective: "系统归档",
      voided: "系统归档"
    };

    return labels[status] ?? "合同部";
  }

  private nextActionLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "提交合同审批",
      in_approval: "等待审批",
      approval_pending: "等待审批",
      approval_rejected: "退回修改",
      approved_pending_seal: "发起用章",
      approved: "发起用章",
      in_seal: "等待用章通过",
      seal_approved_pending_archive: "上传盖章合同",
      pending_archive_confirm: "主管确认归档",
      sealed_pending_archive: "主管确认归档",
      effective: "可发起结算",
      voided: "无"
    };

    return labels[status] ?? "待处理";
  }

  private effectivenessSteps(status: string): ContractDetailReadModel["effectivenessSteps"] {
    if (status === "effective") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "已完成", tone: "success" },
        { label: "归档上传", status: "已上传", tone: "success" },
        { label: "主管确认", status: "已确认", tone: "success" },
        { label: "合同生效", status: "已生效", tone: "success" }
      ];
    }

    if (status === "approved" || status === "approved_pending_seal" || status === "in_seal") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "待处理", tone: "warning" },
        { label: "归档上传", status: "未开始", tone: "default" },
        { label: "主管确认", status: "未开始", tone: "default" },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ];
    }

    if (status === "seal_approved_pending_archive" || status === "pending_archive_confirm") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "已完成", tone: "success" },
        {
          label: "归档上传",
          status: status === "pending_archive_confirm" ? "已上传" : "待上传",
          tone: status === "pending_archive_confirm" ? "success" : "primary"
        },
        {
          label: "主管确认",
          status: status === "pending_archive_confirm" ? "待确认" : "未开始",
          tone: status === "pending_archive_confirm" ? "primary" : "default"
        },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ];
    }

    return [
      {
        label: "合同审批",
        status: status === "approval_pending" || status === "in_approval" ? "处理中" : "未提交",
        tone: "primary"
      },
      { label: "用章", status: "未开始", tone: "default" },
      { label: "归档上传", status: "未开始", tone: "default" },
      { label: "主管确认", status: "未开始", tone: "default" },
      { label: "合同生效", status: "阻塞", tone: "danger" }
    ];
  }

  private settlementBlockMessage(status: string): string {
    if (status === "effective") {
      return "合同版本已生效，可基于当前合同版本创建结算；付款条款版本将随结算一并绑定。";
    }

    return "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。";
  }

  private settlementApprovalStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      in_approval: "审批中",
      approval_pending: "审批中",
      approval_rejected: "审批退回",
      withdrawn: "已撤回",
      approved_pending_archive: "审批通过",
      archive_pending: "审批通过",
      pending_archive_confirm: "审批通过",
      effective: "审批通过",
      partially_paid: "审批通过",
      paid: "审批通过",
      rejected: "审批退回",
      voided: "已作废"
    };

    return labels[status] ?? status;
  }

  private settlementArchiveStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "未归档",
      in_approval: "未归档",
      approval_pending: "未归档",
      approval_rejected: "未归档",
      withdrawn: "未归档",
      approved_pending_archive: "待上传盖章件",
      archive_pending: "待上传盖章件",
      pending_archive_confirm: "待确认归档",
      effective: "已归档确认",
      partially_paid: "已归档确认",
      paid: "已归档确认",
      rejected: "未归档",
      voided: "已作废"
    };

    return labels[status] ?? "未归档";
  }

  private isEffectiveSettlementStatus(status: string): boolean {
    return ["effective", "partially_paid", "paid"].includes(status);
  }

  private settlementArchiveFileStatusLabel(archiveFile: {
    status: string;
    confirmedAt: Date | null;
  }): string {
    if (archiveFile.confirmedAt || archiveFile.status === "confirmed") return "已归档确认";
    if (archiveFile.status === "pending_confirm") return "待确认归档";
    return archiveFile.status;
  }

  private paymentApprovalStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      in_approval: "审批中",
      approval_pending: "审批中",
      approval_rejected: "审批退回",
      approved_pending_payment: "审批通过",
      partially_paid: "审批通过",
      paid: "审批通过",
      completed: "审批通过",
      rejected: "审批退回",
      voided: "已作废"
    };

    return labels[status] ?? status;
  }

  private paymentExecutionStatusLabel(
    status: string,
    paidAmountCents: bigint,
    payableAmountCents: bigint
  ): string {
    if (paidAmountCents >= payableAmountCents && payableAmountCents > 0n) return "已付款";
    if (paidAmountCents > 0n) return "部分付款";
    if (status === "approved_pending_payment") return "已批待付";
    return "未付款";
  }

  private isApprovedPaymentStatus(status: string): boolean {
    return ["approved_pending_payment", "partially_paid", "paid", "completed"].includes(status);
  }

  private paymentSourceLabel(sourceType?: string | null): string {
    if (sourceType === "contract_advance") {
      return "合同预付款";
    }

    return "未关联结算";
  }

  private basisLabel(basis: string): string {
    const labels: Record<string, string> = {
      contract_amount: "合同金额",
      current_settlement: "当期结算",
      cumulative_settlement: "累计结算",
      fixed_amount: "固定金额",
      manual_amount: "人工确认金额"
    };

    return labels[basis] ?? basis;
  }

  private ratioLabel(ratioBps: number | null): string {
    if (ratioBps === null) {
      return "-";
    }

    return `${ratioBps / 100}%`;
  }

  private formatMoney(amountCents: number | bigint): string {
    return `¥${(centsToSafeNumber(typeof amountCents === "bigint" ? amountCents : BigInt(amountCents)) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  private toBigIntCents(amountCents: number | bigint): bigint {
    return typeof amountCents === "bigint" ? amountCents : BigInt(amountCents);
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private centsValue(amountCents: number | bigint): number | string {
    if (typeof amountCents === "bigint") {
      return amountCents <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(amountCents)
        : amountCents.toString();
    }

    return amountCents;
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false });
  }
}
