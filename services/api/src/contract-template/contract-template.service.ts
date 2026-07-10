import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { validateContractTemplateSchema, type ContractTemplateSchema } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type {
  CreateBusinessTemplateDto,
  CreateStandardClauseDto,
  PublishTemplateVersionDto,
  UpdateBusinessTemplateVersionDto
} from "./dto/contract-template.dto";

type Delegate = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(args: unknown): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUnique(args: unknown): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany(args: unknown): Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(args: unknown): Promise<any>;
};

type ContractTemplateTx = {
  userPosition: { findMany(args: unknown): Promise<Array<{ positionId: string }>> };
  position: { findMany(args: unknown): Promise<Array<{ key: string }>> };
  contractBusinessTemplate: Pick<Delegate, "create">;
  contractBusinessTemplateVersion: Pick<Delegate, "create" | "findUnique" | "findMany" | "update">;
  standardClause: Pick<Delegate, "create" | "findMany">;
  standardClauseVersion: Pick<Delegate, "create" | "findUnique" | "update">;
};

@Injectable()
export class ContractTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  // ---------------------------------------------------------------------------
  // Global role check
  // ---------------------------------------------------------------------------

  private async assertGlobalRole(
    tx: {
      userPosition: { findMany: (args: { where: Record<string, unknown> }) => Promise<Array<{ positionId: string }>> };
      position: { findMany: (args: { where: Record<string, unknown> }) => Promise<Array<{ key: string }>> };
    },
    actorUserId: string,
    roleKey: string
  ): Promise<void> {
    const positions = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    if (!positions.length) {
      throw new ForbiddenException(this.roleErrorMessage(roleKey));
    }
    const positionIds = positions.map((p: { positionId: string }) => p.positionId);
    const positionRows = await tx.position.findMany({
      where: { id: { in: positionIds } }
    });
    const hasRole = positionRows.some((p: { key: string }) => p.key === roleKey);
    if (!hasRole) {
      throw new ForbiddenException(this.roleErrorMessage(roleKey));
    }
  }

  private roleErrorMessage(roleKey: string) {
    return roleKey === "contract_staff"
      ? "只有合同经办人可以执行该模板操作"
      : "只有合同主管可以执行该模板操作";
  }

  // ---------------------------------------------------------------------------
  // Schema helpers
  // ---------------------------------------------------------------------------

  private versionToSchema(v: {
    fieldSchema: unknown;
    billSchema: unknown;
    clauseSchema: unknown;
    attachmentSchema: unknown;
    validationSchema: unknown;
  }): ContractTemplateSchema {
    return {
      fields: v.fieldSchema as ContractTemplateSchema["fields"],
      bills: v.billSchema as ContractTemplateSchema["bills"],
      clauses: v.clauseSchema as ContractTemplateSchema["clauses"],
      attachments: v.attachmentSchema as ContractTemplateSchema["attachments"],
      validations: v.validationSchema as ContractTemplateSchema["validations"]
    };
  }

  private schemaToFields(schema: ContractTemplateSchema) {
    return {
      fieldSchema: schema.fields as never,
      billSchema: schema.bills as never,
      clauseSchema: schema.clauses as never,
      attachmentSchema: schema.attachments as never,
      validationSchema: schema.validations as never
    };
  }

  // ---------------------------------------------------------------------------
  // Business template read
  // ---------------------------------------------------------------------------

  async listPublished(contractTypeKey?: string) {
    const publishedVersions = await this.prisma.contractBusinessTemplateVersion.findMany({
      where: { status: "published" },
      select: { id: true, templateId: true, versionNo: true },
      orderBy: { versionNo: "desc" }
    });
    const versionByTemplateId = new Map<
      string,
      { id: string; templateId: string; versionNo: number }
    >();
    for (const version of publishedVersions as Array<{
      id: string;
      templateId: string;
      versionNo: number;
    }>) {
      if (!versionByTemplateId.has(version.templateId)) {
        versionByTemplateId.set(version.templateId, version);
      }
    }
    const publishedTemplateIds = [...versionByTemplateId.keys()];
    if (!publishedTemplateIds.length) {
      return [];
    }
    const templates = await this.prisma.contractBusinessTemplate.findMany({
      where: {
        id: { in: publishedTemplateIds },
        ...(contractTypeKey ? { contractTypeKey } : {})
      },
      orderBy: { createdAt: "asc" }
    });
    return templates.map((template: { id: string }) => {
      const version = versionByTemplateId.get(template.id);
      return { ...template, versionId: version?.id, versionNo: version?.versionNo };
    });
  }

  getTemplate(templateId: string) {
    return this.prisma.contractBusinessTemplate.findUnique({
      where: { id: templateId }
    });
  }

  // ---------------------------------------------------------------------------
  // Business template mutations
  // ---------------------------------------------------------------------------

  async createTemplate(actorUserId: string, input: CreateBusinessTemplateDto) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      validateContractTemplateSchema(input.schema);

      const template = await tx.contractBusinessTemplate.create({
        data: {
          code: input.code,
          name: input.name,
          contractTypeKey: input.contractTypeKey,
          status: "draft",
          createdByUserId: actorUserId
        }
      });

      const version = await tx.contractBusinessTemplateVersion.create({
        data: {
          templateId: template.id,
          versionNo: 1,
          status: "draft",
          ...this.schemaToFields(input.schema)
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.create",
        businessType: "contract_business_template",
        businessId: template.id,
        metadata: { code: input.code, name: input.name }
      });

      return { template, version };
    });
  }

  async updateDraftVersion(
    versionId: string,
    actorUserId: string,
    input: UpdateBusinessTemplateVersionDto
  ) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的业务模板版本可以编辑");
      }

      const updated = await tx.contractBusinessTemplateVersion.update({
        where: { id: versionId },
        data: {
          ...this.schemaToFields(input.schema),
          changeSummary: input.changeSummary ?? null
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.update_draft",
        businessType: "contract_business_template_version",
        businessId: versionId
      });

      return updated;
    });
  }

  async cloneVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const source = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!source) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (source.status !== "published") {
        throw new BadRequestException("只有已发布的业务模板版本可以复制为新草稿");
      }

      const existing = await tx.contractBusinessTemplateVersion.findMany({
        where: { templateId: source.templateId },
        orderBy: { versionNo: "desc" }
      });
      const nextVersionNo = (existing[0]?.versionNo ?? 0) + 1;

      const newVersion = await tx.contractBusinessTemplateVersion.create({
        data: {
          templateId: source.templateId,
          versionNo: nextVersionNo,
          status: "draft",
          fieldSchema: source.fieldSchema as never,
          billSchema: source.billSchema as never,
          clauseSchema: source.clauseSchema as never,
          attachmentSchema: source.attachmentSchema as never,
          validationSchema: source.validationSchema as never
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.clone_version",
        businessType: "contract_business_template_version",
        businessId: newVersion.id,
        metadata: { sourceVersionId: versionId }
      });

      return newVersion;
    });
  }

  async submitVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的业务模板版本可以提交");
      }

      validateContractTemplateSchema(this.versionToSchema(version));

      const updated = await tx.contractBusinessTemplateVersion.update({
        where: { id: versionId },
        data: {
          status: "submitted",
          submittedByUserId: actorUserId
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.submit_version",
        businessType: "contract_business_template_version",
        businessId: versionId
      });

      return updated;
    });
  }

  async publishVersion(versionId: string, actorUserId: string, input: PublishTemplateVersionDto) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "submitted") {
        throw new BadRequestException("只有已提交的业务模板版本可以发布");
      }

      validateContractTemplateSchema(this.versionToSchema(version));

      const updated = await tx.contractBusinessTemplateVersion.update({
        where: { id: versionId },
        data: {
          status: "published",
          publishedByUserId: actorUserId,
          publishedAt: new Date(),
          changeSummary: input.changeSummary
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.publish_version",
        businessType: "contract_business_template_version",
        businessId: versionId,
        metadata: { changeSummary: input.changeSummary }
      });

      return updated;
    });
  }

  async stopVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "published") {
        throw new BadRequestException("只有已发布的业务模板版本可以停用");
      }

      const updated = await tx.contractBusinessTemplateVersion.update({
        where: { id: versionId },
        data: {
          status: "stopped",
          stoppedAt: new Date()
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.stop_version",
        businessType: "contract_business_template_version",
        businessId: versionId
      });

      return updated;
    });
  }

  async revokeVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "published") {
        throw new BadRequestException("只有已发布的业务模板版本可以撤回");
      }

      const updated = await tx.contractBusinessTemplateVersion.update({
        where: { id: versionId },
        data: {
          status: "revoked",
          revokedAt: new Date()
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "contract_template.revoke_version",
        businessType: "contract_business_template_version",
        businessId: versionId
      });

      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Standard clause read
  // ---------------------------------------------------------------------------

  async listPublishedClauses(category?: string) {
    const publishedVersions = await this.prisma.standardClauseVersion.findMany({
      where: { status: "published" },
      select: { id: true, clauseId: true, versionNo: true, title: true, content: true },
      orderBy: [{ clauseId: "asc" }, { versionNo: "desc" }]
    });
    const latestVersions = new Map<string, (typeof publishedVersions)[number]>();
    for (const version of publishedVersions) {
      if (!latestVersions.has(version.clauseId)) {
        latestVersions.set(version.clauseId, version);
      }
    }
    const publishedClauseIds = [...latestVersions.keys()];
    if (!publishedClauseIds.length) {
      return [];
    }
    const clauses = await this.prisma.standardClause.findMany({
      where: {
        id: { in: publishedClauseIds },
        ...(category ? { category } : {})
      },
      orderBy: { createdAt: "asc" }
    });
    return clauses.flatMap(
      (clause: { id: string; code: string; name: string; category: string }) => {
        const version = latestVersions.get(clause.id);
        if (!version) return [];
        return {
          standardClauseVersionId: version.id,
          versionId: version.id,
          versionNo: version.versionNo,
          title: version.title,
          content: version.content,
          clauseId: clause.id,
          code: clause.code,
          name: clause.name,
          category: clause.category
        };
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Standard clause mutations
  // ---------------------------------------------------------------------------

  async createClause(actorUserId: string, input: CreateStandardClauseDto) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const clause = await tx.standardClause.create({
        data: {
          code: input.code,
          category: input.category,
          name: input.name,
          createdByUserId: actorUserId
        }
      });

      const version = await tx.standardClauseVersion.create({
        data: {
          clauseId: clause.id,
          versionNo: 1,
          status: "draft",
          title: input.title,
          content: input.content as never
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "standard_clause.create",
        businessType: "standard_clause",
        businessId: clause.id,
        metadata: { code: input.code, name: input.name }
      });

      return { clause, version };
    });
  }

  async submitClauseVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const version = await tx.standardClauseVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到标准条款版本，请刷新后重试");
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的标准条款版本可以提交");
      }

      const updated = await tx.standardClauseVersion.update({
        where: { id: versionId },
        data: {
          status: "submitted",
          submittedByUserId: actorUserId
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "standard_clause.submit_version",
        businessType: "standard_clause_version",
        businessId: versionId
      });

      return updated;
    });
  }

  async publishClauseVersion(versionId: string, actorUserId: string, changeSummary: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.standardClauseVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到标准条款版本，请刷新后重试");
      if (version.status !== "submitted") {
        throw new BadRequestException("只有已提交的标准条款版本可以发布");
      }

      const updated = await tx.standardClauseVersion.update({
        where: { id: versionId },
        data: {
          status: "published",
          publishedByUserId: actorUserId,
          publishedAt: new Date(),
          changeSummary
        }
      });

      await this.audit.record(tx as never, {
        actorUserId,
        action: "standard_clause.publish_version",
        businessType: "standard_clause_version",
        businessId: versionId,
        metadata: { changeSummary }
      });

      return updated;
    });
  }
}
