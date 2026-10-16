import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { employeeManagerRoles, employeeTargetNeedsChairman, IMPORTANT_EMPLOYEE_ROLES } from "./employee-management-policy";
import { PermissionImpactService } from "./permission-impact.service";
import { type ApplyProjectRosterChangeDto, type ProjectRosterChangeDto } from "./dto/project-roster-change.dto";

@Injectable()
export class ProjectRosterManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly impacts: PermissionImpactService
  ) {}

  async options(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const roles = await employeeManagerRoles(tx, actorId);
      const [projects, people] = await Promise.all([
        tx.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
        tx.user.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true }, orderBy: [{ name: "asc" }, { id: "asc" }] })
      ]);
      const users = await Promise.all(people.map(async (person) => ({
        ...person,
        canManage: person.id !== actorId && (roles.includes("chairman") || !await employeeTargetNeedsChairman(tx, person.id))
      })));
      return { projects, users, canManageRoster: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async preview(actorId: string, input: ProjectRosterChangeDto) {
    return this.prisma.$transaction((tx) => this.evaluate(tx, actorId, input), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
  }

  async apply(actorId: string, input: ApplyProjectRosterChangeDto) {
    await this.auth.confirmPassword(actorId, input.confirmationPassword);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const preview = await this.evaluate(tx, actorId, input);
        if (preview.snapshotHash !== input.snapshotHash) {
          throw new ConflictException("人员、项目或待办已经变化，请重新预览后提交");
        }
        if (!preview.canApply) throw new ConflictException(preview.blockingReasons.join("；"));
        if (input.operation === "join") {
          await tx.projectRosterMember.create({ data: { projectId: input.projectId, userId: input.userId } });
        } else {
          await tx.projectMember.deleteMany({ where: { projectId: input.projectId, userId: input.userId } });
          await tx.projectRosterMember.deleteMany({ where: { projectId: input.projectId, userId: input.userId } });
        }
        const at = new Date();
        await tx.user.update({ where: { id: input.userId }, data: { sessionVersion: { increment: 1 },
          ...(preview.projectRoleKeys.some((role) => IMPORTANT_EMPLOYEE_ROLES.includes(role) || role === "super_admin")
            ? { requiresChairmanManagement: true } : {}) } });
        await tx.refreshToken.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: at } });
        await this.audit.record(tx, {
          actorUserId: actorId, action: `project.roster.${input.operation}`, businessType: "project", businessId: input.projectId,
          metadata: { userId: input.userId, reason: input.reason.trim(), removedRoles: input.operation === "leave" ? preview.projectRoleKeys : [],
            snapshotHash: preview.snapshotHash, affectedApprovals: preview.affectedApprovals }
        });
        return { projectId: input.projectId, userId: input.userId, operation: input.operation };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code)) {
        throw new ConflictException("人员或项目归属已经变化，请刷新后重新预览");
      }
      throw error;
    }
  }

  private async evaluate(tx: Prisma.TransactionClient, actorId: string, input: ProjectRosterChangeDto) {
    const actorRoles = await employeeManagerRoles(tx, actorId);
    if (actorId === input.userId) throw new ForbiddenException("本人的项目归属请由其他有权管理员维护");
    if (!actorRoles.includes("chairman") && await employeeTargetNeedsChairman(tx, input.userId)) {
      throw new ForbiddenException("管理层、财务及重要岗位人员仅由董事长调入或调出");
    }
    const [project, person, roster, members, assignments, positions] = await Promise.all([
      tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, isActive: true, updatedAt: true } }),
      tx.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, isActive: true, sessionVersion: true, requiresChairmanManagement: true } }),
      tx.projectRosterMember.findMany({ where: { projectId: input.projectId, userId: input.userId }, orderBy: { id: "asc" } }),
      tx.projectMember.findMany({ where: { projectId: input.projectId, userId: input.userId }, orderBy: [{ positionKey: "asc" }, { id: "asc" }] }),
      tx.userPosition.findMany({ where: { userId: input.userId }, orderBy: { id: "asc" } }),
      tx.position.findMany({ select: { id: true, key: true, name: true } })
    ]);
    if (!project?.isActive) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    if (!person?.isActive) throw new ConflictException("人员不存在或已停用，请先核对人员状态");
    const legacy = assignments.filter((row) => row.projectId === project.id);
    const belongs = roster.length + members.length + legacy.length > 0;
    const blockingReasons: string[] = [];
    if (input.operation === "join" && belongs) blockingReasons.push("该人员已经在此项目，无需重复调入");
    if (input.operation === "leave" && !belongs) blockingReasons.push("该人员已经不在此项目，请刷新花名册");
    if (input.operation === "leave" && legacy.length) blockingReasons.push("该人员存在待核对的旧任职关系，请先核对组织岗位后再调出");
    const batch = input.operation === "leave" && members.length
      ? await this.impacts.evaluateRoleRemovalBatch(tx, { targets: members.map((row) => ({
          operation: "remove" as const, scope: "project" as const, userId: row.userId, projectId: row.projectId, roleKey: row.positionKey as RoleKey
        })) }) : null;
    if (batch && !batch.canApply) {
      blockingReasons.push("调出会导致待办审批无人办理或岗位关系异常，请先完成现有审批交接后再调出");
    }
    const departure = input.operation === "leave"
      ? await this.impacts.evaluateProjectRosterDeparture(tx, input.projectId, input.userId) : null;
    if (departure?.indirectApprovalIds.length) blockingReasons.push("该人员还有本项目的转审或委托待办，请先办完任务或完成相应交接后再调出");
    const globalRoleKeys = assignments.filter((row) => row.projectId === null)
      .map((row) => positions.find((position) => position.id === row.positionId)?.key as RoleKey);
    const projectRoleKeys = members.map((row) => row.positionKey as RoleKey);
    const change = { operation: input.operation, projectId: input.projectId, userId: input.userId, reason: input.reason.trim() };
    const snapshotHash = `sha256:${createHash("sha256").update(JSON.stringify({ change, project, person, roster, members, assignments,
      batchHash: batch?.combinedSnapshotHash ?? null, departureHash: departure?.snapshotHash ?? null })).digest("hex")}`;
    return {
      ...change, projectName: project.name, personName: person.name, snapshotHash,
      canApply: blockingReasons.length === 0, blockingReasons, projectRoleKeys,
      projectRoleNames: projectRoleKeys.map((role) => positions.find((position) => position.key === role)?.name ?? "待核对岗位"),
      affectedApprovals: new Set([...(batch?.steps.flatMap((step) => step.impacts.map((impact) => impact.approvalInstanceId)) ?? []),
        ...(departure?.indirectApprovalIds ?? [])]).size,
      retainsGlobalAccess: globalRoleKeys.some((role) => GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS.includes(role))
    };
  }
}
