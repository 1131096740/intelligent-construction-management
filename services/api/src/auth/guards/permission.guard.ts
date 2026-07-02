import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type RoleKey
} from "@jiangkong/shared-domain";
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
      throw new ForbiddenException("Authenticated user is required");
    }

    const projectId = await this.extractProjectId(request);
    const effectiveRoleKeys = await this.loadEffectiveRoleKeys(request.user.id, projectId);

    if (requiredPositions?.length) {
      const allowed = requiredPositions.some((position) => effectiveRoleKeys.includes(position));

      if (!allowed) {
        throw new ForbiddenException("Missing required position");
      }
    }

    if (requiredAction && !canPerform(requiredAction, effectiveRoleKeys)) {
      throw new ForbiddenException("Missing required project role");
    }

    return true;
  }

  async loadEffectiveRoleKeys(userId: string, projectId?: string): Promise<RoleKey[]> {
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

    return resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys);
  }

  private async extractProjectId(request: AuthenticatedRequest) {
    const paymentId = request.params?.paymentId;
    if (paymentId) {
      const payment = await this.prisma.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] },
        select: { projectId: true }
      });

      return payment?.projectId;
    }

    const settlementId =
      request.params?.settlementId ??
      (typeof request.body?.settlementId === "string" ? request.body.settlementId : undefined);
    if (settlementId) {
      const settlement = await this.prisma.settlement.findFirst({
        where: { OR: [{ id: settlementId }, { code: settlementId }] },
        select: { projectId: true }
      });

      return settlement?.projectId;
    }

    const contractVersionId =
      request.params?.contractVersionId ??
      (typeof request.body?.contractVersionId === "string"
        ? request.body.contractVersionId
        : undefined);
    if (contractVersionId) {
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

    const contractId = request.params?.contractId;
    if (contractId) {
      const contract = await this.prisma.contract.findFirst({
        where: { OR: [{ id: contractId }, { code: contractId }] },
        select: { projectId: true }
      });

      return contract?.projectId;
    }

    const fromParams = request.params?.projectId;
    const fromQuery = request.query?.projectId;
    const fromBody =
      typeof request.body?.projectId === "string" ? request.body.projectId : undefined;

    if (fromParams ?? fromQuery ?? fromBody) {
      return fromParams ?? fromQuery ?? fromBody;
    }

    return undefined;
  }
}
