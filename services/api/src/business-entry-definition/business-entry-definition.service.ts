import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  BusinessEntryDefinitionError,
  BusinessEntryDraftValidationError,
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessEntryDefinitionRegistry,
  type BusinessEntryDraftPayload,
  type BusinessEntryFrozenSnapshot,
  type BusinessEntryOperation,
  type BusinessEntrySceneDefinition,
  type BusinessEntrySubmissionTarget,
  type BusinessEntryValidationResult,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import {
  BUSINESS_ENTRY_SNAPSHOT_STORE,
  BusinessEntrySnapshotConflictError,
  type BusinessEntrySnapshotStore
} from "./business-entry-definition.snapshot-store";
import {
  BUSINESS_ENTRY_SCENE_ACCESS_REGISTRY,
  type BusinessEntrySceneAccessPolicy,
  type BusinessEntrySceneAccessRegistry,
  type BusinessEntryScenePermission
} from "./business-entry-scene-access";

export const BUSINESS_ENTRY_DEFINITION_REGISTRY = Symbol(
  "BUSINESS_ENTRY_DEFINITION_REGISTRY"
);

export interface BusinessEntryDraftRequest {
  definitionVersion?: number;
  expectedRevision?: number;
  target?: BusinessEntrySubmissionTarget;
  values: Record<string, unknown>;
  operation?: BusinessEntryOperation;
}

export interface BusinessEntryRoleResolver {
  effectiveRoleScopes(userId: string, projectId: string): Promise<{
    globalRoleKeys: RoleKey[];
    projectRoleKeys: RoleKey[];
  }>;
}

@Injectable()
export class BusinessEntryDefinitionService {
  constructor(
    @Inject(BUSINESS_ENTRY_DEFINITION_REGISTRY)
    private readonly registry: BusinessEntryDefinitionRegistry,
    @Inject(BUSINESS_ENTRY_SCENE_ACCESS_REGISTRY)
    private readonly accessRegistry: BusinessEntrySceneAccessRegistry,
    @Inject(ProjectVisibilityService)
    private readonly visibility: BusinessEntryRoleResolver,
    @Inject(BUSINESS_ENTRY_SNAPSHOT_STORE)
    private readonly snapshots: BusinessEntrySnapshotStore,
    private readonly prisma: PrismaService
  ) {}

  async getSceneDefinition(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string
  ): Promise<BusinessEntrySceneDefinition> {
    return this.getSceneDefinitionForOperation(sceneKey, projectId, actorUserId, "view");
  }

  async getSceneDefinitionForOperation(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    operation: BusinessEntryOperation
  ): Promise<BusinessEntrySceneDefinition> {
    const { roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    try {
      return this.registry.getSceneDefinitionForRoles(sceneKey, roleKeys, operation);
    } catch (error) {
      this.rethrowDefinitionError(error);
    }
  }

  async validateDraft(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    input: BusinessEntryDraftRequest
  ): Promise<BusinessEntryValidationResult> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    return this.validateDraftWithAuthorizedRoles(sceneKey, projectId, access, roleKeys, input);
  }

  async validateDraftWithRoles(
    sceneKey: string,
    projectId: string | undefined,
    roleKeys: readonly RoleKey[],
    input: BusinessEntryDraftRequest
  ): Promise<BusinessEntryValidationResult> {
    const access = this.registeredAccess(sceneKey);
    this.assertPermission(access.permission, roleKeys);
    return this.validateDraftWithAuthorizedRoles(sceneKey, projectId, access, roleKeys, input);
  }

