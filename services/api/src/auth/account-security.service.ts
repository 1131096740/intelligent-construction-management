import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { employeeManagerRoles, employeeTargetNeedsChairman } from "../organization/employee-management-policy";
import { AuthService } from "./auth.service";
import type { AdminResetPasswordDto, RecoveryCodeResetDto, SendSmsDto, SmsPasswordResetDto } from "./dto/account-security.dto";
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
        this.prisma.employeeRegistration.findUnique({ where: { phone: input.phone }, select: { id: true } })
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
      this.prisma.employeeRegistration.findUnique({ where: { phone }, select: { userId: true } })
    ]);
    return this.sms.send(phone, "change_phone", address, `user:${actorId}:${user.sessionVersion}`,
      (!existing || existing.id === actorId) && (!application || application.userId === actorId));
  }

  async resetWithSms(input: SmsPasswordResetDto) {
    this.sms.assertEnabled();
    const subject = await this.resetSubject(input.phone);
    await this.sms.verify(input.phone, "reset", input.code, subject?.binding ?? "unavailable");
    if (!subject) throw new BadRequestException("账号状态已变化，请联系管理员核对");
    const passwordHash = await this.auth.hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      if (subject.kind === "user") {
        const updated = await tx.user.updateMany({ where: { id: subject.id, phone: input.phone, isActive: true, sessionVersion: subject.version },
          data: { passwordHash, mustChangePassword: false, temporaryPasswordExpiresAt: null, sessionVersion: { increment: 1 }, recoveryCodeHash: null } });
        if (updated.count !== 1) throw new BadRequestException("账号状态已变化，请重新获取验证码");
        await this.revokeAndAudit(tx, subject.id, subject.id, "auth.password.sms_reset");
      } else {
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
    const row = await this.prisma.employeeRegistration.findUnique({ where: { phone } });
    return row && row.status !== "approved" ? { kind: "application" as const, id: row.id, version: row.credentialVersion,
      binding: `application:${row.id}:${row.credentialVersion}` } : null;
  }

  async resetUser(userId: string, actorId: string, input: AdminResetPasswordDto) {
    if (userId === actorId) throw new ForbiddenException("请在账号设置修改本人密码，或使用本人恢复码");
    const temporaryPassword = randomBytes(12).toString("base64url");
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
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
        temporaryPasswordExpiresAt: expiresAt, sessionVersion: { increment: 1 }, recoveryCodeHash: null } });
      await this.revokeAndAudit(tx, userId, actorId, "auth.password.admin_reset");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { temporaryPassword, expiresAt };
  }

  async resetApplication(id: string, actorId: string, input: AdminResetPasswordDto) {
    const temporaryPassword = randomBytes(12).toString("base64url");
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      const roles = await employeeManagerRoles(tx, actorId);
      await this.auth.confirmPassword(actorId, input.confirmationPassword, tx);
      const row = await tx.employeeRegistration.findUnique({ where: { id } });
      if (!row || row.status === "approved") throw new BadRequestException("申请已变化，请刷新；已开通账号请在人员列表重置");
      if (row.status === "chairman_review" && !roles.includes("chairman")) throw new ForbiddenException("此申请请由董事长重置");
      await tx.employeeRegistration.update({ where: { id }, data: { passwordHash, mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + 86400_000), credentialVersion: { increment: 1 }, revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId: actorId, action: "employee.registration.password_reset", businessType: "employee_registration", businessId: id });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { temporaryPassword };
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
      const changed = await tx.user.updateMany({ where: { id: user.id, isActive: true, recoveryCodeHash: this.hashCode(input.recoveryCode) },
        data: { passwordHash, recoveryCodeHash: null, mustChangePassword: false, temporaryPasswordExpiresAt: null, sessionVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new UnauthorizedException("恢复码已失效，请重新核对");
      await this.revokeAndAudit(tx, user.id, user.id, "auth.password.recovery_code");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(this.rejectStaleAccount);
    return { ok: true };
  }

  private hashCode(value: string) { return createHash("sha256").update(value).digest("hex"); }
  private rejectStaleAccount(error: unknown): never {
    if (typeof error === "object" && error !== null && "code" in error && ["P2034", "P2025"].includes(String(error.code))) {
      throw new ConflictException("账号或申请状态已变化，请刷新后重新操作");
    }
    throw error;
  }
  private async revokeAndAudit(tx: Prisma.TransactionClient, userId: string, actorId: string, action: string) {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record(tx, { actorUserId: actorId, action, businessType: "user", businessId: userId });
  }
}
