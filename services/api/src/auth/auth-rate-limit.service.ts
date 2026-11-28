import { HttpException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { observeTask12AuthTransaction } from "../database/task12-auth-transaction-phase";
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

  async take(limits: Array<{ scope: string; value: string; seconds: number; max: number }>, request?: object) {
    const now = Date.now();
    const phase = observeTask12AuthTransaction(request);
    let allowed: boolean;
    try { allowed = await this.prisma.$transaction(async (tx) => {
      phase.step("CALLBACK_ENTERED");phase.step("DELETE_PENDING");
      await tx.authRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now - 86400_000) } } });
      phase.step("DELETE_RETURNED");
      let ordinal=0;
      for (const limit of limits) {
        const window = Math.floor(now / (limit.seconds * 1000));
        const hash = createHash("sha256").update(limit.value).digest("hex");
        const key = `${limit.scope}:${hash}:${window}`;
        ordinal++;phase.step(ordinal===1?"UPSERT_1_PENDING":"UPSERT_2_PENDING",ordinal);
        const result = await tx.authRateLimit.upsert({ where: { key },
          create: { key, hits: 1, expiresAt: new Date((window + 1) * limit.seconds * 1000) },
          update: { hits: { increment: 1 } } });
        phase.step(ordinal===1?"UPSERT_1_RETURNED":"UPSERT_2_RETURNED",ordinal);
        if (result.hits > limit.max) { phase.step("CALLBACK_RETURNED");return false; }
      }
      phase.step("CALLBACK_RETURNED");return true;
    });phase.step("TX_RESOLVED");
    } catch(error) { phase.capture(error);throw error; }
    if (!allowed) throw new HttpException("操作过于频繁，请稍后再试或联系管理员", 429);
  }
}
