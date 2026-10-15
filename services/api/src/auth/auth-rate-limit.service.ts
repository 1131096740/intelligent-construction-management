import { HttpException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { PrismaService } from "../database/prisma.service";

export interface AccountHttpRequest {
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  route?: { path?: string };
  path?: string;
  body?: Record<string, unknown>;
}
export function accountClientAddress(request: AccountHttpRequest) {
  const peer = request.socket?.remoteAddress ?? "unknown";
  const forwarded = request.headers?.["x-real-ip"];
  // 仅信任本机反向代理覆盖写入的真实地址，公网请求的同名头一律忽略。
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) && typeof forwarded === "string" && isIP(forwarded)
    ? forwarded : peer;
}

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async take(limits: Array<{ scope: string; value: string; seconds: number; max: number }>) {
    const now = Date.now();
    const allowed = await this.prisma.$transaction(async (tx) => {
      await tx.authRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now - 86400_000) } } });
      for (const limit of limits) {
        const window = Math.floor(now / (limit.seconds * 1000));
        const hash = createHash("sha256").update(limit.value).digest("hex");
        const key = `${limit.scope}:${hash}:${window}`;
        const result = await tx.authRateLimit.upsert({ where: { key },
          create: { key, hits: 1, expiresAt: new Date((window + 1) * limit.seconds * 1000) },
          update: { hits: { increment: 1 } } });
        if (result.hits > limit.max) return false;
      }
      return true;
    });
    if (!allowed) throw new HttpException("操作过于频繁，请稍后再试或联系管理员", 429);
  }
}
