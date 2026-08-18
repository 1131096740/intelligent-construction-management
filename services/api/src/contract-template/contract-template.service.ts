import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  validateContractTemplateSchema,
  type ContractTemplateSchema,
  type DetailActionReadModel
} from "@jiangkong/shared-domain";
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

  async assertCanMaintainBusinessEntry(actorUserId: string) {
    await this.assertTemplateMaintenanceRole(this.prisma, actorUserId);
  }

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

  private async assertTemplateMaintenanceRole(
    tx: {
      userPosition: { findMany: (args: { where: Record<string, unknown> }) => Promise<Array<{ positionId: string }>> };
      position: { findMany: (args: { where: Record<string, unknown> }) => Promise<Array<{ key: string }>> };
    },
    actorUserId: string
  ): Promise<string[]> {
    const positions = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positionIds = positions.map((p: { positionId: string }) => p.positionId);
    const positionRows = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    if (!positionRows.some((p: { key: string }) => p.key === "contract_staff" || p.key === "contract_director")) {
      throw new ForbiddenException("只有合同经办人或合同主管可以执行该模板操作");
    }
    return positionRows.map((position) => position.key);
  }

  private roleErrorMessage(roleKey: string) {
    return roleKey === "contract_staff"
      ? "只有合同经办人可以执行该模板操作"
      : "只有合同主管可以执行该模板操作";
  }

  private discardReadModel(
    version: {
      status: string;
      submittedByUserId?: string | null;
      publishedAt?: Date | null;
      stoppedAt?: Date | null;
      revokedAt?: Date | null;
    },
    referenceReason: string | null,
    canMaintain: boolean
  ): { availableActions: DetailActionReadModel[]; blockedReasons: string[] } {
    const blockedReasons: string[] = [];
    if (!canMaintain) blockedReasons.push("当前账号没有模板维护权限");
    if (version.status === "discarded") blockedReasons.push("该草稿版本已废弃");
    else if (version.status !== "draft") blockedReasons.push("只有从未提交的草稿版本可以废弃");
    if (version.submittedByUserId || version.publishedAt || version.stoppedAt || version.revokedAt) {
      blockedReasons.push("该版本已形成提交、发布、停用或撤销历史");
    }
    if (referenceReason) blockedReasons.push(referenceReason);
    return {
      availableActions: [{
        key: "discard_version",
        label: "废弃草稿版本",
        kind: "danger",
        enabled: blockedReasons.length === 0,
        disabledReason: blockedReasons.length ? blockedReasons.join("；") : null,
        requiresComment: true
      }],
      blockedReasons
    };
  }

  private versionActionReadModel(
    version: {
      status: string;
      submittedByUserId?: string | null;
      publishedAt?: Date | null;
      stoppedAt?: Date | null;
      revokedAt?: Date | null;
    },
    referenceReason: string | null,
    canMaintain: boolean,
    canRiskStop: boolean,
    hasActiveMapping: boolean
  ): { availableActions: DetailActionReadModel[]; blockedReasons: string[] } {
    const discard = this.discardReadModel(version, referenceReason, canMaintain);
    const riskStopBlockedReasons: string[] = [];
    if (!canRiskStop) {
      riskStopBlockedReasons.push("只有合同主管可以风险停用已发布模板版本");
    }
    if (version.status !== "published") {
      riskStopBlockedReasons.push("只有已发布的业务模板版本可以风险停用");
    }
    if (hasActiveMapping) {
      riskStopBlockedReasons.push("该模板版本仍有启用的业务场景映射，请先停用映射");
    }
    return {
      availableActions: [
        ...discard.availableActions,
        {
          key: "risk_stop",
          label: "风险停用",
          kind: "danger",
          enabled: riskStopBlockedReasons.length === 0,
          disabledReason: riskStopBlockedReasons.length
            ? riskStopBlockedReasons.join("；")
            : null
        }
      ],
      blockedReasons: discard.blockedReasons
    };
  }

  private async standardClauseReference(
    tx: { $queryRaw<T>(query: Prisma.Sql): Promise<T> },
    versionId: string
  ) {
    const [reference] = await tx.$queryRaw<Array<{ referenced: boolean }>>(Prisma.sql`
      SELECT (
        EXISTS (
          SELECT 1 FROM "ContractBusinessTemplateVersion"
          WHERE "clauseSchema" @> jsonb_build_array(jsonb_build_object('standardClauseVersionId', ${versionId}))
        ) OR EXISTS (
          SELECT 1 FROM "ContractVersion"
          WHERE "templateSnapshot" @> jsonb_build_object('clauseSchema', jsonb_build_array(jsonb_build_object('standardClauseVersionId', ${versionId})))
        ) OR EXISTS (
          SELECT 1 FROM "ContractVersion"
          WHERE "clauseSnapshot" @> jsonb_build_array(jsonb_build_object('standardClauseVersionId', ${versionId}))
        )
      ) AS referenced
    `);
    return Boolean(reference?.referenced);
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

  private validateNewTemplateSchema(schema: ContractTemplateSchema): void {
    validateContractTemplateSchema(schema);

    for (const bill of schema.bills) {
      if (bill.quantityScale !== 2) {
        throw new BadRequestException("新模板清单数量精度必须为 2 位小数");
      }
      if (bill.unitPriceScale !== 2) {
        throw new BadRequestException("新模板清单含税单价精度必须为 2 位小数");
      }
    }

    for (const field of schema.fields) {
      if (field.key !== "taxRatePercent") continue;
      if (
        this.isZeroTaxRateConfig(field.defaultValue) ||
        field.options?.some(
          (option) =>
            this.isZeroTaxRateConfig(option.value) ||
            this.isZeroTaxRateConfig(option.label)
        )
      ) {
        throw new BadRequestException("新模板税率配置不能包含 0%");
      }
    }
  }

  private isZeroTaxRateConfig(value: unknown): boolean {
    if (typeof value === "number") return value === 0;
    if (typeof value !== "string") return false;
    const normalized = value.trim().replace(/\s+/gu, "").replace(/%$/u, "");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) {
      return false;
    }
    return Number(normalized) === 0;
  }

  private normalizeClonedTemplateSchema(
    schema: ContractTemplateSchema
  ): ContractTemplateSchema {
    return {
      ...schema,
      fields: schema.fields.map((field) => {
        if (field.key !== "taxRatePercent") return field;
        const { defaultValue, options, ...rest } = field;
        return {
          ...rest,
          ...(defaultValue !== undefined && !this.isZeroTaxRateConfig(defaultValue)
            ? { defaultValue }
            : {}),
          ...(options
            ? {
                options: options.filter(
                  (option) =>
                    !this.isZeroTaxRateConfig(option.value) &&
                    !this.isZeroTaxRateConfig(option.label)
                )
              }
            : {})
        };
      }),
      bills: schema.bills.map((bill) => ({
        ...bill,
        quantityScale: 2,
        unitPriceScale: 2
      }))
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
            businessCode: true,
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
            businessCode: template.businessCode,
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

  async getTemplate(templateId: string, actorUserId: string, includeHistory = false) {
    return this.prisma.$transaction(async (tx) => {
      const roleKeys = await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const template = await tx.contractBusinessTemplate.findUnique({ where: { id: templateId } });
      if (!template || (!includeHistory && template.status === "discarded")) {
        throw new NotFoundException("业务模板不存在");
      }
      const versions = await tx.contractBusinessTemplateVersion.findMany({
        where: { templateId, ...(includeHistory ? {} : { status: { not: "discarded" } }) },
        orderBy: { versionNo: "desc" }
      });
      const actions = await Promise.all(versions.map(async (version) => {
        const [mapping, activeMapping, contract] = await Promise.all([
          tx.contractScenarioTemplateMapping.findFirst({
            where: { businessTemplateVersionId: version.id },
            select: { id: true }
          }),
          tx.contractScenarioTemplateMapping.findFirst({
            where: { businessTemplateVersionId: version.id, active: true },
            select: { id: true }
          }),
          tx.contractVersion.findFirst({
            where: { businessTemplateVersionId: version.id },
            select: { id: true }
          })
        ]);
        return this.versionActionReadModel(
          version,
          mapping || contract ? "该版本已被场景映射或合同引用" : null,
          true,
          roleKeys.includes("contract_director"),
          Boolean(activeMapping)
        );
      }));
      return {
        template,
        versions: versions.map((version, index) => ({
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
        discardedAt: version.discardedAt,
        discardedByUserId: version.discardedByUserId,
        discardReason: version.discardReason,
        changeSummary: version.changeSummary,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        ...actions[index]
        }))
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Business template mutations
  // ---------------------------------------------------------------------------

  async createTemplate(actorUserId: string, input: CreateBusinessTemplateDto) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertTemplateMaintenanceRole(tx as never, actorUserId);

      this.validateNewTemplateSchema(input.schema);

      const template = await tx.contractBusinessTemplate.create({
        data: {
          code: input.code,
          businessCode: input.businessCode,
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
        metadata: { code: input.code, businessCode: input.businessCode, name: input.name }
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
      await this.assertTemplateMaintenanceRole(tx as never, actorUserId);

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的业务模板版本可以编辑");
      }

      this.validateNewTemplateSchema(input.schema);

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
      await this.assertTemplateMaintenanceRole(tx as never, actorUserId);

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
      const clonedSchema = this.normalizeClonedTemplateSchema(
        this.versionToSchema(source)
      );
      this.validateNewTemplateSchema(clonedSchema);

      const newVersion = await tx.contractBusinessTemplateVersion.create({
        data: {
          templateId: source.templateId,
          versionNo: nextVersionNo,
          status: "draft",
          fieldSchema: clonedSchema.fields as never,
          billSchema: clonedSchema.bills as never,
          clauseSchema: clonedSchema.clauses as never,
          attachmentSchema: clonedSchema.attachments as never,
          validationSchema: clonedSchema.validations as never
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

  async discardVersion(
    versionId: string,
    actorUserId: string,
    reason: string,
    expectedUpdatedAt: string
  ) {
    const discardReason = reason.trim();
    if (!discardReason) throw new BadRequestException("请填写模板草稿废弃原因");
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const locked = await lockBusinessTemplateVersion(tx, versionId);
      if (!locked?.version || !locked.template) {
        throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      }
      if (locked.version.status === "discarded") {
        return { id: versionId, status: "discarded", discardedAt: locked.version.discardedAt };
      }
      const expectedUpdatedAtDate = new Date(expectedUpdatedAt);
      if (locked.version.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
        throw new ConflictException("业务模板草稿已被更新，请刷新页面后重试");
      }
      if (
        locked.version.status !== "draft" ||
        locked.version.submittedByUserId ||
        locked.version.publishedAt ||
        locked.version.stoppedAt ||
        locked.version.revokedAt
      ) {
        throw new BadRequestException("该业务模板版本已提交、发布、停用或撤销，不能废弃");
      }
      const [mapping, contract] = await Promise.all([
        tx.contractScenarioTemplateMapping.findFirst({
          where: { businessTemplateVersionId: versionId },
          select: { id: true }
        }),
        tx.contractVersion.findFirst({
          where: { businessTemplateVersionId: versionId },
          select: { id: true }
        })
      ]);
      if (mapping || contract) {
        throw new BadRequestException("该业务模板版本已被场景映射或合同引用，不能废弃");
      }
      const discardedAt = new Date();
      const changed = await tx.contractBusinessTemplateVersion.updateMany({
        where: {
          id: versionId,
          status: "draft",
          updatedAt: expectedUpdatedAtDate,
          discardedAt: null
        },
        data: { status: "discarded", discardedAt, discardedByUserId: actorUserId, discardReason }
      });
      if (changed.count !== 1) {
        throw new ConflictException("业务模板草稿已被更新，请刷新页面后重试");
      }
      const familyVersions = await tx.contractBusinessTemplateVersion.findMany({
        where: { templateId: locked.template.id },
        select: { id: true }
      });
      const [remaining, protectedHistory, anyMapping] = await Promise.all([
        tx.contractBusinessTemplateVersion.count({
          where: { templateId: locked.template.id, status: { not: "discarded" } }
        }),
        tx.contractBusinessTemplateVersion.count({
          where: { templateId: locked.template.id, status: { in: ["submitted", "published", "stopped", "revoked"] } }
        }),
        tx.contractScenarioTemplateMapping.findFirst({
          where: { businessTemplateVersionId: { in: familyVersions.map((item) => item.id) } },
          select: { id: true }
        })
      ]);
      if (remaining === 0 && protectedHistory === 0 && !anyMapping) {
        await tx.contractBusinessTemplate.updateMany({
          where: { id: locked.template.id, status: "draft" },
          data: { status: "discarded" }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract_template.discard_version",
        businessType: "contract_business_template_version",
        businessId: versionId,
        metadata: { reason: discardReason }
      });
      return { id: versionId, status: "discarded", discardedAt };
    });
  }

  async submitVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertTemplateMaintenanceRole(tx as never, actorUserId);

      const version = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的业务模板版本可以提交");
      }

      this.validateNewTemplateSchema(this.versionToSchema(version));

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

      this.validateNewTemplateSchema(this.versionToSchema(version));

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
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
    });
  }

  async revokeVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx as never, actorUserId, "contract_director");

      const lockedTemplate = await lockBusinessTemplateVersion(tx, versionId);
      const version = lockedTemplate?.version;
      if (!version || !lockedTemplate.template) {
        throw new NotFoundException("未找到业务模板版本，请刷新后重试");
      }
      if (version.status !== "published") {
        throw new BadRequestException("只有已发布的业务模板版本可以撤回");
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
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
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

  async listClauseHistory(actorUserId: string, category?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const clauses = await tx.standardClause.findMany({
        where: category ? { category } : undefined,
        orderBy: { createdAt: "asc" }
      });
      const versions = clauses.length
        ? await tx.standardClauseVersion.findMany({
            where: { clauseId: { in: clauses.map((clause) => clause.id) } },
            orderBy: [{ clauseId: "asc" }, { versionNo: "desc" }]
          })
        : [];
      const actionByVersion = new Map<string, ReturnType<ContractTemplateService["discardReadModel"]>>();
      for (const version of versions) {
        const reference = await this.standardClauseReference(tx, version.id);
        actionByVersion.set(
          version.id,
          this.discardReadModel(
            version,
            reference ? "该版本已被模板或合同快照引用" : null,
            true
          )
        );
      }
      return clauses.map((clause) => ({
        ...clause,
        versions: versions
          .filter((version) => version.clauseId === clause.id)
          .map((version) => ({ ...version, ...actionByVersion.get(version.id) }))
      }));
    });
  }

  // ---------------------------------------------------------------------------
  // Standard clause mutations
  // ---------------------------------------------------------------------------

  async createClause(actorUserId: string, input: CreateStandardClauseDto) {
    return this.prisma.$transaction(async (tx: ContractTemplateTx) => {
      await this.assertTemplateMaintenanceRole(tx as never, actorUserId);

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
      await this.assertTemplateMaintenanceRole(tx as never, actorUserId);

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

  async discardClauseVersion(
    versionId: string,
    actorUserId: string,
    reason: string,
    expectedUpdatedAt: string
  ) {
    const discardReason = reason.trim();
    if (!discardReason) throw new BadRequestException("请填写模板草稿废弃原因");
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const [locked] = await tx.$queryRaw<Array<{
        id: string;
        clauseId: string;
        status: string;
        submittedByUserId: string | null;
        publishedAt: Date | null;
        discardedAt: Date | null;
        updatedAt: Date;
      }>>(Prisma.sql`
        SELECT v.* FROM "StandardClauseVersion" v
        JOIN "StandardClause" c ON c."id" = v."clauseId"
        WHERE v."id" = ${versionId}
        FOR UPDATE OF c, v
      `);
      if (!locked) throw new NotFoundException("未找到标准条款版本，请刷新后重试");
      if (locked.status === "discarded") {
        return { id: versionId, status: "discarded", discardedAt: locked.discardedAt };
      }
      const expectedUpdatedAtDate = new Date(expectedUpdatedAt);
      if (locked.updatedAt.getTime() !== expectedUpdatedAtDate.getTime()) {
        throw new ConflictException("标准条款草稿已被更新，请刷新页面后重试");
      }
      if (locked.status !== "draft" || locked.submittedByUserId || locked.publishedAt) {
        throw new BadRequestException("该标准条款版本已提交或发布，不能废弃");
      }
      if (await this.standardClauseReference(tx, versionId)) {
        throw new BadRequestException("该标准条款版本已被模板或合同快照引用，不能废弃");
      }
      const discardedAt = new Date();
      const changed = await tx.standardClauseVersion.updateMany({
        where: {
          id: versionId,
          status: "draft",
          updatedAt: expectedUpdatedAtDate,
          discardedAt: null
        },
        data: { status: "discarded", discardedAt, discardedByUserId: actorUserId, discardReason }
      });
      if (changed.count !== 1) {
        throw new ConflictException("标准条款草稿已被更新，请刷新页面后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "standard_clause.discard_version",
        businessType: "standard_clause_version",
        businessId: versionId,
        metadata: { reason: discardReason }
      });
      return { id: versionId, status: "discarded", discardedAt };
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
