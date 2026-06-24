import { Injectable } from "@nestjs/common";
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
    const name = input.name?.trim();
    if (!name) {
      throw new Error("Company entity name is required");
    }

    return this.prisma.companyEntity.create({
      data: { name, unifiedSocialCreditCode: input.unifiedSocialCreditCode?.trim() || null }
    });
  }
}
