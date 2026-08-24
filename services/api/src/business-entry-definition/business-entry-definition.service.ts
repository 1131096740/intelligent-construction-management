import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BusinessEntryDefinitionError,
  BusinessEntryDraftValidationError,
  BUSINESS_ENTRY_AUTHENTICATED_SELF,
  canPerform,
  isBusinessEntryCreateTarget,
  isBusinessEntryExistingTarget,
  resolveEffectiveRoleKeys,
  ROLE_KEYS,
  type BusinessEntryDefinitionRegistry,
  type BusinessEntryDraftPayload,
  type BusinessEntryFrozenSnapshot,
  type BusinessEntryOperation,
  type BusinessEntryPermissionKey,
  type BusinessEntrySceneDefinition,
  type BusinessEntrySubmissionTarget,
  type BusinessEntryValidationResult,
  type RoleKey
} from "@jiangkong/shared-domain";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
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
import { BusinessEntryCreateTargetService } from "./business-entry-create-target.service";
import { BusinessEntrySceneAuthorizationService } from "./business-entry-scene-authorization.service";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";

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
    private readonly prisma: PrismaService,
    private readonly authorization: BusinessEntrySceneAuthorizationService,
    @Optional() private readonly createTargets?: BusinessEntryCreateTargetService,
    @Optional() private readonly companyRoles?: CompanyRoleResolverService,
    @Optional() private readonly writeFreeze?: OperationalWriteFreezeService
  ) {}

  async getSceneDefinition(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    target: BusinessEntrySubmissionTarget
  ): Promise<BusinessEntrySceneDefinition> {
    return this.getSceneDefinitionForOperation(
      sceneKey,
      projectId,
      actorUserId,
      "view",
      target
    );
  }

  async getSceneDefinitionForOperation(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    operation: BusinessEntryOperation,
    target: BusinessEntrySubmissionTarget
  ): Promise<BusinessEntrySceneDefinition> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    await this.assertTargetScope(
      sceneKey,
      projectId,
      actorUserId,
      access,
      target,
      operation
    );
    try {
      return this.registry.getSceneDefinitionForRoles(
        sceneKey,
        roleKeys as readonly RoleKey[],
        operation
      );
    } catch (error) {
      this.rethrowDefinitionError(error);
    }
  }

  async getSceneDefinitionForCapability(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    operation: BusinessEntryOperation = "edit"
  ): Promise<BusinessEntrySceneDefinition> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    if (access.target.scope !== "global") {
      throw new BadRequestException("创建能力探针仅适用于全局业务场景");
    }
    try {
      return this.registry.getSceneDefinitionForRoles(
        sceneKey,
        roleKeys as readonly RoleKey[],
        operation
      );
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
    return this.validateDraftWithAuthorizedRoles(
      sceneKey,
      projectId,
      access,
      roleKeys,
      actorUserId,
      input
    );
  }

  async validateDraftWithRoles(
    sceneKey: string,
    projectId: string | undefined,
    roleKeys: readonly RoleKey[],
    input: BusinessEntryDraftRequest
  ): Promise<BusinessEntryValidationResult> {
    this.requireAuthorization();
    const access = this.registeredAccess(sceneKey);
    this.assertPermission(access.permission, roleKeys);
    return this.validateDraftWithAuthorizedRoles(
      sceneKey,
      projectId,
      access,
      roleKeys,
      "role-validation",
      input
    );
  }

  async validateDraftBatch(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    inputs: readonly BusinessEntryDraftRequest[]
  ): Promise<BusinessEntryValidationResult[]> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    return Promise.all(inputs.map((input) =>
      this.validateDraftWithAuthorizedRoles(
        sceneKey,
        projectId,
        access,
        roleKeys as readonly RoleKey[],
        actorUserId,
        input
      )
    ));
  }

  async issueCreateTarget(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    entityType: string,
    intent?: {
      idempotencyKey?: string;
      fingerprint?: string;
      definitionKey?: string;
      definitionVersion?: number;
    }
  ) {
    const { access } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    if (entityType !== access.target.entityType) {
      throw new BadRequestException("新建目标类型与业务场景不匹配");
    }
    if (sceneKey === "user_role_assignment_command" || sceneKey === "user_self_profile") {
      throw new BadRequestException("该业务场景必须绑定已存在的目标用户");
    }
    if (!this.createTargets) {
      throw new BadRequestException("新建目标令牌服务未启用");
    }
    const definition = this.registry.getSceneDefinition(sceneKey);
    const action = sceneKey === "business_party" ? "business_party.create" : undefined;
    if (action) {
      (this.writeFreeze ?? new OperationalWriteFreezeService()).assertCanWrite("master_data");
      const verifiedIntent = intent;
      if (
        !verifiedIntent?.idempotencyKey ||
        !verifiedIntent.fingerprint ||
        verifiedIntent.definitionKey !== definition.key ||
        verifiedIntent.definitionVersion !== definition.version
      ) {
        throw new BadRequestException("合作单位创建意图参数不完整，请刷新后重试");
      }
      intent = verifiedIntent;
    }
    if (access.target.scope !== "global") {
      throw new BadRequestException("项目业务场景暂不允许使用新建目标令牌");
    }
    const issued = this.createTargets.issue({
      actorUserId,
      scene: sceneKey,
      entityType,
      scope: access.target.scope,
      ...(action ? {
        action,
        definitionKey: definition.key,
        definitionVersion: definition.version,
        idempotencyKey: intent!.idempotencyKey,
        fingerprint: intent!.fingerprint
      } : {})
    });
    await this.authorization.assertAuthorized({
      sceneKey,
      actorUserId,
      projectId,
      operation: "edit",
      scope: access.target.scope,
      target: { entityType, createTarget: issued.createTarget },
      values: {}
    });
    return {
      ...issued,
      entityType,
      scope: access.target.scope
    };
  }

  async freezeSubmissionSnapshot(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    input: BusinessEntryDraftRequest,
    frozenAt?: string
  ): Promise<BusinessEntryFrozenSnapshot> {
    return this.freezeSubmissionSnapshotWithPersistence(
      undefined,
      sceneKey,
      projectId,
      actorUserId,
      input,
      frozenAt
    );
  }

  async freezeSubmissionSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    input: BusinessEntryDraftRequest,
    frozenAt?: string
  ): Promise<BusinessEntryFrozenSnapshot> {
    return this.freezeSubmissionSnapshotWithPersistence(
      tx,
      sceneKey,
      projectId,
      actorUserId,
      input,
      frozenAt
    );
  }

  private async freezeSubmissionSnapshotWithPersistence(
    tx: Prisma.TransactionClient | undefined,
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    input: BusinessEntryDraftRequest,
    frozenAt?: string
  ): Promise<BusinessEntryFrozenSnapshot> {
    const { access, roleKeys } = await this.authorizeScene(sceneKey, projectId, actorUserId);
    const payload = this.payload(sceneKey, input);
    await this.assertTargetScope(sceneKey, projectId, actorUserId, access, payload.target, input.operation ?? "edit");
    const operation = input.operation ?? "edit";
    if (operation !== "edit" && operation !== "import") {
      throw new BadRequestException("正式提交只允许录入或受控导入");
    }
    await this.authorization.assertAuthorized({
      sceneKey,
      actorUserId,
      projectId,
      operation,
      scope: access.target.scope,
      target: payload.target!,
      values: input.values
    });
    try {
      const snapshot = this.registry.freezeSubmissionSnapshot(
        payload,
        roleKeys as readonly RoleKey[],
        { frozenAt, operation }
      );
      // Global owning domains persist this immutable snapshot in their own transaction.
      // The project-bound store cannot satisfy that contract, so the joined API must fail closed.
      if (access.target.scope === "global") {
        throw new BadRequestException(
          "全局业务场景须由所属领域在同一事务中持久化正式快照"
        );
      }
      if (tx) {
        return await this.snapshots.saveInTransaction(
          tx,
          projectId!,
          actorUserId,
          snapshot,
          input.expectedRevision
        );
      }
      return await this.snapshots.saveStandalone(
        projectId!,
        actorUserId,
        snapshot,
        input.expectedRevision
      );
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
    roleKeys: readonly BusinessEntryPermissionKey[],
    actorUserId: string,
    input: BusinessEntryDraftRequest
  ) {
    const payload = this.payload(sceneKey, input);
    await this.assertTargetScope(
      sceneKey,
      projectId,
      actorUserId,
      access,
      payload.target,
      input.operation ?? "edit"
    );
    await this.authorization.assertAuthorized({
      sceneKey,
      actorUserId,
      projectId,
      operation: input.operation ?? "edit",
      scope: access.target.scope,
      target: payload.target!,
      values: input.values
    });
    return this.registry.validateDraft(
      payload,
      roleKeys as readonly RoleKey[],
      input.operation ?? "edit"
    );
  }

  private async authorizeScene(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string
  ) {
    this.requireAuthorization();
    const access = this.registeredAccess(sceneKey);
    if (!actorUserId?.trim()) throw new BadRequestException("未获取到登录用户");
    let roleKeys: readonly BusinessEntryPermissionKey[];

    if (access.target.scope === "global") {
      if (projectId !== undefined) throw new BadRequestException("全局业务场景不得携带项目上下文");
      roleKeys = access.permission.kind === "authenticated_self"
        ? [BUSINESS_ENTRY_AUTHENTICATED_SELF]
        : await this.loadGlobalRoleKeys(actorUserId, sceneKey);
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

  private requireAuthorization() {
    if (!this.authorization) {
      throw new BadRequestException("业务场景缺少领域授权服务");
    }
    return this.authorization;
  }

  private async assertActiveProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
  }

  private async loadGlobalRoleKeys(
    actorUserId: string,
    sceneKey: string
  ): Promise<RoleKey[]> {
    if (sceneKey === "business_party") {
      const resolver = this.companyRoles ?? new CompanyRoleResolverService(this.prisma);
      return resolver.resolveActiveRoleScopes(actorUserId);
    }
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
    roleKeys: readonly BusinessEntryPermissionKey[]
  ) {
    const domainRoleKeys = roleKeys.filter((roleKey): roleKey is RoleKey =>
      ROLE_KEYS.includes(roleKey as RoleKey)
    );
    const allowed = permission.kind === "business_action"
      ? canPerform(permission.action, domainRoleKeys)
      : permission.kind === "role_keys"
        ? domainRoleKeys.some((roleKey) => permission.roleKeys.includes(roleKey))
        : roleKeys.includes(BUSINESS_ENTRY_AUTHENTICATED_SELF);
    if (!allowed) throw new ForbiddenException("当前岗位无权使用该业务场景");
  }

  private async assertTargetScope(
    sceneKey: string,
    projectId: string | undefined,
    actorUserId: string,
    access: BusinessEntrySceneAccessPolicy,
    target: BusinessEntrySubmissionTarget | undefined,
    operation: BusinessEntryOperation
  ) {
    if (access.target.scope === "global" && projectId !== undefined) {
      throw new BadRequestException("全局业务场景不得携带项目上下文");
    }
    if (access.target.scope === "project" && !projectId?.trim()) {
      throw new BadRequestException("请选择项目");
    }
    if (
      typeof target?.entityType !== "string" ||
      !target.entityType.trim() ||
      (!isBusinessEntryExistingTarget(target) && !isBusinessEntryCreateTarget(target))
    ) {
      throw new BadRequestException("提交必须绑定正式业务对象");
    }
    if (target.entityType !== access.target.entityType) {
      throw new BadRequestException("提交对象类型与业务场景不匹配");
    }
    if (access.target.scope === "project") {
      if (!isBusinessEntryExistingTarget(target)) {
        throw new BadRequestException("项目业务场景必须绑定已存在的业务对象");
      }
      if (target.entityId !== projectId) {
        throw new BadRequestException("提交对象不属于当前项目");
      }
    }
    if (isBusinessEntryCreateTarget(target)) {
      if (access.target.scope !== "global" || !this.createTargets) {
        throw new BadRequestException("新建目标令牌仅适用于已登记的全局业务场景");
      }
      this.createTargets.verify(target.createTarget, {
        actorUserId,
        scene: sceneKey,
        entityType: access.target.entityType,
        scope: access.target.scope
      });
      return;
    }
    if (access.target.scope === "global" && !await access.target.resolve!({
      target,
      actorUserId,
      operation,
      scene: sceneKey,
      scope: access.target.scope,
      prisma: this.prisma
    })) {
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
