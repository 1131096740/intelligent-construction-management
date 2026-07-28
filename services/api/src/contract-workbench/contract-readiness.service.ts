import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import {
  CONTRACT_INVOICE_TYPES,
  CONTRACT_TAX_MODES,
  contractFieldsForBusinessUse,
  contractPricingPolicy,
  normalizeTaxRatePercent,
  type ContractBillDefinition,
  type ContractClauseDefinition,
  type ContractFieldDefinition,
  type ContractValidationRule
} from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { contractDocumentCandidateMatchesLedger } from "../contract-document/contract-document-ledger-candidate";
import { assertContractBillDerivedUnitPrices } from "../contract-bill/contract-bill-totals";

export interface ContractReadinessResult {
  blocking: Array<{ key: string; section: string; message: string }>;
  warnings: Array<{ key: string; section: string; message: string }>;
  checkedRevision: number;
}

type ReadinessVersion = {
  id: string;
  contractId: string;
  changeType?: string;
  baseVersionId?: string | null;
  draftRevision: number;
  amountCents: bigint;
  amountLimitType: string;
  pricingNature: string;
  amountSource: string;
  amountAdjustmentReason: string | null;
  invoiceType: string | null;
  taxMode: string;
  defaultTaxRatePercent: Prisma.Decimal | null;
  taxFactStatus: string;
  taxFactSource: string | null;
  taxFactRevision: number;
  taxFactsFrozenAt: Date | null;
  contractGovernanceVersion?: number | null;
  layoutTemplateVersionId: string | null;
  draftData: Prisma.JsonValue;
  templateSnapshot: Prisma.JsonValue;
  clauseSnapshot: Prisma.JsonValue;
};

type ReadinessContract = {
  contractTypeKey: string | null;
};

type ReadinessClient = {
  contractBill: {
    findMany(input: unknown): Promise<
      Array<{
        id: string;
        billKey: string;
        amountRole: string;
        taxInclusiveAmountCents: bigint;
        schemaSnapshot?: Prisma.JsonValue;
      }>
    >;
  };
  contractBillRow: {
    findMany(input: unknown): Promise<
      Array<{
        id: string;
        contractBillId: string;
        itemName: string;
        unit?: string;
        quantity: Prisma.Decimal | null;
        unitPrice: Prisma.Decimal | null;
        taxRate: Prisma.Decimal | null;
        taxRateSource: string;
        pricingFactStatus: string;
        taxInclusiveAmountCents: bigint | null;
        taxExclusiveAmountCents: bigint | null;
        taxAmountCents: bigint | null;
        customData: Prisma.JsonValue;
      }>
    >;
  };
  contractBillRowTransition: {
    findMany(input: unknown): Promise<Array<{
      sourceContractBillRowId: string;
      targetContractBillRowId: string;
      status: string;
    }>>;
  };
  settlement: {
    findMany(input: unknown): Promise<Array<{ id: string }>>;
  };
  settlementLine: {
    findMany(input: unknown): Promise<Array<{ contractBillRowId: string | null }>>;
  };
  contractPartySnapshot: {
    findMany(input: unknown): Promise<Array<{ id: string; roleKey: string }>>;
  };
  contractLayoutTemplateVersion: {
    findUnique(input: unknown): Promise<{
      id: string;
      layoutTemplateId: string;
      status: string;
    } | null>;
  };
  contractLayoutTemplate: {
    findUnique(input: unknown): Promise<{
      id: string;
      contractTypeKey: string;
    } | null>;
  };
  contractGeneratedDocument: {
    findMany(input: unknown): Promise<
      Array<{
        id: string;
        purpose: string;
        status: string;
        sourceRevision: number;
        layoutTemplateVersionId: string;
        docxFileId?: string | null;
        pdfFileId?: string | null;
      }>
    >;
  };
  contractNegotiationRound: {
    findMany(input: unknown): Promise<Array<{ id: string; status: string }>>;
  };
  contractOfflineRevision: {
    findMany(input: unknown): Promise<Array<{ id: string; status: string }>>;
  };
  contractDocumentComparison: {
    findMany(input: unknown): Promise<
      Array<{ id: string; offlineRevisionId: string; status: string }>
    >;
  };
  contractDocumentDifference: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
    findMany(input: unknown): Promise<Array<{ id: string; candidate: Prisma.JsonValue | null }>>;
  };
  contractVersionAuthorizationLink: {
    findMany(input: unknown): Promise<Array<{
      side: string;
      required: boolean;
      authorizationId: string | null;
      reusedFromContractVersionId?: string | null;
    }>>;
  };
  contractAuthorization: {
    findMany(input: unknown): Promise<Array<{
      id: string;
      side: string;
      status: string;
      fileId: string;
      contentSha256: string;
      pageCount: number;
    }>>;
  };
  fileObject: {
    findMany(input: unknown): Promise<Array<{
      id: string;
      storageStatus: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
    }>>;
  };
  contractFormalFile: {
    findFirst(input: unknown): Promise<{
      id: string;
      fileId: string;
      contentSha256: string;
      pageCount: number;
      sourceRevision: number;
      status: string;
      declarationSnapshot: Prisma.JsonValue;
    } | null>;
  };
};