  async validateDraftBatch(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    inputs: readonly BusinessEntryDraftRequest[]
  ): Promise<BusinessEntryValidationResult[]> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    return Promise.all(inputs.map((input) =>
      this.validateDraftWithAuthorizedRoles(sceneKey, projectId, access, roleKeys, input)
    ));
  }

  async freezeSubmissionSnapshot(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    input: BusinessEntryDraftRequest,
    frozenAt?: string
  ): Promise<BusinessEntryFrozenSnapshot> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    const payload = this.payload(sceneKey, input);
    await this.assertTargetScope(projectId, access, payload.target);
    const operation = input.operation ?? "edit";
    if (operation !== "edit" && operation !== "import") {
      throw new BadRequestException("正式提交只允许录入或受控导入");
    }
    try {
      const snapshot = this.registry.freezeSubmissionSnapshot(
        payload,
        roleKeys,
        { frozenAt, operation }
      );
      // Global owning domains persist this immutable snapshot in their own transaction.
      // The existing snapshot store is deliberately project-bound; POL-19P1 does not widen it.
      if (access.target.scope === "global") return snapshot;
      return await this.snapshots.save(projectId!, actorUserId, snapshot, input.expectedRevision);
    } catch (error) {
      if (error instanceof BusinessEntryDraftValidationError) {
        throw new BadRequestException({
          message: "草稿未通过业务字段校验",
          errors: error.result.errors
        });
      }
      if (error instanceof BusinessEntrySnapshotConflictError) throw error;
      this.rethrowDefinitionError(error);
    }
  }

  private payload(sceneKey: string, input: BusinessEntryDraftRequest): BusinessEntryDraftPayload {
    return {
      sceneKey,
      definitionVersion: input.definitionVersion,
      expectedRevision: input.expectedRevision,
      target: input.target,
      values: input.values
    };
  }

  private async validateDraftWithAuthorizedRoles(
    sceneKey: string,
    projectId: string | undefined,
    access: BusinessEntrySceneAccessPolicy,
    roleKeys: readonly RoleKey[],
    input: BusinessEntryDraftRequest
  ) {
    const payload = this.payload(sceneKey, input);
    await this.assertTargetScope(projectId, access, payload.target);
    return this.registry.validateDraft(payload, roleKeys, input.operation ?? "edit");
  }

  private async authorizeScene(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string
  ) {
    const access = this.registeredAccess(sceneKey);
    if (!actorUserId?.trim()) throw new BadRequestException("未获取到登录用户");
    let roleKeys: readonly RoleKey[];

    if (access.target.scope === "global") {
      if (projectId?.trim()) throw new BadRequestException("全局业务场景不得携带项目上下文");
      roleKeys = await this.loadGlobalRoleKeys(actorUserId);
    } else {
      if (!projectId?.trim()) throw new BadRequestException("请选择项目");
      await this.assertActiveProject(projectId);
      const scopes = await this.visibility.effectiveRoleScopes(actorUserId, projectId);
      roleKeys = access.permission.roleScope === "project"
        ? scopes.projectRoleKeys
        : resolveEffectiveRoleKeys(scopes.globalRoleKeys, scopes.projectRoleKeys);
    }

    this.assertPermission(access.permission, roleKeys);
    return { access, roleKeys };
  }

  private async assertActiveProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
  }

  private async loadGlobalRoleKeys(actorUserId: string): Promise<RoleKey[]> {
    const assignments = await this.prisma.userPosition.findMany({
      where: { userId: actorUserId, projectId: null },
      select: { positionId: true }
    });
    if (!assignments.length) return [];
    const positions = await this.prisma.position.findMany({
      where: { id: { in: assignments.map((assignment) => assignment.positionId) } },
      select: { key: true }
    });
    return positions.map((position) => position.key as RoleKey);
  }

  private registeredAccess(sceneKey: string) {
    try {
      this.registry.getSceneDefinition(sceneKey);
      return this.accessRegistry.get(sceneKey);
    } catch (error) {
      this.rethrowDefinitionError(error);
    }
  }

  private assertPermission(
    permission: BusinessEntryScenePermission,
    roleKeys: readonly RoleKey[]
  ) {
    const allowed = permission.kind === "business_action"
      ? canPerform(permission.action, roleKeys)
      : roleKeys.some((roleKey) => permission.roleKeys.includes(roleKey));
    if (!allowed) throw new ForbiddenException("当前岗位无权使用该业务场景");
  }

  private async assertTargetScope(
    projectId: string | undefined,
    access: BusinessEntrySceneAccessPolicy,
    target: BusinessEntrySubmissionTarget | undefined
  ) {
    if (access.target.scope === "global" && projectId?.trim()) {
      throw new BadRequestException("全局业务场景不得携带项目上下文");
    }
    if (access.target.scope === "project" && !projectId?.trim()) {
      throw new BadRequestException("请选择项目");
    }
    if (
      typeof target?.entityType !== "string" ||
      typeof target.entityId !== "string" ||
      !target.entityType.trim() ||
      !target.entityId.trim()
    ) {
      throw new BadRequestException("提交必须绑定正式业务对象");
    }
    if (target.entityType !== access.target.entityType) {
      throw new BadRequestException("提交对象类型与业务场景不匹配");
    }
    if (access.target.scope === "project" && target.entityId !== projectId) {
      throw new BadRequestException("提交对象不属于当前项目");
    }
    if (
      access.target.scope === "global" &&
      !await access.target.resolve!({ target, prisma: this.prisma })
    ) {
      throw new BadRequestException("提交对象不存在或不属于当前业务范围");
    }
  }

  private rethrowDefinitionError(error: unknown): never {
    if (error instanceof BusinessEntryDefinitionError) {
      if (error.code === "unknown_scene") throw new NotFoundException(error.message);
      if (error.code === "permission_denied") throw new ForbiddenException(error.message);
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
