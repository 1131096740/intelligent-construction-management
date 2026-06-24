import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { validateContractTemplateSchema, type ContractTemplateSchema } from "@jiangkong/shared-domain";
import type { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type {
  CreateBusinessTemplateDto,
  CreateStandardClauseDto,
  PublishTemplateVersionDto,
  UpdateBusinessTemplateVersionDto
} from "./dto/contract-template.dto";

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
      throw new ForbiddenException(`Requires global role: ${roleKey}`);
    }
    const positionIds = positions.map((p: { positionId: string }) => p.positionId);
    const positionRows = await tx.position.findMany({
      where: { id: { in: positionIds } }
    });
    const hasRole = positionRows.some((p: { key: string }) => p.key === roleKey);
    if (!hasRole) {
      throw new ForbiddenException(`Requires global role: ${roleKey}`);
    }
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

  listPublished(contractTypeKey?: string) {
    return this.prisma.contractBusinessTemplate.findMany({
      where: contractTypeKey ? { contractTypeKey } : undefined,
      orderBy: { createdAt: "asc" }
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
    return this.prisma.$transaction(async (tx) => {
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("Template version not found");
      if (version.status !== "draft") {
        throw new BadRequestException("Only draft versions can be edited");
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const source = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!source) throw new NotFoundException("Template version not found");

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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_staff");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("Template version not found");
      if (version.status !== "draft") {
        throw new BadRequestException("Only draft versions can be submitted");
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("Template version not found");
      if (version.status !== "submitted") {
        throw new BadRequestException("Only submitted versions can be published");
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("Template version not found");
      if (version.status !== "published") {
        throw new BadRequestException("Only published versions can be stopped");
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("Template version not found");
      if (version.status !== "published") {
        throw new BadRequestException("Only published versions can be revoked");
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

  listPublishedClauses(category?: string) {
    return this.prisma.standardClause.findMany({
      where: category ? { category } : undefined,
      orderBy: { createdAt: "asc" }
    });
  }

  // ---------------------------------------------------------------------------
  // Standard clause mutations
  // ---------------------------------------------------------------------------

  async createClause(actorUserId: string, input: CreateStandardClauseDto) {
    return this.prisma.$transaction(async (tx) => {
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

  async publishClauseVersion(versionId: string, actorUserId: string, changeSummary: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const version = await tx.standardClauseVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("Clause version not found");
      if (version.status !== "submitted") {
        throw new BadRequestException("Only submitted versions can be published");
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
