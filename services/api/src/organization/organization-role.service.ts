import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { ApplyRoleRemovalDto } from "./dto/apply-role-removal.dto";
import {
  PermissionImpactService,
  type NormalizedRoleRemovalChange
} from "./permission-impact.service";

export interface ApplyRoleRemovalResult {
  change: NormalizedRoleRemovalChange;
  assignmentId: string;
  source: "user_position" | "project_member";
  affectedInstances: number;
  revokedRefreshTokens: number;
}

@Injectable()
export class OrganizationRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly permissionImpacts: PermissionImpactService
  ) {}

  async applyRoleRemoval(
    actorUserId: string,
    input: ApplyRoleRemovalDto
  ): Promise<ApplyRoleRemovalResult> {
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.assertActiveGlobalSuperAdmin(tx, actorUserId);
          const evaluatedAt = new Date();
          const evaluation = await this.permissionImpacts.evaluateRoleRemoval(
            tx,
            {
              operation: "remove",
              userId: input.userId,
              scope: input.scope,
              ...(input.scope === "project" ? { projectId: input.projectId } : {}),
              roleKey: input.roleKey
            },
            evaluatedAt
          );

          if (evaluation.preview.snapshotHash !== input.snapshotHash) {
            throw new ConflictException("组织或审批数据已变化，请重新预览后再试");
          }
          if (!evaluation.preview.canApply || !evaluation.targetAssignment) {
            throw new ConflictException("最新岗位撤销预览存在阻断，请重新预览后处理");
          }

          const target = evaluation.targetAssignment;
          if (target.source === "user_position") {
            await tx.userPosition.delete({ where: { id: target.id } });
          } else {
            await tx.projectMember.delete({ where: { id: target.id } });
          }

          const revoked = await tx.refreshToken.updateMany({
            where: { userId: evaluation.preview.change.userId, revokedAt: null },
            data: { revokedAt: evaluatedAt }
          });
          await this.audit.record(tx, {
            actorUserId,
            action: "permission.role.remove",
            businessType: "role_assignment",
            businessId: target.id,
            metadata: {
              userId: evaluation.preview.change.userId,
              scope: evaluation.preview.change.scope,
              projectId: evaluation.preview.change.projectId,
              roleKey: evaluation.preview.change.roleKey,
              source: target.source,
              snapshotHash: evaluation.preview.snapshotHash,
              affectedInstances: evaluation.preview.summary.affectedInstances,
              revokedRefreshTokens: revoked.count
            }
          });

          return {
            change: evaluation.preview.change,
            assignmentId: target.id,
            source: target.source,
            affectedInstances: evaluation.preview.summary.affectedInstances,
            revokedRefreshTokens: revoked.count
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      const code = prismaErrorCode(error);
      if (code === "P2025") {
        throw new ConflictException("岗位事实已变化，请重新预览后再试");
      }
      if (code === "P2034") {
        throw new ConflictException("组织或审批数据已变化，请重新预览后再试");
      }
      throw error;
    }
  }

  private async assertActiveGlobalSuperAdmin(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) {
      throw new ForbiddenException("当前账号已停用，不能执行岗位撤销");
    }

    const adminPosition = await tx.position.findUnique({
      where: { key: "super_admin" },
      select: { id: true }
    });
    if (!adminPosition) {
      throw new ForbiddenException("当前账号已不具备全局超级管理员权限");
    }
    const assignment = await tx.userPosition.findFirst({
      where: {
        userId: actorUserId,
        positionId: adminPosition.id,
        projectId: null
      },
      select: { id: true }
    });
    if (!assignment) {
      throw new ForbiddenException("当前账号已不具备全局超级管理员权限");
    }
  }
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
