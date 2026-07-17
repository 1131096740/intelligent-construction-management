import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type RoleKey
} from "@jiangkong/shared-domain";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  resolveApprovalReviewIdentity,
  type FrozenApprovalNode
} from "../approval/approval-review-identity";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";

export interface UploadSignatureInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

export type WorkbenchCardTone = "default" | "primary" | "warning" | "danger" | "success";

export interface WorkbenchCard {
  id:
    | "contract_takeover_todo"
    | "contract_takeover_review"
    | "approval_todo"
    | "approved_pending_payment"
    | "historical_balance_missing"
    | "payment_blocked";
  title: string;
  count: number;
  description: string;
  targetPath: string;
  actionText: string;
  tone: WorkbenchCardTone;
}

export interface WorkbenchSummary {
  generatedAt: string;
  visibleProjectCount: number;
  cards: WorkbenchCard[];
}

export type WorkItemQueueKey = "pending" | "blocked" | "started";
export type ApprovalCenterViewKey =
  | "pendingApproval"
  | "startedByMe"
  | "handledByMe"
  | "delegatedToMe"
  | "overdueReminder";
export type WorkItemKind =
  | "contract_takeover"
  | "archive"
  | "approval"
  | "payment_execution"
  | "blocker";

export interface WorkItem {
  id: string;
  type: WorkItemKind;
  title: string;
  projectName: string;
  projectId?: string;
  businessCode: string;
  businessType?: string;
  businessId?: string;
  amountText: string;
  currentNode: string;
  stayedText: string;
  nextAction: string;
  targetPath: string;
  tone: WorkbenchCardTone;
}

export interface WorkItemsReadModel {
  generatedAt: string;
  visibleProjectCount: number;
  queues: Record<WorkItemQueueKey, WorkItem[]>;
  approvalCenter: Record<ApprovalCenterViewKey, WorkItem[]>;
}

interface ProjectRoleScope {
  projectId: string;
  roleKeys: RoleKey[];
}

interface ApprovalNode extends FrozenApprovalNode {
  name?: unknown;
  roleKeys?: unknown;
  approvedRoleKeys?: unknown;
  assignments?: unknown;
}

interface ApprovalAssignment {
  toUserId?: unknown;
  fromRoleKey?: unknown;
}

const RELEVANT_APPROVAL_TYPES = [
  "contract_version",
  "settlement",
  "payment_request",
  "project_expense_request"
] as const;

const activeTakeoverStatuses = ["draft", "pending_review", "confirmed", "needs_supplement"];

