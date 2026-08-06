import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  buildContractFileBindingManifest,
  type CleanupManifest,
  type CleanupTarget
} from "./file-binding-manifest";
import {
  isValidObjectKey,
  withObjectStorageRetry,
  type VersionedObjectStorage
} from "./versioned-object-storage";

/**
 * 文件清理接缝。
 *
 * 本票只建立只读清单与受严格守卫的删除原语，不暴露任何 HTTP 删除入口，
 * 不实现桶级生命周期/版本控制配置，不连接生产 COS。
 *
 * - `previewManifest`：只读，`mode: "preview_only"`、`executionAllowed: false`。
 * - `deleteExactObjects`：仅按精确对象键逐个永久删除全部版本与删除标记，
 *   每次调用前必经 `assertExactObjectKeyScope`；收敛失败抛 `PartialDeletionError`，
 *   残留仅暴露对象键指纹与版本数，不暴露完整对象键。实际删除编排由后续票据在
 *   另行授权后调用。
 */

export class CleanupScopeError extends Error {
  readonly code = "CLEANUP_SCOPE_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CleanupScopeError";
  }
}

export interface ResidualObject {
  objectKeyFingerprint: string;
  remainingVersions: number;
}

export class PartialDeletionError extends Error {
  readonly residuals: ResidualObject[];

  constructor(residuals: ResidualObject[]) {
    super("部分对象未收敛，删除未完成");
    this.name = "PartialDeletionError";
    this.residuals = residuals;
  }
}

function objectKeyFingerprint(objectKey: string): string {
  return createHash("sha256").update(objectKey).digest("hex").slice(0, 16);
}

@Injectable()
export class FileCleanupSeamService {
  private readonly logger = new Logger(FileCleanupSeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 只读：解析清理目标并生成精确文件绑定清单（永不执行删除）。 */
  previewManifest(
    target: CleanupTarget,
    storage?: VersionedObjectStorage
  ): Promise<CleanupManifest> {
    return this.prisma.$transaction(
      async (tx) => buildContractFileBindingManifest(tx, target, storage),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  /**
   * 守卫：清理范围必须是「精确对象键」集合，拒绝前缀形态。
   * 真实对象键形如 `uploads/<uuid>-<name>.pdf`；`uploads` / `uploads/` /
   * 尾部斜杠 / 空集合 / 含 `..`、`\0` 等非法字符一律拒绝。
   */
  assertExactObjectKeyScope(objectKeys: readonly string[]): void {
    if (objectKeys.length === 0) {
      throw new CleanupScopeError("清理范围不能为空");
    }
    for (const objectKey of objectKeys) {
      if (objectKey === "uploads") {
        throw new CleanupScopeError("禁止以上传根前缀 uploads 作为清理范围");
      }
      if (!isValidObjectKey(objectKey)) {
        throw new CleanupScopeError("清理范围包含非精确对象键");
      }
    }
  }

  /**
   * 受严格守卫的删除原语：对每个精确对象键枚举全部版本与删除标记、
   * 逐版本永久删除、删除后重新枚举证明收敛。任何一步不收敛即抛
   * `PartialDeletionError`，不报告成功。
   */
  async deleteExactObjects(
    objectKeys: readonly string[],
    storage: VersionedObjectStorage
  ): Promise<{ deletedKeys: string[] }> {
    this.assertExactObjectKeyScope(objectKeys);
    const residuals: ResidualObject[] = [];
    for (const objectKey of objectKeys) {
      await this.deleteExactObject(objectKey, storage, residuals);
    }
    if (residuals.length > 0) {
      throw new PartialDeletionError(residuals);
    }
    return { deletedKeys: [...objectKeys] };
  }

  private async deleteExactObject(
    objectKey: string,
    storage: VersionedObjectStorage,
    residuals: ResidualObject[]
  ): Promise<void> {
    const versions = await withObjectStorageRetry(() => storage.listObjectVersions(objectKey), {
      maxAttempts: 3,
      baseBackoffMs: 25
    });
    for (const version of versions) {
      await withObjectStorageRetry(
        () => storage.deleteObjectVersion(objectKey, version.versionId),
        { maxAttempts: 3, baseBackoffMs: 25 }
      );
    }
    const converged = await withObjectStorageRetry(() => storage.isConverged(objectKey), {
      maxAttempts: 3,
      baseBackoffMs: 25
    });
    if (!converged) {
      // 诊断重枚举可能因瞬时网络失败而无法确认残留数量，用 -1 表示未知，
      // 避免误报「0 个残留」与不收敛事实相矛盾。
      let remainingVersions = -1;
      try {
        const remaining = await withObjectStorageRetry(
          () => storage.listObjectVersions(objectKey),
          { maxAttempts: 2, baseBackoffMs: 25 }
        );
        remainingVersions = remaining.length;
      } catch {
        // 保持 -1 未知哨兵。
      }
      residuals.push({
        objectKeyFingerprint: objectKeyFingerprint(objectKey),
        remainingVersions
      });
      this.logger.error({
        event: "exact_object_cleanup_not_converged",
        objectKeyFingerprint: objectKeyFingerprint(objectKey),
        remainingVersions
      });
      return;
    }
    this.logger.log({
      event: "exact_object_cleanup_converged",
      objectKeyFingerprint: objectKeyFingerprint(objectKey),
      deletedVersionCount: versions.length
    });
  }
}
