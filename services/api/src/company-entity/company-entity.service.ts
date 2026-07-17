import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CompanyEntityAccess } from "./company-entity-access";
import type {
  CompanyEntityManagementQueryDto,
  CreateCompanyEntityDto,
  UpdateCompanyEntityDto,
  UpdateCompanyEntityStatusDto
} from "./dto/company-entity.dto";
import { assertValidUnifiedSocialCreditCode } from "./unified-social-credit-code";

const COMPANY_ENTITY_SELECT = {
  id: true,
  name: true,
  unifiedSocialCreditCode: true,
  registeredAddress: true,
  dataStatus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

const COMPANY_ENTITY_VERSION_SELECT = {
  id: true,
  companyEntityId: true,
  versionNo: true,
  name: true,
  unifiedSocialCreditCode: true,
  registeredAddress: true,
  isActive: true,
  action: true,
  actorUserId: true,
  actorRoleKey: true,
  createdAt: true
} as const;

const DUPLICATE_NAME_WARNING =
  "存在同名我方公司主体，请按统一社会信用代码判断是否为同一主体";
const CREDIT_CODE_CONFLICT_MESSAGE =
  "统一社会信用代码已被其他我方公司主体使用，请核对是否应修改现有主体或改用另一真实主体";
const CONCURRENT_CHANGE_MESSAGE =
  "我方公司主体资料已发生变化，请刷新列表后重试";
const COMPANY_ENTITY_NOT_FOUND_MESSAGE =
  "未找到我方公司主体，请刷新列表后重试";

type NormalizedCompanyEntityFacts = {
  name: string;
  unifiedSocialCreditCode: string;
  registeredAddress: string | null;
};

function readCompanyEntityField(input: unknown, field: string): unknown {
  try {
    if (input === null || input === undefined) return undefined;
    return (input as Record<string, unknown>)[field];
  } catch {
    throw new BadRequestException("公司主体信息格式不正确");
  }
}

function prismaErrorCode(error: unknown): string | undefined {
  try {
    if (!error || typeof error !== "object" || !("code" in error)) return undefined;
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class CompanyEntityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyEntityAccess,
    private readonly audit: AuditService
  ) {}

  listActive() {
    return this.prisma.companyEntity.findMany({
      where: { isActive: true },
      select: COMPANY_ENTITY_SELECT,
      orderBy: { createdAt: "asc" }
    });
  }

  async listForManagement(
    actorUserId: string,
    query: CompanyEntityManagementQueryDto = {}
  ) {
    await this.access.assertCanRead(actorUserId);
    const { keyword, status } = this.normalizeManagementQuery(query);
    const historicalEntityIds = keyword
      ? await this.prisma.companyEntityVersion.findMany({
          where: {
            OR: [
              { name: { contains: keyword, mode: "insensitive" } },
              {
                unifiedSocialCreditCode: {
                  contains: keyword.toUpperCase(),
                  mode: "insensitive"
                }
              }
            ]
          },
          select: { companyEntityId: true },
          distinct: ["companyEntityId"]
        })
      : [];

    const where: Prisma.CompanyEntityWhereInput = {};
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: "insensitive" } },
        {
          unifiedSocialCreditCode: {
            contains: keyword.toUpperCase(),
            mode: "insensitive"
          }
        },
        { id: { in: historicalEntityIds.map((row) => row.companyEntityId) } }
      ];
    }

    return this.prisma.companyEntity.findMany({
      where,
      select: COMPANY_ENTITY_SELECT,
      orderBy: { updatedAt: "desc" }
    });
  }

  async history(companyEntityId: string, actorUserId: string) {
    await this.access.assertCanRead(actorUserId);
    const entity = await this.prisma.companyEntity.findUnique({
      where: { id: companyEntityId },
      select: COMPANY_ENTITY_SELECT
    });
    if (!entity) throw new NotFoundException(COMPANY_ENTITY_NOT_FOUND_MESSAGE);
    const versions = await this.prisma.companyEntityVersion.findMany({
      where: { companyEntityId },
      select: COMPANY_ENTITY_VERSION_SELECT,
      orderBy: { versionNo: "desc" }
    });
    return { entity, versions };
  }

  async create(actorUserId: string, input: CreateCompanyEntityDto) {
    const facts = this.normalizeFacts(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const actorRoleKey = await this.access.assertCanMaintain(actorUserId, tx);
        await this.assertCreditCodeAvailable(
          tx,
          facts.unifiedSocialCreditCode
        );
        const warning = await this.duplicateNameWarning(tx, facts.name);
        const entity = await this.mapMainEntityCreditCodeConflict(() =>
          tx.companyEntity.create({
            data: {
              ...facts,
              dataStatus: "complete",
              currentVersionNo: 1,
              isActive: true
            }
          })
        );
        await tx.companyEntityVersion.create({
          data: {
            companyEntityId: entity.id,
            versionNo: 1,
            ...facts,
            isActive: true,
            action: "create",
            actorUserId,
            actorRoleKey
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "company_entity.create",
          businessType: "company_entity",
          businessId: entity.id,
          metadata: { versionNo: 1, actorRoleKey }
        });
        return { entity, warning };
      });
    } catch (error) {
      this.rethrowTransactionConflict(error);
    }
  }

  async update(
    companyEntityId: string,
    actorUserId: string,
    input: UpdateCompanyEntityDto
  ) {
    const facts = this.normalizeFacts(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const actorRoleKey = await this.access.assertCanMaintain(actorUserId, tx);
        const current = await this.lockAndLoad(tx, companyEntityId);
        await this.assertCreditCodeAvailable(
          tx,
          facts.unifiedSocialCreditCode,
          companyEntityId
        );
        const warning = await this.duplicateNameWarning(
          tx,
          facts.name,
          companyEntityId
        );
        const versionNo = current.currentVersionNo + 1;
        const entity = await this.mapMainEntityCreditCodeConflict(() =>
          tx.companyEntity.update({
            where: { id: companyEntityId },
            data: {
              ...facts,
              dataStatus: "complete",
              currentVersionNo: versionNo
            }
          })
        );
        await tx.companyEntityVersion.create({
          data: {
            companyEntityId,
            versionNo,
            ...facts,
            isActive: current.isActive,
            action: "update",
            actorUserId,
            actorRoleKey
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "company_entity.update",
          businessType: "company_entity",
          businessId: companyEntityId,
          metadata: { versionNo, actorRoleKey }
        });
        return { entity, warning };
      });
    } catch (error) {
      this.rethrowTransactionConflict(error);
    }
  }

  async updateStatus(
    companyEntityId: string,
    actorUserId: string,
    input: UpdateCompanyEntityStatusDto
  ) {
    const rawIsActive = readCompanyEntityField(input, "isActive");
    if (typeof rawIsActive !== "boolean") {
      throw new BadRequestException("公司主体状态必须是布尔值，请重新选择");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const actorRoleKey = await this.access.assertCanMaintain(actorUserId, tx);
        const current = await this.lockAndLoad(tx, companyEntityId);
        if (current.isActive === rawIsActive) {
          return { entity: current, unchanged: true };
        }

        const versionNo = current.currentVersionNo + 1;
        const action = rawIsActive ? "enable" : "disable";
        const entity = await tx.companyEntity.update({
          where: { id: companyEntityId },
          data: { isActive: rawIsActive, currentVersionNo: versionNo }
        });
        await tx.companyEntityVersion.create({
          data: {
            companyEntityId,
            versionNo,
            name: current.name,
            unifiedSocialCreditCode: current.unifiedSocialCreditCode,
            registeredAddress: current.registeredAddress,
            isActive: rawIsActive,
            action,
            actorUserId,
            actorRoleKey
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: `company_entity.${action}`,
          businessType: "company_entity",
          businessId: companyEntityId,
          metadata: { versionNo, actorRoleKey }
        });
        return { entity, unchanged: false };
      });
    } catch (error) {
      this.rethrowTransactionConflict(error);
    }
  }

  private normalizeFacts(
    input: CreateCompanyEntityDto | UpdateCompanyEntityDto
  ): NormalizedCompanyEntityFacts {
    const rawName = readCompanyEntityField(input, "name");
    if (rawName !== undefined && typeof rawName !== "string") {
      throw new BadRequestException("公司主体名称必须是文字");
    }
    const name = rawName?.trim();
    if (!name) throw new BadRequestException("请填写公司主体名称");

    const rawCreditCode = readCompanyEntityField(
      input,
      "unifiedSocialCreditCode"
    );
    if (
      rawCreditCode !== undefined &&
      typeof rawCreditCode !== "string"
    ) {
      throw new BadRequestException("统一社会信用代码必须是文字");
    }
    if (!rawCreditCode?.trim()) {
      throw new BadRequestException("请填写统一社会信用代码");
    }
    const unifiedSocialCreditCode = assertValidUnifiedSocialCreditCode(
      rawCreditCode
    );

    const rawRegisteredAddress = readCompanyEntityField(
      input,
      "registeredAddress"
    );
    if (
      rawRegisteredAddress !== undefined &&
      rawRegisteredAddress !== null &&
      typeof rawRegisteredAddress !== "string"
    ) {
      throw new BadRequestException("注册地址必须是文字");
    }
    const registeredAddress =
      typeof rawRegisteredAddress === "string"
        ? rawRegisteredAddress.trim() || null
        : null;
    return { name, unifiedSocialCreditCode, registeredAddress };
  }

  private normalizeManagementQuery(query: CompanyEntityManagementQueryDto) {
    const rawKeyword = readCompanyEntityField(query, "keyword");
    if (rawKeyword !== undefined && typeof rawKeyword !== "string") {
      throw new BadRequestException("公司主体搜索关键字必须是文字");
    }
    const rawStatus = readCompanyEntityField(query, "status");
    if (
      rawStatus !== undefined &&
      (typeof rawStatus !== "string" ||
        !["all", "active", "inactive"].includes(rawStatus))
    ) {
      throw new BadRequestException(
        "公司主体状态筛选不正确，请选择全部、启用或停用"
      );
    }
    return {
      keyword: rawKeyword?.trim() || undefined,
      status: (rawStatus ?? "all") as "all" | "active" | "inactive"
    };
  }

  private async lockAndLoad(
    tx: Prisma.TransactionClient,
    companyEntityId: string
  ) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "CompanyEntity"
      WHERE "id" = ${companyEntityId}
      FOR UPDATE
    `);
    if (!locked[0]) {
      throw new NotFoundException(COMPANY_ENTITY_NOT_FOUND_MESSAGE);
    }
    const entity = await tx.companyEntity.findUnique({
      where: { id: companyEntityId }
    });
    if (!entity) throw new NotFoundException(COMPANY_ENTITY_NOT_FOUND_MESSAGE);
    return entity;
  }

  private async assertCreditCodeAvailable(
    tx: Prisma.TransactionClient,
    unifiedSocialCreditCode: string,
    excludedCompanyEntityId?: string
  ) {
    const duplicate = await tx.companyEntity.findFirst({
      where: {
        ...(excludedCompanyEntityId
          ? { id: { not: excludedCompanyEntityId } }
          : {}),
        unifiedSocialCreditCode
      },
      select: { id: true }
    });
    if (duplicate) throw new ConflictException(CREDIT_CODE_CONFLICT_MESSAGE);
  }

  private async duplicateNameWarning(
    tx: Prisma.TransactionClient,
    name: string,
    excludedCompanyEntityId?: string
  ) {
    const duplicate = await tx.companyEntity.findFirst({
      where: {
        ...(excludedCompanyEntityId
          ? { id: { not: excludedCompanyEntityId } }
          : {}),
        name: { equals: name, mode: "insensitive" }
      },
      select: { id: true }
    });
    return duplicate ? DUPLICATE_NAME_WARNING : null;
  }

  private async mapMainEntityCreditCodeConflict<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (prismaErrorCode(error) === "P2002") {
        throw new ConflictException(CREDIT_CODE_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  private rethrowTransactionConflict(error: unknown): never {
    if (error instanceof ConflictException) throw error;
    if (prismaErrorCode(error) === "P2002") {
      throw new ConflictException(CONCURRENT_CHANGE_MESSAGE);
    }
    throw error;
  }
}
