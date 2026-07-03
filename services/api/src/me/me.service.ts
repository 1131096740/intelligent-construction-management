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

interface ProjectRoleScope {
  projectId: string;
  roleKeys: RoleKey[];
}

interface ApprovalNode {
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
      const roleKeys = projectId ? roleKeysByProject.get(projectId) : undefined;
      if (!roleKeys) {
        continue;
      }

      const currentNode = this.currentApprovalNode(
        instance.frozenNodes,
        instance.currentNodeIndex
      );
      if (!currentNode || !this.canActOnApprovalNode(currentNode, roleKeys, userId)) {
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

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private approvalTargetPath(counts: { contract: number; settlement: number; payment: number }) {
    if (counts.payment > 0) return "/付款管理";
    if (counts.settlement > 0) return "/结算管理";
    return "/合同管理";
  }
}
