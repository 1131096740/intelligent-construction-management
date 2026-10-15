import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma, type EmployeeRegistration } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { AuthService } from "../auth/auth.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ApplicationLoginDto, EmployeeRegistrationDto, ReviewEmployeeRegistrationDto, type EmployeeRoleDto, type ResubmitEmployeeRegistrationDto } from "./dto/employee-registration.dto";
import { canApproveEmployeeRoles, employeeManagerRoles, IMPORTANT_EMPLOYEE_ROLES } from "./employee-management-policy";
import { roleScope } from "./organization-management-policy";
import { SmsVerificationService } from "../auth/sms-verification.service";

function isConcurrentConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (["P2002", "P2034"].includes(error.code) || (error.code === "P2010" && error.meta?.code === "40001"));
}

export function applicationSummary(row: EmployeeRegistration) {
  return { id: row.id, name: row.name, phone: row.phone, status: row.status,
    revision: row.revision, reason: row.reason, createdAt: row.createdAt,
    phoneVerified: Boolean(row.phoneVerifiedAt), mustChangePassword: row.mustChangePassword,
    canResubmit: row.status === "returned" && !row.mustChangePassword,
    canChangePassword: row.status !== "approved" && row.mustChangePassword };
}

@Injectable()
export class EmployeeOnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService,
    private readonly tokens: JwtTokenService, private readonly audit: AuditService, private readonly sms: SmsVerificationService) {}

  async register(input: EmployeeRegistrationDto) {
    const smsEnabled = this.sms.enabled();
    if (smsEnabled) await this.sms.verify(input.phone, "register", input.code, `register:${input.phone}`);
    const passwordHash = await this.auth.hashPassword(input.password);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-phone:${input.phone}`}))`;
        if (await tx.user.findUnique({ where: { phone: input.phone }, select: { id: true } })) {
          throw new ConflictException("该手机号已有账号，请直接登录或联系管理员处理");
        }
        const application = await tx.employeeRegistration.create({ data: {
          name: input.name.trim(), phone: input.phone, passwordHash, ...(smsEnabled ? { phoneVerifiedAt: new Date() } : {})
        } });
        await this.audit.record(tx, { action: "employee.registration.submit", businessType: "employee_registration",
          businessId: application.id, metadata: { revision: application.revision } });
        return application;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.session(row);
    } catch (error) {
      if (isConcurrentConflict(error)) {
        throw new ConflictException("该手机号已提交过申请，请使用原密码查看申请");
      }
      throw error;
    }
  }

  async login(input: ApplicationLoginDto) {
    const row = await this.prisma.employeeRegistration.findUnique({ where: { phone: input.phone } });
    if (!row || row.status === "approved" || (row.temporaryPasswordExpiresAt && row.temporaryPasswordExpiresAt <= new Date()) || !await bcrypt.compare(input.password, row.passwordHash)) {
      throw new UnauthorizedException("手机号或密码不正确，请重试或联系管理员");
    }
    await this.audit.record(this.prisma, { action: "auth.application.login", businessType: "employee_registration",
      businessId: row.id, metadata: { credentialVersion: row.credentialVersion, temporaryPasswordUsed: row.mustChangePassword } });
    return this.session(row);
  }

  async mine(authorization?: string) {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const payload = this.tokens.verifyApplicationToken(token);
    const row = await this.prisma.employeeRegistration.findUnique({ where: { id: payload.sub } });
    if (!row || row.credentialVersion !== (payload.ver ?? 0) || (row.temporaryPasswordExpiresAt && row.temporaryPasswordExpiresAt <= new Date())) {
      throw new UnauthorizedException("申请查看凭证已失效，请重新登录");
    }
    return applicationSummary(row);
  }

  async list(actorId: string) {
    await employeeManagerRoles(this.prisma, actorId);
    const [pending, recent] = await Promise.all([
      this.prisma.employeeRegistration.findMany({ where: { status: { in: ["pending", "chairman_review"] } }, orderBy: { createdAt: "asc" }, take: 200 }),
      this.prisma.employeeRegistration.findMany({ where: { status: { in: ["returned", "approved"] } }, orderBy: { updatedAt: "desc" }, take: 50 })
    ]);
    const rows = [...pending, ...recent];
    return { pendingCount: await this.prisma.employeeRegistration.count({ where: { status: { in: ["pending", "chairman_review"] } } }),
      applications: rows.map((row) => ({ ...applicationSummary(row), departmentId: row.departmentId, proposedRoles: row.proposedRoles })) };
  }

  async resubmit(input: ResubmitEmployeeRegistrationDto, authorization?: string) {
    const payload = this.tokens.verifyApplicationToken(authorization?.startsWith("Bearer ") ? authorization.slice(7) : "");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeRegistration.updateMany({ where: { id: payload.sub,
        credentialVersion: payload.ver ?? 0, revision: input.revision, status: "returned", mustChangePassword: false },
      data: { name: input.name.trim(), status: "pending", revision: { increment: 1 }, reason: "",
        departmentId: null, proposedRoles: [], reviewedBy: null, reviewedAt: null } });
      if (updated.count !== 1) throw new ConflictException("申请已变化或尚未退回，请刷新后查看");
      const row = await tx.employeeRegistration.findUniqueOrThrow({ where: { id: payload.sub } });
      await this.audit.record(tx, { action: "employee.registration.resubmit", businessType: "employee_registration",
        businessId: row.id, metadata: { revision: row.revision } });
      return applicationSummary(row);
    });
  }

  async changeApplicationPassword(newPassword: string, authorization?: string) {
    const payload = this.tokens.verifyApplicationToken(authorization?.startsWith("Bearer ") ? authorization.slice(7) : "");
    const passwordHash = await this.auth.hashPassword(newPassword);
    const row = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.employeeRegistration.updateMany({ where: { id: payload.sub, credentialVersion: payload.ver ?? 0,
        status: { not: "approved" }, OR: [{ temporaryPasswordExpiresAt: null }, { temporaryPasswordExpiresAt: { gt: new Date() } }] },
      data: { passwordHash, mustChangePassword: false, temporaryPasswordExpiresAt: null,
        credentialVersion: { increment: 1 }, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new UnauthorizedException("申请凭证已失效，请重新登录");
      await this.audit.record(tx, { action: "employee.registration.password_change", businessType: "employee_registration", businessId: payload.sub });
      return tx.employeeRegistration.findUniqueOrThrow({ where: { id: payload.sub } });
    });
    return this.session(row);
  }

  async review(id: string, actorId: string, input: ReviewEmployeeRegistrationDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const actorRoles = await employeeManagerRoles(tx, actorId);
        await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
        await tx.$queryRaw`SELECT "id" FROM "EmployeeRegistration" WHERE "id" = ${id} FOR UPDATE`;
        const row = await tx.employeeRegistration.findUnique({ where: { id } });
        if (!row) throw new NotFoundException("入职申请不存在，请刷新后重试");
        if (!["pending", "chairman_review"].includes(row.status) || row.revision !== input.revision) {
          throw new ConflictException("申请已经被处理或修改，请刷新后查看最新结果");
        }
        if (row.status === "chairman_review" && !actorRoles.includes("chairman")) {
          throw new ForbiddenException("这份申请已交董事长审核，请等待董事长处理");
        }
        const reason = input.reason?.trim() ?? "";
        let status = "returned";
        let userId: string | undefined;
        let roles: EmployeeRoleDto[] = [];
        if (input.decision === "return") {
          if (!reason) throw new BadRequestException("请填写退回原因，方便员工修改后重新提交");
        } else {
          if (input.identityVerified !== true) throw new BadRequestException("请先核对员工本人及手机号");
          roles = input.roles ?? [];
          await this.validateAssignment(tx, input.departmentId, roles);
          if (input.decision === "approve" && !canApproveEmployeeRoles(actorRoles, roles.map((role) => role.roleKey))) {
            throw new ForbiddenException("管理层和全部财务岗位须由董事长审核，请转交董事长");
          }
          if (input.decision === "refer") {
            status = "chairman_review";
          } else {
            if (row.mustChangePassword) throw new BadRequestException("请先让员工登录设置本人密码，再开通账号");
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-phone:${row.phone}`}))`;
            if (await tx.user.findUnique({ where: { phone: row.phone }, select: { id: true } })) {
              throw new ConflictException("该手机号已有账号，请联系董事长核对，不能重复开通");
            }
            const user = await tx.user.create({ data: { phone: row.phone, name: row.name,
              passwordHash: row.passwordHash, departmentId: input.departmentId, mustChangePassword: false,
              requiresChairmanManagement: roles.some((role) => IMPORTANT_EMPLOYEE_ROLES.includes(role.roleKey)) } });
            userId = user.id;
            for (const role of roles) {
              if (roleScope(role.roleKey) === "global") {
                const position = await tx.position.findUniqueOrThrow({ where: { key: role.roleKey } });
                await tx.userPosition.create({ data: { userId, positionId: position.id } });
              } else {
                const projectId = role.projectId!;
                await tx.projectMember.create({ data: { userId, projectId, positionKey: role.roleKey } });
                await tx.projectRosterMember.upsert({ where: { projectId_userId: { projectId, userId } }, create: { projectId, userId }, update: {} });
              }
            }
            status = "approved";
          }
        }
        const updated = await tx.employeeRegistration.update({ where: { id }, data: {
          status, revision: { increment: 1 }, reason, reviewedBy: actorId, reviewedAt: new Date(),
          ...(input.decision !== "return" ? { departmentId: input.departmentId, proposedRoles: roles.map((role) => ({ ...role })) } : {}),
          ...(userId ? { userId } : {})
        } });
        await this.audit.record(tx, { actorUserId: actorId, action: `employee.registration.${input.decision}`,
          businessType: "employee_registration", businessId: id,
          metadata: { revision: updated.revision, reason, status, ...(userId ? { userId } : {}) } });
        return applicationSummary(updated);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    } catch (error) {
      if (isConcurrentConflict(error)) {
        throw new ConflictException("申请或人员信息已变化，请刷新后查看最新结果");
      }
      throw error;
    }
  }

  private async validateAssignment(tx: Prisma.TransactionClient, departmentId: string | undefined, roles: EmployeeRoleDto[]) {
    if (!departmentId || !await tx.department.findFirst({ where: { id: departmentId, isActive: true } })) {
      throw new BadRequestException("请选择启用的部门");
    }
    if (!roles.length || roles.some((role) => role.roleKey === "super_admin")) {
      throw new BadRequestException("请选择业务岗位，系统管理员不通过入职申请开通");
    }
    const keys = roles.map((role) => `${role.roleKey}:${role.projectId ?? ""}`);
    if (new Set(keys).size !== keys.length) throw new BadRequestException("同一岗位和项目不能重复安排");
    for (const role of roles) {
      if (!await tx.position.findUnique({ where: { key: role.roleKey } })) throw new BadRequestException("岗位配置不存在，请联系管理员");
      if (roleScope(role.roleKey) === "global") {
        if (role.projectId) throw new BadRequestException("全公司岗位无需选择项目");
      } else if (!role.projectId || !await tx.project.findFirst({ where: { id: role.projectId, isActive: true } })) {
        throw new BadRequestException("请为项目岗位选择启用的项目");
      }
    }
  }

  private session(row: EmployeeRegistration) {
    return { application: applicationSummary(row), applicationToken: this.tokens.signApplicationToken(row.id, row.credentialVersion) };
  }
}
