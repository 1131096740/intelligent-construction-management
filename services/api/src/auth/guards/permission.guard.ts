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
import { PrismaService } from "../../database/prisma.service";
import type { AuthenticatedRequest } from "../auth.types";
import { REQUIRED_POSITIONS_KEY } from "../decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../decorators/require-project-role.decorator";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
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
    const roleScopes = await this.loadRoleScopes(request.user.id, projectId);
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
      if (!canPerform(requiredAction, effectiveRoleKeys)) {
        const delegatedApprovalAllowed =
          projectId &&
          this.isDelegatedApprovalAction(requiredAction) &&
          (await this.hasDelegatedProjectActionRole(request.user.id, projectId, requiredAction));
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

  private async loadRoleScopes(userId: string, projectId?: string) {
    const [globalPositions, userProjectPositions, projectMemberPositions] = await Promise.all([
      this.prisma.userPosition.findMany({
        where: { userId, projectId: null }
      }),
      projectId
        ? this.prisma.userPosition.findMany({
            where: { userId, projectId }
          })
        : Promise.resolve([]),
      projectId
        ? this.prisma.projectMember.findMany({
            where: { userId, projectId }
          })
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
      const procurement = await this.prisma.spotProcurement.findUnique({
        where: { id: procurementId },
        select: { projectId: true }
      });

      return procurement?.projectId;
    }

    const paymentId = request.params?.paymentId;
    if (paymentId) {
      const spotPaymentClient = this.prisma as typeof this.prisma & {
        spotProcurementPayment?: {
          findUnique(args: {
            where: { id: string };
            select: { projectId: true };
          }): Promise<{ projectId: string } | null>;
        };
      };
      const spotPayment =
        await spotPaymentClient.spotProcurementPayment?.findUnique({
          where: { id: paymentId },
          select: { projectId: true }
        });
      if (spotPayment) {
        return spotPayment.projectId;
      }
      const payment = await this.prisma.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] },
        select: { projectId: true }
      });

      return payment?.projectId;
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
