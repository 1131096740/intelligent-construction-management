import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { canPerform, isBusinessEntryExistingTarget, OPERATING_TAKEOVER_SCENE_DEFINITIONS, resolveEffectiveRoleKeys } from "@jiangkong/shared-domain";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import type { BusinessEntrySceneAuthorizationContext } from "../business-entry-definition/business-entry-scene-authorization.service";

/** Authorization for project-bound prechecks, not confirmation or ledger activation. */
@Injectable()
export class OperatingTakeoverEntryAccessService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService) {}

  async assertAuthorized(context: BusinessEntrySceneAuthorizationContext) {
    const scene = OPERATING_TAKEOVER_SCENE_DEFINITIONS.find(item => item.key === context.sceneKey);
    if (!scene || context.scope !== "project" || !context.projectId ||
      context.target.entityType !== "operating_takeover_row" ||
      !isBusinessEntryExistingTarget(context.target) || context.target.entityId !== context.projectId) {
      throw new BadRequestException("历史经营接管目标与当前项目不一致");
    }
    const client = context.tx ?? this.prisma;
    const project = await client.project.findUnique({ where: { id: context.projectId, isActive: true }, select: { id: true } });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    const scopes = context.tx
      ? await this.visibility.effectiveRoleScopesInTransaction(context.tx, context.actorUserId, context.projectId)
      : await this.visibility.effectiveRoleScopes(context.actorUserId, context.projectId);
    const roles = resolveEffectiveRoleKeys(scopes.globalRoleKeys, scopes.projectRoleKeys);
    // The existing batch creator may precheck a combined workbook for all
    // professions. Editing/review still uses the scene's original professions.
    const coordinatingImport = context.operation === "import" && roles.includes("contract_director");
    const sceneRoles = scene.permissions?.[context.operation] ?? [];
    if (!canPerform("operating_takeover.manage", roles) ||
      (!coordinatingImport && !roles.some(role => sceneRoles.includes(role)))) {
      throw new ForbiddenException("当前岗位无权使用该历史经营接管场景");
    }
  }
}
