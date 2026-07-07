import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { centsToSafeNumber } from "../money/decimal-money";

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
  businessCode: string;
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

interface ApprovalNode {
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
  "payment_request"
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
  amountCents: number | bigint;
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
      throw new Error("Signature must be an image");
    }
    // 仅接受 PNG/JPEG 魔数，挡掉伪装 mime 的非图片字节（避免渲染时解码异常）。
    const b = input.buffer;
    const isPng = b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpeg = b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("Signature must be a PNG or JPEG image");
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

    return this.files.createDownloadTicket(user.signatureFileId, { actorUserId: userId });
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
      "payment.approve"
    ]);
    if (approvalProjects.length) {
      const approvalCounts = await this.countApprovalTodos(scopes, userId);
      cards.push({
        id: "approval_todo",
        title: "待审批",
        count: approvalCounts.total,
        description: `合同 ${approvalCounts.contract} · 结算 ${approvalCounts.settlement} · 付款 ${approvalCounts.payment}`,
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
        "warning"
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.upload"]),
        ["approved_pending_archive"],
        projectNameById,
        "上传结算签认件",
        "上传后等待合同部主管确认归档",
        "primary"
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        ["archive_pending", "pending_archive_confirm"],
        projectNameById,
        "确认结算归档",
        "确认后结算生效，可申请付款",
        "warning"
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending"))
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

    const started = await this.approvalWorkItems(scopes, userId, "started");
    const handledByMe = await this.handledApprovalWorkItems(scopes, userId);
    const delegatedToMe = (await this.approvalWorkItems(scopes, userId, "delegated")).filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index
    );

    return {
      generatedAt: new Date().toISOString(),
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
        amountText: this.amountText(versionById.get(takeover.contractVersionId)?.amountCents ?? 0),
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
      const remainingAmountCents = Math.max(payableAmountCents - payment.paidAmountCents, 0);

      return {
        id: `payment-execution:${payment.id}`,
        type: "payment_execution",
        title: "登记实付与凭证",
        projectName: projectNameById.get(payment.projectId) ?? payment.projectId,
        businessCode: payment.code,
        amountText: this.amountText(remainingAmountCents || payableAmountCents),
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
    tone: WorkbenchCardTone
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
            status: { in: statuses }
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: { id: true, contractId: true, amountCents: true, updatedAt: true }
        })
      : [];

    return versions.flatMap((version) => {
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

  private async settlementArchiveWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const settlements = await this.prisma.settlement.findMany({
      where: { projectId: { in: projectIds }, status: { in: statuses } },
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

  private async approvalWorkItems(
    scopes: ProjectRoleScope[],
    userId: string,
    mode: "pending" | "started" | "delegated"
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
      const hasDirectTodo = this.canActOnApprovalNode(node, roleKeys, userId);
      const hasDelegatedTodo = await this.hasDelegatedApprovalTodo(userId, detail.projectId, node);
      if (mode === "pending" && !hasDirectTodo && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && !this.hasAssignmentTodo(node, userId) && !hasDelegatedTodo) {
        continue;
      }

      items.push({
        id: `approval:${instance.id}`,
        type: "approval",
        title: detail.title,
        projectName: detail.projectName,
        businessCode: detail.businessCode,
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

    const [versions, settlements, payments] = await Promise.all([
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
      ...payments.map((payment) => payment.projectId)
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
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const instances = await this.prisma.approvalInstance.findMany({
      where: {
        status: "in_progress",
        businessType: { in: [...RELEVANT_APPROVAL_TYPES] }
      }
    });
    const businessProjectIds = await this.approvalBusinessProjectIds(instances);
    const counts = { contract: 0, settlement: 0, payment: 0, total: 0 };

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
      if (
        !currentNode ||
        (!this.canActOnApprovalNode(currentNode, roleKeys, userId) &&
          !(await this.hasDelegatedApprovalTodo(userId, projectId, currentNode)))
      ) {
        continue;
      }

      if (instance.businessType === "contract_version") counts.contract += 1;
      if (instance.businessType === "settlement") counts.settlement += 1;
      if (instance.businessType === "payment_request") counts.payment += 1;
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

    const [versions, settlements, payments] = await Promise.all([
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
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    const pendingRoleKeys = this.stringArray(node.roleKeys).filter(
      (role) => !approvedRoleKeys.has(role)
    );
    const hasRoleTodo = pendingRoleKeys.some((role) => roleKeys.includes(role as RoleKey));
    const assignments = Array.isArray(node.assignments)
      ? (node.assignments as ApprovalAssignment[])
      : [];
    const hasAssignmentTodo = assignments.some(
      (assignment) =>
        assignment.toUserId === userId &&
        typeof assignment.fromRoleKey === "string" &&
        !approvedRoleKeys.has(assignment.fromRoleKey)
    );

    return hasRoleTodo || hasAssignmentTodo;
  }

  private hasAssignmentTodo(node: ApprovalNode, userId: string) {
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    const assignments = Array.isArray(node.assignments)
      ? (node.assignments as ApprovalAssignment[])
      : [];
    return assignments.some(
      (assignment) =>
        assignment.toUserId === userId &&
        typeof assignment.fromRoleKey === "string" &&
        !approvedRoleKeys.has(assignment.fromRoleKey)
    );
  }

  private pendingRoleKeys(node: ApprovalNode): RoleKey[] {
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    return this.stringArray(node.roleKeys)
      .filter((role) => !approvedRoleKeys.has(role))
      .map((role) => role as RoleKey);
  }

  private async hasDelegatedApprovalTodo(
    userId: string,
    projectId: string,
    node: ApprovalNode
  ): Promise<boolean> {
    const nodeRoleKeys = this.pendingRoleKeys(node);
    if (!nodeRoleKeys.length) {
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
        toUserId: userId,
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gte: now }
      },
      select: { fromUserId: true }
    });

    for (const delegation of delegations) {
      const delegatorRoleKeys = await this.roleKeysForUserProject(delegation.fromUserId, projectId);
      if (nodeRoleKeys.some((role) => delegatorRoleKeys.includes(role))) {
        return true;
      }
    }

    return false;
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

  private amountText(amountCents: number | bigint) {
    const safeCents =
      typeof amountCents === "bigint" ? centsToSafeNumber(amountCents) : amountCents;
    return `¥${(safeCents / 100).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
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

  private approvalTargetPath(counts: { contract: number; settlement: number; payment: number }) {
    if (counts.payment > 0) return "/付款管理";
    if (counts.settlement > 0) return "/结算管理";
    return "/合同管理";
  }
}