type ApprovalInstanceForWorkItem = {
  id: string;
  businessType: string;
  businessId: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: unknown;
  applicantUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

interface ApprovalBusinessDetail {
  projectId: string;
  projectName: string;
  businessCode: string;
  title: string;
  amountCents: bigint;
  targetPath: string;
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService
  ) {}

  // 个人签名图预上传：存私有文件并记录到 User.signatureFileId，审批单渲染时复用。
  async setSignature(userId: string, input: UploadSignatureInput) {
    if (!input.mimeType.startsWith("image/")) {
      throw new Error("个人签名图片只能上传 PNG 或 JPEG 格式");
    }
    // 仅接受 PNG/JPEG 魔数，挡掉伪装 mime 的非图片字节（避免渲染时解码异常）。
    const b = input.buffer;
    const isPng = b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpeg = b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("个人签名图片只能上传 PNG 或 JPEG 格式");
    }

    const file = await this.files.uploadPrivateFile({
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedByUserId: userId,
      buffer: input.buffer
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { signatureFileId: file.id }
    });

    return { signatureFileId: file.id };
  }

  async getSignatureTicket(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.signatureFileId) {
      return null;
    }

    return this.files.createDownloadTicket(user.signatureFileId, {
      actorUserId: userId,
      downloadReason: "个人签名预览"
    });
  }

  async getWorkbenchSummary(userId: string): Promise<WorkbenchSummary> {
    const scopes = await this.loadProjectRoleScopes(userId);
    const cards: WorkbenchCard[] = [];

    const takeoverProjects = this.projectIdsFor(scopes, ["contract.create", "contract.submit"]);
    if (takeoverProjects.length) {
      cards.push({
        id: "contract_takeover_todo",
        title: "待接管合同",
        count: await this.countTakeovers(takeoverProjects, {
          takeoverStatus: { in: ["draft", "needs_supplement"] }
        }),
        description: "历史合同草稿或待补充资料，需要补录后提交复核。",
        targetPath: "/历史合同接管",
        actionText: "去接管",
        tone: "primary"
      });
    }

    const takeoverConfirmProjects = this.projectIdsFor(scopes, ["contract.archive.confirm"]);
    if (takeoverConfirmProjects.length) {
      cards.push({
        id: "contract_takeover_review",
        title: "待复核/确认接管",
        count: await this.countTakeovers(takeoverConfirmProjects, {
          takeoverStatus: "pending_review"
        }),
        description: "历史合同已提交复核，等待合同部主管确认接管。",
        targetPath: "/历史合同接管",
        actionText: "去确认",
        tone: "warning"
      });
    }

    const approvalProjects = this.projectIdsFor(scopes, [
      "contract.approve",
      "settlement.approve",
      "payment.approve",
      "project_expense.approve"
    ]);
    if (approvalProjects.length) {
      const approvalCounts = await this.countApprovalTodos(scopes, userId);
      cards.push({
        id: "approval_todo",
        title: "待审批",
        count: approvalCounts.total,
        description: `合同 ${approvalCounts.contract} · 结算 ${approvalCounts.settlement} · 付款 ${approvalCounts.payment} · 支出 ${approvalCounts.expense}`,
        targetPath: this.approvalTargetPath(approvalCounts),
        actionText: "去处理",
        tone: "primary"
      });
    }

    const paymentExecutionProjects = this.projectIdsFor(scopes, ["payment.execution"]);
    if (paymentExecutionProjects.length) {
      cards.push({
        id: "approved_pending_payment",
        title: "已批待付款",
        count: await this.prisma.paymentRequest.count({
          where: {
            projectId: { in: paymentExecutionProjects },
            status: { in: ["approved_pending_payment", "partially_paid"] }
          }
        }),
        description: "付款审批已通过，等待出纳登记实付和凭证。",
        targetPath: "/付款管理",
        actionText: "去付款",
        tone: "warning"
      });
    }

    const balanceProjects = this.projectIdsFor(scopes, [
      "contract.create",
      "contract.archive.confirm"
    ]);
    if (balanceProjects.length) {
      cards.push({
        id: "historical_balance_missing",
        title: "历史余额未确认",
        count: await this.countTakeovers(balanceProjects, {
          takeoverStatus: { in: activeTakeoverStatuses },
          historicalBalanceConfirmedAt: null
        }),
        description: "历史已付、待付或占用余额未确认，付款容量还不能放心使用。",
        targetPath: "/历史合同接管",
        actionText: "补资料",
        tone: "danger"
      });
    }

    const paymentCreateProjects = this.projectIdsFor(scopes, ["payment.create"]);
    if (paymentCreateProjects.length) {
      cards.push({
        id: "payment_blocked",
        title: "付款阻断风险",
        count: await this.countTakeovers(paymentCreateProjects, {
          takeoverStatus: { in: activeTakeoverStatuses },
          OR: [{ takeoverStatus: { not: "confirmed" } }, { historicalBalanceConfirmedAt: null }]
        }),
        description: "历史接管或余额未确认的合同，发起付款会被后端拦截。",
        targetPath: "/付款管理",
        actionText: "看付款",
        tone: "danger"
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      visibleProjectCount: scopes.length,
      cards
    };
  }

  async getWorkItems(userId: string): Promise<WorkItemsReadModel> {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map((scope) => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);

    const pending = [
      ...(await this.contractTakeoverWorkItems(
        this.projectIdsFor(scopes, ["contract.create", "contract.submit"]),
        ["draft", "needs_supplement"],
        projectNameById,
        "补录历史合同",
        "补齐资料后提交复核",
        "primary"
      )),
      ...(await this.contractTakeoverWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.confirm"]),
        ["pending_review"],
        projectNameById,
        "复核历史合同接管",
        "确认后作为系统事实起点",
        "warning"
      )),
      ...(await this.paymentExecutionWorkItems(
        this.projectIdsFor(scopes, ["payment.execution"]),
        projectNameById
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.seal"]),
        ["approved_pending_seal"],
        projectNameById,
        "待同意用章",
        "核对审批结果后同意经办人线下取章",
        "warning",
        undefined,
        "governed"
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.seal"]),
        ["approved_pending_seal"],
        projectNameById,
        "待确认用章",
        "确认后上传盖章合同",
        "warning",
        undefined,
        "legacy"
      )),
      ...(await this.contractSealHandlerWorkItems(
        userId,
        projectNameById
      )),
      ...(await this.contractFinalUploadSubstituteWorkItems(
        userId,
        projectIds,
        projectNameById
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.upload"]),
        ["seal_approved_pending_archive"],
        projectNameById,
        "上传盖章合同",
        "上传后等待合同部主管确认归档",
        "primary"
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.confirm"]),
        ["pending_archive_confirm"],
        projectNameById,
        "确认合同归档",
        "确认后合同版本生效",
        "warning",
        userId
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.upload"]),
        ["approved_pending_archive"],
        projectNameById,
        "上传结算签认件",
        "上传后等待合同部主管确认归档",
        "primary",
        "legacy"
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        ["archive_pending", "pending_archive_confirm"],
        projectNameById,
        "确认结算归档",
        "确认后结算生效，可申请付款",
        "warning",
        "legacy"
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        ["pending_archive_confirm"],
        projectNameById,
        "确认最终结算文件",
        "确认后结算生效，可申请付款",
        "warning",
        "governed"
      )),
      ...(await this.failedSettlementGenerationWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        projectNameById
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt))
    ];

    const blocked = await this.contractTakeoverWorkItems(
      this.projectIdsFor(scopes, ["contract.create", "contract.archive.confirm", "payment.create"]),
      activeTakeoverStatuses,
      projectNameById,
      "历史余额未确认",
      "确认余额后付款容量才可信",
      "danger",
      {
        OR: [
          { takeoverStatus: { not: "confirmed" } },
          { historicalBalanceConfirmedAt: null }
        ]
      }
    );

    const started = await this.approvalWorkItems(scopes, userId, "started", evaluatedAt);
    const handledByMe = await this.handledApprovalWorkItems(scopes, userId);
    const delegatedToMe = (
      await this.approvalWorkItems(scopes, userId, "delegated", evaluatedAt)
    ).filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index
    );

    return {
      generatedAt: evaluatedAt.toISOString(),
      visibleProjectCount: scopes.length,
      queues: {
        pending: pending.slice(0, 30),
        blocked: blocked.slice(0, 30),
        started: started.slice(0, 30)
      },
      approvalCenter: {
        pendingApproval: pending.filter((item) => item.type === "approval").slice(0, 30),
        startedByMe: started.slice(0, 30),
        handledByMe,
        delegatedToMe,
        overdueReminder: []
      }
    };
  }

  private async loadProjectRoleScopes(userId: string): Promise<ProjectRoleScope[]> {
    const [globalPositions, projectPositions, projectMembers, activeProjects] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
      this.prisma.projectMember.findMany({ where: { userId } }),
      this.prisma.project.findMany({ where: { isActive: true }, select: { id: true } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const localProjectIds = new Set<string>([
      ...projectPositions
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMembers.map((member) => member.projectId)
    ]);

    return activeProjects
      .filter((project) => globalRoleKeys.length > 0 || localProjectIds.has(project.id))
      .map((project) => {
        const projectRoleKeys = [
          ...projectPositions
            .filter((position) => position.projectId === project.id)
            .map((position) => positionKeyById.get(position.positionId))
            .filter((role): role is RoleKey => Boolean(role)),
          ...projectMembers
            .filter((member) => member.projectId === project.id)
            .map((member) => member.positionKey as RoleKey)
        ];

        return {
          projectId: project.id,
          roleKeys: resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys)
        };
      });
  }

  private projectIdsFor(scopes: ProjectRoleScope[], actions: BusinessAction[]) {
    return scopes
      .filter((scope) => actions.some((action) => canPerform(action, scope.roleKeys)))
      .map((scope) => scope.projectId);
  }

  private async projectNames(projectIds: string[]) {
    if (!projectIds.length) {
      return new Map<string, string>();
    }

    const projects = await this.prisma.project.findMany({
      where: { id: { in: [...new Set(projectIds)] } },
      select: { id: true, name: true }
    });
    return new Map(projects.map((project) => [project.id, project.name]));
  }

  private async contractTakeoverWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone,
    extraWhere: Prisma.ContractTakeoverWhereInput = {}
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const takeovers = await this.prisma.contractTakeover.findMany({
      where: {
        projectId: { in: projectIds },
        takeoverStatus: { in: statuses },
        ...extraWhere
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        projectId: true,
        contractId: true,
        contractVersionId: true,
        updatedAt: true
      }
    });
    const [contracts, versions] = await Promise.all([
      takeovers.length
        ? this.prisma.contract.findMany({
            where: { id: { in: [...new Set(takeovers.map((item) => item.contractId))] } },
            select: { id: true, code: true, temporaryCode: true, name: true, counterparty: true }
          })
        : Promise.resolve([]),
      takeovers.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: [...new Set(takeovers.map((item) => item.contractVersionId))] } },
            select: { id: true, amountCents: true }
          })
        : Promise.resolve([])
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const versionById = new Map(versions.map((version) => [version.id, version]));

    return takeovers.map((takeover) => {
      const contract = contractById.get(takeover.contractId);
      const code = contract?.code ?? contract?.temporaryCode ?? takeover.contractId;
      return {
        id: `takeover:${takeover.id}`,
        type: tone === "danger" ? "blocker" : "contract_takeover",
        title: contract?.name ?? "历史合同接管",
        projectName: projectNameById.get(takeover.projectId) ?? takeover.projectId,
        businessCode: code,
        amountText: this.amountText(versionById.get(takeover.contractVersionId)?.amountCents ?? 0n),
        currentNode,
        stayedText: this.stayedText(takeover.updatedAt),
        nextAction,
        targetPath: "/历史合同接管",
        tone
      };
    });
  }

  private async paymentExecutionWorkItems(
    projectIds: string[],
    projectNameById: ReadonlyMap<string, string>
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const payments = await this.prisma.paymentRequest.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: ["approved_pending_payment", "partially_paid"] }
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        projectId: true,
        code: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true,
        updatedAt: true
      }
    });

    return payments.map((payment) => {
      const payableAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const balance = payableAmountCents - payment.paidAmountCents;
      const remainingAmountCents = balance > 0n ? balance : 0n;

      return {
        id: `payment-execution:${payment.id}`,
        type: "payment_execution",
        title: "登记实付与凭证",
        projectName: projectNameById.get(payment.projectId) ?? payment.projectId,
        businessCode: payment.code,
        amountText: this.amountText(
          remainingAmountCents !== 0n ? remainingAmountCents : payableAmountCents
        ),
        currentNode: "财务/出纳实付",
        stayedText: this.stayedText(payment.updatedAt),
        nextAction: "登记实付并上传凭证",
        targetPath: `/付款管理/${payment.code}`,
        tone: "warning"
      };
    });
  }

  private async contractArchiveWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone,
    actorUserId?: string,
    governanceMode?: "governed" | "legacy"
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const contracts = await this.prisma.contract.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
    });
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const versions = contracts.length
      ? await this.prisma.contractVersion.findMany({
          where: {
            contractId: { in: contracts.map((contract) => contract.id) },
            status: { in: statuses },
            ...(governanceMode === "governed"
              ? { contractGovernanceVersion: 1 }
              : governanceMode === "legacy"
                ? { contractGovernanceVersion: null }
                : {})
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: {
            id: true,
            contractId: true,
            amountCents: true,
            updatedAt: true,
            contractGovernanceVersion: true
          }
        })
      : [];
    const governedPendingIds = versions
      .filter((version) =>
        version.contractGovernanceVersion === 1 &&
        statuses.includes("pending_archive_confirm")
      )
      .map((version) => version.id);
    const ownFinalVersionIds = new Set(
      actorUserId && governedPendingIds.length
        ? (await this.prisma.contractFormalFile?.findMany?.({
            where: {
              contractVersionId: { in: governedPendingIds },
              purpose: "mutually_signed_final",
              status: "active",
              uploadedByUserId: actorUserId
            },
            select: { contractVersionId: true }
          }) ?? []).map((item) => item.contractVersionId)
        : []
    );

    return versions.flatMap((version) => {
      if (version.contractGovernanceVersion === 1 && statuses.includes("seal_approved_pending_archive")) {
        return [];
      }
      if (ownFinalVersionIds.has(version.id)) return [];
      const contract = contractById.get(version.contractId);
      if (!contract) {
        return [];
      }
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      return [
        {
          id: `contract-archive:${version.id}`,
          type: "archive",
          title: contract.name,
          projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
          businessCode: code,
          amountText: this.amountText(version.amountCents),
          currentNode,
          stayedText: this.stayedText(version.updatedAt),
          nextAction,
          targetPath: `/合同管理/${code}`,
          tone
        }
      ];
    });
  }

  private async contractSealHandlerWorkItems(
    userId: string,
    projectNameById: ReadonlyMap<string, string>
  ): Promise<WorkItem[]> {
    const tasks = await this.prisma.contractSealTask?.findMany({
      where: { handlerUserId: userId, status: { in: ["in_seal", "completed"] } },
      orderBy: { updatedAt: "desc" },
      take: 30
    }) ?? [];
    if (!tasks.length) return [];
    const versions = await this.prisma.contractVersion.findMany({
      where: {
        id: { in: tasks.map((item) => item.contractVersionId) },
        status: { in: ["in_seal", "seal_approved_pending_archive"] }
      },
      select: { id: true, contractId: true, status: true, amountCents: true, updatedAt: true }
    });
    const contracts = versions.length ? await this.prisma.contract.findMany({
      where: {
        id: { in: [...new Set(versions.map((item) => item.contractId))] }
      },
      select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
    }) : [];
    const contractById = new Map(contracts.map((item) => [item.id, item]));
    return versions.flatMap((version) => {
      const contract = contractById.get(version.contractId);
      if (!contract) return [];
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      const completing = version.status === "in_seal";
      return [{
        id: `contract-seal-handler:${version.id}`,
        type: "archive" as const,
        title: contract.name,
        projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        amountText: this.amountText(version.amountCents),
        currentNode: completing ? "线下签署盖章" : "上传双方最终版",
        stayedText: this.stayedText(version.updatedAt),
        nextAction: completing ? "确认我方签署盖章完成" : "上传双方最终签署 PDF",
        targetPath: `/合同管理/${code}`,
        tone: "primary" as const
      }];
    });
  }

  private async contractFinalUploadSubstituteWorkItems(
    userId: string,
    visibleProjectIds: string[],
    projectNameById: ReadonlyMap<string, string>
  ): Promise<WorkItem[]> {
    if (!visibleProjectIds.length) return [];
    const directorPosition = await this.prisma.position?.findUnique?.({
      where: { key: "contract_director" },
      select: { id: true }
    });
    if (!directorPosition) return [];
    const assignments = await this.prisma.userPosition?.findMany?.({
      where: { projectId: null, positionId: directorPosition.id },
      select: { userId: true }
    }) ?? [];
    const activeDirectors = assignments.length ? await this.prisma.user?.findMany?.({
      where: { id: { in: assignments.map((item) => item.userId) }, isActive: true },
      select: { id: true }
    }) ?? [] : [];
    if (activeDirectors.length !== 1) return [];
    const memberships = await this.prisma.projectMember?.findMany?.({
      where: {
        userId,
        projectId: { in: visibleProjectIds },
        positionKey: "contract_staff"
      },
      select: { projectId: true }
    }) ?? [];
    const staffProjectIds = memberships.map((item) => item.projectId);
    if (!staffProjectIds.length) return [];
    const tasks = await this.prisma.contractSealTask?.findMany?.({
      where: { handlerUserId: activeDirectors[0].id, status: "completed" },
      select: { contractVersionId: true }
    }) ?? [];
    if (!tasks.length) return [];
    const versions = await this.prisma.contractVersion.findMany({
      where: {
        id: { in: tasks.map((item) => item.contractVersionId) },
        contractGovernanceVersion: 1,
        status: "seal_approved_pending_archive"
      },
      select: { id: true, contractId: true, amountCents: true, updatedAt: true }
    });
    const contracts = versions.length ? await this.prisma.contract.findMany({
      where: {
        id: { in: [...new Set(versions.map((item) => item.contractId))] },
        projectId: { in: staffProjectIds }
      },
      select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
    }) : [];
    const contractById = new Map(contracts.map((item) => [item.id, item]));
    return versions.flatMap((version) => {
      const contract = contractById.get(version.contractId);
      if (!contract) return [];
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      return [{
        id: `contract-final-substitute:${version.id}`,
        type: "archive" as const,
        title: contract.name,
        projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        amountText: this.amountText(version.amountCents),
        currentNode: "上传双方最终版",
        stayedText: this.stayedText(version.updatedAt),
        nextAction: "代唯一合同主管上传双方最终签署 PDF",
        targetPath: `/合同管理/${code}`,
        tone: "primary" as const
      }];
    });
  }

  private async settlementArchiveWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone,
    governanceMode?: "governed" | "legacy"
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const settlements = await this.prisma.settlement.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: statuses },
        ...(governanceMode === "governed"
          ? { governanceVersion: 1 }
          : governanceMode === "legacy"
            ? { governanceVersion: null }
            : {})
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        projectId: true,
        contractId: true,
        code: true,
        periodLabel: true,
        amountCents: true,
        governanceVersion: true,
        updatedAt: true
      }
    });
    const contracts = settlements.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: [...new Set(settlements.map((settlement) => settlement.contractId))] } },
          select: { id: true, name: true }
        })
      : [];
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

    return settlements.map((settlement) => ({
      id: `settlement-archive:${settlement.id}`,
      type: "archive",
      title: contractById.get(settlement.contractId)?.name ?? `结算 ${settlement.periodLabel}`,
      projectName: projectNameById.get(settlement.projectId) ?? settlement.projectId,
      businessCode: settlement.code,
      amountText: this.amountText(settlement.amountCents),
      currentNode,
      stayedText: this.stayedText(settlement.updatedAt),
      nextAction,
      targetPath: `/结算管理/${settlement.code}`,
      tone
    }));
  }

  private async failedSettlementGenerationWorkItems(
    projectIds: string[],
    projectNameById: ReadonlyMap<string, string>
  ): Promise<WorkItem[]> {
    if (!projectIds.length || !this.prisma.settlementSignedDocumentGenerationClaim) {
      return [];
    }
    // Restrict the parent business rows first; claim facts are only read for visible settlements.
    const settlements = await this.prisma.settlement.findMany({
      where: {
        projectId: { in: projectIds },
        governanceVersion: 1,
        status: "pending_generation"
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        projectId: true,
        contractId: true,
        code: true,
        periodLabel: true,
        amountCents: true,
        updatedAt: true
      }
    });
    if (!settlements.length) return [];
    const generationClaims = await this.prisma.settlementSignedDocumentGenerationClaim.findMany({
      where: {
        settlementId: { in: settlements.map((settlement) => settlement.id) }
      },
      select: {
        settlementId: true,
        status: true,
        claimedAt: true,
        uploadedFileId: true,
        safeFailureCode: true
      }
    });
    const claimBySettlementId = new Map(
      generationClaims.map((claim) => [claim.settlementId, claim])
    );
    const staleBefore = Date.now() - 5 * 60 * 1000;
    const failedSettlementIds = new Set(
      settlements
        .filter((settlement) => {
          const claim = claimBySettlementId.get(settlement.id);
          if (!claim) return true;
          if (claim.safeFailureCode) return true;
          if (claim.uploadedFileId && claim.status !== "completed") return true;
          return claim.status === "pending" && claim.claimedAt.getTime() < staleBefore;
        })
        .map((settlement) => settlement.id)
    );
    if (!failedSettlementIds.size) return [];
    const contracts = await this.prisma.contract.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              settlements
                .filter((settlement) => failedSettlementIds.has(settlement.id))
                .map((settlement) => settlement.contractId)
            )
          ]
        }
      },
      select: { id: true, name: true }
    });
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    return settlements
      .filter((settlement) => failedSettlementIds.has(settlement.id))
      .map((settlement) => ({
        id: `settlement-generation-retry:${settlement.id}`,
        type: "archive" as const,
        title: contractById.get(settlement.contractId)?.name ?? `结算 ${settlement.periodLabel}`,
        projectName: projectNameById.get(settlement.projectId) ?? settlement.projectId,
        businessCode: settlement.code,
        amountText: this.amountText(settlement.amountCents),
        currentNode: "最终结算文件生成失败",
        stayedText: this.stayedText(settlement.updatedAt),
        nextAction: "重试生成结算签名合成件",
        targetPath: `/结算管理/${settlement.code}`,
        tone: "danger" as const
      }));
  }

  private async approvalWorkItems(
    scopes: ProjectRoleScope[],
    userId: string,
    mode: "pending" | "started" | "delegated",
    evaluatedAt: Date
  ): Promise<WorkItem[]> {
    const instances = (await this.prisma.approvalInstance.findMany({
      where: {
        status: "in_progress",
        businessType: { in: [...RELEVANT_APPROVAL_TYPES] },
        ...(mode === "started" ? { applicantUserId: userId } : {})
      },
      orderBy: { updatedAt: "desc" },
    })) as ApprovalInstanceForWorkItem[];
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const details = await this.approvalBusinessDetails(instances);
    const items: WorkItem[] = [];

    for (const instance of instances) {
      const detail = details.get(`${instance.businessType}:${instance.businessId}`);
      const node = this.currentApprovalNode(instance.frozenNodes, instance.currentNodeIndex);
      if (!detail || !node) {
        continue;
      }
      const roleKeys = roleKeysByProject.get(detail.projectId) ?? [];
      const isProjectExpense = instance.businessType === "project_expense_request";
      const hasDirectTodo = isProjectExpense
        ? this.hasDirectRoleTodo(node, roleKeys)
        : this.canActOnApprovalNode(node, roleKeys, userId);
      const hasDelegatedTodo =
        mode === "started" || isProjectExpense || hasDirectTodo
          ? false
          : await this.hasDelegatedApprovalTodo(userId, detail.projectId, node, evaluatedAt);
      if (mode === "pending" && !hasDirectTodo && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && !this.hasAssignmentTodo(node, userId) && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && isProjectExpense) {
        continue;
      }

      items.push({
        id: `approval:${instance.id}`,
        type: "approval",
        title: detail.title,
        projectName: detail.projectName,
        projectId: detail.projectId,
        businessCode: detail.businessCode,
        businessType: instance.businessType,
        businessId: instance.businessId,
        amountText: this.amountText(detail.amountCents),
        currentNode: this.approvalNodeName(node),
        stayedText: this.stayedText(instance.updatedAt),
        nextAction: mode === "started" ? "查看审批进度" : "处理当前审批",
        targetPath: detail.targetPath,
        tone: mode === "started" ? "primary" : "warning"
      });
    }

    return items;
  }

  private async handledApprovalWorkItems(
    scopes: ProjectRoleScope[],
    userId: string
  ): Promise<WorkItem[]> {
    const logs = await this.prisma.approvalActionLog.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, approvalInstanceId: true, action: true, createdAt: true }
    });
    const approvalInstanceIds = [...new Set(logs.map((log) => log.approvalInstanceId))];
    if (!approvalInstanceIds.length) {
      return [];
    }

    const instances = (await this.prisma.approvalInstance.findMany({
      where: {
        id: { in: approvalInstanceIds },
        businessType: { in: [...RELEVANT_APPROVAL_TYPES] }
      }
    })) as ApprovalInstanceForWorkItem[];
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const visibleProjectIds = new Set(scopes.map((scope) => scope.projectId));
    const details = await this.approvalBusinessDetails(instances);
    const seen = new Set<string>();
    const items: WorkItem[] = [];

    for (const log of logs) {
      if (seen.has(log.approvalInstanceId)) {
        continue;
      }
      const instance = instanceById.get(log.approvalInstanceId);
      const detail = instance
        ? details.get(`${instance.businessType}:${instance.businessId}`)
        : undefined;
      if (!instance || !detail || !visibleProjectIds.has(detail.projectId)) {
        continue;
      }
      seen.add(log.approvalInstanceId);
      items.push({
        id: `handled-approval:${log.id}`,
        type: "approval",
        title: detail.title,
        projectName: detail.projectName,
        businessCode: detail.businessCode,
        amountText: this.amountText(detail.amountCents),
        currentNode: `已处理：${this.approvalActionLabel(log.action)}`,
        stayedText: this.stayedText(log.createdAt),
        nextAction: "查看业务详情",
        targetPath: detail.targetPath,
        tone: "success"
      });
      if (items.length >= 30) {
        break;
      }
    }

    return items;
  }

  private async approvalBusinessDetails(instances: ApprovalInstanceForWorkItem[]) {
    const result = new Map<string, ApprovalBusinessDetail>();
    const contractVersionIds = instances
      .filter((instance) => instance.businessType === "contract_version")
      .map((instance) => instance.businessId);
    const settlementIds = instances
      .filter((instance) => instance.businessType === "settlement")
      .map((instance) => instance.businessId);
    const paymentIds = instances
      .filter((instance) => instance.businessType === "payment_request")
      .map((instance) => instance.businessId);
    const expenseIds = instances
      .filter((instance) => instance.businessType === "project_expense_request")
      .map((instance) => instance.businessId);

    const [versions, settlements, payments, expenses] = await Promise.all([
      contractVersionIds.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: contractVersionIds } },
            select: { id: true, contractId: true, amountCents: true }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlement.findMany({
            where: { id: { in: settlementIds } },
            select: { id: true, projectId: true, contractId: true, code: true, periodLabel: true, amountCents: true }
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.paymentRequest.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, projectId: true, contractId: true, code: true, requestedAmountCents: true }
          })
        : Promise.resolve([]),
      expenseIds.length
        ? this.prisma.projectExpenseRequest.findMany({
            where: { id: { in: expenseIds } },
            select: {
              id: true,
              projectId: true,
              code: true,
              expenseType: true,
              paymentSubject: true,
              requestedAmountCents: true
            }
          })
        : Promise.resolve([])
    ]);
    const contractIds = [
      ...versions.map((version) => version.contractId),
      ...settlements.map((settlement) => settlement.contractId),
      ...payments.map((payment) => payment.contractId)
    ];
    const contracts = contractIds.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: [...new Set(contractIds)] } },
          select: { id: true, projectId: true, code: true, temporaryCode: true, name: true, counterparty: true }
        })
      : [];
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const projectNames = await this.projectNames([
      ...contracts.map((contract) => contract.projectId),
      ...settlements.map((settlement) => settlement.projectId),
      ...payments.map((payment) => payment.projectId),
      ...expenses.map((expense) => expense.projectId)
    ]);

    for (const version of versions) {
      const contract = contractById.get(version.contractId);
      if (!contract) continue;
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      result.set(`contract_version:${version.id}`, {
        projectId: contract.projectId,
        projectName: projectNames.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        title: `合同审批：${contract.name}`,
        amountCents: version.amountCents,
        targetPath: `/合同管理/${code}`
      });
    }
    for (const settlement of settlements) {
      const contract = contractById.get(settlement.contractId);
      result.set(`settlement:${settlement.id}`, {
        projectId: settlement.projectId,
        projectName: projectNames.get(settlement.projectId) ?? settlement.projectId,
        businessCode: settlement.code,
        title: `结算审批：${contract?.name ?? settlement.periodLabel}`,
        amountCents: settlement.amountCents,
        targetPath: `/结算管理/${settlement.code}`
      });
    }
    for (const payment of payments) {
      const contract = contractById.get(payment.contractId);
      result.set(`payment_request:${payment.id}`, {
        projectId: payment.projectId,
        projectName: projectNames.get(payment.projectId) ?? payment.projectId,
        businessCode: payment.code,
        title: `付款审批：${contract?.name ?? payment.code}`,
        amountCents: payment.requestedAmountCents,
        targetPath: `/付款管理/${payment.code}`
      });
    }
    for (const expense of expenses) {
      result.set(`project_expense_request:${expense.id}`, {
        projectId: expense.projectId,
        projectName: projectNames.get(expense.projectId) ?? expense.projectId,
        businessCode: expense.code,
        title: `${projectExpenseApprovalTitle(expense.expenseType)}：${expense.paymentSubject}`,
        amountCents: expense.requestedAmountCents,
        targetPath: `/项目支出/${expense.projectId}/${expense.id}`
      });
    }

    return result;
  }

  private countTakeovers(projectIds: string[], where: Prisma.ContractTakeoverWhereInput) {
    return this.prisma.contractTakeover.count({
      where: {
        projectId: { in: projectIds },
        ...where
      }
    });
  }

  private async countApprovalTodos(scopes: ProjectRoleScope[], userId: string) {
    const evaluatedAt = new Date();
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const instances = await this.prisma.approvalInstance.findMany({
      where: {
        status: "in_progress",
        businessType: { in: [...RELEVANT_APPROVAL_TYPES] }
      }
    });
    const businessProjectIds = await this.approvalBusinessProjectIds(instances);
    const counts = { contract: 0, settlement: 0, payment: 0, expense: 0, total: 0 };

    for (const instance of instances) {
      const projectId = businessProjectIds.get(`${instance.businessType}:${instance.businessId}`);
      if (!projectId) {
        continue;
      }
      const roleKeys = roleKeysByProject.get(projectId) ?? [];

      const currentNode = this.currentApprovalNode(
        instance.frozenNodes,
        instance.currentNodeIndex
      );
      if (!currentNode) {
        continue;
      }
      const isProjectExpense = instance.businessType === "project_expense_request";
      const hasDirectTodo = isProjectExpense
        ? this.hasDirectRoleTodo(currentNode, roleKeys)
        : this.canActOnApprovalNode(currentNode, roleKeys, userId);
      const hasDelegatedTodo =
        !isProjectExpense && !hasDirectTodo
          ? await this.hasDelegatedApprovalTodo(
              userId,
              projectId,
              currentNode,
              evaluatedAt
            )
          : false;
      if (!hasDirectTodo && !hasDelegatedTodo) {
        continue;
      }

      if (instance.businessType === "contract_version") counts.contract += 1;
      if (instance.businessType === "settlement") counts.settlement += 1;
      if (instance.businessType === "payment_request") counts.payment += 1;
      if (instance.businessType === "project_expense_request") counts.expense += 1;
      counts.total += 1;
    }

    return counts;
  }

  private async approvalBusinessProjectIds(
    instances: Array<{ businessType: string; businessId: string }>
  ) {
    const ids = new Map<string, string>();
    const contractVersionIds = instances
      .filter((instance) => instance.businessType === "contract_version")
      .map((instance) => instance.businessId);
    const settlementIds = instances
      .filter((instance) => instance.businessType === "settlement")
      .map((instance) => instance.businessId);
    const paymentIds = instances
      .filter((instance) => instance.businessType === "payment_request")
      .map((instance) => instance.businessId);
    const expenseIds = instances
      .filter((instance) => instance.businessType === "project_expense_request")
      .map((instance) => instance.businessId);

    const [versions, settlements, payments, expenses] = await Promise.all([
      contractVersionIds.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: contractVersionIds } },
            select: { id: true, contractId: true }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlement.findMany({
            where: { id: { in: settlementIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.paymentRequest.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([]),
      expenseIds.length
        ? this.prisma.projectExpenseRequest.findMany({
            where: { id: { in: expenseIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([])
    ]);
    const contracts = versions.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: [...new Set(versions.map((version) => version.contractId))] } },
          select: { id: true, projectId: true }
        })
      : [];
    const projectIdByContractId = new Map(contracts.map((contract) => [contract.id, contract.projectId]));

    for (const version of versions) {
      const projectId = projectIdByContractId.get(version.contractId);
      if (projectId) ids.set(`contract_version:${version.id}`, projectId);
    }
    for (const settlement of settlements) ids.set(`settlement:${settlement.id}`, settlement.projectId);
    for (const payment of payments) ids.set(`payment_request:${payment.id}`, payment.projectId);
    for (const expense of expenses) {
      ids.set(`project_expense_request:${expense.id}`, expense.projectId);
    }

    return ids;
  }

  private currentApprovalNode(frozenNodes: unknown, index: number): ApprovalNode | null {
    if (!Array.isArray(frozenNodes)) {
      return null;
    }

    const node = frozenNodes[index] as ApprovalNode | undefined;
    return node ?? null;
  }

  private canActOnApprovalNode(node: ApprovalNode, roleKeys: RoleKey[], userId: string) {
    return Boolean(resolveApprovalReviewIdentity({
      node,
      actorUserId: userId,
      actorRoleKeys: roleKeys
    }));
  }

  private hasDirectRoleTodo(node: ApprovalNode, roleKeys: RoleKey[]) {
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    return this.stringArray(node.roleKeys).some(
      (role) => !approvedRoleKeys.has(role) && roleKeys.includes(role as RoleKey)
    );
  }

  private hasAssignmentTodo(node: ApprovalNode, userId: string) {
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    const assignments = Array.isArray(node.assignments)
      ? (node.assignments as ApprovalAssignment[])
      : [];
    return assignments.some((assignment) => {
      if (assignment.toUserId !== userId || typeof assignment.fromRoleKey !== "string") {
        return false;
      }
      if (approvedRoleKeys.has(assignment.fromRoleKey)) return false;
      return Boolean(resolveApprovalReviewIdentity({
        node,
        actorUserId: userId,
        actorRoleKeys: []
      }));
    });
  }

  private async hasDelegatedApprovalTodo(
    userId: string,
    projectId: string,
    node: ApprovalNode,
    evaluatedAt: Date
  ): Promise<boolean> {
    const delegatorIds = await activeApprovalDelegatorIds(
      this.prisma,
      userId,
      evaluatedAt
    );
    const activeDelegators = await Promise.all(delegatorIds.map(async (delegatorId) => ({
      userId: delegatorId,
      roleKeys: await this.roleKeysForUserProject(delegatorId, projectId)
    })));
    return Boolean(resolveApprovalReviewIdentity({
      node,
      actorUserId: userId,
      actorRoleKeys: [],
      activeDelegators
    }));
  }

  private async roleKeysForUserProject(userId: string, projectId: string): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId } }),
      this.prisma.projectMember.findMany({ where: { userId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const projectRoleKeys = [
      ...projectPositions
        .map((position) => positionKeyById.get(position.positionId))
        .filter((role): role is RoleKey => Boolean(role)),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ];

    return resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private approvalNodeName(node: ApprovalNode) {
    if (typeof node.name === "string" && node.name.trim()) {
      return node.name;
    }
    const roles = this.stringArray(node.roleKeys);
    return roles.length ? roles.join(" / ") : "当前审批节点";
  }

  private approvalActionLabel(action: string) {
    const labels: Record<string, string> = {
      approve: "同意",
      reject: "驳回",
      reject_previous: "退回上一步",
      return_to_applicant: "退回申请人",
      transfer: "转审",
      delegate: "委托",
      withdraw: "撤回",
      remind: "催办"
    };
    return labels[action] ?? action;
  }

  private amountText(amountCents: bigint) {
    return `¥${formatMoneyCentsAsYuan(dbMoneyToBigInt(amountCents, "金额"))}`;
  }

  private stayedText(value: Date) {
    const elapsedMs = Math.max(Date.now() - value.getTime(), 0);
    const days = Math.floor(elapsedMs / 86_400_000);
    if (days >= 1) {
      return `已停留 ${days} 天`;
    }
    const hours = Math.max(Math.floor(elapsedMs / 3_600_000), 1);
    return `已停留 ${hours} 小时`;
  }

  private approvalTargetPath(counts: {
    contract: number;
    settlement: number;
    payment: number;
    expense: number;
  }) {
    if (counts.payment > 0) return "/付款管理";
    if (counts.settlement > 0) return "/结算管理";
    if (counts.expense > 0) return "/项目经营";
    return "/合同管理";
  }
}

function projectExpenseApprovalTitle(expenseType: string) {
  if (expenseType === "reimbursement") return "报销审批";
  if (expenseType === "spot_purchase") return "零星采购审批";
  return "项目支出审批";
}
