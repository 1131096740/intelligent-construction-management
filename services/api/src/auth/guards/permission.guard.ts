import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ACTION_REQUIRED_ROLES,
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type RoleKey
} from "@jiangkong/shared-domain";
import {
  activeApprovalDelegatorIds,
  type ActiveApprovalDelegationClient
} from "../../approval/active-approval-delegations";
import {
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  type FrozenApprovalNode
} from "../../approval/approval-review-identity";
import { PrismaService } from "../../database/prisma.service";
import { SpotProcurementAccessService } from "../../spot-procurement/spot-procurement-access.service";
import type { AuthenticatedRequest } from "../auth.types";
import { REQUIRED_POSITIONS_KEY } from "../decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../decorators/require-project-role.decorator";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly spotAccess: SpotProcurementAccessService =
      new SpotProcurementAccessService(prisma)
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPositions = this.reflector.getAllAndOverride<RoleKey[]>(
      REQUIRED_POSITIONS_KEY,
      [context.getHandler(), context.getClass()]
    );
    const requiredAction = this.reflector.getAllAndOverride<BusinessAction>(
      REQUIRED_PROJECT_ACTION_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPositions?.length && !requiredAction) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new ForbiddenException("未获取到登录用户，请重新登录");
    }

    const projectId = await this.extractProjectId(request);
    const includeAnyProjectRole = !projectId && Boolean(requiredPositions?.length) && !requiredAction;
    const roleScopes = await this.loadRoleScopes(
      request.user.id,
      projectId,
      includeAnyProjectRole
    );
    const effectiveRoleKeys = resolveEffectiveRoleKeys(
      roleScopes.globalRoleKeys,
      roleScopes.projectRoleKeys
    );

    if (requiredPositions?.length) {
      const allowed = requiredPositions.some((position) =>
        position === "super_admin"
          ? roleScopes.globalRoleKeys.includes(position)
          : effectiveRoleKeys.includes(position)
      );

      if (!allowed) {
        throw new ForbiddenException("当前账号缺少执行该操作所需的岗位权限");
      }
    }

    if (requiredAction) {
      const governedApprovalAccess = this.isDelegatedApprovalAction(requiredAction)
        ? await this.governedApprovalAccess(
            request,
            request.user.id,
            effectiveRoleKeys,
            projectId
          )
        : null;
      if (governedApprovalAccess === false) {
        throw new ForbiddenException("当前账号不是该审批节点冻结的处理人");
      }
      if (!canPerform(requiredAction, effectiveRoleKeys)) {
        const delegatedApprovalAllowed =
          governedApprovalAccess === true ||
          (projectId &&
            this.isDelegatedApprovalAction(requiredAction) &&
            (await this.hasDelegatedProjectActionRole(request.user.id, projectId, requiredAction)));
        if (!delegatedApprovalAllowed) {
          throw new ForbiddenException("当前账号缺少执行该项目操作所需的岗位权限");
        }
      }

      if (
        requiredAction === "project_expense.create" &&
        projectId &&
        !this.hasProjectScopedActionRole(requiredAction, roleScopes)
      ) {
        throw new ForbiddenException("当前账号缺少执行该项目操作所需的岗位权限");
      }
    }

    return true;
  }

  async loadEffectiveRoleKeys(userId: string, projectId?: string): Promise<RoleKey[]> {
    const roleScopes = await this.loadRoleScopes(userId, projectId);
    return resolveEffectiveRoleKeys(roleScopes.globalRoleKeys, roleScopes.projectRoleKeys);
  }

  private async loadRoleScopes(
    userId: string,
    projectId?: string,
    includeAnyProjectRole = false
  ) {
    const [globalPositions, userProjectPositions, projectMemberPositions] = await Promise.all([
      this.prisma.userPosition.findMany({
        where: { userId, projectId: null }
      }),
      projectId
        ? this.prisma.userPosition.findMany({
            where: { userId, projectId }
          })
        : includeAnyProjectRole
          ? this.prisma.userPosition.findMany({
              where: { userId, projectId: { not: null } }
            })
        : Promise.resolve([]),
      projectId
        ? this.prisma.projectMember.findMany({
            where: { userId, projectId }
          })
        : includeAnyProjectRole
          ? this.prisma.projectMember.findMany({ where: { userId } })
        : Promise.resolve([])
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...userProjectPositions].map((position) => position.positionId))
    );
    const positions = await this.prisma.position.findMany({
      where: { id: { in: positionIds } }
    });
    const globalRoleKeys = positions
      .filter((position) =>
        globalPositions.some((userPosition) => userPosition.positionId === position.id)
      )
      .map((position) => position.key as RoleKey);
    const projectRoleKeys = [
      ...positions
        .filter((position) =>
          userProjectPositions.some((userPosition) => userPosition.positionId === position.id)
        )
        .map((position) => position.key as RoleKey),
      ...projectMemberPositions.map((position) => position.positionKey as RoleKey)
    ];

    return { globalRoleKeys, projectRoleKeys };
  }

  private hasProjectScopedActionRole(
    action: BusinessAction,
    roleScopes: { globalRoleKeys: RoleKey[]; projectRoleKeys: RoleKey[] }
  ) {
    const requiredRoles = ACTION_REQUIRED_ROLES[action];
    return (
      roleScopes.projectRoleKeys.some((role) => requiredRoles.includes(role)) ||
      roleScopes.globalRoleKeys.some((role) => role !== "employee" && requiredRoles.includes(role))
    );
  }

  private isDelegatedApprovalAction(action: BusinessAction) {
    return action === "contract.approve" || action === "settlement.approve" || action === "payment.approve";
  }

  private async governedApprovalAccess(
    request: AuthenticatedRequest,
    userId: string,
    roleKeys: RoleKey[],
    projectId?: string
  ): Promise<boolean | null> {
    const target = request.params?.contractVersionId
      ? { businessType: "contract_version", businessId: request.params.contractVersionId }
      : request.params?.settlementId
        ? { businessType: "settlement", businessId: request.params.settlementId }
        : request.params?.paymentId
          ? await this.resolvePaymentApprovalTarget(request.params.paymentId)
          : null;
    if (!target) return null;
    const approvalClient = this.prisma as unknown as {
      approvalInstance?: {
        findFirst(input: unknown): Promise<{
          frozenNodes: unknown;
          currentNodeIndex: number;
        } | null>;
      };
    };
    if (!approvalClient.approvalInstance) return null;
    const instance = await approvalClient.approvalInstance.findFirst({
      where: {
        businessType: target.businessType,
        businessId: target.businessId,
        status: "in_progress"
      },
      orderBy: { createdAt: "desc" },
      select: { frozenNodes: true, currentNodeIndex: true }
    });
    if (!instance || !Array.isArray(instance.frozenNodes)) return null;
    const node = instance.frozenNodes[instance.currentNodeIndex] as FrozenApprovalNode | undefined;
    if (!node || !isGovernedFrozenApprovalNode(node)) return null;

    const delegationClient = this.prisma as Partial<ActiveApprovalDelegationClient>;
    const delegatorIds = delegationClient.approvalDelegation && delegationClient.user
      ? await activeApprovalDelegatorIds(delegationClient as ActiveApprovalDelegationClient, userId)
      : [];
    const activeDelegators = projectId
      ? await Promise.all(delegatorIds.map(async (delegatorId) => ({
          userId: delegatorId,
          roleKeys: await this.loadEffectiveRoleKeys(delegatorId, projectId)
        })))
      : [];
    return Boolean(resolveApprovalReviewIdentity({
      node,
      actorUserId: userId,
      actorRoleKeys: roleKeys,
      activeDelegators
    }));
  }

  private async resolvePaymentApprovalTarget(paymentId: string) {
    const payment = await this.prisma.paymentRequest.findFirst({
      where: { OR: [{ id: paymentId }, { code: paymentId }] },
      select: { id: true }
    });
    return payment ? { businessType: "payment_request", businessId: payment.id } : null;
  }

  private async hasDelegatedProjectActionRole(
    userId: string,
    projectId: string,
    action: BusinessAction
  ) {
    const delegationClient = this.prisma as Partial<ActiveApprovalDelegationClient>;
    if (!delegationClient.approvalDelegation || !delegationClient.user) return false;
    const delegatorIds = await activeApprovalDelegatorIds(
      delegationClient as ActiveApprovalDelegationClient,
      userId
    );
    for (const delegatorId of delegatorIds) {
      const scopes = await this.loadRoleScopes(delegatorId, projectId);
      const roleKeys = resolveEffectiveRoleKeys(scopes.globalRoleKeys, scopes.projectRoleKeys);
      if (canPerform(action, roleKeys)) {
        return true;
      }
    }

    return false;
  }

  private async extractProjectId(request: AuthenticatedRequest) {
    const procurementId = request.params?.procurementId;
    if (procurementId) {
      return this.spotAccess.requireProcurementProjectId(procurementId);
    }

    const procurementPaymentId = request.params?.procurementPaymentId;
    if (procurementPaymentId) {
      return this.spotAccess.requirePaymentProjectId(procurementPaymentId);
    }

    const receiptId = request.params?.receiptId;
    if (receiptId) {
      return this.spotAccess.requireReceiptProjectId(receiptId);
    }

    const allocationId = request.params?.allocationId;
    if (allocationId) {
      return this.spotAccess.requireInvoiceAllocationProjectId(allocationId);
    }

    const paymentId = request.params?.paymentId;
    if (paymentId) {
      const spotProjectId = await this.spotAccess.findPaymentProjectId(paymentId);
      if (spotProjectId) return spotProjectId;
      const payment = await this.prisma.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] },
        select: { projectId: true }
      });

      if (!payment) {
        throw new ForbiddenException("付款资源不存在或当前账号无权访问");
      }
      return payment.projectId;
    }

    const settlementIdFromParams = request.params?.settlementId;
    if (settlementIdFromParams) {
      const settlement = await this.prisma.settlement.findFirst({
        where: { OR: [{ id: settlementIdFromParams }, { code: settlementIdFromParams }] },
        select: { projectId: true }
      });

      return settlement?.projectId;
    }

    const contractVersionIdFromParams = request.params?.contractVersionId;
    if (contractVersionIdFromParams) {
      return this.extractProjectIdFromContractVersion(contractVersionIdFromParams);
    }

    const contractIdFromParams = request.params?.contractId;
    if (contractIdFromParams) {
      const contract = await this.prisma.contract.findFirst({
        where: { OR: [{ id: contractIdFromParams }, { code: contractIdFromParams }] },
        select: { projectId: true }
      });

      return contract?.projectId;
    }

    const projectIdFromParams = request.params?.projectId;
    if (projectIdFromParams) {
      return projectIdFromParams;
    }

    const contractLevelPaymentVersionId =
      ["contract_advance", "contract_due"].includes(String(request.body?.sourceType)) &&
      typeof request.body?.contractVersionId === "string"
        ? request.body.contractVersionId
        : undefined;
    if (contractLevelPaymentVersionId) {
      return this.extractProjectIdFromContractVersion(contractLevelPaymentVersionId);
    }

    const settlementIdFromBody =
      typeof request.body?.settlementId === "string" ? request.body.settlementId : undefined;
    if (settlementIdFromBody) {
      const settlement = await this.prisma.settlement.findFirst({
        where: { OR: [{ id: settlementIdFromBody }, { code: settlementIdFromBody }] },
        select: { projectId: true }
      });

      return settlement?.projectId;
    }

    const contractVersionId =
      (typeof request.body?.contractVersionId === "string"
        ? request.body.contractVersionId
        : undefined) ??
      (typeof request.query?.contractVersionId === "string"
        ? request.query.contractVersionId
        : undefined);
    if (contractVersionId) {
      return this.extractProjectIdFromContractVersion(contractVersionId);
    }

    const fromQuery = request.query?.projectId;
    const fromBody =
      typeof request.body?.projectId === "string" ? request.body.projectId : undefined;

    if (fromBody ?? fromQuery) {
      return fromBody ?? fromQuery;
    }

    return undefined;
  }

  private async extractProjectIdFromContractVersion(contractVersionId: string) {
    const contractVersion = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: { contractId: true }
    });
    if (!contractVersion) {
      return undefined;
    }
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractVersion.contractId },
      select: { projectId: true }
    });

    return contract?.projectId;
  }
}
