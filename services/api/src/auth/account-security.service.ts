import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { recordPersonnelFact } from "../organization/personnel-fact";
import { configuredInitialUserTemporaryPassword } from "../organization/initial-user-temporary-password";
import { employeeManagerRoles, employeeTargetNeedsChairman } from "../organization/employee-management-policy";
import { AuthService } from "./auth.service";
import type { AdminChangePhoneDto, AdminResetPasswordDto, RecoveryCodeResetDto, SendSmsDto, SmsPasswordResetDto } from "./dto/account-security.dto";
import { SmsVerificationService } from "./sms-verification.service";

@Injectable()
export class AccountSecurityService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly audit: AuditService,
    private readonly sms: SmsVerificationService) {}

  options() { return { smsEnabled: this.sms.enabled(), canRegister: true, canLoginApplication: true, canUseRecoveryCode: true }; }

  async sendSms(input: SendSmsDto, address: string) {
    this.sms.assertEnabled();
    if (input.purpose === "register") {
      const [user, application] = await Promise.all([
        this.prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } }),
        this.prisma.employeeRegistration.findFirst({ where: { phone: input.phone, status: { not: "approved" } }, select: { id: true } })
      ]);
      return this.sms.send(input.phone, "register", address, `register:${input.phone}`, !user && !application);
    }
    const subject = await this.resetSubject(input.phone);
    return this.sms.send(input.phone, "reset", address, subject?.binding ?? "unavailable", Boolean(subject));
  }

  async sendPhoneChange(phone: string, actorId: string, address: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!user.isActive) throw new UnauthorizedException("账号已停用，请重新登录");
    const [existing, application] = await Promise.all([
      this.prisma.user.findUnique({ where: { phone }, select: { id: true } }),
      this.prisma.employeeRegistration.findFirst({ where: { phone, status: { not: "approved" } }, select: { userId: true } })
    ]);
    return this.sms.send(phone, "change_phone", address, `user:${actorId}:${user.sessionVersion}`,
      (!existing || existing.id === actorId) && (!application || application.userId === actorId));
  }

  private async managedPhoneTarget(tx: Prisma.TransactionClient, userId: string, actorId: string) {
    const roles = await employeeManagerRoles(tx, actorId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("人员不存在，请刷新后重试");
    if (!user.isActive) throw new BadRequestException("账号已停用，请先核对人员状态");
    if (!roles.includes("chairman") && await employeeTargetNeedsChairman(tx, userId)) {
      throw new ForbiddenException("管理层和财务账号仅由董事长变更手机号");
    }
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    return { user, actorVersion: actor.sessionVersion };
  }

  private adminPhoneBinding(userId: string, version: number, actorId: string, actorVersion: number) {
    return `admin:${actorId}:${actorVersion}:user:${userId}:${version}`;
  }

  async sendAdminPhoneChange(userId: string, actorId: string, phone: string, address: string) {
    const subject = await this.prisma.$transaction(tx => this.managedPhoneTarget(tx, userId, actorId));
    const [existing, application] = await Promise.all([
      this.prisma.user.findUnique({ where: { phone }, select: { id: true } }),
      this.prisma.employeeRegistration.findFirst({ where: { phone, status: { not: "approved" } }, select: { userId: true } })
    ]);
    return this.sms.send(phone, "change_phone", address,
      this.adminPhoneBinding(userId, subject.user.sessionVersion, actorId, subject.actorVersion),
      phone !== subject.user.phone && !existing && (!application || application.userId === userId));
  }

  async changeUserPhone(userId: string, actorId: string, input: AdminChangePhoneDto) {
    const subject = await this.prisma.$transaction(async tx => {
      const target = await this.managedPhoneTarget(tx, userId, actorId);
      await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
      return target;
    });
    if (input.phone === subject.user.phone) throw new BadRequestException("请输入与当前号码不同的新手机号");
    await this.sms.verify(input.phone, "change_phone", input.code,
      this.adminPhoneBinding(userId, subject.user.sessionVersion, actorId, subject.actorVersion));
    try {
      await this.prisma.$transaction(async tx => {
        const current = await this.managedPhoneTarget(tx, userId, actorId);
        if (current.user.sessionVersion !== subject.user.sessionVersion || current.actorVersion !== subject.actorVersion) {
          throw new ConflictException("人员或操作账号已变化，请重新获取验证码");
        }
        await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-phone:${input.phone}`}))`;
        const application = await tx.employeeRegistration.findFirst({ where: { phone: input.phone, status: { not: "approved" } }, select: { userId: true } });
        if (application && application.userId !== userId) throw new ConflictException("该手机号已有入职申请，请核对后重试");
        await tx.user.update({ where: { id: userId, isActive: true, sessionVersion: subject.user.sessionVersion },
          data: { phone: input.phone, sessionVersion: { increment: 1 } } });
        await this.revokeAndAudit(tx, userId, actorId, "auth.phone.admin_change");
        await recordPersonnelFact(tx, { actorUserId: actorId, userId, action: "profile_adjust", reason: "管理员验证新号后变更手机号",
          before: { phone: subject.user.phone }, after: { phone: input.phone } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("该手机号已被其他账号使用");
      }
      this.rejectStaleAccount(error);
    }
    return { ok: true };
  }

  async resetWithSms(input: SmsPasswordResetDto) {
    this.sms.assertEnabled();
    const subject = await this.resetSubject(input.phone);
    await this.sms.verify(input.phone, "reset", input.code, subject?.binding ?? "unavailable");
    if (!subject) throw new BadRequestException("账号状态已变化，请联系管理员核对");
    const passwordHash = await this.auth.hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      if (subject.kind === "user") {
        const current = await tx.user.findUnique({ where: { id: subject.id } });
        await this.assertInitialPasswordChanged(input.newPassword, current);
        const updated = await tx.user.updateMany({ where: { id: subject.id, phone: input.phone, isActive: true, sessionVersion: subject.version },
          data: { passwordHash, mustChangePassword: false, temporaryPasswordExpiresAt: null, sessionVersion: { increment: 1 }, recoveryCodeHash: null } });
        if (updated.count !== 1) throw new BadRequestException("账号状态已变化，请重新获取验证码");
        await this.revokeAndAudit(tx, subject.id, subject.id, "auth.password.sms_reset");
      } else {
        const current = await tx.employeeRegistration.findUnique({ where: { id: subject.id } });
        await this.assertInitialPasswordChanged(input.newPassword, current);
        const updated = await tx.employeeRegistration.updateMany({ where: { id: subject.id, phone: input.phone,
          status: { not: "approved" }, credentialVersion: subject.version },
        data: { passwordHash, mustChangePassword: false, temporaryPasswordExpiresAt: null, credentialVersion: { increment: 1 }, revision: { increment: 1 } } });
        if (updated.count !== 1) throw new BadRequestException("申请状态已变化，请重新获取验证码");
        await this.audit.record(tx, { action: "employee.registration.sms_reset", businessType: "employee_registration", businessId: subject.id });
      }
    });
    return { ok: true };
  }

  private async resetSubject(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (user) return user.isActive ? { kind: "user" as const, id: user.id, version: user.sessionVersion,
      binding: `user:${user.id}:${user.sessionVersion}` } : null;
    const row = await this.prisma.employeeRegistration.findFirst({ where: { phone, status: { not: "approved" } } });
    return row && row.status !== "approved" ? { kind: "application" as const, id: row.id, version: row.credentialVersion,
      binding: `application:${row.id}:${row.credentialVersion}` } : null;
  }

  async resetUser(userId: string, actorId: string, input: AdminResetPasswordDto) {
    if (userId === actorId) throw new ForbiddenException("请在账号设置修改本人密码，或使用本人恢复码");
    const passwordHash = await this.auth.hashPassword(configuredInitialUserTemporaryPassword());
    await this.prisma.$transaction(async (tx) => {
      const roles = await employeeManagerRoles(tx, actorId);
      await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException("人员不存在，请刷新后重试");
      if (!user.isActive) throw new BadRequestException("账号已停用，请先由有权限的负责人核对并重新启用");
      if (!roles.includes("chairman") && await employeeTargetNeedsChairman(tx, userId)) {
        throw new ForbiddenException("管理层和财务账号仅由董事长重置密码");
      }
      await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + 86_400_000), sessionVersion: { increment: 1 }, recoveryCodeHash: null } });
      await this.revokeAndAudit(tx, userId, actorId, "auth.password.admin_reset");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { ok: true, mustChangePassword: true };
  }

  async resetApplication(id: string, actorId: string, input: AdminResetPasswordDto) {
    const passwordHash = await this.auth.hashPassword(configuredInitialUserTemporaryPassword());
    await this.prisma.$transaction(async (tx) => {
      const roles = await employeeManagerRoles(tx, actorId);
      await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
      const row = await tx.employeeRegistration.findUnique({ where: { id } });
      if (!row || row.status === "approved") throw new BadRequestException("申请已变化，请刷新；已开通账号请在人员列表重置");
      if (row.status === "chairman_review" && !roles.includes("chairman")) throw new ForbiddenException("此申请请由董事长重置");
      await tx.employeeRegistration.update({ where: { id }, data: { passwordHash, mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + 86_400_000), credentialVersion: { increment: 1 }, revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId: actorId, action: "employee.registration.password_reset", businessType: "employee_registration", businessId: id });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { ok: true, mustChangePassword: true };
  }

  async createRecoveryCode(actorId: string, confirmationPassword: string) {
    const recoveryCode = randomBytes(32).toString("base64url");
    await this.prisma.$transaction(async (tx) => {
      const roles = await employeeManagerRoles(tx, actorId);
      if (!roles.includes("chairman")) throw new ForbiddenException("恢复码由董事长本人生成和保管");
      await this.auth.confirmPassword(actorId, confirmationPassword, tx);
      await tx.user.update({ where: { id: actorId }, data: { recoveryCodeHash: this.hashCode(recoveryCode) } });
      await this.audit.record(tx, { actorUserId: actorId, action: "auth.recovery_code.generate", businessType: "user", businessId: actorId });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { recoveryCode };
  }

  async recover(input: RecoveryCodeResetDto) {
    const passwordHash = await this.auth.hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { phone: input.phone } });
      if (!user?.isActive || user.recoveryCodeHash !== this.hashCode(input.recoveryCode)) throw new UnauthorizedException("手机号或恢复码不正确，或恢复码已使用");
      const roles = await employeeManagerRoles(tx, user.id);
      if (!roles.includes("chairman")) throw new UnauthorizedException("恢复码已失效，请联系董事长");
      await this.assertInitialPasswordChanged(input.newPassword, user);
      const changed = await tx.user.updateMany({ where: { id: user.id, isActive: true, recoveryCodeHash: this.hashCode(input.recoveryCode) },
        data: { passwordHash, recoveryCodeHash: null, mustChangePassword: false, temporaryPasswordExpiresAt: null, sessionVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new UnauthorizedException("恢复码已失效，请重新核对");
      await this.revokeAndAudit(tx, user.id, user.id, "auth.password.recovery_code");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { ok: true };
  }

  private async assertInitialPasswordChanged(password: string, current: { mustChangePassword: boolean; passwordHash: string | null } | null) {
    if (current?.mustChangePassword && current.passwordHash && await bcrypt.compare(password, current.passwordHash)) {
      throw new BadRequestException("新密码不能与当前密码相同，请设置本人新密码");
    }
  }

  private hashCode(value: string) { return createHash("sha256").update(value).digest("hex"); }
  private rejectStaleAccount(error: unknown): never {
    if ((typeof error === "object" && error !== null && "code" in error && ["P2034", "P2025"].includes(String(error.code)))
      || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "40001")) {
      throw new ConflictException("账号或申请状态已变化，请刷新后重新操作");
    }
    throw error;
  }
  private async revokeAndAudit(tx: Prisma.TransactionClient, userId: string, actorId: string, action: string) {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record(tx, { actorUserId: actorId, action, businessType: "user", businessId: userId });
  }
}
