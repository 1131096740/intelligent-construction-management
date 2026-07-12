import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { validateContractTemplateSchema, type ContractTemplateSchema } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type {
  CreateBusinessTemplateDto,
  CreateStandardClauseDto,
  PublishTemplateVersionDto,
  UpdateBusinessTemplateVersionDto
} from "./dto/contract-template.dto";
import { lockBusinessTemplateVersion } from "./contract-template-locks";

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

const USAGE_FIELD_TYPES = new Set([
  "text",
  "long_text",
  "number",
  "money",
  "date",
  "single_select",
  "multi_select",
  "boolean"
]);
const USAGE_BILL_AMOUNT_ROLES = new Set([
  "included",
  "reference",
  "non_priced",
  "provisional"
]);
const USAGE_PRICING_MODES = new Set(["tax_inclusive", "tax_exclusive"]);
const USAGE_COLUMN_TYPES = new Set(["text", "number", "boolean"]);
const USAGE_VALIDATION_LEVELS = new Set(["block", "warning"]);

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
      validations: v.validationSchema as ContractTemplateSchema["validations"],
      supplementChangePolicy: (v as { supplementChangePolicy?: ContractTemplateSchema["supplementChangePolicy"] }).supplementChangePolicy
    };
  }

  private schemaToFields(schema: ContractTemplateSchema) {
    return {
      fieldSchema: schema.fields as never,
      billSchema: schema.bills as never,
      clauseSchema: schema.clauses as never,
      attachmentSchema: schema.attachments as never,
      validationSchema: schema.validations as never,
      supplementChangePolicy: schema.supplementChangePolicy as never
    };
  }

  publishedUsagePreview(v: {
    fieldSchema: unknown;
    billSchema: unknown;
    clauseSchema: unknown;
    attachmentSchema: unknown;
    validationSchema: unknown;
  }) {
    try {
      const schema = this.versionToSchema(v);
      validateContractTemplateSchema(schema);
      const hasText = (value: unknown): value is string =>
        typeof value === "string" && value.trim().length > 0;
      if (
        !Array.isArray(schema.fields) ||
        !Array.isArray(schema.bills) ||
        !Array.isArray(schema.clauses) ||
        !Array.isArray(schema.attachments) ||
        !Array.isArray(schema.validations) ||
        !schema.fields.every(
          (field) =>
            field !== null &&
            typeof field === "object" &&
            hasText(field.label) &&
            USAGE_FIELD_TYPES.has(field.type) &&
            (field.required === undefined || typeof field.required === "boolean") &&
            (field.group === undefined || hasText(field.group))
        ) ||
        !schema.bills.every(
          (bill) =>
            bill !== null &&
            typeof bill === "object" &&
            hasText(bill.name) &&
            USAGE_BILL_AMOUNT_ROLES.has(bill.amountRole) &&
            USAGE_PRICING_MODES.has(bill.pricingMode) &&
            Array.isArray(bill.columns) &&
            bill.columns.every(
              (column) =>
                column !== null &&
                typeof column === "object" &&
                hasText(column.label) &&
                USAGE_COLUMN_TYPES.has(column.type) &&
                (column.required === undefined || typeof column.required === "boolean")
            )
        ) ||
        !schema.clauses.every(
          (clause) =>
            clause !== null &&
            typeof clause === "object" &&
            hasText(clause.title) &&
            (clause.required === undefined || typeof clause.required === "boolean")
        ) ||
        !schema.attachments.every(
          (attachment) =>
            attachment !== null &&
            typeof attachment === "object" &&
            hasText(attachment.name) &&
            typeof attachment.required === "boolean" &&
            (attachment.mustBeValid === undefined ||
              typeof attachment.mustBeValid === "boolean")
        ) ||
        !schema.validations.every(
          (validation) =>
            validation !== null &&
            typeof validation === "object" &&
            USAGE_VALIDATION_LEVELS.has(validation.level) &&
            hasText(validation.message)
        )
      ) {
        throw new Error("模板结构预览数据异常");
      }
      return {
        fields: schema.fields.map((field) => ({
          label: field.label,
          type: field.type,
          required: field.required === true,
          ...(typeof field.group === "string" && field.group.trim()
            ? { group: field.group }
            : {}),
          conditional: field.visibleWhen !== undefined
        })),
        bills: schema.bills.map((bill) => ({
          name: bill.name,
          amountRole: bill.amountRole,
          pricingMode: bill.pricingMode,
          columns: bill.columns.map((column) => ({
            label: column.label,
            type: column.type,
            required: column.required === true
          }))
        })),
        clauses: schema.clauses.map((clause) => ({
          title: clause.title,
          required: clause.required === true
        })),
        attachments: schema.attachments.map((attachment) => ({
          name: attachment.name,
          required: attachment.required,
          mustBeValid: attachment.mustBeValid === true
        })),
        validations: schema.validations.map((validation) => ({
          level: validation.level,
          message: validation.message
        }))
      };
    } catch {
      throw new BadRequestException("已发布业务模板结构异常，请联系合同部主管处理");
    }
  }

  // ---------------------------------------------------------------------------
  // Business template read
  // ---------------------------------------------------------------------------

  async listPublished(contractTypeKey?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const publishedVersions = await tx.contractBusinessTemplateVersion.findMany({
          where: { status: "published" },
          select: {
            id: true,
            templateId: true,
            versionNo: true,
            fieldSchema: true,
            billSchema: true,
            clauseSchema: true,
            attachmentSchema: true,
            validationSchema: true
          },
          orderBy: { versionNo: "desc" }
        });
        const versionByTemplateId = new Map<
          string,
          {
            id: string;
            templateId: string;
            versionNo: number;
            fieldSchema: unknown;
            billSchema: unknown;
            clauseSchema: unknown;
            attachmentSchema: unknown;
            validationSchema: unknown;
          }
        >();
        for (const version of publishedVersions as Array<{
          id: string;
          templateId: string;
          versionNo: number;
          fieldSchema: unknown;
          billSchema: unknown;
          clauseSchema: unknown;
          attachmentSchema: unknown;
          validationSchema: unknown;
        }>) {
          if (!versionByTemplateId.has(version.templateId)) {
            versionByTemplateId.set(version.templateId, version);
          }
        }
        const publishedTemplateIds = [...versionByTemplateId.keys()];
        if (!publishedTemplateIds.length) {
          return [];
        }
        const templates = await tx.contractBusinessTemplate.findMany({
          where: {
            id: { in: publishedTemplateIds },
            ...(contractTypeKey ? { contractTypeKey } : {})
          },
          select: {
            id: true,
            code: true,
            name: true,
            contractTypeKey: true
          },
          orderBy: { createdAt: "asc" }
        });
        return templates.map((template) => {
          const version = versionByTemplateId.get(template.id);
          if (!version) {
            throw new BadRequestException("已发布业务模板版本数据异常，请联系合同部主管处理");
          }
          return {
            id: template.id,
            code: template.code,
            name: template.name,
            contractTypeKey: template.contractTypeKey,
            status: "published",
            versionId: version.id,
            versionNo: version.versionNo,
            usagePreview: this.publishedUsagePreview(version)
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  async getTemplate(templateId: string) {
    const template = await this.prisma.contractBusinessTemplate.findUnique({
      where: { id: templateId }
    });
    if (!template) {
      throw new NotFoundException("业务模板不存在");
    }

    const versions = await this.prisma.contractBusinessTemplateVersion.findMany({
      where: { templateId },
      orderBy: { versionNo: "desc" }
    });

    return {
      template,
      versions: versions.map((version) => ({
        id: version.id,
        templateId: version.templateId,
        versionNo: version.versionNo,
        status: version.status,
        schema: this.versionToSchema(version),
        submittedByUserId: version.submittedByUserId,
        publishedByUserId: version.publishedByUserId,
        publishedAt: version.publishedAt,
        stoppedAt: version.stoppedAt,
        revokedAt: version.revokedAt,
        changeSummary: version.changeSummary,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt
      }))
    };
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const lockedTemplate = await lockBusinessTemplateVersion(tx, versionId);
      const version = lockedTemplate?.version;
      if (!version || !lockedTemplate.template) {
        throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      }
      if (version.status !== "published") {
        throw new BadRequestException("只有已发布的业务模板版本可以停用");
      }
      const activeMapping = await tx.contractScenarioTemplateMapping.findFirst({
        where: { businessTemplateVersionId: version.id, active: true },
        select: { id: true }
      });
      if (activeMapping) {
        throw new BadRequestException("该模板版本仍有启用的业务场景映射，请先停用映射");
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
