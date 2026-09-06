import { ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  isBusinessEntryExistingTarget,
  isBusinessEntryProjectOwnedTarget
} from "@jiangkong/shared-domain";
import type {
  BusinessEntryFrozenSnapshot,
  BusinessEntrySceneDefinition,
  BusinessEntrySubmissionTarget
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  ProjectOperatingProfileService,
  type UpdateProjectOperatingProfileInput
} from "../project/project-operating-profile.service";

export const BUSINESS_ENTRY_SNAPSHOT_STORE = Symbol("BUSINESS_ENTRY_SNAPSHOT_STORE");

const BUSINESS_ENTRY_TARGET_REVISION_FIELDS = [
  "projectId",
  "sceneKey",
  "entityType",
  "entityId",
  "revision"
] as const;

export interface BusinessEntrySnapshotStore {
  saveStandalone(
    projectId: string,
    frozenByUserId: string,
    snapshot: BusinessEntryFrozenSnapshot,
    expectedRevision?: number
  ): Promise<BusinessEntryFrozenSnapshot>;
  saveInTransaction(
    tx: Prisma.TransactionClient,
    projectId: string,
    frozenByUserId: string,
    snapshot: BusinessEntryFrozenSnapshot,
    expectedRevision?: number
  ): Promise<BusinessEntryFrozenSnapshot>;
}

export class BusinessEntrySnapshotConflictError extends ConflictException {
  constructor() {
    super("冻结业务字段快照并发竞争未能收敛，请重试");
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshotFromRecord(record: {
  sceneKey: string;
  entityType: string;
  entityId: string;
  revision: number;
  definitionVersion: number;
  definitionSnapshot: Prisma.JsonValue;
  valuesSnapshot: Prisma.JsonValue;
  frozenAt: Date;
}, target?: BusinessEntryFrozenSnapshot["target"]): BusinessEntryFrozenSnapshot {
  return {
    sceneKey: record.sceneKey,
    target: target ?? { entityType: record.entityType, entityId: record.entityId },
    revision: record.revision,
    definitionVersion: record.definitionVersion,
    definition: record.definitionSnapshot as unknown as BusinessEntrySceneDefinition,
    values: record.valuesSnapshot as unknown as Record<string, unknown>,
    frozenAt: record.frozenAt.toISOString()
  };
}

function sameImmutableContent(
  left: BusinessEntryFrozenSnapshot,
  right: BusinessEntryFrozenSnapshot
) {
  if (!isPersistableExistingTarget(left.target) || !isPersistableExistingTarget(right.target)) {
    return false;
  }
  return (
    left.sceneKey === right.sceneKey &&
    left.target.entityType === right.target.entityType &&
    left.target.entityId === right.target.entityId &&
    left.definitionVersion === right.definitionVersion &&
    stableSerialize(left.definition) === stableSerialize(right.definition) &&
    stableSerialize(left.values) === stableSerialize(right.values)
  );
}

function isPersistableExistingTarget(
  target: BusinessEntrySubmissionTarget | undefined
): target is Extract<BusinessEntrySubmissionTarget, { entityId: string }> {
  return isBusinessEntryExistingTarget(target) || isBusinessEntryProjectOwnedTarget(target);
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (target === "BusinessEntrySubmissionSnapshot_target_revision_key") return true;
  return (
    Array.isArray(target) &&
    target.length === BUSINESS_ENTRY_TARGET_REVISION_FIELDS.length &&
    target.every((field, index) => field === BUSINESS_ENTRY_TARGET_REVISION_FIELDS[index])
  );
}

@Injectable()
export class PrismaBusinessEntrySnapshotStore implements BusinessEntrySnapshotStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly operatingProfiles?: ProjectOperatingProfileService
  ) {}

  async saveStandalone(
    projectId: string,
    frozenByUserId: string,
    snapshot: BusinessEntryFrozenSnapshot,
    expectedRevision?: number
  ): Promise<BusinessEntryFrozenSnapshot> {
    return this.saveStandaloneAttempt(
      projectId,
      frozenByUserId,
      snapshot,
      expectedRevision,
      0
    );
  }

  async saveInTransaction(
    tx: Prisma.TransactionClient,
    projectId: string,
    frozenByUserId: string,
    snapshot: BusinessEntryFrozenSnapshot,
    expectedRevision?: number
  ): Promise<BusinessEntryFrozenSnapshot> {
    try {
      return await this.persistInTransaction(
        tx,
        projectId,
        frozenByUserId,
        snapshot,
        expectedRevision
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BusinessEntrySnapshotConflictError();
      }
      throw error;
    }
  }

