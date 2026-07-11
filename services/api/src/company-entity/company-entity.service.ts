import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export interface CreateCompanyEntityDto {
  name: string;
  unifiedSocialCreditCode?: string;
}

@Injectable()
export class CompanyEntityService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.companyEntity.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" }
    });
  }

  create(input: CreateCompanyEntityDto) {
    const rawName: unknown = input?.name;
    if (rawName !== undefined && typeof rawName !== "string") {
      throw new BadRequestException("公司主体名称必须是文字");
    }
    const name = rawName?.trim();
    if (!name) {
      throw new BadRequestException("请填写公司主体名称");
    }

    const rawCreditCode: unknown = input.unifiedSocialCreditCode;
    if (rawCreditCode !== undefined && typeof rawCreditCode !== "string") {
      throw new BadRequestException("统一社会信用代码必须是文字");
    }

    return this.prisma.companyEntity.create({
      data: { name, unifiedSocialCreditCode: rawCreditCode?.trim() || null }
    });
  }
}
