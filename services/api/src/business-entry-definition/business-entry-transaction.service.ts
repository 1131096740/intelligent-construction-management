import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BusinessEntryDefinitionError,
  BusinessEntryDraftValidationError,
  canPerform,
  isBusinessEntryProjectOwnedTarget,
  type BusinessEntryDefinitionRegistry,
  type BusinessEntryDraftPayload,
  type BusinessEntryFrozenSnapshot
} from "@jiangkong/shared-domain";
import {
  BUSINESS_ENTRY_DEFINITION_REGISTRY
} from "./business-entry-definition.service";
import {
  BUSINESS_ENTRY_SNAPSHOT_STORE,
  type BusinessEntrySnapshotStore
} from "./business-entry-definition.snapshot-store";
import {
  BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY,
  type BusinessEntryOwnershipRecord,
  type BusinessEntryTransactionResolverContext,
  type BusinessEntryTransactionSceneRegistry
} from "./business-entry-transaction-scene-registry";

export interface BusinessEntryTransactionDraftRequest extends BusinessEntryDraftPayload {
  target: NonNullable<BusinessEntryDraftPayload["target"]>;
  operation?: "edit" | "import";
}

@Injectable()
export class BusinessEntryTransactionService {
  constructor(
    @Inject(BUSINESS_ENTRY_DEFINITION_REGISTRY)
    private readonly definitions: BusinessEntryDefinitionRegistry,
    @Inject(BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY)
    private readonly scenes: BusinessEntryTransactionSceneRegistry,
    @Inject(BUSINESS_ENTRY_SNAPSHOT_STORE)
    private readonly snapshots: BusinessEntrySnapshotStore
  ) {}

  async freezeSubmissionSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    input: BusinessEntryTransactionDraftRequest,
    frozenAt?: string
  ): Promise<BusinessEntryFrozenSnapshot> {
    const scene = this.scenes.get(input.sceneKey);
    const target = input.target;
    if (
      !isBusinessEntryProjectOwnedTarget(target) ||
      !target.projectId.trim() ||
      !target.entityType.trim() ||
      !target.entityId.trim()
    ) {
      throw new BadRequestException("事务冻结必须绑定项目归属的正式业务对象");
    }
    if (target.entityType !== scene.entityType) {
      throw new BadRequestException("正式业务对象类型与事务业务场景不匹配");
    }

    const operation = input.operation ?? "edit";
    const definition = this.registeredDefinition(input.sceneKey);
    if (definition.entityType !== scene.entityType) {
      throw new BadRequestException("事务业务场景目标类型与定义不一致");
    }

    const context: BusinessEntryTransactionResolverContext = {
      tx,
      sceneKey: input.sceneKey,
      target,
      actorUserId,
      operation,
      action: scene.action,
      values: input.values
    };
    const ownership = await scene.resolveOwnership(context);
    this.assertOwnership(ownership, target.projectId);

    const effectiveRoleKeys = await scene.resolveAuthorization(context);
    if (!canPerform(scene.action, effectiveRoleKeys)) {
      throw new ForbiddenException("当前账号无权执行事务业务场景动作");
    }

    let snapshot: BusinessEntryFrozenSnapshot;
    try {
      snapshot = this.definitions.freezeSubmissionSnapshot(
        input,
        effectiveRoleKeys,
        { frozenAt, operation }
      );
    } catch (error) {
      if (error instanceof BusinessEntryDraftValidationError) {
        throw new BadRequestException(error.result);
      }
      if (error instanceof BusinessEntryDefinitionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const stableOwnership = await scene.resolveOwnership(context);
    if (!this.sameOwnership(ownership, stableOwnership)) {
      throw new ConflictException("正式业务对象归属在冻结期间发生漂移");
    }
    this.assertOwnership(stableOwnership, target.projectId);

    return this.snapshots.saveInTransaction(
      tx,
      target.projectId,
      actorUserId,
      snapshot,
      input.expectedRevision
    );
  }

  private registeredDefinition(sceneKey: string) {
    try {
      return this.definitions.getSceneDefinition(sceneKey);
    } catch (error) {
      if (error instanceof BusinessEntryDefinitionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private assertOwnership(
    matches: readonly BusinessEntryOwnershipRecord[],
    projectId: string
  ) {
    if (matches.length === 0) {
      throw new BadRequestException("正式业务对象不存在");
    }
    if (matches.length !== 1) {
      throw new ConflictException("正式业务对象归属不唯一");
    }
    if (matches[0]!.projectId !== projectId) {
      throw new ForbiddenException("正式业务对象不属于目标项目");
    }
  }

  private sameOwnership(
    before: readonly BusinessEntryOwnershipRecord[],
    after: readonly BusinessEntryOwnershipRecord[]
  ) {
    return before.length === 1 &&
      after.length === 1 &&
      before[0]!.projectId === after[0]!.projectId;
  }
}
