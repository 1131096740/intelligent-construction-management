import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  CoreFlowTone,
  DetailActionReadModel,
  RoleKey,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import {
  canActOnFrozenApprovalNode,
  pendingRoleKeysForFrozenApprovalNode
} from "../approval/approval-node-access";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  detailAction,
  disabledActionReasons,
  primaryActionKey
} from "../core-flow/detail-actions";
import { approvalTimelineForBusiness } from "../core-flow/approval-timeline-read";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class SettlementReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly projectVisibility?: ProjectVisibilityService
  ) {}

  private async settlementArchiveFilesForSettlement(
    settlementId: string
  ): Promise<SettlementDetailReadModel["archiveFiles"]> {
    const client = this.prisma as unknown as {
      settlementArchiveFile?: {
        findMany(args: {
          where: { settlementId: string };
          orderBy: { createdAt: "desc" };
        }): Promise<
          Array<{
            id: string;
            fileId: string;
            uploadedByUserId: string;
            confirmedByUserId: string | null;
            confirmedAt: Date | null;
            status: string;
            createdAt: Date;
          }>
        >;
      };
      fileObject?: {
        findMany(args: { where: { id: { in: string[] } } }): Promise<
          Array<{
            id: string;
            originalName: string;
            mimeType: string;
            sizeBytes: number;
          }>
        >;
      };
      user?: {
        findMany(args: { where: { id: { in: string[] } } }): Promise<
          Array<{ id: string; name: string }>
        >;
      };
    };

    if (!client.settlementArchiveFile || !client.fileObject) {
      return [];
    }

    const archiveFiles = await client.settlementArchiveFile.findMany({
      where: { settlementId },
      orderBy: { createdAt: "desc" }
    });
    const fileIds = Array.from(new Set(archiveFiles.map((file) => file.fileId)));
    if (!fileIds.length) {
      return [];
    }

    const userIds = Array.from(
      new Set(
        archiveFiles
          .flatMap((file) => [file.uploadedByUserId, file.confirmedByUserId])
          .filter((id): id is string => Boolean(id))
      )
    );
    const [files, users] = await Promise.all([
      client.fileObject.findMany({ where: { id: { in: fileIds } } }),
      client.user && userIds.length
        ? client.user.findMany({ where: { id: { in: userIds } } })
        : Promise.resolve([])
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return archiveFiles.flatMap((archiveFile) => {
      const file = fileById.get(archiveFile.fileId);
      if (!file) {
        return [];
      }
      const canDownload = archiveFile.status === "confirmed" || Boolean(archiveFile.confirmedAt);

      return [
        {
          recordId: archiveFile.id,
          fileId: file.id,
          fileName: file.originalName,
          purpose: "结算签章归档件",
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          status: archiveFile.status,
          statusLabel: this.archiveFileStatusLabel(archiveFile.status),
          uploadedByName:
            userById.get(archiveFile.uploadedByUserId)?.name ?? archiveFile.uploadedByUserId,
          uploadedAt: archiveFile.createdAt.toISOString(),
          confirmedByName: archiveFile.confirmedByUserId
            ? userById.get(archiveFile.confirmedByUserId)?.name ?? archiveFile.confirmedByUserId
            : null,
          confirmedAt: archiveFile.confirmedAt?.toISOString() ?? null,
          canDownload,
          disabledReason: canDownload ? null : "归档确认后开放下载"
        }
      ];
    });
  }

  private async paymentActivityForSettlement(settlementId: string): Promise<{
    requestedAmountCents: number;
    paidAmountCents: number;
    activeRequestCount: number;
  }> {
    const client = this.prisma as unknown as {
      paymentRequest?: {
        findMany(args: {
          where: { settlementId: string };
          select: { id: true; status: true; requestedAmountCents: true; paidAmountCents: true };
        }): Promise<
          Array<{
            id: string;
            status: string;
            requestedAmountCents: number;
            paidAmountCents: number;
          }>
        >;
      };
      paymentExecution?: {
        findMany(args: {
          where: { paymentRequestId: { in: string[] } };
          select: { amountCents: true };
        }): Promise<Array<{ amountCents: number }>>;
      };
    };

    if (!client.paymentRequest?.findMany) {
      return { requestedAmountCents: 0, paidAmountCents: 0, activeRequestCount: 0 };
    }

    const requests = await client.paymentRequest.findMany({
      where: { settlementId },
      select: { id: true, status: true, requestedAmountCents: true, paidAmountCents: true }
    });
    const activeRequests = requests.filter((request) => !["rejected", "withdrawn", "voided"].includes(request.status));
    const requestedAmountCents = activeRequests.reduce(
      (total, request) => total + request.requestedAmountCents,
      0
    );
    if (!activeRequests.length) {
      return { requestedAmountCents, paidAmountCents: 0, activeRequestCount: 0 };
    }

    if (!client.paymentExecution?.findMany) {
      return {
        requestedAmountCents,
        paidAmountCents: activeRequests.reduce((total, request) => total + request.paidAmountCents, 0),
        activeRequestCount: activeRequests.length
      };
    }

    const executions = await client.paymentExecution.findMany({
      where: { paymentRequestId: { in: activeRequests.map((request) => request.id) } },
      select: { amountCents: true }
    });
    return {
      requestedAmountCents,
      paidAmountCents: executions.reduce((total, execution) => total + execution.amountCents, 0),
      activeRequestCount: activeRequests.length
    };
  }

  async listRecent(rawLimit?: string | number, visibleProjectIds?: string[]) {
    const take = this.limit(rawLimit);
    const settlements = await this.prisma.settlement.findMany({
      ...(visibleProjectIds ? { where: { projectId: { in: visibleProjectIds } } } : {}),
      take,
      orderBy: { updatedAt: "desc" }
    });
    const contractIds = [...new Set(settlements.map((settlement) => settlement.contractId))];
    const termsIds = [...new Set(settlements.map((settlement) => settlement.paymentTermsVersionId))];
    const projectIds = [...new Set(settlements.map((settlement) => settlement.projectId))];
    const [contracts, terms, projects] = await Promise.all([
      contractIds.length
        ? this.prisma.contract.findMany({ where: { id: { in: contractIds } } })
        : Promise.resolve([]),
      termsIds.length
        ? this.prisma.paymentTermsVersion.findMany({ where: { id: { in: termsIds } } })
        : Promise.resolve([]),
      projectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: projectIds } } })
        : Promise.resolve([])
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const termsById = new Map(terms.map((term) => [term.id, term]));
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const rows = settlements.map((settlement) => {
      const contract = contractById.get(settlement.contractId);
      const termsVersion = termsById.get(settlement.paymentTermsVersionId);
      const status = this.statusView(settlement.status);
      const nextAction = this.nextActionLabel(settlement.status);
      const pendingOwner = this.currentOwnerLabel(settlement.status);

      return {
        id: settlement.code,
        settlementNo: settlement.code,
        contractNo: contract?.code ?? contract?.temporaryCode ?? settlement.contractId,
        project: projectById.get(settlement.projectId)?.name ?? settlement.projectId,
        period: settlement.periodLabel,
        amount: this.formatMoney(settlement.amountCents),
        paymentTermsVersion: termsVersion ? `v${termsVersion.versionNo}` : "-",
        currentNode: nextAction,
        nodeTone: status.tone,
        ownerDepartment: pendingOwner,
        pendingOwner,
        stalledFor: this.stalledFor(settlement.updatedAt),
        returnReason: this.returnReason(settlement.status),
        nextAction,
        updatedAt: this.date(settlement.updatedAt)
      };
    });

    return {
      rows,
      summary: {
        total: rows.length,
        inApproval: settlements.filter((settlement) => settlement.status === "approval_pending").length,
        pendingArchive: settlements.filter((settlement) =>
          ["approved_pending_archive", "archive_pending", "pending_archive_confirm"].includes(settlement.status)
        ).length,
        effective: settlements.filter((settlement) => settlement.status === "effective").length,
        payable: settlements.filter((settlement) => settlement.status === "effective").length
      }
    };
  }

  async getDetail(
    settlementId: string,
    visibleProjectIds?: string[],
    actorUserId?: string
  ): Promise<SettlementDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(settlementId);
    }

    const settlement = await this.prisma.settlement.findFirst({
      where: {
        OR: [{ id: settlementId }, { code: settlementId }],
        ...(visibleProjectIds ? { projectId: { in: visibleProjectIds } } : {})
      }
    });

    if (!settlement) {
      throw new NotFoundException("Settlement not found");
    }

    const [
      contract,
      contractVersion,
      terms,
      paymentRequest,
      archiveFiles,
      approvalTimeline,
      paymentActivity
    ] = await Promise.all([
      this.prisma.contract.findUnique({ where: { id: settlement.contractId } }),
      this.prisma.contractVersion.findUnique({ where: { id: settlement.contractVersionId } }),
      this.prisma.paymentTermsVersion.findUnique({
        where: { id: settlement.paymentTermsVersionId }
      }),
      this.prisma.paymentRequest.findFirst({
        where: { settlementId: settlement.id },
        orderBy: { createdAt: "desc" }
      }),
      this.settlementArchiveFilesForSettlement(settlement.id),
      approvalTimelineForBusiness(this.prisma, "settlement", settlement.id),
      this.paymentActivityForSettlement(settlement.id)
    ]);

    if (!contract) {
      throw new NotFoundException("Settlement contract not found");
    }

    if (!contractVersion) {
      throw new NotFoundException("Settlement contract version not found");
    }

    if (!terms) {
      throw new NotFoundException("Settlement payment terms version not found");
    }

    const stages = await this.prisma.paymentTermsStage.findMany({
      where: { paymentTermsVersionId: terms.id },
      orderBy: { createdAt: "asc" }
    });
    const status = this.statusView(settlement.status);
    const roleKeys = await this.actorRoleKeys(actorUserId, settlement.projectId);
    const canReviewApproval = await this.canReviewCurrentApproval(
      "settlement",
      settlement.id,
      settlement.projectId,
      roleKeys,
      actorUserId
    );
    const availableActions = this.settlementActions(
      settlement.status,
      roleKeys,
      canReviewApproval,
      archiveFiles
    );

    return {
      id: settlement.code,
      settlementId: settlement.id,
      title: `${settlement.code} · ${settlement.periodLabel}结算单`,
      meta: [
        { label: "当前状态", value: status.label, tone: status.tone },
        { label: "关联合同版本", value: `合同 v${contractVersion.versionNo}` },
        { label: "付款条款版本", value: `v${terms.versionNo} 随合同生效` },
        { label: "结算期间", value: settlement.periodLabel },
        { label: "责任部门", value: "合同部" },
        { label: "下一步动作", value: this.nextActionLabel(settlement.status), tone: status.tone }
      ],
      baseInfo: [
        { label: "结算编号", value: settlement.code },
        { label: "关联合同", value: `${contract.code} · ${contract.name}` },
        { label: "结算性质", value: "月度结算" },
        { label: "是否最终结算", value: "否" },
        { label: "结算金额", value: this.formatMoney(settlement.amountCents) },
        { label: "创建人", value: "项目经理" }
      ],
      effectivenessSteps: this.effectivenessSteps(settlement.status),
      archiveResponsibilities: [
        "结算审批不经过董事长/总经理",
        "结算归档件由合同部成员上传",
        "归档由合同部主管确认",
        "财务只读取业务归档件"
      ],
      paymentRules: stages.map((stage) => ({
        id: stage.id,
        stage: stage.name,
        ratio: this.ratioLabel(stage.ratioBps),
        accountPeriod: `${stage.dueDays}天`,
        triggerCondition: stage.triggerEvent,
        paymentRequestStatus: paymentRequest?.status ?? this.defaultPaymentRequestStatus(settlement.status)
      })),
      payableCalculation: this.payableCalculation(settlement, paymentActivity),
      paymentBlockMessage: this.paymentBlockMessage(settlement.status),
      archiveFiles,
      approvalTimeline,
      availableActions,
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: disabledActionReasons(availableActions),
      chainLinks: [
        { label: "关联合同", to: `/contracts/${contract.code}` },
        { label: "付款申请", to: paymentRequest ? `/payments/${paymentRequest.code}` : "/payments" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private sampleDetail(settlementId: string): SettlementDetailReadModel {
    return {
      id: settlementId,
      settlementId: "settlement-sample",
      title: "JS-2026-018 · 5月材料结算单",
      meta: [
        { label: "当前状态", value: "待归档确认", tone: "primary" },
        { label: "关联合同版本", value: "合同 v1" },
        { label: "付款条款版本", value: "v1 随合同生效" },
        { label: "结算期间", value: "2026-05" },
        { label: "责任部门", value: "合同部" },
        { label: "下一步动作", value: "主管确认归档", tone: "primary" }
      ],
      baseInfo: [
        { label: "结算编号", value: settlementId },
        { label: "关联合同", value: "HT-2026-001 · 钢材采购合同" },
        { label: "结算性质", value: "月度结算" },
        { label: "是否最终结算", value: "否" },
        { label: "结算金额", value: "¥320,000.00" },
        { label: "创建人", value: "项目经理 张工" }
      ],
      effectivenessSteps: [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "待处理", tone: "primary" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ],
      archiveResponsibilities: [
        "结算审批不经过董事长/总经理",
        "结算归档件由合同部成员上传",
        "归档由合同部主管确认",
        "财务只读取业务归档件"
      ],
      paymentRules: [
        {
          id: "current-settlement-payment",
          stage: "当期结算款",
          ratio: "80%",
          accountPeriod: "30天",
          triggerCondition: "结算归档确认生效",
          paymentRequestStatus: "未开放"
        },
        {
          id: "retention-payment",
          stage: "质保金",
          ratio: "20%",
          accountPeriod: "365天",
          triggerCondition: "质保期满",
          paymentRequestStatus: "未开放"
        }
      ],
      payableCalculation: {
        items: [
          { label: "本期结算金额", value: "¥320,000.00" },
          { label: "本期可付金额", value: "¥256,000.00", tone: "success" },
          { label: "已申请付款", value: "¥0.00", tone: "default" },
          { label: "已实付金额", value: "¥0.00" },
          { label: "剩余可申请", value: "¥256,000.00", tone: "primary" }
        ],
        note: "剩余可申请按本结算可付金额扣减未作废/未驳回/未撤回的付款申请，最终以后端创建付款校验为准。"
      },
      paymentBlockMessage:
        "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。",
      archiveFiles: [],
      approvalTimeline: [],
      availableActions: [],
      primaryAction: null,
      disabledReasons: [],
      chainLinks: [
        { label: "关联合同", to: "/contracts/HT-2026-001" },
        { label: "付款申请", to: "/payments/FK-2026-006" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private payableCalculation(
    settlement: { amountCents: number; payableAmountCents?: number | null },
    paymentActivity: { requestedAmountCents: number; paidAmountCents: number; activeRequestCount: number }
  ): SettlementDetailReadModel["payableCalculation"] {
    const payableAmountCents = settlement.payableAmountCents ?? 0;
    const remainingRequestableCents = Math.max(payableAmountCents - paymentActivity.requestedAmountCents, 0);

    return {
      items: [
        { label: "本期结算金额", value: this.formatMoney(settlement.amountCents) },
        { label: "本期可付金额", value: this.formatMoney(payableAmountCents), tone: "success" },
        {
          label: "已申请付款",
          value: this.formatMoney(paymentActivity.requestedAmountCents),
          tone: paymentActivity.activeRequestCount > 0 ? "warning" : "default"
        },
        { label: "已实付金额", value: this.formatMoney(paymentActivity.paidAmountCents) },
        { label: "剩余可申请", value: this.formatMoney(remainingRequestableCents), tone: "primary" }
      ],
      note: "剩余可申请按本结算可付金额扣减未作废/未驳回/未撤回的付款申请，最终以后端创建付款校验为准。"
    };
  }

  private async actorRoleKeys(actorUserId: string | undefined, projectId: string): Promise<RoleKey[]> {
    if (!actorUserId || !this.projectVisibility) {
      return [];
    }

    return this.projectVisibility.effectiveRoleKeys(actorUserId, projectId);
  }

  private async canReviewCurrentApproval(
    businessType: string,
    businessId: string,
    projectId: string,
    roleKeys: RoleKey[],
    actorUserId?: string
  ): Promise<boolean> {
    if (!actorUserId) {
      return false;
    }

    const approvalClient = (this.prisma as unknown as {
      approvalInstance?: {
        findFirst(args: {
          where: { businessType: string; businessId: string; status: string };
          orderBy: { createdAt: "desc" };
          select: { frozenNodes: true; currentNodeIndex: true };
        }): Promise<{ frozenNodes: unknown; currentNodeIndex: number } | null>;
      };
    }).approvalInstance;
    if (!approvalClient) {
      return false;
    }

    const instance = await approvalClient.findFirst({
      where: { businessType, businessId, status: "in_progress" },
      orderBy: { createdAt: "desc" },
      select: { frozenNodes: true, currentNodeIndex: true }
    });

    if (!instance) {
      return false;
    }

    if (
      canActOnFrozenApprovalNode(
        instance.frozenNodes,
        instance.currentNodeIndex,
        roleKeys,
        actorUserId
      )
    ) {
      return true;
    }

    return this.hasDelegatedApprovalRole(
      actorUserId,
      projectId,
      pendingRoleKeysForFrozenApprovalNode(instance.frozenNodes, instance.currentNodeIndex)
    );
  }

  private async hasDelegatedApprovalRole(
    actorUserId: string,
    projectId: string,
    nodeRoleKeys: RoleKey[]
  ): Promise<boolean> {
    if (!nodeRoleKeys.length || !this.projectVisibility) {
      return false;
    }

    const delegationClient = (this.prisma as unknown as {
      approvalDelegation?: {
        findMany(args: {
          where: {
            toUserId: string;
            enabled: true;
            startsAt: { lte: Date };
            endsAt: { gte: Date };
          };
          select: { fromUserId: true };
        }): Promise<Array<{ fromUserId: string }>>;
      };
    }).approvalDelegation;
    if (!delegationClient) {
      return false;
    }

    const now = new Date();
    const delegations = await delegationClient.findMany({
      where: {
        toUserId: actorUserId,
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gte: now }
      },
      select: { fromUserId: true }
    });

    for (const delegation of delegations) {
      const delegatorRoleKeys = await this.projectVisibility.effectiveRoleKeys(
        delegation.fromUserId,
        projectId
      );
      if (nodeRoleKeys.some((role) => delegatorRoleKeys.includes(role))) {
        return true;
      }
    }

    return false;
  }

  private settlementActions(
    status: string,
    roleKeys: RoleKey[],
    canReviewApproval: boolean,
    archiveFiles: SettlementDetailReadModel["archiveFiles"]
  ): DetailActionReadModel[] {
    const workflowActions = [
      detailAction({
        key: "download_approval_form",
        label: "下载最新审批 PDF",
        kind: "normal",
        roleKeys,
        enabled: true
      }),
      detailAction({
        key: "withdraw_approval",
        label: "撤回审批",
        kind: "normal",
        roleKeys,
        requiredAction: "settlement.create",
        enabled: status === "approval_pending"
      }),
      detailAction({
        key: "remind_approval",
        label: "催办审批",
        kind: "normal",
        roleKeys,
        requiredAction: "settlement.create",
        enabled: status === "approval_pending"
      }),
      detailAction({
        key: "transfer_approval",
        label: "转审",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: canReviewApproval,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      detailAction({
        key: "delegate_approval",
        label: "委托",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: canReviewApproval,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      detailAction({
        key: "generate_pdf_archive",
        label: "生成 PDF 归档",
        kind: "normal",
        roleKeys,
        enabled: Boolean(status)
      })
    ];

    if (status === "approval_pending") {
      return [
        detailAction({
          key: "review_approval",
          label: "处理结算审批",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.approve",
          skipRoleCheck: true,
          enabled: canReviewApproval,
          disabledReason: "当前用户不是当前审批节点处理人"
        }),
        ...workflowActions
      ];
    }

    if (status === "approved_pending_archive") {
      return [
        detailAction({
          key: "upload_archive",
          label: "上传结算归档件",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.archive.upload",
          enabled: true,
          requiresFile: true
        }),
        ...workflowActions
      ];
    }

    if (status === "archive_pending" || status === "pending_archive_confirm") {
      return [
        detailAction({
          key: "confirm_archive",
          label: "确认结算归档",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.archive.confirm",
          enabled: true,
          requiresPassword: true
        }),
        ...workflowActions
      ];
    }

    if (status === "effective") {
      return [
        detailAction({
          key: "create_payment",
          label: "发起付款申请",
          kind: "primary",
          roleKeys,
          requiredAction: "payment.create",
          enabled: true
        }),
        detailAction({
          key: "download_archive",
          label: "下载结算归档件",
          kind: "normal",
          roleKeys,
          enabled: archiveFiles.some((file) => file.canDownload),
          disabledReason: "暂无可下载归档件",
          requiresPassword: true
        }),
        ...workflowActions
      ];
    }

    return workflowActions;
  }

  private statusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      approval_pending: { label: "审批中", tone: "primary" },
      approval_rejected: { label: "审批退回", tone: "danger" },
      withdrawn: { label: "已撤回", tone: "danger" },
      approved_pending_archive: { label: "待归档上传", tone: "primary" },
      archive_pending: { label: "待归档确认", tone: "primary" },
      pending_archive_confirm: { label: "待归档确认", tone: "primary" },
      effective: { label: "已生效", tone: "success" },
      rejected: { label: "已退回", tone: "danger" },
      voided: { label: "已作废", tone: "danger" }
    };

    return views[status] ?? { label: status, tone: "default" };
  }

  private archiveFileStatusLabel(status: string): string {
    if (status === "confirmed") return "已确认";
    if (status === "pending_confirm") return "待确认";
    return status;
  }

  private nextActionLabel(status: string): string {
    const labels: Record<string, string> = {
      approval_pending: "等待结算审批",
      approval_rejected: "退回修改",
      withdrawn: "申请人已撤回",
      approved_pending_archive: "上传签章归档件",
      archive_pending: "主管确认归档",
      pending_archive_confirm: "主管确认归档",
      effective: "可创建付款申请",
      rejected: "退回申请人",
      voided: "无"
    };

    return labels[status] ?? "待处理";
  }

  private currentOwnerLabel(status: string): string {
    const labels: Record<string, string> = {
      approval_pending: "审批节点处理人",
      approval_rejected: "项目经理",
      withdrawn: "项目经理",
      approved_pending_archive: "合同部成员",
      archive_pending: "合同部主管",
      pending_archive_confirm: "合同部主管",
      effective: "系统归档",
      rejected: "项目经理",
      voided: "系统归档"
    };

    return labels[status] ?? "合同部";
  }

  private returnReason(status: string): string {
    return ["approval_rejected", "rejected"].includes(status) ? "审批退回，查看审批历史" : "-";
  }

  private stalledFor(value: Date): string {
    const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
    return days === 0 ? "今天" : `${days}天`;
  }

  private effectivenessSteps(status: string): SettlementDetailReadModel["effectivenessSteps"] {
    if (status === "effective") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "已确认", tone: "success" },
        { label: "结算生效", status: "已生效", tone: "success" }
      ];
    }

    if (status === "archive_pending" || status === "pending_archive_confirm") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "待处理", tone: "primary" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    if (status === "approval_rejected" || status === "withdrawn") {
      return [
        {
          label: "结算审批",
          status: status === "withdrawn" ? "已撤回" : "已退回",
          tone: "danger"
        },
        { label: "签字盖章归档上传", status: "未开始", tone: "default" },
        { label: "合同部主管确认", status: "未开始", tone: "default" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    return [
      { label: "结算审批", status: "处理中", tone: "primary" },
      { label: "签字盖章归档上传", status: "未开始", tone: "default" },
      { label: "合同部主管确认", status: "未开始", tone: "default" },
      { label: "结算生效", status: "阻塞", tone: "danger" }
    ];
  }

  private defaultPaymentRequestStatus(status: string): string {
    return status === "effective" ? "可创建" : "未开放";
  }

  private paymentBlockMessage(status: string): string {
    if (status === "effective") {
      return "结算已生效，可按绑定付款条款版本创建付款申请；付款比例和账期必须追溯当前版本。";
    }

    return "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。";
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
    return value.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  }
}
