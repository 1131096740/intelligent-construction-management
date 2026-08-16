import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  BusinessEntryDefinitionError,
  BusinessEntryDraftValidationError,
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
  effectiveRoleKeys(userId: string, projectId: string): Promise<readonly RoleKey[]>;
}

@Injectable()
export class BusinessEntryDefinitionService {
  constructor(
    @Inject(BUSINESS_ENTRY_DEFINITION_REGISTRY)
    private readonly registry: BusinessEntryDefinitionRegistry,
    @Inject(ProjectVisibilityService)
    private readonly visibility: BusinessEntryRoleResolver,
    @Inject(BUSINESS_ENTRY_SNAPSHOT_STORE)
    private readonly snapshots: BusinessEntrySnapshotStore,
    private readonly prisma: PrismaService
  ) {}

  async getSceneDefinition(
    sceneKey: string,
    projectId: string,
    actorUserId: string
  ): Promise<BusinessEntrySceneDefinition> {
    const roleKeys = await this.loadRoleKeys(projectId, actorUserId);
    try {
      return this.registry.getSceneDefinitionForRoles(sceneKey, roleKeys, "view");
    } catch (error) {
      this.rethrowDefinitionError(error);
    }
  }

  async validateDraft(
    sceneKey: string,
    projectId: string,
    actorUserId: string,
    input: BusinessEntryDraftRequest
  ): Promise<BusinessEntryValidationResult> {
    const roleKeys = await this.loadRoleKeys(projectId, actorUserId);
    const payload = this.payload(sceneKey, input);
    this.assertTargetProjectScope(projectId, payload.target);
    return this.registry.validateDraft(
      payload,
      roleKeys,
      input.operation ?? "edit"
    );
  }

  async freezeSubmissionSnapshot(
    sceneKey: string,
    projectId: string,
    actorUserId: string,
    input: BusinessEntryDraftRequest,
    frozenAt?: string
  ): Promise<BusinessEntryFrozenSnapshot> {
    const roleKeys = await this.loadRoleKeys(projectId, actorUserId);
    const payload = this.payload(sceneKey, input);
    this.assertTargetProjectScope(projectId, payload.target);
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
      return await this.snapshots.save(
        projectId,
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

  private async loadRoleKeys(projectId: string, actorUserId: string) {
    if (!projectId?.trim()) throw new BadRequestException("请选择项目");
    if (!actorUserId?.trim()) throw new BadRequestException("未获取到登录用户");
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    return this.visibility.effectiveRoleKeys(actorUserId, projectId);
  }

  private assertTargetProjectScope(
    projectId: string,
    target: BusinessEntrySubmissionTarget | undefined
  ) {
    if (
      typeof target?.entityType !== "string" ||
      typeof target.entityId !== "string" ||
      !target.entityType.trim() ||
      !target.entityId.trim()
    ) {
      throw new BadRequestException("提交必须绑定正式业务对象");
    }
    if (
      !(
        (target.entityType === "project" || target.entityType === "operating_takeover_row") &&
        target.entityId === projectId
      )
    ) {
      throw new BadRequestException("提交对象不属于当前项目");
    }
  }

  private rethrowDefinitionError(error: unknown): never {
    if (error instanceof BusinessEntryDefinitionError) {
      if (error.code === "unknown_scene") throw new NotFoundException(error.message);
      if (error.code === "permission_denied") throw new BadRequestException(error.message);
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
