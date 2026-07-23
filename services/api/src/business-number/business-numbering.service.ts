import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type NumberingClient = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
};

type AllocatedSequence = { sequence: number };

@Injectable()
export class BusinessNumberingService {
  async allocateDaily(
    tx: NumberingClient,
    prefix: string,
    now = new Date()
  ): Promise<string> {
    const businessDate = chinaBusinessDate(now);
    const [allocated] = await tx.$queryRaw<AllocatedSequence[]>(Prisma.sql`
      INSERT INTO "BusinessDailySequence" ("prefix", "businessDate", "nextSequence", "updatedAt")
      VALUES (${prefix}, ${businessDate}, 2, CURRENT_TIMESTAMP)
      ON CONFLICT ("prefix", "businessDate")
      DO UPDATE SET
        "nextSequence" = "BusinessDailySequence"."nextSequence" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "nextSequence" - 1 AS "sequence"
    `);
    if (!allocated || !Number.isInteger(allocated.sequence) || allocated.sequence < 1) {
      throw new Error("正式编号日流水分配失败，请稍后重试");
    }
    return `${prefix}-${businessDate}-${String(allocated.sequence).padStart(3, "0")}`;
  }
}

export function chinaBusinessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}
