import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export type WageConflictBucketInput = {
  projectId: string;
  wageMonth: Date | string;
};

export type WageConflictBucket = {
  projectId: string;
  wageMonth: string;
};

const WAGE_CONFLICT_LOCK_VERSION = "v1";

/**
 * All formal wage sources share this transaction-scoped lock namespace.
 * Callers must re-read the competing source after this function resolves.
 */
export async function lockWageConflictBuckets(
  tx: Prisma.TransactionClient,
  buckets: readonly WageConflictBucketInput[]
): Promise<readonly WageConflictBucket[]> {
  const normalized = new Map<string, WageConflictBucket>();
  for (const bucket of buckets) {
    const projectId = bucket.projectId.trim();
    if (!projectId) throw new ConflictException("工资冲突锁缺少项目范围，必须失败关闭");
    const wageMonth = normalizeWageConflictMonth(bucket.wageMonth);
    normalized.set(`${projectId}\u0000${wageMonth}`, { projectId, wageMonth });
  }
  const ordered = [...normalized.values()].sort((left, right) => {
    if (left.projectId !== right.projectId) return left.projectId < right.projectId ? -1 : 1;
    return left.wageMonth < right.wageMonth ? -1 : left.wageMonth > right.wageMonth ? 1 : 0;
  });
  for (const bucket of ordered) {
    const key = `wage-conflict:${WAGE_CONFLICT_LOCK_VERSION}:${bucket.projectId}:${bucket.wageMonth}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  return ordered;
}

function normalizeWageConflictMonth(value: Date | string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new ConflictException("工资冲突锁月份无效，必须失败关闭");
    return value.toISOString().slice(0, 7);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ConflictException("工资冲突锁月份必须是 UTC YYYY-MM，必须失败关闭");
  }
  return value;
}