interface TemplateSnapshot {
  fieldSchema: ContractFieldDefinition[];
  billSchema: Array<ContractBillDefinition & { required?: boolean }>;
  clauseSchema: ContractClauseDefinition[];
  attachmentSchema: unknown[];
  validationSchema: ContractValidationRule[];
}

const PARTY_ROLE_LABELS: Record<string, string> = {
  party_a: "甲方",
  party_b: "乙方"
};

@Injectable()
export class ContractReadinessService {
  constructor(private readonly prisma?: PrismaService) {}

  async checkAndStore(
    contractVersionId: string,
    actorUserId: string
  ): Promise<ContractReadinessResult> {
    if (!this.prisma) {
      throw new InternalServerErrorException("合同资料检查服务暂不可用，请稍后重试或联系管理员");
    }
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });
      if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
      const contract = await tx.contract.findUnique({
        where: { id: version.contractId }
      });
      if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
      if (contract.ownerUserId !== actorUserId) {
        throw new BadRequestException("只有合同经办人可以检查资料是否齐全");
      }
      if (contract.voidedAt) {
        throw new BadRequestException("合同草稿已作废，不能继续检查资料");
      }
      const result = await this.check(tx, version, contract, false);
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: version.id,
          draftRevision: version.draftRevision,
          status: { in: ["draft", "approval_rejected"] }
        },
        data: { readinessSnapshot: result as unknown as Prisma.InputJsonValue }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("合同草稿已被更新，请刷新后重新检查资料");
      }
      return result;
    });
  }

  async check(
    tx: ReadinessClient,
    version: ReadinessVersion,
    contract: ReadinessContract,
    requireInternalReviewDocument: boolean
  ): Promise<ContractReadinessResult> {
    const blocking: ContractReadinessResult["blocking"] = [];
    const warnings: ContractReadinessResult["warnings"] = [];
    const template = this.template(version.templateSnapshot);
    const draftData = this.object(version.draftData);
    const fieldData = this.fieldData(draftData);
    const clauses = this.clauses(version.clauseSnapshot);

    for (const field of contractFieldsForBusinessUse(
      contract.contractTypeKey,
      template.fieldSchema
    )) {
      if (
        field.required &&
        this.isVisible(field, fieldData) &&
        this.isEmpty(fieldData[field.key])
      ) {
        blocking.push({
          key: `field.${field.key}`,
          section: "fields",
          message: `${field.label}不能为空`
        });
      }
    }

    const clauseByKey = new Map(clauses.map((clause) => [clause.key, clause]));
    for (const definition of template.clauseSchema) {
      if (definition.required && this.isEmpty(clauseByKey.get(definition.key)?.content)) {
        blocking.push({
          key: `clause.${definition.key}`,
          section: "clauses",
          message: `${definition.title}不能为空`
        });
      }
    }
    for (const rule of template.validationSchema) {
      const content = this.text(clauseByKey.get(rule.targetClauseKey)?.content);
      if (rule.requiredPhrases.some((phrase) => !content.includes(phrase))) {
        (rule.level === "block" ? blocking : warnings).push({
          key: rule.key,
          section: "clauses",
          message: rule.message
        });
      }
    }

    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id },
      orderBy: { billKey: "asc" }
    });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }]
        })
      : [];
    assertContractBillDerivedUnitPrices(rows);
    await this.appendCrossVersionMappingReadiness(tx, version, rows, blocking);
    if (
      version.invoiceType == null ||
      !CONTRACT_INVOICE_TYPES.some((value) => value === version.invoiceType)
    ) {
      blocking.push({
        key: "tax.invoice_type",
        section: "tax",
        message: "请选择增值税普通发票或增值税专用发票"
      });
    }
    let normalizedDefaultTaxRate: string | null = null;
    if (version.defaultTaxRatePercent == null) {
      blocking.push({
        key: "tax.default_rate",
        section: "tax",
        message: "请填写合同约定的税率"
      });
    } else {
      try {
        normalizedDefaultTaxRate = normalizeTaxRatePercent(
          version.defaultTaxRatePercent.toString()
        );
      } catch {
        blocking.push({
          key: "tax.default_rate",
          section: "tax",
          message: "合同税率必须在 0 到 100 之间，且最多保留 6 位小数"
        });
      }
    }
    if (!CONTRACT_TAX_MODES.some((value) => value === version.taxMode)) {
      blocking.push({
        key: "tax.mode",
        section: "tax",
        message: "合同税率模式不正确，请返回工作台重新选择"
      });
    }
    const pricedBillIds = new Set(
      bills
        .filter((bill) => {
          const amountRole =
            bill.amountRole ??
            template.billSchema.find((definition) => definition.key === bill.billKey)
              ?.amountRole;
          return amountRole === "included" || amountRole === "provisional";
        })
        .map((bill) => bill.id)
    );
    const pricingPolicy = contractPricingPolicy({
      pricingNature: version.pricingNature,
      amountLimitType: version.amountLimitType,
      hasPricedRows: rows.some((row) => pricedBillIds.has(row.contractBillId))
    });
    const billByKey = new Map(bills.map((bill) => [bill.billKey, bill]));
    for (const definition of template.billSchema) {
      const bill = billByKey.get(definition.key);
      const billRows = bill
        ? rows.filter((row) => row.contractBillId === bill.id)
        : [];
      if (definition.required && billRows.length === 0) {
        blocking.push({
          key: `bill.${definition.key}.empty`,
          section: "bills",
          message: `${definition.name}不能为空`
        });
      }
      for (const [index, row] of billRows.entries()) {
        const customData = this.object(row.customData);
        for (const column of definition.columns.filter((item) => item.required)) {
          const value =
            column.key === "itemName" || column.key === "item_name"
              ? row.itemName
              : column.key === "unit"
                ? row.unit
                : customData[column.key];
          if (this.isEmpty(value)) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.${column.key}`,
              section: "bills",
              message: `${definition.name}第${index + 1}行${column.label}不能为空`
            });
          }
        }
        if (
          definition.amountRole === "included" ||
          definition.amountRole === "provisional"
        ) {
          if (row.unitPrice === null) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.unit_price`,
              section: "bills",
              message: `${definition.name}第${index + 1}行缺少含税单价`
            });
          }
          if (
            pricingPolicy.kind !== "unlimited_framework" &&
            row.quantity === null
          ) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.quantity`,
              section: "bills",
              message: `${definition.name}第${index + 1}行缺少数量`
            });
          }
          if (
            pricingPolicy.kind !== "unlimited_framework" &&
            (row.taxInclusiveAmountCents === null ||
              row.taxExclusiveAmountCents === null ||
              row.taxAmountCents === null)
          ) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.amount`,
              section: "bills",
              message: `${definition.name}第${index + 1}行金额尚未计算完成`
            });
          }
          if (row.pricingFactStatus !== "confirmed") {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.pricing_fact`,
              section: "bills",
              message: `${definition.name}第${index + 1}行含税单价尚未确认`
            });
          }
          let rowTaxRate: string | null = null;
          let rowTaxRateInvalid = false;
          if (row.taxRate !== null) {
            try {
              rowTaxRate = normalizeTaxRatePercent(row.taxRate.toString());
            } catch {
              rowTaxRateInvalid = true;
              blocking.push({
                key: `bill.${definition.key}.row.${index}.tax_rate`,
                section: "bills",
                message: `${definition.name}第${index + 1}行税率不正确`
              });
            }
          }
          if (
            version.taxMode === "single_rate" &&
            !rowTaxRateInvalid &&
            (row.taxRateSource !== "version_default" ||
              (rowTaxRate !== null &&
                normalizedDefaultTaxRate !== null &&
                rowTaxRate !== normalizedDefaultTaxRate))
          ) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.tax_rate`,
              section: "bills",
              message: `${definition.name}第${index + 1}行税率必须与合同税率一致`
            });
          }
          if (
            version.taxMode === "multiple_rate" &&
            !rowTaxRateInvalid &&
            row.taxRateSource === "row_override" &&
            rowTaxRate === null
          ) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.tax_rate`,
              section: "bills",
              message: `${definition.name}第${index + 1}行例外税率不能为空`
            });
          }
          if (
            version.taxMode === "multiple_rate" &&
            !rowTaxRateInvalid &&
            row.taxRateSource === "version_default" &&
            rowTaxRate !== null &&
            normalizedDefaultTaxRate !== null &&
            rowTaxRate !== normalizedDefaultTaxRate
          ) {
            blocking.push({
              key: `bill.${definition.key}.row.${index}.tax_rate`,
              section: "bills",
              message: `${definition.name}第${index + 1}行未标记为例外税率，必须与合同税率一致`
            });
          }
        }
      }
    }

    const includedBillSum = bills
      .filter(
        (bill) =>
          ["included", "provisional"].includes(
            bill.amountRole ??
              template.billSchema.find((definition) => definition.key === bill.billKey)
                ?.amountRole ??
              ""
          )
      )
      .reduce((sum, bill) => sum + bill.taxInclusiveAmountCents, 0n);
    if (
      pricingPolicy.kind === "fixed_total_without_bill" &&
      version.amountSource !== "manual"
    ) {
      blocking.push({
        key: "amount.fixed_total_source",
        section: "amount",
        message: "纯固定总价且无计价清单时，请填写合同含税总价"
      });
    }
    if (
      pricingPolicy.kind === "priced_bill" &&
      version.amountSource !== "bill_sum"
    ) {
      blocking.push({
        key: "amount.priced_bill_source",
        section: "amount",
        message: "存在计价清单时，合同金额必须来自清单合计"
      });
    }
    if (
      pricingPolicy.kind === "priced_bill" &&
      version.amountSource === "bill_sum" &&
      version.amountCents !== includedBillSum
    ) {
      blocking.push({
        key: "amount.bill_sum",
        section: "amount",
        message: "合同金额与计入合同价的清单合计不一致"
      });
    }
    if (
      pricingPolicy.kind === "unlimited_framework" &&
      (version.amountSource !== "bill_sum" || version.amountCents !== 0n)
    ) {
      blocking.push({
        key: "amount.unlimited_framework",
        section: "amount",
        message: "无总价框架合同不设合同总价，请按实际发生量结算"
      });
    }

    if (!version.layoutTemplateVersionId) {
      blocking.push({
        key: "layout.selected",
        section: "layout",
        message: "请选择已发布的合同版式"
      });
    } else {
      const layout = await tx.contractLayoutTemplateVersion.findUnique({
        where: { id: version.layoutTemplateVersionId }
      });
      const layoutTemplate = layout
        ? await tx.contractLayoutTemplate.findUnique({
            where: { id: layout.layoutTemplateId }
          })
        : null;
      if (
        !layout ||
        layout.status !== "published" ||
        !layoutTemplate ||
        layoutTemplate.contractTypeKey !== contract.contractTypeKey
      ) {
        blocking.push({
          key: "layout.published",
          section: "layout",
          message: "所选合同版式未发布或与合同类型不匹配"
        });
      }
    }

    const parties = await tx.contractPartySnapshot.findMany({
      where: { contractVersionId: version.id }
    });
    const hasStructuredCompanyEntity = this.hasStructuredCompanyEntitySelection(draftData);
    for (const roleKey of ["party_a", "party_b"]) {
      if (
        !parties.some((party) => party.roleKey === roleKey) &&
        !(roleKey === "party_a" && hasStructuredCompanyEntity)
      ) {
        blocking.push({
          key: `party.${roleKey}`,
          section: "parties",
          message: `缺少${PARTY_ROLE_LABELS[roleKey] ?? "合同主体"}信息`
        });
      }
    }

    if (requireInternalReviewDocument) {
      const rounds = await tx.contractNegotiationRound.findMany({
        where: { contractVersionId: version.id }
      });
      if (rounds.some((round) => round.status === "open")) {
        blocking.push({
          key: "negotiation.open_round",
          section: "documents",
          message: "仍有开放的合同磋商轮次，请完成差异处置并关闭轮次"
        });
      }
      const comparisons = rounds.length
        ? await tx.contractDocumentComparison.findMany({
            where: { negotiationRoundId: { in: rounds.map((round) => round.id) } }
          })
        : [];
      const offlineRevisions = rounds.length
        ? await tx.contractOfflineRevision.findMany({
            where: { negotiationRoundId: { in: rounds.map((round) => round.id) } },
            select: { id: true, status: true }
          })
        : [];
      if (
        offlineRevisions.some(
          (revision) =>
            revision.status !== "succeeded" ||
            !comparisons.some(
              (comparison) =>
                comparison.offlineRevisionId === revision.id &&
                comparison.status === "succeeded"
            )
        ) ||
        comparisons.some((comparison) => comparison.status !== "succeeded")
      ) {
        blocking.push({
          key: "negotiation.incomplete_comparison",
          section: "documents",
          message: "仍有未完成、失败或过期的合同文档比较"
        });
      }
      const pendingDifference = comparisons.length
        ? await tx.contractDocumentDifference.findFirst({
            where: {
              comparisonId: { in: comparisons.map((comparison) => comparison.id) },
              disposition: "pending"
            },
            select: { id: true }
          })
        : null;
      if (pendingDifference) {
        blocking.push({
          key: "negotiation.pending_difference",
          section: "documents",
          message: "仍有待处理的合同文档差异"
        });
      }
      const confirmedCandidates = comparisons.length
        ? await tx.contractDocumentDifference.findMany({
            where: {
              comparisonId: { in: comparisons.map((comparison) => comparison.id) },
              disposition: "confirmed",
              candidate: { not: Prisma.JsonNull }
            },
            select: { id: true, candidate: true }
          })
        : [];
      if (
        confirmedCandidates.some(
          ({ candidate }) => !contractDocumentCandidateMatchesLedger(candidate, version)
        )
      ) {
        blocking.push({
          key: "negotiation.confirmed_candidate_mismatch",
          section: "documents",
          message: "已确认的结构候选与当前合同账本不一致，请先恢复一致后再提交"
        });
      }
      const documents = await tx.contractGeneratedDocument.findMany({
        where: {
          contractVersionId: version.id,
          purpose: "internal_review"
        },
        orderBy: { createdAt: "desc" }
      });
      const currentFailure = documents.some(
        (document) =>
          document.sourceRevision === version.draftRevision &&
          document.layoutTemplateVersionId === version.layoutTemplateVersionId &&
          document.status === "failed"
      );
      if (currentFailure) {
        blocking.push({
          key: "document.failure",
          section: "documents",
          message: "当前修订存在未解决的合同文档生成失败"
        });
      }
      const latestSuccess = documents.find((document) => document.status === "success");
      if (
        !latestSuccess ||
        latestSuccess.sourceRevision !== version.draftRevision ||
        latestSuccess.layoutTemplateVersionId !== version.layoutTemplateVersionId
      ) {
        blocking.push({
          key: "document.internal_review",
          section: "documents",
          message: "最新内部审核文档与当前修订或版式不一致"
        });
      }
    }

    if (version.contractGovernanceVersion === 1) {
      const links = await tx.contractVersionAuthorizationLink.findMany({
        where: { contractVersionId: version.id },
        orderBy: { side: "asc" }
      });
      const authorizationIds = links
        .map((link) => link.authorizationId)
        .filter((id): id is string => Boolean(id));
      const authorizations = authorizationIds.length
        ? await tx.contractAuthorization.findMany({ where: { id: { in: authorizationIds } } })
        : [];
      const authorizationFileIds = authorizations.map((authorization) => authorization.fileId);
      const authorizationFiles = authorizationFileIds.length
        ? await tx.fileObject.findMany({ where: { id: { in: authorizationFileIds } } })
        : [];
      for (const side of ["first_party", "counterparty"] as const) {
        const link = links.find((item) => item.side === side);
        const label = side === "first_party" ? "我方" : "乙方";
        if (!link) {
          blocking.push({
            key: `authorization.${side}.selection_missing`,
            section: "documents",
            message: `请明确${label}是否需要授权委托书`
          });
        } else if (link.required && !link.authorizationId) {
          blocking.push({
            key: `authorization.${side}.file_missing`,
            section: "documents",
            message: `请关联有效的${label}授权委托书`
          });
        } else if (link.required) {
          const authorization = authorizations.find((item) =>
            item.id === link.authorizationId &&
            item.side === side &&
            item.status === "active" &&
            item.pageCount > 0 &&
            /^[0-9a-f]{64}$/u.test(item.contentSha256)
          );
          const file = authorization
            ? authorizationFiles.find((item) => item.id === authorization.fileId)
            : null;
          if (
            !authorization ||
            !file ||
            file.storageStatus !== "active" ||
            file.mimeType !== "application/pdf" ||
            file.sizeBytes <= 0 ||
            file.contentSha256 !== authorization.contentSha256
          ) {
            blocking.push({
              key: `authorization.${side}.file_invalid`,
              section: "documents",
              message: `${label}授权委托书当前不可用，请重新关联`
            });
          }
        }
      }
      const formal = await tx.contractFormalFile.findFirst({
        where: {
          contractVersionId: version.id,
          purpose: "approval_original",
          status: "active"
        },
        orderBy: { createdAt: "desc" }
      });
      if (!formal) {
        blocking.push({
          key: "document.counterparty_signed_pdf_missing",
          section: "documents",
          message: "请上传乙方已签字盖章的完整合同审批 PDF"
        });
      } else if (formal.sourceRevision !== version.draftRevision) {
        blocking.push({
          key: "document.counterparty_signed_pdf_stale",
          section: "documents",
          message: "正式审批文件与当前合同内容不一致，请重新上传"
        });
      }
    }

    return { blocking, warnings, checkedRevision: version.draftRevision };
  }

  private async appendCrossVersionMappingReadiness(
    tx: ReadinessClient,
    version: ReadinessVersion,
    targetRows: Array<{ id: string }>,
    blocking: ContractReadinessResult["blocking"]
  ) {
    if (version.changeType !== "change" || !version.baseVersionId) return;
    const sourceBills = await tx.contractBill.findMany({
      where: { contractVersionId: version.baseVersionId },
      select: { id: true }
    });
    if (!sourceBills.length) return;
    const sourceRows = await tx.contractBillRow.findMany({
      where: { contractBillId: { in: sourceBills.map((bill) => bill.id) } },
      select: { id: true }
    });
    if (!sourceRows.length) return;
    const settlements = await tx.settlement.findMany({
      where: { contractId: version.contractId, status: { in: ["effective", "partially_paid", "paid"] } },
      select: { id: true }
    });
    if (!settlements.length) return;
    const occupied = await tx.settlementLine.findMany({
      where: {
        settlementId: { in: settlements.map((settlement) => settlement.id) },
        contractBillRowId: { in: sourceRows.map((row) => row.id) }
      },
      select: { contractBillRowId: true }
    });
    const occupiedSourceIds = [...new Set(occupied.flatMap((line) => line.contractBillRowId ? [line.contractBillRowId] : []))];
    if (!occupiedSourceIds.length) return;
    const transitions = await tx.contractBillRowTransition.findMany({
      where: {
        fromContractVersionId: version.baseVersionId,
        toContractVersionId: version.id,
        sourceContractBillRowId: { in: occupiedSourceIds },
        status: "confirmed"
      },
      select: { sourceContractBillRowId: true, targetContractBillRowId: true, status: true }
    });
    const targetIds = new Set(targetRows.map((row) => row.id));
    const unresolved = occupiedSourceIds.filter((sourceId) => !transitions.some((transition) =>
      transition.sourceContractBillRowId === sourceId && targetIds.has(transition.targetContractBillRowId)
    ));
    if (unresolved.length) {
      blocking.push({
        key: "bill.cross_version_mapping",
        section: "bills",
        message: `有 ${unresolved.length} 条已结算旧版清单尚未由合同部主任确认跨版本映射`
      });
    }
  }

  private hasStructuredCompanyEntitySelection(draftData: Record<string, unknown>) {
    const selection = this.object(draftData["companyEntitySelection"]);
    return typeof selection["id"] === "string" &&
      typeof selection["versionId"] === "string" &&
      typeof selection["versionNo"] === "number" &&
      typeof selection["name"] === "string" &&
      typeof selection["unifiedSocialCreditCode"] === "string";
  }

  async freeze(tx: ReadinessClient, version: ReadinessVersion) {
    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id },
      orderBy: { billKey: "asc" }
    });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }]
        })
      : [];
    assertContractBillDerivedUnitPrices(rows);
    const parties = await tx.contractPartySnapshot.findMany({
      where: { contractVersionId: version.id }
    });
    const documents = await tx.contractGeneratedDocument.findMany({
      where: {
        contractVersionId: version.id,
        purpose: "internal_review",
        status: "success"
      },
      orderBy: { createdAt: "desc" }
    });
    const authorizationLinks = version.contractGovernanceVersion === 1
      ? await tx.contractVersionAuthorizationLink.findMany({
          where: { contractVersionId: version.id },
          orderBy: { side: "asc" }
        })
      : [];
    const formalFile = version.contractGovernanceVersion === 1
      ? await tx.contractFormalFile.findFirst({
          where: {
            contractVersionId: version.id,
            purpose: "approval_original",
            status: "active"
          },
          orderBy: { createdAt: "desc" }
        })
      : null;
    return this.toJsonSafe({
      draftRevision: version.draftRevision,
      draftData: version.draftData,
      clauses: version.clauseSnapshot,
      amountCents: version.amountCents.toString(),
      amountSource: version.amountSource,
      amountAdjustmentReason: version.amountAdjustmentReason,
      taxFacts: {
        invoiceType: version.invoiceType,
        taxMode: version.taxMode,
        defaultTaxRatePercent: version.defaultTaxRatePercent?.toString() ?? null,
        taxFactRevision: version.taxFactRevision
      },
      layoutTemplateVersionId: version.layoutTemplateVersionId,
      parties,
      bills: bills.map((bill) => ({
        ...bill,
        taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
        rows: rows.filter((row) => row.contractBillId === bill.id)
      })),
      internalReviewDocument: documents[0] ?? null,
      governance: version.contractGovernanceVersion === 1
        ? {
            version: 1,
            authorizationLinks,
            formalFile: formalFile
              ? {
                  id: formalFile.id,
                  fileId: formalFile.fileId,
                  contentSha256: formalFile.contentSha256,
                  pageCount: formalFile.pageCount,
                  sourceRevision: formalFile.sourceRevision,
                  declarationSnapshot: formalFile.declarationSnapshot
                }
              : null
          }
        : null
    });
  }

  private template(value: Prisma.JsonValue): TemplateSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("合同模板快照异常，请重新选择模板后再检查资料");
    }
    const snapshot = value as unknown as Partial<TemplateSnapshot>;
    if (
      !Array.isArray(snapshot.fieldSchema) ||
      !Array.isArray(snapshot.billSchema) ||
      !Array.isArray(snapshot.clauseSchema) ||
      !Array.isArray(snapshot.attachmentSchema) ||
      !Array.isArray(snapshot.validationSchema)
    ) {
      throw new BadRequestException("合同模板快照异常，请重新选择模板后再检查资料");
    }
    return snapshot as TemplateSnapshot;
  }

  private clauses(value: Prisma.JsonValue): ContractClauseDefinition[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("合同条款快照异常，请刷新合同工作台后重试");
    }
    return value as unknown as ContractClauseDefinition[];
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private fieldData(draftData: Record<string, unknown>) {
    return { ...draftData, ...this.object(draftData["fieldValues"]) };
  }

  private isVisible(
    field: ContractFieldDefinition,
    draftData: Record<string, unknown>
  ) {
    if (!field.visibleWhen) return true;
    const matches = draftData[field.visibleWhen.fieldKey] === field.visibleWhen.value;
    return field.visibleWhen.operator === "eq" ? matches : !matches;
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return this.text(value).trim().length === 0;
    return false;
  }

  private text(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.map((item) => this.text(item)).join(" ");
    if (typeof value === "object") {
      return Object.values(value as Record<string, unknown>)
        .map((item) => this.text(item))
        .join(" ");
    }
    return String(value);
  }

  private toJsonSafe<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? item.toString() : item
      )
    ) as T;
  }
}
