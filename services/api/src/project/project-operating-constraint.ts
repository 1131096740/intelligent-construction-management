import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const PROJECT_OPERATING_CONSTRAINT_MESSAGES = [
  "启用经营账前必须先设置唯一施工企业",
  "启用经营账前必须至少设置一家我方参与公司",
  "经营账生效日必须在项目创建后通过项目设置启用",
  "施工企业生效日不得晚于经营账生效日",
  "施工企业生效日不得晚于项目已有正式经营事实日期",
  "正式经营事实发生前必须先设置唯一施工企业",
  "正式经营事实引用的施工企业已失效，请刷新后重试",
  "项目已有正式经营事实引用的施工企业与当前映射不一致，请先人工修复",
  "该公司未在本项目参与公司名单中，或已停止新增业务",
  "项目已有正式经营事实引用的公司未覆盖对应参与期间",
  "经营事实引用的我方公司未在本项目事实日参与",
  "影响分录引用的我方公司未在本项目事实日参与",
  "项目已有正式经营事实，经营账生效日不能清空",
  "项目已有正式经营事实，施工企业已经锁定，不能普通更换",
  "该公司已有正式经营事实，只能停止新增业务，不能删除",
  "停止日期当日或之后已有正式经营事实，不能截断参与期间"
] as const;

const POSTGRES_ERROR_LINK_MAX_DEPTH = 8;

export function postgresSqlState(error: unknown): "40001" | "40P01" | undefined {
  const pending: Array<{ candidate: object; depth: number }> = [];
  const visited = new Set<object>();
  if (error && typeof error === "object") {
    pending.push({ candidate: error, depth: 0 });
  }

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current.candidate)) continue;
    visited.add(current.candidate);

    const candidate = current.candidate as Record<string, unknown>;
    for (const key of ["code", "sqlstate", "sqlState"] as const) {
      const value = candidate[key];
      if (typeof value !== "string") continue;
      const normalized = value.toUpperCase();
      if (normalized === "40001" || normalized === "40P01") return normalized;
    }
    if (current.depth >= POSTGRES_ERROR_LINK_MAX_DEPTH) continue;
    for (const key of ["meta", "cause"] as const) {
      const linked = candidate[key];
      if (linked && typeof linked === "object" && !visited.has(linked)) {
        pending.push({ candidate: linked, depth: current.depth + 1 });
      }
    }
  }
  return undefined;
}

export function isPostgresSerializationFailure(error: unknown): boolean {
  return postgresSqlState(error) === "40001";
}

export function projectOperatingConstraintMessage(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    (error.code !== "P2004" && error.code !== "P2010")
  ) {
    return null;
  }
  const detail = JSON.stringify(error);
  return PROJECT_OPERATING_CONSTRAINT_MESSAGES.find((message) => detail.includes(message)) ?? null;
}

export async function translateProjectOperatingSerializationConflict<T>(
  operation: Promise<T>,
  message: string
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isPostgresSerializationFailure(error)) {
      throw new ConflictException(message, { cause: error });
    }
    throw error;
  }
}

export async function translateOperatingProfileConstraint<T>(
  operation: Promise<T>,
  options: { mapSerializationConflict?: boolean } = {}
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BadRequestException("相同公司参与期间或施工企业配置已存在，请刷新后重试");
    }
    if (options.mapSerializationConflict && isPostgresSerializationFailure(error)) {
      throw new ConflictException(
        "项目参与公司状态已被并发业务更新，请刷新后重试",
        { cause: error }
      );
    }
    const message = projectOperatingConstraintMessage(error);
    if (message) throw new BadRequestException(message);
    throw error;
  }
}
