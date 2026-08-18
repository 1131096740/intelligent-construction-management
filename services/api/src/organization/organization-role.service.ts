import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { ApplyRoleAdditionDto } from "./dto/apply-role-addition.dto";
import type { ApplyRoleRemovalDto } from "./dto/apply-role-removal.dto";
import {
  PermissionImpactService,
  type NormalizedRoleAdditionChange,
  type NormalizedRoleRemovalChange
} from "./permission-impact.service";
import type { PreviewRoleAdditionDto } from "./dto/preview-role-addition.dto";
import type { PreviewRoleRemovalDto } from "./dto/preview-role-removal.dto";
import {
  canManageRole,
  ORGANIZATION_MANAGER_ROLE_KEYS,
  requiresDepartmentBoundary,
  roleScope
} from "./organization-management-policy";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";

const ROLE_KEY_SET = new Set<string>(ROLE_KEYS);

export interface ApplyRoleRemovalResult {
  change: NormalizedRoleRemovalChange;
  assignmentId: string;
  source: "user_position" | "project_member";
  affectedInstances: number;
  revokedRefreshTokens: number;
}

export interface ApplyRoleAdditionResult {
  change: NormalizedRoleAdditionChange;
  assignmentId: string;
  source: "user_position" | "project_member";
  affectedNodes: number;
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

  async assertCanMaintainBusinessEntryRole(
    actorUserId: string,
    targetUserId: string,
    values: Record<string, unknown>
  ) {
    const roleKey = values.roleKey;
    const operation = values.operation;
    const scope = values.scope;
    const projectId = values.projectId;
    if (
      typeof roleKey !== "string" ||
      !ROLE_KEY_SET.has(roleKey) ||
      typeof operation !== "string" ||
      !["grant", "revoke"].includes(operation) ||
      (scope !== "global" && scope !== "project")
    ) {
      throw new ConflictException("岗位命令必须明确授予或撤销的岗位及授权范围");
    }
    const expectedScope = roleScope(roleKey as RoleKey);
    if (expectedScope === "global" && (scope !== "global" || projectId !== undefined)) {
      throw new ConflictException("全局岗位命令不得携带项目范围");
    }
    if (expectedScope === "project") {
      if (scope !== "project" || typeof projectId !== "string" || !projectId.trim()) {
        throw new ConflictException("项目岗位命令必须绑定项目");
      }
      const project = await this.prisma.project.findUnique({
        where: { id: projectId, isActive: true },
        select: { id: true }
      });
      if (!project) throw new ConflictException("项目不存在或已停用");
    }
    await this.assertCanManageTargetRole(
      this.prisma,
      actorUserId,
      targetUserId,
      roleKey as RoleKey,
      operation === "grant" ? "新增" : "撤销"
    );
  }

  async previewRoleAddition(actorUserId: string, input: PreviewRoleAdditionDto) {
    await this.assertCanManageTargetRole(this.prisma, actorUserId, input.userId, input.roleKey);
    return this.permissionImpacts.previewRoleAddition(input);
  }

  async previewRoleRemoval(actorUserId: string, input: PreviewRoleRemovalDto) {
    await this.assertCanManageTargetRole(this.prisma, actorUserId, input.userId, input.roleKey);
    return this.permissionImpacts.previewRoleRemoval(input);
  }

