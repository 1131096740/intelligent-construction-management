import { BadRequestException, HttpException } from "@nestjs/common";
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
  "项目已有正式经营事实，经营账生效日不能清空",
  "项目已有正式经营事实，施工企业已经锁定，不能普通更换",
  "该公司已有正式经营事实，只能停止新增业务，不能删除",
  "停止日期当日或之后已有正式经营事实，不能截断参与期间"
] as const;

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

export async function translateOperatingProfileConstraint<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BadRequestException("相同公司参与期间或施工企业配置已存在，请刷新后重试");
    }
    const message = projectOperatingConstraintMessage(error);
    if (message) throw new BadRequestException(message);
    throw error;
  }
}
