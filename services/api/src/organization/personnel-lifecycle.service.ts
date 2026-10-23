import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { employeeManagerRoles, employeeTargetNeedsChairman, IMPORTANT_EMPLOYEE_ROLES } from "./employee-management-policy";
import { OrganizationRoleService } from "./organization-role.service";
import { PermissionImpactService } from "./permission-impact.service";
import { assertEngineeringDirectorAvailable } from "./organization-role-assignment-policy";
import { personnelFingerprint, recordPersonnelFact } from "./personnel-fact";
import type { ApplyPersonnelChangeDto, PersonnelChangeDto } from "./dto/personnel-change.dto";
import type { PreviewRoleRemovalDto } from "./dto/preview-role-removal.dto";
import { employeeDepartureBlockingReasons } from "./employee-departure-policy";

type Preview = { snapshotHash: string; canApply: boolean; blockingReasons: string[]; userId: string; action: string; personName: string };
class PreviewRollback { constructor(readonly result: Preview) {} }

// Preview executes the exact transaction then deliberately rolls it back. It has no
// external effects: every policy and simulated write receives this same tx.
@Injectable()
export class PersonnelLifecycleService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService,
    private readonly audit: AuditService, private readonly roles: OrganizationRoleService,
    private readonly impacts: PermissionImpactService) {}

  private async authorize(tx: Prisma.TransactionClient, actorId: string, userId: string) {
    const actorRoles = await employeeManagerRoles(tx, actorId);
    if (actorId === userId) throw new ForbiddenException("本人的人事办理请由其他有权人员处理");
    if (!actorRoles.includes("chairman") && await employeeTargetNeedsChairman(tx, userId)) {
      throw new ForbiddenException("重要岗位及曾任重要岗位人员仅由董事长办理");
    }
    return actorRoles;
  }

  async history(actorId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorize(tx, actorId, userId);
      const [periods, changes] = await Promise.all([
        tx.employmentPeriod.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        tx.personnelChange.findMany({ where: { userId }, orderBy: { sequence: "desc" },
          select: { id: true, action: true, reason: true, actorUserId: true, createdAt: true, previousChangeId: true } })
      ]);
      return { periods, changes };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async result(actorId: string, commandKey: string) {
    return this.prisma.$transaction(async (tx) => {
      await employeeManagerRoles(tx, actorId);
      const saved = await tx.personnelChange.findUnique({ where: { commandKey } });
      if (!saved) return { found: false, message: "尚未查到办理回执，结果仍待核实，请沿原办理继续核对" };
      await this.authorize(tx, actorId, saved.userId);
      if (saved.actorUserId !== actorId) throw new ForbiddenException("只能核对本人提交的人事办理结果");
      return saved.result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async preview(actorId: string, input: PersonnelChangeDto): Promise<Preview> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const preview = await this.change(tx, actorId, input);
        throw new PreviewRollback(preview);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (error instanceof PreviewRollback) return error.result;
      throw this.conflict(error);
    }
    throw new Error("预览事务未返回结果");
  }

  async apply(actorId: string, input: ApplyPersonnelChangeDto) {
    await this.auth.confirmPassword(actorId, input.confirmationPassword);
    const fingerprint = personnelFingerprint(normalize(input));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`personnel-command:${input.commandKey}`}))`;
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
          await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
          await this.authorize(tx, actorId, input.userId);
          const saved = await tx.personnelChange.findUnique({ where: { commandKey: input.commandKey } });
          // A committed result wins over an obsolete preview/revision.
          if (saved) {
            if (saved.actorUserId !== actorId || saved.payloadFingerprint !== fingerprint || saved.userId !== input.userId) {
              throw new ConflictException("此办理编号已用于其他内容，请核对原办理结果");
            }
            return saved.result;
          }
          const before = await this.state(tx, input.userId);
          const preview = await this.change(tx, actorId, input, input.snapshotHash);
          if (!preview.canApply) throw new ConflictException(preview.blockingReasons.join("；"));
          const after = await this.state(tx, input.userId);
          const result = await recordPersonnelFact(tx, { userId: input.userId, actorUserId: actorId, action: input.action,
            reason: input.reason.trim(), commandKey: input.commandKey, payloadFingerprint: fingerprint,
            before: json(before), after: json(after) });
          await this.audit.record(tx, { actorUserId: actorId, action: `personnel.${input.action}`, businessType: "user", businessId: input.userId,
            metadata: { commandKey: input.commandKey, snapshotHash: preview.snapshotHash, reason: input.reason.trim() } });
          return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
      } catch (error) {
        if (isSerializationConflict(error) && attempt < 2) continue;
        throw this.conflict(error);
      }
    }
    throw new ConflictException("办理数据正在变化，请沿原办理编号核实后重试");
  }

  private conflict(error: unknown) {
    if (isSerializationConflict(error) || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025"].includes(error.code))) {
      return new ConflictException("人员或待办已变化，请核对原办理结果并重新预览");
    }
    return error;
  }

  private async state(tx: Prisma.TransactionClient, userId: string) {
    const [person, globalRoles, projectRoles, roster, periods] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, departmentId: true, isActive: true, sessionVersion: true, requiresChairmanManagement: true } }),
      tx.userPosition.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      tx.projectMember.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      tx.projectRosterMember.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      tx.employmentPeriod.findMany({ where: { userId }, orderBy: { id: "asc" } })
    ]);
    if (!person) throw new NotFoundException("人员不存在，请刷新后重试");
    return { person, globalRoles, projectRoles, roster, periods };
  }

  private async change(tx: Prisma.TransactionClient, actorId: string, input: PersonnelChangeDto, expectedHash?: string): Promise<Preview> {
    const command = normalize(input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`personnel-user:${input.userId}`}))`;
    await this.authorize(tx, actorId, input.userId);
    const before = await this.state(tx, input.userId);
    const [positions, approvals, delegations, allAssignments, allMembers, users, projects] = await Promise.all([
      tx.position.findMany({ orderBy: { id: "asc" } }),
      tx.approvalInstance.findMany({ where: { status: { in: ["in_progress", "approval_pending"] } }, orderBy: { id: "asc" } }),
      tx.approvalDelegation.findMany({ where: { enabled: true }, orderBy: { id: "asc" } }),
      tx.userPosition.findMany({ orderBy: { id: "asc" } }), tx.projectMember.findMany({ orderBy: { id: "asc" } }),
      tx.user.findMany({ select: { id: true, isActive: true, sessionVersion: true }, orderBy: { id: "asc" } }),
      tx.project.findMany({ select: { id: true, isActive: true }, orderBy: { id: "asc" } })
    ]);
    const snapshotHash = personnelFingerprint({ command, before, positions, approvals, delegations, allAssignments, allMembers, users, projects });
    if (expectedHash && snapshotHash !== expectedHash) throw new ConflictException("人员、岗位或审批待办已变化，请重新预览");
    const blockers: string[] = [];
    const current = before.periods.find((period) => period.endedAt === null);
    const past = before.periods.some((period) => period.endedAt !== null);
    if (input.action === "rehire" && (before.person.isActive || current || !past)) blockers.push("返聘须选择已确认离职且已停用的原员工");
    const canVerifyCurrent = current && !current.verified && current.startedOn === null;
    if (input.action === "join" && (!before.person.isActive || (current && !canVerifyCurrent) || (past && !current))) blockers.push("该任职已核实或已有离职履历，请核对原记录；离职员工请办理返聘");
    if (input.action === "join" && canVerifyCurrent && !input.startedOn) blockers.push("请填写已核实的入职日期；未经核实可继续保留未知");
    if (input.action === "join" && current?.companyEntityId && input.companyEntityId && current.companyEntityId !== input.companyEntityId) blockers.push("已记录的用工公司不能在首次核实日期时覆盖，请核对原记录");
    if (input.action === "adjust" && !before.person.isActive) blockers.push("账号已停用，请先核实账号状态；已离职人员请办理返聘");
    if (input.action === "offboard" && past && !current) blockers.push("该员工已确认离职，请核对原办理结果，无需重复离职");
    if (input.action === "offboard" && (command.additions.length || command.removals.length || command.rosterChanges.length || input.departmentId || input.startedOn || input.companyEntityId)) {
      throw new BadRequestException("离职由系统核对并撤销当前业务任职，请勿混入其他调整");
    }
    if (input.action === "adjust" && (input.startedOn || input.companyEntityId)) throw new BadRequestException("任职资料请在入职或返聘时核实");
    if (input.action === "adjust" && !command.additions.length && !command.removals.length && !command.rosterChanges.length && input.departmentId === undefined) {
      throw new BadRequestException("请选择本次需要调整的内容");
    }
    if (input.departmentId !== undefined) {
      const department = await tx.department.findUnique({ where: { id: input.departmentId } });
      if (!department?.isActive) blockers.push("请选择启用的部门");
    }
    if (input.companyEntityId) {
      const company = await tx.companyEntity.findUnique({ where: { id: input.companyEntityId } });
      if (!company?.isActive) blockers.push("请选择有效的用工公司");
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const startedOn = input.startedOn ? new Date(`${input.startedOn}T00:00:00.000Z`) : null;
    if (startedOn && (Number.isNaN(startedOn.getTime()) || startedOn.toISOString().slice(0, 10) !== input.startedOn || input.startedOn! > today)) {
      throw new BadRequestException("请输入有效且不晚于今天的核实入职日期");
    }
    if ((input.action === "rehire" || (input.action === "join" && current && past)) && startedOn && before.periods.some((period) => period.endedOn && period.endedOn > startedOn)) {
      blockers.push("返聘入职日期不能早于上一段离职日期");
    }
    const roleById = new Map(positions.map((position) => [position.id, position.key]));
    if (before.globalRoles.some((row) => row.projectId !== null)) blockers.push("存在待核对的旧项目任职，请先完成核对");
    if (before.globalRoles.some((row) => roleById.get(row.positionId) === "super_admin") || before.projectRoles.some((row) => row.positionKey === "super_admin")) {
      blockers.push("该人员仍持有技术管理员权限，请先由其他技术管理员完成技术交接");
    }
    const now = new Date();
    const roleIdentity = (row: { scope: string; projectId?: string | null; roleKey: string }) => `${row.scope}:${row.projectId ?? ""}:${row.roleKey}`;
    const additionKeys = command.additions.map(roleIdentity);
    const removalKeys = command.removals.map(roleIdentity);
    if (new Set(additionKeys).size !== additionKeys.length || new Set(removalKeys).size !== removalKeys.length || additionKeys.some((key) => removalKeys.includes(key))) {
      throw new BadRequestException("同一岗位不能重复安排或同时授予和撤销");
    }
    const rosterIds = command.rosterChanges.map((row) => row.projectId);
    if (new Set(rosterIds).size !== rosterIds.length) throw new BadRequestException("同一项目不能重复调动或同时调入和调出");
    if (command.additions.some((addition) => addition.scope === "project" && command.rosterChanges.some((row) => row.operation === "leave" && row.projectId === addition.projectId))) {
      throw new BadRequestException("调出项目时不能同时新增该项目岗位");
    }
    if (input.action === "offboard") {
      blockers.push(...employeeDepartureBlockingReasons(input.userId, approvals, delegations, now));
    }
    const result = () => ({ snapshotHash, canApply: blockers.length === 0, blockingReasons: [...new Set(blockers)], userId: input.userId, action: input.action, personName: before.person.name });
    if (blockers.length) return result();

    if (input.action === "rehire") await tx.user.update({ where: { id: input.userId }, data: { isActive: true } });
    const removals: PreviewRoleRemovalDto[] = [...command.removals];
    const rosterChanges = [...command.rosterChanges];
    if (input.action === "offboard") {
      for (const row of before.globalRoles) {
        const roleKey = roleById.get(row.positionId);
        if (!ROLE_KEYS.includes(roleKey as RoleKey)) { blockers.push("存在无法识别的岗位，请先核对"); continue; }
        removals.push({ operation: "remove", scope: "global", roleKey: roleKey as RoleKey, userId: input.userId });
      }
      for (const row of before.projectRoles) removals.push({ operation: "remove", scope: "project", roleKey: row.positionKey as RoleKey, userId: input.userId, projectId: row.projectId });
      for (const projectId of new Set([...before.projectRoles, ...before.roster].map((row) => row.projectId))) rosterChanges.push({ operation: "leave", projectId });
    }
    for (const target of [...command.additions, ...removals]) {
      if (target.userId !== input.userId || target.roleKey === "super_admin") throw new ForbiddenException("人事办理仅处理本人的业务岗位，技术权限请走原技术管理入口");
      await this.roles.assertCanManageRoleInTransaction(tx, actorId, input.userId, target.roleKey, target.operation === "add" ? "新增" : "撤销");
    }
    // Additions are simulated first, then the complete removal batch is evaluated.
    // The preview's transaction is always rolled back, including all simulated rows.
    for (const addition of command.additions) {
      if (addition.roleKey === "engineering_department_director") await assertEngineeringDirectorAvailable(tx, input.userId);
      const evaluated = await this.impacts.evaluateRoleAddition(tx, addition, now);
      if (!evaluated.preview.canApply || !evaluated.targetCreate) {
        const roleName = positions.find((row) => row.key === addition.roleKey)?.name ?? "所选岗位";
        const details = evaluated.preview.blockingIssues.map((issue) => `${roleName}：${issue.message}`);
        blockers.push(...(details.length ? details : [`新增${roleName}会影响审批办理，请先在原业务完成交接`]));
        break;
      }
      const target = evaluated.targetCreate;
      if (target.source === "user_position") await tx.userPosition.create({ data: { userId: input.userId, positionId: target.positionId, projectId: null } });
      else {
        await tx.projectMember.create({ data: { userId: input.userId, projectId: target.projectId, positionKey: target.roleKey } });
        await tx.projectRosterMember.upsert({ where: { projectId_userId: { projectId: target.projectId, userId: input.userId } }, create: { projectId: target.projectId, userId: input.userId }, update: {} });
      }
    }
    if (removals.length) {
      const evaluated = await this.impacts.evaluateRoleRemovalBatch(tx, { targets: removals }, now);
      if (!evaluated.canApply) {
        const details = evaluated.steps.flatMap((step) => step.blockingIssues.map((issue) =>
          `${positions.find((row) => row.key === step.change.roleKey)?.name ?? "所选岗位"}：${issue.message}`));
        blockers.push(...(details.length ? details : ["撤岗会影响当前或未来审批办理，请先在原业务完成交接"]));
      }
    }
    for (const change of rosterChanges) {
      const project = await tx.project.findUnique({ where: { id: change.projectId } });
      if (!project || (!project.isActive && input.action !== "offboard")) { blockers.push("项目不存在或已停用"); continue; }
      if (change.operation === "leave") {
        const departure = await this.impacts.evaluateProjectRosterDeparture(tx, change.projectId, input.userId, now);
        if (departure.indirectApprovalIds.length) blockers.push("仍有项目转审或委托任务，请先在原业务完成交接");
        for (const member of before.projectRoles.filter((row) => row.projectId === change.projectId)) {
          if (!removals.some((target) => target.scope === "project" && target.projectId === change.projectId && target.roleKey === member.positionKey)) blockers.push("调出项目时请一并选择撤销该项目的现有岗位");
        }
      }
    }
    if (blockers.length) return result();
    for (const removal of removals) {
      if (removal.scope === "global") {
        const position = positions.find((row) => row.key === removal.roleKey)!;
        await tx.userPosition.deleteMany({ where: { userId: input.userId, positionId: position.id, projectId: null } });
      } else await tx.projectMember.deleteMany({ where: { userId: input.userId, projectId: removal.projectId!, positionKey: removal.roleKey } });
    }
    for (const change of rosterChanges) {
      if (change.operation === "join") await tx.projectRosterMember.upsert({ where: { projectId_userId: { projectId: change.projectId, userId: input.userId } }, create: { projectId: change.projectId, userId: input.userId }, update: {} });
      else await tx.projectRosterMember.deleteMany({ where: { projectId: change.projectId, userId: input.userId } });
    }
    if (input.action === "join" || input.action === "rehire") {
      if (input.action === "join" && canVerifyCurrent) {
        await tx.employmentPeriod.update({ where: { id: current.id }, data: { startedOn, verified: true,
          companyEntityId: input.companyEntityId, revision: { increment: 1 } } });
      } else await tx.employmentPeriod.create({ data: { userId: input.userId, startedOn, verified: Boolean(startedOn), companyEntityId: input.companyEntityId } });
    }
    if (input.action === "offboard") {
      const period = current ?? await tx.employmentPeriod.create({ data: { userId: input.userId } });
      await tx.employmentPeriod.update({ where: { id: period.id }, data: { endedOn: new Date(`${today}T00:00:00.000Z`), endedAt: now, revision: { increment: 1 } } });
    }
    const important = [...command.additions, ...removals].some((target) => IMPORTANT_EMPLOYEE_ROLES.includes(target.roleKey));
    await tx.user.update({ where: { id: input.userId }, data: { ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.action === "offboard" ? { isActive: false } : {}), ...(important ? { requiresChairmanManagement: true } : {}), sessionVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: now } });
    return result();
  }
}

function normalize(input: PersonnelChangeDto) {
  return { userId: input.userId, action: input.action, reason: input.reason.trim(), departmentId: input.departmentId ?? null,
    startedOn: input.startedOn ?? null, companyEntityId: input.companyEntityId ?? null,
    additions: input.additions ?? [], removals: input.removals ?? [], rosterChanges: input.rosterChanges ?? [] };
}
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001"));
}
