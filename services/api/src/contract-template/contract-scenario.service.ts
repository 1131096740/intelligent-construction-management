import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { canPerform, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ContractTemplateService } from "./contract-template.service";
import { lockBusinessTemplateVersion } from "./contract-template-locks";
import type {
  CreateContractBusinessScenarioDto,
  CreateContractScenarioTemplateMappingDto,
  UpdateContractBusinessScenarioDto,
  UpdateContractScenarioTemplateMappingDto
} from "./dto/contract-scenario.dto";

const GOVERNANCE_ROLES = new Set(["contract_director", "super_admin"]);

@Injectable()
export class ContractScenarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly templates: ContractTemplateService
  ) {}

  async listAvailable(projectId: string, actorUserId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertProjectCreateScope(tx, projectId, actorUserId);
        return tx.contractBusinessScenario.findMany({
          where: { active: true },
          select: { id: true, code: true, name: true, description: true },
          orderBy: [{ name: "asc" }, { id: "asc" }]
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  async recommend(
    projectId: string,
    actorUserId: string,
    scenarioId: string,
    contractTypeKey: string
  ) {
    if (!scenarioId?.trim()) throw new BadRequestException("请选择业务场景");
    if (!contractTypeKey?.trim()) throw new BadRequestException("请选择合同类型");
    return this.prisma.$transaction(async (tx) => {
    await this.assertProjectCreateScope(tx, projectId, actorUserId);
    const scenario = await tx.contractBusinessScenario.findFirst({
      where: { id: scenarioId, active: true },
      select: { id: true, code: true, name: true }
    });
    if (!scenario) throw new NotFoundException("业务场景不存在或已停用");
    const mappings = await tx.contractScenarioTemplateMapping.findMany({
      where: {
        businessScenarioId: scenario.id,
        contractTypeKey,
        active: true
      },
      select: {
        id: true,
        businessTemplateVersionId: true,
        reason: true
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const versions = mappings.length
      ? await tx.contractBusinessTemplateVersion.findMany({
          where: {
            id: { in: mappings.map((mapping) => mapping.businessTemplateVersionId) }
          },
          select: {
            id: true,
            templateId: true,
            versionNo: true,
            status: true,
            fieldSchema: true,
            billSchema: true,
            clauseSchema: true,
            attachmentSchema: true,
            validationSchema: true
          }
        })
      : [];
    const templateIds = [...new Set(versions.map((version) => version.templateId))];
    const templateRows = templateIds.length
      ? await tx.contractBusinessTemplate.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, code: true, name: true, contractTypeKey: true }
        })
      : [];
    const recommendations = mappings.flatMap((mapping) => {
      const version = versions.find((item) => item.id === mapping.businessTemplateVersionId);
      if (!version) {
        throw new BadRequestException("启用的业务场景映射缺少模板版本，请联系合同主管处理");
      }
      if (version.status !== "published") return [];
      const template = version
        ? templateRows.find((item) => item.id === version.templateId)
        : null;
      if (!template || template.contractTypeKey !== contractTypeKey) {
        throw new BadRequestException("启用的业务场景映射与合同类型不一致，请联系合同主管处理");
      }
      return [{
        mappingId: mapping.id,
        reason: mapping.reason,
        template: {
          id: template.id,
          code: template.code,
          name: template.name,
          contractTypeKey: template.contractTypeKey,
          status: "published",
          versionId: version.id,
          versionNo: version.versionNo,
          usagePreview: this.templates.publishedUsagePreview(version)
        }
      }];
    });
    return {
      scenario,
      selectionMode:
        recommendations.length === 0
          ? "unavailable"
          : recommendations.length === 1
            ? "automatic"
            : "choice_required",
      recommendations
    };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async listGovernance(actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernanceRole(tx, actorUserId);
      const scenarios = await tx.contractBusinessScenario.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          active: true,
          revision: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
      const mappings = await tx.contractScenarioTemplateMapping.findMany({
        select: {
          id: true,
          businessScenarioId: true,
          contractTypeKey: true,
          businessTemplateVersionId: true,
          reason: true,
          priority: true,
          active: true,
          revision: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ businessScenarioId: "asc" }, { priority: "desc" }, { id: "asc" }]
      });
      return scenarios.map((scenario) => ({
        ...scenario,
        mappings: mappings.filter((mapping) => mapping.businessScenarioId === scenario.id)
      }));
    });
  }

  async createScenario(actorUserId: string, input: CreateContractBusinessScenarioDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertGovernanceRole(tx, actorUserId);
        const scenario = await tx.contractBusinessScenario.create({
          data: {
            code: input.code.trim(),
            name: input.name.trim(),
            description: input.description?.trim() || null,
            active: true,
            revision: 1,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "contract.business_scenario.create",
          businessType: "contract_business_scenario",
          businessId: scenario.id,
          metadata: { revision: 1, active: true }
        });
        return this.scenarioView(scenario);
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new ConflictException("业务场景编码已存在");
      throw error;
    }
  }

  async updateScenario(
    scenarioId: string,
    actorUserId: string,
    input: UpdateContractBusinessScenarioDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernanceRole(tx, actorUserId);
      const updated = await tx.contractBusinessScenario.updateMany({
        where: { id: scenarioId, revision: input.expectedRevision },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description.trim() || null }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          revision: { increment: 1 },
          updatedByUserId: actorUserId
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("业务场景已被修改，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.business_scenario.update",
        businessType: "contract_business_scenario",
        businessId: scenarioId,
        metadata: {
          previousRevision: input.expectedRevision,
          revision: input.expectedRevision + 1,
          active: input.active ?? null
        }
      });
      const scenario = await tx.contractBusinessScenario.findUnique({ where: { id: scenarioId } });
      return scenario ? this.scenarioView(scenario) : null;
    });
  }

  async createMapping(
    scenarioId: string,
    actorUserId: string,
    input: CreateContractScenarioTemplateMappingDto
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertGovernanceRole(tx, actorUserId);
        const lockedTemplate = await lockBusinessTemplateVersion(
          tx,
          input.businessTemplateVersionId
        );
        if (
          !lockedTemplate?.template ||
          lockedTemplate.version.status !== "published"
        ) {
          throw new BadRequestException("映射必须绑定已发布业务模板版本");
        }
        const scenarioGate = await tx.contractBusinessScenario.updateMany({
          where: { id: scenarioId, revision: input.expectedScenarioRevision },
          data: { revision: { increment: 0 } }
        });
        if (scenarioGate.count !== 1) {
          throw new BadRequestException("业务场景已被修改，请刷新后再新增模板映射");
        }
        const scenario = await tx.contractBusinessScenario.findUnique({
          where: { id: scenarioId }
        });
        if (!scenario) throw new NotFoundException("业务场景不存在");
        const { template, version } = lockedTemplate;
        const mapping = await tx.contractScenarioTemplateMapping.create({
          data: {
            businessScenarioId: scenario.id,
            contractTypeKey: template.contractTypeKey,
            businessTemplateVersionId: version.id,
            reason: input.reason.trim(),
            priority: input.priority ?? 0,
            active: true,
            revision: 1,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "contract.scenario_template_mapping.create",
          businessType: "contract_scenario_template_mapping",
          businessId: mapping.id,
          metadata: {
            businessScenarioId: scenario.id,
            businessTemplateVersionId: version.id,
            contractTypeKey: template.contractTypeKey,
            revision: 1,
            active: true
          }
        });
        return this.mappingView(mapping);
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new ConflictException("该业务场景已存在相同模板映射");
      throw error;
    }
  }

  async updateMapping(
    mappingId: string,
    actorUserId: string,
    input: UpdateContractScenarioTemplateMappingDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernanceRole(tx, actorUserId);
      if (input.active === true) {
        const mappingReference = await tx.contractScenarioTemplateMapping.findUnique({
          where: { id: mappingId },
          select: { businessScenarioId: true, businessTemplateVersionId: true }
        });
        const lockedTemplate = mappingReference
          ? await lockBusinessTemplateVersion(tx, mappingReference.businessTemplateVersionId)
          : null;
        if (mappingReference) {
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "ContractBusinessScenario"
            WHERE "id" = ${mappingReference.businessScenarioId}
            FOR UPDATE
          `);
        }
        const [mapping] = mappingReference
          ? await tx.$queryRaw<
              Array<
                NonNullable<
                  Awaited<ReturnType<typeof tx.contractScenarioTemplateMapping.findUnique>>
                >
              >
            >(Prisma.sql`
              SELECT * FROM "ContractScenarioTemplateMapping"
              WHERE "id" = ${mappingId}
              FOR UPDATE
            `)
          : [];
        if (
          !mapping ||
          !lockedTemplate ||
          lockedTemplate.version.status !== "published" ||
          !lockedTemplate.template ||
          mapping.contractTypeKey !== lockedTemplate.template.contractTypeKey
        ) {
          throw new BadRequestException("重新启用映射前必须确认精确模板版本仍已发布且合同类型一致");
        }
      }
      const updated = await tx.contractScenarioTemplateMapping.updateMany({
        where: { id: mappingId, revision: input.expectedRevision },
        data: {
          ...(input.reason !== undefined ? { reason: input.reason.trim() } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          revision: { increment: 1 },
          updatedByUserId: actorUserId
        }
      });
      if (updated.count !== 1) throw new BadRequestException("模板映射已被修改，请刷新后重试");
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.scenario_template_mapping.update",
        businessType: "contract_scenario_template_mapping",
        businessId: mappingId,
        metadata: {
          previousRevision: input.expectedRevision,
          revision: input.expectedRevision + 1,
          active: input.active ?? null
        }
      });
      const mapping = await tx.contractScenarioTemplateMapping.findUnique({ where: { id: mappingId } });
      return mapping ? this.mappingView(mapping) : null;
    });
  }

  private async assertGovernanceRole(
    tx: {
      userPosition: { findMany(args: unknown): Promise<Array<{ positionId: string }>> };
      position: { findMany(args: unknown): Promise<Array<{ key: string }>> };
    },
    actorUserId: string
  ) {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (!positions.some((position) => GOVERNANCE_ROLES.has(position.key))) {
      throw new ForbiddenException("只有全局合同主管或超级管理员可以治理合同业务场景");
    }
  }

  private async assertProjectCreateScope(
    tx: {
      project: { findUnique(args: unknown): Promise<{ id: string; isActive: boolean } | null> };
      userPosition: {
        findMany(args: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(args: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(args: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    projectId: string,
    actorUserId: string
  ) {
    if (!projectId?.trim()) throw new BadRequestException("请选择项目后再读取业务场景");
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, isActive: true }
    });
    if (!project?.isActive) throw new BadRequestException("项目不存在或已停用");
    const [assignments, members] = await Promise.all([
      tx.userPosition.findMany({
        where: { userId: actorUserId, OR: [{ projectId: null }, { projectId }] }
      }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key]));
    const globalRoleKeys = assignments
      .filter((assignment) => assignment.projectId === null)
      .map((assignment) => positionKeyById.get(assignment.positionId))
      .filter((key): key is RoleKey => Boolean(key)) as RoleKey[];
    const projectRoleKeys = [
      ...assignments
        .filter((assignment) => assignment.projectId === projectId)
        .map((assignment) => positionKeyById.get(assignment.positionId))
        .filter((key): key is RoleKey => Boolean(key)),
      ...members.map((member) => member.positionKey as RoleKey)
    ];
    if (!canPerform("contract.create", resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys))) {
      throw new ForbiddenException("当前账号缺少在该项目创建合同的权限");
    }
  }

  private isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }

  private scenarioView(scenario: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    active: boolean;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: scenario.id,
      code: scenario.code,
      name: scenario.name,
      description: scenario.description,
      active: scenario.active,
      revision: scenario.revision,
      createdAt: scenario.createdAt,
      updatedAt: scenario.updatedAt
    };
  }

  private mappingView(mapping: {
    id: string;
    businessScenarioId: string;
    contractTypeKey: string;
    businessTemplateVersionId: string;
    reason: string;
    priority: number;
    active: boolean;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: mapping.id,
      businessScenarioId: mapping.businessScenarioId,
      contractTypeKey: mapping.contractTypeKey,
      businessTemplateVersionId: mapping.businessTemplateVersionId,
      reason: mapping.reason,
      priority: mapping.priority,
      active: mapping.active,
      revision: mapping.revision,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt
    };
  }
}
