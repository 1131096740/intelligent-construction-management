import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { AuthRateLimitService } from "./auth-rate-limit.service";
import { TencentSmsGateway } from "./tencent-sms.gateway";

export type SmsPurpose = "register" | "reset" | "change_phone";

@Injectable()
export class SmsVerificationService {
  constructor(private readonly prisma: PrismaService, private readonly limits: AuthRateLimitService, private readonly gateway: TencentSmsGateway) {}

  enabled() {
    return process.env.SMS_ENABLED === "true" && ["SMS_SECRET_ID", "SMS_SECRET_KEY", "SMS_SDK_APP_ID", "SMS_SIGN_NAME", "SMS_TEMPLATE_ID"]
      .every((key) => Boolean(process.env[key]?.trim())) && (process.env.SMS_CODE_SECRET?.length ?? 0) >= 32;
  }

  assertEnabled() {
    if (!this.enabled()) throw new ServiceUnavailableException("短信验证暂未开通，请联系综合部或董事长核验身份、重置密码");
  }

  async send(phone: string, purpose: SmsPurpose, address: string, binding: string, eligible = true) {
    this.assertEnabled();
    await this.limits.take([
      { scope: "sms-global-day", value: "all", seconds: 86400, max: 200 },
      { scope: "sms-ip-hour", value: address, seconds: 3600, max: 100 },
      { scope: "sms-phone-day", value: phone, seconds: 86400, max: 5 },
      { scope: "sms-phone-minute", value: phone, seconds: 60, max: 1 }
    ]);
    if (!eligible) return { ok: true, retryAfterSeconds: 60 };
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const id = randomUUID();
    const now = new Date();
    const data = { id, binding, codeHash: this.hash(`${id}:${phone}:${purpose}:${code}`), attempts: 0,
      delivered: false, consumedAt: null, createdAt: now, expiresAt: new Date(now.getTime() + 300_000) };
    const reserved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sms:${phone}`}))`;
      const previous = await tx.smsChallenge.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } });
      if (previous && previous.createdAt.getTime() + 60_000 > now.getTime()) return false;
      await tx.smsChallenge.upsert({ where: { phone_purpose: { phone, purpose } },
        create: { ...data, phone, purpose }, update: data });
      return true;
    });
    if (!reserved) throw new BadRequestException("请等待60秒后再获取验证码");
    await this.gateway.send(phone, code);
    await this.prisma.smsChallenge.updateMany({ where: { id, consumedAt: null }, data: { delivered: true } });
    return { ok: true, retryAfterSeconds: 60 };
  }

  async verify(phone: string, purpose: SmsPurpose, code: string | undefined, binding: string) {
    this.assertEnabled();
    if (!code || !/^\d{6}$/u.test(code)) throw new BadRequestException("请输入6位短信验证码");
    const valid = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SmsChallenge" WHERE "phone" = ${phone} AND "purpose" = ${purpose} FOR UPDATE`;
      const row = await tx.smsChallenge.findUnique({ where: { phone_purpose: { phone, purpose } } });
      if (!row || !row.delivered || row.consumedAt || row.expiresAt <= new Date() || row.attempts >= 5) return false;
      const expected = Buffer.from(this.hash(`${row.id}:${phone}:${purpose}:${code}`), "hex");
      const stored = Buffer.from(row.codeHash, "hex");
      const matches = row.binding === binding && expected.length === stored.length && timingSafeEqual(expected, stored);
      await tx.smsChallenge.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, ...(matches ? { consumedAt: new Date() } : {}) } });
      return matches;
    });
    if (!valid) throw new BadRequestException("验证码不正确、已使用或已过期，请重新获取");
  }

  private hash(value: string) { return createHmac("sha256", process.env.SMS_CODE_SECRET!).update(value).digest("hex"); }
}