  private async saveStandaloneAttempt(
    projectId: string,
    frozenByUserId: string,
    snapshot: BusinessEntryFrozenSnapshot,
    expectedRevision: number | undefined,
    attempt: number
  ): Promise<BusinessEntryFrozenSnapshot> {
    if (isBusinessEntryProjectOwnedTarget(snapshot.target)) {
      throw new ConflictException("项目归属正式对象必须由领域调用方事务冻结");
    }
    if (!isPersistableExistingTarget(snapshot.target)) {
      throw new ConflictException("项目业务快照必须绑定已存在的正式业务对象");
    }
    this.assertProjectOwnedTargetProject(projectId, snapshot);
    const where = {
      projectId,
      sceneKey: snapshot.sceneKey,
      entityType: snapshot.target.entityType,
      entityId: snapshot.target.entityId
    };
    try {
      return await this.prisma.$transaction((tx) => this.persistInTransaction(
        tx,
        projectId,
        frozenByUserId,
        snapshot,
        expectedRevision
      ));
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const retry = await this.prisma.businessEntrySubmissionSnapshot.findMany({
        where,
        orderBy: { revision: "desc" }
      });
      const current = retry[0] ? snapshotFromRecord(retry[0], snapshot.target) : undefined;
      const same = current && sameImmutableContent(current, snapshot) ? current : undefined;
      if (same) return same;
      if (attempt >= 3) throw new BusinessEntrySnapshotConflictError();
      return this.saveStandaloneAttempt(
        projectId,
        frozenByUserId,
        snapshot,
        expectedRevision,
        attempt + 1
      );
    }
  }

  private async persistInTransaction(
    tx: Prisma.TransactionClient,
    projectId: string,
    frozenByUserId: string,
    snapshot: BusinessEntryFrozenSnapshot,
    expectedRevision: number | undefined
  ): Promise<BusinessEntryFrozenSnapshot> {
    if (!isPersistableExistingTarget(snapshot.target)) {
      throw new ConflictException("项目业务快照必须绑定已存在的正式业务对象");
    }
    this.assertProjectOwnedTargetProject(projectId, snapshot);
    const where = {
      projectId,
      sceneKey: snapshot.sceneKey,
      entityType: snapshot.target.entityType,
      entityId: snapshot.target.entityId
    };
    const existing = await tx.businessEntrySubmissionSnapshot.findMany({
      where,
      orderBy: { revision: "desc" }
    });
    const current = existing[0] ? snapshotFromRecord(existing[0], snapshot.target) : undefined;
    const same = current && sameImmutableContent(current, snapshot) ? current : undefined;
    if (same) return same;

    const currentRevision = existing[0]?.revision ?? 0;
    if (existing.length > 0 && expectedRevision === undefined) {
      throw new BusinessEntrySnapshotConflictError();
    }
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new BusinessEntrySnapshotConflictError();
    }
    const revision = currentRevision + 1;

    if (snapshot.sceneKey === "project_operating_profile" && snapshot.target.entityType === "project") {
      if (!this.operatingProfiles) {
        throw new ConflictException("项目经营档案事务适配器未启用");
      }
      const input: UpdateProjectOperatingProfileInput = {};
      if (Object.prototype.hasOwnProperty.call(snapshot.values, "operatingLedgerEffectiveDate")) {
        input.operatingLedgerEffectiveDate = snapshot.values.operatingLedgerEffectiveDate as string | null;
      }
      if (Object.prototype.hasOwnProperty.call(snapshot.values, "takeoverCompletedDate")) {
        input.takeoverCompletedDate = snapshot.values.takeoverCompletedDate as string | null;
      }
      if (Object.prototype.hasOwnProperty.call(snapshot.values, "takeoverStatus")) {
        input.takeoverStatus = snapshot.values.takeoverStatus as string;
      }
      await this.operatingProfiles.updateProfileInTransaction(
        tx,
        projectId,
        frozenByUserId,
        input
      );
    }
    const created = await tx.businessEntrySubmissionSnapshot.create({
      data: {
        ...where,
        revision,
        definitionVersion: snapshot.definitionVersion,
        definitionSnapshot: jsonValue(snapshot.definition),
        valuesSnapshot: jsonValue(snapshot.values),
        frozenAt: new Date(snapshot.frozenAt),
        frozenByUserId
      }
    });
    await this.audit.record(tx, {
      actorUserId: frozenByUserId,
      action: "business_entry.freeze",
      businessType: snapshot.target.entityType,
      businessId: snapshot.target.entityId,
      metadata: {
        sceneKey: snapshot.sceneKey,
        definitionVersion: snapshot.definitionVersion,
        revision,
        snapshotId: created.id
      }
    });
    return snapshotFromRecord(created, snapshot.target);
  }

  private assertProjectOwnedTargetProject(
    projectId: string,
    snapshot: BusinessEntryFrozenSnapshot
  ) {
    if (
      isBusinessEntryProjectOwnedTarget(snapshot.target) &&
      snapshot.target.projectId !== projectId
    ) {
      throw new ConflictException("正式业务对象目标项目与快照项目不一致");
    }
  }
}