  async applyRoleRemoval(
    actorUserId: string,
    input: ApplyRoleRemovalDto
  ): Promise<ApplyRoleRemovalResult> {
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.assertCanManageTargetRole(tx, actorUserId, input.userId, input.roleKey);
          const evaluatedAt = new Date();
          const evaluation = await this.permissionImpacts.evaluateRoleRemoval(
            tx,
            {
              operation: "remove",
              userId: input.userId,
              scope: input.scope,
              ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
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
          const expectedSource =
            evaluation.preview.change.scope === "global" ? "user_position" : "project_member";
          if (target.source !== expectedSource) {
            throw new ConflictException("岗位撤销目标来源与范围不一致，请重新预览后再试");
          }
          if (expectedSource === "user_position") {
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
              source: expectedSource,
              snapshotHash: evaluation.preview.snapshotHash,
              affectedInstances: evaluation.preview.summary.affectedInstances,
              revokedRefreshTokens: revoked.count
            }
          });

          return {
            change: evaluation.preview.change,
            assignmentId: target.id,
            source: expectedSource,
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

  async applyRoleAddition(
    actorUserId: string,
    input: ApplyRoleAdditionDto
  ): Promise<ApplyRoleAdditionResult> {
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.assertCanManageTargetRole(tx, actorUserId, input.userId, input.roleKey, "新增");
          const evaluatedAt = new Date();
          const evaluation = await this.permissionImpacts.evaluateRoleAddition(
            tx,
            {
              operation: "add",
              userId: input.userId,
              scope: input.scope,
              ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
              roleKey: input.roleKey
            },
            evaluatedAt
          );
          if (evaluation.preview.snapshotHash !== input.snapshotHash) {
            throw new ConflictException("组织或审批数据已变化，请重新预览后再试");
          }
          if (!evaluation.preview.canApply || !evaluation.targetCreate) {
            throw new ConflictException("最新岗位新增预览存在阻断，请重新预览后处理");
          }

          const change = evaluation.preview.change;
          const target = evaluation.targetCreate;
          const expectedSource = change.scope === "global" ? "user_position" : "project_member";
          const targetMatchesChange =
            target.source === expectedSource &&
            target.userId === change.userId &&
            target.projectId === change.projectId &&
            target.roleKey === change.roleKey;
          if (!targetMatchesChange) {
            throw new ConflictException("岗位新增目标与范围不一致，请重新预览后再试");
          }

          const assignment =
            expectedSource === "user_position" && target.source === "user_position"
              ? await tx.userPosition.create({
                  data: {
                    userId: target.userId,
                    positionId: target.positionId,
                    projectId: null
                  },
                  select: { id: true }
                })
              : target.source === "project_member"
                ? await tx.projectMember.create({
                    data: {
                      userId: target.userId,
                      projectId: target.projectId,
                      positionKey: target.roleKey
                    },
                    select: { id: true }
                  })
                : null;
          if (!assignment) {
            throw new ConflictException("岗位新增目标与范围不一致，请重新预览后再试");
          }
          if (target.source === "project_member") {
            await tx.projectRosterMember.upsert({
              where: {
                projectId_userId: { projectId: target.projectId, userId: target.userId }
              },
              create: { projectId: target.projectId, userId: target.userId },
              update: {}
            });
          }
          const revoked = await tx.refreshToken.updateMany({
            where: { userId: change.userId, revokedAt: null },
            data: { revokedAt: evaluatedAt }
          });
          await this.audit.record(tx, {
            actorUserId,
            action: "permission.role.add",
            businessType: "role_assignment",
            businessId: assignment.id,
            metadata: {
              userId: change.userId,
              scope: change.scope,
              projectId: change.projectId,
              roleKey: change.roleKey,
              source: expectedSource,
              snapshotHash: evaluation.preview.snapshotHash,
              affectedNodes: evaluation.preview.summary.affectedNodes,
              revokedRefreshTokens: revoked.count
            }
          });
          return {
            change,
            assignmentId: assignment.id,
            source: expectedSource,
            affectedNodes: evaluation.preview.summary.affectedNodes,
            revokedRefreshTokens: revoked.count
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      const code = prismaErrorCode(error);
      if (code === "P2002") {
        throw new ConflictException("岗位事实已存在，请刷新后重新预览");
      }
      if (code === "P2034") {
        throw new ConflictException("组织或审批数据已变化，请重新预览后再试");
      }
      throw error;
    }
  }

  private async assertActiveGlobalSuperAdmin(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    action: "撤销" | "新增" = "撤销"
  ) {
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) {
      throw new ForbiddenException(`当前账号已停用，不能执行岗位${action}`);
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

  private async assertCanManageTargetRole(
    tx: Prisma.TransactionClient | PrismaService,
    actorUserId: string,
    targetUserId: string,
    roleKey: RoleKey,
    action: "撤销" | "新增" = "撤销"
  ) {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException("不能通过组织管理入口给自己授岗、撤岗或扩权");
    }
    try {
      await this.assertActiveGlobalSuperAdmin(tx as Prisma.TransactionClient, actorUserId, action);
      if (
        roleKey !== "engineering_department_member" &&
        roleKey !== "engineering_department_director"
      ) {
        return;
      }
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
    }
    const [actor, target, assignments] = await Promise.all([
      tx.user.findUnique({
        where: { id: actorUserId },
        select: { id: true, isActive: true, departmentId: true }
      }),
      tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, isActive: true, departmentId: true }
      }),
      tx.userPosition.findMany({
        where: { userId: actorUserId, projectId: null },
        select: { positionId: true }
      })
    ]);
    if (!actor?.isActive) throw new ForbiddenException(`当前账号已停用，不能执行岗位${action}`);
    if (!target) throw new ForbiddenException("待管理人员不存在，请刷新后重试");
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((row) => row.positionId) } },
          select: { key: true }
        })
      : [];
    const actorRoles = positions
      .map((position) => position.key)
      .filter((role): role is RoleKey => ROLE_KEY_SET.has(role));
    if (!actorRoles.some((role) => ORGANIZATION_MANAGER_ROLE_KEYS.includes(role))) {
      throw new ForbiddenException("当前账号没有岗位管理权限");
    }
    if (!canManageRole(actorRoles, roleKey)) {
      throw new ForbiddenException("当前岗位不能授予或撤销该岗位");
    }
    if (!requiresDepartmentBoundary(actorRoles)) return;
    if (!actor.departmentId || !target.departmentId) {
      throw new ForbiddenException("主管与待管理人员必须归属部门");
    }
    const departments = await tx.department.findMany({ select: { id: true, parentId: true } });
    const allowed = new Set([actor.departmentId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const department of departments) {
        if (department.parentId && allowed.has(department.parentId) && !allowed.has(department.id)) {
          allowed.add(department.id);
          changed = true;
        }
      }
    }
    if (!allowed.has(target.departmentId)) {
      throw new ForbiddenException("只能管理本部门及下属部门人员");
    }
  }
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
